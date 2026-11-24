document.addEventListener('DOMContentLoaded', function () {
    // Shared Variables
    let originalImage = null;
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const cornerHandles = document.getElementById('cornerHandles');
    const confirmBtn = document.getElementById('confirmBtn');
    const resetBtn = document.getElementById('resetBtn');
    const cancelCorrectionBtn = document.getElementById('cancelCorrectionBtn');
    const formatBtn = document.getElementById('formatToggleBtn'); // From warp script
    let corners = [];
    let originalCorners = [];
    let imageScale = 1;
    let currentFormat = 'portrait'; // Default format (from warp script)
    let isDragging = false; // For corner dragging (from warp script)
    let currentHandle = null; // For corner dragging (from warp script)

    // Debugging Functions (keep both for debugging purposes)
    function debugImageData(img) {
        console.log('Debug Image:', {
            src: img.src.substring(0, 50) + '...',
            width: img.width,
            height: img.height,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight
        });
    }

    function debugCorners(corners) {
        console.log('Debug Corners:', corners.map(c => ({
            x: Math.round(c.x * 100) / 100,
            y: Math.round(c.y * 100) / 100
        })));
    }
    
    function getDefaultCorners() {
	console.log('defaultcorners set');
    // Add some padding from the edges (10% of width/height)
    const paddingX = canvas.width * 0;
    const paddingY = canvas.height * 0;
    
    return [
        { x: paddingX, y: paddingY }, // Top-left
        { x: canvas.width - paddingX, y: paddingY }, // Top-right
        { x: canvas.width - paddingX, y: canvas.height - paddingY }, // Bottom-right
        { x: paddingX, y: canvas.height - paddingY } // Bottom-left
    ];
}

    // Helper Functions (merge unique functions from both scripts)
    function convertToGrayscale(data, width, height) {
        const grayscale = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            grayscale[i / 4] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }
        return grayscale;
    }

    function enhanceContrast(data, width, height) {
        const enhanced = new Uint8Array(width * height);
        const minPixel = Math.min(...data);
        const maxPixel = Math.max(...data);
        const range = maxPixel - minPixel;

        for (let i = 0; i < data.length; i++) {
            enhanced[i] = Math.round(((data[i] - minPixel) / range) * 255);
        }

        return enhanced;
    }

function gaussianBlur(data, width, height) {
    // Increase kernel size significantly to eliminate handwriting
    const kernelSize = 15; // Much larger kernel
    const sigma = 4.0;     // Increased sigma for stronger blur
    
    // Create Gaussian kernel with larger size
    const kernel = [];
    let kernelSum = 0;
    
    // Generate kernel values
    for (let y = 0; y < kernelSize; y++) {
        kernel[y] = [];
        for (let x = 0; x < kernelSize; x++) {
            const xx = x - (kernelSize - 1) / 2;
            const yy = y - (kernelSize - 1) / 2;
            // Gaussian function
            kernel[y][x] = Math.exp(-(xx * xx + yy * yy) / (2 * sigma * sigma));
            kernelSum += kernel[y][x];
        }
    }
    
    // Normalize kernel
    for (let y = 0; y < kernelSize; y++) {
        for (let x = 0; x < kernelSize; x++) {
            kernel[y][x] /= kernelSum;
        }
    }

    const result = new Uint8Array(width * height);
    const halfKernel = Math.floor(kernelSize / 2);

    // Apply blur
    for (let y = halfKernel; y < height - halfKernel; y++) {
        for (let x = halfKernel; x < width - halfKernel; x++) {
            let sum = 0;
            for (let ky = 0; ky < kernelSize; ky++) {
                for (let kx = 0; kx < kernelSize; kx++) {
                    const sourceX = x + kx - halfKernel;
                    const sourceY = y + ky - halfKernel;
                    sum += data[sourceY * width + sourceX] * kernel[ky][kx];
                }
            }
            result[y * width + x] = Math.round(sum);
        }
    }

    // Handle edges of the image by copying nearest valid pixel
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (y < halfKernel || y >= height - halfKernel || 
                x < halfKernel || x >= width - halfKernel) {
                // Find nearest valid pixel
                const validY = Math.min(Math.max(y, halfKernel), height - halfKernel - 1);
                const validX = Math.min(Math.max(x, halfKernel), width - halfKernel - 1);
                result[y * width + x] = result[validY * width + validX];
            }
        }
    }

    return result;
}

    function sobelEdgeDetection(data, width, height) {
        const kernelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
        const kernelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];
        const edges = new Uint8Array(width * height);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let sumX = 0;
                let sumY = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        sumX += data[(y + ky) * width + (x + kx)] * kernelX[ky + 1][kx + 1];
                        sumY += data[(y + ky) * width + (x + kx)] * kernelY[ky + 1][kx + 1];
                    }
                }
                edges[y * width + x] = Math.sqrt(sumX * sumX + sumY * sumY);
            }
        }

        return edges;
    }

function hysteresisThresholding(edges, width, height, high = 30, low = 15) {
    console.log('Starting optimized hysteresis thresholding...', { high, low });
    
    const result = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    const queue = [];
    
    // First pass: mark strong edges and collect them
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (edges[idx] >= high) {
                result[idx] = 255;
                queue.push(idx);
                visited[idx] = 1;
            }
        }
    }
    
    // Early exit if no strong edges found
    if (queue.length === 0) {
        console.log('No strong edges found');
        return result;
    }
    
    // Define neighbor offsets for 8-connectivity
    const neighborOffsets = [
        -width - 1, -width, -width + 1,
        -1,                1,
        width - 1,  width, width + 1
    ];
    
    // Process queue iteratively
    while (queue.length > 0) {
        const currentIdx = queue.shift();
        const x = currentIdx % width;
        const y = Math.floor(currentIdx / width);
        
        // Check all 8 neighbors
        for (const offset of neighborOffsets) {
            const newIdx = currentIdx + offset;
            const newX = newIdx % width;
            const newY = Math.floor(newIdx / width);
            
            // Validate neighbor position and bounds
            if (newX < 0 || newX >= width || newY < 0 || newY >= height) {
                continue;
            }
            
            // Check if neighbor is unvisited and above low threshold
            if (!visited[newIdx] && edges[newIdx] >= low) {
                result[newIdx] = 255;
                queue.push(newIdx);
                visited[newIdx] = 1;
            }
        }
    }
    
    console.log('Hysteresis thresholding completed', {
        strongEdges: visited.reduce((sum, val) => sum + val, 0)
    });
    
    return result;
}

