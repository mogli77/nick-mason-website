// Studio app: state, panels, drag interactions, drafts, publish.

import * as model from './model.js';
import * as api from './api.js';
import * as overlay from './overlay.js';

const DRAFT_KEY = 'nickMason.studio.draft.v1';
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
    fileText: null,       // full portfolio.html as loaded
    baseGalleryHash: null, // hash of the region this session is based on
    blocks: [],
    selectedId: null,
    history: [],
    future: [],
    altMap: {},           // src → alt harvested from all pages
    imageFolders: {},
    dirtySinceLoad: false,
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

    let region;
    try {
        region = model.splitFile(state.fileText).region;
        state.blocks = model.parseRegion(region);
    } catch (e) {
        setStatus(`Cannot edit this page version: ${e.message}`, 'error');
        return;
    }

    // Round-trip invariant, visible in the UI.
    const rt = model.serializeRegion(state.blocks) === region;
    $('#roundtrip').textContent = rt ? 'fidelity ✓' : 'fidelity ✗';
    $('#roundtrip').className = rt ? 'ok' : 'error';

    await harvestAltMap();
    maybeOfferDraft(region);
    renderIframe();
    renderMinimap();
    loadImages();
    renderPalette();
    setStatus('Ready.');
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
// Iframe rendering
// ---------------------------------------------------------------------------

function renderIframe() {
    const iframe = $('#canvas');
    overlay.init(iframe, {
        onSelect: selectBlock,
        onKeydown: handleKeydown,
    });
    iframe.srcdoc = overlay.buildSrcdoc(state.fileText, state.blocks);
    iframe.addEventListener('load', () => {
        overlay.onIframeReady();
        overlay.setSelected(state.selectedId);
        overlay.attachCropPan(state.blocks, {
            getBlock: (id) => state.blocks.find((b) => b.id === id),
            onCommit: (id, slotIndex, objectPosition) => {
                snapshot();
                const b = state.blocks.find((x) => x.id === id);
                if (!b) return;
                b.slots[slotIndex].objectPosition = objectPosition === '50% 50%' ? null : objectPosition;
                b.dirty = true;
                afterMutation({ patch: b });
            },
        });
    }, { once: true });
}

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
        } catch { /* offline page — skip */ }
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
    const label = folder ? folder.replace(/-/g, ' ') : 'project';
    return { alt: `Photograph from ${label}`, known: false };
}

// ---------------------------------------------------------------------------
// Mutations, undo/redo, drafts
// ---------------------------------------------------------------------------

function snapshot() {
    state.history.push(structuredClone(state.blocks));
    if (state.history.length > 100) state.history.shift();
    state.future = [];
}

function afterMutation({ patch = null, reorder = false, structural = false } = {}) {
    state.dirtySinceLoad = true;
    if (patch) overlay.patchBlock(patch);
    if (reorder) overlay.reorderDom(state.blocks);
    if (structural) { /* insert/remove handled at call site */ }
    renderMinimap();
    renderInspector();
    saveDraftSoon();
    updatePublishButton();
}

function undo() {
    if (!state.history.length) return;
    state.future.push(structuredClone(state.blocks));
    state.blocks = state.history.pop();
    rerenderAllBlocks();
}

function redo() {
    if (!state.future.length) return;
    state.history.push(structuredClone(state.blocks));
    state.blocks = state.future.pop();
    rerenderAllBlocks();
}

function rerenderAllBlocks() {
    // Blunt but correct: rebuild the gallery region DOM from the model.
    const gallery = overlay.galleryEl();
    if (!gallery) return;
    gallery.querySelectorAll('[data-studio-id]').forEach((el) => el.remove());
    let index = 0;
    for (const b of state.blocks) {
        overlay.insertBlockAt(b, index - 1 >= 0 ? index - 1 : -1, state.blocks);
        index++;
    }
    // Simpler + reliable ordering pass:
    overlay.reorderDom(state.blocks);
    if (state.selectedId && !state.blocks.find((b) => b.id === state.selectedId)) {
        state.selectedId = null;
    }
    overlay.setSelected(state.selectedId);
    renderMinimap();
    renderInspector();
    saveDraftSoon();
    updatePublishButton();
}

let draftTimer = null;
function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
        const auth = api.getAuth();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            baseGalleryHash: state.baseGalleryHash,
            gallery: model.serializeRegion(state.blocks),
            editor: auth && auth.editor,
            savedAt: new Date().toISOString(),
        }));
        setStatus('Draft saved.');
    }, 500);
}

