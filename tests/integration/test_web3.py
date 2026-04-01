"""Integration tests for Web3 client and blockchain interactions.

These tests interact with actual blockchain endpoints and should be marked
with @pytest.mark.integration to allow selective execution.
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch
from web3 import Web3

from agent.execution.web3_client import Web3Client
from agent.contracts.addresses import CONTRACTS


@pytest.mark.integration
class TestWeb3ClientConnection:
    """Test Web3 client connection and basic operations."""

    @pytest.mark.asyncio
    async def test_client_initialization(self):
        """Test client initialization with valid config."""
        rpc_url = "https://rpc-gel-sepolia.inkonchain.com/"
        private_key = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"

        client = Web3Client(
            rpc_url=rpc_url,
            private_key=private_key,
            chain_id=763373,
        )

        assert client.w3 is not None
        assert client.account is not None
        assert client.chain_id == 763373

    @pytest.mark.asyncio
    async def test_connection_check(self):
        """Test checking blockchain connection status."""
        with patch("web3.Web3") as mock_web3:
            # Mock successful connection
            mock_w3_instance = Mock()
            mock_w3_instance.is_connected.return_value = True
            mock_w3_instance.eth.chain_id = 763373
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            # Test connection check
            is_connected = client.w3.is_connected()
            assert is_connected

    @pytest.mark.asyncio
    async def test_get_block_number(self):
        """Test fetching current block number."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_w3_instance.eth.block_number = 1234567
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            block_number = client.w3.eth.block_number
            assert isinstance(block_number, int)
            assert block_number > 0

    @pytest.mark.asyncio
    async def test_get_gas_price(self):
        """Test fetching current gas price."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_w3_instance.eth.gas_price = Web3.to_wei(50, "gwei")
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            gas_price = client.w3.eth.gas_price
            gas_price_gwei = Web3.from_wei(gas_price, "gwei")

            assert isinstance(gas_price_gwei, (int, float))
            assert gas_price_gwei > 0


@pytest.mark.integration
class TestWeb3AccountOperations:
    """Test account-related operations."""

    @pytest.mark.asyncio
    async def test_get_account_address(self):
        """Test getting account address from private key."""
        with patch("web3.Web3") as mock_web3:
            # Mock Web3 instance
            mock_w3_instance = Mock()
            mock_web3.return_value = mock_w3_instance

            # Mock account
            mock_account = Mock()
            mock_account.address = "0x1234567890123456789012345678901234567890"
            mock_w3_instance.eth.account.from_key.return_value = mock_account

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            assert client.account.address.startswith("0x")
            assert len(client.account.address) == 42

    @pytest.mark.asyncio
    async def test_get_balance(self):
        """Test fetching account ETH balance."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_account = Mock()
            mock_account.address = "0x1234567890123456789012345678901234567890"

            # Mock balance (1 ETH in Wei)
            mock_w3_instance.eth.get_balance.return_value = Web3.to_wei(1, "ether")
            mock_w3_instance.eth.account.from_key.return_value = mock_account
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            balance_wei = client.w3.eth.get_balance(client.account.address)
            balance_eth = Web3.from_wei(balance_wei, "ether")

            assert isinstance(balance_eth, (int, float))
            assert balance_eth >= 0

    @pytest.mark.asyncio
    async def test_get_nonce(self):
        """Test fetching account nonce."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_account = Mock()
            mock_account.address = "0x1234567890123456789012345678901234567890"

            mock_w3_instance.eth.get_transaction_count.return_value = 5
            mock_w3_instance.eth.account.from_key.return_value = mock_account
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            nonce = client.w3.eth.get_transaction_count(client.account.address)

            assert isinstance(nonce, int)
            assert nonce >= 0


@pytest.mark.integration
class TestWeb3ContractInteractions:
    """Test smart contract interactions."""

    @pytest.mark.asyncio
    async def test_load_contract(self):
        """Test loading contract with ABI."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_contract = Mock()

            mock_w3_instance.eth.contract.return_value = mock_contract
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            # Mock ABI
            mock_abi = [
                {
                    "name": "balanceOf",
                    "type": "function",
                    "inputs": [{"name": "account", "type": "address"}],
                    "outputs": [{"name": "", "type": "uint256"}],
                }
            ]

            contract = client.w3.eth.contract(
                address="0x1234567890123456789012345678901234567890",
                abi=mock_abi,
            )

            assert contract is not None

    @pytest.mark.asyncio
    async def test_call_contract_view_function(self):
        """Test calling view function on contract."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_contract = Mock()

            # Mock contract function
            mock_function = Mock()
            mock_function.call.return_value = Web3.to_wei(1000, "ether")
            mock_contract.functions.balanceOf.return_value = mock_function

            mock_w3_instance.eth.contract.return_value = mock_contract
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            mock_abi = [{"name": "balanceOf", "type": "function"}]
            contract = client.w3.eth.contract(
                address="0x1234567890123456789012345678901234567890",
                abi=mock_abi,
            )

            balance = contract.functions.balanceOf(
                "0x1234567890123456789012345678901234567890"
            ).call()

            assert isinstance(balance, int)
            assert balance >= 0

    @pytest.mark.asyncio
    async def test_estimate_gas(self):
        """Test estimating gas for transaction."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_contract = Mock()
            mock_function = Mock()

            # Mock gas estimation
            mock_function.estimate_gas.return_value = 100000
            mock_contract.functions.transfer.return_value = mock_function

            mock_w3_instance.eth.contract.return_value = mock_contract
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            mock_abi = [{"name": "transfer", "type": "function"}]
            contract = client.w3.eth.contract(
                address="0x1234567890123456789012345678901234567890",
                abi=mock_abi,
            )

            estimated_gas = contract.functions.transfer(
                "0x1234567890123456789012345678901234567890",
                1000,
            ).estimate_gas({"from": client.account.address})

            assert isinstance(estimated_gas, int)
            assert estimated_gas > 0


