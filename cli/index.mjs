#!/usr/bin/env node
// ~/vineyard/cli/index.mjs — `vineyard <cmd>` dispatcher (spec §4).
import crypto from 'node:crypto';
import { generateWallet } from '../core/wallet.mjs';
import { registerSpawn, readRegistry } from '../core/registry.mjs';

const [, , cmd, ...rest] = process.argv;

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function cmdSpawn(args) {
  const { flags } = parseFlags(args);
  const id = flags.id || newId();
  // --key/--solana-key are the ONLY bring-your-own-key path (REQ-003) — id-scoped, spawn-time only.
  // generateWallet() silently ignores these if wallet.json/solana.json already exists for `id`.
  // REQ-019/FIND-005: an invalid --id (e.g. containing "../") makes instanceDir() throw inside
  // generateWallet() below — that throw propagates up through this async function to main()'s
  // top-level `.catch()` (bottom of this file), which already prints the message to stderr and sets
  // a non-zero exit code, so an invalid --id is a clean, documented CLI failure, never an unhandled
  // crash — no separate try/catch is needed here.
  const wallet = generateWallet(id, process.env, { evmPrivateKey: flags.key, solanaSecretKey: flags['solana-key'] });
  const row = registerSpawn({
    id,
    evm: wallet.evm.address,
    solana: wallet.solana.address,
    fund: Number(flags.fund || 0),
    engine: flags.engine || null,
  });
  console.log(JSON.stringify(row, null, 2));
  return row;
}

async function cmdList() {
  console.log(JSON.stringify(readRegistry(), null, 2));
}

// Commands that are designed (spec §4) but not yet implemented in this repo — listed explicitly so
// `vineyard fund` gives an honest "not implemented yet" message instead of being silently
// indistinguishable from a typo'd/unknown command.
const NOT_YET_IMPLEMENTED = ['fund', 'run', 'status', 'trade', 'redeem', 'dashboard'];

async function main() {
  switch (cmd) {
    case 'spawn':
      await cmdSpawn(rest);
      break;
    case 'list':
      await cmdList();
      break;
    default:
      if (NOT_YET_IMPLEMENTED.includes(cmd)) {
        console.error(`vineyard ${cmd}: not implemented yet (see README "What's real today")`);
      } else {
        console.error('usage: vineyard <spawn|list> [...args]  (fund|run|status|trade|redeem|dashboard: not yet implemented)');
      }
      process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exitCode = 1;
});
