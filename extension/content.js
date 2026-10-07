'use strict';
(() => {
  if (window.top !== window || !TULogin.allowed(location.href)) return;
  let busy = false;
  let completed = new WeakMap();
  const visible = el => el && !el.disabled && !el.readOnly && el.type !== 'hidden' && el.getClientRects().length > 0;
  const identity = el => [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), ...Array.from(el.labels || [], l => l.textContent)].join(' ').toLowerCase();
  function select(form, selector, fallback) {
    if (selector) { try { return Array.from(form.querySelectorAll(selector)).find(visible); } catch { return null; } }
    return Array.from(form.querySelectorAll('input')).find(el => visible(el) && fallback(el));
  }
  function fill(el, value) {
    if (!el || value === undefined) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }
  async function scan() {
    if (busy) return;
    busy = true;
    try {
      const {settings} = await browser.storage.local.get('settings');
      if (!settings?.enabled) return;
      for (const form of document.forms) {
        if (!TULogin.allowed(form.action || location.href) || form.method.toLowerCase() !== 'post') continue;
        // Never automate password changes, signup or authenticator enrollment.
        if (form.querySelector('input[autocomplete="new-password"]') || /register|signup|reset|change.?password|enroll|setup/i.test(new URL(form.action || location.href).pathname)) continue;
        const selectors = settings.selectors || {};
        const otp = select(form, selectors.otp, el => el.autocomplete === 'one-time-code' || /(^|[\W_])(otp|totp|mfa|token|verification|authcode|code)([\W_]|$)|one.?time|einmal|bestätigungscode|sicherheitscode/.test(identity(el)));
        const pass = select(form, selectors.password, el => el.type === 'password' && el !== otp);
        if (Array.from(form.querySelectorAll('input[type="password"]')).filter(visible).length > (otp?.type === 'password' ? 2 : 1)) continue;
        const user = select(form, selectors.username, el => ['text', 'email', ''].includes(el.type) && el !== otp && (el.autocomplete === 'username' || /username|user.?name|email|e-mail|benutzer|kennung|login|userid/.test(identity(el))));
        if (!pass && !otp && !user) continue;
        const previous = completed.get(form);
        if (previous && previous.url === location.href && previous.user === user && previous.pass === pass && previous.otp === otp &&
            (!user || user.value === previous.username) && (!pass || pass.value === previous.password) && (!otp || otp.value === previous.code) &&
            (previous.submitted || !previous.validUntil || previous.validUntil - Date.now() > 5000)) continue;
        const stage = pass ? (otp ? 'combined' : 'credentials') : otp ? 'mfa' : 'username';
        if (stage === 'username' && !/login|signin|anmeld|auth/i.test(form.action + ' ' + location.pathname)) continue;
        if (pass && !user && !settings.username) continue;
        const submit = selectors.submit ? form.querySelector(selectors.submit) : Array.from(form.querySelectorAll('button, input[type="submit"]')).find(el => visible(el) && (el.type === 'submit') && !/cancel|abbrechen|back|zurück/.test(identity(el) + ' ' + el.textContent.toLowerCase()));
        if (submit && (submit.disabled || (submit.formAction && !TULogin.allowed(submit.formAction)) || (submit.hasAttribute('formmethod') && submit.formMethod.toLowerCase() !== 'post'))) continue;
        const reply = await browser.runtime.sendMessage({type: 'login', stage, action: submit?.hasAttribute('formaction') ? submit.formAction : form.action || location.href});
        if (reply?.wait) { setTimeout(scan, reply.wait); return; }
        if (!reply || reply.error) continue;
        if (reply.validUntil && reply.validUntil - Date.now() <= 5000) { setTimeout(scan, Math.max(200, reply.validUntil - Date.now() + 200)); return; }
        fill(user, reply.username); fill(pass, reply.password); fill(otp, reply.code);
        const state = {url: location.href, user, pass, otp, username: user?.value, password: pass?.value, code: otp?.value, validUntil: reply.validUntil, submitted: false};
        completed.set(form, state);
        if (reply.autoSubmit !== false && form.checkValidity()) {
          if (reply.validUntil && reply.validUntil - Date.now() <= 5000) { completed.delete(form); schedule(); return; }
          state.submitted = true;
          if (submit) submit.click();
          else form.requestSubmit();
        }
        return;
      }
    } catch { /* Invalid selectors or navigation: leave the page usable. */ }
    finally { busy = false; }
  }
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 200); };
  new MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'class', 'style']});
  browser.storage.onChanged.addListener(changes => {
    if (changes.settings) { completed = new WeakMap(); schedule(); }
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) completed = new WeakMap();
    schedule();
  });
  setInterval(scan, 2000);
  scan();
})();
