"""Contract addresses and oracle endpoints for xLever on Ink Sepolia."""

# Smart contract addresses on Ink Sepolia (Chain ID: 763373)
CONTRACTS = {
    # Core protocol contracts
    "EVC": "0x9B8d1851bCc06ac265c1c1ACaBD0F71E69DD312c",

    # Hedging vaults (for leveraged positions)
    "wSPYx_HEDGING": "0xd0673BeB607CA2136b126d34ED0D3Ff7826c93EE",
    "wQQQx_HEDGING": "0x3Bc3c0D268455aD7eAe1432f57f3C24f42EdC7C8",

    # Token contracts
    "USDC": "0x6b57475467cd854d36Be7FB614caDa5207838943",
    "wSPYx": "0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e",
    "wQQQx": "0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9",

    # Euler vaults (collateral vaults)
    "USDC_VAULT": "0x92E92FDcAc9dfED71721468Efcb6952Ec898aC53",
    "wSPYx_VAULT": "0x6d064558d58645439A64cE1e88989Dfba88AA052",
    "wQQQx_VAULT": "0x3AeFf4ad3ee66885de6cE1a485425bd8C987FCe9",

    # Interest rate model
    "IRM": "0xE91A4B01632a7D281fb3eB0E83Ad9D5F0305d48f",
}

# Pyth oracle configuration
PYTH_HERMES_URL = "https://hermes.pyth.network"

PYTH_FEEDS = {
    "SPY/USD": "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68aca0c4ae8a14",
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
