const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const PINTEREST_TOKEN = process.env.PINTEREST_TOKEN || '';
const METRICS = ['IMPRESSION', 'SAVE', 'PIN_CLICK', 'OUTBOUND_CLICK'];

function dateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function analyticsUrl(resource, id) {
  const { startDate, endDate } = dateRange();
  const endpoint = resource === 'account'
    ? 'user_account/analytics'
    : `pins/${encodeURIComponent(id)}/analytics`;
  const url = new URL(`https://api.pinterest.com/v5/${endpoint}`);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('metric_types', METRICS.join(','));
  if (resource === 'account') url.searchParams.set('granularity', 'DAY');
  return url;
}

async function pinterestGet(url) {
  if (!PINTEREST_TOKEN) throw new Error('PINTEREST_TOKEN is not configured.');
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${PINTEREST_TOKEN}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.error?.message || `Pinterest API returned ${response.status}.`);
  }
  return body;
}

function metricName(key) {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('impression')) return 'impressions';
  if (normalized === 'save' || normalized.includes('save')) return 'saves';
  if (normalized.includes('outboundclick')) return 'outboundClicks';
  if (normalized.includes('pinclick') || normalized === 'clicks') return 'clicks';
  return null;
}

function metricValue(value) {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + (Number(item) || 0), 0);
  if (value && typeof value === 'object') {
    return Number(value.value ?? value.count ?? value.total) || 0;
  }
  return Number(value) || 0;
}

function normalizeDaily(payload) {
  const records = Array.isArray(payload) ? payload :
    payload?.daily_metrics || payload?.items || payload?.data || [];
  const daily = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const date = record.date || record.DATE || record.time;
    if (!date) continue;
    const row = daily.get(date) || { date, impressions: 0, saves: 0, clicks: 0, outboundClicks: 0 };
    const metrics = record.metrics || record;
    for (const [key, value] of Object.entries(metrics)) {
      const name = metricName(key);
      if (name) row[name] = metricValue(value);
    }
    daily.set(date, row);
  }
  return [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function findNewestCsvFile() {
  const candidateDirs = [path.join(os.homedir(), 'Downloads'), path.resolve(__dirname, '..'), __dirname]
    .filter((dir, idx, arr) => arr.indexOf(dir) === idx && fs.existsSync(dir));
  const matches = [];
  for (const dir of candidateDirs) {
    for (const name of fs.readdirSync(dir).filter((file) => file.toLowerCase().endsWith('.csv'))) {
      const fullPath = path.join(dir, name);
      matches.push({
        name,
        fullPath,
        prefersName: /pinterest|pin/i.test(name) ? 1 : 0,
        time: fs.statSync(fullPath).mtime.getTime(),
      });
    }
  }
  matches.sort((a, b) => b.prefersName - a.prefersName || b.time - a.time);
  return matches[0] || null;
}

function getLatestCsvStats() {
  const latest = findNewestCsvFile();
  if (!latest) return null;
  const lines = fs.readFileSync(latest.fullPath, 'utf-8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const dailyMap = {};
  let currentMetric = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('Data starting')) continue;
    const match = line.match(/^(\d{4}-\d{2}-\d{2})\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (match && currentMetric) {
      const [, date, value] = match;
      if (!dailyMap[date]) dailyMap[date] = { date, impressions: 0, saves: 0, clicks: 0, outboundClicks: 0 };
      dailyMap[date][currentMetric] += Number(value) || 0;
      continue;
    }
    const lower = line.toLowerCase();
    if (lower.startsWith('impression')) currentMetric = 'impressions';
    else if (lower.startsWith('save')) currentMetric = 'saves';
    else if (lower.startsWith('pin click') || lower.startsWith('click')) currentMetric = 'clicks';
    else if (lower.startsWith('outbound click')) currentMetric = 'outboundClicks';
    else if (/^(top boards|top pins|content types|devices|source|publish types|age|gender)/i.test(line)) currentMetric = null;
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  return daily.length ? { fileName: latest.name, daily } : null;
}

function summarize(daily) {
  const totals = daily.reduce((result, day) => {
    result.totalImpressions += day.impressions || 0;
    result.totalSaves += day.saves || 0;
    result.totalClicks += day.clicks || 0;
    result.totalOutboundClicks += day.outboundClicks || 0;
    return result;
  }, { totalImpressions: 0, totalSaves: 0, totalClicks: 0, totalOutboundClicks: 0 });
  return {
    ...totals,
    daysTracked: daily.length,
    bestPerformingDay: [...daily].sort((a, b) => b.impressions - a.impressions)[0] || null,
  };
}

async function getLiveSummary() {
  const [account, analytics, pinsResponse] = await Promise.all([
    pinterestGet('https://api.pinterest.com/v5/user_account'),
    pinterestGet(analyticsUrl('account')),
    pinterestGet('https://api.pinterest.com/v5/pins?page_size=25'),
  ]);
  const daily = normalizeDaily(analytics);
  const pins = [];
  const listedPins = pinsResponse.items || [];
  for (let offset = 0; offset < listedPins.length; offset += 5) {
    const batch = await Promise.all(listedPins.slice(offset, offset + 5).map(async (pin) => {
      try {
        const metrics = await pinterestGet(analyticsUrl('pin', pin.id));
        const rows = normalizeDaily(metrics);
        const totals = summarize(rows);
        return {
          id: pin.id,
          title: pin.title || pin.description || 'Untitled Pin',
          image: pin.media?.images?.['600x']?.url || pin.media?.images?.['400x300']?.url || null,
          ...totals,
        };
      } catch (error) {
        return {
          id: pin.id,
          title: pin.title || pin.description || 'Untitled Pin',
          image: pin.media?.images?.['600x']?.url || pin.media?.images?.['400x300']?.url || null,
          analyticsError: error.message,
        };
      }
    }));
    pins.push(...batch);
  }
  return {
    mode: 'LIVE_MCP',
    source: 'Pinterest API via MCP',
    profile: {
      username: account.username || 'Pinterest account',
      followers: account.follower_count ?? null,
      following: account.following_count ?? null,
      monthlyViews: account.monthly_views ?? null,
      pinCount: account.pin_count ?? null,
      boardCount: account.board_count ?? null,
    },
    ...summarize(daily),
    daily,
    pins,
  };
}

async function getSummary() {
  if (PINTEREST_TOKEN) return getLiveSummary();
  const csv = getLatestCsvStats();
  if (!csv) throw new Error('Set PINTEREST_TOKEN for live Pinterest analytics, or add an analytics CSV to Downloads.');
  return {
    mode: 'CSV_SYNC',
    source: `CSV export: ${csv.fileName}`,
    ...summarize(csv.daily),
    daily: csv.daily,
    pins: [],
  };
}

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: 'pinterest-analytics-bridge', version: '1.0.0' });

server.tool('get_pinterest_summary', 'Get Pinterest account analytics and recent Pin performance through the Pinterest API.', {}, async () => {
  try {
    return toolResult(await getSummary());
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});

server.tool('get_pinterest_daily_trends', 'Get daily Pinterest impressions, saves, and clicks for the last 30 days.', {}, async () => {
  try {
    return toolResult((await getSummary()).daily);
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error('Pinterest MCP server failed:', error.message);
  process.exitCode = 1;
});