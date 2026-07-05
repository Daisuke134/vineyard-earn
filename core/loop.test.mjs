// ~/vineyard/core/loop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOnce } from './loop.mjs';
import { generateWallet } from './wallet.mjs';
import { readLedger } from './ledger.mjs';
import { registerSpawn, updateSpawn } from './registry.mjs';

function tmpAll(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-home-`));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-data-`));
  return { home, dataDir };
}

test('runOnce: no wallet yet for the picked engine -> writes a skip ledger line, never throws', async () => {
  const { home, dataDir } = tmpAll('vy-loop-noskey');
  const env = { VINEYARD_HOME: home };
  await assert.doesNotReject(async () => {
    const line = await runOnce({ id: 'unspawned-id', dataDir, env, engines: { yield: {}, solana: {}, polymarket: {} }, candidates: ['yield'] });
    assert.equal(line.status, 'skip');
    assert.equal(line.reason, 'no-evm-key');
  });
});

test('runOnce: with a spawned wallet, calls the picked engine\'s run() and records its result', async () => {
  const { home, dataDir } = tmpAll('vy-loop-withkey');
  const env = { VINEYARD_HOME: home };
  generateWallet('spawned-id', env);
  let called = null;
  const fakeYield = { run: async (args) => { called = args; return { kind: 'yield', action: 'hold', liquid_usdc: 3 }; } };
  const line = await runOnce({ id: 'spawned-id', dataDir, env, engines: { yield: fakeYield, solana: {}, polymarket: {} }, candidates: ['yield'] });
  assert.equal(line.engine, 'yield');
  assert.equal(line.action, 'hold');
  assert.ok(called.evmPrivateKey.startsWith('0x'));
  const rows = readLedger('spawned-id', dataDir);
  assert.equal(rows.length, 1);
});

test('runOnce: polymarket-redeem engine result (an array) is normalized into one ledger line with summed net_usdc', async () => {
  const { home, dataDir } = tmpAll('vy-loop-redeem');
  const env = { VINEYARD_HOME: home };
  const wallet = generateWallet('redeem-id', env);
  // findSpawn(id, env) reads the SHARED registry (vineyardHome()/spawns.json), which env.HOME alone
  // does not scope the same way instanceDir() does — registerSpawn()/updateSpawn() default to
  // process.env, so pass `env` through explicitly here to land the row under this test's own tmp
  // VINEYARD_HOME rather than the real one.
  registerSpawn({ id: 'redeem-id', evm: wallet.evm, solana: wallet.solana }, env);
  // polymarketDepositWallet is populated for real once Task 15's `fund` verb succeeds (Task 8's
  // fund_via_bridge.py returns deposit_wallet) — simulated here since this test never calls fund().
  updateSpawn('redeem-id', { polymarketDepositWallet: '0x904B50d2e214Da947d83D6a2D32c4E3Ffc17Eb74' }, env);
  const fakePolymarket = {
    redeem: async () => ([
      { tx_hash: '0xaaa', line: { earn_usdc: 10, cost_usdc: 3 } },
      { tx_hash: '0xbbb', line: { earn_usdc: 5, cost_usdc: 5 } },
    ]),
  };
  const line = await runOnce({ id: 'redeem-id', dataDir, env, engines: { yield: {}, solana: {}, polymarket: fakePolymarket }, candidates: ['polymarket-redeem'] });
  assert.equal(line.engine, 'polymarket-redeem');
  assert.equal(line.net_usdc, 7); // (10-3) + (5-5)
  assert.deepEqual(line.tx, ['0xaaa', '0xbbb']);
});