function maybeOfferDraft(currentRegion) {
    let draft = null;
    try {
        draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
    } catch { /* corrupt draft — ignore */ }
    if (!draft || !draft.gallery || draft.gallery === currentRegion) return;
    const stale = draft.baseGalleryHash !== state.baseGalleryHash;
    const msg = stale
        ? 'You have a draft based on an OLDER version of the page. Resume it anyway? (Publishing it will overwrite the newer changes.)'
        : `Resume your unpublished draft from ${new Date(draft.savedAt).toLocaleString()}?`;
    if (confirm(msg)) {
        try {
            state.blocks = model.parseRegion(draft.gallery);
            state.dirtySinceLoad = true;
        } catch (e) {
            alert(`Draft could not be restored: ${e.message}`);
            localStorage.removeItem(DRAFT_KEY);
        }
    } else {
        localStorage.removeItem(DRAFT_KEY);
    }
}

// ---------------------------------------------------------------------------
// Selection + inspector
// ---------------------------------------------------------------------------

function selectBlock(id) {
    state.selectedId = id;
    overlay.setSelected(id);
    renderMinimap();
    renderInspector();
    if (id) setTab('inspector');
}

function renderInspector() {
    const host = $('#inspector');
    const block = state.blocks.find((b) => b.id === state.selectedId);
    if (!block) {
        host.innerHTML = '<p class="hint">Click a section in the page (or the minimap) to inspect it.</p>';
        return;
    }
    if (block.kind === 'collage') {
        host.innerHTML = `
            <div class="chip">collage — fixed composition</div>
            <p class="hint">This hand-built collage keeps its exact design. You can move it up or down or delete it.</p>
            <div class="row">
                <button data-act="up">Move up</button>
                <button data-act="down">Move down</button>
                <button data-act="delete" class="danger">Delete</button>
            </div>`;
    } else {
        const def = model.PATTERNS[block.pattern];
        const variants = ['', ...def.variants];
        const variantHtml = def.variants.length ? `
            <label>Layout variant</label>
            <div class="row">${variants.map((v) => `
                <button data-variant="${v}" class="${(block.variant || '') === v ? 'active' : ''}">${v || 'base'}</button>`).join('')}
            </div>` : '';
        const slotsHtml = block.slots.map((s, i) => {
            if (s.kind === 'video') {
                const opts = VIDEO_LIBRARY.map((v) =>
                    `<option value="${v.url}" ${v.url === s.url ? 'selected' : ''}>${v.ariaLabel}</option>`).join('');
                return `<label>${def.slots[i].label} (video)</label>
                    <select data-video-slot="${i}">${opts}</select>`;
            }
            const flag = s.placeholder ? ' <span class="warn">empty</span>'
                : (!s.alt ? ' <span class="warn">needs alt</span>' : '');
            return `<label>${def.slots[i].label} — alt text${flag}</label>
                <input type="text" data-alt-slot="${i}" value="${s.alt.replace(/"/g, '&quot;')}" placeholder="Describe the photo">`;
        }).join('');
        // Swap buttons between adjacent image slots (and reset-crop when panned)
        const imageIdx = block.slots.map((s, i) => (s.kind === 'image' ? i : -1)).filter((i) => i !== -1);
        const swapsHtml = imageIdx.length > 1 ? `
            <label>Rearrange within this section</label>
            <div class="row">${imageIdx.slice(0, -1).map((idx, k) => {
                const next = imageIdx[k + 1];
                return `<button data-swap="${idx}:${next}">${def.slots[idx].label} ⇄ ${def.slots[next].label}</button>`;
            }).join('')}</div>` : '';
        const cropIdx = block.slots.map((s, i) => (s.kind === 'image' && s.objectPosition ? i : -1)).filter((i) => i !== -1);
        const cropResetHtml = cropIdx.length ? `
            <div class="row">${cropIdx.map((i) =>
                `<button data-crop-reset="${i}">Reset crop: ${def.slots[i].label}</button>`).join('')}</div>` : '';
        host.innerHTML = `
            <div class="chip">${def.label}</div>
            ${variantHtml}
            ${slotsHtml}
            ${swapsHtml}
            ${cropResetHtml}
            <div class="row">
                <button data-act="up">Move up</button>
                <button data-act="down">Move down</button>
                <button data-act="delete" class="danger">Delete</button>
            </div>`;
    }

    host.querySelectorAll('[data-variant]').forEach((btn) => btn.addEventListener('click', () => {
        snapshot();
        block.variant = btn.getAttribute('data-variant');
        block.dirty = true;
        afterMutation({ patch: block });
    }));
    host.querySelectorAll('[data-alt-slot]').forEach((input) => input.addEventListener('change', () => {
        snapshot();
        const i = Number(input.getAttribute('data-alt-slot'));
        block.slots[i].alt = input.value;
        block.dirty = true;
        afterMutation({ patch: block });
    }));
    host.querySelectorAll('[data-swap]').forEach((btn) => btn.addEventListener('click', () => {
        snapshot();
        const [a, b] = btn.getAttribute('data-swap').split(':').map(Number);
        [block.slots[a], block.slots[b]] = [block.slots[b], block.slots[a]];
        block.dirty = true;
        afterMutation({ patch: block });
    }));
    host.querySelectorAll('[data-crop-reset]').forEach((btn) => btn.addEventListener('click', () => {
        snapshot();
        const i = Number(btn.getAttribute('data-crop-reset'));
        block.slots[i].objectPosition = null;
        block.dirty = true;
        afterMutation({ patch: block });
    }));
    host.querySelectorAll('[data-video-slot]').forEach((sel) => sel.addEventListener('change', () => {
        snapshot();
        const i = Number(sel.getAttribute('data-video-slot'));
        const v = VIDEO_LIBRARY.find((x) => x.url === sel.value);
        block.slots[i] = { kind: 'video', url: v.url, ariaLabel: v.ariaLabel };
        block.dirty = true;
        afterMutation({ patch: block });
    }));
    const act = (name, fn) => {
        const btn = host.querySelector(`[data-act="${name}"]`);
        if (btn) btn.addEventListener('click', fn);
    };
    act('up', () => moveBlock(block.id, -1));
    act('down', () => moveBlock(block.id, +1));
    act('delete', () => deleteBlock(block.id));
}

