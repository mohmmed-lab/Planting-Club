// ============================================================
// GHARS CLUB — Student JS v4
// ============================================================
'use strict';

let currentPage = 'home';
let pageHistory = [];
let cdTimer = null;
let currentHw = null;
let hwAnswers = {};
let hwStartTime = null;
let hwSolveTimer = null;
let hwWarnings = 0;
const HW_MAX_WARNINGS = 3;
let _cheatListeners = null;
let _sHwTimers = {};
let _studentFirstLoad = false;
let _directAnswerViewActive = false; // منع تحميل قائمة الإجابات عند عرض واجب محدد

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!await Auth.requireAuth('student')) return;
  
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
    headerUser.onclick = () => showMyProfile();
  }
  const now = new Date();
  const updated = { ...user, lastSeen:now.toISOString(), lastSeenDay:GharsUtils.arabicDay(now), lastSeenHijri:GharsUtils.hijriShort(now), online:true };
  await GharsDB.set('users/'+user.id, updated);
  Auth.currentUser = updated;
  localStorage.setItem('ghars__session', JSON.stringify(updated));

  const hash = location.hash.replace('#','');
  const validPages = ['home','seerah','homework','points-detail','memo-detail','lesson-view','my-answers','sharebox','survey'];
  const startPage = validPages.includes(hash) ? hash : 'home';

  window.addEventListener('popstate', (ev) => {
    const p = (ev.state && ev.state.page) ? ev.state.page : 'home';
    navigateSilent(p);
  });

  _setupCountdownLongPress();

  _studentFirstLoad = true;
  navigate(startPage, true);
  await Promise.all([loadStudentHome(), loadUpcomingMeeting()]);
  _studentFirstLoad = false;

  // ── إزالة شاشة التحميل بعد الانتهاء من تجهيز الصفحة تماماً (يمنع الوميض) ──
  document.body.classList.remove('app-loading');

  _setupStudentRealtimeListeners();

  window.addEventListener('ghars:connected', function _onFirstConnect() {
    window.removeEventListener('ghars:connected', _onFirstConnect);
    ['homework','lessons','meetings','groups','points_summary',
     'share_posts','memorization','system','submissions','users']
      .forEach(function(c){ GharsDB._invalidate(c); });
    onStudentPageLoad(currentPage); 
  });

  setTimeout(checkStudentNotifications, 2000);
  setTimeout(checkLessonSurvey, 2500);
  document.addEventListener('visibilitychange', function() {
    if(document.visibilityState === 'visible') {
      checkStudentNotifications();
      checkLessonSurvey();
    }
  });
});

// ⚠️ تأكد من حذف هذا الكود تماماً إن وجد في ملف student.js:
// window.addEventListener('load', function() {
//   var _hash = location.hash.replace('#','');
//   if (_hash && document.getElementById('section-'+_hash)) {
//     _activatePage(_hash);
//   }
// });

function _setupStudentRealtimeListeners() {
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
    
    // إعادة تحميل القوائم بناءً على الصفحة الحالية
    if (typeof loadStudents === 'function' && currentPage === 'students') loadStudents();
    if (typeof loadTeachers === 'function' && currentPage === 'teachers') loadTeachers();
    if (typeof loadHomeStats === 'function') loadHomeStats();
    if (typeof loadLastSeen === 'function') loadLastSeen();
  });
  
  // ── مزامنة الدروس في الوقت الحقيقي (تعديل المعلم يظهر للطالب فوراً) ──
  GharsDB.listen('lessons', () => {
    GharsDB._invalidate('lessons');
    if (currentPage === 'seerah') {
      loadStudentSeerah();
    } else if (currentPage === 'lesson-view') {
      // إعادة تحميل الدرس المفتوح إذا تغيّر
      const lessonId = document.getElementById('lessonViewContent')?.dataset?.lessonId;
      if (lessonId) {
        GharsDB.get('lessons/'+lessonId).then(function(lesson) {
          if (lesson && !lesson.deleted) buildLessonView(lessonId, lesson).catch(()=>{});
          else { localStorage.removeItem('ghars__currentLessonId'); navigate('seerah', true); }
        }).catch(()=>{});
      }
    }
  });

  // ── مزامنة الواجبات في الوقت الحقيقي ──
  GharsDB.listen('homework', () => {
    GharsDB._invalidate('homework');
    GharsDB._invalidate('submissions');
    if (currentPage === 'homework') loadStudentHomework();
    else if (currentPage === 'lesson-view') {
      // تحديث زر الواجب داخل الدرس المفتوح
      const lessonId = document.getElementById('lessonViewContent')?.dataset?.lessonId;
      if (lessonId) {
        GharsDB.get('lessons/'+lessonId).then(function(lesson) {
          if (lesson && !lesson.deleted) buildLessonView(lessonId, lesson).catch(()=>{});
        }).catch(()=>{});
      }
    }
  });

  // ── مزامنة اللقاءات في الوقت الحقيقي ──
  GharsDB.listen('meetings', () => {
    GharsDB._invalidate('meetings');
    if (currentPage === 'home') loadStudentHome();
    else if (currentPage === 'points-detail') loadPointsDetail();
    // ── إعادة فحص الاستبيان عند تغيّر التحضير ──
    checkLessonSurvey();
  });

  // ── مزامنة الاستبيانات في الوقت الحقيقي ──
  GharsDB.listen('lesson_surveys', () => {
    GharsDB._invalidate('lesson_surveys');
    checkLessonSurvey();
  });

  // ── مزامنة النقاط في الوقت الحقيقي ──
  GharsDB.listen('points_summary', () => {
    GharsDB._invalidate('points_summary');
    if (currentPage === 'home') loadStudentHome();
    else if (currentPage === 'points-detail') loadPointsDetail();
  });
}

// ============================================================
// NAVIGATION
// ============================================================
function navigate(page, skipHistory=false) {
  if (!skipHistory) {
    pageHistory.push(currentPage);
    history.pushState({ page }, '', '#'+page);
  } else {
    history.replaceState({ page }, '', '#'+page);
  }
  _showTopBar();
  _activatePage(page);
}
function navigateSilent(page) { _activatePage(page); }

// ── شريط التقدم العلوي ──
function _showTopBar() {
  var bar = document.getElementById('ghars-topbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ghars-topbar';
    document.body.appendChild(bar);
  }
  bar.classList.remove('done');
  bar.style.opacity = '1';
  bar.style.width = '0%';
  // محاكاة تقدم سريع
  var w = 0;
  var steps = [15, 35, 55, 75, 88];
  var idx = 0;
  bar._timer = setInterval(function() {
    if (idx < steps.length) {
      bar.style.width = steps[idx] + '%';
      idx++;
    } else {
      clearInterval(bar._timer);
    }
  }, 80);
  // إخفاء بعد انتهاء التحميل
  setTimeout(function() {
    clearInterval(bar._timer);
    bar.classList.add('done');
    setTimeout(function() {
      bar.classList.remove('done');
      bar.style.width = '0%';
      bar.style.opacity = '1';
    }, 600);
  }, 500);
}
function _activatePage(page) {
  // إيقاف الفيديو عند مغادرة صفحة الدرس
  if (currentPage === 'lesson-view' && page !== 'lesson-view') {
    const vid = document.getElementById('lessonVid');
    if (vid) { try { vid.pause(); vid.currentTime = 0; } catch(_) {} }
    const frames = document.querySelectorAll('#section-lesson-view iframe');
    frames.forEach(fr => { try { fr.src = fr.src; } catch(_) {} });
  }
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });
  const sec = document.getElementById('section-'+page);
  if (sec) {
    sec.classList.add('active');
    if (page === 'sharebox') {
      sec.style.display = 'flex';
      sec.style.flexDirection = 'column';
    } else {
      sec.style.display = 'block';
    }
  }
  // إخفاء/إظهار الهيدر وشريط العد عند صندوق المشاركات
  const topHeader   = document.querySelector('.top-header');
  const countdownBr = document.getElementById('countdownBar');
  const footer      = document.querySelector('footer.footer');
  const isSharebox  = (page === 'sharebox');
  if (topHeader)   topHeader.style.display   = isSharebox ? 'none' : '';
  if (countdownBr && isSharebox) countdownBr.style.display = 'none';
  if (footer)      footer.style.display      = isSharebox ? 'none' : '';

  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.page===page));
  currentPage=page; closeSidebar();
  if (!isSharebox) window.scrollTo({top:0,behavior:'smooth'});
  onStudentPageLoad(page);
}
function onStudentPageLoad(page) {
  if (_studentFirstLoad && page === 'home') return;
  switch(page) {
    case 'home':          loadStudentHome(); break;
    case 'seerah':        loadStudentSeerah(); break;
    case 'homework':      loadStudentHomework(); break;
    case 'points-detail': loadPointsDetail(); break;
    case 'memo-detail':   loadMemoDetail(); break;
    case 'lesson-view': {
      // عند تحديث الصفحة: استرجع الدرس من localStorage
      const _savedLessonId = localStorage.getItem('ghars__currentLessonId');
      const _existingLessonId = document.getElementById('lessonViewContent')?.dataset?.lessonId;
      if (_existingLessonId) {
        // الدرس محمّل بالفعل — لا داعي لإعادة التحميل
      } else if (_savedLessonId) {
        GharsDB._invalidate('lessons');
        GharsDB.get('lessons/'+_savedLessonId).then(function(lesson){
          if(lesson && !lesson.deleted) {
            buildLessonView(_savedLessonId, lesson).catch(function(){
              navigate('seerah', true);
            });
          } else {
            navigate('seerah', true);
          }
        }).catch(function(){ navigate('seerah', true); });
      } else {
        // لا يوجد درس محفوظ — انتقل لقائمة الدروس
        navigate('seerah', true);
      }
      break;
    }
    case 'my-answers':    loadMyAnswers(); break;
    case 'survey':
      if (_surveyPendingData) {
        _renderSurveyPage(_surveyPendingData);
      } else {
        // لا استبيان نشط — ارجع للرئيسية
        navigate('home', true);
      }
      break;
    case 'sharebox':
      loadShareBox();
      // إذا Supabase غير متصل بعد، أعد التحميل عند الاتصال
      if(!_sbOK) {
        window.addEventListener('ghars:connected', function _sbSharebox() {
          window.removeEventListener('ghars:connected', _sbSharebox);
          if(currentPage === 'sharebox') { GharsDB._invalidate('share_posts'); loadShareBox(); }
        }, {once: true});
      }
      break;
  }
}
function toggleSidebar() {
  const sb=document.getElementById('sidebar'), ov=document.getElementById('sidebarOverlay');
  if(!sb||!ov) return;
  const opening=!sb.classList.contains('open');
  sb.classList.toggle('open'); ov.classList.toggle('open');
  if(opening) {
    document.querySelectorAll('.nav-item').forEach(item=>{
      item.addEventListener('click',navRipple,{once:true});
    });
  }
}
function navRipple(e) {
  const btn=e.currentTarget;
  const r=document.createElement('span'); r.className='ripple-effect';
  const sz=Math.max(btn.offsetWidth,btn.offsetHeight);
  r.style.cssText=`width:${sz}px;height:${sz}px;top:50%;left:50%;margin-top:-${sz/2}px;margin-left:-${sz/2}px`;
  btn.appendChild(r); setTimeout(()=>r.remove(),700);
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}

// ============================================================
// HOME
// ============================================================
async function loadStudentHome() {
  const uid=Auth.currentUser.id;
  GharsDB._invalidate('points_summary');
  GharsDB._invalidate('meetings');
  GharsDB._invalidate('groups');
  const [ptsData,meetings,groups]=await Promise.all([
    GharsDB.get('points_summary/'+uid), GharsDB.getAll('meetings'), GharsDB.getAll('groups')
  ]);
  const total=ptsData?.total||0;
  const ptsEl=document.getElementById('studentPoints');
  if(ptsEl){ ptsEl.textContent=total; ptsEl.style.animation='none'; ptsEl.offsetHeight; ptsEl.style.animation='countUp 0.6s both ease'; }
  await renderGroupsRanking(groups);
  renderAttendanceRecords(meetings);
}
function getTaskBadge(val) {
  const map={
    sport:  {label:'🏃 رياضي',   bg:'linear-gradient(135deg,#c6f6d5,#9ae6b4)',color:'#22543d',border:'rgba(56,161,105,0.5)'},
    social: {label:'🤝 اجتماعي',bg:'linear-gradient(135deg,#bee3f8,#90cdf4)',color:'#1a365d',border:'rgba(49,130,206,0.5)'},
    culture:{label:'📚 ثقافي',  bg:'linear-gradient(135deg,#e9d8fd,#d6bcfa)',color:'#44337a',border:'rgba(128,90,213,0.5)'},
  };
  const t=map[val]; if(!t) return '';
  return `<span style="background:${t.bg};color:${t.color};border:1.5px solid ${t.border};border-radius:16px;padding:3px 10px;font-size:0.72rem;font-weight:800;white-space:nowrap">${t.label}</span>`;
}
async function renderGroupsRanking(groups) {
  const c=document.getElementById('groupsRanking'); if(!c) return;
  const sorted=Object.values(groups).sort((a,b)=>(b.points||0)-(a.points||0));
  if(!sorted.length){c.innerHTML='<p style="color:var(--gray);text-align:center;font-size:0.85rem">لا توجد مجموعات</p>';return;}
  const medals=['🥇','🥈','🥉'];
  const now=Date.now();
  // دائماً نجلب أحدث بيانات اللقاءات
  const meetings=await GharsDB.getAll('meetings');
  const upcoming=Object.values(meetings)
    .filter(m=>!m.deleted)
    .sort((a,b)=>new Date(a.date)-new Date(b.date));
  // اللقاء القادم أو الحالي
  const nextMeeting = upcoming.find(m=>new Date(m.date).getTime()>(now-86400000))||null;
  // مهام المجموعات — نأخذها دائماً إن وجدت
  const groupTasks = (nextMeeting && nextMeeting.groupTasks) ? nextMeeting.groupTasks : {};

  c.innerHTML=sorted.map((g,i)=>{
    const taskVal = groupTasks[g.id] || 'none';
    const badge = (taskVal && taskVal!=='none') ? getTaskBadge(taskVal) : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--radius-sm);background:var(--white);border:1px solid var(--gray-mid);margin-bottom:8px;cursor:pointer;animation:fadeInUp 0.3s ${i*0.06}s both ease;transition:box-shadow 0.25s ease,transform 0.2s ease" onclick="showGroupStudents('${g.id}','${e(g.name)}')" onmouseover="this.style.boxShadow='var(--shadow-md)';this.style.transform='translateY(-1px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:1.2rem">${medals[i]||'🏅'}</span>
        <span style="font-weight:800;color:var(--navy)">${e(g.name)}</span>
        ${badge}
      </div>
      <span class="badge badge-gold">⭐ ${g.points||0}</span>
    </div>`;
  }).join('');
}

async function showGroupStudents(groupId, groupName) {
  const [users, ptsData] = await Promise.all([
    GharsDB.getAll('users'),
    GharsDB.getAll('points_summary')
  ]);
  const members = Object.values(users)
    .filter(u => u.role==='student' && !u.deleted && u.group === groupName)
    .map(u => ({ ...u, pts: ptsData[u.id]?.total||0 }))
    .sort((a,b) => b.pts - a.pts);

  const rankColors = ['#c9a227','#8892a4','#cd7f32'];
  const rankBg    = ['rgba(201,162,39,0.12)','rgba(136,146,164,0.1)','rgba(205,127,50,0.1)'];
  const medals    = ['🥇','🥈','🥉'];

  const listHtml = members.length
    ? members.map((m,i) => {
        const rank = i+1;
        const isMe = m.id === Auth.currentUser.id;
        const rc = i===0?'#c9a227':i===1?'#8892a4':i===2?'#cd7f32':'var(--navy)';
        const rb = isMe?'linear-gradient(135deg,rgba(201,162,39,0.14),rgba(201,162,39,0.07))':(i===0?'rgba(201,162,39,0.06)':'#f8fafc');
        return `<div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:var(--radius-sm);
          background:${rb};border:${isMe?'2px solid rgba(201,162,39,0.5)':'1px solid var(--gray-mid)'};
          margin-bottom:7px;animation:fadeInUp 0.3s ${i*0.05}s both ease">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--navy),var(--navy-light));color:var(--gold);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.82rem;flex-shrink:0">${m.name.charAt(0)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:${isMe?'900':'700'};font-size:0.9rem;color:var(--navy);word-break:break-word">${e(m.name)}${isMe?'<span style="margin-right:5px;font-size:0.75rem;color:var(--gold);font-weight:800"> 👈 أنت</span>':''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <span style="font-size:0.95rem">${medals[i]||'🏅'}</span>
            <span style="font-weight:900;font-size:0.85rem;color:${rc};min-width:24px;text-align:center;background:rgba(0,0,0,0.06);border-radius:8px;padding:1px 6px">#${rank}</span>
            <span style="background:rgba(201,162,39,0.15);color:var(--gold-dark);border:1px solid rgba(201,162,39,0.3);border-radius:20px;padding:2px 10px;font-size:0.78rem;font-weight:800;white-space:nowrap">⭐ ${m.pts}</span>
          </div>
        </div>`;
      }).join('')
    : '<p style="color:var(--gray);text-align:center;padding:20px 0;font-size:0.88rem">لا يوجد طلاب في هذه المجموعة</p>';

  UI.showModal(`<div class="modal" style="max-width:420px">
    <div class="modal-header" style="background:linear-gradient(135deg,var(--navy),var(--navy-light))">
      <h3 style="color:var(--gold)">🏆 ${e(groupName)}</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:16px;max-height:70vh;overflow-y:auto">
      <div style="text-align:center;margin-bottom:14px;font-size:0.8rem;color:var(--gray);font-weight:600">ترتيب الأعضاء حسب النقاط</div>
      ${listHtml}
    </div>
    <div class="modal-footer">
      <button class="btn btn-gray" data-close-modal>إغلاق</button>
    </div>
  </div>`);
}
function renderAttendanceRecords(meetings) {
  const uid=Auth.currentUser.id;
  const c=document.getElementById('attendanceRecords'); if(!c) return;
  const list=Object.values(meetings).filter(m=>!m.deleted&&m.attendance&&m.attendance[uid]);
  if(!list.length){c.innerHTML='<p style="color:var(--gray);text-align:center;font-size:0.85rem">لا توجد سجلات</p>';return;}
  const sorted=list.sort((a,b)=>new Date(a.date)-new Date(b.date));
  c.innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:8px">`+sorted.map((m,i)=>{
    const st=m.attendance[uid];
    const day=GharsUtils.arabicDay(new Date(m.date)), date=GharsUtils.toHijriShort(new Date(m.date));
    const cls=st==='present'?'status-present':st==='absent'?'status-absent':'status-excused';
    const lbl=st==='present'?'حاضر':st==='absent'?'غائب':'مستأذن';
    return `<div class="attend-record" style="animation:zoomIn 0.3s ${i*0.04}s both ease">
      <div class="attend-day">${day}</div><div class="attend-date">${date}</div>
      <span class="attend-status ${cls}">${lbl}</span>
    </div>`;
  }).join('')+'</div>';
}
async function loadUpcomingMeeting() {
  if(cdTimer) clearInterval(cdTimer);
  const bar=document.getElementById('countdownBar');
  // تحقق من الإخفاء المؤقت
  const hideUntil=parseInt(localStorage.getItem('ghars__cdHideUntil')||'0');
  if(Date.now()<hideUntil){if(bar)bar.style.display='none';return;}
  
  GharsDB._invalidate('meetings');
  const meetings=await GharsDB.getAll('meetings');
  const now=Date.now();
  const allUpcoming=Object.values(meetings)
    .filter(m=>!m.deleted && new Date(m.date).getTime()>(now-86400000))
    .sort((a,b)=>new Date(a.date)-new Date(b.date));
  
  if(!allUpcoming.length){if(bar)bar.style.display='none';return;}
  
  // اللقاء القادم الذي لم يبدأ بعد
  const next = allUpcoming.find(m=>new Date(m.date).getTime()>now) || allUpcoming[0];
  
  if(bar) bar.style.display='flex';
  const tt=document.getElementById('cdMeetingTitle');
  if(tt) tt.textContent = next.title || 'لقاء قادم';
  
  // إخفاء مهام المجموعات من الشريط
  const cdGroupTasksEl = document.getElementById('cdGroupTasks');
  if(cdGroupTasksEl) cdGroupTasksEl.style.display = 'none';
  
  cdTimer=GharsUtils.countdown(next.date,({done,days,hours,minutes,seconds})=>{
    if(done){
      if(bar)bar.style.display='none';
      clearInterval(cdTimer);
      // إعادة التحميل بعد انتهاء العد للبحث عن لقاء آخر
      setTimeout(()=>loadUpcomingMeeting(), 1000);
      return;
    }
    const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v).padStart(2,'0');};
    s('cdDays',days);s('cdHours',hours);s('cdMins',minutes);s('cdSecs',seconds);
  });
  
  // تنظيف تلقائي للمشاركات كل 100 ساعة
  _autoCleanSharePosts();
}

// ============================================================
// POINTS DETAIL — horizontal layout, no lesson_view
async function loadPointsDetail() {
  const uid = Auth.currentUser.id;
  GharsDB._invalidate('points_summary');
  GharsDB._invalidate('meetings');
  const [pts, meetings] = await Promise.all([
    GharsDB.get('points_summary/' + uid),
    GharsDB.getAll('meetings')
  ]);
  const c = document.getElementById('pointsDetailCard');
  if (!c) return;
 
  const breakdown = (pts?.breakdown) || [];
  const total     = pts?.total || 0;
 
  // ── جميع اللقاءات مرتبة من الأحدث للأقدم ──
  const allMeetings = Object.values(meetings)
    .filter(m => !m.deleted)
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // الأحدث أولاً
 
  // ── بناء قائمة معرِّفات اللقاءات مرتبة حسب التاريخ ──
  // نجمع معرِّفات اللقاءات من allMeetings + من breakdown
  const meetingDateMap = {};
  allMeetings.forEach(m => { meetingDateMap[m.id] = new Date(m.date).getTime(); });
  breakdown.forEach(b => {
    if (b.meetingId && !meetingDateMap[b.meetingId] && b.date) {
      meetingDateMap[b.meetingId] = new Date(b.date).getTime();
    }
  });
 
  // دمج المعرِّفات بدون تكرار ثم ترتيب صريح بالتاريخ (الأحدث أعلى)
  const uniqueIds = [...new Set([
    ...allMeetings.map(m => m.id),
    ...breakdown.filter(b => b.meetingId).map(b => b.meetingId)
  ])].sort((a, b) => (meetingDateMap[b] || 0) - (meetingDateMap[a] || 0));
 
  const meetingCards = uniqueIds.map(mid => {
    const m       = meetings[mid];
    const mItems  = breakdown.filter(b => b.meetingId === mid);
    if (!mItems.length && !m) return '';
 
    const att     = mItems.find(b => b.type === 'attendance');
    const task    = mItems.find(b => b.type === 'task');
    const comment = mItems.find(b => b.type === 'lesson_comment');
    const initEntries = mItems.filter(b => b.type === 'initiative');
 
    const title    = m?.title || att?.meetingTitle || task?.meetingTitle || 'لقاء';
    const date     = m?.date;
    const rowTotal = (att?.points || 0) + (task?.points || 0) +
                     (comment?.points || 0) +
                     initEntries.reduce((a, b) => a + (b.points || 0), 0);
 
    const attStatus = att?.status;
    const attColor  = attStatus === 'present' ? 'var(--green)' :
                      attStatus === 'absent'  ? 'var(--red)'   : '#e6a800';
    const attIcon   = attStatus === 'present' ? '✅' :
                      attStatus === 'absent'  ? '❌' : '⚠️';
 
    return `<div style="border:1px solid var(--gray-mid);border-radius:var(--radius);margin-bottom:10px;overflow:hidden;animation:fadeInUp 0.35s both ease;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
      <div style="background:linear-gradient(135deg,var(--navy),var(--navy-light));padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:800;font-size:0.9rem;color:#fff">📅 ${e(title)}</div>
          ${date ? `<div style="font-size:0.72rem;color:rgba(255,255,255,0.6)">${GharsUtils.toHijriShort(new Date(date))}</div>` : ''}
        </div>
        <span style="background:rgba(201,162,39,0.2);color:var(--gold);border:1px solid rgba(201,162,39,0.4);border-radius:20px;padding:3px 10px;font-weight:700;font-size:0.82rem">⭐ ${rowTotal}</span>
      </div>
      <div style="padding:12px 14px">
        <div class="pts-row-horizontal">
          ${att ? `<div class="pts-cell">
            <div class="pts-cell-icon">${attIcon}</div>
            <div class="pts-cell-label">الحضور</div>
            <div class="pts-cell-value ${att.points > 0 ? 'positive' : 'zero'}" style="color:${attColor}">
              ${att.points > 0 ? '+' + att.points : '—'}
            </div>
          </div>` : ptsCellH('✅', 'الحضور', null)}
          ${ptsCellH('📚', 'الواجب', task)}
          ${ptsCellH('💬', 'التعليق', comment)}
        </div>
        ${initEntries.length ? `<div style="background:#fffaf0;border-radius:8px;padding:8px 12px;font-size:0.82rem;display:flex;justify-content:space-between;margin-top:8px">
          <span>⭐ نقاط المبادرات</span>
          <span style="font-weight:700;color:var(--gold)">+${initEntries.reduce((a,b) => a + (b.points||0), 0)}</span>
        </div>` : ''}
        ${task && task.note ? `<div style="font-size:0.72rem;color:var(--gray);margin-top:6px;text-align:center">${e(task.note)}</div>` : ''}
      </div>
    </div>`;
  }).filter(Boolean).join('');
 
  // نقاط إضافية بدون لقاء
  const noMeetingInit = breakdown.filter(b => b.type === 'initiative' && !b.meetingId);
  const extraCard = noMeetingInit.length ? `<div style="border:1px solid var(--gray-mid);border-radius:var(--radius);margin-bottom:10px;overflow:hidden;animation:fadeInUp 0.35s both ease">
    <div style="background:linear-gradient(135deg,var(--gold-dark),var(--gold));padding:10px 14px;color:var(--navy)">
      <div style="font-weight:800;font-size:0.9rem">⭐ نقاط إضافية</div>
    </div>
    <div style="padding:12px 14px">
      ${noMeetingInit.map(b => `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:0.82rem;border-bottom:1px solid var(--gray-mid)">
        <span style="color:var(--navy);font-weight:700">نقاط إضافية</span>
        <span style="font-weight:800;color:var(--gold)">+${b.points}</span>
      </div>`).join('')}
    </div>
  </div>` : '';
 
  const empty = !meetingCards && !extraCard;
 
  c.innerHTML = (empty
    ? `<div class="card"><div class="card-body"><p style="color:var(--gray);text-align:center">لا توجد لقاءات مسجلة بعد</p></div></div>`
    : '') +
    meetingCards +
    extraCard +
    (!empty ? `<div style="background:linear-gradient(135deg,var(--navy),var(--navy-light));border-radius:var(--radius);padding:20px;text-align:center;animation:fadeInUp 0.5s both ease;box-shadow:0 8px 32px rgba(10,22,40,0.35)">
      <div style="font-size:0.82rem;color:rgba(255,255,255,0.6)">إجمالي نقاطي</div>
      <div style="font-size:2.8rem;font-weight:900;color:var(--gold);text-shadow:0 0 30px var(--gold-glow)">⭐ ${total}</div>
    </div>` : '');
}
function ptsCellH(icon,label,entry) {
  const pts=entry?.points??null;
  const hasData=pts!==null;
  const cls=hasData&&pts>0?'positive':'zero';
  return `<div class="pts-cell">
    <div class="pts-cell-icon">${icon}</div>
    <div class="pts-cell-label">${label}</div>
    <div class="pts-cell-value ${cls}">${hasData?(pts>0?'+'+pts:'-'):'—'}</div>
  </div>`;
}

