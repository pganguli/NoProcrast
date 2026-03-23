# Noprocrast Browser Extension — Spec & Implementation Plan

## Overview

A browser extension that limits time spent on a configurable list of websites, modeled on
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

- The block page includes an "Override" button requiring two clicks to confirm.
- Clicking it resets `sessionUsed` to zero and clears `blockedAt`, granting one fresh
  `maxvisit` window.
- After that window expires, the site blocks again normally.
- No limit on override frequency.

### 1.4 Block Page

When a site is blocked, the tab is redirected to `blocked.html` which shows:

- Which site is blocked.
- A static message: *"You will be able to use this site again in X minutes."*
  (X is computed once at page load from `blockedAt + minaway - now`; it does not count
  down live.)
- An "Override — I really need this" button requiring a second confirmation click.
- On confirmation, the tab redirects back to the original URL.

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

### 3.2 Shared Codebase, Two Manifest Branches

All application source is **identical** across browsers. The only file that differs between
branches is `manifest.json`.

#### Branch Strategy

```
main          <- shared source; never contains browser-specific code
  |
  +-- chrome  <- only manifest.json differs
  +-- firefox <- only manifest.json differs
```

#### Chrome `manifest.json`
```json
{
  "manifest_version": 3,
  "name": "Noprocrast",
  "version": "1.0.0",
  "description": "Limit time on distracting websites.",
  "permissions": ["storage", "tabs", "alarms", "webNavigation"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": { "48": "icons/icon48.png" }
  },
  "options_page": "options/options.html",
  "content_security_policy": {
    "extension_pages": "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'"
  }
}
```

#### Firefox `manifest.json`
Identical to Chrome with one addition:
```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "noprocrast@extension",
      "strict_min_version": "128.0"
    }
  }
}
```

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
├── manifest.json
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
├── .eslintignore
└── package.json
```

There is **no content script**. The extension is entirely driven by `webNavigation` and
`tabs` events in the service worker.

### 4.2 Module Responsibilities

| File | Responsibility |
|---|---|
| `shared/browser-api.js` | Unified `api` export — only reference to `chrome`/`browser` |
| `shared/storage.js` | `getConfig()`, `saveConfig()`, `getState()`, `saveState()`, `clearState()` |
| `shared/domain.js` | `domainMatches(hostname, configDomain)`, `extractHostname(url)` |
| `shared/limits.js` | `getEffectiveLimits(hostname, config)` |
| `background/service-worker.js` | Navigation listeners, visit timing, block/unblock, alarm handling |
| `pages/blocked.js` | Displays remaining minutes, handles override confirm flow |
| `popup/popup.js` | Reads and displays per-domain status |
| `options/options.js` | Reads/writes config, manages site list UI |

---

## 5. Core Logic (Service Worker)

### 5.1 Constants

```js
const ALARM_PREFIX   = 'unblock:';
const DEFAULT_CONFIG = {
  global: { maxvisit: 20, minaway: 180 },
  sites: [],
};
```

### 5.2 Navigation Events

The service worker listens to two `webNavigation` events on top-level frames only
(`frameId === 0`):

**`webNavigation.onCommitted`** — fires when a navigation is committed in a tab.

Used for two purposes:
1. **Close out the previous visit**: if the tab was previously on a tracked domain, compute
   elapsed time and flush it to storage.
2. **Check the new domain**: if the new URL is a tracked domain, check whether it is
   blocked or over its limit; redirect to the block page if so, otherwise record
   `visitStart`.

**`tabs.onRemoved`** — fires when a tab is closed.

Used to flush any open `visitStart` for that tab's domain.

No other events are needed.

### 5.3 Navigation Handler

```
async function handleNavigation(tabId, newUrl, previousUrl):

  // --- Flush previous visit ---
  if previousUrl is set:
    prevHostname = extractHostname(previousUrl)
    if isTracked(prevHostname):
      await flushVisit(prevHostname)

  // --- Check new destination ---
  if isExtensionPage(newUrl): return

  newHostname = extractHostname(newUrl)
  if not isTracked(newHostname): return

  config = await getConfig()
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

  // Check if session is exhausted
  if state.sessionUsed >= limits.maxvisit * 60_000:
    await blockSite(newHostname, tabId, newUrl)
    return

  // Allow visit — record start time
  state.visitStart = Date.now()
  await saveState(newHostname, state)
