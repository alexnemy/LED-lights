# Bluetooth findings and hardware testing

For the completed code audit and version-matched Chromium evidence, read [Bluetooth connection investigation](BLUETOOTH-INVESTIGATION.md). It distinguishes the native connection failure from the application safeguards fixed during the audit.

## What the source actually showed

| Finding in the imported version | Targeted change |
| --- | --- |
| Every successful `gatt.connect()` ran `getPrimaryServices()` then `getCharacteristics()` for every accessible service. Only broad “discovering services” stage reporting was available. | Exact stage start/completion/failure messages, including each service UUID. After manual write and visual confirmation, directly reacquire that service and characteristic on reconnect. |
| RGB tests, Spotify, vivid mode, debounced brightness, and power each called `sendFrame()` directly, with no shared write serialization. | One GATT operation lane and a bounded, paced write queue; stale unsent colors coalesce and power remains ordered. |
| Existing `session.busy` guarded attempts within one session, but a replacement session could start while a previous asynchronous operation was still settling. | A shared lane across sessions, generation checks, and cleanup before the next session begins. Late chooser/connect results cannot revive an explicitly disconnected session. |
| Every successful discovery reset `attempts=0`, even if the next connection dropped seconds later. | Four retries per unstable run, reset only after 30 seconds stable. |
| Disconnect cleared GATT references, but controls were not reliably refreshed until a retry path ran. | Immediately clear references, pending commands, selector, and enabled state, including when a disconnect occurs during discovery. |
| Changing the characteristic kept the previous visual confirmation and could continue syncing to a new target. | Stop sync, cancel old queued commands, and clear optional endpoint verification. Color tests live in Settings and no longer gate startup, as requested by the owner. |
| An awaited Spotify/artwork result could outlive a disconnect or sync stop. | Check session/sync generation before sending and after writes; ignore stale results. |
| A queued color could race power-off. | Invalidate older color intent before sending power, suppress colors while power is busy/off, restore the latest desired color on power-on. |

These are code defects or avoidable GATT load, not proof of the observed ChromeOS/controller failure's root cause. The original code already had a per-session busy flag and some stale-session guards; the changes extend those protections rather than claiming none existed.

The reported `Attempted to set device in unpaired device list but device is unsupported` message is not sufficient to identify a radio, driver, pairing, protocol, or website defect. It should be correlated with the app's exact stages and event times. Successful AirPods use also does not validate this BLE GATT controller path.

A flicker during connection could come from controller behavior, another client, or a command sent during a briefly usable connection. The old code could resume syncing after discovery. The new initializer sends **no** LED commands, and logs each later write separately. This helps distinguish flicker before any website write from flicker immediately after one. Do not infer accepted protocol bytes from flicker alone.

## What was verified in development

- Node simulations exercise connection/discovery failure, drops mid-discovery, old/new sessions on the same device, cached direct lookup, bounded retries, serialization and spacing, power ordering, stale cancellation, and sync recovery without reopening the chooser.
- Page-script tests exercise unchanged RGB/power bytes, RGB brightness scaling, vivid colors, original production redirect, PKCE parameters, token refresh, playback overlap suppression, and HTTP 429 handling.
- A Chromium smoke check loads the built site, clicks controls with a simulated Bluetooth device, verifies manual RGB, brightness, power, confirmation, disconnect, user-gesture selection, mobile layout, and absence of page JavaScript errors.
- Real Spotify authorization/API service behavior and the physical controller/ChromeOS Bluetooth stack are **not** validated by these tests. Power is still unverified. No claim of a solved hardware problem is made.

## Chromebook acceptance test

Use the reviewed update on an HTTPS address. Manual Bluetooth tests can run on an HTTPS deploy preview **without connecting Spotify**. Complete the Spotify steps on the unchanged production URL only after approving the release. Do not change Spotify redirect registration for a temporary preview.

