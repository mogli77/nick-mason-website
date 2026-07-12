// Studio freeform overlay: all direct-manipulation inside the canvas iframe.
// Click = select · drag = move · corners = proportional resize · sides = free
// resize · double-click = crop mode · empty-canvas drag = marquee multi-select
// · snap guides against other frames' edges and centers.

import { canvasHeightWu, frameHtml, nextId, normalizeZ } from './model.js';

let iframe = null;
let cb = {};            // { getModel, onChange(commit=true), onSelect(ids), snapshot, onKeydown, altForImage }
let selection = [];     // frame ids
let cropId = null;      // frame id in crop mode
const SNAP = 6;         // px
const HANDLE_KINDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function init(iframeEl, callbacks) {
    iframe = iframeEl;
    cb = callbacks;
}

const doc = () => iframe.contentDocument;
const win = () => iframe.contentWindow;
const canvasEl = () => doc().querySelector('.ff-canvas');
const frames = () => cb.getModel().frames;
const frameById = (id) => frames().find((f) => f.id === id);
const pxPerWu = () => canvasEl().getBoundingClientRect().width / 100;

export function getSelection() { return [...selection]; }

// ---------------------------------------------------------------------------
// srcdoc + full canvas render
// ---------------------------------------------------------------------------

export function buildSrcdoc(fileText, regionHtml) {
    let html = fileText.replace(/<script[\s\S]*?<\/script>/gi, '');
    const headInject = `<base href="${location.origin}/">` +
        `<link rel="stylesheet" href="${location.origin}/studio/iframe.css">`;
    html = html.replace(/<head>/i, `<head>${headInject}`);
    const lines = html.split('\n');
    const open = lines.findIndex((l) => /^\s*<section class="project-gallery">\s*$/.test(l));
    let close = -1;
    for (let i = open + 1; i < lines.length; i++) {
        if (/^\s{8}<\/section>\s*$/.test(lines[i])) { close = i; break; }
    }
    return lines.slice(0, open + 1).join('\n') + regionHtml + lines.slice(close).join('\n');
}

// Re-render the whole canvas from the model (used after undo/redo and boot).
export function renderCanvas() {
    const model = cb.getModel();
    const c = canvasEl();
    const heightWu = canvasHeightWu(model.frames);
    c.style.aspectRatio = `1000 / ${Math.round(heightWu * 10)}`;
    c.querySelectorAll(':scope > figure.ff-frame').forEach((el) => el.remove());
    const sorted = [...model.frames].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const range = doc().createRange();
    range.selectNode(c);
    for (const f of sorted) {
        c.appendChild(range.createContextualFragment(frameHtml(f, heightWu, { withId: true })));
    }
    hookVideos(c);
    syncSelectionUi();
}

// Update one frame's DOM geometry from the model (cheap, during/after gestures).
export function syncFrame(id) {
    const f = frameById(id);
    const el = frameEl(id);
    if (!f || !el) return;
    const heightWu = canvasHeightWu(frames());
    el.style.left = `${f.x}%`;
    el.style.top = `${(f.y / heightWu) * 100}%`;
    el.style.width = `${f.w}%`;
    el.style.height = `${(f.h / heightWu) * 100}%`;
    el.style.zIndex = f.z || 1;
}

// Growing/shrinking the canvas rescales every frame's top/height percentage.
export function syncAllGeometry() {
    const c = canvasEl();
    const heightWu = canvasHeightWu(frames());
    c.style.aspectRatio = `1000 / ${Math.round(heightWu * 10)}`;
    for (const f of frames()) syncFrame(f.id);
    syncSelectionUi();
}

const frameEl = (id) => doc().querySelector(`figure.ff-frame[data-ff-id="${id}"]`);

function hookVideos(root) {
    root.querySelectorAll('video').forEach((v) => {
        v.muted = true;
        v.setAttribute('preload', 'metadata');
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
    });
}

