# SeerrBridge Privacy Policy

_Last updated: 2025-11-16_

SeerrBridge is a Chrome extension that analyzes the page you explicitly interact with, finds potential movie or TV titles, and helps you submit matching requests to your personal Overseerr server. This policy explains what information the extension processes, how it uses that information, and the limits on any sharing.

## Data collection
- **Configuration values you provide** (Overseerr base URL, preferred request types, popup display settings) are stored locally using Chrome's `storage.sync` so they can be applied across your signed-in Chrome browsers.
- **Page metadata needed for detection** is read from the tab you manually scan (e.g., via the popup's **Rescan** button). The extension inspects structured data, headings, and visible text solely to extract potential media titles.
- The extension **does not collect or transmit** personally identifiable information, payment data, health data, browsing history beyond the active tab, or any keystrokes.

## Data usage
- Configuration values are used only to contact the Overseerr instance you control, determine whether to prefer 4K requests, and render the popup UI according to your preferences.
- Detected titles and manual searches are sent directly to your Overseerr server to retrieve metadata and submit requests. These calls occur via the credentials managed by Overseerr in your browser tab; SeerrBridge never handles your username or password.
- Page content is processed in-memory within the content script and popup for detection purposes and is not persisted or transmitted to external services.

## Data sharing and storage
- SeerrBridge does **not** share user data with any third parties. All network requests are directed to the Overseerr server whose URL you provide.
- Configuration values remain in Chrome's synced storage until you remove the extension or clear your browser data.
- The extension does not operate a backend service and does not log or store any diagnostics outside of your own machine.

## Permissions
SeerrBridge requests only the permissions needed to perform its single purpose:
- `activeTab` to read and scan the tab you explicitly interact with.
- `tabs` to open or focus Overseerr tabs when the popup needs you to log in or when you want to inspect a title in Overseerr.
- Host permissions for pages you visit so the detector can read on-page metadata.

## Your choices
- You can edit or delete your configuration data at any time through the extension options page or by clearing Chrome's extension storage.
- Removing the extension from Chrome deletes all locally stored configuration data.

## Contact
If you have questions about this policy or SeerrBridge's handling of data, please open an issue on the project's GitHub repository.