1. Start with one Album Glow tab. Close the Apollo app. For the initial comparison, switch off Bluetooth on the iPhone so it cannot hold/reclaim the controller. This is a diagnostic isolation step, not a requirement to reset everything repeatedly.
2. Open `chrome://device-log` in another tab, choose Bluetooth entries if filters are offered, and note the time. Keep the Album Glow tab active during the actual test.
3. Use **Connect Bluetooth** (or **Settings → Advanced Bluetooth → Choose different lights** to force the chooser). Choose the Apollo controller if Chrome asks. In Album Glow, look for: device selection complete → GATT connect completed → services → characteristics → selected writable characteristic → Ready. Do not edit custom UUIDs unless discovery evidence identifies one.
4. Use the main Red, Green, and Blue presets with a short pause after each. Optional diagnostic Test red/green/blue buttons are under Settings. Record whether the physical strip matches each one. If not, stop sync, select another writable characteristic, and repeat. A browser write completion is insufficient. If you want to cache a visually verified endpoint, use the optional diagnostic tests in Settings and then its optional remember checkbox. Everyday startup does not require this checkbox.
5. Try brightness at 100%, 50%, and 0%, then restore 100%. Expect RGB dimming; the official app's hardware-brightness setting can still affect the result.
6. Try off/on once. Record whether each changes the physical lights. If not, leave power on using the official app when needed, close it again, and report the result. The website cannot read the actual power or hardware-brightness state.
7. On the existing production URL after release, connect Spotify if needed and click **Start Album Glow**. This no longer requires a color test/checkbox. Switch between different **albums**, then tracks within one album. Try 2 and 5 second polling. Confirm color changes and approximate delay. Restore your preferred vivid mode and brightness.
8. Leave it running for 15–30 minutes. Note each unexpected drop. Recovery should pause writes, reacquire fresh GATT objects, and resume the latest album when the same visually confirmed endpoint is available. Retries should stop after four unstable attempts rather than cycle indefinitely.
9. To test recovery intentionally, briefly remove controller power, restore it before the retry budget ends, and observe the log. This may not recover on every firmware/OS combination; report the exact result. Do not use the website's Disconnect button for this particular test: that button intentionally cancels recovery.
10. Click **Disconnect lights**. Verify it stays disconnected and sync stops. Reconnect by choosing the controller, manually test/confirm again, and restart sync.

## Optional website permission reset

If you want to compare a fresh website permission with the saved one, open **Settings → Advanced Bluetooth & optional color tests → Forget saved lights**. Wait for the result, close Settings, then click **Connect Bluetooth** and choose the Apollo controller again. Manual color tests need no Spotify sign-in. This clears this website's saved device and, when Chrome supports it, requests removal of its device permission. It does **not** remove ChromeOS pairing or reset the native Bluetooth cache. If Chrome retains permission or removal cannot be verified, the page says so.

The reset stops sync and waits for old connection/write operations to finish before revoking permission. It refuses to reset lights currently owned by another cooperating tab on this origin. Spotify settings and general color/brightness preferences are retained; the selected controller's verified endpoint and last-command RGB history are cleared. A later Connect opens the chooser directly from your click.

You can opt into **Forget this website’s device permission after all connection retries fail** in that section. It is off by default and runs only after all four retries fail at GATT connect. It never opens a chooser in the background or resets an otherwise recovering connection. Afterward, use Connect Bluetooth for manual colors or Start Album Glow to resume Spotify sync. Leave this option off if forgetting provides no improvement; success on one attempt cannot establish that permission caused intermittent native failures.

The user reported different symbols and Pair/Connect wording in Chrome's chooser. The inspected Chromium version uses an already-connected Bluetooth icon when the native GATT connection exists, otherwise signal-strength indicators. A triangle-like symbol may be signal strength, not a damaged saved record. Website permission, OS pairing, and native connection state are different things; forgetting permission cannot force an already-connected state. See the [source-backed explanation](BLUETOOTH-INVESTIGATION.md#chromes-chooser-and-forgetting-permission).

## If it fails, send this information

Copy the **visible Album Glow Connection log** immediately after the failure (it retains the last 300 lines), from device selection through the last retry. Also provide:

