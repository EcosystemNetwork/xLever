use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::state::*;
use crate::XLeverError;
use crate::instructions::deposit::calculate_annual_fee_bps;

/// User closes or partially reduces a leveraged position.
///
/// `amount` — USDC to withdraw (pass u64::MAX for full close).
pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, XLeverError::ZeroAmount);

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

    let position = &ctx.accounts.position;
    let deposit = position.deposit_amount;
    let leverage = position.leverage_bps;
    let entry = position.entry_price;

    // --- Settle accrued fees -------------------------------------------
    let now = Clock::get()?.unix_timestamp;
    let elapsed = (now - position.last_fee_timestamp).max(0) as u64;
    let annual_bps = calculate_annual_fee_bps(leverage);
    let accrued_fee = (deposit as u128)
        .checked_mul(annual_bps as u128)
        .unwrap()
        .checked_mul(elapsed as u128)
        .unwrap()
        .checked_div(10_000u128 * SECONDS_PER_YEAR as u128)
        .unwrap() as u64;

    // --- PnL calculation -----------------------------------------------
    // pnl = deposit * leverage * (current / entry - 1)
    // Using fixed-point: pnl = deposit * leverage_bps * (current - entry) / (entry * 10_000)
    let price_delta = current_price as i128 - entry as i128;
    let pnl = (deposit as i128)
        .checked_mul(leverage as i128)
        .unwrap()
        .checked_mul(price_delta)
        .unwrap()
        .checked_div((entry as i128).checked_mul(10_000).unwrap())
        .unwrap();

    // Net value = deposit + pnl - accrued_fee - settled_fees
    let gross_value = (deposit as i128)
        .checked_add(pnl)
        .unwrap();
    let net_value = gross_value
        .checked_sub(accrued_fee as i128)
        .unwrap()
        .checked_sub(position.settled_fees as i128)
        .unwrap();

    // Clamp to zero (position can be underwater).
    let withdrawable = if net_value < 0 { 0u64 } else { net_value as u64 };

    // Determine actual withdrawal amount.
    let withdraw_amount = if amount >= withdrawable {
        withdrawable // full close
    } else {
        amount
    };

    let is_full_close = withdraw_amount >= withdrawable || amount == u64::MAX;

    // --- Transfer USDC from vault to user (PDA signer) -----------------
    if withdraw_amount > 0 {
        let pyth_feed_key = ctx.accounts.pyth_feed.key();
        let seeds: &[&[u8]] = &[
            b"vault",
            pyth_feed_key.as_ref(),
            &[vault.bump],
        ];
        let signer_seeds = &[seeds];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_usdc.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, withdraw_amount)?;
    }

    // --- Update vault state --------------------------------------------
    let vault = &mut ctx.accounts.vault;

    // Remove exposure.
    let abs_leverage = leverage.unsigned_abs() as u64;
    let close_deposit = if is_full_close { deposit } else { withdraw_amount };
    let notional = (close_deposit as u128)
        .checked_mul(abs_leverage as u128)
        .unwrap()
        .checked_div(10_000)
        .unwrap() as u64;

    if leverage > 0 {
        vault.gross_long_exposure = vault.gross_long_exposure.saturating_sub(notional);
        vault.net_exposure = vault.net_exposure.saturating_sub(notional as i128);
    } else if leverage < 0 {
        vault.gross_short_exposure = vault.gross_short_exposure.saturating_sub(notional);
        vault.net_exposure = vault.net_exposure.saturating_add(notional as i128);
    }

    vault.total_senior_deposits = vault.total_senior_deposits.saturating_sub(close_deposit);

    // Distribute accrued fee.
    crate::instructions::deposit::distribute_fee(vault, accrued_fee);

    // --- Update or close position --------------------------------------
    let position = &mut ctx.accounts.position;
    if is_full_close {
        position.is_active = false;
        position.deposit_amount = 0;
        position.leverage_bps = 0;
        position.settled_fees = 0;
    } else {
        let ratio = (withdraw_amount as u128)
            .checked_mul(10_000)
            .unwrap()
            .checked_div(withdrawable as u128)
            .unwrap() as u64;
        let reduce = (deposit as u128)
            .checked_mul(ratio as u128)
            .unwrap()
            .checked_div(10_000)
            .unwrap() as u64;
        position.deposit_amount = deposit.saturating_sub(reduce);
        position.settled_fees = position.settled_fees.saturating_add(accrued_fee);
        position.last_fee_timestamp = now;
    }

    msg!(
        "Withdraw {} USDC, pnl {}, full_close {}",
        withdraw_amount,
        pnl,
        is_full_close
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Withdraw<'info> {
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

    #[account(
        mut,
        constraint = user_usdc.mint == vault.usdc_mint @ XLeverError::InvalidMint,
        constraint = user_usdc.owner == user.key() @ XLeverError::InvalidOwner,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_usdc.key() == vault.usdc_token_account @ XLeverError::InvalidVaultToken,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
