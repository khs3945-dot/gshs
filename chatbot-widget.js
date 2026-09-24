/*
  경성고 교무 도구 — 플로팅 챗봇 버튼
  ------------------------------------------------
  이 파일을 쓰는 페이지의 <head>에 아래 줄을 넣으면 됩니다 (supabase-js CDN 스크립트가
  이미 그 페이지 어딘가에 있다면 다시 안 넣어도 됩니다. 이 스크립트가 알아서 기다려요).
    <script src="./chatbot-widget.js" defer></script>
  로그인 + 승인된 선생님에게만 오른쪽 아래에 챗봇 버튼을 띄우고, 누르면 작은 채팅창을
  팝업으로 보여줘요. 채팅 로직을 여기서 다시 만들지 않고, chatbot-teacher.html을
  ?widget=1로 iframe에 그대로 불러와서 재사용해요(같은 코드 두 곳에 두지 않으려고).
*/
(function(){
  const SUPABASE_URL = 'https://tmssupuskkajahpuswcj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_g7j_5q6QSPfaYKHycDiU4w_oNZxJd4W';

  function waitFor(check, cb, attemptsLeft){
    if(check()){ cb(); return; }
    if(attemptsLeft <= 0) return;
    setTimeout(() => waitFor(check, cb, attemptsLeft - 1), 200);
  }

  function injectStyle(){
    const style = document.createElement('style');
    style.textContent = `
      .ks-chatbot-fab{
        position:fixed; right:20px; bottom:20px; z-index:9995;
        width:52px; height:52px; border-radius:50%; padding:0;
        background: var(--stamp, #264085); color:#fff;
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,0.25); border:none;
        transition: transform 0.15s;
      }
      .ks-chatbot-fab:hover{ transform: scale(1.06); }
      .ks-chatbot-fab svg{ width:26px; height:26px; }
      .ks-chatbot-panel{
        position:fixed; right:20px; bottom:84px; z-index:9995;
        width:360px; max-width:90vw; height:560px; max-height:75vh;
        background:#fff; border-radius:14px; overflow:hidden;
        box-shadow:0 12px 40px rgba(0,0,0,0.25);
        display:none; flex-direction:column;
        border:1px solid #C7BC9C;
      }
      .ks-chatbot-panel.open{ display:flex; }
      .ks-chatbot-panel-head{
        display:flex; align-items:center; justify-content:space-between;
        padding:12px 14px; background: var(--stamp, #264085); color:#fff;
        font-family:'Noto Sans KR', sans-serif; font-size:13.5px; font-weight:700; flex-shrink:0;
      }
      .ks-chatbot-panel-head button{
        background:none; border:none; color:#fff; font-size:18px; cursor:pointer; line-height:1; padding:2px 6px;
      }
      .ks-chatbot-panel iframe{ flex:1; border:none; width:100%; min-height:0; }
      @media (max-width: 480px){
        .ks-chatbot-panel{ right:10px; left:10px; width:auto; bottom:78px; }
        .ks-chatbot-fab{ right:16px; bottom:16px; }
      }
    `;
    document.head.appendChild(style);
  }

  function build(){
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'ks-chatbot-fab';
    fab.id = 'ksChatbotFab';
    fab.setAttribute('aria-label', '교사용 챗봇 열기');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

    const panel = document.createElement('div');
    panel.className = 'ks-chatbot-panel';
    panel.id = 'ksChatbotPanel';
    panel.innerHTML = `
      <div class="ks-chatbot-panel-head">
        <span>교사용 챗봇</span>
        <button type="button" id="ksChatbotClose" aria-label="닫기">✕</button>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    let iframeLoaded = false;
    function open(){
      if(!iframeLoaded){
        const iframe = document.createElement('iframe');
        iframe.src = './chatbot-teacher.html?widget=1';
        iframe.allow = 'microphone'; // 팝업 안에서도 마이크 음성 입력이 되게(같은 사이트라 권한 프롬프트는 그대로 떠요)
        panel.appendChild(iframe);
        iframeLoaded = true;
      }
      panel.classList.add('open');
    }
    function close(){ panel.classList.remove('open'); }

    fab.addEventListener('click', () => {
      if(panel.classList.contains('open')) close(); else open();
    });
    panel.querySelector('#ksChatbotClose').addEventListener('click', close);
  }

  function init(){
    waitFor(() => !!window.supabase, async () => {
      // 이 위젯은 세션을 "읽기"만 하면 되는데(버튼을 보여줄지 말지 판단), 옵션 없이
      // createClient를 부르면 이 페이지의 다른 스크립트가 만든 클라이언트와 별개로
      // 자기만의 클라이언트를 또 만들게 돼요. 두 클라이언트가 동시에 세션을 갱신하려다
      // 레이스가 나는 걸 막기 위해(site-login-badge.js와 같은 이유) autoRefreshToken을 꺼요.
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false }
      });
      const { data: { session } } = await sb.auth.getSession();
      if(!session) return;
      const { data: profile } = await sb.from('profiles').select('approved').eq('id', session.user.id).maybeSingle();
      if(!profile || !profile.approved) return;
      injectStyle();
      build();
    }, 25);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
