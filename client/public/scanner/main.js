// main.js
document.addEventListener('DOMContentLoaded', function() {
    const thumbnailGrid = document.getElementById('thumbnailGrid');
    const uploadBtn = document.getElementById('uploadBtn');
    const pdfNameInput = document.getElementById('pdfName');
    const emptyState = document.getElementById('emptyState');
    let thumbnails = [];
    let currentlyEditingThumbnail = null;
    let touchStartTime = 0;
    let touchStartPosition = { x: 0, y: 0 };

    // Gallery upload setup with improved mobile support
    function setupGalleryUpload() {
        const galleryBtn = document.querySelector('.gallery-add');
        if (!galleryBtn) return; // gallery disabled – nothing to set up
        
        function handleGalleryClick(e) {
            e.stopPropagation();
            
            // Create temporary file input
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.multiple = true;
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);

            // Handle file selection
            fileInput.addEventListener('change', (event) => {
                const files = event.target.files;
                if (files && files.length) {
                    Array.from(files).forEach(file => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            showCorrection(e.target.result);
                        };
                        reader.readAsDataURL(file);
                    });
                }
                // Clean up
                document.body.removeChild(fileInput);
            }, { once: true }); // Remove listener after use

            // Trigger file selection
            fileInput.click();
        }

        // Add click handler
        galleryBtn.addEventListener('click', handleGalleryClick);

        // Add touch handler specifically for mobile
        galleryBtn.addEventListener('touchend', (e) => {
            e.preventDefault(); // Prevent ghost click
            handleGalleryClick(e);
        });
    }

    // Camera button handler (footer button)
    function setupCameraButton() {
        const cameraBtn = document.getElementById('cameraFooterBtn');
        if (!cameraBtn) return;
        // touch-action: manipulation on the footer removes the 300ms delay,
        // so a plain click handler is sufficient and avoids touchend quirks on iOS.
        cameraBtn.addEventListener('click', () => showCamera());
    }

    // Instructions icon (empty state, above "Anleitung"): same action as the
    // footer camera button, just reachable directly from the instructions.
    function setupEmptyStateCameraButton() {
        const btn = document.getElementById('emptyStateCameraBtn');
        if (!btn) return;
        btn.addEventListener('click', () => showCamera());
    }

    // Upload button handler
    function setupUploadButton() {
        uploadBtn.addEventListener('click', uploadImages);
        uploadBtn.addEventListener('touchend', (e) => {
            e.preventDefault(); // Prevent ghost click
            uploadImages();
        });
    }

    function addThumbnail(imageUrl, checked = true) {
        const thumbnail = document.createElement('div');
        thumbnail.className = `thumbnail ${checked ? 'checked' : ''}`;
        thumbnail.innerHTML = `
            <img src="${imageUrl}" alt="Scanned page">
            <input type="checkbox" class="thumbnail-checkbox" ${checked ? 'checked' : ''}>
            <button class="thumbnail-delete">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" 
                     stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18"></path>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
            </button>
        `;

        // Image interaction handler with improved touch detection
        const img = thumbnail.querySelector('img');
        
        // Touch start handler
        img.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            touchStartPosition = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY
            };
        });

        // Touch end handler with movement detection
        img.addEventListener('touchend', (e) => {
            const touchEndTime = Date.now();
            const touchDuration = touchEndTime - touchStartTime;
            
            // Get touch end position
            const touchEndPosition = {
                x: e.changedTouches[0].clientX,
                y: e.changedTouches[0].clientY
            };
            
            // Calculate movement
            const movement = Math.sqrt(
                Math.pow(touchEndPosition.x - touchStartPosition.x, 2) +
                Math.pow(touchEndPosition.y - touchStartPosition.y, 2)
            );

            // Only trigger if touch was short and movement was minimal
            if (touchDuration < 200 && movement < 10) {
                e.preventDefault();
                currentlyEditingThumbnail = thumbnail;
                
                // MODIFICATION: Show options overlay instead of correction
                if (typeof window.showOptions === 'function') {
                    window.showOptions(img.src, thumbnail);
                } else {
                    console.error('showOptions function not available');
                }
            }
        });

        // Click handler for desktop
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            currentlyEditingThumbnail = thumbnail;
            
            // MODIFICATION: Show options overlay instead of correction
            if (typeof window.showOptions === 'function') {
                window.showOptions(img.src, thumbnail);
            } else {
                console.error('showOptions function not available');
            }
        });

        // Rest of the function remains unchanged
        const checkbox = thumbnail.querySelector('.thumbnail-checkbox');
        checkbox.addEventListener('change', (e) => {
            const thumbnailEl = e.target.closest('.thumbnail');
            thumbnailEl.classList.toggle('checked', checkbox.checked);
            updateThumbnailOrder();
            updateExportControls();
        });

        const deleteBtn = thumbnail.querySelector('.thumbnail-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteThumbnail(thumbnail);
        });

        if (currentlyEditingThumbnail) {
            currentlyEditingThumbnail.replaceWith(thumbnail);
            const index = thumbnails.indexOf(currentlyEditingThumbnail);
            if (index !== -1) {
                thumbnails[index] = thumbnail;
            }
            currentlyEditingThumbnail = null;
        } else {
            thumbnailGrid.insertBefore(thumbnail, document.querySelector('.add-buttons-container'));
            thumbnails.push(thumbnail);
        }

        updateThumbnailOrder();
        updateExportControls();

        return thumbnail;
    }

    function updateThumbnailOrder() {
        const allThumbnails = Array.from(thumbnailGrid.querySelectorAll('.thumbnail'));
        const checkedThumbnails = allThumbnails.filter(t => t.querySelector('.thumbnail-checkbox').checked);
        const uncheckedThumbnails = allThumbnails.filter(t => !t.querySelector('.thumbnail-checkbox').checked);
        
        allThumbnails.forEach(t => t.remove());
        
        checkedThumbnails.forEach(t => {
            thumbnailGrid.insertBefore(t, document.querySelector('.add-buttons-container'));
        });
        
        uncheckedThumbnails.forEach(t => {
            thumbnailGrid.insertBefore(t, document.querySelector('.add-buttons-container'));
        });
    }

    function deleteThumbnail(thumbnail) {
        thumbnail.remove();
        thumbnails = thumbnails.filter(t => t !== thumbnail);
        updateExportControls();
    }

    function updateExportControls() {
        const hasCheckedThumbnails = thumbnails.some(t =>
            t.querySelector('.thumbnail-checkbox').checked
        );
        // Show upload button in footer only when there are checked thumbnails
        uploadBtn.style.display = hasCheckedThumbnails ? 'flex' : 'none';
        // Show instructions only when no thumbnails exist at all
        if (emptyState) {
            emptyState.style.display = thumbnails.length === 0 ? 'flex' : 'none';
        }
    }

    function showCamera() {
        const cameraOverlay = document.getElementById('cameraOverlay');
        cameraOverlay.style.display = 'block';
        
        if (window.reinitializeCamera) {
            window.reinitializeCamera();
        }
    }

    function showCorrection(imageData) {
        let correctionOverlay = document.getElementById('correctionOverlay');
        
        if (typeof window.initCorrection !== 'function') {
            console.error('initCorrection method is not available');
            return;
        }
        
        if (!correctionOverlay) {
            correctionOverlay = document.createElement('div');
            correctionOverlay.id = 'correctionOverlay';
            correctionOverlay.className = 'overlay';
            correctionOverlay.style.display = 'none';
            document.body.appendChild(correctionOverlay);
            
            fetch('scanner/correction-overlay.html')
                .then(response => response.text())
                .then(html => {
                    correctionOverlay.innerHTML = html;
                    correctionOverlay.style.display = 'block';
                    window.initCorrection(imageData);
                });
        } else {
            correctionOverlay.style.display = 'block';
            window.initCorrection(imageData);
        }
    }

    // ── Autogra.fi-Kern ─────────────────────────────────────────────────
    // Einzige Änderung gegenüber dem alten Scanner: Hochladen läuft über die
    // Gerätekopplung (device.js) statt über upload.php, und danach bleibt der
    // Scanner offen, damit weitere Seiten aufgenommen werden können.
    const uploadBtnOriginalHTML = uploadBtn.innerHTML;

    function uploadImages() {
        if (uploadBtn.disabled) return;
        const checkedThumbnails = Array.from(thumbnailGrid.querySelectorAll('.thumbnail.checked'));
        if (checkedThumbnails.length === 0) {
            alert('Keine Bilder ausgewählt.');
            return;
        }
        if (window.AutografiQuality && !window.AutografiQuality.confirmUpload(checkedThumbnails)) return;
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Wird hochgeladen …';
        const images = checkedThumbnails.map(t => t.querySelector('img').src);
        window.AutografiDevice.upload(images, (done, total) => {
            uploadBtn.textContent = `Wird hochgeladen … ${done}/${total}`;
        }).then(() => {
            checkedThumbnails.forEach(deleteThumbnail);
            window.AutografiDevice.showDone(checkedThumbnails.length);
        }).catch(error => {
            alert('Hochladen fehlgeschlagen: ' + error.message);
        }).finally(() => {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = uploadBtnOriginalHTML;
        });
    }

    // Sortable drag-to-reorder (gracefully skipped if the script failed to load)
    if (typeof Sortable !== 'undefined') {
        new Sortable(thumbnailGrid, {
            animation: 150,
            handle: '.thumbnail',
            filter: '.add-buttons-container',
            onSort: updateExportControls
        });
    }

    // Call setup functions
    setupGalleryUpload();
    setupCameraButton();
    setupEmptyStateCameraButton();
    setupUploadButton();
    updateExportControls(); // set initial state (show instructions, hide upload)

    // Make functions available globally
    window.addThumbnail = addThumbnail;
    window.showCorrection = showCorrection;
    window.showCamera = showCamera;
    window.setupGalleryUpload = setupGalleryUpload;
    window.uploadImages = uploadImages;
});