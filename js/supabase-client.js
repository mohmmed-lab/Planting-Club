// ============================================================
// GHARS CLUB — Database Client v6 (Ultimate Strict Mode)
// ✅ إصلاح قاطع لثغرة الدخول المتبقي: التوقف الإجباري عن استخدام التخزين المحلي كبديل لحالات الفشل أو الحذف
// ============================================================

var SUPABASE_URL = 'https://qbwwaebbnqkjtsxdpuyt.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFid3dhZWJibnFranRzeGRwdXl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMjc3MDAsImV4cCI6MjA4OTcwMzcwMH0.t6IQUEPro41sMLYsdP_GxAbrtF0zPolcGmW9Nojijtk';

var _sbReadyResolve = null;
var _sbReadyPromise = new Promise(function (res) { _sbReadyResolve = res; });
setTimeout(function () { if (_sbReadyResolve) { _sbReadyResolve(); } }, 4000);

var _sb   = null;
var _sbOK = false;
var _writeQueue = [];

// ─── تهيئة Supabase ─────────────────────────────────────
(function _initSB() {
  var urlOK = SUPABASE_URL && SUPABASE_URL.startsWith('https://') && SUPABASE_URL.includes('supabase');
  var keyOK = SUPABASE_KEY && SUPABASE_KEY.length > 30;

  if (!urlOK || !keyOK) {
    console.warn('⚠️ Supabase: قيم غير صحيحة — يعمل بالتخزين المحلي فقط');
    return;
  }
  if (typeof window.supabase === 'undefined') {
    console.error('❌ مكتبة Supabase غير محمّلة');
    return;
  }
  try {
    _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth:     { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } }
    });
    _sb.from('ghars_data')
      .select('collection', { count:'exact', head:true })
      .then(function(r) {
        if (r.error) {
          setTimeout(function() {
            if (!_sbOK && _sb) {
              _sb.from('ghars_data').select('collection',{count:'exact',head:true})
                .then(function(r2){
                  if(!r2.error){
                    _sbOK=true;
                    if(_sbReadyResolve){_sbReadyResolve();_sbReadyResolve=null;}
                    _seedSystemAccounts(); _flushQueue();
                    try{window.dispatchEvent(new CustomEvent('ghars:connected'));}catch(_){}
                  }
                });
            }
          }, 5000);
        } else {
          _sbOK = true;
          if (_sbReadyResolve) { _sbReadyResolve(); _sbReadyResolve = null; }
          _syncDeletedListFromSupabase().then(function() {
            _seedSystemAccounts();
            _flushQueue();
          });
          _startGlobalRealtime();
          _startForceLogoutListener();
          try { window.dispatchEvent(new CustomEvent('ghars:connected')); } catch (_) {}
        }
      });
  } catch(e){ console.error('Supabase init error:', e); }
})();

window.addEventListener('online', function() {
  if (!_sbOK && _sb) {
    setTimeout(function(){
      _sb.from('ghars_data').select('collection',{count:'exact',head:true})
        .then(function(r){ if(!r.error){ _sbOK=true; _flushQueue(); _seedSystemAccounts(); _startGlobalRealtime(); _startForceLogoutListener(); } });
    }, 1000);
  } else { _flushQueue(); }
});
window.addEventListener('offline', function(){ _sbOK=false; });

var _forceLogoutChannel = null;
function _startForceLogoutListener() {
  if(!_sbOK||!_sb) return;
  if(_forceLogoutChannel){ try{_sb.removeChannel(_forceLogoutChannel);}catch(_){} }
  try{
    _forceLogoutChannel = _sb.channel('ghars-force-logout')
      .on('postgres_changes',{
        event:'*', schema:'public', table:'ghars_data', filter:'collection=eq.force_logout'
      }, function(payload){
        var row = payload.new || payload.old;
        if(!row||!row.data) return;
        var kickedId = row.data.id || row.doc_id;
        if(!kickedId) return;
        if(typeof _addToDeletedList==='function') _addToDeletedList(kickedId);
        if(typeof Auth!=='undefined'&&Auth.currentUser&&Auth.currentUser.id===kickedId){
          // مسح شامل فوري
          if(typeof _addToDeletedList==='function') _addToDeletedList(kickedId);
          try{localStorage.removeItem('ghars__saved_creds');}catch(_){}
          try{localStorage.removeItem('ghars__session');}catch(_){}
          Auth.currentUser=null;
          // إزالة app-loading إذا كانت موجودة (لعرض رسالة الطرد)
          try{ document.body.classList.remove('app-loading'); }catch(_){}
          try{
            var _msg=document.createElement('div');
            _msg.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(10,22,40,0.97);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;font-family:Tajawal,sans-serif;direction:rtl';
            _msg.innerHTML='<div style="font-size:3rem">⛔</div><div style="color:#fff;font-size:1.2rem;font-weight:900;text-align:center">تم حذف هذا الحساب<br>ولا يمكن الدخول مجدداً</div>';
            document.body.appendChild(_msg);
          }catch(_){}
          setTimeout(function(){window.location.href='index.html';},2000);
        }
      }).subscribe();
  }catch(e){}
}

var _globalRealtimeChannel = null;
function _startGlobalRealtime() {
  if(!_sbOK||!_sb) return;
  if(_globalRealtimeChannel) { try{_sb.removeChannel(_globalRealtimeChannel);}catch(_){} }
  try {
    _globalRealtimeChannel = _sb.channel('ghars-global-changes')
      .on('postgres_changes', { event:'*', schema:'public', table:'ghars_data' }, function(payload) {
        var row = payload.new || payload.old;
        if(!row) return;
        var col = row.collection;
        var d   = row.data;
        if(col && GharsDB._memCache) {
          delete GharsDB._memCache[col]; delete GharsDB._cacheTime[col];
        }
        if(d && d.id && col) {
          if(col==='users' && (d.deleted||d.purged||d.password==='__REVOKED__'||d.qrInvalidated)){
            if(typeof _addToDeletedList==='function') _addToDeletedList(d.id);
            try{localStorage.removeItem('ghars__users__'+d.id);}catch(_){}
            if(typeof GharsDataDB!=='undefined') GharsDataDB.del('ghars__users__'+d.id).catch(function(){});
            if(typeof Auth!=='undefined'&&Auth.currentUser&&Auth.currentUser.id===d.id){ Auth.logout(); }
          } else {
            try{localStorage.setItem('ghars__'+col+'__'+d.id, JSON.stringify(d));}catch(_){}
          }
        }
        try { window.dispatchEvent(new CustomEvent('ghars:datachange', { detail: { collection: col, data: d, event: payload.eventType } })); } catch(_) {}
      }).subscribe();
  } catch(e) {}
}

async function _flushQueue() {
  if (!_sbOK||!_sb||!_writeQueue.length) return;
  var q=_writeQueue.splice(0);
  for (var w of q) {
    if (w.col === 'users' && typeof _isDeleted === 'function' && _isDeleted(w.doc)) continue;
    try {
      await _sb.from('ghars_data').upsert({ collection:w.col, doc_id:w.doc, data:w.data, updated_at: new Date().toISOString() },{ onConflict:'collection,doc_id' });
    } catch(e){ _writeQueue.push(w); }
  }
}
setInterval(_flushQueue, 8000);

var _deletedAccountIds = (function() {
  try { return JSON.parse(localStorage.getItem('ghars__deleted_ids')||'[]'); } catch(_) { return []; }
})();

