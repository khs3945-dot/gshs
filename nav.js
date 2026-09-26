/*
  경성고 교무 도구 — 공통 사이드 메뉴 (햄버거 버튼)
  ------------------------------------------------
  이 파일을 쓰는 모든 페이지의 <head>에 아래 한 줄만 넣으면 됩니다.
    <script src="./nav.js" defer></script>

  메뉴 목록은 아래 NAV_ITEMS에 직접 코드로 적어둡니다. 예전에는 구글시트(메뉴 편집기·
  사이트맵 동기화)에서 실시간으로 읽어왔지만, 시트 편집이 바로바로 정확히 반영되지 않는
  문제가 있어서 그 방식은 완전히 걷어냈어요. 메뉴를 추가·수정할 땐 아래 NAV_ITEMS 배열을
  직접 고치면 됩니다.
*/
(function(){
  // 새 페이지 추가·이름 변경 등 메뉴 수정은 이 배열을 직접 고치면 됩니다.
  // loginRequired: true인 항목은 목록에서 이름 뒤에 작은 별표(*)를 붙여서, 로그인해야
  // 쓸 수 있는 메뉴라는 걸 미리 알 수 있게 해요(안 그러면 눌러보고서야 로그인 화면을 만남).
  const DEFAULT_NAV_ITEMS = [
    { href: './index.html', label: '메인으로' },
    { href: './my-page.html', label: '나의 페이지', loginRequired: true },
    { href: './my-custom-page.html', label: '나만의 페이지', loginRequired: true },
    { href: './calendar.html', label: '캘린더', group: '일정' },
    { href: './date.html', label: '날짜로 보기' },
    { href: './teacher.html', label: '교사별 보기' },
    { href: './duty.html', label: '학생 지도 당번표', group: '일정' },
    { href: './duty-mobile.html', label: '오늘의 지도 당번 (모바일)', group: '일정' },
    { href: './teachers.html', label: '교사 시간표 조회·비교', group: '일정' },
    { href: './exams.html', label: '학생별 시험 시간표', group: '업무 도구', loginRequired: true },
    { href: './meal.html', label: '오늘의 급식', group: '일정' },
    { href: './weekplan.html', label: '주간계획', group: '일정' },
    { href: 'https://docs.google.com/spreadsheets/d/1iMAfIMc_4BLWTeYmIaiz_di6_xpJMWlDIlw-6myGNS8/edit?gid=1578855358#gid=1578855358', label: '교실 사용 예약', group: '업무 도구' },
    { href: './link-hub.html', label: '업무 링크 모음', group: '업무 도구' },
    { href: './collect.html', label: '제출함', group: '업무 도구' },
    { href: './shortcuts.html', label: '필수 단축키 모음', group: '업무 도구' },
    { href: './admin-tools.html', label: '교무 업무 도구', group: '업무 도구' },
    { href: './messages.html', label: '메시지함', group: '업무 도구', loginRequired: true },
    { href: './memo.html', label: '메모장', group: '업무 도구', loginRequired: true },
    { href: './chatbot-teacher.html', label: '교사용 챗봇', group: '업무 도구', loginRequired: true },
    { href: './my-bot.html', label: '나만의 챗봇 비서', group: '업무 도구', loginRequired: true },
    { href: './chatbot-builder.html', label: '챗봇 만들기', group: '업무 도구', loginRequired: true },
    { href: './announce.html', label: '공지사항 작성', group: '업무 도구', loginRequired: true }
  ];
  const DEFAULT_HREF_GROUP_MAP = {};
  DEFAULT_NAV_ITEMS.forEach(item => { if(item.group) DEFAULT_HREF_GROUP_MAP[item.href] = item.group; });

  // 예전 구글시트 연동 방식이 남긴 캐시가 있으면 지워요(더 이상 안 쓰임).
  try{ localStorage.removeItem('ks_nav_cache'); localStorage.removeItem('ks_nav_group_cache'); }catch(e){ /* 무시 */ }

  let NAV_ITEMS = DEFAULT_NAV_ITEMS;
  let HREF_GROUP_MAP = DEFAULT_HREF_GROUP_MAP;

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
    const mark = item.loginRequired ? '<sup class="gsnav-login-mark" title="로그인이 필요해요">*</sup>' : '';
    return `<li><a href="${item.href}" class="${activeCls.trim()}"${extAttrs}>${item.label}${mark}</a></li>`;
  }
  function renderNavListHtml(){
    const cur = currentFile();
    // 메인 페이지(index.html)는 항상 보이는 고정 아이콘 버튼으로 대체했으므로 목록에서는 빼요.
    // 나의 페이지(my-page.html)도 같은 아이콘 버튼이 있지만, 목록 맨 위에도 함께 보여서
    // "나의 페이지 → 나만의 페이지 → 날짜로 보기 → 교사별 보기" 순서가 바로 보이게 해요.
    const items = NAV_ITEMS.filter(it => it.href !== './index.html');
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

  // 메인/교무도구 타일 그리드(.card-list)를 HREF_GROUP_MAP 기준으로 묶어 접고 펼 수 있게 만듦.
  // 그룹이 하나도 없으면 손대지 않고 기존 그리드 그대로 둠. 최초 1회만 원본 타일 순서를
  // list.__gsnavAllCards에 저장해두고, 이후 호출에서는 그 원본을 기준으로 다시 나눠요
  // (이미 그룹 안에 들어간 DOM을 기준으로 하면 a.tool-card를 못 찾아서 두 번째부터 아무
  // 일도 안 일어나던 게 이 버그의 원인이었음).
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
      .gsnav-login-mark{ color: var(--crest-red, #EE2E22); margin-left:1px; }

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

      .gsnav-chat-fab{
        position:fixed; right:20px; bottom:80px; width:52px; height:52px; border-radius:50%;
        background: var(--stamp, #264085); color:#fff; border:none; font-size:21px; cursor:pointer;
        box-shadow:0 4px 14px rgba(0,0,0,0.25); z-index:9995;
      }
      .gsnav-chat-panel{
        position:fixed; right:20px; bottom:144px; width:320px; max-width:calc(100vw - 40px); height:420px;
        background: var(--paper-card, #FFFFFF); border:1px solid var(--rule, #C7BC9C); border-radius:12px;
        box-shadow:0 8px 30px rgba(0,0,0,0.22); display:none; flex-direction:column; overflow:hidden; z-index:9995;
        font-family:'Noto Sans KR', sans-serif;
      }
      .gsnav-chat-panel.open{ display:flex; }
      .gsnav-chat-head{ display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background: var(--stamp, #264085); color:#fff; font-size:13px; font-weight:700; flex-shrink:0; }
      .gsnav-chat-head button{ background:none; border:none; color:#fff; font-size:14px; cursor:pointer; }
      .gsnav-chat-messages{ flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px; }
      .gsnav-chat-msg{ max-width:82%; padding:7px 10px; border-radius:10px; font-size:12.5px; line-height:1.5; white-space:pre-wrap; word-break:break-word; }
      .gsnav-chat-msg.user{ align-self:flex-end; background: var(--stamp, #264085); color:#fff; border-bottom-right-radius:2px; }
      .gsnav-chat-msg.assistant{ align-self:flex-start; background: var(--paper, #F7F8FA); border:1px solid var(--rule-soft, #DAD1B6); border-bottom-left-radius:2px; }
      .gsnav-chat-typing{ align-self:flex-start; font-size:11.5px; color: var(--ink-soft, #5C5A47); padding:4px 10px; }
      .gsnav-chat-input-row{ display:flex; gap:6px; padding:10px; border-top:1px solid var(--rule-soft, #DAD1B6); flex-shrink:0; }
      .gsnav-chat-input-row textarea{ flex:1; resize:none; font-family:inherit; font-size:12.5px; padding:8px 9px; border:1px solid var(--rule, #C7BC9C); border-radius:8px; max-height:80px; }
      .gsnav-chat-input-row button{ flex-shrink:0; font-family:inherit; font-size:12.5px; font-weight:700; color:#fff; background: var(--ink, #262B25); border:none; border-radius:6px; padding:0 12px; cursor:pointer; }

      .gsnav-suggestion-apply{
        align-self:flex-start; font-family:inherit; font-size:12px; font-weight:700; color: var(--stamp, #264085);
        background: var(--stamp-soft, rgba(38,64,133,0.08)); border:1px solid var(--stamp, #264085); border-radius:8px;
        padding:7px 11px; cursor:pointer;
      }
      .gsnav-suggestion-apply:disabled{ opacity:0.6; cursor:default; }

      /* 나만의 페이지가 아닌 다른 페이지에서 뜨는 "교사용 챗봇" 플로팅 버튼: chatbot-teacher.html의
         위젯 화면을 그대로 iframe으로 담아서, 참고 자료 검색·음성 대화 같은 기능을 그대로 써요. */
      .gsnav-teacherchat-panel{ width:380px; height:560px; max-height:calc(100vh - 160px); }
      .gsnav-teacherchat-iframe{ flex:1; width:100%; border:none; }
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

  // ---------- 챗봇 플로팅 버튼 ----------
  // 나만의 페이지(my-custom-page.html)에서는 그 화면의 위젯 배치를 직접 바꿔주는
  // "나만의 페이지 도우미"(buildGlobalChat)를, 그 외 나머지 모든 페이지에서는 일반
  // 참고 자료 검색용 "교사용 챗봇"(buildTeacherChatFab)을 띄워요. 서로 목적이 다른
  // 챗봇이라 페이지에 안 맞는 쪽이 뜨면 혼란스러우니 딱 하나만 뜨게 나눠둬요.

  // 챗봇 버튼을 끌어다 옮길 수 있게 하는 공용 로직. 옮긴 위치는 이 브라우저에 기억해뒀다가
  // 다음에 어느 페이지를 열든 같은 자리에 뜨게 해요(페이지마다 버튼이 다시 기본 위치로
  // 돌아가면 헷갈리니까). 살짝 움직인 것만으로 클릭(패널 열기)이 씹히지 않도록, 일정
  // 거리 이상 끌었을 때만 "드래그"로 보고 그렇지 않으면 평소처럼 클릭으로 처리해요.
  const FAB_POS_KEY = 'ks_chat_fab_pos_v1';
  function loadFabPos(){
    try{ return JSON.parse(localStorage.getItem(FAB_POS_KEY)); }catch(e){ return null; }
  }
  function saveFabPos(pos){
    try{ localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos)); }catch(e){}
  }
  function positionPanelNearFab(fab, panelEl, panelWidth, panelHeight){
    const rect = fab.getBoundingClientRect();
    let left = rect.right - panelWidth;
    let top = rect.top - panelHeight - 12;
    if(top < 8) top = Math.min(rect.bottom + 12, window.innerHeight - panelHeight - 8);
    if(left < 8) left = 8;
    const maxLeft = window.innerWidth - panelWidth - 8;
    if(left > maxLeft) left = maxLeft;
    panelEl.style.left = left + 'px';
    panelEl.style.top = Math.max(8, top) + 'px';
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  }
  function applyFabPos(fab, panelEl, panelWidth, panelHeight, pos){
    const fabSize = 52;
    const maxLeft = window.innerWidth - fabSize - 8;
    const maxTop = window.innerHeight - fabSize - 8;
    const left = Math.min(Math.max(8, pos.left), Math.max(8, maxLeft));
    const top = Math.min(Math.max(8, pos.top), Math.max(8, maxTop));
    fab.style.left = left + 'px';
    fab.style.top = top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
    positionPanelNearFab(fab, panelEl, panelWidth, panelHeight);
  }
  function makeFabDraggable(fab, panelEl, panelWidth, panelHeight, onClick){
    const saved = loadFabPos();
    if(saved) applyFabPos(fab, panelEl, panelWidth, panelHeight, saved);
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    fab.style.touchAction = 'none';
    fab.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      const rect = fab.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      try{ fab.setPointerCapture(e.pointerId); }catch(err){}
    });
    fab.addEventListener('pointermove', (e) => {
      if(!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if(!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      applyFabPos(fab, panelEl, panelWidth, panelHeight, { left: startLeft + dx, top: startTop + dy });
    });
    function endDrag(){
      if(!dragging) return;
      dragging = false;
      if(moved){
        const rect = fab.getBoundingClientRect();
        saveFabPos({ left: rect.left, top: rect.top });
      }
    }
    fab.addEventListener('pointerup', endDrag);
    fab.addEventListener('pointercancel', endDrag);
    fab.addEventListener('click', () => {
      if(moved){ moved = false; return; }
      onClick();
      if(panelEl.classList.contains('open')) positionPanelNearFab(fab, panelEl, panelWidth, panelHeight);
    });
    window.addEventListener('resize', () => {
      const rect = fab.getBoundingClientRect();
      if(fab.style.left) applyFabPos(fab, panelEl, panelWidth, panelHeight, { left: rect.left, top: rect.top });
    });
  }

  // 챗봇 패널이 화면의 다른 버튼·내용과 겹쳐서 닫기 버튼에 손이 안 닿는 경우가 있어서,
  // 패널 위쪽 제목줄을 드래그해 옮길 수 있게 함(열려있는 동안만 유효 — 다시 열면
  // positionPanelNearFab이 원래 위치로 되돌려놓음. 위치를 굳이 저장하지 않는 건, 이건
  // "막힌 걸 잠깐 치우는" 용도지 패널의 기본 자리를 바꾸는 용도가 아니라서).
  function makePanelHeaderDraggable(panelEl){
    const head = panelEl.querySelector('.gsnav-chat-head');
    if(!head) return;
    head.style.cursor = 'move';
    head.style.touchAction = 'none';
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    head.addEventListener('pointerdown', (e) => {
      if(e.target.closest('button')) return; // 닫기 버튼 클릭은 드래그로 취급하지 않음
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      try{ head.setPointerCapture(e.pointerId); }catch(err){}
    });
    head.addEventListener('pointermove', (e) => {
      if(!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = Math.max(4, window.innerWidth - panelEl.offsetWidth - 4);
      const maxTop = Math.max(4, window.innerHeight - panelEl.offsetHeight - 4);
      panelEl.style.left = Math.min(Math.max(4, startLeft + dx), maxLeft) + 'px';
      panelEl.style.top = Math.min(Math.max(4, startTop + dy), maxTop) + 'px';
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
    });
    function endDrag(e){ dragging = false; try{ head.releasePointerCapture(e.pointerId); }catch(err){} }
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);
  }

  const CHAT_SUPABASE_URL = 'https://tmssupuskkajahpuswcj.supabase.co';
  const CHAT_SUPABASE_KEY = 'sb_publishable_g7j_5q6QSPfaYKHycDiU4w_oNZxJd4W';

  function loadSupabaseJs(){
    if(window.supabase) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('supabase-js 로드 실패'));
      document.head.appendChild(s);
    });
  }

  async function buildGlobalChat(){
    try{
      await loadSupabaseJs();
      const sb = window.supabase.createClient(CHAT_SUPABASE_URL, CHAT_SUPABASE_KEY);
      const { data: { session } } = await sb.auth.getSession();
      if(!session) return;
      const { data: profile } = await sb.from('profiles').select('approved').eq('id', session.user.id).maybeSingle();
      if(!profile || !profile.approved) return;

      const fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'gsnav-chat-fab';
      fab.title = '나만의 페이지 도우미';
      fab.textContent = '💬';

      const panelEl = document.createElement('div');
      panelEl.className = 'gsnav-chat-panel';
      panelEl.innerHTML = `
        <div class="gsnav-chat-head"><span>나만의 페이지 도우미</span><button type="button" class="gsnav-chat-close">✕</button></div>
        <div class="gsnav-chat-messages"></div>
        <div class="gsnav-chat-input-row">
          <textarea rows="1" placeholder="예: C칸에 할 일 넣어줘"></textarea>
          <button type="button" class="gsnav-chat-send">보내기</button>
        </div>
      `;
      document.body.appendChild(fab);
      document.body.appendChild(panelEl);
      makePanelHeaderDraggable(panelEl);

      const messagesEl = panelEl.querySelector('.gsnav-chat-messages');
      const inputEl = panelEl.querySelector('textarea');

      function appendBubble(role, text){
        const div = document.createElement('div');
        div.className = 'gsnav-chat-msg ' + (role === 'user' ? 'user' : 'assistant');
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      makeFabDraggable(fab, panelEl, 320, 420, () => panelEl.classList.toggle('open'));
      panelEl.querySelector('.gsnav-chat-close').addEventListener('click', () => panelEl.classList.remove('open'));

      let chatHistory = [];
      let sending = false;
      async function sendChat(){
        const text = inputEl.value.trim();
        if(!text || sending) return;
        sending = true;
        inputEl.value = '';
        appendBubble('user', text);
        chatHistory.push({ role: 'user', text });
        const typing = document.createElement('div');
        typing.className = 'gsnav-chat-typing';
        typing.textContent = '생각 중…';
        messagesEl.appendChild(typing);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        let res;
        try{
          const r = await fetch(CHAT_SUPABASE_URL + '/functions/v1/custom-page-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ message: text, history: chatHistory.slice(0, -1).slice(-10) }),
          });
          res = await r.json();
        }catch(e){
          res = { ok: false, error: '연결에 실패했어요.' };
        }
        typing.remove();
        sending = false;
        if(!res || !res.ok){
          appendBubble('assistant', (res && res.error) || '오류가 발생했어요.');
          return;
        }
        appendBubble('assistant', res.reply);
        chatHistory.push({ role: 'model', text: res.reply });
        // 나만의 페이지를 보고 있는 중에 위젯 배치가 바뀌었으면, 그 화면에도 바로 반영되도록 새로고침.
        if(res.changed && currentFile() === 'my-custom-page.html') location.reload();
      }
      panelEl.querySelector('.gsnav-chat-send').addEventListener('click', sendChat);
      inputEl.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); } });
    }catch(e){ /* 조용히 무시 — 챗봇 버튼이 안 뜨는 것 외엔 다른 기능에 영향 없음 */ }
  }

  // 나만의 페이지가 아닌 페이지들에 뜨는 일반 "교사용 챗봇" 플로팅 버튼. 채팅 UI를
  // nav.js 안에서 새로 만들지 않고, chatbot-teacher.html의 위젯 화면(?widget=1)을
  // 그대로 iframe에 담아서 참고 자료 검색·음성 대화 등 그 페이지의 기능을 그대로 써요.
  async function buildTeacherChatFab(){
    try{
      await loadSupabaseJs();
      const sb = window.supabase.createClient(CHAT_SUPABASE_URL, CHAT_SUPABASE_KEY);
      const { data: { session } } = await sb.auth.getSession();
      if(!session) return;
      const { data: profile } = await sb.from('profiles').select('approved').eq('id', session.user.id).maybeSingle();
      if(!profile || !profile.approved) return;

      const fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'gsnav-chat-fab';
      fab.title = '교사용 챗봇';
      fab.textContent = '💬';

      const panelEl = document.createElement('div');
      panelEl.className = 'gsnav-chat-panel gsnav-teacherchat-panel';
      panelEl.innerHTML = `
        <div class="gsnav-chat-head"><span>교사용 챗봇</span><button type="button" class="gsnav-chat-close">✕</button></div>
        <iframe class="gsnav-teacherchat-iframe" src="./chatbot-teacher.html?widget=1" allow="microphone" title="교사용 챗봇"></iframe>
      `;
      document.body.appendChild(fab);
      document.body.appendChild(panelEl);
      makePanelHeaderDraggable(panelEl);

      const teacherChatIframe = panelEl.querySelector('.gsnav-teacherchat-iframe');
      // 패널이 열릴 때마다(처음 로드된 iframe은 닫힌 채로 미리 그려져 있어서 그 시점엔
      // 맨 아래로 스크롤해도 높이 계산이 부정확해요) iframe 안의 채팅 화면에 "지금 열렸다"고
      // 알려서, 그때 다시 맨 아래로 스크롤하게 해요.
      makeFabDraggable(fab, panelEl, 380, 560, () => {
        const opening = !panelEl.classList.contains('open');
        panelEl.classList.toggle('open');
        if(opening && teacherChatIframe && teacherChatIframe.contentWindow){
          try{ teacherChatIframe.contentWindow.postMessage({ source:'gs-host-page', type:'panel-opened' }, location.origin); }catch(e){}
        }
      });
      panelEl.querySelector('.gsnav-chat-close').addEventListener('click', () => panelEl.classList.remove('open'));
    }catch(e){ /* 조용히 무시 — 챗봇 버튼이 안 뜨는 것 외엔 다른 기능에 영향 없음 */ }
  }

  // 챗봇 만들기 페이지 전용 도우미. 좋은 지침을 어떻게 쓰면 좋을지, 만들 때 뭘 조심해야
  // 하는지 조언해주고, 필요하면 제목·소개·유형·추가 지침·추천 질문을 직접 제안해서
  // "적용하기" 버튼 한 번으로 그 화면의 입력칸에 채워 넣어줘요(저장은 선생님이 직접).
  async function buildBuilderAssistantFab(){
    try{
      await loadSupabaseJs();
      const sb = window.supabase.createClient(CHAT_SUPABASE_URL, CHAT_SUPABASE_KEY);
      const { data: { session } } = await sb.auth.getSession();
      if(!session) return;
      const { data: profile } = await sb.from('profiles').select('approved').eq('id', session.user.id).maybeSingle();
      if(!profile || !profile.approved) return;

      const fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'gsnav-chat-fab';
      fab.title = '챗봇 만들기 도우미';
      fab.textContent = '💬';

      const panelEl = document.createElement('div');
      panelEl.className = 'gsnav-chat-panel';
      panelEl.innerHTML = `
        <div class="gsnav-chat-head"><span>챗봇 만들기 도우미</span><button type="button" class="gsnav-chat-close">✕</button></div>
        <div class="gsnav-chat-messages"></div>
        <div class="gsnav-chat-input-row">
          <textarea rows="1" placeholder="예: 탐구형 챗봇 지침 어떻게 써야 해?"></textarea>
          <button type="button" class="gsnav-chat-send">보내기</button>
        </div>
      `;
      document.body.appendChild(fab);
      document.body.appendChild(panelEl);
      makePanelHeaderDraggable(panelEl);

      const messagesEl = panelEl.querySelector('.gsnav-chat-messages');
      const inputEl = panelEl.querySelector('textarea');

      function fieldVal(id){ const e = document.getElementById(id); return e ? e.value : ''; }
      function readFormContext(){
        const typeCard = document.querySelector('.type-card.active');
        const suggestedRaw = fieldVal('fSuggested');
        return {
          title: fieldVal('fTitle'),
          description: fieldVal('fDesc'),
          presetType: typeCard ? typeCard.dataset.key : '',
          systemPrompt: fieldVal('fPrompt'),
          suggestedQuestions: suggestedRaw ? suggestedRaw.split('\n').map(s => s.trim()).filter(Boolean) : [],
        };
      }
      function applySuggestion(sugg){
        if(typeof sugg.title === 'string' && document.getElementById('fTitle')) document.getElementById('fTitle').value = sugg.title;
        if(typeof sugg.description === 'string' && document.getElementById('fDesc')) document.getElementById('fDesc').value = sugg.description;
        if(typeof sugg.systemPrompt === 'string' && document.getElementById('fPrompt')) document.getElementById('fPrompt').value = sugg.systemPrompt;
        if(Array.isArray(sugg.suggestedQuestions) && document.getElementById('fSuggested')) document.getElementById('fSuggested').value = sugg.suggestedQuestions.join('\n');
        if(sugg.presetType && ['guide', 'inquiry', 'summary'].includes(sugg.presetType)){
          const card = document.querySelector('.type-card[data-key="' + sugg.presetType + '"]');
          if(card) card.click();
        }
      }

      function appendBubble(role, text){
        const div = document.createElement('div');
        div.className = 'gsnav-chat-msg ' + (role === 'user' ? 'user' : 'assistant');
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      function appendSuggestionBubble(sugg){
        // 편집기가 열려 있어야(입력칸이 있어야) 적용할 곳이 있으니, 그때만 버튼을 보여줘요.
        if(!document.getElementById('fTitle')) return;
        const div = document.createElement('div');
        div.className = 'gsnav-chat-msg assistant';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gsnav-suggestion-apply';
        btn.textContent = '✅ 이 내용 적용하기';
        btn.addEventListener('click', () => {
          applySuggestion(sugg);
          btn.textContent = '적용했어요 (저장 버튼을 눌러야 저장돼요)';
          btn.disabled = true;
        });
        div.appendChild(btn);
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      panelEl.querySelector('.gsnav-chat-close').addEventListener('click', () => panelEl.classList.remove('open'));

      let chatHistory = [];
      let sending = false;
      async function sendChat(){
        const text = inputEl.value.trim();
        if(!text || sending) return;
        sending = true;
        inputEl.value = '';
        appendBubble('user', text);
        chatHistory.push({ role: 'user', text });
        const typing = document.createElement('div');
        typing.className = 'gsnav-chat-typing';
        typing.textContent = '생각 중…';
        messagesEl.appendChild(typing);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        let res;
        try{
          const r = await fetch(CHAT_SUPABASE_URL + '/functions/v1/chatbot-builder-assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            body: JSON.stringify({ message: text, history: chatHistory.slice(0, -1).slice(-10), context: readFormContext() }),
          });
          res = await r.json();
        }catch(e){
          res = { ok: false, error: '연결에 실패했어요.' };
        }
        typing.remove();
        sending = false;
        if(!res || !res.ok){
          appendBubble('assistant', (res && res.error) || '오류가 발생했어요.');
          return;
        }
        appendBubble('assistant', res.reply);
        chatHistory.push({ role: 'model', text: res.reply });
        if(res.suggestion && Object.keys(res.suggestion).length) appendSuggestionBubble(res.suggestion);
      }
      panelEl.querySelector('.gsnav-chat-send').addEventListener('click', sendChat);
      inputEl.addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendChat(); } });

      makeFabDraggable(fab, panelEl, 320, 460, () => panelEl.classList.toggle('open'));
    }catch(e){ /* 조용히 무시 — 챗봇 버튼이 안 뜨는 것 외엔 다른 기능에 영향 없음 */ }
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
    // 이 페이지가 다른 페이지의 위젯 iframe 안에 떠 있을 때(예: 나만의 페이지의 챗봇/할 일
    // 위젯)는 햄버거 메뉴·로그인 배지·전역 챗봇 버튼 같은 떠다니는 UI를 또 만들면 좁은
    // iframe 안에서 겹쳐 보이므로 아예 건너뜁니다.
    if(window.self !== window.top) return;
    injectStyle();
    build();
    attachGroupToggleDelegation();
    groupToolCardTiles();
    const cur = currentFile();
    if(cur === 'my-custom-page.html'){
      buildGlobalChat();
    } else if(cur === 'chatbot-builder.html'){
      // 챗봇 만들기 페이지에서는 위젯 배치용도, 일반 자료검색용도 아니라 "챗봇 만들기"
      // 자체를 도와주는 전용 도우미를 띄워요(지침 작성 조언 + 입력칸에 바로 채워넣기).
      buildBuilderAssistantFab();
    } else if(cur !== 'chatbot-teacher.html'){
      // chatbot-teacher.html 자기 자신 위에는 이미 같은 채팅 화면이 그대로 있으니
      // 떠다니는 버튼을 또 띄우지 않아요.
      buildTeacherChatFab();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
