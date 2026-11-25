import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

const { server } = createApp();
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const mkCall = (b) => async (m, p, body, token) => {
  const r = await fetch(b + p, { method: m, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const call = mkCall(base);
const future = (d = 3) => new Date(Date.now() + d * 864e5).toLocaleDateString('sv');
const reg = async (n) => (await call('POST', '/api/register', { name: 'U' + n, email: `u${n}@t.com`, phone: '0100', password: 'secret1' })).data.token;

test('register + login + bad login', async () => {
  const t = await reg('a'); assert.ok(t);
  assert.equal((await call('POST', '/api/register', { name: 'x', email: 'ua@t.com', password: 'secret1' })).status, 409);
  assert.equal((await call('POST', '/api/login', { email: 'ua@t.com', password: 'secret1' })).status, 200);
  assert.equal((await call('POST', '/api/login', { email: 'ua@t.com', password: 'wrong' })).status, 401);
  assert.equal((await call('POST', '/api/register', { name: 'x', email: 'z@t.com', password: '123' })).status, 400);
});
test('booking requires auth; past date rejected; availability', async () => {
  assert.equal((await call('POST', '/api/bookings', { pitch_id: 1, date: future(), hour: 18 })).status, 401);
  const t = await reg('b');
  assert.equal((await call('POST', '/api/bookings', { pitch_id: 1, date: '2020-01-01', hour: 18 }, t)).status, 400);
  assert.equal((await call('POST', '/api/bookings', { pitch_id: 1, date: future(), hour: 3 }, t)).status, 400);
  const av = await call('GET', `/api/availability?pitch_id=1&date=${future()}`);
  assert.equal(av.status, 200); assert.equal(av.data.hours.length, 8);
});
test('double booking -> 409, cancel frees slot', async () => {
  const t1 = await reg('c'), t2 = await reg('d'), date = future(4);
  const b = await call('POST', '/api/bookings', { pitch_id: 1, date, hour: 20 }, t1);
  assert.equal(b.status, 201);
  assert.equal((await call('POST', '/api/bookings', { pitch_id: 1, date, hour: 20 }, t2)).status, 409);
  assert.equal((await call('DELETE', `/api/bookings/${b.data.id}`, null, t2)).status, 403);
  assert.equal((await call('DELETE', `/api/bookings/${b.data.id}`, null, t1)).status, 200);
  assert.equal((await call('POST', '/api/bookings', { pitch_id: 1, date, hour: 20 }, t2)).status, 201);
  const mine = await call('GET', '/api/bookings/mine', null, t1);
  assert.equal(mine.data[0].status, 'cancelled');
});
test('concurrent booking of same slot: exactly one succeeds', async () => {
  const tokens = await Promise.all([1, 2, 3, 4, 5].map((i) => reg('conc' + i)));
  const rs = await Promise.all(tokens.map((t) => call('POST', '/api/bookings', { pitch_id: 1, date: future(5), hour: 17 }, t)));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 4);
});
test('admin endpoints: forbidden for users, work for admin', async () => {
  const u = await reg('e');
  assert.equal((await call('GET', '/api/admin/stats', null, u)).status, 403);
  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
  const a = (await call('POST', '/api/login', { email: 'admin@pitch.local', password: 'admin123' })).data;
  assert.equal(a.user.role, 'admin');
  const s = await call('GET', '/api/admin/stats', null, a.token);
  assert.equal(s.status, 200); assert.ok(s.data.total_bookings >= 1); assert.ok(s.data.revenue >= 300);
  assert.ok((await call('GET', '/api/admin/bookings', null, a.token)).data.length >= 1);
  const np = await call('POST', '/api/admin/pitches', { name: 'ملعب 2', price: 250, open_hour: 10, close_hour: 22 }, a.token);
  assert.equal(np.status, 201);
  assert.equal((await call('POST', '/api/admin/pitches', { name: '', price: 0 }, a.token)).status, 400);
  assert.equal((await call('PUT', `/api/admin/pitches/${np.data.id}`, { active: false }, a.token)).status, 200);
  const list = (await call('GET', '/api/pitches')).data;
  assert.ok(!list.some((p) => p.id === np.data.id));
});
test('dashboard HTML is served', async () => {
  const r = await fetch(base + '/admin'); assert.equal(r.status, 200);
  assert.match(await r.text(), /لوحة تحكم/);
});

test('profile: me, update, change password', async () => {
  const t = await reg('f');
  assert.equal((await call('GET', '/api/me', null, t)).data.email, 'uf@t.com');
  assert.equal((await call('PUT', '/api/me', { name: 'New Name', phone: '0111' }, t)).status, 200);
  assert.equal((await call('GET', '/api/me', null, t)).data.name, 'New Name');
  assert.equal((await call('PUT', '/api/me', { name: '' }, t)).status, 400);
  assert.equal((await call('PUT', '/api/me/password', { old_password: 'bad', new_password: 'newsecret' }, t)).status, 400);
  assert.equal((await call('PUT', '/api/me/password', { old_password: 'secret1', new_password: '123' }, t)).status, 400);
  assert.equal((await call('PUT', '/api/me/password', { old_password: 'secret1', new_password: 'newsecret' }, t)).status, 200);
  assert.equal((await call('POST', '/api/login', { email: 'uf@t.com', password: 'secret1' })).status, 401);
  assert.equal((await call('POST', '/api/login', { email: 'uf@t.com', password: 'newsecret' })).status, 200);
  assert.equal((await call('GET', '/api/me')).status, 401);
});
test('admin users list + can_cancel flag', async () => {
  const a = (await call('POST', '/api/login', { email: 'admin@pitch.local', password: 'admin123' })).data;
  const u = await call('GET', '/api/admin/users', null, a.token);
  assert.equal(u.status, 200);
  assert.ok(u.data.some((x) => x.email === 'admin@pitch.local'));
  assert.ok(u.data.every((x) => !('pw' in x)));
  const t = await reg('g');
  assert.equal((await call('GET', '/api/admin/users', null, t)).status, 403);
  await call('POST', '/api/bookings', { pitch_id: 1, date: future(6), hour: 21 }, t);
  assert.equal((await call('GET', '/api/bookings/mine', null, t)).data[0].can_cancel, true);
});
test('cancellation policy: users blocked inside window, admin exempt', async () => {
  const { server: s2 } = createApp({ cancelHours: 24 * 30 });
  await new Promise((r) => s2.listen(0, r));
  const c2 = mkCall(`http://127.0.0.1:${s2.address().port}`);
  try {
    const t = (await c2('POST', '/api/register', { name: 'P', email: 'p@t.com', password: 'secret1' })).data.token;
    const b = await c2('POST', '/api/bookings', { pitch_id: 1, date: future(5), hour: 19 }, t);
    assert.equal(b.status, 201);
    assert.equal((await c2('GET', '/api/bookings/mine', null, t)).data[0].can_cancel, false);
    assert.equal((await c2('DELETE', `/api/bookings/${b.data.id}`, null, t)).status, 403);
    const a = (await c2('POST', '/api/login', { email: 'admin@pitch.local', password: 'admin123' })).data.token;
    assert.equal((await c2('DELETE', `/api/bookings/${b.data.id}`, null, a)).status, 200);
  } finally { s2.close(); }
});

test('mobile web app served at / with manifest', async () => {
  const r = await fetch(base + '/'); assert.equal(r.status, 200);
  assert.match(await r.text(), /حجز ملعب/);
  assert.equal((await fetch(base + '/manifest.webmanifest')).status, 200);
  assert.equal((await fetch(base + '/icon.svg')).status, 200);
});

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('healthz + security headers', async () => {
  const r = await fetch(base + '/healthz'); assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/')).headers.get('x-frame-options'), 'DENY');
});
test('login rate limit -> 429 (per ip+email)', async () => {
  const { server: s3 } = createApp({ loginLimit: 3 });
  await new Promise((r) => s3.listen(0, r));
  const c3 = mkCall(`http://127.0.0.1:${s3.address().port}`);
  try {
    await c3('POST', '/api/register', { name: 'R', email: 'r@t.com', password: 'secret1' });
    for (let i = 0; i < 3; i++) assert.equal((await c3('POST', '/api/login', { email: 'r@t.com', password: 'bad' + i })).status, 401);
    assert.equal((await c3('POST', '/api/login', { email: 'r@t.com', password: 'secret1' })).status, 429);
    assert.equal((await c3('POST', '/api/login', { email: 'other@t.com', password: 'x' })).status, 401);
  } finally { s3.close(); }
});
test('production refuses to start without strong secrets', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], { env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', ADMIN_PASSWORD: '' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 1); assert.match(r.stderr, /JWT_SECRET/);
});
