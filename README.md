# Album Glow

Album Glow turns Spotify album artwork into a color for Apollo Bluetooth LEDs. It is a lightweight static website built from the supplied Album Glow ZIP, with the original interface and color extraction intact. It runs in Chrome on a Chromebook; no Linux setup, backend, database, or paid service is required to use it.

**Existing website and Spotify redirect:** https://cosmic-snickerdoodle-3a661b.netlify.app/ — keep this address, including its final `/`.

**Repository:** https://github.com/alexnemy/LED-lights (the existing repository chosen by the owner). `album-glow` was the proposed name; GitHub's connected integration could not create a new repository. No other remote project was modified.

## Current review status

- `main` preserves the original imported ZIP in commit `2e642fc`.
- `bluetooth-reliability` contains the proposed Bluetooth changes, tests, and deployment documentation. Review before merging or releasing.
- Physical Bluetooth stability is **not yet verified** on the owner's controller. Browser simulation cannot establish compatibility with ChromeOS's Bluetooth stack or controller firmware.
- No live Netlify deployment is performed by preparing or pushing this repository. Linking Netlify and publishing are separate steps; follow [deployment instructions](docs/DEPLOYMENT.md).

## Using Album Glow

1. Open the existing HTTPS website in Chrome on your Chromebook. Use one Album Glow tab. Close Apollo Lighting on your phone; temporarily turn off the phone's Bluetooth if you need to rule out competing connections.
2. Select **Choose Apollo lights**, then choose your controller in Chrome's chooser.
3. Test red, green, and blue. If necessary, choose a different discovered writable characteristic and test again. Only check **I saw the lights change** after the physical colors respond. A successful browser write alone is not verification.
4. Enter the public Spotify **Client ID** from your own Spotify Developer app. Do not enter a Client Secret. The Client ID is configurable in the page and saved locally.
5. In that Spotify app, keep the exact redirect URI `https://cosmic-snickerdoodle-3a661b.netlify.app/`. Select **Connect Spotify** and approve access.
6. Play music and select **Start automatic syncing**. Color updates occur when the album changes, rather than on each track of the same album.

The available polling intervals remain 2, 3, 5, 8, and 15 seconds. The browser avoids overlapping playback requests and honors Spotify's HTTP 429 cooldown. Background tabs and Spotify's reporting delay can slow updates. Account/app eligibility and Spotify's current developer access rules still apply.

Brightness is **0–100% RGB scaling**, not the controller's separate hardware brightness register. Power uses the original Apollo-family bytes `CC2333` (on) and `CC2433` (off); these are **unverified on this particular controller**. A “bytes sent” message describes browser completion, not physical confirmation. If power does not work, do not infer that a different undocumented command is correct.

## Bluetooth changes under review

- Connection, service discovery, characteristic discovery, and writes use one operation lane. Repeated clicks and old sessions cannot start concurrent GATT work in this page.
- Each attempt logs its exact stage and success/failure. No initialization color or power commands are sent.
- A **manual test plus visual confirmation** remembers only the device ID and service/characteristic UUIDs. Reconnects to that verified endpoint use direct lookup, with freshly acquired GATT objects. No UUID is treated as proof of the Apollo protocol.
- A missing cached endpoint falls back to discovery and requires a fresh visual check. Network errors stop discovery and use bounded retries.
- Writes are serialized with at least 100 ms between completed and subsequent writes. The newest unsent color replaces obsolete queued colors; power commands stay ordered. The unsent queue is bounded.
- Disconnects invalidate characteristics and pending commands. Old Spotify/artwork results and commands are rejected after a session or sync change. Starting power-off cancels stale queued colors.
- Reconnects use the already selected device, without a new chooser, after 1, 2, 4, and 8 seconds. A brief successful connection does not reset the retry budget; a 30-second stable connection does.
- Previously enabled syncing waits for Bluetooth and resumes on successful recovery to the same confirmed endpoint. Explicit **Disconnect lights** stops syncing and retries. Selecting a characteristic requires a fresh visual confirmation.

