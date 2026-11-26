/**
 * ============================================================
 * Code.gs — Backend Lengkap Sistem Manajemen Aset
 * ============================================================
 * Mencakup:
 * - Autentikasi & Sesi (login, logout, me, changePassword, createUser)
 * - Master Data (getMaster)
 * - CRUD Aset (listAssets, getAsset, createAsset, updateAsset, deleteAsset, restoreAsset)
 * - Upload Foto & Dokumen ke Google Drive (uploadFile, deleteDocument)
 * - Audit Log (listAuditLog)
 * - Stock Opname (listOpname, createOpname, getOpname, saveOpnameItem, finishOpname)
 *
 * Cara Pasang:
 * 1. Hapus semua kode di Code.gs pada Google Apps Script, lalu tempelkan seluruh file ini.
 *    (Jika ada file StockOpname.gs terpisah, hapus saja agar tidak duplikat).
 * 2. Klik Simpan (Ctrl+S).
 * 3. Klik Deploy > Manage deployments > Edit (ikon pensil) > Version: New version > Deploy.
 *    Pastikan "Execute as: Me" dan "Who has access: Anyone".
 * ============================================================
 */

// Isi DRIVE_FOLDER_ID dengan ID folder Google Drive Anda (lihat URL folder di browser: .../folders/ID_FOLDER_ANDA).
// Jika dikosongkan, sistem akan memakai/membuat folder bernama DRIVE_FOLDER_NAME.
var DRIVE_FOLDER_ID = '';
var DRIVE_FOLDER_NAME = 'Manajemen Aset Files';
var SESSION_TTL_HOURS = 12;

/* ==================== SETUP AWAL (JALANKAN SEKALI DI EDITOR) ==================== */

/**
 * Jalankan fungsi ini satu kali dari editor Apps Script (pilih setupInitialSheets > Run)
 * untuk membuat semua tab sheet beserta akun default (admin / admin123)
 * sekaligus memberikan izin akses Google Sheets & Google Drive.
 */
function setupInitialSheets() {
  usersSheet_();
  sessionsSheet_();
  masterSheet_();
  assetsSheet_();
  docsSheet_();
  auditSheet_();
  opnameSessionsSheet_();
  opnameItemsSheet_();
  getDriveFolder_();
  Logger.log('Semua sheet & folder Drive siap digunakan.');
}

/* ==================== HTTP ENTRYPOINT ==================== */

function doGet() {
  return jsonOk_({ status: 'ok', app: 'Sistem Manajemen Aset' }, 'Server aktif.');
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = String(body.action || '').trim();
    var token = String(body.token || '').trim();
    var payload = body.payload || {};

    if (!action) return jsonErr_('Aksi tidak ditemukan.', 'BAD_REQUEST');

    if (action === 'login') {
      return jsonOk_(handleLogin_(payload), 'Login berhasil.');
    }

    var user = requireAuth_(token);

    switch (action) {
      case 'logout':         return jsonOk_(handleLogout_(token), 'Berhasil keluar.');
      case 'me':             return jsonOk_(user);
      case 'changePassword': return jsonOk_(handleChangePassword_(user, payload), 'Password berhasil diubah.');
      case 'createUser':
        requireAdmin_(user);
        return jsonOk_(handleCreateUser_(user, payload), 'Pengguna berhasil ditambahkan.');

      case 'getMaster':      return jsonOk_(handleGetMaster_());

      case 'listAssets':     return jsonOk_(handleListAssets_(payload));
      case 'getAsset':       return jsonOk_(handleGetAsset_(payload));
      case 'createAsset':
        requireOperator_(user);
        return jsonOk_(handleCreateAsset_(user, payload), 'Aset berhasil ditambahkan.');
      case 'updateAsset':
        requireOperator_(user);
        return jsonOk_(handleUpdateAsset_(user, payload), 'Perubahan aset disimpan.');
      case 'deleteAsset':
        requireOperator_(user);
        return jsonOk_(handleDeleteAsset_(user, payload), 'Aset dihapus.');
      case 'restoreAsset':
        requireAdmin_(user);
        return jsonOk_(handleRestoreAsset_(user, payload), 'Aset dipulihkan.');

      case 'uploadFile':
        requireOperator_(user);
        return jsonOk_(handleUploadFile_(user, payload), 'Berkas berhasil diunggah.');
      case 'deleteDocument':
        requireOperator_(user);
        return jsonOk_(handleDeleteDocument_(user, payload), 'Dokumen dihapus.');

      case 'listAuditLog':
        requireAdmin_(user);
        return jsonOk_(handleListAuditLog_(payload));

      case 'listOpname':     return jsonOk_(handleListOpname_(user));
      case 'createOpname':
        requireOperator_(user);
        return jsonOk_(handleCreateOpname_(user, payload), 'Sesi Stock Opname dibuat.');
      case 'getOpname':      return jsonOk_(handleGetOpname_(user, payload));
      case 'saveOpnameItem':
        requireOperator_(user);
        return jsonOk_(handleSaveOpnameItem_(user, payload), 'Status opname disimpan.');
      case 'finishOpname':
        requireOperator_(user);
        return jsonOk_(handleFinishOpname_(user, payload), 'Stock Opname selesai.');

      default:
        return jsonErr_('Aksi "' + action + '" tidak dikenal.', 'NOT_FOUND');
    }
  } catch (err) {
    return jsonErr_(err.message || 'Terjadi kesalahan server.', err.code || 'ERROR');
  }
}

