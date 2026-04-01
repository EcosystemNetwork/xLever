// ═══════════════════════════════════════════════════════════════
// xLever TON — Shared Message Types
// ═══════════════════════════════════════════════════════════════

// ── Position data stored per user ──
struct Position {
    deposit_amount: Int as uint128;
    leverage_bps: Int as int32;       // -40000 to +40000 (-4x to +4x)
    entry_twap: Int as uint128;       // price at entry (scaled 1e18)
    last_fee_timestamp: Int as uint64;
    is_active: Bool;
}

// ── Vault info returned by getters ──
struct VaultInfo {
    asset_symbol: String;
    pyth_feed_id: Int as uint256;
    total_senior_deposits: Int as uint128;
    total_junior_deposits: Int as uint128;
    insurance_fund: Int as uint128;
    net_exposure: Int as int256;
    protocol_state: Int as uint8;
}

// ── User messages to Vault ──

// opcode 0x1001
message(0x1001) Deposit {
    amount: Int as uint128;
    leverage_bps: Int as int32;       // -40000..+40000
    query_id: Int as uint64;
}

// opcode 0x1002
message(0x1002) Withdraw {
    amount: Int as uint128;
    query_id: Int as uint64;
}

// opcode 0x1003
message(0x1003) AdjustLeverage {
    new_leverage_bps: Int as int32;
    query_id: Int as uint64;
}

// opcode 0x1004
message(0x1004) DepositJunior {
    amount: Int as uint128;
    query_id: Int as uint64;
}

// opcode 0x1005
message(0x1005) WithdrawJunior {
    shares: Int as uint128;
    query_id: Int as uint64;
}

// ── Admin messages ──

// opcode 0x2001
message(0x2001) UpdatePythFeed {
    new_feed_id: Int as uint256;
}

// opcode 0x2002
message(0x2002) SetProtocolState {
    new_state: Int as uint8;          // 0=Active, 1=Paused, 2=EmergencyExit
}

// opcode 0x2003
message(0x2003) WithdrawInsurance {
    amount: Int as uint128;
    recipient: Address;
}

// ── Factory messages ──

// opcode 0x3001
message(0x3001) CreateVault {
    asset_symbol: String;
    pyth_feed_id: Int as uint256;
    usdc_address: Address;
    query_id: Int as uint64;
}

// opcode 0x3002
message(0x3002) VaultCreated {
    vault_address: Address;
    asset_symbol: String;
    query_id: Int as uint64;
}

// ── Internal notifications ──

// opcode 0x4001
message(0x4001) DepositNotification {
    amount: Int as uint128;
    sender: Address;
    query_id: Int as uint64;
}

// opcode 0x4002
message(0x4002) WithdrawNotification {
    amount: Int as uint128;
    recipient: Address;
    query_id: Int as uint64;
}
