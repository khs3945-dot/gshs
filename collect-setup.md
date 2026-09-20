# 파일 수합함 — Google Apps Script 연동 안내

## 1. 무엇이 만들어지나요
- 새 페이지 `collect.html` 하나로 목록/생성/제출/담당자 관리를 모두 처리합니다.
- 뒤에서 동작하는 건 **독립된 새 Apps Script 프로젝트** 하나입니다. 이 스크립트가
  처음 호출되는 순간 아래 두 가지를 자동으로 만듭니다 (미리 준비할 필요 없음):
  - 데이터를 저장할 새 스프레드시트("경성고 파일 수합함 데이터")
  - 파일이 쌓일 새 드라이브 폴더("경성고 파일 수합함") — 선생님 "내 드라이브"에 생깁니다.
- 수합함을 만들 때마다 이 폴더 안에 하위 폴더가 하나씩 자동으로 생깁니다.

## 2. Apps Script 설치 방법
1. [script.google.com](https://script.google.com) 접속 → **새 프로젝트**.
2. 기본으로 열린 `Code.gs` 내용을 모두 지우고, 아래 3번 코드를 붙여넣습니다.
3. 저장(Ctrl+S / Cmd+S). 프로젝트 이름은 원하는 대로 정해도 됩니다 (예: "경성고 파일 수합함").
4. 우측 상단 **배포 → 새 배포**.
5. 유형 선택에서 톱니바퀴 아이콘 → **웹 앱** 선택.
6. 설정:
   - 실행 대상: **나(본인 계정)**
   - 액세스 권한이 있는 사용자: **전체 허용(익명 사용자 포함)** ← 꼭 이걸 선택해야 링크로 들어온 사람이 로그인 없이 제출할 수 있어요.
7. **배포** 클릭 → 권한 승인(본인 구글 계정으로 승인, "안전하지 않음" 경고가 떠도 본인이 만든 스크립트이므로 계속 진행하면 됩니다) → 완료되면 **웹 앱 URL**이 나옵니다.
   (`https://script.google.com/macros/s/AKfycb.../exec` 형태)
8. 이 URL을 복사해서 `collect.html` 파일 안의 다음 줄을 교체하세요.
   ```
   const SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
   ```
9. 아무 수합함이나 하나 만들어보고, 제출까지 테스트해본 뒤 정상 작동하면 GitHub에 `collect.html`을 올리세요.

> 스크립트 코드를 나중에 수정하면, 배포 화면에서 **배포 관리 → 수정(연필 아이콘) → 새 버전**으로
> 다시 배포해야 웹페이지에 반영됩니다. (URL은 그대로 유지됩니다.)

## 3. 메뉴에 추가하기
메뉴는 이제 구글시트로 관리하니, `menu-editor.html`(메뉴 편집기)에 들어가서
**+ 항목 추가**로 아래처럼 한 줄 추가하고 저장하면 햄버거 메뉴에 바로 나타납니다.
- href: `./collect.html`
- 메뉴 이름: `파일 수합함`
- 필요하면 메인 화면 타일로도 노출할 수 있어요 (타일섹션/아이콘/타일제목/설명도 함께 채우면 됩니다).

## 4. 사용 흐름 요약
- **수합함 만들기**: 목록 화면(`collect.html`)에서 "+ 새 수합함 만들기" → 제목/설명/담당자 이름·비밀번호/마감/재제출 방식 입력 → 생성 즉시 링크 복사 버튼 제공.
- **제출**: 그 링크로 들어온 사람은 로그인 없이 이름(+학번 또는 선생님)/파일/메모/비밀번호 입력 후 제출.
  같은 이름(+학번)으로 같은 비밀번호를 입력하면 재제출(설정에 따라 덮어쓰기 또는 추가)로 인식되고,
  비밀번호가 다르면 본인 확인 실패로 막힙니다.
- **담당자 관리**: 수합함 상세 화면에서 "담당자이신가요?" 클릭 → 이름+비밀번호 확인 후 제출자 명단·파일·메모 열람,
  체크박스로 선택 다운로드 또는 전체 다운로드(zip), 수합함 설정 수정/삭제 가능.
- **양식 파일**: 수합함을 만들 때 예시/양식 파일을 함께 올려둘 수 있어요. 제출 화면에 "양식 파일" 다운로드
  칸이 따로 생기고(제출자는 이 파일을 받은 뒤 자기 파일을 올리면 됨), 담당자 관리 화면에서 나중에
  양식 파일을 추가하거나(파일 선택 후 저장) 삭제(체크 후 저장)할 수 있어요.
- **담당자 대시보드**: 담당자 인증 후 화면이 어두운 헤더의 대시보드로 바뀌어요. 링크 복사·열기·첨부
  ZIP·엑셀 받기(더보기 메뉴) 버튼, 제출자/학생/선생님 수 요약, 제출 목록·결과 분석·폼 편집 탭,
  제출 목록 정렬(제출 순/응답자별)을 제공합니다. 이 기능들은 모두 담당자 인증 때 이미 받아온
  제출자 데이터를 브라우저에서 가공만 하는 것이라, Code.gs는 그대로 두어도 됩니다(엑셀 받기는
  실제로는 한글이 깨지지 않는 CSV 파일을 내려받는 방식이며, 엑셀에서 바로 열립니다).

> 이미 예전 코드로 배포하셨다면, Code.gs 내용만 아래 최신 코드로 통째로 바꿔치기하고
> **새 버전으로 배포**만 하면 됩니다. 기존 시트/데이터는 그대로 유지되고, 없던 컬럼(양식 파일 정보)만
> 자동으로 추가돼요.

## 5. 참고
- 드라이브 파일 소유자는 선생님 본인 계정이라, 선생님은 드라이브 앱에서 모든 폴더를 직접 볼 수 있습니다.
  (담당자 이름+비밀번호는 "사이트에서 관리 화면 접근"을 막는 잠금장치이지, 드라이브 자체의 소유 권한을 막지는 않습니다.)
- 전체 다운로드(zip)는 파일 개수가 많거나 용량이 크면 시간이 좀 걸릴 수 있어요. 대략 60개·개당 1MB 이하 정도는 무리 없이 처리됩니다.

## 6. Code.gs 코드

```javascript
/*
  경성고 교무 도구 — 파일 수합함(Collect Box) 백엔드
  ------------------------------------------------
  설치 방법은 collect-setup.md 를 참고하세요. 요약:
  1) script.google.com 에서 새 프로젝트 생성 → 이 파일 내용을 Code.gs 에 붙여넣기
  2) 배포 → 새 배포 → 웹 앱 → 실행 대상: 나 / 액세스 권한: 전체 허용
  3) 나온 웹 앱 URL을 collect.html 의 SCRIPT_URL 에 붙여넣기

  이 스크립트가 처음 호출되면 스프레드시트와 드라이브 폴더를 자동으로 만들어서
  스크립트 속성(PropertiesService)에 ID를 저장해둡니다. 사람이 미리 시트나 폴더를
  만들어둘 필요가 없습니다.
*/

var ROOT_FOLDER_NAME = '경성고 파일 수합함';
var SPREADSHEET_NAME = '경성고 파일 수합함 데이터';
var COLLECTIONS_SHEET = 'Collections';
var SUBMISSIONS_SHEET = 'Submissions';

var COLLECTIONS_HEADER = ['id', 'title', 'description', 'managerName', 'managerHash', 'managerSalt',
  'deadline', 'resubmitMode', 'folderId', 'createdAt', 'updatedAt', 'deleted', 'templateFilesJson'];
var SUBMISSIONS_HEADER = ['collectionId', 'submitterKey', 'name', 'type', 'studentId',
  'passwordHash', 'salt', 'note', 'filesJson', 'firstSubmittedAt', 'updatedAt'];

// ================= 진입점 =================

function doGet(e) {
  return handle(e.parameter || {});
}

function doPost(e) {
  var params = {};
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: '요청 형식이 올바르지 않습니다.' });
  }
  return handle(params);
}

function handle(p) {
  try {
    var action = p.action || '';
    switch (action) {
      case 'list': return jsonOut(actionList());
      case 'get': return jsonOut(actionGet(p));
      case 'create': return jsonOut(actionCreate(p));
      case 'submit': return jsonOut(actionSubmit(p));
      case 'submitterAuth': return jsonOut(actionSubmitterAuth(p));
      case 'managerAuth': return jsonOut(actionManagerAuth(p));
      case 'update': return jsonOut(actionUpdate(p));
      case 'delete': return jsonOut(actionDelete(p));
      case 'zip': return jsonOut(actionZip(p));
      default: return jsonOut({ ok: false, error: '알 수 없는 요청입니다.' });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: '서버 오류: ' + err.message });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ================= 초기 설정(자동 생성) =================

function getProps() { return PropertiesService.getScriptProperties(); }

function getOrCreateSpreadsheet() {
  var props = getProps();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  return ss;
}

function getOrCreateRootFolder() {
  var props = getProps();
  var id = props.getProperty('ROOT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* fall through */ }
  }
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getSheet(name, header) {
  var ss = getOrCreateSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
  } else {
    // 나중에 컬럼이 추가된 경우 기존 데이터는 그대로 두고 없는 컬럼만 뒤에 붙여줌
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var missing = header.filter(function (h) { return existing.indexOf(h) === -1; });
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
  }
  // 기본으로 생기는 '시트1'은 비어있으면 정리
  var def = ss.getSheetByName('시트1');
  if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (e) {} }
  return sheet;
}

function colIndex(sheet, name) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return header.indexOf(name) + 1;
}

// files: [{name, mime, data(base64)}] → 드라이브 폴더에 저장하고 [{id,name,url}] 반환
function saveFilesToFolder(folder, files, namePrefix) {
  return files.map(function (f) {
    var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mime || 'application/octet-stream', f.name || 'file');
    var driveFile = folder.createFile(blob);
    driveFile.setName(namePrefix + (f.name || driveFile.getName()));
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { id: driveFile.getId(), name: driveFile.getName(), url: 'https://drive.google.com/uc?export=download&id=' + driveFile.getId() };
  });
}

function getCollectionsSheet() { return getSheet(COLLECTIONS_SHEET, COLLECTIONS_HEADER); }
function getSubmissionsSheet() { return getSheet(SUBMISSIONS_SHEET, SUBMISSIONS_HEADER); }

// ================= 유틸 =================

function makeId() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function hashPw(pw, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pw) + '|' + String(salt));
  return raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function sheetToObjects(sheet) {
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var rows = values.slice(1);
  return rows.map(function (row, idx) {
    var obj = { _row: idx + 2 }; // 실제 시트 행 번호(1-base, 헤더 포함)
    header.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findCollection(id) {
  var sheet = getCollectionsSheet();
  var rows = sheetToObjects(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id) && String(rows[i].deleted) !== 'Y') {
      return { sheet: sheet, row: rows[i] };
    }
  }
  return null;
}

function checkManager(row, managerName, managerPassword) {
  if (String(row.managerName).trim() !== String(managerName).trim()) return false;
  return hashPw(managerPassword, row.managerSalt) === row.managerHash;
}

function submitterKeyOf(type, name, studentId) {
  name = String(name).trim();
  if (type === '학생') return '학생|' + name + '|' + String(studentId).trim();
  return '선생님|' + name;
}

// ================= 액션: 목록/조회 =================

function actionList() {
  var rows = sheetToObjects(getCollectionsSheet());
  var list = rows.filter(function (r) { return String(r.deleted) !== 'Y'; }).map(function (r) {
    return {
      id: r.id, title: r.title, description: r.description,
      managerName: r.managerName, deadline: r.deadline, createdAt: r.createdAt
    };
  });
  list.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  return { ok: true, items: list };
}

function actionGet(p) {
  var found = findCollection(p.id);
  if (!found) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  var r = found.row;
  return {
    ok: true, item: {
      id: r.id, title: r.title, description: r.description,
      managerName: r.managerName, deadline: r.deadline,
      resubmitMode: r.resubmitMode, closed: isPast(r.deadline),
      templateFiles: JSON.parse(r.templateFilesJson || '[]')
    }
  };
}

function isPast(deadlineIso) {
  if (!deadlineIso) return false;
  return new Date(deadlineIso).getTime() < Date.now();
}

// ================= 액션: 생성/수정/삭제 =================

function actionCreate(p) {
  var title = String(p.title || '').trim();
  var managerName = String(p.managerName || '').trim();
  var managerPassword = String(p.managerPassword || '');
  if (!title) return { ok: false, error: '제목을 입력해주세요.' };
  if (!managerName || !managerPassword) return { ok: false, error: '담당자 이름과 비밀번호를 입력해주세요.' };

  var id = makeId();
  var root = getOrCreateRootFolder();
  var folder = root.createFolder(title.slice(0, 40) + '_' + id);
  var salt = Utilities.getUuid();
  var now = new Date().toISOString();
  var templateFiles = saveFilesToFolder(folder, p.templateFiles || [], '[양식] ');

  getCollectionsSheet().appendRow([
    id, title, String(p.description || ''), managerName, hashPw(managerPassword, salt), salt,
    String(p.deadline || ''), (p.resubmitMode === 'overwrite' ? 'overwrite' : 'append'),
    folder.getId(), now, now, 'N', JSON.stringify(templateFiles)
  ]);

  return { ok: true, id: id };
}

function actionUpdate(p) {
  var found = findCollection(p.id);
  if (!found) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  if (!checkManager(found.row, p.managerName, p.managerPassword)) {
    return { ok: false, error: '담당자 이름 또는 비밀번호가 일치하지 않습니다.' };
  }
  var sheet = found.sheet;
  var row = found.row._row;
  function setCol(name, val) { sheet.getRange(row, colIndex(sheet, name)).setValue(val); }
  if (p.title !== undefined) setCol('title', String(p.title).trim());
  if (p.description !== undefined) setCol('description', String(p.description));
  if (p.deadline !== undefined) setCol('deadline', String(p.deadline));
  if (p.resubmitMode !== undefined) setCol('resubmitMode', p.resubmitMode === 'overwrite' ? 'overwrite' : 'append');

  if ((p.removeTemplateFileIds && p.removeTemplateFileIds.length) || (p.newTemplateFiles && p.newTemplateFiles.length)) {
    var templateFiles = JSON.parse(found.row.templateFilesJson || '[]');
    var removeIds = p.removeTemplateFileIds || [];
    if (removeIds.length) {
      templateFiles = templateFiles.filter(function (f) {
        if (removeIds.indexOf(f.id) === -1) return true;
        try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e) {}
        return false;
      });
    }
    if (p.newTemplateFiles && p.newTemplateFiles.length) {
      var folder = DriveApp.getFolderById(found.row.folderId);
      templateFiles = templateFiles.concat(saveFilesToFolder(folder, p.newTemplateFiles, '[양식] '));
    }
    setCol('templateFilesJson', JSON.stringify(templateFiles));
  }

  setCol('updatedAt', new Date().toISOString());
  return { ok: true };
}

function actionDelete(p) {
  var found = findCollection(p.id);
  if (!found) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  if (!checkManager(found.row, p.managerName, p.managerPassword)) {
    return { ok: false, error: '담당자 이름 또는 비밀번호가 일치하지 않습니다.' };
  }
  try {
    var folder = DriveApp.getFolderById(found.row.folderId);
    folder.setTrashed(true);
  } catch (e) { /* 폴더가 이미 없어도 무시 */ }
  found.sheet.getRange(found.row._row, colIndex(found.sheet, 'deleted')).setValue('Y');
  return { ok: true };
}

// ================= 액션: 제출자 관련 =================

function actionSubmit(p) {
  var found = findCollection(p.id);
  if (!found) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  var col = found.row;
  if (isPast(col.deadline)) return { ok: false, error: '마감 시간이 지나 더 이상 제출할 수 없습니다.' };

  var type = (p.type === '학생') ? '학생' : '선생님';
  var name = String(p.name || '').trim();
  var studentId = String(p.studentId || '').trim();
  if (!name) return { ok: false, error: '이름을 입력해주세요.' };
  if (type === '학생' && !studentId) return { ok: false, error: '학번을 입력해주세요.' };
  var password = String(p.password || '');
  if (!password) return { ok: false, error: '비밀번호를 입력해주세요.' };
  var files = p.files || [];
  if (!files.length) return { ok: false, error: '파일을 첨부해주세요.' };

  var key = submitterKeyOf(type, name, studentId);
  var subSheet = getSubmissionsSheet();
  var subs = sheetToObjects(subSheet);
  var existing = null;
  for (var i = 0; i < subs.length; i++) {
    if (String(subs[i].collectionId) === String(col.id) && subs[i].submitterKey === key) { existing = subs[i]; break; }
  }

  var salt, passHash, prevFiles;
  if (existing) {
    if (hashPw(password, existing.salt) !== existing.passwordHash) {
      return { ok: false, error: '이미 같은 이름으로 제출된 기록이 있는데 비밀번호가 일치하지 않습니다. 본인이 맞다면 이전에 쓰신 비밀번호를 입력해주세요.' };
    }
    salt = existing.salt; passHash = existing.passwordHash;
    prevFiles = JSON.parse(existing.filesJson || '[]');
  } else {
    salt = Utilities.getUuid(); passHash = hashPw(password, salt); prevFiles = [];
  }

  var folder = DriveApp.getFolderById(col.folderId);
  var mode = String(col.resubmitMode) === 'overwrite' ? 'overwrite' : 'append';

  if (mode === 'overwrite' && prevFiles.length) {
    prevFiles.forEach(function (f) {
      try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e) {}
    });
    prevFiles = [];
  }

  var savedFiles = saveFilesToFolder(folder, files, '[' + name + '] ');

  var allFiles = prevFiles.concat(savedFiles);
  var now = new Date().toISOString();

  if (existing) {
    var r = existing._row;
    subSheet.getRange(r, colIndex(subSheet, 'note')).setValue(String(p.note || ''));
    subSheet.getRange(r, colIndex(subSheet, 'filesJson')).setValue(JSON.stringify(allFiles));
    subSheet.getRange(r, colIndex(subSheet, 'updatedAt')).setValue(now);
  } else {
    subSheet.appendRow([col.id, key, name, type, studentId, passHash, salt, String(p.note || ''), JSON.stringify(allFiles), now, now]);
  }

  return { ok: true, fileCount: allFiles.length };
}

function actionSubmitterAuth(p) {
  var found = findCollection(p.id);
  if (!found) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  var type = (p.type === '학생') ? '학생' : '선생님';
  var key = submitterKeyOf(type, p.name, p.studentId);
  var subs = sheetToObjects(getSubmissionsSheet());
  for (var i = 0; i < subs.length; i++) {
    var s = subs[i];
    if (String(s.collectionId) === String(p.id) && s.submitterKey === key) {
      if (hashPw(p.password, s.salt) !== s.passwordHash) return { ok: false, error: '비밀번호가 일치하지 않습니다.' };
      return {
        ok: true, submission: {
          name: s.name, type: s.type, studentId: s.studentId, note: s.note,
          files: JSON.parse(s.filesJson || '[]'), updatedAt: s.updatedAt
        }
      };
    }
  }
  return { ok: false, error: '제출 기록을 찾을 수 없습니다.' };
}

// ================= 액션: 담당자 관리 =================

function actionManagerAuth(p) {
  var found = findCollection(p.id);
  if (!found) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  if (!checkManager(found.row, p.managerName, p.managerPassword)) {
    return { ok: false, error: '담당자 이름 또는 비밀번호가 일치하지 않습니다.' };
  }
  var col = found.row;
  var subs = sheetToObjects(getSubmissionsSheet()).filter(function (s) { return String(s.collectionId) === String(col.id); });
  var submitters = subs.map(function (s) {
    return {
      name: s.name, type: s.type, studentId: s.studentId, note: s.note,
      files: JSON.parse(s.filesJson || '[]'), firstSubmittedAt: s.firstSubmittedAt, updatedAt: s.updatedAt
    };
  });
  submitters.sort(function (a, b) { return new Date(a.firstSubmittedAt) - new Date(b.firstSubmittedAt); });
  return {
    ok: true,
    collection: {
      id: col.id, title: col.title, description: col.description, deadline: col.deadline,
      resubmitMode: col.resubmitMode, createdAt: col.createdAt,
      templateFiles: JSON.parse(col.templateFilesJson || '[]')
    },
    submitters: submitters
  };
}

function actionZip(p) {
  var found = findCollection(p.id);
  if (!found) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  if (!checkManager(found.row, p.managerName, p.managerPassword)) {
    return { ok: false, error: '담당자 이름 또는 비밀번호가 일치하지 않습니다.' };
  }
  var fileIds = p.fileIds || null; // null/빈배열이면 전체
  var subs = sheetToObjects(getSubmissionsSheet()).filter(function (s) { return String(s.collectionId) === String(p.id); });
  var blobs = [];
  subs.forEach(function (s) {
    var files = JSON.parse(s.filesJson || '[]');
    files.forEach(function (f) {
      if (fileIds && fileIds.length && fileIds.indexOf(f.id) === -1) return;
      try { blobs.push(DriveApp.getFileById(f.id).getBlob()); } catch (e) { /* 삭제된 파일은 건너뜀 */ }
    });
  });
  if (!blobs.length) return { ok: false, error: '다운로드할 파일이 없습니다.' };

  var zipBlob = Utilities.zip(blobs, found.row.title.slice(0, 30) + '.zip');
  var folder = DriveApp.getFolderById(found.row.folderId);
  var zipFile = folder.createFile(zipBlob);
  zipFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: 'https://drive.google.com/uc?export=download&id=' + zipFile.getId() };
}

```
