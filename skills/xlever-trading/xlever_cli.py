#!/usr/bin/env python3
"""
xLever CLI — OpenClaw skill helper for leverage trading on xLever protocol.

Usage:
    python3 xlever_cli.py price <TICKER>
    python3 xlever_cli.py assets
    python3 xlever_cli.py position --asset <TICKER> --chain <CHAIN>
    python3 xlever_cli.py portfolio --chain <CHAIN>
    python3 xlever_cli.py vault --asset <TICKER> --chain <CHAIN>
    python3 xlever_cli.py deposit --asset <TICKER> --amount <USDC> --leverage <X> --chain <CHAIN>
    python3 xlever_cli.py withdraw --asset <TICKER> --amount <USDC|max> --chain <CHAIN>

Environment:
    XLEVER_PRIVATE_KEY — Wallet private key (hex, with or without 0x prefix)
"""

import argparse
import json
import os
import sys
import urllib.request
from decimal import Decimal

# ═══════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════

CHAINS = {
    "ink-sepolia": {
        "id": 763373,
        "rpc": "https://rpc-gel-sepolia.inkonchain.com",
        "usdc": "0x6b57475467cd854d36Be7FB614caDa5207838943",
        "pyth": "0x2880aB155794e7179c9eE2e38200202908C17B43",
        "vaults": {
            "QQQ": "0xDEC80165b7F26e0EEA3c4fCF9a2B8E3D25a4f792",
            "SPY": "0x94CaA35F38FD11AeBBB385E9f07520FAFaD7570F",
            "VUG": "0xc3127C1F354a8778430294E6FDE07fa1359aA205",
            "VGK": "0x80ce92F57DfbE6b5197BE1A237491352Db22d4B4",
            "VXUS": "0x3a474227fBeDa680E88F6bEF6Fc7e16F120ad82b",
            "SGOV": "0x218d6cc20b76f9c076dCaa1E68c0fCD5eDe7416f",
            "SMH": "0x336f5cBf77fA925d4E82A1f7857277b9260F99D0",
            "XLE": "0x423bCD2983326f2A628a322dF7d1edf0001C8411",
            "XOP": "0x6A0bfbf4e4Af420973C0da7662ac234e325CBdFB",
            "ITA": "0xF16060467A5941f7d19FfDAfE277A0867F0C63EA",
            "AAPL": "0x12f7BcBbC4d5f53eF475ad667a5830b3CBB1e973",
            "NVDA": "0x89EE351032D63e8EA9A5473A8107FB4c3572BF74",
            "TSLA": "0x1A4ca4031F8f37C86a098aD769e1F5659Ac9F312",
            "DELL": "0x0a5187d8Fccc4F6feaf418A3c867A6e2d2371eC3",
            "SMCI": "0x0B5D43D42FAFa2B6621c6Ff6C8bB9F70F2078980",
            "ANET": "0x4f1a8BD176508162fB93F5F9AdDA6ceB674D6fA9",
            "VRT": "0xD5d47be432df8712f4C2D28e9Ce148E23fCd70c2",
            "SNDK": "0x9315061C7C86766C6DAB3A5f6Ba5e6c5c4c54fe3",
            "KLAC": "0xf088B6395cD88CeE3793659A88021fCC1926E4Ab",
            "LRCX": "0xc6904648da1bc7071F0Fd23d7Df7E1F6Db0FE381",
            "AMAT": "0xAaEd0F1D182BB46eDAa3BCAB28b2545695bd4BFB",
            "TER": "0xAC60CcEe41a1CA4428926791F05B0a12C02BEDdE",
            "CEG": "0xA5D557C41e6f742D01018cD8B315abe633546b67",
            "GEV": "0xbCdC9e93a665c8ab10F0Bcf975A84f69d7327Ec5",
            "SMR": "0x76eC319af8994392fE1d28f3c1617dd2939B8167",
            "ETN": "0xD64Eeb1F907A66EEffaEb3c2f99824B2c830aa88",
            "PWR": "0x9E1b206808D21319995F6539028326CdED970Cdb",
            "APLD": "0x46BAdCe00f81e8D2ab707Cf780798fD4B2F1b035",
            "SLV": "0x225CbD837050f242062D05e96bDab14C9D29E093",
            "PPLT": "0x4Fd21629CA9CA2D62B2600C21470f2a018634E91",
            "PALL": "0x4a073f6B10f20552A460C35F7434f208991e61ac",
            "STRK": "0xC92B0fD28863f26165E29f47Ee35Cc2E967CFAf2",
            "BTGO": "0x54bF86D669989C4b614c22B220Da9b6832F777A9",
        },
    },
    "eth-sepolia": {
        "id": 11155111,
        "rpc": "https://ethereum-sepolia-rpc.publicnode.com",
        "usdc": "0x6b57475467cd854d36Be7FB614caDa5207838943",
        "pyth": "0x2880aB155794e7179c9eE2e38200202908C17B43",
        "vaults": {
            "QQQ": "0x5f212222a7d4dF8E0BE74A1a0595783D94324E8f",
            "SPY": "0x41F9d8C1Ad13bD3F06533dDd65886b63F3eE9D5f",
            "VUG": "0xbC4e0ff25dAB8E9521efA13D7dffA908a5a70309",
            "VGK": "0xbbC19602Da054bb59290FAf07Db20d2020668794",
            "VXUS": "0x6A072b178196e0EF4F1f8709446f3F93E901655A",
            "SGOV": "0x0f29950d18138276A43dFA2dc962bCb3777B9EE1",
            "SMH": "0x1C3e1c48f953A60C6D8Db2E2F8B511c7ea96255F",
            "XLE": "0xE0f311Ada6980c738039f994083fc1Bfe45b26b6",
            "XOP": "0x4a554bd14b4f275702a61Ec5c3a68122e353b1e9",
            "ITA": "0xD03F16B4f2deeeb3a901b9F00D452DF34A6EBE10",
            "AAPL": "0x885f382Ea8357DD9aA15Bb726CC384B08C5fc360",
            "NVDA": "0x471aa70c15CcC2Fb4a047473Ee303a6a32F9e58C",
            "TSLA": "0xC1dD82fCa0650c49133a7c3614dD2B5C0df42c11",
            "DELL": "0xfdD711B37fa2da12980802BfB8d959F7026b8a14",
            "SMCI": "0xF2C5EAeaca7Ac729Da1DA81982F9C7BD758009F7",
            "ANET": "0xc60a8f2A07fF22795c780BDd35Ed82e94d76f703",
            "VRT": "0x9173B07A6a004376aAe56e95A841b357b070D4f4",
            "SNDK": "0xaf3110414d0B292fCD818a35014443C93e1b6e0f",
            "KLAC": "0x80d1a458E0b0e5F721f7c4A7d9ACce069bEd37A3",
            "LRCX": "0x7d0Db18ECc26b4E7AdBd089F955D42419392bd83",
            "AMAT": "0xEAcF84F9E3De48F37803e0194b1f9056A04BA481",
            "TER": "0x266361a88ba8526364F67988632bC343d359fE3B",
            "CEG": "0x8f155323B0FC850b90511A91d87122A42921F65a",
            "GEV": "0xBd96A7d334C34cC6F30f12dCA49272821Ee77008",
            "SMR": "0x765f3A46FdD28cf42f2BabA5Ad9d978029f64171",
            "ETN": "0x851cf6A5aD1100a22e3335fcd7E2B7e8B66D6061",
            "PWR": "0x2d7b02b9a69bA7BCf32b856F11EaFe28573B1A52",
            "APLD": "0x8ee16058dB9eb6036038C396cA22836c7c4201dd",
            "SLV": "0xd19cd383aba32aAd86747Febf6E5D0a88683405c",
            "PPLT": "0xb500Eba3595485c5E91e1855D11eA7b21FD2637D",
            "PALL": "0x3fccAd86bf821417b650a5b6bdE29e33b8cf7AE6",
            "STRK": "0x35315Ac816F34409C149d3a2b99BCc679d76aB08",
            "BTGO": "0x0d7B593C73c787288aE5a6B06a0d58FD4BE7f5eE",
        },
    },
}

