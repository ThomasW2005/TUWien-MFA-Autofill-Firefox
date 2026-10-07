> [!CAUTION]
> Das ist alles komplett gevibecoded haha


# TU Wien automatic login for Firefox and Chrome

A dependency-free WebExtension for desktop Firefox and Firefox for Android 140 or newer, and desktop Google Chrome 121 or newer. It fills and submits username/email, password, and time-based authenticator codes on HTTPS `tuwien.ac.at`, `tuwien.at`, and their subdomains. It supports password and MFA on separate pages, combined forms, and username-first login forms. There is no telemetry, credential sync, external service, or remote code.

## One source, two generated distributions

Edit only `extension/`. Its JavaScript, HTML, CSS and `manifest.json` are the single source of truth. Run:

```sh
python3 scripts/build.py
```

This generates `dist/firefox/` and `dist/chrome/`, plus the unsigned Firefox XPI and Chrome ZIP. The complete contents, including `manifest.json`, are identical in both folders. Both browsers use Manifest V3. `service-worker.js` is a small Chrome entry point that loads the shared background code. There are no separate copies of the login implementation to maintain. Generated folders are replaced on each build; do not edit them directly.

The shared V3 manifest specifies both `background.scripts` and `background.service_worker`. Firefox desktop and Android use the background scripts as an event page; Chrome 121+ uses the service worker and ignores the scripts. No V2 build is generated. See [Mozilla's cross-browser background documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background#cross-browser_manifest_v3_background_scripts).

## Configure

Open the extension from your browser's extensions menu. Settings open in a full browser tab on desktop and Android.

1. Enter your TU Wien username/email and password.
2. Enter the **Base32 authenticator setup secret** or an `otpauth://totp/...` URI from the MFA enrollment QR code. This is the long-lived secret, **not** the current six-digit code. If your authenticator cannot export it, obtain it through the university's MFA setup process; the extension cannot recover it from existing codes. Keep your device clock synchronized.
3. If settings say website access is missing, select **Allow access to TU Wien websites** and approve the browser prompt. This explicit button also handles Android permission prompts.
4. Enable automatic login and save. Visit the service you want, such as TISS, and let its login redirect run normally.

Once configured, recognized login forms are filled and submitted without another click. The setup-secret field is a text area rather than a password input, so password managers have less reason to misclassify it. Saved secrets are not inserted into the field: leaving it blank preserves the existing secret. To switch to password-only login, select **Remove saved authenticator secret** and save. MFA automation supports TOTP (SHA-1/SHA-256/SHA-512, 6 or 8 digits, 15–120 second periods). Push approval, SMS, CAPTCHA, passkeys and hardware security keys cannot be automated by this extension.

The detector uses standard autocomplete attributes and common English/German field names. Optional CSS selectors in settings override username, password, MFA and submit detection. For example, `input[name="username"]`, `input[name="password"]` and `input[name="otp"]`. Selectors apply to all supported sites; leave them blank unless needed. The supplied AuthState URL is session-specific; start from the service's normal login link rather than bookmarking that URL.

## Install on desktop for development

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on** and choose `extension/manifest.json`.
3. Configure the extension. Temporary installation ends when Firefox restarts.

For persistent installation, use a Mozilla-signed XPI as described below.

## Install on desktop Chrome

1. Run `python3 scripts/build.py` to generate both browser builds.
2. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
3. Select **Load unpacked** and choose the generated `dist/chrome` folder.
4. Click the extension in Chrome's extensions menu to open settings. Configure your credentials separately from Firefox; settings are not synced between browsers.

Alternatively, extract `dist/tuwien-auto-login-1.1.0-chrome.zip` and load that extracted folder. Keep the folder in place while the unpacked extension is installed. After code changes, rebuild and click **Reload** on the Chrome extensions page, then refresh TU Wien tabs.

Both builds use the same Manifest V3 manifest, site permissions and login logic. Chrome runs the service worker, with a message-response adapter for older Chrome versions. Installation follows [Chrome's unpacked extension guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

**Google Chrome on Android does not support installing this extension.** Google's mobile “Add to Desktop” feature installs extensions on your computer. Continue using Firefox for Android for mobile login. See [Chrome's extension installation help](https://support.google.com/chrome/answer/187443).

## Install on Firefox for Android

This extension targets **Firefox for Android**. Firefox on iOS does not provide the Android WebExtension environment. The implementation uses Manifest V3 with Android-compatible storage, content scripts, an event page, and full-tab settings. Settings show whether the required TU Wien site permissions are granted and provide a button to request them explicitly.

For a permanent Android installation, first obtain a **Mozilla-signed** package. The generated unsigned XPI is a build artifact; it cannot be installed permanently in ordinary release Firefox.

1. Run `python3 scripts/build.py`.
2. Submit the generated XPI at [Mozilla's Add-on Developer Hub](https://addons.mozilla.org/developers/) using the **unlisted / distribute yourself** option, then download the signed XPI. You can alternatively publish a listed add-on with Android compatibility and install from AMO. Signing/review requires your Mozilla account and may require further review; this repository does not include signing credentials.
3. Transfer the **signed** XPI to your Android device.
4. In Firefox, open **Settings → About Firefox** and tap the Firefox logo five times quickly.
5. Return to Settings and select **Install Extension from File**, choose the signed XPI, and approve installation.
6. Open the extension from the extensions menu and configure it on that device.

These file-install instructions follow [Mozilla's Android installation documentation](https://extensionworkshop.com/documentation/publish/install-self-distributed/). For USB development testing, Mozilla documents `web-ext run -t firefox-android --adb-device DEVICE_ID --firefox-apk org.mozilla.firefox` in its [Android extension development guide](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/). Install `web-ext` and Android platform tools separately if using this route.

## Updating from version 1.0.x

Version 1.1.0 migrates to Manifest V3 only. The Firefox extension ID, Chrome unpacked folder, and storage keys are unchanged, so updating the same installation preserves credentials and the MFA secret. Reload the extension and refresh existing TU Wien tabs. Avoid uninstalling first if you want to retain settings. Open settings after upgrading and check the website-access status; grant access if requested.

## Credential storage and behavior

Credentials and the authenticator secret are saved in `browser.storage.local` in your browser profile, **without encryption**. The extension does not transmit them to external servers; it writes them into allowed login forms, which submit to TU Wien. Anyone who can read your profile can retrieve both factors. Storing both factors together reduces MFA's protection. This storage choice enables unattended login across browser restarts; there is no master-password prompt. See [Mozilla's storage documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage).

- Only exact TU Wien domains and their subdomains over HTTPS are allowed. Names like `eviltuwien.at` and `tuwien.at.example.com` are excluded.
- Only top-level POST forms are automated; foreign form actions and submit destinations, password change/reset and enrollment forms are skipped.
- Automatic submission is limited to one attempt per login flow and stage per minute, up to three per ten minutes. SimpleSAML `AuthState` identifies each flow, so a new login after logout can submit immediately. Pages without `AuthState` share a limit per origin and stage. Autofill remains available when automatic submission is paused. Use **Reset retry limits** after fixing credentials if you want to try immediately.
- Codes with five seconds or less remaining are delayed until the next TOTP interval. Each code issued for automatic submission is reserved across tabs and login flows; another automatic login waits until the next interval rather than reusing it. Expired codes on forms that have not submitted are refreshed. Codes used manually or on another device are not tracked.
- Required consent fields and other browser form validation are respected.
- Disable automatic login before logging out if you want to stay logged out. Use **Delete credentials** to clear the stored configuration.

## Verify and build

```sh
python3 scripts/build.py
node tests/extension.test.cjs
node tests/chrome-options.test.cjs
```

The tests cover RFC 6238 vectors for all supported algorithms, secret import, domain boundaries, credential release, concurrent retry limits, logout/new-login flows, code expiry, restored Firefox pages, cleared fields, and form filling/submission with a simulated DOM. Additional tests cover the Chrome service worker and callback message responses, persistence across worker restarts, identical generated V3 manifests, Firefox V3 event-page startup, granted/denied site permissions, and preserving/replacing/removing saved MFA secrets. They need only Node.js and Python for packaging. For Mozilla's complete manifest/API linting, install `web-ext` and run `web-ext lint --source-dir extension`.

**Validation limits:** All 37 automated tests pass, JavaScript syntax checks pass, and both packaged distributions have identical contents. Full `web-ext lint` could not run because npm registry DNS resolution failed in this environment. The real session-specific TU Wien login page was unavailable during implementation. Automated tests use simulated login forms; actual TU Wien selectors and login behavior still need a desktop and Android device check with your account. The Chrome build is checked with a simulated extension API; Chrome is not installed in the development environment, so a real Chrome browser check is still required. No real credentials have been entered, no live login has been performed, and no signed package has been obtained.
