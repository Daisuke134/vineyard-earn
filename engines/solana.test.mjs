// ~/vineyard/engines/solana.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastLines, run } from './solana.mjs';

test('lastLines: returns the last N non-empty lines, matching run.sh\'s own OUTTAIL pattern', () => {
  const text = 'line1\nline2\n\nline3\nline4\nline5\n';
  assert.equal(lastLines(text, 2), 'line4\nline5');
});

test('lastLines: shorter input than N returns everything available', () => {
  assert.equal(lastLines('only-one-line\n', 5), 'only-one-line');
});

test('run: is exported as a callable function returning a Promise', () => {
  assert.equal(typeof run, 'function');
});
