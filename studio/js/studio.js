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
};

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
            drag on empty space to select several at once.</p>`;
        return;
    }
    if (fs.length > 1) {
        host.innerHTML = `<div class="chip">${fs.length} selected</div>
            <p class="hint">Drag to move them together, or press ⌫ to delete.</p>`;
        return;
    }
    const f = fs[0];
    if (f.kind === 'video') {
        const opts = VIDEO_LIBRARY.map((v) =>
            `<option value="${v.url}" ${v.url === f.url ? 'selected' : ''}>${v.ariaLabel}</option>`).join('');
        host.innerHTML = `<div class="chip">Video</div>
            <label>Which video</label><select data-video>${opts}</select>`;
        host.querySelector('[data-video]').addEventListener('change', (e) => {
            snapshot();
            const v = VIDEO_LIBRARY.find((x) => x.url === e.target.value);
            f.url = v.url; f.ariaLabel = v.ariaLabel;
            overlay.renderCanvas();
            afterMutation();
        });
        return;
    }
    const needsAlt = !state.altMap[f.src] && /Photograph from/.test(f.alt || '');
    host.innerHTML = `<div class="chip">Image</div>
        <p class="hint">${f.src.split('/').pop()}</p>
        <label>Alt text ${needsAlt ? '<span class="warn">check this</span>' : ''}</label>
        <input type="text" data-alt value="${(f.alt || '').replace(/"/g, '&quot;')}" placeholder="Describe the photo">
        ${f.objectPosition ? '<div class="row" style="margin-top:10px"><button data-reset-crop>Reset crop</button></div>' : ''}`;
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

// ---------------------------------------------------------------------------
// Page map (left rail): mini rendering of the whole canvas
// ---------------------------------------------------------------------------

function renderPageMap() {
    const host = $('#pagemap');
    const frames = state.model.frames;
    if (!frames.length) { host.innerHTML = ''; return; }
    const H = model.canvasHeightWu(frames);
    const rects = [...frames].sort((a, b) => (a.z || 0) - (b.z || 0)).map((f) =>
        `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="1"
            class="${f.kind === 'video' ? 'pm-video' : 'pm-img'}"></rect>`).join('');
    host.innerHTML = `<svg viewBox="0 0 100 ${H}" preserveAspectRatio="xMidYMin meet">${rects}</svg>`;
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
    const vids = q ? VIDEO_LIBRARY.filter((v) => v.ariaLabel.toLowerCase().includes(q)) : VIDEO_LIBRARY;
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

function openPublishModal() {
    $('#publish-modal').style.display = 'flex';
    $('#publish-note').value = '';
    $('#publish-msg').textContent = state.migrated
        ? 'First publish converts the page to the freeform format (looks identical, becomes fully editable).'
        : '';
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
    startDeployCountdown(res.data.commitSha);
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
});

$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#logout').addEventListener('click', () => { api.clearAuth(); location.reload(); });

function handleKeydown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
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