function houghTransform(edges, width, height) {
    console.log('Starting optimized Hough transform...', { width, height });
    
    // Define angle range for near-vertical and near-horizontal lines only
    const angleRanges = [
        { min: -30, max: 30 },     // Near-vertical lines
        { min: 60, max: 120 }      // Near-horizontal lines
    ];
    
    const thetaStep = 2;  // 2 degree steps
    const rhoStep = 2;    // 2 pixel steps
    
    // Pre-calculate trigonometric values
    const thetas = [];
    angleRanges.forEach(range => {
        for (let angle = range.min; angle <= range.max; angle += thetaStep) {
            thetas.push(angle * Math.PI / 180);
        }
    });
    
    // Calculate rho bounds
    const maxRho = Math.ceil(Math.sqrt(width * width + height * height));
    const numRho = Math.ceil(2 * maxRho / rhoStep);
    
    // Initialize accumulator array properly
    const accumulator = Array(numRho).fill().map(() => Array(thetas.length).fill(0));
    const rhos = Array(numRho).fill().map((_, i) => (i - numRho/2) * rhoStep);
    
    // Process edge pixels
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (edges[y * width + x] > 0) {
                for (let t = 0; t < thetas.length; t++) {
                    const theta = thetas[t];
                    const rho = x * Math.cos(theta) + y * Math.sin(theta);
                    const rhoIndex = Math.round((rho + maxRho) / rhoStep);
                    
                    if (rhoIndex >= 0 && rhoIndex < numRho) {
                        accumulator[rhoIndex][t]++;
                    }
                }
            }
        }
    }
    
    console.log('Hough transform completed', {
        thetaCount: thetas.length,
        rhoCount: rhos.length,
        maxVotes: Math.max(...accumulator.map(row => Math.max(...row)))
    });
    
    return { accumulator, rhos, thetas };
}

// Function to find peaks in Hough space
function findPeaks(accumulator, rhos, thetas, threshold) {
    const peaks = [];
    const maxValue = Math.max(...accumulator.flat());
    const relativeThreshold = maxValue * threshold;
    
    console.log('Finding peaks...', {
        maxAccumulatorValue: maxValue,
        threshold: relativeThreshold
    });
    
    // Find local maxima in accumulator
    for (let r = 1; r < accumulator.length - 1; r++) {
        for (let t = 1; t < accumulator[0].length - 1; t++) {
            const value = accumulator[r][t];
            
            // Check if it's above threshold and is local maximum
            if (value > relativeThreshold) {
                const isLocalMax = value >= Math.max(
                    accumulator[r-1][t-1], accumulator[r-1][t], accumulator[r-1][t+1],
                    accumulator[r][t-1], accumulator[r][t+1],
                    accumulator[r+1][t-1], accumulator[r+1][t], accumulator[r+1][t+1]
                );
                
                if (isLocalMax) {
                    peaks.push({
                        rho: rhos[r],
                        theta: thetas[t],
                        votes: value
                    });
                }
            }
        }
    }
    
    console.log('Peaks found:', peaks.length);
    return peaks;
}

// Helper function to find X coordinate at a given Y on a line
function getXAtY(x1, y1, x2, y2, y) {
    if (y2 === y1) return null; // Horizontal line
    return x1 + (x2 - x1) * (y - y1) / (y2 - y1);
}

// Helper function for line intersection
function lineIntersection(line1, line2) {
    const x1 = line1.x1, y1 = line1.y1;
    const x2 = line1.x2, y2 = line1.y2;
    const x3 = line2.x1, y3 = line2.y1;
    const x4 = line2.x2, y4 = line2.y2;
    
    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (denominator === 0) return null;
    
    const x = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator;
    const y = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator;
    
    return { x, y };
}

//--detectDocumentCorners----detectDocumentCorners----detectDocumentCorners--

