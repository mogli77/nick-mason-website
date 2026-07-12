// Studio overlay: everything that touches the iframe document.
// Same-origin, so the parent holds a direct reference — no postMessage.

import { blockHtml, slotFit } from './model.js';

let iframe = null;
let callbacks = {};

export function init(iframeEl, cbs) {
    iframe = iframeEl;
    callbacks = cbs;
}

const doc = () => iframe.contentDocument;

// ---------------------------------------------------------------------------
// srcdoc construction: real page source, scripts stripped, studio CSS injected
// ---------------------------------------------------------------------------

export function buildSrcdoc(fileText, blocks) {
    let html = fileText;

    // Kill every script — parallax, fade transitions, nav logic, autoplay
    // observers. The editor provides its own minimal replacements.
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

    // Resolve relative URLs against the site root and inject editor styles.
    const headInject = `<base href="${location.origin}/">` +
        `<link rel="stylesheet" href="${location.origin}/studio/iframe.css">`;
    html = html.replace(/<head>/i, `<head>${headInject}`);

    // Replace the gallery region with the id-stamped render.
    const lines = html.split('\n');
    const open = lines.findIndex((l) => /^\s*<section class="project-gallery">\s*$/.test(l));
    let close = -1;
    for (let i = open + 1; i < lines.length; i++) {
        if (/^\s{8}<\/section>\s*$/.test(lines[i])) { close = i; break; }
    }
    const regionHtml = '\n' + blocks.map((b) => displayHtml(b)).join('\n\n') + '\n';
    html = lines.slice(0, open + 1).join('\n') + regionHtml + lines.slice(close).join('\n');

    return html;
}

