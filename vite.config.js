// defineConfig provides type hints and validation for the Vite configuration object
import { defineConfig } from 'vite'
// resolve constructs absolute paths for the multi-page entry points below
import { resolve } from 'path'
// viteStaticCopy copies non-bundled files to the dist folder
import { viteStaticCopy } from 'vite-plugin-static-copy'

// Export the Vite config so the dev server and build process both use these settings
export default defineConfig({
  root: 'frontend',
  // Plugins to extend Vite functionality
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: '*.js',
          dest: '.'
        },
        {
          src: '*.css',
          dest: '.'
        }
      ]
    })
  ],
  // Public directory for assets that should be copied as-is
  publicDir: 'public',
  // Build configuration controls how Rollup bundles the production output
  build: {
    // Output the production build to dist folder at project root
    outDir: '../dist',
    // Clear the dist folder before each build to avoid stale files from previous builds
    emptyOutDir: true,
    // Copy public directory files to dist
    copyPublicDir: true,
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
