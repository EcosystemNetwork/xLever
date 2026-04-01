/**
 * xLever Unified Navigation
 * One nav bar for landing page AND app — consumer-grade flow.
 *
 * Landing mode:  logo + Features/GitHub/Launch App (clean, minimal)
 * App mode:      logo + Trade/Research toggle + page links + network + wallet
 *
 * Call XNav.init(null) on index.html (starts in landing mode).
 * Call XNav.init('pageName') on any sub-page (starts in app mode).
 * Call XNav.enterApp() to transition from landing → app.
 */
const XNav = (() => {
  const PAGES = [
    { id: 'dashboard',  label: 'Dashboard',  href: '01-dashboard.html',              mode: 'trade' },
    { id: 'trading',    label: 'Trading',     href: 'index.html',                     mode: 'trade' },
    { id: 'auto',       label: 'Autonomous',  href: '03-ai-agent-operations.html',    mode: 'trade' },
  ];

  let _activePageId = null;
  let _isLanding = false;

  function getMode() {
    return localStorage.getItem('xlever-mode') || 'trade';
  }

  function pagesForMode(mode) {
    return PAGES.filter(p => p.mode === mode || p.mode === null);
  }

  function init(activePageId) {
    _activePageId = activePageId;
    _isLanding = (activePageId === null);

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
    const nav = document.createElement('nav');
    nav.id = 'xnav';
    nav.className = 'bg-[#0a0b0e] flex justify-between items-center w-full px-6 h-14 border-b border-[#252833] fixed top-0 z-50';
    nav.style.transition = 'all 0.3s ease';

    if (_isLanding) {
      // ── Landing mode: clean & minimal ──
      nav.innerHTML = `
        <div class="flex items-center gap-10">
          <a href="index.html" class="font-['JetBrains_Mono'] text-lg font-bold tracking-tighter no-underline">
            <span class="text-[#e3e2e6]">x</span><span class="text-[#7c4dff]">Lever</span>
          </a>
          <div class="hidden sm:flex items-center gap-6">
            <a href="#features" class="text-[#555970] hover:text-[#e3e2e6] font-['DM_Sans'] text-[13px] font-medium transition-colors no-underline">Features</a>
            <a href="https://github.com/madschristensen99/xLever" target="_blank" class="text-[#555970] hover:text-[#e3e2e6] font-['DM_Sans'] text-[13px] font-medium transition-colors no-underline">GitHub</a>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <a href="#" id="navLaunchAppBtn" class="inline-flex items-center gap-2 bg-[#7c4dff] hover:bg-[#6a3de8] text-white font-['DM_Sans'] text-[14px] font-semibold px-5 py-2 rounded-lg transition-all no-underline" style="transform: translateY(0); transition: all 0.2s;">
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
          <a href="index.html" class="font-['JetBrains_Mono'] text-lg font-bold tracking-tighter no-underline">
            <span class="text-[#e3e2e6]">x</span><span class="text-[#7c4dff]">Lever</span>
          </a>
          <div class="hidden md:flex gap-1 items-center" id="navLinks">
            ${visiblePages.map(p => navLink(p, p.id === activeId)).join('\n            ')}
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
    }

    document.body.prepend(nav);
  }

  function renderMobileDrawer(activeId) {
    const mode = getMode();
    const drawer = document.createElement('div');
    drawer.id = 'mobileNav';
    drawer.className = 'md:hidden fixed top-14 left-0 right-0 z-50 bg-[#0a0b0e] border-b border-[#252833] hidden';
    drawer.style.transition = 'all 0.25s ease';

    if (_isLanding) {
      drawer.innerHTML = `
        <div class="flex flex-col p-3 gap-1">
          <a href="#features" class="text-[#555970] font-['DM_Sans'] text-sm font-medium px-4 py-2.5 rounded hover:bg-[#12141a] transition-colors no-underline">Features</a>
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

  // Chain display names
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
