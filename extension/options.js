'use strict';
const $ = id => document.getElementById(id);
let storedTotp = null;
const manifest = browser.runtime.getManifest();
const loginOrigins = manifest.host_permissions;
$('version').textContent = 'Version ' + manifest.version;
async function updateSiteAccess() {
  const granted = await browser.permissions.contains({origins: loginOrigins});
  $('siteAccessStatus').textContent = granted ? 'TU Wien website access is allowed.' : 'Website access is missing. Allow access below so automatic login can run.';
  $('grantSiteAccess').hidden = granted;
  return granted;
}
$('grantSiteAccess').addEventListener('click', async () => {
  try {
    // Request directly from the click handler to retain the user gesture on Android.
    const granted = await browser.permissions.request({origins: loginOrigins});
    await updateSiteAccess();
    $('status').textContent = granted ? 'Website access allowed. Refresh your TU Wien login tab.' : 'Website access was not granted. Automatic login cannot run yet.';
  } catch { $('status').textContent = 'Unable to request website access. Check your browser extension permissions.'; }
});
browser.permissions.onAdded.addListener(() => { updateSiteAccess().catch(() => {}); });
browser.permissions.onRemoved.addListener(() => { updateSiteAccess().catch(() => {}); });
async function load() {
  const {settings = {}} = await browser.storage.local.get('settings');
  $('enabled').checked = settings.enabled ?? false;
  $('username').value = settings.username || '';
  $('password').value = settings.password || '';
  storedTotp = settings.totp || null;
  $('secret').value = '';
  $('secret').placeholder = storedTotp ? 'Secret saved. Leave blank to keep it.' : 'Paste a new setup secret here';
  $('removeSecret').checked = false;
  for (const key of ['username', 'password', 'otp', 'submit']) $(key + 'Selector').value = settings.selectors?.[key] || '';
  await updateSiteAccess();
}
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if ($('removeSecret').checked && $('secret').value.trim()) throw new Error('Enter a replacement secret or select removal, not both.');
    const totp = $('secret').value.trim() ? TULogin.parseSecret($('secret').value) : $('removeSecret').checked ? null : storedTotp;
    if (totp) await TULogin.totp(totp);
    const selectors = {};
    for (const key of ['username', 'password', 'otp', 'submit']) {
      selectors[key] = $(key + 'Selector').value.trim();
      if (selectors[key]) document.querySelector(selectors[key]);
    }
    await browser.storage.local.set({settings: {enabled: $('enabled').checked, username: $('username').value.trim(), password: $('password').value, totp, selectors}, attempts: {}});
    await load();
    $('status').textContent = await browser.permissions.contains({origins: loginOrigins}) ? 'Saved. Automatic login will run on matching open pages.' : 'Saved. Allow TU Wien website access above, then refresh your login tab.';
  } catch (error) { $('status').textContent = 'Could not save: ' + error.message; }
});
$('reset').addEventListener('click', async () => { await browser.storage.local.remove('attempts'); $('status').textContent = 'Retry limits reset.'; });
$('clear').addEventListener('click', async () => { await browser.storage.local.clear(); await load(); $('status').textContent = 'Credentials deleted. Automatic login disabled.'; });
load().catch(() => { $('status').textContent = 'Unable to load settings.'; });
