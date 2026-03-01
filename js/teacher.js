// ============================================================
// GHARS CLUB — Teacher JS v4
// ============================================================
'use strict';

let currentPage = 'home';
let pageHistory = [];
let countdownTimer = null;
let attendanceData = {};
let currentMeetingForAttendance = null;
let hwQuestionCount = 0;
let choiceCounts = {};
let lessonVideoSource = null;
let editingLessonId = null;
let editingHwId = null;
let memoTargetValue = 0;
let hwHideGradeEnabled = false;
let _hwTimers = {};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth('teacher')) return;
  const user = Auth.currentUser;
  setEl('headerUserName', user.name);
  setEl('sidebarUserName', user.name);
  const av = document.getElementById('headerAvatar');
  if (av) av.textContent = user.name.charAt(0);
  if (user.role === 'admin') {
    const ti = document.getElementById('addTeacherNavItem');
    if (ti) ti.style.display = 'flex';
  }

  // Restore page from hash on load
  const hash = location.hash.replace('#','');
  const validPages = ['home','homework','students','meetings','points','memorization',
    'groups','seerah','teachers','stats','reports','add-homework','add-lesson',
    'add-meeting','attendance','create-report','view-report'];
  const startPage = validPages.includes(hash) ? hash : 'home';

  await loadHomeStats();
  await loadUpcomingMeeting();
  await loadLastSeen();
  await loadReports();

  navigate(startPage, true);
  setupRealtimeListeners();

  // Listen to browser back/forward
  window.addEventListener('popstate', (e) => {
    const p = (e.state && e.state.page) ? e.state.page : 'home';
    navigateSilent(p);
  });
});

// ============================================================
// NAVIGATION
// ============================================================
function navigate(page, skipHistory = false) {
  if (!skipHistory) {
    pageHistory.push(currentPage);
    history.pushState({ page }, '', '#' + page);
  } else {
    history.replaceState({ page }, '', '#' + page);
  }
  _activatePage(page);
}

function navigateSilent(page) {
  _activatePage(page);
}

function _activatePage(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById('section-' + page);
  if (sec) {
    sec.classList.add('active');
    // re-trigger animation
    sec.style.animation = 'none';
    sec.offsetHeight; // reflow
    sec.style.animation = '';
  }
  document.querySelectorAll('.nav-item').forEach(item =>
    item.classList.toggle('active', item.dataset.page === page));
  currentPage = page;
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  onPageLoad(page);
}

function onPageLoad(page) {
  switch(page) {
    case 'home':         loadHomeStats(); loadLastSeen(); loadReports(); loadUpcomingMeeting(); break;
    case 'homework':     loadHomework(); break;
    case 'students':     loadStudents(); break;
    case 'meetings':     loadMeetings(); break;
    case 'points':       loadPoints(); break;
    case 'memorization': loadMemorization(); break;
    case 'groups':       loadGroups(); break;
    case 'seerah':       loadSeerah(); break;
    case 'teachers':     loadTeachers(); break;
    case 'stats':        break;
    case 'reports':      loadReports(); break;
    case 'add-homework':
      // Always fresh form unless editing
      if (!editingHwId) {
        hwQuestionCount = 0; choiceCounts = {};
        hwHideGradeEnabled = false;
        setEl('hwTitle', null, 'value', '');
        setEl('hwDeadline', null, 'value', '');
        setEl('hwTimeLimit', null, 'value', '');
        const qc = document.getElementById('questionsContainer');
        if (qc) qc.innerHTML = '';
        const ft = document.getElementById('hwFormTitle');
        if (ft) ft.textContent = '➕ إضافة واجب جديد';
        updateHideGradeUI();
        loadMeetingsForSelect('hwLinkMeeting').then(() => {
          // 2 default choices per question
          addQuestion();
        });
      } else {
        loadMeetingsForSelect('hwLinkMeeting');
      }
      break;
    case 'add-lesson':
      if (!editingLessonId) resetLessonForm();
      loadMeetingsForSelect('lessonLinkMeeting');
      loadHwForSelect('lessonLinkHw');
      break;
    case 'attendance':   loadAttendancePage(); break;
    case 'create-report': setupReportForm(); break;
  }
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  const opening = !sb.classList.contains('open');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
  // Add ripple to nav items when opening
  if (opening) addNavRipples();
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}
function addNavRipples() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', navRipple, {once:true});
  });
}
function navRipple(e) {
  const btn = e.currentTarget;
  const r = document.createElement('span');
  r.className = 'ripple-effect';
  const size = Math.max(btn.offsetWidth, btn.offsetHeight);
  r.style.cssText = `width:${size}px;height:${size}px;top:50%;left:50%;margin-top:-${size/2}px;margin-left:-${size/2}px`;
  btn.appendChild(r);
  setTimeout(() => r.remove(), 700);
}

// ============================================================
// REALTIME
// ============================================================
function setupRealtimeListeners() {
  GharsDB.listen('meetings', () => {
    loadUpcomingMeeting();
    if (currentPage==='meetings') loadMeetings();
  });
  GharsDB.listen('homework', () => { if (currentPage==='homework') loadHomework(); });
  GharsDB.listen('users', () => {
    loadHomeStats(); loadLastSeen();
    if (currentPage==='students') loadStudents();
    if (currentPage==='teachers') loadTeachers();
    if (currentPage==='points') loadPoints();
    if (currentPage==='memorization') loadMemorization();
  });
  GharsDB.listen('groups', () => {
    loadHomeStats();
    if (currentPage==='groups') loadGroups();
  });
}

// ============================================================
// HOME STATS
// ============================================================
async function loadHomeStats() {
  const [users, groups, memoData, pointsData] = await Promise.all([
    GharsDB.getAll('users'), GharsDB.getAll('groups'),
    GharsDB.getAll('memorization'), GharsDB.getAll('points_summary')
  ]);
  const students = Object.values(users).filter(u => u.role==='student');
  setEl('statTotalStudents', students.length);
  setEl('statTotalGroups', Object.keys(groups).length);

  let topMemo = null, topMemoVal = -1;
  let topPts = null, topPtsVal = -1;
  students.forEach(s => {
    const mv = memoData[s.id]?.score||0;
    if (mv > topMemoVal) { topMemoVal=mv; topMemo=s; }
    const pv = pointsData[s.id]?.total||0;
    if (pv > topPtsVal) { topPtsVal=pv; topPts=s; }
  });
  setEl('statTopMemo', topMemo ? topMemo.name.split(' ')[0] : '-');
  setEl('statTopPoints', topPts ? topPts.name.split(' ')[0] : '-');
  const sorted = Object.values(groups).sort((a,b)=>(b.points||0)-(a.points||0));
  setEl('statTopGroup', sorted[0] ? sorted[0].name : '-');
}

function setEl(id, val, prop='textContent', propVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (prop==='textContent') el.textContent = val;
  else el[prop] = propVal !== undefined ? propVal : val;
}

async function loadUpcomingMeeting() {
  if (countdownTimer) clearInterval(countdownTimer);
  const meetings = await GharsDB.getAll('meetings');
  const now = Date.now();
  const upcoming = Object.values(meetings)
    .filter(m => !m.deleted && new Date(m.date).getTime() > now)
    .sort((a,b) => new Date(a.date)-new Date(b.date));
  const bar = document.getElementById('countdownBar');
  if (!upcoming.length) { if(bar) bar.style.display='none'; return; }
  const next = upcoming[0];
  if(bar) bar.style.display='flex';
  const tt = document.getElementById('cdMeetingTitle');
  if(tt) tt.textContent = next.title||'';
  countdownTimer = GharsUtils.countdown(next.date, ({done,days,hours,minutes,seconds}) => {
    if(done){ if(bar) bar.style.display='none'; clearInterval(countdownTimer); return; }
    ['Days','Hours','Mins','Secs'].forEach((k,i)=>{
      const el=document.getElementById('cd'+k);
      if(el) el.textContent=String([days,hours,minutes,seconds][i]).padStart(2,'0');
    });
  });
}

async function loadLastSeen() {
  const users = await GharsDB.getAll('users');
  const students = Object.values(users).filter(u=>u.role==='student');
  const c = document.getElementById('lastSeenList');
  if (!c) return;
  if (!students.length) { c.innerHTML = noData('👤','لا يوجد طلاب'); return; }
  c.innerHTML = students.map((s,i) => {
    const ts = s.lastSeen ? GharsUtils.formatTime(new Date(s.lastSeen)) : '';
    return `<div class="seen-row" style="animation-delay:${i*0.05}s">
      <div class="seen-avatar">${s.name.charAt(0)}</div>
      <div style="flex:1;min-width:0">
        <div class="seen-name">${e(s.name)}</div>
        ${s.lastSeen
          ? `<div style="font-size:0.76rem;color:var(--gold-dark);font-weight:700">${e(s.lastSeenDay||'')}</div>
             <div style="font-size:0.74rem;color:var(--gray)">${e(s.lastSeenHijri||'')} · ${ts}</div>`
          : `<div style="font-size:0.76rem;color:var(--gray)">لم يسجل دخول</div>`}
      </div>
      ${s.lastSeen
        ? '<span class="badge badge-green" style="font-size:0.66rem">متصل</span>'
        : '<span class="badge badge-gray" style="font-size:0.66rem">غير متصل</span>'}
    </div>`;
  }).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}

