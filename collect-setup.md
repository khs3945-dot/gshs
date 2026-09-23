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
// 나의 페이지 "이번주 주간 계획" 위젯이 읽어오는 폴더입니다. 이 스크립트를 배포한
// 구글 계정(담당 선생님) 드라이브 안의 폴더라서, 다른 선생님들은 각자 로그인/권한 없이도
// 여기서 목록을 받아볼 수 있어요(선생님 개인이 아니라 이 스크립트 소유자 권한으로 읽습니다).
var WEEKPLAN_FOLDER_ID = '11r6mVfRLjwemynozgv71puqyMjFquKq0';
// (선택) 주간계획 문서를 실제 AI로 요약하고 싶으면, 코드에 직접 적지 말고 Apps Script의
// "스크립트 속성"에 저장하세요(설치 방법 7번 참고). 코드에 그대로 적으면 이 파일을 다른
// 사람과 공유하거나 깃허브에 올릴 때 키가 같이 노출돼요. 속성이 비어있으면(기본값) AI
// 호출 없이 문서의 제목·글머리 기호 줄만 자동으로 뽑아 보여줍니다(비용 없음). 키를
// 넣어도 호출이 실패하면 자동으로 이 방식으로 전환됩니다.
function ks_getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '';
}

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
      case 'taskUploadFile': return jsonOut(actionTaskUploadFile(p));
      case 'listWeekPlanFiles': return jsonOut(actionListWeekPlanFiles(p));
      case 'summarizeTodayBrief': return jsonOut(actionSummarizeTodayBrief(p));
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

// ================= 할 일(my-todo.html) 첨부파일 =================
// 파일 수합함과 별개로, "할 일" 카드에서 첨부한 파일을 저장하는 용도입니다.
// 담당자 비밀번호 확인이 필요 없는 단순 업로드라 Supabase 조회 없이 바로 처리합니다.
function actionTaskUploadFile(p) {
  var folder = ks_getOrCreateFolder_(DriveApp.getRootFolder(), '경성고 업무 첨부파일');
  var bytes = Utilities.base64Decode(p.data);
  var blob = Utilities.newBlob(bytes, p.mimeType || 'application/octet-stream', p.name || 'file');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId(), name: file.getName(), url: file.getUrl() };
}

// ================= 이번주 주간 계획 (my-page.html) =================
// WEEKPLAN_FOLDER_ID 폴더 안의 문서/바로가기 목록을, 이 스크립트를 배포한 계정의
// 권한으로 대신 읽어서 돌려줍니다. 이렇게 하면 선생님 한 분(폴더 관리자)만 폴더에
// 문서/바로가기를 채워두면, 나머지 선생님들은 구글 로그인·권한 요청 없이도 목록을
// 볼 수 있어요. 실제 문서 미리보기는 여전히 각자의 구글 계정으로 여는 것이므로,
// 문서 자체가 학교 구성원에게 공유되어 있어야 내용까지 볼 수 있습니다.
function actionListWeekPlanFiles(p) {
  var folder = DriveApp.getFolderById(WEEKPLAN_FOLDER_ID);
  var it = folder.getFiles();
  var files = [];
  while (it.hasNext()) {
    var f = it.next();
    var target = f;
    var name = f.getName();
    if (f.getMimeType() === 'application/vnd.google-apps.shortcut') {
      try {
        target = DriveApp.getFileById(f.getTargetId());
        name = target.getName();
      } catch (e) {
        // 바로가기 대상에 접근할 수 없으면(원본 삭제 등) 바로가기 자체 정보로 대체
        target = f;
      }
    }
    files.push({
      id: target.getId(),
      name: name,
      mimeType: target.getMimeType(),
      modifiedTime: target.getLastUpdated().toISOString(),
      url: target.getUrl()
    });
  }
  files.sort(function (a, b) { return new Date(b.modifiedTime) - new Date(a.modifiedTime); });

  // 가장 최근 문서 하나만 "요점 미리보기"로 함께 내려줘요. 지원하지 않는 형식(PDF·시트·
  // 이미지 등)이거나 문서를 열 수 없으면 summary를 생략하고, my-page.html은 그럴 때
  // 기존 iframe 미리보기로 자연스럽게 대체합니다.
  if (files.length) {
    files[0].summary = ks_getCachedWeekPlanSummary_(files[0].id, files[0].mimeType, files[0].modifiedTime);
  }

  return { ok: true, files: files };
}

