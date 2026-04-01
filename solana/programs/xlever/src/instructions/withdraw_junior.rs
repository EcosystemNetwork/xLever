use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::*;
use crate::XLeverError;

/// LP redeems junior shares for USDC.
///
/// Redemption value = shares * total_junior_deposits / total_junior_shares.
pub fn handler(ctx: Context<WithdrawJunior>, shares: u64) -> Result<()> {
    require!(shares > 0, XLeverError::ZeroAmount);

    let junior = &ctx.accounts.junior_deposit;
    require!(junior.shares >= shares, XLeverError::InsufficientShares);
    require!(
        junior.owner == ctx.accounts.user.key(),
        XLeverError::Unauthorized
    );

    let vault = &ctx.accounts.vault;
    require!(vault.protocol_state == 0, XLeverError::ProtocolPaused);
    require!(vault.total_junior_shares > 0, XLeverError::ZeroShares);

    // --- Calculate USDC to return --------------------------------------
    let usdc_amount = (shares as u128)
        .checked_mul(vault.total_junior_deposits as u128)
        .unwrap()
        .checked_div(vault.total_junior_shares as u128)
        .unwrap() as u64;
    require!(usdc_amount > 0, XLeverError::ZeroAmount);

    // --- Transfer USDC from vault to LP (PDA signer) -------------------
    let pyth_feed_key = vault.pyth_feed;
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
    token::transfer(transfer_ctx, usdc_amount)?;

    // --- Update vault state --------------------------------------------
    let vault = &mut ctx.accounts.vault;
    vault.total_junior_deposits = vault.total_junior_deposits.saturating_sub(usdc_amount);
    vault.total_junior_shares = vault.total_junior_shares.saturating_sub(shares);

    // --- Update junior deposit account ---------------------------------
    let junior = &mut ctx.accounts.junior_deposit;
    junior.shares = junior.shares.saturating_sub(shares);

    msg!("Junior withdraw {} shares -> {} USDC", shares, usdc_amount);

    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct WithdrawJunior<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.pyth_feed.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [b"junior", vault.key().as_ref(), user.key().as_ref()],
        bump = junior_deposit.bump,
    )]
    pub junior_deposit: Account<'info, JuniorDeposit>,

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