export function onIframeReady() {
    const d = doc();
    d.body.classList.remove('fade-out');

    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (e.isIntersecting) { e.target.muted = true; const p = e.target.play(); if (p && p.catch) p.catch(() => {}); }
            else e.target.pause();
        }
    }, { threshold: 0.05 });
    d.querySelectorAll('video').forEach((v) => io.observe(v));

    d.addEventListener('click', (e) => e.preventDefault(), true);
    d.addEventListener('keydown', (e) => handleKeys(e));
    attachPointerHandlers();
}

// ---------------------------------------------------------------------------
// Selection UI (outline via class; handles + toolbar for single selection)
// ---------------------------------------------------------------------------

export function select(ids, { additive = false } = {}) {
    selection = additive ? [...new Set([...selection, ...ids])] : [...ids];
    if (cropId && !selection.includes(cropId)) exitCrop();
    syncSelectionUi();
    cb.onSelect(getSelection());
}

function syncSelectionUi() {
    const d = doc();
    if (!d || !canvasEl()) return;
    d.querySelectorAll('.ff-selected').forEach((el) => el.classList.remove('ff-selected'));
    for (const id of selection) {
        const el = frameEl(id);
        if (el) el.classList.add('ff-selected');
    }
    positionChrome();
}

function chromeEls() {
    const c = canvasEl();
    let box = c.querySelector('.ff-chrome');
    if (!box) {
        box = doc().createElement('div');
        box.className = 'ff-chrome';
        box.innerHTML =
            HANDLE_KINDS.map((k) => `<div class="ff-handle ff-h-${k}" data-handle="${k}"></div>`).join('') +
            `<div class="ff-toolbar">
                <button data-ff-act="front" title="Bring forward">↥</button>
                <button data-ff-act="back" title="Send backward">↧</button>
                <button data-ff-act="crop" title="Adjust crop (or double-click)">Crop</button>
                <button data-ff-act="delete" title="Delete (⌫)">✕</button>
            </div>`;
        c.appendChild(box);
        box.querySelectorAll('[data-ff-act]').forEach((btn) => {
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toolbarAction(btn.getAttribute('data-ff-act'));
            });
        });
    }
    return box;
}

function positionChrome() {
    const c = canvasEl();
    if (!c) return;
    const box = chromeEls();
    if (selection.length !== 1 || cropId) {
        box.style.display = 'none';
        return;
    }
    const el = frameEl(selection[0]);
    if (!el) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.left = el.style.left;
    box.style.top = el.style.top;
    box.style.width = el.style.width;
    box.style.height = el.style.height;
    box.style.zIndex = 9000;
}

function toolbarAction(act) {
    const id = selection[0];
    const f = frameById(id);
    if (!f) return;
    if (act === 'delete') return deleteSelection();
    if (act === 'crop') return enterCrop(id);
    cb.snapshot();
    const all = frames();
    if (act === 'front') f.z = Math.max(...all.map((x) => x.z || 0)) + 1;
    if (act === 'back') f.z = Math.min(...all.map((x) => x.z || 0)) - 1;
    normalizeZ(all);
    for (const x of all) syncFrame(x.id);
    positionChrome();
    cb.onChange();
}

export function deleteSelection() {
    if (!selection.length) return;
    cb.snapshot();
    const model = cb.getModel();
    for (const id of selection) {
        const el = frameEl(id);
        if (el) el.remove();
    }
    model.frames = model.frames.filter((f) => !selection.includes(f.id));
    selection = [];
    syncAllGeometry();
    cb.onSelect([]);
    cb.onChange();
}

// ---------------------------------------------------------------------------
// Crop mode
// ---------------------------------------------------------------------------

function enterCrop(id) {
    const f = frameById(id);
    if (!f || f.kind !== 'image') return;
    cropId = id;
    const el = frameEl(id);
    if (el) el.classList.add('ff-cropping');
    positionChrome();
}

export function exitCrop() {
    if (!cropId) return;
    const el = frameEl(cropId);
    if (el) el.classList.remove('ff-cropping');
    cropId = null;
    positionChrome();
}