```

### 5.4 Flushing a Visit

```
async function flushVisit(hostname):
  state = await getState(hostname)
  if state.visitStart is null: return

  elapsed          = Date.now() - state.visitStart
  state.sessionUsed += elapsed
  state.visitStart  = null
  await saveState(hostname, state)
```

`flushVisit` is called both on navigation away and on tab close.

### 5.5 Blocking and Clearing

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

### 5.6 Alarm Handler

```js
api.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const hostname = alarm.name.slice(ALARM_PREFIX.length);
  await clearBlock(hostname);
});
```

### 5.7 Override Handler

```
async function handleOverride(hostname):
  await saveState(hostname, { sessionUsed: 0, visitStart: null, blockedAt: null })
  await api.alarms.clear(ALARM_PREFIX + hostname)
```

### 5.8 Startup: Reconcile State

On service worker startup, open `visitStart` entries may exist from a previous session
(e.g., the browser was force-quit). These must be flushed:

```
async function reconcileStateOnStartup():
  for each domain with stored state:
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
4. Show an "Override — I really need this" button. First click changes the label to
   *"Are you sure? Click again to confirm."* Second click sends
   `{ type: 'override', domain }` to the service worker and redirects to `returnTo`.
5. Validate `returnTo` before use: accept only `https://` or `http://` schemes; fall back
   to `https://${domain}` otherwise.

---

## 7. Popup

Read-only status view:

- Lists all tracked domains with their status:
  - **Blocked** — shows *"Xm remaining"* (computed from `blockedAt + minaway - now`).
  - **Active** — shows *"Xm used / Ym allowed"* (based on `sessionUsed` as of last flush).
  - **Idle** — no time accumulated.
- A "Settings" link that calls `api.runtime.openOptionsPage()`.

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
- Remove button deletes from config and calls `clearState(domain)`.

No history, statistics, or enable/disable toggle.

---

## 9. Code Quality Standards

### 9.1 ESLint Configuration (`.eslintrc.json`)

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

`package.json`:
```json
{
  "scripts": {
    "lint": "eslint '**/*.js' --ignore-path .eslintignore"
  },
  "devDependencies": {
    "eslint": "^8.0.0"
  }
}
```

`.eslintignore`:
```
node_modules/
```

All code must pass `npm run lint` with zero warnings or errors before any phase is
considered complete.

### 9.2 Naming Conventions

| Kind | Convention | Example |
|---|---|---|
| Variables and functions | `camelCase` | `sessionUsed`, `flushVisit` |
| Constants | `UPPER_SNAKE_CASE` | `ALARM_PREFIX`, `DEFAULT_CONFIG` |
| Filenames | `kebab-case` | `browser-api.js`, `service-worker.js` |
| Message `type` strings | `camelCase` | `'getBlockStatus'`, `'override'` |
| Storage keys | `camelCase` with `:` separator | `'config'`, `'state:reddit.com'` |
| DOM IDs and classes | `kebab-case` | `id="remaining-display"`, `class="override-btn"` |

### 9.3 Modularity Rules

- Each file in `shared/` exports only pure functions — no side effects, no API calls.
- `service-worker.js` is the only file that registers event listeners and calls `api.*`
  mutation methods.
- `storage.js` is the only file that calls `api.storage.local`.
- Page scripts communicate with the service worker exclusively via `api.runtime.sendMessage`
  — no direct storage access from page scripts.
- No inline `<script>` tags in any HTML file.

### 9.4 Security Practices

- **CSP** (set in `manifest.json`):
  `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'`
- **No `innerHTML` or `document.write`** — all DOM work uses `textContent`, `createElement`,
  `appendChild`.
- **`returnTo` validation** — only `https://` and `http://` schemes accepted; all else
  falls back to the domain root.
- **Domain sanitisation** — strict hostname regex before saving to config.
- **No remote code** — no CDN scripts, no external fonts or images.
- **Storage validation** — malformed storage values are discarded and reset to defaults.

---

## 10. Implementation Plan

Each phase has a clear "done when" condition. All code must pass `npm run lint` before a
phase is marked complete.

---

### Phase 1 — Scaffold, tooling, and shim

**Goal:** Extension loads in both browsers; lint passes.

