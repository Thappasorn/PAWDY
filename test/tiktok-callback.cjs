const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { authorizationLink, acceptCallback, CALLBACK, MAX_AGE } = require('../tiktok-callback.js');
const state = 'a'.repeat(64), pending = { state, at: 1000 };
const url = new URL('https://ads.tiktok.com/marketing_api/auth');
url.search = new URLSearchParams({ app_id: '123', redirect_uri: CALLBACK, state: 'old' });
assert.equal(new URL(authorizationLink(url.href, state)).searchParams.get('state'), state);
const currentAdvertiserUrl = new URL('https://business-api.tiktok.com/portal/auth');
currentAdvertiserUrl.search = new URLSearchParams({ app_id: '123', redirect_uri: CALLBACK, state: 'old' });
assert.equal(new URL(authorizationLink(currentAdvertiserUrl.href, state)).searchParams.get('state'), state);
assert.equal(new URL(authorizationLink(currentAdvertiserUrl.href, state)).origin, 'https://business-api.tiktok.com');
assert.throws(() => authorizationLink(url.href.replace('ads.tiktok.com', 'ads.tiktok.com.evil.example'), state));
assert.throws(() => authorizationLink(url.href.replace(encodeURIComponent(CALLBACK), encodeURIComponent('https://evil.example')), state));
assert.throws(() => authorizationLink(url.href + '&redirect_uri=' + encodeURIComponent(CALLBACK), state));
assert.throws(() => authorizationLink(url.href + '&client_secret=never-accept', state));
const response = new URLSearchParams({ state, auth_code: 'sample-one-use-code' });
assert.equal(acceptCallback(response, pending, 2000), 'sample-one-use-code');
const portalResponse = new URLSearchParams({ state, auth_code: 'sample-auth-code', code: 'status-code' });
assert.equal(acceptCallback(portalResponse, pending, 2000), 'sample-auth-code');
assert.throws(() => acceptCallback(response, null, 2000));
assert.throws(() => acceptCallback(response, { ...pending, state: 'b'.repeat(64) }, 2000));
assert.throws(() => acceptCallback(response, pending, 1001 + MAX_AGE));
assert.throws(() => acceptCallback(response, pending, 999));
const duplicateAuth = new URLSearchParams({ state, auth_code: 'first-auth-code', code: 'status-code' });
duplicateAuth.append('auth_code', 'second-auth-code');
assert.throws(() => acceptCallback(duplicateAuth, pending, 2000));
const duplicateCode = new URLSearchParams({ state, code: 'first-code' });
duplicateCode.append('code', 'second-code');
assert.throws(() => acceptCallback(duplicateCode, pending, 2000));
assert.throws(() => acceptCallback(new URLSearchParams({ state, auth_code: '', code: 'fallback-must-not-win' }), pending, 2000));
assert.throws(() => acceptCallback(new URLSearchParams({ state, auth_code: 'unsafe code', code: 'fallback-must-not-win' }), pending, 2000));
assert.throws(() => acceptCallback(new URLSearchParams(response + '&state=' + state), pending, 2000));
assert.throws(() => acceptCallback(new URLSearchParams({ state, error: '<script>' }), pending, 2000));
const malformed = new URLSearchParams({ state, unexpected_key: 'do-not-show-this-value', auth_code: 'first', code: 'second' });
malformed.append('auth_code', 'duplicate-auth-code');
assert.throws(() => acceptCallback(malformed, pending, 2000), error => {
  assert.match(error.message, /unexpected_key/);
  assert.doesNotMatch(error.message, /do-not-show-this-value|first|second|duplicate-auth-code/);
  return true;
});

// Exercise browser callback: strip URL, consume state, never persist the code, reject replay.
const source = fs.readFileSync(require.resolve('../tiktok-callback.js'), 'utf8');
function runBrowser(saved, query) {
  const nodes = Object.fromEntries(['status','connect','authorization-code','received','copy-code'].map(id => [id, { hidden: false, addEventListener() {} }]));
  const writes = [];
  vm.runInNewContext(source, {
    URL, URLSearchParams, document: { getElementById: id => nodes[id] },
    location: { search: query, pathname: '/tiktok-callback.html' },
    history: { replaceState: (...args) => writes.push(args) },
    sessionStorage: { getItem: () => saved, removeItem: () => { saved = null; }, setItem: () => assert.fail('must not save code') },
    navigator: {}, addEventListener() {}, Date: { now: () => 2000 }
  });
  assert.deepEqual(writes[0], [null, '', '/tiktok-callback.html']);
  return { saved, nodes };
}
const accepted = runBrowser(JSON.stringify(pending), '?' + response);
assert.equal(accepted.saved, null);
assert.equal(accepted.nodes['authorization-code'].value, 'sample-one-use-code');
assert.match(accepted.nodes.status.textContent, /ยังต้องยืนยัน/);
assert.notEqual(runBrowser(accepted.saved, '?' + response).nodes['authorization-code'].value, 'sample-one-use-code');

// The existing service worker must not cache OAuth navigation over the app shell.
const sw = fs.readFileSync(require.resolve('../sw.js'), 'utf8');
const handlers = {};
vm.runInNewContext(sw, { self: { location: { origin: 'https://pawdycontent.vercel.app' }, addEventListener: (name, fn) => { handlers[name] = fn; } }, URL });
handlers.fetch({ request: { method: 'GET', url: CALLBACK + '?auth_code=sample', mode: 'navigate' }, respondWith: () => assert.fail('must bypass OAuth navigation') });
console.log('TikTok callback checks passed: URL validation, state, expiry, replay, secret rejection and service-worker isolation.');
