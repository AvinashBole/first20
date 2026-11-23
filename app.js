/* First 20 Hours — practice cockpit for Josh Kaufman's rapid skill acquisition method.
   All data stays in this browser's localStorage. No network calls (CSP connect-src 'none').
   AI planning and review happen in Claude Code via the /learn skill:
     plan in  -> URL fragment #import=<base64url JSON>  (fragments are never sent to the server)
     data out -> "Export for Claude" copies JSON to the clipboard; /learn review reads it. */
'use strict';

const KEY = 'first20.v1';
const SVGNS = 'http://www.w3.org/2000/svg';
let db = load();
let state = { view: 'home', planId: null, flash: null };
let timerHandle = null;

// ---------- storage ----------
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.plans) return Object.assign({ plans: {}, sessions: [], research: [], active: null }, d);
  } catch (e) { /* fall through */ }
  return { plans: {}, sessions: [], research: [], active: null };
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }

// ---------- DOM helpers (textContent only: imported text is never parsed as HTML) ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, kids);
  return el;
}
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs);
  append(el, kids);
  return el;
}
function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'width%') el.style.width = v + '%';
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function safeUrl(u) {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch (e) { return null; }
}
const str = (v, max = 600) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtH = (sec) => (sec / 3600).toFixed(1);
const fmtClock = (sec) => { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60), x = sec % 60; return `${m}:${String(x).padStart(2, '0')}`; };
const today = () => new Date().toISOString().slice(0, 10);
const dayOf = (iso) => (iso || '').slice(0, 10);

// ---------- plan validation (whitelist fields; AI-generated input is untrusted data) ----------
function cleanPlan(p) {
  if (!p || typeof p !== 'object') throw new Error('Not a JSON object');
  const id = str(p.id, 60);
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(id)) throw new Error('plan.id must be a lowercase slug');
  if (!str(p.skill)) throw new Error('plan.skill missing');
  if (!Array.isArray(p.subskills) || !p.subskills.length) throw new Error('plan.subskills must be a non-empty array');
  const subskills = p.subskills.slice(0, 20).map((x, i) => {
    const sid = str(x.id, 40);
    if (!sid || !str(x.name)) throw new Error(`subskill ${i + 1} needs id and name`);
    const m = x.metric || {};
    return {
      id: sid, name: str(x.name, 120), priority: num(x.priority, i + 1), why: str(x.why), drill: str(x.drill, 1200),
      metric: { name: str(m.name, 80) || 'score', unit: str(m.unit, 20), target: m.target === undefined || m.target === null ? null : num(m.target, null), higherIsBetter: m.higherIsBetter !== false },
      selfCheck: (Array.isArray(x.selfCheck) ? x.selfCheck : []).slice(0, 10).map((c) => str(c, 240)).filter(Boolean),
      errorTags: (Array.isArray(x.errorTags) ? x.errorTags : []).slice(0, 8).map((c) => str(c, 30)).filter(Boolean),
    };
  });
  const ids = new Set(subskills.map((x) => x.id));
  return {
    kind: 'first20-plan', version: 1, id, skill: str(p.skill, 120), createdAt: str(p.createdAt, 30) || today(),
    targetPerformance: str(p.targetPerformance, 600),
    sessionMinutes: Math.min(180, Math.max(10, num(p.sessionMinutes, 45))),
    totalHours: Math.min(200, Math.max(1, num(p.totalHours, 20))),
    researchCapMinutes: Math.min(600, Math.max(0, num(p.researchCapMinutes, 120))),
    subskills,
    resources: (Array.isArray(p.resources) ? p.resources : []).slice(0, 5).map((r) => ({ title: str(r.title, 160), url: safeUrl(r.url), use: str(r.use, 300) })),
    barriers: (Array.isArray(p.barriers) ? p.barriers : []).slice(0, 10).map((b) => str(b, 160)).filter(Boolean),
    schedule: (Array.isArray(p.schedule) ? p.schedule : []).slice(0, 120).map((b, i) => ({
      block: num(b.block, i + 1), subskill: ids.has(b.subskill) ? b.subskill : subskills[0].id, focus: str(b.focus, 300),
    })),
    feedback: (Array.isArray(p.feedback) ? p.feedback : []).slice(-20).map((f) => ({
      date: str(f.date, 30), summary: str(f.summary, 1500),
      actions: (Array.isArray(f.actions) ? f.actions : []).slice(0, 8).map((a) => str(a, 300)),
      focusNext: ids.has(f.focusNext) ? f.focusNext : null,
    })),
  };
}
function cleanRecord(r, kind) {
  if (!r || typeof r !== 'object' || !str(r.id, 40) || !db.plans[r.planId]) return null;
  if (kind === 'research') return { id: str(r.id, 40), planId: r.planId, startedAt: str(r.startedAt, 30), sec: num(r.sec, 0), note: str(r.note) };
  return {
    id: str(r.id, 40), planId: r.planId, block: num(r.block, 0), subskill: str(r.subskill, 40),
    startedAt: str(r.startedAt, 30), endedAt: str(r.endedAt, 30), plannedMin: num(r.plannedMin, 0),
    practiceSec: num(r.practiceSec, 0), pauses: num(r.pauses, 0), distractions: num(r.distractions, 0),
    barriersCleared: num(r.barriersCleared, 0), barriersTotal: num(r.barriersTotal, 0),
    reps: (Array.isArray(r.reps) ? r.reps : []).slice(0, 2000).map((x) => ({ t: num(x.t, 0), ok: !!x.ok, tag: str(x.tag, 30) || null })),
    metric: r.metric === null || r.metric === undefined || r.metric === '' ? null : num(r.metric, null),
    frustration: num(r.frustration, null), note: str(r.note),
  };
}

