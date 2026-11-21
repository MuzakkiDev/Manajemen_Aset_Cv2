/* js/qr.js
 * Generate, pratinjau, unduh (PNG), dan cetak label QR.
 * Isi QR berupa URL aplikasi: <base>#/asset/KODE, sehingga scan dari kamera HP
 * langsung membuka detail aset (atau bisa dibaca oleh pemindai ini).
 * Kontrak: Qr.showModal(asset), Qr.renderPreview(el, items), Qr.printLabels(items)
 */
(function () {
  'use strict';

  const UI = window.UI;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const QR_SIZE = 256;
  const LABEL_PER_PAGE = 12;

  function ensureLib() {
    if (typeof QRCode === 'undefined') {
      UI.toast('Pembuat QR belum dimuat. Periksa koneksi lalu coba lagi.', 'error');
      return false;
    }
    return true;
  }

  /** Alamat dasar aplikasi tanpa query dan hash, misalnya https://user.github.io/aset/ */
  function appBaseUrl() {
    return location.href.split('#')[0].split('?')[0];
  }

  function qrPayload(kode) {
    return appBaseUrl() + '#/asset/' + encodeURIComponent(kode);
  }

  /**
   * Membuat QR sebagai <canvas> di dalam wrapper.
   * Mengembalikan canvas atau null jika library belum siap.
   */
  function makeQrCanvas(wrapper, text, size) {
    if (!ensureLib()) return null;
    wrapper.innerHTML = '';
    const holder = document.createElement('div');
    wrapper.appendChild(holder);
    new QRCode(holder, {
      text: text,
      width: size,
      height: size,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    const canvas = holder.querySelector('canvas');
    if (canvas) return canvas;
    // Beberapa versi qrcode.js hanya menghasilkan <img>
    const img = holder.querySelector('img');
    return img || null;
  }

  function toImageSource(el) {
    if (el.tagName === 'CANVAS') return el.toDataURL('image/png');
    return el.src;
  }

  /* ---------- Modal QR satu aset ---------- */

  let current = null;

  function showModal(asset) {
    if (!asset || !asset.kode_aset) return;
    current = { kode_aset: asset.kode_aset, nama_aset: asset.nama_aset || '' };
    $('#qrNama').textContent = current.nama_aset;
    $('#qrKode').textContent = current.kode_aset;
    const el = makeQrCanvas($('#qrCanvas'), qrPayload(current.kode_aset), QR_SIZE);
    if (!el) return;
    UI.openModal('qrModal');
  }

  function closeModal() {
    UI.closeModal('qrModal');
  }

  function downloadPng() {
    if (!current) return;
    const canvas = $('#qrCanvas canvas');
    if (!canvas) {
      UI.toast('QR belum siap diunduh.', 'warning');
      return;
    }
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'QR_' + current.kode_aset + '.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    UI.toast('QR diunduh.', 'success');
  }

  /* ---------- Pratinjau label ---------- */

  function labelCardHtml(item) {
    return '<div class="label-cell">' +
      '<div class="label-qr"></div>' +
      '<p class="label-kode">' + UI.esc(item.kode_aset) + '</p>' +
      '<p class="label-nama">' + UI.esc(item.nama_aset) + '</p>' +
      '</div>';
  }

  function renderPreview(el, items) {
    if (!el) return;
    if (!items || !items.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = items.map(labelCardHtml).join('');
    const cells = el.querySelectorAll('.label-cell');
    items.forEach((item, i) => {
      const holder = cells[i].querySelector('.label-qr');
      makeQrCanvas(holder, qrPayload(item.kode_aset), 120);
    });
  }

  /* ---------- Cetak label massal ---------- */

  /**
   * Menyusun halaman A4 berisi label (12 per halaman), lalu memanggil print.
   * QR dibuat lebih dulu sebagai data URL agar tampil stabil saat dicetak.
   */
  function printLabels(items) {
    if (!items || !items.length) {
      UI.toast('Tidak ada label untuk dicetak.', 'warning');
      return;
    }
    if (!ensureLib()) return;

    const sandbox = document.createElement('div');
    sandbox.style.position = 'absolute';
    sandbox.style.left = '-9999px';
    document.body.appendChild(sandbox);

    const pages = [];
    for (let i = 0; i < items.length; i += LABEL_PER_PAGE) {
      pages.push(items.slice(i, i + LABEL_PER_PAGE));
    }

    const html = pages.map((page) => {
      const cells = page.map((item) => {
        const tmp = document.createElement('div');
        const el = makeQrCanvas(tmp, qrPayload(item.kode_aset), 220);
        const src = el ? toImageSource(el) : '';
        return '<div class="label-cell">' +
          '<img src="' + src + '" alt="QR ' + UI.esc(item.kode_aset) + '" />' +
          '<div class="label-kode">' + UI.esc(item.kode_aset) + '</div>' +
          '<div class="label-nama">' + UI.esc(item.nama_aset) + '</div>' +
          '</div>';
      });
      while (cells.length < LABEL_PER_PAGE) cells.push('<div class="label-cell" style="border:none"></div>');
      return '<div class="print-grid">' + cells.join('') + '</div>';
    }).join('<div style="page-break-after: always"></div>');

    sandbox.remove();
    const area = $('#printArea');
    area.innerHTML = html;
    area.setAttribute('aria-hidden', 'false');

    const cleanup = () => {
      area.innerHTML = '';
      area.setAttribute('aria-hidden', 'true');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    // Tunggu gambar selesai dimuat sebelum mencetak
    const imgs = Array.from(area.querySelectorAll('img'));
    const ready = imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    })));
    Promise.all(ready).then(() => {
      setTimeout(() => window.print(), 150);
    });
  }

  function bindEvents() {
    $('#btnQrClose').addEventListener('click', closeModal);
    $('#btnQrDownload').addEventListener('click', downloadPng);
    $('#btnQrPrint').addEventListener('click', () => {
      if (current) printLabels([current]);
    });
  }

  window.Qr = Object.freeze({
    showModal: showModal,
    renderPreview: renderPreview,
    printLabels: printLabels
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();