function _addToDeletedList(id) {
  if (!id) return;
  // مسح أي saved_creds مرتبطة بهذا ID (حماية من الجهاز القديم)
  try {
    var _sc = JSON.parse(localStorage.getItem('ghars__saved_creds') || 'null');
    if (_sc && _sc.id === id) localStorage.removeItem('ghars__saved_creds');
  } catch(_) {}
  if (!_deletedAccountIds.includes(id)) {
    _deletedAccountIds.push(id);
    try { localStorage.setItem('ghars__deleted_ids', JSON.stringify(_deletedAccountIds)); } catch(_) {}
  }
  if (typeof GharsDB !== 'undefined' && GharsDB._memCache) {
    delete GharsDB._memCache['users']; delete GharsDB._cacheTime['users'];
  }
  var keysToWipe = [];
  for(var i=0; i<localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && (k.includes('__users__'+id) || k.endsWith('_'+id))) { keysToWipe.push(k); }
  }
  keysToWipe.forEach(function(k) {
      try { localStorage.removeItem(k); } catch(_){}
      if (typeof GharsDataDB !== 'undefined') GharsDataDB.del(k).catch(function(){});
  });

  try {
    var _sess = localStorage.getItem('ghars__session');
    if (_sess) {
      var _sessObj = JSON.parse(_sess);
      if (_sessObj && _sessObj.id === id) { localStorage.removeItem('ghars__session'); }
    }
  } catch(_) {}
  
  try {
    var _creds = localStorage.getItem('ghars__saved_creds');
    if (_creds) {
      var _credsObj = JSON.parse(_creds);
      if (_credsObj && (_credsObj.id === id || !_credsObj.id)) { localStorage.removeItem('ghars__saved_creds'); }
    }
  } catch(_) {}
  
  _publishDeletedToSupabase(id);
}

function _isDeleted(id) { return _deletedAccountIds.includes(id); }

function _publishDeletedToSupabase(id) {
  if (!_sbOK || !_sb || !id) return;
  _sb.from('ghars_data').upsert({
    collection: 'deleted_accounts', doc_id: id,
    data: { id: id, deletedAt: new Date().toISOString() },
    updated_at: new Date().toISOString()
  }, { onConflict: 'collection,doc_id' }).catch(function(){});
}

async function _syncDeletedListFromSupabase() {
  if (!_sbOK || !_sb) return;
  try {
    var r = await _sb.from('ghars_data').select('doc_id,data').eq('collection','deleted_accounts');
    if (!r.error && r.data && r.data.length > 0) {
      r.data.forEach(function(row) {
        var deletedId = row.doc_id || (row.data && row.data.id);
        if (deletedId && !_deletedAccountIds.includes(deletedId)) { _deletedAccountIds.push(deletedId); }
      });
      try { localStorage.setItem('ghars__deleted_ids', JSON.stringify(_deletedAccountIds)); } catch(_) {}
      // ══ مسح شامل لبيانات كل محذوف من هذا الجهاز ══
      _deletedAccountIds.forEach(function(did) {
        // _addToDeletedList تمسح كل مفاتيح localStorage المرتبطة بالـ ID
        if (typeof _addToDeletedList === 'function') _addToDeletedList(did);
      });
      // طرد الجلسة الحالية إذا كان صاحبها محذوفاً
      if (typeof Auth !== 'undefined' && Auth.currentUser && _deletedAccountIds.includes(Auth.currentUser.id)) {
        Auth.logout();
      }
    }
  } catch(e) {}
}

async function _seedSystemAccounts() {
  if (!_sbOK||!_sb) return;
  var sysAccounts=typeof SYSTEM_ACCOUNTS!=='undefined'?SYSTEM_ACCOUNTS:[];
  for (var acc of sysAccounts) {
    if (_isDeleted(acc.id)) continue;
    try {
      // CRITICAL: فحص deleted_accounts أولاً — لمنع إعادة زرع المحذوفين نهائياً
      var delCheck = await _sb.from('ghars_data').select('doc_id')
        .eq('collection','deleted_accounts').eq('doc_id',acc.id).maybeSingle();
      if (delCheck.data) { _addToDeletedList(acc.id); continue; }

      var r=await _sb.from('ghars_data').select('doc_id,data').eq('collection','users').eq('doc_id',acc.id).maybeSingle();
      if (r.data && r.data.data && (r.data.data.deleted || r.data.data.purged || r.data.data.password === '__REVOKED__')) {
        _addToDeletedList(acc.id); continue;
      }
      if (!r.data) {
        await _sb.from('ghars_data').upsert({ collection:'users', doc_id:acc.id, data:acc, updated_at:new Date().toISOString() },{ onConflict:'collection,doc_id' });
      }
    } catch(e){}
  }
  try {
    var rs=await _sb.from('ghars_data').select('doc_id').eq('collection','system').eq('doc_id','settings').maybeSingle();
    if (!rs.data) { await _sb.from('ghars_data').upsert({ collection:'system', doc_id:'settings', data:{ clubName:'نادي غرس', targetMemorization:30 }, updated_at:new Date().toISOString() },{ onConflict:'collection,doc_id' }); }
  } catch(e){}
}

var GharsFilesDB=(function(){
  var DB='GharsFiles',VER=2,STORE='files',_idb=null;
  function open(){
    return new Promise(function(res,rej){
      if(_idb){res(_idb);return;}
      var r=indexedDB.open(DB,VER);
      r.onupgradeneeded=function(e){e.target.result.createObjectStore(STORE,{keyPath:'key'});};
      r.onsuccess=function(e){_idb=e.target.result;res(_idb);};
      r.onerror=function(e){rej(e);};
    });
  }
  return {
    save:async function(key,blob){
      var db=await open();
      return new Promise(function(res,rej){
        var tx=db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put({key,blob,ts:Date.now()});
        tx.oncomplete=function(){res('idb://'+key);};
        tx.onerror=function(e){rej(e);};
      });
    },
    load:async function(key){
      var db=await open();
      return new Promise(function(res){
        var r=db.transaction(STORE,'readonly').objectStore(STORE).get(key);
        r.onsuccess=function(e){res(e.target.result?e.target.result.blob:null);};
        r.onerror=function(){res(null);};
      });
    },
    resolve:async function(url){
      if(!url)return null;
      if(!url.startsWith('idb://'))return url;
      var blob=await GharsFilesDB.load(url.slice(6));
      return blob?URL.createObjectURL(blob):null;
    }
  };
})();

var GharsDataDB = (function () {
  var DB = 'GharsTextData', VER = 1, STORE = 'records', _db = null;
  function open() {
    return new Promise(function (res, rej) {
      if (_db) { res(_db); return; }
      var r = indexedDB.open(DB, VER);
      r.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var s = db.createObjectStore(STORE, { keyPath: 'k' });
          s.createIndex('col', 'col', { unique: false });
        }
      };
      r.onsuccess = function (e) { _db = e.target.result; res(_db); };
      r.onerror   = function (e) { rej(e); };
    });
  }
  return {
    get: async function (k) {
      try { var db = await open(); return new Promise(function (res) { var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(k); r.onsuccess = function (e) { res(e.target.result ? e.target.result.v : null); }; r.onerror = function () { res(null); }; }); } catch (e) { return null; }
    },
    set: async function (k, v, col) {
      try { var db = await open(); return new Promise(function (res, rej) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put({ k: k, v: v, col: col || k.split('__')[1] || '', ts: Date.now() }); tx.oncomplete = function () { res(true); }; tx.onerror = function (e) { rej(e); }; }); } catch (e) { return false; }
    },
    del: async function (k) {
      try { var db = await open(); return new Promise(function (res) { var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(k); tx.oncomplete = function () { res(true); }; tx.onerror = function () { res(false); }; }); } catch (e) { return false; }
    },
    byCol: async function (col) {
      try { var db = await open(); return new Promise(function (res) { var out = []; var req = db.transaction(STORE, 'readonly').objectStore(STORE).index('col').openCursor(IDBKeyRange.only(col)); req.onsuccess = function (e) { var c = e.target.result; if (c) { out.push({ k: c.value.k, v: c.value.v }); c.continue(); } else { res(out); } }; req.onerror = function () { res([]); }; }); } catch (e) { return []; }
    }
  };
})();

