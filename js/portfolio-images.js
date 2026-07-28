/* ============================================
   PORTFOLIO RESPONSIVE IMAGE DELIVERY
   ============================================
   The approved Lightroom exports remain the source of truth. On the hosted
   site, Netlify Image CDN supplies right-sized derivatives from those files.
   Local/file previews keep using the original image paths unchanged.
   ============================================ */
(function optimizePortfolioImages() {
    const body = document.body;
    const useNetlifyImages =
        body.classList.contains('portfolio-page') &&
        body.hasAttribute('data-netlify-images') &&
        window.location.protocol === 'https:';

    if (!useNetlifyImages) return;

    const IMAGE_SELECTOR = 'img[src^="images/"], img[src^="/images/"]';
    const WIDTHS = [320, 480, 640, 768, 960, 1200, 1440, 1800];
    const QUALITY = 86;
    const preparedImages = new Set();
    let resizeFrame = null;

    const sourcePath = (img) => {
        const source = img.dataset.originalSrc || img.getAttribute('src') || '';
        if (!source || source.startsWith('data:')) return '';
        return '/' + source.replace(/^\.?\//, '');
    };

    const imageUrl = (source, width) =>
        `/.netlify/images?url=${encodeURIComponent(source)}&w=${width}&q=${QUALITY}`;

    const maxSourceWidth = (img) => {
        const declaredWidth = Number.parseInt(img.getAttribute('width'), 10);
        return Math.min(
            1800,
            Number.isFinite(declaredWidth) && declaredWidth > 0 ? declaredWidth : 1800
        );
    };

    const candidateWidths = (img) => {
        const maximum = maxSourceWidth(img);
        const candidates = WIDTHS.filter(width => width < maximum);
        candidates.push(maximum);
        return Array.from(new Set(candidates));
    };

    const measuredWidth = (img) => {
        const rectWidth = img.getBoundingClientRect().width;
        const parentWidth = img.parentElement?.getBoundingClientRect().width || 0;
        const fallback = Math.min(maxSourceWidth(img), window.innerWidth || 1200);
        const width = rectWidth || parentWidth || fallback;

        // Small rounding prevents a fractional layout pixel from selecting a
        // different candidate after fonts or the browser chrome settles.
        return Math.max(1, Math.ceil(width / 16) * 16);
    };

    const updateSize = (img) => {
        if (!preparedImages.has(img)) return;
        img.sizes = `${measuredWidth(img)}px`;
    };

    const restoreOriginal = (img) => {
        if (!preparedImages.has(img)) return;
        preparedImages.delete(img);
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        img.src = img.dataset.originalSrc;
    };

    const prepare = (img) => {
        if (!(img instanceof HTMLImageElement)) return;

        if (!preparedImages.has(img)) {
            const source = sourcePath(img);
            if (!source || !/\.(?:jpe?g|png|webp)$/i.test(source)) return;

            img.dataset.originalSrc = img.getAttribute('src');
            preparedImages.add(img);
            updateSize(img);
            const widths = candidateWidths(img);
            img.srcset = widths
                .map(width => `${imageUrl(source, width)} ${width}w`)
                .join(', ');
            img.addEventListener('error', () => restoreOriginal(img), { once: true });

            // Quietly stage the first collage spread behind the hero and the
            // direct-nav About portrait. Both use small responsive candidates,
            // so they are ready at the moment the visitor leaves the hero
            // without competing at normal/high priority with its video.
            const quietPreload =
                img.classList.contains('about-photo-final') ||
                img.closest('.pf-s1');
            if (quietPreload) {
                img.fetchPriority = 'low';
                img.loading = 'eager';
            }
            return;
        }

        updateSize(img);
    };

    document.querySelectorAll(IMAGE_SELECTOR).forEach(prepare);

    // The crew strip duplicates its authored set for a seamless loop after
    // this file runs. Register those clones without special-case markup.
    const addedImageObserver = new MutationObserver((records) => {
        records.forEach(record => {
            record.addedNodes.forEach(node => {
                if (!(node instanceof Element)) return;
                if (node.matches(IMAGE_SELECTOR)) prepare(node);
                node.querySelectorAll?.(IMAGE_SELECTOR).forEach(prepare);
            });
        });
    });
    addedImageObserver.observe(body, { childList: true, subtree: true });

    const refreshSizes = () => {
        resizeFrame = null;
        preparedImages.forEach(updateSize);
    };

    const scheduleSizeRefresh = () => {
        if (resizeFrame !== null) return;
        resizeFrame = window.requestAnimationFrame(refreshSizes);
    };

    window.addEventListener('resize', scheduleSizeRefresh, { passive: true });
    window.addEventListener('pageshow', scheduleSizeRefresh);
})();
