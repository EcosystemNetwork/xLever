/**
 * @file viem-shim.js — Viem Bridge for Non-Module Scripts
 *
 * Exposes viem utilities on `window.viem` so classic (non-module) scripts can
 * access them without ES import syntax. This file is loaded as `type="module"`
 * so Vite resolves and bundles the viem dependency, then the bridge pattern
 * makes the utilities available globally.
 *
 * This shim is necessary because legacy scripts (app.js, inline HTML handlers,
 * position-manager.js, etc.) cannot use ES `import` statements but need access
 * to viem's client factories and formatting utilities for on-chain interactions.
 *
 * @module viem-shim
 * @exports {Object} window.viem - Global viem utilities object
 * @exports {Function} window.viem.createWalletClient - Factory for transaction-signing clients
 * @exports {Function} window.viem.createPublicClient - Factory for read-only RPC clients
 * @exports {Function} window.viem.custom - Transport wrapper for injected wallet providers
 * @exports {Function} window.viem.http - HTTP transport for public RPC endpoints
 * @exports {Function} window.viem.formatEther - Convert 18-decimal wei to ETH string
 * @exports {Function} window.viem.formatUnits - Convert arbitrary-decimal amounts to readable strings
 * @exports {Object} window.viem.mainnet - Ethereum mainnet chain definition
 * @exports {Object} window.viem.inkSepolia - Ink Sepolia chain definition (xLever primary deployment)
 *
 * @dependencies
 *   - viem (npm package) for client factories and formatters
 *   - ./contracts.js for inkSepolia chain definition
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
import { inkSepolia, ethSepolia } from './contracts.js'

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
  // Expose Eth Sepolia chain config — secondary supported chain
  ethSepolia,
}
