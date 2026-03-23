# Noprocrast Browser Extension — Spec & Implementation Plan

## Overview

A browser extension that limits time spent on a configurable list of websites, modelled on
Hacker News's "noprocrast" feature. Each blocked site allows a user-defined visit window
(`maxvisit` minutes), followed by a mandatory cooldown (`minaway` minutes). A manual override
is available but only resets the timer — it does not disable the system.

Time is measured at navigation boundaries, not continuously. This keeps the extension
entirely event-driven with no background polling and no content scripts.

---

## 1. Functional Requirements

### 1.1 Core Behavior

- When a user navigates **to** a tracked domain, the current timestamp is recorded as
  `visitStart`.
- When the user navigates **away** from a tracked domain (to any other page, or closes the
  tab), elapsed time is computed as `now - visitStart` and added to `sessionUsed`.
- On any navigation **to** a tracked domain, before allowing access, the extension checks
  whether `sessionUsed >= maxvisit`. If so, the tab is redirected to the block page instead.
- Once blocked, the user must wait `minaway` minutes (measured from `blockedAt`) before
  access is restored. Restoration is handled by a `browser.alarms` alarm — no polling.

### 1.2 Configuration

#### Global Defaults
```
maxvisit  = 20   (minutes)
minaway   = 180  (minutes)
```

#### Site List
Each entry is a domain (e.g., `reddit.com`). Subdomains match automatically
(e.g., `old.reddit.com` also matches `reddit.com`).

#### Per-Site Overrides
Any site can override `maxvisit` and/or `minaway`. Unset fields fall back to the global
default.

Example config:
```json
{
  "global": { "maxvisit": 20, "minaway": 180 },
  "sites": [
    { "domain": "reddit.com" },
    { "domain": "twitter.com", "maxvisit": 10 },
    { "domain": "news.ycombinator.com", "maxvisit": 15, "minaway": 120 }
  ]
}
```

### 1.3 Override Behavior

- The block page includes an "Override" button with a 30-second timed confirmation.
- First click disables the button and begins a countdown (`OVERRIDE_DELAY = 30` seconds),
  displaying *"Hold on… Ns"*.
- After the countdown completes, the button re-enables with the label *"Click again to
  confirm override"*.
- Second click resets `sessionUsed` to zero and clears `blockedAt`, granting one fresh
  `maxvisit` window.
- After that window expires, the site blocks again normally.
- No limit on override frequency.

### 1.4 Block Page

When a site is blocked, the tab is redirected to `blocked.html` which shows:

- Which site is blocked.
- A static message: *"You will be able to use this site again in X minutes."*
  (X is computed once at page load from `blockedAt + minaway - now`; it does not count
  down live.)
- An "Override — I really need this" button with the 30-second countdown flow described
  in Section 1.3.
- On second confirmation click, the tab redirects back to the original URL.

---

## 2. Data Model

All state is stored in `browser.storage.local`.

### 2.1 Config Object
```
config: {
  global: { maxvisit: number, minaway: number },
  sites:  Array<{ domain: string, maxvisit?: number, minaway?: number }>
}
```

### 2.2 Per-Domain State Object

Stored under the key `state:${domain}`.

```
{
  sessionUsed: number,        // ms of visit time accumulated in the current window
  visitStart:  number | null, // timestamp of when the current visit began; null = not visiting
  blockedAt:   number | null  // timestamp of when this site was blocked; null = not blocked
}
```

`visitStart` persists to storage so that a browser restart mid-visit does not lose the
time already spent.

### 2.3 Effective Limits

```
function getEffectiveLimits(hostname, config):
  site = config.sites.find(s => domainMatches(hostname, s.domain))
  return {
    maxvisit: site?.maxvisit ?? config.global.maxvisit,
    minaway:  site?.minaway  ?? config.global.minaway
  }
```

### 2.4 Domain Matching

```
function domainMatches(hostname, configDomain):
  return hostname === configDomain || hostname.endsWith('.' + configDomain)
```

---

## 3. Cross-Browser Strategy

### 3.1 Browser Support Targets

| Browser | Minimum Version | Notes |
|---|---|---|
| Chrome  | 120+ | MV3, service worker background |
| Firefox | 128+ | MV3, service worker background |

### 3.2 Shared Codebase, Single Branch, Build Step

All application source lives on a single `master` branch. There are no per-browser
branches. The only file that differs between browsers is `manifest.json`, which is
**generated** by a build step and is **not committed to git**.

