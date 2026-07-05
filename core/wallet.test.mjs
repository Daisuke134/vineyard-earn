// ~/vineyard/core/wallet.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { generateWallet, instanceDir, vineyardHome, isValidId } from './wallet.mjs';

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

// --- Task 3: fail-closed key isolation (adversary-grade) ---

import { resolveEvmPrivateKey, resolveSolanaSecret } from './wallet.mjs';

test('FAIL-CLOSED: instance B has no wallet yet -> resolveEvmPrivateKey(B) is null, never throws, never falls back to A', () => {
  const home = tmpHome('vy-isolate-evm');
  const env = { VINEYARD_HOME: home };
  const a = generateWallet('instance-a', env); // only A is spawned
  assert.notEqual(a.evm.address, null);
  assert.doesNotThrow(() => {
    const keyForB = resolveEvmPrivateKey('instance-b', env);
    assert.equal(keyForB, null, 'instance B must never resolve a key it has not been given');
  });
});

test('FAIL-CLOSED: instance B has no wallet yet -> resolveSolanaSecret(B) is null, never throws, never falls back to A', () => {
  const home = tmpHome('vy-isolate-sol');
  const env = { VINEYARD_HOME: home };
  generateWallet('instance-a', env);
  assert.doesNotThrow(() => {
    assert.equal(resolveSolanaSecret('instance-b', env), null);
  });
});

test('ISOLATION: A and B both spawned -> resolveEvmPrivateKey(A) never equals resolveEvmPrivateKey(B), and each resolves ONLY its own key', () => {
  const home = tmpHome('vy-isolate-both');
  const env = { VINEYARD_HOME: home };
  const a = generateWallet('instance-a', env);
  const b = generateWallet('instance-b', env);
  const keyA = resolveEvmPrivateKey('instance-a', env);
  const keyB = resolveEvmPrivateKey('instance-b', env);
  assert.notEqual(keyA, keyB);
  assert.equal(privateKeyToAccountAddress(keyA), a.evm.address);
  assert.equal(privateKeyToAccountAddress(keyB), b.evm.address);
});

test('REGRESSION: setting env.VINEYARD_EVM_PRIVATE_KEY on the process has ZERO effect on resolveEvmPrivateKey for ANY id (the ambient-override footgun is structurally gone, not just removed by convention)', () => {
  const home = tmpHome('vy-isolate-noambient-evm');
  const envClean = { VINEYARD_HOME: home };
  const a = generateWallet('instance-a', envClean);
  const keyWithoutAmbient = resolveEvmPrivateKey('instance-a', envClean);
  const envWithAmbient = {
    VINEYARD_HOME: home,
    VINEYARD_EVM_PRIVATE_KEY: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
  };
  const keyWithAmbient = resolveEvmPrivateKey('instance-a', envWithAmbient);
  assert.equal(keyWithAmbient, keyWithoutAmbient, 'an ambient env var must never change the resolved key for an EXISTING id');
  assert.equal(privateKeyToAccountAddress(keyWithAmbient), a.evm.address);
  // and for an id that was never spawned — the ambient var must not "fill in" a key either
  assert.equal(resolveEvmPrivateKey('instance-never-spawned', envWithAmbient), null);
});

test('REGRESSION: setting env.VINEYARD_SOLANA_PRIVATE_KEY on the process has ZERO effect on resolveSolanaSecret for ANY id', () => {
  const home = tmpHome('vy-isolate-noambient-sol');
  const envClean = { VINEYARD_HOME: home };
  generateWallet('instance-a', envClean);
  const secretWithoutAmbient = resolveSolanaSecret('instance-a', envClean);
  const envWithAmbient = { VINEYARD_HOME: home, VINEYARD_SOLANA_PRIVATE_KEY: 'fakeAmbientSolanaSecretThatMustNeverBeReturned' };
  const secretWithAmbient = resolveSolanaSecret('instance-a', envWithAmbient);
  assert.equal(secretWithAmbient, secretWithoutAmbient, 'an ambient env var must never change the resolved secret for an EXISTING id');
  assert.equal(resolveSolanaSecret('instance-never-spawned', envWithAmbient), null);
});

function privateKeyToAccountAddress(pk) {
  // local re-derivation via viem, independent of wallet.mjs's own generation path, so this test does
  // not just trust wallet.mjs's own bookkeeping.
  return privateKeyToAccount(pk).address;
}

// --- isValidId / instanceDir: path-traversal / arbitrary-file-write guard (REQ-019, FIND-005) ---

test('isValidId: rejects path-traversal and other unsafe id shapes', () => {
  assert.equal(isValidId('../etc'), false);
  assert.equal(isValidId('a/b'), false);
  assert.equal(isValidId('.'), false);
  assert.equal(isValidId('..'), false);
  assert.equal(isValidId(''), false);
  assert.equal(isValidId('a'.repeat(65)), false, '65 chars exceeds the 64-char cap');
  assert.equal(isValidId('-leading-dash'), false);
  assert.equal(isValidId('_leading-underscore'), false);
  assert.equal(isValidId('has/slash'), false);
  assert.equal(isValidId('has\\backslash'), false);
  assert.equal(isValidId('has\0null'), false);
});

test("isValidId: accepts safe ids, including the real newId() shape (crypto.randomBytes(4).toString('hex'))", () => {
  assert.equal(isValidId('alpha'), true);
  assert.equal(isValidId('instance-a'), true);
  assert.equal(isValidId('a1b2c3d4'), true);
  assert.equal(isValidId('a_b-c9'), true);
});

test('instanceDir: throws for a path-traversal id BEFORE any filesystem access — nothing is created at the unsafe resolved path', () => {
  const home = tmpHome('vy-traversal');
  const env = { VINEYARD_HOME: home };
  const unsafeResolved = path.join(home, 'instances', '../../tmp/evil');
  assert.throws(() => instanceDir('../../tmp/evil', env), /invalid instance id/);
  assert.equal(fs.existsSync(unsafeResolved), false, 'instanceDir must throw before ever touching the filesystem');
});