(async function _migrateLS2IDB() {
  if (localStorage.getItem('ghars__idb_v1')) return;
  var skip = ['ghars__session', 'ghars__saved_creds', 'ghars__deleted_ids', 'ghars__idb_v1'];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || !k.startsWith('ghars__') || skip.some(function (s) { return k.startsWith(s); })) continue;
      try { var raw = localStorage.getItem(k); if (!raw) continue; var val = JSON.parse(raw); var col = k.split('__')[1] || ''; await GharsDataDB.set(k, val, col); } catch (_) {}
    }
    localStorage.setItem('ghars__idb_v1', '1');
  } catch (e) {}
})();

var SYSTEM_ACCOUNTS=[
  {id:'sys_mustafa', name:'مصطفى قدسي', username:'mustafa2026', password:'Ghars@Mustafa1', role:'admin'},
  {id:'sys_zakaria', name:'زكريا حسين', username:'zakaria2026', password:'Ghars@Zakaria2', role:'teacher'},
  {id:'sys_mohammed',name:'محمد قارئ',  username:'mohammed2026',password:'Ghars@Mohammed3',role:'teacher'}
];

(function _localSeed(){
  var deletedIds = [];
  try { deletedIds = JSON.parse(localStorage.getItem('ghars__deleted_ids')||'[]'); } catch(_){}
  SYSTEM_ACCOUNTS.forEach(function(a){
    if(deletedIds.includes(a.id)) return;
    var existing = null;
    try { existing = JSON.parse(localStorage.getItem('ghars__users__'+a.id)); } catch(_){}
    if (existing && (existing.deleted || existing.purged)) {
      if(!deletedIds.includes(a.id)){ deletedIds.push(a.id); try{localStorage.setItem('ghars__deleted_ids',JSON.stringify(deletedIds));}catch(_){} }
      return;
    }
    if(!existing){ localStorage.setItem('ghars__users__'+a.id,JSON.stringify(a)); GharsDataDB.set('ghars__users__'+a.id, a, 'users').catch(function(){}); }
  });
  if(!localStorage.getItem('ghars__system__settings')){
    var _def={clubName:'نادي غرس',targetMemorization:30};
    localStorage.setItem('ghars__system__settings',JSON.stringify(_def));
    GharsDataDB.set('ghars__system__settings',_def,'system').catch(function(){});
  }
})();

