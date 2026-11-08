# Album Glow

Album Glow turns Spotify album artwork into a color for Apollo Bluetooth LEDs. It is a lightweight static website built from the supplied Album Glow ZIP, with the original dark visual style and color extraction retained. The owner-requested daily controls now use a simpler layout and a Settings window. It runs in Chrome on a Chromebook; no Linux setup, backend, database, or paid service is required to use it.

**Existing website and Spotify redirect:** https://cosmic-snickerdoodle-3a661b.netlify.app/ — keep this address, including its final `/`.

**Repository:** https://github.com/alexnemy/LED-lights (the existing repository chosen by the owner). `album-glow` was the proposed name; GitHub's connected integration could not create a new repository. No other remote project was modified.

## Current review status

- The original ZIP remains unchanged in Git history at `2e642fc`. The original Bluetooth update and simpler controls were merged through PRs #1 and #2.
- `bluetooth-connection-audit` is the review branch for the connection audit and targeted safeguards. See [the investigation and source evidence](docs/BLUETOOTH-INVESTIGATION.md). Pushing it does not replace the production site.
- The owner reported a successful 15-minute manual color test, followed by intermittent connection failures in other attempts. This is useful hardware evidence, not proof that the original stability problem is fully resolved. Automated tests use simulated devices and Spotify responses.
- Follow [deployment instructions](docs/DEPLOYMENT.md) to publish to the same existing site, with its unchanged redirect URI.

## Daily use

**Start Album Glow** connects Bluetooth and starts Spotify sync using your saved settings. There is no mandatory color test or checkbox. Your existing Client ID, Spotify tokens, brightness, vivid mode, and interval retain their original browser-storage keys.

On Chrome versions that support previously granted device access, the app loads the saved controller permission and reuses it on your click. Otherwise Chrome opens its chooser directly from that click. Revoked permission, a different browser/profile, or first use can require the chooser again. Nothing silently opens a permission prompt.

For the first Spotify sign-in only, open **Settings**, enter the public **Client ID**, and save. Use the same Spotify app; never enter a Client Secret. Keep its redirect exactly `https://cosmic-snickerdoodle-3a661b.netlify.app/`. If you previously used this site, your saved Client ID is already filled in. The main **Connect Spotify** button is still available. Signing into Spotify navigates away from the page, so startup signs in before Bluetooth and then asks you to click **Start Album Glow** after returning. Subsequent startup with saved authentication uses the single button. Browser permission and Spotify approval cannot be bypassed.

Keep one Album Glow tab open, close the Apollo phone app, and temporarily turn off iPhone Bluetooth when isolating connection failures. Bluetooth retries remain bounded. A pending startup waits through those retries; **Stop syncing**, a manual color, or **Disconnect lights** cancels the pending sync intent.

## Colors without Spotify

1. Click **Connect Bluetooth**. Spotify sign-in and Client ID are not needed for manual lights.
2. Select Red, Orange, Yellow, Green, Cyan, Blue, Purple, Pink, White, or Warm white to apply it immediately.
3. Choose a custom color with the native color picker or type a hex value. Valid colors apply live; there is no Apply button. Three- and six-digit hex values are accepted, with or without `#`. The field keeps your text/caret while typing; blur or Enter formats the completed value.
4. Use the main brightness slider and on/off button. Manual RGB values bypass vivid album processing and are scaled only by brightness. The last unscaled RGB command successfully accepted by the browser is saved for the selected controller, including Spotify/test colors. After reloading and reconnecting, brightness can reuse that color without selecting a preset again. The previous preview’s saved manual color is migrated for its remembered controller.

Choosing a manual color pauses Spotify sync and cancels stale unsent album commands, so the next poll cannot overwrite your choice. A command already transmitted cannot be recalled; the queued manual choice follows it. Invalid hex input leaves the current sync/color intact. Live picker/hex updates are paced to at most five scheduled color sends per second, with the newest pending value replacing older ones; the existing Bluetooth queue still serializes all writes. Incomplete/invalid hex entries cancel unsent input and keep the current lights unchanged. Resuming Spotify, selecting a preset, stopping, or disconnecting cancels pending live input so a delayed edit cannot override a newer action.

