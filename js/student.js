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

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth('student')) return;
  const user = Auth.currentUser;
  setEl('headerUserName', user.name);
  setEl('sidebarUserName', user.name);
  const av = document.getElementById('headerAvatar');
  if (av) av.textContent = user.name.charAt(0);

  // Update last seen
  const now = new Date();
  const updated = { ...user, lastSeen:now.toISOString(), lastSeenDay:GharsUtils.arabicDay(now), lastSeenHijri:GharsUtils.hijriShort(now) };
  await GharsDB.set('users/'+user.id, updated);
  Auth.currentUser = updated;
  localStorage.setItem('ghars__session', JSON.stringify(updated));

  // Restore page from hash
  const hash = location.hash.replace('#','');
  const validPages = ['home','seerah','homework','points-detail','memo-detail','lesson-view','my-answers'];
  const startPage = validPages.includes(hash) ? hash : 'home';

  window.addEventListener('popstate', (ev) => {
    const p = (ev.state && ev.state.page) ? ev.state.page : 'home';
    navigateSilent(p);
  });

  await loadStudentHome();
  await loadUpcomingMeeting();
  navigate(startPage, true);
});

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
  _activatePage(page);
}
function navigateSilent(page) { _activatePage(page); }
function _activatePage(page) {
  document.querySelectorAll('.page-section').forEach(s=>s.classList.remove('active'));
  const sec=document.getElementById('section-'+page);
  if(sec){ sec.classList.add('active'); sec.style.animation='none'; sec.offsetHeight; sec.style.animation=''; }
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.page===page));
  currentPage=page; closeSidebar();
  window.scrollTo({top:0,behavior:'smooth'});
  onStudentPageLoad(page);
}
function onStudentPageLoad(page) {
  switch(page) {
    case 'home':          loadStudentHome(); break;
    case 'seerah':        loadStudentSeerah(); break;
    case 'homework':      loadStudentHomework(); break;
    case 'points-detail': loadPointsDetail(); break;
    case 'memo-detail':   loadMemoDetail(); break;
  }
}
function toggleSidebar() {
  const sb=document.getElementById('sidebar'), ov=document.getElementById('sidebarOverlay');
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
  const [ptsData,meetings,groups]=await Promise.all([
    GharsDB.get('points_summary/'+uid), GharsDB.getAll('meetings'), GharsDB.getAll('groups')
  ]);
  const total=ptsData?.total||0;
  const ptsEl=document.getElementById('studentPoints');
  if(ptsEl){ ptsEl.textContent=total; ptsEl.style.animation='none'; ptsEl.offsetHeight; ptsEl.style.animation='countUp 0.6s both ease'; }
  renderGroupsRanking(groups);
  renderAttendanceRecords(meetings);
}
function renderGroupsRanking(groups) {
  const c=document.getElementById('groupsRanking'); if(!c) return;
  const sorted=Object.values(groups).sort((a,b)=>(b.points||0)-(a.points||0));
  if(!sorted.length){c.innerHTML='<p style="color:var(--gray);text-align:center;font-size:0.85rem">لا توجد مجموعات</p>';return;}
  const medals=['🥇','🥈','🥉'];
  c.innerHTML=sorted.map((g,i)=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:var(--radius-sm);background:var(--white);border:1px solid var(--gray-mid);margin-bottom:8px;animation:fadeInUp 0.3s ${i*0.06}s both ease;transition:box-shadow 0.25s ease" onmouseover="this.style.boxShadow='var(--shadow-md)'" onmouseout="this.style.boxShadow=''">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.2rem">${medals[i]||'🏅'}</span>
        <span style="font-weight:700;color:var(--navy)">${e(g.name)}</span>
      </div>
      <span class="badge badge-gold">⭐ ${g.points||0}</span>
    </div>`).join('');
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
  const meetings=await GharsDB.getAll('meetings');
  const now=Date.now();
  const upcoming=Object.values(meetings).filter(m=>!m.deleted&&new Date(m.date).getTime()>now).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const bar=document.getElementById('countdownBar');
  if(!upcoming.length){if(bar)bar.style.display='none';return;}
  const next=upcoming[0];
  if(bar)bar.style.display='flex';
  const tt=document.getElementById('cdMeetingTitle');if(tt)tt.textContent=next.title||'';
  cdTimer=GharsUtils.countdown(next.date,({done,days,hours,minutes,seconds})=>{
    if(done){if(bar)bar.style.display='none';clearInterval(cdTimer);return;}
    const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v).padStart(2,'0');};
    s('cdDays',days);s('cdHours',hours);s('cdMins',minutes);s('cdSecs',seconds);
  });
}

// ============================================================
// POINTS DETAIL — horizontal layout, no lesson_view
// ============================================================
async function loadPointsDetail() {
  const uid=Auth.currentUser.id;
  const [pts,meetings]=await Promise.all([GharsDB.get('points_summary/'+uid),GharsDB.getAll('meetings')]);
  const c=document.getElementById('pointsDetailCard');
  if(!pts||!c){if(c)c.innerHTML=`<div class="card"><div class="card-body"><p style="color:var(--gray);text-align:center">لا توجد نقاط</p></div></div>`;return;}
  const breakdown=pts.breakdown||[];
  const total=pts.total||0;
  // Group by meeting
  const meetingIds=[...new Set(breakdown.filter(b=>b.meetingId).map(b=>b.meetingId))];
  const meetingCards=meetingIds.map(mid=>{
    const m=meetings[mid];
    const mItems=breakdown.filter(b=>b.meetingId===mid);
    const att=mItems.find(b=>b.type==='attendance');
    const task=mItems.find(b=>b.type==='task');
    const comment=mItems.find(b=>b.type==='lesson_comment');
    const initEntries=mItems.filter(b=>b.type==='initiative');
    const title=m?.title||att?.meetingTitle||'لقاء';
    const date=m?.date;
    const rowTotal=(att?.points||0)+(task?.points||0)+(comment?.points||0)+initEntries.reduce((a,b)=>a+(b.points||0),0);
    return `<div style="border:1px solid var(--gray-mid);border-radius:var(--radius);margin-bottom:10px;overflow:hidden;animation:fadeInUp 0.35s both ease">
      <div style="background:linear-gradient(135deg,var(--navy),var(--navy-light));padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-weight:800;font-size:0.9rem;color:#fff">📅 ${e(title)}</div>
          ${date?`<div style="font-size:0.72rem;color:rgba(255,255,255,0.6)">${GharsUtils.toHijriShort(new Date(date))}</div>`:''}
        </div>
        <span style="background:rgba(201,162,39,0.2);color:var(--gold);border:1px solid rgba(201,162,39,0.4);border-radius:20px;padding:3px 10px;font-weight:700;font-size:0.82rem">⭐ ${rowTotal}</span>
      </div>
      <div style="padding:12px 14px">
        <div class="pts-row-horizontal">
          ${ptsCellH('✅','الحضور',att)}
          ${ptsCellH('📚','الواجب',task)}
          ${ptsCellH('💬','التعليق',comment)}
        </div>
        ${initEntries.length?`<div style="background:#fffaf0;border-radius:8px;padding:8px 12px;font-size:0.82rem;display:flex;justify-content:space-between">
          <span>⭐ مبادرات</span><span style="font-weight:700;color:var(--gold)">+${initEntries.reduce((a,b)=>a+(b.points||0),0)}</span>
        </div>`:''}
      </div>
    </div>`;
  }).join('');
  const noMeetingInit=breakdown.filter(b=>b.type==='initiative'&&!b.meetingId);
  const extraCard=noMeetingInit.length?`<div style="border:1px solid var(--gray-mid);border-radius:var(--radius);margin-bottom:10px;overflow:hidden;animation:fadeInUp 0.35s both ease">
    <div style="background:linear-gradient(135deg,var(--gold-dark),var(--gold));padding:10px 14px;color:var(--navy)"><div style="font-weight:800;font-size:0.9rem">⭐ مبادرات إضافية</div></div>
    <div style="padding:12px 14px">${noMeetingInit.map(b=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.82rem;border-bottom:1px solid var(--gray-mid)"><span>${e(b.by?'من '+b.by:'')}</span><span style="font-weight:700;color:var(--gold)">+${b.points}</span></div>`).join('')}</div>
  </div>`:'';
  const empty=!meetingCards&&!extraCard;
  c.innerHTML=(empty?`<div class="card"><div class="card-body"><p style="color:var(--gray);text-align:center">لا توجد نقاط مسجلة</p></div></div>`:'')
    +meetingCards+extraCard
    +(!empty?`<div style="background:linear-gradient(135deg,var(--navy),var(--navy-light));border-radius:var(--radius);padding:20px;text-align:center;animation:fadeInUp 0.5s both ease;box-shadow:0 8px 32px rgba(10,22,40,0.35)">
      <div style="font-size:0.82rem;color:rgba(255,255,255,0.6)">إجمالي نقاطي</div>
      <div style="font-size:2.8rem;font-weight:900;color:var(--gold);text-shadow:0 0 30px var(--gold-glow)">⭐ ${total}</div>
    </div>`:'');
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
// SEERAH
// ============================================================
async function loadStudentSeerah() {
  const lessons=await GharsDB.getAll('lessons');
  const c=document.getElementById('seerahList');
  const list=Object.values(lessons).filter(l=>!l.deleted).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  if(!list.length){c.innerHTML=`<div class="no-data"><div class="no-data-icon">🕌</div><p>لا توجد دروس</p></div>`;return;}
  c.innerHTML=list.map((l,i)=>`
    <div class="lesson-v2" style="animation-delay:${i*0.07}s">
      <div class="lesson-v2-header">
        <div style="font-size:1.7rem">🕌</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:800;font-size:0.93rem;color:#fff">${e(l.title)}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.55);margin-top:3px">${GharsUtils.toHijriShort(new Date(l.createdAt))}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
            ${l.videoSource==='youtube'?`<span style="background:rgba(255,0,0,0.25);color:#ff6b6b;border-radius:12px;padding:2px 8px;font-size:0.7rem;font-weight:700">▶️ يوتيوب</span>`:''}
            ${l.videoSource==='upload'?`<span style="background:rgba(201,162,39,0.2);color:var(--gold);border-radius:12px;padding:2px 8px;font-size:0.7rem;font-weight:700">🎥 فيديو</span>`:''}
            ${l.pdfUrl?`<span style="background:rgba(56,161,105,0.2);color:#48bb78;border-radius:12px;padding:2px 8px;font-size:0.7rem;font-weight:700">📄 PDF</span>`:''}
          </div>
        </div>
      </div>
      <div class="lesson-v2-body">
        ${l.topic?`<p style="font-size:0.83rem;color:var(--gray);margin-bottom:10px">${e(l.topic.substring(0,80))}${l.topic.length>80?'...':''}</p>`:''}
        <button class="btn btn-primary btn-sm" onclick="openLesson('${l.id}')">👁 مشاهدة الدرس</button>
      </div>
    </div>`).join('');
}

async function openLesson(id) {
  const lesson=await GharsDB.get('lessons/'+id); if(!lesson) return;
  const uid=Auth.currentUser.id;
  // Mark viewed
  const viewers=[...(lesson.viewers||[])];
  if(!viewers.find(v=>v.studentId===uid)) {
    viewers.push({studentId:uid,at:new Date().toISOString()});
    await GharsDB.set('lessons/'+id,{...lesson,viewers});
    // +2 pts for lesson view if linked to meeting
    if(lesson.linkedMeeting) {
      const pts=await GharsDB.get('points_summary/'+uid)||{id:uid,total:0,breakdown:[]};
      const already=pts.breakdown?.some(b=>b.type==='lesson_view'&&b.lessonId===id);
      if(!already) {
        const meeting=await GharsDB.get('meetings/'+lesson.linkedMeeting);
        pts.total=(pts.total||0)+2;
        pts.breakdown=[...(pts.breakdown||[]),{type:'lesson_view',lessonId:id,meetingId:lesson.linkedMeeting,meetingTitle:meeting?.title||'لقاء',points:2,date:new Date().toISOString()}];
        await GharsDB.set('points_summary/'+uid,pts);
      }
    }
  }
  await buildLessonView(id,lesson);
  navigate('lesson-view');
}

async function buildLessonView(id,lesson) {
  let mediaHtml='';

  if(lesson.videoSource==='youtube'&&lesson.videoUrl) {
    // YOUTUBE: button ONLY, no embed
    mediaHtml=`
      <div style="text-align:center;padding:20px 0;animation:zoomIn 0.4s both ease">
        <div style="margin-bottom:12px;font-size:0.85rem;color:var(--gray)">مقطع فيديو من يوتيوب</div>
        <a href="${e(lesson.videoUrl)}" target="_blank" rel="noopener noreferrer" class="yt-watch-btn" onclick="this.closest('a')&&void 0">
          <span class="yt-icon">▶</span>
          <span>مشاهدة على يوتيوب</span>
        </a>
      </div>`;
  } else if(lesson.videoSource==='upload'&&lesson.videoUrl) {
    // UPLOADED VIDEO: resolve idb:// to blob URL
    let resolvedUrl=lesson.videoUrl;
    if(resolvedUrl.startsWith('idb://')) {
      try {
        const blobUrl=await GharsFilesDB.resolveUrl(resolvedUrl);
        resolvedUrl=blobUrl||resolvedUrl;
      } catch(err) { console.warn('idb resolve failed',err); }
    }
    mediaHtml=`
      <div class="video-player-wrap">
        <video id="lessonVid" controls playsinline webkit-playsinline x-webkit-airplay="allow"
          preload="metadata"
          style="width:100%;max-height:56vh;display:block"
          oncontextmenu="return false">
          <source src="${resolvedUrl}" type="video/mp4">
          <source src="${resolvedUrl}">
        </video>
      </div>
      <div style="text-align:center;margin-bottom:12px">
        <button onclick="toggleVideoFullscreen()" class="btn btn-sm" style="background:rgba(0,0,0,0.07);color:var(--navy);font-size:0.78rem">⛶ ملء الشاشة (أفقي)</button>
      </div>`;
  }

  // PDF
  let pdfHtml='';
  if(lesson.pdfUrl) {
    let pdfResolved=lesson.pdfUrl;
    if(pdfResolved.startsWith('idb://')) {
      try{ pdfResolved=await GharsFilesDB.resolveUrl(pdfResolved)||pdfResolved; }catch(e){}
    }
    // Store in window for download
    window._currentPdfUrl=pdfResolved;
    window._currentPdfTitle=lesson.title;
    pdfHtml=`
      <div style="border:1px solid var(--gray-mid);border-radius:14px;overflow:hidden;margin-bottom:14px;animation:fadeInUp 0.4s both ease">
        <div style="background:linear-gradient(135deg,var(--navy),var(--navy-light));padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <span style="color:#fff;font-weight:700;font-size:0.9rem">📄 ملف PDF</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="openPdfInTab('${encodeURIComponent(pdfResolved)}')" class="pdf-action-btn pdf-open-btn">🔍 قراءة</button>
            <button onclick="downloadPdf()" class="pdf-action-btn pdf-dl-btn">⬇️ تحميل</button>
          </div>
        </div>
        <div style="background:#f8fafc;padding:8px 16px;font-size:0.78rem;color:var(--gray);text-align:center">اضغط "قراءة" لفتح الملف في المتصفح · "تحميل" لحفظه على جهازك</div>
      </div>`;
  }

  // Linked HW button
  let hwBtnHtml='';
  if(lesson.linkedHw) {
    const hw=await GharsDB.get('homework/'+lesson.linkedHw);
    if(hw&&!hw.expired&&!hw.deleted) {
      hwBtnHtml=`<div style="margin-bottom:14px">
        <button onclick="navigateToLinkedHw('${lesson.linkedHw}')" class="btn btn-primary" style="width:100%;padding:13px;font-size:0.9rem;animation:zoomIn 0.4s both ease">
          📚 حل الواجب المرتبط بهذا الدرس
        </button>
      </div>`;
    }
  }

  // Topic
  const topicHtml=lesson.topic?`
    <div style="background:#f8fafc;border-radius:var(--radius);padding:14px;margin-bottom:14px;border-right:3px solid var(--gold);animation:fadeInUp 0.4s both ease">
      <div style="font-weight:700;margin-bottom:6px;color:var(--navy);font-size:0.9rem">📝 موضوع الدرس</div>
      <div style="font-size:0.88rem;line-height:1.9;white-space:pre-wrap">${e(lesson.topic)}</div>
    </div>`:''  ;

  // Comments section
  const comments=lesson.comments||[];
  const commentsHtml=`
    <div style="border-top:1px solid var(--gray-mid);padding-top:16px;margin-top:6px">
      <div style="font-weight:700;margin-bottom:12px;color:var(--navy)">💬 التعليقات</div>
      <div style="margin-bottom:14px;background:#f8fafc;border-radius:12px;padding:14px">
        <textarea id="commentBox" class="form-textarea" placeholder="شاركنا رأيك في هذا الدرس..." rows="3" style="width:100%;resize:vertical;border:1.5px solid var(--gray-mid);border-radius:8px;padding:10px;font-family:Tajawal,sans-serif;font-size:0.88rem"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-primary btn-sm" onclick="sendLessonComment('${id}')">📤 إرسال</button>
        </div>
      </div>
      <div id="commentsContainer">${renderComments(comments)}</div>
    </div>`;

  document.getElementById('lessonViewContent').innerHTML=`
    <div class="card no-hover">
      <div class="card-header" style="background:linear-gradient(135deg,#1a1060,#2d1b69)">
        <h3 style="color:#fff">🕌 ${e(lesson.title)}</h3>
      </div>
      <div class="card-body">
        ${mediaHtml}${pdfHtml}${hwBtnHtml}${topicHtml}${commentsHtml}
      </div>
    </div>`;
  document.getElementById('lessonViewContent').dataset.lessonId=id;
}

function renderComments(comments) {
  if(!comments.length) return '<p style="color:var(--gray);text-align:center;font-size:0.85rem">لا توجد تعليقات بعد</p>';
  return comments.map((c,i)=>`
    <div class="comment-v2" style="animation-delay:${i*0.05}s">
      <div class="comment-v2-header">
        <div class="comment-v2-avatar">${(c.authorName||'ط').charAt(0)}</div>
        <span class="comment-v2-name">${e(c.authorName||'طالب')}</span>
        <span class="comment-v2-time">${timeAgo(new Date(c.at))}</span>
      </div>
      <div class="comment-v2-text">${e(c.text)}</div>
      <div class="comment-v2-ago">${GharsUtils.toHijriShort(new Date(c.at))} · ${GharsUtils.formatTime(new Date(c.at))}</div>
    </div>`).join('');
}

function openPdfInTab(encodedUrl) {
  const url=decodeURIComponent(encodedUrl);
  window.open(url,'_blank','noopener,noreferrer');
}

function downloadPdf() {
  const url=window._currentPdfUrl, title=window._currentPdfTitle||'ملف';
  if(!url){ UI.toast('الملف غير متاح','error'); return; }
  if(url.startsWith('blob:')) {
    const a=document.createElement('a'); a.href=url; a.download=title+'.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    return;
  }
  fetch(url).then(r=>r.blob()).then(blob=>{
    const burl=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=burl; a.download=title+'.pdf';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(burl),3000);
  }).catch(()=>{ window.open(url,'_blank'); });
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

async function sendLessonComment(lessonId) {
  const text=document.getElementById('commentBox')?.value?.trim();
  if(!text){UI.toast('يرجى كتابة تعليقك','error');return;}
  const user=Auth.currentUser, uid=user.id;
  const lesson=await GharsDB.get('lessons/'+lessonId); if(!lesson) return;
  const comment={studentId:uid,authorName:user.name,text,at:new Date().toISOString()};
  const comments=[...(lesson.comments||[]),comment];
  await GharsDB.set('lessons/'+lessonId,{...lesson,comments});
  // +2 pts if lesson linked to meeting, once only
  if(lesson.linkedMeeting) {
    const pts=await GharsDB.get('points_summary/'+uid)||{id:uid,total:0,breakdown:[]};
    const alreadyCommented=pts.breakdown?.some(b=>b.type==='lesson_comment'&&b.lessonId===lessonId);
    if(!alreadyCommented) {
      const meeting=await GharsDB.get('meetings/'+lesson.linkedMeeting);
      pts.total=(pts.total||0)+2;
      pts.breakdown=[...(pts.breakdown||[]),{type:'lesson_comment',lessonId,meetingId:lesson.linkedMeeting,meetingTitle:meeting?.title||'لقاء',points:2,date:new Date().toISOString()}];
      await GharsDB.set('points_summary/'+uid,pts);
      UI.toast('🎉 حصلت على +2 نقطة على تعليقك!','success',3000);
    }
  }
  const box=document.getElementById('commentBox');if(box)box.value='';
  const cont=document.getElementById('commentsContainer');if(cont)cont.innerHTML=renderComments(comments);
  UI.toast('✅ تم إرسال التعليق','success',2000);
}

// ============================================================
// HOMEWORK
// ============================================================
async function loadStudentHomework() {
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
    const maxPts=(hw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
    return `<div class="hw-card-v2 ${sub?'solved':''}" style="animation-delay:${i*0.06}s">
      <div class="hw-card-v2-header">
        <div class="hw-card-v2-title">📚 ${e(hw.title)}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${sub?'<span class="badge badge-green" style="font-size:0.68rem">✅ تم</span>':''}
          ${!sub&&hw.deadline?`<span class="timer-pill" id="sHwTimer-${hw.id}">⏳</span>`:''}
        </div>
      </div>
      <div class="hw-card-v2-footer">
        ${sub&&!hw.hideGrade?`<span style="font-size:0.82rem;color:var(--green);font-weight:700">درجتك: ${sub.score||0}/${maxPts}</span>`:''}
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
    const maxPts=(hw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
    return `<div class="hw-card-v2 expired" style="animation-delay:${i*0.06}s">
      <div class="hw-card-v2-header">
        <div class="hw-card-v2-title">📚 ${e(hw.title)}</div>
        <span class="badge badge-gray" style="font-size:0.68rem">منتهي</span>
      </div>
      <div class="hw-card-v2-footer">
        ${sub
          ? (!hw.hideGrade
              ? `<span style="font-size:0.82rem;color:var(--green);font-weight:700">درجتك: ${sub.score||0}/${maxPts}</span>
                 <button class="btn btn-outline btn-sm" style="font-size:0.78rem" onclick="viewMyAnswers('${hw.id}')">📋 إجاباتي</button>`
              : '<span style="font-size:0.82rem;color:var(--green);font-weight:700">✅ تم التسليم</span>')
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
  document.getElementById('sHwTab-sent').style.display=tab==='sent'?'block':'none';
  document.getElementById('sHwTab-done').style.display=tab==='done'?'block':'none';
  document.querySelectorAll('#section-homework .tab').forEach(t=>t.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

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
  UI.showModal(`<div class="modal" style="max-width:440px">
    <div class="modal-header" style="background:linear-gradient(135deg,#7b2d00,#c05621)">
      <h3>⚠️ قواعد الاختبار</h3><button class="modal-close">✖</button>
    </div>
    <div class="modal-body">
      <div style="background:#fff5f0;border:1px solid #fed7aa;border-radius:10px;padding:16px">
        <ul style="list-style:none;padding:0;margin:0;font-size:0.88rem;line-height:2.4">
          <li>🚫 يُمنع نسخ محتوى الأسئلة</li>
          <li>🚫 يُمنع تصوير الشاشة</li>
          <li>🚫 يُمنع مغادرة صفحة الاختبار</li>
        </ul>
        <div style="margin-top:12px;padding:10px;background:rgba(229,62,62,0.08);border-radius:8px;font-size:0.83rem;color:var(--red);text-align:center;font-weight:700">⚠️ 3 مخالفات = إلغاء تلقائي</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove();openHwFullscreen('${hwId}')">✅ فهمت، ابدأ</button>
      <button class="btn btn-gray" data-close-modal>إلغاء</button>
    </div>
  </div>`);
}

async function openHwFullscreen(hwId) {
  currentHw=await GharsDB.get('homework/'+hwId); if(!currentHw) return;
  hwAnswers={}; hwWarnings=0; hwStartTime=Date.now();
  const fs=document.getElementById('hwFullscreen');
  fs.style.display='block'; document.body.style.overflow='hidden';
  setEl('hwSolveTitle',currentHw.title);
  updateWarningDots();
  try{if(fs.requestFullscreen)await fs.requestFullscreen().catch(()=>{});else if(fs.webkitRequestFullscreen)fs.webkitRequestFullscreen();}catch(_){}
  const letters='أبجدهوزح';
  document.getElementById('hwSolveBody').innerHTML=(currentHw.questions||[]).map((q,i)=>`
    <div class="card mb-2" style="animation:fadeInUp 0.35s ${i*0.08}s both ease">
      <div class="card-header"><h3 style="font-size:0.88rem">س${i+1}: ${e(q.question)} <span class="badge badge-gold" style="font-size:0.68rem">${q.points||1} درجة</span></h3></div>
      <div class="card-body" id="optContainer-${i}">
        ${(q.options||[]).map((opt,j)=>`
          <div class="option-card" id="opt-${i}-${j}" onclick="selectOption(${i},${j},this)">
            <div class="option-letter">${letters[j]||j+1}</div>
            <span style="font-size:0.88rem">${e(opt)}</span>
          </div>`).join('')}
      </div>
    </div>`).join('');
  if(currentHw.timeLimit&&currentHw.timeLimit>0) {
    let remaining=currentHw.timeLimit*60;
    const timerEl=document.getElementById('hwSolveTimer');
    if(timerEl)timerEl.textContent=GharsUtils.formatSeconds(remaining);
    hwSolveTimer=setInterval(()=>{
      remaining--;
      if(timerEl){timerEl.textContent=GharsUtils.formatSeconds(remaining);if(remaining<=60)timerEl.style.color='var(--red)';}
      if(remaining<=0){clearInterval(hwSolveTimer);forceSubmitHw('انتهى وقت الاختبار');}
    },1000);
  } else { const t=document.getElementById('hwSolveTimer');if(t)t.textContent='∞'; }
  setupAntiCheat();
}

function setEl(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function selectOption(qIdx,optIdx,el) {
  document.getElementById('optContainer-'+qIdx)?.querySelectorAll('.option-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  hwAnswers[qIdx]=currentHw.questions[qIdx].options[optIdx];
}
function updateWarningDots() {
  for(let i=1;i<=3;i++){const d=document.getElementById('wd'+i);if(d)d.classList.toggle('used',i<=hwWarnings);}
}

function setupAntiCheat() {
  removeAntiCheat();
  _cheatListeners={
    copy: (e)=>{ e.preventDefault(); recordCheat('محاولة نسخ السؤال'); },
    vis:  ()=>{ if(document.hidden) recordCheat('مغادرة صفحة الواجب'); },
    blur: ()=>{
      if(document.getElementById('hwFullscreen')?.style.display==='block')
        setTimeout(()=>{ if(!document.hasFocus()) recordCheat('تبديل التبويب'); },300);
    },
    key: (e)=>{
      if(e.key==='PrintScreen'){
        e.preventDefault(); recordCheat('محاولة تصوير الشاشة');
        const fs=document.getElementById('hwFullscreen');
        if(fs){fs.style.filter='blur(20px)';setTimeout(()=>fs.style.filter='',2000);}
      }
      if((e.ctrlKey||e.metaKey)&&['c','p','s','a'].includes(e.key))e.preventDefault();
      if(e.altKey&&e.key==='Tab'){e.preventDefault();recordCheat('مغادرة صفحة الواجب');}
    },
    ctx: (e)=>{ if(currentHw) e.preventDefault(); },
    sel: (e)=>{ if(currentHw) e.preventDefault(); }
  };
  document.addEventListener('copy',_cheatListeners.copy);
  document.addEventListener('visibilitychange',_cheatListeners.vis);
  window.addEventListener('blur',_cheatListeners.blur);
  document.addEventListener('keydown',_cheatListeners.key);
  document.addEventListener('contextmenu',_cheatListeners.ctx);
  document.addEventListener('selectstart',_cheatListeners.sel);
}
function removeAntiCheat() {
  if(!_cheatListeners) return;
  document.removeEventListener('copy',_cheatListeners.copy);
  document.removeEventListener('visibilitychange',_cheatListeners.vis);
  window.removeEventListener('blur',_cheatListeners.blur);
  document.removeEventListener('keydown',_cheatListeners.key);
  document.removeEventListener('contextmenu',_cheatListeners.ctx);
  document.removeEventListener('selectstart',_cheatListeners.sel);
  _cheatListeners=null;
}
async function recordCheat(type) {
  if(!currentHw) return;
  hwWarnings++; updateWarningDots();
  const uid=Auth.currentUser.id;
  const key='cheat_'+currentHw.id+'_'+uid;
  const existing=await GharsDB.get('cheating/'+key)||{warnings:0,log:[],homeworkId:currentHw.id,studentId:uid};
  existing.warnings=hwWarnings;
  existing.log=[...(existing.log||[]),{type,time:new Date().toISOString()}];
  await GharsDB.set('cheating/'+key,existing);
  if(hwWarnings>=HW_MAX_WARNINGS) forceSubmitHw('تجاوزت الحد الأقصى للمخالفات!');
  else UI.toast(`⚠️ إنذار ${hwWarnings}/${HW_MAX_WARNINGS}: ${type}`,'warning',4000);
}

async function submitStudentHomework() {
  if(!currentHw) return;
  const uid=Auth.currentUser.id;
  const duration=Math.floor((Date.now()-hwStartTime)/1000);
  let score=0;
  const answers=[];
  const maxPts=(currentHw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
  (currentHw.questions||[]).forEach((q,i)=>{
    const ans=hwAnswers[i]||null;
    if(ans===q.correctAnswer) score+=(q.points||1);
    answers.push(ans);
  });
  const allCorrect=score===maxPts;
  const sub={id:GharsUtils.uid(),homeworkId:currentHw.id,studentId:uid,answers,score,duration,warnings:hwWarnings,submittedAt:new Date().toISOString()};
  await GharsDB.set('submissions/'+sub.id,sub);
  if(allCorrect&&currentHw.linkedMeeting) {
    const pts=await GharsDB.get('points_summary/'+uid)||{id:uid,total:0,breakdown:[]};
    const already=pts.breakdown?.some(b=>b.type==='task'&&b.homeworkId===currentHw.id);
    if(!already){
      const meeting=await GharsDB.get('meetings/'+currentHw.linkedMeeting);
      pts.total=(pts.total||0)+2;
      pts.breakdown=[...(pts.breakdown||[]),{type:'task',homeworkId:currentHw.id,meetingId:currentHw.linkedMeeting,meetingTitle:meeting?.title||'لقاء',points:2,date:new Date().toISOString()}];
      await GharsDB.set('points_summary/'+uid,pts);
    }
  }
  const savedHw=currentHw;
  closeHwFullscreen();
  const correct=answers.filter((a,i)=>a===savedHw.questions[i]?.correctAnswer).length;
  const wrong=(savedHw.questions||[]).length-correct;
  UI.showModal(`<div class="modal" style="max-width:400px">
    <div class="modal-header" style="background:linear-gradient(135deg,var(--green),#276749)">
      <h3>🎉 تم تسليم الواجب بنجاح!</h3>
      <button class="modal-close" onclick="this.closest('.modal-overlay').remove();navigate('homework')">✖</button>
    </div>
    <div class="modal-body" style="text-align:center;padding:24px">
      <div style="font-size:2.5rem;margin-bottom:10px;animation:zoomIn 0.5s both ease">${allCorrect?'⭐':'✅'}</div>
      <div style="font-weight:700;font-size:0.95rem;margin-bottom:16px">تم إرسال إجاباتك بنجاح</div>
      ${!savedHw.hideGrade?`<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <div style="text-align:center;background:#f8fafc;border-radius:10px;padding:12px 18px;animation:fadeInUp 0.4s 0.1s both ease">
          <div style="font-size:1.5rem;font-weight:900;color:var(--gold)">${score}/${maxPts}</div>
          <div style="font-size:0.72rem;color:var(--gray)">درجتك</div>
        </div>
        <div style="text-align:center;background:var(--green-light);border-radius:10px;padding:12px 18px;animation:fadeInUp 0.4s 0.2s both ease">
          <div style="font-size:1.5rem;font-weight:900;color:var(--green)">${correct}</div>
          <div style="font-size:0.72rem;color:var(--gray)">صحيح</div>
        </div>
        <div style="text-align:center;background:var(--red-light);border-radius:10px;padding:12px 18px;animation:fadeInUp 0.4s 0.3s both ease">
          <div style="font-size:1.5rem;font-weight:900;color:var(--red)">${wrong}</div>
          <div style="font-size:0.72rem;color:var(--gray)">خاطئ</div>
        </div>
      </div>`:''}
      ${allCorrect&&savedHw.linkedMeeting?'<div style="margin-top:12px;color:var(--gold);font-weight:700;font-size:0.88rem;animation:zoomIn 0.5s 0.4s both ease">🎊 حصلت على +2 نقطة!</div>':''}
    </div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove();navigate('homework')">تم ✓</button></div>
  </div>`);
}

function forceSubmitHw(reason) {
  if(hwSolveTimer)clearInterval(hwSolveTimer);
  UI.showModal(`<div class="modal" style="max-width:400px">
    <div class="modal-header" style="background:linear-gradient(135deg,#742a2a,#c53030)"><h3>⏹ ${e(reason)}</h3></div>
    <div class="modal-body" style="text-align:center;padding:20px"><p>سيتم احتساب إجاباتك الحالية</p></div>
    <div class="modal-footer"><button class="btn btn-danger" onclick="this.closest('.modal-overlay').remove();submitStudentHomework()">إرسال ←</button></div>
  </div>`,{noOverlayClose:true});
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
// VIEW MY ANSWERS
// ============================================================
async function viewMyAnswers(hwId) {
  const uid=Auth.currentUser.id;
  const [hw,subs]=await Promise.all([GharsDB.get('homework/'+hwId),GharsDB.getAll('submissions')]);
  const sub=Object.values(subs).find(s=>s.homeworkId===hwId&&s.studentId===uid);
  if(!sub||!hw) return;
  if(hw.hideGrade){UI.toast('الدرجات والإجابات مخفية من المعلم','warning');return;}
  const maxPts=(hw.questions||[]).reduce((a,q)=>a+(q.points||1),0);
  const correct=sub.answers?.filter((a,i)=>a===hw.questions[i]?.correctAnswer).length||0;
  navigate('my-answers');
  const cont=document.getElementById('myAnswersContent'); if(!cont) return;
  cont.innerHTML=`<div class="card no-hover">
    <div class="card-header"><h3>📋 إجاباتي — ${e(hw.title)}</h3></div>
    <div class="card-body">
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-bottom:16px">
        <div style="text-align:center;background:#f8fafc;border-radius:10px;padding:12px 16px;animation:zoomIn 0.4s both ease">
          <div style="font-size:1.5rem;font-weight:900;color:var(--gold)">${sub.score||0}/${maxPts}</div>
          <div style="font-size:0.72rem;color:var(--gray)">درجتي</div>
        </div>
        <div style="text-align:center;background:var(--green-light);border-radius:10px;padding:12px 16px;animation:zoomIn 0.4s 0.1s both ease">
          <div style="font-size:1.5rem;font-weight:900;color:var(--green)">${correct}</div>
          <div style="font-size:0.72rem;color:var(--gray)">صحيح</div>
        </div>
        <div style="text-align:center;background:var(--red-light);border-radius:10px;padding:12px 16px;animation:zoomIn 0.4s 0.2s both ease">
          <div style="font-size:1.5rem;font-weight:900;color:var(--red)">${(hw.questions||[]).length-correct}</div>
          <div style="font-size:0.72rem;color:var(--gray)">خاطئ</div>
        </div>
      </div>
      ${(hw.questions||[]).map((q,i)=>{
        const ans=sub.answers?.[i]??null; const ok=ans===q.correctAnswer;
        return `<div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:8px;border-right:3px solid ${ok?'var(--green)':'var(--red)'};animation:fadeInUp 0.3s ${i*0.05}s both ease">
          <div style="font-weight:700;font-size:0.85rem;margin-bottom:5px">س${i+1}: ${e(q.question)}</div>
          <div style="font-size:0.8rem">إجابتي: <strong>${e(ans||'لم أجب')}</strong> ${ok?'✅':'❌'}</div>
          ${!ok?`<div style="font-size:0.8rem;color:var(--green);margin-top:3px">الصحيحة: <strong>${e(q.correctAnswer)}</strong></div>`:''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
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