/* ============================================================
 * js/config.js
 * Konstanta global. Satu-satunya berkas yang perlu diubah
 * ketika URL Web App Apps Script berubah.
 * ============================================================ */

const APP_CONFIG = Object.freeze({
  /**
   * URL Web App dari Apps Script (diakhiri /exec).
   * Diperoleh dari Deploy > Manage deployments > Web app URL.
   */
  API_URL:
    "https://script.google.com/macros/s/AKfycbytgWQ4PCzqL0QIKne5cu1OGy6aYgpSyu8nnP0ljuy8kDlWfrt4yL_g111wlejm2G_n/exec",

  APP_NAME: "Sistem Manajemen Aset",
  TZ: "Asia/Jakarta",

  PAGE_SIZE: 20,
  PAGE_SIZE_MAX: 100,
  LABEL_MAX: 300,
  WARRANTY_ALERT_DAYS: 60,

  REQUEST_TIMEOUT_MS: 30000,
  UPLOAD_TIMEOUT_MS: 120000,

  UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  IMG_MAX_SIDE: 1280,
  IMG_QUALITY: 0.7,
  ALLOWED_MIME: Object.freeze([
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
  ]),

  DOC_JENIS: Object.freeze([
    "Foto",
    "Nota",
    "Garansi",
    "Manual",
    "BAST",
    "Lainnya",
  ]),

  KODE_PATTERN: /^[A-Z0-9-]{4,40}$/,
  API_URL_PATTERN:
    /^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/,

  ROLE_RANK: Object.freeze({ Viewer: 1, Operator: 2, Admin: 3 }),

  /** Token sesi disimpan di sessionStorage (hilang saat tab ditutup), bukan localStorage. */
  STORAGE_KEYS: Object.freeze({ TOKEN: "aset_token", THEME: "theme" }),
});

window.APP_CONFIG = APP_CONFIG;
