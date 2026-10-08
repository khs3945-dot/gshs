# 교실 예약 — "학교 공용 캘린더에 추가" 설정

`room-booking.html`에서 예약을 만든 뒤 "📅 학교 공용 캘린더에도 추가" 버튼을 누르면,
그 예약을 학사일정 구글 캘린더에도 일정으로 등록해줍니다. 이 기능은 예약 생성/조회
(Supabase)와는 완전히 분리된 선택적 기능이라, 설정하지 않아도 교실 예약 자체는
정상적으로 동작합니다.

## 왜 별도 Apps Script가 필요한가

이 기능은 구글 캘린더에 **쓰기**(일정 생성)가 필요한데, `date.html`/`room-booking.html`이
읽기에 쓰는 `GCAL_API_KEY`는 `events.list`만 되는 공개 읽기 전용 키라 쓰기를 할 수
없습니다. 그래서 `collect.html`/`file-library.html`과 같은 공용 Apps Script 배포를
처음에 재사용해봤지만, 학교 Workspace **조직 계정**으로 배포된 그 스크립트가 Calendar
API 범위(scope) 자체를 조직 관리자 정책(API 액세스 제어, 또는 조직 외부 캘린더 공유
제한)에 막혀 있는 경우가 흔합니다 — 특히 대상 캘린더의 소유자가 조직 바깥의 **개인
계정**이면 더 그렇습니다. 그 공용 스크립트의 소유권 자체를 옮기는 건 파일 수합함/
자료실까지 전부 같이 위험해지므로, **이 기능 하나만 쓰는 완전히 독립된 Apps Script
프로젝트**를 (조직 정책의 영향을 받지 않는) **개인 구글 계정**으로 새로 만들어
분리했습니다 — `link-hub.html`이 이미 자기만의 별도 Apps Script 배포를 쓰는 것과
같은 패턴입니다.

## 1. 새 Apps Script 프로젝트 만들기 (개인 계정으로)

1. 학사일정 캘린더에 **편집 권한**이 있는 구글 계정(이상적으로는 그 캘린더의 소유자
   계정, 또는 최소한 조직 Workspace가 아닌 개인 계정)으로 로그인한 상태에서
   https://script.google.com 접속 → **새 프로젝트**.
2. 기본으로 생긴 `Code.gs`의 내용을 전부 지우고, 아래 코드를 붙여넣으세요.

```javascript
// room-booking.html 전용 — 예약을 학교 공용 캘린더에 추가하는 기능만 담당하는
// 독립 Apps Script. collect.html/file-library.html의 공용 스크립트와는 완전히
// 별개이며, GCAL_CALENDAR_ID만 room-booking.html/date.html/my-page.html과
// 동일한 값으로 맞춰주면 됩니다.
var GCAL_CALENDAR_ID = '5593aba1190c08f999c1299b6e576f0c4adee288d2fe94d6fa38000dd1e7b9f7@group.calendar.google.com';

function doPost(e) {
  var p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: '요청 형식이 올바르지 않습니다.' });
  }
  if (p.action === 'addCalendarEvent') {
    return jsonOut(actionAddCalendarEvent(p));
  }
  return jsonOut({ ok: false, error: '알 수 없는 요청입니다.' });
}

function actionAddCalendarEvent(p) {
  var title = String(p.title || '').trim().slice(0, 200);
  var dateStr = String(p.date || '').trim();
  var startTime = String(p.startTime || '').trim();
  var endTime = String(p.endTime || '').trim();
  if (!title) return { ok: false, error: '제목을 입력해주세요.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { ok: false, error: '날짜 형식이 올바르지 않습니다.' };
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return { ok: false, error: '시간 형식이 올바르지 않습니다.' };
  }
  var start = new Date(dateStr + 'T' + startTime + ':00');
  var end = new Date(dateStr + 'T' + endTime + ':00');
  if (!(end > start)) return { ok: false, error: '종료 시간이 시작 시간보다 빨라요.' };

  var cal;
  var calErr = null;
  try {
    cal = CalendarApp.getCalendarById(GCAL_CALENDAR_ID);
  } catch (err) {
    cal = null;
    calErr = err.message;
  }
  if (!cal) {
    return {
      ok: false,
      error: '학교 공용 캘린더에 접근할 수 없습니다 (상세: ' + (calErr || 'getCalendarById가 null을 반환함, 예외 없음') + ') — 이 스크립트를 배포한 구글 계정이 그 캘린더의 편집자로 등록되어 있는지 확인해주세요.'
    };
  }
  try {
    var desc = String(p.description || '').trim();
    var event = cal.createEvent(title, start, end, desc ? { description: desc } : {});
    return { ok: true, eventId: event.getId() };
  } catch (err) {
    return { ok: false, error: '캘린더에 일정을 추가하지 못했습니다: ' + err.message };
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
```