// 나의 페이지를 열 때마다(선생님이 몇 명이든, 몇 번을 새로고침하든) 매번 AI를 다시 부르면
// 무료 할당량이 금방 소진되고 페이지도 느려져요. 그래서 "최신 문서 id + 수정시각"을
// 캐시 키로 써서, 그 문서가 바뀌지 않는 한 한 번 만들어둔 요약을 계속 재사용해요.
// 새 문서가 올라오거나 같은 문서가 수정되면(=키가 달라짐) 그때만 다시 요약합니다.
function ks_getCachedWeekPlanSummary_(fileId, mimeType, modifiedTime) {
  var props = PropertiesService.getScriptProperties();
  // 캐시 키에 fileId+modifiedTime만 쓰면, 문서 내용이 그대로인 한 프롬프트(요약 방식)를
  // 바꿔도 예전에 만들어둔 요약이 계속 재사용돼서 "고쳤는데 반영이 안 된 것처럼" 보여요.
  // 요약 프롬프트를 바꿀 때마다 이 버전 숫자를 올려서, 예전 캐시를 건너뛰고 새로 요약하게
  // 합니다(v2: 날짜별·카테고리별 개요 형식으로 변경).
  var cacheKey = 'wpSummary_v2_' + fileId + '_' + modifiedTime;
  var cached = props.getProperty(cacheKey);
  if (cached !== null) return cached === '' ? null : cached; // 빈 문자열 = "확인해봤지만 요약 없음"

  var summary = ks_extractWeekPlanSummary_(fileId, mimeType);

  // 이전 문서 것으로 남아있던 캐시는 지워서 스크립트 속성 저장공간이 계속 쌓이지 않게 해요.
  var allProps = props.getProperties();
  Object.keys(allProps).forEach(function (k) {
    if (k.indexOf('wpSummary_') === 0 && k !== cacheKey) props.deleteProperty(k);
  });

  props.setProperty(cacheKey, summary || '');
  return summary;
}

// 요약은 세 단계로 시도해요.
// 1) AI 요약 키가 설정되어 있으면 실제 AI에게 문서 전체를 보내 요약을 받아요
//    (문서 중간·뒷부분에 중요한 내용이 있어도 잘 잡아냅니다).
// 2) AI 키가 없거나 호출이 실패하면, 문서의 "제목(헤딩 스타일)"과 "글머리 기호·번호 목록"
//    줄만 문서 전체에서 뽑아요 — 앞부분만 보는 게 아니라 문서 전체 구조를 훑기 때문에,
//    중요한 내용이 뒤쪽에 있어도 대부분 잡힙니다.
// 3) 그마저도(헤딩/목록이 전혀 없는 문서) 없으면 마지막 수단으로 앞부분 줄을 보여줘요.
function ks_extractWeekPlanSummary_(fileId, mimeType) {
  if (mimeType !== 'application/vnd.google-apps.document' && mimeType !== 'application/vnd.google-apps.presentation') {
    return null; // PDF·시트·이미지 등은 요약 없이 기존 iframe 미리보기만 사용
  }
  try {
    var fullText = ks_getFullText_(fileId, mimeType);
    if (!fullText || !fullText.trim()) return null;

    var apiKey = ks_getGeminiApiKey_();
    if (apiKey) {
      var aiSummary = ks_summarizeWithGemini_(fullText, apiKey);
      if (aiSummary) return aiSummary;
    }

    var outline = (mimeType === 'application/vnd.google-apps.document')
      ? ks_extractDocOutline_(fileId)
      : ks_extractSlidesOutline_(fileId);
    var picked = outline.length ? outline : fullText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    picked = picked.slice(0, 10);
    if (!picked.length) return null;
    var out = picked.join('\n');
    return out.length > 500 ? out.slice(0, 500) + '…' : out;
  } catch (e) {
    return null; // 권한 문제 등으로 열 수 없으면 조용히 생략(iframe 미리보기로 대체됨)
  }
}

