# TUWien-MFA-Autofill

Automatically fills and submits TU Wien login forms, including authenticator codes. Works on desktop Firefox 140+, Firefox for Android 140+, and desktop Chrome 121+.

Download from [GitHub Releases](https://github.com/ThomasW2005/TUWien-MFA-Autofill-Firefox/releases/latest). This add-on is self-distributed through GitHub and signed by Mozilla; it is not distributed through a public Mozilla add-on store listing.

> [!CAUTION]
> Das ist alles komplett gevibecoded haha

## Install: Firefox on a computer

1. Download the file ending in **`-firefox.xpi`** from [the latest release](https://github.com/ThomasW2005/TUWien-MFA-Autofill-Firefox/releases/latest).
2. In Firefox, open **`about:addons`**.
3. Click the **gear icon → Install Add-on From File**, select the downloaded file, and confirm **Add**.

## Install: Chrome on a computer

1. Download the file ending in **`-chrome.zip`** from [the latest release](https://github.com/ThomasW2005/TUWien-MFA-Autofill-Firefox/releases/latest) and extract it.
2. Open **`chrome://extensions`** and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.

Keep that folder on your computer. Do not select the ZIP itself or GitHub's “Source code” downloads. These steps follow [Chrome's installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Install: Firefox on Android

1. Download the file ending in **`-firefox.xpi`** from [the latest release](https://github.com/ThomasW2005/TUWien-MFA-Autofill-Firefox/releases/latest) onto your phone.
2. In Firefox, open **Settings → About Firefox** and tap the **Firefox logo five times quickly**.
3. Return to **Settings → Install Extension from File**, select the downloaded file, and confirm **Add**.

The Firefox steps follow [Mozilla's file-install guide](https://extensionworkshop.com/documentation/publish/install-self-distributed/). Firefox on iPhone/iPad and Chrome on Android cannot run this extension.

## Set up after installing

1. Open **TUWien-MFA-Autofill** from your browser's extensions menu.
2. Enter your TU Wien username/email and password.
3. Paste your authenticator's **setup secret** or `otpauth://totp/...` URI. This is the secret from your MFA setup QR code, not the changing six-digit code. Leave it empty for password-only login.
4. If shown, click **Allow access to TU Wien websites** and approve.
5. Enable **automatic login**, click **Save settings**, and visit your usual TU Wien service, such as TISS.

Configure each browser/device separately. Settings are not synced. Leave custom selectors empty unless automatic detection fails. Keep your device clock synchronized.

A blank secret field preserves a previously saved secret. To remove it, select **Remove saved authenticator secret** and save. Push approval, SMS, CAPTCHA, passkeys and hardware security keys cannot be automated.

## Updates

**Firefox:** Updates are delivered through GitHub automatically when add-on automatic updates are enabled. Checks normally run about once every 24 hours; restarting Firefox does not guarantee an immediate update. On desktop, check now with **`about:addons` → gear icon → Check for Updates**. The installed version appears on the extension's settings page. See [Mozilla's update guide](https://extensionworkshop.com/documentation/manage/updating-your-extension/).

**Chrome:** Download and extract the new Chrome ZIP into the same folder you originally loaded, replacing its files. Then click **Reload** for the extension at `chrome://extensions` and refresh TU Wien tabs. Unpacked Chrome extensions do not use the Firefox update manifest.

Keep the extension installed to retain its settings. Older packages with the previous ID `tuwien-auto-login@local.extension` are a separate extension and cannot automatically update to the current ID.

## Credential storage and behavior


Credentials and the authenticator secret are saved in `browser.storage.local` in your browser profile, **without encryption**. The extension does not transmit them to external servers; it writes them into allowed login forms, which submit to TU Wien. Anyone who can read your profile can retrieve both factors. Storing both factors together reduces MFA's protection. This storage choice enables unattended login across browser restarts; there is no master-password prompt. See [Mozilla's storage documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage).

- Only exact TU Wien domains and their subdomains over HTTPS are allowed. Names like `eviltuwien.at` and `tuwien.at.example.com` are excluded.
- Only top-level POST forms are automated; foreign form actions and submit destinations, password change/reset and enrollment forms are skipped.
- Automatic submission is limited to one attempt per login flow and stage per minute, up to three per ten minutes. SimpleSAML `AuthState` identifies each flow, so a new login after logout can submit immediately. Pages without `AuthState` share a limit per origin and stage. Autofill remains available when automatic submission is paused. Use **Reset retry limits** after fixing credentials if you want to try immediately.
- Codes with five seconds or less remaining are delayed until the next TOTP interval. Each code issued for automatic submission is reserved across tabs and login flows; another automatic login waits until the next interval rather than reusing it. Expired codes on forms that have not submitted are refreshed. Codes used manually or on another device are not tracked.
- Required consent fields and other browser form validation are respected.
- Disable automatic login before logging out if you want to stay logged out. Use **Delete credentials** to clear the stored configuration.

## Development and releases

Edit `extension/`; generated files in `dist/` are replaced by the build. Both browser packages share the same Manifest V3 manifest and code. Firefox uses background scripts; Chrome uses the service worker.

```sh
python3 scripts/build.py
node tests/extension.test.cjs
node tests/chrome-options.test.cjs
```

For temporary Firefox development, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `extension/manifest.json`. This installation ends when Firefox restarts. For Chrome development, load `dist/chrome` as an unpacked extension.

To publish a new release:

1. Increase the version in `extension/manifest.json` and build.
2. Upload the generated `-unsigned.xpi` to [Mozilla's Developer Hub](https://addons.mozilla.org/developers/) for **self-distribution signing**, then download the signed XPI. Do not modify the signed archive.
3. Create GitHub release `vVERSION`. Upload the **signed** file as `TUWien-MFA-Autofill-Firefox-VERSION-firefox.xpi` and the generated `TUWien-MFA-Autofill-Firefox-VERSION-chrome.zip`.
4. Update `docs/updates.json` with the new version and exact signed-file download URL. Publish it only after the signed asset is available.
5. Test from an older signed installation with the same ID and update URL using **Check for Updates**.

Keep the ID `TUWien-MFA-Autofill-Firefox@ThomasW2005.github.io` and update URL `https://thomasw2005.github.io/TUWien-MFA-Autofill-Firefox/updates.json` stable. GitHub Pages serves `docs/` with `.nojekyll`; the update manifest and landing page live there. The display name is `TUWien-MFA-Autofill`.

The automated tests cover login behavior, TOTP, permissions, settings, and packaging with simulated browser APIs and login forms. Real browser/device checks are still needed for changes affecting TU Wien forms or mobile behavior. Full Mozilla linting can be run with `web-ext lint --source-dir extension` after installing `web-ext`.