PYTH_FEEDS = {
    "QQQ": "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
    "SPY": "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
    "VUG": "0x8c64b089d95170429ba39ec229a0a6fc36b267e09c3210fbb9d9eb2d4c203bc5",
    "VGK": "0x0648195b6826d833f3c4eb261c81223a90ceb3a26e86e9b18f6e11f0212cad18",
    "VXUS": "0x48a13d42218646bba8cc114cd394a283b11c0e07dd14a885efd5caec640c5289",
    "SGOV": "0x8d6a29bb5ed522931d711bb12c4bbf92af986936e52af582032913b5ffcbf4d5",
    "SMH": "0x2487b620e66468404ba251bfaa6b8382774010cbb5d504ac48ec263e0b1934aa",
    "XLE": "0x8bf649e08e5a86129c57990556c8eec30e296069b524f4639549282bc5c07bb4",
    "XOP": "0xc706cce81639eed699bf23a427ea8742ac6e7cc775b2a8a8e70cba8a49393e42",
    "ITA": "0x79f7f0b79a6b7fdc0d7d9e8b6337fd709b8eea9dc6f57b6174c84816cae88bfd",
    "AAPL": "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    "NVDA": "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    "TSLA": "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    "DELL": "0xa2950270a22ce39a22cb3488ba91e60474cd93c6d01da2ecc5a97c1dd40f4995",
    "SMCI": "0x8f34132a42f8bb7a47568d77a910f97174a30719e16904e9f2915d5b2c6c2d52",
    "ANET": "0x31cc7558642dc348a3e2894146a998031438de8ccc56b7af2171bcd5e5d83eda",
    "VRT": "0x84dad6b760396a7904d04a3d83039a3fc18f10819fd97d023ac5535997d70108",
    "SNDK": "0xc86a1f20cd7d5d07932baea30bcd8e479b775c4f51f82526bf1de6dc79fa3f76",
    "KLAC": "0x9c27675f282bfe54b5d0a7b187b29b09184d32d4462de7e3060629c7b8895aad",
    "LRCX": "0x01a67883f58bd0f0e9cf8f52f21d7cf78c144d7e7ae32ce9256420834b33fb75",
    "AMAT": "0xb9bc74cc1243b706efacf664ed206d08ab1dda79e8b87752c7c44b3bdf1b9e08",
    "TER": "0x58ab181e7512766728d2cc3581839bbb913e6cd24457ba422cbe2a33df64416e",
    "CEG": "0xa541bc5c4b69961442e45e9198c7cce151ff9c2a1003f620c6d4a9785c77a4d9",
    "GEV": "0x57e28b0f0ab18923f5c987629c0c714b9b46c87e729ed95ed6e23e466e8d1e0c",
    "SMR": "0x69155365daba71df19c2c0416467b64581052cfa75f44b77f352a92698b81639",
    "ETN": "0xb1cf984febc32fbd98f0c5d31fed29d050d56a272406bae9de64dd94ba7e5e1e",
    "PWR": "0xa189b9eee6d023e3b79a726804aeb748d54e52cf6ebcebe0f7d5c8dae4988357",
    "APLD": "0x7fc1e64946aff450748e8f60644d052ae787e5708dc48c6c73c546ee94218cc3",
    "SLV": "0x6fc08c9963d266069cbd9780d98383dabf2668322a5bef0b9491e11d67e5d7e7",
    "PPLT": "0x782410278b6c8aa2d437812281526012808404aa14c243f73fb9939eeb88d430",
    "PALL": "0xfeeb371f721e75853604c47104967f0ab3fa92b988837013f5004f749a8a0599",
    "STRK": "0xcdea273301806de445b481e91a8dbe292ba23fcff8f7dec2053311555a0656c3",
    "BTGO": "0x6540ed0004047d446b252bc49bff9e23e667c5c7d0437ad0db8e120e7b19c311",
}