```
manifest.base.json          <- all shared manifest fields (no background field)
scripts/build-manifest.js   <- generates manifest.json for a given browser
manifest.json               <- generated; gitignored
```

Run before loading or reloading in either browser:
```
npm run build:chrome    # or
npm run build:firefox
```

#### `manifest.base.json`

Contains all fields shared across browsers, including `browser_specific_settings.gecko`
(Chrome silently ignores unknown keys):

```json
{
  "manifest_version": 3,
  "name": "Noprocrast",
  "version": "1.0.0",
  "description": "Limit time on distracting websites.",
  "permissions": ["storage", "alarms", "webNavigation", "activeTab"],
  "host_permissions": ["<all_urls>"],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_page": "options/options.html",
  "content_security_policy": {
    "extension_pages": "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'"
  },
  "browser_specific_settings": {
    "gecko": {
      "id": "NoProcrast@pganguli.github.io",
      "strict_min_version": "128.0"
    }
  }
}
```

#### What the build script adds

For **Chrome**: `background: { service_worker: "background/service-worker.js", type: "module" }`

For **Firefox**: `background: { service_worker: "background/service-worker.js", scripts: ["background/service-worker.js"] }`
(both fields; Firefox MV3 accepts `service_worker` but also requires `scripts` for some versions)

### 3.3 API Namespace Shim

`shared/browser-api.js` is the **only** file that references `chrome` or `browser`.
All other modules import `api` from this file.

```js
// shared/browser-api.js

/** @type {typeof browser} */
const api = globalThis.browser ?? globalThis.chrome;

export default api;
```

---

## 4. Extension Architecture

### 4.1 File Structure

```
noprocrast/
├── manifest.base.json       # Shared manifest source (no background field); committed
├── manifest.json            # Generated by build step — gitignored
├── scripts/
│   └── build-manifest.js    # Generates manifest.json for a given browser (CommonJS)
├── shared/
│   ├── browser-api.js       # API namespace shim
│   ├── storage.js           # Storage read/write helpers
│   ├── domain.js            # domainMatches(), extractHostname()
│   └── limits.js            # getEffectiveLimits()
├── background/
│   └── service-worker.js    # All event listeners and timer logic
├── pages/
│   ├── blocked.html
│   ├── blocked.js
│   └── blocked.css
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── .eslintrc.json
├── .eslintignore            # Ignores node_modules/ and scripts/ (CommonJS)
├── .gitignore               # Ignores node_modules/ and manifest.json
├── package.json
└── package-lock.json
```

There is **no content script**. The extension is entirely driven by `webNavigation` and
`tabs` events in the service worker.

### 4.2 Module Responsibilities

| File | Responsibility |
|---|---|
| `shared/browser-api.js` | Unified `api` export — only reference to `chrome`/`browser` |
| `shared/storage.js` | `getConfig()`, `saveConfig()`, `getState()`, `saveState()`, `clearState()`, `getAllStateDomains()` |
| `shared/domain.js` | `domainMatches(hostname, configDomain)`, `extractHostname(url)` |
| `shared/limits.js` | `getEffectiveLimits(hostname, config)` |
| `background/service-worker.js` | Navigation listeners, visit timing, block/unblock, alarm handling, all message handlers |
| `pages/blocked.js` | Displays remaining minutes, handles 30-second countdown override flow |
| `popup/popup.js` | Reads and displays per-domain status; quick add-site via `addSite` message |
| `options/options.js` | Reads/writes config, manages site list UI |

---

## 5. Core Logic (Service Worker)

### 5.1 Constants

```js
const ALARM_PREFIX = 'unblock:';
```

### 5.2 In-Memory Tab State

The service worker keeps an in-memory map of the last committed URL per tab. This is used
to flush the outgoing domain on each navigation without querying the tabs API:

```js
/** @type {Map<number, string>} tabId -> last known URL */
const tabUrls = new Map();
```

`tabUrls` is populated in `webNavigation.onCommitted` and entries are removed in
`tabs.onRemoved`.

### 5.3 Navigation Events

The service worker listens to two events on top-level frames only (`frameId === 0`):

**`webNavigation.onCommitted`** — fires when a navigation is committed in a tab.

Used for two purposes:

1. **Close out the previous visit**: look up the tab's previous URL in `tabUrls`, and if
   it was a tracked domain, flush elapsed time to storage.
2. **Check the new domain**: if the new URL is a tracked domain, check whether it is
   blocked or over its limit; redirect to the block page if so, otherwise record
   `visitStart`.

**`tabs.onRemoved`** — fires when a tab is closed.

