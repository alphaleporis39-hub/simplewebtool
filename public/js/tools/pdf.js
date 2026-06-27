/**
 * PDF Tools - interactive logic
 * --------------------------------------------------------------------------
 * Tools:
 *   1. PDF Converter        (images to PDF)
 *   2. PDF Compressor       (structure optimization with pdf-lib)
 *   3. PDF Merger           (combine multiple PDFs)
 *   4. Timestamp Converter  (Unix time, milliseconds, ISO and local time)
 *
 * Depends on:
 *   - /js/script.js (shared helpers)
 *   - pdf-lib via CDN, loaded on demand
 * --------------------------------------------------------------------------
 */

import { $, el, toast, setButtonLoading, formatNumber } from '/js/script.js';

/* ==========================================================================
   Shared helpers
   ========================================================================== */
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
let pdfLibPromise = null;

function showResult(node) {
  node.classList.remove('is-empty');
}

function hideResult(node) {
  node.replaceChildren();
  node.classList.add('is-empty');
}

function resultRow(key, value, valClass = '') {
  return el('div', { class: 'result-row' }, [
    el('span', { class: 'result-key', text: key }),
    el('span', { class: ('result-val ' + valClass).trim(), text: value }),
  ]);
}

function num(value) {
  if (value === '' || value == null) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return formatNumber(n / 1024, 1) + ' KB';
  return formatNumber(n / (1024 * 1024), 2) + ' MB';
}

function fileBaseName(file, fallback = 'file') {
  return String(file?.name || fallback).replace(/\.[^.]+$/, '') || fallback;
}

function selectedFiles(input) {
  return Array.from(input?.files || []);
}

function validateFiles(files, errorEl, types, label) {
  if (!files.length) {
    errorEl.textContent = 'Please choose at least one file.';
    return false;
  }

  const invalid = files.find((file) => !types.includes(file.type));
  if (invalid) {
    errorEl.textContent = 'Please choose supported ' + label + ' files only.';
    return false;
  }

  const tooLarge = files.find((file) => file.size > MAX_FILE_SIZE);
  if (tooLarge) {
    errorEl.textContent = 'Each file must be 50 MB or smaller.';
    return false;
  }

  return true;
}

function readAsArrayBuffer(file) {
  return file.arrayBuffer();
}

function revokeResultUrl(resultEl) {
  const oldUrl = resultEl.dataset.objectUrl;
  if (oldUrl) {
    URL.revokeObjectURL(oldUrl);
    delete resultEl.dataset.objectUrl;
  }
}

function renderDownloadResult(resultEl, blob, filename, rows = []) {
  revokeResultUrl(resultEl);
  const url = URL.createObjectURL(blob);
  resultEl.dataset.objectUrl = url;

  resultEl.replaceChildren(
    ...rows,
    el('div', { class: 'tool-actions', style: 'margin-top:1rem' }, [
      el('a', {
        class: 'btn btn-primary',
        href: url,
        download: filename,
        text: 'Download PDF',
      }),
    ])
  );
  showResult(resultEl);
}

function resetTool(errorEl, resultEl) {
  errorEl.textContent = '';
  revokeResultUrl(resultEl);
  hideResult(resultEl);
}

async function getPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import(PDF_LIB_URL);
  }
  return pdfLibPromise;
}

function pageSizeFor(value, orientation) {
  const sizes = {
    a4: [595.28, 841.89],
    letter: [612, 792],
    legal: [612, 1008],
  };
  const base = sizes[value] || sizes.a4;
  const portrait = orientation !== 'landscape';
  return portrait ? base : [base[1], base[0]];
}

function fitIntoBox(width, height, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return {
    width: width * scale,
    height: height * scale,
  };
}

/* ==========================================================================
   1. PDF Converter - images to PDF
   ========================================================================== */
async function embedImage(pdfDoc, file, bytes) {
  if (file.type === 'image/png') return pdfDoc.embedPng(bytes);
  return pdfDoc.embedJpg(bytes);
}

