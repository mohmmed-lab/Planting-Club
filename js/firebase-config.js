// ============================================================
// GHARS CLUB — Core System v5 — Full Fix
// ============================================================

// ============================================================
// 0. IndexedDB — ملفات كبيرة (فيديو + PDF)
// ============================================================
var GharsFilesDB = (function(){
  var DB='GharsFiles', VER=2, STORE='files';
  var _db=null;
  function open(){
    return new Promise(function(res,rej){
      if(_db){res(_db);return;}
      var r=indexedDB.open(DB,VER);
      r.onupgradeneeded=function(e){e.target.result.createObjectStore(STORE,{keyPath:'key'});};
      r.onsuccess=function(e){_db=e.target.result;res(_db);};
      r.onerror=function(e){rej(e);};
    });
  }
  return {
    save:async function(key,blob){
      var db=await open();
      return new Promise(function(res,rej){
        var tx=db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put({key:key,blob:blob,ts:Date.now()});
        tx.oncomplete=function(){res('idb://'+key);};
        tx.onerror=function(e){rej(e);};
      });
    },
    load:async function(key){
      var db=await open();
      return new Promise(function(res){
        var r=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
        r.onsuccess=function(e){var d=e.target.result;res(d?d.blob:null);};
        r.onerror=function(){res(null);};
      });
    },
    // حل idb:// → blob URL
    resolve:async function(url){
      if(!url)return null;
      if(!url.startsWith('idb://'))return url;
      var key=url.slice(6);
      var blob=await this.load(key);
      if(!blob)return null;
      return URL.createObjectURL(blob);
    }
  };
})();

// ============================================================
// 1. الحسابات الثابتة
// ============================================================
var SYSTEM_ACCOUNTS=[
  {id:'sys_mustafa', name:'مصطفى قدسي', username:'mustafa2026', password:'Ghars@Mustafa1', role:'admin'},
  {id:'sys_zakaria', name:'زكريا حسين',  username:'zakaria2026', password:'Ghars@Zakaria2', role:'teacher'},
  {id:'sys_mohammed',name:'محمد قارئ',   username:'mohammed2026',password:'Ghars@Mohammed3',role:'teacher'}
];
(function seed(){
  SYSTEM_ACCOUNTS.forEach(function(a){
    if(!localStorage.getItem('ghars__users__'+a.id))localStorage.setItem('ghars__users__'+a.id,JSON.stringify(a));
  });
  if(!localStorage.getItem('ghars__system__settings'))
    localStorage.setItem('ghars__system__settings',JSON.stringify({clubName:'نادي غرس',targetMemorization:30}));
})();

// ============================================================
// 2. Firebase — اختياري
// ============================================================
var _fbDB=null,_fbST=null,_fbReady=false;
(function initFB(){
  var cfg={apiKey:'AIzaSyD_YOUR_API_KEY_HERE',authDomain:'ghars-club.firebaseapp.com',
    projectId:'ghars-club',storageBucket:'ghars-club.appspot.com',
    messagingSenderId:'YOUR_SENDER_ID',appId:'YOUR_APP_ID'};
  if(cfg.apiKey.includes('YOUR_API_KEY'))return;
  try{
    if(!firebase.apps.length)firebase.initializeApp(cfg);
    _fbDB=firebase.firestore();_fbST=firebase.storage();
    _fbDB.collection('_ping').doc('t').get().then(function(){_fbReady=true;}).catch(function(){_fbDB=null;_fbST=null;});
  }catch(e){}
})();

// ============================================================
// 3. GharsDB
// ============================================================
var GharsDB={
  _k:function(p){
    var parts=p.split('/');
    return parts.length===1?'ghars__'+parts[0]+'__*':'ghars__'+parts[0]+'__'+parts.slice(1).join('_');
  },
  get:async function(path){
    try{var r=localStorage.getItem(this._k(path));return r?JSON.parse(r):null;}catch(e){return null;}
  },
  set:async function(path,data){
    try{localStorage.setItem(this._k(path),JSON.stringify(data));}catch(e){}
    if(_fbReady&&_fbDB){try{var pts=path.split('/');if(pts[1])_fbDB.collection(pts[0]).doc(pts.slice(1).join('/')).set(data,{merge:true}).catch(function(){});}catch(e){}}
    return data;
  },
  delete:async function(path){try{localStorage.removeItem(this._k(path));}catch(e){}},
  getAll:async function(col){
    var pre='ghars__'+col+'__',out={};
    for(var i=0;i<localStorage.length;i++){
      var lk=localStorage.key(i);
      if(lk&&lk.startsWith(pre)){try{var item=JSON.parse(localStorage.getItem(lk));if(item&&item.id)out[item.id]=item;}catch(e){}}
    }
    return out;
  },
  listen:function(col,cb){
    setInterval(cb,5000);
    if(_fbReady&&_fbDB){try{_fbDB.collection(col).onSnapshot(function(snap){snap.docs.forEach(function(d){var data=d.data();if(data&&data.id)localStorage.setItem('ghars__'+col+'__'+data.id,JSON.stringify(data));});cb();},function(){});}catch(e){}}
  },
  // رفع ملف — بدون حد للحجم، يُخزَّن في IndexedDB
  uploadFile:async function(path,file,onProgress){
    if(onProgress)onProgress(5);
    // Firebase إن كان متاحاً
    if(_fbReady&&_fbST){
      var ref=_fbST.ref(path);var task=ref.put(file);
      return new Promise(function(res,rej){
        task.on('state_changed',
          function(s){if(onProgress)onProgress(s.bytesTransferred/s.totalBytes*100);},
          function(){GharsFilesDB.save(path,file).then(function(u){if(onProgress)onProgress(100);res(u);}).catch(rej);},
          function(){task.snapshot.ref.getDownloadURL().then(function(u){if(onProgress)onProgress(100);res(u);});}
        );
      });
    }
    // IndexedDB مباشرة — محاكاة تقدم الرفع
    if(onProgress){
      var steps=[10,25,45,65,80,90,98];
      for(var s=0;s<steps.length;s++){await new Promise(function(r){setTimeout(r,80)});onProgress(steps[s]);}
    }
    var u=await GharsFilesDB.save(path,file);
    if(onProgress)onProgress(100);
    return u;
  }
};

