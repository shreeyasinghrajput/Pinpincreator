const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const app = express();
app.use(cors());
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

let mcpClientPromise;

async function getMcpClient() {
  if (!mcpClientPromise) {
    mcpClientPromise = (async () => {
      const client = new Client({ name: 'pinterest-gemini-dashboard', version: '1.0.0' });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(__dirname, 'mcp-server.js')],
        env: process.env,
      });
      await client.connect(transport);
      return client;
    })().catch((error) => {
      mcpClientPromise = null;
      throw error;
    });
  }
  return mcpClientPromise;
}

async function getPinterestSummary() {
  const client = await getMcpClient();
  const result = await client.callTool({ name: 'get_pinterest_summary', arguments: {} });
  if (result.isError) {
    throw new Error(result.content?.[0]?.text || 'Pinterest MCP request failed.');
  }
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Pinterest MCP returned no analytics data.');
  return JSON.parse(text);
}

function sumMetrics(days) {
  return days.reduce((totals, day) => {
    totals.impressions += Number(day.impressions) || 0;
    totals.saves += Number(day.saves) || 0;
    totals.clicks += Number(day.clicks) || 0;
    totals.outboundClicks += Number(day.outboundClicks) || 0;
    return totals;
  }, { impressions: 0, saves: 0, clicks: 0, outboundClicks: 0 });
}

function getWeeklyComparison(daily = []) {
  const previousDays = daily.slice(-14, -7);
  const recentDays = daily.slice(-7);
  const previous = sumMetrics(previousDays);
  const recent = sumMetrics(recentDays);
  const metrics = {};

  for (const name of ['impressions', 'saves', 'clicks', 'outboundClicks']) {
    const previousValue = previous[name];
    const currentValue = recent[name];
    metrics[name] = {
      previous: previousValue,
      current: currentValue,
      changePercent: previousValue === 0
        ? (currentValue === 0 ? 0 : null)
        : Math.round(((currentValue - previousValue) / previousValue) * 1000) / 10,
    };
  }

  const previousEngagement = previous.saves + previous.clicks + previous.outboundClicks;
  const currentEngagement = recent.saves + recent.clicks + recent.outboundClicks;
  metrics.engagement = {
    previous: previousEngagement,
    current: currentEngagement,
    changePercent: previousEngagement === 0
      ? (currentEngagement === 0 ? 0 : null)
      : Math.round(((currentEngagement - previousEngagement) / previousEngagement) * 1000) / 10,
  };

  return {
    enoughData: previousDays.length >= 7 && recentDays.length >= 7,
    previousDays: previousDays.length,
    recentDays: recentDays.length,
    metrics,
  };
}

function buildAnalyticsContext(summary) {
  const daily = Array.isArray(summary.daily) ? summary.daily : [];
  return {
    source: summary.source || summary.mode || 'Pinterest analytics',
    username: summary.profile?.username || null,
    daysTracked: daily.length,
    weeklyComparison: getWeeklyComparison(daily),
    recentDays: daily.slice(-14),
    topPins: [...(summary.pins || [])]
      .sort((a, b) => (b.totalImpressions || 0) - (a.totalImpressions || 0))
      .slice(0, 8)
      .map(({ title, totalImpressions, totalSaves, totalClicks, totalOutboundClicks }) => ({
        title,
        totalImpressions,
        totalSaves,
        totalClicks,
        totalOutboundClicks,
      })),
  };
}

async function generateGeminiText(contents, systemInstruction = '') {
  if (!GEMINI_API_KEY) {
    const error = new Error('GEMINI_API_KEY is not set in Backend/.env.');
    error.status = 400;
    throw error;
  }

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  const data = await geminiRes.json();
  if (!geminiRes.ok) {
    const error = new Error(data.error?.message || 'Gemini API error.');
    error.status = geminiRes.status;
    throw error;
  }

  const text = data.candidates?.[0]?.content?.parts
    ?.filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Gemini returned no text. Try again.');
  return text;
}

function analyticsInstruction(context) {
  return [
    'You are Pinboard, a Pinterest analytics assistant.',
    'Use only facts and metrics in the supplied analytics context. Do not invent missing information or claim a cause that the data cannot prove.',
    'If fewer than seven days are available for either comparison period, explain that the week-over-week comparison is incomplete.',
    'Engagement is defined here as saves + Pin clicks + outbound clicks.',
    'Be practical, concise, and specific. Distinguish observed changes from possible explanations.',
    'Pinterest analytics context:',
    JSON.stringify(context),
  ].join('\n');
}

function requireGeminiKey() {
  if (!GEMINI_API_KEY) {
    const error = new Error('GEMINI_API_KEY is not set in Backend/.env.');
    error.status = 400;
    throw error;
  }
}

app.get('/', (req, res) => {
  res.send('Pinterest + Gemini Backend running on http://localhost:4000');
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const summary = await getPinterestSummary();
    res.json(summary);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Failed to load Pinterest analytics through MCP.' });
  }
});

app.post('/api/ai-insights', async (req, res) => {
  try {
    requireGeminiKey();
    const summary = await getPinterestSummary();
    const context = buildAnalyticsContext(summary);
    const prompt = `${analyticsInstruction(context)}\n\nGive three data-backed observations and three prioritized recommendations.`;
    res.json({ insights: await generateGeminiText([{ role: 'user', parts: [{ text: prompt }] }]) });
  } catch (err) {
    console.error('Gemini insights route error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to generate Gemini insights.' });
  }
});

app.post('/api/content-plan', async (req, res) => {
  try {
    requireGeminiKey();
    const summary = await getPinterestSummary();
    const context = buildAnalyticsContext(summary);
    const prompt = [
      analyticsInstruction(context),
      'Create a practical 7-day Pinterest content strategy. For each day, suggest a content theme, a Pin format/creative angle, and a short action. Include a short rationale tied to available metrics.',
      'Do not promise results or invent audience demographics, posting times, or Pin topics not evidenced by the data. Clearly mark any creative idea as a hypothesis.',
      'Format the result as a readable day-by-day list followed by up to three recommendations.',
    ].join('\n\n');
    res.json({ plan: await generateGeminiText([{ role: 'user', parts: [{ text: prompt }] }]) });
  } catch (err) {
    console.error('Content plan route error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to create a content plan.' });
  }
});

app.post('/api/data-assistant', async (req, res) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question || question.length > 1000) {
      return res.status(400).json({ error: 'Enter a question of 1–1000 characters.' });
    }
    requireGeminiKey();

    const history = Array.isArray(req.body?.history)
      ? req.body.history
        .filter((message) =>
          ['user', 'model'].includes(message?.role) &&
          typeof message?.text === 'string' &&
          message.text.trim()
        )
        .slice(-8)
        .map((message) => ({
          role: message.role,
          parts: [{ text: message.text.trim().slice(0, 1000) }],
        }))
      : [];
    const summary = await getPinterestSummary();
    const context = buildAnalyticsContext(summary);
    const contents = [...history, { role: 'user', parts: [{ text: question }] }];
    res.json({ answer: await generateGeminiText(contents, analyticsInstruction(context)) });
  } catch (err) {
    console.error('Data assistant route error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Failed to answer from Pinterest data.' });
  }
});

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});