/* ==================== HELPER JSON & ERROR ==================== */

function jsonOk_(data, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, data: data, message: message || '' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr_(message, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: false, message: message, code: code || 'ERROR' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function appError_(message, code) {
  var err = new Error(message);
  err.code = code || 'ERROR';
  return err;
}

/* ==================== HELPER SHEET ==================== */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(name, headers, seedRows) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    if (seedRows && seedRows.length) {
      sh.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
    }
  }
  return sh;
}

function sheetToObjects_(sh) {
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var headers = vals[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var obj = {};
    var empty = true;
    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      var v = vals[i][j];
      if (v !== '' && v !== null && v !== undefined) empty = false;
      if (v instanceof Date) v = v.toISOString();
      obj[headers[j]] = v;
    }
    if (!empty) {
      obj._row = i + 1;
      out.push(obj);
    }
  }
  return out;
}

function appendObject_(sh, obj) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    var key = String(h).trim();
    return obj[key] !== undefined ? obj[key] : '';
  });
  sh.appendRow(row);
}

function updateRowByObject_(sh, rowIndex, obj) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    var key = String(h).trim();
    return obj[key] !== undefined ? obj[key] : '';
  });
  sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
}

function sha256_(text) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function verifyPassword_(input, stored) {
  var s = String(stored || '');
  if (!s) return false;
  if (s === input) return true;
  if (s.toLowerCase() === sha256_(input).toLowerCase()) return true;
  return false;
}

/* ==================== SHEETS DEFINITIONS ==================== */

function usersSheet_() {
  return getOrCreateSheet_(
    'Users',
    ['username', 'password', 'nama', 'role', 'aktif', 'created_at'],
    [['admin', sha256_('admin123'), 'Administrator', 'Admin', true, new Date().toISOString()]]
  );
}

function sessionsSheet_() {
  return getOrCreateSheet_('Sessions', ['token', 'username', 'nama', 'role', 'expires_at']);
}

function masterSheet_() {
  return getOrCreateSheet_(
    'Master',
    ['kategori', 'lokasi', 'kondisi', 'status'],
    [
      ['Elektronik', 'Kantor Pusat', 'Baik', 'Aktif'],
      ['Furniture', 'Gudang', 'Rusak Ringan', 'Dipinjam'],
      ['Kendaraan', 'Cabang', 'Rusak Berat', 'Maintenance'],
      ['Alat Kerja', '', '', 'Dihapusbukukan']
    ]
  );
}

function assetsSheet_() {
  var ss = ss_();
  var existing = ss.getSheetByName('Aset') || ss.getSheetByName('Assets');
  if (existing) return existing;
  return getOrCreateSheet_('Aset', [
    'kode_aset', 'nama_aset', 'kategori', 'merek', 'model', 'serial_number',
    'lokasi', 'penanggung_jawab', 'tanggal_perolehan', 'harga_perolehan',
    'garansi_sampai', 'kondisi', 'status', 'keterangan', 'foto_url',
    'is_deleted', 'created_at', 'created_by', 'updated_at', 'updated_by'
  ]);
}

function docsSheet_() {
  return getOrCreateSheet_('Dokumen', [
    'id', 'kode_aset', 'jenis', 'nama_dokumen', 'file_url', 'drive_id', 'uploaded_at', 'uploaded_by'
  ]);
}

