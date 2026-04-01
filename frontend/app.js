// ═══════════════════════════════════════════════════════════
// WALLET CONNECTION (VIEM)
// ═══════════════════════════════════════════════════════════

let walletClient = null;
let publicClient = null;
let connectedAddress = null;

// Token contract addresses
const TOKEN_ADDRESSES = {
  USDC: '0x6b57475467cd854d36Be7FB614caDa5207838943',
  wQQQx: '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9',
  wSPYx: '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e'
};

// Vault contract addresses (deployed on Ink Sepolia testnet)
const VAULT_ADDRESSES = {
  wSPYx: '0x93c0323D7133E2e9D57133a629a35Df17797d890',
  wQQQx: '0x0C2c35ed457a4532794602a588eB0C086Ebd67DB'
};

// Minimal ERC-20 ABI for balanceOf
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
];

// Vault ABI for deposits and withdrawals
const VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'leverageBps', type: 'int32' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'depositJunior',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: 'shares', type: 'uint256' }]
  },
  {
    name: 'withdrawJunior',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'amount', type: 'uint256' }]
  },
  {
    name: 'getPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'depositAmount', type: 'uint128' },
        { name: 'leverageBps', type: 'int32' },
        { name: 'entryTWAP', type: 'uint128' },
        { name: 'lastFeeTimestamp', type: 'uint64' },
        { name: 'settledFees', type: 'uint128' },
        { name: 'leverageLockExpiry', type: 'uint32' },
        { name: 'isActive', type: 'bool' }
      ]
    }]
  },
  {
    name: 'getJuniorValue',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'totalValue', type: 'uint256' },
      { name: 'sharePrice', type: 'uint256' }
    ]
  },
  {
    name: 'juniorTranche',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    name: 'getPoolState',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'totalSeniorDeposits', type: 'uint128' },
        { name: 'totalJuniorDeposits', type: 'uint128' },
        { name: 'grossLongExposure', type: 'uint128' },
        { name: 'grossShortExposure', type: 'uint128' },
        { name: 'netExposure', type: 'int256' },
        { name: 'currentMaxLeverageBps', type: 'uint32' },
        { name: 'protocolState', type: 'uint8' }
      ]
    }]
  },
  {
    name: 'getMaxLeverage',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'maxLeverageBps', type: 'int32' }]
  },
  {
    name: 'getFundingRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'rateBps', type: 'int256' }]
  },
  {
    name: 'getCurrentTWAP',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'twap', type: 'uint128' },
      { name: 'spreadBps', type: 'uint16' }
    ]
  },
  {
    name: 'LoopExecuted',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'iteration', type: 'uint256', indexed: false },
      { name: 'deposited', type: 'uint256', indexed: false },
      { name: 'borrowed', type: 'uint256', indexed: false }
    ]
  },
  {
    name: 'PositionOpened',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'totalCollateral', type: 'uint256', indexed: false },
      { name: 'totalDebt', type: 'uint256', indexed: false },
      { name: 'leverage', type: 'int32', indexed: false }
    ]
  },
  {
    name: 'getEulerPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{
      name: '',
      type: 'tuple',
      components: [
        { name: 'collateralVault', type: 'address' },
        { name: 'debtVault', type: 'address' },
        { name: 'collateralShares', type: 'uint128' },
        { name: 'debtAmount', type: 'uint128' },
        { name: 'isActive', type: 'bool' }
      ]
    }]
  },
  {
    name: 'getPositionHealth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'collateral', type: 'uint256' },
      { name: 'debt', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' }
    ]
  }
];

// Junior Tranche ABI
const JUNIOR_TRANCHE_ABI = [
  {
    name: 'getShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getUserValue',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getSharePrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'price', type: 'uint256' }]
  },
  {
    name: 'getTotalValue',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'value', type: 'uint256' }]
  },
  {
    name: 'totalShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  }
];

async function fetchBalances() {
  if (!connectedAddress || !publicClient) return;

  try {
    // Fetch ETH balance
    const ethBalance = await publicClient.getBalance({ 
      address: connectedAddress 
    });
    const { formatEther, formatUnits } = window.viem;
    document.getElementById('ethBalance').textContent = parseFloat(formatEther(ethBalance)).toFixed(4);

    // Fetch USDC balance
    const usdcBalance = await publicClient.readContract({
      address: TOKEN_ADDRESSES.USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [connectedAddress]
    });
    document.getElementById('usdcBalance').textContent = parseFloat(formatUnits(usdcBalance, 6)).toFixed(2);
    
    // Update junior view USDC balance
    const usdcBalanceJunior = document.getElementById('usdcBalanceJunior');
    if (usdcBalanceJunior) {
      usdcBalanceJunior.textContent = parseFloat(formatUnits(usdcBalance, 6)).toFixed(2);
    }

    // Fetch wQQQx balance
    const wqqqxBalance = await publicClient.readContract({
      address: TOKEN_ADDRESSES.wQQQx,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [connectedAddress]
    });
    document.getElementById('wqqqxBalance').textContent = parseFloat(formatUnits(wqqqxBalance, 18)).toFixed(4);

    // Fetch wSPYx balance
    const wspyxBalance = await publicClient.readContract({
      address: TOKEN_ADDRESSES.wSPYx,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [connectedAddress]
    });
    document.getElementById('wspyxBalance').textContent = parseFloat(formatUnits(wspyxBalance, 18)).toFixed(4);

    console.log('✓ Balances updated');
  } catch (error) {
    console.error('Failed to fetch balances:', error);
  }
}

async function fetchJuniorPosition(vaultAddress) {
  if (!connectedAddress || !publicClient) return null;

  try {
    const { formatUnits } = window.viem;
    
    // Try to get junior tranche address - will fail if vault doesn't support it
    const juniorTrancheAddress = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'juniorTranche'
    }).catch(() => null);

    if (!juniorTrancheAddress) {
      console.log('Vault does not support junior tranche:', vaultAddress);
      return null;
    }

    // Get user's shares
    const shares = await publicClient.readContract({
      address: juniorTrancheAddress,
      abi: JUNIOR_TRANCHE_ABI,
      functionName: 'getShares',
      args: [connectedAddress]
    });

    // Get user's value
    const userValue = await publicClient.readContract({
      address: juniorTrancheAddress,
      abi: JUNIOR_TRANCHE_ABI,
      functionName: 'getUserValue',
      args: [connectedAddress]
    });

    // Get share price
    const sharePrice = await publicClient.readContract({
      address: juniorTrancheAddress,
      abi: JUNIOR_TRANCHE_ABI,
      functionName: 'getSharePrice'
    });

    // Get total value
    const totalValue = await publicClient.readContract({
      address: juniorTrancheAddress,
      abi: JUNIOR_TRANCHE_ABI,
      functionName: 'getTotalValue'
    });

    return {
      shares: parseFloat(formatUnits(shares, 6)),
      userValue: parseFloat(formatUnits(userValue, 6)),
      sharePrice: parseFloat(formatUnits(sharePrice, 6)),
      totalValue: parseFloat(formatUnits(totalValue, 6))
    };
  } catch (error) {
    console.log('Junior tranche not available for vault:', vaultAddress);
    return null;
  }
}

async function updateJuniorUI() {
  if (!connectedAddress || !publicClient) return;

  // Use the comprehensive junior page UI update if available
  if (typeof updateJuniorPageUI === 'function') {
    await updateJuniorPageUI();
  } else {
    // Fallback to basic update
    try {
      const wqqqxPosition = await publicClient.readContract({
        address: VAULT_ADDRESSES.wQQQx,
        abi: VAULT_ABI,
        functionName: 'juniorTranche'
      }).catch(() => null);

      if (!wqqqxPosition) {
        document.getElementById('yourJuniorPosition').textContent = 'Not Available';
        document.getElementById('juniorTVL').textContent = 'Not Available';
        document.getElementById('juniorPositionWithdraw').textContent = 'Not Available';
        document.getElementById('poolUtilization').textContent = 'N/A';
        return;
      }

      document.getElementById('yourJuniorPosition').textContent = '$0.00';
      document.getElementById('juniorTVL').textContent = '$0.00';
      document.getElementById('juniorPositionWithdraw').textContent = '$0.00';
      document.getElementById('poolUtilization').textContent = '0%';
    } catch (error) {
      console.error('Error updating junior UI:', error);
    }
  }
}

