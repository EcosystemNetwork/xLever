# xLever Hackathon Plan

## Project Overview
Leveraged Tokenized Asset Protocol (LTAP) - enabling continuous leverage from -4× to +4× on tokenized assets (starting with xQQQ on xStocks) without liquidation risk.

## Current Status
✅ **Basic Setup Complete**
- Protocol architecture documented (`protocol.md`)
- Frontend scaffold (`frontend/index.html`)
- Backend server (`server/server.py`)

---

## Team Assignments & Workstreams

### 🔧 Workstream 1: Euler Vault Kit Integration & Deployment
**Owner:** Mads

#### Objectives
- Deploy and integrate Euler V2 Vault Kit (EVK)
- Set up Ethereum Vault Connector (EVC) for atomic looping
- Configure vault architecture for LTAP protocol

#### Tasks
- [ ] Deploy Euler V2 vault contracts
- [ ] Configure EVC for batched multicalls with deferred solvency checks
- [ ] Set up sub-accounts for isolated risk management
- [ ] Implement cross-vault collateralization
- [ ] Test atomic leverage loop construction (single transaction)
- [ ] Configure vault parameters for xQQQ asset
- [ ] Deploy to testnet and verify functionality
- [ ] Document deployment addresses and configuration

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
- [ ] Design AI agent architecture and decision-making framework
- [ ] Implement position entry/exit logic
  - [ ] Leverage selection algorithm (-4× to +4×)
  - [ ] Entry timing and signal processing
  - [ ] Exit strategy and profit-taking
- [ ] Build risk management system
  - [ ] Position sizing based on account health
  - [ ] Dynamic leverage adjustment
  - [ ] Stop-loss and take-profit automation
- [ ] Implement monitoring capabilities
  - [ ] Real-time PnL tracking
  - [ ] Health factor monitoring
  - [ ] Market condition analysis
- [ ] Create rebalancing logic
  - [ ] Auto-deleverage triggers
  - [ ] Position optimization
  - [ ] Fee minimization strategies
- [ ] Integrate with protocol smart contracts
  - [ ] Vault interaction (deposit/withdraw)
  - [ ] Position management calls
  - [ ] Oracle price feeds (Pyth)
- [ ] Build agent API/interface
- [ ] Testing and simulation
  - [ ] Backtesting framework
  - [ ] Paper trading mode
  - [ ] Performance metrics

#### Key Technical Requirements
- Integration with Euler V2 vaults via smart contracts
- Pyth oracle integration for price feeds (15-minute TWAP)
- Support for both long and short positions
- Handle Senior (leverage traders) and Junior (LP) positions
- Real-time monitoring and automated responses
- Gas optimization for transaction batching

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
- **xStocks:** xQQQ tokenized asset
- **USDC:** Base collateral asset

---

## Milestones

### Phase 1: Foundation (Current)
- [x] Protocol design complete
- [x] Basic frontend/backend setup
- [ ] Euler vault deployment (Mads)
- [ ] AI agent architecture design (Eric & Maroua)

### Phase 2: Core Implementation
- [ ] Vault integration complete and tested
- [ ] AI agent core logic implemented
- [ ] Testnet deployment and integration

### Phase 3: Testing & Refinement
- [ ] End-to-end testing
- [ ] AI agent backtesting and optimization
- [ ] Security review
- [ ] Gas optimization

### Phase 4: Demo & Launch
- [ ] Demo preparation
- [ ] Documentation finalization
- [ ] Mainnet deployment plan

---

## Technical Stack

### Smart Contracts
- Euler V2 EVK + EVC
- Solidity
- Foundry/Hardhat for deployment

### AI Agent
- Python (likely - TBD by Eric & Maroua)
- Web3.py / ethers.js for blockchain interaction
- ML framework (TBD)

### Frontend
- HTML/JavaScript (current)
- Web3 wallet integration

### Backend
- Python server (current: `server.py`)
- API for agent communication

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
