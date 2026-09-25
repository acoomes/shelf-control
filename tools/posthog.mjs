#!/usr/bin/env node
// Sets up the PostHog project the plan's §2.3 acceptance asks for: one dashboard, the insights that answer the iteration 2
// question, and the project setting that discards client IPs. Idempotent: an insight or dashboard with the same name is
// updated in place, so the dashboard is defined here and re-applied, never hand-edited into drift.
//
//   POSTHOG_API_KEY=phx_... node tools/posthog.mjs            # apply
//   node tools/posthog.mjs --dry-run                          # print what would be created, no key needed
//
// The key is a personal API key (Settings → User → Personal API keys) with the scopes insight:write, dashboard:write,
// project:read and project:write. POSTHOG_HOST defaults to the US cloud's private API host. POSTHOG_PROJECT_ID is the
// project's numeric id from its PostHog URL; by hand it may be left out (the key owner's current project is used), under
// automation (GITHUB_ACTIONS) it is required, so a run never lands in whichever project someone last had open. Every
// insight is filtered on channel = live, so play on /test/ never enters the numbers.
//
// The iteration 2 gate reads D1 and D7 from the portal cohort, not from all live traffic (friends, communities and the
// developer arrive on live too). Once the portal is chosen, POSTHOG_PORTAL_HOSTS names its referrer host(s), comma separated
// (the game records the referrer's host only), and the gate insight is added: a cohort of players whose first session was
// referred from there. Without it the script says so and builds the rest.

const HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const KEY = process.env.POSTHOG_API_KEY || '';
const DRY = process.argv.includes('--dry-run');
const PORTAL_HOSTS = (process.env.POSTHOG_PORTAL_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);

const live = { type: 'event', key: 'channel', operator: 'exact', value: ['live'] };
const prop = (key, operator, value) => ({ type: 'event', key, operator, ...(value === undefined ? {} : { value: Array.isArray(value) ? value : [String(value)] }) });
const ev = (event, properties, extra) => ({ kind: 'EventsNode', event, name: event, math: 'total', ...(properties ? { properties } : {}), ...(extra || {}) });
const range = { date_from: '-30d' };
const viz = (source) => ({ kind: 'InsightVizNode', source });

const retention = (target, returning) => viz({ kind: 'RetentionQuery', dateRange: range, properties: [live],
  retentionFilter: { retentionType: 'retention_first_time', period: 'Day', totalIntervals: 8, targetEntity: target, returningEntity: returning } });
