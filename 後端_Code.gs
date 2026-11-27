/**
 * 工程契約與驗收管理 — 後端（Google Apps Script）20261127m-lts
 *
 * 綁定在一個 Google 試算表上（工作表格式與 m 版相同，可直接沿用原試算表）：
 *   工作表「工程」     ：每列一個工程（id、簡稱、更新時間、更新者、JSON）
 *   工作表「設定」     ：學校固定設定（JSON）、已刪除工程清單
 *   工作表「範本版本」 ：上傳過的契約範本（檔案存在雲端硬碟資料夾）
 *   工作表「期限」     ：各工程未完成事項的期限（週報與共用日曆用，由網站暫存時更新）
 *   工作表「同仁」     ：共用名單（共用日曆、工程文件資料夾、每週摘要信）
 *   工作表「修改紀錄」 ：誰在什麼時候改了哪個欄位
 *
 * 部署：部署 → 新增部署作業 → 類型「網頁應用程式」
 *       執行身分：我　／　誰可以存取：所有人
 * 共用日曆：編輯器左側「服務」加入 Google Calendar API（識別碼 Calendar）。
 * 改版後：選 setup 按「執行」一次完成授權，再「管理部署作業」部署新版本（網址不變）。
 *
 * 安全原則（LTS）：
 *   - 只接受 POST；存取碼放在 JSON 內容，不放網址（doGet 一律拒絕）
 *   - 單一存取碼 ACCESS_CODE，長度至少 12 字元；15 分鐘內錯 30 次暫停猜碼，但正確碼不受影響
 *   - 寫入試算表的文字以 safeText_ 防公式注入；工程編號以 ID_RE 檢查（防原型污染）
 */

var VERSION = '20261127m-lts';
var SHEET_PROJECTS = '工程';
var SHEET_SETTINGS = '設定';
var SHEET_TEMPLATES = '範本版本';
var SHEET_DEADLINES = '期限';
var SHEET_PEOPLE = '同仁';
var SHEET_LOG = '修改紀錄';
var FOLDER_NAME = '技術服務契約產生器_範本檔';
var STAGE_DIRS = ['1 技術服務', '2 施工', '3 報竣', '4 竣工文件審查', '5 初驗與驗收', '6 驗收合格與結算', '7 付款與決算', '8 保固'];
var ID_RE = /^(?!(?:__proto__|constructor|prototype|toString|valueOf|hasOwnProperty)$)[A-Za-z0-9_-]{1,40}$/;
var CODE_MIN = 12;
var CAL_HINT = '尚未啟用 Google Calendar API：請在 Apps Script 編輯器左側「服務」按＋，加入 Google Calendar API，' +
  '執行一次 setup 完成授權，再到「部署 → 管理部署作業」部署新版本。';

/** 第一次使用、或更新程式後：在編輯器選這個函式按「執行」，並依提示授權。 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEET_PROJECTS, ['id', '工程簡稱', '更新時間', '更新者', 'data']);
  ensureSheet_(ss, SHEET_SETTINGS, ['key', 'value', '更新時間']);
  ensureSheet_(ss, SHEET_TEMPLATES, ['id', '版本', '上傳時間', '上傳者', '使用中', 'tpl檔', 'points檔', 'regions檔', 'report檔']);
  deadlineSheet_();
  peopleSheet_();
  logSheet_();
  var props = PropertiesService.getScriptProperties();
  var code = props.getProperty('ACCESS_CODE') || '', renewed = code.length < CODE_MIN;
  if (renewed) props.setProperty('ACCESS_CODE', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  folder_();
  // 觸發寄信、排程、日曆的授權（沒有加入日曆服務時略過）
  MailApp.getRemainingDailyQuota();
  ScriptApp.getProjectTriggers();
  if (calOn_()) Calendar.CalendarList.list({ maxResults: 1 });
  Logger.log('完成（' + VERSION + '）。' + (renewed ? '原存取碼不存在或少於 ' + CODE_MIN + ' 字元，已換成新的；' : '') +
    '存取碼請到「專案設定 → 指令碼屬性」查看 ACCESS_CODE。' +
    (calOn_() ? '' : '\n共用日曆尚未啟用：' + CAL_HINT));
}
function setupCalendar() { setup(); }

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
  // 全部以純文字儲存，避免時間字串被自動轉成日期
  sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@');
  return sh;
}

function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== 存取碼與安全小工具 ===================== */

// 存取碼錯誤 30 次（15 分鐘內）就暫停猜碼 15 分鐘；正確的存取碼不受這個暫停影響
var BAD_LIMIT = 30, BAD_TTL = 900;
function checkCode_(code) {
  var want = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') || '';
  if (want.length < CODE_MIN) throw new Error('後端存取碼未設定或少於 ' + CODE_MIN + ' 字元：請在指令碼屬性修改 ACCESS_CODE');
  var c = String(code || '');
  if (!c) return false;
  if (c === want) return true;
  var cache = CacheService.getScriptCache();
  var bad = Number(cache.get('badCode') || 0);
  if (bad < BAD_LIMIT) cache.put('badCode', String(bad + 1), BAD_TTL);
  return false;
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('找不到工作表「' + name + '」，請先執行 setup()');
  return sh;
}

function rows_(sh) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
}

function appendRows_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function msg_(e) { return String(e && e.message || e); }

/** 開頭（含前導空白、控制字元）是 = + - @ 的文字前加單引號，避免試算表當成公式 */
function safeText_(v) {
  v = String(v == null ? '' : v);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(v) ? "'" + v : v;
}

/** 只允許 http(s) 網址（附件、資料夾連結） */
function httpUrl_(u) {
  u = String(u || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : '';
}

/* ===================== 進入點 ===================== */

/** 不接受網址帶存取碼的 GET：一律請用 POST */
function doGet(e) {
  return out_({ ok: false, error: '請使用 POST；網址不可附存取碼' });
}

var READ = { load: 1, stamp: 1, history: 1, tplfile: 1, ping: 1, shareInfo: 1 };
// 較慢的動作（日曆、雲端硬碟、寄信）等久一點，不擋住其他人暫存
var SLOW = { sync: 1, upload: 1, folder: 1, person: 1, calCreate: 1, docsCreate: 1, digestTest: 1 };

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: '格式錯誤' }); }
  if (!body || typeof body !== 'object') return out_({ ok: false, error: '格式錯誤' });
  try {
    if (!checkCode_(body.code)) return out_({ ok: false, error: 'code' });
  } catch (err) {
    return out_({ ok: false, error: msg_(err) });
  }
  // 只讀的動作不必排隊
  if (READ[body.action]) {
    try { return out_(readAction_(body)); } catch (err) { return out_({ ok: false, error: msg_(err) }); }
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(SLOW[body.action] ? 30000 : 20000)) return out_({ ok: false, error: '系統忙碌，請稍後再按一次' });
  try {
    return out_(writeAction_(body));
  } catch (err) {
    return out_({ ok: false, error: msg_(err) });
  } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

