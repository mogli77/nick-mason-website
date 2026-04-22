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

   Fix: capture window.innerHeight and expose it as a CSS custom
   property so the mobile hero is pinned to an exact pixel height
   that never changes during scroll. We intentionally DO NOT update
   on resize or scroll — only on orientationchange + breakpoint
   crossings — because updating mid-scroll would reintroduce the
   scaling bug (iOS Safari fires spurious resize events as the URL
   bar collapses).
   -------------------------------------------- */
(function lockMobileHeroHeight() {
    const mql = window.matchMedia('(max-width: 767px)');

    const apply = () => {
        if (mql.matches) {
            document.documentElement.style.setProperty('--hero-h', window.innerHeight + 'px');
        } else {
            // Above the breakpoint: clear the pixel lock so desktop styles
            // (or the CSS 100svh fallback) take over cleanly.
            document.documentElement.style.removeProperty('--hero-h');
        }
    };

    apply();

    // Orientation change: re-pin after UA settles the new viewport.
    window.addEventListener('orientationchange', () => {
        setTimeout(apply, 150);
    });

    // Breakpoint crossing (e.g. tablet rotate, desktop resize to narrow window).
    // Register unconditionally so desktop→mobile resize also gets the lock.
    if (mql.addEventListener) {
        mql.addEventListener('change', apply);
    } else if (mql.addListener) {
        // Safari < 14 fallback
        mql.addListener(apply);
    }
})();
