// ~/vineyard/engines/yield.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './yield.mjs';

test('run: fail-closed when evmPrivateKey is null/absent — returns {abort:"no wallet key"}, never throws', async () => {
  const result = await run({ evmPrivateKey: null });
  assert.equal(result.abort, 'no wallet key');
});