function detectDocumentCorners(imageData) {
    const width = imageData.width;
    const height = imageData.height;

    console.log('Detecting document corners...', { width, height });

    // Preprocessing
    const grayscale = convertToGrayscale(imageData.data, width, height);
    const blurred = gaussianBlur(grayscale, width, height);
    let edges = sobelEdgeDetection(blurred, width, height);

    // Calculate edge statistics for adaptive thresholding
    const edgeStats = calculateEdgeStatistics(edges);
    console.log('Edge statistics:', edgeStats);

    // Generate adaptive threshold candidates based on edge statistics
    const thresholdCandidates = generateAdaptiveThresholds(edgeStats);
    console.log('Testing threshold candidates:', thresholdCandidates);

    let bestResult = null;
    let bestScore = 0;

    // Try each threshold pair and score the results
    for (const { high, low } of thresholdCandidates) {
        try {
            const currentEdges = hysteresisThresholding(edges, width, height, high, low);
            const edgePixels = Array.from(currentEdges).filter(v => v > 0).length;
            
            // Skip if too few or too many edges
            if (edgePixels < 500 || edgePixels > width * height * 0.15) {
                console.log(`Threshold pair {${high}, ${low}} rejected: ${edgePixels} edge pixels`);
                continue;
            }

            // Perform Hough transform
            const { accumulator, rhos, thetas } = houghTransform(currentEdges, width, height);
            
            // Find peaks with multiple thresholds
            const peakThresholds = [0.5, 0.4, 0.3, 0.25];
            let bestPeaks = null;
            let bestPeakScore = 0;

            for (const peakThreshold of peakThresholds) {
                const peaks = findPeaks(accumulator, rhos, thetas, peakThreshold);
                
                if (peaks.length < 4) continue;

                // Convert to lines
                const lines = peaks.map(peak => convertPeakToLine(peak, width, height));

                // Classify lines
                const verticalLines = classifyVerticalLines(lines, width);
                const horizontalLines = classifyHorizontalLines(lines, height);

                // Score this configuration
                const score = scoreLineConfiguration(
                    verticalLines, 
                    horizontalLines, 
                    width, 
                    height,
                    edgePixels
                );

                if (score > bestPeakScore) {
                    bestPeakScore = score;
                    bestPeaks = { verticalLines, horizontalLines, peaks };
                }
            }

            // Update best result if this is better
            if (bestPeakScore > bestScore) {
                bestScore = bestPeakScore;
                bestResult = {
                    edges: currentEdges,
                    ...bestPeaks,
                    threshold: { high, low },
                    score: bestPeakScore
                };
                
                console.log(`New best result with threshold {${high}, ${low}}, score: ${bestPeakScore}`);
            }

        } catch (error) {
            console.error(`Error with threshold pair {${high}, ${low}}:`, error);
            continue;
        }
    }

    // If we found a good result, extract corners
    if (bestResult && bestResult.score > 10) {
        console.log('Best result found:', bestResult);
        
        const corners = extractCornersFromLines(
            bestResult.verticalLines,
            bestResult.horizontalLines,
            width,
            height
        );

        if (corners && corners.length === 4) {
            console.log('Successfully detected corners:', corners);
            return corners;
        }
    }

    console.warn('No good corner detection found. Using default corners.');
    return null;
}

// Calculate statistics about edge magnitudes
function calculateEdgeStatistics(edges) {
    const nonZeroEdges = Array.from(edges).filter(v => v > 0);
    
    if (nonZeroEdges.length === 0) {
        return { mean: 0, median: 0, p75: 0, p90: 0, max: 0 };
    }

    const sorted = nonZeroEdges.sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
        mean: sum / sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p75: sorted[Math.floor(sorted.length * 0.75)],
        p90: sorted[Math.floor(sorted.length * 0.90)],
        max: sorted[sorted.length - 1]
    };
}

