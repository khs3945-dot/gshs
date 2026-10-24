/**
 * 경성고 교무 도구 — Supabase 자료를 구글 드라이브에 정기 백업 (설정 방법: BACKUP-SETUP.md)
 *
 * 하는 일(매주 한 번, 시간 트리거):
 *  1) Supabase Edge Function `db-backup`에서 public 표를 모두 받아 표마다 JSON 파일로 → 날짜 이름 zip 하나로 저장
 *     (가입 계정 목록 _auth_users.json, 받은 목록 _manifest.json 포함)
 *  2) Supabase 저장소(Storage) 파일은 "파일" 폴더에 그대로 복사 — 이미 있는 같은 크기 파일은 건너뛰어요(바뀐 것만)
 *  3) 오래된 zip은 KEEP개만 남기고 휴지통으로, 결과를 db-backup에 알려 관리 › 서비스 사용량에 "마지막 백업"으로 보여요
 *  4) 실패하면 이 스크립트 주인에게 메일
 *
 * 비밀값(BACKUP_TOKEN)은 코드에 쓰지 않고 "프로젝트 설정 → 스크립트 속성"에 넣어요. 이 파일은 공개 저장소에 있어요.
 * 백업에는 학생 민감 비고·계정 정보까지 들어가요 — 백업 폴더는 다른 사람과 공유하지 마세요.
 */
var BACKUP_URL = 'https://tmssupuskkajahpuswcj.supabase.co/functions/v1/db-backup';
var FOLDER_NAME = '교무도구 Supabase 백업';
var KEEP = 8; // 남길 zip 개수(매주면 약 두 달)

function token_() {
  var token = PropertiesService.getScriptProperties().getProperty('BACKUP_TOKEN');
  if (!token) throw new Error('스크립트 속성에 BACKUP_TOKEN을 넣어 주세요.');
  return token;
}
function req_(body) {
  body.token = token_();
  return { url: BACKUP_URL, method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true };
}
function parse_(res) {
  var j;
  try { j = JSON.parse(res.getContentText()); } catch (e) { throw new Error('응답을 읽지 못했어요(' + res.getResponseCode() + ')'); }
  if (!j.ok) throw new Error(j.error || '실패');
  return j;
}
function call_(body) {
  var r = req_(body);
  return parse_(UrlFetchApp.fetch(r.url, r));
}
// 여러 요청을 한꺼번에(Apps Script 한 번 실행은 6분까지라 표·파일을 10개씩 동시에 받아요)
function callAll_(bodies) {
  return UrlFetchApp.fetchAll(bodies.map(req_)).map(parse_);
}

function folder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function backupSupabase() {
  var started = new Date();
  var stamp = Utilities.formatDate(started, 'Asia/Seoul', 'yyyy-MM-dd_HHmm');
  var root = folder_(DriveApp.getRootFolder(), FOLDER_NAME);
  var summary = { ok: true, tables: 0, rows: 0, bytes: 0, files: 0, note: '' };
  try {
    var list = call_({ action: 'list' });
    var blobs = [];
    var pending = list.tables.map(function (t) { return { name: t.name, rows: [], offset: 0 }; });
    while (pending.length) {
      var batch = pending.splice(0, 10);
      var res = callAll_(batch.map(function (b) { return { action: 'table', table: b.name, offset: b.offset }; }));
      res.forEach(function (j, i) {
        var b = batch[i];
        b.rows = b.rows.concat(j.rows);
        if (j.next !== null && j.next !== undefined) { b.offset = j.next; pending.push(b); return; }
        var text = JSON.stringify(b.rows);
        blobs.push(Utilities.newBlob(text, 'application/json', b.name + '.json'));
        summary.tables++; summary.rows += b.rows.length; summary.bytes += text.length;
      });
    }
    blobs.push(Utilities.newBlob(JSON.stringify(list.auth_users || []), 'application/json', '_auth_users.json'));
    blobs.push(Utilities.newBlob(JSON.stringify({ at: list.at, tables: list.tables, files: list.files }, null, 1), 'application/json', '_manifest.json'));
    root.createFile(Utilities.zip(blobs, 'supabase-' + stamp + '.zip'));

    // 저장소 파일: 바뀐 것만 복사(이름의 / 는 __ 로)
    var filesDir = folder_(root, '파일');
    var have = {};
    var fit = filesDir.getFiles();
    while (fit.hasNext()) { var f = fit.next(); have[f.getName()] = f; }
    var todo = (list.files || []).filter(function (o) {
      o.dname = o.bucket + '__' + String(o.name).replace(/\//g, '__');
      var old = have[o.dname];
      if (old && old.getSize() === Number(o.size)) return false;
      if (Number(o.size) > 45 * 1024 * 1024) { summary.note += '큰 파일 건너뜀: ' + o.dname + '; '; return false; }
      return true;
    });
    while (todo.length) {
      var fb = todo.splice(0, 5);
      var urls = callAll_(fb.map(function (o) { return { action: 'file', bucket: o.bucket, name: o.name }; }));
      var got = UrlFetchApp.fetchAll(urls.map(function (u) { return { url: u.url, muteHttpExceptions: true }; }));
      got.forEach(function (r, i) {
        var o = fb[i];
        if (r.getResponseCode() !== 200) { summary.note += '못 받음: ' + o.dname + '; '; return; }
        if (have[o.dname]) have[o.dname].setTrashed(true);
        filesDir.createFile(r.getBlob().setName(o.dname));
        summary.files++;
      });
    }

    // 오래된 zip 정리
    var zips = [], zit = root.getFiles();
    while (zit.hasNext()) { var z = zit.next(); if (/^supabase-.*\.zip$/.test(z.getName())) zips.push(z); }
    zips.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
    zips.slice(KEEP).forEach(function (z) { z.setTrashed(true); });
  } catch (e) {
    summary.ok = false; summary.note = String(e && e.message || e).slice(0, 400);
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[교무 도구] Supabase 백업 실패', summary.note + '\n\n' + stamp);
  }
  try { call_({ action: 'done', summary: summary }); } catch (e2) {}
  Logger.log(JSON.stringify(summary));
}

// 한 번만 실행: 매주 일요일 새벽 3~4시에 backupSupabase가 돌게 해요(이미 있으면 다시 만들지 않음)
function setupWeeklyTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'backupSupabase'; });
  if (!exists) ScriptApp.newTrigger('backupSupabase').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone('Asia/Seoul').create();
}