// ---------- import / export ----------
function decodeB64Url(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function importData(obj) {
  const isExport = obj && obj.kind === 'first20-export';
  const plan = cleanPlan(isExport ? obj.plan : obj);
  const existed = !!db.plans[plan.id];
  db.plans[plan.id] = plan;
  let added = 0;
  if (isExport) {
    const have = new Set([...db.sessions, ...db.research].map((x) => x.id));
    for (const r of obj.sessions || []) { const c = cleanRecord(r, 'session'); if (c && !have.has(c.id)) { db.sessions.push(c); added++; } }
    for (const r of obj.research || []) { const c = cleanRecord(r, 'research'); if (c && !have.has(c.id)) { db.research.push(c); added++; } }
  }
  save();
  toast(existed ? `Plan "${plan.skill}" updated — your sessions are kept${added ? `, +${added} records` : ''}` : `Plan "${plan.skill}" imported`);
  return plan.id;
}
function buildExport(planId) {
  const plan = db.plans[planId];
  const st = stats(plan);
  return {
    kind: 'first20-export', version: 1, exportedAt: new Date().toISOString(), plan,
    sessions: db.sessions.filter((x) => x.planId === planId),
    research: db.research.filter((x) => x.planId === planId),
    computed: {
      practiceHours: +fmtH(st.practiceSec), researchMinutes: Math.round(st.researchSec / 60), sessions: st.sessions.length,
      perSubskill: plan.subskills.map((x) => { const p = st.per[x.id]; return { id: x.id, minutes: Math.round(p.sec / 60), sessions: p.n, accuracy: p.acc, metricSeries: p.metrics.map((m) => m.v), topErrors: p.topErrors }; }),
      flags: insights(plan, st).map((f) => `${f.level}: ${f.text}`),
    },
  };
}
async function exportForClaude(planId) {
  const text = JSON.stringify(buildExport(planId), null, 1);
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch (e) { /* clipboard blocked */ }
  const blob = new Blob([text], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `first20-${planId}-${today()}.json` });
  if (!copied) a.click();
  toast(copied ? 'Copied. In Claude Code run:  /learn review' : 'Clipboard blocked — downloaded JSON. Run /learn review <file>');
}

