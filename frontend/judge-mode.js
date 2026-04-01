/**
 * @file judge-mode.js — xLever Demo Walkthrough Mode
 *
 * A focused demo mode that shows only what is live and demoable.
 * Designed for investor presentations and hackathon demos.
 *
 * Activation:
 *   - URL param: ?judge=true  (activates and persists to localStorage)
 *   - URL param: ?judge=false (deactivates)
 *   - Programmatic: JudgeMode.activate() / JudgeMode.deactivate()
 *
 * When active:
 *   - Nav shows only the pages in JUDGE_PAGES (configurable)
 *   - Trade/Research toggle is replaced with a "LIVE DEMO" badge
 *   - Degen mode toggle is hidden via CSS
 *   - Simulated/hardcoded metrics get a yellow "SIMULATED" label
 *   - body gets class 'judge-mode' for CSS overrides
 *   - Testnet banner is shown at the bottom of the viewport
 *   - Mode is locked to 'trade' (no research toggle)
 *
 * @module JudgeMode
 * @exports {Object} window.JudgeMode
 * @exports {Function} JudgeMode.isActive - Check if judge mode is on
 * @exports {Function} JudgeMode.activate - Enable judge mode
 * @exports {Function} JudgeMode.deactivate - Disable and reload
 * @exports {Function} JudgeMode.filterPages - Filter nav pages for demo flow
 * @exports {string[]} JudgeMode.JUDGE_PAGES - Pages visible in judge mode
 *
 * @dependencies
 *   - localStorage ('xlever-judge-mode', 'xlever-mode')
 *   - Called by nav.js for page filtering and badge rendering
 */
