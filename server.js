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

// Grid configuration mapping for PDF layout
const gridConfigs = {
    portrait: {
        1: { rows: 1, cols: 1 },
        2: { rows: 2, cols: 1 },
        4: { rows: 2, cols: 2 },
        6: { rows: 3, cols: 2 },
        8: { rows: 4, cols: 2 }
    },
    landscape: {
        1: { rows: 1, cols: 1 },
        2: { rows: 1, cols: 2 },
        4: { rows: 2, cols: 2 },
        6: { rows: 2, cols: 3 },
        8: { rows: 2, cols: 4 }
    }
};

// Corner brightness calculation & levels adjustment
async function cleanImage(inputPath, outputPath) {
    const img = sharp(inputPath);
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    
    // Sample the inner 90% of the image to detect the background theme, ignoring outer margins
    const xStart = Math.floor(width * 0.05);
    const xEnd = Math.floor(width * 0.95);
    const yStart = Math.floor(height * 0.05);
    const yEnd = Math.floor(height * 0.95);

    let totalBrightness = 0;
    let sampledPixels = 0;
    
    // Sample a grid of pixels for high performance and accuracy
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
    const isDark = avgInnerBrightness < 120; // If inner area is dark, the slide is dark-themed!
    
    // Contrast level settings for text & background cleaning
    const T_black = 60;   // Dark colors pushed to pure black
    const T_white = 215;  // Light backgrounds pushed to pure white

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            let gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            
            // Check if this pixel is in the outer margin (5% boundary)
            const isNearEdge = x < xStart || x >= xEnd || y < yStart || y >= yEnd;
            
            if (isDark) {
                // Safeguard: If it is an original white margin/page boundary near the edge,
                // do NOT invert it to black (preserves white page borders).
                if (isNearEdge && gray > 220) {
                    gray = 255; 
                } else {
                    gray = 255 - gray; // Invert to white background & black text
                }
            }
            
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
            data[idx + 3] = 255; // Fully opaque
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
async function assemblePdf(imagePaths, settings, outputPath) {
    const { slidesPerPage, orientation, printFriendly } = settings;
    const numSlides = imagePaths.length;
    const slidesPerPageVal = parseInt(slidesPerPage, 10);
    
    const outputDoc = await PDFDocument.create();
    const helveticaFont = await outputDoc.embedFont(StandardFonts.HelveticaBold);
    
    const a4Width = 595.27;
    const a4Height = 841.89;
    
    const isPortrait = orientation === 'portrait';
    const pageWidth = isPortrait ? a4Width : a4Height;
    const pageHeight = isPortrait ? a4Height : a4Width;
    
    const config = gridConfigs[orientation][slidesPerPageVal] || { rows: 1, cols: 1 };
    const { rows, cols } = config;
    
    const marginX = 25;
    const marginY = 30;
    const spacingX = 20;
    const spacingY = 25;
    const labelHeight = 15;
    
    const printableWidth = pageWidth - 2 * marginX;
    const printableHeight = pageHeight - 2 * marginY;
    
    const cellWidth = (printableWidth - (cols - 1) * spacingX) / cols;
    const cellHeight = (printableHeight - (rows - 1) * spacingY) / rows;
    
    const maxSlideWidth = cellWidth;
    const maxSlideHeight = cellHeight - labelHeight;
    
    for (let pageIdx = 0; pageIdx < Math.ceil(numSlides / slidesPerPageVal); pageIdx++) {
        const page = outputDoc.addPage([pageWidth, pageHeight]);
        
        for (let cellIdx = 0; cellIdx < slidesPerPageVal; cellIdx++) {
            const slideIdx = pageIdx * slidesPerPageVal + cellIdx;
            if (slideIdx >= numSlides) break;
            
            const r = Math.floor(cellIdx / cols);
            const c = cellIdx % cols;
            
            const cellX = marginX + c * (cellWidth + spacingX);
            const cellYTop = pageHeight - (marginY + r * (cellHeight + spacingY));
            const cellYBottom = cellYTop - cellHeight;
            
            const imgPath = imagePaths[slideIdx];
            const imgMetadata = await sharp(imgPath).metadata();
            const slideRatio = imgMetadata.width / imgMetadata.height;
            
            let w = maxSlideWidth;
            let h = w / slideRatio;
            if (h > maxSlideHeight) {
                h = maxSlideHeight;
                w = h * slideRatio;
            }
            
            const imgX = cellX + (cellWidth - w) / 2;
            const imgY = cellYBottom + (cellHeight - labelHeight - h) / 2;
            
            const imgBytes = fs.readFileSync(imgPath);
            const embeddedImg = await outputDoc.embedPng(imgBytes);
            
            page.drawImage(embeddedImg, {
                x: imgX,
                y: imgY,
                width: w,
                height: h
            });
            
            // Draw thin gray border
            page.drawRectangle({
                x: imgX,
                y: imgY,
                width: w,
                height: h,
                borderColor: rgb(0.8, 0.8, 0.8),
                borderWidth: 0.75
            });
            
            // Draw Slide label
            const labelText = `Slide - ${slideIdx + 1}`;
            const labelTextWidth = helveticaFont.widthOfTextAtSize(labelText, 8);
            const labelX = imgX + (w - labelTextWidth) / 2;
            const labelY = imgY + h + 3;
            
            page.drawText(labelText, {
                x: labelX,
                y: labelY,
                size: 8,
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
