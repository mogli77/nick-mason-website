/* ============================================
   GALLERY EDITOR - Development Tool
   ============================================

   Drag-and-drop gallery reordering tool.
   Rearrange images, change layout types, then
   export the new order to update HTML.

   Usage: Add <script src="js/gallery-editor.js"></script>
   to any project page. Press ESC to exit.

   ============================================ */

(function() {
    const panel = document.createElement('div');
    panel.id = 'gallery-editor-panel';
    panel.innerHTML = `
        <style>
            #gallery-editor-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0,0,0,0.92);
                color: #fff;
                font-family: 'Monaco','Menlo',monospace;
                font-size: 12px;
                padding: 16px 20px;
                border-radius: 10px;
                z-index: 99999;
                min-width: 220px;
                box-shadow: 0 4px 24px rgba(0,0,0,0.4);
                user-select: none;
            }
            #gallery-editor-panel h3 {
                margin: 0 0 10px;
                font-size: 13px;
                color: #0f0;
                border-bottom: 1px solid #333;
                padding-bottom: 8px;
            }
            #gallery-editor-panel button {
                display: block;
                width: 100%;
                margin: 6px 0;
                padding: 8px;
                background: #222;
                color: #fff;
                border: 1px solid #444;
                border-radius: 4px;
                font-family: inherit;
                font-size: 11px;
                cursor: pointer;
            }
            #gallery-editor-panel button:hover { background: #333; }
            #gallery-editor-panel .info { color: #888; font-size: 10px; margin-top: 10px; line-height: 1.5; }

            /* Drag visual feedback */
            .gallery-item.ge-dragging {
                opacity: 0.4 !important;
                outline: 3px dashed #0f0 !important;
            }
            .gallery-item.ge-dragover {
                outline: 3px solid #0f0 !important;
                outline-offset: -3px;
            }
            .gallery-item.ge-slot {
                cursor: grab;
                position: relative;
            }
            .gallery-item.ge-slot::after {
                content: attr(data-ge-label);
                position: absolute;
                bottom: 4px;
                left: 4px;
                background: rgba(0,0,0,0.8);
                color: #0f0;
                font-family: 'Monaco','Menlo',monospace;
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 3px;
                pointer-events: none;
                z-index: 10;
            }
        </style>
        <h3>GALLERY EDITOR</h3>
        <div style="margin-bottom: 8px; color: #ccc;">Drag images to swap positions</div>
        <button id="ge-export">Export New Order</button>
        <button id="ge-exit">Exit Editor (ESC)</button>
        <div class="info">
            Drag any image onto another<br>to swap their positions.<br>
            Export copies the new image<br>order to your clipboard.
        </div>
    `;
    document.body.appendChild(panel);

    // Find all gallery images
    const galleryItems = document.querySelectorAll('.gallery-item');
    let dragSource = null;

    galleryItems.forEach((item, i) => {
        const img = item.querySelector('img');
        if (!img) return;

        // Label each slot
        const filename = img.src.split('/').pop();
        item.classList.add('ge-slot');
        item.setAttribute('data-ge-label', filename);
        item.setAttribute('draggable', 'true');

        item.addEventListener('dragstart', (e) => {
            dragSource = item;
            item.classList.add('ge-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', i.toString());
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('ge-dragging');
            document.querySelectorAll('.ge-dragover').forEach(el => el.classList.remove('ge-dragover'));
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('ge-dragover');
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('ge-dragover');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('ge-dragover');

            if (dragSource && dragSource !== item) {
                // Swap the img src and alt between the two slots
                const srcImg = dragSource.querySelector('img');
                const dstImg = item.querySelector('img');
                if (srcImg && dstImg) {
                    const tmpSrc = srcImg.src;
                    const tmpAlt = srcImg.alt;
                    srcImg.src = dstImg.src;
                    srcImg.alt = dstImg.alt;
                    dstImg.src = tmpSrc;
                    dstImg.alt = tmpAlt;

                    // Update labels
                    dragSource.setAttribute('data-ge-label', srcImg.src.split('/').pop());
                    item.setAttribute('data-ge-label', dstImg.src.split('/').pop());
                }
            }
            dragSource = null;
        });
    });

    // Export button — collects current image order grouped by parent container
    document.getElementById('ge-export').addEventListener('click', () => {
        const gallery = document.querySelector('.project-gallery');
        if (!gallery) return;

        let output = 'GALLERY ORDER:\n\n';
        const children = gallery.children;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const classes = child.className;

            if (child.classList.contains('gallery-quote')) {
                output += '[QUOTE]\n';
            } else if (child.classList.contains('gallery-overlap')) {
                const reverse = child.classList.contains('reverse') ? ' reverse' : '';
                const imgs = child.querySelectorAll('img');
                output += `[OVERLAP${reverse}]\n`;
                imgs.forEach(img => output += '  ' + img.src.split('/web/').pop() + '\n');
            } else if (child.classList.contains('gallery-trio')) {
                const imgs = child.querySelectorAll('img');
                output += '[TRIO]\n';
                imgs.forEach(img => output += '  ' + img.src.split('/web/').pop() + '\n');
            } else if (child.classList.contains('gallery-pair')) {
                const imgs = child.querySelectorAll('img');
                output += '[PAIR]\n';
                imgs.forEach(img => output += '  ' + img.src.split('/web/').pop() + '\n');
            } else if (child.classList.contains('gallery-item') && child.classList.contains('full')) {
                const img = child.querySelector('img');
                if (img) output += '[FULL] ' + img.src.split('/web/').pop() + '\n';
            } else if (child.classList.contains('gallery-video')) {
                output += '[VIDEO]\n';
            }
            output += '\n';
        }

        navigator.clipboard.writeText(output).then(() => {
            const btn = document.getElementById('ge-export');
            btn.textContent = 'Copied to clipboard!';
            btn.style.background = '#0a3';
            setTimeout(() => {
                btn.textContent = 'Export New Order';
                btn.style.background = '#222';
            }, 2000);
        }).catch(() => {
            // Fallback: show in console
            console.log(output);
            alert('Order logged to console (clipboard not available over file://)');
        });
    });

    // Exit
    function exitEditor() {
        galleryItems.forEach(item => {
            item.classList.remove('ge-slot', 'ge-dragging', 'ge-dragover');
            item.removeAttribute('draggable');
            item.removeAttribute('data-ge-label');
        });
        panel.remove();
    }

    document.getElementById('ge-exit').addEventListener('click', exitEditor);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') exitEditor();
    });
})();