// ---------- analytics ----------
function stats(plan) {
  const sessions = db.sessions.filter((x) => x.planId === plan.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const research = db.research.filter((x) => x.planId === plan.id);
  const practiceSec = sessions.reduce((a, x) => a + x.practiceSec, 0);
  const researchSec = research.reduce((a, x) => a + x.sec, 0);
  const per = {};
  for (const sk of plan.subskills) per[sk.id] = { n: 0, sec: 0, ok: 0, fail: 0, acc: null, metrics: [], accSeries: [], tags: {}, topErrors: [] };
  for (const x of sessions) {
    const p = per[x.subskill]; if (!p) continue;
    p.n++; p.sec += x.practiceSec;
    const ok = x.reps.filter((r) => r.ok).length, fail = x.reps.length - ok;
    p.ok += ok; p.fail += fail;
    if (x.reps.length >= 5) p.accSeries.push(ok / x.reps.length);
    if (x.metric !== null) p.metrics.push({ v: x.metric, label: dayOf(x.startedAt) });
    for (const r of x.reps) if (!r.ok && r.tag) p.tags[r.tag] = (p.tags[r.tag] || 0) + 1;
  }
  for (const p of Object.values(per)) {
    p.acc = p.ok + p.fail >= 5 ? Math.round((100 * p.ok) / (p.ok + p.fail)) : null;
    p.topErrors = Object.entries(p.tags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t} ×${c}`);
  }
  const days = new Set(sessions.map((x) => dayOf(x.startedAt)));
  const first = sessions[0] ? new Date(dayOf(sessions[0].startedAt)) : null;
  const spanDays = first ? Math.max(1, Math.round((Date.now() - first) / 864e5) + 1) : 0;
  const weekAgo = Date.now() - 7 * 864e5;
  const last7Sec = sessions.filter((x) => new Date(x.startedAt) > weekAgo).reduce((a, x) => a + x.practiceSec, 0);
  const pacePerDayMin = !spanDays ? 0 : spanDays >= 7 ? last7Sec / 60 / 7 : practiceSec / 60 / spanDays;
  const remainingMin = Math.max(0, plan.totalHours * 60 - practiceSec / 60);
  const lastDay = sessions.length ? dayOf(sessions[sessions.length - 1].startedAt) : null;
  const gapDays = lastDay ? Math.floor((new Date(today()) - new Date(lastDay)) / 864e5) : null;
  const nextBlockNo = sessions.length + 1;
  const nextBlock = plan.schedule.find((b) => b.block === nextBlockNo) || null;
  return { sessions, research, practiceSec, researchSec, per, days: days.size, spanDays, pacePerDayMin, remainingMin, gapDays, nextBlockNo, nextBlock };
}

// Deterministic coach: rules taken directly from the talk. Claude's /learn review goes deeper.
function insights(plan, st) {
  const out = [];
  const hrs = st.practiceSec / 3600;
  const recent = st.sessions.slice(-3);
  const add = (level, icon, text) => out.push({ level, icon, text });
  if (!st.sessions.length) add('info', 'i', 'Pre-commit: book the first 45-minute block today. Hours 0–2 are setup and feeling clumsy, which is expected.');
  if (st.gapDays !== null && st.gapDays >= 3 && hrs < plan.totalHours) add('critical', '!', `${st.gapDays} days since last session. The 20-hour pre-commitment only works if you keep going. Do a short block today, even 20 minutes.`);
  const capSec = plan.researchCapMinutes * 60;
  if (capSec && st.researchSec > capSec) add('serious', '!', `Research ${Math.round(st.researchSec / 60)} min is over the ${plan.researchCapMinutes} min cap. Learn just enough to self-correct, then practice. More reading now is procrastination.`);
  else if (st.researchSec > st.practiceSec && st.researchSec > 1800) add('warning', '!', 'You have spent more time reading than practicing. Switch to practice.');
  if (recent.length >= 2) {
    const avgD = recent.reduce((a, x) => a + x.distractions, 0) / recent.length;
    if (avgD >= 1.5) add('warning', '!', `About ${avgD.toFixed(1)} distractions per session recently. Remove the barrier at its source (phone in another room, site blocker) rather than relying on willpower.`);
    const short = recent.filter((x) => x.plannedMin && x.practiceSec < x.plannedMin * 60 * 0.7).length;
    if (short >= 2) add('warning', '!', 'Sessions keep ending early. Shorten the planned block so you can finish it; hours you actually complete matter more than ambitious plans.');
    const missed = recent.filter((x) => x.barriersTotal && x.barriersCleared < x.barriersTotal).length;
    if (missed >= 2) add('warning', '!', 'Barrier checklist skipped in recent sessions. Clear it before you start.');
  }
  const fr = st.sessions.map((x) => x.frustration).filter((x) => x);
  const lastFr = fr.slice(-2);
  if (lastFr.length && lastFr.every((x) => x >= 4)) {
    if (hrs < 10) add('info', 'i', 'High frustration in the early hours is the frustration barrier the talk describes. The obstacle is emotional, not intellectual, so keep the commitment.');
    else add('serious', '!', 'Frustration is still high after 10+ hours. The drill is probably at the wrong level. Break the sub-skill down further.');
  }
  for (const sk of plan.subskills) {
    const p = st.per[sk.id];
    const a = p.accSeries.slice(-3);
    if (a.length >= 2 && a.slice(-2).every((x) => x < 0.5)) add('serious', '!', `"${sk.name}": accuracy under 50% for 2 sessions. The piece is too big. Deconstruct it into smaller parts.`);
    if (a.length >= 3 && a.every((x) => x >= 0.9)) add('good', '✓', `"${sk.name}": accuracy at or above 90% for 3 sessions. Raise the difficulty or move to the next priority.`);
    const m = p.metrics.map((x) => x.v);
    if (m.length >= 4) {
      const better = (x, y) => (sk.metric.higherIsBetter ? x > y : x < y);
      const bestBefore = m.slice(0, -3).reduce((b, x) => (better(x, b) ? x : b));
      if (!m.slice(-3).some((x) => better(x, bestBefore))) add('warning', '!', `"${sk.name}": no new best ${sk.metric.name} in 3 sessions (plateau). Change the drill, slow it down, or check the self-correction resource.`);
    }
    if (sk.metric.target !== null && m.length && (sk.metric.higherIsBetter ? m[m.length - 1] >= sk.metric.target : m[m.length - 1] <= sk.metric.target)) add('good', '✓', `"${sk.name}" reached its target ${sk.metric.name} (${sk.metric.target}${sk.metric.unit ? ' ' + sk.metric.unit : ''}).`);
  }
  if (hrs >= 3) {
    const top = [...plan.subskills].sort((a, b) => a.priority - b.priority).slice(0, Math.max(1, Math.ceil(plan.subskills.length / 3)));
    const topSec = top.reduce((a, x) => a + st.per[x.id].sec, 0);
    if (topSec / st.practiceSec < 0.5 && hrs < 12) add('warning', '!', `Only ${Math.round((100 * topSec) / st.practiceSec)}% of practice went to the top-priority pieces. Practice the most important parts first.`);
  }
  if (hrs >= plan.totalHours) add('good', '✓', `${plan.totalHours} hours done. Test yourself against the target: "${plan.targetPerformance}".`);
  return out;
}

// ---------- charts (single series, one hue; tooltip via <title>; table view alongside) ----------
function lineChart(points, { yMin, yMax, target = null, w = 320, ht = 120, yLabel = '', mini = false } = {}) {
  const pad = mini ? { l: 5, r: 5, t: 5, b: 5 } : { l: 30, r: 8, t: 8, b: 18 };
  const vals = points.map((p) => p.v);
  if (yMin === undefined) yMin = Math.min(...vals, target ?? Infinity);
  if (yMax === undefined) yMax = Math.max(...vals, target ?? -Infinity);
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const X = (i) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (points.length - 1));
  const Y = (v) => pad.t + ((yMax - v) * (ht - pad.t - pad.b)) / (yMax - yMin);
  const svg = s('svg', { viewBox: `0 0 ${w} ${ht}`, width: mini ? w : '100%', height: mini ? ht : null, role: 'img', 'aria-label': yLabel });
  if (mini) {
    if (points.length > 1) svg.append(s('path', { class: 'ln', d: points.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.v)}`).join('') }));
    points.forEach((p, i) => svg.append(s('g', {}, s('title', {}, `${p.label}: ${p.v}`), s('circle', { class: 'hit', cx: X(i), cy: Y(p.v), r: 8 }), s('circle', { class: 'dot', cx: X(i), cy: Y(p.v), r: 3 }))));
    return svg;
  }
  svg.append(s('line', { class: 'grid', x1: pad.l, x2: w - pad.r, y1: Y(yMin), y2: Y(yMin) }));
  svg.append(s('text', { x: pad.l - 4, y: Y(yMax) + 4, 'text-anchor': 'end' }, String(+yMax.toFixed(1))));
  svg.append(s('text', { x: pad.l - 4, y: Y(yMin), 'text-anchor': 'end' }, String(+yMin.toFixed(1))));
  if (target !== null) {
    svg.append(s('line', { class: 'ref', x1: pad.l, x2: w - pad.r, y1: Y(target), y2: Y(target) }));
    svg.append(s('text', { x: w - pad.r, y: Y(target) - 3, 'text-anchor': 'end' }, `target ${target}`));
  }
  if (points.length > 1) svg.append(s('path', { class: 'ln', d: points.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.v)}`).join('') }));
  points.forEach((p, i) => {
    const g = s('g', {}, s('title', {}, `${p.label}: ${p.v}`));
    g.append(s('circle', { class: 'hit', cx: X(i), cy: Y(p.v), r: 10 }), s('circle', { class: 'dot', cx: X(i), cy: Y(p.v), r: 4 }));
    svg.append(g);
  });
  svg.append(s('text', { x: pad.l, y: ht - 4 }, points[0].label), s('text', { x: w - pad.r, y: ht - 4, 'text-anchor': 'end' }, points[points.length - 1].label));
  return svg;
}
function spark(vals) {
  if (vals.length < 2) return h('span', { class: 'muted small' }, vals.length ? String(vals[0]) : '—');
  return lineChart(vals.map((v, i) => ({ v, label: `session ${i + 1}` })), { w: 120, ht: 36, mini: true, yLabel: 'metric trend' });
}

// ---------- views ----------
function go(view, planId) {
  state.view = view; if (planId !== undefined) state.planId = planId;
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  render(); window.scrollTo(0, 0);
}
function render() {
  const app = document.getElementById('app');
  app.replaceChildren();
  const plan = db.plans[state.planId];
  if (db.active && state.view !== 'run' && state.view !== 'post' && state.view !== 'research') {
    app.append(h('div', { class: 'flag warning' }, h('span', { class: 'ico' }, '!'),
      h('span', {}, 'A session is in progress. ', h('button', { onclick: () => go(db.active.kind === 'research' ? 'research' : 'run', db.active.planId) }, 'Resume it'))));
  }
  if (state.view === 'home' || !plan) return viewHome(app);
  ({ dash: viewDash, pre: viewPre, run: viewRun, post: viewPost, research: viewResearch })[state.view](app, plan);
}

function viewHome(app) {
  const plans = Object.values(db.plans);
  app.append(h('h1', {}, 'Your skills'));
  if (!plans.length) app.append(h('p', { class: 'muted' }, 'No skills yet. In Claude Code, type /learn <skill> to generate a plan. The link it opens imports the plan here.'));
  const grid = h('div', { class: 'grid' });
  for (const p of plans) {
    const st = stats(p);
    grid.append(h('div', { class: 'card' },
      h('h2', {}, p.skill), h('p', { class: 'muted small' }, p.targetPerformance),
      h('div', { class: 'big' }, `${fmtH(st.practiceSec)} / ${p.totalHours} h`),
      h('div', { class: 'bar' }, h('span', { 'width%': Math.min(100, (100 * st.practiceSec) / 3600 / p.totalHours) })),
      h('p', {}, h('button', { class: 'primary', onclick: () => go('dash', p.id) }, 'Open'))));
  }
  app.append(grid);
  const ta = h('textarea', { placeholder: 'Paste a plan JSON (from /learn) or an export JSON to restore on this device' });
  app.append(h('div', { class: 'card', style: null },
    h('h2', {}, 'Import'),
    ta,
    h('div', { class: 'row' },
      h('button', { onclick: () => { try { go('dash', importData(JSON.parse(ta.value))); } catch (e) { toast('Import failed: ' + e.message); } } }, 'Import'),
      h('button', { onclick: () => go('dash', importData(DEMO)) }, 'Load demo: ukulele (from the talk)'))));
  app.append(h('div', { class: 'card' }, h('h2', {}, 'How the method maps to the app'),
    h('table', {}, h('tr', {}, h('th', {}, 'Talk'), h('th', {}, 'Where it lives')),
      [['1. Deconstruct: define target performance, break into pieces, most important first', '/learn <skill> generates prioritized sub-skills, each with a drill and a metric'],
       ['2. Learn enough to self-correct: 3 to 5 resources, without procrastinating', 'Up to 5 resources tied to mistake signs; research timer with a hard cap'],
       ['3. Remove barriers: distractions, tools not ready', 'Pre-session barrier checklist; distraction key D logged and coached'],
       ['4. Pre-commit to 20 hours: get past the frustration barrier', '20 h ring, pacing and ETA, gap alarms, frustration curve'],
       ['About 45 min a day for about a month', 'Default 45-minute blocks across about 27 scheduled sessions'],
       ['Ukulele: 4 chords play most songs', 'Plans are built around the few core pieces that give most of the results']]
        .map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))))));
}

function viewDash(app, plan) {
  const st = stats(plan);
  const fb = plan.feedback[plan.feedback.length - 1];
  app.append(h('div', { class: 'row spread' },
    h('div', {}, h('h1', {}, plan.skill), h('p', { class: 'muted' }, 'Target at 20 h: ', plan.targetPerformance)),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => go('pre') }, '▶ Start practice'),
      h('button', { onclick: () => go('research') }, 'Research timer'),
      h('button', { onclick: () => exportForClaude(plan.id) }, 'Export for Claude review'))));

  if (state.flash) { app.append(state.flash); state.flash = null; }

  const etaDays = st.pacePerDayMin ? Math.ceil(st.remainingMin / st.pacePerDayMin) : null;
  const grid = h('div', { class: 'grid' });
  grid.append(h('div', { class: 'card' }, h('h3', {}, 'Pre-commitment'),
    h('div', { class: 'big' }, `${fmtH(st.practiceSec)} / ${plan.totalHours} h`),
    h('div', { class: 'bar' }, h('span', { 'width%': Math.min(100, (100 * st.practiceSec) / 3600 / plan.totalHours) })),
    h('p', { class: 'small' }, `${st.sessions.length} sessions · ${st.days} practice days · pace ${Math.round(st.pacePerDayMin)} min/day`),
    h('p', { class: 'small muted' }, etaDays !== null ? `At this pace: ~${etaDays} more days. The talk's benchmark is 45 min/day, about a month.` : 'No sessions yet.')));
  const nb = st.nextBlock;
  const nbSk = plan.subskills.find((x) => x.id === (fb && fb.focusNext) ) || plan.subskills.find((x) => nb && x.id === nb.subskill);
  grid.append(h('div', { class: 'card' }, h('h3', {}, nb ? `Next: block ${st.nextBlockNo} of ${plan.schedule.length}` : `Next: session ${st.nextBlockNo} (past the schedule)`),
    h('h2', {}, nbSk ? nbSk.name : '—'), h('p', {}, nb ? nb.focus : 'Schedule complete. Practice the weakest sub-skill.'),
    fb && fb.focusNext ? h('p', { class: 'small muted' }, 'Focus set by the latest Claude review.') : null));
  grid.append(h('div', { class: 'card feedback' }, h('h3', {}, 'AI coach (latest /learn review)'),
    fb ? [h('p', { class: 'small muted' }, fb.date), h('p', {}, fb.summary), h('ul', {}, fb.actions.map((a) => h('li', {}, a)))]
       : h('p', { class: 'muted' }, 'No review yet. After 2 or 3 sessions, click "Export for Claude review", then run /learn review in Claude Code.')));
  app.append(grid);

  const flags = insights(plan, st);
  app.append(h('div', { class: 'card' }, h('h2', {}, 'Live flags'),
    flags.length ? flags.map((f) => h('div', { class: `flag ${f.level}` }, h('span', { class: 'ico', 'aria-label': f.level }, f.icon), h('span', {}, f.text)))
      : h('p', { class: 'muted' }, 'No issues. Keep practicing.')));

  const rows = [...plan.subskills].sort((a, b) => a.priority - b.priority).map((sk) => {
    const p = st.per[sk.id];
    const last = p.metrics.length ? p.metrics[p.metrics.length - 1].v : null;
    return h('tr', {},
      h('td', {}, String(sk.priority)),
      h('td', {}, h('strong', {}, sk.name), h('div', { class: 'small muted' }, sk.why)),
      h('td', {}, `${Math.round(p.sec / 60)}m / ${p.n}`),
      h('td', {}, p.acc === null ? '—' : p.acc + '%'),
      h('td', {}, last === null ? '—' : `${last}${sk.metric.target !== null ? ' → ' + sk.metric.target : ''} ${sk.metric.unit}`, h('div', { class: 'small muted' }, sk.metric.name)),
      h('td', {}, spark(p.metrics.map((m) => m.v))),
      h('td', { class: 'small' }, p.topErrors.join(', ') || '—'));
  });
  app.append(h('div', { class: 'card' }, h('h2', {}, 'Sub-skills (deconstructed, by priority)'),
    h('div', { style: null }, h('table', {}, h('tr', {}, ['#', 'Sub-skill', 'Time/sessions', 'Accuracy', 'Metric', 'Trend', 'Top errors'].map((t) => h('th', {}, t))), rows))));

  const g2 = h('div', { class: 'grid' });
  const frPts = st.sessions.filter((x) => x.frustration).map((x, i) => ({ v: x.frustration, label: `#${i + 1}` }));
  g2.append(h('div', { class: 'card' }, h('h3', {}, 'Frustration barrier (1 = calm, 5 = I feel stupid)'),
    frPts.length ? lineChart(frPts, { yMin: 1, yMax: 5, yLabel: 'Frustration per session' }) : h('p', { class: 'muted' }, 'Rated after each session.'),
    h('p', { class: 'small muted' }, 'Expect a peak early and a decline. The obstacle is emotional, not intellectual.')));
  const capPct = plan.researchCapMinutes ? (100 * st.researchSec) / 60 / plan.researchCapMinutes : 0;
  g2.append(h('div', { class: 'card' }, h('h3', {}, 'Learn enough to self-correct'),
    h('p', { class: 'small' }, `Research ${Math.round(st.researchSec / 60)} of ${plan.researchCapMinutes} min cap (does not count toward the 20 h)`),
    h('div', { class: capPct > 100 ? 'bar over' : 'bar' }, h('span', { 'width%': Math.min(100, capPct) })),
    h('ul', {}, plan.resources.map((r) => h('li', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title) : r.title, h('div', { class: 'small muted' }, r.use))))));
  g2.append(h('div', { class: 'card' }, h('h3', {}, 'Barriers to remove before every session'), h('ul', {}, plan.barriers.map((b) => h('li', {}, b)))));
  app.append(g2);

  app.append(h('details', { class: 'card' }, h('summary', {}, `Session log (${st.sessions.length})`),
    h('table', {}, h('tr', {}, ['Date', 'Block', 'Sub-skill', 'Min', 'Reps ✓/✗', 'Metric', 'Frus.', 'Distr.', 'Note'].map((t) => h('th', {}, t))),
      st.sessions.slice().reverse().map((x) => {
        const ok = x.reps.filter((r) => r.ok).length;
        return h('tr', {}, h('td', {}, dayOf(x.startedAt)), h('td', {}, String(x.block)), h('td', {}, (plan.subskills.find((k) => k.id === x.subskill) || {}).name || x.subskill),
          h('td', {}, String(Math.round(x.practiceSec / 60))), h('td', {}, `${ok}/${x.reps.length - ok}`), h('td', {}, x.metric ?? '—'),
          h('td', {}, x.frustration ?? '—'), h('td', {}, String(x.distractions)), h('td', { class: 'small' }, x.note));
      }))));
  app.append(h('p', {}, h('button', { class: 'danger', onclick: () => {
    if (confirm(`Delete "${plan.skill}" and all its sessions from this browser? Export first if you want a backup.`)) {
      delete db.plans[plan.id]; db.sessions = db.sessions.filter((x) => x.planId !== plan.id); db.research = db.research.filter((x) => x.planId !== plan.id); save(); go('home');
    } } }, 'Delete this skill')));
}

