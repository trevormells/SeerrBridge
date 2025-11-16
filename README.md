# SeerrBridge – Overseerr helper

SeerrBridge is a Manifest V3 Chrome extension that keeps an eye on the page you're currently visiting, pulls out titles it thinks are movies or TV series, and lets you send Overseerr requests with one click. It enriches detections and manual searches with the metadata returned by your Overseerr instance so you can see posters, ratings, and release years before submitting a request.

## Features

- Lightweight toolbar popup that lists the titles detected on the active tab along with metadata and quick actions.
- Manual Overseerr search built into the popup for when our detector can't identify something on the page.
- Configurable Overseerr base URL and detection preferences saved securely with `chrome.storage`.
- Background service worker that performs Overseerr lookups and requests so they keep working even when the popup is closed.
- Options page with a quick Overseerr session check that opens a login tab when needed.

### Popup architecture

The popup entry point (`src/popup/index.js`) now composes smaller modules so maintenance is easier:

- `src/popup/state.js` – stores the popup state tree, setup checklist flags, and async token counters shared across modules.
- `src/popup/mediaUtils.js` – pure helpers for deduping detections, preparing status/rating fetch queues, and building request button states.
- `src/popup/overseerrData.js` – data shapers that normalize Overseerr API responses and build consistent poster/rating payloads.
- `src/popup/renderers.js` – DOM helpers that render media cards and use a configurable context for handling button actions.

Import these helpers into new features instead of growing `index.js` so UI concerns, Overseerr calls, and state transitions stay isolated.

## References

- Overseerr API docs – https://api-docs.overseerr.dev/#/ (primary source for endpoint contracts, required payloads, and auth behavior while building the extension)
- Overseerr project – https://github.com/sct/overseerr (context on the upstream feature set, UI flows, and session handling that SeerrBridge plugs into)

## Getting started

1. Clone this repository and open `chrome://extensions` in Chrome.
2. Enable **Developer mode** and choose **Load unpacked**, then select the `SeerrBridge` directory.
3. Pin the extension in the toolbar and click it to open the popup.
4. Use the **Settings** button in the popup (or right-click → **Options**) to provide the base URL to your Overseerr instance. Click **Test Overseerr** to verify the session. If you’re signed out, the extension opens a tab so you can log into Overseerr; once the login completes the extension automatically uses that session.
5. Browse to any streaming or info page, open the popup, and hit **Rescan**. Detected titles will render with “Request” buttons once your Overseerr settings are in place and the session is active.
6. If detection fails, run a manual Overseerr search from the popup and request directly from the search results list.

> Tip: the popup status banner will let you know if any required settings are missing. Use the options page to test your Overseerr connectivity whenever you update the server URL or after logging out of Overseerr.

## Versioning & releases

We follow [Semantic Versioning](https://semver.org/) and track user-visible changes in [`CHANGELOG.md`](CHANGELOG.md). Every tagged release should include an associated GitHub release so extension users have downloadable artifacts and clear release notes.

### Release checklist

1. **Update notes** – Move entries from the **Unreleased** section of `CHANGELOG.md` into a dated section like `## [0.2.0] - 2025-12-01`, keeping the Unreleased section ready for upcoming changes.
2. **Run tests** – Execute `npm test` to run syntax checks over every JavaScript file. Fix any issues before continuing.
3. **Bump the version** – Run `npm version <patch|minor|major>`. The npm lifecycle hook automatically keeps `manifest.json` in sync and creates a Git tag for the new version. Review the generated commit and tag before pushing.
4. **Build store packages** – Run `npm run build` (optionally pass `-- --targets=chrome,edge`) to generate ZIPs in `release/artifacts/<version>/<target>/`. Each folder includes:
   - The upload-ready ZIP
   - `build-info.json` with the manifest/package version, commit SHA, and checksum
   - A `STORE_NOTES.md` checklist you can fill in before submitting to a store
5. **Push commits & tag** – Push the branch and tag upstream with `git push origin main --follow-tags`.
6. **Upload to the Chrome Web Store**
   - Sign in to the Chrome Web Store Developer Dashboard.
   - Choose the SeerrBridge item and click **Upload new package**.
   - Select the ZIP produced in `release/artifacts/<version>/chrome/` and publish or submit for review as needed.
7. **Upload to any additional stores** – Reuse the `release/artifacts/<version>/<target>/` folders so Edge or other stores get the exact build captured in version control.
8. **Draft the GitHub release** – Create a GitHub release from the pushed tag and paste in the matching section from the changelog. Attach the ZIP if you need downloadable artifacts outside the Web Store.

Following this checklist keeps the manifest version, Git metadata, changelog, and store upload in sync for every release.
