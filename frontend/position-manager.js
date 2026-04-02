/**
 * @file position-manager.js — Position Tracking and PnL Management
 *
 * Manages the lifecycle of leveraged positions on xLever vaults:
 *   - Asset selection (wSPYx/wQQQx) with synced ticker buttons
 *   - Network validation (Ink Sepolia chain ID 763373)
 *   - Opening positions via contracts.js with real-time tx status updates
 *   - Loading and displaying active positions from on-chain state
 *   - Closing positions with Pyth oracle integration
 *
 * All transaction flows are receipt-driven (no hardcoded waits for correctness).
 * Button state transitions track the full tx lifecycle: approving -> submitted -> pending -> confirmed/failed.
 *
 * @module position-manager
 *
 * @dependencies
 *   - window.xLeverContracts (contracts.js) for on-chain operations
 *   - window.showToast or XToast for user notifications
 *   - window.viem for formatUnits
 *   - Global vars: connectedAddress, publicClient, currentLeverage, VAULT_ADDRESSES, VAULT_ABI
 *   - Functions: fetchBalances (from app.js)
 */

// Local escapeHTML — prevents XSS in innerHTML templates.
// Mirrors app.js escapeHTML but defined locally so this file has no load-order dependency.
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════
// POSITION MANAGEMENT — receipt-driven, no hardcoded waits
// ═══════════════════════════════════════════════════════════

/**
 * Update the leverage display element with the current leverage value.
 * Reads from the global `currentLeverage` variable set by the leverage slider.
 */
function updateCurrentLevDisplay() {
  const display = document.getElementById('currentLevDisplay');
  if (display) {
    display.textContent = `${currentLeverage.toFixed(1)}×`;
  }
}

// Asset selection button handlers
document.addEventListener('DOMContentLoaded', () => {
  const assetButtons = document.querySelectorAll('.asset-btn');
  const tickerButtons = document.querySelectorAll('.ticker-select-btn');

  // Function to update asset selection
  function selectAsset(assetCode) {
    // Update asset buttons
    assetButtons.forEach(b => {
      const isActive = b.dataset.asset === assetCode;
      b.classList.toggle('active', isActive);
      b.style.background = isActive ? 'rgba(102, 126, 234, 0.2)' : 'rgba(255,255,255,0.05)';
      b.style.borderColor = isActive ? 'rgba(102, 126, 234, 0.5)' : 'rgba(255,255,255,0.1)';
      b.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.6)';
    });

    // Update ticker buttons (top left)
    const ticker = assetCode === 'wSPYx' ? 'SPY' : 'QQQ';
    tickerButtons.forEach(b => {
      b.classList.toggle('active', b.dataset.ticker === ticker);
    });

    console.log('Selected asset:', assetCode);
  }

  // Asset button click handlers
  assetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const assetCode = btn.dataset.asset;
      const ticker = assetCode === 'wSPYx' ? 'SPY' : 'QQQ';

      // Find and click the corresponding ticker button to trigger chart update
      const tickerBtn = Array.from(tickerButtons).find(b => b.dataset.ticker === ticker);
      if (tickerBtn && !tickerBtn.classList.contains('active')) {
        tickerBtn.click(); // This will trigger app.js's chart update
      }

      // Update asset buttons
      assetButtons.forEach(b => {
        const isActive = b.dataset.asset === assetCode;
        b.classList.toggle('active', isActive);
        b.style.background = isActive ? 'rgba(102, 126, 234, 0.2)' : 'rgba(255,255,255,0.05)';
        b.style.borderColor = isActive ? 'rgba(102, 126, 234, 0.5)' : 'rgba(255,255,255,0.1)';
        b.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.6)';
      });

      console.log('Selected asset:', assetCode);
    });
  });

  // When ticker buttons are clicked, also update asset buttons
  // Note: app.js already handles the chart update for ticker buttons
  tickerButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const assetCode = btn.dataset.ticker === 'SPY' ? 'wSPYx' : 'wQQQx';

      // Update asset buttons to match
      assetButtons.forEach(b => {
        const isActive = b.dataset.asset === assetCode;
        b.classList.toggle('active', isActive);
        b.style.background = isActive ? 'rgba(102, 126, 234, 0.2)' : 'rgba(255,255,255,0.05)';
        b.style.borderColor = isActive ? 'rgba(102, 126, 234, 0.5)' : 'rgba(255,255,255,0.1)';
        b.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.6)';
      });

      console.log('Selected asset from ticker:', assetCode);
    });
  });
});

