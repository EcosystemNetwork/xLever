/**
 * xLever Trading Terminal
 * ──────────────────────────────────────────────────
 * Main application module for the xLever trading terminal (02-trading-terminal.html).
 *
 * Live mode:
 *  - Wallet connection via Reown AppKit (connect, disconnect, session restore)
 *  - On-chain balance reads (ETH, USDC, wQQQx, wSPYx) via viem
 *  - Position management via modular Vault contracts on Ink Sepolia
 *  - Real-time Pyth oracle price feeds
 *
 * Research mode:
 *  - Backtesting engine with historical OHLCV data
 *  - Multi-source data pipeline: OpenBB -> Yahoo Finance -> synthetic fallback
 *  - TradingView Lightweight Charts rendering (area, candlestick, line)
 *  - Portfolio stats: CAGR, Sharpe, max drawdown, vol
 *  - Comparison grid: fixed-entry vs daily-reset (TQQQ-style)
 *  - Custom bidirectional leverage slider
 *
 * Dependencies:
 *  - window.xLeverContracts (contracts.js) — vault reads/writes
 *  - window.xLeverWallet (wallet.js) — Reown AppKit modal instance
 *  - window.xLeverPyth (pyth.js) — oracle price feeds
 *  - window.viem — viem library loaded via CDN
 *  - window.liveState — live protocol state poller (live-state.js)
 *  - LightweightCharts — TradingView charting library loaded via CDN
 *
 * @module app
 */

/**
 * Sanitize a string for safe interpolation into innerHTML to prevent XSS.
 * Creates a temporary text node to leverage the browser's built-in escaping.
 *
 * @param {string} str — Untrusted string to escape
 * @returns {string} HTML-safe string with &, <, >, ", ' escaped
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════
// WALLET CONNECTION (Reown AppKit)
// Reown (formerly WalletConnect) provides wallet connectivity
// so users can view on-chain balances for LTAP vault tokens
// ═══════════════════════════════════════════════════════════

let connectedAddress = null; // Track wallet address globally so balance fetching and UI updates can reference it without re-querying the modal
let publicClient = null; // viem public client for Ink Sepolia RPC — kept global so we create it once on connect instead of per-call
let walletClient = null; // viem wallet client for write transactions — must be created on every connection path (MetaMask direct + Reown AppKit)

// Token addresses — single source of truth is contracts.js ADDRESSES
const TOKEN_ADDRESSES = window.xLeverContracts
  ? { USDC: window.xLeverContracts.ADDRESSES.usdc, wQQQx: window.xLeverContracts.ADDRESSES.wQQQx, wSPYx: window.xLeverContracts.ADDRESSES.wSPYx }
  : { USDC: '0x6b57475467cd854d36Be7FB614caDa5207838943', wQQQx: '0x267ED9BC43B16D832cB9Aaf0e3445f0cC9f536d9', wSPYx: '0x9eF9f9B22d3CA9769e28e769e2AAA3C2B0072D0e' };

// Vault contract addresses — sourced from config via contracts.js
const VAULT_ADDRESSES = window.xLeverContracts
  ? { wSPYx: window.xLeverContracts.ADDRESSES.spyVault, wQQQx: window.xLeverContracts.ADDRESSES.qqqVault }
  : { wSPYx: '0x94CaA35F38FD11AeBBB385E9f07520FAFaD7570F', wQQQx: '0xDEC80165b7F26e0EEA3c4fCF9a2B8E3D25a4f792' };

// ABIs — single source of truth is contracts.js, accessed via window.xLeverContracts
// Fallback inline ABIs only used if contracts.js hasn't loaded yet (shouldn't happen in normal flow)
const ERC20_ABI = window.xLeverContracts?.ERC20_ABI || [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }
];
const VAULT_ABI = window.xLeverContracts?.VAULT_ABI || [
  { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'leverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'positionValue', type: 'uint256' }] },
  { name: 'withdraw', type: 'function', stateMutability: 'payable', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'minReceived', type: 'uint256' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [{ name: 'received', type: 'uint256' }] },
  { name: 'adjustLeverage', type: 'function', stateMutability: 'payable', inputs: [{ name: 'newLeverageBps', type: 'int32' }, { name: 'priceUpdateData', type: 'bytes[]' }], outputs: [] },
  { name: 'depositJunior', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { name: 'withdrawJunior', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'amount', type: 'uint256' }] },
  { name: 'getPosition', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'depositAmount', type: 'uint128' }, { name: 'leverageBps', type: 'int32' }, { name: 'entryTWAP', type: 'uint128' }, { name: 'lastFeeTimestamp', type: 'uint64' }, { name: 'settledFees', type: 'uint128' }, { name: 'leverageLockExpiry', type: 'uint32' }, { name: 'isActive', type: 'bool' }] }] },
  { name: 'getPoolState', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'tuple', components: [{ name: 'totalSeniorDeposits', type: 'uint128' }, { name: 'totalJuniorDeposits', type: 'uint128' }, { name: 'insuranceFund', type: 'uint128' }, { name: 'netExposure', type: 'int256' }, { name: 'grossLongExposure', type: 'uint128' }, { name: 'grossShortExposure', type: 'uint128' }, { name: 'lastRebalanceTime', type: 'uint64' }, { name: 'currentMaxLeverageBps', type: 'uint32' }, { name: 'fundingRateBps', type: 'int64' }, { name: 'protocolState', type: 'uint8' }] }] },
  { name: 'juniorTranche', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];
const JUNIOR_TRANCHE_ABI = window.xLeverContracts?.JUNIOR_TRANCHE_ABI || [
  { name: 'getShares', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getUserValue', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getSharePrice', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'price', type: 'uint256' }] },
  { name: 'getTotalValue', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'value', type: 'uint256' }] },
  { name: 'totalShares', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

/**
 * Fetch and display on-chain token balances for the connected wallet.
 * Reads ETH (native), USDC, wQQQx, and wSPYx balances from Ink Sepolia
 * and updates the corresponding DOM elements.
 *
 * @returns {Promise<void>}
 */
async function fetchBalances() {
  if (!connectedAddress || !publicClient) return; // Guard: no wallet connected means nothing to query — avoids RPC errors

  try {
    const { formatEther, formatUnits } = window.viem; // viem formatting utils convert raw BigInt wei values to human-readable strings

    // ETH balance — needed so users know if they have gas to execute vault transactions on Ink Sepolia
    const ethBalance = await publicClient.getBalance({
      address: connectedAddress // Native balance query doesn't need a contract call
    });
    document.getElementById('ethBalance').textContent = parseFloat(formatEther(ethBalance)).toFixed(4); // 4 decimals sufficient for gas display

    // USDC balance — shows how much collateral the user can deposit into the senior tranche
    const usdcBalance = await publicClient.readContract({
      address: TOKEN_ADDRESSES.USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [connectedAddress] // Pass connected wallet as the account to query
    });
    document.getElementById('usdcBalance').textContent = parseFloat(formatUnits(usdcBalance, 6)).toFixed(2); // USDC has 6 decimals, show 2 for dollar precision

    // Update junior view USDC balance
    const usdcBalanceJunior = document.getElementById('usdcBalanceJunior');
    if (usdcBalanceJunior) {
      usdcBalanceJunior.textContent = parseFloat(formatUnits(usdcBalance, 6)).toFixed(2);
    }

    // wQQQx balance — shows user's leveraged QQQ exposure token holdings from the LTAP vault
    const wqqqxBalance = await publicClient.readContract({
      address: TOKEN_ADDRESSES.wQQQx,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [connectedAddress] // Same wallet address for all token queries
    });
    document.getElementById('wqqqxBalance').textContent = parseFloat(formatUnits(wqqqxBalance, 18)).toFixed(4); // 18 decimals (ERC-20 standard), 4dp for readability

    // wSPYx balance — shows user's leveraged SPY exposure token holdings
    const wspyxBalance = await publicClient.readContract({
      address: TOKEN_ADDRESSES.wSPYx,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [connectedAddress] // Same pattern — consistent across all wrapped tokens
    });
    document.getElementById('wspyxBalance').textContent = parseFloat(formatUnits(wspyxBalance, 18)).toFixed(4); // Same 18-decimal format as wQQQx

  } catch (error) {

  }
}

/**
 * Fetch a user's junior tranche position from a specific vault.
 * Reads shares, value, share price, and total tranche value via the JuniorTranche contract.
 *
 * @param {string} vaultAddress — Vault contract address to query
 * @returns {Promise<{shares: number, userValue: number, sharePrice: number, totalValue: number}|null>}
 *   Junior position data in USDC terms (6 decimal precision), or null if tranche unavailable
 */
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

    return null;
  }
}

/**
 * Update the junior tranche UI panel with current position data from both vaults.
 * Fetches junior positions for wQQQx and wSPYx, sums them, and renders
 * total position value, TVL, and pool utilization.
 *
 * @returns {Promise<void>}
 */
async function updateJuniorUI() {
  if (!connectedAddress || !publicClient) return;

  try {
    // Fetch positions for both vaults
    const wqqqxPosition = await fetchJuniorPosition(VAULT_ADDRESSES.wQQQx);
    const wspyxPosition = await fetchJuniorPosition(VAULT_ADDRESSES.wSPYx);

    // Check if junior tranche is available
    if (!wqqqxPosition && !wspyxPosition) {
      // No junior tranche support - show message
      document.getElementById('yourJuniorPosition').textContent = 'Not Available';
      document.getElementById('juniorTVL').textContent = 'Not Available';
      document.getElementById('juniorPositionWithdraw').textContent = 'Not Available';
      document.getElementById('poolUtilization').textContent = 'N/A';

      return;
    }

    // Calculate total position value
    const totalPosition = (wqqqxPosition?.userValue || 0) + (wspyxPosition?.userValue || 0);
    const totalTVL = (wqqqxPosition?.totalValue || 0) + (wspyxPosition?.totalValue || 0);

    // Update UI elements
    document.getElementById('yourJuniorPosition').textContent = `$${totalPosition.toFixed(2)}`;
    document.getElementById('juniorTVL').textContent = `$${totalTVL.toFixed(2)}`;
    document.getElementById('juniorPositionWithdraw').textContent = `$${totalPosition.toFixed(2)}`;

    // Calculate pool utilization - get actual senior deposits
    let utilization = 0;
    try {
      const poolState = await publicClient.readContract({
        address: VAULT_ADDRESSES.wQQQx,
        abi: VAULT_ABI,
        functionName: 'getPoolState'
      });
      const seniorDeposits = parseFloat(poolState.totalSeniorDeposits || 0) / 1e6;
      const totalPool = totalTVL + seniorDeposits;
      utilization = totalPool > 0 ? Math.round((seniorDeposits / totalPool) * 100) : 0;
    } catch (e) {
      utilization = 0;
    }
    document.getElementById('poolUtilization').textContent = `${utilization}%`;


  } catch (error) {

  }
}

/**
 * Execute a junior tranche deposit. Reads the amount from the deposit input,
 * approves USDC spending, then calls depositJunior on the vault contract.
 * Refreshes balances and UI on success.
 *
 * @returns {Promise<void>}
 */
async function depositJunior() {
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
      alert('Junior tranche deposits are not enabled on the current vaults.');
      return;
    }

    // First approve USDC

    const approveTx = await walletClient.writeContract({
      address: TOKEN_ADDRESSES.USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, amount],
      account: connectedAddress,
      chain: publicClient.chain
    });


    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Then deposit

    const depositTx = await walletClient.writeContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'depositJunior',
      args: [amount],
      account: connectedAddress,
      chain: publicClient.chain
    });


    await publicClient.waitForTransactionReceipt({ hash: depositTx });

    alert('✓ Junior deposit successful!');
    
    // Refresh balances and UI
    await fetchBalances();
    await updateJuniorUI();
    
    // Clear input
    document.getElementById('depositAmount').value = '';
  } catch (error) {

    alert('Deposit failed: ' + (error.message || 'Unknown error'));
  }
}

/**
 * Execute a junior tranche withdrawal. Reads the amount from the withdraw input,
 * calculates the corresponding shares to redeem based on current share price,
 * then calls withdrawJunior on the vault contract.
 *
 * @returns {Promise<void>}
 */
async function withdrawJunior() {
  if (!walletClient || !connectedAddress) {
    alert('Please connect your wallet first');
    return;
  }

  const withdrawAmount = document.getElementById('withdrawAmount').value;
  if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
    alert('Please enter a valid withdrawal amount');
    return;
  }

  try {
    const { parseUnits } = window.viem;
    const vaultAddress = VAULT_ADDRESSES.wQQQx;

    // Check if vault supports junior tranche (reuse result as the address)
    const juniorTrancheAddress = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'juniorTranche'
    }).catch(() => null);

    if (!juniorTrancheAddress) {
      alert('Junior tranche withdrawals are not enabled on the current vaults.');
      return;
    }

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
      chain: publicClient.chain
    });

    console.log('Waiting for withdrawal confirmation...');
    await publicClient.waitForTransactionReceipt({ hash: withdrawTx });

    alert('✓ Junior withdrawal successful!');
    
    // Refresh balances and UI
    await fetchBalances();
    await updateJuniorUI();
    
    // Clear input
    document.getElementById('withdrawAmount').value = '';
  } catch (error) {
    console.error('Junior withdrawal failed:', error);
    alert('Withdrawal failed: ' + (error.message || 'Unknown error'));
  }
}

/**
 * Request the user's wallet to switch to Ink Sepolia (chain ID 763373).
 * If the network is not yet added to the wallet, adds it first via wallet_addEthereumChain.
 *
 * @returns {Promise<boolean>} True if switch succeeded, false if user rejected or error occurred
 */
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
            rpcUrls: [window.viem?.inkSepolia?.rpcUrls?.default?.http?.[0] || 'https://rpc-gel-sepolia.inkonchain.com'],
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

/**
 * Connect a Web3 wallet via window.ethereum (MetaMask/injected provider).
 * Requests accounts, ensures Ink Sepolia chain, creates viem clients,
 * and updates the wallet UI. Falls back to Reown AppKit if no injected provider.
 *
 * @returns {Promise<void>}
 */
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

    // Check current network — accept both supported chains
    const SUPPORTED_CHAINS = { 763373: 'Ink Sepolia', 11155111: 'Ethereum Sepolia' };
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainId, 16);

    if (!SUPPORTED_CHAINS[currentChainId]) {
      console.log(`Current network: ${currentChainId}, switching to Ink Sepolia (763373)...`);
      const switched = await switchToInkSepolia();

      if (!switched) {
        showToast('Please switch to Ink Sepolia or Ethereum Sepolia in your wallet.', 'warning', 6000);
        return;
      }
    } else {
      console.log(`✓ Already on ${SUPPORTED_CHAINS[currentChainId]}`);
    }

    // Resolve chain config for whichever supported chain the wallet is on
    const resolvedChainId = SUPPORTED_CHAINS[currentChainId] ? currentChainId : 763373;
    const { createWalletClient, createPublicClient, custom, http, inkSepolia, ethSepolia } = window.viem;
    const activeChain = resolvedChainId === 11155111 ? ethSepolia : inkSepolia;

    walletClient = createWalletClient({
      chain: activeChain,
      transport: custom(window.ethereum)
    });

    publicClient = createPublicClient({
      chain: activeChain,
      transport: http(activeChain.rpcUrls.default.http[0])
    });

    connectedAddress = accounts[0];

    updateWalletUI();
    await fetchBalances();
    await updateJuniorUI();

    localStorage.setItem('walletConnected', 'true');
    console.log('✓ Wallet connected:', connectedAddress);
    window.dispatchEvent(new CustomEvent('appkit:connected'));
    
  } catch (error) {
    console.error('Failed to connect wallet:', error);
    showToast('Failed to connect wallet. Please try again.', 'error');
  }
}

