// ~/vineyard/engines/cost-basis.test.mjs  (co-located test for engines/lib/cost-basis.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCostBasis, recordDeposit, recordWithdraw, seedIfEmpty, applyDelta } from './lib/cost-basis.mjs';

function tmpFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(dir, 'cost-basis.json');
}

test('readCostBasis: empty object when file does not exist', () => {
  assert.deepEqual(readCostBasis(tmpFile('vy-cb-empty')), {});
});

test('recordDeposit: increments the venue basis and persists it', () => {
  const file = tmpFile('vy-cb-deposit');
  recordDeposit('fluid', 3.5, file);
  assert.equal(readCostBasis(file).fluid, 3.5);
});

test('recordWithdraw: decrements but floors at 0 (never negative)', () => {
  const file = tmpFile('vy-cb-withdraw');
  recordDeposit('beefy', 2, file);
  recordWithdraw('beefy', 10, file);
  assert.equal(readCostBasis(file).beefy, 0);
});

test('seedIfEmpty: only sets venues not already tracked', () => {
  const file = tmpFile('vy-cb-seed');
  recordDeposit('aave', 1, file);
  seedIfEmpty({ aave: 999, fluid: 5 }, file);
  const basis = readCostBasis(file);
  assert.equal(basis.aave, 1); // untouched — already tracked
  assert.equal(basis.fluid, 5); // seeded — was empty
});

test('two different files (two instances) never mix state', () => {
  const fileA = tmpFile('vy-cb-a');
  const fileB = tmpFile('vy-cb-b');
  recordDeposit('fluid', 7, fileA);
  assert.equal(readCostBasis(fileB).fluid, undefined);
});

test('applyDelta: PURE kernel — returns a NEW object with venue adjusted and floored at 0, never mutates the input, zero I/O', () => {
  const input = Object.freeze({ fluid: 2 });
  const afterWithdrawTooMuch = applyDelta(input, 'fluid', -10);
  assert.equal(afterWithdrawTooMuch.fluid, 0); // floored at 0, never negative
  assert.equal(input.fluid, 2); // input object itself is untouched
  const afterDeposit = applyDelta(input, 'aave', 1.5);
  assert.equal(afterDeposit.aave, 1.5);
  assert.equal(afterDeposit.fluid, 2); // other venues preserved
});
