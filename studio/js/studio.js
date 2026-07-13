// Studio app (freeform): state, tray, page map, drafts, publish.

import * as model from './model.js';
import * as api from './api.js';
import * as overlay from './overlay.js';

const DRAFT_KEY = 'nickMason.studio.draft.v2';
const $ = (sel) => document.querySelector(sel);

const VIDEO_LIBRARY = [
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:good,w_1920,c_limit,vc_h264,f_mp4/v1775596060/pool_nick_tyeuiq.mp4', ariaLabel: 'La Marina pool and bench video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:eco,w_1600,c_limit,vc_h264,f_mp4/v1775596062/palmtree_nick_xnkxc9.mp4', ariaLabel: 'Palm tree video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:good,w_1600,c_limit,vc_h264,f_mp4/v1776379229/green_03_dlhhaw.mp4', ariaLabel: 'Garden hedge video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:good,w_1920,c_limit,vc_h264,f_mp4/v1776365013/rock_03_g6ucb6.mp4', ariaLabel: 'Sourced stone video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:eco,w_1280,c_limit,vc_h264,f_mp4/v1776377096/water_bubbles_01_d3ppl4.mp4', ariaLabel: 'Pond water video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:eco,w_1280,c_limit,vc_h264,f_mp4/v1776357798/fan_01_dz6n2g.mp4', ariaLabel: 'Fan detail video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:good,w_1920,c_limit,vc_h264,f_mp4/v1776364859/wood_01_dewmhw.mp4', ariaLabel: 'Pine ceiling video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:good,w_1280,c_limit,vc_h264,f_mp4/v1775596909/fire_nick_02_q5n2n0.mp4', ariaLabel: 'Fire pit video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:good,w_1920,c_limit,vc_h264,f_mp4/v1775616599/dog_nick_01_lcn0pv.mp4', ariaLabel: 'Dog in the garden video' },
    { url: 'https://res.cloudinary.com/dylwzl4vu/video/upload/q_auto:best,w_1920,c_limit,vc_h264,f_mp4/v1775604634/ocean_nick_02_gafg2s.mp4', ariaLabel: 'Ocean at dusk video' },
];

const state = {
    fileText: null,
    baseGalleryHash: null,
    model: { version: 2, frames: [] },
    history: [],
    future: [],
    altMap: {},
    imageFolders: {},
    dirtySinceLoad: false,
    migrated: false,       // legacy page converted this session (not yet published)
    lastCommit: null,
    local: false,          // Pro mode: running on netlify dev, saves go to disk
};

function customVideos() {
    try {
        return JSON.parse(localStorage.getItem('nickMason.studio.customVideos')) || [];
    } catch {
        return [];
    }
}

function allVideos() {
    return [...VIDEO_LIBRARY, ...customVideos()];
}

// ---------------------------------------------------------------------------
// Boot + auth
// ---------------------------------------------------------------------------

api.setUnauthorizedHandler(() => {
    api.clearAuth();
    showLogin();
});

async function boot() {
    const auth = api.getAuth();
    if (!auth || !auth.key || !auth.editor) {
        showLogin();
        return;
    }
    $('#login').style.display = 'none';
    $('#app').style.display = 'grid';
    $('#who').textContent = auth.editor;
    setStatus('Loading page…');

    const res = await api.fetchContent();
    if (!res.ok) {
        setStatus(res.data.message || 'Failed to load.', 'error');
        return;
    }
    state.fileText = res.data.content;
    state.baseGalleryHash = res.data.galleryHash;
    state.lastCommit = res.data.lastCommit;
    state.local = res.data.local === true;
    document.body.classList.toggle('pro', state.local);
    if (state.local) {
        $('#publish').textContent = 'Save';
        $('#commit-push').style.display = '';
        refreshGitStatus();
    }
    renderLastPublished();
    await harvestAltMap();

    let region;
    try {
        region = model.splitFile(state.fileText).region;
    } catch (e) {
        setStatus(`Cannot edit this page: ${e.message}`, 'error');
        return;
    }

    const parsed = model.parseRegion(region);
    const draft = readDraft();

    overlay.init($('#canvas'), {
        getModel: () => state.model,
        snapshot,
        discardSnapshot,
        onChange: afterMutation,
        onSelect: renderSelectedPanel,
        onKeydown: handleKeydown,
        onStatus: (msg) => setStatus(msg),
        onWheel: (e) => {
            // Pinch/Cmd-scroll inside the canvas: convert iframe coords to
            // parent space (the iframe may be scaled) and zoom there.
            const r = $('#canvas').getBoundingClientRect();
            const z = currentZoom;
            handleWheelZoom(e, r.left + e.clientX * z, r.top + e.clientY * z);
        },
        altForImage: (src) => altForImage(src).alt,
    });

    if (parsed) {
        state.model = draftOrParsed(draft, parsed, region);
    } else {
        // Legacy page: render it as-is AT DESKTOP WIDTH (the mobile breakpoint
        // would corrupt the measurement), measure it, then swap in the
        // freeform canvas at identical geometry.
        setStatus('First open: converting the current layout to freeform…');
        const iframe = $('#canvas');
        iframe.style.width = '1600px';
        bootIframe('\n' + region + '\n', async () => {
            state.model = await overlay.measureLegacy((src) => altForImage(src).alt);
            iframe.style.width = '';
            state.migrated = true;
            state.dirtySinceLoad = true;
            bootIframe(model.serializeRegion(state.model, { withIds: true }), () => {
                finishBoot();
                setStatus('Converted. Everything is now freely movable — publish when happy.');
            });
        });
        loadImages();
        return;
    }
    bootIframe(model.serializeRegion(state.model, { withIds: true }), finishBoot);
    loadImages();
}

