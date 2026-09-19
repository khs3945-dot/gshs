// 시트 첫 행: 카테고리 | 이름 | 링크 | 설명 | 등록일 | ID | 메인노출
//
// 기존 스크립트에 G열(메인노출, Y/N)과 수정(update) 기능을 추가한 버전입니다.
// 적용 방법:
//   1. script.google.com에서 업무 링크 모음(link-hub.html)이 쓰는 프로젝트를 엽니다.
//   2. 기존 코드를 전부 지우고 이 파일 내용으로 통째로 바꿔치기합니다.
//   3. 저장 후 "배포 → 배포 관리"에서 기존 웹 앱 배포를 "편집"하고 "새 버전"으로 배포합니다.
//      (배포 URL은 그대로 유지되니 link-hub.html / index.html 쪽 SCRIPT_URL은 안 고쳐도 됩니다.)
//   4. 시트 G1 셀에 "메인노출"이라고 헤더를 적어두면 보기 편해요(코드 동작에는 영향 없음).
//
// 아래 SHEET_ID를 실제 시트 ID로 바꿔주세요.
// 시트 주소가 https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlmNoP.../edit 라면
// 'd/' 와 '/edit' 사이의 1AbCdEfGhIjKlmNoP... 부분이 ID예요.
const SHEET_ID = '1mFbetFBNB24MYl1lisbdq9-d46mXVNE1WKnX3CCLZr0';

function getSheet_() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
}

function doGet(e) {
  const rows = getSheet_().getDataRange().getValues();
  rows.shift(); // 헤더 제거
  const data = rows
    .filter(r => r[0] && r[1] && r[2])
    .map(r => ({
      category: String(r[0]),
      name: String(r[1]),
      url: String(r[2]),
      desc: String(r[3] || ''),
      id: String(r[5] || ''),
      mainShow: String(r[6] || '').trim().toUpperCase() === 'Y'
    }));
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data.action === 'delete') {
    return handleDelete_(data.id);
  }
  if (data.action === 'setMainShow') {
    return handleSetMainShow_(data.id, !!data.mainShow);
  }
  if (data.action === 'update') {
    return handleUpdate_(data.id, data);
  }
  return handleAdd_(data);
}

function handleAdd_(data) {
  const category = String(data.category || '').trim();
  const name = String(data.name || '').trim();
  const url = String(data.url || '').trim();
  const desc = String(data.desc || '').trim();
  const mainShow = !!data.mainShow;

  if (!category || !name || !url) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '카테고리·이름·링크는 필수입니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const id = Utilities.getUuid();
  getSheet_().appendRow([category, name, url, desc, new Date(), id, mainShow ? 'Y' : 'N']);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, id }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleDelete_(id) {
  if (!id) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'id가 없습니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][5]) === id) {
      sheet.deleteRow(i + 1); // 시트는 1행부터 시작 + 헤더 1행
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '해당 링크를 찾지 못했습니다.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleUpdate_(id, data) {
  if (!id) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'id가 없습니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const category = String(data.category || '').trim();
  const name = String(data.name || '').trim();
  const url = String(data.url || '').trim();
  const desc = String(data.desc || '').trim();

  if (!category || !name || !url) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '카테고리·이름·링크는 필수입니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][5]) === id) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([[category, name, url, desc]]); // A~D열
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '해당 링크를 찾지 못했습니다.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleSetMainShow_(id, mainShow) {
  if (!id) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'id가 없습니다.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][5]) === id) {
      sheet.getRange(i + 1, 7).setValue(mainShow ? 'Y' : 'N'); // G열 = 7번째 열
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '해당 링크를 찾지 못했습니다.' }))
    .setMimeType(ContentService.MimeType.JSON);
}
