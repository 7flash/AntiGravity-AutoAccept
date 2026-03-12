/**
 * E2E Smoke Test — AntiGravity AutoAccept
 * ─────────────────────────────────────────
 * Launches an isolated Antigravity IDE instance with a debug port,
 * connects via CDP, injects DOMObserver, and verifies it activates.
 *
 * Requirements:
 *   - `antigravity` or `code` must be in PATH
 *   - Port 9444 must be free
 *   - ws package: npm install (already in devDependencies)
 *
 * Run:  node test/e2e-smoke.test.js
 *
 * Can also attach to an ALREADY RUNNING instance:
 *   node test/e2e-smoke.test.js --attach 9333
 */

const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildDOMObserverScript } = require(path.join(__dirname, '..', 'src', 'scripts', 'DOMObserver'));

// ── Config ──
const LAUNCH_PORT = 9444;
const TIMEOUT_MS = 30000;

// ── Helpers ──
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function cdpConnect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let msgId = 0;
        const pending = new Map();

        ws.on('message', raw => {
            const msg = JSON.parse(raw.toString());
            if (msg.id && pending.has(msg.id)) {
                const { resolve: res, timer } = pending.get(msg.id);
                clearTimeout(timer);
                pending.delete(msg.id);
                res(msg);
            }
        });

        function send(method, params = {}, sessionId = null) {
            return new Promise((res, rej) => {
                const id = ++msgId;
                const timer = setTimeout(() => {
                    pending.delete(id);
                    rej(new Error(`CDP timeout: ${method}`));
                }, 10000);
                pending.set(id, { resolve: res, timer });
                const payload = { id, method, params };
                if (sessionId) payload.sessionId = sessionId;
                ws.send(JSON.stringify(payload));
            });
        }

        ws.on('open', () => resolve({ ws, send }));
        ws.on('error', reject);
    });
}

// ── Test Harness ──
let pass = 0, fail = 0;
const fails = [];

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function test(name, result) {
    if (result) {
        pass++;
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } else {
        fail++;
        fails.push(name);
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    }
}