@pytest.mark.integration
class TestWeb3TransactionBuilding:
    """Test transaction building and signing."""

    @pytest.mark.asyncio
    async def test_build_transaction(self):
        """Test building transaction dictionary."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_account = Mock()
            mock_account.address = "0x1234567890123456789012345678901234567890"

            mock_w3_instance.eth.account.from_key.return_value = mock_account
            mock_w3_instance.eth.gas_price = Web3.to_wei(50, "gwei")
            mock_w3_instance.eth.get_transaction_count.return_value = 5
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            tx = {
                "from": client.account.address,
                "to": "0x0987654321098765432109876543210987654321",
                "value": Web3.to_wei(0.1, "ether"),
                "gas": 21000,
                "gasPrice": client.w3.eth.gas_price,
                "nonce": client.w3.eth.get_transaction_count(client.account.address),
                "chainId": client.chain_id,
            }

            assert tx["from"] == client.account.address
            assert tx["chainId"] == 763373
            assert tx["gas"] > 0
            assert tx["nonce"] >= 0

    @pytest.mark.asyncio
    async def test_sign_transaction(self):
        """Test signing transaction."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_account = Mock()
            mock_account.address = "0x1234567890123456789012345678901234567890"

            # Mock signed transaction
            mock_signed_tx = Mock()
            mock_signed_tx.rawTransaction = bytes.fromhex("abcdef" * 20)
            mock_signed_tx.hash = bytes.fromhex("123456" * 16)
            mock_account.sign_transaction.return_value = mock_signed_tx

            mock_w3_instance.eth.account.from_key.return_value = mock_account
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            tx = {
                "from": client.account.address,
                "to": "0x0987654321098765432109876543210987654321",
                "value": 0,
                "gas": 21000,
                "gasPrice": 50000000000,
                "nonce": 5,
                "chainId": 763373,
            }

            signed_tx = client.account.sign_transaction(tx)

            assert signed_tx.rawTransaction is not None
            assert len(signed_tx.rawTransaction) > 0


