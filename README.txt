ALBUM GLOW — Faster Spotify Detection (No Linux)
Target: AP-E1044600F933

WHAT'S NEW
- Spotify checks every 2 seconds by default, instead of every 8 seconds.
- Select 2, 3, 5, 8 or 15 seconds under "How quickly to detect album changes".
- Automatically waits when Spotify responds with HTTP 429 (rate limited) and respects its Retry-After header when provided.
- Avoids overlapping automatic Spotify requests on slow connections.
- Checks immediately when syncing starts or when the Album Glow browser tab becomes visible again.
- Retains Vivid LED Colors, Bluetooth tests, Spotify sign-in and your existing stored Client ID on the same site URL.

IMPORTANT
- An instant (<1 second) update isn't guaranteed because Spotify's currently-playing endpoint is polled, not pushed. Most changes should be detected within roughly the chosen interval plus network and Spotify reporting delays while the page is active.
- The Spotify API can rate limit frequent requests. If you encounter repeated pauses on the 2-second setting, try 3 or 5 seconds.
- ChromeOS may throttle timers in background tabs; keep the Album Glow tab visible and Chromebook awake for the fastest results.
- Colors change when the ALBUM changes, not when a different track within the SAME album starts.
- You DO NOT need to use Linux or Python.

UPDATE THE EXISTING NETLIFY SITE
1. Sign into https://app.netlify.com, select the existing Album Glow project, and go to Deploys.
2. Drag the UNZIPPED folder of this new update into the manual deployment area (or upload the ZIP, if your Netlify upload panel supports ZIP deployments).
3. DO NOT create a new Netlify site — keep the same .netlify.app address, so your Spotify redirect URI remains valid.
4. Reload the same published URL in Chrome. Look for the new "How quickly to detect album changes" selector and the "Fast sync" label.
5. Reconnect Apollo Bluetooth and start automatic syncing. Spotify Client ID should still be saved in the browser.

SERVICE REFERENCES
Spotify currently playing endpoint: https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track
Spotify rate limits: https://developer.spotify.com/documentation/web-api/concepts/rate-limits


SMALL UPDATE (NOV 5): LED power + brightness
- Added an on/off button and a 0–100% brightness slider inside the Apollo Bluetooth panel.
- Uses the same Bluetooth characteristic as the working color tests and Spotify sync.
- Spotify colors and manual RGB tests are dimmed to the chosen brightness.
- Brightness uses RGB scaling (not a separate hardware brightness register).
- Sends Apollo-family power bytes CC2333 (on) / CC2433 (off); not tested on your physical controller.
- Retains existing Spotify authorization, colors, and limited-retry reconnect code.

NETLIFY
Deploy this ZIP as a new manual deployment for your EXISTING Netlify site.
Do not create a new site, since that could require a different Spotify redirect URI.
You should see the new controls below the RGB test buttons once deployed.
