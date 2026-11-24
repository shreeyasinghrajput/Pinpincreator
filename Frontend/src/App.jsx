import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Eye,
  LayoutDashboard,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  MousePointer2,
  Pin,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './App.css';

const API_ROOT = '/api';
const EMPTY_DAILY = [];
const WINDOWS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: 'All time', value: 0 },
];

const METRICS = [
  { id: 'impressions', label: 'Impressions', icon: Eye, color: '#c8243b' },
  { id: 'saves', label: 'Saves', icon: Bookmark, color: '#8a61d2' },
  { id: 'clicks', label: 'Pin clicks', icon: MousePointer2, color: '#388b75' },
  { id: 'outboundClicks', label: 'Outbound clicks', icon: ExternalLink, color: '#d18b3b' },
];

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('en', { notation: parsed > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(parsed);
}

function dateLabel(date, includeYear = false) {
  if (!date) return '—';
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}) }).format(parsed);
}

function sumDays(days) {
  return days.reduce((totals, day) => {
    totals.impressions += Number(day.impressions) || 0;
    totals.saves += Number(day.saves) || 0;
    totals.clicks += Number(day.clicks) || 0;
    totals.outboundClicks += Number(day.outboundClicks) || 0;
    return totals;
  }, { impressions: 0, saves: 0, clicks: 0, outboundClicks: 0 });
}

function percentageChange(current, previous) {
  if (!previous) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

async function readJson(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('The backend returned a non-JSON response. Start the Backend service and restart the Frontend dev server.');
  }
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return body;
}

async function fetchDashboard() {
  const response = await fetch(`${API_ROOT}/dashboard`);
  const summary = await readJson(response);
  if (!Array.isArray(summary.daily)) {
    throw new Error(summary.statusNote || 'Pinterest analytics returned an unexpected response. Check the backend connection.');
  }
  return summary;
}

function MetricCard({ title, value, icon: Icon, tone, helper, delta }) {
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        <span className={`metric-icon ${tone}`}><Icon size={18} strokeWidth={2} /></span>
        {delta && (
          <span className="metric-delta">
            <ArrowUpRight size={14} />
            {delta}
          </span>
        )}
      </div>
      <p className="metric-title">{title}</p>
      <strong className="metric-value">{formatNumber(value)}</strong>
      <p className="metric-helper">{helper}</p>
    </article>
  );
}

