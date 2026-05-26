const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

function execPromise(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// Set up directories
const uploadsDir = path.join(__dirname, 'uploads');
const tempDir = path.join(__dirname, 'temp');
const publicDir = path.join(__dirname, 'public');
const downloadsDir = path.join(publicDir, 'downloads');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(downloadsDir, { recursive: true });

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.pptx' || ext === '.pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only .pptx and .pdf files are supported.'));
        }
    }
});

// Serve frontend static files
app.use(express.static(publicDir));
app.use(express.json());

// In-memory job state
const jobs = {};

// Smart Grid Solver implementing the Portrait (max 2 slides per row) and Landscape (max 2 slides per column) rules
function getOptimalGrid(n, pageW, pageH, slideRatio, orientation) {
    // Baseline is A4 Portrait average dimension: (595.27 + 841.89)/2 = 718.58
    const scaleFactor = (pageW + pageH) / (2 * 718.58);
    
    // Scale margins and spacings responsively
    const marginX = 25 * scaleFactor;
    const marginY = 30 * scaleFactor;
    const spacingX = 20 * scaleFactor;
    const spacingY = 25 * scaleFactor;
    const labelHeight = 15 * scaleFactor;

    const printableWidth = pageW - 2 * marginX;
    const printableHeight = pageH - 2 * marginY;

    let rows = 1;
    let cols = 1;

    if (orientation === 'portrait') {
        if (n === 1) {
            rows = 1; cols = 1;
        } else if (n === 2) {
            rows = 2; cols = 1;
        } else {
            cols = 2;
            rows = Math.ceil(n / 2);
        }
    } else {
        // Landscape Mode: SAME logic but transposed (max 2 slides per column, i.e., max 2 rows)
        if (n === 1) {
            rows = 1; cols = 1;
        } else if (n === 2) {
            rows = 1; cols = 2;
        } else {
            rows = 2;
            cols = Math.ceil(n / 2);
        }
    }

    // Calculate cell dimensions
    const cellW = (printableWidth - (cols - 1) * spacingX) / cols;
    const cellH = (printableHeight - (rows - 1) * spacingY) / rows;
    
    const maxSlideW = cellW;
    const maxSlideH = cellH - labelHeight;
    
    let w = maxSlideW;
    let h = w / slideRatio;
    if (h > maxSlideH) {
        h = maxSlideH;
        w = h * slideRatio;
    }
    
    return { 
        rows, 
        cols, 
        slideW: w, 
        slideH: h,
        marginX,
        marginY,
        spacingX,
        spacingY,
        labelHeight,
        scaleFactor
    };
}

