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
   Homepage page-turn scroll
   --------------------------------------------
   Native CSS scroll snap moves at browser-defined speed, which can feel
   abrupt on trackpads. On the homepage we keep CSS snap as a no-JS
   fallback, then replace it with a controlled one-page-at-a-time motion.
   -------------------------------------------- */
(function pageTurnScroll() {
    const root = document.documentElement;
    const body = document.body;
    const isHome = root.classList.contains('home-document') && body.classList.contains('home-page');
    const params = new URLSearchParams(window.location.search);
    const isLayoutEditMode = params.get('layout') === 'edit';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!isHome || isLayoutEditMode || reduceMotion.matches) return;

    // Comparison mode: ?scroll=free disables the page-turn AND the CSS
    // snap fallback so the homepage scrolls like a normal long page.
    if (params.get('scroll') === 'free') {
        root.classList.add('free-scroll');
        return;
    }

    // About is the LAST snap point. The crew strip and footer below it
    // scroll natively (see freeZone gates in the input handlers).
    const sectionSelector = '.home-hero, .magazine-spread, .about-section-home';
    const freeScrollSelector = '.spread-tall';
    const wheelThreshold = 72;
    const freeScrollBoundaryThreshold = 16;
    const touchThreshold = 58;
    const freeScrollEdge = 6;
    const minDuration = 860;
    const maxDuration = 1160;
    let snapPoints = [];
    let activeIndex = 0;
    let isAnimating = false;
    let wheelDelta = 0;
    let wheelResetTimer = null;
    let touchStartY = 0;
    let touchCurrentY = 0;
    let touchLastY = 0;
    let touchUsedNativeScroll = false;
    let touchInFreeZone = false;

    root.classList.add('page-turn-enabled');

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const easeInOutCubic = (t) => (
        t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2
    );

    const getPageMax = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    // Everything from the About section down (crew strip, footer) scrolls
    // natively. Returns the y where the free zone starts, or null.
    function getFreeZoneTop() {
        const about = document.querySelector('.about-section-home');
        return about ? clamp(Math.round(about.offsetTop), 0, getPageMax()) : null;
    }

    // True when this input should be left to native scrolling: at or past
    // the About top, scrolling down — or scrolling up while still clearly
    // below the About top (about hasn't reached the top of the screen yet).
    function isNativeZoneScroll(direction) {
        const zoneTop = getFreeZoneTop();
        if (zoneTop === null) return false;
        const y = window.scrollY || window.pageYOffset || 0;
        if (y < zoneTop - freeScrollEdge) return false;
        return direction > 0 || y > zoneTop + freeScrollEdge;
    }

    function buildSnapPoints() {
        const points = [];

        document.querySelectorAll(sectionSelector).forEach(section => {
            const top = Math.round(section.offsetTop);
            points.push(top);
        });

        snapPoints = Array.from(new Set(points
            .map(point => clamp(point, 0, getPageMax()))
            .sort((a, b) => a - b)
        ));

        activeIndex = getNearestIndex();
    }

    function getNearestIndex() {
        const y = window.scrollY || window.pageYOffset || 0;
        let nearest = 0;
        let nearestDistance = Infinity;

        snapPoints.forEach((point, index) => {
            const distance = Math.abs(point - y);
            if (distance < nearestDistance) {
                nearest = index;
                nearestDistance = distance;
            }
        });

        return nearest;
    }

    function getActiveFreeScrollSection() {
        const y = window.scrollY || window.pageYOffset || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        let activeSection = null;
        let activeOverlap = 0;

        document.querySelectorAll(freeScrollSelector).forEach(section => {
            const top = section.offsetTop;
            const bottom = top + section.offsetHeight;
            const overlap = Math.min(y + viewportHeight, bottom) - Math.max(y, top);

            if (overlap > activeOverlap) {
                activeSection = section;
                activeOverlap = overlap;
            }
        });

        return activeOverlap > viewportHeight * 0.1 ? activeSection : null;
    }

    function canNativeScrollFreeSection(section, direction) {
        if (!section || !direction) return false;

        const y = window.scrollY || window.pageYOffset || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const top = section.offsetTop;
        const bottomLimit = Math.max(top, top + section.offsetHeight - viewportHeight);

        if (direction > 0) return y < bottomLimit - freeScrollEdge;
        return y > top + freeScrollEdge;
    }

    function scrollFreeSection(section, deltaY) {
        if (!section || !deltaY) return;

        const y = window.scrollY || window.pageYOffset || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const top = section.offsetTop;
        const bottomLimit = Math.max(top, top + section.offsetHeight - viewportHeight);
        const nextY = clamp(y + deltaY, top, bottomLimit);

        window.scrollTo(0, nextY);
        activeIndex = getNearestIndex();
    }

    function moveFromFreeScrollBoundary(section, direction) {
        if (isAnimating) return;

        if (!section || !direction) {
            moveBy(direction);
            return;
        }

        // Lazy full-width images can change section heights after first paint.
        // Rebuild right before handoff so the next page target is not stale.
        buildSnapPoints();

        const sectionTop = clamp(Math.round(section.offsetTop), 0, getPageMax());
        const sectionIndex = snapPoints.reduce((winner, point, index) => {
            const currentDistance = Math.abs(point - sectionTop);
            const winnerDistance = Math.abs(snapPoints[winner] - sectionTop);
            return currentDistance < winnerDistance ? index : winner;
        }, 0);

        animateTo(sectionIndex + direction, direction);
    }

    // Where a page turn should land for a given snap index. Turning UP
    // into a taller-than-viewport free-scroll section (.spread-tall)
    // enters at its BOTTOM edge, so the image reveals in reverse as you
    // keep scrolling up — instead of jumping over it to its top.
    function snapDestination(index, direction) {
        const top = snapPoints[index];

        if (direction < 0) {
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
            const sections = document.querySelectorAll(freeScrollSelector);

            for (const section of sections) {
                const sectionTop = clamp(Math.round(section.offsetTop), 0, getPageMax());
                if (sectionTop !== top) continue;
                const bottomEntry = clamp(
                    section.offsetTop + section.offsetHeight - viewportHeight,
                    0,
                    getPageMax()
                );
                if (bottomEntry > top + 2) return bottomEntry;
            }
        }

        return top;
    }

    function animateTo(index, direction = 0) {
        if (!snapPoints.length) buildSnapPoints();

        const nextIndex = clamp(index, 0, snapPoints.length - 1);
        const startY = window.scrollY || window.pageYOffset || 0;
        const endY = snapDestination(nextIndex, direction);
        const distance = Math.abs(endY - startY);

        if (distance < 2) {
            activeIndex = nextIndex;
            return;
        }

        const duration = clamp(distance * 0.78, minDuration, maxDuration);
        const startedAt = performance.now();
        isAnimating = true;
        activeIndex = nextIndex;

        function step(now) {
            const progress = clamp((now - startedAt) / duration, 0, 1);
            const y = startY + (endY - startY) * easeInOutCubic(progress);
            window.scrollTo(0, y);

            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                window.scrollTo(0, endY);
                window.setTimeout(() => {
                    isAnimating = false;
                }, 90);
            }
        }

        window.requestAnimationFrame(step);
    }

    function moveBy(direction) {
        if (isAnimating || !direction) return;
        buildSnapPoints();
        activeIndex = getNearestIndex();
        animateTo(activeIndex + direction, direction);
    }

    function resetWheelDeltaSoon() {
        window.clearTimeout(wheelResetTimer);
        wheelResetTimer = window.setTimeout(() => {
            wheelDelta = 0;
        }, 180);
    }

    function onWheel(event) {
        if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

        const direction = event.deltaY > 0 ? 1 : -1;

        // Below the About top: hand the wheel back to the browser.
        if (!isAnimating && isNativeZoneScroll(direction)) {
            wheelDelta = 0;
            window.clearTimeout(wheelResetTimer);
            return;
        }

        const freeScrollSection = getActiveFreeScrollSection();

        if (canNativeScrollFreeSection(freeScrollSection, direction)) {
            event.preventDefault();
            if (!isAnimating) {
                scrollFreeSection(freeScrollSection, event.deltaY);
            }
            wheelDelta = 0;
            window.clearTimeout(wheelResetTimer);
            return;
        }

        event.preventDefault();
        if (isAnimating) return;

        wheelDelta += event.deltaY;
        resetWheelDeltaSoon();

        if (freeScrollSection && Math.abs(wheelDelta) >= freeScrollBoundaryThreshold) {
            const turnDirection = wheelDelta > 0 ? 1 : -1;
            wheelDelta = 0;
            moveFromFreeScrollBoundary(freeScrollSection, turnDirection);
            return;
        }

        if (Math.abs(wheelDelta) >= wheelThreshold) {
            const turnDirection = wheelDelta > 0 ? 1 : -1;
            wheelDelta = 0;
            if (freeScrollSection) {
                moveFromFreeScrollBoundary(freeScrollSection, turnDirection);
            } else {
                moveBy(turnDirection);
            }
        }
    }

    function onKeydown(event) {
        const tagName = document.activeElement?.tagName;
        const isTyping = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || document.activeElement?.isContentEditable;
        if (isTyping) return;

        const nextKeys = ['ArrowDown', 'PageDown', ' '];
        const prevKeys = ['ArrowUp', 'PageUp'];
        let direction = 0;

        if (nextKeys.includes(event.key) && !event.shiftKey) direction = 1;
        if ((event.key === ' ' && event.shiftKey) || prevKeys.includes(event.key)) direction = -1;
        if (event.key === 'Home') {
            event.preventDefault();
            animateTo(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            animateTo(snapPoints.length - 1);
            return;
        }

        if (direction) {
            // Below the About top: native key scrolling.
            if (!isAnimating && isNativeZoneScroll(direction)) return;

            const freeScrollSection = getActiveFreeScrollSection();
            if (canNativeScrollFreeSection(freeScrollSection, direction)) {
                const scrollAmount = event.key === 'ArrowDown' || event.key === 'ArrowUp'
                    ? 80 * direction
                    : (window.innerHeight || document.documentElement.clientHeight) * 0.82 * direction;

                event.preventDefault();
                scrollFreeSection(freeScrollSection, scrollAmount);
                return;
            }

            event.preventDefault();
            if (freeScrollSection) {
                moveFromFreeScrollBoundary(freeScrollSection, direction);
            } else {
                moveBy(direction);
            }
        }
    }

    function onTouchStart(event) {
        if (!event.touches.length || event.touches.length > 1) return;
        touchStartY = event.touches[0].clientY;
        touchCurrentY = touchStartY;
        touchLastY = touchStartY;
        touchUsedNativeScroll = false;
        touchInFreeZone = false;
    }

    function onTouchMove(event) {
        if (!event.touches.length) return;
        // Multi-touch = pinch zoom. Never preventDefault it, and don't
        // treat the gesture as a page turn on touchend.
        if (event.touches.length > 1) {
            touchUsedNativeScroll = true;
            return;
        }
        touchCurrentY = event.touches[0].clientY;

        const delta = touchStartY - touchCurrentY;
        const moveDelta = touchLastY - touchCurrentY;
        const direction = delta > 0 ? 1 : -1;
        const moveDirection = moveDelta > 0 ? 1 : -1;

        // Below the About top: leave the whole gesture to native scrolling.
        if (touchInFreeZone) return;
        if (isNativeZoneScroll(moveDirection)) {
            touchInFreeZone = true;
            return;
        }

        const freeScrollSection = getActiveFreeScrollSection();

        if (
            touchUsedNativeScroll ||
            (Math.abs(delta) > 6 && canNativeScrollFreeSection(freeScrollSection, direction))
        ) {
            event.preventDefault();
            if (Math.abs(moveDelta) > 0 && canNativeScrollFreeSection(freeScrollSection, moveDirection)) {
                scrollFreeSection(freeScrollSection, moveDelta);
            }
            touchLastY = touchCurrentY;
            touchUsedNativeScroll = true;
            return;
        }

        event.preventDefault();
        touchLastY = touchCurrentY;
    }

    function onTouchEnd() {
        if (isAnimating || touchUsedNativeScroll || touchInFreeZone) return;

        const delta = touchStartY - touchCurrentY;
        if (Math.abs(delta) >= touchThreshold) {
            const direction = delta > 0 ? 1 : -1;
            const freeScrollSection = getActiveFreeScrollSection();

            if (freeScrollSection) {
                moveFromFreeScrollBoundary(freeScrollSection, direction);
            } else {
                moveBy(direction);
            }
        }
    }

    function onHashClick(event) {
        const link = event.target.closest('a[href^="#"]');
        if (!link) return;

        const hash = link.getAttribute('href');
        if (!hash || hash === '#') return;

        const target = document.querySelector(hash);
        if (!target) return;

        event.preventDefault();
        buildSnapPoints();

        const targetY = target.offsetTop;
        const targetIndex = snapPoints.reduce((winner, point, index) => {
            const currentDistance = Math.abs(point - targetY);
            const winnerDistance = Math.abs(snapPoints[winner] - targetY);
            return currentDistance < winnerDistance ? index : winner;
        }, 0);

        animateTo(targetIndex);
        history.pushState(null, '', hash);
    }

    buildSnapPoints();

    document.querySelectorAll(`${sectionSelector} img, ${sectionSelector} video`).forEach(media => {
        if (media.tagName === 'IMG' && !media.complete) {
            media.addEventListener('load', buildSnapPoints, { once: true });
        }

        if (media.tagName === 'VIDEO') {
            media.addEventListener('loadedmetadata', buildSnapPoints, { once: true });
        }
    });

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('resize', buildSnapPoints);
    window.addEventListener('load', buildSnapPoints);
    window.addEventListener('pageshow', buildSnapPoints);
    document.addEventListener('click', onHashClick);
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