async function depositJunior() {
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
    const amount = parseUnits(depositAmount, 6);

    // Use wQQQx vault by default (can be made dynamic)
    const vaultAddress = VAULT_ADDRESSES.wQQQx;

    // Check if vault supports junior tranche
    const juniorTrancheAddress = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'juniorTranche'
    }).catch(() => null);

    if (!juniorTrancheAddress) {
      showToast('⚠️ Junior tranche not available on current vaults', 'error');
      return;
    }

    // First approve USDC
    console.log('Approving USDC...');
    const approveTx = await walletClient.writeContract({
      address: TOKEN_ADDRESSES.USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, amount],
      account: connectedAddress,
      gas: 100000n,
      maxFeePerGas: 2000000000n,
      maxPriorityFeePerGas: 1000000000n
    });

    console.log('Waiting for approval confirmation...');
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Then deposit
    console.log('Depositing to junior tranche...');
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
    await publicClient.waitForTransactionReceipt({ hash: depositTx });

    showToast('✓ Junior deposit successful!', 'success');
    
    // Refresh balances and UI
    await fetchBalances();
    await updateJuniorUI();
    
    // Clear input
    document.getElementById('depositAmount').value = '';
  } catch (error) {
    console.error('Junior deposit failed:', error);
    showToast('Deposit failed: ' + (error.shortMessage || error.message || 'Unknown error'), 'error');
  }
}

async function withdrawJunior() {
  if (!walletClient || !connectedAddress) {
    showToast('Please connect your wallet first', 'error');
    return;
  }

  const withdrawAmount = document.getElementById('withdrawAmount').value;
  if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
    showToast('Please enter a valid withdrawal amount', 'error');
    return;
  }

  try {
    const { parseUnits } = window.viem;
    const vaultAddress = VAULT_ADDRESSES.wQQQx;

    // Check if vault supports junior tranche
    const juniorTrancheCheck = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'juniorTranche'
    }).catch(() => null);

    if (!juniorTrancheCheck) {
      showToast('⚠️ Junior tranche not available on current vaults', 'error');
      return;
    }

    // Get junior tranche address
    const juniorTrancheAddress = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'juniorTranche'
    });

    // Get share price to calculate shares needed
    const sharePrice = await publicClient.readContract({
      address: juniorTrancheAddress,
      abi: JUNIOR_TRANCHE_ABI,
      functionName: 'getSharePrice'
    });

    // Calculate shares to withdraw (amount * 1e6 / sharePrice)
    const amountInUsdc = parseUnits(withdrawAmount, 6);
    const shares = (amountInUsdc * BigInt(1e6)) / sharePrice;

    console.log('Withdrawing from junior tranche...');
    const withdrawTx = await walletClient.writeContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'withdrawJunior',
      args: [shares],
      account: connectedAddress,
      gas: 500000n
    });

    console.log('Waiting for withdrawal confirmation...');
    await publicClient.waitForTransactionReceipt({ hash: withdrawTx });

    showToast('✓ Junior withdrawal successful!', 'success');
    
    // Refresh balances and UI
    await fetchBalances();
    await updateJuniorUI();
    
    // Clear input
    document.getElementById('withdrawAmount').value = '';
  } catch (error) {
    console.error('Junior withdrawal failed:', error);
    showToast('Withdrawal failed: ' + (error.shortMessage || error.message || 'Unknown error'), 'error');
  }
}

async function switchToInkSepolia() {
  try {
    // First try to switch
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0xBA6ED' }],
    });
    console.log('✓ Switched to Ink Sepolia');
    return true;
  } catch (switchError) {
    // If network not added (error 4902), add it
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xBA6ED',
            chainName: 'Ink Sepolia',
            nativeCurrency: {
              name: 'ETH',
              symbol: 'ETH',
              decimals: 18
            },
            rpcUrls: ['https://lb.drpc.org/ogrpc?network=ink-sepolia&dkey=AmNgmLfXikwWhpaarzWUjEmU59gkRdwR8ImsKlzbRHZc'],
            blockExplorerUrls: ['https://explorer-sepolia.inkonchain.com']
          }]
        });
        console.log('✓ Added and switched to Ink Sepolia');
        return true;
      } catch (addError) {
        console.error('Failed to add network:', addError);
        return false;
      }
    } else if (switchError.code === 4001) {
      console.log('User rejected network switch');
      return false;
    } else {
      console.error('Network switch error:', switchError);
      return false;
    }
  }
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      showToast('Please install MetaMask or another Web3 wallet to connect.', 'warning', 5000);
      return;
    }

    const accounts = await window.ethereum.request({ 
      method: 'eth_requestAccounts' 
    });
    
    if (accounts.length === 0) {
      throw new Error('No accounts found');
    }

    // Check current network
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainId, 16);
    
    // Only switch if not already on Ink Sepolia
    if (currentChainId !== 763373) {
      console.log(`Current network: ${currentChainId}, switching to Ink Sepolia (763373)...`);
      const switched = await switchToInkSepolia();
      
      if (!switched) {
        showToast('Please switch to Ink Sepolia network in MetaMask.\n\nChain ID: 763373', 'warning', 6000);
        return;
      }
    } else {
      console.log('✓ Already on Ink Sepolia');
    }

    const { createWalletClient, createPublicClient, custom, http, inkSepolia } = window.viem;
    
    walletClient = createWalletClient({
      chain: inkSepolia,
      transport: custom(window.ethereum)
    });

    publicClient = createPublicClient({
      chain: inkSepolia,
      transport: http('https://lb.drpc.org/ogrpc?network=ink-sepolia&dkey=AmNgmLfXikwWhpaarzWUjEmU59gkRdwR8ImsKlzbRHZc')
    });

    connectedAddress = accounts[0];
    
    updateWalletUI();
    await fetchBalances();
    await updateJuniorUI();
    await loadUserPositions();
    
    localStorage.setItem('walletConnected', 'true');
    console.log('✓ Wallet connected:', connectedAddress);
    
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    showToast('Failed to connect wallet. Please try again.', 'error');
  }
}

function disconnectWallet() {
  walletClient = null;
  connectedAddress = null;
  localStorage.removeItem('walletConnected');
  updateWalletUI();
  console.log('✓ Wallet disconnected');
}

function updateWalletUI() {
  const connectBtn = document.getElementById('connectWalletBtn');
  const walletInfo = document.getElementById('walletInfo');
  const walletAddress = document.getElementById('walletAddress');
  
  if (connectedAddress) {
    connectBtn.style.display = 'none';
    walletInfo.style.display = 'flex';
    walletAddress.textContent = `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`;
  } else {
    connectBtn.style.display = 'block';
    walletInfo.style.display = 'none';
  }
}

// Listen for account changes
if (window.ethereum) {
  window.ethereum.on('accountsChanged', async (accounts) => {
    if (accounts.length === 0) {
      disconnectWallet();
    } else {
      connectedAddress = accounts[0];
      updateWalletUI();
      await fetchBalances();
      await loadUserPositions();
      console.log('✓ Account changed:', connectedAddress);
    }
  });

  window.ethereum.on('chainChanged', () => {
    window.location.reload();
  });
}

// ═══════════════════════════════════════════════════════════
// DATA LAYER
// Replace generateQQQData with fetchRealData for production
// ═══════════════════════════════════════════════════════════

let _seed = 42;
function srand() { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647; }
function boxMuller() { return Math.sqrt(-2 * Math.log(srand())) * Math.cos(2 * Math.PI * srand()); }

function generateQQQData(years) {
  const days = Math.floor(years * 252);
  const mu = 0.13 / 252, sigma = 0.22 / Math.sqrt(252);
  const ohlcv = [];
  let price = 100, vol = 1.0;
  const d = new Date(); d.setFullYear(d.getFullYear() - years);

  for (let i = 0; i < days; i++) {
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    if (srand() < 0.003) vol = 1.6 + srand(); else if (vol > 1.0) vol *= 0.975;
    const ret = mu + sigma * vol * boxMuller();
    const open = price, close = price * (1 + ret);
    const high = Math.max(open, close) * (1 + Math.abs(boxMuller()) * 0.005);
    const low = Math.min(open, close) * (1 - Math.abs(boxMuller()) * 0.005);
    ohlcv.push({ time: d.toISOString().split('T')[0], open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close: +close.toFixed(4) });
    price = close;
  }
  return ohlcv;
}

// ──────────────────────────────────────────────────
// REAL DATA FETCHING (Yahoo Finance via api.wrapsynth.com)
// ──────────────────────────────────────────────────

