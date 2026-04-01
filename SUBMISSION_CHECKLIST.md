# xLever Submission Checklist

## Repository

- [ ] README.md has judge quickstart with demo path
- [ ] README.md has "What is Real vs Simulated" section
- [ ] README.md has AI usage disclosure
- [ ] README.md has architecture overview
- [ ] deployment.json committed with full manifest
- [ ] protocol.md is clean and complete
- [ ] No secrets or API keys in repo (.env, credentials)
- [ ] Repository is public on GitHub

## Demo Video

- [ ] Video is under 2 minutes
- [ ] Shows real data (Yahoo Finance via backtesting engine)
- [ ] Shows LTAP vs daily-reset leverage comparison
- [ ] Shows trading terminal with leverage slider
- [ ] Explains "no liquidation" mechanism
- [ ] Mentions Euler V2 EVK integration
- [ ] Mentions AI agent with Perplexity
- [ ] Uploaded and link added to README

## Frontend

- [ ] All 7 screens load without errors
- [ ] Data server (`server.py`) starts cleanly
- [ ] Backtesting works with real QQQ/SPY data
- [ ] Leverage slider works -4x to +4x
- [ ] Charts render with TradingView
- [ ] localStorage caching works (survives page reload)
- [ ] No console errors in browser

## Documentation

- [ ] protocol.md — full architecture (80KB)
- [ ] hackPlan.md — team assignments and workstreams
- [ ] DEMO_SCRIPT.md — 2-minute video script with shot list
- [ ] deployment.json — machine-readable deployment manifest

## Contracts (if deployed before submission)

- [ ] Contract addresses added to deployment.json
- [ ] Explorer links added to README
- [ ] Network name specified (testnet/mainnet)
- [ ] Deployment transaction hashes recorded

## Consistency Check

- [ ] Leverage range says -4x to +4x everywhere (not 10x)
- [ ] "Euler V2 EVK" referenced consistently (not Euler V1)
- [ ] Fee formula matches: `0.5% + 0.5% x |leverage - 1|`
- [ ] Team names match across all docs
- [ ] GitHub repo URL is correct in deployment.json
- [ ] No TODO/FIXME left in user-facing files

## Final Steps

- [ ] `git pull` latest from all team members
- [ ] Run through judge quickstart yourself (fresh browser)
- [ ] Verify demo video link works
- [ ] Submit before deadline