function draftOrParsed(draft, parsed, region) {
    if (draft && draft.gallery && draft.gallery !== region) {
        const stale = draft.baseGalleryHash !== state.baseGalleryHash;
        const msg = stale
            ? 'You have a draft based on an OLDER version of the page. Resume it anyway?'
            : `Resume your unpublished draft from ${new Date(draft.savedAt).toLocaleString()}?`;
        if (confirm(msg)) {
            try {
                const m = model.parseRegion(draft.gallery);
                if (m) { state.dirtySinceLoad = true; return m; }
            } catch { /* fall through */ }
        }
        localStorage.removeItem(DRAFT_KEY);
    }
    return parsed;
}

function readDraft() {
    try {
        return JSON.parse(localStorage.getItem(DRAFT_KEY));
    } catch {
        return null;
    }
}

let iframeLoadCb = null;
function bootIframe(regionHtml, onReady) {
    const iframe = $('#canvas');
    iframeLoadCb = onReady || null;
    iframe.srcdoc = overlay.buildSrcdoc(state.fileText, regionHtml);
    iframe.onload = () => {
        overlay.onIframeReady();
        if (iframeLoadCb) iframeLoadCb();
    };
}

function finishBoot() {
    loadImages();
    renderPageMap();
    updatePublishButton();
    renderSelectedPanel([]);
    // Idempotence check: serialize → parse → serialize must be stable.
    try {
        const a = model.serializeRegion(state.model);
        const b = model.serializeRegion(model.parseRegion(a));
        const ok = a === b;
        $('#roundtrip').textContent = ok ? 'fidelity ✓' : 'fidelity ✗';
        $('#roundtrip').className = ok ? 'ok' : 'error';
    } catch (e) {
        $('#roundtrip').textContent = 'fidelity ✗';
        $('#roundtrip').className = 'error';
    }
    if (!state.migrated) setStatus('Ready.');
}

function showLogin() {
    $('#app').style.display = 'none';
    $('#login').style.display = 'flex';
}

$('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#login-pass').value.trim();
    const editor = document.querySelector('input[name="editor"]:checked');
    if (!key || !editor) return;
    $('#login-error').textContent = 'Checking…';
    if (await api.verifyKey(key)) {
        api.setAuth({ key, editor: editor.value });
        $('#login-error').textContent = '';
        boot();
    } else {
        $('#login-error').textContent = 'Wrong passphrase.';
        $('#login-pass').select();
    }
});

// ---------------------------------------------------------------------------
// Alt map
// ---------------------------------------------------------------------------

