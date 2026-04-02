# xLever Glossary

Protocol terminology and definitions used throughout the xLever platform and documentation.

---

## A

### Auto-Deleverage Cascade
A 5-level automatic system (designed, not yet deployed on-chain) that progressively reduces leverage when risk conditions deteriorate. Levels range from no action (Level 0) to force close (Level 4).

### Accumulate Mode
AI agent policy mode that dollar-cost-averages into positions on a defined schedule. The most permissive mode — can open new positions at fixed leverage.

---

## B

### Backtesting
Testing a trading strategy against historical data. xLever's backtester (Screen 6) compares fixed-entry leverage (LTAP) against daily-reset leverage using real Yahoo Finance OHLCV data.

---

## C

### Circuit Breaker
An automatic safety mechanism that halts or restricts protocol operations when predefined risk thresholds are breached. Part of the Risk Sentinel system.

---

## D

### Daily-Reset Leverage
Traditional leveraged ETF approach (e.g., TQQQ, SPXL) where leverage is recalculated and rebalanced at each market close. Causes volatility decay over time.

### Drawdown
The peak-to-trough decline in portfolio value, expressed as a percentage. A key input to the Risk Sentinel — drawdowns above 5% trigger WARNING, above 15% trigger RESTRICTED, above 30% trigger EMERGENCY.

### Dry-Run Mode
Default mode for the AI agent where decisions are simulated without sending real on-chain transactions. Used for testing strategies safely.

---

## E

### Entry Price
The asset price at the moment a position is opened. In xLever, leverage is fixed relative to this price — PnL is always measured from the entry price.

### Euler V2 (EVK)
Euler V2 is a modular lending protocol. EVK (Euler Vault Kit) is its vault framework. xLever builds on Euler V2's EVC (Ethereum Vault Connector) for vault infrastructure.

### EVC (Ethereum Vault Connector)
Euler's infrastructure contract that connects vaults and manages vault-to-vault interactions. Deployed at `0x9B8d...312c` on Ink Sepolia.

### EVAA Protocol
A TON blockchain lending protocol. xLever includes a lending adapter for cross-chain EVAA integration.

### Exposure
The total notional value of a position. Effective exposure = deposit amount x leverage. For example, 1,000 USDC at 3x = 3,000 USDC effective exposure.

### Exposure Netting
The process of offsetting long and short positions within a vault to calculate net protocol exposure. If the vault has 100,000 USDC long and 60,000 USDC short, net exposure is 40,000 USDC long.

---

## F

### Fee Engine
A module (designed, not deployed) that calculates dynamic entry, carry, and funding fees based on market conditions, protocol utilization, and risk state.

### Fixed-Entry Leverage
xLever's core innovation. Unlike daily-reset leverage, the leverage multiplier is locked at the entry price and never rebalanced. This eliminates volatility decay.

### Foundry
Solidity development framework used for compiling, testing, and deploying xLever's smart contracts. Includes forge (build/test), cast (interact), and anvil (local chain).

---

## H

### Health Factor
A numerical indicator of position or vault safety, inherited from Euler V2. Values above 1.5 are healthy. Below 1.0 means the position is eligible for liquidation.

### Hermes
Pyth Network's off-chain price service that provides signed price attestations (VAAs). The frontend fetches prices from Hermes before submitting on-chain transactions.

### HITL (Human-in-the-Loop)
Agent operation modes that require human approval for actions. Four modes: autonomous, approval_required, approval_above_threshold, notifications_only.

---

## I

### Ink Sepolia
The primary testnet for xLever deployments. Chain ID 763373. Part of the Ink blockchain ecosystem (built on Optimism).

---

## J

### Junior Tranche
In xLever's two-tranche design, the junior tranche provides first-loss capital. Junior LPs deposit funds that absorb losses before senior (leverage) users are affected. In exchange, junior LPs earn fees from protocol activity. Currently designed but not deployed.

---

## K

### Kamino Finance
A Solana lending and liquidity protocol. xLever includes a lending adapter for cross-chain Kamino integration.

---

## L

### Leverage (in xLever context)
A multiplier (-3.5x to +3.5x) applied to your deposit to amplify exposure. Positive values are long (profit when price rises), negative values are short (profit when price falls).

### LTAP (Leveraged Tokenized Asset Protocol)
The formal name for xLever's approach to leverage: tokenized assets with fixed-entry leverage, no daily rebalancing, and max loss limited to the deposit.