let allData = [];
let dataLoading = true;
let currentTicker = 'QQQ';
let currentLeverage = 2.0, currentPeriod = '1Y', currentChartType = 'area';
let entryDateIndex = 0;
let isDegenMode = false;
let MIN_LEV = -3.5, MAX_LEV = 3.5;
const NORMAL_MIN = -3.5, NORMAL_MAX = 3.5;
const DEGEN_MIN = -100.0, DEGEN_MAX = 100.0;

async function fetchRealData(symbol, years) {
  try {
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - (years * 365 * 24 * 60 * 60);
    
    const API_BASE_URL = 'https://api.wrapsynth.com';
    const url = `${API_BASE_URL}/api/yahoo/${symbol}?period1=${startDate}&period2=${endDate}&interval=1d`;
    
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    
    const data = await resp.json();
    
    if (!data.chart || !data.chart.result || !data.chart.result[0]) {
      throw new Error('Invalid response from Yahoo Finance API');
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    
    const ohlcv = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quotes.close[i] === null) continue;
      
      const date = new Date(timestamps[i] * 1000);
      ohlcv.push({
        time: date.toISOString().split('T')[0],
        open: +(quotes.open[i] || quotes.close[i]).toFixed(4),
        high: +(quotes.high[i] || quotes.close[i]).toFixed(4),
        low: +(quotes.low[i] || quotes.close[i]).toFixed(4),
        close: +quotes.close[i].toFixed(4)
      });
    }
    
    return ohlcv;
  } catch (error) {
    console.error('Error fetching real data:', error);
    throw error;
  }
}

async function loadTickerData(ticker) {
  try {
    dataLoading = true;
    
    const cacheKey = `${ticker.toLowerCase()}_data_cache`;
    const cacheTimeKey = `${ticker.toLowerCase()}_data_cache_time`;
    const cached = localStorage.getItem(cacheKey);
    const cacheTime = localStorage.getItem(cacheTimeKey);
    const now = Date.now();
    const cacheMaxAge = 24 * 60 * 60 * 1000;
    
    if (cached && cacheTime && (now - parseInt(cacheTime)) < cacheMaxAge) {
      allData = JSON.parse(cached);
      dataLoading = false;
      console.log(`✓ Loaded ${allData.length} days of ${ticker} data from cache`);
    } else {
      allData = await fetchRealData(ticker, 25);
      dataLoading = false;
      
      try {
        localStorage.setItem(cacheKey, JSON.stringify(allData));
        localStorage.setItem(cacheTimeKey, now.toString());
        console.log(`✓ Loaded ${allData.length} days of real ${ticker} data from local server (cached)`);
      } catch (e) {
        console.warn('Failed to cache data:', e);
        console.log(`✓ Loaded ${allData.length} days of real ${ticker} data from local server`);
      }
    }
    
    entryDateIndex = 0;
    updateAll();
  } catch (error) {
    console.error('Failed to load data:', error);
    dataLoading = false;
    showToast('Error loading data. Please check your connection and refresh the page.', 'error', 6000);
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  await loadTickerData(currentTicker);
  setSliderPos(currentLeverage);
});

// ═══════════════════════════════════════════════════
// LEVERAGE ENGINE - LTAP Protocol (Constant from Entry)
// ═══════════════════════════════════════════════════

function getLTAPFee(leverage) {
  if (leverage === 0 || Math.abs(leverage) === 1.0) return 0;
  return 0.005 + 0.005 * Math.abs(leverage - 1);
}



function getDeleverageLevelDirect(underlyingDrawdown) {
  if (underlyingDrawdown >= 0.40) return 5;
  if (underlyingDrawdown >= 0.30) return 4;
  if (underlyingDrawdown >= 0.22) return 3;
  if (underlyingDrawdown >= 0.15) return 2;
  if (underlyingDrawdown >= 0.10) return 1;
  return 0;
}

function simulateProtocol(ohlcv, leverage, isShort, disableFees = false) {
  const result = [];
  const entryPrice = ohlcv[0].close;
  let currentDeposit = entryPrice;
  let currentEntry = entryPrice;
  let currentLev = leverage;
  let accruedFees = 0;
  let liquidated = false;
  const direction = isShort ? -1 : 1;
  let peakUnderlyingPrice = ohlcv[0].close;
  let lastFullLeverageDay = 0;
  const events = [];
  let totalDeleverageEvents = 0;
  let totalReleverEvents = 0;
  let totalSlippageCost = 0;
  let timeAtReducedLeverage = 0;
  let circuitBreakerDays = 0;
  let lastDeleverageDay = -999;
  let circuitBreakerUntil = -1;
  let circuitBreakerFeeUntil = -1;

  for (let i = 0; i < ohlcv.length; i++) {
    if (liquidated) {
      result.push({ time: ohlcv[i].time, value: 0, liquidated: true });
      continue;
    }

    const price = ohlcv[i].close;
    const move = (price - currentEntry) / currentEntry;

    const annualFee = getLTAPFee(currentLev);
    let dailyFee = annualFee / 252;
    
    if (i <= circuitBreakerFeeUntil) {
      dailyFee *= 2;
    }
    
    if (!disableFees && i > 0) {
      accruedFees += currentDeposit * dailyFee;
    }

    let value = currentDeposit * (1 + currentLev * direction * move) - accruedFees;

    if (i > 0) {
      const dailyReturn = Math.abs((ohlcv[i].close - ohlcv[i - 1].close) / ohlcv[i - 1].close);
      
      if (dailyReturn > 0.08) {
        circuitBreakerUntil = i + 5;
        circuitBreakerFeeUntil = i + 3;
        circuitBreakerDays += 5;
        
        events.push({ 
          time: ohlcv[i].time, 
          type: 'circuit_breaker', 
          reason: '8%+ daily move — RED'
        });
        
      } else if (dailyReturn > 0.05) {
        circuitBreakerUntil = Math.max(circuitBreakerUntil, i + 2);
        circuitBreakerFeeUntil = Math.max(circuitBreakerFeeUntil, i + 1);
        circuitBreakerDays += 2;
        
        events.push({ 
          time: ohlcv[i].time, 
          type: 'circuit_breaker', 
          reason: '5%+ daily move — YELLOW'
        });
      }
    }

    if (ohlcv[i].close > peakUnderlyingPrice) {
      peakUnderlyingPrice = ohlcv[i].close;
    }

    if (value > 0 && currentLev > 1.0) {
      const underlyingDD = (peakUnderlyingPrice - ohlcv[i].close) / peakUnderlyingPrice;
      
      const level = getDeleverageLevelDirect(underlyingDD);
      let newLev = currentLev;

      if (level === 5) {
        newLev = 0;
      } else if (level === 4) {
        newLev = 1.0;
      } else if (level === 3) {
        newLev = Math.min(currentLev, 1.5);
      } else if (level === 2) {
        newLev = 1 + (currentLev - 1) * 0.5;
      } else if (level === 1) {
        newLev = 1 + (currentLev - 1) * 0.75;
      }

      if (newLev < currentLev) {
        const slippageCost = level >= 5 ? 0.01 : level >= 4 ? 0.005 : level >= 3 ? 0.003 : 0.002;
        value *= (1 - slippageCost);
        totalSlippageCost += currentDeposit * slippageCost;
        
        events.push({ 
          time: ohlcv[i].time, 
          type: 'deleverage', 
          from: currentLev, 
          to: newLev, 
          level: level,
          slippage: slippageCost
        });
        totalDeleverageEvents++;
        
        if (newLev === 0) {
          liquidated = true;
          result.push({ time: ohlcv[i].time, value: 0, liquidated: true });
          continue;
        }
        
        currentDeposit = value;
        currentEntry = price;
        currentLev = newLev;
        accruedFees = 0;
        lastDeleverageDay = i;
      }
    }

    if (value > 0 && currentLev < leverage && i > circuitBreakerUntil) {
      const daysSinceDelev = i - lastDeleverageDay;
      
      if (daysSinceDelev >= 5) {
        const lookback = Math.min(3, i);
        const recentLow = Math.min(
          ...Array.from(
            {length: lookback}, 
            (_, k) => ohlcv[i - k].close
          )
        );
        const recovering = ohlcv[i].close > recentLow * 1.005;
        
        if (recovering) {
          const restored = Math.min(leverage, currentLev + 1.0);
          if (restored > currentLev) {
            const slippage = 0.001;
            value *= (1 - slippage);
            totalSlippageCost += currentDeposit * slippage;
            
            events.push({ 
              time: ohlcv[i].time, 
              type: 'relever', 
              from: currentLev, 
              to: restored,
              slippage: slippage
            });
            totalReleverEvents++;
            currentDeposit = value;
            currentEntry = price;
            currentLev = restored;
            accruedFees = 0;
            lastDeleverageDay = i;
            
            if (restored >= leverage) {
              peakUnderlyingPrice = price;
              lastFullLeverageDay = i;
            }
          }
        }
      }
    }

    if (value <= 0) {
      liquidated = true;
      result.push({ time: ohlcv[i].time, value: 0, liquidated: true });
    } else {
      if (currentLev < leverage) timeAtReducedLeverage++;
      result.push({ time: ohlcv[i].time, value: +value.toFixed(4), liquidated: false });
    }
  }
  
  return { 
    data: result, 
    liquidated, 
    liqTime: liquidated ? result.find(r => r.liquidated)?.time : null, 
    events,
    stats: {
      totalDeleverageEvents,
      totalReleverEvents,
      totalSlippageCost,
      timeAtReducedLeverage,
      circuitBreakerDays
    }
  };
}