/**
 * Disconnect the wallet, clear state, and update UI.
 * Removes the persistent session flag from localStorage.
 */
function disconnectWallet() {
  walletClient = null;
  connectedAddress = null;
  localStorage.removeItem('walletConnected');
  updateWalletUI();
  console.log('✓ Wallet disconnected');
}

/**
 * Update wallet-related DOM elements based on connection state.
 * Shows/hides the balance panel and displays the truncated address when connected.
 */
function updateWalletUI() {
  const walletInfo = document.getElementById('walletInfo'); // Container for the wallet balance panel — toggled visible/hidden on connect/disconnect
  const walletAddress = document.getElementById('walletAddress'); // Displays truncated address so user confirms which wallet is active

  if (connectedAddress) {
    walletInfo.style.display = 'flex'; // Show the balance panel only when a wallet is connected — keeps UI clean for visitors
    walletAddress.textContent = `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`; // Truncate to 0x1234...5678 because full 42-char address is too long for the header
  } else {
    walletInfo.style.display = 'none'; // Hide wallet panel when disconnected — no balances to show
    // Reset balance displays to dash so stale numbers from previous session don't persist
    ['ethBalance', 'usdcBalance', 'wqqqxBalance', 'wspyxBalance'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '-'; // Dash signals "not loaded" vs "0" which would mean empty wallet
    });
  }
}

// Wire up Reown AppKit wallet events — Reown emits lifecycle events for connect/disconnect
// so we react to wallet state changes without polling
/**
 * Initialize Reown AppKit wallet event listeners.
 * Subscribes to CONNECT_SUCCESS and DISCONNECT_SUCCESS events, wires up
 * connect/disconnect buttons, and handles session restoration on page reload.
 * Retries every 200ms if the Reown modal is not yet available.
 */
function initWalletListeners() {
  const modal = window.xLeverWallet; // Reown modal instance set up in wallet.js — may not be ready yet on first call
  if (!modal) return setTimeout(initWalletListeners, 200); // Retry every 200ms because Reown SDK loads asynchronously and may initialize after app.js runs

  // Wire the landing-page "Connect Wallet" button to open the Reown modal
  const connectBtn = document.getElementById('connectWalletBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => modal.open());
  }
  // Wire the disconnect button to close the Reown session
  const disconnectBtn = document.getElementById('disconnectBtn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      modal.disconnect();
      disconnectWallet();
    });
  }

  // Track whether the initial session restore has completed so we only toast on user-initiated connects
  let hasRestoredSession = false;
  let connectHandled = false;

  modal.subscribeEvents(async (event) => {
    if (event?.data?.event === 'CONNECT_SUCCESS') {
      connectedAddress = modal.getAddress();
      const { createWalletClient, createPublicClient, custom, http, inkSepolia, ethSepolia } = window.viem;
      // Resolve the chain the wallet is actually on
      const walletChainHex = window.ethereum ? await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null) : null;
      const walletChainId = walletChainHex ? parseInt(walletChainHex, 16) : 763373;
      const connChain = walletChainId === 11155111 ? ethSepolia : inkSepolia;
      publicClient = createPublicClient({
        chain: connChain,
        transport: http(connChain.rpcUrls.default.http[0])
      });
      // Create wallet client for write transactions (junior tranche deposits/withdrawals)
      if (window.ethereum) {
        walletClient = createWalletClient({
          chain: connChain,
          transport: custom(window.ethereum)
        });
      }
      // Close the Reown modal immediately so the spinner doesn't linger after connection
      modal.close();

      updateWalletUI();
      await fetchBalances();

      // Only show toast for user-initiated connections, not session restores
      if (hasRestoredSession && !connectHandled) {
        connectHandled = true;
        if (typeof XToast !== 'undefined') XToast.show('Wallet connected successfully', 'success');
        // Reset after a short delay so future manual connects still show the toast
        setTimeout(() => { connectHandled = false; }, 5000);
      }

      window.dispatchEvent(new CustomEvent('appkit:connected'));

      // Redirect to dashboard after fresh wallet connection from the landing page
      if (document.getElementById('landingPage')) {
        window.location.href = '01-dashboard.html';
        return;
      }
    }
    if (event?.data?.event === 'DISCONNECT_SUCCESS') {
      connectedAddress = null;
      publicClient = null;
      walletClient = null;
      updateWalletUI();
      if (typeof XToast !== 'undefined') XToast.show('Wallet disconnected', 'info');
    }
  });

  // Mark session restore as complete after Reown has had time to restore from localStorage
  setTimeout(() => { hasRestoredSession = true; }, 3000);

  // Check if already connected (e.g. page reload with active session) — Reown persists sessions in localStorage
  // so the user shouldn't have to reconnect after every page refresh
  try {
    const isConnected = typeof modal.getIsConnectedState === 'function'
      ? modal.getIsConnectedState()        // Reown AppKit v1.8+ API
      : modal.getIsConnected?.();          // Fallback for older Reown versions
    if (isConnected) {
      connectedAddress = typeof modal.getAddress === 'function'
        ? modal.getAddress()               // Standard Reown v3 getter
        : modal.getAddress?.();            // Defensive fallback — same reason as above
      const { createWalletClient: cwc, createPublicClient, custom: cst, http, inkSepolia: inkS, ethSepolia: ethS } = window.viem;
      // Resolve the chain the wallet is actually on for session restore
      const restoreChainHex = window.ethereum ? await window.ethereum.request({ method: 'eth_chainId' }).catch(() => null) : null;
      const restoreChainId = restoreChainHex ? parseInt(restoreChainHex, 16) : 763373;
      const restoreChain = restoreChainId === 11155111 ? ethS : inkS;
      publicClient = createPublicClient({
        chain: restoreChain,
        transport: http(restoreChain.rpcUrls.default.http[0])
      });
      // Restore wallet client for write transactions on session resume
      if (window.ethereum) {
        walletClient = cwc({ chain: restoreChain, transport: cst(window.ethereum) });
      }
      updateWalletUI(); // Show wallet panel immediately on page load if session persists
      fetchBalances(); // Fire-and-forget (no await) because we don't need to block page rendering for balances
      window.dispatchEvent(new CustomEvent('appkit:connected'));

      // Skip landing page — user already has an active wallet session, go straight to dashboard
      if (document.getElementById('landingPage')) {
        window.location.href = '01-dashboard.html';
        return;
      }
    }
  } catch (e) {
    console.warn('Wallet reconnect check skipped:', e.message); // Non-fatal: user can manually reconnect via the AppKit button
  }
}
initWalletListeners(); // Start the initialization loop — will retry until Reown modal is available

// ═══════════════════════════════════════════════════════════
// EVENT-BASED BALANCE & POSITION RELOAD
// Subscribes to txEvents from contracts.js so balances update
// only from confirmed chain state — no setTimeout polling.
// ═══════════════════════════════════════════════════════════

/**
 * Subscribe to transaction lifecycle events from contracts.js.
 * On 'confirmed', automatically reloads wallet balances from chain state
 * so the UI reflects the latest on-chain data without polling.
 * Retries every 300ms if contracts module is not yet available.
 */
function initTxEventListeners() {
  const contracts = window.xLeverContracts;
  if (!contracts?.txEvents) return setTimeout(initTxEventListeners, 300);

  contracts.txEvents.on('confirmed', () => {
    // Reload balances from confirmed chain state
    if (connectedAddress && publicClient) fetchBalances();
  });
}
initTxEventListeners();

// ═══════════════════════════════════════════════════════════
// DATA LAYER
// Synthetic data generator serves as offline fallback when
// both OpenBB and Yahoo Finance APIs are unreachable.
// In production, fetchRealData provides real OHLCV history.
// ═══════════════════════════════════════════════════════════

let _seed = 42; // Fixed seed so synthetic data is deterministic — same backtest input every run for reproducible testing
/** @returns {number} Pseudo-random number in (0, 1) using Park-Miller LCG PRNG — deterministic, no Math.random() */
function srand() { _seed = (_seed * 16807) % 2147483647; return _seed / 2147483647; }
/** @returns {number} Normally distributed random number (mean=0, stddev=1) via Box-Muller transform */
function boxMuller() { return Math.sqrt(-2 * Math.log(srand())) * Math.cos(2 * Math.PI * srand()); }

/**
 * Generate synthetic QQQ-like OHLCV data using geometric Brownian motion.
 * Used as a fallback when both OpenBB and Yahoo Finance APIs are unreachable.
 * Parameters calibrated to historical QQQ characteristics (~13% annual return, ~22% annual vol).
 *
 * @param {number} years — Number of years of history to generate
 * @returns {Array<{time: string, open: number, high: number, low: number, close: number}>} Synthetic OHLCV array
 */
function generateQQQData(years) { // Fallback synthetic data generator — produces QQQ-like price history when real data APIs fail
  const days = Math.floor(years * 252); // 252 trading days per year (US equity market convention) — excludes weekends/holidays
  const mu = 0.13 / 252, sigma = 0.22 / Math.sqrt(252); // QQQ historical: ~13% annual return, ~22% annual vol — scaled to daily for GBM simulation
  const ohlcv = []; // Accumulate OHLCV bars to match the same format real data returns
  let price = 100, vol = 1.0; // Start at $100 for easy percentage math; vol=1.0 is baseline volatility multiplier
  const d = new Date(); d.setFullYear(d.getFullYear() - years); // Walk dates backward from today so synthetic data aligns with real calendar

  for (let i = 0; i < days; i++) {
    d.setDate(d.getDate() + 1); // Advance one calendar day
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); // Skip weekends — markets don't trade Saturday/Sunday
    if (srand() < 0.003) vol = 1.6 + srand(); else if (vol > 1.0) vol *= 0.975; // 0.3% daily chance of a vol spike (simulates VIX events); otherwise vol mean-reverts by 2.5%/day back to baseline
    const ret = mu + sigma * vol * boxMuller(); // Daily return via geometric Brownian motion: drift + scaled normal shock
    const open = price, close = price * (1 + ret); // Open at previous close; close reflects the day's return
    const high = Math.max(open, close) * (1 + Math.abs(boxMuller()) * 0.005); // High is slightly above max(open,close) — typical intraday range extension
    const low = Math.min(open, close) * (1 - Math.abs(boxMuller()) * 0.005); // Low is slightly below min(open,close) — same logic for downside wicks
    ohlcv.push({ time: d.toISOString().split('T')[0], open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close: +close.toFixed(4) }); // ISO date string for TradingView compatibility; toFixed(4) prevents floating point noise
    price = close; // Carry forward the close as the next day's starting price
  }
  return ohlcv; // Return array of OHLCV objects matching the same schema as fetchFromOpenBB/fetchFromYahoo
}

// ──────────────────────────────────────────────────
// REAL DATA FETCHING (OpenBB-first, Yahoo fallback)
// Two-tier data sourcing ensures maximum uptime:
// OpenBB provides higher-quality analytics data,
// Yahoo Finance is the widely-available fallback.
// ──────────────────────────────────────────────────

let allData = []; // Master OHLCV array for the current ticker — holds up to 25 years of daily bars for all timeframe slicing
let dataLoading = true; // Loading flag prevents premature chart rendering before data arrives
let currentTicker = 'QQQ'; // Default to QQQ because it's the primary LTAP product (Nasdaq-100 leveraged exposure)
let currentLeverage = 2.0, currentPeriod = '1Y', currentChartType = 'area'; // Defaults: 2x long, 1-year view, area chart — the most common user starting point
let entryDateIndex = 0; // Index into the filtered data array where the backtest starts — 0 means "from period start", click-to-set changes this
let isDegenMode = false; // Degen mode flag — toggles between normal (±3.5x) and degen (±100x) leverage ranges
let MIN_LEV = -3.5, MAX_LEV = 3.5; // Leverage bounds — mutable to support degen mode switching
const NORMAL_MIN = -3.5, NORMAL_MAX = 3.5; // Normal mode leverage limits — matches deployed vault's maximum supported leverage
const DEGEN_MIN = -100.0, DEGEN_MAX = 100.0; // Degen mode leverage limits — for education/entertainment only

/**
 * Fetch historical OHLCV data from OpenBB via the local API proxy.
 * Primary data source — provides institutional-grade, pre-cleaned data.
 *
 * @param {string} symbol — Ticker symbol (e.g., 'QQQ', 'AAPL')
 * @param {number} years — Number of years of history to fetch
 * @returns {Promise<Array<{time: string, open: number, high: number, low: number, close: number}>>} OHLCV array
 * @throws {Error} If OpenBB returns HTTP error or empty data
 */
async function fetchFromOpenBB(symbol, years) { // Primary data source — OpenBB provides institutional-grade OHLCV data via our local proxy server
  const end = new Date(); // End date is always today — we want the most recent available data
  const start = new Date();
  start.setFullYear(start.getFullYear() - years); // Go back N years from today to cover the requested timeframe
  const startDate = start.toISOString().split('T')[0]; // ISO date string format (YYYY-MM-DD) that OpenBB API expects
  const endDate = end.toISOString().split('T')[0]; // Same format for the end date parameter

  const url = `/api/openbb/historical/${symbol}?start_date=${startDate}&end_date=${endDate}&interval=1d`; // Proxied through our Express server to avoid CORS issues and keep API keys server-side
  const resp = await fetch(url); // Fetch from local proxy — if OpenBB is down this throws and triggers Yahoo fallback
  if (!resp.ok) throw new Error(`OpenBB HTTP ${resp.status}: ${resp.statusText}`); // Throw on HTTP errors so the caller's catch block can fall back to Yahoo

  const json = await resp.json(); // Parse the JSON response from our proxy
  if (!json.data || json.data.length === 0) throw new Error('OpenBB returned no data'); // Empty data is useless — treat it as a failure so we try Yahoo instead

  return json.data.map(d => ({
    time: (d.date || d.Date || '').split('T')[0], // OpenBB sometimes uses 'date' vs 'Date' depending on provider — handle both; strip time portion for TradingView
    open:  +(d.open  ?? d.Open  ?? d.close ?? 0).toFixed(4), // Fallback chain: try lowercase, then uppercase, then use close if OHLC is missing — some providers omit open/high/low
    high:  +(d.high  ?? d.High  ?? d.close ?? 0).toFixed(4), // Same fallback pattern — ensures we always have a number, never undefined
    low:   +(d.low   ?? d.Low   ?? d.close ?? 0).toFixed(4), // Same fallback pattern for low price
    close: +(d.close ?? d.Close ?? 0).toFixed(4), // Close is the most critical — used for all return calculations in the LTAP engine
  })).filter(d => d.time && d.close > 0); // Filter out any malformed rows — missing dates or zero/negative closes would corrupt simulations
}

/**
 * Fetch historical OHLCV data from Yahoo Finance via the FastAPI proxy.
 * Fallback data source — used when OpenBB is unavailable.
 *
 * @param {string} symbol — Ticker symbol (e.g., 'QQQ', 'AAPL')
 * @param {number} years — Number of years of history to fetch (use 20+ for 'max')
 * @returns {Promise<Array<{time: string, open: number, high: number, low: number, close: number}>>} OHLCV array
 * @throws {Error} If Yahoo returns HTTP error or invalid response structure
 */
