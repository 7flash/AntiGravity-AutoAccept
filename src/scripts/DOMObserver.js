// AntiGravity AutoAccept — DOM Observer Payload (v3.5.7)
// Generates a self-contained script injected ONCE per CDP session.
// Uses MutationObserver for zero-polling, event-driven button clicking.
// All cooldown state is localized to DOM data-attributes — no Node.js globals.

/**
 * Generates the MutationObserver-based DOM clicker script.
 * @param {string[]} customTexts - Additional button texts from user config
 * @param {string[]} blockedCommands - Command patterns to never auto-run
 * @param {string[]} allowedCommands - If non-empty, only auto-run matching patterns
 * @param {boolean} [autoAcceptFileEdits=true] - Whether to auto-accept file edit buttons
 * @param {string} [autoContinuePhrase='whats next'] - Phrase to type for auto-continue
 * @param {number} [autoContinueCooldown=30] - Seconds between auto-continue prompts
 * @returns {string} JavaScript source to evaluate via CDP Runtime.evaluate
 */
function buildDOMObserverScript(customTexts, blockedCommands, allowedCommands, autoAcceptFileEdits, autoContinuePhrase, autoContinueCooldown, autoContinueMatch, customTargetSelectors) {
    blockedCommands = blockedCommands || [];
    allowedCommands = allowedCommands || [];
    if (autoAcceptFileEdits === undefined) autoAcceptFileEdits = true;
    if (autoContinuePhrase === undefined) autoContinuePhrase = 'whats next';
    if (autoContinueCooldown === undefined) autoContinueCooldown = 30;
    autoContinueCooldown = Math.max(5, Math.min(120, autoContinueCooldown));

    const allTexts = [
        'run',  // Primary action button
        ...(autoAcceptFileEdits ? ['accept'] : []),  // Only include 'accept' when file edits are enabled
        'always allow', 'allow this conversation', 'allow',
        'retry', 'continue',
        ...customTexts
    ];
    const expandTexts = ['requires input'];

    return `
(function() {
    // ═══ IDEMPOTENCY GUARD ═══
    // Prevents double-injection if the script is evaluated again on the same context.
    if (window.__AA_OBSERVER_ACTIVE) return 'already-active';
    window.__AA_OBSERVER_ACTIVE = true;

    // ═══ WEBVIEW GUARD (deferred) ═══
    // Moved inside scanAndClick() to avoid race condition:
    // On Target.targetCreated / executionContextsCleared, the DOM may be
    // unhydrated (empty). Checking synchronously here would falsely reject
    // valid agent panels. Instead, we install the observer unconditionally
    // and check the DOM structure dynamically on each scan.
    function isAgentPanel() {
        return !!(document.querySelector('.react-app-container') ||
            document.querySelector('[class*="agent"]') ||
            document.querySelector('[data-vscode-context]'));
    }

    var BUTTON_TEXTS = ${JSON.stringify(allTexts)};
    var EXPAND_TEXTS = ${JSON.stringify(expandTexts)};
    var BLOCKED_COMMANDS = ${JSON.stringify(blockedCommands)};
    var ALLOWED_COMMANDS = ${JSON.stringify(allowedCommands)};
    var HAS_FILTERS = BLOCKED_COMMANDS.length > 0 || ALLOWED_COMMANDS.length > 0;
    var AUTO_CONTINUE_PHRASE = ${JSON.stringify(autoContinuePhrase)};
    var AUTO_CONTINUE_COOLDOWN_MS = ${autoContinueCooldown * 1000};
    var AUTO_CONTINUE_MATCH = ${JSON.stringify(autoContinueMatch || [])};
    var CUSTOM_TARGET_SELECTORS = ${JSON.stringify(customTargetSelectors || [])};

    // ═══ IDEMPOTENT TEARDOWN ═══
    // Clean up any previous state (observer, intervals) to prevent leaks on re-injection.
    if (typeof window.__AA_CLEANUP === 'function') {
        window.__AA_CLEANUP();
    }
    window.__AA_CLEANUP = function() {
        if (window.__AA_OBSERVER) { window.__AA_OBSERVER.disconnect(); window.__AA_OBSERVER = null; }
        if (window.__AA_FALLBACK_INTERVAL) { clearInterval(window.__AA_FALLBACK_INTERVAL); window.__AA_FALLBACK_INTERVAL = null; }
    };

    // ═══ WATCHDOG TIMESTAMP ═══
    // Updated on every scan — heartbeat checks this to detect silently dead observers.
    window.__AA_LAST_SCAN = Date.now();

    // ═══ CLICK COUNTER ═══
    // Preserved across re-injections. Heartbeat harvests this for analytics.
    window.__AA_CLICK_COUNT = window.__AA_CLICK_COUNT || 0;

    // Expose filter state as window globals for hot-reload via Runtime.evaluate.
    // pushFilterUpdate() in ConnectionManager overwrites these without re-injecting
    // the full script (which would create duplicate MutationObservers).
    window.__AA_BLOCKED = BLOCKED_COMMANDS;
    window.__AA_ALLOWED = ALLOWED_COMMANDS;
    window.__AA_HAS_FILTERS = HAS_FILTERS;
    window.__AA_PAUSED = false; // Kill switch: set to true to stop all clicking

    // ═══ DEBUG LOGGING ═══
    // All logs prefixed with [AA] for easy filtering in DevTools.
    var DEBUG = true;
    function _log() {
        if (!DEBUG) return;
        var args = ['[AA]'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    var COOLDOWN_MS = 5000;
    var EXPAND_COOLDOWN_MS = 30000; // 30s cooldown for expand buttons (DOM-path-keyed, so new positions fire instantly)
    var clickCooldowns = {};

    // Lightweight DOM path: walks up to 3 ancestors to create a structurally unique key.
    // Differentiates multiple "Accept" buttons in different DOM subtrees.
    function _domPath(el) {
        // Iterates 4 levels starting from el itself (not just ancestors).
        // Includes sibling index (nth-child equivalent) at every level,
        // ensuring unique paths even for direct sibling buttons.
        var parts = [];
        var curr = el;
        for (var i = 0; i < 4 && curr && curr !== document.body; i++) {
            var idx = 0;
            var child = curr.parentElement ? curr.parentElement.firstElementChild : null;
            while (child) {
                if (child === curr) break;
                idx++;
                child = child.nextElementSibling;
            }
            parts.unshift((curr.tagName || '') + '[' + idx + ']');
            curr = curr.parentElement;
        }
        return parts.join('/');
    }

    function closestClickable(node) {
        var el = node;
        while (el && el !== document.body) {
            var tag = (el.tagName || '').toLowerCase();
            if (tag === 'button' || tag === 'a' || tag.includes('button') || tag.includes('btn') ||
                el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link' ||
                el.classList.contains('cursor-pointer') ||
                el.onclick || el.getAttribute('tabindex') === '0') {
                return el;
            }
            el = el.parentElement;
        }
        return node;
    }

    // ═══ WORD BOUNDARY CHECK (module scope — avoids per-iteration allocation) ═══
    // Prevents filename false-positives: "accept-test.js" should NOT match "accept".
    var _wordBoundaryRegex = /[a-z0-9_\\-\\.]/i;
    function isWordBoundary(str, keyLen) {
        if (str.length === keyLen) return true;
        return !_wordBoundaryRegex.test(str.charAt(keyLen));
    }

    // ═══ SINGLE-PASS BUTTON SCANNER ═══
    // Walks the DOM tree exactly ONCE and checks every node against ALL keywords.
    // Returns { node: clickableElement, matchedText: keyword, priority: index } or null.
    // Tracks the BEST match by keyword priority (lowest index = highest priority).
    // O(D) complexity instead of O(N×D) — fixes Issue #19 performance freezes.
    function findButton(root, texts) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        var wNode;
        var best = null; // { node, matchedText, priority }
        while ((wNode = walker.nextNode())) {
            if (wNode.shadowRoot) {
                var result = findButton(wNode.shadowRoot, texts);
                if (result && (best === null || result.priority < best.priority)) {
                    best = result;
                    if (best.priority === 0) return best; // Can't do better
                }
            }
            // data-testid / data-action shortcut for allow buttons
            var testId = (wNode.getAttribute('data-testid') || wNode.getAttribute('data-action') || '').toLowerCase();
            if (testId.includes('alwaysallow') || testId.includes('always-allow') || testId.includes('allow')) {
                var tag1 = (wNode.tagName || '').toLowerCase();
                if (tag1 === 'button' || tag1.includes('button') || wNode.getAttribute('role') === 'button' || tag1.includes('btn')) {
                    // Find priority of 'allow' in texts array
                    var allowIdx = texts.indexOf('allow');
                    if (allowIdx === -1) allowIdx = texts.length;
                    if (best === null || allowIdx < best.priority) {
                        best = { node: wNode, matchedText: 'allow', priority: allowIdx };
                        if (best.priority === 0) return best;
                    }
                    continue;
                }
            }
            var nodeText = (wNode.textContent || '').trim().toLowerCase();
            if (nodeText.length > 50) {
                // Bug 7 fix: log when a potential match is dropped due to length
                for (var lt = 0; lt < texts.length; lt++) {
                    if (nodeText.indexOf(texts[lt]) !== -1) {
                        if (!window.__AA_DIAG) window.__AA_DIAG = [];
                        window.__AA_DIAG.push({ action: 'SKIP_LONG_TEXT', matched: texts[lt], len: nodeText.length, preview: nodeText.substring(0, 60) });
                        break;
                    }
                }
                continue;
            }

            // Check this node against custom selectors (highest priority t=-1) and ALL keywords
            var matchedSelector = null;
            if (CUSTOM_TARGET_SELECTORS.length > 0 && wNode.matches) {
                for (var s = 0; s < CUSTOM_TARGET_SELECTORS.length; s++) {
                    if (wNode.matches(CUSTOM_TARGET_SELECTORS[s])) {
                        matchedSelector = 'selector:' + CUSTOM_TARGET_SELECTORS[s];
                        break;
                    }
                }
            }

            for (var t = -1; t < texts.length; t++) {
                // Skip keywords lower priority than current best (Math.max handles -1 mapping properly)
                if (best !== null && Math.max(0, t) >= best.priority) break;
                
                var text, isExpandKeyword, isMatch;
                if (t === -1) {
                    if (!matchedSelector) continue;
                    text = matchedSelector;
                    isExpandKeyword = false;
                    isMatch = true;
                } else {
                    text = texts[t];
                    // Expand keywords: exact match ONLY to prevent toggle loops
                    // ('Expand all' → click → 'Collapse all' → mutation → 'Expand all' → click → ∞)
                    isExpandKeyword = (text === 'expand' || text === 'requires input');
                    if (isExpandKeyword) {
                        isMatch = nodeText === text;
                    } else if (text.length > 2 && text.charAt(0) === '/' && text.charAt(text.length - 1) === '/') {
                        try {
                            var regex = new RegExp(text.substring(1, text.length - 1), 'i');
                            isMatch = regex.test(nodeText);
                        } catch (e) {
                            isMatch = false;
                        }
                    } else {
                        isMatch = nodeText === text ||
                            (text.length >= 5 && nodeText.startsWith(text) && isWordBoundary(nodeText, text.length) && nodeText.length <= text.length * 3) ||
                            (nodeText.startsWith(text + ' ') && nodeText.length <= text.length * 5) ||
                            // Keyboard shortcut suffix: Antigravity renders "AcceptAlt+⏎" with no space.
                            // The word boundary check fails because 'a' (from 'alt') is a word char.
                            (text.length >= 5 && nodeText.startsWith(text) && nodeText.length <= text.length * 5 &&
                                /^(alt|ctrl|shift|cmd|meta|⌘|⌥|⇧|⌃)/.test(nodeText.substring(text.length)));
                    }
                }
                if (!isMatch) continue;

                var clickable = closestClickable(wNode);
                var tag2 = (clickable.tagName || '').toLowerCase();
                var isExpandType = (text === 'expand' && nodeText === 'expand') || text === 'requires input';
                if (tag2 === 'button' || tag2 === 'a' || tag2.includes('button') || tag2.includes('btn') ||
                    clickable.getAttribute('role') === 'button' || clickable.getAttribute('role') === 'link' ||
                    clickable.classList.contains('cursor-pointer') ||
                    clickable.onclick || clickable.getAttribute('tabindex') === '0') {

                    // ═══ EXPAND/COLLAPSE GUARD ═══
                    // Skip if closestClickable resolved to an expand/collapse toggle.
                    // This happens when keyword text (e.g. "run") appears inside a collapsed
                    // section — the walker matches the text but walks up to the toggle button.
                    var btnText = (clickable.textContent || '').trim().toLowerCase();
                    var ariaExpanded = clickable.getAttribute('aria-expanded');
                    var isExpandToggle = /^(expand|collapse|show more|show less|show all|hide|toggle)/i.test(btnText) ||
                        btnText === 'expand' || btnText === 'collapse' ||
                        (ariaExpanded !== null && clickable !== wNode) ||
                        clickable.classList.contains('expand') || clickable.classList.contains('collapse') ||
                        clickable.classList.contains('toggle') ||
                        (clickable.getAttribute('data-action') || '').toLowerCase().includes('expand') ||
                        (clickable.getAttribute('data-action') || '').toLowerCase().includes('collapse');
                    if (isExpandToggle && !isExpandType) {
                        if (!window.__AA_DIAG) window.__AA_DIAG = [];
                        window.__AA_DIAG.push({ action: 'SKIP_EXPAND_TOGGLE', matched: text, btnText: btnText.substring(0, 40) });
                        continue;
                    }

                    // Idempotency guard: skip disabled/loading buttons
                    if (clickable.disabled || clickable.getAttribute('aria-disabled') === 'true' ||
                        clickable.classList.contains('loading') || clickable.querySelector('.codicon-loading') ||
                        clickable.getAttribute('data-aa-blocked')) {
                        if (!window.__AA_DIAG) window.__AA_DIAG = [];
                        window.__AA_DIAG.push({ action: 'SKIP_DISABLED', matched: text, text: nodeText.substring(0, 40), tag: tag2 });
                        continue;
                    }

                    // Cooldown guard: DOM-path + text key, with longer cooldown for expand buttons
                    // Bug 6 fix: use unified key format (include ':expand:' for expand types)
                    var btnKey = isExpandType
                        ? _domPath(clickable) + ':expand:' + (clickable.textContent || '').trim().toLowerCase().substring(0, 30)
                        : _domPath(clickable) + ':' + (clickable.textContent || '').trim().toLowerCase().substring(0, 30);
                    var cooldown = isExpandType ? EXPAND_COOLDOWN_MS : COOLDOWN_MS;
                    var lastClick = clickCooldowns[btnKey] || 0;
                    if (lastClick && (Date.now() - lastClick < cooldown)) {
                        if (!window.__AA_DIAG) window.__AA_DIAG = [];
                        window.__AA_DIAG.push({ action: 'SKIP_COOLDOWN', matched: text, remaining: Math.round((cooldown - (Date.now() - lastClick)) / 1000) + 's' });
                        continue;
                    }
                    best = { node: clickable, matchedText: text, priority: t };
                    if (t === -1 || t === 0) return best; // Priority -1 or 0 — can't do better
                    break; // Found match for this node, move to next node
                }
            }
        }
        return best;
    }

    // ═══ COOLDOWN PRUNING ═══
    var lastPrune = Date.now();
    var PRUNE_INTERVAL_MS = 30000;

    function pruneCooldowns() {
        var now = Date.now();
        if (now - lastPrune < PRUNE_INTERVAL_MS) return;
        lastPrune = now;
        var maxAge = EXPAND_COOLDOWN_MS * 2;
        var keys = Object.keys(clickCooldowns);
        for (var i = 0; i < keys.length; i++) {
            if (now - clickCooldowns[keys[i]] > maxAge) {
                delete clickCooldowns[keys[i]];
            }
        }
        // Note: expandedOnce is never pruned — expand buttons stay suppressed for the session
    }

    // ═══ COMMAND FILTERING ═══
    var TERMINAL_BUTTON_TEXTS = ['run'];

    /**
     * Walks up the DOM from a button to find the nearest command preview.
     * Uses querySelectorAll to collect ALL <pre> and <code> texts at each
     * parent level — querySelector only returns the first match, which in
     * Antigravity's UI is often an inline <code> with the terminal path,
     * not the actual command.
     */
    function extractCommandText(btn) {
        try {
            var el = btn;
            for (var i = 0; i < 8 && el && el !== document.body; i++) {
                el = el.parentElement;
                if (!el) break;
                var codes = el.querySelectorAll('pre, code');
                if (codes.length > 0) {
                    var allText = '';
                    for (var j = 0; j < codes.length; j++) {
                        allText += ' ' + (codes[j].textContent || '').trim();
                    }
                    allText = allText.trim();
                    if (allText.length > 0) return allText;
                }
            }
        } catch (e) { /* fail closed — return null */ }
        return null;
    }

    /**
     * Checks if a command should be auto-clicked based on blocklist/allowlist.
     * Evaluation order (per DeepThink directive):
     *   1. If command matches ANY blocklist pattern → BLOCK
     *   2. If allowlist is configured AND command matches NO allowlist pattern → BLOCK
     *   3. Otherwise → ALLOW
     * When command text cannot be extracted and filters are active → fail closed (BLOCK)
     * @returns {boolean} true if safe to click
     */
    function isCommandAllowed(commandText) {
        // Read from window globals (hot-reloadable via pushFilterUpdate)
        var blockedList = window.__AA_BLOCKED || BLOCKED_COMMANDS;
        var allowedList = window.__AA_ALLOWED || ALLOWED_COMMANDS;
        var hasFilters = window.__AA_HAS_FILTERS !== undefined ? window.__AA_HAS_FILTERS : HAS_FILTERS;
        if (!hasFilters) return true;
        if (!commandText) return false; // Fail closed: can't inspect → don't click

        var cmdLower = commandText.toLowerCase();

        // Word-boundary match: checks if pattern appears as a standalone token
        // sequence in the command. Uses shell metacharacters as boundaries to prevent
        // 'rm' from matching 'format' or 'npm run build-arm'.
        function matchesPattern(cmd, pattern) {
            if (pattern.length > 2 && pattern.charAt(0) === '/') {
                var lastSlash = pattern.lastIndexOf('/');
                if (lastSlash > 0) {
                    try {
                        var body = pattern.substring(1, lastSlash);
                        var flags = pattern.substring(lastSlash + 1);
                        var regex = new RegExp(body, flags);
                        return regex.test(cmd);
                    } catch (e) {
                        // Fallback to literal match if invalid regex
                    }
                }
            }

            var patLower = pattern.toLowerCase();
            var cmdLower = cmd.toLowerCase();
            // Multi-word patterns (e.g. 'rm -rf', 'git push --force'):
            // check if the exact multi-word sequence appears with boundaries
            var idx = cmdLower.indexOf(patLower);
            while (idx !== -1) {
                var before = idx === 0 ? ' ' : cmdLower.charAt(idx - 1);
                var after = idx + patLower.length >= cmdLower.length ? ' ' : cmdLower.charAt(idx + patLower.length);
                // Full shell metacharacter set: whitespace, pipes, semicolons,
                // ampersands, slashes, subshells, quotes, backticks, variables,
                // redirections, commas, backslashes, colons
                var delimiters = ${JSON.stringify(' \t\r\n|;&/()[]{}\"\'`$=<>,\\:')};
        if ((idx === 0 || delimiters.indexOf(before) !== -1) &&
                    (idx + patLower.length >= cmdLower.length || delimiters.indexOf(after) !== -1)) {
                    return true;
                }
        idx = cmdLower.indexOf(patLower, idx + 1);
            }
        return false;
        }

        // 1. Blocklist: any pattern match at word boundary → block
        for (var b = 0; b < blockedList.length; b++) {
            if (matchesPattern(cmdLower, blockedList[b])) {
                return false;
            }
        }

        // 2. Allowlist: if configured and no match → block
        if (allowedList.length > 0) {
            var allowed = false;
        for (var a = 0; a < allowedList.length; a++) {
                if (matchesPattern(cmdLower, allowedList[a])) {
            allowed = true;
        break;
                }
            }
        if (!allowed) return false;
        }

        return true;
    }

        function scanAndClick() {
            window.__AA_LAST_SCAN = Date.now(); // Watchdog: prove we're alive
            if (window.__AA_PAUSED) return null;
            pruneCooldowns();

            if (!isAgentPanel()) return null;

            // Single-pass: combine all keywords and walk the DOM exactly once
            var allTexts = BUTTON_TEXTS.concat(EXPAND_TEXTS);

            // Diagnostic: record filter state for heartbeat readout
            var currentHasFilters = window.__AA_HAS_FILTERS !== undefined ? window.__AA_HAS_FILTERS : HAS_FILTERS;
            var currentBlocked = window.__AA_BLOCKED || BLOCKED_COMMANDS;

            // Loop: when a button is blocked by filters, re-scan to find the next one.
            var MAX_SCANS = 5;
            for (var scan = 0; scan < MAX_SCANS; scan++) {
                var match = findButton(document.body, allTexts);
                if (!match) {
                    // ═══ Auto-continue: type phrase and press send ═══
                    // Simple logic: send button exists (= AI idle) + input empty → type and send
                    if (!AUTO_CONTINUE_PHRASE) return null;

                    // Cooldown: don't spam auto-continue
                    var now = Date.now();
                    if (window.__AA_LAST_CONTINUE && (now - window.__AA_LAST_CONTINUE < AUTO_CONTINUE_COOLDOWN_MS)) return null;

                    // 1. Find the SEND button — its presence means AI is idle
                    //    During generation, only the stop button is visible (send is hidden/absent)
                    var sendBtn = document.querySelector('button[data-tooltip-id="input-send-button-send-tooltip"]');
                    if (!sendBtn) {
                        // Fallback: look for any send-like button
                        var cands = document.querySelectorAll('button[aria-label*="send" i], button[aria-label*="Send" i]');
                        for (var si = 0; si < cands.length; si++) {
                            if (!cands[si].disabled) { sendBtn = cands[si]; break; }
                        }
                    }
                    if (!sendBtn) return null; // AI is still generating or no send button

                    // 2. Find the input textbox — must be EMPTY (don't overwrite user drafts)
                    var input = document.querySelector('div[contenteditable="true"][role="textbox"]');
                    if (!input || (input.textContent || '').trim()) return null;

                    // 3. Anti-loop: Circuit Breaker
                    //    First short response (<200 chars) is allowed (might be a valid short answer).
                    //    Second consecutive short response trips the breaker and stops auto-continue.
                    //    If AUTO_CONTINUE_MATCH is configued, strictly require last response to end with matching sequence.
                    var assistantMsgs = document.querySelectorAll('[data-role="assistant"]');
                    if (assistantMsgs.length > 0) {
                        var lastAssistant = assistantMsgs[assistantMsgs.length - 1];
                        var responseText = lastAssistant.textContent || '';
                        var responseLen = responseText.trim().length;

                        if (AUTO_CONTINUE_MATCH && AUTO_CONTINUE_MATCH.length > 0) {
                            var matchedSeq = false;
                            for (var mi = 0; mi < AUTO_CONTINUE_MATCH.length; mi++) {
                                // Match at end of text, ignoring trailing whitespace.
                                if (responseText.trim().endsWith(AUTO_CONTINUE_MATCH[mi])) {
                                    matchedSeq = true; break;
                                }
                            }
                            // Strict requirement: if configured, we ONLY auto-continue on exact sequence match.
                            if (!matchedSeq) return null;
                        }

                        if (window.__AA_LAST_ASSISTANT_TEXT !== responseText) {
                            window.__AA_LAST_ASSISTANT_TEXT = responseText;
                            if (responseLen < 200) {
                                window.__AA_SHORT_RESPONSES = (window.__AA_SHORT_RESPONSES || 0) + 1;
                            } else {
                                window.__AA_SHORT_RESPONSES = 0;
                            }
                            window.__AA_CB_LOGGED = false; // Reset log flag for new message
                        }

                        if (window.__AA_SHORT_RESPONSES >= 2) {
                            if (!window.__AA_CB_LOGGED) {
                                if (!window.__AA_DIAG) window.__AA_DIAG = [];
                                window.__AA_DIAG.push({ action: 'SKIP_SHORT_RESPONSE', matched: 'auto-continue', len: responseLen });
                                _log('auto-continue: circuit breaker tripped — 2+ consecutive short AI responses.');
                                window.__AA_CB_LOGGED = true;
                            }
                            return null;
                        }
                    }

                    // 4. Type the phrase and click send
                    window.__AA_LAST_CONTINUE = now;
                    input.focus();
                    document.execCommand('selectAll', false);
                    document.execCommand('insertText', false, AUTO_CONTINUE_PHRASE);
                    // Dispatch synthetic events to force React/Vue state updates immediately
                    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

                    if (!window.__AA_DIAG) window.__AA_DIAG = [];
                    window.__AA_DIAG.push({ action: 'AUTO_CONTINUE', matched: 'auto-continue', text: AUTO_CONTINUE_PHRASE });
                    _log('auto-continue: typed "' + AUTO_CONTINUE_PHRASE + '"');

                    // Poll for React to process the input and enable the send button
                    var attempts = 0;
                    var clickTimer = setInterval(function() {
                        attempts++;
                        var btn = document.querySelector('button[data-tooltip-id="input-send-button-send-tooltip"]');
                        if (!btn) {
                            var c2 = document.querySelectorAll('button[aria-label*="send" i]');
                            for (var j = 0; j < c2.length; j++) {
                                if (!c2[j].disabled) { btn = c2[j]; break; }
                            }
                        }
                        if (btn && !btn.disabled) {
                            clearInterval(clickTimer);
                            btn.click();
                            _log('auto-continue: clicked send on attempt ' + attempts);
                        } else if (attempts >= 10) {
                            clearInterval(clickTimer);
                            _log('auto-continue: send not clickable after 10 attempts');
                        }
                    }, 100);

                    return 'auto-continue';
                }

                var btn = match.node;
                var matchedText = match.matchedText;

            var isExpandBtn = (matchedText === 'expand' || matchedText === 'requires input');
            var isTerminalBtn = TERMINAL_BUTTON_TEXTS.indexOf(matchedText) !== -1;
            
            if (currentHasFilters && !isExpandBtn) {
                var cmdText = extractCommandText(btn);
                
                // If it's a terminal button (like 'Run') but we couldn't find the code block,
                // fail closed to prevent executing hidden malicious commands.
                // If it's a non-terminal button (like 'Accept'/'Allow'), we allow it without a code block.
                var shouldBlock = false;
                if (isTerminalBtn) {
                    if (cmdText === null) {
                        shouldBlock = true; // Fail closed
                    } else {
                        shouldBlock = !isCommandAllowed(cmdText);
                    }
                }

                if (shouldBlock) {
                    // Stamp the DOM element itself — shared across all JS contexts.
                    // JS-variable cooldowns are isolated per CDP session scope,
                    // but data attributes live on the DOM and are visible to all observers.
                    btn.setAttribute('data-aa-blocked', 'true');
                    // Visual block indicator — immediate UX feedback
                    if (btn.style) btn.style.cssText += ';background:#4a1c1c !important;opacity:0.6;cursor:not-allowed;';
                    btn.textContent = '🚫 Blocked by Filter';
                    var blockKey = _domPath(btn) + ':' + (btn.textContent || '').trim().toLowerCase().substring(0, 30);
                    clickCooldowns[blockKey] = Date.now() + (15000 - COOLDOWN_MS);
                    if (!window.__AA_DIAG) window.__AA_DIAG = [];
                    window.__AA_DIAG.push({ action: 'BLOCKED', time: Date.now(), matched: matchedText, cmd: (cmdText || '').substring(0, 60) });
                    continue; // Re-scan to find next button
                }
            }

                // Diagnostic: record click with DOM context for debugging
                var parentChain = '';
                var nearbyText = '';
                try {
                    var p = btn;
                    for (var pi = 0; pi < 5 && p; pi++) {
                        p = p.parentElement;
                        if (p) parentChain += (p.tagName || '?') + (p.className ? '.' + (p.className + '').substring(0, 30) : '') + ' > ';
                    }
                    // Look for any text in nearby siblings or parent's textContent
                    var parentEl = btn.parentElement;
                    if (parentEl && parentEl.parentElement) nearbyText = (parentEl.parentElement.textContent || '').trim().substring(0, 100);
                } catch(e) {}
                if (!window.__AA_DIAG) window.__AA_DIAG = [];
                var diagCmdText = extractCommandText(btn);
                window.__AA_DIAG.push({ action: 'CLICKED', time: Date.now(), matched: matchedText, cmd: diagCmdText ? diagCmdText.substring(0, 80) : 'NULL', url: (window.location && window.location.href ? window.location.href : '').substring(0, 60), near: nearbyText.substring(0, 60) });

                // ═══ RETRY CIRCUIT BREAKER ═══
                // Prevents infinite loops when the model hits context limits or network
                // errors. "Retry" and "Continue" buttons are auto-clicked up to 3 times
                // per 60-second window. After that, the extension stops and hands control
                // back to the user. The counter resets when a successful non-recovery
                // click occurs (run/accept = error resolved).
                var isRecovery = matchedText === 'retry' || matchedText === 'continue';
                if (isRecovery) {
                    window.__AA_RECOVERY_TS = window.__AA_RECOVERY_TS || [];
                    var now = Date.now();
                    // Keep only timestamps from the last 60 seconds
                    window.__AA_RECOVERY_TS = window.__AA_RECOVERY_TS.filter(function(ts) {
                        return now - ts < 60000;
                    });
                    if (window.__AA_RECOVERY_TS.length >= 3) {
                        if (!window.__AA_DIAG) window.__AA_DIAG = [];
                        window.__AA_DIAG.push({ action: 'CIRCUIT_BREAKER', time: now, matched: matchedText, count: window.__AA_RECOVERY_TS.length });
                        return 'blocked:circuit_breaker';
                    }
                    window.__AA_RECOVERY_TS.push(now);
                } else {
                    // Successful non-recovery click — error is resolved, reset retry counter
                    window.__AA_RECOVERY_TS = [];
                }

                // Record cooldown and click
                var isExpandMatch = (matchedText === 'expand' || matchedText === 'requires input');
                if (isExpandMatch) {
                    var expandCdKey = _domPath(btn) + ':expand:' + (btn.textContent || '').trim().toLowerCase().substring(0, 30);
                    clickCooldowns[expandCdKey] = Date.now();
                } else {
                    var key = _domPath(btn) + ':' + (btn.textContent || '').trim().toLowerCase().substring(0, 30);
                    clickCooldowns[key] = Date.now();
                }
                _log('clicking:', matchedText, '| node:', btn.tagName, '| text:', (btn.textContent || '').trim().substring(0, 40));
                btn.click();
                window.__AA_CLICK_COUNT = (window.__AA_CLICK_COUNT || 0) + 1;
                return 'clicked:' + matchedText;
            }
            return null; // All found buttons were blocked
        }

        // ═══ INITIAL SCAN ═══
        // Click any buttons already present in the DOM right now.
        // Wrapped in try/catch so a crash here cannot kill observer setup.
        try { scanAndClick(); } catch(e) { _log('initial scan error:', e.message); }

        // ═══ MUTATION OBSERVER ═══
        // Zero-polling, event-driven: reacts when React mounts new elements.
        // Leading-edge throttle (200ms): fires scanAndClick() on the FIRST mutation,
        // then at most once per 200ms during continuous activity. This is optimal
        // because Antigravity buttons appear at the START of mutation bursts
        // (React mounts button → then streams LLM text). A trailing debounce
        // would delay clicks until streaming stops, which is the wrong behavior.
        var __AA_SCAN_QUEUED = false;
        var __AA_THROTTLE_COUNT = 0;
        var __AA_THROTTLE_LAST_RESET = Date.now();

        var observer = new MutationObserver(function(mutations) {
            if (__AA_SCAN_QUEUED || window.__AA_PAUSED) return;

            // ═══ MEGA-DIFF THROTTLING ═══
            // Prevent IDE lag when 1000s of lines are inserted into the DOM.
            // If we see >50 mutations per second, we skip the synchronous tree walk
            // and let the 10s fallback interval (or next second) catch the buttons.
            var now = Date.now();
            if (now - __AA_THROTTLE_LAST_RESET > 1000) {
                __AA_THROTTLE_COUNT = 0;
                __AA_THROTTLE_LAST_RESET = now;
            }
            __AA_THROTTLE_COUNT += mutations.length;
            if (__AA_THROTTLE_COUNT > 50) {
                if (!window.__AA_DIAG) window.__AA_DIAG = [];
                // Only log once per 1-second window to prevent diagnostic array spam
                if (__AA_THROTTLE_COUNT - mutations.length <= 50) { 
                    window.__AA_DIAG.push({ action: 'THROTTLED', count: __AA_THROTTLE_COUNT, time: now });
                }
                return;
            }

            __AA_SCAN_QUEUED = true;
            // 50ms time-based debounce — survives background window throttling
            // (rAF freezes when window is hidden/minimized, deadlocking the observer).
            // try/finally guarantees lock release even if scanAndClick throws.
            setTimeout(function() {
                try {
                    scanAndClick();
                } catch(e) {
                    _log('scan error:', e.message);
                } finally {
                    __AA_SCAN_QUEUED = false;
                }
            }, 50);
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'data-state']
        });

        // Failsafe: periodic scan for buttons that bypass MutationObserver
        // (e.g. CSS visibility toggles, React virtual DOM anomalies).
        // Bug 3 fix: use setTimeout instead of requestIdleCallback — rIC never fires
        // when the webview is backgrounded in Chromium, making the fallback dead.
        // Bug 1/2 fix: update __AA_LAST_SCAN in the fallback BEFORE scanning so the
        // heartbeat watchdog never expires during idle (no mutations = no scan = stale timestamp).
        // Clear any existing interval to prevent duplicates on re-injection.
        if (window.__AA_FALLBACK_INTERVAL) {
            clearInterval(window.__AA_FALLBACK_INTERVAL);
        }
        window.__AA_FALLBACK_INTERVAL = setInterval(function() {
            if (window.__AA_PAUSED) return;
            // Keep watchdog alive even when idle — proves the interval is running
            window.__AA_LAST_SCAN = Date.now();
            setTimeout(function() {
                try { scanAndClick(); } catch(e) { _log('fallback scan error:', e.message); }
            }, 0);
        }, 10000);

        // Expose observer on window for external disconnect (kill switch)
        window.__AA_OBSERVER = observer;

        return 'observer-installed';
})()
        `;
}

module.exports = { buildDOMObserverScript };