/**
 * Check if the user's wallet is connected to Ink Sepolia (chain ID 763373).
 * Shows a warning toast if on the wrong network.
 * @returns {Promise<boolean>} True if on the correct network
 */
async function ensureCorrectNetwork() {
  try {
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainId, 16);

    const SUPPORTED = { 763373: 'Ink Sepolia', 11155111: 'Ethereum Sepolia' };
    if (!SUPPORTED[currentChainId]) {
      showToast(`Wrong Network!\n\nPlease switch to Ink Sepolia or Ethereum Sepolia.\n\nCurrent: ${currentChainId}`, 'warning', 6000);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Network check failed:', error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// TX STATUS HELPER — updates button text with lifecycle state
// ═══════════════════════════════════════════════════════════

/**
 * Update a button's text to reflect the current transaction lifecycle state.
 * @param {HTMLButtonElement} btn - The button element to update
 * @param {string} state - Lifecycle state: 'approving'|'submitted'|'pending'|'confirmed'|'failed'|'rejected'|'depositing'|'withdrawing'
 * @param {Object} [extra] - Additional context (e.g., {attempt, maxRetries} for pending state)
 */
function setButtonState(btn, state, extra) {
  if (!btn) return;
  const labels = {
    approving:  'Approving USDC...',
    submitted:  'Tx Submitted...',
    pending:    extra ? `Confirming (${extra.attempt + 1}/${extra.maxRetries + 1})...` : 'Confirming...',
    confirmed:  'Confirmed!',
    failed:     'Transaction Failed',
    rejected:   'Rejected by Wallet',
    depositing: 'Depositing...',
    withdrawing:'Withdrawing...',
  };
  btn.textContent = labels[state] || state;
}

// ═══════════════════════════════════════════════════════════
// OPEN POSITION — receipt-driven via contracts.js API
// ═══════════════════════════════════════════════════════════

document.getElementById('openPositionBtn')?.addEventListener('click', async () => {
  const amountInput = document.getElementById('positionAmountInput');
  const amount = amountInput?.value;
  const selectedAsset = document.querySelector('.asset-btn.active')?.dataset.asset || 'wQQQx';

  if (!connectedAddress) {
    showToast('Please connect your wallet first', 'warning');
    return;
  }

  if (!amount || parseFloat(amount) <= 0) {
    showToast('Please enter a valid USDC amount', 'warning');
    return;
  }

  const contracts = window.xLeverContracts;
  if (!contracts) {
    showToast('Contracts not loaded', 'error');
    return;
  }

  const btn = document.getElementById('openPositionBtn');
  const leverageBps = Math.round(currentLeverage * 10000);

  // Subscribe to tx lifecycle events for real-time button updates
  const unsubs = [];
  unsubs.push(contracts.txEvents.on('submitted', ({ hash, explorerUrl }) => {
    setButtonState(btn, 'submitted');
    showToast(`Tx submitted — ${hash.slice(0, 10)}...`, 'pending', 0);
  }));
  unsubs.push(contracts.txEvents.on('pending', (data) => {
    setButtonState(btn, 'pending', data);
  }));

  try {
    btn.disabled = true;
    setButtonState(btn, 'approving');

    // Set the active asset so contracts.js uses the correct vault
    const ticker = selectedAsset === 'wSPYx' ? 'SPY' : 'QQQ';
    contracts.setActiveAsset(ticker);

    console.log(`Opening position: ${amount} USDC @ ${currentLeverage}x on ${selectedAsset}`);

    // contracts.openPosition handles: allowance check → approve → deposit → waitForTx
    // All receipt polling and retry logic is in contracts.js
    const result = await contracts.openPosition(amount.toString(), currentLeverage);

    setButtonState(btn, 'confirmed');

    // Refresh from confirmed chain state (not polling)
    await fetchBalances();
    await loadUserPositions();
    contracts.txEvents.emit('synced', { hash: result.hash, explorerUrl: result.explorerUrl, state: 'synced' });

    const explorerLink = result.explorerUrl || contracts.getExplorerUrl(result.hash);
    showToast(`Position opened! ${amount} USDC @ ${currentLeverage}x\nTx: ${result.hash.slice(0, 10)}...`, 'success', 6000);
    amountInput.value = '';
  } catch (error) {
    console.error('Failed to open position:', error);
    const classified = contracts.classifyTxError(error);
    if (classified.type === 'wallet_rejected') {
      setButtonState(btn, 'rejected');
      showToast('Transaction rejected in wallet', 'warning');
    } else {
      setButtonState(btn, 'failed');
      showToast(`${classified.label}: ${classified.detail}`, 'error', 8000);
    }
  } finally {
    // Cleanup lifecycle listeners
    unsubs.forEach(fn => fn());
    // Reset button after brief delay so user sees the final state
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Open Position';
    }, 1500);
  }
});