async function harvestAltMap() {
    const pages = ['/el-monte.html', '/la-marina.html', '/pomar-lane.html', '/index.html'];
    const texts = [state.fileText];
    await Promise.all(pages.map(async (p) => {
        try {
            const r = await fetch(p);
            if (r.ok) texts.push(await r.text());
        } catch { /* skip */ }
    }));
    const re = /src="(images\/[^"]+)"[^>]*\balt="([^"]*)"/g;
    for (const text of texts) {
        for (const m of text.matchAll(re)) {
            if (m[2] && !(m[1] in state.altMap)) state.altMap[m[1]] = m[2];
        }
    }
}

function altForImage(src) {
    if (state.altMap[src]) return { alt: state.altMap[src], known: true };
    const folder = (src.match(/images\/projects\/([^/]+)\//) || [])[1];
    return { alt: `Photograph from ${folder ? folder.replace(/-/g, ' ') : 'the project'}`, known: false };
}

// ---------------------------------------------------------------------------
// Mutations, undo/redo, drafts
// ---------------------------------------------------------------------------

function snapshot() {
    state.history.push(structuredClone(state.model));
    if (state.history.length > 100) state.history.shift();
    state.future = [];
}

function discardSnapshot() {
    state.history.pop();
}

function afterMutation() {
    state.dirtySinceLoad = true;
    renderPageMap();
    saveDraftSoon();
    updatePublishButton();
}

function undo() {
    if (!state.history.length) return;
    state.future.push(structuredClone(state.model));
    state.model = state.history.pop();
    overlay.renderCanvas();
    overlay.select([]);
    afterMutation();
}

function redo() {
    if (!state.future.length) return;
    state.history.push(structuredClone(state.model));
    state.model = state.future.pop();
    overlay.renderCanvas();
    overlay.select([]);
    afterMutation();
}

let draftTimer = null;
function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
        const auth = api.getAuth();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            baseGalleryHash: state.baseGalleryHash,
            gallery: model.serializeRegion(state.model),
            editor: auth && auth.editor,
            savedAt: new Date().toISOString(),
        }));
        setStatus('Draft saved.');
    }, 500);
}

// ---------------------------------------------------------------------------
// Selected panel (alt text, video pick, crop reset)
// ---------------------------------------------------------------------------

