const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
process.env.NODE_ENV = 'production';
const route = require('../.test-build/route.js');
const originalFetch = global.fetch;
after(() => { global.fetch = originalFetch; });

function request(path, method = 'GET', options = {}) {
  return new NextRequest(`https://circle.example/api/backend/${path}`, { method, ...options });
}
function context(path) { return { params: Promise.resolve({ path: path.split('/') }) }; }

for (const endpoint of ['auth/login', 'auth/register']) {
  test(`${endpoint} keeps JWT in a secure HttpOnly cookie`, async () => {
    const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const token = `header.${claims}.signature`;
    global.fetch = async () => Response.json({ access_token: token, token_type: 'bearer' });
    const response = await route.POST(request(endpoint, 'POST', {
      headers: { origin: 'https://circle.example' }, body: JSON.stringify({ email: 'test@example.com', password: 'password' }),
    }), context(endpoint));
    assert.deepEqual(await response.json(), { authenticated: true });
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=strict/i);
    assert.match(cookie, /Path=\/api\/backend/i);
    assert.match(cookie, /Max-Age=3[56][0-9]{2}/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
}

test('API request forwards cookie token as bearer without forwarding browser cookies', async () => {
  global.fetch = async (url, options) => {
    assert.match(url, /\/auth\/me$/);
    assert.equal(options.headers.get('authorization'), 'Bearer secret-token');
    assert.equal(options.headers.get('cookie'), null);
    return Response.json({ id: 'test-user' });
  };
  const response = await route.GET(request('auth/me', 'GET', {
    headers: { cookie: 'ajocircle_session=secret-token; unrelated=value' },
  }), context('auth/me'));
  assert.deepEqual(await response.json(), { id: 'test-user' });
});

test('rejects cross-origin and missing-origin mutations before reaching API', async () => {
  global.fetch = async () => { throw new Error('Must not call API'); };
  for (const origin of ['https://evil.example', undefined]) {
    const response = await route.POST(request('auth/login', 'POST', {
      headers: origin ? { origin } : {},
    }), context('auth/login'));
    assert.equal(response.status, 403);
  }
});

test('logout expires cookie without calling API', async () => {
  global.fetch = async () => { throw new Error('Must not call API'); };
  const response = await route.POST(request('auth/logout', 'POST', {
    headers: { origin: 'https://circle.example' },
  }), context('auth/logout'));
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('invalid session clears cookie; failed login returns no JWT', async () => {
  global.fetch = async () => Response.json({ detail: 'Invalid credentials' }, { status: 401 });
  const response = await route.GET(request('auth/me'), context('auth/me'));
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(await response.json(), { detail: 'Invalid credentials' });
});

test('API outage produces an actionable gateway error', async () => {
  global.fetch = async () => { throw new Error('Connection refused'); };
  const response = await route.GET(request('auth/me'), context('auth/me'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).detail, /Unable to reach/);
});
