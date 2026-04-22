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
   that never changes during scroll.

   We DO NOT update on plain `resize` or `scroll` — iOS Safari fires
   those as the URL bar collapses and that would reintroduce the bug.
   We DO refresh on orientationchange, breakpoint crossings, pageshow
   (bfcache restore), and visibilitychange→visible (app resume / iPad
   split-view / tab return). These are genuine viewport changes that
   leave --hero-h stale if we don't re-read window.innerHeight.
   -------------------------------------------- */
(function lockMobileHeroHeight() {
    // Include touch-capable devices up through iPad (≤1024px) so tablet
    // landscape doesn't escape the pixel lock.
    const mql = window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse) and (max-width: 1024px)');

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

    window.addEventListener('pageshow', apply);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) apply();
    });

    if (mql.addEventListener) {
        mql.addEventListener('change', apply);
    } else if (mql.addListener) {
        mql.addListener(apply); // Safari < 14
    }
})();

/* --------------------------------------------
   Autoplay-on-view: robust cross-browser autoplay
   --------------------------------------------
   The <video autoplay muted loop playsinline> handshake is brittle on
   Safari and iOS Safari especially. Failure modes covered:

   1. Safari rejects .play() when readyState is low (common for large
      below-fold videos like El Monte's 34 MB closer). We wait for
      loadeddata / canplay / canplaythrough before calling .play(), and
      retry on ALL of them — whichever fires first wins. Attaching
      listeners before calling .play() avoids the race where canplay
      fires before the .catch() handler registers its retry.

   2. preload="auto" is a hint — mobile Safari frequently ignores it
      to save bandwidth. We call v.load() ourselves when the video is
      near the viewport (rootMargin: 200% above) so the pipeline starts
      buffering well before the user arrives.

   3. Muted state can desync after bfcache/navigation — Safari then
      treats the video as unmuted and blocks autoplay. Force
      muted/playsInline/defaultMuted in JS every time we try.

   4. Concurrent decoders starve big videos on iOS Safari — pausing
      videos that leave the viewport frees the decoder so the next one
      can start reliably.

   5. prefers-reduced-motion: fully opt out of autoplay.

   6. bfcache restoration (pageshow): a video that was playing on the
      previous visit comes back paused with readyState already high;
      trigger play again.
   -------------------------------------------- */
(function autoplayOnView() {
    const vids = document.querySelectorAll('video.autoplay-on-view');
    if (!vids.length) return;

    // Respect user preference: do not autoplay motion.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduceMotion.matches) {
        vids.forEach(v => {
            v.pause();
            v.removeAttribute('autoplay');
        });
        return;
    }

    const forceMuted = (v) => {
        // Safari: set via JS, not just the HTML attribute. Without this
        // the media engine can transiently treat the video as unmuted
        // (e.g. after bfcache restore), which blocks autoplay.
        v.muted = true;
        v.playsInline = true;
        v.defaultMuted = true;
    };

    const playIfPaused = (v) => {
        if (!v.paused) return;
        forceMuted(v);
        const p = v.play();
        if (p && typeof p.catch === 'function') {
            // Swallow the rejection — the event listeners registered
            // below will retry on the next media-pipeline milestone.
            p.catch(() => {});
        }
    };

    // Wire up all the "maybe ready now" hooks BEFORE calling .play().
    // Any of these firing = another chance to play. If the first .play()
    // rejects and canplay fires 10ms later, we still try again because
    // the listener was already attached.
    const wireRetries = (v) => {
        const retry = () => playIfPaused(v);
        v.addEventListener('loadeddata', retry);
        v.addEventListener('canplay', retry);
        v.addEventListener('canplaythrough', retry);
    };

    const ensureLoading = (v) => {
        // Force the media pipeline in case preload="auto" was downgraded
        // by the UA (common on iOS Safari to save bandwidth).
        if (v.readyState === 0) {
            try { v.load(); } catch (e) { /* noop */ }
        }
    };

    // Two observers with different responsibilities:
    //
    // 1) Near-view observer (rootMargin 200% above): start buffering
    //    well before the video is actually visible, so by the time the
    //    user gets there readyState is high and .play() succeeds.
    // 2) In-view observer (threshold 0.15): play when visible, pause
    //    when offscreen to free decoder resources.

    const nearViewIO = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const v = entry.target;
            wireRetries(v);
            ensureLoading(v);
            nearViewIO.unobserve(v); // only needed once per video
        });
    }, { rootMargin: '200% 0px 200% 0px' });

    const inViewIO = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const v = entry.target;
            if (entry.isIntersecting) {
                playIfPaused(v);
            } else if (!v.paused) {
                // Pause offscreen. Next scroll back in, intersectionObserver
                // re-fires and playIfPaused() resumes from current position
                // (loop attribute handles the wrap).
                v.pause();
            }
        });
    }, { threshold: 0.15 });

    vids.forEach(v => {
        nearViewIO.observe(v);
        inViewIO.observe(v);

        // If the video is already in the viewport at script time (e.g.
        // hero videos on page load), kick off loading + retries now —
        // the IntersectionObserver callback doesn't fire synchronously
        // for the initial position, which means autoplay can be delayed
        // by a frame or two. That's long enough on iOS Safari to miss
        // the "user just saw this" window.
        const r = v.getBoundingClientRect();
        const alreadyVisible = r.top < window.innerHeight && r.bottom > 0;
        if (alreadyVisible) {
            wireRetries(v);
            ensureLoading(v);
            playIfPaused(v);
        }
    });

    // bfcache: video was playing on the previous page visit, now paused.
    window.addEventListener('pageshow', () => {
        vids.forEach(v => {
            const r = v.getBoundingClientRect();
            const inView = r.top < window.innerHeight && r.bottom > 0;
            if (inView) playIfPaused(v);
        });
    });

    // Tab / app return: browsers sometimes pause media when backgrounded.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        vids.forEach(v => {
            const r = v.getBoundingClientRect();
            const inView = r.top < window.innerHeight && r.bottom > 0;
            if (inView) playIfPaused(v);
        });
    });
})();
