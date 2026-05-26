const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function verify() {
    const downloadsDir = path.join(__dirname, 'public', 'downloads');
    const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.pdf'));
    
    if (files.length === 0) {
        console.error('No PDF files found in downloads directory.');
        process.exit(1);
    }
    
    const targetFile = path.join(downloadsDir, files[0]);
    console.log('Verifying generated PDF:', targetFile);
    
    const bytes = fs.readFileSync(targetFile);
    const doc = await PDFDocument.load(bytes);
    
    const pageCount = doc.getPageCount();
    console.log('PDF Page Count:', pageCount);
    
    for (let i = 0; i < pageCount; i++) {
        const page = doc.getPage(i);
        const { width, height } = page.getSize();
        console.log(`Page ${i + 1} size: Width = ${width.toFixed(2)} pt, Height = ${height.toFixed(2)} pt`);
        // A4 size should be approximately 595.27 x 841.89
        if (Math.abs(width - 595.27) < 1 && Math.abs(height - 841.89) < 1) {
            console.log(`Page ${i + 1} is verified as A4 size in Portrait orientation!`);
        } else if (Math.abs(width - 841.89) < 1 && Math.abs(height - 595.27) < 1) {
            console.log(`Page ${i + 1} is verified as A4 size in Landscape orientation!`);
        } else {
            console.error(`Page ${i + 1} is NOT standard A4 size.`);
        }
    }
    
    console.log('PDF load validation successful!');
    process.exit(0);
}

verify().catch(console.error);
