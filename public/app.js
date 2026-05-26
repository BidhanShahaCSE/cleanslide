// CleanSlide Client Application Logic

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const uploadPrompt = document.getElementById('uploadPrompt');
    const fileSelectedState = document.getElementById('fileSelectedState');
    const selectedFilename = document.getElementById('selectedFilename');
    const selectedFileSize = document.getElementById('selectedFileSize');
    const fileIconContainer = document.getElementById('fileIconContainer');
    const fileIcon = document.getElementById('fileIcon');
    const removeFileBtn = document.getElementById('removeFileBtn');

    // Settings elements
    const slidesPerPageSelect = document.getElementById('slidesPerPageSelect');
    const slidesLivePreview = document.getElementById('slidesLivePreview');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const orientPortrait = document.getElementById('orientPortrait');
    const orientLandscape = document.getElementById('orientLandscape');
    const printFriendlyToggle = document.getElementById('printFriendlyToggle');

    // Progress elements
    const progressContainer = document.getElementById('progressContainer');
    const progressStep = document.getElementById('progressStep');
    const progressPercentage = document.getElementById('progressPercentage');
    const progressBar = document.getElementById('progressBar');

    // Action buttons
    const generateBtn = document.getElementById('generateBtn');
    const downloadContainer = document.getElementById('downloadContainer');
    const downloadLink = document.getElementById('downloadLink');

    // Toast Container
    const toastContainer = document.getElementById('toastContainer');

    // Application State Variables
    let selectedFile = null;
    let selectedSlides = '4'; // default
    let selectedOrientation = 'portrait'; // default
    let selectedPageSize = 'A4'; // default
    let isPrintFriendly = true; // default
    let pollingInterval = null;
    let isProcessing = false; // State guard to prevent duplicate success/failure toasts

    // Initialize Lucide Icons
    lucide.createIcons();

    // ==========================================
    // TOAST NOTIFICATION CONTROLLER
    // ==========================================
    function showToast(type, title, message) {
        const toast = document.createElement('div');
        toast.className = `toast-item flex items-start space-x-3 bg-dark-900/90 backdrop-blur-xl border border-white/5 p-4 rounded-2xl w-80 shadow-2xl pointer-events-auto`;
        
        let iconHtml = '';
        if (type === 'success') {
            iconHtml = `<div class="p-1.5 rounded-lg bg-green-500/10 text-green-500 border border-green-500/20"><i data-lucide="check-circle" class="w-4 h-4"></i></div>`;
        } else if (type === 'error') {
            iconHtml = `<div class="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20"><i data-lucide="alert-triangle" class="w-4 h-4"></i></div>`;
        } else {
            iconHtml = `<div class="p-1.5 rounded-lg bg-accent-blue/10 text-accent-blue border border-accent-blue/20"><i data-lucide="info" class="w-4 h-4"></i></div>`;
        }

        toast.innerHTML = `
            ${iconHtml}
            <div class="flex-grow space-y-0.5">
                <h4 class="text-sm font-semibold text-white">${title}</h4>
                <p class="text-xs text-gray-400 leading-normal">${message}</p>
            </div>
            <button class="toast-close text-gray-500 hover:text-gray-300 transition-colors"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
        `;

        toastContainer.appendChild(toast);
        lucide.createIcons({ attrs: { class: ['w-4', 'h-4'] } });

        // Bind close event
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.classList.add('opacity-0', 'scale-95');
            setTimeout(() => toast.remove(), 250);
        });

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('opacity-0', 'scale-95');
                setTimeout(() => toast.remove(), 250);
            }
        }, 5000);
    }

    // File size formatter utility
    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // ==========================================
    // SETTINGS CONTROL BINDINGS
    // ==========================================
    
    // Slides per page custom dropdown select binding
    slidesPerPageSelect.addEventListener('change', (e) => {
        selectedSlides = e.target.value;
        slidesLivePreview.textContent = `Selected: ${selectedSlides} slides per page`;
    });

    // Page size dropdown select binding
    pageSizeSelect.addEventListener('change', (e) => {
        selectedPageSize = e.target.value;
    });

    // Page orientation bindings
    orientPortrait.addEventListener('click', () => {
        orientPortrait.classList.add('active');
        orientLandscape.classList.remove('active');
        selectedOrientation = 'portrait';
    });

    orientLandscape.addEventListener('click', () => {
        orientLandscape.classList.add('active');
        orientPortrait.classList.remove('active');
        selectedOrientation = 'landscape';
    });

    // Print Friendly toggle binding
    printFriendlyToggle.addEventListener('click', () => {
        isPrintFriendly = !isPrintFriendly;
        if (isPrintFriendly) {
            printFriendlyToggle.classList.add('active');
        } else {
            printFriendlyToggle.classList.remove('active');
        }
    });

    // ==========================================
    // UPLOAD AREA DRAG & DROP & CLICK HANDLERS
    // ==========================================
    
    // Open picker on dropzone click
    dropzone.addEventListener('click', (e) => {
        // Prevent click trigger when removing file
        if (e.target.closest('#removeFileBtn') || e.target.closest('button')) {
            return;
        }
        fileInput.click();
    });

    // Drag-over styling
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-accent-purple/60', 'bg-accent-purple/5');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('border-accent-purple/60', 'bg-accent-purple/5');
    });

    // Drop file handler
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-accent-purple/60', 'bg-accent-purple/5');
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });

    // Native file input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    // Remove file action
    removeFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetFileSelection();
    });

    // Handle selected file details and UI transition
    function handleFileSelection(file) {
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        if (ext !== '.pptx' && ext !== '.pdf') {
            showToast('error', 'Unsupported File Type', 'Please upload a PowerPoint (.pptx) or PDF (.pdf) file.');
            return;
        }

        selectedFile = file;

        // Transition UI states
        uploadPrompt.classList.add('hidden');
        fileSelectedState.classList.remove('hidden');
        
        // Show correct icon and background styling
        fileIconContainer.className = 'w-16 h-16 rounded-2xl flex items-center justify-center text-white transition-all duration-300 shadow-lg';
        if (ext === '.pptx') {
            fileIconContainer.classList.add('file-bg-pptx');
            fileIcon.setAttribute('data-lucide', 'presentation');
        } else {
            fileIconContainer.classList.add('file-bg-pdf');
            fileIcon.setAttribute('data-lucide', 'file-text');
        }
        lucide.createIcons();

        // Details text
        selectedFilename.textContent = file.name;
        selectedFileSize.textContent = formatBytes(file.size);

        // Update Generate button eligibility
        generateBtn.disabled = false;
        generateBtn.className = "w-full py-4 px-6 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center justify-center space-x-2 bg-gradient-to-r from-accent-purple to-accent-blue hover:from-accent-purple/90 hover:to-accent-blue/90 text-white cursor-pointer border border-accent-purple/20 shadow-lg shadow-accent-purple/10 active:scale-[0.98]";

        showToast('info', 'File Loaded Successfully', `${file.name} is ready for processing.`);
    }

    // Reset file selections to blank slate
    function resetFileSelection() {
        selectedFile = null;
        fileInput.value = '';

        // Transition UI elements back
        fileSelectedState.classList.add('hidden');
        uploadPrompt.classList.remove('hidden');

        // Reset Generate button
        generateBtn.disabled = true;
        generateBtn.className = "w-full py-4 px-6 rounded-xl font-semibold text-sm transition-all duration-300 flex items-center justify-center space-x-2 bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700 shadow-md";

        // Reset other states
        progressContainer.classList.add('hidden');
        downloadContainer.classList.add('hidden');
        dropzone.classList.remove('active-glow');
        
        if (pollingInterval) {
            clearTimeout(pollingInterval);
            pollingInterval = null;
        }
    }

    // ==========================================
    // CONVERSION GENERATION ACTION
    // ==========================================
    generateBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        isProcessing = true;

        // Reset states
        downloadContainer.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressPercentage.textContent = '0%';
        progressStep.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-accent-purple"></i><span>Waking server...</span>`;
        lucide.createIcons();

        // Lock inputs
        generateBtn.disabled = true;
        generateBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Processing...</span>`;
        dropzone.classList.add('active-glow');

        // STEP 1: Wake server (handles Render cold starts)
        const serverReady = await wakeServer();
        if (!serverReady) {
            showToast('error', 'Server Unavailable', 'Could not connect to CleanSlide server. Please try again later.');
            resetGenerateBtnState();
            isProcessing = false;
            return;
        }

        progressStep.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-accent-purple"></i><span>Uploading file...</span>`;
        lucide.createIcons();

        // STEP 2: Upload with timeout
        try {
            const formData = new FormData();
            formData.append('slideFile', selectedFile);
            formData.append('slidesPerPage', selectedSlides);
            formData.append('orientation', selectedOrientation);
            formData.append('pageSize', selectedPageSize);
            formData.append('printFriendly', isPrintFriendly);

            const controller = new AbortController();
            const uploadTimeout = setTimeout(() => controller.abort(), 300000); // 5 min upload timeout

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
            clearTimeout(uploadTimeout);

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Server error uploading file.');
            }

            const data = await response.json();
            showToast('info', 'Processing Started', 'Slide processing pipeline triggered.');
            startProgressPolling(data.jobId);

        } catch (err) {
            console.error('Upload error:', err);
            isProcessing = false;
            const msg = err.name === 'AbortError'
                ? 'Upload timed out. The file may be too large or the server is busy.'
                : (err.message || 'An error occurred during submission.');
            showToast('error', 'Upload Failed', msg);
            resetGenerateBtnState();
        }
    });

    // ==========================================
    // SERVER WAKE / COLD START DETECTION
    // ==========================================
    async function wakeServer() {
        const maxWakeAttempts = 5;
        for (let attempt = 1; attempt <= maxWakeAttempts; attempt++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000); // 8 sec per attempt
                const res = await fetch('/api/health', { signal: controller.signal });
                clearTimeout(timeout);
                if (res.ok) return true;
            } catch (e) {
                console.warn(`Wake attempt ${attempt}/${maxWakeAttempts} failed:`, e.message);
            }

            // Update inline status (no toast spam)
            const msg = attempt === 1
                ? 'Connecting to server...'
                : `Server is waking up... (Attempt ${attempt}/${maxWakeAttempts})`;
            progressStep.innerHTML = `<i data-lucide="wifi-off" class="w-3.5 h-3.5 text-yellow-500 animate-pulse"></i><span class="text-yellow-400 font-medium">${msg}</span>`;
            lucide.createIcons();

            // Wait before retry with linear backoff
            await new Promise(r => setTimeout(r, 3000 * attempt));
        }
        return false;
    }

    // Reset generate button state after errors
    function resetGenerateBtnState() {
        generateBtn.disabled = false;
        generateBtn.innerHTML = `<i data-lucide="zap" class="w-4 h-4"></i><span>Clean Slides & Generate PDF</span>`;
        dropzone.classList.remove('active-glow');
        progressContainer.classList.add('hidden');
    }

    // ==========================================
    // ROBUST PROGRESS POLLING WITH EXPONENTIAL BACKOFF
    // ==========================================
    function startProgressPolling(jobId) {
        if (pollingInterval) {
            clearTimeout(pollingInterval);
            pollingInterval = null;
        }

        let consecutiveErrors = 0;
        const maxRetries = 15;       // More retries for slow Render instances
        const baseDelay = 1200;      // Start slower to avoid network spam
        let lastErrorShown = false;  // Guard: only show reconnecting status once per error streak

        async function poll() {
            if (!isProcessing) return;

            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000); // 10 sec poll timeout

                const res = await fetch(`/api/status/${jobId}`, { signal: controller.signal });
                clearTimeout(timeout);

                if (!res.ok) {
                    throw new Error(`Server responded with status: ${res.status}`);
                }

                const job = await res.json();

                // Success: reset error state
                consecutiveErrors = 0;
                lastErrorShown = false;

                updateProgressUI(job);

                if (job.status === 'completed') {
                    handleJobSuccess(job);
                } else if (job.status === 'failed') {
                    handleJobFailure(job);
                } else {
                    // Queue next poll — slow down when far from completion
                    const adaptiveDelay = job.progress > 60 ? 1000 : baseDelay;
                    pollingInterval = setTimeout(poll, adaptiveDelay);
                }
            } catch (err) {
                console.warn('Polling error:', err.message);
                consecutiveErrors++;

                if (consecutiveErrors >= maxRetries) {
                    // Final failure after all retries exhausted
                    showToast('error', 'Connection Lost', 'Lost contact with the server after multiple retries. Please try again.');
                    resetGenerateBtnState();
                    isProcessing = false;
                    return;
                }

                // Exponential backoff: 1.8s, 2.7s, 4s, 6s, 9s... capped at 15s
                const backoffDelay = Math.min(15000, baseDelay * Math.pow(1.5, consecutiveErrors));

                // Show inline reconnection status (NO toast spam)
                if (!lastErrorShown || consecutiveErrors % 3 === 0) {
                    let userMsg;
                    if (consecutiveErrors <= 2) {
                        userMsg = `Connection hiccup. Reconnecting... (${consecutiveErrors}/${maxRetries})`;
                    } else if (consecutiveErrors <= 6) {
                        userMsg = `Server busy or sleeping. Waking up... (${consecutiveErrors}/${maxRetries})`;
                    } else {
                        userMsg = `Still trying to reconnect... (${consecutiveErrors}/${maxRetries})`;
                    }
                    progressStep.innerHTML = `<i data-lucide="wifi-off" class="w-3.5 h-3.5 text-rose-500 animate-pulse"></i><span class="text-rose-400 font-medium">${userMsg}</span>`;
                    lucide.createIcons();
                    lastErrorShown = true;
                }

                pollingInterval = setTimeout(poll, backoffDelay);
            }
        }

        // Start first poll after a short initial delay
        pollingInterval = setTimeout(poll, 1500);
    }

    // ==========================================
    // PROGRESS UI & STATUS LABEL MAP
    // ==========================================
    const stepLabels = {
        'queued': 'Initializing job...',
        'converting_pptx': 'Converting PPTX to PDF (LibreOffice)...',
        'splitting_pdf': 'Splitting document into slide pages...',
        'rendering_slides': 'Rendering & cleaning slide images...',
        'cleaning_images': 'Stripping decorative backgrounds...',
        'generating_pdf': 'Assembling print-ready PDF handouts...'
    };

    function updateProgressUI(job) {
        const percent = job.progress || 0;
        progressBar.style.width = `${percent}%`;
        progressPercentage.textContent = `${percent}%`;

        const stepMsg = stepLabels[job.status] || 'Processing slides...';
        progressStep.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-accent-purple"></i><span>${stepMsg}</span>`;
        lucide.createIcons();
    }

    // ==========================================
    // JOB COMPLETION HANDLERS
    // ==========================================
    function handleJobSuccess(job) {
        if (!isProcessing) return;
        isProcessing = false;

        clearTimeout(pollingInterval);
        pollingInterval = null;

        dropzone.classList.remove('active-glow');
        progressContainer.classList.add('hidden');

        generateBtn.disabled = false;
        generateBtn.innerHTML = `<i data-lucide="zap" class="w-4 h-4"></i><span>Clean Slides & Generate PDF</span>`;

        downloadLink.href = job.downloadUrl;
        downloadContainer.classList.remove('hidden');

        showToast('success', 'PDF Ready!', 'Lecture slides cleaned and grid formatted. Download ready.');
    }

    function handleJobFailure(job) {
        if (!isProcessing) return;
        isProcessing = false;

        clearTimeout(pollingInterval);
        pollingInterval = null;
        resetGenerateBtnState();
        showToast('error', 'Pipeline Error', job.error || 'Failed to complete slide cleaning pipeline.');
    }
});
