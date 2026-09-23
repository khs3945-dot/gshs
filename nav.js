/*
  경성고 교무 도구 — 공통 사이드 메뉴 (햄버거 버튼)
  ------------------------------------------------
  이 파일을 쓰는 모든 페이지의 <head>에 아래 한 줄만 넣으면 됩니다.
    <script src="./nav.js" defer></script>

  메뉴 목록은 이제 구글시트에서 실시간으로 읽어옵니다 (메뉴 편집기에서 시트를 고치면
  이 파일을 다시 안 올려도 바로 반영돼요). 아래 SHEET_ID만 한 번 채워주세요.
  시트 주소가 https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlmNoP.../edit 라면
  'd/' 와 '/edit' 사이 부분이 ID예요.
  이 시트는 반드시 "링크가 있는 모든 사용자에게 공개(뷰어)"로 공유해두셔야
  로그인 안 한 방문자도 메뉴를 볼 수 있어요.
*/
(function(){
  const SHEET_ID = '1PrmzlFtSQmadCPevDV7pcWhV69OLYEG4wmHWHE7Yewo';
  const SHEET_API_KEY = 'AIzaSyDjh2BQst5LQZq76ZlZyizUTiv-edD2_DY';
  const NAV_CACHE_KEY = 'ks_nav_cache';
  const GROUP_CACHE_KEY = 'ks_nav_group_cache';

  // 시트를 못 읽어올 때(설정 전, 네트워크 오류, API 키 제한 등)를 위한 기본값.
  // 그룹은 사이트맵 시트의 그룹 열을 그대로 손으로 옮겨온 값 — 시트 API가 복구되면
  // 실시간 값이 이 기본값을 자동으로 덮어써요(아래 refreshNavFromSheet 참고).
  const DEFAULT_NAV_ITEMS = [
    { href: './index.html', label: '메인으로' },
    { href: './my-page.html', label: '나의 페이지' },
    { href: './calendar.html', label: '캘린더', group: '일정' },
    { href: './date.html', label: '날짜로 보기' },
    { href: './teacher.html', label: '교사별 보기' },
    { href: './duty.html', label: '학생 지도 당번표', group: '일정' },
    { href: './duty-mobile.html', label: '오늘의 지도 당번 (모바일)', group: '일정' },
    { href: './teachers.html', label: '교사 시간표 조회·비교', group: '일정' },
    { href: './exams.html', label: '학생별 시험 시간표', group: '업무 도구' },
    { href: './meal.html', label: '오늘의 급식', group: '일정' },
    { href: 'https://docs.google.com/spreadsheets/d/1iMAfIMc_4BLWTeYmIaiz_di6_xpJMWlDIlw-6myGNS8/edit?gid=1578855358#gid=1578855358', label: '교실 사용 예약', group: '업무 도구' },
    { href: './link-hub.html', label: '업무 링크 모음', group: '업무 도구' },
    { href: './collect.html', label: '제출함', group: '업무 도구' },
    { href: './admin-tools.html', label: '교무 업무 도구', group: '업무 도구' },
    { href: './messages.html', label: '메시지함', group: '업무 도구' }
  ];
  const DEFAULT_HREF_GROUP_MAP = {};
  DEFAULT_NAV_ITEMS.forEach(item => { if(item.group) DEFAULT_HREF_GROUP_MAP[item.href] = item.group; });

  function loadCachedNav(){
    try{
      const raw = localStorage.getItem(NAV_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e){ return null; }
  }
  function saveCachedNav(items){
    try{ localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(items)); } catch(e){ /* 무시 */ }
  }
  function loadCachedGroupMap(){
    try{
      const raw = localStorage.getItem(GROUP_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e){ return null; }
  }
  function saveCachedGroupMap(map){
    try{ localStorage.setItem(GROUP_CACHE_KEY, JSON.stringify(map)); } catch(e){ /* 무시 */ }
  }

  // 예전에 시트를 성공적으로 읽어와 캐시된 값이 남아있을 수 있는데, 그 캐시는 그룹 정보가
  // 생기기 전 것일 수 있어서 href별로 기본 그룹값을 보충해줘요(캐시에 그룹이 이미 있으면 그대로 씀).
  let NAV_ITEMS = (loadCachedNav() || DEFAULT_NAV_ITEMS).map(item =>
    item.group ? item : Object.assign({}, item, { group: DEFAULT_HREF_GROUP_MAP[item.href] || '' })
  );
  // href → 그룹명. 메뉴표시(Y/N)와 무관하게 시트의 모든 행(메인/교무도구 타일 포함)을 대상으로 함.
  // 캐시가 그룹 정보가 생기기 전 것이면 href는 있지만 그룹값이 빈 문자열일 수 있으므로,
  // 그런 빈 값이 기본 그룹을 덮어쓰지 않도록 값이 있을 때만 반영함(NAV_ITEMS 보충 로직과 동일한 원칙).
  let HREF_GROUP_MAP = Object.assign({}, DEFAULT_HREF_GROUP_MAP);
  const cachedGroupMap = loadCachedGroupMap() || {};
  Object.keys(cachedGroupMap).forEach(href => {
    if(cachedGroupMap[href]) HREF_GROUP_MAP[href] = cachedGroupMap[href];
  });

  function parseNavRows(values){
    const rows = (values || []).slice(1); // 헤더 제외
    return rows
      .filter(r => r[0] && String(r[2] || '').trim().toUpperCase() === 'Y')
      .map(r => ({ href: r[0], label: r[1] || r[0], group: String(r[8] || '').trim(), order: parseInt(r[7], 10) || 999 }))
      .sort((a, b) => a.order - b.order)
      .map(r => ({ href: r.href, label: r.label, group: r.group }));
  }

  function parseGroupMap(values){
    const rows = (values || []).slice(1).filter(r => r[0]); // 헤더 제외, href 있는 행만
    const map = {};
    rows.forEach(r => { map[r[0]] = String(r[8] || '').trim(); });
    return map;
  }

  async function refreshNavFromSheet(){
    if(!SHEET_ID || SHEET_ID === 'YOUR_SHEET_ID') return;
    try{
      // 캐시 무효화 파라미터(t)가 없으면 브라우저가 예전 응답을 그대로 재사용해서,
      // 메뉴 편집기에서 시트를 새로 저장해도 메인 화면에 곧바로 반영되지 않는 문제가 있었음.
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:I200?key=${SHEET_API_KEY}&t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      if(!res.ok) return; // 조용히 기본값 유지
      const data = await res.json();
      HREF_GROUP_MAP = parseGroupMap(data.values);
      saveCachedGroupMap(HREF_GROUP_MAP);
      const items = parseNavRows(data.values);
      if(items.length > 0){
        NAV_ITEMS = items;
        saveCachedNav(items);
      }
      rebuildNavList();
      groupToolCardTiles();
    } catch(e){ /* 네트워크 오류 시 조용히 기본값 유지 */ }
  }

  const TEACHER_NAMES = [{"name": "김향섭", "dept": "교장", "subject": ""}, {"name": "추희정", "dept": "교감", "subject": ""}, {"name": "구재희", "dept": "창의융합부", "subject": "물리"}, {"name": "국현숙", "dept": "상담복지부", "subject": "수학"}, {"name": "권준화", "dept": "안전생활부", "subject": "영양"}, {"name": "권혜령", "dept": "연구정보부", "subject": "지학"}, {"name": "김미란", "dept": "창의융합부", "subject": "영어"}, {"name": "김선진", "dept": "창의융합부", "subject": "영어"}, {"name": "김소영", "dept": "상담복지부", "subject": "특수"}, {"name": "김소은", "dept": "진로진학부", "subject": "진로"}, {"name": "김송이", "dept": "교무기획부", "subject": "영어"}, {"name": "김수진", "dept": "안전생활부", "subject": "사회"}, {"name": "김원회", "dept": "3학년부", "subject": "영어"}, {"name": "김유리", "dept": "교무기획부", "subject": "국어"}, {"name": "김응선", "dept": "교무기획부", "subject": "물리"}, {"name": "김주호", "dept": "2학년부", "subject": "체육"}, {"name": "김진이", "dept": "1학년부", "subject": "수학"}, {"name": "김현진", "dept": "연구정보부", "subject": "국어"}, {"name": "김혜숙", "dept": "강사", "subject": "영어"}, {"name": "김효진", "dept": "상담복지부", "subject": "사회"}, {"name": "김흥석", "dept": "창의융합부", "subject": "국어"}, {"name": "문창석", "dept": "안전생활부", "subject": "지킴이"}, {"name": "박은경", "dept": "연구정보부", "subject": "미술"}, {"name": "박조은", "dept": "교무/연구", "subject": "사서"}, {"name": "배하늬", "dept": "안전생활부", "subject": "생물"}, {"name": "백기현", "dept": "3학년부", "subject": "지리"}, {"name": "백은진", "dept": "교무기획부", "subject": "사회"}, {"name": "소영주", "dept": "교무기획부", "subject": "교무"}, {"name": "송경모", "dept": "안전생활부", "subject": "지킴이"}, {"name": "양지우", "dept": "상담복지부", "subject": "특수"}, {"name": "오선진", "dept": "창의융합부", "subject": "수학"}, {"name": "오요한", "dept": "연구정보부", "subject": "수학"}, {"name": "유두선", "dept": "강사", "subject": "한문"}, {"name": "윤은혜", "dept": "안전생활부", "subject": "수학"}, {"name": "이민선", "dept": "상담복지부", "subject": "상담"}, {"name": "이병하", "dept": "교무기획부", "subject": "국어"}, {"name": "이상진", "dept": "강사", "subject": "국어"}, {"name": "이수현", "dept": "2학년부", "subject": "정보"}, {"name": "이슬아", "dept": "교무기획부", "subject": "화학"}, {"name": "이영중", "dept": "안전생활부", "subject": "체육"}, {"name": "이용도", "dept": "교무기획부", "subject": "국어"}, {"name": "이정훈", "dept": "진로진학부", "subject": "영어"}, {"name": "이종용", "dept": "창의융합부", "subject": "영어"}, {"name": "이지원", "dept": "연구정보부", "subject": "화학"}, {"name": "이현수", "dept": "3학년부", "subject": "정보"}, {"name": "이혜경", "dept": "안전생활부", "subject": "보건"}, {"name": "이희락", "dept": "연구정보부", "subject": "역사"}, {"name": "임순강", "dept": "창의융합부", "subject": "국어"}, {"name": "장희식", "dept": "상담복지부", "subject": "특수"}, {"name": "정민재", "dept": "안전생활부", "subject": "수학"}, {"name": "최도운", "dept": "연구정보부", "subject": "미술"}, {"name": "최예은", "dept": "교무기획부", "subject": "음악"}, {"name": "하성용", "dept": "교무기획부", "subject": "윤리"}, {"name": "허서이", "dept": "교무기획부", "subject": "윤리"}, {"name": "홍은정", "dept": "교무기획부", "subject": "수학"}, {"name": "황정운", "dept": "창의융합부", "subject": "역사"}, {"name": "황지현", "dept": "1학년부", "subject": "지리"}, {"name": "황호언", "dept": "안전생활부", "subject": "지학"}];

  function currentFile(){
    const path = window.location.pathname;
    const file = path.substring(path.lastIndexOf('/') + 1) || 'index.html';
    return file;
  }

  // 그룹이 없는 항목은 ungrouped(상단 고정, 헤더 없이 그대로 표시)로, 그룹이 있는 항목만
  // 그룹명 순서를 유지하며 { name, items[] } 배열(groups)로 묶음. 그룹 없는 항목을 "기타"로
  // 묶지 않는 이유는 그룹을 아직 안 정한 항목(메인으로/날짜로 보기/교사별 보기 등)을 접이식
  // 그룹 취급하지 않고 상단에 고정 노출하기 위함.
  function partitionByGroup(items, getGroup){
    const ungrouped = [];
    const order = [];
    const buckets = {};
    items.forEach(it => {
      const name = getGroup(it);
      if(!name){ ungrouped.push(it); return; }
      if(!buckets[name]){ buckets[name] = []; order.push(name); }
      buckets[name].push(it);
    });
    return { ungrouped, groups: order.map(name => ({ name, items: buckets[name] })) };
  }

  // 텍스트 삼각형(▾)은 글꼴에 따라 아주 작거나 잘 안 보여서, 선명하게 보이는 SVG 화살표로 통일함.
  const CARET_SVG = '<svg class="caret-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 6 8 10 12 6"></polyline></svg>';

  let navPanelEl = null;
  function navItemHtml(item, cur){
    const file = item.href.replace('./', '');
    const activeCls = (file === cur) ? ' active' : '';
    const isExternal = /^https?:\/\//.test(item.href);
    const extAttrs = isExternal ? ' target="_blank" rel="noopener"' : '';
    return `<li><a href="${item.href}" class="${activeCls.trim()}"${extAttrs}>${item.label}</a></li>`;
  }
  function renderNavListHtml(){
    const cur = currentFile();
    // 메인 페이지(index.html)와 나의 페이지(my-page.html)는 이제 목록 항목 대신 항상 보이는
    // 고정 아이콘 버튼으로 대체했으므로 목록에서는 빼요(시트에서 와도, 기본값이어도 동일하게 적용).
    const items = NAV_ITEMS.filter(it => it.href !== './index.html' && it.href !== './my-page.html');
    const { ungrouped, groups } = partitionByGroup(items, it => it.group);
    if(groups.length === 0){
      return items.map(item => navItemHtml(item, cur)).join('');
    }
    const ungroupedHtml = ungrouped.map(item => navItemHtml(item, cur)).join('');
    const groupsHtml = groups.map(g => `
      <li class="gsnav-group">
        <button type="button" class="gsnav-group-head" aria-expanded="true">
          <span>${g.name}</span><span class="gsnav-caret">${CARET_SVG}</span>
        </button>
        <ul class="gsnav-group-items">${g.items.map(item => navItemHtml(item, cur)).join('')}</ul>
      </li>
    `).join('');
    return ungroupedHtml + groupsHtml;
  }
  function rebuildNavList(){
    if(!navPanelEl) return;
    const list = navPanelEl.querySelector('.gsnav-list');
    if(list) list.innerHTML = renderNavListHtml();
  }

  // 메인/교무도구 타일 그리드(.card-list)를 시트의 그룹 정보로 묶어 접고 펼 수 있게 만듦.
  // 그룹이 하나도 없으면 손대지 않고 기존 그리드 그대로 둠.
  // 시트를 다시 불러와 그룹이 바뀔 수 있으므로(refreshNavFromSheet), 매번 원본 타일 목록을
  // 기준으로 다시 그룹핑해요. 최초 1회만 원본 타일 순서를 list.__gsnavAllCards에 저장해두고,
  // 이후 호출에서는 그 원본을 기준으로 다시 나눠요(이미 그룹 안에 들어간 DOM을 기준으로 하면
  // a.tool-card를 못 찾아서 두 번째부터 아무 일도 안 일어나던 게 이 버그의 원인이었음).
  function groupToolCardTiles(){
    document.querySelectorAll('.card-list').forEach(list => {
      if(!list.__gsnavAllCards){
        list.__gsnavAllCards = Array.from(list.children).filter(el => el.matches('a.tool-card'));
      }
      const cards = list.__gsnavAllCards;
      if(cards.length === 0) return;
      const { ungrouped, groups } = partitionByGroup(cards, el => HREF_GROUP_MAP[el.getAttribute('href')]);
      if(groups.length === 0){
        // 그룹이 없어지는 경우(시트에서 그룹을 다 지운 경우)를 대비해 원래 순서로 되돌림
        if(list.classList.contains('has-groups')){
          list.classList.remove('has-groups');
          const frag = document.createDocumentFragment();
          cards.forEach(card => frag.appendChild(card));
          list.innerHTML = '';
          list.appendChild(frag);
        }
        return;
      }

      list.classList.add('has-groups');
      const frag = document.createDocumentFragment();
      if(ungrouped.length > 0){
        const pinnedGrid = document.createElement('div');
        pinnedGrid.className = 'tile-group-grid tile-pinned-grid';
        ungrouped.forEach(card => pinnedGrid.appendChild(card));
        frag.appendChild(pinnedGrid);
      }
      groups.forEach(g => {
        const section = document.createElement('div');
        section.className = 'tile-group';
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'tile-group-head';
        head.setAttribute('aria-expanded', 'true');
        head.innerHTML = `<span>${g.name}</span><span class="tile-caret">${CARET_SVG}</span>`;
        const grid = document.createElement('div');
        grid.className = 'tile-group-grid';
        g.items.forEach(card => grid.appendChild(card));
        section.appendChild(head);
        section.appendChild(grid);
        frag.appendChild(section);
      });
      list.innerHTML = '';
      list.appendChild(frag);
    });
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

      .gsnav-home-btn{
        position:fixed; top:16px; left:64px; z-index:9998;
        width:40px; height:40px; border-radius:6px;
        background: var(--paper-card, #FFFFFF); border:1px solid var(--rule, #C7BC9C);
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-decoration:none;
      }
      .gsnav-home-btn svg{ width:19px; height:19px; stroke: var(--ink, #262B25); }

      .gsnav-mypage-btn{
        position:fixed; top:16px; left:112px; z-index:9998;
        width:40px; height:40px; border-radius:6px;
        background: var(--paper-card, #FFFFFF); border:1px solid var(--rule, #C7BC9C);
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-decoration:none;
      }
      .gsnav-mypage-btn svg{ width:19px; height:19px; stroke: var(--ink, #262B25); }

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
        font-family:'Noto Sans KR', sans-serif; font-weight:700; font-size:16px; color: var(--ink, #262B25);
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

      .gsnav-group-head{
        display:flex; align-items:center; justify-content:space-between;
        gap:8px; padding: 9px 14px; margin: 6px 10px 4px; width:calc(100% - 20px);
        border-radius:6px;
        font-family:'Noto Sans KR', sans-serif; font-size:12px; font-weight:700;
        color:#FFFFFF; letter-spacing:0.02em;
        background: var(--stamp, #264085); border:none; cursor:pointer; text-align:left;
      }
      .gsnav-caret{ display:inline-flex; color:#FFFFFF; transition: transform 0.15s; }
      .gsnav-group-head[aria-expanded="false"] .gsnav-caret{ transform: rotate(-90deg); }
      .gsnav-group-items{ list-style:none; margin:0; padding:0; }
      .gsnav-group-head[aria-expanded="false"] + .gsnav-group-items{ display:none; }

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
        font-family:'Noto Sans KR', sans-serif; font-size:15px; font-weight:700; margin:0 0 14px; color: var(--ink, #262B25);
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

      .card-list.has-groups{ display:flex; flex-direction:column; gap:22px; }
      .tile-group{ display:flex; flex-direction:column; gap:12px; }
      .tile-group-head{
        display:flex; align-items:center; gap:8px; width:100%;
        background: var(--stamp, #264085); border:none; border-radius:6px;
        padding: 9px 14px; cursor:pointer; text-align:left;
        font-family:'Noto Sans KR', sans-serif; font-size:14.5px; font-weight:700;
        color:#FFFFFF;
      }
      .tile-caret{ display:inline-flex; color:#FFFFFF; transition: transform 0.15s; }
      .tile-group-head[aria-expanded="false"] .tile-caret{ transform: rotate(-90deg); }
      .tile-group-grid{
        display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:14px;
      }
      .tile-group-head[aria-expanded="false"] + .tile-group-grid{ display:none; }
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

    const homeBtn = document.createElement('a');
    homeBtn.className = 'gsnav-home-btn';
    homeBtn.href = './index.html';
    homeBtn.setAttribute('aria-label', '메인으로');
    homeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"></path><path d="M5.5 10v9a1 1 0 0 0 1 1H9.5v-6h5v6H17.5a1 1 0 0 0 1-1v-9"></path></svg>';
    document.body.appendChild(homeBtn);

    const mypageBtn = document.createElement('a');
    mypageBtn.className = 'gsnav-mypage-btn';
    mypageBtn.href = './my-page.html';
    mypageBtn.setAttribute('aria-label', '나의 페이지');
    mypageBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"></circle><path d="M4.5 20c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6"></path></svg>';
    document.body.appendChild(mypageBtn);

    const overlay = document.createElement('div');
    overlay.className = 'gsnav-overlay';

    const panel = document.createElement('div');
    panel.className = 'gsnav-panel';
    navPanelEl = panel;
    const items = renderNavListHtml();
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

  // 사이드 메뉴 그룹 / 타일 그룹 헤더 클릭 시 접고 펼치기 (이벤트 위임: 목록이 새로 그려져도 계속 동작)
  function attachGroupToggleDelegation(){
    document.addEventListener('click', (e) => {
      const head = e.target.closest('.gsnav-group-head, .tile-group-head');
      if(!head) return;
      const expanded = head.getAttribute('aria-expanded') !== 'false';
      head.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });
  }

  function init(){
    injectStyle();
    build();
    attachGroupToggleDelegation();
    groupToolCardTiles(); // 캐시된 그룹 정보가 있으면 시트 응답 전에도 바로 적용
    refreshNavFromSheet();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
