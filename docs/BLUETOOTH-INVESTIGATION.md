# Bluetooth connection investigation

## Finding

The repeated `NetworkError: Unknown error when connecting to the device` traces are failures in **Chrome/ChromeOS's connection to this Apollo controller**, while Album Glow awaits `device.gatt.connect()`. The traces do not show an Album Glow color command, Spotify poll, or application service/characteristic query causing those failed attempts.

This establishes the failing layer, not a defective Chromebook radio or a specific controller/driver fault. ChromeOS's Floss backend deliberately collapses multiple native failure statuses into this one generic error. JavaScript cannot recover the discarded reason from that message.

The website has also had separate preventable connection-management weaknesses. The audit fixes those below. They must not be presented as proof that the isolated native connection failure is solved.

## Evidence already available

| Observation | What it supports | What it does not establish |
| --- | --- | --- |
| Repeated initial failures logged at `GATT connect`, without its completion line | Native connect rejected before Album Glow's subsequent discovery or LED commands | Which native status, radio, firmware, or OS component failed |
| One attempt completed discovery, physically matched RGB tests, then disconnected about seven seconds later | The selected endpoint/protocol can control this controller; post-connect link loss also occurs | That every disconnect is caused by writes, or that a successful browser write guarantees firmware state |
| A 15-minute manual-color session passed | This Chromebook/controller combination can work for a sustained session | That intermittent connection establishment is fixed |
| Another Album Glow tab was open during a later failing attempt | A real competing-client risk exists | That the extra tab caused that native error, or explains the earlier reportedly isolated failure |
| The “unsupported unpaired device” warning appeared in ChromeOS | The device was filtered from a Settings device list | That Web Bluetooth rejected it as an unsupported controller |
| An adapter off/on sequence appeared around 7:33 PM | The user confirmed they manually toggled Bluetooth then | An automatic adapter reset, or the cause of the earlier 7:29 PM attempt |
| The preview produced a permissions-policy error, then opened the chooser in a direct tab | The embedded-page permission restriction was bypassed by using the actual site directly | An explanation for later native GATT connection failures |

## Chromium source investigation

The reference implementation inspected is the official Chromium M156 branch 8078 snapshot **`e578526bedf0f2933107eb18df7d35c03e9acf5b`**, whose `chrome/VERSION` is **156.0.8078.98**. This matches the reported major version; it does not verify the owner's exact installed patch, vendor build, or ChromeOS image. The supplied system log identifies the Floss backend.

### The exact error loses the native reason

