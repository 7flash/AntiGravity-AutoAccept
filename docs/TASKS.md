# AntiGravity AutoAccept — Tasks & Ideas

## 🔴 Priority: Fix
- (none currently)

## 🟡 Priority: Improve
- [x] ~~**Auto-continue message configurable**~~ — ✅ DONE. Verified: `refreshConfig()` detects phrase change → `reinjectAll()` tears down old observer + re-injects with new phrase. 7 hot-reload unit tests added.
- [x] ~~**Auto-continue cooldown configurable**~~ — ✅ DONE. Same hot-reload path. Cooldown clamped to [5s, 120s] at inject time.
- [x] ~~**README update**~~ — ✅ DONE. Reflects v3.8.0: auto-continue section with safeguards, full settings table, keyboard shortcut matching notes, testing section with `npm test` (167 tests).

## 🟢 Priority: Features
- [x] ~~**DOMObserver unit tests**~~ — ✅ DONE. 60 tests covering: output structure, button text config, command filtering, auto-continue, safety guards, edge cases.
- [ ] **Permission engine test coverage** — Add tests for `matchesPattern` word-boundary matching (shell metacharacters as delimiters).
- [ ] **E2E smoke test** — Script that launches Antigravity with debug port, injects DOMObserver, verifies `__AA_OBSERVER_ACTIVE = true`.

## 📝 Architecture Notes
- **Extension**: VS Code extension (`src/extension.js`) → activates on startup
- **CDP**: `src/cdp/ConnectionManager.js` — persistent WebSocket, target discovery, session management
- **DOM Observer**: `src/scripts/DOMObserver.js` — single injectable IIFE with MutationObserver + TreeWalker
- **Dashboard**: `src/cdp/DashboardProvider.js` — webview panel with activity log
- **Tests**: 167 passing (41 ConnectionManager + 60 DOMObserver + 66 Telemetry) — `npm test`
- **Install**: `install.ps1` (Windows) — builds VSIX, extracts, registers with IDE
