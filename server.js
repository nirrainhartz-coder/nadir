const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const Q = require('./questions');
const PORT = process.env.PORT || 3000;
const PTS = { c: 10, m: 20, r: 35, l: 50 }, UNIQUE = 10, PRE = 3000, TIME = 25000, ZOOM = 6500;
const COL = ['#ff5d73','#ffb347','#ffe66d','#7bed9f','#4dd0e1','#6c8cff','#c78bff','#ff8fd6','#9be15d','#ff7f50','#00e5ff','#f5f5f5'];

// ---------- התאמת תשובות ----------
const fin = { 'ך':'כ','ם':'מ','ן':'נ','ף':'פ','ץ':'צ' };
const key = s => String(s).normalize('NFKD').replace(/[\u0591-\u05C7]/g, '').toLowerCase()
  .replace(/[^א-תa-z0-9]/g, '').replace(/[ךםןףץ]/g, c => fin[c]).replace(/[וי]/g, '');
const IDX = Q.map(q => { const m = new Map();
  for (const t of ['l', 'r', 'm', 'c']) for (const e of q[t]) { const [canon, ...al] = e.split('|');
    for (const a of [canon, ...al]) { const k = key(a); if (k) m.set(k, { canon, tier: t }); } }
  return m; });
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[a.length][b.length]; }
function match(i, text) { const k = key(text); if (!k) return null; const m = IDX[i];
  const h = m.get(k) || (k[0] === 'ה' && m.get(k.slice(1))); if (h) return h;
  if (k.length >= 4) for (const [kk, v] of m) if (kk.length >= 4 && Math.abs(kk.length - k.length) <= 1 && lev(k, kk) <= 1) return v;
  return null; }

// ---------- מצב המשחק ----------
let phase = 'lobby', q = -1, startsAt = 0, endsAt = 0, timer = null;
const P = {}; const clients = new Set();
const ranked = () => Object.values(P).sort((a, b) => b.score - a.score);
const hostView = () => ({ phase, q, total: Q.length, cat: Q[q]?.cat, title: Q[q]?.title, startsAt, endsAt, now: Date.now(),
  players: Object.values(P).map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, answered: !!p.cur, last: p.last })) });
const playerView = p => ({ phase, q, total: Q.length, cat: Q[q]?.cat, title: Q[q]?.title, startsAt, endsAt, now: Date.now(),
  me: { name: p.name, score: p.score, cur: p.cur, last: p.last, rank: ranked().indexOf(p) + 1 }, n: Object.keys(P).length });
function broadcast() { for (const c of clients) { let v;
  if (c.role === 'host') v = hostView(); else if (P[c.id]) v = playerView(P[c.id]); else v = { gone: true };
  c.res.write('data:' + JSON.stringify(v) + '\n\n'); } }
function begin(i) { q = i; phase = 'question'; startsAt = Date.now() + PRE; endsAt = startsAt + TIME;
  Object.values(P).forEach(p => { p.cur = null; p.last = null; });
  clearTimeout(timer); timer = setTimeout(endQ, PRE + TIME + 300); broadcast(); }
function endQ() { if (phase !== 'question') return; clearTimeout(timer);
  const ps = Object.values(P), cnt = {};
  ps.forEach(p => p.cur && (cnt[p.cur.canon] = (cnt[p.cur.canon] || 0) + 1));
  ps.forEach(p => { if (!p.cur) { p.last = { answer: null, tier: null, pts: 0, uniq: false }; return; }
    const uniq = ps.length > 1 && cnt[p.cur.canon] === 1, pts = PTS[p.cur.tier] + (uniq ? UNIQUE : 0);
    p.score += pts; p.last = { answer: p.cur.canon, tier: p.cur.tier, pts, uniq, shared: cnt[p.cur.canon] - 1 }; });
  phase = 'reveal'; broadcast(); }
function act(a) {
  if (a === 'start' && phase === 'lobby' && Object.keys(P).length) begin(0);
  else if (a === 'next' && phase === 'reveal') {
    if (q < Q.length - 1) begin(q + 1);
    else { phase = 'zoom'; broadcast(); timer = setTimeout(() => { phase = 'podium'; broadcast(); }, ZOOM); } }
  else if (a === 'reset') { clearTimeout(timer); phase = 'lobby'; q = -1;
    Object.values(P).forEach(p => { p.score = 0; p.cur = p.last = null; }); broadcast(); } }

// ---------- שרת HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const ips = () => Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const c = { res, role: u.searchParams.get('role'), id: u.searchParams.get('id') };
    clients.add(c); req.on('close', () => clients.delete(c));
    res.write('data:' + JSON.stringify(c.role === 'host' ? hostView() : P[c.id] ? playerView(P[c.id]) : { gone: true }) + '\n\n'); return; }
  if (u.pathname === '/info') return json(res, { port: PORT, ips: ips() });
  if (u.pathname === '/join' && req.method === 'POST') { const b = await body(req);
    if (b.id && P[b.id]) return json(res, { ok: true, id: b.id });
    const name = String(b.name || '').trim().slice(0, 14);
    if (!name) return json(res, { ok: false, msg: 'כתבו שם' });
    if (phase !== 'lobby') return json(res, { ok: false, msg: 'המשחק כבר התחיל' });
    if (Object.values(P).some(p => p.name === name)) return json(res, { ok: false, msg: 'השם תפוס' });
    const id = Math.random().toString(36).slice(2, 10);
    P[id] = { id, name, color: COL[Object.keys(P).length % COL.length], score: 0, cur: null, last: null };
    broadcast(); return json(res, { ok: true, id }); }
  if (u.pathname === '/answer' && req.method === 'POST') { const b = await body(req), p = P[b.id];
    if (!p) return json(res, { ok: false, msg: 'לא מחובר' });
    if (phase !== 'question' || Date.now() < startsAt) return json(res, { ok: false, msg: 'לא עכשיו' });
    if (Date.now() > endsAt + 400) return json(res, { ok: false, msg: 'הזמן נגמר' });
    if (p.cur) return json(res, { ok: false, msg: 'כבר ענית' });
    const h = match(q, b.text); if (!h) return json(res, { ok: false, msg: 'לא מתאים לנושא, נסו משהו אחר' });
    p.cur = h; broadcast();
    if (Object.values(P).every(x => x.cur)) setTimeout(endQ, 700);
    return json(res, { ok: true }); }
  if (u.pathname === '/host' && req.method === 'POST') { act((await body(req)).action); return json(res, { ok: true }); }
  const f = u.pathname === '/' ? 'host.html' : u.pathname === '/play' ? 'play.html' : null;
  if (!f) { res.writeHead(404); return res.end(); }
  const fp = [path.join(__dirname, 'public', f), path.join(__dirname, f)].find(p => fs.existsSync(p));
  if (!fp) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('חסר הקובץ ' + f + ' ב-GitHub'); }
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  fs.createReadStream(fp).on('error', () => res.end()).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  console.log('\n🤿 המשחק רץ!\n  מסך ההוסט (במחשב):  http://localhost:' + PORT);
  ips().forEach(ip => console.log('  שחקנים (מהטלפון):    http://' + ip + ':' + PORT + '/play'));
  console.log(''); });
setInterval(() => clients.forEach(c => c.res.write(': ping\n\n')), 15000);
