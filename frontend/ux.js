/**
 * xLever Consumer-Grade UX Layer
 * Transaction modals, toast notifications, skeleton loading, interactive controls
 */

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════

const XToast = (() => {
  let container = null;

  function init() {
    if (container) return;
    container = document.createElement('div');
    container.id = 'x-toast-container';
    container.style.cssText = `
      position: fixed; top: 72px; right: 20px; z-index: 9999;
      display: flex; flex-direction: column; gap: 8px;
      pointer-events: none; max-width: 380px;
    `;
    document.body.appendChild(container);
  }

  function show(message, type = 'info', duration = 4000) {
    init();
    const toast = document.createElement('div');
    const colors = {
      success: { bg: '#00e676', icon: 'check_circle', text: '#003918' },
      error:   { bg: '#ff5252', icon: 'error', text: '#fff' },
      warning: { bg: '#ffd740', icon: 'warning', text: '#1a1d26' },
      info:    { bg: '#7c4dff', icon: 'info', text: '#fff' },
      pending: { bg: '#1f1f23', icon: 'hourglass_top', text: '#e3e2e6' },
    };
    const c = colors[type] || colors.info;

    toast.style.cssText = `
      display: flex; align-items: center; gap: 10px;
      background: ${type === 'pending' ? '#1f1f23' : c.bg};
      color: ${c.text}; padding: 12px 16px; border-radius: 6px;
      font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600;
      pointer-events: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      transform: translateX(120%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid ${type === 'pending' ? '#494455' : 'transparent'};
    `;
    toast.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:18px;${type === 'pending' ? 'animation:spin 1s linear infinite;' : ''}">${c.icon}</span>
      <span style="flex:1">${message}</span>
    `;
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

    if (duration > 0) {
      setTimeout(() => dismiss(toast), duration);
    }
    return toast;
  }

  function dismiss(toast) {
    toast.style.transform = 'translateX(120%)';
    setTimeout(() => toast.remove(), 300);
  }

  return { show, dismiss, init };
})();


// ═══════════════════════════════════════════════════════════════
// TRANSACTION CONFIRMATION MODAL
// ═══════════════════════════════════════════════════════════════

const XModal = (() => {
  let overlay = null;

  function createOverlay() {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'x-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      opacity: 0; transition: opacity 0.2s ease;
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    return overlay;
  }

  function close() {
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => { overlay?.remove(); overlay = null; }, 200);
  }

  function confirmTrade(details) {
    const ov = createOverlay();
    const isLong = details.leverage > 0;
    const sideColor = isLong ? '#00e676' : '#ff5252';
    const sideLabel = isLong ? 'LONG' : 'SHORT';
    const leverageAbs = Math.abs(details.leverage).toFixed(1);

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #12141a; border: 1px solid #252833; border-radius: 10px;
      width: 420px; max-width: 92vw; overflow: hidden;
      transform: scale(0.95) translateY(10px);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    requestAnimationFrame(() => { modal.style.transform = 'scale(1) translateY(0)'; });

    modal.innerHTML = `
      <div style="padding: 20px 24px; border-bottom: 1px solid #252833; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-family:'DM Sans',sans-serif; font-size:15px; font-weight:700; color:#e3e2e6;">Confirm Position</div>
          <div style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-top:2px;">Review before submitting</div>
        </div>
        <button id="x-modal-close" style="background:none; border:none; cursor:pointer; color:#555970; padding:4px;">
          <span class="material-symbols-outlined" style="font-size:20px;">close</span>
        </button>
      </div>

      <div style="padding: 24px;">
        <!-- Asset + Direction Header -->
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px;">
          <div style="width:44px;height:44px;border-radius:8px;background:${sideColor}15;display:flex;align-items:center;justify-content:center;">
            <span class="material-symbols-outlined" style="color:${sideColor};font-size:22px;">${isLong ? 'trending_up' : 'trending_down'}</span>
          </div>
          <div>
            <div style="font-family:'Space Grotesk',sans-serif; font-size:20px; font-weight:700; color:#e3e2e6;">${details.asset}</div>
            <div style="display:flex; gap:8px; align-items:center; margin-top:2px;">
              <span style="font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:700; color:${sideColor}; background:${sideColor}15; padding:2px 8px; border-radius:3px;">${sideLabel}</span>
              <span style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#8b8fa3;">${leverageAbs}x Leverage</span>
            </div>
          </div>
        </div>

        <!-- Details Grid -->
        <div style="background:#0d0e11; border:1px solid #252833; border-radius:6px; padding:16px; margin-bottom:16px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Position Size</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#e3e2e6;">$${details.size.toLocaleString()}</div>
            </div>
            <div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Effective Exposure</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#7c4dff;">$${(details.size * Math.abs(details.leverage)).toLocaleString()}</div>
            </div>
            <div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Entry Price</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#e3e2e6;">${details.price}</div>
            </div>
            <div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#555970; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px;">Annual Fee</div>
              <div style="font-family:'JetBrains Mono',monospace; font-size:15px; font-weight:600; color:#e3e2e6;">${details.fee}</div>
            </div>
          </div>
        </div>

        <!-- Risk Summary -->
        <div style="display:flex; gap:8px; margin-bottom:20px;">
          <div style="flex:1; background:#00e67610; border:1px solid #00e67630; border-radius:5px; padding:10px 12px; text-align:center;">
            <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#00e676; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">No Liquidation</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#00e676; font-weight:600;">Risk Socialized</div>
          </div>
          <div style="flex:1; background:#7c4dff10; border:1px solid #7c4dff30; border-radius:5px; padding:10px 12px; text-align:center;">
            <div style="font-family:'JetBrains Mono',monospace; font-size:9px; color:#7c4dff; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Strategy</div>
            <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#cdbdff; font-weight:600;">LTAP Protocol</div>
          </div>
        </div>

        <!-- Buttons -->
        <div id="x-modal-actions" style="display:flex; gap:10px;">
          <button id="x-modal-cancel" style="
            flex:1; padding:14px; border-radius:6px; font-family:'DM Sans',sans-serif;
            font-size:13px; font-weight:700; cursor:pointer; transition:all 0.2s;
            background:none; border:1px solid #252833; color:#8b8fa3;
          ">Cancel</button>
          <button id="x-modal-confirm" style="
            flex:2; padding:14px; border-radius:6px; font-family:'DM Sans',sans-serif;
            font-size:13px; font-weight:700; cursor:pointer; transition:all 0.2s;
            background:${sideColor}; border:none; color:${isLong ? '#003918' : '#fff'};
            text-transform:uppercase; letter-spacing:1px;
          ">Confirm ${sideLabel} Position</button>
        </div>
      </div>
    `;

    ov.appendChild(modal);

    modal.querySelector('#x-modal-close').addEventListener('click', close);
    modal.querySelector('#x-modal-cancel').addEventListener('click', close);
    modal.querySelector('#x-modal-confirm').addEventListener('click', () => {
      showTransactionProgress(modal, details, sideColor, isLong);
    });
  }

  function showTransactionProgress(modal, details, sideColor, isLong) {
    const actionsEl = modal.querySelector('#x-modal-actions');
    const sideLabel = isLong ? 'LONG' : 'SHORT';

    // Replace buttons with progress
    actionsEl.innerHTML = `
      <div style="width:100%; text-align:center; padding:8px 0;">
        <div id="x-tx-spinner" style="margin:0 auto 12px; width:36px; height:36px; border:3px solid #252833; border-top:3px solid ${sideColor}; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <div style="font-family:'DM Sans',sans-serif; font-size:14px; font-weight:600; color:#e3e2e6;" id="x-tx-status">Submitting Transaction...</div>
        <div style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#555970; margin-top:4px;" id="x-tx-sub">Waiting for wallet signature</div>
      </div>
    `;

    // Simulate transaction steps
    const steps = [
      { delay: 1200, status: 'Signing Transaction...', sub: 'Confirming in wallet' },
      { delay: 2400, status: 'Broadcasting to Network...', sub: 'Tx submitted, awaiting confirmation' },
      { delay: 3800, status: 'Confirming on Chain...', sub: 'Block confirmation 1/2' },
    ];

    steps.forEach(step => {
      setTimeout(() => {
        const statusEl = document.getElementById('x-tx-status');
        const subEl = document.getElementById('x-tx-sub');
        if (statusEl) statusEl.textContent = step.status;
        if (subEl) subEl.textContent = step.sub;
      }, step.delay);
    });

    // Success state
    setTimeout(() => {
      actionsEl.innerHTML = `
        <div style="width:100%; text-align:center; padding:8px 0;">
          <div style="width:48px; height:48px; border-radius:50%; background:${sideColor}15; display:flex; align-items:center; justify-content:center; margin:0 auto 12px;">
            <span class="material-symbols-outlined" style="color:${sideColor}; font-size:28px; font-variation-settings:'FILL' 1;">check_circle</span>
          </div>
          <div style="font-family:'DM Sans',sans-serif; font-size:16px; font-weight:700; color:#e3e2e6;">Position Opened</div>
          <div style="font-family:'JetBrains Mono',monospace; font-size:11px; color:#8b8fa3; margin-top:4px;">
            ${details.asset} ${sideLabel} ${Math.abs(details.leverage).toFixed(1)}x &middot; $${details.size.toLocaleString()}
          </div>
          <div style="font-family:'JetBrains Mono',monospace; font-size:10px; color:#555970; margin-top:8px; background:#0d0e11; padding:6px 12px; border-radius:4px; display:inline-block;">
            Tx: 0x${generateFakeHash()}
          </div>
          <button id="x-modal-done" style="
            display:block; width:100%; margin-top:16px; padding:12px; border-radius:6px;
            font-family:'DM Sans',sans-serif; font-size:13px; font-weight:700;
            cursor:pointer; background:#1f1f23; border:1px solid #252833; color:#e3e2e6;
            transition:all 0.2s;
          ">Done</button>
        </div>
      `;
      document.getElementById('x-modal-done')?.addEventListener('click', close);
      XToast.show(`${details.asset} ${sideLabel} position opened successfully`, 'success');
    }, 5000);
  }

  function generateFakeHash() {
    return Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + '...';
  }

  return { confirmTrade, close };
})();


// ═══════════════════════════════════════════════════════════════
// WALLET CONNECT SIMULATION
// ═══════════════════════════════════════════════════════════════

const XWallet = (() => {
  let connected = false;
  const address = '0x7a3F...E9b2';

  function init() {
    document.querySelectorAll('button').forEach(btn => {
      const text = btn.textContent.trim();
      if (text === 'Connect' || text === 'Connect Wallet') {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (connected) {
            showDisconnect(btn);
          } else {
            simulateConnect(btn);
          }
        });
      }
    });
  }

  function simulateConnect(btn) {
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<span class="material-symbols-outlined text-sm" style="animation:spin 0.8s linear infinite;">progress_activity</span><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8b8fa3;">Connecting...</span>`;
    btn.style.pointerEvents = 'none';

    setTimeout(() => {
      connected = true;
      btn.style.pointerEvents = '';
      btn.innerHTML = `
        <span style="width:6px;height:6px;border-radius:50%;background:#00e676;display:inline-block;"></span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e3e2e6;">${address}</span>
      `;
      btn.style.borderColor = '#00e676';
      XToast.show('Wallet connected successfully', 'success');
    }, 1500);
  }

  function showDisconnect(btn) {
    connected = false;
    btn.innerHTML = `
      <span class="material-symbols-outlined text-sm" style="color:#7c4dff;">account_balance_wallet</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8b8fa3;">Connect</span>
    `;
    btn.style.borderColor = '';
    XToast.show('Wallet disconnected', 'info');
  }

  return { init, isConnected: () => connected };
})();