async function fetchFromYahoo(symbol, years) { // Fallback data source — Yahoo Finance via FastAPI /api/prices proxy with DB caching
  const period = years >= 20 ? 'max' : `${years}y`; // Map years to Yahoo's period format — 'max' for full history, otherwise Ny
  const url = `/api/prices/${symbol}?period=${period}&interval=1d`; // FastAPI prices endpoint proxies Yahoo with server-side DB cache

  const resp = await fetch(url); // Fetch from our FastAPI prices proxy — works in both dev (Vite proxy) and production
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`); // Surface HTTP errors clearly for debugging

  const json = await resp.json(); // FastAPI wraps Yahoo response in PriceResponse {symbol, interval, period, data, cached}
  const data = json.data; // Unwrap the raw Yahoo chart JSON from the PriceResponse wrapper
  if (!data.chart || !data.chart.result || !data.chart.result[0]) {
    throw new Error('Invalid response from Yahoo Finance API'); // Yahoo sometimes returns empty results for delisted tickers or during outages
  }

  const result = data.chart.result[0]; // Yahoo wraps data in chart.result array — always use first element for single-symbol queries
  const timestamps = result.timestamp; // Array of Unix timestamps corresponding to each trading day
  const quotes = result.indicators.quote[0]; // OHLCV arrays are nested under indicators.quote — Yahoo's non-obvious data structure

  const ohlcv = []; // Build the same OHLCV format that OpenBB returns so the rest of the app doesn't care which source was used
  for (let i = 0; i < timestamps.length; i++) {
    if (quotes.close[i] === null) continue; // Skip days with null close — Yahoo inserts nulls for market holidays that fall on weekdays
    const date = new Date(timestamps[i] * 1000); // Convert Unix seconds to JS Date for ISO string formatting
    ohlcv.push({
      time: date.toISOString().split('T')[0], // Strip time portion — TradingView Lightweight Charts expects YYYY-MM-DD for daily bars
      open: +(quotes.open[i] || quotes.close[i]).toFixed(4), // Use close as fallback if open is null — rare but happens on some data gaps
      high: +(quotes.high[i] || quotes.close[i]).toFixed(4), // Same fallback for high — ensures no NaN values in chart rendering
      low: +(quotes.low[i] || quotes.close[i]).toFixed(4), // Same fallback for low
      close: +quotes.close[i].toFixed(4) // Close is always present (we filtered nulls above); toFixed(4) then + to clean float precision
    });
  }
  return ohlcv; // Return normalized OHLCV array matching the OpenBB output format
}

/**
 * Orchestrator: fetch historical OHLCV data from the best available source.
 * Tries OpenBB first (higher quality), falls back to Yahoo Finance.
 *
 * @param {string} symbol — Ticker symbol
 * @param {number} years — Number of years of history
 * @returns {Promise<Array<{time: string, open: number, high: number, low: number, close: number}>>} OHLCV array
 * @throws {Error} If both OpenBB and Yahoo fail — caller should use generateQQQData() as final fallback
 */
async function fetchRealData(symbol, years) { // Fetch OHLCV data from Yahoo Finance via FastAPI proxy
  try {
    return await fetchFromYahoo(symbol, years);
  } catch (error) {
    console.error('Error fetching real data:', error);
    throw error; // Re-throw so loadTickerData's catch block can activate the synthetic fallback
  }
}

/**
 * Main data loading pipeline for a ticker symbol. Implements a three-tier
 * fallback strategy: localStorage cache (24h TTL) -> real API data (OpenBB/Yahoo) ->
 * synthetic data generation. Resets the entry point and re-renders on completion.
 *
 * @param {string} ticker — Ticker symbol to load (e.g., 'QQQ', 'SPY', 'AAPL')
 * @returns {Promise<void>}
 */
async function loadTickerData(ticker) { // Main data loading pipeline: cache-first, then API, then synthetic fallback
  try {
    dataLoading = true; // Signal to UI that data is being fetched — prevents rendering stale charts during transition

    const cacheKey = `${ticker.toLowerCase()}_data_cache`; // Per-ticker cache key so switching QQQ<->SPY doesn't overwrite each other
    const cacheTimeKey = `${ticker.toLowerCase()}_data_cache_time`; // Separate timestamp key to track cache freshness independently
    const cached = localStorage.getItem(cacheKey); // Check if we have cached OHLCV data from a previous session
    const cacheTime = localStorage.getItem(cacheTimeKey); // When the cache was last written — used for staleness check
    const now = Date.now(); // Current time for cache age comparison
    const cacheMaxAge = 24 * 60 * 60 * 1000; // 24-hour cache TTL — daily OHLCV data only changes once per trading day, so 24h is optimal

    let cacheValid = false;
    if (cached && cacheTime && (now - parseInt(cacheTime)) < cacheMaxAge) { // Use cache if it exists and is less than 24 hours old
      try {
        const parsed = JSON.parse(cached); // Deserialize the cached OHLCV array — avoids a network round-trip on page reload
        if (Array.isArray(parsed) && parsed.length > 0) {
          allData = parsed;
          dataLoading = false; // Data is ready for rendering
          cacheValid = true;
        }
      } catch (e) {
        console.warn('Corrupt cache for', ticker, '— fetching fresh data'); // Malformed JSON in localStorage — clear it and refetch
        localStorage.removeItem(cacheKey);
        localStorage.removeItem(cacheTimeKey);
      }
    }
    if (!cacheValid) { // Cache is missing, stale, or corrupt — fetch fresh data from APIs
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          allData = await fetchRealData(ticker, 25); // Fetch 25 years of history — the maximum timeframe our UI supports ("25Y" and "MAX" buttons)
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Backoff: 1s, 2s
        }
      }
      if (lastError) throw lastError;
      dataLoading = false; // Data arrived successfully

      try {
        localStorage.setItem(cacheKey, JSON.stringify(allData)); // Persist to localStorage so subsequent page loads are instant
        localStorage.setItem(cacheTimeKey, now.toString()); // Record cache time for the 24-hour staleness check
      } catch (e) {
        console.warn('Failed to cache data:', e); // localStorage might be full (5MB limit) or disabled — data still works, just won't cache
      }
    }

    entryDateIndex = 0; // Reset backtest entry point when switching tickers — previous entry index is meaningless for a different dataset
    updateAll(); // Re-render the chart and stats with the new ticker data
  } catch (error) {
    console.error('Failed to load data, using generated data:', error); // Both OpenBB and Yahoo failed — degrade gracefully to synthetic data
    allData = generateQQQData(25); // Generate 25 years of synthetic QQQ-like data as final fallback so the UI still works offline
    dataLoading = false; // Even synthetic data counts as "loaded"
    entryDateIndex = 0; // Reset entry point for consistency
    updateAll(); // Render with synthetic data — user sees a working chart rather than a blank screen
    console.warn('Using generated fallback data for', ticker);
  }
}

document.addEventListener('DOMContentLoaded', async function() { // Wait for DOM to be fully parsed before initializing — ensures all chart containers and UI elements exist
  await loadTickerData(currentTicker); // Load data first (blocking) because chart rendering depends on having OHLCV data
  setSliderPos(currentLeverage); // Initialize slider position to match the default 2x leverage — must run after DOM is ready so slider elements exist
});

// ═══════════════════════════════════════════════════
// LEVERAGE ENGINE - LTAP Protocol (Constant from Entry)
// Unlike daily-reset products (TQQQ/SQQQ), LTAP uses
// "constant leverage from entry" — no daily rebalancing,
// which eliminates volatility decay but requires active
// risk management via auto-deleverage and circuit breakers.
// ═══════════════════════════════════════════════════

/**
 * Calculate the annual LTAP protocol fee for a given leverage level.
 * Fee scales linearly with leverage: base 0.5% + 0.5% per unit above 1x.
 * No fee for cash (0x) or unleveraged (1x) positions.
 *
 * @param {number} leverage — Absolute leverage multiplier (e.g., 2.0, 3.5)
 * @returns {number} Annual fee as a decimal (e.g., 0.01 = 1% APR)
 */
function getLTAPFee(leverage) { // Annual fee calculation — scales with leverage to compensate liquidity providers for the risk they absorb
  if (leverage === 0 || Math.abs(leverage) === 1.0) return 0; // No fee for cash (0x) or unleveraged (1x) positions — no borrowing cost to pass through
  return 0.005 + 0.005 * Math.abs(leverage - 1); // Base 0.5% + 0.5% per unit of leverage above 1x — e.g., 2x = 1.0% APR, 3x = 1.5% APR, 4x = 2.0% APR
}



/**
 * Map underlying asset drawdown to an auto-deleverage severity level (0-5).
 * Each level corresponds to a progressively more aggressive risk response.
 * Level 0 = no action, Level 5 = full liquidation.
 *
 * @param {number} underlyingDrawdown — Drawdown from peak as a decimal (e.g., 0.15 = 15%)
 * @returns {number} Deleverage level: 0 (none), 1 (reduce 25%), 2 (reduce 50%),
 *   3 (cap 1.5x), 4 (force 1x), 5 (liquidate)
 */
function getDeleverageLevelDirect(underlyingDrawdown) { // 5-level cascade maps underlying drawdown severity to a deleverage action level
  if (underlyingDrawdown >= 0.40) return 5; // Level 5: 40%+ drawdown = LIQUIDATION — underlying crashed too far, position is unsalvageable
  if (underlyingDrawdown >= 0.30) return 4; // Level 4: 30%+ drawdown = force to 1x — eliminate all leverage to prevent liquidation
  if (underlyingDrawdown >= 0.22) return 3; // Level 3: 22%+ drawdown = cap at 1.5x — significant stress, limit exposure aggressively
  if (underlyingDrawdown >= 0.15) return 2; // Level 2: 15%+ drawdown = reduce leverage by 50% — moderate stress, halve the excess leverage
  if (underlyingDrawdown >= 0.10) return 1; // Level 1: 10%+ drawdown = reduce leverage by 25% — early warning, gentle reduction to preserve upside recovery
  return 0; // No drawdown threshold breached — maintain current leverage
}

/**
 * Simulate the LTAP "constant leverage from entry" protocol on historical OHLCV data.
 * Outputs a line series ({time, value}) for area/line chart rendering.
 * Includes auto-deleverage cascades, circuit breakers, and releveraging logic.
 *
 * @param {Array<{time: string, open: number, high: number, low: number, close: number}>} ohlcv — Historical price bars
 * @param {number} leverage — Target leverage multiplier (absolute, e.g., 2.0)
 * @param {boolean} isShort — True for short positions (inverts return direction)
 * @param {boolean} [disableFees=false] — True to run fee-free simulation for comparison
 * @returns {{data: Array<{time: string, value: number, liquidated: boolean}>,
 *   liquidated: boolean, liqTime: string|null,
 *   events: Array<{time: string, type: string, from?: number, to?: number, level?: number, slippage?: number, reason?: string}>,
 *   stats: {totalDeleverageEvents: number, totalReleverEvents: number, totalSlippageCost: number, timeAtReducedLeverage: number, circuitBreakerDays: number}}}
 */
function simulateProtocol(ohlcv, leverage, isShort, disableFees = false) { // Line-series LTAP simulation — outputs {time, value} for area/line charts; disableFees mode used for "no fee" comparison column
  const result = []; // Accumulates daily {time, value, liquidated} points for the chart
  const entryPrice = ohlcv[0].close; // First close becomes the starting NAV — all returns measured from this base
  let currentDeposit = entryPrice; // Tracks the "deposit" (effective notional) that gets reset on deleverage/relever events to recalculate from new base
  let currentEntry = entryPrice; // The price at which current leverage exposure was established — changes on deleverage/relever to prevent compounding errors
  let currentLev = leverage; // Active leverage ratio — may be reduced by auto-deleverage and restored by releveraging
  let accruedFees = 0; // Running total of fees subtracted from position value — reset to 0 on deleverage/relever since deposit absorbs them
  let liquidated = false; // Once true, all remaining days output value=0 — position is permanently closed
  const direction = isShort ? -1 : 1; // Multiply returns by -1 for shorts so the same math works for both long and short positions
  let peakUnderlyingPrice = ohlcv[0].close; // High watermark of the underlying — used to calculate drawdown for auto-deleverage triggers
  let lastFullLeverageDay = 0; // Tracks when full leverage was last active — used to reset peak price after successful releveraging
  const events = []; // Log of deleverage/relever/circuit_breaker events — displayed as chart markers and in stats panel
  let totalDeleverageEvents = 0; // Counter for deleverage events — shown in the risk stats panel
  let totalReleverEvents = 0; // Counter for releveraging events — shown alongside deleverage count for balance
  let totalSlippageCost = 0; // Cumulative slippage cost in dollar terms — quantifies the friction cost of risk management
  let timeAtReducedLeverage = 0; // Days spent at less than target leverage — measures how often auto-deleverage is active
  let circuitBreakerDays = 0; // Total days under circuit breaker restrictions — shows market stress exposure
  let lastDeleverageDay = -999; // Day index of last deleverage — initialized to -999 so the 5-day cooldown check passes on first potential relever
  let circuitBreakerUntil = -1; // Day index until which releveraging is blocked — prevents re-adding leverage during volatile periods
  let circuitBreakerFeeUntil = -1; // Day index until which fees are doubled — penalizes holding leveraged positions during extreme volatility

  for (let i = 0; i < ohlcv.length; i++) { // Walk through each trading day sequentially — order matters because state carries forward
    if (liquidated) { // Position was wiped out on a previous day — emit zero for remaining days so chart shows flat line at zero
      result.push({ time: ohlcv[i].time, value: 0, liquidated: true });
      continue; // Skip all calculations — nothing to simulate on a liquidated position
    }

    const price = ohlcv[i].close; // Use close price as the reference — consistent with how leveraged products settle daily
    const move = (price - currentEntry) / currentEntry; // Percentage move from entry — this is the "constant from entry" calculation that avoids daily-reset decay

    const annualFee = getLTAPFee(currentLev); // Fee depends on current (possibly reduced) leverage, not target — lower leverage = lower fee during deleverage
    let dailyFee = annualFee / 252; // Convert annual fee to daily by dividing by trading days — accrued continuously

    if (i <= circuitBreakerFeeUntil) { // During circuit breaker periods, fees double to discourage holding leveraged positions in extreme volatility
      dailyFee *= 2; // 2x fee surcharge compensates liquidity providers for the elevated risk they bear
    }

    if (!disableFees && i > 0) { // Skip fee on day 0 (entry day) and when running "no fee" comparison simulation
      accruedFees += currentDeposit * dailyFee; // Fees accrue on the deposit notional, not the current value — prevents fee-on-fee compounding
    }

    let value = currentDeposit * (1 + currentLev * direction * move) - accruedFees; // Core LTAP formula: deposit * (1 + leverage * directional_return) - fees — "constant from entry" means no daily rebalancing

    if (i > 0) { // Circuit breaker detection — can't check on day 0 because there's no previous day to compare
      const dailyReturn = Math.abs((ohlcv[i].close - ohlcv[i - 1].close) / ohlcv[i - 1].close); // Absolute daily return — circuit breakers trigger on magnitude regardless of direction

      if (dailyReturn > 0.08) { // RED circuit breaker: 8%+ daily move signals extreme market stress (flash crash, circuit breaker halt)
        circuitBreakerUntil = i + 5; // Block releveraging for 5 trading days — market needs time to stabilize before adding risk back
        circuitBreakerFeeUntil = i + 3; // Double fees for 3 days — shorter than relever block because fee penalty is immediate
        circuitBreakerDays += 5; // Track total circuit breaker days for risk stats display

        events.push({ // Log the event for chart marker rendering
          time: ohlcv[i].time,
          type: 'circuit_breaker',
          reason: '8%+ daily move — RED' // Human-readable reason shown in the marker tooltip
        });

      } else if (dailyReturn > 0.05) { // YELLOW circuit breaker: 5%+ daily move is elevated but not extreme — shorter restriction period
        circuitBreakerUntil = Math.max(circuitBreakerUntil, i + 2); // Max() prevents a YELLOW from shortening an existing RED restriction
        circuitBreakerFeeUntil = Math.max(circuitBreakerFeeUntil, i + 1); // Same max() logic — don't reduce fee surcharge if RED is already active
        circuitBreakerDays += 2; // 2-day restriction for YELLOW vs 5-day for RED — proportional to severity

        events.push({ // Log YELLOW event separately from RED for distinct chart markers
          time: ohlcv[i].time,
          type: 'circuit_breaker',
          reason: '5%+ daily move — YELLOW' // Color-coded reason distinguishes severity in the UI
        });
      }
    }

    if (ohlcv[i].close > peakUnderlyingPrice) { // Update high watermark when underlying makes a new high
      peakUnderlyingPrice = ohlcv[i].close; // Drawdown is measured from this peak — raising it means drawdown thresholds require a bigger drop to trigger
    }

    if (value > 0 && currentLev > 1.0) { // Auto-deleverage only applies when position is still alive AND leverage exceeds 1x (no need to deleverage an unleveraged position)
      const underlyingDD = (peakUnderlyingPrice - ohlcv[i].close) / peakUnderlyingPrice; // Drawdown from peak — measures how far the underlying has fallen, not the leveraged position

      const level = getDeleverageLevelDirect(underlyingDD); // Map drawdown percentage to a 0-5 severity level
      let newLev = currentLev; // Start with current leverage — only reduce if a threshold is breached

      if (level === 5) { // 40%+ drawdown: liquidation — position value would be wiped at high leverage, so force-close at 0x
        newLev = 0;
      } else if (level === 4) { // 30%+ drawdown: force to 1x — eliminate all borrowing to prevent further losses
        newLev = 1.0;
      } else if (level === 3) { // 22%+ drawdown: cap at 1.5x — aggressive reduction but maintain some upside for recovery
        newLev = Math.min(currentLev, 1.5);
      } else if (level === 2) { // 15%+ drawdown: halve excess leverage — e.g., 3x becomes 2x (1 + (3-1)*0.5)
        newLev = 1 + (currentLev - 1) * 0.5;
      } else if (level === 1) { // 10%+ drawdown: reduce excess leverage by 25% — gentle first step to preserve upside
        newLev = 1 + (currentLev - 1) * 0.75;
      }

      if (newLev < currentLev) { // Only act if the new leverage is lower — prevents redundant events when drawdown stays in the same band
        const slippageCost = level >= 5 ? 0.01 : level >= 4 ? 0.005 : level >= 3 ? 0.003 : 0.002; // Higher slippage at higher severity because urgent liquidations face worse execution prices
        value *= (1 - slippageCost); // Deduct slippage from position value — simulates the real-world cost of unwinding leveraged positions
        totalSlippageCost += currentDeposit * slippageCost; // Track cumulative slippage for the stats panel

        events.push({ // Record deleverage event for chart markers and event log
          time: ohlcv[i].time,
          type: 'deleverage',
          from: currentLev, // Previous leverage — shown in marker text as "DeLev 3.0→1.5×"
          to: newLev, // New leverage after reduction
          level: level, // Severity level (1-5) for color coding
          slippage: slippageCost // Slippage percentage for the marker tooltip
        });
        totalDeleverageEvents++; // Increment counter for stats display

        if (newLev === 0) { // Level 5 liquidation — position is fully closed
          liquidated = true; // Set flag so all future days output zero
          result.push({ time: ohlcv[i].time, value: 0, liquidated: true });
          continue; // Skip to next day — nothing more to calculate
        }

        currentDeposit = value; // Reset deposit to current value — future returns calculated from this new base
        currentEntry = price; // Reset entry price — "constant from entry" restarts from the deleverage point
        currentLev = newLev; // Apply the reduced leverage for future calculations
        accruedFees = 0; // Reset accrued fees — they were already subtracted from value which became the new deposit
        lastDeleverageDay = i; // Record when this happened — releveraging needs 5 days of cooldown from this point
      }
    }

    if (value > 0 && currentLev < leverage && i > circuitBreakerUntil) { // Releveraging: position is alive, leverage is below target, and no circuit breaker is active
      const daysSinceDelev = i - lastDeleverageDay; // Cooldown period since last deleverage — prevents whipsawing in volatile markets

      if (daysSinceDelev >= 5) { // 5 trading days must pass before releveraging — gives the market time to confirm the drawdown is over
        const lookback = Math.min(3, i); // Look back up to 3 days to check for recovery — fewer if near start of data
        const recentLow = Math.min(
          ...Array.from(
            {length: lookback}, // Spread across recent days to find the lowest close
            (_, k) => ohlcv[i - k].close // Get close prices for the last 1-3 days
          )
        );
        const recovering = ohlcv[i].close > recentLow * 1.005; // Price must be 0.5% above the recent low — confirms upward momentum, not just a dead cat bounce

        if (recovering) { // Market is showing signs of recovery — safe to add leverage back gradually
          const restored = Math.min(leverage, currentLev + 1.0); // Add back at most +1x per step — gradual releveraging prevents re-entering at full leverage into a bear market rally
          if (restored > currentLev) { // Only act if we're actually increasing leverage (avoids no-op events)
            const slippage = 0.001; // 0.1% slippage for releveraging — lower than deleverage because releveraging is less urgent
            value *= (1 - slippage); // Deduct the cost of re-establishing the leveraged position
            totalSlippageCost += currentDeposit * slippage; // Track cumulative cost

            events.push({ // Log releveraging event for chart markers
              time: ohlcv[i].time,
              type: 'relever',
              from: currentLev, // Previous (reduced) leverage
              to: restored, // New (higher) leverage after restoration
              slippage: slippage // Cost of the operation
            });
            totalReleverEvents++; // Increment counter for stats display
            currentDeposit = value; // Reset deposit to current value — same pattern as deleverage
            currentEntry = price; // Reset entry price for the new leverage calculation base
            currentLev = restored; // Apply the increased leverage
            accruedFees = 0; // Reset fees since deposit absorbed them
            lastDeleverageDay = i; // Reset cooldown timer — prevents rapid successive releveraging

            if (restored >= leverage) { // Fully restored to target leverage — the crisis is over
              peakUnderlyingPrice = price; // Reset the drawdown peak to current price so old drawdowns don't immediately re-trigger deleverage
              lastFullLeverageDay = i; // Record when we returned to full leverage for tracking
            }
          }
        }
      }
    }

    if (value <= 0) { // Position value went negative — shouldn't happen with deleverage but catches edge cases (e.g., gap downs)
      liquidated = true; // Mark as liquidated — all future days will output zero
      result.push({ time: ohlcv[i].time, value: 0, liquidated: true });
    } else {
      if (currentLev < leverage) timeAtReducedLeverage++; // Count days at reduced leverage — shows how often auto-deleverage is active in the stats panel
      result.push({ time: ohlcv[i].time, value: +value.toFixed(4), liquidated: false }); // toFixed(4) then + prevents floating point noise from accumulating across thousands of days
    }
  }

  return { // Return comprehensive simulation results — data for charting, metadata for stats panel
    data: result, // Array of {time, value, liquidated} for the line/area chart
    liquidated, // Boolean: did the position get liquidated at any point?
    liqTime: liquidated ? result.find(r => r.liquidated)?.time : null, // Date of liquidation for the LIQUIDATED marker on the chart
    events, // Array of deleverage/relever/circuit_breaker events for chart markers
    stats: { // Aggregate statistics for the risk panel display
      totalDeleverageEvents, // How many times auto-deleverage triggered
      totalReleverEvents, // How many times leverage was restored
      totalSlippageCost, // Total dollar cost of deleverage/relever slippage
      timeAtReducedLeverage, // Days spent at less than target leverage
      circuitBreakerDays // Days under circuit breaker restrictions
    }
  };
}

/**
 * Candlestick variant of simulateProtocol. Outputs OHLC bars instead of single values,
 * applying the same auto-deleverage/releveraging/circuit breaker logic.
 * All four OHLC prices are transformed through the leverage formula for realistic candle shapes.
 *
 * @param {Array<{time: string, open: number, high: number, low: number, close: number}>} ohlcv — Historical price bars
 * @param {number} leverage — Target leverage multiplier (absolute)
 * @param {boolean} isShort — True for short positions
 * @param {boolean} [disableFees=false] — True for fee-free comparison
 * @returns {{data: Array<{time: string, open: number, high: number, low: number, close: number, liquidated: boolean}>,
 *   liquidated: boolean, liqTime: string|null, events: Array, stats: Object}}
 */
function simulateProtocolOHLC(ohlcv, leverage, isShort, disableFees = false) { // Candlestick variant of simulateProtocol — outputs OHLC bars instead of single values, needed for the candlestick chart view
  const result = []; // Accumulates OHLC bars with leveraged prices for candlestick rendering
  const entryPrice = ohlcv[0].close; // Same starting NAV as line version — must match for consistent comparison
  let currentDeposit = entryPrice; // Same deposit tracking as simulateProtocol — reset on deleverage/relever
  let currentEntry = entryPrice; // Entry price for "constant from entry" calculation — same mechanics as line version
  let currentLev = leverage; // Active leverage — subject to auto-deleverage cascade
  let accruedFees = 0; // Running fee total — same accrual logic as line version
  let liquidated = false; // Liquidation flag — once set, outputs zero-value candles
  const direction = isShort ? -1 : 1; // Direction multiplier for short positions
  let peakUnderlyingPrice = ohlcv[0].close; // High watermark for drawdown-based deleverage triggers
  let lastFullLeverageDay = 0; // Tracks when target leverage was last fully active
  const events = []; // Deleverage/relever/circuit_breaker event log (shared with line version's markers)
  let totalDeleverageEvents = 0; // Counter for stats display
  let totalReleverEvents = 0; // Counter for stats display
  let totalSlippageCost = 0; // Cumulative slippage for stats display
  let timeAtReducedLeverage = 0; // Days at reduced leverage for stats display
  let circuitBreakerDays = 0; // Circuit breaker duration for stats display
  let lastDeleverageDay = -999; // Last deleverage day for 5-day cooldown — same as line version
  let circuitBreakerUntil = -1; // Releveraging block deadline
  let circuitBreakerFeeUntil = -1; // Fee doubling deadline

  for (let i = 0; i < ohlcv.length; i++) { // Sequential day-by-day simulation — same structure as simulateProtocol
    if (liquidated) { // Position is dead — output zero candles for the remaining timeline
      result.push({
        time: ohlcv[i].time,
        open: 0, high: 0, low: 0, close: 0, // All OHLC values zero for a liquidated candle
        liquidated: true
      });
      continue; // No further calculation needed
    }

    const price = ohlcv[i].close; // Close price used for fee calculation and deleverage checks
    const annualFee = getLTAPFee(currentLev); // Fee based on current leverage level
    let dailyFee = annualFee / 252; // Convert to daily fee for accrual

    if (i <= circuitBreakerFeeUntil) { // Double fees during circuit breaker periods — same logic as line version
      dailyFee *= 2;
    }

    if (!disableFees && i > 0) { // Accrue daily fee from day 1 onward (skip entry day)
      accruedFees += currentDeposit * dailyFee;
    }

    const vals = [ // Transform all four OHLC prices through the leverage formula — needed for realistic candlestick shapes
      ohlcv[i].open,  // Underlying open price
      ohlcv[i].high,  // Underlying high — becomes leveraged high (amplified deviation from entry)
      ohlcv[i].low,   // Underlying low — becomes leveraged low
      ohlcv[i].close  // Underlying close — the settlement price
    ].map(p => { // Apply the same "constant from entry" formula to each OHLC component
      const move = (p - currentEntry) / currentEntry; // Return from entry for this price point
      return currentDeposit * (1 + currentLev * direction * move) - accruedFees; // Leveraged value at each OHLC price
    });

    const [o, h, l, c] = vals; // Destructure into leveraged open/high/low/close for the output candle
    let value = c; // Close value is the primary tracking value — used for deleverage checks and event logging
    const minValue = Math.min(...vals); // Check if ANY of the four OHLC prices went to zero — intraday liquidation even if close recovered

    if (i > 0) { // Circuit breaker detection — same logic as simulateProtocol
      const dailyReturn = Math.abs((ohlcv[i].close - ohlcv[i - 1].close) / ohlcv[i - 1].close); // Absolute daily return magnitude

      if (dailyReturn > 0.08) { // RED circuit breaker: extreme 8%+ move
        circuitBreakerUntil = i + 5; // Block releveraging for 5 days
        circuitBreakerFeeUntil = i + 3; // Double fees for 3 days
        circuitBreakerDays += 5; // Track for stats

        events.push({ // Log RED circuit breaker event
          time: ohlcv[i].time,
          type: 'circuit_breaker',
          reason: '8%+ daily move — RED'
        });

      } else if (dailyReturn > 0.05) { // YELLOW circuit breaker: elevated 5%+ move
        circuitBreakerUntil = Math.max(circuitBreakerUntil, i + 2); // Don't shorten existing RED restriction
        circuitBreakerFeeUntil = Math.max(circuitBreakerFeeUntil, i + 1); // Don't reduce existing fee surcharge
        circuitBreakerDays += 2; // Track for stats

        events.push({ // Log YELLOW circuit breaker event
          time: ohlcv[i].time,
          type: 'circuit_breaker',
          reason: '5%+ daily move — YELLOW'
        });
      }
    }

    if (ohlcv[i].close > peakUnderlyingPrice) { // Update drawdown high watermark on new highs
      peakUnderlyingPrice = ohlcv[i].close;
    }

    if (minValue > 0 && currentLev > 1.0) { // OHLC version uses minValue instead of value — checks if intraday low would have triggered deleverage
      const currentUnderlyingLow = isShort // For shorts, worst case is when underlying goes UP (high), not down (low)
        ? ohlcv[i].high   // Short position suffers most at the day's high price
        : ohlcv[i].low;   // Long position suffers most at the day's low price

      const underlyingDD = (peakUnderlyingPrice - currentUnderlyingLow) / peakUnderlyingPrice; // Drawdown using intraday extreme — more conservative than close-only in line version
      const level = getDeleverageLevelDirect(underlyingDD); // Map drawdown to severity level
      let newLev = currentLev; // Start with current leverage

      if (level === 5) { // 40%+ drawdown: liquidation
        newLev = 0;
      } else if (level === 4) { // 30%+ drawdown: force to 1x
        newLev = 1.0;
      } else if (level === 3) { // 22%+ drawdown: cap at 1.5x
        newLev = Math.min(currentLev, 1.5);
      } else if (level === 2) { // 15%+ drawdown: halve excess leverage
        newLev = 1 + (currentLev - 1) * 0.5;
      } else if (level === 1) { // 10%+ drawdown: reduce 25% of excess
        newLev = 1 + (currentLev - 1) * 0.75;
      }

      if (newLev < currentLev) { // Leverage reduction triggered — apply slippage and record event
        const slippageCost = level >= 5 ? 0.01 : level >= 4 ? 0.005 : level >= 3 ? 0.003 : 0.002; // Graduated slippage by severity
        value *= (1 - slippageCost); // Deduct slippage from close value
        totalSlippageCost += currentDeposit * slippageCost; // Track cumulative cost

        events.push({ // Log deleverage event for chart markers
          time: ohlcv[i].time,
          type: 'deleverage',
          from: currentLev,
          to: newLev,
          level: level,
          slippage: slippageCost
        });
        totalDeleverageEvents++; // Increment deleverage counter

        if (newLev === 0) { // Liquidation — output a candle that shows the collapse to near-zero
          liquidated = true;
          result.push({
            time: ohlcv[i].time,
            open: Math.max(o, 0.01),  // Floor at 0.01 so TradingView can still render the candle body
            high: Math.max(h, 0.01),  // Same floor for high wick
            low: 0.01,                // Low is at the floor — shows the collapse visually
            close: 0.01,              // Close at floor, not zero, because TradingView log scale can't handle zero
            liquidated: true
          });
          continue; // Skip to next day
        }

        currentDeposit = value; // Reset deposit to post-slippage value
        currentEntry = price; // Reset entry for new leverage base
        currentLev = newLev; // Apply reduced leverage
        accruedFees = 0; // Reset fees (absorbed into new deposit)
        lastDeleverageDay = i; // Record for cooldown timer
      }
    }

    if (value > 0 && currentLev < leverage && i > circuitBreakerUntil) { // Releveraging check — same conditions as line version
      const daysSinceDelev = i - lastDeleverageDay; // Cooldown check

      if (daysSinceDelev >= 5) { // 5-day minimum cooldown before releveraging
        const lookback = Math.min(3, i); // Look back up to 3 days for recovery signal
        const recentLow = Math.min(
          ...Array.from(
            {length: lookback}, // Find the lowest close in the lookback window
            (_, k) => ohlcv[i - k].close
          )
        );
        const recovering = ohlcv[i].close > recentLow * 1.005; // 0.5% above recent low confirms recovery momentum

        if (recovering) { // Market recovery confirmed — gradually restore leverage
          const restored = Math.min(leverage, currentLev + 1.0); // Add back up to +1x per step — gradual to prevent whipsawing
          if (restored > currentLev) { // Only if actually increasing
            const slippage = 0.001; // 0.1% slippage for releveraging — lower urgency than deleverage
            value *= (1 - slippage); // Deduct cost
            totalSlippageCost += currentDeposit * slippage; // Track cumulative

            events.push({ // Log releveraging event
              time: ohlcv[i].time,
              type: 'relever',
              from: currentLev,
              to: restored,
              slippage: slippage
            });
            totalReleverEvents++; // Increment counter
            currentDeposit = value; // Reset deposit
            currentEntry = price; // Reset entry
            currentLev = restored; // Apply increased leverage
            accruedFees = 0; // Reset fees
            lastDeleverageDay = i; // Reset cooldown

            if (restored >= leverage) { // Fully restored — reset peak watermark
              peakUnderlyingPrice = price; // New peak prevents old drawdowns from re-triggering
              lastFullLeverageDay = i; // Record restoration point
            }
          }
        }
      }
    }

    if (minValue <= 0) { // Intraday liquidation — any OHLC price hit zero even if close recovered (can't actually recover from liquidation)
      liquidated = true;
      result.push({
        time: ohlcv[i].time,
        open: Math.max(o, 0.01),  // Floor values for TradingView rendering
        high: Math.max(h, 0.01),
        low: 0.01,                // Show the collapse to minimum
        close: 0.01,              // Close at floor
        liquidated: true
      });
    } else { // Position survives — output normal leveraged OHLC candle
      if (currentLev < leverage) timeAtReducedLeverage++; // Count days at reduced leverage
      result.push({
        time: ohlcv[i].time,
        open: +o.toFixed(4),   // Clean floating point for each OHLC component
        high: +h.toFixed(4),
        low: +l.toFixed(4),
        close: +c.toFixed(4),
        liquidated: false
      });
    }
  }

  return { // Same return structure as simulateProtocol for consistent consumption by updateAll()
    data: result, // Array of OHLC bars for the candlestick chart
    liquidated, // Whether position was liquidated
    liqTime: liquidated ? result.find(r => r.liquidated)?.time : null, // Liquidation date for chart marker
    events, // Event log shared with line version for markers
    stats: { // Aggregate stats for risk panel
      totalDeleverageEvents,
      totalReleverEvents,
      totalSlippageCost,
      timeAtReducedLeverage,
      circuitBreakerDays
    }
  };
}

/**
 * Simulate a traditional daily-reset leveraged ETF (like TQQQ/SQQQ) for comparison.
 * Unlike LTAP's "constant from entry", this compounds daily returns with leverage,
 * which causes volatility decay over time. Includes a 5.2% APR borrow cost.
 *
 * @param {Array<{time: string, close: number}>} ohlcv — Historical price bars
 * @param {number} leverage — Leverage multiplier (absolute)
 * @param {boolean} short — True for inverse/short product simulation
 * @returns {{data: Array<{time: string, value: number}>, liquidated: boolean}}
 */
function applyDailyResetLeverage(ohlcv, leverage, short) { // Simulates traditional daily-reset leveraged ETF (like TQQQ/SQQQ) for comparison with LTAP's constant-from-entry model
  const borrowAPR = 0.052; // 5.2% annual borrow rate — approximates the implicit cost of daily-reset leverage (margin + swap fees)
  const dailyBorrow = borrowAPR / 252; // Convert to daily rate — deducted each day to simulate the ongoing cost of borrowing
  const result = []; // Accumulates {time, value} points — same format as simulateProtocol output for comparison
  let cumPrice = ohlcv[0].close; // Cumulative NAV starting at the underlying's close price — tracks the compounding effect of daily resets
  let liquidated = false; // Tracks if the daily-reset product went to zero (extremely rare but possible in theory)

  for (let i = 0; i < ohlcv.length; i++) { // Walk through each trading day
    if (liquidated) { // Once liquidated, output zeros for remaining days
      result.push({ time: ohlcv[i].time, value: 0 });
      continue;
    }

    if (i === 0) { result.push({ time: ohlcv[i].time, value: cumPrice }); continue; } // Day 0 is just the starting value — no return to apply yet
    const baseRet = ohlcv[i].close / ohlcv[i - 1].close - 1; // Daily return of the underlying — this is what gets leveraged each day
    const effectiveRet = short ? -baseRet : baseRet; // Flip sign for short positions — a down day is a positive return for shorts
    const borrowMultiplier = short ? leverage : Math.max(0, leverage - 1); // Shorts borrow the full notional; longs only borrow the excess above 1x (e.g., 2x borrows 1x)
    cumPrice *= 1 + leverage * effectiveRet - borrowMultiplier * dailyBorrow; // Daily compounding: leveraged return minus borrow cost — THIS is the daily-reset decay that LTAP avoids

    if (cumPrice <= 0) { // Theoretical liquidation — daily-reset products can't actually go negative, but this catches the edge case
      liquidated = true;
      cumPrice = 0;
    }

    result.push({ time: ohlcv[i].time, value: +cumPrice.toFixed(4) }); // Output the compounded value — toFixed(4) prevents float noise
  }
  return { data: result, liquidated }; // Return same format as simulateProtocol for comparison grid
}

// ═══════════════════════════════════════════════════
// STATS
// Calculates portfolio analytics for any price series —
// used for base, LTAP, daily-reset, and no-fee comparison.
// ═══════════════════════════════════════════════════

/**
 * Calculate portfolio analytics for any price series. Works for both line ({value})
 * and candlestick ({close}) formats. Computes total return, CAGR, volatility,
 * Sharpe ratio, max drawdown, and liquidation detection.
 *
 * @param {Array<{value?: number, close?: number}>} series — Price series (line or OHLC)
 * @param {number} years — Duration in years (used for CAGR annualization)
 * @returns {{totalReturn: number, cagr: number, vol: number, sharpe: number,
 *   maxDD: number, liquidated: boolean}} Portfolio statistics
 */
function calcStats(series, years) { // Unified stats calculator — works for both {value} (line) and {close} (candlestick) series formats
  const prices = series.map(s => s.value !== undefined ? s.value : s.close); // Normalize: line series use .value, OHLC series use .close — extract a single price array for calculation

  let effectiveEnd = prices.length - 1; // Default to full series — shortened if liquidation found
  let wasLiquidated = false; // Track liquidation to cap maxDD at -100% and CAGR at -100%
  for (let i = 1; i < prices.length; i++) { // Scan for the first zero/negative price indicating liquidation
    if (prices[i] <= 0) {
      effectiveEnd = i; // Mark where the position died — stats only use data up to this point
      wasLiquidated = true;
      break; // Only need the first liquidation point
    }
  }

  const livePrices = prices.slice(0, effectiveEnd + 1); // Trim to only the "alive" portion — computing returns on zero-value days would produce NaN/Infinity
  const returns = []; // Daily return array for volatility and Sharpe calculation
  for (let i = 1; i < livePrices.length; i++) { // Compute daily returns from the live portion only
    if (livePrices[i - 1] > 0) { // Guard against division by zero on the rare day a price is exactly 0
      returns.push(livePrices[i] / livePrices[i - 1] - 1); // Simple return (not log return) — consistent with how leveraged products report performance
    }
  }

  const finalPrice = wasLiquidated ? 0 : prices[prices.length - 1]; // If liquidated, final value is zero regardless of any post-liquidation data
  const totalReturn = prices[0] > 0 ? finalPrice / prices[0] - 1 : -1; // Total return from start to end — handles edge case where starting price is zero (synthetic data error)

  let cagr; // Compound annual growth rate — the most meaningful single return metric for multi-year backtests
  if (wasLiquidated || totalReturn <= -1) {
    cagr = -1; // Cap at -100% — you can't lose more than everything in a leveraged token (unlike margin)
  } else {
    const effectiveYears = wasLiquidated
      ? (effectiveEnd / prices.length) * years // Pro-rate years if liquidated early — CAGR of a 2-year position that died after 6 months uses 0.5 years
      : years; // Full period if no liquidation
    cagr = effectiveYears > 0
      ? Math.pow(1 + totalReturn, 1 / effectiveYears) - 1 // Standard CAGR formula: (1 + totalReturn)^(1/years) - 1
      : 0; // Zero years means no meaningful CAGR
  }

  const mean = returns.length > 0
    ? returns.reduce((a, b) => a + b, 0) / returns.length // Average daily return — needed for variance calculation
    : 0; // No returns available (e.g., single-day series)
  const variance = returns.length > 0
    ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length // Population variance of daily returns — measures dispersion
    : 0; // No data means zero variance
  const vol = Math.sqrt(variance * 252); // Annualize daily variance: multiply by trading days then sqrt — standard finance convention
  const sharpe = vol > 0 ? (cagr - 0.04) / vol : 0; // Sharpe ratio with 4% risk-free rate (approximate T-bill yield) — measures risk-adjusted return

  let peak = prices[0], maxDD = 0; // Peak tracks the high watermark; maxDD tracks the worst drawdown seen
  for (let i = 0; i < livePrices.length; i++) { // Walk through prices to find maximum drawdown
    if (livePrices[i] > peak) peak = livePrices[i]; // Update high watermark on new highs
    if (peak > 0) { // Guard against zero peak (shouldn't happen but defensive)
      const dd = (livePrices[i] - peak) / peak; // Current drawdown as negative fraction (e.g., -0.20 = 20% drawdown)
      if (dd < maxDD) maxDD = dd; // Track the worst (most negative) drawdown
    }
  }
  if (wasLiquidated) maxDD = -1; // Override to -100% if liquidated — total loss regardless of intermediate drawdowns

  return { totalReturn, cagr, vol, sharpe, maxDD, liquidated: wasLiquidated }; // Return all stats for display in the comparison grid and stats panel
}

// ═══════════════════════════════════════════════════
// TRADINGVIEW LIGHTWEIGHT CHARTS SETUP
// TradingView Lightweight Charts is used instead of
// heavier charting libs because it's performant with
// 6,000+ data points (25 years of daily data) and
// supports area, candlestick, and line series natively.
// ═══════════════════════════════════════════════════

const chartEl = document.getElementById('tv-chart'); // Chart container div — sized by CSS and tracked by ResizeObserver for responsive layout
const chart = LightweightCharts.createChart(chartEl, { // Create the main chart instance with dark theme matching the xLever terminal aesthetic
  layout: { background: { type: 'solid', color: '#0a0b0e' }, textColor: '#555970', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }, // Dark background with muted text — monospace font for financial data readability
  grid: { vertLines: { color: '#ffffff06' }, horzLines: { color: '#ffffff06' } }, // Nearly invisible grid lines — visible enough for alignment but don't compete with data
  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal, // Normal mode allows free crosshair movement — better for exploring data than magnetic mode
    vertLine: { color: '#555970', width: 1, style: 2, labelBackgroundColor: '#1a1d26' }, // Dashed vertical crosshair line with dark label background
    horzLine: { color: '#555970', width: 1, style: 2, labelBackgroundColor: '#1a1d26' }, // Matching horizontal crosshair — dashed (style 2) to distinguish from data lines
  },
  rightPriceScale: { borderColor: '#252833', scaleMargins: { top: 0.15, bottom: 0.08 } }, // Top margin leaves room for chart markers (deleverage/relever arrows); bottom margin for axis labels
  timeScale: { borderColor: '#252833', timeVisible: false, rightOffset: 0, fixLeftEdge: false, fixRightEdge: false }, // timeVisible false because we use daily bars (no intraday); no fixed edges to allow free scrolling
  handleScroll: { vertTouchDrag: false }, // Disable vertical touch drag to prevent accidental chart scrolling on mobile — horizontal scroll still works
});

let levAreaSeries = null, levCandleSeries = null, levLineSeries = null, baseSeries = null, depositRefSeries = null; // Track all chart series globally so removeSeries() can clean them up before re-rendering

/**
 * Remove all existing chart series from the TradingView chart instance.
 * Called before re-rendering to prevent series buildup on repeated updateAll() calls.
 */
function removeSeries() { // Clear all existing chart series before adding new ones — prevents series buildup on repeated updateAll() calls
  [levAreaSeries, levCandleSeries, levLineSeries, baseSeries, depositRefSeries].forEach(s => { if (s) chart.removeSeries(s); }); // Iterate all possible series and remove any that exist
  levAreaSeries = levCandleSeries = levLineSeries = baseSeries = depositRefSeries = null; // Reset references to null so we don't try to remove already-removed series next time
}

/**
 * Slice the master 25-year OHLCV dataset to the selected timeframe.
 * Converts period strings ('1M', '1Y', '5Y', etc.) to date cutoffs
 * and returns both the filtered data and the corresponding year count
 * needed for CAGR annualization.
 *
 * @param {string} period — Timeframe code: '1M'|'3M'|'6M'|'1Y'|'3Y'|'5Y'|'10Y'|'25Y'|'MAX'
 * @returns {{data: Array<{time: string, open: number, high: number, low: number, close: number}>, years: number}}
 */
function getFiltered(period) { // Slice the master 25-year dataset down to the selected timeframe (1M, 1Y, 5Y, etc.) and return the corresponding year count for stats calculation
  const cut = new Date(); // Start from today and subtract the period duration to get the cutoff date
  let years; // Number of years for CAGR and fee calculations — must match the actual data window

  switch(period) {
    case '1M': // 1 month lookback — useful for recent performance check
      cut.setMonth(cut.getMonth() - 1);
      years = 1/12; // Fractional year for accurate CAGR annualization
      break;
    case '3M': // 3 months — a quarter of performance data
      cut.setMonth(cut.getMonth() - 3);
      years = 3/12;
      break;
    case '6M': // 6 months — half year, captures one earnings cycle
      cut.setMonth(cut.getMonth() - 6);
      years = 6/12;
      break;
    case '1Y': // 1 year — the default view, captures full seasonal cycle
      cut.setFullYear(cut.getFullYear() - 1);
      years = 1;
      break;
    case '3Y': // 3 years — captures at least one bull/bear cycle for leverage analysis
      cut.setFullYear(cut.getFullYear() - 3);
      years = 3;
      break;
    case '5Y': // 5 years — medium-term, shows how LTAP handles multiple drawdowns
      cut.setFullYear(cut.getFullYear() - 5);
      years = 5;
      break;
    case '10Y': // 10 years — includes 2020 COVID crash, 2022 bear market for stress testing
      cut.setFullYear(cut.getFullYear() - 10);
      years = 10;
      break;
    case '25Y': // 25 years — maximum history, includes dot-com, GFC, COVID, 2022
      cut.setFullYear(cut.getFullYear() - 25);
      years = 25;
      break;
    case 'MAX': // MAX is the same as 25Y — we fetch 25 years of data maximum
      cut.setFullYear(cut.getFullYear() - 25);
      years = 25;
      break;
    default: // Fallback to 1 year if an unknown period is somehow passed
      cut.setFullYear(cut.getFullYear() - 1);
      years = 1;
  }

  const cutStr = cut.toISOString().split('T')[0]; // Convert cutoff to ISO date string for string comparison with OHLCV time fields
  return { data: allData.filter(d => d.time >= cutStr), years: years }; // Filter master data to only include bars on or after the cutoff date
}


/**
 * Master render function. Called on every user interaction (leverage change,
 * timeframe switch, chart type toggle, entry point click, ticker change).
 * Runs all simulations (LTAP, OHLC, daily-reset, no-fee), updates the chart
 * with series and markers, computes stats, and refreshes all UI panels
 * (overlay, comparison grid, risk meter, fee economics, deleverage stats).
 */
function updateAll() { // Master render function — called on every user interaction (leverage change, timeframe change, chart type toggle, entry point click)
  const { data, years } = getFiltered(currentPeriod); // Get the OHLCV data sliced to the selected timeframe and the corresponding year count
  if (data.length < 2) return; // Need at least 2 data points to compute a return — single point has no movement

  const isShort = currentLeverage < 0; // Negative leverage means short position — LTAP supports both long and short
  const absMag = Math.abs(currentLeverage); // Absolute leverage magnitude — used for fee calculation and simulation (direction handled separately)

  // Slice data from the user-selected entry point — enables "what if I entered on this date?" backtesting
  const backtestData = data.slice(entryDateIndex);
  if (backtestData.length < 2) { // Entry point too close to end of data — reset to start and re-render
    entryDateIndex = 0; // Prevent stuck state where user clicked near the end of the chart
    return updateAll(); // Recursive call with reset entry — safe because entryDateIndex is now 0
  }

  const normBase = data.map(d => ({ time: d.time, value: +d.close.toFixed(4) })); // Normalized base (1x unleveraged) series — shown as gray reference line on the chart
  const levResult = simulateProtocol(backtestData, absMag, isShort, false); // LTAP line simulation with fees — the primary output displayed as area/line chart
  const levOHLCResult = simulateProtocolOHLC(backtestData, absMag, isShort, false); // LTAP candlestick simulation — same logic but outputs OHLC bars for candlestick view
  const dailyResetResult = applyDailyResetLeverage(backtestData, absMag, isShort); // TQQQ-style daily-reset comparison — shows how daily rebalancing compares to LTAP's constant-from-entry
  const noFeeResult = simulateProtocol(backtestData, absMag, isShort, true); // Fee-free LTAP simulation — isolates the fee drag so users can see how much fees cost them

  const levLine = levResult.data; // Extract data arrays from simulation results for charting
  const levOHLC = levOHLCResult.data; // OHLC bars for candlestick view
  const dailyResetLine = dailyResetResult.data; // Daily-reset comparison line
  const noFeeLine = noFeeResult.data; // No-fee comparison line

  const finalPnL = levLine[levLine.length - 1].value - levLine[0].value; // Raw P&L in dollar terms to determine if the position is profitable
  const isProfitable = finalPnL >= 0; // Used to color the chart line green (profit) or red (loss)
  let accent; // Dynamic accent color based on position outcome
  if (currentLeverage === 0) {
    accent = '#555970'; // Neutral gray for cash (0x) — no exposure, no P&L to colorize
  } else if (isProfitable) {
    accent = '#00e676'; // Green for profitable positions — consistent with trading terminal conventions
  } else {
    accent = '#ff5252'; // Red for losing positions — immediately visible risk signal
  }

  removeSeries(); // Clear all existing chart series before adding new ones — prevents visual artifacts from previous renders

  baseSeries = chart.addLineSeries({ color: '#555970', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false }); // Unleveraged base (1x) shown as thin gray line — reference for how much leverage amplifies/reduces returns
  baseSeries.setData(normBase); // Plot the full period base data (not sliced to entry) so user can see the underlying's full movement

  const entryPrice = normBase[entryDateIndex].value; // Entry price for the deposit reference line — shows where the user's capital started
  depositRefSeries = chart.addLineSeries({ // Horizontal dashed line at entry price — visual reference for breakeven level
    color: '#ffffff15', lineWidth: 1, lineStyle: 2, // Very faint white, dashed — subtle enough to not distract from main data
    crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false // Hide all auto-labels — this is a pure visual reference
  });
  depositRefSeries.setData([ // Two points define the horizontal line — TradingView draws a line between them
    { time: backtestData[0].time, value: entryPrice }, // Start at entry date
    { time: data[data.length - 1].time, value: entryPrice } // Extend to end of data — shows breakeven level across the full chart
  ]);

  if (currentChartType === 'area') { // Area chart (default) — filled area under the curve gives intuitive sense of growth/decline
    levAreaSeries = chart.addAreaSeries({ lineColor: accent, topColor: accent + '30', bottomColor: accent + '05', lineWidth: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerRadius: 4, crosshairMarkerBackgroundColor: accent }); // Gradient fill from 30% to 5% opacity — stronger color near the line, fading to nearly transparent at bottom
    levAreaSeries.setData(levLine); // Plot the LTAP simulated line data
  } else if (currentChartType === 'candlestick') { // Candlestick view — shows intraday OHLC action of the leveraged position
    levCandleSeries = chart.addCandlestickSeries({ upColor: '#00e676', downColor: '#ff5252', borderUpColor: '#00e676', borderDownColor: '#ff5252', wickUpColor: '#00e67688', wickDownColor: '#ff525288', lastValueVisible: true, priceLineVisible: false }); // Green up / red down with semi-transparent wicks — standard candlestick colors
    levCandleSeries.setData(levOHLC); // Plot the OHLC simulated candle data
  } else { // Plain line chart — no fill, just the line for a cleaner look
    levLineSeries = chart.addLineSeries({ color: accent, lineWidth: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerRadius: 4 }); // Same accent color, 2px width for visibility
    levLineSeries.setData(levLine); // Plot the LTAP simulated line data
  }

  const activeSeries = levAreaSeries || levLineSeries || levCandleSeries; // Whichever series type is active — needed to attach markers to the correct series
  if (activeSeries && activeSeries.setMarkers) { // Guard: candlestick series might not support markers in all versions
    const markers = []; // Collect all markers before sorting and setting — TradingView requires markers in chronological order

    if (levResult.events && levResult.events.length > 0) { // Add markers for deleverage, relever, and circuit breaker events from the simulation
      levResult.events.forEach(evt => {
        if (evt.type === 'deleverage') { // Yellow downward arrow above the bar — visually signals leverage reduction
          markers.push({
            time: evt.time,
            position: 'aboveBar', // Above bar so it doesn't overlap with the data line
            color: '#ffd740', // Amber/yellow for warning — deleverage is protective, not catastrophic
            shape: 'arrowDown', // Downward arrow indicates leverage is being reduced
            text: `DeLev ${evt.from.toFixed(1)}→${evt.to.toFixed(1)}× (L${evt.level}, -${(evt.slippage * 100).toFixed(1)}%)` // Show the leverage change, severity level, and slippage cost
          });
        } else if (evt.type === 'relever') { // Green upward arrow below the bar — leverage being restored is a positive signal
          markers.push({
            time: evt.time,
            position: 'belowBar', // Below bar to avoid overlapping with deleverage markers on the same day
            color: '#00e676', // Green for positive action — leverage restoration means recovery
            shape: 'arrowUp', // Upward arrow indicates leverage is increasing
            text: `ReLev ${evt.from.toFixed(1)}→${evt.to.toFixed(1)}×` // Show the leverage restoration range
          });
        } else if (evt.type === 'circuit_breaker') { // Red circle above the bar — signals extreme market volatility
          markers.push({
            time: evt.time,
            position: 'aboveBar', // Above bar alongside deleverage markers
            color: '#ff8a80', // Light red — urgent but not as severe as liquidation red
            shape: 'circle', // Circle distinguishes circuit breakers from deleverage arrows
            text: `CB: ${evt.reason}` // Shows whether it's YELLOW (5%+) or RED (8%+)
          });
        }
      });
    }

    if (levResult.liquidated && levResult.liqTime) { // Special marker for liquidation event — the most critical event to highlight
      markers.push({
        time: levResult.liqTime,
        position: 'belowBar', // Below bar to be visible even when price crashes to zero
        color: '#ff0000', // Bright red — maximum severity
        shape: 'circle', // Circle marker for liquidation event
        text: '💀 LIQUIDATED 💀', // Degen-style skull markers
        size: 3
      });
    }

    // Add entry point marker only when user has clicked to set a custom entry — not needed when starting from the beginning
    if (entryDateIndex > 0) {
      markers.push({
        time: backtestData[0].time,
        position: 'belowBar', // Below bar to be visible in the chart area
        color: '#7c4dff', // Purple — distinct from green/red/yellow used for events
        shape: 'circle', // Circle for static reference point (not an event)
        text: `Entry: $${entryPrice.toFixed(2)}` // Show the entry price for context
      });
    }

    if (markers.length > 0) { // Only set markers if we have any — avoid unnecessary API calls
      markers.sort((a, b) => a.time.localeCompare(b.time)); // TradingView requires markers sorted chronologically — unsorted markers cause rendering bugs
      activeSeries.setMarkers(markers); // Apply all markers to the active series at once
    }
  }

  // Force chart to show all data in the viewport — prevents the chart from being zoomed to an arbitrary range after re-rendering
  if (data.length > 0) {
    chart.timeScale().setVisibleLogicalRange({ // Set explicit visible range to show the full dataset
      from: 0, // Start at the first data point
      to: data.length - 1, // End at the last data point
    });
  } else {
    chart.timeScale().fitContent(); // Fallback: let TradingView auto-fit — shouldn't happen but defensive
  }

  const levStats = calcStats(levLine, years); // Calculate stats for the LTAP leveraged series — feeds the main stats panel
  const baseLineStats = calcStats(normBase, years); // Calculate stats for the unleveraged base — used for volatility multiple comparison
  const dailyResetStats = calcStats(dailyResetLine, years); // Calculate stats for daily-reset comparison — shows LTAP vs TQQQ-style advantage
  const noFeeStats = calcStats(noFeeLine, years); // Calculate stats for no-fee version — isolates fee drag impact

  const finalVal = levLine[levLine.length - 1].value; // Final NAV of the LTAP position — displayed as the main price on the overlay
  const directionLabel = absMag === 0 ? 'CASH' : (isShort ? 'SHORT' : 'LONG'); // Human-readable direction label for the overlay header
  const directionColor = absMag === 0 ? '#555970' : (isShort ? '#ff5252' : '#00e676'); // Color-code: gray for cash, red for short, green for long — immediate visual direction cue

  const overlayPriceEl = document.getElementById('overlayPrice'); // Main price display element overlaid on the top-left of the chart
  if (levResult.liquidated) { // Position was liquidated — show zero price and a prominent liquidation badge
    overlayPriceEl.textContent = '$0.00'; // Liquidated position is worth nothing
    overlayPriceEl.style.color = '#ff0000'; // Red price to signal total loss
    overlayPriceEl.style.fontWeight = '900'; // Extra bold for emphasis
    overlayPriceEl.style.textShadow = '0 0 10px #ff0000'; // Red glow effect on liquidation

    let liqBadge = document.getElementById('liqBadge'); // Check if liquidation badge already exists from a previous render
    if (!liqBadge) { // Create the badge only once — subsequent renders just update its text and show/hide it
      liqBadge = document.createElement('div');
      liqBadge.id = 'liqBadge'; // ID for finding it on subsequent renders
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
      `; // Red bordered badge with pulsing glow — maximum visual impact for liquidation events
      overlayPriceEl.parentNode.insertBefore(liqBadge, overlayPriceEl.nextSibling); // Insert right after the price display
    }
    liqBadge.textContent = `💀 LIQUIDATED ${levResult.liqTime}`; // Show when the liquidation occurred with skull emoji
    liqBadge.style.display = 'inline-block'; // Make visible
  } else { // Position is still alive — show current NAV and hide any liquidation badge
    overlayPriceEl.textContent = '$' + finalVal.toFixed(2); // Display current value with 2 decimal places (dollar precision)
    overlayPriceEl.style.color = ''; // Reset to default color (inherits from CSS based on profit/loss)
    overlayPriceEl.style.fontWeight = ''; // Reset bold
    overlayPriceEl.style.textShadow = ''; // Reset glow
    const liqBadge = document.getElementById('liqBadge');
    if (liqBadge) liqBadge.style.display = 'none'; // Hide the badge — position is not liquidated in this scenario
  }

  const signedDisplay = currentLeverage > 0 // Format leverage with explicit sign for clarity — "+2.0" vs "-2.0" vs "0"
    ? '+' + absMag.toFixed(1) // Positive leverage gets a plus sign
    : currentLeverage < 0
      ? '-' + absMag.toFixed(1) // Negative leverage gets a minus sign
      : '0'; // Zero leverage shown as plain "0"

  if (absMag === 0) { // Cash position (0x leverage) — special label indicating no market exposure
    document.getElementById('overlayLabel').innerHTML = `${escapeHTML(currentTicker)} — <span style="color:#555970">CASH</span> 0× (No exposure)`;
  } else if (absMag < 0.5 && absMag > 0) { // Sub-0.5x leverage — warn user this provides minimal exposure (unusual use case)
    document.getElementById('overlayLabel').innerHTML = `Leveraged ${escapeHTML(currentTicker)} — <span style="color:${directionColor}">${directionLabel}</span> ${signedDisplay}× <span style="font-size:9px;color:var(--text-muted);">(Minimal exposure)</span>`;
  } else { // Normal leverage range (0.5x to 4x) — standard label with ticker, direction, and magnitude
    document.getElementById('overlayLabel').innerHTML = `Leveraged ${escapeHTML(currentTicker)} — <span style="color:${directionColor}">${directionLabel}</span> ${signedDisplay}×`;
  }
  const pct = levStats.totalReturn * 100; // Convert decimal return to percentage for display (e.g., 0.15 -> 15.00%)
  const chEl = document.getElementById('overlayChange'); // Percentage change element below the price overlay
  chEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'; // Explicit plus sign for positive returns — makes direction unambiguous
  chEl.className = 'price-change mono ' + (pct >= 0 ? 'positive' : 'negative'); // CSS class toggles green/red color based on profit/loss
  document.getElementById('legendLev').textContent = `${signedDisplay}× LTAP`; // Update the chart legend to show current leverage and "LTAP" label

  document.getElementById('statMDD').textContent = (levStats.maxDD * 100).toFixed(1) + '%'; // Max drawdown displayed as percentage — always negative, -100% means liquidation
  document.getElementById('statSharpe').textContent = levStats.sharpe.toFixed(2); // Sharpe ratio to 2 decimal places — risk-adjusted return metric
  document.getElementById('statSharpe').className = 'stat-value ' + (levStats.sharpe > 0 ? 'positive' : 'negative'); // Green if positive Sharpe (risk-adjusted profit), red if negative (not worth the risk)

  const baseVol = baseLineStats.vol; // Annualized volatility of the unleveraged underlying — baseline for comparison
  const levVol = levStats.vol; // Annualized volatility of the LTAP leveraged position
  const volMultiple = baseVol > 0 ? levVol / baseVol : 0; // How many times more volatile the leveraged position is vs the base — e.g., 2.1× means 2.1x more volatile
  const volEl = document.getElementById('statVol'); // Volatility display element in the stats panel
  volEl.textContent = (levVol * 100).toFixed(1) + '% (' + volMultiple.toFixed(1) + '× base)'; // Show both absolute vol and the multiple for context
  if (volMultiple > 3) { // 3x+ vol multiple is dangerously high — color red as a warning
    volEl.className = 'stat-value negative';
  } else if (volMultiple > 2) { // 2x-3x vol multiple is elevated but manageable — amber warning
    volEl.style.color = '#ffd740';
    volEl.className = 'stat-value';
  } else { // Under 2x vol multiple is expected for reasonable leverage — no color warning
    volEl.className = 'stat-value';
    volEl.style.color = '';
  }
  document.getElementById('statCAGR').textContent = (levStats.cagr >= 0 ? '+' : '') + (levStats.cagr * 100).toFixed(1) + '%'; // CAGR with explicit plus sign for positive values
  document.getElementById('statCAGR').className = 'stat-value ' + (levStats.cagr >= 0 ? 'positive' : 'negative'); // Green/red coloring based on whether CAGR is positive or negative

  const feeDragEl = document.getElementById('statFeeDrag'); // Fee drag stat — shows how much performance the LTAP fees cost relative to a fee-free version
  if (levStats.liquidated && !noFeeStats.liquidated) { // FATAL: fees caused the liquidation that wouldn't have happened without them — fees were the difference between survival and death
    feeDragEl.textContent = 'FATAL';
    feeDragEl.style.color = '#ff5252'; // Bright red to highlight that fees were catastrophic in this scenario
  } else if (levStats.liquidated && noFeeStats.liquidated) { // Both versions liquidated — fee drag is irrelevant since the position dies regardless
    feeDragEl.textContent = 'N/A (liq)';
    feeDragEl.style.color = '#555970'; // Muted gray — not actionable information
  } else { // Normal case: both versions survive — show the percentage difference attributable to fees
    const feeDragPct = (noFeeStats.totalReturn - levStats.totalReturn) * 100; // Difference between no-fee and with-fee returns — always positive (fees always reduce returns)
    feeDragEl.textContent = '-' + Math.abs(feeDragPct).toFixed(1) + '%'; // Show as negative to indicate cost
    feeDragEl.style.color = ''; // Default color — fee drag is expected, not an alarm
  }

  const vsDaily = (levStats.totalReturn - dailyResetStats.totalReturn) * 100; // LTAP advantage over daily-reset (TQQQ-style) — positive means LTAP outperforms, which is the main selling point
  const vsDailyEl = document.getElementById('statVsDaily'); // Display element for the LTAP vs daily-reset comparison
  vsDailyEl.textContent = (vsDaily >= 0 ? '+' : '') + vsDaily.toFixed(1) + '%'; // Explicit plus sign when LTAP wins — makes the advantage immediately visible
  vsDailyEl.className = 'stat-value ' + (vsDaily >= 0 ? 'positive' : 'negative'); // Green when LTAP outperforms daily-reset — reinforces the protocol's value proposition

  document.getElementById('dynamicTicker').textContent = `${currentTicker} × ${signedDisplay}`; // Header ticker display — shows "QQQ × +2.0" to indicate current configuration
  document.getElementById('levDisplay').textContent = `${signedDisplay}×`; // Desktop leverage display next to the slider
  document.getElementById('mobileLevDisplay').textContent = `${signedDisplay}×`; // Mobile leverage display — duplicate because desktop and mobile have separate slider UIs

  document.getElementById('legendBase').textContent = `${currentTicker} (1×)`; // Chart legend for the gray base line — clarifies it's the unleveraged underlying
  document.getElementById('compBaseTicker').textContent = `${currentTicker} 1×`; // Comparison grid base ticker label
  document.getElementById('dataSourceTicker').textContent = currentTicker; // Data source indicator showing which ticker's data is being displayed
  
  // Update position entry leverage display
  const currentLevDisplay = document.getElementById('currentLevDisplay');
  if (currentLevDisplay) {
    currentLevDisplay.textContent = `${signedDisplay}×`;
  }

  const tickerNames = { // Human-readable names for all supported tickers — shown in the underlying name display so users know what they're backtesting
    'QQQ': 'QQQ (Nasdaq-100)', 'SPY': 'SPY (S&P 500)', // Primary LTAP products — index ETFs with deep liquidity
    'AAPL': 'AAPL (Apple)', 'NVDA': 'NVDA (NVIDIA)', 'TSLA': 'TSLA (Tesla)', // Mega-cap tech stocks — popular single-stock leverage candidates
    'SMH': 'SMH (Semiconductors ETF)', 'CEG': 'CEG (Constellation Energy)', // Sector plays — semiconductors and nuclear energy
    'DELL': 'DELL (Dell Technologies)', 'VRT': 'VRT (Vertiv)', 'SMCI': 'SMCI (Super Micro)', // AI infrastructure plays — high-vol stocks that benefit most from LTAP's anti-decay design
    'ANET': 'ANET (Arista Networks)', 'GEV': 'GEV (GE Vernova)', 'SMR': 'SMR (NuScale Power)', // Networking and energy infrastructure
    'KLAC': 'KLAC (KLA Corp)', 'LRCX': 'LRCX (Lam Research)', 'AMAT': 'AMAT (Applied Materials)', // Semiconductor equipment stocks — cyclical, good stress-test for auto-deleverage
    'TER': 'TER (Teradyne)', 'ETN': 'ETN (Eaton Corp)', 'PWR': 'PWR (Quanta Services)', // Industrial and infrastructure plays
    'APLD': 'APLD (Applied Digital)', 'SNDK': 'SNDK (Sandisk)', // Smaller-cap / higher-vol names
    'XLE': 'XLE (Energy Sector ETF)', 'XOP': 'XOP (Oil & Gas ETF)', // Energy sector ETFs — different vol profile than tech
    'ITA': 'ITA (Aerospace & Defense ETF)', 'VGK': 'VGK (Europe ETF)', // Defense and international exposure
    'VUG': 'VUG (Growth ETF)', 'VXUS': 'VXUS (Intl Stock ETF)', 'SGOV': 'SGOV (Treasury Bond ETF)', // Broad market and fixed income — low-vol options for conservative leverage
    'SLV': 'SLV (Silver Trust)', 'PPLT': 'PPLT (Platinum)', 'PALL': 'PALL (Palladium)', // Precious metals — commodity exposure with leverage
    'STRK': 'STRK (Strategy/MSTR)', 'BTGO': 'BTGO (BitGo)', // Crypto-adjacent equities — extremely high vol, maximum stress-test for the protocol
  };
  document.getElementById('underlyingName').textContent = tickerNames[currentTicker] || currentTicker; // Show full name if mapped, otherwise fall back to raw ticker symbol

  const fmt = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; // Format return as signed percentage — reusable formatter for the 4-column comparison grid
  const cls = v => v >= 0 ? 'positive' : 'negative'; // CSS class selector for green/red coloring — reusable across all comparison cells

  document.getElementById('compQQQ').textContent = fmt(baseLineStats.totalReturn); // Base (1x) return — the benchmark everything is measured against
  document.getElementById('compQQQ').className = 'comp-return ' + cls(baseLineStats.totalReturn); // Color the base return green/red

  document.getElementById('compLev').textContent = fmt(levStats.totalReturn); // LTAP protocol return — the main product performance
  document.getElementById('compLev').className = 'comp-return ' + cls(levStats.totalReturn); // Color based on profit/loss
  document.getElementById('compLevTicker').textContent = `${currentTicker} ${signedDisplay}× (Protocol)`; // Label with ticker and leverage for clarity — "(Protocol)" distinguishes from daily-reset

  document.getElementById('compDaily').textContent = fmt(dailyResetStats.totalReturn); // Daily-reset (TQQQ-style) return — the competitor product for comparison
  document.getElementById('compDaily').className = 'comp-return ' + cls(dailyResetStats.totalReturn); // Color based on profit/loss
  document.getElementById('compDailyTicker').textContent = `${currentTicker} ${signedDisplay}× (Daily)`; // "(Daily)" label distinguishes from LTAP protocol version

  document.getElementById('compNoFee').textContent = fmt(noFeeStats.totalReturn); // No-fee LTAP return — shows the theoretical maximum if fees were zero
  document.getElementById('compNoFee').className = 'comp-return ' + cls(noFeeStats.totalReturn); // Color based on profit/loss
  document.getElementById('compNoFeeTicker').textContent = `${currentTicker} ${signedDisplay}× (No Fees)`; // "(No Fees)" label clarifies this is a hypothetical comparison

  // Simulated fee/tranche economics removed — VaultSimple has no fees or junior tranche
  const annualFee = getLTAPFee(absMag); // kept for backtest comparison only
  const annualFeeEl = document.getElementById('annualFee');
  if (annualFeeEl) annualFeeEl.textContent = (annualFee * 100).toFixed(1) + '% APR';

  // Buffer health display removed — junior tranche not deployed in VaultSimple

  document.querySelectorAll('.notch-btn').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.lev) === currentLeverage)); // Highlight the quick-select leverage button that matches the current slider value

  const riskPct = Math.min(100, (absMag / 3.5) * 100); // Risk meter fill: 0x = 0%, 3.5x = 100% — linear mapping of leverage to risk bar width
  const rf = document.getElementById('riskFill'); // The colored fill element inside the risk meter bar
  rf.style.width = riskPct + '%'; // Set the fill width proportional to leverage magnitude

  let riskLabel = 'No Exposure'; // Default label for 0x leverage — changes based on leverage bands below
  if (absMag > 0 && absMag <= 1) { // Sub-1x leverage: conservative territory — less risk than holding the underlying outright
    riskLabel = isShort ? 'Conservative Short' : 'Conservative'; // Distinguish short from long at low leverage
    rf.style.background = 'var(--green)'; // Green = safe zone
  } else if (absMag > 1 && absMag <= 2) { // 1x-2x: moderate leverage — the sweet spot for most users
    riskLabel = 'Moderate';
    rf.style.background = 'var(--yellow)'; // Yellow = caution zone
  } else if (absMag > 2 && absMag <= 3) { // 2x-3x: aggressive — significant amplification of both gains and losses
    riskLabel = 'Aggressive';
    rf.style.background = 'var(--red)'; // Red = high risk zone
  } else if (absMag > 3) { // 3x+: maximum risk — near the protocol's leverage limit
    riskLabel = 'Maximum Risk';
    rf.style.background = 'var(--red)'; // Same red as aggressive — both are high risk
  }


  document.getElementById('riskText').textContent = riskLabel; // Display the risk category text below the meter
  document.getElementById('bufferReq').textContent = `Buffer: ${(requiredBuffer * 100).toFixed(0)}% junior ratio required`; // Show the minimum junior ratio needed for this leverage level

  if (levResult.stats) { // Display deleverage event statistics if the simulation produced them
    const delevEl = document.getElementById('statDelevEvents');
    delevEl.textContent = levResult.stats.totalDeleverageEvents; // Total deleverage events — high count means volatile period or aggressive leverage
    if (levResult.liquidated) {
      delevEl.style.color = '#ff0000';
      delevEl.style.fontWeight = '900';
    } else {
      delevEl.style.color = '';
      delevEl.style.fontWeight = '';
    }

    const reducedEl = document.getElementById('statReducedDays');
    reducedEl.textContent = levResult.stats.timeAtReducedLeverage; // Days at reduced leverage — shows how often auto-deleverage was active
    if (levResult.liquidated) {
      reducedEl.textContent = '💀 LIQUIDATED';
      reducedEl.style.color = '#ff0000';
      reducedEl.style.fontWeight = '900';
    } else {
      reducedEl.style.color = '';
      reducedEl.style.fontWeight = '';
    }
  } else { // No stats available (shouldn't happen, but defensive)
    document.getElementById('statDelevEvents').textContent = '0';
    document.getElementById('statReducedDays').textContent = '0';
  }
}

