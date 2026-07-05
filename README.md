# Vineyard

**AI financial independence, machine-readable.** `git clone` + one command → spawn a self-funded AI
instance: it owns its own EVM + Solana wallet, with per-instance key isolation so no instance can ever
sign or spend with another instance's key. Built for the YC RFS "Software for Agents" (Aaron Epstein):
an agent-first, machine-readable earning layer — CLI + REST API + `llms.txt`, no MCP required.

Every "hundreds of AI agents earning" story starts here: **an agent that can be born with its own money,
with no human touching its keys.** That's what this repo proves today.

## Quickstart

```bash
git clone https://github.com/Daisuke134/vineyard-earn && cd vineyard-earn
npm install
node cli/index.mjs spawn --fund 10   # spawns an instance: own EVM + Solana wallet, prints its address
node cli/index.mjs list              # shows every spawned instance
```

Example output of `spawn`:

```json
{
  "id": "a286552c",
  "evm": "0xb1a6f2ad1c5412Aed58AE3E7E4F232D33662fF8B",
  "solana": "4oW6ZiRv5AQVpLUTnWHyPKsUpDZqppBsHZmNSGEfeJHE",
  "fund": 10,
  "engine": null,
  "created": "2026-07-05T07:40:10.126Z"
}
```

By default state lives under `~/.vineyard/` (override with `VINEYARD_HOME=/path`).

## What's real today (honest status — no dry runs, no fabricated claims)

| Capability | Status |
|---|---|
| Per-instance EVM + Solana wallet generation (`spawn`) | **Working, tested** — 8 tests |
| Fail-closed key isolation (an instance can never resolve/sign with another's key) | **Working, tested** — an explicit adversarial test suite proves it, including a regression test that an ambient env-var override (a real vulnerability class we found and closed) has zero effect on any instance's resolved key |
| Path-traversal guard on instance ids (`../../etc` etc. rejected before any filesystem write) | **Working, tested** |
| `spawns.json` registry (`list`) | **Working, tested** — 5 tests |
| Bring-your-own-key at spawn time (`--key`/`--solana-key`, scoped to exactly one instance) | **Working, tested** |
| Polymarket / yield / Hyperliquid / Solana earning engines | **In progress** — not yet wired into this repo. The underlying trading logic is proven and running in the parent [Anicca](https://github.com/Daisuke134/anicca) project; porting it here (as isolated, per-instance wrappers) is the immediate next step |
| `fund`/`run`/`trade`/`redeem`/`dashboard` CLI verbs, REST API, `llms.txt` | **In progress** — designed (see `docs/` in the design history) but not yet implemented in this repo |

**Test suite**: `npm test` runs 21 tests across `core/wallet.test.mjs` (16) and `core/registry.test.mjs` (5),
all passing.

## Why key isolation is the point

An AI that earns money needs its own wallet. An AI that earns money **safely, at scale — hundreds of
instances — needs a wallet that structurally cannot leak into another instance's hands.** That's the
one property this repo is built around first, before any trading logic: `core/wallet.mjs`'s
`resolveEvmPrivateKey(id)`/`resolveSolanaSecret(id)` read ONLY the file scoped to `id`, never a shared or
ambient credential, and `instanceDir(id)` validates `id` before it ever touches the filesystem.

## License

MIT.