const JudgeMode = (() => {
  /** @type {string} localStorage key for judge mode persistence */
  const STORAGE_KEY = 'xlever-judge-mode';

  /**
   * Page IDs visible in judge mode. Can be narrowed for final demo.
   * @type {string[]}
   */
  const JUDGE_PAGES = ['dashboard', 'trading', 'vaults', 'risk', 'lending', 'analytics', 'agents', 'operations', 'admin'];

  /**
   * Check if judge mode is currently active.
   * URL param (?judge=true/false) takes priority over localStorage.
   * @returns {boolean}
   */
  function isActive() {
    // URL param takes priority
    const params = new URLSearchParams(window.location.search);
    if (params.has('judge')) {
      const val = params.get('judge') !== 'false';
      localStorage.setItem(STORAGE_KEY, val ? '1' : '0');
      return val;
    }
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  /** Activate judge mode and apply all CSS/DOM changes. */
  function activate() {
    localStorage.setItem(STORAGE_KEY, '1');
    apply();
  }

  /** Deactivate judge mode, remove body class, and reload the page. */
  function deactivate() {
    localStorage.setItem(STORAGE_KEY, '0');
    document.body.classList.remove('judge-mode');
    window.location.reload();
  }

  /**
   * Apply judge mode effects to the DOM: add body class, force trade mode,
   * label simulated metrics, and inject judge-mode-specific CSS.
   */
  function apply() {
    if (!isActive()) return;

    document.body.classList.add('judge-mode');

    // Force trade mode so live trading UI is visible
    localStorage.setItem('xlever-mode', 'trade');
    document.body.classList.remove('mode-research');
    document.body.classList.add('mode-trade');

    // Add simulation labels to hardcoded/static metrics
    addSimulationLabels();

    // Inject judge mode CSS
    injectStyles();
  }

  /**
   * Scan the page for hardcoded/static metric sections (e.g., Market Sentiment,
   * Portfolio Allocation) and append yellow "SIMULATED" badges to their headers.
   * @private
   */
  function addSimulationLabels() {
    // Market sentiment gauge — hardcoded Fear/Greed value
    const sentimentHeader = document.querySelector('h2');
    document.querySelectorAll('h2').forEach(h2 => {
      if (h2.textContent.includes('Market Sentiment')) {
        appendSimLabel(h2);
      }
    });

    // Portfolio allocation — static percentages on dashboard
    document.querySelectorAll('h2').forEach(h2 => {
      if (h2.textContent.includes('Portfolio Allocation') || h2.textContent.includes('Allocation')) {
        const section = h2.closest('section');
        if (section && !section.querySelector('.judge-sim-label')) {
          appendSimLabel(h2);
        }
      }
    });
  }

  /**
   * Append a "SIMULATED" badge span to an element (idempotent).
   * @param {HTMLElement} el - Element to append the badge to
   * @private
   */
  function appendSimLabel(el) {
    if (el.querySelector('.judge-sim-label')) return;
    const badge = document.createElement('span');
    badge.className = 'judge-sim-label';
    badge.textContent = 'SIMULATED';
    el.appendChild(badge);
  }

  /**
   * Inject judge-mode-specific CSS rules into the document head.
   * Adds styles for simulation labels, hides degen mode toggles,
   * styles the "Live Demo" badge, step indicators, and testnet banner.
   * Idempotent: skips injection if the style element already exists.
   * @private
   */
  function injectStyles() {
    if (document.getElementById('judge-mode-styles')) return;
    const style = document.createElement('style');
    style.id = 'judge-mode-styles';
    style.textContent = `
      /* ── Judge Mode Overrides ── */

      /* Simulation label badge */
      .judge-sim-label {
        display: inline-block;
        margin-left: 8px;
        padding: 1px 6px;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #ffd740;
        background: rgba(255, 215, 64, 0.1);
        border: 1px solid rgba(255, 215, 64, 0.25);
        border-radius: 4px;
        vertical-align: middle;
        font-family: 'JetBrains Mono', monospace;
      }

      /* Hide degen mode toggle in judge mode */
      body.judge-mode #degenToggle,
      body.judge-mode #degenModeBtn,
      body.judge-mode .degen-toggle,
      body.judge-mode .degen-mode-btn,
      body.judge-mode [data-degen-toggle] {
        display: none !important;
      }

      /* Hide any research-only banners */
      body.judge-mode .mode-banner-research {
        display: none !important;
      }

      /* Judge demo badge in nav */
      .judge-demo-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: #00e676;
        background: rgba(0, 230, 118, 0.08);
        border: 1px solid rgba(0, 230, 118, 0.25);
        border-radius: 8px;
        cursor: default;
        user-select: none;
      }
      .judge-demo-badge::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #00e676;
        animation: judge-pulse 2s ease-in-out infinite;
      }
      @keyframes judge-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      /* Step indicator for linear flow */
      .judge-step {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        font-size: 10px;
        font-weight: 700;
        color: #0a0b0e;
        background: #555970;
        border-radius: 50%;
        margin-right: 6px;
        font-family: 'JetBrains Mono', monospace;
      }
      .judge-step.active {
        background: #00e676;
      }

      /* Testnet banner */
      .judge-testnet-banner {
        position: fixed;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        padding: 6px 20px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 1px;
        color: #ffd740;
        background: rgba(18, 19, 22, 0.95);
        border: 1px solid rgba(255, 215, 64, 0.2);
        border-radius: 8px;
        backdrop-filter: blur(8px);
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Filter navigation pages to only those in the judge demo flow.
   * Called by nav.js to restrict visible pages during demos.
   * @param {Array<{id: string, label: string, href: string, mode: string|null}>} pages - Full page list
   * @returns {Array<{id: string, label: string, href: string, mode: string|null}>} Filtered pages
   */
  function filterPages(pages) {
    if (!isActive()) return pages;
    return pages.filter(p => JUDGE_PAGES.includes(p.id));
  }

  /**
   * Get the HTML for the "Live Demo" badge that replaces the Trade/Research toggle in nav.
   * Called by nav.js when rendering the app navigation bar in judge mode.
   * @returns {string} HTML string for the demo badge element
   */
  function getNavBadge() {
    return '<div class="judge-demo-badge">Live Demo</div>';
  }

  /**
   * Add a fixed-position testnet warning banner at the bottom of the viewport.
   * Reads "INK SEPOLIA TESTNET -- No real funds at risk". Idempotent.
   * @private
   */
  function addTestnetBanner() {
    if (!isActive()) return;
    if (document.querySelector('.judge-testnet-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'judge-testnet-banner';
    banner.textContent = 'INK SEPOLIA TESTNET — No real funds at risk';
    document.body.appendChild(banner);
  }

  /**
   * Initialize judge mode if active. Applies DOM changes and adds testnet banner.
   * Called automatically on DOMContentLoaded.
   */
  function init() {
    if (!isActive()) return;
    apply();
    // Add testnet banner after DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', addTestnetBanner);
    } else {
      addTestnetBanner();
    }
  }

  return { isActive, activate, deactivate, apply, init, filterPages, getNavBadge, JUDGE_PAGES };
})();

window.JudgeMode = JudgeMode;

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => JudgeMode.init());
} else {
  JudgeMode.init();
}
