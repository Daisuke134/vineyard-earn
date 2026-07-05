// ~/vineyard/engines/hyperliquid.mjs — thin Node wrapper around the copied, byte-for-byte hl.py (a
// TOOL, not a strategy — hl.py's own docstring: "YOU are an intelligence; you decide"). This wrapper
// NEVER picks side/size/coin — it only exposes hl.py's 4 primitives (account/market/open/close) as
// async functions, and ALWAYS injects the resolved per-instance key as BLOCKRUN_WALLET_KEY (D7 — this
// bypasses hl.py's own internal resolve-identity.mjs subprocess fallback, which assumes anicca's
// directory layout and would not resolve correctly inside vineyard/; hl.py's env-first branch always
// short-circuits before reaching that fallback once BLOCKRUN_WALLET_KEY is set).
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HL_PY = path.join(HERE, 'python', 'hyperliquid', 'hl.py');
const VENV_PY = path.join(HERE, 'python', '.venv', 'bin', 'python3');

function pythonBin() {
  return process.env.VINEYARD_PYTHON || VENV_PY;
}

/** hl.py's cmd_* functions each print exactly one json.dumps(..., indent=2) object on stdout. */
export function parseHlOutput(stdout) {
  return JSON.parse(stdout.trim());
}

async function runHl(args, evmPrivateKey, env) {
  const { stdout } = await execFileAsync(pythonBin(), [HL_PY, ...args], {
    env: { ...env, BLOCKRUN_WALLET_KEY: evmPrivateKey },
    timeout: 60_000,
  });
  return parseHlOutput(stdout);
}

export const account = ({ evmPrivateKey, env = process.env }) => runHl(['account'], evmPrivateKey, env);

export const market = ({ coin, hours = 24, evmPrivateKey, env = process.env }) =>
  runHl(['market', coin, String(hours)], evmPrivateKey, env);

export const open = ({ coin, side, notional, lev = 2, sl = 4, tp = 8, evmPrivateKey, env = process.env }) =>
  runHl(['open', coin, side, String(notional), '--lev', String(lev), '--sl', String(sl), '--tp', String(tp)], evmPrivateKey, env);

export const close = ({ coin, evmPrivateKey, env = process.env }) => runHl(['close', coin], evmPrivateKey, env);
