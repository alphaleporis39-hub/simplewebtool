/**
 * Image Tools - interactive logic
 * --------------------------------------------------------------------------
 * Tools:
 *   1. Image Compressor       (canvas-based quality reduction)
 *   2. Background Remover     (optional @imgly/background-removal integration)
 *   3. Image Resizer          (canvas resize with aspect-ratio lock)
 *   4. PNG / JPG Converter    (format conversion via canvas)
 *
 * Depends on:
 *   - /js/script.js (shared helpers)
 * --------------------------------------------------------------------------
 */

import { $, el, toast, setButtonLoading, formatNumber } from '/js/script.js';

/* ========================================================================== 
   Shared helpers
   ========================================================================== */
const MAX_IMAGE_SIDE = 8192;
let bgRemovalModulePromise = null;

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

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return formatNumber(n / 1024, 1) + ' KB';
  return formatNumber(n / (1024 * 1024), 2) + ' MB';
}

function fileBaseName(file) {
  return String(file?.name || 'image').replace(/\.[^.]+$/, '') || 'image';
}

function extensionForType(type) {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function getSelectedFile(input) {
  return input?.files?.[0] || null;
}

function validateImageFile(file, errorEl, allowedTypes = ['image/png', 'image/jpeg', 'image/webp']) {
  if (!file) {
    errorEl.textContent = 'Please choose an image file.';
    return false;
  }
  if (!allowedTypes.includes(file.type)) {
    errorEl.textContent = 'Please choose a supported image format.';
    return false;
  }
  if (file.size > 25 * 1024 * 1024) {
    errorEl.textContent = 'Image must be 25 MB or smaller.';
    return false;
  }
  return true;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image.'));
    };
    img.src = url;
  });
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  return canvas;
}

function drawImageToCanvas(img, width = img.naturalWidth, height = img.naturalHeight, fill = null) {
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw new Error('Image dimensions are too large for browser processing.');
  }

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: !fill });
  if (!ctx) throw new Error('Canvas is not supported in this browser.');

  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas, type, quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not create the output image.'));
      },
      type,
      quality
    );
  });
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
        text: 'Download Image',
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

/* ========================================================================== 
   1. Image Compressor
   ========================================================================== */
function initCompressor() {
  const form = $('#compressForm');
  if (!form) return;

  const fileEl = $('#compressFile');
  const qualityEl = $('#compressQuality');
  const qualityLabel = $('#compressQualityLabel');
  const errorEl = $('#compressError');
  const resultEl = $('#compressResult');
  const button = form.querySelector('.btn-primary');

  const syncQuality = () => {
    if (qualityLabel) qualityLabel.textContent = qualityEl.value + '%';
  };
  qualityEl.addEventListener('input', syncQuality);
  syncQuality();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const file = getSelectedFile(fileEl);
    if (!validateImageFile(file, errorEl)) return;

    setButtonLoading(button, true);
    try {
      const img = await loadImage(file);
      const quality = clampNumber(num(qualityEl.value) / 100, 0.1, 0.95);
      const outputType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
      const canvas = drawImageToCanvas(img, img.naturalWidth, img.naturalHeight, outputType === 'image/jpeg' ? '#ffffff' : null);
      const blob = await canvasToBlob(canvas, outputType, quality);
      const saved = file.size > 0 ? Math.max(0, (1 - blob.size / file.size) * 100) : 0;
      const filename = fileBaseName(file) + '-compressed.' + extensionForType(outputType);

      renderDownloadResult(resultEl, blob, filename, [
        resultRow('Original size', formatBytes(file.size)),
        resultRow('Compressed size', formatBytes(blob.size), blob.size <= file.size ? 'good' : ''),
        resultRow('Saved', formatNumber(saved, 1) + '%'),
        resultRow('Output format', extensionForType(outputType).toUpperCase()),
      ]);
      toast('Image compressed successfully.', 'success');
    } catch (err) {
      errorEl.textContent = err.message || 'Could not compress this image.';
      toast(errorEl.textContent, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', () => {
    setTimeout(syncQuality, 0);
    resetTool(errorEl, resultEl);
  });
}

/* ========================================================================== 
   2. Background Remover
   ========================================================================== */
async function getBackgroundRemovalModule() {
  if (!bgRemovalModulePromise) {
    bgRemovalModulePromise = import('https://cdn.jsdelivr.net/npm/@imgly/background-removal/+esm');
  }
  return bgRemovalModulePromise;
}