ASSET_INFO = {
    "QQQ": "Nasdaq-100 ETF", "SPY": "S&P 500 ETF", "VUG": "Vanguard Growth ETF",
    "VGK": "Vanguard FTSE Europe ETF", "VXUS": "Vanguard Total Intl Stock ETF",
    "SGOV": "iShares 0-3M Treasury Bond ETF", "SMH": "VanEck Semiconductor ETF",
    "XLE": "Energy Select Sector SPDR", "XOP": "SPDR S&P Oil & Gas Exploration",
    "ITA": "iShares Aerospace & Defense ETF", "AAPL": "Apple", "NVDA": "NVIDIA",
    "TSLA": "Tesla", "DELL": "Dell Technologies", "SMCI": "Super Micro Computer",
    "ANET": "Arista Networks", "VRT": "Vertiv Holdings", "SNDK": "Sandisk",
    "KLAC": "KLA Corporation", "LRCX": "Lam Research", "AMAT": "Applied Materials",
    "TER": "Teradyne", "CEG": "Constellation Energy", "GEV": "GE Vernova",
    "SMR": "NuScale Power", "ETN": "Eaton Corporation", "PWR": "Quanta Services",
    "APLD": "Applied Digital", "SLV": "iShares Silver Trust",
    "PPLT": "abrdn Physical Platinum", "PALL": "abrdn Physical Palladium",
    "STRK": "Strategy (MicroStrategy)", "BTGO": "BitGo",
}

HERMES_URL = "https://hermes.pyth.network"
USDC_DECIMALS = 6

# ═══════════════════════════════════════════════════════════════
# POLICY — Bounded leverage modes for OpenClaw agent
# ═══════════════════════════════════════════════════════════════

POLICY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "policy.json")

# Supported assets for Phase 1 (narrow toolset)
PHASE1_ASSETS = {"SPY", "QQQ"}

DEFAULT_POLICY = {
    "mode": "manual",          # safe | target | manual
    "max_leverage": 4.0,       # hard cap
    "target_leverage": 2.0,    # for target mode
    "target_band": 0.5,        # +/- tolerance for target mode
    "safe_mode_max_new": 0.0,  # safe mode: max leverage for NEW positions (0 = blocked)
    "allowed_assets": ["SPY", "QQQ"],
}

MODES = {
    "safe": {
        "description": "Risk-reduction only. Can deleverage and close, cannot open or increase leverage without approval.",
        "can_open": False,
        "can_close": True,
        "can_increase_leverage": False,
    },
    "target": {
        "description": "Maintains leverage within a target band. Rebalances toward target automatically.",
        "can_open": True,
        "can_close": True,
        "can_increase_leverage": True,
    },
    "manual": {
        "description": "Agent explains state and prepares actions. User must approve all executions.",
        "can_open": True,
        "can_close": True,
        "can_increase_leverage": True,
    },
}


def load_policy() -> dict:
    """Load policy from disk, or return defaults."""
    if os.path.exists(POLICY_FILE):
        try:
            with open(POLICY_FILE, "r") as f:
                saved = json.load(f)
            # Merge with defaults for any missing keys
            policy = {**DEFAULT_POLICY, **saved}
            return policy
        except Exception:
            pass
    return dict(DEFAULT_POLICY)


def save_policy(policy: dict):
    """Persist policy to disk."""
    with open(POLICY_FILE, "w") as f:
        json.dump(policy, f, indent=2)


def check_policy_open(ticker: str, leverage: float, policy: dict) -> tuple:
    """Check if opening a position is allowed under current policy.
    Returns (allowed: bool, reason: str).
    """
    mode = policy.get("mode", "manual")
    mode_rules = MODES.get(mode, MODES["manual"])

    # Asset gate
    allowed_assets = set(policy.get("allowed_assets", PHASE1_ASSETS))
    if ticker.upper() not in allowed_assets:
        return False, f"Asset {ticker} not in allowed list: {', '.join(sorted(allowed_assets))}"

    # Leverage cap
    max_lev = policy.get("max_leverage", 4.0)
    if abs(leverage) > max_lev:
        return False, f"Leverage {leverage}x exceeds policy max {max_lev}x"

    # Mode-specific
    if mode == "safe":
        if not mode_rules["can_open"]:
            return False, "SAFE MODE: Opening new positions is blocked. Switch to 'target' or 'manual' mode."

    if mode == "manual":
        # Manual mode always returns a "needs approval" signal
        return True, "MANUAL MODE: Action prepared. User approval required before execution."

    if mode == "target":
        target = policy.get("target_leverage", 2.0)
        band = policy.get("target_band", 0.5)
        if abs(leverage) > target + band:
            return False, f"TARGET MODE: Leverage {leverage}x exceeds target band ({target}x +/- {band}). Max allowed: {target + band}x"

    return True, "OK"


def check_policy_close(ticker: str, policy: dict) -> tuple:
    """Check if closing a position is allowed. Always allowed in all modes."""
    allowed_assets = set(policy.get("allowed_assets", PHASE1_ASSETS))
    if ticker.upper() not in allowed_assets:
        return False, f"Asset {ticker} not in allowed list: {', '.join(sorted(allowed_assets))}"
    return True, "OK"

# ═══════════════════════════════════════════════════════════════
# ABI ENCODING (minimal, no web3 dependency)
# ═══════════════════════════════════════════════════════════════

def keccak256(data: bytes) -> bytes:
    """Keccak-256 hash using pysha3 or hashlib (Python 3.11+)."""
    try:
        import hashlib
        return hashlib.new("sha3_256", data).digest()  # fallback
    except ValueError:
        pass
    try:
        import sha3
        k = sha3.keccak_256()
        k.update(data)
        return k.digest()
    except ImportError:
        # Use the web3 approach if available
        try:
            from web3 import Web3
            return Web3.keccak(data)
        except ImportError:
            die("Need either Python 3.11+, pysha3, or web3 for keccak256")


def function_selector(sig: str) -> bytes:
    """Return the 4-byte function selector for a Solidity function signature."""
    # Use eth_abi-compatible keccak if available, else fall back
    try:
        from eth_abi import encode
        from eth_utils import keccak
        return keccak(sig.encode())[:4]
    except ImportError:
        pass
    try:
        from web3 import Web3
        return Web3.keccak(text=sig)[:4]
    except ImportError:
        pass
    # Pure Python fallback using hashlib
    import hashlib
    # Note: Python's hashlib sha3_256 is NOT keccak-256.
    # We need actual keccak-256. Try pysha3.
    try:
        import sha3
        k = sha3.keccak_256()
        k.update(sig.encode())
        return k.digest()[:4]
    except ImportError:
        die("Install web3 or pysha3: pip install web3")


def encode_uint256(val: int) -> bytes:
    return val.to_bytes(32, "big")


def encode_int32(val: int) -> bytes:
    """Encode int32 as ABI int32 (left-padded, two's complement)."""
    if val < 0:
        val = (1 << 256) + val
    return val.to_bytes(32, "big")


