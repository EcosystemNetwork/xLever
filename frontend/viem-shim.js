/**
 * Viem shim — exposes viem utilities on window for classic (non-module) scripts.
 * Loaded as type="module" so Vite bundles it; consumed by app.js via window.viem.
 */
import { createWalletClient, createPublicClient, custom, http, formatEther, formatUnits } from 'viem'
import { mainnet } from 'viem/chains'
import { inkSepolia } from './contracts.js'

window.viem = {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  formatEther,
  formatUnits,
  mainnet,
  inkSepolia,
}