var GharsDB={
  _col:function(p){return p.split('/')[0];},
  _doc:function(p){return p.split('/').slice(1).join('/');},
  _lsKey:function(p){
    var pts=p.split('/'); return pts.length===1?'ghars__'+pts[0]+'__*':'ghars__'+pts[0]+'__'+pts.slice(1).join('_');
  },
  get:async function(path){
    var lk = this._lsKey(path), col = this._col(path);
    if (_sbOK && _sb) {
      try {
        var r = await _sb.from('ghars_data').select('data').eq('collection', col).eq('doc_id', this._doc(path)).maybeSingle();
        if (r && !r.error && r.data && r.data.data) {
          var f = r.data.data;
          GharsDataDB.set(lk, f, col).catch(function () {});
          try { localStorage.setItem(lk, JSON.stringify(f)); } catch (_) {}
          return f;
        }
        // ══ CRITICAL FIX: If DB query succeeds but data is null => It was deleted! Do NOT fallback to local ══
        if (r && !r.error && !r.data) {
          GharsDataDB.del(lk).catch(function () {});
          try { localStorage.removeItem(lk); } catch (_) {}
          return null;
        }
      } catch (e) {}
    }
    // Fallback in case of actual network failure (error is true) or if offline
    try { var iv2 = await GharsDataDB.get(lk).catch(function () { return null; }); if (iv2) return iv2; } catch (_) {}
    try { var ls = localStorage.getItem(lk); return ls ? JSON.parse(ls) : null; } catch (_) { return null; }
  },
  set:async function(path,data){
    var lk = this._lsKey(path), col = this._col(path);
    
    if (col === 'users') {
      var uid = this._doc(path);
      if ((typeof _isDeleted === 'function' && _isDeleted(uid)) || data.deleted || data.purged || data.password === '__REVOKED__') {
          GharsDataDB.del(lk).catch(function () {});
          try { localStorage.removeItem(lk); } catch (_) {}
          return data; 
      }
    }

    GharsDataDB.set(lk, data, col).catch(function () {});
    try { localStorage.setItem(lk, JSON.stringify(data)); } catch (_) {}
    this._invalidate(col);

    if (_sbOK && _sb) {
      try {
        var r = await _sb.from('ghars_data').upsert({ collection: col, doc_id: this._doc(path), data: data, updated_at: new Date().toISOString() }, { onConflict: 'collection,doc_id' });
        if (r.error) throw r.error;
      } catch (e) { _writeQueue.push({ col: col, doc: this._doc(path), data: data }); }
    } else { _writeQueue.push({ col: col, doc: this._doc(path), data: data }); }
    return data;
  },
  delete:async function(path){
    var lk = this._lsKey(path), col = this._col(path);
    GharsDataDB.del(lk).catch(function () {});
    try { localStorage.removeItem(lk); } catch (_) {}
    this._invalidate(col);
    if (_sbOK && _sb) { try { await _sb.from('ghars_data').delete().eq('collection', col).eq('doc_id', this._doc(path)); } catch (e) {} }
  },
  _memCache:{}, _cacheTime:{}, _CACHE_TTL: 15000,
  _getCached:function(col){
    var now=Date.now();
    if(this._memCache[col]&&(now-this._cacheTime[col])<this._CACHE_TTL){ return this._memCache[col]; }
    return null;
  },
  _setCache:function(col,data){ this._memCache[col]=data; this._cacheTime[col]=Date.now(); },
  _invalidate:function(col){ delete this._memCache[col]; delete this._cacheTime[col]; },
  getAll:async function(col){
    var cached=this._getCached(col);
    if(cached){
      if(col === 'users'){
        var hasDeleted = Object.keys(cached).some(function(k){
          var u = cached[k]; return u && (u.deleted || u.purged || u.password === '__REVOKED__' || _isDeleted(k));
        });
        if(!hasDeleted) return cached;
        delete this._memCache[col]; delete this._cacheTime[col];
      } else { return cached; }
    }
    var pre='ghars__'+col+'__', out2={};
    try {
      var irows = await GharsDataDB.byCol(col);
      if (irows.length) {
        irows.forEach(function (r) {
          var d = r.v; if (!d) return;
          var key = (d && d.id) ? d.id : r.k.slice(pre.length); if (!key) return;
          if (col === 'users' && (d.deleted || d.purged || d.password === '__REVOKED__' || _isDeleted(key))) { GharsDataDB.del(r.k).catch(function () {}); return; }
          out2[key] = d;
        });
      }
    } catch (_) {}
    if (!Object.keys(out2).length) {
      for (var j = 0; j < localStorage.length; j++) {
        var lsK = localStorage.key(j);
        if (lsK && lsK.startsWith(pre)) {
          try {
            var item = JSON.parse(localStorage.getItem(lsK));
            if (item) {
              var ik = item.id || lsK.slice(pre.length);
              if (col === 'users' && (item.deleted || item.purged || item.password === '__REVOKED__' || _isDeleted(ik))) { try { localStorage.removeItem(lsK); } catch (_) {} }
              else { out2[ik] = item; }
            }
          } catch (_) {}
        }
      }
    }
    if (Object.keys(out2).length) this._setCache(col, out2);
    if (_sbOK && _sb) {
      try {
        var r = await _sb.from('ghars_data').select('doc_id,data').eq('collection', col).range(0, 9999);
        if (!r.error && r.data) {
          var out = {};
          r.data.forEach(function (row) {
            var d = row.data, key = (d && d.id) ? d.id : row.doc_id;
            if (key && d) {
              if (!d.id) d.id = key;
              if (col === 'users' && (d.deleted || d.purged || d.password === '__REVOKED__' || d.qrVersion === '__REVOKED__' || _isDeleted(key))) {
                GharsDataDB.del(pre + key).catch(function () {});
                try { localStorage.removeItem(pre + key); } catch (_) {}
                if (!_isDeleted(key)) _addToDeletedList(key);
                return;
              }
              out[key] = d;
              GharsDataDB.set(pre + key, d, col).catch(function () {});
              try { localStorage.setItem(pre + key, JSON.stringify(d)); } catch (_) {}
            }
          });
          GharsDataDB.byCol(col).then(function (stale) {
            stale.forEach(function (sr) {
              if (!out[sr.k.slice(pre.length)]) { GharsDataDB.del(sr.k).catch(function () {}); try { localStorage.removeItem(sr.k); } catch (_) {} }
            });
          }).catch(function () {});
          this._setCache(col, out);
          return out;
        }
      } catch (e) {}
    }
    return out2;
  },
  listen:function(col,cb){
    if(!_sbOK||!_sb)return function(){};
    try{
      var ch=_sb.channel('rt-'+col).on('postgres_changes',{ event:'*',schema:'public',table:'ghars_data',filter:'collection=eq.'+col },function(payload){
        if(payload.eventType==='DELETE'&&payload.old&&payload.old.doc_id){
          var delKey='ghars__'+col+'__'+payload.old.doc_id;
          GharsDataDB.del(delKey).catch(function(){}); try{localStorage.removeItem(delKey);}catch(_){}
          if(GharsDB._memCache){delete GharsDB._memCache[col];delete GharsDB._cacheTime[col];}
        }
        if(payload.new&&payload.new.data){
          var d=payload.new.data;
          if(d&&d.id){
            var k='ghars__'+col+'__'+d.id;
            if(d.deleted||d.purged){
              GharsDataDB.del(k).catch(function(){}); try{localStorage.removeItem(k);}catch(_){}
              if(col==='users') _addToDeletedList(d.id);
              if(GharsDB._memCache){delete GharsDB._memCache[col];delete GharsDB._cacheTime[col];}
            } else { GharsDataDB.set(k,d,col).catch(function(){}); try{localStorage.setItem(k,JSON.stringify(d));}catch(_){} }
          }
          if(typeof cb==='function')try{cb(d);}catch(_){}
        }
      }).subscribe();
      return function(){try{_sb.removeChannel(ch);}catch(_){}};
    }catch(_){return function(){};}
  },
  uploadFile:async function(filePath,file,onProgress){
    if(onProgress)onProgress(5);
    if(_sbOK&&_sb){
      try{
        var ext=file.name.split('.').pop()||'';
        var uniqueName=Date.now()+'_'+Math.random().toString(36).slice(2)+(ext?'.'+ext:'');
        if(onProgress)onProgress(15);
        var publicUrl=await new Promise(function(resolve,reject){
          var xhr=new XMLHttpRequest();
          xhr.upload.onprogress=function(e){ if(e.lengthComputable&&onProgress){ onProgress(15+Math.round(e.loaded/e.total*78)); } };
          xhr.onload=function(){
            if(xhr.status>=200&&xhr.status<300){ resolve(SUPABASE_URL+'/storage/v1/object/public/ghars-files/'+uniqueName); } 
            else { reject(new Error('Upload failed')); }
          };
          xhr.onerror=function(){reject(new Error('Network error'));};
          xhr.open('POST',SUPABASE_URL+'/storage/v1/object/ghars-files/'+uniqueName);
          xhr.setRequestHeader('Authorization','Bearer '+SUPABASE_KEY);
          xhr.setRequestHeader('x-upsert','true');
          xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
          xhr.send(file);
        });
        if(onProgress)onProgress(100); return publicUrl;
      }catch(e){}
    }
    var steps=[10,25,45,65,80,90,98];
    for(var i=0;i<steps.length;i++){await new Promise(function(r){setTimeout(r,40);});if(onProgress)onProgress(steps[i]);}
    var u2=await GharsFilesDB.save(filePath,file);if(onProgress)onProgress(100);return u2;
  },

  // ─────────────────────────────────────────────────────────────
  // deleteStorageFiles
  // يحذف ملفاً أو أكثر من bucket "ghars-files" في Supabase Storage.
  // يستقبل رابطاً واحداً أو مصفوفة روابط (public URLs).
  // الروابط الخارجية (YouTube, idb://, إلخ) تُتجاهل تلقائياً.
  // ─────────────────────────────────────────────────────────────
  deleteStorageFiles: async function(urls) {
    if (!_sbOK || !_sb) return { deleted: 0, errors: ['Supabase not ready'] };

    // النمط: https://<project>.supabase.co/storage/v1/object/public/ghars-files/<path>
    var MARKER = '/storage/v1/object/public/ghars-files/';

    var paths = (Array.isArray(urls) ? urls : [urls])
      .map(function(url) {
        if (!url || typeof url !== 'string') return null;
        var idx = url.indexOf(MARKER);
        if (idx === -1) return null; // رابط خارجي — تجاهله
        try { return decodeURIComponent(url.slice(idx + MARKER.length)); }
        catch(_) { return url.slice(idx + MARKER.length); }
      })
      .filter(Boolean);

    if (!paths.length) return { deleted: 0, errors: [] };

    try {
      var result = await _sb.storage.from('ghars-files').remove(paths);
      if (result.error) {
        console.warn('⚠️ Storage remove error:', result.error);
        return { deleted: 0, errors: [result.error] };
      }
      console.log('🗑 Storage: حُذف ' + (result.data||[]).length + ' ملف:', paths);
      return { deleted: (result.data || []).length, errors: [] };
    } catch(e) {
      console.warn('⚠️ Storage delete exception:', e);
      return { deleted: 0, errors: [e] };
    }
  }
};