// ============================================================
// 4. Auth
// ============================================================
var Auth={
  currentUser:null,
  init:function(){try{var r=localStorage.getItem('ghars__session');if(r)this.currentUser=JSON.parse(r);}catch(e){this.currentUser=null;}},
  login:function(username,password){
    var u=(username||'').trim(),p=(password||'').trim();
    if(!u||!p)return{ok:false,msg:'يرجى إدخال اسم المستخدم وكلمة المرور'};
    // حسابات ثابتة
    for(var i=0;i<SYSTEM_ACCOUNTS.length;i++){
      var acc=SYSTEM_ACCOUNTS[i];
      if(acc.username===u&&acc.password===p){
        var st=null;try{st=JSON.parse(localStorage.getItem('ghars__users__'+acc.id));}catch(e){}
        if(st&&st.deleted)return{ok:false,msg:'هذا الحساب محظور من الدخول'};
        this._save(acc);return{ok:true,user:acc};
      }
    }
    // حسابات ديناميكية
    for(var j=0;j<localStorage.length;j++){
      var lk=localStorage.key(j);
      if(!lk||!lk.startsWith('ghars__users__'))continue;
      try{
        var usr=JSON.parse(localStorage.getItem(lk));
        if(usr&&usr.username===u&&usr.password===p){
          if(usr.deleted)return{ok:false,msg:'هذا الحساب محظور من الدخول'};
          this._save(usr);return{ok:true,user:usr};
        }
      }catch(e){}
    }
    return{ok:false,msg:'اسم المستخدم أو كلمة المرور غير صحيحة'};
  },
  _save:function(user){
    var now=new Date();
    var updated=Object.assign({},user,{lastSeen:now.toISOString(),lastSeenDay:GharsUtils.arabicDay(now),lastSeenHijri:GharsUtils.hijriShort(now)});
    this.currentUser=updated;
    localStorage.setItem('ghars__session',JSON.stringify(updated));
    localStorage.setItem('ghars__users__'+user.id,JSON.stringify(updated));
  },
  logout:function(){this.currentUser=null;localStorage.removeItem('ghars__session');window.location.href='index.html';},
  requireAuth:function(role){
    this.init();
    if(!this.currentUser){window.location.href='index.html';return false;}
    if(role==='teacher'&&this.currentUser.role==='student'){window.location.href='student.html';return false;}
    if(role==='student'&&(this.currentUser.role==='teacher'||this.currentUser.role==='admin')){window.location.href='teacher.html';return false;}
    var stored=null;try{stored=JSON.parse(localStorage.getItem('ghars__users__'+this.currentUser.id));}catch(e){}
    if(stored&&stored.deleted){this.logout();return false;}
    return true;
  }
};