function renderSelectedPanel(ids) {
    const host = $('#selected');
    const fs = ids.map((id) => state.model.frames.find((f) => f.id === id)).filter(Boolean);
    if (!fs.length) {
        host.innerHTML = `<p class="hint">Click any image on the page to select it.
            Drag to move · corners to resize · double-click to adjust the crop ·
            drag on empty space to select several at once.</p>
            <p class="hint"><b>Hold ⌥ Option while dragging</b> to slide a selection
            up or down and push everything else out of the way (great for
            reordering whole sections — marquee-select the group first).</p>`;
        return;
    }
    if (fs.length > 1) {
        const proTools = state.local ? `
            <label>Align</label>
            <div class="row">
                <button data-align="left">Lefts</button>
                <button data-align="centerx">Centers</button>
                <button data-align="right">Rights</button>
                <button data-align="top">Tops</button>
            </div>
            <label>Distribute</label>
            <div class="row"><button data-align="vspread">Even vertical spacing</button></div>` : '';
        host.innerHTML = `<div class="chip">${fs.length} selected</div>
            <p class="hint">Drag to move them together.
            <b>Hold ⌥ Option while dragging</b> to slide the group up/down and
            push the rest of the page out of the way.</p>
            <div class="row"><button data-del-sel class="danger">Delete ${fs.length} items</button></div>${proTools}`;
        host.querySelector('[data-del-sel]').addEventListener('click', () => overlay.deleteSelection());
        host.querySelectorAll('[data-align]').forEach((btn) => btn.addEventListener('click', () => {
            snapshot();
            const mode = btn.getAttribute('data-align');
            if (mode === 'left') {
                const min = Math.min(...fs.map((f) => f.x));
                fs.forEach((f) => { f.x = min; });
            } else if (mode === 'right') {
                const max = Math.max(...fs.map((f) => f.x + f.w));
                fs.forEach((f) => { f.x = max - f.w; });
            } else if (mode === 'centerx') {
                const c = fs.reduce((s, f) => s + f.x + f.w / 2, 0) / fs.length;
                fs.forEach((f) => { f.x = c - f.w / 2; });
            } else if (mode === 'top') {
                const min = Math.min(...fs.map((f) => f.y));
                fs.forEach((f) => { f.y = min; });
            } else if (mode === 'vspread') {
                const sorted = [...fs].sort((a, b) => a.y - b.y);
                const top = sorted[0].y;
                const bottom = Math.max(...sorted.map((f) => f.y + f.h));
                const totalH = sorted.reduce((s, f) => s + f.h, 0);
                const gap = sorted.length > 1 ? Math.max(0, (bottom - top - totalH) / (sorted.length - 1)) : 0;
                let y = top;
                for (const f of sorted) { f.y = y; y += f.h + gap; }
            }
            overlay.renderCanvas();
            overlay.select(ids);
            afterMutation();
        }));
        return;
    }
    const f = fs[0];
    const geometryHtml = state.local ? `
        <label>Geometry (% of page width)</label>
        <div class="geo-grid">
            ${['x', 'y', 'w', 'h'].map((k) =>
                `<span>${k}</span><input type="number" step="0.1" data-geo="${k}" value="${Math.round(f[k] * 10) / 10}">`).join('')}
        </div>
        <div class="row" style="margin-top:10px"><button data-duplicate>Duplicate (⌘D)</button></div>` : '';

    if (f.kind === 'video') {
        const opts = allVideos().map((v) =>
            `<option value="${v.url}" ${v.url === f.url ? 'selected' : ''}>${v.ariaLabel}</option>`).join('');
        host.innerHTML = `<div class="chip">Video</div>
            <label>Which video</label><select data-video>${opts}</select>
            ${geometryHtml}`;
        host.querySelector('[data-video]').addEventListener('change', (e) => {
            snapshot();
            const v = allVideos().find((x) => x.url === e.target.value);
            f.url = v.url; f.ariaLabel = v.ariaLabel;
            overlay.renderCanvas();
            afterMutation();
        });
    } else {
        const needsAlt = !state.altMap[f.src] && /Photograph from/.test(f.alt || '');
        host.innerHTML = `<div class="chip">Image</div>
            <p class="hint">${f.src.split('/').pop()}</p>
            <label>Alt text ${needsAlt ? '<span class="warn">check this</span>' : ''}</label>
            <input type="text" data-alt value="${(f.alt || '').replace(/"/g, '&quot;')}" placeholder="Describe the photo">
            ${f.objectPosition ? '<div class="row" style="margin-top:10px"><button data-reset-crop>Reset crop</button></div>' : ''}
            ${geometryHtml}`;
        host.querySelector('[data-alt]').addEventListener('change', (e) => {
            snapshot();
            f.alt = e.target.value;
            afterMutation();
        });
        const rc = host.querySelector('[data-reset-crop]');
        if (rc) rc.addEventListener('click', () => {
            snapshot();
            f.objectPosition = null;
            overlay.renderCanvas();
            overlay.select([f.id]);
            afterMutation();
        });
    }
    host.querySelectorAll('[data-geo]').forEach((input) => input.addEventListener('change', () => {
        snapshot();
        const k = input.getAttribute('data-geo');
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) f[k] = Math.max(k === 'w' || k === 'h' ? 2 : 0, v);
        overlay.renderCanvas();
        overlay.select([f.id]);
        afterMutation();
    }));
    const dup = host.querySelector('[data-duplicate]');
    if (dup) dup.addEventListener('click', () => duplicateFrame(f));
}

function duplicateFrame(f) {
    snapshot();
    const copy = structuredClone(f);
    copy.id = model.nextId();
    copy.x = Math.min(96, f.x + 3);
    copy.y = f.y + 3;
    copy.z = Math.max(...state.model.frames.map((x) => x.z || 0)) + 1;
    state.model.frames.push(copy);
    overlay.renderCanvas();
    overlay.select([copy.id]);
    afterMutation();
}

// ---------------------------------------------------------------------------
// Page map (left rail): mini rendering of the whole canvas
// ---------------------------------------------------------------------------

function renderPageMap() {
    const host = $('#pagemap');
    const frames = state.model.frames;
    if (!frames.length) { host.innerHTML = ''; return; }
    const H = model.canvasHeightWu(frames);
    const cells = [...frames].sort((a, b) => (a.z || 0) - (b.z || 0)).map((f) => {
        if (f.kind === 'video') {
            const cx = f.x + f.w / 2, cy = f.y + f.h / 2, s = Math.min(f.w, f.h) * 0.22;
            return `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" class="pm-video"></rect>
                <polygon points="${cx - s / 2},${cy - s} ${cx + s},${cy} ${cx - s / 2},${cy + s}" fill="#fff" opacity="0.9"></polygon>`;
        }
        return `<image href="${thumbUrl(f.src, 120)}" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}"
            preserveAspectRatio="xMidYMid slice"></image>`;
    }).join('');
    host.innerHTML = `<svg viewBox="0 0 100 ${H}" preserveAspectRatio="xMidYMin meet">${cells}</svg>`;
    host.querySelector('svg').addEventListener('click', (e) => {
        const svg = e.currentTarget;
        const r = svg.getBoundingClientRect();
        const yWu = ((e.clientY - r.top) / r.height) * H;
        const iframe = $('#canvas');
        const c = iframe.contentDocument.querySelector('.ff-canvas');
        const px = (yWu / 100) * c.getBoundingClientRect().width;
        iframe.contentWindow.scrollTo({ top: c.offsetTop + px - iframe.clientHeight / 3, behavior: 'smooth' });
    });
}