function viewPre(app, plan) {
  const st = stats(plan);
  const fb = plan.feedback[plan.feedback.length - 1];
  const defId = (fb && fb.focusNext) || (st.nextBlock && st.nextBlock.subskill) || [...plan.subskills].sort((a, b) => a.priority - b.priority)[0].id;
  const sel = h('select', {}, [...plan.subskills].sort((a, b) => a.priority - b.priority).map((x) => h('option', { value: x.id, selected: x.id === defId }, `${x.priority}. ${x.name}`)));
  const mins = h('input', { type: 'number', min: 10, max: 180, value: plan.sessionMinutes });
  const boxes = plan.barriers.map((b) => h('input', { type: 'checkbox' }));
  const startBtn = h('button', { class: 'primary' }, 'Start the timer');
  const drillBox = h('div', {});
  const showDrill = () => {
    const sk = plan.subskills.find((x) => x.id === sel.value);
    drillBox.replaceChildren(h('h3', {}, 'Drill'), h('p', {}, sk.drill), sk.selfCheck.length ? [h('h3', {}, 'Self-correction cues'), h('ul', {}, sk.selfCheck.map((c) => h('li', {}, c)))] : null);
  };
  sel.addEventListener('change', showDrill); showDrill();
  startBtn.addEventListener('click', () => {
    db.active = { kind: 'session', id: uid(), planId: plan.id, block: st.nextBlockNo, subskill: sel.value, startedAt: new Date().toISOString(),
      plannedMin: num(mins.value, plan.sessionMinutes), practiceSec: 0, runningSince: Date.now(), pauses: 0, distractions: 0, reps: [],
      barriersCleared: boxes.filter((b) => b.checked).length, barriersTotal: boxes.length };
    save(); go('run');
  });
  app.append(h('h1', {}, `Block ${st.nextBlockNo}: ${plan.skill}`),
    st.nextBlock ? h('p', {}, h('strong', {}, 'Planned focus: '), st.nextBlock.focus) : null,
    fb && fb.actions.length ? h('div', { class: 'flag info' }, h('span', { class: 'ico' }, 'i'), h('span', {}, 'From your last review: ' + fb.actions[0])) : null,
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('label', {}, 'Sub-skill'), sel, h('label', {}, 'Minutes'), mins, drillBox),
      h('div', { class: 'card' }, h('h2', {}, 'Remove barriers (step 3)'),
        plan.barriers.length ? plan.barriers.map((b, i) => h('label', { class: 'check' }, boxes[i], h('span', {}, b))) : h('p', { class: 'muted' }, 'No barriers listed in this plan.'),
        h('p', { class: 'small muted' }, 'Unticked items are logged and the coach will flag them.'), startBtn)));
}