// ============================================================
// 5. GharsUtils
// ============================================================
var GharsUtils={
  hijriShort:function(d){try{return(d||new Date()).toLocaleDateString('ar-SA-u-ca-islamic',{day:'numeric',month:'numeric',year:'numeric'});}catch(e){return(d||new Date()).toLocaleDateString('ar');}},
  hijriFull:function(d){try{return(d||new Date()).toLocaleDateString('ar-SA-u-ca-islamic',{day:'numeric',month:'long',year:'numeric'});}catch(e){return(d||new Date()).toLocaleDateString('ar');}},
  toHijriShort:function(d){return this.hijriShort(d);},
  toHijri:function(d){return this.hijriFull(d);},
  arabicDay:function(d){return['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][(d||new Date()).getDay()];},
  getArabicDay:function(d){return this.arabicDay(d);},
  formatTime:function(d){try{return(d||new Date()).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});}catch(e){return'';}},
  formatSeconds:function(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},
  // وقت مضى منذ الآن
  timeAgo:function(dateStr){
    var diff=Date.now()-new Date(dateStr).getTime();
    var m=Math.floor(diff/60000),h=Math.floor(diff/3600000),day=Math.floor(diff/86400000);
    if(m<1)return'الآن';if(m<60)return'منذ '+m+' د';if(h<24)return'منذ '+h+' س';
    if(day<7)return'منذ '+day+' يوم';return this.hijriShort(new Date(dateStr));
  },
  uid:function(){return Date.now().toString(36)+Math.random().toString(36).substr(2,9);},
  esc:function(str){return String(str==null?'':str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},
  generateUsername:function(name){var b=(name||'s').trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9]/gi,'')||'student';return b.substring(0,8)+Math.floor(1000+Math.random()*9000);},
  generatePassword:function(){var c='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';return Array.from({length:10},function(){return c[Math.floor(Math.random()*c.length)];}).join('');},
  countdown:function(targetDate,cb){
    function tick(){var diff=new Date(targetDate).getTime()-Date.now();if(diff<=0){cb({done:true,days:0,hours:0,minutes:0,seconds:0});return;}cb({done:false,days:Math.floor(diff/86400000),hours:Math.floor((diff%86400000)/3600000),minutes:Math.floor((diff%3600000)/60000),seconds:Math.floor((diff%60000)/1000)});}
    tick();return setInterval(tick,1000);
  }
};

// ============================================================
// 6. UI
// ============================================================
var UI={
  toast:function(msg,type,dur){
    type=type||'info';dur=dur||3500;
    var c=document.getElementById('toastContainer');
    if(!c){c=document.createElement('div');c.id='toastContainer';c.className='toast-container';document.body.appendChild(c);}
    var icons={success:'✅',error:'❌',warning:'⚠️',info:'🔔'};
    var t=document.createElement('div');t.className='toast '+type;
    t.innerHTML='<span class="toast-icon">'+(icons[type]||'🔔')+'</span><span>'+GharsUtils.esc(msg)+'</span>';
    c.appendChild(t);
    requestAnimationFrame(function(){t.classList.add('show');});
    setTimeout(function(){t.classList.remove('show');t.classList.add('hide');setTimeout(function(){t.remove();},350);},dur);
  },
  showModal:function(html,opts){
    opts=opts||{};
    var ov=document.createElement('div');ov.className='modal-overlay';ov.innerHTML=html;
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ov.classList.add('show');var m=ov.querySelector('.modal');if(m)m.classList.add('show');});
    if(!opts.noOverlayClose)ov.addEventListener('click',function(e){if(e.target===ov){ov.classList.remove('show');setTimeout(function(){ov.remove();},200);}});
    ov.querySelectorAll('[data-close-modal],.modal-close').forEach(function(b){b.addEventListener('click',function(){ov.classList.remove('show');setTimeout(function(){ov.remove();},200);});});
    return ov;
  },
  confirm:function(msg,title){
    title=title||'تأكيد';
    return new Promise(function(resolve){
      var ov=UI.showModal('<div class="modal" style="max-width:380px"><div class="modal-header"><h3>⚠️ '+GharsUtils.esc(title)+'</h3><button class="modal-close">✖</button></div><div class="modal-body" style="text-align:center;padding:24px"><div style="font-size:2.5rem;margin-bottom:12px">🗑️</div><p style="font-size:0.92rem;font-weight:600">'+GharsUtils.esc(msg)+'</p></div><div class="modal-footer" style="justify-content:center;gap:12px"><button class="btn btn-danger" id="_cfmYes">✔ تأكيد</button><button class="btn btn-gray" data-close-modal>✖ إلغاء</button></div></div>',{noOverlayClose:true});
      ov.querySelector('#_cfmYes').onclick=function(){ov.remove();resolve(true);};
      ov.querySelectorAll('[data-close-modal],.modal-close').forEach(function(b){b.addEventListener('click',function(){resolve(false);});});
    });
  },
  setLoading:function(el,show,text){if(!el)return;if(show){el.disabled=true;el._orig=el.innerHTML;el.innerHTML='<span class="loader loader-sm"></span>'+(text?' '+text:'');}else{el.disabled=false;if(el._orig)el.innerHTML=el._orig;}},
  copyText:async function(text){
    try{await navigator.clipboard.writeText(text);this.toast('تم النسخ بنجاح!','success',2000);return true;}
    catch(e){var ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');this.toast('تم النسخ!','success',2000);return true;}catch(e2){this.toast('فشل النسخ','error');return false;}finally{ta.remove();}}
  }
};

// حماية تصوير الشاشة
(function(){
  if(navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia){
    navigator.mediaDevices.getDisplayMedia=function(){UI.toast('⛔ تصوير الشاشة محظور','error',3000);return Promise.reject(new Error('blocked'));};
  }
})();

Auth.init();