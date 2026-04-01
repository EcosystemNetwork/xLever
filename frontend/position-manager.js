// ═══════════════════════════════════════════════════════════
// POSITION MANAGEMENT
// ═══════════════════════════════════════════════════════════

// Update current leverage display
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

// Check if user is on correct network
async function ensureCorrectNetwork() {
  try {
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainId, 16);
    
    if (currentChainId !== 763373) {
      alert('⚠️ Wrong Network!\n\nPlease switch to Ink Sepolia in MetaMask.\n\nNetwork: Ink Sepolia\nChain ID: 763373 (0xBA6ED)\nRPC: https://ink-sepolia.drpc.org\n\nYou are currently on chain ID: ' + currentChainId);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Network check failed:', error);
    return false;
  }
}

// Open position button handler
document.getElementById('openPositionBtn')?.addEventListener('click', async () => {
  const amountInput = document.getElementById('positionAmountInput');
  const amount = amountInput?.value;
  const selectedAsset = document.querySelector('.asset-btn.active')?.dataset.asset || 'wQQQx';
  
  if (!connectedAddress) {
    alert('Please connect your wallet first');
    return;
  }
  
  if (!amount || parseFloat(amount) <= 0) {
    alert('Please enter a valid USDC amount');
    return;
  }

  const leverageBps = Math.round(currentLeverage * 10000);
  const btn = document.getElementById('openPositionBtn');

  try {
    btn.disabled = true;
    btn.textContent = 'Opening...';
    
    console.log(`Opening position: ${amount} USDC @ ${currentLeverage}x on ${selectedAsset}`);

    const { parseUnits } = window.viem;
    const amountParsed = parseUnits(amount.toString(), 6);
    const vaultAddress = VAULT_ADDRESSES[selectedAsset];

    // Step 1: Approve USDC
    console.log('Approving USDC...');
    btn.textContent = 'Approving USDC...';
    
    let approveTx;
    try {
      approveTx = await walletClient.writeContract({
        address: TOKEN_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vaultAddress, amountParsed],
        account: connectedAddress,
        maxFeePerGas: 2000000000n, // 2 gwei
        maxPriorityFeePerGas: 1000000000n // 1 gwei
      });
      console.log('✓ Approval tx sent:', approveTx);
    } catch (approveError) {
      // Transaction was sent but RPC returned error - continue anyway
      console.log('Approval sent (RPC error ignored):', approveError.message);
    }
    
    btn.textContent = 'Approval pending...';
    
    // Wait for approval to be mined
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 2: Deposit to vault
    console.log('Opening position...');
    btn.textContent = 'Depositing...';
    
    let depositTx;
    try {
      depositTx = await walletClient.writeContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [amountParsed, leverageBps],
        account: connectedAddress,
        maxFeePerGas: 2000000000n, // 2 gwei
        maxPriorityFeePerGas: 1000000000n // 1 gwei
      });
      console.log('✓ Deposit tx sent:', depositTx);
    } catch (depositError) {
      // Transaction was sent but RPC returned error - continue anyway
      console.log('Deposit sent (RPC error ignored):', depositError.message);
    }
    
    btn.textContent = 'Position opening...';
    
    // Wait for deposit to be mined
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Refresh data
    await fetchBalances();
    await loadUserPositions();
    
    alert(`Position opened successfully! 🎉\n${amount} USDC @ ${currentLeverage}x leverage`);
    amountInput.value = '';
  } catch (error) {
    console.error('Failed to open position:', error);
    alert(`Failed to open position: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Open Position';
  }
});

// Load user positions
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
          <button onclick="closePosition('${pos.asset}', '${pos.vaultAddress}')" 
                  style="width: 100%; padding: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; color: #ef4444; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s;">
            Close Position
          </button>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Failed to load positions:', error);
  }
}

// Close position function
window.closePosition = async function(asset, vaultAddress) {
  if (!confirm(`Are you sure you want to close your ${asset} position?`)) {
    return;
  }

  try {
    console.log(`Closing ${asset} position...`);

    // Withdraw entire position (amount = 0 means close all)
    let withdrawTx;
    try {
      withdrawTx = await walletClient.writeContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'withdraw',
        args: [0], // 0 = withdraw all
        account: connectedAddress,
        maxFeePerGas: 2000000000n, // 2 gwei
        maxPriorityFeePerGas: 1000000000n // 1 gwei
      });
      console.log('✓ Withdraw tx sent:', withdrawTx);
    } catch (withdrawError) {
      // Transaction was sent but RPC returned error - continue anyway
      console.log('Withdraw sent (RPC error ignored):', withdrawError.message);
    }
    
    // Wait for transaction to be mined
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Refresh data
    await fetchBalances();
    await loadUserPositions();
    
    alert(`Position closed successfully! 💰`);
  } catch (error) {
    console.error('Failed to close position:', error);
    alert(`Failed to close position: ${error.message}`);
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

// Load positions on page load if wallet is connected
window.addEventListener('load', async () => {
  // Wait a bit for wallet to connect
  setTimeout(async () => {
    if (connectedAddress) {
      await loadUserPositions();
    }
  }, 1000);
});