function activeSec(a) { return a.practiceSec + (a.runningSince ? (Date.now() - a.runningSince) / 1000 : 0); }
function viewRun(app, plan) {
  const a = db.active;
  if (!a || a.kind !== 'session') return go('dash');
  const sk = plan.subskills.find((x) => x.id === a.subskill) || plan.subskills[0];
  let tag = null;
  const clock = h('div', { class: 'huge' });
  const sub = h('p', { class: 'muted', style: null });
  const tally = h('p', { class: 'small' });
  const pauseBtn = h('button', {});
  const chips = h('div', { class: 'chips' });
  const renderChips = () => chips.replaceChildren(...sk.errorTags.map((t, i) => h('button', { class: t === tag ? 'chip on' : 'chip', onclick: () => { tag = tag === t ? null : t; renderChips(); } }, `${i + 1} ${t}`)));
  const tick = () => {
    const sec = activeSec(a);
    clock.textContent = fmtClock(sec);
    const left = a.plannedMin * 60 - sec;
    sub.textContent = a.runningSince ? (left > 0 ? `${fmtClock(left)} left of ${a.plannedMin} min` : 'Planned time reached. Finish the rep, then end.') : 'Paused. Paused time does not count toward 20 h.';
    const ok = a.reps.filter((r) => r.ok).length;
    tally.textContent = `Reps ✓ ${ok}  ✗ ${a.reps.length - ok}${a.reps.length ? `  (${Math.round((100 * ok) / a.reps.length)}%)` : ''}  ·  distractions ${a.distractions}`;
    pauseBtn.textContent = a.runningSince ? 'Pause (space)' : 'Resume (space)';
  };
  const rep = (ok) => { a.reps.push({ t: Math.round(activeSec(a)), ok, tag: ok ? null : tag }); tag = null; renderChips(); save(); tick(); };
  const togglePause = () => {
    if (a.runningSince) { a.practiceSec = activeSec(a); a.runningSince = null; a.pauses++; } else a.runningSince = Date.now();
    save(); tick();
  };
  const distract = () => { a.distractions++; save(); tick(); toast('Distraction logged. Remove its source after the session.'); };
  pauseBtn.addEventListener('click', togglePause);
  const end = () => { if (a.runningSince) { a.practiceSec = activeSec(a); a.runningSince = null; } save(); go('post'); };
  keyHandler = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.key === 'j') rep(true); else if (e.key === 'k') rep(false); else if (e.key === 'd') distract();
    else if (/^[1-8]$/.test(e.key) && sk.errorTags[+e.key - 1]) { const t = sk.errorTags[+e.key - 1]; tag = tag === t ? null : t; renderChips(); }
  };
  renderChips(); tick();
  app.append(h('h1', {}, sk.name), h('p', { class: 'muted' }, sk.drill),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, clock, sub, h('div', { class: 'row' }, pauseBtn, h('button', { onclick: distract }, 'Distracted (d)'), h('button', { class: 'primary', onclick: end }, 'End session'))),
      h('div', { class: 'card' }, h('h3', {}, 'Log every attempt'),
        h('div', { class: 'reps' }, h('button', { class: 'ok', onclick: () => rep(true) }, '✓ clean (j)'), h('button', { class: 'fail', onclick: () => rep(false) }, '✗ miss (k)')),
        sk.errorTags.length ? [h('p', { class: 'small muted' }, 'Tag a miss (pick before ✗):'), chips] : null, tally)),
    sk.selfCheck.length ? h('div', { class: 'card' }, h('h3', {}, 'Self-correction cues'), h('ul', {}, sk.selfCheck.map((c) => h('li', {}, c)))) : null,
    h('p', { class: 'small muted' }, 'Keys: ', h('kbd', {}, 'space'), ' pause · ', h('kbd', {}, 'j'), ' clean · ', h('kbd', {}, 'k'), ' miss · ', h('kbd', {}, '1-8'), ' tag · ', h('kbd', {}, 'd'), ' distraction'));
  timerHandle = setInterval(tick, 500);
}
let keyHandler = null;
document.addEventListener('keydown', (e) => { if (state.view === 'run' && keyHandler) keyHandler(e); });

