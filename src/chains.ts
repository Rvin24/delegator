/**
 * Chain selection helpers.
 *
 * Lets the user pick a chain by name via `CHAIN=` (e.g. CHAIN=ethereum)
 * or define a custom chain via `CHAIN_ID=` + `RPC_URL=`. The selected
 * chain is used for all on-chain reads/writes and for building the
 * correct block-explorer link.
 *
 * EIP-7702 requires the destination chain to have activated the Pectra
 * upgrade (or equivalent). All chains listed below have that as of late
 * 2025. If you point the tool at a chain that does NOT support EIP-7702,
 * the SetCode transaction will be rejected by the RPC.
 */

import {
  base,
  baseSepolia,
  bsc,
  ink,
  mainnet,
  arbitrum,
  optimism,
  sepolia,
  type Chain,
} from 'viem/chains';
import { defineChain } from 'viem';

export interface ChainProfile {
  chain: Chain;
  rpcUrl: string;
  explorerTxBase: string;
  explorerAddressBase: string;
  label: string;
}

const PRESETS: Record<string, ChainProfile> = {
  base: {
    chain: base,
    rpcUrl: 'https://mainnet.base.org',
    explorerTxBase: 'https://basescan.org/tx/',
    explorerAddressBase: 'https://basescan.org/address/',
    label: 'Base',
  },
  ethereum: {
    chain: mainnet,
    /* publicnode.com Ethereum endpoint — reliable in our tests; the
       previously-shipped llamarpc default returned upstream-gateway
       errors. Override with RPC_URL for production-grade reliability. */
    rpcUrl: 'https://ethereum.publicnode.com',
    explorerTxBase: 'https://etherscan.io/tx/',
    explorerAddressBase: 'https://etherscan.io/address/',
    label: 'Ethereum mainnet',
  },
  arbitrum: {
    chain: arbitrum,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerTxBase: 'https://arbiscan.io/tx/',
    explorerAddressBase: 'https://arbiscan.io/address/',
    label: 'Arbitrum One',
  },
  optimism: {
    chain: optimism,
    rpcUrl: 'https://mainnet.optimism.io',
    explorerTxBase: 'https://optimistic.etherscan.io/tx/',
    explorerAddressBase: 'https://optimistic.etherscan.io/address/',
    label: 'OP Mainnet',
  },
  bsc: {
    chain: bsc,
    rpcUrl: 'https://bsc-dataseed.bnbchain.org',
    explorerTxBase: 'https://bscscan.com/tx/',
    explorerAddressBase: 'https://bscscan.com/address/',
    label: 'BNB Smart Chain',
  },
  ink: {
    chain: ink,
    rpcUrl: 'https://rpc-gel.inkonchain.com',
    explorerTxBase: 'https://explorer.inkonchain.com/tx/',
    explorerAddressBase: 'https://explorer.inkonchain.com/address/',
    label: 'Ink',
  },
  sepolia: {
    chain: sepolia,
    rpcUrl: 'https://ethereum-sepolia.publicnode.com',
    explorerTxBase: 'https://sepolia.etherscan.io/tx/',
    explorerAddressBase: 'https://sepolia.etherscan.io/address/',
    label: 'Sepolia (Ethereum testnet)',
  },
  'base-sepolia': {
    chain: baseSepolia,
    rpcUrl: 'https://sepolia.base.org',
    explorerTxBase: 'https://sepolia.basescan.org/tx/',
    explorerAddressBase: 'https://sepolia.basescan.org/address/',
    label: 'Base Sepolia (testnet)',
  },
};

/**
 * Resolve a chain profile from the environment.
 *
 * Resolution order:
 * 1. `CHAIN` matches a preset name (case-insensitive). RPC defaults to
 *    the preset's URL but can still be overridden with `RPC_URL` /
 *    `BASE_RPC_URL`.
 * 2. `CHAIN_ID` is set to a numeric value. In that case `RPC_URL` is
 *    required, and the script builds a custom Chain via `defineChain`.
 *    Explorer links fall back to a generic blockscan search.
 * 3. Nothing set: defaults to `base` (preserves the original behavior).
 */
export function resolveChainProfile(env: NodeJS.ProcessEnv = process.env): ChainProfile {
  const rpcOverride = env.RPC_URL || env.BASE_RPC_URL;
  const chainName = (env.CHAIN || '').toLowerCase().trim();
  const chainIdRaw = (env.CHAIN_ID || '').trim();

  if (chainName && PRESETS[chainName]) {
    const preset = PRESETS[chainName];
    return rpcOverride ? { ...preset, rpcUrl: rpcOverride } : preset;
  }

  if (chainName && !PRESETS[chainName]) {
    throw new Error(
      `Unknown CHAIN=${chainName}. Known presets: ${Object.keys(PRESETS).join(', ')}. ` +
      `For unsupported chains, set CHAIN_ID and RPC_URL instead.`,
    );
  }

  if (chainIdRaw) {
    const chainId = Number(chainIdRaw);
    if (!Number.isFinite(chainId) || chainId <= 0) {
      throw new Error(`CHAIN_ID must be a positive integer; got ${chainIdRaw}.`);
    }
    if (!rpcOverride) {
      throw new Error('CHAIN_ID is set but RPC_URL is missing. Provide an RPC for the custom chain.');
    }
    const customChain = defineChain({
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcOverride] } },
    });
    return {
      chain: customChain,
      rpcUrl: rpcOverride,
      explorerTxBase: `https://blockscan.com/tx/`,
      explorerAddressBase: `https://blockscan.com/address/`,
      label: `custom chain (id=${chainId})`,
    };
  }

  const fallback = PRESETS.base;
  return rpcOverride ? { ...fallback, rpcUrl: rpcOverride } : fallback;
}

export const KNOWN_CHAINS = Object.keys(PRESETS);