function simulateProtocolOHLC(ohlcv, leverage, isShort, disableFees = false) {
  const result = [];
  const entryPrice = ohlcv[0].close;
  let currentDeposit = entryPrice;
  let currentEntry = entryPrice;
  let currentLev = leverage;
  let accruedFees = 0;
  let liquidated = false;
  const direction = isShort ? -1 : 1;
  let peakUnderlyingPrice = ohlcv[0].close;
  let lastFullLeverageDay = 0;
  const events = [];
  let totalDeleverageEvents = 0;
  let totalReleverEvents = 0;
  let totalSlippageCost = 0;
  let timeAtReducedLeverage = 0;
  let circuitBreakerDays = 0;
  let lastDeleverageDay = -999;
  let circuitBreakerUntil = -1;
  let circuitBreakerFeeUntil = -1;

  for (let i = 0; i < ohlcv.length; i++) {
    if (liquidated) {
      result.push({
        time: ohlcv[i].time,
        open: 0, high: 0, low: 0, close: 0,
        liquidated: true
      });
      continue;
    }

    const price = ohlcv[i].close;
    const annualFee = getLTAPFee(currentLev);
    let dailyFee = annualFee / 252;
    
    if (i <= circuitBreakerFeeUntil) {
      dailyFee *= 2;
    }
    
    if (!disableFees && i > 0) {
      accruedFees += currentDeposit * dailyFee;
    }

    const vals = [
      ohlcv[i].open,
      ohlcv[i].high,
      ohlcv[i].low,
      ohlcv[i].close
    ].map(p => {
      const move = (p - currentEntry) / currentEntry;
      return currentDeposit * (1 + currentLev * direction * move) - accruedFees;
    });

    const [o, h, l, c] = vals;
    let value = c;
    const minValue = Math.min(...vals);

    if (i > 0) {
      const dailyReturn = Math.abs((ohlcv[i].close - ohlcv[i - 1].close) / ohlcv[i - 1].close);
      
      if (dailyReturn > 0.08) {
        circuitBreakerUntil = i + 5;
        circuitBreakerFeeUntil = i + 3;
        circuitBreakerDays += 5;
        
        events.push({ 
          time: ohlcv[i].time, 
          type: 'circuit_breaker', 
          reason: '8%+ daily move — RED'
        });
        
      } else if (dailyReturn > 0.05) {
        circuitBreakerUntil = Math.max(circuitBreakerUntil, i + 2);
        circuitBreakerFeeUntil = Math.max(circuitBreakerFeeUntil, i + 1);
        circuitBreakerDays += 2;
        
        events.push({ 
          time: ohlcv[i].time, 
          type: 'circuit_breaker', 
          reason: '5%+ daily move — YELLOW'
        });
      }
    }

    if (ohlcv[i].close > peakUnderlyingPrice) {
      peakUnderlyingPrice = ohlcv[i].close;
    }

    if (minValue > 0 && currentLev > 1.0) {
      const currentUnderlyingLow = isShort 
        ? ohlcv[i].high
        : ohlcv[i].low;
      
      const underlyingDD = (peakUnderlyingPrice - currentUnderlyingLow) / peakUnderlyingPrice;
      const level = getDeleverageLevelDirect(underlyingDD);
      let newLev = currentLev;

      if (level === 5) {
        newLev = 0;
      } else if (level === 4) {
        newLev = 1.0;
      } else if (level === 3) {
        newLev = Math.min(currentLev, 1.5);
      } else if (level === 2) {
        newLev = 1 + (currentLev - 1) * 0.5;
      } else if (level === 1) {
        newLev = 1 + (currentLev - 1) * 0.75;
      }

      if (newLev < currentLev) {
        const slippageCost = level >= 5 ? 0.01 : level >= 4 ? 0.005 : level >= 3 ? 0.003 : 0.002;
        value *= (1 - slippageCost);
        totalSlippageCost += currentDeposit * slippageCost;
        
        events.push({ 
          time: ohlcv[i].time, 
          type: 'deleverage', 
          from: currentLev, 
          to: newLev, 
          level: level,
          slippage: slippageCost
        });
        totalDeleverageEvents++;
        
        if (newLev === 0) {
          liquidated = true;
          result.push({
            time: ohlcv[i].time,
            open: Math.max(o, 0.01),
            high: Math.max(h, 0.01),
            low: 0.01,
            close: 0.01,
            liquidated: true
          });
          continue;
        }
        
        currentDeposit = value;
        currentEntry = price;
        currentLev = newLev;
        accruedFees = 0;
        lastDeleverageDay = i;
      }
    }

    if (value > 0 && currentLev < leverage && i > circuitBreakerUntil) {
      const daysSinceDelev = i - lastDeleverageDay;
      
      if (daysSinceDelev >= 5) {
        const lookback = Math.min(3, i);
        const recentLow = Math.min(
          ...Array.from(
            {length: lookback}, 
            (_, k) => ohlcv[i - k].close
          )
        );
        const recovering = ohlcv[i].close > recentLow * 1.005;
        
        if (recovering) {
          const restored = Math.min(leverage, currentLev + 1.0);
          if (restored > currentLev) {
            const slippage = 0.001;
            value *= (1 - slippage);
            totalSlippageCost += currentDeposit * slippage;
            
            events.push({ 
              time: ohlcv[i].time, 
              type: 'relever', 
              from: currentLev, 
              to: restored,
              slippage: slippage
            });
            totalReleverEvents++;
            currentDeposit = value;
            currentEntry = price;
            currentLev = restored;
            accruedFees = 0;
            lastDeleverageDay = i;
            
            if (restored >= leverage) {
              peakUnderlyingPrice = price;
              lastFullLeverageDay = i;
            }
          }
        }
      }
    }

    if (minValue <= 0) {
      liquidated = true;
      result.push({
        time: ohlcv[i].time,
        open: Math.max(o, 0.01),
        high: Math.max(h, 0.01),
        low: 0.01,
        close: 0.01,
        liquidated: true
      });
    } else {
      if (currentLev < leverage) timeAtReducedLeverage++;
      result.push({
        time: ohlcv[i].time,
        open: +o.toFixed(4),
        high: +h.toFixed(4),
        low: +l.toFixed(4),
        close: +c.toFixed(4),
        liquidated: false
      });
    }
  }
  
  return { 
    data: result, 
    liquidated,
    liqTime: liquidated ? result.find(r => r.liquidated)?.time : null,
    events,
    stats: {
      totalDeleverageEvents,
      totalReleverEvents,
      totalSlippageCost,
      timeAtReducedLeverage,
      circuitBreakerDays
    }
  };
}

function applyDailyResetLeverage(ohlcv, leverage, short) {
  const borrowAPR = 0.052;
  const dailyBorrow = borrowAPR / 252;
  const result = [];
  let cumPrice = ohlcv[0].close;
  let liquidated = false;
  
  for (let i = 0; i < ohlcv.length; i++) {
    if (liquidated) {
      result.push({ time: ohlcv[i].time, value: 0 });
      continue;
    }
    
    if (i === 0) { result.push({ time: ohlcv[i].time, value: cumPrice }); continue; }
    const baseRet = ohlcv[i].close / ohlcv[i - 1].close - 1;
    const effectiveRet = short ? -baseRet : baseRet;
    const borrowMultiplier = short ? leverage : Math.max(0, leverage - 1);
    cumPrice *= 1 + leverage * effectiveRet - borrowMultiplier * dailyBorrow;
    
    if (cumPrice <= 0) {
      liquidated = true;
      cumPrice = 0;
    }
    
    result.push({ time: ohlcv[i].time, value: +cumPrice.toFixed(4) });
  }
  return { data: result, liquidated };
}

