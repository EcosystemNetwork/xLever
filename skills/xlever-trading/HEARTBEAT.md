# xLever Trading — Heartbeat Checklist

This checklist is evaluated by the OpenClaw heartbeat (default: every 30 minutes). The agent reviews each item and only sends a notification if action is needed.

## Position Health

- [ ] Run `xlever_cli.py risk --chain ink-sepolia` to get full risk state
- [ ] Check if any position leverage exceeds the target band (target mode only)
- [ ] Check if any vault is in WARNING, RESTRICTED, or EMERGENCY state
- [ ] If vault is RESTRICTED/EMERGENCY: notify user immediately, recommend closing

## Oracle Freshness

- [ ] Check oracle price age for SPY and QQQ
- [ ] If any oracle is stale (>300s): warn user, flag that trading should pause

## Safe Mode Checks

- [ ] If mode is `safe`: verify no new positions were opened (they shouldn't be possible, but verify)
- [ ] If mode is `safe` and positions exist: remind user of open exposure

## Balance Check

- [ ] Run `xlever_cli.py balances --chain ink-sepolia`
- [ ] If ETH balance < 0.005: warn about insufficient gas for transactions
- [ ] If USDC balance is 0 and positions are open: note for awareness

## Target Mode Rebalance

- [ ] If mode is `target` and position leverage is outside band: suggest adjustment
- [ ] Report: "SPY position is 2.3x (target: 2.0x +/- 0.5) — within band" or flag if outside

## Summary Format

If everything is healthy, respond with:
```
HEARTBEAT_OK
```

If action needed, format as:
```
xLever Status Alert:
- [issue 1]
- [issue 2]
Recommended action: [suggestion]
```
