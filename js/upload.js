/* js/upload.js
 * Pilih/ambil berkas, kompres gambar di sisi klien, validasi, lalu unggah.
 * Gambar dikecilkan (sisi terpanjang maks 1280 px, kualitas JPEG 0.7).
 * PDF dikirim apa adanya setelah validasi ukuran.
 * Kontrak: Upload.open({ kode_aset, jenis, source, onDone })
 */
(function () {
  'use strict';

  const C = window.APP_CONFIG || APP_CONFIG;
  const UI = window.UI;
  const api = window.Api || window.api;
  const $ = (sel) => document.querySelector(sel);

  const state = {
    kode: '',
    jenis: '',
    onDone: null,
    file: null,        // File/Blob final yang akan diunggah
    fileName: '',
    mime: '',
    previewUrl: '',
    busy: false
  };

  const MIME_TO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

  function resetState() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.file = null;
    state.fileName = '';
    state.mime = '';
    state.previewUrl = '';
    state.busy = false;

    $('#uploadPreviewWrap').classList.add('hidden');
    $('#uploadPreview').classList.add('hidden');
    $('#uploadPreview').removeAttribute('src');
    $('#uploadFileInfo').textContent = '';
    $('#uploadProgressWrap').classList.add('hidden');
    $('#uploadProgress').style.width = '0%';
    $('#uploadProgressText').textContent = '';
    $('#uploadError').classList.add('hidden');
    $('#uploadError').textContent = '';
    $('#btnUploadSubmit').disabled = true;
    $('#inputUploadCamera').value = '';
    $('#inputUploadFile').value = '';
  }

  function showError(msg) {
    const el = $('#uploadError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function jenisIsPhotoOnly() {
    return state.jenis === 'Foto';
  }

  function sanitizeName(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80);
  }

  /* ---------- Kompresi gambar ---------- */

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
        reject(new Error('decode'));
      };
      img.src = url;
    });
  }

  /** Mengembalikan Blob gambar yang sudah dikecilkan. Format keluaran JPEG (kecuali PNG transparan tetap PNG). */
  async function compressImage(file) {
    const img = await loadImage(file);
    const maxSide = C.IMG_MAX_SIDE;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    // Latar putih agar hasil JPEG tidak hitam pada area transparan
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', C.IMG_QUALITY);
    });
    if (!blob) throw new Error('encode');
    return blob;
  }

  /* ---------- Pemilihan berkas ---------- */

  async function handleFile(file, fromCamera) {
    $('#uploadError').classList.add('hidden');

    if (!file) return;
    const mime = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
    if (C.ALLOWED_MIME.indexOf(mime) === -1) {
      showError('Tipe berkas tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.');
      return;
    }
    if (jenisIsPhotoOnly() && mime === 'application/pdf') {
      showError('Foto harus berupa gambar (JPG, PNG, atau WEBP).');
      return;
    }
    if (file.size > C.UPLOAD_MAX_BYTES) {
      showError('Ukuran berkas maksimal 10 MB.');
      return;
    }

    const btn = $('#btnUploadSubmit');
    btn.disabled = true;
    state.busy = true;
    try {
      let outBlob;
      let outMime;
      if (mime === 'application/pdf') {
        outBlob = file;
        outMime = 'application/pdf';
      } else {
        outBlob = await compressImage(file);
        outMime = 'image/jpeg';
      }

      if (outBlob.size > C.UPLOAD_MAX_BYTES) {
        showError('Berkas masih terlalu besar setelah diproses. Coba foto dengan resolusi lebih rendah.');
        return;
      }

      state.file = outBlob;
      state.mime = outMime;
      const base = sanitizeName($('#uploadNama').value || state.jenis) || state.jenis;
      state.fileName = base + '.' + MIME_TO_EXT[outMime];

      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(outBlob);
      const preview = $('#uploadPreview');
      if (outMime.indexOf('image/') === 0) {
        preview.src = state.previewUrl;
        preview.classList.remove('hidden');
      } else {
        preview.classList.add('hidden');
        preview.removeAttribute('src');
      }
      $('#uploadPreviewWrap').classList.remove('hidden');
      const info = (fromCamera ? 'Foto kamera' : file.name) + ' · ' + formatBytes(outBlob.size);
      $('#uploadFileInfo').textContent = info;
      if (outMime === 'application/pdf') {
        $('#uploadFileInfo').textContent = info + ' (PDF)';
      }
      btn.disabled = false;
    } catch (err) {
      showError('Berkas tidak dapat dibaca. Pastikan berkas tidak rusak lalu coba lagi.');
    } finally {
      state.busy = false;
    }
  }

  /* ---------- Unggah ---------- */

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('read'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Mengunggah lewat fetch biasa. Progres unggah tidak tersedia pada fetch,
   * jadi indikator menampilkan tahap: mengonversi, mengunggah, lalu selesai.
   */
  async function submit() {
    if (!state.file || state.busy) return;
    const btn = $('#btnUploadSubmit');
    const bar = $('#uploadProgress');
    const text = $('#uploadProgressText');
    $('#uploadError').classList.add('hidden');
    $('#uploadProgressWrap').classList.remove('hidden');
    UI.setBtnLoading(btn, true, 'Mengunggah...');
    state.busy = true;

    try {
      bar.style.width = '20%';
      text.textContent = 'Menyiapkan berkas...';
      const b64 = await blobToBase64(state.file);

      bar.style.width = '55%';
      text.textContent = 'Mengunggah ke penyimpanan...';

      const res = await api.call('uploadFile', {
        kode_aset: state.kode,
        jenis: state.jenis,
        nama_dokumen: $('#uploadNama').value.trim() || state.jenis,
        mimeType: state.mime,
        fileName: state.fileName,
        base64: b64
      }, C.UPLOAD_TIMEOUT_MS);

      if (!res.success) {
        bar.style.width = '0%';
        text.textContent = '';
        showError(res.message);
        return;
      }

      bar.style.width = '100%';
      text.textContent = 'Berhasil diunggah.';
      UI.toast(res.message, 'success');
      const cb = state.onDone;
      close();
      if (typeof cb === 'function') cb(res.data);
    } catch (err) {
      bar.style.width = '0%';
      text.textContent = '';
      showError((err && err.message) || 'Gagal memproses berkas. Coba lagi.');
    } finally {
      state.busy = false;
      UI.setBtnLoading(btn, false);
      btn.disabled = !state.file;
    }
  }

  /* ---------- Buka dan tutup modal ---------- */

  function open(opts) {
    const o = opts || {};
    resetState();
    state.kode = String(o.kodeAset || o.kode_aset || '').toUpperCase();
    state.jenis = o.jenisDefault || o.jenis || 'Nota';
    state.onDone = typeof o.onUploaded === 'function' ? o.onUploaded : (typeof o.onDone === 'function' ? o.onDone : null);

    $('#uploadTitle').textContent = 'Unggah ' + (jenisIsPhotoOnly() ? 'foto' : 'berkas') + ' · ' + state.kode;
    const sel = $('#uploadJenis');
    sel.value = state.jenis;
    sel.disabled = !!(o.jenisDefault || o.jenis) && jenisIsPhotoOnly();
    $('#uploadNama').value = '';
    UI.openModal('uploadModal');

    if (o.source === 'camera') {
      $('#inputUploadCamera').click();
    } else if (o.source === 'gallery') {
      $('#inputUploadFile').click();
    }
  }

  function close() {
    if (state.busy) return;
    UI.closeModal('uploadModal');
    resetState();
  }

  function onJenisChange() {
    state.jenis = $('#uploadJenis').value;
    // Foto dan dokumen memakai aturan tipe berkas yang berbeda, validasi ulang berkas yang sudah dipilih
    if (state.file) {
      $('#uploadError').classList.add('hidden');
      if (jenisIsPhotoOnly() && state.mime === 'application/pdf') {
        showError('Foto harus berupa gambar. Pilih berkas gambar atau ganti jenis dokumen.');
        $('#btnUploadSubmit').disabled = true;
      }
    }
  }

  function bindEvents() {
    $('#btnUploadClose').addEventListener('click', close);
    $('#btnUploadCamera').addEventListener('click', () => $('#inputUploadCamera').click());
    $('#btnUploadFile').addEventListener('click', () => $('#inputUploadFile').click());
    $('#uploadJenis').addEventListener('change', onJenisChange);

    $('#inputUploadCamera').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      handleFile(f, true);
    });
    $('#inputUploadFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      handleFile(f, false);
    });

    $('#formUpload').addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
  }

  const UploadTools = Object.freeze({ open: open, close: close });
  window.UploadTools = UploadTools;
  window.Upload = UploadTools;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();