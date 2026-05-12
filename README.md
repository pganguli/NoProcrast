NoProcrast
==========

A browser extension that limits time spent on distracting websites, modelled on Hacker News's `noprocrast` feature.

Each tracked site gets a configurable visit window (`maxvisit` minutes of wall-clock time from first visit). Once that window closes, the tab redirects to a block page and stays blocked for a cooldown period (`minaway` minutes). A manual override is available — it grants one fresh `maxvisit` window but does not disable the system; once that window closes, the site blocks again normally.

How it works
------------

Time is measured using a wall-clock session window, not accumulated active-tab time:

- The first navigation to a tracked domain starts a session window and records the current time.
- Every subsequent navigation to that domain checks how much wall-clock time has elapsed since the window started.
- If less than `maxvisit` minutes have elapsed, access is allowed with no state change.
- If `maxvisit` minutes have elapsed but the `minaway` cooldown has not yet passed, the tab is redirected to the block page.
- Once the full `maxvisit + minaway` period has elapsed since the session started, the next visit automatically starts a fresh window.

The block page shows how many minutes remain in the cooldown. If you return to an open blocked tab after the cooldown has expired, the page detects this and redirects you back to the site automatically.

All timing is checked at navigation boundaries — no background polling, no content scripts.

Configuration
-------------

Global defaults (configurable in Settings):

  `maxvisit =  20 minutes`
  `minaway  = 180 minutes`

Per-site overrides for `maxvisit` and/or `minaway` can be set from the Settings page.

Subdomain matching is hierarchical: adding `youtube.com` covers `www.youtube.com`,
`music.youtube.com`, and any other subdomain, with a shared time budget. Adding
`www.youtube.com` specifically tracks only that subdomain and leaves others unaffected.

Install
-------

- [Chrome Web Store](https://chromewebstore.google.com/detail/gdhkkiefjifcbbkkbabeohefccacpabn)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/noprocrast/)

Browser support
---------------

  Chrome 120+ (MV3, service worker)

  Firefox 140+ (MV3, service worker)

The extension source is identical across browsers. A build step generates a browser-specific `manifest.json` from `manifest.base.json`, which is the shared source of truth.

Installation (unpacked)
-----------------------

Chrome:

1. Clone the repository.
2. Run: `npm install && npm run build:chrome`
3. Open `chrome://extensions` and enable Developer mode (toggle, top-right).
4. Click "Load unpacked" and select the repo directory.
5. Pin the extension via the puzzle-piece icon in the toolbar.

To reload after code changes: run `npm run build:chrome`, then click the refresh icon on the extension card.

Firefox:

1. Clone the repository.
2. Run: `npm install && npm run build:firefox`
3. Open `about:debugging` and click "This Firefox" in the left sidebar.
4. Click "Load Temporary Add-on..." and select `manifest.json` from the repo.

The extension stays loaded until Firefox restarts. To reload after code changes: run `npm run build:firefox`, then click the Reload button on `about:debugging`.

Development
-----------

  `npm run build:chrome` Generate `manifest.json` for Chrome

  `npm run build:firefox` Generate `manifest.json` for Firefox

  `npm run lint` Run ESLint (must pass with zero warnings or errors)

`manifest.json` is generated and not tracked by git. Always run the appropriate build command before loading or reloading the extension in a browser.

File structure
--------------

```text
manifest.base.json        Shared manifest source (no background field)
scripts/
  build-manifest.js       Generates manifest.json for a given browser
shared/
  browser-api.js          Unified api export (only file referencing chrome/browser)
  storage.js              Storage read/write helpers
  domain.js               domainMatches(), extractHostname(), getConfigDomain()
  limits.js               getEffectiveLimits()
  navigation.js           isExtensionPage(), redirectTabToBlockPage()
background/
  service-worker.js       All event listeners and timer logic
pages/
  blocked.*               Block page with timed override
popup/
  popup.*                 Status view with quick add-site
options/
  options.*               Settings page
icons/
  icon16.png
  icon48.png
  icon128.png
```

License
-------

See [LICENSE](LICENSE).