Used to flush any open `visitStart` for that tab's last known URL.

No other events are needed.

### 5.4 Navigation Handler

```
async function handleNavigation(tabId, newUrl):

  previousUrl = tabUrls.get(tabId) ?? null
  tabUrls.set(tabId, newUrl)

  // --- Flush previous visit ---
  if previousUrl is set:
    prevHostname = extractHostname(previousUrl)
    prevConfig   = await getConfig()
    if prevHostname and isTracked(prevHostname, prevConfig):
      await flushVisit(prevHostname)

  // --- Check new destination ---
  if isExtensionPage(newUrl): return

  newHostname = extractHostname(newUrl)
  if not newHostname: return

  config = await getConfig()
  if not isTracked(newHostname, config): return

  state  = await getState(newHostname)
  limits = getEffectiveLimits(newHostname, config)

  // Check if currently blocked
  if state.blockedAt is not null:
    elapsed = Date.now() - state.blockedAt
    if elapsed >= limits.minaway * 60_000:
      await clearBlock(newHostname)       // cooldown elapsed; unblock and proceed
    else:
      await redirectTabToBlockPage(tabId, newHostname, newUrl)
      return

  // Re-read state after potential clearBlock
  freshState  = await getState(newHostname)
  freshLimits = getEffectiveLimits(newHostname, config)

  // Check if session is exhausted
  if freshState.sessionUsed >= freshLimits.maxvisit * 60_000:
    await blockSite(newHostname, tabId, newUrl)
    return

  // Allow visit — record start time
  freshState.visitStart = Date.now()
  await saveState(newHostname, freshState)
```

### 5.5 Flushing a Visit

```
async function flushVisit(hostname):
  state = await getState(hostname)
  if state.visitStart is null: return

  elapsed           = Date.now() - state.visitStart
  state.sessionUsed += elapsed
  state.visitStart  = null
  await saveState(hostname, state)
```

`flushVisit` is called both on navigation away and on tab close.

### 5.6 Blocking and Clearing

```
async function blockSite(hostname, tabId, originalUrl):
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: Date.now() })
  await scheduleUnblockAlarm(hostname)
  await redirectTabToBlockPage(tabId, hostname, originalUrl)

async function clearBlock(hostname):
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: null })
  await api.alarms.clear(ALARM_PREFIX + hostname)

async function scheduleUnblockAlarm(hostname):
  config = await getConfig()
  limits = getEffectiveLimits(hostname, config)
  await api.alarms.create(ALARM_PREFIX + hostname, {
    delayInMinutes: limits.minaway
  })
```

### 5.7 Alarm Handler

```js
api.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const hostname = alarm.name.slice(ALARM_PREFIX.length);
  await clearBlock(hostname);
});
```

### 5.8 Override Handler

```
async function handleOverride(hostname):
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: null })
  await api.alarms.clear(ALARM_PREFIX + hostname)
```

### 5.9 Message Handler

The service worker handles all runtime messages from page scripts. Supported `type` values:

| `type` | Payload | Returns |
|---|---|---|
| `getBlockStatus` | `{ domain }` | `{ blockedAt, minaway }` |
| `override` | `{ domain }` | `{ ok: true }` |
| `getConfig` | — | config object |
| `saveConfig` | `{ config }` | `{ ok: true }` |
| `addSite` | `{ domain }` | `{ ok: true }` (no-op if domain already present) |
| `removeSite` | `{ domain }` | `{ ok: true }` — also clears state and cancels alarm |
| `getAllStatus` | — | array of `{ domain, sessionUsed, blockedAt, maxvisit, minaway }` |

### 5.10 Startup: Reconcile State

On service worker startup, open `visitStart` entries may exist from a previous session
(e.g., the browser was force-quit). These must be flushed:

```
async function reconcileStateOnStartup():
  for each domain in getAllStateDomains():
    state = await getState(domain)

    // Flush any open visit
    if state.visitStart is not null:
      await flushVisit(domain)

    // Clear any expired blocks
    if state.blockedAt is not null:
      config = await getConfig()
      limits = getEffectiveLimits(domain, config)
      elapsed = Date.now() - state.blockedAt
      if elapsed >= limits.minaway * 60_000:
        await clearBlock(domain)
```

Called both on `api.runtime.onInstalled` and unconditionally at service worker startup
(top level of `service-worker.js`).

---

## 6. Block Page

URL format:
```
<extension-origin>/pages/blocked.html?domain=reddit.com&returnTo=https%3A%2F%2Freddit.com%2F
```