// ── Main ──
async function main() {
    const args = process.argv.slice(2);
    const attachMode = args.includes('--attach');
    const port = attachMode ? (parseInt(args[args.indexOf('--attach') + 1]) || 9333) : LAUNCH_PORT;

    let childProc = null;
    let tmpDir = null;

    console.log('\n\x1b[1m═══ AntiGravity AutoAccept E2E Smoke Test ═══\x1b[0m\n');

    // ── Step 1: Launch or attach ──
    if (attachMode) {
        console.log(`Attaching to existing instance on port ${port}...`);
    } else {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-e2e-'));
        console.log(`Launching isolated instance on port ${port}...`);
        console.log(`  Data dir: ${tmpDir}`);

        // Try antigravity first, fall back to code
        const cmd = process.platform === 'win32' ? 'antigravity.cmd' : 'antigravity';
        childProc = spawn(cmd, [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${tmpDir}`,
            '--disable-extensions',
            '--disable-gpu',
        ], { shell: true, stdio: 'ignore' });

        childProc.on('error', () => {
            // If antigravity not found, mark it
            childProc = null;
        });
    }

    try {
        // ── Step 2: Wait for CDP endpoint ──
        console.log('\n\x1b[1m--- CDP Connection ---\x1b[0m');
        let targets = null;
        let versionInfo = null;
        const deadline = Date.now() + TIMEOUT_MS;

        while (Date.now() < deadline) {
            try {
                const [targetsRaw, versionRaw] = await Promise.all([
                    httpGet(`http://127.0.0.1:${port}/json`),
                    httpGet(`http://127.0.0.1:${port}/json/version`),
                ]);
                targets = JSON.parse(targetsRaw);
                versionInfo = JSON.parse(versionRaw);
                if (targets && targets.length > 0) break;
            } catch { /* retry */ }
            await delay(1000);
            process.stdout.write('.');
        }
        console.log('');

        test('CDP endpoint responds', !!targets);
        test('At least 1 target found', targets && targets.length > 0);
        test('Browser version reported', !!versionInfo?.Browser);

        if (!targets || targets.length === 0) {
            console.log('\n  ⚠️  No targets available. Is Antigravity running with --remote-debugging-port?');
            if (!attachMode) console.log('     Try: node test/e2e-smoke.test.js --attach 9333');
            throw new Error('No CDP targets');
        }

        console.log(`  Found ${targets.length} targets`);
        if (versionInfo) console.log(`  Browser: ${versionInfo.Browser}`);

        // ── Step 3: Connect via browser WS and find targets ──
        console.log('\n\x1b[1m--- Target Discovery ---\x1b[0m');
        const browserWsUrl = versionInfo.webSocketDebuggerUrl;
        test('Browser WS URL available', !!browserWsUrl);

        const { ws, send } = await cdpConnect(browserWsUrl);

        const cdpTargets = await send('Target.getTargets');
        const allTargets = cdpTargets.result?.targetInfos || [];
        test('Target.getTargets returns targets', allTargets.length > 0);

        // Log target types
        const targetTypes = {};
        for (const t of allTargets) {
            targetTypes[t.type] = (targetTypes[t.type] || 0) + 1;
        }
        console.log(`  Target types: ${Object.entries(targetTypes).map(([k, v]) => `${k}(${v})`).join(', ')}`);

        // ── Step 4: Find a suitable page target for injection ──
        console.log('\n\x1b[1m--- DOMObserver Injection ---\x1b[0m');
        const pageTargets = allTargets.filter(t => t.type === 'page');
        test('Page targets exist', pageTargets.length > 0);

        // Try to inject into each page target until one works
        let injected = false;
        let observerActive = false;
        let observerObject = false;
        let pausedFalse = false;
        let clickCount = false;

        const script = buildDOMObserverScript([], [], []);

        for (const target of pageTargets) {
            const shortId = target.targetId.substring(0, 8);
            console.log(`  Trying target ${shortId}: "${target.title || target.url}"`);

            try {
                // Attach to target
                const attachMsg = await send('Target.attachToTarget', {
                    targetId: target.targetId,
                    flatten: true,
                });
                const sessionId = attachMsg.result?.sessionId;
                if (!sessionId) continue;

                // Enable Runtime
                await send('Runtime.enable', {}, sessionId).catch(() => { });

                // Check if it has a DOM
                const domCheck = await send('Runtime.evaluate', {
                    expression: 'typeof document !== "undefined" && !!document.body',
                    returnByValue: true,
                }, sessionId).catch(() => null);

                if (!domCheck?.result?.result?.value) {
                    await send('Target.detachFromTarget', { sessionId }).catch(() => { });
                    continue;
                }

                // Inject the DOMObserver script
                const injectResult = await send('Runtime.evaluate', {
                    expression: script,
                    returnByValue: true,
                }, sessionId);

                const returnVal = injectResult.result?.result?.value;
                injected = returnVal === 'observer-installed' || returnVal === 'already-active';

                if (!injected) {
                    // Check for error
                    const errDesc = injectResult.result?.exceptionDetails?.exception?.description;
                    if (errDesc) console.log(`    Injection error: ${errDesc.substring(0, 120)}`);
                    await send('Target.detachFromTarget', { sessionId }).catch(() => { });
                    continue;
                }

                console.log(`    Injection returned: "${returnVal}"`);

                // Verify observer state
                const stateCheck = await send('Runtime.evaluate', {
                    expression: `({
                        active: !!window.__AA_OBSERVER_ACTIVE,
                        observer: !!window.__AA_OBSERVER,
                        paused: window.__AA_PAUSED,
                        clickCount: window.__AA_CLICK_COUNT || 0,
                        lastScan: window.__AA_LAST_SCAN ? Date.now() - window.__AA_LAST_SCAN : -1,
                        hasCleanup: typeof window.__AA_CLEANUP === 'function',
                        hasBlocked: Array.isArray(window.__AA_BLOCKED),
                        hasAllowed: Array.isArray(window.__AA_ALLOWED),
                    })`,
                    returnByValue: true,
                }, sessionId);

                const state = stateCheck.result?.result?.value;
                if (state) {
                    observerActive = state.active === true;
                    observerObject = state.observer === true;
                    pausedFalse = state.paused === false;
                    clickCount = typeof state.clickCount === 'number';

                    console.log(`    State: active=${state.active} observer=${state.observer} paused=${state.paused} clickCount=${state.clickCount}`);
                    console.log(`    lastScan: ${state.lastScan}ms ago, cleanup=${state.hasCleanup}, blocked=${state.hasBlocked}, allowed=${state.hasAllowed}`);

                    // Verify idempotent re-injection
                    const reInjectResult = await send('Runtime.evaluate', {
                        expression: script,
                        returnByValue: true,
                    }, sessionId);
                    const reInjectVal = reInjectResult.result?.result?.value;
                    test('Re-injection returns "already-active"', reInjectVal === 'already-active');

                    // Verify cleanup function works
                    const cleanupTest = await send('Runtime.evaluate', {
                        expression: `(function() {
                            window.__AA_CLEANUP();
                            var observerGone = window.__AA_OBSERVER === null;
                            // Re-inject so we leave clean state
                            window.__AA_OBSERVER_ACTIVE = false;
                            return observerGone;
                        })()`,
                        returnByValue: true,
                    }, sessionId);
                    test('Cleanup disconnects observer', cleanupTest.result?.result?.value === true);
                }

                await send('Target.detachFromTarget', { sessionId }).catch(() => { });
                break; // Success — no need to try more targets

            } catch (e) {
                console.log(`    Error: ${e.message}`);
            }
        }

        test('DOMObserver injected successfully', injected);
        test('__AA_OBSERVER_ACTIVE = true', observerActive);
        test('__AA_OBSERVER is set', observerObject);
        test('__AA_PAUSED = false', pausedFalse);
        test('__AA_CLICK_COUNT is a number', clickCount);

        ws.close();

    } finally {
        // Cleanup
        if (childProc) {
            childProc.kill();
            await delay(500);
        }
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
        }
    }

    // ── Summary ──
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  \x1b[32m${pass} passed\x1b[0m, \x1b[${fail ? '31' : '32'}m${fail} failed\x1b[0m, ${pass + fail} total`);

    if (fails.length) {
        console.log('\n  Failures:');
        fails.forEach(f => console.log(`   • ${f}`));
    }
    console.log('');
    process.exit(fail ? 1 : 0);
}

main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
});