/**
 * Load all active user positions from both vault contracts (wSPYx, wQQQx).
 * Renders position cards with deposit amount, leverage, direction, and close button.
 * Shows "no positions" placeholder if the user has no active positions.
 * @returns {Promise<void>}
 */
async function loadUserPositions() {
  if (!connectedAddress || !publicClient) {
    document.getElementById('noPositions').style.display = 'block';
    document.getElementById('positionsList').style.display = 'none';
    return;
  }

  try {
    const positions = [];

    // Check positions in both vaults
    for (const [asset, vaultAddress] of Object.entries(VAULT_ADDRESSES)) {
      try {
        const position = await publicClient.readContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName: 'getPosition',
          args: [connectedAddress]
        });

        if (position.isActive && position.depositAmount > 0) {
          positions.push({
            asset,
            vaultAddress,
            ...position
          });
        }
      } catch (error) {
        console.error(`Error loading ${asset} position:`, error);
      }
    }

    if (positions.length === 0) {
      document.getElementById('noPositions').style.display = 'block';
      document.getElementById('positionsList').style.display = 'none';
      return;
    }

    // Display positions
    document.getElementById('noPositions').style.display = 'none';
    document.getElementById('positionsList').style.display = 'block';

    if (!window.viem) {
      console.error('window.viem not loaded yet — cannot render positions');
      return;
    }
    const { formatUnits } = window.viem;
    const positionsList = document.getElementById('positionsList');

    positionsList.innerHTML = positions.map(pos => {
      const depositAmount = formatUnits(pos.depositAmount, 6);
      const leverage = (pos.leverageBps / 10000).toFixed(2);
      const isLong = pos.leverageBps > 0;
      const isShort = pos.leverageBps < 0;

      // Convert wSPYx/wQQQx to SPY/QQQ for display
      const displayName = pos.asset === 'wSPYx' ? 'SPY' : pos.asset === 'wQQQx' ? 'QQQ' : pos.asset;

      return `
        <div class="position-card" style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.08);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div>
              <div style="font-size: 16px; font-weight: 600; color: #fff;">${displayName}</div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 4px;">
                ${depositAmount} USDC
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 20px; font-weight: 700; color: ${isLong ? '#10b981' : isShort ? '#ef4444' : '#6b7280'};">
                ${leverage}×
              </div>
              <div style="font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px;">
                ${isLong ? 'LONG' : isShort ? 'SHORT' : 'NEUTRAL'}
              </div>
            </div>
          </div>
          <button data-close-asset="${escapeHTML(pos.asset)}" data-close-vault="${escapeHTML(pos.vaultAddress)}"
                  style="width: 100%; padding: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; color: #ef4444; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
            Close Position
          </button>
        </div>
      `;
    }).join('');

    // Attach close handlers via event delegation (no inline onclick — XSS-safe)
    positionsList.querySelectorAll('[data-close-asset]').forEach(btn => {
      btn.addEventListener('click', () => {
        closePosition(btn.dataset.closeAsset, btn.dataset.closeVault);
      });
    });

  } catch (error) {
    console.error('Failed to load positions:', error);
  }
}

