# AntiGravity AutoAccept — Tasks & Ideas

## 🔴 Priority: Fix
- (none currently)

## 🟡 Priority: Improve
- [x] ~~**Status bar indicator**~~ — ✅ DONE. Added VS Code status bar item showing "Auto: ON (Nx)" with the count of accepted changes. Updates live via telemetry callback.
- [x] ~~**MutationObserver throttling**~~ — ✅ DONE. Throttle DOM observer callback if DOM changes exceed 50/sec to prevent IDE lag during massive diffs.
- [x] ~~**Auto-continue message configurable**~~ — ✅ DONE. Hot-reload via `refreshConfig()`. 7 unit tests.
- [x] ~~**Auto-continue cooldown configurable**~~ — ✅ DONE. Clamped [5s, 120s].
- [x] ~~**README update**~~ — ✅ DONE. Reflects v3.8.0+.

## 🟢 Priority: Features
- [x] ~~**Configurable IDE target selectors**~~ — ✅ DONE. `customTargetSelectors` property added to config. Injects via CDP, parsed dynamically at priority -1 during `findButton` to shortcut tree walker. Adapts to UI changes without recoding.
- [ ] **Custom CSS Injector** — Allow users to inject a custom CSS string into the webview/IDE panel to style or hide elements.
- [x] ~~**Blocklist Regex Support**~~ — ✅ DONE. Added Regex support to `matchesPattern` (e.g., `/DROP.*/i`). Uses `.test(cmd)`. 6 new tests added to permission-engine.test.js.
- [x] ~~**DOMObserver unit tests**~~ — ✅ DONE. 60 tests.
- [x] ~~**Permission engine test coverage**~~ — ✅ DONE. 93 tests covering matchesPattern word-boundary matching and new regex support.
- [x] ~~**E2E smoke test**~~ — ✅ DONE. CDP-based test that attaches to running Antigravity (or launches isolated instance), injects DOMObserver via `buildDOMObserverScript()`, verifies observer state (active, not paused, cleanup, idempotent re-injection). 13 tests. Supports `--attach <port>` mode.
- [ ] **Config validation for regex patterns** — Validate that any `/pattern/` strings in config are valid regular expressions before sending them to the observer.

## 📝 Architecture Notes
- **Extension**: VS Code extension (`src/extension.js`) → activates on startup
- **CDP**: `src/cdp/ConnectionManager.js` — persistent WebSocket, target discovery, session management
- **DOM Observer**: `src/scripts/DOMObserver.js` — single injectable IIFE with MutationObserver + TreeWalker
- **Dashboard**: `src/cdp/DashboardProvider.js` — webview panel with activity log
- **Tests**: 260 passing (60 DOMObserver + 41 ConnectionManager + 66 Telemetry + 93 Permission Engine) + 13 E2E — `npm test` / `node test/e2e-smoke.test.js --attach 9333`
- **Install**: `install.ps1` (Windows) — builds VSIX, extracts, registers with IDE
