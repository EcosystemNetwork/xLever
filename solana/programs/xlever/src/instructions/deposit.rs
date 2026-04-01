use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::state::*;
use crate::XLeverError;

/// User opens or adds to a leveraged position.
///
/// `amount`       — USDC (6 decimals) to deposit.
/// `leverage_bps` — desired leverage in basis points (-40000 .. +40000).
pub fn handler(
    ctx: Context<Deposit>,
    amount: u64,
    leverage_bps: i32,
) -> Result<()> {
    require!(amount > 0, XLeverError::ZeroAmount);
    require!(
        leverage_bps >= MIN_LEVERAGE_BPS && leverage_bps <= MAX_LEVERAGE_BPS,
        XLeverError::LeverageOutOfRange
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
    let current_price = price_data
        .price
        .try_into()
        .map_err(|_| XLeverError::InvalidPrice)?;
    require!(current_price > 0u64, XLeverError::InvalidPrice);

    // --- Calculate entry fee -------------------------------------------
    let fee = calculate_annual_fee_bps(leverage_bps);
    // Pro-rated entry fee: charge 1 day's worth as upfront cost.
    let entry_fee = (amount as u128)
        .checked_mul(fee as u128)
        .ok_or(XLeverError::MathOverflow)?
        .checked_div(10_000 * 365)
        .ok_or(XLeverError::MathOverflow)? as u64;
    let net_deposit = amount.checked_sub(entry_fee).ok_or(XLeverError::MathOverflow)?;

    // --- Transfer USDC from user to vault ------------------------------
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.vault_usdc.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    // --- Update or create position -------------------------------------
    let position = &mut ctx.accounts.position;
    if position.is_active {
        // Adding to existing position — blend entry price.
        let old_notional = (position.deposit_amount as u128)
            .checked_mul(position.entry_price as u128)
            .ok_or(XLeverError::MathOverflow)?;
        let new_notional = (net_deposit as u128)
            .checked_mul(current_price as u128)
            .ok_or(XLeverError::MathOverflow)?;
        let total_deposit = position.deposit_amount as u128 + net_deposit as u128;
        require!(total_deposit > 0, XLeverError::MathOverflow);
        let blended_price = old_notional
            .checked_add(new_notional)
            .ok_or(XLeverError::MathOverflow)?
            .checked_div(total_deposit)
            .ok_or(XLeverError::MathOverflow)?;

        position.deposit_amount = total_deposit as u64;
        position.entry_price = blended_price as u64;
        position.leverage_bps = leverage_bps;
    } else {
        position.owner = ctx.accounts.user.key();
        position.vault = ctx.accounts.vault.key();
        position.deposit_amount = net_deposit;
        position.leverage_bps = leverage_bps;
        position.entry_price = current_price;
        position.last_fee_timestamp = Clock::get()?.unix_timestamp;
        position.settled_fees = 0;
        position.is_active = true;
        position.bump = ctx.bumps.position;
        position._reserved = [0u8; 32];
    }

    // --- Update vault pool state ---------------------------------------
    let vault = &mut ctx.accounts.vault;
    vault.total_senior_deposits = vault
        .total_senior_deposits
        .checked_add(net_deposit)
        .ok_or(XLeverError::MathOverflow)?;

    // Notional exposure = deposit * |leverage| / 10_000
    let abs_leverage = leverage_bps.unsigned_abs() as u64;
    let notional = (net_deposit as u128)
        .checked_mul(abs_leverage as u128)
        .ok_or(XLeverError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(XLeverError::MathOverflow)? as u64;

    if leverage_bps > 0 {
        vault.gross_long_exposure = vault
            .gross_long_exposure
            .checked_add(notional)
            .ok_or(XLeverError::MathOverflow)?;
        vault.net_exposure = vault
            .net_exposure
            .checked_add(notional as i128)
            .ok_or(XLeverError::MathOverflow)?;
    } else if leverage_bps < 0 {
        vault.gross_short_exposure = vault
            .gross_short_exposure
            .checked_add(notional)
            .ok_or(XLeverError::MathOverflow)?;
        vault.net_exposure = vault
            .net_exposure
            .checked_sub(notional as i128)
            .ok_or(XLeverError::MathOverflow)?;
    }

    // Distribute entry fee.
    distribute_fee(vault, entry_fee);

    msg!(
        "Deposit {} USDC at {}x leverage, price {}",
        amount,
        leverage_bps,
        current_price
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Fee helpers
// ---------------------------------------------------------------------------

/// Annual fee in bps: 0% for 0x/1x, then 50 + 50 * (|lev| - 10_000) / 10_000.
pub fn calculate_annual_fee_bps(leverage_bps: i32) -> u64 {
    let abs_lev = leverage_bps.unsigned_abs() as u64;
    if abs_lev <= 10_000 {
        return 0; // 0x or 1x — no fee
    }
    let units_above_one = abs_lev.saturating_sub(10_000); // in bps
    BASE_FEE_BPS + PER_UNIT_FEE_BPS * units_above_one / 10_000
}

/// Split a fee into junior / insurance / treasury and credit vault accumulators.
pub fn distribute_fee(vault: &mut Vault, fee: u64) {
    let junior = fee * JUNIOR_FEE_SPLIT / 10_000;
    let insurance = fee * INSURANCE_FEE_SPLIT / 10_000;
    // treasury portion stays in the vault USDC account for admin withdrawal

    vault.total_junior_deposits = vault.total_junior_deposits.saturating_add(junior);
    vault.insurance_fund = vault.insurance_fund.saturating_add(insurance);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", pyth_feed.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: Pyth price-feed account — must match vault.pyth_feed.
    #[account(
        constraint = pyth_feed.key() == vault.pyth_feed @ XLeverError::InvalidPriceFeed
    )]
    pub pyth_feed: UncheckedAccount<'info>,

    /// Pyth price-update account (posted by Pyth receiver program).
    pub price_update: Account<'info, PriceUpdateV2>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", vault.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    /// User's USDC token account.
    #[account(
        mut,
        constraint = user_usdc.mint == vault.usdc_mint @ XLeverError::InvalidMint,
        constraint = user_usdc.owner == user.key() @ XLeverError::InvalidOwner,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    /// Vault's USDC token account.
    #[account(
        mut,
        constraint = vault_usdc.key() == vault.usdc_token_account @ XLeverError::InvalidVaultToken,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