// ---------------------------------------------------------------------------
// Tray (images + videos)
// ---------------------------------------------------------------------------

function thumbUrl(src, w = 240) {
    return `/.netlify/images?url=/${encodeURIComponent(src).replace(/%2F/g, '/')}&w=${w}&q=60&fm=webp`;
}

function videoPoster(url) {
    return url.replace(/\/video\/upload\/[^/]+\//, '/video/upload/so_0,w_240,c_limit,f_jpg/').replace(/\.mp4$/, '.jpg');
}

async function loadImages() {
    if ($('#tray').dataset.loaded) return;
    const res = await api.fetchImages();
    if (!res.ok) {
        $('#tray').innerHTML = `<p class="hint">${res.data.message || 'Could not load images.'}</p>`;
        return;
    }
    state.imageFolders = res.data.folders || {};
    $('#tray').dataset.loaded = '1';
    renderTray();
}

function renderTray(filter = '') {
    const host = $('#tray');
    host.innerHTML = '';
    const q = filter.trim().toLowerCase();

    // Videos first: they're few and Kelly should find them instantly.
    const vids = q ? allVideos().filter((v) => v.ariaLabel.toLowerCase().includes(q)) : allVideos();
    if (vids.length) {
        const details = document.createElement('details');
        details.open = Boolean(q);
        details.innerHTML = `<summary>videos <span class="count">${vids.length}</span></summary>`;
        const grid = document.createElement('div');
        grid.className = 'tray-grid';
        for (const v of vids) {
            const cell = document.createElement('div');
            cell.className = 'tray-cell tray-video';
            cell.title = v.ariaLabel;
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.src = videoPoster(v.url);
            img.onerror = () => { img.remove(); cell.textContent = '▶'; };
            cell.appendChild(img);
            const badge = document.createElement('span');
            badge.className = 'tray-badge';
            badge.textContent = '▶';
            cell.appendChild(badge);
            attachTrayDrag(cell, { kind: 'video', url: v.url, ariaLabel: v.ariaLabel }, 16 / 9);
            grid.appendChild(cell);
        }
        details.appendChild(grid);
        host.appendChild(details);
    }

    for (const [folder, paths] of Object.entries(state.imageFolders)) {
        const matches = q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths;
        if (!matches.length) continue;
        const details = document.createElement('details');
        details.open = Boolean(q) || folder === 'selects';
        details.innerHTML = `<summary>${folder} <span class="count">${matches.length}</span></summary>`;
        const grid = document.createElement('div');
        grid.className = 'tray-grid';
        for (const path of matches) {
            const cell = document.createElement('div');
            cell.className = 'tray-cell';
            cell.title = path.split('/').pop();
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = thumbUrl(path);
            img.onerror = () => { img.onerror = null; img.src = '/' + path; };
            cell.appendChild(img);
            attachTrayDrag(cell, { kind: 'image', src: path }, null);
            grid.appendChild(cell);
        }
        details.appendChild(grid);
        host.appendChild(details);
    }
    if (!host.children.length) host.innerHTML = '<p class="hint">No images match.</p>';
}

$('#tray-search').addEventListener('input', (e) => renderTray(e.target.value));

function attachTrayDrag(cell, media, fixedAspect) {
    cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { cell.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        let ghost = null;
        let started = false;
        const startX = e.clientX, startY = e.clientY;

        const onMove = (ev) => {
            if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
            if (!started) {
                started = true;
                ghost = document.createElement('img');
                ghost.className = 'drag-ghost';
                const thumb = cell.querySelector('img');
                if (thumb) ghost.src = thumb.src;
                document.body.appendChild(ghost);
            }
            ghost.style.left = `${ev.clientX + 12}px`;
            ghost.style.top = `${ev.clientY + 12}px`;
            overlay.setDropPreview(Boolean(overlay.canvasPointFromParent(ev.clientX, ev.clientY)));
        };
        const onUp = (ev) => {
            cell.removeEventListener('pointermove', onMove);
            cell.removeEventListener('pointerup', onUp);
            overlay.setDropPreview(false);
            if (ghost) ghost.remove();
            if (!started) return;
            const pt = overlay.canvasPointFromParent(ev.clientX, ev.clientY);
            if (!pt) return;
            let aspect = fixedAspect;
            const thumb = cell.querySelector('img');
            if (!aspect && thumb && thumb.naturalWidth) aspect = thumb.naturalWidth / thumb.naturalHeight;
            const payload = media.kind === 'image'
                ? { ...media, alt: altForImage(media.src).alt }
                : media;
            overlay.addFrameAt(pt, payload, aspect || 1.5);
        };
        cell.addEventListener('pointermove', onMove);
        cell.addEventListener('pointerup', onUp);
    });
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

function updatePublishButton() {
    $('#publish').disabled = !state.dirtySinceLoad;
    $('#summary').textContent = state.dirtySinceLoad
        ? `${state.model.frames.length} items on the page` : '';
}

$('#publish').addEventListener('click', () => openPublishModal());

// ---------------------------------------------------------------------------
// Preview: open the current draft as the real page (scripts intact) — no publish
// ---------------------------------------------------------------------------

$('#preview').addEventListener('click', () => {
    const { prefix, suffix } = model.splitFile(state.fileText);
    let html = prefix + '\n' + model.serializeRegion(state.model) + '\n' + suffix;
    html = html.replace(/<head>/i, `<head><base href="${location.origin}/">`);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
    setStatus('Preview opened in a new tab — nothing published.');
});

// ---------------------------------------------------------------------------
// Pro: git status + commit & push (local only)
// ---------------------------------------------------------------------------

async function gitCall(method, body) {
    const auth = api.getAuth();
    const res = await fetch('/.netlify/functions/studio-git', {
        method,
        headers: { 'X-Studio-Key': (auth && auth.key) || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function refreshGitStatus() {
    const res = await gitCall('GET');
    if (!res.ok) return;
    const el = $('#git-status');
    el.textContent = res.data.dirty
        ? `${res.data.branch}: unsaved-to-git changes`
        : `${res.data.branch}: clean`;
    $('#commit-push').disabled = !res.data.dirty;
}

$('#commit-push').addEventListener('click', async () => {
    const auth = api.getAuth();
    const message = prompt('Commit message (optional note):') ?? '';
    setStatus('Committing…');
    const res = await gitCall('POST', { message, push: true, editor: auth.editor });
    if (!res.ok) {
        setStatus(res.data.message || 'Commit failed.', 'error');
        return;
    }
    setStatus(`Committed ${res.data.commit} and pushed to ${res.data.branch}.`);
    refreshGitStatus();
});

// ---------------------------------------------------------------------------
// Pro: upload images (drag files from Finder onto the tray) + video by URL
// ---------------------------------------------------------------------------

const tray = $('#tray');
['dragover', 'dragenter'].forEach((t) => tray.addEventListener(t, (e) => {
    if (!state.local) return;
    e.preventDefault();
    tray.classList.add('drop-ready');
}));
['dragleave', 'drop'].forEach((t) => tray.addEventListener(t, () => tray.classList.remove('drop-ready')));
tray.addEventListener('drop', async (e) => {
    if (!state.local) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []).filter((f) => /image\/(jpeg|png|webp)/.test(f.type));
    if (!files.length) return;
    const auth = api.getAuth();
    for (const file of files) {
        setStatus(`Uploading ${file.name}…`);
        const dataBase64 = await new Promise((res) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result).split(',')[1]);
            r.readAsDataURL(file);
        });
        const res = await fetch('/.netlify/functions/studio-upload', {
            method: 'POST',
            headers: { 'X-Studio-Key': auth.key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, folder: 'uploads', dataBase64 }),
        });
        const j = await res.json();
        if (!res.ok) {
            setStatus(j.message || 'Upload failed.', 'error');
            return;
        }
        (state.imageFolders.uploads ||= []).unshift(j.path);
    }
    renderTray($('#tray-search').value);
    setStatus(`Added ${files.length} image${files.length > 1 ? 's' : ''} — drag from the "uploads" folder onto the page. Commit & push includes them.`);
});

