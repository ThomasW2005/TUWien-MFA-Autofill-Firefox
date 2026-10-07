const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = file => fs.readFileSync('extension/' + file, 'utf8');
function worker(data = {}) {
  let listener, click;
  const api = {
    action: {onClicked: {addListener(fn) { click = fn; }}},
    storage: {local: {
      async get(keys) { return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])])); },
      async set(values) { Object.assign(data, structuredClone(values)); }
    }},
    runtime: {onInstalled: {addListener() {}}, onMessage: {addListener(fn) { listener = fn; }}, async openOptionsPage() { data.opened = true; }}
  };
  const ctx = vm.createContext({chrome: api, URL, Uint8Array, DataView, crypto: webcrypto, Date: class extends Date {static now() { return 605000; }}});
  ctx.importScripts = (...files) => files.forEach(file => vm.runInContext(source(file), ctx));
  vm.runInContext(source('service-worker.js'), ctx);
  const sender = {tab: {id: 1}, frameId: 0, url: 'https://idp.zid.tuwien.ac.at/login?AuthState=one'};
  return {ctx, data, click, get listener() { return listener; }, request: (stage, state = 'one') => new Promise(resolve => {
    const result = listener({type: 'login', stage, action: sender.url}, {...sender, url: sender.url.replace('one', state)}, resolve);
    assert.equal(result, true, 'async Chrome response keeps the message channel open');
  })};
}
const settings = () => ({enabled: true, username: 'test-user', password: 'test-password', totp: {secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA-1', digits: 6, period: 30}});
test('Chrome worker loads scripts, handles credentials and opens full-tab settings', async () => {
  const w = worker({settings: settings()});
  const result = await w.request('credentials');
  assert.equal(result.username, 'test-user'); assert.equal(result.password, 'test-password');
  assert.equal(w.listener({type: 'unrelated'}, {}, () => {}), false);
  await w.click(); assert.equal(w.data.opened, true);
});
test('Chrome worker restart preserves TOTP reservations across login flows', async () => {
  const data = {settings: settings()};
  const first = await worker(data).request('mfa');
  assert.match(first.code, /^\d{6}$/);
  const restarted = worker(data);
  const reply = await restarted.request('mfa', 'two');
  assert.equal(reply.wait, 25200); assert.equal(reply.code, undefined);
});
test('compatibility script preserves the Firefox namespace', () => {
  const browser = {runtime: {}};
  const ctx = vm.createContext({browser});
  vm.runInContext(source('compat.js'), ctx);
  assert.equal(ctx.browser, browser);
});
test('Chrome adapter replies safely to a rejected handler', async () => {
  const w = worker();
  w.ctx.browser.runtime.onMessage.addListener(() => Promise.reject(new Error('test')));
  const reply = await new Promise(resolve => { assert.equal(w.listener({}, {}, resolve), true); });
  assert.match(reply.error, /Unable to prepare login/);
});
async function options({hasAccess = true, requestAllowed = true} = {}) {
  let containsAccess = hasAccess, requestedOrigins;
  const data = {settings: settings()};
  const elements = {};
  const get = id => elements[id] ||= {value: '', checked: false, placeholder: '', textContent: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }};
  const ctx = vm.createContext({URL, Uint8Array, DataView, crypto: webcrypto,
    document: {getElementById: get, querySelector() {}},
    browser: {runtime: {getManifest: () => JSON.parse(source('manifest.json'))}, permissions: {async contains() { return containsAccess; }, async request({origins}) { requestedOrigins = origins; containsAccess = requestAllowed; return requestAllowed; }, onAdded: {addListener() {}}, onRemoved: {addListener() {}}}, storage: {local: {async get() { return structuredClone(data); }, async set(values) { Object.assign(data, structuredClone(values)); }, async clear() { for (const key in data) delete data[key]; }, async remove(key) { delete data[key]; }}}}
  });
  vm.runInContext(source('core.js'), ctx);
  vm.runInContext(source('options.js'), ctx);
  await new Promise(resolve => setImmediate(resolve));
  return {data, get, requested: () => requestedOrigins, grant: () => get('grantSiteAccess').listeners.click(), save: () => get('settings').listeners.submit({preventDefault() {}})};
}
test('saved MFA secret is not populated into settings and blank saves preserve it', async () => {
  const o = await options();
  assert.equal(o.get('secret').value, '');
  assert.match(o.get('secret').placeholder, /Secret saved/);
  o.get('username').value = 'new-user';
  await o.save();
  assert.equal(o.data.settings.username, 'new-user');
  assert.equal(o.data.settings.totp.secret, settings().totp.secret);
});
test('replacement secret is saved and cleared from the settings field', async () => {
  const o = await options(); o.get('secret').value = 'JBSWY3DPEHPK3PXP';
  await o.save();
  assert.equal(o.data.settings.totp.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(o.get('secret').value, '');
});
test('explicit removal enables password-only login', async () => {
  const o = await options(); o.get('removeSecret').checked = true;
  await o.save();
  assert.equal(o.data.settings.totp, null);
  assert.equal(o.get('removeSecret').checked, false);
});
test('conflicting replacement/removal does not overwrite settings', async () => {
  const o = await options(); o.get('secret').value = 'JBSWY3DPEHPK3PXP'; o.get('removeSecret').checked = true;
  await o.save();
  assert.equal(o.data.settings.totp.secret, settings().totp.secret);
  assert.match(o.get('status').textContent, /Could not save/);
});
test('setup secret is a non-password text area with autofill disabled', () => {
  assert.match(source('options.html'), /<textarea id="secret"[^>]*autocomplete="off"/);
  assert.doesNotMatch(source('options.html'), /<input id="secret"/);
});
test('Firefox and Chrome packages have appropriate manifests and complete assets', () => {
  const firefox = JSON.parse(source('manifest.json'));
  const chrome = JSON.parse(fs.readFileSync('dist/chrome/manifest.json', 'utf8'));
  assert.equal(chrome.version, firefox.version, 'run python3 scripts/build.py before this suite');
  assert.equal(firefox.manifest_version, 3); assert.equal(chrome.manifest_version, 3);
  assert.equal(chrome.background.service_worker, 'service-worker.js');
  assert.deepEqual(chrome.background.scripts, ['compat.js', 'core.js', 'background.js']);
  assert.equal(chrome.minimum_chrome_version, '121');
  assert.equal(chrome.background.persistent, undefined);
  assert.equal(chrome.browser_action, undefined);
  assert.deepEqual(chrome, firefox);
  assert.deepEqual(chrome.host_permissions, firefox.content_scripts[0].matches);
  assert.deepEqual(chrome.permissions, ['storage']); assert.ok(chrome.action);
  assert.equal(chrome.content_scripts[0].js[0], 'compat.js');
  for (const file of [...chrome.content_scripts[0].js, chrome.background.service_worker, chrome.options_ui.page, 'options.js', 'compat.js', 'core.js', 'background.js']) {
    assert.ok(fs.existsSync('dist/chrome/' + file), file);
  }
});

test('both generated distributions share every code asset and Firefox source metadata', () => {
  const files = fs.readdirSync('extension').filter(name => /\.(js|json|html|css)$/.test(name));
  for (const name of files.filter(name => name !== 'manifest.json')) {
    assert.equal(fs.readFileSync('dist/firefox/' + name, 'utf8'), source(name), name);
    assert.equal(fs.readFileSync('dist/chrome/' + name, 'utf8'), source(name), name);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync('dist/firefox/manifest.json', 'utf8')), JSON.parse(source('manifest.json')));
});

test('missing MV3 site permissions are visible and can be granted from settings', async () => {
  const o = await options({hasAccess: false});
  assert.equal(o.get('grantSiteAccess').hidden, false);
  assert.match(o.get('siteAccessStatus').textContent, /access is missing/);
  await o.grant();
  assert.deepEqual(Array.from(o.requested()), JSON.parse(source('manifest.json')).host_permissions);
  assert.equal(o.get('grantSiteAccess').hidden, true);
  assert.match(o.get('status').textContent, /Website access allowed/);
});
test('denied site permissions retain the grant button and explain why login cannot run', async () => {
  const o = await options({hasAccess: false, requestAllowed: false});
  await o.grant();
  assert.equal(o.get('grantSiteAccess').hidden, false);
  assert.match(o.get('status').textContent, /cannot run yet/);
  await o.save();
  assert.match(o.get('status').textContent, /Allow TU Wien website access/);
});

test('Firefox V3 event page runs the shared scripts without service-worker globals', async () => {
  let listener, click;
  const data = {settings: settings()};
  const browser = {
    action: {onClicked: {addListener(fn) { click = fn; }}},
    runtime: {onInstalled: {addListener() {}}, onMessage: {addListener(fn) { listener = fn; }}, async openOptionsPage() { data.opened = true; }},
    storage: {local: {
      async get(keys) { return Object.fromEntries(keys.filter(k => k in data).map(k => [k, structuredClone(data[k])])); },
      async set(values) { Object.assign(data, structuredClone(values)); }
    }}
  };
  const ctx = vm.createContext({browser, URL, Uint8Array, DataView, crypto: webcrypto, Date: class extends Date {static now() { return 605000; }}});
  const manifest = JSON.parse(source('manifest.json'));
  for (const script of manifest.background.scripts) vm.runInContext(source(script), ctx);
  const url = 'https://idp.zid.tuwien.ac.at/login?AuthState=firefox-v3';
  const reply = await listener({type: 'login', stage: 'combined', action: url}, {tab: {id: 1}, frameId: 0, url});
  assert.equal(reply.username, 'test-user'); assert.equal(reply.password, 'test-password');
  assert.match(reply.code, /^\d{6}$/);
  assert.equal(reply.autoSubmit, true);
  await click(); assert.equal(data.opened, true);
});