function initBackgroundRemover() {
  const form = $('#bgForm');
  if (!form) return;

  const fileEl = $('#bgFile');
  const errorEl = $('#bgError');
  const resultEl = $('#bgResult');
  const button = form.querySelector('.btn-primary');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const file = getSelectedFile(fileEl);
    if (!validateImageFile(file, errorEl)) return;

    setButtonLoading(button, true);
    try {
      const mod = await getBackgroundRemovalModule();
      const removeBackground = mod.removeBackground || mod.default;
      if (typeof removeBackground !== 'function') {
        throw new Error('Background remover could not be loaded.');
      }

      const output = await removeBackground(file);
      const blob = output instanceof Blob ? output : new Blob([output], { type: 'image/png' });
      const filename = fileBaseName(file) + '-no-background.png';

      renderDownloadResult(resultEl, blob, filename, [
        resultRow('Original size', formatBytes(file.size)),
        resultRow('Output size', formatBytes(blob.size), 'good'),
        resultRow('Output format', 'PNG'),
      ]);
      toast('Background removed successfully.', 'success');
    } catch (err) {
      errorEl.textContent =
        'Background removal is unavailable right now. Try again online with a clear subject image.';
      toast(err.message || errorEl.textContent, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', () => resetTool(errorEl, resultEl));
}

/* ========================================================================== 
   3. Image Resizer
   ========================================================================== */
function initResizer() {
  const form = $('#resizeForm');
  if (!form) return;

  const fileEl = $('#resizeFile');
  const widthEl = $('#resizeWidth');
  const heightEl = $('#resizeHeight');
  const lockEl = $('#resizeLock');
  const errorEl = $('#resizeError');
  const resultEl = $('#resizeResult');
  const button = form.querySelector('.btn-primary');
  let sourceWidth = 0;
  let sourceHeight = 0;
  let editingDimension = false;

  fileEl.addEventListener('change', async () => {
    errorEl.textContent = '';
    const file = getSelectedFile(fileEl);
    if (!file) return;
    if (!validateImageFile(file, errorEl)) return;

    try {
      const img = await loadImage(file);
      sourceWidth = img.naturalWidth;
      sourceHeight = img.naturalHeight;
      widthEl.value = sourceWidth;
      heightEl.value = sourceHeight;
    } catch (err) {
      errorEl.textContent = err.message || 'Could not read this image.';
    }
  });

  widthEl.addEventListener('input', () => {
    if (editingDimension || !lockEl.checked || !sourceWidth || !sourceHeight) return;
    const width = num(widthEl.value);
    if (Number.isNaN(width) || width <= 0) return;
    editingDimension = true;
    heightEl.value = Math.max(1, Math.round((width * sourceHeight) / sourceWidth));
    editingDimension = false;
  });

  heightEl.addEventListener('input', () => {
    if (editingDimension || !lockEl.checked || !sourceWidth || !sourceHeight) return;
    const height = num(heightEl.value);
    if (Number.isNaN(height) || height <= 0) return;
    editingDimension = true;
    widthEl.value = Math.max(1, Math.round((height * sourceWidth) / sourceHeight));
    editingDimension = false;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const file = getSelectedFile(fileEl);
    if (!validateImageFile(file, errorEl)) return;

    const width = Math.round(num(widthEl.value));
    const height = Math.round(num(heightEl.value));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      errorEl.textContent = 'Please enter a valid width and height.';
      return;
    }
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
      errorEl.textContent = 'Width and height must be 8192 px or smaller.';
      return;
    }

    setButtonLoading(button, true);
    try {
      const img = await loadImage(file);
      const outputType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
      const canvas = drawImageToCanvas(img, width, height, outputType === 'image/jpeg' ? '#ffffff' : null);
      const blob = await canvasToBlob(canvas, outputType, 0.9);
      const filename = fileBaseName(file) + '-' + width + 'x' + height + '.' + extensionForType(outputType);

      renderDownloadResult(resultEl, blob, filename, [
        resultRow('Original dimensions', img.naturalWidth + ' x ' + img.naturalHeight + ' px'),
        resultRow('New dimensions', width + ' x ' + height + ' px', 'good'),
        resultRow('Output size', formatBytes(blob.size)),
        resultRow('Output format', extensionForType(outputType).toUpperCase()),
      ]);
      toast('Image resized successfully.', 'success');
    } catch (err) {
      errorEl.textContent = err.message || 'Could not resize this image.';
      toast(errorEl.textContent, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', () => {
    sourceWidth = 0;
    sourceHeight = 0;
    resetTool(errorEl, resultEl);
  });
}

/* ========================================================================== 
   4. PNG / JPG Converter
   ========================================================================== */
function initConverter() {
  const form = $('#convertForm');
  if (!form) return;

  const fileEl = $('#convertFile');
  const formatEl = $('#convertFormat');
  const qualityEl = $('#convertQuality');
  const errorEl = $('#convertError');
  const resultEl = $('#convertResult');
  const button = form.querySelector('.btn-primary');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const file = getSelectedFile(fileEl);
    if (!validateImageFile(file, errorEl, ['image/png', 'image/jpeg'])) return;

    const outputType = formatEl.value === 'image/png' ? 'image/png' : 'image/jpeg';
    const quality = clampNumber(num(qualityEl.value) / 100, 0.1, 1);

    setButtonLoading(button, true);
    try {
      const img = await loadImage(file);
      const canvas = drawImageToCanvas(img, img.naturalWidth, img.naturalHeight, outputType === 'image/jpeg' ? '#ffffff' : null);
      const blob = await canvasToBlob(canvas, outputType, quality);
      const filename = fileBaseName(file) + '-converted.' + extensionForType(outputType);

      renderDownloadResult(resultEl, blob, filename, [
        resultRow('Original format', (file.type.split('/')[1] || 'image').toUpperCase()),
        resultRow('Output format', extensionForType(outputType).toUpperCase(), 'good'),
        resultRow('Original size', formatBytes(file.size)),
        resultRow('Output size', formatBytes(blob.size)),
      ]);
      toast('Image converted successfully.', 'success');
    } catch (err) {
      errorEl.textContent = err.message || 'Could not convert this image.';
      toast(errorEl.textContent, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  form.addEventListener('reset', () => resetTool(errorEl, resultEl));
}

/* ========================================================================== 
   Bootstrap
   ========================================================================== */
function initImageTools() {
  initCompressor();
  initBackgroundRemover();
  initResizer();
  initConverter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initImageTools);
} else {
  initImageTools();
}
