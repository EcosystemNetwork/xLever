# xLever Hackathon Plan

## Project Overview
Leveraged Tokenized Asset Protocol (LTAP) - enabling continuous leverage from -4× to +4× on tokenized assets (starting with xQQQ on xStocks) without liquidation risk.

## Current Status
✅ **Core Implementation Complete**
- Protocol architecture documented (`protocol.md`)
- Frontend fully built (9 interactive screens)
- Backend server + full FastAPI application
- Wallet integration (4 chains via Reown AppKit)
- Smart contracts deployed to Ink Sepolia
- Pyth oracle integration live
- Risk engine + 4-state sentinel operational
- AI agent executor with 3 policy modes
- Multi-agent coordinator (swarm orchestration)
- News intelligence pipeline (ingestion, analysts, signals)
- OpenBB market intelligence integration
- Admin dashboard with activity analytics

---

## Team Assignments & Workstreams

### 🔧 Workstream 1: Euler Vault Kit Integration & Deployment
**Owner:** Mads

#### Objectives
- Deploy and integrate Euler V2 Vault Kit (EVK)
- Set up Ethereum Vault Connector (EVC) for atomic looping
- Configure vault architecture for LTAP protocol

#### Tasks
- [x] Deploy Euler V2 vault contracts
- [x] Configure EVC for batched multicalls with deferred solvency checks
- [x] Set up sub-accounts for isolated risk management
- [x] Implement cross-vault collateralization
- [x] Test atomic leverage loop construction (single transaction)
- [x] Configure vault parameters for xQQQ asset
- [x] Deploy to testnet and verify functionality
- [x] Document deployment addresses and configuration

#### Key Technical Requirements
- Euler V2 modular vault architecture
- EVC deferred checks for gas-efficient leverage (no flash loans needed)
- Support for -4× to +4× leverage range
- Integration with Pyth oracles (15-minute TWAP)

---

### 🤖 Workstream 2: AI Agent for Automated Trading & Position Management
**Owners:** Eric & Maroua

#### Objectives
- Build AI agent that can autonomously trade and manage leveraged positions
- Implement intelligent position sizing and risk management
- Create monitoring and rebalancing logic

#### Tasks
- [x] Design AI agent architecture and decision-making framework
- [x] Integrate Perplexity API for real-time information access
  - [x] Set up API credentials and connection
  - [x] Implement market news and sentiment analysis (news-analysts.js)
  - [x] Real-time event monitoring (news-ingest.js + SSE streaming)
  - [x] Context-aware decision making with current market conditions (signal-aggregator.js)
- [x] Implement position entry/exit logic
  - [x] Leverage selection algorithm (-4× to +4×)
  - [x] Entry timing and signal processing
  - [x] Exit strategy and profit-taking
- [x] Build risk management system
  - [x] Position sizing based on account health
  - [x] Dynamic leverage adjustment
  - [x] Stop-loss and take-profit automation
- [x] Implement monitoring capabilities
  - [x] Real-time PnL tracking
  - [x] Health factor monitoring (risk-live.js)
  - [x] Market condition analysis (OpenBB + news pipeline)
- [x] Create rebalancing logic
  - [x] Auto-deleverage triggers (risk-engine.js, 5-level cascade)
  - [x] Position optimization
  - [x] Fee minimization strategies
- [x] Integrate with protocol smart contracts
  - [x] Vault interaction (deposit/withdraw) via contracts.js
  - [x] Position management calls
  - [x] Oracle price feeds (Pyth) via pyth.js
- [x] Build agent API/interface
- [x] Testing and simulation
  - [x] Backtesting framework (app.js, 1400+ LOC)
  - [x] Paper trading mode (dry-run default in agent-executor.js)
  - [x] Performance metrics
#### Key Technical Requirements
- **Perplexity API:** Real-time market intelligence, news, and sentiment analysis
- Integration with Euler V2 vaults via smart contracts
- Pyth oracle integration for price feeds (15-minute TWAP)
- Support for both long and short positions
- Handle Senior (leverage traders) and Junior (LP) positions
- Real-time monitoring and automated responses
- Gas optimization for transaction batching

---

### 🎯 Workstream 3: QA, Marketing & Pitch
**Owner:** Maroua

#### Objectives
- Ensure product quality through thorough QA testing and bug fixing
- Create compelling marketing and pitch materials
- Refine AI agent policies and risk documentation

#### Tasks
- [ ] **Agent Policies & Risk Materials**
  - [ ] Document and refine the 3 agent policy modes (Safe, Target Exposure, Accumulate)
  - [ ] Create clear risk disclosures and policy explanations for users
  - [ ] Review risk engine parameters and thresholds for accuracy
  - [ ] Prepare agent policy comparison charts for pitch materials
- [ ] **Marketing Materials**
  - [ ] Design pitch deck / presentation slides
  - [ ] Write project summary and value proposition
  - [ ] Prepare talking points and key differentiators
  - [ ] Create visual assets (diagrams, architecture overview, screenshots)
