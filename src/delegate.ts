/**
 * Sponsored EIP-7702 delegate-only runner.
 *
 * What this does
 * --------------
 * Submits a single type-0x04 (SetCode) transaction on Base mainnet that
 * re-points the compromised EOA's EIP-7702 delegation to `DELEGATE_TARGET`.
 * That is the only side effect on the EOA — no claim, no sweep, no token
 * movement, no contract calls. Just delegation rotation.
 *
 * Why this exists
 * ---------------
 * After a wallet has been delegated to a drainer's sweeper, holding the
 * private key still gives you the power to sign a fresh authorization that
 * replaces the attached implementation. EIP-7702 also separates *signer
 * authorization* from *gas payer*, so a clean operator wallet can pay gas
 * while attaching the authorization signed by the compromised key.
 *
 * Use cases
 * ---------
 * 1. Pre-position before a known unlock window (claim portal etc.) so that
 *    when the unlock fires, your EOA is already pointing at code you
 *    control instead of the drainer's sweeper.
 * 2. Capture incidental funds that land on the EOA between drainer
 *    re-delegations: while you hold the delegation, anything dropped on the
 *    EOA hits *your* code (e.g. a contract that forwards to a safe wallet).
 * 3. "Clear" the delegation entirely by pointing at the zero address —
 *    EIP-7702 explicitly defines this as removing the attached code.
 *
 * Security
 * --------
 * - Compromised PK is read from env var only. Never persisted or logged.
 * - The script never sends funds. It only changes the EOA's attached code.
 * - The drainer still holds the same PK and can re-delegate at any time.
 *   This script gives you the delegation; it does not lock the drainer
 *   out permanently.
 *
 * Usage
 * -----
 *   COMPROMISED_PK=0x...           # leaked PK
 *   OPERATOR_PK=0x...              # clean wallet, ~$0.10 ETH on Base
 *   DELEGATE_TARGET=0x...          # contract to delegate to (or 0x0... to clear)
 *   BASE_RPC_URL=https://...       # optional, defaults to public Base RPC
 *   pnpm tsx src/delegate.ts
 */

import 'dotenv/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const COMPROMISED_PK = (process.env.COMPROMISED_PK || '') as Hex;
const OPERATOR_PK = (process.env.OPERATOR_PK || '') as Hex;
const DELEGATE_TARGET = (process.env.DELEGATE_TARGET || '') as Address;

if (!COMPROMISED_PK.startsWith('0x') || COMPROMISED_PK.length !== 66) {
  throw new Error('Set COMPROMISED_PK to the leaked wallet private key (0x + 64 hex chars).');
}
if (!OPERATOR_PK.startsWith('0x') || OPERATOR_PK.length !== 66) {
  throw new Error('Set OPERATOR_PK to a clean operator wallet private key (0x + 64 hex chars).');
}
if (!DELEGATE_TARGET.startsWith('0x') || DELEGATE_TARGET.length !== 42) {
  throw new Error('Set DELEGATE_TARGET to the address you want the EOA delegated to (0x + 40 hex chars). Use 0x0000...0000 to clear.');
}

const compromised = privateKeyToAccount(COMPROMISED_PK);
const operator = privateKeyToAccount(OPERATOR_PK);

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});
const operatorClient = createWalletClient({
  account: operator,
  chain: base,
  transport: http(BASE_RPC_URL),
});
const compromisedClient = createWalletClient({
  account: compromised,
  chain: base,
  transport: http(BASE_RPC_URL),
});

function shorten(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function describeCode(code: Hex): string {
  if (!code || code === '0x') return 'EMPTY (no delegation, plain EOA)';
  if (code.startsWith('0xef0100') && code.length === 48) {
    return `EIP-7702 → 0x${code.slice(8)}`;
  }
  return `non-7702 contract code (${code.length} chars)`;
}

async function main(): Promise<void> {
  console.log('=== EIP-7702 delegate-only runner ===');
  console.log(`Base RPC:           ${BASE_RPC_URL}`);
  console.log(`Compromised EOA:    ${compromised.address}`);
  console.log(`Operator (gas):     ${operator.address}`);
  console.log(`Target delegate:    ${DELEGATE_TARGET}`);
  console.log('');

  const [eoaCodeBefore, eoaNonce, operatorBalance] = await Promise.all([
    publicClient.getCode({ address: compromised.address }),
    publicClient.getTransactionCount({ address: compromised.address, blockTag: 'pending' }),
    publicClient.getBalance({ address: operator.address }),
  ]);

  console.log('--- Pre-flight ---');
  console.log(`EOA current code:   ${describeCode((eoaCodeBefore || '0x') as Hex)}`);
  console.log(`EOA pending nonce:  ${eoaNonce}`);
  console.log(`Operator balance:   ${formatEther(operatorBalance)} ETH`);
  if (operatorBalance === 0n) {
    throw new Error('Operator wallet has zero ETH on Base. Top it up before running.');
  }

  if (DELEGATE_TARGET.toLowerCase() === ('0x' + '00'.repeat(20)).toLowerCase()) {
    console.log('Note: DELEGATE_TARGET is the zero address. EOA will be cleared back to plain (no code).');
  } else {
    const targetCode = await publicClient.getCode({ address: DELEGATE_TARGET });
    if (!targetCode || targetCode === '0x') {
      console.log('Warn: target has no contract code on-chain. EOA will end up with empty effective code.');
    } else {
      console.log(`Target code size:   ${(targetCode.length - 2) / 2} bytes`);
    }
  }
  console.log('');

  console.log('--- Signing EIP-7702 authorization ---');
  const authorization = await compromisedClient.signAuthorization({
    contractAddress: DELEGATE_TARGET,
    chainId: base.id,
    nonce: eoaNonce,
  });
  console.log(`Authorization OK    (chainId=${authorization.chainId}, nonce=${authorization.nonce}, contract=${shorten(DELEGATE_TARGET)})`);
  console.log('');

  console.log('--- Broadcasting type-0x04 transaction ---');
  /* `to` is set to the operator itself so the executed call is a no-op
     self-transfer that does NOT touch the EOA's newly-attached code.
     Otherwise, when the delegate target's bytecode does not implement a
     graceful fallback (e.g. Multicall3 reverts on empty calldata), calling
     the EOA with empty data after the auth update would revert. The auth
     list is processed before the call, so the EOA's delegation still
     updates regardless of which `to` we use. */
  const txHash = await operatorClient.sendTransaction({
    authorizationList: [authorization],
    to: operator.address,
    data: '0x',
    value: 0n,
  });
  console.log(`Tx hash:            ${txHash}`);
  console.log(`Watch on Basescan:  https://basescan.org/tx/${txHash}`);
  console.log('');

  console.log('--- Waiting for receipt ---');
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`Status:             ${receipt.status}`);
  console.log(`Block number:       ${receipt.blockNumber}`);
  console.log(`Gas used:           ${receipt.gasUsed}`);
  console.log('');

  const eoaCodeAfter = await publicClient.getCode({ address: compromised.address });
  console.log('--- Post-state ---');
  console.log(`EOA code now:       ${describeCode((eoaCodeAfter || '0x') as Hex)}`);
  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted. EOA delegation may not have changed.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
