/* ============================================
   GALLERY EDITOR - Development Tool
   ============================================

   In-page drag-and-drop editor for gallery layouts.
   Works directly on the live grid — drag to reorder,
   delete images, change sizes, add from sidebar.

   Usage: Add <script src="js/gallery-editor.js"></script>
   to any project page.

   ============================================ */

(function() {
    // ── Panel ──
    const panel = document.createElement('div');
    panel.id = 'ge-panel';
    panel.innerHTML = `
        <style>
            #ge-panel {
                position: fixed; top: 12px; right: 12px;
                background: rgba(0,0,0,0.92); color: #fff;
                font-family: 'Monaco','Menlo',monospace; font-size: 11px;
                padding: 14px 18px; border-radius: 10px;
                z-index: 99999; min-width: 200px;
                box-shadow: 0 4px 24px rgba(0,0,0,0.4);
                user-select: none;
            }
            #ge-panel h3 {
                margin: 0 0 10px; font-size: 12px; color: #0f0;
                border-bottom: 1px solid #333; padding-bottom: 8px;
            }
            #ge-panel button {
                display: block; width: 100%; margin: 5px 0; padding: 7px 10px;
                background: #222; color: #ccc; border: 1px solid #444;
                border-radius: 4px; font-family: inherit; font-size: 11px; cursor: pointer;
            }
            #ge-panel button:hover { background: #333; color: #fff; }
            #ge-panel button.primary { background: #0a5; color: #fff; border-color: #0a5; }
            #ge-panel .info { color: #666; font-size: 9px; margin-top: 10px; line-height: 1.5; }

            /* Drag feedback */
            .ge-dragging { opacity: 0.3 !important; }
            .ge-drag-over { outline: 3px solid #0f0 !important; outline-offset: -3px; }

            /* Editable items get hover controls */
            .ge-editable {
                position: relative !important;
                cursor: grab;
            }
            .ge-editable:active { cursor: grabbing; }

            /* Delete button on each image */
            .ge-delete {
                position: absolute; top: 6px; right: 6px;
                width: 28px; height: 28px;
                background: rgba(0,0,0,0.7); color: #f55;
                border: 1px solid #f55; border-radius: 50%;
                font-size: 16px; line-height: 26px; text-align: center;
                cursor: pointer; z-index: 10;
                opacity: 0; transition: opacity 0.15s;
                font-family: sans-serif;
            }
            .ge-editable:hover .ge-delete { opacity: 1; }
            .ge-delete:hover { background: #f55; color: #fff; }

            /* Size toggle buttons */
            .ge-sizes {
                position: absolute; bottom: 6px; left: 6px;
                display: flex; gap: 3px;
                opacity: 0; transition: opacity 0.15s; z-index: 10;
            }
            .ge-editable:hover .ge-sizes { opacity: 1; }
            .ge-sizes button {
                display: inline-block; width: auto; margin: 0;
                padding: 3px 8px; font-size: 9px;
                background: rgba(0,0,0,0.7); color: #ccc;
                border: 1px solid #555; border-radius: 3px;
            }
            .ge-sizes button:hover { background: rgba(0,0,0,0.9); color: #fff; }
            .ge-sizes button.active { color: #0f0; border-color: #0f0; }

            /* Label */
            .ge-label {
                position: absolute; top: 6px; left: 6px;
                background: rgba(0,0,0,0.7); color: #0f0;
                font-family: 'Monaco','Menlo',monospace; font-size: 9px;
                padding: 2px 6px; border-radius: 3px;
                opacity: 0; transition: opacity 0.15s;
                pointer-events: none; z-index: 10;
            }
            .ge-editable:hover .ge-label { opacity: 1; }

            /* Removed tray */
            #ge-removed {
                position: fixed; bottom: 12px; left: 12px; right: 12px;
                background: rgba(0,0,0,0.9); border-radius: 10px;
                padding: 12px; z-index: 99998;
                display: none; max-height: 150px; overflow-y: auto;
            }
            #ge-removed.has-items { display: block; }
            #ge-removed h4 {
                font-family: 'Monaco',monospace; font-size: 10px;
                color: #555; margin-bottom: 8px; text-transform: uppercase;
            }
            #ge-removed .ge-removed-grid {
                display: flex; flex-wrap: wrap; gap: 6px;
            }
            #ge-removed .ge-removed-thumb {
                width: 80px; height: 55px; border-radius: 4px;
                overflow: hidden; cursor: pointer; opacity: 0.5;
                transition: opacity 0.15s; position: relative;
            }
            #ge-removed .ge-removed-thumb:hover { opacity: 1; }
            #ge-removed .ge-removed-thumb img {
                width: 100%; height: 100%; object-fit: cover;
            }
        </style>
        <h3>GALLERY EDITOR</h3>
        <button id="ge-add-images">+ Add Images from Folder</button>
        <button id="ge-export" class="primary">Export Layout</button>
        <button id="ge-exit">Exit (ESC)</button>
        <div class="info">
            Drag images to reorder<br>
            Hover for delete &amp; size controls<br>
            Export copies JSON to clipboard
        </div>
    `;
    document.body.appendChild(panel);

    // Removed tray
    const removedTray = document.createElement('div');
    removedTray.id = 'ge-removed';
    removedTray.innerHTML = '<h4>Removed (click to restore)</h4><div class="ge-removed-grid" id="ge-removed-grid"></div>';
    document.body.appendChild(removedTray);

    const gallery = document.querySelector('.project-gallery');
    if (!gallery) { console.error('No .project-gallery found'); return; }

    let dragEl = null;
    let removedImages = [];

    // ── Find all gallery items (images inside gallery containers) ──
    function getAllItems() {
        return gallery.querySelectorAll('.gallery-item');
    }

    function getContainerType(el) {
        const parent = el.parentElement;
        if (parent.classList.contains('gallery-overlap')) return parent.classList.contains('reverse') ? 'overlap-reverse' : 'overlap';
        if (parent.classList.contains('gallery-trio')) return 'trio';
        if (parent.classList.contains('gallery-pair')) return 'pair';
        if (el.classList.contains('full')) return 'full';
        return 'full';
    }

    // ── Setup each item for editing ──
    function setupItem(item) {
        if (item.classList.contains('ge-editable')) return;
        item.classList.add('ge-editable');
        item.draggable = true;

        const img = item.querySelector('img');
        if (!img) return;
        const filename = img.src.split('/').pop();

        // Label
        const label = document.createElement('div');
        label.className = 'ge-label';
        label.textContent = filename;
        item.appendChild(label);

        // Delete button
        const del = document.createElement('div');
        del.className = 'ge-delete';
        del.textContent = '\u00d7';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            removeImage(item);
        });
        item.appendChild(del);

        // Drag events
        item.addEventListener('dragstart', (e) => {
            dragEl = item;
            item.classList.add('ge-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('ge-dragging');
            gallery.querySelectorAll('.ge-drag-over').forEach(el => el.classList.remove('ge-drag-over'));
            dragEl = null;
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragEl && dragEl !== item) {
                item.classList.add('ge-drag-over');
            }
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('ge-drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('ge-drag-over');
            if (!dragEl || dragEl === item) return;

            const srcImg = dragEl.querySelector('img');
            const dstImg = item.querySelector('img');
            if (!srcImg || !dstImg) return;

            const srcEmpty = dragEl.classList.contains('ge-empty');
            const dstEmpty = item.classList.contains('ge-empty');

            if (dstEmpty && !srcEmpty) {
                // Dragging a real image into an empty slot — move it there
                dstImg.src = srcImg.src;
                dstImg.alt = srcImg.alt;
                dstImg.style.display = '';
                item.classList.remove('ge-empty');

                // Source becomes empty
                srcImg.style.display = 'none';
                dragEl.classList.add('ge-empty');
            } else if (!dstEmpty && !srcEmpty) {
                // Both have images — swap
                const tmpSrc = srcImg.src;
                const tmpAlt = srcImg.alt;
                srcImg.src = dstImg.src;
                srcImg.alt = dstImg.alt;
                dstImg.src = tmpSrc;
                dstImg.alt = tmpAlt;
            }
            // If both empty or dragging empty onto real, do nothing

            // Update labels
            const srcLabel = dragEl.querySelector('.ge-label');
            const dstLabel = item.querySelector('.ge-label');
            if (srcLabel) srcLabel.textContent = dragEl.classList.contains('ge-empty') ? '' : srcImg.src.split('/').pop();
            if (dstLabel) dstLabel.textContent = item.classList.contains('ge-empty') ? '' : dstImg.src.split('/').pop();
        });
    }

    function removeImage(item) {
        const img = item.querySelector('img');
        if (!img) return;

        removedImages.push({
            src: img.src,
            alt: img.alt,
            filename: img.src.split('/').pop()
        });

        // Turn into empty placeholder slot instead of removing
        img.style.display = 'none';
        item.classList.add('ge-empty');

        // Add empty slot styling
        if (!document.getElementById('ge-empty-style')) {
            const style = document.createElement('style');
            style.id = 'ge-empty-style';
            style.textContent = `
                .ge-empty {
                    background: repeating-linear-gradient(
                        45deg, #1a1a1a, #1a1a1a 10px, #222 10px, #222 20px
                    ) !important;
                    min-height: 200px;
                    display: flex !important;
                    align-items: center;
                    justify-content: center;
                }
                .ge-empty::before {
                    content: 'Drop image here';
                    color: #555;
                    font-family: 'Monaco','Menlo',monospace;
                    font-size: 11px;
                }
                .ge-empty .ge-delete { display: none; }
                .ge-empty .ge-label { display: none; }
            `;
            document.head.appendChild(style);
        }

        // Update the drop handler so dropping into an empty slot fills it
        // (already handled by the swap logic — it swaps src, so dropping
        // a real image into an empty slot moves the image there)

        updateRemovedTray();
    }

    function restoreImage(idx) {
        const imgData = removedImages[idx];
        removedImages.splice(idx, 1);

        // Try to fill an empty slot first
        const emptySlot = gallery.querySelector('.ge-empty');
        if (emptySlot) {
            const img = emptySlot.querySelector('img');
            img.src = imgData.src;
            img.alt = imgData.alt;
            img.style.display = '';
            emptySlot.classList.remove('ge-empty');
            const label = emptySlot.querySelector('.ge-label');
            if (label) label.textContent = imgData.filename;
        } else {
            // No empty slots — append as full-width
            const figure = document.createElement('figure');
            figure.className = 'gallery-item full';
            figure.innerHTML = `<img class="parallax-img" src="${imgData.src}" alt="${imgData.alt}">`;
            gallery.appendChild(figure);
            setupItem(figure);
        }
        updateRemovedTray();
    }

    function updateRemovedTray() {
        const grid = document.getElementById('ge-removed-grid');
        grid.innerHTML = '';
        removedImages.forEach((img, idx) => {
            const thumb = document.createElement('div');
            thumb.className = 'ge-removed-thumb';
            thumb.innerHTML = `<img src="${img.src}">`;
            thumb.title = img.filename + ' — click to restore';
            thumb.addEventListener('click', () => restoreImage(idx));
            grid.appendChild(thumb);
        });
        removedTray.classList.toggle('has-items', removedImages.length > 0);
    }

    // ── Add images from folder ──
    document.getElementById('ge-add-images').addEventListener('click', async () => {
        try {
            const dirHandle = await window.showDirectoryPicker();
            const files = [];
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
                    const file = await entry.getFile();
                    files.push({ name: entry.name, url: URL.createObjectURL(file) });
                }
            }
            files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

            // Check which are already on the page
            const existing = new Set();
            gallery.querySelectorAll('img').forEach(img => {
                existing.add(img.src.split('/').pop());
            });

            let added = 0;
            files.forEach(f => {
                if (!existing.has(f.name)) {
                    const figure = document.createElement('figure');
                    figure.className = 'gallery-item full';
                    figure.innerHTML = `<img class="parallax-img" src="${f.url}" alt="${f.name}" data-filename="${f.name}">`;
                    gallery.appendChild(figure);
                    setupItem(figure);
                    added++;
                }
            });

            if (added > 0) {
                const btn = document.getElementById('ge-add-images');
                btn.textContent = `Added ${added} images`;
                setTimeout(() => { btn.textContent = '+ Add Images from Folder'; }, 2000);
            }
        } catch (e) {
            if (e.name !== 'AbortError') console.error(e);
        }
    });

    // ── Export ──
    document.getElementById('ge-export').addEventListener('click', () => {
        const items = gallery.querySelectorAll('.gallery-item');
        const layout = [];

        items.forEach(item => {
            if (item.classList.contains('ge-empty')) return; // skip empty slots
            const img = item.querySelector('img');
            if (!img) return;

            const filename = img.dataset.filename || img.src.split('/').pop();
            const type = getContainerType(item);

            layout.push({ file: filename, type: type });
        });

        // Group consecutive items by their parent container
        const grouped = [];
        let currentGroup = null;

        items.forEach(item => {
            const img = item.querySelector('img');
            if (!img) return;

            const filename = img.dataset.filename || img.src.split('/').pop();
            const parent = item.parentElement;
            const isDirectChild = parent === gallery;

            if (isDirectChild) {
                grouped.push({ type: 'full', images: [filename] });
            } else {
                // Check if same parent as previous
                if (currentGroup && currentGroup._parent === parent) {
                    currentGroup.images.push(filename);
                } else {
                    let type = 'pair';
                    if (parent.classList.contains('gallery-overlap')) {
                        type = parent.classList.contains('reverse') ? 'overlap-reverse' : 'overlap';
                    } else if (parent.classList.contains('gallery-trio')) {
                        type = 'trio';
                    } else if (parent.classList.contains('gallery-pair')) {
                        type = 'pair';
                    }
                    currentGroup = { type, images: [filename], _parent: parent };
                    grouped.push(currentGroup);
                }
            }
        });

        // Clean up internal refs
        grouped.forEach(g => delete g._parent);

        const json = JSON.stringify({ layout: grouped }, null, 2);

        navigator.clipboard.writeText(json).then(() => {
            const btn = document.getElementById('ge-export');
            btn.textContent = 'Copied to clipboard!';
            btn.style.background = '#0c7';
            setTimeout(() => {
                btn.textContent = 'Export Layout';
                btn.style.background = '';
            }, 2000);
        }).catch(() => {
            console.log(json);
            alert('Layout logged to console');
        });
    });

    // ── Exit ──
    function exitEditor() {
        gallery.querySelectorAll('.ge-editable').forEach(item => {
            item.classList.remove('ge-editable', 'ge-dragging', 'ge-drag-over');
            item.removeAttribute('draggable');
            item.querySelectorAll('.ge-delete, .ge-label, .ge-sizes').forEach(el => el.remove());
        });
        panel.remove();
        removedTray.remove();
    }

    document.getElementById('ge-exit').addEventListener('click', exitEditor);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') exitEditor();
    });

    // ── Init: setup all existing items ──
    getAllItems().forEach(setupItem);

})();
