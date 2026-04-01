/**
 * xLever Shared Navigation
 * Renders the top nav bar, mobile drawer, and risk sentinel banner.
 * Include this script on every page and call XNav.init('pageName').
 */
const XNav = (() => {
  // Pages are tagged with a mode so the nav shows only relevant links.
  // mode: 'trade' = live wallet actions, 'research' = simulations/education, null = both modes
  const PAGES = [
    { id: 'dashboard',  label: 'Dashboard',  href: '01-dashboard.html',              mode: 'trade' },
    { id: 'trading',    label: 'Trading',     href: '02-trading-terminal.html',       mode: 'trade' },
    { id: 'vaults',     label: 'Vaults',      href: '04-vault-management.html',       mode: 'trade' },
    { id: 'risk',       label: 'Risk',        href: '05-risk-management.html',        mode: 'trade' },
    { id: 'lending',    label: 'Lending',     href: '09-lending-borrowing.html',      mode: 'trade' },
    { id: 'analytics',  label: 'Analytics',   href: '06-analytics-backtesting.html',  mode: 'research' },
    { id: 'agents',     label: 'AI Agents',   href: '03-ai-agent-operations.html',    mode: 'research' },
    { id: 'operations', label: 'Operations',  href: '07-operations-control.html',     mode: null },
    { id: 'admin',      label: 'Admin',       href: '08-admin-dashboard.html',        mode: null },
  ];

  function getMode() {
    return localStorage.getItem('xlever-mode') || 'trade';
  }

  function pagesForMode(mode) {
    return PAGES.filter(p => p.mode === mode || p.mode === null);
  }

  function init(activePageId) {
    renderNav(activePageId);
    renderMobileDrawer(activePageId);

    wireUpMobileMenu();
    wireUpNetworkSwitcher();
    wireUpModeToggle(activePageId);
  }

  function navLink(page, isActive) {
    if (isActive) {
      return `<a class="text-[#e3e2e6] font-['DM_Sans'] text-[13px] font-semibold px-3 py-1.5 rounded bg-[#1a1d26] border border-[#252833]" href="${page.href}">${page.label}</a>`;
    }
    return `<a class="text-[#555970] hover:text-[#e3e2e6] font-['DM_Sans'] text-[13px] font-medium px-3 py-1.5 rounded transition-colors" href="${page.href}">${page.label}</a>`;
  }

  function mobileLink(page, isActive) {
    if (isActive) {
      return `<a class="text-[#e3e2e6] font-['DM_Sans'] text-sm font-semibold px-4 py-2.5 rounded bg-[#1a1d26] border border-[#252833]" href="${page.href}">${page.label}</a>`;
    }
    return `<a class="text-[#555970] font-['DM_Sans'] text-sm font-medium px-4 py-2.5 rounded hover:bg-[#12141a] transition-colors" href="${page.href}">${page.label}</a>`;
  }

  function renderNav(activeId) {
    const mode = getMode();
    const visiblePages = pagesForMode(mode);
    const nav = document.createElement('nav');
    nav.id = 'xnav';
    nav.className = 'bg-[#0a0b0e] flex justify-between items-center w-full px-6 h-14 border-b border-[#252833] fixed top-0 z-50';
    nav.innerHTML = `
      <div class="flex items-center gap-10">
        <a href="index.html" class="font-['JetBrains_Mono'] text-lg font-bold tracking-tighter no-underline">
          <span class="text-[#e3e2e6]">x</span><span class="text-[#7c4dff]">Lever</span>
        </a>
        <div class="mode-toggle" style="display:flex;gap:2px;background:#0a0b0e;border:1px solid #252833;border-radius:8px;padding:2px;">
          <button class="nav-mode-btn${mode === 'trade' ? ' active' : ''}" data-mode="trade"
            style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;transition:all 0.2s;${mode === 'trade' ? 'background:#00e676;color:#0a0b0e;' : 'background:transparent;color:#555970;'}">Trade</button>
          <button class="nav-mode-btn${mode === 'research' ? ' active' : ''}" data-mode="research"
            style="font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;border:none;cursor:pointer;transition:all 0.2s;${mode === 'research' ? 'background:#7c4dff;color:#fff;' : 'background:transparent;color:#555970;'}">Research</button>
        </div>
        <div class="hidden md:flex gap-1 items-center" id="navLinks">
          ${visiblePages.map(p => navLink(p, p.id === activeId)).join('\n          ')}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="hidden sm:flex items-center gap-2 bg-[#12141a] px-3 py-1.5 border border-[#252833] rounded">
          <div class="w-2 h-2 rounded-full bg-[#00e676] animate-pulse"></div>
          <span class="font-['JetBrains_Mono'] text-[10px] text-[#8b8fa3] uppercase tracking-widest cursor-pointer" id="networkBadgeText">Ink Sepolia</span>
        </div>
        <appkit-button size="sm"></appkit-button>
        <button class="md:hidden flex items-center justify-center w-9 h-9 rounded border border-[#252833] bg-[#12141a] text-[#8b8fa3] hover:text-[#e3e2e6] transition-colors" id="mobileMenuBtn" aria-label="Menu">
          <span class="material-symbols-outlined text-xl" id="mobileMenuIcon">menu</span>
        </button>
      </div>
    `;
    document.body.prepend(nav);
  }

  function renderMobileDrawer(activeId) {
    const drawer = document.createElement('div');
    drawer.id = 'mobileNav';
    drawer.className = 'md:hidden fixed top-14 left-0 right-0 z-50 bg-[#0a0b0e] border-b border-[#252833] hidden';
    drawer.style.transition = 'all 0.25s ease';
    drawer.innerHTML = `
      <div class="flex flex-col p-3 gap-1">
        ${PAGES.map(p => mobileLink(p, p.id === activeId)).join('\n        ')}
        <div class="flex items-center gap-2 mt-2 px-4 py-2">
          <div class="w-2 h-2 rounded-full bg-[#00e676] animate-pulse"></div>
          <span class="font-['JetBrains_Mono'] text-[10px] text-[#8b8fa3] uppercase tracking-widest" id="networkBadgeMobile">Ink Sepolia</span>
        </div>
      </div>
    `;
    const nav = document.getElementById('xnav');
    if (nav) nav.after(drawer);
  }


  // Chain display names keyed by caipNetworkId or chainId
  const CHAIN_NAMES = {
    763373: 'Ink Sepolia',
    1: 'Ethereum',
    'solana:mainnet': 'Solana',
    'ton:mainnet': 'TON',
  };

  function updateNetworkBadge(name) {
    const desktop = document.getElementById('networkBadgeText');
    const mobile = document.getElementById('networkBadgeMobile');
    if (desktop) desktop.textContent = name;
    if (mobile) mobile.textContent = name;
  }

  function wireUpNetworkSwitcher() {
    // Click badge to open AppKit network selector
    const badge = document.getElementById('networkBadgeText');
    if (badge && window.xLeverWallet) {
      badge.addEventListener('click', () => window.xLeverWallet.open({ view: 'Networks' }));
    }

    // Listen for chain changes via AppKit subscriptions
    if (window.xLeverWallet) {
      window.xLeverWallet.subscribeCaipNetworkChange((newNetwork) => {
        if (!newNetwork) return;
        const name = CHAIN_NAMES[newNetwork.id] || CHAIN_NAMES[newNetwork.caipNetworkId] || newNetwork.name || 'Unknown';
        updateNetworkBadge(name);

        // Sync lending adapter registry to the selected chain
        const registry = window.xLeverLendingAdapters;
        if (registry) {
          const chain = registry.resolveChainFromNetwork(newNetwork.id) || registry.resolveChainFromNetwork(newNetwork.caipNetworkId);
          if (chain) {
            registry.setActiveChain(chain);
            // Hot-swap the lending agent if it's running
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

  return { init };
})();

window.XNav = XNav;
