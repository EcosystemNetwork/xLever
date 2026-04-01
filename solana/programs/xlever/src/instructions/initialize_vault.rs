use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::Vault;
use crate::XLeverError;

/// Admin creates a new vault for a given Pyth price-feed.
/// Seeds: [b"vault", pyth_feed.key().as_ref()]
pub fn handler(ctx: Context<InitializeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    vault.admin = ctx.accounts.admin.key();
    vault.usdc_mint = ctx.accounts.usdc_mint.key();
    vault.pyth_feed = ctx.accounts.pyth_feed.key();
    vault.usdc_token_account = ctx.accounts.vault_usdc.key();

    vault.total_senior_deposits = 0;
    vault.total_junior_deposits = 0;
    vault.total_junior_shares = 0;
    vault.insurance_fund = 0;
    vault.net_exposure = 0;
    vault.gross_long_exposure = 0;
    vault.gross_short_exposure = 0;
    vault.protocol_state = 0;
    vault.bump = ctx.bumps.vault;
    vault._reserved = [0u8; 64];

    msg!(
        "Vault initialized for feed {} by admin {}",
        ctx.accounts.pyth_feed.key(),
        ctx.accounts.admin.key()
    );

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Pyth price-feed account — validated off-chain by feed ID.
    pub pyth_feed: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", pyth_feed.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// Vault-owned USDC token account (ATA controlled by vault PDA).
    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
