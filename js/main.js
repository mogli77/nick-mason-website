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
            document.documentElement.style.removeProperty('--hero-h');
        }
    };

    apply();

    window.addEventListener('orientationchange', () => {
        setTimeout(apply, 150);
    });

    if (mql.addEventListener) {
        mql.addEventListener('change', apply);
    } else if (mql.addListener) {
        mql.addListener(apply); // Safari < 14
    }
})();

/* --------------------------------------------
   Autoplay-on-view: ensure videos with .autoplay-on-view actually play
   --------------------------------------------
   The <video autoplay muted loop playsinline> handshake is brittle across
   browsers. It can silently fail on:
     - Safari (macOS + iOS) for videos below the fold
     - iOS Safari Low Power Mode (can't fix, but don't make it worse)
     - Mobile Chromium for offscreen videos with preload="none" default
     - Any browser after bfcache restoration (pageshow)

   We use an IntersectionObserver to nudge .play() when each video enters
   view, AND force the muted/playsInline properties in JS (Safari ignores
   the HTML attribute in some states), AND wait for readyState before
   trying if the video isn't loaded yet, AND retry on canplay if the first
   attempt rejects. This covers all the known failure modes short of
   Low Power Mode.
   -------------------------------------------- */
(function autoplayOnView() {
    const vids = document.querySelectorAll('video.autoplay-on-view');
    if (!vids.length) return;

    const tryPlay = (v) => {
        // Safari: force the attributes in JS too. The HTML `muted` attribute
        // sets the initial state but can be desynced by bfcache / navigation.
        v.muted = true;
        v.playsInline = true;
        v.defaultMuted = true;

        const attempt = () => {
            const p = v.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    // First play() rejected — wait for the media pipeline
                    // to be further along, then try once more.
                    v.addEventListener('canplay', () => {
                        const p2 = v.play();
                        if (p2 && typeof p2.catch === 'function') {
                            p2.catch(() => { /* give up quietly */ });
                        }
                    }, { once: true });
                });
            }
        };

        // HAVE_CURRENT_DATA (2) is enough to start playback
        if (v.readyState >= 2) {
            attempt();
        } else {
            v.addEventListener('loadeddata', attempt, { once: true });
            // If the video element hasn't started loading at all, force it.
            // (preload="none" defaulted browsers won't have loaded anything yet.)
            if (v.readyState === 0) {
                try { v.load(); } catch (e) { /* noop */ }
            }
        }
    };

    const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && entry.target.paused) {
                tryPlay(entry.target);
            }
        });
    }, { threshold: 0.15 });

    vids.forEach(v => io.observe(v));

    // bfcache restoration: a video that was playing on the previous visit
    // can come back paused with readyState already high.
    window.addEventListener('pageshow', () => {
        vids.forEach(v => {
            if (!v.paused) return;
            const r = v.getBoundingClientRect();
            const inView = r.top < window.innerHeight && r.bottom > 0;
            if (inView) tryPlay(v);
        });
    });
})();