1. `BluetoothDeviceFloss::GattClientConnectionState` converts any non-success GATT status to `ERROR_UNKNOWN`, with a TODO for more detailed conversion ([Floss lines 1103–1130](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/device/bluetooth/floss/bluetooth_device_floss.cc#1103)).
2. The browser maps `ERROR_UNKNOWN` to `CONNECT_UNKNOWN_ERROR` ([service lines 223–228](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/content/browser/bluetooth/web_bluetooth_service_impl.cc#223)).
3. Blink exposes precisely `NetworkError` / `Unknown error when connecting to the device.` ([error mapping lines 135–136](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/third_party/blink/renderer/modules/bluetooth/bluetooth_error.cc#135)).

“NetworkError” here is a DOM Bluetooth error, not evidence of a Netlify or internet failure. The browser also sends the renderer a parameterless `GATTServerDisconnected()` event, without a native reason code ([Mojo lines 369–373](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/third_party/blink/public/mojom/bluetooth/web_bluetooth.mojom#369)).

### Native initialization happens inside connect

On a native connection notification, Floss requests maximum MTU 517 ([connection/MTU lines 1118–1124](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/device/bluetooth/floss/bluetooth_device_floss.cc#1118)). Its MTU callback starts native service discovery and completes the connection callback ([MTU callback lines 1201–1220](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/device/bluetooth/floss/bluetooth_device_floss.cc#1201)).

A brief connection notification in ChromeOS can therefore occur before the website sees connect succeed. That is consistent with the reported short-lived native connections, but **does not prove MTU negotiation is the fault**. The browser's GATT API does not give Album Glow control over MTU or these native connection parameters. Reducing Album Glow's later discovery calls cannot repair an already rejected connect operation; native discovery can already be involved below that API boundary.

### The unsupported-device warning is a Settings filter

`AttemptSetDeviceInUnpairedDeviceList` emits the warning and skips a Settings list entry ([device cache lines 274–287](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/chromeos/ash/services/bluetooth_config/device_cache_impl.cc#274)). The filter intentionally hides many BLE devices except specified classes such as HID/security keys ([filter lines 417–448](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/device/bluetooth/chromeos/bluetooth_utils.cc#417)). This is not the Web Bluetooth unsupported-device error path.

### Multiple tabs require careful interpretation

Chromium can reuse an existing GATT link and join a pending connection attempt ([device lines 427–459](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/device/bluetooth/bluetooth_device.cc#427)). It reference-counts connections and disconnects the native link after the last connection reference is removed ([lines 665–670](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/device/bluetooth/bluetooth_device.cc#665)). Thus “another tab was open” alone is not a native failure diagnosis. Tabs can nevertheless send competing LED commands and independently retry, so coordinating Album Glow tabs is a valid application fix.

### An artificial delayed-disconnect race was not accepted as a diagnosis

An adversarial fake can delay an old explicit disconnect event until a replacement connection is running. The inspected Chromium implementation, however, dispatches explicit disconnect cleanup synchronously, clears its old receivers, and then sends the browser disconnect request ([server lines 144–164](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/third_party/blink/renderer/modules/bluetooth/bluetooth_remote_gatt_server.cc#144); [direct dispatch lines 87–90](https://chromium.googlesource.com/chromium/src/+/e578526bedf0f2933107eb18df7d35c03e9acf5b/third_party/blink/renderer/modules/bluetooth/bluetooth_device.cc#87)). The artificial failure would also log `AbortError` and explicit cleanup, unlike the supplied initial `NetworkError` traces. No speculative rewrite was made around that assumption.

## Application fixes from this audit

- **Per-device tab ownership:** native Web Locks prevent two cooperating Album Glow tabs on the same origin from connecting/controlling one controller simultaneously. A losing page gets a readable existing-tab message and makes zero native connect, disconnect, discovery, or write calls. The owner keeps its reservation through retries.
- **Safe release:** Disconnect invalidates queued work immediately but ownership remains reserved until any old native connect/write and cleanup settle. Superseded pending acquisitions release before newer ones proceed. Failed ownership release fences later work instead of silently bypassing protection.
- **Bounded failure:** after the existing four retries, a disconnected session releases ownership and the UI explains whether Chrome failed to establish the connection or an established link was lost. The retry budget was not inflated to hide failure.
- **Same-controller reuse:** selecting an already-ready controller in the chooser preserves the current session/characteristics and Spotify sync instead of intentionally disconnecting/reconnecting it.
- **Page lifecycle cleanup:** pagehide cancels startup, chooser results, timers, syncing, and the connection. Normal background/visibility changes keep Bluetooth connected.
- **Granted-device race:** a late getDevices preload no longer overwrites a newer device choice.

Web Locks coordinate **one origin**. A Netlify preview, production site, different Chrome profile, phone app, and other applications do not share that lock namespace. When the browser destroys a document, the browser itself manages native cleanup and automatic lock release; page JavaScript cannot guarantee ordering across a destroyed context. Unsupported browsers retain their previous behavior with a diagnostic note. This guard is prevention of competing application work, not a claim of exclusive control over every Bluetooth client on the computer.

No UUIDs, color/power protocol bytes, write-response preference, or native MTU assumptions were changed. Brightness remains RGB scaling, and the original hardware power commands remain unverified on this physical controller.

## Validation and practical limit

The existing 76 tests passed before changes. All **105 automated tests** pass after the audit adds ownership, cancellation, lifecycle, and integration regressions. In particular, the five-attempt native failure test verifies **zero application discovery calls and zero LED writes**. Tests hold old native connect/write promises pending, confirm a second page is blocked, then resolve them late and verify safe handover. Permission errors and failed ownership releases do not bypass protection.

Chromium browser tests use **real Web Locks across pages** with simulated Bluetooth: same-origin contention, no Bluetooth calls from the blocked page, release/handover, pagehide cleanup, preserving an already-ready controller, and the explicit different-origin limitation. The existing UI/Spotify/brightness/live-color/clipboard checks also pass with simulated services.

These tests validate application behavior. They do not reproduce this physical Chromebook/LED controller's radio, firmware, ChromeOS daemon, or real Spotify account. A native Bluetooth promise that never settles still cannot be safely replaced by an overlapping operation: the controller deliberately retains its serialized lane and ownership until native work settles, rather than using a misleading timeout race. The earlier supplied traces did settle with errors, so a hung promise does not explain those particular attempts.

The evidence supports saying **the Chromebook's ChromeOS Bluetooth connection to this particular controller is intermittently failing**. It does not support naming a defective hardware component, declaring the controller protocol broken, claiming every failure is tab contention, or claiming these application safeguards have repaired the native link.
