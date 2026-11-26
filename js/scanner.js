/* js/scanner.js
 * Scan QR memakai html5-qrcode.
 * - Minta izin kamera, ganti kamera depan/belakang, senter bila didukung
 * - Fallback input manual bila kamera ditolak atau tidak tersedia
 * - Kontrak: Scanner.open({ mode: 'lookup' | 'form', onCode(kode) }), Scanner.close()
 */
(function () {
  'use strict';

  const C = window.APP_CONFIG || APP_CONFIG;
  const UI = window.UI;
  const $ = (sel) => document.querySelector(sel);

  const state = {
    html5: null,
    cameras: [],
    cameraIndex: 0,
    running: false,
    starting: false,
    torchOn: false,
    handled: false,
    onCode: null,
    mode: 'lookup',
    openSeq: 0
  };

  function setStatus(text, isError) {
    const el = $('#scanStatus');
    el.textContent = text;
    el.classList.toggle('text-red-600', !!isError);
    el.classList.toggle('dark:text-red-400', !!isError);
  }

  function showManualFallback(message) {
    $('#formManualKode').classList.remove('hidden');
    if (message) setStatus(message, true);
  }

  /** Ekstrak kode aset dari teks QR. Terima kode mentah atau URL aplikasi berisi #/asset/KODE */
  function extractCode(text) {
    const raw = String(text || '').trim();
    const hashMatch = raw.match(/#\/asset\/([^/?#\s]+)/i);
    const candidate = (hashMatch ? decodeURIComponent(hashMatch[1]) : raw).trim().toUpperCase();
    return C.KODE_PATTERN.test(candidate) ? candidate : '';
  }

  async function stopCamera() {
    state.running = false;
    state.torchOn = false;
    if (state.html5) {
      try {
        if (state.html5.isScanning) await state.html5.stop();
      } catch (e) { /* kamera sudah berhenti */ }
      try {
        state.html5.clear();
      } catch (e) { /* elemen sudah dibersihkan */ }
    }
    state.html5 = null;
  }

  function resetButtons() {
    $('#btnScanSwitch').classList.add('hidden');
    $('#btnScanTorch').classList.add('hidden');
    $('#btnScanTorch').setAttribute('aria-pressed', 'false');
  }

  async function handleDecoded(text) {
    if (state.handled) return;
    const code = extractCode(text);
    if (!code) {
      setStatus('QR ini bukan kode aset. Coba QR lain.', true);
      return;
    }
    state.handled = true;
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
    const cb = state.onCode;
    await close();
    if (typeof cb === 'function') cb(code);
  }

  async function startCamera(cameraId) {
    if (typeof Html5Qrcode === 'undefined') {
      showManualFallback('Pemindai belum dimuat. Periksa koneksi, atau masukkan kode secara manual.');
      return false;
    }
    if (state.starting) return false;
    state.starting = true;

    await stopCamera();
    const seq = state.openSeq;
    const html5 = new Html5Qrcode('qrReader', { verbose: false });
    state.html5 = html5;

    const config = {
      fps: 10,
      qrbox: function (w, h) {
        const side = Math.floor(Math.min(w, h) * 0.7);
        return { width: side, height: side };
      },
      aspectRatio: 1.0
    };
    const source = cameraId ? cameraId : { facingMode: 'environment' };

    try {
      await html5.start(source, config, handleDecoded, function () { /* frame tanpa QR: abaikan */ });
      if (seq !== state.openSeq) {
        await stopCamera();
        return false;
      }
      state.running = true;
      state.starting = false;
      setStatus('Arahkan kamera ke QR code');
      refreshTorchButton();
      return true;
    } catch (err) {
      state.starting = false;
      await stopCamera();
      const denied = err && /NotAllowed|Permission|denied/i.test(String(err.name || err.message || err));
      if (denied) {
        showManualFallback('Izin kamera ditolak. Aktifkan izin kamera di pengaturan browser, atau masukkan kode manual.');
      } else {
        showManualFallback('Kamera tidak dapat dibuka. Masukkan kode manual.');
      }
      return false;
    }
  }

  async function loadCameras() {
    try {
      const list = await Html5Qrcode.getCameras();
      state.cameras = Array.isArray(list) ? list : [];
    } catch (e) {
      state.cameras = [];
    }
    $('#btnScanSwitch').classList.toggle('hidden', state.cameras.length < 2);
  }

  async function switchCamera() {
    if (state.cameras.length < 2) return;
    state.cameraIndex = (state.cameraIndex + 1) % state.cameras.length;
    const cam = state.cameras[state.cameraIndex];
    setStatus('Mengganti kamera...');
    await startCamera(cam.id);
  }

  function refreshTorchButton() {
    let supported = false;
    try {
      const track = state.html5 && state.html5.getRunningTrackCameraCapabilities
        ? state.html5.getRunningTrackCameraCapabilities()
        : null;
      supported = !!(track && track.torchFeature && track.torchFeature().isSupported());
    } catch (e) {
      supported = false;
    }
    $('#btnScanTorch').classList.toggle('hidden', !supported);
  }

  async function toggleTorch() {
    if (!state.html5) return;
    try {
      state.torchOn = !state.torchOn;
      const feature = state.html5.getRunningTrackCameraCapabilities().torchFeature();
      await feature.apply(state.torchOn);
      $('#btnScanTorch').setAttribute('aria-pressed', String(state.torchOn));
    } catch (e) {
      state.torchOn = false;
      UI.toast('Senter tidak dapat dinyalakan di perangkat ini.', 'warning');
    }
  }

  async function open(opts) {
    const o = opts || {};
    state.mode = o.mode === 'form' ? 'form' : 'lookup';
    state.onCode = typeof o.onDecode === 'function' ? o.onDecode : (typeof o.onCode === 'function' ? o.onCode : null);
    state.handled = false;
    state.openSeq++;

    $('#scanTitle').textContent = state.mode === 'form' ? 'Scan kode aset' : 'Scan QR aset';
    $('#formManualKode').classList.add('hidden');
    $('#manualKode').value = '';
    $('#manualKode').classList.remove('is-invalid');
    const errEl = $('#formManualKode [data-err="manualKode"]');
    if (errEl) errEl.textContent = '';
    $('#scanStatus').classList.remove('text-red-600', 'dark:text-red-400');
    setStatus('Meminta izin kamera...');
    resetButtons();
    UI.openModal('scanModal');

    if (!window.isSecureContext && location.hostname !== 'localhost') {
      showManualFallback('Kamera hanya bisa dipakai lewat HTTPS. Masukkan kode manual.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showManualFallback('Browser ini tidak mendukung kamera. Masukkan kode manual.');
      return;
    }

    await loadCameras();
    const seq = state.openSeq;

    // Kamera belakang dipilih default. Jika tersedia daftar kamera, pakai yang berlabel "back".
    let preferredId = null;
    const back = state.cameras.findIndex((c) => /back|rear|environment|belakang/i.test(c.label || ''));
    if (back >= 0) {
      state.cameraIndex = back;
      preferredId = state.cameras[back].id;
    }
    if (seq !== state.openSeq) return;

    const started = await startCamera(preferredId);
    if (started) {
      $('#btnScanTorch').classList.toggle('hidden', !supportsTorch());
    }
  }

  function supportsTorch() {
    try {
      const cap = state.html5.getRunningTrackCameraCapabilities();
      return !!(cap && cap.torchFeature && cap.torchFeature().isSupported());
    } catch (e) {
      return false;
    }
  }

  async function close() {
    state.openSeq++;
    state.onCode = null;
    await stopCamera();
    UI.closeModal('scanModal');
  }

  async function submitManual(e) {
    e.preventDefault();
    const input = $('#manualKode');
    const errEl = $('#formManualKode [data-err="manualKode"]');
    const raw = input.value.trim().toUpperCase();
    if (!C.KODE_PATTERN.test(raw)) {
      input.classList.add('is-invalid');
      if (errEl) errEl.textContent = 'Format kode tidak valid (contoh: AST-2026-0001).';
      input.focus();
      return;
    }
    input.classList.remove('is-invalid');
    if (errEl) errEl.textContent = '';
    state.handled = true;
    const cb = state.onCode;
    await close();
    if (typeof cb === 'function') cb(raw);
  }

  function bindEvents() {
    $('#btnScanClose').addEventListener('click', close);
    $('#btnScanSwitch').addEventListener('click', switchCamera);
    $('#btnScanTorch').addEventListener('click', toggleTorch);
    $('#formManualKode').addEventListener('submit', submitManual);
  }

  window.Scanner = Object.freeze({ open: open, close: close });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();