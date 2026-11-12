const express = require('express'), fs = require('fs'), crypto = require('crypto');
const app = express(), FILE = 'data.json', ADMIN = process.env.ADMIN_KEY || 'changeme';
app.use(express.json());
app.use(express.static('public'));

const fresh = () => ({
  pool: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: 'Competitor ' + (i + 1) })),
  users: {}, results: {}, locked: false
});
let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : fresh();
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
const hash = p => crypto.createHash('sha256').update(String(p)).digest('hex');

// SCORING: 0 if pick missed semis (or still pending). Otherwise 10 per round
// actually survived (1-4), +10 bonus if the user's predicted rounds were exact.
const score = p => {
  const r = db.results[p.id];
  if (!r || !r.semis) return 0;
  return r.rounds * 10 + (p.rounds === r.rounds ? 10 : 0);
};

app.get('/api/state', (req, res) => {
  const board = Object.entries(db.users).map(([name, u]) => ({
    name, filled: u.picks.length === 15,
    total: u.picks.reduce((s, p) => s + score(p), 0),
    picks: db.locked ? u.picks.map(p => ({ ...p, pts: score(p) })) : undefined
  })).sort((a, b) => b.total - a.total);
  res.json({ pool: db.pool, results: db.results, locked: db.locked, board });
});

// Log in (creates the team on first use)
app.post('/api/login', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required.' });
  const u = db.users[name];
  if (!u) { db.users[name] = { pin: hash(pin), picks: [] }; save(); return res.json({ picks: [] }); }
  if (u.pin !== hash(pin)) return res.status(401).json({ error: 'Wrong PIN for that team.' });
  res.json({ picks: u.picks });
});

app.post('/api/picks', (req, res) => {
  const { name, pin, picks } = req.body, u = db.users[name];
  if (!u || u.pin !== hash(pin)) return res.status(401).json({ error: 'Not logged in.' });
  if (db.locked) return res.status(403).json({ error: 'Rosters are locked.' });
  const ids = new Set((picks || []).map(p => p.id));
  if (!Array.isArray(picks) || picks.length !== 15 || ids.size !== 15)
    return res.status(400).json({ error: 'Pick exactly 15 different people.' });
  if (picks.some(p => !db.pool.find(x => x.id === p.id) || ![1, 2, 3, 4].includes(p.rounds)))
    return res.status(400).json({ error: 'Invalid pick or rounds (1-4).' });
  u.picks = picks.map(({ id, rounds }) => ({ id, rounds })); save();
  res.json({ ok: true });
});

// ---- Admin ----
const admin = (req, res, next) =>
  req.get('x-admin-key') === ADMIN ? next() : res.status(403).json({ error: 'Bad admin key.' });

// value: "" pending | "out" missed semis | "1".."4" rounds survived
app.post('/api/admin/result', admin, (req, res) => {
  const { id, value } = req.body;
  if (value === '') delete db.results[id];
  else if (value === 'out') db.results[id] = { semis: false, rounds: 0 };
  else db.results[id] = { semis: true, rounds: Number(value) };
  save(); res.json({ ok: true });
});
app.post('/api/admin/lock', admin, (req, res) => { db.locked = !!req.body.locked; save(); res.json({ ok: true }); });
app.post('/api/admin/pool', admin, (req, res) => {
  db.pool = req.body.names.map((n, i) => ({ id: i + 1, name: n })); db.results = {};
  for (const u of Object.values(db.users)) u.picks = [];
  save(); res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => console.log('Fantasy league running on port ' + (process.env.PORT || 3000)));