// ═══════════════════════════════════════════════════════════
// CLOSE POSITION — receipt-driven via contracts.js API
// ═══════════════════════════════════════════════════════════

window.closePosition = async function(asset, vaultAddress) {
  if (!confirm(`Are you sure you want to close your ${asset} position?`)) {
    return;
  }

  const contracts = window.xLeverContracts;
  if (!contracts) {
    showToast('Contracts not loaded', 'error');
    return;
  }

  // Show pending toast that persists until we dismiss it
  const pendingToast = showToast('Closing position...', 'pending', 0);

  try {
    console.log(`Closing ${asset} position...`);

    // Read position to get the amount
    const position = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'getPosition',
      args: [connectedAddress]
    });

    if (!position.isActive || position.depositAmount === 0n) {
      if (pendingToast) XToast.dismiss(pendingToast);
      showToast('No active position to close', 'warning');
      return;
    }

    // Set the correct asset so contracts.js uses the right vault
    const ticker = asset === 'wSPYx' ? 'SPY' : asset === 'wQQQx' ? 'QQQ' : asset;
    contracts.setActiveAsset(ticker);

    // Listen for tx events to update the pending toast
    const unsubs = [];
    unsubs.push(contracts.txEvents.on('submitted', ({ hash, explorerUrl }) => {
      if (pendingToast) {
        const statusEl = pendingToast.querySelector('span:last-child');
        if (statusEl) statusEl.textContent = `Tx submitted: ${hash.slice(0, 10)}...`;
      }
    }));
    unsubs.push(contracts.txEvents.on('pending', ({ attempt, maxRetries }) => {
      if (pendingToast) {
        const statusEl = pendingToast.querySelector('span:last-child');
        if (statusEl) statusEl.textContent = `Confirming (${attempt + 1}/${maxRetries + 1})...`;
      }
    }));

    // Simulation skipped — canonical Vault requires Pyth priceUpdateData + msg.value
    // which can't be reliably simulated client-side. contracts.closePosition handles
    // Pyth update, slippage (minReceived=0), and error classification.

    // Use formatUnits to get the USDC string for contracts.closePosition
    if (!window.viem) {
      showToast('Libraries not loaded yet — please try again', 'error');
      return;
    }
    const { formatUnits } = window.viem;
    const amountStr = formatUnits(position.depositAmount, 6);

    // contracts.closePosition handles: Pyth update → writeContract → waitForTx with retries
    const result = await contracts.closePosition(amountStr);

    unsubs.forEach(fn => fn());
    if (pendingToast) XToast.dismiss(pendingToast);

    // Refresh from confirmed chain state
    await fetchBalances();
    await loadUserPositions();
    contracts.txEvents.emit('synced', { hash: result.hash, explorerUrl: result.explorerUrl, state: 'synced' });

    const explorerLink = result.explorerUrl || contracts.getExplorerUrl(result.hash);
    showToast(`Position closed! Tx: ${result.hash.slice(0, 10)}...`, 'success', 6000);
  } catch (error) {
    if (pendingToast) XToast.dismiss(pendingToast);
    console.error('Failed to close position:', error);
    const classified = contracts.classifyTxError(error);
    if (classified.type === 'wallet_rejected') {
      showToast('Close rejected in wallet', 'warning');
    } else {
      showToast(`${classified.label}: ${classified.detail}`, 'error', 8000);
    }
  }
};

// Auto-load positions when wallet connects
if (window.ethereum) {
  window.ethereum.on('accountsChanged', async (accounts) => {
    if (accounts.length > 0) {
      await loadUserPositions();
    }
  });
}

// Load positions when wallet connects (event-driven, no fixed delay)
// connectedAddress is set by app.js after wallet init completes.
// The 'appkit:connected' custom event (or accountsChanged above) fires
// when the wallet is ready — no setTimeout needed.
window.addEventListener('appkit:connected', async () => {
  if (connectedAddress) {
    await loadUserPositions();
  }
});
// Fallback: if wallet was already connected before this script loaded
window.addEventListener('load', () => {
  if (connectedAddress) {
    loadUserPositions();
  }
});
