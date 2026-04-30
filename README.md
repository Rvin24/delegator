# delegator

Sponsored EIP-7702 **delegate-only** tool for Base.

Submits a single type-0x04 (SetCode) transaction that re-points a
compromised EOA's EIP-7702 delegation to a target you control. No claim,
no sweep, no token movement — just delegation rotation.

This is the same mechanic that drainer bots use to keep a compromised
wallet pointed at their sweeper. Anyone who holds the compromised
private key can do it; whoever updates the delegation last wins until the
next update.

## Why "delegate only"

Full atomic rescue (delegate + claim + sweep in one tx) is the right tool
when there is value to claim *now*. Delegate-only is the right tool when
you want to **hold the delegation between claims** so that:

1. Drainer's sweeper code is replaced — anything that lands on the EOA
   hits *your* code (e.g. a contract that auto-forwards to a safe
   wallet) instead of the drainer's.
2. You can pre-position before a known unlock window so the unlock fires
   with your delegation already in place — no race against the drainer
   bot at the moment of unlock.
3. You can clear the delegation entirely (target = zero address) to
   neutralize the drainer's attached code.

The drainer still holds the same private key. They can re-delegate at
any time. Empirically (this repo's reference wallet), drainer bot
reaction time is several days, not seconds.

## Mechanics

A type-0x04 transaction carries an `authorization_list`. Each entry is
an EIP-7702 authorization signed by an EOA's private key, declaring the
contract address whose code should attach to that EOA. When the
transaction lands:

1. Each authorization is verified against the EOA's pending nonce and
   the chain id.
2. If valid, the EOA's code becomes the magic prefix `0xef0100` followed
   by the 20-byte target address. From that block on, calls into the
   EOA execute the target contract's bytecode in the EOA's storage
   context.
3. The transaction's regular call (`to`/`value`/`data`) executes after
   the auth list is applied. This script intentionally points the call
   at the operator's own address with empty calldata so the call is a
   no-op self-transfer — the auth update is the only thing that
   happens.

Setting the delegate target to the zero address (`0x0000...0000`)
clears the delegation entirely; the EOA's code becomes empty again.
This is the recommended default when you just want to neutralize a
drainer's attached sweeper.

The EOA never needs to hold ETH. The operator wallet pays gas. This is
the only reason a delegate-only flow is possible against a wallet that
auto-drains every incoming wei.

## Layout

```
src/
  delegate.ts   submit a delegate-only type-0x04 tx
  inspect.ts    read-only state of an EOA (delegation + balance + nonce)
.env.example    documented env vars
```

## Setup

```bash
pnpm install
cp .env.example .env
chmod 600 .env
# fill in COMPROMISED_PK, OPERATOR_PK, DELEGATE_TARGET
```

## Inspect

```bash
ADDRESS=0xC272F976E3343f8b75d111321795cFE7812Dd37E pnpm tsx src/inspect.ts
```

Sample output:

```
=== EOA inspection (Base) ===
Address:        0xC272F976E3343f8b75d111321795cFE7812Dd37E
Balance:        0 ETH
Pending nonce:  3487
Code:           EIP-7702 delegation
  Delegate:     0x4D78c499683c71d6650b67b9ab0f4f944A738F9e
  Delegate code: 1846 bytes
  Basescan:     https://basescan.org/address/0x4D78c499683c71d6650b67b9ab0f4f944A738F9e
```

## Run

```bash
pnpm tsx src/delegate.ts
```

The script prints pre-state, signs the authorization with the
compromised key (env var only — never persisted), broadcasts via the
operator wallet, waits for the receipt, and prints post-state. Typical
gas cost on Base: ~37k–40k (≈ $0.05–$0.10).

## Verified end-to-end on a Base mainnet fork

Anvil fork at `--hardfork prague`, real on-chain state of EOA
`0xC272F976...`:

- Clearing delegation (target = `0x0000…0000`):
  ```
  Pre-state:  EIP-7702 → 0x4d78c499683c71d6650b67b9ab0f4f944a738f9e   (drainer)
  Post-state: EMPTY (no delegation, plain EOA)                       (gas 36800)
  ```
- Delegating to a contract (target = Multicall3 `0xcA11…CA11`, used as
  a bytecode-bearing fixture):
  ```
  Pre-state:  EIP-7702 → 0x4d78c499683c71d6650b67b9ab0f4f944a738f9e   (drainer)
  Post-state: EIP-7702 → 0xca11bde05977b3631167028862be2a173976ca11   (gas 38928)
  ```

Reproduce against your own fork before touching mainnet:

```bash
anvil --fork-url https://mainnet.base.org --chain-id 8453 --hardfork prague --port 18546 &
BASE_RPC_URL=http://127.0.0.1:18546 \
COMPROMISED_PK=0x... \
OPERATOR_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
DELEGATE_TARGET=0x0000000000000000000000000000000000000000 \
pnpm tsx src/delegate.ts
```

(`0xac09…ff80` is Anvil's well-known dev key #0 — never use it on mainnet.)

## Operational notes

- **Operator wallet** must be a fresh, clean Base address with a small
  amount of ETH for gas. It never holds the compromised key and never
  receives any value from this flow.
- **Compromised PK** is read from `COMPROMISED_PK` env var only. Do not
  paste it into chat, code, commits, or any logging system. The PK
  must remain available to the script for as long as you want to keep
  rotating delegation.
- **Reorgs / RPC flakiness**: the script waits for one confirmation
  before printing post-state. If you need stronger finality, re-run
  `inspect.ts` after a few blocks.
- **Drainer re-delegation**: the drainer can re-delegate immediately
  after this script lands. There is no permanent fix while the PK is
  still in their hands. The intended use is to win the delegation at
  *specific moments* you care about (e.g. just before an airdrop
  unlock).

## Limits and risks

- Anyone with the same private key can replace your delegation at any
  time. This script does not lock the drainer out.
- If the delegate target's bytecode reverts on incidental inputs (e.g.
  fallback that requires nonzero calldata), funds dropped on the EOA
  with empty calldata may bounce. Test the target's behavior first.
  This script's transaction itself is safe — its `to` is the operator,
  not the EOA, so a hostile-fallback target won't revert the auth
  update.
- Submitting from a public RPC means the tx is visible in the public
  mempool. On Base this is generally fine, but for high-value claim
  windows you may want a private RPC / sequencer endpoint.