function readAction_(b) {
  switch (b.action) {
    case 'ping': return { ok: true, ping: 'pong', version: VERSION, now: new Date().toISOString() };
    case 'load': return load_(b.part ? String(b.ids || '').split(',').filter(String) : null, b.school !== '0');
    case 'stamp': return versions_();
    case 'history': return history_(b.id, b.key);
    case 'shareInfo': return shareInfo_();
    case 'tplfile': {
      var t = findTemplate_(b.id), col = { tpl: 5, points: 6, regions: 7, report: 8 }[b.part];
      if (!t || col === undefined) throw new Error('找不到範本或部分');
      return JSON.parse(DriveApp.getFileById(t.row[col]).getBlob().getDataAsString('UTF-8'));
    }
  }
  throw new Error('未知的動作');
}

function writeAction_(b) {
  switch (b.action) {
    case 'saveProjects': return saveProjects_(b.projects || [], b.who);
    case 'deleteProject': return deleteProject_(b.id, b.who, b.base);
    case 'saveSchool': return saveSchool_(b.school, b.who, b.base);
    case 'addTemplate': return addTemplate_(b, b.who);
    case 'activateTemplate': return activateTemplate_(b.id, !!b.reviewed);
    case 'sync': return sync_(b.items || {}, !!b.full, b.ver, b.schoolAt, b.who);
    case 'siteSet': return siteSet_(b.site);
    case 'person': return person_(b, b.who);
    case 'calCreate': return calCreate_(b.name);
    case 'docsCreate': return docsCreate_(b.name);
    case 'digestSet': return digestSet_(!!b.on);
    case 'digestTest': return sendDigest_(true);
    case 'folder': return projectFolder_(b.pid, b.pname, true);
    case 'upload': return upload_(b, b.who);
  }
  return { ok: false, error: '未知的動作' };
}

/* ===================== 工程資料 ===================== */

/** ids＝null：全部工程；ids＝陣列：只回傳這幾個工程（前端比對版本後只拿有變動的） */
function load_(ids, withSchool) {
  var projects = [], corrupt = [], sh = sheet_(SHEET_PROJECTS), list;
  if (ids) {
    var want = {};
    ids.forEach(function (x) { want[String(x)] = true; });
    var n = sh.getLastRow(), col = n < 2 ? [] : sh.getRange(2, 1, n - 1, 1).getValues();
    var at = [];
    col.forEach(function (r, i) { if (want[String(r[0])]) at.push(i + 2); });
    // 少量用逐列讀取，多的話整張讀一次比較快
    list = at.length > 12 ? rows_(sh).filter(function (r) { return want[String(r[0])]; })
      : at.map(function (row) { return sh.getRange(row, 1, 1, 5).getValues()[0]; });
  } else list = rows_(sh);
  list.forEach(function (r) {
    if (!r[0]) return;
    var d;
    try { d = JSON.parse(r[4]); } catch (e) { d = null; }
    // 資料損毀的列不送給前端，避免前端用空白工程把它蓋掉
    if (!d || typeof d !== 'object') {
      corrupt.push({ id: String(r[0]), name: String(r[1] || ''), updatedAt: stamp_(r[2]) });
      return;
    }
    d.id = String(r[0]); d.updatedAt = stamp_(r[2]); d.updatedBy = String(r[3] || '');
    projects.push(d);
  });
  var meta = meta_();
  var out = { ok: true, projects: projects, corrupt: corrupt, schoolUpdatedAt: meta.schoolAt, templates: meta.templates,
    deleted: meta.deleted, now: new Date().toISOString() };
  if (!ids || withSchool) out.school = meta.school;
  if (ids) out.part = true;
  return out;
}

/** 設定、範本清單：工作表很小，一次讀完 */
function meta_() {
  var school = null, schoolAt = '', deleted = [];
  rows_(sheet_(SHEET_SETTINGS)).forEach(function (r) {
    if (r[0] === 'school') { try { school = JSON.parse(r[1]); } catch (e) {} schoolAt = stamp_(r[2]); }
    if (r[0] === 'deleted') { try { deleted = Object.keys(JSON.parse(r[1]) || {}); } catch (e) {} }
  });
  var tsh = sheet_(SHEET_TEMPLATES), tn = tsh.getLastRow();
  var templates = (tn < 2 ? [] : tsh.getRange(2, 1, tn - 1, 5).getValues()).filter(function (r) { return r[0]; })
    .map(function (r) {
      return { id: String(r[0]), version: String(r[1]), uploadedAt: stamp_(r[2]), uploadedBy: String(r[3] || ''),
        active: r[4] === true || r[4] === 'TRUE' };
    });
  return { school: school, schoolAt: schoolAt, templates: templates, deleted: deleted };
}

/** 版本清單：只讀編號與更新時間欄，不讀工程內容；前端用來判斷要不要重新下載 */
function versions_() {
  var sh = sheet_(SHEET_PROJECTS), n = sh.getLastRow();
  var rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, 3).getValues();
  var meta = meta_();
  return {
    ok: true,
    projects: rows.filter(function (r) { return r[0]; }).map(function (r) { return [String(r[0]), stamp_(r[2])]; }),
    schoolUpdatedAt: meta.schoolAt, templates: meta.templates, deleted: meta.deleted, now: new Date().toISOString()
  };
}

/** 已刪除的工程：{ id: { at, who } }，防止舊頁面把已刪除的工程存回來 */
function deleted_() {
  var data = rows_(sheet_(SHEET_SETTINGS));
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === 'deleted') { try { return JSON.parse(data[i][1]) || {}; } catch (e) { return {}; } }
  }
  return {};
}
function setDeleted_(map) {
  var sh = sheet_(SHEET_SETTINGS), data = rows_(sh), json = JSON.stringify(map), now = new Date().toISOString();
  for (var i = 0; i < data.length; i++) if (data[i][0] === 'deleted') { sh.getRange(i + 2, 2, 1, 2).setValues([[json, now]]); return; }
  sh.appendRow(['deleted', json, now]);
}

