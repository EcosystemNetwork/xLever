use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::state::*;
use crate::XLeverError;
use crate::instructions::deposit::calculate_annual_fee_bps;

/// User adjusts the leverage on an existing position.
///
/// Settles accrued fees, re-prices entry, and updates vault exposure.
pub fn handler(ctx: Context<AdjustLeverage>, new_leverage_bps: i32) -> Result<()> {
    require!(
        new_leverage_bps >= MIN_LEVERAGE_BPS && new_leverage_bps <= MAX_LEVERAGE_BPS,
        XLeverError::LeverageOutOfRange
    );

    let position = &ctx.accounts.position;
    require!(position.is_active, XLeverError::PositionNotActive);
    require!(
        position.owner == ctx.accounts.user.key(),
        XLeverError::Unauthorized
    );

    let vault = &ctx.accounts.vault;
    require!(vault.protocol_state == 0, XLeverError::ProtocolPaused);

    // --- Read Pyth price ------------------------------------------------
    let price_update = &ctx.accounts.price_update;
    let price_data = price_update.get_price_no_older_than(
        &Clock::get()?,
        MAX_PRICE_AGE_SECS,
        &ctx.accounts.pyth_feed.key().to_bytes(),
    )?;
    let current_price: u64 = price_data
        .price
        .try_into()
        .map_err(|_| XLeverError::InvalidPrice)?;
    require!(current_price > 0, XLeverError::InvalidPrice);

    let old_leverage = position.leverage_bps;
    let deposit = position.deposit_amount;

    // --- Settle accrued fees -------------------------------------------
    let now = Clock::get()?.unix_timestamp;
    let elapsed = (now - position.last_fee_timestamp).max(0) as u64;
    let annual_bps = calculate_annual_fee_bps(old_leverage);
    let accrued_fee = (deposit as u128)
        .checked_mul(annual_bps as u128)
        .ok_or(XLeverError::MathOverflow)?
        .checked_mul(elapsed as u128)
        .ok_or(XLeverError::MathOverflow)?
        .checked_div(10_000u128 * SECONDS_PER_YEAR as u128)
        .ok_or(XLeverError::MathOverflow)? as u64;

    // --- Remove old exposure from vault --------------------------------
    let vault = &mut ctx.accounts.vault;

    let old_abs = old_leverage.unsigned_abs() as u64;
    let old_notional = (deposit as u128)
        .checked_mul(old_abs as u128)
        .ok_or(XLeverError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(XLeverError::MathOverflow)? as u64;

    if old_leverage > 0 {
        vault.gross_long_exposure = vault.gross_long_exposure.saturating_sub(old_notional);
        vault.net_exposure = vault.net_exposure.saturating_sub(old_notional as i128);
    } else if old_leverage < 0 {
        vault.gross_short_exposure = vault.gross_short_exposure.saturating_sub(old_notional);
        vault.net_exposure = vault.net_exposure.saturating_add(old_notional as i128);
    }

    // --- Add new exposure ----------------------------------------------
    let new_abs = new_leverage_bps.unsigned_abs() as u64;
    let new_notional = (deposit as u128)
        .checked_mul(new_abs as u128)
        .ok_or(XLeverError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(XLeverError::MathOverflow)? as u64;

    if new_leverage_bps > 0 {
        vault.gross_long_exposure = vault
            .gross_long_exposure
            .checked_add(new_notional)
            .ok_or(XLeverError::MathOverflow)?;
        vault.net_exposure = vault
            .net_exposure
            .checked_add(new_notional as i128)
            .ok_or(XLeverError::MathOverflow)?;
    } else if new_leverage_bps < 0 {
        vault.gross_short_exposure = vault
            .gross_short_exposure
            .checked_add(new_notional)
            .ok_or(XLeverError::MathOverflow)?;
        vault.net_exposure = vault
            .net_exposure
            .checked_sub(new_notional as i128)
            .ok_or(XLeverError::MathOverflow)?;
    }

    // Distribute accrued fee.
    crate::instructions::deposit::distribute_fee(vault, accrued_fee);

    // --- Update position -----------------------------------------------
    let position = &mut ctx.accounts.position;
    position.leverage_bps = new_leverage_bps;
    position.entry_price = current_price; // reset entry to current price on adjustment
    position.last_fee_timestamp = now;
    position.settled_fees = position.settled_fees.saturating_add(accrued_fee);

    msg!(
        "Adjusted leverage from {} to {} bps at price {}",
        old_leverage,
        new_leverage_bps,
        current_price
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AdjustLeverage<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", pyth_feed.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: Pyth price-feed — must match vault.pyth_feed.
    #[account(
        constraint = pyth_feed.key() == vault.pyth_feed @ XLeverError::InvalidPriceFeed
    )]
    pub pyth_feed: UncheckedAccount<'info>,

    pub price_update: Account<'info, PriceUpdateV2>,

    #[account(
        mut,
        seeds = [b"position", vault.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
}
