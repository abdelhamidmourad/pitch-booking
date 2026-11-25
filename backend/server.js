import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const b64 = (s) => Buffer.from(s).toString('base64url');
const E = (status, error) => Object.assign(new Error(error), { status });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createApp({ dbFile = ':memory:', secret = process.env.JWT_SECRET || 'dev-secret-change-me', cancelHours = Number(process.env.CANCEL_HOURS ?? 2), loginLimit = Number(process.env.LOGIN_LIMIT ?? 10) } = {}) {
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, pw TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user');
    CREATE TABLE IF NOT EXISTS pitches(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL, open_hour INTEGER NOT NULL DEFAULT 16, close_hour INTEGER NOT NULL DEFAULT 24, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, pitch_id INTEGER NOT NULL, date TEXT NOT NULL, hour INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_slot ON bookings(pitch_id,date,hour) WHERE status='confirmed';
  `);
  const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
  const checkPw = (pw, stored) => { const [salt, h] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(hash(pw, salt).split(':')[1], 'hex'), Buffer.from(h, 'hex')); };
  const sign = (u) => { const p = b64(JSON.stringify({ id: u.id, role: u.role, exp: Date.now() + 7 * 864e5 })); return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`; };
  const verify = (t) => {
    const [p, s] = (t || '').split('.'); if (!p || !s) return null;
    const e = crypto.createHmac('sha256', secret).update(p).digest('base64url');
    if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.exp > Date.now() ? d : null; } catch { return null; }
  };
  if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get())
    db.prepare("INSERT INTO users(name,email,phone,pw,role) VALUES(?,?,?,?,'admin')")
      .run('Admin', process.env.ADMIN_EMAIL || 'admin@pitch.local', '', hash(process.env.ADMIN_PASSWORD || 'admin123'));
  if (!db.prepare('SELECT 1 FROM pitches').get())
    db.prepare('INSERT INTO pitches(name,price) VALUES(?,?)').run('ملعب 1 - نجيل صناعي', 300);

  const isPast = (date, h) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00`) <= new Date();
  const canCancel = (b) => b.status === 'confirmed' && new Date(`${b.date}T${String(b.hour).padStart(2, '0')}:00:00`) - Date.now() >= cancelHours * 36e5;
  const fails = new Map(); // محاولات الدخول الفاشلة: key -> {n, until}
  const getPitch = (id, onlyActive = true) => {
    const p = db.prepare(`SELECT * FROM pitches WHERE id=? ${onlyActive ? 'AND active=1' : ''}`).get(Number(id));
    if (!p) throw E(404, 'الملعب غير موجود'); return p;
  };
  const pitchFields = (b, old = {}) => {
    const v = { name: b.name ?? old.name, price: Number(b.price ?? old.price), open_hour: Number(b.open_hour ?? old.open_hour ?? 16), close_hour: Number(b.close_hour ?? old.close_hour ?? 24), active: b.active === undefined ? (old.active ?? 1) : (b.active ? 1 : 0) };
    if (!v.name || !(v.price > 0) || !Number.isInteger(v.open_hour) || !Number.isInteger(v.close_hour) || v.open_hour < 0 || v.close_hour > 24 || v.open_hour >= v.close_hour) throw E(400, 'بيانات الملعب غير صالحة');
    return v;
  };

  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' });
      res.end(JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method, q = Object.fromEntries(url.searchParams);
      if (m === 'OPTIONS') return send(204, {});
      const page = p === '/' ? 'web' : (p === '/admin' || p === '/admin/') ? 'dashboard' : null;
      if (page) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
        return res.end(fs.readFileSync(path.join(here, '..', page, 'index.html')));
      }
      if (p === '/manifest.webmanifest') {
        res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8' });
        return res.end(JSON.stringify({ name: 'حجز ملعب', short_name: 'حجز ملعب', start_url: '/', display: 'standalone', dir: 'rtl', lang: 'ar', background_color: '#1f8a4c', theme_color: '#1f8a4c', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] }));
      }
      if (p === '/icon.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' });
        return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#1f8a4c"/><text x="50" y="68" font-size="58" text-anchor="middle">⚽</text></svg>');
      }
      if (p === '/healthz') return send(200, { ok: true });
      if (!p.startsWith('/api/')) return send(404, { error: 'not found' });
      let body = {};
      if (['POST', 'PUT'].includes(m)) { let raw = ''; for await (const c of req) raw += c; try { body = raw ? JSON.parse(raw) : {}; } catch { throw E(400, 'JSON غير صالح'); } }
      const auth = verify((req.headers.authorization || '').replace('Bearer ', ''));
      const need = (role) => { if (!auth) throw E(401, 'login required'); if (role && auth.role !== role) throw E(403, 'غير مصرح'); return auth; };
      let id;

      if (m === 'POST' && p === '/api/register') {
        const { name, email, phone, password } = body;
        if (!name || !email || !password || String(password).length < 6) throw E(400, 'الاسم والبريد وكلمة مرور (6 أحرف على الأقل) مطلوبة');
        try {
          const r = db.prepare('INSERT INTO users(name,email,phone,pw) VALUES(?,?,?,?)').run(name.trim(), email.trim().toLowerCase(), phone || '', hash(String(password)));
          const u = { id: Number(r.lastInsertRowid), name: name.trim(), role: 'user' };
          return send(201, { token: sign(u), user: u });
        } catch { throw E(409, 'البريد مسجل بالفعل'); }
      }
      if (m === 'POST' && p === '/api/login') {
        const email = String(body.email || '').trim().toLowerCase();
        const ip = process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
        const key = `${ip}|${email}`, f = fails.get(key), live = f && f.until > Date.now();
        if (live && f.n >= loginLimit) throw E(429, 'محاولات كثيرة، حاول بعد 15 دقيقة');
        const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!u || !checkPw(String(body.password || ''), u.pw)) {
          if (fails.size > 5000) for (const [k, v] of fails) if (v.until < Date.now()) fails.delete(k);
          fails.set(key, { n: live ? f.n + 1 : 1, until: live ? f.until : Date.now() + 15 * 60 * 1000 });
          throw E(401, 'بيانات الدخول غير صحيحة');
        }
        fails.delete(key);
        return send(200, { token: sign(u), user: { id: u.id, name: u.name, role: u.role } });
      }
      if (m === 'GET' && p === '/api/pitches') return send(200, db.prepare('SELECT * FROM pitches WHERE active=1').all());
      if (m === 'GET' && p === '/api/availability') {
        const pitch = getPitch(q.pitch_id);
        if (!DATE_RE.test(q.date || '')) throw E(400, 'تاريخ غير صالح');
        const taken = new Set(db.prepare("SELECT hour FROM bookings WHERE pitch_id=? AND date=? AND status='confirmed'").all(pitch.id, q.date).map((x) => x.hour));
        const hours = [];
        for (let h = pitch.open_hour; h < pitch.close_hour; h++) hours.push({ hour: h, available: !taken.has(h) && !isPast(q.date, h) });
        return send(200, { pitch, date: q.date, hours });
      }
      if (m === 'POST' && p === '/api/bookings') {
        const a = need(); const { pitch_id, date, hour } = body;
        const pitch = getPitch(pitch_id);
        if (!DATE_RE.test(date || '') || !Number.isInteger(hour) || hour < pitch.open_hour || hour >= pitch.close_hour) throw E(400, 'موعد غير صالح');
        if (isPast(date, hour)) throw E(400, 'لا يمكن الحجز في موعد سابق');
        try {
          const r = db.prepare('INSERT INTO bookings(user_id,pitch_id,date,hour) VALUES(?,?,?,?)').run(a.id, pitch.id, date, hour);
          return send(201, { id: Number(r.lastInsertRowid), pitch_id: pitch.id, date, hour, status: 'confirmed' });
        } catch (e) { if (/UNIQUE/i.test(e.message)) throw E(409, 'هذا الموعد محجوز بالفعل'); throw e; }
      }
      if (m === 'GET' && p === '/api/bookings/mine') {
        const a = need();
        return send(200, db.prepare('SELECT b.*, p.name pitch_name, p.price FROM bookings b JOIN pitches p ON p.id=b.pitch_id WHERE b.user_id=? ORDER BY b.date DESC, b.hour DESC').all(a.id).map((b) => ({ ...b, can_cancel: canCancel(b) })));
      }
      if (m === 'DELETE' && (id = p.match(/^\/api\/bookings\/(\d+)$/))) {
        const a = need(); const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(Number(id[1]));
        if (!b) throw E(404, 'الحجز غير موجود');
        if (b.user_id !== a.id && a.role !== 'admin') throw E(403, 'غير مصرح');
        if (a.role !== 'admin' && b.status === 'confirmed' && !canCancel(b)) throw E(403, `لا يمكن الإلغاء قبل الموعد بأقل من ${cancelHours} ساعة`);
        db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
        return send(200, { ok: true });
      }
      if (p === '/api/me' && m === 'GET') {
        const a = need(); const u = db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(a.id);
        if (!u) throw E(404, 'المستخدم غير موجود'); return send(200, u);
      }
      if (p === '/api/me' && m === 'PUT') {
        const a = need(); const name = String(body.name || '').trim(); if (!name) throw E(400, 'الاسم مطلوب');
        db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, String(body.phone ?? '').trim(), a.id); return send(200, { ok: true });
      }
      if (p === '/api/me/password' && m === 'PUT') {
        const a = need(); const u = db.prepare('SELECT pw FROM users WHERE id=?').get(a.id);
        if (!u || !checkPw(String(body.old_password || ''), u.pw)) throw E(400, 'كلمة المرور الحالية غير صحيحة');
        if (String(body.new_password || '').length < 6) throw E(400, 'كلمة المرور الجديدة 6 أحرف على الأقل');
        db.prepare('UPDATE users SET pw=? WHERE id=?').run(hash(String(body.new_password)), a.id); return send(200, { ok: true });
      }
      // ---- Admin ----
      if (m === 'GET' && p === '/api/admin/stats') {
        need('admin');
        const today = new Date().toLocaleDateString('sv');
        return send(200, {
          total_bookings: db.prepare("SELECT COUNT(*) c FROM bookings WHERE status='confirmed'").get().c,
          today_bookings: db.prepare("SELECT COUNT(*) c FROM bookings WHERE status='confirmed' AND date=?").get(today).c,
          revenue: db.prepare("SELECT COALESCE(SUM(p.price),0) s FROM bookings b JOIN pitches p ON p.id=b.pitch_id WHERE b.status='confirmed'").get().s,
          users: db.prepare("SELECT COUNT(*) c FROM users WHERE role='user'").get().c,
        });
      }
      if (m === 'GET' && p === '/api/admin/bookings') {
        need('admin');
        const sql = `SELECT b.*, p.name pitch_name, p.price, u.name user_name, u.phone user_phone FROM bookings b JOIN pitches p ON p.id=b.pitch_id JOIN users u ON u.id=b.user_id ${q.date ? 'WHERE b.date=?' : ''} ORDER BY b.date DESC, b.hour DESC LIMIT 500`;
        return send(200, q.date ? db.prepare(sql).all(q.date) : db.prepare(sql).all());
      }
      if (m === 'GET' && p === '/api/admin/users') {
        need('admin');
        return send(200, db.prepare("SELECT u.id,u.name,u.email,u.phone,u.role,(SELECT COUNT(*) FROM bookings b WHERE b.user_id=u.id AND b.status='confirmed') bookings FROM users u ORDER BY u.id DESC").all());
      }
      if (m === 'GET' && p === '/api/admin/pitches') { need('admin'); return send(200, db.prepare('SELECT * FROM pitches').all()); }
      if (m === 'POST' && p === '/api/admin/pitches') {
        need('admin'); const v = pitchFields(body);
        const r = db.prepare('INSERT INTO pitches(name,price,open_hour,close_hour,active) VALUES(?,?,?,?,?)').run(v.name, v.price, v.open_hour, v.close_hour, v.active);
        return send(201, { id: Number(r.lastInsertRowid), ...v });
      }
      if (m === 'PUT' && (id = p.match(/^\/api\/admin\/pitches\/(\d+)$/))) {
        need('admin'); const old = getPitch(id[1], false), v = pitchFields(body, old);
        db.prepare('UPDATE pitches SET name=?,price=?,open_hour=?,close_hour=?,active=? WHERE id=?').run(v.name, v.price, v.open_hour, v.close_hour, v.active, old.id);
        return send(200, { id: old.id, ...v });
      }
      throw E(404, 'not found');
    } catch (e) {
      if (!e.status) console.error(e);
      send(e.status || 500, { error: e.status ? e.message : 'خطأ في الخادم' });
    }
  });
  return { server, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production' && ((process.env.JWT_SECRET || '').length < 16 || (process.env.ADMIN_PASSWORD || '').length < 8)) {
    console.error('Production: set JWT_SECRET (16+ chars) and ADMIN_PASSWORD (8+ chars) before starting.');
    process.exit(1);
  }
  const { server } = createApp({ dbFile: process.env.DB_FILE || path.join(here, 'data.db') });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Admin Dashboard: http://localhost:${port}/admin`);
    for (const n of Object.values(os.networkInterfaces()).flat()) if (n && n.family === 'IPv4' && !n.internal) console.log(`للموبايل (نفس الـ Wi-Fi): http://${n.address}:${port}`);
  });
}