// ═══════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════

function calcStats(series, years) {
  const prices = series.map(s => s.value !== undefined ? s.value : s.close);

  let effectiveEnd = prices.length - 1;
  let wasLiquidated = false;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] <= 0) {
      effectiveEnd = i;
      wasLiquidated = true;
      break;
    }
  }

  const livePrices = prices.slice(0, effectiveEnd + 1);
  const returns = [];
  for (let i = 1; i < livePrices.length; i++) {
    if (livePrices[i - 1] > 0) {
      returns.push(livePrices[i] / livePrices[i - 1] - 1);
    }
  }

  const finalPrice = wasLiquidated ? 0 : prices[prices.length - 1];
  const totalReturn = prices[0] > 0 ? finalPrice / prices[0] - 1 : -1;

  let cagr;
  if (wasLiquidated || totalReturn <= -1) {
    cagr = -1;
  } else {
    const effectiveYears = wasLiquidated
      ? (effectiveEnd / prices.length) * years
      : years;
    cagr = effectiveYears > 0
      ? Math.pow(1 + totalReturn, 1 / effectiveYears) - 1
      : 0;
  }

  const mean = returns.length > 0
    ? returns.reduce((a, b) => a + b, 0) / returns.length
    : 0;
  const variance = returns.length > 0
    ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
    : 0;
  const vol = Math.sqrt(variance * 252);
  const sharpe = vol > 0 ? (cagr - 0.04) / vol : 0;

  let peak = prices[0], maxDD = 0;
  for (let i = 0; i < livePrices.length; i++) {
    if (livePrices[i] > peak) peak = livePrices[i];
    if (peak > 0) {
      const dd = (livePrices[i] - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
  }
  if (wasLiquidated) maxDD = -1;

  return { totalReturn, cagr, vol, sharpe, maxDD, liquidated: wasLiquidated };
}

// ═══════════════════════════════════════════════════
// TRADINGVIEW LIGHTWEIGHT CHARTS SETUP
// ═══════════════════════════════════════════════════

const chartEl = document.getElementById('tv-chart');
const chart = LightweightCharts.createChart(chartEl, {
  layout: { background: { type: 'solid', color: '#0a0b0e' }, textColor: '#555970', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
  grid: { vertLines: { color: '#ffffff06' }, horzLines: { color: '#ffffff06' } },
  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal,
    vertLine: { color: '#555970', width: 1, style: 2, labelBackgroundColor: '#1a1d26' },
    horzLine: { color: '#555970', width: 1, style: 2, labelBackgroundColor: '#1a1d26' },
  },
  rightPriceScale: { borderColor: '#252833', scaleMargins: { top: 0.15, bottom: 0.08 } },
  timeScale: { borderColor: '#252833', timeVisible: false, rightOffset: 0, fixLeftEdge: false, fixRightEdge: false },
  handleScroll: { vertTouchDrag: false },
});

let levAreaSeries = null, levCandleSeries = null, levLineSeries = null, baseSeries = null, depositRefSeries = null;

function removeSeries() {
  [levAreaSeries, levCandleSeries, levLineSeries, baseSeries, depositRefSeries].forEach(s => { if (s) chart.removeSeries(s); });
  levAreaSeries = levCandleSeries = levLineSeries = baseSeries = depositRefSeries = null;
}

function getFiltered(period) {
  const cut = new Date();
  let years;
  
  switch(period) {
    case '1M':
      cut.setMonth(cut.getMonth() - 1);
      years = 1/12;
      break;
    case '3M':
      cut.setMonth(cut.getMonth() - 3);
      years = 3/12;
      break;
    case '6M':
      cut.setMonth(cut.getMonth() - 6);
      years = 6/12;
      break;
    case '1Y':
      cut.setFullYear(cut.getFullYear() - 1);
      years = 1;
      break;
    case '3Y':
      cut.setFullYear(cut.getFullYear() - 3);
      years = 3;
      break;
    case '5Y':
      cut.setFullYear(cut.getFullYear() - 5);
      years = 5;
      break;
    case '10Y':
      cut.setFullYear(cut.getFullYear() - 10);
      years = 10;
      break;
    case '25Y':
      cut.setFullYear(cut.getFullYear() - 25);
      years = 25;
      break;
    case 'MAX':
      cut.setFullYear(cut.getFullYear() - 25);
      years = 25;
      break;
    default:
      cut.setFullYear(cut.getFullYear() - 1);
      years = 1;
  }
  
  const cutStr = cut.toISOString().split('T')[0];
  return { data: allData.filter(d => d.time >= cutStr), years: years };
}


function updateAll() {
  const { data, years } = getFiltered(currentPeriod);
  console.log(`Period: ${currentPeriod}, Data points: ${data.length}, Years: ${years}, First date: ${data[0]?.time}, Last date: ${data[data.length-1]?.time}`);
  if (data.length < 2) return;

  const isShort = currentLeverage < 0;
  const absMag = Math.abs(currentLeverage);

  // Use entryDateIndex for backtesting from a specific point
  const backtestData = data.slice(entryDateIndex);
  if (backtestData.length < 2) {
    entryDateIndex = 0;
    return updateAll();
  }

  const normBase = data.map(d => ({ time: d.time, value: +d.close.toFixed(4) }));
  const levResult = simulateProtocol(backtestData, absMag, isShort, false);
  const levOHLCResult = simulateProtocolOHLC(backtestData, absMag, isShort, false);
  const dailyResetResult = applyDailyResetLeverage(backtestData, absMag, isShort);
  const noFeeResult = simulateProtocol(backtestData, absMag, isShort, true);

  const levLine = levResult.data;
  const levOHLC = levOHLCResult.data;
  const dailyResetLine = dailyResetResult.data;
  const noFeeLine = noFeeResult.data;
  
  console.log(`First lev value: ${levLine[0]?.value}, Last lev value: ${levLine[levLine.length-1]?.value}`);

  const finalPnL = levLine[levLine.length - 1].value - levLine[0].value;
  const isProfitable = finalPnL >= 0;
  let accent;
  if (currentLeverage === 0) {
    accent = '#555970';
  } else if (isProfitable) {
    accent = '#00e676';
  } else {
    accent = '#ff5252';
  }

  removeSeries();

  baseSeries = chart.addLineSeries({ color: '#555970', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
  baseSeries.setData(normBase);

  const entryPrice = normBase[entryDateIndex].value;
  depositRefSeries = chart.addLineSeries({
    color: '#ffffff15', lineWidth: 1, lineStyle: 2,
    crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false
  });
  depositRefSeries.setData([
    { time: backtestData[0].time, value: entryPrice },
    { time: data[data.length - 1].time, value: entryPrice }
  ]);

  if (currentChartType === 'area') {
    levAreaSeries = chart.addAreaSeries({ lineColor: accent, topColor: accent + '30', bottomColor: accent + '05', lineWidth: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerRadius: 4, crosshairMarkerBackgroundColor: accent });
    levAreaSeries.setData(levLine);
  } else if (currentChartType === 'candlestick') {
    levCandleSeries = chart.addCandlestickSeries({ upColor: '#00e676', downColor: '#ff5252', borderUpColor: '#00e676', borderDownColor: '#ff5252', wickUpColor: '#00e67688', wickDownColor: '#ff525288', lastValueVisible: true, priceLineVisible: false });
    levCandleSeries.setData(levOHLC);
  } else {
    levLineSeries = chart.addLineSeries({ color: accent, lineWidth: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerRadius: 4 });
    levLineSeries.setData(levLine);
  }

  const activeSeries = levAreaSeries || levLineSeries || levCandleSeries;
  if (activeSeries && activeSeries.setMarkers) {
    const markers = [];

    if (levResult.events && levResult.events.length > 0) {
      levResult.events.forEach(evt => {
        if (evt.type === 'deleverage') {
          markers.push({
            time: evt.time,
            position: 'aboveBar',
            color: '#ffd740',
            shape: 'arrowDown',
            text: `DeLev ${evt.from.toFixed(1)}→${evt.to.toFixed(1)}× (L${evt.level}, -${(evt.slippage * 100).toFixed(1)}%)`
          });
        } else if (evt.type === 'relever') {
          markers.push({
            time: evt.time,
            position: 'belowBar',
            color: '#00e676',
            shape: 'arrowUp',
            text: `ReLev ${evt.from.toFixed(1)}→${evt.to.toFixed(1)}×`
          });
        } else if (evt.type === 'circuit_breaker') {
          markers.push({
            time: evt.time,
            position: 'aboveBar',
            color: '#ff8a80',
            shape: 'circle',
            text: `CB: ${evt.reason}`
          });
        }
      });
    }

    if (levResult.liquidated && levResult.liqTime) {
      markers.push({
        time: levResult.liqTime,
        position: 'belowBar',
        color: '#ff0000',
        shape: 'circle',
        text: '💀 LIQUIDATED 💀',
        size: 3
      });
    }

    // Add entry point marker if not at start
    if (entryDateIndex > 0) {
      markers.push({
        time: backtestData[0].time,
        position: 'belowBar',
        color: '#7c4dff',
        shape: 'circle',
        text: `Entry: $${entryPrice.toFixed(2)}`
      });
    }

    if (markers.length > 0) {
      markers.sort((a, b) => a.time.localeCompare(b.time));
      activeSeries.setMarkers(markers);
    }
  }

  // Force chart to show all data
  if (data.length > 0) {
    chart.timeScale().setVisibleLogicalRange({
      from: 0,
      to: data.length - 1,
    });
  } else {
    chart.timeScale().fitContent();
  }

  const levStats = calcStats(levLine, years);
  const baseLineStats = calcStats(normBase, years);
  const dailyResetStats = calcStats(dailyResetLine, years);
  const noFeeStats = calcStats(noFeeLine, years);

  const finalVal = levLine[levLine.length - 1].value;
  const directionLabel = absMag === 0 ? 'CASH' : (isShort ? 'SHORT' : 'LONG');
  const directionColor = absMag === 0 ? '#555970' : (isShort ? '#ff5252' : '#00e676');
  
  const overlayPriceEl = document.getElementById('overlayPrice');
  if (levResult.liquidated) {
    overlayPriceEl.textContent = '$0.00';
    overlayPriceEl.style.color = '#ff0000';
    overlayPriceEl.style.fontWeight = '900';
    overlayPriceEl.style.textShadow = '0 0 10px #ff0000';
    
    let liqBadge = document.getElementById('liqBadge');
    if (!liqBadge) {
      liqBadge = document.createElement('div');
      liqBadge.id = 'liqBadge';
      liqBadge.style.cssText = `
        display:inline-block;
        background:#ff0000;
        border:2px solid #ff0000;
        color:#000;
        font-family:'JetBrains Mono',monospace;
        font-size:13px;
        font-weight:900;
        padding:6px 12px;
        border-radius:6px;
        margin-top:8px;
        letter-spacing:1px;
        box-shadow: 0 0 20px #ff0000;
        animation: liquidation-pulse 1s ease-in-out infinite;
      `;
      overlayPriceEl.parentNode.insertBefore(liqBadge, overlayPriceEl.nextSibling);
    }
    liqBadge.textContent = `💀 LIQUIDATED ${levResult.liqTime}`;
    liqBadge.style.display = 'inline-block';
  } else {
    overlayPriceEl.textContent = '$' + finalVal.toFixed(2);
    overlayPriceEl.style.color = '';
    overlayPriceEl.style.fontWeight = '';
    overlayPriceEl.style.textShadow = '';
    const liqBadge = document.getElementById('liqBadge');
    if (liqBadge) liqBadge.style.display = 'none';
  }
  
  const signedDisplay = currentLeverage > 0
    ? '+' + absMag.toFixed(1)
    : currentLeverage < 0
      ? '-' + absMag.toFixed(1)
      : '0';

  if (absMag === 0) {
    document.getElementById('overlayLabel').innerHTML = `${currentTicker} — <span style="color:#555970">CASH</span> 0× (No exposure)`;
  } else if (absMag < 0.5 && absMag > 0) {
    document.getElementById('overlayLabel').innerHTML = `Leveraged ${currentTicker} — <span style="color:${directionColor}">${directionLabel}</span> ${signedDisplay}× <span style="font-size:9px;color:var(--text-muted);">(Minimal exposure)</span>`;
  } else {
    document.getElementById('overlayLabel').innerHTML = `Leveraged ${currentTicker} — <span style="color:${directionColor}">${directionLabel}</span> ${signedDisplay}×`;
  }
  const pct = levStats.totalReturn * 100;
  const chEl = document.getElementById('overlayChange');
  chEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  chEl.className = 'price-change mono ' + (pct >= 0 ? 'positive' : 'negative');
  document.getElementById('legendLev').textContent = `${signedDisplay}× LTAP`;

  document.getElementById('statMDD').textContent = (levStats.maxDD * 100).toFixed(1) + '%';
  document.getElementById('statSharpe').textContent = levStats.sharpe.toFixed(2);
  document.getElementById('statSharpe').className = 'stat-value ' + (levStats.sharpe > 0 ? 'positive' : 'negative');
  
  const baseVol = baseLineStats.vol;
  const levVol = levStats.vol;
  const volMultiple = baseVol > 0 ? levVol / baseVol : 0;
  const volEl = document.getElementById('statVol');
  volEl.textContent = (levVol * 100).toFixed(1) + '% (' + volMultiple.toFixed(1) + '× base)';
  if (volMultiple > 3) {
    volEl.className = 'stat-value negative';
  } else if (volMultiple > 2) {
    volEl.style.color = '#ffd740';
    volEl.className = 'stat-value';
  } else {
    volEl.className = 'stat-value';
    volEl.style.color = '';
  }
  document.getElementById('statCAGR').textContent = (levStats.cagr >= 0 ? '+' : '') + (levStats.cagr * 100).toFixed(1) + '%';
  document.getElementById('statCAGR').className = 'stat-value ' + (levStats.cagr >= 0 ? 'positive' : 'negative');

  const feeDragEl = document.getElementById('statFeeDrag');
  if (levStats.liquidated && !noFeeStats.liquidated) {
    feeDragEl.textContent = 'FATAL';
    feeDragEl.style.color = '#ff5252';
  } else if (levStats.liquidated && noFeeStats.liquidated) {
    feeDragEl.textContent = 'N/A (liq)';
    feeDragEl.style.color = '#555970';
  } else {
    const feeDragPct = (noFeeStats.totalReturn - levStats.totalReturn) * 100;
    feeDragEl.textContent = '-' + Math.abs(feeDragPct).toFixed(1) + '%';
    feeDragEl.style.color = '';
  }

  const vsDaily = (levStats.totalReturn - dailyResetStats.totalReturn) * 100;
  const vsDailyEl = document.getElementById('statVsDaily');
  vsDailyEl.textContent = (vsDaily >= 0 ? '+' : '') + vsDaily.toFixed(1) + '%';
  vsDailyEl.className = 'stat-value ' + (vsDaily >= 0 ? 'positive' : 'negative');

  document.getElementById('dynamicTicker').textContent = `${currentTicker} × ${signedDisplay}`;
  document.getElementById('levDisplay').textContent = `${signedDisplay}×`;
  document.getElementById('mobileLevDisplay').textContent = `${signedDisplay}×`;
  
  // Update position entry leverage display
  const currentLevDisplay = document.getElementById('currentLevDisplay');
  if (currentLevDisplay) {
    currentLevDisplay.textContent = `${signedDisplay}×`;
  }
  
  document.getElementById('legendBase').textContent = `${currentTicker} (1×)`;
  document.getElementById('compBaseTicker').textContent = `${currentTicker} 1×`;
  document.getElementById('dataSourceTicker').textContent = currentTicker;
  
  const tickerNames = {
    'QQQ': 'QQQ (Nasdaq-100)',
    'SPY': 'SPY (S&P 500)'
  };
  document.getElementById('underlyingName').textContent = tickerNames[currentTicker] || currentTicker;

  const fmt = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const cls = v => v >= 0 ? 'positive' : 'negative';
  
  document.getElementById('compQQQ').textContent = fmt(baseLineStats.totalReturn);
  document.getElementById('compQQQ').className = 'comp-return ' + cls(baseLineStats.totalReturn);
  
  document.getElementById('compLev').textContent = fmt(levStats.totalReturn);
  document.getElementById('compLev').className = 'comp-return ' + cls(levStats.totalReturn);
  document.getElementById('compLevTicker').textContent = `${currentTicker} ${signedDisplay}× (Protocol)`;
  
  document.getElementById('compDaily').textContent = fmt(dailyResetStats.totalReturn);
  document.getElementById('compDaily').className = 'comp-return ' + cls(dailyResetStats.totalReturn);
  document.getElementById('compDailyTicker').textContent = `${currentTicker} ${signedDisplay}× (Daily)`;
  
  document.getElementById('compNoFee').textContent = fmt(noFeeStats.totalReturn);
  document.getElementById('compNoFee').className = 'comp-return ' + cls(noFeeStats.totalReturn);
  document.getElementById('compNoFeeTicker').textContent = `${currentTicker} ${signedDisplay}× (No Fees)`;

  const annualFee = getLTAPFee(absMag);
  document.getElementById('annualFee').textContent = (annualFee * 100).toFixed(1) + '% APR';

  const totalPool = 10000000;
  const juniorRatio = 0.35;
  const juniorDeposits = totalPool * juniorRatio;
  const seniorDeposits = totalPool * (1 - juniorRatio);
  const totalAnnualFees = seniorDeposits * annualFee;
  const juniorAnnualShare = totalAnnualFees * 0.70;
  const insuranceAnnualShare = totalAnnualFees * 0.20;
  const juniorAPY = juniorDeposits > 0 ? (juniorAnnualShare / juniorDeposits) * 100 : 0;
  const insuranceAccumulated = insuranceAnnualShare * years;
  
  document.getElementById('juniorRatio').textContent = `${((1-juniorRatio)*100).toFixed(0)}% Senior / ${(juniorRatio*100).toFixed(0)}% Junior`;
  document.getElementById('juniorAPY').textContent = '+' + juniorAPY.toFixed(1) + '%';
  document.getElementById('insuranceFund').textContent = '$' + (insuranceAccumulated / 1000).toFixed(0) + 'k';
  
  const absLev = absMag;
  let requiredBuffer = 0.20;
  if (absLev > 1.5) requiredBuffer = 0.22;
  if (absLev > 2.0) requiredBuffer = 0.25;
  if (absLev > 2.5) requiredBuffer = 0.28;
  if (absLev > 3.0) requiredBuffer = 0.30;
  if (absLev > 3.5) requiredBuffer = 0.33;
  
  let dynamicMax = 3.5;
  if (juniorRatio < 0.40) dynamicMax = 3.0;
  if (juniorRatio < 0.30) dynamicMax = 2.0;
  if (juniorRatio < 0.20) dynamicMax = 1.5;
  
  const bufferHealthy = juniorRatio >= requiredBuffer;
  const bufferEl = document.getElementById('bufferHealth');
  
  if (absLev > dynamicMax) {
    bufferEl.textContent = '⚠ Exceeds Dynamic Cap (' + dynamicMax.toFixed(1) + '×)';
    bufferEl.className = 'row-value negative';
  } else if (bufferHealthy) {
    bufferEl.textContent = '✓ Healthy';
    bufferEl.className = 'row-value positive';
  } else {
    bufferEl.textContent = '⚠ Undercapitalized';
    bufferEl.className = 'row-value negative';
  }

  document.querySelectorAll('.notch-btn').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.lev) === currentLeverage));

  const riskPct = Math.min(100, (absMag / 3.5) * 100);
  const rf = document.getElementById('riskFill');
  rf.style.width = riskPct + '%';
  
  let riskLabel = 'No Exposure';
  if (absMag > 0 && absMag <= 1) {
    riskLabel = isShort ? 'Conservative Short' : 'Conservative';
    rf.style.background = 'var(--green)';
  } else if (absMag > 1 && absMag <= 2) {
    riskLabel = 'Moderate';
    rf.style.background = 'var(--yellow)';
  } else if (absMag > 2 && absMag <= 3) {
    riskLabel = 'Aggressive';
    rf.style.background = 'var(--red)';
  } else if (absMag > 3) {
    riskLabel = 'Maximum Risk';
    rf.style.background = 'var(--red)';
  }
  
  document.getElementById('riskText').textContent = riskLabel;
  document.getElementById('bufferReq').textContent = `Buffer: ${(requiredBuffer * 100).toFixed(0)}% junior ratio required`;
  
  if (levResult.stats) {
    const delevEl = document.getElementById('statDelevEvents');
    delevEl.textContent = levResult.stats.totalDeleverageEvents;
    if (levResult.liquidated) {
      delevEl.style.color = '#ff0000';
      delevEl.style.fontWeight = '900';
    } else {
      delevEl.style.color = '';
      delevEl.style.fontWeight = '';
    }
    
    const reducedEl = document.getElementById('statReducedDays');
    reducedEl.textContent = levResult.stats.timeAtReducedLeverage;
    if (levResult.liquidated) {
      reducedEl.textContent = '💀 LIQUIDATED';
      reducedEl.style.color = '#ff0000';
      reducedEl.style.fontWeight = '900';
    } else {
      reducedEl.style.color = '';
      reducedEl.style.fontWeight = '';
    }
  } else {
    document.getElementById('statDelevEvents').textContent = '0';
    document.getElementById('statReducedDays').textContent = '0';
  }
}