/**
 * 暫存工程：每個工程都要帶上「我開始修改時的版本」baseUpdatedAt。
 * 雲端版本與 base 不同 → 回傳衝突（含雲端版本內容），由前端讓使用者二選一；
 * 使用者選「以我的版本覆蓋」時，前端會把 base 對準剛看到的那個衝突版本再送一次。
 */
function saveProjects_(list, who) {
  if (!Array.isArray(list)) throw new Error('工程資料格式錯誤');
  var sh = sheet_(SHEET_PROJECTS), n = sh.getLastRow();
  // 只讀編號、名稱、更新時間、更新者四欄，不讀所有工程的內容
  var data = n < 2 ? [] : sh.getRange(2, 1, n - 1, 4).getValues(), index = {}, stampOf = {}, gone = deleted_();
  data.forEach(function (r, i) {
    if (r[0]) { index[String(r[0])] = i + 2; stampOf[String(r[0])] = [stamp_(r[2]), String(r[3] || '')]; }
  });
  var now = new Date().toISOString(), saved = [], conflicts = [], rejected = [], logs = [];
  list.forEach(function (p) {
    try {
      if (!p || typeof p !== 'object' || !ID_RE.test(String(p.id || ''))) throw new Error('工程編號錯誤');
      var row = index[p.id], base = p.baseUpdatedAt ? String(p.baseUpdatedAt) : '';
      // 已被刪除、或原本有版本但工作表已沒有這列：不要存回來，交給前端另存成新工程
      if (!row && (gone[p.id] || base)) {
        var g = gone[p.id] || {};
        conflicts.push({ id: p.id, deleted: true, deletedAt: String(g.at || ''), deletedBy: String(g.who || '') });
        return;
      }
      if (row && stampOf[p.id][0] !== base) {
        var server = {};
        try { server = JSON.parse(sh.getRange(row, 5).getValue()); } catch (e) {}
        server.id = p.id; server.updatedAt = stampOf[p.id][0]; server.updatedBy = stampOf[p.id][1];
        conflicts.push(server);
        return;
      }
      var copy = JSON.parse(JSON.stringify(p));
      var changes = Array.isArray(copy.changes) ? copy.changes : [];
      ['force', 'forceAgainst', 'baseUpdatedAt', 'updatedAt', 'updatedBy', 'changes'].forEach(function (k) { delete copy[k]; });
      var json = JSON.stringify(copy);
      if (json.length > 45000) throw new Error('工程「' + (p.name || p.id) + '」資料過大');
      var name = safeText_(p.name || p.title || ''), by = safeText_(who || '');
      // 版本戳記一定要和原本不同（同一毫秒內連續暫存時往後推 1 毫秒），否則舊頁面可能誤以為版本相同
      var at = row && stampOf[p.id][0] >= now ? new Date(Date.parse(stampOf[p.id][0]) + 1).toISOString() : now;
      var values = [[p.id, name, at, by, json]];
      if (!row) logs.push([now, p.id, name, by, '新增工程', '', '']);
      changes.slice(0, 200).forEach(function (c) {
        if (!c || !c[0]) return;
        logs.push([now, p.id, name, by, safeText_(String(c[0]).slice(0, 200)),
          safeText_(String(c[1] == null ? '' : c[1]).slice(0, 500)), safeText_(String(c[2] == null ? '' : c[2]).slice(0, 500))]);
      });
      if (row) sh.getRange(row, 1, 1, 5).setValues(values);
      else { sh.appendRow(values[0]); index[p.id] = sh.getLastRow(); }
      saved.push({ id: p.id, updatedAt: at });
    } catch (e) {
      rejected.push({ id: String(p && p.id || ''), error: msg_(e) });
    }
  });
  var logError = '';
  try { if (logs.length) appendRows_(logSheet_(), logs); } catch (e) { logError = msg_(e); }
  return { ok: true, saved: saved, conflicts: conflicts, rejected: rejected, logError: logError };
}

function deleteProject_(id, who, base) {
  if (!ID_RE.test(String(id || ''))) return { ok: false, error: '工程編號錯誤' };
  if (!base) return { ok: false, error: '缺少工程版本' };
  var sh = sheet_(SHEET_PROJECTS), n = sh.getLastRow(), data = n < 2 ? [] : sh.getRange(2, 1, n - 1, 4).getValues(), name = '';
  for (var k = 0; k < data.length; k++) {
    if (String(data[k][0]) === String(id) && stamp_(data[k][2]) !== String(base)) {
      return { ok: false, error: 'changed', updatedBy: String(data[k][3] || '') };
    }
  }
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === String(id)) { name = String(data[i][1] || ''); sh.deleteRow(i + 2); }
  }
  var gone = deleted_();
  gone[id] = { at: new Date().toISOString(), who: String(who || '') };
  setDeleted_(gone);
  // 週報不再列出這個工程（日曆活動由網站接著同步移除）
  var dl = deadlineSheet_(), rows = rows_(dl);
  for (var j = 0; j < rows.length; j++) if (String(rows[j][0]) === String(id)) dl.getRange(j + 2, 3).setValue('[]');
  if (name) appendRows_(logSheet_(), [[new Date().toISOString(), String(id), name, safeText_(who || ''), '刪除工程', '', '']]);
  return { ok: true };
}

/** 試算表若把時間字串轉成日期，統一換回 ISO 字串比對 */
function stamp_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }

function saveSchool_(school, who, base) {
  if (!school || typeof school !== 'object' || Array.isArray(school)) return { ok: false, error: '設定格式錯誤' };
  var sh = sheet_(SHEET_SETTINGS), data = rows_(sh), now = new Date().toISOString();
  var json = JSON.stringify(school);
  if (json.length > 45000) return { ok: false, error: '學校設定資料過大' };
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] !== 'school') continue;
    var cur = stamp_(data[i][2]);
    if (base !== undefined && String(base || '') !== cur) {
      var server = {};
      try { server = JSON.parse(data[i][1]); } catch (e) {}
      return { ok: true, conflict: true, school: server, updatedAt: cur };
    }
    sh.getRange(i + 2, 2, 1, 2).setValues([[json, now]]);
    return { ok: true, updatedAt: now };
  }
  sh.appendRow(['school', json, now]);
  return { ok: true, updatedAt: now };
}