function auditSheet_() {
  return getOrCreateSheet_('AuditLog', ['timestamp', 'user', 'aksi', 'kode_aset', 'detail']);
}

function opnameSessionsSheet_() {
  return getOrCreateSheet_('OpnameSessions', [
    'id', 'nama', 'lokasi', 'status', 'created_at', 'created_by', 'finished_at', 'total_target', 'total_checked'
  ]);
}

function opnameItemsSheet_() {
  return getOrCreateSheet_('OpnameItems', [
    'id', 'opname_id', 'kode_aset', 'nama_aset', 'lokasi_sistem', 'status_opname', 'catatan', 'checked_at', 'checked_by'
  ]);
}

function logAudit_(user, aksi, kodeAset, detail) {
  try {
    auditSheet_().appendRow([
      new Date().toISOString(),
      user ? (user.username || user.nama) : 'system',
      aksi,
      kodeAset || '',
      typeof detail === 'string' ? detail : JSON.stringify(detail || {})
    ]);
  } catch (_) {}
}

/* ==================== AUTH & USERS ==================== */

function handleLogin_(payload) {
  var username = String((payload && payload.username) || '').trim().toLowerCase();
  var password = String((payload && payload.password) || '');
  if (!username || !password) throw appError_('Username dan password wajib diisi.', 'BAD_REQUEST');

  var users = sheetToObjects_(usersSheet_());
  var u = users.filter(function (r) {
    return String(r.username || '').trim().toLowerCase() === username;
  })[0];

  if (!u) throw appError_('Username atau password salah.', 'AUTH_FAILED');
  if (u.aktif === false || String(u.aktif).toUpperCase() === 'FALSE') {
    throw appError_('Akun Anda sedang dinonaktifkan.', 'AUTH_FAILED');
  }

  var storedPass = u.password_hash || u.password || '';
  if (!verifyPassword_(password, storedPass)) {
    throw appError_('Username atau password salah.', 'AUTH_FAILED');
  }

  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var expires = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  sessionsSheet_().appendRow([token, u.username, u.nama || u.username, u.role || 'Viewer', expires]);

  var userObj = { username: u.username, nama: u.nama || u.username, role: u.role || 'Viewer' };
  logAudit_(userObj, 'LOGIN', '', 'Login berhasil');
  return { token: token, user: userObj };
}

function requireAuth_(token) {
  if (!token) throw appError_('Sesi tidak ditemukan. Silakan masuk.', 'UNAUTH');
  var sessions = sheetToObjects_(sessionsSheet_());
  var s = sessions.filter(function (r) { return r.token === token; })[0];
  if (!s) throw appError_('Sesi tidak valid atau sudah berakhir.', 'UNAUTH');
  if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) {
    throw appError_('Sesi sudah kedaluwarsa. Silakan masuk kembali.', 'UNAUTH');
  }
  return { username: s.username, nama: s.nama || s.username, role: s.role || 'Viewer' };
}

function requireOperator_(user) {
  if (user.role !== 'Admin' && user.role !== 'Operator') {
    throw appError_('Anda tidak memiliki izin untuk aksi ini.', 'FORBIDDEN');
  }
}

function requireAdmin_(user) {
  if (user.role !== 'Admin') {
    throw appError_('Hanya Admin yang dapat melakukan aksi ini.', 'FORBIDDEN');
  }
}

function handleLogout_(token) {
  var sh = sessionsSheet_();
  var sessions = sheetToObjects_(sh);
  for (var i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].token === token) sh.deleteRow(sessions[i]._row);
  }
  return true;
}

function handleChangePassword_(user, payload) {
  var oldPw = String((payload && payload.oldPassword) || '');
  var newPw = String((payload && payload.newPassword) || '');
  if (newPw.length < 6) throw appError_('Password baru minimal 6 karakter.', 'BAD_REQUEST');

  var sh = usersSheet_();
  var users = sheetToObjects_(sh);
  var u = users.filter(function (r) {
    return String(r.username).toLowerCase() === String(user.username).toLowerCase();
  })[0];
  if (!u) throw appError_('Pengguna tidak ditemukan.', 'NOT_FOUND');

  var storedPass = u.password_hash || u.password || '';
  if (!verifyPassword_(oldPw, storedPass)) {
    throw appError_('Password lama tidak sesuai.', 'BAD_REQUEST');
  }
  if (u.password_hash !== undefined) u.password_hash = sha256_(newPw);
  else u.password = sha256_(newPw);
  updateRowByObject_(sh, u._row, u);
  logAudit_(user, 'CHANGE_PASSWORD', '', 'Ubah password');
  return true;
}

