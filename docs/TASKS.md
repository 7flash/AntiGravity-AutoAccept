# AntiGravity AutoAccept — Tasks & Ideas

## 🔴 Priority: Fix
- (none currently)

## 🟡 Priority: Improve
- [x] ~~**Auto-continue message configurable**~~ — ✅ DONE. Hot-reload via `refreshConfig()`. 7 unit tests.
- [x] ~~**Auto-continue cooldown configurable**~~ — ✅ DONE. Clamped [5s, 120s].
- [x] ~~**README update**~~ — ✅ DONE. Reflects v3.8.0+.

## 🟢 Priority: Features
- [x] ~~**DOMObserver unit tests**~~ — ✅ DONE. 60 tests.
- [x] ~~**Permission engine test coverage**~~ — ✅ DONE. 87 tests covering matchesPattern word-boundary matching: multi-word patterns, substring false positives (alarm, firmware, storm, normal, worm, reformatted), case insensitivity, allowlist word boundaries, pattern position (start/middle/end), piped/chained commands, and edge cases.
- [ ] **E2E smoke test** — Script that launches Antigravity with debug port, injects DOMObserver, verifies `__AA_OBSERVER_ACTIVE = true`.

## 📝 Architecture Notes
- **Extension**: VS Code extension (`src/extension.js`) → activates on startup
- **CDP**: `src/cdp/ConnectionManager.js` — persistent WebSocket, target discovery, session management
- **DOM Observer**: `src/scripts/DOMObserver.js` — single injectable IIFE with MutationObserver + TreeWalker
- **Dashboard**: `src/cdp/DashboardProvider.js` — webview panel with activity log
- **Tests**: 254 passing (60 DOMObserver + 41 ConnectionManager + 66 Telemetry + 87 Permission Engine) — `npm test`
- **Install**: `install.ps1` (Windows) — builds VSIX, extracts, registers with IDE