function viewPost(app, plan) {
  const a = db.active;
  if (!a || a.kind !== 'session') return go('dash');
  const sk = plan.subskills.find((x) => x.id === a.subskill) || plan.subskills[0];
  let fr = null;
  const metric = h('input', { type: 'number', step: 'any', placeholder: sk.metric.target !== null ? `target ${sk.metric.target}` : '' });
  const note = h('input', { type: 'text', maxlength: 300, placeholder: 'e.g. G→C change slow; checked chord chart and fixed thumb' });
  const scale = h('div', { class: 'scale' });
  const renderScale = () => scale.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { class: n === fr ? 'on' : null, onclick: () => { fr = n; renderScale(); } }, String(n))));
  renderScale();
  const finish = (keep) => {
    if (keep) {
      const rec = cleanRecord(Object.assign({}, a, { endedAt: new Date().toISOString(), metric: metric.value, frustration: fr, note: note.value }), 'session');
      db.sessions.push(rec);
      state.flash = sessionFeedback(plan, rec);
    }
    db.active = null; save(); go('dash');
  };
  const ok = a.reps.filter((r) => r.ok).length;
  app.append(h('h1', {}, 'Session done'),
    h('p', {}, `${fmtClock(a.practiceSec)} practiced · ${a.reps.length} reps (${ok} clean) · ${a.distractions} distractions`),
    h('div', { class: 'card' },
      h('label', {}, `${sk.metric.name}${sk.metric.unit ? ' (' + sk.metric.unit + ')' : ''}: test it now, one measured try`), metric,
      h('label', {}, 'Frustration: 1 calm … 5 "I feel stupid"'), scale,
      h('label', {}, 'One line: what tripped you, and how you self-corrected'), note,
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => finish(true) }, 'Save'), h('button', { class: 'danger', onclick: () => { if (confirm('Discard this session?')) finish(false); } }, 'Discard'))));
}