function handleCreateUser_(user, payload) {
  var username = String((payload && payload.username) || '').trim().toLowerCase();
  var nama = String((payload && payload.nama) || '').trim();
  var role = String((payload && payload.role) || 'Operator').trim();
  var password = String((payload && payload.password) || '');
  if (!username || !nama || password.length < 6) {
    throw appError_('Lengkapi username, nama, dan password minimal 6 karakter.', 'BAD_REQUEST');
  }
  var sh = usersSheet_();
  var exists = sheetToObjects_(sh).some(function (r) {
    return String(r.username).toLowerCase() === username;
  });
  if (exists) throw appError_('Username sudah terdaftar.', 'CONFLICT');

  appendObject_(sh, {
    username: username,
    password: sha256_(password),
    password_hash: sha256_(password),
    nama: nama,
    role: role,
    aktif: true,
    created_at: new Date().toISOString()
  });
  logAudit_(user, 'CREATE_USER', '', 'Tambah user ' + username + ' (' + role + ')');
  return { username: username, nama: nama, role: role };
}

/* ==================== MASTER DATA ==================== */

function handleGetMaster_() {
  var rows = sheetToObjects_(masterSheet_());
  var uniq = function (key) {
    var seen = {};
    var res = [];
    rows.forEach(function (r) {
      var v = String(r[key] || '').trim();
      if (v && !seen[v]) { seen[v] = true; res.push(v); }
    });
    return res;
  };
  return {
    kategori: uniq('kategori'),
    lokasi: uniq('lokasi'),
    kondisi: uniq('kondisi'),
    status: uniq('status')
  };
}

/* ==================== CRUD ASET ==================== */

