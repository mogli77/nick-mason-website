/* ============================================
   NICK MASON CONSTRUCTION - Main JavaScript
   ============================================ */

/* --------------------------------------------
   Mobile hero height lock
   --------------------------------------------
   On Chromium mobile (Chrome/Brave Android), the URL-bar collapse
   animation during scroll causes object-fit:cover videos in the hero
   to visibly scale up, even with height:100svh on the container.
   iOS Safari handles 100svh correctly on its own.

   Fix: capture window.innerHeight once at load and expose it as a
   CSS custom property so the mobile hero is pinned to an exact pixel
   height that never changes during scroll. We intentionally DO NOT
   update on resize or scroll — only on orientationchange — because
   updating mid-scroll would reintroduce the scaling.
   -------------------------------------------- */
(function lockMobileHeroHeight() {
    const mql = window.matchMedia('(max-width: 767px)');
    if (!mql.matches) return;

    const set = () => {
        document.documentElement.style.setProperty('--hero-h', window.innerHeight + 'px');
    };

    set();

    // Re-pin on orientation change, after the UA has settled the new viewport.
    window.addEventListener('orientationchange', () => {
        setTimeout(set, 150);
    });

    // If the viewport crosses the 768px breakpoint (tablet rotate), clear it so
    // desktop styles take over cleanly.
    mql.addEventListener && mql.addEventListener('change', (e) => {
        if (!e.matches) {
            document.documentElement.style.removeProperty('--hero-h');
        } else {
            set();
        }
    });
})();
