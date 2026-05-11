# Privacy Policy

**Effective date:** 2026-05-10

## What Noprocrast does

Noprocrast is a browser extension that limits time spent on user-configured websites. It tracks how long you spend on sites you have chosen to block, and redirects you to a block page once your configured time allowance is used up.

## Data collected

Noprocrast stores the following data **locally on your device** using the browser's built-in `storage.local` API:

- The list of domains you have added to your block list
- Per-site time limits (`maxvisit` and `minaway`) that you have configured
- Per-domain session state: elapsed visit time and block timestamps, used solely to enforce your configured limits

No other data is collected.

## Data sharing and transmission

Noprocrast does not transmit any data off your device. It makes no network requests. There are no servers, no analytics, no telemetry, and no third-party services involved.

## Data storage

All data is stored locally in your browser using `browser.storage.local`. It is not synced across devices. It is cleared when you uninstall the extension.

## Permissions used

| Permission | Why it is needed |
|---|---|
| `storage` | Save your site list, time limits, and session state locally on your device |
| `webNavigation` | Detect when you navigate to or away from a tracked site in order to measure time spent |
| `activeTab` | Read the current tab's URL to pre-fill the domain field in the popup |
| `<all_urls>` | Observe navigations to any URL, since you can add any domain to your block list |

## Contact

If you have questions about this policy, open an issue at the project's GitHub repository.