// ============================================================
// MEMO DETAIL
// ============================================================
async function loadMemoDetail() {
  const uid=Auth.currentUser.id;
  GharsDB._invalidate('memorization');
  GharsDB._invalidate('system');
  const [memo,settings]=await Promise.all([GharsDB.get('memorization/'+uid),GharsDB.get('system/settings')]);
  const score=memo?.score||0, target=settings?.targetMemorization||30;
  const pct=target>0?Math.min(100,Math.round((score/target)*100)):0;
  const done=score>=target&&target>0;
  const r=65,circ=2*Math.PI*r,offset=circ-(pct/100)*circ;
  const card=document.getElementById('memoDetailCard'); if(!card) return;
  card.innerHTML=`<div class="card-body" style="text-align:center;padding:28px 20px">
    <svg width="160" height="160" viewBox="0 0 160 160" style="transform:rotate(-90deg)">
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="14"/>
      <circle cx="80" cy="80" r="${r}" fill="none"
        stroke="${done?'var(--green)':'url(#gGold)'}" stroke-width="14"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${circ.toFixed(2)}"
        stroke-linecap="round" id="memoCircleBar"/>
      <defs><linearGradient id="gGold" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:var(--gold-dark)"/>
        <stop offset="100%" style="stop-color:var(--gold-light)"/>
      </linearGradient></defs>
      <text x="80" y="88" text-anchor="middle" font-family="Tajawal,sans-serif" font-size="26" font-weight="900"
        fill="${done?'#38a169':'var(--navy)'}" transform="rotate(90,80,80)">${pct}%</text>
    </svg>
    <div style="font-size:1.5rem;font-weight:900;margin-top:12px;color:var(--navy)">${score} / ${target}</div>
    <div style="display:inline-block;margin-top:10px;padding:10px 22px;border-radius:24px;font-weight:700;
      background:${done?'var(--green-light)':'rgba(201,162,39,0.1)'};
      color:${done?'var(--green)':'var(--gold-dark)'};
      border:1px solid ${done?'rgba(56,161,105,0.3)':'rgba(201,162,39,0.3)'}">
      ${done?'🎉 أحسنت! أتممت المقرر بالكامل':`💪 تبقى ${target-score} فقط`}
    </div>
  </div>`;
  // Animate circle fill
  setTimeout(()=>{
    const bar=document.getElementById('memoCircleBar');
    if(bar) bar.style.cssText=`stroke-dashoffset:${offset.toFixed(2)};transition:stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)`;
  },100);
}

// ============================================================
// SHARE BOX — صندوق المشاركات
// ============================================================
function openShareBox() {
  navigate('sharebox');
}