// ═══════════════════════════════════════════════════
// SLIDER
// ═══════════════════════════════════════════════════

const sliderTrack = document.getElementById('sliderTrack');
const sliderThumb = document.getElementById('sliderThumb');
const sliderFill = document.getElementById('sliderFill');
const mobileSliderTrack = document.getElementById('mobileSliderTrack');
const mobileSliderThumb = document.getElementById('mobileSliderThumb');
const mobileSliderFill = document.getElementById('mobileSliderFill');

function snapLeverage(raw) {
  if (isDegenMode) {
    return Math.round(raw);
  } else {
    // Snap to 0.1 increments for finer control
    return Math.round(raw * 10) / 10;
  }
}

function setSliderPos(lev) {
  const pct = (lev - MIN_LEV) / (MAX_LEV - MIN_LEV);
  const thumbPct = pct * 100;
  const centerPct = (0 - MIN_LEV) / (MAX_LEV - MIN_LEV) * 100;
  
  sliderThumb.style.left = thumbPct + '%';
  mobileSliderThumb.style.left = thumbPct + '%';
  
  let gradient;
  if (lev >= 0) {
    gradient = `linear-gradient(90deg,
      #555970 0%,
      #555970 ${centerPct}%,
      #00e676 ${centerPct}%,
      #7c4dff ${thumbPct}%,
      #555970 ${thumbPct}%,
      #555970 100%)`;
  } else {
    gradient = `linear-gradient(90deg,
      #555970 0%,
      #555970 ${thumbPct}%,
      #ff5252 ${thumbPct}%,
      #ff8a80 ${centerPct}%,
      #555970 ${centerPct}%,
      #555970 100%)`;
  }
  
  sliderFill.style.background = gradient;
  sliderFill.style.width = '100%';
  mobileSliderFill.style.background = gradient;
  mobileSliderFill.style.width = '100%';
  
  const displayLev = Math.abs(lev).toFixed(1);
  document.getElementById('mobileLevDisplay').textContent = (lev < 0 ? '-' : '') + displayLev + '×';
}

