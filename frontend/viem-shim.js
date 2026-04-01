/**
 * Viem shim — exposes viem utilities on window for classic (non-module) scripts.
 * Loaded as type="module" so Vite bundles it; consumed by app.js via window.viem.
 */

// Import viem client factories and utilities — these are needed by non-module scripts that can't use ES imports directly
// createWalletClient: needed to send transactions (deposits, withdrawals) through the user's connected wallet
// createPublicClient: needed for read-only calls (balance checks, vault state) without requiring a signer
// custom: wraps the wallet's injected provider (e.g. MetaMask) into a viem-compatible transport
// http: creates an HTTP transport for public RPC calls that don't need wallet signing
// formatEther: converts raw 18-decimal wei values to human-readable ETH strings for display
// formatUnits: converts arbitrary-decimal token amounts (e.g. 6-decimal USDC) to readable strings
import { createWalletClient, createPublicClient, custom, http, formatEther, formatUnits } from 'viem'
// Import mainnet chain definition — required by viem clients to know chain ID, RPC URLs, and block explorer links
import { mainnet } from 'viem/chains'
// Import Ink Sepolia chain definition from our contracts config — keeps chain config in one canonical source
import { inkSepolia } from './contracts.js'

// Attach all viem utilities to window.viem so non-module scripts (app.js, inline handlers) can access them globally
// This bridge pattern is necessary because legacy scripts loaded without type="module" cannot use ES import syntax
window.viem = {
  // Expose wallet client factory — used by transaction-signing flows in non-module code
  createWalletClient,
  // Expose public client factory — used by read-only vault queries in non-module code
  createPublicClient,
  // Expose custom transport — wraps window.ethereum or Reown provider for wallet-signed transactions
  custom,
  // Expose HTTP transport — used for public RPC reads that don't require wallet authorization
  http,
  // Expose ETH formatter — converts vault balance wei values to displayable ETH amounts
  formatEther,
  // Expose generic unit formatter — handles non-18-decimal tokens like USDC (6) or WBTC (8)
  formatUnits,
  // Expose mainnet chain config — needed when creating clients that target Ethereum mainnet
  mainnet,
  // Expose Ink Sepolia chain config — needed when creating clients that target xLever's primary deployment chain
  inkSepolia,
}