// Block HTML with data-studio-id stamped on the root element (display only —
// never part of what gets published).
function displayHtml(block) {
    const text = blockHtml(block);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*<!--/.test(lines[i])) continue;
        lines[i] = lines[i].replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-studio-id="${block.id}"`);
        break;
    }
    return lines.join('\n');
}

export function onIframeReady() {
    const d = doc();

    // The page boots with a fade-out opacity class that a (now stripped)
    // pageshow handler would normally remove.
    d.body.classList.remove('fade-out');

    // Minimal autoplay: play muted videos in view, pause out of view.
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            const v = e.target;
            if (e.isIntersecting) {
                v.muted = true;
                const p = v.play();
                if (p && p.catch) p.catch(() => {});
            } else {
                v.pause();
            }
        }
    }, { threshold: 0.1 });
    d.querySelectorAll('video').forEach((v) => {
        v.setAttribute('preload', 'metadata');
        io.observe(v);
    });

    // No navigation, no text selection surprises inside the canvas.
    d.addEventListener('click', (e) => {
        e.preventDefault();
        const root = e.target.closest('[data-studio-id]');
        callbacks.onSelect(root ? root.getAttribute('data-studio-id') : null);
    }, true);

    d.addEventListener('keydown', (e) => callbacks.onKeydown(e));
}

// ---------------------------------------------------------------------------
// DOM patching (no iframe reloads — scroll survives every edit)
// ---------------------------------------------------------------------------

export function galleryEl() {
    return doc().querySelector('section.project-gallery');
}

export function blockEl(id) {
    return doc().querySelector(`[data-studio-id="${id}"]`);
}

export function patchBlock(block) {
    const el = blockEl(block.id);
    if (!el) return;
    const range = doc().createRange();
    range.selectNode(el);
    const frag = range.createContextualFragment(displayHtml(block));
    const next = frag.firstElementChild;
    el.replaceWith(frag);
    hookVideos(next);
}

export function insertBlockAt(block, index, blocks) {
    const gallery = galleryEl();
    const range = doc().createRange();
    range.selectNode(gallery);
    const frag = range.createContextualFragment(displayHtml(block));
    const node = frag.firstElementChild;
    const after = blocks[index + 1];
    gallery.insertBefore(frag, after ? blockEl(after.id) : null);
    hookVideos(node);
    return node;
}

export function removeBlock(id) {
    const el = blockEl(id);
    if (el) el.remove();
}

export function reorderDom(blocks) {
    const gallery = galleryEl();
    for (const b of blocks) {
        const el = blockEl(b.id);
        if (el) gallery.appendChild(el);
    }
}

function hookVideos(rootNode) {
    if (!rootNode || !rootNode.querySelectorAll) return;
    rootNode.querySelectorAll('video').forEach((v) => {
        v.muted = true;
        v.setAttribute('preload', 'metadata');
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
    });
}

// ---------------------------------------------------------------------------
// Selection + badges
// ---------------------------------------------------------------------------

export function setSelected(id) {
    const d = doc();
    if (!d) return;
    d.querySelectorAll('.studio-selected').forEach((el) => el.classList.remove('studio-selected'));
    if (id) {
        const el = blockEl(id);
        if (el) el.classList.add('studio-selected');
    }
}

export function scrollToBlock(id) {
    const el = blockEl(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------------------------------------------------------------------------
// Drop hit-testing (parent-space pointer coords → iframe elements)
// ---------------------------------------------------------------------------

function iframePoint(clientX, clientY) {
    const r = iframe.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    // The iframe may be scaled (mobile preview keeps layout width but shrinks
    // visually via CSS width) — map through the ratio of layout to painted size.
    const scaleX = iframe.clientWidth / r.width;
    const scaleY = iframe.clientHeight / r.height;
    return { x: (clientX - r.left) * scaleX, y: (clientY - r.top) * scaleY };
}

// Find the media slot (img/video) under a parent-space point.
// Returns { blockId, slotIndex, el } or null.
export function slotAtPoint(clientX, clientY, blocks) {
    const pt = iframePoint(clientX, clientY);
    if (!pt) return null;
    const el = doc().elementFromPoint(pt.x, pt.y);
    if (!el) return null;
    const root = el.closest('[data-studio-id]');
    if (!root) return null;
    const id = root.getAttribute('data-studio-id');
    const block = blocks.find((b) => b.id === id);
    if (!block || block.kind !== 'pattern') return null;
    const media = el.closest('img, video');
    if (!media) return null;
    const all = mediaEls(root);
    const slotIndex = all.indexOf(media);
    if (slotIndex === -1) return null;
    return { blockId: id, slotIndex, el: media };
}

// Media elements of a block root, in SLOT order (feature-wide slots are
// [small, large] regardless of DOM order).
export function mediaEls(rootEl) {
    const els = Array.from(rootEl.querySelectorAll('img, video'));
    const cls = rootEl.getAttribute('class') || '';
    if (cls.includes('feature-wide')) {
        const small = rootEl.querySelector('.feature-small img, .feature-small video');
        const large = rootEl.querySelector('.feature-large img, .feature-large video');
        return [small, large].filter(Boolean);
    }
    return els;
}

export function highlightSlot(target, ok) {
    clearHighlights();
    if (target && target.el) {
        target.el.classList.add(ok ? 'studio-drop-ok' : 'studio-drop-no');
    }
}

export function clearHighlights() {
    const d = doc();
    if (!d) return;
    d.querySelectorAll('.studio-drop-ok, .studio-drop-no').forEach((el) => {
        el.classList.remove('studio-drop-ok', 'studio-drop-no');
    });
}

// Insertion index for block-level drops: which gap is nearest the pointer?
export function insertionIndexAtPoint(clientY, blocks) {
    const r = iframe.getBoundingClientRect();
    const scaleY = iframe.clientHeight / r.height;
    const y = (clientY - r.top) * scaleY + doc().defaultView.scrollY;
    let best = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
        const el = blockEl(blocks[i].id);
        if (!el) continue;
        const mid = el.offsetTop + el.offsetHeight / 2;
        if (y < mid) { best = i; break; }
    }
    return best;
}

export function showInsertionCaret(index, blocks) {
    const d = doc();
    let caret = d.querySelector('.studio-caret');
    if (!caret) {
        caret = d.createElement('div');
        caret.className = 'studio-caret';
        galleryEl().appendChild(caret);
    }
    let top;
    if (index >= blocks.length) {
        const last = blockEl(blocks[blocks.length - 1].id);
        top = last ? last.offsetTop + last.offsetHeight + 20 : 0;
    } else {
        const el = blockEl(blocks[index].id);
        top = el ? el.offsetTop - 24 : 0;
    }
    caret.style.top = `${top}px`;
    caret.style.display = 'block';
}

export function hideInsertionCaret() {
    const d = doc();
    if (!d) return;
    const caret = d.querySelector('.studio-caret');
    if (caret) caret.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Crop-pan: drag inside a cover-fit image to set object-position
// ---------------------------------------------------------------------------

export function attachCropPan(blocks, { getBlock, onCommit }) {
    const d = doc();
    let drag = null;

    d.addEventListener('pointerdown', (e) => {
        const img = e.target.closest('img');
        if (!img) return;
        const root = img.closest('[data-studio-id]');
        if (!root) return;
        const id = root.getAttribute('data-studio-id');
        const block = getBlock(id);
        if (!block || block.kind !== 'pattern') return;
        const idx = mediaEls(root).indexOf(img);
        if (idx === -1 || slotFit(block, idx) !== 'cover') return;

        const natW = img.naturalWidth, natH = img.naturalHeight;
        if (!natW || !natH) return;
        const frame = img.getBoundingClientRect();
        const scale = Math.max(frame.width / natW, frame.height / natH);
        const ovX = natW * scale - frame.width;
        const ovY = natH * scale - frame.height;
        if (ovX <= 1 && ovY <= 1) return;

        const current = (getComputedStyle(img).objectPosition || '50% 50%').split(' ');
        drag = {
            img, id, idx,
            startX: e.clientX, startY: e.clientY,
            posX: parseFloat(current[0]) || 50,
            posY: parseFloat(current[1]) || 50,
            ovX, ovY,
            moved: false,
        };
        try { img.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        e.preventDefault();
    }, true);

    d.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        const nx = drag.ovX > 1 ? clamp(drag.posX - (dx / drag.ovX) * 100, 0, 100) : drag.posX;
        const ny = drag.ovY > 1 ? clamp(drag.posY - (dy / drag.ovY) * 100, 0, 100) : drag.posY;
        drag.img.style.objectPosition = `${nx.toFixed(1)}% ${ny.toFixed(1)}%`;
        drag.live = { nx, ny };
    }, true);

    d.addEventListener('pointerup', () => {
        if (!drag) return;
        if (drag.moved && drag.live) {
            onCommit(drag.id, drag.idx, `${Math.round(drag.live.nx)}% ${Math.round(drag.live.ny)}%`);
        }
        drag = null;
    }, true);
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}
