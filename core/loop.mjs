// ~/vineyard/core/loop.mjs — wake -> read balances -> pick engine -> earn -> write ledger -> sleep.
// `runOnce` runs exactly one pass; `runLoop` repeats it on an interval (or forever if none given).
// Engines are dependency-injected (`engines` param) so this module is unit-testable without any real
// network/chain call — production callers (cli/index.mjs, api/server.mjs) pass the REAL engine
// modules (engines/yield.mjs, engines/solana.mjs, engines/polymarket.mjs).
import { pickEngine } from './brain.mjs';
import { appendLedger } from './ledger.mjs';
import { resolveEvmPrivateKey, resolveSolanaSecret, instanceDir } from './wallet.mjs';
import { findSpawn } from './registry.mjs';

export async function runOnce({ id, dataDir, env = process.env, engines, candidates, lastRun = {} }) {
  const engineName = pickEngine({ lastRun, candidates });
  if (engineName) lastRun[engineName] = Date.now();

  let result;
  if (engineName === 'yield') {
    const pk = resolveEvmPrivateKey(id, env);
    if (!pk) return appendLedger(id, { engine: 'yield', status: 'skip', reason: 'no-evm-key' }, dataDir);
    result = await engines.yield.run({ evmPrivateKey: pk, env });
  } else if (engineName === 'solana') {
    const secret = resolveSolanaSecret(id, env);
    if (!secret) return appendLedger(id, { engine: 'solana', status: 'skip', reason: 'no-solana-key' }, dataDir);
    result = await engines.solana.run({ instanceHome: instanceDir(id, env), env });
  } else if (engineName === 'polymarket-redeem') {
    const pk = resolveEvmPrivateKey(id, env);
    const spawn = findSpawn(id, env);
    if (!pk || !spawn?.polymarketDepositWallet) {
      return appendLedger(id, { engine: 'polymarket-redeem', status: 'skip', reason: 'no-deposit-wallet' }, dataDir);
    }
    result = await engines.polymarket.redeem({ evmPrivateKey: pk, depositWallet: spawn.polymarketDepositWallet, env });
  } else {
    result = { status: 'skip', reason: `no engine available (candidates=${JSON.stringify(candidates)})` };
  }

  return appendLedger(id, { engine: engineName, ...normalizeResult(result) }, dataDir);
}

function normalizeResult(result) {
  if (Array.isArray(result)) {
    // polymarket-redeem returns an array of per-condition results
    const net_usdc = result.reduce((s, r) => s + Number(r.line?.earn_usdc || 0) - Number(r.line?.cost_usdc || 0), 0);
    return { status: result.length ? 'ok' : 'wait', tx: result.map((r) => r.tx_hash).filter(Boolean), net_usdc, raw: result };
  }
  // Honest-bookkeeping fix (found via a real end-to-end smoke test, not in the plan's original
  // snippet): the plan's `result.status || result.action || (result.error ? 'error' : 'ok')` fell
  // through to 'ok' for engines/yield.mjs's `{abort:"no ETH for gas",...}` shape (no status/action/
  // error field) and for engines/solana.mjs's `{exit,note}` shape on a nonzero exit code — both would
  // have been silently recorded as a successful pass in the ledger, exactly the fabricated-success
  // HARD RULE 0.24 forbids. `abort`/a nonzero `exit` are now checked BEFORE falling through to 'ok'.
  if (result.status) return result;
  if (result.abort) return { status: 'abort', ...result };
  if (typeof result.exit === 'number' && result.exit !== 0) return { status: 'error', ...result };
  if (result.action) return { status: result.action, ...result };
  if (result.error) return { status: 'error', ...result };
  return { status: 'ok', ...result };
}

export async function runLoop({ id, dataDir, intervalMs, env = process.env, engines, candidates, signal }) {
  const lastRun = {};
  // eslint-disable-next-line no-constant-condition
  while (!signal?.aborted) {
    await runOnce({ id, dataDir, env, engines, candidates, lastRun });
    if (!intervalMs) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
