# Bluetooth findings and hardware testing

## What the source actually showed

| Finding in the imported version | Targeted change |
| --- | --- |
| Every successful `gatt.connect()` ran `getPrimaryServices()` then `getCharacteristics()` for every accessible service. Only broad “discovering services” stage reporting was available. | Exact stage start/completion/failure messages, including each service UUID. After manual write and visual confirmation, directly reacquire that service and characteristic on reconnect. |
| RGB tests, Spotify, vivid mode, debounced brightness, and power each called `sendFrame()` directly, with no shared write serialization. | One GATT operation lane and a bounded, paced write queue; stale unsent colors coalesce and power remains ordered. |
| Existing `session.busy` guarded attempts within one session, but a replacement session could start while a previous asynchronous operation was still settling. | A shared lane across sessions, generation checks, and cleanup before the next session begins. Late chooser/connect results cannot revive an explicitly disconnected session. |
| Every successful discovery reset `attempts=0`, even if the next connection dropped seconds later. | Four retries per unstable run, reset only after 30 seconds stable. |
| Disconnect cleared GATT references, but controls were not reliably refreshed until a retry path ran. | Immediately clear references, pending commands, selector, and enabled state, including when a disconnect occurs during discovery. |
| Changing the characteristic kept the previous visual confirmation and could continue syncing to a new target. | Stop sync, cancel old queued commands, and require a new manual test/confirmation. |
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
3. Choose the Apollo controller. In Album Glow, look for: device selection complete → GATT connect completed → services → characteristics → selected writable characteristic → Ready. Do not edit custom UUIDs unless discovery evidence identifies one.
4. Click red, green, blue with a short pause after each. Record whether the physical strip matches each one. If not, stop sync, select another writable characteristic, and repeat. A browser write completion is insufficient. Only then check the visual confirmation box.
5. Try brightness at 100%, 50%, and 0%, then restore 100%. Expect RGB dimming; the official app's hardware-brightness setting can still affect the result.
6. Try off/on once. Record whether each changes the physical lights. If not, leave power on using the official app when needed, close it again, and report the result. The website cannot read the actual power or hardware-brightness state.
7. On the existing production URL after release, connect Spotify and start sync. Switch between different **albums**, then tracks within one album. Try 2 and 5 second polling. Confirm color changes and approximate delay. Restore your preferred vivid mode and brightness.
8. Leave it running for 15–30 minutes. Note each unexpected drop. Recovery should pause writes, reacquire fresh GATT objects, and resume the latest album when the same visually confirmed endpoint is available. Retries should stop after four unstable attempts rather than cycle indefinitely.
9. To test recovery intentionally, briefly remove controller power, restore it before the retry budget ends, and observe the log. This may not recover on every firmware/OS combination; report the exact result. Do not use the website's Disconnect button for this particular test: that button intentionally cancels recovery.
10. Click **Disconnect lights**. Verify it stays disconnected and sync stops. Reconnect by choosing the controller, manually test/confirm again, and restart sync.

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