function initPdfConverter() {
  const form = $('#pdfConvertForm');
  if (!form) return;

  const fileEl = $('#pdfImageFiles');
  const pageSizeEl = $('#pdfPageSize');
  const orientationEl = $('#pdfOrientation');
  const marginEl = $('#pdfMargin');
  const errorEl = $('#pdfConvertError');
  const resultEl = $('#pdfConvertResult');
  const button = form.querySelector('.btn-primary');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const files = selectedFiles(fileEl);
    if (!validateFiles(files, errorEl, ['image/png', 'image/jpeg'], 'image')) return;

    setButtonLoading(button, true);
    try {
      const { PDFDocument } = await getPdfLib();
      const pdfDoc = await PDFDocument.create();
      const [pageWidth, pageHeight] = pageSizeFor(pageSizeEl?.value, orientationEl?.value);
      const margin = Math.min(Math.max(num(marginEl?.value || 36), 0), 144);
      const boxWidth = pageWidth - margin * 2;
      const boxHeight = pageHeight - margin * 2;

      for (const file of files) {
        const bytes = await readAsArrayBuffer(file);
        const image = await embedImage(pdfDoc, file, bytes);
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        const fitted = fitIntoBox(image.width, image.height, boxWidth, boxHeight);
        const x = (pageWidth - fitted.width) / 2;
        const y = (pageHeight - fitted.height) / 2;
        page.drawImage(image, { x, y, width: fitted.width, height: fitted.height });
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const filename = files.length === 1 ? fileBaseName(files[0], 'converted') + '.pdf' : 'converted-images.pdf';
      const inputSize = files.reduce((sum, file) => sum + file.size, 0);

      renderDownloadResult(resultEl, blob, filename, [
        resultRow('Images added', String(files.length), 'good'),
        resultRow('Input size', formatBytes(inputSize)),
        resultRow('PDF size', formatBytes(blob.size)),
        resultRow('Page size', (pageSizeEl?.value || 'a4').toUpperCase()),
      ]);
      toast('PDF created successfully.', 'success');
    } catch (err) {
      errorEl.textContent = err.message || 'Could not create this PDF.';
      toast(errorEl.textContent, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', () => resetTool(errorEl, resultEl));
}

/* ==========================================================================
   2. PDF Compressor
   ========================================================================== */
function initPdfCompressor() {
  const form = $('#pdfCompressForm');
  if (!form) return;

  const fileEl = $('#pdfCompressFile');
  const errorEl = $('#pdfCompressError');
  const resultEl = $('#pdfCompressResult');
  const button = form.querySelector('.btn-primary');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const files = selectedFiles(fileEl);
    if (!validateFiles(files, errorEl, ['application/pdf'], 'PDF')) return;

    const file = files[0];
    setButtonLoading(button, true);
    try {
      const { PDFDocument } = await getPdfLib();
      const sourceBytes = await readAsArrayBuffer(file);
      const pdfDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
      const pdfBytes = await pdfDoc.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 50,
      });
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const saved = file.size > 0 ? Math.max(0, (1 - blob.size / file.size) * 100) : 0;

      renderDownloadResult(resultEl, blob, fileBaseName(file, 'compressed') + '-compressed.pdf', [
        resultRow('Original size', formatBytes(file.size)),
        resultRow('Optimized size', formatBytes(blob.size), blob.size <= file.size ? 'good' : ''),
        resultRow('Saved', formatNumber(saved, 1) + '%'),
        resultRow('Pages', String(pdfDoc.getPageCount())),
      ]);
      toast('PDF optimized successfully.', 'success');
    } catch (err) {
      errorEl.textContent = 'Could not optimize this PDF. Password-protected files are not supported.';
      toast(err.message || errorEl.textContent, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', () => resetTool(errorEl, resultEl));
}

/* ==========================================================================
   3. PDF Merger
   ========================================================================== */
function initPdfMerger() {
  const form = $('#pdfMergeForm');
  if (!form) return;

  const fileEl = $('#pdfMergeFiles');
  const errorEl = $('#pdfMergeError');
  const resultEl = $('#pdfMergeResult');
  const button = form.querySelector('.btn-primary');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const files = selectedFiles(fileEl);
    if (!validateFiles(files, errorEl, ['application/pdf'], 'PDF')) return;
    if (files.length < 2) {
      errorEl.textContent = 'Please choose at least two PDFs to merge.';
      return;
    }

    setButtonLoading(button, true);
    try {
      const { PDFDocument } = await getPdfLib();
      const merged = await PDFDocument.create();
      let totalPages = 0;

      for (const file of files) {
        const source = await PDFDocument.load(await readAsArrayBuffer(file), { ignoreEncryption: true });
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
        totalPages += source.getPageCount();
      }

      const pdfBytes = await merged.save({ useObjectStreams: true });
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const inputSize = files.reduce((sum, file) => sum + file.size, 0);

      renderDownloadResult(resultEl, blob, 'merged.pdf', [
        resultRow('Files merged', String(files.length), 'good'),
        resultRow('Total pages', String(totalPages)),
        resultRow('Input size', formatBytes(inputSize)),
        resultRow('Output size', formatBytes(blob.size)),
      ]);
      toast('PDFs merged successfully.', 'success');
    } catch (err) {
      errorEl.textContent = 'Could not merge these PDFs. Password-protected files are not supported.';
      toast(err.message || errorEl.textContent, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', () => resetTool(errorEl, resultEl));
}

/* ==========================================================================
   4. Timestamp Converter
   ========================================================================== */
function parseTimestamp(value, unit) {
  const text = String(value || '').trim();
  if (!text) return null;

  if (unit === 'iso') {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const valueNumber = num(text);
  if (!Number.isFinite(valueNumber)) return null;

  if (unit === 'milliseconds') return new Date(valueNumber);
  if (unit === 'seconds') return new Date(valueNumber * 1000);

  if (Math.abs(valueNumber) >= 100000000000) return new Date(valueNumber);
  return new Date(valueNumber * 1000);
}

function initTimestampConverter() {
  const form = $('#timestampForm');
  if (!form) return;

  const inputEl = $('#timestampInput');
  const unitEl = $('#timestampUnit');
  const errorEl = $('#timestampError');
  const resultEl = $('#timestampResult');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const date = parseTimestamp(inputEl.value, unitEl?.value || 'auto');
    if (!date || Number.isNaN(date.getTime())) {
      errorEl.textContent = 'Please enter a valid timestamp or date.';
      inputEl.focus();
      return;
    }

    resultEl.replaceChildren(
      resultRow('Local time', date.toLocaleString()),
      resultRow('UTC time', date.toUTCString()),
      resultRow('ISO format', date.toISOString(), 'good'),
      resultRow('Unix seconds', String(Math.floor(date.getTime() / 1000))),
      resultRow('Milliseconds', String(date.getTime()))
    );
    showResult(resultEl);
  });

  form.addEventListener('reset', () => {
    errorEl.textContent = '';
    hideResult(resultEl);
  });
}

/* ==========================================================================
   Bootstrap
   ========================================================================== */
function initPdfTools() {
  initPdfConverter();
  initPdfCompressor();
  initPdfMerger();
  initTimestampConverter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPdfTools);
} else {
  initPdfTools();
}
