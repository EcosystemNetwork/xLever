# Getting Started with xLever

Get up and running with xLever in under 5 minutes.

---

## Step 1: Set Up Your Wallet

You need a Web3 wallet to interact with xLever. If you don't have one:

1. Install [MetaMask](https://metamask.io/) browser extension
2. Create a new wallet (save your seed phrase securely)
3. That's it — xLever will handle the network configuration

Already have a wallet? Skip to Step 2.

---

## Step 2: Get Testnet Funds

xLever runs on **Ink Sepolia** testnet. You need free testnet tokens:

### Testnet ETH (for gas)

Visit the Ink Sepolia faucet to get free testnet ETH:
- Request ETH from the Ink Sepolia faucet
- You only need a small amount (0.01 ETH is plenty)

### Testnet USDC (for deposits)

Once connected to xLever, you can mint testnet USDC through the platform interface.

> **Remember:** Testnet tokens have no real value. This is a sandbox environment.

---

## Step 3: Connect to xLever

1. Go to [xlever.markets](https://xlever.markets)
2. Click **Connect Wallet** (top-right)
3. Select your wallet from the modal
4. Approve the connection
5. Switch to **Ink Sepolia** when prompted

You should see:
- Your wallet address in the navbar
- "Ink Sepolia" network badge
- Green oracle status indicator

---

## Step 4: Open Your First Position

1. Navigate to **Trading Terminal** (Screen 2)
2. Select an asset — start with **QQQ** or **SPY** (most liquid)
3. Set leverage to **+2x** (a safe starting point)
4. Enter a USDC amount (e.g., 100 USDC)
5. Review the order summary:
   - Entry price from Pyth oracle
   - Effective exposure: 200 USDC (100 x 2x)
   - Max loss: 100 USDC (your deposit)
6. Click **Submit** and confirm in your wallet

Congratulations — you now have a fixed-entry leveraged position!

---

## Step 5: Monitor Your Position

### Dashboard (Screen 1)
View your portfolio value, PnL, and asset allocation.

### Risk Management (Screen 5)
Check the Risk Sentinel state. Green (NORMAL) means all systems are healthy.

### Trading Terminal (Screen 2)
Watch real-time price charts and adjust leverage as needed.

---

## What to Explore Next

| Want to... | Go to |
|-----------|-------|
| Compare LTAP vs daily-reset leverage | **Analytics** (Screen 6) — run a backtest |
| Try automated trading | **AI Agent** (Screen 3) — start in Safe/dry-run mode |
| Manage vault deposits | **Vault Management** (Screen 4) |
| Explore cross-chain lending | **Lending** (Screen 9) |
| Understand the risk system | **Risk Management** (Screen 5) |

---

## Key Concepts (60-Second Version)

| Concept | What It Means |
|---------|--------------|
| **Fixed-Entry Leverage** | Your leverage is locked at your entry price — no daily rebalancing |
| **PnL Formula** | `Deposit x Leverage x Price Change %` |
| **Max Loss** | Always equals your deposit — you can never lose more |
| **Risk Sentinel** | 4-state system (NORMAL → WARNING → RESTRICTED → EMERGENCY) that adjusts allowed operations |
| **Pyth Oracle** | Real-time price feeds from Pyth Network — the source of truth for all pricing |
| **VaultSimple** | The smart contract that holds your deposit and tracks your position |

---

## Common First-Time Questions

**Q: Is this real money?**
No. xLever is on Ink Sepolia testnet. All tokens are free testnet tokens with no real value.

**Q: Can I lose more than my deposit?**
No. Your maximum loss is always equal to your deposit amount, regardless of leverage.

**Q: What's the difference between xLever and TQQQ?**
TQQQ rebalances daily, causing volatility decay. xLever locks leverage at your entry price — no rebalancing, no decay. Use the backtester (Screen 6) to see the difference.

**Q: What does the risk sentinel banner in the navbar mean?**
It shows the current protocol risk state. Green (NORMAL) means everything is healthy. Yellow/orange/red means elevated risk conditions. See the [User Guide](USER-GUIDE.md#understanding-risk-states) for details.

**Q: Is the AI agent going to trade with my money?**
Not unless you explicitly enable live mode. The agent defaults to **dry-run** — it simulates decisions without sending real transactions.

---

## Next Steps

- Read the full [User Guide](USER-GUIDE.md) for detailed screen walkthroughs
- Check the [FAQ](FAQ.md) for more answers
- Review the [Glossary](GLOSSARY.md) if you encounter unfamiliar terms
- See [Troubleshooting](TROUBLESHOOTING.md) if you run into issues
