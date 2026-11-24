// camera.js

document.addEventListener('DOMContentLoaded', function() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const captureBtn = document.getElementById('captureBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const autoBtn = document.getElementById('autoBtn');
    const torchBtn = document.getElementById('torchBtn');
    let stream = null;
    let autoDetectEnabled = false;
    let documentStillTimeout = null;

    // Blendet den Blitz-Button je nach Fähigkeit des übergebenen Tracks ein/aus
    // und verdrahtet ihn neu. Eigene Funktion, weil das nach jedem Kamerawechsel
    // erneut passieren muss (z.B. Frontkamera hat i.d.R. keinen Blitz).
    function wireTorchButton(track) {
        if (!torchBtn) return;
        if (track.getCapabilities && track.getCapabilities().torch) {
            torchBtn.style.display = 'block';
            let torchOn = false;
            torchBtn.onclick = async () => {
                torchOn = !torchOn;
                await track.applyConstraints({ advanced: [{ torch: torchOn }] });
                torchBtn.classList.toggle('active', torchOn);
            };
        } else {
            torchBtn.style.display = 'none';
            torchBtn.onclick = null;
        }
    }

    // Baut die Basis-Videoconstraints (Auflösung + optionale erweiterte Modi).
    function buildBaseVideoConstraints() {
        const supported = navigator.mediaDevices.getSupportedConstraints();
        return {
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            ...(supported.exposureMode ? { exposureMode: 'manual' } : {}),
            ...(supported.whiteBalanceMode ? { whiteBalanceMode: 'manual' } : {}),
            ...(supported.focusMode ? { focusMode: 'continuous' } : {})
        };
    }

function drawDocumentCornerMarks() {
    // Create an overlay div for corner marks
    const cornerMarksOverlay = document.createElement('div');
    cornerMarksOverlay.id = 'cornerMarksOverlay';
    cornerMarksOverlay.style.position = 'absolute';
    cornerMarksOverlay.style.top = '0';
    cornerMarksOverlay.style.left = '0';
    cornerMarksOverlay.style.width = '100%';
    cornerMarksOverlay.style.height = '100%';
    cornerMarksOverlay.style.pointerEvents = 'none';
    cornerMarksOverlay.style.zIndex = '1000';
    
    const cameraOverlay = document.getElementById('cameraOverlay');
    cameraOverlay.appendChild(cornerMarksOverlay);
    
    // Calculate positions for A4 document (aspect ratio 1:1.414)
    const updateCornerMarks = () => {
        const videoRect = video.getBoundingClientRect();
        const isLandscape = videoRect.width > videoRect.height;
        
        let docWidth, docHeight;
        const borderPadding = 20; // Small border padding
        
        if (isLandscape) {
            // In landscape, height is the limiting factor
            docHeight = videoRect.height - (borderPadding * 2);
            docWidth = docHeight / 1.414; // A4 ratio
        } else {
            // In portrait, width is the limiting factor
            docWidth = videoRect.width - (borderPadding * 2);
            docHeight = docWidth * 1.414; // A4 ratio
        }
        
        // Calculate positions
        const left = (videoRect.width - docWidth) / 2;
        const top = (videoRect.height - docHeight) / 2;
        const right = left + docWidth;
        const bottom = top + docHeight;
        
        // Store the normalized corner positions for later use
        window.documentCorners = [
            { x: left / videoRect.width, y: top / videoRect.height },           // Top-left
            { x: right / videoRect.width, y: top / videoRect.height },          // Top-right
            { x: right / videoRect.width, y: bottom / videoRect.height },       // Bottom-right
            { x: left / videoRect.width, y: bottom / videoRect.height }         // Bottom-left
        ];
        
        // Clear previous marks
        cornerMarksOverlay.innerHTML = '';
        
        // Create and position corner marks
        const cornerPositions = [
            { x: left, y: top },            // Top-left
            { x: right, y: top },           // Top-right
            { x: right, y: bottom },        // Bottom-right
            { x: left, y: bottom }          // Bottom-left
        ];
        
        cornerPositions.forEach((pos, index) => {
            const cornerMark = document.createElement('div');
            cornerMark.className = 'corner-mark';
            cornerMark.style.position = 'absolute';
            cornerMark.style.width = '20px';
            cornerMark.style.height = '20px';
            cornerMark.style.borderStyle = 'solid';
            cornerMark.style.borderColor = '#2196F3';
            cornerMark.style.borderWidth = '0';
            
            // Different border styling for each corner
            switch(index) {
                case 0: // Top-left
                    cornerMark.style.borderLeftWidth = '3px';
                    cornerMark.style.borderTopWidth = '3px';
                    cornerMark.style.left = `${pos.x}px`;
                    cornerMark.style.top = `${pos.y}px`;
                    break;
                case 1: // Top-right
                    cornerMark.style.borderRightWidth = '3px';
                    cornerMark.style.borderTopWidth = '3px';
                    cornerMark.style.left = `${pos.x - 20}px`;
                    cornerMark.style.top = `${pos.y}px`;
                    break;
                case 2: // Bottom-right
                    cornerMark.style.borderRightWidth = '3px';
                    cornerMark.style.borderBottomWidth = '3px';
                    cornerMark.style.left = `${pos.x - 20}px`;
                    cornerMark.style.top = `${pos.y - 20}px`;
                    break;
                case 3: // Bottom-left
                    cornerMark.style.borderLeftWidth = '3px';
                    cornerMark.style.borderBottomWidth = '3px';
                    cornerMark.style.left = `${pos.x}px`;
                    cornerMark.style.top = `${pos.y - 20}px`;
                    break;
            }
            
            cornerMarksOverlay.appendChild(cornerMark);
        });
    };
    
    // Initial update
    updateCornerMarks();
    
    // Update on resize or orientation change
    window.addEventListener('resize', updateCornerMarks);
    window.addEventListener('orientationchange', updateCornerMarks);
    
    // Also update when video metadata is loaded
    video.addEventListener('loadedmetadata', updateCornerMarks);
}

function captureImage() {
    if (!stream) {
        alert('Camera not available');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw at full resolution
    ctx.drawImage(video, 0, 0);
    
    // Apply sharpening filter
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applySharpening(imageData);
    ctx.putImageData(imageData, 0, 0);
    
    // Convert to high-quality JPEG
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95); // Higher quality setting
    
    // Get the corner positions if available
    const cornerPositions = window.documentCorners || null;
    
    stopCamera();
    
    // Show the correction overlay
    const correctionOverlay = document.getElementById('correctionOverlay');
    if (correctionOverlay) {
        correctionOverlay.style.display = 'block';
        
        // Initialize correction with corner positions
        if (typeof window.initCorrection === 'function') {
            window.initCorrection(imageDataUrl, cornerPositions)
                .catch(err => {
                    console.error('Error initializing correction:', err);
                    alert('Error initializing correction. Please try again.');
                    correctionOverlay.style.display = 'none';
                });
        } else {
            console.error('initCorrection function not found');
            alert('Could not initialize document correction.');
        }
    } else {
        console.error('Correction overlay not found');
        
        // Fallback - display the image somewhere
        const img = new Image();
        img.src = imageDataUrl;
        document.body.appendChild(img);
    }
}

    async function initializeCamera() {
        try {
            // Check if mediaDevices API is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                // Fallback for older browsers
                const getUserMedia = navigator.getUserMedia ||
                                    navigator.webkitGetUserMedia ||
                                    navigator.mozGetUserMedia ||
                                    navigator.msGetUserMedia;
                
                if (!getUserMedia) {
                    throw new Error('Camera API not supported in this browser');
                }
                
                // Check if we're on a secure context
                if (window.location.protocol !== 'https:' && 
                    window.location.hostname !== 'localhost' && 
                    window.location.hostname !== '127.0.0.1') {
                    throw new Error('Camera access requires HTTPS (except on localhost)');
                }
            }

            stream = await navigator.mediaDevices.getUserMedia({
                video: { ...buildBaseVideoConstraints(), facingMode: 'environment' },
                audio: false
            });
            video.srcObject = stream;

            // Get actual stream settings
            const track = stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities ? track.getCapabilities() : {};
            const settings = track.getSettings ? track.getSettings() : {};

            console.log('Camera capabilities:', capabilities);
            console.log('Active settings:', settings);

            wireTorchButton(track);

            video.style.display = 'block';

            // Set canvas to match camera resolution, not display resolution
            video.onloadedmetadata = () => {
                const aspectRatio = video.videoWidth / video.videoHeight;

                // Use maximum resolution available
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                console.log(`Camera resolution: ${canvas.width}x${canvas.height}`);
            };

            if (autoDetectEnabled) {
                requestAnimationFrame(detectDocument);
            }

            drawDocumentCornerMarks();
        } catch (err) {
            console.error('Error accessing camera:', err);
            
            // More user-friendly error message based on the specific issue
            let errorMessage = 'Camera could not be activated';
            
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                errorMessage = 'Camera access denied. Please allow camera access in your browser settings.';
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                errorMessage = 'No camera found on this device.';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                errorMessage = 'Camera is in use by another application.';
            } else if (err.message.includes('HTTPS')) {
                errorMessage = 'Camera access requires a secure connection (HTTPS).';
            }
            
            alert(errorMessage);
            
            // Display fallback UI or instructions
            const cameraOverlay = document.getElementById('cameraOverlay');
            if (cameraOverlay) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'camera-error';
                errorDiv.innerHTML = `
                    <p>${errorMessage}</p>
                    <p>Try using a different browser or device.</p>
                `;
                cameraOverlay.appendChild(errorDiv);
            }
        }
        drawDocumentCornerMarks();
    }