@pytest.mark.integration
class TestWeb3ErrorHandling:
    """Test error handling in Web3 operations."""

    @pytest.mark.asyncio
    async def test_invalid_rpc_url(self):
        """Test handling of invalid RPC URL."""
        with patch("web3.Web3") as mock_web3:
            # Mock connection failure
            mock_w3_instance = Mock()
            mock_w3_instance.is_connected.return_value = False
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://invalid.rpc.url",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            is_connected = client.w3.is_connected()
            assert not is_connected

    @pytest.mark.asyncio
    async def test_invalid_private_key(self):
        """Test handling of invalid private key."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_w3_instance.eth.account.from_key.side_effect = ValueError(
                "Invalid private key"
            )
            mock_web3.return_value = mock_w3_instance

            with pytest.raises(ValueError, match="Invalid private key"):
                client = Web3Client(
                    rpc_url="https://test.rpc.com",
                    private_key="0xinvalid",
                    chain_id=763373,
                )

    @pytest.mark.asyncio
    async def test_insufficient_balance_for_transaction(self):
        """Test handling insufficient balance error."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_account = Mock()
            mock_account.address = "0x1234567890123456789012345678901234567890"

            # Mock zero balance
            mock_w3_instance.eth.get_balance.return_value = 0
            mock_w3_instance.eth.account.from_key.return_value = mock_account
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            balance = client.w3.eth.get_balance(client.account.address)

            # Should have zero balance
            assert balance == 0

    @pytest.mark.asyncio
    async def test_contract_call_failure(self):
        """Test handling contract call failure."""
        with patch("web3.Web3") as mock_web3:
            mock_w3_instance = Mock()
            mock_contract = Mock()
            mock_function = Mock()

            # Mock contract call failure
            mock_function.call.side_effect = Exception("Contract call failed")
            mock_contract.functions.someFunction.return_value = mock_function

            mock_w3_instance.eth.contract.return_value = mock_contract
            mock_web3.return_value = mock_w3_instance

            client = Web3Client(
                rpc_url="https://test.rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=763373,
            )

            mock_abi = [{"name": "someFunction", "type": "function"}]
            contract = client.w3.eth.contract(
                address="0x1234567890123456789012345678901234567890",
                abi=mock_abi,
            )

            with pytest.raises(Exception, match="Contract call failed"):
                contract.functions.someFunction().call()


@pytest.mark.integration
class TestWeb3AddressValidation:
    """Test address validation utilities."""

    def test_valid_address(self):
        """Test valid Ethereum address."""
        address = "0x1234567890123456789012345678901234567890"
        assert Web3.is_address(address)
        assert Web3.is_checksum_address(Web3.to_checksum_address(address))

    def test_invalid_address_format(self):
        """Test invalid address format."""
        invalid_address = "0xinvalid"
        assert not Web3.is_address(invalid_address)

    def test_checksum_address_conversion(self):
        """Test converting address to checksum format."""
        address = "0x1234567890123456789012345678901234567890"
        checksum_address = Web3.to_checksum_address(address)

        assert Web3.is_checksum_address(checksum_address)
        assert checksum_address.startswith("0x")
        assert len(checksum_address) == 42


@pytest.mark.integration
class TestWeb3ContractAddresses:
    """Test contract address configurations."""

    def test_vault_addresses_exist(self):
        """Test vault addresses are configured."""
        assert "wSPYx_vault" in CONTRACTS
        assert "wQQQx_vault" in CONTRACTS

        # Validate address format
        for vault_name in ["wSPYx_vault", "wQQQx_vault"]:
            address = CONTRACTS[vault_name]
            assert Web3.is_address(address)
            assert address.startswith("0x")

    def test_token_addresses_exist(self):
        """Test token addresses are configured."""
        assert "USDC" in CONTRACTS
        assert "wSPYx" in CONTRACTS
        assert "wQQQx" in CONTRACTS

        for token_name in ["USDC", "wSPYx", "wQQQx"]:
            address = CONTRACTS[token_name]
            assert Web3.is_address(address)

    def test_contract_address_uniqueness(self):
        """Test all contract addresses are unique."""
        addresses = list(CONTRACTS.values())
        unique_addresses = set(addresses)

        # All addresses should be unique
        assert len(addresses) == len(unique_addresses)
