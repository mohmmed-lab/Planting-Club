// ============================================================
// GHARS CLUB — Teacher JS v4
// ============================================================
'use strict';


// ── مساعد: حذف مفاتيح من localStorage و IndexedDB دفعة واحدة ──
function _purgeLocal(keys) {
  keys.forEach(k => {
    try { localStorage.removeItem(k); } catch(_) {}
    if (typeof GharsDataDB !== 'undefined') GharsDataDB.del(k).catch(() => {});
  });
}
function _purgeByPrefix(prefix) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.includes(prefix)) keys.push(k);
  }
  _purgeLocal(keys);
}

// ─────────────────────────────────────────────────────────────
// _deleteLessonStorageFiles
// يستخرج روابط PDF والفيديو من كائن الدرس ويحذفها من Storage.
// يعتمد على GharsDB.deleteStorageFiles في supabase-client.js
// ─────────────────────────────────────────────────────────────
async function _deleteLessonStorageFiles(lessonOrLessons) {
  const lessons = Array.isArray(lessonOrLessons) ? lessonOrLessons : [lessonOrLessons];
  const urlsToDelete = [];

  lessons.forEach(function(l) {
    if (!l) return;
    if (l.pdfUrl) urlsToDelete.push(l.pdfUrl);
    if (l.uploadedVideoUrl) urlsToDelete.push(l.uploadedVideoUrl);
    // backward compat: videoUrl القديم إذا كان مرفوعاً على Storage
    if (l.videoSource === 'upload' && l.videoUrl && l.videoUrl !== l.uploadedVideoUrl) {
      urlsToDelete.push(l.videoUrl);
    }
  });

  if (!urlsToDelete.length) return;
  const result = await GharsDB.deleteStorageFiles(urlsToDelete);
  if (result.errors && result.errors.length) {
    console.warn('⚠️ فشل حذف بعض الملفات من Storage:', result.errors);
  }
}


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
let _isFirstLoad = false;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!await Auth.requireAuth('teacher')) return;
  // ══ إزالة شاشة التحميل بعد نجاح التحقق ══
  document.body.classList.remove('app-loading');
  const user = Auth.currentUser;
  setEl('headerUserName', user.name);
  setEl('sidebarUserName', user.name);
  const av = document.getElementById('headerAvatar');
  if (av) {
    _applyAvatarImage(av, user);
    av.title = 'اضغط لتغيير الصورة الشخصية';
    av.style.cursor = 'pointer';
    av.onclick = () => _openAvatarPicker();
  }
  const headerUser = document.getElementById('headerUserName');
  if (headerUser) {
    headerUser.style.cursor = 'pointer';
    headerUser.title = 'اضغط لعرض رمز QR الخاص بك';
    headerUser.onclick = () => showTeacherProfile();
  }
  if (user.role === 'admin') {
    const ti = document.getElementById('addTeacherNavItem');
    if (ti) ti.style.display = 'flex';
  }

  const hash = location.hash.replace('#','');
  const validPages = ['home','homework','students','meetings','points','memorization',
    'groups','seerah','teachers','stats','reports','add-homework','add-lesson',
    'add-meeting','attendance','create-report','view-report','lesson-comments','survey-submissions','survey-detail',
    'teacher-sharebox','teacher-sharechat','teacher-all-posts'];
  const startPage = validPages.includes(hash) ? hash : 'home';

  // تحميل أولي — navigate سيستدعي onPageLoad تلقائياً
  // (داخل DOMContentLoaded بعد تحديد startPage)...
  
  _isFirstLoad = true;
  navigate(startPage, true);
  await Promise.all([loadHomeStats(), loadUpcomingMeeting(), loadLastSeen(), loadReports()]);
  _isFirstLoad = false;
  setupRealtimeListeners();

  // ── إزالة شاشة التحميل هنا يمنع وميض الصفحات ──
  document.body.classList.remove('app-loading');

  window.addEventListener('ghars:connected', function _onFirstConnect() {
    window.removeEventListener('ghars:connected', _onFirstConnect);
    ['homework','lessons','meetings','groups','points_summary',
     'share_posts','memorization','system','submissions','users']
      .forEach(function(c){ GharsDB._invalidate(c); });
    onPageLoad(currentPage); 
  });
  _setupCountdownLongPress();

  window.addEventListener('popstate', (e) => {
    const p = (e.state && e.state.page) ? e.state.page : 'home';
    navigateSilent(p);
  });
});

// ⚠️ تأكد من حذف هذا الكود تماماً من ملف teacher.js لأنه يسبب تكرار توجيه الصفحة (Double Loading):
// window.addEventListener('load', function() {
//   var _hash = location.hash.replace('#','');
//   if (_hash && document.getElementById('section-'+_hash)) {
//     _activatePage(_hash);
//   }
// });

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
  _showTopBar();
  _activatePage(page);
}
function navigateSilent(page) {
  _activatePage(page);
}

// ── شريط التقدم العلوي عند التنقل بين الصفحات ──
function _showTopBar() {
  var bar = document.getElementById('ghars-topbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ghars-topbar';
    document.body.appendChild(bar);
  }
  // إعادة ضبط
  bar.classList.remove('done');
  bar.style.opacity = '1';
  bar.style.width = '0%';
  clearInterval(bar._timer);
  // تقدم تدريجي سريع
  var steps = [18, 38, 58, 76, 89];
  var idx = 0;
  bar._timer = setInterval(function() {
    if (idx < steps.length) { bar.style.width = steps[idx] + '%'; idx++; }
    else clearInterval(bar._timer);
  }, 75);
  // إنهاء + إخفاء
  setTimeout(function() {
    clearInterval(bar._timer);
    bar.classList.add('done');
    setTimeout(function() {
      bar.classList.remove('done');
      bar.style.width = '0%';
      bar.style.opacity = '1';
    }, 620);
  }, 480);
}

function _activatePage(page) {
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const sec = document.getElementById('section-' + page);
  if (sec) {
    sec.classList.add('active');
    if (page === 'teacher-sharechat' || page === 'teacher-sharebox' || page === 'teacher-all-posts') {
      sec.style.display = 'flex';
    } else {
      sec.style.display = 'block';
    }
    if (!sec.dataset.animated) sec.dataset.animated = '1';
  }
  // صفحات يجب إخفاء الهيدر وشريط العد فيها
  const hideHeaderPages = ['teacher-sharechat', 'teacher-sharebox'];
  const topHeader   = document.querySelector('.top-header');
  const countdownBr = document.getElementById('countdownBar');
  const footer      = document.querySelector('footer.footer');
  if (topHeader)   topHeader.style.display   = hideHeaderPages.includes(page) ? 'none' : '';
  if (countdownBr && hideHeaderPages.includes(page)) countdownBr.style.display = 'none';
  if (footer)      footer.style.display      = hideHeaderPages.includes(page) ? 'none' : '';

  document.querySelectorAll('.nav-item').forEach(item =>
    item.classList.toggle('active', item.dataset.page === page));
  currentPage = page;
  closeSidebar();
  if (!hideHeaderPages.includes(page)) window.scrollTo({ top: 0, behavior: 'smooth' });
  onPageLoad(page);
}

function onPageLoad(page) {
  if (_isFirstLoad && page === 'home') return; // تجنب التحميل المزدوج عند البداية
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
    case 'lesson-comments':
      if(_currentCommentsLessonId) {
        loadCommentsPage(_currentCommentsLessonId);
      } else {
        // لا يوجد سياق عند تحديث الصفحة — رجوع لقائمة الدروس
        const _savedCommentsId = localStorage.getItem('ghars__currentCommentsLessonId');
        if(_savedCommentsId) { _currentCommentsLessonId = _savedCommentsId; loadCommentsPage(_savedCommentsId); }
        else navigate('seerah', true);
      }
      break;
    case 'teacher-sharebox': loadTeacherShareBox(); break;
    case 'teacher-sharechat':
      if(_currentShareChatStudentId) {
        loadShareChatMessages(_currentShareChatStudentId);
      } else {
        const _savedChatId = localStorage.getItem('ghars__currentShareChatStudentId');
        if(_savedChatId) { _currentShareChatStudentId = _savedChatId; loadShareChatMessages(_savedChatId); }
        else navigate('teacher-sharebox', true);
      }
      break;
    case 'teacher-all-posts': loadAllSharePostsPage(); break;
    case 'stats':
      if(activeStats) {
        if(activeStats==='attendance')       loadAttStats();
        else if(activeStats==='homework')    loadHwStatsSelect();
        else if(activeStats==='memorization') loadMemoStats();
        else if(activeStats==='points')      loadPointsStats();
        else if(activeStats==='groups')      loadGroupStats();
      }
      break;
    case 'view-report':  break; // loaded by viewReport()
    case 'reports':      loadReports(); break;
    case 'survey-submissions': loadSurveySubmissionsPage(); break;
    case 'survey-detail':      break;
    case 'add-homework':
      if (!editingHwId) {
        // واجب جديد — نعيد تهيئة كامل للنموذج
        hwQuestionCount = 0; choiceCounts = {};
        hwHideGradeEnabled = false;
        const hwTitleEl = document.getElementById('hwTitle');
        const hwDeadlineEl = document.getElementById('hwDeadline');
        const hwTimeLimitEl = document.getElementById('hwTimeLimit');
        const hwLinkEl = document.getElementById('hwLinkMeeting');
        if(hwTitleEl) hwTitleEl.value = '';
        if(hwDeadlineEl) hwDeadlineEl.value = '';
        if(hwTimeLimitEl) hwTimeLimitEl.value = '';
        if(hwLinkEl) hwLinkEl.value = '';
        const qc = document.getElementById('questionsContainer');
        if (qc) qc.innerHTML = '';
        const ft = document.getElementById('hwFormTitle');
        if (ft) ft.textContent = '➕ إضافة واجب جديد';
        updateHideGradeUI();
        loadMeetingsForSelect('hwLinkMeeting').then(() => {
          addQuestion();
        });
      } else {
        // تعديل واجب موجود
        loadMeetingsForSelect('hwLinkMeeting');
      }
      break;
    case 'add-lesson':
      if (!editingLessonId) resetLessonForm();
      loadMeetingsForSelect('lessonLinkMeeting');
      loadHwForSelect('lessonLinkHw');
      break;
    case 'add-meeting':
      // Always reset form for fresh entry
      const mtEl = document.getElementById('meetingTitle');
      const mdEl = document.getElementById('meetingDateTime');
      if (mtEl) mtEl.value = '';
      if (mdEl) mdEl.value = '';
      loadGroupsForMeeting('meetingGroupTasksContainer');
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
// لا تحديث تلقائي — Firebase يزامن localStorage فقط في الخلفية
function pauseRealtime(ms=2000) { /* no-op */ }

function setupRealtimeListeners() {
  // مزامنة realtime — عند أي تغيير في البيانات يُبطَل الكاش ويُعاد التحميل
  GharsDB.listen('users', () => {
    GharsDB._invalidate('users');
    if(Auth.currentUser) {
      const uid = Auth.currentUser.id;
      // التحقق من قاعدة البيانات بعد التحديث
      GharsDB.get('users/'+uid).then(function(u){
        // إذا رجعت البيانات فارغة (null) فهذا يعني أن الحساب حُذف قاطعاً، أو إذا كان يحمل علامة الحذف
        if(!u || u.deleted || u.purged || u.qrInvalidated || u.password==='__REVOKED__'){
          if(typeof _addToDeletedList==='function') _addToDeletedList(uid);
          try{localStorage.removeItem('ghars__saved_creds');}catch(_){}
          Auth.currentUser=null;
          localStorage.removeItem('ghars__session');
          window.location.href='index.html'; // طرد إلى صفحة الدخول
        }
      }).catch(function(){});
    }
  });
  GharsDB.listen('groups', () => {
    GharsDB._invalidate('groups');
    // إعادة تحميل القوائم بناءً على الصفحة الحالية
    if (typeof loadStudents === 'function' && currentPage === 'students') loadStudents();
    if (typeof loadTeachers === 'function' && currentPage === 'teachers') loadTeachers();
    if (typeof loadHomeStats === 'function') loadHomeStats();
    if (typeof loadLastSeen === 'function') loadLastSeen();
  });
}

// ============================================================
// HOME STATS
// ============================================================

// ============================================================
// معاينة قبل مشاركة واتساب
// ============================================================
function showSharePreview(msg) {
  const cleanMsg = (msg||'').trim();
  window._shareText = cleanMsg;
  const previewHtml = cleanMsg
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*([^*\n]+)\*/g,'<strong>$1</strong>')
    .replace(/\n/g,'<br>');
  UI.showModal(
    '<div class="modal" style="max-width:480px">' +
    '<div class="modal-header" style="background:#075e54">' +
    '<h3 style="color:#fff;font-size:0.95rem">💬 معاينة الرسالة</h3>' +
    '<button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:0.9rem">✖</button>' +
    '</div>' +
    '<div class="modal-body" style="background:#e5ddd5;padding:14px;min-height:80px">' +
    '<div style="background:#dcf8c6;border-radius:12px 12px 3px 12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.15);font-family:Tajawal,sans-serif;font-size:0.88rem;line-height:2.0;direction:rtl;text-align:right;max-height:54vh;overflow-y:auto;word-break:break-word;color:#111">' +
    previewHtml + '</div>' +
    '</div>' +
    '<div class="modal-footer" style="background:#f0f0f0;border-top:1px solid #ddd;gap:8px;padding:10px 14px">' +
    '<button class="btn" style="background:#25d366;color:#fff;font-weight:800;flex:1;border-radius:22px;padding:10px;font-size:0.9rem" onclick="copyShareText()">📋 نسخ الرسالة</button>' +
    '<button class="btn btn-gray" data-close-modal style="border-radius:22px;padding:10px 16px">إغلاق</button>' +
    '</div>' +
    '</div>'
  );
}
function copyShareText() {
  const msg = window._shareText||'';
  if(navigator.clipboard) {
    navigator.clipboard.writeText(msg).then(()=>UI.toast('✅ تم النسخ','success')).catch(()=>_fallbackCopy(msg));
  } else { _fallbackCopy(msg); }
}
function _fallbackCopy(text) {
  const ta=document.createElement('textarea');
  ta.value=text; ta.style.cssText='position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand('copy'); UI.toast('✅ تم النسخ','success'); } catch(e){ UI.toast('⚠️ لم يتم النسخ، حاول مرة أخرى','error'); }
  document.body.removeChild(ta);
}

async function loadHomeStats() {
  // ── عرض فوري من الكاش إن وُجد ──
  const cachedUsers = GharsDB._getCached('users');
  const cachedGroups = GharsDB._getCached('groups');
  if(cachedUsers) {
    const stu = Object.values(cachedUsers).filter(u=>u.role==='student'&&!u.deleted);
    setEl('statTotalStudents', stu.length);
    setEl('statTotalGroups', Object.keys(cachedGroups||{}).length);
  }
  // ── جلب كامل ──
  const [users, groups, memoData, pointsData] = await Promise.all([
    GharsDB.getAll('users'), GharsDB.getAll('groups'),
    GharsDB.getAll('memorization'), GharsDB.getAll('points_summary')
  ]);
  const students = Object.values(users).filter(u => u.role==='student'&&!u.deleted);
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
  setEl('statTopMemo', topMemo ? topMemo.name : '-');
  setEl('statTopPoints', topPts ? topPts.name : '-');
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
  const bar = document.getElementById('countdownBar');
  // تحقق من الإخفاء المؤقت (ضغطة مطولة)
  const hideUntil = parseInt(localStorage.getItem('ghars__cdHideUntil')||'0');
  if (Date.now() < hideUntil) { if(bar) bar.style.display='none'; return; }
  const meetings = await GharsDB.getAll('meetings');
  const now = Date.now();
  const allUpcoming = Object.values(meetings)
    .filter(m => !m.deleted && new Date(m.date).getTime() > (now-86400000))
    .sort((a,b) => new Date(a.date)-new Date(b.date));
  if (!allUpcoming.length) { if(bar) bar.style.display='none'; return; }
  const trueNext = allUpcoming.find(m=>new Date(m.date).getTime()>now) || allUpcoming[0];
  const next = trueNext;
  if(bar) bar.style.display='flex';
  const tt = document.getElementById('cdMeetingTitle');
  if(tt) tt.textContent = next.title||'';
  const taskWrap = document.getElementById('cdGroupTasks');
  if(taskWrap) taskWrap.style.display='none';
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
  const students = Object.values(users).filter(u=>u.role==='student'&&!u.deleted)
    .sort((a,b)=>{
      // المتصلون أولاً، ثم الأحدث ظهوراً
      const ao=Auth.isOnline(a), bo=Auth.isOnline(b);
      if(ao&&!bo) return -1; if(!ao&&bo) return 1;
      return new Date(b.lastSeen||0)-new Date(a.lastSeen||0);
    });
  const c = document.getElementById('lastSeenList');
  if (!c) return;
  if (!students.length) { c.innerHTML = noData('👤','لا يوجد طلاب'); return; }

  function fmtLastSeen(s) {
    if(!s.lastSeen) return '<span style="color:var(--gray);font-size:0.74rem">لم يسجل دخول بعد</span>';
    const diff = Date.now()-new Date(s.lastSeen).getTime();
    const mins = Math.floor(diff/60000);
    const hrs  = Math.floor(diff/3600000);
    const days = Math.floor(diff/86400000);
    let ago='';
    if(mins<1)       ago='<span style="color:#48bb78;font-weight:900">الآن</span>';
    else if(mins<60) ago=`<span style="color:#c9a227;font-weight:800">منذ ${mins} دقيقة</span>`;
    else if(hrs<24)  ago=`<span style="color:#c9a227;font-weight:800">منذ ${hrs} ساعة</span>`;
    else if(days<7)  ago=`<span style="color:rgba(201,162,39,0.85);font-weight:700">منذ ${days} يوم</span>`;
    else             ago=`<span style="color:rgba(201,162,39,0.7)">منذ أكثر من أسبوع</span>`;
    return `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:0.73rem;margin-top:2px">${ago}</div>`;
  }

  const INITIAL_COUNT = 3;
  function buildSeenRow(s, i) {
    const online = Auth.isOnline(s);
    const avStyle = s.avatarUrl
      ? `style="background-image:url(${e(s.avatarUrl)});background-size:cover;background-position:center;color:transparent;cursor:pointer" onclick="showUserAvatar('${e(s.avatarUrl).replace(/'/g,'&#39;')}',false)"`
      : '';
    const avText = s.avatarUrl ? '' : s.name.charAt(0);
    return `<div class="seen-row" style="animation-delay:${i*0.04}s;${online?'background:rgba(72,187,120,0.04);border-right:3px solid rgba(72,187,120,0.5)':''}">
      <div class="seen-avatar" ${avStyle}>${avText}</div>
      <div style="flex:1;min-width:0">
        <div class="seen-name">${e(s.name)}</div>
        <div style="margin-top:2px">${fmtLastSeen(s)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0">
        <span class="${online?'online-dot':'offline-dot'}" style="${online?'animation:pulse 1.5s ease-in-out infinite':''}"></span>
        <span style="font-size:0.65rem;font-weight:800;color:${online?'#48bb78':'var(--gray)'};">${online?'متصل':'غير متصل'}</span>
      </div>
    </div>`;
  }

  const initialRows = students.slice(0, INITIAL_COUNT).map((s,i) => buildSeenRow(s,i)).join('<div style="height:1px;background:var(--gray-mid);margin:2px 0"></div>');
  const extraRows   = students.slice(INITIAL_COUNT).map((s,i) => buildSeenRow(s, INITIAL_COUNT+i)).join('<div style="height:1px;background:var(--gray-mid);margin:2px 0"></div>');
  const remaining   = students.length - INITIAL_COUNT;

  const expandBtn = remaining > 0
    ? `<div id="seenExpandWrap">
        <div style="height:1px;background:var(--gray-mid);margin:2px 0"></div>
        <div style="display:none" id="seenExtraRows">${remaining>0?'<div style="height:1px;background:var(--gray-mid);margin:2px 0"></div>':''}${extraRows}</div>
        <button onclick="(function(){
          var ex=document.getElementById('seenExtraRows');
          var btn=document.getElementById('seenExpandBtn');
          if(ex.style.display==='none'){ex.style.display='block';btn.textContent='▲ عرض أقل';}
          else{ex.style.display='none';btn.textContent='▼ عرض الكل (${remaining} طالب)';}
        })()" id="seenExpandBtn"
          style="width:100%;padding:9px;background:none;border:none;border-top:1px solid var(--gray-mid);color:var(--gold);font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;text-align:center;margin-top:4px;transition:background 0.2s;"
          onmouseover="this.style.background='rgba(201,162,39,0.06)'" onmouseout="this.style.background='none'">
          ▼ عرض الكل (${remaining} طالب)
        </button>
      </div>`
    : '';

  c.innerHTML = initialRows + expandBtn;

  // التحديث يدوي — لا تحديث تلقائي
}

// ============================================================
// STATS
// ============================================================
let activeStats = null;
function showStatsPage() { navigate('stats'); }
function toggleStats(type, ev) {
  const btn = (ev && ev.currentTarget)
    || document.querySelector(`.stats-toggle-btn[onclick*="'${type}'"]`)
    || [...document.querySelectorAll('.stats-toggle-btn')].find(b => b.getAttribute('onclick') && b.getAttribute('onclick').includes("'"+type+"'"));
  const all = ['attendance','homework','memorization','points','groups'];
  if (activeStats===type) {
    document.getElementById('statsContent-'+type).style.display='none';
    document.querySelectorAll('.stats-toggle-btn').forEach(b=>b.classList.remove('active'));
    activeStats=null; return;
  }
  all.forEach(s=>{ const el=document.getElementById('statsContent-'+s); if(el)el.style.display='none'; });
  document.querySelectorAll('.stats-toggle-btn').forEach(b=>b.classList.remove('active'));
  const targetEl = document.getElementById('statsContent-'+type);
  if(targetEl) {
    targetEl.style.display='block';
    const skEl = targetEl.querySelector('tbody,#memoStatsCont,#pointsStatsCont,#groupStatsCont');
    if(skEl && !skEl.innerHTML.trim()) {
      skEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px"><div class="section-loading" style="padding:12px 0"><span class="loader loader-sm"></span> جاري التحميل...</div></td></tr>';
    }
  }
  if(btn) btn.classList.add('active');
  activeStats=type;
  requestAnimationFrame(() => {
    if(type==='attendance')        loadAttStats();
    else if(type==='homework')     loadHwStatsSelect();
    else if(type==='memorization') loadMemoStats();
    else if(type==='points')       loadPointsStats();
    else if(type==='groups')       loadGroupStats();
  });
}

// ============================================================
// SHARE PREVIEW MODAL
// ============================================================
// ============================================================
// ATTENDANCE STATS
// ============================================================
async function loadAttStats() {
  const [users,meetings]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('meetings')]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted).sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0));
  const mList=Object.values(meetings).filter(m=>!m.deleted);
  const tbody=document.getElementById('attendanceTbody'); if(!tbody) return;
  if(!students.length){tbody.innerHTML='<tr><td colspan="4" class="text-center text-gray">لا يوجد طلاب</td></tr>';return;}
  tbody.innerHTML=students.map(s=>{
    let p=0,ab=0,ex=0;
    mList.forEach(m=>{const st=m.attendance?.[s.id];if(st==='present')p++;else if(st==='absent')ab++;else if(st==='excused')ex++;});
    return `<tr><td>${e(s.name)}</td><td><span class="badge badge-green">${p}</span></td><td><span class="badge badge-red">${ab}</span></td><td><span class="badge badge-orange">${ex}</span></td></tr>`;
  }).join('');
  const shareBtn=document.getElementById('attShareBtn');
  if(shareBtn) {
    shareBtn.onclick=async()=>{
      const [u2,m2]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('meetings')]);
      const studs=Object.values(u2).filter(u=>u.role==='student'&&!u.deleted).sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0));
      const meets=Object.values(m2).filter(m=>!m.deleted);
      let msg='📊  *إحصائية الحضور والغياب*\n            *من بداية البرنامج*\n━━━━━━━━━━━━━';
      studs.forEach(s=>{
        let p=0,ab=0,ex=0;
        meets.forEach(m=>{const st=m.attendance?.[s.id];if(st==='present')p++;else if(st==='absent')ab++;else if(st==='excused')ex++;});
        msg+='\n👤*'+s.name+'*\n           ✅ حاضر : '+p+' |\n  ❌ غائب : '+ab+' |  ⚠️ مستأذن : '+ex+'\n━━━━━━━━━━━━━';
      });
      showSharePreview(msg);
    };
  }
}

