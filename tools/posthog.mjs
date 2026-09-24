#!/usr/bin/env node
// Sets up the PostHog project the plan's §2.3 acceptance asks for: one dashboard, the insights that answer the iteration 2
// question, and the project setting that discards client IPs. Idempotent: an insight or dashboard with the same name is
// updated in place, so the dashboard is defined here and re-applied, never hand-edited into drift.
//
//   POSTHOG_API_KEY=phx_... node tools/posthog.mjs            # apply
//   node tools/posthog.mjs --dry-run                          # print what would be created, no key needed
//
// The key is a personal API key (Settings → User → Personal API keys) with the scopes insight:write, dashboard:write,
// project:read and project:write. POSTHOG_HOST defaults to the US cloud's private API host; POSTHOG_PROJECT_ID to the key's
// current project. Every insight is filtered on channel = live, so play on /test/ never enters the numbers.

const HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const KEY = process.env.POSTHOG_API_KEY || '';
const DRY = process.argv.includes('--dry-run');

const live = { type: 'event', key: 'channel', operator: 'exact', value: ['live'] };
const prop = (key, operator, value) => ({ type: 'event', key, operator, ...(value === undefined ? {} : { value: Array.isArray(value) ? value : [String(value)] }) });
const ev = (event, properties, extra) => ({ kind: 'EventsNode', event, name: event, math: 'total', ...(properties ? { properties } : {}), ...(extra || {}) });
const range = { date_from: '-30d' };
const viz = (source) => ({ kind: 'InsightVizNode', source });

const INSIGHTS = [
  {
    name: 'Retention: day 1 to day 7',
    description: 'New players (first ever session_start) who open the game again on each of the next seven days. The iteration 2 gate reads D1 and D7 from the portal cohort here.',
    query: viz({ kind: 'RetentionQuery', dateRange: range, properties: [live],
      retentionFilter: { retentionType: 'retention_first_time', period: 'Day', totalIntervals: 8,
        targetEntity: { id: 'session_start', type: 'events' }, returningEntity: { id: 'session_start', type: 'events' } } }),
  },
  {
    name: 'Retention: came back for the chapters',
    description: 'Same cohort, but a return only counts if the player started a curated level that day. Read against the daily variant: the roadmap warns the daily can flatter D1 while the curve decides D7.',
    query: viz({ kind: 'RetentionQuery', dateRange: range, properties: [live],
      retentionFilter: { retentionType: 'retention_first_time', period: 'Day', totalIntervals: 8,
        targetEntity: { id: 'session_start', type: 'events' }, returningEntity: { id: 'level_start', type: 'events', properties: [prop('levelNo', 'is_set')] } } }),
  },
  {
    name: 'Retention: came back for the daily',
    description: 'Same cohort, a return counted only when the player started that day\'s daily.',
    query: viz({ kind: 'RetentionQuery', dateRange: range, properties: [live],
      retentionFilter: { retentionType: 'retention_first_time', period: 'Day', totalIntervals: 8,
        targetEntity: { id: 'session_start', type: 'events' }, returningEntity: { id: 'level_start', type: 'events', properties: [prop('daily', 'is_set')] } } }),
  },
  {
    name: 'Level funnel: start to win, by level',
    description: 'Plays that start a curated level and win it, one bar per level number, aggregated by the play id rather than by person so a retry is its own play. The step where the curve breaks is the level to look at.',
    query: viz({ kind: 'FunnelsQuery', dateRange: range, properties: [live],
      series: [ev('level_start', [prop('levelNo', 'is_set')]), ev('level_end', [prop('result', 'exact', 'won')])],
      breakdownFilter: { breakdown: 'levelNo', breakdown_type: 'event', breakdown_limit: 40 },
      funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: 1, funnelWindowIntervalUnit: 'hour', funnelAggregateByHogQL: 'properties.play' } }),
  },
  {
    name: 'Continue take-rate',
    description: 'level_continue over the failures that offered it (level_end where result = failed and continuesUsed = 0). This number decides whether "+1 box" can carry a rewarded ad in iteration 3.',
    query: viz({ kind: 'TrendsQuery', dateRange: range, properties: [live], interval: 'week',
      series: [ev('level_continue'), ev('level_end', [prop('result', 'exact', 'failed'), prop('continuesUsed', 'exact', 0)])],
      trendsFilter: { formula: 'A/B', display: 'ActionsLineGraph', aggregationAxisFormat: 'percentage_scaled' } }),
  },
  {
    name: 'Continue: offered, taken, then won',
    description: 'The three counts behind the take-rate, so a rate on a small base is read for what it is: failures that offered the continue, continues taken, and continued plays that went on to win.',
    query: viz({ kind: 'TrendsQuery', dateRange: range, properties: [live], interval: 'day',
      series: [ev('level_end', [prop('result', 'exact', 'failed'), prop('continuesUsed', 'exact', 0)]), ev('level_continue'), ev('level_end', [prop('result', 'exact', 'won'), prop('continuesUsed', 'exact', 1)])],
      trendsFilter: { display: 'ActionsLineGraph' } }),
  },
  {
    name: 'Daily: plays, wins, shares',
    description: 'Daily-level plays ending, first-try or not, wins, and shares pressed. A share is the loop the "collectible, shareable" claim rests on.',
    query: viz({ kind: 'TrendsQuery', dateRange: range, properties: [live], interval: 'day',
      series: [ev('level_end', [prop('daily', 'is_set')]), ev('level_end', [prop('daily', 'is_set'), prop('result', 'exact', 'won')]), ev('daily_share')],
      trendsFilter: { display: 'ActionsLineGraph' } }),
  },
  {
    name: 'Sessions and installs',
    description: 'Sessions a day, unique devices a day, and home-screen installs. The denominator for everything above.',
    query: viz({ kind: 'TrendsQuery', dateRange: range, properties: [live], interval: 'day',
      series: [ev('session_start'), ev('session_start', null, { math: 'dau' }), ev('install')],
      trendsFilter: { display: 'ActionsLineGraph' } }),
  },
];
const DASHBOARD = { name: 'Shelf Control', description: 'Iteration 2: do strangers come back? Every insight is filtered to channel = live. Defined in tools/posthog.mjs; re-run it rather than editing here.' };

