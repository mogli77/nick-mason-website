// Studio model: parse the portfolio gallery region into blocks and serialize
// it back. The serializer is SOURCE-PRESERVING: untouched blocks re-emit their
// original text byte-for-byte; only blocks the user edited are re-rendered
// from templates. The invariant `parse → serialize (no edits) → byte-equal`
// is enforced at load time and exposed as studioDebug.roundTrip().

const OPEN_RE = /^\s*<section class="project-gallery">\s*$/;
const CLOSE_RE = /^\s{8}<\/section>\s*$/;

const IND1 = ' '.repeat(12); // block root
const IND2 = ' '.repeat(16); // figures / direct media
const IND3 = ' '.repeat(20); // media inside figures
const IND4 = ' '.repeat(24); // <source> inside figure video

// ---------------------------------------------------------------------------
// Pattern registry — the closed grammar. Order matters for classification
// (most specific base first).
// ---------------------------------------------------------------------------

export const PATTERNS = {
    liveInset: {
        label: 'Image + video inset',
        tag: 'figure',
        base: ['gallery-item', 'full', 'live-inset'],
        variants: [],
        schematic: 'live-inset',
        slots: [
            { kind: 'image', fit: 'natural', label: 'Base image' },
            { kind: 'video', inset: true, label: 'Inset video' },
        ],
    },
    fullVideo: {
        label: 'Full-width video',
        tag: 'figure',
        base: ['gallery-item', 'full', 'gallery-video'],
        variants: [],
        schematic: 'full-video',
        slots: [{ kind: 'video', label: 'Video' }],
    },
    full: {
        label: 'Full-width image',
        tag: 'figure',
        base: ['gallery-item', 'full'],
        variants: ['inset'],
        schematic: 'full',
        slots: [{ kind: 'image', fit: 'natural', label: 'Image' }],
    },
    featureWide: {
        label: 'Feature pair',
        tag: 'div',
        base: ['gallery-overlap', 'feature-wide'],
        variants: ['large-left', 'tall-pair'],
        schematic: 'feature-wide',
        slots: [
            { kind: 'media', role: 'feature-small', fit: 'natural', label: 'Small' },
            { kind: 'media', role: 'feature-large', fit: 'natural', label: 'Large' },
        ],
    },
    overlap: {
        label: 'Overlap pair',
        tag: 'div',
        base: ['gallery-overlap'],
        variants: ['reverse'],
        schematic: 'overlap',
        slots: [
            { kind: 'image', role: 'overlap-left', fit: 'natural', label: 'Left' },
            { kind: 'image', role: 'overlap-right', fit: 'natural', label: 'Right' },
        ],
    },
    trio: {
        label: 'Trio',
        tag: 'div',
        base: ['gallery-trio'],
        variants: ['center-wide'],
        schematic: 'trio',
        slots: [
            { kind: 'image', fit: 'cover', label: 'Left' },
            { kind: 'image', fit: 'cover', label: 'Middle' },
            { kind: 'image', fit: 'cover', label: 'Right' },
        ],
    },
    pair: {
        label: 'Side-by-side pair',
        tag: 'div',
        base: ['gallery-pair'],
        variants: ['wide-left', 'wide-right'],
        schematic: 'pair',
        slots: [
            { kind: 'image', fit: 'cover', label: 'Left' },
            { kind: 'image', fit: 'cover', label: 'Right' },
        ],
    },
};

// Effective object-fit for a slot given the block's variant (crop-pan eligibility).
export function slotFit(block, slotIndex) {
    const def = PATTERNS[block.pattern];
    if (!def) return 'natural';
    const fit = def.slots[slotIndex] && def.slots[slotIndex].fit;
    if (block.pattern === 'trio' && block.variant === 'center-wide') return 'natural';
    return fit || 'natural';
}

// ---------------------------------------------------------------------------
// Region extraction + chunking
// ---------------------------------------------------------------------------

export function splitFile(text) {
    const lines = text.split('\n');
    const opens = [];
    for (let i = 0; i < lines.length; i++) if (OPEN_RE.test(lines[i])) opens.push(i);
    if (opens.length !== 1) throw new Error(`Expected exactly one gallery <section>, found ${opens.length}.`);
    const open = opens[0];
    let close = -1;
    for (let i = open + 1; i < lines.length; i++) {
        if (/<section\b/.test(lines[i])) throw new Error(`Nested <section> inside gallery at line ${i + 1}.`);
        if (CLOSE_RE.test(lines[i])) { close = i; break; }
    }
    if (close === -1) throw new Error('Gallery closing </section> not found.');
    return {
        prefix: lines.slice(0, open + 1).join('\n'),
        region: lines.slice(open + 1, close).join('\n'),
        suffix: lines.slice(close).join('\n'),
    };
}