// ============================================================
// HOMEWORK STATS
// ============================================================
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
  const maxPts=(hw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
  const activeStudents=Object.values(users).filter(u=>u.role==='student'&&!u.deleted).sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0));
  cont.innerHTML=`<div class="table-wrapper"><table class="table">
  <colgroup>
    <col style="width:35%">
    <col style="width:18%">
    <col style="width:18%">
    <col style="width:15%">
    <col style="width:14%">
  </colgroup>
  <thead><tr>
    <th style="white-space:normal;font-size:0.78rem">الطالب</th>
    <th style="font-size:0.78rem">الحالة</th>
    <th style="font-size:0.78rem">الدرجة</th>
    <th style="font-size:0.78rem">المخالفات</th>
    <th style="font-size:0.78rem">تفاصيل</th>
  </tr></thead><tbody>${
    activeStudents.map(s=>{
      const sub=Object.values(subs).find(sb=>sb.homeworkId===hwId&&sb.studentId===s.id);
      const cheatKey='cheat_'+hwId+'_'+s.id;
      const cheat=cheating[cheatKey]
        ||Object.values(cheating).find(ch=>ch&&ch.id===cheatKey)
        ||Object.values(cheating).find(ch=>ch&&ch.homeworkId===hwId&&ch.studentId===s.id)
        ||null;
      const warns=cheat?cheat.warnings:null;
      const status=sub?'<span class="badge badge-green">✅ تم</span>':'<span class="badge badge-red">❌ لم يحل</span>';
      const score=sub?`${sub.score||0}/${maxPts}`:'-';
      let cheatBadge='<span style="color:var(--gray);font-size:0.8rem">—</span>';
      if(sub){
        const w=warns||0;
        if(w===0){
          cheatBadge='<div style="text-align:center"><span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;background:#c6f6d5;color:#22543d;font-weight:900;font-size:1rem;border:2px solid #68d391">0</span></div>';
        } else if(w<=2){
          cheatBadge=`<div style="text-align:center"><span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;background:#fef3c7;color:#92400e;font-weight:900;font-size:1rem;border:2px solid #f6ad55;cursor:pointer" onclick="showCheatDetails('${s.id}','${hwId}')">${w}</span></div>`;
        } else {
          cheatBadge=`<div style="text-align:center"><span style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:50%;background:#fed7d7;color:#742a2a;font-weight:900;font-size:1rem;border:2px solid #fc8181;cursor:pointer" onclick="showCheatDetails('${s.id}','${hwId}')">${w}</span></div>`;
        }
      }
      const detail=sub?`<button class="btn btn-primary btn-sm" onclick="showStudentAnswers('${s.id}','${hwId}')">📋</button>`:'';
      return `<tr>
        <td style="word-break:break-word;white-space:normal;font-size:0.8rem;line-height:1.4;padding:8px 6px">${e(s.name)}</td>
        <td style="font-size:0.78rem;padding:8px 4px">${status}</td>
        <td style="font-size:0.8rem;font-weight:700;padding:8px 4px">${score}</td>
        <td style="padding:8px 4px">${cheatBadge}</td>
        <td style="padding:8px 4px">${detail}</td>
      </tr>`;
    }).join('')
  }</tbody></table></div>
  <div class="stats-share-wrap" style="justify-content:center"><button class="stats-share-btn" id="hwShareBtn">📊 عرض الإحصائية</button></div>`;
  document.getElementById('hwShareBtn').onclick=()=>_showHwStatsModal(hw, activeStudents, subs, hwId, maxPts);
}


// ============================================================
// HW STATS MODAL — عرض إحصائية الواجب كموديل جميل
// ============================================================

// متغير عالمي لحفظ بيانات الإحصائية (لاستخدامها في onclick بدون مشكلة الـ closures)
window.__hwStatsCtx = null;

function __hwRenderRows(showGrades) {
  const ctx = window.__hwStatsCtx;
  if (!ctx) return '';
  return ctx.studentData.map(d => {
    const scoreHtml = d.sub
      ? (d.isCancelled
          ? `<span style="color:var(--red,#e53e3e);font-weight:700">0/${ctx.maxPts} 🚫</span>`
          : `<span style="color:var(--gold,#c9a227);font-weight:800">${d.sub.score||0}/${ctx.maxPts}</span>`)
      : `<span style="color:var(--gray,#8892a4)">—</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;margin-bottom:6px">
      <span style="font-size:0.88rem;font-weight:700;color:var(--navy,#0a1628);flex:1">${d.nameSafe}</span>
      <span style="margin-left:10px;font-size:1rem">${d.statusIcon}</span>
      ${showGrades ? `<span style="margin-right:8px;font-size:0.88rem">${scoreHtml}</span>` : ''}
    </div>`;
  }).join('');
}

function __hwToggleGrades() {
  const btn = document.getElementById('hwGradesToggleBtn');
  if (!btn) return;
  const isOn = btn.dataset.on === '1';
  const nowOn = !isOn;
  btn.dataset.on = nowOn ? '1' : '0';
  btn.style.background = nowOn
    ? 'linear-gradient(135deg,#c9a227,#a07d10)'
    : 'linear-gradient(135deg,#718096,#4a5568)';
  btn.textContent = nowOn ? '✅ إخفاء الدرجات' : '📊 كتابة درجات الطلاب';
  const rows = document.getElementById('hwStatsRows');
  if (rows) rows.innerHTML = __hwRenderRows(nowOn);
}

function __hwCopy() {
  const ctx = window.__hwStatsCtx;
  if (!ctx) return;
  const btn = document.getElementById('hwStatsCopyBtn');
  const showGrades = document.getElementById('hwGradesToggleBtn')?.dataset.on === '1';
  let text = `📝  *إحصائية واجب : ${ctx.hwTitle}*\n━━━━━━━━━━━━━`;
  ctx.studentData.forEach((d, i) => {
    const gradeText = showGrades
      ? ` | الدرجة : ${d.sub ? (d.isCancelled ? `0/${ctx.maxPts}` : `${d.sub.score||0}/${ctx.maxPts}`) : '—'}`
      : '';
    text += `\n *${d.name}* — ${d.statusText}${gradeText}`;
    if (i < ctx.studentData.length - 1) text += '\n___________';
  });
  text += `\n━━━━━━━━━━\n*عدد منجزي الواجب : ${ctx.solvedCount}*\n*عدد غير المنجزين : ${ctx.notSolvedCount}*`;

  const doSuccess = () => {
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ تم النسخ!';
    btn.style.background = 'linear-gradient(135deg,#38a169,#276749)';
    setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 2200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(doSuccess).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); doSuccess();
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); doSuccess();
  }
}

function _showHwStatsModal(hw, students, subs, hwId, maxPts) {
  let solvedCount = 0, notSolvedCount = 0, totalScore = 0;

  const studentData = students.map(s => {
    const sub = Object.values(subs).find(sb => sb.homeworkId === hwId && sb.studentId === s.id);
    if (sub) { solvedCount++; totalScore += (sub.score || 0); }
    else notSolvedCount++;
    const isCancelled = sub && (sub.zeroByCheat || sub.cheated);
    return {
      name: s.name,
      nameSafe: e(s.name),
      sub,
      isCancelled,
      statusText: sub ? (isCancelled ? 'حلّ الواجب (ملغى)' : 'حلّ الواجب ✅') : 'لم يحل الواجب ❌',
      statusIcon: sub ? (isCancelled ? '🚫' : '✅') : '❌'
    };
  });

  // حفظ السياق عالمياً لاستخدامه في الدوال العالمية
  window.__hwStatsCtx = { studentData, solvedCount, notSolvedCount, maxPts, hwTitle: hw.title };

  const avgScore = solvedCount > 0 ? Math.round(totalScore / solvedCount * 10) / 10 : 0;
  const pct = students.length > 0 ? Math.round((solvedCount / students.length) * 100) : 0;

  UI.showModal(`<div class="modal" style="max-width:480px">
    <div class="modal-header" style="background:linear-gradient(135deg,var(--navy),var(--navy-light))">
      <h3 style="color:var(--gold)">📊 إحصائية — ${e(hw.title)}</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:16px;max-height:72vh;overflow-y:auto">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
        <div style="text-align:center;background:var(--green-light);border-radius:10px;padding:12px 8px;border:1px solid rgba(56,161,105,0.3)">
          <div style="font-size:1.6rem;font-weight:900;color:var(--green)">${solvedCount}</div>
          <div style="font-size:0.7rem;color:var(--gray)">أنجزوا الواجب</div>
        </div>
        <div style="text-align:center;background:var(--red-light);border-radius:10px;padding:12px 8px;border:1px solid rgba(229,62,62,0.3)">
          <div style="font-size:1.6rem;font-weight:900;color:var(--red)">${notSolvedCount}</div>
          <div style="font-size:0.7rem;color:var(--gray)">لم ينجزوا</div>
        </div>
        <div style="text-align:center;background:rgba(201,162,39,0.08);border-radius:10px;padding:12px 8px;border:1px solid rgba(201,162,39,0.3)">
          <div style="font-size:1.6rem;font-weight:900;color:var(--gold)">${pct}%</div>
          <div style="font-size:0.7rem;color:var(--gray)">نسبة الإنجاز</div>
        </div>
      </div>
      ${solvedCount > 0 ? `<div style="background:#f8fafc;border-radius:10px;padding:10px 14px;margin-bottom:14px;border:1px solid var(--gray-mid);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:0.85rem;color:var(--navy);font-weight:700">📈 متوسط الدرجات</span>
        <span style="font-size:1rem;font-weight:900;color:var(--gold)">${avgScore} / ${maxPts}</span>
      </div>` : ''}
      <div style="font-weight:700;font-size:0.85rem;color:var(--navy);margin-bottom:10px">📋 تفاصيل الطلاب</div>
      <div id="hwStatsRows">${__hwRenderRows(false)}</div>
    </div>
    <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="hwStatsCopyBtn" onclick="__hwCopy()"
          style="padding:9px 16px;border:none;border-radius:10px;background:linear-gradient(135deg,var(--navy,#0a1628),#1a3a6e);color:#fff;font-family:inherit;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px">
          📋 نسخ الإحصائية
        </button>
        <button id="hwGradesToggleBtn" onclick="__hwToggleGrades()" data-on="0"
          style="padding:9px 16px;border:none;border-radius:10px;background:linear-gradient(135deg,#718096,#4a5568);color:#fff;font-family:inherit;font-size:0.85rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all 0.25s">
          📊 الدرجات
        </button>
      </div>
      <button class="btn btn-gray" data-close-modal>إغلاق</button>
    </div>
  </div>`);
}

// ============================================================
// SHOW STUDENT ANSWERS (details modal)
// ============================================================
async function showStudentAnswers(studentId,hwId) {
  const [hw,subs,user]=await Promise.all([GharsDB.get('homework/'+hwId),GharsDB.getAll('submissions'),GharsDB.get('users/'+studentId)]);
  const sub=Object.values(subs).find(s=>s.homeworkId===hwId&&s.studentId===studentId);
  if(!sub||!hw){UI.toast('لم يتم العثور على بيانات','error');return;}
  const maxPts=(hw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
  const durationStr=GharsUtils.formatDuration(sub.duration||0);
  const questionsHtml=(hw.questions||[]).map((q,i)=>{
    const raw=sub.answers?.[i]??null;
    let ok=false,ansLabel='لم يجب',correctLabel='';
    const isMulti=q.multiCorrect||q.multipleCorrect;
    if(isMulti){
      const corrArr=q.correctAnswers||(Array.isArray(q.correctAnswer)?q.correctAnswer:[q.correctAnswer]);
      const studArr=Array.isArray(raw)?raw:(raw?[raw]:[]);
      ok=corrArr.length>0&&corrArr.length===studArr.length&&corrArr.every(a=>studArr.includes(a));
      ansLabel=studArr.join(' + ')||'لم يجب';
      correctLabel=corrArr.join(' + ');
    } else {
      ok=raw===q.correctAnswer;
      ansLabel=raw||'لم يجب';
      correctLabel=q.correctAnswer||'';
    }
    return `<div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:8px;border-right:3px solid ${ok?'var(--green)':'var(--red)'}">
      <div style="font-weight:700;font-size:0.85rem;margin-bottom:4px">
        س${i+1}: ${e(q.question)} ${isMulti?'<span style="background:rgba(201,162,39,0.15);color:var(--gold-dark);border-radius:8px;padding:1px 7px;font-size:0.68rem;font-weight:700">⚡ متعدد</span>':''} <span style="font-size:0.72rem;color:var(--gold)">${q.points||1} درجة</span>
      </div>
      <div style="font-size:0.8rem">إجابته: <strong>${e(ansLabel)}</strong> ${ok?'✅':'❌'}</div>
      ${!ok?`<div style="font-size:0.8rem;color:var(--green);margin-top:2px">الصحيحة: <strong>${e(correctLabel)}</strong></div>`:''}
    </div>`;
  }).join('');
  UI.showModal(`<div class="modal" style="max-width:540px">
    <div class="modal-header"><h3>📋 تفاصيل — ${e(user?.name||'')} · ${e(hw.title)}</h3><button class="modal-close">✖</button></div>
    <div class="modal-body" style="max-height:68vh;overflow-y:auto">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div style="flex:1;min-width:80px;background:#f8fafc;border-radius:10px;padding:12px;text-align:center;border:1px solid var(--gray-mid)">
          <div style="font-size:1.4rem;font-weight:900;color:var(--gold)">${sub.score||0}/${maxPts}</div>
          <div style="font-size:0.72rem;color:var(--gray)">الدرجة الكلية</div>
        </div>
        <div style="flex:1;min-width:80px;background:#f8fafc;border-radius:10px;padding:12px;text-align:center;border:1px solid var(--gray-mid)">
          <div style="font-size:1.2rem;font-weight:900;color:var(--navy)">⏱ ${e(durationStr)}</div>
          <div style="font-size:0.72rem;color:var(--gray)">الوقت المنقضي</div>
        </div>
        <div style="flex:1;min-width:80px;background:#f8fafc;border-radius:10px;padding:12px;text-align:center;border:1px solid var(--gray-mid)">
          <div style="font-size:1.4rem;font-weight:900;color:${sub.warnings>0?'var(--red)':'var(--green)'}">${sub.warnings||0}</div>
          <div style="font-size:0.72rem;color:var(--gray)">مخالفات</div>
        </div>
      </div>
      ${questionsHtml}
    </div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>عودة</button></div>
  </div>`);
}

async function showCheatDetails(studentId,hwId) {
  const key='cheat_'+hwId+'_'+studentId;
  let cheatData=await GharsDB.get('cheating/'+key);
  if(!cheatData){
    const all=await GharsDB.getAll('cheating');
    cheatData=Object.values(all).find(ch=>ch.homeworkId===hwId&&ch.studentId===studentId);
  }
  if(!cheatData){UI.toast('لا توجد بيانات غش','info');return;}
  const user=await GharsDB.get('users/'+studentId);
  const log=cheatData.log||[];
  // Map detected cheat types to Arabic method labels
  // أيقونات الأنواع الموحدة
  const methodIcons={
    'نسخ السؤال':              '📋',
    'تصوير الشاشة':           '📸',
    'محاولة الطباعة':         '🖨️',
    'مغادرة صفحة الواجب':    '🚪',
    'التنقل بين التطبيقات':  '🔀',
    'فتح أدوات المطور':       '🛠️',
    'محاولة الإغلاق':         '❌',
    // دعم الأنواع القديمة
    'محاولة نسخ السؤال':'📋','محاولة نسخ السؤال (Ctrl+C)':'📋',
    'مغادرة صفحة الواجب':'🚪','تبديل التبويب':'🔀',
    'التنقل بين الصفحات أو التطبيقات':'🔀',
    'محاولة تصوير الشاشة':'📸','تصوير الشاشة ممنوع':'📸',
    'محاولة طباعة أو تصوير':'🖨️','محاولة فتح أدوات المطور':'🛠️',
    'محاولة إغلاق أو تحديث الصفحة':'❌'
  };
  const methodNames={
    'نسخ السؤال':'نسخ السؤال',
    'تصوير الشاشة':'تصوير الشاشة',
    'محاولة الطباعة':'الطباعة أو التصوير',
    'مغادرة صفحة الواجب':'مغادرة الواجب',
    'التنقل بين التطبيقات':'التنقل بين التطبيقات',
    'فتح أدوات المطور':'أدوات المطور',
    'محاولة الإغلاق':'محاولة الإغلاق',
    // دعم القديم
    'محاولة نسخ السؤال':'نسخ السؤال','محاولة نسخ السؤال (Ctrl+C)':'نسخ السؤال',
    'التنقل بين الصفحات أو التطبيقات':'التنقل بين التطبيقات',
    'محاولة تصوير الشاشة':'تصوير الشاشة','تصوير الشاشة ممنوع':'تصوير الشاشة',
    'محاولة طباعة أو تصوير':'الطباعة','محاولة فتح أدوات المطور':'أدوات المطور',
    'محاولة إغلاق أو تحديث الصفحة':'محاولة الإغلاق'
  };
  const usedMethods=[...new Set(log.map(l=>l.type))];
  const warns=cheatData.warnings||0;
  const severity=warns>=3
    ?{color:'#c53030',bg:'linear-gradient(135deg,#742a2a,#c53030)',label:'غشاش 🚫'}
    :warns>=1
    ?{color:'#c05621',bg:'linear-gradient(135deg,#7b2d00,#c05621)',label:'غاش ⚠️'}
    :{color:'var(--green)',bg:'linear-gradient(135deg,var(--green),#276749)',label:'نظيف ✅'};
  const methodsHtml=usedMethods.length
    ?usedMethods.map(m=>`<div style="font-size:0.84rem;color:${severity.color};font-weight:700;padding:4px 0">${methodIcons[m]||'⚠️'} ${methodNames[m]||e(m)}</div>`).join('')
    :'<div style="font-size:0.8rem;color:var(--gray)">لا توجد</div>';
  const logHtml=log.map((entry,i)=>{
    const icon=methodIcons[entry.type]||'⚠️';
    return `<div style="padding:10px;background:#fff5f5;border-radius:8px;margin-bottom:6px;border-right:3px solid ${severity.color};display:flex;align-items:flex-start;gap:8px">
      <span style="font-size:1.1rem;flex-shrink:0">${icon}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:0.82rem;color:${severity.color}">المخالفة ${i+1}: ${e(entry.type)}</div>
        <div style="font-size:0.74rem;color:var(--gray);margin-top:2px">${GharsUtils.toHijriShort(new Date(entry.time))} · ${GharsUtils.formatTime(new Date(entry.time))}</div>
      </div>
    </div>`;
  }).join('')||'<p class="text-gray text-center">لا توجد سجلات</p>';
  UI.showModal(`<div class="modal" style="max-width:460px">
    <div class="modal-header" style="background:${severity.bg}">
      <h3>${severity.label} — ${e(user?.name||studentId)}</h3><button class="modal-close">✖</button>
    </div>
    <div class="modal-body" style="max-height:65vh;overflow-y:auto">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div style="flex:1;background:#f8fafc;border-radius:10px;padding:12px;text-align:center;border:1px solid var(--gray-mid)">
          <div style="font-size:1.6rem;font-weight:900;color:${severity.color}">${warns}</div>
          <div style="font-size:0.72rem;color:var(--gray)">إجمالي المخالفات</div>
        </div>
        <div style="flex:2;background:#f8fafc;border-radius:10px;padding:12px;border:1px solid var(--gray-mid)">
          <div style="font-size:0.78rem;font-weight:700;color:var(--navy);margin-bottom:6px">🔍 طرق الغش المستخدمة:</div>
          ${methodsHtml}
        </div>
      </div>
      <div style="font-weight:700;font-size:0.85rem;color:var(--navy);margin-bottom:8px">📋 سجل المخالفات التفصيلي:</div>
      ${logHtml}
    </div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>إغلاق</button></div>
  </div>`);
}

// ============================================================
// MEMORIZATION STATS
// ============================================================
async function loadMemoStats() {
  const [users,memoData,settings]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('memorization'),GharsDB.get('system/settings')]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  const target=settings?.targetMemorization||30;
  const ranked=students.map(s=>({id:s.id,name:s.name,score:memoData[s.id]?.score||0})).sort((a,b)=>b.score-a.score);
  const tbody=document.getElementById('memoTbody'); if(!tbody) return;
  let rank=1;
  tbody.innerHTML=ranked.map((s,i)=>{
    if(i>0&&s.score<ranked[i-1].score) rank=i+1;
    const rc=rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'';
    return `<tr><td><span class="${rc}">${rank}</span></td><td>${e(s.name)}</td><td><strong>${s.score}</strong>/${target}</td></tr>`;
  }).join('');
  const shareBtn=document.getElementById('memoShareBtn');
  if(shareBtn) {
    shareBtn.onclick=async()=>{
      const [u3,m3,s3]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('memorization'),GharsDB.get('system/settings')]);
      const tgt=s3?.targetMemorization||30;
      const studs3=Object.values(u3).filter(u=>u.role==='student'&&!u.deleted).sort((a,b)=>(m3[b.id]?.score||0)-(m3[a.id]?.score||0));
      const doneCount=studs3.filter(s=>(m3[s.id]?.score||0)>=tgt).length;
      let lines='📖 *إحصائية التسميع*\n━━━━━━━━━━━━━';
      studs3.forEach(s=>{
        lines+='\n👤*'+s.name+' : '+(m3[s.id]?.score||0)+'/'+tgt+'*\n________________';
      });
      lines+='\n━━━━━━━━━━━━━\n*عدد منجزي المقرر : '+doneCount+'*\n*عدد غير منجزي المقرر : '+(studs3.length-doneCount)+'*';
      showSharePreview(lines);
    };
  }
}

// ============================================================
// POINTS STATS
// ============================================================
async function loadPointsStats() {
  const [users,ptsData]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('points_summary')]);
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  const ranked=students.map(s=>({name:s.name,pts:ptsData[s.id]?.total||0})).sort((a,b)=>b.pts-a.pts);
  const tbody=document.getElementById('pointsTbody'); if(!tbody) return;
  let rank=1;
  tbody.innerHTML=ranked.map((s,i)=>{
    if(i>0&&s.pts<ranked[i-1].pts) rank=i+1;
    const rc=rank===1?'rank-1':rank===2?'rank-2':rank===3?'rank-3':'';
    return `<tr><td><span class="${rc}">${rank}</span></td><td>${e(s.name)}</td><td><span class="badge badge-gold">⭐ ${s.pts}</span></td></tr>`;
  }).join('');
  const shareBtn=document.getElementById('ptsShareBtn');
  if(shareBtn) {
    shareBtn.onclick=async()=>{
      const [u4,p4]=await Promise.all([GharsDB.getAll('users'),GharsDB.getAll('points_summary')]);
      const studs4=Object.values(u4).filter(u=>u.role==='student'&&!u.deleted).sort((a,b)=>(p4[b.id]?.total||0)-(p4[a.id]?.total||0));
      let lines='🌟 *إحصائية النقاط*\n━━━━━━━━━━━━━';
      studs4.forEach(s=>{
        lines+='\n*'+s.name+' : '+(p4[s.id]?.total||0)+'*\n_____________';
      });
      showSharePreview(lines);
    };
  }
}

// ============================================================
// GROUPS STATS
// ============================================================
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
  const shareBtn=document.getElementById('grpShareBtn');
  if(shareBtn) {
    shareBtn.onclick=async()=>{
      const g4=await GharsDB.getAll('groups');
      const grps4=Object.values(g4).sort((a,b)=>(b.points||0)-(a.points||0));
      let lines='🏆 *إحصائية المجموعات*\n━━━━━━━━━━━━━';
      grps4.forEach(g=>{
        lines+='\n*'+g.name+' : '+(g.points||0)+'*\n_______________';
      });
      showSharePreview(lines);
    };
  }
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
// ============================================================
// عرض أسئلة الواجب المنتهي
// ============================================================
async function viewExpiredHomeworkQuestions(hwId) {
  const hw = await GharsDB.get('homework/' + hwId);
  if (!hw) { UI.toast('الواجب غير موجود', 'error'); return; }
  const questions = hw.questions || [];
  const maxPts = questions.reduce((a,q) => a + (q.points||1), 0);

  const questionsHtml = questions.length
    ? questions.map((q, i) => {
        const letters = 'أبجدهوزح';
        const isMulti = q.multiCorrect || q.multipleCorrect;
        const optionsHtml = (q.options||[]).map((opt, j) => {
          const isCorrect = isMulti
            ? (q.correctAnswers||[]).includes(opt)
            : opt === q.correctAnswer;
          return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;
            background:${isCorrect?'rgba(56,161,105,0.1)':'#f8fafc'};
            border:1.5px solid ${isCorrect?'var(--green)':'var(--gray-mid)'};
            margin-bottom:5px">
            <div style="width:26px;height:26px;border-radius:7px;
              background:${isCorrect?'var(--green)':'var(--gray-mid)'};
              color:#fff;display:flex;align-items:center;justify-content:center;
              font-weight:700;font-size:0.8rem;flex-shrink:0">${letters[j]||j+1}</div>
            <span style="font-size:0.84rem;color:var(--navy);flex:1">${e(opt)}</span>
            ${isCorrect ? '<span style="color:var(--green);font-size:1rem">✅</span>' : ''}
          </div>`;
        }).join('');
        return `<div style="background:#fff;border-radius:14px;padding:14px;margin-bottom:12px;
          border:2px solid ${isMulti?'rgba(201,162,39,0.4)':'var(--gray-mid)'};
          box-shadow:0 2px 8px rgba(0,0,0,0.06)">
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px">
            <div style="background:var(--navy);color:var(--gold);min-width:28px;height:28px;
              border-radius:50%;display:flex;align-items:center;justify-content:center;
              font-size:0.78rem;font-weight:800;flex-shrink:0">${i+1}</div>
            <div style="flex:1">
              <div style="font-weight:700;font-size:0.88rem;color:var(--navy);line-height:1.5">${e(q.question)}</div>
              <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
                <span style="background:rgba(201,162,39,0.12);color:var(--gold-dark);
                  border-radius:20px;padding:2px 9px;font-size:0.7rem;font-weight:700">
                  ${q.points||1} درجة
                </span>
                ${isMulti ? `<span style="background:rgba(102,126,234,0.1);color:#5a67d8;
                  border-radius:20px;padding:2px 9px;font-size:0.7rem;font-weight:700">⚡ متعدد</span>` : ''}
              </div>
            </div>
          </div>
          ${optionsHtml}
        </div>`;
      }).join('')
    : `<div class="no-data"><div class="no-data-icon">❓</div><p>لا توجد أسئلة</p></div>`;

  UI.showModal(`<div class="modal" style="max-width:560px">
    <div class="modal-header" style="background:linear-gradient(135deg,var(--navy),var(--navy-light))">
      <h3 style="color:var(--gold)">📋 ${e(hw.title)}</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:16px">
      <!-- إحصائية سريعة -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <div style="flex:1;min-width:80px;background:#f8fafc;border-radius:10px;padding:10px;text-align:center;border:1px solid var(--gray-mid)">
          <div style="font-size:1.4rem;font-weight:900;color:var(--navy)">${questions.length}</div>
          <div style="font-size:0.7rem;color:var(--gray)">عدد الأسئلة</div>
        </div>
        <div style="flex:1;min-width:80px;background:rgba(201,162,39,0.08);border-radius:10px;padding:10px;text-align:center;border:1px solid rgba(201,162,39,0.25)">
          <div style="font-size:1.4rem;font-weight:900;color:var(--gold)">${maxPts}</div>
          <div style="font-size:0.7rem;color:var(--gray)">مجموع الدرجات</div>
        </div>
        ${hw.timeLimit ? `<div style="flex:1;min-width:80px;background:#f8fafc;border-radius:10px;padding:10px;text-align:center;border:1px solid var(--gray-mid)">
          <div style="font-size:1.4rem;font-weight:900;color:var(--navy)">${hw.timeLimit}</div>
          <div style="font-size:0.7rem;color:var(--gray)">دقيقة للحل</div>
        </div>` : ''}
      </div>
      ${questionsHtml}
    </div>
    <div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
      <button class="btn btn-sm btn-primary" onclick="navigate('stats');setTimeout(()=>{toggleStats('homework',null);},200);this.closest('.modal-overlay').remove()">📊 إحصائية الطلاب</button>
      <button class="btn btn-gray" data-close-modal>إغلاق</button>
    </div>
  </div>`);
}


function hwCardV2(hw, expired, idx=0) {
  const gradeBtn = expired
    ? `<button class="hw-reveal-btn ${hw.hideGrade?'hidden-grade':''}" onclick="toggleRevealGrades('${hw.id}')">
        ${hw.hideGrade?'🔒 إظهار الدرجات':'🔓 إخفاء الدرجات'}
       </button>`
    : '';
  return `<div class="hw-card-v2 ${expired?'expired':''}" style="animation-delay:${idx*0.06}s">
    <div class="hw-card-v2-header">
      <div class="hw-card-v2-title"
        ${expired ? `onclick="viewExpiredHomeworkQuestions('${hw.id}')" style="cursor:pointer;text-decoration:underline dotted rgba(255,255,255,0.5)" title="اضغط لعرض أسئلة الواجب"` : ''}
      >📚 ${e(hw.title)}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0">
        ${!expired && hw.deadline ? `<span class="timer-pill" id="hwTimer-${hw.id}">⏳</span>` : ''}
        ${expired ? `<span class="badge badge-gray" style="font-size:0.68rem">منتهي</span>` : ''}
        ${expired ? gradeBtn : ''}
        ${!expired
          ? `<button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;padding:4px 8px" onclick="editHomework('${hw.id}')">✏️</button>
             <button class="btn btn-sm" style="background:rgba(229,62,62,0.3);color:#fff;padding:4px 8px" onclick="deleteHomework('${hw.id}')">🗑</button>`
          : `<button class="btn btn-sm" style="background:rgba(229,62,62,0.3);color:#fff;padding:4px 8px" onclick="deleteHomework('${hw.id}')">🗑</button>`}
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
  const sent = document.getElementById('sentHwList');
  const done = document.getElementById('doneHwList');
  if(sent) sent.style.display = tab==='sent' ? 'block' : 'none';
  if(done) done.style.display = tab==='done' ? 'block' : 'none';
  document.querySelectorAll('#section-homework .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('hwTabBtn-'+tab)?.classList.add('active');
}
function switchHwTabSwipe(tab,idx){ switchHwTab(tab); }

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
  // احسب رقم العرض من العناصر الفعلية الموجودة في DOM
  const displayNum = c ? c.querySelectorAll('.question-block').length + 1 : qNum;
  const div = document.createElement('div');
  div.className='question-block'; div.id='qBlock-'+qNum;
  div.dataset.qnum = qNum;
  div.style.animation='fadeInUp 0.3s both ease';
  const isMulti=prefill?.multipleCorrect||false;
  div.innerHTML=`<div class="flex-between mb-2">
    <div class="flex gap-2" style="align-items:center">
      <div class="question-num" data-qlabel>${displayNum}</div>
      <span style="font-weight:700;font-size:0.88rem" data-qlabeltext>السؤال ${displayNum}</span>
    </div>
    <div class="flex gap-1">
      <button type="button" class="btn btn-sm ${isMulti?'btn-primary':'btn-outline'}" id="multiBtn-${qNum}" onclick="toggleMulti(${qNum})" title="تبديل بين خيار واحد / متعدد الخيارات">${isMulti?'✅ متعدد':'☑ متعدد'}</button>
      <button type="button" class="btn btn-sm" style="background:var(--red-light);color:var(--red);padding:4px 8px" onclick="removeQuestion(${qNum})">✖ حذف</button>
    </div>
  </div>
  <div class="form-group"><textarea class="form-input" id="qText-${qNum}" placeholder="اكتب نص السؤال..." rows="2" style="resize:vertical">${e(prefill?.question||'')}</textarea></div>
  <input type="hidden" id="qMulti-${qNum}" value="${isMulti?'1':'0'}">
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
  if(choices.length) choices.forEach(ch=>{
    const isCorrect=Array.isArray(prefill?.correctAnswer)?prefill.correctAnswer.includes(ch):prefill?.correctAnswer===ch;
    addChoice(qNum,ch,isCorrect);
  });
  else { addChoice(qNum); addChoice(qNum); }
}

function _renumberQuestions() {
  const blocks = document.querySelectorAll('#questionsContainer .question-block');
  blocks.forEach(function(block, idx) {
    const n = idx + 1;
    const numEl = block.querySelector('[data-qlabel]');
    const lblEl = block.querySelector('[data-qlabeltext]');
    if (numEl) numEl.textContent = n;
    if (lblEl) lblEl.textContent = 'السؤال ' + n;
  });
}
function addChoice(qNum,val='',isCorrect=false) {
  if(!choiceCounts[qNum]) choiceCounts[qNum]=0;
  choiceCounts[qNum]++;
  const cNum=choiceCounts[qNum];
  const letters='أبجدهوزح';
  const c=document.getElementById('choicesContainer-'+qNum); if(!c) return;
  const isMultiQ=(document.getElementById('qMulti-'+qNum)?.value==='1');
  const inputType=isMultiQ?'checkbox':'radio';
  const inputName=isMultiQ?`multi-${qNum}`:`correct-${qNum}`;
  const div=document.createElement('div');
  div.className='choice-item'; div.id=`choice-${qNum}-${cNum}`;
  div.dataset.choicerow = '1';
  div.style.animation='fadeInUp 0.25s both ease';
  div.innerHTML=`<input type="${inputType}" class="choice-radio" id="radio-${qNum}-${cNum}" name="${inputName}" ${isCorrect?'checked':''}>
    <span class="choice-letter" style="font-size:0.82rem;font-weight:700;color:var(--navy);min-width:20px">${letters[cNum-1]||cNum}.</span>
    <input type="text" class="choice-input" id="choiceText-${qNum}-${cNum}" placeholder="الخيار ${cNum}..." value="${e(val)}">
    <button type="button" class="choice-del" onclick="removeChoice(${qNum},${cNum})">✖</button>`;
  c.appendChild(div);
  _renumberChoices(qNum);
}
function removeChoice(qNum,cNum){
  document.getElementById(`choice-${qNum}-${cNum}`)?.remove();
  _renumberChoices(qNum);
}
function removeQuestion(qNum){
  document.getElementById('qBlock-'+qNum)?.remove();
  _renumberQuestions();
}
function _renumberChoices(qNum) {
  const letters='أبجدهوزح';
  const cont = document.getElementById('choicesContainer-'+qNum); if(!cont) return;
  const rows = cont.querySelectorAll('[data-choicerow]');
  rows.forEach(function(row, idx) {
    const n = idx + 1;
    const lblEl = row.querySelector('.choice-letter');
    if (lblEl) lblEl.textContent = (letters[idx] || n) + '.';
    const inp = row.querySelector('.choice-input');
    if (inp) inp.placeholder = 'الخيار ' + n + '...';
  });
}
function toggleMulti(qNum) {
  const hidden=document.getElementById('qMulti-'+qNum);
  if(!hidden) return;
  const nowOn=hidden.value!=='1';
  hidden.value=nowOn?'1':'0';
  const btn=document.getElementById('multiBtn-'+qNum);
  if(btn){
    btn.textContent=nowOn?'✅ متعدد الإجابات':'☐ متعدد الإجابات';
    btn.className=nowOn?'btn btn-sm btn-primary':'btn btn-sm btn-outline';
    btn.style.background=nowOn?'linear-gradient(135deg,var(--navy),var(--navy-light))':'';
    btn.style.color=nowOn?'var(--gold)':'';
  }
  // إعادة رسم الـ choices
  const container=document.getElementById('choicesContainer-'+qNum);
  container?.querySelectorAll('.choice-radio').forEach(inp=>{
    inp.type=nowOn?'checkbox':'radio';
    inp.name=nowOn?`multi-${qNum}`:`correct-${qNum}`;
    inp.checked=false;
  });
  // Show/hide multi hint
  let hint=document.getElementById('multiHint-'+qNum);
  if(nowOn&&!hint){
    hint=document.createElement('div');
    hint.id='multiHint-'+qNum;
    hint.style.cssText='font-size:0.75rem;color:var(--gold-dark);margin-bottom:6px;padding:4px 8px;background:rgba(201,162,39,0.08);border-radius:6px;border-right:2px solid var(--gold)';
    hint.textContent='✦ ضع علامة ✓ على جميع الإجابات الصحيحة';
    container?.parentNode?.insertBefore(hint,container);
  } else if(!nowOn&&hint){
    hint.remove();
  }
}
function buildQuestionsData() {
  const questions=[];
  document.querySelectorAll('.question-block').forEach(block=>{
    const id=block.id.replace('qBlock-','');
    const qt=document.getElementById('qText-'+id)?.value?.trim();
    if(!qt) return;
    const isMulti=(document.getElementById('qMulti-'+id)?.value==='1')||false;
    const options=[];let correctAnswer='';const correctAnswers=[];
    block.querySelectorAll('.choice-item').forEach(ch=>{
      const parts=ch.id.split('-'), cN=parts[parts.length-1], qN=parts[parts.length-2];
      const txt=document.getElementById(`choiceText-${qN}-${cN}`)?.value?.trim();
      if(!txt) return;
      options.push(txt);
      if(isMulti){
        if(document.getElementById(`radio-${qN}-${cN}`)?.checked) correctAnswers.push(txt);
      } else {
        if(document.getElementById(`radio-${qN}-${cN}`)?.checked) correctAnswer=txt;
      }
    });
    const pts=parseInt(document.getElementById('qPoints-'+id)?.value||'1')||1;
    if(isMulti){
      questions.push({question:qt,options,multiCorrect:true,correctAnswers,correctAnswer:correctAnswers.join('،'),points:pts});
    } else {
      questions.push({question:qt,options,multiCorrect:false,correctAnswers:[],correctAnswer,points:pts});
    }
  });
  return questions;
}
async function submitHomework() {
  const title=document.getElementById('hwTitle')?.value?.trim();
  const deadline=document.getElementById('hwDeadline')?.value;
  const timeLimit=parseInt(document.getElementById('hwTimeLimit')?.value||'0')||0;
  const linkedMeeting=document.getElementById('hwLinkMeeting')?.value||'';
  if(!title){UI.toast('يرجى إدخال عنوان الواجب','error');return;}
  if(title.length>200){UI.toast('العنوان طويل جداً','error');return;}
  const questions=buildQuestionsData();
  if(!questions.length){UI.toast('يرجى إضافة سؤال واحد على الأقل','error');return;}
  if(questions.find(q=>!q.correctAnswer||(Array.isArray(q.correctAnswer)&&q.correctAnswer.length===0))){UI.toast('حدد الإجابة الصحيحة لكل سؤال','error');return;}
  const id=editingHwId||GharsUtils.uid();
  const hw={id,title,questions,deadline:deadline||null,timeLimit:timeLimit||null,
    linkedMeeting:linkedMeeting||null,hideGrade:hwHideGradeEnabled,
    createdBy:Auth.currentUser.id,createdAt:new Date().toISOString(),expired:false,deleted:false};
  await GharsDB.set('homework/'+id,hw);
  GharsDB._invalidate('homework');
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
  if(!await UI.confirm('هل تريد حذف هذا الواجب؟ سيتم حذف درجات الواجب من نقاط الطلاب.','حذف الواجب')) return;
  UI.toast('⏳ جاري الحذف...','info',2000);
  try {
    // ── 1. حذف الواجب من Supabase (النقاط تبقى للطالب) ──
    // ملاحظة: عند حذف الواجب تُحتفظ بنقاط الطلاب — النقاط تُحذف فقط عند حذف اللقاء
    // ── 2. حذف فعلي من Supabase ──
    if(_sbOK && _sb) {
      await _sb.from('ghars_data').delete().eq('collection','homework').eq('doc_id',hwId);
      // حذف التسليمات
      try {
        const subsR = await _sb.from('ghars_data').select('doc_id,data').eq('collection','submissions').filter('data->>homeworkId','eq',hwId);
        if(!subsR.error && subsR.data) {
          for(const r of subsR.data) { await _sb.from('ghars_data').delete().eq('collection','submissions').eq('doc_id',r.doc_id); }
        }
      } catch(_){}
      // حذف سجلات الغش
      try {
        const cheatR = await _sb.from('ghars_data').select('doc_id').eq('collection','cheating').filter('data->>homeworkId','eq',hwId);
        if(!cheatR.error && cheatR.data) {
          for(const r of cheatR.data) { await _sb.from('ghars_data').delete().eq('collection','cheating').eq('doc_id',r.doc_id); }
        }
      } catch(_){}
    }
    // ── 3. حذف من localStorage و IndexedDB ──
    const hwKeys = [];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(!k) continue;
      if(k.includes('__homework__'+hwId)) hwKeys.push(k);
      if(k.includes('__cheating__')) hwKeys.push(k);
      if(k.includes('__submissions__')){
        try{const v=localStorage.getItem(k);if(v&&v.includes(hwId))hwKeys.push(k);}catch(_){}
      }
    }
    _purgeLocal(hwKeys);
    GharsDB._invalidate('homework');
    GharsDB._invalidate('submissions');
    GharsDB._invalidate('cheating');
    UI.toast('✅ تم حذف الواجب — نقاط الطلاب محفوظة','success');
    loadHomework();
  } catch(e) {
    console.error('deleteHomework error:', e);
    UI.toast('حدث خطأ أثناء الحذف','error');
  }
}
async function toggleRevealGrades(hwId) {
  const hw = await GharsDB.get('homework/'+hwId); if(!hw) return;
  const newVal = !hw.hideGrade;
  await GharsDB.set('homework/'+hwId, {...hw, hideGrade: newVal});
  UI.toast(newVal?'تم إخفاء الدرجات':'✅ تم السماح للطلاب بمشاهدة درجاتهم','success');
  loadHomework();
}
async function confirmClearHomework() {
  if(!await UI.confirm('🗑 سيتم حذف جميع الواجبات نهائياً. هل أنت متأكد؟','حذف الكل')) return;
  UI.toast('⏳ جاري الحذف...','info',3000);
  try {
    if(_sbOK && _sb) {
      // جلب جميع الواجبات ثم حذفها مع التسليمات والغش والنقاط
      const hwAll = await _sb.from('ghars_data').select('doc_id').eq('collection','homework');
      if(!hwAll.error && hwAll.data) {
        for(const r of hwAll.data) {
          await _sb.from('ghars_data').delete().eq('collection','homework').eq('doc_id',r.doc_id);
        }
      }
      // حذف جميع التسليمات
      try { await _sb.from('ghars_data').delete().eq('collection','submissions').neq('doc_id','__placeholder__'); } catch(_){}
      // حذف جميع سجلات الغش
      try { await _sb.from('ghars_data').delete().eq('collection','cheating').neq('doc_id','__placeholder__'); } catch(_){}
      // ملاحظة: نقاط الطلاب تُحتفظ بها عند حذف الواجبات
      // النقاط تُحذف فقط عند حذف اللقاء المرتبط
    }
    _purgeByPrefix('__homework__');
    _purgeByPrefix('__submissions__');
    _purgeByPrefix('__cheating__');
    GharsDB._invalidate('homework');
    GharsDB._invalidate('submissions');
    GharsDB._invalidate('cheating');
    GharsDB._invalidate('points_summary');
    UI.toast('✅ تم حذف جميع الواجبات','success'); loadHomework();
  } catch(e) { console.error('confirmClearHomework:', e); UI.toast('حدث خطأ','error'); }
}

// ── مساعد عرض الصورة الشخصية ──────────────────────────────
function _avHtml(user, cls='seen-avatar') {
  if (user && user.avatarUrl) {
    return `<div class="${cls}" style="background-image:url(${user.avatarUrl});background-size:cover;background-position:center;color:transparent;overflow:hidden"></div>`;
  }
  return `<div class="${cls}">${(user?.name||'?').charAt(0)}</div>`;
}

// ============================================================
// STUDENTS
// ============================================================
async function loadStudents() {
  const c=document.getElementById('studentsList');
  if(!c) return;
  // ── جلب البيانات مباشرة (بدون عرض من كاش قد يحتوي محذوفين) ──
  const users=await GharsDB.getAll('users');
  // فلترة صارمة: لا تعرض محذوف أو محظور أو __REVOKED__
  const students=Object.values(users).filter(u=>
    u.role==='student' &&
    !u.deleted && !u.purged &&
    u.password !== '__REVOKED__' &&
    (typeof _isDeleted !== 'function' || !_isDeleted(u.id))
  );
  if(!students.length){c.innerHTML=noData('👥','لا يوجد طلاب');return;}
  _renderStudentsList(students, c);
}

function _renderStudentsList(students, c) {
  c.innerHTML=students.map((s,i)=>{
    const avClick = s.avatarUrl ? `onclick="showUserAvatar('${e(s.avatarUrl).replace(/'/g,'&#39;')}',false)" style="cursor:pointer"` : '';
    return `
    <div class="student-row" style="animation:fadeInUp 0.3s ${i*0.04}s both ease">
      <div class="flex gap-2" style="align-items:center;flex:1;min-width:0">
        ${s.avatarUrl
          ? `<div class="seen-avatar" ${avClick} style="background-image:url(${s.avatarUrl});background-size:cover;background-position:center;color:transparent;overflow:hidden;cursor:pointer"></div>`
          : `<div class="seen-avatar">${s.name.charAt(0)}</div>`}
        <div style="min-width:0;flex:1">
          <div style="font-weight:700;font-size:0.9rem;color:var(--navy);word-break:break-word;white-space:normal">${e(s.name)}</div>
          <div style="font-size:0.75rem;color:var(--gray)">${e(s.group||'بدون مجموعة')}</div>
        </div>
      </div>
      <div class="student-actions">
        <button class="btn btn-sm btn-primary" onclick="showStudentInfo('${s.id}')">👁</button>
        <button class="btn btn-sm" style="background:rgba(201,162,39,0.15);color:var(--gold-dark);border:1px solid rgba(201,162,39,0.3)" onclick="editStudentData('${s.id}')">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deleteStudent('${s.id}')">🗑</button>
      </div>
    </div>`}).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
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
    <div class="modal-footer" style="flex-wrap:wrap;gap:8px">
      <button class="btn btn-primary" onclick="showQRPreview('${id}');this.closest('.modal-overlay').remove()">📱 عرض QR</button>
      <button class="btn btn-outline" onclick="copyStudentInfo('${id}')">📋 نسخ</button>
      <button class="btn btn-gray" data-close-modal>إغلاق</button>
    </div>
  </div>`);
}
async function copyStudentInfo(id) {
  const u=await GharsDB.get('users/'+id); if(!u) return;
  await UI.copyText(`اسم الطالب: ${u.name}\nاسم المستخدم: ${u.username}\nكلمة المرور: ${u.password}\nالمجموعة: ${u.group||'—'}`);
}
async function deleteStudent(id) {
  if(!await UI.confirm('⚠️ سيتم حذف الطالب نهائياً ولن يتمكن من الدخول مجدداً. هل تريد المتابعة؟','حذف الطالب نهائياً')) return;

  // 1: إزالة من الواجهة فوراً
  const c=document.getElementById('studentsList');
  if(c) {
    c.querySelectorAll('.student-row').forEach(row => {
      if(row.innerHTML.indexOf(id)!==-1){
        row.style.transition='opacity 0.2s'; row.style.opacity='0';
        setTimeout(()=>{row.remove();},200);
      }
    });
  }

  UI.toast('⏳ جاري الحذف النهائي...', 'info', 2000);

  // 2: الحذف القاطع من قاعدة البيانات Supabase وإرسال أمر الطرد اللحظي
  if(_sbOK && _sb) {
    try {
      await Promise.all([
        // أ) تسجيله في القائمة السوداء لضمان عدم عودته
        _sb.from('ghars_data').upsert({
          collection:'deleted_accounts', doc_id:id,
          data:{id, deletedAt:new Date().toISOString(), role:'student'},
          updated_at:new Date().toISOString()
        },{ onConflict:'collection,doc_id' }),
        
        // ب) الحذف الفعلي والنهائي من جدول المستخدمين (Hard Delete)
        _sb.from('ghars_data').delete().eq('collection','users').eq('doc_id',id),
        
        // ج) إرسال أمر طرد لحظي ليخرجه من الموقع فوراً إذا كان متصلاً
        _sb.from('ghars_data').upsert({
          collection:'force_logout', doc_id:id,
          data:{id, kickedAt:new Date().toISOString(), reason:'deleted'},
          updated_at:new Date().toISOString()
        },{onConflict:'collection,doc_id'})
      ]);

      // حذف باقي بيانات الطالب من قاعدة البيانات في الخلفية
      _sb.from('ghars_data').delete().eq('collection','points_summary').eq('doc_id',id).catch(()=>{});
      _sb.from('ghars_data').delete().eq('collection','memorization').eq('doc_id',id).catch(()=>{});
      _sb.from('ghars_data').delete().eq('collection','notifications').eq('doc_id',id).catch(()=>{});
    } catch(e) { console.warn('deleteStudent block write:', e); }
  }

  // 3: مسح بياناته من التخزين المحلي للمتصفح الحالي
  if(typeof _addToDeletedList === 'function') _addToDeletedList(id);
  const keysToRemove=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k && k.includes(id)) keysToRemove.push(k);
  }
  keysToRemove.forEach(k=>{ try{localStorage.removeItem(k);}catch(_){} });
  if(typeof GharsDataDB!=='undefined') keysToRemove.forEach(k=>GharsDataDB.del(k).catch(()=>{}));

  GharsDB._invalidate('users');
  GharsDB._invalidate('points_summary');
  loadStudents(); 
  loadHomeStats();
  UI.toast('✅ تم حذف بيانات الطالب نهائياً من قاعدة البيانات', 'success', 3000);
}

  // ══ الخطوة 3: حذف باقي البيانات في الخلفية ══
  if(_sbOK && _sb) {
    (async () => {
      try {
        await Promise.allSettled([
          _sb.from('ghars_data').delete().eq('collection','users').eq('doc_id',id),
          _sb.from('ghars_data').delete().eq('collection','points_summary').eq('doc_id',id),
          _sb.from('ghars_data').delete().eq('collection','memorization').eq('doc_id',id),
          _sb.from('ghars_data').delete().eq('collection','notifications').eq('doc_id',id),
          _sb.from('ghars_data').select('doc_id').eq('collection','submissions').filter('data->>studentId','eq',id)
            .then(r=>{ if(!r.error&&r.data) return Promise.allSettled(r.data.map(row=>_sb.from('ghars_data').delete().eq('collection','submissions').eq('doc_id',row.doc_id))); }),
          _sb.from('ghars_data').select('doc_id').eq('collection','cheating').filter('data->>studentId','eq',id)
            .then(r=>{ if(!r.error&&r.data) return Promise.allSettled(r.data.map(row=>_sb.from('ghars_data').delete().eq('collection','cheating').eq('doc_id',row.doc_id))); }),
        ]);
        GharsDB._invalidate('users');
      } catch(e) { console.warn('deleteStudent cleanup:', e); }
    })();
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
  const name    = (document.getElementById('newStudentName')?.value||'').trim();
  const group   = (document.getElementById('newStudentGroup')?.value||'').trim();
  if(!name){UI.toast('يرجى إدخال الاسم','error');return;}

  const username  = GharsUtils.generateUsername(name).trim().replace(/[^a-z0-9_]/gi,'');
  const password  = GharsUtils.generatePassword().trim();
  const qrVersion = GharsUtils.uid();
  const student   = {
    id:        'student_'+GharsUtils.uid(),
    name,
    username,
    password,
    group,
    role:      'student',
    qrVersion,
    createdAt: new Date().toISOString(),
    deleted:   false
  };

  // ── 1. حفظ فوري محلياً ──
  try { localStorage.setItem('ghars__users__'+student.id, JSON.stringify(student)); } catch(_){}
  if(typeof GharsDataDB !== 'undefined') GharsDataDB.set('ghars__users__'+student.id, student, 'users').catch(()=>{});
  GharsDB._invalidate('users');

  // ── 2. حفظ في Supabase (ننتظر النتيجة لإظهار حالة الحفظ فقط) ──
  let savedToCloud = false;
  if(_sbOK && _sb) {
    try {
      const { error } = await _sb.from('ghars_data').upsert({
        collection: 'users', doc_id: student.id,
        data: student, updated_at: new Date().toISOString()
      }, { onConflict: 'collection,doc_id' });
      if(!error) { savedToCloud = true; }
      else { _writeQueue.push({ col:'users', doc:student.id, data:student }); }
    } catch(e) { _writeQueue.push({ col:'users', doc:student.id, data:student }); }
  } else {
    _writeQueue.push({ col:'users', doc:student.id, data:student });
  }

  document.querySelector('.modal-overlay')?.remove();
  const cloudMsg = savedToCloud ? '☁️ محفوظ في السحابة' : '⚠️ سيُحفظ لاحقاً';
  // ── عرض بيانات الدخول بوضوح ──
  UI.showModal(`<div class="modal" style="max-width:360px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#0d1f3c)">
      <h3 style="color:#c9a227;font-size:0.92rem">✅ تم إضافة الطالب — ${e(name)}</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:16px">
      <div style="background:#f0fdf4;border-radius:12px;padding:14px;border:1.5px solid #86efac;margin-bottom:12px">
        <div style="font-size:0.72rem;color:#16a34a;font-weight:700;margin-bottom:8px">🔐 بيانات الدخول — احفظها</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <span style="font-size:0.78rem;color:#555">اسم المستخدم:</span>
          <code style="background:#e2e8f0;padding:2px 10px;border-radius:6px;font-family:monospace;font-size:0.85rem;color:#0a1628;font-weight:700">${username}</code>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:0.78rem;color:#555">كلمة المرور:</span>
          <code style="background:#e2e8f0;padding:2px 10px;border-radius:6px;font-family:monospace;font-size:0.85rem;color:#0a1628;font-weight:700">${password}</code>
        </div>
      </div>
      <div style="font-size:0.7rem;color:#888;text-align:center;margin-bottom:12px">${cloudMsg}</div>
      <div style="display:flex;gap:8px">
        <button onclick="UI.copyText('${username}\n${password}').then(()=>{})"
          class="btn btn-outline" style="flex:1;justify-content:center;font-size:0.8rem">📋 نسخ</button>
        <button onclick="this.closest('.modal-overlay').remove();showQRPreview('${student.id}')"
          class="btn btn-primary" style="flex:1;justify-content:center;font-size:0.8rem">📱 QR</button>
      </div>
    </div>
  </div>`);
  loadStudents();
  loadHomeStats();
}
async function confirmClearStudents() {
  if(!await UI.confirm('🗑 سيتم حذف جميع الطلاب وبياناتهم نهائياً. هل أنت متأكد؟','حذف الكل')) return;
  UI.toast('⏳ جاري الحذف...','info',3000);
  // إفراغ القائمة من DOM فوراً
  const cSt = document.getElementById('studentsList');
  if(cSt) cSt.innerHTML = '<div style="text-align:center;padding:32px;opacity:0.5"><div style="font-size:2rem">⏳</div><div style="font-size:0.85rem;margin-top:8px">جاري الحذف...</div></div>';
  const users=await GharsDB.getAll('users');
  const studentIds=Object.values(users).filter(u=>u.role==='student').map(u=>u.id);

  // ── إضافة جميع الطلاب للقائمة السوداء فوراً ──
  studentIds.forEach(id=>{
    if(typeof _addToDeletedList==='function') _addToDeletedList(id);
  });
  // ── نشر القائمة في Supabase (deleted_accounts) ──
  if(_sbOK&&_sb){
    (async()=>{
      try {
        for(const id of studentIds){
          await _sb.from('ghars_data').upsert({
            collection:'deleted_accounts', doc_id:id,
            data:{id, deletedAt:new Date().toISOString(), role:'student'},
            updated_at:new Date().toISOString()
          },{ onConflict:'collection,doc_id' });
        }
      }catch(_){}
    })();
  }

  // ── تعطيل جماعي فوري ثم الحذف من Supabase ──
  if(_sbOK&&_sb){
    for(const id of studentIds){
      // اكتب سجل التعطيل أولاً
      try{
        await _sb.from('ghars_data').upsert({
          collection:'users', doc_id:id,
          data:{id, deleted:true, purged:true, qrInvalidated:true,
                purgedAt:new Date().toISOString(), password:'__REVOKED__', qrVersion:'__REVOKED__'},
          updated_at:new Date().toISOString()
        },{ onConflict:'collection,doc_id' });
      }catch(_){}
    }
    for(const id of studentIds){
      try{ await _sb.from('ghars_data').delete().eq('collection','users').eq('doc_id',id); }catch(_){}
      for(const col of ['points_summary','submissions','memorization','notifications']){
        try{ await _sb.from('ghars_data').delete().eq('collection',col).eq('doc_id',id); }catch(_){}
      }
    }
    // حذف التسليمات والغش المرتبطة
    try{
      const subs=await _sb.from('ghars_data').select('doc_id,data').eq('collection','submissions');
      if(!subs.error&&subs.data){
        for(const row of subs.data){
          if(row.data&&studentIds.includes(row.data.studentId)){
            await _sb.from('ghars_data').delete().eq('collection','submissions').eq('doc_id',row.doc_id);
          }
        }
      }
    }catch(_){}
    try{
      const cheat=await _sb.from('ghars_data').select('doc_id,data').eq('collection','cheating');
      if(!cheat.error&&cheat.data){
        for(const row of cheat.data){
          if(row.data&&studentIds.includes(row.data.studentId)){
            await _sb.from('ghars_data').delete().eq('collection','cheating').eq('doc_id',row.doc_id);
          }
        }
      }
    }catch(_){}
  }

  // ── حذف من localStorage و IDB ──
  const keys=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(!k) continue;
    if(studentIds.some(id=>k.includes(id))||k.includes('__submissions__')||k.includes('__cheating__')) keys.push(k);
  }
  keys.forEach(k=>{ try{localStorage.removeItem(k);}catch(_){} });
  if(typeof GharsDataDB!=='undefined'){
    for(const k of keys){ GharsDataDB.del(k).catch(()=>{}); }
  }

  GharsDB._invalidate('users');
  GharsDB._invalidate('submissions');
  GharsDB._invalidate('points_summary');
  GharsDB._invalidate('memorization');
  UI.toast('✅ تم حذف جميع الطلاب','success'); loadStudents(); loadHomeStats();
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
  const all=[];

  // ── المعلمون الثابتون: تحقق صارم من الحذف قبل إضافتهم ──
  STATIC_TEACHERS.forEach(st=>{
    // إذا كان في القائمة السوداء المحلية → لا تُضفه
    if(typeof _isDeleted==='function' && _isDeleted(st.id)) return;
    const dy=dynamic.find(t=>t.id===st.id);
    // إذا كانت بياناته في Supabase تحتوي deleted/purged/__REVOKED__ → لا تُضفه
    if(dy && (dy.deleted || dy.purged || dy.password==='__REVOKED__' || dy.qrVersion==='__REVOKED__')) return;
    // إذا لم تكن له بيانات في Supabase لكنه في deleted_accounts → لا تُضفه
    all.push(dy || st);
  });

  // ── المعلمون المضافون يدوياً (ليسوا في STATIC_TEACHERS) ──
  dynamic.forEach(dy=>{
    const isStatic=STATIC_TEACHERS.some(s=>s.id===dy.id);
    if(isStatic) return; // معالجة أعلاه
    if(dy.deleted || dy.purged || dy.password==='__REVOKED__') return;
    if(typeof _isDeleted==='function' && _isDeleted(dy.id)) return;
    all.push(dy);
  });

  const c=document.getElementById('teachersList'); if(!c) return;
  if(!all.length){c.innerHTML=noData('👨‍🏫','لا يوجد معلمون');return;}
  const isAdminViewer = Auth.currentUser?.role === 'admin';
  c.innerHTML=all.map((t,i)=>{
    const avUrl = t.avatarUrl || localStorage.getItem('ghars__avatar__'+t.id) || null;
    const avStyle = avUrl ? `background-image:url(${e(avUrl)});background-size:cover;background-position:center;color:transparent;cursor:pointer` : 'background:linear-gradient(135deg,var(--navy),var(--navy-light))';
    const avContent = avUrl ? '' : t.name.charAt(0);
    const avClick = avUrl ? `onclick="showUserAvatar('${e(avUrl)}',false)"` : '';

    // زر البطاقة / التعديل: للمدير يظهر زر تعديل بدلاً من QR
    // المدير نفسه: لا يظهر له زر QR ولا تعديل
    const isSelf   = t.id === Auth.currentUser?.id;
    const isAdmin  = t.role === 'admin';

    let middleBtn = '';
    if (isAdminViewer && !isSelf && !isAdmin) {
      // المدير ينظر لمعلم عادي → زر ✏️ بدون نص
      middleBtn = `<button class="btn btn-sm" style="background:rgba(201,162,39,0.15);color:var(--gold-dark);border:1px solid rgba(201,162,39,0.3)" onclick="showEditTeacherModal('${t.id}')">✏️</button>`;
    } else if (isAdminViewer && isSelf) {
      // المدير ينظر لنفسه → زر QR
      middleBtn = `<button class="btn btn-sm" style="background:rgba(201,162,39,0.15);color:var(--gold-dark);border:1px solid rgba(201,162,39,0.3)" onclick="showQRPreview('${t.id}')">📱</button>`;
    } else if (!isAdminViewer) {
      // معلم عادي → QR لأي أحد
      middleBtn = `<button class="btn btn-sm" style="background:rgba(201,162,39,0.15);color:var(--gold-dark);border:1px solid rgba(201,162,39,0.3)" onclick="showQRPreview('${t.id}')">📱</button>`;
    }

    return `
    <div class="teacher-row" style="animation:fadeInUp 0.3s ${i*0.07}s both ease">
      <div class="seen-avatar" style="${avStyle}" ${avClick}>${avContent}</div>
      <div class="teacher-info">
        <div class="teacher-name">${e(t.name)} ${t.role==='admin'?'<span class="badge badge-gold" style="font-size:0.65rem">مدير</span>':''}</div>
        <div class="teacher-creds">👤 ${e(t.username)} · 🔑 <code style="font-size:0.75rem">${e(t.password)}</code></div>
      </div>
      <div class="flex gap-1">
        <button class="btn btn-sm btn-primary" onclick="showTeacherInfo('${t.id}')">👁</button>
        ${middleBtn}
        ${isSelf ? '' : `<button class="btn btn-sm btn-danger" onclick="deleteTeacher('${t.id}')">🗑</button>`}
      </div>
    </div>`}).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}
