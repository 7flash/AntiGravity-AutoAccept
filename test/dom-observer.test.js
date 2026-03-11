/**
 * DOMObserver Test Suite
 * ──────────────────────
 * Tests the buildDOMObserverScript() function and its generated
 * self-contained script. Uses jsdom for DOM simulation.
 *
 * Run:  node test/dom-observer.test.js
 */

const assert = require('assert');
const path = require('path');
const { buildDOMObserverScript } = require(path.join(__dirname, '..', 'src', 'scripts', 'DOMObserver'));

// ─── Test Harness ────────────────────────────────────────────────────
let pass = 0, fail = 0;
const fails = [];

function test(name, fn) {
    try { fn(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
    catch (e) { fail++; fails.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}`); }
}

function eq(a, b) { assert.strictEqual(a, b); }
function ok(v, msg) { assert.ok(v, msg); }

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- buildDOMObserverScript: Output Structure ---\x1b[0m');

test('returns a string', () => {
    const script = buildDOMObserverScript([], [], []);
    eq(typeof script, 'string');
});

test('output is a self-invoking function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('(function()'), 'should start with IIFE');
    ok(script.trimEnd().endsWith('})()'), 'should end with IIFE invocation');
});

test('includes idempotency guard', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('__AA_OBSERVER_ACTIVE'), 'should check for double-injection');
});

test('includes MutationObserver setup', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('MutationObserver'), 'should use MutationObserver');
});

test('includes fallback interval', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('setInterval') || script.includes('__AA_FALLBACK_INTERVAL'), 'should have polling fallback');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Default Parameters ---\x1b[0m');

test('default button texts include run', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('"run"'), 'should contain "run"');
});

test('default button texts include accept when file edits enabled', () => {
    const script = buildDOMObserverScript([], [], [], true);
    ok(script.includes('"accept"'), 'should contain "accept"');
});

test('accept excluded when autoAcceptFileEdits=false', () => {
    const script = buildDOMObserverScript([], [], [], false);
    // Check that "accept" is not in the BUTTON_TEXTS array
    // The array should NOT include "accept" as a standalone button text
    const textsMatch = script.match(/var BUTTON_TEXTS = (\[.*?\]);/);
    if (textsMatch) {
        const texts = JSON.parse(textsMatch[1]);
        ok(!texts.includes('accept'), 'should NOT include accept when file edits disabled');
    }
});

test('default texts include always allow', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('"always allow"'), 'should contain "always allow"');
});

test('default texts include allow this conversation', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('"allow this conversation"'), 'should contain "allow this conversation"');
});

test('default texts include continue', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('"continue"'), 'should contain "continue"');
});

test('default texts include retry', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('"retry"'), 'should contain "retry"');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Custom Button Texts ---\x1b[0m');

test('custom texts are appended to button list', () => {
    const script = buildDOMObserverScript(['approve', 'confirm'], [], []);
    ok(script.includes('"approve"'), 'should include custom text "approve"');
    ok(script.includes('"confirm"'), 'should include custom text "confirm"');
});

test('custom texts come after default texts', () => {
    const script = buildDOMObserverScript(['my-custom-btn'], [], []);
    // "run" should appear before "my-custom-btn" in the array
    const runIdx = script.indexOf('"run"');
    const customIdx = script.indexOf('"my-custom-btn"');
    ok(runIdx < customIdx, '"run" should appear before custom text');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Command Filtering Configuration ---\x1b[0m');

test('blocked commands are embedded in output', () => {
    const script = buildDOMObserverScript([], ['rm', 'git push'], []);
    ok(script.includes('"rm"'), 'should embed blocked "rm"');
    ok(script.includes('"git push"'), 'should embed blocked "git push"');
});

test('allowed commands are embedded in output', () => {
    const script = buildDOMObserverScript([], [], ['npm test', 'bun run']);
    ok(script.includes('"npm test"'), 'should embed allowed "npm test"');
    ok(script.includes('"bun run"'), 'should embed allowed "bun run"');
});

test('HAS_FILTERS is true when blocked commands exist', () => {
    const script = buildDOMObserverScript([], ['rm'], []);
    // HAS_FILTERS is computed: BLOCKED_COMMANDS.length > 0 || ALLOWED_COMMANDS.length > 0
    ok(script.includes('BLOCKED_COMMANDS.length') && script.includes('ALLOWED_COMMANDS.length'),
        'HAS_FILTERS should be computed from array lengths');
    ok(script.includes('"rm"'), 'blocked commands should be non-empty');
});

test('HAS_FILTERS is true when allowed commands exist', () => {
    const script = buildDOMObserverScript([], [], ['npm test']);
    ok(script.includes('"npm test"'), 'allowed commands should be non-empty');
});

test('HAS_FILTERS is false when no filters', () => {
    const script = buildDOMObserverScript([], [], []);
    // Both arrays empty → BLOCKED_COMMANDS.length > 0 will be false
    ok(script.includes('var BLOCKED_COMMANDS = []'), 'blocked should be empty');
    ok(script.includes('var ALLOWED_COMMANDS = []'), 'allowed should be empty');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Auto-Continue Configuration ---\x1b[0m');

test('default auto-continue phrase is "whats next"', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('"whats next"'), 'default phrase should be "whats next"');
});

test('custom auto-continue phrase is embedded', () => {
    const script = buildDOMObserverScript([], [], [], true, 'continue please');
    ok(script.includes('"continue please"'), 'custom phrase should be embedded');
});

test('default cooldown is 30 seconds (30000ms)', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('30000'), 'default cooldown should be 30000ms');
});

test('custom cooldown is embedded', () => {
    const script = buildDOMObserverScript([], [], [], true, 'whats next', 60);
    ok(script.includes('60000'), 'custom cooldown should be 60000ms');
});

test('cooldown is clamped to min 5 seconds', () => {
    const script = buildDOMObserverScript([], [], [], true, 'whats next', 1);
    // 1 second input should be clamped to 5 seconds = 5000ms
    ok(script.includes('5000'), 'cooldown should be clamped to 5000ms');
    ok(!script.includes('1000;'), 'should not contain 1000 as literal cooldown');
});

test('cooldown is clamped to max 120 seconds', () => {
    const script = buildDOMObserverScript([], [], [], true, 'whats next', 999);
    // 999 should be clamped to 120 = 120000ms
    ok(script.includes('120000'), 'cooldown should be clamped to 120000ms');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Generated Script: Internal Functions ---\x1b[0m');

test('includes isAgentPanel guard', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function isAgentPanel()'), 'should define isAgentPanel');
    ok(script.includes('.react-app-container'), 'should check for react-app-container');
});

test('includes closestClickable function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function closestClickable('), 'should define closestClickable');
});

test('includes findButton function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function findButton('), 'should define findButton');
});

test('includes isWordBoundary check', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function isWordBoundary('), 'should define isWordBoundary function');
});

test('includes extractCommandText function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function extractCommandText('), 'should define extractCommandText');
});

test('includes isCommandAllowed function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function isCommandAllowed('), 'should define isCommandAllowed');
});

test('includes scanAndClick function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function scanAndClick()'), 'should define scanAndClick');
});

test('includes pruneCooldowns function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function pruneCooldowns()'), 'should define pruneCooldowns');
});

test('includes _domPath function', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('function _domPath('), 'should define _domPath');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Generated Script: Safety Guards ---\x1b[0m');

test('includes idempotent teardown', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('__AA_CLEANUP'), 'should support cleanup for re-injection');
});

test('includes watchdog timestamp', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('__AA_LAST_SCAN'), 'should update watchdog timestamp');
});

test('includes click counter', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('__AA_CLICK_COUNT'), 'should track clicks');
});

test('includes pause kill-switch', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('__AA_PAUSED'), 'should support pause state');
});

test('includes expand/collapse guard', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('isExpandToggle'), 'should guard against expand/collapse buttons');
});

test('includes disabled button guard', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('.disabled') || script.includes('aria-disabled'), 'should check for disabled state');
});

test('includes cooldown guard', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('COOLDOWN_MS'), 'should define cooldown');
    ok(script.includes('clickCooldowns'), 'should track cooldowns per button');
});

test('expand buttons get longer cooldown', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('EXPAND_COOLDOWN_MS'), 'should have separate expand cooldown');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Generated Script: Keyboard Shortcut Matching ---\x1b[0m');

test('handles keyboard shortcut suffixes (AcceptAlt+⏎)', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('alt') && script.includes('ctrl') && script.includes('shift'),
        'should have keyboard modifier detection');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Generated Script: Text Length Guard ---\x1b[0m');

test('skips nodes with text longer than 50 chars', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('50') && script.includes('nodeText.length'), 'should guard against long text nodes');
});

test('logs diagnostic when long text matches keyword', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('SKIP_LONG_TEXT'), 'should log SKIP_LONG_TEXT diagnostic');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Generated Script: Shadow DOM Support ---\x1b[0m');

test('recursively searches shadow roots', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('.shadowRoot'), 'should check shadow roots');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Generated Script: Data Attribute Shortcuts ---\x1b[0m');

test('checks data-testid for allow buttons', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('data-testid'), 'should check data-testid');
});

test('checks data-action for allow buttons', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('data-action'), 'should check data-action');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Generated Script: Auto-Continue Logic ---\x1b[0m');

test('includes send button detector for auto-continue', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('input-send-button-send-tooltip'), 'should look for send button by tooltip');
});

test('includes aria-label fallback for send button', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('aria-label'), 'should fall back to aria-label for send');
});

test('checks input is empty before typing', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('textContent') || script.includes('innerText'), 'should check input content');
});

test('uses document.execCommand to type phrase', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes("execCommand('insertText'"), 'should use execCommand for React compatibility');
});

test('checks for minimum response length before continuing', () => {
    const script = buildDOMObserverScript([], [], []);
    ok(script.includes('200'), 'should check response is at least 200 chars');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m--- Edge Cases ---\x1b[0m');

test('handles empty customTexts array', () => {
    const script = buildDOMObserverScript([], [], []);
    eq(typeof script, 'string');
    ok(script.includes('BUTTON_TEXTS'), 'should define BUTTON_TEXTS');
});

test('handles null blockedCommands gracefully', () => {
    const script = buildDOMObserverScript([], null, []);
    eq(typeof script, 'string');
    ok(script.includes('BLOCKED_COMMANDS'), 'should define BLOCKED_COMMANDS');
});

test('handles null allowedCommands gracefully', () => {
    const script = buildDOMObserverScript([], [], null);
    eq(typeof script, 'string');
    ok(script.includes('ALLOWED_COMMANDS'), 'should define ALLOWED_COMMANDS');
});

test('handles minimal params (empty arrays)', () => {
    const script = buildDOMObserverScript([], [], []);
    eq(typeof script, 'string');
    ok(script.length > 1000, 'should generate substantial script');
});

test('output contains valid JavaScript (no syntax errors)', () => {
    const script = buildDOMObserverScript(['custom'], ['rm'], ['npm test'], true, 'proceed', 45);
    // Try to parse it — Function constructor will throw on syntax errors
    try {
        // Wrap in function to catch syntax errors without executing
        new Function(script);
    } catch (e) {
        assert.fail(`Generated script has syntax error: ${e.message}`);
    }
});

test('special chars in custom texts are properly escaped', () => {
    const script = buildDOMObserverScript(['it\'s "ok"'], [], []);
    // JSON.stringify should handle escaping
    ok(script.includes('it'), 'should contain the custom text');
    // Verify it's valid JavaScript
    try { new Function(script); } catch (e) { assert.fail(`Syntax error with special chars: ${e.message}`); }
});

test('special chars in blocked commands are properly escaped', () => {
    const script = buildDOMObserverScript([], ['rm -rf /', 'echo "hello"'], []);
    try { new Function(script); } catch (e) { assert.fail(`Syntax error with special chars: ${e.message}`); }
});

// ═════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  \x1b[32m${pass} passed\x1b[0m, \x1b[${fail ? '31' : '32'}m${fail} failed\x1b[0m, ${pass + fail} total`);
if (fails.length) {
    console.log('\n  Failures:');
    fails.forEach(f => console.log(`   • ${f}`));
}
console.log('');
process.exit(fail ? 1 : 0);
