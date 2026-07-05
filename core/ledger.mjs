// ~/vineyard/core/ledger.mjs — on-chain-verified realized P&L ONLY, never paper (spec §8).
import fs from 'node:fs';
import path from 'node:path';
import { isValidId } from './wallet.mjs';

// SECURITY (REQ-019): this is a SECOND, independent per-id path-construction choke point (a
// separate `dataDir` root from core/wallet.mjs's `vineyardHome`) — `${id}.jsonl` is just as
// caller-controlled and path-traversal-prone as instanceDir()'s `id` segment, so it reuses the SAME
// isValidId() guard rather than inventing a second validation rule.
function ledgerPath(id, dataDir) {
  if (!isValidId(id)) {
    throw new Error(`invalid instance id: ${JSON.stringify(id)}`);
  }
  return path.join(dataDir, 'ledgers', `${id}.jsonl`);
}

/**
 * Append one realized event. `event` should carry a real on-chain `tx` for a fill, or
 * `status: "wait"`/`"skip"` for a reasoned no-trade pass (HARD RULE 0.24: no dry run, but a
 * genuine WAIT/skip is a valid real outcome, never fabricated).
 */
export function appendLedger(id, event, dataDir) {
  const p = ledgerPath(id, dataDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const line = { ts: new Date().toISOString(), id, ...event };
  fs.appendFileSync(p, JSON.stringify(line) + '\n');
  return line;
}

export function readLedger(id, dataDir) {
  const p = ledgerPath(id, dataDir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * PURE KERNEL (no I/O): sum an ALREADY-PARSED array of ledger-line objects into a realized P&L
 * number. `net_usdc` wins if present; else `earn_usdc - cost_usdc`; else 0 for a skip/wait line.
 * Never NaN. This is the exact function Phase 5's purity audit greps for
 * (verification-architecture.md's Purity Boundary Map).
 */
export function sumRealized(lines) {
  return lines.reduce((sum, line) => {
    const net = typeof line.net_usdc === 'number'
      ? line.net_usdc
      : (Number(line.earn_usdc || 0) - Number(line.cost_usdc || 0));
    return sum + (Number.isFinite(net) ? net : 0);
  }, 0);
}

/** Realized P&L for instance `id` = sumRealized(readLedger(id, dataDir)). The only I/O is the read. */
export function realizedPnl(id, dataDir) {
  return sumRealized(readLedger(id, dataDir));
}