// ── نظام حماية: Rate Limiting لمنع Brute Force ──────────────
var _rl = {
  attempts: 0,
  windowStart: 0,
  lockedUntil: 0,
  MAX: 7,              // أقصى محاولات مسموحة
  WINDOW: 10*60*1000,  // نافذة 10 دقائق
  LOCK: 15*60*1000     // إغلاق 15 دقيقة
};
function _rlCheck() {
  var now = Date.now();
  if (_rl.lockedUntil > now) {
    var mins = Math.ceil((_rl.lockedUntil - now) / 60000);
    return { ok: false, msg: '⛔ تم تعطيل تسجيل الدخول مؤقتاً بسبب محاولات متعددة. حاول بعد ' + mins + ' دقيقة.' };
  }
  if (now - _rl.windowStart > _rl.WINDOW) {
    _rl.attempts = 0;
    _rl.windowStart = now;
  }
  if (_rl.attempts >= _rl.MAX) {
    _rl.lockedUntil = now + _rl.LOCK;
    _rl.attempts = 0;
    return { ok: false, msg: '⛔ تم إيقاف تسجيل الدخول مؤقتاً بسبب محاولات متعددة. حاول بعد 15 دقيقة.' };
  }
  return { ok: true };
}
function _rlFail() {
  if (_rl.attempts === 0) _rl.windowStart = Date.now();
  _rl.attempts++;
}
function _rlReset() { _rl.attempts = 0; _rl.windowStart = 0; _rl.lockedUntil = 0; }
var Auth={
  currentUser:null, _presenceTimer:null,
  init:function(){
    try{
      var r=localStorage.getItem('ghars__session');
      if(r){
        var sess=JSON.parse(r);
        if(sess && sess.id && typeof _isDeleted==='function' && _isDeleted(sess.id)){
          try{localStorage.removeItem('ghars__session');}catch(_){}
          try{localStorage.removeItem('ghars__saved_creds');}catch(_){}
          try{localStorage.removeItem('ghars__users__'+sess.id);}catch(_){}
          if(typeof GharsDataDB!=='undefined') GharsDataDB.del('ghars__users__'+sess.id).catch(function(){});
          this.currentUser=null;
        } else {
          this.currentUser=sess;
        }
      }
    }catch(_){this.currentUser=null;}
  },
login: async function(username, password) {
    var u = (username || '').trim().toLowerCase();
    var p = (password || '').trim();
    if (!u || !p) return { ok: false, msg: 'يرجى إدخال اسم المستخدم وكلمة المرور' };

    // ── فحص Rate Limiting قبل أي عملية ──
    var _rlRes = _rlCheck();
    if (!_rlRes.ok) return { ok: false, msg: _rlRes.msg };

    // ── فحص فوري للقائمة السوداء بناءً على saved_creds ──
    try {
      var _sc = JSON.parse(localStorage.getItem('ghars__saved_creds') || 'null');
      if (_sc && _sc.username && _sc.username.toLowerCase() === u && _sc.id && _isDeleted(_sc.id)) {
        localStorage.removeItem('ghars__saved_creds');
        return { ok: false, msg: '⛔ هذا الحساب تم حذفه نهائياً ولا يمكن الدخول' };
      }
    } catch(_) {}

    // ── انتظر جاهزية Supabase (لا تحجب المستخدم إذا كانت لا تزال تتهيأ) ──
    if (_sb && !_sbOK) {
      await new Promise(function(res) {
        if (_sbOK) { res(); return; }
        var _done = false;
        var _timer = setTimeout(function() { if (!_done) { _done = true; res(); } }, 8000);
        window.addEventListener('ghars:connected', function _lConn() {
          if (!_done) {
            _done = true;
            clearTimeout(_timer);
            window.removeEventListener('ghars:connected', _lConn);
            res();
          }
        });
      });
    }

    // إذا لم يتصل Supabase نهائياً → أبلغ المستخدم بالمشكلة الحقيقية
    if (!_sb || !_sbOK) {
      return { ok: false, msg: '⚠️ تعذّر الاتصال بالخادم — تحقق من الإنترنت وحاول مجدداً.' };
    }

    try {
      // مزامنة القائمة السوداء أولاً
      await _syncDeletedListFromSupabase();

      // استعلام مباشر وصارم من قاعدة البيانات
      var sbR = await _sb.from('ghars_data')
                  .select('doc_id, data')
                  .eq('collection','users')
                  .filter('data->>username','ilike', u);

      if (sbR.error) throw sbR.error;

      if (sbR.data && sbR.data.length > 0) {
         var foundUser = sbR.data[0].data;

         // تحقق صارم من الحذف (في الخادم أو القائمة السوداء)
         if (!foundUser || _isDeleted(foundUser.id) || foundUser.deleted || foundUser.purged || foundUser.password === '__REVOKED__' || foundUser.qrVersion === '__REVOKED__') {
            if (foundUser && foundUser.id) _addToDeletedList(foundUser.id);
            return { ok: false, msg: '⛔ هذا الحساب تم حذفه نهائياً ولا يمكن الدخول' };
         }

         if ((foundUser.password||'').trim() !== p) { _rlFail(); return { ok: false, msg: '❌ كلمة المرور غير صحيحة' }; }

         // الدخول ناجح
         _rlReset();
         try { localStorage.setItem('ghars__users__'+foundUser.id, JSON.stringify(foundUser)); } catch(_){}
         if (typeof GharsDataDB!=='undefined') GharsDataDB.set('ghars__users__'+foundUser.id, foundUser, 'users').catch(function(){});
         await this._save(foundUser);
         return { ok: true, user: foundUser };

      } else {
         // التحقق من حسابات النظام الأساسية
         for (var sci = 0; sci < SYSTEM_ACCOUNTS.length; sci++) {
            var sacc = SYSTEM_ACCOUNTS[sci];
            if ((sacc.username||'').trim().toLowerCase() === u && (sacc.password||'').trim() === p) {
               // فحص محلي أولاً
               if (_isDeleted(sacc.id)) return { ok: false, msg:'⛔ هذا الحساب تم حذفه نهائياً' };
               // فحص Supabase لـ deleted_accounts (المرجعية الأساسية)
               try {
                 var _saccDel = await _sb.from('ghars_data').select('doc_id')
                   .eq('collection','deleted_accounts').eq('doc_id',sacc.id).maybeSingle();
                 if (_saccDel.data) {
                   _addToDeletedList(sacc.id);
                   return { ok: false, msg: '⛔ هذا الحساب تم حذفه نهائياً ولا يمكن الدخول' };
                 }
               } catch(_) {}
               await this._save(sacc); return { ok: true, user: sacc };
            }
         }
         // الحساب غير موجود في Supabase → محذوف أو غير مسجل
         _rlFail(); return { ok: false, msg: '⛔ الحساب غير موجود أو تم حذفه من النظام' };
      }
    } catch(e) {
       console.error('login error:', e);
       // إذا كانت المشكلة انقطاعاً مؤقتاً، أعطِ رسالة واضحة
       return { ok: false, msg: '⚠️ تعذّر الاتصال بالخادم — حاول مجدداً.' };
    }
  },

  verifyQrToken: async function(decoded) {
    if(!decoded || !decoded.un || !decoded.pw) return {ok: false, msg: 'رمز QR تالف'};
    var u = (decoded.un || '').trim().toLowerCase();
    var p = (decoded.pw || '').trim();
    var uid = decoded.id;

    if (uid && typeof _isDeleted === 'function' && _isDeleted(uid)) {
        return {ok: false, msg: '⛔ تم حذف هذا الحساب ورمز QR الخاص به نهائياً'};
    }

    // ── انتظر جاهزية Supabase ──
    if (_sb && !_sbOK) {
      await new Promise(function(res) {
        if (_sbOK) { res(); return; }
        var _qdone = false;
        var _qtimer = setTimeout(function() { if (!_qdone) { _qdone = true; res(); } }, 8000);
        window.addEventListener('ghars:connected', function _qConn() {
          if (!_qdone) {
            _qdone = true;
            clearTimeout(_qtimer);
            window.removeEventListener('ghars:connected', _qConn);
            res();
          }
        });
      });
    }
    if (!_sb || !_sbOK) {
       return {ok: false, msg: '⚠️ تعذّر الاتصال بالخادم — تحقق من الإنترنت وحاول مجدداً'};
    }

    try {
        var r = await _sb.from('ghars_data')
                   .select('data')
                   .eq('collection','users')
                   .filter('data->>username','eq',u)
                   .maybeSingle();

        var delR = await _sb.from('ghars_data')
                     .select('doc_id')
                     .eq('collection','deleted_accounts')
                     .eq('doc_id',uid)
                     .maybeSingle();

        if (delR && delR.data) {
             _addToDeletedList(uid);
             return {ok: false, msg: '⛔ تم حذف هذا الحساب نهائياً'};
        }

        if(!r.error && r.data && r.data.data) {
             var user = r.data.data;
             if(user.deleted || user.purged || user.password === '__REVOKED__' || user.qrVersion === '__REVOKED__'){
               _addToDeletedList(uid); return {ok: false, msg: '⛔ تم حذف هذا الحساب ورمز QR بشكل نهائي'};
             }
             if(user.qrInvalidated) return {ok: false, msg: '⛔ تم إلغاء رمز QR — تواصل مع المعلم'};
             if((user.password||'').trim() !== p) return {ok: false, msg: '⛔ رمز QR غير صالح — تواصل مع المعلم'};
             if(decoded.ver && user.qrVersion && decoded.ver !== user.qrVersion){ return {ok: false, msg: '⛔ رمز QR منتهي الصلاحية — تواصل مع المعلم'}; }

             return {ok: true, user: user};
        } else {
             if(uid) _addToDeletedList(uid);
             return {ok: false, msg: '⛔ الحساب غير موجود في النظام (تم حذفه)'};
        }
    } catch(e) {
        return {ok: false, msg: '⚠️ خطأ في التحقق من رمز QR'};
    }
  },

  _save:async function(user){
    var now=new Date();
    var updated=Object.assign({},user,{ lastSeen:now.toISOString(), lastSeenDay:GharsUtils.arabicDay(now), lastSeenHijri:GharsUtils.hijriShort(now), online:true });
    this.currentUser=updated;
    localStorage.setItem('ghars__session',JSON.stringify(updated));
    try { localStorage.setItem('ghars__saved_creds',JSON.stringify({ username: updated.username, id: updated.id, role: updated.role })); } catch(_){}
    GharsDB.set('users/'+user.id, updated).catch(function(){});
    return updated;
  },

  startPresence:function(){
    var self=this;
    if(this._presenceTimer)clearInterval(this._presenceTimer);
    window.addEventListener('ghars:connected',function _immediateCheck(){
      window.removeEventListener('ghars:connected',_immediateCheck);
      if(!self.currentUser) return;
      var _uid=self.currentUser.id;
      if(!_sbOK||!_sb) return;
      Promise.all([
        _sb.from('ghars_data').select('doc_id').eq('collection','deleted_accounts').eq('doc_id',_uid).maybeSingle(),
        _sb.from('ghars_data').select('data').eq('collection','users').eq('doc_id',_uid).maybeSingle()
      ]).then(function(results){
        var delR=results[0], userR=results[1];
        if (delR && delR.error) return; 
        if (userR && userR.error) return;

        if(delR&&delR.data){
          if(typeof _addToDeletedList==='function') _addToDeletedList(_uid);
          self.logout(); return;
        }
        if(userR&&!userR.data){
          if(typeof _addToDeletedList==='function') _addToDeletedList(_uid);
          self.logout(); return;
        }
        if(userR&&userR.data&&userR.data.data){
          var _ud=userR.data.data;
          if(_ud.deleted||_ud.purged||_ud.qrInvalidated||_ud.password==='__REVOKED__'){
            if(typeof _addToDeletedList==='function') _addToDeletedList(_uid);
            self.logout(); return;
          }
        }
      }).catch(function(){});
    });

    var _presenceCount=0;
    this._presenceTimer=setInterval(async function(){
      if(!self.currentUser)return;
      _presenceCount++;
      if(_presenceCount%3===0&&_sbOK&&_sb){
        try{
          var _pUid=self.currentUser.id;
          var _presResults=await Promise.all([
            _sb.from('ghars_data').select('doc_id').eq('collection','deleted_accounts').eq('doc_id',_pUid).maybeSingle(),
            _sb.from('ghars_data').select('data').eq('collection','users').eq('doc_id',_pUid).maybeSingle()
          ]);
          var _pDel=_presResults[0], _pUsr=_presResults[1];
          if (_pDel && _pDel.error) return;
          if (_pUsr && _pUsr.error) return;

          if(_pDel&&_pDel.data){
            if(typeof _addToDeletedList==='function') _addToDeletedList(_pUid);
            self.logout(); return;
          }
          if(_pUsr&&!_pUsr.data){
            if(typeof _addToDeletedList==='function') _addToDeletedList(_pUid);
            self.logout(); return;
          }
          if(_pUsr&&_pUsr.data&&_pUsr.data.data){
            var _pChk=_pUsr.data.data;
            if(_pChk.deleted||_pChk.purged||_pChk.qrInvalidated||_pChk.password==='__REVOKED__'){
              if(typeof _addToDeletedList==='function') _addToDeletedList(_pUid);
              self.logout(); return;
            }
          }
        }catch(_){}
      }
      var now=new Date();
      var upd=Object.assign({},self.currentUser,{ lastSeen:now.toISOString(),lastSeenDay:GharsUtils.arabicDay(now), lastSeenHijri:GharsUtils.hijriShort(now),online:true });
      self.currentUser=upd;
      try{localStorage.setItem('ghars__session',JSON.stringify(upd));}catch(_){}
    },30000); 

    window.addEventListener('beforeunload',function(){
      if(!self.currentUser)return;
      var offlineUser=Object.assign({},self.currentUser,{online:false,lastSeen:new Date().toISOString()});
      if(navigator.sendBeacon&&_sbOK){
        var body=JSON.stringify({collection:'users',doc_id:self.currentUser.id,data:offlineUser,updated_at:new Date().toISOString()});
        navigator.sendBeacon(SUPABASE_URL+'/rest/v1/ghars_data?on_conflict=collection,doc_id',body);
      }
      GharsDB.set('users/'+self.currentUser.id,offlineUser).catch(function(){});
      localStorage.setItem('ghars__session',JSON.stringify(offlineUser));
    });

    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState !== 'visible') return;
      if(!self.currentUser) return;
      if(!_sbOK || !_sb) return;
      var _vcUid = self.currentUser.id;
      Promise.all([
        _sb.from('ghars_data').select('doc_id')
          .eq('collection','deleted_accounts').eq('doc_id',_vcUid).maybeSingle(),
        _sb.from('ghars_data').select('data')
          .eq('collection','users').eq('doc_id',_vcUid).maybeSingle()
      ]).then(function(res){
        var _vcDel = res[0], _vcUsr = res[1];
        if (_vcDel && _vcDel.error) return;
        if (_vcUsr && _vcUsr.error) return;

        if(_vcDel && _vcDel.data){
          if(typeof _addToDeletedList==='function') _addToDeletedList(_vcUid);
          self.logout(); return;
        }
        if(_vcUsr && !_vcUsr.data){
          if(typeof _addToDeletedList==='function') _addToDeletedList(_vcUid);
          self.logout(); return;
        }
        if(_vcUsr && _vcUsr.data && _vcUsr.data.data){
          var _vud = _vcUsr.data.data;
          if(_vud.deleted || _vud.purged || _vud.qrInvalidated || _vud.password==='__REVOKED__'){
            if(typeof _addToDeletedList==='function') _addToDeletedList(_vcUid);
            self.logout(); return;
          }
        }
      }).catch(function(){});
    });
  },

  isOnline:function(user){
    if(!user||!user.lastSeen)return false;
    return(Date.now()-new Date(user.lastSeen).getTime())<90000;
  },

  logout:function(){
    if(this.currentUser){
      var uid=this.currentUser.id;
      var isDeleted=(this.currentUser.deleted||this.currentUser.purged||_isDeleted(uid));
      try{localStorage.removeItem('ghars__users__'+uid);}catch(_){}
      try{localStorage.removeItem('ghars__session');}catch(_){}
      if(typeof GharsDataDB!=='undefined') GharsDataDB.del('ghars__users__'+uid).catch(function(){});
      if(isDeleted){
        try{localStorage.removeItem('ghars__saved_creds');}catch(_){}
        if(typeof _addToDeletedList==='function') _addToDeletedList(uid);
      } else {
        var offUser=Object.assign({},this.currentUser,{online:false,lastSeen:new Date().toISOString()});
        GharsDB.set('users/'+uid,offUser).catch(function(){});
        // saved_creds محفوظة لتسهيل الدخول مرة أخرى
      }
    }
    if(this._presenceTimer)clearInterval(this._presenceTimer);
    this.currentUser=null;
    localStorage.removeItem('ghars__session');
    window.location.href='index.html';
  },

  requireAuth:async function(role){
    this.init();
    if(!this.currentUser){window.location.href='index.html';return false;}
    var uid = this.currentUser.id;

    if(typeof _isDeleted==='function' && _isDeleted(uid)){
      this.logout(); return false;
    }

    if(role==='teacher'&&this.currentUser.role==='student'){window.location.href='student.html';return false;}
    if(role==='student'&&this.currentUser.role!=='student'){window.location.href='teacher.html';return false;}

    // ══ CRITICAL FIX: حظر قاطع إذا كانت مكتبة Supabase لم تُحمّل إطلاقاً (معطلة بمانع إعلانات مثلاً) ══
    if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL.startsWith('https://')) {
      if (typeof _sb === 'undefined' || !_sb) {
         this.currentUser = null;
         localStorage.removeItem('ghars__session');
         window.location.href = 'index.html';
         return false;
      }
      
      // انتظار الاتصال (حتى 12 ثانية)
      if(!_sbOK){
        await new Promise(function(res){
          if(_sbOK){res();return;}
          var _done=false;
          var _timer=setTimeout(function(){if(!_done){_done=true;res();}},12000);
          window.addEventListener('ghars:connected',function _onConn(){
            if(!_done){ _done=true; clearTimeout(_timer); window.removeEventListener('ghars:connected',_onConn); res(); }
          });
        });
      }

      // إذا انقضت المهلة ولم يتصل → حاول مرة أخيرة مباشرة
      if(!_sbOK && _sb){
        try {
          var _pingR = await _sb.from('ghars_data').select('collection',{count:'exact',head:true});
          if(!_pingR.error) { _sbOK = true; }
        } catch(_) {}
      }
      
      // بعد المحاولة الثانية: إذا لم يتصل → ارفض الدخول
      if(!_sbOK){
         this.currentUser = null;
         localStorage.removeItem('ghars__session');
         window.location.href = 'index.html';
         return false;
      }

      try {
        var _delCheck = await _sb.from('ghars_data').select('doc_id').eq('collection','deleted_accounts').eq('doc_id',uid).maybeSingle();
        // ══ CRITICAL FIX: إذا حدث خطأ في جلب بيانات التحقق (مثلاً انقطع الاتصال فجأة) نرفض الدخول ══
        if(_delCheck.error) {
           this.currentUser = null;
           localStorage.removeItem('ghars__session');
           window.location.href = 'index.html';
           return false;
        }
        if(_delCheck.data){
          if(typeof _addToDeletedList==='function') _addToDeletedList(uid);
          this.logout(); return false;
        }

var _userCheck = await _sb.from('ghars_data').select('data').eq('collection','users').eq('doc_id',uid).maybeSingle();
        if(_userCheck.error) {
           this.currentUser = null;
           localStorage.removeItem('ghars__session');
           window.location.href = 'index.html';
           return false;
        }

        // الحذف القاطع: إذا المستخدم غير موجود إطلاقاً في جدول users في قاعدة البيانات
        if(!_userCheck.data){
          if(typeof _addToDeletedList==='function') _addToDeletedList(uid);
          this.logout(); return false;
        }

        var _snap = _userCheck.data.data;
        if(_snap&&(_snap.deleted||_snap.purged||_snap.qrInvalidated||_snap.password==='__REVOKED__')){
          if(typeof _addToDeletedList==='function') _addToDeletedList(uid);
          this.logout(); return false;
        }
        if(_snap&&_snap.credUpdatedAt&&this.currentUser.lastSeen&&new Date(_snap.credUpdatedAt)>new Date(this.currentUser.lastSeen)&&(_snap.username!==this.currentUser.username||_snap.password!==this.currentUser.password)){
          this.logout(); return false;
        }
        if(_snap){
          var _merged=Object.assign({},_snap,{ lastSeen:new Date().toISOString(), lastSeenDay:GharsUtils.arabicDay(new Date()), lastSeenHijri:GharsUtils.hijriShort(new Date()), online:true });
          this.currentUser=_merged;
          localStorage.setItem('ghars__session',JSON.stringify(_merged));
          try{localStorage.setItem('ghars__users__'+_merged.id,JSON.stringify(_merged));}catch(_){}
        }
      }catch(e){
         this.currentUser = null;
         localStorage.removeItem('ghars__session');
         window.location.href = 'index.html';
         return false;
      }
    } else {
      // فقط في حالة التشغيل المحلي البحت (No Supabase URL provided)
      try{
        var _offSnap=await GharsDB.get('users/'+uid);
        if(_offSnap){
          if(_offSnap.deleted||_offSnap.purged||_offSnap.qrInvalidated||_offSnap.password==='__REVOKED__'){
            if(typeof _addToDeletedList==='function') _addToDeletedList(uid);
            this.logout(); return false;
          }
          var _offMerged=Object.assign({},_offSnap,{ lastSeen:new Date().toISOString(), lastSeenDay:GharsUtils.arabicDay(new Date()), lastSeenHijri:GharsUtils.hijriShort(new Date()), online:true });
          this.currentUser=_offMerged;
          localStorage.setItem('ghars__session',JSON.stringify(_offMerged));
          try{localStorage.setItem('ghars__users__'+_offMerged.id,JSON.stringify(_offMerged));}catch(_){}
        } else {
          this.logout(); return false;
        }
      }catch(e){
        var _s3=null; try{_s3=JSON.parse(localStorage.getItem('ghars__users__'+uid));}catch(_){}
        if(_s3&&(_s3.deleted||_s3.purged)){this.logout();return false;}
      }
    }

    this.startPresence();
    return true;
  }
};

