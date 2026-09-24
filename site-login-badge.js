/*
  경성고 교무 도구 — 로그인 상태 표시 배지 (교사용 주요 페이지 전용)
  ------------------------------------------------
  이 파일을 쓰는 페이지의 <head>에 아래 줄을 넣으면 됩니다 (supabase-js CDN 스크립트가
  이미 그 페이지 어딘가에 있다면 다시 안 넣어도 됩니다. 이 스크립트가 알아서 기다려요).
    <script src="./site-login-badge.js" defer></script>
  로그인 상태면 오른쪽 위에 "이름님 · 로그아웃"을, 로그아웃 상태면 "로그인"을 보여줘요.
  이 배지는 my-page.html 등에서 쓰는 이름+비밀번호 Supabase 로그인(login.html) 기준이에요.
*/
(function(){
  const SUPABASE_URL = 'https://tmssupuskkajahpuswcj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_g7j_5q6QSPfaYKHycDiU4w_oNZxJd4W';

  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderBadge(html){
    let badge = document.getElementById('site-login-badge');
    if(!badge){
      badge = document.createElement('div');
      badge.id = 'site-login-badge';
      badge.style.cssText = 'position:fixed;top:16px;right:64px;z-index:9998;font-family:"Noto Sans KR",sans-serif;font-size:12px;background:#FFFFFF;border:1px solid #C7BC9C;border-radius:20px;padding:7px 14px;color:#5C5A47;display:flex;align-items:center;gap:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);';
      document.body.appendChild(badge);
    }
    badge.innerHTML = html;
  }

  function waitFor(check, cb, attemptsLeft){
    if(check()){ cb(); return; }
    if(attemptsLeft <= 0) return;
    setTimeout(() => waitFor(check, cb, attemptsLeft - 1), 200);
  }

  function init(){
    // 다른 페이지의 위젯 iframe 안에 떠 있을 때는 이 떠다니는 배지도 겹쳐 보이므로 건너뜁니다.
    if(window.self !== window.top) return;
    waitFor(() => !!window.supabase, async () => {
      // 이 배지는 세션을 "읽기"만 하면 되는데, 옵션 없이 createClient를 부르면
      // 이 페이지에 이미 떠 있는 본문 스크립트의 Supabase 클라이언트와 별개로
      // 자기만의 클라이언트를 또 만들게 돼요. 두 클라이언트가 동시에 같은
      // refresh token으로 세션을 갱신하려고 하면 Supabase가 토큰을 회전시키면서
      // 뒤늦게 요청한 쪽은 "이미 사용된 토큰"이라는 오류로 세션을 null 취급하는
      // 경우가 있어요 — 로그인 돼 있는데도 배지에는 로그인 버튼이 나오는 원인이
      // 바로 이 레이스였습니다. autoRefreshToken을 꺼서 배지 쪽 클라이언트는
      // 갱신을 시도하지 않고 저장된 세션만 읽도록 했습니다.
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false }
      });
      const { data: { session } } = await sb.auth.getSession();
      if(!session){
        renderBadge('<a href="./login.html" style="color:#264085;text-decoration:none;font-weight:700;">로그인</a>');
        return;
      }
      const { data: profile } = await sb.from('profiles').select('name').eq('id', session.user.id).maybeSingle();
      const name = (profile && profile.name) || '선생님';
      renderBadge(`<span>${escapeHtml(name)}님</span><a href="#" id="siteLogoutLink" style="color:#9E3A2C;text-decoration:underline;">로그아웃</a>`);
      const link = document.getElementById('siteLogoutLink');
      if(link) link.addEventListener('click', async (e) => {
        e.preventDefault();
        await sb.auth.signOut();
        location.href = './index.html';
      });
    }, 25);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