## 2. 권한 승인 (중요 — 이걸 건너뛰면 "학교 공용 캘린더에 접근할 수 없습니다" 에러가 납니다)

`doPost`를 바로 배포하기 전에, **편집기에서 직접 한 번 실행해서 Calendar 권한 승인
팝업을 통과시켜야** 합니다 — 이 단계를 건너뛰면 배포 후에도 매번 권한 에러가 납니다.

1. `Code.gs` 맨 아래에 테스트용 함수를 잠깐 추가하세요:
   ```javascript
   function testAddCalendarEvent() {
     var result = actionAddCalendarEvent({
       title: '테스트 일정', date: '2026-10-21', startTime: '09:00', endTime: '10:00'
     });
     Logger.log(result);
   }
   ```
2. 상단 드롭다운에서 `testAddCalendarEvent`를 선택하고 **▶ 실행**.
3. **"승인 필요"** 팝업이 뜨면 → **권한 검토** → 계정 선택 → (구글에서 확인하지 않은
   앱이라는 경고가 뜨면) **고급** → **...(으)로 이동(안전하지 않음)** → **허용**.
4. 실행 로그에 `{ok=true, eventId=...}`가 찍히면 성공입니다. 테스트 함수는 지워도 되고
   그냥 둬도 다른 기능에 영향 없습니다 (호출하는 곳이 없으니까요).

## 3. 웹 앱으로 배포

1. 우측 상단 **배포 → 새 배포**.
2. 유형: **웹 앱**.
3. **다음 사용자 인증 정보로 실행**: **나** (지금 로그인한 계정으로 고정됩니다).
4. **액세스 권한이 있는 사용자**: **모든 사용자**.
5. **배포** 클릭 → 생성된 **웹 앱 URL**(`https://script.google.com/macros/s/.../exec`)을 복사하세요.

## 4. 사이트에 적용

`room-booking.html` 파일 안의 아래 줄을 방금 복사한 URL로 교체하세요.

```javascript
const CALENDAR_SCRIPT_URL = 'YOUR_PERSONAL_CALENDAR_SCRIPT_URL'; // ← 여기를 교체
```

적용 전까지는 "캘린더에 추가" 버튼을 눌러도 네트워크 요청 없이 바로 "아직 설정되지
않았어요"라는 안내 메시지만 뜹니다 — 교실 예약 자체(생성/조회/수정/삭제)에는 전혀
영향이 없습니다.

## 5. 나중에 코드를 수정하려면

이 스크립트는 `collect.html`/`file-library.html`이 쓰는 공용 스크립트와 **완전히
별개**입니다 — `collect-setup.md`의 안내를 따라 그 공용 스크립트를 재배포해도 이
기능에는 아무 영향이 없고, 반대로 이 스크립트를 고쳐도 파일 수합함/자료실에는
영향이 없습니다. 코드를 바꾸면 **배포 → 배포 관리 → 수정 → 새 버전**으로 재배포해야
반영됩니다 (새 배포를 만들면 URL이 바뀌어서 `CALENDAR_SCRIPT_URL`도 같이 바꿔야 해요
— 기존 배포에 새 버전을 올리는 쪽을 추천합니다).