function moveBlock(id, delta) {
    const i = state.blocks.findIndex((b) => b.id === id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= state.blocks.length) return;
    snapshot();
    const [b] = state.blocks.splice(i, 1);
    state.blocks.splice(j, 0, b);
    afterMutation({ reorder: true });
    overlay.scrollToBlock(id);
}

function deleteBlock(id) {
    const i = state.blocks.findIndex((b) => b.id === id);
    if (i === -1) return;
    snapshot();
    overlay.removeBlock(id);
    state.blocks.splice(i, 1);
    if (state.selectedId === id) state.selectedId = null;
    overlay.setSelected(null);
    afterMutation({});
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------

function blockThumb(block) {
    const first = block.kind === 'pattern'
        ? block.slots.find((s) => s.kind === 'image' && !s.placeholder)
        : null;
    if (first) return thumbUrl(first.src, 96);
    const m = block.sourceHtml.match(/src="(images\/[^"]+)"/);
    return m ? thumbUrl(m[1], 96) : null;
}

function blockTitle(block) {
    if (block.comment) return block.comment.trim();
    if (block.kind === 'pattern') return model.PATTERNS[block.pattern].label;
    return 'Collage';
}

function renderMinimap() {
    const host = $('#minimap');
    host.innerHTML = '';
    state.blocks.forEach((b, i) => {
        const row = document.createElement('div');
        row.className = 'mini-row' + (b.id === state.selectedId ? ' selected' : '') + (b.kind === 'collage' ? ' collage' : '');
        row.setAttribute('data-id', b.id);
        const thumb = blockThumb(b);
        const needsAlt = b.kind === 'pattern' && b.slots.some((s) => s.kind === 'image' && (!s.alt || s.placeholder));
        row.innerHTML = `
            <span class="mini-grip" title="Drag to reorder">⋮⋮</span>
            ${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : '<span class="mini-video">▶</span>'}
            <span class="mini-title">${blockTitle(b)}${b.kind === 'collage' ? ' <em>(collage)</em>' : ''}${needsAlt ? ' <b class="warn">!</b>' : ''}</span>`;
        row.addEventListener('click', (e) => {
            if (e.target.closest('.mini-grip')) return;
            selectBlock(b.id);
            overlay.scrollToBlock(b.id);
        });
        attachMinimapDrag(row, b, i);
        host.appendChild(row);
    });
}