function schoolName_() {
  try {
    var data = rows_(sheet_(SHEET_SETTINGS));
    for (var i = 0; i < data.length; i++) if (data[i][0] === 'school') return String(JSON.parse(data[i][1]).party || '').trim();
  } catch (e) {}
  return '';
}

/* ===================== 範本版本 ===================== */

/**
 * 範本基礎檢查（不鎖死填寫點清單）：
 *   - tpl／points／regions 都是正確 JSON，大小合理
 *   - 每個檔名不含「..」、不以 / 開頭、不重複；必須有 Word 的基本檔案
 *   - document.xml 可解析；文件中的 ⟦F001⟧ 記號都要在 points 裡（沒有孤兒記號）
 * 回傳錯誤訊息；空字串代表通過。
 */
function templateCheck_(b) {
  try {
    if (String(b.tpl || '').length > 8000000 || String(b.points || '').length > 2000000) return '範本檔過大';
    var t = JSON.parse(b.tpl), p = JSON.parse(b.points), r = JSON.parse(b.regions || '{}');
    if (!Array.isArray(t) || !Array.isArray(p) || !p.length || !r || typeof r !== 'object' || Array.isArray(r)) return '範本資料格式錯誤';
    var ids = {}, names = {}, doc = '';
    for (var i = 0; i < p.length; i++) {
      if (!p[i] || !/^[FN]\d{3,6}$/.test(String(p[i].id || '')) || ids[p[i].id]) return '填寫點編號錯誤或重複';
      ids[p[i].id] = true;
    }
    for (var k = 0; k < t.length; k++) {
      var a = t[k], nm = a && String(a.name || '');
      if (!nm || nm.indexOf('..') >= 0 || nm.charAt(0) === '/' || nm.indexOf('\\') >= 0 || names[nm]) return '範本內含不合法的檔名';
      names[nm] = true;
      if (nm === 'word/document.xml') doc = String(a.text || '');
    }
    if (!doc || !names['[Content_Types].xml'] || !names['_rels/.rels']) return '範本缺少 Word 基本檔案';
    var marks = doc.match(/⟦[FN]\d{3,6}⟧/g) || [];
    for (var m = 0; m < marks.length; m++) if (!ids[marks[m].slice(1, -1)]) return '範本內有對不上的填寫點記號 ' + marks[m];
    XmlService.parse(doc);
    return '';
  } catch (e) {
    return '範本結構無法解析：' + msg_(e);
  }
}

/** 上傳的範本先存成「待核對」；只有比對結果全部核對過（left＝0、沒有對不上的）才允許直接啟用 */
function addTemplate_(b, who) {
  var bad = templateCheck_(b);
  if (bad) return { ok: false, error: bad };
  var rv = {};
  try { rv = JSON.parse(b.review || '{}') || {}; } catch (e) {}
  var status = rv.block ? 'blocked' : 'pending';
  if (b.activate && (rv.block || Number(rv.left) > 0)) return { ok: false, error: '這個範本還有未核對或對不上的填寫點，不能直接啟用' };
  var f = folder_(), id = 't' + new Date().getTime(), ver = safeText_(String(b.version || '').slice(0, 40));
  var mk = function (suffix, text) {
    return f.createFile(Utilities.newBlob(text, 'application/json', id + '_' + suffix + '.json')).getId();
  };
  var row = [id, ver, new Date().toISOString(), safeText_(who || ''), false,
    mk('tpl', b.tpl), mk('points', b.points), mk('regions', b.regions || '{}'), mk('report', b.report || '{}'),
    JSON.stringify({ status: status, left: Number(rv.left) || 0 })];
  sheet_(SHEET_TEMPLATES).appendRow(row);
  if (b.activate) {
    var act = activateTemplate_(id, true);
    if (!act.ok) return act;
  }
  return { ok: true, id: id, status: b.activate ? 'ok' : status };
}

function activateTemplate_(id, reviewed) {
  var sh = sheet_(SHEET_TEMPLATES), data = rows_(sh), found = (id === 'builtin');
  for (var k = 0; k < data.length; k++) {
    if (String(data[k][0]) !== String(id)) continue;
    found = true;
    var rv = {};
    try { rv = JSON.parse(data[k][9] || '{}') || {}; } catch (e) {}
    if (rv.status === 'blocked') return { ok: false, error: '這個範本有對不上的填寫點或附件，不能啟用' };
    if (rv.status !== 'ok' && !reviewed) return { ok: false, error: 'review' };
    if (rv.status !== 'ok') {
      sh.getRange(k + 2, 10).setValue(JSON.stringify({ status: 'ok', left: 0, reviewedAt: new Date().toISOString() }));
    }
  }
  if (!found) return { ok: false, error: '找不到範本版本' };
  data.forEach(function (r, i) {
    var on = String(r[0]) === String(id);
    if (on && /（待審）/.test(String(r[1]))) sh.getRange(i + 2, 2).setValue(String(r[1]).replace('（待審）', ''));
    sh.getRange(i + 2, 5).setValue(on);
  });
  return { ok: true };
}

function findTemplate_(id) {
  var data = rows_(sheet_(SHEET_TEMPLATES));
  for (var i = 0; i < data.length; i++) if (String(data[i][0]) === String(id)) return { row: data[i], index: i };
  return null;
}

/* ===================== 修改紀錄 ===================== */

function logSheet_() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SHEET_LOG) || ensureSheet_(ss, SHEET_LOG, ['時間', '工程id', '工程名稱', '修改者', '項目', '原值', '新值']);
}

/** key：只取某一份表件的流向紀錄（修改紀錄的項目欄含「［key］」） */
function history_(id, key) {
  var sh = logSheet_(), n = sh.getLastRow(), out = [], tag = key ? '［' + String(key) + '］' : '';
  if (n < 2) return { ok: true, rows: out };
  var data = sh.getRange(2, 1, n - 1, 7).getValues();
  for (var i = data.length - 1; i >= 0 && out.length < (tag ? 1000 : 300); i--) {
    var r = data[i];
    if (id && String(r[1]) !== String(id)) continue;
    if (tag && String(r[4]).indexOf(tag) < 0) continue;
    out.push({ at: stamp_(r[0]), id: String(r[1]), name: String(r[2]), who: String(r[3]), what: String(r[4]),
      from: String(r[5]), to: String(r[6]) });
  }
  return { ok: true, rows: out };
}

/* ===================== 期限同步（週報、共用日曆） ===================== */