// ============================================================
// STATS
// ============================================================
let activeStats = null;
function showStatsPage() { navigate('stats'); }
function toggleStats(type) {
  const btn = event.currentTarget;
  const all = ['attendance','homework','memorization','points','groups'];
  if (activeStats===type) {
    document.getElementById('statsContent-'+type).style.display='none';
    document.querySelectorAll('.stats-toggle-btn').forEach(b=>b.classList.remove('active'));
    activeStats=null; return;
  }
  all.forEach(s=>{ const el=document.getElementById('statsContent-'+s); if(el)el.style.display='none'; });
  document.querySelectorAll('.stats-toggle-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('statsContent-'+type).style.display='block';
  btn.classList.add('active');
  activeStats=type;
  if(type==='attendance')  loadAttStats();
  else if(type==='homework')      loadHwStatsSelect();
  else if(type==='memorization')  loadMemoStats();
  else if(type==='points')        loadPointsStats();
  else if(type==='groups')        loadGroupStats();
}

async function loadAttStats() {
  const [users,meetings]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('meetings')]);
  const students=Object.values(users).filter(u=>u.role==='student');
  const mList=Object.values(meetings).filter(m=>!m.deleted);
  const tbody=document.getElementById('attendanceTbody'); if(!tbody) return;
  if(!students.length){tbody.innerHTML='<tr><td colspan="4" class="text-center text-gray">لا يوجد طلاب</td></tr>';return;}
  tbody.innerHTML=students.map(s=>{
    let p=0,ab=0,ex=0;
    mList.forEach(m=>{const st=m.attendance?.[s.id];if(st==='present')p++;else if(st==='absent')ab++;else if(st==='excused')ex++;});
    return `<tr><td>${e(s.name)}</td><td><span class="badge badge-green">${p}</span></td><td><span class="badge badge-red">${ab}</span></td><td><span class="badge badge-orange">${ex}</span></td></tr>`;
  }).join('');
}
async function loadHwStatsSelect() {
  const hw=await GharsDB.getAll('homework');
  const list=Object.values(hw).filter(h=>!h.deleted).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const sel=document.getElementById('hwStatsSelect'); if(!sel) return;
  sel.innerHTML='<option value="">اختر الواجب</option>'+list.map(h=>`<option value="${h.id}">${e(h.title)}</option>`).join('');
  if(list.length){sel.value=list[0].id;loadHwStats();}
}
async function loadHwStats() {
  const hwId=document.getElementById('hwStatsSelect')?.value;
  const cont=document.getElementById('hwStatsContent');
  if(!hwId||!cont) return;
  const [hw,users,subs,cheating]=await Promise.all([
    GharsDB.get('homework/'+hwId),GharsDB.getAll('users'),
    GharsDB.getAll('submissions'),GharsDB.getAll('cheating')
  ]);
  if(!hw){cont.innerHTML=noData('📚','الواجب غير موجود');return;}
  const students=Object.values(users).filter(u=>u.role==='student');
  const maxPts=(hw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
  cont.innerHTML=`<div class="table-wrapper"><table class="table"><thead><tr><th>الطالب</th><th>الحالة</th><th>الدرجة</th><th>الغش</th><th>تفاصيل</th></tr></thead><tbody>${
    students.map(s=>{
      const sub=Object.values(subs).find(sb=>sb.homeworkId===hwId&&sb.studentId===s.id);
      const cheat=cheating['cheat_'+hwId+'_'+s.id];
      const warns=cheat?.warnings||0;
      const status=sub?'<span class="badge badge-green">تم</span>':'<span class="badge badge-red">لم يحل</span>';
      const score=sub?`${sub.score||0}/${maxPts}`:'-';
      let cheatBadge='-';
      if(sub){
        if(warns===0)cheatBadge='<span class="cheat-clean">نظيف ✅</span>';
        else if(warns<=2)cheatBadge=`<span class="cheat-warn" style="cursor:pointer" onclick="showCheatDetails('${s.id}','${hwId}')">⚠️(${warns})</span>`;
        else cheatBadge=`<span class="cheat-severe" style="cursor:pointer" onclick="showCheatDetails('${s.id}','${hwId}')">🚫(${warns})</span>`;
      }
      const detail=sub?`<button class="btn btn-navy btn-sm" onclick="showStudentAnswers('${s.id}','${hwId}')">📋</button>`:'';
      return `<tr><td>${e(s.name)}</td><td>${status}</td><td>${score}</td><td>${cheatBadge}</td><td>${detail}</td></tr>`;
    }).join('')
  }</tbody></table></div>`;
}
async function showCheatDetails(studentId,hwId) {
  const [user,cheat]=await Promise.all([GharsDB.get('users/'+studentId),GharsDB.get('cheating/cheat_'+hwId+'_'+studentId)]);
  if(!cheat) return;
  const log=cheat.log||[];
  UI.showModal(`<div class="modal" style="max-width:460px">
    <div class="modal-header" style="background:linear-gradient(135deg,#742a2a,#c53030)">
      <h3>🚫 مخالفات — ${e(user?.name||'')}</h3><button class="modal-close">✖</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-error mb-2">إجمالي المخالفات: <strong>${cheat.warnings}</strong></div>
      ${log.map((entry,i)=>`<div style="padding:10px;background:#fff5f5;border-radius:8px;margin-bottom:6px;border-right:3px solid var(--red)">
        <div style="font-weight:700;font-size:0.82rem;color:var(--red)">المخالفة ${i+1}: ${e(entry.type)}</div>
        <div style="font-size:0.74rem;color:var(--gray);margin-top:2px">${GharsUtils.toHijriShort(new Date(entry.time))} · ${GharsUtils.formatTime(new Date(entry.time))}</div>
      </div>`).join('')||'<p class="text-gray text-center">لا توجد سجلات</p>'}
    </div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>إغلاق</button></div>
  </div>`);
}
async function showStudentAnswers(studentId,hwId) {
  const [hw,subs,user]=await Promise.all([GharsDB.get('homework/'+hwId),GharsDB.getAll('submissions'),GharsDB.get('users/'+studentId)]);
  const sub=Object.values(subs).find(s=>s.homeworkId===hwId&&s.studentId===studentId);
  if(!sub||!hw) return;
  const maxPts=(hw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
  UI.showModal(`<div class="modal" style="max-width:520px">
    <div class="modal-header"><h3>📋 أجوبة ${e(user?.name||'')} — ${e(hw.title)}</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div class="alert alert-info mb-2">الدرجة: <strong>${sub.score||0}/${maxPts}</strong></div>
      ${(hw.questions||[]).map((q,i)=>{
        const ans=sub.answers?.[i]??null; const ok=ans===q.correctAnswer;
        return `<div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:8px;border-right:3px solid ${ok?'var(--green)':'var(--red)'}">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:4px">س${i+1}: ${e(q.question)}</div>
          <div style="font-size:0.8rem">إجابته: <strong>${e(ans||'لم يجب')}</strong> ${ok?'✅':'❌'}</div>
          ${!ok?`<div style="font-size:0.8rem;color:var(--green)">الصحيحة: <strong>${e(q.correctAnswer)}</strong></div>`:''}
        </div>`;
      }).join('')}
    </div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>عودة</button></div>
  </div>`);
}
async function loadMemoStats() {
  const [users,memoData,settings]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('memorization'),GharsDB.get('system/settings')]);
  const students=Object.values(users).filter(u=>u.role==='student');
  const target=settings?.targetMemorization||30;
  const ranked=students.map(s=>({name:s.name,score:memoData[s.id]?.score||0})).sort((a,b)=>b.score-a.score);
  const tbody=document.getElementById('memoTbody'); if(!tbody) return;
  let rank=1;
  tbody.innerHTML=ranked.map((s,i)=>{
    if(i>0&&s.score<ranked[i-1].score) rank=i+1;
    const rc=rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'';
    return `<tr><td><span class="${rc}">${rank}</span></td><td>${e(s.name)}</td><td><strong>${s.score}</strong>/${target}</td></tr>`;
  }).join('');
}
async function loadPointsStats() {
  const [users,ptsData]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('points_summary')]);
  const students=Object.values(users).filter(u=>u.role==='student');
  const ranked=students.map(s=>({name:s.name,pts:ptsData[s.id]?.total||0})).sort((a,b)=>b.pts-a.pts);
  const tbody=document.getElementById('pointsTbody'); if(!tbody) return;
  let rank=1;
  tbody.innerHTML=ranked.map((s,i)=>{
    if(i>0&&s.pts<ranked[i-1].pts) rank=i+1;
    const rc=rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'';
    return `<tr><td><span class="${rc}">${rank}</span></td><td>${e(s.name)}</td><td><span class="badge badge-gold">⭐ ${s.pts}</span></td></tr>`;
  }).join('');
}
async function loadGroupStats() {
  const groups=await GharsDB.getAll('groups');
  const sorted=Object.values(groups).sort((a,b)=>(b.points||0)-(a.points||0));
  const tbody=document.getElementById('groupsTbody'); if(!tbody) return;
  let rank=1;
  tbody.innerHTML=sorted.map((g,i)=>{
    if(i>0&&(g.points||0)<(sorted[i-1].points||0)) rank=i+1;
    const rc=rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'';
    return `<tr><td><span class="${rc}">${rank}</span></td><td>${e(g.name)}</td><td><span class="badge badge-gold">🏆 ${g.points||0}</span></td></tr>`;
  }).join('');
}

// ============================================================
// HOMEWORK
// ============================================================
async function loadHomework() {
  const hw = await GharsDB.getAll('homework');
  const now = Date.now();
  const list = Object.values(hw).filter(h=>!h.deleted);
  // Auto-expire
  for (const h of list) {
    if (!h.expired && h.deadline && new Date(h.deadline).getTime() <= now) {
      await GharsDB.set('homework/'+h.id, {...h, expired:true});
      h.expired = true;
    }
  }
  const sent = list.filter(h => !h.expired);
  const done = list.filter(h =>  h.expired);
  renderSentHw(sent);
  renderDoneHw(done);
}

