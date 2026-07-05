// ~/vineyard/core/wallet.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { generateWallet, instanceDir, vineyardHome } from './wallet.mjs';

function tmpHome(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return dir;
}

test('vineyardHome: defaults to $HOME/.vineyard when VINEYARD_HOME unset', () => {
  const h = vineyardHome({ HOME: '/fake/home' });
  assert.equal(h, '/fake/home/.vineyard');
});

test('vineyardHome: VINEYARD_HOME override wins', () => {
  const h = vineyardHome({ HOME: '/fake/home', VINEYARD_HOME: '/custom/dir' });
  assert.equal(h, '/custom/dir');
});

test('generateWallet: creates wallet.json + solana.json under instances/<id>/', () => {
  const home = tmpHome('vy-wallet');
  const env = { VINEYARD_HOME: home };
  const result = generateWallet('alpha', env);
  assert.match(result.evm.address, /^0x[0-9a-fA-F]{40}$/);
  assert.ok(result.solana.address.length > 0);
  const dir = instanceDir('alpha', env);
  assert.ok(fs.existsSync(path.join(dir, 'wallet.json')));
  assert.ok(fs.existsSync(path.join(dir, 'solana.json')));
});

test('generateWallet: idempotent — re-spawning the same id preserves its original identity', () => {
  const home = tmpHome('vy-wallet-idem');
  const env = { VINEYARD_HOME: home };
  const first = generateWallet('beta', env);
  const second = generateWallet('beta', env);
  assert.equal(first.evm.address, second.evm.address);
  assert.equal(first.solana.address, second.solana.address);
});

test('generateWallet: two different ids get two different wallets', () => {
  const home = tmpHome('vy-wallet-diff');
  const env = { VINEYARD_HOME: home };
  const a = generateWallet('id-a', env);
  const b = generateWallet('id-b', env);
  assert.notEqual(a.evm.address, b.evm.address);
  assert.notEqual(a.solana.address, b.solana.address);
});

// --- overrideKeys: the ONLY bring-your-own-key path (REQ-003) — id-scoped, spawn-time only ---

test('generateWallet: overrideKeys.evmPrivateKey seeds a fresh id\'s wallet.json instead of generating a random key', () => {
  const home = tmpHome('vy-wallet-override-evm');
  const env = { VINEYARD_HOME: home };
  const suppliedPk = generatePrivateKey(); // stands in for an operator's own pre-funded key
  const result = generateWallet('gamma', env, { evmPrivateKey: suppliedPk });
  assert.equal(result.evm.address, privateKeyToAccount(suppliedPk).address);
  const raw = JSON.parse(fs.readFileSync(path.join(instanceDir('gamma', env), 'wallet.json'), 'utf8'));
  assert.equal(raw.privateKey, suppliedPk);
});

test('generateWallet: overrideKeys.solanaSecretKey seeds a fresh id\'s solana.json instead of generating a random key', () => {
  const home = tmpHome('vy-wallet-override-sol');
  const env = { VINEYARD_HOME: home };
  const donor = generateWallet('donor-throwaway', env); // a real generated key, reused as a stand-in "operator's own key"
  const donorSecret = JSON.parse(fs.readFileSync(path.join(instanceDir('donor-throwaway', env), 'solana.json'), 'utf8')).secretKey;
  const result = generateWallet('epsilon', env, { solanaSecretKey: donorSecret });
  assert.equal(result.solana.address, donor.solana.address);
});

test('generateWallet: overrideKeys is IGNORED once wallet.json/solana.json already exist for the id — an existing instance\'s identity can never be swapped out from under it', () => {
  const home = tmpHome('vy-wallet-override-ignore');
  const env = { VINEYARD_HOME: home };
  const first = generateWallet('zeta', env); // real first spawn, generates its own keys
  const attemptedSwap = generateWallet('zeta', env, {
    evmPrivateKey: generatePrivateKey(),
    solanaSecretKey: 'not-even-checked-because-it-must-be-ignored',
  });
  assert.equal(attemptedSwap.evm.address, first.evm.address, 're-spawn must ignore overrideKeys.evmPrivateKey once identity already exists');
  assert.equal(attemptedSwap.solana.address, first.solana.address, 're-spawn must ignore overrideKeys.solanaSecretKey once identity already exists');
});