let isDragging = false;
let currentSlider = null;

function handleSliderStart(slider, clientX) {
  isDragging = true;
  currentSlider = slider;
  updateLeverageFromPosition(slider, clientX);
}

function updateLeverageFromPosition(slider, clientX) {
  const rect = slider.getBoundingClientRect();
  const x = clientX - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  const raw = MIN_LEV + pct * (MAX_LEV - MIN_LEV);
  currentLeverage = snapLeverage(raw);
  setSliderPos(currentLeverage);
  updateAll();
}

function handleSliderMove(e) {
  if (!isDragging || !currentSlider) return;
  e.preventDefault();
  const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
  updateLeverageFromPosition(currentSlider, clientX);
}

function handleSliderEnd() {
  isDragging = false;
  currentSlider = null;
}

// Desktop slider
sliderTrack.addEventListener('mousedown', (e) => {
  e.preventDefault();
  handleSliderStart(sliderTrack, e.clientX);
});

// Mobile slider
mobileSliderTrack.addEventListener('mousedown', (e) => {
  e.preventDefault();
  handleSliderStart(mobileSliderTrack, e.clientX);
});

sliderTrack.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleSliderStart(sliderTrack, e.touches[0].clientX);
}, { passive: false });

mobileSliderTrack.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleSliderStart(mobileSliderTrack, e.touches[0].clientX);
}, { passive: false });

