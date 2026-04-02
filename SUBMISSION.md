# xLever — Submission Guide

> Fixed-entry leverage (-3.5x to +3.5x) on 33 tokenized assets, built on Euler V2 EVK.
> Live demo: [xlever.markets](https://xlever.markets)

---

## What is Live Right Now

These components are deployed and functional. A judge can verify each one.

| Component | What it does | How to verify |
|-----------|-------------|---------------|
| **33 modular Vault contracts** | Deposit USDC, adjust leverage -3.5x to +3.5x, withdraw | [QQQ Vault on Ink Sepolia Explorer](https://explorer-sepolia.inkonchain.com/address/0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6) |
| **Pyth Oracle (30+ feeds)** | Real-time price updates via Hermes pull-oracle | Connect wallet on trading screen, prices update live |
| **9-screen frontend** | Bloomberg-terminal-style SPA (Vite + Vanilla JS) | Visit [xlever.markets](https://xlever.markets) |
| **Wallet connection** | Reown AppKit connecting to Ink Sepolia | Click "Connect Wallet" on landing page |
| **Backtesting engine** | LTAP vs daily-reset comparison with real Yahoo Finance data | Screen 6 — run a backtest on any of the 33 assets |
| **Risk sentinel** | Client-side 4-state FSM (NORMAL/WARNING/RESTRICTED/EMERGENCY) | Screen 5 — view live state transitions |
| **AI agent executor** | Bounded policy engine with 3 modes (dry-run default) | Screen 3 — start an agent in Safe mode |
| **Data proxy server** | Yahoo Finance CORS proxy for historical OHLCV | Powers backtesting and chart data |

---

## What is Simulated

| Component | Why simulated | Where the code lives |
|-----------|--------------|---------------------|
| **Dashboard portfolio values** | Shows demo data until user opens a real vault position | `frontend/01-dashboard.html` |
| **Order book on trading screen** | Illustrative — xLever is not an order-book exchange | `frontend/02-trading-terminal.html` |
| **Junior tranche (first-loss LP)** | Designed in modular Vault.sol, but VaultSimple doesn't include it | `contracts/src/xLever/experimental/modules/JuniorTranche.sol` |
| **On-chain auto-deleverage** | The 5-level cascade exists in experimental contracts, not deployed | `contracts/src/xLever/experimental/Vault.sol` |
| **Risk sentinel on-chain enforcement** | FSM runs client-side in JS; no on-chain circuit breaker in VaultSimple | `frontend/risk-engine.js` |
| **AI agent live transactions** | Agent defaults to dry-run; real tx is opt-in and requires private key | `frontend/agent-executor.js` |

---

## What is Planned Next

| Feature | Status | Blocker |
|---------|--------|---------|
| **Modular Vault.sol** (dynamic fees, Euler hedging, junior tranche, TWAP oracle) | Fully designed, 7 modules written | Contract exceeds deployment size limit — needs proxy pattern |
| **Solana vaults** | Anchor program written, mirrors EVM logic | Deployment and testing on devnet |
| **TON vaults** | Tact contracts written, 33 Pyth feeds configured | Deployment and testing on testnet |
| **Kamino Finance lending adapter** (Solana) | SDK integration code written | Needs live Solana vault deployment |
| **EVAA lending adapter** (TON) | SDK integration code written | Needs live TON vault deployment |
| **FastAPI backend** (positions DB, SIWE auth, agent history) | Code complete, PostgreSQL + Redis orchestrated | Needs hosting for production |

---

## Contract Address Manifest

**Network:** Ink Sepolia (Chain ID 763373)
**Explorer:** https://explorer-sepolia.inkonchain.com

### Infrastructure

| Contract | Address | Explorer |
|----------|---------|----------|
| EVC | `0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c` | [View](https://explorer-sepolia.inkonchain.com/address/0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c) |
| USDC | `0x6b57475467cd854d36Be7FB614caDa5207838943` | [View](https://explorer-sepolia.inkonchain.com/address/0x6b57475467cd854d36Be7FB614caDa5207838943) |
| wQQQx | `0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9` | [View](https://explorer-sepolia.inkonchain.com/address/0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9) |
| wSPYx | `0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e` | [View](https://explorer-sepolia.inkonchain.com/address/0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e) |
| Pyth Oracle | `0x2880aB155794e7179c9eE2e38200202908C17B43` | [View](https://explorer-sepolia.inkonchain.com/address/0x2880aB155794e7179c9eE2e38200202908C17B43) |
| PythOracleAdapter | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` | [View](https://explorer-sepolia.inkonchain.com/address/0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f) |

### Asset Vaults (33 total)

| Asset | Vault Address |
|-------|--------------|
| QQQ | [`0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6`](https://explorer-sepolia.inkonchain.com/address/0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6) |
| SPY | [`0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228`](https://explorer-sepolia.inkonchain.com/address/0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228) |
| VUG | [`0x09F7D7717a67783298d5Ca6C0fe036C39951D337`](https://explorer-sepolia.inkonchain.com/address/0x09F7D7717a67783298d5Ca6C0fe036C39951D337) |
| VGK | [`0x5a446C69c8C635ae473Ed859b1853Bd580F671B7`](https://explorer-sepolia.inkonchain.com/address/0x5a446C69c8C635ae473Ed859b1853Bd580F671B7) |
| VXUS | [`0x5FA09F20C04533a8564F280A9127Cf63aDE08621`](https://explorer-sepolia.inkonchain.com/address/0x5FA09F20C04533a8564F280A9127Cf63aDE08621) |
| SGOV | [`0x445B9A6B774E42BeF772671D2eEA6529bc28bC26`](https://explorer-sepolia.inkonchain.com/address/0x445B9A6B774E42BeF772671D2eEA6529bc28bC26) |
| SMH | [`0x30A37d04aFa2648FA4427b13c7ca380490F46BaD`](https://explorer-sepolia.inkonchain.com/address/0x30A37d04aFa2648FA4427b13c7ca380490F46BaD) |
| XLE | [`0x6F5C1fB59C4887dD3938fAF19D46C21d1dFF8cF6`](https://explorer-sepolia.inkonchain.com/address/0x6F5C1fB59C4887dD3938fAF19D46C21d1dFF8cF6) |
| XOP | [`0x73ad91867737622971D9f928AD65f2078efe6B0ec`](https://explorer-sepolia.inkonchain.com/address/0x73ad91867737622971D9f928AD65f2078efe6B0ec) |
| ITA | [`0xD4F23c93237D9594b13662D1Ce7B2078efe6B0ec`](https://explorer-sepolia.inkonchain.com/address/0xD4F23c93237D9594b13662D1Ce7B2078efe6B0ec) |
| AAPL | [`0x7D2C5FA48954F601faF30ed4A1611150E7CA72b8`](https://explorer-sepolia.inkonchain.com/address/0x7D2C5FA48954F601faF30ed4A1611150E7CA72b8) |
| NVDA | [`0x31026d0de55Eb7523EeADeBB58fec60876235f09`](https://explorer-sepolia.inkonchain.com/address/0x31026d0de55Eb7523EeADeBB58fec60876235f09) |
| TSLA | [`0xe212D68B4e18747b2bAb256090c1d09Ab9A5371a`](https://explorer-sepolia.inkonchain.com/address/0xe212D68B4e18747b2bAb256090c1d09Ab9A5371a) |
| DELL | [`0x5b493Fc8B66A6827f7A1658BFcFA01693534326e`](https://explorer-sepolia.inkonchain.com/address/0x5b493Fc8B66A6827f7A1658BFcFA01693534326e) |
| SMCI | [`0xab455997817026cCf4791Bb565189Dd873ECE675`](https://explorer-sepolia.inkonchain.com/address/0xab455997817026cCf4791Bb565189Dd873ECE675) |
| ANET | [`0x28AFF61B3801eE173CAfaeCdD5Ff78D65B478b3E`](https://explorer-sepolia.inkonchain.com/address/0x28AFF61B3801eE173CAfaeCdD5Ff78D65B478b3E) |
| VRT | [`0x63b25f2d081e02475F5B4F99f0966EA2e7a3C54a`](https://explorer-sepolia.inkonchain.com/address/0x63b25f2d081e02475F5B4F99f0966EA2e7a3C54a) |
| SNDK | [`0x4D1785862e24C9fC719B0C2ff3749C67fD315562`](https://explorer-sepolia.inkonchain.com/address/0x4D1785862e24C9fC719B0C2ff3749C67fD315562) |
| KLAC | [`0xf8D8c163e8B36799e4C719384AE20DD7873A5DfE`](https://explorer-sepolia.inkonchain.com/address/0xf8D8c163e8B36799e4C719384AE20DD7873A5DfE) |
| LRCX | [`0xb4288Ba6B4C61b64cc2d5d3Da1466dE6Cd904398`](https://explorer-sepolia.inkonchain.com/address/0xb4288Ba6B4C61b64cc2d5d3Da1466dE6Cd904398) |
| AMAT | [`0x83B11A1A46182B933674607B10643Ac97D104247`](https://explorer-sepolia.inkonchain.com/address/0x83B11A1A46182B933674607B10643Ac97D104247) |
| TER | [`0x2d3b2B1F563b7552f2aB24250164C4a7379a4c33`](https://explorer-sepolia.inkonchain.com/address/0x2d3b2B1F563b7552f2aB24250164C4a7379a4c33) |
| CEG | [`0xCFd3631169Ba659744A55904774B03346795e1F1`](https://explorer-sepolia.inkonchain.com/address/0xCFd3631169Ba659744A55904774B03346795e1F1) |
| GEV | [`0x3Ac370b7617350f3C7eff089541dd7F0E886f7e5`](https://explorer-sepolia.inkonchain.com/address/0x3Ac370b7617350f3C7eff089541dd7F0E886f7e5) |
| SMR | [`0x184D592eAf314c81877532CBda6Dc1fB8A74Ed68`](https://explorer-sepolia.inkonchain.com/address/0x184D592eAf314c81877532CBda6Dc1fB8A74Ed68) |
| ETN | [`0xc235cC4efCf42E98385A9132dac093d1426a5ED2`](https://explorer-sepolia.inkonchain.com/address/0xc235cC4efCf42E98385A9132dac093d1426a5ED2) |
| PWR | [`0xacF8600BCBfde39Fc5aF017E7d9009310bEC0D6B`](https://explorer-sepolia.inkonchain.com/address/0xacF8600BCBfde39Fc5aF017E7d9009310bEC0D6B) |
| APLD | [`0xCd258E69A5Cc4A7E6D6Ea7219355CeB0a3153472`](https://explorer-sepolia.inkonchain.com/address/0xCd258E69A5Cc4A7E6D6Ea7219355CeB0a3153472) |
| SLV | [`0x594332f239Fe809Ccf6B3Dd791Eb8252A3efA38c`](https://explorer-sepolia.inkonchain.com/address/0x594332f239Fe809Ccf6B3Dd791Eb8252A3efA38c) |
| PPLT | [`0x46ce7cd72763B784977349686AEA72B84d3F86B6`](https://explorer-sepolia.inkonchain.com/address/0x46ce7cd72763B784977349686AEA72B84d3F86B6) |
| PALL | [`0xEC9455F29A5a7A2a5F496bB7D4B428A1df3850dF`](https://explorer-sepolia.inkonchain.com/address/0xEC9455F29A5a7A2a5F496bB7D4B428A1df3850dF) |
| STRK | [`0x5fcAbBc1e9ab0bEca3d6cd9EF0257F2369230D12`](https://explorer-sepolia.inkonchain.com/address/0x5fcAbBc1e9ab0bEca3d6cd9EF0257F2369230D12) |
| BTGO | [`0x0a66152096f37F83D41c56534022e746B159b052`](https://explorer-sepolia.inkonchain.com/address/0x0a66152096f37F83D41c56534022e746B159b052) |

---

## Demo Path (Exact Steps)

A judge can verify the live product in under 3 minutes:

### 1. Connect Wallet
1. Go to [xlever.markets](https://xlever.markets)
2. Click **Connect Wallet** (top right)
3. Select any EVM wallet (MetaMask, etc.)
4. Switch network to **Ink Sepolia** when prompted

### 2. Open a Leveraged Position
1. Navigate to **Trading Terminal** (Screen 2)
2. Select an asset (e.g., QQQ)
3. Observe live Pyth price feed updating in real-time
4. Use the leverage slider to set -3.5x to +3.5x
5. Enter USDC amount and submit transaction
6. Confirm in wallet — transaction hits VaultSimple on Ink Sepolia

### 3. Run a Backtest
1. Navigate to **Analytics** (Screen 6)
2. Pick any asset and date range
3. Click **Run Backtest** — pulls real Yahoo Finance OHLCV data
4. Compare LTAP (fixed-entry) vs daily-reset (TQQQ-style) performance

### 4. Explore AI Agent
1. Navigate to **AI Agent** (Screen 3)
2. Start agent in **Safe** mode (monitor-only, no transactions)
3. Observe policy decisions and risk checks in the execution log

### 5. View Risk Sentinel
1. Navigate to **Risk Management** (Screen 5)
2. Observe current sentinel state and transition conditions
3. Note: this FSM runs client-side, not enforced on-chain

---

## Architecture (Shipped Path Highlighted)

```
                        xlever.markets
                             |
                    +--------+--------+
                    |                 |
              [9 HTML Screens]  [Data Proxy]
              Vite + Vanilla JS  server.py:8000
              TradingView Charts Yahoo Finance OHLCV
              Tailwind CSS
                    |
          +---------+---------+
          |         |         |
     [Wallet]  [Oracle]  [Agent]
     Reown     Pyth      Bounded Policy
     AppKit    Hermes    Executor (JS)
          |     30+ feeds  3 modes
          |         |     dry-run default
          v         v
    +-----+---------+-----+
    |  Ink Sepolia (live)  |      - - - - - - - - - - - - -
    |  33 modular Vaults   |      :  Planned (not deployed) :
    |  EVC + 5 modules     |      :  EulerHedgingModule    :
    |  PythOracleAdapter   |      :  Junior tranche funding:
    |  USDC + wQQQx/wSPYx  |      :  Solana / TON vaults  :
    +----------------------+      :                        :
                                  :  Euler V2 hedging       :
                                  - - - - - - - - - - - - -
```

Solid lines = shipped and verifiable. Dashed lines = designed, code exists, not deployed.

---

## Known Limitations

1. **Testnet only.** All contracts are on Ink Sepolia. No mainnet deployment. Tokens have no real value.
2. **VaultSimple is minimal.** No dynamic fees, no junior tranche, no on-chain auto-deleverage, no Euler hedging. These features exist in `contracts/src/xLever/experimental/` but the modular Vault exceeds deployment size limits.
3. **Risk sentinel is client-side.** The 4-state FSM runs in the browser, not enforced on-chain. A malicious user could bypass it.
4. **AI agent defaults to dry-run.** Real transaction execution is opt-in and requires a private key. The agent has TODOs around gas price fetching and actual PnL calculation.
5. **No production backend.** The FastAPI server (PostgreSQL, Redis, SIWE auth) is code-complete but not deployed to production hosting. The live site runs only the Yahoo Finance proxy.
6. **Solana and TON vaults are undeployed.** Anchor and Tact programs are written and compile, but have not been deployed to devnet/testnet.
7. **Dashboard uses demo data** until the user opens a real vault position.
8. **Order book is illustrative.** xLever is a vault-based protocol, not an order-book exchange.
9. **Ethereum Sepolia mirror** is deployed but the primary demo path uses Ink Sepolia.

---

## AI Usage Disclosure

| Tool | Purpose |
|------|---------|
| Claude Code | Code generation, architecture design, documentation |
| Stitch MCP | UI/UX design system and screen generation |
| Perplexity API | Real-time market intelligence (in-app integration) |

All AI-generated code was reviewed and integrated by the team.

---

## Team

- **Mads** — Euler V2 EVK integration, smart contract deployment
- **Eric** — AI agent architecture, backend, frontend
- **Maroua** — AI agent, demo video, UI/UX