- [ ] **QA Testing & Bug Fixes**
  - [ ] End-to-end testing across all 9 frontend screens
  - [ ] Wallet connection testing (Ethereum, Ink Sepolia, Solana, TON)
  - [ ] AI agent flow testing (executor, coordinator, news pipeline)
  - [ ] API endpoint validation (all backend routes)
  - [ ] Cross-browser and responsive testing
  - [ ] Log and triage bugs, coordinate fixes with Eric
- [ ] **Pitch Video** (<2 minutes)
  - [ ] Script and storyboard
  - [ ] Screen recordings of xLever interface
  - [ ] AI agent in action demonstration
  - [ ] Voiceover explaining key features
  - [ ] Final editing and polish
- [ ] **Refinement & Polish**
  - [ ] UI/UX review and consistency pass
  - [ ] Copy editing across all screens and docs
  - [ ] Final submission review against hackathon criteria

---

## Integration Points

### Between Workstreams
- **Vault Contracts ↔ AI Agent:** Agent needs contract ABIs and addresses from Mads' deployment
- **Oracle Integration:** Both workstreams use Pyth oracles - coordinate on data format
- **Position Management:** AI agent calls vault functions deployed by Mads
- **Testing:** Coordinate on testnet deployment for agent testing

### External Dependencies
- **Euler V2 EVK:** Core vault infrastructure
- **Pyth Network:** Price oracle (15-minute TWAP)
- **Perplexity API:** Real-time market intelligence and news for AI agent
- **xStocks:** xQQQ tokenized asset
- **USDC:** Base collateral asset

---

## Milestones

### Phase 1: Foundation
- [x] Protocol design complete
- [x] Basic frontend/backend setup
- [x] Euler vault deployment (Mads)
- [x] AI agent architecture design (Eric & Maroua)

### Phase 2: Core Implementation
- [x] Vault integration complete and tested
- [x] AI agent core logic implemented
- [x] Testnet deployment and integration
- [x] 9-screen frontend with Bloomberg Terminal aesthetic
- [x] Pyth oracle integration (live Hermes feeds)
- [x] Risk sentinel engine (4-state, 5-level auto-deleverage)
- [x] OpenBB market intelligence pipeline
- [x] News ingestion + analyst scoring + signal aggregation
- [x] Multi-agent swarm coordinator
- [x] Admin dashboard with activity analytics

### Phase 3: Testing & Refinement (Current)
- [x] Backtesting engine with real Yahoo Finance data
- [x] Risk engine test harness
- [ ] End-to-end integration testing
- [ ] AI agent backtesting and optimization
- [ ] Security review
- [ ] Gas optimization

### Phase 4: Demo & Launch
- [x] Demo script prepared (DEMO_SCRIPT.md)
- [x] Submission checklist (SUBMISSION_CHECKLIST.md)
- [ ] Demo video (Maroua)
- [ ] Documentation finalization
- [ ] Mainnet deployment plan

---

## Technical Stack

### Smart Contracts
- Euler V2 EVK + EVC
- Solidity (Vault, VaultSimple, VaultFactory, 7 modules)
- Foundry for deployment (23 scripts)
- Deployed to Ink Sepolia testnet

### AI Agent
- JavaScript (frontend) — agent-executor.js, agent-coordinator.js
- 3 policy modes: Safe, Target Exposure, Accumulate
- News intelligence: news-ingest.js, news-analysts.js, signal-aggregator.js
- Perplexity API for real-time market intelligence

### Frontend
- Vite + Vanilla JS/CSS (9 interactive screens, 12K+ LOC)
- TradingView Lightweight Charts
- Reown AppKit (Ethereum, Ink Sepolia, Solana, TON)
- Bloomberg Terminal dark aesthetic

### Backend
- Python — simple HTTP proxy (server.py) + FastAPI (server/api/)
- PostgreSQL + Redis via Docker
- Routes: prices, positions, agents, alerts, openbb, news (SSE), admin, users

---

## Communication & Coordination

### Daily Sync
- Quick standup to share progress
- Blockers and dependencies
- Integration coordination

### Shared Resources
- Contract addresses and ABIs (Mads → Eric & Maroua)
- API endpoints and schemas
- Test accounts and credentials
- **⚠️ Environment Files:** Team members need to set up their own `.env` files — figure out the required env vars and configure them locally

---

## Risk Considerations

### Technical Risks
- Euler V2 integration complexity
- AI agent decision-making reliability
- Gas costs for automated trading
- Oracle latency and accuracy

### Mitigation Strategies
- Extensive testnet testing before mainnet
- AI agent simulation and backtesting
- Circuit breakers and safety limits
- Gradual rollout with position caps

---

## Resources

- **Protocol Docs:** `protocol.md`
- **Euler V2 Docs:** [Euler Finance Documentation]
- **Pyth Network:** [Pyth Oracle Documentation]
- **xStocks:** [xStocks Platform]

---

## Notes
- Max leverage: -4× to +4×
- No liquidation for users (risk socialized via Junior tranche)
- Fixed-entry leverage (no daily rebalancing)
- All pricing uses 15-minute TWAP from Pyth
- Dynamic spread pricing based on spot-TWAP divergence