function captureImage() {
    if (!stream) {
        alert('Camera not available');
        return;
    }
    
    const ctx = canvas.getContext('2d');
    
    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw at full resolution
    ctx.drawImage(video, 0, 0);
    
    // Apply sharpening filter
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applySharpening(imageData);
    ctx.putImageData(imageData, 0, 0);
    
    // Convert to high-quality JPEG
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95); // Higher quality setting
    
    // Get the corner positions if available
    const cornerPositions = window.documentCorners || null;
    
    stopCamera();
    
    // Show the correction overlay
    const correctionOverlay = document.getElementById('correctionOverlay');
    if (correctionOverlay) {
        correctionOverlay.style.display = 'block';
        
        // Initialize correction with corner positions
        if (typeof window.initCorrection === 'function') {
            window.initCorrection(imageDataUrl, cornerPositions)
                .catch(err => {
                    console.error('Error initializing correction:', err);
                    alert('Error initializing correction. Please try again.');
                    correctionOverlay.style.display = 'none';
                });
        } else {
            console.error('initCorrection function not found');
            alert('Could not initialize document correction.');
        }
    } else {
        console.error('Correction overlay not found');
        
        // Fallback - display the image somewhere
        const img = new Image();
        img.src = imageDataUrl;
        document.body.appendChild(img);
    }
}

    // Image enhancement function
    function applySharpening(imageData) {
        const kernel = [
            0, -1, 0,
            -1, 5, -1,
            0, -1, 0
        ];
        
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const buffer = new Uint8ClampedArray(data);
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                
                for (let c = 0; c < 3; c++) { // RGB channels
                    let val = 0;
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const offset = ((y + ky) * width + (x + kx)) * 4;
                            val += buffer[offset + c] * kernel[(ky + 1) * 3 + (kx + 1)];
                        }
                    }
                    data[idx + c] = val;
                }
            }
        }
    }
    
    function stopCamera() {
        if (stream) {
            // Make sure torch is off when stopping camera
            const track = stream.getVideoTracks()[0];
            if (track.getCapabilities && track.getCapabilities().torch) {
                track.applyConstraints({ advanced: [{ torch: false }] });
            }
            stream.getTracks().forEach(track => track.stop());
        }
        video.srcObject = null;
        const cameraOverlay = document.getElementById('cameraOverlay');
        if (cameraOverlay) {
            cameraOverlay.style.display = 'none';
        }
    }

    // Event listeners
    if (captureBtn) {
        captureBtn.addEventListener('click', captureImage);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            stopCamera();
        });
    }

    // Check if autoBtn exists before adding event listener
    if (autoBtn) {
        autoBtn.addEventListener('click', () => {
            autoDetectEnabled = !autoDetectEnabled;
            autoBtn.classList.toggle('active', autoDetectEnabled);
            
            if (autoDetectEnabled && stream) {
                requestAnimationFrame(detectDocument);
            }
        });
    }

    // Camera is initialized on demand via window.reinitializeCamera()
    // (called by showCamera() in main.js when the button is tapped)

    // Function detectDocument may be defined elsewhere
    function detectDocument() {
        if (!autoDetectEnabled || !stream) return;
        
        // Implementation would go here
        // ...
        
        // Continue detection loop
        requestAnimationFrame(detectDocument);
    }

    // Expose reinitialize function for reuse
    window.reinitializeCamera = initializeCamera;
});