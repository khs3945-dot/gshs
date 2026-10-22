/*
  경성고 교무 도구 — 사이트 메뉴 목록(한 곳에서 관리)
  ------------------------------------------------
  왼쪽 사이드바(.ks-sidebar의 <nav id="ksNav">)는 이 목록으로 그려지고, nav.js(햄버거 메뉴·검색·메인 타일
  그룹)도 이 목록을 읽어요. 메뉴를 추가·이동·이름 변경할 땐 이 파일의 KS_MENU만 고치면 돼요.
  사이드바 페이지: <nav class="ks-nav" id="ksNav"></nav> 바로 뒤에 <script src="./ks-menu.js"></script>
  사이드바 없는 페이지: <head>에서 nav.js보다 먼저 <script src="./ks-menu.js"></script>
  항목 필드: href, label, icon(SVG 내부), desc, login(로그인 필요 * 표시), admin(관리자에게만 보임), ext(새 창)
  그룹 cat은 아이콘 색(각 페이지 #ks-theme의 .ic-<cat>)이에요.
*/
(function(){
  var KS_MENU = [
 {
  "group": null,
  "cat": "base",
  "items": [
   {
    "href": "./index.html",
    "label": "홈",
    "icon": "<path d=\"M4 11l8-7 8 7\"/><path d=\"M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9\"/><path d=\"M10 20v-6h4v6\"/>",
    "desc": "메인 페이지로 돌아가요."
   }
  ]
 },
 {
  "group": "내 업무",
  "cat": "base",
  "items": [
   {
    "href": "./my-page.html",
    "label": "나의 페이지",
    "login": true,
    "icon": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><circle cx=\"9\" cy=\"10\" r=\"2.2\"/><path d=\"M5.5 17c.8-2 2.3-3 3.5-3s2.7 1 3.5 3\"/><path d=\"M14 9h5M14 13h5\"/>",
    "desc": "내 정보·할 일·시간표를 한 화면에서 봐요."
   },
   {
    "href": "./my-custom-page.html",
    "label": "대시보드",
    "login": true,
    "icon": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/>",
    "desc": "업무에 맞게 화면을 직접 구성해보세요. 위젯을 끌어다 놓거나 도우미에게 말해서 자동으로 배치할 수 있어요."
   },
   {
    "href": "./task-assign.html",
    "label": "할 일 요청",
    "login": true,
    "icon": "<path d=\"M4 11v-2a2 2 0 0 1 2-2h2l9-3v14l-9-3H6a2 2 0 0 1-2-2z\"/><path d=\"M8 14v4a2 2 0 0 0 2 2h0\"/>",
    "desc": "다른 사람에게 업무를 배정하거나, 나에게 배정된 업무를 확인해요. 나의 페이지의 같은 블록과 완전히 연동돼요."
   },
   {
    "href": "./memo.html",
    "label": "메모장",
    "login": true,
    "icon": "<path d=\"M5 4h11l3 3v13H5z\"/><path d=\"M16 4v3h3\"/><path d=\"M8 11h8M8 15h5\"/>",
    "desc": "날짜·시간과 함께 메모를 남기고 라벨을 붙여 검색할 수 있어요."
   },
   {
    "href": "./my-bot.html",
    "label": "나만의 챗봇 비서",
    "login": true,
    "icon": "<rect x=\"6\" y=\"8\" width=\"12\" height=\"10\" rx=\"3\"/><path d=\"M12 8V5\"/><circle cx=\"12\" cy=\"4\" r=\"1.3\" fill=\"#fff\"/><circle cx=\"9.5\" cy=\"13\" r=\"1.1\" fill=\"#fff\"/><circle cx=\"14.5\" cy=\"13\" r=\"1.1\" fill=\"#fff\"/><path d=\"M3 12h3M18 12h3\"/>",
    "desc": "나만 쓰는 개인 비서 챗봇이에요. 자료를 올리고 대화가 계속 이어져요."
   }
  ]
 },
 {
  "group": "학교 정보",
  "cat": "plan",
  "items": [
   {
    "href": "./school-status.html",
    "label": "학교 현황",
    "login": true,
    "icon": "<path d=\"M4 21V8l8-5 8 5v13\"/><path d=\"M9 21v-7h6v7\"/><path d=\"M4 21h16\"/>",
    "desc": "학교 기본정보·학년별 반 편성·전체 학생 명렬표·주요 학사일정을 한 곳에서 봐요."
   },
   {
    "href": "./calendar.html",
    "label": "캘린더",
    "icon": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M8 3v4M16 3v4\"/>",
    "desc": "한 달씩 넘겨보며 학사일정을 한눈에 확인해요. 날짜를 누르면 상세 정보로 이동."
   },
   {
    "href": "./weekplan.html",
    "label": "주간계획",
    "icon": "<path d=\"M4 4h12l4 4v12H4z\"/><path d=\"M16 4v4h4\"/><path d=\"M8 12h8M8 16h5\"/>",
    "desc": "구글 드라이브 '주간계획' 폴더의 최신 문서를 AI 요약·원본·전체 목록으로 한 화면에서 봐요."
   },
   {
    "href": "./teachers.html",
    "label": "교사 시간표 조회·비교",
    "icon": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3.5 2\"/>",
    "desc": "선생님을 선택하면 주간 시간표를 보여주고, 여러 명을 고르면 공통 공강 시간을 찾아줘요."
   },
   {
    "href": "./duty.html",
    "label": "학생 지도 당번표",
    "icon": "<circle cx=\"8.5\" cy=\"8\" r=\"2.5\"/><circle cx=\"16\" cy=\"9\" r=\"2\"/><path d=\"M3.5 19c.6-3 2.5-5 5-5s4.4 2 5 5\"/><path d=\"M13 19c.4-2.2 1.8-3.6 3.4-3.6s3 1.4 3.4 3.6\"/>",
    "desc": "정문·후문·중식·야자 담당자를 날짜별로 자동 표시. 이름 검색, 전체 일정 목록 포함."
   },
   {
    "href": "./meal.html",
    "label": "오늘의 급식",
    "icon": "<path d=\"M7 3v7a2 2 0 0 0 2 2v9\"/><path d=\"M4 3v6M10 3v6\"/><path d=\"M17 3c-1.7 0-3 2-3 5s1.3 5 3 5v8\"/>",
    "desc": "나이스(NEIS) 급식 정보를 실시간으로 불러와 보여줘요. 날짜 이동 가능."
   }
  ]
 },
 {
  "group": "예약·공유",
  "cat": "share",
  "items": [
   {
    "href": "./room-booking.html",
    "label": "교실 사용 예약",
    "icon": "<rect x=\"3\" y=\"7\" width=\"18\" height=\"13\" rx=\"2\"/><path d=\"M8 7V4h8v3\"/><circle cx=\"12\" cy=\"13.5\" r=\"2.3\"/>",
    "desc": "요일·교시별 달력에서 빈 칸을 눌러 바로 교실을 예약해요."
   },
   {
    "href": "./collect.html",
    "label": "제출함",
    "icon": "<path d=\"M3 11l3-7h12l3 7\"/><path d=\"M3 11v7a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-7\"/><path d=\"M3 11h5l1.5 2.5h5L16 11h5\"/>",
    "desc": "제목과 마감을 정해 제출함을 만들고 링크만 공유하면, 선생님들이 로그인 없이 파일을 낼 수 있어요."
   },
   {
    "href": "./survey.html",
    "label": "설문조사",
    "login": true,
    "icon": "<path d=\"M4 20V10\"/><path d=\"M10 20V4\"/><path d=\"M16 20v-7\"/><path d=\"M3 20h18\"/>",
    "desc": "설문·투표를 만들고 링크를 공유하면, 로그인 없이도 누구나 그 링크에서 바로 응답할 수 있어요."
   },
   {
    "href": "./form-board.html",
    "label": "문서 양식 공유",
    "login": true,
    "icon": "<path d=\"M6 3h8l4 4v14H6z\"/><path d=\"M14 3v4h4\"/><path d=\"M9 12h6M9 16h6\"/>",
    "desc": "기안문·품의문·출결 공문 같은 서식을 카테고리별로 올리고, 제목을 눌러 내용을 펼친 뒤 바로 복사해서 써요."
   },
   {
    "href": "./file-library.html",
    "label": "자료실",
    "login": true,
    "icon": "<path d=\"M3 7l2-3h14l2 3\"/><rect x=\"3\" y=\"7\" width=\"18\" height=\"13\" rx=\"1.5\"/><path d=\"M10 12h4\"/>",
    "desc": "선생님들이 자유롭게 올리고 받아가는 공용 파일 창고예요. 폴더를 만들어 분류하고, 파일 이름을 누르면 바로 내려받아요."
   },
   {
    "href": "./link-hub.html",
    "label": "업무 링크 모음",
    "icon": "<path d=\"M9 7H6a4 4 0 0 0 0 8h3\"/><path d=\"M15 7h3a4 4 0 0 1 0 8h-3\"/><path d=\"M8 11h8\"/>",
    "desc": "자주 쓰는 업무 링크를 누구나 추가하고, 카테고리별로 모아보고, 검색도 할 수 있어요."
   }
  ]
 },
 {
  "group": "평가·학생",
  "cat": "eval",
  "items": [
   {
    "href": "./exams.html",
    "label": "시험 시간표",
    "login": true,
    "icon": "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"/><path d=\"M4 9h16\"/><path d=\"M8 13h3M8 16h5\"/>",
    "desc": "학년·반·학생을 선택하면 개인별 시험 과목·고사실·대기 장소가 나와요. 인쇄 가능."
   },
   {
    "href": "./score-generator.html",
    "label": "문항 배점 생성기",
    "icon": "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8\"/><circle cx=\"8.5\" cy=\"12\" r=\"1\" fill=\"#fff\"/><circle cx=\"12\" cy=\"12\" r=\"1\" fill=\"#fff\"/><circle cx=\"15.5\" cy=\"12\" r=\"1\" fill=\"#fff\"/><circle cx=\"8.5\" cy=\"16\" r=\"1\" fill=\"#fff\"/><circle cx=\"12\" cy=\"16\" r=\"1\" fill=\"#fff\"/><circle cx=\"15.5\" cy=\"16\" r=\"1\" fill=\"#fff\"/>",
    "desc": "총점수·총문항수·배점 개수·배점 범위를 입력하면 문항별 배점과 문항수를 자동으로 계산해줘요."
   },
   {
    "href": "./grade-estimate.html",
    "label": "예상 등급 산출",
    "login": true,
    "icon": "<circle cx=\"12\" cy=\"12\" r=\"8\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\"/><circle cx=\"12\" cy=\"12\" r=\"1\" fill=\"#fff\"/>",
    "desc": "점수 일람표를 붙여넣으면 석차등급 산출 기준과 동점자 중간석차 처리 규정을 적용해 예상 등급과 등급컷을 계산해줘요."
   },
   {
    "href": "./mock-interview.html",
    "label": "모의면접 분석",
    "icon": "<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M6 11a6 6 0 0 0 12 0\"/><path d=\"M12 17v4M9 21h6\"/>",
    "desc": "모의면접을 녹음·전사하고, 문항별 답변과 선생님 메모를 바탕으로 AI가 종합 평가 보고서를 만들어줘요."
   },
   {
    "href": "./absence-report.html",
    "label": "결석신고서",
    "login": true,
    "icon": "<path d=\"M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z\"/><path d=\"M14 3v4a1 1 0 0 0 1 1h4\"/><path d=\"M9.5 17.5 8 19l.6-2.1 5.4-5.4a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 1 0 1.4z\"/>",
    "desc": "학년·반·번호·이름·사유·기간을 입력하면 서명용 링크가 만들어져요. 학생·보호자가 로그인 없이 서명하면 담임 선생님이 확인 후 PDF로 저장·출력할 수 있어요."
   }
  ]
 },
 {
  "group": "AI 챗봇",
  "cat": "bot",
  "items": [
   {
    "href": "./chatbot-teacher.html",
    "label": "교사용 챗봇",
    "login": true,
    "icon": "<rect x=\"4\" y=\"5\" width=\"16\" height=\"11\" rx=\"3\"/><path d=\"M9 20l2-4h2l2 4\"/><circle cx=\"9\" cy=\"10.5\" r=\"1.1\" fill=\"#fff\"/><circle cx=\"15\" cy=\"10.5\" r=\"1.1\" fill=\"#fff\"/>",
    "desc": "선생님들이 올려둔 자료를 바탕으로 질문에 답해요. 양식 파일을 요청하면 찾아서 다운로드 링크도 함께 드려요."
   },
   {
    "href": "./chatbot-builder.html",
    "label": "수업용 챗봇 만들기",
    "login": true,
    "icon": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8\"/>",
    "desc": "학생들에게 공유할 나만의 챗봇을 만들어요. 성격과 참고 자료를 정하면 링크와 암호가 생겨요."
   },
   {
    "href": "./korean-inquiry.html",
    "label": "국어 현상 탐구 챗봇",
    "icon": "<path d=\"M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z\"/><path d=\"M20 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z\"/>",
    "desc": "학생이 학번·이름으로 접속해 일상에서 발견한 국어 표현을 챗봇과 함께 문법적으로 탐구하고 발표까지 준비해요."
   }
  ]
 },
 {
  "group": "생활",
  "cat": "life",
  "items": [
   {
    "href": "./food-map.html",
    "label": "맛집 공유지도",
    "login": true,
    "icon": "<path d=\"M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.3\"/>",
    "desc": "지도를 클릭해 맛집 위치를 찍고 이름·종류·한줄평을 남겨요. 좋아요로 추천하고, 종류별로 필터링할 수 있어요."
   },
   {
    "href": "https://www.foreducator.com/lost-found/%EA%B2%BD%EC%84%B1%EA%B3%A0-%EB%B6%84%EC%8B%A4%EB%AC%BC-%EC%84%BC%ED%84%B0-rdho3",
    "label": "분실물 관리",
    "ext": true,
    "icon": "<rect x=\"5\" y=\"8\" width=\"14\" height=\"11\" rx=\"2\"/><path d=\"M9 8V6a3 3 0 0 1 6 0v2\"/>",
    "desc": "포에듀케이터 경성고 분실물 센터로 바로 이동해요. 새 창에서 열려요."
   }
  ]
 },
 {
  "group": "관리",
  "cat": "admin",
  "items": [
   {
    "href": "./announce.html",
    "label": "공지사항 작성",
    "login": true,
    "icon": "<path d=\"M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z\"/><path d=\"M17 9a4 4 0 0 1 0 6\"/><path d=\"M19.5 6.5a8 8 0 0 1 0 11\"/>",
    "desc": "승인된 선생님은 누구나 쓸 수 있어요. 정한 기간 동안 모든 선생님의 나의 페이지·대시보드 상단에 나타나요."
   },
   {
    "href": "./staff-roster.html",
    "label": "교직원 명렬",
    "login": true,
    "icon": "<rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M8 8h8M8 12h8M8 16h5\"/>",
    "desc": "부서·교과·내선·담임 등 교직원 명렬을 표에서 바로 고치거나 엑셀로 내려받고 올려요."
   },
   {
    "href": "./staff-edit.html",
    "label": "교사 시간표 편집",
    "admin": true,
    "icon": "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"1.5\"/><path d=\"M5 10h14M5 17h14\"/><path d=\"M9 6.5h2M9 13.5h2\"/>",
    "desc": "관리자이거나 공용 편집 비밀번호를 알고 있으면 교사 시간표를 직접 수정할 수 있어요."
   },
   {
    "href": "./member-admin.html",
    "label": "회원 관리",
    "admin": true,
    "icon": "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3.5 19c.6-3.3 2.8-5.3 5.5-5.3s4.9 2 5.5 5.3\"/><circle cx=\"17\" cy=\"9\" r=\"2.3\"/><path d=\"M15.5 13.3c1.9.3 3.4 1.8 4 4.2\"/>",
    "desc": "가입한 선생님 목록을 확인하고, 정보를 수정하거나 새로 가입한 계정을 승인해요."
   },
   {
    "href": "./teacher-groups.html",
    "label": "교사 그룹 관리",
    "admin": true,
    "icon": "<circle cx=\"8\" cy=\"9\" r=\"2.6\"/><circle cx=\"16\" cy=\"9\" r=\"2.6\"/><path d=\"M3.5 19c.5-2.8 2.2-4.5 4.5-4.5M20.5 19c-.5-2.8-2.2-4.5-4.5-4.5\"/><path d=\"M9.5 16.5h5\"/>",
    "desc": "위원회 등 필요한 그룹을 이름 짓고 명단에서 체크박스로 선생님을 골라 만들어요."
   },
   {
    "href": "./ai-usage.html",
    "label": "AI 사용량",
    "admin": true,
    "icon": "<path d=\"M4 20V14\"/><path d=\"M10 20V9\"/><path d=\"M16 20v-5\"/><path d=\"M3 20h18\"/><path d=\"M18 4l.8 1.8L20.5 6.5l-1.7.7L18 9l-.8-1.8L15.5 6.5l1.7-.7z\"/>",
    "desc": "챗봇·요약 등 AI 기능을 계정별(또는 학생 챗봇 세션별)로 얼마나 썼는지 확인해요."
   },
   {
    "href": "./feedback.html",
    "label": "기능 개선 의견",
    "login": true,
    "hidden": true,
    "icon": "<path d=\"M4 5h16v11H9l-5 4z\"/><path d=\"M8 9h8M8 12h5\"/>",
    "desc": "있으면 좋겠다 싶은 기능이나 불편한 점을 자유롭게 남겨요. 관리자가 읽고 반영해요."
   },
   {
    "href": "./admin-tools.html",
    "label": "관리 도구",
    "icon": "<path d=\"M14.5 6.5l3 3-7.5 7.5-3.5.5.5-3.5z\"/><path d=\"M18.5 3.5a2.1 2.1 0 0 1 3 3l-1.3 1.3-3-3z\"/>",
    "desc": "관리자 모드(공용 편집 비밀번호)로 들어가 명렬·시간표를 고치고, 관리자는 비밀번호를 관리해요."
   }
  ]
 }
];
  window.KS_MENU = KS_MENU;

  function pageKey(href){
    if(/^https?:\/\//.test(href)) return href;
    return href.split('?')[0].split('#')[0].replace(/^\.?\//, '').replace(/\.html$/, '') || 'index';
  }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  var isAdmin = false;
  try{ isAdmin = localStorage.getItem('ks_is_admin') === '1'; }catch(e){}

  function itemHtml(it, cat, cur){
    var svg = '<svg viewBox="0 0 24 24" width="13" height="13" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round">' + it.icon + '</svg>';
    var cls = 'ks-nav-item' + (pageKey(it.href) === cur ? ' active' : '') + (it.admin ? ' ks-admin-item' : '');
    var attrs = it.ext ? ' target="_blank" rel="noopener"' : '';
    var hide = (it.admin && !isAdmin) ? ' style="display:none"' : '';
    return '<a class="' + cls + '" href="' + esc(it.href) + '"' + attrs + hide + '><span class="ks-nav-ico ic-' + cat + '">' + svg + '</span>' +
      esc(it.label) + (it.login ? '<sup class="login-mark">*</sup>' : '') + '</a>';
  }
  function render(nav){
    var path = location.pathname;
    var cur = pageKey(path.substring(path.lastIndexOf('/') + 1) || 'index.html');
    var html = '';
    KS_MENU.forEach(function(g){
      if(g.group) html += '<div class="ks-nav-sep"></div><div class="ks-nav-group-label">' + esc(g.group) + '</div>';
      g.items.forEach(function(it){ if(!it.hidden) html += itemHtml(it, g.cat, cur); });
    });
    nav.innerHTML = html;
  }
  // nav.js가 관리자 여부를 확인한 뒤 불러요 — 관리 그룹의 관리자 전용 항목을 보이거나 숨기고, 다음 방문 때 바로 쓰게 기억해요.
  window.ksMenuSetAdmin = function(admin){
    isAdmin = !!admin;
    try{ localStorage.setItem('ks_is_admin', isAdmin ? '1' : '0'); }catch(e){}
    document.querySelectorAll('.ks-admin-item').forEach(function(a){ a.style.display = isAdmin ? '' : 'none'; });
  };
  var nav = document.getElementById('ksNav');
  if(nav) render(nav);
})();
