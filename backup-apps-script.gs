/**
 * 경성고 교무 도구 — Supabase 자료를 구글 드라이브에 정기 백업 (설정 방법: BACKUP-SETUP.md)
 *
 * 하는 일(매주 한 번, 시간 트리거):
 *  1) Supabase Edge Function `db-backup`에서 public 표를 모두 받아 표마다 JSON 파일로 → 날짜 이름 zip 하나로 저장
 *     (가입 계정 목록 _auth_users.json, 받은 목록 _manifest.json 포함)
 *  2) Supabase 저장소(Storage) 파일은 "파일" 폴더에 그대로 복사 — 이미 있는 같은 크기 파일은 건너뛰어요(바뀐 것만)
 *  3) 사이트에서 엑셀로 받는 자료(명렬·시간표·일정·예약·예산·설문 등)를 한글 머리글 엑셀 한 파일로 → "엑셀" 폴더
 *     (시트마다 자료 하나 — 사람이 바로 열어 볼 수 있는 백업. 전체 원본은 1)의 zip)
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
    try { summary.excel = backupExcel_(data, root, stamp); }
    catch (ex) { summary.note += '엑셀 백업 실패: ' + String(ex && ex.message || ex).slice(0, 200) + '; '; }

    // 오래된 zip·엑셀 정리
    keepNewest_(root, /^supabase-.*\.zip$/);
    keepNewest_(folder_(root, '엑셀'), /^교무도구_엑셀_.*\.xlsx$/);
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

// ---------- 엑셀 백업: 사이트에서 엑셀로 받는 자료를 한글 머리글로 ----------
// cols: [칸 이름, 머리글] — 없는 칸은 비워요. sort: 정렬할 칸(앞에 - 면 내림차순)
var EXCEL_SHEETS = [
  { name: '학교 기본 정보', table: 'school_overview', sort: ['-year'], cols: [['year', '학년도'], ['school_no', '학교번호'], ['school_code', '학교코드'], ['nice_code', '나이스 코드'], ['phone', '전화'], ['fax', '팩스'], ['supervisor', '관할청'], ['grade1_count', '1학년 학생 수'], ['grade2_count', '2학년 학생 수'], ['grade3_count', '3학년 학생 수'], ['total_count', '전체 학생 수'], ['updated_at', '고친 때']] },
  { name: '학생 명렬', table: 'students', sort: ['-year', 'grade', 'class_no', 'no'], cols: [['year', '학년도'], ['grade', '학년'], ['class_no', '반'], ['no', '번호'], ['name', '이름'], ['note', '비고']] },
  { name: '반 편성', table: 'class_sections', sort: ['-year', 'grade', 'class_no'], cols: [['year', '학년도'], ['grade', '학년'], ['class_no', '반'], ['teacher_name', '담임'], ['co_teacher_name', '부담임'], ['student_count', '학생 수'], ['note', '비고']] },
  { name: '학사일정', table: 'academic_events', sort: ['-year', 'start_date'], cols: [['year', '학년도'], ['start_date', '시작일'], ['end_date', '끝일'], ['title', '일정'], ['grades', '대상 학년']] },
  { name: '교직원 명렬', table: 'staff', sort: ['department', 'name'], cols: [['name', '이름'], ['department', '부서'], ['subject', '교과'], ['extension', '내선'], ['homeroom', '담임'], ['co_homeroom', '부담임'], ['homeroom_room', '담임 교실'], ['hours', '시수'], ['groups', '그룹'], ['roles', '업무 역할'], ['updated_at', '고친 때']] },
  { name: '교사 시간표', special: 'staffSchedule' },
  { name: '교실 목록', table: 'rooms', sort: ['sort_order', 'name'], cols: [['name', '교실'], ['category', '분류'], ['sort_order', '순서']] },
  { name: '교실 예약', table: 'room_bookings', sort: ['-booking_date', 'start_time'], cols: [['booking_date', '날짜'], ['start_time', '시작'], ['end_time', '끝'], ['time_range', '교시'], ['room_name', '교실'], ['title', '내용'], ['teacher_name', '선생님']] },
  { name: '학생 지도 일정', table: 'duty_roster', sort: ['-duty_date', 'zone'], cols: [['duty_date', '날짜'], ['duty_time', '시간'], ['zone', '구역'], ['teacher_name', '선생님']] },
  { name: '학생 시간표', special: 'studentTimetable' },
  { name: '수강 배정', special: 'courses' },
  { name: '예산', table: 'budget_items', sort: ['-year', 'sort'], cols: [['year', '회계연도'], ['kind', '예산 종류'], ['project', '세부사업명'], ['area', '영역'], ['amount', '예산 금액'], ['note', '비고'], ['detail', '내역'], ['category', '구분'], ['owner_name', '담당']] },
  { name: '예산 사용 내역', table: 'budget_spends', sort: ['-year', 'kind', 'project', 'area', 'spend_date'], cols: [['year', '회계연도'], ['kind', '예산 종류'], ['project', '세부사업명'], ['area', '영역'], ['program', '분류'], ['spend_date', '날짜'], ['user_name', '사용자'], ['amount', '지출'], ['amount_expr', '계산식'], ['note', '비고'], ['detail', '내역'], ['planned', '예정']] },
  { name: '시험 목록', table: 'exam_schedules', sort: ['-created_at'], cols: [['title', '시험'], ['period', '기간'], ['href', '주소'], ['hidden', '숨김'], ['created_at', '만든 때']] },
  { name: '설문', table: 'public_surveys', sort: ['-created_at'], cols: [['title', '제목'], ['creator_name', '만든 사람'], ['opens_at', '여는 때'], ['closes_at', '마감'], ['is_closed', '닫힘'], ['target_names', '대상 명단'], ['description', '설명'], ['created_at', '만든 때']] },
  { name: '설문 응답', special: 'surveyResponses' },
  { name: '공지사항', table: 'announcements', sort: ['-starts_at'], cols: [['title', '제목'], ['content', '내용'], ['author_name', '작성자'], ['starts_at', '시작'], ['ends_at', '끝']] },
  { name: '회원', table: 'profiles', sort: ['name'], cols: [['name', '이름'], ['role', '구분'], ['department', '부서'], ['subject', '교과'], ['extension', '내선'], ['homeroom_class', '담임 반'], ['approved', '승인'], ['is_admin', '관리자'], ['is_active', '활동'], ['created_at', '가입한 때']] },
  { name: '학기 업무 흐름', table: 'work_flow_items', sort: ['yorder', 'sort'], cols: [['month', '달'], ['title', '할 일'], ['detail', '내용'], ['timing', '시기'], ['homeroom', '담임 업무'], ['monthly', '매월'], ['form_hint', '관련 서식'], ['retired', '안 씀']] },
];
var DAYS_ = ['월', '화', '수', '목', '금'], PERS_ = [1, 2, 3, 4, 5, 6, 7];

function cellText_(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'O';
  if (v === false) return '';
  if (Array.isArray(v)) v = v.map(function (x) { return typeof x === 'object' ? JSON.stringify(x) : x; }).join(', ');
  else if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'number') return v;
  var t = String(v);
  if (/^0\d[\d\-]*$/.test(t)) return "'" + t;   // 앞자리 0(전화·코드)이 숫자로 바뀌지 않게
  return t.length > 45000 ? t.slice(0, 45000) + '…' : t;   // 구글 시트 한 칸은 5만 자까지
}
function sortRows_(rows, keys) {
  return rows.slice().sort(function (a, b) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], desc = k.charAt(0) === '-'; if (desc) k = k.slice(1);
      var x = a[k], y = b[k]; if (x === y) continue;
      if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
      var c = x < y ? -1 : 1; return desc ? -c : c;
    }
    return 0;
  });
}
function excelSheet_(def, data) {
  if (def.special === 'staffSchedule') {
    var head = ['이름'].concat([].concat.apply([], DAYS_.map(function (d) { return PERS_.map(function (p) { return d + p; }); })));
    return [head].concat(sortRows_(data.staff || [], ['name']).filter(function (s) { return s.schedule; }).map(function (s) {
      return [s.name].concat([].concat.apply([], DAYS_.map(function (d) { return PERS_.map(function (p) { var x = (s.schedule[d] || {})[p]; return x && x.subject ? x.subject + (x.room ? ' (' + x.room + ')' : '') : ''; }); })));
    }));
  }
  if (def.special === 'studentTimetable' || def.special === 'courses') {
    var rows = sortRows_(data.student_timetables || [], ['-year', '-semester', 'grade', 'class_no', 'no']);
    if (def.special === 'courses') {
      var out = [['학년도', '학기', '학년', '반', '번호', '이름', '과목', '수강반']];
      rows.forEach(function (r) { (r.courses || []).forEach(function (c) { out.push([r.year, r.semester, r.grade, r.class_no, r.no, r.name, c.s, c.sec || '']); }); });
      return out;
    }
    var h = ['학년도', '학기', '학년', '반', '번호', '이름'].concat([].concat.apply([], DAYS_.map(function (d) { return PERS_.map(function (p) { return d + p; }); })), ['직접 고침']);
    return [h].concat(rows.filter(function (r) { return r.grid && Object.keys(r.grid).length; }).map(function (r) {
      return [r.year, r.semester, r.grade, r.class_no, r.no, r.name].concat([].concat.apply([], DAYS_.map(function (d) { return PERS_.map(function (p) { var x = (r.grid[d] || {})[p]; return x && x.s ? x.s + (x.sec || '') + (x.r ? ' (' + x.r + ')' : '') : ''; }); })), [r.manual ? 'O' : '']);
    }));
  }
  if (def.special === 'surveyResponses') {
    var title = {}; (data.public_surveys || []).forEach(function (sv) { title[sv.id] = sv.title; });
    return [['설문', '응답자', '제출한 때', '응답']].concat(sortRows_(data.public_survey_responses || [], ['survey_id', 'submitted_at']).map(function (r) {
      return [title[r.survey_id] || r.survey_id, r.respondent_name || '', r.submitted_at || '', cellText_(r.answers)];
    }));
  }
  var list = data[def.table];
  if (!list) return null;
  return [def.cols.map(function (c) { return c[1]; })].concat(sortRows_(list, def.sort || []).map(function (r) { return def.cols.map(function (c) { return cellText_(r[c[0]]); }); }));
}
function backupExcel_(data, root, stamp) {
  var ss = SpreadsheetApp.create('교무도구_엑셀_' + stamp), first = ss.getSheets()[0], made = 0;
  try {
    EXCEL_SHEETS.forEach(function (def) {
      var aoa = excelSheet_(def, data); if (!aoa) return;
      var w = aoa[0].length;
      aoa = aoa.map(function (r) { while (r.length < w) r.push(''); return r.slice(0, w).map(cellText_); });
      var sh = made === 0 ? first.setName(def.name) : ss.insertSheet(def.name);
      sh.getRange(1, 1, aoa.length, w).setValues(aoa);   // 금액은 숫자 그대로(엑셀에서 합계 가능)
      sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#EEF0FA');
      sh.setFrozenRows(1);
      made++;
    });
    SpreadsheetApp.flush();
    var res = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('엑셀로 바꾸지 못했어요(' + res.getResponseCode() + ')');
    folder_(root, '엑셀').createFile(res.getBlob().setName('교무도구_엑셀_' + stamp + '.xlsx'));
  } finally {
    DriveApp.getFileById(ss.getId()).setTrashed(true);   // 만드는 데 쓴 임시 구글 시트는 지워요
  }
  return made;
}
// 엑셀 백업만 따로 시험해 보기(표를 다시 받아서 엑셀 한 파일만 만들어요)
function testExcelBackup() {
  var list = call_({ action: 'list' }), data = {};
  var want = {}; EXCEL_SHEETS.forEach(function (d) { if (d.table) want[d.table] = 1; }); ['staff', 'student_timetables', 'public_surveys', 'public_survey_responses'].forEach(function (t) { want[t] = 1; });
  var pending = list.tables.filter(function (t) { return want[t.name]; }).map(function (t) { return { name: t.name, rows: [], offset: 0 }; });
  while (pending.length) {
    var batch = pending.splice(0, 10);
    callAll_(batch.map(function (b) { return { action: 'table', table: b.name, offset: b.offset }; })).forEach(function (j, i) {
      var b = batch[i]; b.rows = b.rows.concat(j.rows);
      if (j.next !== null && j.next !== undefined) { b.offset = j.next; pending.push(b); } else data[b.name] = b.rows;
    });
  }
  var n = backupExcel_(data, folder_(DriveApp.getRootFolder(), FOLDER_NAME), Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd_HHmm'));
  Logger.log('엑셀 시트 ' + n + '개를 만들었어요.');
}

// 한 번만 실행: 매주 일요일 새벽 3~4시에 backupSupabase가 돌게 해요(이미 있으면 다시 만들지 않음)
function setupWeeklyTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'backupSupabase'; });
  if (!exists) ScriptApp.newTrigger('backupSupabase').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).inTimezone('Asia/Seoul').create();
}
