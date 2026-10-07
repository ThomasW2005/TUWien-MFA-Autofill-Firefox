const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
function context(extra = {}) {
  const ctx = vm.createContext({URL, Uint8Array, DataView, crypto: webcrypto, ...extra});
  vm.runInContext(fs.readFileSync('extension/core.js', 'utf8'), ctx);
  return ctx;
}
test('exact TU Wien HTTPS domain boundaries', () => {
  const {TULogin: core} = context();
  for (const url of ['https://tuwien.at/', 'https://tuwien.ac.at/', 'https://idp.zid.tuwien.ac.at/login', 'https://a.b.tuwien.at/']) assert.equal(core.allowed(url), true);
  for (const url of ['http://tuwien.at/', 'https://eviltuwien.at/', 'https://tuwien.at.evil.example/', 'https://user:pass@tuwien.at/', 'javascript:alert(1)', 'bad']) assert.equal(core.allowed(url), false);
});
test('RFC 6238 SHA-1, SHA-256 and SHA-512 reference vectors', async () => {
  const {TULogin: core} = context();
  const encode = text => {
    let bits = 0, value = 0, result = '';
    for (const byte of Buffer.from(text)) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 5) { bits -= 5; result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value >>> bits) & 31]; }
    }
    if (bits) result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(value << (5 - bits)) & 31];
    return result;
  };
  const rows = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826']
  ];
  const secrets = ['12345678901234567890', '12345678901234567890123456789012', '1234567890123456789012345678901234567890123456789012345678901234'];
  for (const row of rows) for (let i = 0; i < 3; i++) {
    assert.equal(await core.totp({secret: encode(secrets[i]), algorithm: ['SHA-1', 'SHA-256', 'SHA-512'][i], digits: 8, period: 30}, row[0] * 1000), row[i + 1]);
  }
});
test('secret import, whitespace, URI parameters and invalid input', () => {
  const {TULogin: core} = context();
  assert.equal(core.parseSecret('gezd gnbv-gy3tqojq').digits, 6);
  const imported = core.parseSecret('otpauth://totp/TUWien?secret=GEZDGNBVGY3TQOJQ&algorithm=SHA256&digits=8&period=60');
  assert.equal(imported.algorithm, 'SHA-256'); assert.equal(imported.period, 60);
  for (const secret of ['', '123456', 'otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ', 'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQ&digits=7', 'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQ&period=0', 'ABC!']) assert.throws(() => core.parseSecret(secret));
});
function background() {
  let listener;
  let now = 600000 + 5000;
  const data = {settings: {enabled: true, username: 'test-user', password: 'test-password', totp: {secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA-1', digits: 6, period: 30}}};
  const browser = {
    action: {onClicked: {addListener() {}}},
    runtime: {onInstalled: {addListener() {}}, onMessage: {addListener(fn) { listener = fn; }}},
    storage: {local: {
      async get(keys) { return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])])); },
      async set(values) { Object.assign(data, structuredClone(values)); }
    }}
  };
  const ctx = context({browser, Date: class extends Date {static now() { return now; }}});
  vm.runInContext(fs.readFileSync('extension/background.js', 'utf8'), ctx);
  const sender = {url: 'https://idp.zid.tuwien.ac.at/login', frameId: 0, tab: {id: 1}};
  return {data, sender, request: (stage = 'credentials', overrides = {}, from = sender) => listener({type: 'login', stage, action: sender.url, ...overrides}, from), advance: ms => { now += ms; }};
}
test('background releases only the credentials needed for each stage', async () => {
  const b = background();
  const username = await b.request('username');
  assert.equal(username.username, 'test-user'); assert.equal(username.password, undefined); assert.equal(username.code, undefined);
  const credentials = await b.request();
  assert.equal(credentials.password, 'test-password'); assert.equal(credentials.code, undefined);
  const mfa = await b.request('mfa');
  assert.match(mfa.code, /^\d{6}$/); assert.equal(mfa.username, undefined); assert.equal(mfa.password, undefined);
});
test('background rejects foreign destinations, frames, senders and disabled settings', async () => {
  const b = background();
  assert.equal(await b.request('credentials', {action: 'https://evil.example/'}), null);
  assert.equal(await b.request('credentials', {}, {...b.sender, frameId: 1}), null);
  assert.equal(await b.request('credentials', {}, {...b.sender, url: 'https://eviltuwien.at/'}), null);
  assert.equal(await b.request('credentials', {}, {...b.sender, tab: undefined}), null);
  assert.equal(await b.request('unknown'), null);
  b.data.settings.enabled = false;
  assert.equal(await b.request(), null);
});
test('retry claims serialize across tabs and stop after three attempts in ten minutes', async () => {
  const b = background();
  const results = await Promise.all([b.request(), b.request(), b.request()]);
  assert.equal(results.filter(r => r.autoSubmit).length, 1);
  assert.equal(results.filter(r => r.password === 'test-password').length, 3);
  b.advance(60001); assert.ok(await b.request());
  b.advance(60001); assert.ok(await b.request());
  b.advance(60001); assert.equal((await b.request()).autoSubmit, false);
  b.advance(600000); assert.ok(await b.request());
});
test('near-expiry TOTP waits for a fresh code without spending an attempt', async () => {
  const b = background(); b.advance(23000);
  const reply = await b.request('mfa');
  assert.equal(reply.wait, 2200); assert.equal(b.data.attempts, undefined);
  b.advance(reply.wait); assert.match((await b.request('mfa')).code, /^\d{6}$/);
});
test('MFA does not submit when no setup secret is configured', async () => {
  const b = background(); b.data.settings.totp = null;
  assert.equal(await b.request('mfa'), null); assert.equal(await b.request('combined'), null);
  assert.ok(await b.request('credentials'));
});
async function contentFixture({fields, action = 'https://idp.zid.tuwien.ac.at/login', method = 'post', submitAction, valid = true, autoSubmit = true, timedCode = false}) {
  const events = [], messages = [];
  let scanAgain, onPageShow, onStorageChange;
  let now = 605000;
  class Input {
    constructor(attrs) { Object.assign(this, {type: 'text', name: '', id: '', placeholder: '', autocomplete: '', labels: [], disabled: false, readOnly: false}, attrs); }
    get value() { return this._value || ''; }
    set value(value) { this._value = value; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    getAttribute() { return ''; }
    dispatchEvent(event) { events.push([this.name, event.type]); }
  }
  const inputs = fields.map(f => new Input(f));
  let clicks = 0;
  const button = {type: 'submit', name: 'submit', id: '', placeholder: '', labels: [], textContent: 'Login', disabled: false,
    getClientRects: () => [{}], getAttribute: () => '', hasAttribute: attr => attr === 'formaction' && !!submitAction,
    formAction: submitAction || action, click: () => { clicks++; }};
  const form = {action, method,
    querySelector: selector => selector.includes('new-password') ? inputs.find(i => i.autocomplete === 'new-password') : null,
    querySelectorAll: selector => selector === 'input' ? inputs : selector === 'input[type="password"]' ? inputs.filter(i => i.type === 'password') : [button],
    checkValidity: () => valid, requestSubmit: () => { clicks++; }};
  const settings = {enabled: true, username: 'test-user', password: 'test-password'};
  const ctx = context({
    Date: class extends Date {static now() { return now; }},
    window: {top: null, addEventListener(name, fn) { if (name === 'pageshow') onPageShow = fn; }}, location: {href: action, pathname: new URL(action).pathname},
    document: {forms: [form], documentElement: {}}, HTMLInputElement: Input,
    Event: class {constructor(type) { this.type = type; }},
    MutationObserver: class {observe() {}}, setInterval(fn) { scanAgain = fn; }, setTimeout(fn) { setImmediate(fn); }, clearTimeout() {},
    browser: {storage: {local: {async get() { return {settings}; }}, onChanged: {addListener(fn) { onStorageChange = fn; }}}, runtime: {async sendMessage(m) { messages.push(m); return {username: 'test-user', password: 'test-password', code: timedCode ? String(Math.floor(now / 30000)).padStart(6, '0') : '123456', autoSubmit, ...(timedCode ? {validUntil: (Math.floor(now / 30000) + 1) * 30000} : {})}; }}}
  });
  ctx.window.top = ctx.window;
  vm.runInContext(fs.readFileSync('extension/content.js', 'utf8'), ctx);
  await new Promise(resolve => setImmediate(resolve));
  return {inputs, events, messages, clicks, clickCount: () => clicks, advance: ms => { now += ms; }, scanAgain, onPageShow, onStorageChange};
}
test('content fills a SimpleSAML-style login and clicks its submit button', async () => {
  const result = await contentFixture({fields: [{name: 'username'}, {name: 'password', type: 'password'}]});
  assert.equal(result.messages[0].stage, 'credentials');
  assert.equal(result.inputs[0].value, 'test-user'); assert.equal(result.inputs[1].value, 'test-password');
  assert.equal(result.clicks, 1); assert.equal(result.events.length, 4);
});
test('content detects separate and combined TOTP forms', async () => {
  const separate = await contentFixture({fields: [{name: 'otp', autocomplete: 'one-time-code', type: 'tel'}]});
  assert.equal(separate.messages[0].stage, 'mfa'); assert.equal(separate.inputs[0].value, '123456'); assert.equal(separate.clicks, 1);
  const combined = await contentFixture({fields: [{name: 'username'}, {name: 'password', type: 'password'}, {name: 'totp'}]});
  assert.equal(combined.messages[0].stage, 'combined'); assert.equal(combined.inputs[2].value, '123456');
});
test('content skips password changes, GET forms, hidden fields and foreign submit actions', async () => {
  const cases = [
    {fields: [{name: 'password', type: 'password', autocomplete: 'new-password'}]},
    {fields: [{name: 'password', type: 'password'}], method: 'get'},
    {fields: [{name: 'username', hidden: true}, {name: 'password', type: 'password', hidden: true}]},
    {fields: [{name: 'username'}, {name: 'password', type: 'password'}], submitAction: 'https://evil.example/'},
    {fields: [{name: 'username'}, {name: 'password', type: 'password'}], action: 'https://idp.zid.tuwien.ac.at/reset-password'}
  ];
  for (const fixture of cases) { const result = await contentFixture(fixture); assert.equal(result.messages.length, 0); assert.equal(result.clicks, 0); }
});
test('content respects form validation', async () => {
  const result = await contentFixture({fields: [{name: 'username'}, {name: 'password', type: 'password'}], valid: false});
  assert.equal(result.inputs[1].value, 'test-password'); assert.equal(result.clicks, 0);
});

test('new SimpleSAML login flow submits immediately after a previous login', async () => {
  const b = background();
  const first = {...b.sender, url: b.sender.url + '?AuthState=first-flow'};
  const second = {...b.sender, url: b.sender.url + '?AuthState=second-flow'};
  assert.equal((await b.request('credentials', {}, first)).autoSubmit, true);
  const retry = await b.request('credentials', {}, first);
  assert.equal(retry.autoSubmit, false);
  assert.equal(retry.username, 'test-user');
  assert.equal(retry.password, 'test-password');
  assert.equal((await b.request('credentials', {}, second)).autoSubmit, true);
});

test('retry-limited page still autofills without automatically submitting', async () => {
  const result = await contentFixture({fields: [{name: 'username'}, {name: 'password', type: 'password'}], autoSubmit: false});
  assert.equal(result.inputs[0].value, 'test-user');
  assert.equal(result.inputs[1].value, 'test-password');
  assert.equal(result.clicks, 0);
});
test('unchanged forms do not repeat; cleared fields are refilled', async () => {
  const result = await contentFixture({fields: [{name: 'username'}, {name: 'password', type: 'password'}]});
  await result.scanAgain();
  assert.equal(result.messages.length, 1);
  result.inputs[1].value = '';
  await result.scanAgain();
  assert.equal(result.inputs[1].value, 'test-password');
  assert.equal(result.messages.length, 2);
});
test('Firefox restored pages are processed again', async () => {
  const result = await contentFixture({fields: [{name: 'username'}, {name: 'password', type: 'password'}]});
  result.onPageShow({persisted: true});
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.messages.length, 2);
  assert.equal(result.clickCount(), 2);
});
test('attempt storage updates do not trigger repeated submissions', async () => {
  const result = await contentFixture({fields: [{name: 'username'}, {name: 'password', type: 'password'}]});
  result.onStorageChange({attempts: {newValue: {}}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.messages.length, 1);
  result.onStorageChange({settings: {newValue: {}}});
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.messages.length, 2);
});

