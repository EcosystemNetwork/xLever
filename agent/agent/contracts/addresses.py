"""Contract addresses and oracle endpoints for xLever on Ink Sepolia."""

# Smart contract addresses on Ink Sepolia (Chain ID: 763373)
CONTRACTS = {
    # Core protocol contracts
    "EVC": "0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c",

    # Hedging vaults (for leveraged positions)
    "wSPYx_HEDGING": "0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228",
    "wQQQx_HEDGING": "0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6",

    # Token contracts
    "USDC": "0xFabab97dCE620294D2B0b0e46C68964e326300Ac",
    "wSPYx": "0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e",
    "wQQQx": "0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9",

    # Euler vaults (collateral vaults) — using deployed vault addresses
    "USDC_VAULT": "0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53",
    "wSPYx_VAULT": "0xC110E3bB1a898E1A4bd8Cc75a913603601e7c228",
    "wQQQx_VAULT": "0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6",

    # Interest rate model
    "IRM": "0xB8478f66Ef2665D69907a1DE2603C238144f768b",

    # Pyth Oracle Adapter
    "PYTH_ADAPTER": "0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f",

    # EVault Factory
    "EVAULT_FACTORY": "0x5Cc879CE26E38e4c9dAeecc0318f0EbdC22aa806",
}

# Pyth oracle configuration
PYTH_HERMES_URL = "https://hermes.pyth.network"

PYTH_FEEDS = {
    "SPY/USD": "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    "QQQ/USD": "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
}

# Asset mapping
ASSETS = {
    "wSPYx": {
        "name": "Wrapped S&P 500 Index",
        "ticker": "wSPYx",
        "token_address": CONTRACTS["wSPYx"],
        "vault_address": CONTRACTS["wSPYx_VAULT"],
        "hedging_vault": CONTRACTS["wSPYx_HEDGING"],
        "pyth_feed": PYTH_FEEDS["SPY/USD"],
        "decimals": 18,
    },
    "wQQQx": {
        "name": "Wrapped Nasdaq-100 Index",
        "ticker": "wQQQx",
        "token_address": CONTRACTS["wQQQx"],
        "vault_address": CONTRACTS["wQQQx_VAULT"],
        "hedging_vault": CONTRACTS["wQQQx_HEDGING"],
        "pyth_feed": PYTH_FEEDS["QQQ/USD"],
        "decimals": 18,
    },
}