async function loadShareBox() {
  const uid   = Auth.currentUser?.id;
  const uname = Auth.currentUser?.name || '';
  const cont  = document.getElementById('shareBoxContent');
  if (!cont) return;

  GharsDB._invalidate('system');
  GharsDB._invalidate('share_posts');
  const settings   = await GharsDB.get('system/settings') || {};
  const chatEnabled = settings.shareBoxEnabled !== false;

  const allPosts = await GharsDB.getAll('share_posts');
  // كل رسائل هذا الطالب (من الطالب ومن المعلمين)
  const posts = Object.values(allPosts)
    .filter(p => p && p.studentId === uid)
    .sort((a,b) => new Date(a.at) - new Date(b.at));

  // ── بناء رسائل المحادثة ──
  let messagesHtml = '';
  if (posts.length) {
    messagesHtml = posts.map((p, i) => {
      const isTeacher = !!p.isTeacherReply;
      // ── تعريف editBadge هنا داخل الـ map ──
      const editBadge = p.editedAt
        ? '<span style="font-size:0.58rem;opacity:0.5;margin-left:3px">(معدّل)</span>'
        : '';
      const postAge = Date.now() - new Date(p.at).getTime();

      // ── رسالة المعلم (يسار) ──
      if (isTeacher) {
        return `
        <div style="display:flex;justify-content:flex-start;align-items:flex-end;gap:8px;margin-bottom:12px;animation:fadeInUp 0.18s ${i*0.015}s both ease"
          data-postid="${e(p.id)}">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#c9a227,#a07d10);
                      display:flex;align-items:center;justify-content:center;font-size:1rem;
                      flex-shrink:0;box-shadow:0 2px 6px rgba(201,162,39,0.3)">👨‍🏫</div>
          <div style="max-width:75%">
            <div style="background:#fff;border:1px solid #e2e8f0;
                        border-radius:4px 18px 18px 18px;padding:11px 14px;
                        box-shadow:0 1px 4px rgba(0,0,0,0.08)">
              <div style="font-size:0.88rem;color:#1a202c;line-height:1.75;white-space:pre-wrap;word-break:break-word">${e(p.text)}</div>
              <div style="font-size:0.6rem;color:rgba(0,0,0,0.3);margin-top:5px">${GharsUtils.timeAgo(p.at)}</div>
            </div>
          </div>
        </div>`;
      }

      // ── رسالة الطالب (يمين) ──
      const canEdit = (postAge < 2*60*60*1000);
      return `
      <div style="display:flex;justify-content:flex-end;align-items:flex-end;gap:8px;margin-bottom:12px;animation:fadeInUp 0.18s ${i*0.015}s both ease"
        data-postid="${e(p.id)}"
        ${canEdit ? `data-postat="${e(p.at)}"` : ''}>
        <div style="max-width:75%">
          <div style="background:linear-gradient(135deg,#0a1628,#1a3a6b);
                      border-radius:18px 18px 18px 4px;padding:11px 14px;
                      box-shadow:0 2px 8px rgba(0,0,0,0.18)"
            ${canEdit ? 'ontouchstart="_startLongPressEl(event,this)" ontouchend="_cancelLongPress()" ontouchcancel="_cancelLongPress()" onmousedown="_startLongPressEl(event,this)" onmouseup="_cancelLongPress()" onmouseleave="_cancelLongPress()"' : ''}>
            <div style="font-size:0.88rem;color:#fff;line-height:1.75;white-space:pre-wrap;word-break:break-word">${e(p.text)}</div>
            <div style="font-size:0.6rem;color:rgba(201,162,39,0.7);margin-top:5px;text-align:right">
              ${editBadge}${GharsUtils.timeAgo(p.at)}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  } else {
    messagesHtml = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:40px 20px;opacity:0.5">
        <div style="font-size:3.5rem;margin-bottom:14px">💬</div>
        <div style="font-weight:700;font-size:0.92rem;color:#555">ابدأ محادثتك مع المعلم</div>
        <div style="font-size:0.78rem;color:#aaa;margin-top:6px;text-align:center">اكتب مشاركتك وسيرد عليك المعلم هنا</div>
      </div>`;
  }

  const sendBtn = `
    <button onclick="sendSharePost()" id="sharePostSendBtn"
      style="width:50px;height:50px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;
             background:linear-gradient(135deg,#c9a227,#a07d10);
             display:flex;align-items:center;justify-content:center;
             box-shadow:0 4px 16px rgba(201,162,39,0.5);
             transition:transform 0.15s,box-shadow 0.2s;
             position:relative;overflow:hidden"
      onmouseover="this.style.transform='scale(1.1)';this.style.boxShadow='0 6px 22px rgba(201,162,39,0.65)'"
      onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 4px 16px rgba(201,162,39,0.5)'">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 12L21 3L12 21L10 14L3 12Z" fill="#0a1628" stroke="#0a1628" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    </button>`;

  const inputArea = chatEnabled
    ? `<div style="display:flex;align-items:flex-end;gap:10px;padding:10px 14px 12px;background:#fff;border-top:1px solid #edf2f7">
        <textarea id="sharePostBox" placeholder="اكتب مشاركتك..." rows="1"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"
          style="flex:1;background:#f7f9fc;border:1.5px solid #e2e8f0;border-radius:24px;
                 padding:12px 18px;font-family:Tajawal,sans-serif;font-size:0.9rem;
                 color:#0a1628;resize:none;outline:none;direction:rtl;line-height:1.6;
                 max-height:120px;overflow-y:auto;caret-color:#c9a227;
                 transition:border-color 0.2s,box-shadow 0.2s;box-shadow:none"
          onfocus="this.style.borderColor='#c9a227';this.style.boxShadow='0 0 0 3px rgba(201,162,39,0.12)';this.style.background='#fff'"
          onfocusout="this.style.borderColor='#e2e8f0';this.style.boxShadow='none';this.style.background='#f7f9fc'"></textarea>
        ${sendBtn}
      </div>`
    : `<div style="padding:12px 16px;background:#fff;border-top:1px solid rgba(229,62,62,0.12);text-align:center">
        <div style="font-size:0.82rem;font-weight:700;color:#e53e3e">🔒 تم إيقاف إرسال الرسائل مؤقتاً</div>
        <div style="font-size:0.72rem;color:#aaa;margin-top:3px">يمكنك مشاهدة مشاركاتك السابقة</div>
      </div>`;

  // ── ضبط styles الـ container ──
  cont.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;';

  cont.innerHTML = `
    <div id="shareMessagesArea"
      style="flex:1;min-height:0;overflow-y:auto;padding:14px 12px 8px;background:#f0f4f8;display:flex;flex-direction:column">
      ${messagesHtml}
    </div>
    <div id="shareInputBar"
      style="flex-shrink:0;width:100%;background:#fff;box-shadow:0 -1px 0 #edf2f7">
      ${inputArea}
    </div>`;

  // ── تمرير للأسفل ──
  requestAnimationFrame(() => {
    const area = document.getElementById('shareMessagesArea');
    if (area) area.scrollTop = area.scrollHeight;
  });
}

let _lpTimer = null;
function _startLongPressEl(ev, innerEl) {
  // ابحث عن الـ postid في الـ parent
  const wrapper = innerEl.closest('[data-postid]');
  if (!wrapper) return;
  const postId = wrapper.dataset.postid;
  const postedAt = wrapper.dataset.postat;
  if (!postId || !postedAt) return;
  const age = Date.now() - new Date(postedAt).getTime();
  if (age >= 2 * 60 * 60 * 1000) return;
  _lpTimer = setTimeout(() => { _lpTimer = null; showPostOptions(postId); }, 600);
}
function _startLongPress(ev, postId, postedAt) {
  const age = Date.now() - new Date(postedAt).getTime();
  if (age >= 2 * 60 * 60 * 1000) return;
  _lpTimer = setTimeout(() => { _lpTimer = null; showPostOptions(postId); }, 600);
}
function _cancelLongPress() {
  if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
}

function showPostOptions(postId) {
  const safeId = e(postId);
  UI.showModal(`<div class="modal" style="max-width:280px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">خيارات المشاركة</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:12px;display:flex;flex-direction:column;gap:8px">
      <button onclick="this.closest('.modal-overlay').remove();editSharePost('${safeId}')"
        style="background:#f0f4ff;border:1px solid #c3d0f5;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#1a3a6b;display:flex;align-items:center;gap:8px">
        ✏️ تعديل المشاركة
      </button>
      <button onclick="this.closest('.modal-overlay').remove();deleteSharePost('${safeId}')"
        style="background:#fff5f5;border:1px solid #fcd0d0;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#c53030;display:flex;align-items:center;gap:8px">
        🗑️ حذف المشاركة
      </button>
    </div>
  </div>`);
}

async function sendSharePost() {
  const box = document.getElementById('sharePostBox');
  const text = box?.value?.trim();
  if (!text) { UI.toast('يرجى كتابة مشاركتك', 'error'); return; }
  if (text.length > 2000) { UI.toast('المشاركة طويلة جداً (الحد الأقصى 2000 حرف)', 'error'); return; }
  const uid   = Auth.currentUser?.id;
  const uname = Auth.currentUser?.name || '';
  if (!uid) { UI.toast('يرجى تسجيل الدخول أولاً', 'error'); return; }
  const post  = { id:GharsUtils.uid(), studentId:uid, studentName:uname, text, at:new Date().toISOString() };
  // ── تفريغ الـ input فوراً قبل الحفظ لتجربة أفضل ──
  if (box) { box.value = ''; box.style.height = 'auto'; }
  // ── حفظ وتحديث الواجهة ──
  await GharsDB.set('share_posts/'+post.id, post);
  GharsDB._invalidate('share_posts');
  await loadShareBox();
}

async function deleteSharePost(postId) {
  if (!await UI.confirm('حذف هذه المشاركة نهائياً؟', 'حذف')) return;
  await GharsDB.delete('share_posts/'+postId);
  if (_sbOK && _sb) {
    try { await _sb.from('ghars_data').delete().eq('collection','share_posts').eq('doc_id',postId); } catch(_){}
  }
  UI.toast('🗑️ تم حذف المشاركة', 'info', 2000);
  await loadShareBox();
}

async function editSharePost(postId) {
  const post = await GharsDB.get('share_posts/'+postId);
  if (!post) return;
  UI.showModal(`<div class="modal" style="max-width:360px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">✏️ تعديل المشاركة</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:14px">
      <textarea id="editPostBox" rows="4"
        style="width:100%;border:2px solid rgba(201,162,39,0.4);border-radius:10px;padding:10px 12px;font-family:Tajawal,sans-serif;font-size:0.88rem;resize:none;direction:rtl;outline:none;background:#f8fafc;color:#0a1628">${e(post.text)}</textarea>
    </div>
    <div class="modal-footer" style="gap:8px">
      <button class="btn btn-primary" onclick="saveEditPost('${postId}')">💾 تعديل</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}

async function saveEditPost(postId) {
  const text = document.getElementById('editPostBox')?.value?.trim();
  if (!text) { UI.toast('يرجى كتابة النص', 'error'); return; }
  const post = await GharsDB.get('share_posts/'+postId);
  if (!post) return;
  await GharsDB.set('share_posts/'+postId, {...post, text, editedAt: new Date().toISOString()});
  document.querySelector('.modal-overlay')?.remove();
  UI.toast('✅ تم التعديل', 'success', 2000);
  await loadShareBox();
}

// ============================================================
// SEERAH
// ============================================================
async function loadStudentSeerah() {
  // ═══ FIX: تحديث من السيرفر دائماً ═══
  GharsDB._invalidate('lessons');
  const lessons=await GharsDB.getAll('lessons');
  const c=document.getElementById('seerahList');
  // لا تظهر الدروس المحذوفة أو المخفية للطلاب
  const list=Object.values(lessons).filter(l=>!l.deleted && !l.hidden).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  if(!list.length){c.innerHTML=`<div class="no-data"><div class="no-data-icon">📚</div><p>لا توجد دروس</p></div>`;return;}
  c.innerHTML=list.map((l,i)=>{
    // أنواع المحتوى الموجودة في الدرس
    const contentBadges=[];
    if(l.youtubeUrl||(l.videoSource==='youtube'&&l.videoUrl)) contentBadges.push('<span class="content-badge content-yt">▶️ يوتيوب</span>');
    if((l.videoSource==='upload'&&l.videoUrl)||l.uploadedVideoUrl) contentBadges.push('<span class="content-badge content-video">🎥 فيديو</span>');
    if(l.pdfUrl) contentBadges.push('<span class="content-badge content-pdf">📄 PDF</span>');
    // لا نظهر شارة الموضوع في قائمة الدروس
    return `<div class="lesson-v2" style="animation-delay:${i*0.07}s">
      <div class="lesson-v2-header">
        <div style="font-size:1.7rem">📚</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:0.93rem;color:#fff">${e(l.title)}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.55);margin-top:3px">${GharsUtils.toHijriShort(new Date(l.createdAt))}</div>
          ${contentBadges.length?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">${contentBadges.join('')}</div>`:''}
        </div>
      </div>
      <div class="lesson-v2-body">
        <button class="btn btn-sm" style="width:100%;justify-content:center;background:linear-gradient(135deg,var(--gold),var(--gold-dark));color:var(--navy);font-weight:800;padding:11px;font-size:0.88rem;border-radius:10px;box-shadow:0 3px 12px rgba(201,162,39,0.4)" onclick="openLesson('${l.id}')">👁 دخول الدرس</button>
      </div>
    </div>`;
  }).join('');
}

async function openLesson(id) {
  try {
    // ═══ FIX: تحديث الكاش قبل فتح الدرس ═══
    GharsDB._invalidate('lessons');
    const lesson=await GharsDB.get('lessons/'+id);
    if(!lesson){UI.toast('لم يتم العثور على الدرس','error');return;}
    const uid=Auth.currentUser.id;
    // Mark viewed
    const viewers=[...(lesson.viewers||[])];
    if(!viewers.find(v=>v.studentId===uid)) {
      viewers.push({studentId:uid,at:new Date().toISOString()});
      // حفظ في الخلفية بدون انتظار (بدون نقاط لمشاهدة الدرس)
      GharsDB.set('lessons/'+id,{...lesson,viewers}).catch(()=>{});
    }
    // بناء الدرس بشكل مستقل عن الواجبات
    await buildLessonView(id,lesson);
    // ═══ حفظ معرف الدرس الحالي لاسترجاعه عند تحديث الصفحة ═══
    localStorage.setItem('ghars__currentLessonId', id);
    navigate('lesson-view');
  } catch(err) {
    console.error('openLesson error:',err);
    UI.toast('حدث خطأ أثناء تحميل الدرس — حاول مجدداً','error');
  }
}

// ─── دالة الفتح الذكي للروابط ─────────────────────────────────────────
// يوتيوب → يفتح تطبيق يوتيوب | انستقرام / تيك توك → تطبيقاتها | غيرها → تبويب جديد
function _openSmartLink(url) {
  if (!url) return;
  // ── يوتيوب: استخراج video ID وفتح التطبيق ──
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?#\s]+)/i);
  if (ytMatch && ytMatch[1]) {
    const vid = ytMatch[1];
    try { window.location.href = 'vnd.youtube:' + vid; } catch(e) {}
    setTimeout(function() { window.open('https://www.youtube.com/watch?v=' + vid, '_blank'); }, 400);
    return;
  }
  if (url.match(/(youtube\.com|youtu\.be)/i)) { window.open(url, '_blank'); return; }
  // ── انستقرام ──
  if (url.match(/instagram\.com/i)) { window.location.href = url; return; }
  // ── تيك توك ──
  if (url.match(/(tiktok\.com|vm\.tiktok\.com)/i)) { window.location.href = url; return; }
  // ── باقي الروابط ──
  window.open(url, '_blank');
}

// دالة عرض موضوع الدرس للطالب — تعرض HTML كما هو مع الأزرار الزرقاء للروابط
function _renderTopicForStudent(t) {
  if (!t) return '';
  if (/<[a-zA-Z]/.test(t)) {
    return t; // الروابط تأتي جاهزة من المعلم
  }
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>')
    .replace(/(https?:\/\/[^\s<>"']+)/g, function(match, url) {
        let appName = 'اضغط هنا';
        let cls = 'ghars-link-generic';
        let svgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;

        if (url.match(/(youtube\.com|youtu\.?be)/i)) {
          appName = 'يوتيوب'; cls = 'ghars-link-youtube';
          svgIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.582 6.186a2.68 2.68 0 0 0-1.884-1.884C18.04 3.84 12 3.84 12 3.84s-6.04 0-7.698.462a2.68 2.68 0 0 0-1.884 1.884C1.956 7.844 1.956 12 1.956 12s0 4.156.462 5.814a2.68 2.68 0 0 0 1.884 1.884C6.04 20.16 12 20.16 12 20.16s6.04 0 7.698-.462a2.68 2.68 0 0 0 1.884-1.884c.462-1.658.462-5.814.462-5.814s0-4.156-.462-5.814zM9.956 15.36V8.64L15.688 12l-5.732 3.36z"/></svg>`;
        } else if (url.match(/instagram\.com/i)) {
          appName = 'إنستقرام'; cls = 'ghars-link-instagram';
          svgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>`;
        } else if (url.match(/(tiktok\.com|vm\.tiktok\.com)/i)) {
          appName = 'تيك توك'; cls = 'ghars-link-tiktok';
          svgIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.18-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.12-3.44-3.17-3.61-5.48-.12-1.7.35-3.41 1.25-4.8 1.27-1.84 3.37-3.07 5.6-3.23.01 1.34-.02 2.68.02 4.02-1.28.1-2.45.85-3.08 1.97-.59 1.1-.56 2.45.1 3.51.68 1.05 1.91 1.71 3.16 1.63 1.19-.07 2.29-.75 2.82-1.81.33-.67.48-1.42.46-2.18-.04-6.3-.01-12.61-.02-18.91l.03-.01z"/></svg>`;
        }

        return `<button onclick="_openSmartLink('${url.replace(/'/g,'&#39;')}')" class="ghars-rich-link ${cls}">${svgIcon} <span>${appName}</span></button>`;
    });
}

async function buildLessonView(id,lesson) {
  const uid = Auth.currentUser.id; // مطلوب لفحص الواجب وحالة الحل
  // Resolve all sources
  const ytUrl = lesson.youtubeUrl || (lesson.videoSource==='youtube' ? lesson.videoUrl : '');
  let uploadUrl = lesson.uploadedVideoUrl || (lesson.videoSource==='upload' ? lesson.videoUrl : '');
  const rawPdfUrl = lesson.pdfUrl || '';

  if(uploadUrl && uploadUrl.startsWith('idb://')) {
    try { uploadUrl = (await GharsFilesDB.resolve(uploadUrl)) || ''; } catch(e) { uploadUrl = ''; }
  }
  let pdfResolved = rawPdfUrl;
  if(pdfResolved && pdfResolved.startsWith('idb://')) {
    try { pdfResolved = (await GharsFilesDB.resolve(pdfResolved)) || ''; } catch(e) { pdfResolved = ''; }
  }

  let mediaHtml = '';

  // YouTube button
  if(ytUrl) {
    mediaHtml += `<div style="text-align:center;padding:16px 0 8px;animation:zoomIn 0.4s both ease">
      <div style="margin-bottom:10px;font-size:0.85rem;color:var(--gray)">مقطع فيديو من يوتيوب</div>
      <button onclick="_openSmartLink('${e(ytUrl).replace(/'/g,'&#39;')}')" class="yt-watch-btn" style="border:none;cursor:pointer;font-family:inherit">
        <span class="yt-icon">▶</span><span>مشاهدة على يوتيوب</span>
      </button>
    </div>`;
  }

  // Uploaded video - improved playback with Firebase Storage support
  if(uploadUrl && !uploadUrl.startsWith('idb://')) {
    const videoType = uploadUrl.includes('.mp4') ? 'video/mp4' : uploadUrl.includes('.webm') ? 'video/webm' : uploadUrl.includes('.mov') ? 'video/mp4' : '';
    mediaHtml += `<div class="video-player-wrap" style="animation:zoomIn 0.4s both ease">
      <video id="lessonVid" controls playsinline webkit-playsinline preload="metadata"
        style="width:100%;max-height:60vh;display:block;background:#000;outline:none;border-radius:var(--radius-sm)"
        oncontextmenu="return false" onerror="handleVideoError(this)">
        ${videoType ? `<source src="${uploadUrl}" type="${videoType}">` : ''}
        <source src="${uploadUrl}">
        متصفحك لا يدعم تشغيل الفيديو
      </video>
    </div>
    <div style="text-align:center;margin-bottom:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
      <button onclick="toggleVideoFullscreen()" class="btn btn-sm" style="background:rgba(0,0,0,0.07);color:var(--navy);font-size:0.78rem">⛶ ملء الشاشة</button>
      <button onclick="tryVideoPlayback()" class="btn btn-sm" style="background:rgba(201,162,39,0.1);color:var(--gold-dark);font-size:0.78rem">▶ تشغيل مجدداً</button>
    </div>`;
    // Auto-play with user gesture fallback
    setTimeout(()=>{
      const vid=document.getElementById('lessonVid');
      if(vid){
        vid.load();
        vid.play().catch(()=>{}); // silently fail if autoplay blocked
      }
    },300);
  } else if(uploadUrl && uploadUrl.startsWith('idb://')) {
    mediaHtml += `<div style="background:var(--red-light);border-radius:10px;padding:12px;text-align:center;font-size:0.85rem;color:var(--red);margin-bottom:10px">⚠️ الفيديو متاح على الجهاز الذي رُفع منه فقط. لتوفيره لجميع الطلاب، يرجى إعداد Firebase Storage</div>`;
  }

  // PDF — العرض المباشر المدمج مع ميزة التكبير
  let pdfHtml = '';
  window._currentPdfUrl = null;
  window._currentPdfTitle = lesson.title;

  // قالب واجهة الـ PDF المشترك
  const pdfViewerTemplate = `
    <div style="background:linear-gradient(135deg,var(--navy),var(--navy-light));padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span style="color:#fff;font-weight:700;font-size:0.9rem">📄 ملف PDF</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="toggleInlinePdf()" class="pdf-action-btn pdf-open-btn">🔍 قراءة الملف</button>
        <button onclick="downloadPdf()" class="pdf-action-btn pdf-dl-btn">⬇️ تحميل</button>
      </div>
    </div>
    <div id="inlinePdfContainer" style="display:none; position:relative; width:100%; height:65vh; background:#e2e8f0; border-top:1px solid var(--gray-mid); transition:all 0.3s ease;">
      <iframe id="inlinePdfIframe" src="" style="width:100%; height:100%; border:none; background-color:#fff;"></iframe>
    </div>
    <div id="pdfHintText" style="background:#f8fafc;padding:8px 16px;font-size:0.78rem;color:var(--gray);text-align:center">اضغط "قراءة الملف" لفتحه داخل الصفحة، أو "تحميل" لتنزيله</div>
  `;

  if(rawPdfUrl) {
    if(rawPdfUrl.startsWith('idb://')) {
      if(pdfResolved) {
        window._currentPdfUrl = pdfResolved;
        pdfHtml = `<div style="border:1px solid var(--gray-mid);border-radius:14px;overflow:hidden;margin-bottom:14px;animation:fadeInUp 0.4s both ease">
          ${pdfViewerTemplate}
        </div>`;
      } else {
        pdfHtml = `<div style="border:1px solid #fbd38d;border-radius:14px;overflow:hidden;margin-bottom:14px;animation:fadeInUp 0.4s both ease">
          <div style="background:linear-gradient(135deg,#744210,#975a16);padding:12px 16px;display:flex;align-items:center;gap:10px">
            <span style="color:#fbd38d;font-size:1.1rem">📄</span>
            <span style="color:#fff;font-weight:700;font-size:0.9rem">ملف PDF</span>
          </div>
          <div style="background:#fffaf0;padding:12px 16px;font-size:0.82rem;color:#744210;text-align:center">
            ⚠️ هذا الملف محفوظ على جهاز المعلم فقط — يرجى التواصل لاستلامه
          </div>
        </div>`;
      }
    } else {
      window._currentPdfUrl = rawPdfUrl;
      pdfHtml = `<div style="border:1px solid var(--gray-mid);border-radius:14px;overflow:hidden;margin-bottom:14px;animation:fadeInUp 0.4s both ease">
        ${pdfViewerTemplate}
      </div>`;
    }
  }

  // Linked HW - check if already solved (non-blocking)
  let hwBtnHtml = '';
  if(lesson.linkedHw) {
    try {
      const [hw,subs]=await Promise.all([
        GharsDB.get('homework/'+lesson.linkedHw),
        GharsDB.getAll('submissions')
      ]);
      if(hw && !hw.deleted) {
        const alreadySolved=Object.values(subs).some(s=>s.homeworkId===lesson.linkedHw&&s.studentId===uid);
        if(alreadySolved) {
          hwBtnHtml=`<div style="margin-bottom:14px;background:var(--green-light);border:1px solid rgba(56,161,105,0.3);border-radius:var(--radius);padding:12px 16px;display:flex;align-items:center;gap:10px;animation:zoomIn 0.4s both ease">
            <span style="font-size:1.4rem">✅</span>
            <span style="font-weight:700;color:var(--green)">تم حل الواجب المرتبط بهذا الدرس مسبقاً</span>
          </div>`;
        } else if(!hw.expired) {
          hwBtnHtml=`<div style="margin-bottom:14px"><button onclick="navigateToLinkedHw('${lesson.linkedHw}')" class="btn btn-primary" style="width:100%;padding:13px;font-size:0.9rem;animation:zoomIn 0.4s both ease">📚 ابدأ حل الواجب المرتبط بالدرس</button></div>`;
        } else {
          hwBtnHtml=`<div style="margin-bottom:14px;background:#fffaf0;border:1px solid #fbd38d;border-radius:var(--radius);padding:12px 16px;font-size:0.85rem;color:#744210;animation:zoomIn 0.4s both ease">⏰ انتهى وقت الواجب المرتبط بهذا الدرس</div>`;
        }
      }
    } catch(e) { /* تجاهل أخطاء الواجب ولا تمنع عرض الدرس */ }
  }

  const topicHtml = lesson.topic ? `<div style="background:#f8fafc;border-radius:var(--radius);padding:14px;margin-bottom:14px;border-right:3px solid var(--gold);animation:fadeInUp 0.4s both ease">
    <div style="font-weight:700;margin-bottom:8px;color:var(--navy);font-size:0.9rem">📝 موضوع الدرس</div>
    <div style="font-size:0.88rem;line-height:1.9;">${_renderTopicForStudent(lesson.topic)}</div>
  </div>` : '';

  const comments = lesson.comments||[];
  const commentsLocked = !!lesson.commentsLocked;
  const commentInputHtml = commentsLocked
    ? `<div style="padding:14px 16px">
        <div style="background:rgba(229,62,62,0.12);border:1.5px solid rgba(229,62,62,0.35);border-radius:12px;padding:14px 16px;text-align:center">
          <div style="font-size:1.4rem;margin-bottom:6px">🔒</div>
          <div style="font-size:0.85rem;font-weight:700;color:#fc8181">قام المعلم بإيقاف التعليقات</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.4);margin-top:4px">يمكنك مشاهدة التعليقات السابقة فقط</div>
        </div>
      </div>`
    : `<div style="padding:14px 16px">
        <div style="position:relative;border-radius:14px;overflow:hidden;border:2px solid rgba(201,162,39,0.45);background:rgba(201,162,39,0.04);box-shadow:0 0 0 0 rgba(201,162,39,0);transition:box-shadow 0.3s,border-color 0.3s"
          onfocusin="this.style.borderColor='rgba(201,162,39,0.8)';this.style.boxShadow='0 0 0 3px rgba(201,162,39,0.15)'"
          onfocusout="this.style.borderColor='rgba(201,162,39,0.45)';this.style.boxShadow='none'">
          <div style="padding:4px 14px 0;font-size:0.7rem;color:rgba(201,162,39,0.6);font-weight:700;margin-top:8px">✍️ اكتب تعليقك</div>
          <textarea id="commentBox"
            placeholder="شارك رأيك وملاحظاتك حول هذا الدرس..."
            rows="3"
            style="width:100%;background:transparent;border:none;outline:none;padding:6px 14px 10px;font-family:Tajawal,sans-serif;font-size:0.88rem;color:#e8dfc8;resize:none;direction:rtl;line-height:1.7;caret-color:#c9a227"
          ></textarea>
          <div style="padding:0 12px 10px;display:flex;justify-content:flex-end">
            <button onclick="sendLessonComment('${id}')" style="background:linear-gradient(135deg,#c9a227,#a07d10);color:#0a1628;border:none;border-radius:10px;padding:8px 20px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(201,162,39,0.35);transition:transform 0.15s,box-shadow 0.15s"
              onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 18px rgba(201,162,39,0.5)'"
              onmouseout="this.style.transform='';this.style.boxShadow='0 4px 14px rgba(201,162,39,0.35)'">
              <span>📤</span><span>إرسال التعليق</span>
            </button>
          </div>
        </div>
      </div>`;

  const commentsHtml = `
    <div style="background:linear-gradient(145deg,#0e1b30,#0a1425);border-radius:18px;overflow:hidden;border:1.5px solid rgba(201,162,39,0.25);margin-top:4px">
      <!-- Section Header -->
      <div style="padding:14px 16px 10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(201,162,39,0.15)">
        <span style="font-size:1.3rem">💬</span>
        <span style="font-weight:800;font-size:0.95rem;color:#e8c84a">التعليقات</span>
        ${commentsLocked ? '<span style="background:rgba(229,62,62,0.2);border:1px solid rgba(229,62,62,0.4);border-radius:20px;padding:2px 10px;font-size:0.68rem;font-weight:800;color:#fc8181;margin-right:auto">🔒 مغلق</span>' : ''}
        ${!commentsLocked && comments.filter(c=>c&&c.text).length ? `<span style="background:rgba(201,162,39,0.18);border:1px solid rgba(201,162,39,0.4);border-radius:20px;padding:2px 10px;font-size:0.7rem;font-weight:800;color:#ffd700;margin-right:auto">${comments.filter(c=>c&&c.text).length}</span>` : ''}
      </div>

      ${commentInputHtml}

      <!-- Divider -->
      <div style="margin:0 16px;height:1px;background:linear-gradient(90deg,transparent,rgba(201,162,39,0.4),rgba(201,162,39,0.7),rgba(201,162,39,0.4),transparent);position:relative">
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#0e1b30;padding:0 10px;font-size:0.7rem;color:rgba(201,162,39,0.7);font-weight:700;white-space:nowrap">✦ التعليقات ✦</div>
      </div>

      <!-- Comments List -->
      <div id="commentsContainer" style="padding:14px 16px;padding-top:18px">
        ${renderComments(comments, id)}
      </div>
    </div>`;

  document.getElementById('lessonViewContent').innerHTML = `<div class="card no-hover">
    <div class="card-header" style="background:linear-gradient(135deg,var(--navy),var(--navy-light));border-bottom:2px solid var(--gold)"><h3 style="color:var(--gold)">🕌 ${e(lesson.title)}</h3></div>
    <div class="card-body">${mediaHtml}${pdfHtml}${hwBtnHtml}${topicHtml}${commentsHtml}</div>
  </div>`;
  document.getElementById('lessonViewContent').dataset.lessonId = id;
}

function handleVideoError(video) {
  const wrap = video.closest('.video-player-wrap');
  if(wrap) wrap.innerHTML = `<div style="background:var(--red-light);border-radius:10px;padding:20px;text-align:center">
    <div style="font-size:2rem;margin-bottom:8px">⚠️</div>
    <div style="font-size:0.88rem;color:var(--red);font-weight:700">تعذر تشغيل الفيديو</div>
    <div style="font-size:0.78rem;color:var(--gray);margin-top:4px">حاول تحديث الصفحة أو استخدام متصفح آخر</div>
  </div>`;
}
function tryVideoPlayback() {
  const v = document.getElementById('lessonVid');
  if(v){ v.load(); v.play().catch(()=>{}); }
}



function renderComments(comments, lessonId) {
  const all = (comments||[]).filter(c => c && c.text && c.at);
  if (!all.length) return `
    <div style="text-align:center;padding:36px 20px">
      <div style="font-size:3.2rem;opacity:0.25;margin-bottom:10px">💬</div>
      <div style="color:#b8975a;font-size:0.85rem;font-weight:700;letter-spacing:0.3px">لا توجد تعليقات بعد — كن أول من يشارك!</div>
    </div>`;

  function getAuthor(c) { return (c.authorName&&c.authorName.trim()) ? c.authorName.trim() : 'طالب'; }
  function isTeacherComment(c) { return !!(c.isTeacherReply||c.role==='teacher'||c.role==='admin'); }

  const myId = Auth.currentUser?.id;
  function getAvatarUrl(sid) {
    if (!sid) return null;
    if (myId && sid === myId && Auth.currentUser?.avatarUrl) return Auth.currentUser.avatarUrl;
    return localStorage.getItem('ghars__avatar__'+sid) || null;
  }

  // ── تجميع: كل تعليق طالب مع رد المعلم في إطار واحد ──
  const groups = [];
  let i = 0;
  while (i < all.length) {
    const c = all[i];
    if (!isTeacherComment(c)) {
      const next = all[i+1];
      if (next && isTeacherComment(next)) {
        groups.push({ student:c, teacher:next, sIdx:i, tIdx:i+1, hasReply:true });
        i += 2;
      } else {
        groups.push({ student:c, teacher:null, sIdx:i, hasReply:false });
        i++;
      }
    } else {
      groups.push({ student:null, teacher:c, tIdx:i, hasReply:false });
      i++;
    }
  }
  groups.reverse();

  // ── ثيمات الألوان — موحّدة ذهبية ──
  const TH_STUDENT_PLAIN = {
    cardBg:'linear-gradient(145deg,#1a2a4a,#0f1e38)',
    headerBg:'linear-gradient(135deg,rgba(201,162,39,0.15),rgba(160,125,16,0.08))',
    border:'1.5px solid rgba(201,162,39,0.3)',
    textBg:'rgba(255,255,255,0.02)', footerBg:'rgba(201,162,39,0.05)',
    nameCl:'#e8c84a', textCl:'#ddd5bb', timeCl:'rgba(201,162,39,0.55)',
    avBg:'linear-gradient(135deg,rgba(201,162,39,0.22),rgba(160,125,16,0.14))', avCl:'#c9a227',
  };
  // الطالب والمعلم بنفس درجة اللون الذهبي في الإطار المشترك
  const TH_STUDENT_GROUPED = {
    cardBg:'linear-gradient(145deg,#12213a,#0e1c32)',
    headerBg:'linear-gradient(135deg,rgba(201,162,39,0.16),rgba(160,125,16,0.09))',
    border:'none', textBg:'rgba(201,162,39,0.03)', footerBg:'rgba(201,162,39,0.06)',
    nameCl:'#e8c84a', textCl:'#ddd5bb', timeCl:'rgba(201,162,39,0.55)',
    avBg:'linear-gradient(135deg,rgba(201,162,39,0.22),rgba(160,125,16,0.14))', avCl:'#c9a227',
  };
  const TH_TEACHER = {
    cardBg:'linear-gradient(145deg,#0f1e0f,#162416)',
    headerBg:'linear-gradient(135deg,rgba(201,162,39,0.22),rgba(160,125,16,0.14))',
    border:'none', textBg:'rgba(201,162,39,0.05)', footerBg:'rgba(201,162,39,0.09)',
    nameCl:'#ffd700', textCl:'#f0e8cc', timeCl:'rgba(255,215,0,0.65)',
    avBg:'linear-gradient(135deg,#c9a227,#a07d10)', avCl:'#0a1628',
  };
  const TH_TEACHER_SOLO = {
    cardBg:'linear-gradient(145deg,#0d1a0d,#1a2e0d)',
    headerBg:'linear-gradient(135deg,rgba(201,162,39,0.32),rgba(160,125,16,0.22))',
    border:'2px solid rgba(201,162,39,0.65)', textBg:'rgba(201,162,39,0.07)', footerBg:'rgba(201,162,39,0.1)',
    nameCl:'#ffd700', textCl:'#f0e6c0', timeCl:'rgba(255,215,0,0.7)',
    avBg:'linear-gradient(135deg,#c9a227,#a07d10)', avCl:'#0a1628',
  };

  function renderCard(c, realIdx, th, isTeacher, isMe) {
    const name = getAuthor(c);
    const avUrl = getAvatarUrl(c.studentId);
    const likes = c.likes||[];
    const iLiked = likes.includes(myId);
    const avStyle = avUrl
      ? `background-image:url('${avUrl}');background-size:cover;background-position:center;color:transparent;cursor:pointer`
      : `background:${th.avBg}`;
    const avContent = avUrl ? '' : `<span style="color:${th.avCl};font-weight:900;font-size:1rem">${e(name.charAt(0).toUpperCase())}</span>`;
    const avClick = avUrl ? `onclick="showUserAvatar('${avUrl}',false)"` : '';
    // الضغط المطول — كل مستخدم على تعليقاته فقط وخلال ساعتين
    const cmtAge = Date.now() - new Date(c.at).getTime();
    const canEdit = isMe && cmtAge < 2 * 60 * 60 * 1000;
    const lpAttrs = canEdit
      ? `ontouchstart="_cmtLP(event,'${lessonId}',${realIdx},'${e(c.text.replace(/'/g,"\\'"))}',false)"
         ontouchend="_cmtLPCancel()" ontouchcancel="_cmtLPCancel()"
         onmousedown="_cmtLP(event,'${lessonId}',${realIdx},'${e(c.text.replace(/'/g,"\\'"))}',false)"
         onmouseup="_cmtLPCancel()" onmouseleave="_cmtLPCancel()"`
      : '';
    return `
      <div style="background:${th.cardBg}" ${lpAttrs}>
        <div style="background:${th.headerBg};padding:10px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(201,162,39,0.12)">
          <div style="width:38px;height:38px;border-radius:50%;${avStyle};flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.4);border:1.5px solid rgba(255,255,255,0.12)" ${avClick}>${avContent}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:800;font-size:0.88rem;color:${th.nameCl};display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${isTeacher
                ? `<span>${e(name)}</span><span style="background:rgba(201,162,39,0.2);border:1px solid rgba(201,162,39,0.5);border-radius:10px;padding:1px 8px;font-size:0.63rem;font-weight:800;color:#ffd700">👨‍🏫 معلم</span>`
                : `<span>${e(name)}</span>${isMe ? `<span style="background:rgba(144,205,244,0.15);border-radius:10px;padding:1px 8px;font-size:0.63rem;font-weight:700;color:${th.nameCl}">أنت</span>` : ''}`}
            </div>
            <div style="font-size:0.66rem;color:${th.timeCl};margin-top:1px">${timeAgo(new Date(c.at))}</div>
          </div>
        </div>
        <div style="background:${th.textBg};padding:11px 14px;font-size:0.87rem;line-height:1.85;color:${th.textCl};white-space:pre-wrap;word-break:break-word">${e(c.text)}</div>
        <div style="background:${th.footerBg};padding:5px 14px 7px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:0.66rem;color:${th.timeCl}">🕐 ${GharsUtils.toHijriShort(new Date(c.at))} · ${GharsUtils.formatTime(new Date(c.at))}</span>
          ${lessonId ? `<button onclick="likeComment('${lessonId}',${realIdx},this)"
            class="ghars-like-btn${iLiked?' liked':''}"
            style="background:${iLiked?'rgba(201,162,39,0.22)':'rgba(201,162,39,0.06)'};border:1px solid ${iLiked?'rgba(201,162,39,0.5)':'rgba(201,162,39,0.18)'};border-radius:20px;padding:3px 11px;cursor:pointer;font-size:0.76rem;font-weight:800;color:${iLiked?'#ffd700':'rgba(201,162,39,0.55)'};display:flex;align-items:center;gap:4px;transition:all 0.25s ease">
            <span class="like-icon" style="display:inline-block;transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1)">${iLiked?'❤️':'🤍'}</span>
            <span class="like-count">${likes.length||''}</span>
          </button>` : ''}
        </div>
      </div>`;
  }

  const items = groups.map((g, gi) => {
    const delay = `${gi*0.05}s`;

    if (g.hasReply && g.student && g.teacher) {
      // ── إطار موحّد ذهبي — بلا فاصل، نفس درجة اللون ──
      const sHtml = renderCard(g.student, g.sIdx, TH_STUDENT_GROUPED, false, g.student.studentId===myId);
      const tHtml = renderCard(g.teacher, g.tIdx, TH_TEACHER, true, false);
      return `<div style="
          border-radius:18px;overflow:hidden;
          border:1.5px solid rgba(201,162,39,0.55);
          background:linear-gradient(145deg,#0e1b30,#0a1425);
          box-shadow:0 6px 28px rgba(201,162,39,0.14),0 2px 8px rgba(0,0,0,0.4);
          animation:fadeInUp 0.38s ${delay} both ease">
        ${sHtml}
        <div style="height:1px;background:rgba(201,162,39,0.18);margin:0 14px;position:relative">
          <span style="position:absolute;right:12px;top:-9px;background:rgba(10,22,40,0.95);
            border:1px solid rgba(201,162,39,0.4);border-radius:12px;
            padding:1px 8px;font-size:0.57rem;font-weight:800;
            color:rgba(201,162,39,0.85);white-space:nowrap">↩ ردّ المعلم</span>
        </div>
        <div style="padding-top:2px">${tHtml}</div>
      </div>`;
    } else if (g.student) {
      return `<div style="border-radius:16px;overflow:hidden;border:${TH_STUDENT_PLAIN.border};box-shadow:${g.student.studentId===myId?'0 4px 20px rgba(201,162,39,0.15)':'0 2px 10px rgba(0,0,0,0.3)'};animation:fadeInUp 0.35s ${delay} both ease">
        ${renderCard(g.student, g.sIdx, TH_STUDENT_PLAIN, false, g.student.studentId===myId)}
      </div>`;
    } else {
      return `<div style="border-radius:16px;overflow:hidden;border:${TH_TEACHER_SOLO.border};box-shadow:0 4px 20px rgba(201,162,39,0.2);animation:fadeInUp 0.35s ${delay} both ease">
        ${renderCard(g.teacher, g.tIdx, TH_TEACHER_SOLO, true, false)}
      </div>`;
    }
  });

  return `<div style="display:flex;flex-direction:column;gap:12px">${items.join('')}</div>`;
}

// إعجاب بتعليق — مع تحديث فوري (optimistic update) وأنيميشن
async function likeComment(lessonId, commentIndex, btnEl) {
  const uid = Auth.currentUser?.id;
  if (!uid) return;

  // ── تحديث فوري للزر (optimistic) ──
  if (btnEl) {
    const icon = btnEl.querySelector('.like-icon');
    const countEl = btnEl.querySelector('.like-count');
    const isLikedNow = btnEl.classList.contains('liked');
    const curCount = parseInt(countEl?.textContent || '0') || 0;

    if (!isLikedNow) {
      // إضافة إعجاب
      btnEl.classList.add('liked');
      btnEl.style.background = 'rgba(201,162,39,0.22)';
      btnEl.style.borderColor = 'rgba(201,162,39,0.5)';
      btnEl.style.color = '#ffd700';
      if (icon) { icon.textContent = '❤️'; icon.style.transform = 'scale(1.5)'; setTimeout(() => { icon.style.transform = 'scale(1)'; }, 300); }
      if (countEl) countEl.textContent = curCount + 1 || 1;
      // confetti-like burst
      _spawnLikeParticles(btnEl);
    } else {
      // إزالة إعجاب
      btnEl.classList.remove('liked');
      btnEl.style.background = 'rgba(201,162,39,0.06)';
      btnEl.style.borderColor = 'rgba(201,162,39,0.2)';
      btnEl.style.color = 'rgba(201,162,39,0.6)';
      if (icon) { icon.textContent = '🤍'; icon.style.transform = 'scale(0.8)'; setTimeout(() => { icon.style.transform = 'scale(1)'; }, 200); }
      if (countEl) countEl.textContent = Math.max(0, curCount - 1) || '';
    }
    btnEl.disabled = true;
  }

  // ── حفظ في قاعدة البيانات ──
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
  } catch(err) {
    console.warn('likeComment error:', err);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

// ── جزيئات الإعجاب ──
function _spawnLikeParticles(btn) {
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ['#ffd700','#c9a227','#ff6b6b','#ff9f43','#ee5a24'];
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    const angle = (i / 8) * 360;
    const dist = 28 + Math.random() * 22;
    const dx = Math.cos(angle * Math.PI / 180) * dist;
    const dy = Math.sin(angle * Math.PI / 180) * dist;
    p.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:6px;height:6px;border-radius:50%;background:${colors[i % colors.length]};pointer-events:none;z-index:9999;transform:translate(-50%,-50%);transition:transform 0.5s ease-out,opacity 0.5s ease-out`;
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0)`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 520);
  }
}