function renderSentHw(list) {
  const c = document.getElementById('sentHwList');
  if (!list.length) { c.innerHTML = noData('📤','لا توجد واجبات مرسلة'); return; }
  c.innerHTML = list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    .map((hw,i) => hwCardV2(hw, false, i)).join('');
  startHwTimers();
}
function renderDoneHw(list) {
  const c = document.getElementById('doneHwList');
  if (!list.length) { c.innerHTML = noData('✅','لا توجد واجبات منتهية'); return; }
  c.innerHTML = list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    .map((hw,i) => hwCardV2(hw, true, i)).join('');
}
function hwCardV2(hw, expired, idx=0) {
  return `<div class="hw-card-v2 ${expired?'expired':''}" style="animation-delay:${idx*0.06}s">
    <div class="hw-card-v2-header">
      <div class="hw-card-v2-title">📚 ${e(hw.title)}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        ${!expired && hw.deadline ? `<span class="timer-pill" id="hwTimer-${hw.id}">⏳</span>` : ''}
        ${expired ? '<span class="badge badge-gray" style="font-size:0.68rem">منتهي</span>' : ''}
        ${!expired
          ? `<button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;padding:4px 8px" onclick="editHomework('${hw.id}')">✏️</button>
             <button class="btn btn-sm" style="background:rgba(229,62,62,0.3);color:#fff;padding:4px 8px" onclick="deleteHomework('${hw.id}')">🗑</button>`
          : `<button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;padding:4px 8px" onclick="deleteHomework('${hw.id}')">🗑</button>`}
      </div>
    </div>
  </div>`;
}
function startHwTimers() {
  Object.values(_hwTimers).forEach(t=>clearInterval(t));
  _hwTimers = {};
  document.querySelectorAll('[id^="hwTimer-"]').forEach(el => {
    const hwId = el.id.replace('hwTimer-','');
    GharsDB.get('homework/'+hwId).then(hw => {
      if (!hw||!hw.deadline) { el.style.display='none'; return; }
      _hwTimers[hwId] = GharsUtils.countdown(hw.deadline, ({done,days,hours,minutes,seconds}) => {
        if (done) {
          el.textContent='انتهى'; el.className='timer-pill urgent';
          clearInterval(_hwTimers[hwId]);
          GharsDB.set('homework/'+hwId,{...hw,expired:true}).then(loadHomework);
          return;
        }
        let txt;
        if(days>0)       txt = `${days}ي ${hours}س`;
        else if(hours>0) txt = `${hours}س ${minutes}د`;
        else             txt = `${minutes}:${String(seconds).padStart(2,'0')}`;
        el.textContent = txt;
        el.className = (minutes<5&&days===0&&hours===0)?'timer-pill urgent':'timer-pill';
      });
    });
  });
}
function switchHwTab(tab) {
  document.getElementById('hwTab-sent').style.display=tab==='sent'?'block':'none';
  document.getElementById('hwTab-done').style.display=tab==='done'?'block':'none';
  document.querySelectorAll('#section-homework .tab').forEach(t=>t.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

// ============================================================
// HIDE GRADE TOGGLE
// ============================================================
function toggleHideGrade() {
  hwHideGradeEnabled = !hwHideGradeEnabled;
  updateHideGradeUI();
}
function updateHideGradeUI() {
  const track = document.getElementById('hwHideGradeTrack');
  const thumb  = document.getElementById('hwHideGradeThumb');
  if (!track||!thumb) return;
  if (hwHideGradeEnabled) {
    track.style.background = 'var(--gold)';
    thumb.style.right='auto'; thumb.style.left='2px';
  } else {
    track.style.background = 'var(--gray-mid)';
    thumb.style.right='2px'; thumb.style.left='auto';
  }
}

// ============================================================
// QUESTION BUILDER — 2 default choices
// ============================================================
function addQuestion(prefill=null) {
  hwQuestionCount++;
  const qNum = hwQuestionCount;
  const c = document.getElementById('questionsContainer');
  const div = document.createElement('div');
  div.className='question-block'; div.id='qBlock-'+qNum;
  div.style.animation='fadeInUp 0.3s both ease';
  div.innerHTML=`<div class="flex-between mb-2">
    <div class="flex gap-2" style="align-items:center">
      <div class="question-num">${qNum}</div>
      <span style="font-weight:700;font-size:0.88rem">السؤال ${qNum}</span>
    </div>
    <button type="button" class="btn btn-sm" style="background:var(--red-light);color:var(--red);padding:4px 8px" onclick="removeQuestion(${qNum})">✖ حذف</button>
  </div>
  <div class="form-group"><textarea class="form-input" id="qText-${qNum}" placeholder="اكتب نص السؤال..." rows="2" style="resize:vertical">${e(prefill?.question||'')}</textarea></div>
  <div id="choicesContainer-${qNum}"></div>
  <div class="flex gap-2 mt-1" style="flex-wrap:wrap;align-items:center">
    <button type="button" class="btn btn-outline btn-sm" onclick="addChoice(${qNum})">➕ إضافة خيار</button>
    <div class="flex gap-1" style="align-items:center">
      <label style="font-size:0.82rem;font-weight:600">درجة:</label>
      <input type="number" class="form-input" id="qPoints-${qNum}" value="${prefill?.points||1}" min="1" style="width:70px;text-align:center" inputmode="numeric">
    </div>
  </div>`;
  c.appendChild(div);
  choiceCounts[qNum]=0;
  const choices=prefill?.options||[];
  if(choices.length) choices.forEach(ch=>addChoice(qNum,ch,prefill?.correctAnswer===ch));
  else { addChoice(qNum); addChoice(qNum); } // 2 default choices only
}
function addChoice(qNum,val='',isCorrect=false) {
  if(!choiceCounts[qNum]) choiceCounts[qNum]=0;
  choiceCounts[qNum]++;
  const cNum=choiceCounts[qNum];
  const letters='أبجدهوزح';
  const c=document.getElementById('choicesContainer-'+qNum); if(!c) return;
  const div=document.createElement('div');
  div.className='choice-item'; div.id=`choice-${qNum}-${cNum}`;
  div.style.animation='fadeInUp 0.25s both ease';
  div.innerHTML=`<input type="radio" class="choice-radio" name="correct-${qNum}" id="radio-${qNum}-${cNum}" ${isCorrect?'checked':''}>
    <span style="font-size:0.82rem;font-weight:700;color:var(--navy);min-width:20px">${letters[cNum-1]||cNum}.</span>
    <input type="text" class="choice-input" id="choiceText-${qNum}-${cNum}" placeholder="الخيار ${cNum}..." value="${e(val)}">
    <button type="button" class="choice-del" onclick="removeChoice(${qNum},${cNum})">✖</button>`;
  c.appendChild(div);
}
function removeChoice(qNum,cNum){ document.getElementById(`choice-${qNum}-${cNum}`)?.remove(); }
function removeQuestion(qNum){ document.getElementById('qBlock-'+qNum)?.remove(); }
function buildQuestionsData() {
  const questions=[];
  document.querySelectorAll('.question-block').forEach(block=>{
    const id=block.id.replace('qBlock-','');
    const qt=document.getElementById('qText-'+id)?.value?.trim();
    if(!qt) return;
    const options=[];let correctAnswer='';
    block.querySelectorAll('.choice-item').forEach(ch=>{
      const parts=ch.id.split('-'), cN=parts[parts.length-1], qN=parts[parts.length-2];
      const txt=document.getElementById(`choiceText-${qN}-${cN}`)?.value?.trim();
      if(txt){ options.push(txt); if(document.getElementById(`radio-${qN}-${cN}`)?.checked) correctAnswer=txt; }
    });
    const pts=parseInt(document.getElementById('qPoints-'+id)?.value||'1')||1;
    questions.push({question:qt,options,correctAnswer,points:pts});
  });
  return questions;
}
async function submitHomework() {
  const title=document.getElementById('hwTitle')?.value?.trim();
  const deadline=document.getElementById('hwDeadline')?.value;
  const timeLimit=parseInt(document.getElementById('hwTimeLimit')?.value||'0')||0;
  const linkedMeeting=document.getElementById('hwLinkMeeting')?.value||'';
  if(!title){UI.toast('يرجى إدخال عنوان الواجب','error');return;}
  const questions=buildQuestionsData();
  if(!questions.length){UI.toast('يرجى إضافة سؤال واحد على الأقل','error');return;}
  if(questions.find(q=>!q.correctAnswer)){UI.toast('حدد الإجابة الصحيحة لكل سؤال','error');return;}
  const id=editingHwId||GharsUtils.uid();
  const hw={id,title,questions,deadline:deadline||null,timeLimit:timeLimit||null,
    linkedMeeting:linkedMeeting||null,hideGrade:hwHideGradeEnabled,
    createdBy:Auth.currentUser.id,createdAt:new Date().toISOString(),expired:false,deleted:false};
  await GharsDB.set('homework/'+id,hw);
  UI.toast(editingHwId?'تم تعديل الواجب':'تم إرسال الواجب بنجاح','success');
  editingHwId=null; hwHideGradeEnabled=false;
  navigate('homework');
}
async function editHomework(hwId) {
  const hw=await GharsDB.get('homework/'+hwId); if(!hw) return;
  editingHwId=hwId; hwHideGradeEnabled=hw.hideGrade||false;
  navigate('add-homework');
  setTimeout(async ()=>{
    const ft=document.getElementById('hwFormTitle');if(ft)ft.textContent='✏️ تعديل الواجب';
    document.getElementById('hwTitle').value=hw.title||'';
    document.getElementById('hwDeadline').value=hw.deadline?hw.deadline.slice(0,16):'';
    document.getElementById('hwTimeLimit').value=hw.timeLimit||'';
    const qc=document.getElementById('questionsContainer');if(qc)qc.innerHTML='';
    hwQuestionCount=0; choiceCounts={};
    (hw.questions||[]).forEach(q=>addQuestion(q));
    await loadMeetingsForSelect('hwLinkMeeting');
    if(hw.linkedMeeting){const s=document.getElementById('hwLinkMeeting');if(s)s.value=hw.linkedMeeting;}
    updateHideGradeUI();
  },150);
}
async function deleteHomework(hwId) {
  if(!await UI.confirm('هل تريد حذف هذا الواجب؟','حذف الواجب')) return;
  await GharsDB.set('homework/'+hwId,{deleted:true,id:hwId});
  UI.toast('تم حذف الواجب','success'); loadHomework();
}
async function confirmClearHomework() {
  if(!await UI.confirm('حذف جميع الواجبات؟','مسح السجل')) return;
  const hw=await GharsDB.getAll('homework');
  for(const id of Object.keys(hw)) await GharsDB.set('homework/'+id,{...hw[id],deleted:true});
  UI.toast('تم المسح','success'); loadHomework();
}

// ============================================================
// STUDENTS
// ============================================================
async function loadStudents() {
  const users=await GharsDB.getAll('users');
  const students=Object.values(users).filter(u=>u.role==='student');
  const c=document.getElementById('studentsList');
  if(!students.length){c.innerHTML=noData('👥','لا يوجد طلاب');return;}
  c.innerHTML=students.map((s,i)=>`
    <div class="student-row" style="animation:fadeInUp 0.3s ${i*0.05}s both ease">
      <div class="flex gap-2" style="align-items:center;flex:1;min-width:0">
        <div class="seen-avatar">${s.name.charAt(0)}</div>
        <div><div class="student-name">${e(s.name)}</div><div style="font-size:0.75rem;color:var(--gray)">${e(s.group||'بدون مجموعة')}</div></div>
      </div>
      <div class="student-actions">
        <button class="btn btn-sm btn-navy" onclick="showStudentInfo('${s.id}')">👁</button>
        <button class="btn btn-sm btn-outline" onclick="copyStudentInfo('${s.id}')">📋</button>
        <button class="btn btn-sm btn-danger" onclick="deleteStudent('${s.id}')">🗑</button>
      </div>
    </div>`).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}
async function showStudentInfo(id) {
  const u=await GharsDB.get('users/'+id); if(!u) return;
  UI.showModal(`<div class="modal" style="max-width:380px">
    <div class="modal-header"><h3>👤 معلومات الطالب</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div style="background:#f8fafc;border-radius:12px;padding:16px">
        <div class="flex-between mb-2"><span class="badge badge-navy">الاسم</span><strong>${e(u.name)}</strong></div>
        <div class="flex-between mb-2"><span class="badge badge-navy">المستخدم</span><code style="background:#e2e8f0;padding:2px 8px;border-radius:6px">${e(u.username)}</code></div>
        <div class="flex-between mb-2"><span class="badge badge-navy">كلمة المرور</span><code style="background:#e2e8f0;padding:2px 8px;border-radius:6px">${e(u.password)}</code></div>
        <div class="flex-between"><span class="badge badge-navy">المجموعة</span><strong>${e(u.group||'—')}</strong></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="copyStudentInfo('${id}')">📋 نسخ</button>
      <button class="btn btn-gray" data-close-modal>حسناً</button>
    </div>
  </div>`);
}
async function copyStudentInfo(id) {
  const u=await GharsDB.get('users/'+id); if(!u) return;
  await UI.copyText(`اسم الطالب: ${u.name}\nاسم المستخدم: ${u.username}\nكلمة المرور: ${u.password}\nالمجموعة: ${u.group||'—'}`);
}
async function deleteStudent(id) {
  if(!await UI.confirm('حذف هذا الطالب؟ لن يتمكن من الدخول.','حذف الطالب')) return;
  const u=await GharsDB.get('users/'+id);
  await GharsDB.set('users/'+id,{...(u||{}),id,deleted:true});
  UI.toast('تم الحذف','success'); loadStudents(); loadHomeStats();
}
async function showAddStudent() {
  const groups=await GharsDB.getAll('groups');
  const gopts=Object.values(groups).map(g=>`<option value="${e(g.name)}">${e(g.name)}</option>`).join('');
  UI.showModal(`<div class="modal" style="max-width:400px">
    <div class="modal-header"><h3>➕ إضافة طالب</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">👤 الاسم</label><input type="text" class="form-input" id="newStudentName" placeholder="الاسم الكامل"></div>
      <div class="form-group"><label class="form-label">🏆 المجموعة</label><select class="form-select" id="newStudentGroup"><option value="">بدون مجموعة</option>${gopts}</select></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="saveNewStudent()">💾 حفظ</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}