function attachMinimapDrag(row, block) {
    const grip = row.querySelector('.mini-grip');
    grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        const host = $('#minimap');
        const rows = () => Array.from(host.children);
        let targetIndex = null;
        const indicator = document.createElement('div');
        indicator.className = 'mini-indicator';
        row.classList.add('dragging');

        const onMove = (ev) => {
            const y = ev.clientY;
            let idx = rows().filter((r) => r !== indicator).length;
            const rs = rows().filter((r) => r !== indicator);
            for (let k = 0; k < rs.length; k++) {
                const r = rs[k].getBoundingClientRect();
                if (y < r.top + r.height / 2) { idx = k; break; }
            }
            targetIndex = idx;
            const ref = rs[idx] || null;
            host.insertBefore(indicator, ref);
        };
        const onUp = () => {
            grip.removeEventListener('pointermove', onMove);
            grip.removeEventListener('pointerup', onUp);
            row.classList.remove('dragging');
            indicator.remove();
            if (targetIndex === null) return;
            const from = state.blocks.findIndex((b) => b.id === block.id);
            let to = targetIndex;
            if (to > from) to--;
            if (to === from) { renderMinimap(); return; }
            snapshot();
            const [moved] = state.blocks.splice(from, 1);
            state.blocks.splice(to, 0, moved);
            afterMutation({ reorder: true });
            overlay.scrollToBlock(block.id);
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
    });
}

// ---------------------------------------------------------------------------
// Image tray
// ---------------------------------------------------------------------------

function thumbUrl(src, w = 240) {
    return `/.netlify/images?url=/${encodeURIComponent(src).replace(/%2F/g, '/')}&w=${w}&q=60&fm=webp`;
}

async function loadImages() {
    const res = await api.fetchImages();
    if (!res.ok) {
        $('#tray').innerHTML = `<p class="hint">${res.data.message || 'Could not load images.'}</p>`;
        return;
    }
    state.imageFolders = res.data.folders || {};
    renderTray();
}

function renderTray(filter = '') {
    const host = $('#tray');
    host.innerHTML = '';
    const q = filter.trim().toLowerCase();
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
            cell.setAttribute('data-src', path);
            cell.title = path.split('/').pop();
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.src = thumbUrl(path);
            img.onerror = () => { img.onerror = null; img.src = '/' + path; };
            cell.appendChild(img);
            attachTrayDrag(cell, path);
            grid.appendChild(cell);
        }
        details.appendChild(grid);
        host.appendChild(details);
    }
    if (!host.children.length) host.innerHTML = '<p class="hint">No images match.</p>';
}

$('#tray-search').addEventListener('input', (e) => renderTray(e.target.value));

function attachTrayDrag(cell, src) {
    cell.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { cell.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        let ghost = null;
        let target = null;
        let started = false;
        const startX = e.clientX, startY = e.clientY;

        const onMove = (ev) => {
            if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
            if (!started) {
                started = true;
                ghost = document.createElement('img');
                ghost.className = 'drag-ghost';
                ghost.src = cell.querySelector('img').src;
                document.body.appendChild(ghost);
            }
            ghost.style.left = `${ev.clientX + 12}px`;
            ghost.style.top = `${ev.clientY + 12}px`;
            target = overlay.slotAtPoint(ev.clientX, ev.clientY, state.blocks);
            const ok = Boolean(target && target.el && target.el.tagName === 'IMG');
            overlay.highlightSlot(target, ok);
            if (!ok) target = null;
        };
        const onUp = () => {
            cell.removeEventListener('pointermove', onMove);
            cell.removeEventListener('pointerup', onUp);
            if (ghost) ghost.remove();
            overlay.clearHighlights();
            if (!target) return;
            const block = state.blocks.find((b) => b.id === target.blockId);
            if (!block || block.kind !== 'pattern') return;
            const slot = block.slots[target.slotIndex];
            if (!slot || slot.kind !== 'image') return;
            snapshot();
            const { alt, known } = altForImage(src);
            block.slots[target.slotIndex] = { kind: 'image', src, alt, objectPosition: null, needsAlt: !known };
            block.dirty = true;
            afterMutation({ patch: block });
            selectBlock(block.id);
        };
        cell.addEventListener('pointermove', onMove);
        cell.addEventListener('pointerup', onUp);
    });
}

// ---------------------------------------------------------------------------
// Pattern palette
// ---------------------------------------------------------------------------

const SCHEMATICS = {
    'full': '<rect x="2" y="6" width="60" height="28" />',
    'full-video': '<rect x="2" y="6" width="60" height="28"/><polygon points="28,14 38,20 28,26" fill="#fff"/>',
    'live-inset': '<rect x="2" y="6" width="60" height="28"/><rect x="40" y="22" width="18" height="10" fill="#fff" stroke="#999"/>',
    'overlap': '<rect x="2" y="4" width="34" height="26"/><rect x="26" y="12" width="34" height="26" fill="#ccc"/>',
    'feature-wide': '<rect x="2" y="4" width="16" height="16"/><rect x="14" y="10" width="46" height="28" fill="#ccc"/>',
    'trio': '<rect x="2" y="8" width="18" height="24"/><rect x="23" y="8" width="18" height="24"/><rect x="44" y="8" width="18" height="24"/>',
    'pair': '<rect x="2" y="8" width="28" height="24"/><rect x="34" y="8" width="28" height="24"/>',
};