$('#add-video').addEventListener('click', () => {
    const url = prompt('Cloudinary video URL (.mp4):');
    if (!url || !/^https:\/\/res\.cloudinary\.com\/.+\.mp4$/.test(url.trim())) {
        if (url) setStatus('That does not look like a Cloudinary .mp4 URL.', 'error');
        return;
    }
    const label = prompt('Short label for it (e.g. "Patio dusk video"):') || 'New video';
    const vids = customVideos();
    vids.push({ url: url.trim(), ariaLabel: label });
    localStorage.setItem('nickMason.studio.customVideos', JSON.stringify(vids));
    renderTray($('#tray-search').value);
    setStatus('Video added to the tray.');
});

function openPublishModal() {
    $('#publish-modal').style.display = 'flex';
    $('#publish-note').value = '';
    $('#publish-title').textContent = state.local ? 'Save to your working tree' : 'Publish to the site';
    $('#publish-go').textContent = state.local ? 'Save' : 'Publish';
    $('#publish-msg').textContent = [
        state.migrated ? 'First save converts the page to the freeform format (looks identical, becomes fully editable).' : '',
        state.local ? 'Writes portfolio.html on disk only — use Commit & push when you want it live.' : '',
    ].filter(Boolean).join(' ');
}

$('#publish-cancel').addEventListener('click', () => {
    $('#publish-modal').style.display = 'none';
});

