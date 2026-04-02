/**
 * @file junior-manager.js — Junior Tranche Manager
 *
 * Manages junior tranche (liquidity provider) deposits and withdrawals for xLever vaults.
 * Junior depositors provide the risk capital that backs senior (leveraged) positions.
 *
 * Key responsibilities:
 *   - Fetches comprehensive on-chain junior tranche data (TVL, share price, APY, exposure)
 *   - Renders real-time pool health, fee breakdowns, and position metrics
 *   - Handles USDC deposits into junior tranche with ERC-20 approval flow
 *   - Handles share-based withdrawals from junior tranche
 *   - Supports vault selection between wSPYx and wQQQx
 *
 * @module junior-manager
 *
 * @dependencies
 *   - window.viem for parseUnits/formatUnits
 *   - Global vars: publicClient, walletClient, connectedAddress, VAULT_ADDRESSES, VAULT_ABI, ERC20_ABI, JUNIOR_TRANCHE_ABI
 *   - Functions: fetchBalances, showToast
 */

/**
 * Supported deposit assets. Junior tranche only accepts USDC.
 * @type {Object<string, {address: string, decimals: number, symbol: string}>}
 */
const DEPOSIT_ASSETS = {
  USDC: { address: '0xFabab97dCE620294D2B0b0e46C68964e326300Ac', decimals: 6, symbol: 'USDC' }
};

/** @type {string} Currently selected deposit asset (always 'USDC' for junior tranche) */
let selectedDepositAsset = 'USDC';
/** @type {string} Currently selected vault for junior deposits ('wQQQx' or 'wSPYx') */
let selectedVault = 'wQQQx';

/**
 * Fetch comprehensive junior tranche data from on-chain contracts.
 * Reads pool state, junior value, user shares, funding rate, max leverage, and TWAP
 * in parallel, then computes derived metrics (APY, utilization, exposure, ratios).
 * @returns {Promise<Object|null>} Junior tranche data object with TVL, share price, APY,
 *   exposure metrics, and fee estimates, or null if data is unavailable
 */
