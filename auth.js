/*
  경성고 교무 도구 — 공통 로그인 게이트 + 구글 API 액세스 토큰 발급
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

  시트/문서/슬라이드 등 구글 API를 호출하고 싶은 페이지는 window.__gsAuth.requestAccessToken()을
  쓰면 됩니다. 자세한 사용법은 아래 requestAccessToken 함수 위 주석을 참고하세요.
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
      '<div style="font-family:\'Noto Sans KR\',sans-serif;font-size:19px;font-weight:700;color:#262B25;margin-bottom:8px;">경성고 교무 도구</div>' +
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

  // ====== 시트 / 문서 / 슬라이드 등 구글 API 호출용 액세스 토큰 ======
  // 로그인(위 handleCredentialResponse)과는 완전히 별개입니다. 로그인은 "누가 접속했는지"만
  // 확인하고, 시트/문서/슬라이드 API를 실제로 호출하려면 이 함수로 액세스 토큰을 따로 받아야 합니다.
  //
  // 사용 예 (버튼 클릭 등 사용자 동작 안에서 호출해야 팝업이 차단되지 않습니다):
  //   window.__gsAuth.requestAccessToken(window.__gsAuth.SCOPES.SHEETS, function(err, token){
  //     if(err){ alert('권한 요청에 실패했습니다: ' + err); return; }
  //     fetch('https://sheets.googleapis.com/v4/spreadsheets/시트ID/values/A1:append?valueInputOption=RAW', {
  //       method: 'POST',
  //       headers: { 'Authorization': 'Bearer ' + token },
  //       body: JSON.stringify({ values: [['새 값']] })
  //     });
  //   });
  // scope 자리에 [SCOPES.SHEETS, SCOPES.DOCS]처럼 배열을 넣으면 여러 권한을 한 번에 요청합니다.
  const tokenClients = {};
  // scope별 "지금 이 요청을 기다리는 콜백". initTokenClient의 callback은 스코프당 한 번만 만들어지고
  // 재사용되기 때문에, 매 요청마다 새 콜백을 직접 여기 등록해두고 그걸 대신 불러줘야 두 번째 이후
  // 호출(예: 불러오기 다음에 저장하기)에서도 그 호출 자신의 콜백이 실행됩니다.
  const pendingTokenCallbacks = {};
  const REQUEST_TIMEOUT_MS = 20000;

  function requestAccessToken(scope, callback){
    const scopeStr = Array.isArray(scope) ? scope.join(' ') : scope;

    if(!window.google || !window.google.accounts || !window.google.accounts.oauth2){
      setTimeout(function(){ requestAccessToken(scope, callback); }, 200);
      return;
    }

    let settled = false;
    const timeoutId = setTimeout(function(){
      if(settled) return;
      settled = true;
      callback('요청이 시간 초과되었습니다. 팝업 차단 여부를 확인한 뒤 다시 시도해주세요.', null);
    }, REQUEST_TIMEOUT_MS);
    pendingTokenCallbacks[scopeStr] = function(err, token){
      if(settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(err, token);
    };

    if(!tokenClients[scopeStr]){
      tokenClients[scopeStr] = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: scopeStr,
        callback: function(response){
          const cb = pendingTokenCallbacks[scopeStr];
          if(!cb) return;
          if(response.error){ cb(response.error, null); return; }
          cb(null, response.access_token);
        },
        error_callback: function(err){
          const cb = pendingTokenCallbacks[scopeStr];
          if(!cb) return;
          const type = err && err.type;
          const msg = type === 'popup_failed_to_open' ? '팝업이 차단되었습니다. 팝업 차단을 해제한 뒤 다시 시도해주세요.'
            : type === 'popup_closed' ? '권한 요청 창이 닫혔습니다. 다시 시도해주세요.'
            : (type || '권한 요청 중 오류가 발생했습니다.');
          cb(msg, null);
        }
      });
    }
    tokenClients[scopeStr].requestAccessToken();
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
  window.__gsAuth = {
    getSession: getSession,
    requestAccessToken: requestAccessToken,
    SCOPES: {
      SHEETS: 'https://www.googleapis.com/auth/spreadsheets',
      DOCS: 'https://www.googleapis.com/auth/documents',
      SLIDES: 'https://www.googleapis.com/auth/presentations'
    }
  };
})();
