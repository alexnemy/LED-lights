# Album Glow maintenance

- Start with the existing application; preserve the current design and Spotify PKCE flow.
- Production website/redirect: https://cosmic-snickerdoodle-3a661b.netlify.app/ (including trailing slash). Do not create a new public website or change this URI without an explicit request.
- This repository is alexnemy/LED-lights, selected by the owner for Album Glow. Do not modify unrelated repositories.
- Cloud tasks are already isolated. Use the existing checkout; do not create a worktree unless the user explicitly asks.
- No runtime dependencies, backend, framework, or database are needed. Use Node 24 for development checks: `npm test` and `npm run build` from the repository root.
- Read docs/BLUETOOTH.md for findings and acceptance checks. Never claim physical BLE reliability from simulated tests. Brightness is RGB scaling; Apollo power bytes remain unverified on this controller.
- GATT operations must remain serialized across sessions. Preserve stale-session cancellation, optional endpoint verification in Settings, bounded retries, and the browser's user-gesture requirement for device selection. The owner requested one-click startup without a mandatory color-test checkbox; do not reintroduce that gate. Manual presets/hex colors must pause Spotify syncing and cancel stale album commands.
- Never log or commit Spotify tokens, Client Secrets, browser storage exports, or OAuth callback URLs. Client ID stays user-configurable in the page.
- Use review branches/PRs; do not merge or deploy to the live Netlify site without user authorization for the reviewed release. See docs/DEPLOYMENT.md.
