# Compare the new controllers

The owner ordered the two controllers linked in the chat: **BTF-LIGHTING SP630E (Bluetooth)** and **BTF-LIGHTING SP803E (USB / WLED)**. This update prepares Album Glow for both. Check the model printed on the delivered units before following their setup steps. Other models can use different wiring and protocols.

Test Bluetooth first and keep USB as the fallback. The damaged sections of the LED strip are outside this comparison. Use a working section to confirm commands reach the lights; judge reliability by successful connections, unexpected drops, and normal restarts.

## What stays the same

- Existing 12 V analog RGB strips and the photographed **12 V DC, 3 A, center-positive** power supply. The rating does not establish the supply's present condition, but its voltage matches these controllers and strips.
- The existing Album Glow website and trailing-slash Spotify redirect: **https://cosmic-snickerdoodle-3a661b.netlify.app/**.
- Spotify sign-in, manual presets/live hex, brightness, power, vivid mode, polling speed, and Copy log. Apollo remains the default for existing users.
- No backend, Linux installation, paid service, or additional Spotify application.

Deploy all **five browser files** using the built `dist/` folder, rather than uploading only index.html.

## Connect the hardware

Switch off/unplug the 12 V adapter before moving strip wires. Connect only **one controller's outputs to a strip at a time**. USB is the SP803E's data connection; the strips still need the 12 V supply.

The new controllers use terminals instead of the Apollo's strip plugs. Matching four-pin RGB pigtail adapters can avoid cutting the existing leads. Follow the printed **V+, R, G, B** markings; do not infer function from insulation color or assume the connector's pin order. Extra white-channel outputs on the SP630E are unused for this RGB strip. If combining two strip runs, join matching channels and stay within the supply/controller ratings.

The SP803E has a 5.5/2.1 mm DC input as well as power terminals. Confirm the existing plug fits; its label alone does not establish plug dimensions. Keep the supply at 12 V. If connector labels are unclear, photograph the delivered controller's terminals and adapters before wiring them.

## Test 1: SP630E Bluetooth

1. Connect the SP630E to the existing supply and RGB strip using the correct terminals/adapters.
2. Use **BanlanX** on the iPhone for one-time configuration. Select **PWM RGB / ordinary RGB**, not an addressable SPI/IC strip type. Confirm the working strip section responds. Close BanlanX afterward; the controller supports one active BLE client at a time. For the initial isolated comparison, keep iPhone Bluetooth off.
3. Open the reviewed Album Glow preview **directly in its own Chrome tab**. Disconnect/close other Album Glow tabs first. Preview and production cannot coordinate ownership with each other.
4. Open **Settings → Controller and connection → SP630E · Bluetooth**, then close Settings. Click **Connect Bluetooth** and choose the SP630E. The chooser lists all devices because the SP630E name can be changed; choose this controller deliberately.
5. Look for GATT connect completion, model service/characteristic discovery, then Ready. No initialization color/power command is sent. The supported endpoint is characteristic `0000ffe1-0000-1000-8000-00805f9b34fb` under service `0000e0ff-0000-1000-8000-00805f9b34fb` or `0000ffe0-0000-1000-8000-00805f9b34fb`.
6. Select Red, Green, Blue, adjust brightness, and try off/on. Judge response on a healthy strip section. Optional diagnostic tests and endpoint caching are still optional; startup needs no checkbox.
7. Leave it connected for at least 30 minutes, changing a preset occasionally. Also change colors every few seconds for about a minute to exercise writes at a typical album-change rate. Copy the log if it drops or exhausts its four retries.
8. Try three ordinary starts at different times: Disconnect lights/Connect, close and reopen the page, and another later session. Resetting Bluetooth/controller power repeatedly should not be necessary.

After the manual preview is accepted and the reviewed update is released on the **existing production URL**, use **Start Album Glow** for a normal Spotify session. Do not change Spotify redirect registration or transfer tokens to a preview to run this test.

## Test 2: SP803E USB fallback