function EmptyState({ onRefresh, loading, error }) {
  const pinterestRejectedToken = /authentication failed/i.test(error || '');
  const needsSetup = /PINTEREST_TOKEN|CSV|trial pending/i.test(error || '');
  return (
    <section className="empty-state">
      <div className="empty-icon"><Pin size={24} /></div>
      <h2>{pinterestRejectedToken ? 'Pinterest rejected the API token' : needsSetup ? 'Connect your Pinterest account' : 'Your analytics could not load'}</h2>
      <p>
        {pinterestRejectedToken
          ? 'Check that the token in Backend/.env is current, belongs to the right Pinterest app/account, and has the required account and analytics permissions.'
          : needsSetup
          ? 'Add your Pinterest API access token to Backend/.env, then refresh to load your real account metrics.'
          : error || 'Check that the backend is running, then try again.'}
      </p>
      {needsSetup && (
        <>
          <code className="setup-code">PINTEREST_TOKEN=your_access_token{'\n'}GEMINI_API_KEY=your_gemini_key</code>
          <p className="connection-feature-note">Pinterest powers your stats and weekly comparison. Gemini powers personalized recommendations, the 7-day content planner, and chat with your data.</p>
        </>
      )}
      <button className="button button-primary" onClick={onRefresh} disabled={loading}>
        {loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
        Try again
      </button>
    </section>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [metric, setMetric] = useState('impressions');
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState('');
  const [insightError, setInsightError] = useState('');
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [contentPlan, setContentPlan] = useState('');
  const [planError, setPlanError] = useState('');
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantError, setAssistantError] = useState('');
  const [askingAssistant, setAskingAssistant] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const summary = await fetchDashboard();
      setData(summary);
      setLastUpdated(new Date());
    } catch (requestError) {
      setData(null);
      setError(requestError.message || 'Could not reach the Pinterest analytics service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function loadInitialDashboard() {
      try {
        const summary = await fetchDashboard();
        if (active) {
          setData(summary);
          setLastUpdated(new Date());
        }
      } catch (requestError) {
        if (active) {
          setData(null);
          setError(requestError.message || 'Could not reach the Pinterest analytics service.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadInitialDashboard();
    return () => {
      active = false;
    };
  }, []);

  const daily = data?.daily || EMPTY_DAILY;
  const filteredDaily = useMemo(() => {
    if (!windowDays) return daily;
    return daily.slice(-windowDays);
  }, [daily, windowDays]);

  const chartData = useMemo(() => filteredDaily.map((day) => ({
    ...day,
    shortDate: dateLabel(day.date),
  })), [filteredDaily]);

  const totals = useMemo(() => filteredDaily.reduce((summary, day) => {
    summary.impressions += Number(day.impressions) || 0;
    summary.saves += Number(day.saves) || 0;
    summary.clicks += Number(day.clicks) || 0;
    summary.outboundClicks += Number(day.outboundClicks) || 0;
    return summary;
  }, { impressions: 0, saves: 0, clicks: 0, outboundClicks: 0 }), [filteredDaily]);

  const weeklyComparison = useMemo(() => {
    const previousDays = daily.slice(-14, -7);
    const recentDays = daily.slice(-7);
    const previous = sumDays(previousDays);
    const current = sumDays(recentDays);
    const metrics = METRICS.map((item) => ({
      ...item,
      current: current[item.id],
      previous: previous[item.id],
      change: percentageChange(current[item.id], previous[item.id]),
    }));
    const previousEngagement = previous.saves + previous.clicks + previous.outboundClicks;
    const currentEngagement = current.saves + current.clicks + current.outboundClicks;
    return {
      enoughData: previousDays.length >= 7 && recentDays.length >= 7,
      previousDays,
      recentDays,
      metrics,
      engagement: {
        current: currentEngagement,
        previous: previousEngagement,
        change: percentageChange(currentEngagement, previousEngagement),
      },
    };
  }, [daily]);

  const profile = data?.profile || {};
  const activeMetric = METRICS.find((item) => item.id === metric) || METRICS[0];
  const pins = [...(data?.pins || [])].sort((a, b) => (b.totalImpressions || 0) - (a.totalImpressions || 0));
  const dataMode = data?.mode === 'LIVE_MCP' ? 'Live Pinterest data' : data?.source || 'Analytics source';

  async function handleGenerateInsights() {
    setLoadingInsights(true);
    setInsightError('');
    setInsights('');
    try {
      const response = await fetch(`${API_ROOT}/ai-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await readJson(response);
      setInsights(result.insights || 'No insights returned.');
    } catch (requestError) {
      setInsightError(requestError.message || 'Could not generate insights.');
    } finally {
      setLoadingInsights(false);
    }
  }

  async function handleGeneratePlan() {
    setLoadingPlan(true);
    setPlanError('');
    setContentPlan('');
    try {
      const response = await fetch(`${API_ROOT}/content-plan`, { method: 'POST' });
      const result = await readJson(response);
      setContentPlan(result.plan || 'No content plan was returned.');
    } catch (requestError) {
      setPlanError(requestError.message || 'Could not create a content plan.');
    } finally {
      setLoadingPlan(false);
    }
  }

  async function handleAskAssistant(question = assistantInput) {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || askingAssistant) return;

    const previousMessages = assistantMessages;
    setAssistantInput('');
    setAssistantError('');
    setAssistantMessages((current) => [...current, { role: 'user', text: trimmedQuestion }]);
    setAskingAssistant(true);
    try {
      const response = await fetch(`${API_ROOT}/data-assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmedQuestion,
          history: previousMessages.slice(-8).map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            text: message.text,
          })),
        }),
      });
      const result = await readJson(response);
      setAssistantMessages((current) => [...current, { role: 'assistant', text: result.answer || 'No answer was returned.' }]);
    } catch (requestError) {
      setAssistantError(requestError.message || 'Could not reach the data assistant.');
    } finally {
      setAskingAssistant(false);
    }
  }

  const engagementChange = weeklyComparison.engagement.change;
  const weeklyPulse = !weeklyComparison.enoughData
    ? 'Track at least 14 daily records to get a complete week-over-week comparison.'
    : engagementChange === null
      ? 'Engagement is now above zero; there was no engagement in the previous tracked week to calculate a percentage change.'
      : engagementChange < 0
        ? `Engagement is down ${Math.abs(engagementChange)}% versus the previous 7 tracked days. This compares saves, Pin clicks, and outbound clicks; it shows what changed, not the cause.`
        : engagementChange > 0
          ? `Engagement is up ${engagementChange}% versus the previous 7 tracked days. This compares saves, Pin clicks, and outbound clicks.`
          : 'Engagement is unchanged versus the previous 7 tracked days.';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Pinboard home">
          <span className="brand-mark"><Pin size={19} fill="currentColor" /></span>
          <span>pinboard<span className="brand-period">.</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><LayoutDashboard size={18} /> Overview</a>
          <a className="nav-item" href="#performance"><BarChart3 size={18} /> Performance</a>
          <a className="nav-item" href="#top-pins"><Pin size={18} /> Your Pins</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon"><Lightbulb size={17} /></span>
            <strong>Grow with intention</strong>
            <p>Track what resonates, then make more of it.</p>
          </div>
          <button className="nav-item sidebar-settings" onClick={() => document.getElementById('connection-status')?.scrollIntoView({ behavior: 'smooth' })}>
            <Settings2 size={18} /> Data connection
          </button>
          <a className="nav-item" href="https://help.pinterest.com/" target="_blank" rel="noreferrer"><CircleHelp size={18} /> Help center</a>
          <div className="sidebar-footer">Made for your next big idea <span>✦</span></div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>Overview</strong></div>
          <div className="topbar-actions">
            <span className="topbar-date"><CalendarDays size={15} /> Last 30 days</span>
            <span className="avatar">{(profile.username || 'P').slice(0, 1).toUpperCase()}</span>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <p className="eyebrow">YOUR PINTEREST, AT A GLANCE</p>
              <h1>Good things are growing<span className="heading-period">.</span></h1>
              <p className="welcome-subtitle">
                {profile.username ? `Here’s how @${profile.username} is doing.` : 'A clear view of your Pinterest performance.'}
              </p>
            </div>
            <button className="button button-secondary refresh-button" onClick={loadDashboard} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={15} />}
              Refresh data
            </button>
          </section>

          <section className="profile-strip">
            <div className="profile-identity">
              <div className="profile-avatar"><Pin size={20} fill="currentColor" /></div>
              <div><strong>{profile.username || 'Pinterest account'}</strong><span>Creator overview</span></div>
            </div>
            <div className="profile-stat"><UsersRound size={17} /><strong>{formatNumber(profile.followers)}</strong><span>followers</span></div>
            <div className="profile-stat"><Activity size={17} /><strong>{formatNumber(profile.following)}</strong><span>following</span></div>
            <div className="profile-stat"><Eye size={17} /><strong>{formatNumber(profile.monthlyViews)}</strong><span>monthly views</span></div>
            <div className="profile-stat"><Pin size={17} /><strong>{formatNumber(profile.pinCount)}</strong><span>Pins</span></div>
            <div className="profile-stat"><Bookmark size={17} /><strong>{formatNumber(profile.boardCount)}</strong><span>boards</span></div>
          </section>

          {loading && !data ? (
            <div className="loading-state"><LoaderCircle className="spin" size={21} /><span>Connecting to Pinterest analytics…</span></div>
          ) : !data ? (
            <EmptyState onRefresh={loadDashboard} loading={loading} error={error} />
          ) : (
            <>
              {error && <div className="inline-error" role="alert">{error}</div>}
              <div className="source-row" id="connection-status">
                <span className={`connection-dot ${data.mode === 'LIVE_MCP' ? 'is-live' : 'is-csv'}`} />
                <span>{dataMode}</span>
                <span className="source-divider">·</span>
                <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Recently updated'}</span>
                <button className="source-refresh" onClick={loadDashboard} disabled={loading} aria-label="Refresh dashboard data"><RefreshCw size={14} /></button>
              </div>

              <section className="metric-grid" aria-label="Key metrics">
                <MetricCard title="Impressions" value={totals.impressions} icon={Eye} tone="tone-red" helper={`${filteredDaily.length} days of activity`} />
                <MetricCard title="Saves" value={totals.saves} icon={Bookmark} tone="tone-purple" helper="People saved your ideas" />
                <MetricCard title="Pin clicks" value={totals.clicks} icon={MousePointer2} tone="tone-green" helper="Engagement with your Pins" />
                <MetricCard title="Outbound clicks" value={totals.outboundClicks} icon={ExternalLink} tone="tone-amber" helper="Visits to your website" />
              </section>

              <section className="panel performance-panel" id="performance">
                <div className="panel-heading">
                  <div>
                    <div className="section-title-row"><h2>Performance over time</h2><span className="live-tag"><span /> ANALYTICS</span></div>
                    <p className="panel-subtitle">See how people are finding and engaging with your ideas.</p>
                  </div>
                  <div className="select-wrap">
                    <select aria-label="Date range" value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
                      {WINDOWS.map((window) => <option value={window.value} key={window.label}>{window.label}</option>)}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </div>

                <div className="chart-toolbar" role="group" aria-label="Choose chart metric">
                  {METRICS.map((item) => (
                    <button className={`metric-tab ${metric === item.id ? 'selected' : ''}`} key={item.id} onClick={() => setMetric(item.id)}>
                      <span className="metric-tab-dot" style={{ backgroundColor: item.color }} />{item.label}
                    </button>
                  ))}
                </div>

                <div className="chart-summary"><strong>{formatNumber(totals[metric])}</strong><span>{activeMetric.label.toLowerCase()} in selected period</span></div>
                {chartData.length ? (
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={activeMetric.color} stopOpacity={0.19} />
                            <stop offset="95%" stopColor={activeMetric.color} stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="#f0edf0" strokeDasharray="3 5" />
                        <XAxis dataKey="shortDate" axisLine={false} tickLine={false} tick={{ fill: '#96909a', fontSize: 11 }} minTickGap={28} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#96909a', fontSize: 11 }} tickFormatter={formatNumber} />
                        <Tooltip
                          contentStyle={{ border: '1px solid #eee9eb', borderRadius: 12, boxShadow: '0 10px 30px #2b18200f', fontSize: 12 }}
                          formatter={(value) => [formatNumber(value), activeMetric.label]}
                          labelFormatter={(label, payload) => payload?.[0]?.payload?.date ? dateLabel(payload[0].payload.date, true) : label}
                        />
                        <Area type="monotone" dataKey={metric} stroke={activeMetric.color} strokeWidth={2.5} fill="url(#metricFill)" activeDot={{ r: 5, strokeWidth: 0 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="chart-empty">No daily metrics for this date range yet.</div>}
              </section>

              <section className="panel comparison-panel">
                <div className="panel-heading">
                  <div>
                    <div className="section-title-row"><h2>Smart performance comparison</h2><span className="live-tag"><span /> AUTO-UPDATED</span></div>
                    <p className="panel-subtitle">Latest 7 tracked days compared with the 7 before them.</p>
                  </div>
                  {weeklyComparison.enoughData && (
                    <span className={`comparison-badge ${engagementChange < 0 ? 'is-down' : 'is-up'}`}>
                      {engagementChange < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
                      {engagementChange === null ? 'New activity' : `${engagementChange > 0 ? '+' : ''}${engagementChange}% engagement`}
                    </span>
                  )}
                </div>

                <div className="weekly-pulse">
                  <span className="pulse-icon"><Sparkles size={16} /></span>
                  <div><strong>Weekly readout</strong><p>{weeklyPulse}</p></div>
                </div>

                <div className="comparison-grid">
                  {weeklyComparison.metrics.map((item) => {
                    const maxValue = Math.max(item.current, item.previous, 1);
                    return (
                      <article className="comparison-item" key={item.id}>
                        <div className="comparison-item-heading">
                          <span><span className="metric-tab-dot" style={{ backgroundColor: item.color }} />{item.label}</span>
                          <strong className={item.change === null ? 'change-neutral' : item.change < 0 ? 'change-negative' : item.change > 0 ? 'change-positive' : 'change-neutral'}>
                            {item.change === null ? 'New' : `${item.change > 0 ? '+' : ''}${item.change}%`}
                          </strong>
                        </div>
                        <div className="compare-bar-row"><span>Now</span><div className="compare-track"><i className="compare-fill current-fill" style={{ width: `${(item.current / maxValue) * 100}%`, backgroundColor: item.color }} /></div><b>{formatNumber(item.current)}</b></div>
                        <div className="compare-bar-row"><span>Before</span><div className="compare-track"><i className="compare-fill previous-fill" style={{ width: `${(item.previous / maxValue) * 100}%` }} /></div><b>{formatNumber(item.previous)}</b></div>
                      </article>
                    );
                  })}
                </div>
                {!weeklyComparison.enoughData && <p className="comparison-footnote">The comparison uses available daily records and will become more useful as more data is collected.</p>}
              </section>

              <section className="lower-grid">
                <article className="panel ai-panel">
                  <div className="ai-orb"><Sparkles size={20} /></div>
                  <div className="ai-content">
                    <p className="eyebrow">YOUR CREATIVE SIDEKICK</p>
                    <h2>A little insight goes a long way.</h2>
                    <p className="panel-subtitle">Get practical growth ideas based on your Pinterest analytics.</p>
                    <button className="button button-primary" onClick={handleGenerateInsights} disabled={loadingInsights || loading}>
                      {loadingInsights ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                      {loadingInsights ? 'Finding insights…' : 'Generate insights'}
                    </button>
                    {insightError && <p className="insight-error" role="alert">{insightError}</p>}
                    {insights && <div className="insight-result">{insights}</div>}
                  </div>
                  <div className="ai-decoration ai-decoration-one" />
                  <div className="ai-decoration ai-decoration-two" />
                </article>
                <article className="panel quick-stats">
                  <div className="panel-heading compact-heading">
                    <div><h2>At a glance</h2><p className="panel-subtitle">Your content snapshot</p></div>
                  </div>
                  <div className="quick-stat-row"><span><Pin size={16} /> Pins published</span><strong>{formatNumber(profile.pinCount ?? pins.length)}</strong></div>
                  <div className="quick-stat-row"><span><Bookmark size={16} /> Boards</span><strong>{formatNumber(profile.boardCount)}</strong></div>
                  <div className="quick-stat-row"><span><UsersRound size={16} /> Followers</span><strong>{formatNumber(profile.followers)}</strong></div>
                  <div className="quick-stat-row"><span><Eye size={16} /> Best day</span><strong>{dateLabel(data.bestPerformingDay?.date)}</strong></div>
                  <div className="quick-stat-note"><ArrowDownRight size={15} /> Keep sharing consistently to build momentum.</div>
                </article>
              </section>

              <section className="intelligence-grid">
                <article className="panel planner-panel">
                  <div className="panel-heading">
                    <div className="planner-heading">
                      <span className="planner-icon"><CalendarDays size={18} /></span>
                      <div><p className="eyebrow">PLAN YOUR NEXT WEEK</p><h2>Content strategy planner</h2></div>
                    </div>
                  </div>
                  <p className="panel-subtitle planner-description">A practical 7-day plan tailored to your performance and top Pins.</p>
                  <button className="button button-primary" onClick={handleGeneratePlan} disabled={loadingPlan || loading}>
                    {loadingPlan ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                    {loadingPlan ? 'Building your plan…' : 'Create my weekly plan'}
                  </button>
                  {planError && <p className="insight-error" role="alert">{planError}</p>}
                  {contentPlan
                    ? <div className="plan-result">{contentPlan}</div>
                    : <div className="planner-placeholder"><Lightbulb size={15} /><span>Your plan will use the Pin themes and metrics available in your connected data.</span></div>}
                </article>

                <article className="panel assistant-panel">
                  <div className="assistant-heading">
                    <span className="assistant-icon"><MessageCircle size={18} /></span>
                    <div><p className="eyebrow">ASK YOUR ANALYTICS</p><h2>Talk to your data</h2></div>
                    <span className="assistant-status"><i /> DATA-BASED</span>
                  </div>
                  <div className="assistant-messages" aria-live="polite">
                    {assistantMessages.length === 0 ? (
                      <div className="assistant-welcome">
                        <p>Ask a question about your Pinterest performance. I’ll use your connected analytics and flag when there isn’t enough data.</p>
                        <div className="suggested-questions">
                          {['Why did my engagement drop this week?', 'What should I post more of?', 'Which Pins are performing best?'].map((question) => (
                            <button key={question} onClick={() => handleAskAssistant(question)} disabled={askingAssistant}>{question}</button>
                          ))}
                        </div>
                      </div>
                    ) : assistantMessages.map((message, index) => (
                      <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                        <span className="chat-message-avatar">{message.role === 'assistant' ? <Sparkles size={12} /> : 'Y'}</span>
                        <p>{message.text}</p>
                      </div>
                    ))}
                    {askingAssistant && <div className="assistant-thinking"><LoaderCircle className="spin" size={14} /> Checking your analytics…</div>}
                  </div>
                  {assistantError && <p className="insight-error assistant-error" role="alert">{assistantError}</p>}
                  <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); handleAskAssistant(); }}>
                    <input
                      aria-label="Ask a question about your Pinterest data"
                      maxLength={1000}
                      placeholder="Ask why engagement changed…"
                      value={assistantInput}
                      onChange={(event) => setAssistantInput(event.target.value)}
                      disabled={askingAssistant}
                    />
                    <button className="send-button" type="submit" disabled={askingAssistant || !assistantInput.trim()} aria-label="Send question">
                      {askingAssistant ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                    </button>
                  </form>
                  <p className="assistant-disclaimer">Answers are based on available data; correlations don’t prove causes.</p>
                </article>
              </section>

              <section className="panel pins-panel" id="top-pins">
                <div className="panel-heading">
                  <div><h2>Your top Pins</h2><p className="panel-subtitle">The ideas getting the most attention.</p></div>
                  <span className="pin-count-label">{pins.length} {pins.length === 1 ? 'Pin' : 'Pins'}</span>
                </div>
                {pins.length ? (
                  <div className="pins-grid">
                    {pins.slice(0, 6).map((item, index) => (
                      <article className="pin-card" key={item.id || `${item.title}-${index}`}>
                        <div className="pin-image-wrap">
                          {item.image ? <img src={item.image} alt="" loading="lazy" /> : <div className={`pin-placeholder pin-placeholder-${index % 4}`}><Pin size={25} /></div>}
                          <span className="pin-rank">#{index + 1}</span>
                        </div>
                        <div className="pin-card-content">
                          <h3 title={item.title}>{item.title || 'Untitled Pin'}</h3>
                          {item.analyticsError ? <p className="pin-unavailable">Pin analytics unavailable</p> : (
                            <div className="pin-metrics">
                              <span><Eye size={13} /> {formatNumber(item.totalImpressions)}</span>
                              <span><Bookmark size={13} /> {formatNumber(item.totalSaves)}</span>
                              <span><MousePointer2 size={13} /> {formatNumber(item.totalClicks)}</span>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <div className="pins-empty">{data.mode === 'LIVE_MCP' ? 'No recent Pins were returned for this account.' : 'Pin-level details are available when connected to live Pinterest data.'}</div>}
              </section>

              <footer className="page-footer">
                <span>Analytics provided by Pinterest</span>
                <span className="footer-source"><span className={`connection-dot ${data.mode === 'LIVE_MCP' ? 'is-live' : 'is-csv'}`} />{dataMode}</span>
              </footer>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