async function showTeacherInfo(id) {
  const t=STATIC_TEACHERS.find(s=>s.id===id)||await GharsDB.get('users/'+id); if(!t) return;
  const isAdminViewer  = Auth.currentUser?.role === 'admin';
  const isSelf         = id === Auth.currentUser?.id;
  const isAdminAccount = t.role === 'admin';

  // بناء أزرار footer بحسب الحالة
  let footerBtns = '';

  if (isAdminViewer && isSelf) {
    // المدير يعرض معلومات نفسه → نسخ + QR
    footerBtns = `
      <button class="btn btn-primary" onclick="showQRPreview('${id}');this.closest('.modal-overlay').remove()">📱 عرض QR</button>
      <button class="btn btn-outline" onclick="copyTeacherInfo('${id}')">📋 نسخ</button>
      <button class="btn btn-gray" data-close-modal>إغلاق</button>`;
  } else if (isAdminViewer && !isAdminAccount) {
    // المدير يعرض معلومات معلم عادي → QR بدلاً من تعديل
    footerBtns = `
      <button class="btn btn-primary" onclick="showQRPreview('${id}');this.closest('.modal-overlay').remove()">📱 عرض QR</button>
      <button class="btn btn-outline" onclick="copyTeacherInfo('${id}')">📋 نسخ</button>
      <button class="btn btn-gray" data-close-modal>إغلاق</button>`;
  } else if (!isAdminViewer) {
    // معلم عادي → QR + نسخ
    footerBtns = `
      <button class="btn btn-primary" onclick="showQRPreview('${id}');this.closest('.modal-overlay').remove()">📱 بطاقة الدخول</button>
      <button class="btn btn-outline" onclick="copyTeacherInfo('${id}')">📋 نسخ</button>
      <button class="btn btn-gray" data-close-modal>إغلاق</button>`;
  } else {
    // مدير يعرض مدير آخر → نسخ فقط
    footerBtns = `
      <button class="btn btn-outline" onclick="copyTeacherInfo('${id}')">📋 نسخ</button>
      <button class="btn btn-gray" data-close-modal>إغلاق</button>`;
  }

  UI.showModal(`<div class="modal" style="max-width:380px">
    <div class="modal-header"><h3>👨‍🏫 معلومات</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div style="background:#f8fafc;border-radius:12px;padding:16px">
        <div class="flex-between mb-2"><span class="badge badge-navy">الاسم</span><strong>${e(t.name)}</strong></div>
        <div class="flex-between mb-2"><span class="badge badge-navy">المستخدم</span><code style="background:#e2e8f0;padding:2px 8px;border-radius:6px">${e(t.username)}</code></div>
        <div class="flex-between"><span class="badge badge-navy">كلمة المرور</span><code style="background:#e2e8f0;padding:2px 8px;border-radius:6px">${e(t.password)}</code></div>
      </div>
    </div>
    <div class="modal-footer" style="flex-wrap:wrap;gap:8px">
      ${footerBtns}
    </div>
  </div>`);
}
async function copyTeacherInfo(id) {
  const t=STATIC_TEACHERS.find(s=>s.id===id)||await GharsDB.get('users/'+id); if(!t) return;
  await UI.copyText(`الاسم: ${t.name}\nاسم المستخدم: ${t.username}\nكلمة المرور: ${t.password}`);
}
async function deleteTeacher(id) {
  const isSelf = id === Auth.currentUser?.id;
  if(isSelf){ UI.toast('لا يمكنك حذف حسابك الحالي','error'); return; }
  if(!await UI.confirm('⚠️ سيتم حذف المعلم وبياناته نهائياً. متابعة؟','حذف المعلم')) return;

  // 1: إزالة من الواجهة فوراً
  const tList = document.getElementById('teachersList');
  if(tList) {
    tList.querySelectorAll('.teacher-row').forEach(row => {
      if(row.innerHTML.indexOf(id) !== -1){
        row.style.transition = 'opacity 0.2s'; row.style.opacity = '0';
        setTimeout(()=>{ row.remove(); }, 200);
      }
    });
  }

  UI.toast('⏳ جاري الحذف النهائي...', 'info', 2000);

  // 2: الحذف القاطع من Supabase وإرسال الطرد اللحظي
  if(_sbOK && _sb){
    try {
      await Promise.all([
        // أ) التسجيل في القائمة السوداء
        _sb.from('ghars_data').upsert({
          collection: 'deleted_accounts', doc_id: id,
          data: { id, deletedAt: new Date().toISOString(), role: 'teacher' },
          updated_at: new Date().toISOString()
        },{ onConflict: 'collection,doc_id' }),
        
        // ب) الحذف النهائي من جدول المستخدمين
        _sb.from('ghars_data').delete().eq('collection','users').eq('doc_id',id),
        
        // ج) إرسال أمر الطرد للمتصلين
        _sb.from('ghars_data').upsert({
          collection: 'force_logout', doc_id: id,
          data: { id, kickedAt: new Date().toISOString(), reason: 'deleted' },
          updated_at: new Date().toISOString()
        },{ onConflict: 'collection,doc_id' })
      ]);

      // حذف الإشعارات والنقاط المرتبطة به إن وجدت
      _sb.from('ghars_data').delete().eq('collection','notifications').filter('data->>teacherId','eq',id).catch(()=>{});
      _sb.from('ghars_data').delete().eq('collection','points_summary').eq('doc_id',id).catch(()=>{});
    } catch(e){ console.warn('deleteTeacher block write:', e); }
  }

  // 3: التنظيف المحلي
  if(typeof _addToDeletedList === 'function') _addToDeletedList(id);
  const keysT = [];
  for(let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if(k && k.includes(id)) keysT.push(k);
  }
  keysT.forEach(k => { try{ localStorage.removeItem(k); }catch(_){} });
  if(typeof GharsDataDB !== 'undefined') keysT.forEach(k => GharsDataDB.del(k).catch(()=>{}));

  GharsDB._invalidate('users');
  loadTeachers();
  UI.toast('✅ تم حذف بيانات المعلم نهائياً من قاعدة البيانات','success',3000);
}
// ============================================================
// EDIT TEACHER (للمدير فقط)
// ============================================================
async function showEditTeacherModal(id) {
  if (Auth.currentUser?.role !== 'admin') return;
  const t = STATIC_TEACHERS.find(s=>s.id===id) || await GharsDB.get('users/'+id);
  if (!t) { UI.toast('المعلم غير موجود','error'); return; }

  UI.showModal(`<div class="modal" style="max-width:400px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:#c9a227;font-size:0.92rem">✏️ تعديل بيانات المعلم</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">👤 الاسم الكامل</label>
        <input type="text" class="form-input" id="editTeacherName" value="${e(t.name)}" placeholder="الاسم الكامل">
      </div>
      <div class="form-group">
        <label class="form-label">🔵 اسم المستخدم</label>
        <input type="text" class="form-input" id="editTeacherUsername" value="${e(t.username)}" placeholder="اسم المستخدم" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="form-group">
        <label class="form-label">🔑 كلمة المرور</label>
        <div style="position:relative">
          <input type="text" class="form-input" id="editTeacherPassword" value="${e(t.password)}" placeholder="كلمة المرور" autocomplete="off">
          <button type="button" onclick="document.getElementById('editTeacherPassword').value=GharsUtils.generatePassword()"
            style="position:absolute;left:8px;top:50%;transform:translateY(-50%);background:rgba(201,162,39,0.15);border:1px solid rgba(201,162,39,0.3);border-radius:8px;padding:4px 10px;font-size:0.75rem;color:var(--gold-dark);cursor:pointer;font-family:Tajawal,sans-serif;font-weight:700">🔀 توليد</button>
        </div>
      </div>
      <div id="editTeacherMsg" style="display:none;margin-top:8px;background:#f0fdf4;border-radius:10px;padding:10px 12px;font-size:0.82rem;color:#16a34a;font-weight:700;border:1px solid #86efac"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" id="saveEditTeacherBtn" onclick="saveEditTeacher('${id}')">💾 حفظ التعديلات</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}

async function saveEditTeacher(id) {
  if (Auth.currentUser?.role !== 'admin') return;

  const newName     = document.getElementById('editTeacherName')?.value?.trim();
  const newUsername = document.getElementById('editTeacherUsername')?.value?.trim().toLowerCase();
  const newPassword = document.getElementById('editTeacherPassword')?.value?.trim();
  const msgEl       = document.getElementById('editTeacherMsg');
  const saveBtn     = document.getElementById('saveEditTeacherBtn');

  if (!newName)     { UI.toast('يرجى إدخال الاسم','error'); return; }
  if (!newUsername) { UI.toast('يرجى إدخال اسم المستخدم','error'); return; }
  if (!newPassword) { UI.toast('يرجى إدخال كلمة المرور','error'); return; }

  if (saveBtn) { saveBtn.disabled=true; saveBtn.innerHTML='<span class="loader loader-sm" style="display:inline-block;vertical-align:middle;margin-left:6px"></span><span style="vertical-align:middle"> جاري الحفظ...</span>'; }

  const oldData = STATIC_TEACHERS.find(s=>s.id===id) || await GharsDB.get('users/'+id);
  if (!oldData) { UI.toast('المعلم غير موجود','error'); return; }

  const credChanged = (newUsername !== (oldData.username||'').toLowerCase()) || (newPassword !== (oldData.password||''));
  const updated = Object.assign({}, oldData, {
    name:        newName,
    username:    newUsername,
    password:    newPassword,
    qrVersion:   credChanged ? GharsUtils.uid() : (oldData.qrVersion || GharsUtils.uid()),
    credUpdatedAt: credChanged ? new Date().toISOString() : oldData.credUpdatedAt
  });

  // 1. التحديث المحلي
  try { localStorage.setItem('ghars__users__'+id, JSON.stringify(updated)); } catch(_){}
  if (typeof GharsDataDB !== 'undefined') GharsDataDB.set('ghars__users__'+id, updated, 'users').catch(()=>{});

  // 2. التحديث في Supabase
  let cloudOK = false;
  if (_sbOK && _sb) {
    try {
      const { error } = await _sb.from('ghars_data').upsert({
        collection: 'users',
        doc_id:     id,
        data:       updated,
        updated_at: new Date().toISOString()
      }, { onConflict: 'collection,doc_id' });
      if (!error) {
        cloudOK = true;
        // إذا تغيرت كلمة المرور أو اسم المستخدم → أرسل أمر طرد حتى يدخل بالبيانات الجديدة
        if (credChanged) {
          await _sb.from('ghars_data').upsert({
            collection: 'force_logout', doc_id: id,
            data: { id, kickedAt: new Date().toISOString(), reason: 'credentials_changed' },
            updated_at: new Date().toISOString()
          }, { onConflict: 'collection,doc_id' });
        }
      } else {
        _writeQueue.push({ col:'users', doc:id, data:updated });
      }
    } catch(err) {
      _writeQueue.push({ col:'users', doc:id, data:updated });
    }
  } else {
    _writeQueue.push({ col:'users', doc:id, data:updated });
  }

  GharsDB._invalidate('users');

  // 3. إظهار النتيجة
  if (msgEl) {
    msgEl.style.display = 'block';
    const cloudMsg = cloudOK ? '☁️ تم الحفظ في السحابة' : '⚠️ سيُحفظ لاحقاً عند الاتصال';
    msgEl.innerHTML = `✅ تم تحديث البيانات — ${cloudMsg}` +
      (credChanged ? `<div style="margin-top:6px;font-size:0.78rem;color:#d97706">⚠️ تغيّرت بيانات الدخول — سيُطلب من المعلم إعادة تسجيل الدخول بالبيانات الجديدة</div>` : '');
  }
  if (saveBtn) { saveBtn.disabled=false; saveBtn.innerHTML='✅ تم الحفظ'; }

  loadTeachers();

  if (credChanged) UI.toast(`✅ تم تحديث "${newName}" — سيُطلب منه إعادة الدخول بالبيانات الجديدة`, 'success', 4000);
  else UI.toast(`✅ تم تحديث بيانات "${newName}"`, 'success', 3000);
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
  const teacher={
    id:       'teacher_'+GharsUtils.uid(),
    name,
    username: GharsUtils.generateUsername(name),
    password: GharsUtils.generatePassword(),
    role:     'teacher',
    qrVersion: GharsUtils.uid(),
    createdAt: new Date().toISOString(),
    deleted:   false
  };

  // ── 1. localStorage و IndexedDB فوراً ──
  try { localStorage.setItem('ghars__users__'+teacher.id, JSON.stringify(teacher)); } catch(_){}
  if(typeof GharsDataDB !== 'undefined') GharsDataDB.set('ghars__users__'+teacher.id, teacher, 'users').catch(()=>{});

  // ── 2. Supabase مباشرة + إبطال فوري ──
  let savedToCloud = false;
  GharsDB._invalidate('users');
  if(_sbOK && _sb) {
    try {
      const { error } = await _sb.from('ghars_data').upsert({
        collection: 'users',
        doc_id:     teacher.id,
        data:       teacher,
        updated_at: new Date().toISOString()
      }, { onConflict: 'collection,doc_id' });
      if(!error) { savedToCloud = true; }
      else _writeQueue.push({ col:'users', doc:teacher.id, data:teacher });
    } catch(e) { _writeQueue.push({ col:'users', doc:teacher.id, data:teacher }); }
  } else {
    _writeQueue.push({ col:'users', doc:teacher.id, data:teacher });
  }

  document.querySelector('.modal-overlay')?.remove();
  const tCloudMsg = savedToCloud ? '☁️ محفوظ في السحابة' : '⚠️ سيُحفظ لاحقاً';
  // ── modal مثل الطالب ──
  UI.showModal(`<div class="modal" style="max-width:360px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:#c9a227;font-size:0.92rem">✅ تم إضافة المعلم — ${e(teacher.name)}</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:16px">
      <div style="background:#f0fdf4;border-radius:12px;padding:14px;border:1.5px solid #86efac;margin-bottom:12px">
        <div style="font-size:0.72rem;color:#16a34a;font-weight:700;margin-bottom:8px">🔐 بيانات الدخول — احفظها</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <span style="font-size:0.78rem;color:#555">اسم المستخدم:</span>
          <code style="background:#e2e8f0;padding:2px 10px;border-radius:6px;font-family:monospace;font-size:0.85rem;color:#0a1628;font-weight:700">${teacher.username}</code>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:0.78rem;color:#555">كلمة المرور:</span>
          <code style="background:#e2e8f0;padding:2px 10px;border-radius:6px;font-family:monospace;font-size:0.85rem;color:#0a1628;font-weight:700">${teacher.password}</code>
        </div>
      </div>
      <div style="font-size:0.7rem;color:#888;text-align:center;margin-bottom:12px">${tCloudMsg}</div>
      <div style="display:flex;gap:8px">
        <button onclick="UI.copyText('${teacher.username}\n${teacher.password}').then(()=>{})"
          class="btn btn-outline" style="flex:1;justify-content:center;font-size:0.8rem">📋 نسخ</button>
        <button onclick="this.closest('.modal-overlay').remove();showQRPreview('${teacher.id}')"
          class="btn btn-primary" style="flex:1;justify-content:center;font-size:0.8rem">📱 QR</button>
      </div>
    </div>
  </div>`);
  loadTeachers();
}

// ============================================================
// MEETINGS — past/upcoming logic
// ============================================================
async function loadMeetings() {
  const [meetings, surveys] = await Promise.all([
    GharsDB.getAll('meetings'),
    GharsDB.getAll('lesson_surveys')
  ]);
  const now=Date.now();
  const list=Object.values(meetings).filter(m=>!m.deleted);
  // اللقاء يصبح "سابق" بعد 24 ساعة من تاريخه
  const PAST_THRESHOLD = 24 * 60 * 60 * 1000; // 24 ساعة بالميلي ثانية
  const upcoming=list.filter(m=>new Date(m.date).getTime() > (now - PAST_THRESHOLD)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const past    =list.filter(m=>new Date(m.date).getTime() <= (now - PAST_THRESHOLD)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  renderMeetings(upcoming,'upcomingMeetings',false,surveys);
  renderMeetings(past,'pastMeetings',true,surveys);
}
function renderMeetings(list,cId,isPast,surveys) {
  surveys = surveys || {};
  const c=document.getElementById(cId); if(!c) return;
  if(!list.length){c.innerHTML=noData('📅','لا توجد لقاءات');return;}
  const now=Date.now();
  c.innerHTML=list.map((m,i)=>{
    const d=new Date(m.date);
    const ds=formatArabicDate(d), ts=GharsUtils.formatTime(d);
    const hasStarted=d.getTime()<=(now+300000);
    const hasSurvey = !!(surveys[m.id] && surveys[m.id].activatedAt);

    // زر الضغط على اسم الدرس:
    // - لقاء قادم/جارٍ: يُفعَّل فقط إذا بدأ اللقاء (لفتح صفحة تفعيل الاستبيان)
    // - لقاء سابق: يُفعَّل فقط إذا سبق تفعيل الاستبيان (لعرض الردود)
    // - لقاء سابق بدون استبيان: معطّل
    let titleAttrs;
    if (isPast) {
      if (hasSurvey) {
        titleAttrs = `onclick="openMeetingSurveyPage('${m.id}')" style="cursor:pointer;text-decoration:underline dotted rgba(201,162,39,0.5)"`;
      } else {
        titleAttrs = `style="cursor:not-allowed;opacity:0.55" title="لم يتم تفعيل الاستبيان لهذا اللقاء"`;
      }
    } else {
      if (hasStarted) {
        titleAttrs = `onclick="openMeetingSurveyPage('${m.id}')" style="cursor:pointer;text-decoration:underline dotted rgba(201,162,39,0.5)"`;
      } else {
        titleAttrs = '';
      }
    }

    return `<div class="meeting-card-v2" style="animation-delay:${i*0.06}s">
      <div class="meeting-card-v2-header">
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:0.92rem;color:var(--white)" ${titleAttrs}>${e(m.title||'لقاء')}</div>
          <div class="meeting-date-badge" style="margin-top:6px">📅 ${ds} · ⏰ ${ts}</div>
        </div>
        <div class="flex gap-1" style="flex-wrap:wrap;flex-shrink:0">
          ${!isPast
            ? `<button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="openAttendance('${m.id}')">📋</button>
               <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="editMeeting('${m.id}')">✏️</button>`
            : `<button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="viewAttendanceSheet('${m.id}')">👁</button>`}
          <button class="meeting-share-btn" onclick="shareMeetingReport('${m.id}')" title="نسخ التقرير اليومي">📋</button>
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
  // collect group tasks
  const groupTasks={};
  document.querySelectorAll('[data-group-task]').forEach(sel=>{
    const gid=sel.getAttribute('data-group-task');
    groupTasks[gid]=sel.value||'none';
  });
  await GharsDB.set('meetings/'+id,{id,title:title||'لقاء',date:new Date(dt).toISOString(),
    attendance:{},groupTasks,createdBy:Auth.currentUser.id,createdAt:new Date().toISOString(),deleted:false});
  GharsDB._invalidate('meetings');
  UI.toast('تم حفظ اللقاء','success'); navigate('meetings'); loadUpcomingMeeting();
}
async function editMeeting(id) {
  const m=await GharsDB.get('meetings/'+id); if(!m) return;
  const dv=m.date?new Date(m.date).toISOString().slice(0,16):'';
  const savedTasks=m.groupTasks||{};
  const groups=await GharsDB.getAll('groups');
  const groupList=Object.values(groups).sort((a,b)=>a.name.localeCompare(b.name));
  const taskOpts=[
    {val:'none',label:'لا يوجد'},{val:'sport',label:'🏃 رياضي'},
    {val:'social',label:'🤝 اجتماعي'},{val:'culture',label:'📚 ثقافي'},
  ];
  const groupTasksHtml=groupList.length?`
    <div class="form-group">
      <label class="form-label">🎯 مهام المجموعات</label>
      ${groupList.map(g=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#f8fafc;border-radius:9px;margin-bottom:5px;border:1px solid var(--gray-mid)">
        <span style="font-weight:700;font-size:0.86rem;color:var(--navy)">🏆 ${e(g.name)}</span>
        <select id="editGT_${g.id}" style="padding:5px 10px;border-radius:8px;border:1.5px solid var(--gray-mid);font-family:Tajawal,sans-serif;font-size:0.82rem;background:#fff;color:var(--navy)">
          ${taskOpts.map(o=>`<option value="${o.val}"${(savedTasks[g.id]||'none')===o.val?' selected':''}>${o.label}</option>`).join('')}
        </select>
      </div>`).join('')}
    </div>`:'';
  UI.showModal(`<div class="modal" style="max-width:420px">
    <div class="modal-header"><h3>✏️ تعديل اللقاء</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">العنوان</label><input type="text" class="form-input" id="emTitle" value="${e(m.title||'')}"></div>
      <div class="form-group"><label class="form-label">التاريخ والوقت</label><input type="datetime-local" class="form-input" id="emDate" value="${dv}" style="direction:ltr"></div>
      ${groupTasksHtml}
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
  // Collect updated group tasks
  const groupTasks={...(m.groupTasks||{})};
  document.querySelectorAll('[id^="editGT_"]').forEach(sel=>{
    const gid=sel.id.replace('editGT_','');
    groupTasks[gid]=sel.value||'none';
  });
  await GharsDB.set('meetings/'+id,{...m,title:title||'لقاء',date:new Date(date).toISOString(),groupTasks});
  GharsDB._invalidate('meetings');
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('✅ تم تعديل اللقاء بنجاح','success'); loadMeetings(); loadUpcomingMeeting();
}
async function deleteMeeting(id) {
  if(!await UI.confirm('حذف هذا اللقاء؟ سيتم حذف جميع نقاط الحضور والاستبيانات المرتبطة به.','حذف')) return;
  UI.toast('⏳ جاري الحذف...','info',3000);
  try {
    // ── 1. حذف جميع نقاط هذا اللقاء ──
    const allPts = await GharsDB.getAll('points_summary');
    for(const [uid, pts] of Object.entries(allPts)) {
      if(!pts||!pts.breakdown) continue;
      const relatedPts = (pts.breakdown||[]).filter(b => b.meetingId === id);
      if(!relatedPts.length) continue;
      const filtered = (pts.breakdown||[]).filter(b => b.meetingId !== id);
      const removed  = relatedPts.reduce((a,b) => a+(b.points||0), 0);
      await GharsDB.set('points_summary/'+uid, {
        ...pts,
        total: Math.max(0,(pts.total||0)-removed),
        breakdown: filtered
      });
    }
    // ── 2. حذف استبيان هذا اللقاء ──
    try { await GharsDB.delete('lesson_surveys/' + id); } catch(_) {}
    if(_sbOK && _sb) {
      await _sb.from('ghars_data').delete().eq('collection','lesson_surveys').eq('doc_id', id);
    }
    GharsDB._invalidate('lesson_surveys');
    // ── 3. حذف ردود الاستبيان ──
    try {
      const allResponses = await GharsDB.getAll('lesson_survey_responses');
      const toDelete = Object.entries(allResponses).filter(([,r]) => r.meetingId === id);
      await Promise.all(toDelete.map(async ([key]) => {
        try { await GharsDB.delete('lesson_survey_responses/' + key); } catch(_) {}
        if(_sbOK && _sb) {
          await _sb.from('ghars_data').delete().eq('collection','lesson_survey_responses').eq('doc_id', key);
        }
      }));
      GharsDB._invalidate('lesson_survey_responses');
    } catch(_) {}
    // ── 4. حذف اللقاء من Supabase ──
    if(_sbOK && _sb) {
      await _sb.from('ghars_data').delete().eq('collection','meetings').eq('doc_id',id);
    }
    // ── 5. تنظيف الكاش ──
    _purgeByPrefix('__meetings__'+id);
    GharsDB._invalidate('meetings');
    GharsDB._invalidate('points_summary');
    UI.toast('✅ تم حذف اللقاء والاستبيانات والنقاط المرتبطة به','success');
    loadMeetings(); loadUpcomingMeeting();
  } catch(e) {
    console.error('deleteMeeting error:', e);
    UI.toast('حدث خطأ أثناء الحذف','error');
  }
}
async function shareMeetingReport(meetingId) {
  const [meeting,users]=await Promise.all([GharsDB.get('meetings/'+meetingId),GharsDB.getAll('users')]);
  if(!meeting){UI.toast('اللقاء غير موجود','error');return;}
  const att=meeting.attendance||{};
  const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  // تحديد هل اللقاء سابق أم قادم
  const PAST_THRESHOLD = 24 * 60 * 60 * 1000;
  const isPastMeeting = new Date(meeting.date).getTime() <= (Date.now() - PAST_THRESHOLD);
  // في اللقاءات القادمة فقط: يجب وجود تحضير قبل النسخ
  if (!isPastMeeting) {
    const hasAtt=students.some(s=>att[s.id]);
    if(!hasAtt){
      UI.toast('⚠️ لم يتم تحضير الطلاب بعد! يرجى أخذ الحضور أولاً','warning',5000);
      return;
    }
  }
  const d=new Date(meeting.date);
  const dayName=GharsUtils.arabicDay(d);
  const hijriDate=GharsUtils.hijriFull(d);
  let present=0,absent=0,excused=0,notAttended=0;
  students.forEach(s=>{
    if(att[s.id]==='present')present++;
    else if(att[s.id]==='absent')absent++;
    else if(att[s.id]==='excused')excused++;
    else notAttended++;
  });
  const emoji={'present':'✅','absent':'❌','excused':'⚠️'};
  const statusLabel={'present':'حاضر','absent':'غائب','excused':'مستأذن'};
  const lines=students.map(s=>{
    const rawSt=att[s.id];
    if(!rawSt){
      return isPastMeeting
        ? `❔ ${s.name} - ${s.group||'بدون مجموعة'} - لم يتم تحضيره`
        : `${emoji['absent']} ${s.name} - ${s.group||'بدون مجموعة'} - ${statusLabel['absent']}`;
    }
    return `${emoji[rawSt]||'❓'} ${s.name} - ${s.group||'بدون مجموعة'} - ${statusLabel[rawSt]||'—'}`;
  }).join('\n━━━━\n');
  const text='📊 *التقرير اليومي ليوم '+dayName+'*\n*📅 التاريخ : '+hijriDate+'*\n📈 *الإحصائيات :*\n✅ الحاضرون : '+present+'\n❌ الغائبون : '+absent+'\n⚠️ المستأذنون : '+excused+(notAttended>0?'\n❔ لم يتم تحضيرهم : '+notAttended:'')+'\n👥 *تفاصيل الطلاب:*\n━━━━━━━━━━━━━\n'+lines+'\n━━━━━━━━━━━━━';
  showSharePreview(text);
}
async function confirmClearMeetings() {
  if(!await UI.confirm('🗑 سيتم حذف جميع اللقاءات والاستبيانات وردودها نهائياً. متابعة؟','حذف الكل')) return;
  UI.toast('⏳ جاري الحذف...','info',5000);
  try {
    if(_sbOK && _sb) {
      // ── 1. مسح نقاط الحضور ──
      const allPts = await GharsDB.getAll('points_summary');
      for(const [uid, pts] of Object.entries(allPts)) {
        if(!pts?.breakdown?.length) continue;
        const filtered = pts.breakdown.filter(b => !b.meetingId);
        const removed  = pts.breakdown.filter(b =>  b.meetingId).reduce((a,b)=>a+(b.points||0),0);
        if(removed > 0) await GharsDB.set('points_summary/'+uid,{...pts,total:Math.max(0,(pts.total||0)-removed),breakdown:filtered});
      }
      // ── 2. حذف جميع اللقاءات ──
      await _sb.from('ghars_data').delete().eq('collection','meetings').neq('doc_id','__placeholder__');
      // ── 3. حذف جميع الاستبيانات ──
      await _sb.from('ghars_data').delete().eq('collection','lesson_surveys').neq('doc_id','__placeholder__');
      // ── 4. حذف جميع ردود الاستبيانات ──
      await _sb.from('ghars_data').delete().eq('collection','lesson_survey_responses').neq('doc_id','__placeholder__');
    }
    _purgeByPrefix('__meetings__');
    _purgeByPrefix('__lesson_surveys__');
    _purgeByPrefix('__lesson_survey_responses__');
    GharsDB._invalidate('meetings');
    GharsDB._invalidate('points_summary');
    GharsDB._invalidate('lesson_surveys');
    GharsDB._invalidate('lesson_survey_responses');
    UI.toast('✅ تم حذف جميع اللقاءات والاستبيانات','success');
    loadMeetings(); loadUpcomingMeeting();
  } catch(e) { console.error('confirmClearMeetings:', e); UI.toast('حدث خطأ','error'); }
}
function switchMeetingTab(tab) {
  const upcoming = document.getElementById('upcomingMeetings');
  const past = document.getElementById('pastMeetings');
  if(upcoming) upcoming.style.display = tab==='upcoming' ? 'block' : 'none';
  if(past)     past.style.display     = tab==='past'     ? 'block' : 'none';
  document.querySelectorAll('#section-meetings .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('meetTabBtn-'+tab)?.classList.add('active');
}
function switchMeetingTabSwipe(tab,idx){ switchMeetingTab(tab); }

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
    
    // تحديد لون الخلفية (أبيض للسطر الزوجي الأول، ورمادي فاتح مثل الإحصائيات للسطر الفردي الثاني وهكذا)
    const bgColor = i % 2 === 1 ? '#ecf1f5' : '#ffffff';
    
    return `<div class="student-row" style="background-color: ${bgColor}; animation:fadeInUp 0.3s ${i*0.05}s both ease">
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
  const m = await GharsDB.get('meetings/'+currentMeetingForAttendance);
  const oldAttendance = m?.attendance || {};
  await GharsDB.set('meetings/'+currentMeetingForAttendance, {...m, attendance: attendanceData});

  for(const [sid, newStatus] of Object.entries(attendanceData)) {
    const oldStatus = oldAttendance[sid] || '';
    const wasPresent = oldStatus === 'present';
    const isPresent  = newStatus === 'present';

    // لا تغيير → تجاهل
    if(oldStatus === newStatus) continue;

    const pts = await GharsDB.get('points_summary/'+sid) || {id:sid, total:0, breakdown:[]};
    const breakdown = [...(pts.breakdown||[])];

    // ── حالة: كان غائباً/مستأذناً والآن حاضر → أضف نقطتين ──
    if(!wasPresent && isPresent) {
      const already = breakdown.some(b => b.meetingId===currentMeetingForAttendance && b.type==='attendance' && b.points>0);
      if(!already) {
        // إزالة أي سجل حضور سابق لهذا اللقاء (نقطة 0)
        const filtered = breakdown.filter(b => !(b.meetingId===currentMeetingForAttendance && b.type==='attendance'));
        filtered.push({type:'attendance', meetingId:currentMeetingForAttendance, meetingTitle:m?.title||'لقاء', points:2, status:newStatus, date:new Date().toISOString()});
        const newTotal = Math.max(0,(pts.total||0)+2);
        await GharsDB.set('points_summary/'+sid, {...pts, total:newTotal, breakdown:filtered});
      }
    }
    // ── حالة: كان حاضراً والآن غائب/مستأذن → احذف النقطتين ──
    else if(wasPresent && !isPresent) {
      const attEntry = breakdown.find(b => b.meetingId===currentMeetingForAttendance && b.type==='attendance' && b.points>0);
      if(attEntry) {
        const filtered = breakdown.filter(b => !(b.meetingId===currentMeetingForAttendance && b.type==='attendance'));
        filtered.push({type:'attendance', meetingId:currentMeetingForAttendance, meetingTitle:m?.title||'لقاء', points:0, status:newStatus, date:new Date().toISOString()});
        const removed = attEntry.points || 2;
        await GharsDB.set('points_summary/'+sid, {...pts, total: Math.max(0,(pts.total||0)-removed), breakdown:filtered});
      }
    }
    // ── حالة: لم يكن مسجلاً أصلاً ──
    else if(!oldStatus) {
      const already = breakdown.some(b => b.meetingId===currentMeetingForAttendance && b.type==='attendance');
      if(!already) {
        const pts2add = isPresent ? 2 : 0;
        if(pts2add>0) pts.total = (pts.total||0)+pts2add;
        breakdown.push({type:'attendance', meetingId:currentMeetingForAttendance, meetingTitle:m?.title||'لقاء', points:pts2add, status:newStatus, date:new Date().toISOString()});
        await GharsDB.set('points_summary/'+sid, {...pts, breakdown});
      }
    }
  }

  // ── تسجيل الطلاب الجدد غير الموجودين في التحضير السابق ──
  for(const [sid, newStatus] of Object.entries(attendanceData)) {
    if(oldAttendance[sid] !== undefined) continue; // تم التعامل معه
    const pts = await GharsDB.get('points_summary/'+sid) || {id:sid, total:0, breakdown:[]};
    const already = (pts.breakdown||[]).some(b => b.meetingId===currentMeetingForAttendance && b.type==='attendance');
    if(!already) {
      const pts2add = newStatus==='present' ? 2 : 0;
      if(pts2add>0) pts.total = (pts.total||0)+pts2add;
      pts.breakdown = [...(pts.breakdown||[]), {type:'attendance', meetingId:currentMeetingForAttendance, meetingTitle:m?.title||'لقاء', points:pts2add, status:newStatus, date:new Date().toISOString()}];
      await GharsDB.set('points_summary/'+sid, pts);
    }
  }

  UI.toast('✅ تم حفظ التحضير وتحديث النقاط','success');
  GharsDB._invalidate('meetings');
  GharsDB._invalidate('points_summary');

  // ── تحديث قائمة الحاضرين في الاستبيان إن كان مفعّلاً ──
  try {
    const survey = await GharsDB.get('lesson_surveys/' + currentMeetingForAttendance);
    if (survey && survey.expiresAt && new Date(survey.expiresAt).getTime() > Date.now()) {
      const presentStudents = Object.entries(attendanceData)
        .filter(([, status]) => status === 'present')
        .map(([sid]) => sid);
      await GharsDB.set('lesson_surveys/' + currentMeetingForAttendance, {
        ...survey, presentStudents
      });
      GharsDB._invalidate('lesson_surveys');
    }
  } catch(surveyErr) { console.warn('survey presentStudents update:', surveyErr); }

  navigate('meetings');
}
async function viewAttendanceSheet(meetingId) {
  const [m, users, groups] = await Promise.all([
    GharsDB.get('meetings/'+meetingId),
    GharsDB.getAll('users'),
    GharsDB.getAll('groups')
  ]);
  const students = Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
  const att = m?.attendance || {};
  const groupTasks = m?.groupTasks || {};
  const groupMap = {};
  Object.values(groups).forEach(g => { groupMap[g.id] = g; });

  // مهام المجموعات
  const taskLabels = { sport:'🏃 رياضي', social:'🤝 اجتماعي', culture:'📚 ثقافي' };
  const taskColors = {
    sport:  { bg:'rgba(56,161,105,0.1)',  border:'rgba(56,161,105,0.4)',  color:'#276749' },
    social: { bg:'rgba(49,130,206,0.1)',  border:'rgba(49,130,206,0.4)',  color:'#1a365d' },
    culture:{ bg:'rgba(128,90,213,0.1)', border:'rgba(128,90,213,0.4)', color:'#44337a' },
  };
  const taskEntries = Object.entries(groupTasks).filter(([,v])=>v&&v!=='none');
  const groupTasksSection = taskEntries.length
    ? `<div style="margin-bottom:14px;padding:12px 14px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
        <div style="font-weight:800;font-size:0.82rem;color:var(--navy);margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <span>🎯</span><span>مهام المجموعات</span>
        </div>
        ${taskEntries.map(([gid,task])=>{
          const g = groupMap[gid];
          if(!g) return '';
          const tc = taskColors[task]||{bg:'#f8fafc',border:'#e2e8f0',color:'#666'};
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:${tc.bg};border:1px solid ${tc.border};border-radius:10px;margin-bottom:6px">
            <span style="font-weight:700;font-size:0.85rem;color:var(--navy)">🏆 ${e(g.name)}</span>
            <span style="font-weight:800;font-size:0.82rem;color:${tc.color}">${taskLabels[task]||task}</span>
          </div>`;
        }).join('')}
      </div>`
    : '';

  // الحضور
  const attendanceRows = students.map(s=>{
    const st=att[s.id];
    const b=st==='present'?'<span class="status-present">حاضر</span>'
             :st==='absent'?'<span class="status-absent">غائب</span>'
             :st==='excused'?'<span class="status-excused">مستأذن</span>'
             :'<span class="badge badge-gray">—</span>';
    return `<div class="student-row"><div class="seen-avatar">${s.name.charAt(0)}</div><span style="flex:1">${e(s.name)}</span>${b}</div>`;
  }).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');

  UI.showModal(`<div class="modal" style="max-width:440px">
    <div class="modal-header"><h3>📋 ${e(m?.title||'لقاء')}</h3><button class="modal-close">✖</button></div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto">
      ${groupTasksSection}
      ${attendanceRows || '<p style="text-align:center;color:var(--gray);padding:20px">لا يوجد تحضير مسجل</p>'}
    </div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>إغلاق</button></div>
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
  
  c.innerHTML=students.map((s,i)=>{
    // تحديد لون الخلفية (أبيض للسطر الأول، رمادي فاتح للسطر الثاني وهكذا)
    const bgColor = i % 2 === 1 ? '#edf2f7' : '#ffffff';
    
    return `
    <div class="points-row" style="background-color: ${bgColor}; animation:fadeInUp 0.3s ${i*0.05}s both ease">
      <div style="flex:1;min-width:0">
        <div class="student-name">${e(s.name)}</div>
        <div style="font-size:0.75rem;color:var(--gray)">نقاطه: <strong style="color:var(--gold)" data-ptsLabel="${s.id}">${ptsData[s.id]?.total||0}</strong></div>
      </div>
      <input type="number" class="form-input" id="pts-${s.id}" placeholder="أضف" min="0"
        style="width:70px;text-align:center;padding:6px 8px" inputmode="numeric">
    </div>`;
  }).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>');
}
async function savePoints() {
  pauseRealtime(3000);
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
        points:val,date:new Date().toISOString()
        // لا نحفظ اسم المعلم عمداً — يظهر كـ"نقاط إضافية" للطالب
      }];
      await GharsDB.set('points_summary/'+s.id,pts);
      GharsDB._invalidate('points_summary');
      // مسح الحقل فقط — لا تعيد تحميل القائمة
      const inp=document.getElementById('pts-'+s.id);if(inp)inp.value='';
      // تحديث الرقم الظاهر فقط
      const ptsLabel=document.querySelector(`[data-ptsLabel="${s.id}"]`);
      if(ptsLabel) ptsLabel.textContent=pts.total;
      cnt++;
    }
  }
  if(cnt>0){UI.toast(`✅ تم إضافة نقاط لـ ${cnt} طالب`,'success');loadHomeStats();}
  else UI.toast('لم يتم إدخال أي نقاط','warning');
}
async function confirmClearPoints() {
  if(!await UI.confirm('مسح نقاط المبادرات؟','مسح النقاط')) return;
  UI.toast('⏳ جاري المسح...','info',1500);
  const students=Object.values(await GharsDB.getAll('users')).filter(u=>u.role==='student');
  const ptsAll = await GharsDB.getAll('points_summary');
  await Promise.all(students.map(async s => {
    const pts = ptsAll[s.id];
    if(pts){
      const filtered=(pts.breakdown||[]).filter(b=>b.type!=='initiative');
      await GharsDB.set('points_summary/'+s.id,{...pts,total:filtered.reduce((a,b)=>a+(b.points||0),0),breakdown:filtered});
    }
  }));
  GharsDB._invalidate('points_summary');
  UI.toast('✅ تم المسح','success');loadPoints();
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
    
    // تحديد لون الخلفية (أبيض للسطر الأول، رمادي فاتح للسطر الثاني وهكذا)
    const bgColor = i % 2 === 1 ? '#edf2f7' : '#ffffff';
    
    return `<div class="memo-row" style="background-color: ${bgColor}; animation:fadeInUp 0.3s ${i*0.05}s both ease">
      <div style="flex:1;min-width:0">
        <div class="student-name">${e(s.name)}</div>
        ${target>0?`<div style="margin-top:5px">
          <div class="progress-bar-animated"><div class="fill" style="--pct:${pct}%"></div></div>
        </div>`:''}
      </div>
      <span style="font-size:0.82rem;color:var(--gold);font-weight:700;min-width:50px;text-align:center">${sc}/${target||'?'}</span>
      <input type="number" class="form-input" id="memo-${s.id}" placeholder="أضف" min="0"
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
  pauseRealtime(4000);
  const students=Object.values(await GharsDB.getAll('users')).filter(u=>u.role==='student'&&!u.deleted);
  let saved=0;
  const settings=await GharsDB.get('system/settings');
  const target=settings?.targetMemorization||30;
  let rejected=0;
  for(const s of students) {
    const inp=document.getElementById('memo-'+s.id);
    const raw=inp?.value;
    const val=raw!==undefined&&raw!==''?parseInt(raw):null;
    if(val!==null&&!isNaN(val)&&val>=0) {
      if(val>target) {
        // رفض الأرقام التي تتجاوز المستهدف
        rejected++;
        if(inp) { inp.style.borderColor='var(--red)'; inp.style.background='rgba(229,62,62,0.08)'; }
        UI.toast(`⚠️ ${e(s.name)}: الرقم ${val} أكبر من المستهدف (${target})، تم تجاهله`,'warning',3000);
        continue;
      }
      if(inp) { inp.style.borderColor=''; inp.style.background=''; }
      await GharsDB.set('memorization/'+s.id,{id:s.id,score:val,updatedAt:new Date().toISOString()});
      GharsDB._invalidate('memorization');
      saved++;
    }
  }
  UI.toast(saved>0?`✅ تم حفظ أرقام ${saved} طالب${rejected?' (تم تجاهل '+rejected+' رقم خاطئ)':''}`:'لم تتغير أي أرقام','success');
  // لا نعيد تحميل الصفحة — فقط نحدث الأرقام الظاهرة في الواجهة
  students.forEach(s=>{
    const inp=document.getElementById('memo-'+s.id);
    if(inp&&inp.value!=='') {
      const bar=document.getElementById('memoBar-'+s.id);
      // نترك القيمة كما هي ولا نمسحها
    }
  });
}
async function confirmClearMemo() {
  if(!await UI.confirm('🗑 سيتم مسح جميع أرقام التسميع نهائياً. متابعة؟','مسح الكل')) return;
  UI.toast('⏳ جاري المسح...','info',2000);
  try {
    if(_sbOK && _sb) {
      await _sb.from('ghars_data').delete().eq('collection','memorization').neq('doc_id','__placeholder__');
    }
    _purgeByPrefix('__memorization__');
    GharsDB._invalidate('memorization');
    UI.toast('✅ تم مسح أرقام التسميع','success'); loadMemorization();
  } catch(e) { console.error('confirmClearMemo:', e); UI.toast('حدث خطأ','error'); }
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
        <button class="btn btn-sm" style="background:linear-gradient(135deg,var(--gold),var(--gold-dark));color:var(--navy);font-size:0.74rem;padding:5px 10px;font-weight:700" onclick="showGroupStudents('${g.id}')">👥 الأعضاء</button>
        <button class="btn btn-sm" style="background:linear-gradient(135deg,var(--gold-light),var(--gold));color:var(--navy);font-size:0.74rem;padding:5px 10px;font-weight:700" onclick="addGroupPoints('${g.id}','${e(g.name)}')">➕ نقاط</button>
        <button class="btn btn-sm btn-danger" style="font-size:0.74rem;padding:4px 8px" onclick="deleteGroup('${g.id}')">🗑</button>
      </div>
    </div>
  </div>`).join('');
}
async function showAddGroup() {
  UI.showModal(`<div class="modal" style="max-width:400px;width:min(400px,95vw)">
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
  GharsDB._invalidate('groups');
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
  UI.toast('⏳ جاري المسح...','info',1500);
  const groups=await GharsDB.getAll('groups');
  await Promise.all(Object.entries(groups).map(([id,g]) => GharsDB.set('groups/'+id,{...g,points:0})));
  GharsDB._invalidate('groups');
  UI.toast('✅ تم','success'); loadGroups();
}


// ============================================================
// GROUP TASKS FOR MEETING
// ============================================================
async function loadGroupsForMeeting(containerId, savedTasks) {
  const groups = await GharsDB.getAll('groups');
  const list = Object.values(groups).sort((a,b)=>a.name.localeCompare(b.name));
  const wrapper = document.getElementById(containerId);
  if(!wrapper) return;
  if(!list.length) { wrapper.style.display='none'; return; }
  const saved = savedTasks || {};
  let html = '<div style="font-weight:800;font-size:0.9rem;color:var(--navy);margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid rgba(201,162,39,0.3);display:flex;align-items:center;gap:8px">'
    + '<span style="font-size:1.3rem">🎯</span>'
    + '<span>مهام المجموعات في اللقاء</span>'
    + '<span style="font-size:0.72rem;color:var(--gray);font-weight:600;margin-right:auto">(اختياري)</span>'
    + '</div>';
  for(const g of list){
    const val = saved[g.id]||'none';
    const rowBg = {sport:'rgba(56,161,105,0.08)',social:'rgba(49,130,206,0.08)',culture:'rgba(128,90,213,0.08)',none:'#f8fafc'}[val]||'#f8fafc';
    const rowBdr = {sport:'rgba(56,161,105,0.4)',social:'rgba(49,130,206,0.4)',culture:'rgba(128,90,213,0.4)',none:'var(--gray-mid)'}[val]||'var(--gray-mid)';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;'
          + 'border-radius:10px;margin-bottom:8px;transition:background 0.25s,border-color 0.25s;'
          + `background:${rowBg};border:1.5px solid ${rowBdr}" id="gtRow-${g.id}">`
          + '<div style="display:flex;align-items:center;gap:10px">'
          + '<span style="font-size:1.1rem">🏆</span>'
          + `<span style="font-weight:700;font-size:0.88rem;color:var(--navy)">${e(g.name)}</span>`
          + '</div>'
          + `<select data-group-task="${g.id}" onchange="updateGroupTaskRow('${g.id}',this.value)"`
          + ' style="padding:7px 14px;border-radius:10px;border:1.5px solid var(--gray-mid);'
          + 'font-family:Tajawal,sans-serif;font-size:0.84rem;background:#fff;color:var(--navy);cursor:pointer">'
          + `<option value="none"${val==='none'?' selected':''}>لا يوجد</option>`
          + `<option value="sport"${val==='sport'?' selected':''}>🏃 رياضي</option>`
          + `<option value="social"${val==='social'?' selected':''}>🤝 اجتماعي</option>`
          + `<option value="culture"${val==='culture'?' selected':''}>📚 ثقافي</option>`
          + '</select>'
          + '</div>';
  }
  const cb = wrapper.querySelector('.card-body');
  if(cb) cb.innerHTML = html;
  else wrapper.innerHTML = html;
  wrapper.style.display = 'block';
}

function updateGroupTaskRow(gid, val) {
  const row = document.getElementById('gtRow-'+gid);
  if(!row) return;
  const colors = {sport:'rgba(56,161,105,0.15)',social:'rgba(49,130,206,0.12)',culture:'rgba(128,90,213,0.12)',none:'#f8fafc'};
  const borders = {sport:'rgba(56,161,105,0.5)',social:'rgba(49,130,206,0.5)',culture:'rgba(128,90,213,0.5)',none:'var(--gray-mid)'};
  row.style.background = colors[val]||colors.none;
  row.style.borderColor = borders[val]||borders.none;
}

function getTaskBadge(taskVal) {
  const map = {
    sport:  {label:'🏃 رياضي',   bg:'linear-gradient(135deg,#c6f6d5,#9ae6b4)', color:'#22543d', border:'rgba(56,161,105,0.4)'},
    social: {label:'🤝 اجتماعي', bg:'linear-gradient(135deg,#bee3f8,#90cdf4)', color:'#1a365d', border:'rgba(49,130,206,0.4)'},
    culture:{label:'📚 ثقافي',   bg:'linear-gradient(135deg,#e9d8fd,#d6bcfa)', color:'#44337a', border:'rgba(128,90,213,0.4)'},
  };
  const t=map[taskVal];
  if(!t) return '';
  return `<span style="background:${t.bg};color:${t.color};border:1.5px solid ${t.border};border-radius:16px;padding:3px 10px;font-size:0.72rem;font-weight:800;white-space:nowrap;display:inline-flex;align-items:center;gap:4px">${t.label}</span>`;
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
  // ═══ FIX: تحديث الكاش من السيرفر عند كل فتح صفحة السيرة ═══
  GharsDB._invalidate('lessons');
  const lessons=await GharsDB.getAll('lessons');
  const allList=Object.values(lessons).filter(l=>!l.deleted).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const sentList=allList.filter(l=>!l.hidden);
  const hiddenList=allList.filter(l=>l.hidden);

  // تبويب الدروس المخفية يظهر فقط إذا وجد درس مخفي واحد على الأقل
  const hiddenTab=document.getElementById('lessonTabBtn-hidden');
  if(hiddenTab) hiddenTab.style.display=hiddenList.length?'flex':'none';

  _renderLessonList(sentList, 'lessonsSentList', false);
  _renderLessonList(hiddenList, 'lessonsHiddenList', true);
}

function _renderLessonList(list, containerId, isHidden) {
  const c=document.getElementById(containerId);
  if(!c) return;
  if(!list.length){
    c.innerHTML=noData('🕌', isHidden?'لا توجد دروس مخفية':'لا توجد دروس');
    return;
  }
  c.innerHTML=list.map((l,i)=>{
    const badges=[];
    if(l.youtubeUrl||(l.videoSource==='youtube'&&l.videoUrl)) badges.push('<span class="content-badge content-yt">▶️ يوتيوب</span>');
    if((l.videoSource==='upload'&&l.videoUrl)||l.uploadedVideoUrl) badges.push('<span class="content-badge content-video">🎥 فيديو</span>');
    if(l.pdfUrl) badges.push('<span class="content-badge content-pdf">📄 PDF</span>');
    const hiddenBadge=isHidden?'<span class="lesson-hidden-badge">🙈 مخفي</span>':'';
    // موضوع الدرس لا يُعرض في قائمة الدروس للمعلم (يظهر فقط داخل الدرس للطالب)
    const topicHtmlTeacher = '';
    return `<div class="lesson-v2" style="animation-delay:${i*0.06}s${isHidden?';opacity:0.75':''}">
    <div class="lesson-v2-header">
      <div style="font-size:1.6rem">📚</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:0.92rem;color:var(--gold);display:flex;align-items:center;gap:6px;flex-wrap:wrap">${e(l.title)} ${hiddenBadge}</div>
        <div style="font-size:0.73rem;color:rgba(255,255,255,0.6);margin-top:2px">${GharsUtils.toHijriShort(new Date(l.createdAt))}</div>
        ${badges.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${badges.join('')}</div>`:''}
      </div>
      <div class="flex gap-1" style="flex-wrap:wrap">
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="viewLessonViewers('${l.id}')">👁 ${(l.viewers||[]).length}</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="viewLessonComments('${l.id}')">💬 ${(l.comments||[]).length}</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="editLesson('${l.id}')">✏️</button>
        ${isHidden?`<button class="btn btn-sm" style="background:rgba(56,161,105,0.3);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="quickToggleLessonHide('${l.id}',true)">👁 إظهار</button>`:''}
        <button class="btn btn-sm" style="background:rgba(229,62,62,0.3);color:#fff;font-size:0.74rem;padding:5px 8px" onclick="deleteLesson('${l.id}')">🗑</button>
      </div>
    </div>
    ${topicHtmlTeacher}
  </div>`;
  }).join('');
}

function switchLessonTab(tab) {
  const sent=document.getElementById('lessonsSentList');
  const hidden=document.getElementById('lessonsHiddenList');
  if(sent)   sent.style.display   = tab==='sent'  ?'block':'none';
  if(hidden) hidden.style.display = tab==='hidden'?'block':'none';
  document.querySelectorAll('#section-seerah .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('lessonTabBtn-'+tab)?.classList.add('active');
}

async function quickToggleLessonHide(lessonId, currentlyHidden) {
  const l=await GharsDB.get('lessons/'+lessonId); if(!l) return;
  const newHidden=!currentlyHidden;
  await GharsDB.set('lessons/'+lessonId,{...l,hidden:newHidden});
  GharsDB._invalidate('lessons');
  UI.toast(newHidden?'🙈 تم إخفاء الدرس عن الطلاب':'👁 تم إظهار الدرس للطلاب','success');
  loadSeerah();
}

async function toggleLessonComments(lessonId, currentlyLocked) {
  const l = await GharsDB.get('lessons/'+lessonId); if(!l) return;
  const newLocked = !currentlyLocked;
  await GharsDB.set('lessons/'+lessonId, {...l, commentsLocked: newLocked});
  _updateCommentsToggleBtn(newLocked);
  UI.toast(newLocked ? '🔴 تم إيقاف التعليقات — لن يتمكن الطلاب من الكتابة' : '🟢 تم تفعيل التعليقات للطلاب','success',3000);
  loadSeerah();
}

let _editingLessonHidden = false;
function toggleLessonHide() {
  _editingLessonHidden = !_editingLessonHidden;
  const btn=document.getElementById('lessonHideBtn');
  if(btn) {
    if(_editingLessonHidden) {
      btn.className='lesson-hide-btn hidden-active';
      btn.textContent='👁 إظهار الدرس';
    } else {
      btn.className='lesson-hide-btn';
      btn.textContent='🙈 إخفاء الدرس';
    }
  }
}

// Toggle individual source sections
function toggleLessonSource(type) {
  const sectionMap = {youtube:'ytUrlSection', upload:'uploadVideoSection', pdf:'pdfSourceSection'};
  const btnMap = {youtube:'ytSourceBtn', upload:'uploadSourceBtn', pdf:'pdfSourceBtn'};
  const section = document.getElementById(sectionMap[type]);
  const btn = document.getElementById(btnMap[type]);
  if(!section||!btn) return;
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  btn.classList.toggle('active', !isOpen);
}
// Legacy: kept for backward compat with edit
function setVideoSource(src) {
  const ytSection=document.getElementById('ytUrlSection');
  const upSection=document.getElementById('uploadVideoSection');
  const ytBtn=document.getElementById('ytSourceBtn');
  const upBtn=document.getElementById('uploadSourceBtn');
  if(src==='youtube'){
    if(ytSection)ytSection.style.display='block';
    if(ytBtn)ytBtn.classList.add('active');
  } else if(src==='upload'){
    if(upSection)upSection.style.display='block';
    if(upBtn)upBtn.classList.add('active');
  }
  lessonVideoSource=src;
}
function resetLessonForm() {
  editingLessonId=null; lessonVideoSource=null; _editingLessonHidden=false;
  ['lessonTitle','lessonTopic','lessonYtUrl'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  // مسح المحرر الغني
  const _ed2=document.getElementById('lessonTopicEditor');
  if(_ed2)_ed2.innerHTML='';
  // إيقاف مؤقت تحويل الروابط
  if(typeof clearTimeout!=='undefined' && typeof _urlConvertTimer!=='undefined') clearTimeout(_urlConvertTimer);
  ['ytUrlSection','uploadVideoSection','pdfSourceSection'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  ['ytSourceBtn','uploadSourceBtn','pdfSourceBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('active');});
  const ft=document.getElementById('lessonFormTitle');if(ft)ft.textContent='➕ إضافة درس جديد';
  const sb=document.getElementById('lessonSaveBtn');if(sb)sb.textContent='📤 إرسال الدرس';
  ['video','pdf'].forEach(t=>{
    const n=document.getElementById(t+'PickerName');if(n){n.style.display='none';}
    const a=document.getElementById(t+'PickerArea');if(a)a.style.borderColor='';
  });
  const videoInput=document.getElementById('lessonVideoFile');if(videoInput)videoInput.value='';
  const pdfInput=document.getElementById('lessonPdfFile');if(pdfInput)pdfInput.value='';
  // إخفاء زر الإخفاء — يظهر فقط عند التعديل
  const hideWrap=document.getElementById('lessonHideToggleWrap');
  if(hideWrap) hideWrap.style.display='none';
  const hideBtn=document.getElementById('lessonHideBtn');
  if(hideBtn){hideBtn.className='lesson-hide-btn';hideBtn.textContent='🙈 إخفاء الدرس';}
}

async function saveLesson() {
  const title=document.getElementById('lessonTitle')?.value?.trim();
  if(!title){UI.toast('يرجى إدخال عنوان الدرس','error');return;}
  if(title.length>200){UI.toast('العنوان طويل جداً (الحد الأقصى 200 حرف)','error');return;}
  // مزامنة المحرر الغني مع الحقل المخفي — يحوّل الروابط تلقائياً عبر _convertRawUrlsInEditor
  if (typeof _convertRawUrlsInEditor === 'function') _convertRawUrlsInEditor();
  if (typeof _syncTopicToHidden === 'function') _syncTopicToHidden();
  const topic = (document.getElementById('lessonTopic')?.value || '').trim();
  const ytBtn=document.getElementById('ytSourceBtn');
  const upBtn=document.getElementById('uploadSourceBtn');
  const ytActive=ytBtn?.classList.contains('active');
  const videoActive=upBtn?.classList.contains('active');
  const ytUrl=ytActive?(document.getElementById('lessonYtUrl')?.value?.trim()||''):'';
  const linkedHw=document.getElementById('lessonLinkHw')?.value||'';
  const linkedMeeting=document.getElementById('lessonLinkMeeting')?.value||'';
  const videoFile=videoActive?(document.getElementById('lessonVideoFile')?.files?.[0]):null;
  const pdfFile=document.getElementById('lessonPdfFile')?.files?.[0];
  const btn=document.getElementById('lessonSaveBtn');
  UI.setLoading(btn,true,'جاري الحفظ...');
  let uploadedVideoUrl=''; let pdfUrl='';
  const progressEl=document.getElementById('uploadProgress');
  const progressBar=document.getElementById('uploadProgressBar');
  const progressTxt=document.getElementById('uploadProgressText');
  try {
    if(videoActive&&videoFile) {
      if(progressEl)progressEl.style.display='block';
      uploadedVideoUrl=await GharsDB.uploadFile(
        `lessons/videos/${GharsUtils.uid()}_${videoFile.name}`, videoFile,
        (p)=>{ if(progressBar)progressBar.style.width=p+'%'; if(progressTxt)progressTxt.textContent=`${Math.round(p)}%`; }
      );
      if(progressEl)progressEl.style.display='none';
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
    youtubeUrl:ytUrl||existingLesson?.youtubeUrl||'',
    uploadedVideoUrl:uploadedVideoUrl||existingLesson?.uploadedVideoUrl||'',
    pdfUrl:pdfUrl||existingLesson?.pdfUrl||'',
    // backward compat
    videoUrl:ytUrl||uploadedVideoUrl||existingLesson?.videoUrl||'',
    videoSource:ytUrl?'youtube':(uploadedVideoUrl||videoActive?'upload':existingLesson?.videoSource||null),
    linkedHw:linkedHw||null,linkedMeeting:linkedMeeting||null,
    viewers:existingLesson?.viewers||[],comments:existingLesson?.comments||[],
    hidden: editingLessonId ? _editingLessonHidden : false,
    createdBy:Auth.currentUser.id,createdAt:existingLesson?.createdAt||new Date().toISOString(),
    deleted:false
  };
  await GharsDB.set('lessons/'+id,lesson);
  GharsDB._invalidate('lessons');
  UI.setLoading(btn,false);
  UI.toast(editingLessonId?'✅ تم التعديل':'✅ تم إرسال الدرس','success');
  editingLessonId=null; _editingLessonHidden=false; resetLessonForm(); navigate('seerah');
  // ═══ إعادة تحميل بعد 600ms لضمان تحديث البيانات من السيرفر ═══
  setTimeout(function(){ if(currentPage==='seerah') loadSeerah(); }, 600);
}
async function editLesson(id) {
  const l=await GharsDB.get('lessons/'+id); if(!l) return;
  editingLessonId=id;
  _editingLessonHidden = l.hidden||false;
  navigate('add-lesson');
  setTimeout(async ()=>{
    const lt=document.getElementById('lessonTitle');if(lt)lt.value=l.title||'';
    const ltp=document.getElementById('lessonTopic');if(ltp)ltp.value=l.topic||'';
    // تعبئة المحرر الغني
    const _leditor=document.getElementById('lessonTopicEditor');
    if(_leditor){
      _leditor.innerHTML=l.topic||'';
      // إعادة ضبط العدّاد
      if(typeof clearTimeout!=='undefined' && typeof _urlConvertTimer!=='undefined') clearTimeout(_urlConvertTimer);
    }
    const lft=document.getElementById('lessonFormTitle');if(lft)lft.textContent='✏️ تعديل الدرس';
    const lsb=document.getElementById('lessonSaveBtn');if(lsb)lsb.textContent='💾 تعديل';
    await loadMeetingsForSelect('lessonLinkMeeting');
    await loadHwForSelect('lessonLinkHw');
    if(l.linkedMeeting){const s=document.getElementById('lessonLinkMeeting');if(s)s.value=l.linkedMeeting;}
    if(l.linkedHw){const s=document.getElementById('lessonLinkHw');if(s)s.value=l.linkedHw;}
    // Restore YouTube URL
    const ytUrl=l.youtubeUrl||(l.videoSource==='youtube'?l.videoUrl:'');
    if(ytUrl){ document.getElementById('ytUrlSection').style.display='block'; document.getElementById('ytSourceBtn')?.classList.add('active'); const y=document.getElementById('lessonYtUrl');if(y)y.value=ytUrl; }
    // Restore uploaded video indication
    const upUrl=l.uploadedVideoUrl||(l.videoSource==='upload'?l.videoUrl:'');
    if(upUrl){ document.getElementById('uploadVideoSection').style.display='block'; document.getElementById('uploadSourceBtn')?.classList.add('active'); setFilePickerName('video','(الفيديو المحفوظ)'); }
    // Restore PDF
    if(l.pdfUrl){ const ps=document.getElementById('pdfSourceSection');if(ps)ps.style.display='block'; document.getElementById('pdfSourceBtn')?.classList.add('active'); setFilePickerName('pdf','(الملف المحفوظ)'); }
    // إظهار زر الإخفاء فقط عند التعديل
    const hideWrap=document.getElementById('lessonHideToggleWrap');
    if(hideWrap) hideWrap.style.display='block';
    const hideBtn=document.getElementById('lessonHideBtn');
    if(hideBtn) {
      if(_editingLessonHidden) {
        hideBtn.className='lesson-hide-btn hidden-active';
        hideBtn.textContent='👁 إظهار الدرس';
      } else {
        hideBtn.className='lesson-hide-btn';
        hideBtn.textContent='🙈 إخفاء الدرس';
      }
    }
  },150);
}
async function deleteLesson(id) {
  // ── فحص صلاحية: المدير فقط يملك حق الحذف ──
  if (!Auth.currentUser || Auth.currentUser.role !== 'admin') {
    UI.toast('⛔ هذه العملية للمدير فقط', 'error', 3000);
    return;
  }

  if (!await UI.confirm(
    'حذف هذا الدرس؟\nسيتم حذف ملفات الـ PDF والفيديو نهائياً من التخزين.',
    'حذف الدرس'
  )) return;

  UI.toast('⏳ جاري حذف الدرس وملفاته...', 'info', 4000);

  try {
    // ── الخطوة 1: جلب بيانات الدرس لاستخراج روابط الملفات ──
    const lesson = await GharsDB.get('lessons/' + id);

    // ── الخطوة 2: حذف الملفات من Supabase Storage أولاً ──
    if (lesson) {
      await _deleteLessonStorageFiles(lesson);
    }

    // ── الخطوة 3: حذف سجل الدرس من قاعدة البيانات ──
    if (_sbOK && _sb) {
      await _sb.from('ghars_data')
        .delete()
        .eq('collection', 'lessons')
        .eq('doc_id', id);

      // حذف الإشعارات المرتبطة بهذا الدرس
      try {
        const notifR = await _sb.from('ghars_data')
          .select('doc_id')
          .eq('collection', 'notifications')
          .filter('data->>lessonId', 'eq', id);
        if (!notifR.error && notifR.data && notifR.data.length) {
          for (const r of notifR.data) {
            await _sb.from('ghars_data')
              .delete()
              .eq('collection', 'notifications')
              .eq('doc_id', r.doc_id);
          }
        }
      } catch(_) {}
    }

    // ── الخطوة 4: تنظيف التخزين المحلي ──
    _purgeByPrefix('__lessons__' + id);
    _purgeByPrefix('__notifications__');
    GharsDB._invalidate('lessons');
    GharsDB._invalidate('notifications');

    UI.toast('✅ تم حذف الدرس وملفاته نهائياً', 'success', 3000);
    loadSeerah();

  } catch(e) {
    console.error('deleteLesson error:', e);
    UI.toast('❌ حدث خطأ أثناء الحذف — تحقق من الاتصال', 'error', 4000);
  }
}
async function confirmClearLessons() {
  // ── فحص صلاحية: المدير فقط ──
  if (!Auth.currentUser || Auth.currentUser.role !== 'admin') {
    UI.toast('⛔ هذه العملية للمدير فقط', 'error', 3000);
    return;
  }

  if (!await UI.confirm(
    '🗑 سيتم حذف جميع الدروس وملفات الـ PDF والفيديو نهائياً من التخزين.\nهذا الإجراء لا يمكن التراجع عنه. متابعة؟',
    'حذف جميع الدروس'
  )) return;

  UI.toast('⏳ جاري حذف جميع الدروس وملفاتها...', 'info', 8000);

  try {
    if (_sbOK && _sb) {
      // ── الخطوة 1: جلب بيانات جميع الدروس لاستخراج روابط الملفات ──
      const { data: lessonsRows, error: fetchErr } = await _sb
        .from('ghars_data')
        .select('data')
        .eq('collection', 'lessons')
        .range(0, 9999);

      // ── الخطوة 2: حذف جميع الملفات من Storage دفعةً واحدة ──
      if (!fetchErr && lessonsRows && lessonsRows.length > 0) {
        const allLessons = lessonsRows.map(function(row) { return row.data; }).filter(Boolean);
        await _deleteLessonStorageFiles(allLessons);
      }

      // ── الخطوة 3: حذف جميع سجلات الدروس من قاعدة البيانات ──
      await _sb.from('ghars_data')
        .delete()
        .eq('collection', 'lessons')
        .neq('doc_id', '__placeholder__');

      // حذف الإشعارات المرتبطة
      try {
        await _sb.from('ghars_data')
          .delete()
          .eq('collection', 'notifications')
          .neq('doc_id', '__placeholder__');
      } catch(_) {}
    }

    // ── الخطوة 4: تنظيف التخزين المحلي ──
    _purgeByPrefix('__lessons__');
    _purgeByPrefix('__notifications__');
    GharsDB._invalidate('lessons');
    GharsDB._invalidate('notifications');
    GharsDB._invalidate('points_summary');

    UI.toast('✅ تم حذف جميع الدروس وملفاتها نهائياً', 'success', 3000);
    loadSeerah();

  } catch(e) {
    console.error('confirmClearLessons error:', e);
    UI.toast('❌ حدث خطأ — تحقق من الاتصال وحاول مجدداً', 'error', 4000);
  }
}
async function viewLessonViewers(id) {
  const [lesson,users]=await Promise.all([GharsDB.get('lessons/'+id),GharsDB.getAll('users')]);
  // Filter viewers to only registered users
  const allViewers=lesson?.viewers||[];
  const viewers=allViewers.filter(v=>users[v.studentId]&&!users[v.studentId].deleted);
  UI.showModal(`<div class="modal" style="max-width:380px">
    <div class="modal-header"><h3>👥 المشاهدون (${viewers.length})</h3><button class="modal-close">✖</button></div>
    <div class="modal-body">${viewers.length?viewers.map(v=>`
      <div class="student-row">
        <div class="seen-avatar">${(users[v.studentId]?.name||'?').charAt(0)}</div>
        <div style="flex:1"><div class="student-name">${e(users[v.studentId]?.name||'')}</div>
        <div style="font-size:0.73rem;color:var(--gray)">${GharsUtils.toHijriShort(new Date(v.at))} · ${GharsUtils.formatTime(new Date(v.at))}</div></div>
        <span style="font-size:0.72rem;color:var(--gold);font-weight:700">${timeAgo(new Date(v.at))}</span>
      </div>`).join('<div style="height:1px;background:var(--gray-mid);margin:4px 0"></div>'):noData('👁','لم يشاهد أحد')}</div>
    <div class="modal-footer"><button class="btn btn-gray" data-close-modal>إغلاق</button></div>
  </div>`);
}
// عرض التعليقات كصفحة كاملة
let _currentCommentsLessonId = null;

async function viewLessonComments(id) {
  _currentCommentsLessonId = id;
  localStorage.setItem('ghars__currentCommentsLessonId', id);
  const lesson = await GharsDB.get('lessons/' + id);
  const titleEl = document.getElementById('commentsPageTitle');
  if (titleEl) titleEl.textContent = `💬 التعليقات — ${lesson?.title || ''}`;
  navigate('lesson-comments');
  await loadCommentsPage(id);
  _updateCommentsToggleBtn(!!lesson?.commentsLocked);
}

function _updateCommentsToggleBtn(locked) {
  const btn = document.getElementById('commentsToggleBtn');
  if (!btn) return;
  if (locked) {
    btn.style.background = 'linear-gradient(135deg,#e53e3e,#c53030)';
    btn.style.color = '#fff';
    btn.style.boxShadow = '0 3px 10px rgba(229,62,62,0.4)';
    btn.innerHTML = '<span style="width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,0.4);display:inline-block"></span> <span style="color:#fed7d7">الدردشة</span> <span style="font-weight:900">مغلقة</span>';
  } else {
    btn.style.background = 'linear-gradient(135deg,#38a169,#276749)';
    btn.style.color = '#fff';
    btn.style.boxShadow = '0 3px 10px rgba(56,161,105,0.4)';
    btn.innerHTML = '<span style="width:9px;height:9px;border-radius:50%;background:#fff;display:inline-block;box-shadow:0 0 6px rgba(255,255,255,0.8)"></span> <span style="color:#c6f6d5">الدردشة</span> <span style="font-weight:900">مفعّلة</span>';
  }
}

async function toggleCurrentLessonComments() {
  if (!_currentCommentsLessonId) return;
  const l = await GharsDB.get('lessons/'+_currentCommentsLessonId);
  if (!l) return;
  const newLocked = !l.commentsLocked;
  await GharsDB.set('lessons/'+_currentCommentsLessonId, {...l, commentsLocked: newLocked});
  GharsDB._invalidate('lessons');
  _updateCommentsToggleBtn(newLocked);
  UI.toast(newLocked ? '🔴 تم إيقاف التعليقات' : '🟢 تم تفعيل التعليقات للطلاب','success',3000);
}

async function loadCommentsPage(lessonId) {
  const [lesson, users] = await Promise.all([GharsDB.get('lessons/' + lessonId), GharsDB.getAll('users')]);
  const cont = document.getElementById('commentsPageContent');
  if (!cont) return;
  const comments = (lesson?.comments || []).filter(c => c && c.text && c.at);
  if (!comments.length) {
    cont.innerHTML = `<div style="text-align:center;padding:40px 20px;background:linear-gradient(145deg,#0e1b30,#0a1425);border-radius:16px;border:1.5px solid rgba(201,162,39,0.2)">
      <div style="font-size:3.5rem;opacity:0.2;margin-bottom:10px">💬</div>
      <div style="color:rgba(201,162,39,0.6);font-size:0.88rem;font-weight:700">لا توجد تعليقات بعد</div>
    </div>`;
    return;
  }

  function isTeacherC(c) { return !!(c.isTeacherReply||c.role==='teacher'||c.role==='admin'); }
  function getName(c) { return (c.authorName&&c.authorName.trim()) ? c.authorName.trim() : (c.studentId&&users[c.studentId]?users[c.studentId].name:'طالب'); }

  const groups = [];
  let idx = 0;
  while (idx < comments.length) {
    const c = comments[idx];
    if (!isTeacherC(c)) {
      const next = comments[idx+1];
      if (next && isTeacherC(next)) {
        groups.push({ student:c, teacher:next, sIdx:idx, tIdx:idx+1, hasReply:true });
        idx += 2;
      } else {
        groups.push({ student:c, teacher:null, sIdx:idx, hasReply:false });
        idx++;
      }
    } else {
      groups.push({ student:null, teacher:c, tIdx:idx, hasReply:false });
      idx++;
    }
  }
  groups.reverse();

  const myId = Auth.currentUser?.id;

  // ── ثيمات موحدة للتعليقات المجمّعة (نفس درجة اللون) ──
  const TH_STU_PLAIN   = { bg:'linear-gradient(145deg,#1a2a4a,#0f1e38)', hdr:'linear-gradient(135deg,rgba(201,162,39,0.15),rgba(160,125,16,0.08))', bdr:'1.5px solid rgba(201,162,39,0.3)', tbg:'rgba(255,255,255,0.02)', fbg:'rgba(201,162,39,0.05)', nc:'#e8c84a', tc:'#ddd5bb', ti:'rgba(201,162,39,0.55)', avBg:'linear-gradient(135deg,rgba(201,162,39,0.22),rgba(160,125,16,0.14))', avCl:'#c9a227' };
  // الطالب في الإطار المشترك — نفس خلفية المعلم تقريباً (درجة ذهبية داكنة)
  const TH_STU_GROUPED = { bg:'linear-gradient(145deg,#12213a,#0e1c32)', hdr:'linear-gradient(135deg,rgba(201,162,39,0.18),rgba(160,125,16,0.10))', bdr:'none', tbg:'rgba(201,162,39,0.03)', fbg:'rgba(201,162,39,0.06)', nc:'#e8c84a', tc:'#ddd5bb', ti:'rgba(201,162,39,0.55)', avBg:'linear-gradient(135deg,rgba(201,162,39,0.22),rgba(160,125,16,0.14))', avCl:'#c9a227' };
  // المعلم في الإطار المشترك — نفس درجة اللون مع تمييز خفيف
  const TH_TCH_GROUPED = { bg:'linear-gradient(145deg,#0f1e0f,#162416)', hdr:'linear-gradient(135deg,rgba(201,162,39,0.22),rgba(160,125,16,0.14))', bdr:'none', tbg:'rgba(201,162,39,0.05)', fbg:'rgba(201,162,39,0.09)', nc:'#ffd700', tc:'#f0e8cc', ti:'rgba(255,215,0,0.65)', avBg:'linear-gradient(135deg,#c9a227,#a07d10)', avCl:'#0a1628' };
  const TH_TCH_SOLO    = { bg:'linear-gradient(145deg,#0d1a0d,#1a2e0d)', hdr:'linear-gradient(135deg,rgba(201,162,39,0.32),rgba(160,125,16,0.22))', bdr:'2px solid rgba(201,162,39,0.65)', tbg:'rgba(201,162,39,0.07)', fbg:'rgba(201,162,39,0.1)', nc:'#ffd700', tc:'#f0e6c0', ti:'rgba(255,215,0,0.7)', avBg:'linear-gradient(135deg,#c9a227,#a07d10)', avCl:'#0a1628' };

  function renderCard(c, realIdx, th, isTeacher) {
    const name = getName(c);
    const likes = c.likes||[];
    const iLiked = likes.includes(myId);
    const avUrl = (c.studentId&&users[c.studentId]?.avatarUrl) ? users[c.studentId].avatarUrl : null;
    const avStyle = avUrl ? `background-image:url('${avUrl}');background-size:cover;background-position:center;color:transparent;cursor:pointer` : `background:${th.avBg}`;
    const avContent = avUrl ? '' : `<span style="color:${th.avCl};font-weight:900;font-size:1rem">${e(name.charAt(0).toUpperCase())}</span>`;
    const avClick = avUrl ? `onclick="showUserAvatar('${e(avUrl)}',false)"` : '';
    const safeN = name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const safeText = (c.text||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n');
    // الضغط المطول — المعلم على تعليقاته فقط وخلال ساعتين
    const cmtAge = Date.now() - new Date(c.at).getTime();
    const canEditCmt = isTeacher && cmtAge < 2 * 60 * 60 * 1000;
    const lpAttrs = canEditCmt ? `ontouchstart="_tCmtLP(event,'${lessonId}',${realIdx},'${safeText}')"
       ontouchend="_tCmtLPCancel()" ontouchcancel="_tCmtLPCancel()"
       onmousedown="_tCmtLP(event,'${lessonId}',${realIdx},'${safeText}')"
       onmouseup="_tCmtLPCancel()" onmouseleave="_tCmtLPCancel()"` : '';
    return `<div style="background:${th.bg}" ${lpAttrs}>
      <div style="background:${th.hdr};padding:10px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(201,162,39,0.12)">
        <div style="width:36px;height:36px;border-radius:50%;${avStyle};flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.4);border:1.5px solid rgba(255,255,255,0.1)" ${avClick}>${avContent}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span onclick="teacherReplyTo('${safeN}','${lessonId}')" style="font-weight:800;font-size:0.87rem;color:${th.nc};cursor:pointer;text-decoration:underline dotted rgba(201,162,39,0.35)">${e(name)}</span>
            ${isTeacher ? `<span style="background:rgba(201,162,39,0.2);border:1px solid rgba(201,162,39,0.5);border-radius:10px;padding:1px 7px;font-size:0.62rem;font-weight:800;color:#ffd700">&#x1F468;&#x200D;&#x1F3EB; معلم</span>` : ''}
          </div>
          <div style="font-size:0.66rem;color:${th.ti};margin-top:1px">${timeAgo(new Date(c.at))}</div>
        </div>
      </div>
      <div style="background:${th.tbg};padding:11px 14px;font-size:0.86rem;line-height:1.85;color:${th.tc};white-space:pre-wrap;word-break:break-word">${e(c.text)}</div>
      <div style="background:${th.fbg};padding:5px 14px 7px;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:0.66rem;color:${th.ti}">🕐 ${GharsUtils.toHijriShort(new Date(c.at))} · ${GharsUtils.formatTime(new Date(c.at))}</span>
        <button onclick="teacherLikeComment('${lessonId}',${realIdx},this)"
          class="ghars-like-btn${iLiked?' liked':''}"
          style="background:${iLiked?'rgba(201,162,39,0.22)':'rgba(201,162,39,0.06)'};border:1px solid ${iLiked?'rgba(201,162,39,0.5)':'rgba(201,162,39,0.18)'};border-radius:20px;padding:3px 11px;cursor:pointer;font-size:0.75rem;font-weight:800;color:${iLiked?'#ffd700':'rgba(201,162,39,0.5)'};display:flex;align-items:center;gap:4px;transition:all 0.25s ease">
          <span class="like-icon" style="display:inline-block;transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1)">${iLiked?'❤️':'🤍'}</span>
          <span class="like-count">${likes.length||''}</span>
        </button>
      </div>
    </div>`;
  }

  const html = groups.map((g, gi) => {
    const delay = `${gi*0.04}s`;
    if (g.hasReply && g.student && g.teacher) {
      // ── إطار موحّد — نفس درجة اللون الذهبي بلا فاصل ──
      return `<div style="
          border-radius:18px;overflow:hidden;
          border:1.5px solid rgba(201,162,39,0.55);
          background:linear-gradient(145deg,#0e1b30,#0a1425);
          box-shadow:0 6px 28px rgba(201,162,39,0.14),0 2px 8px rgba(0,0,0,0.4);
          animation:fadeInUp 0.35s ${delay} both ease">
        ${renderCard(g.student, g.sIdx, TH_STU_GROUPED, false)}
        <!-- مسافة بسيطة بدلاً من فاصل -->
        <div style="height:1px;background:rgba(201,162,39,0.18);margin:0 16px"></div>
        <div style="position:relative;padding-top:2px">
          <div style="position:absolute;top:-8px;right:16px;z-index:2;
            background:rgba(10,22,40,0.95);
            border:1px solid rgba(201,162,39,0.4);
            border-radius:14px;padding:1px 10px;
            font-size:0.58rem;font-weight:800;color:rgba(201,162,39,0.85);
            white-space:nowrap">↩ ردّ المعلم</div>
          ${renderCard(g.teacher, g.tIdx, TH_TCH_GROUPED, true)}
        </div>
      </div>`;
    } else if (g.student) {
      return `<div style="border-radius:14px;overflow:hidden;border:${TH_STU_PLAIN.bdr};box-shadow:0 2px 10px rgba(0,0,0,0.3);animation:fadeInUp 0.3s ${delay} both ease">${renderCard(g.student, g.sIdx, TH_STU_PLAIN, false)}</div>`;
    } else {
      return `<div style="border-radius:14px;overflow:hidden;border:${TH_TCH_SOLO.bdr};box-shadow:0 4px 20px rgba(201,162,39,0.18);animation:fadeInUp 0.3s ${delay} both ease">${renderCard(g.teacher, g.tIdx, TH_TCH_SOLO, true)}</div>`;
    }
  }).join('');

  cont.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${html}</div>`;
}

// ── ضغط مطوّل على التعليق في صفحة المعلم ──
let _tCmtLPTimer = null;
function _tCmtLP(ev, lessonId, idx, text) {
  _tCmtLPTimer = setTimeout(() => {
    _tCmtLPTimer = null;
    showTeacherCommentOptions(lessonId, idx, text);
  }, 600);
}
function _tCmtLPCancel() {
  if (_tCmtLPTimer) { clearTimeout(_tCmtLPTimer); _tCmtLPTimer = null; }
}

function showTeacherCommentOptions(lessonId, idx, text) {
  UI.showModal(`<div class="modal" style="max-width:280px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">خيارات التعليق</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:12px;display:flex;flex-direction:column;gap:8px">
      <button onclick="this.closest('.modal-overlay').remove();teacherEditComment('${lessonId}',${idx},'${e((text||'').replace(/'/g,"\\'").replace(/\n/g,'\\n'))}')"
        style="background:#f0f4ff;border:1px solid #c3d0f5;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#1a3a6b;display:flex;align-items:center;gap:8px">
        ✏️ تعديل التعليق
      </button>
      <button onclick="this.closest('.modal-overlay').remove();teacherDeleteComment('${lessonId}',${idx})"
        style="background:#fff5f5;border:1px solid #fcd0d0;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#c53030;display:flex;align-items:center;gap:8px">
        🗑️ حذف التعليق
      </button>
    </div>
  </div>`);
}

async function teacherDeleteComment(lessonId, idx) {
  if (!await UI.confirm('حذف هذا التعليق نهائياً؟','حذف التعليق')) return;
  const lesson = await GharsDB.get('lessons/'+lessonId);
  if (!lesson) return;
  const comments = [...(lesson.comments||[])];
  comments.splice(idx, 1);
  await GharsDB.set('lessons/'+lessonId, {...lesson, comments});
  UI.toast('🗑️ تم حذف التعليق','info',2000);
  await loadCommentsPage(lessonId);
}

function teacherEditComment(lessonId, idx, currentText) {
  const decoded = (currentText||'').replace(/\\n/g,'\n');
  UI.showModal(`<div class="modal" style="max-width:380px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">✏️ تعديل التعليق</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:14px">
      <textarea id="teacherEditCmtBox" rows="4"
        style="width:100%;border:2px solid rgba(201,162,39,0.4);border-radius:10px;padding:10px 12px;font-family:Tajawal,sans-serif;font-size:0.88rem;resize:none;direction:rtl;outline:none;background:#f8fafc;color:#0a1628">${e(decoded)}</textarea>
    </div>
    <div class="modal-footer" style="gap:8px">
      <button class="btn btn-primary" onclick="saveTeacherEditComment('${lessonId}',${idx})">💾 تعديل</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}

async function saveTeacherEditComment(lessonId, idx) {
  const text = document.getElementById('teacherEditCmtBox')?.value?.trim();
  if (!text) { UI.toast('يرجى كتابة التعليق','error'); return; }
  const lesson = await GharsDB.get('lessons/'+lessonId);
  if (!lesson) return;
  const comments = [...(lesson.comments||[])];
  if (!comments[idx]) return;
  comments[idx] = {...comments[idx], text, editedAt: new Date().toISOString()};
  await GharsDB.set('lessons/'+lessonId, {...lesson, comments});
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('✅ تم تعديل التعليق','success',2000);
  await loadCommentsPage(lessonId);
}

function teacherReplyTo(name, lessonId) {
  const box = document.getElementById('teacherReplyBox');
  if (!box) return;
  const mention = `@${name}: `;
  box.value = mention + box.value.replace(/^@[^:]+: /, '');
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
  const card = document.getElementById('teacherReplyCard');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  box.style.borderColor = 'rgba(201,162,39,0.9)';
  box.style.boxShadow = '0 0 0 3px rgba(201,162,39,0.2)';
  setTimeout(() => { box.style.borderColor = ''; box.style.boxShadow = ''; }, 1500);
  UI.toast(`✍️ الرد على ${name}`, 'info', 1800);
}
async function teacherLikeComment(lessonId, commentIndex, btnEl) {
  const uid = Auth.currentUser?.id;
  if (!uid) return;

  // ── تحديث فوري (optimistic) ──
  if (btnEl) {
    const icon = btnEl.querySelector('.like-icon');
    const countEl = btnEl.querySelector('.like-count');
    const isLikedNow = btnEl.classList.contains('liked');
    const curCount = parseInt(countEl?.textContent || '0') || 0;
    if (!isLikedNow) {
      btnEl.classList.add('liked');
      btnEl.style.background = 'rgba(201,162,39,0.22)';
      btnEl.style.borderColor = 'rgba(201,162,39,0.5)';
      btnEl.style.color = '#ffd700';
      if (icon) { icon.textContent = '❤️'; icon.style.transform = 'scale(1.5)'; setTimeout(()=>{ icon.style.transform='scale(1)'; },300); }
      if (countEl) countEl.textContent = curCount + 1 || 1;
      _spawnLikeParticles(btnEl);
    } else {
      btnEl.classList.remove('liked');
      btnEl.style.background = 'rgba(201,162,39,0.06)';
      btnEl.style.borderColor = 'rgba(201,162,39,0.2)';
      btnEl.style.color = 'rgba(201,162,39,0.55)';
      if (icon) { icon.textContent = '🤍'; icon.style.transform = 'scale(0.8)'; setTimeout(()=>{ icon.style.transform='scale(1)'; },200); }
      if (countEl) countEl.textContent = Math.max(0, curCount - 1) || '';
    }
    btnEl.disabled = true;
  }

  try {
    const lesson = await GharsDB.get('lessons/' + lessonId);
    if (!lesson) return;
    const comments = [...(lesson.comments || [])];
    if (!comments[commentIndex]) return;
    const likes = [...(comments[commentIndex].likes || [])];
    const idx = likes.indexOf(uid);
    if (idx === -1) likes.push(uid);
    else likes.splice(idx, 1);
    comments[commentIndex] = { ...comments[commentIndex], likes };
    await GharsDB.set('lessons/' + lessonId, { ...lesson, comments });
  } catch(e) { console.warn('teacherLikeComment:', e); }
  finally { if (btnEl) btnEl.disabled = false; }
}

// ── جزيئات الإعجاب (مشتركة) ──
function _spawnLikeParticles(btn) {
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['#ffd700','#c9a227','#ff6b6b','#ff9f43','#ee5a24','#a29bfe'];
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    const angle = (i / 8) * 360;
    const dist = 30 + Math.random() * 20;
    const dx = Math.cos(angle * Math.PI / 180) * dist;
    const dy = Math.sin(angle * Math.PI / 180) * dist;
    p.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:6px;height:6px;border-radius:50%;background:${colors[i%colors.length]};pointer-events:none;z-index:9999;transform:translate(-50%,-50%);transition:transform 0.5s ease-out,opacity 0.5s ease-out`;
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 520);
  }
}

async function sendTeacherReply() {
  const box = document.getElementById('teacherReplyBox');
  const text = box?.value?.trim();
  if (!text) { UI.toast('يرجى كتابة الرد', 'error'); return; }
  if (text.length > 2000) { UI.toast('الرد طويل جداً (الحد الأقصى 2000 حرف)', 'error'); return; }
  const lessonId = _currentCommentsLessonId;
  if (!lessonId) return;
  const lesson = await GharsDB.get('lessons/' + lessonId);
  if (!lesson) return;
  // المعلم يستطيع الرد حتى لو كانت التعليقات مغلقة
  const mentionMatch = text.match(/^@([^:]+):/);
  const mentionedName = mentionMatch ? mentionMatch[1].trim() : null;
  const reply = {
    studentId: Auth.currentUser?.id,
    authorName: Auth.currentUser?.name || 'معلم',
    text,
    at: new Date().toISOString(),
    isTeacherReply: true,
    role: Auth.currentUser?.role || 'teacher',
    likes: []
  };
  const comments = [...(lesson.comments || []), reply];
  const replyIndex = comments.length - 1;
  await GharsDB.set('lessons/' + lessonId, { ...lesson, comments });
  // إرسال إشعارات
  if (mentionedName) {
    try {
      const allUsers = await GharsDB.getAll('users');
      const targetStudent = Object.values(allUsers).find(u => u.role==='student' && !u.deleted && u.name.trim().toLowerCase()===mentionedName.toLowerCase());
      if (targetStudent) {
        const notifId = GharsUtils.uid();
        await GharsDB.set('notifications/'+notifId, { id:notifId, type:'teacher_reply', studentId:targetStudent.id, lessonId, lessonTitle:lesson.title||'درس السيرة', teacherName:Auth.currentUser?.name||'معلم', replyText:text.replace(/^@[^:]+:\s*/,'').slice(0,80), commentIndex:replyIndex, read:false, at:new Date().toISOString() });
      }
    } catch(e) {}
  } else {
    try {
      const commenters=[...new Set((lesson.comments||[]).filter(c=>c.studentId&&!(c.isTeacherReply||c.role==='teacher'||c.role==='admin')).map(c=>c.studentId))];
      for(const sid of commenters) {
        const notifId=GharsUtils.uid();
        await GharsDB.set('notifications/'+notifId, { id:notifId, type:'teacher_reply', studentId:sid, lessonId, lessonTitle:lesson.title||'درس السيرة', teacherName:Auth.currentUser?.name||'معلم', replyText:text.slice(0,80), commentIndex:replyIndex, read:false, at:new Date().toISOString() });
      }
    } catch(e) {}
  }
  if (box) box.value = '';
  UI.toast('✅ تم إرسال الرد', 'success', 2000);
  await loadCommentsPage(lessonId);
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

// ============================================================
// TEACHER SHARE BOX — صندوق المشاركات
// ============================================================
let _currentShareChatStudentId = null;

async function openTeacherShareBox() {
  _currentShareChatStudentId = null;
  navigate('teacher-sharebox');
  await loadTeacherShareBox();
}

async function loadTeacherShareBox() {
  const cont = document.getElementById('teacherShareBoxContent');
  if (!cont) return;
  const [users, allPosts, settingsRaw] = await Promise.all([
    GharsDB.getAll('users'),
    GharsDB.getAll('share_posts'),
    GharsDB.get('system/settings')
  ]);
  const sett = settingsRaw || {};
  const chatEnabled = sett.shareBoxEnabled !== false;
  const students = Object.values(users).filter(u => u.role==='student' && !u.deleted);

  // آخر رسالة وعدد الرسائل لكل طالب
  const postsByStudent = {};
  const lastPostByStudent = {};
  Object.values(allPosts).forEach(p => {
    if (p && p.studentId) {
      if (!postsByStudent[p.studentId]) postsByStudent[p.studentId] = 0;
      postsByStudent[p.studentId]++;
      if (!lastPostByStudent[p.studentId] || new Date(p.at) > new Date(lastPostByStudent[p.studentId].at)) {
        lastPostByStudent[p.studentId] = p;
      }
    }
  });

  const readMap = JSON.parse(localStorage.getItem('ghars__chatRead')||'{}');

  // ── ترتيب WhatsApp: الطلاب الذين أرسلوا رسالة مؤخراً يظهرون أعلى ──
  const studentsWithPosts  = students.filter(s => lastPostByStudent[s.id])
    .sort((a,b) => new Date(lastPostByStudent[b.id].at) - new Date(lastPostByStudent[a.id].at));
  const studentsWithoutPosts = students.filter(s => !lastPostByStudent[s.id]);
  const sortedStudents = [...studentsWithPosts, ...studentsWithoutPosts];

  const studentsHtml = sortedStudents.length
    ? sortedStudents.map((s,i) => {
        const cnt = postsByStudent[s.id] || 0;
        const lastPost = lastPostByStudent[s.id];
        const lastText = lastPost ? (lastPost.text.length > 40 ? lastPost.text.slice(0,40)+'...' : lastPost.text) : '';
        const lastTime = lastPost ? GharsUtils.timeAgo(lastPost.at) : '';
        const readTime = readMap[s.id] || 0;
        const hasUnread = lastPost && new Date(lastPost.at).getTime() > readTime;
        const _sbAvUrl = s.avatarUrl || null;
        const _sbAvHtml = _sbAvUrl
          ? `<div style="width:44px;height:44px;border-radius:50%;background-image:url('${_sbAvUrl}');background-size:cover;background-position:center;flex-shrink:0;border:2.5px solid rgba(201,162,39,0.5);box-shadow:0 2px 8px rgba(0,0,0,0.15)"></div>`
          : `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#c9a227,#a07d10);display:flex;align-items:center;justify-content:center;font-weight:800;color:#0a1628;font-size:1.1rem;flex-shrink:0">${e(s.name.charAt(0))}</div>`;
        return `<div onclick="openStudentShareChat('${s.id}')"
          style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid var(--gray-mid);margin-bottom:8px;cursor:pointer;animation:fadeInUp 0.3s ${i*0.04}s both ease;transition:background 0.2s,box-shadow 0.2s;box-shadow:0 2px 6px rgba(0,0,0,0.05)"
          onmouseover="this.style.background='#f8fafc';this.style.boxShadow='0 4px 14px rgba(0,0,0,0.1)'"
          onmouseout="this.style.background='#fff';this.style.boxShadow='0 2px 6px rgba(0,0,0,0.05)'">
          ${_sbAvHtml}
          <div style="flex:1;min-width:0">
            <div style="font-weight:${hasUnread?'800':'700'};font-size:0.9rem;color:var(--navy);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(s.name)}</div>
            ${lastText ? `<div style="font-size:0.72rem;color:var(--gray);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${hasUnread?'700':'400'}">${e(lastText)}</div>` : `<div style="font-size:0.72rem;color:var(--gray);margin-top:2px">لا توجد رسائل</div>`}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
            ${lastTime ? `<div style="font-size:0.62rem;color:var(--gray)">${lastTime}</div>` : ''}
            ${hasUnread && cnt ? `<span style="background:linear-gradient(135deg,#c9a227,#a07d10);color:#0a1628;border-radius:20px;padding:2px 9px;font-size:0.72rem;font-weight:800;min-width:22px;text-align:center">${cnt}</span>` : ''}
          </div>
        </div>`;
      }).join('')
    : `<div style="text-align:center;padding:24px;opacity:0.5;color:var(--gray);font-size:0.85rem"><div style="font-size:2.5rem;margin-bottom:8px">👥</div>لا يوجد طلاب</div>`;

  // زر تفعيل/تعطيل الدردشة محسّن
  const chatToggleBtn = chatEnabled
    ? `<button onclick="toggleShareBoxChat()" style="background:linear-gradient(135deg,#38a169,#276749);color:#fff;border:none;border-radius:12px;padding:9px 16px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 3px 10px rgba(56,161,105,0.4)">
        <span style="width:9px;height:9px;border-radius:50%;background:#fff;display:inline-block;box-shadow:0 0 6px rgba(255,255,255,0.8)"></span>
        <span style="color:#c6f6d5">الدردشة</span> <span style="color:#fff;font-weight:900">مفعّلة</span>
      </button>`
    : `<button onclick="toggleShareBoxChat()" style="background:linear-gradient(135deg,#e53e3e,#c53030);color:#fff;border:none;border-radius:12px;padding:9px 16px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 3px 10px rgba(229,62,62,0.4)">
        <span style="width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,0.5);display:inline-block"></span>
        <span style="color:#fed7d7">الدردشة</span> <span style="color:#fff;font-weight:900">مغلقة</span>
      </button>`;

  cont.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <button onclick="viewAllSharePosts()" style="background:linear-gradient(135deg,#0a1628,#1a3a6b);color:#c9a227;border:1.5px solid rgba(201,162,39,0.5);border-radius:12px;padding:9px 16px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px">
        👁 مشاهدة الكل
      </button>
      ${chatToggleBtn}
      <button onclick="deleteAllSharePosts()" style="background:#f7fafc;color:#a0aec0;border:1px solid #e2e8f0;border-radius:12px;padding:9px 16px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px">
        🗑 حذف الكل
      </button>
    </div>
    <div style="background:#fff;border-radius:16px;padding:14px;border:1px solid var(--gray-mid);box-shadow:0 2px 8px rgba(0,0,0,0.05)">
      <div style="font-weight:800;font-size:0.88rem;color:var(--navy);margin-bottom:12px;display:flex;align-items:center;gap:6px">👥 محادثات الطلاب</div>
      ${studentsHtml}
    </div>`;

  // تنظيف تلقائي كل 100 ساعة
  _autoCleanAllSharePosts();
}

async function toggleShareBoxChat() {
  const settings = await GharsDB.get('system/settings') || {};
  const newEnabled = !(settings.shareBoxEnabled !== false);
  await GharsDB.set('system/settings', {...settings, shareBoxEnabled: newEnabled});
  UI.toast(newEnabled ? '🟢 تم تفعيل الدردشة للطلاب' : '🔴 تم تعطيل الدردشة', newEnabled ? 'success' : 'warning', 3000);
  await loadTeacherShareBox();
}

async function deleteAllSharePosts() {
  if (!await UI.confirm('حذف جميع المشاركات من جميع الطلاب؟', 'حذف الكل')) return;
  const allPosts = await GharsDB.getAll('share_posts');
  for (const p of Object.values(allPosts)) {
    if (p && p.id) {
      await GharsDB.delete('share_posts/'+p.id);
      if (_sbOK && _sb) {
        try { await _sb.from('ghars_data').delete().eq('collection','share_posts').eq('doc_id',p.id); } catch(_){}
      }
    }
  }
  GharsDB._invalidate('share_posts');
  UI.toast('✅ تم حذف جميع المشاركات', 'success');
  await loadTeacherShareBox();
}

async function viewAllSharePosts() {
  navigate('teacher-all-posts');
  await loadAllSharePostsPage();
}

async function loadAllSharePostsPage() {
  const cont = document.getElementById('allPostsContent');
  if (!cont) return;

  // شاشة تحميل
  cont.innerHTML = `<div class="section-loading"><span class="loader"></span> جاري التحميل...</div>`;

  const [rawPosts, users] = await Promise.all([
    GharsDB.getAll('share_posts'),
    GharsDB.getAll('users')
  ]);

  // فقط رسائل الطلاب (بدون ردود المعلم)
  const studentPosts = Object.values(rawPosts)
    .filter(p => p && p.text && p.studentId && !p.isTeacherReply)
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  // لا توجد رسائل — مُوسَّط في المساحة المتاحة
  if (!studentPosts.length) {
    cont.innerHTML = `
      <div style="
        flex:1;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        min-height:50vh;
        gap:14px;
        padding:40px 20px;
        text-align:center">
        <div style="font-size:4.5rem;line-height:1;opacity:0.55">📭</div>
        <div style="font-weight:800;font-size:1.05rem;color:var(--navy)">لا توجد رسائل</div>
        <div style="font-size:0.84rem;color:var(--gray);max-width:200px;line-height:1.7">لم يرسل أي طالب مشاركة بعد</div>
      </div>`;
    return;
  }

  // تجميع الرسائل حسب الطالب
  const byStudent = {};
  studentPosts.forEach(p => {
    if (!byStudent[p.studentId]) byStudent[p.studentId] = [];
    byStudent[p.studentId].push(p);
  });

  // ترتيب الطلاب بحسب آخر رسالة
  const sortedStudents = Object.entries(byStudent)
    .map(([sid, posts]) => ({
      sid,
      posts,
      lastAt: posts[0].at,
      name: users[sid]?.name || posts[0].studentName || 'طالب',
      avUrl: users[sid]?.avatarUrl || null
    }))
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  // رسم البطاقات
  cont.innerHTML = sortedStudents.map((s, gi) => {
    const initial  = s.name.charAt(0);
    const avHtml   = s.avUrl
      ? `<div style="width:46px;height:46px;min-width:46px;border-radius:50%;background:url('${e(s.avUrl)}') center/cover no-repeat;border:2.5px solid var(--navy);box-shadow:0 2px 8px rgba(0,0,0,0.12)"></div>`
      : `<div style="width:46px;height:46px;min-width:46px;border-radius:50%;background:linear-gradient(135deg,#0a1628,#1a3a6b);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.1rem;color:#c9a227;border:2.5px solid var(--navy);box-shadow:0 2px 8px rgba(0,0,0,0.12)">${initial}</div>`;

    const lastPost     = s.posts[0];
    const lastPreview  = lastPost.text.length > 60 ? lastPost.text.slice(0, 60) + '...' : lastPost.text;
    const msgCount     = s.posts.length;

    const messagesHtml = s.posts.map((p, pi) => {
      const timeStr = GharsUtils.timeAgo(p.at);
      return `
        <div style="
          background:#fff;
          border-radius:12px;
          padding:12px 14px;
          margin-bottom:8px;
          border:1px solid #edf2f7;
          box-shadow:0 1px 4px rgba(0,0,0,0.04);
          animation:fadeInUp 0.2s ${(gi*0.05 + pi*0.03).toFixed(2)}s both ease;
          border-right:3px solid var(--navy)">
          <div style="font-size:0.88rem;color:#1a202c;line-height:1.75;white-space:pre-wrap;word-break:break-word">${e(p.text)}</div>
          <div style="font-size:0.68rem;color:var(--gray);margin-top:6px;display:flex;align-items:center;gap:4px">
            <span style="opacity:0.5">🕐</span>
            <span>${timeStr}</span>
          </div>
        </div>`;
    }).join('');

    return `
      <div style="
        background:#fff;
        border-radius:16px;
        margin-bottom:14px;
        border:1px solid #e8edf5;
        box-shadow:0 2px 10px rgba(0,0,0,0.07);
        overflow:hidden;
        animation:fadeInUp 0.25s ${(gi*0.05).toFixed(2)}s both ease">

        <!-- رأس الطالب — قابل للضغط للانتقال للمحادثة -->
        <div onclick="openStudentShareChat('${s.sid}')"
          style="
            display:flex;
            align-items:center;
            gap:12px;
            padding:13px 16px;
            background:linear-gradient(135deg,#0a1628,#1a3a6b);
            cursor:pointer;
            transition:opacity 0.15s"
          onmouseover="this.style.opacity='0.9'"
          onmouseout="this.style.opacity='1'">

          ${avHtml}

          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:0.95rem;color:#fff;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(s.name)}</div>
            <div style="font-size:0.72rem;color:rgba(201,162,39,0.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(lastPreview)}</div>
          </div>

          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0">
            <span style="
              background:linear-gradient(135deg,#c9a227,#a07d10);
              color:#0a1628;
              font-weight:900;
              font-size:0.72rem;
              border-radius:20px;
              padding:3px 10px;
              min-width:26px;
              text-align:center">${msgCount}</span>
            <span style="font-size:0.65rem;color:rgba(255,255,255,0.4)">${GharsUtils.timeAgo(s.lastAt)}</span>
          </div>

          <div style="color:rgba(201,162,39,0.6);font-size:1rem;margin-right:2px">←</div>
        </div>

        <!-- رسائل الطالب -->
        <div style="padding:12px 14px 6px">
          ${messagesHtml}
        </div>
      </div>`;
  }).join('');
}

// تنظيف تلقائي لجميع المشاركات كل 100 ساعة (للمعلم)
async function _autoCleanAllSharePosts() {
  try {
    const CLEAN_INTERVAL = 100 * 3600 * 1000;
    const lastClean = parseInt(localStorage.getItem('ghars__lastShareCleanTeacher')||'0');
    if(Date.now() - lastClean < CLEAN_INTERVAL) return;
    const cutoff = new Date(Date.now() - CLEAN_INTERVAL).toISOString();
    const allPosts = await GharsDB.getAll('share_posts');
    let deleted = 0;
    for(const p of Object.values(allPosts)) {
      if(p && p.at && p.at < cutoff) {
        await GharsDB.delete('share_posts/'+p.id);
        if(_sbOK && _sb) { try { await _sb.from('ghars_data').delete().eq('collection','share_posts').eq('doc_id',p.id); } catch(_){} }
        deleted++;
      }
    }
    if(deleted > 0) GharsDB._invalidate('share_posts');
    localStorage.setItem('ghars__lastShareCleanTeacher', String(Date.now()));
  } catch(e) { console.warn('autoCleanAllSharePosts:', e); }
}

// سجل الرسائل المقروءة من قِبل المعلم
function _markStudentChatAsRead(studentId) {
  try {
    const read = JSON.parse(localStorage.getItem('ghars__chatRead')||'{}');
    read[studentId] = Date.now();
    localStorage.setItem('ghars__chatRead', JSON.stringify(read));
  } catch(_) {}
}

async function openStudentShareChat(studentId) {
  _currentShareChatStudentId = studentId;
  localStorage.setItem('ghars__currentShareChatStudentId', studentId);
  _markStudentChatAsRead(studentId);
  const user = await GharsDB.get('users/'+studentId);
  const nameEl = document.getElementById('sharechatStudentName');
  const avEl   = document.getElementById('sharechatStudentAvatar');
  if (nameEl) nameEl.textContent = user?.name || 'طالب';
  if (avEl) {
    // إطار أسود سميك دائماً
    avEl.style.border      = '3px solid #1a1a1a';
    avEl.style.boxShadow   = '0 0 0 2px rgba(255,255,255,0.8),0 2px 10px rgba(0,0,0,0.25)';
    avEl.style.overflow    = 'hidden';
    avEl.style.flexShrink  = '0';
    const avUrl = user?.avatarUrl || localStorage.getItem('ghars__avatar__'+(studentId||'')) || null;
    if (avUrl) {
      avEl.style.backgroundImage    = `url(${avUrl})`;
      avEl.style.backgroundSize     = 'cover';
      avEl.style.backgroundPosition = 'center';
      avEl.style.color              = 'transparent';
      avEl.textContent = '';
    } else {
      avEl.style.backgroundImage = '';
      avEl.style.background      = 'linear-gradient(135deg,#c9a227,#a07d10)';
      avEl.style.color           = '#0a1628';
      avEl.textContent           = (user?.name||'ط').charAt(0);
    }
  }
  navigate('teacher-sharechat');
  await loadShareChatMessages(studentId);
}

async function loadShareChatMessages(studentId) {
  const cont = document.getElementById('sharechatMessages');
  if (!cont) return;
  const settings = await GharsDB.get('system/settings') || {};
  const chatEnabled = settings.shareBoxEnabled !== false;
  const allPosts = await GharsDB.getAll('share_posts');
  const posts = Object.values(allPosts)
    .filter(p => p && p.studentId === studentId)
    .sort((a,b) => new Date(a.at)-new Date(b.at));
  
  const allUsers = await GharsDB.getAll('users');
  const studentUser = allUsers[studentId] || {};
  const studentAvUrl = studentUser.avatarUrl || localStorage.getItem('ghars__avatar__'+studentId) || null;
  const studentInitial = (studentUser.name||'ط').charAt(0);
  
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = Date.now();

  const messagesHtml = posts.length
    ? posts.map((p,i) => {
        const isTeacher = p.isTeacherReply;
        const postAge   = now - new Date(p.at).getTime();
        const canEdit   = isTeacher && postAge < TWO_HOURS; // المعلم على رسائله فقط خلال ساعتين

        const avatarHtml = !isTeacher
          ? (studentAvUrl
              ? `<div style="width:38px;height:38px;border-radius:50%;background-image:url('${studentAvUrl}');background-size:cover;background-position:center;flex-shrink:0;border:2.5px solid #1a1a1a;box-shadow:0 0 0 2px rgba(255,255,255,0.9),0 2px 8px rgba(0,0,0,0.2)"></div>`
              : `<div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#0a1628,#1a3a6b);display:flex;align-items:center;justify-content:center;font-weight:800;color:#c9a227;font-size:0.9rem;flex-shrink:0;border:2.5px solid #1a1a1a;box-shadow:0 0 0 2px rgba(255,255,255,0.9),0 2px 6px rgba(0,0,0,0.2)">${studentInitial}</div>`)
          : '';

        const lpAttrs = canEdit
          ? `ontouchstart="_tcStartLP(event,'${e(p.id)}')" ontouchend="_tcCancelLP()" ontouchcancel="_tcCancelLP()"
             onmousedown="_tcStartLP(event,'${e(p.id)}')" onmouseup="_tcCancelLP()" onmouseleave="_tcCancelLP()"`
          : '';

        return `<div style="display:flex;justify-content:${isTeacher?'flex-end':'flex-start'};align-items:flex-end;gap:8px;margin-bottom:10px;animation:fadeInUp 0.2s ${i*0.02}s both ease"
          data-postid="${e(p.id)}" ${lpAttrs}>
          ${isTeacher ? '' : avatarHtml}
          <div style="max-width:75%;${isTeacher
            ? 'background:linear-gradient(135deg,#0a1628,#1a3a6b);border-radius:16px 16px 3px 16px;padding:11px 14px;box-shadow:0 2px 8px rgba(0,0,0,0.15)'
            : 'background:#fff;border:1px solid #e2e8f0;border-radius:16px 16px 16px 3px;padding:11px 14px;box-shadow:0 1px 4px rgba(0,0,0,0.08)'}">
            ${isTeacher ? `<div style="font-size:0.68rem;font-weight:800;color:rgba(201,162,39,0.8);margin-bottom:5px">👨‍🏫 ${e(p.authorName||'معلم')}</div>` : ''}
            <div style="font-size:0.88rem;color:${isTeacher?'#fff':'#1a202c'};line-height:1.75;white-space:pre-wrap;word-break:break-word">${e(p.text)}</div>
            <div style="font-size:0.62rem;color:${isTeacher?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.3)'};margin-top:5px;text-align:${isTeacher?'left':'right'}">${GharsUtils.timeAgo(p.at)}</div>
          </div>
          ${isTeacher ? `<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#c9a227,#a07d10);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;border:2px solid rgba(201,162,39,0.4);box-shadow:0 2px 6px rgba(201,162,39,0.3)">👨‍🏫</div>` : ''}
        </div>`;
      }).join('')
    : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;opacity:0.45">
        <div style="font-size:3rem;margin-bottom:10px">💬</div>
        <div style="color:#666;font-size:0.88rem;font-weight:600">لا توجد رسائل بعد</div>
      </div>`;
  
  cont.innerHTML = messagesHtml;
  
  // شريط الكتابة — ثابت في الأسفل
  let inputBar = document.getElementById('sharechatInputBar');
  if (!inputBar) {
    const chatSection = document.getElementById('section-teacher-sharechat');
    if (chatSection) {
      inputBar = document.createElement('div');
      inputBar.id = 'sharechatInputBar';
      inputBar.style.cssText = 'flex-shrink:0';
      chatSection.appendChild(inputBar);
    }
  }
  if (inputBar) {
    inputBar.innerHTML = `<div style="flex-shrink:0">
      ${!chatEnabled ? `<div style="padding:5px 16px;background:rgba(229,62,62,0.05);border-top:1px solid rgba(229,62,62,0.1);text-align:center">
        <span style="font-size:0.7rem;font-weight:700;color:#e53e3e">🔒 الدردشة مغلقة للطلاب</span>
        <span style="font-size:0.66rem;color:#aaa;margin-right:5px">— يمكنك الرد كمعلم</span>
      </div>` : ''}
      <div style="display:flex;align-items:flex-end;gap:10px;padding:10px 14px 12px;background:#fff;border-top:1px solid #edf2f7">
        <textarea id="sharechatReplyBox" placeholder="اكتب ردك للطالب..." rows="1"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"
          style="flex:1;background:#f7f9fc;border:1.5px solid #e2e8f0;border-radius:24px;
                 padding:12px 18px;font-family:Tajawal,sans-serif;font-size:0.9rem;
                 color:#0a1628;resize:none;outline:none;direction:rtl;line-height:1.6;
                 max-height:120px;overflow-y:auto;caret-color:#c9a227;
                 transition:border-color 0.2s,box-shadow 0.2s"
          onfocus="this.style.borderColor='#c9a227';this.style.boxShadow='0 0 0 3px rgba(201,162,39,0.12)';this.style.background='#fff'"
          onfocusout="this.style.borderColor='#e2e8f0';this.style.boxShadow='none';this.style.background='#f7f9fc'"></textarea>
        <button onclick="sendTeacherShareReply('${studentId}')"
          style="width:50px;height:50px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;
                 background:linear-gradient(135deg,#c9a227,#a07d10);
                 display:flex;align-items:center;justify-content:center;
                 box-shadow:0 4px 16px rgba(201,162,39,0.5);
                 transition:transform 0.15s,box-shadow 0.2s"
          onmouseover="this.style.transform='scale(1.1)';this.style.boxShadow='0 6px 22px rgba(201,162,39,0.65)'"
          onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 4px 16px rgba(201,162,39,0.5)'">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 12L21 3L12 21L10 14L3 12Z" fill="#0a1628" stroke="#0a1628" stroke-width="1.5" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>`;
  }
  setTimeout(()=>{ cont.scrollTop = cont.scrollHeight; }, 80);
}

let _tcLpTimer = null;
function _tcStartLP(ev, postId) { _tcLpTimer = setTimeout(()=>{ _tcLpTimer=null; teacherShowPostOptions(postId); }, 600); }
function _tcCancelLP() { if(_tcLpTimer){clearTimeout(_tcLpTimer);_tcLpTimer=null;} }

async function teacherShowPostOptions(postId) {
  const post = await GharsDB.get('share_posts/'+postId);
  if (!post || !post.isTeacherReply) return; // فقط رسائل المعلم
  const age = Date.now() - new Date(post.at).getTime();
  if (age >= 2 * 60 * 60 * 1000) return; // منتهية الصلاحية

  UI.showModal(`<div class="modal" style="max-width:280px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">خيارات الرسالة</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:12px;display:flex;flex-direction:column;gap:8px">
      <button onclick="this.closest('.modal-overlay').remove();teacherEditSharePost('${postId}')"
        style="background:#f0f4ff;border:1px solid #c3d0f5;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#1a3a6b;display:flex;align-items:center;gap:8px">
        ✏️ تعديل الرسالة
      </button>
      <button onclick="this.closest('.modal-overlay').remove();teacherDeleteSharePost('${postId}')"
        style="background:#fff5f5;border:1px solid #fcd0d0;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#c53030;display:flex;align-items:center;gap:8px">
        🗑️ حذف الرسالة
      </button>
    </div>
  </div>`);
}

async function teacherEditSharePost(postId) {
  const post = await GharsDB.get('share_posts/'+postId);
  if (!post) return;
  UI.showModal(`<div class="modal" style="max-width:360px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">✏️ تعديل الرسالة</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:14px">
      <textarea id="tcEditBox" rows="4"
        style="width:100%;border:2px solid rgba(201,162,39,0.4);border-radius:10px;padding:10px 12px;font-family:Tajawal,sans-serif;font-size:0.88rem;resize:none;direction:rtl;outline:none;background:#f8fafc;color:#0a1628">${e(post.text)}</textarea>
    </div>
    <div class="modal-footer" style="gap:8px">
      <button class="btn btn-primary" onclick="tcSaveEdit('${postId}')">💾 حفظ</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}

async function tcSaveEdit(postId) {
  const text = document.getElementById('tcEditBox')?.value?.trim();
  if (!text) { UI.toast('النص فارغ','error'); return; }
  const post = await GharsDB.get('share_posts/'+postId);
  if (!post) return;
  await GharsDB.set('share_posts/'+postId, {...post, text, editedAt: new Date().toISOString()});
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('✅ تم التعديل','success',2000);
  if (_currentShareChatStudentId) await loadShareChatMessages(_currentShareChatStudentId);
}

async function teacherDeleteSharePost(postId) {
  if (!await UI.confirm('حذف هذه الرسالة؟', 'حذف')) return;
  await GharsDB.delete('share_posts/'+postId);
  if (_sbOK && _sb) {
    try { await _sb.from('ghars_data').delete().eq('collection','share_posts').eq('doc_id',postId); } catch(_){}
  }
  if (_currentShareChatStudentId) await loadShareChatMessages(_currentShareChatStudentId);
}

function showShareChatOptions() {
  UI.showModal(`<div class="modal" style="max-width:260px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">خيارات المحادثة</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:12px">
      <button onclick="this.closest('.modal-overlay').remove();teacherDeleteStudentChat()"
        style="background:#fff5f5;border:1px solid #fcd0d0;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#c53030;width:100%;display:flex;align-items:center;gap:8px">
        🗑️ حذف المحادثة
      </button>
    </div>
  </div>`);
}

async function teacherDeleteStudentChat() {
  if (!_currentShareChatStudentId) return;
  if (!await UI.confirm('حذف جميع رسائل هذا الطالب؟', 'حذف المحادثة')) return;
  const allPosts = await GharsDB.getAll('share_posts');
  for (const p of Object.values(allPosts)) {
    if (p && p.studentId === _currentShareChatStudentId) {
      await GharsDB.delete('share_posts/'+p.id);
      if (_sbOK && _sb) {
        try { await _sb.from('ghars_data').delete().eq('collection','share_posts').eq('doc_id',p.id); } catch(_){}
      }
    }
  }
  GharsDB._invalidate('share_posts');
  UI.toast('✅ تم حذف المحادثة', 'success');
  navigate('teacher-sharebox');
  await loadTeacherShareBox();
}

async function sendTeacherShareReply(studentId) {
  const box = document.getElementById('sharechatReplyBox');
  const text = box?.value?.trim();
  if (!text) { UI.toast('يرجى كتابة الرد', 'error'); return; }
  if (text.length > 2000) { UI.toast('الرد طويل جداً (الحد الأقصى 2000 حرف)', 'error'); return; }
  const post = {
    id: GharsUtils.uid(),
    studentId: studentId,
    studentName: (await GharsDB.get('users/'+studentId))?.name || 'طالب',
    authorName: Auth.currentUser?.name || 'معلم',
    text,
    at: new Date().toISOString(),
    isTeacherReply: true,
    teacherId: Auth.currentUser?.id
  };
  await GharsDB.set('share_posts/'+post.id, post);
  if (box) { box.value = ''; box.style.height = 'auto'; }
  await loadShareChatMessages(studentId);
  UI.toast('✅ تم إرسال الرد', 'success', 2000);
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
      <button class="btn btn-sm btn-primary" onclick="viewReport('${r.id}')">👁</button>
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

  // ── شاشة تحميل التقرير ──
  const loadOv = document.createElement('div');
  loadOv.id = '__reportLoadOv';
  loadOv.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(10,22,40,0.82);backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;animation:fadeIn 0.25s ease`;
  loadOv.innerHTML = `
    <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#c9a227,#a07d10);display:flex;align-items:center;justify-content:center;font-size:2rem;box-shadow:0 10px 40px rgba(201,162,39,0.4);animation:float 2s ease-in-out infinite">📋</div>
    <div style="text-align:center">
      <div style="font-size:1.1rem;font-weight:800;color:#fff;margin-bottom:6px">جاري إنشاء التقرير...</div>
      <div style="font-size:0.82rem;color:rgba(201,162,39,0.85);font-weight:600">${formatArabicDate(fromDate)} — ${formatArabicDate(toDate)}</div>
    </div>
    <div style="width:220px;height:5px;background:rgba(255,255,255,0.12);border-radius:3px;overflow:hidden">
      <div id="__rptBar" style="height:100%;background:linear-gradient(90deg,#c9a227,#e8c84a);border-radius:3px;width:0%;transition:width 0.6s ease"></div>
    </div>`;
  document.body.appendChild(loadOv);
  requestAnimationFrame(()=>{ const b=document.getElementById('__rptBar'); if(b) b.style.width='70%'; });

  try {
    const [users,meetings,ptsData,memoData,groups]=await Promise.all([
      GharsDB.getAll('users'),GharsDB.getAll('meetings'),
      GharsDB.getAll('points_summary'),GharsDB.getAll('memorization'),GharsDB.getAll('groups')
    ]);
    const bar=document.getElementById('__rptBar'); if(bar) bar.style.width='90%';

    const students=Object.values(users).filter(u=>u.role==='student'&&!u.deleted);
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
      const pts = ptsData[s.id]?.total || 0;
      const memo = memoData[s.id]?.score || 0;
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
    if(bar) bar.style.width='100%';
    await GharsDB.set('reports/'+id,report);
    setTimeout(()=>{ loadOv.remove(); viewReport(id); },350);
  } catch(err) {
    loadOv.remove();
    UI.toast('حدث خطأ أثناء إنشاء التقرير','error');
    console.error('generateReport error:',err);
  }
}
function showCreateReport() { navigate('create-report'); }
async function viewReport(id) {
  const r=await GharsDB.get('reports/'+id);
  navigate('view-report');
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
        <button class="btn btn-primary btn-sm" onclick="shareReport('${id}')">📋 نسخ التقرير</button>
      </div>
    </div>
  </div>`;
}
async function deleteReport(id) {
  if(!await UI.confirm('حذف هذا التقرير؟','حذف')) return;
  await GharsDB.set('reports/'+id,{deleted:true,id});
  UI.toast('تم','success'); loadReports();
}
async function buildShareReportText(id) {
  const [r,settings]=await Promise.all([GharsDB.get('reports/'+id),GharsDB.get('system/settings')]);
  if(!r) return '';
  const target=settings?.targetMemorization||30;
  const students=r.studentStats||[];
  const ptsRanked=[...students].sort((a,b)=>b.pts-a.pts);
  const memoRanked=[...students].sort((a,b)=>b.memo-a.memo);
  let txt=`📊 *التقرير ${r.title}*\n`;
  txt+=`📅 *التاريخ : ${r.dateFrom} — ${r.dateTo}*\n`;
  txt+=`*عدد اللقاءات : ${r.meetingsCount||0}*\n\n`;
  txt+=`👥 *تفاصيل الطلاب :*\n━━━━━━━━━━━━━\n`;
  students.forEach(s=>{
    const pRank=ptsRanked.findIndex(x=>x.name===s.name)+1;
    const mRank=memoRanked.findIndex(x=>x.name===s.name)+1;
    txt+=`👤 ${s.name}\n`;
    txt+=`🗓 الحضور : ${s.present} / الغياب : ${s.absent} / الاستئذان : ${s.excused}\n`;
    txt+=`📖 المركز في النظم : #${mRank} / ${s.memo} من ${target}\n`;
    txt+=`⭐ المركز في النقاط : #${pRank} / ${s.pts} نقطة\n`;
    txt+=`━━━━━━━━━━━━━\n`;
  });
  if((r.groupsSorted||[]).length){
    txt+=`\n🏆 *ترتيب المجموعات :*\n`;
    const medals=['🥇','🥈','🥉'];
    r.groupsSorted.forEach((g,i)=>{
      txt+=`${medals[i]||'🏅'} #${i+1} ${g.name} · ⭐ ${g.points} نقطة\n`;
    });
    txt+=`━━━━━━━━━━━━━\n`;
  }
  txt+=`\n*📚 متصدر النظم : ${r.topMemo}*\n`;
  txt+=`*🌟 متصدر النقاط : ${r.topPts}*\n`;
  const doneCount=students.filter(s=>s.memo>=target&&target>0).length;
  txt+=`*🏆 عدد منجزين النظم : ${doneCount}*\n`;
  txt+=`*📊 متوسط الحضور : ${r.avgPresent}*\n`;
  const avgMemo=students.length?(students.reduce((a,s)=>a+s.memo,0)/students.length).toFixed(1):'0';
  txt+=`*📚 متوسط تسميع النظم : ${avgMemo}*`;
  return txt;
}
async function shareReport(id) {
  const text=await buildShareReportText(id);
  if(!text){UI.toast('التقرير غير موجود','error');return;}
  // عرض المعاينة قبل المشاركة
  window._shareText = text;
  const rHtml = GharsUtils.esc(text).replace(/\n/g,'<br>').replace(/\*(.*?)\*/g,'<strong>$1</strong>');
  UI.showModal('<div class="modal" style="max-width:520px">'+
    '<div class="modal-header" style="background:#075e54">'+
    '<h3 style="color:#fff;font-size:0.95rem">💬 معاينة التقرير</h3>'+
    '<button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:0.9rem">✖</button>'+
    '</div>'+
    '<div class="modal-body" style="background:#e5ddd5;padding:14px">'+
    '<div id="reportPreviewText" style="background:#dcf8c6;border-radius:12px 12px 3px 12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.15);font-family:Tajawal,sans-serif;font-size:0.84rem;line-height:1.95;direction:rtl;text-align:right;max-height:58vh;overflow-y:auto;word-break:break-word;color:#111">'+
    rHtml+'</div>'+
    '</div>'+
    '<div class="modal-footer" style="background:#f0f0f0;border-top:1px solid #ddd;gap:8px;padding:10px 14px">'+
    '<button class="btn" style="background:#25d366;color:#fff;font-weight:800;flex:1;border-radius:22px;padding:10px;font-size:0.9rem" onclick="window._shareText=(window._shareText||text);copyShareText()">📋 نسخ التقرير</button>'+
    '<button class="btn btn-gray" data-close-modal style="border-radius:22px;padding:10px 16px">إغلاق</button>'+
    '</div>'+
    '</div>');
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

// ===== معاينة قبل المشاركة على واتساب =====
function _showSharePreview(title, msg) {
  window._shareText = msg;
  window._sharePreviewText = msg;
  const preview = msg.replace(/\*/g,'').substring(0,600)+(msg.length>600?'\n[...المزيد]':'');
  const modalId = 'sp_'+Date.now();
  window._shareText = msg;
  const spHtml = e(preview).replace(/\n/g,'<br>').replace(/\*(.*?)\*/g,'<strong>$1</strong>');
  UI.showModal('<div class="modal" style="max-width:480px" id="'+modalId+'">'+
    '<div class="modal-header" style="background:#075e54">'+
    '<h3 style="color:#fff;font-size:0.95rem">💬 معاينة — '+e(title)+'</h3>'+
    '<button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:0.9rem">✖</button>'+
    '</div>'+
    '<div class="modal-body" style="background:#e5ddd5;padding:14px">'+
    '<div style="background:#dcf8c6;border-radius:12px 12px 3px 12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.15);font-family:Tajawal,sans-serif;font-size:0.86rem;line-height:2;direction:rtl;text-align:right;max-height:55vh;overflow-y:auto;word-break:break-word;color:#111">'+
    spHtml+'</div>'+
    '</div>'+
    '<div class="modal-footer" style="background:#f0f0f0;border-top:1px solid #ddd;gap:8px;padding:10px 14px">'+
    '<button class="btn" style="background:#25d366;color:#fff;font-weight:800;flex:1;border-radius:22px;padding:10px" onclick="copyShareText()">📋 نسخ الرسالة</button>'+
    '<button class="btn btn-gray" data-close-modal style="border-radius:22px;padding:10px 16px">إغلاق</button>'+
    '</div>'+
    '</div>');
}

// ============================================================
// Share Preview Modal
// ============================================================
function showSharePreviewModal(text) {
  // store text temporarily for button handlers
  window._sharePreviewText = text;
  const spmHtml=e(text).replace(/\n/g,'<br>').replace(/\*(.*?)\*/g,'<strong>$1</strong>');
  UI.showModal('<div class="modal" style="max-width:460px">'+
    '<div class="modal-header" style="background:#075e54">'+
    '<h3 style="color:#fff;font-size:0.95rem">💬 معاينة الرسالة</h3>'+
    '<button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:0.9rem">✖</button>'+
    '</div>'+
    '<div class="modal-body" style="background:#e5ddd5;padding:14px">'+
    '<div style="background:#dcf8c6;border-radius:12px 12px 3px 12px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.15);font-family:Tajawal,sans-serif;font-size:0.86rem;line-height:2;direction:rtl;text-align:right;max-height:55vh;overflow-y:auto;word-break:break-word;color:#111">'+
    spmHtml+'</div>'+
    '</div>'+
    '<div class="modal-footer" style="background:#f0f0f0;border-top:1px solid #ddd;gap:8px;padding:10px 14px">'+
    '<button class="btn" style="background:#25d366;color:#fff;font-weight:800;flex:1;border-radius:22px;padding:10px" onclick="window._shareText=window._sharePreviewText||text;copyShareText()">📋 نسخ الرسالة</button>'+
    '<button class="btn btn-gray" data-close-modal style="border-radius:22px;padding:10px 16px">إغلاق</button>'+
    '</div>'+
    '</div>');
}
// ============================================================
// تعديل بيانات الطالب
// ============================================================
async function editStudentData(id) {
  const [s, groups] = await Promise.all([GharsDB.get('users/'+id), GharsDB.getAll('groups')]);
  if(!s){UI.toast('لم يتم العثور على الطالب','error');return;}
  const gopts=Object.values(groups).map(g=>`<option value="${e(g.name)}"${s.group===g.name?' selected':''}>${e(g.name)}</option>`).join('');
  UI.showModal(`<div class="modal" style="max-width:420px">
    <div class="modal-header" style="background:linear-gradient(135deg,var(--navy),var(--navy-light))">
      <h3 style="color:var(--gold)">✏️ تعديل بيانات الطالب</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">👤 الاسم الكامل</label>
        <input type="text" class="form-input" id="editStuName" value="${e(s.name||'')}" placeholder="الاسم الكامل">
      </div>
      <div class="form-group">
        <label class="form-label">🔑 اسم المستخدم</label>
        <input type="text" class="form-input" id="editStuUsername" value="${e(s.username||'')}" placeholder="username" style="direction:ltr">
      </div>
      <div class="form-group">
        <label class="form-label">🔒 كلمة المرور</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" class="form-input" id="editStuPassword" value="${e(s.password||'')}" placeholder="كلمة المرور" style="direction:ltr;flex:1">
          <button type="button" class="btn btn-sm btn-outline" onclick="document.getElementById('editStuPassword').value=GharsUtils.generatePassword()" style="white-space:nowrap;flex-shrink:0">🔄 جديدة</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">🏆 المجموعة</label>
        <select class="form-select" id="editStuGroup"><option value="">بدون مجموعة</option>${gopts}</select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="saveEditStudent('${id}')">💾 حفظ</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}
async function saveEditStudent(id) {
  const name     = (document.getElementById('editStuName')?.value||'').trim();
  const username = (document.getElementById('editStuUsername')?.value||'').trim().toLowerCase();
  const password = (document.getElementById('editStuPassword')?.value||'').trim();
  const group    = (document.getElementById('editStuGroup')?.value||'').trim();
  if(!name||!username||!password){UI.toast('يرجى ملء جميع الحقول','error');return;}
  const existing = await GharsDB.get('users/'+id);
  if(!existing){UI.toast('الطالب غير موجود','error');return;}

  const credChanged  = existing.username !== username || existing.password !== password;
  // ── عند تغيير اسم المستخدم أو كلمة المرور: أنشئ qrVersion جديداً لإلغاء QR القديم ──
  const newQrVersion = credChanged ? GharsUtils.uid() : (existing.qrVersion || GharsUtils.uid());
  const updated      = {
    ...existing, name, username, password, group,
    qrVersion: newQrVersion,
    // عند تغيير الـ credentials: أضف علامة لإجبار إعادة تسجيل الدخول
    ...(credChanged ? { credUpdatedAt: new Date().toISOString() } : {})
  };

  // ── 1. تحديث localStorage و IDB فوراً ──
  try { localStorage.setItem('ghars__users__'+id, JSON.stringify(updated)); } catch(_){}
  if(typeof GharsDataDB !== 'undefined') GharsDataDB.set('ghars__users__'+id, updated, 'users').catch(()=>{});
  GharsDB._invalidate('users');

  // ── 2. إذا تغيرت الـ credentials: احذف session الطالب القديمة من localStorage ──
  if(credChanged) {
    try {
      const session = JSON.parse(localStorage.getItem('ghars__session')||'null');
      // إذا كانت session الحالية للطالب المعدَّل → احذفها لإجباره على إعادة الدخول
      if(session && session.id === id) {
        localStorage.removeItem('ghars__session');
      }
    } catch(_){}
    // احذف saved_creds إذا كانت لهذا الطالب
    try {
      const saved = JSON.parse(localStorage.getItem('ghars__saved_creds')||'null');
      if(saved && (saved.username === existing.username)) {
        localStorage.removeItem('ghars__saved_creds');
      }
    } catch(_){}
  }

  // ── 3. تحديث Supabase ──
  if(_sbOK && _sb) {
    try {
      const { error } = await _sb.from('ghars_data').upsert({
        collection: 'users', doc_id: id,
        data: updated, updated_at: new Date().toISOString()
      }, { onConflict: 'collection,doc_id' });
      if(error) { _writeQueue.push({ col:'users', doc:id, data:updated }); }
    } catch(e) { _writeQueue.push({ col:'users', doc:id, data:updated }); }
  } else {
    _writeQueue.push({ col:'users', doc:id, data:updated });
  }

  document.querySelector('.modal-overlay')?.remove();
  const msg = credChanged
    ? '✅ تم التعديل — بيانات الدخول ورمز QR القديمان أصبحا غير صالحَين'
    : '✅ تم تعديل بيانات الطالب';
  UI.toast(msg, 'success', 3500);
  loadStudents();
}

// ============================================================
// AVATAR IMAGE — صورة شخصية (مشترك بين المعلم والطالب)
// ============================================================
function _applyAvatarImage(el, user) {
  if (!el) return;
  const img = user?.avatarUrl || localStorage.getItem('ghars__avatar__'+(user?.id||''));
  if (img) {
    el.style.backgroundImage = `url(${img})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.color = 'transparent';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.backgroundPosition = '';
    el.style.color = '';
    el.textContent = (user?.name||'?').charAt(0);
  }
}
function _openAvatarPicker() {
  const user = Auth.currentUser;
  const imgUrl = user?.avatarUrl || localStorage.getItem('ghars__avatar__'+(user?.id||''));
  const hasAvatar = !!imgUrl;

  if (!hasAvatar) {
    UI.showModal(`<div class="modal" style="max-width:320px">
      <div class="modal-header" style="background:linear-gradient(135deg,var(--navy),var(--navy-light));padding:14px 18px">
        <h3 style="color:var(--gold);font-size:0.95rem">🖼️ الصورة الشخصية</h3>
        <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:0.9rem">✖</button>
      </div>
      <div class="modal-body" style="padding:24px;text-align:center">
        <div style="font-size:4rem;margin-bottom:14px;opacity:0.5">🖼️</div>
        <p style="font-size:0.92rem;font-weight:700;color:var(--navy);margin-bottom:6px">لا توجد صورة شخصية بعد</p>
        <p style="font-size:0.8rem;color:var(--gray);margin-bottom:20px">يمكنك إضافة صورة أو خلفية مميزة لحسابك</p>
        <button class="btn btn-primary" style="width:100%;justify-content:center;padding:13px;font-size:0.92rem;border-radius:12px;display:flex;align-items:center;gap:8px"
          onclick="this.closest('.modal-overlay').remove();_pickAvatarFile()">
          <span>🖼️</span> إضافة خلفية / صورة شخصية
        </button>
      </div>
    </div>`);
    return;
  }

  // Has avatar — show fullscreen with action buttons
  showUserAvatar(imgUrl, true);
}

// عرض صورة المستخدم بشكل كامل وبجودة عالية
function showUserAvatar(imgUrl, isOwn) {
  if (!imgUrl) return;
  // إزالة أي overlay سابق
  document.querySelectorAll('.ghars-avatar-overlay').forEach(el => el.remove());
  const ov = document.createElement('div');
  ov.className = 'ghars-avatar-overlay';
  ov.style.cssText = [
    'position:fixed','inset:0','z-index:99999',
    'background:rgba(0,0,0,0.96)',
    'display:flex','flex-direction:column',
    'align-items:center','justify-content:center',
    'animation:fadeIn 0.2s ease',
    'padding:20px'
  ].join(';');
  ov.innerHTML = `
    <button class="ghars-av-close" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.2);color:#fff;width:44px;height:44px;border-radius:50%;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px);transition:background 0.2s">✖</button>
    <div style="max-width:92vw;max-height:75vh;display:flex;align-items:center;justify-content:center;border-radius:20px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.7)">
      <img src="${imgUrl}"
        style="display:block;max-width:92vw;max-height:75vh;width:auto;height:auto;object-fit:contain;image-rendering:high-quality;-webkit-image-rendering:-webkit-optimize-contrast;"
        loading="eager"
        decoding="sync"
        />
    </div>
    ${isOwn ? `<div style="display:flex;gap:12px;margin-top:22px;flex-wrap:wrap;justify-content:center">
      <button onclick="this.closest('.ghars-avatar-overlay').remove();_pickAvatarFile()" style="background:linear-gradient(135deg,#c9a227,#a07d10);color:var(--navy);border:none;border-radius:14px;padding:13px 26px;font-family:Tajawal,sans-serif;font-size:0.92rem;font-weight:800;cursor:pointer;box-shadow:0 6px 20px rgba(201,162,39,0.4)">📷 تغيير الصورة</button>
      <button onclick="this.closest('.ghars-avatar-overlay').remove();_deleteAvatar()" style="background:rgba(229,62,62,0.18);color:#ff7070;border:1.5px solid rgba(229,62,62,0.5);border-radius:14px;padding:13px 26px;font-family:Tajawal,sans-serif;font-size:0.92rem;font-weight:700;cursor:pointer">🗑️ حذف</button>
    </div>` : ''}`;
  ov.querySelector('.ghars-av-close').onclick = () => ov.remove();
  ov.addEventListener('click', ev => { if (ev.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

function _pickAvatarFile() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if(!file){ document.body.removeChild(input); return; }
    const reader = new FileReader();
    reader.onload = async (e2) => {
      const dataUrl = e2.target.result;
      const resized = await _resizeImage(dataUrl, 200);
      const uid = Auth.currentUser?.id; if(!uid) return;
      try { localStorage.setItem('ghars__avatar__'+uid, resized); } catch(_) {}
      const updated = {...Auth.currentUser, avatarUrl: resized};
      Auth.currentUser = updated;
      localStorage.setItem('ghars__session', JSON.stringify(updated));
      await GharsDB.set('users/'+uid, updated);
      _applyAvatarImage(document.getElementById('headerAvatar'), updated);
      UI.toast('✅ تم تحديث الصورة الشخصية','success',2500);
    };
    reader.readAsDataURL(file);
    document.body.removeChild(input);
  };
  input.click();
}

async function _deleteAvatar() {
  const uid = Auth.currentUser?.id; if(!uid) return;
  try { localStorage.removeItem('ghars__avatar__'+uid); } catch(_) {}
  const updated = {...Auth.currentUser};
  delete updated.avatarUrl;
  Auth.currentUser = updated;
  localStorage.setItem('ghars__session', JSON.stringify(updated));
  await GharsDB.set('users/'+uid, updated);
  _applyAvatarImage(document.getElementById('headerAvatar'), updated);
  UI.toast('🗑️ تم حذف الصورة الشخصية','info',2500);
}
// ============================================================
// ملف المعلم الشخصي
// ============================================================
async function showTeacherProfile() {
  const user = Auth.currentUser;
  if (!user) return;
  const freshUser = await GharsDB.get('users/'+user.id) || user;
  const roleLabel = freshUser.role==='admin' ? 'مدير' : 'معلم';
  const avUrl = freshUser.avatarUrl || localStorage.getItem('ghars__avatar__'+freshUser.id);
  const avHtml = avUrl
    ? `<div onclick="this.closest('.modal-overlay').remove();_openAvatarPicker()" style="width:72px;height:72px;border-radius:50%;background-image:url('${avUrl}');background-size:cover;background-position:center;margin:0 auto 10px;border:3px solid rgba(201,162,39,0.6);box-shadow:0 4px 16px rgba(0,0,0,0.3);cursor:pointer;position:relative;overflow:hidden">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background 0.2s" onmouseover="this.style.background='rgba(0,0,0,0.3)'" onmouseout="this.style.background='rgba(0,0,0,0)'"><span style="color:#fff;font-size:1.2rem;opacity:0">📷</span></div>
      </div>`
    : `<div onclick="this.closest('.modal-overlay').remove();_openAvatarPicker()" style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#c9a227,#a07d10);display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:900;color:#0a1628;margin:0 auto 10px;border:3px solid rgba(201,162,39,0.6);box-shadow:0 4px 16px rgba(0,0,0,0.3);cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">${(freshUser.name||'?').charAt(0)}</div>`;

  UI.showModal(`<div class="modal" style="max-width:320px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b);padding:14px 18px">
      <h3 style="color:#c9a227;font-size:0.95rem;margin:0">👨‍🏫 ملفي الشخصي</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:20px;text-align:center">
      ${avHtml}
      <div style="font-size:1.1rem;font-weight:900;color:#0a1628;margin-bottom:4px">${e(freshUser.name)}</div>
      <div style="display:inline-block;background:rgba(10,22,40,0.1);border-radius:16px;padding:2px 12px;font-size:0.75rem;font-weight:700;color:#0a1628;margin-bottom:16px">${roleLabel}</div>
      <div style="background:#f8fafc;border-radius:12px;padding:12px 16px;text-align:right;border:1px solid #e2e8f0;margin-bottom:14px">
        <div style="font-size:0.7rem;color:#999;margin-bottom:6px;font-weight:700">بيانات الدخول</div>
        <div style="font-size:0.82rem;font-weight:700;color:#0a1628;margin-bottom:4px">👤 ${e(freshUser.username)}</div>
        <div style="font-size:0.82rem;font-weight:700;color:#0a1628">🔑 ${e(freshUser.password)}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="this.closest('.modal-overlay').remove();showQRPreview('${freshUser.id}')"
          style="flex:1;background:linear-gradient(135deg,#0a1628,#1a3a6b);color:#c9a227;border:1.5px solid rgba(201,162,39,0.5);border-radius:10px;padding:10px 6px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer">
          📱 رمز QR
        </button>
        <button onclick="copyTeacherProfileCreds()"
          style="flex:1;background:#f0f4ff;color:#1a3a6b;border:1px solid #c3d0f5;border-radius:10px;padding:10px 6px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer">
          📋 نسخ
        </button>
      </div>
    </div>
  </div>`);
}

function copyTeacherProfileCreds() {
  const u = Auth.currentUser;
  if (!u) return;
  UI.copyText(`الاسم: ${u.name}\nاسم المستخدم: ${u.username}\nكلمة المرور: ${u.password}`);
}

// ============================================================
// QR CODE — بطاقة تسجيل الدخول بالرمز QR
// ============================================================
async function showQRPreview(userId) {
  let user = null;
  const STATIC = typeof STATIC_TEACHERS !== 'undefined' ? STATIC_TEACHERS : [];
  user = STATIC.find(t => t.id === userId) || await GharsDB.get('users/' + userId);
  if (!user) { UI.toast('المستخدم غير موجود', 'error'); return; }

  if (!user.qrVersion) {
    user.qrVersion = GharsUtils.uid();
    GharsDB.set('users/' + userId, user).catch(() => {});
  }

  const baseUrl = window.location.origin + (window.location.pathname.replace(/\/[^/]*$/, '/') || '/');
  const payload = JSON.stringify({ un: user.username, pw: user.password, id: user.id, ver: user.qrVersion });
  const b64     = btoa(unescape(encodeURIComponent(payload)));
  const loginUrl = baseUrl + 'index.html?qr=' + encodeURIComponent(b64);
  const roleLabel = user.role === 'student' ? 'طالب' : user.role === 'admin' ? 'مدير' : 'معلم';

  // QR يملأ الخلفية البيضاء مع هامش صغير فقط
  const QR_SZ  = 256;           // حجم رمز QR
  const PAD    = 14;            // هامش أبيض من كل جانب
  const BOX_SZ = QR_SZ + PAD*2; // 284px — الخلفية البيضاء

  UI.showModal(`<div class="modal" style="max-width:360px;width:min(360px,96vw);max-height:none;overflow:visible">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#0d1f3c);padding:12px 16px;border-bottom-left-radius:0;border-bottom-right-radius:0">
      <h3 style="color:#c9a227;font-size:0.9rem;margin:0;font-family:Tajawal,sans-serif">📱 بطاقة تسجيل الدخول</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:0.82rem;border:none;cursor:pointer">✖</button>
    </div>

    <div style="background:linear-gradient(145deg,#0a1628,#0d1f3c);padding:18px 14px 14px;border-radius:0 0 18px 18px;overflow-y:auto;max-height:calc(96vh - 52px);-webkit-overflow-scrolling:touch">

      <!-- بطاقة QR -->
      <div style="background:linear-gradient(160deg,#0c1e40,#0a1830,#061018);border-radius:16px;padding:18px 14px 14px;margin-bottom:12px;text-align:center;border:1.5px solid rgba(201,162,39,0.45);box-shadow:0 8px 28px rgba(0,0,0,0.55)">

        <div style="font-size:1.2rem;font-weight:900;color:#c9a227;font-family:Tajawal,sans-serif;margin-bottom:2px">🌱 نادي غرس</div>
        <div style="width:44px;height:1.5px;background:linear-gradient(90deg,transparent,rgba(201,162,39,0.7),transparent);margin:4px auto 8px"></div>
        <div style="font-size:0.95rem;font-weight:800;color:#fff;font-family:Tajawal,sans-serif;margin-bottom:12px">${e(user.name)}</div>

        <!-- الخلفية البيضاء — QR يملؤها مع هامش صغير -->
        <div style="display:inline-block;">
          <div id="qrWhiteBox" style="
              width:${BOX_SZ}px;
              height:${BOX_SZ}px;
              background:#ffffff;
              border-radius:14px;
              padding:${PAD}px;
              box-sizing:border-box;
              box-shadow:0 4px 20px rgba(0,0,0,0.4);
              position:relative;
              display:flex;
              align-items:center;
              justify-content:center;
              overflow:hidden">
            <div id="qrSpinner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#fff;z-index:2">
              <span class="loader"></span>
            </div>
            <img id="qrImageEl"
              style="display:block;width:${QR_SZ}px;height:${QR_SZ}px;opacity:0;transition:opacity 0.35s ease;image-rendering:pixelated;flex-shrink:0"
              alt="QR Code">
          </div>
        </div>

        <div style="font-size:0.68rem;color:rgba(201,162,39,0.85);background:rgba(201,162,39,0.12);display:inline-block;padding:3px 14px;border-radius:20px;border:1px solid rgba(201,162,39,0.3);font-family:Tajawal,sans-serif;margin-top:12px">${roleLabel}</div>
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);margin-top:6px;font-family:Tajawal,sans-serif">📲 امسح الرمز للدخول تلقائياً</div>
      </div>

      <!-- بيانات الدخول -->
      <div style="background:#f8fafc;border-radius:12px;padding:11px 14px;margin-bottom:12px;text-align:right;border:1px solid #e2e8f0">
        <div style="font-size:0.65rem;color:#aaa;margin-bottom:5px;font-weight:700;font-family:Tajawal,sans-serif">بيانات الدخول</div>
        <div style="font-size:0.88rem;font-weight:800;color:#0a1628;font-family:Tajawal,sans-serif;margin-bottom:4px">👤 ${e(user.username)}</div>
        <div style="font-size:0.88rem;font-weight:800;color:#0a1628;font-family:Tajawal,sans-serif">🔑 ${e(user.password)}</div>
      </div>

      <div style="display:flex;gap:10px">
        <button onclick="downloadQRCard('${userId}')"
          style="flex:1;padding:12px 8px;font-size:0.88rem;background:linear-gradient(135deg,#c9a227,#a07d10);color:#0a1628;border:none;
border-radius:12px;cursor:pointer;font-family:Tajawal,sans-serif;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 14px rgba(201,162,39,0.4)">
          ⬇️ تحميل
        </button>
        <button onclick="shareQRWhatsApp('${encodeURIComponent(loginUrl)}','${encodeURIComponent(user.name)}')"
          style="flex:1;padding:12px 8px;font-size:0.88rem;background:#25d366;color:#fff;border:none;border-radius:12px;cursor:pointer;font-family:Tajawal,sans-serif;font-weight:800;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 14px rgba(37,211,102,0.35)">
          💬 واتساب
        </button>
      </div>
    </div>
  </div>`);

  window._qrLoginUrl = loginUrl;
  window._qrUserData = user;
  requestAnimationFrame(() => setTimeout(() => _generateQRCode(loginUrl, QR_SZ), 50));
}

// ── توليد QR موثوق لجميع الأجهزة ──
function _generateQRCode(loginUrl, size) {
  const imgEl    = document.getElementById('qrImageEl');
  const spinner  = document.getElementById('qrSpinner');
  const whiteBox = document.getElementById('qrWhiteBox');
  if (!imgEl) return;

  // جلب QR بدقة 4× من API
  const hiRes  = size * 4;
  const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${hiRes}x${hiRes}&data=${encodeURIComponent(loginUrl)}&bgcolor=ffffff&color=000000&ecc=H&margin=0`;

  imgEl.onload = () => {
    imgEl.style.opacity = '1';
    if (spinner) spinner.style.display = 'none';
  };
  imgEl.onerror = () => {
    if (typeof QRCode !== 'undefined') {
      try {
        if (spinner) spinner.style.display = 'none';
        imgEl.style.display = 'none';
        const div = document.createElement('div');
        div.style.cssText = `width:${size}px;height:${size}px;flex-shrink:0`;
        if (whiteBox) whiteBox.appendChild(div);
        new QRCode(div, { text:loginUrl, width:size, height:size, colorDark:'#000000', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.H });
        setTimeout(() => {
          const cv = div.querySelector('canvas'), im = div.querySelector('img');
          const s  = `display:block!important;width:${size}px!important;height:${size}px!important;max-width:none!important`;
          if(cv){cv.setAttribute('style',s);cv.setAttribute('width',size);cv.setAttribute('height',size);}
          if(im) im.setAttribute('style',s);
        }, 100);
      } catch(_) {
        if(whiteBox) whiteBox.innerHTML += '<div style="color:#c9a227;font-size:0.75rem;text-align:center;padding:8px;font-family:Tajawal,sans-serif">تعذّر التحميل</div>';
      }
    }
  };
  imgEl.src = apiUrl;
}

async function downloadQRCard(userId) {
  const user     = window._qrUserData;
  const loginUrl = window._qrLoginUrl;
  if (!user || !loginUrl) { UI.toast('أعد فتح النافذة وحاول مجدداً', 'error'); return; }

  const btn = event?.currentTarget;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loader loader-sm" style="display:inline-block;vertical-align:middle;margin-left:6px"></span><span style="vertical-align:middle"> جاري...</span>'; }
  UI.toast('⏳ جاري إنشاء البطاقة بجودة عالية...', 'info', 4000);

  try {
    // بطاقة احترافية: DPR=4 → 1600×2400px فعلياً — بدون اسم المستخدم أو كلمة المرور
    const W = 400, H = 600;
    const DPR = 4;
    const canvas  = document.createElement('canvas');
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // ─── 1. جلب QR بدقة 1200×1200 ───
    const QR_API_SIZE = 1200;
    const QR_SIZE     = 248;
    const QR_X        = (W - QR_SIZE) / 2;
    const QR_Y        = 216;

    const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${QR_API_SIZE}x${QR_API_SIZE}&data=${encodeURIComponent(loginUrl)}&bgcolor=ffffff&color=0a1628&ecc=H&margin=0`;
    const qrImg = await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('فشل تحميل رمز QR'));
      setTimeout(() => reject(new Error('timeout')), 12000);
      img.src = apiUrl;
    });

    // ─── 2. خلفية متدرجة داكنة ───
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0,    '#0c1e3e');
    bgGrad.addColorStop(0.45, '#0a1628');
    bgGrad.addColorStop(1,    '#060d1a');
    ctx.fillStyle = bgGrad;
    ctx.beginPath(); _roundRect(ctx, 0, 0, W, H, 24); ctx.fill();

    // وهج ذهبي خلفي
    const glow = ctx.createRadialGradient(W/2, 85, 10, W/2, 85, 210);
    glow.addColorStop(0, 'rgba(201,162,39,0.18)');
    glow.addColorStop(1, 'rgba(201,162,39,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); _roundRect(ctx, 0, 0, W, 260, 24); ctx.fill();

    // ─── 3. إطارات ذهبية ───
    ctx.strokeStyle = 'rgba(201,162,39,0.85)';
    ctx.lineWidth   = 2;
    ctx.beginPath(); _roundRect(ctx, 2, 2, W-4, H-4, 23); ctx.stroke();
    ctx.strokeStyle = 'rgba(201,162,39,0.12)';
    ctx.lineWidth   = 6;
    ctx.beginPath(); _roundRect(ctx, 8, 8, W-16, H-16, 20); ctx.stroke();

    // ─── 4. دائرة الشعار ───
    const cx = W / 2;
    const logoGrad = ctx.createLinearGradient(cx-30, 22, cx+30, 82);
    logoGrad.addColorStop(0, '#c9a227');
    logoGrad.addColorStop(1, '#a07d10');
    ctx.fillStyle = 'rgba(201,162,39,0.12)';
    ctx.beginPath(); ctx.arc(cx, 54, 38, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = logoGrad;
    ctx.beginPath(); ctx.arc(cx, 54, 30, 0, Math.PI*2); ctx.fill();
    // لمعة
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(cx-9, 44, 13, 0, Math.PI*2); ctx.fill();
    // أيقونة
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0a1628';
    ctx.fillText('🌱', cx, 63);

    // ─── 5. اسم النادي ───
    ctx.font        = 'bold 28px Arial';
    ctx.fillStyle   = '#c9a227';
    ctx.shadowColor = 'rgba(201,162,39,0.65)';
    ctx.shadowBlur  = 20;
    ctx.fillText('نادي غرس', cx, 114);
    ctx.shadowBlur  = 0;
    ctx.font      = '13.5px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('قيم تغرس وجيل يبنى', cx, 134);

    // ─── 6. فاصل علوي ───
    const sepGrad1 = ctx.createLinearGradient(40, 0, W-40, 0);
    sepGrad1.addColorStop(0,   'transparent');
    sepGrad1.addColorStop(0.2, 'rgba(201,162,39,0.7)');
    sepGrad1.addColorStop(0.8, 'rgba(201,162,39,0.7)');
    sepGrad1.addColorStop(1,   'transparent');
    ctx.strokeStyle = sepGrad1; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 152); ctx.lineTo(W-40, 152); ctx.stroke();

    // ─── 7. اسم المستخدم ───
    ctx.font        = 'bold 23px Arial';
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = 'rgba(255,255,255,0.12)';
    ctx.shadowBlur  = 8;
    ctx.fillText(user.name, cx, 182);
    ctx.shadowBlur  = 0;
    // شارة الدور
    const roleLabel = user.role==='student'?'طالب':user.role==='admin'?'مدير':'معلم';
    ctx.fillStyle   = 'rgba(201,162,39,0.18)';
    ctx.strokeStyle = 'rgba(201,162,39,0.6)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); _roundRect(ctx, cx-38, 191, 76, 24, 12); ctx.fill(); ctx.stroke();
    ctx.font      = 'bold 13px Arial';
    ctx.fillStyle = '#c9a227';
    ctx.fillText(roleLabel, cx, 207);

    // ─── 8. صندوق QR الأبيض ───
    const pad  = 16;
    const boxX = QR_X - pad;
    const boxY = QR_Y - pad;
    const boxW = QR_SIZE + pad*2;
    const boxH = QR_SIZE + pad*2;
    ctx.shadowColor = 'rgba(201,162,39,0.45)';
    ctx.shadowBlur  = 30;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath(); _roundRect(ctx, boxX, boxY, boxW, boxH, 18); ctx.fill();
    ctx.shadowBlur  = 0;

    // نقاط زاوية ذهبية
    [[boxX+7,boxY+7],[boxX+boxW-7,boxY+7],[boxX+7,boxY+boxH-7],[boxX+boxW-7,boxY+boxH-7]].forEach(([x2,y2])=>{
      ctx.fillStyle = 'rgba(201,162,39,0.55)';
      ctx.beginPath(); ctx.arc(x2,y2,4.5,0,Math.PI*2); ctx.fill();
    });

    // ─── 9. رسم QR بحدة كاملة ───
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrImg, QR_X, QR_Y, QR_SIZE, QR_SIZE);
    ctx.imageSmoothingEnabled = true;

    // ─── 10. نص المسح ───
    const scanY = QR_Y + QR_SIZE + pad + 30;
    ctx.font      = 'bold 14.5px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('📲  امسح الرمز لتسجيل الدخول تلقائياً', cx, scanY);

    // ─── 11. فاصل سفلي ───
    const sep2Y = scanY + 22;
    const sepGrad2 = ctx.createLinearGradient(40, 0, W-40, 0);
    sepGrad2.addColorStop(0,   'transparent');
    sepGrad2.addColorStop(0.5, 'rgba(201,162,39,0.35)');
    sepGrad2.addColorStop(1,   'transparent');
    ctx.strokeStyle = sepGrad2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, sep2Y); ctx.lineTo(W-40, sep2Y); ctx.stroke();

    // ─── 12. شارة الخصوصية ───
    const privY = sep2Y + 22;
    ctx.fillStyle   = 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); _roundRect(ctx, 56, privY-14, W-112, 26, 13); ctx.fill(); ctx.stroke();
    ctx.font      = '12px Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText('🔒  بطاقة شخصية — للاستخدام الخاص فقط', cx, privY+3);

    // ─── 13. تذييل ───
    ctx.font      = '11px Arial';
    ctx.fillStyle = 'rgba(201,162,39,0.45)';
    ctx.fillText('🌱  نادي غرس  ©  2026', cx, H-16);

    // ─── 14. تحميل بأعلى جودة ───
    const link    = document.createElement('a');
    link.download = 'ghars-qr-' + (user.name||user.username).replace(/\\s+/g,'-') + '.png';
    link.href     = canvas.toDataURL('image/png', 1.0);
    link.click();

    if (btn) { btn.disabled = false; btn.innerHTML = '⬇️ تحميل'; }
    UI.toast('✅ تم تحميل البطاقة بجودة احترافية', 'success', 2500);

  } catch(err) {
    console.error('downloadQRCard error:', err);
    if (btn) { btn.disabled = false; btn.innerHTML = '⬇️ تحميل'; }
    UI.toast('⚠️ تعذّر التحميل — تحقق من الاتصال وحاول مجدداً', 'error', 3000);
  }
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function shareQRWhatsApp(encodedUrl, encodedName) {
  const name = decodeURIComponent(encodedName);
  const url = decodeURIComponent(encodedUrl);
  const msg = `🌱 *نادي غرس*\n👤 تسجيل الدخول لـ: *${name}*\n\n📲 اضغط الرابط لتسجيل الدخول تلقائياً:\n${url}`;
  // wa.me = واتساب الشخصي فقط
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

function _resizeImage(dataUrl, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // استخدم أقصى حجم ممكن للجودة العالية
      const MAX = Math.max(maxSize || 800, 800);
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
      else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      // تحسين جودة الرسم
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = dataUrl;
  });
}
// ── ضغط مطوّل على شريط العد التنازلي → يُخفى لساعتين ──
function _setupCountdownLongPress() {
  const bar = document.getElementById('countdownBar');
  if (!bar) return;
  const hideUntil = parseInt(localStorage.getItem('ghars__cdHideUntil')||'0');
  if (Date.now() < hideUntil) { bar.style.display='none'; return; }
  let _lpT=null;
  const startH=()=>{ _lpT=setTimeout(()=>{ _lpT=null; localStorage.setItem('ghars__cdHideUntil',String(Date.now()+7200000)); bar.style.display='none'; UI.toast('تم إخفاء العد التنازلي لساعتين','info',2500); },600); };
  const cancelH=()=>{ if(_lpT){clearTimeout(_lpT);_lpT=null;} };
  bar.addEventListener('touchstart', startH,  {passive:true});
  bar.addEventListener('touchend',   cancelH, {passive:true});
  bar.addEventListener('touchcancel',cancelH, {passive:true});
  bar.addEventListener('mousedown',  startH);
  bar.addEventListener('mouseup',    cancelH);
  bar.addEventListener('mouseleave', cancelH);
}
// ============================================================
// ميزة الاستبيان — المعلم
// ============================================================
let _currentSurveyMeetingId = null;

async function openMeetingSurveyPage(meetingId) {
  _currentSurveyMeetingId = meetingId;
  navigate('survey-submissions');
}

async function loadSurveySubmissionsPage() {
  const mid = _currentSurveyMeetingId;
  if (!mid) { navigate('meetings'); return; }

  const listEl = document.getElementById('surveySubmissionsList');
  if (!listEl) return;

  listEl.innerHTML = `<div class="no-data"><div class="no-data-icon" style="font-size:2rem">⏳</div><p>جاري التحميل...</p></div>`;

  const [meeting, survey, responses, users] = await Promise.all([
    GharsDB.get('meetings/' + mid),
    GharsDB.get('lesson_surveys/' + mid),
    GharsDB.getAll('lesson_survey_responses'),
    GharsDB.getAll('users')
  ]);

  const now = Date.now();
  const meetingDate = new Date(meeting?.date || Date.now()).getTime();
  const isPast = (meetingDate + 24*60*60*1000) < now;
  const surveyActive = survey && survey.expiresAt && new Date(survey.expiresAt).getTime() > now;
  const surveyExpired = survey && survey.expiresAt && new Date(survey.expiresAt).getTime() <= now;
  const hasSurvey = !!(survey && survey.activatedAt);

  const myResponses = Object.values(responses).filter(r => r.meetingId === mid);

  // ── تحديث شريط العنوان ليتضمن زر الحذف إذا كان هناك استبيانات ──
  const titleEl = document.getElementById('surveySubmissionsTitle');
  if (titleEl) titleEl.textContent = `📋 استبيانات: ${meeting?.title || 'لقاء'}`;

  const headerActionsEl = document.getElementById('surveySubmissionsHeaderActions');
  if (headerActionsEl) {
    if (myResponses.length > 0) {
      headerActionsEl.innerHTML = `<button onclick="confirmDeleteAllSurveys('${mid}')"
        style="background:rgba(229,62,62,0.15);color:#e53e3e;border:1.5px solid rgba(229,62,62,0.3);border-radius:10px;padding:7px 13px;font-family:Tajawal,sans-serif;font-size:0.78rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;transition:all 0.2s"
        onmouseover="this.style.background='rgba(229,62,62,0.25)'" onmouseout="this.style.background='rgba(229,62,62,0.15)'">
        🗑 مسح الاستبيانات
      </button>`;
    } else {
      headerActionsEl.innerHTML = '';
    }
  }

  let html = '';

  // --- بطاقة حالة الاستبيان ---
  if (!isPast) {
    if (!survey) {
      html += `<div class="card mb-2" style="border:2px solid rgba(201,162,39,0.4);border-radius:14px;overflow:hidden">
        <div class="card-body" style="padding:18px 16px;text-align:center">
          <div style="font-size:2.2rem;margin-bottom:10px">📚</div>
          <div style="font-weight:800;font-size:1rem;color:var(--navy);margin-bottom:6px">انتهى الدرس؟ فعّل الاستبيان</div>
          <div style="font-size:0.8rem;color:var(--gray);margin-bottom:16px">سيظهر للطلاب استبيان لمدة 24 ساعة</div>
          <button class="finish-lesson-btn" onclick="finishLesson('${mid}')">
            ✅ تم الانتهاء من الدرس
          </button>
        </div>
      </div>`;
    } else if (surveyActive) {
      const expDate = new Date(survey.expiresAt);
      html += `<div class="card mb-2" style="border:2px solid rgba(56,161,105,0.4);border-radius:14px;overflow:hidden">
        <div class="card-body" style="padding:16px;display:flex;align-items:center;gap:14px">
          <div style="font-size:2rem">✅</div>
          <div style="flex:1">
            <div style="font-weight:800;font-size:0.9rem;color:#276749">الاستبيان مفعّل</div>
            <div style="font-size:0.75rem;color:var(--gray);margin-top:3px">ينتهي: ${formatArabicDate(expDate)} · ${GharsUtils.formatTime(expDate)}</div>
          </div>
          <span class="online-dot"></span>
        </div>
      </div>`;
    }
  } else if (surveyExpired) {
    html += `<div class="card mb-2" style="border:2px solid rgba(160,160,160,0.3);border-radius:14px;overflow:hidden">
      <div class="card-body" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="font-size:1.6rem">📊</div>
        <div style="font-weight:700;font-size:0.85rem;color:var(--gray)">انتهت مدة الاستبيان</div>
      </div>
    </div>`;
  } else if (!survey) {
    html += `<div class="card mb-2" style="border:2px solid rgba(160,160,160,0.3);border-radius:14px;overflow:hidden">
      <div class="card-body" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
        <div style="font-size:1.6rem">📭</div>
        <div style="font-weight:700;font-size:0.85rem;color:var(--gray)">لم يتم تفعيل استبيان لهذا اللقاء</div>
      </div>
    </div>`;
  }

  // --- قائمة الطلاب الذين أرسلوا ---
  html += `<div class="card" style="border-radius:14px;overflow:hidden">
    <div class="card-header">
      <h3>📩 الاستبيانات الواردة <span style="background:rgba(201,162,39,0.15);color:var(--gold);border-radius:20px;padding:2px 10px;font-size:0.78rem">${myResponses.length}</span></h3>
    </div>
    <div class="card-body" style="padding:0">`;

  if (!myResponses.length) {
    html += `<div class="no-data" style="padding:28px"><div class="no-data-icon">📭</div><p>لم يرسل أي طالب استبياناً بعد</p></div>`;
  } else {
    myResponses
      .sort((a,b) => new Date(b.submittedAt) - new Date(a.submittedAt))
      .forEach(r => {
        const stars = '★'.repeat(r.stars || 0) + '☆'.repeat(5 - (r.stars || 0));
        const starColor = (r.stars||0) >= 4 ? '#c9a227' : (r.stars||0) >= 2 ? '#ed8936' : '#e53e3e';
        html += `<div class="survey-student-row" onclick="viewSurveyDetail('${mid}','${r.studentId}')">
          <div class="seen-avatar">${(r.studentName||'?').charAt(0)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:0.88rem;color:var(--navy)">${e(r.studentName||'طالب')}</div>
            <div style="font-size:0.72rem;color:var(--gray);margin-top:2px">${r.comment ? '💬 أرسل تعليقاً' : 'بدون تعليق'}</div>
          </div>
          <div class="survey-stars-display" style="color:${starColor};font-size:1rem">${stars}</div>
          <span style="color:var(--gray);font-size:0.8rem">›</span>
        </div>`;
      });
  }

  html += `</div></div>`;
  listEl.innerHTML = html;
}

async function confirmDeleteAllSurveys(meetingId) {
  const confirmed = await UI.confirm(
    'سيتم مسح جميع استبيانات هذا اللقاء نهائياً من قاعدة البيانات. هل أنت متأكد؟',
    'مسح جميع الاستبيانات'
  );
  if (!confirmed) return;
  UI.toast('⏳ جاري المسح...', 'info', 2000);
  try {
    const responses = await GharsDB.getAll('lesson_survey_responses');
    const toDelete = Object.entries(responses).filter(([, r]) => r.meetingId === meetingId);
    await Promise.all(toDelete.map(([key]) => GharsDB.delete('lesson_survey_responses/' + key)));
    GharsDB._invalidate('lesson_survey_responses');
    UI.toast('✅ تم مسح جميع الاستبيانات', 'success', 3000);
    loadSurveySubmissionsPage();
  } catch(err) {
    console.error('confirmDeleteAllSurveys:', err);
    UI.toast('حدث خطأ أثناء المسح', 'error');
  }
}

async function finishLesson(meetingId) {
  const btn = event.target.closest('button');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحقق...'; }

  const meeting = await GharsDB.get('meetings/' + meetingId);

  // ── يجب تحضير الطلاب أولاً قبل تفعيل الاستبيان ──
  const attendance = meeting?.attendance || {};
  const attendanceCount = Object.keys(attendance).length;
  if (attendanceCount === 0) {
    UI.toast('⚠️ يجب تحضير الطلاب أولاً قبل تفعيل الاستبيان', 'error', 4000);
    if (btn) { btn.disabled = false; btn.textContent = '✅ تم الانتهاء من الدرس'; }
    return;
  }

  if (btn) btn.textContent = '⏳ جاري التفعيل...';

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // ── استخراج قائمة الطلاب الحاضرين فقط ──
  const presentStudents = Object.entries(attendance)
    .filter(([, status]) => status === 'present')
    .map(([sid]) => sid);

  await GharsDB.set('lesson_surveys/' + meetingId, {
    meetingId,
    meetingTitle: meeting?.title || 'لقاء',
    activatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    activatedBy: Auth.currentUser?.id,
    presentStudents
  });

  UI.toast('✅ تم تفعيل الاستبيان! سيظهر للطلاب الحاضرين الآن', 'success', 3500);
  loadSurveySubmissionsPage();
}

async function viewSurveyDetail(meetingId, studentId) {
  const responses = await GharsDB.getAll('lesson_survey_responses');
  const key = meetingId + '_' + studentId;
  const r = responses[key] || Object.values(responses).find(x => x.meetingId===meetingId && x.studentId===studentId);

  if (!r) { UI.toast('لم يُعثر على الاستبيان', 'error'); return; }

  const titleEl = document.getElementById('surveyDetailTitle');
  const contentEl = document.getElementById('surveyDetailContent');
  if (titleEl) titleEl.textContent = `📊 استبيان: ${e(r.studentName||'طالب')}`;

  const starsHtml = Array.from({length:5},(_,i)=>{
    const filled = i < (r.stars||0);
    return `<span style="font-size:2rem;color:${filled?'#c9a227':'#ddd'}">${filled?'★':'☆'}</span>`;
  }).join('');

  const understandMap = ['','لم أفهم شيئاً','فهمت قليلاً','فهمت بشكل متوسط','فهمت معظمه','فهمت الدرس تماماً'];

  if (contentEl) contentEl.innerHTML = `
    <div class="card" style="border-radius:14px;overflow:hidden;margin-bottom:12px">
      <div class="card-header" style="background:linear-gradient(135deg,var(--navy),#1a3a6b)">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="seen-avatar" style="width:44px;height:44px;font-size:1.1rem">${(r.studentName||'?').charAt(0)}</div>
          <div>
            <div style="font-weight:800;font-size:0.95rem;color:#fff">${e(r.studentName||'طالب')}</div>
            <div style="font-size:0.72rem;color:rgba(201,162,39,0.8);margin-top:3px">${r.submittedAt ? new Date(r.submittedAt).toLocaleString('ar-SA') : ''}</div>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-weight:700;font-size:0.82rem;color:var(--gray);margin-bottom:8px">مدى فهم الطالب للدرس</div>
          <div style="display:flex;justify-content:center;gap:6px;margin-bottom:6px">${starsHtml}</div>
          <div style="font-size:1rem;font-weight:800;color:var(--navy)">${understandMap[r.stars||0]||''}</div>
          <div style="margin-top:6px;background:rgba(201,162,39,0.1);border-radius:20px;padding:4px 16px;display:inline-block">
            <span style="font-size:1.3rem;font-weight:900;color:var(--gold)">${r.stars||0}</span>
            <span style="font-size:0.8rem;color:var(--gray)">/5</span>
          </div>
        </div>
        ${r.comment ? `
        <div style="background:#f8fafc;border-radius:12px;border:1.5px solid #e2e8f0;padding:14px">
          <div style="font-weight:700;font-size:0.8rem;color:var(--gray);margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span>💬</span><span>سؤال الطالب</span>
          </div>
          <div style="font-size:0.9rem;color:var(--navy);line-height:1.7">${e(r.comment)}</div>
        </div>` : `
        <div style="text-align:center;padding:14px;color:var(--gray);font-size:0.82rem">
          لم يكتب الطالب أي تعليق أو سؤال
        </div>`}
      </div>
    </div>`;

  navigate('survey-detail');
}

async function finishLessonFromList(meetingId) {
  const meeting = await GharsDB.get('meetings/' + meetingId);
  const now = new Date();
  const existing = await GharsDB.get('lesson_surveys/' + meetingId);
  if (existing && existing.expiresAt && new Date(existing.expiresAt).getTime() > Date.now()) {
    UI.toast('الاستبيان مفعّل بالفعل لهذا اللقاء', 'info');
    return;
  }
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await GharsDB.set('lesson_surveys/' + meetingId, {
    meetingId,
    meetingTitle: meeting?.title || 'لقاء',
    activatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    activatedBy: Auth.currentUser?.id
  });
  UI.toast('✅ تم تفعيل الاستبيان! سيظهر للطلاب الآن', 'success', 3500);
  loadMeetings();
}