function deadlineSheet_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(SHEET_DEADLINES);
  if (sh) return sh;
  sh = ensureSheet_(ss, SHEET_DEADLINES, ['工程id', '工程名稱', '期限', '日曆對照', '更新時間']);
  var old = ss.getSheetByName('日曆同步'); // 前一版的日曆對照，搬過來避免重複建立活動
  if (old) rows_(old).forEach(function (r) { if (r[0]) sh.appendRow([String(r[0]), '', '[]', String(r[1] || '{}'), String(r[2] || '')]); });
  return sh;
}

/** 日曆說明欄：移除外部網址，最後附上學校設定的網站連結（SITE_URL） */
function cleanDesc_(desc, pid) {
  var site = siteUrl_();
  var d = String(desc || '').replace(/https?:\/\/[^\s]+/gi, '').replace(/^開啟網站：\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return d + (site ? '\n開啟網站：' + site + '#p=' + encodeURIComponent(pid) : '');
}

/**
 * items：{ 工程id: { name, at（已暫存的版本）, list: [{ key, date:'yyyy-MM-dd', title, short, who, desc, hold }] } }
 * 工程最後一筆待辦完成時 list 會是空陣列：照常清除舊期限與日曆活動（不攔截）。
 */
function sync_(items, full, ver, schoolAt, who) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return { ok: false, error: '期限資料格式錯誤' };
  var props = PropertiesService.getScriptProperties();
  // 期限是用學校設定（假日、天數）算的：前端用的學校設定不是最新的就略過，避免舊裝置把日曆改回舊期限
  var cur = '';
  rows_(sheet_(SHEET_SETTINGS)).forEach(function (r) { if (r[0] === 'school') cur = stamp_(r[2]); });
  if (String(schoolAt || '') !== cur) return { ok: true, skipped: 'school', updated: 0 };
  var sh = deadlineSheet_(), dn = sh.getLastRow(), index = {}, now = new Date().toISOString();
  (dn < 2 ? [] : sh.getRange(2, 1, dn - 1, 1).getValues()).forEach(function (r, i) { if (r[0]) index[String(r[0])] = i + 2; });
  var proj = {}, gone = deleted_(), psh = sheet_(SHEET_PROJECTS), pn = psh.getLastRow();
  (pn < 2 ? [] : psh.getRange(2, 1, pn - 1, 3).getValues()).forEach(function (r) { if (r[0]) proj[String(r[0])] = stamp_(r[2]); });
  var ids = Object.keys(items).filter(function (pid) {
    if (!ID_RE.test(pid)) return false;
    var it = items[pid] || {};
    if (gone[pid] || !proj[pid]) { items[pid] = { list: [] }; return true; } // 已刪除：清掉期限
    return !!it.at && String(it.at) === proj[pid]; // 不是最新暫存版本就略過，避免未存或過時的日期上日曆
  });
  if (full) {
    Object.keys(index).forEach(function (pid) {
      if (ids.indexOf(pid) < 0 && (gone[pid] || !proj[pid])) { items[pid] = { list: [] }; ids.push(pid); }
    });
  }
  var cal = '', calErr = '';
  if (calOn_()) { try { cal = calId_(false); } catch (e) { calErr = msg_(e); } }
  var stats = { added: 0, updated: 0, removed: 0, kept: 0 }, errors = calErr ? [calErr] : [];
  ids.forEach(function (pid) {
    var it = items[pid] || {}, row = index[pid], map = {};
    var list = (Array.isArray(it.list) ? it.list : []).filter(function (ev) {
      return ev && ev.key && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date));
    }).slice(0, 300).map(function (ev) {
      return { key: String(ev.key).slice(0, 40), date: String(ev.date), title: String(ev.title || ''), short: String(ev.short || ''),
        who: String(ev.who || ''), hold: ev.hold === true, desc: cleanDesc_(ev.desc, pid) };
    });
    if (row) { try { map = JSON.parse(sh.getRange(row, 4).getValue() || '{}'); } catch (e) { map = {}; } }
    var next = cal ? calApply_(cal, pid, list, map, stats, errors) : map;
    var slim = list.map(function (ev) {
      return { k: ev.key, d: ev.date, t: (ev.short || ev.title).slice(0, 80), w: ev.who.slice(0, 40), h: ev.hold };
    });
    var name = String(it.name || (row ? sh.getRange(row, 2).getValue() : '') || '').slice(0, 100);
    var values = [[pid, safeText_(name), JSON.stringify(slim), JSON.stringify(next), now]];
    if (row) sh.getRange(row, 1, 1, 5).setValues(values);
    else { sh.appendRow(values[0]); index[pid] = sh.getLastRow(); }
  });
  if (full && !errors.length && ver) props.setProperty('SYNC_VER', String(ver).slice(0, 20));
  if (cal && !errors.length) props.setProperty('CAL_SYNCED', now);
  return { ok: true, synced: now, cal: cal ? stats : null, errors: errors.slice(0, 3) };
}

/* ===================== 共用 Google 日曆 ===================== */

function calOn_() { return typeof Calendar !== 'undefined' && !!Calendar && !!Calendar.Events; }

/** 只有「確定不存在」（404／410／已刪除）才視為沒有；配額、網路等暫時性錯誤直接回報 */
function gone_(e) { return /not ?found|404|410|gone|deleted/i.test(msg_(e)); }

/** 取得共用日曆 ID；create 為 true 時若不存在就建立 */
function calId_(create, name) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('CAL_ID');
  if (id) {
    try { Calendar.Calendars.get(id); return id; } catch (e) {
      if (!gone_(e)) throw e; // 網路或配額錯誤：不要重建，避免出現重複的日曆
    }
  }
  if (!create) return '';
  var cal = Calendar.Calendars.insert({
    summary: String(name || '').trim() || '工程期限',
    description: '由「工程契約與驗收管理」網站自動產生的工程期限。請在網站修改；直接改日曆上的活動，下次同步會被覆蓋。',
    timeZone: 'Asia/Taipei'
  });
  props.setProperty('CAL_ID', cal.id);
  var sh = deadlineSheet_(), n = sh.getLastRow(); // 舊日曆的活動對照作廢
  for (var r = 2; r <= n; r++) sh.getRange(r, 4).setValue('{}');
  return cal.id;
}

/**
 * 依期限清單新增／更新／移除日曆活動，回傳新的對照表 { key: { e: 活動ID, h: 內容雜湊 } }。
 *   - 更新時活動已不存在（404／410）→ 重新建立
 *   - 移除時活動已不存在（404／410）→ 視同已移除，刪掉對照
 *   - 其他錯誤（例如配額）→ 保留原對照並回報，下次「點此重試」再處理
 */