// ═══════════════════════════════════════════════════
// SLIDER
// Custom dual-direction leverage slider covering -4x to +4x.
// Built from scratch because HTML range inputs don't support
// bidirectional fill from center (0x) with color-coded
// green (long) and red (short) segments.
// ═══════════════════════════════════════════════════

const sliderTrack = document.getElementById('sliderTrack'); // Desktop slider track element — the clickable/draggable area
const sliderThumb = document.getElementById('sliderThumb'); // Desktop slider thumb/handle — positioned via CSS left percentage
const sliderFill = document.getElementById('sliderFill'); // Desktop slider fill — uses CSS gradient to show colored range from center to thumb
const mobileSliderTrack = document.getElementById('mobileSliderTrack'); // Mobile slider track — separate DOM element because mobile layout positions it differently
const mobileSliderThumb = document.getElementById('mobileSliderThumb'); // Mobile slider thumb — mirrors desktop thumb position
const mobileSliderFill = document.getElementById('mobileSliderFill'); // Mobile slider fill — mirrors desktop fill gradient

/**
 * Snap a raw leverage value to clean increments for display and simulation.
 * Normal mode snaps to 0.1 steps (e.g., 1.3, 1.4); degen mode snaps to integers.
 *
 * @param {number} raw — Raw leverage value from slider position calculation
 * @returns {number} Snapped leverage value
 */