// Split the region into chunks: optional comment lines + one root element,
// found by matching the root's closing tag at the same indentation. Blank
// lines INSIDE a block (e.g. editorial-sequence) don't split chunks.
function chunkRegion(region) {
    const lines = region.split('\n');
    const chunks = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].trim() === '') { i++; continue; }
        const start = i;
        // comment lines (full-line comments only)
        while (i < lines.length && /^\s*<!--.*-->\s*$/.test(lines[i])) i++;
        if (i >= lines.length || lines[i].trim() === '') {
            throw new Error(`Dangling comment without a block near region line ${start + 1}.`);
        }
        const rootMatch = lines[i].match(/^(\s*)<([a-zA-Z][\w-]*)(\s|>)/);
        if (!rootMatch) throw new Error(`Cannot read block root at region line ${i + 1}: ${lines[i].trim().slice(0, 60)}`);
        const [, indent, tag] = rootMatch;
        // Single-line root?
        if (new RegExp(`</${tag}>\\s*$`).test(lines[i])) {
            chunks.push(lines.slice(start, i + 1).join('\n'));
            i++;
            continue;
        }
        const closeRe = new RegExp(`^${indent}</${tag}>\\s*$`);
        let end = -1;
        for (let j = i + 1; j < lines.length; j++) {
            if (closeRe.test(lines[j])) { end = j; break; }
        }
        if (end === -1) throw new Error(`Unclosed <${tag}> starting at region line ${i + 1}.`);
        chunks.push(lines.slice(start, end + 1).join('\n'));
        i = end + 1;
    }
    return chunks;
}

// ---------------------------------------------------------------------------
// Chunk → block
// ---------------------------------------------------------------------------

let idCounter = 0;
const nextId = () => `b${++idCounter}`;

function attrNames(el) {
    return Array.from(el.attributes).map((a) => a.name);
}

function setEq(a, b) {
    return a.length === b.length && a.every((x) => b.includes(x));
}

// Parse an <img> into an image slot, or return null if it deviates from the idiom.
function parseImg(el) {
    const allowed = ['loading', 'decoding', 'class', 'src', 'alt', 'style'];
    if (!attrNames(el).every((n) => allowed.includes(n))) return null;
    if (el.getAttribute('loading') !== 'lazy' || el.getAttribute('decoding') !== 'async') return null;
    if (el.getAttribute('class') !== 'parallax-img') return null;
    let objectPosition = null;
    const style = el.getAttribute('style');
    if (style) {
        const m = style.match(/^\s*object-position:\s*([\d.]+%\s+[\d.]+%)\s*;?\s*$/);
        if (!m) return null;
        objectPosition = m[1];
    }
    const src = el.getAttribute('src');
    if (!src) return null;
    return { kind: 'image', src, alt: el.getAttribute('alt') || '', objectPosition };
}

// Parse a <video> into a video slot, or null.
function parseVideo(el, { inset = false } = {}) {
    const allowed = ['class', 'muted', 'loop', 'playsinline', 'preload', 'aria-label'];
    if (!attrNames(el).every((n) => allowed.includes(n))) return null;
    const expectedClass = inset ? 'live-inset-video autoplay-on-view' : 'autoplay-on-view';
    if (el.getAttribute('class') !== expectedClass) return null;
    if (el.getAttribute('preload') !== 'none') return null;
    const sources = el.querySelectorAll(':scope > source');
    if (sources.length !== 1 || el.children.length !== 1) return null;
    const url = sources[0].getAttribute('src');
    if (!url || sources[0].getAttribute('type') !== 'video/mp4') return null;
    return { kind: 'video', url, ariaLabel: el.getAttribute('aria-label') || '' };
}

function parseMedia(el, opts) {
    if (el.tagName === 'IMG') return parseImg(el);
    if (el.tagName === 'VIDEO') return parseVideo(el, opts);
    return null;
}

// A plain figure wrapper: <figure class="..."> with exactly one media child.
function parseFigureSlot(fig, expectClasses, opts) {
    if (fig.tagName !== 'FIGURE') return null;
    if (!setEq(attrNames(fig), ['class'])) return null;
    if (fig.getAttribute('class') !== expectClasses) return null;
    if (fig.children.length !== 1) return null;
    return parseMedia(fig.children[0], opts);
}