// Corner brightness calculation & levels adjustment
async function cleanImage(inputPath, outputPath) {
    const img = sharp(inputPath);
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    
    // 1. Detect if the slide is dark-themed overall
    const xStart = Math.floor(width * 0.05);
    const xEnd = Math.floor(width * 0.95);
    const yStart = Math.floor(height * 0.05);
    const yEnd = Math.floor(height * 0.95);

    let totalBrightness = 0;
    let sampledPixels = 0;
    
    // Grid sample inner 90%
    const stepX = Math.max(1, Math.floor((xEnd - xStart) / 100));
    const stepY = Math.max(1, Math.floor((yEnd - yStart) / 100));

    for (let y = yStart; y < yEnd; y += stepY) {
        for (let x = xStart; x < xEnd; x += stepX) {
            const idx = (y * width + x) * channels;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            totalBrightness += brightness;
            sampledPixels++;
        }
    }

    const avgInnerBrightness = totalBrightness / sampledPixels;
    const isDark = avgInnerBrightness < 125; // If inner area is dark, the slide is dark-themed!
    
    // 2. Compute averages for every row and column to selectively detect decorative bars (for light slides)
    const rowAverages = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            sum += 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
        }
        rowAverages[y] = sum / width;
    }

    const colAverages = new Float32Array(width);
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = 0; y < height; y++) {
            const idx = (y * width + x) * channels;
            sum += 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
        }
        colAverages[x] = sum / height;
    }

    // Gentle contrast stretch thresholds to completely avoid breaking thin/anti-aliased text
    const T_black = 20;   // Very gentle: Pushes near-black elements to black, leaving anti-aliasing intact
    const T_white = 235;  // Pushes near-white highlights to pure white, cleaning light backgrounds safely

    // 3. Process every pixel with zero spatial distortion or morphological damage
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            let gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            
            // Check if this pixel lies in outer margin boundaries (5%)
            const isNearEdge = x < xStart || x >= xEnd || y < yStart || y >= yEnd;
            
            if (isDark) {
                // Safeguard: If it is an original white margin/page boundary near the edge,
                // do NOT invert it (preserves white borders cleanly).
                if (isNearEdge && gray > 220) {
                    gray = 255; 
                } else {
                    gray = 255 - gray; // Precise linear color inversion (bijective, 0% content distortion)
                }
            } else {
                // For overall light slides:
                // Check if this pixel is inside a dark decorative row (header/footer) or column (side panel)
                const isHeader = y < height * 0.18;
                const isFooter = y > height * 0.82;
                const isLeftPanel = x < width * 0.15;
                const isRightPanel = x > width * 0.85;
                
                const isInDarkRow = (isHeader || isFooter) && rowAverages[y] < 110;
                const isInDarkCol = (isLeftPanel || isRightPanel) && colAverages[x] < 110;
                
                if (isInDarkRow || isInDarkCol) {
                    gray = 255 - gray; // Safely invert only the decorative bar elements
                }
            }
            
            // 4. Gentle Levels Adjustment (preserving anti-aliased font outlines and smooth edges)
            let finalGray;
            if (gray <= T_black) {
                finalGray = 0;
            } else if (gray >= T_white) {
                finalGray = 255;
            } else {
                finalGray = Math.round(255 * (gray - T_black) / (T_white - T_black));
            }
            
            data[idx] = finalGray;
            data[idx + 1] = finalGray;
            data[idx + 2] = finalGray;
            data[idx + 3] = 255; // Keep fully opaque
        }
    }
    
    await sharp(data, {
        raw: {
            width: width,
            height: height,
            channels: channels
        }
    })
    .png()
    .toFile(outputPath);
}

