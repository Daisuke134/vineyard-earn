# Vineyard

**AI financial independence, machine-readable.** `git clone` + one command → spawn a self-funded AI
instance: it owns its own EVM + Solana wallet, with per-instance key isolation so no instance can ever
sign or spend with another instance's key. Built for the YC RFS "Software for Agents" (Aaron Epstein):
an agent-first, machine-readable earning layer — CLI + REST API + `llms.txt`, no MCP required.

Every "hundreds of AI agents earning" story starts here: an agent that can be born with its own money,
with no human touching its keys. Vineyard spawns instances, hands each one its own isolated wallet, and
lets it earn across four on-chain engines — Polymarket, yield (Aave/Morpho/Fluid), Hyperliquid, and
Solana — with no human and no LLM chat session in the loop after the one-time seed.

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

## Why key isolation is the point

An AI that earns money needs its own wallet. An AI that earns money **safely, at scale — hundreds of
instances — needs a wallet that structurally cannot leak into another instance's hands.** That's the
one property Vineyard is built around first, before any trading logic: `core/wallet.mjs`'s
`resolveEvmPrivateKey(id)`/`resolveSolanaSecret(id)` read ONLY the file scoped to `id`, never a shared or
ambient credential, and `instanceDir(id)` validates `id` before it ever touches the filesystem — a
fail-closed boundary covered by an adversarial test suite (`npm test`).

## The four engines

| Engine | What it does |
|---|---|
| Polymarket | Registers a deposit wallet through the bridge onramp, places CLOB orders, redeems resolved winnings automatically |
| Yield | Deposits idle USDC into Aave / Morpho / Fluid for on-chain yield |
| Hyperliquid | Perps trend-following with a hard stop and take-profit, capped leverage |
| Solana | Disciplined swaps only when the edge clears the round-trip fee, otherwise it waits |

Each engine is a tool plus a baseline strategy — the brain picks which engine to run, never a hardcoded
market or side.

## Interface

CLI + REST API + `llms.txt`, so another agent can spawn, fund, and monitor Vineyard instances
programmatically — no MCP server required.

## License

MIT.