function ks_getFullText_(fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.document') {
    return DocumentApp.openById(fileId).getBody().getText();
  }
  var parts = [];
  SlidesApp.openById(fileId).getSlides().forEach(function (slide) {
    slide.getShapes().forEach(function (shape) {
      if (shape.getText) {
        var t = shape.getText().asString();
        if (t) parts.push(t);
      }
    });
  });
  return parts.join('\n');
}

// Google 문서 전체를 훑으면서, 헤딩 스타일이 걸린 문단과 글머리 기호·번호 목록 줄만 뽑아요.
// 위치(앞/뒤)와 상관없이 문서 전체를 다 보기 때문에, 중요한 항목이 문서 뒤쪽에 있어도 잡혀요.
function ks_extractDocOutline_(fileId) {
  var body = DocumentApp.openById(fileId).getBody();
  var n = body.getNumChildren();
  var picked = [];
  for (var i = 0; i < n && picked.length < 14; i++) {
    var el = body.getChild(i);
    var type = el.getType();
    if (type === DocumentApp.ElementType.PARAGRAPH) {
      var p = el.asParagraph();
      var text = p.getText().trim();
      if (text && p.getHeading() !== DocumentApp.ParagraphHeading.NORMAL) picked.push(text);
    } else if (type === DocumentApp.ElementType.LIST_ITEM) {
      var text2 = el.asListItem().getText().trim();
      if (text2) picked.push('· ' + text2);
    }
  }
  return picked;
}

// Slides는 문단 헤딩 개념이 없어서, 각 슬라이드의 "제목" 플레이스홀더는 그대로, 나머지
// 텍스트 상자는 줄 단위로 글머리 기호를 붙여 모든 슬라이드에서 뽑아요.
function ks_extractSlidesOutline_(fileId) {
  var slides = SlidesApp.openById(fileId).getSlides();
  var picked = [];
  for (var i = 0; i < slides.length && picked.length < 14; i++) {
    var shapes = slides[i].getShapes();
    for (var j = 0; j < shapes.length; j++) {
      var shape = shapes[j];
      if (!shape.getText) continue;
      var text = shape.getText().asString().trim();
      if (!text) continue;
      var placeholderType = null;
      try { placeholderType = shape.getPlaceholderType(); } catch (e) { /* 플레이스홀더가 아니면 무시 */ }
      if (placeholderType === SlidesApp.PlaceholderType.TITLE || placeholderType === SlidesApp.PlaceholderType.CENTERED_TITLE) {
        picked.push(text);
      } else {
        text.split('\n').forEach(function (line) {
          line = line.trim();
          if (line) picked.push('· ' + line);
        });
      }
    }
  }
  return picked;
}