function calApply_(cal, pid, list, map, stats, errors) {
  var next = {}, seen = {}, color = String(1 + parseInt(hash_(pid), 36) % 11);
  list.forEach(function (ev) {
    var key = ev.key, cur = map[key];
    seen[key] = true;
    var h = hash_(ev.date + '|' + ev.title + '|' + ev.desc + '|' + color);
    if (cur && cur.h === h) { next[key] = cur; stats.kept++; return; }
    var res = {
      summary: String(ev.title || '').slice(0, 250), description: String(ev.desc || '').slice(0, 4000),
      start: { date: ev.date }, end: { date: nextDay_(ev.date) }, transparency: 'transparent', status: 'confirmed', colorId: color,
      extendedProperties: { private: { tsc: pid + '|' + key } }
    };
    try {
      if (cur && cur.e) {
        try {
          Calendar.Events.patch(res, cal, cur.e);
          next[key] = { e: cur.e, h: h };
          stats.updated++;
          return;
        } catch (e) {
          if (!gone_(e)) throw e; // 確定不存在才重建
        }
      }
      next[key] = { e: Calendar.Events.insert(res, cal).id, h: h };
      stats.added++;
    } catch (err) {
      errors.push(msg_(err));
      if (cur) next[key] = cur;
    }
  });
  Object.keys(map).forEach(function (key) {
    if (seen[key] || !map[key] || !map[key].e) return;
    try {
      Calendar.Events.remove(cal, map[key].e);
    } catch (e) {
      if (!gone_(e)) { next[key] = map[key]; errors.push(msg_(e)); return; }
    }
    stats.removed++;
  });
  return next;
}

function calShare_(cal, email) {
  Calendar.Acl.insert({ role: 'reader', scope: { type: 'user', value: email } }, cal, { sendNotifications: true });
}

function calUnshare_(cal, email) {
  var token = '';
  do {
    var res = Calendar.Acl.list(cal, token ? { pageToken: token } : {});
    (res.items || []).forEach(function (a) {
      if (a.role !== 'owner' && a.scope && String(a.scope.value).toLowerCase() === email) Calendar.Acl.remove(cal, a.id);
    });
    token = res.nextPageToken || '';
  } while (token);
}

function calCreate_(name) {
  if (!calOn_()) return { ok: false, error: CAL_HINT };
  var id = calId_(true, name), warn = [];
  people_().forEach(function (p) {
    if (p.cal) { try { calShare_(id, p.email); } catch (e) { warn.push(p.email + '：' + msg_(e)); } }
  });
  var info = shareInfo_();
  info.warn = warn;
  return info;
}

/* ===================== 工程文件資料夾 ===================== */

function docsRoot_(create, name) {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('DOCS_ID');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {
      if (!/no item|not found|could not be found/i.test(msg_(e))) throw e;
    }
  }
  if (!create) return null;
  var root = DriveApp.createFolder(String(name || '').trim() || ((schoolName_() ? schoolName_() + ' ' : '') + '工程文件'));
  props.setProperty('DOCS_ID', root.getId());
  props.getKeys().forEach(function (k) { if (/^PF_/.test(k)) props.deleteProperty(k); }); // 舊的工程資料夾對照作廢
  return root;
}

function docsCreate_(name) {
  var root = docsRoot_(true, name), warn = [];
  people_().forEach(function (p) {
    if (p.drive) { try { root.addViewer(p.email); } catch (e) { warn.push(p.email + '：' + msg_(e)); } }
  });
  var info = shareInfo_();
  info.warn = warn;
  return info;
}

/** 每個工程一個資料夾，內含各階段子資料夾；只替已暫存、未刪除的工程建立 */
function projectFolder_(pid, name, create) {
  if (!ID_RE.test(String(pid || ''))) return { ok: false, error: '工程編號錯誤' };
  var props = PropertiesService.getScriptProperties(), key = 'PF_' + pid, id = props.getProperty(key), f = null;
  if (id) { try { f = DriveApp.getFolderById(id); if (f.isTrashed()) f = null; } catch (e) { f = null; } }
  if (!f) {
    if (!create) return { ok: true, created: false };
    var exists = rows_(sheet_(SHEET_PROJECTS)).some(function (r) { return String(r[0]) === String(pid); });
    if (deleted_()[pid] || !exists) return { ok: false, error: '請先暫存工程；已刪除或不存在的工程不能建立資料夾' };
    f = docsRoot_(true).createFolder(String(name || pid).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80));
    STAGE_DIRS.forEach(function (n) { f.createFolder(n); });
    props.setProperty(key, f.getId());
  }
  return { ok: true, created: true, id: f.getId(), url: httpUrl_(f.getUrl()) };
}

// 允許的工程檔案（副檔名 → 存檔用的 MIME）；其餘一律拒絕
var UPLOAD_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
  dwg: 'application/acad', zip: 'application/zip', txt: 'text/plain'
};
// 明確阻擋：網頁、腳本、執行檔（即使改了副檔名也看 MIME）
var BLOCK_EXT = /\.(html?|xhtml|svg|js|mjs|vbs|exe|msi|bat|cmd|com|scr|ps1|sh|jar|app|dll|php|py)$/i;
var BLOCK_MIME = /html|javascript|ecmascript|svg|x-msdownload|x-msdos|x-sh|x-bat|x-executable|x-php|x-python/i;