function cropDrag(e, f, img) {
    const natW = img.naturalWidth, natH = img.naturalHeight;
    if (!natW) return null;
    const fr = img.getBoundingClientRect();
    const s = Math.max(fr.width / natW, fr.height / natH);
    const ovX = natW * s - fr.width, ovY = natH * s - fr.height;
    const cur = (win().getComputedStyle(img).objectPosition || '50% 50%').split(' ');
    return {
        type: 'crop', id: f.id, img, ovX, ovY,
        startX: e.clientX, startY: e.clientY,
        posX: parseFloat(cur[0]) || 50, posY: parseFloat(cur[1]) || 50,
    };
}

// ---------------------------------------------------------------------------
// Pointer machinery: move / resize / marquee / crop — one state machine
// ---------------------------------------------------------------------------

let gesture = null;

function attachPointerHandlers() {
    const d = doc();

    d.addEventListener('pointerdown', (e) => {
        const c = canvasEl();
        if (!c) return;
        if (win().innerWidth <= 767) return; // mobile preview is read-only
        const handle = e.target.closest('.ff-handle');
        const fig = e.target.closest('figure.ff-frame');
        const inCanvas = e.target.closest('.ff-canvas');
        if (!inCanvas) { if (!e.target.closest('.ff-chrome')) { select([]); } return; }
        e.preventDefault();

        if (handle && selection.length === 1) {
            const f = frameById(selection[0]);
            cb.snapshot();
            gesture = {
                type: 'resize', kind: handle.getAttribute('data-handle'),
                id: f.id, startX: e.clientX, startY: e.clientY,
                orig: { x: f.x, y: f.y, w: f.w, h: f.h },
                moved: false,
            };
            return;
        }

        if (fig) {
            const id = fig.getAttribute('data-ff-id');
            const f = frameById(id);
            if (!f) return;
            if (cropId === id) {
                const img = fig.querySelector('img');
                const g = cropDrag(e, f, img);
                if (g) { cb.snapshot(); gesture = g; }
                return;
            }
            if (cropId) exitCrop();
            if (!selection.includes(id)) select([id], { additive: e.shiftKey });
            else if (e.shiftKey) { select(selection.filter((s) => s !== id)); return; }
            cb.snapshot();
            gesture = {
                type: 'move', startX: e.clientX, startY: e.clientY, moved: false,
                items: selection.map((sid) => {
                    const sf = frameById(sid);
                    return { id: sid, ox: sf.x, oy: sf.y };
                }),
            };
            return;
        }

        // Empty canvas: marquee
        if (cropId) exitCrop();
        select([]);
        const cRect = c.getBoundingClientRect();
        gesture = {
            type: 'marquee',
            x0: e.clientX - cRect.left, y0: e.clientY - cRect.top + win().scrollY * 0,
        };
        gesture.y0 = e.clientY - cRect.top; // rect-relative; cRect moves with scroll
        marqueeEl().style.display = 'block';
    }, true);

    d.addEventListener('pointermove', (e) => {
        if (!gesture) return;
        e.preventDefault();
        autoScroll(e);
        if (gesture.type === 'move') return doMove(e);
        if (gesture.type === 'resize') return doResize(e);
        if (gesture.type === 'marquee') return doMarquee(e);
        if (gesture.type === 'crop') return doCrop(e);
    }, true);

    d.addEventListener('pointerup', () => {
        if (!gesture) return;
        const g = gesture;
        gesture = null;
        clearGuides();
        marqueeEl().style.display = 'none';
        if (g.type === 'move' || g.type === 'resize') {
            if (!g.moved) cb.discardSnapshot && cb.discardSnapshot();
            else { syncAllGeometry(); cb.onChange(); }
        }
        if (g.type === 'crop') {
            const f = frameById(g.id);
            if (f && g.live) {
                f.objectPosition = g.live === '50% 50%' ? null : g.live;
                cb.onChange();
            }
        }
        if (g.type === 'marquee' && g.picked) cb.onSelect(getSelection());
    }, true);

    d.addEventListener('dblclick', (e) => {
        const fig = e.target.closest('figure.ff-frame');
        if (fig) enterCrop(fig.getAttribute('data-ff-id'));
        else exitCrop();
    }, true);
}

