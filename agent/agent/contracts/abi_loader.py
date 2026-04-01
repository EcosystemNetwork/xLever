"""ABI loader utility for smart contracts."""

import json
from pathlib import Path
from typing import Dict, List
from loguru import logger

# Get ABIs directory
ABIS_DIR = Path(__file__).parent / "abis"


def load_abi(name: str) -> List[Dict]:
    """Load a contract ABI from the abis directory.

    Args:
        name: Name of the ABI file (without .json extension)

    Returns:
        ABI as list of function definitions

    Raises:
        FileNotFoundError: If ABI file doesn't exist
        json.JSONDecodeError: If ABI file is invalid JSON
    """
    abi_path = ABIS_DIR / f"{name}.json"

    if not abi_path.exists():
        raise FileNotFoundError(f"ABI file not found: {abi_path}")

    with open(abi_path, "r") as f:
        abi = json.load(f)

    logger.debug(f"Loaded ABI: {name} ({len(abi)} functions)")
    return abi


# Pre-load common ABIs
try:
    ERC20_ABI = load_abi("erc20")
    HEDGING_VAULT_ABI = load_abi("hedging_vault")
    EULER_VAULT_ABI = load_abi("euler_vault")
except Exception as e:
    logger.warning(f"Failed to pre-load ABIs: {e}")
    ERC20_ABI = []
    HEDGING_VAULT_ABI = []
    EULER_VAULT_ABI = []
