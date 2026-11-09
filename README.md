# Album Glow

Album Glow turns Spotify album artwork into LED colors. This review adds SP630E Bluetooth and SP803E USB/WLED options while retaining the original Apollo profile. It remains a lightweight static website based on the supplied ZIP, with the dark visual style and color extraction preserved. Chrome on a Chromebook needs no Linux setup, backend, database, or paid service.

**Existing website and Spotify redirect:** https://cosmic-snickerdoodle-3a661b.netlify.app/ — keep this address, including its final `/`.

**Repository:** https://github.com/alexnemy/LED-lights (the existing repository chosen by the owner). `album-glow` was the proposed name; GitHub's connected integration could not create a new repository. No other remote project was modified.

## Current review status

- The original ZIP remains unchanged in history at `2e642fc`. Bluetooth reliability changes, simpler controls, and the connection audit were merged through PRs #1, #2, and #3.
- `controller-comparison` prepares the purchased SP630E and SP803E for comparison. See [setup and the test plan](docs/CONTROLLERS.md). The separate permission-reset PR #4 is not included. Neither new controller has been physically tested in this development environment; review and hardware acceptance are needed before release.
- The owner reported a successful 15-minute manual color test, followed by intermittent connection failures in other attempts. This is useful hardware evidence, not proof that the original stability problem is fully resolved. Automated tests use simulated devices and Spotify responses.
- Follow [deployment instructions](docs/DEPLOYMENT.md) to publish to the same existing site, with its unchanged redirect URI.

## Daily use

**Start Album Glow** connects the controller selected in Settings and starts Spotify sync. Apollo stays the default. Select **SP630E · Bluetooth** for the first test, or **SP803E · USB / WLED** for the fallback. The main connection button follows that choice. Switching disconnects and cancels old queued work and sync. No color test/checkbox is mandatory. Client ID, tokens, brightness, vivid mode, and interval keep their original storage keys.

On Chrome versions that support previously granted device access, the app loads the saved controller permission and reuses it on your click. Otherwise Chrome opens its chooser directly from that click. Revoked permission, a different browser/profile, or first use can require the chooser again. Nothing silently opens a permission prompt.

For the first Spotify sign-in only, open **Settings**, enter the public **Client ID**, and save. Use the same Spotify app; never enter a Client Secret. Keep its redirect exactly `https://cosmic-snickerdoodle-3a661b.netlify.app/`. If you previously used this site, your saved Client ID is already filled in. The main **Connect Spotify** button is still available. Signing into Spotify navigates away from the page, so startup signs in before Bluetooth and then asks you to click **Start Album Glow** after returning. Subsequent startup with saved authentication uses the single button. Browser permission and Spotify approval cannot be bypassed.

Keep one Album Glow tab open, close the Apollo phone app, and temporarily turn off iPhone Bluetooth when isolating connection failures. Bluetooth retries remain bounded. A pending startup waits through those retries; **Stop syncing**, a manual color, or **Disconnect lights** cancels the pending sync intent.

## Colors without Spotify

1. Click **Connect Bluetooth** or **Connect USB**, according to the controller selected in Settings. Manual lights need no Spotify sign-in or Client ID.
2. Select Red, Orange, Yellow, Green, Cyan, Blue, Purple, Pink, White, or Warm white to apply it immediately.
3. Choose a custom color with the native color picker or type a hex value. Valid colors apply live; there is no Apply button. Three- and six-digit hex values are accepted, with or without `#`. The field keeps your text/caret while typing; blur or Enter formats the completed value.
4. Use the main brightness slider and on/off button. Manual RGB values bypass vivid album processing and are scaled only by brightness. The last unscaled RGB command successfully accepted by the browser is saved for the selected controller, including Spotify/test colors. After reloading and reconnecting, brightness can reuse that color without selecting a preset again. The previous preview’s saved manual color is migrated for its remembered controller.

Choosing a manual color pauses Spotify sync and cancels stale unsent album commands, so the next poll cannot overwrite your choice. A command already transmitted cannot be recalled; the queued manual choice follows it. Invalid hex input leaves the current sync/color intact. Live picker/hex updates are paced to at most five scheduled color sends per second, with the newest pending value replacing older ones; the existing Bluetooth queue still serializes all writes. Incomplete/invalid hex entries cancel unsent input and keep the current lights unchanged. Resuming Spotify, selecting a preset, stopping, or disconnecting cancels pending live input so a delayed edit cannot override a newer action.