async function api(method, path, body) {
  const r = await fetch(HOST + path, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${(json && (json.detail || json.error)) || text.slice(0, 300)}`);
  return json;
}
async function all(path) { const out = []; let next = HOST + path; while (next) { const page = await api('GET', next.replace(HOST, '')); out.push(...(page.results || [])); next = page.next; } return out; }

async function main() {
  if (DRY) {
    console.log(`dry run: would apply to ${HOST}\n`);
    console.log(`dashboard "${DASHBOARD.name}"`);
    for (const i of INSIGHTS) console.log(`\n${i.name}\n  ${i.description}\n  ${JSON.stringify(i.query.source)}`);
    console.log('\nproject: anonymize_ips = true');
    return;
  }
  if (!KEY.startsWith('phx_')) { console.error('POSTHOG_API_KEY must be a personal API key (phx_...). See the header of this file.'); process.exit(2); }
  const project = process.env.POSTHOG_PROJECT_ID ? await api('GET', `/api/projects/${process.env.POSTHOG_PROJECT_ID}/`) : await api('GET', '/api/projects/@current/');
  const P = `/api/projects/${project.id}`;
  console.log(`project ${project.id} "${project.name}" on ${HOST}`);

  const dashboards = await all(`${P}/dashboards/?limit=100`);
  let dash = dashboards.find(d => d.name === DASHBOARD.name && !d.deleted);
  if (dash) { dash = await api('PATCH', `${P}/dashboards/${dash.id}/`, { description: DASHBOARD.description }); console.log(`dashboard "${dash.name}" (#${dash.id}) kept`); }
  else { dash = await api('POST', `${P}/dashboards/`, DASHBOARD); console.log(`dashboard "${dash.name}" (#${dash.id}) created`); }

  const existing = await all(`${P}/insights/?limit=100&saved=true`);
  for (const spec of INSIGHTS) {
    const body = { name: spec.name, description: spec.description, query: spec.query, saved: true };
    const found = existing.find(i => i.name === spec.name && !i.deleted);
    if (found) {
      const dashIds = new Set([...(found.dashboards || []), dash.id]);
      await api('PATCH', `${P}/insights/${found.id}/`, { ...body, dashboards: [...dashIds] });
      console.log(`  updated  ${spec.name}`);
    } else {
      await api('POST', `${P}/insights/`, { ...body, dashboards: [dash.id] });
      console.log(`  created  ${spec.name}`);
    }
  }
  if (project.anonymize_ips) console.log('project: client IPs already discarded');
  else { await api('PATCH', `${P}/`, { anonymize_ips: true }); console.log('project: client IPs now discarded'); }
  console.log(`\ndone: ${HOST}/project/${project.id}/dashboard/${dash.id}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