async function saveNewStudent() {
  const name=document.getElementById('newStudentName')?.value?.trim();
  const group=document.getElementById('newStudentGroup')?.value||'';
  if(!name){UI.toast('يرجى إدخال الاسم','error');return;}
  const student={id:'student_'+GharsUtils.uid(),name,username:GharsUtils.generateUsername(name),
    password:GharsUtils.generatePassword(),group,role:'student',createdAt:new Date().toISOString(),deleted:false};
  await GharsDB.set('users/'+student.id,student);
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('تم إضافة الطالب','success'); loadStudents(); loadHomeStats();
}
async function confirmClearStudents() {
  if(!await UI.confirm('حذف جميع الطلاب؟','مسح الطلاب')) return;
  const users=await GharsDB.getAll('users');
  for(const [id,u] of Object.entries(users)) if(u.role==='student') await GharsDB.set('users/'+id,{...u,deleted:true});
  UI.toast('تم الحذف','success'); loadStudents(); loadHomeStats();
}

// ============================================================
// TEACHERS
// ============================================================
const STATIC_TEACHERS=[
  {id:'sys_mustafa',name:'مصطفى قدسي',username:'mustafa2026',password:'Ghars@Mustafa1',role:'admin'},
  {id:'sys_zakaria',name:'زكريا حسين',username:'zakaria2026',password:'Ghars@Zakaria2',role:'teacher'},
  {id:'sys_mohammed',name:'محمد قارئ',username:'mohammed2026',password:'Ghars@Mohammed3',role:'teacher'}
];
async function loadTeachers() {
  const users=await GharsDB.getAll('users');
  const dynamic=Object.values(users).filter(u=>u.role==='teacher'||u.role==='admin');
  const allIds=new Set([...STATIC_TEACHERS.map(t=>t.id),...dynamic.map(t=>t.id)]);
  const all=[];
  allIds.forEach(id=>{
    const st=STATIC_TEACHERS.find(t=>t.id===id);
    const dy=dynamic.find(t=>t.id===id);
    if(dy&&!dy.deleted) all.push(dy); else if(st) all.push(st);
  });
  const c=document.getElementById('teachersList'); if(!c) return;
  if(!all.length){c.innerHTML=noData('👨‍🏫','لا يوجد معلمون');return;}
  c.innerHTML=all.map((t,i)=>`
    <div class="teacher-row" style="animation:fadeInUp 0.3s ${i*0.07}s both ease">
      <div class="seen-avatar" style="background:linear-gradient(135deg,var(--navy),var(--navy-light))">${t.name.charAt(0)}</div>
      <div class="teacher-info">
        <div class="teacher-name">${e(t.name)} ${t.role==='admin'?'<span class="badge badge-gold" style="font-size:0.65rem">مدير</span>':''}</div>
        <div class="teacher-creds">👤 ${e(t.username)} · 🔑 <code style="font-size:0.75rem">${e(t.password)}</code></div>
      </div>
      <div class="flex gap-1">
        <button class="btn btn-sm btn-navy" onclick="showTeacherInfo('${t.id}')">👁</button>
        <button class="btn btn-sm btn-outline" onclick="copyTeacherInfo('${t.id}')">📋</button>
        ${STATIC_TEACHERS.find(s=>s.id===t.id)&&t.role==='admin'?'':`<button class="btn btn-sm btn-danger" onclick="deleteTeacher('${t.id}')">🗑</button>`}
      </div>
    </div>`).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}
