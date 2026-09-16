/*
  경성고 교무 도구 — 공통 사이드 메뉴 (햄버거 버튼)
  ------------------------------------------------
  이 파일을 쓰는 모든 페이지의 <head>에 아래 한 줄만 넣으면 됩니다.
    <script src="./nav.js" defer></script>
  페이지 목록을 바꾸려면 아래 NAV_ITEMS만 수정하세요.
*/
(function(){
  const NAV_ITEMS = [
    { href: './index.html', label: '메인으로' },
    { href: './calendar.html', label: '학사일정 달력' },
    { href: './date.html', label: '날짜로 보기' },
    { href: './teacher.html', label: '교사별 보기' },
    { href: './duty.html', label: '학생 지도 당번표' },
    { href: './duty-mobile.html', label: '오늘의 지도 당번 (모바일)' },
    { href: './teachers.html', label: '교사 시간표 조회·비교' },
    { href: './exams.html', label: '학생별 기말고사 시간표' },
    { href: './meal.html', label: '오늘의 급식' },
    { href: './room-request.html', label: '교실 사용 신청' }
  ];

  const TEACHER_NAMES = [{"name": "김향섭", "dept": "교장", "subject": ""}, {"name": "송영찬", "dept": "교감", "subject": ""}, {"name": "구재희", "dept": "창의융합부", "subject": "물리"}, {"name": "국현숙", "dept": "상담복지부", "subject": "수학"}, {"name": "권준화", "dept": "안전생활부", "subject": "영양"}, {"name": "권혜령", "dept": "연구정보부", "subject": "지학"}, {"name": "김미란", "dept": "창의융합부", "subject": "영어"}, {"name": "김선진", "dept": "창의융합부", "subject": "영어"}, {"name": "김소영", "dept": "상담복지부", "subject": "특수"}, {"name": "김소은", "dept": "진로진학부", "subject": "진로"}, {"name": "김송이", "dept": "교무기획부", "subject": "영어"}, {"name": "김수진", "dept": "안전생활부", "subject": "사회"}, {"name": "김원회", "dept": "3학년부", "subject": "영어"}, {"name": "김유리", "dept": "교무기획부", "subject": "국어"}, {"name": "김응선", "dept": "교무기획부", "subject": "물리"}, {"name": "김주호", "dept": "2학년부", "subject": "체육"}, {"name": "김진이", "dept": "1학년부", "subject": "수학"}, {"name": "김현진", "dept": "연구정보부", "subject": "국어"}, {"name": "김혜숙", "dept": "강사", "subject": "영어"}, {"name": "김효진", "dept": "상담복지부", "subject": "사회"}, {"name": "김흥석", "dept": "창의융합부", "subject": "국어"}, {"name": "문창석", "dept": "안전생활부", "subject": "지킴이"}, {"name": "박은경", "dept": "연구정보부", "subject": "미술"}, {"name": "박조은", "dept": "교무/연구", "subject": "사서"}, {"name": "배하늬", "dept": "안전생활부", "subject": "생물"}, {"name": "백기현", "dept": "3학년부", "subject": "지리"}, {"name": "백은진", "dept": "교무기획부", "subject": "사회"}, {"name": "소영주", "dept": "교무기획부", "subject": "교무"}, {"name": "송경모", "dept": "안전생활부", "subject": "지킴이"}, {"name": "양지우", "dept": "상담복지부", "subject": "특수"}, {"name": "오선진", "dept": "창의융합부", "subject": "수학"}, {"name": "오요한", "dept": "연구정보부", "subject": "수학"}, {"name": "유두선", "dept": "강사", "subject": "한문"}, {"name": "윤은혜", "dept": "안전생활부", "subject": "수학"}, {"name": "이민선", "dept": "상담복지부", "subject": "상담"}, {"name": "이병하", "dept": "교무기획부", "subject": "국어"}, {"name": "이수현", "dept": "2학년부", "subject": "정보"}, {"name": "이슬아", "dept": "교무기획부", "subject": "화학"}, {"name": "이영중", "dept": "안전생활부", "subject": "체육"}, {"name": "이용도", "dept": "교무기획부", "subject": "국어"}, {"name": "이정훈", "dept": "진로진학부", "subject": "영어"}, {"name": "이종용", "dept": "창의융합부", "subject": "영어"}, {"name": "이지원", "dept": "연구정보부", "subject": "화학"}, {"name": "이현수", "dept": "3학년부", "subject": "정보"}, {"name": "이혜경", "dept": "안전생활부", "subject": "보건"}, {"name": "이희락", "dept": "연구정보부", "subject": "역사"}, {"name": "임순강", "dept": "창의융합부", "subject": "국어"}, {"name": "장희식", "dept": "상담복지부", "subject": "특수"}, {"name": "정민재", "dept": "안전생활부", "subject": "수학"}, {"name": "최도운", "dept": "연구정보부", "subject": "미술"}, {"name": "최예은", "dept": "교무기획부", "subject": "음악"}, {"name": "추희정", "dept": "연구정보부", "subject": "국어"}, {"name": "하성용", "dept": "교무기획부", "subject": "윤리"}, {"name": "허서이", "dept": "교무기획부", "subject": "윤리"}, {"name": "홍은정", "dept": "교무기획부", "subject": "수학"}, {"name": "황정운", "dept": "창의융합부", "subject": "역사"}, {"name": "황지현", "dept": "1학년부", "subject": "지리"}, {"name": "황호언", "dept": "안전생활부", "subject": "지학"}];

  function currentFile(){
    const path = window.location.pathname;
    const file = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
    return file;
  }

  function injectStyle(){
    const style = document.createElement('style');
    style.textContent = `
      .gsnav-burger{
        position:fixed; top:16px; left:16px; z-index:9998;
        width:40px; height:40px; border-radius:6px;
        background: var(--paper-card, #FFFFFF); border:1px solid var(--rule, #C7BC9C);
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;
        cursor:pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }
      .gsnav-burger span{ display:block; width:18px; height:2px; background: var(--ink, #262B25); border-radius:1px; transition: transform 0.2s, opacity 0.2s; }
      .gsnav-burger.open span:nth-child(1){ transform: translateY(6px) rotate(45deg); }
      .gsnav-burger.open span:nth-child(2){ opacity:0; }
      .gsnav-burger.open span:nth-child(3){ transform: translateY(-6px) rotate(-45deg); }

      .gsnav-overlay{
        position:fixed; inset:0; background: rgba(38,43,37,0.35);
        z-index:9996; opacity:0; pointer-events:none; transition: opacity 0.2s;
      }
      .gsnav-overlay.open{ opacity:1; pointer-events:auto; }

      .gsnav-panel{
        position:fixed; top:0; left:0; bottom:0; width:270px; max-width:82vw;
        background: var(--paper-card, #FFFFFF); z-index:9997;
        border-right:1px solid var(--rule, #C7BC9C);
        transform: translateX(-100%); transition: transform 0.22s ease;
        display:flex; flex-direction:column;
        font-family:'Noto Sans KR', sans-serif;
      }
      .gsnav-panel.open{ transform: translateX(0); }
      .gsnav-panel-head{
        padding: 20px 18px 14px 64px; border-bottom:2px solid var(--ink, #262B25);
        min-height: 40px; display:flex; flex-direction:column; justify-content:center;
      }
      .gsnav-panel-head .t{
        font-family:'Noto Serif KR', serif; font-weight:700; font-size:16px; color: var(--ink, #262B25);
      }
      .gsnav-panel-head .s{
        font-size:11px; color: var(--ink-soft, #5C5A47); margin-top:3px;
      }
      .gsnav-list{ list-style:none; margin:0; padding:8px 0; overflow-y:auto; flex:1; }
      .gsnav-list li a{
        display:block; padding: 11px 18px; font-size:14px; color: var(--ink, #262B25);
        text-decoration:none; border-left:3px solid transparent;
      }
      .gsnav-list li a:hover{ background: var(--stamp-soft, rgba(38,64,133,0.08)); }
      .gsnav-list li a.active{
        color: var(--stamp, #264085); font-weight:700; border-left-color: var(--stamp, #264085);
        background: var(--stamp-soft, rgba(38,64,133,0.08));
      }

      .gsnav-search-btn{
        position:fixed; top:16px; right:16px; z-index:9998;
        width:40px; height:40px; border-radius:6px;
        background: var(--paper-card, #FFFFFF); border:1px solid var(--rule, #C7BC9C);
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }
      .gsnav-search-btn svg{ width:18px; height:18px; stroke: var(--ink, #262B25); }

      .gsnav-search-overlay{
        position:fixed; inset:0; background: rgba(38,43,37,0.35);
        z-index:9996; opacity:0; pointer-events:none; transition: opacity 0.2s;
      }
      .gsnav-search-overlay.open{ opacity:1; pointer-events:auto; }

      .gsnav-search-modal{
        position:fixed; top:70px; left:50%; width:340px; max-width:88vw;
        background: var(--paper-card, #FFFFFF); z-index:9997;
        border:1px solid var(--rule, #C7BC9C); border-radius:10px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.16);
        opacity:0; pointer-events:none;
        transform: translate(-50%, -8px); transition: opacity 0.18s, transform 0.18s;
        font-family:'Noto Sans KR', sans-serif;
        padding: 18px;
      }
      .gsnav-search-modal.open{ opacity:1; pointer-events:auto; transform: translate(-50%, 0); }
      .gsnav-search-modal h3{
        font-family:'Noto Serif KR', serif; font-size:15px; font-weight:700; margin:0 0 14px; color: var(--ink, #262B25);
      }
      .gsnav-search-block{ margin-bottom: 14px; }
      .gsnav-search-block:last-child{ margin-bottom:0; }
      .gsnav-search-block label{
        display:block; font-size:11.5px; font-weight:600; color: var(--ink-soft, #5C5A47); margin-bottom:6px;
      }
      .gsnav-search-row{ display:flex; gap:6px; position:relative; }
      .gsnav-search-row input{
        flex:1; min-width:0; font-family:'Noto Sans KR', sans-serif; font-size:14px;
        padding: 9px 10px; border:1px solid var(--rule, #C7BC9C); border-radius:6px;
        background: var(--paper, #F7F8FA); color: var(--ink, #262B25);
      }
      .gsnav-search-row button{
        font-family:'Noto Sans KR', sans-serif; font-size:13px; font-weight:600;
        color: var(--paper-card, #FFFFFF); background: var(--stamp, #264085);
        border:none; border-radius:6px; padding: 0 14px; cursor:pointer; white-space:nowrap;
      }
      .gsnav-search-suggest{
        position:absolute; top:calc(100% + 4px); left:0; right:52px;
        background: var(--paper-card, #FFFFFF); border:1px solid var(--rule, #C7BC9C); border-radius:6px;
        max-height:190px; overflow-y:auto; display:none; z-index:1;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      .gsnav-search-suggest.open{ display:block; }
      .gsnav-search-suggest .item{
        padding: 8px 11px; font-size:13px; cursor:pointer; display:flex; justify-content:space-between; gap:8px;
      }
      .gsnav-search-suggest .item .d{ color: var(--ink-soft, #5C5A47); font-size:11.5px; }
      .gsnav-search-suggest .item:hover{ background: var(--stamp-soft, rgba(38,64,133,0.08)); }
    `;
    document.head.appendChild(style);
  }

  let closeSearchFn = null;

  function build(){
    const burger = document.createElement('div');
    burger.className = 'gsnav-burger';
    burger.setAttribute('role', 'button');
    burger.setAttribute('aria-label', '메뉴 열기');
    burger.innerHTML = '<span></span><span></span><span></span>';

    const overlay = document.createElement('div');
    overlay.className = 'gsnav-overlay';

    const panel = document.createElement('div');
    panel.className = 'gsnav-panel';
    const cur = currentFile();
    const items = NAV_ITEMS.map(item => {
      const file = item.href.replace('./', '');
      const activeCls = (file === cur) ? ' active' : '';
      return `<li><a href="${item.href}" class="${activeCls.trim()}">${item.label}</a></li>`;
    }).join('');
    panel.innerHTML = `
      <div class="gsnav-panel-head">
        <div class="t">경성고 교무 도구</div>
        <div class="s">메뉴를 눌러 다른 페이지로 이동</div>
      </div>
      <ul class="gsnav-list">${items}</ul>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    document.body.appendChild(burger);
    document.body.style.paddingTop = '56px';

    function open(){
      if(closeSearchFn) closeSearchFn();
      burger.classList.add('open');
      overlay.classList.add('open');
      panel.classList.add('open');
    }
    function close(){
      burger.classList.remove('open');
      overlay.classList.remove('open');
      panel.classList.remove('open');
    }
    function toggle(){
      if(panel.classList.contains('open')) close(); else open();
    }

    burger.addEventListener('click', toggle);
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });

    buildSearch(close);
  }

  function buildSearch(closeNav){
    const searchBtn = document.createElement('div');
    searchBtn.className = 'gsnav-search-btn';
    searchBtn.setAttribute('role', 'button');
    searchBtn.setAttribute('aria-label', '검색 열기');
    searchBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

    const overlay = document.createElement('div');
    overlay.className = 'gsnav-search-overlay';

    const modal = document.createElement('div');
    modal.className = 'gsnav-search-modal';
    const today = new Date();
    const pad = n => String(n).padStart(2,'0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
    modal.innerHTML = `
      <h3>빠른 검색</h3>
      <div class="gsnav-search-block">
        <label>날짜로 이동</label>
        <div class="gsnav-search-row">
          <input type="date" id="gsnavDate" value="${todayStr}">
          <button id="gsnavDateGo">이동</button>
        </div>
      </div>
      <div class="gsnav-search-block">
        <label>교사 이름으로 이동</label>
        <div class="gsnav-search-row">
          <input type="text" id="gsnavTeacher" placeholder="이름 입력" autocomplete="off">
          <button id="gsnavTeacherGo">이동</button>
          <div class="gsnav-search-suggest" id="gsnavSuggest"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
    document.body.appendChild(searchBtn);

    const dateInput = modal.querySelector('#gsnavDate');
    const teacherInput = modal.querySelector('#gsnavTeacher');
    const suggest = modal.querySelector('#gsnavSuggest');

    function open(){
      closeNav();
      overlay.classList.add('open');
      modal.classList.add('open');
      setTimeout(() => teacherInput && teacherInput.focus(), 50);
    }
    function close(){
      overlay.classList.remove('open');
      modal.classList.remove('open');
      suggest.classList.remove('open');
    }
    closeSearchFn = close;

    searchBtn.addEventListener('click', open);
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') close(); });

    modal.querySelector('#gsnavDateGo').addEventListener('click', () => {
      if(dateInput.value) window.location.href = './date.html?d=' + dateInput.value;
    });

    function renderSuggest(query){
      const q = query.trim();
      const list = q ? TEACHER_NAMES.filter(t => t.name.includes(q)) : [];
      if(list.length === 0){ suggest.classList.remove('open'); return; }
      suggest.innerHTML = list.map(t =>
        `<div class="item" data-name="${t.name}"><span>${t.name}</span><span class="d">${t.dept}${t.subject ? ' · ' + t.subject : ''}</span></div>`
      ).join('');
      suggest.classList.add('open');
    }
    teacherInput.addEventListener('input', () => renderSuggest(teacherInput.value));
    teacherInput.addEventListener('focus', () => renderSuggest(teacherInput.value));
    suggest.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if(!item) return;
      window.location.href = './teacher.html?name=' + encodeURIComponent(item.dataset.name);
    });
    teacherInput.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && teacherInput.value.trim()){
        window.location.href = './teacher.html?name=' + encodeURIComponent(teacherInput.value.trim());
      }
    });
    modal.querySelector('#gsnavTeacherGo').addEventListener('click', () => {
      if(teacherInput.value.trim()) window.location.href = './teacher.html?name=' + encodeURIComponent(teacherInput.value.trim());
    });
  }

  function init(){
    injectStyle();
    build();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