test('TOTP is recomputed but remains identical within its time window', async () => {
  const core = context().TULogin;
  const config = {secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA-1', digits: 6, period: 30};
  assert.equal(await core.totp(config, 605000), await core.totp(config, 615000));
  assert.notEqual(await core.totp(config, 605000), await core.totp(config, 635000));
});
test('a second automatic MFA login waits for a new interval across flows', async () => {
  const b = background();
  const first = {...b.sender, url: b.sender.url + '?AuthState=first'};
  const second = {...b.sender, url: b.sender.url + '?AuthState=second'};
  const firstReply = await b.request('mfa', {}, first);
  assert.equal(firstReply.validUntil, 630000);
  const secondReply = await b.request('mfa', {}, second);
  assert.equal(secondReply.wait, 25200);
  assert.equal(secondReply.code, undefined);
  b.advance(secondReply.wait);
  const fresh = await b.request('mfa', {}, second);
  assert.equal(fresh.autoSubmit, true);
  assert.notEqual(firstReply.code, fresh.code);
});
test('parallel combined and MFA forms cannot automatically reuse the same time step', async () => {
  const b = background();
  const results = await Promise.all([b.request('combined'), b.request('mfa')]);
  assert.equal(results.filter(r => r.code).length, 1);
  assert.equal(results.filter(r => r.wait).length, 1);
});
test('TOTP reserves five seconds for submission and delivery', async () => {
  const b = background(); b.advance(21000);
  assert.equal((await b.request('mfa')).wait, 4200);
  assert.equal(b.data.totpUse, undefined);
});
test('stale MFA in an unsubmitted form is replaced when the time window changes', async () => {
  const result = await contentFixture({fields: [{name: 'otp', autocomplete: 'one-time-code'}], autoSubmit: false, timedCode: true});
  const original = result.inputs[0].value;
  await result.scanAgain(); assert.equal(result.messages.length, 1);
  result.advance(30000);
  await result.scanAgain();
  assert.notEqual(result.inputs[0].value, original);
  assert.equal(result.messages.length, 2);
  assert.equal(result.clickCount(), 0);
});
test('a submitted MFA form does not resubmit just because its code expires', async () => {
  const result = await contentFixture({fields: [{name: 'otp', autocomplete: 'one-time-code'}], timedCode: true});
  result.advance(30000); await result.scanAgain();
  assert.equal(result.messages.length, 1);
  assert.equal(result.clickCount(), 1);
});
