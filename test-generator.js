const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

async function createTestPdf() {
    const doc = await PDFDocument.create();
    
    // Page 1: Dark slide (Black background, white text)
    const page1 = doc.addPage([800, 450]); // 16:9 slide size
    page1.drawRectangle({
        x: 0,
        y: 0,
        width: 800,
        height: 450,
        color: rgb(0.05, 0.05, 0.1) // near black dark blue background
    });
    page1.drawText('Test Slide 1: Dark Background', {
        x: 100,
        y: 300,
        size: 36,
        color: rgb(0.9, 0.9, 0.9) // light white/gray text
    });
    page1.drawText('This slide is dark and should be completely inverted to white background.', {
        x: 100,
        y: 200,
        size: 18,
        color: rgb(0.8, 0.8, 0.8)
    });
    
    // Page 2: Light colored slide (Light blue background, dark text)
    const page2 = doc.addPage([800, 450]);
    page2.drawRectangle({
        x: 0,
        y: 0,
        width: 800,
        height: 450,
        color: rgb(0.9, 0.95, 1.0) // very light sky blue colored background
    });
    page2.drawText('Test Slide 2: Light Colored Background', {
        x: 100,
        y: 300,
        size: 36,
        color: rgb(0.1, 0.1, 0.2) // dark text
    });
    page2.drawText('This background is light blue and should be stripped to pure white.', {
        x: 100,
        y: 200,
        size: 18,
        color: rgb(0.2, 0.2, 0.3)
    });

    const bytes = await doc.save();
    const outputPath = path.join(__dirname, 'test_input.pdf');
    fs.writeFileSync(outputPath, bytes);
    console.log('Test PDF created successfully at:', outputPath);
}

createTestPdf();
