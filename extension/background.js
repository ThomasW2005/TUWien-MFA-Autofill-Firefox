'use strict';
browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());
browser.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') browser.runtime.openOptionsPage();
});
// Serialize claims across tabs so parallel login pages cannot defeat the retry limit.
let queue = Promise.resolve();
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'login') return;
  const run = queue.then(() => handle(message, sender));
  queue = run.catch(() => {});
  return run.catch(() => ({error: 'Unable to prepare login. Check settings.'}));
});
async function handle(message, sender) {
  if (!sender.tab || sender.frameId !== 0 || !TULogin.allowed(sender.url) || !TULogin.allowed(message.action) || !['credentials', 'mfa', 'combined', 'username'].includes(message.stage)) return null;
  const {settings, attempts = {}, totpUse} = await browser.storage.local.get(['settings', 'attempts', 'totpUse']);
  if (!settings?.enabled || !settings.username || !settings.password) return null;
  if (['mfa', 'combined'].includes(message.stage) && !settings.totp) return null;
  const now = Date.now();
  const page = new URL(sender.url);
  // SimpleSAML assigns a new AuthState to each login flow. Failed submissions
  // retain that state; logging out and starting a new login gets a fresh one.
  const state = page.searchParams.get('AuthState');
  const key = JSON.stringify([page.origin, state || 'default', message.stage]);
  const recent = (attempts[key] || []).filter(t => now - t < 600000);
  const autoSubmit = recent.length < 3 && !recent.some(t => now - t < 60000);
  let fingerprint, validUntil;
  if (settings.totp && ['mfa', 'combined'].includes(message.stage)) {
    const periodMs = settings.totp.period * 1000;
    validUntil = (Math.floor(now / periodMs) + 1) * periodMs;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', TULogin.secretBytes(settings.totp.secret)));
    fingerprint = [Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), settings.totp.algorithm, settings.totp.digits, settings.totp.period].join(':');
    // Recomputing TOTP within the same time step returns the same code.
    // Reserve each issued automatic-login code across flows and tabs.
    if (validUntil - now <= 5000 || (autoSubmit && totpUse?.fingerprint === fingerprint && totpUse.validUntil > now)) {
      return {wait: Math.max(validUntil, totpUse?.fingerprint === fingerprint ? totpUse.validUntil : 0) - now + 200};
    }
  }
  const result = {autoSubmit};
  if (message.stage !== 'mfa') result.username = settings.username;
  if (['credentials', 'combined'].includes(message.stage)) result.password = settings.password;
  if (['mfa', 'combined'].includes(message.stage)) {
    result.code = await TULogin.totp(settings.totp, now);
    result.validUntil = validUntil;
    if (validUntil - Date.now() <= 5000) return {wait: Math.max(200, validUntil - Date.now() + 200)};
  }
  for (const [k, ts] of Object.entries(attempts)) {
    attempts[k] = ts.filter(t => now - t < 600000);
    if (!attempts[k].length) delete attempts[k];
  }
  if (autoSubmit) {
    attempts[key] = [...recent, now];
    await browser.storage.local.set({attempts, ...(result.code ? {totpUse: {fingerprint, validUntil}} : {})});
  }
  return result;
}
