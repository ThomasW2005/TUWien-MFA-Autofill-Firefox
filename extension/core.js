/* Shared validation and RFC 6238 TOTP. No third-party code or network requests. */
(function (root) {
  'use strict';
  function allowed(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && !u.username && !u.password &&
        ['tuwien.at', 'tuwien.ac.at'].some(d => u.hostname === d || u.hostname.endsWith('.' + d));
    } catch { return false; }
  }
  function secretBytes(secret) {
    const s = secret.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
    if (!s || /[^A-Z2-7]/.test(s)) throw new Error('Enter a valid Base32 authenticator secret.');
    let bits = 0, value = 0;
    const bytes = [];
    for (const c of s) {
      value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);
      bits += 5;
      if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
    }
    if (!bytes.length || (bits && (value & ((1 << bits) - 1)))) throw new Error('Invalid Base32 secret.');
    return new Uint8Array(bytes);
  }
  function parseSecret(input) {
    let secret = input.trim(), algorithm = 'SHA-1', digits = 6, period = 30;
    if (secret.startsWith('otpauth://')) {
      const u = new URL(secret);
      if (u.hostname !== 'totp') throw new Error('Only TOTP authenticator accounts are supported.');
      secret = u.searchParams.get('secret') || '';
      algorithm = (u.searchParams.get('algorithm') || 'SHA1').toUpperCase().replace(/^SHA-?/, 'SHA-');
      digits = Number(u.searchParams.get('digits') || 6);
      period = Number(u.searchParams.get('period') || 30);
    }
    if (!['SHA-1', 'SHA-256', 'SHA-512'].includes(algorithm) || ![6, 8].includes(digits) || !Number.isInteger(period) || period < 15 || period > 120) throw new Error('Unsupported TOTP parameters.');
    secretBytes(secret);
    return {secret, algorithm, digits, period};
  }
  async function totp(config, now = Date.now()) {
    const counter = BigInt(Math.floor(now / 1000 / config.period));
    const message = new Uint8Array(8);
    new DataView(message.buffer).setBigUint64(0, counter);
    const key = await crypto.subtle.importKey('raw', secretBytes(config.secret), {name: 'HMAC', hash: config.algorithm}, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
    const offset = mac[mac.length - 1] & 15;
    const value = new DataView(mac.buffer).getUint32(offset) & 0x7fffffff;
    return String(value % (10 ** config.digits)).padStart(config.digits, '0');
  }
  root.TULogin = {allowed, secretBytes, parseSecret, totp};
})(globalThis);
