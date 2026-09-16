# 교실 사용 신청 — Google Apps Script 연동 안내

## 1. 무엇이 만들어지나요
- 기존 "교실 사용 일정" 시트(https://docs.google.com/spreadsheets/d/1iMAfIMc_4BLWTeYmIaiz_di6_xpJMWlDIlw-6myGNS8)는
  달마다 방/날짜가 표처럼 짜여 있는 수기 관리용 표라서, 웹 폼에서 온 신청을 그 표의 특정 칸에
  자동으로 끼워 넣기는 어렵습니다 (병합된 셀, 달마다 다른 시트 구조 때문).
- 대신 같은 스프레드시트 안에 **"웹 신청 접수"라는 새 탭**을 만들고, 폼 제출이 올 때마다
  그 탭에 한 줄씩 기록되도록 했습니다. 신청 내용을 확인한 뒤 필요하면 기존 달력 표에는
  수동으로 옮겨 적으시면 됩니다 (또는 나중에 이 부분도 자동화를 원하시면 말씀해주세요).

## 2. Apps Script 설치 방법
1. "교실 사용 일정" 스프레드시트를 엽니다.
2. 상단 메뉴 **확장 프로그램 → Apps Script** 클릭.
3. 기본으로 열린 `Code.gs` 파일 내용을 모두 지우고, 아래 코드를 붙여넣습니다.
4. 저장(Ctrl+S / Cmd+S).
5. 우측 상단 **배포 → 새 배포**.
6. 유형 선택에서 톱니바퀴 아이콘 → **웹 앱** 선택.
7. 설정:
   - 실행 대상: **나(본인 계정)**
   - 액세스 권한이 있는 사용자: **전체 허용(익명 사용자 포함)** ← 이걸 선택해야 웹페이지에서 호출 가능
8. **배포** 클릭 → 권한 승인(본인 구글 계정으로 승인) → 완료되면 **웹 앱 URL**이 나옵니다.
   (`https://script.google.com/macros/s/AKfycb.../exec` 형태)
9. 이 URL을 복사해서 `room-request.html` 파일 안의 다음 줄을 교체하세요.
   ```
   const SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
   ```

> 스크립트나 시트 내용을 나중에 수정하면, 배포 화면에서 **배포 관리 → 수정(연필 아이콘) → 새 버전**으로
> 다시 배포해야 웹페이지에 반영됩니다. (URL은 그대로 유지됩니다.)

## 3. Code.gs 코드

```javascript
// 신청 내용이 기록될 탭 이름 (없으면 자동 생성)
const SHEET_NAME = '웹 신청 접수';
// 로그인 게이트와 동일한 허용 도메인 (auth.js의 ALLOWED_DOMAIN과 맞춰주세요)
const ALLOWED_DOMAIN = 'senedu.kr';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 이메일 도메인 서버 측 재확인 (클라이언트 우회 방지)
    const email = (data.applicantEmail || '').toLowerCase();
    const domain = email.split('@')[1] || '';
    if (email && domain !== ALLOWED_DOMAIN.toLowerCase()) {
      return jsonResponse({ result: 'error', message: '학교 계정으로 인증되지 않은 요청입니다.' });
    }

    const sheet = getOrCreateSheet();
    sheet.appendRow([
      new Date(),               // 제출 시각
      data.applicantName || '',
      data.applicantEmail || '',
      data.date || '',
      data.start || '',
      data.end || '',
      data.room || '',
      data.purpose || '',
      data.note || ''
    ]);

    return jsonResponse({ result: 'ok' });
  } catch (err) {
    return jsonResponse({ result: 'error', message: err.message });
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['제출시각', '신청자', '이메일', '사용날짜', '시작', '종료', '교실', '목적', '참고사항']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 4. 확인해주셔야 할 점
- 지금은 사이트 로그인이 잠시 꺼져 있어요(`auth.js`의 `AUTH_ENABLED = false`). 이 상태에서는 신청자가 이메일 없이
  이름만 입력해 제출하므로, 위 스크립트는 이메일이 비어있으면 도메인 검사를 건너뛰도록 되어 있어요. 나중에
  로그인을 다시 켜면 이메일이 채워지니 검사도 다시 정상 작동합니다.
- `auth.js`의 `ALLOWED_DOMAIN`과 이 스크립트의 `ALLOWED_DOMAIN`이 반드시 같은 값(`senedu.kr`)이어야
  합니다. 실제 선생님 계정 도메인이 다르면 두 곳 모두 고쳐주세요.
- 배포 시 "액세스 권한이 있는 사용자"를 **전체 허용**으로 하지 않으면 웹페이지에서 호출할 때
  403 오류가 납니다. (사이트 자체는 구글 로그인으로 이미 막혀 있고, 서버 쪽에서도 이메일 도메인을
  한 번 더 검사하니 실제로는 학교 계정 사용자만 기록을 남길 수 있습니다.)