- Which phase failed: chooser, GATT connect, service lookup/discovery, characteristic lookup/discovery, or write.
- The selected service and characteristic UUIDs, if discovery succeeded.
- Whether a flicker occurred **before or after** a `BT: write start` line, and its approximate time.
- Whether iPhone Bluetooth was off, how many Album Glow tabs were open, and whether the Chromebook/tab was awake/visible.
- Chrome/ChromeOS versions, approximate distance to controller, whether a manual test ever succeeded in that run, and which power/brightness tests physically worked.
- Matching Bluetooth connect/disconnect entries and the “unsupported” warning from `chrome://device-log`, with timestamps.

Do **not** send access tokens, browser local/session storage dumps, Spotify OAuth URLs containing `code`, screenshots of private account settings, or a network/HAR export. The visible app log is sufficient for this first comparison. Redact unrelated device addresses/account information in ChromeOS logs.

Interpretation: if `GATT connect` fails before discovery, narrowing discovery cannot repair that failed attempt. If direct service/characteristic lookup succeeds but writes trigger a drop, the next investigation is write method/timing and controller behavior. A successful Apollo phone app is useful comparison evidence, not proof the Chromebook's Web Bluetooth connection must work identically.


## Simpler-control acceptance checks

The `one-click-and-manual-colors` update retains the same GATT lane and queue. The owner explicitly requested moving setup/testing into Settings and removing mandatory manual color verification from startup. Optional verified-endpoint caching still distinguishes browser completion from physical verification.

On its HTTPS preview, connect Bluetooth without Spotify, apply several presets and a custom hex value, change brightness, and check off/on only if supported by your controller. Confirm picker/valid hex edits update the LEDs live, remain paced during dragging, and do not corrupt the field while typing six digits. Check that partial/invalid hex does not send black or malformed values. Open/close Settings and verify the advanced tests remain available. Close the preview tab before connecting from production so it cannot hold the controller.

After the reviewed release on the existing URL, use the saved Client ID/session with **Start Album Glow** and no checkbox. Confirm Spotify updates album colors. Select a manual preset while Spotify is active; subsequent polling must stop and leave that manual choice. Resume Spotify and confirm the current album is resent. Test an unexpected disconnect in both modes: pending Spotify startup should resume after recovery, while manual mode should restore its chosen color without Spotify requests.

A fresh preview origin has separate browser storage and an unregistered Spotify redirect. Use it for Bluetooth/manual controls. Automated startup tests use fake Spotify tokens/responses; do not copy real production tokens into a preview or change the Spotify registration for it.

If Chrome reports that Bluetooth is disallowed by permissions policy, the chooser/connection is blocked before GATT. Open the actual HTTPS preview address in its own Chrome tab, rather than inside an embedded Netlify or other preview. The app detects this policy when Chrome exposes it and explains how to open the page directly. Application JavaScript cannot override a parent frame or server policy. If it remains blocked in a standalone tab, provide the full page address and the new visible error; this is a separate diagnosis from controller disconnections.


## Brightness history, live colors, and log copy

The preview now remembers the last browser-accepted unscaled RGB for its controller, including album colors, and migrates the previous preview’s remembered manual color. To check the reported reload bug: choose a color, reload the page, reconnect Bluetooth without selecting any color, and move brightness. It should dim that remembered color. Brightness is still RGB scaling; the saved color cannot detect later changes made by another app. With no history for this controller, the slider explicitly says it will use the visible manual selection. No independent hardware-brightness command/readback is claimed.

Drag around the native color picker and type a six-digit hex value without clicking Apply (that button was removed). The final valid choice should win; continuous changes are paced at 200 ms and obsolete pending colors are cancelled. Selecting a preset or resuming Spotify must cancel earlier pending input. Repeat after a disconnect and with LEDs software-off to check that edits do not relight them unexpectedly.

Use **Copy log** beside Connection log to copy all retained lines, including lines outside the scroll area, then paste them into the chat. If clipboard permission is blocked, use the selected fallback text with Ctrl+C or the browser’s Copy action. The log is bounded to the last 300 lines, so copy promptly after a failure. Do not attach a browser storage/token dump.