// Assemble final grid aligned PDF
// Assemble final grid aligned PDF
// Assemble final grid aligned PDF
async function assemblePdf(imagePaths, settings, outputPath) {
    const { slidesPerPage, orientation, pageSize } = settings;
    const numSlides = imagePaths.length;
    const slidesPerPageVal = parseInt(slidesPerPage, 10);
    
    const outputDoc = await PDFDocument.create();
    const helveticaFont = await outputDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Page Dimensions mapping in points (1/72 inch)
    const pageDimensions = {
        'A3': { width: 841.89, height: 1190.55 },
        'A4': { width: 595.27, height: 841.89 },
        'A5': { width: 419.53, height: 595.27 },
        'Letter': { width: 612.00, height: 792.00 },
        'Legal': { width: 612.00, height: 1008.00 },
        'Tabloid': { width: 792.00, height: 1224.00 },
        'Executive': { width: 522.00, height: 756.00 },
        'B4': { width: 708.66, height: 1000.63 },
        'B5': { width: 498.90, height: 708.66 }
    };
    
    const size = pageDimensions[pageSize] || pageDimensions['A4'];
    const isPortrait = orientation === 'portrait';
    const pageWidth = isPortrait ? size.width : size.height;
    const pageHeight = isPortrait ? size.height : size.width;
    
    // Read the actual aspect ratio of the first slide to run dynamic solver
    const firstImgMetadata = await sharp(imagePaths[0]).metadata();
    const slideRatio = (firstImgMetadata.width / firstImgMetadata.height) || (16 / 9);
    
    // Dynamic Layout Solver: Obtain optimal grid rows, columns, slide dimensions and scaled spaces
    const { 
        rows, 
        cols, 
        slideW, 
        slideH,
        marginX,
        marginY,
        spacingX,
        spacingY,
        labelHeight,
        scaleFactor
    } = getOptimalGrid(slidesPerPageVal, pageWidth, pageHeight, slideRatio, orientation);
    
    const printableWidth = pageWidth - 2 * marginX;
    const printableHeight = pageHeight - 2 * marginY;
    
    const cellWidth = (printableWidth - (cols - 1) * spacingX) / cols;
    const cellHeight = (printableHeight - (rows - 1) * spacingY) / rows;
    
    // Calculate adaptive font size for Slide label
    const labelFontSize = Math.max(6, Math.min(14, Math.round(8 * scaleFactor)));
    
    for (let pageIdx = 0; pageIdx < Math.ceil(numSlides / slidesPerPageVal); pageIdx++) {
        const page = outputDoc.addPage([pageWidth, pageHeight]);
        
        // Count slides to layout on this page
        const slidesOnPage = Math.min(slidesPerPageVal, numSlides - pageIdx * slidesPerPageVal);
        
        for (let cellIdx = 0; cellIdx < slidesOnPage; cellIdx++) {
            const slideIdx = pageIdx * slidesPerPageVal + cellIdx;
            
            let cellX = 0;
            let cellYBottom = 0;
            
            if (isPortrait) {
                // PORTRAIT MODE: Row-by-row layout (horizontally centered)
                let r, c, slidesInRow;
                
                if (slidesOnPage === 1) {
                    r = 0; c = 0; slidesInRow = 1;
                } else if (slidesOnPage === 2) {
                    r = cellIdx; c = 0; slidesInRow = 1;
                } else {
                    r = Math.floor(cellIdx / 2);
                    c = cellIdx % 2;
                    const totalRowsUsed = Math.ceil(slidesOnPage / 2);
                    const isLastRow = (r === totalRowsUsed - 1);
                    slidesInRow = isLastRow ? (slidesOnPage - r * 2) : 2;
                }
                
                // Calculate horizontally centered row X offset
                const rowOccupiedWidth = slidesInRow * cellWidth + (slidesInRow - 1) * spacingX;
                const rowOffsetX = marginX + (printableWidth - rowOccupiedWidth) / 2;
                
                cellX = rowOffsetX + c * (cellWidth + spacingX);
                const cellYTop = pageHeight - (marginY + r * (cellHeight + spacingY));
                cellYBottom = cellYTop - cellHeight;
                
            } else {
                // LANDSCAPE MODE: Column-by-column layout (vertically centered)
                let r, c, slidesInCol;
                
                if (slidesOnPage === 1) {
                    r = 0; c = 0; slidesInCol = 1;
                } else if (slidesOnPage === 2) {
                    r = 0; c = cellIdx; slidesInCol = 1;
                } else {
                    c = Math.floor(cellIdx / 2);
                    r = cellIdx % 2;
                    const totalColsUsed = Math.ceil(slidesOnPage / 2);
                    const isLastCol = (c === totalColsUsed - 1);
                    slidesInCol = isLastCol ? (slidesOnPage - c * 2) : 2;
                }
                
                // Calculate vertically centered column Y offset
                const colOccupiedHeight = slidesInCol * cellHeight + (slidesInCol - 1) * spacingY;
                const colOffsetY = marginY + (printableHeight - colOccupiedHeight) / 2;
                
                cellX = marginX + c * (cellWidth + spacingX);
                const cellYTop = pageHeight - (colOffsetY + r * (cellHeight + spacingY));
                cellYBottom = cellYTop - cellHeight;
            }
            
            const imgX = cellX + (cellWidth - slideW) / 2;
            const imgY = cellYBottom + (cellHeight - labelHeight - slideH) / 2;
            
            const imgPath = imagePaths[slideIdx];
            const imgBytes = fs.readFileSync(imgPath);
            const embeddedImg = await outputDoc.embedPng(imgBytes);
            
            page.drawImage(embeddedImg, {
                x: imgX,
                y: imgY,
                width: slideW,
                height: slideH
            });
            
            // Draw thin gray border
            page.drawRectangle({
                x: imgX,
                y: imgY,
                width: slideW,
                height: slideH,
                borderColor: rgb(0.8, 0.8, 0.8),
                borderWidth: 0.75
            });
            
            // Draw Slide label
            const labelText = `Slide - ${slideIdx + 1}`;
            const labelTextWidth = helveticaFont.widthOfTextAtSize(labelText, labelFontSize);
            const labelX = imgX + (slideW - labelTextWidth) / 2;
            const labelY = imgY + slideH + 3 * scaleFactor;
            
            page.drawText(labelText, {
                x: labelX,
                y: labelY,
                size: labelFontSize,
                font: helveticaFont,
                color: rgb(0.2, 0.2, 0.2)
            });
        }
    }
    
    const finalPdfBytes = await outputDoc.save();
    fs.writeFileSync(outputPath, finalPdfBytes);
}