async function fetchJuniorData() {
  if (!publicClient || !connectedAddress) return null;

  try {
    const vaultAddress = VAULT_ADDRESSES[selectedVault];
    
    // Get junior tranche address
    const juniorTrancheAddress = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'juniorTranche'
    }).catch(() => null);

    if (!juniorTrancheAddress) {
      return null;
    }

    // Fetch all data in parallel (including fee config from contract)
    const [
      poolState,
      juniorValue,
      userShares,
      totalSharesValue,
      fundingRate,
      maxLeverage,
      twapData,
      feeConfig
    ] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'getPoolState'
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'getJuniorValue'
      }),
      publicClient.readContract({
        address: juniorTrancheAddress,
        abi: JUNIOR_TRANCHE_ABI,
        functionName: 'getShares',
        args: [connectedAddress]
      }),
      publicClient.readContract({
        address: juniorTrancheAddress,
        abi: JUNIOR_TRANCHE_ABI,
        functionName: 'totalShares'
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'getFundingRate'
      }).catch(() => 0n),
      publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'getMaxLeverage'
      }).catch(() => 40000),
      publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'getCurrentTWAP'
      }).catch(() => [0n, 0n]),
      publicClient.readContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'getFeeConfig'
      }).catch(() => null)
    ]);

    if (!window.viem) {
      return null;
    }
    const { formatUnits } = window.viem;

    // Calculate metrics
    const totalJuniorTVL = Number(formatUnits(juniorValue[0], 6));
    const sharePrice = Number(formatUnits(juniorValue[1], 6));
    const userSharesNum = Number(formatUnits(userShares, 6)); // Shares are in 6 decimals (USDC-based)
    const totalSharesNum = Number(formatUnits(totalSharesValue, 6));
    const userPosition = userSharesNum * sharePrice;
    const totalSeniorTVL = Number(formatUnits(poolState.totalSeniorDeposits, 6));
    const totalTVL = totalJuniorTVL + totalSeniorTVL;
    
    const juniorRatio = totalTVL > 0 ? (totalJuniorTVL / totalTVL) * 100 : 0;
    const seniorRatio = 100 - juniorRatio;
    
    const utilization = totalJuniorTVL > 0 ? (totalSeniorTVL / totalJuniorTVL) * 100 : 0;
    
    // Calculate average leverage from gross exposures
    // Note: grossLongExposure and grossShortExposure are already the notional amounts (deposit * leverage)
    // So avgLeverage = totalNotional / totalDeposits
    let avgLeverage = 0;
    if (poolState.totalSeniorDeposits > 0n && totalSeniorTVL > 0.01) {
      const totalExposureValue = Number(formatUnits(poolState.grossLongExposure + poolState.grossShortExposure, 6));
      const rawLeverage = totalExposureValue / totalSeniorTVL;
      // Sanity check: leverage should be between 0 and 4 for this protocol
      avgLeverage = (rawLeverage > 0 && rawLeverage <= 4) ? rawLeverage : 0;
    }
    
    // Fee rates from on-chain FeeEngine (fall back to defaults if contract read failed)
    const entryFeeBps = feeConfig ? Number(feeConfig.baseEntryFeeBps) : 8;
    const exitFeeBps = feeConfig ? Number(feeConfig.baseExitFeeBps) : 4;
    const juniorSplitBps = feeConfig ? Number(feeConfig.juniorFeeSplit) : 7000;
    const insuranceSplitBps = feeConfig ? Number(feeConfig.insuranceFeeSplit) : 2000;
    const treasurySplitBps = feeConfig ? Number(feeConfig.treasuryFeeSplit) : 1000;
    // Approximate annual fee rate from entry+exit fee average (both are per-trade bps)
    // Combined with protocol spread for carry
    const protocolSpreadBps = feeConfig ? Number(feeConfig.protocolSpreadBps) : 10;
    const baseFeeRate = (entryFeeBps + exitFeeBps + protocolSpreadBps) / 10000;
    const annualFees = totalSeniorTVL * avgLeverage * baseFeeRate;
    const juniorSplitFraction = juniorSplitBps / 10000;

    // Cap APY to reasonable maximum (1000%) and require minimum TVL threshold
    let juniorAPY = 0;
    if (totalJuniorTVL > 0.01) { // Require at least $0.01 junior TVL
      juniorAPY = Math.min((annualFees * juniorSplitFraction / totalJuniorTVL) * 100, 1000);
    }

    // Net exposure
    const netExposure = Number(formatUnits(poolState.netExposure, 6));
    const netExposureDirection = netExposure > 0 ? 'Long' : netExposure < 0 ? 'Short' : 'Neutral';
    
    // Gross exposure
    const grossLongExposure = Number(formatUnits(poolState.grossLongExposure, 6));
    const grossShortExposure = Number(formatUnits(poolState.grossShortExposure, 6));
    const totalExposure = grossLongExposure + grossShortExposure;

    return {
      juniorTranche: juniorTrancheAddress,
      totalJuniorTVL,
      totalSeniorTVL,
      totalTVL,
      sharePrice,
      userPosition,
      userShares: userSharesNum,
      totalShares: totalSharesNum,
      juniorRatio,
      seniorRatio,
      utilization,
      juniorAPY,
      avgLeverage,
      netExposure: Math.abs(netExposure),
      netExposureDirection,
      grossLongExposure,
      grossShortExposure,
      totalExposure,
      maxLeverage: Number(maxLeverage) / 10000,
      fundingRate: Number(fundingRate) / 100,
      twap: Number(formatUnits(twapData[0], 8)),
      spread: Number(twapData[1]),
      feeSplits: { juniorSplitBps, insuranceSplitBps, treasurySplitBps },
      baseFeeRate,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Update all junior tranche UI elements with real on-chain data.
 * Populates hero stats, deposit/withdraw info, pool composition bars,
 * health metrics, fee breakdowns, and real-time share data.
 * Shows "N/A" placeholders if data is unavailable.
 * @returns {Promise<void>}
 */
async function updateJuniorPageUI() {
  const data = await fetchJuniorData();
  
  if (!data) {
    // Show "not available" message
    document.getElementById('juniorAPYDisplay').textContent = 'N/A';
    document.getElementById('juniorTVL').textContent = 'N/A';
    document.getElementById('poolUtilization').textContent = 'N/A';
    document.getElementById('yourJuniorPosition').textContent = '$0.00';
    return;
  }

  // Hero stats
  document.getElementById('juniorAPYDisplay').textContent = `${data.juniorAPY.toFixed(2)}%`;
  document.getElementById('juniorTVL').textContent = `$${formatNumber(data.totalJuniorTVL)}`;
  document.getElementById('poolUtilization').textContent = `${data.utilization.toFixed(1)}%`;
  document.getElementById('yourJuniorPosition').textContent = `$${data.userPosition.toFixed(2)}`;

  // Deposit/Withdraw info
  document.getElementById('juniorPositionWithdraw').textContent = `$${data.userPosition.toFixed(2)}`;
  document.getElementById('shareOfPool').textContent = data.totalShares > 0 
    ? `${((data.userShares / data.totalShares) * 100).toFixed(3)}%` 
    : '0.000%';
  document.getElementById('estimatedAPY').textContent = `${data.juniorAPY.toFixed(2)}%`;

  // Pool composition
  const seniorSegment = document.querySelector('.pool-segment.senior');
  const juniorSegment = document.querySelector('.pool-segment.junior');
  if (seniorSegment && juniorSegment) {
    seniorSegment.style.width = `${data.seniorRatio}%`;
    seniorSegment.querySelector('span').textContent = `Senior: ${data.seniorRatio.toFixed(0)}%`;
    juniorSegment.style.width = `${data.juniorRatio}%`;
    juniorSegment.querySelector('span').textContent = `Junior: ${data.juniorRatio.toFixed(0)}%`;
  }

  // Pool stats
  document.querySelectorAll('.pool-stat-value')[0].textContent = `$${formatNumber(data.totalSeniorTVL)}`;
  document.querySelectorAll('.pool-stat-value')[1].textContent = `$${formatNumber(data.totalJuniorTVL)}`;
  document.querySelectorAll('.pool-stat-value')[2].textContent = `$${formatNumber(data.totalTVL)}`;

  // Health metrics
  const healthValues = document.querySelectorAll('.health-value');
  healthValues[0].textContent = `${data.juniorRatio.toFixed(1)}%`;
  healthValues[0].className = 'health-value ' + (data.juniorRatio >= 25 && data.juniorRatio <= 40 ? 'positive' : 'warning');
  
  healthValues[1].textContent = `$${formatNumber(data.netExposure)} ${data.netExposureDirection}`;
  healthValues[2].textContent = `${data.avgLeverage.toFixed(2)}×`;
  
  // Update health bar
  const healthFill = document.querySelector('.health-fill');
  if (healthFill) {
    const healthPct = Math.min(100, (data.juniorRatio / 40) * 100);
    healthFill.style.width = `${healthPct}%`;
    healthFill.style.background = data.juniorRatio >= 25 && data.juniorRatio <= 40 
      ? 'var(--green)' 
      : 'var(--yellow)';
  }

  // Fee breakdown - calculate monthly fees from on-chain fee config
  const monthlyFees = (data.totalSeniorTVL * data.avgLeverage * data.baseFeeRate) / 12;
  const juniorShare = monthlyFees * (data.feeSplits.juniorSplitBps / 10000);
  const insuranceShare = monthlyFees * (data.feeSplits.insuranceSplitBps / 10000);
  const protocolShare = monthlyFees * (data.feeSplits.treasurySplitBps / 10000);

  const feeItems = document.querySelectorAll('.fee-breakdown .fee-item span:last-child');
  if (feeItems.length >= 6) {
    feeItems[0].textContent = `+$${formatNumber(monthlyFees)}/mo`;
    feeItems[1].textContent = `+$${formatNumber(monthlyFees * 0.15)}/mo`; // Circuit breaker estimate
    feeItems[2].textContent = `+$${formatNumber(monthlyFees * 1.15)}/mo`;
    feeItems[3].textContent = `+$${formatNumber(juniorShare)}/mo`;
    feeItems[4].textContent = `+$${formatNumber(insuranceShare)}/mo`;
    feeItems[5].textContent = `+$${formatNumber(protocolShare)}/mo`;
  }

  // Real-time metrics
  const sharePriceEl = document.getElementById('juniorSharePrice');
  const totalSharesEl = document.getElementById('juniorTotalShares');
  const userSharesEl = document.getElementById('juniorUserShares');
  const maxLeverageEl = document.getElementById('juniorMaxLeverage');

  if (sharePriceEl) sharePriceEl.textContent = `$${data.sharePrice.toFixed(4)}`;
  if (totalSharesEl) totalSharesEl.textContent = formatNumber(data.totalShares);
  if (userSharesEl) userSharesEl.textContent = data.userShares.toFixed(2);
  if (maxLeverageEl) maxLeverageEl.textContent = `${data.maxLeverage.toFixed(1)}×`;

}

/**
 * Format large numbers for display with K/M suffixes.
 * @param {number} num - Number to format
 * @returns {string} Formatted string (e.g., "1.50M", "25.3K", "123.45")
 */
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toFixed(2);
}

