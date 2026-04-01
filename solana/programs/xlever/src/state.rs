use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// Vault — one per asset (e.g. QQQ/USD, SPY/USD, NVDA/USD)
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Admin who created and controls this vault.
    pub admin: Pubkey,

    /// USDC SPL-token mint accepted by this vault.
    pub usdc_mint: Pubkey,

    /// Pyth price-feed account for the underlying asset.
    pub pyth_feed: Pubkey,

    /// Vault's USDC token account (ATA held by the vault PDA).
    pub usdc_token_account: Pubkey,

    // -- Pool accounting (mirrors EVM PoolState) --------------------------

    /// Total USDC deposited by leveraged (senior) users.
    pub total_senior_deposits: u64,

    /// Total USDC deposited by junior-tranche LPs.
    pub total_junior_deposits: u64,

    /// Total outstanding junior shares (for pro-rata redemption).
    pub total_junior_shares: u64,

    /// Protocol backstop reserve, accumulated from fee splits.
    pub insurance_fund: u64,

    /// Signed net directional exposure in USDC terms.
    pub net_exposure: i128,

    /// Sum of all long notional.
    pub gross_long_exposure: u64,

    /// Sum of all short notional.
    pub gross_short_exposure: u64,

    /// PDA bump seed.
    pub bump: u8,

    /// Protocol state: 0 = active, 1 = paused.
    pub protocol_state: u8,

    /// Reserved space for future upgrades (keeps account size stable).
    pub _reserved: [u8; 64],
}

// ---------------------------------------------------------------------------
// Position — PDA per (user, vault), stores one leveraged position
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Position {
    /// Owner of this position.
    pub owner: Pubkey,

    /// Vault this position belongs to.
    pub vault: Pubkey,

    /// USDC principal the user deposited (after entry fees).
    pub deposit_amount: u64,

    /// Signed leverage in basis points: -40_000 .. +40_000  (-4x .. +4x).
    pub leverage_bps: i32,

    /// Oracle price at entry (Pyth 8-decimal fixed-point stored as u64).
    pub entry_price: u64,

    /// Unix timestamp of last fee settlement.
    pub last_fee_timestamp: i64,

    /// Cumulative fees already settled against this position.
    pub settled_fees: u64,

    /// Whether the position is active.
    pub is_active: bool,

    /// PDA bump seed.
    pub bump: u8,

    /// Reserved space for future upgrades.
    pub _reserved: [u8; 32],
}

// ---------------------------------------------------------------------------
// JuniorDeposit — PDA per (user, vault), tracks LP's junior-tranche stake
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct JuniorDeposit {
    /// LP who made this deposit.
    pub owner: Pubkey,

    /// Vault this junior deposit belongs to.
    pub vault: Pubkey,

    /// Number of junior shares the LP holds.
    pub shares: u64,

    /// PDA bump seed.
    pub bump: u8,

    pub _reserved: [u8; 32],
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const MAX_LEVERAGE_BPS: i32 = 40_000;  // +4x
pub const MIN_LEVERAGE_BPS: i32 = -40_000; // -4x

/// Annualized base fee in bps for leverage above 1x.
/// Fee model: 0% for 0x/1x,  base 0.5% + 0.5% per unit above 1x.
pub const BASE_FEE_BPS: u64 = 50;       // 0.50%
pub const PER_UNIT_FEE_BPS: u64 = 50;   // 0.50% per |leverage - 1|

/// Seconds in a 365.25-day year (matches EVM FeeEngine denominator).
pub const SECONDS_PER_YEAR: u64 = 31_557_600;

/// Fee split percentages (bps out of 10_000).
pub const JUNIOR_FEE_SPLIT: u64 = 7_000;    // 70%
pub const INSURANCE_FEE_SPLIT: u64 = 2_000; // 20%
pub const TREASURY_FEE_SPLIT: u64 = 1_000;  // 10%

/// Maximum price age (seconds) before we reject a Pyth update.
pub const MAX_PRICE_AGE_SECS: u64 = 60;