function upload_(b, who) {
  var fname0 = String(b.filename || '').trim(), ext = fname0.toLowerCase().split('.').pop(), mime = String(b.mime || '');
  if (!fname0 || fname0.indexOf('.') < 0 || BLOCK_EXT.test(fname0) || BLOCK_MIME.test(mime) ||
    !Object.prototype.hasOwnProperty.call(UPLOAD_TYPES, ext)) {
    return { ok: false, error: '不允許的檔案類型：請上傳 PDF、Word、Excel、PPTX、JPG、PNG、HEIC、DWG、ZIP 或 TXT' };
  }
  if (typeof b.data !== 'string' || !b.data || b.data.length > 28000000) return { ok: false, error: '檔案超過 20MB 或內容錯誤' };
  var bytes = Utilities.base64Decode(b.data);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) return { ok: false, error: '檔案為空或超過 20MB' };
  var pf = projectFolder_(b.pid, b.pname, true);
  if (!pf.ok) return pf;
  var folder = DriveApp.getFolderById(pf.id);
  var dir = STAGE_DIRS[Math.max(0, Math.min(STAGE_DIRS.length - 1, Number(b.dir) || 0))];
  var it = folder.getFoldersByName(dir), sub = it.hasNext() ? it.next() : folder.createFolder(dir);
  var safe = fname0.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  var fname = (b.prefix ? '【' + String(b.prefix).replace(/[\\/:*?"<>|]/g, '_').slice(0, 20) + '】' : '') + safe;
  var file = sub.createFile(Utilities.newBlob(bytes, UPLOAD_TYPES[ext], fname));
  return { ok: true, folderUrl: pf.url,
    file: { id: file.getId(), name: fname, url: httpUrl_(file.getUrl()), at: new Date().toISOString(), by: String(who || '') } };
}

/* ===================== 同仁名單 ===================== */

function peopleSheet_() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(SHEET_PEOPLE) || ensureSheet_(ss, SHEET_PEOPLE, ['Email', '日曆', '資料夾', '週報', '更新時間', '更新者']);
}

function people_() {
  var yes = function (v) { return v === true || v === '是' || v === 'TRUE'; };
  return rows_(peopleSheet_()).filter(function (r) { return r[0]; }).map(function (r) {
    return { email: String(r[0]).toLowerCase(), cal: yes(r[1]), drive: yes(r[2]), mail: yes(r[3]) };
  });
}

/** 新增、修改或移除一位同仁；b：{ email, cal, drive, mail, remove } */
function person_(b, who) {
  var email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@=+\-][^\s@]*@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Email 格式不正確' };
  var sh = peopleSheet_(), data = rows_(sh), row = 0, cur = { cal: false, drive: false, mail: false };
  data.forEach(function (r, i) {
    if (String(r[0]).toLowerCase() === email) {
      row = i + 2;
      cur = { cal: r[1] === '是' || r[1] === true, drive: r[2] === '是' || r[2] === true, mail: r[3] === '是' || r[3] === true };
    }
  });
  var pick = function (k) { return b[k] === undefined ? (row ? cur[k] : true) : !!b[k]; };
  var want = b.remove ? { cal: false, drive: false, mail: false } : { cal: pick('cal'), drive: pick('drive'), mail: pick('mail') };
  var warn = [];
  if (want.cal !== cur.cal && calOn_()) {
    try {
      var cid = calId_(false);
      if (cid) { if (want.cal) calShare_(cid, email); else calUnshare_(cid, email); }
    } catch (e) {
      warn.push('日曆無法' + (want.cal ? '共用' : '取消共用') + '給 ' + email + '：' + msg_(e) +
        (want.cal ? '（若部署帳號是學校網域帳號，可能被管理員限制對外共用；可改用 iCal 私人網址）' : ''));
      want.cal = cur.cal;
    }
  }
  if (want.drive !== cur.drive) {
    try {
      var root = docsRoot_(false);
      if (root) { if (want.drive) root.addViewer(email); else root.removeViewer(email); }
    } catch (e) {
      warn.push('資料夾無法' + (want.drive ? '共用' : '取消共用') + '給 ' + email + '：' + msg_(e));
      want.drive = cur.drive;
    }
  }
  if (b.remove && !warn.length) { if (row) sh.deleteRow(row); }
  else {
    var vals = [[email, want.cal ? '是' : '', want.drive ? '是' : '', want.mail ? '是' : '', new Date().toISOString(), safeText_(who || '')]];
    if (row) sh.getRange(row, 1, 1, 6).setValues(vals); else sh.appendRow(vals[0]);
  }
  var info = shareInfo_();
  info.warn = warn;
  return info;
}

function shareInfo_() {
  var props = PropertiesService.getScriptProperties();
  var info = { ok: true, people: people_(), syncVer: props.getProperty('SYNC_VER') || '', site: siteUrl_() };
  if (!calOn_()) info.cal = { enabled: false, error: CAL_HINT };
  else {
    try {
      var id = calId_(false);
      if (!id) info.cal = { enabled: true, created: false };
      else {
        var owner = '';
        (Calendar.Acl.list(id).items || []).forEach(function (a) {
          if (!owner && a.role === 'owner' && a.scope && a.scope.type === 'user') owner = a.scope.value;
        });
        info.cal = { enabled: true, created: true, id: id, name: Calendar.Calendars.get(id).summary, owner: owner,
          synced: props.getProperty('CAL_SYNCED') || '' };
      }
    } catch (e) { info.cal = { enabled: false, error: msg_(e) }; }
  }
  try {
    var root = docsRoot_(false);
    info.docs = root ? { created: true, name: root.getName(), url: httpUrl_(root.getUrl()) } : { created: false };
  } catch (e) { info.docs = { created: false, error: msg_(e) }; }
  try { info.digest = { on: digestTrigger_() !== null, last: props.getProperty('DIGEST_LAST') || '' }; }
  catch (e) { info.digest = { on: false, error: msg_(e) }; }
  return info;
}

/* ===================== 網站網址（週報、日曆連結） ===================== */

var SITE_RE = /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~%\/-]*)?$/;

/** 由學校設定頁儲存；只接受 https:// 網址（不含查詢字串與 #） */
function siteSet_(site) {
  site = String(site || '').trim();
  if (!SITE_RE.test(site) || site.length > 300) return { ok: false, error: '請輸入 https:// 開頭的網站網址（不含 ? 與 #）' };
  PropertiesService.getScriptProperties().setProperty('SITE_URL', site);
  var info = shareInfo_();
  info.warn = [];
  return info;
}
function siteUrl_() {
  var site = PropertiesService.getScriptProperties().getProperty('SITE_URL') || '';
  return SITE_RE.test(site) ? site : '';
}

/* ===================== 每週摘要信 ===================== */

function digestTrigger_() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) if (ts[i].getHandlerFunction() === 'weeklyDigest') return ts[i];
  return null;
}