/**
 * Deposit USDC into the junior tranche of the selected vault.
 * Handles the full deposit flow: input validation, ERC-20 approval (infinite),
 * deposit transaction, receipt confirmation, and UI refresh.
 * @returns {Promise<void>}
 */
async function depositJuniorMultiAsset() {
  if (!walletClient || !connectedAddress) {
    showToast('Please connect your wallet first', 'error');
    return;
  }

  const depositAmount = document.getElementById('depositAmount').value;
  if (!depositAmount || parseFloat(depositAmount) <= 0) {
    showToast('Please enter a valid deposit amount', 'error');
    return;
  }

  try {
    const { parseUnits } = window.viem;
    const asset = DEPOSIT_ASSETS[selectedDepositAsset];
    const amount = parseUnits(depositAmount, asset.decimals);
    const vaultAddress = VAULT_ADDRESSES[selectedVault];

    // Get junior tranche address
    const juniorTrancheAddress = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'juniorTranche'
    }).catch(() => null);

    if (!juniorTrancheAddress) {
      showToast('⚠️ Junior tranche not available on this vault', 'error');
      return;
    }

    // Check and approve asset if needed
    const currentAllowance = await publicClient.readContract({
      address: asset.address,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [connectedAddress, vaultAddress]
    });

    if (currentAllowance < amount) {
      const MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
      
      const approveTx = await walletClient.writeContract({
        address: asset.address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vaultAddress, MAX_UINT256],
        account: connectedAddress,
        gas: 100000n,
        maxFeePerGas: 2000000000n,
        maxPriorityFeePerGas: 1000000000n
      });

      await publicClient.waitForTransactionReceipt({ hash: approveTx });
    } else {
    }

    // Deposit
    const depositTx = await walletClient.writeContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'depositJunior',
      args: [amount],
      account: connectedAddress,
      gas: 500000n,
      maxFeePerGas: 2000000000n,
      maxPriorityFeePerGas: 1000000000n
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });

    showToast(`✓ Successfully deposited ${depositAmount} ${asset.symbol}!`, 'success');
    
    // Wait a moment for state to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Refresh UI
    await fetchBalances();
    await updateAssetUI();
    await updateJuniorPageUI();

    document.getElementById('depositAmount').value = '';
  } catch (error) {
    showToast(`Deposit failed: ${error.shortMessage || error.message}`, 'error');
  }
}

