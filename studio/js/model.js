// Studio freeform model.
//
// The gallery is ONE proportional canvas; every image/video is a frame with
// percentage geometry. Internally all geometry lives in WIDTH-UNITS (wu):
// 1 wu = 1% of the canvas width, for x, y, w and h alike — so editing never
// renormalizes. At serialize time the canvas height (in wu) becomes the
// container's aspect-ratio, and y/h convert to CSS top/height percentages.
//
// The serialized region is fully machine-owned and self-contained (its own
// <style> block, inline geometry), so parse(serialize(m)) is exact.

const OPEN_RE = /^\s*<section class="project-gallery">\s*$/;
const CLOSE_RE = /^\s{8}<\/section>\s*$/;

const IND1 = ' '.repeat(12);
const IND2 = ' '.repeat(16);
const IND3 = ' '.repeat(20);

export const CANVAS_PAD_WU = 4; // breathing room below the lowest frame

// ---------------------------------------------------------------------------
// File splitting (same anchors as the publish function)
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

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

let idCounter = 0;
export const nextId = () => `f${++idCounter}`;

// frame: { id, kind:'image'|'video', src|url, alt|ariaLabel, x, y, w, h, z, objectPosition }

export function canvasHeightWu(frames) {
    let max = 0;
    for (const f of frames) max = Math.max(max, f.y + f.h);
    return Math.max(20, max + CANVAS_PAD_WU);
}

export function normalizeZ(frames) {
    const sorted = [...frames].sort((a, b) => (a.z || 0) - (b.z || 0));
    sorted.forEach((f, i) => { f.z = i + 1; });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

const STYLE_BLOCK = [
    `${IND1}<style>`,
    `${IND2}.ff-canvas { position: relative; width: 100%; }`,
    `${IND2}.ff-frame { position: absolute; margin: 0; overflow: hidden; background: #ebeae5; }`,
    `${IND2}.ff-frame img, .ff-frame video { width: 100%; height: 100%; object-fit: cover; display: block; }`,
    `${IND2}@media (max-width: 767px) {`,
    `${IND3}.ff-canvas { aspect-ratio: auto !important; }`,
    `${IND3}.ff-frame { position: static; width: 100% !important; height: auto !important; margin: 0 0 0.65rem; }`,
    `${IND3}.ff-frame img, .ff-frame video { height: auto; aspect-ratio: 4 / 3; }`,
    `${IND2}}`,
    `${IND1}</style>`,
].join('\n');

export function frameHtml(frame, heightWu, { withId = false } = {}) {
    const topPct = r3((frame.y / heightWu) * 100);
    const hPct = r3((frame.h / heightWu) * 100);
    const style = `left: ${r2(frame.x)}%; top: ${topPct}%; width: ${r2(frame.w)}%; height: ${hPct}%; z-index: ${frame.z || 1};`;
    // data-ff carries exact width-unit geometry so parse(serialize()) is
    // lossless; the style percentages are derived rendering only.
    const dataFf = ` data-ff="${r2(frame.x)} ${r2(frame.y)} ${r2(frame.w)} ${r2(frame.h)}"`;
    const idAttr = (withId ? ` data-ff-id="${frame.id}"` : '') + dataFf;
    if (frame.kind === 'video') {
        return [
            `${IND2}<figure class="ff-frame"${idAttr} style="${style}">`,
            `${IND3}<video class="autoplay-on-view" muted loop playsinline preload="none" aria-label="${esc(frame.ariaLabel)}">`,
            `${IND3}    <source src="${frame.url}" type="video/mp4">`,
            `${IND3}</video>`,
            `${IND2}</figure>`,
        ].join('\n');
    }
    const op = frame.objectPosition ? ` style="object-position: ${frame.objectPosition};"` : '';
    return [
        `${IND2}<figure class="ff-frame"${idAttr} style="${style}">`,
        `${IND3}<img loading="lazy" decoding="async" src="${frame.src}" alt="${esc(frame.alt)}"${op}>`,
        `${IND2}</figure>`,
    ].join('\n');
}

// Full region text. Frames are emitted sorted by visual reading order
// (top-to-bottom, then left-to-right) — this is the mobile stacking order.
export function serializeRegion(model, { withIds = false } = {}) {
    // Normalize geometry to 2 decimals FIRST so height/aspect derive from the
    // same values a re-parse would see — makes serialization idempotent.
    const frames = model.frames
        .map((f) => ({ ...f, x: r2(f.x), y: r2(f.y), w: r2(f.w), h: r2(f.h) }))
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const heightWu = canvasHeightWu(frames);
    const lines = [];
    lines.push(STYLE_BLOCK);
    lines.push('');
    lines.push(`${IND1}<!-- Freeform layout (generated by Studio — edit at /studio/) -->`);
    lines.push(`${IND1}<div class="ff-canvas" style="aspect-ratio: 1000 / ${Math.round(heightWu * 10)};">`);
    for (const f of frames) lines.push(frameHtml(f, heightWu, { withId: withIds }));
    lines.push(`${IND1}</div>`);
    return '\n' + lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Parsing (only the machine-written format; legacy pages return null and the
// caller migrates by measurement)
// ---------------------------------------------------------------------------

export function parseRegion(region) {
    if (!region.includes('ff-canvas')) return null;
    const doc = new DOMParser().parseFromString(region, 'text/html');
    const canvas = doc.querySelector('.ff-canvas');
    if (!canvas) return null;
    const m = (canvas.getAttribute('style') || '').match(/aspect-ratio:\s*1000\s*\/\s*([\d.]+)/);
    if (!m) throw new Error('Freeform canvas is missing its aspect-ratio.');
    const heightWu = parseFloat(m[1]) / 10;
    const frames = [];
    for (const fig of canvas.querySelectorAll(':scope > figure.ff-frame')) {
        const st = fig.getAttribute('style') || '';
        const zm = st.match(/z-index:\s*(\d+)/);
        let geo;
        const dataFf = fig.getAttribute('data-ff');
        if (dataFf) {
            const [x, y, w, h] = dataFf.split(' ').map(Number);
            geo = { x, y, w, h };
        } else {
            const num = (name) => {
                const mm = st.match(new RegExp(`${name}:\\s*([\\d.]+)%`));
                return mm ? parseFloat(mm[1]) : 0;
            };
            geo = {
                x: num('left'),
                y: (num('top') / 100) * heightWu,
                w: num('width'),
                h: (num('height') / 100) * heightWu,
            };
        }
        const base = {
            id: nextId(),
            ...geo,
            z: zm ? parseInt(zm[1], 10) : 1,
        };
        const video = fig.querySelector('video');
        if (video) {
            const source = video.querySelector('source');
            frames.push({
                ...base, kind: 'video',
                url: source ? source.getAttribute('src') : '',
                ariaLabel: video.getAttribute('aria-label') || '',
            });
        } else {
            const img = fig.querySelector('img');
            if (!img) continue;
            const opm = (img.getAttribute('style') || '').match(/object-position:\s*([^;]+);?/);
            frames.push({
                ...base, kind: 'image',
                src: img.getAttribute('src') || '',
                alt: img.getAttribute('alt') || '',
                objectPosition: opm ? opm[1].trim() : null,
            });
        }
    }
    return { version: 2, frames };
}

export async function sha256hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