var GharsUtils={
  hijriShort:function(d){try{return(d||new Date()).toLocaleDateString('ar-SA-u-ca-islamic',{day:'numeric',month:'numeric',year:'numeric'});}catch(_){return(d||new Date()).toLocaleDateString('ar');}},
  toHijriShort:function(d){return this.hijriShort(d);},
  hijriFull:function(d){try{return(d||new Date()).toLocaleDateString('ar-SA-u-ca-islamic',{day:'numeric',month:'long',year:'numeric'});}catch(_){return(d||new Date()).toLocaleDateString('ar');}},
  arabicDay:function(d){return['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][(d||new Date()).getDay()];},
  formatTime:function(d){try{return(d||new Date()).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});}catch(_){return'';}},
  formatSeconds:function(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},
  formatDuration:function(s){if(!s||s<=0)return'—';var m=Math.floor(s/60),sc=s%60;return m<=0?sc+'ث':m+'د '+sc+'ث';},
  timeAgo:function(dateStr){
    var diff=Date.now()-new Date(dateStr).getTime();
    var m=Math.floor(diff/60000),h=Math.floor(diff/3600000),day=Math.floor(diff/86400000);
    if(m<1)return'الآن';if(m<60)return'منذ '+m+' د';if(h<24)return'منذ '+h+' س';
    if(day<7)return'منذ '+day+' يوم';return GharsUtils.hijriShort(new Date(dateStr));
  },
  uid:function(){return Date.now().toString(36)+Math.random().toString(36).slice(2,11);},
  esc:function(str){return String(str==null?'':str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');},
  generateUsername:function(name){var b=(name||'s').trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9]/gi,'')||'student';return b.slice(0,8)+Math.floor(1000+Math.random()*9000);},
  generatePassword:function(){var c='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';return Array.from({length:10},function(){return c[Math.floor(Math.random()*c.length)];}).join('');},
  countdown:function(targetDate,cb){
    function tick(){var diff=new Date(targetDate).getTime()-Date.now();if(diff<=0){cb({done:true,days:0,hours:0,minutes:0,seconds:0});return;}cb({done:false,days:Math.floor(diff/86400000),hours:Math.floor((diff%86400000)/3600000),minutes:Math.floor((diff%3600000)/60000),seconds:Math.floor((diff%60000)/1000)});}
    tick();return setInterval(tick,1000);
  },
  toArr:function(obj){if(Array.isArray(obj))return obj;if(!obj)return[];return Object.keys(obj).sort().map(function(k){return obj[k]});}
};

