// ~/vineyard/core/brain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEngine } from './brain.mjs';

test('pickEngine: with no history, picks the first candidate deterministically', () => {
  const picked = pickEngine({ lastRun: {}, candidates: ['yield', 'solana', 'polymarket-redeem'] });
  assert.equal(picked, 'yield');
});

test('pickEngine: picks whichever candidate ran longest ago (or never)', () => {
  const now = Date.now();
  const picked = pickEngine({
    lastRun: { yield: now - 1000, solana: now - 500, 'polymarket-redeem': now - 5000 },
    candidates: ['yield', 'solana', 'polymarket-redeem'],
  });
  assert.equal(picked, 'polymarket-redeem');
});

test('pickEngine: default candidate list is the 3 automatic engines (yield/solana/polymarket-redeem)', () => {
  const picked = pickEngine({});
  assert.ok(['yield', 'solana', 'polymarket-redeem'].includes(picked));
});

test('pickEngine: empty candidate list returns null, never throws', () => {
  assert.doesNotThrow(() => {
    assert.equal(pickEngine({ candidates: [] }), null);
  });
});