// Generate adaptive threshold candidates based on edge statistics
function generateAdaptiveThresholds(stats) {
    const candidates = [];
    
    // Strategy 1: Use percentile-based thresholds
    candidates.push({
        high: Math.round(stats.p90),
        low: Math.round(stats.p75)
    });
    
    candidates.push({
        high: Math.round(stats.p75),
        low: Math.round(stats.median)
    });
    
    // Strategy 2: Use mean-based thresholds
    candidates.push({
        high: Math.round(stats.mean * 1.5),
        low: Math.round(stats.mean * 0.8)
    });
    
    // Strategy 3: Use fixed ratios from max
    candidates.push({
        high: Math.round(stats.max * 0.4),
        low: Math.round(stats.max * 0.2)
    });
    
    candidates.push({
        high: Math.round(stats.max * 0.3),
        low: Math.round(stats.max * 0.15)
    });
    
    // Strategy 4: Classic fixed values (fallback)
    candidates.push({ high: 50, low: 25 });
    candidates.push({ high: 40, low: 20 });
    candidates.push({ high: 60, low: 30 });
    
    // Remove duplicates and ensure low < high
    const uniqueCandidates = [];
    const seen = new Set();
    
    for (const { high, low } of candidates) {
        if (low >= high || low < 5 || high > 255) continue;
        
        const key = `${high}-${low}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueCandidates.push({ high, low });
        }
    }
    
    return uniqueCandidates;
}

// Convert peak to line representation
function convertPeakToLine(peak, width, height) {
    const theta = peak.theta;
    const rho = peak.rho;
    const angle = theta * 180 / Math.PI;
    
    let x1, y1, x2, y2;
    
    if (Math.abs(Math.sin(theta)) < 0.001) {
        // Vertical line
        x1 = x2 = rho / Math.cos(theta);
        y1 = 0;
        y2 = height;
    } 
    else if (Math.abs(Math.cos(theta)) < 0.001) {
        // Horizontal line
        x1 = 0;
        x2 = width;
        y1 = y2 = rho / Math.sin(theta);
    }
    else {
        // Diagonal line
        x1 = 0;
        y1 = rho / Math.sin(theta);
        x2 = width;
        y2 = (rho - x2 * Math.cos(theta)) / Math.sin(theta);
    }
    
    return {
        x1, y1, x2, y2,
        rho, theta, angle,
        votes: peak.votes,
        xAxisIntersection: getXAtY(x1, y1, x2, y2, height/2),
        midY: (y1 + y2) / 2
    };
}

// Classify vertical lines
function classifyVerticalLines(lines, width) {
    return lines.filter(l => {
        const angle = ((l.angle % 180) + 180) % 180;
        return (angle <= 30 || angle >= 150) && 
               l.xAxisIntersection >= width * 0.05 && 
               l.xAxisIntersection <= width * 0.95;
    });
}

// Classify horizontal lines
function classifyHorizontalLines(lines, height) {
    return lines.filter(l => {
        const angle = ((l.angle % 180) + 180) % 180;
        return (angle >= 60 && angle <= 120) &&
               l.midY >= height * 0.05 && 
               l.midY <= height * 0.95;
    });
}

// Score a line configuration
function scoreLineConfiguration(verticalLines, horizontalLines, width, height, edgePixels) {
    let score = 0;
    
    // Need at least 2 vertical and 2 horizontal lines
    if (verticalLines.length < 2 || horizontalLines.length < 2) {
        return 0;
    }
    
    // Bonus for having exactly 2 of each (cleaner detection)
    if (verticalLines.length === 2 && horizontalLines.length === 2) {
        score += 20;
    }
    
    // Score based on line votes (stronger lines are better)
    const avgVerticalVotes = verticalLines.reduce((sum, l) => sum + l.votes, 0) / verticalLines.length;
    const avgHorizontalVotes = horizontalLines.reduce((sum, l) => sum + l.votes, 0) / horizontalLines.length;
    score += (avgVerticalVotes + avgHorizontalVotes) / 100;
    
    // Check for good spatial distribution
    const centerX = width / 2;
    const centerY = height / 2;
    
    const hasLeftLine = verticalLines.some(l => l.xAxisIntersection < centerX);
    const hasRightLine = verticalLines.some(l => l.xAxisIntersection >= centerX);
    const hasTopLine = horizontalLines.some(l => l.midY < centerY);
    const hasBottomLine = horizontalLines.some(l => l.midY >= centerY);
    
    if (hasLeftLine && hasRightLine && hasTopLine && hasBottomLine) {
        score += 30;
    }
    
    // Penalize if too many edges (noisy image)
    const edgeRatio = edgePixels / (width * height);
    if (edgeRatio > 0.1) {
        score -= 10;
    } else if (edgeRatio < 0.01) {
        score -= 10;
    }
    
    return score;
}

// Extract corners from the best lines
function extractCornersFromLines(verticalLines, horizontalLines, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Sort and select best lines
    const leftVerticals = verticalLines
        .filter(l => l.xAxisIntersection < centerX)
        .sort((a, b) => b.votes - a.votes);
    const rightVerticals = verticalLines
        .filter(l => l.xAxisIntersection >= centerX)
        .sort((a, b) => b.votes - a.votes);
    const topHorizontals = horizontalLines
        .filter(l => l.midY < centerY)
        .sort((a, b) => b.votes - a.votes);
    const bottomHorizontals = horizontalLines
        .filter(l => l.midY >= centerY)
        .sort((a, b) => b.votes - a.votes);

    const leftVertical = leftVerticals[0];
    const rightVertical = rightVerticals[0];
    const topHorizontal = topHorizontals[0];
    const bottomHorizontal = bottomHorizontals[0];

    if (!leftVertical || !rightVertical || !topHorizontal || !bottomHorizontal) {
        return null;
    }

    // Calculate intersections
    const topLeft = lineIntersection(
        {x1: leftVertical.x1, y1: leftVertical.y1, x2: leftVertical.x2, y2: leftVertical.y2},
        {x1: topHorizontal.x1, y1: topHorizontal.y1, x2: topHorizontal.x2, y2: topHorizontal.y2}
    );
    
    const topRight = lineIntersection(
        {x1: rightVertical.x1, y1: rightVertical.y1, x2: rightVertical.x2, y2: rightVertical.y2},
        {x1: topHorizontal.x1, y1: topHorizontal.y1, x2: topHorizontal.x2, y2: topHorizontal.y2}
    );
    
    const bottomRight = lineIntersection(
        {x1: rightVertical.x1, y1: rightVertical.y1, x2: rightVertical.x2, y2: rightVertical.y2},
        {x1: bottomHorizontal.x1, y1: bottomHorizontal.y1, x2: bottomHorizontal.x2, y2: bottomHorizontal.y2}
    );
    
    const bottomLeft = lineIntersection(
        {x1: leftVertical.x1, y1: leftVertical.y1, x2: leftVertical.x2, y2: leftVertical.y2},
        {x1: bottomHorizontal.x1, y1: bottomHorizontal.y1, x2: bottomHorizontal.x2, y2: bottomHorizontal.y2}
    );

    const corners = [topLeft, topRight, bottomRight, bottomLeft].filter(c => c);

    if (corners.length !== 4) {
        return null;
    }

    // Validate corners are within reasonable bounds
    const validCorners = corners.every(corner => 
        corner.x >= -width * 0.1 && corner.x <= width * 1.1 &&
        corner.y >= -height * 0.1 && corner.y <= height * 1.1
    );

    if (!validCorners) {
        return null;
    }

    return corners.map(corner => ({
        x: Math.round(Math.max(0, Math.min(width, corner.x))),
        y: Math.round(Math.max(0, Math.min(height, corner.y)))
    }));
}

// Autogra.fi-Kern: fehlte im alten Scanner (Aufruf unten lief ins Leere).
// Stellt das Ausgabeformat nach den erkannten Ecken auf Hoch- oder Querformat.
function determineOrientation() {
    if (!corners || corners.length !== 4) return;
    const side = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const w = (side(corners[0], corners[1]) + side(corners[3], corners[2])) / 2;
    const h = (side(corners[0], corners[3]) + side(corners[1], corners[2])) / 2;
    currentFormat = w > h * 1.1 ? 'landscape' : 'portrait';
    formatBtn.innerHTML = currentFormat === 'landscape' ? '▭' : '▯';
    formatBtn.classList.remove('portrait', 'landscape', 'square');
    formatBtn.classList.add(currentFormat);
}

//--Initcorrection--Initcorrection--Initcorrection--Initcorrection--Initcorrection

function initCorrection(imageData, cornerPositions = null) {
    console.log('Initializing correction with image data');
    return new Promise((resolve, reject) => {
        // Clean up any previous state
        cleanup();
        
        // Initialize new event listeners
        initializeEventListeners();
        
        originalImage = new Image();
        originalImage.onload = () => {
            console.log('Image loaded:', {
                width: originalImage.width,
                height: originalImage.height
            });

            const maxWidth = window.innerWidth * 0.9;
            const maxHeight = window.innerHeight * 0.8;
            imageScale = Math.min(
                maxWidth / originalImage.width,
                maxHeight / originalImage.height
            );

            canvas.width = originalImage.width * imageScale;
            canvas.height = originalImage.height * imageScale;

            // Set up corner handles container
            const canvasRect = canvas.getBoundingClientRect();
            cornerHandles.style.width = `${canvasRect.width}px`;
            cornerHandles.style.height = `${canvasRect.height}px`;
            cornerHandles.style.top = `${canvasRect.top}px`;
            cornerHandles.style.left = `${canvasRect.left}px`;
            cornerHandles.style.zIndex = '4500';

            // Draw the original image
            ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);

            // Initialize corners based on provided positions first
            if (cornerPositions && Array.isArray(cornerPositions) && cornerPositions.length === 4) {
                // Convert normalized corner positions to actual canvas coordinates
                corners = cornerPositions.map(corner => ({
                    x: corner.x * canvas.width,
                    y: corner.y * canvas.height
                }));
                console.log('Using provided corner positions:', corners);
            } else {
                // Use default corners when no positions are provided
                corners = getDefaultCorners();
                console.log('Using default corners:', corners);
            }

            // Try to detect corners
            try {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let detectedCorners = detectDocumentCorners(imageData);
                // Autogra.fi-Kern: weitere Kandidaten (Helligkeit, Kanten) prüfen, den
                // am besten belegten Blattrand wählen und die Ecken genauer setzen (detect.js).
                if (typeof window.bestPaperCorners === 'function') {
                    const better = window.bestPaperCorners(imageData, detectedCorners);
                    if (better) detectedCorners = better.corners;
                }

                // If detection was successful, override the corners
                if (detectedCorners && detectedCorners.length === 4) {
                    console.log('Detected corners successfully:', detectedCorners);
                    corners = detectedCorners;
                    
                    // Determine orientation based on detected corners
                    determineOrientation();
                } else {
                    console.warn('Detection failed, keeping initial corners');
                }
            } catch (error) {
                console.error('Error during corner detection:', error);
                // Keep using initial corners (either provided or default)
            }

            // Store original corners for reset functionality
            originalCorners = JSON.parse(JSON.stringify(corners));
            
            // Create the corner handles AFTER corners are finalized
            createCornerHandles(); 
            resolve();
        };

        originalImage.onerror = reject;
        originalImage.src = imageData;
    });
}

//Mathematicalfunctions
//function calculatePerspectiveMatrix(srcPoints, dstPoints) { ... }

function calculatePerspectiveMatrix(srcPoints, dstPoints) {
    console.log('Input points:', {
        src: srcPoints.map(p => p.map(v => Math.round(v * 100) / 100)),
        dst: dstPoints.map(p => p.map(v => Math.round(v * 100) / 100))
    });

    // Create matrices for the system of equations
    const A = [];
    const b = [];
    
    for (let i = 0; i < 4; i++) {
        const [x, y] = srcPoints[i];
        const [u, v] = dstPoints[i];
        
        A.push([x, y, 1, 0, 0, 0, -u*x, -u*y]);
        A.push([0, 0, 0, x, y, 1, -v*x, -v*y]);
        b.push(u);
        b.push(v);
    }

    // Solve system and log intermediate results
    console.log('Matrix A:', A.map(row => row.map(v => Math.round(v * 100) / 100)));
    console.log('Vector b:', b.map(v => Math.round(v * 100) / 100));

    const h = solveSystem(A, b);
    console.log('Solution h:', h.map(v => Math.round(v * 100) / 100));

    return [
        [h[0], h[1], h[2]],
        [h[3], h[4], h[5]],
        [h[6], h[7], 1]
    ];
}

//function transpose(matrix) { ... }

    function transpose(matrix) {
        return matrix[0].map((_, i) => matrix.map(row => row[i]));
    }

//function matrixMultiply(a, b) { ... }


    function matrixMultiply(a, b) {
        return a.map(row => 
            transpose(b).map(col => 
                row.reduce((sum, cell, i) => sum + cell * col[i], 0)
            )
        );
    }

//function solveSystem(A, b) { ... }

    function solveSystem(A, b) {
        const n = A.length;
        const augmented = A.map((row, i) => [...row, b[i]]);
        
        // Gaussian elimination
        for (let i = 0; i < n; i++) {
            let maxRow = i;
            for (let j = i + 1; j < n; j++) {
                if (Math.abs(augmented[j][i]) > Math.abs(augmented[maxRow][i])) {
                    maxRow = j;
                }
            }
            
            [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
            
            for (let j = i + 1; j < n; j++) {
                const factor = augmented[j][i] / augmented[i][i];
                for (let k = i; k <= n; k++) {
                    augmented[j][k] -= factor * augmented[i][k];
                }
            }
        }
        
        // Back substitution
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            x[i] = augmented[i][n];
            for (let j = i + 1; j < n; j++) {
                x[i] -= augmented[i][j] * x[j];
            }
            x[i] /= augmented[i][i];
        }
        
        return x;
    }

//function bilinearInterpolation(imageData, x, y) { ... }

 function bilinearInterpolation(imageData, x, y) {
    // Ensure coordinates are within bounds
    x = Math.max(0, Math.min(x, imageData.width - 1));
    y = Math.max(0, Math.min(y, imageData.height - 1));
    
    const x1 = Math.floor(x);
    const x2 = Math.min(Math.ceil(x), imageData.width - 1);
    const y1 = Math.floor(y);
    const y2 = Math.min(Math.ceil(y), imageData.height - 1);
    
    const q11 = getPixel(imageData, x1, y1);
    const q12 = getPixel(imageData, x1, y2);
    const q21 = getPixel(imageData, x2, y1);
    const q22 = getPixel(imageData, x2, y2);
    
    const fx = x - x1;
    const fy = y - y1;
    
    // Add bounds checking for interpolation values
    if (isNaN(fx) || isNaN(fy) || fx < 0 || fx > 1 || fy < 0 || fy > 1) {
        console.warn('Invalid interpolation factors:', { fx, fy, x, y, x1, y1 });
        return { r: 0, g: 0, b: 0, a: 255 };
    }
    
    return {
        r: bilinearValue(q11.r, q21.r, q12.r, q22.r, fx, fy),
        g: bilinearValue(q11.g, q21.g, q12.g, q22.g, fx, fy),
        b: bilinearValue(q11.b, q21.b, q12.b, q22.b, fx, fy),
        a: 255
    };
}
//function bilinearValue(v11, v21, v12, v22, fx, fy) { ... }

    function bilinearValue(v11, v21, v12, v22, fx, fy) {
        return Math.round(
            v11 * (1 - fx) * (1 - fy) +
            v21 * fx * (1 - fy) +
            v12 * (1 - fx) * fy +
            v22 * fx * fy
        );
    }

async function applyPerspectiveCorrection() {
    if (!originalImage) return null;

    try {
        // Unscale the corners from the display size back to original image size
        const unscaledCorners = corners.map(corner => ({
            x: corner.x / imageScale,
            y: corner.y / imageScale
        }));

        // Define A4 portrait proportions (width:height = 1:√2)
        let targetRatio;
        const A4_RATIO = Math.sqrt(2);
        
        switch(currentFormat) {
            case 'landscape':
                targetRatio = 1 / A4_RATIO;
                break;
            case 'square':
                targetRatio = 1;
                break;
            case 'portrait':
            default:
                targetRatio = A4_RATIO;
                break;
        }
        
        // Use the longest edge to determine the output dimensions
        // This ensures we maintain A4 proportions while maximizing the size
        const currentWidth = Math.max(
            distance(unscaledCorners[0], unscaledCorners[1]),
            distance(unscaledCorners[2], unscaledCorners[3])
        );
        const currentHeight = Math.max(
            distance(unscaledCorners[0], unscaledCorners[3]),
            distance(unscaledCorners[1], unscaledCorners[2])
        );

        // Calculate output dimensions maintaining A4 ratio
        let outWidth, outHeight;
        if (currentWidth / currentHeight > 1/targetRatio) {
            // Width is proportionally larger, use it as reference
            outWidth = currentWidth;
            outHeight = currentWidth * targetRatio;
        } else {
            // Height is proportionally larger, use it as reference
            outHeight = currentHeight;
            outWidth = currentHeight / targetRatio;
        }

        const sourceCanvas = createSourceCanvas(originalImage);

        // The target corners are now a perfect rectangle with A4 proportions
        const targetCorners = [
            [0, 0],                  // Top-left
            [outWidth, 0],           // Top-right
            [outWidth, outHeight],   // Bottom-right
            [0, outHeight]           // Bottom-left
        ];

        // The source corners are the corners the user selected (unscaled)
        const sourceCorners = unscaledCorners.map(corner => [corner.x, corner.y]);

        // Perform the perspective warp
        const warpedCanvas = await warpPerspective(
            sourceCanvas,
            targetCorners,    // This is now the target rectangle
            sourceCorners,    // This is the source quadrilateral
            Math.round(outWidth),
            Math.round(outHeight)
        );

        return warpedCanvas.toDataURL('image/jpeg', 0.92);
    } catch (error) {
        console.error('Error in perspective correction:', error);
        return null;
    }
}

// Helper function to calculate distance between two points
function distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

//createCanvas
function createSourceCanvas(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas;
}

// warpPerspective


async function warpPerspective(sourceCanvas, srcPoints, dstPoints, outWidth, outHeight) {
    const warpedCanvas = document.createElement('canvas');
    const warpedCtx = warpedCanvas.getContext('2d');
    warpedCanvas.width = outWidth;
    warpedCanvas.height = outHeight;

    const sourceCtx = sourceCanvas.getContext('2d');
    const sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const warpedImageData = warpedCtx.createImageData(outWidth, outHeight);

    // Calculate matrix with more lenient epsilon
    const matrix = calculatePerspectiveMatrix(srcPoints, dstPoints);
    console.log('Matrix elements:', matrix.map(row => row.map(v => Math.round(v * 1000) / 1000)));

    let validPixels = 0;
    let invalidPixels = 0;
    const debugLimit = 5; // Log first 5 pixels for debugging

    for (let y = 0; y < outHeight; y++) {
        for (let x = 0; x < outWidth; x++) {
            const debugPixel = (validPixels + invalidPixels) < debugLimit;
            
            const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
            
            if (debugPixel) {
                console.log('Processing pixel:', {x, y, denominator});
            }
            
            // More lenient epsilon
            if (Math.abs(denominator) < 1e-6) {
                if (debugPixel) console.log('Invalid denominator');
                invalidPixels++;
                continue;
            }

            const srcX = (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator;
            const srcY = (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator;

            if (debugPixel) {
                console.log('Mapped coordinates:', {srcX, srcY});
            }

            // Add padding to bounds check
            const padding = 1;
            if (srcX < -padding || srcX > sourceCanvas.width + padding || 
                srcY < -padding || srcY > sourceCanvas.height + padding) {
                if (debugPixel) console.log('Out of bounds');
                invalidPixels++;
                continue;
            }

            // Clamp coordinates for interpolation
            const clampedX = Math.max(0, Math.min(srcX, sourceCanvas.width - 1));
            const clampedY = Math.max(0, Math.min(srcY, sourceCanvas.height - 1));
            
            const color = bilinearInterpolation(sourceData, clampedX, clampedY);
            const destIndex = (y * outWidth + x) * 4;

            warpedImageData.data[destIndex] = color.r;
            warpedImageData.data[destIndex + 1] = color.g;
            warpedImageData.data[destIndex + 2] = color.b;
            warpedImageData.data[destIndex + 3] = 255; // Force full opacity

            validPixels++;
        }
    }

    warpedCtx.putImageData(warpedImageData, 0, 0);

    // Debug: Draw a border to verify canvas is working
    warpedCtx.strokeStyle = 'red';
    warpedCtx.lineWidth = 2;
    warpedCtx.strokeRect(0, 0, outWidth, outHeight);

    return warpedCanvas;
}

// Helper function to calculate matrix inverse
function inverse(matrix) {
    const det = matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
                matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
                matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);

    const invDet = 1 / det;

    return [
        [(matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) * invDet,
         (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) * invDet,
         (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) * invDet],
        [(matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) * invDet,
         (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) * invDet,
         (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) * invDet],
        [(matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) * invDet,
         (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) * invDet,
         (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) * invDet]
    ];
}

// getPixel 
    function getPixel(imageData, x, y) {
        const index = (y * imageData.width + x) * 4;
        return {
            r: imageData.data[index],
            g: imageData.data[index + 1],
            b: imageData.data[index + 2],
            a: imageData.data[index + 3]
        };
    }

// Helper function to apply matrix transformation
function applyMatrix(matrix, x, y) {
    const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
    if (Math.abs(denominator) < 1e-10) {
        return [0, 0]; // Return origin if denominator is too small
    }
    
    const srcX = (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator;
    const srcY = (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator;
    
    return [srcX, srcY];
}

function createCornerHandles() {
    // Clear existing handles
    while (cornerHandles.firstChild) {
        cornerHandles.removeChild(cornerHandles.firstChild);
    }
    
    // Create handles with larger touch area
    corners.forEach((corner, index) => {
        const handle = document.createElement('div');
        handle.className = 'corner-handle';
        // Create a larger touch target area but keep visual small
        handle.style.width = '100px';
        handle.style.height = '100px';
        handle.style.position = 'absolute';
        handle.style.borderRadius = '50%';
        handle.style.border = '2px solid #FFF';
        handle.style.backgroundColor = 'transparent'; // Slightly visible background
        // Position the handle centered on the corner point
        handle.style.left = `${corner.x-50}px`;  
        handle.style.top = `${corner.y-50}px`;
        handle.style.transform = 'translate(0, 0)'; // For better mobile rendering
        handle.style.zIndex = '5000';
        handle.style.touchAction = 'none'; // Prevent browser handling of touches
        handle.dataset.index = index;
        
        // Add inner visible element for better visibility
        const innerHandle = document.createElement('div');
        innerHandle.style.width = '4px';
        innerHandle.style.height = '4px';
        innerHandle.style.position = 'absolute';
        innerHandle.style.left = '46px';
        innerHandle.style.top = '46px';
        innerHandle.style.borderRadius = '50%';
        innerHandle.style.backgroundColor = '#f00';
        handle.appendChild(innerHandle);
        
        cornerHandles.appendChild(handle);
    });
    4
    // Initialize event listeners after creating handles
    initializeEventListeners();
    
    drawPreview();
}

// Improved dragging with better touch handling
let touchIdentifier = null;
let lastX = 0;
let lastY = 0;

function startDragging(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const handle = e.target.closest('.corner-handle');
    if (!handle) return;
   
    isDragging = true;
    currentHandle = parseInt(handle.dataset.index);
    
    // For touch events, store the identifier to track the correct touch point
    if (e.type === 'touchstart') {
        touchIdentifier = e.touches[0].identifier;
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
    } else {
        lastX = e.clientX;
        lastY = e.clientY;
    }
    
    // Add additional capture events to document for more reliable touch tracking
    if (e.type === 'touchstart') {
        document.addEventListener('touchmove', handleDrag, { passive: false, capture: true });
        document.addEventListener('touchend', stopDragging, { passive: false, capture: true });
        document.addEventListener('touchcancel', stopDragging, { passive: false, capture: true });
    }
    
    console.log('Drag started for handle', currentHandle);
}

function handleDrag(e) {
    if (!isDragging) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Get current touch/mouse position
    let clientX, clientY;
    
    if (e.type === 'touchmove') {
        // Find the correct touch point using the stored identifier
        let touch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === touchIdentifier) {
                touch = e.touches[i];
                break;
            }
        }
        
        // If we couldn't find the touch, try the changedTouches collection
        if (!touch && e.changedTouches) {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === touchIdentifier) {
                    touch = e.changedTouches[i];
                    break;
                }
            }
        }
        
        if (!touch) return; // Touch not found, ignore this event
        
        clientX = touch.clientX;
        clientY = touch.clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    
    // Calculate movement delta
    const deltaX = clientX - lastX;
    const deltaY = clientY - lastY;
    
    if (Math.abs(deltaX) > 100 || Math.abs(deltaY) > 100) {
        console.log('Large delta detected, ignoring:', deltaX, deltaY);
        return; // Ignore unreasonably large movements (likely errors)
    }
    
    // Get canvas position for proper coordinate conversion
    const canvasRect = canvas.getBoundingClientRect();
    
    // Scale factor to convert screen pixels to canvas pixels
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;
    
    // Update corner position with scaled delta
    corners[currentHandle] = {
        x: Math.max(0, Math.min(canvas.width, corners[currentHandle].x + deltaX * scaleX)),
        y: Math.max(0, Math.min(canvas.height, corners[currentHandle].y + deltaY * scaleY))
    };
    
    // Store current position for next move
    lastX = clientX;
    lastY = clientY;
    
    // Update UI without recreating event listeners
    updateHandlePositions();
    drawPreview();
    
    console.log('Handle moved to', corners[currentHandle].x, corners[currentHandle].y);
}

// Update handle positions without recreating them
function updateHandlePositions() {
    const handles = cornerHandles.querySelectorAll('.corner-handle');
    corners.forEach((corner, index) => {
        if (handles[index]) {
            handles[index].style.left = `${corner.x - 50}px`;
            handles[index].style.top = `${corner.y - 50}px`;
        }
    });
}

function stopDragging(e) {
    if (!isDragging) return;
    
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Remove capture phase listeners
    document.removeEventListener('touchmove', handleDrag, { capture: true });
    document.removeEventListener('touchend', stopDragging, { capture: true });
    document.removeEventListener('touchcancel', stopDragging, { capture: true });
    
    isDragging = false;
    currentHandle = null;
    touchIdentifier = null;
    
    console.log('Drag stopped');
}

function initializeEventListeners() {
    // Remove any existing listeners to prevent duplicates
    cornerHandles.removeEventListener('mousedown', startDragging);
    cornerHandles.removeEventListener('touchstart', startDragging);
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('touchmove', handleDrag);
    document.removeEventListener('mouseup', stopDragging);
    document.removeEventListener('touchend', stopDragging);
    document.removeEventListener('mouseleave', stopDragging);
    
    // Add new listeners
    cornerHandles.addEventListener('mousedown', startDragging);
    cornerHandles.addEventListener('touchstart', startDragging, { passive: false });
    
    // Move and end events on document level to ensure they work even off the element
    document.addEventListener('mousemove', handleDrag, { passive: false });
    document.addEventListener('mouseup', stopDragging);
    
    // Don't add touchmove/touchend to document here - we'll add them on demand 
    // with capture: true when dragging starts, to ensure we get all events
    
    // Handle pointer leaving the window
    document.addEventListener('mouseleave', stopDragging);
}

function drawPreview() {
    console.log('Drawing preview');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (originalImage && originalImage.complete) {
        ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
        
        // Draw document outline
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        corners.forEach((corner, i) => {
            const nextCorner = corners[(i + 1) % corners.length];
            ctx.lineTo(nextCorner.x, nextCorner.y);
        });
        ctx.closePath();
        ctx.strokeStyle = '#2196F3';
        ctx.lineWidth = 2;
        ctx.stroke();
    } else {
        console.log('Original image not loaded');
    }
}

function removeDebugCanvases() {
    const debugCanvases = document.querySelectorAll('canvas[title^="Debug"]');
    debugCanvases.forEach(canvas => canvas.remove());
}

function cleanup() {
    // Remove all event listeners
    cornerHandles.removeEventListener('mousedown', startDragging);
    cornerHandles.removeEventListener('touchstart', startDragging);
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('touchmove', handleDrag, { capture: true });
    document.removeEventListener('mouseup', stopDragging);
    document.removeEventListener('touchend', stopDragging, { capture: true });
    document.removeEventListener('touchcancel', stopDragging, { capture: true });
    document.removeEventListener('mouseleave', stopDragging);
    
    // Remove debug canvases
    if (typeof removeDebugCanvases === 'function') {
    removeDebugCanvases();
    }
    if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
    
    // Clear references
    originalImage = null;
    corners = [];
    originalCorners = [];
    
    // Reset dragging state
    isDragging = false;
    currentHandle = null;
    touchIdentifier = null;
}

// Event Handlers - improved confirm button handler with spinner and auto-reactivation

// Event Handlers - properly reset button in all scenarios
confirmBtn.addEventListener('click', function confirmHandler(event) {
    console.log('Processing started');
    event.preventDefault();
    event.stopPropagation();
    
    // Remove event listener to prevent double execution
    confirmBtn.removeEventListener('click', confirmHandler);
    
    // Add CSS for rotation if not already present
    if (!document.getElementById('rotation-styles')) {
        const style = document.createElement('style');
        style.id = 'rotation-styles';
        style.textContent = `
            .rotating {
                animation: rotate 1.5s linear infinite;
            }
            @keyframes rotate {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Apply rotating effect to the button
    confirmBtn.classList.add('rotating');
    confirmBtn.style.opacity = '0.7';
    
    // Function to reset the button to normal state
    const resetButton = () => {
        confirmBtn.classList.remove('rotating');
        confirmBtn.style.opacity = '1';
        confirmBtn.addEventListener('click', confirmHandler);
        console.log('Button reset and reactivated');
    };
    
    // Process with small delay for UI update
    setTimeout(async () => {
        try {
            const correctedImage = await applyPerspectiveCorrection();
            
            if (!correctedImage) {
                throw new Error('Correction failed');
            }
            
            // Hide correction overlay
            document.getElementById('correctionOverlay').style.display = 'none';
            
            // Use appropriate function to handle the corrected image
            if (typeof window.showOptions === 'function') {
                const tempElement = document.createElement('div');
                tempElement.className = 'thumbnail';
                window.showOptions(correctedImage, tempElement);
            } else if (typeof window.addThumbnail === 'function') {
                await window.addThumbnail(correctedImage);
            } else {
                throw new Error('Required handler functions missing');
            }
            
            // Clean up
            cleanup();
            
            // CRITICAL FIX: Reset button on success
            resetButton();
            
        } catch (error) {
            console.error('Error:', error.message);
            alert('Failed to process image. Please try again.');
            
            // Reset button appearance but with delay
            setTimeout(() => {
                resetButton();
            }, 3000);
        }
    }, 50);
});

resetBtn.addEventListener('click', () => {
    console.log('Reset button clicked');
    corners = getDefaultCorners();
    createCornerHandles();
});

cancelCorrectionBtn.addEventListener('click', () => {
    console.log('Cancel button clicked');
    document.getElementById('correctionOverlay').style.display = 'none';
    cleanup();
});

formatBtn.addEventListener('click', () => {
    console.log('Format toggle button clicked');
    switch (currentFormat) {
        case 'portrait':
            currentFormat = 'landscape';
            formatBtn.innerHTML = '▭';
            break;
        case 'landscape':
            currentFormat = 'square';
            formatBtn.innerHTML = '□';
            break;
        case 'square':
            currentFormat = 'portrait';
            formatBtn.innerHTML = '▯';
            break;
    }
    formatBtn.classList.remove('portrait', 'landscape', 'square');
    formatBtn.classList.add(currentFormat);
    drawPreview();
});

window.initCorrection = initCorrection;
});