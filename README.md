Noprocrast
==========

A browser extension that limits time spent on distracting websites, modelled on Hacker News's `noprocrast` feature.

Each blocked site gets a configurable visit window (`maxvisit` minutes). Once that window is used up, the tab redirects to a block page and stays blocked for a cooldown period (`minaway` minutes). A manual override is available but only resets the timer — it does not disable the system.

How it works
------------

- Navigation to a tracked domain records a visit start time.
- Navigation away (or closing the tab) flushes elapsed time into a session counter.
- When the session counter reaches `maxvisit`, the site is blocked and a cooldown alarm is scheduled via `browser.alarms`.
- After `minaway` minutes the alarm fires and the site is automatically unblocked.
- All timing is event-driven — no background polling, no content scripts.

Configuration
-------------

Global defaults (configurable in Settings):

  `maxvisit =  20 minutes`
  `minaway  = 180 minutes`

Per-site overrides for `maxvisit` and/or `minaway` can be set from the Settings page.
Subdomains match automatically: adding `reddit.com` also covers `old.reddit.com`.

Browser support
---------------

  Chrome   120+   (MV3, service worker)
  Firefox  128+   (MV3, background scripts)

The extension source is identical across browsers. A build step generates a browser-specific `manifest.json` from `manifest.base.json`, which is the shared source of truth. Chrome requires a plain service worker entry; Firefox additionally needs a `background.scripts` fallback.

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

  `npm run build:chrome`   Generate manifest.json for Chrome
  `npm run build:firefox`  Generate manifest.json for Firefox
  `npm run lint`           Run ESLint (must pass with zero warnings or errors)

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
  domain.js               domainMatches(), extractHostname()
  limits.js               getEffectiveLimits()
background/
  service-worker.js       All event listeners and timer logic
pages/
  blocked.*               Block page with timed override
popup/
  popup.*                 Status view with quick add-site
options/
  options.*               Settings page
```

License
-------

See LICENSE.