function classifyChunk(chunkText) {
    const lines = chunkText.split('\n');
    const commentLines = [];
    let r = 0;
    while (r < lines.length && /^\s*<!--.*-->\s*$/.test(lines[r])) {
        commentLines.push(lines[r]);
        r++;
    }
    const rootText = lines.slice(r).join('\n');
    const comment = commentLines.length === 1
        ? commentLines[0].replace(/^\s*<!--/, '').replace(/-->\s*$/, '')
        : null;

    const collage = () => ({
        id: nextId(), kind: 'collage', pattern: null, variant: '', extraClasses: [],
        comment, slots: [], sourceHtml: chunkText, dirty: false,
    });

    // Multiple comment lines → treat as opaque (preserve exactly).
    if (commentLines.length > 1) return collage();

    const doc = new DOMParser().parseFromString(rootText, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root || doc.body.children.length !== 1) return collage();

    const classList = (root.getAttribute('class') || '').split(/\s+/).filter(Boolean);

    for (const [key, def] of Object.entries(PATTERNS)) {
        if (root.tagName.toLowerCase() !== def.tag) continue;
        if (!def.base.every((c) => classList.includes(c))) continue;
        // Guard: 'full' base is a subset of fullVideo/liveInset bases — registry
        // order (most specific first) makes the first match the right one.
        const rest = classList.filter((c) => !def.base.includes(c));
        const variantsFound = rest.filter((c) => def.variants.includes(c));
        if (variantsFound.length > 1) return collage();
        const variant = variantsFound[0] || '';
        const extraClasses = rest.filter((c) => !def.variants.includes(c));

        // Root must carry only class (+ the aria-label collages use would make it opaque).
        if (!setEq(attrNames(root), ['class'])) return collage();

        const slots = parseSlots(key, def, root, variant);
        if (!slots) return collage();

        return {
            id: nextId(), kind: 'pattern', pattern: key, variant, extraClasses,
            comment, slots, sourceHtml: chunkText, dirty: false,
        };
    }
    return collage();
}