The last manual hex color is saved locally and shown after reloading. Picking a color while disconnected stores the choice for this visit and sends it when you connect; after a reconnect during this visit, manual mode restores that choice. Choosing while LEDs are software-off saves the color for power-on. There is no automatic Spotify login for manual mode. Use **Start Album Glow** or **Resume Spotify sync** to return to album colors.

## Settings and optional checks

The **Settings** button opens a keyboard-accessible dialog containing the Client ID, exact redirect URI and Copy button, polling speed, vivid mode, and advanced Bluetooth options. Escape or Close dismisses it. The main page retains both connection buttons, disconnect controls, brightness, power, presets, and the hex/color picker. Diagnostics are under **Connection log**. **Copy log** copies the whole current log (up to the retained 300 lines), even when its display is collapsed. A confirmation appears on success. If browser clipboard access is blocked, a selected text box lets you press Ctrl+C or use a normal Copy action; it does not send logs anywhere automatically.

In **Advanced Bluetooth & optional color tests**, you can choose a different controller, enter a custom service, change the writable characteristic, run red/green/blue tests, and optionally remember the visually verified endpoint. That checkbox is only for verified endpoint caching, not permission to use Spotify sync. Initializer selection and browser write completion are not physical verification. Selecting another characteristic still stops sync so you can decide what to send next.

The available polling intervals remain 2, 3, 5, 8, and 15 seconds. The browser avoids overlapping playback requests and honors Spotify's HTTP 429 cooldown. Background tabs and Spotify's reporting delay can slow updates. Account/app eligibility and Spotify's current developer access rules still apply.

Brightness is **0–100% RGB scaling**, not the controller's separate hardware brightness register. A saved RGB value describes the last website command, not a readback of the physical strip: changes made later in Apollo Lighting are not detected. If no color is known for this controller, the slider applies the visible manual selection with an explicit message instead of silently doing nothing. It does not send an invented hardware-brightness command. Power uses the original Apollo-family bytes `CC2333` (on) and `CC2433` (off); these are **unverified on this particular controller**. A “bytes sent” message describes browser completion, not physical confirmation. If power does not work, do not infer that a different undocumented command is correct.

## Bluetooth connection handling

- Connection, service discovery, characteristic discovery, and writes use one operation lane. Repeated clicks and old sessions cannot start concurrent GATT work in this page.
- Each attempt logs its exact stage and success/failure. No initialization color or power commands are sent.
- A **manual test plus visual confirmation** remembers only the device ID and service/characteristic UUIDs. Reconnects to that verified endpoint use direct lookup, with freshly acquired GATT objects. No UUID is treated as proof of the Apollo protocol.
- A missing cached endpoint falls back to discovery and clears optional visual verification; an interrupted automatic sync stops so you can choose whether to resume. Network errors stop discovery and use bounded retries.
- Writes are serialized with at least 100 ms between completed and subsequent writes. The newest unsent color replaces obsolete queued colors; power commands stay ordered. The unsent queue is bounded.
- Disconnects invalidate characteristics and pending commands. Old Spotify/artwork results and commands are rejected after a session or sync change. Starting power-off cancels stale queued colors.
- Reconnects use the already selected device, without a new chooser, after 1, 2, 4, and 8 seconds. A brief successful connection does not reset the retry budget; a 30-second stable connection does.
- Previously enabled syncing waits for Bluetooth and resumes on successful recovery to the same confirmed endpoint. Explicit **Disconnect lights** stops syncing and retries. Selecting a characteristic stops sync and clears the optional verification checkbox.

The first unverified discovery still inspects the original set of permitted services, plus an optional custom service. `optionalServices` grants browser permission; it does not itself query those services. Broad discovery is reduced **after visual verification**, rather than assuming a UUID from a similar controller. Write-without-response remains preferred when advertised, matching the original app. That mode does not prove the firmware applied a command.