/**
 * Withdraw from the junior tranche by burning shares.
 * Burns the specified number of junior shares and returns proportional USDC.
 * Handles input validation, transaction submission, receipt confirmation, and UI refresh.
 * @returns {Promise<void>}
 */
async function withdrawJunior() {
  if (!walletClient || !connectedAddress) {
    showToast('Please connect your wallet first', 'error');
    return;
  }

  const withdrawShares = document.getElementById('withdrawShares')?.value;
  if (!withdrawShares || parseFloat(withdrawShares) <= 0) {
    showToast('Please enter shares to withdraw', 'error');
    return;
  }

  try {
    const { parseUnits } = window.viem;
    const shares = parseUnits(withdrawShares, 6);
    const vaultAddress = VAULT_ADDRESSES[selectedVault];

    const withdrawTx = await walletClient.writeContract({
      address: vaultAddress,
      abi: [{
        name: 'withdrawJunior',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'shares', type: 'uint256' }],
        outputs: [{ name: 'amount', type: 'uint256' }],
      }],
      functionName: 'withdrawJunior',
      args: [shares],
      account: connectedAddress,
      gas: 500000n,
      maxFeePerGas: 2000000000n,
      maxPriorityFeePerGas: 1000000000n,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawTx });

    showToast(`Successfully withdrew ${withdrawShares} junior shares!`, 'success');

    await new Promise(resolve => setTimeout(resolve, 2000));
    await fetchBalances();
    await updateAssetUI();
    await updateJuniorPageUI();

    const el = document.getElementById('withdrawShares');
    if (el) el.value = '';
  } catch (error) {
    showToast(`Withdrawal failed: ${error.shortMessage || error.message}`, 'error');
  }
}