$('#publish-go').addEventListener('click', () => doPublish(false));

async function doPublish(force) {
    const auth = api.getAuth();
    $('#publish-modal').style.display = 'none';
    setStatus('Publishing…');
    $('#publish').disabled = true;
    const note = $('#publish-note').value.trim();
    const res = await api.publish({
        editor: auth.editor,
        gallery: model.serializeRegion(state.model),
        baseGalleryHash: state.baseGalleryHash,
        force,
        note,
    });

    if (res.status === 409) {
        const last = res.data.lastCommit;
        const who = last ? `\nLast change: "${last.message}" (${new Date(last.date).toLocaleString()})` : '';
        const overwrite = confirm(
            `The page changed since you loaded it.${who}\n\n` +
            'OK = overwrite their version with yours.\nCancel = keep theirs (reload to see it).'
        );
        if (overwrite) return doPublish(true);
        setStatus('Publish cancelled — reload to pick up the newer version.', 'error');
        updatePublishButton();
        return;
    }
    if (!res.ok) {
        setStatus(res.data.message || 'Publish failed.', 'error');
        updatePublishButton();
        return;
    }
    state.baseGalleryHash = res.data.newGalleryHash;
    state.dirtySinceLoad = false;
    state.migrated = false;
    localStorage.removeItem(DRAFT_KEY);
    updatePublishButton();
    if (res.data.savedToDisk) {
        setStatus('Saved to portfolio.html (working tree). Preview it, then Commit & push when ready.');
        refreshGitStatus();
    } else {
        startDeployCountdown(res.data.commitSha);
    }
}

function startDeployCountdown(sha) {
    let s = 75;
    const tickMsg = () => `Published (${(sha || '').slice(0, 7)}). Site rebuilding — live in ~${s}s.`;
    setStatus(tickMsg());
    const t = setInterval(() => {
        s -= 5;
        if (s <= 0) {
            clearInterval(t);
            setStatus('Published — the live page should be updated. ');
            const a = document.createElement('a');
            a.href = '/portfolio.html';
            a.target = '_blank';
            a.textContent = 'Open it ↗';
            $('#status').appendChild(a);
        } else {
            setStatus(tickMsg());
        }
    }, 5000);
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function setTab(name) {
    document.querySelectorAll('.tab').forEach((t) =>
        t.classList.toggle('active', t.getAttribute('data-tab') === name));
    document.querySelectorAll('.tab-panel').forEach((p) =>
        p.style.display = p.id === name ? 'block' : 'none');
}
document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => setTab(t.getAttribute('data-tab'))));

$('#viewport-toggle').addEventListener('click', () => {
    const holder = $('#canvas-holder');
    const mobile = holder.classList.toggle('mobile');
    $('#viewport-toggle').textContent = mobile ? 'Desktop view' : 'Mobile view';
    if (mobile) setZoom(1, { skipMobileCheck: true });
    else setZoom(currentZoom);
});

// ---------------------------------------------------------------------------
// Zoom (Miro-style: presets, plus pinch / Cmd+scroll for continuous zoom
// down to 5%; all gestures keep working at any level)
// ---------------------------------------------------------------------------

let currentZoom = 1;
const Z_MIN = 0.05, Z_MAX = 1.5;

