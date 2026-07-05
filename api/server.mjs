// ~/vineyard/api/server.mjs — Express REST, same verbs as the CLI (spec §4).
import express from 'express';
import crypto from 'node:crypto';
import { generateWallet, isValidId } from '../core/wallet.mjs';
import { registerSpawn, readRegistry, findSpawn } from '../core/registry.mjs';

const app = express();
app.use(express.json());

// REQ-019/FIND-005: `id` is caller-controlled and is used as a filesystem path segment inside
// core/wallet.mjs's instanceDir()/core/ledger.mjs's ledgerPath() — both now throw for an invalid id.
// Several routes below are ASYNC Express 4 handlers; a synchronous throw inside an async handler
// becomes an UNHANDLED PROMISE REJECTION (Express 4 does not await/catch a handler's returned
// promise) rather than a clean HTTP error — left unguarded this would be a new crash/DoS vector
// introduced by the id-validation fix itself. This middleware validates `id` up front, BEFORE any
// handler runs, so an invalid id always returns a clean 400 and never reaches a throwing function.
function requireValidId(req, res, next) {
  const id = req.body?.id ?? req.params?.id;
  if (id !== undefined && !isValidId(id)) {
    return res.status(400).json({ error: 'invalid instance id' });
  }
  next();
}

// REQ-020/FIND-006: money-moving routes (/fund, /trade, /redeem) require this bearer token. There is
// intentionally NO default — an unset VINEYARD_API_KEY refuses to start the server at all (below),
// so a deployment can never accidentally go live unauthenticated.
const API_KEY = process.env.VINEYARD_API_KEY;

// REQ-020/FIND-006: constant-time comparison — `===` on the raw header would be a timing
// side-channel on the key itself. Falls back to `false` (never throws) on a length mismatch, since
// crypto.timingSafeEqual() requires equal-length buffers.
function requireApiKey(req, res, next) {
  const header = req.headers.authorization || '';
  const expected = `Bearer ${API_KEY}`;
  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  const authorized = headerBuf.length === expectedBuf.length && crypto.timingSafeEqual(headerBuf, expectedBuf);
  if (!authorized) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/spawn', requireValidId, (req, res) => {
  const id = req.body?.id || crypto.randomBytes(4).toString('hex');
  // body.key/body.solanaKey are the ONLY bring-your-own-key path (REQ-003) — id-scoped, spawn-time
  // only. generateWallet() silently ignores these if wallet.json/solana.json already exists for `id`.
  const wallet = generateWallet(id, process.env, { evmPrivateKey: req.body?.key, solanaSecretKey: req.body?.solanaKey });
  const row = registerSpawn({
    id,
    evm: wallet.evm.address,
    solana: wallet.solana.address,
    fund: Number(req.body?.fund || 0),
    engine: req.body?.engine || null,
  });
  res.status(201).json(row);
});

app.get('/list', (_req, res) => {
  res.json(readRegistry());
});

app.get('/status/:id', requireValidId, (req, res) => {
  const row = findSpawn(req.params.id);
  if (!row) return res.status(404).json({ error: 'unknown id' });
  res.json(row);
});

const PORT = process.env.PORT || 3000;
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  // REQ-020/FIND-006: fail-closed by design — a deployment must not go live with real-money routes
  // (/fund, /trade, /redeem) unauthenticated. /spawn, /list, /status stay deliberately unauthenticated
  // (see REQ-020) so this refusal is solely about the money-moving surface, not the whole server.
  if (!API_KEY) {
    console.error('VINEYARD_API_KEY is not set — refusing to start the API server with money-moving routes unauthenticated');
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`vineyard API listening on :${PORT}`));
}

export default app;
