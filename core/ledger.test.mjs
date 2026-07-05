// ~/vineyard/core/ledger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendLedger, readLedger, realizedPnl, sumRealized } from './ledger.mjs';

function tmpDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

test('readLedger: empty array when no file exists yet', () => {
  const dataDir = tmpDataDir('vy-ledger-empty');
  assert.deepEqual(readLedger('z1', dataDir), []);
});

test('appendLedger: writes one JSONL line with a ts + id + the event fields', () => {
  const dataDir = tmpDataDir('vy-ledger-append');
  const line = appendLedger('z1', { engine: 'yield', status: 'ok', tx: '0xaaa', net_usdc: 0.03 }, dataDir);
  assert.ok(line.ts);
  assert.equal(line.id, 'z1');
  assert.equal(line.tx, '0xaaa');
  const rows = readLedger('z1', dataDir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].net_usdc, 0.03);
});

test('realizedPnl: sums net_usdc across lines', () => {
  const dataDir = tmpDataDir('vy-ledger-sum');
  appendLedger('z2', { engine: 'yield', net_usdc: 0.03 }, dataDir);
  appendLedger('z2', { engine: 'polymarket', net_usdc: 1.2 }, dataDir);
  assert.equal(realizedPnl('z2', dataDir), 1.23);
});

test('realizedPnl: falls back to earn_usdc - cost_usdc when net_usdc is absent (redeem.py line shape)', () => {
  const dataDir = tmpDataDir('vy-ledger-fallback');
  appendLedger('z3', { engine: 'polymarket', earn_usdc: 5, cost_usdc: 2 }, dataDir);
  assert.equal(realizedPnl('z3', dataDir), 3);
});

test('realizedPnl: a skip/wait line with no earn/cost/net fields contributes 0, never NaN', () => {
  const dataDir = tmpDataDir('vy-ledger-wait');
  appendLedger('z4', { engine: 'hyperliquid', status: 'wait' }, dataDir);
  assert.equal(realizedPnl('z4', dataDir), 0);
});

test('sumRealized: PURE kernel — sums an in-memory array of already-parsed lines, zero I/O, same math as realizedPnl', () => {
  assert.equal(sumRealized([{ net_usdc: 0.03 }, { net_usdc: 1.2 }]), 1.23);
  assert.equal(sumRealized([{ earn_usdc: 5, cost_usdc: 2 }]), 3);
  assert.equal(sumRealized([{ status: 'wait' }]), 0);
  assert.equal(sumRealized([]), 0);
});

test('appendLedger/readLedger: reject a path-traversal id before any filesystem access (REQ-019, FIND-005 — ledgerPath is a SECOND independent per-id path choke point, reuses wallet.mjs\'s isValidId)', () => {
  const dataDir = tmpDataDir('vy-ledger-traversal');
  assert.throws(() => appendLedger('../../tmp/evil', { engine: 'yield', status: 'skip' }, dataDir), /invalid instance id/);
  assert.throws(() => readLedger('../../tmp/evil', dataDir), /invalid instance id/);
});
