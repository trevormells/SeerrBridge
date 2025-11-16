# SeerrBridge – Overseerr helper

SeerrBridge is a Manifest V3 Chrome extension that keeps an eye on the page you're currently visiting, pulls out titles it thinks are movies or TV series, and lets you send Overseerr requests with one click. It enriches detections and manual searches with the metadata returned by your Overseerr instance so you can see posters, ratings, and release years before submitting a request.

## Features

- Lightweight toolbar popup that lists the titles detected on the active tab along with metadata and quick actions.
- Manual Overseerr search built into the popup for when our detector can't identify something on the page.
- Configurable Overseerr base URL and detection preferences saved securely with `chrome.storage`.
- Background service worker that performs Overseerr lookups and requests so they keep working even when the popup is closed.
- Options page with a quick Overseerr session check that opens a login tab when needed.

## Getting started

1. Clone this repository and open `chrome://extensions` in Chrome.
2. Enable **Developer mode** and choose **Load unpacked**, then select the `WeerrWatching` directory.
3. Pin the extension in the toolbar and click it to open the popup.
4. Use the **Settings** button in the popup (or right-click → **Options**) to provide the base URL to your Overseerr instance. Click **Test Overseerr** to verify the session. If you’re signed out, the extension opens a tab so you can log into Overseerr; once the login completes the extension automatically uses that session.
5. Browse to any streaming or info page, open the popup, and hit **Rescan**. Detected titles will render with “Request” buttons once your Overseerr settings are in place and the session is active.
6. If detection fails, run a manual Overseerr search from the popup and request directly from the search results list.

> Tip: the popup status banner will let you know if any required settings are missing. Use the options page to test your Overseerr connectivity whenever you update the server URL or after logging out of Overseerr.

## Versioning & releases

We follow [Semantic Versioning](https://semver.org/) and track user-visible changes in [`CHANGELOG.md`](CHANGELOG.md). Every tagged release should include an associated GitHub release so extension users have downloadable artifacts and clear release notes.

1. Update the **Unreleased** section of `CHANGELOG.md` with the notes you plan to ship, then rename it to a dated section like `## [0.2.0] - 2025-12-01`.
2. Run `npm version <patch|minor|major>` to bump the package version. The `version` lifecycle hook automatically mirrors that version into `manifest.json` and stages the manifest change so Git tags and Chrome metadata stay in sync.
3. Push the commit and newly created Git tag: `git push origin main --follow-tags`.
4. Create a GitHub release from that tag and paste in the matching section from the changelog. Attach packaged extension builds if desired.

This process ensures the manifest version, Git metadata, and published changelog never drift.
