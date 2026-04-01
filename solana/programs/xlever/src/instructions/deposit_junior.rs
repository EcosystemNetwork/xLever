use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::*;
use crate::XLeverError;

/// LP deposits USDC into the junior (first-loss) tranche.
///
/// Shares are minted proportionally: shares = amount * total_shares / total_junior_deposits.
/// First depositor gets 1:1.
pub fn handler(ctx: Context<DepositJunior>, amount: u64) -> Result<()> {
    require!(amount > 0, XLeverError::ZeroAmount);

    let vault = &ctx.accounts.vault;
    require!(vault.protocol_state == 0, XLeverError::ProtocolPaused);

    // --- Transfer USDC from LP to vault --------------------------------
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.vault_usdc.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, amount)?;

    // --- Calculate shares to mint --------------------------------------
    let vault = &mut ctx.accounts.vault;
    let shares = if vault.total_junior_shares == 0 || vault.total_junior_deposits == 0 {
        amount // first depositor: 1 share per USDC
    } else {
        (amount as u128)
            .checked_mul(vault.total_junior_shares as u128)
            .ok_or(XLeverError::MathOverflow)?
            .checked_div(vault.total_junior_deposits as u128)
            .ok_or(XLeverError::MathOverflow)? as u64
    };
    require!(shares > 0, XLeverError::ZeroShares);

    vault.total_junior_deposits = vault
        .total_junior_deposits
        .checked_add(amount)
        .ok_or(XLeverError::MathOverflow)?;
    vault.total_junior_shares = vault
        .total_junior_shares
        .checked_add(shares)
        .ok_or(XLeverError::MathOverflow)?;

    // --- Update junior deposit account ---------------------------------
    let junior = &mut ctx.accounts.junior_deposit;
    if junior.shares == 0 {
        junior.owner = ctx.accounts.user.key();
        junior.vault = ctx.accounts.vault.key();
        junior.bump = ctx.bumps.junior_deposit;
        junior._reserved = [0u8; 32];
    }
    junior.shares = junior
        .shares
        .checked_add(shares)
        .ok_or(XLeverError::MathOverflow)?;

    msg!("Junior deposit {} USDC -> {} shares", amount, shares);

    Ok(())
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct DepositJunior<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.pyth_feed.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + JuniorDeposit::INIT_SPACE,
        seeds = [b"junior", vault.key().as_ref(), user.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
}
