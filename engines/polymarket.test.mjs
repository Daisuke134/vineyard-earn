// ~/vineyard/engines/polymarket.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFundOutput, parseTradeOutput, trade, parseRedeemOutput, redeem } from './polymarket.mjs';

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

// NOTE (deviation from the plan's original Task 9 fixture): the REAL, currently-live
// engines/python/polymarket/place_order.py (adapted from a proven reference implementation's
// already-adversary-fixed script — see the file's own docstring) emits
// {"token_id","amount","order_id","post_result","ok"} — NOT {wallet,side,max_price} as the plan's
// stale snippet assumed. These fixtures match the real script's actual stdout shape.
test('parseTradeOutput: real-shape fixture (single compact JSON line from place_order.py, success)', () => {
  const stdout = JSON.stringify({
    token_id: '123', amount: 1, order_id: 'abc-123',
    post_result: { orderID: 'abc-123', success: true }, ok: true,
  }) + '\n';
  const parsed = parseTradeOutput(stdout);
  assert.equal(parsed.token_id, '123');
  assert.equal(parsed.order_id, 'abc-123');
  assert.equal(parsed.ok, true);
});

test('parseTradeOutput: real-shape fixture (clean failure line, {ok:false,error})', () => {
  const stdout = JSON.stringify({ ok: false, error: 'missing TOKEN_ID' }) + '\n';
  const parsed = parseTradeOutput(stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'missing TOKEN_ID');
});

test('parseTradeOutput: throws on empty stdout', () => {
  assert.throws(() => parseTradeOutput(''), /no output/);
});

test('trade: is exported as a callable async function', () => {
  assert.equal(typeof trade, 'function');
});

test('parseRedeemOutput: real-shape fixture — one compact JSON line per redeemed condition', () => {
  const stdout = [
    'found 1 redeemable condition(s):',
    '  - \'Wimbledon Final\' conditionId=0xc8a0 value=$10.0000 type=standard',
    'pUSD before: 4.95',
    'redeeming 0xc8a0 (\'Wimbledon Final\') ...',
    '  tx=0xdeadbeef status=0x1',
    'pUSD after: 14.95  (recovered: 10.0)',
    JSON.stringify({ conditionId: '0xc8a0', title: 'Wimbledon Final', tx_hash: '0xdeadbeef', status: '0x1', line: { earn_usdc: 10, cost_usdc: 3.55 } }),
  ].join('\n');
  const rows = parseRedeemOutput(stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tx_hash, '0xdeadbeef');
  assert.equal(rows[0].line.earn_usdc, 10);
});

test('parseRedeemOutput: "nothing to redeem" produces an empty array, not an error', () => {
  const stdout = 'no redeemable conditions found — nothing to do\n';
  assert.deepEqual(parseRedeemOutput(stdout), []);
});

test('redeem: is exported as a callable async function', () => {
  assert.equal(typeof redeem, 'function');
});