See [the full connection investigation](docs/BLUETOOTH-INVESTIGATION.md) for the audit verdict and pinned Chromium source evidence. The [hardware guide](docs/BLUETOOTH.md) documents optional acceptance checks; the audit does not require another reset-and-retry cycle to establish its conclusions.

## Developing with Codex

Open **alexnemy/LED-lights** in Codex. Use `bluetooth-connection-audit` while the connection audit is under review. Future changes can branch from the reviewed version. Each cloud task is already isolated; use the existing checkout and do not create a worktree unless explicitly requested. Preserve the original design, Spotify redirect, and working features.

The application has no runtime packages. Development and automated tests need **Node.js 24** (Node 22+ supports the test command); no `npm install` is needed.

```sh
cd /workspace/LED-lights  # In this Codex environment
npm test
npm run build
```

`npm test` runs dependency-free Node tests against the GATT helper and actual inline page script, with fake Bluetooth, storage, Spotify responses, and timers. They cover session isolation, retry limits, write serialization/cancellation, endpoint caching, resuming sync, RGB/brightness/power frames, PKCE parameters, refresh tokens, and rate-limit behavior. These are simulations, not hardware or authenticated Spotify integration tests. `--test-isolation=none` keeps the runner compatible with restricted cloud process sandboxes; each page fixture still uses its own VM context.

`npm run build` copies the three browser files into `dist/`. It does not bundle or rewrite the app. For a local layout-only check, serve `dist/` with any static HTTP server, for example `python3 -m http.server 8000 --directory dist`. The app intentionally requires HTTPS for Spotify sign-in; the local page is not an alternative redirect. HTTPS Netlify previews can test manual Bluetooth, but Spotify login on a different hostname will not match the production redirect registration. Do not change the registered redirect just to test a preview.

Album Glow uses native Web Locks to prevent two tabs on the same website from controlling one device at the same time. A blocked tab makes no Bluetooth calls and asks you to use or disconnect the existing owner. Ownership stays reserved until cancelled native operations settle. Preview and production URLs, other profiles, and other apps cannot share this safeguard. An already-connected controller selected again is reused, and leaving the page cancels its connection; backgrounding it does not.

GitHub Actions runs tests and the static build on pushes and pull requests. The Netlify configuration runs the same checks before building. No service processes need to run in a Codex task just to edit or test this static site.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Original UI, Spotify PKCE, polling, color extraction, LED controls |
| `bluetooth.js` | Focused GATT session and write queue helper |
| `bluetooth-ownership.js` | Per-device ownership between tabs on the same website |
| `tests/*.test.cjs` | Automated simulations of the helper and page integration |
| `scripts/build.cjs` | Copy only browser files into `dist/` |
| `netlify.toml` | Free static build settings; no new site or redirect |
| `docs/DEPLOYMENT.md` | Connect GitHub to the existing Netlify site safely |
| `docs/BLUETOOTH.md` | Findings, hardware checks, and diagnostic collection |
| `README.txt` | Unchanged historical instructions imported from the ZIP |

Deploy **all three** browser files: `index.html`, `bluetooth-ownership.js`, and `bluetooth.js`. The historical README.txt described a single-file deployment; that instruction applies to the original commit only. Prefer the built `dist/` folder for the updated version.

## Privacy and configuration

Spotify uses Authorization Code with PKCE, with the existing `user-read-currently-playing` scope. Access/refresh tokens stay in this browser's local storage and are sent to Spotify when required. There is no token backend. Like the original app, browser storage is not encrypted storage: use a trusted device. Disconnect Spotify to remove its saved tokens; revoke app access in Spotify if needed.

Client ID, brightness, vivid mode, and polling interval retain their original storage keys. New Bluetooth endpoint data is local to the site/browser and contains no Spotify tokens. A new hostname or browser profile has separate storage. Logs are capped at 300 lines and do not intentionally log token values or OAuth URLs. Do not commit browser storage exports, tokens, `.env` files, or screenshots containing account details. The build only publishes the three browser files.

## References

- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [MDN: BluetoothRemoteGATTServer.connect](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTServer/connect)
- [Spotify: Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify: currently playing](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
- [Spotify: rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