var UI={
  _toastQueue:[],
  _toastBusy:false,
  _toastShowNext:function(){
    var self=UI;
    if(self._toastBusy||!self._toastQueue.length) return;
    self._toastBusy=true;
    var item=self._toastQueue.shift();
    // تخطي المكررات المتتالية في الطابور
    while(self._toastQueue.length&&self._toastQueue[0].msg===item.msg&&self._toastQueue[0].type===item.type){
      self._toastQueue.shift();
    }
    var c=document.getElementById('toastContainer');
    if(!c){c=document.createElement('div');c.id='toastContainer';c.className='toast-container';document.body.appendChild(c);}
    var icons={success:'✅',error:'❌',warning:'⚠️',info:'🔔'};
    var t=document.createElement('div');
    t.className='toast '+item.type;
    t.innerHTML='<span class="toast-icon">'+(icons[item.type]||'🔔')+'</span><span>'+GharsUtils.esc(item.msg)+'</span><button class="toast-close" onclick="UI._toastDismiss(this.parentElement)">✖</button>';
    c.appendChild(t);
    requestAnimationFrame(function(){t.classList.add('show');});
    var hideTimer=setTimeout(function(){self._toastDismiss(t);},item.dur);
    t._hideTimer=hideTimer;
  },
  _toastDismiss:function(t){
    if(!t||t._dismissed)return;
    t._dismissed=true;
    clearTimeout(t._hideTimer);
    t.classList.remove('show');
    t.classList.add('hide');
    setTimeout(function(){t.remove();UI._toastBusy=false;UI._toastShowNext();},350);
  },
  toast:function(msg,type,dur){
    type=type||'info';dur=dur||3500;
    var q=this._toastQueue;
    // منع تكرار نفس الرسالة في نهاية الطابور
    if(q.length&&q[q.length-1].msg===msg&&q[q.length-1].type===type)return;
    // منع تكرار نفس الرسالة إذا كانت تُعرض الآن
    var c=document.getElementById('toastContainer');
    if(c){var cur=c.querySelector('.toast:not(.hide) span:nth-child(2)');if(cur&&cur.textContent===msg)return;}
    q.push({msg:msg,type:type,dur:dur});
    this._toastShowNext();
  },
  showModal:function(html,opts){
    opts=opts||{};var ov=document.createElement('div');ov.className='modal-overlay';ov.innerHTML=html;document.body.appendChild(ov);
    requestAnimationFrame(function(){ov.classList.add('show');var m=ov.querySelector('.modal');if(m)m.classList.add('show');});
    if(!opts.noOverlayClose){ov.addEventListener('click',function(e){if(e.target===ov){ov.classList.remove('show');setTimeout(function(){ov.remove();},200);}});}
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
  setLoading:function(el,show,text){
    if(!el)return;
    if(show){
      el.disabled=true;
      el._orig=el.innerHTML;
      el.innerHTML='<span class="loader loader-sm" style="display:inline-block;vertical-align:middle;margin-left:6px"></span>'+(text?'<span style="vertical-align:middle"> '+text+'</span>':'');
    }
    else{el.disabled=false;if(el._orig)el.innerHTML=el._orig;}
  },
  copyText:async function(text){
    try{await navigator.clipboard.writeText(text);this.toast('تم النسخ بنجاح!','success',2000);return true;}
    catch(_){
      var ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);ta.select();
      try{document.execCommand('copy');this.toast('تم النسخ!','success',2000);return true;}
      catch(_2){this.toast('فشل النسخ، جرب مرة أخرى','error');return false;}
      finally{ta.remove();}
    }
  }
};

(function(){if(navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia){navigator.mediaDevices.getDisplayMedia=function(){UI.toast('⛔ تصوير الشاشة محظور','error',3000);return Promise.reject(new Error('blocked'));};} })();

// ============================================================
// ═══ إصلاح أمان RLS (Row Level Security) ═══
// يجب تشغيل هذه الأوامر في Supabase SQL Editor مرة واحدة
// لتفعيل حماية الجداول من الوصول غير المصرح به
// ============================================================
var _rlsWarningShown = false;
function _checkAndWarnRLS() {
  if (!_sbOK || !_sb || _rlsWarningShown) return;
  _rlsWarningShown = true;
  // التحقق من وجود RLS عبر استدعاء pg_tables
  _sb.rpc('exec_sql', { sql: "SELECT relrowsecurity FROM pg_class WHERE relname='ghars_data' AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')" })
    .then(function(r) {
      if (r.error || !r.data) return; // RPC غير متاحة — طبيعي
      var row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (row && row.relrowsecurity === false) {
        console.warn('⚠️ تحذير أمني: RLS غير مفعّل على جدول ghars_data');
      }
    }).catch(function(){});
}

Auth.init();