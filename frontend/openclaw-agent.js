/**
 * @file openclaw-agent.js — OpenClaw AI Agent Integration Module
 *
 * Manages the OpenClaw external AI trading agent lifecycle:
 *   - Connection setup, health checks, and reconnection
 *   - Agent mode management (Autonomous/Approval/Threshold/Notify)
 *   - Live activity feed simulation and rendering
 *   - Pending approval queue with expiry timers
 *   - Performance metrics tracking (win rate, PnL, trades)
 *   - Emergency stop, close all, and revoke controls
 *   - PnL chart rendering (canvas-based sparkline)
 *
 * @module openclaw-agent
 * @exports {Object} window.OpenClaw
 */

const OpenClaw = (() => {

  // ── State ──
  const state = {
    connected: false,
    agentId: 'agent_e5126fb42ba64a46',
    apiKey: null,
    mode: 'approval', // autonomous | approval | threshold | notify
    threshold: 500,
    permissions: {
      reduceLeverage: true,
      closePositions: true,
      increaseLeverage: true,
      openPositions: true,
      depositFunds: true,
    },
    rateLimit: 10,
    actionsThisMinute: 0,
    rateLimitResetTimer: null,

    // Performance
    trades: [],
    totalPnl: 0,
    winCount: 0,
    totalTrades: 0,
    avgHoldMs: 0,
    riskScore: 'Low', // Low | Medium | High

    // Activity
    activityLog: [],
    pendingApprovals: [],
    pendingIdCounter: 0,

    // Intervals
    simInterval: null,
    statsInterval: null,
    healthInterval: null,
    pnlHistory: [],
  };

  // ── Demo trade data for simulation ──
  const DEMO_ASSETS = ['QQQ', 'SPY', 'TSLA', 'NVDA', 'AAPL', 'ETH'];
  const DEMO_ACTIONS = [
    { type: 'open_long', label: 'Opened', icon: 'trending_up', color: 'text-secondary' },
    { type: 'close', label: 'Closed', icon: 'logout', color: 'text-primary' },
    { type: 'adjust', label: 'Adjusted leverage', icon: 'tune', color: 'text-[#8B5CF6]' },
    { type: 'deleverage', label: 'Reduced leverage', icon: 'shield', color: 'text-yellow-500' },
    { type: 'skip', label: 'Skipped', icon: 'block', color: 'text-on-surface-variant' },
  ];
  const DEMO_REASONS = [
    'Market volatility elevated. Risk management triggered.',
    'Technical breakout detected above 20-day SMA.',
    'Momentum divergence — reducing exposure.',
    'Earnings catalyst approaching — positioning ahead.',
    'Correlation spike with macro indicators.',
    'Volatility contraction pattern — entry signal.',
    'Market volatility too high — preserving capital.',
    'Positive sentiment shift detected across news sources.',
    'RSI oversold bounce confirmed on 4h timeframe.',
    'Fed minutes hawkish — reducing equity exposure.',
  ];

  // ── Connection ──

  function toggleConnection() {
    if (state.connected) {
      disconnect();
    } else {
      connect();
    }
  }

  function connect() {
    const apiKey = document.getElementById('ocApiKeyInput')?.value.trim();
    const agentId = document.getElementById('ocAgentIdInput')?.value.trim();

    // Update state
    state.apiKey = apiKey || 'xlvr_demo_key';
    state.agentId = agentId || state.agentId;

    // Show connecting state
    _setConnStatus('connecting', 'Connecting...');
    const btn = document.getElementById('ocConnectBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined text-base animate-spin">progress_activity</span> Connecting...';
    }

    // Simulate connection delay
    setTimeout(() => {
      state.connected = true;
      _setConnStatus('connected', `Connected as ${state.agentId}`);

      // Update status bar
      const dot = document.getElementById('ocAgentDot');
      const label = document.getElementById('ocAgentStatusLabel');
      const idDisplay = document.getElementById('ocAgentIdDisplay');
      if (dot) { dot.style.background = '#05e777'; dot.classList.add('oc-thinking'); }
      if (label) { label.textContent = 'Agent Online'; label.classList.add('text-secondary'); }
      if (idDisplay) idDisplay.textContent = state.agentId;

      // Update button
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined text-base">link_off</span> <span>Disconnect</span>';
        btn.classList.remove('bg-[#8B5CF6]', 'hover:bg-[#7C3AED]');
        btn.classList.add('bg-error/10', 'border', 'border-error/30', 'text-error', 'hover:bg-error/20');
      }

      // Update mode display
      const modeLabels = { autonomous: 'Autonomous', approval: 'Approval Required', threshold: 'Threshold', notify: 'Notify Only' };
      const modeDisplay = document.getElementById('ocCurrentMode');
      if (modeDisplay) modeDisplay.textContent = modeLabels[state.mode] || state.mode;

      // Show activity pulse
      const pulse = document.getElementById('ocActivityPulse');
      if (pulse) pulse.style.display = '';

      // Log it
      _addActivity('system', 'Agent connected. Mode: ' + (modeLabels[state.mode] || state.mode), 'text-secondary');
      if (typeof XToast !== 'undefined') XToast.show('OpenClaw agent connected', 'success');
      if (typeof logAction === 'function') logAction('OPENCLAW', 'Agent connected — ' + state.agentId, 'secondary');

      // Start simulation
      _startSimulation();
      _startStatsUpdate();
      _startHealthCheck();
    }, 1200);
  }

  function disconnect() {
    state.connected = false;
    _stopSimulation();
    _stopHealthCheck();

    _setConnStatus('disconnected', 'Disconnected');

    const dot = document.getElementById('ocAgentDot');
    const label = document.getElementById('ocAgentStatusLabel');
    if (dot) { dot.style.background = '#948ea1'; dot.classList.remove('oc-thinking'); }
    if (label) { label.textContent = 'Agent Disconnected'; label.classList.remove('text-secondary'); }

    const pulse = document.getElementById('ocActivityPulse');
    if (pulse) pulse.style.display = 'none';

    const btn = document.getElementById('ocConnectBtn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-base">power_settings_new</span> <span>Connect Agent</span>';
      btn.className = 'w-full py-3 rounded-lg bg-[#8B5CF6] text-white font-bold text-sm hover:bg-[#7C3AED] active:scale-[0.99] transition-all flex items-center justify-center gap-2';
    }

    _addActivity('system', 'Agent disconnected.', 'text-error');
    if (typeof XToast !== 'undefined') XToast.show('OpenClaw agent disconnected', 'warning');
    if (typeof logAction === 'function') logAction('OPENCLAW', 'Agent disconnected', 'yellow-500');
  }

  function _setConnStatus(status, text) {
    const dot = document.getElementById('ocConnDot');
    const label = document.getElementById('ocConnLabel');
    const colors = { disconnected: '#948ea1', connecting: '#ffa726', connected: '#05e777' };
    if (dot) dot.style.background = colors[status] || '#948ea1';
    if (label) label.textContent = text;
  }

  // ── Mode Management ──

  function setMode(mode) {
    state.mode = mode;

    // Update button visuals
    document.querySelectorAll('.oc-mode-btn').forEach(btn => {
      btn.classList.remove('oc-selected');
      btn.classList.add('border-outline-variant/10');
      btn.classList.remove('border-[#8B5CF6]/40', 'bg-[#8B5CF6]/5');
    });
    const selected = document.querySelector(`.oc-mode-btn[data-mode="${mode}"]`);
    if (selected) {
      selected.classList.add('oc-selected');
      selected.classList.remove('border-outline-variant/10');
      selected.classList.add('border-[#8B5CF6]/40', 'bg-[#8B5CF6]/5');
    }

    // Show/hide threshold config
    const thresholdConfig = document.getElementById('ocThresholdConfig');
    if (thresholdConfig) thresholdConfig.classList.toggle('hidden', mode !== 'threshold');

    // Update status bar mode label
    const modeLabels = { autonomous: 'Autonomous', approval: 'Approval Required', threshold: 'Threshold ($' + state.threshold + ')', notify: 'Notify Only' };
    const modeDisplay = document.getElementById('ocCurrentMode');
    if (modeDisplay) modeDisplay.textContent = modeLabels[mode] || mode;

    if (state.connected) {
      _addActivity('system', 'Mode changed to: ' + (modeLabels[mode] || mode), 'text-[#8B5CF6]');
    }
  }

  function updateThreshold(val) {
    state.threshold = parseInt(val);
    const display = document.getElementById('ocThresholdDisplay');
    const valSpan = document.getElementById('ocThresholdVal');
    if (display) display.textContent = '$' + val;
    if (valSpan) valSpan.textContent = val;

    const modeDisplay = document.getElementById('ocCurrentMode');
    if (modeDisplay && state.mode === 'threshold') modeDisplay.textContent = 'Threshold ($' + val + ')';
  }

  // ── API Key Visibility ──

  function toggleKeyVisibility() {
    const input = document.getElementById('ocApiKeyInput');
    const icon = document.getElementById('ocKeyEyeIcon');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.textContent = 'visibility';
    } else {
      input.type = 'password';
      if (icon) icon.textContent = 'visibility_off';
    }
  }

  // ── Activity Feed ──

  function _addActivity(type, message, colorClass) {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    state.activityLog.push({ ts, type, message, colorClass });

    const feed = document.getElementById('ocActivityFeed');
    if (!feed) return;

    // Remove placeholder
    const ph = feed.querySelector('p');
    if (ph && ph.textContent.includes('Waiting')) ph.remove();

    const entry = document.createElement('div');
    entry.className = 'oc-activity-entry';

    const typeIcons = {
      open_long: 'trending_up', close: 'logout', adjust: 'tune',
      deleverage: 'shield', skip: 'block', system: 'info',
      approval: 'approval', error: 'error',
    };
    const icon = typeIcons[type] || 'smart_toy';

    entry.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-on-surface-variant/60 text-[10px]">${ts}</span>
        <span class="material-symbols-outlined ${colorClass || 'text-on-surface-variant'}" style="font-size:14px">${icon}</span>
        <span class="text-on-surface text-[11px] flex-1">${message}</span>
      </div>`;

    feed.prepend(entry);

    // Trim old entries
    while (feed.children.length > 100) feed.removeChild(feed.lastChild);

    // Update count
    const count = document.getElementById('ocActivityCount');
    if (count) count.textContent = `${state.activityLog.length} actions`;
  }

  function clearActivity() {
    state.activityLog = [];
    const feed = document.getElementById('ocActivityFeed');
    if (feed) feed.innerHTML = '<p class="text-on-surface-variant opacity-60">[--:--:--] Activity cleared.</p>';
    const count = document.getElementById('ocActivityCount');
    if (count) count.textContent = '0 actions';
  }

  // ── Pending Approvals ──

  function _addPendingApproval(action) {
    state.pendingIdCounter++;
    const id = 'oc-pending-' + state.pendingIdCounter;
    const expiresIn = 300; // 5 minutes
    const pending = {
      id,
      action: action.type,
      asset: action.asset,
      leverage: action.leverage,
      amount: action.amount,
      confidence: action.confidence,
      reasoning: action.reasoning,
      createdAt: Date.now(),
      expiresIn,
    };

    state.pendingApprovals.push(pending);
    _renderPendingQueue();

    // Update badge
    _updatePendingBadge();

    // Start expiry countdown
    pending._timer = setInterval(() => {
      pending.expiresIn--;
      if (pending.expiresIn <= 0) {
        clearInterval(pending._timer);
        _expireApproval(id);
      }
      _updateExpiryDisplay(id, pending.expiresIn);
    }, 1000);

    // Toast notification
    if (typeof XToast !== 'undefined') {
      XToast.show(`Approval needed: ${action.type} ${action.asset} @ ${action.leverage}x`, 'warning', 8000);
    }
  }

  function approveAction(id) {
    const idx = state.pendingApprovals.findIndex(p => p.id === id);
    if (idx === -1) return;
    const pending = state.pendingApprovals[idx];
    clearInterval(pending._timer);
    state.pendingApprovals.splice(idx, 1);

    _addActivity(pending.action, `Approved: ${pending.action} ${pending.asset} @ ${pending.leverage}x -- $${pending.amount} USDC`, 'text-secondary');
    _executeTrade(pending);
    _renderPendingQueue();
    _updatePendingBadge();

    if (typeof XToast !== 'undefined') XToast.show('Trade approved and executed', 'success');
  }

  function rejectAction(id) {
    const idx = state.pendingApprovals.findIndex(p => p.id === id);
    if (idx === -1) return;
    const pending = state.pendingApprovals[idx];
    clearInterval(pending._timer);
    state.pendingApprovals.splice(idx, 1);

    _addActivity('skip', `Rejected: ${pending.action} ${pending.asset}`, 'text-error');
    _renderPendingQueue();
    _updatePendingBadge();
  }

  function _expireApproval(id) {
    const idx = state.pendingApprovals.findIndex(p => p.id === id);
    if (idx === -1) return;
    const pending = state.pendingApprovals[idx];
    clearInterval(pending._timer);
    state.pendingApprovals.splice(idx, 1);

    _addActivity('skip', `Expired: ${pending.action} ${pending.asset} (timed out)`, 'text-on-surface-variant');
    _renderPendingQueue();
    _updatePendingBadge();
  }

  function _updatePendingBadge() {
    const badge = document.getElementById('ocPendingBadge');
    const countEl = document.getElementById('ocPendingCount');
    const n = state.pendingApprovals.length;
    if (badge) {
      badge.textContent = n;
      badge.classList.toggle('hidden', n === 0);
    }
    if (countEl) countEl.textContent = `${n} pending`;

    // Update page title
    if (n > 0) {
      document.title = `(${n}) xLever | Agent Pending`;
    } else {
      document.title = 'xLever | Smart Agent';
    }
  }

  function _updateExpiryDisplay(id, seconds) {
    const el = document.getElementById(`${id}-timer`);
    if (!el) return;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    if (seconds <= 60) el.classList.add('text-error');
  }

  function _renderPendingQueue() {
    const container = document.getElementById('ocPendingQueue');
    if (!container) return;

    if (state.pendingApprovals.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6">
          <span class="material-symbols-outlined text-on-surface-variant/30 text-3xl">check_circle</span>
          <p class="font-mono text-[10px] text-on-surface-variant/50 mt-2">No pending approvals</p>
        </div>`;
      return;
    }

    container.innerHTML = state.pendingApprovals.map(p => {
      const confColor = p.confidence >= 71 ? '#00e676' : p.confidence >= 41 ? '#ffa726' : '#ff5252';
      const actionIcons = { open_long: 'trending_up', close: 'logout', adjust: 'tune', deleverage: 'shield' };
      const icon = actionIcons[p.action] || 'swap_vert';
      const m = Math.floor(p.expiresIn / 60);
      const s = p.expiresIn % 60;

      return `
        <div class="oc-approval-card bg-surface-container-highest/20 rounded-lg border border-outline-variant/10 p-4">
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-[#8B5CF6]/10 flex items-center justify-center">
                <span class="material-symbols-outlined text-[#8B5CF6] text-xl">${icon}</span>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-bold text-on-surface text-sm uppercase">${p.action.replace('_', ' ')}</span>
                  <span class="font-bold text-[#8B5CF6] text-sm">${p.asset}</span>
                  <span class="font-mono text-[10px] text-on-surface-variant">${p.leverage}x</span>
                </div>
                <span class="font-mono text-[10px] text-on-surface-variant">$${p.amount} USDC</span>
              </div>
            </div>
            <div class="text-right">
              <span class="font-mono text-[9px] text-on-surface-variant">Expires in</span>
              <p class="font-mono text-sm font-bold text-on-surface" id="${p.id}-timer">${m}:${String(s).padStart(2,'0')}</p>
            </div>
          </div>

          <!-- Confidence -->
          <div class="flex items-center gap-2 mb-2">
            <span class="font-mono text-[9px] text-on-surface-variant">Confidence:</span>
            <div class="flex-1 h-1 bg-surface-container-highest rounded-full overflow-hidden">
              <div class="oc-confidence-bar" style="width:${p.confidence}%;background:${confColor}"></div>
            </div>
            <span class="font-mono text-[10px] font-bold" style="color:${confColor}">${p.confidence}%</span>
          </div>

          <!-- Reasoning -->
          <div class="bg-surface-container-highest/30 rounded p-2 mb-3">
            <p class="font-mono text-[10px] text-on-surface-variant leading-relaxed">${p.reasoning}</p>
          </div>

          <!-- Actions -->
          <div class="flex gap-2">
            <button class="flex-1 py-2 rounded-lg bg-secondary/20 text-secondary font-bold text-xs hover:bg-secondary/30 transition-colors flex items-center justify-center gap-1" onclick="OpenClaw.approveAction('${p.id}')">
              <span class="material-symbols-outlined text-sm">check</span>Approve
            </button>
            <button class="flex-1 py-2 rounded-lg bg-error/20 text-error font-bold text-xs hover:bg-error/30 transition-colors flex items-center justify-center gap-1" onclick="OpenClaw.rejectAction('${p.id}')">
              <span class="material-symbols-outlined text-sm">close</span>Reject
            </button>
          </div>
        </div>`;
    }).join('');
  }

  // ── Trade Execution (Simulation) ──

  function _executeTrade(pending) {
    // Simulate trade outcome
    const isWin = Math.random() > 0.27; // ~73% win rate
    const pnl = isWin
      ? +(Math.random() * 150 + 10).toFixed(2)
      : -(Math.random() * 80 + 5).toFixed(2);

    state.totalPnl += pnl;
    state.totalTrades++;
    if (isWin) state.winCount++;

    state.trades.push({
      asset: pending.asset,
      action: pending.action,
      pnl,
      leverage: pending.leverage,
      amount: pending.amount,
      time: Date.now(),
    });

    // Update PnL history for chart
    state.pnlHistory.push(state.totalPnl);
    if (state.pnlHistory.length > 50) state.pnlHistory.shift();

    _updatePerformanceUI();
    _renderPnlChart();

    // Update last action time
    const lastAction = document.getElementById('ocLastAction');
    if (lastAction) lastAction.textContent = 'Just now';

    // Increment actions this minute
    state.actionsThisMinute++;
    _updateRateLimit();
  }

  // ── Simulation ──

  function _startSimulation() {
    if (state.simInterval) clearInterval(state.simInterval);

    // Generate a trade action every 8-20 seconds
    state.simInterval = setInterval(() => {
      if (!state.connected) return;
      _simulateAction();
    }, _randomInterval(8000, 20000));

    // Do first action quickly
    setTimeout(() => { if (state.connected) _simulateAction(); }, 2000);
  }

  function _simulateAction() {
    if (state.actionsThisMinute >= state.rateLimit) {
      _addActivity('system', 'Rate limit reached. Agent paused, retrying in 42s.', 'text-yellow-500');
      return;
    }

    const action = DEMO_ACTIONS[Math.floor(Math.random() * DEMO_ACTIONS.length)];
    const asset = DEMO_ASSETS[Math.floor(Math.random() * DEMO_ASSETS.length)];
    const leverage = +(1 + Math.random() * 3).toFixed(1);
    const amount = Math.round((200 + Math.random() * 2800) / 50) * 50;
    const confidence = Math.floor(40 + Math.random() * 55);
    const reasoning = DEMO_REASONS[Math.floor(Math.random() * DEMO_REASONS.length)];

    if (action.type === 'skip') {
      _addActivity('skip', `Skipped ${asset} entry -- ${reasoning}`, 'text-on-surface-variant');
      return;
    }

    const desc = `${action.label} +${leverage}x ${asset} position -- $${amount} USDC -- Confidence: ${confidence}%`;

    // Route based on mode
    if (state.mode === 'autonomous') {
      _addActivity(action.type, desc, action.color);
      _executeTrade({ asset, action: action.type, leverage, amount, confidence, reasoning });
    } else if (state.mode === 'approval') {
      _addActivity('approval', `Agent requests approval: ${action.label} ${asset} @ ${leverage}x`, 'text-yellow-500');
      _addPendingApproval({ type: action.type, asset, leverage, amount, confidence, reasoning });
    } else if (state.mode === 'threshold') {
      if (amount > state.threshold) {
        _addActivity('approval', `Above threshold ($${amount} > $${state.threshold}): ${action.label} ${asset}`, 'text-yellow-500');
        _addPendingApproval({ type: action.type, asset, leverage, amount, confidence, reasoning });
      } else {
        _addActivity(action.type, desc, action.color);
        _executeTrade({ asset, action: action.type, leverage, amount, confidence, reasoning });
      }
    } else if (state.mode === 'notify') {
      _addActivity(action.type, `Suggestion: ${desc}`, 'text-[#8B5CF6]');
      if (typeof XToast !== 'undefined') XToast.show(`Agent suggests: ${action.label} ${asset} @ ${leverage}x`, 'info', 5000);
    }
  }

  function _stopSimulation() {
    if (state.simInterval) { clearInterval(state.simInterval); state.simInterval = null; }
    if (state.statsInterval) { clearInterval(state.statsInterval); state.statsInterval = null; }
  }

  function _randomInterval(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
  }

  // ── Stats & Performance UI ──

  function _startStatsUpdate() {
    if (state.statsInterval) clearInterval(state.statsInterval);
    state.statsInterval = setInterval(() => {
      _updatePerformanceUI();
      _updateRateLimit();

      // Update last action time
      if (state.trades.length > 0) {
        const last = state.trades[state.trades.length - 1];
        const ago = Math.floor((Date.now() - last.time) / 1000);
        const lastAction = document.getElementById('ocLastAction');
        if (lastAction) {
          if (ago < 60) lastAction.textContent = `${ago}s ago`;
          else lastAction.textContent = `${Math.floor(ago / 60)}m ago`;
        }
      }
    }, 1000);
  }

  function _updatePerformanceUI() {
    const winRate = state.totalTrades > 0 ? Math.round((state.winCount / state.totalTrades) * 100) : 73;
    const winRateEl = document.getElementById('ocWinRate');
    const winRateBar = document.getElementById('ocWinRateBar');
    if (winRateEl) {
      winRateEl.textContent = winRate + '%';
      winRateEl.className = `font-mono text-2xl font-bold ${winRate >= 50 ? 'text-secondary' : 'text-error'}`;
    }
    if (winRateBar) winRateBar.style.width = winRate + '%';

    const pnlEl = document.getElementById('ocTotalPnl');
    if (pnlEl) {
      const pnl = state.totalPnl;
      pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
      pnlEl.className = `font-mono text-2xl font-bold ${pnl >= 0 ? 'text-secondary' : 'text-error'}`;
    }

    const tradesEl = document.getElementById('ocTotalTrades');
    if (tradesEl) tradesEl.textContent = state.totalTrades || 47;

    // Risk score based on recent performance
    let risk = 'Low';
    let riskColor = '#00e676';
    let riskWidth = 25;
    if (state.totalPnl < -200) { risk = 'High'; riskColor = '#ff5252'; riskWidth = 85; }
    else if (state.totalPnl < 0) { risk = 'Medium'; riskColor = '#ffa726'; riskWidth = 55; }

    const riskBadge = document.getElementById('ocRiskBadge');
    const riskBar = document.getElementById('ocRiskBar');
    if (riskBadge) {
      riskBadge.textContent = risk;
      riskBadge.style.background = riskColor + '1a';
      riskBadge.style.color = riskColor;
    }
    if (riskBar) { riskBar.style.width = riskWidth + '%'; riskBar.style.background = riskColor; }
  }

  function _updateRateLimit() {
    const el = document.getElementById('ocActionsRemaining');
    if (el) el.textContent = `${state.rateLimit - state.actionsThisMinute}/${state.rateLimit} available`;

    // Reset rate limit every 60s
    if (!state.rateLimitResetTimer) {
      state.rateLimitResetTimer = setInterval(() => { state.actionsThisMinute = 0; }, 60000);
    }
  }

  // ── PnL Chart (Canvas Sparkline) ──

  function _renderPnlChart() {
    const canvas = document.getElementById('ocPnlCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const data = state.pnlHistory.length > 1 ? state.pnlHistory : [0, 50, 30, 80, 60, 120, 100, 180, 150, 200];
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 10;

    ctx.clearRect(0, 0, w, h);

    // Draw zero line
    const zeroY = h - padding - ((0 - min) / range) * (h - 2 * padding);
    ctx.beginPath();
    ctx.strokeStyle = '#494455';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padding, zeroY);
    ctx.lineTo(w - padding, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw PnL line
    ctx.beginPath();
    const lastVal = data[data.length - 1];
    ctx.strokeStyle = lastVal >= 0 ? '#00e676' : '#ff5252';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < data.length; i++) {
      const x = padding + (i / (data.length - 1)) * (w - 2 * padding);
      const y = h - padding - ((data[i] - min) / range) * (h - 2 * padding);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill gradient
    const lastX = padding + ((data.length - 1) / (data.length - 1)) * (w - 2 * padding);
    const lastY = h - padding - ((lastVal - min) / range) * (h - 2 * padding);
    ctx.lineTo(lastX, h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    const color = lastVal >= 0 ? '0, 230, 118' : '255, 82, 82';
    gradient.addColorStop(0, `rgba(${color}, 0.15)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fill();

    // End dot
    ctx.beginPath();
    ctx.fillStyle = lastVal >= 0 ? '#00e676' : '#ff5252';
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Health Check ──

  function _startHealthCheck() {
    if (state.healthInterval) clearInterval(state.healthInterval);
    state.healthInterval = setInterval(() => {
      if (!state.connected) return;
      // Simulate occasional connection issues
      if (Math.random() < 0.02) {
        _addActivity('error', 'Connection unstable. Attempting reconnect...', 'text-error');
        setTimeout(() => {
          if (state.connected) _addActivity('system', 'Connection restored.', 'text-secondary');
        }, 2000);
      }
    }, 15000);
  }

  function _stopHealthCheck() {
    if (state.healthInterval) { clearInterval(state.healthInterval); state.healthInterval = null; }
  }

  // ── Emergency Controls ──

  function emergencyStop() {
    if (!state.connected) return;

    // Clear all pending
    state.pendingApprovals.forEach(p => clearInterval(p._timer));
    state.pendingApprovals = [];
    _renderPendingQueue();
    _updatePendingBadge();

    _addActivity('error', 'EMERGENCY STOP: All agent actions halted immediately.', 'text-error');
    _addActivity('system', 'Position frozen at current state. Manual control restored.', 'text-error');

    if (typeof XToast !== 'undefined') XToast.show('EMERGENCY STOP: Agent halted', 'error', 6000);
    if (typeof logAction === 'function') logAction('OPENCLAW', 'EMERGENCY STOP activated', 'error');

    disconnect();
  }

  function closeAllPositions() {
    if (!state.connected) return;
    _addActivity('close', 'Closing all open positions... Market exit initiated.', 'text-error');
    if (typeof XToast !== 'undefined') XToast.show('Closing all positions...', 'warning', 4000);
    setTimeout(() => {
      _addActivity('system', 'All positions closed. Portfolio is flat.', 'text-secondary');
      if (typeof XToast !== 'undefined') XToast.show('All positions closed', 'success');
    }, 1500);
  }

  function revokeAccess() {
    _addActivity('error', 'API access revoked. Agent permanently disconnected.', 'text-error');
    if (typeof XToast !== 'undefined') XToast.show('API access revoked', 'error', 6000);
    state.apiKey = null;
    document.getElementById('ocApiKeyInput').value = '';
    disconnect();
  }

  // ── Init ──

  function init() {
    // Set default mode visuals
    setMode('approval');
    // Render initial chart
    setTimeout(_renderPnlChart, 100);
    // Initialize PnL history with demo data
    state.pnlHistory = [0, 50, 80, 45, 120, 180, 150, 280, 320, 290, 380, 420, 510, 480, 560, 620, 580, 700, 750, 820, 790, 900, 950, 1050, 1000, 1100, 1200, 1247.5];
    state.totalPnl = 1247.50;
    state.winCount = 34;
    state.totalTrades = 47;
    _updatePerformanceUI();
    setTimeout(_renderPnlChart, 200);
  }

  document.addEventListener('DOMContentLoaded', init);

  // ── Public API ──
  return {
    toggleConnection,
    setMode,
    updateThreshold,
    approveAction,
    rejectAction,
    clearActivity,
    emergencyStop,
    closeAllPositions,
    revokeAccess,
    get state() { return state; },
  };

})();

// Expose globally
window.OpenClaw = OpenClaw;

// Expose key visibility toggle globally (called from onclick)
window.toggleOcKeyVisibility = OpenClaw ? function() {
  const input = document.getElementById('ocApiKeyInput');
  const icon = document.getElementById('ocKeyEyeIcon');
  if (!input) return;
  if (input.type === 'password') { input.type = 'text'; if (icon) icon.textContent = 'visibility'; }
  else { input.type = 'password'; if (icon) icon.textContent = 'visibility_off'; }
} : function(){};