// ═══════════════════════════════════════════════════════════════
// INTERACTIVE LEVERAGE SLIDER
// ═══════════════════════════════════════════════════════════════

const XLeverage = (() => {
  let currentLeverage = 2.0;
  let sliderTrack = null;
  let sliderHandle = null;
  let sliderFill = null;
  let displayEl = null;
  let isDragging = false;

  function init() {
    // Find the leverage slider track
    sliderTrack = document.querySelector('.leverage-slider-track');
    if (!sliderTrack) return;

    sliderHandle = sliderTrack.querySelector('.leverage-handle');
    sliderFill = sliderTrack.querySelector('.leverage-fill');
    displayEl = document.getElementById('leverage-display');

    // Quick-select buttons
    document.querySelectorAll('[data-leverage]').forEach(btn => {
      btn.addEventListener('click', () => {
        setLeverage(parseFloat(btn.dataset.leverage));
      });
    });

    // Drag handling
    if (sliderHandle) {
      sliderHandle.addEventListener('mousedown', startDrag);
      sliderHandle.addEventListener('touchstart', startDrag, { passive: false });
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('touchmove', onDrag, { passive: false });
      document.addEventListener('mouseup', stopDrag);
      document.addEventListener('touchend', stopDrag);
    }

    // Click on track
    sliderTrack.addEventListener('click', (e) => {
      if (isDragging) return;
      const rect = sliderTrack.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const lev = -4 + pct * 8; // -4 to +4 range
      setLeverage(Math.round(lev * 2) / 2); // snap to 0.5
    });

    updateVisuals();
  }

  function startDrag(e) {
    e.preventDefault();
    isDragging = true;
    sliderHandle.style.transform = 'translate(-50%, -50%) scale(1.3)';
  }

  function onDrag(e) {
    if (!isDragging) return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = sliderTrack.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    const lev = -4 + pct * 8;
    setLeverage(Math.round(lev * 4) / 4); // snap to 0.25
  }

  function stopDrag() {
    if (!isDragging) return;
    isDragging = false;
    if (sliderHandle) sliderHandle.style.transform = 'translate(-50%, -50%) scale(1)';
  }

  function setLeverage(val) {
    currentLeverage = Math.max(-4, Math.min(4, val));
    updateVisuals();
    updateOrderDetails();
  }

  function updateVisuals() {
    const pct = (currentLeverage + 4) / 8 * 100; // 0% = -4x, 50% = 0x, 100% = +4x
    const isLong = currentLeverage > 0;
    const isShort = currentLeverage < 0;
    const color = isLong ? '#00e676' : isShort ? '#ff5252' : '#494455';

    if (sliderHandle) {
      sliderHandle.style.left = pct + '%';
      sliderHandle.style.backgroundColor = color;
      sliderHandle.style.borderColor = '#fff';
    }

    if (sliderFill) {
      if (currentLeverage >= 0) {
        sliderFill.style.left = '50%';
        sliderFill.style.width = (pct - 50) + '%';
        sliderFill.style.backgroundColor = '#00e676';
      } else {
        sliderFill.style.left = pct + '%';
        sliderFill.style.width = (50 - pct) + '%';
        sliderFill.style.backgroundColor = '#ff5252';
      }
    }

    if (displayEl) {
      const sign = currentLeverage > 0 ? '+' : '';
      displayEl.textContent = `${sign}${currentLeverage.toFixed(1)}`;
      displayEl.style.color = color;
    }

    // Update quick-select active states
    document.querySelectorAll('[data-leverage]').forEach(btn => {
      const val = parseFloat(btn.dataset.leverage);
      const isActive = Math.abs(val - currentLeverage) < 0.01;
      btn.style.color = isActive ? color : '';
      btn.style.fontWeight = isActive ? '800' : '';
    });

    // Update risk meter
    updateRiskMeter();

    // Update the "Open Position" button
    updatePositionButton();
  }

  function updateRiskMeter() {
    const segments = document.querySelectorAll('.risk-segment');
    const absLev = Math.abs(currentLeverage);
    const level = absLev <= 1 ? 1 : absLev <= 2 ? 2 : absLev <= 3 ? 3 : 4;

    segments.forEach((seg, i) => {
      if (i < level) {
        const colors = ['#448aff', '#00e676', '#ffd740', '#ff5252'];
        seg.style.backgroundColor = colors[i];
      } else {
        seg.style.backgroundColor = '#1f1f23';
      }
    });
  }

  function updatePositionButton() {
    const btn = document.getElementById('open-position-btn');
    if (!btn) return;

    const isLong = currentLeverage > 0;
    const isShort = currentLeverage < 0;
    const isNeutral = currentLeverage === 0;

    if (isNeutral) {
      btn.textContent = 'Select Leverage';
      btn.style.backgroundColor = '#1f1f23';
      btn.style.color = '#555970';
      btn.disabled = true;
    } else {
      const label = isLong ? 'Open Long Position' : 'Open Short Position';
      btn.textContent = label;
      btn.style.backgroundColor = isLong ? '#00e676' : '#ff5252';
      btn.style.color = isLong ? '#003918' : '#fff';
      btn.disabled = false;
    }
  }

  function updateOrderDetails() {
    const feeEl = document.getElementById('annual-fee-display');
    if (feeEl) {
      const absLev = Math.abs(currentLeverage);
      const fee = absLev <= 0 ? 0 : (0.5 + 0.5 * (absLev - 1)).toFixed(1);
      feeEl.textContent = `${fee}% APR`;
    }
  }

  return { init, getLeverage: () => currentLeverage };
})();