function setZoom(z, { skipMobileCheck = false } = {}) {
    z = Math.min(Z_MAX, Math.max(Z_MIN, z));
    const holder = $('#canvas-holder');
    const box = $('#zoom-box');
    const iframe = $('#canvas');
    if (!skipMobileCheck && holder.classList.contains('mobile')) {
        holder.classList.remove('mobile');
        $('#viewport-toggle').textContent = 'Mobile view';
    }
    currentZoom = z;
    document.querySelectorAll('[data-zoom]').forEach((b) =>
        b.classList.toggle('active', Math.abs(parseFloat(b.getAttribute('data-zoom')) - z) < 0.01));
    $('#zoom-label').textContent = `${Math.round(z * 100)}%`;
    if (Math.abs(z - 1) < 0.005) {
        currentZoom = 1;
        iframe.style.width = '';
        iframe.style.height = '';
        iframe.style.transform = '';
        box.style.width = '';
        box.style.height = '';
        return;
    }
    const hw = holder.clientWidth, hh = holder.clientHeight;
    // Cap the layout width: deep zoom shows the page as a centered column
    // (like Miro on a tall board) instead of laying out a mile-wide page.
    const w = Math.round(Math.min(1800, Math.max(1000, hw / z)));
    const h = Math.round(hh / z);
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
    iframe.style.transform = `scale(${z})`;
    box.style.width = `${Math.round(w * z)}px`;
    box.style.height = `${hh}px`;
}

// Zoom around a parent-space point: the spot under the cursor stays put.
function zoomAtPoint(z, px, py) {
    const iframe = $('#canvas');
    const before = overlay.canvasPointFromParent(px, py);
    const scrollBefore = iframe.contentWindow ? iframe.contentWindow.scrollY : 0;
    setZoom(z);
    if (!before || !iframe.contentWindow) return;
    requestAnimationFrame(() => {
        const after = overlay.canvasPointFromParent(px, py);
        if (!after) return;
        const ppw = overlay.canvasPxPerWu();
        iframe.contentWindow.scrollBy(0, (before.y - after.y) * ppw);
        void scrollBefore;
    });
}

function handleWheelZoom(e, px, py) {
    if (!e.ctrlKey && !e.metaKey) return false; // trackpad pinch arrives as ctrl+wheel
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.012);
    zoomAtPoint(currentZoom * factor, px, py);
    return true;
}

$('#canvas-holder').addEventListener('wheel', (e) => handleWheelZoom(e, e.clientX, e.clientY), { passive: false });

document.querySelectorAll('[data-zoom]').forEach((btn) =>
    btn.addEventListener('click', () => {
        const holder = $('#canvas-holder').getBoundingClientRect();
        zoomAtPoint(parseFloat(btn.getAttribute('data-zoom')), holder.left + holder.width / 2, holder.top + holder.height / 3);
    }));
window.addEventListener('resize', () => { if (currentZoom !== 1) setZoom(currentZoom); });

$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#logout').addEventListener('click', () => { api.clearAuth(); location.reload(); });

function handleKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
    }
    if (mod && e.key.toLowerCase() === 'd' && state.local) {
        const ids = overlay.getSelection();
        if (ids.length === 1) {
            e.preventDefault();
            const f = state.model.frames.find((x) => x.id === ids[0]);
            if (f) duplicateFrame(f);
        }
    }
}
document.addEventListener('keydown', handleKeydown);

function setStatus(msg, kind = '') {
    const el = $('#status');
    el.textContent = msg;
    el.className = kind;
}

function renderLastPublished() {
    const el = $('#last-published');
    if (state.lastCommit) {
        const d = new Date(state.lastCommit.date);
        el.textContent = `Last published: ${state.lastCommit.message.replace('Studio: layout update by ', '').split('\n')[0]} · ${d.toLocaleString()}`;
    } else {
        el.textContent = '';
    }
}

// ---------------------------------------------------------------------------
// Debug hooks
// ---------------------------------------------------------------------------

window.studioDebug = {
    state,
    model,
    overlay,
    serialize: () => model.serializeRegion(state.model),
    roundTrip() {
        const a = model.serializeRegion(state.model);
        const b = model.serializeRegion(model.parseRegion(a));
        let diffIndex = -1;
        if (a !== b) {
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
                if (a[i] !== b[i]) { diffIndex = i; break; }
            }
        }
        return { ok: a === b, diffIndex, frames: state.model.frames.length };
    },
};

boot();