// دالة إظهار أو إخفاء قارئ الـ PDF المدمج
function toggleInlinePdf() {
  const container = document.getElementById('inlinePdfContainer');
  const iframe = document.getElementById('inlinePdfIframe');
  const hint = document.getElementById('pdfHintText');
  const url = window._currentPdfUrl;

  if(!url){ UI.toast('الملف غير متاح حالياً','error'); return; }

  if (container.style.display === 'none') {
    // إظهار الـ Iframe وعرض الملف
    const viewParams = url.includes('#') ? '' : '#view=FitH';
    iframe.src = url + viewParams;
    container.style.display = 'block';
    if (hint) hint.style.display = 'none';
    UI.toast('جاري عرض الملف...', 'info', 1500);
  } else {
    // إخفاء الـ Iframe وتفريغ المصدر لتوفير الذاكرة
    iframe.src = "";
    container.style.display = 'none';
    if (container.classList.contains('pdf-fullscreen-mode')) {
      togglePdfFullscreen(container.querySelector('button'));
    }
    if (hint) hint.style.display = 'block';
  }
}

function downloadPdf() {
  const url = window._currentPdfUrl;
  const title = (window._currentPdfTitle||'ملف').replace(/[\/\\:*?"<>|]/g,'_');
  if(!url){ UI.toast('الملف غير متاح حالياً','error'); return; }

  // حالة blob (من IndexedDB) — تنزيل مباشر
  if(url.startsWith('blob:')) {
    const a = document.createElement('a');
    a.href = url; a.download = title+'.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    UI.toast('جاري التنزيل...','success');
    return;
  }

  // حالة Firebase / HTTPS — fetch أولاً ثم blob
  UI.toast('جاري تجهيز الملف...','info');
  fetch(url, {mode:'cors'})
    .then(r => {
      if(!r.ok) throw new Error('fetch failed');
      return r.blob();
    })
    .then(blob => {
      // تحقق أن الـblob هو PDF فعلاً
      const type = blob.type || 'application/pdf';
      const finalBlob = type.includes('pdf') ? blob : new Blob([blob], {type:'application/pdf'});
      const burl = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = burl; a.download = title+'.pdf';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(burl), 5000);
      UI.toast('تم التنزيل بنجاح ✅','success');
    })
    .catch(() => {
      // Fallback: رابط مباشر مع download attribute
      const a = document.createElement('a');
      a.href = url; a.download = title+'.pdf'; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      UI.toast('سيُفتح الملف في تبويب جديد','info');
    });
}

function toggleVideoFullscreen() {
  const v=document.getElementById('lessonVid'); if(!v) return;
  if(v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  else if(v.requestFullscreen) v.requestFullscreen().catch(()=>{});
  else if(v.mozRequestFullScreen) v.mozRequestFullScreen();
}

function navigateToLinkedHw(hwId) {
  navigate('homework');
  setTimeout(()=>startHomework(hwId),400);
}

// ── ضغط مطوّل على التعليق ──
let _cmtLPTimer = null;
function _cmtLP(ev, lessonId, idx, text, isTeacher) {
  const cacheKey = lessonId + '_' + idx;
  _cmtEditCache[cacheKey] = text;
  _cmtLPTimer = setTimeout(() => {
    _cmtLPTimer = null;
    showCommentOptions(lessonId, idx, text);
  }, 600);
}
function _cmtLPCancel() {
  if (_cmtLPTimer) { clearTimeout(_cmtLPTimer); _cmtLPTimer = null; }
}

let _cmtEditCache = {};

function showCommentOptions(lessonId, idx, text) {
  const cacheKey = lessonId + '_' + idx;
  _cmtEditCache[cacheKey] = text;
  UI.showModal(`<div class="modal" style="max-width:280px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">خيارات التعليق</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:12px;display:flex;flex-direction:column;gap:8px">
      <button onclick="this.closest('.modal-overlay').remove();editCommentStudent('${e(lessonId)}',${idx})"
        style="background:#f0f4ff;border:1px solid #c3d0f5;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#1a3a6b;display:flex;align-items:center;gap:8px">
        ✏️ تعديل التعليق
      </button>
      <button onclick="this.closest('.modal-overlay').remove();deleteCommentStudent('${e(lessonId)}',${idx})"
        style="background:#fff5f5;border:1px solid #fcd0d0;border-radius:10px;padding:12px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer;color:#c53030;display:flex;align-items:center;gap:8px">
        🗑️ حذف التعليق
      </button>
    </div>
  </div>`);
}

async function deleteCommentStudent(lessonId, idx) {
  if (!await UI.confirm('حذف هذا التعليق نهائياً؟','حذف التعليق')) return;
  const lesson = await GharsDB.get('lessons/'+lessonId);
  if (!lesson) return;
  const comments = [...(lesson.comments||[])];
  comments.splice(idx, 1);
  await GharsDB.set('lessons/'+lessonId, {...lesson, comments});
  const cont = document.getElementById('commentsContainer');
  if (cont) cont.innerHTML = renderComments(comments, lessonId);
  UI.toast('🗑️ تم حذف التعليق','info',2000);
}

function editCommentStudent(lessonId, idx) {
  const cacheKey = lessonId + '_' + idx;
  const currentText = _cmtEditCache[cacheKey] || '';
  delete _cmtEditCache[cacheKey];
  UI.showModal(`<div class="modal" style="max-width:360px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b)">
      <h3 style="color:var(--gold);font-size:0.9rem">✏️ تعديل التعليق</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:14px">
      <textarea id="editCmtBox" rows="4"
        style="width:100%;border:2px solid rgba(201,162,39,0.4);border-radius:10px;padding:10px 12px;font-family:Tajawal,sans-serif;font-size:0.88rem;resize:none;direction:rtl;outline:none;background:#f8fafc;color:#0a1628"></textarea>
    </div>
    <div class="modal-footer" style="gap:8px">
      <button class="btn btn-primary" onclick="saveEditComment('${e(lessonId)}',${idx})">💾 تعديل</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
  // ضبط النص بعد إنشاء الـ modal لأمان أكبر
  requestAnimationFrame(() => {
    const ta = document.getElementById('editCmtBox');
    if (ta) ta.value = currentText;
  });
}

async function saveEditComment(lessonId, idx) {
  const text = document.getElementById('editCmtBox')?.value?.trim();
  if (!text) { UI.toast('يرجى كتابة التعليق','error'); return; }
  const lesson = await GharsDB.get('lessons/'+lessonId);
  if (!lesson) return;
  const comments = [...(lesson.comments||[])];
  if (!comments[idx]) return;
  comments[idx] = {...comments[idx], text, editedAt: new Date().toISOString()};
  await GharsDB.set('lessons/'+lessonId, {...lesson, comments});
  document.querySelector('.modal-overlay')?.remove();
  const cont = document.getElementById('commentsContainer');
  if (cont) cont.innerHTML = renderComments(comments, lessonId);
  UI.toast('✅ تم تعديل التعليق','success',2000);
}

async function sendLessonComment(lessonId) {
  const text=document.getElementById('commentBox')?.value?.trim();
  if(!text){UI.toast('يرجى كتابة تعليقك','error');return;}
  if(text.length>1000){UI.toast('التعليق طويل جداً (الحد الأقصى 1000 حرف)','error');return;}
  const user=Auth.currentUser, uid=user.id;
  const lesson=await GharsDB.get('lessons/'+lessonId); if(!lesson) return;
  const comment={studentId:uid,authorName:user.name,text,at:new Date().toISOString(),likes:[]};
  const comments=[...(lesson.comments||[]),comment];
  await GharsDB.set('lessons/'+lessonId,{...lesson,comments});
  // +2 pts if lesson linked to meeting — ONLY if student did NOT cheat in any homework linked to same meeting
  if(lesson.linkedMeeting) {
    const pts=await GharsDB.get('points_summary/'+uid)||{id:uid,total:0,breakdown:[]};
    const alreadyCommented=pts.breakdown?.some(b=>b.type==='lesson_comment'&&b.lessonId===lessonId);
    if(!alreadyCommented) {
      // فحص الغش: هل قام الطالب بالغش في أي واجب مرتبط بنفس اللقاء؟
      let hasCheated = false;
      try {
        const [hwAll, cheatingAll, subsAll] = await Promise.all([
          GharsDB.getAll('homework'),
          GharsDB.getAll('cheating'),
          GharsDB.getAll('submissions')
        ]);
        // الواجبات المرتبطة بنفس اللقاء
        const linkedHws = Object.values(hwAll).filter(h => !h.deleted && h.linkedMeeting === lesson.linkedMeeting);
        for (const hw of linkedHws) {
          // هل يوجد سجل غش لهذا الطالب في هذا الواجب؟
          const cheatKey = 'cheat_' + hw.id + '_' + uid;
          const cheat = cheatingAll[cheatKey]
            || Object.values(cheatingAll).find(ch => ch && ch.homeworkId === hw.id && ch.studentId === uid);
          if (cheat && (cheat.warnings || 0) > 0) { hasCheated = true; break; }
          // أيضاً: تحقق من سجل التسليم نفسه
          const sub = Object.values(subsAll).find(s => s.homeworkId === hw.id && s.studentId === uid);
          if (sub && (sub.zeroByCheat || sub.cheated || (sub.warnings||0) > 0)) { hasCheated = true; break; }
        }
      } catch(e) { /* تجاهل أخطاء الفحص */ }

      if (!hasCheated) {
        const meeting=await GharsDB.get('meetings/'+lesson.linkedMeeting);
        pts.total=(pts.total||0)+2;
        pts.breakdown=[...(pts.breakdown||[]),{type:'lesson_comment',lessonId,meetingId:lesson.linkedMeeting,meetingTitle:meeting?.title||'لقاء',points:2,date:new Date().toISOString()}];
        await GharsDB.set('points_summary/'+uid,pts);
        UI.toast('🎉 حصلت على +2 نقطة على تعليقك!','success',3000);
      }
      // إذا غش: لا نضيف نقاطاً ولا نُظهر رسالة النقاط
    }
  }
  const box=document.getElementById('commentBox');if(box)box.value='';
  const cont=document.getElementById('commentsContainer');if(cont)cont.innerHTML=renderComments(comments, lessonId);
  UI.toast('✅ تم إرسال التعليق','success',2000);
}

// ============================================================
// HOMEWORK
// ============================================================
async function loadStudentHomework() {
  GharsDB._invalidate('homework');
  GharsDB._invalidate('submissions');
  const uid=Auth.currentUser.id;
  const [hwAll,subs]=await Promise.all([GharsDB.getAll('homework'),GharsDB.getAll('submissions')]);
  const now=Date.now();
  const hwList=Object.values(hwAll).filter(h=>!h.deleted);
  // auto-expire
  for(const h of hwList) {
    if(!h.expired&&h.deadline&&new Date(h.deadline).getTime()<=now) {
      await GharsDB.set('homework/'+h.id,{...h,expired:true}); h.expired=true;
    }
  }
  const mySubs=Object.values(subs).filter(s=>s.studentId===uid);
  const sent=hwList.filter(h=>!h.expired);
  const done=hwList.filter(h=> h.expired);
  renderStudentSentHw(sent,mySubs);
  renderStudentDoneHw(done,mySubs);
}

function renderStudentSentHw(list,subs) {
  const c=document.getElementById('studentSentHw');
  if(!list.length){c.innerHTML='<div class="no-data"><div class="no-data-icon">📤</div><p>لا توجد واجبات</p></div>';return;}
  c.innerHTML=list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map((hw,i)=>{
    const sub=subs.find(s=>s.homeworkId===hw.id);
    const isCancelled=sub&&(sub.zeroByCheat||sub.cheated);
    const cancelledBadge=isCancelled?`<span class="badge badge-red" style="font-size:0.65rem;margin-right:6px">ملغي</span>`:'';
    return `<div class="hw-card-v2 ${sub?'solved':''}" style="animation-delay:${i*0.06}s">
      <div class="hw-card-v2-header">
        <div class="hw-card-v2-title">📚 ${e(hw.title)} ${cancelledBadge}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${sub&&!isCancelled?'<span class="badge badge-green" style="font-size:0.68rem">✅ تم</span>':''}
          ${isCancelled?'<span class="badge badge-red" style="font-size:0.68rem">🚫 ملغي</span>':''}
          ${!sub&&hw.deadline?`<span class="timer-pill" id="sHwTimer-${hw.id}">⏳</span>`:''}
        </div>
      </div>
      <div class="hw-card-v2-footer">
        ${sub&&!hw.hideGrade?`<button class="btn btn-outline btn-sm" style="font-size:0.78rem" onclick="viewMyAnswers('${hw.id}')">📋 إجاباتي</button>`:''}
        ${!sub?`<button class="btn btn-primary btn-sm" style="font-size:0.82rem" onclick="startHomework('${hw.id}')">🚀 ابدأ الحل</button>`:''}
      </div>
    </div>`;
  }).join('');
  startStudentHwTimers();
}

function renderStudentDoneHw(list,subs) {
  const c=document.getElementById('studentDoneHw');
  if(!list.length){c.innerHTML='<div class="no-data"><div class="no-data-icon">✅</div><p>لا توجد واجبات منتهية</p></div>';return;}
  c.innerHTML=list.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map((hw,i)=>{
    const sub=subs.find(s=>s.homeworkId===hw.id);
    const isCancelled=sub&&(sub.zeroByCheat||sub.cheated);
    const cancelledBadge=isCancelled?`<span class="badge badge-red" style="font-size:0.65rem;margin-right:6px">ملغي</span>`:'';
    return `<div class="hw-card-v2 expired" style="animation-delay:${i*0.06}s">
      <div class="hw-card-v2-header">
        <div class="hw-card-v2-title">📚 ${e(hw.title)} ${cancelledBadge}</div>
        <span class="badge badge-gray" style="font-size:0.68rem">منتهي</span>
      </div>
      <div class="hw-card-v2-footer">
        ${sub
          ? `<span style="font-size:0.82rem;color:${isCancelled?'var(--red)':'var(--green)'};font-weight:700">${isCancelled?'🚫 ملغي بسبب الغش':'✅ تم التسليم'}</span>
             ${!hw.hideGrade?`<button class="btn btn-outline btn-sm" style="font-size:0.78rem" onclick="viewMyAnswers('${hw.id}')">📋 إجاباتي</button>`:''}`
          : '<span style="font-size:0.82rem;color:var(--red);font-weight:700">❌ لم تحل هذا الواجب</span>'
        }
      </div>
    </div>`;
  }).join('');
}

function startStudentHwTimers() {
  Object.values(_sHwTimers).forEach(t=>clearInterval(t)); _sHwTimers={};
  document.querySelectorAll('[id^="sHwTimer-"]').forEach(el=>{
    const hwId=el.id.replace('sHwTimer-','');
    GharsDB.get('homework/'+hwId).then(hw=>{
      if(!hw||!hw.deadline){el.style.display='none';return;}
      _sHwTimers[hwId]=GharsUtils.countdown(hw.deadline,({done,days,hours,minutes,seconds})=>{
        if(done){el.textContent='انتهى';el.className='timer-pill urgent';clearInterval(_sHwTimers[hwId]);loadStudentHomework();return;}
        let txt;
        if(days>0)       txt=`${days}ي ${hours}س`;
        else if(hours>0) txt=`${hours}س ${minutes}د`;
        else             txt=`${minutes}:${String(seconds).padStart(2,'0')}`;
        el.textContent=txt;
        el.className=(minutes<5&&days===0&&hours===0)?'timer-pill urgent':'timer-pill';
      });
    });
  });
}

function switchStudentHwTab(tab) {
  const sent=document.getElementById('studentSentHw');
  const done=document.getElementById('studentDoneHw');
  if(sent) sent.style.display=tab==='sent'?'block':'none';
  if(done) done.style.display=tab==='done'?'block':'none';
  document.querySelectorAll('#section-homework .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('sHwTabBtn-'+tab)?.classList.add('active');
}
function switchStudentHwTabSwipe(tab,idx){ switchStudentHwTab(tab); }

// ============================================================
// HOMEWORK SOLVING
// ============================================================
async function startHomework(hwId) {
  const hw=await GharsDB.get('homework/'+hwId);
  if(!hw||hw.deleted){UI.toast('الواجب غير متاح','error');return;}
  const uid=Auth.currentUser.id;
  const subs=await GharsDB.getAll('submissions');
  if(Object.values(subs).find(s=>s.homeworkId===hwId&&s.studentId===uid)){UI.toast('سبق أن حللت هذا الواجب','warning');return;}
  if(hw.deadline&&new Date(hw.deadline)<new Date()){UI.toast('انتهى وقت الواجب','error');return;}
  UI.showModal(`<div class="modal" style="max-width:460px">
    <div class="modal-header" style="background:linear-gradient(135deg,var(--navy),#1a3a6b)">
      <h3 style="color:var(--gold)">⚠️ تنبيه قبل بدء الواجب</h3>
    </div>
    <div class="modal-body" style="padding:20px">
      <div style="background:#f0f4ff;border-radius:10px;padding:16px;border-right:4px solid var(--navy)">
        <p style="font-weight:700;color:var(--navy);margin-bottom:10px;font-size:0.95rem">📋   قواعد الواجب الإلزامية :</p>
        <ul style="list-style:none;padding:0;margin:0;font-size:0.87rem;line-height:2.2;color:#374151">
          <li>🔒 لا يُسمح بالخروج أو تبديل الصفحات</li>
          <li>📋 لا يُسمح بنسخ الأسئلة</li>
          <li>📸 لا يُسمح بتصوير الشاشة</li>
          <li>🛠️ لا يُسمح بفتح أدوات المطور</li>
        </ul>
      </div>
      <div style="margin-top:12px;padding:12px 14px;background:linear-gradient(135deg,rgba(10,22,40,0.06),rgba(10,22,40,0.1));border-radius:10px;border:1.5px solid var(--navy);display:flex;align-items:center;gap:10px">
        <span style="font-size:1.6rem">🚫</span>
        <div>
          <div style="font-weight:800;color:var(--navy);font-size:0.9rem">3 مخالفات = درجة صفر وإغلاق الواجب</div>
          <div style="font-size:0.78rem;color:var(--gray);margin-top:2px">يتم تسجيل كل مخالفة تلقائياً وإبلاغ المعلم</div>
        </div>
      </div>
      <div class="warning-dots" style="justify-content:center;margin-top:12px;gap:14px">
        <div class="warning-dot" style="width:18px;height:18px"></div>
        <div class="warning-dot" style="width:18px;height:18px"></div>
        <div class="warning-dot" style="width:18px;height:18px"></div>
        <span style="font-size:0.76rem;color:var(--navy);font-weight:700">← 3 إنذارات = صفر</span>
      </div>
    </div>
    <div class="modal-footer" style="gap:10px">
      <button class="btn btn-gray btn-sm" data-close-modal>إلغاء</button>
      <button class="btn" style="background:linear-gradient(135deg,var(--navy),#1a3a6b);color:var(--gold);font-weight:800" onclick="this.closest('.modal-overlay').remove();openHwFullscreen('${hwId}')">✅ فهمت، ابدأ الواجب</button>
    </div>
  </div>`,{noOverlayClose:false});
}

async function openHwFullscreen(hwId) {
  currentHw=await GharsDB.get('homework/'+hwId); if(!currentHw) return;
  // Normalize questions - Firebase may store arrays as maps
  currentHw.questions = GharsUtils.toArr(currentHw.questions);
  currentHw.questions = currentHw.questions.map(function(q){
    if(!q) return q;
    q.options = GharsUtils.toArr(q.options);
    if(!Array.isArray(q.correctAnswers)) q.correctAnswers = GharsUtils.toArr(q.correctAnswers);
    return q;
  });
  hwAnswers={}; hwWarnings=0; hwStartTime=Date.now();
  const fs=document.getElementById('hwFullscreen');
  fs.style.display='block'; document.body.style.overflow='hidden';
  setEl('hwSolveTitle',currentHw.title);
  updateWarningDots();
  try{if(fs.requestFullscreen)await fs.requestFullscreen().catch(()=>{});else if(fs.webkitRequestFullscreen)fs.webkitRequestFullscreen();}catch(_){}
  const letters='أبجدهوزح';
  const hwQArr=Array.isArray(currentHw.questions)?currentHw.questions:Object.values(currentHw.questions||{});
  document.getElementById('hwSolveBody').innerHTML=hwQArr.map((q,i)=>{
    const isMultiQ=q.isMultiple||q.multiCorrect||q.multipleCorrect;
    return `<div class="card mb-2" style="animation:fadeInUp 0.35s ${i*0.08}s both ease;background:rgba(255,255,255,0.06);border:1.5px solid rgba(201,162,39,0.28)" id="qCard-${i}">
      <div class="card-header" style="background:linear-gradient(135deg,rgba(10,22,40,0.98),rgba(13,31,60,0.95));border-bottom:1px solid rgba(201,162,39,0.3);flex-wrap:wrap;gap:6px">
        <h3 style="font-size:0.88rem;flex:1;color:var(--gold)">س${i+1}: ${e(q.question)} <span class="badge badge-gold" style="font-size:0.68rem">${q.points||1} درجة</span></h3>
        ${isMultiQ?`<span style="background:rgba(201,162,39,0.25);color:var(--gold);border-radius:20px;padding:4px 10px;font-size:0.72rem;font-weight:800;white-space:nowrap">✦ أكثر من إجابة صحيحة</span>`:''}
      </div>
      <div class="card-body" id="optContainer-${i}" style="background:transparent;padding:10px">
        ${(q.options||[]).map((opt,j)=>`
          <div class="option-card" id="opt-${i}-${j}" onclick="selectOption(${i},${j},this,${!!isMultiQ})" style="background:rgba(255,255,255,0.95);border:1.5px solid rgba(201,162,39,0.35);color:#111;margin-bottom:7px">
            <div class="option-letter" style="background:rgba(201,162,39,0.18);color:var(--gold)">${letters[j]||j+1}</div>
            <span style="font-size:0.88rem">${e(opt)}</span>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  if(currentHw.timeLimit&&currentHw.timeLimit>0) {
    let remaining=currentHw.timeLimit*60;
    const timerEl=document.getElementById('hwSolveTimer');
    if(timerEl)timerEl.textContent=GharsUtils.formatSeconds(remaining);
    hwSolveTimer=setInterval(()=>{
      remaining--;
      if(timerEl){timerEl.textContent=GharsUtils.formatSeconds(remaining);if(remaining<=60)timerEl.style.color='var(--red)';}
      if(remaining<=0){clearInterval(hwSolveTimer);forceSubmitHw('انتهى وقت الواجب');}
    },1000);
  } else { const t=document.getElementById('hwSolveTimer');if(t)t.textContent='∞'; }
  setupAntiCheat();
}

function setEl(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function selectOption(qIdx,optIdx,el,isMultiple=false) {
  const q=currentHw.questions[qIdx];
  const isMulti=isMultiple||q?.isMultiple||q?.multiCorrect||q?.multipleCorrect;
  if(isMulti){
    el.classList.toggle('selected');
    const container=document.getElementById('optContainer-'+qIdx);
    const selected=[];
    container?.querySelectorAll('.option-card.selected').forEach((opt,i)=>{
      const idx=parseInt(opt.id.split('-').pop());
      if(!isNaN(idx)) selected.push(q.options[idx]);
    });
    hwAnswers[qIdx]=selected.length>0?selected:null;
  } else {
    document.getElementById('optContainer-'+qIdx)?.querySelectorAll('.option-card').forEach(c=>c.classList.remove('selected'));
    el.classList.add('selected');
    hwAnswers[qIdx]=q.options[optIdx];
  }
  // Clear red highlight when question is answered
  const card=document.getElementById('qCard-'+qIdx);
  if(card&&hwAnswers[qIdx]!==null&&hwAnswers[qIdx]!==undefined){
    card.style.border='';
    card.style.boxShadow='';
  }
}
function updateWarningDots() {
  for(let i=1;i<=3;i++){const d=document.getElementById('wd'+i);if(d)d.classList.toggle('used',i<=hwWarnings);}
}

// ============================================================
// نظام مكافحة الغش الشامل — Anti-Cheat System v5 (Fixed)
// ============================================================
let _acScreenBlocked = false;
let _acLastRecord = {}; // debounce per cheat type
let _acReady = false;   // grace period flag

function setupAntiCheat() {
  removeAntiCheat();
  _acScreenBlocked = false;
  _acLastRecord = {};
  _acReady = false;

  // ── فترة سماح 1.5 ثانية لاستقرار وضع الشاشة الكاملة ──
  const _readyTimer = setTimeout(() => { _acReady = true; }, 1500);
  _cheatListeners = { _readyTimer };

  // ── 1. منع النسخ ──
  const _copyH = (e) => {
    if (!currentHw) return;
    e.preventDefault();
    if (!_acReady) return;
    recordCheat('نسخ السؤال');
  };

  // ── 2. مغادرة الصفحة (تبديل تبويب أو تصغير) ──
  const _visH = () => {
    if (!currentHw || !_acReady) return;
    if (document.hidden) recordCheat('مغادرة صفحة الواجب');
  };

  // ── 3. التنقل بين التطبيقات (window blur) ──
  // نتأكد أن النافذة فعلاً فقدت التركيز لفترة كافية وليس مجرد نقرة عادية
  const _blurH = () => {
    if (!currentHw || !_acReady) return;
    const fs = document.getElementById('hwFullscreen');
    if (!fs || fs.style.display === 'none') return;
    setTimeout(() => {
      // نسجّل فقط إذا: النافذة لا تزال بدون تركيز + الصفحة مرئية (لم تُغطَّ بـ vis)
      if (currentHw && !document.hasFocus() && !document.hidden) {
        recordCheat('التنقل بين التطبيقات');
      }
    }, 700);
  };

  // ── 4. مفاتيح الاختصار ──
  const _keyH = (e) => {
    if (!currentHw) return;
    // PrintScreen — تصوير الشاشة
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
      e.preventDefault();
      _blockScreen();
      if (_acReady) recordCheat('تصوير الشاشة');
      return;
    }
    // Windows + Shift + S (Snipping Tool)
    if ((e.metaKey || e.key === 'Meta') && e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      _blockScreen();
      if (_acReady) recordCheat('تصوير الشاشة');
      return;
    }
    // Ctrl+Shift+4 / Ctrl+Shift+3 (macOS screenshots)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['3','4','5'].includes(e.key)) {
      e.preventDefault();
      _blockScreen();
      if (_acReady) recordCheat('تصوير الشاشة');
      return;
    }
    // Ctrl+C / Cmd+C — نسخ
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      if (_acReady) recordCheat('نسخ السؤال');
      return;
    }
    // Ctrl+P — طباعة
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      if (_acReady) recordCheat('محاولة الطباعة');
      return;
    }
    // مفاتيح محظورة بدون تسجيل مخالفة
    if ((e.ctrlKey || e.metaKey) && ['s','u','a','i'].includes(e.key)) {
      e.preventDefault(); return;
    }
    // F12 — أدوات المطور
    if (e.key === 'F12') {
      e.preventDefault();
      if (_acReady) recordCheat('فتح أدوات المطور');
      return;
    }
    // Alt+Tab — التنقل بين التطبيقات
    if (e.altKey && e.key === 'Tab') {
      e.preventDefault();
      if (_acReady) recordCheat('التنقل بين التطبيقات');
      return;
    }
    // Windows/Meta key
    if (e.key === 'Meta' || e.key === 'OS') { e.preventDefault(); }
  };

  // ── 5. منع القائمة السياقية ──
  const _ctxH  = (e) => { if (currentHw) e.preventDefault(); };
  // ── 6. منع تحديد النص ──
  const _selH  = (e) => { if (currentHw) e.preventDefault(); };
  // ── 7. منع السحب والإفلات ──
  const _dragH = (e) => { if (currentHw) e.preventDefault(); };
  // ── 8. منع إغلاق الصفحة ──
  const _unloadH = (e) => {
    if (currentHw) {
      e.preventDefault();
      e.returnValue = '';
      return e.returnValue;
    }
  };

  // تسجيل المستمعين
  document.addEventListener('copy',              _copyH);
  document.addEventListener('visibilitychange',  _visH);
  window.addEventListener('blur',                _blurH);
  document.addEventListener('keydown',           _keyH);
  document.addEventListener('contextmenu',       _ctxH);
  document.addEventListener('selectstart',       _selH);
  document.addEventListener('dragstart',         _dragH);
  window.addEventListener('beforeunload',        _unloadH);

  _cheatListeners.copy    = _copyH;
  _cheatListeners.vis     = _visH;
  _cheatListeners.blur    = _blurH;
  _cheatListeners.key     = _keyH;
  _cheatListeners.ctx     = _ctxH;
  _cheatListeners.sel     = _selH;
  _cheatListeners.drag    = _dragH;
  _cheatListeners.unload  = _unloadH;

  // ── 9. الضغط المطوّل على نص الأسئلة (نسخ السؤال بالجوال) ──
  // يستهدف فقط حاوية الأسئلة وليس كل الشاشة
  let _lpTimer = null;
  const _lpStart = (e) => {
    if (!currentHw || !_acReady) return;
    const target = e.target;
    // فقط داخل منطقة الأسئلة
    // ── فقط على نص السؤال، ليس على الخيارات ──
    const inQuestion = target && (
      target.closest('.card-header') ||
      target.closest('.question-text') ||
      (target.closest('[id^="qCard-"]') &&
       !target.closest('[id^="optContainer-"]') &&
       !target.closest('.option-card') &&
       !target.closest('button'))
    );
    if (!inQuestion) return;
    _lpTimer = setTimeout(() => {
      _lpTimer = null;
      recordCheat('نسخ السؤال');
    }, 700);
  };
  const _lpEnd = () => {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  };
  document.addEventListener('touchstart',  _lpStart, { passive: true });
  document.addEventListener('touchend',    _lpEnd,   { passive: true });
  document.addEventListener('touchcancel', _lpEnd,   { passive: true });
  _cheatListeners._lpStart = _lpStart;
  _cheatListeners._lpEnd   = _lpEnd;

  // ── 10. كشف getDisplayMedia (تسجيل الشاشة عبر API) ──
  // يُطبَّق مرة واحدة فقط لتجنب التراكم
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia &&
        !navigator.mediaDevices._gharsPatched) {
      const _origGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = function(...args) {
        if (currentHw) {
          recordCheat('تصوير الشاشة');
          _blockScreen();
          return Promise.reject(new DOMException('Permission denied','NotAllowedError'));
        }
        return _origGDM(...args);
      };
      navigator.mediaDevices._gharsPatched = true;
    }
  } catch(_) {}

  // ── 11. كشف تصوير الشاشة عبر visibilitychange (iOS screenshot + Android) ──
  let _lastVisibleTS = Date.now();
  let _visHidden = false;
  const _iosScreenshot = () => {
    if (!currentHw || !_acReady) return;
    if (document.hidden) {
      _visHidden = true;
      _lastVisibleTS = Date.now();
    } else if (_visHidden) {
      _visHidden = false;
      const gap = Date.now() - _lastVisibleTS;
      // iOS/Android screenshot: الشاشة تختفي 20–450ms
      if (gap > 20 && gap < 450) {
        _blockScreen();
        recordCheat('تصوير الشاشة');
      }
    }
  };
  document.addEventListener('visibilitychange', _iosScreenshot);
  _cheatListeners._iosScreenshot = _iosScreenshot;

  // ── 12. كشف ضغط زر خفض الصوت + زر الطاقة معاً (جوال/آيباد) ──
  // عبر Page Visibility + MediaSession API
  // عند الضغط على Power+VolumeDown معاً يحدث resize سريع للصفحة
  const _origWidth = window.innerWidth;
  const _origHeight = window.innerHeight;
  let _screenshotResizeTimer = null;
  const _resizeScreenshot = () => {
    if (!currentHw || !_acReady) return;
    clearTimeout(_screenshotResizeTimer);
    _screenshotResizeTimer = setTimeout(() => {
      const wDiff = Math.abs(window.innerWidth - _origWidth);
      const hDiff = Math.abs(window.innerHeight - _origHeight);
      // تغيير صغير مفاجئ في الأبعاد مؤشر على لقطة شاشة في بعض الأجهزة
      if ((wDiff > 0 && wDiff < 30) || (hDiff > 0 && hDiff < 30)) {
        _blockScreen();
        recordCheat('تصوير الشاشة');
      }
    }, 50);
  };
  window.addEventListener('resize', _resizeScreenshot);
  _cheatListeners._resizeScreenshot = _resizeScreenshot;

  // ── 13. منع CSS: تصوير الشاشة ──
  // `mix-blend-mode: difference` يُشوّش الشاشة المُلتقطة في بعض المتصفحات
  const fsEl = document.getElementById('hwFullscreen');
  if (fsEl) {
    fsEl.style.userSelect        = 'none';
    fsEl.style.webkitUserSelect  = 'none';
    fsEl.style.msUserSelect      = 'none';
  }
}

function _blockScreen() {
  // تعتيم الشاشة مؤقتاً لمنع التقاط الصورة
  const overlay = document.createElement('div');
  overlay.id = '_acOverlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:999998;pointer-events:none;opacity:1;transition:opacity 0.5s';
  document.body.appendChild(overlay);
  setTimeout(() => { overlay.style.opacity='0'; setTimeout(()=>overlay.remove(),600); }, 1500);
}

function removeAntiCheat() {
  if (!_cheatListeners) return;
  if (_cheatListeners._readyTimer) clearTimeout(_cheatListeners._readyTimer);
  _acReady = false;
  _acLastRecord = {};
  document.removeEventListener('copy',              _cheatListeners.copy);
  document.removeEventListener('visibilitychange',  _cheatListeners.vis);
  window.removeEventListener('blur',                _cheatListeners.blur);
  document.removeEventListener('keydown',           _cheatListeners.key);
  document.removeEventListener('contextmenu',       _cheatListeners.ctx);
  document.removeEventListener('selectstart',       _cheatListeners.sel);
  document.removeEventListener('dragstart',         _cheatListeners.drag);
  window.removeEventListener('beforeunload',        _cheatListeners.unload);
  if (_cheatListeners._lpStart) {
    document.removeEventListener('touchstart',  _cheatListeners._lpStart);
    document.removeEventListener('touchend',    _cheatListeners._lpEnd);
    document.removeEventListener('touchcancel', _cheatListeners._lpEnd);
  }
  if (_cheatListeners._iosScreenshot)
    document.removeEventListener('visibilitychange', _cheatListeners._iosScreenshot);
  if (_cheatListeners._resizeScreenshot)
    window.removeEventListener('resize', _cheatListeners._resizeScreenshot);
  _cheatListeners = null;
}

function showCheatWarningUI(msg, isZero=false) {
  // إزالة أي تنبيه سابق
  document.getElementById('_acWarnToast')?.remove();

  const parts = msg.split('\n').filter(Boolean);
  const title = parts[0] || '🚨 مخالفة غش';
  const typeLine = parts.find(p=>p.includes('النوع:')) || '';
  const counterLine = parts.find(p=>p.includes('المخالفة رقم')) || '';
  const typeLabel = typeLine.replace('النوع:','').trim();

  // بناء نقاط الإنذار
  let dotsHtml = '';
  for(let d=1;d<=HW_MAX_WARNINGS;d++){
    dotsHtml += `<div class="cheat-warn-dot${d<=hwWarnings?' filled':''}"></div>`;
  }

  const toast = document.createElement('div');
  toast.id = '_acWarnToast';
  toast.className = `cheat-warn-toast${isZero?' zero-score':''}`;
  toast.innerHTML = `
    <div class="cheat-warn-inner">
      <div class="cheat-warn-icon-row">
        <span class="cheat-warn-icon">${isZero?'🚫':'🚨'}</span>
      </div>
      <div class="cheat-warn-title">${isZero?'تجاوزت الحد الأقصى للمخالفات!':'تم رصد مخالفة غش!'}</div>
      ${typeLabel?`<div class="cheat-warn-type"><span class="cheat-warn-type-badge">${typeLabel}</span></div>`:''}
      ${counterLine?`<div style="text-align:center;margin-top:8px;font-size:0.82rem;color:rgba(255,255,255,0.85);font-weight:600">${counterLine}</div>`:''}
      <div class="cheat-warn-counter" style="margin-top:10px">${dotsHtml}</div>
    </div>
    ${isZero?`<div class="cheat-warn-footer">سيتم إلغاء الواجب وتسجيل درجة صفر</div>`:`<div class="cheat-warn-footer">يتم إبلاغ المعلم تلقائياً</div>`}
  `;

  // إضافة للواجب الكامل أو الـ body
  const fs = document.getElementById('hwFullscreen');
  const target = (fs && fs.style.display!=='none') ? fs : document.body;
  target.appendChild(toast);

  // إزالة بعد 4 ثواني
  setTimeout(()=>{
    if(!toast.parentNode) return;
    toast.classList.add('hiding');
    setTimeout(()=>toast.remove(), 380);
  }, isZero ? 1200 : 4000);
}
async function recordCheat(type) {
  if(!currentHw) return;
  // توحيد أسماء أنواع المخالفات
  const typeNorm = _normalizeCheatType(type);
  // ── Debounce: تجاهل نفس النوع خلال 3 ثواني ──
  const now = Date.now();
  if (_acLastRecord[typeNorm] && (now - _acLastRecord[typeNorm]) < 3000) return;
  _acLastRecord[typeNorm] = now;

  hwWarnings++; updateWarningDots();
  const uid = Auth.currentUser.id;
  const key = 'cheat_'+currentHw.id+'_'+uid;
  const existing = await GharsDB.get('cheating/'+key) ||
    {id:key, warnings:0, log:[], homeworkId:currentHw.id, studentId:uid, studentName:Auth.currentUser.name||''};
  existing.id       = key;
  existing.warnings = hwWarnings;
  existing.log      = [...(existing.log||[]), {type:typeNorm, time:new Date().toISOString()}];
  await GharsDB.set('cheating/'+key, existing);

  const remaining = HW_MAX_WARNINGS - hwWarnings;

  if (hwWarnings >= HW_MAX_WARNINGS) {
    showCheatWarningUI('🚫 تجاوزت الحد الأقصى للمخالفات!\nسيتم إلغاء الواجب وتسجيل درجة صفر', true);
    setTimeout(() => { submitZeroScore(); }, 1500);
  } else {
    const methodLabel = _cheatLabel(typeNorm);
    const warningMsg  =
      `🚨 تم رصد مخالفة غش!\n`+
      `النوع: ${methodLabel}\n`+
      `المخالفة رقم ${hwWarnings} من ${HW_MAX_WARNINGS} — تبقى ${remaining}`;
    showCheatWarningUI(warningMsg, false);
  }
}

function _normalizeCheatType(type) {
  // توحيد جميع أنواع المخالفات لأسماء ثابتة
  if (!type) return 'مخالفة';
  if (type.includes('نسخ') || type.includes('copy'))           return 'نسخ السؤال';
  if (type.includes('تصوير') || type.includes('screenshot') || type.includes('screen')) return 'تصوير الشاشة';
  if (type.includes('طباعة'))                                  return 'محاولة الطباعة';
  if (type.includes('مغادرة') || type.includes('تبويب'))       return 'مغادرة صفحة الواجب';
  if (type.includes('التنقل') || type.includes('تطبيق'))        return 'التنقل بين التطبيقات';
  if (type.includes('أدوات') || type.includes('مطور'))          return 'فتح أدوات المطور';
  if (type.includes('إغلاق') || type.includes('تحديث'))         return 'محاولة الإغلاق';
  return type;
}

function _cheatLabel(typeNorm) {
  const labels = {
    'نسخ السؤال':             '📋 نسخ السؤال',
    'تصوير الشاشة':           '📸 تصوير الشاشة',
    'محاولة الطباعة':         '🖨️ الطباعة أو التصوير',
    'مغادرة صفحة الواجب':    '🚪 مغادرة صفحة الواجب',
    'التنقل بين التطبيقات':  '🔀 التنقل بين التطبيقات',
    'فتح أدوات المطور':       '🛠️ فتح أدوات المطور',
    'محاولة الإغلاق':         '❌ محاولة الإغلاق',
  };
  return labels[typeNorm] || ('⚠️ '+typeNorm);
}

async function submitStudentHomework() {
  if(!currentHw) return;
  // تحقق من الأسئلة غير المحلولة
  const questions=currentHw.questions||[];
  const unanswered=[];
  questions.forEach((q,i)=>{
    const ans=hwAnswers[i];
    if(ans===null||ans===undefined||(Array.isArray(ans)&&ans.length===0)) unanswered.push(i);
  });
  if(unanswered.length>0){
    // تمييز الأسئلة غير المحلولة باللون الأحمر
    unanswered.forEach(i=>{
      const card=document.getElementById('qCard-'+i);
      if(card){
        card.style.border='2px solid var(--red)';
        card.style.boxShadow='0 0 0 3px rgba(229,62,62,0.2)';
      }
    });

    // الانتقال للسؤال الأول غير المجاب
    const firstCard=document.getElementById('qCard-'+unanswered[0]);
    if(firstCard) firstCard.scrollIntoView({behavior:'smooth',block:'center'});

    // أرقام الأسئلة للعرض
    const qNums = unanswered.map(i => `س${i+1}`).join('، ');
    // إزالة أي تنبيه سابق
    document.getElementById('_unansweredAlert')?.remove();
    const alert = document.createElement('div');
    alert.id = '_unansweredAlert';
    alert.style.cssText = [
      'position:fixed','top:50%','left:50%',
      'transform:translate(-50%,-50%)',
      'z-index:2147483647',
      'background:linear-gradient(135deg,#7b1a1a,#c53030)',
      'border-radius:20px','overflow:hidden',
      'box-shadow:0 20px 60px rgba(197,48,48,0.6),0 8px 20px rgba(0,0,0,0.4)',
      'min-width:280px','max-width:min(92vw,400px)',
      'font-family:Tajawal,sans-serif','direction:rtl',
      'animation:cheatWarnIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
      'pointer-events:auto'
    ].join(';');
    alert.innerHTML = `
      <div style="padding:20px 22px 16px;text-align:center">
        <div style="font-size:2.2rem;margin-bottom:8px">⚠️</div>
        <div style="font-size:1.05rem;font-weight:900;color:#fff;margin-bottom:6px">
          يوجد ${unanswered.length} سؤال لم تجب عليه!
        </div>
        <div style="font-size:0.82rem;color:rgba(255,255,255,0.85);font-weight:600;margin-bottom:12px;line-height:1.7">
          ${qNums}
        </div>
        <div style="font-size:0.78rem;color:rgba(255,255,255,0.7)">يرجى الإجابة على جميع الأسئلة قبل التسليم</div>
      </div>
      <div style="background:rgba(0,0,0,0.25);padding:10px 16px;text-align:center">
        <button onclick="document.getElementById('_unansweredAlert')?.remove();document.getElementById('qCard-${unanswered[0]}')?.scrollIntoView({behavior:'smooth',block:'center'})"
          style="background:rgba(255,255,255,0.15);border:1.5px solid rgba(255,255,255,0.35);border-radius:12px;padding:7px 24px;color:#fff;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:700;cursor:pointer">
          حسناً، سأجيب عليها
        </button>
      </div>`;
    // إلحاق بـ hwNotifPortal دائماً
    const portal = document.getElementById('hwNotifPortal')
                 || document.getElementById('hwFullscreen')
                 || document.body;
    portal.appendChild(alert);
    // إزالة تلقائية بعد 5 ثواني
    setTimeout(() => {
      if(!alert.parentNode) return;
      alert.style.animation = 'cheatWarnOut 0.35s ease forwards';
      setTimeout(() => alert.remove(), 380);
    }, 5000);
    return; // منع التسليم
  }
  const uid=Auth.currentUser.id;
  const duration=Math.floor((Date.now()-hwStartTime)/1000);
  let score=0;
  const answers=[];
  const maxPts=questions.reduce((a,q)=>a+(q.points||1),0);
  questions.forEach((q,i)=>{
    const ans=(hwAnswers[i]!==undefined)?hwAnswers[i]:null;
    // دعم الإجابات المتعددة — يشمل جميع أنواع علامات التعدد
    const isMultiQ=q.isMultiple||q.multiCorrect||q.multipleCorrect||false;
    if(isMultiQ){
      // تطبيع correctAnswers من كائن Firebase إلى مصفوفة إن لزم
      const corrArr=Array.isArray(q.correctAnswers)
        ? q.correctAnswers
        : GharsUtils.toArr(q.correctAnswers);
      const studArr=Array.isArray(ans)?ans:(ans?[ans]:[]);
      // الإجابة صحيحة فقط إذا تطابقت جميع الخيارات تماماً
      const allRight=corrArr.length>0&&
        corrArr.length===studArr.length&&
        corrArr.every(ca=>studArr.includes(ca));
      if(allRight) score+=(q.points||1);
    } else {
      // إجابة واحدة — مقارنة نصية دقيقة
      if(ans!==null&&ans!==undefined&&ans===q.correctAnswer) score+=(q.points||1);
    }
    answers.push(ans);
  });
  const allCorrect=score===maxPts;
  const sub={id:GharsUtils.uid(),homeworkId:currentHw.id,studentId:uid,answers,score,duration,warnings:hwWarnings,submittedAt:new Date().toISOString()};
  await GharsDB.set('submissions/'+sub.id,sub);

  // ── نقاط الواجب: شروط صارمة جداً ──
  // 1. الواجب مرتبط بلقاء
  // 2. الدرجة كاملة 100%
  // 3. صفر مخالفات تماماً
  const earnedBonus = currentHw.linkedMeeting && allCorrect && hwWarnings === 0;

  if(currentHw.linkedMeeting) {
    const pts=await GharsDB.get('points_summary/'+uid)||{id:uid,total:0,breakdown:[]};
    const already=pts.breakdown?.some(b=>b.type==='task'&&b.homeworkId===currentHw.id);
    if(!already){
      const taskPts = earnedBonus ? 2 : 0;
      const meeting=await GharsDB.get('meetings/'+currentHw.linkedMeeting);
      if(taskPts > 0) pts.total=(pts.total||0)+taskPts;
      pts.breakdown=[...(pts.breakdown||[]),{
        type:'task', homeworkId:currentHw.id,
        meetingId:currentHw.linkedMeeting,
        meetingTitle:meeting?.title||'لقاء',
        points:taskPts,
        date:new Date().toISOString(),
        note: hwWarnings>0 ? `ملغي — ${hwWarnings} مخالفة مُرصودة` :
              !allCorrect ? `ناقص — ${score}/${maxPts}` : 'ممتاز — درجة كاملة'
      }];
      await GharsDB.set('points_summary/'+uid,pts);
    }
  }
  const savedHw=currentHw;
  closeHwFullscreen();
  const correct=answers.filter((a,i)=>{
    const q=savedHw.questions[i];
    if(!q) return false;
    if(a===null||a===undefined||(Array.isArray(a)&&a.length===0)) return false;
    const isMultiQ=q.isMultiple||q.multiCorrect||q.multipleCorrect;
    if(isMultiQ){
      const corrArr=Array.isArray(q.correctAnswers)?q.correctAnswers:GharsUtils.toArr(q.correctAnswers);
      const studArr=Array.isArray(a)?a:[a];
      return corrArr.length>0&&corrArr.length===studArr.length&&corrArr.every(ca=>studArr.includes(ca));
    }
    return a===q.correctAnswer;
  }).length;
  const wrong=(savedHw.questions||[]).length-correct;
  UI.showModal(`<div class="modal" style="max-width:400px">
    <div class="modal-header" style="background:linear-gradient(135deg,var(--green),#276749)">
      <h3>🎉 تم تسليم الواجب بنجاح!</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove();navigate('homework')">✖</button>
    </div>
    <div class="modal-body" style="text-align:center;padding:24px">
      <div style="font-size:2.5rem;margin-bottom:10px;animation:zoomIn 0.5s both ease">${allCorrect?'⭐':'✅'}</div>
      <div style="font-weight:700;font-size:0.95rem;margin-bottom:16px">تم إرسال إجاباتك بنجاح</div>
      <div style="margin:10px auto;padding:12px 20px;background:rgba(56,161,105,0.1);border-radius:12px;border:1px solid rgba(56,161,105,0.3);color:var(--green);font-weight:700;font-size:0.88rem">
        ✅ تم استلام إجاباتك بنجاح${!savedHw.hideGrade?' — يمكنك مشاهدة نتيجتك من زر <strong>\"إجاباتي\"</strong>':''}
      </div>
      ${earnedBonus ? '<div style="margin-top:12px;color:var(--gold);font-weight:700;font-size:0.88rem;animation:zoomIn 0.5s 0.4s both ease">🎊 حصلت على +2 نقطة! درجة كاملة بدون مخالفات</div>' : ''}
    </div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove();navigate('homework')">تم ✓</button></div>
  </div>`);
}

function forceSubmitHw(reason) {
  if(hwSolveTimer) clearInterval(hwSolveTimer);
  const isCheating = hwWarnings >= HW_MAX_WARNINGS || reason.includes('مخالفات') || reason.includes('غش');
  if(isCheating) {
    // إخراج فوري — تسجيل صفر وإغلاق
    submitZeroScore();
    return;
  }
  // وقت انتهى — تسليم تلقائي بالإجابات المُدخلة فقط (بدون اشتراط الإجابة على الكل)
  _autoSubmitOnTimeout();
}

// ── تسليم تلقائي عند انتهاء الوقت: يحسب درجة الأسئلة المُجاب عنها فقط ──
async function _autoSubmitOnTimeout() {
  if(!currentHw) return;
  if(hwSolveTimer) clearInterval(hwSolveTimer);
  removeAntiCheat();
  const uid = Auth.currentUser.id;
  const duration = Math.floor((Date.now()-(hwStartTime||Date.now()))/1000);
  const questions = Array.isArray(currentHw.questions)
    ? currentHw.questions
    : Object.values(currentHw.questions||{});
  const maxPts = questions.reduce((a,q)=>a+(q.points||1),0);
  let score = 0;
  const answers = [];

  questions.forEach((q, i) => {
    const ans = (hwAnswers[i] !== undefined) ? hwAnswers[i] : null;
    answers.push(ans);
    // إذا لم يجب على السؤال لا تُضف له درجة
    const notAnswered = ans === null || ans === undefined || (Array.isArray(ans) && ans.length === 0);
    if (notAnswered) return;
    // احسب الدرجة للأسئلة التي أجاب عنها فقط
    const isMultiQ = q.isMultiple || q.multiCorrect || q.multipleCorrect || false;
    if (isMultiQ) {
      const corrArr = Array.isArray(q.correctAnswers)
        ? q.correctAnswers
        : GharsUtils.toArr(q.correctAnswers);
      const studArr = Array.isArray(ans) ? ans : [ans];
      const allRight = corrArr.length > 0 &&
        corrArr.length === studArr.length &&
        corrArr.every(ca => studArr.includes(ca));
      if (allRight) score += (q.points||1);
    } else {
      if (ans === q.correctAnswer) score += (q.points||1);
    }
  });

  const allCorrect = score === maxPts;
  const sub = {
    id: 'sub_' + Date.now(),
    homeworkId: currentHw.id,
    studentId: uid,
    answers,
    score,
    duration,
    warnings: hwWarnings,
    submittedAt: new Date().toISOString(),
    autoSubmitted: true
  };
  await GharsDB.set('submissions/' + sub.id, sub);

  // ── نقاط الواجب إن كان مرتبطاً بلقاء ──
  if (currentHw.linkedMeeting) {
    const earnedBonus = allCorrect && hwWarnings === 0;
    const pts = await GharsDB.get('points_summary/'+uid) || {id:uid, total:0, breakdown:[]};
    const already = pts.breakdown?.some(b => b.type==='task' && b.homeworkId===currentHw.id);
    if (!already) {
      const taskPts = earnedBonus ? 2 : 0;
      const meeting = await GharsDB.get('meetings/'+currentHw.linkedMeeting);
      if (taskPts > 0) pts.total = (pts.total||0) + taskPts;
      pts.breakdown = [...(pts.breakdown||[]), {
        type: 'task', homeworkId: currentHw.id,
        meetingId: currentHw.linkedMeeting,
        meetingTitle: meeting?.title||'لقاء',
        points: taskPts,
        date: new Date().toISOString(),
        note: hwWarnings > 0 ? `ملغي — ${hwWarnings} مخالفة مُرصودة` :
              !allCorrect     ? `ناقص — ${score}/${maxPts}` : 'ممتاز — درجة كاملة'
      }];
      await GharsDB.set('points_summary/'+uid, pts);
    }
  }

  closeHwFullscreen();
  UI.toast('⏰ انتهى الوقت المحدد — تم تسليم إجاباتك تلقائياً', 'warning', 5000);
  navigate('homework');
  setTimeout(() => loadStudentHomework(), 400);
}

async function submitZeroScore() {
  if(!currentHw) return;
  if(hwSolveTimer) clearInterval(hwSolveTimer);
  removeAntiCheat();
  const uid = Auth.currentUser.id;
  const duration = Math.floor((Date.now()-(hwStartTime||Date.now()))/1000);
  const cheatedHwId = currentHw.id;
  const sub = {
    id: 'sub_'+Date.now(),
    homeworkId: cheatedHwId,
    studentId:  uid,
    answers:    [],
    score:      0,
    duration,
    warnings:   hwWarnings,
    submittedAt: new Date().toISOString(),
    zeroByCheat: true,
    cheated: true
  };
  await GharsDB.set('submissions/'+sub.id, sub);
  // إغلاق الواجب فوراً
  closeHwFullscreen();
  // إشعار
  UI.toast('🚫 تم إلغاء الواجب بسبب الغش — درجتك صفر', 'error', 6000);
  // الانتقال لصفحة الواجبات وإعادة تحميلها لتظهر شارة ملغي
  navigate('homework');
  setTimeout(() => loadStudentHomework(), 400);
}

function _markHwCancelled(hwId, hwTitle) {
  // ابحث عن بطاقة الواجب وضع عليها تشويشاً وعلامة إلغاء
  const cards = document.querySelectorAll('.hw-card-v2');
  cards.forEach(card => {
    const btn = card.querySelector(`button[onclick*="${hwId}"]`) ||
                card.querySelector(`[data-hw-id="${hwId}"]`);
    if(btn || card.innerHTML.includes(hwId)) {
      card.style.position = 'relative';
      card.style.overflow = 'hidden';
      // طبقة تشويش فوق كل شيء
      const overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:absolute','inset:0','z-index:10',
        'background:rgba(197,48,48,0.88)',
        'backdrop-filter:blur(4px)','-webkit-backdrop-filter:blur(4px)',
        'display:flex','flex-direction:column',
        'align-items:center','justify-content:center','gap:8px',
        'border-radius:var(--radius)',
      ].join(';');
      overlay.innerHTML =
        '<div style="font-size:3rem;font-weight:900;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.5)">✖</div>'+
        '<div style="font-size:1.1rem;font-weight:900;color:#fff;text-align:center;padding:0 12px">الواجب ملغي</div>'+
        '<div style="font-size:0.78rem;color:rgba(255,255,255,0.85);text-align:center">بسبب تجاوز الحد الأقصى للمخالفات</div>'+
        '<div style="margin-top:4px;background:rgba(0,0,0,0.3);color:#fff;border-radius:20px;padding:4px 14px;font-size:0.82rem;font-weight:700">الدرجة: 0</div>';
      card.appendChild(overlay);
    }
  });
}

function closeHwFullscreen() {
  if(hwSolveTimer)clearInterval(hwSolveTimer);
  removeAntiCheat();
  try{if(document.fullscreenElement)document.exitFullscreen();}catch(_){}
  const fs=document.getElementById('hwFullscreen');if(fs)fs.style.display='none';
  document.body.style.overflow='';
  currentHw=null; hwAnswers={}; hwWarnings=0;
}

// ============================================================
// LOAD MY ANSWERS (page entry point — shows list of submitted HW)
// ============================================================
async function loadMyAnswers() {
  // إذا كنا نعرض تفاصيل واجب محدد، لا تُحمّل القائمة وتُطمسها
  if (_directAnswerViewActive) { _directAnswerViewActive = false; return; }
  const uid = Auth.currentUser?.id;
  if (!uid) { navigate('homework'); return; }
  const cont = document.getElementById('myAnswersContent');
  if (!cont) return;

  // عرض حالة تحميل
  cont.innerHTML = `<div style="text-align:center;padding:40px 0">
    <span class="loader loader-sm" style="display:inline-block;vertical-align:middle;margin-left:8px"></span>
    <span style="color:var(--gray);font-size:0.9rem;vertical-align:middle">جاري تحميل الإجابات...</span>
  </div>`;

  try {
    const [hwAll, subs] = await Promise.all([
      GharsDB.getAll('homework'),
      GharsDB.getAll('submissions')
    ]);
    const mySubs = Object.values(subs).filter(s => s && s.studentId === uid);
    if (!mySubs.length) {
      cont.innerHTML = `<div class="no-data"><div class="no-data-icon">📋</div><p>لا توجد واجبات محلولة بعد</p></div>`;
      return;
    }
    // ترتيب حسب الأحدث
    mySubs.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
    const cards = mySubs.map((sub, i) => {
      const hw = hwAll[sub.homeworkId] || Object.values(hwAll).find(h => h.id === sub.homeworkId);
      if (!hw || hw.deleted) return '';
      const maxPts = (hw.questions || []).reduce((a, q) => a + (q.points || 1), 0);
      const isCancelled = sub.zeroByCheat || sub.cheated;
      const isHidden = hw.hideGrade;
      const scoreColor = isCancelled ? 'var(--red)' : 'var(--gold)';
      const statusBadge = isCancelled
        ? `<span class="badge badge-red">🚫 ملغي</span>`
        : isHidden
          ? `<span class="badge badge-gray">🔒 مخفي</span>`
          : `<span class="badge badge-green">✅ تم</span>`;
      const scoreDisplay = isCancelled
        ? `<span style="color:var(--red);font-weight:900">0 / ${maxPts}</span>`
        : isHidden
          ? `<span style="color:var(--gray)">—</span>`
          : `<span style="color:${scoreColor};font-weight:900">${sub.score || 0} / ${maxPts}</span>`;
      const viewBtn = (!isCancelled && !isHidden)
        ? `<button class="btn btn-outline btn-sm" style="font-size:0.8rem" onclick="viewMyAnswers('${e(hw.id)}')">📋 عرض إجاباتي</button>`
        : isCancelled
          ? `<button class="btn btn-sm" style="background:rgba(229,62,62,0.1);color:var(--red);font-size:0.78rem;border:1px solid rgba(229,62,62,0.3)" onclick="viewMyAnswers('${e(hw.id)}')">🚫 عرض التفاصيل</button>`
          : '';
      return `<div class="card no-hover mb-2" style="animation:fadeInUp 0.3s ${i * 0.06}s both ease;border-right:3px solid ${isCancelled ? 'var(--red)' : 'var(--gold)'}">
        <div class="card-body" style="padding:14px 16px">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:800;font-size:0.92rem;color:var(--navy);margin-bottom:4px">📚 ${e(hw.title)}</div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                ${statusBadge}
                <span style="font-size:0.8rem;color:var(--gray)">${sub.submittedAt ? GharsUtils.hijriShort(new Date(sub.submittedAt)) : ''}</span>
              </div>
            </div>
            <div style="text-align:center;flex-shrink:0">
              <div style="font-size:1.3rem;font-weight:900">${scoreDisplay}</div>
              <div style="font-size:0.68rem;color:var(--gray)">الدرجة</div>
            </div>
          </div>
          ${viewBtn ? `<div style="margin-top:10px">${viewBtn}</div>` : ''}
        </div>
      </div>`;
    }).filter(Boolean).join('');

    cont.innerHTML = cards ||
      `<div class="no-data"><div class="no-data-icon">📋</div><p>لا توجد إجابات مسجلة</p></div>`;
  } catch (err) {
    console.error('loadMyAnswers error:', err);
    cont.innerHTML = `<div class="no-data"><div class="no-data-icon">⚠️</div><p>حدث خطأ في التحميل، حاول مجدداً</p></div>`;
  }
}

// ============================================================
// VIEW MY ANSWERS
// ============================================================
async function viewMyAnswers(hwId) {
  const uid = Auth.currentUser.id;
  const [hw, subs] = await Promise.all([
    GharsDB.get('homework/' + hwId),
    GharsDB.getAll('submissions')
  ]);
  const sub = Object.values(subs).find(s => s.homeworkId === hwId && s.studentId === uid);
  if (!sub || !hw) return;
  if (hw.hideGrade) { UI.toast('الدرجات والإجابات مخفية من المعلم', 'warning'); return; }

  // ── ضبط العلامة قبل navigate لمنع loadMyAnswers من مسح المحتوى ──
  _directAnswerViewActive = true;
  navigate('my-answers');

  const cont = document.getElementById('myAnswersContent');
  if (!cont) return;
  const maxPts = (hw.questions || []).reduce((a, q) => a + (q.points || 1), 0);

  // ── واجب ملغي بسبب الغش ──
  if (sub.zeroByCheat || sub.cheated) {
    const blurredQHtml = (hw.questions || []).map((_, i) => `
      <div style="border-radius:12px;overflow:hidden;margin-bottom:10px;border:2px solid rgba(229,62,62,0.4)">
        <div style="background:#fed7d7;padding:10px 14px">
          <span style="font-weight:800;font-size:0.87rem;color:#742a2a">س${i + 1}: ▓▓▓▓▓▓▓▓▓▓▓▓</span></div>
        <div style="padding:10px 12px;background:#fff">
          ${[1, 2, 3, 4].map(() => `<div style="height:36px;background:#f8fafc;border-radius:8px;margin-bottom:6px;border:1px solid #e2e8f0"></div>`).join('')}
        </div>
      </div>`).join('');
    cont.innerHTML = `<div style="position:relative">
      <div class="card no-hover" style="border:2px solid var(--red)">
        <div class="card-header" style="background:linear-gradient(135deg,#7b2d00,#c53030)">
          <h3 style="color:#fff">🚫 ${e(hw.title)} — ملغي</h3></div>
        <div class="card-body">
          <div style="text-align:center;padding:18px 0 12px">
            <div style="font-size:3.5rem;font-weight:900;color:var(--red)">✖</div>
            <div style="font-size:1.4rem;font-weight:900;color:var(--navy);margin:8px 0 4px">الواجب ملغي</div>
            <div style="font-size:0.85rem;color:var(--gray);margin-bottom:14px">تجاوزت الحد الأقصى للمخالفات</div>
            <div style="display:inline-block;background:linear-gradient(135deg,var(--red),#7b2d00);
              color:#fff;border-radius:20px;padding:8px 28px;font-size:1.2rem;font-weight:900">
              درجتك: 0 / ${maxPts}
            </div>
          </div>
          <div style="position:relative;overflow:hidden;border-radius:12px;margin-top:8px">
            <div style="filter:blur(6px) grayscale(1);pointer-events:none;user-select:none;opacity:0.6">${blurredQHtml}</div>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
              background:rgba(197,48,48,0.85);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);border-radius:12px;z-index:5">
              <div style="font-size:5rem;color:#fff;font-weight:900;line-height:1;text-shadow:0 4px 12px rgba(0,0,0,0.5)">✖</div>
              <div style="font-size:1.8rem;font-weight:900;color:#fff;margin-top:10px;text-align:center;padding:0 20px;text-shadow:0 2px 8px rgba(0,0,0,0.5)">الواجب ملغي</div>
              <div style="font-size:0.9rem;color:rgba(255,255,255,0.9);margin-top:6px;text-align:center">بسبب تجاوز الحد الأقصى للمخالفات</div>
              <div style="margin-top:12px;background:rgba(0,0,0,0.3);color:#fff;border-radius:20px;padding:6px 20px;font-size:0.9rem;font-weight:700">الدرجة: 0 / ${maxPts}</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    return;
  }

  // ── عرض الإجابات الكاملة ──
  const letters = 'أبجدهوزح';

  // ── دالة مساعدة: تطبيع correctAnswers من كائن Firebase إلى مصفوفة ──
  function _normCorr(q) {
    return Array.isArray(q.correctAnswers)
      ? q.correctAnswers
      : GharsUtils.toArr(q.correctAnswers);
  }
  // ── دالة مساعدة: هل السؤال متعدد الإجابات؟ ──
  function _isMultiQ(q) {
    return !!(q.isMultiple || q.multiCorrect || q.multipleCorrect);
  }
  // ── دالة مساعدة: هل الإجابة صحيحة؟ ──
  function _isCorrectAns(q, ans) {
    if (_isMultiQ(q)) {
      const corrArr = _normCorr(q);
      const studArr = Array.isArray(ans) ? ans : (ans ? [ans] : []);
      return corrArr.length > 0 &&
        corrArr.length === studArr.length &&
        corrArr.every(ca => studArr.includes(ca));
    }
    return ans !== null && ans !== undefined && ans === q.correctAnswer;
  }

  let correctCount = 0;
  (hw.questions || []).forEach((q, i) => {
    const ans = sub.answers?.[i] ?? null;
    if (_isCorrectAns(q, ans)) correctCount++;
  });

  const questionsHtml = (hw.questions || []).map((q, i) => {
    const ans     = sub.answers?.[i] ?? null;
    const isMulti = _isMultiQ(q);
    const corrArr = _normCorr(q); // مصفوفة الإجابات الصحيحة (للمتعدد)
    const studArr = Array.isArray(ans) ? ans : (ans ? [ans] : []);
    const notAnswered = ans === null || ans === undefined || (Array.isArray(ans) && ans.length === 0);
    const isOk   = !notAnswered && _isCorrectAns(q, ans);

    const optHtml = (q.options || []).map((opt, j) => {
      // هل اختار الطالب هذا الخيار؟
      const stuSel = isMulti ? studArr.includes(opt) : (ans === opt);
      // هل هذا الخيار صحيح حسب ما حدده المعلم؟
      const isCorr = isMulti
        ? corrArr.includes(opt)
        : opt === q.correctAnswer;

      let bg  = '#f8fafc';
      let bdr = 'var(--gray-mid)';
      let icon = '';

      if (stuSel && isCorr) {
        // اختار الطالب الصح ← خلفية خضراء + علامة صح
        bg   = 'rgba(56,161,105,0.12)';
        bdr  = 'var(--green)';
        icon = '<span style="color:var(--green);font-size:1.15rem;font-weight:900">✅</span>';
      } else if (stuSel && !isCorr) {
        // اختار الطالب خطأ ← خلفية حمراء + علامة خطأ
        bg   = 'rgba(229,62,62,0.10)';
        bdr  = 'var(--red)';
        icon = '<span style="color:var(--red);font-size:1.15rem;font-weight:900">❌</span>';
      } else if (!stuSel && isCorr) {
        // الإجابة الصحيحة لم يختارها الطالب ← تمييز واضح بعلامة صح خضراء
        bg   = 'rgba(56,161,105,0.09)';
        bdr  = 'rgba(56,161,105,0.7)';
        icon = '<span style="color:var(--green);font-size:1.15rem;font-weight:900">✅</span>';
      }
      // الخيار غير محدد وغير صحيح ← لا أيقونة ولا تمييز

      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;border:1.5px solid ${bdr};background:${bg};margin-bottom:6px">
        <div style="width:28px;height:28px;border-radius:7px;background:${isCorr?'var(--green)':'var(--gray-mid)'};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.82rem;flex-shrink:0">${letters[j]||j+1}</div>
        <span style="flex:1;font-size:0.84rem;color:var(--navy)">${e(opt)}</span>
        ${icon}
      </div>`;
    }).join('');

    // عنوان السؤال — لو لم يُجب عليه يظهر بلون رمادي
    const headerBg = notAnswered
      ? 'linear-gradient(135deg,#e2e8f0,#cbd5e0)'
      : isOk
        ? 'linear-gradient(135deg,#c6f6d5,#9ae6b4)'
        : 'linear-gradient(135deg,#fed7d7,#feb2b2)';
    const headerColor = notAnswered ? '#4a5568' : isOk ? '#22543d' : '#742a2a';
    const borderColor = notAnswered ? 'var(--gray-mid)' : isOk ? 'var(--green)' : 'var(--red)';
    const statusIcon  = notAnswered ? '—' : isOk ? '✅' : '❌';
    const qPts = q.points || 1;
    const earnedPts = isOk ? qPts : 0;

    return `<div style="border-radius:12px;overflow:hidden;margin-bottom:12px;border:2px solid ${borderColor};animation:fadeInUp 0.3s ${i*0.05}s both ease">
      <div style="background:${headerBg};padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <span style="font-weight:800;font-size:0.87rem;color:${headerColor};flex:1">س${i+1}: ${e(q.question)}</span>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${isMulti?'<span style="background:rgba(0,0,0,0.12);border-radius:12px;padding:2px 8px;font-size:0.67rem;font-weight:700;color:#333">⚡ متعدد</span>':''}
          ${notAnswered?'<span style="background:rgba(0,0,0,0.1);border-radius:12px;padding:2px 8px;font-size:0.7rem;font-weight:700;color:#4a5568">لم يُجب</span>':''}
          <span style="background:rgba(0,0,0,0.12);border-radius:12px;padding:2px 9px;font-size:0.72rem;font-weight:800;color:${headerColor}">${earnedPts}/${qPts}</span>
          <span style="font-size:1.1rem">${statusIcon}</span>
        </div>
      </div>
      <div style="padding:10px 12px;background:#fff">${optHtml}</div>
    </div>`;
  }).join('');

  cont.innerHTML = `<div class="card no-hover">
    <div class="card-header" style="background:linear-gradient(135deg,var(--navy),var(--navy-light))">
      <h3 style="color:var(--gold)">📋 إجاباتي — ${e(hw.title)}</h3>
    </div>
    <div class="card-body">
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-bottom:16px">
        <div style="text-align:center;background:#f8fafc;border-radius:12px;padding:14px 18px;border:1px solid var(--gray-mid);animation:zoomIn 0.4s both ease">
          <div style="font-size:1.6rem;font-weight:900;color:var(--gold)">${sub.score || 0}/${maxPts}</div>
          <div style="font-size:0.72rem;color:var(--gray)">درجة الطالب</div>
        </div>
        <div style="text-align:center;background:var(--green-light);border-radius:12px;padding:14px 18px;border:1px solid rgba(56,161,105,0.3);animation:zoomIn 0.4s 0.1s both ease">
          <div style="font-size:1.6rem;font-weight:900;color:var(--green)">${correctCount}</div>
          <div style="font-size:0.72rem;color:var(--gray)">الإجابات الصحيحة</div>
        </div>
        <div style="text-align:center;background:var(--red-light);border-radius:12px;padding:14px 18px;border:1px solid rgba(229,62,62,0.3);animation:zoomIn 0.4s 0.2s both ease">
          <div style="font-size:1.6rem;font-weight:900;color:var(--red)">${(hw.questions || []).length - correctCount}</div>
          <div style="font-size:0.72rem;color:var(--gray)">الإجابات الخاطئة</div>
        </div>
      </div>
      ${questionsHtml}
    </div>
  </div>`;
}
function _backFromMyAnswers() {
  // رجوع للصفحة السابقة المنطقية
  if (pageHistory.length > 0) {
    const prev = pageHistory[pageHistory.length - 1];
    if (prev === 'homework' || prev === 'home') { navigate(prev); return; }
  }
  navigate('homework');
}

// ============================================================
// HELPERS
// ============================================================
function timeAgo(date) {
  const diff=Date.now()-date.getTime();
  const m=Math.floor(diff/60000),h=Math.floor(diff/3600000),d=Math.floor(diff/86400000);
  if(d>0) return `منذ ${d} يوم`;
  if(h>0) return `منذ ${h} ساعة`;
  if(m>0) return `منذ ${m} دقيقة`;
  return 'الآن';
}
function e(str){return GharsUtils.esc(str||'');}

// ============================================================
// 🔔 نظام الإشعارات — ردود المعلم على تعليقات السيرة
// ============================================================
var _activeNotifTimers = {};

async function checkStudentNotifications() {
  const uid = Auth.currentUser?.id;
  if (!uid) return;
  try {
    // ── جلب مباشر من Supabase للإشعارات الجديدة ──
    let allNotifs = {};
    if(typeof _sbOK !== 'undefined' && _sbOK && typeof _sb !== 'undefined' && _sb) {
      try {
        const r = await _sb.from('ghars_data')
          .select('data')
          .eq('collection','notifications')
          .filter('data->>studentId','eq', uid)
          .filter('data->>read','eq','false');
        if(!r.error && r.data) {
          r.data.forEach(row => {
            if(row.data && row.data.id) allNotifs[row.data.id] = row.data;
          });
        }
      } catch(_) {
        // fallback to getAll
        allNotifs = await GharsDB.getAll('notifications');
      }
    } else {
      allNotifs = await GharsDB.getAll('notifications');
    }

    const myNotifs = Object.values(allNotifs).filter(n =>
      n && n.studentId === uid && !n.read && n.type === 'teacher_reply'
    ).sort((a,b) => new Date(a.at) - new Date(b.at));

    for (const notif of myNotifs) {
      if (!document.getElementById('notif-' + notif.id)) {
        showTeacherReplyNotification(notif);
      }
    }
  } catch(e) { console.warn('checkStudentNotifications:', e); }
}

function showTeacherReplyNotification(notif) {
  // ── تجنب التكرار ──
  if (document.getElementById('notif-' + notif.id)) return;

  // ── إنشاء الإشعار ──
  const el = document.createElement('div');
  el.id = 'notif-' + notif.id;
  el.style.cssText = `
    position: fixed;
    bottom: 90px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    z-index: 99999;
    width: min(92vw, 380px);
    background: linear-gradient(135deg, #0a1628 0%, #0d1f3c 50%, #0a1628 100%);
    border: 2px solid transparent;
    background-clip: padding-box;
    border-radius: 20px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.6), 0 0 0 2px rgba(201,162,39,0.6);
    cursor: pointer;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
    font-family: Tajawal, sans-serif;
    direction: rtl;
  `;

  const replyPreview = notif.replyText
    ? `<div style="
        font-size:0.78rem;
        color:rgba(255,255,255,0.65);
        background:rgba(201,162,39,0.08);
        border-right:2px solid rgba(201,162,39,0.5);
        padding:5px 10px;
        border-radius:0 8px 8px 0;
        margin-top:5px;
        line-height:1.6;
        max-height:44px;
        overflow:hidden;
        text-overflow:ellipsis;
        display:-webkit-box;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical">${GharsUtils.esc(notif.replyText)}${notif.replyText.length >= 80 ? '...' : ''}</div>`
    : '';

  el.innerHTML = `
    <!-- شريط تقدم الإشعار -->
    <div id="notif-bar-${notif.id}" style="
      position:absolute;top:0;right:0;height:3px;width:100%;
      background:linear-gradient(90deg,#c9a227,#ffd700,#c9a227);
      background-size:200% 100%;
      animation:shimmerBar 1.5s linear infinite, notifBarShrink 60s linear forwards;
      transform-origin:right center;
      border-radius:3px 3px 0 0;
    "></div>

    <div style="padding:14px 16px;display:flex;align-items:flex-start;gap:12px">
      <!-- أيقونة المعلم -->
      <div style="
        width:46px;height:46px;border-radius:50%;flex-shrink:0;
        background:linear-gradient(135deg,#c9a227,#a07d10);
        display:flex;align-items:center;justify-content:center;
        font-size:1.3rem;
        box-shadow:0 4px 14px rgba(201,162,39,0.45);
        animation:notifIconPop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.2s both;
      ">👨‍🏫</div>

      <!-- المحتوى -->
      <div style="flex:1;min-width:0">
        <!-- العنوان -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span style="
            font-size:0.65rem;font-weight:800;
            background:rgba(201,162,39,0.2);
            border:1px solid rgba(201,162,39,0.45);
            color:#ffd700;border-radius:12px;
            padding:1px 9px;white-space:nowrap;
          ">📖 درس السيرة</span>
          <span style="font-size:0.62rem;color:rgba(255,255,255,0.35);margin-right:auto">${GharsUtils.timeAgo(notif.at)}</span>
        </div>
        <!-- نص الإشعار -->
        <div style="font-size:0.88rem;font-weight:800;color:#fff;line-height:1.5">
          ✨ <span style="color:#ffd700">${GharsUtils.esc(notif.teacherName)}</span> ردّ على تعليقك
        </div>
        <div style="font-size:0.76rem;color:rgba(201,162,39,0.8);margin-top:2px;font-weight:700">
          في درس: <span style="color:#e8c84a">${GharsUtils.esc(notif.lessonTitle)}</span>
        </div>
        ${replyPreview}
      </div>

      <!-- زر الإغلاق -->
      <button onclick="dismissNotification(event,'${notif.id}')" style="
        background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
        color:rgba(255,255,255,0.5);border-radius:50%;
        width:24px;height:24px;flex-shrink:0;
        display:flex;align-items:center;justify-content:center;
        font-size:0.7rem;cursor:pointer;
        transition:background 0.2s;
      " onmouseover="this.style.background='rgba(255,255,255,0.18)'"
         onmouseout="this.style.background='rgba(255,255,255,0.08)'">✖</button>
    </div>

    <!-- زر الانتقال للدرس -->
    <div style="
      padding:0 16px 12px;
      display:flex;gap:8px;
    ">
      <button onclick="openNotifLesson('${notif.lessonId}',${notif.commentIndex},'${notif.id}')"
        style="
          flex:1;
          background:linear-gradient(135deg,#c9a227,#a07d10);
          color:#0a1628;border:none;border-radius:12px;
          padding:9px 14px;
          font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:900;
          cursor:pointer;
          display:flex;align-items:center;justify-content:center;gap:6px;
          box-shadow:0 4px 14px rgba(201,162,39,0.4);
          transition:transform 0.15s,box-shadow 0.15s;
        "
        onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(201,162,39,0.55)'"
        onmouseout="this.style.transform='';this.style.boxShadow='0 4px 14px rgba(201,162,39,0.4)'"
      >👁 عرض الرد</button>
    </div>`;

  document.body.appendChild(el);

  // ── أنيميشن الظهور ──
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });

  // ── اختفاء تلقائي بعد 10 ثوانٍ ──
  const timer = setTimeout(() => dismissNotification(null, notif.id), 60000);
  _activeNotifTimers[notif.id] = timer;
}

function dismissNotification(ev, notifId) {
  if (ev) ev.stopPropagation();
  // إلغاء المؤقت
  if (_activeNotifTimers[notifId]) {
    clearTimeout(_activeNotifTimers[notifId]);
    delete _activeNotifTimers[notifId];
  }
  const el = document.getElementById('notif-' + notifId);
  if (!el) return;
  // أنيميشن الاختفاء
  el.style.opacity = '0';
  el.style.transform = 'translateX(-50%) translateY(20px) scale(0.95)';
  setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
  // ── تعليم الإشعار كمقروء ──
  GharsDB.get('notifications/' + notifId).then(n => {
    if (n) GharsDB.set('notifications/' + notifId, { ...n, read: true });
  }).catch(() => {});
}

async function openNotifLesson(lessonId, commentIndex, notifId) {
  // إغلاق الإشعار
  dismissNotification(null, notifId);
  // ── فتح الدرس والتمرير للتعليق ──
  try {
    const lesson = await GharsDB.get('lessons/' + lessonId);
    if (!lesson) { UI.toast('لم يتم العثور على الدرس', 'error'); return; }
    await buildLessonView(lessonId, lesson);
    navigate('lesson-view');
    // انتظر ظهور الصفحة ثم اسكرول للتعليق
    setTimeout(() => {
      const cont = document.getElementById('commentsContainer');
      if (cont) {
        cont.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // تمييز بصري للتعليقات
        cont.style.outline = '2px solid rgba(201,162,39,0.6)';
        cont.style.borderRadius = '12px';
        cont.style.transition = 'outline 0.5s ease';
        setTimeout(() => {
          cont.style.outline = 'none';
        }, 2500);
      }
    }, 500);
  } catch(e) {
    console.warn('openNotifLesson:', e);
    UI.toast('تعذّر فتح الدرس', 'error');
  }
}

// ============================================================
// ملفي الشخصي — الطالب
// ============================================================
async function showMyProfile() {
  const user = Auth.currentUser;
  if (!user) return;
  const freshUser = await GharsDB.get('users/'+user.id) || user;
  const roleLabel = freshUser.role==='student' ? 'طالب' : freshUser.role==='admin' ? 'مدير' : 'معلم';
  const avUrl = freshUser.avatarUrl || localStorage.getItem('ghars__avatar__'+freshUser.id);
  const avHtml = avUrl
    ? `<div onclick="this.closest('.modal-overlay').remove();_openAvatarPicker()" style="width:72px;height:72px;border-radius:50%;background-image:url('${avUrl}');background-size:cover;background-position:center;margin:0 auto 10px;border:3px solid rgba(201,162,39,0.6);box-shadow:0 4px 16px rgba(0,0,0,0.3);cursor:pointer;position:relative;overflow:hidden">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0);display:flex;align-items:center;justify-content:center;transition:background 0.2s" onmouseover="this.style.background='rgba(0,0,0,0.3)'" onmouseout="this.style.background='rgba(0,0,0,0)'"></div>
      </div>`
    : `<div onclick="this.closest('.modal-overlay').remove();_openAvatarPicker()" style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#c9a227,#a07d10);display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:900;color:#0a1628;margin:0 auto 10px;border:3px solid rgba(201,162,39,0.6);box-shadow:0 4px 16px rgba(0,0,0,0.3);cursor:pointer;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">${(freshUser.name||'?').charAt(0)}</div>`;

  UI.showModal(`<div class="modal" style="max-width:320px">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#1a3a6b);padding:14px 18px">
      <h3 style="color:#c9a227;font-size:0.95rem;margin:0">👤 ملفي الشخصي</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center">✖</button>
    </div>
    <div class="modal-body" style="padding:20px;text-align:center">
      ${avHtml}
      <div style="font-size:1.1rem;font-weight:900;color:#0a1628;margin-bottom:4px">${e(freshUser.name)}</div>
      <div style="display:inline-block;background:rgba(10,22,40,0.1);border-radius:16px;padding:2px 12px;font-size:0.75rem;font-weight:700;color:#0a1628;margin-bottom:16px">${roleLabel}</div>
      <div style="background:#f8fafc;border-radius:12px;padding:12px 16px;text-align:right;border:1px solid #e2e8f0;margin-bottom:14px">
        <div style="font-size:0.7rem;color:#999;margin-bottom:6px;font-weight:700">بيانات الدخول</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:0.82rem;font-weight:700;color:#0a1628">👤 ${e(freshUser.username)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:0.82rem;font-weight:700;color:#0a1628">🔑 ${e(freshUser.password)}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="this.closest('.modal-overlay').remove();showStudentQR()"
          style="flex:1;background:linear-gradient(135deg,#0a1628,#1a3a6b);color:#c9a227;border:1.5px solid rgba(201,162,39,0.5);border-radius:10px;padding:10px 6px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer">
          📱 رمز QR
        </button>
        <button onclick="copyMyCredentials()"
          style="flex:1;background:#f0f4ff;color:#1a3a6b;border:1px solid #c3d0f5;border-radius:10px;padding:10px 6px;font-family:Tajawal,sans-serif;font-size:0.82rem;font-weight:700;cursor:pointer">
          📋 نسخ
        </button>
      </div>
    </div>
  </div>`);
}

function copyMyCredentials() {
  const user = Auth.currentUser;
  if (!user) return;
  UI.copyText(`الاسم: ${user.name}\nاسم المستخدم: ${user.username}\nكلمة المرور: ${user.password}`);
}

async function showStudentQR() {
  const user = Auth.currentUser;
  if (!user) return;
  // تحديث بيانات المستخدم من DB للحصول على qrVersion
  const freshUser = await GharsDB.get('users/'+user.id) || user;
  if (!freshUser.qrVersion) {
    freshUser.qrVersion = GharsUtils.uid();
    GharsDB.set('users/'+freshUser.id, freshUser).catch(()=>{});
  }
  const baseUrl = window.location.origin + (window.location.pathname.replace(/\/[^/]*$/, '/') || '/');
  const payload = JSON.stringify({ un:freshUser.username, pw:freshUser.password, id:freshUser.id, ver:freshUser.qrVersion });
  const b64 = btoa(unescape(encodeURIComponent(payload)));
  const loginUrl = baseUrl + 'index.html?qr=' + encodeURIComponent(b64);
  const QR_DISPLAY = 256;           // حجم رمز QR
  const QR_PAD     = 14;            // هامش أبيض
  const QR_BOX     = QR_DISPLAY + QR_PAD * 2;  // 284px

  UI.showModal(`<div class="modal" style="max-width:360px;width:min(360px,96vw)">
    <div class="modal-header" style="background:linear-gradient(135deg,#0a1628,#0d1f3c);padding:13px 16px">
      <h3 style="color:#c9a227;font-size:0.9rem;margin:0">📱 رمز QR الخاص بك</h3>
      <button class="modal-close" style="color:#fff;background:rgba(255,255,255,0.15);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0">✖</button>
    </div>
    <div class="modal-body" style="padding:16px;text-align:center">
      <!-- بطاقة QR -->
      <div style="background:linear-gradient(145deg,#0a1628,#0d1f3c);border-radius:16px;padding:18px 14px 14px;margin-bottom:12px;border:1.5px solid rgba(201,162,39,0.45);box-shadow:0 8px 28px rgba(0,0,0,0.5)">
        <div style="font-size:1.2rem;font-weight:900;color:#c9a227;margin-bottom:2px">🌱 نادي غرس</div>
        <div style="width:44px;height:1.5px;background:linear-gradient(90deg,transparent,rgba(201,162,39,0.7),transparent);margin:4px auto 8px"></div>
        <div style="font-size:0.95rem;font-weight:800;color:#fff;margin-bottom:12px">${e(freshUser.name)}</div>
        <!-- الخلفية البيضاء — QR يملؤها مع هامش صغير -->
        <div style="display:inline-block;">
          <div style="background:#ffffff;border-radius:14px;padding:${QR_PAD}px;box-sizing:border-box;box-shadow:0 4px 20px rgba(0,0,0,0.4);position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;width:${QR_BOX}px;height:${QR_BOX}px">
            <div id="studentQrBox" style="display:flex;align-items:center;justify-content:center;width:${QR_DISPLAY}px;height:${QR_DISPLAY}px;flex-shrink:0"></div>
          </div>
        </div>
        <div style="font-size:0.68rem;color:rgba(201,162,39,0.85);background:rgba(201,162,39,0.12);display:inline-block;padding:3px 14px;border-radius:20px;border:1px solid rgba(201,162,39,0.3);margin-top:12px"> طالب </div>
        <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);margin-top:6px">📲 امسح الرمز للدخول تلقائياً</div>
      </div>
      <!-- بيانات الدخول -->
      <div style="background:#f8fafc;border-radius:12px;padding:11px 14px;text-align:right;border:1px solid #e2e8f0;margin-bottom:12px">
        <div style="font-size:0.65rem;color:#aaa;margin-bottom:5px;font-weight:700">بيانات الدخول</div>
        <div style="font-size:0.88rem;font-weight:800;color:#0a1628;margin-bottom:3px">👤 ${e(freshUser.username)}</div>
        <div style="font-size:0.88rem;font-weight:800;color:#0a1628">🔑 ${e(freshUser.password)}</div>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="downloadStudentQRCard()"
          style="flex:1;background:linear-gradient(135deg,#c9a227,#a07d10);color:#0a1628;border:none;border-radius:12px;padding:12px 8px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 14px rgba(201,162,39,0.4)">
          ⬇️ تحميل
        </button>
        <button onclick="shareStudentQRWhatsApp('${encodeURIComponent(loginUrl)}','${encodeURIComponent(freshUser.name)}')"
          style="flex:1;background:#25d366;color:#fff;border:none;border-radius:12px;padding:12px 8px;font-family:Tajawal,sans-serif;font-size:0.88rem;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 14px rgba(37,211,102,0.35)">
          💬 واتساب
        </button>
      </div>
    </div>
  </div>`);

  requestAnimationFrame(() => {
    setTimeout(() => {
      const box = document.getElementById('studentQrBox');
      if (!box) return;
      _generateStudentQR(loginUrl, QR_DISPLAY, box);
    }, 80);
  });
}

function shareStudentQRWhatsApp(encodedUrl, encodedName) {
  const name = decodeURIComponent(encodedName);
  const url  = decodeURIComponent(encodedUrl);
  const msg  = `🌱 *نادي غرس*\n👤 تسجيل الدخول لـ: *${name}*\n\n📲 اضغط الرابط لتسجيل الدخول تلقائياً:\n${url}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

async function downloadStudentQRCard() {
  const user = Auth.currentUser;
  if (!user) return;
  const baseUrl = window.location.origin + (window.location.pathname.replace(/\/[^/]*$/, '/') || '/');
  const payload = JSON.stringify({ un:user.username, pw:user.password, id:user.id, ver:user.qrVersion||GharsUtils.uid() });
  const b64 = btoa(unescape(encodeURIComponent(payload)));
  const loginUrl = baseUrl + 'index.html?qr=' + encodeURIComponent(b64);
  UI.toast('⏳ جاري إنشاء بطاقة QR...','info',3000);
  try {
    // بطاقة احترافية — بدون اسم المستخدم أو كلمة المرور
    const W=400, H=600, DPR=4;
    const canvas = document.createElement('canvas');
    canvas.width = W*DPR; canvas.height = H*DPR;
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

    // جلب QR بدقة عالية
    const QR_SZ = 248, QR_X = (W-QR_SZ)/2, QR_Y = 216;
    const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1200x1200&data=${encodeURIComponent(loginUrl)}&bgcolor=ffffff&color=0a1628&ecc=H&margin=0`;
    const qrImg = await new Promise((res,rej)=>{
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>res(img);
      img.onerror=()=>rej(new Error('QR load failed'));
      setTimeout(()=>rej(new Error('timeout')),15000);
      img.src=apiUrl;
    });

    // خلفية متدرجة داكنة
    const bgGrad = ctx.createLinearGradient(0,0,0,H);
    bgGrad.addColorStop(0,'#0c1e3e'); bgGrad.addColorStop(0.45,'#0a1628'); bgGrad.addColorStop(1,'#060d1a');
    ctx.fillStyle=bgGrad;
    ctx.beginPath(); _sRoundRect(ctx,0,0,W,H,24); ctx.fill();

    // وهج ذهبي خلفي
    const glow=ctx.createRadialGradient(W/2,85,10,W/2,85,210);
    glow.addColorStop(0,'rgba(201,162,39,0.18)'); glow.addColorStop(1,'rgba(201,162,39,0)');
    ctx.fillStyle=glow;
    ctx.beginPath(); _sRoundRect(ctx,0,0,W,260,24); ctx.fill();

    // إطارات ذهبية
    ctx.strokeStyle='rgba(201,162,39,0.85)'; ctx.lineWidth=2;
    ctx.beginPath(); _sRoundRect(ctx,2,2,W-4,H-4,23); ctx.stroke();
    ctx.strokeStyle='rgba(201,162,39,0.12)'; ctx.lineWidth=6;
    ctx.beginPath(); _sRoundRect(ctx,8,8,W-16,H-16,20); ctx.stroke();

    // دائرة الشعار
    const cx=W/2;
    const logoGrad=ctx.createLinearGradient(cx-30,24,cx+30,84);
    logoGrad.addColorStop(0,'#c9a227'); logoGrad.addColorStop(1,'#a07d10');
    ctx.fillStyle='rgba(201,162,39,0.12)';
    ctx.beginPath(); ctx.arc(cx,54,38,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=logoGrad;
    ctx.beginPath(); ctx.arc(cx,54,30,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(cx-9,44,13,0,Math.PI*2); ctx.fill();
    ctx.font='bold 28px Arial'; ctx.textAlign='center'; ctx.fillStyle='#0a1628';
    ctx.fillText('🌱',cx,63);

    // اسم النادي
    ctx.font='bold 28px Arial'; ctx.fillStyle='#c9a227';
    ctx.shadowColor='rgba(201,162,39,0.65)'; ctx.shadowBlur=20;
    ctx.fillText('نادي غرس',cx,114); ctx.shadowBlur=0;
    ctx.font='13.5px Arial'; ctx.fillStyle='rgba(255,255,255,0.42)';
    ctx.fillText('قيم تغرس وجيل يبنى',cx,134);

    // فاصل علوي
    const sg1=ctx.createLinearGradient(40,0,W-40,0);
    sg1.addColorStop(0,'transparent'); sg1.addColorStop(0.2,'rgba(201,162,39,0.7)');
    sg1.addColorStop(0.8,'rgba(201,162,39,0.7)'); sg1.addColorStop(1,'transparent');
    ctx.strokeStyle=sg1; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(40,152); ctx.lineTo(W-40,152); ctx.stroke();

    // الاسم والدور
    ctx.font='bold 23px Arial'; ctx.fillStyle='#ffffff';
    ctx.shadowColor='rgba(255,255,255,0.12)'; ctx.shadowBlur=8;
    ctx.fillText(user.name,cx,182); ctx.shadowBlur=0;
    const roleLabel=user.role==='student'?'طالب':user.role==='admin'?'مدير':'معلم';
    ctx.fillStyle='rgba(201,162,39,0.18)'; ctx.strokeStyle='rgba(201,162,39,0.6)'; ctx.lineWidth=1;
    ctx.beginPath(); _sRoundRect(ctx,cx-38,191,76,24,12); ctx.fill(); ctx.stroke();
    ctx.font='bold 13px Arial'; ctx.fillStyle='#c9a227';
    ctx.fillText(roleLabel,cx,207);

    // صندوق QR الأبيض
    const pad=16, boxX=QR_X-pad, boxY=QR_Y-pad, boxW=QR_SZ+pad*2, boxH2=QR_SZ+pad*2;
    ctx.shadowColor='rgba(201,162,39,0.45)'; ctx.shadowBlur=30;
    ctx.fillStyle='#ffffff';
    ctx.beginPath(); _sRoundRect(ctx,boxX,boxY,boxW,boxH2,18); ctx.fill();
    ctx.shadowBlur=0;
    // نقاط زاوية ذهبية
    [[boxX+7,boxY+7],[boxX+boxW-7,boxY+7],[boxX+7,boxY+boxH2-7],[boxX+boxW-7,boxY+boxH2-7]].forEach(([x2,y2])=>{
      ctx.fillStyle='rgba(201,162,39,0.55)';
      ctx.beginPath(); ctx.arc(x2,y2,4.5,0,Math.PI*2); ctx.fill();
    });
    // رسم QR
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(qrImg,QR_X,QR_Y,QR_SZ,QR_SZ);
    ctx.imageSmoothingEnabled=true;

    // نص المسح
    const scanY=QR_Y+QR_SZ+pad+30;
    ctx.font='bold 14.5px Arial'; ctx.fillStyle='rgba(255,255,255,0.55)';
    ctx.fillText('📲  امسح الرمز لتسجيل الدخول تلقائياً',cx,scanY);

    // فاصل سفلي
    const sep2Y=scanY+22;
    const sg2=ctx.createLinearGradient(40,0,W-40,0);
    sg2.addColorStop(0,'transparent'); sg2.addColorStop(0.5,'rgba(201,162,39,0.35)'); sg2.addColorStop(1,'transparent');
    ctx.strokeStyle=sg2; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(40,sep2Y); ctx.lineTo(W-40,sep2Y); ctx.stroke();

    // شارة خصوصية
    const privY=sep2Y+22;
    ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1;
    ctx.beginPath(); _sRoundRect(ctx,56,privY-14,W-112,26,13); ctx.fill(); ctx.stroke();
    ctx.font='12px Arial'; ctx.fillStyle='rgba(255,255,255,0.28)';
    ctx.fillText('🔒  بطاقة شخصية — للاستخدام الخاص فقط',cx,privY+3);

    // تذييل
    ctx.font='11px Arial'; ctx.fillStyle='rgba(201,162,39,0.45)';
    ctx.fillText('🌱  نادي غرس  ©  2026',cx,H-16);

    // تحميل
    const link=document.createElement('a');
    link.download=`ghars-qr-${user.name.replace(/\\s+/g,'-')}.png`;
    link.href=canvas.toDataURL('image/png',1.0);
    link.click();
    UI.toast('✅ تم تحميل البطاقة بجودة احترافية','success',2500);
  } catch(err) {
    console.error('downloadStudentQRCard error:', err);
    // Fallback
    try {
      const apiUrl2=`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(loginUrl)}&bgcolor=ffffff&color=0a1628&ecc=H&margin=2`;
      const a=document.createElement('a'); a.href=apiUrl2; a.download=`ghars-qr-${user.username}.png`; a.target='_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      UI.toast('✅ تم فتح صورة QR — احفظها من المتصفح','info',3000);
    } catch(e2){ UI.toast('⚠️ تعذّر التحميل — تحقق من الاتصال','error',3000); }
  }
}

function _sRoundRect(ctx,x,y,w,h,r){
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function _generateStudentQR(loginUrl, size, targetBox) {
  if (!targetBox) return;
  targetBox.innerHTML = '';
  targetBox.style.cssText = `display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;flex-shrink:0`;

  // spinner
  const spinner = document.createElement('div');
  spinner.style.cssText = `display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;position:absolute`;
  spinner.innerHTML = `<span class="loader"></span>`;
  targetBox.style.position = 'relative';
  targetBox.appendChild(spinner);

  // جلب QR بدقة 4× من API — أسود على أبيض
  const apiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size*4}x${size*4}&data=${encodeURIComponent(loginUrl)}&bgcolor=ffffff&color=000000&ecc=H&margin=0`;
  const img = document.createElement('img');
  img.alt = 'QR Code';
  img.style.cssText = `display:block;width:${size}px;height:${size}px;flex-shrink:0;image-rendering:pixelated`;
  img.onload  = () => { spinner.remove(); };
  img.onerror = () => {
    spinner.remove();
    if (typeof QRCode !== 'undefined') {
      try {
        targetBox.innerHTML = '';
        new QRCode(targetBox, { text:loginUrl, width:size, height:size, colorDark:'#000000', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.H });
        const fix = () => {
          const cv = targetBox.querySelector('canvas');
          const im = targetBox.querySelector('img');
          const s = `display:block!important;width:${size}px!important;height:${size}px!important;max-width:none!important`;
          if(cv){cv.setAttribute('style',s);cv.setAttribute('width',size);cv.setAttribute('height',size);}
          if(im) im.setAttribute('style',s);
        };
        fix(); setTimeout(fix, 150);
      } catch(_){}
    }
  };
  img.src = apiUrl;
  targetBox.appendChild(img);
}

// ── دالة _generateQRCode مشتركة ──
function _generateQRCode(loginUrl, size) {
  _generateStudentQR(loginUrl, size, document.getElementById('qrCodeBox'));
}

function _applyAvatarImage(el, user) {
  if (!el) return;
  const img = user?.avatarUrl || localStorage.getItem('ghars__avatar__' + (user?.id||''));
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

  // إذا لا توجد صورة → اعرض رسالة مع زر
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

  // إذا توجد صورة → اعرضها بشكل كامل مع أزرار
  showUserAvatar(imgUrl, true);
}

// عرض صورة أي مستخدم بشكل كامل وبجودة عالية
function showUserAvatar(imgUrl, isOwn) {
  if (!imgUrl) return;
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
    <button class="ghars-av-close" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.12);border:1.5px solid rgba(255,255,255,0.2);color:#fff;width:44px;height:44px;border-radius:50%;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px)">✖</button>
    <div style="max-width:92vw;max-height:75vh;display:flex;align-items:center;justify-content:center;border-radius:20px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.7)">
      <img src="${imgUrl}"
        style="display:block;max-width:92vw;max-height:75vh;width:auto;height:auto;object-fit:contain;image-rendering:high-quality;-webkit-image-rendering:-webkit-optimize-contrast;"
        loading="eager" decoding="sync" />
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
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) { document.body.removeChild(input); return; }
    const reader = new FileReader();
    reader.onload = async (e2) => {
      const dataUrl = e2.target.result;
      const resized = await _resizeImage(dataUrl, 200);
      const uid = Auth.currentUser?.id;
      if (!uid) return;
      try { localStorage.setItem('ghars__avatar__' + uid, resized); } catch(_) {}
      const updated = { ...Auth.currentUser, avatarUrl: resized };
      Auth.currentUser = updated;
      localStorage.setItem('ghars__session', JSON.stringify(updated));
      await GharsDB.set('users/' + uid, updated);
      const av = document.getElementById('headerAvatar');
      _applyAvatarImage(av, updated);
      UI.toast('✅ تم تحديث الصورة الشخصية', 'success', 2500);
    };
    reader.readAsDataURL(file);
    document.body.removeChild(input);
  };
  input.click();
}

async function _deleteAvatar() {
  const uid = Auth.currentUser?.id;
  if (!uid) return;
  try { localStorage.removeItem('ghars__avatar__' + uid); } catch(_) {}
  const updated = { ...Auth.currentUser };
  delete updated.avatarUrl;
  Auth.currentUser = updated;
  localStorage.setItem('ghars__session', JSON.stringify(updated));
  await GharsDB.set('users/' + uid, updated);
  const av = document.getElementById('headerAvatar');
  _applyAvatarImage(av, updated);
  UI.toast('🗑️ تم حذف الصورة الشخصية', 'info', 2500);
}

function _resizeImage(dataUrl, maxSize) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = maxSize || 800;
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
      else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.src = dataUrl;
  });
}

// ============================================================
// AUTO-CLEANUP — مسح المشاركات تلقائياً كل 100 ساعة
// ============================================================
async function _autoCleanSharePosts() {
  try {
    const CLEAN_INTERVAL = 100 * 3600 * 1000; // 100 ساعة
    const lastClean = parseInt(localStorage.getItem('ghars__lastShareClean')||'0');
    if(Date.now() - lastClean < CLEAN_INTERVAL) return;
    const cutoff = new Date(Date.now() - CLEAN_INTERVAL).toISOString();
    const allPosts = await GharsDB.getAll('share_posts');
    const uid = Auth.currentUser?.id;
    let deleted = 0;
    for(const p of Object.values(allPosts)) {
      if(p && p.studentId === uid && p.at && p.at < cutoff) {
        await GharsDB.delete('share_posts/'+p.id);
        deleted++;
      }
    }
    if(deleted > 0) GharsDB._invalidate('share_posts');
    localStorage.setItem('ghars__lastShareClean', String(Date.now()));
  } catch(e) { console.warn('autoCleanSharePosts:', e); }
}

// ============================================================
// COUNTDOWN LONG PRESS — إخفاء لساعتين
// ============================================================
function _setupCountdownLongPress() {
  const bar = document.getElementById('countdownBar');
  if (!bar) return;
  // تحقق إذا كان محفوظاً مخفياً
  const hideUntil = parseInt(localStorage.getItem('ghars__cdHideUntil') || '0');
  if (Date.now() < hideUntil) {
    bar.style.display = 'none';
    return;
  }
  let _lpT = null;
  const startHide = () => {
    _lpT = setTimeout(() => {
      _lpT = null;
      const until = Date.now() + 2 * 3600 * 1000; // ساعتان
      localStorage.setItem('ghars__cdHideUntil', String(until));
      bar.style.display = 'none';
      UI.toast('تم إخفاء العد التنازلي لمدة ساعتين', 'info', 3000);
    }, 600);
  };
  const cancelHide = () => { if (_lpT) { clearTimeout(_lpT); _lpT = null; } };
  bar.addEventListener('touchstart',  startHide,  { passive: true });
  bar.addEventListener('touchend',    cancelHide, { passive: true });
  bar.addEventListener('touchcancel', cancelHide, { passive: true });
  bar.addEventListener('mousedown',   startHide);
  bar.addEventListener('mouseup',     cancelHide);
  bar.addEventListener('mouseleave',  cancelHide);
}
// ============================================================
// ميزة الاستبيان — الطالب (صفحة كاملة + دائرة قابلة للسحب)
// ============================================================
let _surveyCurrentMeetingId = null;
let _surveySelectedStars    = 0;
let _surveyPendingData      = null;   // بيانات الاستبيان النشط
let _surveyMinimized        = false;  // هل الاستبيان مصغّر؟
let _surveyDragActive       = false;
const _starLabels = ['','لم أفهم شيئاً 😔','فهمت قليلاً 🤔','فهمت بشكل متوسط 😐','فهمت معظمه 🙂','فهمت الدرس تماماً 🌟'];

function _removeSurveyBubble() {
  const bubble = document.getElementById('ghars-survey-bubble');
  if (bubble) bubble.remove();
  // تنظيف مستمعي الأحداث المتراكمة على document
  if (window._surveyDocListeners) {
    document.removeEventListener('mousemove',  window._surveyDocListeners.mm);
    document.removeEventListener('mouseup',    window._surveyDocListeners.mu);
    document.removeEventListener('touchmove',  window._surveyDocListeners.tm);
    document.removeEventListener('touchend',   window._surveyDocListeners.te);
    window._surveyDocListeners = null;
  }
  _surveyDragActive = false;
}

// ── الفحص الدوري / عند تسجيل الدخول ──
async function checkLessonSurvey() {
  const uid = Auth.currentUser?.id;
  if (!uid) return;
 
  try {
    const [surveys, responses, meetings] = await Promise.all([
      GharsDB.getAll('lesson_surveys'),
      GharsDB.getAll('lesson_survey_responses'),
      GharsDB.getAll('meetings')
    ]);
    const now = Date.now();
 
    // ── إذا كان هناك استبيان نشط مسبقاً ──
    if (_surveyPendingData) {
      const currentSurvey = surveys[_surveyPendingData.meetingId] ||
        Object.values(surveys).find(s => s.meetingId === _surveyPendingData.meetingId);
 
      const isExpired = !currentSurvey || !currentSurvey.expiresAt ||
        new Date(currentSurvey.expiresAt).getTime() < now;
 
      // ── فحص ما إذا أرسل الطالب استبياناً في جلسة أخرى ──
      const alreadyResponded = !isExpired && Object.values(responses).some(
        r => r.meetingId === _surveyPendingData.meetingId && r.studentId === uid
      );
 
      // ── فحص ما إذا كان الطالب لا يزال في قائمة الحاضرين المحدَّثة ──
      let isStillPresent = false;
      if (currentSurvey && !isExpired && !alreadyResponded) {
        if (currentSurvey.presentStudents && Array.isArray(currentSurvey.presentStudents)) {
          // استخدام قائمة الحاضرين المحدَّثة من الاستبيان (يُحدِّثها المعلم عند حفظ التحضير)
          isStillPresent = currentSurvey.presentStudents.includes(uid);
        } else {
          // Fallback: التحقق من التحضير الرسمي في اللقاء
          const mtg = Object.values(meetings).find(m => m.id === currentSurvey.meetingId && !m.deleted);
          isStillPresent = mtg?.attendance?.[uid] === 'present';
        }
      }
 
      // ── إذا انتهى الوقت أو أرسل بالفعل أو لم يعد حاضراً → أزل الاستبيان ──
      if (isExpired || alreadyResponded || !isStillPresent) {
        _surveyPendingData = null;
        _surveyCurrentMeetingId = null;
        _surveySelectedStars = 0;
        _surveyMinimized = false;
        window._surveySavedComment = '';
        _removeSurveyBubble();
        if (currentPage === 'survey') navigate('home', true);
        return;
      }
 
      // ── لا يزال صالحاً والطالب حاضر ──
      const bubbleExists = !!document.getElementById('ghars-survey-bubble');
      if (currentPage !== 'survey' && !bubbleExists) {
        if (_surveyMinimized) {
          _createSurveyBubble();
        } else {
          navigate('survey');
        }
      }
      return;
    }
 
    // ── إذا كانت صفحة الاستبيان أو الدائرة ظاهرة فعلاً، لا تفعل شيئاً ──
    if (currentPage === 'survey') return;
    if (document.getElementById('ghars-survey-bubble')) return;
 
    // ── البحث عن استبيان نشط جديد ──
    const activeSurvey = Object.values(surveys).find(s => {
      if (!s || !s.expiresAt) return false;
      // انتهى وقت الاستبيان؟
      if (new Date(s.expiresAt).getTime() < now) return false;
      // أرسل الطالب استبياناً بالفعل؟
      const alreadyResponded = Object.values(responses).some(
        r => r.meetingId === s.meetingId && r.studentId === uid
      );
      if (alreadyResponded) return false;
 
      // ── فحص ما إذا كان الطالب في قائمة الحاضرين ──
      if (s.presentStudents && Array.isArray(s.presentStudents)) {
        // القائمة المحدَّثة من المعلم (الأولوية)
        return s.presentStudents.includes(uid);
      }
      // Fallback: التحضير الرسمي من اللقاء
      const mtg = Object.values(meetings).find(m => m.id === s.meetingId && !m.deleted);
      const att = mtg?.attendance || {};
      return att[uid] === 'present';
    });
 
    if (!activeSurvey) return;
 
    _surveyCurrentMeetingId = activeSurvey.meetingId;
    _surveyPendingData = activeSurvey;
    _surveyMinimized = false;
    _surveySelectedStars = 0;
 
    navigate('survey');
  } catch(err) {
    console.warn('checkLessonSurvey:', err);
  }
}

// ── فتح صفحة الاستبيان (من الدائرة أو برمجياً) ──
function _openSurveyPage() {
  if (!_surveyPendingData) return;
  _surveyMinimized = false;
  _removeSurveyBubble();
  navigate('survey');
}

// ── بناء محتوى صفحة الاستبيان ──
function _renderSurveyPage(survey) {
  const contentEl = document.getElementById('surveyPageContent');
  if (!contentEl) return;

  // استعادة التقييم المحفوظ إن كان الطالب قد اختار نجوماً قبل التصغير
  const savedStars = _surveySelectedStars;

  contentEl.innerHTML = `
    <!-- هيدر اسم الدرس + زر X للتصغير -->
    <div class="card mb-2" style="border:2px solid rgba(201,162,39,0.35);border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#0a1628,#1a3a6b);padding:16px;display:flex;align-items:center;gap:14px">
        <div style="width:46px;height:46px;background:linear-gradient(135deg,#c9a227,#a07d10);border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;box-shadow:0 4px 12px rgba(201,162,39,0.4)">📋</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:0.95rem;color:#fff">استبيان عن درس اليوم</div>
          <div style="font-size:0.75rem;color:rgba(201,162,39,0.85);margin-top:3px">${(survey.meetingTitle||'اللقاء')}</div>
        </div>
        <button onclick="_minimizeSurveyToBubble()" title="تصغير"
          style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.12);border:none;color:rgba(255,255,255,0.85);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;flex-shrink:0"
          onmouseover="this.style.background='rgba(255,255,255,0.22)'" onmouseout="this.style.background='rgba(255,255,255,0.12)'">✕</button>
      </div>
    </div>

    <!-- بطاقة النجوم -->
    <div class="card mb-2" style="border-radius:16px;overflow:hidden">
      <div class="card-body" style="padding:22px 16px">
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-weight:800;font-size:0.95rem;color:var(--navy);margin-bottom:16px">كيف كان مستوى فهمك للدرس؟</div>
          <div id="survey-stars-row" style="display:flex;justify-content:center;gap:8px;margin-bottom:10px">
            ${[1,2,3,4,5].map(n=>`<span
              class="s-star"
              data-val="${n}"
              onclick="_selectStar(${n})"
              onmouseenter="_hoverStar(${n})"
              onmouseleave="_unhoverStar()"
              style="font-size:2.6rem;cursor:pointer;transition:transform 0.15s,filter 0.15s,color 0.15s;color:${n<=savedStars?'#c9a227':'#ddd'};transform:${n<=savedStars?'scale(1.1)':'scale(1)'};filter:${n<=savedStars?'drop-shadow(0 0 5px rgba(201,162,39,0.5))':''};user-select:none">★</span>`).join('')}
          </div>
          <div id="survey-star-label" style="font-size:0.88rem;color:var(--gold);font-weight:700;min-height:22px;transition:all 0.2s">${savedStars ? (_starLabels[savedStars]||'') : ''}</div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--gray);padding:10px 4px 0;border-top:1px solid #f0f0f0">
          <span>😔 لم أفهم شيئاً</span>
          <span>🌟 فهمت تماماً</span>
        </div>
      </div>
    </div>

    <!-- بطاقة السؤال الاختياري -->
    <div class="card mb-3" style="border-radius:16px;overflow:hidden">
      <div class="card-header">
        <h3>💬 سؤالك للمعلم
          <span style="background:rgba(160,174,192,0.15);color:var(--gray);border-radius:20px;padding:2px 10px;font-size:0.7rem;font-weight:600">اختياري</span>
        </h3>
      </div>
      <div class="card-body">
        <div style="font-size:0.9rem;color:#0a1628;font-weight:700;margin-bottom:10px;line-height:1.7">
          ما هو الغرس الذي لم يُثمر في فهمك بعد؟<br>
          <span style="font-weight:500;font-size:0.82rem;color:#333">اطرح سؤالك لنساعدك</span>
        </div>
        <textarea id="survey-comment-box" rows="4"
          placeholder="اكتب سؤالك أو استفسارك هنا... (اختياري)"
          class="form-input"
          style="resize:none;direction:rtl;line-height:1.7;caret-color:#c9a227;font-size:0.86rem">${window._surveySavedComment||''}</textarea>
      </div>
    </div>

    <!-- زر الإرسال -->
    <button id="survey-send-btn" onclick="_submitSurvey()"
      ${savedStars ? '' : 'disabled'}
      class="finish-lesson-btn" style="font-size:0.95rem;padding:14px;margin-top:0">
      📤 إرسال الاستبيان
    </button>
    <div id="survey-send-hint" style="text-align:center;font-size:0.73rem;color:var(--gray);margin-top:8px;${savedStars?'display:none':''}">
      يجب اختيار عدد النجوم أولاً
    </div>`;
}

// ── تصغير الاستبيان إلى دائرة قابلة للسحب ──
function _minimizeSurveyToBubble() {
  window._surveySavedComment = document.getElementById('survey-comment-box')?.value || '';
  _surveyMinimized = true;
  const prevPage = pageHistory.length ? pageHistory[pageHistory.length - 1] : 'home';
  navigate(prevPage);
  setTimeout(_createSurveyBubble, 150);
}

// ── إنشاء الدائرة العائمة القابلة للسحب ──
function _createSurveyBubble() {
  // أزل الدائرة القديمة ونظّف مستمعيها أولاً
  _removeSurveyBubble();
 
  const bubble = document.createElement('div');
  bubble.id = 'ghars-survey-bubble';
 
  let posLeft = Math.max(0, window.innerWidth  - 80);
  let posTop  = Math.max(0, window.innerHeight - 160);
 
  bubble.style.cssText = [
    `position:fixed;left:${posLeft}px;top:${posTop}px;z-index:99999;`,
    'width:62px;height:62px;border-radius:50%;',
    'background:linear-gradient(135deg,#c9a227,#a07d10);',
    'box-shadow:0 6px 22px rgba(201,162,39,0.55),0 0 0 5px rgba(201,162,39,0.18);',
    'display:flex;align-items:center;justify-content:center;font-size:1.6rem;',
    'cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:none;',
    'animation:surveyBubblePop 0.38s cubic-bezier(0.22,1,0.36,1) both;',
    'transition:box-shadow 0.2s;'
  ].join('');
  bubble.innerHTML = '📋';
  bubble.title = 'فتح استبيان الدرس';
 
  // نبضة توجيهية
  const pulse = document.createElement('span');
  pulse.style.cssText = [
    'position:absolute;inset:-6px;border-radius:50%;',
    'background:rgba(201,162,39,0.25);',
    'animation:surveyPulse 2s ease-out infinite;pointer-events:none;'
  ].join('');
  bubble.appendChild(pulse);
 
  // ── منطق السحب والنقر ──
  let startX, startY, startLeft, startTop, moved = false;
 
  function onDragStart(ex, ey) {
    moved = false;
    startX = ex; startY = ey;
    const rect = bubble.getBoundingClientRect();
    startLeft = rect.left; startTop = rect.top;
    _surveyDragActive = true;
    bubble.style.transition = 'none';
    bubble.style.boxShadow = '0 10px 30px rgba(201,162,39,0.7),0 0 0 6px rgba(201,162,39,0.25)';
  }
 
  function onDragMove(ex, ey) {
    if (!_surveyDragActive) return;
    const dx = ex - startX, dy = ey - startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
    const nl = Math.max(0, Math.min(window.innerWidth  - 62, startLeft + dx));
    const nt = Math.max(0, Math.min(window.innerHeight - 62, startTop  + dy));
    bubble.style.left = nl + 'px';
    bubble.style.top  = nt + 'px';
  }
 
  function onDragEnd() {
    if (!_surveyDragActive) return;
    _surveyDragActive = false;
    bubble.style.transition = 'box-shadow 0.2s';
    bubble.style.boxShadow  = '0 6px 22px rgba(201,162,39,0.55),0 0 0 5px rgba(201,162,39,0.18)';
    if (!moved) {
      _openSurveyPage();
    }
  }
 
  // أحداث اللمس على الدائرة
  bubble.addEventListener('touchstart', e => {
    const t = e.touches[0];
    onDragStart(t.clientX, t.clientY);
  }, { passive: true });
 
  // أحداث الماوس على الدائرة
  bubble.addEventListener('mousedown', e => {
    e.preventDefault();
    onDragStart(e.clientX, e.clientY);
  });
 
  // ── Fallback للنقر المباشر (يعمل حتى لو فشل السحب) ──
  bubble.addEventListener('click', e => {
    e.stopPropagation();
    if (!moved) {
      _openSurveyPage();
    }
    moved = false; // إعادة الضبط لضمان النقرة التالية تعمل
  });
 
  // ── مستمعو الحركة والتحرر على document (مخزّنة للتنظيف لاحقاً) ──
  const mmFn = (e) => { if (_surveyDragActive) onDragMove(e.clientX, e.clientY); };
  const muFn = () => onDragEnd();
  const tmFn = (e) => {
    if (_surveyDragActive && e.touches.length > 0) {
      onDragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };
  const teFn = () => onDragEnd();
 
  document.addEventListener('mousemove',  mmFn);
  document.addEventListener('mouseup',    muFn);
  document.addEventListener('touchmove',  tmFn, { passive: true });
  document.addEventListener('touchend',   teFn);
 
  // حفظ المراجع للتنظيف عند الحذف
  window._surveyDocListeners = { mm: mmFn, mu: muFn, tm: tmFn, te: teFn };
 
  document.body.appendChild(bubble);
 
  // ضخّ الـ keyframes إن لم تكن موجودة
  if (!document.getElementById('ghars-survey-keyframes')) {
    const st = document.createElement('style');
    st.id = 'ghars-survey-keyframes';
    st.textContent = `
      @keyframes surveyBubblePop {
        from { transform:scale(0.4);opacity:0; }
        to   { transform:scale(1);opacity:1; }
      }
      @keyframes surveyPulse {
        0%   { transform:scale(1);   opacity:0.7; }
        70%  { transform:scale(1.55);opacity:0; }
        100% { transform:scale(1.55);opacity:0; }
      }
    `;
    document.head.appendChild(st);
  }
}

// ── تحديد النجوم ──
function _selectStar(n) {
  _surveySelectedStars = n;
  document.querySelectorAll('#survey-stars-row .s-star').forEach((s,i) => {
    const on = i < n;
    s.style.color     = on ? '#c9a227' : '#ddd';
    s.style.transform = on ? 'scale(1.15)' : 'scale(1)';
    s.style.filter    = on ? 'drop-shadow(0 0 6px rgba(201,162,39,0.55))' : '';
  });
  const lbl = document.getElementById('survey-star-label');
  if (lbl) lbl.textContent = _starLabels[n] || '';
  const btn = document.getElementById('survey-send-btn');
  if (btn) btn.disabled = false;
  const hint = document.getElementById('survey-send-hint');
  if (hint) hint.style.display = 'none';
}
function _hoverStar(n) {
  if (_surveySelectedStars > 0) return;
  document.querySelectorAll('#survey-stars-row .s-star').forEach((s,i) => {
    s.style.color = i < n ? 'rgba(201,162,39,0.65)' : '#ddd';
  });
}
function _unhoverStar() {
  if (_surveySelectedStars > 0) return;
  document.querySelectorAll('#survey-stars-row .s-star').forEach(s => { s.style.color = '#ddd'; });
}

// ── إرسال الاستبيان ──
async function _submitSurvey() {
  if (!_surveySelectedStars) { UI.toast('يرجى تحديد عدد النجوم أولاً', 'error'); return; }
  const uid   = Auth.currentUser?.id;
  const uname = Auth.currentUser?.name || 'طالب';
  const comment = (document.getElementById('survey-comment-box')?.value || '').trim();
  const mid = _surveyCurrentMeetingId;
  if (!mid || !uid) return;
 
  const btn = document.getElementById('survey-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }
 
  try {
    const key = `${mid}_${uid}`;
    await GharsDB.set('lesson_survey_responses/' + key, {
      id: key, meetingId: mid,
      studentId: uid, studentName: uname,
      stars: _surveySelectedStars, comment,
      submittedAt: new Date().toISOString()
    });
 
    // ── مسح حالة الاستبيان بشكل كامل ──
    _surveyPendingData       = null;
    _surveyCurrentMeetingId  = null;
    _surveySelectedStars     = 0;
    _surveyMinimized         = false;
    window._surveySavedComment = '';
 
    // ── إزالة الدائرة ومستمعيها نهائياً ──
    _removeSurveyBubble();
 
    // ── شاشة الشكر ──
    const contentEl = document.getElementById('surveyPageContent');
    if (contentEl) {
      contentEl.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:24px">
          <div style="font-size:4.5rem;margin-bottom:16px;animation:zoomIn 0.5s both">🌟</div>
          <div style="font-weight:800;font-size:1.2rem;color:var(--navy);margin-bottom:8px">شكراً على مشاركتك!</div>
          <div style="font-size:0.88rem;color:var(--gray);margin-bottom:32px;line-height:1.8">
            تم إرسال استبيانك للمعلم بنجاح.<br>رأيك يساعدنا على تحسين الدرس.
          </div>
          <button onclick="navigate('home')" class="btn btn-primary"
            style="padding:13px 36px;font-size:0.95rem;border-radius:14px">
            العودة للرئيسية ←
          </button>
        </div>`;
    }
    UI.toast('✅ تم إرسال الاستبيان بنجاح', 'success', 3000);
    // انتقال تلقائي بعد 4 ثوانٍ
    setTimeout(() => { if (currentPage === 'survey') navigate('home', true); }, 4000);
 
  } catch(err) {
    console.error('survey submit error:', err);
    UI.toast('حدث خطأ أثناء الإرسال، حاول مرة أخرى', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 إرسال الاستبيان'; }
  }
}
