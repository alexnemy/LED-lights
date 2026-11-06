# Keep the existing Netlify website

The required site is **https://cosmic-snickerdoodle-3a661b.netlify.app/**. Do not create a new Netlify project, rename this one, or change its domain. This document prepares the GitHub workflow; it does not deploy anything by itself.

## Review before release

The original ZIP is preserved on `main` (`2e642fc`). The proposed update is on `bluetooth-reliability`, in separate commits. Review the pull request before merging. The repository can be public without containing a Spotify secret; the Client ID is entered in the page. Tokens must never go into GitHub or Netlify environment variables for this static app.

The current live deployment is not changed by the work in this repository. Connecting a Git repository to Netlify can trigger an initial build, so protect the existing deployment **before** connecting it.

## Link GitHub to the existing site

Netlify's wording can vary; open settings for the existing project, not “Add new project.”

1. Sign in to [Netlify](https://app.netlify.com/) and open **cosmic-snickerdoodle-3a661b**. In **Deploys**, find the currently published working deploy. Use its menu's **Lock to this deploy** / stop auto-publishing control if offered. Confirm that automatic publishing is stopped and the working deploy remains published. Record its deploy entry so you can return to it. If you cannot find a way to prevent publication, wait to connect until the code is reviewed and you are ready to release.
2. Open **Project configuration → Build & deploy → Continuous deployment → Repository** (sometimes called **Site configuration**). Choose **Link repository** / **Link to a Git repository**. If a repository is already linked, inspect it first rather than replacing an unexpected configuration blindly.
3. Choose GitHub. If Netlify asks for GitHub access, authorize the Netlify GitHub app for **alexnemy/LED-lights** only. No repository creation permission is needed. This is the one account authorization you may need to perform personally.
4. Select **alexnemy/LED-lights**, with production branch **main**. Keep the base directory empty (repository root). On the updated branch, `netlify.toml` supplies build command **`npm test && npm run build`** and publish directory **`dist`**, with Node **24**. No functions, database, paid plan, or secrets are needed. If Netlify asks for these values before the update reaches main, enter those same settings; the old baseline has no build script, so a pre-merge build may fail. Keep the existing deployment locked and do not publish such a build.
5. If available on your free plan, enable deploy previews for the pull request. A preview can check layout and **manual Bluetooth** on HTTPS. Do not sign in to Spotify there: its different hostname is not registered as your production redirect URI. The original code deliberately derives the redirect from its current origin/path.
6. Review the PR and manual Bluetooth results. Merge only when ready. Let Netlify build the reviewed main commit. Confirm tests/build succeed and both `index.html` and `bluetooth.js` exist in its deploy file listing. While publication is locked, this build should not replace the current site.
7. When you decide to release, publish the successful reviewed deploy using Netlify's deploy controls (unlock auto-publishing if required). Keep the site name unchanged. Confirm the published address is still **https://cosmic-snickerdoodle-3a661b.netlify.app/** and the page's displayed Spotify redirect includes the final `/`.
8. Run the production Spotify/LED test in [BLUETOOTH.md](BLUETOOTH.md). After acceptance, leave automatic publishing enabled for reviewed commits merged into `main`. Use pull requests for future Codex changes.

If the preview/locking controls are not available, the free fallback is to review the code first, run `npm test` and `npm run build`, and manually upload **the contents of `dist/`** to the **existing site's** Deploys panel when ready. Then connect GitHub once you are comfortable enabling deployments. Do not upload the source ZIP or only `index.html` for this update: it needs `bluetooth.js` too.

## Future workflow

**Codex changes on a branch → GitHub pull request and checks → review and merge to main → Netlify builds → same existing website.**

Netlify needs a one-time GitHub repository authorization and link. No Netlify integration/credential was available to the development session, so this account step was not performed automatically. Neither repo pushes nor `netlify.toml` alone prove that continuous deployment is connected.

## Spotify settings

Keep the existing Spotify app and Client ID. The authorized redirect is exactly:

```text
https://cosmic-snickerdoodle-3a661b.netlify.app/
```

No Client Secret is used in browser PKCE. You do not need a new Spotify app, Client ID committed to source, or any redirect change for a deployment to the same site root. Existing browser storage/settings remain on the same origin. If Spotify shows `redirect_uri: Not matching configuration`, compare the displayed URI with the dashboard's saved URI character-for-character, including the trailing slash; check that you opened the production root, not an `/index.html` path or preview hostname.

## Roll back

In the existing Netlify project's **Deploys**, choose the recorded previous working deploy and publish/restore it, then lock publication while investigating. This restores the same domain and redirect. GitHub retains the original import, and the reliability changes are in separate commits, so they can be reviewed/reverted without deleting the project or creating a new website.
