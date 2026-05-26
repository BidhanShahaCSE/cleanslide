const fs = require('fs');
const path = require('path');

async function testUpload() {
    const fileBytes = fs.readFileSync(path.join(__dirname, 'test_input.pdf'));
    const blob = new Blob([fileBytes], { type: 'application/pdf' });
    const formData = new FormData();
    formData.append('slideFile', blob, 'test_input.pdf');
    formData.append('slidesPerPage', '2'); // Let's lay out 2 slides per page
    formData.append('orientation', 'portrait');
    formData.append('printFriendly', 'true');

    console.log('Sending upload request to http://localhost:3000/api/upload ...');
    const res = await fetch('http://localhost:3000/api/upload', {
        method: 'POST',
        body: formData
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error('Upload failed:', errText);
        return;
    }

    const data = await res.json();
    const jobId = data.jobId;
    console.log('Upload successful! Job ID:', jobId);

    // Poll status every second
    const poll = setInterval(async () => {
        try {
            const statusRes = await fetch(`http://localhost:3000/api/status/${jobId}`);
            if (!statusRes.ok) {
                console.error('Failed to poll status.');
                return;
            }
            const job = await statusRes.json();
            console.log(`Job Status: ${job.status} | Progress: ${job.progress}%`);
            
            if (job.status === 'completed') {
                clearInterval(poll);
                console.log('Pipeline complete! Download URL:', job.downloadUrl);
                
                // Retrieve output file
                const dlRes = await fetch(`http://localhost:3000${job.downloadUrl}`);
                if (dlRes.ok) {
                    const pdfBuffer = Buffer.from(await dlRes.arrayBuffer());
                    fs.writeFileSync(path.join(__dirname, 'cleaned_slides.pdf'), pdfBuffer);
                    console.log('SUCCESS: Cleaned PDF downloaded and saved to: f:\\cleanslide\\cleaned_slides.pdf');
                    process.exit(0);
                } else {
                    console.error('Download failed!');
                    process.exit(1);
                }
            } else if (job.status === 'failed') {
                clearInterval(poll);
                console.error('FAILURE: Pipeline failed with error:', job.error);
                process.exit(1);
            }
        } catch (e) {
            console.error('Polling error:', e);
            clearInterval(poll);
            process.exit(1);
        }
    }, 1000);
}

testUpload().catch(console.error);
