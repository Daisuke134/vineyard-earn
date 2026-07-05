// ~/vineyard/engines/polymarket.mjs — thin Node wrapper shelling out to the copied, byte-for-byte
// anicca Polymarket Python scripts (engines/python/polymarket/). None of the money-safety logic
// (deposit-wallet registry gate, neg-risk approvals, CTF operator approval) is reimplemented here —
// only invoked + parsed. See this plan's header discrepancy table (D1/D2/D6/D8) for what differs
// from the spec's original assumption and why.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY_DIR = path.join(HERE, 'python', 'polymarket');
const VENV_PY = path.join(HERE, 'python', '.venv', 'bin', 'python3');

function pythonBin() {
  return process.env.VINEYARD_PYTHON || VENV_PY;
}

/** fund_via_bridge.py prints exactly one compact JSON line on stdout (debug goes to stderr). */
export function parseFundOutput(stdout) {
  const line = stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
  if (!line) throw new Error('fund_via_bridge.py produced no output');
  return JSON.parse(line);
}

/**
 * Register + fund instance's Polymarket deposit wallet via the bridge onramp (D8: `sourceKey` must
 * be an ALREADY-REGISTERED wallet's key for a brand-new deployment's very first registration).
 */
export async function fund({ evmPrivateKey, sourceKey, fundUsd = 2, env = process.env }) {
  const childEnv = {
    ...env,
    POLYGON_WALLET_PRIVATE_KEY: evmPrivateKey,
    FUND_USD: String(fundUsd),
    ...(sourceKey ? { SOURCE_KEY: sourceKey } : {}),
  };
  const { stdout } = await execFileAsync(pythonBin(), [path.join(PY_DIR, 'fund_via_bridge.py')], {
    env: childEnv,
    timeout: 300_000,
  });
  return parseFundOutput(stdout);
}