function renderPalette() {
    const host = $('#palette');
    host.innerHTML = '<p class="hint">Click a layout to add it at the end, then drop images into it.</p>';
    for (const [key, def] of Object.entries(model.PATTERNS)) {
        const item = document.createElement('button');
        item.className = 'palette-item';
        item.innerHTML = `<svg viewBox="0 0 64 40" fill="#aaa" stroke="#888">${SCHEMATICS[def.schematic] || SCHEMATICS.full}</svg>
            <span>${def.label}</span>`;
        item.addEventListener('click', () => {
            snapshot();
            const block = model.createBlock(key, VIDEO_LIBRARY);
            state.blocks.push(block);
            overlay.insertBlockAt(block, state.blocks.length - 1, state.blocks);
            afterMutation({});
            selectBlock(block.id);
            overlay.scrollToBlock(block.id);
        });
        host.appendChild(item);
    }
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

function changeSummary() {
    const dirty = state.blocks.filter((b) => b.dirty).length;
    return `${dirty} section${dirty === 1 ? '' : 's'} changed · ${state.blocks.length} total`;
}

function updatePublishButton() {
    $('#publish').disabled = !state.dirtySinceLoad;
    $('#summary').textContent = state.dirtySinceLoad ? changeSummary() : '';
}

$('#publish').addEventListener('click', () => publishFlow(false));

async function publishFlow(force) {
    const placeholderBlocks = state.blocks.filter((b) =>
        b.kind === 'pattern' && b.slots.some((s) => s.placeholder));
    if (placeholderBlocks.length) {
        alert('Some new sections still have empty image slots. Fill or delete them before publishing.');
        selectBlock(placeholderBlocks[0].id);
        overlay.scrollToBlock(placeholderBlocks[0].id);
        return;
    }
    const auth = api.getAuth();
    if (!confirm(`Publish to the live site as ${auth.editor}?\n\n${changeSummary()}`)) return;

    setStatus('Publishing…');
    $('#publish').disabled = true;
    const res = await api.publish({
        editor: auth.editor,
        gallery: model.serializeRegion(state.blocks),
        baseGalleryHash: state.baseGalleryHash,
        force,
    });

    if (res.status === 409) {
        const last = res.data.lastCommit;
        const who = last ? `\nLast change: "${last.message}" (${new Date(last.date).toLocaleString()})` : '';
        const overwrite = confirm(
            `The page changed since you loaded it.${who}\n\n` +
            'OK = overwrite their version with yours.\nCancel = keep theirs (reload the page to see it).'
        );
        if (overwrite) return publishFlow(true);
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
    state.blocks.forEach((b) => {
        if (b.dirty) {
            b.sourceHtml = model.renderBlock(b);
            b.dirty = false;
        }
    });
    localStorage.removeItem(DRAFT_KEY);
    updatePublishButton();
    startDeployCountdown(res.data.commitSha);
}

function startDeployCountdown(sha) {
    let s = 75;
    setStatus(`Published (${(sha || '').slice(0, 7)}). Site rebuilding — live in ~${s}s.`);
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
            setStatus(`Published (${(sha || '').slice(0, 7)}). Site rebuilding — live in ~${s}s.`);
        }
    }, 5000);
}

// ---------------------------------------------------------------------------
// Chrome: tabs, viewport, undo buttons, status
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
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selectedId &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        deleteBlock(state.selectedId);
    }
    if (e.key === 'Escape') selectBlock(null);
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
        el.textContent = `Last published: ${state.lastCommit.message.replace('Studio: layout update by ', '')} · ${d.toLocaleString()}`;
    } else {
        el.textContent = '';
    }
}

// ---------------------------------------------------------------------------
// Debug hooks for E2E
// ---------------------------------------------------------------------------

window.studioDebug = {
    state,
    roundTrip() {
        const { region } = model.splitFile(state.fileText);
        const blocks = model.parseRegion(region);
        const out = model.serializeRegion(blocks);
        const ok = out === region;
        let diffIndex = -1;
        if (!ok) {
            for (let i = 0; i < Math.max(out.length, region.length); i++) {
                if (out[i] !== region[i]) { diffIndex = i; break; }
            }
        }
        return { ok, diffIndex, blocks: blocks.length };
    },
    serialize: () => model.serializeRegion(state.blocks),
    model,
};

boot();
