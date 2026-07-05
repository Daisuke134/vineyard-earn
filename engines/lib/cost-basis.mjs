// ~/vineyard/engines/lib/cost-basis.mjs — copied from anicca ~/anicca/skills/earn/lib/cost-basis.mjs,
// adapted ONLY so every function takes an explicit `filePath` instead of one hardcoded shared-HOME
// path (Vineyard runs N instances under one VINEYARD_HOME; anicca assumed one shared HOME per agent).
// The venue-basis bookkeeping logic itself (deposit/withdraw/floor-at-0/seed-if-empty) is unchanged.
// `applyDelta` is the PURE kernel (no I/O, no mutation) Phase 5's purity audit greps for
// (verification-architecture.md's Purity Boundary Map) — `adjust` is the thin effectful wrapper
// (read -> applyDelta -> write) around it.
import fs from 'node:fs';
import path from 'node:path';

export function readCostBasis(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

function write(o, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(o, null, 2));
}

export function recordDeposit(venue, usd, filePath) { return adjust(venue, +Number(usd), filePath); }
export function recordWithdraw(venue, usd, filePath) { return adjust(venue, -Number(usd), filePath); }

/**
 * PURE KERNEL (no I/O, no mutation of `costBasisObj`): returns a NEW object with `venue`'s value
 * adjusted by `delta` and floored at 0. Assumes `venue` is a truthy string and `delta` is finite —
 * the effectful wrapper `adjust()` below validates those before ever calling this.
 */
export function applyDelta(costBasisObj, venue, delta) {
  const next = { ...costBasisObj };
  next[venue] = Math.max(0, +(((next[venue] || 0) + delta)).toFixed(6));
  return next;
}

function adjust(venue, delta, filePath) {
  if (!venue || !Number.isFinite(delta)) return null;
  const current = readCostBasis(filePath);
  const next = applyDelta(current, venue, delta);
  write(next, filePath);
  return next[venue];
}

export function seedIfEmpty(seed, filePath) {
  const o = readCostBasis(filePath);
  let changed = false;
  for (const [v, usd] of Object.entries(seed)) {
    if (o[v] == null && Number.isFinite(Number(usd))) { o[v] = +Number(usd).toFixed(6); changed = true; }
  }
  if (changed) write(o, filePath);
  return o;
}