function digestSet_(on) {
  var t = digestTrigger_();
  if (on && !t) {
    ScriptApp.newTrigger('weeklyDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).inTimezone('Asia/Taipei').create();
  }
  if (!on && t) ScriptApp.deleteTrigger(t);
  return shareInfo_();
}

/** 由排程每週一早上執行 */
function weeklyDigest() { sendDigest_(false); }

/** 依「期限」工作表分組：已逾期、7 日內、8～30 日內；停工中（原期限待核對）另列，不算逾期 */
function digestGroups_(today) {
  var g = { late: [], week: [], month: [], hold: [] };
  rows_(deadlineSheet_()).forEach(function (r) {
    if (!r[0]) return;
    var list = [];
    try { list = JSON.parse(r[2] || '[]'); } catch (e) {}
    list.forEach(function (x) {
      var left = daysBetween_(today, x.d), item = { pid: String(r[0]), name: String(r[1] || ''), t: x.t, d: x.d, w: x.w, left: left };
      if (x.h === true) { if (left <= 30) g.hold.push(item); }
      else if (left < 0) g.late.push(item);
      else if (left <= 7) g.week.push(item);
      else if (left <= 30) g.month.push(item);
    });
  });
  ['late', 'week', 'month', 'hold'].forEach(function (k) { g[k].sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; }); });
  return g;
}

function sendDigest_(test) {
  var to = people_().filter(function (p) { return p.mail; }).map(function (p) { return p.email; });
  if (!to.length) return { ok: false, error: '週報名單是空的：請在同仁名單勾選「週報」' };
  var props = PropertiesService.getScriptProperties(), site = siteUrl_(), school = schoolName_();
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var g = digestGroups_(today);
  var total = g.late.length + g.week.length + g.month.length + g.hold.length;
  if (!total && !test) return { ok: true, sent: 0, skipped: true };
  var subject = '【工程期限週報】' + (g.late.length ? '逾期 ' + g.late.length + ' 項、' : '') + '7 日內 ' + g.week.length + ' 項' +
    '（' + rocDate_(today) + '）' + (test ? '［測試］' : '');
  MailApp.sendEmail({ to: to.join(','), subject: subject, htmlBody: digestHtml_(g, site, school, today),
    body: digestText_(g, site, school, today), name: (school || '學校') + ' 工程契約與驗收管理' });
  props.setProperty('DIGEST_LAST', new Date().toISOString());
  return { ok: true, sent: to.length, to: to, total: total };
}

function leftText_(x, kind) {
  if (kind === 'hold') return '停工中（原期限待核對）';
  if (kind === 'late') return '逾期 ' + (-x.left) + ' 天';
  return x.left === 0 ? '今天' : '剩 ' + x.left + ' 天';
}

function digestHtml_(g, site, school, today) {
  var esc = function (s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return map[c]; });
  };
  var td = 'padding:6px 10px;border-bottom:1px solid #e5e5e5;vertical-align:top';
  var sec = function (title, color, list, kind) {
    if (!list.length) return '';
    var head = ['期限', '工程', '事項', '主辦', ''].map(function (h) { return '<th align="left" style="' + td + '">' + h + '</th>'; }).join('');
    var rows = list.map(function (x) {
      var name = site ? '<a href="' + esc(site + '#p=' + x.pid) + '" style="color:#1a1a1a">' + esc(x.name) + '</a>' : esc(x.name);
      return '<tr><td style="' + td + ';white-space:nowrap">' + rocDate_(x.d) + '</td><td style="' + td + '">' + name + '</td>' +
        '<td style="' + td + '">' + esc(x.t) + '</td><td style="' + td + '">' + esc(x.w) + '</td>' +
        '<td style="' + td + ';white-space:nowrap;color:' + color + '">' + leftText_(x, kind) + '</td></tr>';
    }).join('');
    return '<h3 style="margin:22px 0 6px;font-size:16px;color:' + color + '">' + title + '（' + list.length + ' 項）</h3>' +
      '<table style="border-collapse:collapse;font-size:14px;width:100%"><tr style="background:#f4f4f4">' + head + '</tr>' +
      rows + '</table>';
  };
  var none = !g.late.length && !g.week.length && !g.month.length && !g.hold.length;
  return '<div style="font-family:Arial,\'Microsoft JhengHei\',sans-serif;color:#1a1a1a;max-width:780px">' +
    '<h2 style="margin:0 0 4px;font-size:20px">' + esc(school) + ' 工程期限週報</h2>' +
    '<p style="color:#666;margin:0">' + rocDate_(today) + '　已逾期 ' + g.late.length + ' 項、7 日內 ' + g.week.length + ' 項、8–30 日 ' +
    g.month.length + ' 項</p>' +
    sec('已逾期', '#b3261e', g.late, 'late') + sec('7 日內到期', '#1a1a1a', g.week, 'week') + sec('8–30 日內到期', '#555555', g.month, 'month') +
    sec('停工中（原期限待核對）', '#946C30', g.hold, 'hold') +
    (none ? '<p style="margin-top:18px">未來 30 天沒有到期事項。</p>' : '') +
    (site ? '<p style="margin-top:22px"><a href="' + esc(site) + '">開啟工程契約與驗收管理</a></p>' : '') +
    '<p style="color:#888;font-size:12px;margin-top:16px">每週一早上自動寄出，內容以網站最後一次「暫存」為準。不想收到請告知承辦人。</p></div>';
}

function digestText_(g, site, school, today) {
  var line = function (x, kind) {
    return '・' + rocDate_(x.d) + '　' + x.name + '｜' + x.t + (x.w ? '（' + x.w + '）' : '') + '　' + leftText_(x, kind);
  };
  var sec = function (title, list, kind) {
    if (!list.length) return '';
    return '\n' + title + '（' + list.length + ' 項）\n' + list.map(function (x) { return line(x, kind); }).join('\n') + '\n';
  };
  return school + ' 工程期限週報　' + rocDate_(today) + '\n' + sec('已逾期', g.late, 'late') + sec('7 日內到期', g.week, 'week') +
    sec('8–30 日內到期', g.month, 'month') + sec('停工中（原期限待核對）', g.hold, 'hold') + (site ? '\n網站：' + site + '\n' : '');
}

/* ===================== 小工具 ===================== */

function nextDay_(d) {
  var p = String(d).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)).toISOString().slice(0, 10);
}

function daysBetween_(a, b) {
  var p = String(a).split('-').map(Number), q = String(b).split('-').map(Number);
  return Math.round((Date.UTC(q[0], q[1] - 1, q[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / 864e5);
}

function rocDate_(d) {
  var p = String(d).split('-').map(Number);
  var w = '日一二三四五六'.charAt(new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay());
  return (p[0] - 1911) + '.' + ('0' + p[1]).slice(-2) + '.' + ('0' + p[2]).slice(-2) + '（' + w + '）';
}

function hash_(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