The last manual hex color is saved locally and shown after reloading. Picking a color while disconnected stores the choice for this visit and sends it when you connect; after a reconnect during this visit, manual mode restores that choice. Choosing while LEDs are software-off saves the color for power-on. There is no automatic Spotify login for manual mode. Use **Start Album Glow** or **Resume Spotify sync** to return to album colors.

## Settings and optional checks

The **Settings** button opens a keyboard-accessible dialog containing the Client ID, exact redirect URI and Copy button, polling speed, vivid mode, and advanced Bluetooth options. Escape or Close dismisses it. The main page retains both connection buttons, disconnect controls, brightness, power, presets, and the hex/color picker. Diagnostics are under **Connection log**. **Copy log** copies the whole current log (up to the retained 300 lines), even when its display is collapsed. A confirmation appears on success. If browser clipboard access is blocked, a selected text box lets you press Ctrl+C or use a normal Copy action; it does not send logs anywhere automatically.

In **Advanced connection & optional color tests**, choose another Bluetooth device or USB port and run RGB tests. Bluetooth supports optional verified endpoint caching; Apollo retains custom service entry. SP630E restricts discovery to its supported endpoint. USB has no Bluetooth characteristic or endpoint checkbox. Verification never gates startup. A browser write is not physical verification. Changing a characteristic stops sync.

The available polling intervals remain 2, 3, 5, 8, and 15 seconds. The browser avoids overlapping playback requests and honors Spotify's HTTP 429 cooldown. Background tabs and Spotify's reporting delay can slow updates. Account/app eligibility and Spotify's current developer access rules still apply.

Brightness is **0–100% RGB scaling**. SP630E and WLED color packets set controller brightness to full scale because the app already scaled RGB. Saved RGB describes a website command, not a physical measurement; Bluetooth phone-app changes are not read back. USB initially reads WLED's reported power/RGB. If no color is known, the slider uses the visible manual selection and explains the fallback. Apollo power retains `CC2333`/`CC2433`; SP630E uses BanlanX power and USB uses WLED JSON. None is claimed physically verified on the purchased hardware. Completed writes are browser completion, not physical confirmation.

## Bluetooth connection handling

- Connection, service discovery, characteristic discovery, and writes use one operation lane. Repeated clicks and old sessions cannot start concurrent GATT work in this page.
- Each attempt logs its exact stage and success/failure. No initialization color or power commands are sent.
- A **manual test plus visual confirmation** remembers only the device ID and service/characteristic UUIDs. Reconnects to that verified endpoint use direct lookup, with freshly acquired GATT objects. No UUID is treated as proof of the Apollo protocol.
- A missing cached endpoint falls back to discovery and clears optional visual verification; an interrupted automatic sync stops so you can choose whether to resume. Network errors stop discovery and use bounded retries.
- Writes are serialized with at least 100 ms between completed and subsequent writes. The newest unsent color replaces obsolete queued colors; power commands stay ordered. The unsent queue is bounded.
- Disconnects invalidate characteristics and pending commands. Old Spotify/artwork results and commands are rejected after a session or sync change. Starting power-off cancels stale queued colors.
- Reconnects use the already selected device, without a new chooser, after 1, 2, 4, and 8 seconds. A brief successful connection does not reset the retry budget; a 30-second stable connection does.
- Previously enabled syncing waits for Bluetooth and resumes on successful recovery to the same confirmed endpoint. Explicit **Disconnect lights** stops syncing and retries. Selecting a characteristic stops sync and clears the optional verification checkbox.

Apollo keeps the original discovery behavior, with direct cached lookup after visual verification. SP630E tries its supported service/characteristic combinations directly and never chooses another arbitrary writable characteristic. Static mode and RGB travel as one paced batch. `optionalServices` grants permission without querying services. Write-without-response remains preferred where advertised and does not prove firmware acceptance.

USB uses Chrome Web Serial at 115200 baud. WLED identity is checked before controls are enabled, with bounded probing through an ESP32 boot delay. Queued colors coalesce and native work/cleanup retain their lane and tab reservation until completion. A cable loss pauses sync; Connect USB can resume that intent. Explicit Disconnect lights or changing controller stops it. Previously permitted USB ports are reused only for an unambiguous saved VID/PID match. See [CONTROLLERS.md](docs/CONTROLLERS.md) for setup, wiring, limits, and the Bluetooth-first comparison.

