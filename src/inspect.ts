/**
 * Read-only inspection of an EIP-7702 EOA on Base.
 *
 * Prints the wallet's current delegation target, native ETH balance, and
 * code size of the delegate (if any). Useful before/after running
 * delegate.ts to confirm the EOA is in the expected state.
 *
 * Usage
 * -----
 *   ADDRESS=0xC272F976...   # any address to inspect
 *   pnpm tsx src/inspect.ts
 */

import 'dotenv/config';
import { createPublicClient, http, formatEther, type Hex } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const TARGET = process.env.ADDRESS || process.env.COMPROMISED_EOA;

if (!TARGET || !TARGET.startsWith('0x') || TARGET.length !== 42) {
  throw new Error('Set ADDRESS (or COMPROMISED_EOA) to the wallet you want to inspect (0x + 40 hex chars).');
}

const publicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

async function main(): Promise<void> {
  const address = TARGET as `0x${string}`;
  const [code, balance, nonce] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.getBalance({ address }),
    publicClient.getTransactionCount({ address, blockTag: 'pending' }),
  ]);

  console.log('=== EOA inspection (Base) ===');
  console.log(`Address:        ${address}`);
  console.log(`Balance:        ${formatEther(balance)} ETH`);
  console.log(`Pending nonce:  ${nonce}`);

  const codeHex = (code || '0x') as Hex;
  if (codeHex === '0x') {
    console.log(`Code:           EMPTY (plain EOA, no EIP-7702 delegation)`);
    return;
  }

  if (codeHex.startsWith('0xef0100') && codeHex.length === 48) {
    const delegate = `0x${codeHex.slice(8)}` as `0x${string}`;
    const delegateCode = await publicClient.getCode({ address: delegate });
    const delegateSize = delegateCode && delegateCode !== '0x' ? (delegateCode.length - 2) / 2 : 0;
    console.log(`Code:           EIP-7702 delegation`);
    console.log(`  Delegate:     ${delegate}`);
    console.log(`  Delegate code:${delegateSize > 0 ? ` ${delegateSize} bytes` : ' EMPTY (no contract at delegate)'}`);
    console.log(`  Basescan:     https://basescan.org/address/${delegate}`);
    return;
  }

  console.log(`Code:           Non-7702 contract bytecode, ${(codeHex.length - 2) / 2} bytes`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
