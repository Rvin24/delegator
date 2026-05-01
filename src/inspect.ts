/**
 * Read-only inspection of an EIP-7702 EOA on any supported chain.
 *
 * Prints the wallet's current delegation target, native balance, and the
 * code size of the delegate (if any). Useful before/after running
 * delegate.ts to confirm the EOA is in the expected state.
 *
 * Chain selection is identical to delegate.ts:
 *   - CHAIN=base|ethereum|arbitrum|optimism|bsc|ink|sepolia|base-sepolia
 *   - or CHAIN_ID=<num> + RPC_URL=<url> for a custom chain.
 *
 * Usage
 * -----
 *   ADDRESS=0xC272F976...   # any address to inspect
 *   CHAIN=base              # optional, default base
 *   pnpm tsx src/inspect.ts
 */

import 'dotenv/config';
import { createPublicClient, http, formatEther, type Hex } from 'viem';
import { resolveChainProfile } from './chains.js';
import { promptForChainIfNeeded } from './prompt.js';

async function main(): Promise<void> {
  await promptForChainIfNeeded();

  const { chain, rpcUrl, explorerAddressBase, label: chainLabel } = resolveChainProfile();
  const nativeSymbol = chain.nativeCurrency?.symbol || 'ETH';
  const TARGET = process.env.ADDRESS || process.env.COMPROMISED_EOA;

  if (!TARGET || !TARGET.startsWith('0x') || TARGET.length !== 42) {
    throw new Error('Set ADDRESS (or COMPROMISED_EOA) to the wallet you want to inspect (0x + 40 hex chars).');
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const address = TARGET as `0x${string}`;
  const [code, balance, nonce] = await Promise.all([
    publicClient.getCode({ address }),
    publicClient.getBalance({ address }),
    publicClient.getTransactionCount({ address, blockTag: 'pending' }),
  ]);

  console.log(`=== EOA inspection (${chainLabel}) ===`);
  console.log(`Chain id:       ${chain.id}`);
  console.log(`RPC:            ${rpcUrl}`);
  console.log(`Address:        ${address}`);
  console.log(`Balance:        ${formatEther(balance)} ${nativeSymbol}`);
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
    console.log(`  Explorer:     ${explorerAddressBase}${delegate}`);
    return;
  }

  console.log(`Code:           Non-7702 contract bytecode, ${(codeHex.length - 2) / 2} bytes`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