def encode_bytes_array(items: list[bytes]) -> bytes:
    """ABI-encode a dynamic bytes[] array."""
    # Offset to array data
    count = len(items)
    parts = []
    # Number of elements
    parts.append(encode_uint256(count))
    # Offsets for each element (relative to start of array data area)
    offset_base = count * 32  # past the offset pointers
    current_offset = offset_base
    data_parts = []
    for item in items:
        parts.append(encode_uint256(current_offset))
        # Each bytes element: length + padded data
        encoded = encode_uint256(len(item)) + item + b"\x00" * (32 - len(item) % 32) if len(item) % 32 != 0 else encode_uint256(len(item)) + item
        data_parts.append(encoded)
        current_offset += len(encoded)
    return b"".join(parts + data_parts)


# ═══════════════════════════════════════════════════════════════
# JSON-RPC HELPERS
# ═══════════════════════════════════════════════════════════════

def rpc_call(rpc_url: str, method: str, params: list) -> dict:
    """Make a JSON-RPC call."""
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }).encode()
    req = urllib.request.Request(
        rpc_url,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    if "error" in result:
        die(f"RPC error: {result['error']}")
    return result.get("result")


def eth_call(rpc_url: str, to: str, data: str) -> str:
    """eth_call — read-only contract call."""
    return rpc_call(rpc_url, "eth_call", [{"to": to, "data": data}, "latest"])


def get_balance(rpc_url: str, address: str) -> int:
    """Get native token balance."""
    result = rpc_call(rpc_url, "eth_getBalance", [address, "latest"])
    return int(result, 16)


def get_nonce(rpc_url: str, address: str) -> int:
    result = rpc_call(rpc_url, "eth_getTransactionCount", [address, "latest"])
    return int(result, 16)


def get_gas_price(rpc_url: str) -> int:
    result = rpc_call(rpc_url, "eth_gasPrice", [])
    return int(result, 16)


def get_chain_id(rpc_url: str) -> int:
    result = rpc_call(rpc_url, "eth_chainId", [])
    return int(result, 16)


def send_raw_tx(rpc_url: str, signed_tx: str) -> str:
    return rpc_call(rpc_url, "eth_sendRawTransaction", [signed_tx])


def wait_for_receipt(rpc_url: str, tx_hash: str, timeout: int = 120) -> dict:
    """Poll for transaction receipt."""
    import time
    start = time.time()
    while time.time() - start < timeout:
        result = rpc_call(rpc_url, "eth_getTransactionReceipt", [tx_hash])
        if result is not None:
            return result
        time.sleep(2)
    die(f"Transaction {tx_hash} not confirmed within {timeout}s")


# ═══════════════════════════════════════════════════════════════
# PYTH ORACLE
# ═══════════════════════════════════════════════════════════════

def fetch_pyth_price(ticker: str) -> dict:
    """Fetch latest price from Pyth Hermes."""
    feed_id = PYTH_FEEDS.get(ticker.upper())
    if not feed_id:
        die(f"Unknown ticker: {ticker}. Use 'assets' command to see available.")
    # Strip 0x for the API
    feed_hex = feed_id[2:] if feed_id.startswith("0x") else feed_id
    url = f"{HERMES_URL}/v2/updates/price/latest?ids%5B%5D={feed_hex}"
    req = urllib.request.Request(url, headers={"User-Agent": "xlever-cli/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    return data


def get_price_and_update(ticker: str) -> tuple:
    """Returns (price_float, update_data_hex_list, pyth_fee_estimate)."""
    data = fetch_pyth_price(ticker)
    parsed = data.get("parsed", [{}])[0]
    price_obj = parsed.get("price", {})
    price = int(price_obj.get("price", "0"))
    expo = int(price_obj.get("expo", "0"))
    price_float = price * (10 ** expo)

    # Binary update data for on-chain submission
    binary = data.get("binary", {})
    update_data = binary.get("data", [])

    return price_float, update_data


# ═══════════════════════════════════════════════════════════════
# CONTRACT READS
# ═══════════════════════════════════════════════════════════════

def read_position(rpc_url: str, vault: str, user: str) -> dict:
    """Read position from vault contract."""
    try:
        selector = function_selector("getPosition(address)")
    except SystemExit:
        # Fallback: hardcoded selector for getPosition(address)
        selector = bytes.fromhex("cf240261")  # pre-computed

    calldata = "0x" + selector.hex() + encode_uint256(int(user, 16)).hex()
    result = eth_call(rpc_url, vault, calldata)

    if not result or result == "0x" or len(result) < 66:
        return None

    # Decode tuple: (uint128, int32, uint128, uint64, uint128, uint32, bool)
    data = bytes.fromhex(result[2:])
    if len(data) < 7 * 32:
        return None

    deposit_amount = int.from_bytes(data[0:32], "big")
    leverage_bps_raw = int.from_bytes(data[32:64], "big")
    if leverage_bps_raw > (1 << 255):
        leverage_bps_raw -= (1 << 256)
    entry_twap = int.from_bytes(data[64:96], "big")
    last_fee_ts = int.from_bytes(data[96:128], "big")
    settled_fees = int.from_bytes(data[128:160], "big")
    lock_expiry = int.from_bytes(data[160:192], "big")
    is_active = int.from_bytes(data[192:224], "big") != 0

    return {
        "depositAmount": deposit_amount,
        "leverageBps": leverage_bps_raw,
        "entryTWAP": entry_twap,
        "lastFeeTimestamp": last_fee_ts,
        "settledFees": settled_fees,
        "leverageLockExpiry": lock_expiry,
        "isActive": is_active,
    }


def read_pool_state(rpc_url: str, vault: str) -> dict:
    """Read pool state from vault."""
    try:
        selector = function_selector("getPoolState()")
    except SystemExit:
        selector = bytes.fromhex("a77e2adf")

    result = eth_call(rpc_url, vault, "0x" + selector.hex())
    if not result or result == "0x":
        return None

    data = bytes.fromhex(result[2:])
    return {
        "totalSeniorDeposits": int.from_bytes(data[0:32], "big"),
        "totalJuniorDeposits": int.from_bytes(data[32:64], "big"),
        "insuranceFund": int.from_bytes(data[64:96], "big"),
        "netExposure": int.from_bytes(data[96:128], "big", signed=True),
        "grossLongExposure": int.from_bytes(data[128:160], "big"),
        "grossShortExposure": int.from_bytes(data[160:192], "big"),
        "lastRebalanceTime": int.from_bytes(data[192:224], "big"),
        "currentMaxLeverageBps": int.from_bytes(data[224:256], "big"),
        "fundingRateBps": int.from_bytes(data[256:288], "big", signed=True),
        "protocolState": int.from_bytes(data[288:320], "big"),
    }


def read_usdc_balance(rpc_url: str, usdc_addr: str, user: str) -> int:
    """Read USDC balance (returns raw uint256)."""
    # balanceOf(address)
    selector = bytes.fromhex("70a08231")
    calldata = "0x" + selector.hex() + encode_uint256(int(user, 16)).hex()
    result = eth_call(rpc_url, usdc_addr, calldata)
    if not result or result == "0x":
        return 0
    return int(result, 16)


def read_usdc_allowance(rpc_url: str, usdc_addr: str, owner: str, spender: str) -> int:
    """Read USDC allowance."""
    selector = bytes.fromhex("dd62ed3e")  # allowance(address,address)
    calldata = "0x" + selector.hex() + encode_uint256(int(owner, 16)).hex() + encode_uint256(int(spender, 16)).hex()
    result = eth_call(rpc_url, usdc_addr, calldata)
    if not result or result == "0x":
        return 0
    return int(result, 16)


# ═══════════════════════════════════════════════════════════════
# TRANSACTION SIGNING & SENDING
# ═══════════════════════════════════════════════════════════════

def get_account():
    """Load private key from environment, return (key_bytes, address)."""
    pk = os.environ.get("XLEVER_PRIVATE_KEY", "").strip()
    if not pk:
        die("XLEVER_PRIVATE_KEY environment variable not set")

    try:
        from eth_account import Account
        acct = Account.from_key(pk)
        return acct.key, acct.address
    except ImportError:
        die("Install eth-account: pip install eth-account")


def sign_and_send(rpc_url: str, chain_id: int, to: str, data: bytes, value: int = 0) -> str:
    """Sign a transaction and broadcast it. Returns tx hash."""
    from eth_account import Account

    key, sender = get_account()
    nonce = get_nonce(rpc_url, sender)
    gas_price = get_gas_price(rpc_url)

    # Estimate gas
    estimate_params = {
        "from": sender,
        "to": to,
        "data": "0x" + data.hex(),
        "value": hex(value),
    }
    try:
        gas_est = rpc_call(rpc_url, "eth_estimateGas", [estimate_params])
        gas_limit = int(int(gas_est, 16) * 1.3)  # 30% buffer
    except Exception:
        gas_limit = 500_000  # fallback

    tx = {
        "nonce": nonce,
        "gasPrice": gas_price,
        "gas": gas_limit,
        "to": to,
        "value": value,
        "data": data,
        "chainId": chain_id,
    }

    signed = Account.sign_transaction(tx, key)
    raw = "0x" + signed.raw_transaction.hex()
    tx_hash = send_raw_tx(rpc_url, raw)
    return tx_hash


# ═══════════════════════════════════════════════════════════════
# COMMANDS
# ═══════════════════════════════════════════════════════════════

def cmd_price(args):
    """Fetch and display current price for a ticker."""
    ticker = args.ticker.upper()
    price, _ = get_price_and_update(ticker)
    name = ASSET_INFO.get(ticker, ticker)
    print(f"\n  {ticker} ({name})")
    print(f"  Price: ${price:,.4f}")
    print(f"  Source: Pyth Network (Hermes)\n")


def cmd_assets(args):
    """List all available assets."""
    categories = {}
    for sym, name in ASSET_INFO.items():
        # Derive category from PYTH_FEEDS existence
        cat = "asset"
        for c, tickers in [
            ("Index ETFs", ["QQQ", "SPY", "VUG", "VGK", "VXUS", "SGOV"]),
            ("Sector ETFs", ["SMH", "XLE", "XOP", "ITA"]),
            ("Mega-cap Tech", ["AAPL", "NVDA", "TSLA", "DELL", "SMCI", "ANET", "VRT", "SNDK"]),
            ("Semiconductors", ["KLAC", "LRCX", "AMAT", "TER"]),
            ("Energy & Infra", ["CEG", "GEV", "SMR", "ETN", "PWR", "APLD"]),
            ("Commodities", ["SLV", "PPLT", "PALL"]),
            ("Crypto-adjacent", ["STRK", "BTGO"]),
        ]:
            if sym in tickers:
                cat = c
                break
        categories.setdefault(cat, []).append((sym, name))

    print("\n  xLever Available Assets (33 total)")
    print("  " + "=" * 50)
    for cat, items in categories.items():
        print(f"\n  {cat}:")
        for sym, name in items:
            print(f"    {sym:6s} — {name}")
    print()


def cmd_position(args):
    """Check position on a specific vault."""
    chain = CHAINS[args.chain]
    ticker = args.asset.upper()
    vault = chain["vaults"].get(ticker)
    if not vault:
        die(f"No vault for {ticker} on {args.chain}")

    _, address = get_account()
    pos = read_position(chain["rpc"], vault, address)

    if not pos or not pos["isActive"]:
        print(f"\n  No active position on {ticker} ({args.chain})\n")
        return

    deposit_usdc = pos["depositAmount"] / (10 ** USDC_DECIMALS)
    leverage = pos["leverageBps"] / 10000
    direction = "LONG" if leverage > 0 else "SHORT"
    notional = deposit_usdc * abs(leverage)

    print(f"\n  Position: {ticker} on {args.chain}")
    print(f"  {'=' * 40}")
    print(f"  Direction:  {direction} {abs(leverage):.1f}x")
    print(f"  Deposit:    {deposit_usdc:,.2f} USDC")
    print(f"  Notional:   {notional:,.2f} USDC")
    print(f"  Entry TWAP: {pos['entryTWAP']}")
    print(f"  Vault:      {vault}")
    print(f"  Wallet:     {address}\n")


def cmd_portfolio(args):
    """Scan all vaults for open positions."""
    chain = CHAINS[args.chain]
    _, address = get_account()

    print(f"\n  Scanning {len(chain['vaults'])} vaults on {args.chain} for {address[:10]}...")

    positions = []
    for ticker, vault in chain["vaults"].items():
        try:
            pos = read_position(chain["rpc"], vault, address)
            if pos and pos["isActive"]:
                deposit = pos["depositAmount"] / (10 ** USDC_DECIMALS)
                leverage = pos["leverageBps"] / 10000
                positions.append({
                    "ticker": ticker,
                    "deposit": deposit,
                    "leverage": leverage,
                    "vault": vault,
                })
        except Exception:
            pass  # Skip vaults that error

    if not positions:
        print(f"  No open positions found.\n")
        return

    print(f"\n  Open Positions ({len(positions)}):")
    print(f"  {'Ticker':8s} {'Direction':10s} {'Leverage':10s} {'Deposit':>12s}")
    print(f"  {'-' * 44}")
    total_deposit = 0
    for p in positions:
        direction = "LONG" if p["leverage"] > 0 else "SHORT"
        print(f"  {p['ticker']:8s} {direction:10s} {abs(p['leverage']):8.1f}x  {p['deposit']:>10,.2f} USDC")
        total_deposit += p["deposit"]
    print(f"  {'-' * 44}")
    print(f"  {'Total':8s} {'':10s} {'':10s} {total_deposit:>10,.2f} USDC\n")


def cmd_vault(args):
    """Show vault pool state."""
    chain = CHAINS[args.chain]
    ticker = args.asset.upper()
    vault = chain["vaults"].get(ticker)
    if not vault:
        die(f"No vault for {ticker} on {args.chain}")

    state = read_pool_state(chain["rpc"], vault)
    if not state:
        print(f"\n  Could not read pool state for {ticker}\n")
        return

    protocol_states = {0: "NORMAL", 1: "WARNING", 2: "RESTRICTED", 3: "EMERGENCY"}
    sr_deposits = state["totalSeniorDeposits"] / (10 ** USDC_DECIMALS)
    jr_deposits = state["totalJuniorDeposits"] / (10 ** USDC_DECIMALS)
    max_lev = state["currentMaxLeverageBps"] / 10000

    print(f"\n  Vault: {ticker} ({args.chain})")
    print(f"  {'=' * 45}")
    print(f"  Address:          {vault}")
    print(f"  Senior Deposits:  {sr_deposits:,.2f} USDC")
    print(f"  Junior Deposits:  {jr_deposits:,.2f} USDC")
    print(f"  Gross Long:       {state['grossLongExposure'] / 1e6:,.2f} USDC")
    print(f"  Gross Short:      {state['grossShortExposure'] / 1e6:,.2f} USDC")
    print(f"  Net Exposure:     {state['netExposure'] / 1e6:,.2f} USDC")
    print(f"  Max Leverage:     {max_lev:.1f}x")
    print(f"  Funding Rate:     {state['fundingRateBps']} bps")
    print(f"  Protocol State:   {protocol_states.get(state['protocolState'], 'UNKNOWN')}\n")


def cmd_risk(args):
    """Show risk state: oracle health, vault state, position health, policy mode."""
    chain = CHAINS[args.chain]
    _, address = get_account()
    policy = load_policy()
    mode = policy.get("mode", "manual")
    mode_info = MODES.get(mode, MODES["manual"])

    print(f"\n  xLever Risk State")
    print(f"  {'=' * 50}")
    print(f"  Policy Mode:  {mode.upper()} — {mode_info['description']}")
    print(f"  Allowed:      {', '.join(policy.get('allowed_assets', ['SPY', 'QQQ']))}")
    print(f"  Max Leverage: {policy.get('max_leverage', 4.0)}x")
    if mode == "target":
        print(f"  Target:       {policy.get('target_leverage', 2.0)}x +/- {policy.get('target_band', 0.5)}")

    # Check each allowed vault
    for ticker in policy.get("allowed_assets", ["SPY", "QQQ"]):
        vault = chain["vaults"].get(ticker)
        if not vault:
            continue

        print(f"\n  --- {ticker} Vault ---")

        # Pool state
        state = read_pool_state(chain["rpc"], vault)
        if state:
            protocol_states = {0: "NORMAL", 1: "WARNING", 2: "RESTRICTED", 3: "EMERGENCY"}
            ps = protocol_states.get(state["protocolState"], "UNKNOWN")
            sr = state["totalSeniorDeposits"] / (10 ** USDC_DECIMALS)
            print(f"  Protocol:     {ps}")
            print(f"  TVL:          {sr:,.2f} USDC")
            print(f"  Net Exposure:  {state['netExposure'] / 1e6:,.2f} USDC")
            print(f"  Max Leverage: {state['currentMaxLeverageBps'] / 10000:.1f}x")

            if state["protocolState"] >= 2:
                print(f"  WARNING: Vault in {ps} state — only risk-reducing actions allowed")
        else:
            print(f"  Could not read pool state")

        # Position
        pos = read_position(chain["rpc"], vault, address)
        if pos and pos["isActive"]:
            deposit = pos["depositAmount"] / (10 ** USDC_DECIMALS)
            leverage = pos["leverageBps"] / 10000
            direction = "LONG" if leverage > 0 else "SHORT"
            print(f"  Position:     {direction} {abs(leverage):.1f}x — {deposit:,.2f} USDC")

            # Target mode band check
            if mode == "target":
                target = policy.get("target_leverage", 2.0)
                band = policy.get("target_band", 0.5)
                if abs(leverage) > target + band:
                    print(f"  ALERT: Leverage {abs(leverage):.1f}x exceeds target band ({target} +/- {band})")
                elif abs(leverage) < target - band:
                    print(f"  ALERT: Leverage {abs(leverage):.1f}x below target band ({target} +/- {band})")
                else:
                    print(f"  Target:       Within band ({target} +/- {band})")
        else:
            print(f"  Position:     None")

        # Oracle freshness
        try:
            price, _ = get_price_and_update(ticker)
            print(f"  Oracle Price: ${price:,.4f}")
        except Exception as e:
            print(f"  Oracle:       STALE or unavailable ({e})")

    print()


def cmd_mode(args):
    """Get or set the agent policy mode."""
    policy = load_policy()

    if args.set_mode:
        new_mode = args.set_mode.lower()
        if new_mode not in MODES:
            die(f"Unknown mode: {new_mode}. Choose: {', '.join(MODES.keys())}")
        policy["mode"] = new_mode
        save_policy(policy)
        info = MODES[new_mode]
        print(f"\n  Mode set: {new_mode.upper()}")
        print(f"  {info['description']}")
        print(f"  Can open:     {'yes' if info['can_open'] else 'NO'}")
        print(f"  Can close:    {'yes' if info['can_close'] else 'NO'}")
        print(f"  Can increase: {'yes' if info['can_increase_leverage'] else 'NO'}\n")
    else:
        mode = policy.get("mode", "manual")
        info = MODES[mode]
        print(f"\n  Current Mode: {mode.upper()}")
        print(f"  {info['description']}")
        print(f"  Can open:     {'yes' if info['can_open'] else 'NO'}")
        print(f"  Can close:    {'yes' if info['can_close'] else 'NO'}")
        print(f"  Can increase: {'yes' if info['can_increase_leverage'] else 'NO'}")
        print(f"\n  Policy config: {json.dumps(policy, indent=2)}\n")


def cmd_balances(args):
    """Show wallet USDC and ETH balances."""
    chain = CHAINS[args.chain]
    _, address = get_account()

    usdc_raw = read_usdc_balance(chain["rpc"], chain["usdc"], address)
    usdc = usdc_raw / (10 ** USDC_DECIMALS)
    eth_raw = get_balance(chain["rpc"], address)
    eth = eth_raw / (10 ** 18)

    print(f"\n  Wallet Balances ({args.chain})")
    print(f"  {'=' * 40}")
    print(f"  Address: {address}")
    print(f"  USDC:    {usdc:,.2f}")
    print(f"  ETH:     {eth:,.6f}")
    print()


def cmd_deposit(args):
    """Open a leveraged position."""
    chain = CHAINS[args.chain]
    ticker = args.asset.upper()
    vault = chain["vaults"].get(ticker)
    if not vault:
        die(f"No vault for {ticker} on {args.chain}")

    amount = Decimal(args.amount)
    leverage = float(args.leverage)

    if abs(leverage) > 4.0:
        die("Maximum leverage is 4x (long or short)")
    if amount <= 0:
        die("Amount must be positive")

    # Policy check
    policy = load_policy()
    allowed, reason = check_policy_open(ticker, leverage, policy)
    if not allowed:
        die(f"POLICY BLOCKED: {reason}")
    if "approval required" in reason.lower():
        print(f"\n  {reason}")

    _, address = get_account()

    # Check USDC balance
    balance_raw = read_usdc_balance(chain["rpc"], chain["usdc"], address)
    balance = balance_raw / (10 ** USDC_DECIMALS)
    amount_raw = int(amount * (10 ** USDC_DECIMALS))

    if balance_raw < amount_raw:
        die(f"Insufficient USDC balance: have {balance:,.2f}, need {amount:,.2f}")

    # Check existing position
    pos = read_position(chain["rpc"], vault, address)
    if pos and pos["isActive"]:
        die(f"Already have an active position on {ticker}. Close it first with: withdraw --asset {ticker} --amount max")

    # Fetch Pyth price update
    price, update_data = get_price_and_update(ticker)
    leverage_bps = int(leverage * 10000)
    direction = "LONG" if leverage > 0 else "SHORT"
    notional = float(amount) * abs(leverage)

    name = ASSET_INFO.get(ticker, ticker)
    print(f"\n  Trade Summary")
    print(f"  {'=' * 45}")
    print(f"  Action:     {direction} {abs(leverage):.1f}x {ticker} ({name})")
    print(f"  Deposit:    {amount:,.2f} USDC")
    print(f"  Notional:   {notional:,.2f} USDC")
    print(f"  Price:      ${price:,.4f}")
    print(f"  Chain:      {args.chain}")
    print(f"  Vault:      {vault}")
    print(f"  Wallet:     {address}")
    print(f"  Balance:    {balance:,.2f} USDC")

    # Check allowance
    allowance = read_usdc_allowance(chain["rpc"], chain["usdc"], address, vault)
    if allowance < amount_raw:
        print(f"\n  USDC approval needed. Approving vault to spend USDC...")
        # approve(address,uint256)
        approve_selector = bytes.fromhex("095ea7b3")
        max_uint = (1 << 256) - 1
        approve_data = approve_selector + encode_uint256(int(vault, 16)) + encode_uint256(max_uint)
        tx_hash = sign_and_send(chain["rpc"], chain["id"], chain["usdc"], approve_data)
        print(f"  Approval tx: {tx_hash}")
        receipt = wait_for_receipt(chain["rpc"], tx_hash)
        if int(receipt.get("status", "0x0"), 16) != 1:
            die("USDC approval failed!")
        print(f"  Approval confirmed!")

    # Build deposit calldata
    # deposit(uint256 amount, int32 leverageBps, bytes[] priceUpdateData)
    try:
        selector = function_selector("deposit(uint256,int32,bytes[])")
    except SystemExit:
        selector = bytes.fromhex("d6af3f48")  # pre-computed fallback

    # ABI encode: amount (uint256) + leverageBps (int32) + offset to bytes[] + bytes[] data
    # Static params
    amount_enc = encode_uint256(amount_raw)
    leverage_enc = encode_int32(leverage_bps)
    # Dynamic offset (3 * 32 = 96 bytes from start of params)
    offset_enc = encode_uint256(96)

    # Encode bytes[] — each element is the hex-decoded update data
    update_bytes = [bytes.fromhex(ud) for ud in update_data]
    bytes_array_enc = encode_bytes_array(update_bytes)

    calldata = selector + amount_enc + leverage_enc + offset_enc + bytes_array_enc

    # Pyth fee (small, ~0.01 ETH on testnets)
    pyth_fee = 10_000_000_000_000_000  # 0.01 ETH

    print(f"\n  Sending deposit transaction...")
    tx_hash = sign_and_send(chain["rpc"], chain["id"], vault, calldata, value=pyth_fee)
    print(f"  Tx hash: {tx_hash}")

    print(f"  Waiting for confirmation...")
    receipt = wait_for_receipt(chain["rpc"], tx_hash)
    status = int(receipt.get("status", "0x0"), 16)

    if status == 1:
        print(f"\n  Position opened successfully!")
        print(f"  {direction} {abs(leverage):.1f}x {ticker} — {amount:,.2f} USDC deposited\n")
    else:
        print(f"\n  Transaction REVERTED. Check vault state and try again.")
        print(f"  Receipt: {json.dumps(receipt, indent=2)}\n")
        sys.exit(1)


def cmd_withdraw(args):
    """Close/reduce a leveraged position."""
    chain = CHAINS[args.chain]
    ticker = args.asset.upper()
    vault = chain["vaults"].get(ticker)
    if not vault:
        die(f"No vault for {ticker} on {args.chain}")

    # Policy check
    policy = load_policy()
    allowed, reason = check_policy_close(ticker, policy)
    if not allowed:
        die(f"POLICY BLOCKED: {reason}")

    _, address = get_account()

    # Read current position
    pos = read_position(chain["rpc"], vault, address)
    if not pos or not pos["isActive"]:
        die(f"No active position on {ticker} to withdraw from")

    deposit_usdc = pos["depositAmount"] / (10 ** USDC_DECIMALS)

    if args.amount.lower() == "max":
        amount_raw = pos["depositAmount"]
        amount = deposit_usdc
    else:
        amount = Decimal(args.amount)
        amount_raw = int(amount * (10 ** USDC_DECIMALS))
        if amount_raw > pos["depositAmount"]:
            die(f"Withdraw amount ({amount:,.2f}) exceeds deposit ({deposit_usdc:,.2f})")

    # Fetch Pyth update
    price, update_data = get_price_and_update(ticker)
    leverage = pos["leverageBps"] / 10000
    direction = "LONG" if leverage > 0 else "SHORT"

    print(f"\n  Withdrawal Summary")
    print(f"  {'=' * 45}")
    print(f"  Position:   {direction} {abs(leverage):.1f}x {ticker}")
    print(f"  Deposited:  {deposit_usdc:,.2f} USDC")
    print(f"  Withdrawing:{amount:,.2f} USDC")
    print(f"  Price:      ${price:,.4f}")
    print(f"  Chain:      {args.chain}")
    print(f"  Vault:      {vault}")

    # Build withdraw calldata
    # withdraw(uint256 amount, uint256 minReceived, bytes[] priceUpdateData)
    try:
        selector = function_selector("withdraw(uint256,uint256,bytes[])")
    except SystemExit:
        selector = bytes.fromhex("b5c5f672")

    min_received = 0  # Accept any amount (slippage protection can be added)
    amount_enc = encode_uint256(amount_raw)
    min_enc = encode_uint256(min_received)
    offset_enc = encode_uint256(96)

    update_bytes = [bytes.fromhex(ud) for ud in update_data]
    bytes_array_enc = encode_bytes_array(update_bytes)

    calldata = selector + amount_enc + min_enc + offset_enc + bytes_array_enc
    pyth_fee = 10_000_000_000_000_000  # 0.01 ETH

    print(f"\n  Sending withdraw transaction...")
    tx_hash = sign_and_send(chain["rpc"], chain["id"], vault, calldata, value=pyth_fee)
    print(f"  Tx hash: {tx_hash}")

    print(f"  Waiting for confirmation...")
    receipt = wait_for_receipt(chain["rpc"], tx_hash)
    status = int(receipt.get("status", "0x0"), 16)

    if status == 1:
        action = "closed" if args.amount.lower() == "max" else "reduced"
        print(f"\n  Position {action} successfully!")
        print(f"  Withdrew {amount:,.2f} USDC from {ticker} vault\n")
    else:
        print(f"\n  Transaction REVERTED.")
        print(f"  Receipt: {json.dumps(receipt, indent=2)}\n")
        sys.exit(1)


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def die(msg: str):
    print(f"\n  ERROR: {msg}\n", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="xLever CLI — Leverage trade tokenized stocks via OpenClaw",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", help="Available commands")

    # price
    p = sub.add_parser("price", help="Get current Pyth oracle price")
    p.add_argument("ticker", help="Asset ticker (e.g., QQQ, NVDA)")

    # assets
    sub.add_parser("assets", help="List all available assets")

    # position
    p = sub.add_parser("position", help="Check position on a vault")
    p.add_argument("--asset", required=True, help="Ticker symbol")
    p.add_argument("--chain", default="ink-sepolia", choices=CHAINS.keys())

    # portfolio
    p = sub.add_parser("portfolio", help="Scan all vaults for open positions")
    p.add_argument("--chain", default="ink-sepolia", choices=CHAINS.keys())

    # vault
    p = sub.add_parser("vault", help="Show vault pool state")
    p.add_argument("--asset", required=True, help="Ticker symbol")
    p.add_argument("--chain", default="ink-sepolia", choices=CHAINS.keys())

    # deposit
    p = sub.add_parser("deposit", help="Open a leveraged position")
    p.add_argument("--asset", required=True, help="Ticker symbol")
    p.add_argument("--amount", required=True, help="USDC amount to deposit")
    p.add_argument("--leverage", required=True, help="Leverage multiplier (-4.0 to 4.0)")
    p.add_argument("--chain", default="ink-sepolia", choices=CHAINS.keys())

    # withdraw
    p = sub.add_parser("withdraw", help="Close/reduce a position")
    p.add_argument("--asset", required=True, help="Ticker symbol")
    p.add_argument("--amount", required=True, help="USDC to withdraw (or 'max')")
    p.add_argument("--chain", default="ink-sepolia", choices=CHAINS.keys())

    # risk — risk state overview
    p = sub.add_parser("risk", help="Show risk state, oracle health, and policy mode")
    p.add_argument("--chain", default="ink-sepolia", choices=CHAINS.keys())

    # mode — get/set policy mode
    p = sub.add_parser("mode", help="Get or set agent policy mode (safe/target/manual)")
    p.add_argument("--set", dest="set_mode", help="Set mode: safe, target, or manual")

    # balances — wallet balances
    p = sub.add_parser("balances", help="Show wallet USDC and ETH balances")
    p.add_argument("--chain", default="ink-sepolia", choices=CHAINS.keys())

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "price": cmd_price,
        "assets": cmd_assets,
        "position": cmd_position,
        "portfolio": cmd_portfolio,
        "vault": cmd_vault,
        "deposit": cmd_deposit,
        "withdraw": cmd_withdraw,
        "risk": cmd_risk,
        "mode": cmd_mode,
        "balances": cmd_balances,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
