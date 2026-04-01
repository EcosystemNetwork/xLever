"""Transaction builder for constructing and executing trades."""

from typing import Optional, Dict, Any
from decimal import Decimal
from loguru import logger

from agent.execution.web3_client import Web3Client
from agent.contracts.addresses import CONTRACTS, ASSETS
from agent.contracts.abi_loader import load_abi
from agent.strategy.llm_strategy import TradingDecision, DecisionAction


class TransactionBuilder:
    """Builds and executes transactions for trading actions.

    Handles:
    - Opening long/short positions
    - Closing positions
    - Adjusting leverage
    - Gas estimation
    - Slippage protection
    """

    def __init__(self, web3_client: Web3Client, max_gas_gwei: int = 100):
        """Initialize transaction builder.

        Args:
            web3_client: Web3 client for blockchain interaction
            max_gas_gwei: Maximum acceptable gas price
        """
        self.web3 = web3_client
        self.max_gas_gwei = max_gas_gwei

        # Load ABIs
        try:
            self.hedging_abi = load_abi("EulerHedgingModule")
            self.erc20_abi = load_abi("ERC20")
        except Exception as e:
            logger.error(f"Failed to load ABIs: {e}")
            self.hedging_abi = []
            self.erc20_abi = []

        logger.info("Transaction builder initialized")

    async def execute_decision(
        self,
        decision: TradingDecision,
        slippage_bps: int = 50,  # 0.5% default slippage
    ) -> Optional[str]:
        """Execute a trading decision.

        Args:
            decision: Trading decision to execute
            slippage_bps: Allowed slippage in basis points

        Returns:
            Transaction hash if successful, None otherwise
        """
        if decision.action == DecisionAction.HOLD:
            logger.info("HOLD decision, no transaction needed")
            return None

        if decision.blocked:
            logger.warning(f"Cannot execute blocked decision: {decision.block_reason}")
            return None

        # Check gas price
        gas_price = await self.web3.get_gas_price()
        gas_price_gwei = gas_price / 1e9

        if gas_price_gwei > self.max_gas_gwei and decision.urgency != "high":
            logger.warning(
                f"Gas price {gas_price_gwei:.2f} gwei exceeds limit {self.max_gas_gwei}, "
                "skipping non-urgent transaction"
            )
            return None

        # Route to appropriate handler
        try:
            if decision.action == DecisionAction.OPEN_LONG:
                return await self._open_long(decision, slippage_bps)
            elif decision.action == DecisionAction.OPEN_SHORT:
                return await self._open_short(decision, slippage_bps)
            elif decision.action == DecisionAction.CLOSE:
                return await self._close_position(decision)
            elif decision.action == DecisionAction.ADJUST_LEVERAGE:
                return await self._adjust_leverage(decision, slippage_bps)
            else:
                logger.error(f"Unknown action: {decision.action}")
                return None

        except Exception as e:
            logger.error(f"Transaction execution failed: {e}")
            return None

    async def _open_long(self, decision: TradingDecision, slippage_bps: int) -> str:
        """Open a long position.

        Args:
            decision: Trading decision
            slippage_bps: Slippage tolerance

        Returns:
            Transaction hash
        """
        asset_config = ASSETS[decision.asset]
        hedging_vault = asset_config["hedging_vault"]

        logger.info(
            f"Opening LONG position: {decision.asset}, "
            f"size: ${decision.size_usdc:.2f}, "
            f"leverage: {decision.leverage_bps / 10000:.1f}x"
        )

        # Convert USDC to Wei (USDC is 6 decimals)
        collateral_amount = int(decision.size_usdc * 1e6)

        # First, approve USDC spending
        await self._approve_token(
            token_address=CONTRACTS["USDC"],
            spender=hedging_vault,
            amount=collateral_amount,
        )

        # Build transaction to open long position
        # Function signature: openLongPosition(uint256 collateralAmount, uint256 borrowAmount, bytes pythUpdateData)
        borrow_amount = int(collateral_amount * (decision.leverage_bps / 10000 - 1))
        tx_hash = await self.web3.send_contract_transaction(
            hedging_vault,
            self.hedging_abi,
            "openLongPosition",
            collateral_amount,
            borrow_amount,
            b"",  # pythUpdateData - populated by contract from on-chain oracle
            gas_limit=350000,
        )

        logger.success(f"Long position opened: {tx_hash}")

        # Wait for confirmation
        receipt = await self.web3.wait_for_transaction_receipt(tx_hash, timeout=120)

        if receipt.get("status") != 1:
            raise Exception("Transaction failed")

        return tx_hash

    async def _open_short(self, decision: TradingDecision, slippage_bps: int) -> str:
        """Open a short position.

        Args:
            decision: Trading decision
            slippage_bps: Slippage tolerance

        Returns:
            Transaction hash
        """
        asset_config = ASSETS[decision.asset]
        hedging_vault = asset_config["hedging_vault"]

        logger.info(
            f"Opening SHORT position: {decision.asset}, "
            f"size: ${decision.size_usdc:.2f}, "
            f"leverage: {decision.leverage_bps / 10000:.1f}x"
        )

        # Convert USDC to Wei (USDC is 6 decimals)
        collateral_amount = int(decision.size_usdc * 1e6)

        # First, approve USDC spending
        await self._approve_token(
            token_address=CONTRACTS["USDC"],
            spender=hedging_vault,
            amount=collateral_amount,
        )

        # Build transaction to open short position
        # Function signature: openShortPosition(uint256 collateralAmount, uint256 borrowAmount, bytes pythUpdateData)
        borrow_amount = int(collateral_amount * (decision.leverage_bps / 10000 - 1))
        tx_hash = await self.web3.send_contract_transaction(
            hedging_vault,
            self.hedging_abi,
            "openShortPosition",
            collateral_amount,
            borrow_amount,
            b"",  # pythUpdateData
            gas_limit=350000,
        )

        logger.success(f"Short position opened: {tx_hash}")

        # Wait for confirmation
        receipt = await self.web3.wait_for_transaction_receipt(tx_hash, timeout=120)

        if receipt.get("status") != 1:
            raise Exception("Transaction failed")

        return tx_hash

    async def _close_position(self, decision: TradingDecision) -> str:
        """Close an open position.

        Args:
            decision: Trading decision

        Returns:
            Transaction hash
        """
        asset_config = ASSETS[decision.asset]
        hedging_vault = asset_config["hedging_vault"]

        logger.info(f"Closing position: {decision.asset}")

        # Close position - determine direction from on-chain state
        # For now, close long by default (agent tracks direction separately)
        tx_hash = await self.web3.send_contract_transaction(
            hedging_vault,
            self.hedging_abi,
            "closeLongPosition",
            0,  # repayAmount (0 = repay all)
            b"",  # pythUpdateData
            gas_limit=300000,
        )

        logger.success(f"Position closed: {tx_hash}")

        # Wait for confirmation
        receipt = await self.web3.wait_for_transaction_receipt(tx_hash, timeout=120)

        if receipt.get("status") != 1:
            raise Exception("Transaction failed")

        return tx_hash

    async def _adjust_leverage(self, decision: TradingDecision, slippage_bps: int) -> str:
        """Adjust leverage on existing position.

        This requires closing and reopening the position.

        Args:
            decision: Trading decision
            slippage_bps: Slippage tolerance

        Returns:
            Transaction hash
        """
        logger.info(
            f"Adjusting leverage for {decision.asset} to {decision.leverage_bps / 10000:.1f}x"
        )

        # For now, this requires a close + reopen
        # TODO: Implement atomic adjust via EVC batch if available

        # Close existing position
        await self._close_position(decision)

        # Wait a bit for settlement
        import asyncio
        await asyncio.sleep(5)

        # Reopen with new leverage
        # Determine direction based on last position (would need to pass this)
        # For now, log warning that this needs position context
        logger.warning("Leverage adjustment requires position direction context")

        return None  # Placeholder

    async def _approve_token(self, token_address: str, spender: str, amount: int):
        """Approve token spending.

        Args:
            token_address: Token contract address
            spender: Spender address
            amount: Amount to approve
        """
        logger.debug(f"Approving {amount} tokens for {spender}")

        # Check current allowance
        account = self.web3.account.address
        current_allowance = await self.web3.call_contract_function(
            token_address,
            self.erc20_abi,
            "allowance",
            account,
            spender,
        )

        if current_allowance >= amount:
            logger.debug("Sufficient allowance already exists")
            return

        # Approve spending
        tx_hash = await self.web3.send_contract_transaction(
            token_address,
            self.erc20_abi,
            "approve",
            spender,
            amount,
            gas_limit=100000,
        )

        logger.debug(f"Approval transaction: {tx_hash}")

        # Wait for confirmation
        await self.web3.wait_for_transaction_receipt(tx_hash, timeout=60)

    async def estimate_gas_cost(self, decision: TradingDecision) -> Dict[str, Any]:
        """Estimate gas cost for a decision.

        Args:
            decision: Trading decision

        Returns:
            Gas estimate details
        """
        gas_price = await self.web3.get_gas_price()
        gas_price_gwei = gas_price / 1e9

        # Estimate gas units based on action
        gas_units = {
            DecisionAction.OPEN_LONG: 350000,
            DecisionAction.OPEN_SHORT: 350000,
            DecisionAction.CLOSE: 300000,
            DecisionAction.ADJUST_LEVERAGE: 650000,  # Close + reopen
        }.get(decision.action, 0)

        gas_cost_eth = (gas_units * gas_price) / 1e18

        return {
            "gas_price_gwei": gas_price_gwei,
            "estimated_gas_units": gas_units,
            "estimated_cost_eth": gas_cost_eth,
            "affordable": gas_price_gwei <= self.max_gas_gwei,
        }
