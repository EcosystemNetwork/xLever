import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'frontend',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'frontend/index.html'),
        dashboard: resolve(__dirname, 'frontend/01-dashboard.html'),
        trading: resolve(__dirname, 'frontend/02-trading-terminal.html'),
        agents: resolve(__dirname, 'frontend/03-ai-agent-operations.html'),
        vaults: resolve(__dirname, 'frontend/04-vault-management.html'),
        risk: resolve(__dirname, 'frontend/05-risk-management.html'),
        analytics: resolve(__dirname, 'frontend/06-analytics-backtesting.html'),
        operations: resolve(__dirname, 'frontend/07-operations-control.html')
      }
    }
  },
  server: {
    port: 3000,
    open: '/index.html',
    proxy: {
      // Forward /api/* to the Python data server
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
})