function handleListAssets_(params) {
  var p = params || {};
  var q = String(p.q || '').trim().toLowerCase();
  var kategori = String(p.kategori || '').trim();
  var lokasi = String(p.lokasi || '').trim();
  var kondisi = String(p.kondisi || '').trim();
  var status = String(p.status || '').trim();
  var includeDeleted = !!p.includeDeleted;
  var sortBy = String(p.sortBy || 'updated_at');
  var sortDir = String(p.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  var page = Math.max(1, Number(p.page || 1));
  var pageSize = Math.min(100, Math.max(1, Number(p.pageSize || 20)));

  var items = sheetToObjects_(assetsSheet_()).filter(function (a) {
    var del = (a.is_deleted === true || String(a.is_deleted).toUpperCase() === 'TRUE');
    if (!includeDeleted && del) return false;
    if (kategori && String(a.kategori || '') !== kategori) return false;
    if (lokasi && String(a.lokasi || '') !== lokasi) return false;
    if (kondisi && String(a.kondisi || '') !== kondisi) return false;
    if (status && String(a.status || '') !== status) return false;
    if (q) {
      var hay = [a.kode_aset, a.nama_aset, a.merek, a.model, a.serial_number, a.penanggung_jawab, a.lokasi, a.kategori]
        .join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  items.sort(function (a, b) {
    var va = a[sortBy] || '';
    var vb = b[sortBy] || '';
    if (sortBy === 'harga_perolehan') return (Number(va || 0) - Number(vb || 0)) * sortDir;
    return String(va).localeCompare(String(vb)) * sortDir;
  });

  var total = items.length;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) page = totalPages;
  var start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: totalPages
  };
}

function handleGetAsset_(payload) {
  var kode = String((payload && payload.kode_aset) || '').trim().toUpperCase();
  if (!kode) throw appError_('Kode aset wajib diisi.', 'BAD_REQUEST');

  var asset = sheetToObjects_(assetsSheet_()).filter(function (a) {
    return String(a.kode_aset || '').trim().toUpperCase() === kode;
  })[0];
  if (!asset) throw appError_('Aset "' + kode + '" tidak ditemukan.', 'NOT_FOUND');

  var docs = sheetToObjects_(docsSheet_()).filter(function (d) {
    return String(d.kode_aset || '').trim().toUpperCase() === kode;
  });
  return { asset: asset, documents: docs };
}

function handleCreateAsset_(user, payload) {
  var sh = assetsSheet_();
  var all = sheetToObjects_(sh);
  var kode = String((payload && payload.kode_aset) || '').trim().toUpperCase();

  if (!kode) {
    var year = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy');
    var maxNum = 0;
    all.forEach(function (a) {
      var m = String(a.kode_aset || '').match(new RegExp('^AST-' + year + '-(\\d+)$'));
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    });
    kode = 'AST-' + year + '-' + ('0000' + (maxNum + 1)).slice(-4);
  } else {
    var dup = all.some(function (a) { return String(a.kode_aset || '').toUpperCase() === kode; });
    if (dup) throw appError_('Kode aset "' + kode + '" sudah digunakan.', 'CONFLICT');
  }

  var now = new Date().toISOString();
  var rec = {
    kode_aset: kode,
    nama_aset: String(payload.nama_aset || '').trim(),
    kategori: String(payload.kategori || '').trim(),
    merek: String(payload.merek || '').trim(),
    model: String(payload.model || '').trim(),
    serial_number: String(payload.serial_number || '').trim(),
    lokasi: String(payload.lokasi || '').trim(),
    penanggung_jawab: String(payload.penanggung_jawab || '').trim(),
    tanggal_perolehan: String(payload.tanggal_perolehan || '').trim(),
    harga_perolehan: payload.harga_perolehan ? Number(payload.harga_perolehan) : '',
    garansi_sampai: String(payload.garansi_sampai || '').trim(),
    kondisi: String(payload.kondisi || '').trim(),
    status: String(payload.status || '').trim(),
    keterangan: String(payload.keterangan || '').trim(),
    foto_url: String(payload.foto_url || '').trim(),
    is_deleted: false,
    created_at: now,
    created_by: user.username,
    updated_at: now,
    updated_by: user.username
  };
  appendObject_(sh, rec);
  logAudit_(user, 'CREATE_ASSET', kode, 'Tambah aset: ' + rec.nama_aset);
  return rec;
}

function handleUpdateAsset_(user, payload) {
  var kode = String((payload && payload.kode_aset) || '').trim().toUpperCase();
  var sh = assetsSheet_();
  var existing = sheetToObjects_(sh).filter(function (a) {
    return String(a.kode_aset || '').toUpperCase() === kode;
  })[0];
  if (!existing) throw appError_('Aset tidak ditemukan.', 'NOT_FOUND');

  var fields = [
    'nama_aset', 'kategori', 'merek', 'model', 'serial_number',
    'lokasi', 'penanggung_jawab', 'tanggal_perolehan', 'harga_perolehan',
    'garansi_sampai', 'kondisi', 'status', 'keterangan'
  ];
  fields.forEach(function (f) {
    if (payload[f] !== undefined) {
      existing[f] = f === 'harga_perolehan'
        ? (payload[f] === '' ? '' : Number(payload[f]))
        : String(payload[f]).trim();
    }
  });
  existing.updated_at = new Date().toISOString();
  existing.updated_by = user.username;
  updateRowByObject_(sh, existing._row, existing);
  logAudit_(user, 'UPDATE_ASSET', kode, 'Perbarui aset: ' + existing.nama_aset);
  return existing;
}

function handleDeleteAsset_(user, payload) {
  var kode = String((payload && payload.kode_aset) || '').trim().toUpperCase();
  var sh = assetsSheet_();
  var existing = sheetToObjects_(sh).filter(function (a) {
    return String(a.kode_aset || '').toUpperCase() === kode;
  })[0];
  if (!existing) throw appError_('Aset tidak ditemukan.', 'NOT_FOUND');

  existing.is_deleted = true;
  existing.updated_at = new Date().toISOString();
  existing.updated_by = user.username;
  updateRowByObject_(sh, existing._row, existing);
  logAudit_(user, 'DELETE_ASSET', kode, 'Hapus aset');
  return true;
}

function handleRestoreAsset_(user, payload) {
  var kode = String((payload && payload.kode_aset) || '').trim().toUpperCase();
  var sh = assetsSheet_();
  var existing = sheetToObjects_(sh).filter(function (a) {
    return String(a.kode_aset || '').toUpperCase() === kode;
  })[0];
  if (!existing) throw appError_('Aset tidak ditemukan.', 'NOT_FOUND');

  existing.is_deleted = false;
  existing.updated_at = new Date().toISOString();
  existing.updated_by = user.username;
  updateRowByObject_(sh, existing._row, existing);
  logAudit_(user, 'RESTORE_ASSET', kode, 'Pulihkan aset');
  return true;
}

/* ==================== UPLOAD FOTO & DOKUMEN ==================== */

function getDriveFolder_() {
  if (DRIVE_FOLDER_ID && String(DRIVE_FOLDER_ID).trim()) {
    return DriveApp.getFolderById(String(DRIVE_FOLDER_ID).trim());
  }
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function handleUploadFile_(user, payload) {
  var kode = String((payload && payload.kode_aset) || '').trim().toUpperCase();
  var jenis = String((payload && payload.jenis) || 'Lainnya').trim();
  var namaDok = String((payload && payload.nama_dokumen) || jenis).trim();
  var mime = String((payload && payload.mimeType) || 'application/octet-stream');
  var fileName = String((payload && payload.fileName) || (kode + '_' + Date.now()));
  var b64 = String((payload && payload.base64) || '');
  if (!kode || !b64) throw appError_('Data berkas tidak lengkap.', 'BAD_REQUEST');

  var bytes = Utilities.base64Decode(b64);
  var blob = Utilities.newBlob(bytes, mime, kode + '_' + fileName);
  var file = getDriveFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var fileId = file.getId();
  var isImage = mime.indexOf('image/') === 0;
  var fileUrl = isImage
    ? 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200'
    : file.getUrl();

  var docId = 'DOC-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  var now = new Date().toISOString();
  var doc = {
    id: docId,
    kode_aset: kode,
    jenis: jenis,
    nama_dokumen: namaDok,
    file_url: fileUrl,
    drive_id: fileId,
    uploaded_at: now,
    uploaded_by: user.username
  };
  appendObject_(docsSheet_(), doc);

  if (jenis === 'Foto' && isImage) {
    var aSh = assetsSheet_();
    var asset = sheetToObjects_(aSh).filter(function (a) {
      return String(a.kode_aset || '').toUpperCase() === kode;
    })[0];
    if (asset) {
      asset.foto_url = fileUrl;
      asset.updated_at = now;
      asset.updated_by = user.username;
      updateRowByObject_(aSh, asset._row, asset);
    }
  }

  logAudit_(user, 'UPLOAD_FILE', kode, 'Unggah ' + jenis + ': ' + namaDok);
  return doc;
}

function handleDeleteDocument_(user, payload) {
  var id = String((payload && payload.id) || '').trim();
  var sh = docsSheet_();
  var doc = sheetToObjects_(sh).filter(function (d) { return d.id === id; })[0];
  if (!doc) throw appError_('Dokumen tidak ditemukan.', 'NOT_FOUND');

  if (doc.drive_id) {
    try { DriveApp.getFileById(doc.drive_id).setTrashed(true); } catch (_) {}
  }
  sh.deleteRow(doc._row);
  logAudit_(user, 'DELETE_DOCUMENT', doc.kode_aset, 'Hapus dokumen: ' + doc.nama_dokumen);
  return true;
}

/* ==================== AUDIT LOG ==================== */

function handleListAuditLog_(payload) {
  var p = payload || {};
  var kode = String(p.kode_aset || '').trim().toUpperCase();
  var limit = Math.min(200, Math.max(1, Number(p.limit || 100)));
  var rows = sheetToObjects_(auditSheet_());
  if (kode) {
    rows = rows.filter(function (r) { return String(r.kode_aset || '').toUpperCase() === kode; });
  }
  rows.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
  return rows.slice(0, limit);
}

/* ==================== STOCK OPNAME ==================== */

function handleListOpname_(user) {
  var sessions = sheetToObjects_(opnameSessionsSheet_());
  sessions.sort(function (a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  });
  return sessions;
}

function handleCreateOpname_(user, payload) {
  var nama = String((payload && payload.nama) || '').trim();
  if (!nama) throw appError_('Nama sesi opname wajib diisi.', 'BAD_REQUEST');
  var lokasi = String((payload && payload.lokasi) || '').trim();

  var allAssets = sheetToObjects_(assetsSheet_()).filter(function (a) {
    if (a.is_deleted === true || String(a.is_deleted).toUpperCase() === 'TRUE') return false;
    if (lokasi && String(a.lokasi || '').trim() !== lokasi) return false;
    return true;
  });

  var id = 'OPN-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmmss');
  var now = new Date().toISOString();
  opnameSessionsSheet_().appendRow([
    id, nama, lokasi, 'Berlangsung', now, user.username || user.nama, '', allAssets.length, 0
  ]);

  var iSheet = opnameItemsSheet_();
  if (allAssets.length > 0) {
    var rows = allAssets.map(function (a) {
      return [
        id + '_' + a.kode_aset,
        id,
        a.kode_aset,
        a.nama_aset || '',
        a.lokasi || '',
        'Belum Dicek',
        '',
        '',
        ''
      ];
    });
    iSheet.getRange(iSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  logAudit_(user, 'CREATE_OPNAME', '', 'Mulai Stock Opname: ' + nama);
  return {
    id: id,
    nama: nama,
    lokasi: lokasi,
    status: 'Berlangsung',
    created_at: now,
    created_by: user.username || user.nama,
    total_target: allAssets.length,
    total_checked: 0
  };
}

function handleGetOpname_(user, payload) {
  var id = String((payload && payload.id) || '').trim();
  var session = sheetToObjects_(opnameSessionsSheet_()).filter(function (s) { return s.id === id; })[0];
  if (!session) throw appError_('Sesi opname tidak ditemukan.', 'NOT_FOUND');

  var items = sheetToObjects_(opnameItemsSheet_()).filter(function (it) { return it.opname_id === id; });
  return { session: session, items: items };
}

function handleSaveOpnameItem_(user, payload) {
  var opnameId = String((payload && payload.opname_id) || '').trim();
  var kode = String((payload && payload.kode_aset) || '').trim().toUpperCase();
  var statusOpname = String((payload && payload.status_opname) || 'Sesuai').trim();
  var catatan = String((payload && payload.catatan) || '').trim();
  var now = new Date().toISOString();
  var checker = user.username || user.nama || '';

  var iSheet = opnameItemsSheet_();
  var items = sheetToObjects_(iSheet);
  var found = items.filter(function (it) {
    return it.opname_id === opnameId && String(it.kode_aset).toUpperCase() === kode;
  })[0];

  if (found) {
    iSheet.getRange(found._row, 6, 1, 4).setValues([[statusOpname, catatan, now, checker]]);
    found.status_opname = statusOpname;
    found.catatan = catatan;
    found.checked_at = now;
    found.checked_by = checker;
  } else {
    var asetMatch = sheetToObjects_(assetsSheet_()).filter(function (a) {
      return String(a.kode_aset).toUpperCase() === kode;
    })[0];
    var namaAset = asetMatch ? (asetMatch.nama_aset || '') : '(Aset tidak terdaftar)';
    var lokasiSistem = asetMatch ? (asetMatch.lokasi || '-') : '-';
    var rowId = opnameId + '_' + kode;
    iSheet.appendRow([rowId, opnameId, kode, namaAset, lokasiSistem, statusOpname, catatan, now, checker]);
    found = {
      id: rowId,
      opname_id: opnameId,
      kode_aset: kode,
      nama_aset: namaAset,
      lokasi_sistem: lokasiSistem,
      status_opname: statusOpname,
      catatan: catatan,
      checked_at: now,
      checked_by: checker
    };
  }

  var allForSession = sheetToObjects_(iSheet).filter(function (it) { return it.opname_id === opnameId; });
  var checkedCount = allForSession.filter(function (it) {
    return it.status_opname && it.status_opname !== 'Belum Dicek';
  }).length;
  var sSheet = opnameSessionsSheet_();
  var ses = sheetToObjects_(sSheet).filter(function (s) { return s.id === opnameId; })[0];
  if (ses) {
    sSheet.getRange(ses._row, 8, 1, 2).setValues([[allForSession.length, checkedCount]]);
  }
  return found;
}

function handleFinishOpname_(user, payload) {
  var id = String((payload && payload.id) || '').trim();
  var sSheet = opnameSessionsSheet_();
  var ses = sheetToObjects_(sSheet).filter(function (s) { return s.id === id; })[0];
  if (!ses) throw appError_('Sesi opname tidak ditemukan.', 'NOT_FOUND');

  var now = new Date().toISOString();
  sSheet.getRange(ses._row, 4).setValue('Selesai');
  sSheet.getRange(ses._row, 7).setValue(now);
  ses.status = 'Selesai';
  ses.finished_at = now;
  logAudit_(user, 'FINISH_OPNAME', '', 'Selesaikan Stock Opname: ' + ses.nama);
  return ses;
}