Tasks:
1. Create the full directory structure from Section 4.1 with empty placeholder files.
2. Write `manifest.json` for Chrome.
3. Write `shared/browser-api.js` per Section 3.3.
4. Install ESLint; write `.eslintrc.json` and `.eslintignore`.
5. Add minimal `export` stubs to all `shared/` modules.
6. Run `npm run lint` — fix all errors.
7. Load in Chrome (`chrome://extensions`) — no console errors.
8. Load in Firefox (`about:debugging`) with the Firefox manifest — no console errors.

**Done when:** Extension loads in both browsers; `npm run lint` exits clean.

---

### Phase 2 — Shared modules

**Goal:** All pure utility functions implemented, documented, and linted.

Tasks:
1. `shared/domain.js`: `extractHostname(url)` and `domainMatches(hostname, configDomain)`.
2. `shared/limits.js`: `getEffectiveLimits(hostname, config)`.
3. `shared/storage.js`: `getConfig()`, `saveConfig(config)`, `getState(domain)`,
   `saveState(domain, state)`, `clearState(domain)`. `getConfig()` must initialise missing
   fields from `DEFAULT_CONFIG`.
4. JSDoc on every export (param types, return type, one-line description).
5. `npm run lint` clean.

**Done when:** All shared modules export documented, linted functions; `getConfig()` returns
the full default shape against empty storage.

---

### Phase 3 — Navigation event pipeline

**Goal:** Service worker fires on navigation and correctly identifies tracked domains.

Tasks:
1. Register `api.webNavigation.onCommitted` in `service-worker.js` (top-level frames only).
2. Register `api.tabs.onRemoved`.
3. For each event, extract the hostname and log whether it is tracked (using `getConfig()`
   and `domainMatches()`).
4. Confirm logging fires correctly when navigating to and away from a test domain.

**Done when:** Navigation events are received; tracked domains are identified correctly.

---

### Phase 4 — Visit timing

**Goal:** `sessionUsed` accumulates correctly across navigations and tab closes.

Tasks:
1. Implement `flushVisit(hostname)` per Section 5.4.
2. In the navigation handler, call `flushVisit` for the outgoing domain before processing
   the incoming one.
3. Call `flushVisit` on `tabs.onRemoved`.
4. Implement `reconcileStateOnStartup()` per Section 5.8 and call it on
   `api.runtime.onInstalled` and service worker startup.
5. Test: visit a tracked domain, navigate away, inspect storage — `sessionUsed` must have
   increased; `visitStart` must be null.
6. Test: visit a tracked domain, simulate restart (reload the service worker) — `visitStart`
   is flushed on startup.

**Done when:** `sessionUsed` accumulates correctly; open `visitStart` entries are flushed on
startup.

---

### Phase 5 — Block trigger and redirect

**Goal:** Sites block when `sessionUsed` reaches `maxvisit`; redirect fires correctly.

Tasks:
1. Implement the session-exhaustion check in `handleNavigation` per Section 5.3.
2. Implement `blockSite(hostname, tabId, originalUrl)` and
   `scheduleUnblockAlarm(hostname)` per Section 5.5.
3. Implement `redirectTabToBlockPage(tabId, hostname, originalUrl)`.
4. Create `pages/blocked.html` with minimal content (show domain from query string).
5. For testing: set `maxvisit: 0.1` in default config; confirm block fires after ~6 seconds
   of navigation.
6. Remove the test override before marking the phase complete.

**Done when:** Sites redirect to the block page when `sessionUsed >= maxvisit`; direct
URL navigation to a blocked domain also redirects.

---

### Phase 6 — Cooldown and auto-restore

**Goal:** After `minaway` minutes the site unblocks automatically.

Tasks:
1. Implement `clearBlock(hostname)` per Section 5.5.
2. Wire `api.alarms.onAlarm` per Section 5.6.
3. In `reconcileStateOnStartup`, clear expired blocks per Section 5.8.
4. Test: with short timers confirm auto-restore fires; simulate browser restart during
   cooldown and confirm remaining time is honoured.

**Done when:** Blocked sites unblock after `minaway` minutes, including across browser
restarts.

---

### Phase 7 — Block page and override

**Goal:** Block page shows correct remaining time; override grants a fresh window.

Tasks:
1. Complete `pages/blocked.js` per Section 6.
2. Add `getBlockStatus` message handler to `service-worker.js`: returns
   `{ blockedAt, minaway }`.
3. Add `override` message handler: calls `handleOverride(hostname)` per Section 5.7,
   responds `{ ok: true }`.