function doMove(e) {
    const ppw = pxPerWu();
    let dx = (e.clientX - gesture.startX) / ppw;
    let dy = (e.clientY - gesture.startY) / ppw;
    if (Math.abs(dx) + Math.abs(dy) > 0.2) gesture.moved = true;

    // Snap the primary frame against others
    if (gesture.items.length === 1) {
        const it = gesture.items[0];
        const f = frameById(it.id);
        const snapped = snap(it.ox + dx, it.oy + dy, f.w, f.h, it.id);
        dx = snapped.x - it.ox;
        dy = snapped.y - it.oy;
    } else {
        clearGuides();
    }
    for (const it of gesture.items) {
        const f = frameById(it.id);
        f.x = it.ox + dx;
        f.y = Math.max(0, it.oy + dy);
        syncFrame(f.id);
    }
    positionChrome();
}

function doResize(e) {
    const ppw = pxPerWu();
    const dx = (e.clientX - gesture.startX) / ppw;
    const dy = (e.clientY - gesture.startY) / ppw;
    if (Math.abs(dx) + Math.abs(dy) > 0.2) gesture.moved = true;
    const o = gesture.orig;
    const f = frameById(gesture.id);
    const k = gesture.kind;
    const MIN = 4;
    let { x, y, w, h } = o;

    const corner = k.length === 2;
    if (corner) {
        // Proportional: dominant axis drives, aspect locked.
        const signX = k.includes('e') ? 1 : -1;
        const signY = k.includes('s') ? 1 : -1;
        const dw = signX * dx;
        const dh = signY * dy;
        const scale = Math.max((o.w + dw) / o.w, (o.h + dh) / o.h);
        w = Math.max(MIN, o.w * scale);
        h = o.h * (w / o.w);
        if (k.includes('w')) x = o.x + (o.w - w);
        if (k.includes('n')) y = o.y + (o.h - h);
    } else {
        if (k === 'e') w = Math.max(MIN, o.w + dx);
        if (k === 'w') { w = Math.max(MIN, o.w - dx); x = o.x + (o.w - w); }
        if (k === 's') h = Math.max(MIN, o.h + dy);
        if (k === 'n') { h = Math.max(MIN, o.h - dy); y = o.y + (o.h - h); }
    }
    f.x = x; f.y = Math.max(0, y); f.w = w; f.h = h;
    syncFrame(f.id);
    positionChrome();
}

function doCrop(e) {
    const g = gesture;
    const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
    const nx = g.ovX > 1 ? clamp(g.posX - (dx / g.ovX) * 100, 0, 100) : g.posX;
    const ny = g.ovY > 1 ? clamp(g.posY - (dy / g.ovY) * 100, 0, 100) : g.posY;
    g.live = `${Math.round(nx)}% ${Math.round(ny)}%`;
    g.img.style.objectPosition = `${nx.toFixed(1)}% ${ny.toFixed(1)}%`;
}

function doMarquee(e) {
    const c = canvasEl();
    const cRect = c.getBoundingClientRect();
    const x1 = e.clientX - cRect.left, y1 = e.clientY - cRect.top;
    const box = {
        left: Math.min(gesture.x0, x1), top: Math.min(gesture.y0, y1),
        right: Math.max(gesture.x0, x1), bottom: Math.max(gesture.y0, y1),
    };
    const m = marqueeEl();
    m.style.left = `${box.left}px`;
    m.style.top = `${box.top}px`;
    m.style.width = `${box.right - box.left}px`;
    m.style.height = `${box.bottom - box.top}px`;

    const ppw = pxPerWu();
    const hits = frames().filter((f) => {
        const fl = f.x * ppw, ft = f.y * ppw, fr = fl + f.w * ppw, fb = ft + f.h * ppw;
        return fl < box.right && fr > box.left && ft < box.bottom && fb > box.top;
    }).map((f) => f.id);
    gesture.picked = true;
    selection = hits;
    syncSelectionUi();
}

