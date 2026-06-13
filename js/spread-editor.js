/*
   Nick Mason live spread editor
   Dev-only layout tool. Activate with: ?layout=edit

   Goals:
   - Edit the real homepage spreads in-place.
   - Save temporary experiments to localStorage.
   - Export clean CSS that can be locked into styles.css.
*/

(function () {
    const params = new URLSearchParams(window.location.search);
    const enabled = params.get('layout') === 'edit' || window.location.hash === '#layout-edit';
    if (!enabled) return;

    const STORAGE_KEY = 'nickMason.spreadEditor.v1';
    const ROOT_CLASS = 'nm-layout-editing';
    const MIN_SIZE = 28;

    let selectedFrame = null;
    let activeDrag = null;
    let draft = loadDraft();
    const root = document.documentElement;
    const body = document.body;
    const frames = Array.from(document.querySelectorAll('.magazine-spread .spread-canvas > .mag-frame'));
    const sections = Array.from(document.querySelectorAll('.magazine-spread'));

    if (!frames.length) return;

    init();

    function init() {
        injectStyles();
        root.classList.add(ROOT_CLASS);
        body.classList.add(ROOT_CLASS);

        window.nickLayoutEditor = {
            exportCSS,
            exportJSON,
            getState: () => collectCurrentState(),
            clearDraft,
            applyDraft
        };

        createToolbar();
        applyDraft();
        frames.forEach(prepareFrame);
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', endDrag);
        document.addEventListener('keydown', onKeyDown);

        updateToolbar();
    }

    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'nm-spread-editor-styles';
        style.textContent = `
            html.${ROOT_CLASS} {
                scroll-snap-type: none !important;
                scroll-behavior: auto !important;
            }

            html.${ROOT_CLASS} *,
            body.${ROOT_CLASS} * {
                scroll-behavior: auto !important;
            }

            body.${ROOT_CLASS} .magazine-spread {
                scroll-snap-align: none !important;
            }

            body.${ROOT_CLASS} .spread-canvas {
                outline: 1px dashed rgba(20, 20, 20, 0.18);
                outline-offset: 8px;
            }

            body.${ROOT_CLASS} .mag-frame {
                cursor: grab;
                transition: outline-color 120ms ease, box-shadow 120ms ease;
                outline: 1px solid rgba(255, 210, 0, 0.26);
                outline-offset: 0;
                touch-action: none;
            }

            body.${ROOT_CLASS} .mag-frame:hover {
                outline-color: rgba(255, 210, 0, 0.7);
            }

            body.${ROOT_CLASS} .mag-frame.nm-editor-selected {
                cursor: grabbing;
                outline: 2px solid #ffd800;
                box-shadow: 0 0 0 1px rgba(0,0,0,0.34), 0 18px 60px rgba(0,0,0,0.2);
                overflow: visible !important;
            }

            body.${ROOT_CLASS} .mag-frame > img,
            body.${ROOT_CLASS} .mag-frame > video {
                pointer-events: none;
                user-select: none;
                -webkit-user-drag: none;
            }

            .nm-editor-toolbar {
                position: fixed;
                left: 18px;
                bottom: 18px;
                width: min(420px, calc(100vw - 36px));
                z-index: 999999;
                background: rgba(17, 17, 15, 0.92);
                color: #f7f1dc;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 18px;
                box-shadow: 0 20px 80px rgba(0,0,0,0.32);
                backdrop-filter: blur(18px);
                -webkit-backdrop-filter: blur(18px);
                font-family: 'IBM Plex Sans', sans-serif;
                font-size: 12px;
                letter-spacing: 0.01em;
                overflow: hidden;
            }

            .nm-editor-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 12px 14px 10px;
                border-bottom: 1px solid rgba(255,255,255,0.12);
            }

            .nm-editor-title {
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 15px;
                font-weight: 600;
                letter-spacing: 0.12em;
                text-transform: uppercase;
            }

            .nm-editor-status {
                color: rgba(247,241,220,0.62);
                font-size: 11px;
                text-align: right;
            }

            .nm-editor-body {
                display: grid;
                gap: 10px;
                padding: 12px 14px 14px;
            }

            .nm-editor-row {
                display: flex;
                gap: 7px;
                align-items: center;
                flex-wrap: wrap;
            }

            .nm-editor-row strong {
                min-width: 58px;
                color: rgba(247,241,220,0.68);
                font-size: 10px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.1em;
            }

            .nm-editor-button,
            .nm-editor-select {
                appearance: none;
                border: 1px solid rgba(255,255,255,0.15);
                background: rgba(255,255,255,0.08);
                color: #f7f1dc;
                border-radius: 999px;
                padding: 7px 10px;
                font: inherit;
                line-height: 1;
            }

            .nm-editor-button {
                cursor: pointer;
            }

            .nm-editor-button:hover,
            .nm-editor-select:hover {
                background: rgba(255,255,255,0.15);
            }

            .nm-editor-button.primary {
                background: #ffd800;
                color: #11110f;
                border-color: #ffd800;
                font-weight: 500;
            }

            .nm-editor-button.danger {
                color: #ff9f9f;
            }

            .nm-editor-select {
                flex: 1;
                min-width: 170px;
            }

            .nm-editor-readout {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 6px;
            }

            .nm-editor-pill {
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 12px;
                padding: 7px 8px;
                background: rgba(255,255,255,0.06);
            }

            .nm-editor-pill span {
                display: block;
                color: rgba(247,241,220,0.48);
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                margin-bottom: 3px;
            }

            .nm-editor-pill b {
                font-weight: 500;
            }

            .nm-editor-range {
                flex: 1;
                min-width: 130px;
                accent-color: #ffd800;
            }

            .nm-editor-handle {
                position: absolute;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                background: #ffd800;
                border: 2px solid #11110f;
                z-index: 5;
                display: none;
                pointer-events: auto;
            }

            .nm-editor-selected .nm-editor-handle {
                display: block;
            }

            .nm-editor-handle[data-handle="nw"] { left: -8px; top: -8px; cursor: nwse-resize; }
            .nm-editor-handle[data-handle="ne"] { right: -8px; top: -8px; cursor: nesw-resize; }
            .nm-editor-handle[data-handle="sw"] { left: -8px; bottom: -8px; cursor: nesw-resize; }
            .nm-editor-handle[data-handle="se"] { right: -8px; bottom: -8px; cursor: nwse-resize; }

            .nm-editor-toast {
                position: fixed;
                left: 50%;
                bottom: 24px;
                transform: translateX(-50%) translateY(80px);
                z-index: 1000000;
                background: #11110f;
                color: #f7f1dc;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 999px;
                padding: 10px 14px;
                font: 12px 'IBM Plex Sans', sans-serif;
                opacity: 0;
                transition: transform 180ms ease, opacity 180ms ease;
                pointer-events: none;
            }

            .nm-editor-toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }

            .nm-editor-export {
                position: fixed;
                inset: 7vh 7vw;
                z-index: 1000001;
                display: none;
                background: rgba(17, 17, 15, 0.96);
                color: #f7f1dc;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 22px;
                box-shadow: 0 30px 110px rgba(0,0,0,0.45);
                overflow: hidden;
            }

            .nm-editor-export.show {
                display: grid;
                grid-template-rows: auto 1fr;
            }

            .nm-editor-export-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 16px;
                border-bottom: 1px solid rgba(255,255,255,0.12);
            }

            .nm-editor-export textarea {
                width: 100%;
                height: 100%;
                resize: none;
                border: 0;
                padding: 18px;
                background: #0b0b0a;
                color: #f7f1dc;
                font: 12px/1.5 'Monaco', 'Menlo', monospace;
                outline: none;
            }
        `;
        document.head.appendChild(style);
    }

    function createToolbar() {
        const toolbar = document.createElement('aside');
        toolbar.className = 'nm-editor-toolbar';
        toolbar.innerHTML = `
            <div class="nm-editor-head">
                <div>
                    <div class="nm-editor-title">Spread Editor</div>
                    <div class="nm-editor-status" id="nm-editor-selected">Select an image or video</div>
                </div>
                <button class="nm-editor-button" data-action="preview">Preview</button>
            </div>
            <div class="nm-editor-body">
                <div class="nm-editor-row">
                    <strong>Section</strong>
                    <select class="nm-editor-select" id="nm-editor-section"></select>
                    <button class="nm-editor-button" data-action="prev">Prev</button>
                    <button class="nm-editor-button" data-action="next">Next</button>
                </div>
                <div class="nm-editor-readout">
                    <div class="nm-editor-pill"><span>X</span><b id="nm-readout-x">--</b></div>
                    <div class="nm-editor-pill"><span>Y</span><b id="nm-readout-y">--</b></div>
                    <div class="nm-editor-pill"><span>W</span><b id="nm-readout-w">--</b></div>
                    <div class="nm-editor-pill"><span>H</span><b id="nm-readout-h">--</b></div>
                </div>
                <div class="nm-editor-row">
                    <strong>Frame</strong>
                    <button class="nm-editor-button" data-action="contain">Contain</button>
                    <button class="nm-editor-button" data-action="cover">Cover</button>
                    <button class="nm-editor-button" data-action="front">Front</button>
                    <button class="nm-editor-button" data-action="back">Back</button>
                    <button class="nm-editor-button danger" data-action="reset">Reset</button>
                </div>
                <div class="nm-editor-row">
                    <strong>Crop X</strong>
                    <input class="nm-editor-range" id="nm-media-x" type="range" min="0" max="100" value="50">
                    <strong>Crop Y</strong>
                    <input class="nm-editor-range" id="nm-media-y" type="range" min="0" max="100" value="50">
                </div>
                <div class="nm-editor-row">
                    <strong>Draft</strong>
                    <button class="nm-editor-button" data-action="save">Save Draft</button>
                    <button class="nm-editor-button" data-action="clear">Clear Draft</button>
                    <button class="nm-editor-button primary" data-action="export">Export CSS</button>
                </div>
            </div>
        `;
        document.body.appendChild(toolbar);

        const select = toolbar.querySelector('#nm-editor-section');
        sections.forEach((section, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = sectionLabel(section, index);
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            const section = sections[Number(select.value)];
            if (section) section.scrollIntoView({ block: 'center' });
        });

        toolbar.addEventListener('click', (event) => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (!action) return;
            runAction(action);
        });

        toolbar.querySelector('#nm-media-x').addEventListener('input', updateObjectPositionFromInputs);
        toolbar.querySelector('#nm-media-y').addEventListener('input', updateObjectPositionFromInputs);

        createExportModal();
        createToast();
    }

    function createExportModal() {
        const modal = document.createElement('div');
        modal.className = 'nm-editor-export';
        modal.innerHTML = `
            <div class="nm-editor-export-head">
                <div>
                    <div class="nm-editor-title">Lock-In CSS</div>
                    <div class="nm-editor-status">Paste this into styles.css, or ask Codex to lock it.</div>
                </div>
                <div class="nm-editor-row">
                    <button class="nm-editor-button primary" data-export-copy>Copy CSS</button>
                    <button class="nm-editor-button" data-export-close>Close</button>
                </div>
            </div>
            <textarea spellcheck="false" id="nm-editor-export-text"></textarea>
        `;
        document.body.appendChild(modal);
        modal.querySelector('[data-export-close]').addEventListener('click', () => modal.classList.remove('show'));
        modal.querySelector('[data-export-copy]').addEventListener('click', async () => {
            const textarea = modal.querySelector('textarea');
            textarea.select();
            try {
                await navigator.clipboard.writeText(textarea.value);
                toast('CSS copied');
            } catch (error) {
                document.execCommand('copy');
                toast('CSS selected');
            }
        });
    }

    function createToast() {
        const toastEl = document.createElement('div');
        toastEl.className = 'nm-editor-toast';
        toastEl.id = 'nm-editor-toast';
        document.body.appendChild(toastEl);
    }

    function prepareFrame(frame) {
        frame.dataset.nmSelector = selectorForFrame(frame);

        if (!frame.querySelector('.nm-editor-handle')) {
            ['nw', 'ne', 'sw', 'se'].forEach((handle) => {
                const el = document.createElement('span');
                el.className = 'nm-editor-handle';
                el.dataset.handle = handle;
                frame.appendChild(el);
            });
        }

        frame.addEventListener('pointerdown', (event) => {
            const handle = event.target.closest('.nm-editor-handle')?.dataset.handle;
            startDrag(event, frame, handle || 'move');
        });

        frame.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectFrame(frame);
        });
    }

    function selectFrame(frame) {
        if (!frame) return;
        if (selectedFrame) selectedFrame.classList.remove('nm-editor-selected');
        selectedFrame = frame;
        selectedFrame.classList.add('nm-editor-selected');
        normalizeFrame(selectedFrame);
        updateToolbar();
    }

    function startDrag(event, frame, mode) {
        event.preventDefault();
        event.stopPropagation();
        selectFrame(frame);

        const canvas = frame.closest('.spread-canvas');
        lockCanvasForEditing(canvas);
        normalizeFrame(frame);

        const state = readFrameState(frame);
        const canvasRect = canvas.getBoundingClientRect();

        activeDrag = {
            frame,
            canvas,
            mode,
            startX: event.clientX,
            startY: event.clientY,
            canvasW: canvasRect.width,
            canvasH: canvasRect.height,
            start: state
        };

        frame.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event) {
        if (!activeDrag) return;

        const dx = event.clientX - activeDrag.startX;
        const dy = event.clientY - activeDrag.startY;
        const xPct = pxToPct(dx, activeDrag.canvasW);
        const yPct = pxToPct(dy, activeDrag.canvasH);
        const start = activeDrag.start;

        let next = { ...start };

        if (activeDrag.mode === 'move') {
            next.left = start.left + xPct;
            next.top = start.top + yPct;
        } else {
            next = resizeFromHandle(activeDrag.mode, start, xPct, yPct, activeDrag);
        }

        next = clampFrame(next);
        applyFrameState(activeDrag.frame, next);
        markDirty(activeDrag.frame);
        updateToolbar();
    }

    function endDrag() {
        if (!activeDrag) return;
        saveDraft({ quiet: true });
        activeDrag = null;
    }

    function resizeFromHandle(handle, start, xPct, yPct, drag) {
        const aspect = start.height / start.width;
        let next = { ...start };

        if (handle.includes('e')) {
            next.width = start.width + xPct;
            next.height = next.width * aspect;
        }
        if (handle.includes('w')) {
            next.width = start.width - xPct;
            next.height = next.width * aspect;
            next.left = start.left + (start.width - next.width);
        }
        if (handle.includes('s')) {
            next.height = start.height + yPct;
            next.width = next.height / aspect;
        }
        if (handle.includes('n')) {
            next.height = start.height - yPct;
            next.width = next.height / aspect;
            next.top = start.top + (start.height - next.height);
        }

        const minWPct = pxToPct(MIN_SIZE, drag.canvasW);
        const minHPct = pxToPct(MIN_SIZE, drag.canvasH);
        if (next.width < minWPct || next.height < minHPct) return start;
        return next;
    }

    function onKeyDown(event) {
        if (isTypingInEditor(event.target)) return;
        if (event.key === 'Escape') {
            if (document.querySelector('.nm-editor-export.show')) {
                document.querySelector('.nm-editor-export.show')?.classList.remove('show');
            } else if (selectedFrame) {
                selectedFrame.classList.remove('nm-editor-selected');
                selectedFrame = null;
                updateToolbar();
            }
            return;
        }

        if (!selectedFrame) return;

        const stepPx = event.shiftKey ? 10 : 1;
        const canvas = selectedFrame.closest('.spread-canvas');
        const rect = canvas.getBoundingClientRect();
        const state = readFrameState(selectedFrame);
        let next = { ...state };

        if (event.key === 'ArrowLeft') next.left -= pxToPct(stepPx, rect.width);
        else if (event.key === 'ArrowRight') next.left += pxToPct(stepPx, rect.width);
        else if (event.key === 'ArrowUp') next.top -= pxToPct(stepPx, rect.height);
        else if (event.key === 'ArrowDown') next.top += pxToPct(stepPx, rect.height);
        else if (event.key === '[') changeZ(-1);
        else if (event.key === ']') changeZ(1);
        else if (event.key === 'c') setObjectFit('cover');
        else if (event.key === 'n') setObjectFit('contain');
        else if (event.key === 's') saveDraft();
        else if (event.key === 'e') showExport();
        else return;

        if (event.key.startsWith('Arrow')) {
            event.preventDefault();
            normalizeFrame(selectedFrame);
            applyFrameState(selectedFrame, clampFrame(next));
            markDirty(selectedFrame);
            saveDraft({ quiet: true });
            updateToolbar();
        }
    }

    function runAction(action) {
        if (action === 'preview') {
            togglePreview();
            return;
        }
        if (action === 'prev' || action === 'next') {
            jumpSection(action === 'next' ? 1 : -1);
            return;
        }
        if (action === 'save') {
            saveDraft();
            return;
        }
        if (action === 'clear') {
            clearDraft();
            return;
        }
        if (action === 'export') {
            showExport();
            return;
        }
        if (!selectedFrame) {
            toast('Select a frame first');
            return;
        }
        if (action === 'contain' || action === 'cover') setObjectFit(action);
        if (action === 'front') changeZ(1);
        if (action === 'back') changeZ(-1);
        if (action === 'reset') resetSelected();
    }

    function togglePreview() {
        body.classList.toggle(ROOT_CLASS);
        root.classList.toggle(ROOT_CLASS);
        toast(body.classList.contains(ROOT_CLASS) ? 'Edit mode on' : 'Preview mode');
    }

    function jumpSection(direction) {
        const current = currentSectionIndex();
        const next = Math.max(0, Math.min(sections.length - 1, current + direction));
        sections[next].scrollIntoView({ block: 'center' });
        document.querySelector('#nm-editor-section').value = String(next);
    }

    function currentSectionIndex() {
        const midpoint = window.scrollY + window.innerHeight / 2;
        let best = 0;
        let bestDistance = Infinity;
        sections.forEach((section, index) => {
            const center = section.offsetTop + section.offsetHeight / 2;
            const distance = Math.abs(center - midpoint);
            if (distance < bestDistance) {
                best = index;
                bestDistance = distance;
            }
        });
        return best;
    }

    function normalizeFrame(frame) {
        const canvas = frame.closest('.spread-canvas');
        lockCanvasForEditing(canvas);

        const state = readFrameState(frame);
        frame.style.position = 'absolute';
        frame.style.left = `${state.left.toFixed(4)}%`;
        frame.style.top = `${state.top.toFixed(4)}%`;
        frame.style.right = 'auto';
        frame.style.bottom = 'auto';
        frame.style.width = `${state.width.toFixed(4)}%`;
        frame.style.height = `${state.height.toFixed(4)}%`;
        frame.style.aspectRatio = 'auto';
    }

    function lockCanvasForEditing(canvas) {
        if (!canvas || canvas.dataset.nmCanvasLocked === 'true') return;
        const rect = canvas.getBoundingClientRect();
        canvas.dataset.nmOriginalStyle = canvas.getAttribute('style') || '';
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        canvas.style.maxWidth = 'none';
        canvas.style.aspectRatio = 'auto';
        canvas.dataset.nmCanvasLocked = 'true';
    }

    function readFrameState(frame) {
        const canvas = frame.closest('.spread-canvas');
        const canvasRect = canvas.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return {
            left: round((frameRect.left - canvasRect.left) / canvasRect.width * 100),
            top: round((frameRect.top - canvasRect.top) / canvasRect.height * 100),
            width: round(frameRect.width / canvasRect.width * 100),
            height: round(frameRect.height / canvasRect.height * 100),
            zIndex: parseInt(window.getComputedStyle(frame).zIndex, 10) || 1
        };
    }

    function applyFrameState(frame, state) {
        frame.style.position = 'absolute';
        frame.style.left = `${round(state.left)}%`;
        frame.style.top = `${round(state.top)}%`;
        frame.style.right = 'auto';
        frame.style.bottom = 'auto';
        frame.style.width = `${round(state.width)}%`;
        frame.style.height = `${round(state.height)}%`;
        frame.style.aspectRatio = 'auto';
        frame.style.zIndex = String(state.zIndex || 1);
    }

    function clampFrame(state) {
        return {
            ...state,
            left: round(Math.max(-80, Math.min(180, state.left))),
            top: round(Math.max(-80, Math.min(180, state.top))),
            width: round(Math.max(1, Math.min(220, state.width))),
            height: round(Math.max(1, Math.min(220, state.height)))
        };
    }

    function setObjectFit(value) {
        const media = selectedFrame?.querySelector('img, video');
        if (!media) return;
        media.style.objectFit = value;
        markDirty(selectedFrame);
        saveDraft({ quiet: true });
        updateToolbar();
        toast(`Fit: ${value}`);
    }

    function updateObjectPositionFromInputs() {
        if (!selectedFrame) return;
        const media = selectedFrame.querySelector('img, video');
        if (!media) return;
        const x = document.querySelector('#nm-media-x').value;
        const y = document.querySelector('#nm-media-y').value;
        media.style.objectPosition = `${x}% ${y}%`;
        markDirty(selectedFrame);
        saveDraft({ quiet: true });
    }

    function changeZ(delta) {
        if (!selectedFrame) return;
        const current = parseInt(window.getComputedStyle(selectedFrame).zIndex, 10) || 1;
        selectedFrame.style.zIndex = String(Math.max(0, current + delta));
        markDirty(selectedFrame);
        saveDraft({ quiet: true });
        updateToolbar();
    }

    function resetSelected() {
        if (!selectedFrame) return;
        const selector = selectedFrame.dataset.nmSelector;
        selectedFrame.removeAttribute('style');
        selectedFrame.querySelector('img, video')?.removeAttribute('style');
        selectedFrame.dataset.nmDirty = 'false';
        delete draft[selector];
        saveDraft({ quiet: true });
        updateToolbar();
        toast('Frame reset');
    }

    function markDirty(frame) {
        frame.dataset.nmDirty = 'true';
    }

    function collectCurrentState() {
        const state = {};
        frames.forEach((frame) => {
            if (frame.dataset.nmDirty !== 'true') return;
            const media = frame.querySelector('img, video');
            state[frame.dataset.nmSelector] = {
                frame: readFrameState(frame),
                media: {
                    objectFit: media?.style.objectFit || '',
                    objectPosition: media?.style.objectPosition || ''
                }
            };
        });
        return state;
    }

    function saveDraft(options = {}) {
        draft = {
            ...draft,
            ...collectCurrentState()
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        } catch (error) {
            if (!options.quiet) toast('Draft could not be saved');
            return;
        }
        if (!options.quiet) toast('Draft saved');
    }

    function loadDraft() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (error) {
            return {};
        }
    }

    function applyDraft() {
        Object.entries(draft).forEach(([selector, value]) => {
            try {
                const frame = document.querySelector(selector);
                if (!frame || !value?.frame) return;
                lockCanvasForEditing(frame.closest('.spread-canvas'));
                applyFrameState(frame, value.frame);
                const media = frame.querySelector('img, video');
                if (media && value.media) {
                    if (value.media.objectFit) media.style.objectFit = value.media.objectFit;
                    if (value.media.objectPosition) media.style.objectPosition = value.media.objectPosition;
                }
                frame.dataset.nmDirty = 'true';
            } catch (error) {
                delete draft[selector];
            }
        });
    }

    function clearDraft() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            // Private browsing or storage restrictions should not block editing.
        }
        draft = {};
        frames.forEach((frame) => {
            frame.dataset.nmDirty = 'false';
            frame.removeAttribute('style');
            frame.querySelector('img, video')?.removeAttribute('style');
        });
        document.querySelectorAll('.spread-canvas[data-nm-canvas-locked="true"]').forEach((canvas) => {
            if (canvas.dataset.nmOriginalStyle) {
                canvas.setAttribute('style', canvas.dataset.nmOriginalStyle);
            } else {
                canvas.removeAttribute('style');
            }
            delete canvas.dataset.nmCanvasLocked;
            delete canvas.dataset.nmOriginalStyle;
        });
        updateToolbar();
        toast('Draft cleared');
    }

    function exportJSON() {
        saveDraft({ quiet: true });
        return JSON.stringify(draft, null, 2);
    }

    function exportCSS() {
        saveDraft({ quiet: true });
        const state = draft;
        const lines = [
            '/* Layout editor export. Review, then lock into the homepage spread CSS. */'
        ];

        Object.entries(state).forEach(([selector, value]) => {
            const frame = value.frame;
            if (!frame) return;
            lines.push('');
            lines.push(`${selector} {`);
            lines.push('    position: absolute;');
            lines.push(`    left: ${format(frame.left)}%;`);
            lines.push(`    top: ${format(frame.top)}%;`);
            lines.push('    right: auto;');
            lines.push('    bottom: auto;');
            lines.push(`    width: ${format(frame.width)}%;`);
            lines.push(`    height: ${format(frame.height)}%;`);
            lines.push('    aspect-ratio: auto;');
            lines.push(`    z-index: ${frame.zIndex || 1};`);
            lines.push('}');

            if (value.media?.objectFit || value.media?.objectPosition) {
                lines.push('');
                lines.push(`${selector} img,`);
                lines.push(`${selector} video {`);
                if (value.media.objectFit) lines.push(`    object-fit: ${value.media.objectFit};`);
                if (value.media.objectPosition) lines.push(`    object-position: ${value.media.objectPosition};`);
                lines.push('}');
            }
        });

        return lines.join('\n');
    }

    function showExport() {
        const modal = document.querySelector('.nm-editor-export');
        const textarea = modal.querySelector('textarea');
        textarea.value = exportCSS();
        modal.classList.add('show');
        textarea.focus();
        textarea.select();
    }

    function updateToolbar() {
        const selectedLabel = document.querySelector('#nm-editor-selected');
        const readouts = {
            x: document.querySelector('#nm-readout-x'),
            y: document.querySelector('#nm-readout-y'),
            w: document.querySelector('#nm-readout-w'),
            h: document.querySelector('#nm-readout-h')
        };

        const sectionSelect = document.querySelector('#nm-editor-section');
        if (sectionSelect) sectionSelect.value = String(currentSectionIndex());

        if (!selectedFrame) {
            selectedLabel.textContent = 'Select an image or video';
            Object.values(readouts).forEach((el) => { el.textContent = '--'; });
            return;
        }

        const state = readFrameState(selectedFrame);
        const media = selectedFrame.querySelector('img, video');
        selectedLabel.textContent = selectedFrame.dataset.nmSelector;
        readouts.x.textContent = `${format(state.left)}%`;
        readouts.y.textContent = `${format(state.top)}%`;
        readouts.w.textContent = `${format(state.width)}%`;
        readouts.h.textContent = `${format(state.height)}%`;

        const position = (media?.style.objectPosition || window.getComputedStyle(media).objectPosition || '50% 50%').split(' ');
        document.querySelector('#nm-media-x').value = parseFloat(position[0]) || 50;
        document.querySelector('#nm-media-y').value = parseFloat(position[1]) || 50;
    }

    function selectorForFrame(frame) {
        const className = Array.from(frame.classList).find((name) => name !== 'mag-frame' && name !== 'pool-hero-frame');
        if (className) return `.${className}`;
        const siblings = Array.from(frame.parentElement.children).filter((el) => el.classList.contains('mag-frame'));
        return `.${Array.from(frame.closest('.magazine-spread').classList).find((name) => name !== 'magazine-spread')} .mag-frame:nth-of-type(${siblings.indexOf(frame) + 1})`;
    }

    function sectionLabel(section, index) {
        const name = Array.from(section.classList).find((className) => className !== 'magazine-spread') || 'spread';
        return `${index + 1}. ${name.replace(/^spread-/, '').replace(/-/g, ' ')}`;
    }

    function toast(message) {
        const el = document.querySelector('#nm-editor-toast');
        if (!el) return;
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.remove('show'), 1500);
    }

    function isTypingInEditor(target) {
        return target?.matches?.('input, textarea, select, button') || target?.closest?.('.nm-editor-toolbar, .nm-editor-export');
    }

    function pxToPct(px, base) {
        return base ? px / base * 100 : 0;
    }

    function round(value) {
        return Math.round(value * 10000) / 10000;
    }

    function format(value) {
        return Number(value).toFixed(2);
    }
})();
