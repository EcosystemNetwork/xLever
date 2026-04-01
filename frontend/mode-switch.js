/**
 * @file mode-switch.js — xLever Mode Switcher (Trade vs Research)
 *
 * Trade mode: wallet, balances, live positions, real vault calls.
 * Research mode: backtests, degen mode, educational visuals, scenario analysis.
 *
 * Persists the user's choice in localStorage so it sticks across page loads.
 * Dispatches 'xlever-mode-change' CustomEvent so other modules can react.
 *
 * @module XMode
 * @exports {Object} window.XMode
 * @exports {Function} XMode.init - Initialize and apply persisted mode
 * @exports {Function} XMode.get - Get current mode string
 * @exports {Function} XMode.set - Set and apply a new mode
 * @exports {Function} XMode.apply - Apply mode to DOM without persisting
 *
 * @dependencies
 *   - localStorage ('xlever-mode')
 *   - window.JudgeMode (optional) - locks mode to 'trade' when active
 */
const XMode = (() => {
  /** @type {string} localStorage key for persisted mode */
  const STORAGE_KEY = 'xlever-mode';
  /** @type {string[]} Allowed mode values */
  const VALID_MODES = ['trade', 'research'];

  /**
   * Read the persisted mode from localStorage.
   * @returns {'trade'|'research'} Current mode, defaults to 'trade'
   */
  function get() {
    return localStorage.getItem(STORAGE_KEY) || 'trade';
  }

  /**
   * Set the active mode. Persists to localStorage and applies to DOM.
   * In Judge Mode, forces 'trade' regardless of the requested mode.
   * @param {'trade'|'research'} mode - The mode to activate
   */
  function set(mode) {
    // Judge mode locks to trade — ignore mode switches
    if (window.JudgeMode && window.JudgeMode.isActive()) {
      mode = 'trade';
    }
    if (!VALID_MODES.includes(mode)) return;
    localStorage.setItem(STORAGE_KEY, mode);
    apply(mode);
  }

  /**
   * Apply a mode to the DOM: toggle body class, update toggle buttons,
   * update mode banner, reset tranche views, and dispatch change event.
   * Does not persist to localStorage (use set() for that).
   * @param {'trade'|'research'} mode - The mode to apply
   */
  function apply(mode) {
    // Toggle body class for CSS visibility rules
    document.body.classList.remove('mode-trade', 'mode-research');
    document.body.classList.add(`mode-${mode}`);

    // Update toggle buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Update banner
    const banner = document.getElementById('modeBanner');
    if (banner) {
      banner.className = `mode-banner mode-banner-${mode}`;
      const icon = document.getElementById('modeBannerIcon');
      const text = document.getElementById('modeBannerText');
      if (mode === 'trade') {
        if (icon) icon.textContent = 'trending_up';
        if (text) text.textContent = 'Live Trading \u2014 Connected to Ink Sepolia testnet. Real wallet actions.';
      } else {
        if (icon) icon.textContent = 'science';
        if (text) text.textContent = 'Research Mode \u2014 Simulated backtests using Yahoo Finance data. No real funds.';
      }
    }

    // When switching to trade mode, ensure senior view is shown and junior view hidden
    // (the tranche selector handles this, but reset if we were in research mode)
    if (mode === 'trade') {
      const seniorView = document.getElementById('seniorView');
      const juniorView = document.getElementById('juniorView');
      const seniorBtn = document.getElementById('seniorBtn');
      const juniorBtn = document.getElementById('juniorBtn');
      if (seniorView) seniorView.style.display = 'grid';
      if (juniorView) juniorView.style.display = 'none';
      if (seniorBtn) seniorBtn.classList.add('active');
      if (juniorBtn) juniorBtn.classList.remove('active');
    }

    // Dispatch event so other modules can react
    window.dispatchEvent(new CustomEvent('xlever-mode-change', { detail: { mode } }));
  }

  /**
   * Initialize the mode switcher: apply persisted mode and wire up toggle buttons.
   * Called automatically on DOMContentLoaded.
   */
  function init() {
    const mode = get();
    apply(mode);

    // Wire up toggle buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => set(btn.dataset.mode));
    });
  }

  return { init, get, set, apply };
})();

window.XMode = XMode;

// Initialize as soon as DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => XMode.init());
} else {
  XMode.init();
}
