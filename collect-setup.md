# 파일 수합함 — Google Apps Script + Supabase 연동 안내

## 1. 무엇이 만들어지나요
- 새 페이지 `collect.html` 하나로 목록/생성/제출/담당자 관리를 모두 처리합니다.
- 역할이 두 곳으로 나뉘어 있어요.
  - **Supabase(데이터베이스)**: 수합함 목록, 제출자 명단, 담당자/제출자 비밀번호 확인 같은
    "정보"를 전부 관리합니다. 브라우저(collect.html)가 직접 호출합니다.
  - **Apps Script**: 파일 실물을 선생님의 구글 드라이브에 저장/삭제/압축(zip)하는 역할만
    합니다. 처음 호출되는 순간 파일이 쌓일 드라이브 폴더("경성고 파일 수합함")를 자동으로
    만듭니다 (미리 준비할 필요 없음). 수합함을 만들 때마다 이 폴더 안에 하위 폴더가 하나씩
    자동으로 생깁니다. 시트는 더 이상 쓰지 않습니다.
- 이렇게 나눈 이유: 대용량 파일은 계속 무료인 구글 드라이브에 두고, Supabase 무료 용량은
  텍스트/구조 데이터만 쓰도록 하기 위해서예요.

## 2. Apps Script 설치 방법
1. [script.google.com](https://script.google.com) 접속 → **새 프로젝트**.
2. 기본으로 열린 `Code.gs` 내용을 모두 지우고, 아래 6번 코드를 붙여넣습니다.
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

> 이미 예전 버전(시트 기반)으로 배포해두셨다면, 이번에는 URL을 재사용하지 말고 **새 배포**로
> 새 웹 앱 URL을 하나 발급받아 `collect.html`의 `SCRIPT_URL`에 반영하세요. 예전 시트 기반
> 데이터는 새 구조(Supabase)와 호환되지 않으므로, 기존에 실제로 쌓인 제출 데이터가 없다면
> 새로 시작하는 편이 간단합니다.

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
  (내부적으로 Apps Script가 드라이브 폴더를 먼저 만들고, 그 폴더 id를 Supabase의 `collections` 테이블에 저장합니다.)
- **제출**: 그 링크로 들어온 사람은 로그인 없이 이름(+학번 또는 선생님)/파일/메모/비밀번호 입력 후 제출.
  같은 이름(+학번)으로 같은 비밀번호를 입력하면 재제출(설정에 따라 덮어쓰기 또는 추가)로 인식되고,
  비밀번호가 다르면 본인 확인 실패로 막힙니다. (파일은 Apps Script가 드라이브에 저장하고,
  제출자 정보·메모·파일 목록은 Supabase에 기록됩니다.)
- **담당자 관리**: 수합함 상세 화면에서 "담당자이신가요?" 클릭 → 이름+비밀번호 확인(Supabase)
  후 제출자 명단·파일·메모 열람, 체크박스로 선택 다운로드 또는 전체 다운로드(zip), 수합함 설정
  수정/삭제 가능. 다운로드·삭제 같은 실제 파일 작업은 Apps Script가 Supabase에 담당자 비밀번호를
  다시 확인한 뒤 수행합니다.
- **양식 파일**: 수합함을 만들 때 예시/양식 파일을 함께 올려둘 수 있어요. 제출 화면에 "양식 파일" 다운로드
  칸이 따로 생기고(제출자는 이 파일을 받은 뒤 자기 파일을 올리면 됨), 담당자 관리 화면에서 나중에
  양식 파일을 추가하거나(파일 선택 후 저장) 삭제(체크 후 저장)할 수 있어요.
- **담당자 대시보드**: 담당자 인증 후 화면이 어두운 헤더의 대시보드로 바뀌어요. 링크 복사·열기·첨부
  ZIP·엑셀 받기(더보기 메뉴) 버튼, 제출자/학생/선생님 수 요약, 제출 목록·결과 분석·폼 편집 탭,
  제출 목록 정렬(제출 순/응답자별)을 제공합니다. 이 기능들은 모두 담당자 인증 때 이미 받아온
  제출자 데이터를 브라우저에서 가공만 하는 것입니다(엑셀 받기는 실제로는 한글이 깨지지 않는
  CSV 파일을 내려받는 방식이며, 엑셀에서 바로 열립니다).

## 5. 참고
- 드라이브 파일 소유자는 선생님 본인 계정이라, 선생님은 드라이브 앱에서 모든 폴더를 직접 볼 수 있습니다.
  (담당자 이름+비밀번호는 "사이트에서 관리 화면 접근"을 막는 잠금장치이지, 드라이브 자체의 소유 권한을 막지는 않습니다.)
- 전체 다운로드(zip)는 파일 개수가 많거나 용량이 크면 시간이 좀 걸릴 수 있어요. 대략 60개·개당 1MB 이하 정도는 무리 없이 처리됩니다.
- Apps Script는 Supabase에 접근할 때 공개용 anon 키(브라우저에도 그대로 노출되는 키)를 씁니다.
  이 앱은 학교 내부에서 가볍게 쓰는 도구라 실제 서비스 수준의 보안 모델은 아니며(예: 수합함 id를
  아는 사람이 이론적으로 직접 데이터베이스 함수를 호출할 수 있음), 비밀번호가 걸린 조회/수정
  기능은 전부 서버(Supabase 함수) 쪽에서 비밀번호 해시를 대조한 뒤에만 데이터를 내려주도록
  되어 있습니다.

## 6. Code.gs 코드

```javascript
/*
  경성고 교무 도구 — 파일 수합함(Collect Box) 백엔드 (드라이브 파일 저장 전용)
  ------------------------------------------------
  설치 방법은 collect-setup.md 를 참고하세요. 요약:
  1) script.google.com 에서 새 프로젝트 생성 → 이 파일 내용을 Code.gs 에 붙여넣기
  2) 배포 → 새 배포 → 웹 앱 → 실행 대상: 나 / 액세스 권한: 전체 허용
  3) 나온 웹 앱 URL을 collect.html 의 SCRIPT_URL 에 붙여넣기

  수합함 목록/제출자 명단/비밀번호 확인 같은 "정보"는 전부 Supabase(데이터베이스)에서
  처리합니다. 이 스크립트는 파일 실물을 구글 드라이브에 저장/삭제/압축하는 역할만 하고,
  담당자 비밀번호가 필요한 작업(파일 삭제/전체 폴더 삭제/zip 다운로드)은 그때그때
  Supabase에 다시 물어봐서 확인합니다. 처음 호출되면 파일이 쌓일 드라이브 폴더를
  자동으로 만들어서 스크립트 속성(PropertiesService)에 id를 저장해둡니다.
*/

var ROOT_FOLDER_NAME = '경성고 파일 수합함';
// Supabase 프로젝트 URL과 공개(anon) 키입니다. anon 키는 브라우저에도 그대로 노출되는
// 공개용 키라 여기 하드코딩해도 괜찮습니다(비밀키가 아닙니다).
var SUPABASE_URL = 'https://tmssupuskkajahpuswcj.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_g7j_5q6QSPfaYKHycDiU4w_oNZxJd4W';

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
      case 'createFolder': return jsonOut(actionCreateFolder(p));
      case 'uploadFiles': return jsonOut(actionUploadFiles(p));
      case 'trashSubmitterFiles': return jsonOut(actionTrashSubmitterFiles(p));
      case 'trashManagerFiles': return jsonOut(actionTrashManagerFiles(p));
      case 'trashFolder': return jsonOut(actionTrashFolder(p));
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

// ================= Supabase 호출 (비밀번호 확인은 전부 여기서) =================

function callSupabaseRpc(fnName, params) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify(params),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Supabase 호출 실패(' + fnName + '): ' + res.getContentText());
  }
  var text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

function verifyManager(collectionId, managerName, managerPassword) {
  return callSupabaseRpc('verify_manager', {
    p_collection_id: collectionId, p_manager_name: managerName, p_manager_password: managerPassword
  }) === true;
}

function verifySubmitter(collectionId, type, name, studentId, password) {
  return callSupabaseRpc('verify_submitter', {
    p_collection_id: collectionId, p_type: type, p_name: name, p_student_id: studentId, p_password: password
  }) === true;
}

function resolveFolderId(collectionId) {
  return callSupabaseRpc('resolve_folder_id', { p_collection_id: collectionId });
}

function resolveFolderIdForManager(collectionId, managerName, managerPassword) {
  return callSupabaseRpc('resolve_folder_id_for_manager', {
    p_collection_id: collectionId, p_manager_name: managerName, p_manager_password: managerPassword
  });
}

// ================= 드라이브 유틸 =================

function getOrCreateRootFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ROOT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* fall through */ }
  }
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

// files: [{name, mime, data(base64)}] → 드라이브 폴더에 저장하고 [{id,name,url}] 반환
function saveFilesToFolder(folder, files, namePrefix) {
  return files.map(function (f) {
    var blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.mime || 'application/octet-stream', f.name || 'file');
    var driveFile = folder.createFile(blob);
    driveFile.setName((namePrefix || '') + (f.name || driveFile.getName()));
    driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { id: driveFile.getId(), name: driveFile.getName(), url: 'https://drive.google.com/uc?export=download&id=' + driveFile.getId() };
  });
}

// ================= 액션 =================

// 새 수합함을 만들 때: 폴더를 먼저 만들고(+양식 파일 저장), folderId를 돌려줌.
// 브라우저는 이 결과를 받아서 Supabase의 create_collection() 함수를 호출해 저장함.
function actionCreateFolder(p) {
  var title = String(p.title || '수합함').trim();
  var root = getOrCreateRootFolder();
  var folder = root.createFolder(title.slice(0, 40) + '_' + Utilities.getUuid().slice(0, 8));
  var templateFiles = saveFilesToFolder(folder, p.templateFiles || [], '[양식] ');
  return { ok: true, folderId: folder.getId(), templateFiles: templateFiles };
}

// 제출/양식파일 추가 시 파일 업로드. collectionId만 받고, 실제 folderId는
// Supabase에 물어봐서 알아낸다(브라우저에는 folderId를 노출하지 않음).
function actionUploadFiles(p) {
  var folderId = resolveFolderId(p.collectionId);
  if (!folderId) return { ok: false, error: '존재하지 않는 수합함입니다.' };
  var folder = DriveApp.getFolderById(folderId);
  var saved = saveFilesToFolder(folder, p.files || [], p.namePrefix || '');
  return { ok: true, files: saved };
}

// 제출자 본인이 재제출(덮어쓰기)하면서 자기 이전 파일을 정리할 때.
// 본인 비밀번호가 맞을 때만 삭제한다.
function actionTrashSubmitterFiles(p) {
  if (!verifySubmitter(p.collectionId, p.type, p.name, p.studentId, p.password)) {
    return { ok: false, error: '본인 확인에 실패했습니다.' };
  }
  (p.fileIds || []).forEach(function (id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 이미 없으면 무시 */ }
  });
  return { ok: true };
}

// 담당자가 양식 파일을 삭제할 때.
function actionTrashManagerFiles(p) {
  if (!verifyManager(p.collectionId, p.managerName, p.managerPassword)) {
    return { ok: false, error: '담당자 이름 또는 비밀번호가 일치하지 않습니다.' };
  }
  (p.fileIds || []).forEach(function (id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 이미 없으면 무시 */ }
  });
  return { ok: true };
}

// 수합함 전체 삭제 시 드라이브 폴더까지 통째로 삭제.
function actionTrashFolder(p) {
  var folderId = resolveFolderIdForManager(p.collectionId, p.managerName, p.managerPassword);
  if (!folderId) return { ok: false, error: '담당자 이름 또는 비밀번호가 일치하지 않습니다.' };
  try { DriveApp.getFolderById(folderId).setTrashed(true); } catch (e) { /* 이미 없으면 무시 */ }
  return { ok: true };
}

// 선택/전체 다운로드(zip). fileIds는 브라우저가 이미 알고 있는 제출 파일 id 목록을 그대로 보낸다.
function actionZip(p) {
  var folderId = resolveFolderIdForManager(p.collectionId, p.managerName, p.managerPassword);
  if (!folderId) return { ok: false, error: '담당자 이름 또는 비밀번호가 일치하지 않습니다.' };
  var fileIds = p.fileIds || [];
  var blobs = [];
  fileIds.forEach(function (id) {
    try { blobs.push(DriveApp.getFileById(id).getBlob()); } catch (e) { /* 삭제된 파일은 건너뜀 */ }
  });
  if (!blobs.length) return { ok: false, error: '다운로드할 파일이 없습니다.' };

  var zipBlob = Utilities.zip(blobs, String(p.zipName || '제출파일').slice(0, 30) + '.zip');
  var folder = DriveApp.getFolderById(folderId);
  var zipFile = folder.createFile(zipBlob);
  zipFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: 'https://drive.google.com/uc?export=download&id=' + zipFile.getId() };
}
```
