import { createAppKit } from '@reown/appkit'
import { mainnet, arbitrum } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'

// Get your own project ID at https://cloud.reown.com
const projectId = import.meta.env.VITE_REOWN_PROJECT_ID || 'REPLACE_WITH_YOUR_PROJECT_ID'

const networks = [mainnet, arbitrum]

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks
})

const metadata = {
  name: 'xLever',
  description: 'Leveraged DeFi Trading on Euler V2',
  url: window.location.origin,
  icons: ['https://xlever.io/icon.png']
}

const modal = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  metadata,
  projectId,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-color-mix': '#7c4dff',
    '--w3m-color-mix-strength': 20,
    '--w3m-accent': '#7c4dff',
    '--w3m-border-radius-master': '1px'
  },
  features: {
    analytics: true,
    swaps: false,
    onramp: false
  }
})

// Expose modal globally so ux.js and inline scripts can access it
window.xLeverWallet = modal

export default modal