---

## M

### Max Loss
The maximum amount a user can lose on a position. In xLever, max loss always equals the deposit amount, regardless of leverage or market movement.

---

## N

### Net Exposure
The aggregate directional exposure of a vault after offsetting long and short positions. Used for risk management and hedging calculations.

---

## O

### OHLCV
Open, High, Low, Close, Volume — standard market data format. xLever uses historical OHLCV data from Yahoo Finance for backtesting.

### OpenBB
Open-source financial data platform. xLever integrates OpenBB for real-time quotes, options chains, and market context in the AI agent and analytics.

### Oracle Staleness
How long since the last price update from Pyth Network. Fresh prices (< 5 minutes) indicate healthy oracle operation. Stale prices trigger Risk Sentinel state changes.

---

## P

### PnL (Profit and Loss)
The gain or loss on a position. Calculated as: `Deposit x Leverage x (Current Price - Entry Price) / Entry Price`

### Position
A user's leveraged exposure to an asset. Includes deposit amount, leverage, entry price, and current value.

### Pyth Network
Decentralized oracle network providing real-time price feeds. xLever uses Pyth for on-chain price data across 30+ assets. Uses a "pull" model where prices are fetched from Hermes and submitted on-chain.

### PythOracleAdapter
xLever's smart contract that wraps Pyth's pull-oracle into a format compatible with the vault system. Handles fee estimation and price update verification.

---

## R

### Reown AppKit
Web3 wallet connection library (formerly WalletConnect v3). xLever uses Reown to support multiple wallet providers and chains.

### Risk Sentinel
xLever's 4-state deterministic state machine (NORMAL → WARNING → RESTRICTED → EMERGENCY) that monitors protocol health metrics and adjusts allowed operations. Currently runs client-side.

---

## S

### Safe Mode
AI agent policy mode that only monitors for stop-loss conditions and sends risk alerts. The most restrictive mode — can only reduce leverage or close positions, never open or increase.

### Senior Tranche
In xLever's two-tranche design, the senior tranche consists of leverage users (-3.5x to +3.5x). Senior users are protected by the junior tranche's first-loss capital buffer.

### Sharpe Ratio
A risk-adjusted return metric calculated as (return - risk-free rate) / standard deviation. Used in the backtesting engine to evaluate strategy quality. Higher is better.

### SIWE (Sign-In with Ethereum)
Authentication standard where users prove ownership of their wallet by signing a message. Used by xLever's FastAPI backend for wallet-based authentication.

---

## T

### Target Exposure Mode
AI agent policy mode that automatically maintains a target leverage band. Can rebalance within bounds but cannot open new positions.

### Tavily
AI-powered search and intelligence API. xLever's backend agent uses Tavily for real-time market research and news analysis.

### Tokenized Asset
A traditional financial asset (stock, ETF, commodity) represented as an on-chain token. xLever uses wrapped tokenized assets (e.g., wQQQx, wSPYx) from xStocks.

### TWAP (Time-Weighted Average Price)
A price calculated by averaging over a time window (typically 15 minutes). Used in the designed TWAPOracle module to smooth price volatility and prevent manipulation.

---

## U

### Utilization
The percentage of vault capital currently deployed in active positions. High utilization (>75%) triggers Risk Sentinel WARNING state.

---

## V

### VAA (Verifiable Action Approval)
Pyth Network's signed price attestation format. The frontend fetches VAAs from Hermes and includes them in on-chain transactions for price verification.

### VaultSimple
The deployed smart contract on Ink Sepolia that manages leveraged positions. Supports deposit, withdraw, and leverage adjustment with Pyth oracle pricing. A simplified version of the full modular Vault design.

### viem
TypeScript library for Ethereum interactions. xLever uses viem (v2) for all frontend-to-contract communication, replacing ethers.js.

### Volatility Decay
The erosion of returns caused by daily leverage rebalancing. When an asset moves up 10% and then down 10%, a 3x daily-reset product loses ~3% instead of returning to 0%. xLever's fixed-entry approach eliminates this.

---

## W

### wagmi
React hooks library for Ethereum. xLever uses wagmi (v3) alongside viem for wallet state management.

### Wrapped Tokenized Asset
An ERC-20 token representing a tokenized real-world asset. xLever uses wrapped versions (prefix "w", suffix "x") from xStocks — e.g., wQQQx represents the QQQ ETF.