// Two questions need a row per play or per player rather than a count of events, which property filters cannot express:
// a play's terminal outcome (a continued play reports two endings) and a player's mode (daily only, chapters only, both).
// Those are SQL insights over the events table (HogQL), editable in place if a column needs changing.
const sql = (query) => ({ kind: 'DataTableNode', full: true, source: { kind: 'HogQLQuery', query: query.trim() } });
const LEVEL_OUTCOMES = `
SELECT levelNo,
  count() AS started,
  countIf(outcome = 'won') AS won,
  countIf(outcome = 'failed') AS failed,
  count() - countIf(outcome = 'won') - countIf(outcome = 'failed') AS abandoned,
  round(100 * countIf(outcome = 'won') / count(), 1) AS win_pct
FROM (
  SELECT properties.play AS play,
    max(toInt64OrNull(toString(properties.levelNo))) AS levelNo,
    argMax(properties.result, multiIf(event = 'level_end', toUnixTimestamp(timestamp), 0)) AS outcome
  FROM events
  WHERE properties.channel = 'live' AND event IN ('level_start', 'level_end')
    AND properties.levelNo IS NOT NULL AND properties.play IS NOT NULL AND timestamp > now() - INTERVAL 30 DAY
  GROUP BY play
)
GROUP BY levelNo ORDER BY levelNo`;
// A cohort retention table. Each device's first live session comes from its complete history (never a rolling window, or
// an old player whose first session aged out would be minted as new), what a player is counted as is frozen on that first
// day (never re-classified by what they did later, which would move retained crossovers between cohorts), and only the
// reporting cohort is date-bounded. D1 and D7 are shares of the players old enough to have had that day.
const retentionTable = (cohortExpr) => `
WITH firsts AS (
  SELECT distinct_id, min(toDate(timestamp)) AS first_day, argMin(properties.referrer, timestamp) AS first_referrer
  FROM events
  WHERE properties.channel = 'live' AND event = 'session_start'
  GROUP BY distinct_id
),
day0 AS (
  SELECT e.distinct_id AS distinct_id,
    countIf(e.properties.levelNo IS NOT NULL) > 0 AS chapters,
    countIf(e.properties.daily IS NOT NULL) > 0 AS daily
  FROM events AS e
  JOIN firsts AS f ON f.distinct_id = e.distinct_id
  WHERE e.properties.channel = 'live' AND e.event = 'level_start' AND toDate(e.timestamp) = f.first_day
  GROUP BY e.distinct_id
),
returns AS (
  SELECT distinct_id, toDate(timestamp) AS day
  FROM events
  WHERE properties.channel = 'live' AND event = 'session_start'
  GROUP BY distinct_id, day
),
players AS (
  SELECT f.distinct_id AS distinct_id, f.first_day AS first_day, f.first_referrer AS first_referrer,
    coalesce(d.chapters, 0) AS chapters, coalesce(d.daily, 0) AS daily,
    max(if(r.day = f.first_day + 1, 1, 0)) AS d1,
    max(if(r.day = f.first_day + 7, 1, 0)) AS d7
  FROM firsts AS f
  LEFT JOIN day0 AS d ON d.distinct_id = f.distinct_id
  LEFT JOIN returns AS r ON r.distinct_id = f.distinct_id
  WHERE f.first_day >= today() - 30
  GROUP BY f.distinct_id, f.first_day, f.first_referrer, d.chapters, d.daily
)
SELECT ${cohortExpr} AS cohort,
  count() AS players,
  countIf(first_day <= today() - 1) AS d1_base,
  if(countIf(first_day <= today() - 1) = 0, 0, round(100 * countIf(d1 = 1) / countIf(first_day <= today() - 1), 1)) AS d1_pct,
  countIf(first_day <= today() - 7) AS d7_base,
  if(countIf(first_day <= today() - 7) = 0, 0, round(100 * countIf(d7 = 1) / countIf(first_day <= today() - 7), 1)) AS d7_pct
FROM players
GROUP BY cohort ORDER BY players DESC`;
const MODE_COHORTS = retentionTable(`multiIf(daily AND NOT chapters, 'daily only', chapters AND NOT daily, 'chapters only', chapters AND daily, 'both', 'sessions only')`);
const PORTAL_COHORT = () => retentionTable(`if(first_referrer IN (${PORTAL_HOSTS.map(h => `'${h.replace(/'/g, "\\'")}'`).join(', ')}), 'portal', 'elsewhere')`);
const INSIGHTS = [
  ...(PORTAL_HOSTS.length ? [{
    name: 'Retention: portal cohort (the gate)',
    description: `New players whose first ever live session was referred from ${PORTAL_HOSTS.join(' or ')}, against everyone else, with D1 and D7 as a share of the players old enough to have had that day. The iteration 2 gate: D1 at or above 25 % and D7 at or above 8 % on the portal row. The first session is taken from complete history, so a player who arrived from elsewhere first and found the portal later is not in the row.`,
    query: sql(PORTAL_COHORT()),
  }] : []),
  {
    name: 'Retention: all live players, day 1 to day 7',
    description: 'Every new player on the live build (first ever session_start), whatever brought them, who opens the game again on each of the next seven days. Context for the gate, not the gate: friends, communities and the developer arrive on live too.',
    query: retention({ id: 'session_start', type: 'events' }, { id: 'session_start', type: 'events' }),
  },
  {
    name: 'Retention: chapter players',
    description: 'Cohort: players by the day of their first curated-level play. Return: any later session. Read against the daily players\' curve: the roadmap warns the daily can flatter D1 while the curve decides D7. A player who does both is in both cohorts; the mode table below separates them.',
    query: retention({ id: 'level_start', type: 'events', properties: [prop('levelNo', 'is_set')] }, { id: 'session_start', type: 'events' }),
  },
  {
    name: 'Retention: daily players',
    description: 'Cohort: players by the day of their first daily play. Return: any later session.',
    query: retention({ id: 'level_start', type: 'events', properties: [prop('daily', 'is_set')] }, { id: 'session_start', type: 'events' }),
  },
  {
    name: 'Retention by mode: daily only, chapters only, both',
    description: 'Each new live player in exactly one cohort by what they played on their first day (frozen there: a daily player who tries the chapters on day 3 stays a daily player), with D1 and D7 as a share of the players old enough to have had that day. This is the roadmap\'s daily-only versus chapter comparison; the two retention curves above overlap, this table does not.',
    query: sql(MODE_COHORTS),
  },
  {
    name: 'Level funnel: start to win, by level',
    description: 'Plays that start a curated level and win it, one bar per level number, aggregated by the play id rather than by person so a retry is its own play. The step where the curve breaks is the level to look at; "Level outcomes" below says whether the drop was a loss or a walk-away.',
    query: viz({ kind: 'FunnelsQuery', dateRange: range, properties: [live],
      series: [ev('level_start', [prop('levelNo', 'is_set')]), ev('level_end', [prop('result', 'exact', 'won')])],
      breakdownFilter: { breakdown: 'levelNo', breakdown_type: 'event', breakdown_limit: 40 },
      funnelsFilter: { funnelVizType: 'steps', funnelWindowInterval: 1, funnelWindowIntervalUnit: 'hour', funnelAggregateByHogQL: 'properties.play' } }),
  },
  {
    name: 'Level outcomes by level: started, won, failed, abandoned',
    description: 'One row per level number, one count per play: its terminal outcome is the last level_end it reported, so a continued play counts once, as whatever it ended on. Abandoned is a play with no ending at all: the player left mid-level, which the funnel alone cannot tell from a loss.',
    query: sql(LEVEL_OUTCOMES),
  },
  {
    name: 'Auto-finish: share of wins it played out',
    description: 'Wins whose ending the game played by itself (autoLoops above 0) over all wins. Auto-finish is on by default and the settings toggle is not an event, so this is usage, not preference: how often a win reaches the assured ending it was built for.',
    query: viz({ kind: 'TrendsQuery', dateRange: range, properties: [live], interval: 'week',
      series: [ev('level_end', [prop('result', 'exact', 'won'), prop('autoLoops', 'gt', 0)]), ev('level_end', [prop('result', 'exact', 'won')])],
      trendsFilter: { formula: 'A/B', display: 'ActionsLineGraph', aggregationAxisFormat: 'percentage_scaled' } }),
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
    description: 'Daily plays started (one per play, retries included; a play\'s start is counted rather than its endings, since a continued play reports two), daily wins, and shares pressed. A share is the loop the "collectible, shareable" claim rests on.',
    query: viz({ kind: 'TrendsQuery', dateRange: range, properties: [live], interval: 'day',
      series: [ev('level_start', [prop('daily', 'is_set')]), ev('level_end', [prop('daily', 'is_set'), prop('result', 'exact', 'won')]), ev('daily_share')],
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
  if (!PORTAL_HOSTS.length) console.log('POSTHOG_PORTAL_HOSTS is not set: the portal-cohort retention insight (the gate) is skipped until the portal is chosen.\n');
  if (DRY) {
    console.log(`dry run: would apply to ${HOST}\n`);
    console.log(`dashboard "${DASHBOARD.name}"`);
    for (const i of INSIGHTS) console.log(`\n${i.name}\n  ${i.description}\n  ${i.query.source.kind === 'HogQLQuery' ? i.query.source.query : JSON.stringify(i.query.source)}`);
    console.log('\nproject: anonymize_ips = true');
    return;
  }
  if (!KEY.startsWith('phx_')) { console.error('POSTHOG_API_KEY must be a personal API key (phx_...). See the header of this file.'); process.exit(2); }
  const PROJECT_ID = (process.env.POSTHOG_PROJECT_ID || '').trim();
  if (process.env.GITHUB_ACTIONS && !/^\d+$/.test(PROJECT_ID)) { console.error('POSTHOG_PROJECT_ID must be the project\'s numeric id (from its PostHog URL) when run by automation. See the header of this file.'); process.exit(2); }
  const project = PROJECT_ID ? await api('GET', `/api/projects/${PROJECT_ID}/`) : await api('GET', '/api/projects/@current/');
  if (!PROJECT_ID) console.log(`POSTHOG_PROJECT_ID is not set: using the key owner's current project, ${project.id}.`);
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