function marqueeEl() {
    const c = canvasEl();
    let m = c.querySelector('.ff-marquee');
    if (!m) {
        m = doc().createElement('div');
        m.className = 'ff-marquee';
        c.appendChild(m);
    }
    return m;
}

// ---------------------------------------------------------------------------
// Snap guides
// ---------------------------------------------------------------------------

function snap(x, y, w, h, skipId) {
    const ppw = pxPerWu();
    const tol = SNAP / ppw;
    const xLines = [0, 50 - w / 2, 100 - w]; // canvas left / center / right
    const yLines = [];
    const guidesX = [0, 50, 100];
    const guidesY = [];
    for (const o of frames()) {
        if (o.id === skipId) continue;
        xLines.push(o.x, o.x + o.w / 2 - w / 2, o.x + o.w - w, o.x + o.w, o.x - w);
        guidesX.push(o.x, o.x + o.w / 2, o.x + o.w, o.x + o.w, o.x);
        yLines.push(o.y, o.y + o.h / 2 - h / 2, o.y + o.h - h, o.y + o.h, o.y - h);
        guidesY.push(o.y, o.y + o.h / 2, o.y + o.h, o.y + o.h, o.y);
    }
    let bestX = null, bestY = null, gx = null, gy = null;
    for (let i = 0; i < xLines.length; i++) {
        const d = Math.abs(x - xLines[i]);
        if (d < tol && (bestX === null || d < Math.abs(x - bestX))) { bestX = xLines[i]; gx = guidesX[i]; }
    }
    for (let i = 0; i < yLines.length; i++) {
        const d = Math.abs(y - yLines[i]);
        if (d < tol && (bestY === null || d < Math.abs(y - bestY))) { bestY = yLines[i]; gy = guidesY[i]; }
    }
    drawGuides(gx, gy);
    return { x: bestX !== null ? bestX : x, y: bestY !== null ? bestY : y };
}

function drawGuides(gx, gy) {
    clearGuides();
    const c = canvasEl();
    const heightWu = canvasHeightWu(frames());
    if (gx !== null && gx !== undefined) {
        const v = doc().createElement('div');
        v.className = 'ff-guide ff-guide-v';
        v.style.left = `${gx}%`;
        c.appendChild(v);
    }
    if (gy !== null && gy !== undefined) {
        const hEl = doc().createElement('div');
        hEl.className = 'ff-guide ff-guide-h';
        hEl.style.top = `${(gy / heightWu) * 100}%`;
        c.appendChild(hEl);
    }
}

function clearGuides() {
    const c = canvasEl();
    if (c) c.querySelectorAll('.ff-guide').forEach((el) => el.remove());
}

// ---------------------------------------------------------------------------
// Keyboard, auto-scroll, tray drop target
// ---------------------------------------------------------------------------

function handleKeys(e) {
    if (cb.onKeydown) cb.onKeydown(e);
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Escape') { exitCrop(); select([]); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && selection.length) {
        e.preventDefault();
        deleteSelection();
        return;
    }
    const step = e.shiftKey ? 2 : 0.3;
    const dirs = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (dirs[e.key] && selection.length) {
        e.preventDefault();
        cb.snapshot();
        for (const id of selection) {
            const f = frameById(id);
            f.x += dirs[e.key][0];
            f.y = Math.max(0, f.y + dirs[e.key][1]);
            syncFrame(id);
        }
        positionChrome();
        cb.onChange();
    }
}

function autoScroll(e) {
    const holder = iframe.getBoundingClientRect();
    const EDGE = 60, STEP = 14;
    // e.clientY is iframe-viewport-relative for iframe listeners
    const vh = win().innerHeight;
    if (e.clientY < EDGE) win().scrollBy(0, -STEP);
    else if (e.clientY > vh - EDGE) win().scrollBy(0, STEP);
    void holder;
}