function sessionFeedback(plan, rec) {
  const st = stats(plan);
  const p = st.per[rec.subskill];
  const sk = plan.subskills.find((x) => x.id === rec.subskill);
  const lines = [];
  const acc = rec.reps.length >= 5 ? rec.reps.filter((r) => r.ok).length / rec.reps.length : null;
  const prevAcc = p.accSeries.length >= 2 ? p.accSeries[p.accSeries.length - 2] : null;
  if (acc !== null) lines.push(`Accuracy ${Math.round(acc * 100)}%${prevAcc !== null ? ` (previous ${Math.round(prevAcc * 100)}%)` : ''}.`);
  if (acc !== null && acc < 0.5) lines.push('Under 50%: next time, drill a smaller piece or go slower.');
  if (acc !== null && acc > 0.9) lines.push('Over 90%: raise the difficulty next time (tempo, length, no cues).');
  const ms = p.metrics.map((m) => m.v);
  if (rec.metric !== null && ms.length > 1) {
    const prev = ms.slice(0, -1); const best = sk.metric.higherIsBetter ? Math.max(...prev) : Math.min(...prev);
    const pb = sk.metric.higherIsBetter ? rec.metric > best : rec.metric < best;
    lines.push(pb ? `New best ${sk.metric.name}: ${rec.metric} (was ${best}).` : `${sk.metric.name} ${rec.metric}; best is ${best}.`);
  }
  const errs = {}; rec.reps.filter((r) => !r.ok && r.tag).forEach((r) => (errs[r.tag] = (errs[r.tag] || 0) + 1));
  const topErr = Object.entries(errs).sort((a, b) => b[1] - a[1])[0];
  if (topErr) lines.push(`Most common miss: "${topErr[0]}" ×${topErr[1]}. Check the self-correction cue for it before next session.`);
  if (rec.distractions) lines.push(`${rec.distractions} distraction(s): remove the source, then add it to your barrier list.`);
  lines.push(`Total ${fmtH(st.practiceSec)} of ${plan.totalHours} h.`);
  return h('div', { class: 'flag good' }, h('span', { class: 'ico' }, '✓'), h('span', {}, h('strong', {}, 'Session feedback: '), lines.join(' ')));
}

