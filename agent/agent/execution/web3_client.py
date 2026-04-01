"""Async Web3 client for blockchain interactions."""

import asyncio
from typing import Any, Dict, Optional
from decimal import Decimal
from web3 import AsyncWeb3
from web3.providers import AsyncHTTPProvider
from eth_account import Account
from eth_account.signers.local import LocalAccount
from loguru import logger


class Web3Client:
    """Async Web3 client for interacting with Ink Sepolia blockchain.

    Provides methods for reading blockchain state, sending transactions,
    and interacting with smart contracts with built-in retry logic.
    """

    def __init__(self, rpc_url: str, chain_id: int, private_key: str):
        """Initialize Web3 client.

        Args:
            rpc_url: RPC endpoint URL
            chain_id: Chain ID for transaction signing
            private_key: Private key for signing transactions (without 0x prefix)
        """
        self.rpc_url = rpc_url
        self.chain_id = chain_id

        # Initialize async provider
        provider = AsyncHTTPProvider(rpc_url)
        self.w3 = AsyncWeb3(provider)

        # Setup account from private key
        self.account: LocalAccount = Account.from_key(private_key)
        logger.info(f"Web3 client initialized with account: {self.account.address}")

    async def is_connected(self) -> bool:
        """Check if connected to the blockchain.

        Returns:
            True if connected, False otherwise
        """
        try:
            await self.w3.is_connected()
            return True
        except Exception as e:
            logger.error(f"Connection check failed: {e}")
            return False

    async def get_block_number(self) -> int:
        """Get the current block number.

        Returns:
            Current block number

        Raises:
            Exception: If unable to fetch block number after retries
        """
        return await self._retry_async(self.w3.eth.block_number)

    async def get_balance(self, address: Optional[str] = None) -> Decimal:
        """Get ETH balance for an address.

        Args:
            address: Address to check balance for (defaults to client's address)

        Returns:
            Balance in ETH as Decimal

        Raises:
            Exception: If unable to fetch balance after retries
        """
        address = address or self.account.address
        balance_wei = await self._retry_async(self.w3.eth.get_balance, address)
        return Decimal(balance_wei) / Decimal(10**18)

    async def get_gas_price(self) -> int:
        """Get current gas price.

        Returns:
            Gas price in wei

        Raises:
            Exception: If unable to fetch gas price after retries
        """
        return await self._retry_async(self.w3.eth.gas_price)

    async def get_transaction_receipt(self, tx_hash: str) -> Dict[str, Any]:
        """Get transaction receipt.

        Args:
            tx_hash: Transaction hash

        Returns:
            Transaction receipt dictionary

        Raises:
            Exception: If transaction receipt not found after retries
        """
        return await self._retry_async(
            self.w3.eth.get_transaction_receipt, self.w3.to_checksum_address(tx_hash)
        )

    async def send_transaction(
        self,
        to: str,
        data: str = "0x",
        value: int = 0,
        gas_limit: Optional[int] = None,
        max_priority_fee: Optional[int] = None,
    ) -> str:
        """Send a transaction to the blockchain.

        Args:
            to: Recipient address
            data: Transaction data (hex string)
            value: ETH value to send in wei
            gas_limit: Gas limit (estimated if not provided)
            max_priority_fee: Max priority fee per gas in wei

        Returns:
            Transaction hash

        Raises:
            Exception: If transaction fails after retries
        """
        logger.info(f"Preparing transaction to {to}")

        # Get current gas price
        gas_price = await self.get_gas_price()

        # Build transaction
        nonce = await self.w3.eth.get_transaction_count(self.account.address)

        transaction = {
            "from": self.account.address,
            "to": self.w3.to_checksum_address(to),
            "value": value,
            "gas": gas_limit or 500000,  # Default gas limit
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": self.chain_id,
            "data": data,
        }

        # Estimate gas if not provided
        if gas_limit is None:
            try:
                estimated_gas = await self.w3.eth.estimate_gas(transaction)
                transaction["gas"] = int(estimated_gas * 1.2)  # Add 20% buffer
                logger.debug(f"Estimated gas: {estimated_gas}, using: {transaction['gas']}")
            except Exception as e:
                logger.warning(f"Gas estimation failed: {e}, using default")

        # Sign transaction
        signed_txn = self.account.sign_transaction(transaction)

        # Send transaction with retry logic
        tx_hash = await self._retry_async(
            self.w3.eth.send_raw_transaction, signed_txn.raw_transaction
        )

        tx_hash_hex = tx_hash.hex()
        logger.success(f"Transaction sent: {tx_hash_hex}")

        return tx_hash_hex

    async def wait_for_transaction_receipt(
        self, tx_hash: str, timeout: int = 120, poll_interval: float = 2.0
    ) -> Dict[str, Any]:
        """Wait for a transaction to be mined.

        Args:
            tx_hash: Transaction hash
            timeout: Maximum time to wait in seconds
            poll_interval: Time between polling attempts

        Returns:
            Transaction receipt

        Raises:
            TimeoutError: If transaction not mined within timeout
        """
        logger.info(f"Waiting for transaction receipt: {tx_hash}")

        start_time = asyncio.get_event_loop().time()

        while True:
            try:
                receipt = await self.get_transaction_receipt(tx_hash)
                status = receipt.get("status", 0)

                if status == 1:
                    logger.success(f"Transaction confirmed: {tx_hash}")
                    return receipt
                else:
                    logger.error(f"Transaction failed: {tx_hash}")
                    raise Exception(f"Transaction failed with status {status}")

            except Exception as e:
                # Check timeout
                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed > timeout:
                    raise TimeoutError(
                        f"Transaction not mined within {timeout} seconds: {tx_hash}"
                    )

                # Wait before next poll
                await asyncio.sleep(poll_interval)

    def get_contract(self, address: str, abi: list) -> Any:
        """Get a contract instance.

        Args:
            address: Contract address
            abi: Contract ABI

        Returns:
            Contract instance
        """
        checksum_address = self.w3.to_checksum_address(address)
        return self.w3.eth.contract(address=checksum_address, abi=abi)

    async def call_contract_function(
        self, contract_address: str, abi: list, function_name: str, *args, **kwargs
    ) -> Any:
        """Call a read-only contract function.

        Args:
            contract_address: Contract address
            abi: Contract ABI
            function_name: Name of function to call
            *args: Function arguments
            **kwargs: Additional call parameters

        Returns:
            Function return value
        """
        contract = self.get_contract(contract_address, abi)
        function = getattr(contract.functions, function_name)
        return await self._retry_async(function(*args).call, **kwargs)

    async def send_contract_transaction(
        self,
        contract_address: str,
        abi: list,
        function_name: str,
        *args,
        value: int = 0,
        gas_limit: Optional[int] = None,
    ) -> str:
        """Send a transaction to a contract function.

        Args:
            contract_address: Contract address
            abi: Contract ABI
            function_name: Name of function to call
            *args: Function arguments
            value: ETH value to send
            gas_limit: Gas limit

        Returns:
            Transaction hash
        """
        contract = self.get_contract(contract_address, abi)
        function = getattr(contract.functions, function_name)

        # Build transaction data
        tx_data = function(*args).build_transaction(
            {"from": self.account.address, "value": value, "gas": gas_limit or 500000}
        )

        return await self.send_transaction(
            to=contract_address,
            data=tx_data["data"],
            value=value,
            gas_limit=gas_limit,
        )

    async def _retry_async(
        self, func, *args, max_retries: int = 3, delay: float = 1.0, **kwargs
    ) -> Any:
        """Retry an async function with exponential backoff.

        Args:
            func: Async function to retry
            *args: Function arguments
            max_retries: Maximum number of retry attempts
            delay: Initial delay between retries in seconds
            **kwargs: Function keyword arguments

        Returns:
            Function return value

        Raises:
            Exception: If all retries fail
        """
        last_exception = None

        for attempt in range(max_retries):
            try:
                if asyncio.iscoroutinefunction(func):
                    return await func(*args, **kwargs)
                else:
                    return func(*args, **kwargs)

            except Exception as e:
                last_exception = e
                if attempt < max_retries - 1:
                    wait_time = delay * (2**attempt)  # Exponential backoff
                    logger.warning(
                        f"Attempt {attempt + 1}/{max_retries} failed: {e}. "
                        f"Retrying in {wait_time}s..."
                    )
                    await asyncio.sleep(wait_time)
                else:
                    logger.error(f"All {max_retries} attempts failed: {e}")

        raise last_exception