// Parent-space point → canvas wu coords (for tray drops), or null.
export function canvasPointFromParent(clientX, clientY) {
    const r = iframe.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const scaleX = iframe.clientWidth / r.width;
    const scaleY = iframe.clientHeight / r.height;
    const vx = (clientX - r.left) * scaleX;
    const vy = (clientY - r.top) * scaleY;
    const cRect = canvasEl().getBoundingClientRect();
    const ppw = pxPerWu();
    return { x: (vx - cRect.left) / ppw, y: (vy - cRect.top) / ppw };
}

export function setDropPreview(on) {
    const c = canvasEl();
    if (c) c.classList.toggle('ff-drop-target', Boolean(on));
}

// Add a frame at a canvas point (from tray drop). aspect = natural w/h.
export function addFrameAt(pt, media, aspect) {
    cb.snapshot();
    const model = cb.getModel();
    const w = 38;
    const h = w / (aspect || 1.5);
    const all = model.frames;
    const frame = {
        id: nextId(),
        kind: media.kind,
        ...(media.kind === 'video'
            ? { url: media.url, ariaLabel: media.ariaLabel }
            : { src: media.src, alt: media.alt, objectPosition: null }),
        x: clamp(pt.x - w / 2, 0, 100 - w),
        y: Math.max(0, pt.y - h / 2),
        w, h,
        z: (all.length ? Math.max(...all.map((f) => f.z || 0)) : 0) + 1,
    };
    model.frames.push(frame);
    const heightWu = canvasHeightWu(model.frames);
    const c = canvasEl();
    c.style.aspectRatio = `1000 / ${Math.round(heightWu * 10)}`;
    const range = doc().createRange();
    range.selectNode(c);
    c.appendChild(range.createContextualFragment(frameHtml(frame, heightWu, { withId: true })));
    hookVideos(c);
    syncAllGeometry();
    select([frame.id]);
    cb.onChange();
    return frame;
}

// ---------------------------------------------------------------------------
// Legacy migration: measure the rendered legacy gallery into frames
// ---------------------------------------------------------------------------

export async function measureLegacy(altLookup) {
    const d = doc();
    const section = d.querySelector('section.project-gallery');
    const sRect = () => section.getBoundingClientRect();
    // Force-load every image, then let layout settle.
    const imgs = Array.from(section.querySelectorAll('img'));
    imgs.forEach((i) => { i.loading = 'eager'; });
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((res) => {
        i.addEventListener('load', res, { once: true });
        i.addEventListener('error', res, { once: true });
    }))));
    await new Promise((r) => setTimeout(r, 400));

    const cs = win().getComputedStyle(section);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const width = section.clientWidth;
    const originTop = sRect().top + padTop;
    const originLeft = sRect().left;
    const ppw = width / 100;

    const media = Array.from(section.querySelectorAll('img, video'));
    const frames = [];
    media.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) return;
        const zRaw = parseInt(win().getComputedStyle(el.closest('figure') || el).zIndex, 10);
        const base = {
            id: nextId(),
            x: (r.left - originLeft) / ppw,
            y: (r.top - originTop) / ppw,
            w: r.width / ppw,
            h: r.height / ppw,
            z: (Number.isFinite(zRaw) ? zRaw * 100 : 0) + i,
        };
        if (el.tagName === 'VIDEO') {
            const source = el.querySelector('source');
            frames.push({ ...base, kind: 'video', url: source ? source.getAttribute('src') : '', ariaLabel: el.getAttribute('aria-label') || 'Video' });
        } else {
            const src = el.getAttribute('src') || '';
            frames.push({
                ...base, kind: 'image', src,
                alt: el.getAttribute('alt') || (altLookup ? altLookup(src) : ''),
                objectPosition: null,
            });
        }
    });
    normalizeZ(frames);
    return { version: 2, frames };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