// 스크립트 속성에 GEMINI_API_KEY가 설정된 경우에만 호출돼요. 무료 등급 한도 초과·네트워크
// 오류 등으로 실패하면 null을 돌려주고, 호출부가 자동으로 구조 추출 방식으로 넘어갑니다.
function ks_summarizeWithGemini_(fullText, apiKey) {
  try {
    var truncated = fullText.length > 8000 ? fullText.slice(0, 8000) : fullText;
    var prompt = '다음은 학교 주간계획 문서입니다. 선생님들이 한눈에 파악할 수 있도록, ' +
      '문서 전체(앞부분뿐 아니라 중간·뒷부분도 포함)에서 핵심 일정과 유의사항을 아래 형식의 ' +
      '개요(outline)로 정리해주세요.\n\n' +
      '- 날짜(예: 9/23(수))가 있는 내용은 날짜가 빠른 순서대로, 날짜를 소제목 줄로 먼저 쓰고 ' +
      '그 아래에 그 날짜의 내용을 카테고리별로 묶어서 "  · 카테고리: 내용" 형식의 들여쓴 줄로 ' +
      '적어주세요(카테고리는 학사일정/수업/지도업무/행사/기타 등 문서 내용에 맞게 판단).\n' +
      '- 날짜가 명시되지 않은 공통 유의사항이나 전체 안내는 맨 앞에 "[공통]"이라는 소제목 줄을 ' +
      '만들고 그 아래에 같은 형식으로 적어주세요.\n' +
      '- 소제목 줄에는 다른 기호를 붙이지 말고 날짜 또는 [공통] 텍스트만 쓰고, 세부 항목 줄은 ' +
      '반드시 "  · "(공백 두 칸 + 가운뎃점)로 시작해주세요.\n' +
      '- 전체 세부 항목이 8~12개를 넘지 않게 간추리고, 다른 설명 없이 개요 내용만 작성해주세요.\n\n' + truncated;
    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + apiKey,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        muteHttpExceptions: true
      }
    );
    if (res.getResponseCode() !== 200) return null;
    var data = JSON.parse(res.getContentText());
    var text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    if (!text) return null;
    text = text.trim();
    // 개요식(날짜별·카테고리별)으로 정리하면 소제목 줄이 늘어나서 예전 5~8줄 요약보다
    // 글자 수가 더 필요해요. 600자였던 예전 한도를 900자로 늘렸습니다.
    return text.length > 900 ? text.slice(0, 900) + '…' : text;
  } catch (e) {
    return null;
  }
}

// ================= 오늘의 브리핑 (my-page.html) =================
// "오늘의 할 일" 카드 위에 보여줄 짧은 브리핑이에요. 브라우저가 이미 계산해둔 오늘의
// 지도 일정·수업·마감 할 일 목록을 텍스트로 보내주면, 그 내용을 자연스러운 문장으로
// 풀어서 설명해줘요. 선생님마다 내용이 다르니 "선생님 id + 날짜 + 항목 내용 해시"를
// 캐시 키로 써서, 같은 내용이면 하루 동안 재사용하고 할 일이 추가/완료되어 내용이
// 바뀌면 그때만 새로 생성합니다. AI 키가 없으면 조용히 생략해요(브라우저가 칸을 숨김).
function actionSummarizeTodayBrief(p) {
  var userId = String(p.userId || '').trim();
  var dateKey = String(p.dateKey || '').trim();
  var itemsText = String(p.itemsText || '').trim();
  if (!userId || !dateKey || !itemsText) return { ok: false, error: '입력이 올바르지 않습니다.' };

  var apiKey = ks_getGeminiApiKey_();
  if (!apiKey) return { ok: true, brief: null };

  var cacheKey = 'todayBrief_' + userId + '_' + dateKey + '_' + ks_hashText_(itemsText);
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty(cacheKey);
  if (cached !== null) return { ok: true, brief: cached === '' ? null : cached };

  var brief = ks_generateTodayBrief_(itemsText, apiKey);

  // 이 선생님의 이전 캐시(어제 것이거나 내용이 바뀌기 전 것)만 정리해요. 다른 선생님의
  // 캐시는 건드리지 않습니다(스크립트 속성은 이 앱을 쓰는 모든 선생님이 함께 쓰는 저장소).
  var prefix = 'todayBrief_' + userId + '_';
  var allProps = props.getProperties();
  Object.keys(allProps).forEach(function (k) {
    if (k.indexOf(prefix) === 0 && k !== cacheKey) props.deleteProperty(k);
  });

  props.setProperty(cacheKey, brief || '');
  return { ok: true, brief: brief };
}