1. Disconnect the Bluetooth controller, remove power, and move the strip/supply to the SP803E. Keep only this controller connected to the strip outputs.
2. Configure its included **WLED** firmware once. Join its `WLED-AP` Wi-Fi network (factory password `wled1234`) and open **http://4.3.2.1/**. This is a local setup page; it does not replace the public Album Glow website.
3. In **Config → LED Preferences → Hardware Setup**, change the existing output to **PWM RGB**, with **R = GPIO 25, G = GPIO 26, B = GPIO 27**. Use one output/one logical RGB light; if a length field appears, use 1. Use segment 0 for that output. Save and allow it to restart. Rejoin the Chromebook's normal internet Wi-Fi afterward. Ongoing USB control does not require Wi-Fi to the controller.
4. SP803E output **VCC** supplies the strip's V+. In that configuration, **PWM3 / IO25** is R, **PWM2 / IO26** is G, and **PWM1 / IO27** is B. Leave SPI **DATA / IO16** unused. Match strip connector markings before attaching pigtail wires.
5. Keep the 12 V adapter connected and connect USB-C to the Chromebook using a **data-capable** cable. A charging-only cable cannot carry commands. Close firmware flashers/serial monitors so they do not hold the port.
6. In Album Glow Settings select **SP803E · USB / WLED**. Click the main **Connect USB** button and select this controller's port. Its label can vary with the USB bridge chip.
7. Album Glow opens at **115200 baud**, sends only `{"v":true}` to identify WLED, and waits for a valid response before enabling controls. Opening may restart the ESP32, so it can probe the same open port up to five times. It does not repeatedly reopen/reset the port.
8. Repeat the manual controls and 30-minute session from Bluetooth, plus Disconnect/Connect and a page reload. A cable loss pauses sync; reconnecting with Connect USB can resume its previous intent. Explicit Disconnect lights or changing controller stops sync.

If there is **No WLED reply**, verify the port/data cable and WLED's 115200 serial setting. Its serial RX/TX pins must not also drive LEDs; the PWM pins above avoid the ordinary ESP32's UART pins 1/3. Copy the Album Glow log and note the firmware version from WLED Info. Completed browser writes are not physical confirmation.

## Decide which controller to keep

Keep USB until Bluetooth has worked across several ordinary starts and a normal Spotify session, within the seller's return window. The earlier Apollo once passed a short test and later failed, so one connection is insufficient evidence.

| Check | SP630E Bluetooth | SP803E USB |
| --- | --- | --- |
| Normal starts succeeded / attempted | | |
| Unexpected drops during the session | | |
| Controls stayed responsive | | |
| Reconnect worked after disconnect/reload | | |
| Spotify session stayed usable on production | | |

The user prefers Bluetooth if it proves dependable. If it repeatedly fails at native GATT connect while USB remains stable, USB bypasses that connection path. The comparison still does not prove which radio, driver, or controller component is defective. No physical reliability result is claimed by the source changes or simulations.

## Implementation and reference evidence

- **SP630E:** unencrypted BanlanX SP6xxE has a six-byte header (`53`, command, key `00`, packet fields `01 00`, payload length). A color batch selects static solid mode (command `53`, payload `01 01`), then sends RGB/full controller brightness (command `52`, payload R/G/B/255). Power is command `50` with a boolean byte. Two-frame colors stay together in the paced GATT lane; obsolete unsent batches coalesce as a unit. The page scales RGB. Strip type remains explicit setup; initialization does not rewrite configuration.
- **USB/WLED:** newline-delimited JSON selects solid color on segment 0 with brightness 255 because the page has already scaled RGB. Power uses WLED on/off. The initial response supplies reported controller power/RGB, not physical LED health. Native open/write/close remain fenced until completion. Reply timeouts never free unfinished native work. Cleanup failures block later sessions; reservations remain until the port closes.
- Native Web Locks coordinate one USB WLED session per website origin. Web Serial exposes USB VID/PID without a stable unique identity for every identical unit. Ambiguous permitted ports trigger a chooser instead of an arbitrary choice, and hotplug events refresh grants so a replug can use the new port object. A losing tab makes no native USB calls. Different origins/profiles/apps cannot share the guard; document destruction leaves native cleanup to the browser.
- Logs distinguish **BT** and **USB**. Raw serial/debug output is not logged. Spotify tokens stay excluded; PKCE and the production redirect are unchanged.

Sources inspected:

- [SP630E specifications](https://www.btf-lighting.com/products/sp630e-all-in-one-led-controller)
- [UniLED SP630E / BanlanX SP6xxE protocol](https://github.com/monty68/uniled/blob/main/custom_components/uniled/lib/ble/banlanx_6xx.py) — reference for packet facts/endpoints; no Home Assistant service is needed.
- [SP803E specifications](https://www.btf-lighting.com/products/sp803e-wled-esp32-wifi-led-controller) and [manufacturer manual](https://cdn.shopify.com/s/files/1/0023/2960/8292/files/SP803E.pdf?v=1790149644)
- [WLED serial](https://kno.wled.ge/interfaces/serial/) and [JSON API](https://kno.wled.ge/interfaces/json-api/)
- [Chrome Web Serial](https://developer.chrome.com/docs/capabilities/serial)
