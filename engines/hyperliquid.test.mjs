// ~/vineyard/engines/hyperliquid.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHlOutput, account, market, open, close } from './hyperliquid.mjs';

test('parseHlOutput: parses hl.py\'s pretty-printed (indent=2) account output', () => {
  const stdout = JSON.stringify({ address: '0xabc', account_value_usd: 5.1234, withdrawable_usd: 5.1, open_positions: [] }, null, 2) + '\n';
  const parsed = parseHlOutput(stdout);
  assert.equal(parsed.address, '0xabc');
  assert.equal(parsed.account_value_usd, 5.1234);
});

test('parseHlOutput: parses hl.py\'s market output shape (real fixture from cmd_market)', () => {
  const stdout = JSON.stringify({ coin: 'ETH', price: 3400.5, max_leverage: 25, closes_hourly: [3390, 3395, 3400.5], change_pct_window: 0.31 }, null, 2);
  const parsed = parseHlOutput(stdout);
  assert.equal(parsed.coin, 'ETH');
  assert.equal(parsed.change_pct_window, 0.31);
});

test('parseHlOutput: parses hl.py\'s open output shape', () => {
  const stdout = JSON.stringify({ opened: 'long', coin: 'ETH', entry: 3400, size: 0.0035, leverage: 2, stop_loss: 3264, take_profit: 3672 }, null, 2);
  const parsed = parseHlOutput(stdout);
  assert.equal(parsed.opened, 'long');
});

test('parseHlOutput: parses hl.py\'s "skipped" (already-open) output shape', () => {
  const stdout = JSON.stringify({ skipped: 'position already open on ETH', szi: '0.0035' }, null, 2);
  const parsed = parseHlOutput(stdout);
  assert.equal(parsed.skipped, 'position already open on ETH');
});

test('account/market/open/close: are all exported as callable async functions', () => {
  assert.equal(typeof account, 'function');
  assert.equal(typeof market, 'function');
  assert.equal(typeof open, 'function');
  assert.equal(typeof close, 'function');
});
