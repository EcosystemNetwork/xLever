/**
 * xLever Mode Switcher — Trade vs Research
 *
 * Trade mode: wallet, balances, live positions, real vault calls.
 * Research mode: backtests, degen mode, educational visuals, scenario analysis.
 *
 * Persists the user's choice in localStorage so it sticks across page loads.
 */
const XMode = (() => {
  const STORAGE_KEY = 'xlever-mode';
  const VALID_MODES = ['trade', 'research'];

  function get() {
    return localStorage.getItem(STORAGE_KEY) || 'trade';
  }

  function set(mode) {
    if (!VALID_MODES.includes(mode)) return;
    localStorage.setItem(STORAGE_KEY, mode);
    apply(mode);
  }

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
        if (icon) icon.textContent = '';
        if (text) text.textContent = 'Live Trading \u2014 Connected to Ink Sepolia testnet. Real wallet actions.';
      } else {
        if (icon) icon.textContent = '';
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