/**
 * Read the health score from the vault contract for the junior health display.
 * The health score is stored as a basis-point value (e.g., 15000 = 1.50 health factor).
 * @returns {Promise<number|null>} Health score as a decimal (e.g., 1.50), or null on failure
 */
async function fetchHealthScore() {
  if (!publicClient) return null;

  try {
    const vaultAddress = VAULT_ADDRESSES[selectedVault];
    const healthScore = await publicClient.readContract({
      address: vaultAddress,
      abi: [{
        name: 'getHealthScore',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
      }],
      functionName: 'getHealthScore',
    }).catch(() => 20000n);

    return Number(healthScore) / 10000; // 15000 → 1.50
  } catch {
    return null;
  }
}

/**
 * Update the deposit UI when the selected asset or vault changes.
 * Refreshes the input label, wallet balance display, deposit button text,
 * and balance row label to match the currently selected asset.
 * @returns {Promise<void>}
 */
async function updateAssetUI() {
  const depositContent = document.getElementById('depositContent');
  if (!depositContent) return;

  const asset = DEPOSIT_ASSETS[selectedDepositAsset];
  
  // Update input label
  const inputLabel = depositContent.querySelector('.input-group label');
  if (inputLabel) {
    inputLabel.textContent = `Amount (${asset.symbol})`;
  }

  // Update balance display
  const balanceDisplay = document.getElementById('usdcBalanceJunior');
  if (balanceDisplay && connectedAddress && publicClient) {
    try {
      const { formatUnits } = window.viem;
      const balance = await publicClient.readContract({
        address: asset.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [connectedAddress]
      });
      balanceDisplay.textContent = parseFloat(formatUnits(balance, asset.decimals)).toFixed(4);
    } catch (error) {
      balanceDisplay.textContent = '0.00';
    }
  }

  // Update deposit button text
  const depositBtn = document.getElementById('depositBtn');
  if (depositBtn) {
    depositBtn.textContent = `Deposit ${asset.symbol}`;
  }

  // Update info row label
  const balanceLabel = depositContent.querySelector('.info-row span:first-child');
  if (balanceLabel && balanceLabel.textContent.includes('Balance')) {
    balanceLabel.textContent = `Your ${asset.symbol} Balance:`;
  }
}

/**
 * Initialize the junior tranche page.
 * Creates the vault selector UI (SPY/QQQ), wires up deposit button handlers,
 * and triggers initial UI updates with USDC balance data.
 */
function initJuniorPage() {
  // No asset selector needed - junior deposits only accept USDC

  // Vault selector
  const juniorHero = document.querySelector('.junior-hero');
  if (juniorHero) {
    // Check if vault selector already exists to prevent duplicates
    let vaultSelector = juniorHero.querySelector('.vault-selector');
    
    if (!vaultSelector) {
      vaultSelector = document.createElement('div');
      vaultSelector.className = 'vault-selector';
      vaultSelector.innerHTML = `
        <label>Select Vault</label>
        <div class="vault-buttons">
          <button class="vault-btn" data-vault="wSPYx">SPY Vault</button>
          <button class="vault-btn active" data-vault="wQQQx">QQQ Vault</button>
        </div>
      `;
      juniorHero.appendChild(vaultSelector);
    }

    // Vault button handlers
    document.querySelectorAll('.vault-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.vault-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedVault = btn.dataset.vault;
        
        // Update UI for selected vault
        await updateAssetUI();
        await updateJuniorPageUI();
      });
    });
  }

  // Update deposit button
  const depositBtn = document.getElementById('depositBtn');
  if (depositBtn) {
    depositBtn.onclick = depositJuniorMultiAsset;
    depositBtn.textContent = 'Deposit USDC';
  }

  // Initialize UI with USDC balance
  updateAssetUI();

}

// Export functions
window.updateJuniorPageUI = updateJuniorPageUI;
window.depositJuniorMultiAsset = depositJuniorMultiAsset;
window.withdrawJunior = withdrawJunior;
window.fetchHealthScore = fetchHealthScore;
window.initJuniorPage = initJuniorPage;