function snapLeverage(raw) { // Snap leverage to clean increments — prevents awkward values like 1.37x
  if (isDegenMode) {
    return Math.round(raw); // Degen mode: snap to whole numbers (10x, 25x, etc.) — 0.25 steps are meaningless at 100x
  } else {
// Snap to 0.1 increments for finer control
    return Math.round(raw * 10) / 10;
  }
}

/**
 * Update the visual position, fill gradient, and display text of both desktop
 * and mobile leverage sliders. Uses a CSS gradient that fills from the center
 * (0x) to the thumb position: green for long, red for short.
 *
 * @param {number} lev — Current leverage value (negative = short, positive = long)
 */
function setSliderPos(lev) { // Update the visual position and colors of both desktop and mobile sliders to match the given leverage value
  const pct = (lev - MIN_LEV) / (MAX_LEV - MIN_LEV); // Convert leverage value to 0-1 percentage position on the slider track
  const thumbPct = pct * 100; // Convert to CSS percentage for positioning
  const centerPct = (0 - MIN_LEV) / (MAX_LEV - MIN_LEV) * 100; // Position of 0x (center) on the slider — at 50% since range is -4 to +4

  sliderThumb.style.left = thumbPct + '%'; // Move desktop thumb to the correct position
  mobileSliderThumb.style.left = thumbPct + '%'; // Move mobile thumb to match

  let gradient; // CSS gradient fills the track from center (0x) to the thumb position with direction-appropriate colors
  if (lev >= 0) { // Long position: fill from center rightward with green-to-purple gradient
    gradient = `linear-gradient(90deg,
      #555970 0%,
      #555970 ${centerPct}%,
      #00e676 ${centerPct}%,
      #7c4dff ${thumbPct}%,
      #555970 ${thumbPct}%,
      #555970 100%)`; // Gray on both sides of the colored range — inactive portion of the track
  } else { // Short position: fill from thumb leftward to center with red gradient
    gradient = `linear-gradient(90deg,
      #555970 0%,
      #555970 ${thumbPct}%,
      #ff5252 ${thumbPct}%,
      #ff8a80 ${centerPct}%,
      #555970 ${centerPct}%,
      #555970 100%)`; // Red gradient from thumb to center — visually distinct from the green long fill
  }

  sliderFill.style.background = gradient; // Apply the gradient to the desktop slider fill element
  sliderFill.style.width = '100%'; // Fill spans the entire track width — the gradient handles the visual segmentation
  mobileSliderFill.style.background = gradient; // Mirror the same gradient on mobile
  mobileSliderFill.style.width = '100%'; // Same full-width fill on mobile

  const displayLev = Math.abs(lev).toFixed(1); // Format leverage for display — always positive with explicit sign added separately
  document.getElementById('mobileLevDisplay').textContent = (lev < 0 ? '-' : '') + displayLev + '×'; // Update mobile leverage readout with sign and multiplication symbol
}