`blocked.js` responsibilities:
1. Parse `domain` and `returnTo` from `location.search`.
2. Send `{ type: 'getBlockStatus', domain }` to the service worker; receive
   `{ blockedAt, minaway }`.
3. Compute `remainingMs = (minaway * 60_000) - (Date.now() - blockedAt)` **once** at load.
   Display: *"You will be able to use this site again in X minutes."*
   No live countdown.
4. Show an "Override — I really need this" button. First click disables the button and
   starts a 30-second countdown (`OVERRIDE_DELAY = 30`), showing *"Hold on… Ns"*.
   After the countdown: button re-enables with label *"Click again to confirm override"*.
   Second click sends `{ type: 'override', domain }` to the service worker and redirects
   to `returnTo`.
5. Validate `returnTo` before use: accept only `https://` or `http://` schemes; fall back
   to `https://${domain}` otherwise.

---

## 7. Popup

Status view with quick-add:

- Lists all tracked domains with their status:
  - **Blocked** — shows *"Blocked — Xm remaining"* (computed from `blockedAt + minaway - now`).
  - **Active** — shows *"Xm used / Ym allowed"* (based on `sessionUsed` as of last flush).
  - **Idle** — no time accumulated.
- A footer row with a domain text input (pre-filled with the current tab's hostname via
  `api.tabs.query`) and an "Add" button. Sends `{ type: 'addSite', domain }` to the
  service worker on submit. New site appends immediately as Idle without reloading the
  full list. Enter key also triggers add. Domain validated against the same regex as the
  options page.
- A "Settings" button that calls `api.runtime.openOptionsPage()`.

All figures are point-in-time snapshots from the last navigation event — they do not
update live while the popup is open.

---

## 8. Options Page

Two sections:

**Global Defaults**
- `maxvisit` (minutes) — number input, minimum 1.
- `minaway` (minutes) — number input, minimum 1.
- Save on blur with a *"Saved ✓"* confirmation for 2 seconds.

**Site List**
- Table: Domain | Max Visit (min) | Min Away (min) | Remove.
- Per-site override fields are optional; empty means inherit global default.
- "Add site" at the bottom: hostname text input + Add button.
- Domain validated against `/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i` before
  saving; inline error shown on failure.
- Remove button sends `{ type: 'removeSite', domain }` to the service worker (clears state
  and cancels alarm server-side); row removed from UI.

All config mutations go through `{ type: 'saveConfig', config }` or
`{ type: 'removeSite' }` messages to the service worker — no direct storage access from
`options.js`.

No history, statistics, or enable/disable toggle.

---

## 9. CI

`.github/workflows/ci.yml` runs on every push to `master`:

**`lint` job**: checks out, installs (skipped on `node_modules` cache hit keyed on
`package-lock.json`), runs `npm run lint`. Fails the pipeline on any ESLint error or
warning.

**`package` job** (matrix: chrome, firefox): depends on `lint`. Checks out, restores
`node_modules` cache, runs `npm run build:${browser}`, zips the extension, and uploads a
`noprocrast-${browser}` artifact.

Actions used: `checkout@v6`, `setup-node@v6` (Node.js 24, `cache: 'npm'`),
`cache@v5` (keyed on `package-lock.json` hash for `node_modules`), `upload-artifact@v6`.

---

## 10. Code Quality Standards

### 10.1 ESLint Configuration (`.eslintrc.json`)

```json
{
  "env": { "browser": true, "es2022": true, "webextensions": true },
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" },
  "extends": ["eslint:recommended"],
  "rules": {
    "no-var": "error",
    "prefer-const": "error",
    "eqeqeq": ["error", "always"],
    "no-implicit-globals": "error",
    "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "curly": "error",
    "semi": ["error", "always"],
    "quotes": ["error", "single"],
    "indent": ["error", 2],
    "no-trailing-spaces": "error",
    "eol-last": "error"
  }
}
```

`scripts/` is excluded from ESLint (listed in `.eslintignore`) because `build-manifest.js`
uses CommonJS (`require`/`module.exports`), which conflicts with `sourceType: 'module'`.

`package.json`:
```json
{
  "scripts": {
    "lint": "eslint '**/*.js' --ignore-path .eslintignore",
    "build:chrome": "node scripts/build-manifest.js --browser chrome",
    "build:firefox": "node scripts/build-manifest.js --browser firefox"
  },
  "devDependencies": {
    "eslint": "^8.0.0"
  }
}
```

All code must pass `npm run lint` with zero warnings or errors.

### 10.2 Naming Conventions