function ks_generateTodayBrief_(itemsText, apiKey) {
  try {
    var prompt = '다음은 한 선생님의 오늘 지도 일정·수업·마감 할 일 목록입니다. 이 내용을 ' +
      '바탕으로 오늘 하루를 한눈에 파악할 수 있는 브리핑을 작성해주세요.\n\n' +
      '- 개인 비서가 아침에 브리핑하듯, 자연스럽게 이어지는 문장으로 3~4문장 정도로 써주세요.\n' +
      '- 목록을 그대로 나열하지 말고, 시간 순서나 중요도를 고려해서 설명해주세요.\n' +
      '- 마감이 임박했거나 놓치면 안 되는 항목이 있다면 강조해서 언급해주세요.\n' +
      '- 몇 교시에 무슨 수업이 있는지, 지도 업무가 있다면 함께 안내해주세요.\n' +
      '- 구체적인 시간·교시·할 일 제목처럼 실제 일정·할 일을 가리키는 표현은 **텍스트**처럼 ' +
      '별표 두 개로 감싸서 표시해주세요(마크다운 굵게 문법). 그 외 문장은 감싸지 마세요.\n' +
      '- 정중하고 친근한 존댓말로 작성하고, 다른 설명이나 머리말 없이 브리핑 내용만 작성해주세요.\n\n' +
      '오늘 항목:\n' + itemsText;
    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + apiKey,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        muteHttpExceptions: true
      }
    );
    if (res.getResponseCode() !== 200) return null;
    var data = JSON.parse(res.getContentText());
    var text = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    if (!text) return null;
    text = text.trim();
    return text.length > 680 ? text.slice(0, 680) + '…' : text;
  } catch (e) {
    return null;
  }
}

function ks_hashText_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    var v = (b + 256) % 256;
    var hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function ks_getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}
```

## 7. (선택) 주간계획 AI 요약 켜기

위 코드는 기본적으로 "주간계획" 폴더의 최신 문서에서 제목·글머리 기호 줄을 뽑아 요약처럼
보여줘요(비용 없음). 실제 AI가 요약하게 하려면:

1. [Google AI Studio](https://aistudio.google.com/apikey)에서 무료로 API 키를 발급받으세요.
2. Apps Script 편집기 왼쪽의 **⚙️ 프로젝트 설정**(톱니바퀴 아이콘) 클릭.
3. 아래로 스크롤해서 **스크립트 속성 → 스크립트 속성 추가**.
4. 이름에 `GEMINI_API_KEY`, 값에 발급받은 키를 붙여넣고 저장.

> 키를 `Code.gs` 코드 안에 직접 적지 말고 꼭 이 "스크립트 속성"에 넣어주세요. 코드 안에
> 적으면 이 저장소(GitHub)에 코드를 올리거나 다른 사람과 공유할 때 키가 같이 노출돼요.
> 스크립트 속성은 이 Apps Script 프로젝트 안에만 저장되고 코드와는 분리되어 있어서 안전해요.

키를 설정한 뒤에는 별도 재배포 없이 바로 적용돼요(스크립트 속성은 코드 배포와 무관하게
즉시 반영됩니다). 다만 코드 자체(`actionListWeekPlanFiles` 등)를 위 6번 내용으로 아직
안 바꾸셨다면, 코드부터 반영 후 **배포 → 배포 관리 → 수정 → 새 버전**으로 재배포해주세요.

요약은 "최신 문서 id + 수정시각"을 기준으로 스크립트 속성에 캐시돼요. 즉, 누가 나의
페이지를 몇 번을 열든 같은 문서면 다시 요약하지 않고 저장해둔 내용을 그대로 보여주고,
그 폴더에 더 최신 문서가 올라오거나 최신 문서가 수정되면 그때만 새로 요약해서 교체합니다.