// ═══════════════════════════════════════════════════════════════
// SKELETON LOADING
// ═══════════════════════════════════════════════════════════════

const XSkeleton = (() => {
  function show(selector, count = 3) {
    const target = document.querySelector(selector);
    if (!target) return;
    target.classList.add('x-skeleton-container');

    const rows = Array.from({ length: count }, () => `
      <div class="x-skeleton-row">
        <div class="x-skeleton-block" style="width:${20 + Math.random()*30}%"></div>
        <div class="x-skeleton-block" style="width:${15 + Math.random()*20}%"></div>
        <div class="x-skeleton-block" style="width:${10 + Math.random()*15}%"></div>
      </div>
    `).join('');

    target.dataset.originalContent = target.innerHTML;
    target.innerHTML = rows;
  }

  function hide(selector) {
    const target = document.querySelector(selector);
    if (!target || !target.dataset.originalContent) return;
    target.innerHTML = target.dataset.originalContent;
    delete target.dataset.originalContent;
    target.classList.remove('x-skeleton-container');
  }

  return { show, hide };
})();


// ═══════════════════════════════════════════════════════════════
// GLOBAL STYLES INJECTION
// ═══════════════════════════════════════════════════════════════

(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .x-skeleton-row {
      display: flex; gap: 12px; padding: 12px 0;
      animation: fadeInUp 0.3s ease;
    }
    .x-skeleton-block {
      height: 14px; border-radius: 4px;
      background: linear-gradient(90deg, #1f1f23 25%, #292a2d 50%, #1f1f23 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    /* Smooth button transitions */
    button { transition: all 0.15s ease !important; }
    button:active:not(:disabled) { transform: scale(0.97) !important; }

    /* Leverage slider custom styles */
    .leverage-slider-track {
      position: relative; width: 100%; height: 4px;
      background: #1f1f23; border-radius: 4px; cursor: pointer;
    }
    .leverage-fill {
      position: absolute; height: 100%; border-radius: 4px;
      transition: all 0.1s ease;
    }
    .leverage-handle {
      position: absolute; width: 18px; height: 18px;
      border-radius: 50%; border: 2px solid #fff;
      top: 50%; transform: translate(-50%, -50%);
      cursor: grab; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      transition: background-color 0.15s, transform 0.1s;
    }
    .leverage-handle:active { cursor: grabbing; }
    .leverage-center-mark {
      position: absolute; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      width: 2px; height: 12px; background: #494455;
    }

    /* Toast animations */
    #x-toast-container > div {
      animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    @keyframes slideIn {
      from { transform: translateX(120%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
})();


// ═══════════════════════════════════════════════════════════════
// AUTO-INIT
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  XToast.init();
  XWallet.init();
  XLeverage.init();
});
