// ~/vineyard/engines/solana.mjs — thin Node wrapper shelling out to the copied run.sh, which itself
// shells out to the globally-installed @blockrun/franklin-trading CLI (D3) — a SEPARATE, fully
// autonomous LLM-driven trading agent that does its OWN research/sizing/execution and pays for its
// own model calls via x402 from ITS wallet. This wrapper does NOT implement a Jupiter swap directly
// (the spec's original assumption — see D3). Output is FREEFORM TEXT, not JSON — matches run.sh's own
// existing OUTTAIL (last-5-lines) pattern rather than inventing a JSON contract the script never had.
// Per-instance isolation (D4) is achieved by spawning with HOME set to this instance's own directory,
// reusing core/wallet.mjs's existing instanceDir(id) boundary — franklin-trading's own .blockrun/
// store then lives INSIDE that same per-instance directory, never colliding across instances.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_SH = path.join(HERE, 'shell', 'solana', 'run.sh');

export function lastLines(text, n) {
  return text.trim().split('\n').filter(Boolean).slice(-n).join('\n');
}

export function run({ instanceHome, maxSpend = 0.25, model = 'openai/gpt-5-mini', env = process.env, timeoutMs = 600_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [RUN_SH], {
      env: {
        ...env,
        HOME: instanceHome, // D4: isolates franklin-trading's own .blockrun/ wallet store per instance
        SOL_TRADE_MAX_SPEND: String(maxSpend),
        SOL_TRADE_MODEL: model,
      },
      timeout: timeoutMs,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ exit: code, note: lastLines(out, 5) }));
    child.on('error', reject);
  });
}

/** One-time setup: create this instance's own isolated franklin-trading Solana wallet (D4). */
export function setup({ instanceHome, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn('franklin-trading', ['setup', 'solana'], {
      env: { ...process.env, HOME: instanceHome },
      timeout: timeoutMs,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      const match = out.match(/Address:\s*(\S+)/);
      resolve({ exit: code, address: match ? match[1] : null, raw: out });
    });
    child.on('error', reject);
  });
}