4. Validate `returnTo` before redirect.
5. Test two-click confirm; confirm override grants one fresh `maxvisit` window then
   re-blocks.

**Done when:** Block page shows correct minutes remaining; override flow works end-to-end.

---

### Phase 8 — Options page

**Goal:** Users can manage global defaults and the site list.

Tasks:
1. Build `options.html` and `options.js` per Section 8.
2. On load, send `{ type: 'getConfig' }` to the service worker and populate fields.
3. Global defaults: save on blur; show *"Saved ✓"* for 2 seconds.
4. Add site: validate hostname regex; show inline error on failure.
5. Remove site: send `{ type: 'removeSite', domain }` to the service worker; it removes
   from config and calls `clearState(domain)`.
6. Per-site overrides: empty input stored as `undefined`, not `0`.
7. All DOM updates via `textContent`/`createElement` — no `innerHTML`.

**Done when:** Options page correctly reads and modifies stored config; lint passes.

---

### Phase 9 — Popup

**Goal:** Toolbar popup shows accurate read-only status.

Tasks:
1. Build `popup.html` and `popup.js` per Section 7.
2. On load, send `{ type: 'getAllStatus' }` to the service worker.
3. Service worker responds with an array of
   `{ domain, sessionUsed, blockedAt, maxvisit, minaway }` for all configured sites.
4. Render status rows per the three states in Section 7.
5. "Settings" link calls `api.runtime.openOptionsPage()`.

**Done when:** Popup shows accurate status; no direct storage access from popup JS.

---

### Phase 10 — Edge cases and cross-browser QA

**Goal:** All edge cases handled; extension verified in both browsers.

Tasks:
1. **Site removed while blocked**: `removeSite` handler clears state and cancels the alarm.
2. **Config changed while blocked**: `getEffectiveLimits` is called at check time, so any
   change to `minaway` is reflected on the next navigation to that domain.
3. **Malformed storage**: validate shape on every read; discard and reset to defaults if
   invalid.
4. **Firefox branch**: create the `firefox` branch, swap in the Firefox manifest, load in
   Firefox, run through the full checklist in Section 11.
5. **Chrome branch**: same on Chrome.
6. `npm run lint` clean on both branches.

**Done when:** All edge cases pass; checklist complete in both browsers.

---

## 11. Key Design Decisions

| Decision | Rationale |
|---|---|
| No content script | Eliminates per-tab background polling; nothing runs on every page |
| Navigation-event timing | Pure event-driven model; service worker only wakes on real user actions |
| `visitStart` persisted to storage | Survives browser restarts; open visits are flushed on next startup |
| `api.alarms` for cooldown expiry | Persists across service worker restarts; correct for long timers |
| Static "X minutes remaining" on block page | Removes the need for any interval or live message-passing from the block page |
| Two manifests, one codebase | Only `manifest.json` differs between browsers; all logic stays in sync |
| `globalThis.browser ?? globalThis.chrome` in one file | Single point of browser-detection; all other modules are browser-agnostic |
| Page scripts never access storage | Only the service worker mutates state; data flow is fully auditable |
| No `innerHTML` | Eliminates the entire class of DOM injection vulnerabilities |
| `storage.local` not `storage.sync` | Avoids sync quota and write-rate limits |

---

## 12. Testing Checklist

Run through this checklist in **both Chrome and Firefox** before any release.

- [ ] Visiting a tracked site records `visitStart` in storage
- [ ] Navigating away from a tracked site flushes elapsed time into `sessionUsed`
- [ ] After `maxvisit` total minutes, the next visit redirects to the block page
- [ ] Block page shows the correct domain and a correct static minutes-remaining figure
- [ ] Direct URL navigation to a blocked domain also redirects to the block page
- [ ] Two-click override grants one fresh `maxvisit` window, then re-blocks normally
- [ ] After `minaway` minutes, the site is accessible again automatically
- [ ] Per-site `maxvisit` / `minaway` overrides take precedence over global defaults
- [ ] Adding a site in options takes effect on the next navigation to that domain
- [ ] Removing a site clears its state and restores access if it was blocked
- [ ] Browser restart during cooldown: remaining cooldown is honoured correctly
- [ ] Browser restart during an active visit: elapsed time is flushed on startup
- [ ] `npm run lint` passes with zero warnings or errors on both branches
