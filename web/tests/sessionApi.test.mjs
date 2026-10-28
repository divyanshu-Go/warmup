import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { safeReturnPath } from '../lib/navigation.mjs';

let sequence = 0;
async function setup(run) {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const window = new EventTarget();
  window.location = { hostname: '127.0.0.1' };
  globalThis.window = window;
  const source = readFileSync(new URL('../lib/api.js', import.meta.url), 'utf8');
  const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${sequence++}`);
  try { await run(api, window); }
  finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
}

test('protected API 401 emits one expiry event and preserves the error status', async () => {
  await setup(async (api, window) => {
    let expired = 0;
    window.addEventListener('interview:session-expired', () => expired++);
    globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Session expired' }), { status: 401 });
    await assert.rejects(api.requestApi('/api/interview/history'), { status: 401 });
    assert.equal(expired, 1);
  });
});

test('initial session lookup and non-authentication failures do not trigger expiry redirects', async () => {
  await setup(async (api, window) => {
    let expired = 0;
    window.addEventListener('interview:session-expired', () => expired++);
    globalThis.fetch = async () => new Response('{"detail":"Required"}', { status: 401 });
    await assert.rejects(api.requestApi('/api/auth/me'), { status: 401 });
    globalThis.fetch = async () => new Response('{"detail":"Unavailable"}', { status: 503 });
    await assert.rejects(api.requestApi('/api/resumes'), { status: 503 });
    assert.equal(expired, 0);
  });
});

test('late responses from a previous account cannot expire the new session or expose old data', async () => {
  await setup(async (api, window) => {
    let respond;
    let expired = 0;
    window.addEventListener('interview:session-expired', () => expired++);
    globalThis.fetch = () => new Promise(resolve => { respond = resolve; });
    const pending = api.requestApi('/api/resumes');
    api.invalidateSessionRequests();
    respond(new Response('{"detail":"Old session"}', { status: 401 }));
    await assert.rejects(pending, /account changed/);
    assert.equal(expired, 0);
  });
});

test('question speech 401 also triggers expiry recovery', async () => {
  await setup(async (api, window) => {
    let expired = 0;
    window.addEventListener('interview:session-expired', () => expired++);
    globalThis.fetch = async () => new Response('{"detail":"Session expired"}', { status: 401 });
    await assert.rejects(api.loadQuestionAudio('turn-1'), /Session expired/);
    assert.equal(expired, 1);
  });
});

test('return destinations allow only app routes and retain resume selection', () => {
  assert.equal(safeReturnPath('/'), '/');
  assert.equal(safeReturnPath('/interview?resume=abc'), '/interview?resume=abc');
  for (const value of ['https://evil.example/interview', '//evil.example/history', '/access', '/unknown', 'javascript:alert(1)', null]) {
    assert.equal(safeReturnPath(value), '/resumes');
  }
});