The first unverified discovery still inspects the original set of permitted services, plus an optional custom service. `optionalServices` grants browser permission; it does not itself query those services. Broad discovery is reduced **after visual verification**, rather than assuming a UUID from a similar controller. Write-without-response remains preferred when advertised, matching the original app. That mode does not prove the firmware applied a command.

See [the findings and Chromebook test guide](docs/BLUETOOTH.md) for the original issues, remaining hypotheses, and precise diagnostics to collect.

## Developing with Codex

Open **alexnemy/LED-lights** in Codex and use `bluetooth-reliability` while this update is under review. Future changes can branch from the reviewed version. Each cloud task is already isolated; use the existing checkout and do not create a worktree unless explicitly requested. Preserve the original design, Spotify redirect, and working features.

The application has no runtime packages. Development and automated tests need **Node.js 24** (Node 22+ supports the test command); no `npm install` is needed.

```sh
cd /workspace/LED-lights  # In this Codex environment
npm test
npm run build
```

`npm test` runs dependency-free Node tests against the GATT helper and actual inline page script, with fake Bluetooth, storage, Spotify responses, and timers. They cover session isolation, retry limits, write serialization/cancellation, endpoint caching, resuming sync, RGB/brightness/power frames, PKCE parameters, refresh tokens, and rate-limit behavior. These are simulations, not hardware or authenticated Spotify integration tests. `--test-isolation=none` keeps the runner compatible with restricted cloud process sandboxes; each page fixture still uses its own VM context.

`npm run build` copies the two browser files into `dist/`. It does not bundle or rewrite the app. For a local layout-only check, serve `dist/` with any static HTTP server, for example `python3 -m http.server 8000 --directory dist`. The app intentionally requires HTTPS for Spotify sign-in; the local page is not an alternative redirect. HTTPS Netlify previews can test manual Bluetooth, but Spotify login on a different hostname will not match the production redirect registration. Do not change the registered redirect just to test a preview.

GitHub Actions runs tests and the static build on pushes and pull requests. The Netlify configuration runs the same checks before building. No service processes need to run in a Codex task just to edit or test this static site.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Original UI, Spotify PKCE, polling, color extraction, LED controls |
| `bluetooth.js` | Focused GATT session and write queue helper |
| `tests/*.test.cjs` | Automated simulations of the helper and page integration |
| `scripts/build.cjs` | Copy only browser files into `dist/` |
| `netlify.toml` | Free static build settings; no new site or redirect |
| `docs/DEPLOYMENT.md` | Connect GitHub to the existing Netlify site safely |
| `docs/BLUETOOTH.md` | Findings, hardware checks, and diagnostic collection |
| `README.txt` | Unchanged historical instructions imported from the ZIP |

Deploy **both** `index.html` and `bluetooth.js`. The historical README.txt described a single-file deployment; that instruction applies to the original commit only. Prefer the built `dist/` folder for the updated version.

## Privacy and configuration

Spotify uses Authorization Code with PKCE, with the existing `user-read-currently-playing` scope. Access/refresh tokens stay in this browser's local storage and are sent to Spotify when required. There is no token backend. Like the original app, browser storage is not encrypted storage: use a trusted device. Disconnect Spotify to remove its saved tokens; revoke app access in Spotify if needed.

Client ID, brightness, vivid mode, and polling interval retain their original storage keys. New Bluetooth endpoint data is local to the site/browser and contains no Spotify tokens. A new hostname or browser profile has separate storage. Logs are capped at 300 lines and do not intentionally log token values or OAuth URLs. Do not commit browser storage exports, tokens, `.env` files, or screenshots containing account details. The build only publishes the two browser files.

## References

- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [MDN: BluetoothRemoteGATTServer.connect](https://developer.mozilla.org/en-US/docs/Web/API/BluetoothRemoteGATTServer/connect)
- [Spotify: Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [Spotify: currently playing](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
- [Spotify: rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)