See [the full connection investigation](docs/BLUETOOTH-INVESTIGATION.md) for the audit verdict and pinned Chromium source evidence. The [hardware guide](docs/BLUETOOTH.md) documents optional acceptance checks; the audit does not require another reset-and-retry cycle to establish its conclusions.

## Developing with Codex

Open **alexnemy/LED-lights** in Codex. Use `controller-comparison` for this review; future work branches from accepted `main`. Tasks are already isolated: use the existing checkout and create no worktree unless requested. Preserve the design, production Spotify redirect, and working features.

The application has no runtime packages. Development and automated tests need **Node.js 24** (Node 22+ supports the test command); no `npm install` is needed.

```sh
cd /workspace/LED-lights  # In this Codex environment
npm test
npm run build
```

`npm test` runs dependency-free Node tests against the GATT helper and actual inline page script, with fake Bluetooth, storage, Spotify responses, and timers. They cover session isolation, retry limits, write serialization/cancellation, endpoint caching, resuming sync, RGB/brightness/power frames, PKCE parameters, refresh tokens, and rate-limit behavior. These are simulations, not hardware or authenticated Spotify integration tests. `--test-isolation=none` keeps the runner compatible with restricted cloud process sandboxes; each page fixture still uses its own VM context.

`npm run build` copies the five browser files into `dist/`. It does not bundle or rewrite the app. For a local layout-only check, serve `dist/` with any static HTTP server, for example `python3 -m http.server 8000 --directory dist`. The app intentionally requires HTTPS for Spotify sign-in; the local page is not an alternative redirect. HTTPS Netlify previews can test manual Bluetooth, but Spotify login on a different hostname will not match the production redirect registration. Do not change the registered redirect just to test a preview.

Album Glow uses native Web Locks to prevent two tabs on the same website from controlling one device at the same time. A blocked tab makes no Bluetooth calls and asks you to use or disconnect the existing owner. Ownership stays reserved until cancelled native operations settle. Preview and production URLs, other profiles, and other apps cannot share this safeguard. An already-connected controller selected again is reused, and leaving the page cancels its connection; backgrounding it does not.

GitHub Actions runs tests and the static build on pushes and pull requests. The Netlify configuration runs the same checks before building. No service processes need to run in a Codex task just to edit or test this static site.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Original UI, Spotify PKCE, polling, color extraction, LED controls |
| `bluetooth.js` | Focused GATT sessions and atomic command-batch queue |
| `controller-protocols.js` | Apollo, SP630E BanlanX, and WLED JSON wire formats |
| `serial.js` | WLED USB identity check, lifecycle, and paced writes |
| `bluetooth-ownership.js` | Per-device ownership between tabs on the same website |
| `tests/*.test.cjs` | Automated simulations of the helper and page integration |
| `scripts/build.cjs` | Copy only browser files into `dist/` |
| `netlify.toml` | Free static build settings; no new site or redirect |
| `docs/DEPLOYMENT.md` | Connect GitHub to the existing Netlify site safely |
| `docs/BLUETOOTH.md` | Findings, hardware checks, and diagnostic collection |
| `docs/CONTROLLERS.md` | Purchased controller setup and comparison plan |
| `README.txt` | Unchanged historical instructions imported from the ZIP |

Deploy **all five** browser files: `index.html`, `bluetooth-ownership.js`, `bluetooth.js`, `controller-protocols.js`, and `serial.js`. Historical README.txt describes the original single-file import only. Prefer the built `dist/` folder.

## Privacy and configuration

Spotify uses Authorization Code with PKCE, with the existing `user-read-currently-playing` scope. Access/refresh tokens stay in this browser's local storage and are sent to Spotify when required. There is no token backend. Like the original app, browser storage is not encrypted storage: use a trusted device. Disconnect Spotify to remove its saved tokens; revoke app access in Spotify if needed.

Client ID, brightness, vivid mode, and polling interval retain their original storage keys. New Bluetooth endpoint data is local to the site/browser and contains no Spotify tokens. A new hostname or browser profile has separate storage. Logs are capped at 300 lines and do not intentionally log token values or OAuth URLs. Do not commit browser storage exports, tokens, `.env` files, or screenshots containing account details. The build only publishes the five browser files.

## References

- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [MDN: BluetoothRemoteGATTServer.connect](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTServer/connect)
- [Spotify: Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify: currently playing](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
- [Spotify: rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
