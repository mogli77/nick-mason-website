/* ============================================
   POSITIONING MODE - Development Tool
   ============================================

   A temporary tool for visually positioning elements.
   Drag elements to desired position, then lock coordinates in CSS.

   Usage: Call positioningMode.enable('.your-selector')

   ============================================ */

const positioningMode = (function() {
    let activeElement = null;
    let coordsDisplay = null;
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    let originalPosition = null;
    let originalStyles = {};
    let currentScale = 1;

    function createCoordsDisplay() {
        const display = document.createElement('div');
        display.id = 'positioning-coords';
        display.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            color: #00ff00;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 14px;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 99999;
            min-width: 200px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;
        display.innerHTML = `
            <div id="positioning-header" style="margin-bottom: 10px; color: #fff; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 8px; cursor: grab;">
                POSITIONING MODE <span style="font-size: 10px; color: #666; font-weight: normal;">drag to move panel</span>
            </div>
            <div style="margin-bottom: 5px;">X: <span id="pos-x">0</span>px</div>
            <div style="margin-bottom: 5px;">Y: <span id="pos-y">0</span>px</div>
            <div style="margin-bottom: 10px;">Scale: <span id="pos-scale">100</span>%</div>
            <div style="font-size: 11px; color: #888; margin-top: 10px;">
                Drag to move<br>
                Arrow keys: 1px nudge<br>
                Shift+Arrow: 10px nudge<br>
                Scroll wheel: scale<br>
                +/- keys: scale 1%<br>
                ESC: Cancel
            </div>
        `;
        document.body.appendChild(display);

        // Make the panel draggable by its header
        const header = document.getElementById('positioning-header');
        let isPanelDragging = false;
        let panelStartX, panelStartY, panelLeft, panelTop;

        header.addEventListener('mousedown', (e) => {
            isPanelDragging = true;
            panelStartX = e.clientX;
            panelStartY = e.clientY;
            const rect = display.getBoundingClientRect();
            panelLeft = rect.left;
            panelTop = rect.top;
            header.style.cursor = 'grabbing';
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isPanelDragging) return;
            const deltaX = e.clientX - panelStartX;
            const deltaY = e.clientY - panelStartY;
            display.style.left = (panelLeft + deltaX) + 'px';
            display.style.top = (panelTop + deltaY) + 'px';
            display.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (isPanelDragging) {
                isPanelDragging = false;
                header.style.cursor = 'grab';
            }
        });

        return display;
    }

    function updateCoordsDisplay(x, y) {
        const xEl = document.getElementById('pos-x');
        const yEl = document.getElementById('pos-y');
        if (xEl) xEl.textContent = Math.round(x);
        if (yEl) yEl.textContent = Math.round(y);
    }

    function updateScaleDisplay(scale) {
        const scaleEl = document.getElementById('pos-scale');
        if (scaleEl) scaleEl.textContent = Math.round(scale * 100);
    }

    function applyScale(scale) {
        currentScale = Math.max(0.1, Math.min(3, scale)); // Clamp between 10% and 300%
        activeElement.style.transform = `scale(${currentScale})`;
        updateScaleDisplay(currentScale);
    }

    function getComputedPosition(el) {
        const style = window.getComputedStyle(el);
        const left = parseFloat(style.left) || 0;
        const top = parseFloat(style.top) || 0;
        return { left, top };
    }

    function onMouseDown(e) {
        if (e.target !== activeElement && !activeElement.contains(e.target)) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const pos = getComputedPosition(activeElement);
        startLeft = pos.left;
        startTop = pos.top;

        activeElement.style.cursor = 'grabbing';
        e.preventDefault();
    }

    function onMouseMove(e) {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const newLeft = startLeft + deltaX;
        const newTop = startTop + deltaY;

        activeElement.style.left = newLeft + 'px';
        activeElement.style.top = newTop + 'px';

        updateCoordsDisplay(newLeft, newTop);
    }

    function onMouseUp() {
        if (isDragging) {
            isDragging = false;
            activeElement.style.cursor = 'grab';
        }
    }

    function onKeyDown(e) {
        if (!activeElement) return;

        const step = e.shiftKey ? 10 : 1;
        const pos = getComputedPosition(activeElement);
        let newLeft = pos.left;
        let newTop = pos.top;

        switch(e.key) {
            case 'ArrowLeft':
                newLeft -= step;
                e.preventDefault();
                break;
            case 'ArrowRight':
                newLeft += step;
                e.preventDefault();
                break;
            case 'ArrowUp':
                newTop -= step;
                e.preventDefault();
                break;
            case 'ArrowDown':
                newTop += step;
                e.preventDefault();
                break;
            case 'Escape':
                disable();
                return;
            case '=':
            case '+':
                applyScale(currentScale + 0.01);
                e.preventDefault();
                return;
            case '-':
            case '_':
                applyScale(currentScale - 0.01);
                e.preventDefault();
                return;
            default:
                return;
        }

        activeElement.style.left = newLeft + 'px';
        activeElement.style.top = newTop + 'px';
        updateCoordsDisplay(newLeft, newTop);
    }

    function onWheel(e) {
        if (!activeElement) return;

        // Only scale if mouse is over the element or coords display
        const rect = activeElement.getBoundingClientRect();
        const isOverElement = e.clientX >= rect.left && e.clientX <= rect.right &&
                              e.clientY >= rect.top && e.clientY <= rect.bottom;
        const isOverDisplay = e.target.closest('#positioning-coords');

        if (isOverElement || isOverDisplay) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.02 : 0.02;
            applyScale(currentScale + delta);
        }
    }

    function enable(selector) {
        const element = document.querySelector(selector);
        if (!element) {
            console.error('Positioning Mode: Element not found for selector:', selector);
            return;
        }

        // Store original styles
        originalStyles = {
            position: element.style.position,
            left: element.style.left,
            top: element.style.top,
            cursor: element.style.cursor,
            zIndex: element.style.zIndex,
            transform: element.style.transform,
            transformOrigin: element.style.transformOrigin
        };

        // Check if element is already positioned with explicit values
        const computedStyle = window.getComputedStyle(element);
        const isPositioned = computedStyle.position !== 'static';

        let initialLeft, initialTop;

        if (isPositioned && element.style.left && element.style.top) {
            // Already has explicit positioning - use those values
            initialLeft = parseFloat(computedStyle.left) || 0;
            initialTop = parseFloat(computedStyle.top) || 0;
        } else {
            // Start at 0,0 offset from natural position
            // This means "no adjustment yet" - drag to create offset
            initialLeft = 0;
            initialTop = 0;
        }

        // Check for existing scale
        const existingTransform = computedStyle.transform;
        if (existingTransform && existingTransform !== 'none') {
            // Parse scale from matrix
            const matrix = new DOMMatrix(existingTransform);
            currentScale = matrix.a; // scaleX
        } else {
            currentScale = 1;
        }

        // Make element positionable
        activeElement = element;
        element.style.position = 'relative';
        element.style.left = initialLeft + 'px';
        element.style.top = initialTop + 'px';
        element.style.cursor = 'grab';
        element.style.zIndex = '9999';
        element.style.transformOrigin = 'top left';

        // Create UI
        coordsDisplay = createCoordsDisplay();
        updateCoordsDisplay(initialLeft, initialTop);
        updateScaleDisplay(currentScale);

        // Add event listeners
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('wheel', onWheel, { passive: false });

        console.log('Positioning Mode ENABLED for:', selector);
        console.log('Starting - X:', Math.round(initialLeft), 'Y:', Math.round(initialTop), 'Scale:', Math.round(currentScale * 100) + '%');
        console.log('Drag/arrows to move, scroll wheel or +/- to scale.');
    }

    function disable() {
        if (!activeElement) return;

        // Log final position before cleanup
        const pos = getComputedPosition(activeElement);
        console.log('Final - X:', Math.round(pos.left), 'Y:', Math.round(pos.top), 'Scale:', Math.round(currentScale * 100) + '%');
        console.log('To lock, tell Claude: "lock element at X:', Math.round(pos.left), 'Y:', Math.round(pos.top), 'Scale:', Math.round(currentScale * 100) + '%"');

        // Restore original styles
        activeElement.style.position = originalStyles.position;
        activeElement.style.left = originalStyles.left;
        activeElement.style.top = originalStyles.top;
        activeElement.style.cursor = originalStyles.cursor;
        activeElement.style.zIndex = originalStyles.zIndex;
        activeElement.style.transform = originalStyles.transform;
        activeElement.style.transformOrigin = originalStyles.transformOrigin;

        // Remove UI
        if (coordsDisplay) {
            coordsDisplay.remove();
            coordsDisplay = null;
        }

        // Remove event listeners
        document.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('wheel', onWheel);

        activeElement = null;
        currentScale = 1;
        console.log('Positioning Mode DISABLED');
    }

    function getPosition() {
        if (!activeElement) {
            console.log('No element in positioning mode');
            return null;
        }
        const pos = getComputedPosition(activeElement);
        return {
            x: Math.round(pos.left),
            y: Math.round(pos.top),
            scale: Math.round(currentScale * 100)
        };
    }

    return {
        enable,
        disable,
        getPosition
    };
})();
