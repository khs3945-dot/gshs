/**
 * 경성고 교무 도구 — Supabase 자료를 구글 드라이브에 정기 백업 (설정 방법: BACKUP-SETUP.md)
 *
 * 하는 일(매주 한 번, 시간 트리거):
 *  1) Supabase Edge Function `db-backup`에서 public 표를 모두 받아 표마다 JSON 파일로 → 날짜 이름 zip 하나로 저장
 *     (가입 계정 목록 _auth_users.json, 받은 목록 _manifest.json 포함)
 *  2) Supabase 저장소(Storage) 파일은 "파일" 폴더에 그대로 복사 — 이미 있는 같은 크기 파일은 건너뛰어요(바뀐 것만)
 *  3) 각 페이지 "엑셀로 받기"와 똑같은 엑셀 파일들 → "엑셀/날짜" 폴더
 *     (자료가 망가지면 그 파일을 그 페이지에 그대로 다시 올려요. 전체 원본은 1)의 zip)
 *  4) 오래된 zip·엑셀은 KEEP개만 남기고 휴지통으로, 결과를 db-backup에 알려 관리 › 서비스 사용량에 "마지막 백업"으로 보여요
 *  5) 실패하면 이 스크립트 주인에게 메일
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
    var blobs = [], data = {};
    var pending = list.tables.map(function (t) { return { name: t.name, rows: [], offset: 0 }; });
    while (pending.length) {
      var batch = pending.splice(0, 10);
      var res = callAll_(batch.map(function (b) { return { action: 'table', table: b.name, offset: b.offset }; }));
      res.forEach(function (j, i) {
        var b = batch[i];
        b.rows = b.rows.concat(j.rows);
        if (j.next !== null && j.next !== undefined) { b.offset = j.next; pending.push(b); return; }
        data[b.name] = b.rows;
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

    // 엑셀 백업(실패해도 zip 백업은 이미 끝났으니 메모만 남겨요)
    try { summary.excel = backupExcel_(data, root, stamp, list.auth_users); }
    catch (ex) { summary.note += '엑셀 백업 실패: ' + String(ex && ex.message || ex).slice(0, 200) + '; '; }

    // 오래된 zip·엑셀 정리
    keepNewest_(root, /^supabase-.*\.zip$/);
    keepNewestFolders_(folder_(root, '엑셀'));
  } catch (e) {
    summary.ok = false; summary.note = String(e && e.message || e).slice(0, 400);
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[교무 도구] Supabase 백업 실패', summary.note + '\n\n' + stamp);
  }
  try { call_({ action: 'done', summary: summary }); } catch (e2) {}
  Logger.log(JSON.stringify(summary));
}

function keepNewest_(folder, re) {
  var arr = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (re.test(f.getName())) arr.push(f); }
  arr.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
  arr.slice(KEEP).forEach(function (f) { f.setTrashed(true); });
}

// ---------- 엑셀 백업: 각 페이지 "엑셀로 받기"와 똑같은 파일 → 자료가 망가지면 그 페이지에 그대로 다시 올려요 ----------
// 사이트 코드와 같은 모양으로 만들어요(바꾸면 두 곳 다):
//  · 통합자료_학년도.xlsx       = 관리 › 자료 한번에 관리 "통합 파일 받기"(탭 이름·머리글 같음 → "통합 파일 올리기" 또는 카드별 "엑셀 올리기")
//  · 예산_연도.xlsx             = 예산 지출 관리 "엑셀로 받기"(→ 예산 탭 "엑셀 가져오기": 없는 줄만 더해요)
//  · 학생시간표_연도_학기.xlsx  = 학생 시간표 "시간표 엑셀 받기"(→ "고친 엑셀 올리기")
//  · 수강배정_연도_학기.xlsx    = 학생 시간표 "지금 수강 배정 엑셀 받기"(→ "① 수강 배정 올리기")
//  · 경성고_교실예약_학년도.xlsx = 교실 예약 "예약 양식 받기"의 열 모양(예약이 있는 줄만, → 엑셀로 일괄 등록)
//  · 경성고_회원명단_날짜.xlsx   = 회원 관리 "회원 명단 다운로드"
//  · 설문/설문제목_응답.xlsx     = 설문 "엑셀로 받기"
//  · 기타자료_날짜.xlsx          = 올리는 곳이 없는 참고 자료(시험 목록·공지사항·학기 업무 흐름)
var DAYS_ = ['월', '화', '수', '목', '금'], PERS_ = [1, 2, 3, 4, 5, 6, 7], WD_ = ['일', '월', '화', '수', '목', '금', '토'];
var GONE_RE = /전출|자퇴|학업\s*중단|제적/;
var TT_VIEW_ = { widths: [6, 14].concat(new Array(35).fill(12)), wrap: true };   // 교사 시간표 편집 "엑셀 양식 다운로드"와 같은 열 너비
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function ymd_(d) { return d.getFullYear() + '-' + pad_(d.getMonth() + 1) + '-' + pad_(d.getDate()); }
function str_(v) { return v === null || v === undefined ? '' : v; }
function cellText_(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'O';
  if (v === false) return '';
  if (Array.isArray(v)) v = v.map(function (x) { return typeof x === 'object' ? JSON.stringify(x) : x; }).join(', ');
  else if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'number') return v;
  var t = String(v);
  return t.length > 45000 ? t.slice(0, 45000) + '…' : t;   // 구글 시트 한 칸은 5만 자까지
}
// 여러 칸 기준 정렬(앞에 - 면 내림차순, 빈 값은 뒤로) — DB의 order by와 같게
function sortBy_(rows, keys) {
  return rows.slice().sort(function (a, b) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], desc = k.charAt(0) === '-'; if (desc) k = k.slice(1);
      var x = a[k], y = b[k]; if (x === y) continue;
      if (x === null || x === undefined || x === '') return 1; if (y === null || y === undefined || y === '') return -1;
      var c = x < y ? -1 : 1; return desc ? -c : c;
    }
    return 0;
  });
}
function ko_(a, b) { return String(a).localeCompare(String(b), 'ko'); }
// 시트 여러 개 → xlsx 파일 하나(임시 구글 시트를 만들어 xlsx로 내보낸 뒤 지워요)
function makeXlsx_(folder, filename, sheets) {
  var ss = SpreadsheetApp.create(filename.replace(/\.xlsx$/, '')), first = ss.getSheets()[0], made = 0;
  try {
    sheets.forEach(function (sh) {
      var aoa = sh[1].length ? sh[1] : [['']], w = 1;
      aoa.forEach(function (r) { if (r.length > w) w = r.length; });
      aoa = aoa.map(function (r) { var o = []; for (var i = 0; i < w; i++) o.push(cellText_(r[i])); return o; });
      var ws = made === 0 ? first.setName(sh[0]) : ss.insertSheet(sh[0]);
      if (ws.getMaxColumns() < w) ws.insertColumnsAfter(ws.getMaxColumns(), w - ws.getMaxColumns());
      // 글자 칸은 "일반 텍스트" 서식으로 — "2-6"(담임반)·"0101"·날짜·"=…"가 날짜·숫자·계산식으로 바뀌지 않고 받은 그대로 남아요(숫자 칸은 숫자 그대로)
      var rg = ws.getRange(1, 1, aoa.length, w);
      rg.setNumberFormats(aoa.map(function (r) { return r.map(function (v) { return typeof v === 'number' ? 'General' : '@'; }); }));
      rg.setValues(aoa);
      // 보기 모양도 페이지 파일처럼: sh[2] = { widths: [글자 수…], wrap: true }(열 너비·칸 안 줄바꿈)
      var opt = sh[2] || {};
      if (opt.widths) opt.widths.forEach(function (wch, i) { if (i < w) ws.setColumnWidth(i + 1, Math.round(wch * 7 + 10)); });
      if (opt.wrap) rg.setWrap(true).setVerticalAlignment('top');
      made++;
    });
    SpreadsheetApp.flush();
    var res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error(filename + ': 엑셀로 바꾸지 못했어요(' + res.getResponseCode() + ')');
    folder.createFile(res.getBlob().setName(filename));
  } finally {
    DriveApp.getFileById(ss.getId()).setTrashed(true);
  }
}
function schoolYear_(d) { return d.getMonth() + 1 >= 3 ? d.getFullYear() : d.getFullYear() - 1; }

// --- 자료 한번에 관리 "통합 파일"(data-hub.html의 D[].export와 같은 모양) ---
function hubSheets_(data, y, todayStr) {
  var pn = { st: {}, sec: {} };   // 민감 비고(학생부 비고에서 따로 보관한 것)도 비고 칸에 합쳐요 — 다시 올릴 때 지워지지 않게
  (data.school_private_notes || []).forEach(function (n) { if (n.year !== y) return; if (n.kind === 'student') pn.st[n.grade + '|' + n.class_no + '|' + n.no] = n.note; else pn.sec[n.grade + '|' + n.class_no] = n.note; });
  var merge = function (a, b) { return [a, b].filter(function (x) { return x; }).join(', '); };
  var out = [['안내', [['경성고 교무 도구 — 통합 자료 파일'], ['학년도: ' + y + ' · 받은 날: ' + todayStr], [''], ['탭마다 자료가 하나씩 있어요. 고칠 탭만 고쳐서 이 파일을 그대로 "통합 파일 올리기"로 올리세요.'], ['머리글(첫 줄)과 탭 이름은 바꾸지 마세요. 고치지 않은 탭은 반영하지 않아요.'], ['학생 명렬·반 편성 탭의 비고에는 민감 정보가 들어 있어요 — 보관·공유에 주의하세요.'], ['학생 진급 탭: 신규 학년·반·번호를 적은 줄만 다음 학년도로 진급해요(비워 두면 건너뜀).']]]];
  // 학교 기본 정보(그 학년도가 없으면 바로 앞 학년도)
  var F = [['school_no', '학교번호'], ['school_code', '학교코드'], ['nice_code', '나이스 코드'], ['phone', '전화'], ['fax', '팩스'], ['supervisor', '감독청'], ['ver_date', '기준일'], ['grade1_count', '1학년 학생 수'], ['grade2_count', '2학년 학생 수'], ['grade3_count', '3학년 학생 수'], ['total_count', '전체 학생 수']];
  var ov = (data.school_overview || []).filter(function (r) { return r.year === y; })[0] || sortBy_((data.school_overview || []).filter(function (r) { return r.year < y; }), ['-year'])[0];
  out.push(['학교 기본 정보', [['항목', '값']].concat(F.map(function (f) { return [f[1], ov ? str_(ov[f[0]]) : '']; }))]);
  // 교직원 명렬
  var C = [['name', '이름'], ['department', '부서'], ['subject', '교과'], ['extension', '내선'], ['mobile', '휴대폰'], ['homeroom', '담임반'], ['co_homeroom', '부담임반'], ['homeroom_room', '담임 교실'], ['hours', '시수'], ['groups', '그룹'], ['roles', '역할']];
  var staff = sortBy_(data.staff || [], ['department', 'name']);
  out.push(['교직원 명렬', [C.map(function (c) { return c[1]; })].concat(staff.map(function (r) { return C.map(function (c) { return r[c[0]] || ''; }); }))]);
  // 교사 시간표(교실×요일·교시, 칸 = "과목\n교사")
  var rooms = {}, cell = {};
  staff.filter(function (t) { return t.schedule; }).forEach(function (t) { DAYS_.forEach(function (d) { PERS_.forEach(function (p) {
    var c = t.schedule[d] && t.schedule[d][String(p)];
    if (c && c.room !== undefined && c.room !== null && c.room !== '' && c.subject) { rooms[String(c.room)] = c.room; cell[c.room + '|' + d + '|' + p] = c.subject + '\n' + t.name; }
  }); }); });
  var R = Object.keys(rooms).map(function (k) { return rooms[k]; }).sort(function (a, b) { var an = typeof a === 'number', bn = typeof b === 'number'; return an && bn ? a - b : an ? -1 : bn ? 1 : ko_(a, b); });
  if (!R.length) R = ['201', '컴퓨터실'];
  var h1 = ['', ''], h2 = ['순번', '교실'];
  DAYS_.forEach(function (d) { PERS_.forEach(function (p) { h1.push(d); h2.push(p); }); });
  out.push(['교사 시간표', [h1, h2].concat(R.map(function (r, i) { var row = [i + 1, r]; DAYS_.forEach(function (d) { PERS_.forEach(function (p) { row.push(cell[r + '|' + d + '|' + p] || ''); }); }); return row; })), TT_VIEW_]);
  // 학생 명렬
  var stu = sortBy_((data.students || []).filter(function (r) { return r.year === y; }), ['grade', 'class_no', 'no']);
  out.push(['학생 명렬', [['학년', '반', '번호', '이름', '비고']].concat(stu.map(function (r) { return [r.grade, r.class_no, r.no, r.name || '', merge(r.note, pn.st[r.grade + '|' + r.class_no + '|' + r.no]) || '']; }))]);
  // 반 편성(그 학년도가 없으면 앞 학년도)
  var sec = (data.class_sections || []).filter(function (r) { return r.year === y; }), sy = y;
  if (!sec.length) { sy = y - 1; sec = (data.class_sections || []).filter(function (r) { return r.year === sy; }); }
  var pnSec = pn.sec;
  if (sy !== y) { pnSec = {}; (data.school_private_notes || []).forEach(function (n) { if (n.year === sy && n.kind !== 'student') pnSec[n.grade + '|' + n.class_no] = n.note; }); }
  out.push(['반 편성', [['학년', '반', '담임(자동)', '부담임(자동)', '비고']].concat(sortBy_(sec, ['grade', 'class_no']).map(function (r) { return [r.grade, r.class_no, r.teacher_name || '', r.co_teacher_name || '', merge(r.note, pnSec[r.grade + '|' + r.class_no]) || '']; }))]);
  // 학사일정
  var ev = sortBy_((data.academic_events || []).filter(function (r) { return r.year === y; }), ['start_date']);
  out.push(['학사일정', [['시작일', '종료일', '일정', '학년(비우면 전체)']].concat(ev.map(function (r) { return [r.start_date, r.end_date || '', r.title, r.grades || '']; }))]);
  // 교실 목록
  out.push(['교실 목록', [['교실 이름', '분류', '순서']].concat(sortBy_(data.rooms || [], ['sort_order']).map(function (r) { return [r.name, r.category || '', str_(r.sort_order)]; }))]);
  // 학생 지도 일정(날짜 하나당 한 줄, 학년도 3월~이듬해 2월 평일 전부)
  var from = y + '-03-01', last = new Date(y + 1, 2, 0), to = ymd_(last);
  var by = {};
  sortBy_((data.duty_roster || []).filter(function (r) { return r.duty_date >= from && r.duty_date <= to; }), ['duty_date', 'zone']).forEach(function (r) { (by[r.duty_date] = by[r.duty_date] || []).push(r); });
  var acad = {};
  (data.academic_events || []).filter(function (r) { return r.start_date <= to && r.end_date >= from; }).forEach(function (r) {
    for (var d = new Date(r.start_date + 'T00:00:00'), e = new Date(r.end_date + 'T00:00:00'); d <= e; d.setDate(d.getDate() + 1)) { var k = ymd_(d); (acad[k] = acad[k] || []).push(r.title); }
  });
  var ZC = [['gate', '등교지도 정문'], ['back', '등교지도 후문'], ['lunch', '중식지도'], ['night', '자기주도학습']];
  var duty = [['날짜', '요일', '학사일정(참고)'].concat(ZC.map(function (c) { return c[1]; }), ['기타(구역:이름; …)'])];
  for (var d = new Date(from + 'T00:00:00'), e = new Date(to + 'T00:00:00'); d <= e; d.setDate(d.getDate() + 1)) {
    var k = ymd_(d), wd = d.getDay(); if ((wd === 0 || wd === 6) && !by[k]) continue;
    var w = { gate: [], back: [], lunch: [], night: [], other: [] };
    (by[k] || []).forEach(function (r) {
      var n = String(r.teacher_name || '').trim(), z = String(r.zone || '').trim();
      if (/야자|자율학습|자기주도/.test(z)) { if (n) w.night.push(n); return; }
      var b = z.replace(/\d+$/, '');
      if (b === '정문') { if (n) w.gate.push(n); } else if (b === '후문') { if (n) w.back.push(n); } else if (b === '중식') { if (n) w.lunch.push(n); } else w.other.push(r.zone + ':' + n);
    });
    var uniq = []; (acad[k] || []).forEach(function (t) { if (uniq.indexOf(t) < 0) uniq.push(t); });
    duty.push([k, WD_[wd], uniq.join(', ')].concat(ZC.map(function (c) { return w[c[0]].join(', '); }), [w.other.join('; ')]));
  }
  out.push(['학생 지도 일정', duty]);
  // 학생 진급(지금 학년도 1·2학년 → 신규 칸은 비워 둔 양식)
  out.push(['학생 진급', [['이전 학년', '이전 반', '이전 번호', '이전 이름', '신규 학년', '신규 반', '신규 번호', '신규 이름']].concat(stu.filter(function (r) { return r.grade < 3 && !GONE_RE.test(r.note || ''); }).map(function (r) { return [r.grade, r.class_no, r.no, r.name || '', r.grade + 1, '', '', r.name || '']; }))]);
  return out;
}

// --- 예산 지출 관리(budget.html "엑셀로 받기"와 같은 모양) ---
function budgetSheets_(data, y) {
  var key = function (r) { return [String(r.kind || '').trim(), String(r.project || '').trim(), String(r.area || '').trim()].join('\u0001'); };
  var B = sortBy_((data.budget_items || []).filter(function (r) { return r.year === y; }), ['sort', 'created_at']);
  var S = sortBy_((data.budget_spends || []).filter(function (r) { return r.year === y; }), ['-created_at']);
  var t = {};
  B.forEach(function (b) { var x = t[key(b)] = t[key(b)] || { amt: 0, done: 0, plan: 0 }; x.amt += Number(b.amount) || 0; });
  S.forEach(function (s) { var x = t[key(s)] = t[key(s)] || { amt: 0, done: 0, plan: 0 }; x[s.planned ? 'plan' : 'done'] += Number(s.amount) || 0; });
  var seen = {};
  var bud = [['예산 종류', '세부사업명', '영역', '예산 금액', '지출', '예정', '잔액', '비고', '내역', '구분', '집행률', '담당']].concat(B.map(function (b) {
    var k = key(b), x = t[k], f = !seen[k]; seen[k] = 1;
    return [b.kind, b.project, b.area, Number(b.amount), f ? x.done : '', f ? x.plan : '', f ? x.amt - x.done - x.plan : '', b.note || '', b.detail || '', b.category || '', f && x.amt ? Math.round((x.done + x.plan) / x.amt * 1000) / 10 + '%' : '', b.owner_name || ''];
  }));
  var sp = [['예산 종류', '세부사업명', '영역', '분류', '날짜', '사용자', '지출', '비고', '내역', '예정', '예산 내 잔액']].concat(S.map(function (s) {
    var x = t[key(s)] || { amt: 0, done: 0, plan: 0 };
    return [s.kind, s.project, s.area, s.program || '', s.spend_date || '', s.user_name || '', Number(s.amount), s.note || '', s.detail || '', s.planned ? '예정' : '', x.amt - x.done - x.plan];
  }));
  return [[y + '년 예산', bud], ['사용 내역 기록', sp]];
}

// --- 학생 시간표(student-timetable.html "시간표 엑셀 받기"·"지금 수강 배정 엑셀 받기"와 같은 모양) ---
function sttSheets_(data, y, sem) {
  var rows = (data.student_timetables || []).filter(function (r) { return r.year === y && r.semester === sem; });
  var TT = {}; rows.forEach(function (r) { TT[r.grade + '-' + r.class_no + '-' + r.no] = r; });
  var students = sortBy_((data.students || []).filter(function (r) { return r.year === y && !GONE_RE.test(r.note || ''); }), ['grade', 'class_no', 'no']);
  var slots = []; DAYS_.forEach(function (d) { PERS_.forEach(function (p) { slots.push([d, p]); }); });
  var txt = function (x) { return !x ? '' : x.blk ? '선택 ' + x.blk : x.s + (x.sec || '') + (x.r && x.s !== '창체' && x.s !== '공강' ? ' (' + x.r + ')' : ''); };
  var tt = [['학년', '반', '번호', '이름'].concat(slots.map(function (s) { return s[0] + s[1]; }), ['수강 과목', '확인 필요', '상태'])];
  students.forEach(function (s) {
    var r = TT[s.grade + '-' + s.class_no + '-' + s.no] || {}, g = r.grid || {}, saved = Object.keys(g).length > 0;
    tt.push([s.grade, s.class_no, s.no, s.name].concat(slots.map(function (x) { return txt(g[x[0]] && g[x[0]][x[1]]); }),
      [(r.courses || []).map(function (c) { return c.s + (c.sec || ''); }).join(', '), (r.issues || []).join(' / '), r.manual ? '직접 고침' : saved ? '저장됨' : '저장 안 됨']));
  });
  var subj = []; rows.forEach(function (r) { (r.courses || []).forEach(function (c) { if (subj.indexOf(c.s) < 0) subj.push(c.s); }); });
  var hak = function (s) { return String(s.grade) + pad_(s.class_no) + pad_(s.no); };
  var sel = [['학번', '이름'].concat(subj)].concat(students.map(function (s) {
    var cs = (TT[s.grade + '-' + s.class_no + '-' + s.no] || {}).courses || [];
    return [hak(s), s.name].concat(subj.map(function (x) { var c = cs.filter(function (c) { return c.s === x; })[0]; return c ? c.sec || '' : ''; }));
  }));
  return { tt: [['학생별', tt]], sel: [['배정내역', sel]] };
}

function backupExcel_(data, root, stamp, auth) {
  var now = new Date(), todayStr = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd'), SY = schoolYear_(now);
  var dir = folder_(folder_(root, '엑셀'), stamp), made = [];
  var add = function (name, sheets) { makeXlsx_(dir, name, sheets); made.push(name); };
  // 통합 파일: 지금 학년도(+ 다음 학년도 명렬이 이미 있으면 그것도)
  var years = [SY]; if ((data.students || []).some(function (r) { return r.year === SY + 1; })) years.push(SY + 1);
  years.forEach(function (y) { add('통합자료_' + y + '학년도_' + todayStr + '.xlsx', hubSheets_(data, y, todayStr)); });
  // 교사 시간표 편집 "엑셀 양식 다운로드"와 같은 파일(시트 이름 "시간표") → 그 페이지 "전체 교사 시간표 일괄 업데이트"에 그대로
  var ttTab = hubSheets_(data, SY, todayStr).filter(function (x) { return x[0] === '교사 시간표'; })[0];
  add('전체_교사_시간표_양식.xlsx', [['시간표', ttTab[1], TT_VIEW_]]);
  // 예산: 자료가 있는 회계연도마다
  var by = {}; (data.budget_items || []).concat(data.budget_spends || []).forEach(function (r) { by[r.year] = 1; });
  Object.keys(by).sort().forEach(function (y) { add('예산_' + y + '.xlsx', budgetSheets_(data, Number(y))); });
  // 학생 시간표·수강 배정: 자료가 있는 학년도·학기마다
  var ys = {}; (data.student_timetables || []).forEach(function (r) { ys[r.year + '_' + r.semester] = [r.year, r.semester]; });
  Object.keys(ys).sort().forEach(function (k) { var y = ys[k][0], s = ys[k][1], st = sttSheets_(data, y, s); add('학생시간표_' + y + '_' + s + '학기.xlsx', st.tt); add('수강배정_' + y + '_' + s + '학기.xlsx', st.sel); });
  // 교실 예약(지금 학년도, 예약 양식과 같은 열 — 예약ID가 있어 다시 올리면 그 예약을 고쳐요)
  var roomCat = {}; (data.rooms || []).forEach(function (r) { roomCat[r.name] = r.category || ''; });
  var hm = function (v) { var m = String(v || '').match(/^(\d{1,2}):(\d{2})/); return m ? pad_(Number(m[1])) + ':' + m[2] : str_(v); };
  var bk = sortBy_((data.room_bookings || []).filter(function (b) { return b.booking_date >= SY + '-03-01' && b.booking_date < (SY + 1) + '-03-01'; }), ['room_name', 'booking_date', 'start_time']);
  add('경성고_교실예약_' + SY + '학년도.xlsx', [['교실예약', [['예약ID', '교실', '위치', '날짜', '시작시간', '종료시간', '제목', '사용자']].concat(bk.map(function (b) { return [b.id, b.room_name, roomCat[b.room_name] || '', b.booking_date, hm(b.start_time), hm(b.end_time), b.title || '', b.teacher_name || '']; }))]]);
  // 회원 명단(회원 관리 다운로드와 같은 열)
  var au = {}; (auth || []).forEach(function (u) { au[u.id] = u; });
  var dt = function (v) { return v ? Utilities.formatDate(new Date(v), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : ''; };
  var mem = (data.profiles || []).slice().sort(function (a, b) { return ko_(a.name || '', b.name || ''); });
  add('경성고_회원명단_' + todayStr.replace(/-/g, '') + '.xlsx', [['회원명단', [['이름', '승인', '상태', '관리자', '부서', '교과', '내선번호', '전화번호', '이메일', '담임', '담임반', '그룹', '구글 연동', '가입일', '최근 로그인']].concat(mem.map(function (m) {
    var a = au[m.id] || {}, prov = (a.app_metadata && a.app_metadata.providers) || a.providers || [];
    return [m.name || '', m.approved ? '승인' : '대기', m.is_active === false ? '비활성' : '활성', m.is_admin ? 'Y' : '', m.department || '', m.subject || '', m.extension || '', m.phone || '', m.email || a.email || '', m.is_homeroom ? 'Y' : '', m.homeroom_class || '', m.groups || '', String(prov).indexOf('google') >= 0 ? 'Y' : '', dt(a.created_at || m.created_at), dt(a.last_sign_in_at)];
  }))]]);
  // 설문 응답(설문마다 파일 하나, 설문 "엑셀로 받기"와 같은 모양)
  var svDir = null, resp = {};
  (data.public_survey_responses || []).forEach(function (r) { (resp[r.survey_id] = resp[r.survey_id] || []).push(r); });
  (data.public_surveys || []).forEach(function (sv) {
    var rs = sortBy_(resp[sv.id] || [], ['submitted_at']), qs = sv.questions || [];
    var head = ['제출시각']; if (sv.require_respondent_name) head.push('이름'); qs.forEach(function (q) { head.push(q.label); });
    var rows = [head].concat(rs.map(function (r) {
      var row = [dt(r.submitted_at)]; if (sv.require_respondent_name) row.push(r.respondent_name || '');
      qs.forEach(function (q) { var v = r.answers && r.answers[q.key]; row.push(q.type === 'file' ? (Array.isArray(v) ? v.map(function (f) { return f.name + ' (' + f.url + ')'; }).join('\n') : '') : (Array.isArray(v) ? v.join(', ') : (v || ''))); });
      return row;
    }));
    var sheets = [['응답', rows]], targets = Array.isArray(sv.target_names) ? sv.target_names : [];
    if (targets.length) { var done = {}; rs.forEach(function (r) { var n = String(r.respondent_name || '').trim(); if (n) done[n] = 1; }); sheets.push(['응답현황', [['이름', '응답 여부']].concat(targets.map(function (n) { return [n, done[n] ? '응답' : '미응답']; }))]); }
    svDir = svDir || folder_(dir, '설문');
    makeXlsx_(svDir, String(sv.title || '설문').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '_응답.xlsx', sheets);
    made.push('설문/' + sv.title);
  });
  // 참고 자료(올리는 곳 없음)
  add('기타자료_' + todayStr + '.xlsx', [
    ['시험 목록', [['시험', '기간', '주소', '숨김', '만든 때']].concat(sortBy_(data.exam_schedules || [], ['-created_at']).map(function (r) { return [r.title, r.period || '', r.href || '', r.hidden ? 'O' : '', dt(r.created_at)]; }))],
    ['공지사항', [['제목', '내용', '작성자', '시작', '끝']].concat(sortBy_(data.announcements || [], ['-starts_at']).map(function (r) { return [r.title, r.content || '', r.author_name || '', dt(r.starts_at), dt(r.ends_at)]; }))],
    ['학기 업무 흐름', [['달', '할 일', '내용', '시기', '담임 업무', '매월', '관련 서식', '안 씀']].concat(sortBy_(data.work_flow_items || [], ['yorder', 'sort']).map(function (r) { return [r.month, r.title, r.detail || '', r.timing || '', r.homeroom ? 'O' : '', r.monthly ? 'O' : '', r.form_hint || '', r.retired ? 'O' : '']; }))],
  ]);
  return made.length;
}
// 엑셀 백업만 따로 시험해 보기(표를 다시 받아서 엑셀 파일들만 만들어요)
function testExcelBackup() {
  var list = call_({ action: 'list' }), data = {};
  var pending = list.tables.map(function (t) { return { name: t.name, rows: [], offset: 0 }; });
  while (pending.length) {
    var batch = pending.splice(0, 10);
    callAll_(batch.map(function (b) { return { action: 'table', table: b.name, offset: b.offset }; })).forEach(function (j, i) {
      var b = batch[i]; b.rows = b.rows.concat(j.rows);
      if (j.next !== null && j.next !== undefined) { b.offset = j.next; pending.push(b); } else data[b.name] = b.rows;
    });
  }
  var root = folder_(DriveApp.getRootFolder(), FOLDER_NAME);
  var n = backupExcel_(data, root, Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd_HHmm'), list.auth_users);
  keepNewestFolders_(folder_(root, '엑셀'));
  Logger.log('엑셀 파일 ' + n + '개를 만들었어요.');
}
function keepNewestFolders_(folder) {
  var arr = [], it = folder.getFolders();
  while (it.hasNext()) { var f = it.next(); if (/^\d{4}-\d{2}-\d{2}_\d{4}$/.test(f.getName())) arr.push(f); }
  arr.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
  arr.slice(KEEP).forEach(function (f) { f.setTrashed(true); });
}

// 한 번만 실행: 매주 일요일 새벽 3~4시에 backupSupabase가 돌게 해요(이미 있으면 다시 만들지 않음)
function setupWeeklyTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'backupSupabase'; });
  if (!exists) ScriptApp.newTrigger('backupSupabase').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone('Asia/Seoul').create();
}
