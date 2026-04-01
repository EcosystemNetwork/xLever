// Junior Tranche Manager - Real-time on-chain data and multi-asset deposits

// Asset options for deposits - Junior tranche only accepts USDC
const DEPOSIT_ASSETS = {
  USDC: { address: '0x6b57475467cd854d36Be7FB614caDa5207838943', decimals: 6, symbol: 'USDC' }
};

let selectedDepositAsset = 'USDC';
let selectedVault = 'wQQQx'; // Default vault for junior deposits

// Fetch comprehensive junior tranche data
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
      console.log('⚠️ Junior tranche not available');
      return null;
    }

    // Fetch all data in parallel
    const [
      poolState,
      juniorValue,
      userShares,
      totalSharesValue,
      fundingRate,
      maxLeverage,
      twapData
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
      }).catch(() => [0n, 0n])
    ]);

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
    
    // Calculate APY from fees with safeguards
    const avgLeverage = (poolState.totalSeniorDeposits > 0n && poolState.grossLongExposure + poolState.grossShortExposure > 0n)
      ? Number(formatUnits(poolState.grossLongExposure + poolState.grossShortExposure, 6)) / totalSeniorTVL
      : 0;
    
    const baseFeeRate = 0.02; // 2% base annual fee
    const annualFees = totalSeniorTVL * avgLeverage * baseFeeRate;
    
    // Cap APY to reasonable maximum (1000%) and require minimum TVL threshold
    let juniorAPY = 0;
    if (totalJuniorTVL > 0.01) { // Require at least $0.01 junior TVL
      juniorAPY = Math.min((annualFees * 0.7 / totalJuniorTVL) * 100, 1000);
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
      spread: Number(twapData[1])
    };
  } catch (error) {
    console.error('Error fetching junior data:', error);
    return null;
  }
}

// Update all junior UI elements with real data
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

  // Fee breakdown - calculate real monthly fees
  const monthlyFees = (data.totalSeniorTVL * data.avgLeverage * 0.02) / 12;
  const juniorShare = monthlyFees * 0.7;
  const insuranceShare = monthlyFees * 0.2;
  const protocolShare = monthlyFees * 0.1;

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

  console.log('✓ Junior page UI updated with real data');
}

// Format large numbers
function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toFixed(2);
}

// Deposit with selected asset
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
      console.log(`Approving ${asset.symbol} (infinite approval)...`);
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
      console.log(`✓ ${asset.symbol} already approved, skipping...`);
    }

    // Deposit
    console.log(`Depositing ${asset.symbol} to junior tranche...`);
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

    console.log('Waiting for deposit confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
    console.log('✓ Deposit confirmed:', receipt);

    showToast(`✓ Successfully deposited ${depositAmount} ${asset.symbol}!`, 'success');
    
    // Wait a moment for state to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Refresh UI
    console.log('Refreshing balances and UI...');
    await fetchBalances();
    await updateAssetUI();
    await updateJuniorPageUI();
    
    document.getElementById('depositAmount').value = '';
    console.log('✓ UI refreshed');
  } catch (error) {
    console.error('Junior deposit failed:', error);
    showToast(`Deposit failed: ${error.shortMessage || error.message}`, 'error');
  }
}

// Asset selector removed - junior deposits only accept USDC

// Update UI when asset selection changes
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
      console.error('Error fetching balance:', error);
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

// Initialize junior page
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

  console.log('✓ Junior page initialized - USDC only');
}

// Export functions
window.updateJuniorPageUI = updateJuniorPageUI;
window.depositJuniorMultiAsset = depositJuniorMultiAsset;
window.initJuniorPage = initJuniorPage;
