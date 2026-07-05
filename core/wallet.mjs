// ~/vineyard/core/wallet.mjs — per-instance key isolation. Ported from a proven reference
// key-resolution implementation (function names/priority-order pattern kept close), with the
// original's legacy-shared-wallet back-compat branch intentionally dropped — a fresh repo has no
// such convention to honor. Fail-closed everywhere: any missing/malformed file returns null, this
// module never throws.
//
// KEY ISOLATION (REQ-003): there is NO ambient/global env-var override for key resolution. A
// persistent process (api/server.mjs) serves MANY instance ids over its lifetime — a global env
// override would resolve to the SAME key for every id, which is exactly the cross-instance leak this
// module exists to prevent. The ONLY way an operator's own pre-funded key ever enters the system is
// the explicit, id-scoped `overrideKeys` param to `generateWallet()` at spawn time (below), which is
// written into exactly that one id's own wallet.json/solana.json and never read from process.env again.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export function vineyardHome(env = process.env) {
  return env.VINEYARD_HOME || path.join(env.HOME || process.cwd(), '.vineyard');
}

// SECURITY (REQ-019): `id` is fully caller-controlled (CLI --id, POST /spawn {id}) and is used
// directly as a filesystem path segment below — an unvalidated id like "../../etc" would let
// instanceDir() resolve OUTSIDE <VINEYARD_HOME>/instances/, an arbitrary-file-write vector. This is
// the ONE choke point every function in this file that builds a per-id path (generateWallet,
// resolveEvmPrivateKey, resolveSolanaSecret, resolveAddresses) already routes through, so validating
// here protects all of them without needing to remember to validate at every call site.
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function instanceDir(id, env = process.env) {
  if (!isValidId(id)) {
    throw new Error(`invalid instance id: ${JSON.stringify(id)}`);
  }
  return path.join(vineyardHome(env), 'instances', id);
}

function readJsonField(filePath, field) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const value = parsed && parsed[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function normalizeEvmKey(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  return key.startsWith('0x') ? key : `0x${key}`;
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf) {
  const digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of buf) {
    if (byte === 0) out += '1';
    else break;
  }
  return out + digits.reverse().map((d) => B58_ALPHABET[d]).join('');
}

/** Inverse of base58() — decodes a base58 string back to a Buffer. Returns null on invalid input. */
function base58Decode(str) {
  if (typeof str !== 'string' || str.length === 0) return null;
  let bytes = [0];
  for (const char of str) {
    const value = B58_ALPHABET.indexOf(char);
    if (value === -1) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of str) {
    if (char === '1') bytes.push(0);
    else break;
  }
  return Buffer.from(bytes.reverse());
}

/**
 * Validate a caller-supplied Solana secret key: base58, the SAME 64-byte seed+pubkey wire format
 * generateWallet() itself produces (the standard Keypair.secretKey shape). Returns
 * {address, secretKey, secretKeyBytes} or null if the input does not decode to exactly 64 bytes.
 */
function normalizeSolanaSecret(base58Secret) {
  const decoded = base58Decode(base58Secret);
  if (!decoded || decoded.length !== 64) return null;
  const pub = decoded.subarray(32);
  return { address: base58(pub), secretKey: base58Secret, secretKeyBytes: [...decoded] };
}

/**
 * Generate (or return the existing) EVM + Solana keypair for instance `id`, persisted under
 * <VINEYARD_HOME>/instances/<id>/{wallet.json,solana.json}, chmod 600. Idempotent.
 *
 * `overrideKeys` (optional) is the ONLY bring-your-own-key path (REQ-003) — it is scoped to exactly
 * this one `id` and is silently IGNORED if wallet.json/solana.json already exists (a re-spawn of an
 * existing id can never have its identity swapped out from under it):
 *   - `overrideKeys.evmPrivateKey` (0x-prefixed or bare hex) written into wallet.json instead of
 *     generating a fresh key.
 *   - `overrideKeys.solanaSecretKey` (base58, 64-byte seed+pubkey format) written into solana.json
 *     instead of generating a fresh key; invalid input is ignored and a fresh key is generated instead.
 * @returns {{id: string, evm: {address: string}, solana: {address: string}}}
 */
export function generateWallet(id, env = process.env, overrideKeys = {}) {
  const dir = instanceDir(id, env);
  fs.mkdirSync(dir, { recursive: true });

  const walletPath = path.join(dir, 'wallet.json');
  let evm;
  if (fs.existsSync(walletPath)) {
    evm = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  } else {
    const suppliedKey = normalizeEvmKey(overrideKeys.evmPrivateKey);
    const pk = suppliedKey || generatePrivateKey();
    evm = { privateKey: pk, address: privateKeyToAccount(pk).address };
    fs.writeFileSync(walletPath, JSON.stringify(evm, null, 2));
    fs.chmodSync(walletPath, 0o600);
  }

  const solPath = path.join(dir, 'solana.json');
  let solana;
  if (fs.existsSync(solPath)) {
    solana = JSON.parse(fs.readFileSync(solPath, 'utf8'));
  } else {
    const supplied = normalizeSolanaSecret(overrideKeys.solanaSecretKey);
    if (supplied) {
      solana = supplied;
    } else {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
      const seed = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
      const secret = Buffer.concat([seed, pub]);
      solana = { address: base58(pub), secretKey: base58(secret), secretKeyBytes: [...secret] };
    }
    fs.writeFileSync(solPath, JSON.stringify(solana, null, 2));
    fs.chmodSync(solPath, 0o600);
  }

  return { id, evm: { address: evm.address }, solana: { address: solana.address } };
}

/**
 * Resolve instance `id`'s OWN EVM private key. Fail-closed: null if `id` has no wallet.json yet
 * or the file is malformed. NEVER reads another instance's directory and NEVER consults any
 * ambient/global env var — this IS the key-isolation boundary (REQ-003). The only way a key other
 * than a freshly-generated one enters the system is generateWallet()'s id-scoped `overrideKeys`
 * param at spawn time, which is already persisted in this exact id's own wallet.json by the time
 * this function runs — there is no second, parallel env-var path.
 */
export function resolveEvmPrivateKey(id, env = process.env) {
  return readJsonField(path.join(instanceDir(id, env), 'wallet.json'), 'privateKey');
}

export function resolveSolanaSecret(id, env = process.env) {
  return readJsonField(path.join(instanceDir(id, env), 'solana.json'), 'secretKey');
}

/** Addresses only — safe to log/return over HTTP. Never returns key material. */
export function resolveAddresses(id, env = process.env) {
  const dir = instanceDir(id, env);
  return {
    evm: readJsonField(path.join(dir, 'wallet.json'), 'address'),
    solana: readJsonField(path.join(dir, 'solana.json'), 'address'),
  };
}