// Global move handlers
document.addEventListener('mousemove', handleSliderMove);
document.addEventListener('touchmove', handleSliderMove, { passive: false });

// Global end handlers
document.addEventListener('mouseup', handleSliderEnd);
document.addEventListener('touchend', handleSliderEnd);

// Chart click handler for backtesting entry point selection
chart.subscribeClick((param) => {
  if (!param.time) return;
  
  const { data } = getFiltered(currentPeriod);
  const clickedIndex = data.findIndex(d => d.time === param.time);
  
  if (clickedIndex >= 0) {
    entryDateIndex = clickedIndex;
    console.log(`Entry date set to: ${data[clickedIndex].time} (index ${clickedIndex})`);
    updateAll();
  }
});

// Double-click to reset entry to start
chartEl.addEventListener('dblclick', () => {
  if (entryDateIndex !== 0) {
    entryDateIndex = 0;
    console.log('Entry date reset to start');
    updateAll();
  }
});

// Wallet connection event listeners
document.getElementById('connectWalletBtn').addEventListener('click', connectWallet);
document.getElementById('disconnectBtn').addEventListener('click', disconnectWallet);

document.querySelectorAll('.ticker-select-btn').forEach(b => b.addEventListener('click', async () => { 
  if (b.dataset.ticker === currentTicker) return;
  document.querySelectorAll('.ticker-select-btn').forEach(x => x.classList.remove('active')); 
  b.classList.add('active'); 
  currentTicker = b.dataset.ticker; 
  await loadTickerData(currentTicker); 
}));
document.querySelectorAll('.notch-btn').forEach(b => b.addEventListener('click', () => { currentLeverage = parseFloat(b.dataset.lev); setSliderPos(currentLeverage); updateAll(); }));
document.querySelectorAll('.tf-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.tf-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); currentPeriod = b.dataset.period; entryDateIndex = 0; updateAll(); }));
document.querySelectorAll('.chart-type-btn[data-type]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.chart-type-btn[data-type]').forEach(x => x.classList.remove('active')); b.classList.add('active'); currentChartType = b.dataset.type; updateAll(); }));

// Tranche Selector (Senior/Junior)
document.getElementById('seniorBtn').addEventListener('click', () => {
  document.getElementById('seniorView').style.display = 'grid';
  document.getElementById('juniorView').style.display = 'none';
  document.getElementById('seniorBtn').classList.add('active');
  document.getElementById('juniorBtn').classList.remove('active');
});

document.getElementById('juniorBtn').addEventListener('click', async () => {
  document.getElementById('seniorView').style.display = 'none';
  document.getElementById('juniorView').style.display = 'block';
  document.getElementById('seniorBtn').classList.remove('active');
  document.getElementById('juniorBtn').classList.add('active');
  
  // Refresh junior UI data
  if (connectedAddress && publicClient) {
    await updateJuniorUI();
  }
});

// Junior LP Tab Switching
const depositTab = document.getElementById('depositTab');
const withdrawTab = document.getElementById('withdrawTab');
const depositContent = document.getElementById('depositContent');
const withdrawContent = document.getElementById('withdrawContent');

if (depositTab && withdrawTab) {
  depositTab.addEventListener('click', () => {
    depositTab.classList.add('active');
    withdrawTab.classList.remove('active');
    depositContent.style.display = 'block';
    withdrawContent.style.display = 'none';
  });

  withdrawTab.addEventListener('click', () => {
    withdrawTab.classList.add('active');
    depositTab.classList.remove('active');
    withdrawContent.style.display = 'block';
    depositContent.style.display = 'none';
  });
}

// Junior LP Deposit/Withdraw Buttons
const depositBtn = document.getElementById('depositBtn');
const withdrawBtn = document.getElementById('withdrawBtn');

if (depositBtn) {
  depositBtn.addEventListener('click', depositJunior);
}

if (withdrawBtn) {
  withdrawBtn.addEventListener('click', withdrawJunior);
}

// How It Works Page Navigation
document.getElementById('howItWorksBtn').addEventListener('click', () => {
  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('howItWorksPage').style.display = 'block';
  window.scrollTo(0, 0);
});

document.getElementById('backToChart').addEventListener('click', () => {
  document.getElementById('howItWorksPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  window.scrollTo(0, 0);
});

document.getElementById('backToChartCTA').addEventListener('click', () => {
  document.getElementById('howItWorksPage').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  window.scrollTo(0, 0);
});

document.getElementById('degenModeBtn').addEventListener('click', () => {
  isDegenMode = !isDegenMode;
  document.body.classList.toggle('degen-mode', isDegenMode);
  
  const btn = document.getElementById('degenModeBtn');
  
  if (isDegenMode) {
    MIN_LEV = DEGEN_MIN;
    MAX_LEV = DEGEN_MAX;
    currentLeverage = Math.max(DEGEN_MIN, Math.min(DEGEN_MAX, currentLeverage * 10));
    updateDegenModeUI();
    btn.textContent = 'NORMAL MODE';
    btn.classList.add('normal-mode-active');
    console.log('🚀 DEGEN MODE ACTIVATED - 100x LEVERAGE UNLOCKED');
  } else {
    MIN_LEV = NORMAL_MIN;
    MAX_LEV = NORMAL_MAX;
    currentLeverage = Math.max(NORMAL_MIN, Math.min(NORMAL_MAX, currentLeverage / 10));
    updateNormalModeUI();
    btn.textContent = '🚀 DEGEN MODE';
    btn.classList.remove('normal-mode-active');
    console.log('✓ Normal mode restored');
  }
  
  setSliderPos(currentLeverage);
  updateAll();
});

function updateDegenModeUI() {
  const sliderLabels = document.querySelectorAll('.slider-labels');
  sliderLabels.forEach(label => {
    label.innerHTML = '<span>-100×</span><span>-50×</span><span>0</span><span>+50×</span><span>+100×</span>';
  });
  
  const notchContainer = document.querySelectorAll('.slider-notches');
  notchContainer.forEach(container => {
    container.innerHTML = `
      <button class="notch-btn" data-lev="-100">-100×</button>
      <button class="notch-btn" data-lev="-50">-50×</button>
      <button class="notch-btn" data-lev="-25">-25×</button>
      <button class="notch-btn" data-lev="-10">-10×</button>
      <button class="notch-btn" data-lev="0">0×</button>
      <button class="notch-btn" data-lev="10">+10×</button>
      <button class="notch-btn" data-lev="25">+25×</button>
      <button class="notch-btn" data-lev="50">+50×</button>
      <button class="notch-btn" data-lev="100">+100×</button>
    `;
    container.querySelectorAll('.notch-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        currentLeverage = parseFloat(b.dataset.lev);
        setSliderPos(currentLeverage);
        updateAll();
        console.log('Button clicked:', currentLeverage);
      });
    });
  });
}

function updateNormalModeUI() {
  const sliderLabels = document.querySelectorAll('.slider-labels');
  sliderLabels.forEach(label => {
    label.innerHTML = '<span>-4×</span><span>-2×</span><span>0</span><span>+2×</span><span>+4×</span>';
  });
  
  const notchContainer = document.querySelectorAll('.slider-notches');
  notchContainer.forEach(container => {
    container.innerHTML = `
      <button class="notch-btn" data-lev="-3.5">-3.5×</button>
      <button class="notch-btn" data-lev="-2.0">-2×</button>
      <button class="notch-btn" data-lev="-1.0">-1×</button>
      <button class="notch-btn" data-lev="0">0×</button>
      <button class="notch-btn" data-lev="1.0">+1×</button>
      <button class="notch-btn" data-lev="2.0">+2×</button>
      <button class="notch-btn" data-lev="3.5">+3.5×</button>
    `;
    container.querySelectorAll('.notch-btn').forEach(b => {
      b.addEventListener('click', () => {
        currentLeverage = parseFloat(b.dataset.lev);
        setSliderPos(currentLeverage);
        updateAll();
      });
    });
  });
}

new ResizeObserver(() => { 
  const r = chartEl.getBoundingClientRect(); 
  chart.applyOptions({ width: r.width, height: r.height }); 
}).observe(chartEl);