let isDragging = false; // Tracks whether a slider is currently being dragged
let currentSlider = null; // Reference to the active slider element (desktop or mobile)

/**
 * Begin a slider drag interaction. Sets the active slider reference
 * and immediately updates leverage to the click/touch position.
 *
 * @param {HTMLElement} slider — The slider track element being interacted with
 * @param {number} clientX — Horizontal pixel position of the click/touch
 */
function handleSliderStart(slider, clientX) { // Begin drag — sets active slider and immediately updates leverage to click position
  isDragging = true;
  currentSlider = slider;
  updateLeverageFromPosition(slider, clientX);
}

/**
 * Convert a pixel position on the slider track to a leverage value,
 * snap it to clean increments, update the slider visuals, and re-render the chart.
 *
 * @param {HTMLElement} slider — The slider track element (used for bounding rect)
 * @param {number} clientX — Horizontal pixel position
 */
function updateLeverageFromPosition(slider, clientX) { // Convert pixel position to leverage value and update everything
  const rect = slider.getBoundingClientRect();
  const x = clientX - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width)); // Clamp to [0,1] to prevent out-of-bounds values
  const raw = MIN_LEV + pct * (MAX_LEV - MIN_LEV); // Map percentage to leverage range
  currentLeverage = snapLeverage(raw);
  setSliderPos(currentLeverage);
  updateAll();
}

