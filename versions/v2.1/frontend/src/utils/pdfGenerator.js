import html2pdf from 'html2pdf.js';

/**
 * Generates a PDF from a DOM element.
 * 
 * @param {HTMLElement} element - The DOM element to convert to PDF.
 * @param {string} filename - The name of the downloaded file.
 * @param {object} options - Optional configuration overrides.
 */
export const generatePDF = async (element, filename = 'report.pdf', options = {}) => {
    if (!element) {
        console.error('generatePDF: Element not found');
        return;
    }

    console.log('[PDF] Generating:', filename);

    // Default configuration
    const defaultOptions = {
        margin: [0, 0, 0, 0], // Margins handled by CSS
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            letterRendering: true,
            allowTaint: true
        },
        jsPDF: {
            unit: 'mm',
            format: 'a4',
            orientation: 'landscape',
            compress: true
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    const config = { ...defaultOptions, ...options };
    config.jsPDF = { ...defaultOptions.jsPDF, ...(options.jsPDF || {}) };

    // Clone the element to avoid modifying the live UI
    const clone = element.cloneNode(true);

    // Create a temporary container
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = config.jsPDF.orientation === 'portrait' ? '210mm' : '297mm';
    container.style.zIndex = '-9999';
    container.style.backgroundColor = 'white';
    container.style.opacity = '0'; // Hide from user but keep 'visible' for capture
    container.style.pointerEvents = 'none';

    // Apply export class to the clone
    clone.classList.add('pdf-export-active');

    container.appendChild(clone);
    document.body.appendChild(container);

    try {
        // Wait a small amount for styles to settle
        await new Promise(resolve => setTimeout(resolve, 300));

        // Execute capture on the clone
        await html2pdf().set(config).from(clone).save();

        console.log('[PDF] Generation success');
    } catch (err) {
        console.error('[PDF] Generation error:', err);
        alert('Gagal membuat PDF: ' + err.message);
    } finally {
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }
    }
};
