/**
 * xLever Consumer-Grade UX Layer
 * Transaction modals, toast notifications, skeleton loading, interactive controls
 */
// This file provides polished UX primitives so the trading interface feels like a fintech app, not a raw dApp

// Sanitize strings before interpolation into innerHTML to prevent XSS
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════

// IIFE module pattern keeps toast state private so nothing else can corrupt the container reference
const XToast = (() => {
  // Holds the single DOM container for all toasts; null until first use to avoid DOM work on import
  let container = null;

  // Lazily creates the fixed-position toast container the first time a toast is shown
  function init() {
    // Skip if already initialized to prevent duplicate containers
    if (container) return;
    // Create a dedicated container div rather than appending toasts directly to body
    container = document.createElement('div');
    // ID allows external CSS targeting if someone needs to override toast positioning
    container.id = 'x-toast-container';
    // Fixed positioning so toasts stay visible during scroll; top:72px clears the app header bar
    // pointer-events:none lets clicks pass through the container gap areas to the page beneath
    // flex-column + gap stacks multiple toasts with consistent spacing
    container.style.cssText = `
      position: fixed; top: 72px; right: 20px; z-index: 9999;
      display: flex; flex-direction: column; gap: 8px;
      pointer-events: none; max-width: 380px;
    `;
    // Append to body so it sits above all app content in the stacking context
    document.body.appendChild(container);
  }

  // Creates and displays a toast notification, returns the element so callers can dismiss it manually
  function show(message, type = 'info', duration = 4000) {
    // Ensure container exists before trying to append a toast
    init();
    // Each toast is its own div so they can animate and be dismissed independently
    const toast = document.createElement('div');
    // Color map ties each toast type to a distinct visual identity so users instantly recognize severity
    const colors = {
      success: { bg: '#00e676', icon: 'check_circle', text: '#003918' },   // Green for completed actions
      error:   { bg: '#ff5252', icon: 'error', text: '#fff' },             // Red for failures
      warning: { bg: '#ffd740', icon: 'warning', text: '#1a1d26' },        // Amber for caution states
      info:    { bg: '#7c4dff', icon: 'info', text: '#fff' },              // Purple (brand color) for neutral info
      pending: { bg: '#1f1f23', icon: 'hourglass_top', text: '#e3e2e6' },  // Dark for in-progress transactions
    };
    // Fall back to info style if an unknown type is passed, preventing undefined errors
    const c = colors[type] || colors.info;

    // Inline styles because toasts are injected dynamically and can't rely on pre-loaded CSS classes
    // translateX(120%) starts the toast off-screen right so it can slide in
    // pointer-events:auto re-enables clicks on the toast itself (container has them disabled)
    toast.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      background: ${type === 'pending' ? '#1f1f23' : c.bg};
      color: ${c.text}; padding: 12px 16px; border-radius: 6px;
      font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600;
      pointer-events: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      transform: translateX(120%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid ${type === 'pending' ? '#494455' : 'transparent'};
    `;
    // Uses Google Material Symbols for icons; pending type gets a spin animation to indicate ongoing work
    // flex:1 on the message span lets it fill remaining space and wrap text naturally
    toast.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:18px;${type === 'pending' ? 'animation:spin 1s linear infinite;' : ''}">${c.icon}</span>
      <span style="flex:1">${escapeHTML(message)}</span>
    `;
    // Add to DOM before animating so the browser can compute the initial off-screen position
    container.appendChild(toast);
    // requestAnimationFrame ensures the initial translateX(120%) is painted before transitioning to 0
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

    // Auto-dismiss after duration; duration=0 means the toast persists (used for pending states)
    if (duration > 0) {
      setTimeout(() => dismiss(toast), duration);
    }
    // Return the element so callers (e.g., pending toasts) can dismiss it when the operation completes
    return toast;
  }

  // Slides the toast off-screen then removes it from DOM after the CSS transition finishes
  function dismiss(toast) {
    // Slide back off-screen to the right, mirroring the entrance animation
    toast.style.transform = 'translateX(120%)';
    // 300ms matches the CSS transition duration so the element is removed only after it's visually gone
    setTimeout(() => toast.remove(), 300);
  }

  // Expose only the public API; container and internals stay private
  return { show, dismiss, init };
})();


// ═══════════════════════════════════════════════════════════════
// TRANSACTION CONFIRMATION MODAL
// ═══════════════════════════════════════════════════════════════

// IIFE module pattern isolates modal state so only one modal can exist at a time
const XModal = (() => {
  // Tracks the current overlay element; null when no modal is open
  let overlay = null;

  // Builds the full-screen backdrop that dims the page and centers the modal card
  function createOverlay() {
    // Remove any stale overlay to guarantee only one modal is visible
    if (overlay) overlay.remove();
    // Create a fresh overlay div each time rather than reusing, to reset all internal state
    overlay = document.createElement('div');
    // ID for potential external CSS hooks or testing selectors
    overlay.id = 'x-modal-overlay';
    // inset:0 stretches to fill viewport; backdrop-filter:blur prevents interaction with background
    // z-index:10000 sits above toasts (9999) so the modal always takes focus
    // Starts transparent for a fade-in entrance animation
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.2s ease;
    `;
    // Click-outside-to-close: only triggers if the click lands on the overlay itself, not the modal card
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    // Append to body so it overlays the entire page
    document.body.appendChild(overlay);
    // requestAnimationFrame ensures the opacity:0 is painted before transitioning to 1
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    // Return the overlay so callers can append the modal card into it
    return overlay;
  }

  // Fades out the overlay then removes it from DOM, cleaning up the reference
  function close() {
    // Guard against double-close calls
    if (!overlay) return;
    // Trigger the fade-out transition
    overlay.style.opacity = '0';
    // Wait for the CSS transition to finish before removing the element
    setTimeout(() => { overlay?.remove(); overlay = null; }, 200);
  }

  // Renders the trade confirmation modal with position details and action buttons
  function confirmTrade(details) {
    // Create the backdrop overlay first
    const ov = createOverlay();
    // Determine direction from leverage sign so we can color-code the entire modal
    const isLong = details.leverage > 0;
    // Green for long, red for short -- consistent with financial convention
    const sideColor = isLong ? '#00e676' : '#ff5252';
    // Human-readable direction label for the UI
    const sideLabel = isLong ? 'LONG' : 'SHORT';
    // Absolute value for display since direction is shown separately via color/label
    const leverageAbs = Math.abs(details.leverage).toFixed(1);

    // The modal card itself, styled to match the dark xLever theme
    const modal = document.createElement('div');
    // Dark card with subtle border; width capped at 420px but responsive via max-width
    // Starts slightly scaled down and shifted for a pop-in entrance animation
    modal.style.cssText = `
      background: #12141a; border: 1px solid #252833; border-radius: 10px;
      width: 420px; max-width: 92vw; overflow: hidden;
      transform: scale(0.95) translateY(10px);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    // Animate to full size after initial paint
    requestAnimationFrame(() => { modal.style.transform = 'scale(1) translateY(0)'; });

    // Full modal HTML as a template literal for fast rendering
    // The modal is divided into: header, asset info, details grid, risk badges, and action buttons
    modal.innerHTML = `
      <div style="padding: 20px 24px; border-bottom: 1px solid #252833; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <!-- Modal title tells user this is a review step, not a final submission -->
          <div style="font-family:'DM Sans',sans-serif; font-size:15px; font-weight:700; color:#e3e2e6;">Confirm Position</div>
          <!-- Subtitle reinforces that no action has been taken yet -->
          <div style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-top:2px;">Review before submitting</div>
        </div>
        <!-- Close button in the header corner for quick dismissal -->
        <button id="x-modal-close" style="background:none; border:none; cursor:pointer; color:#555970; padding:4px;">
          <span class="material-symbols-outlined" style="font-size:20px;">close</span>
        </button>
      </div>

      <div style="padding: 24px;">
        <!-- Asset + Direction Header: icon, asset name, and leverage badge give an at-a-glance summary -->
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
          <!-- Direction icon with tinted background reinforces long/short visually -->
          <div style="width:44px;height:44px;border-radius:8px;background:${sideColor}15;display:flex;align-items:center;justify-content:center;">
            <span class="material-symbols-outlined" style="color:${sideColor};font-size:22px;">${isLong ? 'trending_up' : 'trending_down'}</span>
          </div>
          <div>
            <!-- Asset ticker (e.g., QQQ, SPY) as the primary identifier -->
            <div style="font-family:'Space Grotesk',sans-serif; font-size:20px; font-weight:700; color:#e3e2e6;">${escapeHTML(details.asset)}</div>
            <div style="display:flex; gap:8px; align-items:center; margin-top:2px;">
              <!-- Color-coded LONG/SHORT badge so direction is unmistakable -->
              <span style="font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:700; color:${sideColor}; background:${sideColor}15; padding:2px 8px; border-radius:3px;">${sideLabel}</span>
              <!-- Leverage multiplier displayed next to direction for full context -->
              <span style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#8b8fa3;">${leverageAbs}x Leverage</span>
            </div>
          </div>
        </div>

        <!-- Details Grid: key numbers in a 2x2 grid for easy scanning before confirmation -->
        <div style="background:#0d0e11; border:1px solid #252833; border-radius:6px; padding:16px; margin-bottom:16px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <!-- Position Size = the actual USDC the user is depositing -->
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Position Size</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#e3e2e6;">$${details.size.toLocaleString()}</div>
            </div>
            <div>
              <!-- Effective Exposure = size * leverage, the notional value at risk -->
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Effective Exposure</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#7c4dff;">$${(details.size * Math.abs(details.leverage)).toLocaleString()}</div>
            </div>
            <div>
              <!-- Entry Price so the user knows the TWAP they're entering at -->
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Entry Price</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#e3e2e6;">${details.price}</div>
            </div>
            <div>
              <!-- Annual Fee so the user understands the cost of holding this leveraged position -->
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Annual Fee</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#e3e2e6;">${details.fee}</div>
            </div>
          </div>
        </div>

        <!-- Risk Summary: two badges highlighting xLever's key differentiators -->
        <div style="display:flex; gap:8px; margin-bottom:20px;">
          <!-- No-liquidation badge reassures users about xLever's socialized-risk model -->
          <div style="flex:1; background:#00e67610; border:1px solid #00e67630; border-radius:5px; padding:10px 12px; text-align:center;">
            <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#00e676; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">No Liquidation</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#00e676; font-weight:600;">Risk Socialized</div>
          </div>
          <!-- LTAP Protocol badge identifies the strategy type for transparency -->
          <div style="flex:1; background:#7c4dff10; border:1px solid #7c4dff30; border-radius:5px; padding:10px 12px; text-align:center;">
            <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#7c4dff; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Strategy</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#cdbdff; font-weight:600;">LTAP Protocol</div>
          </div>
        </div>

        <!-- Action Buttons: cancel (secondary) and confirm (primary, color-coded to direction) -->
        <div id="x-modal-actions" style="display:flex; gap:10px;">
          <!-- Cancel button is subdued so the primary action (confirm) draws the eye -->
          <button id="x-modal-cancel" style="
            flex:1; padding:14px; border-radius:6px; font-family:'DM Sans',sans-serif;
            font-size:13px; font-weight:700; cursor:pointer; transition:all 0.2s;
            background:none; border:1px solid #252833; color:#8b8fa3;
          ">Cancel</button>
          <!-- Confirm button is 2x wider (flex:2) and colored to match direction so it's unmissable -->
          <button id="x-modal-confirm" style="
            flex:2; padding:14px; border-radius:6px; font-family:'DM Sans',sans-serif;
            font-size:13px; font-weight:700; cursor:pointer; transition:all 0.2s;
            background:${sideColor}; border:none; color:${isLong ? '#003918' : '#fff'};
            text-transform:uppercase; letter-spacing:1px;
          ">Confirm ${sideLabel} Position</button>
        </div>
      </div>
    `;

    // Mount the modal card inside the overlay
    ov.appendChild(modal);

    // Wire up all dismiss triggers: X button, cancel button, and confirm button
    modal.querySelector('#x-modal-close').addEventListener('click', close);
    modal.querySelector('#x-modal-cancel').addEventListener('click', close);
    // Confirm transitions to the transaction progress view instead of closing
    modal.querySelector('#x-modal-confirm').addEventListener('click', () => {
      showTransactionProgress(modal, details, sideColor, isLong);
    });
  }

  // Replaces the modal buttons with a progress spinner, then shows success/failure
  async function showTransactionProgress(modal, details, sideColor, isLong) {
    // Grab the button container so we can replace its contents with progress UI
    const actionsEl = modal.querySelector('#x-modal-actions');
    // Reconstruct the side label since it's needed for status messages
    const sideLabel = isLong ? 'LONG' : 'SHORT';
    // Check if the real contract adapter is available (set by contracts.js on window)
    const contracts = window.xLeverContracts;
    // Determines whether to execute a real on-chain tx or run the simulated demo flow
    const isLive = contracts && contracts.ADDRESSES.vault;

    // Replace action buttons with a spinner and status text
    actionsEl.innerHTML = `
      <div style="width:100%; text-align:center; padding:8px 0;">
        <!-- CSS-animated spinner colored to match the position direction -->
        <div id="x-tx-spinner" style="margin:0 auto 12px; width:36px; height:36px; border:3px solid #252833; border-top:3px solid ${sideColor}; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <!-- Primary status line updated as the transaction progresses through stages -->
        <div style="font-family:'DM Sans',sans-serif; font-size:14px; font-weight:600; color:#e3e2e6;" id="x-tx-status">Submitting Transaction...</div>
        <!-- Secondary status line for more granular progress detail -->
        <div style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#555970; margin-top:4px;" id="x-tx-sub">Waiting for wallet signature</div>
      </div>
    `;

    // Helper to update the two status text elements without re-rendering the whole section
    const updateStatus = (status, sub) => {
      // Query by ID each time because the elements were injected via innerHTML
      const statusEl = document.getElementById('x-tx-status');
      const subEl = document.getElementById('x-tx-sub');
      // Null-check in case the modal was closed mid-transaction
      if (statusEl) statusEl.textContent = status;
      if (subEl) subEl.textContent = sub;
    };

    // Will hold the transaction hash from either the real or simulated path
    let txHash = null;
    // Will hold the block explorer URL if this was a real on-chain transaction
    let explorerUrl = null;

    if (isLive) {
      // ─── REAL TRANSACTION PATH ───
      // Executes actual on-chain calls via the contracts adapter
      try {
        // First step: approve USDC spend (vault needs allowance before deposit)
        updateStatus('Approving USDC...', 'Waiting for wallet signature');
        // Second step: submit the leveraged deposit transaction
        updateStatus('Opening Position...', 'Confirm in your wallet');
        // Call the contract adapter which handles approve + deposit + Pyth oracle update
        const result = await contracts.openPosition(
          details.size.toString(),
          details.leverage
        );
        // Store the real transaction hash for the success screen
        txHash = result.hash;
        // Build the block explorer link so users can verify on-chain
        explorerUrl = contracts.getExplorerUrl(txHash);
      } catch (err) {
        // ─── ERROR STATE ─── show failure UI with the error message
        actionsEl.innerHTML = `
          <div style="width:100%; text-align:center; padding:8px 0;">
            <!-- Red error icon makes failure immediately obvious -->
            <div style="width:48px; height:48px; border-radius:50%; background:#ff525215; display:flex; align-items:center; justify-content:center; margin:0 auto 12px;">
              <span class="material-symbols-outlined" style="color:#ff5252; font-size:28px;">error</span>
            </div>
            <div style="font-family:'DM Sans',sans-serif; font-size:14px; font-weight:700; color:#ff5252;">Transaction Failed</div>
            <!-- Show the specific error so users (or support) can diagnose the issue -->
            <div style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#555970; margin-top:4px; max-width:340px; word-break:break-all;">${escapeHTML(err.shortMessage || err.message)}</div>
            <!-- Close button lets user dismiss the error and try again -->
            <button id="x-modal-done" style="display:block; width:100%; margin-top:16px; padding:12px; border-radius:6px; font-family:'DM Sans',sans-serif; font-size:13px; font-weight:700; cursor:pointer; background:#1f1f23; border:1px solid #252833; color:#e3e2e6;">Close</button>
          </div>
        `;
        // Wire up the close button
        document.getElementById('x-modal-done')?.addEventListener('click', close);
        // Also show a toast so the error is visible even if the modal is dismissed
        XToast.show('Transaction failed: ' + (err.shortMessage || err.message), 'error');
        // Exit early -- don't show the success state
        return;
      }
    } else {
      // ─── SIMULATED PATH (no vault deployed yet) ───
      // Provides a realistic-feeling demo when the vault contract isn't deployed
      const steps = [
        // Each step simulates a real transaction lifecycle stage with realistic timing
        { delay: 1200, status: 'Signing Transaction...', sub: 'Confirming in wallet' },
        { delay: 2400, status: 'Broadcasting to Network...', sub: 'Tx submitted, awaiting confirmation' },
        { delay: 3800, status: 'Confirming on Chain...', sub: 'Block confirmation 1/2' },
      ];
      // Walk through each simulated step with timed delays
      for (const step of steps) {
        // Calculate incremental delay between steps (not absolute) so timing feels natural
        await new Promise(r => setTimeout(r, step.delay - (steps.indexOf(step) > 0 ? steps[steps.indexOf(step)-1].delay : 0)));
        // Update the status text to show the current simulated stage
        updateStatus(step.status, step.sub);
      }
      // Final pause before showing success, simulating block confirmation time
      await new Promise(r => setTimeout(r, 1200));
      // Generate a fake tx hash so the success UI has something to display
      txHash = '0x' + generateFakeHash();
    }

    // ─── SUCCESS STATE ───
    // Build the transaction hash display -- clickable link for real txs, plain text for simulated
    const txDisplay = explorerUrl
      ? `<a href="${explorerUrl}" target="_blank" style="color:#7c4dff; text-decoration:underline;">Tx: ${txHash.slice(0, 10)}...${txHash.slice(-6)}</a>`
      : `Tx: ${txHash}`;

    // Replace the spinner with the success confirmation UI
    actionsEl.innerHTML = `
      <div style="width:100%; text-align:center; padding:8px 0;">
        <!-- Filled check circle icon signals completion; colored to match the position direction -->
        <div style="width:48px; height:48px; border-radius:50%; background:${sideColor}15; display:flex; align-items:center; justify-content:center; margin:0 auto 12px;">
          <span class="material-symbols-outlined" style="color:${sideColor}; font-size:28px; font-variation-settings:'FILL' 1;">check_circle</span>
        </div>
        <!-- Clear success headline -->
        <div style="font-family:'DM Sans',sans-serif; font-size:16px; font-weight:700; color:#e3e2e6;">Position Opened</div>
        <!-- Recap the position details so user can verify what was executed -->
        <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#8b8fa3; margin-top:4px;">
          ${escapeHTML(details.asset)} ${sideLabel} ${Math.abs(details.leverage).toFixed(1)}x &middot; $${details.size.toLocaleString()}
        </div>
        <!-- Transaction hash in a pill for quick copy/reference -->
        <div style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#555970; margin-top:8px; background:#0d0e11; padding:6px 12px; border-radius:4px; display:inline-block;">
          ${txDisplay}
        </div>
        <!-- Badge indicates whether this was a real on-chain tx or a simulated demo -->
        ${isLive ? `<div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#00e676; margin-top:6px;">VERIFIED ON-CHAIN</div>` : `<div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#ffd740; margin-top:6px;">SIMULATED (vault not deployed)</div>`}
        <!-- Done button to dismiss the modal and return to the main UI -->
        <button id="x-modal-done" style="
          display:block; width:100%; margin-top:16px; padding:12px; border-radius:6px;
          font-family:'DM Sans',sans-serif; font-size:13px; font-weight:700;
          cursor:pointer; background:#1f1f23; border:1px solid #252833; color:#e3e2e6;
          transition:all 0.2s;
        ">Done</button>
      </div>
    `;
    // Wire up the done button to close the modal
    document.getElementById('x-modal-done')?.addEventListener('click', close);
    // Show a success toast so the notification persists even after the modal is closed
    XToast.show(`${escapeHTML(details.asset)} ${sideLabel} position opened successfully`, 'success');
  }

  // Generates a short random hex string to simulate a transaction hash in demo mode
  function generateFakeHash() {
    // 8 random hex chars + ellipsis to mimic a truncated real hash
    return Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + '...';
  }

  // Expose only confirmTrade and close; internal helpers stay private
  return { confirmTrade, close };
})();


// ═══════════════════════════════════════════════════════════════
// WALLET CONNECTION (Reown AppKit)
// ═══════════════════════════════════════════════════════════════

// IIFE module for wallet connection state; delegates actual wallet management to Reown AppKit
const XWallet = (() => {
  // Sets up event listeners for wallet connect/disconnect to show toast notifications
  function init() {
    // Reown AppKit is initialized via wallet.js ES module (loaded separately)
    // The <appkit-button /> web component handles the connect/disconnect UI natively
    // This module only listens for events to provide toast feedback
    const checkModal = () => {
      // xLeverWallet is set on window by wallet.js once Reown AppKit is ready
      const modal = window.xLeverWallet;
      // Retry with polling because wallet.js loads asynchronously and may not be ready yet
      if (!modal) return setTimeout(checkModal, 200);

      // Subscribe to Reown AppKit events to show user-friendly toast notifications
      // Track whether wallet was already connected on page load to avoid
      // showing the toast for automatic session restoration
      let wasConnectedOnInit = modal.getIsConnected();
      let lastConnectShown = 0;
      modal.subscribeEvents((event) => {
        // Notify user on successful wallet connection (debounce to avoid repeated toasts)
        if (event?.data?.event === 'CONNECT_SUCCESS') {
          if (wasConnectedOnInit) {
            wasConnectedOnInit = false;
            return;
          }
          const now = Date.now();
          if (now - lastConnectShown > 5000) {
            lastConnectShown = now;
            XToast.show('Wallet connected successfully', 'success');
          }
        }
        // Notify user when wallet is disconnected
        if (event?.data?.event === 'DISCONNECT_SUCCESS') {
          XToast.show('Wallet disconnected', 'info');
        }
      });
    };
    // Start the polling loop to find the wallet modal
    checkModal();
  }

  // Returns whether a wallet is currently connected, used by UI to gate trade actions
  function isConnected() {
    // Delegate to Reown AppKit's connection state
    const modal = window.xLeverWallet;
    // Return false if AppKit hasn't loaded yet to prevent premature trade attempts
    return modal ? modal.getIsConnected() : false;
  }

  // Returns the connected wallet address, used to query on-chain position data
  function getAddress() {
    // Delegate to Reown AppKit's address getter
    const modal = window.xLeverWallet;
    // Return null if not connected so callers can handle the no-wallet case
    return modal ? modal.getAddress() : null;
  }

  // Public API for wallet state queries and initialization
  return { init, isConnected, getAddress };
})();


// ═══════════════════════════════════════════════════════════════
// INTERACTIVE LEVERAGE SLIDER
// ═══════════════════════════════════════════════════════════════

// IIFE module encapsulating the -4x to +4x leverage slider with drag, click, and button controls
const XLeverage = (() => {
  // Default leverage; 2.0x long is a reasonable starting point for most users
  let currentLeverage = 2.0;
  // DOM element references cached after init to avoid repeated querySelector calls
  let sliderTrack = null;
  let sliderHandle = null;
  let sliderFill = null;
  let displayEl = null;
  // Tracks whether user is actively dragging the slider handle
  let isDragging = false;

  // Wires up all slider DOM elements and event listeners
  function init() {
    // Find the slider track element; if absent, the page doesn't have a leverage slider
    sliderTrack = document.querySelector('.leverage-slider-track');
    // Exit early if no slider on this page (e.g., junior tranche deposit view)
    if (!sliderTrack) return;

    // Cache child elements for the draggable handle and the colored fill bar
    sliderHandle = sliderTrack.querySelector('.leverage-handle');
    sliderFill = sliderTrack.querySelector('.leverage-fill');
    // Numeric display element showing the current leverage value (e.g., "+2.0")
    displayEl = document.getElementById('leverage-display');

    // Wire up the quick-select preset buttons (e.g., -4x, -2x, +2x, +4x)
    document.querySelectorAll('[data-leverage]').forEach(btn => {
      btn.addEventListener('click', () => {
        // Read the leverage value from the data attribute and snap to it
        setLeverage(parseFloat(btn.dataset.leverage));
      });
    });

    // Set up drag handling for mouse and touch on the slider handle
    if (sliderHandle) {
      // mousedown/touchstart initiate dragging
      sliderHandle.addEventListener('mousedown', startDrag);
      sliderHandle.addEventListener('touchstart', startDrag, { passive: false });
      // mousemove/touchmove on document (not handle) so dragging works even when cursor leaves the handle
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('touchmove', onDrag, { passive: false });
      // mouseup/touchend on document to catch release anywhere on the page
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchend', stopDrag);
    }

    // Allow clicking directly on the track to jump to that leverage value
    sliderTrack.addEventListener('click', (e) => {
      // Ignore track clicks during a drag to prevent accidental jumps
      if (isDragging) return;
      // Calculate the click position as a percentage of the track width
      const rect = sliderTrack.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      // Map 0-1 percentage to the -4 to +4 leverage range
      const lev = -4 + pct * 8; // -4 to +4 range
      // Snap to nearest 0.5 increment for cleaner values on click
      setLeverage(Math.round(lev * 2) / 2); // snap to 0.5
    });

    // Set initial visual state to match the default leverage
    updateVisuals();
  }

  // Called when user presses down on the slider handle to begin dragging
  function startDrag(e) {
    // Prevent text selection and default touch behaviors during drag
    e.preventDefault();
    // Flag that we're in drag mode so onDrag and stopDrag know to act
    isDragging = true;
    // Scale up the handle to give tactile feedback that it's been grabbed
    sliderHandle.style.transform = 'translate(-50%, -50%) scale(1.3)';
  }

  // Called on every mouse/touch move while dragging to update the leverage value
  function onDrag(e) {
    // Only process move events when actively dragging
    if (!isDragging) return;
    // Prevent page scroll on mobile while dragging the slider
    e.preventDefault();
    // Normalize touch and mouse events to get the X coordinate
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    // Calculate position relative to the track element
    const rect = sliderTrack.getBoundingClientRect();
    // Compute percentage along the track, clamped to 0-1
    let pct = (clientX - rect.left) / rect.width;
    // Clamp to prevent dragging beyond the track boundaries
    pct = Math.max(0, Math.min(1, pct));
    // Convert percentage to the -4 to +4 leverage range
    const lev = -4 + pct * 8;
    // Snap to 0.25 increments while dragging for finer control than click (0.5)
    setLeverage(Math.round(lev * 4) / 4); // snap to 0.25
  }

  // Called when user releases the slider handle
  function stopDrag() {
    // Only act if we were actually dragging
    if (!isDragging) return;
    // Clear the drag flag
    isDragging = false;
    // Restore the handle to its normal size, ending the "grabbed" visual feedback
    if (sliderHandle) sliderHandle.style.transform = 'translate(-50%, -50%) scale(1)';
  }

  // Sets the leverage value, clamped to the allowed -4x to +4x range, and updates all UI
  function setLeverage(val) {
    // Clamp to the protocol's max leverage range to prevent invalid positions
    currentLeverage = Math.max(-4, Math.min(4, val));
    // Update all visual elements (slider, display, risk meter, button) to reflect the new value
    updateVisuals();
    // Update the fee display since annual fee scales with leverage
    updateOrderDetails();
  }

  // Syncs all visual elements to the current leverage value
  function updateVisuals() {
    // Convert leverage to a 0-100% position along the slider track
    const pct = (currentLeverage + 4) / 8 * 100; // 0% = -4x, 50% = 0x, 100% = +4x
    // Determine direction for color coding
    const isLong = currentLeverage > 0;
    const isShort = currentLeverage < 0;
    // Green for long, red for short, gray for neutral -- financial convention
    const color = isLong ? '#00e676' : isShort ? '#ff5252' : '#494455';

    // Position and color the draggable handle on the track
    if (sliderHandle) {
      // Set horizontal position as percentage of track width
      sliderHandle.style.left = pct + '%';
      // Color the handle to match the current direction
      sliderHandle.style.backgroundColor = color;
      // White border for contrast against the dark track
      sliderHandle.style.borderColor = '#fff';
    }

    // Update the colored fill bar that stretches from center (0x) to the handle position
    if (sliderFill) {
      if (currentLeverage >= 0) {
        // Long: fill grows rightward from the center (50%) mark
        sliderFill.style.left = '50%';
        sliderFill.style.width = (pct - 50) + '%';
        sliderFill.style.backgroundColor = '#00e676';
      } else {
        // Short: fill grows leftward from the center mark to the handle
        sliderFill.style.left = pct + '%';
        sliderFill.style.width = (50 - pct) + '%';
        sliderFill.style.backgroundColor = '#ff5252';
      }
    }

    // Update the numeric leverage display (e.g., "+2.0" or "-3.0")
    if (displayEl) {
      // Add explicit "+" prefix for positive values so direction is always clear
      const sign = currentLeverage > 0 ? '+' : '';
      displayEl.textContent = `${sign}${currentLeverage.toFixed(1)}`;
      // Color the number to match the direction
      displayEl.style.color = color;
    }

    // Highlight the quick-select button that matches the current leverage value
    document.querySelectorAll('[data-leverage]').forEach(btn => {
      const val = parseFloat(btn.dataset.leverage);
      // Use small epsilon comparison to handle floating point imprecision
      const isActive = Math.abs(val - currentLeverage) < 0.01;
      // Active button gets the direction color and bold weight
      btn.style.color = isActive ? color : '';
      btn.style.fontWeight = isActive ? '800' : '';
    });

    // Update the risk meter segments to reflect leverage magnitude
    updateRiskMeter();

    // Update the "Open Position" button text and color based on direction
    updatePositionButton();
  }

  // Colors the risk meter segments to indicate how risky the current leverage is
  function updateRiskMeter() {
    // Each segment represents a leverage tier: 1x, 2x, 3x, 4x
    const segments = document.querySelectorAll('.risk-segment');
    // Use absolute leverage to determine risk level regardless of direction
    const absLev = Math.abs(currentLeverage);
    // Map continuous leverage to a discrete 1-4 risk tier
    const level = absLev <= 1 ? 1 : absLev <= 2 ? 2 : absLev <= 3 ? 3 : 4;

    // Color segments up to the current risk level, leave the rest dark
    segments.forEach((seg, i) => {
      if (i < level) {
        // Progressive color ramp: blue (low) -> green -> yellow -> red (high)
        const colors = ['#448aff', '#00e676', '#ffd740', '#ff5252'];
        seg.style.backgroundColor = colors[i];
      } else {
        // Inactive segments stay dark to show unused risk capacity
        seg.style.backgroundColor = '#1f1f23';
      }
    });
  }

  // Updates the main "Open Position" button to reflect the current leverage direction
  function updatePositionButton() {
    // Find the submit button by ID
    const btn = document.getElementById('open-position-btn');
    // Exit if the button doesn't exist on this page
    if (!btn) return;

    // Determine the current direction state
    const isLong = currentLeverage > 0;
    const isShort = currentLeverage < 0;
    const isNeutral = currentLeverage === 0;

    if (isNeutral) {
      // At 0x leverage, disable the button since a 0x position is meaningless
      btn.textContent = 'Select Leverage';
      btn.style.backgroundColor = '#1f1f23';
      btn.style.color = '#555970';
      btn.disabled = true;
    } else {
      // Label the button with the direction so the action is unambiguous
      const label = isLong ? 'Open Long Position' : 'Open Short Position';
      btn.textContent = label;
      // Green background for long, red for short -- matching the rest of the UI
      btn.style.backgroundColor = isLong ? '#00e676' : '#ff5252';
      // Dark text on green (long) for readability, white text on red (short)
      btn.style.color = isLong ? '#003918' : '#fff';
      // Enable the button since we have a valid leverage value
      btn.disabled = false;
    }
  }

  // Updates the annual fee display based on the current leverage magnitude
  function updateOrderDetails() {
    // Find the fee display element
    const feeEl = document.getElementById('annual-fee-display');
    if (feeEl) {
      // Fee scales with leverage: base 0.5% at 1x, +0.5% per additional 1x
      const absLev = Math.abs(currentLeverage);
      // No fee at 0x leverage; otherwise compute the tiered fee rate
      const fee = absLev <= 0 ? 0 : (0.5 + 0.5 * (absLev - 1)).toFixed(1);
      // Display as annual percentage rate
      feeEl.textContent = `${fee}% APR`;
    }
  }

  // Expose init and a getter for the current leverage value
  return { init, getLeverage: () => currentLeverage };
})();


// ═══════════════════════════════════════════════════════════════
// SKELETON LOADING
// ═══════════════════════════════════════════════════════════════

// IIFE module for skeleton loading placeholders shown while data is being fetched
const XSkeleton = (() => {
  // Replaces a container's content with animated skeleton placeholder rows
  function show(selector, count = 3) {
    // Find the target container to skeleton-ize
    const target = document.querySelector(selector);
    // Exit if the selector doesn't match any element
    if (!target) return;
    // Add a class so CSS can apply container-level skeleton styles
    target.classList.add('x-skeleton-container');

    // Generate randomized-width skeleton blocks to mimic the shape of real content
    const rows = Array.from({ length: count }, () => `
      <div class="x-skeleton-row">
        <!-- Each block has a random width to avoid the "loading wall" effect and look like real data -->
        <div class="x-skeleton-block" style="width:${20 + Math.random()*30}%"></div>
        <div class="x-skeleton-block" style="width:${15 + Math.random()*20}%"></div>
        <div class="x-skeleton-block" style="width:${10 + Math.random()*15}%"></div>
      </div>
    `).join('');

    // Stash the original HTML so we can restore it when loading completes
    target.dataset.originalContent = target.innerHTML;
    // Replace content with skeleton placeholders
    target.innerHTML = rows;
  }

  // Restores the original content that was replaced by skeleton placeholders
  function hide(selector) {
    // Find the target container
    const target = document.querySelector(selector);
    // Exit if the element doesn't exist or was never skeleton-ized
    if (!target || !target.dataset.originalContent) return;
    // Restore the original HTML content
    target.innerHTML = target.dataset.originalContent;
    // Clean up the stashed content to free memory
    delete target.dataset.originalContent;
    // Remove the skeleton class since we're back to real content
    target.classList.remove('x-skeleton-container');
  }

  // Public API for showing and hiding skeleton loading states
  return { show, hide };
})();


// ═══════════════════════════════════════════════════════════════
// GLOBAL STYLES INJECTION
// ═══════════════════════════════════════════════════════════════

// Self-executing function injects CSS that can't live in static stylesheets because it supports dynamically-created elements
(function injectStyles() {
  // Create a style element to hold all injected CSS rules
  const style = document.createElement('style');
  // Template literal for the CSS content, covering animations and component styles
  style.textContent = `
    /* Spin animation used by pending toast icons and transaction spinners */
    @keyframes spin { to { transform: rotate(360deg); } }
    /* Shimmer animation creates the moving highlight effect on skeleton loading blocks */
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    /* Fade-in-up animation for skeleton rows appearing in sequence */
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Skeleton row layout: flexbox with gaps to mimic tabular data */
    .x-skeleton-row {
      display: flex; gap: 12px; padding: 12px 0;
      animation: fadeInUp 0.3s ease;
    }
    /* Individual skeleton block: gradient background with shimmer animation for the loading effect */
    .x-skeleton-block {
      height: 14px; border-radius: 4px;
      background: linear-gradient(90deg, #1f1f23 25%, #292a2d 50%, #1f1f23 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    /* Global button polish: smooth transitions and subtle press feedback */
    button { transition: all 0.15s ease !important; }
    /* Scale-down on press gives tactile click feedback without layout shift */
    button:active:not(:disabled) { transform: scale(0.97) !important; }

    /* Leverage slider track: the horizontal bar users click or drag on */
    .leverage-slider-track {
      position: relative; width: 100%; height: 4px;
      background: #1f1f23; border-radius: 4px; cursor: pointer;
    }
    /* Colored fill bar that stretches from center to the handle position */
    .leverage-fill {
      position: absolute; height: 100%; border-radius: 4px;
      transition: all 0.1s ease;
    }
    /* Circular drag handle positioned on the track */
    .leverage-handle {
      position: absolute; width: 18px; height: 18px;
      border-radius: 50%; border: 2px solid #fff;
      top: 50%; transform: translate(-50%, -50%);
      cursor: grab; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      transition: background-color 0.15s, transform 0.1s;
    }
    /* Switch to grabbing cursor while actively dragging */
    .leverage-handle:active { cursor: grabbing; }
    /* Vertical tick mark at the center (0x) of the leverage slider */
    .leverage-center-mark {
      position: absolute; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      width: 2px; height: 12px; background: #494455;
    }

    /* Toast slide-in animation matches the JS-driven translateX transition */
    #x-toast-container > div {
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    /* Keyframes for toast entrance from the right side of the screen */
    @keyframes slideIn {
      from { transform: translateX(120%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  // Append to <head> so the styles apply globally to all current and future elements
  document.head.appendChild(style);
})();


// ═══════════════════════════════════════════════════════════════
// AUTO-INIT
// ═══════════════════════════════════════════════════════════════

// Initialize all UX modules once the DOM is fully parsed and ready
document.addEventListener('DOMContentLoaded', () => {
  // Create the toast notification container so it's ready for any early notifications
  XToast.init();
  // Start polling for the Reown AppKit wallet instance and subscribe to events
  XWallet.init();
  // Wire up the leverage slider, quick-select buttons, and drag handlers
  XLeverage.init();
});