/**
 * Document-level mouse/touch move handler for smooth slider dragging.
 * Continues updating leverage even when the cursor moves outside the track bounds.
 *
 * @param {MouseEvent|TouchEvent} e — Mouse or touch move event
 */
function handleSliderMove(e) { // Document-level move handler for smooth dragging outside track bounds
  if (!isDragging || !currentSlider) return;
  e.preventDefault(); // Prevent page scrolling on mobile while dragging
  const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
  updateLeverageFromPosition(currentSlider, clientX);
}

/**
 * End slider drag interaction. Resets dragging state so subsequent
 * mouse/touch moves no longer update leverage.
 */
function handleSliderEnd() { // Release drag — stop updating leverage on move events
  isDragging = false;
  currentSlider = null;
}

// Desktop slider — mousedown starts drag immediately on click
sliderTrack.addEventListener('mousedown', (e) => {
  e.preventDefault();
  handleSliderStart(sliderTrack, e.clientX);
});

// Mobile slider — separate track element but same behavior
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

// Global move/end handlers — listening on document so drag works even when cursor leaves the track
document.addEventListener('mousemove', handleSliderMove);
document.addEventListener('touchmove', handleSliderMove, { passive: false });
document.addEventListener('mouseup', handleSliderEnd);
document.addEventListener('touchend', handleSliderEnd);

