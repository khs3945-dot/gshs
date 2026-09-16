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
    `;
    document.head.appendChild(style);
  }

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
