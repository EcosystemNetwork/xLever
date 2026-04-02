/**
 * @file nav.js — xLever Unified Navigation (XNav component)
 */
const XNav = (() => {
  const PAGES = [
    { id: 'trading',    label: 'Trading',     href: '02-trading-terminal.html' },
    { id: 'agents',     label: 'AI Agents',   href: '03-ai-agent-operations.html' },
    { id: 'vaults',     label: 'Vaults',      href: '04-vault-management.html' },
    // { id: 'admin',      label: 'Admin',       href: '08-admin-dashboard.html' },
  ];

  let _activePageId = null;
  let _isLanding = false;
  let _isJudgeMode = false;

  function getVisiblePages() {
    if (window.JudgeMode && window.JudgeMode.isActive()) {
      return window.JudgeMode.filterPages(PAGES);
    }
    return PAGES;
  }

  function injectFavicon() {
    if (!document.querySelector('link[rel="icon"]')) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      link.href = '/xlogo.png';
      document.head.appendChild(link);
    }
  }

  function init(activePageId) {
    _activePageId = activePageId;
    _isLanding = (activePageId === null);
    _isJudgeMode = !!(window.JudgeMode && window.JudgeMode.isActive());

    injectFavicon();
    injectNavStyles();
    renderNav(activePageId);
    renderMobileDrawer(activePageId);
    wireUpMobileMenu();
    wireUpNetworkSwitcher();
  }

  function enterApp() {
    _isLanding = false;
    const nav = document.getElementById('xnav');
    if (nav) nav.remove();
    const drawer = document.getElementById('mobileNav');
    if (drawer) drawer.remove();

    renderNav(_activePageId);
    renderMobileDrawer(_activePageId);
    wireUpMobileMenu();
  }

  /** Inject scoped nav styles once */
  function injectNavStyles() {
    if (document.getElementById('xnav-styles')) return;
    const style = document.createElement('style');
    style.id = 'xnav-styles';
    style.textContent = `
      #xnav {
        background: rgba(10, 11, 14, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        padding: 0 32px;
        height: 72px;
        border-bottom: 1px solid #1e2030;
        position: fixed;
        top: 0;
        z-index: 50;
      }
      #xnav .nav-logo {
        text-decoration: none;
        display: flex;
        align-items: center;
      }
      #xnav .nav-logo img {
        height: 112px;
        width: auto;
      }

      #xnav .nav-link {
        font-family: 'DM Sans', sans-serif;
        font-size: 15px;
        font-weight: 500;
        color: #6b7094;
        text-decoration: none;
        padding: 8px 18px;
        border-radius: 6px;
        transition: color 0.15s, background 0.15s;
        white-space: nowrap;
      }
      #xnav .nav-link:hover { color: #e3e2e6; background: rgba(255,255,255,0.04); }
      #xnav .nav-link.active {
        color: #e3e2e6;
        font-weight: 600;
        background: #1a1d26;
        border: 1px solid #252833;
      }

      #xnav .nav-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: #7c4dff;
        color: #fff;
        font-family: 'DM Sans', sans-serif;
        font-size: 15px;
        font-weight: 600;
        padding: 10px 24px;
        border-radius: 8px;
        text-decoration: none;
        transition: all 0.2s;
        white-space: nowrap;
        box-shadow: 0 0 16px rgba(124,77,255,0.15), 0 1px 4px rgba(0,0,0,0.2);
      }
      #xnav .nav-cta:hover { background: #6a3de8; transform: translateY(-1px); box-shadow: 0 0 24px rgba(124,77,255,0.25), 0 2px 8px rgba(0,0,0,0.3); }

      #xnav .nav-network {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #12141a;
        padding: 6px 12px;
        border: 1px solid #1e2030;
        border-radius: 6px;
        cursor: pointer;
      }
      #xnav .nav-network .dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: #00e676;
        animation: xnav-pulse 2s infinite;
      }
      #xnav .nav-network span {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        color: #6b7094;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      @keyframes xnav-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

      #xnav .nav-left, #xnav .nav-right {
        display: flex;
        align-items: center;
      }
      #xnav .nav-left { gap: 24px; }
      #xnav .nav-right { gap: 12px; }
      #xnav .nav-links { display: flex; gap: 2px; align-items: center; }

      #xnav .hamburger {
        display: none;
        align-items: center;
        justify-content: center;
        width: 36px; height: 36px;
        border-radius: 6px;
        border: 1px solid #1e2030;
        background: #12141a;
        color: #6b7094;
        cursor: pointer;
        transition: color 0.15s;
      }
      #xnav .hamburger:hover { color: #e3e2e6; }
      @media (max-width: 768px) {
        #xnav .nav-links, #xnav .nav-network, #xnav .desktop-only { display: none !important; }
        #xnav .hamburger { display: flex; }
      }

      #mobileNav {
        position: fixed;
        top: 56px;
        left: 0; right: 0;
        z-index: 50;
        background: rgba(10, 11, 14, 0.96);
        backdrop-filter: blur(20px);
        border-bottom: 1px solid #1e2030;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #mobileNav.hidden { display: none; }
      #mobileNav a {
        font-family: 'DM Sans', sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: #6b7094;
        text-decoration: none;
        padding: 10px 16px;
        border-radius: 8px;
        transition: color 0.15s, background 0.15s;
      }
      #mobileNav a:hover { color: #e3e2e6; background: rgba(255,255,255,0.04); }
      #mobileNav a.active { color: #e3e2e6; font-weight: 600; background: #1a1d26; border: 1px solid #252833; }
    `;
    document.head.appendChild(style);
  }

  function navLink(page, isActive) {
    let stepHtml = '';
    if (_isJudgeMode && window.JudgeMode) {
      const stepIdx = window.JudgeMode.JUDGE_PAGES.indexOf(page.id);
      if (stepIdx !== -1) {
        stepHtml = `<span class="judge-step${isActive ? ' active' : ''}">${stepIdx + 1}</span>`;
      }
    }
    return `<a class="nav-link${isActive ? ' active' : ''}" href="${page.href}">${stepHtml}${page.label}</a>`;
  }

  function mobileLink(page, isActive) {
    return `<a class="${isActive ? 'active' : ''}" href="${page.href}">${page.label}</a>`;
  }

  function renderNav(activeId) {
    const nav = document.createElement('nav');
    nav.id = 'xnav';

    if (_isLanding) {
      nav.innerHTML = `
        <div class="nav-left">
          <a href="index.html" class="nav-logo"><img src="/logowors.png" alt="xLever"></a>
          <div class="nav-links desktop-only">
            <a class="nav-link" href="https://github.com/madschristensen99/xLever/tree/main/docs" target="_blank">Docs</a>
            <a class="nav-link" href="https://github.com/madschristensen99/xLever" target="_blank">GitHub</a>
          </div>
        </div>
        <div class="nav-right">
          <a href="#" id="navLaunchAppBtn" class="nav-cta">Launch App <span>→</span></a>
          <button class="hamburger" id="mobileMenuBtn" aria-label="Menu">
            <span class="material-symbols-outlined" style="font-size:20px" id="mobileMenuIcon">menu</span>
          </button>
        </div>
      `;
    } else {
      const visiblePages = getVisiblePages();
      const judgeBadge = _isJudgeMode ? '<div class="judge-demo-badge">Live Demo</div>' : '';

      nav.innerHTML = `
        <div class="nav-left">
          <a href="index.html" class="nav-logo"><img src="/logowors.png" alt="xLever"></a>
          ${judgeBadge}
          <div class="nav-links" id="navLinks">
            ${visiblePages.map(p => navLink(p, p.id === activeId)).join('')}
          </div>
        </div>
        <div class="nav-right">
          <div class="nav-network desktop-only" id="networkBadge">
            <div class="dot"></div>
            <span id="networkBadgeText">Ink Sepolia</span>
          </div>
          <appkit-button size="sm"></appkit-button>
          <button class="hamburger" id="mobileMenuBtn" aria-label="Menu">
            <span class="material-symbols-outlined" style="font-size:20px" id="mobileMenuIcon">menu</span>
          </button>
        </div>
      `;
    }

    document.body.prepend(nav);
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

  function renderMobileDrawer(activeId) {
    const drawer = document.createElement('div');
    drawer.id = 'mobileNav';
    drawer.className = 'hidden';

    if (_isLanding) {
      drawer.innerHTML = `
        <a href="https://github.com/madschristensen99/xLever/tree/main/docs" target="_blank">Docs</a>
        <a href="https://github.com/madschristensen99/xLever" target="_blank">GitHub</a>
        <a href="#" id="mobileLaunchAppBtn" style="color:#7c4dff;font-weight:600">Launch App →</a>
      `;
    } else {
      const visiblePages = getVisiblePages();
      drawer.innerHTML = `
        <div id="mobileNavLinks">
          ${visiblePages.map(p => mobileLink(p, p.id === activeId)).join('')}
        </div>
      `;
    }

    const nav = document.getElementById('xnav');
    if (nav) nav.after(drawer);
  }

  const CHAIN_NAMES = {
    763373: 'Ink Sepolia',
    11155111: 'Ethereum Sepolia',
  };

  function updateNetworkBadge(name) {
    const desktop = document.getElementById('networkBadgeText');
    const mobile = document.getElementById('networkBadgeMobile');
    if (desktop) desktop.textContent = name;
    if (mobile) mobile.textContent = name;
  }

  function wireUpNetworkSwitcher() {
    const badge = document.getElementById('networkBadge');
    if (badge && window.xLeverWallet) {
      badge.addEventListener('click', () => window.xLeverWallet.open({ view: 'Networks' }));
    }

    if (window.xLeverWallet) {
      window.xLeverWallet.subscribeCaipNetworkChange((newNetwork) => {
        if (!newNetwork) return;
        const name = CHAIN_NAMES[newNetwork.id] || CHAIN_NAMES[newNetwork.caipNetworkId] || newNetwork.name || 'Unknown';
        updateNetworkBadge(name);

        // Switch contracts module to the new chain
        const numericId = typeof newNetwork.id === 'number' ? newNetwork.id : parseInt(newNetwork.id, 10);
        if (CHAIN_NAMES[numericId] && window.xLeverContracts?.switchChain) {
          try { window.xLeverContracts.switchChain(numericId); } catch (e) { /* swallow */ }
        }

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
