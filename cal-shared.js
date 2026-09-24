/*
  경성고 교무 도구 — 캘린더(월보기/주보기) 공용 스크립트
  ------------------------------------------------
  calendar.html(월보기)과 calendar-week.html(주보기)이 함께 쓰는 로직을 한 곳에
  모아둠: 3가지 토글(내 할일/학교 캘린더/학사일정) 상태 저장, 각 소스에서
  날짜별 이벤트를 모아오는 함수들.

  "내 할일"은 이 사이트(Supabase)·Microsoft To Do·Google Tasks 세 곳을 모두
  합쳐서 보여주는데, MS/Google은 이미 로그인(연결)한 적 있는 사람에게만 조용히
  다시 연결을 시도해요(한 번도 연결 안 한 방문자에게 예고 없이 구글 인증 화면이
  뜨는 걸 막기 위한 사이트 공통 규칙 — my-todo.html의 GT_EVER_CONNECTED_KEY와
  동일한 패턴).
*/
window.KsCal = (function(){
  const TOGGLE_KEY = 'ks_cal_toggles';
  function loadToggles(){
    try{
      const raw = JSON.parse(localStorage.getItem(TOGGLE_KEY));
      return Object.assign({ tasks: true, gcal: true, academic: true }, raw || {});
    }catch(e){ return { tasks: true, gcal: true, academic: true }; }
  }
  function saveToggles(t){ try{ localStorage.setItem(TOGGLE_KEY, JSON.stringify(t)); }catch(e){} }

  const GCAL_API_KEY = 'AIzaSyDjh2BQst5LQZq76ZlZyizUTiv-edD2_DY';
  const GCAL_CALENDAR_ID = '5593aba1190c08f999c1299b6e576f0c4adee288d2fe94d6fa38000dd1e7b9f7@group.calendar.google.com';

  const SUPABASE_URL = 'https://tmssupuskkajahpuswcj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_g7j_5q6QSPfaYKHycDiU4w_oNZxJd4W';

  const MS_CLIENT_ID = '011c5b13-af42-426b-8f41-641ac40b10ff';
  const MS_SCOPES = ['Tasks.ReadWrite', 'User.Read'];
  const GOOGLE_CLIENT_ID = '913734706157-8rgqr9o26cuvtbbvv55jd4feffuucnrm.apps.googleusercontent.com';
  const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
  const GT_TOKEN_KEY = 'ks_todo_google_token';
  const GT_EVER_CONNECTED_KEY = 'ks_todo_google_ever_connected';

  function pad(n){ return String(n).padStart(2, '0'); }
  function fmtKey(y, m, d){ return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function dateKey(d){ return fmtKey(d.getFullYear(), d.getMonth(), d.getDate()); }

  // startKey/endKey: 'YYYY-MM-DD' 문자열(양끝 포함 범위)
  async function fetchGcalEvents(startKey, endKey){
    const out = {};
    if(!GCAL_API_KEY) return out;
    try{
      const timeMin = new Date(startKey + 'T00:00:00').toISOString();
      const timeMax = new Date(endKey + 'T23:59:59').toISOString();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GCAL_CALENDAR_ID)}/events?key=${GCAL_API_KEY}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=2500`;
      const res = await fetch(url);
      if(!res.ok) return out;
      const data = await res.json();
      (data.items || []).forEach(ev => {
        const isAllDay = !!(ev.start && ev.start.date);
        const startStr = isAllDay ? ev.start.date : (ev.start && ev.start.dateTime);
        if(!startStr) return;
        const key = isAllDay ? startStr : startStr.slice(0, 10);
        if(!out[key]) out[key] = [];
        out[key].push({
          isAllDay,
          time: isAllDay ? null : startStr.slice(11, 16),
          summary: ev.summary || '(제목 없음)',
          startISO: isAllDay ? null : startStr,
          endISO: isAllDay ? null : (ev.end && ev.end.dateTime) || null
        });
      });
    }catch(e){}
    return out;
  }

  async function getSupabaseSession(){
    try{
      if(!window.supabase) return null;
      const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: { session } } = await sb.auth.getSession();
      if(!session) return null;
      return { sb, session };
    }catch(e){ return null; }
  }

  async function fetchSupabaseTasks(sb, session, startKey, endKey){
    const out = {};
    try{
      const uid = session.user.id;
      const startISO = new Date(startKey + 'T00:00:00').toISOString();
      const endISO = new Date(endKey + 'T23:59:59').toISOString();
      const { data: owned } = await sb.from('tasks').select('id,title,due_at').eq('owner_id', uid).gte('due_at', startISO).lte('due_at', endISO);
      const { data: myAssigns } = await sb.from('task_assignments').select('task_id').eq('assignee_id', uid);
      const assignedIds = (myAssigns || []).map(a => a.task_id);
      let assignedTasks = [];
      if(assignedIds.length){
        const { data } = await sb.from('tasks').select('id,title,due_at').in('id', assignedIds).gte('due_at', startISO).lte('due_at', endISO);
        assignedTasks = data || [];
      }
      const seen = new Set();
      [...(owned || []), ...assignedTasks].forEach(t => {
        if(!t.due_at || seen.has(t.id)) return;
        seen.add(t.id);
        const key = t.due_at.slice(0, 10);
        if(!out[key]) out[key] = [];
        out[key].push({ source: '할일', title: t.title || '(제목 없음)', time: t.due_at.slice(11, 16) });
      });
    }catch(e){}
    return out;
  }

  let msalAppSingleton = null;
  async function fetchMsTasks(startKey, endKey){
    const out = {};
    if(!window.msal) return out;
    try{
      if(!msalAppSingleton){
        msalAppSingleton = new msal.PublicClientApplication({
          auth: { clientId: MS_CLIENT_ID, authority: 'https://login.microsoftonline.com/common', redirectUri: location.href },
          cache: { cacheLocation: 'localStorage' }
        });
        await msalAppSingleton.initialize();
        await msalAppSingleton.handleRedirectPromise().catch(() => null);
      }
      const accs = msalAppSingleton.getAllAccounts();
      if(!accs.length) return out;
      const r = await msalAppSingleton.acquireTokenSilent({ scopes: MS_SCOPES, account: accs[0] }).catch(() => null);
      if(!r) return out;
      const token = r.accessToken;
      const listsRes = await fetch('https://graph.microsoft.com/v1.0/me/todo/lists', { headers: { Authorization: 'Bearer ' + token } });
      if(!listsRes.ok) return out;
      const lists = ((await listsRes.json()).value) || [];
      for(const list of lists){
        const tRes = await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(list.id)}/tasks?$filter=status ne 'completed'`, { headers: { Authorization: 'Bearer ' + token } });
        if(!tRes.ok) continue;
        const tasks = ((await tRes.json()).value) || [];
        tasks.forEach(t => {
          const dueStr = t.dueDateTime && t.dueDateTime.dateTime;
          if(!dueStr) return;
          const key = dueStr.slice(0, 10);
          if(key < startKey || key > endKey) return;
          if(!out[key]) out[key] = [];
          out[key].push({ source: 'MS', title: t.title || '(제목 없음)' });
        });
      }
    }catch(e){}
    return out;
  }

  function gtEverConnected(){
    try{ return localStorage.getItem(GT_EVER_CONNECTED_KEY) === '1'; }catch(e){ return false; }
  }
  function gtLoadStoredToken(){
    try{
      const raw = localStorage.getItem(GT_TOKEN_KEY);
      if(!raw) return null;
      const parsed = JSON.parse(raw);
      if(!parsed.access_token || !parsed.expires_at) return null;
      if(Date.now() > parsed.expires_at - 60000) return null;
      return parsed.access_token;
    }catch(e){ return null; }
  }
  function gtWaitForGis(attemptsLeft){
    return new Promise((resolve) => {
      function check(left){
        if(window.google && google.accounts && google.accounts.oauth2){ resolve(true); return; }
        if(left <= 0){ resolve(false); return; }
        setTimeout(() => check(left - 1), 300);
      }
      check(attemptsLeft);
    });
  }
  async function gtTrySilentToken(){
    if(!gtEverConnected()) return null;
    const stored = gtLoadStoredToken();
    if(stored) return stored;
    // GIS 스크립트는 async defer라서 이 시점엔 아직 로드 전일 수 있어요. 최대 3초 정도 기다려요.
    const ready = await gtWaitForGis(10);
    if(!ready) return null;
    return new Promise((resolve) => {
      try{
        const client = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_TASKS_SCOPE,
          callback: (resp) => {
            if(resp.error){ resolve(null); return; }
            try{
              localStorage.setItem(GT_TOKEN_KEY, JSON.stringify({ access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in || 3600) * 1000) }));
            }catch(e){}
            resolve(resp.access_token);
          }
        });
        client.requestAccessToken({ prompt: '' });
      }catch(e){ resolve(null); }
    });
  }
  async function fetchGtTasks(startKey, endKey){
    const out = {};
    try{
      const token = await gtTrySilentToken();
      if(!token) return out;
      const listsRes = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', { headers: { Authorization: 'Bearer ' + token } });
      if(!listsRes.ok) return out;
      const lists = ((await listsRes.json()).items) || [];
      for(const list of lists){
        const tRes = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false`, { headers: { Authorization: 'Bearer ' + token } });
        if(!tRes.ok) continue;
        const tasks = ((await tRes.json()).items) || [];
        tasks.forEach(t => {
          if(!t.due) return;
          const key = t.due.slice(0, 10);
          if(key < startKey || key > endKey) return;
          if(!out[key]) out[key] = [];
          out[key].push({ source: 'Google', title: t.title || '(제목 없음)' });
        });
      }
    }catch(e){}
    return out;
  }

  function mergeByKey(...maps){
    const out = {};
    maps.forEach(m => {
      Object.keys(m).forEach(key => {
        if(!out[key]) out[key] = [];
        out[key] = out[key].concat(m[key]);
      });
    });
    return out;
  }

  // "내 할일" 세 소스를 한 번에 모아오는 헬퍼. 로그인 안 했거나 MS/Google을 연결한
  // 적 없으면 해당 소스는 조용히 빈 결과를 돌려줌(에러 아님).
  async function fetchAllMyTasks(startKey, endKey){
    const supa = await getSupabaseSession();
    const [supabaseTasks, msTasks, gtTasks] = await Promise.all([
      supa ? fetchSupabaseTasks(supa.sb, supa.session, startKey, endKey) : {},
      fetchMsTasks(startKey, endKey),
      fetchGtTasks(startKey, endKey)
    ]);
    return mergeByKey(supabaseTasks, msTasks, gtTasks);
  }

  // 이번주 브리핑(my-page.html·my-custom-page.html 둘 다)이 "이번주(월~일)에 짚을 만한
  // 항목" 목록을 만드는 공용 로직이에요. 두 페이지가 각자 따로 만들면 항목 구성이
  // 조금씩 달라져서 같은 주라도 해시가 안 맞아 캐시(week_briefs)를 못 나눠 쓰는
  // 문제가 있었어요 — 한쪽에서 이미 만든 브리핑을 다른 쪽에서도 그대로 불러쓰려면
  // 항목 목록이 항상 똑같아야 해서 이 함수로 합쳤어요.
  async function fetchWeekBriefItems(profileName, eventsByDate, dutyRoleLabels){
    const today = new Date();
    const dow = today.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today); monday.setDate(today.getDate() + mondayOffset); monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const startKey = dateKey(monday), endKey = dateKey(sunday);

    const items = [];
    for(let d = new Date(monday); d <= sunday; d.setDate(d.getDate() + 1)){
      (eventsByDate[dateKey(d)] || []).forEach(title => items.push({ date: dateKey(d), text: '학사일정: ' + title }));
    }
    if(profileName){
      try{
        const supa = await getSupabaseSession();
        if(supa){
          const { data: dutyRows } = await supa.sb.from('duty_roster').select('*').gte('date', startKey).lte('date', endKey).order('date');
          (dutyRows || []).forEach(row => {
            Object.keys(dutyRoleLabels).forEach(key => {
              if(row[key] === profileName) items.push({ date: row.date, text: dutyRoleLabels[key] + (row.event ? ' · ' + row.event : '') });
            });
          });
        }
      }catch(e){ /* 지도 일정을 못 불러와도 나머지 항목으로 계속 진행 */ }
    }
    const taskMap = await fetchAllMyTasks(startKey, endKey);
    Object.keys(taskMap).forEach(k => { taskMap[k].forEach(t => items.push({ date: k, text: '할 일: ' + t.title })); });
    items.sort((a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
    return { startKey, endKey, items };
  }

  return {
    loadToggles, saveToggles, pad, fmtKey, dateKey,
    fetchGcalEvents, fetchAllMyTasks, mergeByKey, fetchWeekBriefItems
  };
})();
