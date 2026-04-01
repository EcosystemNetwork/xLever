/**
 * @file vault-functions.js — High-Level Vault Interaction Helpers
 *
 * Provides simplified wrappers around contracts.js for common vault operations:
 *   - depositToVault: Open a leveraged position (approve + deposit)
 *   - withdrawFromVault: Close a position (Pyth update + withdraw)
 *   - fetchPosition: Read on-chain position state for a given vault
 *   - quickDeposit / quickWithdraw: UI button handlers with error classification
 *
 * All functions delegate to contracts.js which handles the full transaction
 * lifecycle (allowance check, approve, write, receipt polling, retries).
 *
 * @module vault-functions
 *
 * @dependencies
 *   - window.xLeverContracts (contracts.js) for on-chain operations
 *   - window.showToast for user notifications
 *   - window.viem for formatUnits
 *   - Global vars: connectedAddress, publicClient, currentLeverage, VAULT_ADDRESSES, VAULT_ABI
 *   - Functions: fetchBalances (from app.js)
 */

// ═══════════════════════════════════════════════════════════
// VAULT INTERACTION FUNCTIONS — receipt-driven via contracts.js
// ═══════════════════════════════════════════════════════════

/**
 * Deposit USDC into a vault with leverage.
 * Delegates to contracts.openPosition which handles:
 *   allowance check -> approve (with waitForTx) -> deposit -> waitForTx
 *   All with retry, event emission, and structured errors.
 *
 * @param {string} asset - Vault asset identifier ('wSPYx' or 'wQQQx')
 * @param {number} amountUSDC - USDC amount to deposit
 * @param {number} leverageBps - Leverage in basis points (e.g., 20000 = 2x)
 * @returns {Promise<Object>} Transaction receipt from the deposit
 * @throws {Error} If contracts not initialized or wallet not connected
 */
async function depositToVault(asset, amountUSDC, leverageBps) {
  const contracts = window.xLeverContracts;
  if (!contracts) throw new Error('Contract system not initialized');
  if (!connectedAddress) {
    showToast('Please connect your wallet first', 'warning');
    return;
  }

  const ticker = asset === 'wSPYx' ? 'SPY' : asset === 'wQQQx' ? 'QQQ' : asset;
  contracts.setActiveAsset(ticker);

  const leverage = leverageBps / 10000;
  console.log(`Depositing ${amountUSDC} USDC to ${asset} vault with ${leverage}x leverage`);

  // contracts.openPosition emits submitted/pending/confirmed/failed events
  const { hash, receipt, explorerUrl } = await contracts.openPosition(
    amountUSDC.toString(),
    leverage
  );

  console.log('✓ Deposit confirmed:', hash);

  // Refresh from confirmed chain state
  await fetchBalances();
  await fetchPosition(asset);

  return receipt;
}

/**
 * Withdraw USDC from a vault (close position).
 * Delegates to contracts.closePosition which handles:
 *   Pyth price update -> writeContract -> waitForTx with retry
 *
 * @param {string} asset - Vault asset identifier ('wSPYx' or 'wQQQx')
 * @param {number} amountUSDC - USDC amount to withdraw
 * @returns {Promise<Object>} Transaction receipt from the withdrawal
 * @throws {Error} If contracts not initialized or wallet not connected
 */
async function withdrawFromVault(asset, amountUSDC) {
  const contracts = window.xLeverContracts;
  if (!contracts) throw new Error('Contract system not initialized');
  if (!connectedAddress) {
    showToast('Please connect your wallet first', 'warning');
    return;
  }

  const ticker = asset === 'wSPYx' ? 'SPY' : asset === 'wQQQx' ? 'QQQ' : asset;
  contracts.setActiveAsset(ticker);

  console.log(`Withdrawing ${amountUSDC} USDC from ${asset} vault`);

  const { hash, receipt, explorerUrl } = await contracts.closePosition(
    amountUSDC.toString()
  );

  console.log('✓ Withdrawal confirmed:', hash);

  // Refresh from confirmed chain state
  await fetchBalances();
  await fetchPosition(asset);

  return receipt;
}

/**
 * Fetch the user's active position in a specific vault from on-chain state.
 * @param {string} asset - Vault asset identifier ('wSPYx' or 'wQQQx')
 * @returns {Promise<Object|null>} Position data with isActive, depositAmount, leverageBps, or null
 */
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

    if (position.isActive) {
      const { formatUnits } = window.viem;
      const depositAmount = formatUnits(position.depositAmount, 6);
      const leverage = position.leverageBps / 100;
      console.log(`Active position: ${depositAmount} USDC at ${leverage}x leverage`);
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
    showToast('Please enter a valid deposit amount', 'warning');
    return;
  }

  const leverageBps = Math.round(currentLeverage * 10000);

  try {
    document.getElementById('depositBtn').disabled = true;
    document.getElementById('depositBtn').textContent = 'Depositing...';

    await depositToVault(selectedAsset, parseFloat(depositAmount), leverageBps);

    showToast('Deposit successful!', 'success');
    document.getElementById('depositAmount').value = '';
  } catch (error) {
    const contracts = window.xLeverContracts;
    const classified = contracts?.classifyTxError?.(error) || { label: 'Error', detail: error.message };
    const toastType = classified.type === 'wallet_rejected' ? 'warning' : 'error';
    showToast(`${classified.label}: ${classified.detail}`, toastType);
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
    showToast('Please enter a valid withdrawal amount', 'warning');
    return;
  }

  try {
    document.getElementById('withdrawBtn').disabled = true;
    document.getElementById('withdrawBtn').textContent = 'Withdrawing...';

    await withdrawFromVault(selectedAsset, parseFloat(withdrawAmount));

    showToast('Withdrawal successful!', 'success');
    document.getElementById('withdrawAmount').value = '';
  } catch (error) {
    const contracts = window.xLeverContracts;
    const classified = contracts?.classifyTxError?.(error) || { label: 'Error', detail: error.message };
    const toastType = classified.type === 'wallet_rejected' ? 'warning' : 'error';
    showToast(`${classified.label}: ${classified.detail}`, toastType);
  } finally {
    document.getElementById('withdrawBtn').disabled = false;
    document.getElementById('withdrawBtn').textContent = 'Withdraw';
  }
}
