/* ============================================================
 * js/api.js
 * Pembungkus fetch ke Google Apps Script (Web App).
 * Semua permintaan memakai POST + Content-Type "text/plain" agar
 * tidak memicu preflight CORS. Body berupa JSON.
 * Respons backend: { success, data, message, code? }
 * ============================================================ */

const Api = (() => {
  'use strict';

  class ApiError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'ERROR';
    }
  }

  function isConfigured() {
    return APP_CONFIG.API_URL_PATTERN.test(APP_CONFIG.API_URL);
  }

  function getToken() {
    try {
      return sessionStorage.getItem(APP_CONFIG.STORAGE_KEYS.TOKEN) || '';
    } catch (_) {
      return '';
    }
  }

  function setToken(token) {
    try {
      sessionStorage.setItem(APP_CONFIG.STORAGE_KEYS.TOKEN, token);
    } catch (_) { /* penyimpanan tidak tersedia: sesi hanya berlaku di memori */ }
  }

  function clearToken() {
    try {
      sessionStorage.removeItem(APP_CONFIG.STORAGE_KEYS.TOKEN);
    } catch (_) {}
  }

  /**
   * Memanggil satu aksi backend.
   * Mengembalikan envelope lengkap { success, data, message }.
   * Melempar ApiError bila gagal. Jika kode UNAUTH, memicu event "auth:expired".
   */
  async function call(action, payload = {}, timeoutMs = APP_CONFIG.REQUEST_TIMEOUT_MS) {
    if (!isConfigured()) {
      throw new ApiError('URL server belum diatur di js/config.js.', 'CONFIG');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let json;
    try {
      const res = await fetch(APP_CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: action, token: getToken(), payload: payload }),
        signal: controller.signal,
        redirect: 'follow',
        cache: 'no-store'
      });
      json = await res.json();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new ApiError('Koneksi terlalu lama. Periksa jaringan lalu coba lagi.', 'TIMEOUT');
      }
      if (err instanceof SyntaxError) {
        throw new ApiError(
          'Respons server tidak valid. Pastikan Web App di-deploy dengan akses "Anyone".',
          'BAD_RESPONSE'
        );
      }
      throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', 'NETWORK');
    } finally {
      clearTimeout(timer);
    }

    if (!json || typeof json !== 'object') {
      throw new ApiError('Respons server tidak valid.', 'BAD_RESPONSE');
    }

    if (json.success !== true) {
      const error = new ApiError(json.message || 'Permintaan gagal.', json.code || 'ERROR');
      if (error.code === 'UNAUTH') {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      throw error;
    }

    return json;
  }

  return {
    ApiError: ApiError,
    isConfigured: isConfigured,
    call: call,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,

    // ----- Autentikasi & pengguna -----
    login: (username, password) => call('login', { username: username, password: password }),
    logout: () => call('logout'),
    me: () => call('me'),
    changePassword: (oldPassword, newPassword) =>
      call('changePassword', { oldPassword: oldPassword, newPassword: newPassword }),
    createUser: (data) => call('createUser', data),

    // ----- Master data -----
    getMaster: () => call('getMaster'),

    // ----- Aset -----
    listAssets: (params) => call('listAssets', params || {}),
    getAsset: (kode) => call('getAsset', { kode_aset: kode }),
    createAsset: (data) => call('createAsset', data),
    updateAsset: (data) => call('updateAsset', data),
    deleteAsset: (kode) => call('deleteAsset', { kode_aset: kode }),
    restoreAsset: (kode) => call('restoreAsset', { kode_aset: kode }),

    // ----- Berkas -----
    uploadFile: (data) => call('uploadFile', data, APP_CONFIG.UPLOAD_TIMEOUT_MS),
    deleteDocument: (id) => call('deleteDocument', { id: id }),

    // ----- Audit -----
    listAuditLog: (params) => call('listAuditLog', params || {})
  };
})();

window.Api = Api;