function parseSlots(key, def, root, variant) {
    const kids = Array.from(root.children);
    if (key === 'full') {
        if (kids.length !== 1) return null;
        const s = parseMedia(kids[0]);
        return s && s.kind === 'image' ? [s] : null;
    }
    if (key === 'fullVideo') {
        if (kids.length !== 1) return null;
        const s = parseMedia(kids[0]);
        return s && s.kind === 'video' ? [s] : null;
    }
    if (key === 'liveInset') {
        if (kids.length !== 2 || kids[0].tagName !== 'IMG' || kids[1].tagName !== 'VIDEO') return null;
        const img = parseImg(kids[0]);
        const vid = parseVideo(kids[1], { inset: true });
        return img && vid ? [img, vid] : null;
    }
    if (key === 'overlap') {
        if (kids.length !== 2) return null;
        const left = parseFigureSlot(kids[0], 'gallery-item overlap-left');
        const right = parseFigureSlot(kids[1], 'gallery-item overlap-right');
        return left && right ? [left, right] : null;
    }
    if (key === 'featureWide') {
        if (kids.length !== 2) return null;
        // Identify by role class, independent of DOM order (large-left reorders).
        let small = null, large = null;
        for (const fig of kids) {
            const cls = fig.getAttribute && fig.getAttribute('class');
            if (cls === 'gallery-item feature-small') small = parseFigureSlot(fig, 'gallery-item feature-small');
            else if (cls === 'gallery-item feature-large') large = parseFigureSlot(fig, 'gallery-item feature-large');
            else return null;
        }
        // Check DOM order matches what the variant demands (else opaque).
        const expectLargeFirst = variant === 'large-left';
        const isLargeFirst = kids[0].getAttribute('class') === 'gallery-item feature-large';
        if (expectLargeFirst !== isLargeFirst) return null;
        return small && large ? [small, large] : null;
    }
    if (key === 'trio' || key === 'pair') {
        const want = key === 'trio' ? 3 : 2;
        if (kids.length !== want) return null;
        const slots = kids.map((fig) => parseFigureSlot(fig, 'gallery-item'));
        return slots.every((s) => s && s.kind === 'image') ? slots : null;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Rendering (dirty pattern blocks only)
// ---------------------------------------------------------------------------

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderImgLine(slot, indent) {
    const style = slot.objectPosition ? ` style="object-position: ${slot.objectPosition};"` : '';
    return `${indent}<img loading="lazy" decoding="async" class="parallax-img" src="${slot.src}" alt="${esc(slot.alt)}"${style}>`;
}

function renderVideoLines(slot, indent, { inset = false } = {}) {
    const cls = inset ? 'live-inset-video autoplay-on-view' : 'autoplay-on-view';
    const srcIndent = indent + '    ';
    return [
        `${indent}<video class="${cls}" muted loop playsinline preload="none" aria-label="${esc(slot.ariaLabel)}">`,
        `${srcIndent}<source src="${slot.url}" type="video/mp4">`,
        `${indent}</video>`,
    ];
}

function renderMediaLines(slot, indent) {
    return slot.kind === 'image' ? [renderImgLine(slot, indent)] : renderVideoLines(slot, indent);
}

function rootClassAttr(def, block) {
    const classes = [...def.base];
    if (block.variant) classes.push(block.variant);
    classes.push(...block.extraClasses);
    return classes.join(' ');
}

function renderFigure(cls, slot, lines) {
    lines.push(`${IND2}<figure class="${cls}">`);
    lines.push(...renderMediaLines(slot, IND3));
    lines.push(`${IND2}</figure>`);
}

export function renderBlock(block) {
    const def = PATTERNS[block.pattern];
    if (!def) throw new Error(`Cannot render unknown pattern: ${block.pattern}`);
    const lines = [];
    if (block.comment !== null && block.comment !== undefined) {
        lines.push(`${IND1}<!--${block.comment}-->`);
    }
    const cls = rootClassAttr(def, block);

    if (block.pattern === 'full') {
        lines.push(`${IND1}<figure class="${cls}">`);
        lines.push(renderImgLine(block.slots[0], IND2));
        lines.push(`${IND1}</figure>`);
    } else if (block.pattern === 'fullVideo') {
        lines.push(`${IND1}<figure class="${cls}">`);
        lines.push(...renderVideoLines(block.slots[0], IND2));
        lines.push(`${IND1}</figure>`);
    } else if (block.pattern === 'liveInset') {
        lines.push(`${IND1}<figure class="${cls}">`);
        lines.push(renderImgLine(block.slots[0], IND2));
        lines.push(...renderVideoLines(block.slots[1], IND2, { inset: true }));
        lines.push(`${IND1}</figure>`);
    } else if (block.pattern === 'overlap') {
        lines.push(`${IND1}<div class="${cls}">`);
        renderFigure('gallery-item overlap-left', block.slots[0], lines);
        renderFigure('gallery-item overlap-right', block.slots[1], lines);
        lines.push(`${IND1}</div>`);
    } else if (block.pattern === 'featureWide') {
        lines.push(`${IND1}<div class="${cls}">`);
        const [small, large] = block.slots;
        const order = block.variant === 'large-left'
            ? [['gallery-item feature-large', large], ['gallery-item feature-small', small]]
            : [['gallery-item feature-small', small], ['gallery-item feature-large', large]];
        for (const [figCls, slot] of order) renderFigure(figCls, slot, lines);
        lines.push(`${IND1}</div>`);
    } else if (block.pattern === 'trio' || block.pattern === 'pair') {
        lines.push(`${IND1}<div class="${cls}">`);
        for (const slot of block.slots) renderFigure('gallery-item', slot, lines);
        lines.push(`${IND1}</div>`);
    } else {
        throw new Error(`No renderer for pattern: ${block.pattern}`);
    }
    return lines.join('\n');
}

export function blockHtml(block) {
    return block.dirty ? renderBlock(block) : block.sourceHtml;
}

// ---------------------------------------------------------------------------
// Public parse / serialize
// ---------------------------------------------------------------------------

export function parseRegion(region) {
    const chunks = chunkRegion(region);
    const blocks = chunks.map(classifyChunk);
    const rebuilt = serializeRegion(blocks);
    if (rebuilt !== region) {
        throw new Error('Round-trip mismatch: this page version has formatting Studio cannot preserve.');
    }
    return blocks;
}

export function serializeRegion(blocks) {
    return '\n' + blocks.map(blockHtml).join('\n\n') + '\n';
}

export async function sha256hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Create a fresh block for the palette. Placeholder slots use a data-URI
// checkerboard so the block is visible before images are dropped in.
export const PLACEHOLDER_SRC = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
    '<rect width="600" height="400" fill="#ebeae5"/>' +
    '<text x="300" y="205" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#999">drop an image</text></svg>'
);

export function createBlock(patternKey, videoLibrary) {
    const def = PATTERNS[patternKey];
    if (!def) throw new Error(`Unknown pattern ${patternKey}`);
    const slots = def.slots.map((s) => {
        const kind = s.kind === 'media' ? 'image' : s.kind;
        if (kind === 'video') {
            const v = (videoLibrary && videoLibrary[0]) || { url: '', ariaLabel: 'Video' };
            return { kind: 'video', url: v.url, ariaLabel: v.ariaLabel };
        }
        return { kind: 'image', src: PLACEHOLDER_SRC, alt: '', objectPosition: null, placeholder: true };
    });
    return {
        id: nextId(), kind: 'pattern', pattern: patternKey, variant: '', extraClasses: [],
        comment: ` ${def.label} `, slots, sourceHtml: '', dirty: true,
    };
}
