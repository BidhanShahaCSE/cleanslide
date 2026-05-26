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
    const slidesButtons = document.querySelectorAll('.slides-btn');
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
    
    // Slides per page buttons selection
    slidesButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            slidesButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedSlides = btn.getAttribute('data-value');
        });
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
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }

    // ==========================================
    // CONVERSION GENERATION ACTION
    // ==========================================
    generateBtn.addEventListener('click', () => {
        if (!selectedFile) return;

        isProcessing = true; // Lock state to true during active run

        // Reset states
        downloadContainer.classList.add('hidden');
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '0%';
        progressPercentage.textContent = '0%';
        progressStep.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-accent-purple"></i><span>Initializing pipeline...</span>`;
        lucide.createIcons();

        // Lock inputs and add pulse glow animation to card
        generateBtn.disabled = true;
        generateBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Processing...</span>`;
        dropzone.classList.add('active-glow');

        // Build FormData
        const formData = new FormData();
        formData.append('slideFile', selectedFile);
        formData.append('slidesPerPage', selectedSlides);
        formData.append('orientation', selectedOrientation);
        formData.append('printFriendly', isPrintFriendly);

        // Post request to backend upload endpoint
        fetch('/api/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { throw new Error(err.error || 'Server error uploading file.') });
            }
            return response.json();
        })
        .then(data => {
            const jobId = data.jobId;
            showToast('info', 'Processing Started', 'Asynchronous rendering engine triggered. Polling status...');
            startProgressPolling(jobId);
        })
        .catch(err => {
            console.error('Processing error:', err);
            isProcessing = false;
            showToast('error', 'Generation Failed', err.message || 'An error occurred during submission.');
            resetGenerateBtnState();
        });
    });

    // Reset generate button state after errors
    function resetGenerateBtnState() {
        generateBtn.disabled = false;
        generateBtn.innerHTML = `<i data-lucide="zap" class="w-4 h-4"></i><span>Clean Slides & Generate PDF</span>`;
        dropzone.classList.remove('active-glow');
        progressContainer.classList.add('hidden');
    }

    // Start progress polling loop
    function startProgressPolling(jobId) {
        if (pollingInterval) clearInterval(pollingInterval);

        pollingInterval = setInterval(() => {
            fetch(`/api/status/${jobId}`)
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch status updates.');
                return res.json();
            })
            .then(job => {
                updateProgressUI(job);

                if (job.status === 'completed') {
                    handleJobSuccess(job);
                } else if (job.status === 'failed') {
                    handleJobFailure(job);
                }
            })
            .catch(err => {
                console.error('Polling fetch error:', err);
                showToast('error', 'Connection Error', 'Status poll connection interrupted.');
                clearInterval(pollingInterval);
                resetGenerateBtnState();
            });
        }, 850);
    }

    // Step names map for clean readable updates
    const stepLabels = {
        'queued': 'Queued in processing...',
        'converting_pptx': 'Converting PPTX via LibreOffice headless...',
        'splitting_pdf': 'Splitting PDF into single pages...',
        'rendering_slides': 'Rasterizing slide vectors...',
        'cleaning_images': 'Stripping colored backgrounds & curves...',
        'generating_pdf': 'Formatting grid pages & borders...'
    };

    // Update progress elements
    function updateProgressUI(job) {
        const percent = job.progress || 0;
        progressBar.style.width = `${percent}%`;
        progressPercentage.textContent = `${percent}%`;

        const stepMsg = stepLabels[job.status] || 'Processing slides...';
        progressStep.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-accent-purple"></i><span>${stepMsg}</span>`;
        lucide.createIcons();
    }

    // Success transition
    function handleJobSuccess(job) {
        if (!isProcessing) return;
        isProcessing = false;

        clearInterval(pollingInterval);
        pollingInterval = null;
        
        // Remove loading state borders and reset trigger buttons
        dropzone.classList.remove('active-glow');
        progressContainer.classList.add('hidden');
        
        generateBtn.disabled = false;
        generateBtn.innerHTML = `<i data-lucide="zap" class="w-4 h-4"></i><span>Clean Slides & Generate PDF</span>`;

        // Update download triggers
        downloadLink.href = job.downloadUrl;
        downloadContainer.classList.remove('hidden');

        showToast('success', 'PDF Ready!', 'Lecture slides cleaned and grid formatted. Download ready.');
    }

    // Failure transition
    function handleJobFailure(job) {
        if (!isProcessing) return;
        isProcessing = false;

        clearInterval(pollingInterval);
        pollingInterval = null;
        resetGenerateBtnState();
        showToast('error', 'Pipeline Error', job.error || 'Failed to complete slide cleaning pipeline.');
    }
});
