/* ============================================================
 * js/app.js
 * Router hash (#/...), state, render semua view, dan utilitas UI.
 *
 * Kontrak dengan modul Tahap 4 (dipanggil di sini):
 *   Scanner.open({ onDecode(text) })   Scanner.close()
 *   UploadTools.open({ kodeAset, jenisDefault, source, onUploaded })
 *       source: 'camera' | 'gallery' | undefined
 *   QRTools.openQrModal(asset)
 *   QRTools.renderLabelSheet(containerEl, assets)
 *   QRTools.printLabelSheet(assets)
 * Modul-modul tersebut memiliki modal masing-masing dan menutupnya
 * sendiri melalui UI.closeModal().
 * ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
   * 1. UTILITAS DOM & FORMAT (diekspor sebagai window.UI)
   * ========================================================== */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function rupiah(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
  }

  function formatMoney(n) {
    const num = Number(n || 0);
    return num ? num.toLocaleString('id-ID') : '';
  }

  function isDateStr(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  }

  function formatDate(s) {
    if (!s) return '-';
    const d = new Date(String(s).length === 10 ? s + 'T00:00:00' : String(s).replace(' ', 'T'));
    if (isNaN(d)) return String(s);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(s) {
    if (!s) return '-';
    const d = new Date(String(s).replace(' ', 'T'));
    if (isNaN(d)) return String(s);
    return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Selisih hari dari hari ini ke tanggal yyyy-mm-dd. Null bila kosong/tidak valid. */
  function daysUntil(s) {
    if (!s || !isDateStr(s)) return null;
    const target = new Date(s + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  const UI = {
    esc: esc,
    rupiah: rupiah,
    formatMoney: formatMoney,
    formatDate: formatDate,
    dateTime: formatDateTime,
    daysUntil: daysUntil,
    isDateStr: isDateStr,

    icons() {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    },

    toast(message, type, ms) {
      const root = $('#toastRoot');
      if (!root) return;
      const el = document.createElement('div');
      el.className = 'toast toast-' + (type || 'info');
      el.setAttribute('role', type === 'error' ? 'alert' : 'status');
      el.innerHTML = '<span class="flex-1">' + esc(message) + '</span>';
      root.appendChild(el);
      while (root.children.length > 3) root.removeChild(root.firstElementChild);
      setTimeout(() => {
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 220);
      }, ms || 3500);
    },

    setLoading(on, text) {
      const ov = $('#loadingOverlay');
      if (!ov) return;
      if (on) {
        loadingCount++;
        $('#loadingText').textContent = text || 'Memproses...';
        ov.classList.remove('hidden');
      } else {
        loadingCount = Math.max(0, loadingCount - 1);
        if (loadingCount === 0) ov.classList.add('hidden');
      }
    },

    setBtnLoading(btn, on, text) {
      if (!btn) return;
      btn.disabled = !!on;
      btn.classList.toggle('is-loading', !!on);
      const label = btn.querySelector('.btn-label');
      if (!label) return;
      if (on) {
        if (label.dataset.orig === undefined) label.dataset.orig = label.textContent;
        label.textContent = text || 'Memproses...';
      } else if (label.dataset.orig !== undefined) {
        label.textContent = label.dataset.orig;
        delete label.dataset.orig;
      }
    },

    openModal(id) {
      const m = document.getElementById(id);
      if (m) m.classList.add('is-open');
    },

    closeModal(id) {
      const m = document.getElementById(id);
      if (!m || !m.classList.contains('is-open')) return;
      m.classList.remove('is-open');
      document.dispatchEvent(new CustomEvent('modal:closed', { detail: { id: id } }));
    },

    confirmDialog(opts) {
      const o = opts || {};
      return new Promise((resolve) => {
        pendingConfirm = resolve;
        $('#confirmTitle').textContent = o.title || 'Konfirmasi';
        $('#confirmMessage').textContent = o.message || '';
        const ok = $('#btnConfirmOk');
        ok.textContent = o.okText || 'Ya, lanjutkan';
        ok.className = o.danger ? 'btn-danger' : 'btn-primary';
        UI.openModal('confirmModal');
      });
    }
  };

  let loadingCount = 0;
  let pendingConfirm = null;

  function settleConfirm(value) {
    if (!pendingConfirm) return;
    const resolve = pendingConfirm;
    pendingConfirm = null;
    resolve(value);
  }

  window.UI = UI;

  /* ==========================================================
   * 2. STATE
   * ========================================================== */

  const state = {
    user: null,
    master: null,
    currentView: null,
    list: {
      q: '', kategori: '', lokasi: '', kondisi: '', status: '',
      sortBy: 'updated_at', sortDir: 'desc',
      page: 1, totalPages: 1, total: 0,
      includeDeleted: false,
      selectMode: false,
      selected: new Set(),
      items: []
    },
    detail: { asset: null, documents: [], kode: null },
    form: { mode: 'new', kode: null, asset: null, prefill: null, dirty: false },
    labelPrefill: null
  };

  let booted = false;
  let listReq = 0;
  let assetCache = null;
  let assetCacheAt = 0;

  const VIEW_IDS = {
    login: 'view-login', home: 'view-home', list: 'view-list',
    asset: 'view-detail', form: 'view-form', label: 'view-label', account: 'view-account'
  };
  const TITLES = {
    home: 'Beranda', list: 'Daftar aset', asset: 'Detail aset',
    form: 'Form aset', label: 'Cetak label', account: 'Akun'
  };
  const NAV_FOR = { home: 'home', list: 'list', asset: 'list', form: 'list', label: 'label', account: 'account' };

  function canEdit() {
    return !!state.user && APP_CONFIG.ROLE_RANK[state.user.role] >= APP_CONFIG.ROLE_RANK.Operator;
  }

  function isAdmin() {
    return !!state.user && state.user.role === 'Admin';
  }

  /* ==========================================================
   * 3. ROUTER
   * ========================================================== */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean).map((p) => {
      try { return decodeURIComponent(p); } catch (_) { return p; }
    });
    return { name: parts[0] || '', param: parts[1] || '', sub: parts[2] || '' };
  }

  /** Pindah halaman dengan riwayat (tombol kembali bekerja). */
  function go(path) {
    const target = '#/' + path;
    if (location.hash === target) {
      route();
    } else {
      location.hash = target;
    }
  }

  /** Pindah halaman tanpa riwayat (dipakai untuk pengalihan guard). */
  function redirect(path) {
    history.replaceState(null, '', '#/' + path);
    route();
  }

  async function route() {
    if (!booted) return;
    const r = parseHash();
    const name = r.name || 'home';

    if (!state.user) {
      if (name !== 'login') return redirect('login');
      return showLogin();
    }
    if (name === 'login') return redirect('home');
    if (!VIEW_IDS[name]) return redirect('home');

    if (name === 'form') {
      if (!canEdit()) {
        UI.toast('Anda tidak memiliki akses untuk menambah atau mengubah aset.', 'warning');
        return redirect('list');
      }
      if (r.param !== 'new' && !(r.param === 'edit' && r.sub)) return redirect('list');
    }
    if (name === 'asset' && !r.param) return redirect('list');

    if (state.currentView === 'form' && name !== 'form') {
      state.form.dirty = false;
    }

    showView(name);
    await ensureMaster();

    switch (name) {
      case 'home': return loadHome();
      case 'list': return loadList();
      case 'asset': return loadDetail(r.param);
      case 'form': return loadForm(r);
      case 'label': return loadLabel();
      case 'account': return loadAccount();
    }
  }

  function showLogin() {
    state.currentView = 'login';
    showView('login');
    const form = $('#formLogin');
    clearErrors(form);
    $('#loginUsername').focus();
  }

  function showView(name) {
    state.currentView = name;
    $$('[data-view]').forEach((el) => el.classList.add('hidden'));
    const target = document.getElementById(VIEW_IDS[name]);
    if (target) target.classList.remove('hidden');

    const loggedIn = !!state.user;
    $('#appHeader').classList.toggle('hidden', !loggedIn || name === 'login');
    $('#bottomNav').classList.toggle('hidden', !loggedIn || name === 'login');
    $('#btnAddAsset').classList.toggle('hidden', !(loggedIn && canEdit() && (name === 'list' || name === 'home')));

    $('#headerTitle').textContent = TITLES[name] || APP_CONFIG.APP_NAME;
    $('#headerUser').textContent = loggedIn ? state.user.nama + ' · ' + state.user.role : '';
    $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === NAV_FOR[name]));
    $$('.nav-item-desktop').forEach((b) => {
      if (b.dataset.nav !== 'scan') {
        b.classList.toggle('is-active', b.dataset.nav === NAV_FOR[name]);
      }
    });

    document.title = (TITLES[name] ? TITLES[name] + ' · ' : '') + APP_CONFIG.APP_NAME;
    window.scrollTo(0, 0);
    UI.icons();
  }

  /* ==========================================================
   * 4. HELPER DATA & ERROR
   * ========================================================== */

  function handleError(err) {
    if (err && err.code === 'UNAUTH') return;
    UI.toast((err && err.message) || 'Terjadi kesalahan. Silakan coba lagi.', 'error', 5000);
  }

  const CUSTOM_LOKASI_KEY = 'aset_custom_lokasi';

  function getCustomLocations() {
    try {
      const raw = localStorage.getItem(CUSTOM_LOKASI_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim()) : [];
    } catch (_) {
      return [];
    }
  }

  function mergeCustomLocations(master) {
    if (!master) return master;
    const base = Array.isArray(master.lokasi) ? master.lokasi.slice() : [];
    const seen = new Set(base.map((x) => String(x).trim().toLowerCase()));
    getCustomLocations().forEach((loc) => {
      const key = loc.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        base.push(loc.trim());
      }
    });
    master.lokasi = base;
    return master;
  }

  function saveCustomLocation(name) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    const list = getCustomLocations();
    const exists = list.some((x) => x.toLowerCase() === clean.toLowerCase());
    if (!exists) {
      list.push(clean);
      try { localStorage.setItem(CUSTOM_LOKASI_KEY, JSON.stringify(list)); } catch (_) {}
    }
    if (state.master) mergeCustomLocations(state.master);
    return true;
  }

  async function ensureMaster() {
    if (state.master || !state.user) return state.master;
    const res = await Api.getMaster();
    state.master = mergeCustomLocations(res.data);
    return state.master;
  }

  function loadMasterQuietly() {
    ensureMaster().catch(() => {});
  }

  function invalidateCache() {
    assetCache = null;
    assetCacheAt = 0;
  }

  /** Mengambil seluruh aset aktif (dipakai dashboard dan label). Di-cache 60 detik. */
  async function getAllAssets() {
    if (assetCache && Date.now() - assetCacheAt < 60000) return assetCache;
    const out = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await Api.listAssets({
        page: page,
        pageSize: APP_CONFIG.PAGE_SIZE_MAX,
        sortBy: 'kode_aset',
        sortDir: 'asc'
      });
      out.push(...res.data.items);
      totalPages = res.data.totalPages;
      page++;
    } while (page <= totalPages);
    assetCache = out;
    assetCacheAt = Date.now();
    return out;
  }

  function normalizeKode(raw) {
    let s = String(raw || '').trim();
    try {
      const k = new URL(s).searchParams.get('kode');
      if (k) s = k;
    } catch (_) { /* bukan URL, lanjut */ }
    s = s.toUpperCase();
    return APP_CONFIG.KODE_PATTERN.test(s) ? s : '';
  }

  function conditionBadge(k) {
    const map = { 'Baik': 'badge-success', 'Rusak Ringan': 'badge-warning', 'Rusak Berat': 'badge-danger' };
    return '<span class="badge ' + (map[k] || 'badge-neutral') + '">' + esc(k || '-') + '</span>';
  }

  function statusBadge(s) {
    const map = { 'Aktif': 'badge-info', 'Dipinjam': 'badge-warning', 'Maintenance': 'badge-warning', 'Dihapusbukukan': 'badge-neutral' };
    return '<span class="badge ' + (map[s] || 'badge-neutral') + '">' + esc(s || '-') + '</span>';
  }

  function countBy(items, key) {
    const map = new Map();
    items.forEach((a) => {
      const label = a[key] ? String(a[key]) : '(kosong)';
      map.set(label, (map.get(label) || 0) + 1);
    });
    return Array.from(map.entries()).sort((x, y) => y[1] - x[1]);
  }

  /* ==========================================================
   * 5. FORM HELPER
   * ========================================================== */

  function clearErrors(form) {
    if (!form) return;
    $$('[data-err]', form).forEach((el) => { el.textContent = ''; });
    $$('.is-invalid', form).forEach((el) => el.classList.remove('is-invalid'));
  }

  function setFieldError(form, name, message) {
    const el = form.querySelector('[data-err="' + name + '"]');
    if (el) el.textContent = message;
    const input = form.elements[name];
    if (input) input.classList.add('is-invalid');
  }

  function showFormError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
  }

  /* ==========================================================
   * 6. LOGIN, LOGOUT, TEMA, SESI
   * ========================================================== */

  async function onLogin(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    showFormError('loginError', '');

    const username = $('#loginUsername').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    let ok = true;
    if (!username) { setFieldError(form, 'username', 'Username wajib diisi.'); ok = false; }
    if (!password) { setFieldError(form, 'password', 'Password wajib diisi.'); ok = false; }
    if (!ok) return;

    const btn = $('#btnLogin');
    UI.setBtnLoading(btn, true, 'Memeriksa...');
    try {
      const res = await Api.login(username, password);
      Api.setToken(res.data.token);
      state.user = res.data.user;
      $('#loginPassword').value = '';
      loadMasterQuietly();
      UI.toast('Selamat datang, ' + state.user.nama + '.', 'success');
      redirect('home');
    } catch (err) {
      showFormError('loginError', err.message);
    } finally {
      UI.setBtnLoading(btn, false);
    }
  }

  async function onLogout() {
    try { await Api.logout(); } catch (_) { /* sesi mungkin sudah habis */ }
    clearSession();
    UI.toast('Anda sudah keluar.', 'info');
    redirect('login');
  }

  function clearSession() {
    Api.clearToken();
    state.user = null;
    state.master = null;
    state.list.selected.clear();
    state.list.selectMode = false;
    state.labelPrefill = null;
    state.form = { mode: 'new', kode: null, asset: null, prefill: null, dirty: false };
    invalidateCache();
  }

  function onAuthExpired() {
    if (!state.user) return;
    clearSession();
    UI.toast('Sesi Anda sudah habis. Silakan masuk kembali.', 'warning', 5000);
    redirect('login');
  }

  function togglePasswordVisibility() {
    const input = $('#loginPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const btn = $('#btnTogglePassword');
    btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
    btn.innerHTML = '<i data-lucide="' + (show ? 'eye-off' : 'eye') + '" class="w-5 h-5"></i>';
    UI.icons();
  }

  function applyTheme(isDark) {
    document.documentElement.classList.toggle('dark', !!isDark);
    const btn = $('#btnTheme');
    if (btn) {
      btn.innerHTML = '<i data-lucide="' + (isDark ? 'sun' : 'moon') + '" class="w-5 h-5"></i>';
    }
    const btnLogin = $('#btnLoginTheme');
    if (btnLogin) {
      btnLogin.innerHTML = '<i data-lucide="' + (isDark ? 'sun' : 'moon') + '" class="w-5 h-5"></i>';
    }
    UI.icons();
  }

  function toggleTheme() {
    const dark = !document.documentElement.classList.contains('dark');
    applyTheme(dark);
    try { localStorage.setItem(APP_CONFIG.STORAGE_KEYS.THEME, dark ? 'dark' : 'light'); } catch (_) {}
  }

  /* ==========================================================
   * 7. BERANDA (DASHBOARD)
   * ========================================================== */

  async function loadHome() {
    $('#homeName').textContent = state.user ? state.user.nama : '';
    try {
      const items = await getAllAssets();
      renderDashboard(items);
    } catch (err) {
      handleError(err);
    }
  }

  function renderDashboard(items) {
    const total = items.length;
    const nilai = items.reduce((s, a) => s + (Number(a.harga_perolehan) || 0), 0);
    const rusak = items.filter((a) => a.kondisi === 'Rusak Ringan' || a.kondisi === 'Rusak Berat').length;
    const garansi = items.filter((a) => {
      const d = daysUntil(a.garansi_sampai);
      return d !== null && d >= 0 && d <= APP_CONFIG.WARRANTY_ALERT_DAYS;
    });

    $('#statTotal').textContent = total.toLocaleString('id-ID');
    $('#statValue').textContent = rupiah(nilai);
    $('#statRusak').textContent = rusak.toLocaleString('id-ID');
    $('#statGaransi').textContent = garansi.length.toLocaleString('id-ID');

    renderBars($('#chartKategori'), countBy(items, 'kategori'));
    renderBars($('#chartKondisi'), countBy(items, 'kondisi'));
    renderBars($('#chartLokasi'), countBy(items, 'lokasi'));
    renderAlerts(items);
    UI.icons();
  }

  function renderBars(container, counts) {
    container.innerHTML = '';
    if (!counts.length) {
      container.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Belum ada data.</p>';
      return;
    }
    const max = Math.max.apply(null, counts.map((c) => c[1]));
    counts.forEach(([label, n]) => {
      const pct = max ? Math.round((n / max) * 100) : 0;
      const row = document.createElement('div');
      row.innerHTML =
        '<div class="flex justify-between gap-2 text-sm">' +
          '<span class="truncate">' + esc(label) + '</span>' +
          '<span class="font-semibold">' + n + '</span>' +
        '</div>' +
        '<div class="h-2 mt-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">' +
          '<div class="h-full rounded-full bg-brand-600" style="width:' + pct + '%"></div>' +
        '</div>';
      container.appendChild(row);
    });
  }

  function renderAlerts(items) {
    const alerts = [];
    items.forEach((a) => {
      const d = daysUntil(a.garansi_sampai);
      if (a.kondisi === 'Rusak Berat') alerts.push({ a: a, text: 'Rusak berat', tone: 'danger' });
      if (a.status === 'Maintenance') alerts.push({ a: a, text: 'Maintenance', tone: 'warning' });
      if (d !== null && d >= 0 && d <= APP_CONFIG.WARRANTY_ALERT_DAYS) {
        alerts.push({ a: a, text: 'Garansi ' + d + ' hari lagi', tone: 'info' });
      }
    });

    const ul = $('#alertList');
    ul.innerHTML = '';
    if (!alerts.length) {
      ul.innerHTML = '<li class="py-3 text-sm text-slate-500 dark:text-slate-400">Tidak ada hal yang perlu perhatian.</li>';
      return;
    }
    alerts.slice(0, 20).forEach((item) => {
      const li = document.createElement('li');
      li.innerHTML =
        '<button type="button" data-kode="' + esc(item.a.kode_aset) + '" class="w-full text-left py-3 px-1 flex items-center justify-between gap-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">' +
          '<span class="min-w-0">' +
            '<span class="block font-medium truncate">' + esc(item.a.nama_aset) + '</span>' +
            '<span class="block text-xs font-mono text-slate-500 dark:text-slate-400">' + esc(item.a.kode_aset) + '</span>' +
          '</span>' +
          '<span class="badge badge-' + item.tone + ' shrink-0">' + esc(item.text) + '</span>' +
        '</button>';
      ul.appendChild(li);
    });
  }

  /* ==========================================================
   * 8. DAFTAR ASET
   * ========================================================== */

  function populateFilters() {
    const m = state.master || {};
    const L = state.list;
    fillSelect($('#filterKategori'), m.kategori || [], 'Semua', L.kategori);
    fillSelect($('#filterLokasi'), m.lokasi || [], 'Semua', L.lokasi);
    fillSelect($('#filterKondisi'), m.kondisi || [], 'Semua', L.kondisi);
    fillSelect($('#filterStatus'), m.status || [], 'Semua', L.status);
  }

  function fillSelect(sel, values, placeholder, current) {
    if (!sel) return;
    const list = values.slice();
    if (current && list.indexOf(current) === -1) list.push(current);
    sel.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    sel.appendChild(first);
    list.forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    sel.value = current || '';
  }

  function syncListControls() {
    const L = state.list;
    $('#searchInput').value = L.q;
    $('#sortBy').value = L.sortBy;
    $('#sortDir').value = L.sortDir;
    $('#filterDeleted').checked = L.includeDeleted;
    $('#filterDeletedWrap').classList.toggle('hidden', !isAdmin());
    $('#listSelectBar').classList.toggle('hidden', !L.selectMode);
    $('#btnSelectMode').querySelector('span').textContent = L.selectMode ? 'Selesai memilih' : 'Pilih untuk label';
    $('#selectCount').textContent = L.selected.size;
  }

  async function loadList() {
    populateFilters();
    syncListControls();
    const L = state.list;
    const reqId = ++listReq;

    $('#assetListSkeleton').classList.remove('hidden');
    $('#assetList').classList.add('hidden');
    $('#emptyList').classList.add('hidden');

    try {
      const res = await Api.listAssets({
        q: L.q,
        kategori: L.kategori,
        lokasi: L.lokasi,
        kondisi: L.kondisi,
        status: L.status,
        sortBy: L.sortBy,
        sortDir: L.sortDir,
        page: L.page,
        pageSize: APP_CONFIG.PAGE_SIZE,
        includeDeleted: L.includeDeleted
      });
      if (reqId !== listReq) return;

      const d = res.data;
      L.page = d.page;
      L.totalPages = d.totalPages;
      L.total = d.total;
      L.items = d.items;

      renderAssetList();
      $('#listCount').textContent = d.total.toLocaleString('id-ID') + ' aset';
      $('#emptyList').classList.toggle('hidden', d.items.length > 0);
      renderPagination();
    } catch (err) {
      if (reqId === listReq) handleError(err);
    } finally {
      if (reqId === listReq) {
        $('#assetListSkeleton').classList.add('hidden');
        $('#assetList').classList.remove('hidden');
      }
    }
  }

  function renderAssetList() {
    const ul = $('#assetList');
    const L = state.list;
    ul.innerHTML = '';
    L.items.forEach((a) => {
      const sel = L.selected.has(a.kode_aset);
      const li = document.createElement('li');
      const checkbox = L.selectMode
        ? '<span class="mt-1 grid place-items-center w-5 h-5 rounded border shrink-0 ' +
            (sel ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-300 dark:border-slate-600') + '">' +
            (sel ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : '') +
          '</span>'
        : '';
      const thumb = a.foto_url
        ? '<img class="asset-thumb" src="' + esc(a.foto_url) + '" alt="" loading="lazy" />'
        : '<div class="asset-thumb grid place-items-center text-slate-400"><i data-lucide="image" class="w-6 h-6"></i></div>';
      const deleted = a.is_deleted ? '<span class="badge badge-danger">Dihapus</span>' : '';

      li.innerHTML =
        '<article class="asset-item ' + (sel ? 'is-selected' : '') + '" data-kode="' + esc(a.kode_aset) + '" tabindex="0" role="button">' +
          checkbox + thumb +
          '<div class="min-w-0 flex-1">' +
            '<p class="font-mono text-xs text-slate-500 dark:text-slate-400">' + esc(a.kode_aset) + '</p>' +
            '<p class="font-semibold truncate">' + esc(a.nama_aset) + '</p>' +
            '<p class="text-sm text-slate-500 dark:text-slate-400 truncate">' + esc(a.kategori) + ' · ' + esc(a.lokasi) + '</p>' +
            '<div class="flex flex-wrap gap-1.5 mt-2">' + conditionBadge(a.kondisi) + statusBadge(a.status) + deleted + '</div>' +
          '</div>' +
        '</article>';
      ul.appendChild(li);
    });
    UI.icons();
  }

  function renderPagination() {
    const L = state.list;
    const nav = $('#pagination');
    nav.classList.toggle('hidden', L.totalPages <= 1);
    $('#pageInfo').textContent = 'Halaman ' + L.page + ' dari ' + L.totalPages;
    $('#btnPrev').disabled = L.page <= 1;
    $('#btnNext').disabled = L.page >= L.totalPages;
  }

  function toggleSelect(kode) {
    const sel = state.list.selected;
    if (sel.has(kode)) sel.delete(kode);
    else sel.add(kode);
    syncListControls();
    renderAssetList();
  }

  function bindListEvents() {
    const L = state.list;

    $('#searchInput').addEventListener('input', debounce((e) => {
      L.q = e.target.value.trim();
      L.page = 1;
      loadList();
    }, 300));

    const filterMap = {
      filterKategori: 'kategori', filterLokasi: 'lokasi',
      filterKondisi: 'kondisi', filterStatus: 'status',
      sortBy: 'sortBy', sortDir: 'sortDir'
    };
    Object.keys(filterMap).forEach((id) => {
      $('#' + id).addEventListener('change', (e) => {
        L[filterMap[id]] = e.target.value;
        L.page = 1;
        loadList();
      });
    });

    $('#filterDeleted').addEventListener('change', (e) => {
      if (!isAdmin()) return;
      L.includeDeleted = e.target.checked;
      L.page = 1;
      loadList();
    });

    $('#btnFilterToggle').addEventListener('click', (e) => {
      const panel = $('#filterPanel');
      const open = panel.classList.toggle('hidden') === false;
      e.currentTarget.setAttribute('aria-expanded', String(open));
    });

    $('#btnFilterReset').addEventListener('click', () => {
      Object.assign(L, { kategori: '', lokasi: '', kondisi: '', status: '', sortBy: 'updated_at', sortDir: 'desc', includeDeleted: false, page: 1 });
      loadList();
    });

    $('#btnPrev').addEventListener('click', () => { if (L.page > 1) { L.page--; loadList(); } });
    $('#btnNext').addEventListener('click', () => { if (L.page < L.totalPages) { L.page++; loadList(); } });

    $('#btnSelectMode').addEventListener('click', () => {
      L.selectMode = !L.selectMode;
      if (!L.selectMode) L.selected.clear();
      syncListControls();
      renderAssetList();
    });
    $('#btnSelectCancel').addEventListener('click', () => {
      L.selectMode = false;
      L.selected.clear();
      syncListControls();
      renderAssetList();
    });
    $('#btnLabelSelected').addEventListener('click', () => {
      if (!L.selected.size) return UI.toast('Pilih minimal satu aset.', 'warning');
      state.labelPrefill = Array.from(L.selected);
      L.selectMode = false;
      L.selected.clear();
      go('label');
    });

    const list = $('#assetList');
    list.addEventListener('click', (e) => {
      const card = e.target.closest('.asset-item');
      if (!card) return;
      if (L.selectMode) toggleSelect(card.dataset.kode);
      else go('asset/' + encodeURIComponent(card.dataset.kode));
    });
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const card = e.target.closest('.asset-item');
      if (card) card.click();
    });
  }

  /* ==========================================================
   * 9. DETAIL ASET
   * ========================================================== */

  async function loadDetail(kode) {
    state.detail.kode = kode;
    UI.setLoading(true, 'Memuat detail aset...');
    try {
      const res = await Api.getAsset(kode);
      state.detail.asset = res.data.asset;
      state.detail.documents = res.data.documents || [];
      renderDetail();
    } catch (err) {
      if (err.code === 'NOT_FOUND' || err.code === 'DELETED') {
        UI.toast(err.message, 'warning', 4500);
        redirect('list');
      } else {
        handleError(err);
        redirect('list');
      }
    } finally {
      UI.setLoading(false);
    }
  }

  function reloadDetail() {
    invalidateCache();
    if (state.currentView === 'asset' && state.detail.kode) loadDetail(state.detail.kode);
  }

  function dlItem(label, value) {
    return '<div><dt class="text-xs text-slate-500 dark:text-slate-400">' + esc(label) + '</dt>' +
      '<dd class="font-medium break-words">' + value + '</dd></div>';
  }

  function renderDetail() {
    const a = state.detail.asset;
    const deleted = !!a.is_deleted;
    const editable = canEdit() && !deleted;

    $('#detailKode').textContent = a.kode_aset;
    $('#detailNama').textContent = a.nama_aset;
    $('#detailDeletedBadge').classList.toggle('hidden', !deleted);

    const foto = $('#detailFoto');
    const fotoEmpty = $('#detailFotoEmpty');
    if (a.foto_url) {
      foto.src = a.foto_url;
      foto.classList.remove('hidden');
      fotoEmpty.classList.add('hidden');
    } else {
      foto.removeAttribute('src');
      foto.classList.add('hidden');
      fotoEmpty.classList.remove('hidden');
    }

    $('#detailKondisi').className = 'badge ' + ({ 'Baik': 'badge-success', 'Rusak Ringan': 'badge-warning', 'Rusak Berat': 'badge-danger' }[a.kondisi] || 'badge-neutral');
    $('#detailKondisi').textContent = a.kondisi || '-';
    $('#detailStatus').className = 'badge ' + ({ 'Aktif': 'badge-info', 'Dipinjam': 'badge-warning', 'Maintenance': 'badge-warning', 'Dihapusbukukan': 'badge-neutral' }[a.status] || 'badge-neutral');
    $('#detailStatus').textContent = a.status || '-';

    const garansiEl = $('#detailGaransi');
    const d = daysUntil(a.garansi_sampai);
    if (d === null) {
      garansiEl.classList.add('hidden');
    } else {
      garansiEl.classList.remove('hidden');
      if (d < 0) {
        garansiEl.className = 'badge badge-danger';
        garansiEl.textContent = 'Garansi habis';
      } else if (d <= APP_CONFIG.WARRANTY_ALERT_DAYS) {
        garansiEl.className = 'badge badge-warning';
        garansiEl.textContent = 'Garansi ' + d + ' hari lagi';
      } else {
        garansiEl.className = 'badge badge-info';
        garansiEl.textContent = 'Garansi s.d. ' + formatDate(a.garansi_sampai);
      }
    }

    $('#detailInfo').innerHTML = [
      dlItem('Kategori', esc(a.kategori || '-')),
      dlItem('Lokasi', esc(a.lokasi || '-')),
      dlItem('Merek', esc(a.merek || '-')),
      dlItem('Model', esc(a.model || '-')),
      dlItem('Serial number', '<span class="font-mono">' + esc(a.serial_number || '-') + '</span>'),
      dlItem('Penanggung jawab', esc(a.penanggung_jawab || '-')),
      dlItem('Tanggal perolehan', esc(formatDate(a.tanggal_perolehan))),
      dlItem('Harga perolehan', esc(rupiah(a.harga_perolehan))),
      dlItem('Terakhir diubah', esc(formatDateTime(a.updated_at) + ' · ' + (a.updated_by || '-'))),
      dlItem('Keterangan', esc(a.keterangan || '-'))
    ].join('');

    $('#btnEdit').classList.toggle('hidden', !editable);
    $('#btnRestore').classList.toggle('hidden', !(isAdmin() && deleted));
    $('#btnFotoKamera').classList.toggle('hidden', !editable);
    $('#btnFotoGaleri').classList.toggle('hidden', !editable);
    $('#btnAddDoc').classList.toggle('hidden', !editable);

    renderDocs(state.detail.documents);
    UI.icons();
  }

  function docIcon(jenis) {
    return { Foto: 'image', Nota: 'receipt', Garansi: 'shield-check', Manual: 'book-open', BAST: 'file-signature' }[jenis] || 'file';
  }

  function renderDocs(docs) {
    const ul = $('#docList');
    ul.innerHTML = '';
    $('#docEmpty').classList.toggle('hidden', docs.length > 0);
    const editable = canEdit() && !state.detail.asset.is_deleted;

    docs.forEach((d) => {
      const li = document.createElement('li');
      li.className = 'py-3 flex items-center gap-3';
      li.innerHTML =
        '<span class="grid place-items-center w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 shrink-0">' +
          '<i data-lucide="' + docIcon(d.jenis) + '" class="w-5 h-5"></i>' +
        '</span>' +
        '<div class="min-w-0 flex-1">' +
          '<p class="font-medium truncate">' + esc(d.nama_dokumen) + '</p>' +
          '<p class="text-xs text-slate-500 dark:text-slate-400">' + esc(d.jenis) + ' · ' + esc(formatDateTime(d.uploaded_at)) + ' · ' + esc(d.uploaded_by) + '</p>' +
        '</div>' +
        '<a href="' + esc(d.file_url) + '" target="_blank" rel="noopener" class="btn-ghost !px-2">Buka</a>' +
        (editable
          ? '<button type="button" class="icon-btn text-red-600 dark:text-red-400" data-action="delete-doc" data-id="' + esc(d.id) + '" aria-label="Hapus dokumen"><i data-lucide="trash-2" class="w-4 h-4"></i></button>'
          : '');
      ul.appendChild(li);
    });
    UI.icons();
  }

  async function onDeleteDoc(id) {
    const ok = await UI.confirmDialog({
      title: 'Hapus dokumen?',
      message: 'Berkas akan dipindahkan ke sampah Google Drive.',
      okText: 'Ya, hapus',
      danger: true
    });
    if (!ok) return;
    UI.setLoading(true, 'Menghapus dokumen...');
    try {
      const res = await Api.deleteDocument(id);
      UI.toast(res.message, 'success');
      reloadDetail();
    } catch (err) {
      handleError(err);
    } finally {
      UI.setLoading(false);
    }
  }

  async function onRestoreAsset() {
    UI.setLoading(true, 'Memulihkan aset...');
    try {
      const res = await Api.restoreAsset(state.detail.kode);
      UI.toast(res.message, 'success');
      reloadDetail();
    } catch (err) {
      handleError(err);
    } finally {
      UI.setLoading(false);
    }
  }

  function openUpload(opts) {
    if (!window.UploadTools || typeof UploadTools.open !== 'function') {
      UI.toast('Modul unggah belum tersedia.', 'error');
      return;
    }
    UploadTools.open(Object.assign({
      kodeAset: state.detail.kode,
      onUploaded: () => reloadDetail()
    }, opts));
  }

  /* ==========================================================
   * 10. FORM ASET (TAMBAH / EDIT)
   * ========================================================== */

  function fillMasterSelects(form, asset) {
    const m = state.master || {};
    fillSelect(form.elements.kategori, m.kategori || [], 'Pilih kategori...', asset ? asset.kategori : '');
    fillSelect(form.elements.lokasi, m.lokasi || [], 'Pilih lokasi...', asset ? asset.lokasi : '');
    fillSelect(form.elements.kondisi, m.kondisi || [], 'Pilih kondisi...', asset ? asset.kondisi : '');
    fillSelect(form.elements.status, m.status || [], 'Pilih status...', asset ? asset.status : '');
  }

  function fillFormFromAsset(form, a) {
    ['nama_aset', 'merek', 'model', 'serial_number', 'penanggung_jawab',
     'tanggal_perolehan', 'garansi_sampai', 'keterangan', 'kode_aset'].forEach((n) => {
      form.elements[n].value = a[n] === undefined || a[n] === null ? '' : a[n];
    });
    form.elements.harga_perolehan.value = formatMoney(a.harga_perolehan);
    form.elements.updated_at.value = a.updated_at || '';
    updateKeteranganCount();
  }

  function updateKeteranganCount() {
    const form = $('#formAsset');
    $('#fKeteranganCount').textContent = form.elements.keterangan.value.length;
  }

  function onMoneyInput(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 15);
    e.target.value = digits ? Number(digits).toLocaleString('id-ID') : '';
  }

  async function loadForm(r) {
    const form = $('#formAsset');
    form.reset();
    clearErrors(form);
    showFormError('formError', '');
    $('#addLokasiBox').classList.add('hidden');
    $('#inputNewLokasi').value = '';
    state.form.dirty = false;
    fillMasterSelects(form, null);

    if (r.param === 'new') {
      state.form.mode = 'new';
      state.form.kode = null;
      state.form.asset = null;
      const kode = state.form.prefill || '';
      state.form.prefill = null;

      form.elements.kode_aset.value = kode;
      $('#formTitle').textContent = 'Tambah aset';
      $('#formSubtitle').textContent = kode
        ? 'Kode diambil dari hasil scan. Lengkapi data aset.'
        : 'Kode aset dibuat otomatis saat disimpan.';
      $('#btnDeleteAsset').classList.add('hidden');
      $('#btnFormScanKode').classList.remove('hidden');
      updateKeteranganCount();
      UI.icons();
      return;
    }

    state.form.mode = 'edit';
    state.form.kode = r.sub;
    UI.setLoading(true, 'Memuat data aset...');
    try {
      const res = await Api.getAsset(r.sub);
      const a = res.data.asset;
      state.form.asset = a;
      fillMasterSelects(form, a);
      fillFormFromAsset(form, a);
      $('#formTitle').textContent = 'Edit aset';
      $('#formSubtitle').textContent = a.kode_aset;
      $('#btnFormScanKode').classList.add('hidden');
      $('#btnDeleteAsset').classList.toggle('hidden', !isAdmin());
      state.form.dirty = false;
      UI.icons();
    } catch (err) {
      handleError(err);
      redirect('list');
    } finally {
      UI.setLoading(false);
    }
  }

  function collectAssetPayload(form) {
    const v = (n) => String(form.elements[n].value || '').trim();
    return {
      nama_aset: v('nama_aset'),
      kategori: v('kategori'),
      merek: v('merek'),
      model: v('model'),
      serial_number: v('serial_number'),
      lokasi: v('lokasi'),
      penanggung_jawab: v('penanggung_jawab'),
      tanggal_perolehan: v('tanggal_perolehan'),
      harga_perolehan: v('harga_perolehan').replace(/\D/g, ''),
      kondisi: v('kondisi'),
      status: v('status'),
      garansi_sampai: v('garansi_sampai'),
      keterangan: v('keterangan')
    };
  }

  function validateAsset(form, p) {
    let ok = true;
    const required = [
      ['nama_aset', 'Nama aset wajib diisi.'],
      ['kategori', 'Kategori wajib dipilih.'],
      ['lokasi', 'Lokasi wajib dipilih.'],
      ['kondisi', 'Kondisi wajib dipilih.'],
      ['status', 'Status wajib dipilih.']
    ];
    required.forEach(([field, msg]) => {
      if (!p[field]) { setFieldError(form, field, msg); ok = false; }
    });
    if (p.nama_aset.length > 150) { setFieldError(form, 'nama_aset', 'Nama maksimal 150 karakter.'); ok = false; }
    if (p.serial_number.length > 80) { setFieldError(form, 'serial_number', 'Serial number maksimal 80 karakter.'); ok = false; }
    if (p.tanggal_perolehan && !UI.isDateStr(p.tanggal_perolehan)) {
      setFieldError(form, 'tanggal_perolehan', 'Tanggal tidak valid.'); ok = false;
    }
    if (p.garansi_sampai && !UI.isDateStr(p.garansi_sampai)) {
      setFieldError(form, 'garansi_sampai', 'Tanggal tidak valid.'); ok = false;
    }
    if (p.tanggal_perolehan && p.garansi_sampai && p.garansi_sampai < p.tanggal_perolehan) {
      setFieldError(form, 'garansi_sampai', 'Garansi tidak boleh sebelum tanggal perolehan.'); ok = false;
    }
    if (p.harga_perolehan.length > 15) {
      setFieldError(form, 'harga_perolehan', 'Harga terlalu besar.'); ok = false;
    }
    return ok;
  }

  async function onSubmitAsset(e) {
    e.preventDefault();
    const form = $('#formAsset');
    clearErrors(form);
    showFormError('formError', '');

    const payload = collectAssetPayload(form);
    if (!validateAsset(form, payload)) {
      UI.toast('Periksa kembali isian yang belum lengkap.', 'error');
      return;
    }

    const btn = $('#btnSaveAsset');
    UI.setBtnLoading(btn, true, 'Menyimpan...');
    try {
      if (state.form.mode === 'new') {
        const kode = String(form.elements.kode_aset.value || '').trim();
        if (kode) payload.kode_aset = kode;
        const res = await Api.createAsset(payload);
        invalidateCache();
        state.form.dirty = false;
        UI.toast(res.message, 'success');
        go('asset/' + encodeURIComponent(res.data.kode_aset));
      } else {
        payload.kode_aset = state.form.kode;
        payload.updated_at = form.elements.updated_at.value;
        const res = await Api.updateAsset(payload);
        invalidateCache();
        state.form.dirty = false;
        UI.toast(res.message, 'success');
        go('asset/' + encodeURIComponent(state.form.kode));
      }
    } catch (err) {
      if (err.code === 'VALIDATION' && /serial/i.test(err.message)) {
        setFieldError(form, 'serial_number', err.message);
      }
      showFormError('formError', err.message);
      if (err.code === 'CONFLICT') UI.toast(err.message, 'error', 6000);
    } finally {
      UI.setBtnLoading(btn, false);
    }
  }

  function needsLeaveConfirm() {
    return state.currentView === 'form' && state.form.dirty;
  }

  async function confirmLeave() {
    if (!needsLeaveConfirm()) return true;
    return UI.confirmDialog({
      title: 'Tinggalkan halaman?',
      message: 'Perubahan yang belum disimpan akan hilang.',
      okText: 'Ya, tinggalkan',
      danger: true
    });
  }

  async function leaveForm() {
    if (!(await confirmLeave())) return;
    state.form.dirty = false;
    if (state.form.mode === 'edit' && state.form.kode) {
      go('asset/' + encodeURIComponent(state.form.kode));
    } else {
      go('list');
    }
  }

  async function onDeleteAsset() {
    const kode = state.form.kode;
    if (!kode) return;
    const ok = await UI.confirmDialog({
      title: 'Hapus aset ' + kode + '?',
      message: 'Aset akan disembunyikan dari daftar. Admin masih dapat memulihkannya.',
      okText: 'Ya, hapus',
      danger: true
    });
    if (!ok) return;
    UI.setLoading(true, 'Menghapus aset...');
    try {
      const res = await Api.deleteAsset(kode);
      invalidateCache();
      state.form.dirty = false;
      UI.toast(res.message, 'success');
      go('list');
    } catch (err) {
      handleError(err);
    } finally {
      UI.setLoading(false);
    }
  }

  /* ==========================================================
   * 11. SCAN QR
   * ========================================================== */

  function needModule(name, fn) {
    if (window[name] && typeof window[name][fn] === 'function') return true;
    UI.toast('Fitur ' + name + ' belum tersedia.', 'error');
    return false;
  }

  function onOpenScan() {
    if (!needModule('Scanner', 'open')) return;
    Scanner.open({ onDecode: (text) => handleScanResult(text, { fromForm: false }) });
  }

  /**
   * Hasil scan (atau input manual kode):
   * - Kode terdaftar   -> buka detail (mode lihat/edit).
   * - Belum terdaftar  -> form tambah dengan kode terisi dari hasil scan.
   */
  async function handleScanResult(raw, opts) {
    const options = opts || {};
    const kode = normalizeKode(raw);
    if (!kode) {
      UI.toast('Kode ini bukan kode aset yang valid.', 'error');
      return false;
    }
    if (window.Scanner && typeof Scanner.close === 'function') Scanner.close();

    UI.setLoading(true, 'Mencari aset...');
    try {
      await Api.getAsset(kode);
    } catch (err) {
      UI.setLoading(false);
      if (err.code === 'NOT_FOUND') return onScanUnregistered(kode, options);
      if (err.code === 'DELETED') {
        UI.toast(err.message, 'warning', 5000);
        return false;
      }
      handleError(err);
      return false;
    }
    UI.setLoading(false);

    if (!(await confirmLeave())) return false;
    state.form.dirty = false;
    UI.toast('Aset ' + kode + ' ditemukan.', 'success', 2000);
    go('asset/' + encodeURIComponent(kode));
    return true;
  }

  async function onScanUnregistered(kode, opts) {
    if (!canEdit()) {
      UI.toast('Kode ' + kode + ' belum terdaftar. Hubungi Operator untuk mendaftarkannya.', 'warning', 5000);
      return false;
    }

    if (opts.fromForm && state.form.mode === 'new') {
      $('#fKodeAset').value = kode;
      $('#formSubtitle').textContent = 'Kode diambil dari hasil scan. Lengkapi data aset.';
      UI.toast('Kode ' + kode + ' dipasang pada form.', 'success');
      return true;
    }

    if (!(await confirmLeave())) return false;
    state.form.prefill = kode;
    UI.toast('Kode ' + kode + ' belum terdaftar. Lengkapi data aset.', 'info', 4000);
    if (location.hash === '#/form/new') route();
    else go('form/new');
    return true;
  }

  /* ==========================================================
   * 12. CETAK LABEL
   * ========================================================== */

  function parseCodes(text) {
    const tokens = String(text || '').split(/[\n,;\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const valid = [];
    const invalid = [];
    tokens.forEach((c) => (APP_CONFIG.KODE_PATTERN.test(c) ? valid : invalid).push(c));
    return { valid: Array.from(new Set(valid)), invalid: invalid };
  }

  function updateLabelCount() {
    const { valid, invalid } = parseCodes($('#labelInput').value);
    let text = valid.length + ' label';
    if (invalid.length) text += ' · ' + invalid.length + ' format tidak valid';
    $('#labelCount').textContent = text;
  }

  function loadLabel() {
    if (state.labelPrefill) {
      $('#labelInput').value = state.labelPrefill.join('\n');
      state.labelPrefill = null;
    }
    updateLabelCount();
    UI.icons();
  }

  /** Mengubah isi textarea menjadi daftar aset. Kode yang tidak ditemukan diberi peringatan. */
  async function resolveLabelAssets() {
    const { valid, invalid } = parseCodes($('#labelInput').value);
    if (invalid.length) {
      UI.toast('Format tidak valid: ' + invalid.slice(0, 5).join(', '), 'warning', 5000);
    }
    if (!valid.length) {
      UI.toast('Masukkan minimal satu kode aset.', 'warning');
      return null;
    }
    if (valid.length > APP_CONFIG.LABEL_MAX) {
      UI.toast('Maksimal ' + APP_CONFIG.LABEL_MAX + ' label sekali cetak.', 'warning');
      return null;
    }

    UI.setLoading(true, 'Menyiapkan label...');
    try {
      const all = await getAllAssets();
      const map = new Map(all.map((a) => [a.kode_aset, a]));
      const found = [];
      const missing = [];
      valid.forEach((c) => (map.has(c) ? found.push(map.get(c)) : missing.push(c)));
      if (missing.length) {
        UI.toast('Tidak ditemukan atau sudah dihapus: ' + missing.join(', '), 'warning', 6000);
      }
      return found;
    } catch (err) {
      handleError(err);
      return null;
    } finally {
      UI.setLoading(false);
    }
  }

  async function onLabelPreview() {
    const assets = await resolveLabelAssets();
    if (!assets) return;
    if (!assets.length) {
      $('#labelPreview').innerHTML = '';
      return;
    }
    if (!window.QRTools || typeof QRTools.renderLabelSheet !== 'function') {
      UI.toast('Modul QR belum tersedia.', 'error');
      return;
    }
    QRTools.renderLabelSheet($('#labelPreview'), assets);
    UI.icons();
  }

  async function onLabelPrint() {
    const assets = await resolveLabelAssets();
    if (!assets || !assets.length) return;
    if (!window.QRTools || typeof QRTools.printLabelSheet !== 'function') {
      UI.toast('Modul QR belum tersedia.', 'error');
      return;
    }
    QRTools.printLabelSheet(assets);
  }

  /* ==========================================================
   * 13. AKUN, GANTI PASSWORD, ADMIN, AUDIT LOG
   * ========================================================== */

  function loadAccount() {
    $('#accountInfo').textContent = state.user.nama + ' · ' + state.user.username + ' · ' + state.user.role;
    $('#adminSection').classList.toggle('hidden', !isAdmin());
    if (isAdmin()) loadAudit();
    UI.icons();
  }

  async function onChangePassword(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const oldPw = form.elements.oldPassword.value;
    const newPw = form.elements.newPassword.value;
    const confirmPw = form.elements.confirmPassword.value;

    let ok = true;
    if (!oldPw) { setFieldError(form, 'oldPassword', 'Password lama wajib diisi.'); ok = false; }
    if (newPw.length < 8 || newPw.length > 128) { setFieldError(form, 'newPassword', 'Password harus 8–128 karakter.'); ok = false; }
    else if (!/[A-Za-z]/.test(newPw) || !/\d/.test(newPw)) { setFieldError(form, 'newPassword', 'Password harus mengandung huruf dan angka.'); ok = false; }
    if (newPw !== confirmPw) { setFieldError(form, 'confirmPassword', 'Konfirmasi password tidak sama.'); ok = false; }
    if (!ok) return;

    const btn = $('#btnChangePassword');
    UI.setBtnLoading(btn, true, 'Menyimpan...');
    try {
      const res = await Api.changePassword(oldPw, newPw);
      form.reset();
      UI.toast(res.message, 'success');
    } catch (err) {
      if (err.code === 'INVALID_CREDENTIALS') setFieldError(form, 'oldPassword', err.message);
      else if (err.code === 'VALIDATION') setFieldError(form, 'newPassword', err.message);
      else handleError(err);
    } finally {
      UI.setBtnLoading(btn, false);
    }
  }

  async function onCreateUser(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const data = {
      username: form.elements.username.value.trim().toLowerCase(),
      nama: form.elements.nama.value.trim(),
      role: form.elements.role.value,
      password: form.elements.password.value
    };

    let ok = true;
    if (!/^[a-z0-9_.]{3,30}$/.test(data.username)) { setFieldError(form, 'username', '3–30 karakter: huruf kecil, angka, titik, atau garis bawah.'); ok = false; }
    if (!data.nama) { setFieldError(form, 'nama', 'Nama wajib diisi.'); ok = false; }
    if (!data.password) { setFieldError(form, 'password', 'Password awal wajib diisi.'); ok = false; }
    if (!ok) return;

    const btn = $('#btnCreateUser');
    UI.setBtnLoading(btn, true, 'Menyimpan...');
    try {
      const res = await Api.createUser(data);
      form.reset();
      UI.toast(res.message, 'success');
    } catch (err) {
      if (err.code === 'DUPLICATE') setFieldError(form, 'username', err.message);
      else if (err.code === 'VALIDATION') setFieldError(form, 'password', err.message);
      else handleError(err);
    } finally {
      UI.setBtnLoading(btn, false);
    }
  }

  async function loadAudit() {
    const kode = $('#auditKode').value.trim().toUpperCase();
    const ul = $('#auditList');
    ul.innerHTML = '<li class="skeleton h-14"></li>';
    try {
      const res = await Api.listAuditLog({ kode_aset: kode, limit: 100 });
      renderAudit(res.data || []);
    } catch (err) {
      ul.innerHTML = '';
      handleError(err);
    }
  }

  function describeAuditDetail(aksi, detail) {
    if (aksi === 'UPDATE') {
      try {
        const changes = JSON.parse(detail);
        return Object.keys(changes).map((field) => {
          const c = changes[field];
          return field + ': ' + (c.dari || '-') + ' → ' + (c.ke || '-');
        }).join('\n');
      } catch (_) { /* bukan JSON, tampilkan apa adanya */ }
    }
    return detail || '';
  }

  function renderAudit(rows) {
    const ol = $('#auditList');
    ol.innerHTML = '';
    if (!rows.length) {
      ol.innerHTML = '<li class="text-slate-500 dark:text-slate-400">Belum ada riwayat.</li>';
      return;
    }
    rows.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'pb-3 border-b border-slate-200 dark:border-slate-800 last:border-0';
      li.innerHTML =
        '<div class="flex justify-between gap-2">' +
          '<span class="font-semibold">' + esc(r.aksi) + (r.kode_aset ? ' · <span class="font-mono">' + esc(r.kode_aset) + '</span>' : '') + '</span>' +
          '<span class="text-xs text-slate-500 dark:text-slate-400 shrink-0">' + esc(formatDateTime(r.timestamp)) + '</span>' +
        '</div>' +
        '<p class="text-xs text-slate-500 dark:text-slate-400">' + esc(r.user) + '</p>' +
        '<p class="text-xs whitespace-pre-wrap break-words mt-1">' + esc(describeAuditDetail(r.aksi, r.detail)) + '</p>';
      ol.appendChild(li);
    });
  }

  /* ==========================================================
   * 14. BINDING EVENT & BOOT
   * ========================================================== */

  function bindEvents() {
    $('#formLogin').addEventListener('submit', onLogin);
    $('#btnTogglePassword').addEventListener('click', togglePasswordVisibility);
    $('#btnTheme').addEventListener('click', toggleTheme);
    const btnLoginTheme = $('#btnLoginTheme');
    if (btnLoginTheme) btnLoginTheme.addEventListener('click', toggleTheme);
    $('#btnLogout').addEventListener('click', onLogout);

    $$('.nav-item').forEach((b) => {
      b.addEventListener('click', async () => {
        if (state.currentView === 'form' && !(await confirmLeave())) return;
        go(b.dataset.nav);
      });
    });
    // Desktop nav items in header
    $$('.nav-item-desktop').forEach((b) => {
      b.addEventListener('click', async () => {
        if (b.dataset.nav === 'scan') { onOpenScan(); return; }
        if (state.currentView === 'form' && !(await confirmLeave())) return;
        go(b.dataset.nav);
      });
    });
    $('#btnScan').addEventListener('click', onOpenScan);
    $('#btnAddAsset').addEventListener('click', () => {
      state.form.prefill = null;
      go('form/new');
    });

    // Beranda
    $('#btnHomeRefresh').addEventListener('click', () => { invalidateCache(); loadHome(); });
    $('#alertList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-kode]');
      if (btn) go('asset/' + encodeURIComponent(btn.dataset.kode));
    });

    // Daftar
    bindListEvents();

    // Detail
    $('#btnDetailBack').addEventListener('click', () => go('list'));
    $('#btnEdit').addEventListener('click', () => go('form/edit/' + encodeURIComponent(state.detail.kode)));
    $('#btnShowQr').addEventListener('click', () => {
      if (!needModule('QRTools', 'openQrModal')) return;
      QRTools.openQrModal(state.detail.asset);
    });
    $('#btnRestore').addEventListener('click', onRestoreAsset);
    $('#btnFotoKamera').addEventListener('click', () => openUpload({ jenisDefault: 'Foto', source: 'camera' }));
    $('#btnFotoGaleri').addEventListener('click', () => openUpload({ jenisDefault: 'Foto', source: 'gallery' }));
    $('#btnAddDoc').addEventListener('click', () => openUpload({ jenisDefault: 'Nota' }));
    $('#docList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="delete-doc"]');
      if (btn) onDeleteDoc(btn.dataset.id);
    });

    // Form
    const formAsset = $('#formAsset');
    formAsset.addEventListener('submit', onSubmitAsset);
    formAsset.addEventListener('input', () => { state.form.dirty = true; });
    formAsset.addEventListener('change', () => { state.form.dirty = true; });
    $('#fHarga').addEventListener('input', onMoneyInput);
    $('#fKeterangan').addEventListener('input', updateKeteranganCount);
    $('#btnFormBack').addEventListener('click', leaveForm);
    $('#btnFormCancel').addEventListener('click', leaveForm);
    $('#btnDeleteAsset').addEventListener('click', onDeleteAsset);
    $('#btnFormScanKode').addEventListener('click', () => {
      if (!needModule('Scanner', 'open')) return;
      Scanner.open({ onDecode: (text) => handleScanResult(text, { fromForm: true }) });
    });

    // Tambah lokasi baru inline di form aset
    const toggleAddLokasi = (show) => {
      const box = $('#addLokasiBox');
      const input = $('#inputNewLokasi');
      box.classList.toggle('hidden', !show);
      if (show) {
        input.value = '';
        input.focus();
      }
    };
    const commitNewLokasi = () => {
      const input = $('#inputNewLokasi');
      const val = input.value.trim();
      if (!val) {
        UI.toast('Nama lokasi tidak boleh kosong.', 'warning');
        input.focus();
        return;
      }
      saveCustomLocation(val);
      const sel = $('#fLokasi');
      const list = (state.master && state.master.lokasi) ? state.master.lokasi : [val];
      const matched = list.find((x) => x.toLowerCase() === val.toLowerCase()) || val;
      fillSelect(sel, list, 'Pilih lokasi...', matched);
      state.form.dirty = true;
      toggleAddLokasi(false);
      UI.toast('Lokasi "' + matched + '" ditambahkan.', 'success');
    };
    $('#btnToggleAddLokasi').addEventListener('click', () => {
      const hidden = $('#addLokasiBox').classList.contains('hidden');
      toggleAddLokasi(hidden);
    });
    $('#btnCancelNewLokasi').addEventListener('click', () => toggleAddLokasi(false));
    $('#btnSaveNewLokasi').addEventListener('click', commitNewLokasi);
    $('#inputNewLokasi').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitNewLokasi();
      } else if (e.key === 'Escape') {
        toggleAddLokasi(false);
      }
    });

    // Label
    $('#labelInput').addEventListener('input', updateLabelCount);
    $('#btnLabelGenerate').addEventListener('click', onLabelPreview);
    $('#btnLabelPrint').addEventListener('click', onLabelPrint);

    // Akun
    $('#formPassword').addEventListener('submit', onChangePassword);
    $('#formCreateUser').addEventListener('submit', onCreateUser);
    $('#btnAuditLoad').addEventListener('click', loadAudit);

    // Modal konfirmasi
    $('#btnConfirmOk').addEventListener('click', () => {
      settleConfirm(true);
      UI.closeModal('confirmModal');
    });
    $('#btnConfirmCancel').addEventListener('click', () => {
      settleConfirm(false);
      UI.closeModal('confirmModal');
    });
    document.addEventListener('modal:closed', (e) => {
      if (e.detail.id === 'confirmModal') settleConfirm(false);
    });

    // Tutup modal dengan klik latar belakang dan tombol Escape
    $$('.modal').forEach((m) => {
      m.addEventListener('click', (e) => { if (e.target === m) UI.closeModal(m.id); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = $$('.modal.is-open');
      if (open.length) UI.closeModal(open[open.length - 1].id);
    });

    // Router, sesi, dan proteksi perubahan belum tersimpan
    window.addEventListener('hashchange', route);
    window.addEventListener('auth:expired', onAuthExpired);
    window.addEventListener('beforeunload', (e) => {
      if (needsLeaveConfirm()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  async function boot() {
    bindEvents();
    applyTheme(document.documentElement.classList.contains('dark'));
    UI.icons();

    if (!Api.isConfigured()) {
      booted = true;
      showLogin();
      showFormError('loginError', 'Aplikasi belum dikonfigurasi. Isi API_URL di js/config.js dengan URL Web App Apps Script.');
      return;
    }

    if (Api.getToken()) {
      try {
        const res = await Api.me();
        state.user = res.data;
        loadMasterQuietly();
      } catch (_) {
        clearSession();
      }
    }

    booted = true;
    route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();