// Clean up helper
function cleanDirRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                cleanDirRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(dirPath);
    }
}

// Core Asynchronous Processing Pipeline
async function runConversionPipeline(jobId, uploadedFilePath, originalExt, settings) {
    const jobTempDir = path.join(tempDir, jobId);
    const pagesDir = path.join(jobTempDir, 'pages');
    const imagesDir = path.join(jobTempDir, 'images');
    const cleanDir = path.join(jobTempDir, 'clean');
    
    fs.mkdirSync(jobTempDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(cleanDir, { recursive: true });

    const isWin = process.platform === 'win32';
    const sofficePath = isWin 
        ? `"C:\\Program Files\\LibreOffice\\program\\soffice.exe"` 
        : 'soffice';

    try {
        let pdfPath = '';
        
        // PHASE 1: Get single consolidated PDF
        if (originalExt === '.pptx') {
            jobs[jobId].status = 'converting_pptx';
            jobs[jobId].progress = 10;
            
            const cmd = `${sofficePath} --headless --convert-to pdf --outdir "${jobTempDir}" "${uploadedFilePath}"`;
            await execPromise(cmd);
            
            // Find converted PDF
            const baseName = path.basename(uploadedFilePath, originalExt);
            const convertedPdfPath = path.join(jobTempDir, baseName + '.pdf');
            if (!fs.existsSync(convertedPdfPath)) {
                throw new Error('LibreOffice PPTX to PDF conversion failed.');
            }
            pdfPath = convertedPdfPath;
        } else {
            // It is already a PDF
            pdfPath = path.join(jobTempDir, 'input.pdf');
            fs.copyFileSync(uploadedFilePath, pdfPath);
        }

        // PHASE 2: Split PDF into page-by-page PDFs
        jobs[jobId].status = 'splitting_pdf';
        jobs[jobId].progress = 20;

        const pdfBytes = fs.readFileSync(pdfPath);
        const srcDoc = await PDFDocument.load(pdfBytes);
        const pageCount = srcDoc.getPageCount();

        if (pageCount === 0) {
            throw new Error('The PDF document contains no pages.');
        }

        const pagePdfPaths = [];
        for (let i = 0; i < pageCount; i++) {
            const subDoc = await PDFDocument.create();
            const [copiedPage] = await subDoc.copyPages(srcDoc, [i]);
            subDoc.addPage(copiedPage);
            const subPdfBytes = await subDoc.save();
            
            const subPdfPath = path.join(pagesDir, `page_${i}.pdf`);
            fs.writeFileSync(subPdfPath, subPdfBytes);
            pagePdfPaths.push(subPdfPath);
        }

        // PHASE 3: Rasterize pages into PNGs
        jobs[jobId].status = 'rendering_slides';
        jobs[jobId].progress = 30;

        const rawPngPaths = [];
        for (let i = 0; i < pageCount; i++) {
            const pagePdfPath = pagePdfPaths[i];
            const cmd = `${sofficePath} --headless --convert-to png --outdir "${imagesDir}" "${pagePdfPath}"`;
            await execPromise(cmd);
            
            const expectedPngPath = path.join(imagesDir, `page_${i}.png`);
            if (!fs.existsSync(expectedPngPath)) {
                throw new Error(`Failed to render slide page ${i + 1} to image.`);
            }
            rawPngPaths.push(expectedPngPath);
            
            // Update rasterization progress (range: 30% - 50%)
            jobs[jobId].progress = 30 + Math.round((i + 1) / pageCount * 20);
        }

        // PHASE 4: Slide cleaning & background stripping
        jobs[jobId].status = 'cleaning_images';
        jobs[jobId].progress = 50;

        const cleanPngPaths = [];
        for (let i = 0; i < pageCount; i++) {
            const rawPngPath = rawPngPaths[i];
            const cleanPngPath = path.join(cleanDir, `clean_page_${i}.png`);
            
            if (settings.printFriendly === 'true' || settings.printFriendly === true) {
                await cleanImage(rawPngPath, cleanPngPath);
            } else {
                // Skip cleaning: convert to grayscale only
                await sharp(rawPngPath).grayscale().toFile(cleanPngPath);
            }
            
            cleanPngPaths.push(cleanPngPath);
            
            // Update cleaning progress (range: 50% - 70%)
            jobs[jobId].progress = 50 + Math.round((i + 1) / pageCount * 20);
        }

        // PHASE 5: Assemble pages back into the final grid PDF
        jobs[jobId].status = 'generating_pdf';
        jobs[jobId].progress = 70;

        const outputFilename = `${jobId}_cleaned_slides.pdf`;
        const finalPdfPath = path.join(downloadsDir, outputFilename);
        
        await assemblePdf(cleanPngPaths, settings, finalPdfPath);

        // Update job completion
        jobs[jobId].status = 'completed';
        jobs[jobId].progress = 100;
        jobs[jobId].downloadUrl = `/api/download/${jobId}`;

    } catch (err) {
        console.error(`Error in conversion pipeline for job ${jobId}:`, err);
        jobs[jobId].status = 'failed';
        jobs[jobId].error = err.message || 'Unknown processing error.';
    } finally {
        // Clean up temporary uploads and temp working folder
        try {
            if (fs.existsSync(uploadedFilePath)) {
                fs.unlinkSync(uploadedFilePath);
            }
            cleanDirRecursive(jobTempDir);
        } catch (cleanupErr) {
            console.error(`Error cleaning up folders for job ${jobId}:`, cleanupErr);
        }
    }
}

// UPLOAD ENDPOINT
app.post('/api/upload', upload.single('slideFile'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const jobId = 'job_' + Date.now() + '_' + Math.round(Math.random() * 10000);
        const settings = {
            slidesPerPage: req.body.slidesPerPage || '4',
            orientation: req.body.orientation || 'portrait',
            pageSize: req.body.pageSize || 'A4',
            printFriendly: req.body.printFriendly !== 'false' // default true
        };

        // Create job record
        jobs[jobId] = {
            id: jobId,
            filename: req.file.originalname,
            status: 'queued',
            progress: 0,
            error: null,
            downloadUrl: null
        };

        // Run the pipeline asynchronously
        const uploadedFilePath = req.file.path;
        const originalExt = path.extname(req.file.originalname).toLowerCase();
        
        runConversionPipeline(jobId, uploadedFilePath, originalExt, settings);

        // Instantly return the jobId to the client
        res.json({ jobId: jobId });

    } catch (err) {
        console.error('Upload handling error:', err);
        res.status(500).json({ error: 'Internal server error during upload.' });
    }
});

// STATUS ENDPOINT
app.get('/api/status/:jobId', (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) {
        return res.status(404).json({ error: 'Job not found.' });
    }
    res.json(job);
});

// DOWNLOAD ENDPOINT
app.get('/api/download/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs[jobId];
    if (!job || job.status !== 'completed') {
        return res.status(404).json({ error: 'Clean PDF is not ready or job does not exist.' });
    }

    const filename = `${jobId}_cleaned_slides.pdf`;
    const filePath = path.join(downloadsDir, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Clean PDF file not found on disk.' });
    }

    res.download(filePath, 'cleaned_slides.pdf');
});

// Fallback HTML router
app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Start express server
app.listen(PORT, () => {
    console.log(`CleanSlide PDF server is listening at http://localhost:${PORT}`);
});
