// Junior Tranche Manager - Real-time on-chain data and multi-asset deposits

// Asset options for deposits
const DEPOSIT_ASSETS = {
  USDC: { address: '0x6b57475467cd854d36Be7FB614caDa5207838943', decimals: 6, symbol: 'USDC' },
  wSPYx: { address: '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e', decimals: 18, symbol: 'wSPYx' },
  wQQQx: { address: '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9', decimals: 18, symbol: 'wQQQx' }
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
      totalShares,
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
        functionName: 'balanceOf',
        args: [connectedAddress]
      }),
      publicClient.readContract({
        address: juniorTrancheAddress,
        abi: JUNIOR_TRANCHE_ABI,
        functionName: 'totalSupply'
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
    const userPosition = Number(formatUnits(userShares, 18)) * sharePrice;
    const totalSeniorTVL = Number(formatUnits(poolState.totalSeniorDeposits, 6));
    const totalTVL = totalJuniorTVL + totalSeniorTVL;
    
    const juniorRatio = totalTVL > 0 ? (totalJuniorTVL / totalTVL) * 100 : 0;
    const seniorRatio = 100 - juniorRatio;
    
    const utilization = totalJuniorTVL > 0 ? (totalSeniorTVL / totalJuniorTVL) * 100 : 0;
    
    // Calculate APY from fees
    const avgLeverage = poolState.grossLongExposure + poolState.grossShortExposure > 0n
      ? Number(poolState.grossLongExposure + poolState.grossShortExposure) / Number(poolState.totalSeniorDeposits)
      : 0;
    
    const baseFeeRate = 0.02; // 2% base annual fee
    const annualFees = totalSeniorTVL * avgLeverage * baseFeeRate;
    const juniorAPY = totalJuniorTVL > 0 ? (annualFees * 0.7 / totalJuniorTVL) * 100 : 0;

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
      userShares: Number(formatUnits(userShares, 18)),
      totalShares: Number(formatUnits(totalShares, 18)),
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
    alert('Please connect your wallet first');
    return;
  }

  const depositAmount = document.getElementById('depositAmount').value;
  if (!depositAmount || parseFloat(depositAmount) <= 0) {
    alert('Please enter a valid deposit amount');
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
      alert('⚠️ Junior tranche not available on this vault');
      return;
    }

    // Approve asset
    console.log(`Approving ${asset.symbol}...`);
    const approveTx = await walletClient.writeContract({
      address: asset.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, amount],
      account: connectedAddress,
      gas: 100000n
    });

    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Deposit
    console.log(`Depositing ${asset.symbol} to junior tranche...`);
    const depositTx = await walletClient.writeContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'depositJunior',
      args: [amount],
      account: connectedAddress,
      gas: 500000n
    });

    await publicClient.waitForTransactionReceipt({ hash: depositTx });

    showToast(`✓ Successfully deposited ${depositAmount} ${asset.symbol}!`, 'success');
    
    // Refresh UI
    await fetchBalances();
    await updateJuniorPageUI();
    
    document.getElementById('depositAmount').value = '';
  } catch (error) {
    console.error('Junior deposit failed:', error);
    showToast(`Deposit failed: ${error.shortMessage || error.message}`, 'error');
  }
}

// Initialize junior page
function initJuniorPage() {
  // Asset selector
  const depositContent = document.getElementById('depositContent');
  if (depositContent) {
    const assetSelector = document.createElement('div');
    assetSelector.className = 'asset-selector';
    assetSelector.innerHTML = `
      <label>Deposit Asset</label>
      <div class="asset-buttons">
        <button class="asset-btn active" data-asset="USDC">USDC</button>
        <button class="asset-btn" data-asset="wSPYx">wSPYx</button>
        <button class="asset-btn" data-asset="wQQQx">wQQQx</button>
      </div>
    `;
    
    const inputGroup = depositContent.querySelector('.input-group');
    depositContent.insertBefore(assetSelector, inputGroup);

    // Asset button handlers
    document.querySelectorAll('.asset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.asset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDepositAsset = btn.dataset.asset;
        
        // Update label
        const label = depositContent.querySelector('label');
        label.textContent = `Amount (${selectedDepositAsset})`;
      });
    });
  }

  // Vault selector
  const juniorHero = document.querySelector('.junior-hero');
  if (juniorHero) {
    const vaultSelector = document.createElement('div');
    vaultSelector.className = 'vault-selector';
    vaultSelector.innerHTML = `
      <label>Select Vault</label>
      <div class="vault-buttons">
        <button class="vault-btn" data-vault="wSPYx">SPY Vault</button>
        <button class="vault-btn active" data-vault="wQQQx">QQQ Vault</button>
      </div>
    `;
    juniorHero.appendChild(vaultSelector);

    // Vault button handlers
    document.querySelectorAll('.vault-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.vault-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedVault = btn.dataset.vault;
        await updateJuniorPageUI();
      });
    });
  }

  // Update deposit button
  const depositBtn = document.getElementById('depositBtn');
  if (depositBtn) {
    depositBtn.onclick = depositJuniorMultiAsset;
  }

  console.log('✓ Junior page initialized');
}

// Export functions
window.updateJuniorPageUI = updateJuniorPageUI;
window.depositJuniorMultiAsset = depositJuniorMultiAsset;
window.initJuniorPage = initJuniorPage;