async function showTeacherInfo(id) {
  const t=STATIC_TEACHERS.find(s=>s.id===id)||await GharsDB.get('users/'+id); if(!t) return;
  UI.showModal(`<div class="modal" style="max-width:380px">
    <div class="modal-header"><h3>👨‍🏫 معلومات</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div style="background:#f8fafc;border-radius:12px;padding:16px">
        <div class="flex-between mb-2"><span class="badge badge-navy">الاسم</span><strong>${e(t.name)}</strong></div>
        <div class="flex-between mb-2"><span class="badge badge-navy">المستخدم</span><code style="background:#e2e8f0;padding:2px 8px;border-radius:6px">${e(t.username)}</code></div>
        <div class="flex-between"><span class="badge badge-navy">كلمة المرور</span><code style="background:#e2e8f0;padding:2px 8px;border-radius:6px">${e(t.password)}</code></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="copyTeacherInfo('${id}')">📋 نسخ</button>
      <button class="btn btn-gray" data-close-modal>حسناً</button>
    </div>
  </div>`);
}
async function copyTeacherInfo(id) {
  const t=STATIC_TEACHERS.find(s=>s.id===id)||await GharsDB.get('users/'+id); if(!t) return;
  await UI.copyText(`الاسم: ${t.name}\nاسم المستخدم: ${t.username}\nكلمة المرور: ${t.password}`);
}
async function deleteTeacher(id) {
  if(!await UI.confirm('حذف هذا المعلم؟','حذف المعلم')) return;
  const u=await GharsDB.get('users/'+id);
  await GharsDB.set('users/'+id,{...(u||{id}),id,deleted:true});
  UI.toast('تم الحذف','success'); loadTeachers();
}
async function showAddTeacherModal() {
  UI.showModal(`<div class="modal" style="max-width:400px">
    <div class="modal-header"><h3>➕ إضافة معلم</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">👤 الاسم</label><input type="text" class="form-input" id="newTeacherName" placeholder="الاسم الكامل"></div>
      <div id="newTeacherResult" style="display:none;margin-top:12px;background:var(--green-light);border-radius:10px;padding:12px;font-size:0.85rem"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="saveNewTeacher()">💾 حفظ</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}
async function saveNewTeacher() {
  const name=document.getElementById('newTeacherName')?.value?.trim();
  if(!name){UI.toast('يرجى إدخال الاسم','error');return;}
  const teacher={id:'teacher_'+GharsUtils.uid(),name,username:GharsUtils.generateUsername(name),
    password:GharsUtils.generatePassword(),role:'teacher',createdAt:new Date().toISOString(),deleted:false};
  await GharsDB.set('users/'+teacher.id,teacher);
  const res=document.getElementById('newTeacherResult');
  if(res){res.style.display='block';res.innerHTML=`✅ تمت الإضافة<br>المستخدم: <strong>${teacher.username}</strong><br>كلمة المرور: <strong>${teacher.password}</strong>`;}
  UI.toast('تم إضافة المعلم','success');
  if(currentPage==='teachers') loadTeachers();
}

// ============================================================
// MEETINGS — past/upcoming logic
// ============================================================
async function loadMeetings() {
  const meetings=await GharsDB.getAll('meetings');
  const now=Date.now();
  const list=Object.values(meetings).filter(m=>!m.deleted);
  // A meeting is "past" if its date has passed (+ buffer of 1 hour after meeting time)
  const upcoming=list.filter(m=>new Date(m.date).getTime()>(now-3600000)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const past=list.filter(m=>new Date(m.date).getTime()<=(now-3600000)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  renderMeetings(upcoming,'upcomingMeetings',false);
  renderMeetings(past,'pastMeetings',true);
}
function renderMeetings(list,cId,isPast) {
  const c=document.getElementById(cId); if(!c) return;
  if(!list.length){c.innerHTML=noData('📅','لا توجد لقاءات');return;}
  c.innerHTML=list.map((m,i)=>{
    const d=new Date(m.date);
    const ds=formatArabicDate(d), ts=GharsUtils.formatTime(d);
    return `<div class="meeting-card-v2" style="animation-delay:${i*0.06}s">
      <div class="meeting-card-v2-header">
        <div>
          <div style="font-weight:800;font-size:0.92rem;color:var(--white)">${e(m.title||'لقاء')}</div>
          <div class="meeting-date-badge" style="margin-top:6px">📅 ${ds} · ⏰ ${ts}</div>
        </div>
        <div class="flex gap-1" style="flex-wrap:wrap">
          ${!isPast
            ? `<button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="openAttendance('${m.id}')">📋</button>
               <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="editMeeting('${m.id}')">✏️</button>`
            : `<button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="viewAttendanceSheet('${m.id}')">👁</button>`}
          <button class="btn btn-sm" style="background:rgba(229,62,62,0.3);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="deleteMeeting('${m.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
async function saveMeeting() {
  const title=document.getElementById('meetingTitle').value.trim();
  const dt=document.getElementById('meetingDateTime').value;
  if(!dt){UI.toast('يرجى تحديد التاريخ والوقت','error');return;}
  const id=GharsUtils.uid();
  await GharsDB.set('meetings/'+id,{id,title:title||'لقاء',date:new Date(dt).toISOString(),
    attendance:{},createdBy:Auth.currentUser.id,createdAt:new Date().toISOString(),deleted:false});
  UI.toast('تم حفظ اللقاء','success'); navigate('meetings'); loadUpcomingMeeting();
}
async function editMeeting(id) {
  const m=await GharsDB.get('meetings/'+id); if(!m) return;
  const dv=m.date?new Date(m.date).toISOString().slice(0,16):'';
  UI.showModal(`<div class="modal" style="max-width:400px">
    <div class="modal-header"><h3>✏️ تعديل اللقاء</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">العنوان</label><input type="text" class="form-input" id="emTitle" value="${e(m.title||'')}"></div>
      <div class="form-group"><label class="form-label">التاريخ والوقت</label><input type="datetime-local" class="form-input" id="emDate" value="${dv}" style="direction:ltr"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="saveEditMeeting('${id}')">💾 تعديل</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}
async function saveEditMeeting(id) {
  const title=document.getElementById('emTitle')?.value?.trim();
  const date=document.getElementById('emDate')?.value;
  if(!date){UI.toast('يرجى تحديد التاريخ','error');return;}
  const m=await GharsDB.get('meetings/'+id);
  await GharsDB.set('meetings/'+id,{...m,title:title||'لقاء',date:new Date(date).toISOString()});
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('تم التعديل','success'); loadMeetings(); loadUpcomingMeeting();
}
async function deleteMeeting(id) {
  if(!await UI.confirm('حذف هذا اللقاء؟','حذف')) return;
  await GharsDB.set('meetings/'+id,{deleted:true,id});
  UI.toast('تم','success'); loadMeetings(); loadUpcomingMeeting();
}
async function confirmClearMeetings() {
  if(!await UI.confirm('حذف جميع اللقاءات؟','مسح')) return;
  const ms=await GharsDB.getAll('meetings');
  for(const id of Object.keys(ms)) await GharsDB.set('meetings/'+id,{...ms[id],deleted:true});
  UI.toast('تم','success'); loadMeetings(); loadUpcomingMeeting();
}
function switchMeetingTab(tab) {
  document.getElementById('meetingTab-upcoming').style.display=tab==='upcoming'?'block':'none';
  document.getElementById('meetingTab-past').style.display=tab==='past'?'block':'none';
  document.querySelectorAll('#section-meetings .tab').forEach(t=>t.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

// Attendance
async function openAttendance(meetingId) {
  currentMeetingForAttendance=meetingId;
  const m=await GharsDB.get('meetings/'+meetingId);
  const tt=document.getElementById('attendanceTitle');if(tt)tt.textContent=`📋 تحضير: ${m?.title||'لقاء'}`;
  attendanceData=m?.attendance?{...m.attendance}:{};
  navigate('attendance');
}
async function loadAttendancePage() {
  const users=await GharsDB.getAll('users');
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  const c=document.getElementById('attendanceList');
  if(!students.length){c.innerHTML=noData('👥','لا يوجد طلاب');return;}
  c.innerHTML=students.map((s,i)=>{
    const cur=attendanceData[s.id]||'';
    return `<div class="student-row" style="animation:fadeInUp 0.3s ${i*0.05}s both ease">
      <div class="flex gap-2" style="align-items:center;flex:1"><div class="seen-avatar">${s.name.charAt(0)}</div><span class="student-name">${e(s.name)}</span></div>
      <div class="attend-select" id="att-${s.id}">
        <button class="attend-opt ${cur==='present'?'selected-present':''}" onclick="selAtt('${s.id}','present',this)">حاضر</button>
        <button class="attend-opt ${cur==='absent'?'selected-absent':''}" onclick="selAtt('${s.id}','absent',this)">غائب</button>
        <button class="attend-opt ${cur==='excused'?'selected-excused':''}" onclick="selAtt('${s.id}','excused',this)">مستأذن</button>
      </div>
    </div>`;
  }).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}
function selAtt(sid,status,btn) {
  attendanceData[sid]=status;
  const c=document.getElementById('att-'+sid);
  c?.querySelectorAll('.attend-opt').forEach(b=>b.className='attend-opt');
  btn.className=`attend-opt selected-${status}`;
}
async function saveAttendance() {
  if(!currentMeetingForAttendance) return;
  const m=await GharsDB.get('meetings/'+currentMeetingForAttendance);
  await GharsDB.set('meetings/'+currentMeetingForAttendance,{...m,attendance:attendanceData});
  for(const [sid,status] of Object.entries(attendanceData)) {
    const pts=await GharsDB.get('points_summary/'+sid)||{id:sid,total:0,breakdown:[]};
    const already=pts.breakdown?.some(b=>b.meetingId===currentMeetingForAttendance&&b.type==='attendance');
    if(!already) {
      const pts2add=status==='present'?2:0;
      if(pts2add>0) pts.total=(pts.total||0)+pts2add;
      pts.breakdown=[...(pts.breakdown||[]),{
        type:'attendance',meetingId:currentMeetingForAttendance,
        meetingTitle:m?.title||'لقاء',points:pts2add,status,date:new Date().toISOString()
      }];
      await GharsDB.set('points_summary/'+sid,pts);
    }
  }
  UI.toast('تم حفظ التحضير','success'); navigate('meetings');
}
async function viewAttendanceSheet(meetingId) {
  const [m,users]=await Promise.all([GharsDB.get('meetings/'+meetingId),GharsDB.getAll('users')]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  const att=m?.attendance||{};
  UI.showModal(`<div class="modal" style="max-width:420px">
    <div class="modal-header"><h3>📋 تحضير — ${e(m?.title||'لقاء')}</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">${students.map(s=>{
      const st=att[s.id];
      const b=st==='present'?'<span class="status-present">حاضر</span>':st==='absent'?'<span class="status-absent">غائب</span>':st==='excused'?'<span class="status-excused">مستأذن</span>':'<span class="badge badge-gray">—</span>';
      return `<div class="student-row"><div class="seen-avatar">${s.name.charAt(0)}</div><span style="flex:1">${e(s.name)}</span>${b}</div>`;
    }).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>')}</div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>عودة</button></div>
  </div>`);
}

// ============================================================
// POINTS
// ============================================================
async function loadPoints() {
  const [users,mList,ptsData]=await Promise.all([
    GharsDB.getAll('users'),GharsDB.getAll('meetings'),GharsDB.getAll('points_summary')
  ]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  // Fill meetings select
  const meetings=Object.values(mList).filter(m=>!m.deleted).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const sel=document.getElementById('pointsMeetingSelect');
  if(sel){
    sel.innerHTML='<option value="">بدون ربط بلقاء</option>'+
      meetings.map(m=>`<option value="${m.id}">${e(m.title||'لقاء')} — ${formatArabicDate(new Date(m.date))}</option>`).join('');
  }
  const c=document.getElementById('pointsList');
  if(!students.length){c.innerHTML=noData('⭐','لا يوجد طلاب');return;}
  c.innerHTML=students.map((s,i)=>`
    <div class="points-row" style="animation:fadeInUp 0.3s ${i*0.05}s both ease">
      <div class="seen-avatar">${s.name.charAt(0)}</div>
      <div style="flex:1;min-width:0">
        <div class="student-name">${e(s.name)}</div>
        <div style="font-size:0.75rem;color:var(--gray)">نقاطه: <strong style="color:var(--gold)">${ptsData[s.id]?.total||0}</strong></div>
      </div>
      <input type="number" class="form-input" id="pts-${s.id}" placeholder="0" min="0"
        style="width:70px;text-align:center;padding:6px 8px" inputmode="numeric">
    </div>`).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}
async function savePoints() {
  const students=Object.values(await GharsDB.getAll('users')).filter(u=>u.role==='student'&&!u.deleted);
  const meetingId=document.getElementById('pointsMeetingSelect')?.value||'';
  let cnt=0;
  for(const s of students) {
    const raw=document.getElementById('pts-'+s.id)?.value;
    const val=raw?parseInt(raw):0;
    if(val>0) {
      const pts=await GharsDB.get('points_summary/'+s.id)||{id:s.id,total:0,breakdown:[]};
      const meeting=meetingId?await GharsDB.get('meetings/'+meetingId):null;
      pts.total=(pts.total||0)+val;
      pts.breakdown=[...(pts.breakdown||[]),{
        type:'initiative',meetingId:meetingId||null,
        meetingTitle:meeting?.title||null,
        points:val,date:new Date().toISOString(),by:Auth.currentUser.name
      }];
      await GharsDB.set('points_summary/'+s.id,pts);
      const inp=document.getElementById('pts-'+s.id);if(inp)inp.value='';
      cnt++;
    }
  }
  if(cnt>0){UI.toast(`تم إضافة نقاط لـ ${cnt} طالب`,'success');loadPoints();loadHomeStats();}
  else UI.toast('لم يتم إدخال أي نقاط','warning');
}
async function confirmClearPoints() {
  if(!await UI.confirm('مسح نقاط المبادرات؟','مسح النقاط')) return;
  const students=Object.values(await GharsDB.getAll('users')).filter(u=>u.role==='student');
  for(const s of students) {
    const pts=await GharsDB.get('points_summary/'+s.id);
    if(pts){
      const filtered=(pts.breakdown||[]).filter(b=>b.type!=='initiative');
      await GharsDB.set('points_summary/'+s.id,{...pts,total:filtered.reduce((a,b)=>a+(b.points||0),0),breakdown:filtered});
    }
  }
  UI.toast('تم المسح','success');loadPoints();
}

// ============================================================
// MEMORIZATION
// ============================================================
async function loadMemorization() {
  const settings=await GharsDB.get('system/settings')||{};
  const target=settings.targetMemorization||0;
  memoTargetValue=target;
  if(target>0){
    const compact=document.getElementById('memoTargetCompact');
    const editCard=document.getElementById('memoTargetEditCard');
    if(compact)compact.style.display='block';
    if(editCard)editCard.style.display='none';
    setEl('memoTargetCompactNum',target);
  } else {
    const compact=document.getElementById('memoTargetCompact');
    const editCard=document.getElementById('memoTargetEditCard');
    if(compact)compact.style.display='none';
    if(editCard)editCard.style.display='block';
  }
  const [users,memoData]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('memorization')]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  const c=document.getElementById('memoStudentList'); if(!c) return;
  if(!students.length){c.innerHTML=noData('📖','لا يوجد طلاب');return;}
  c.innerHTML=students.map((s,i)=>{
    const sc=memoData[s.id]?.score||0;
    const pct=target>0?Math.min(100,Math.round((sc/target)*100)):0;
    return `<div class="memo-row" style="animation:fadeInUp 0.3s ${i*0.05}s both ease">
      <div class="seen-avatar">${s.name.charAt(0)}</div>
      <div style="flex:1;min-width:0">
        <div class="student-name">${e(s.name)}</div>
        ${target>0?`<div style="margin-top:5px">
          <div class="progress-bar-animated"><div class="fill" style="--pct:${pct}%"></div></div>
        </div>`:''}
      </div>
      <span style="font-size:0.82rem;color:var(--gold);font-weight:700;min-width:50px;text-align:center">${sc}/${target||'?'}</span>
      <input type="number" class="form-input" id="memo-${s.id}" value="${sc}" min="0"
        style="width:70px;text-align:center;padding:6px 8px" inputmode="numeric">
    </div>`;
  }).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}
function showMemoTargetEdit() {
  const compact=document.getElementById('memoTargetCompact');
  const editCard=document.getElementById('memoTargetEditCard');
  if(compact)compact.style.display='none';
  if(editCard)editCard.style.display='block';
  const inp=document.getElementById('memoTarget');if(inp){inp.value=memoTargetValue||'';inp.focus();}
}
async function saveMemoTarget() {
  const raw=document.getElementById('memoTarget')?.value;
  const t=raw?parseInt(raw):0;
  if(isNaN(t)||t<0){UI.toast('يرجى إدخال رقم صحيح','error');return;}
  const s=await GharsDB.get('system/settings')||{};
  await GharsDB.set('system/settings',{...s,targetMemorization:t});
  memoTargetValue=t;
  const compact=document.getElementById('memoTargetCompact');
  const editCard=document.getElementById('memoTargetEditCard');
  if(compact)compact.style.display='block';
  if(editCard)editCard.style.display='none';
  setEl('memoTargetCompactNum',t);
  UI.toast('تم الحفظ','success'); loadMemorization();
}
async function saveMemoScores() {
  const students=Object.values(await GharsDB.getAll('users')).filter(u=>u.role==='student'&&!u.deleted);
  for(const s of students) {
    const raw=document.getElementById('memo-'+s.id)?.value;
    const val=raw!==undefined&&raw!==''?parseInt(raw):null;
    if(val!==null&&!isNaN(val)) await GharsDB.set('memorization/'+s.id,{id:s.id,score:val,updatedAt:new Date().toISOString()});
  }
  UI.toast('تم حفظ الأرقام','success'); loadMemorization();
}
async function confirmClearMemo() {
  if(!await UI.confirm('مسح جميع أرقام التسميع؟','مسح')) return;
  const students=Object.values(await GharsDB.getAll('users')).filter(u=>u.role==='student');
  for(const s of students) await GharsDB.set('memorization/'+s.id,{id:s.id,score:0});
  UI.toast('تم','success'); loadMemorization();
}

// ============================================================
// GROUPS
// ============================================================
async function loadGroups() {
  const groups=await GharsDB.getAll('groups');
  const c=document.getElementById('groupsList');
  const sorted=Object.values(groups).sort((a,b)=>(b.points||0)-(a.points||0));
  if(!sorted.length){c.innerHTML=noData('🏆','لا توجد مجموعات');return;}
  c.innerHTML=sorted.map((g,i)=>`<div class="group-card" style="animation:fadeInUp 0.3s ${i*0.07}s both ease">
    <div class="group-header">
      <div><div class="group-name">🏆 ${e(g.name)}</div></div>
      <div class="flex gap-1" style="align-items:center;flex-wrap:wrap">
        <span class="group-points">⭐ ${g.points||0}</span>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:4px 8px" onclick="showGroupStudents('${g.id}')">👥</button>
        <button class="btn btn-sm" style="background:rgba(201,162,39,0.3);color:var(--gold);font-size:0.74rem;padding:4px 8px" onclick="addGroupPoints('${g.id}','${e(g.name)}')">➕</button>
        <button class="btn btn-sm btn-danger" style="font-size:0.74rem;padding:4px 8px" onclick="deleteGroup('${g.id}')">🗑</button>
      </div>
    </div>
  </div>`).join('');
}
async function showAddGroup() {
  UI.showModal(`<div class="modal" style="max-width:360px">
    <div class="modal-header"><h3>➕ إضافة مجموعة</h3><button class="modal-close">✖</button></div>
    <div class="modal-body"><div class="form-group"><label class="form-label">اسم المجموعة</label><input type="text" class="form-input" id="newGroupName" placeholder="الاسم"></div></div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="saveNewGroup()">💾 حفظ</button><button class="btn btn-gray" data-close-modal>إلغاء</button></div>
  </div>`);
}
async function saveNewGroup() {
  const name=document.getElementById('newGroupName')?.value?.trim();
  if(!name){UI.toast('يرجى إدخال اسم','error');return;}
  const id='group_'+GharsUtils.uid();
  await GharsDB.set('groups/'+id,{id,name,points:0,createdAt:new Date().toISOString()});
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('تمت الإضافة','success'); loadGroups(); loadHomeStats();
}
async function addGroupPoints(gid,gname) {
  UI.showModal(`<div class="modal" style="max-width:340px">
    <div class="modal-header"><h3>➕ نقاط — ${gname}</h3><button class="modal-close">✖</button></div>
    <div class="modal-body"><div class="form-group"><label class="form-label">⭐ النقاط</label><input type="number" class="form-input" id="gpInput" placeholder="0" min="0" inputmode="numeric" style="direction:ltr"></div></div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="saveGroupPts('${gid}')">💾 حفظ</button><button class="btn btn-gray" data-close-modal>عودة</button></div>
  </div>`);
}
async function saveGroupPts(gid) {
  const raw=document.getElementById('gpInput')?.value;
  const val=raw?parseInt(raw):0;
  if(isNaN(val)||val<0){UI.toast('رقم غير صحيح','error');return;}
  const g=await GharsDB.get('groups/'+gid);
  await GharsDB.set('groups/'+gid,{...g,points:(g.points||0)+val});
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('تمت الإضافة','success'); loadGroups(); loadHomeStats();
}
async function showGroupStudents(gid) {
  const [users,group]=await Promise.all([GharsDB.getAll('users'),GharsDB.get('groups/'+gid)]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted&&u.group===group?.name);
  UI.showModal(`<div class="modal" style="max-width:380px">
    <div class="modal-header"><h3>👥 ${e(group?.name||'')}</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">${students.length?students.map(s=>`<div class="student-row"><div class="seen-avatar">${s.name.charAt(0)}</div><span style="flex:1">${e(s.name)}</span></div>`).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>'):noData('👥','لا يوجد طلاب')}</div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>إغلاق</button></div>
  </div>`);
}
async function deleteGroup(id) {
  if(!await UI.confirm('حذف هذه المجموعة؟','حذف')) return;
  await GharsDB.delete('groups/'+id);
  UI.toast('تم','success'); loadGroups();
}
async function confirmClearGroupPoints() {
  if(!await UI.confirm('مسح نقاط جميع المجموعات؟','مسح')) return;
  const groups=await GharsDB.getAll('groups');
  for(const [id,g] of Object.entries(groups)) await GharsDB.set('groups/'+id,{...g,points:0});
  UI.toast('تم','success'); loadGroups();
}

// ============================================================
// SEERAH — lessons with IndexedDB video fix
// ============================================================
function onVideoFileChange(input) {
  const file=input.files?.[0]; if(!file) return;
  setFilePickerName('video',file.name);
}
function onPdfFileChange(input) {
  const file=input.files?.[0]; if(!file) return;
  setFilePickerName('pdf',file.name);
}
function onVideoFileDrop(e) {
  const file=e.dataTransfer?.files?.[0]; if(!file) return;
  const dt=new DataTransfer(); dt.items.add(file);
  document.getElementById('lessonVideoFile').files=dt.files;
  setFilePickerName('video',file.name);
}
function onPdfFileDrop(e) {
  const file=e.dataTransfer?.files?.[0]; if(!file) return;
  const dt=new DataTransfer(); dt.items.add(file);
  document.getElementById('lessonPdfFile').files=dt.files;
  setFilePickerName('pdf',file.name);
}
function setFilePickerName(type,name) {
  const el=document.getElementById(type+'PickerName');
  const area=document.getElementById(type+'PickerArea');
  if(el){el.textContent=name;el.style.display='inline-block';}
  if(area)area.style.borderColor='var(--green)';
}

async function loadSeerah() {
  const lessons=await GharsDB.getAll('lessons');
  const c=document.getElementById('lessonsList');
  const list=Object.values(lessons).filter(l=>!l.deleted).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  if(!list.length){c.innerHTML=noData('🕌','لا توجد دروس');return;}
  c.innerHTML=list.map((l,i)=>`<div class="lesson-v2" style="animation-delay:${i*0.06}s">
    <div class="lesson-v2-header">
      <div style="font-size:1.6rem">🕌</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:0.92rem;color:#fff">${e(l.title)}</div>
        <div style="font-size:0.73rem;color:rgba(255,255,255,0.6);margin-top:2px">${GharsUtils.toHijriShort(new Date(l.createdAt))}</div>
      </div>
      <div class="flex gap-1" style="flex-wrap:wrap">
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="viewLessonViewers('${l.id}')">👁 ${(l.viewers||[]).length}</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="viewLessonComments('${l.id}')">💬 ${(l.comments||[]).length}</button>
        <button class="btn btn-sm" style="background:rgba(201,162,39,0.3);color:var(--gold);font-size:0.74rem;padding:5px 8px" onclick="editLesson('${l.id}')">✏️</button>
        <button class="btn btn-sm" style="background:rgba(229,62,62,0.3);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="deleteLesson('${l.id}')">🗑</button>
      </div>
    </div>
  </div>`).join('');
}

function setVideoSource(src) {
  lessonVideoSource=src;
  document.getElementById('ytUrlSection').style.display=src==='youtube'?'block':'none';
  document.getElementById('uploadVideoSection').style.display=src==='upload'?'block':'none';
  ['ytSourceBtn','uploadSourceBtn'].forEach(id=>{
    const btn=document.getElementById(id);
    if(!btn) return;
    const isActive=(id==='ytSourceBtn'&&src==='youtube')||(id==='uploadSourceBtn'&&src==='upload');
    btn.style.cssText=isActive
      ?'background:var(--navy);color:var(--gold);border:1.5px solid var(--gold)'
      :'background:var(--white);color:var(--navy);border:1.5px solid var(--gray-mid)';
  });
}
function resetLessonForm() {
  editingLessonId=null; lessonVideoSource=null;
  ['lessonTitle','lessonTopic','lessonYtUrl'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  ['ytUrlSection','uploadVideoSection'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const ft=document.getElementById('lessonFormTitle');if(ft)ft.textContent='➕ إضافة درس جديد';
  const sb=document.getElementById('lessonSaveBtn');if(sb)sb.textContent='📤 إرسال الدرس';
  ['video','pdf'].forEach(t=>{
    const n=document.getElementById(t+'PickerName');if(n){n.style.display='none';}
    const a=document.getElementById(t+'PickerArea');if(a)a.style.borderColor='';
  });
  const videoInput=document.getElementById('lessonVideoFile');if(videoInput)videoInput.value='';
  const pdfInput=document.getElementById('lessonPdfFile');if(pdfInput)pdfInput.value='';
}

async function saveLesson() {
  const title=document.getElementById('lessonTitle')?.value?.trim();
  if(!title){UI.toast('يرجى إدخال عنوان الدرس','error');return;}
  const topic=document.getElementById('lessonTopic')?.value?.trim()||'';
  const ytUrl=document.getElementById('lessonYtUrl')?.value?.trim()||'';
  const linkedHw=document.getElementById('lessonLinkHw')?.value||'';
  const linkedMeeting=document.getElementById('lessonLinkMeeting')?.value||'';
  const videoFile=document.getElementById('lessonVideoFile')?.files?.[0];
  const pdfFile=document.getElementById('lessonPdfFile')?.files?.[0];
  const btn=document.getElementById('lessonSaveBtn');
  UI.setLoading(btn,true,'جاري الحفظ...');
  let videoUrl=''; let pdfUrl='';
  const progressEl=document.getElementById('uploadProgress');
  const progressBar=document.getElementById('uploadProgressBar');
  const progressTxt=document.getElementById('uploadProgressText');
  try {
    if(lessonVideoSource==='upload'&&videoFile) {
      if(progressEl)progressEl.style.display='block';
      videoUrl=await GharsDB.uploadFile(
        `lessons/videos/${GharsUtils.uid()}_${videoFile.name}`, videoFile,
        (p)=>{ if(progressBar)progressBar.style.width=p+'%'; if(progressTxt)progressTxt.textContent=`${Math.round(p)}%`; }
      );
      if(progressEl)progressEl.style.display='none';
    } else if(lessonVideoSource==='youtube') {
      videoUrl=ytUrl;
    }
    if(pdfFile) {
      pdfUrl=await GharsDB.uploadFile(`lessons/pdfs/${GharsUtils.uid()}_${pdfFile.name}`,pdfFile);
    }
  } catch(err) {
    console.error('Upload error:',err);
    UI.toast('حدث خطأ في الرفع','error');
    UI.setLoading(btn,false); return;
  }
  const id=editingLessonId||GharsUtils.uid();
  const existingLesson=editingLessonId?await GharsDB.get('lessons/'+editingLessonId):null;
  const lesson={
    id,title,topic,
    videoUrl:videoUrl||existingLesson?.videoUrl||'',
    videoSource:lessonVideoSource||existingLesson?.videoSource||null,
    pdfUrl:pdfUrl||existingLesson?.pdfUrl||'',
    linkedHw:linkedHw||null,linkedMeeting:linkedMeeting||null,
    viewers:existingLesson?.viewers||[],comments:existingLesson?.comments||[],
    createdBy:Auth.currentUser.id,createdAt:existingLesson?.createdAt||new Date().toISOString(),
    deleted:false
  };
  await GharsDB.set('lessons/'+id,lesson);
  UI.setLoading(btn,false);
  UI.toast(editingLessonId?'تم التعديل':'تم إرسال الدرس','success');
  editingLessonId=null; resetLessonForm(); navigate('seerah');
}
async function editLesson(id) {
  const l=await GharsDB.get('lessons/'+id); if(!l) return;
  editingLessonId=id; navigate('add-lesson');
  setTimeout(async ()=>{
    const lt=document.getElementById('lessonTitle');if(lt)lt.value=l.title||'';
    const ltp=document.getElementById('lessonTopic');if(ltp)ltp.value=l.topic||'';
    const lft=document.getElementById('lessonFormTitle');if(lft)lft.textContent='✏️ تعديل الدرس';
    const lsb=document.getElementById('lessonSaveBtn');if(lsb)lsb.textContent='💾 تعديل';
    await loadMeetingsForSelect('lessonLinkMeeting');
    await loadHwForSelect('lessonLinkHw');
    if(l.linkedMeeting){const s=document.getElementById('lessonLinkMeeting');if(s)s.value=l.linkedMeeting;}
    if(l.linkedHw){const s=document.getElementById('lessonLinkHw');if(s)s.value=l.linkedHw;}
    if(l.videoSource==='youtube'){setVideoSource('youtube');const y=document.getElementById('lessonYtUrl');if(y)y.value=l.videoUrl||'';}
    else if(l.videoSource==='upload'){setVideoSource('upload');}
  },150);
}
async function deleteLesson(id) {
  if(!await UI.confirm('حذف هذا الدرس؟','حذف')) return;
  await GharsDB.set('lessons/'+id,{deleted:true,id});
  UI.toast('تم','success'); loadSeerah();
}
async function confirmClearLessons() {
  if(!await UI.confirm('حذف جميع الدروس؟','مسح')) return;
  const lessons=await GharsDB.getAll('lessons');
  for(const id of Object.keys(lessons)) await GharsDB.set('lessons/'+id,{...lessons[id],deleted:true});
  UI.toast('تم','success'); loadSeerah();
}
async function viewLessonViewers(id) {
  const [lesson,users]=await Promise.all([GharsDB.get('lessons/'+id),GharsDB.getAll('users')]);
  const viewers=lesson?.viewers||[];
  UI.showModal(`<div class="modal" style="max-width:380px">
    <div class="modal-header"><h3>👥 المشاهدون</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">${viewers.length?viewers.map(v=>`
      <div class="student-row">
        <div class="seen-avatar">${(users[v.studentId]?.name||'?').charAt(0)}</div>
        <div><div class="student-name">${e(users[v.studentId]?.name||v.studentId)}</div>
        <div style="font-size:0.73rem;color:var(--gray)">${GharsUtils.toHijriShort(new Date(v.at))}</div></div>
      </div>`).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>'):noData('👁','لم يشاهد أحد')}</div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>إغلاق</button></div>
  </div>`);
}
async function viewLessonComments(id) {
  const [lesson,users]=await Promise.all([GharsDB.get('lessons/'+id),GharsDB.getAll('users')]);
  const comments=lesson?.comments||[];
  UI.showModal(`<div class="modal" style="max-width:480px">
    <div class="modal-header"><h3>💬 التعليقات — ${e(lesson?.title||'')}</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">${comments.length?comments.map((c,i)=>`
      <div class="comment-v2">
        <div class="comment-v2-header">
          <div class="comment-v2-avatar">${(users[c.studentId]?.name||'ط').charAt(0)}</div>
          <span class="comment-v2-name">${e(users[c.studentId]?.name||'طالب')}</span>
          <span class="comment-v2-time">${timeAgo(new Date(c.at))}</span>
        </div>
        <div class="comment-v2-text">${e(c.text)}</div>
        <div class="comment-v2-ago">${GharsUtils.toHijriShort(new Date(c.at))} · ${GharsUtils.formatTime(new Date(c.at))}</div>
      </div>`).join(''):noData('💬','لا توجد تعليقات')}</div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>عودة</button></div>
  </div>`);
}

// ============================================================
// REPORTS
// ============================================================
function setupReportForm() {
  // Set default dates (current month)
  const now=new Date();
  const from=new Date(now.getFullYear(),now.getMonth(),1);
  const fEl=document.getElementById('reportFrom');
  const tEl=document.getElementById('reportTo');
  if(fEl&&!fEl.value) fEl.value=from.toISOString().slice(0,10);
  if(tEl&&!tEl.value) tEl.value=now.toISOString().slice(0,10);
}
async function loadReports() {
  const reports=await GharsDB.getAll('reports');
  const c=document.getElementById('reportsList');
  if(!c) return;
  const list=Object.values(reports).filter(r=>!r.deleted).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  if(!list.length){c.innerHTML=noData('📄','لا توجد تقارير');return;}
  c.innerHTML=list.map((r,i)=>`<div class="report-card" style="animation-delay:${i*0.06}s">
    <div>
      <div style="font-weight:700;font-size:0.88rem">📋 ${e(r.title||'تقرير')}</div>
      <div style="font-size:0.75rem;color:var(--gray)">${e(r.dateFrom||'')} — ${e(r.dateTo||'')}</div>
    </div>
    <div class="flex gap-1">
      <button class="btn btn-sm btn-navy" onclick="viewReport('${r.id}')">👁</button>
      <button class="btn btn-sm btn-danger" onclick="deleteReport('${r.id}')">🗑</button>
    </div>
  </div>`).join('');
}
async function generateReport() {
  const from=document.getElementById('reportFrom')?.value;
  const to=document.getElementById('reportTo')?.value;
  const customTitle=document.getElementById('reportTitle')?.value?.trim()||'';
  if(!from||!to){UI.toast('يرجى تحديد نطاق التاريخ','error');return;}
  const fromDate=new Date(from+'T00:00:00');
  const toDate=new Date(to+'T23:59:59');
  if(fromDate>toDate){UI.toast('تاريخ البداية يجب أن يكون قبل النهاية','error');return;}
  const [users,meetings,ptsData,memoData,groups]=await Promise.all([
    GharsDB.getAll('users'),GharsDB.getAll('meetings'),
    GharsDB.getAll('points_summary'),GharsDB.getAll('memorization'),GharsDB.getAll('groups')
  ]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  // Strict date filtering
  const filteredMeetings=Object.values(meetings).filter(m=>{
    if(m.deleted) return false;
    const d=new Date(m.date);
    return d>=fromDate && d<=toDate;
  });
  const studentStats=students.map(s=>{
    let present=0,absent=0,excused=0;
    filteredMeetings.forEach(m=>{
      const st=m.attendance?.[s.id];
      if(st==='present')present++; else if(st==='absent')absent++; else if(st==='excused')excused++;
    });
    const memo=memoData[s.id]?.score||0;
    const pts=ptsData[s.id]?.total||0;
    return {name:s.name,group:s.group||'—',present,absent,excused,memo,pts};
  });
  const ptsRanked=[...studentStats].sort((a,b)=>b.pts-a.pts);
  const memoRanked=[...studentStats].sort((a,b)=>b.memo-a.memo);
  const groupsSorted=Object.values(groups).sort((a,b)=>(b.points||0)-(a.points||0));
  const id=GharsUtils.uid();
  const fromStr=formatArabicDate(fromDate), toStr=formatArabicDate(toDate);
  const autoTitle=`تقرير ${fromStr} — ${toStr}`;
  const report={
    id,title:customTitle||autoTitle,
    dateFrom:fromStr,dateTo:toStr,
    meetingsCount:filteredMeetings.length,
    studentStats,
    groupsSorted:groupsSorted.map(g=>({name:g.name,points:g.points||0})),
    topPts:ptsRanked[0]?.name||'—',topMemo:memoRanked[0]?.name||'—',
    avgPresent:studentStats.length?(studentStats.reduce((a,s)=>a+s.present,0)/studentStats.length).toFixed(1):'0',
    createdAt:new Date().toISOString(),deleted:false
  };
  await GharsDB.set('reports/'+id,report);
  viewReport(id);
}
function showCreateReport() { navigate('create-report'); }
async function viewReport(id) {
  navigate('view-report');
  const r=await GharsDB.get('reports/'+id);
  const c=document.getElementById('reportContent');
  if(!r||!c){if(c)c.innerHTML=noData('📋','التقرير غير موجود');return;}
  const rows=(r.studentStats||[]).map((s,i)=>{
    const pRank=(r.studentStats||[]).slice().sort((a,b)=>b.pts-a.pts).findIndex(x=>x.name===s.name)+1;
    const mRank=(r.studentStats||[]).slice().sort((a,b)=>b.memo-a.memo).findIndex(x=>x.name===s.name)+1;
    return `<tr><td>${e(s.name)}</td><td>${e(s.group)}</td><td>${s.present}</td><td>${s.absent}</td><td>${s.excused}</td><td>#${mRank}</td><td>#${pRank}</td></tr>`;
  }).join('');
  const grpRows=(r.groupsSorted||[]).map((g,i)=>`<tr><td>#${i+1}</td><td>${e(g.name)}</td><td>${g.points}</td></tr>`).join('');
  c.innerHTML=`<div class="card no-hover">
    <div class="card-header"><h3>📋 ${e(r.title)}</h3></div>
    <div class="card-body">
      <div class="alert alert-info mb-2">📅 <strong>${e(r.dateFrom)}</strong> — <strong>${e(r.dateTo)}</strong> · ${r.meetingsCount||0} لقاءات</div>
      <div class="table-wrapper mb-2"><table class="table"><thead><tr><th>الطالب</th><th>المجموعة</th><th>حضور</th><th>غياب</th><th>استئذان</th><th>النظم</th><th>النقاط</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="7" class="text-center">لا يوجد طلاب</td></tr>'}</tbody></table></div>
      ${grpRows?`<div class="separator mb-2"></div>
      <div style="font-weight:700;margin-bottom:8px">🏆 المجموعات</div>
      <div class="table-wrapper mb-2"><table class="table"><thead><tr><th>#</th><th>المجموعة</th><th>النقاط</th></tr></thead><tbody>${grpRows}</tbody></table></div>`:''}
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon">⭐</div><div class="stat-value" style="font-size:0.9rem">${e(r.topPts)}</div><div class="stat-label">متصدر النقاط</div></div>
        <div class="stat-card"><div class="stat-icon">📖</div><div class="stat-value" style="font-size:0.9rem">${e(r.topMemo)}</div><div class="stat-label">متصدر النظم</div></div>
        <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-value">${r.avgPresent}</div><div class="stat-label">متوسط الحضور</div></div>
      </div>
      <div class="flex gap-2 mt-2" style="justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="shareReport('${id}')">📤 مشاركة واتساب</button>
      </div>
    </div>
  </div>`;
}
async function deleteReport(id) {
  if(!await UI.confirm('حذف هذا التقرير؟','حذف')) return;
  await GharsDB.set('reports/'+id,{deleted:true,id});
  UI.toast('تم','success'); loadReports();
}
async function shareReport(id) {
  const r=await GharsDB.get('reports/'+id); if(!r) return;
  const text=`📋 ${r.title}\n📅 ${r.dateFrom} — ${r.dateTo}\n\nالطلاب:\n${
    (r.studentStats||[]).map(s=>`• ${s.name} | حضور:${s.present} غياب:${s.absent} | نقاط:${s.pts}`).join('\n')
  }\n\nمتصدر النقاط: ${r.topPts}\nمتصدر النظم: ${r.topMemo}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank');
}

// ============================================================
// HELPERS
// ============================================================
function formatArabicDate(date) {
  try{return date.toLocaleDateString('ar-SA-u-ca-islamic',{day:'numeric',month:'long',year:'numeric'});}
  catch(_){return GharsUtils.toHijriShort(date);}
}
async function loadMeetingsForSelect(selId) {
  const meetings=await GharsDB.getAll('meetings');
  const sel=document.getElementById(selId); if(!sel) return;
  const list=Object.values(meetings).filter(m=>!m.deleted).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const cur=sel.value;
  sel.innerHTML='<option value="">بدون ربط بلقاء</option>'+list.map(m=>`<option value="${m.id}">${e(m.title||'لقاء')} — ${formatArabicDate(new Date(m.date))}</option>`).join('');
  if(cur) sel.value=cur;
}
async function loadHwForSelect(selId) {
  const hw=await GharsDB.getAll('homework');
  const sel=document.getElementById(selId); if(!sel) return;
  const list=Object.values(hw).filter(h=>!h.deleted&&!h.expired).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const cur=sel.value;
  sel.innerHTML='<option value="">بدون واجب مرتبط</option>'+list.map(h=>`<option value="${h.id}">${e(h.title)}</option>`).join('');
  if(cur) sel.value=cur;
}
function timeAgo(date) {
  const diff=Date.now()-date.getTime();
  const m=Math.floor(diff/60000),h=Math.floor(diff/3600000),d=Math.floor(diff/86400000);
  if(d>0) return `منذ ${d} يوم`;
  if(h>0) return `منذ ${h} ساعة`;
  if(m>0) return `منذ ${m} دقيقة`;
  return 'الآن';
}
function noData(icon,msg){return `<div class="no-data"><div class="no-data-icon">${icon}</div><p>${msg}</p></div>`;}
function e(str){return GharsUtils.esc(str||'');}