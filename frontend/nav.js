/**
 * xLever Shared Navigation
 * Renders the top nav bar, mobile drawer, and risk sentinel banner.
 * Include this script on every page and call XNav.init('pageName').
 */
const XNav = (() => {
  const PAGES = [
    { id: 'dashboard',  label: 'Dashboard',  href: '01-dashboard.html' },
    { id: 'trading',    label: 'Trading',     href: '02-trading-terminal.html' },
    { id: 'agents',     label: 'AI Agents',   href: '03-ai-agent-operations.html' },
    { id: 'vaults',     label: 'Vaults',      href: '04-vault-management.html' },
    { id: 'risk',       label: 'Risk',        href: '05-risk-management.html' },
    { id: 'analytics',  label: 'Analytics',   href: '06-analytics-backtesting.html' },
    { id: 'operations', label: 'Operations',  href: '07-operations-control.html' },
    { id: 'admin',      label: 'Admin',       href: '08-admin-dashboard.html' },
    { id: 'lending',    label: 'Lending',     href: '09-lending-borrowing.html' },
  ];

  function init(activePageId) {
    renderNav(activePageId);
    renderMobileDrawer(activePageId);
    renderRiskBanner();
    wireUpMobileMenu();
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
    const nav = document.createElement('nav');
    nav.id = 'xnav';
    nav.className = 'bg-[#0a0b0e] flex justify-between items-center w-full px-6 h-14 border-b border-[#252833] fixed top-0 z-50';
    nav.innerHTML = `
      <div class="flex items-center gap-10">
        <a href="index.html" class="font-['JetBrains_Mono'] text-lg font-bold tracking-tighter no-underline">
          <span class="text-[#e3e2e6]">x</span><span class="text-[#7c4dff]">Lever</span>
        </a>
        <div class="hidden md:flex gap-1 items-center">
          ${PAGES.map(p => navLink(p, p.id === activeId)).join('\n          ')}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="hidden sm:flex items-center gap-2 bg-[#12141a] px-3 py-1.5 border border-[#252833] rounded">
          <div class="w-2 h-2 rounded-full bg-[#00e676] animate-pulse"></div>
          <span class="font-['JetBrains_Mono'] text-[10px] text-[#8b8fa3] uppercase tracking-widest" id="networkBadgeText">Ink Sepolia</span>
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
          <span class="font-['JetBrains_Mono'] text-[10px] text-[#8b8fa3] uppercase tracking-widest">Ink Sepolia</span>
        </div>
      </div>
    `;
    const nav = document.getElementById('xnav');
    if (nav) nav.after(drawer);
  }

  function renderRiskBanner() {
    const banner = document.createElement('div');
    banner.id = 'riskBanner';
    banner.className = 'fixed top-14 left-0 right-0 z-40';
    banner.style.transition = 'all 0.4s cubic-bezier(0.4,0,0.2,1)';
    banner.innerHTML = `
      <div class="flex items-center justify-between px-6 py-2 border-b" id="riskBannerInner" style="background:#00e67610;border-color:#00e67640">
        <div class="flex items-center gap-3">
          <span class="material-symbols-outlined text-lg" id="bannerIcon" style="color:#00e676">verified_user</span>
          <span class="font-['JetBrains_Mono'] text-xs font-bold uppercase tracking-widest" id="bannerState" style="color:#00e676">NORMAL</span>
          <span class="text-xs opacity-80" id="bannerReason">All systems nominal</span>
        </div>
        <div class="flex items-center gap-4">
          <span class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest opacity-70" id="bannerLevCap">Max Leverage: 4.0x</span>
          <a href="05-risk-management.html" class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#7c4dff] hover:text-[#cdbdff]">Details &rarr;</a>
        </div>
      </div>
    `;
    const drawer = document.getElementById('mobileNav');
    if (drawer) drawer.after(banner);
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
