/*
  경성고 교무 도구 — 공통 로그인 게이트
  ------------------------------------------------
  설정이 필요한 항목은 아래 CONFIG 부분입니다.
  1) GOOGLE_CLIENT_ID: Google Cloud Console에서 발급받은 OAuth 클라이언트 ID로 교체하세요.
     (console.cloud.google.com → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID 만들기
      → 애플리케이션 유형: 웹 애플리케이션 → 승인된 자바스크립트 원본에 Netlify 주소 추가)
  2) ALLOWED_DOMAIN: 로그인 허용할 학교 구글 계정 도메인.
  이 파일을 쓰는 모든 페이지의 <head>에는 아래 두 줄이 먼저 들어가 있어야 합니다.
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <script src="./auth.js" defer></script>
  그리고 <body> 바로 다음에 <div id="protected-content" style="display:none">로 기존 내용을
  감싸야 로그인 전에는 내용이 보이지 않습니다.
*/
(function(){
  // ====== CONFIG: 여기만 채우면 됩니다 ======
  const AUTH_ENABLED = false; // false로 두면 로그인 없이 누구나 바로 볼 수 있어요. 다시 켜려면 true로.
  const GOOGLE_CLIENT_ID = '913734706157-8rgqr9o26cuvtbbvv55jd4feffuucnrm.apps.googleusercontent.com'; // 발급받은 값을 기억해뒀어요 — AUTH_ENABLED를 true로 바꾸면 바로 다시 씁니다.
  const ALLOWED_DOMAIN = 'senedu.kr'; // 학교 구글 계정 도메인
  // ==========================================

  const SESSION_KEY = 'gs_auth_session';
  const SESSION_HOURS = 12;

  function parseJwt(token){
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  }

  function getSession(){
    try{
      const raw = sessionStorage.getItem(SESSION_KEY);
      if(!raw) return null;
      const s = JSON.parse(raw);
      if(Date.now() > s.exp){ sessionStorage.removeItem(SESSION_KEY); return null; }
      return s;
    }catch(e){ return null; }
  }

  function setSession(profile){
    const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(Object.assign({}, profile, { exp })));
  }

  function showApp(session){
    const gate = document.getElementById('auth-gate');
    const content = document.getElementById('protected-content');
    if(gate) gate.style.display = 'none';
    if(content) content.style.display = '';
    renderUserBadge(session);
  }

  function renderUserBadge(session){
    let badge = document.getElementById('auth-badge');
    if(!badge){
      badge = document.createElement('div');
      badge.id = 'auth-badge';
      badge.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;font-family:"Noto Sans KR",sans-serif;font-size:11.5px;background:#F8F4E8;border:1px solid #C7BC9C;border-radius:20px;padding:5px 12px;color:#5C5A47;display:flex;align-items:center;gap:8px;box-shadow:0 1px 4px rgba(0,0,0,0.08);';
      document.body.appendChild(badge);
    }
    badge.innerHTML = '<span>' + (session.name || session.email) + '</span>' +
      '<a href="#" id="auth-logout" style="color:#9E3A2C;text-decoration:underline;">로그아웃</a>';
    document.getElementById('auth-logout').addEventListener('click', function(e){
      e.preventDefault();
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    });
  }

  function renderGate(errorMsg){
    let gate = document.getElementById('auth-gate');
    if(!gate){
      gate = document.createElement('div');
      gate.id = 'auth-gate';
      document.body.insertBefore(gate, document.body.firstChild);
    }
    gate.style.cssText = 'position:fixed;inset:0;background:#ECE6D3;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;font-family:"Noto Sans KR",sans-serif;padding:20px;text-align:center;';
    gate.innerHTML =
      '<div style="font-family:\'Noto Serif KR\',serif;font-size:19px;font-weight:700;color:#262B25;margin-bottom:8px;">경성고 교무 도구</div>' +
      '<div style="font-size:13px;color:#5C5A47;margin-bottom:22px;">학교 구글 계정(@' + ALLOWED_DOMAIN + ')으로 로그인해주세요</div>' +
      '<div id="gsi-button"></div>' +
      (errorMsg ? '<div style="margin-top:16px;font-size:12.5px;color:#9E3A2C;max-width:320px;">' + errorMsg + '</div>' : '');
    const content = document.getElementById('protected-content');
    if(content) content.style.display = 'none';
  }

  function handleCredentialResponse(response){
    let payload;
    try{ payload = parseJwt(response.credential); } catch(e){ renderGate('로그인 처리 중 오류가 발생했습니다. 다시 시도해주세요.'); return; }
    const email = payload.email || '';
    const domain = email.split('@')[1] || '';
    if(!payload.email_verified || domain.toLowerCase() !== ALLOWED_DOMAIN.toLowerCase()){
      renderGate('학교 계정(@' + ALLOWED_DOMAIN + ')으로만 접근할 수 있어요. (' + email + ')');
      return;
    }
    const session = { email: email, name: payload.name || email, credential: response.credential };
    setSession(session);
    showApp(session);
  }

  function waitForGoogleAndInit(){
    if(!window.google || !window.google.accounts || !window.google.accounts.id){
      setTimeout(waitForGoogleAndInit, 200);
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse
    });
    const btn = document.getElementById('gsi-button');
    if(btn){
      google.accounts.id.renderButton(btn, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko' });
    }
  }

  function init(){
    if(!AUTH_ENABLED){
      const content = document.getElementById('protected-content');
      if(content) content.style.display = '';
      return;
    }
    const existing = getSession();
    if(existing){
      showApp(existing);
      return;
    }
    renderGate();
    waitForGoogleAndInit();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 다른 페이지 스크립트(예: 신청 폼)에서 로그인 정보를 쓸 수 있도록 공개
  window.__gsAuth = { getSession: getSession };
})();