| Kind | Convention | Example |
|---|---|---|
| Variables and functions | `camelCase` | `sessionUsed`, `flushVisit` |
| Constants | `UPPER_SNAKE_CASE` | `ALARM_PREFIX`, `OVERRIDE_DELAY` |
| Filenames | `kebab-case` | `browser-api.js`, `service-worker.js` |
| Message `type` strings | `camelCase` | `'getBlockStatus'`, `'override'` |
| Storage keys | `camelCase` with `:` separator | `'config'`, `'state:reddit.com'` |
| DOM IDs and classes | `kebab-case` | `id="remaining-display"`, `class="override-btn"` |

### 10.3 Modularity Rules

- Each file in `shared/` exports only pure functions — no side effects, no API calls.
- `service-worker.js` is the only file that registers event listeners and calls `api.*`
  mutation methods.
- `storage.js` is the only file that calls `api.storage.local`.
- Page scripts communicate with the service worker exclusively via `api.runtime.sendMessage`
  — no direct storage access from page scripts.
- No inline `<script>` tags in any HTML file.

### 10.4 Security Practices

- **CSP** (set in `manifest.base.json`):
  `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'`
- **No `innerHTML` or `document.write`** — all DOM work uses `textContent`, `createElement`,
  `appendChild`.
- **`returnTo` validation** — only `https://` and `http://` schemes accepted; all else
  falls back to the domain root.
- **Domain sanitisation** — strict hostname regex before saving to config.
- **No remote code** — no CDN scripts, no external fonts or images.
- **Storage validation** — malformed storage values are discarded and reset to defaults.

---

## 11. Key Design Decisions

| Decision | Rationale |
| --- | --- |
| No content script | Eliminates per-tab background polling; nothing runs on every page |
| Navigation-event timing | Pure event-driven model; service worker only wakes on real user actions |
| `visitStart` persisted to storage | Survives browser restarts; open visits are flushed on next startup |
| `api.alarms` for cooldown expiry | Persists across service worker restarts; correct for long timers |
| Static "X minutes remaining" on block page | Removes the need for any interval or live message-passing from the page |
| Build-script over branch-per-browser | Single `master` branch; `manifest.base.json` + `scripts/build-manifest.js` is simpler than maintaining two long-lived branches. `manifest.json` is not tracked by git and is generated by CI |
| `browser_specific_settings.gecko` always in `manifest.base.json` | Chrome silently ignores unknown manifest keys, so no separate Chrome-specific manifest is needed to omit this field |
| `globalThis.browser ?? globalThis.chrome` in one file | Single point of browser-detection; all other modules are browser-agnostic |
| Page scripts never access storage | Only the service worker mutates state; data flow is fully auditable |
| No `innerHTML` | Eliminates the entire class of DOM injection vulnerabilities |
| `storage.local` not `storage.sync` | Avoids sync quota and write-rate limits |
| `activeTab` instead of `tabs` permission | Narrower permission; sufficient for `tabs.query` on the active tab in the popup |
| `tabUrls` in-memory Map | Tracks each tab's previous URL without an extra storage read on every navigation event |
| 30-second countdown for override | A simple double-click is too easily triggered accidentally; a timed delay forces genuine intentionality |
| Quick add-site in popup | Reduces friction for the most common config action; the options page remains the full settings UI |

---

## 12. Testing Checklist

Run through this checklist in **both Chrome and Firefox** before any release.

- [ ] Visiting a tracked site records `visitStart` in storage
- [ ] Navigating away from a tracked site flushes elapsed time into `sessionUsed`
- [ ] After `maxvisit` total minutes, the next visit redirects to the block page
- [ ] Block page shows the correct domain and a correct static minutes-remaining figure
- [ ] Direct URL navigation to a blocked domain also redirects to the block page
- [ ] Override countdown takes ~30 seconds; second click grants one fresh `maxvisit` window, then re-blocks normally
- [ ] After `minaway` minutes, the site is accessible again automatically
- [ ] Per-site `maxvisit` / `minaway` overrides take precedence over global defaults
- [ ] Adding a site via popup takes effect on the next navigation to that domain
- [ ] Adding a site via options page takes effect on the next navigation to that domain
- [ ] Removing a site clears its state and restores access if it was blocked
- [ ] Browser restart during cooldown: remaining cooldown is honored correctly
- [ ] Browser restart during an active visit: elapsed time is flushed on startup
- [ ] `npm run lint` passes with zero warnings or errors
- [ ] `npm run build:chrome` and `npm run build:firefox` each produce a valid `manifest.json`
