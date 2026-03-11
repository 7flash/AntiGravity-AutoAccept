const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-e2e-'));
    console.log(`Starting isolated Antigravity instance on port 9444... data dir: ${tmpDir}`);

    const agPos = spawn('antigravity.cmd', [
        '--remote-debugging-port=9444',
        `--user-data-dir=${tmpDir}`,
        '--disable-extensions'
    ], { shell: true });

    // Wait for it to spin up
    let targets = null;
    let attempts = 0;
    while (attempts < 20) {
        await delay(1000);
        try {
            const data = await httpGet('http://127.0.0.1:9444/json');
            targets = JSON.parse(data);
            if (targets && targets.length > 0) break;
        } catch (e) {
            // ignore
        }
        attempts++;
        console.log(`Waiting for CDP... (${attempts}/20)`);
    }

    if (!targets) {
        console.error('Failed to connect to CDP on port 9444.');
        agPos.kill();
        process.exit(1);
    }

    console.log(`Found ${targets.length} targets. Injecting DOMObserver...`);
    const observerSrc = fs.readFileSync(path.join(__dirname, '../src/scripts/DOMObserver.js'), 'utf-8');
    const initCode = `
        var __AA_CONFIG = { pollInterval: 500, customButtonTexts: [], blockedCommands: [], allowedCommands: [], autoContinuePhrase: 'whats next', autoContinueCooldown: 5 };
    `;

    // Inject into the first valid target
    let active = false;
    for (const t of targets) {
        if (!t.webSocketDebuggerUrl) continue;
        console.log(`Injecting into ${t.url || t.title}...`);

        const w = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise(resolve => {
            w.on('open', () => {
                w.send(JSON.stringify({
                    id: 1,
                    method: 'Runtime.evaluate',
                    params: { expression: initCode + observerSrc }
                }));
            });

            w.on('message', raw => {
                const msg = JSON.parse(raw);
                if (msg.id === 1) {
                    // Script injected, now verify
                    w.send(JSON.stringify({
                        id: 2,
                        method: 'Runtime.evaluate',
                        params: { expression: 'window.__AA_OBSERVER_ACTIVE' }
                    }));
                } else if (msg.id === 2) {
                    const result = msg.result?.result?.value;
                    if (result === true) {
                        active = true;
                    }
                    console.log(`__AA_OBSERVER_ACTIVE = ${result}`);
                    w.close();
                    resolve();
                }
            });
            w.on('error', () => resolve());
        });

        if (active) break;
    }

    agPos.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (active) {
        console.log('✅ E2E Smoke test passed!');
        process.exit(0);
    } else {
        console.error('❌ E2E Smoke test failed (observer not active in any target).');
        process.exit(1);
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
