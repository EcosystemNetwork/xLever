/**
 * @file nav.js — xLever Unified Navigation (XNav component)
 *
 * Provides a single responsive navigation bar that operates in two modes:
 *   - Landing mode: logo + Features/Docs/GitHub links + "Launch App" CTA
 *   - App mode: logo + Trade/Research toggle + page tabs + network badge + wallet button
 *
 * Also supports Judge Mode, which replaces the mode toggle with a "Live Demo" badge
 * and filters visible pages to a curated demo flow.
 *
 * @module XNav
 * @exports {Object} XNav - Singleton exposed on window.XNav
 * @exports {Function} XNav.init - Initialize the nav bar for a given page
 * @exports {Function} XNav.enterApp - Transition from landing mode to app mode
 *
 * @dependencies
 *   - localStorage ('xlever-mode') for persisted mode preference
 *   - window.JudgeMode (optional) for demo mode filtering
 *   - window.XMode (optional) for mode synchronization
 *   - window.xLeverWallet (optional) for Reown AppKit network switching
 *   - window.xLeverLendingAdapters (optional) for chain-aware adapter switching
 *   - window.xLeverLendingAgent (optional) for agent chain hot-swap
 */
const XNav = (() => {
  /**
   * Page definitions for the app navigation.
   * Each entry maps a page ID to its label, href, and which mode it belongs to.
   * Pages with mode=null are visible in all modes (e.g., Admin).
   * @type {Array<{id: string, label: string, href: string, mode: string|null}>}
   */
  const PAGES = [
    { id: 'dashboard',  label: 'Dashboard',  href: '01-dashboard.html',              mode: 'trade' },
    { id: 'trading',    label: 'Trading',     href: '02-trading-terminal.html',       mode: 'trade' },
    { id: 'agents',     label: 'AI Agents',   href: '03-ai-agent-operations.html',    mode: 'research' },
    { id: 'admin',      label: 'Admin',       href: '08-admin-dashboard.html',        mode: null },
  ];

  /** @type {string|null} Currently active page ID, or null for landing */
  let _activePageId = null;
  /** @type {boolean} Whether the nav is in landing mode (no app chrome) */
  let _isLanding = false;
  /** @type {boolean} Whether Judge Mode is active (curated demo flow) */
  let _isJudgeMode = false;

  /**
   * Read the current UI mode from localStorage.
   * @returns {string} 'trade' or 'research'
   */
  function getMode() {
    return localStorage.getItem('xlever-mode') || 'trade';
  }

  /**
   * Filter PAGES to those visible in the given mode.
   * In Judge Mode, delegates filtering to JudgeMode.filterPages().
   * @param {string} mode - 'trade' or 'research'
   * @returns {Array<{id: string, label: string, href: string, mode: string|null}>}
   */
  function pagesForMode(mode) {
    // Judge mode overrides: only show the core demo flow
    if (window.JudgeMode && window.JudgeMode.isActive()) {
      return window.JudgeMode.filterPages(PAGES);
    }
    return PAGES.filter(p => p.mode === mode || p.mode === null);
  }

  /**
   * Initialize the navigation bar.
   * Pass null for landing page, or a page ID string for app pages.
   * Renders both desktop and mobile nav, wires up event handlers.
   * @param {string|null} activePageId - The ID of the current page, or null for landing
   */
  function init(activePageId) {
    _activePageId = activePageId;
    _isLanding = (activePageId === null);
    _isJudgeMode = !!(window.JudgeMode && window.JudgeMode.isActive());

    const mode = getMode();
    document.body.classList.add(`mode-${mode}`);

    renderNav(activePageId);
    renderMobileDrawer(activePageId);
    wireUpMobileMenu();
    wireUpNetworkSwitcher();
    wireUpModeToggle(activePageId);
  }

  /** Transition from landing → app nav (called by Launch App button) */
  function enterApp() {
    _isLanding = false;
    const nav = document.getElementById('xnav');
    if (nav) nav.remove();
    const drawer = document.getElementById('mobileNav');
    if (drawer) drawer.remove();

    renderNav(_activePageId);
    renderMobileDrawer(_activePageId);
    wireUpMobileMenu();
    wireUpModeToggle(_activePageId);
  }

  /**
   * Generate an HTML anchor string for a desktop nav link.
   * Active links get a highlighted background; inactive links are muted.
   * In Judge Mode, prepends a numbered step indicator badge.
   * @param {{id: string, label: string, href: string}} page - Page definition
   * @param {boolean} isActive - Whether this page is the current page
   * @returns {string} HTML string for the link element
   */
  function navLink(page, isActive) {
    // In judge mode, add step numbers for the linear flow
    let stepHtml = '';
    if (_isJudgeMode && window.JudgeMode) {
      const stepIdx = window.JudgeMode.JUDGE_PAGES.indexOf(page.id);
      if (stepIdx !== -1) {
        stepHtml = `<span class="judge-step${isActive ? ' active' : ''}">${stepIdx + 1}</span>`;
      }
    }
    if (isActive) {
      return `<a class="text-[#e3e2e6] font-['DM_Sans'] text-sm font-semibold px-4 py-2 rounded bg-[#1a1d26] border border-[#252833] flex items-center" href="${page.href}">${stepHtml}${page.label}</a>`;
    }
    return `<a class="text-[#555970] hover:text-[#e3e2e6] font-['DM_Sans'] text-sm font-medium px-4 py-2 rounded transition-colors flex items-center" href="${page.href}">${stepHtml}${page.label}</a>`;
  }

  /**
   * Generate an HTML anchor string for a mobile drawer nav link.
   * @param {{id: string, label: string, href: string}} page - Page definition
   * @param {boolean} isActive - Whether this page is the current page
   * @returns {string} HTML string for the mobile link element
   */
  function mobileLink(page, isActive) {
    if (isActive) {
      return `<a class="text-[#e3e2e6] font-['DM_Sans'] text-sm font-semibold px-4 py-2.5 rounded bg-[#1a1d26] border border-[#252833]" href="${page.href}">${page.label}</a>`;
    }
    return `<a class="text-[#555970] font-['DM_Sans'] text-sm font-medium px-4 py-2.5 rounded hover:bg-[#12141a] transition-colors" href="${page.href}">${page.label}</a>`;
  }

  /**
   * Build and prepend the desktop navigation bar to the document body.
   * Renders either landing mode (minimal links + Launch App CTA) or
   * app mode (mode toggle + page tabs + network badge + wallet).
   * @param {string|null} activeId - The currently active page ID
   */
  function renderNav(activeId) {
    const mode = getMode();
    const nav = document.createElement('nav');
    nav.id = 'xnav';
    nav.className = 'bg-[#0a0b0e] flex justify-between items-center w-full px-8 h-16 border-b border-[#252833] fixed top-0 z-50';
    nav.style.transition = 'all 0.3s ease';

    if (_isLanding) {
      // ── Landing mode: clean & minimal ──
      nav.innerHTML = `
        <div class="flex items-center gap-10">
          <a href="index.html" class="font-['JetBrains_Mono'] text-xl font-bold tracking-tighter no-underline">
            <span class="text-[#e3e2e6]">x</span><span class="text-[#7c4dff]">Lever</span>
          </a>
          <div class="hidden sm:flex items-center gap-6">
            <a href="#features" class="text-[#555970] hover:text-[#e3e2e6] font-['DM_Sans'] text-sm font-medium transition-colors no-underline">Features</a>
            <a href="https://github.com/madschristensen99/xLever/tree/main/docs" target="_blank" class="text-[#555970] hover:text-[#e3e2e6] font-['DM_Sans'] text-sm font-medium transition-colors no-underline">Docs</a>
            <a href="https://github.com/madschristensen99/xLever" target="_blank" class="text-[#555970] hover:text-[#e3e2e6] font-['DM_Sans'] text-sm font-medium transition-colors no-underline">GitHub</a>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <a href="#" id="navLaunchAppBtn" class="inline-flex items-center gap-2 bg-[#7c4dff] hover:bg-[#6a3de8] text-white font-['DM_Sans'] text-[15px] font-semibold px-6 py-2.5 rounded-lg transition-all no-underline" style="transform: translateY(0); transition: all 0.2s;">
            Launch App <span style="font-size:16px">→</span>
          </a>
          <button class="md:hidden flex items-center justify-center w-9 h-9 rounded border border-[#252833] bg-[#12141a] text-[#8b8fa3] hover:text-[#e3e2e6] transition-colors" id="mobileMenuBtn" aria-label="Menu">
            <span class="material-symbols-outlined text-xl" id="mobileMenuIcon">menu</span>
          </button>
        </div>
      `;
    } else {
      // ── App mode: full nav ──
      const visiblePages = pagesForMode(mode);
      nav.innerHTML = `
        <div class="flex items-center gap-6">
          <a href="index.html" class="font-['JetBrains_Mono'] text-xl font-bold tracking-tighter no-underline">
            <span class="text-[#e3e2e6]">x</span><span class="text-[#7c4dff]">Lever</span>
          </a>
          ${_isJudgeMode
            ? '<div class="judge-demo-badge">Live Demo</div>'
            : `<div class="mode-toggle" style="display:flex;gap:2px;background:#0a0b0e;border:1px solid #252833;border-radius:8px;padding:2px;">
            <button class="nav-mode-btn${mode === 'trade' ? ' active' : ''}" data-mode="trade"
              style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;transition:all 0.2s;${mode === 'trade' ? 'background:#00e676;color:#0a0b0e;' : 'background:transparent;color:#555970;'}">Trade</button>
            <button class="nav-mode-btn${mode === 'research' ? ' active' : ''}" data-mode="research"
              style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;transition:all 0.2s;${mode === 'research' ? 'background:#7c4dff;color:#fff;' : 'background:transparent;color:#555970;'}">Research</button>
          </div>`}
          <div class="hidden md:flex gap-1 items-center" id="navLinks">
            ${visiblePages.map(p => navLink(p, p.id === activeId)).join('\n            ')}
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="hidden sm:flex items-center gap-2 bg-[#12141a] px-3.5 py-2 border border-[#252833] rounded">
            <div class="w-2 h-2 rounded-full bg-[#00e676] animate-pulse"></div>
            <span class="font-['JetBrains_Mono'] text-[11px] text-[#8b8fa3] uppercase tracking-widest cursor-pointer" id="networkBadgeText">Ink Sepolia</span>
          </div>
          <appkit-button size="md"></appkit-button>
          <button class="md:hidden flex items-center justify-center w-9 h-9 rounded border border-[#252833] bg-[#12141a] text-[#8b8fa3] hover:text-[#e3e2e6] transition-colors" id="mobileMenuBtn" aria-label="Menu">
            <span class="material-symbols-outlined text-xl" id="mobileMenuIcon">menu</span>
          </button>
        </div>
      `;
    }

    document.body.prepend(nav);

    // Hide the Reown AppKit loading spinner inside shadow DOM
    killAppkitSpinner();
  }

  function killAppkitSpinner() {
    const css = `wui-loading-spinner { display: none !important; }
      wui-loading-hexagon { display: none !important; }`;
    const poll = setInterval(() => {
      document.querySelectorAll('appkit-button, appkit-connect-button, w3m-button').forEach(el => {
        const roots = [el.shadowRoot];
        while (roots.length) {
          const root = roots.pop();
          if (!root || root.querySelector('[data-xlever-no-spin]')) continue;
          const s = document.createElement('style');
          s.textContent = css;
          s.setAttribute('data-xlever-no-spin', '');
          root.appendChild(s);
          root.querySelectorAll('*').forEach(child => { if (child.shadowRoot) roots.push(child.shadowRoot); });
        }
      });
    }, 500);
    setTimeout(() => clearInterval(poll), 15000);
  }

  /**
   * Build and insert the mobile navigation drawer below the nav bar.
   * Hidden by default; toggled via the hamburger menu button.
   * @param {string|null} activeId - The currently active page ID
   */
  function renderMobileDrawer(activeId) {
    const mode = getMode();
    const drawer = document.createElement('div');
    drawer.id = 'mobileNav';
    drawer.className = 'md:hidden fixed top-16 left-0 right-0 z-50 bg-[#0a0b0e] border-b border-[#252833] hidden';
    drawer.style.transition = 'all 0.25s ease';

    if (_isLanding) {
      drawer.innerHTML = `
        <div class="flex flex-col p-3 gap-1">
          <a href="#features" class="text-[#555970] font-['DM_Sans'] text-sm font-medium px-4 py-2.5 rounded hover:bg-[#12141a] transition-colors no-underline">Features</a>
          <a href="https://github.com/madschristensen99/xLever/tree/main/docs" target="_blank" class="text-[#555970] font-['DM_Sans'] text-sm font-medium px-4 py-2.5 rounded hover:bg-[#12141a] transition-colors no-underline">Docs</a>
          <a href="https://github.com/madschristensen99/xLever" target="_blank" class="text-[#555970] font-['DM_Sans'] text-sm font-medium px-4 py-2.5 rounded hover:bg-[#12141a] transition-colors no-underline">GitHub</a>
          <a href="#" id="mobileLaunchAppBtn" class="text-[#7c4dff] font-['DM_Sans'] text-sm font-semibold px-4 py-2.5 rounded hover:bg-[#12141a] transition-colors no-underline">Launch App →</a>
        </div>
      `;
    } else {
      const visiblePages = pagesForMode(mode);
      drawer.innerHTML = `
        <div class="flex flex-col p-3 gap-1" id="mobileNavLinks">
          ${visiblePages.map(p => mobileLink(p, p.id === activeId)).join('\n          ')}
          <div class="flex items-center gap-2 mt-2 px-4 py-2">
            <div class="w-2 h-2 rounded-full bg-[#00e676] animate-pulse"></div>
            <span class="font-['JetBrains_Mono'] text-[10px] text-[#8b8fa3] uppercase tracking-widest" id="networkBadgeMobile">Ink Sepolia</span>
          </div>
        </div>
      `;
    }

    const nav = document.getElementById('xnav');
    if (nav) nav.after(drawer);
  }

  /**
   * Mapping of chain IDs (numeric or CAIP) to display names for the network badge.
   * @type {Object<number|string, string>}
   */
  const CHAIN_NAMES = {
    763373: 'Ink Sepolia',
    1: 'Ethereum',
    'solana:mainnet': 'Solana',
    'ton:mainnet': 'TON',
  };

  /**
   * Update the network name text in both desktop and mobile badge elements.
   * @param {string} name - Network display name (e.g., "Ink Sepolia")
   */
  function updateNetworkBadge(name) {
    const desktop = document.getElementById('networkBadgeText');
    const mobile = document.getElementById('networkBadgeMobile');
    if (desktop) desktop.textContent = name;
    if (mobile) mobile.textContent = name;
  }

  /**
   * Wire up the network badge click handler and subscribe to Reown AppKit
   * CAIP network change events. On network switch, updates the badge text
   * and propagates the chain change to the lending adapter registry and agent.
   */
  function wireUpNetworkSwitcher() {
    const badge = document.getElementById('networkBadgeText');
    if (badge && window.xLeverWallet) {
      badge.addEventListener('click', () => window.xLeverWallet.open({ view: 'Networks' }));
    }

    if (window.xLeverWallet) {
      window.xLeverWallet.subscribeCaipNetworkChange((newNetwork) => {
        if (!newNetwork) return;
        const name = CHAIN_NAMES[newNetwork.id] || CHAIN_NAMES[newNetwork.caipNetworkId] || newNetwork.name || 'Unknown';
        updateNetworkBadge(name);

        const registry = window.xLeverLendingAdapters;
        if (registry) {
          const chain = registry.resolveChainFromNetwork(newNetwork.id) || registry.resolveChainFromNetwork(newNetwork.caipNetworkId);
          if (chain) {
            registry.setActiveChain(chain);
            if (window.xLeverLendingAgent?.isRunning()) {
              window.xLeverLendingAgent.switchChain(chain);
            }
          }
        }
      });
    }
  }

  /**
   * Attach click handlers to the Trade/Research mode toggle buttons.
   * On mode switch: persists to localStorage, re-renders nav links,
   * updates body class, and notifies XMode if available.
   * @param {string|null} activeId - The currently active page ID
   */
  function wireUpModeToggle(activeId) {
    document.querySelectorAll('.nav-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode;
        localStorage.setItem('xlever-mode', newMode);

        document.querySelectorAll('.nav-mode-btn').forEach(b => {
          b.classList.remove('active');
          b.style.background = 'transparent';
          b.style.color = '#555970';
        });
        btn.classList.add('active');
        if (newMode === 'trade') {
          btn.style.background = '#00e676'; btn.style.color = '#0a0b0e';
        } else {
          btn.style.background = '#7c4dff'; btn.style.color = '#fff';
        }

        const visiblePages = pagesForMode(newMode);
        const navLinks = document.getElementById('navLinks');
        if (navLinks) {
          navLinks.innerHTML = visiblePages.map(p => navLink(p, p.id === activeId)).join('\n');
        }
        const mobileNavLinks = document.getElementById('mobileNavLinks');
        if (mobileNavLinks) {
          const networkBadge = `<div class="flex items-center gap-2 mt-2 px-4 py-2"><div class="w-2 h-2 rounded-full bg-[#00e676] animate-pulse"></div><span class="font-['JetBrains_Mono'] text-[10px] text-[#8b8fa3] uppercase tracking-widest" id="networkBadgeMobile">Ink Sepolia</span></div>`;
          mobileNavLinks.innerHTML = visiblePages.map(p => mobileLink(p, p.id === activeId)).join('\n') + networkBadge;
        }

        if (window.XMode) window.XMode.set(newMode);

        document.body.classList.remove('mode-trade', 'mode-research');
        document.body.classList.add(`mode-${newMode}`);
      });
    });
  }

  /**
   * Wire up the mobile hamburger menu button to toggle the mobile drawer
   * visibility and swap the icon between "menu" and "close".
   */
  function wireUpMobileMenu() {
    const btn = document.getElementById('mobileMenuBtn');
    const nav = document.getElementById('mobileNav');
    const icon = document.getElementById('mobileMenuIcon');
    if (btn && nav) {
      btn.addEventListener('click', () => {
        const isHidden = nav.classList.toggle('hidden');
        icon.textContent = isHidden ? 'menu' : 'close';
      });
    }
  }

  return { init, enterApp };
})();

window.XNav = XNav;