function viewResearch(app, plan) {
  if (!db.active) { db.active = { kind: 'research', id: uid(), planId: plan.id, startedAt: new Date().toISOString(), practiceSec: 0, runningSince: Date.now() }; save(); }
  const a = db.active;
  if (a.kind !== 'research') return go('run');
  const st = stats(plan);
  const clock = h('div', { class: 'huge' });
  const warn = h('p', {});
  const note = h('input', { type: 'text', maxlength: 300, placeholder: 'Which mistake can you now detect yourself?' });
  const tick = () => {
    const sec = activeSec(a); clock.textContent = fmtClock(sec);
    const used = (st.researchSec + sec) / 60;
    warn.textContent = used > plan.researchCapMinutes ? `Over the ${plan.researchCapMinutes}-min research cap. Stop reading and go practice.` : `${Math.round(plan.researchCapMinutes - used)} min of research budget left.`;
    warn.className = used > plan.researchCapMinutes ? 'flag critical' : 'muted';
  };
  const stop = () => {
    db.research.push({ id: a.id, planId: plan.id, startedAt: a.startedAt, sec: Math.round(activeSec(a)), note: note.value });
    db.active = null; save(); go('dash');
  };
  tick();
  app.append(h('h1', {}, 'Research: learn just enough to self-correct'),
    h('p', { class: 'muted' }, 'Use 3 to 5 resources only. The goal is to notice your own mistakes during practice, not to finish the book.'),
    h('div', { class: 'card' }, clock, warn, h('label', {}, 'What you can now self-correct'), note, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: stop }, 'Stop & save'))),
    h('div', { class: 'card' }, h('h3', {}, 'Your resources'), h('ul', {}, plan.resources.map((r) => h('li', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title) : r.title, ' — ', r.use)))));
  timerHandle = setInterval(tick, 1000);
}

// ---------- demo plan: the ukulele example from the talk ----------
const DEMO = {
  kind: 'first20-plan', version: 1, id: 'ukulele-demo', skill: 'Ukulele (demo from the talk)',
  targetPerformance: 'Play and sing a 4-chord pop medley (G, D, Em, C) start to finish without stopping.',
  sessionMinutes: 45, totalHours: 20, researchCapMinutes: 90,
  subskills: [
    { id: 'setup', name: 'Setup: strings, tuning', priority: 0, why: 'You cannot practice without a working, tuned instrument. The talk counts this in the first hours.', drill: 'String the ukulele and tune it (GCEA) by ear against a tuner app. Repeat until you can tune in under 60 seconds.', metric: { name: 'seconds to tune', unit: 's', target: 60, higherIsBetter: false }, selfCheck: ['Tuner needle centered on each string', 'Strings stretched in, so tuning holds for 5 minutes'], errorTags: ['flat', 'sharp', 'slipping'] },
    { id: 'chords', name: 'The 4 chords: G, D, Em, C', priority: 1, why: 'Four chords cover most pop songs. This is the core set that gives most of the results.', drill: 'Form each chord and strum once. Every string must ring clean. Cycle G→D→Em→C.', metric: { name: 'clean changes per minute', unit: 'cpm', target: 40, higherIsBetter: true }, selfCheck: ['Buzz means the finger is too far from the fret', 'Muted string means a finger is touching a neighbouring string'], errorTags: ['buzz', 'muted string', 'slow change'] },
    { id: 'strum', name: 'Down-down-up-up-down-up strum', priority: 2, why: 'One strumming pattern carries the whole medley.', drill: 'Strum the pattern on a G chord at 80 bpm with a metronome.', metric: { name: 'bars in time without a slip', unit: 'bars', target: 16, higherIsBetter: true }, selfCheck: ['Wrist stays loose, motion comes from the wrist', 'Up-strums are lighter than down-strums'], errorTags: ['off beat', 'tense wrist'] },
    { id: 'medley', name: 'Song: changes in time while singing', priority: 3, why: 'This is the target performance.', drill: 'Play the medley progression and sing along, 1 song at a time.', metric: { name: 'songs played without stopping', unit: 'songs', target: 8, higherIsBetter: true }, selfCheck: ['Change chord on beat 1, even if it is messy', 'Keep strumming. Do not stop to fix mistakes.'], errorTags: ['stopped', 'lost lyric', 'late change'] },
  ],
  resources: [
    { title: 'Ukulele chord chart (G, D, Em, C only)', url: null, use: 'Check finger positions when a chord buzzes' },
    { title: 'Any metronome app', url: null, use: 'Notice when strumming drifts off the beat' },
    { title: 'Phone video of yourself', url: null, use: 'Watch your wrist tension and fretting hand' },
  ],
  barriers: ['Ukulele on a stand in sight, tuned', 'Phone in another room, metronome on a tablet', 'TV off', 'Chord chart printed next to you'],
  schedule: Array.from({ length: 27 }, (_, i) => ({ block: i + 1, subskill: i < 2 ? 'setup' : i < 9 ? 'chords' : i < 14 ? 'strum' : 'medley',
    focus: i < 2 ? 'Get the tools working' : i < 9 ? 'Clean chord shapes, then speed of changes' : i < 14 ? 'Strum pattern over chord changes' : 'Full songs, never stop' })),
  feedback: [],
};

// ---------- boot ----------
function importFromHash() {
  const m = location.hash.match(/^#import=([A-Za-z0-9_\-+/=]+)$/);
  if (!m) return false;
  try { state.planId = importData(JSON.parse(decodeB64Url(m[1]))); state.view = db.active ? state.view : 'dash'; } catch (e) { toast('Import link failed: ' + e.message); }
  history.replaceState(null, '', location.pathname);
  return true;
}
window.addEventListener('hashchange', () => { if (importFromHash() && !db.active) go('dash'); });
(function boot() {
  document.getElementById('home-btn').addEventListener('click', () => go('home'));
  if (importFromHash()) {
    /* imported */
  } else if (db.active) {
    state.planId = db.active.planId; state.view = db.active.kind === 'research' ? 'research' : 'run';
  }
  const plans = Object.keys(db.plans);
  if (state.view === 'home' && plans.length === 1) { state.planId = plans[0]; state.view = 'dash'; }
  render();
})();
