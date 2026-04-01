// defineConfig provides type hints and validation for the Vite configuration object
import { defineConfig } from 'vite'
// resolve constructs absolute paths for the multi-page entry points below
import { resolve } from 'path'

// Export the Vite config so the dev server and build process both use these settings
export default defineConfig({
  // Set the project root to the frontend directory so Vite resolves HTML and assets from there
  root: 'frontend',
  // Build configuration controls how Rollup bundles the production output
  build: {
    // Output the production build one level up into /dist (relative to root, so project-root/dist)
    outDir: '../dist',
    // Clear the dist folder before each build to avoid stale files from previous builds
    emptyOutDir: true,
    // Warn only for chunks above 1MB (wallet SDK bundles are large by nature)
    chunkSizeWarningLimit: 2000,
    // Rollup-specific options for the multi-page app entry points
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'frontend/index.html'),
        dashboard: resolve(__dirname, 'frontend/01-dashboard.html'),
        trading: resolve(__dirname, 'frontend/02-trading-terminal.html'),
        agents: resolve(__dirname, 'frontend/03-ai-agent-operations.html'),
        vaults: resolve(__dirname, 'frontend/04-vault-management.html'),
        risk: resolve(__dirname, 'frontend/05-risk-management.html'),
        analytics: resolve(__dirname, 'frontend/06-analytics-backtesting.html'),
        operations: resolve(__dirname, 'frontend/07-operations-control.html'),
        admin: resolve(__dirname, 'frontend/08-admin-dashboard.html'),
        lending: resolve(__dirname, 'frontend/09-lending-borrowing.html')
      },
      output: {
        manualChunks(id) {
          if (id.includes('@reown/appkit')) return 'wallet-sdk'
          if (id.includes('wagmi') || id.includes('@wagmi')) return 'wagmi'
          if (id.includes('viem')) return 'viem'
          if (id.includes('@solana')) return 'solana'
          if (id.includes('@ton/')) return 'ton'
        }
      }
    }
  },
  // Dev server settings for local development
  server: {
    // Port 3000 avoids conflict with the FastAPI backend on port 8000
    port: 3000,
    // Auto-open the landing page in the browser when the dev server starts
    open: '/index.html',
    // Proxy configuration forwards API requests to the Python FastAPI backend
    proxy: {
      // Any request starting with /api is forwarded to the FastAPI server
      '/api': {
        target: 'http://localhost:8001',
        // changeOrigin rewrites the Host header so FastAPI sees localhost:8000, not localhost:3000
        changeOrigin: true,
      }
    }
  }
})
