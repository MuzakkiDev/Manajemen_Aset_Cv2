/**
 * ============================================================
 * Tambahan Google Apps Script untuk Fitur Stock Opname
 * ============================================================
 * Cara pasang:
 * 1. Buka Google Apps Script project Anda (yang terhubung ke Google Sheets).
 * 2. Tambahkan file skrip baru (File > New > Script file) bernama `StockOpname.gs`
 *    dan tempelkan seluruh kode di bawah ini.
 * 3. Di fungsi `doPost(e)` utama Anda, tambahkan case berikut pada switch(action):
 *      case 'listOpname':     return jsonOk(handleListOpname_(user));
 *      case 'createOpname':   return jsonOk(handleCreateOpname_(user, payload));
 *      case 'getOpname':      return jsonOk(handleGetOpname_(user, payload));
 *      case 'saveOpnameItem': return jsonOk(handleSaveOpnameItem_(user, payload));
 *      case 'finishOpname':   return jsonOk(handleFinishOpname_(user, payload));
 * 4. Klik Deploy > Manage deployments > Edit (ikon pensil) > Version: New version > Deploy.
 * ============================================================
 */

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
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

function sheetToObjects_(sh) {
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var headers = vals[0];
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = vals[i][j];
    }
    obj._row = i + 1;
    out.push(obj);
  }
  return out;
}

function handleListOpname_(user) {
  var sessions = sheetToObjects_(opnameSessionsSheet_());
  sessions.sort(function (a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  });
  return sessions;
}

function handleCreateOpname_(user, payload) {
  var nama = String((payload && payload.nama) || '').trim();
  if (!nama) throw new Error('Nama sesi opname wajib diisi.');
  var lokasi = String((payload && payload.lokasi) || '').trim();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Ambil daftar aset aktif dari sheet 'Aset' (sesuaikan nama sheet jika berbeda)
  var asetSheet = ss.getSheetByName('Aset') || ss.getSheetByName('Assets');
  if (!asetSheet) throw new Error('Sheet "Aset" tidak ditemukan.');
  var allAssets = sheetToObjects_(asetSheet).filter(function (a) {
    if (a.is_deleted === true || String(a.is_deleted).toUpperCase() === 'TRUE') return false;
    if (lokasi && String(a.lokasi || '').trim() !== lokasi) return false;
    return true;
  });

  var id = 'OPN-' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd-HHmmss');
  var now = new Date().toISOString();
  var sSheet = opnameSessionsSheet_();
  sSheet.appendRow([id, nama, lokasi, 'Berlangsung', now, user.username || user.nama, '', allAssets.length, 0]);

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
  var sessions = sheetToObjects_(opnameSessionsSheet_());
  var session = sessions.filter(function (s) { return s.id === id; })[0];
  if (!session) throw new Error('Sesi opname tidak ditemukan.');

  var items = sheetToObjects_(opnameItemsSheet_()).filter(function (it) {
    return it.opname_id === id;
  });
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
    // Temuan baru / salah lokasi: cek nama aset dari sheet Aset jika ada
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var asetSheet = ss.getSheetByName('Aset') || ss.getSheetByName('Assets');
    var asetMatch = asetSheet ? sheetToObjects_(asetSheet).filter(function (a) {
      return String(a.kode_aset).toUpperCase() === kode;
    })[0] : null;
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

  // Update counter total_checked di OpnameSessions
  var allForSession = sheetToObjects_(iSheet).filter(function (it) { return it.opname_id === opnameId; });
  var checkedCount = allForSession.filter(function (it) {
    return it.status_opname && it.status_opname !== 'Belum Dicek';
  }).length;
  var sSheet = opnameSessionsSheet_();
  var sessions = sheetToObjects_(sSheet);
  var ses = sessions.filter(function (s) { return s.id === opnameId; })[0];
  if (ses) {
    sSheet.getRange(ses._row, 8, 1, 2).setValues([[allForSession.length, checkedCount]]);
  }

  return found;
}

function handleFinishOpname_(user, payload) {
  var id = String((payload && payload.id) || '').trim();
  var sSheet = opnameSessionsSheet_();
  var sessions = sheetToObjects_(sSheet);
  var ses = sessions.filter(function (s) { return s.id === id; })[0];
  if (!ses) throw new Error('Sesi opname tidak ditemukan.');

  var now = new Date().toISOString();
  sSheet.getRange(ses._row, 4).setValue('Selesai');
  sSheet.getRange(ses._row, 7).setValue(now);
  ses.status = 'Selesai';
  ses.finished_at = now;
  return ses;
}
