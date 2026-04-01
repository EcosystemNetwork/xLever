use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("xLvr1111111111111111111111111111111111111111");

#[program]
pub mod xlever {
    use super::*;

    /// Admin creates a vault for a given Pyth price-feed (one vault per asset).
    ///
    /// PDA seeds: `[b"vault", pyth_feed.key().as_ref()]`
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault::handler(ctx)
    }

    /// User opens or adds to a leveraged position.
    ///
    /// * `amount`       — USDC to deposit (6 decimals).
    /// * `leverage_bps` — leverage in basis points, -40000..+40000 (-4x..+4x).
    ///
    /// PDA seeds (position): `[b"position", vault.key().as_ref(), user.key().as_ref()]`
    pub fn deposit(ctx: Context<Deposit>, amount: u64, leverage_bps: i32) -> Result<()> {
        instructions::deposit::handler(ctx, amount, leverage_bps)
    }

    /// User closes or partially reduces a leveraged position.
    ///
    /// * `amount` — USDC to withdraw. Pass `u64::MAX` for full close.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    /// User changes leverage on an existing position.
    ///
    /// Settles accrued fees, re-prices entry to current oracle price,
    /// and swaps old exposure for new exposure in vault accounting.
    pub fn adjust_leverage(ctx: Context<AdjustLeverage>, new_leverage_bps: i32) -> Result<()> {
        instructions::adjust_leverage::handler(ctx, new_leverage_bps)
    }

    /// LP deposits USDC into the junior (first-loss) tranche.
    ///
    /// Shares are minted pro-rata; first depositor gets 1:1.
    pub fn deposit_junior(ctx: Context<DepositJunior>, amount: u64) -> Result<()> {
        instructions::deposit_junior::handler(ctx, amount)
    }

    /// LP redeems junior shares for USDC.
    ///
    /// Redemption price = total_junior_deposits / total_junior_shares.
    pub fn withdraw_junior(ctx: Context<WithdrawJunior>, shares: u64) -> Result<()> {
        instructions::withdraw_junior::handler(ctx, shares)
    }
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

#[error_code]
pub enum XLeverError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Leverage must be between -40000 and +40000 bps (-4x to +4x)")]
    LeverageOutOfRange,

    #[msg("Protocol is paused")]
    ProtocolPaused,

    #[msg("Invalid oracle price")]
    InvalidPrice,

    #[msg("Price feed does not match vault")]
    InvalidPriceFeed,

    #[msg("Token mint does not match vault")]
    InvalidMint,

    #[msg("Token account owner mismatch")]
    InvalidOwner,

    #[msg("Vault token account mismatch")]
    InvalidVaultToken,

    #[msg("Position is not active")]
    PositionNotActive,

    #[msg("Unauthorized — signer is not the position owner")]
    Unauthorized,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Insufficient junior shares")]
    InsufficientShares,

    #[msg("Computed zero shares — deposit too small")]
    ZeroShares,
}
