// ═══════════════════════════════════════════════════════════
// VAULT INTERACTION FUNCTIONS
// ═══════════════════════════════════════════════════════════

// Deposit USDC into vault with leverage
async function depositToVault(asset, amountUSDC, leverageBps) {
  if (!walletClient || !connectedAddress) {
    alert('Please connect your wallet first');
    return;
  }

  try {
    const vaultAddress = VAULT_ADDRESSES[asset];
    if (!vaultAddress) {
      throw new Error(`No vault found for ${asset}`);
    }

    console.log(`Depositing ${amountUSDC} USDC to ${asset} vault with ${leverageBps/100}x leverage`);

    // Convert USDC amount to proper decimals (6 decimals)
    const { parseUnits } = window.viem;
    const amount = parseUnits(amountUSDC.toString(), 6);

    // Step 1: Approve USDC spending
    console.log('Step 1: Approving USDC...');
    const approveTx = await walletClient.writeContract({
      address: TOKEN_ADDRESSES.USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, amount],
      account: connectedAddress
    });

    console.log('Waiting for approval confirmation...');
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log('✓ USDC approved');

    // Step 2: Deposit to vault
    console.log('Step 2: Depositing to vault...');
    const depositTx = await walletClient.writeContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [amount, leverageBps],
      account: connectedAddress
    });

    console.log('Waiting for deposit confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
    console.log('✓ Deposit successful!');

    // Refresh balances
    await fetchBalances();
    await fetchPosition(asset);

    return receipt;
  } catch (error) {
    console.error('Deposit failed:', error);
    throw error;
  }
}

// Withdraw from vault
async function withdrawFromVault(asset, amountUSDC) {
  if (!walletClient || !connectedAddress) {
    alert('Please connect your wallet first');
    return;
  }

  try {
    const vaultAddress = VAULT_ADDRESSES[asset];
    if (!vaultAddress) {
      throw new Error(`No vault found for ${asset}`);
    }

    console.log(`Withdrawing ${amountUSDC} USDC from ${asset} vault`);

    // Convert USDC amount to proper decimals (6 decimals)
    const { parseUnits } = window.viem;
    const amount = parseUnits(amountUSDC.toString(), 6);

    // Withdraw from vault
    const withdrawTx = await walletClient.writeContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'withdraw',
      args: [amount],
      account: connectedAddress
    });

    console.log('Waiting for withdrawal confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawTx });
    console.log('✓ Withdrawal successful!');

    // Refresh balances
    await fetchBalances();
    await fetchPosition(asset);

    return receipt;
  } catch (error) {
    console.error('Withdrawal failed:', error);
    throw error;
  }
}

// Fetch user's position in a vault
async function fetchPosition(asset) {
  if (!connectedAddress || !publicClient) return null;

  try {
    const vaultAddress = VAULT_ADDRESSES[asset];
    if (!vaultAddress) return null;

    const position = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'getPosition',
      args: [connectedAddress]
    });

    console.log(`Position in ${asset}:`, position);
    
    // Update UI with position info
    if (position.isActive) {
      const { formatUnits } = window.viem;
      const depositAmount = formatUnits(position.depositAmount, 6);
      const leverage = position.leverageBps / 100;
      
      console.log(`Active position: ${depositAmount} USDC at ${leverage}x leverage`);
      
      // You can update UI elements here to show the position
      // For example: document.getElementById('currentPosition').textContent = `${depositAmount} USDC @ ${leverage}x`;
    }

    return position;
  } catch (error) {
    console.error('Failed to fetch position:', error);
    return null;
  }
}

// Quick deposit function for UI buttons
async function quickDeposit() {
  const depositAmount = document.getElementById('depositAmount')?.value;
  const selectedAsset = document.querySelector('.asset-btn.active')?.dataset.asset || 'wQQQx';
  
  if (!depositAmount || parseFloat(depositAmount) <= 0) {
    alert('Please enter a valid deposit amount');
    return;
  }

  // Convert current leverage slider value to basis points
  // currentLeverage is between -4 and +4, need to convert to basis points (-40000 to +40000)
  const leverageBps = Math.round(currentLeverage * 10000);

  try {
    document.getElementById('depositBtn').disabled = true;
    document.getElementById('depositBtn').textContent = 'Depositing...';

    await depositToVault(selectedAsset, parseFloat(depositAmount), leverageBps);

    alert('Deposit successful! 🎉');
    document.getElementById('depositAmount').value = '';
  } catch (error) {
    alert(`Deposit failed: ${error.message}`);
  } finally {
    document.getElementById('depositBtn').disabled = false;
    document.getElementById('depositBtn').textContent = 'Deposit';
  }
}

// Quick withdraw function for UI buttons
async function quickWithdraw() {
  const withdrawAmount = document.getElementById('withdrawAmount')?.value;
  const selectedAsset = document.querySelector('.asset-btn.active')?.dataset.asset || 'wQQQx';
  
  if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
    alert('Please enter a valid withdrawal amount');
    return;
  }

  try {
    document.getElementById('withdrawBtn').disabled = true;
    document.getElementById('withdrawBtn').textContent = 'Withdrawing...';

    await withdrawFromVault(selectedAsset, parseFloat(withdrawAmount));

    alert('Withdrawal successful! 💰');
    document.getElementById('withdrawAmount').value = '';
  } catch (error) {
    alert(`Withdrawal failed: ${error.message}`);
  } finally {
    document.getElementById('withdrawBtn').disabled = false;
    document.getElementById('withdrawBtn').textContent = 'Withdraw';
  }
}
