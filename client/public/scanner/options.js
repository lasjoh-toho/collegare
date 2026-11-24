// options.js – Bearbeiten / Farbe two-tab interface with margin crop handles
document.addEventListener('DOMContentLoaded', function () {

    // ── DOM refs ──────────────────────────────────────────────────
    const optionsOverlay      = document.getElementById('optionsOverlay');
    const optionsImage        = document.getElementById('optionsImage');
    const rotateLeftBtn       = document.getElementById('rotateLeftBtn');
    const cropBtn             = document.getElementById('cropBtn');
    const brightnessSlider    = document.getElementById('brightnessSlider');
    const contrastSlider      = document.getElementById('contrastSlider');
    const whiteBalanceSlider  = document.getElementById('whiteBalanceSlider');
    const resetBrightnessBtn  = document.getElementById('resetBrightnessBtn');
    const resetContrastBtn    = document.getElementById('resetContrastBtn');
    const resetWhiteBalanceBtn= document.getElementById('resetWhiteBalanceBtn');
    const cancelOptionsBtn    = document.getElementById('cancelOptionsBtn');
    const resetOptionsBtn     = document.getElementById('ResetOptionsBtn');
    const optimizeBtn         = document.getElementById('optimizeBtn');
    const confirmOptionsBtn   = document.getElementById('confirmOptionsBtn');
    const documentEnhancerBtn = document.getElementById('DocumentEnhancerBtn');
    const pictureBtn          = document.getElementById('pictureBtn');
    const panelEdit           = document.getElementById('panelEdit');
    const panelColor          = document.getElementById('panelColor');
    const cropHandlesOverlay  = document.getElementById('cropHandlesOverlay');
    const tabBtns             = document.querySelectorAll('.tab-btn');

    // ── State ─────────────────────────────────────────────────────
    let currentThumbnail    = null;
    let originalImageData   = null;
    let currentRotation     = 0;
    let currentZoom         = 1;
    let currentBrightness   = 0;
    let currentContrast     = 0;
    let currentWhiteBalance = 0;
    let zoomState           = 0;
    let isDocumentEnhanced  = false;
    let isAutoOptimized     = false;

    // Crop fractions (0 = no crop, 0.3 = 30% trimmed from that edge)
    let currentCropTop    = 0;
    let currentCropBottom = 0;
    let currentCropLeft   = 0;
    let currentCropRight  = 0;

    // Touch / pan state
    let isDragging    = false;
    let startX        = 0;
    let startY        = 0;
    let translateX    = 0;
    let translateY    = 0;
    let startDistance = 0;
    let startZoom     = 1;
    let lastTap       = 0;

    // ── Tab switching ─────────────────────────────────────────────
    function switchTab(tabName) {
        tabBtns.forEach(btn =>
            btn.classList.toggle('tab-active', btn.dataset.tab === tabName)
        );
        panelEdit.style.display   = tabName === 'edit'  ? 'block' : 'none';
        panelColor.style.display  = tabName === 'color' ? 'block' : 'none';
        // Show crop handles only in the Edit tab
        cropHandlesOverlay.style.display = tabName === 'edit' ? 'block' : 'none';
    }

    tabBtns.forEach(btn =>
        btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    );

    // ── Crop-handle overlay positioning ──────────────────────────
    function getImageDisplayBounds() {
        const container = document.getElementById('optionsImageContainer');
        const cW = container.clientWidth;
        const cH = container.clientHeight;
        const iW = optionsImage.naturalWidth  || cW;
        const iH = optionsImage.naturalHeight || cH;
        const scale = Math.min(cW / iW, cH / iH);
        const dW = iW * scale;
        const dH = iH * scale;
        return { x: (cW - dW) / 2, y: (cH - dH) / 2, w: dW, h: dH };
    }

    function positionCropOverlay() {
        const b = getImageDisplayBounds();
        cropHandlesOverlay.style.left   = b.x + 'px';
        cropHandlesOverlay.style.top    = b.y + 'px';
        cropHandlesOverlay.style.width  = b.w + 'px';
        cropHandlesOverlay.style.height = b.h + 'px';
        updateCropVisuals();
    }

    function updateCropVisuals() {
        const topPct    = (currentCropTop    * 100).toFixed(2) + '%';
        const bottomPct = (currentCropBottom * 100).toFixed(2) + '%';
        const leftPct   = (currentCropLeft   * 100).toFixed(2) + '%';
        const rightPct  = (currentCropRight  * 100).toFixed(2) + '%';

        cropHandlesOverlay.querySelector('.crop-shade-top'   ).style.height = topPct;
        cropHandlesOverlay.querySelector('.crop-shade-bottom').style.height = bottomPct;
        cropHandlesOverlay.querySelector('.crop-shade-left'  ).style.width  = leftPct;
        cropHandlesOverlay.querySelector('.crop-shade-right' ).style.width  = rightPct;
        // Left/right shades should sit between the top and bottom crop lines
        cropHandlesOverlay.querySelector('.crop-shade-left'  ).style.top    = topPct;
        cropHandlesOverlay.querySelector('.crop-shade-left'  ).style.bottom = bottomPct;
        cropHandlesOverlay.querySelector('.crop-shade-right' ).style.top    = topPct;
        cropHandlesOverlay.querySelector('.crop-shade-right' ).style.bottom = bottomPct;

        cropHandlesOverlay.querySelector('.crop-line-top'   ).style.top    = topPct;
        cropHandlesOverlay.querySelector('.crop-line-bottom').style.bottom = bottomPct;
        cropHandlesOverlay.querySelector('.crop-line-left'  ).style.left   = leftPct;
        cropHandlesOverlay.querySelector('.crop-line-right' ).style.right  = rightPct;
    }

    function setupCropHandles() {
        ['top', 'bottom', 'left', 'right'].forEach(side => {
            const line = cropHandlesOverlay.querySelector('.crop-line-' + side);
            if (!line) return;

            let dragging    = false;
            let startPos    = 0;
            let startCropVal = 0;

            function onStart(e) {
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                const pt = e.touches ? e.touches[0] : e;
                startPos     = (side === 'top' || side === 'bottom') ? pt.clientY : pt.clientX;
                startCropVal = { top: currentCropTop, bottom: currentCropBottom,
                                 left: currentCropLeft, right: currentCropRight }[side];
                document.addEventListener('mousemove', onMove, { passive: false });
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('mouseup',   onEnd);
                document.addEventListener('touchend',  onEnd);
            }

            function onMove(e) {
                if (!dragging) return;
                e.preventDefault();
                const pt = e.touches ? e.touches[0] : e;
                let delta;
                if (side === 'top' || side === 'bottom') {
                    const raw = (pt.clientY - startPos) / cropHandlesOverlay.offsetHeight;
                    delta = side === 'top' ? raw : -raw;
                } else {
                    const raw = (pt.clientX - startPos) / cropHandlesOverlay.offsetWidth;
                    delta = side === 'left' ? raw : -raw;
                }
                const newVal = Math.max(0, Math.min(0.75, startCropVal + delta));
                switch (side) {
                    case 'top':    currentCropTop    = Math.min(newVal, 1 - currentCropBottom - 0.05); break;
                    case 'bottom': currentCropBottom = Math.min(newVal, 1 - currentCropTop    - 0.05); break;
                    case 'left':   currentCropLeft   = Math.min(newVal, 1 - currentCropRight  - 0.05); break;
                    case 'right':  currentCropRight  = Math.min(newVal, 1 - currentCropLeft   - 0.05); break;
                }
                updateCropVisuals();
            }

            function onEnd() {
                dragging = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('mouseup',   onEnd);
                document.removeEventListener('touchend',  onEnd);
            }

            line.addEventListener('mousedown',  onStart);
            line.addEventListener('touchstart', onStart, { passive: false });
        });
    }

    // ── Image adjustments (CSS only – preview) ────────────────────
    function applyImageAdjustments() {
        optionsImage.style.transform =
            `rotate(${currentRotation}deg) scale(${currentZoom}) translate(${translateX}px, ${translateY}px)`;

        const filters = [];
        if (currentBrightness   !== 0) filters.push(`brightness(${100 + currentBrightness}%)`);
        if (currentContrast     !== 0) filters.push(`contrast(${100 + currentContrast}%)`);
        if (currentWhiteBalance !== 0) {
            const sep = currentWhiteBalance > 0 ? currentWhiteBalance / 2 : 0;
            const hue = currentWhiteBalance < 0 ? Math.abs(currentWhiteBalance) * 1.8 : 0;
            if (sep > 0) filters.push(`sepia(${sep}%)`);
            if (hue > 0) filters.push(`hue-rotate(${hue}deg)`);
        }
        optionsImage.style.filter = filters.length ? filters.join(' ') : 'none';
    }

    // ── Document enhancement ──────────────────────────────────────
    function enhanceDocument(imageElement, options = {}) {
        const {
            brightenFactor = 1.4,
            luminanceThreshold = 160,
            saturationThreshold = 0.2
        } = options;

        const c = document.createElement('canvas');
        const cx = c.getContext('2d');
        c.width = imageElement.width;
        c.height = imageElement.height;
        cx.drawImage(imageElement, 0, 0);
        const id = cx.getImageData(0, 0, c.width, c.height);
        const px = id.data;

        // White-balance pass
        let sumR = 0, sumG = 0, sumB = 0;
        for (let i = 0; i < px.length; i += 4) { sumR += px[i]; sumG += px[i+1]; sumB += px[i+2]; }
        const cnt = px.length / 4;
        const gray = (sumR + sumG + sumB) / (3 * cnt);
        const sR = gray / (sumR / cnt), sG = gray / (sumG / cnt), sB = gray / (sumB / cnt);
        for (let i = 0; i < px.length; i += 4) {
            px[i]   = Math.min(255, Math.max(0, px[i]   * sR));
            px[i+1] = Math.min(255, Math.max(0, px[i+1] * sG));
            px[i+2] = Math.min(255, Math.max(0, px[i+2] * sB));
        }

        // Brighten background pass
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i+1], b = px[i+2];
            const lum = 0.299*r + 0.587*g + 0.114*b;
            const sat = (Math.max(r,g,b) - Math.min(r,g,b)) / (Math.max(r,g,b) || 1);
            if (lum > luminanceThreshold && sat < saturationThreshold) {
                px[i]   = Math.min(255, r * brightenFactor);
                px[i+1] = Math.min(255, g * brightenFactor);
                px[i+2] = Math.min(255, b * brightenFactor);
            }
        }

        cx.putImageData(id, 0, 0);
        return c.toDataURL();
    }

    function applyDocumentEnhancementDefault() {
        const tmp = new Image();
        tmp.onload = function() {
            const enhanced = enhanceDocument(tmp, {
                brightenFactor: 1.5, luminanceThreshold: 150, saturationThreshold: 0.25
            });
            isDocumentEnhanced = true;
            optionsImage.src = enhanced;
            updateButtonStates();
        };
        tmp.src = originalImageData;
    }

    function toggleDocumentEnhancement() {
        if (isDocumentEnhanced) {
            isDocumentEnhanced = false;
            optionsImage.src = originalImageData;
            applyImageAdjustments();
            updateButtonStates();
        } else {
            const tmp = new Image();
            tmp.onload = function() {
                const enhanced = enhanceDocument(tmp, {
                    brightenFactor: 1.5, luminanceThreshold: 150, saturationThreshold: 0.25
                });
                isDocumentEnhanced = true;
                optionsImage.src = enhanced;
                applyImageAdjustments();
                updateButtonStates();
            };
            tmp.src = optionsImage.src;
        }
    }

    // ── Auto-optimize ─────────────────────────────────────────────
    function toggleAutoOptimize() {
        if (isAutoOptimized) {
            isAutoOptimized = false;
            currentBrightness = currentContrast = currentWhiteBalance = 0;
            brightnessSlider.value = contrastSlider.value = whiteBalanceSlider.value = 0;
        } else {
            isAutoOptimized = true;
            currentBrightness = 10; currentContrast = 15; currentWhiteBalance = 5;
            brightnessSlider.value   = currentBrightness;
            contrastSlider.value     = currentContrast;
            whiteBalanceSlider.value = currentWhiteBalance;
        }
        applyImageAdjustments();
        updateButtonStates();
    }

    // ── Button state sync ─────────────────────────────────────────
    function updateButtonStates() {
        documentEnhancerBtn.classList.toggle('active',  isDocumentEnhanced);
        if (pictureBtn) pictureBtn.classList.toggle('active', !isDocumentEnhanced);
        optimizeBtn.classList.toggle('active', isAutoOptimized);
    }

    // ── Reset all ─────────────────────────────────────────────────
    function resetControls() {
        currentRotation = 0; currentZoom = 1; zoomState = 0;
        currentBrightness = 0; currentContrast = 0; currentWhiteBalance = 0;
        isDocumentEnhanced = false; isAutoOptimized = false;
        currentCropTop = 0; currentCropBottom = 0;
        currentCropLeft = 0; currentCropRight = 0;
        translateX = 0; translateY = 0;

        brightnessSlider.value = 0;
        contrastSlider.value   = 0;
        whiteBalanceSlider.value = 0;
        optionsImage.style.transform = 'none';

        if (originalImageData) optionsImage.src = originalImageData;
        switchTab('edit');
        updateCropVisuals();
        updateButtonStates();
    }

    // ── Process image: rotation → crop → pixel adjustments ────────
    async function processImage() {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = function () {
                // Step 1: rotation
                const is90 = Math.abs(currentRotation % 180) === 90;
                const rotC = document.createElement('canvas');
                rotC.width  = is90 ? img.height : img.width;
                rotC.height = is90 ? img.width  : img.height;
                const rotCtx = rotC.getContext('2d');
                rotCtx.save();
                rotCtx.translate(rotC.width / 2, rotC.height / 2);
                rotCtx.rotate(currentRotation * Math.PI / 180);
                rotCtx.drawImage(img, -img.width / 2, -img.height / 2);
                rotCtx.restore();

                // Step 2: margin crop
                let workC, workCtx;
                const hasCrop = currentCropTop > 0 || currentCropBottom > 0 ||
                                currentCropLeft > 0 || currentCropRight > 0;
                if (hasCrop) {
                    const cX = Math.round(currentCropLeft   * rotC.width);
                    const cY = Math.round(currentCropTop    * rotC.height);
                    const cW = Math.max(1, Math.round(rotC.width  * (1 - currentCropLeft - currentCropRight)));
                    const cH = Math.max(1, Math.round(rotC.height * (1 - currentCropTop  - currentCropBottom)));
                    workC = document.createElement('canvas');
                    workC.width = cW; workC.height = cH;
                    workCtx = workC.getContext('2d');
                    workCtx.drawImage(rotC, cX, cY, cW, cH, 0, 0, cW, cH);
                } else {
                    workC = rotC;
                    workCtx = rotCtx;
                }

                // Step 3: pixel adjustments
                if (currentBrightness !== 0 || currentContrast !== 0 || currentWhiteBalance !== 0) {
                    const id = workCtx.getImageData(0, 0, workC.width, workC.height);
                    const d  = id.data;
                    for (let i = 0; i < d.length; i += 4) {
                        let r = d[i], g = d[i+1], b = d[i+2];
                        if (currentBrightness !== 0) {
                            const f = 1 + currentBrightness / 100;
                            r = Math.min(255, Math.max(0, r * f));
                            g = Math.min(255, Math.max(0, g * f));
                            b = Math.min(255, Math.max(0, b * f));
                        }
                        if (currentContrast !== 0) {
                            const f = (259 * (currentContrast + 100)) / (100 * (259 - currentContrast));
                            r = Math.min(255, Math.max(0, f * (r - 128) + 128));
                            g = Math.min(255, Math.max(0, f * (g - 128) + 128));
                            b = Math.min(255, Math.max(0, f * (b - 128) + 128));
                        }
                        if (currentWhiteBalance !== 0) {
                            if (currentWhiteBalance > 0) {
                                const f = currentWhiteBalance / 100;
                                r = Math.min(255, r * (1 + f * 0.3));
                                b = Math.max(0,   b * (1 - f * 0.2));
                            } else {
                                const f = Math.abs(currentWhiteBalance) / 100;
                                b = Math.min(255, b * (1 + f * 0.3));
                                r = Math.max(0,   r * (1 - f * 0.2));
                            }
                        }
                        d[i] = r; d[i+1] = g; d[i+2] = b;
                    }
                    workCtx.putImageData(id, 0, 0);
                }

                resolve(workC.toDataURL('image/jpeg', 0.95));
            };
            img.onerror = reject;
            img.src = optionsImage.src;
        });
    }

    // ── Init ──────────────────────────────────────────────────────
    function initOptionsOverlay(imageData, sourceThumbnail) {
        currentThumbnail  = sourceThumbnail;
        originalImageData = imageData;

        resetControls();
        optionsImage.src = imageData;
        optionsOverlay.style.display = 'block';

        // After image loads: position overlay, then auto-apply document enhancement
        optionsImage.addEventListener('load', function onLoad() {
            positionCropOverlay();
            // Collegare: Bild bleibt wie aufgenommen; aufbereitet wird erst vor der Texterkennung (Wunsch Jo)
            if (window.SCANNER_ZIEL && window.SCANNER_ZIEL.dokumentfilter === false) updateButtonStates();
            else applyDocumentEnhancementDefault();
        }, { once: true });

        applyImageAdjustments();
    }

    // ── Event listeners ───────────────────────────────────────────

    rotateLeftBtn.addEventListener('click', function () {
        currentRotation = (currentRotation - 90) % 360;
        applyImageAdjustments();
    });

    brightnessSlider.addEventListener('input', function () {
        currentBrightness = parseInt(this.value);
        isAutoOptimized = false; updateButtonStates(); applyImageAdjustments();
    });
    contrastSlider.addEventListener('input', function () {
        currentContrast = parseInt(this.value);
        isAutoOptimized = false; updateButtonStates(); applyImageAdjustments();
    });
    whiteBalanceSlider.addEventListener('input', function () {
        currentWhiteBalance = parseInt(this.value);
        isAutoOptimized = false; updateButtonStates(); applyImageAdjustments();
    });

    resetBrightnessBtn.addEventListener('click', function () {
        brightnessSlider.value = 0; currentBrightness = 0;
        isAutoOptimized = false; updateButtonStates(); applyImageAdjustments();
    });
    resetContrastBtn.addEventListener('click', function () {
        contrastSlider.value = 0; currentContrast = 0;
        isAutoOptimized = false; updateButtonStates(); applyImageAdjustments();
    });
    resetWhiteBalanceBtn.addEventListener('click', function () {
        whiteBalanceSlider.value = 0; currentWhiteBalance = 0;
        isAutoOptimized = false; updateButtonStates(); applyImageAdjustments();
    });

    optimizeBtn.addEventListener('click', toggleAutoOptimize);
    documentEnhancerBtn.addEventListener('click', toggleDocumentEnhancement);

    if (pictureBtn) {
        pictureBtn.addEventListener('click', function () {
            if (isDocumentEnhanced) {
                isDocumentEnhanced = false;
                optionsImage.src = originalImageData;
                applyImageAdjustments();
                updateButtonStates();
            }
        });
    }

    resetOptionsBtn.addEventListener('click', function () {
        resetControls();
        optionsImage.addEventListener('load', function onLoad() {
            positionCropOverlay();
            // Collegare: Bild bleibt wie aufgenommen; aufbereitet wird erst vor der Texterkennung (Wunsch Jo)
            if (window.SCANNER_ZIEL && window.SCANNER_ZIEL.dokumentfilter === false) updateButtonStates();
            else applyDocumentEnhancementDefault();
        }, { once: true });
        optionsImage.src = originalImageData;
        applyImageAdjustments();
    });

    cancelOptionsBtn.addEventListener('click', function () {
        optionsOverlay.style.display = 'none';
        resetControls();
    });

    // "Perspektive" button → send processed image to correction overlay
    cropBtn.addEventListener('click', async function () {
        try {
            const processed = await processImage();
            optionsOverlay.style.display = 'none';
            if (typeof window.showCorrection === 'function') {
                window.showCorrection(processed);
            } else {
                throw new Error('showCorrection not found');
            }
        } catch (err) {
            console.error('Error sending to correction:', err);
            alert('Fehler beim Zuschneiden. Bitte erneut versuchen.');
        }
    });

    confirmOptionsBtn.addEventListener('click', async function () {
        try {
            confirmOptionsBtn.disabled = true;
            const processed = await processImage();
            if (currentThumbnail && typeof window.addThumbnail === 'function') {
                await window.addThumbnail(processed);
            } else {
                throw new Error('Cannot update thumbnail');
            }
            optionsOverlay.style.display = 'none';
            resetControls();
        } catch (err) {
            console.error('Error saving image:', err);
            alert('Fehler beim Speichern. Bitte erneut versuchen.');
        } finally {
            confirmOptionsBtn.disabled = false;
        }
    });

    // ── Touch gestures on image (pinch-zoom + pan + double-tap reset) ──
    optionsImage.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
            startDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            startZoom = currentZoom;
            e.preventDefault();
        } else if (e.touches.length === 1) {
            isDragging = true;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            e.preventDefault();
        }
    });
    optionsImage.addEventListener('touchmove', function (e) {
        if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            currentZoom = Math.min(3, Math.max(0.5, startZoom * (dist / startDistance)));
            applyImageAdjustments();
            e.preventDefault();
        } else if (isDragging && e.touches.length === 1) {
            translateX += e.touches[0].clientX - startX;
            translateY += e.touches[0].clientY - startY;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            applyImageAdjustments();
            e.preventDefault();
        }
    });
    optionsImage.addEventListener('touchend', function (e) {
        isDragging = false;
        const now = Date.now();
        if (now - lastTap < 300 && e.touches.length === 0) {
            translateX = 0; translateY = 0; currentZoom = 1; zoomState = 0;
            applyImageAdjustments();
            e.preventDefault();
        }
        lastTap = now;
    });

    // ── Boot ──────────────────────────────────────────────────────
    setupCropHandles();
    window.showOptions = initOptionsOverlay;
});