// Chart click handler for backtesting entry point selection — lets users answer "what if I entered on this date?"
chart.subscribeClick((param) => { // TradingView's click callback provides the time/price at the clicked point
  if (!param.time) return; // Click was outside the data area (e.g., on the price scale) — ignore

  const { data } = getFiltered(currentPeriod); // Get the current period's data to find the index of the clicked date
  const clickedIndex = data.findIndex(d => d.time === param.time); // Find which bar the user clicked on — matches by date string

  if (clickedIndex >= 0) { // Valid data point clicked — set it as the new backtest entry point
    entryDateIndex = clickedIndex; // Update the entry index — updateAll() will slice the data from this point
    updateAll(); // Re-render everything from the new entry point — chart, stats, and comparison grid all update
  }
});

// Double-click to reset entry to start — intuitive UX pattern (single click = set, double click = reset)
chartEl.addEventListener('dblclick', () => { // Listen on the chart container element for double-click events
  if (entryDateIndex !== 0) { // Only reset if entry is not already at the start — avoids unnecessary re-renders
    entryDateIndex = 0; // Reset to the beginning of the selected period
    updateAll(); // Re-render with full period data
  }
});

// Wallet connection is handled by Reown AppKit (appkit-button web component) — no click handler needed here, the web component manages its own UI

document.querySelectorAll('.ticker-select-btn').forEach(b => b.addEventListener('click', async () => { // Ticker selection buttons (QQQ, SPY, etc.) — each loads different historical data
  if (b.dataset.ticker === currentTicker) return; // Already on this ticker — skip the expensive data reload
  document.querySelectorAll('.ticker-select-btn').forEach(x => x.classList.remove('active')); // Deactivate all ticker buttons before activating the clicked one — radio button behavior
  b.classList.add('active'); // Highlight the selected ticker button
  currentTicker = b.dataset.ticker; // Update the global ticker state — used by updateAll() and data loading
  await loadTickerData(currentTicker); // Fetch/cache the new ticker's data and re-render — async because it may hit the network
}));
document.querySelectorAll('.notch-btn').forEach(b => b.addEventListener('click', () => { currentLeverage = parseFloat(b.dataset.lev); setSliderPos(currentLeverage); updateAll(); })); // Quick-select leverage buttons (1x, 2x, 3x, etc.) — set leverage, update slider position, and re-render in one click
document.querySelectorAll('.tf-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.tf-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); currentPeriod = b.dataset.period; entryDateIndex = 0; updateAll(); })); // Timeframe buttons (1M, 1Y, 5Y, etc.) — switch period, reset entry point to start of new period, and re-render
document.querySelectorAll('.chart-type-btn[data-type]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.chart-type-btn[data-type]').forEach(x => x.classList.remove('active')); b.classList.add('active'); currentChartType = b.dataset.type; updateAll(); })); // Chart type toggle (area/candlestick/line) — changes which series type is rendered without recomputing data

// ═══════════════════════════════════════════════════
// TRANCHE SELECTOR (Senior/Junior) — Mads' Junior LP UI
// ═══════════════════════════════════════════════════

const seniorBtn = document.getElementById('seniorBtn');
const juniorBtn = document.getElementById('juniorBtn');
if (seniorBtn && juniorBtn) {
  seniorBtn.addEventListener('click', () => {
    document.getElementById('seniorView').style.display = 'grid';
    document.getElementById('juniorView').style.display = 'none';
    seniorBtn.classList.add('active');
    juniorBtn.classList.remove('active');
  });

  juniorBtn.addEventListener('click', async () => {
    document.getElementById('seniorView').style.display = 'none';
    document.getElementById('juniorView').style.display = 'block';
    seniorBtn.classList.remove('active');
    juniorBtn.classList.add('active');

    // Refresh junior UI data
    if (connectedAddress && publicClient) {
      await updateJuniorUI();
    }
  });
}

// Junior LP Tab Switching (Deposit/Withdraw)
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
const howItWorksBtn = document.getElementById('howItWorksBtn');
if (howItWorksBtn) {
  howItWorksBtn.addEventListener('click', () => {
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
}

// ═══════════════════════════════════════════════════
// DEGEN MODE TOGGLE — switches between ±4x and ±100x leverage
// ═══════════════════════════════════════════════════

document.getElementById('degenModeBtn').addEventListener('click', () => {
  // Block degen mode in production — only allow on localhost/dev environments
  const isLocal = ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname) || window.location.hostname.startsWith('192.168.');
  if (!isLocal && !isDegenMode) {
    if (window.showToast) showToast('Degen mode is disabled in production', 'error');
    else if (window.XToast) XToast.show('Degen mode is disabled in production', 'error', 3000);
    console.warn('Degen mode blocked: production environment');
    return;
  }

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

/**
 * Swap slider labels and quick-select notch buttons for degen mode range (-100x to +100x).
 * Replaces the normal -4x to +4x labels and re-wires click handlers on the new buttons.
 */
function updateDegenModeUI() { // Swap slider labels and notch buttons for degen range
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
      });
    });
  });
}

/**
 * Restore slider labels and quick-select notch buttons to normal mode range (-4x to +4x).
 * Replaces degen mode labels and re-wires click handlers on the standard buttons.
 */
function updateNormalModeUI() { // Restore slider labels and notch buttons to normal range
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

new ResizeObserver(() => { // Watch the chart container for size changes — triggers on window resize, sidebar toggle, or any layout shift
  const r = chartEl.getBoundingClientRect(); // Get the current pixel dimensions of the chart container
  chart.applyOptions({ width: r.width, height: r.height }); // Tell TradingView to resize its canvas to match — without this, the chart would clip or leave gaps on resize
}).observe(chartEl); // Observe the chart element specifically — more reliable than window.onresize because it catches all sources of size change

// ═══════════════════════════════════════════════════
// LIVE / RESEARCH MODE MANAGEMENT
// Splits the UI into two states:
//   - LIVE: all economics from contract reads + oracle feeds
//   - RESEARCH: simulation/backtest engine (existing behavior)
// ═══════════════════════════════════════════════════

let currentMode = 'live'; // Default to live mode — show real protocol state

/**
 * Switch between Live and Research modes in the trading terminal UI.
 * Live mode shows real-time contract/oracle data with polling.
 * Research mode shows the backtest/simulation engine.
 * Toggles visibility of mode-specific panels and starts/stops live polling.
 *
 * @param {'live'|'research'} mode — The mode to activate
 */
function setMode(mode) {
  currentMode = mode;

  // Update toggle buttons
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });

  // Show/hide mode-specific panels
  document.querySelectorAll('.live-only').forEach(el => {
    el.style.display = mode === 'live' ? '' : 'none';
  });
  document.querySelectorAll('.research-only').forEach(el => {
    el.style.display = mode === 'research' ? '' : 'none';
  });

  // In live mode, hide the timeframe/chart-type toolbar (no backtest)
  const toolbar = document.querySelector('.chart-toolbar');
  if (toolbar) {
    toolbar.style.display = mode === 'live' ? 'none' : '';
  }

  if (mode === 'live') {
    // Start polling live state if not already running
    if (window.liveState) {
      window.liveState.startLivePolling(onLiveStateUpdate);
    }
  } else {
    // Stop live polling, run backtest simulation
    if (window.liveState) {
      window.liveState.stopLivePolling();
    }
    updateAll(); // re-render research/simulation view
  }
}

/**
 * Render live protocol state into the UI.
 * All values come from contract reads + Pyth oracle — no browser math.
 */
function onLiveStateUpdate(state) {
  if (currentMode !== 'live') return;

  const econ = window.liveState.getLiveEconomics(currentTicker);
  if (!econ) return;

  // ── Live stats bar (below chart) ──
  const fmtUSD = (v) => v != null ? '$' + v.toLocaleString(undefined, {maximumFractionDigits: 0}) : '—';
  const fmtBps = (v) => v != null ? (v / 100).toFixed(2) + '%' : '—';

  const oraclePrice = econ.pythPrice || econ.displayPrice;
  document.getElementById('liveOraclePrice').textContent = oraclePrice != null
    ? '$' + Number(oraclePrice).toFixed(2)
    : '—';

  const oracleStatusEl = document.getElementById('liveOracleStatus');
  if (econ.oracleCircuitBroken) {
    oracleStatusEl.textContent = 'CIRCUIT BROKEN';
    oracleStatusEl.className = 'stat-value negative';
  } else if (econ.oracleFresh === false) {
    oracleStatusEl.textContent = 'STALE';
    oracleStatusEl.className = 'stat-value negative';
  } else if (econ.oracleFresh === true) {
    oracleStatusEl.textContent = 'FRESH';
    oracleStatusEl.className = 'stat-value positive';
  } else {
    oracleStatusEl.textContent = '—';
    oracleStatusEl.className = 'stat-value';
  }

  document.getElementById('liveFundingRate').textContent = fmtBps(econ.fundingRateBps);
  document.getElementById('liveMaxLeverage').textContent = econ.maxLeverage != null
    ? econ.maxLeverage.toFixed(1) + '×'
    : '—';

  const protoStateEl = document.getElementById('liveProtocolState');
  protoStateEl.textContent = econ.protocolStateLabel;
  if (econ.protocolStateLabel === 'NORMAL') {
    protoStateEl.className = 'stat-value positive';
  } else if (econ.protocolStateLabel === 'EMERGENCY') {
    protoStateEl.className = 'stat-value negative';
  } else {
    protoStateEl.className = 'stat-value';
    protoStateEl.style.color = '#ffd740';
  }

  document.getElementById('liveNetExposure').textContent = fmtUSD(econ.netExposure);
  document.getElementById('livePoolTVL').textContent = fmtUSD(econ.totalPool);
  document.getElementById('liveDataSource').textContent = econ.source || 'contract';

  // Live buffer tranche panel removed — junior tranche not deployed in VaultSimple

  // ── Live data source info ──
  const rpcInfo = document.getElementById('liveRpcInfo');
  const cacheInfo = document.getElementById('liveCacheInfo');
  if (rpcInfo && state.rpc) rpcInfo.textContent = 'RPC: ' + state.rpc;
  if (cacheInfo && state.cacheAge != null) cacheInfo.textContent = 'Cache age: ' + state.cacheAge.toFixed(0) + 's';
}

// ── Mode toggle event listeners ──
document.getElementById('liveModeBtn').addEventListener('click', () => setMode('live'));
document.getElementById('researchModeBtn').addEventListener('click', () => setMode('research'));

// Initialize in live mode on load
setMode('live');
