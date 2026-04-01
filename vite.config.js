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
    // Rollup-specific options for the multi-page app entry points
    rollupOptions: {
      // Each key-value pair defines a named entry point so Rollup builds all 8 HTML pages
      input: {
        // Landing page / main entry — the default route users see first
        main: resolve(__dirname, 'frontend/index.html'),
        // Dashboard screen showing portfolio overview and aggregate metrics
        dashboard: resolve(__dirname, 'frontend/01-dashboard.html'),
        // Trading terminal with TradingView chart and leverage controls
        trading: resolve(__dirname, 'frontend/02-trading-terminal.html'),
        // AI agent operations screen for automated trading strategies
        agents: resolve(__dirname, 'frontend/03-ai-agent-operations.html'),
        // Vault management screen for depositing/withdrawing collateral
        vaults: resolve(__dirname, 'frontend/04-vault-management.html'),
        // Risk management screen showing liquidation thresholds and exposure
        risk: resolve(__dirname, 'frontend/05-risk-management.html'),
        // Analytics and backtesting screen for strategy performance review
        analytics: resolve(__dirname, 'frontend/06-analytics-backtesting.html'),
        // Operations control panel for protocol admin and monitoring
        operations: resolve(__dirname, 'frontend/07-operations-control.html'),
        admin: resolve(__dirname, 'frontend/08-admin-dashboard.html')
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
        // FastAPI backend runs on port 8000 during local development
        target: 'http://localhost:8000',
        // changeOrigin rewrites the Host header so FastAPI sees localhost:8000, not localhost:3000
        changeOrigin: true,
      }
    }
  }
})
