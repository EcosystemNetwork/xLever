// Import Reown AppKit factory — this creates the wallet-connect modal UI and manages connection state
import { createAppKit } from '@reown/appkit'
// Import Ethereum mainnet chain config — one of the four chains xLever supports natively
import { mainnet } from '@reown/appkit/networks'
// Import Wagmi adapter — bridges Reown's modal to wagmi hooks so the rest of the app can use standard wagmi APIs
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
// Import Ink Sepolia chain config — single source of truth in contracts.js
import { inkSepolia } from './contracts.js'

// Reown Cloud project ID authorizes our app with WalletConnect relay servers
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID
if (!projectId) {
  console.warn('[xLever] VITE_REOWN_PROJECT_ID not set — wallet connection will fail. Set it in your .env file.')
}

// Define Solana as a custom chain — xLever targets Solana for cross-chain leverage positions via Wormhole bridging
const solana = {
  // CAIP-2 chain identifier — Reown uses this format for non-EVM chains
  id: 'solana:mainnet',
  // Display name shown in the wallet modal network picker
  name: 'Solana',
  // SOL has 9 decimals (lamports), unlike ETH's 18 — critical for correct balance display
  nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
  // Public Solana mainnet RPC — rate-limited but sufficient for wallet connection and balance checks
  rpcUrls: {
    default: { http: ['https://api.mainnet-beta.solana.com'] },
  },
  // Solscan is the most widely-used Solana explorer for transaction verification
  blockExplorers: {
    default: { name: 'Solscan', url: 'https://solscan.io' },
  },
}

// Define TON as a custom chain — xLever targets TON for its large retail user base (Telegram integration)
const ton = {
  // CAIP-2 chain identifier for TON mainnet
  id: 'ton:mainnet',
  // Display name for the network selector
  name: 'TON',
  // Toncoin uses 9 decimals (nanotons), matching Solana's precision model
  nativeCurrency: { name: 'Toncoin', symbol: 'TON', decimals: 9 },
  // TON Center public JSON-RPC endpoint — serves as the default gateway for wallet interactions
  rpcUrls: {
    default: { http: ['https://toncenter.com/api/v2/jsonRPC'] },
  },
  // Tonscan is the primary TON block explorer for user-facing tx links
  blockExplorers: {
    default: { name: 'Tonscan', url: 'https://tonscan.org' },
  },
}

// Use only Ink Sepolia for now to avoid connection issues with multi-chain setup
const networks = [inkSepolia]

// Create Wagmi adapter — this translates Reown modal events into wagmi-compatible hooks and providers
const wagmiAdapter = new WagmiAdapter({
  // Project ID is required for the WalletConnect relay to route messages between dapp and wallets
  projectId,
  // Pass all supported networks so wagmi can create providers and handle chain switching for each
  networks
})

// App metadata shown in wallet approval screens — helps users verify they're connecting to the real xLever dapp
const metadata = {
  // App name displayed prominently in the wallet's connection prompt
  name: 'xLever',
  // Brief description helps users understand what they're authorizing
  description: 'Leveraged DeFi Trading on Euler V2',
  // Dynamic origin ensures metadata works across localhost, staging, and production deployments
  url: window.location.origin,
  // App icon shown in wallet UIs — reinforces brand trust during connection approval
  icons: ['https://xlever.markets/icon.png']
}

// Initialize the Reown AppKit modal — this is the central wallet connection manager for the entire xLever frontend
const modal = createAppKit({
  // Wagmi adapter enables EVM chain interactions through standard wagmi hooks
  adapters: [wagmiAdapter],
  // Register all supported networks so users can switch between mainnet, Ink Sepolia, Solana, and TON
  networks,
  // Pass metadata so wallets display xLever branding in their connection prompts
  metadata,
  // Project ID authenticates this dapp with the WalletConnect relay infrastructure
  projectId,
  // Dark mode matches xLever's dark terminal-style UI aesthetic
  themeMode: 'dark',
  // Custom theme variables align the modal's look with xLever's purple (#7c4dff) brand palette
  themeVariables: {
    // Blend purple into the modal's background gradients for visual cohesion with the main UI
    '--w3m-color-mix': '#7c4dff',
    // Subtle 20% mix strength keeps the purple accent without overwhelming readability
    '--w3m-color-mix-strength': 20,
    // Primary accent color for buttons and highlights — matches xLever's brand purple
    '--w3m-accent': '#7c4dff',
    // Sharp 1px border radius gives the modal a precise, finance-terminal feel instead of rounded consumer UI
    '--w3m-border-radius-master': '1px'
  },
  // Feature flags control which optional AppKit capabilities are enabled
  features: {
    // Enable Reown analytics to track connection success rates and chain usage patterns
    analytics: true,
    // Disable built-in swap UI — xLever handles leverage positions through its own vault contracts, not generic swaps
    swaps: false,
    // Disable fiat on-ramp — not relevant for a leveraged trading protocol
    onramp: false
  }
})

// Expose modal on window so non-module scripts (ux.js, inline handlers) can trigger connect/disconnect actions
window.xLeverWallet = modal

// Also export as ES module default so module-aware code can import it directly
export default modal
