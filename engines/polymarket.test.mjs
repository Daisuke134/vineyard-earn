// ~/vineyard/engines/polymarket.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFundOutput } from './polymarket.mjs';

test('parseFundOutput: already-registered branch (real fixture from fund_via_bridge.py main())', () => {
  const stdout = '[fund_via_bridge] EOA=0xabc deposit=0xdef\n' + JSON.stringify({ deposit_wallet: '0xdef', registered: true, already: true }) + '\n';
  const parsed = parseFundOutput(stdout);
  assert.equal(parsed.registered, true);
  assert.equal(parsed.already, true);
  assert.equal(parsed.deposit_wallet, '0xdef');
});

test('parseFundOutput: fresh-registration branch (real fixture shape with bridge_address + balance_usdc)', () => {
  const stdout = [
    '[fund_via_bridge] EOA=0xabc deposit=0xdef',
    '[fund_via_bridge] bridge EVM=0x999',
    '[fund_via_bridge] sent $2 pUSD through bridge, waiting for onramp…',
    JSON.stringify({ deposit_wallet: '0xdef', bridge_address: '0x999', registered: true, balance_usdc: 1.98 }),
    '',
  ].join('\n');
  const parsed = parseFundOutput(stdout);
  assert.equal(parsed.registered, true);
  assert.equal(parsed.balance_usdc, 1.98);
});

test('parseFundOutput: throws a clear error on empty stdout rather than returning undefined', () => {
  assert.throws(() => parseFundOutput(''), /no output/);
});
