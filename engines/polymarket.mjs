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

/**
 * place_order.py's stdout is GUARANTEED to be exactly one clean JSON line (its own
 * contextlib.redirect_stdout(sys.stderr) fix, see the copied script's docstring) — success shape
 * {token_id,amount,order_id,post_result,ok:true}, clean failure shape {ok:false,error}. execFile
 * rejects on a non-zero exit (place_order.py exits 1 on fail()), so callers get both the thrown
 * error AND, where available, this parsed {ok:false,error} object from stdout.
 */
export function parseTradeOutput(stdout) {
  const line = stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
  if (!line) throw new Error('place_order.py produced no output');
  return JSON.parse(line);
}

/**
 * Place a real, parameterized Polymarket CLOB V2 FAK BUY order (spec §2.2 money-safety cap —
 * `maxBetUsd` is a HARD cap enforced inside place_order.py itself, not re-enforced here — this
 * wrapper never re-derives or overrides that cap, matching R5's "mechanical dispatch, not judgment").
 * WHICH tokenId/amountUsd to trade is the caller's decision (spec §4 `vineyard trade`), never picked
 * here (D2 — Vineyard does not vendor a market-picking agent).
 */
export async function trade({ evmPrivateKey, tokenId, side = 'BUY', amountUsd, maxBetUsd, env = process.env }) {
  const childEnv = {
    ...env,
    POLYGON_WALLET_PRIVATE_KEY: evmPrivateKey,
    TOKEN_ID: String(tokenId),
    SIDE: side,
    AMOUNT: String(amountUsd),
    ...(maxBetUsd != null ? { MAX_BET_SIZE: String(maxBetUsd) } : {}),
  };
  const { stdout } = await execFileAsync(pythonBin(), [path.join(PY_DIR, 'place_order.py')], {
    env: childEnv,
    timeout: 120_000,
  });
  return parseTradeOutput(stdout);
}

/** redeem.py prints one compact JSON line PER redeemed condition (zero lines = nothing redeemable). */
export function parseRedeemOutput(stdout) {
  return stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l));
}

/**
 * Collect (redeem) this instance's RESOLVED, redeemable Polymarket positions. `depositWallet` is the
 * SDK-resolved deposit wallet address for `evmPrivateKey` (spec §8 — never guessed/hardcoded here;
 * D6(a)). Each returned row's `line` object is the raw {earn_usdc,cost_usdc,...} fact the caller
 * (core/loop.mjs) hands to core/ledger.mjs::appendLedger() — this wrapper does not write the ledger
 * itself (D6(d) — redeem.py no longer calls anicca's external record.mjs either).
 */
export async function redeem({ evmPrivateKey, depositWallet, relayerCacheFile, env = process.env }) {
  const { stdout } = await execFileAsync(pythonBin(), [path.join(PY_DIR, 'redeem.py')], {
    env: {
      ...env,
      POLYGON_WALLET_PRIVATE_KEY: evmPrivateKey,
      POLYMARKET_DEPOSIT_WALLET: depositWallet,
      ...(relayerCacheFile ? { POLYMARKET_RELAYER_CACHE: relayerCacheFile } : {}),
    },
    timeout: 300_000,
  });
  return parseRedeemOutput(stdout);
}
