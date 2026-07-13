// URL persistence
var DEFAULT_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyc_FB6OR_7FOLmUJnldpdU-nBfq8Wk0g-ZP-cvMDZQyDfb_SQx9ysGmKEV95sOF8s6/exec';

// =====================================================
// 🔐 LOGIN + ROLE PERMISSIONS
// =====================================================
var AUTH_USERS = {
  user_1: { password: 'Pass@1234', role: 'master', label: 'Master User' },
  user_2: { password: 'Pass@1234', role: 'deo', label: 'DEO User' },
  user_3: { password: 'Pass@1234', role: 'cert', label: 'Certificate User' },
  user_s: { password: 'Super@1234', role: 'super', label: 'Super Master User' },
  teacher_1: { password: 'Pass@1234', role: 'teacher', label: 'वर्ग शिक्षक', assignedClass: '7th|अ' }
};
var currentUser = null;
var USER_ALLOWED_PAGES = {
  master: ['dashboard','student','lc','bonafide','attendance','search','history','users','profile','stats','maintenance'],
  deo:    ['student','search','history','users','profile'],
  cert:   ['bonafide','attendance','search','history','users','profile'],
  super:  ['dashboard','student','lc','bonafide','attendance','search','history','users','profile','stats','maintenance'],
  teacher:['teacher','profile']
};
var CERT_EDITABLE_FIELDS = {
  bf: ['bf_regNo','bf_stxt2','bf_stxt57','bf_stxt3','bf_stxt3_sel','bf_stxt6'],
  at: ['at_regNo','at_stxt2','at_stxt57','at_stxt3','at_stxt3_sel','at_stxt16','at_stxt17','at_stxt5','at_stxt6','at_stxt14']
};

function defaultPageForRole(role) {
  if (role === 'deo') return 'student';
  if (role === 'cert') return 'bonafide';
  if (role === 'teacher') return 'teacher';
  return 'dashboard';
}

// ===== USER MANAGEMENT PRO (V19.9): Users sheet मधून AUTH_USERS sync करा =====
function syncRemoteUsers(onDone) {
  var url = getUrl();
  if (!url) { if (onDone) onDone(); return; }
  var cb = 'usersCb_' + Date.now() + '_' + Math.floor(Math.random()*10000);
  var done = false;
  function finish() {
    if (done) return;
    done = true;
    delete window[cb];
    if (onDone) onDone();
  }
  window[cb] = function(r) {
    if (r && r.status === 'ok' && r.data) {
      r.data.forEach(function(u) {
        AUTH_USERS[u.username] = { password: u.password, role: u.role, label: u.label, assignedClass: u.assignedClass || '' };
      });
    }
    finish();
  };
  var s = document.createElement('script');
  s.src = url + '?action=getUsers&callback=' + cb + '&t=' + Date.now();
  s.onerror = finish;
  document.head.appendChild(s);
  setTimeout(finish, 8000); // Apps Script Cold-start खूप वेळ घेतल्यास वाट न पाहता पुढे जा
}
function applyTeacherClassInfo() {
  if (!currentUser || currentUser.role !== 'teacher') return;
  var raw = (currentUser.assignedClass || '').toString();
  var parts = raw.split('|');
  currentUser.iyatta = parts[0] || '';
  currentUser.tukdi = parts[1] || '';
}

function initAuth() {
  var savedUser = sessionStorage.getItem('sgs_login_user');
  if (savedUser && AUTH_USERS[savedUser]) {
    currentUser = {
      username: savedUser,
      role: AUTH_USERS[savedUser].role,
      label: AUTH_USERS[savedUser].label,
      assignedClass: AUTH_USERS[savedUser].assignedClass || ''
    };
    applyTeacherClassInfo();
    document.body.classList.remove('auth-locked');
    applyRoleUI();
    showPage(defaultPageForRole(currentUser.role));
  } else {
    document.body.classList.add('auth-locked');
    document.body.classList.remove('role-master','role-deo','role-cert','role-super','role-teacher');
    setTimeout(function(){
      var u = document.getElementById('loginUsername');
      if (u) u.focus();
    }, 50);
  }
}

// ===== Login आधी शाळेशी Connect करण्याचे बटण — Users ताजे आणून ठेवते, म्हणजे प्रत्यक्ष Login तात्काळ होतो (V19.27) =====
function preConnectLogin() {
  var btn = document.getElementById('preConnectBtn');
  var st = document.getElementById('preConnectStatus');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '⏳ शाळेशी जोडत आहे...';
  if (st) { st.textContent = ''; st.style.color = ''; }
  syncRemoteUsers(function() {
    btn.disabled = false;
    btn.textContent = '✅ जोडले गेले — आता Login करा';
    if (st) {
      st.textContent = 'Username व Password टाकून Login करा — आता ते तात्काळ होईल.';
      st.style.color = '#1a7a3a';
    }
    var u = document.getElementById('loginUsername');
    if (u) u.focus();
    setTimeout(function() {
      if (btn) btn.textContent = '🔄 प्रथम शाळेशी जोडा (जलद व सुरक्षित Login साठी)';
    }, 5000);
  });
}

function attemptLogin(ev) {
  if (ev) ev.preventDefault();
  var uEl = document.getElementById('loginUsername');
  var pEl = document.getElementById('loginPassword');
  var st = document.getElementById('loginStatus');
  var username = (uEl ? uEl.value : '').trim();
  var password = pEl ? pEl.value : '';

  // Super Master: Google Sheets पूर्णपणे बंद/अनुपलब्ध असतानाही शाळेला नेहमी प्रवेश मिळावा
  // म्हणून hardcoded माहिती त्वरित (सिंक ची वाट न पाहता) तपासली जाते — फक्त हाच एक सुरक्षा अपवाद (V19.26)
  var hardcoded = AUTH_USERS[username];
  if (hardcoded && hardcoded.role === 'super' && hardcoded.password === password) {
    return completeLogin(username, hardcoded, pEl, st);
  }

  // ===== इतर सर्व Users (Master/DEO/Certificate/Class Teacher):
  // प्रत्येक Login वेळी थेट Google Sheets वरून ताजी माहिती आणूनच पडताळणी होते.
  // यामुळे तुम्ही Sheet/User Management मध्ये Password बदलल्यास तो लगेच पुढच्याच Login पासून काम करतो — जुन्या/साठवलेल्या माहितीवर अवलंबून राहत नाही. (V19.26) =====
  var attempts = [0, 1500, 3500]; // मिलिसेकंद विलंब — Apps Script Cold-start ला वेळ लागू शकतो
  var tryIndex = 0;
  if (st) { st.textContent = '⏳ शाळेच्या Sheet शी जोडत आहे, कृपया थोडा वेळ थांबा...'; st.className = 'login-status'; st.style.display = 'block'; }
  function tryOnce() {
    syncRemoteUsers(function() {
      var user = AUTH_USERS[username];
      if (user && user.password === password) {
        completeLogin(username, user, pEl, st);
        return;
      }
      tryIndex++;
      if (tryIndex < attempts.length) {
        if (st) st.textContent = '⏳ पुन्हा प्रयत्न करत आहे... (' + (tryIndex+1) + '/' + attempts.length + ')';
        setTimeout(tryOnce, attempts[tryIndex]);
      } else if (st) {
        st.textContent = 'Username किंवा Password चुकीचा आहे.';
        st.className = 'login-status err';
      }
    });
  }
  tryOnce();
  return false;
}
function completeLogin(username, user, pEl, st) {
  sessionStorage.setItem('sgs_login_user', username);
  currentUser = { username: username, role: user.role, label: user.label, assignedClass: user.assignedClass || '' };
  applyTeacherClassInfo();
  if (pEl) pEl.value = '';
  if (st) st.style.display = 'none';
  document.body.classList.remove('auth-locked');
  applyRoleUI();
  showPage(defaultPageForRole(user.role));
  return false;
}

function logoutUser() {
  sessionStorage.removeItem('sgs_login_user');
  currentUser = null;
  closeCert();
  document.body.classList.add('auth-locked');
  document.body.classList.remove('role-master','role-deo','role-cert','role-super','role-teacher');
  var chip = document.getElementById('authUserChip');
  if (chip) chip.textContent = 'User';
  setTimeout(function(){
    var u = document.getElementById('loginUsername');
    var p = document.getElementById('loginPassword');
    if (u) u.focus();
    if (p) p.value = '';
  }, 50);
}

function canEdit() {
  return currentUser && (currentUser.role === 'master' || currentUser.role === 'super');
}

function canEditStudent() {
  return currentUser && (currentUser.role === 'master' || currentUser.role === 'super' || currentUser.role === 'deo');
}

function canUsePage(name) {
  if (!currentUser) return false;
  return (USER_ALLOWED_PAGES[currentUser.role] || []).indexOf(name) !== -1;
}

function canSaveBFAT() {
  return currentUser && (currentUser.role === 'master' || currentUser.role === 'super' || currentUser.role === 'cert');
}
function requireMaster(pfx) {
  if (canEdit()) return true;
  showStatus(pfx || 'bf', '⚠️ माहिती Save/Update करण्याचा अधिकार फक्त Master User ला आहे.', 'err');
  return false;
}

function requireStudentEditor(pfx) {
  if (canEditStudent()) return true;
  showStatus(pfx || 's', '⚠️ विद्यार्थी माहिती Save/Update करण्याचा अधिकार फक्त Master User किंवा DEO User ला आहे.', 'err');
  return false;
}

function applyRoleUI() {
  if (!currentUser) return;
  document.body.classList.toggle('role-master', currentUser.role === 'master');
  document.body.classList.toggle('role-deo', currentUser.role === 'deo');
  document.body.classList.toggle('role-cert', currentUser.role === 'cert');
  document.body.classList.toggle('role-super', currentUser.role === 'super');
  document.body.classList.toggle('role-teacher', currentUser.role === 'teacher');
  var chip = document.getElementById('authUserChip');
  if (chip) chip.textContent = currentUser.label + ' (' + currentUser.username + ')';
  applyFormPermissions();
}

function isCertEditableField(id) {
  return CERT_EDITABLE_FIELDS.bf.indexOf(id) !== -1 || CERT_EDITABLE_FIELDS.at.indexOf(id) !== -1;
}

function applyFormPermissions() {
  if (!currentUser) return;
  var isMaster = currentUser.role === 'master' || currentUser.role === 'super';
  document.querySelectorAll('input,select,textarea').forEach(function(el){
    if (!el.id || el.id.indexOf('login') === 0 || el.type === 'hidden') return;
    if (el.id.indexOf('srch_') === 0) { el.disabled=false; el.classList.remove('locked-input'); return; }
    if (el.id.indexOf('hist_') === 0) { el.disabled=false; el.classList.remove('locked-input'); return; }
    if (el.id.indexOf('prof_') === 0) { el.disabled=false; el.classList.remove('locked-input'); return; }
    if (el.id.indexOf('pwd_') === 0) { el.disabled=false; el.classList.remove('locked-input'); return; }
    if (el.id.indexOf('tch_') === 0) { el.disabled=false; el.classList.remove('locked-input'); return; }
    if (el.id.indexOf('um_') === 0) {
      var canManageUsers = currentUser.role === 'super';
      el.disabled = !canManageUsers;
      el.classList.toggle('locked-input', !canManageUsers);
      return;
    }
    if (el.id === 'sheetsUrl') {
      el.disabled = false; el.classList.remove('locked-input'); return;
    }
    if (isMaster) {
      el.disabled = false;
      el.classList.remove('locked-input');
      return;
    }
    var allowed = currentUser.role === 'deo' ? el.id.indexOf('s_') === 0 : isCertEditableField(el.id);
    el.disabled = !allowed;
    el.classList.toggle('locked-input', !allowed);
  });
}

// =====================================================
// ⚡ BULK CACHE SYSTEM — Local Search Engine
// =====================================================
var studentCache = {
  data: [],         // [{regNo, studentId, firstName, ...}, ...]
  index: {},        // {regNo: dataObject, studentId: dataObject}
  loaded: false,
  loading: false,
  loadedAt: null,
  CACHE_KEY: 'sgs_student_cache_v1',
  CACHE_TIME_KEY: 'sgs_student_cache_time_v1',
  CACHE_TTL: 30 * 60 * 1000  // 30 मिनिटे TTL
};

function buildCacheIndex() {
  studentCache.index = {};
  studentCache.data.forEach(function(d) {
    if (d.regNo) studentCache.index[String(d.regNo).trim().toLowerCase()] = d;
    if (d.studentId) studentCache.index[String(d.studentId).trim().toLowerCase()] = d;
    if (d.aadhar && d.aadhar.length === 12) studentCache.index[String(d.aadhar).trim()] = d;
  });
}

function saveCacheToStorage() {
  try {
    localStorage.setItem(studentCache.CACHE_KEY, JSON.stringify(studentCache.data));
    localStorage.setItem(studentCache.CACHE_TIME_KEY, String(Date.now()));
  } catch(e) { /* localStorage full — ignore */ }
}

function loadCacheFromStorage() {
  try {
    var t = localStorage.getItem(studentCache.CACHE_TIME_KEY);
    if (!t) return false;
    if (Date.now() - parseInt(t) > studentCache.CACHE_TTL) return false;
    var raw = localStorage.getItem(studentCache.CACHE_KEY);
    if (!raw) return false;
    var arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return false;
    studentCache.data = arr;
    studentCache.loadedAt = new Date(parseInt(t));
    buildCacheIndex();
    studentCache.loaded = true;
    return true;
  } catch(e) { return false; }
}

function clearStudentCache() {
  localStorage.removeItem(studentCache.CACHE_KEY);
  localStorage.removeItem(studentCache.CACHE_TIME_KEY);
  studentCache.data = [];
  studentCache.index = {};
  studentCache.loaded = false;
  studentCache.loadedAt = null;
  updateCacheStatusBar();
  showCacheToast('🗑️ Cache Clear झाला — पुन्हा ⚡ Load करा', '#5a2020', '#ffb0b0');
}

function updateCacheStatusBar() {
  var bar = document.getElementById('cacheStatusBar');
  var txt = document.getElementById('cacheStatusText');
  if (!bar || !txt) return;
  if (studentCache.loaded && studentCache.data.length > 0) {
    bar.style.display = 'flex';
    var timeStr = studentCache.loadedAt ? studentCache.loadedAt.toLocaleTimeString('mr-IN') : '';
    txt.textContent = '⚡ ' + studentCache.data.length + ' विद्यार्थी Loaded — Search instant! (Loaded: ' + timeStr + ')';
    txt.style.color = '#7ef7a0';
    document.getElementById('bulkLoadBtn').textContent = '🔄 Refresh';
  } else {
    bar.style.display = studentCache.loading ? 'flex' : 'none';
  }
}

function showCacheToast(msg, bg, color) {
  var st = document.getElementById('testStatus');
  if (!st) return;
  st.style.display = 'block';
  st.style.background = bg || '#1a4a2a';
  st.style.color = color || '#b0ffc8';
  st.textContent = msg;
  clearTimeout(st._t);
  st._t = setTimeout(function(){ st.style.display='none'; }, 5000);
}

function bulkLoadAll() {
  var url = getUrl();
  if (!url) { showCacheToast('⚠️ आधी Apps Script URL टाका!', '#5a2020', '#ffb0b0'); return; }
  if (studentCache.loading) return;
  studentCache.loading = true;

  var bar = document.getElementById('cacheStatusBar');
  var txt = document.getElementById('cacheStatusText');
  var prog = document.getElementById('cacheProgressBar');
  var fill = document.getElementById('cacheProgressFill');
  if (bar) bar.style.display = 'flex';
  if (txt) { txt.textContent = '⏳ सर्व विद्यार्थी Download होत आहेत...'; txt.style.color = '#ffe07a'; }
  if (prog) prog.style.display = 'block';
  if (fill) fill.style.width = '10%';

  var done = false;
  var timer = setTimeout(function(){
    if (!done) { done = true; studentCache.loading = false; showCacheToast('❌ Timeout — Apps Script URL तपासा', '#5a2020', '#ffb0b0'); if(prog) prog.style.display='none'; }
  }, 45000);

  // Animate progress bar
  var pct = 10;
  var animInterval = setInterval(function(){
    if (done) { clearInterval(animInterval); return; }
    pct = Math.min(pct + 3, 85);
    if (fill) fill.style.width = pct + '%';
  }, 400);

  fetchRequest({action: 'getAll'}, function(r) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearInterval(animInterval);
    studentCache.loading = false;
    if (fill) { fill.style.width = '100%'; }
    if (prog) setTimeout(function(){ prog.style.display='none'; }, 600);

    if (r.status === 'ok' && Array.isArray(r.data) && r.data.length > 0) {
      studentCache.data = r.data;
      studentCache.loaded = true;
      studentCache.loadedAt = new Date();
      buildCacheIndex();
      saveCacheToStorage();
      updateCacheStatusBar();
      showCacheToast('✅ ' + r.data.length + ' विद्यार्थी Load झाले! आता Search instant होईल ⚡', '#1a4a2a', '#b0ffc8');
    } else if (r.status === 'notfound' || (r.status === 'ok' && Array.isArray(r.data) && r.data.length === 0)) {
      showCacheToast('⚠️ Sheet मध्ये कोणताही विद्यार्थी सापडला नाही.', '#5a3a10', '#ffe07a');
      if (bar) bar.style.display = 'none';
    } else {
      showCacheToast('❌ Load failed: ' + (r.message || r.status || 'Apps Script मध्ये getAll action आहे का?'), '#5a2020', '#ffb0b0');
      if (bar) bar.style.display = 'none';
    }
  });
}

// Cache मधून search — instant!
function searchInCache(q) {
  var key = String(q).trim().toLowerCase();
  return studentCache.index[key] || null;
}

// Update cache after save/update (so next search is still accurate)
function updateCacheEntry(d) {
  if (!studentCache.loaded) return;
  // Remove old entries for this student
  var regKey = d.regNo ? String(d.regNo).trim().toLowerCase() : null;
  var idKey  = d.studentId ? String(d.studentId).trim().toLowerCase() : null;
  studentCache.data = studentCache.data.filter(function(s){
    var sReg = s.regNo ? String(s.regNo).trim().toLowerCase() : null;
    var sId  = s.studentId ? String(s.studentId).trim().toLowerCase() : null;
    return !(regKey && sReg === regKey) && !(idKey && sId === idKey);
  });
  studentCache.data.push(d);
  buildCacheIndex();
  saveCacheToStorage();
}

window.addEventListener('DOMContentLoaded', function() {
  var saved = localStorage.getItem('sgs_url');
  document.getElementById('sheetsUrl').value = saved || DEFAULT_SHEETS_URL;
  document.getElementById('at_stxt16').addEventListener('input', calcPct);
  document.getElementById('at_stxt17').addEventListener('input', calcPct);

  // localStorage cache असल्यास auto-restore
  if (loadCacheFromStorage()) {
    updateCacheStatusBar();
    showCacheToast('⚡ ' + studentCache.data.length + ' विद्यार्थी Cache मधून Restore! Search instant आहे.', '#1a4a2a', '#b0ffc8');
  }
  initAuth();
  syncRemoteUsers();
  initSessionTimeout();
  initCertPrintShortcut();
});

// ===== SESSION TIMEOUT — 30 मिनिटे निष्क्रियतेनंतर auto logout (V19.8) =====
var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
var _sessionTimer = null;
function initSessionTimeout() {
  ['mousemove','keydown','click','touchstart','scroll'].forEach(function(evt) {
    document.addEventListener(evt, resetSessionTimer, {passive:true});
  });
  resetSessionTimer();
}
function resetSessionTimer() {
  if (!currentUser) return;
  clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(function() {
    if (!currentUser) return;
    var toast = document.getElementById('sessionTimeoutToast');
    if (toast) {
      toast.style.display = 'block';
      toast.textContent = '⏱️ 30 मिनिटे निष्क्रियतेमुळे आपोआप Logout झाले.';
    }
    logoutUser();
  }, SESSION_TIMEOUT_MS);
}

// ===== CTRL+P — CERTIFICATE PRINT SHORTCUT (V19.8) =====
function initCertPrintShortcut() {
  document.addEventListener('keydown', function(ev) {
    var modal = document.getElementById('certModal');
    if (modal && modal.classList.contains('open') && (ev.ctrlKey || ev.metaKey) && (ev.key === 'p' || ev.key === 'P')) {
      ev.preventDefault();
      window.print();
    }
  });
}
function saveUrl() { localStorage.setItem('sgs_url', document.getElementById('sheetsUrl').value.trim()); }
function getUrl() { return document.getElementById('sheetsUrl').value.trim(); }

// Navigation
function showPage(name, btn) {
  // URL cfgbar — आता सर्व roles ला सर्व pages वर उपलब्ध (V19.15)
  var cfgBar = document.getElementById('urlConfigBar');
  if (cfgBar) {
    cfgBar.style.display = '';
  }
  if (!currentUser) return;
  if (!canUsePage(name)) {
    name = defaultPageForRole(currentUser.role);
    btn = document.querySelector('.navbtn[data-page="'+name+'"]');
  }
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.remove('active'); });
  var page = document.getElementById('pg-'+name);
  if (page) page.classList.add('active');
  var activeBtn = btn && btn.classList && btn.classList.contains('navbtn') ? btn : document.querySelector('.navbtn[data-page="'+name+'"]');
  if (activeBtn) activeBtn.classList.add('active');
  applyFormPermissions();
}

// Attendance %
function calcPct() {
  var t=parseFloat(document.getElementById('at_stxt16').value)||0;
  var p=parseFloat(document.getElementById('at_stxt17').value)||0;
  document.getElementById('at_pct').value = t>0 ? (p/t*100).toFixed(1)+'%' : '';
}

// Photo preview
function previewPhoto(inp,imgId,iconId,txtId) {
  if(!inp.files||!inp.files[0]) return;
  var r=new FileReader();
  r.onload=function(ev){
    document.getElementById(imgId).src=ev.target.result;
    document.getElementById(imgId).style.display='block';
    document.getElementById(iconId).style.display='none';
    document.getElementById(txtId).style.display='none';
  };
  r.readAsDataURL(inp.files[0]);
}

function resetPhotoPreview() {
  var img = document.getElementById('s_photoPreview');
  var icon = document.getElementById('s_photoIcon');
  var txt = document.getElementById('s_photoTxt');
  var file = document.getElementById('s_photoInput');
  var url = document.getElementById('s_photoUrl');
  var st = document.getElementById('s_photoStatus');
  if (img) { img.src = ''; img.style.display = 'none'; }
  if (icon) icon.style.display = '';
  if (txt) txt.style.display = '';
  if (file) file.value = '';
  if (url) url.value = '';
  if (st) st.style.display = 'none';
}

// Status
function showStatus(pfx,msg,type) {
  var el=document.getElementById(pfx+'_status');
  if(!el) return;
  el.textContent=msg; el.className='status '+(type==='ok'?'ok':'err');
  clearTimeout(el._t);
  el._t=setTimeout(function(){ el.style.display='none'; },7000);
}

// Aadhar validation
function validateAadhar(el){
  if(!el) return;
  if(el.value.length===0){ el.style.borderColor=''; el.title=''; return; }
  if(el.value.length===12){ el.style.borderColor='#3a8a3a'; el.title='✅ 12 अंकी आधार'; }
  else { el.style.borderColor='#d04040'; el.title='⚠️ आधार कार्ड क्रमांक 12 अंकी असावा (सध्या '+el.value.length+' अंक)'; }
}

// DOB → DOB Words
function autoDobWords(){
  var dob=document.getElementById('s_dob');
  var dobW=document.getElementById('s_dobWords');
  if(!dob||!dobW) return;
  if(!dob.value){ dobW.value=''; return; }
  var parts=dob.value.split('-');
  if(parts.length!==3){ dobW.value=''; return; }
  var y=parseInt(parts[0],10), m=parseInt(parts[1],10), d=parseInt(parts[2],10);
  if(isNaN(y)||isNaN(m)||isNaN(d)){ dobW.value=''; return; }
  dobW.value = dayInMarathi(d)+' '+monthInMarathi(m)+' '+yearInMarathi(y);
}

function monthInMarathi(m){
  var months=['','जानेवारी','फेब्रुवारी','मार्च','एप्रिल','मे','जून','जुलै','ऑगस्ट','सप्टेंबर','ऑक्टोबर','नोव्हेंबर','डिसेंबर'];
  return months[m]||'';
}
function dayInMarathi(d){
  var ones=['','एक','दोन','तीन','चार','पाच','सहा','सात','आठ','नऊ','दहा',
    'अकरा','बारा','तेरा','चौदा','पंधरा','सोळा','सतरा','अठरा','एकोणीस','वीस',
    'एकवीस','बावीस','तेवीस','चोवीस','पंचवीस','सव्वीस','सत्तावीस','अठ्ठावीस','एकोणतीस','तीस','एकतीस'];
  return ones[d]||String(d);
}
function yearInMarathi(y){
  if(y<100) return numToMarathi(y);
  if(y>=1900 && y<=1999){
    var yy=y-1900;
    return 'एकोणावीसशे'+(yy?' '+numToMarathi(yy):'');
  }
  if(y<1000){
    var h=Math.floor(y/100), rem=y%100;
    return numToMarathi(h)+'शे'+(rem?' '+numToMarathi(rem):'');
  }
  var th=Math.floor(y/1000), rest=y%1000;
  var thStr=(th===1?'एक':numToMarathi(th))+' हजार';
  if(rest===0) return thStr;
  if(rest<100) return thStr+' '+numToMarathi(rest);
  var h=Math.floor(rest/100), rem=rest%100;
  return thStr+' '+numToMarathi(h)+'शे'+(rem?' '+numToMarathi(rem):'');
}
function numToMarathi(n){
  var ones=['शून्य','एक','दोन','तीन','चार','पाच','सहा','सात','आठ','नऊ','दहा',
    'अकरा','बारा','तेरा','चौदा','पंधरा','सोळा','सतरा','अठरा','एकोणीस','वीस',
    'एकवीस','बावीस','तेवीस','चोवीस','पंचवीस','सव्वीस','सत्तावीस','अठ्ठावीस','एकोणतीस','तीस',
    'एकतीस','बत्तीस','तेहतीस','चौतीस','पस्तीस','छत्तीस','सदोतीस','अडोतीस','एकोणचाळीस','चाळीस',
    'एक्केचाळीस','बेचाळीस','त्रेचाळीस','चव्वेचाळीस','पंचेचाळीस','सेहेचाळीस','सत्तेचाळीस','अठ्ठेचाळीस','एकोणपन्नास','पन्नास',
    'एक्कावन्न','बावन्न','त्रेपन्न','चोपन्न','पंचावन्न','छप्पन्न','सत्तावन्न','अठ्ठावन्न','एकोणसाठ','साठ',
    'एकसष्ट','बासष्ट','त्रेसष्ट','चौसष्ट','पासष्ट','सहासष्ट','सदुसष्ट','अडुसष्ट','एकोणसत्तर','सत्तर',
    'एकाहत्तर','बहात्तर','त्र्याहत्तर','चौर्‍याहत्तर','पंच्याहत्तर','शहात्तर','सत्त्याहत्तर','अठ्ठ्याहत्तर','एकोणऐंशी','ऐंशी',
    'एक्क्याऐंशी','ब्याऐंशी','त्र्याऐंशी','चौर्‍याऐंशी','पंच्यांशी','शहाऐंशी','सत्त्याऐंशी','अठ्ठ्याऐंशी','एकोणनव्वद','नव्वद',
    'एक्क्याण्णव','ब्याण्णव','त्र्याण्णव','चौर्‍याण्णव','पंच्याण्णव','शहाण्णव','सत्त्याण्णव','अठ्ठ्याण्णव','नव्व्याण्णव'];
  if(n<=99) return ones[n]||String(n);
  return String(n);
}

// Row tracker
var rowTracker={s:null,lc:null,bf:null,at:null};

function jsonpRequest(params, onResult) {
  var url=getUrl();
  if(!url){ onResult({status:'nourl'}); return; }
  var old=document.getElementById('_gss_jsonp');
  if(old&&old.parentNode) old.parentNode.removeChild(old);
  var done=false;
  var timer=setTimeout(function(){
    if(!done){done=true; onResult({status:'timeout',message:'Timeout'});}
  },25000);
  var cbName='_gssCb_'+Date.now()+'_'+Math.floor(Math.random()*1e6);
  window[cbName]=function(result){
    if(done) return; done=true; clearTimeout(timer);
    var t=document.getElementById('_gss_jsonp');
    if(t&&t.parentNode) t.parentNode.removeChild(t);
    try{ delete window[cbName]; }catch(e){ window[cbName]=undefined; }
    onResult(result||{status:'error',message:'Empty response'});
  };
  var qs=[];
  Object.keys(params).forEach(function(k){
    var v=params[k];
    qs.push(encodeURIComponent(k)+'='+encodeURIComponent(v===null||v===undefined?'':String(v)));
  });
  qs.push('callback='+cbName);
  qs.push('t='+Date.now());
  var sc=document.createElement('script');
  sc.id='_gss_jsonp';
  sc.src=url+'?'+qs.join('&');
  sc.onerror=function(){
    if(done) return; done=true; clearTimeout(timer);
    fetchRequest(params, onResult);
  };
  document.head.appendChild(sc);
}

function fetchRequest(params, onResult) {
  var url=getUrl();
  if(!url){ onResult({status:'nourl'}); return; }
  var qs=[];
  Object.keys(params).forEach(function(k){
    var v=params[k];
    qs.push(encodeURIComponent(k)+'='+encodeURIComponent(v===null||v===undefined?'':String(v)));
  });
  qs.push('t='+Date.now());
  fetch(url+'?'+qs.join('&'), {method:'GET', redirect:'follow'})
    .then(function(r){ return r.text(); })
    .then(function(txt){
      var json=txt.trim();
      var m=json.match(/^[^(]+\((.+)\);?\s*$/s);
      if(m) json=m[1];
      try{ onResult(JSON.parse(json)); }
      catch(e){ onResult({status:'ok',message:'Response: '+txt.substring(0,80)}); }
    })
    .catch(function(err){
      onResult({status:'error',message:'Fetch error: '+err.message});
    });
}

function fetchPost(params, onResult) {
  var url=getUrl();
  if(!url){ onResult({status:'nourl'}); return; }
  var body=new URLSearchParams();
  Object.keys(params).forEach(function(k){
    var v=params[k];
    body.append(k, v===null||v===undefined?'':String(v));
  });
  fetch(url, {
    method:'POST',
    mode:'no-cors',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:body.toString(),
    redirect:'follow'
  })
  .then(function(){
    var regNo=params.regNo||params.stxt1||params.stxt3||'';
    if(regNo){
      setTimeout(function(){
        fetchRequest({action:'search',q:regNo}, function(r){
          if(r.status==='found'||r.status==='notfound'){
            onResult({status:'ok',rowIndex:r.rowIndex||0,mode:'posted',
              message:r.status==='found'?'✅ Sheet मध्ये नोंद आढळली!':'⚠️ Sheet मध्ये अजून नाही — थोडा वेळ थांबा व Refresh करा'});
          } else {
            onResult({status:'ok',message:'POST sent — Sheet तपासा'});
          }
        });
      },3000);
    } else {
      onResult({status:'ok',message:'POST sent — Sheet तपासा'});
    }
  })
  .catch(function(err){
    jsonpRequest(params, onResult);
  });
}

function smartSave(data, onResult) {
  var url=getUrl();
  if(!url){ onResult({status:'nourl'}); return; }
  // ===== AUDIT LOG (V19.8): प्रत्येक Save सोबत User माहिती पाठवा =====
  if (currentUser) {
    data.auditUser = currentUser.username;
    data.auditRole = currentUser.role;
  }
  var qs=Object.keys(data).map(function(k){
    return encodeURIComponent(k)+'='+encodeURIComponent(data[k]==null?'':String(data[k]));
  }).join('&');
  if((url.length+qs.length) < 7500){
    jsonpRequest(data, function(r){
      if(r.status==='error' && r.message && r.message.indexOf('load failed')!==-1){
        fetchPost(data, onResult);
      } else {
        onResult(r);
      }
    });
  } else {
    fetchPost(data, onResult);
  }
}

function testConnection(){
  var st=document.getElementById('testStatus');
  var url=getUrl();
  if(!url){
    st.style.display='block'; st.style.background='#5a2020'; st.style.color='#ffb0b0';
    st.textContent='⚠️ आधी URL टाका!'; return;
  }
  st.style.display='block'; st.style.background='#2a3a5a'; st.style.color='#cfe0ff';
  st.textContent='⏳ Connection test करत आहे...';
  fetchRequest({action:'ping'}, function(r){
    if(r.status==='ok'){
      st.style.background='#1a4a2a'; st.style.color='#b0ffc8';
      st.textContent='✅ Connected! '+(r.message||'Apps Script चालू आहे!');
    } else if(r.status==='timeout'){
      st.style.background='#5a2020'; st.style.color='#ffb0b0';
      st.innerHTML='❌ Timeout. <b>Steps:</b><br>'
        +'1) Apps Script → Deploy → <b>New deployment</b><br>'
        +'2) Type: Web app | Execute as: Me | Access: <b>Anyone</b><br>'
        +'3) नवीन /exec URL copy करा → वरती paste करा → Test';
    } else if(r.status==='error'){
      st.style.background='#5a2020'; st.style.color='#ffb0b0';
      st.innerHTML='❌ Error: '+(r.message||'')+
        '<br><br><b>🔧 Fix:</b><br>'
        +'1) Apps Script उघडा → खालील Code section मधून code copy → paste → Save<br>'
        +'2) Deploy → <b>New deployment</b><br>'
        +'3) Execute as: <b>Me</b> &nbsp;|&nbsp; Who has access: <b>Anyone</b><br>'
        +'4) Deploy → नवीन URL copy → वरती paste → Test';
    } else {
      st.style.background='#1a4a2a'; st.style.color='#b0ffc8';
      st.textContent='✅ '+(r.message||'Connected!');
    }
  });
}

function doSearch(q, onResult) {
  // ⚡ Cache मध्ये आधी शोधा — instant result
  if (studentCache.loaded && studentCache.data.length > 0) {
    var cached = searchInCache(q);
    if (cached) {
      onResult({status: 'found', data: cached, rowIndex: cached._rowIndex || 0, source: 'cache'});
      return;
    } else {
      // Cache loaded पण सापडला नाही — Cloud वर try करा (नवीन student असेल)
      fetchRequest({action:'search', q:q}, function(r){
        if (r.status === 'found' && r.data) {
          r.data._rowIndex = r.rowIndex || 0;
          updateCacheEntry(r.data);
        }
        if(r.status==='error' || !r.status){
          jsonpRequest({action:'search', q:q}, onResult);
        } else {
          onResult(r);
        }
      });
      return;
    }
  }
  // Cache नाही — Cloud वर शोधा (जुनी पद्धत)
  fetchRequest({action:'search', q:q}, function(r){
    if(r.status==='error' || !r.status){
      jsonpRequest({action:'search', q:q}, onResult);
    } else {
      onResult(r);
    }
  });
}

function searchStudent(pfx) {
  var pageName = pfx === 's' ? 'student' : (pfx === 'lc' ? 'lc' : (pfx === 'bf' ? 'bonafide' : 'attendance'));
  if (!canUsePage(pageName)) {
    showStatus('bf', '⚠️ या user ला हा tab वापरण्याचा अधिकार नाही.', 'err');
    return;
  }
  var qEl=document.getElementById(pfx+'_regNo');
  var q=qEl?qEl.value.trim():'';
  if(!q){ showStatus(pfx,'⚠️ रजिस्टर नंबर टाका!','err'); return; }
  if(!getUrl()){ showStatus(pfx,'⚠️ वरती Apps Script URL टाका!','err'); return; }
  var srcLabel = (studentCache.loaded && studentCache.data.length > 0) ? '⚡ Cache मध्ये' : '☁️ Cloud मध्ये';
  showStatus(pfx, srcLabel + ' Reg No "'+q+'" शोधत आहे...','ok');
  doSearch(q, function(result){
    if(result.status==='nourl'){ showStatus(pfx,'⚠️ URL टाका!','err'); return; }
    if(result.status==='timeout'){ showStatus(pfx,'❌ Timeout — URL बरोबर आहे का?','err'); return; }
    if(result.status==='error'){ showStatus(pfx,'❌ Error: '+result.message,'err'); return; }
    if(result.status==='notfound') {
      rowTracker[pfx]=null;
      var ub=document.getElementById(pfx==='s'?'s_updateBtn':pfx+'_updateBtn');
      if(ub) ub.style.display='none';
      var ri=document.getElementById(pfx+'_rowInfo'); if(ri) ri.textContent='';
      if(pfx==='s'){
        showStatus(pfx,'ℹ️ Reg No "'+q+'" सापडला नाही — नवीन माहिती भरा आणि 💾 Save करा.','ok');
        var r2=document.getElementById('s_regNo2'); if(r2) r2.value=q;
      } else {
        showStatus(pfx,'❌ Reg No "'+q+'" Students मध्ये सापडला नाही. आधी विद्यार्थी नोंदणी करा.','err');
      }
      return;
    }
    rowTracker[pfx]=result.rowIndex;
    fillModule(pfx,result.data);
    if (pfx === 's' || !result.data.photoUrl) refreshPhotoUrlForRecord(pfx, result.data.regNo || result.data.studentId || q);
    var ub=document.getElementById(pfx==='s'?'s_updateBtn':pfx+'_updateBtn');
    if(ub) ub.style.display='';
    var ri=document.getElementById(pfx+'_rowInfo');
    if(ri) ri.textContent='(Row #'+result.rowIndex+')';
    var src = result.source === 'cache' ? ' ⚡ Cache' : ' ☁️ Cloud';
    var nextMsg = (pfx === 's' && canEditStudent()) || (pfx !== 's' && canEdit()) ? ' — बदल करून ✏️ Update दाबा.' : ' — प्रमाणपत्र पाहा / Print/PDF दाबा.';
    showStatus(pfx,'✅ सापडला!'+src+' ('+result.data.firstName+') Row #'+result.rowIndex+nextMsg,'ok');
    applyFormPermissions();
  });
}

function refreshPhotoUrlForRecord(pfx, regNo) {
  if (!regNo || !getUrl()) return;
  fetchRequest({action:'getPhotoUrl', regNo:regNo}, function(r){
    if (!r || r.status !== 'ok' || !r.photoUrl) return;
    var targetId = pfx === 's' ? 's_photoUrl' : (pfx === 'bf' ? 'bf_stxt___photoUrl' : (pfx === 'at' ? 'at_stxt___photoUrl' : ''));
    var target = targetId ? document.getElementById(targetId) : null;
    if (target) target.value = r.photoUrl;
    if (pfx === 's') {
      var prevImg=document.getElementById('s_photoPreview');
      var prevIcon=document.getElementById('s_photoIcon');
      var prevTxt=document.getElementById('s_photoTxt');
      if(prevImg){prevImg.src=r.photoUrl;prevImg.style.display='block';}
      if(prevIcon) prevIcon.style.display='none';
      if(prevTxt) prevTxt.style.display='none';
      showPhotoStatus('✅ Drive फोटो', 'ok');
    }
    if (studentCache.loaded) {
      var cached = searchInCache(regNo);
      if (cached) {
        cached.photoUrl = r.photoUrl;
        updateCacheEntry(cached);
      }
    }
  });
}

function fillModule(pfx,d) {
  function set(id,v){ var e=document.getElementById(id); if(e) e.value=(v===null||v===undefined)?'':String(v); }
  if(pfx==='s'){
    set('s_acYear',d.acYear); set('s_regNo',d.regNo); set('s_regNo2',d.regNo);
    set('s_studentId',d.studentId); set('s_studentId2',d.studentId);
    set('s_bookNo',d.bookNo); set('s_aadhar',d.aadhar);
    set('s_iyatta',d.iyatta); set('s_tukdi',d.tukdi); set('s_pen',d.pen); set('s_rollNo',d.rollNo);
    set('s_firstName',d.firstName);
    set('s_motherName',d.motherName); set('s_gender',d.gender); set('s_religion',d.religion);
    set('s_caste',d.caste); set('s_subcaste',d.subcaste); set('s_dob',d.dob); set('s_dobWords',d.dobWords);
    set('s_nationality',d.nationality||'Indian'); set('s_motherTongue',d.motherTongue||'मराठी');
    set('s_birthVillage',d.birthVillage);
    set('s_prevSchool',d.prevSchool); set('s_admissionDate',d.admissionDate);
    set('s_admissionClass',d.admissionClass); set('s_address',d.address);
    set('s_whatsappMobile',d.whatsappMobile); set('s_alternateMobile',d.alternateMobile);
    autoDobWords();
    var ah=document.getElementById('s_aadhar'); if(ah) validateAadhar(ah);
    // Drive फोटो असल्यास load करा
    set('s_photoUrl', d.photoUrl||'');
    if(d.photoUrl){
      var prevImg=document.getElementById('s_photoPreview');
      var prevIcon=document.getElementById('s_photoIcon');
      var prevTxt=document.getElementById('s_photoTxt');
      var pSt=document.getElementById('s_photoStatus');
      if(prevImg){prevImg.src=d.photoUrl;prevImg.style.display='block';}
      if(prevIcon) prevIcon.style.display='none';
      if(prevTxt) prevTxt.style.display='none';
      if(pSt){pSt.style.display='block';pSt.style.background='#1a4a2a';pSt.style.color='#7ef7a0';pSt.textContent='✅ Drive फोटो';}
    } else {
      var prevImg=document.getElementById('s_photoPreview');
      var prevIcon=document.getElementById('s_photoIcon');
      var prevTxt=document.getElementById('s_photoTxt');
      var pSt=document.getElementById('s_photoStatus');
      if(prevImg){prevImg.src='';prevImg.style.display='none';}
      if(prevIcon) prevIcon.style.display='';
      if(prevTxt) prevTxt.style.display='';
      if(pSt) pSt.style.display='none';
    }
  } else if(pfx==='lc'){
    set('lc_regNo',d.regNo||d.studentId); set('lc_stxt1',d.regNo||d.studentId);
    set('lc_stxt11',d.firstName);
    set('lc_stxt15',d.gender); set('lc_stxt19',d.dob); set('lc_stxt20',d.dobWords);
    set('lc_stxt7',d.iyatta); set('lc_stxt16',d.religion); set('lc_stxt17',d.caste);
    set('lc_stxt21',d.nationality||'Indian'); set('lc_stxt22',d.motherTongue);
    set('lc_stxt57',d.admissionDate); set('lc_stxt58',d.admissionClass);
    set('lc_stxt___aadhar',d.aadhar); set('lc_stxt___mother',d.motherName);
    set('lc_stxt___village',d.birthVillage); set('lc_stxt___village_show',d.birthVillage||'');
    set('lc_stxt___district',d.birthDistrict); set('lc_stxt___state',d.state);
    set('lc_stxt___prevSchool',d.prevSchool); set('lc_stxt___gender',d.gender);
    set('lc_stxt___pen',d.pen); set('lc_stxt___bookNo',d.bookNo);
    set('lc_stxt___subcaste',d.subcaste); set('lc_stxt___country',d.country||'India');
    set('lc_stxt72',''); // नवीन student load — LC serial reset
  } else if(pfx==='bf'){
    set('bf_regNo',d.regNo||d.studentId); set('bf_stxt1',d.regNo||d.studentId);
    set('bf_stxt11',d.firstName);
    set('bf_stxt19',d.dob); set('bf_stxt20',d.dobWords); set('bf_stxt7',d.iyatta);
    set('bf_stxt8',d.tukdi); set('bf_stxt16',d.religion); set('bf_stxt17',d.caste);
    set('bf_stxt21',d.nationality||'Indian'); set('bf_stxt4',d.admissionDate);
    set('bf_stxt5',d.admissionClass); set('bf_stxt9',d.contact); set('bf_stxt14',d.address);
    set('bf_stxt57',new Date().toISOString().slice(0,10));
    set('bf_stxt___gender',d.gender); set('bf_stxt___birthVillage',d.birthVillage); set('bf_stxt___birthVillage_show',d.birthVillage||'');
    set('bf_stxt___taluka',d.taluka); set('bf_stxt___district',d.birthDistrict);
    set('bf_stxt___pen',d.pen); set('bf_stxt___photoUrl',d.photoUrl||'');
    set('bf_stxt___certNo',''); // नवीन student load — serial reset
    syncBFPurposeUI(''); // purpose dropdown reset
  } else if(pfx==='at'){
    set('at_regNo',d.regNo||d.studentId); set('at_stxt1',d.regNo||d.studentId);
    set('at_stxt11',d.firstName);
    set('at_stxt15',d.gender); set('at_stxt19',d.dob); set('at_stxt7',d.iyatta);
    set('at_stxt8',d.tukdi); set('at_stxt57',new Date().toISOString().slice(0,10));
    set('at_stxt___pen',d.pen); set('at_stxt___photoUrl',d.photoUrl||'');
    set('at_stxt___certNo',''); // नवीन student load — serial reset
    syncATPurposeUI(''); // purpose dropdown reset
  }
}

function collectStudent() {
  function g(id){ var e=document.getElementById(id); return e?e.value:''; }
  return {
    acYear:g('s_acYear'),regNo:g('s_regNo2'),studentId:g('s_studentId2'),
    bookNo:g('s_bookNo'),aadhar:g('s_aadhar'),iyatta:g('s_iyatta'),tukdi:g('s_tukdi'),
    pen:g('s_pen'),rollNo:g('s_rollNo'),firstName:g('s_firstName'),
    motherName:g('s_motherName'),gender:g('s_gender'),
    religion:g('s_religion'),caste:g('s_caste'),subcaste:g('s_subcaste'),
    dob:g('s_dob'),dobWords:g('s_dobWords'),nationality:g('s_nationality'),
    motherTongue:g('s_motherTongue'),birthVillage:g('s_birthVillage'),
    prevSchool:g('s_prevSchool'),admissionDate:g('s_admissionDate'),
    admissionClass:g('s_admissionClass'),address:g('s_address'),
    photoUrl:g('s_photoUrl'),whatsappMobile:g('s_whatsappMobile'),alternateMobile:g('s_alternateMobile')
  };
}

// =====================================================
// 📷 PHOTO — Compress + Google Drive Upload
// =====================================================
function estimateBase64Bytes(b64) {
  return Math.ceil((b64 || '').length * 3 / 4);
}

function compressPhoto(file, maxBytes, onDone) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var maxSide = 260;
      var quality = 0.78;
      var best = '';
      var bestBytes = Infinity;

      for (var attempt = 0; attempt < 14; attempt++) {
        var w = img.width, h = img.height;
        var scale = Math.min(maxSide / w, maxSide / h, 1);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(70, Math.round(w * scale));
        canvas.height = Math.max(70, Math.round(h * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        var b64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
        var bytes = estimateBase64Bytes(b64);
        best = b64;
        bestBytes = bytes;
        if (bytes <= maxBytes) break;
        if (quality > 0.42) quality -= 0.08;
        else maxSide = Math.max(90, Math.round(maxSide * 0.84));
      }
      onDone(best, bestBytes);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function showPhotoStatus(msg, type) {
  var el = document.getElementById('s_photoStatus');
  if(!el) return;
  el.style.display = 'block';
  el.style.background = type==='ok' ? '#1a4a2a' : type==='err' ? '#5a2020' : '#2a3a5a';
  el.style.color = type==='ok' ? '#7ef7a0' : type==='err' ? '#ffb0b0' : '#cfe0ff';
  el.textContent = msg;
}

function confirmUploadedPhotoUrl(regNo, onDone) {
  jsonpRequest({action:'getPhotoUrl', regNo:regNo || ''}, function(r){
    if (r && r.status === 'ok' && r.photoUrl) {
      var photoUrl = r.photoUrl;
      var urlEl = document.getElementById('s_photoUrl');
      if (urlEl) urlEl.value = photoUrl;
      showPhotoStatus('✅ Drive ला Save!', 'ok');
      onDone(photoUrl);
      return;
    }
    var msg = r && r.message ? r.message : (r && r.status ? r.status : 'Photo URL मिळाली नाही');
    showPhotoStatus('⚠️ Upload confirm नाही', 'err');
    onDone('', msg);
  });
}

function postPhotoViaHiddenForm(url, regNo, b64, onPosted) {
  var iframeName = 'photoUploadFrame_' + Date.now();
  var iframe = document.createElement('iframe');
  iframe.name = iframeName;
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  var form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.target = iframeName;
  form.style.display = 'none';

  function add(name, value) {
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value || '';
    form.appendChild(input);
  }

  add('action', 'uploadPhoto');
  add('regNo', regNo || '');
  add('photoData', b64);
  add('mimeType', 'image/jpeg');
  document.body.appendChild(form);
  form.submit();

  setTimeout(function(){
    if (form.parentNode) form.parentNode.removeChild(form);
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    onPosted();
  }, 4500);
}

function uploadPhotoByChunks(regNo, b64, mimeType, onDone) {
  var uploadId = 'ph_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  var chunkSize = 1400;
  var chunks = [];
  for (var i = 0; i < b64.length; i += chunkSize) chunks.push(b64.slice(i, i + chunkSize));
  var total = chunks.length;

  function fail(msg) {
    showPhotoStatus('❌ ' + msg, 'err');
    onDone('', msg);
  }

  jsonpRequest({
    action:'photoChunkStart',
    uploadId:uploadId,
    regNo:regNo || '',
    mimeType:mimeType || 'image/jpeg',
    count:total
  }, function(startResult){
    if (!startResult || startResult.status !== 'ok') {
      fail((startResult && startResult.message) || 'Apps Script मध्ये photoChunkStart action नाही. Code update करून redeploy करा.');
      return;
    }
    sendChunk(0);
  });

  function sendChunk(idx) {
    if (idx >= total) {
      showPhotoStatus('⏳ Drive file तयार करत आहे...', 'info');
      jsonpRequest({
        action:'photoChunkFinish',
        uploadId:uploadId,
        regNo:regNo || '',
        mimeType:mimeType || 'image/jpeg',
        count:total
      }, function(doneResult){
        if (doneResult && doneResult.status === 'ok' && doneResult.photoUrl) {
          var urlEl = document.getElementById('s_photoUrl');
          if (urlEl) urlEl.value = doneResult.photoUrl;
          showPhotoStatus('✅ Drive ला Save!', 'ok');
          onDone(doneResult.photoUrl);
        } else {
          fail((doneResult && doneResult.message) || 'Upload पूर्ण झाला नाही. Apps Script redeploy/folder permission तपासा.');
        }
      });
      return;
    }
    showPhotoStatus('⏳ Upload ' + (idx + 1) + '/' + total, 'info');
    jsonpRequest({
      action:'photoChunk',
      uploadId:uploadId,
      idx:idx,
      chunk:chunks[idx]
    }, function(chunkResult){
      if (chunkResult && chunkResult.status === 'ok') {
        sendChunk(idx + 1);
      } else {
        fail((chunkResult && chunkResult.message) || ('Chunk ' + (idx + 1) + ' upload failed. Apps Script redeploy करा.'));
      }
    });
  }
}

function uploadPhotoToDrive(regNo, onDone) {
  var fileInput = document.getElementById('s_photoInput');
  // नवीन फोटो नाही — आधीचा URL परत द्या
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    var existing = document.getElementById('s_photoUrl');
    onDone(existing ? existing.value : '');
    return;
  }
  var file = fileInput.files[0];
  var url = getUrl();
  if (!url) { onDone(''); return; }

  showPhotoStatus('⏳ फोटो compress...', 'info');
  compressPhoto(file, 10 * 1024, function(b64, sizeBytes) {
    showPhotoStatus('⏳ Drive upload (' + (sizeBytes/1024).toFixed(1) + ' KB)...', sizeBytes <= 10*1024 ? 'info' : 'err');
    if (sizeBytes > 10 * 1024) {
      showStatus('s','❌ फोटो 10KB खाली compress झाला नाही. कृपया छोटा/cropped फोटो निवडा.','err');
      onDone('');
      return;
    }
    uploadPhotoByChunks(regNo, b64, 'image/jpeg', function(photoUrl, errMsg){
      if (!photoUrl && errMsg) console.warn('Photo upload failed:', errMsg);
      onDone(photoUrl);
    });
  });
}

function testPhotoDrive() {
  if (!requireStudentEditor('s')) return;
  if (!getUrl()) { showStatus('s','⚠️ Apps Script URL टाका.','err'); return; }
  showStatus('s','⏳ Drive folder access तपासत आहे...','ok');
  jsonpRequest({action:'testPhotoFolder'}, function(r){
    if (r && r.status === 'ok') {
      showStatus('s','✅ Drive folder OK: '+(r.folderName||'Photo folder')+' — test file create/delete झाले.','ok');
    } else {
      var msg = (r && r.message) || 'Apps Script code update/deploy किंवा folder permission तपासा.';
      if (msg.indexOf('DriveApp') !== -1 || msg.indexOf('permission') !== -1) {
        msg += ' | Fix: Apps Script appsscript.json मध्ये drive oauthScope add करा, Save करा, New Version deploy करा आणि authorization Allow करा.';
      }
      showStatus('s','❌ Drive folder test failed: '+msg,'err');
    }
  });
}

function uploadOnlyPhoto() {
  if (!requireStudentEditor('s')) return;
  var regNoEl = document.getElementById('s_regNo2');
  var fileInput = document.getElementById('s_photoInput');
  var regNo = regNoEl ? regNoEl.value.trim() : '';
  if (!regNo) {
    showStatus('s','⚠️ फोटो upload करण्यापूर्वी रजिस्टर नंबर टाका.','err');
    return;
  }
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    showStatus('s','⚠️ नवीन फोटो निवडा.','err');
    return;
  }
  showStatus('s','⏳ फोटो Drive ला upload/update करत आहे...','ok');
  uploadPhotoToDrive(regNo, function(photoUrl){
    if (photoUrl) {
      var data = collectStudent();
      data.regNo = regNo;
      data.photoUrl = photoUrl;
      updateCacheEntry(data);
      showStatus('s','✅ फोटो Upload/Update झाला!','ok');
    } else {
      showStatus('s','⚠️ फोटो upload झाला, पण URL confirm झाला नाही. Apps Script मध्ये getPhotoUrl action तपासा.','err');
    }
  });
}

function saveNew(pfx) {
  if(!requireStudentEditor(pfx)) return;
  var url=getUrl(); if(!url){showStatus(pfx,'⚠️ URL टाका!','err');return;}
  if(pfx!=='s') return;
  var data=collectStudent();
  if(!data.firstName){showStatus(pfx,'⚠️ विद्यार्थ्याचे नाव आवश्यक!','err');return;}
  if(data.aadhar && data.aadhar.length!==12){showStatus(pfx,'⚠️ आधार कार्ड क्रमांक 12 अंकी असावा (किंवा रिकामे ठेवा)!','err');return;}
  showStatus(pfx,'⏳ फोटो upload करत आहे...','ok');
  uploadPhotoToDrive(data.regNo||data.studentId||data.firstName, function(photoUrl){
    data.photoUrl = photoUrl;
    proceedSaveStudent(pfx, data);
  });
}

function proceedSaveStudent(pfx,data){
  data.action='upsert';
  showStatus(pfx,'⏳ Google Sheets मध्ये Save/Update होत आहे...','ok');
  smartSave(data,function(r){
    handleSaveResult(pfx,r,'✅ विद्यार्थी माहिती Save/Update झाली! ('+data.firstName+')');
    // Cache अपडेट करा — पुढचा search instant होईल
    if(r.status==='saved'||r.status==='ok'||r.status==='sent') {
      data._rowIndex = r.rowIndex || data._rowIndex || 0;
      updateCacheEntry(data);
    }
  });
}

function updateRecord(pfx) {
  if(!requireStudentEditor(pfx)) return;
  var url=getUrl(); if(!url){showStatus(pfx,'⚠️ URL टाका!','err');return;}
  if(!rowTracker[pfx]){showStatus(pfx,'⚠️ आधी शोधा — मग Update करा!','err');return;}
  var data=collectStudent();
  if(data.aadhar && data.aadhar.length!==12){showStatus(pfx,'⚠️ आधार कार्ड क्रमांक 12 अंकी असावा (किंवा रिकामे ठेवा)!','err');return;}
  data.action='update'; data.rowIndex=rowTracker[pfx];
  var savedRow=rowTracker[pfx];

  function doUpdate(d) {
    if(d.aadhar){
      showStatus(pfx,'⏳ आधार duplicate check करत आहे...','ok');
      doSearch(d.aadhar, function(r){
        if(r.status==='found' && r.rowIndex && parseInt(r.rowIndex,10)!==parseInt(savedRow,10)){
          var dn=r.data||{};
          var name=(dn.firstName||'');
          showStatus(pfx,'❌ हा आधार Row #'+r.rowIndex+' ला आधीच आहे ('+name.trim()+'). वेगळा आधार वापरा.','err');
          return;
        }
        if(r.status==='error'||r.status==='timeout'){
          showStatus(pfx,'❌ Duplicate check failed: '+(r.message||r.status||'')+' — URL तपासा.','err');
          return;
        }
        proceedUpdateStudent(pfx,d,savedRow);
      });
    } else {
      proceedUpdateStudent(pfx,d,savedRow);
    }
  }

  // फोटो बदलला असल्यास upload
  var fileInput = document.getElementById('s_photoInput');
  if(fileInput && fileInput.files && fileInput.files[0]) {
    showStatus(pfx,'⏳ नवीन फोटो upload करत आहे...','ok');
    uploadPhotoToDrive(data.regNo||data.studentId||data.firstName, function(photoUrl){
      data.photoUrl = photoUrl;
      doUpdate(data);
    });
  } else {
    data.photoUrl = document.getElementById('s_photoUrl') ? document.getElementById('s_photoUrl').value : '';
    doUpdate(data);
  }
}

function proceedUpdateStudent(pfx,data,savedRow){
  showStatus(pfx,'⏳ Update होत आहे...','ok');
  smartSave(data,function(r){
    if(r.status==='ok'||r.status==='saved'||r.status==='sent'){
      showStatus(pfx,'✅ Row #'+savedRow+' Update झाला!','ok');
      data._rowIndex = savedRow;
      updateCacheEntry(data);
      rowTracker[pfx]=null;
      var ub=document.getElementById('s_updateBtn'); if(ub) ub.style.display='none';
      var ri=document.getElementById('s_rowInfo'); if(ri) ri.textContent='';
    } else {
      showStatus(pfx,'❌ Update failed: '+(r.message||r.status||'unknown'),'err');
    }
  });
}

function handleSaveResult(pfx,r,successMsg){
  if(r.status==='saved'||(r.status==='ok'&&(r.rowIndex||r.action))){
    var mode = r.mode==='updated' ? 'Updated' : (r.mode==='created' ? 'New Entry' : '');
    showStatus(pfx,successMsg+(r.rowIndex?' (Row #'+r.rowIndex+')':'')+(mode?' - '+mode:''),'ok');
  } else if(r.status==='sent'){
    showStatus(pfx,successMsg+' (Verify in Sheet)','ok');
  } else if(r.status==='ok'){
    showStatus(pfx,'❌ Save failed: Apps Script ने save action चालवले नाही. Apps Script code/URL update करा.','err');
  } else if(r.status==='nourl'){
    showStatus(pfx,'⚠️ URL टाका!','err');
  } else if(r.status==='timeout'){
    showStatus(pfx,'❌ Timeout — Web App "Anyone" access आहे का? Deploy केले का?','err');
  } else {
    showStatus(pfx,'❌ Save failed: '+(r.message||r.status||'unknown — Apps Script Sheet सोबत bound आहे का?'),'err');
  }
}

function collectLC() {
  function g(id){ var e=document.getElementById(id); return e?e.value:''; }
  return {
    stxt1:g('lc_stxt1'),firstName:g('lc_stxt11'),gender:g('lc_stxt15'),dob:g('lc_stxt19'),dobWords:g('lc_stxt20'),
    iyatta:g('lc_stxt7'),religion:g('lc_stxt16'),caste:g('lc_stxt17'),
    nationality:g('lc_stxt21'),motherTongue:g('lc_stxt22'),
    admissionDate:g('lc_stxt57'),admissionClass:g('lc_stxt58'),
    lcLeaveDate:g('lc_stxt65'),lcLeaveClass:g('lc_stxt66'),classStartDate:g('lc_stxt82'),
    lcNo:g('lc_stxt72'),lcDate:g('lc_stxt71'),conduct:g('lc_stxt73'),
    progress:g('lc_stxt74'),stxt75:g('lc_stxt75'),stxt76:g('lc_stxt76'),
    remarks:g('lc_stxt64'),medium:g('lc_stxt59'),nextSchool:g('lc_stxt77'),
    lcCount:g('lc_stxt78'),feeStatus:g('lc_stxt79'),
    stxt60:g('lc_stxt60'),stxt61:g('lc_stxt61'),stxt62:g('lc_stxt62'),
    stxt63:g('lc_stxt63'),stxt67:g('lc_stxt67'),stxt68:g('lc_stxt68'),
    stxt69:g('lc_stxt69'),stxt70:g('lc_stxt70'),nationalityType:g('lc_stxt80')
  };
}
// ===== BF/AT Purpose Dropdown Helpers =====
function bfPurposeChange() {
  var sel = document.getElementById('bf_stxt3_sel');
  var inp = document.getElementById('bf_stxt3');
  if (!sel || !inp) return;
  if (sel.value === 'इतर') {
    inp.style.display = 'block';
    inp.value = '';
    inp.focus();
  } else {
    inp.style.display = 'none';
    inp.value = sel.value;
  }
}
function atPurposeChange() {
  var sel = document.getElementById('at_stxt3_sel');
  var inp = document.getElementById('at_stxt3');
  if (!sel || !inp) return;
  if (sel.value === 'इतर') {
    inp.style.display = 'block';
    inp.value = '';
    inp.focus();
  } else {
    inp.style.display = 'none';
    inp.value = sel.value;
  }
}
// sync select from existing input value (fillModule साठी)
function syncBFPurposeUI(val) {
  var sel = document.getElementById('bf_stxt3_sel');
  var inp = document.getElementById('bf_stxt3');
  if (!sel || !inp) return;
  var opts = Array.from(sel.options).map(o => o.value);
  if (!val) { sel.value = ''; inp.style.display='none'; inp.value=''; return; }
  if (opts.indexOf(val) !== -1 && val !== 'इतर') {
    sel.value = val; inp.style.display='none'; inp.value=val;
  } else {
    sel.value = 'इतर'; inp.style.display='block'; inp.value=val;
  }
}
function syncATPurposeUI(val) {
  var sel = document.getElementById('at_stxt3_sel');
  var inp = document.getElementById('at_stxt3');
  if (!sel || !inp) return;
  var opts = Array.from(sel.options).map(o => o.value);
  if (!val) { sel.value = ''; inp.style.display='none'; inp.value=''; return; }
  if (opts.indexOf(val) !== -1 && val !== 'इतर') {
    sel.value = val; inp.style.display='none'; inp.value=val;
  } else {
    sel.value = 'इतर'; inp.style.display='block'; inp.value=val;
  }
}

function saveLCData() {
  if(!requireMaster('lc')) return;
  var url=getUrl(); if(!url){showStatus('lc','⚠️ URL टाका!','err');return;}
  // नवीन save = नवीन serial → आधी field clear करा
  var lcNoEl = document.getElementById('lc_stxt72');
  var prevLcNo = lcNoEl ? lcNoEl.value : '';
  if(lcNoEl) lcNoEl.value = '';
  var data=collectLC(); data.action='upsert_lc';
  showStatus('lc','⏳ Saving...','ok');
  smartSave(data,function(r){
    handleSaveResult('lc',r,'✅ LC Save झाला! (लि.स.क्र. '+(r.serial||'')+')');
    if(r && r.status==='ok' && r.serial) {
      if(lcNoEl) lcNoEl.value = r.serial;
      if(typeof showSaveNotif==='function') showSaveNotif('📋','LC Save झाला!',r.serial,'लि.स.क्र.','LC Sheet मध्ये नोंद झाली.');
    } else if(r && r.status==='error') {
      if(lcNoEl) lcNoEl.value = prevLcNo;
      if(typeof showSaveError==='function') showSaveError(r.message||'LC Save झाले नाही.');
    }
  });
}
function updateLCRecord() {
  if(!requireMaster('lc')) return;
  var url=getUrl(); if(!url){showStatus('lc','⚠️ URL टाका!','err');return;}
  var data=collectLC(); data.action='upsert_lc';
  showStatus('lc','⏳ Updating...','ok');
  smartSave(data,function(r){ handleSaveResult('lc',r,'✅ LC Update झाला!'); });
}

function saveBFData() {
  if(!canSaveBFAT()){ showStatus('bf','⚠️ BF Save साठी Login आवश्यक आहे.','err'); return; }
  var url=getUrl(); if(!url){ showStatus('bf','⚠️ Master User ने URL Set करणे आवश्यक.','err'); return; }
  function g(id){ var e=document.getElementById(id); return e?e.value:''; }
  var data={
    action:'upsert_bf',stxt1:g('bf_stxt1'),firstName:g('bf_stxt11'),dob:g('bf_stxt19'),
    dobWords:g('bf_stxt20'),iyatta:g('bf_stxt7'),tukdi:g('bf_stxt8'),
    religion:g('bf_stxt16'),caste:g('bf_stxt17'),nationality:g('bf_stxt21'),
    acYear:g('bf_stxt2'),bfDate:g('bf_stxt57'),purpose:g('bf_stxt3'),
    admissionDate:g('bf_stxt4'),admissionClass:g('bf_stxt5'),
    remarks:g('bf_stxt6'),address:g('bf_stxt14'),contact:g('bf_stxt9')
  };
  // नवीन save = नवीन serial → आधी field clear करा
  var bfCertEl = document.getElementById('bf_stxt___certNo');
  if(bfCertEl) bfCertEl.value = '';
  showStatus('bf','⏳ Saving...','ok');
  smartSave(data,function(r){
    handleSaveResult('bf',r,'✅ Bonafide Save झाले! (बोना.क्र. '+(r.serial||'')+')');
    if(r && r.status==='ok') {
      if(bfCertEl && r.serial) bfCertEl.value = r.serial;
      if(typeof showSaveNotif==='function') showSaveNotif('📄','Bonafide Save झाले!',r.serial||'','बोना. क्र.','Bonafide Sheet मध्ये नोंद झाली.');
    } else if(r && r.status==='error') {
      if(typeof showSaveError==='function') showSaveError(r.message||'Bonafide Save झाले नाही.');
    }
  });
}

function saveATData() {
  if(!canSaveBFAT()){ showStatus('at','⚠️ AT Save साठी Login आवश्यक आहे.','err'); return; }
  var url=getUrl(); if(!url){ showStatus('at','⚠️ Master User ने URL Set करणे आवश्यक.','err'); return; }
  function g(id){ var e=document.getElementById(id); return e?e.value:''; }
  var data={
    action:'upsert_at',stxt1:g('at_stxt1'),firstName:g('at_stxt11'),gender:g('at_stxt15'),
    dob:g('at_stxt19'),iyatta:g('at_stxt7'),tukdi:g('at_stxt8'),
    acYear:g('at_stxt2'),atDate:g('at_stxt57'),purpose:g('at_stxt3'),
    totalDays:g('at_stxt16'),presentDays:g('at_stxt17'),
    pct:document.getElementById('at_pct').value,
    fromDate:g('at_stxt5'),toDate:g('at_stxt6'),remarks:g('at_stxt14')
  };
  // नवीन save = नवीन serial → आधी field clear करा
  var atCertEl = document.getElementById('at_stxt___certNo');
  if(atCertEl) atCertEl.value = '';
  showStatus('at','⏳ Saving...','ok');
  smartSave(data,function(r){
    handleSaveResult('at',r,'✅ Attendance Save झाला! (उप.क्र. '+(r.serial||'')+')');
    if(r && r.status==='ok') {
      if(atCertEl && r.serial) atCertEl.value = r.serial;
      if(typeof showSaveNotif==='function') showSaveNotif('✅','Attendance Save झाला!',r.serial||'','उपस्थिती क्र.','Attendance Sheet मध्ये नोंद झाली.');
    } else if(r && r.status==='error') {
      if(typeof showSaveError==='function') showSaveError(r.message||'Attendance Save झाले नाही.');
    }
  });
}

function clearForm(pfx) {
  syncBFPurposeUI('');
  syncATPurposeUI('');
  if(!confirm('Form Clear करायचा का?')) return;
  var prefix=pfx==='s'?'s_':pfx+'_';
  document.querySelectorAll('[id^="'+prefix+'"]').forEach(function(el){
    if(el.tagName==='BUTTON'||el.type==='file') return;
    el.value='';
  });
  if(pfx==='s'){
    var n=document.getElementById('s_nationality'); if(n) n.value='Indian';
    var st=document.getElementById('s_state'); if(st) st.value='Maharashtra';
    var c=document.getElementById('s_country'); if(c) c.value='India';
    var mt=document.getElementById('s_motherTongue'); if(mt) mt.value='मराठी';
    resetPhotoPreview();
  }
  rowTracker[pfx]=null;
  var ub=document.getElementById(pfx==='s'?'s_updateBtn':pfx+'_updateBtn');
  if(ub) ub.style.display='none';
  var ri=document.getElementById(pfx+'_rowInfo'); if(ri) ri.textContent='';
  applyFormPermissions();
  showStatus(pfx,'✅ Form Clear झाला!','ok');
}

// ===== CERTIFICATE MODAL =====
function openCert(title, html, pageSize) {
  var modal = document.getElementById('certModal');
  document.getElementById('certModalTitle').textContent = title;
  document.getElementById('certContent').innerHTML = html;
  modal.dataset.pageSize = pageSize || 'a4';
  // Update modal box width for A4
  var mbox = modal.querySelector('.modal-box');
  if(mbox) mbox.style.width = '210mm';
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCert() {
  var modal = document.getElementById('certModal');
  modal.classList.remove('open');
  delete modal.dataset.pageSize;
  document.body.style.overflow = '';
}

// ===== CERTIFICATE VERIFICATION QR CODE (V19.9 — data embedded directly so scanning always shows info, even without opening the Apps Script link) =====
function renderCertQR(qrData) {
  var box = document.getElementById('certQrBox');
  if (!box) return;
  box.innerHTML = '';
  if (!qrData || !qrData.serial || typeof QRCode === 'undefined') {
    box.innerHTML = '<div style="font-size:6.5pt;color:#999;font-family:\'Poppins\',sans-serif">Save नंतर QR उपलब्ध</div>';
    return;
  }
  var typeLabel = { LC:'LC Certificate', BF:'Bonafide Certificate', AT:'Attendance Certificate' }[qrData.type] || qrData.type;
  var lines = [
    'Shri Govindram Seksaria High School, Pachora',
    typeLabel,
    'Serial No: ' + qrData.serial,
    'Reg No: ' + (qrData.regNo || '-'),
    'Name: ' + (qrData.name || '-'),
    'Date: ' + (qrData.date || '-')
  ];
  if (qrData.url) lines.push('Verify: ' + qrData.url);
  var text = lines.join('\n');
  try {
    var qrHolder = document.createElement('div');
    new QRCode(qrHolder, { text: text, width: 68, height: 68, correctLevel: QRCode.CorrectLevel.M });
    box.appendChild(qrHolder);
    var lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:6pt;color:#555;margin-top:1mm;font-family:\'Poppins\',sans-serif';
    lbl.textContent = 'Scan for Details';
    box.appendChild(lbl);
  } catch(e) {}
}

// ===== PDF EXPORT FROM CERTIFICATE MODAL =====
function exportCertAsPDF(customFilename) {
  if (currentUser && currentUser.role === 'user') {
    alert('PDF Download अधिकार फक्त Master User ला आहे. Print बटण वापरा.');
    return;
  }
  var certPage = document.querySelector('#certContent .cert-page');
  if (!certPage) { alert('⚠️ आधी certificate पाहा (LC/Bonafide/Attendance बटण दाबा)'); return; }

  var btn = document.getElementById('certPdfBtn');
  var status = document.getElementById('certPdfStatus');
  btn.disabled = true;
  btn.textContent = '⏳ ...';
  status.style.display = 'inline';

  // Always A4 now
  var pdfW = 210;
  var pdfH = 297;

  var today = new Date().toISOString().slice(0,10);
  var filename = customFilename || (document.getElementById('certModalTitle').textContent||'Cert').replace(/[^\u0900-\u097F\w]/g,'_').substring(0,10) + '_' + today + '.pdf';

  var scale = 3;

  html2canvas(certPage, {
    scale: scale,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: certPage.scrollWidth,
    windowHeight: certPage.scrollHeight,
    onclone: function(clonedDoc) {
      var clonedPage = clonedDoc.querySelector('.cert-page');
      if (clonedPage) {
        clonedPage.style.fontFamily = "'Mukta','Noto Serif Devanagari','Noto Sans Devanagari',sans-serif";
      }
    }
  }).then(function(canvas) {
    try {
      var imgData = canvas.toDataURL('image/jpeg', 0.97);
      var cw = canvas.width;
      var ch = canvas.height;
      var pageAspect = pdfW / pdfH;
      var imgAspect  = cw / ch;
      var imgW, imgH, offsetX = 0, offsetY = 0;
      if (imgAspect > pageAspect) {
        imgW = pdfW;
        imgH = pdfW / imgAspect;
        offsetY = (pdfH - imgH) / 2;
      } else {
        imgH = pdfH;
        imgW = pdfH * imgAspect;
        offsetX = (pdfW - imgW) / 2;
      }
      var doc = new window.jspdf.jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
      doc.addImage(imgData, 'JPEG', offsetX, offsetY, imgW, imgH);
      doc.save(filename);
    } catch(e) {
      alert('❌ PDF export error: ' + e.message);
    }
    btn.disabled = false;
    btn.textContent = '📥 PDF Download';
    status.style.display = 'none';
  }).catch(function(err) {
    alert('❌ Capture error: ' + err.message);
    btn.disabled = false;
    btn.textContent = '📥 PDF Download';
    status.style.display = 'none';
  });
}

function pad2(n) { return String(n).padStart(2,'0'); }
function todayDate() {
  var d = new Date();
  return pad2(d.getDate()) + '-' + pad2(d.getMonth()+1) + '-' + d.getFullYear();
}

function fmtDate(d) {
  if (!d) return '';
  var s = String(d).trim();
  var p = s.split('-');
  if (p.length === 3 && p[0].length === 4) return p[2] + '-' + p[1] + '-' + p[0];
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return pad2(m[1]) + '-' + pad2(m[2]) + '-' + m[3];
  return s;
}

function classToMr(c) {
  var m = {'5th':'5 वी','6th':'6 वी','7th':'7 वी','8th':'8 वी','9th':'9 वी','10th':'10 वी',
           '1st':'1 ली','2nd':'2 री','3rd':'3 री','4th':'4 थी'};
  return m[c] || c;
}

function classWords(c) {
  var m = {'5th':'पाचवी','6th':'सहावी','7th':'सातवी','8th':'आठवी','9th':'नववी','10th':'दहावी',
           '1st':'पहिली','2nd':'दुसरी','3rd':'तिसरी','4th':'चौथी'};
  return m[c] || c;
}

function aadharBoxes(a) {
  var s = (a||'').replace(/\D/g,'').padEnd(12,' ');
  return s.split('').map(function(ch){ return '<div class="cbox">'+ch.trim()+'</div>'; }).join('');
}

function idBoxes(id, len) {
  var s = (id||'').padEnd(len||20,' ');
  return s.split('').slice(0,len||20).map(function(ch){ return '<div class="cbox">'+ch.trim()+'</div>'; }).join('');
}

function genderTitle(g, name) {
  return (g === 'Female') ? 'कुमारी ' + name : 'कुमार ' + name;
}
function genderHe(g) { return (g === 'Female') ? 'ती' : 'तो'; }
function genderHis(g) { return (g === 'Female') ? 'तिची' : 'त्याची'; }
function escAttr(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}
function certificatePhotoHTML(photoUrl) {
  var safe = escAttr(photoUrl || '');
  if (!safe) return '<div class="cert-photo-box"><div class="cert-photo-placeholder">फोटो</div></div>';
  return '<div class="cert-photo-box"><img src="'+safe+'" crossorigin="anonymous" referrerpolicy="no-referrer" onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;flex&quot;"><div class="cert-photo-placeholder" style="display:none">फोटो</div></div>';
}

// ===== SCHOOL HEADER HTML =====
function schoolHeaderHTML(lcNo, regNo, isMul) {
  return `
  <div style="text-align:center;font-family:'Noto Sans Devanagari',sans-serif;font-size:7.5pt;color:#555;margin-bottom:1mm">
    पाचोरा तालुका सहकारी शिक्षण संस्था संचलित,
  </div>
  <div style="text-align:center;font-family:'Noto Serif Devanagari',serif;font-size:14pt;font-weight:900;color:#111;line-height:1.2">
    श्री.गोविंदराम सेक्सरिया हायस्कूल, पाचोरा जि.जळगाव
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:7.5pt;font-family:'Noto Sans Devanagari',sans-serif;margin:1.5mm 0 0">
    <tr>
      <td>शाळा मान्यता क्र. - <b>GAC/4/Recogn/(B.E.) Dated 27/29th Nov.1960</b></td>
      <td style="text-align:right">ई-मेल - <b>sgspachora@gmail.com</b></td>
    </tr>
    <tr>
      <td>युडायस क्र. – <b>27031201718</b></td>
      <td style="text-align:center">बोर्ड - <b>महाराष्ट्र रा.माध्य.व उ.माध्य.शिक्षण विभागीय मंडळ, नाशिक</b></td>
      <td style="text-align:right">माध्यम- <b>मराठी</b></td>
    </tr>
    <tr>
      <td><b>(02596) 245481</b></td>
      <td style="text-align:center"></td>
      <td style="text-align:right">संलग्नता क्र. - <b>एस.15.13.001</b></td>
    </tr>
    <tr>
      <td>लि.स.क्र. <b>${lcNo||''}</b></td>
      <td style="text-align:center"></td>
      <td style="text-align:right">जनरल रजि. क्र. <b>${regNo||''}</b></td>
    </tr>
  </table>`;
}

// ===== LC CERTIFICATE (unchanged — keeps border) =====
function showLCCert() {
  function g(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  var fn = g('lc_stxt11');
  var fullName = fn;
  var lcNo = g('lc_stxt72'), regNo = g('lc_stxt1');
  var isMul = lcNo ? (lcNo.toString().indexOf('D')===0 || true) : true;
  var isDup = g('lc_stxt78') && parseInt(g('lc_stxt78')) > 1;
  var lcType = isDup ? 'दुय्यमप्रत' : 'मुळप्रत';

  var aadhar = g('lc_stxt___aadhar') || '';
  var dob = g('lc_stxt19');
  var dobFmt = fmtDate(dob);
  var admClass = classToMr(g('lc_stxt58'));
  var leaveClass = classToMr(g('lc_stxt66'));
  var leaveClassW = classWords(g('lc_stxt66'));
  var admDate = fmtDate(g('lc_stxt57'));
  var leaveDate = fmtDate(g('lc_stxt65'));
  var leaveDateRaw = g('lc_stxt82') || g('lc_stxt65');
  var leaveYear = '', leaveMonth = '', leaveMonthMr = '';
  if (leaveDateRaw) {
    var lp = leaveDateRaw.split('-');
    leaveYear = lp[0] || '';
    leaveMonth = lp[1] || '';
  }
  var mrMonths = ['','जानेवारी','फेब्रुवारी','मार्च','एप्रिल','मे','जून','जुलै','ऑगस्ट','सप्टेंबर','ऑक्टोबर','नोव्हेंबर','डिसेंबर'];
  leaveMonthMr = mrMonths[parseInt(leaveMonth,10)] || '';
  var leaveFromText = [leaveMonthMr, leaveYear].filter(Boolean).join(' ');
  var admDateRaw = g('lc_stxt57');
  var admYear = admDateRaw ? admDateRaw.split('-')[0] : '';

  function mkBoxes(dateStr) {
    var d = fmtDate(dateStr||'').replace(/\//g,'-');
    while(d.length < 10) d += ' ';
    return d.split('').slice(0,10).map(function(c){
      return '<div class="cbox '+(c==='-'?'dash':'')+'">'+c.trim()+'</div>';
    }).join('');
  }

  var today = todayDate();

  var html = `
  <div class="cert-page a4">
    <div class="cert-outer-border">
      ${schoolHeaderHTML(g('lc_stxt72'), regNo, false)}
      <hr class="cert-divider">
      <div style="text-align:center;margin:1mm 0">
        <div style="display:inline-block;border:2px solid #1a2a4a;padding:1.5mm 12mm;font-family:'Noto Serif Devanagari',serif;font-size:11pt;font-weight:700;color:#1a2a4a">
          शाळा सोडल्याचा दाखला
        </div>
        <div style="font-family:'Noto Serif Devanagari',serif;font-size:9pt;font-weight:600;color:#333;margin-top:1mm">${lcType}</div>
      </div>
      <div style="margin:2mm 0;font-size:7.5pt;font-family:'Noto Sans Devanagari',sans-serif">
        <div style="margin-bottom:1.5mm">
          <span style="font-weight:600">स्टुडंट आय.डी.नं. -</span>
          <span style="display:inline-flex;gap:1mm;margin-left:2mm">${idBoxes(regNo, 19)}</span>
        </div>
        <div style="display:flex;gap:8mm;margin-bottom:1.5mm;flex-wrap:wrap">
          <span><span style="font-weight:600">यु.आय.डी.नं. (आधार कार्ड) -</span>
          <span style="display:inline-flex;gap:1mm;margin-left:2mm">${aadharBoxes(g('s_aadhar')||'')}</span></span>
        </div>
        <div style="margin-bottom:1mm">
          <span style="font-weight:600">पर्मनंट एज्यूकेशन नं. -</span>
          <span style="display:inline-flex;gap:1mm;margin-left:2mm">${idBoxes('', 14)}</span>
        </div>
      </div>
      <table class="cert-field-table">
        <tr>
          <td class="lbl">विद्यार्थ्याचे संपूर्ण नांव</td>
          <td class="sep">–</td>
          <td class="val" style="font-size:10pt">
            <b>${fullName}</b>
          </td>
        </tr>
        <tr>
          <td class="lbl">आईचे नांव</td>
          <td class="sep">–</td>
          <td class="val">${g('lc_stxt___mother')||'-'}</td>
        </tr>
        <tr>
          <td class="lbl">राष्ट्रीयत्व</td>
          <td class="sep">–</td>
          <td class="val">${g('lc_stxt21')||'भारतीय'}
            <span style="margin-left:12mm;font-weight:600">मातृभाषा</span>
            <span style="margin-left:2mm">${g('lc_stxt22')||'मराठी'}</span>
          </td>
        </tr>
        <tr>
          <td class="lbl">धर्म, जात - पोटजात</td>
          <td class="sep">–</td>
          <td class="val">${g('lc_stxt16')||''} ${g('lc_stxt17')||''}</td>
        </tr>
        <tr>
          <td class="lbl">जन्मस्थळ</td>
          <td class="sep">–</td>
          <td class="val"><b>${g('lc_stxt___village')||''}</b></td>
        </tr>
        <tr>
          <td class="lbl">इ.सनाप्रमाणे जन्म दिनांक<br><small style="font-weight:400">(अक्षरी)</small></td>
          <td class="sep">–</td>
          <td class="val">
            <div class="date-boxes" style="display:flex;gap:1mm;margin-bottom:1mm">${mkBoxes(dobFmt)}</div>
            <div style="font-size:8pt;font-weight:400">${g('lc_stxt20')||''}</div>
          </td>
        </tr>
        <tr>
          <td class="lbl">या पूर्वीची शाळा</td>
          <td class="sep">–</td>
          <td class="val">${g('lc_stxt___prevSchool')||''}</td>
        </tr>
        <tr>
          <td class="lbl">या शाळेत प्रवेश घेतल्याचा दिनांक व या पूर्वीची इयत्ता</td>
          <td class="sep">–</td>
          <td class="val">
            <b>${admDate}</b>
            <span style="margin-left:10mm">इयत्ता <b>${admClass}</b></span>
          </td>
        </tr>
        <tr>
          <td class="lbl">अभ्यासातील प्रगती</td>
          <td class="sep">–</td>
          <td class="val">${g('lc_stxt74')||'चांगली'}
            <span style="margin-left:10mm;font-weight:600">वर्तणूक</span>
            <span style="margin-left:2mm">${g('lc_stxt73')||'चांगली'}</span>
          </td>
        </tr>
        <tr>
          <td class="lbl">शाळा सोडल्याची दिनांक</td>
          <td class="sep">–</td>
          <td class="val">
            <div class="date-boxes" style="display:flex;gap:1mm;margin-bottom:1mm">${mkBoxes(leaveDate)}</div>
          </td>
        </tr>
        <tr>
          <td class="lbl">कोणत्या इयत्तेत शिकत होता व केव्हापासून (अक्षरी)</td>
          <td class="sep">–</td>
          <td class="val">इयत्ता <b>${leaveClass}</b>त ${leaveFromText ? leaveFromText + ' पासून' : ''}<br>
            <small style="font-weight:400">(इयत्ता ${leaveClassW}त माहे ${leaveFromText}${leaveFromText ? ' पासून' : ''})</small>
          </td>
        </tr>
        <tr>
          <td class="lbl">शाळा सोडल्याचे कारण</td>
          <td class="sep">–</td>
          <td class="val">${g('lc_stxt64')||''}</td>
        </tr>
        <tr>
          <td class="lbl">शेरा</td>
          <td class="sep">–</td>
          <td class="val">सदर दाखल्यात कोणतीही खाडा-खोड नाही.</td>
        </tr>
      </table>
      <div style="font-family:'Noto Serif Devanagari',serif;font-size:8pt;margin:3mm 0;text-align:justify">
        दाखला देण्यात येतो की, वरील माहिती शाळेतील जनरल रजि. बुक नं. <b>____</b> वरील रजि. क्र. <b>${regNo||'____'}</b> प्रमाणे आहे.
      </div>
      <div class="cert-footer-line">
        <div>
          <div>दिनांक - ${today}</div>
          <div style="margin-top:1mm">स्थळ – पाचोरा</div>
        </div>
        <div style="text-align:center">
          <div class="cert-sig-line">लेखनिक</div>
        </div>
        <div style="text-align:center">
          <div class="cert-sig-line">स्वाक्षरी/शिक्का</div>
        </div>
      </div>
    </div>
  </div>`;

  openCert('📋 शाळा सोडल्याचा दाखला (LC)', html, 'a4');
}

// ===== BONAFIDE CERTIFICATE — A4, NO BORDERS =====
function showBFCert() {
  function g(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  var fn = g('bf_stxt11');
  var fullName = fn;
  var gender = g('bf_stxt___gender') || '';
  var title = (gender === 'Female') ? 'कुमारी' : 'कुमार';
  var titleEn = (gender === 'Female') ? 'Miss' : 'Mr.';
  var tya = (gender === 'Female') ? 'तिची' : 'त्याची';
  var ti = (gender === 'Female') ? 'ती' : 'तो';
  var pronounEn = (gender === 'Female') ? 'she' : 'he';
  var iyatta = classToMr(g('bf_stxt7'));
  var tukdi = g('bf_stxt8');
  var acYear = g('bf_stxt2');
  var caste = g('bf_stxt17') || '';
  var religion = g('bf_stxt16') || '';
  var casteStr = religion + (religion&&caste?' ':'') + caste;
  var dob = fmtDate(g('bf_stxt19'));
  var dobWords = g('bf_stxt20');
  var bhumi = g('bf_stxt___birthVillage')||'';
  var certNo = g('bf_stxt___certNo') || '';
  var regNo = g('bf_stxt1');
  var penNo = g('bf_stxt___pen');
  var today = todayDate();
  var lang = g('bf_lang') || 'mr';
  var purpose = g('bf_stxt3');
  var remarks = g('bf_stxt6');

  var qrBox = '<div id="certQrBox" style="position:absolute;top:8mm;right:9mm;width:22mm;text-align:center;z-index:6"></div>';

  var htmlMr = `
  <div class="cert-page a4-noborder">
    ${!certNo ? '<div class="cert-draft-watermark"><span>DRAFT</span></div>' : ''}
    ${qrBox}
    <div class="cert-outer-border">
      <div style="text-align:center;font-family:'Noto Sans Devanagari',sans-serif;font-size:7.5pt;color:#555;margin-bottom:1mm">
        पाचोरा तालुका सहकारी शिक्षण संस्था संचलित,
      </div>
      <div style="text-align:center;font-family:'Noto Serif Devanagari',serif;font-size:16pt;font-weight:900;color:#111;line-height:1.2">
        श्री.गोविंदराम सेक्सरिया हायस्कूल, पाचोरा
      </div>
      <div style="text-align:center;font-family:'Noto Serif Devanagari',serif;font-size:10pt;font-weight:900;color:#111;line-height:1.2">
        <span><b>UDISE - 27031201718</b></span>
      </div>

      <hr class="cert-divider" style="margin:2mm 0">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:8.5pt;font-family:'Noto Sans Devanagari',sans-serif;margin:1.5mm 0 2mm">
        <div>
          <div>रजि. क्र. <b>${regNo||''}</b></div>
          ${penNo ? `<div>PEN : <b>${penNo}</b></div>` : ''}
        </div>
        <div style="text-align:right">
          <div>दिनांक : <b>${fmtDate(g('bf_stxt57'))||today}</b></div>
          ${certNo ? `<div>बोनाफाईड क्र. <b>${certNo}</b></div>` : ''}
        </div>
      </div>

      <div style="text-align:center;margin:3mm 0">
        <div style="font-family:'Noto Serif Devanagari',serif;font-size:12pt;font-weight:700;color:#111">
          दाखला (बोनाफाईड सर्टिफिकेट)
        </div>
      </div>

      <p style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
      ${title} <b style="font-weight:700">${fullName}</b> यांना दाखला देण्यात येतो की, सदर विद्यार्थी ${ti} आमच्या विद्यालयात सन <b style="font-weight:700">${acYear||'___'}</b> या वर्षी इयत्ता- <b style="font-weight:700">${iyatta}</b> तुकडी – <b style="font-weight:700">${tukdi||'_'}</b> मध्ये शिकत आहे.
      </p>

      <p style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        शालेय रेकॉर्ड प्रमाणे सदर विद्यार्थ्याची जात – <b style="font-weight:700">${casteStr||'___'}</b> असून जन्म दिनांक – <b style="font-weight:700">${dob||'___'}</b> (<b style="font-weight:700">${dobWords||'___'}</b>) अशी आहे. शालेय रेकॉर्ड प्रमाणे ${tya} जन्मस्थळ – <b style="font-weight:700">${bhumi||'___'}</b>.
      </p>

      <p style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        सदर विद्यार्थ्याची शाळेत शिकत असतांना ${tya} वर्तवणूक चांगली आहे. सदरचा दाखला हा शाळेच्या संबंधित रजिष्टर वरून व अर्जदाराने केलेल्या अर्जावरून दिला आहे.
      </p>

      ${purpose ? `<div style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">उद्देश : <b style="font-weight:700">${purpose}</b></div>` : ''}
      ${remarks ? `<div style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">शेरा : <b style="font-weight:700">${remarks}</b></div>` : ''}

      <div class="cert-footer-line" style="margin-top:5mm">
        <div>
          <div><b>स्थळ – पाचोरा</b></div>
          <div style="margin-top:2mm"><b>दिनांक – ${today}</b></div>
        </div>
        <div style="text-align:center">
          <div style="width:55mm;border-top:1px solid #000;padding-top:1mm;font-size:7.5pt;font-family:'Noto Sans Devanagari',sans-serif">मुख्याध्यापक/प्राचार्य</div>
        </div>
      </div>
    </div>
  </div>`;

  var htmlEn = `
  <div class="cert-page a4-noborder">
    ${!certNo ? '<div class="cert-draft-watermark"><span>DRAFT</span></div>' : ''}
    ${qrBox}
    <div class="cert-outer-border">
      <div style="text-align:center;font-family:'Poppins',sans-serif;font-size:7.5pt;color:#555;margin-bottom:1mm">
        Pachora Taluka Sahakari Shikshan Sanstha, Run by
      </div>
      <div style="text-align:center;font-family:'Poppins',sans-serif;font-size:16pt;font-weight:900;color:#111;line-height:1.2">
        SHRI GOVINDRAM SEKSARIA HIGH SCHOOL, PACHORA
      </div>
      <div style="text-align:center;font-family:'Poppins',sans-serif;font-size:10pt;font-weight:900;color:#111;line-height:1.2">
        <span><b>UDISE - 27031201718</b></span>
      </div>

      <hr class="cert-divider" style="margin:2mm 0">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:8.5pt;font-family:'Poppins',sans-serif;margin:1.5mm 0 2mm">
        <div>
          <div>Reg. No. <b>${regNo||''}</b></div>
          ${penNo ? `<div>PEN : <b>${penNo}</b></div>` : ''}
        </div>
        <div style="text-align:right">
          <div>Date : <b>${fmtDate(g('bf_stxt57'))||today}</b></div>
          ${certNo ? `<div>Bonafide No. <b>${certNo}</b></div>` : ''}
        </div>
      </div>

      <div style="text-align:center;margin:3mm 0">
        <div style="font-family:'Poppins',sans-serif;font-size:12pt;font-weight:700;color:#111">
          BONAFIDE CERTIFICATE
        </div>
      </div>

      <p style="font-family:'Poppins',sans-serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
      This is to certify that ${titleEn} <b style="font-weight:700">${fullName}</b> is a bonafide student of this school and is studying in Std. <b style="font-weight:700">${iyatta}</b>, Division <b style="font-weight:700">${tukdi||'_'}</b> during the academic year <b style="font-weight:700">${acYear||'___'}</b>.
      </p>

      <p style="font-family:'Poppins',sans-serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        As per school records, ${pronounEn} belongs to <b style="font-weight:700">${casteStr||'___'}</b> community, and ${pronounEn === 'she' ? 'her' : 'his'} date of birth is <b style="font-weight:700">${dob||'___'}</b> (<b style="font-weight:700">${dobWords||'___'}</b>). Place of birth as per records is <b style="font-weight:700">${bhumi||'___'}</b>.
      </p>

      <p style="font-family:'Poppins',sans-serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        ${pronounEn === 'she' ? 'Her' : 'His'} conduct during the period of study has been good. This certificate is issued based on school records and on the applicant's request.
      </p>

      ${purpose ? `<div style="font-family:'Poppins',sans-serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">Purpose : <b style="font-weight:700">${purpose}</b></div>` : ''}
      ${remarks ? `<div style="font-family:'Poppins',sans-serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">Remarks : <b style="font-weight:700">${remarks}</b></div>` : ''}

      <div class="cert-footer-line" style="margin-top:5mm">
        <div>
          <div><b>Place – Pachora</b></div>
          <div style="margin-top:2mm"><b>Date – ${today}</b></div>
        </div>
        <div style="text-align:center">
          <div style="width:55mm;border-top:1px solid #000;padding-top:1mm;font-size:7.5pt;font-family:'Poppins',sans-serif">Headmaster/Principal</div>
        </div>
      </div>
    </div>
  </div>`;

  openCert(lang === 'en' ? '📄 Bonafide Certificate' : '📄 बोनाफाईड सर्टिफिकेट', lang === 'en' ? htmlEn : htmlMr, 'a4');
  var qrDataBF = certNo ? { type:'BF', serial:certNo, regNo:regNo, name:fullName, date:today, url:(getUrl() + '?action=verify&type=BF&serial=' + encodeURIComponent(certNo)) } : null;
  setTimeout(function(){ renderCertQR(qrDataBF); }, 60);
}

// ===== ATTENDANCE CERTIFICATE — A4, NO BORDERS =====
function showATCert() {
  function g(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  var fn = g('at_stxt11');
  var fullName = fn;
  var gender = g('at_stxt15');
  var title = (gender === 'Female') ? 'कुमारी' : 'कुमार';
  var ti = (gender === 'Female') ? 'ती' : 'तो';
  var tya = (gender === 'Female') ? 'तिची' : 'त्याची';
  var tyas = (gender === 'Female') ? 'तिची' : 'त्याची';
  var tyala = (gender === 'Female') ? 'तिला' : 'त्याला';
  var titleEn = (gender === 'Female') ? 'Miss' : 'Mr.';
  var pronounEn = (gender === 'Female') ? 'she' : 'he';
  var possEn = (gender === 'Female') ? 'her' : 'his';
  var iyatta = classToMr(g('at_stxt7'));
  var tukdi = g('at_stxt8');
  var acYear = g('at_stxt2');
  var totalDays = g('at_stxt16');
  var presentDays = g('at_stxt17');
  var pct = document.getElementById('at_pct') ? document.getElementById('at_pct').value : '';
  var fromDate = fmtDate(g('at_stxt5'));
  var toDate = fmtDate(g('at_stxt6'));
  var certNo = g('at_stxt___certNo') || 'o';
  var regNo = g('at_stxt1');
  var penNo = g('at_stxt___pen');
  var today = todayDate();
  var lang = g('at_lang') || 'mr';
  var purpose = g('at_stxt3');
  var remarks = g('at_stxt14');
  var isSaved = certNo && certNo !== 'o';

  var qrBox = '<div id="certQrBox" style="position:absolute;top:8mm;right:9mm;width:22mm;text-align:center;z-index:6"></div>';

  var htmlMr = `
  <div class="cert-page a4-noborder">
    ${!isSaved ? '<div class="cert-draft-watermark"><span>DRAFT</span></div>' : ''}
    ${qrBox}
    <div class="cert-outer-border">
      <div style="text-align:center;font-family:'Noto Sans Devanagari',sans-serif;font-size:7.5pt;color:#555;margin-bottom:1mm">
        पाचोरा तालुका सहकारी शिक्षण संस्था संचलित,
      </div>
      <div style="text-align:center;font-family:'Noto Serif Devanagari',serif;font-size:16pt;font-weight:900;color:#111;line-height:1.2">
        श्री.गोविंदराम सेक्सरिया हायस्कूल, पाचोरा
      </div>
      <div style="text-align:center;font-family:'Noto Serif Devanagari',serif;font-size:10pt;font-weight:900;color:#111;line-height:1.2">
        <span><b>UDISE - 27031201718</b></span>
      </div>
      <hr class="cert-divider" style="margin:2mm 0">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:8.5pt;font-family:'Noto Sans Devanagari',sans-serif;margin:1.5mm 0 2mm">
        <div>
          <div>रजि. क्र. <b>${regNo||''}</b></div>
          ${penNo ? `<div>PEN : <b>${penNo}</b></div>` : ''}
        </div>
        <div style="text-align:right">
          <div>दिनांक : <b>${today}</b></div>
          ${isSaved ? `<div>उपस्थिती क्र. <b>${certNo}</b></div>` : ''}
        </div>
      </div>

      <div style="text-align:center;margin:3mm 0">
        <div style="font-family:'Noto Serif Devanagari',serif;font-size:12pt;font-weight:700;color:#111">
          उपस्थिती दाखला
        </div>
      </div>

      <p style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        ${title} <b style="font-weight:700">${fullName}</b> यांना सदर उपस्थिती दाखला देण्यात येतो की, आमच्या शाळेतील विद्यार्थी नामे <b style="font-weight:700">${fullName}</b> ${ti} विद्यार्थी शैक्षणिक वर्ष सन - <b style="font-weight:700">${acYear||'___'}</b> मध्ये इयत्ता - <b style="font-weight:700">${iyatta}</b> तुकडी - <b style="font-weight:700">${tukdi||'_'}</b> मध्ये शिकत आहे.
      </p>

      <p style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        ${fromDate && toDate ? `कालावधी <b style="font-weight:700">${fromDate}</b> ते <b style="font-weight:700">${toDate}</b> मध्ये ` : ''}${totalDays ? `एकूण कामकाजाचे दिवस <b style="font-weight:700">${totalDays}</b> पैकी ` : ''}${presentDays ? `${tya} उपस्थित दिवस <b style="font-weight:700">${presentDays}</b> होते.` : ''}${pct ? ` तरी ${tyas} उपस्थिती ही एकूण <b style="font-weight:700">${pct}</b> होती.` : ''}
        सदर दाखला हा पालकांच्या विनंती नुसार देण्यात आला आहे.
      </p>

      ${purpose ? `<div style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">उद्देश : <b style="font-weight:700">${purpose}</b></div>` : ''}
      ${remarks ? `<div style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">शेरा : <b style="font-weight:700">${remarks}</b></div>` : ''}

      <div class="cert-footer-line" style="margin-top:5mm">
        <div>
          <div><b>स्थळ – पाचोरा</b></div>
        </div>
        <div style="text-align:center">
          <div style="width:55mm;border-top:1px solid #000;padding-top:1mm;font-size:7.5pt;font-family:'Noto Sans Devanagari',sans-serif">मुख्याध्यापक/प्राचार्य</div>
        </div>
      </div>
    </div>
  </div>`;

  var htmlEn = `
  <div class="cert-page a4-noborder">
    ${!isSaved ? '<div class="cert-draft-watermark"><span>DRAFT</span></div>' : ''}
    ${qrBox}
    <div class="cert-outer-border">
      <div style="text-align:center;font-family:'Poppins',sans-serif;font-size:7.5pt;color:#555;margin-bottom:1mm">
        Pachora Taluka Sahakari Shikshan Sanstha, Run by
      </div>
      <div style="text-align:center;font-family:'Poppins',sans-serif;font-size:16pt;font-weight:900;color:#111;line-height:1.2">
        SHRI GOVINDRAM SEKSARIA HIGH SCHOOL, PACHORA
      </div>
      <div style="text-align:center;font-family:'Poppins',sans-serif;font-size:10pt;font-weight:900;color:#111;line-height:1.2">
        <span><b>UDISE - 27031201718</b></span>
      </div>
      <hr class="cert-divider" style="margin:2mm 0">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;font-size:8.5pt;font-family:'Poppins',sans-serif;margin:1.5mm 0 2mm">
        <div>
          <div>Reg. No. <b>${regNo||''}</b></div>
          ${penNo ? `<div>PEN : <b>${penNo}</b></div>` : ''}
        </div>
        <div style="text-align:right">
          <div>Date : <b>${today}</b></div>
          ${isSaved ? `<div>Attendance No. <b>${certNo}</b></div>` : ''}
        </div>
      </div>

      <div style="text-align:center;margin:3mm 0">
        <div style="font-family:'Poppins',sans-serif;font-size:12pt;font-weight:700;color:#111">
          ATTENDANCE CERTIFICATE
        </div>
      </div>

      <p style="font-family:'Poppins',sans-serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        This is to certify that ${titleEn} <b style="font-weight:700">${fullName}</b>, a student of this school, is studying in Std. <b style="font-weight:700">${iyatta}</b>, Division <b style="font-weight:700">${tukdi||'_'}</b> during the academic year <b style="font-weight:700">${acYear||'___'}</b>.
      </p>

      <p style="font-family:'Poppins',sans-serif;font-size:11pt;line-height:1.9;font-weight:400;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        ${fromDate && toDate ? `During the period from <b style="font-weight:700">${fromDate}</b> to <b style="font-weight:700">${toDate}</b>, ` : ''}${totalDays ? `out of <b style="font-weight:700">${totalDays}</b> total working days, ` : ''}${presentDays ? `${pronounEn} was present for <b style="font-weight:700">${presentDays}</b> days.` : ''}${pct ? ` Overall attendance was <b style="font-weight:700">${pct}</b>.` : ''}
        This certificate is issued at the request of the parent/guardian.
      </p>

      ${purpose ? `<div style="font-family:'Poppins',sans-serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">Purpose : <b style="font-weight:700">${purpose}</b></div>` : ''}
      ${remarks ? `<div style="font-family:'Poppins',sans-serif;font-size:11pt;font-weight:400;background:#f9f6f1;padding:2mm 3mm;margin:2mm 0;color:#333">Remarks : <b style="font-weight:700">${remarks}</b></div>` : ''}

      <div class="cert-footer-line" style="margin-top:5mm">
        <div>
          <div><b>Place – Pachora</b></div>
        </div>
        <div style="text-align:center">
          <div style="width:55mm;border-top:1px solid #000;padding-top:1mm;font-size:7.5pt;font-family:'Poppins',sans-serif">Headmaster/Principal</div>
        </div>
      </div>
    </div>
  </div>`;

  openCert(lang === 'en' ? '✅ Attendance Certificate' : '✅ उपस्थिती दाखला', lang === 'en' ? htmlEn : htmlMr, 'a4');
  var qrDataAT = isSaved ? { type:'AT', serial:certNo, regNo:regNo, name:fullName, date:today, url:(getUrl() + '?action=verify&type=AT&serial=' + encodeURIComponent(certNo)) } : null;
  setTimeout(function(){ renderCertQR(qrDataAT); }, 60);
}

// PDF helpers
function pdfDoc(){
  return new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
}
function pdfHdr(doc,title){
  doc.setFillColor(26,42,74); doc.rect(0,0,210,297,'F');
  doc.setFillColor(34,50,98); doc.rect(0,0,210,34,'F');
  doc.setDrawColor(212,144,42); doc.setLineWidth(0.8); doc.line(0,34,210,34);
  doc.setTextColor(212,144,42); doc.setFontSize(13); doc.setFont('helvetica','bold');
  doc.text('Shri. Govindrao Sakseria High School, Pachora',105,13,{align:'center'});
  doc.setFontSize(8.5); doc.setTextColor(220,200,170); doc.text(title,105,21,{align:'center'});
  doc.setFontSize(7.5); doc.setTextColor(180,160,130);
  doc.text('Date: '+todayDate(),105,28,{align:'center'});
}
function pdfF(doc,lbl,val,x,y,w){
  doc.setFillColor(253,240,230); doc.setDrawColor(180,140,100); doc.setLineWidth(0.25);
  doc.roundedRect(x,y,w,9,1,1,'FD');
  doc.setTextColor(120,80,40); doc.setFontSize(5.5); doc.setFont('helvetica','normal');
  doc.text(lbl,x+2,y+3.5);
  doc.setTextColor(30,10,5); doc.setFontSize(7.5); doc.setFont('helvetica','bold');
  doc.text(String(val||''),x+2,y+7.5,{maxWidth:w-4});
}
function pdfSec(doc,title,y){
  doc.setDrawColor(212,144,42); doc.setLineWidth(0.35); doc.line(10,y,200,y);
  doc.setTextColor(212,144,42); doc.setFontSize(7); doc.setFont('helvetica','bold');
  doc.text(title,10,y-0.8); return y+4;
}
function pdfFoot(doc){
  doc.setDrawColor(212,144,42); doc.line(10,275,200,275);
  doc.setTextColor(180,150,100); doc.setFontSize(6.5);
  doc.text('Shri. Govindrao Sakseria High School, Pachora | Software Development by Tonape sir (SGS Highschool, Pachora)',105,280,{align:'center'});
}

function exportStudentPDF(){
  if(!requireMaster('s')) return;
  var d=collectStudent();
  var doc=pdfDoc(); pdfHdr(doc,'Student Information Sheet');
  var y=38;
  y=pdfSec(doc,'IDENTIFICATION',y);
  pdfF(doc,'Student ID',d.studentId,10,y,60); pdfF(doc,'Reg No',d.regNo,73,y,40);
  pdfF(doc,'Aadhar',d.aadhar,116,y,55); pdfF(doc,'Gender',d.gender,174,y,26); y+=12;
  pdfF(doc,'PEN',d.pen,10,y,60); pdfF(doc,'Class',d.iyatta,73,y,30);
  pdfF(doc,'Div',d.tukdi,106,y,25); pdfF(doc,'Roll No',d.rollNo,134,y,35);
  pdfF(doc,'Year',d.acYear,172,y,28); y+=14;
  y=pdfSec(doc,'NAME',y);
  pdfF(doc,'Full Name',d.firstName,10,y,190); y+=12;
  pdfF(doc,'Mother Name',d.motherName,10,y,65); pdfF(doc,'Religion',d.religion,78,y,40);
  pdfF(doc,'Caste',d.caste,121,y,40); pdfF(doc,'Sub-caste',d.subcaste,164,y,36); y+=14;
  y=pdfSec(doc,'BIRTH DETAILS',y);
  pdfF(doc,'DOB',fmtDate(d.dob),10,y,50); pdfF(doc,'Nationality',d.nationality,63,y,45);
  pdfF(doc,'Mother Tongue',d.motherTongue,111,y,45); y+=12;
  pdfF(doc,'DOB in Words',d.dobWords,10,y,190); y+=12;
  pdfF(doc,'Birth Place',d.birthVillage,10,y,190); y+=12;
  y=pdfSec(doc,'ADMISSION',y);
  pdfF(doc,'Adm Date',fmtDate(d.admissionDate),10,y,60); pdfF(doc,'Adm Class',d.admissionClass,73,y,45);
  pdfF(doc,'Prev School',d.prevSchool,121,y,89); y+=12;
  pdfF(doc,'Contact',d.contact,10,y,50); pdfF(doc,'Address',d.address,63,y,137);
  pdfFoot(doc);
  doc.save((d.firstName||'Student').replace(/\s+/g,'_')+'_Info.pdf');
}

function exportLCPDF() {
  if(!requireMaster('lc')) return;
  showLCCert();
  setTimeout(function(){
    var reg = ((document.getElementById('lc_stxt1')||{}).value||'').replace(/[^a-zA-Z0-9]/g,'');
    var d = new Date(); var dt = d.getFullYear()+('0'+(d.getMonth()+1)).slice(-2)+('0'+d.getDate()).slice(-2);
    exportCertAsPDF('LC_' + reg + '_' + dt + '.pdf');
  }, 600);
}
function exportBFPDF() {
  if(!canUsePage('bonafide')) { showStatus('bf','⚠️ या user ला Bonafide PDF अधिकार नाही.','err'); return; }
  showBFCert();
  setTimeout(function(){
    var reg = ((document.getElementById('bf_stxt1')||{}).value||'').replace(/[^a-zA-Z0-9]/g,'');
    var d = new Date(); var dt = d.getFullYear()+('0'+(d.getMonth()+1)).slice(-2)+('0'+d.getDate()).slice(-2);
    exportCertAsPDF('BF_' + reg + '_' + dt + '.pdf');
  }, 600);
}
function exportATPDF() {
  if(!canUsePage('attendance')) { showStatus('at','⚠️ या user ला Attendance PDF अधिकार नाही.','err'); return; }
  showATCert();
  setTimeout(function(){
    var reg = ((document.getElementById('at_stxt1')||{}).value||'').replace(/[^a-zA-Z0-9]/g,'');
    var d = new Date(); var dt = d.getFullYear()+('0'+(d.getMonth()+1)).slice(-2)+('0'+d.getDate()).slice(-2);
    exportCertAsPDF('AT_' + reg + '_' + dt + '.pdf');
  }, 600);
}
</script>

<!-- ===== APPS SCRIPT (expand to copy) ===== -->
<details class="master-only" style="display:none !important;max-width:1200px;margin:16px auto;background:rgba(26,42,74,.9);border:1px solid rgba(212,144,42,.4);border-radius:10px;padding:16px;color:#c8d8f0;font-size:12px">
<summary style="cursor:pointer;color:#e8b05a;font-weight:700;font-size:13px">⚙️ Google Apps Script Code — Click to Expand & Copy</summary>
<button onclick="var p=document.getElementById('appsScriptCode'),b=this;p.style.display=p.style.display==='none'?'block':'none';b.textContent=p.style.display==='none'?'🔽 Apps Script Code दाखवा':'🔼 Apps Script Code लपवा';" style="background:#1a3a6a;color:#a0d0ff;border:none;border-radius:5px;padding:6px 14px;cursor:pointer;font-size:12px;margin:8px 0 4px;display:block">🔽 Apps Script Code दाखवा</button>
<pre id="appsScriptCode" style="background:#0d1b35;padding:14px;border-radius:6px;margin-top:4px;overflow-x:auto;font-size:11px;color:#a0d0ff;white-space:pre-wrap;display:none">
var MAIN_HEADERS = [
  "Timestamp","Acad Year","Reg No","Student ID","Book No","Aadhar",
  "Class","Division","PEN","Roll No","Full Name",
  "Mother Name","Gender","Religion","Caste","Sub-caste","DOB","DOB Words",
  "Nationality","Mother Tongue","Birth Place",
  "Previous School","Admission Date","Admission Class",
  "Contact","Address","Photo URL"
];
var LC_HEADERS = [
  "Timestamp","Serial No","Student ID","Full Name","Gender",
  "DOB","DOB Words","Class","Religion","Caste","Nationality","Mother Tongue",
  "Admission Date","Admission Class","Leave Date","Leave Class","Class Start Date",
  "LC No","LC Date","Conduct","Progress","Stxt75","Stxt76","Remarks",
  "Medium","Next School","LC Count","Fee Status","Stxt60","Stxt61",
  "Stxt62","Stxt63","Stxt67","Stxt68","Stxt69","Stxt70","Nationality Type"
];
var BF_HEADERS = [
  "Timestamp","Serial No","Student ID","Full Name",
  "DOB","DOB Words","Class","Tukdi","Religion","Caste","Nationality",
  "Acad Year","BF Date","Purpose","Admission Date","Admission Class",
  "Remarks","Address","Contact"
];
var AT_HEADERS = [
  "Timestamp","Serial No","Student ID","Full Name","Gender",
  "DOB","Class","Tukdi","Acad Year","AT Date","Purpose",
  "Total Days","Present Days","Percentage","From Date","To Date","Remarks"
];
var PHOTO_FOLDER_ID = "1urIudSUS7U0ClMTjvp__uZ0ZgTQ7GrbU";

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  } else {
    var existing = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
    for (var i = 0; i &lt; headers.length; i++) {
      if (!existing[i]) sh.getRange(1, i + 1).setValue(headers[i]);
    }
  }
  return sh;
}

function findRowByKey(sh, col, key) {
  key = (key || "").toString().trim().toLowerCase();
  if (!key || !sh || sh.getLastRow() &lt; 2) return 0;
  var vals = sh.getRange(2, col, sh.getLastRow()-1, 1).getValues();
  for (var i=0; i&lt;vals.length; i++) {
    if ((vals[i][0] || "").toString().trim().toLowerCase() === key) return i + 2;
  }
  return 0;
}

function writeRow(sh, rowNum, row) {
  if (rowNum) {
    sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
    return {rowIndex: rowNum, mode: "updated"};
  }
  sh.appendRow(row);
  return {rowIndex: sh.getLastRow(), mode: "created"};
}

function doPost(e) {
  var p = e.parameter || {};
  if (p.action === "uploadPhoto") {
    var photoResult = handlePhotoUpload(p);
    return ContentService.createTextOutput(JSON.stringify(photoResult))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return handleAction(p, ""); // "" = JSON response — serial परत frontend ला येतो
}

function doGet(e) {
  var p = e.parameter || {};
  var cb = p.callback || "";
  if (!p.action &amp;&amp; (p.regNo || p.studentId || p.firstName)) p.action = "upsert";
  if (p.action === "verify") {
    return doVerifyPage(p);
  }
  if (p.action === "ping") {
    try {
      var ssName = SpreadsheetApp.getActiveSpreadsheet().getName();
      return wrap(cb, {status:"ok", message:"Connected! Sheet: " + ssName});
    } catch(ex) {
      return wrap(cb, {status:"error", message:"Script is deployed but NOT BOUND to a Sheet! Re-deploy from inside the Sheet."});
    }
  }
  if (p.action === "getAll") {
    return doGetAllAction(p, cb);
  }
  if (p.action === "testPhotoFolder") {
    return wrap(cb, testPhotoFolderAccess());
  }
  if (p.action === "photoChunkStart") {
    return wrap(cb, startPhotoChunkUpload(p));
  }
  if (p.action === "photoChunk") {
    return wrap(cb, savePhotoChunk(p));
  }
  if (p.action === "photoChunkFinish") {
    return wrap(cb, finishPhotoChunkUpload(p));
  }
  if (p.action === "getPhotoUrl" &amp;&amp; p.regNo) {
    return wrap(cb, getPhotoUrlByRegNo(p.regNo));
  }
  if (p.action === "search" &amp;&amp; p.q) {
    return doSearchAction(p, cb);
  }
  if (p.action === "getDashboardStats") {
    return doGetDashboardStats(p, cb);
  }
  if (p.action === "getStudentHistory") {
    return doGetStudentHistory(p, cb);
  }
  if (p.action === "getAllCertificates") {
    return doGetAllCertificates(p, cb);
  }
  if (p.action === "getUsers") {
    return doGetUsers(p, cb);
  }
  if (p.action === "saveUser") {
    return doSaveUser(p, cb);
  }
  if (p.action === "deleteUser") {
    return doDeleteUser(p, cb);
  }
  if (p.action === "changePassword") {
    return doChangePassword(p, cb);
  }
  if (p.action === "getAnalyticsData") {
    return doGetAnalyticsData(p, cb);
  }
  if (p.action === "verify") {
    return doVerifyPage(p);
  }
  var a = p.action || "";
  if (a.indexOf("save") === 0 || a.indexOf("upsert") === 0 ||
      a.indexOf("update") === 0) {
    return handleAction(p, cb);
  }
  return wrap(cb, {status:"ok", message:"Running!"});
}

function getNextSerial(sh) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 1;
  var vals = sh.getRange(2, 2, lastRow - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var n = parseInt(vals[i][0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

function handleAction(d, cb) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return wrap(cb, {status:"error", message:"Script NOT bound to a Sheet. Open Sheet → Extensions → Apps Script."});
    var action = d.action || "upsert";
    var result = {rowIndex:0, mode:"created"};

    if (action === "save" || action === "update" || action === "upsert") {
      var sh = getOrCreateSheet("Students", MAIN_HEADERS);
      var row = [new Date().toLocaleString("en-IN"),
        d.acYear,d.regNo,d.studentId,d.bookNo,d.aadhar,d.iyatta,d.tukdi,
        d.pen,d.rollNo,d.firstName,d.motherName,d.gender,
        d.religion,d.caste,d.subcaste,d.dob,d.dobWords,d.nationality,d.motherTongue,
        d.birthVillage,d.prevSchool,
        d.admissionDate,d.admissionClass,d.contact,d.address,d.photoUrl];
      var rowToWrite = 0;
      if (action === "update" &amp;&amp; d.rowIndex) rowToWrite = parseInt(d.rowIndex,10);
      if (action === "upsert") rowToWrite = findRowByKey(sh, 3, d.regNo) || findRowByKey(sh, 4, d.studentId);
      result = writeRow(sh, rowToWrite, row);
    } else if (action === "save_lc" || action === "update_lc" || action === "upsert_lc") {
      var sh = getOrCreateSheet("LC", LC_HEADERS);
      // ✅ सदैव नवीन row — प्रत्येक LC ला स्वतंत्र serial नंबर
      var rowToWrite = 0;
      var lcSerial = getNextSerial(sh);
      var row = [new Date().toLocaleString("en-IN"),
        lcSerial,d.stxt1,d.firstName,d.gender,d.dob,d.dobWords,
        d.iyatta,d.religion,d.caste,d.nationality,d.motherTongue,
        d.admissionDate,d.admissionClass,d.lcLeaveDate,d.lcLeaveClass,d.classStartDate,
        d.lcNo,d.lcDate,d.conduct,d.progress,d.stxt75,d.stxt76,d.remarks,
        d.medium,d.nextSchool,d.lcCount,d.feeStatus,
        d.stxt60,d.stxt61,d.stxt62,d.stxt63,d.stxt67,d.stxt68,d.stxt69,d.stxt70,d.nationalityType];
      result = writeRow(sh, rowToWrite, row);
      result.serial = lcSerial;
    } else if (action === "save_bf" || action === "upsert_bf") {
      var sh = getOrCreateSheet("Bonafide", BF_HEADERS);
      // ✅ सदैव नवीन row — प्रत्येक Bonafide ला स्वतंत्र serial नंबर
      var rowToWrite = 0;
      var bfSerial = getNextSerial(sh);
      var row = [new Date().toLocaleString("en-IN"),
        bfSerial,d.stxt1,d.firstName,d.dob,d.dobWords,
        d.iyatta,d.tukdi,d.religion,d.caste,d.nationality,
        d.acYear,d.bfDate,d.purpose,d.admissionDate,d.admissionClass,
        d.remarks,d.address,d.contact];
      result = writeRow(sh, rowToWrite, row);
      result.serial = bfSerial;
    } else if (action === "save_at" || action === "upsert_at") {
      var sh = getOrCreateSheet("Attendance", AT_HEADERS);
      // ✅ सदैव नवीन row — प्रत्येक Attendance certificate ला स्वतंत्र serial नंबर
      var rowToWrite = 0;
      var atSerial = getNextSerial(sh);
      var row = [new Date().toLocaleString("en-IN"),
        atSerial,d.stxt1,d.firstName,d.gender,d.dob,
        d.iyatta,d.tukdi,d.acYear,d.atDate,d.purpose,
        d.totalDays,d.presentDays,d.pct,d.fromDate,d.toDate,d.remarks];
      result = writeRow(sh, rowToWrite, row);
      result.serial = atSerial;
    } else {
      return wrap(cb, {status:"error", message:"Unknown action: "+action});
    }
    logAudit(d.auditUser, d.auditRole, action, result.serial || d.regNo || d.stxt1 || "");
    return wrap(cb, {status:"ok", rowIndex:result.rowIndex, action:action, mode:result.mode, serial:result.serial||""});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

// ===== AUDIT LOG (V19.8) — कोणत्या User ने कधी काय Save केले =====
function logAudit(user, role, action, refInfo) {
  try {
    var sh = getOrCreateSheet("Log", ["Timestamp","User","Role","Action","Reference"]);
    sh.appendRow([new Date().toLocaleString("en-IN"), user || "unknown", role || "", action || "", refInfo || ""]);
  } catch(e) {
    // Logging failure should never block the main save operation
  }
}

// ===== DASHBOARD LIVE STATS (V19.8) =====
function doGetDashboardStats(p, cb) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var todayStr = fmt(new Date());
    var now = new Date();
    var monthKey = now.getFullYear() + "-" + ("0"+(now.getMonth()+1)).slice(-2);

    var stSh = ss.getSheetByName("Students");
    var totalStudents = 0;
    var classCounts = {};
    if (stSh &amp;&amp; stSh.getLastRow() &gt; 1) {
      var stRows = stSh.getRange(2, 1, stSh.getLastRow()-1, 11).getValues();
      for (var i=0;i&lt;stRows.length;i++) {
        if (!stRows[i][2] &amp;&amp; !stRows[i][10]) continue;
        totalStudents++;
        var cls = (stRows[i][6]||"").toString().trim();
        if (cls) classCounts[cls] = (classCounts[cls]||0) + 1;
      }
    }

    function countTodayAndMonth(sheetName) {
      var sh = ss.getSheetByName(sheetName);
      var today = 0, month = 0;
      if (sh &amp;&amp; sh.getLastRow() &gt; 1) {
        var rows = sh.getRange(2, 1, sh.getLastRow()-1, 1).getValues();
        for (var i=0;i&lt;rows.length;i++) {
          var ts = rows[i][0];
          if (!ts) continue;
          var d = new Date(ts);
          if (isNaN(d.getTime())) continue;
          var dKey = fmt(d);
          var mKey = d.getFullYear() + "-" + ("0"+(d.getMonth()+1)).slice(-2);
          if (dKey === todayStr) today++;
          if (mKey === monthKey) month++;
        }
      }
      return {today:today, month:month};
    }

    var lcCounts = countTodayAndMonth("LC");
    var bfCounts = countTodayAndMonth("Bonafide");
    var atCounts = countTodayAndMonth("Attendance");
    var monthCerts = lcCounts.month + bfCounts.month + atCounts.month;

    return wrap(cb, {
      status:"ok",
      totalStudents: totalStudents,
      todayLC: lcCounts.today,
      todayBF: bfCounts.today,
      monthCerts: monthCerts,
      classCounts: classCounts
    });
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

// ===== LC/BF/AT HISTORY FOR ONE STUDENT (V19.8) =====
function doGetStudentHistory(p, cb) {
  try {
    var regNo = (p.regNo || "").toString().trim().toLowerCase();
    if (!regNo) return wrap(cb, {status:"error", message:"regNo required"});
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var out = [];

    function scan(sheetName, type, detailFn) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() &lt; 2) return;
      var rows = sh.getRange(2, 1, sh.getLastRow()-1, sh.getLastColumn()).getValues();
      for (var i=0;i&lt;rows.length;i++) {
        var r = rows[i];
        if ((r[2]||"").toString().trim().toLowerCase() !== regNo) continue;
        out.push({
          type: type,
          serial: r[1],
          date: fmt(r[0]),
          detail: detailFn(r)
        });
      }
    }
    scan("LC", "LC", function(r){ return "LC No: " + (r[17]||"—"); });
    scan("Bonafide", "BF", function(r){ return "Purpose: " + (r[13]||"—"); });
    scan("Attendance", "AT", function(r){ return "Purpose: " + (r[10]||"—"); });

    out.sort(function(a,b){ return (a.date &lt; b.date) ? 1 : -1; });
    return wrap(cb, {status:"ok", data: out});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

// ===== BULK EXPORT — ALL LC/BF/AT (V19.8) =====
function doGetAllCertificates(p, cb) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var out = [];

    function scan(sheetName, type, detailFn) {
      var sh = ss.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() &lt; 2) return;
      var rows = sh.getRange(2, 1, sh.getLastRow()-1, sh.getLastColumn()).getValues();
      for (var i=0;i&lt;rows.length;i++) {
        var r = rows[i];
        if (!r[2]) continue;
        out.push({
          type: type,
          serial: r[1],
          date: fmt(r[0]),
          regNo: r[2],
          firstName: r[3],
          detail: detailFn(r)
        });
      }
    }
    scan("LC", "LC", function(r){ return "LC No: " + (r[17]||"—"); });
    scan("Bonafide", "BF", function(r){ return "Purpose: " + (r[13]||"—"); });
    scan("Attendance", "AT", function(r){ return "Purpose: " + (r[10]||"—"); });

    return wrap(cb, {status:"ok", data: out});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

// =====================================================
// 👥 USER MANAGEMENT PRO (V19.9)
// =====================================================
var USER_HEADERS = ["Username","Password","Role","Label"];
var DEFAULT_USERS_SEED = [
  ["user_1","Pass@1234","master","Master User"],
  ["user_2","Pass@1234","deo","DEO User"],
  ["user_3","Pass@1234","cert","Certificate User"]
];

function getUsersSheet() {
  var sh = getOrCreateSheet("Users", USER_HEADERS);
  if (sh.getLastRow() &lt; 2) {
    for (var i=0;i&lt;DEFAULT_USERS_SEED.length;i++) sh.appendRow(DEFAULT_USERS_SEED[i]);
  }
  return sh;
}

function doGetUsers(p, cb) {
  try {
    var sh = getUsersSheet();
    var rows = sh.getRange(2, 1, sh.getLastRow()-1, 4).getValues();
    var out = [];
    for (var i=0;i&lt;rows.length;i++) {
      if (!rows[i][0]) continue;
      out.push({ rowIndex:i+2, username:rows[i][0], password:rows[i][1], role:rows[i][2], label:rows[i][3] });
    }
    return wrap(cb, {status:"ok", data: out});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

function doSaveUser(p, cb) {
  try {
    // फक्त Super Master role असलेल्या logged-in user कडूनच call यायला हवा — frontend कडून व्हॅलिडेशन,
    // तसेच backend मध्येही requesterRole तपासतो
    if (p.requesterRole !== "super") {
      return wrap(cb, {status:"error", message:"User Management अधिकार फक्त Super Master User ला आहे."});
    }
    var sh = getUsersSheet();
    var username = (p.username||"").toString().trim();
    if (!username) return wrap(cb, {status:"error", message:"Username आवश्यक आहे."});
    var rowToWrite = findRowByKey(sh, 1, username);
    var row = [username, p.password||"", p.role||"cert", p.label||username];
    if (rowToWrite) {
      sh.getRange(rowToWrite, 1, 1, 4).setValues([row]);
    } else {
      sh.appendRow(row);
    }
    logAudit(p.requesterUser, p.requesterRole, "saveUser", username);
    return wrap(cb, {status:"ok"});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

function doDeleteUser(p, cb) {
  try {
    if (p.requesterRole !== "super") {
      return wrap(cb, {status:"error", message:"User Management अधिकार फक्त Super Master User ला आहे."});
    }
    var sh = getUsersSheet();
    var username = (p.username||"").toString().trim();
    var rowToWrite = findRowByKey(sh, 1, username);
    if (!rowToWrite) return wrap(cb, {status:"error", message:"User सापडला नाही."});
    sh.deleteRow(rowToWrite);
    logAudit(p.requesterUser, p.requesterRole, "deleteUser", username);
    return wrap(cb, {status:"ok"});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

function doChangePassword(p, cb) {
  try {
    var sh = getUsersSheet();
    var username = (p.username||"").toString().trim();
    var rowToWrite = findRowByKey(sh, 1, username);
    if (!rowToWrite) return wrap(cb, {status:"error", message:"User सापडला नाही."});
    var current = sh.getRange(rowToWrite, 2).getValue();
    if ((current||"").toString() !== (p.oldPassword||"").toString()) {
      return wrap(cb, {status:"error", message:"जुना Password चुकीचा आहे."});
    }
    sh.getRange(rowToWrite, 2).setValue(p.newPassword||"");
    logAudit(username, p.requesterRole, "changePassword", username);
    return wrap(cb, {status:"ok"});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

// =====================================================
// ✅ CERTIFICATE VERIFY PAGE — QR कोड scan केल्यावर उघडणारे पान (V19.9)
// =====================================================
function doVerifyPage(p) {
  var type = (p.type||"").toString().toUpperCase();
  var serial = (p.serial||"").toString().trim();
  var sheetMap = { LC:"LC", BF:"Bonafide", AT:"Attendance" };
  var sheetName = sheetMap[type];
  var found = null;
  try {
    if (sheetName &amp;&amp; serial) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sh = ss.getSheetByName(sheetName);
      if (sh &amp;&amp; sh.getLastRow() &gt; 1) {
        var rows = sh.getRange(2, 1, sh.getLastRow()-1, sh.getLastColumn()).getValues();
        for (var i=0;i&lt;rows.length;i++) {
          if ((rows[i][1]||"").toString() === serial) {
            found = { serial:rows[i][1], regNo:rows[i][2], firstName:rows[i][3], date:fmt(rows[i][0]) };
            break;
          }
        }
      }
    }
  } catch(e) {}

  var html;
  if (found) {
    html = "&lt;div style='font-family:sans-serif;max-width:420px;margin:40px auto;padding:24px;border:2px solid #1a7a3a;border-radius:10px;text-align:center;background:#f4fff4'&gt;"
      + "&lt;div style='font-size:40px'&gt;✅&lt;/div&gt;"
      + "&lt;h2 style='color:#1a7a3a'&gt;Certificate Verified&lt;/h2&gt;"
      + "&lt;p&gt;&lt;b&gt;Type:&lt;/b&gt; " + type + "&lt;/p&gt;"
      + "&lt;p&gt;&lt;b&gt;Serial No:&lt;/b&gt; " + found.serial + "&lt;/p&gt;"
      + "&lt;p&gt;&lt;b&gt;Reg No:&lt;/b&gt; " + found.regNo + "&lt;/p&gt;"
      + "&lt;p&gt;&lt;b&gt;Name:&lt;/b&gt; " + found.firstName + "&lt;/p&gt;"
      + "&lt;p&gt;&lt;b&gt;Date:&lt;/b&gt; " + found.date + "&lt;/p&gt;"
      + "&lt;p style='font-size:12px;color:#666;margin-top:16px'&gt;Shri Govindram Seksaria High School, Pachora&lt;/p&gt;"
      + "&lt;/div&gt;";
  } else {
    html = "&lt;div style='font-family:sans-serif;max-width:420px;margin:40px auto;padding:24px;border:2px solid #7a1a1a;border-radius:10px;text-align:center;background:#fff4f4'&gt;"
      + "&lt;div style='font-size:40px'&gt;❌&lt;/div&gt;"
      + "&lt;h2 style='color:#7a1a1a'&gt;Not Verified&lt;/h2&gt;"
      + "&lt;p&gt;सदर Certificate आमच्या records मध्ये आढळले नाही.&lt;/p&gt;"
      + "&lt;/div&gt;";
  }
  return HtmlService.createHtmlOutput(html);
}

// =====================================================
// 📊 ANALYTICS &amp; REPORTING (V19.9)
// =====================================================
function classifyLcReason(remarks) {
  var t = (remarks||"").toString().toLowerCase();
  if (t.indexOf("बदली") !== -1 || t.indexOf("transfer") !== -1) return "Transfer";
  if (t.indexOf("प्रगती") !== -1 || t.indexOf("progress") !== -1) return "Progress";
  return "Other";
}

function doGetAnalyticsData(p, cb) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var admissionsByYear = {};
    var genderCounts = {};
    var religionCounts = {};
    var casteCounts = {};
    var lcReasonCounts = { Transfer:0, Progress:0, Other:0 };

    var stSh = ss.getSheetByName("Students");
    if (stSh &amp;&amp; stSh.getLastRow() &gt; 1) {
      var rows = stSh.getRange(2, 1, stSh.getLastRow()-1, 26).getValues();
      for (var i=0;i&lt;rows.length;i++) {
        var r = rows[i];
        if (!r[2] &amp;&amp; !r[10]) continue;
        var admDate = r[22];
        if (admDate) {
          var yr = (admDate instanceof Date) ? admDate.getFullYear() : new Date(admDate).getFullYear();
          if (!isNaN(yr)) admissionsByYear[yr] = (admissionsByYear[yr]||0) + 1;
        }
        var gender = (r[12]||"Unknown").toString();
        genderCounts[gender] = (genderCounts[gender]||0) + 1;
        var religion = (r[13]||"Unknown").toString().trim();
        if (religion) religionCounts[religion] = (religionCounts[religion]||0) + 1;
        var caste = (r[14]||"Unknown").toString().trim();
        if (caste) casteCounts[caste] = (casteCounts[caste]||0) + 1;
      }
    }

    var lcSh = ss.getSheetByName("LC");
    if (lcSh &amp;&amp; lcSh.getLastRow() &gt; 1) {
      var lcRows = lcSh.getRange(2, 1, lcSh.getLastRow()-1, 24).getValues();
      for (var j=0;j&lt;lcRows.length;j++) {
        if (!lcRows[j][2]) continue;
        var reason = classifyLcReason(lcRows[j][23]);
        lcReasonCounts[reason] = (lcReasonCounts[reason]||0) + 1;
      }
    }

    return wrap(cb, {
      status:"ok",
      admissionsByYear: admissionsByYear,
      genderCounts: genderCounts,
      religionCounts: religionCounts,
      casteCounts: casteCounts,
      lcReasonCounts: lcReasonCounts
    });
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

function wrap(cb, obj) {
  var json = JSON.stringify(obj);
  if (cb) {
    return ContentService.createTextOutput(cb + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doGetAllAction(p, cb) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Students");
    if (!sh || sh.getLastRow() &lt; 2) return wrap(cb, {status:"ok", data:[]});
    var rows = sh.getRange(2, 1, sh.getLastRow()-1, 27).getValues();
    var all = [];
    for (var i = 0; i &lt; rows.length; i++) {
      var r = rows[i];
      if (!r[10] &amp;&amp; !r[2]) continue; // रिकामी row वगळा
      all.push({
        _rowIndex: i + 2,
        acYear:r[1], regNo:r[2], studentId:r[3], bookNo:r[4], aadhar:r[5],
        iyatta:r[6], tukdi:r[7], pen:r[8], rollNo:r[9],
        firstName:r[10], motherName:r[11], gender:r[12],
        religion:r[13], caste:r[14], subcaste:r[15], dob:fmt(r[16]), dobWords:r[17],
        nationality:r[18], motherTongue:r[19], birthVillage:r[20],
        prevSchool:r[21], admissionDate:fmt(r[22]), admissionClass:r[23],
        contact:r[24], address:r[25], photoUrl:r[26]
      });
    }
    return wrap(cb, {status:"ok", data:all});
  } catch(err) {
    return wrap(cb, {status:"error", message:err.toString()});
  }
}

function doSearchAction(p, cb) {
  try {
    var q = (p.q || "").toString().trim().toLowerCase();
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Students");
    if (!sh || sh.getLastRow() &lt; 2) return wrap(cb,{status:"notfound"});
    var rows = sh.getRange(2,1,sh.getLastRow()-1,27).getValues();
    for (var i=0;i&lt;rows.length;i++) {
      var r=rows[i];
      var cands=[
        (r[2]||"").toString().trim().toLowerCase(),
        (r[3]||"").toString().trim().toLowerCase(),
        (r[5]||"").toString().trim().toLowerCase(),
        (r[10]||"").toString().trim().toLowerCase()
      ];
      if (cands.indexOf(q)!==-1) {
        return wrap(cb,{status:"found",rowIndex:i+2,data:{
          acYear:r[1],regNo:r[2],studentId:r[3],bookNo:r[4],aadhar:r[5],
          iyatta:r[6],tukdi:r[7],pen:r[8],rollNo:r[9],
          firstName:r[10],motherName:r[11],gender:r[12],
          religion:r[13],caste:r[14],subcaste:r[15],dob:fmt(r[16]),dobWords:r[17],nationality:r[18],
          motherTongue:r[19],birthVillage:r[20],
          prevSchool:r[21],admissionDate:fmt(r[22]),admissionClass:r[23],
          contact:r[24],address:r[25],photoUrl:r[26]
        }});
      }
    }
    return wrap(cb,{status:"notfound"});
  } catch(err) {
    return wrap(cb,{status:"error",message:err.toString()});
  }
}
function fmt(v){
  if(!v) return "";
  if(v instanceof Date){
    return v.getFullYear()+"-"+("0"+(v.getMonth()+1)).slice(-2)+"-"+("0"+v.getDate()).slice(-2);
  }
  return v.toString();
}

function cleanRegFileName(regNo) {
  var text = (regNo || "student").toString().trim();
  var bad = '\\/:*?"&lt;&gt;|#%&amp;{}$!\'@+=~';
  var out = "";
  for (var i = 0; i &lt; text.length; i++) {
    var ch = text.charAt(i);
    out += bad.indexOf(ch) &gt;= 0 ? "_" : ch;
  }
  return out || "student";
}

function publicDriveUrl(fileId) {
  return "https://drive.google.com/thumbnail?id=" + fileId + "&amp;sz=w1000";
}

function testPhotoFolderAccess() {
  try {
    var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    var blob = Utilities.newBlob("ok", "text/plain", "_sgs_upload_test.txt");
    var file = folder.createFile(blob);
    file.setTrashed(true);
    return {status:"ok", folderName:folder.getName(), folderId:PHOTO_FOLDER_ID};
  } catch(err) {
    return {status:"error", message:err.toString()};
  }
}

function savePhotoData(regNo, photoData, mimeType) {
  try {
    regNo = (regNo || "").toString().trim();
    if (!regNo) return {status:"error", message:"regNo required"};
    if (!photoData) return {status:"error", message:"photoData required"};

    var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    var fileName = cleanRegFileName(regNo) + ".jpg";
    var existing = folder.getFilesByName(fileName);
    while (existing.hasNext()) {
      existing.next().setTrashed(true);
    }
    var bytes = Utilities.base64Decode(photoData);
    if (bytes.length &gt; 10240) return {status:"error", message:"Photo size is " + bytes.length + " bytes. Please compress below 10 KB."};
    var blob = Utilities.newBlob(bytes, mimeType || "image/jpeg", fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var photoUrl = publicDriveUrl(file.getId());
    updateStudentPhotoUrl(regNo, photoUrl);
    return {status:"ok", regNo:regNo, photoUrl:photoUrl, fileId:file.getId()};
  } catch(err) {
    return {status:"error", message:err.toString()};
  }
}

function handlePhotoUpload(p) {
  return savePhotoData(p.regNo, p.photoData, p.mimeType);
}

function startPhotoChunkUpload(p) {
  try {
    if (!p.uploadId) return {status:"error", message:"uploadId required"};
    var cache = CacheService.getScriptCache();
    cache.put("photo_" + p.uploadId + "_meta", JSON.stringify({
      regNo:p.regNo || "",
      mimeType:p.mimeType || "image/jpeg",
      count:parseInt(p.count || "0", 10)
    }), 600);
    return {status:"ok", uploadId:p.uploadId};
  } catch(err) {
    return {status:"error", message:err.toString()};
  }
}

function savePhotoChunk(p) {
  try {
    if (!p.uploadId) return {status:"error", message:"uploadId required"};
    if (p.idx === undefined) return {status:"error", message:"idx required"};
    if (p.chunk === undefined) return {status:"error", message:"chunk required"};
    CacheService.getScriptCache().put("photo_" + p.uploadId + "_" + p.idx, p.chunk, 600);
    return {status:"ok", idx:p.idx};
  } catch(err) {
    return {status:"error", message:err.toString()};
  }
}

function finishPhotoChunkUpload(p) {
  try {
    var uploadId = p.uploadId || "";
    var count = parseInt(p.count || "0", 10);
    if (!uploadId) return {status:"error", message:"uploadId required"};
    if (!count || count &lt; 1) return {status:"error", message:"count required"};
    var cache = CacheService.getScriptCache();
    var keys = [];
    for (var i = 0; i &lt; count; i++) keys.push("photo_" + uploadId + "_" + i);
    var got = cache.getAll(keys);
    var parts = [];
    for (var j = 0; j &lt; count; j++) {
      var part = got["photo_" + uploadId + "_" + j];
      if (part === null || part === undefined) return {status:"error", message:"Missing photo chunk " + (j + 1) + "/" + count};
      parts.push(part);
    }
    return savePhotoData(p.regNo, parts.join(""), p.mimeType || "image/jpeg");
  } catch(err) {
    return {status:"error", message:err.toString()};
  }
}

function updateStudentPhotoUrl(regNo, photoUrl) {
  var sh = getOrCreateSheet("Students", MAIN_HEADERS);
  var row = findRowByKey(sh, 3, regNo) || findRowByKey(sh, 4, regNo);
  if (row) {
    sh.getRange(row, 27).setValue(photoUrl);
    SpreadsheetApp.flush();
  }
}

function getPhotoUrlByRegNo(regNo) {
  try {
    regNo = (regNo || "").toString().trim();
    if (!regNo) return {status:"error", message:"regNo required"};
    var sh = getOrCreateSheet("Students", MAIN_HEADERS);
    var row = findRowByKey(sh, 3, regNo) || findRowByKey(sh, 4, regNo);
    var folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    var files = folder.getFilesByName(cleanRegFileName(regNo) + ".jpg");
    if (files.hasNext()) {
      var file = files.next();
      var photoUrl = publicDriveUrl(file.getId());
      updateStudentPhotoUrl(regNo, photoUrl);
      return {status:"ok", photoUrl:photoUrl};
    }
    if (row) {
      var savedUrl = sh.getRange(row, 33).getValue();
      if (savedUrl) return {status:"ok", photoUrl:savedUrl};
    }
    return {status:"notfound", photoUrl:""};
  } catch(err) {
    return {status:"error", message:err.toString()};
  }
}
</pre>
<button onclick="navigator.clipboard.writeText(document.getElementById('appsScriptCode').textContent);alert('फक्त Apps Script Code copy झाला आहे. Code.gs मध्ये paste करताना </pre>, <button>, <div> असे HTML tags paste करू नका.')" style="margin-top:8px;background:#d4902a;border:none;border-radius:5px;padding:7px 16px;color:#1a2a4a;font-weight:700;cursor:pointer">Only Code.gs Copy</button>
<div style="margin-top:8px;padding:8px 10px;background:#4a1a1a;border:1px solid #b85a5a;border-radius:6px;color:#ffd0d0;font-size:11px;line-height:1.6">
  <b>महत्त्वाचे:</b> Code.gs मध्ये फक्त वरच्या dark-blue box मधील JavaScript code paste करा. <b>&lt;/pre&gt;, &lt;button&gt;, &lt;div&gt;, Manifest Copy</b> हा HTML भाग Code.gs मध्ये paste करू नका.
</div>
<div style="margin-top:12px;padding:10px;background:#281a0a;border:1px solid #d4902a;border-radius:6px;color:#ffe0a0;font-size:11px;line-height:1.7">
  <b>DriveApp Permission Fix:</b> Apps Script मध्ये Project Settings → Show "appsscript.json" manifest file सुरू करा आणि खालील scopes manifest मध्ये ठेवा. नंतर Save → Deploy New Version → एकदा Run/Test करून authorization Allow करा.
</div>
<pre id="appsScriptManifest" style="background:#0d1b35;padding:12px;border-radius:6px;margin-top:8px;overflow-x:auto;font-size:11px;color:#ffd18a;white-space:pre-wrap">{
  "timeZone": "Asia/Kolkata",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/drive"
  ]
}</pre>
<button onclick="navigator.clipboard.writeText(document.getElementById('appsScriptManifest').textContent)" style="margin-top:8px;background:#1a4a7a;border:none;border-radius:5px;padding:7px 16px;color:#fff;font-weight:700;cursor:pointer">Manifest Copy</button>
</details>

<script>
// ============================================================
// WORD (.docx) EXPORT — Template-based Mail Merge
// ============================================================

var wordTemplates = { lc: null, bf: null, at: null };

function loadTemplate(type, inputEl) {
  var file = inputEl.files[0];
  if (!file) return;
  var statusEl = document.getElementById('tpl_' + type + '_status');
  var reader = new FileReader();
  reader.onload = function(e) {
    wordTemplates[type] = e.target.result;
    statusEl.textContent = '✅ ' + file.name;
  };
  reader.onerror = function() {
    statusEl.textContent = '❌ Error reading file';
  };
  reader.readAsArrayBuffer(file);
}

function showPlaceholders() {
  document.getElementById('phModal').style.display = 'block';
}

function addCharFields(target, prefix, value, fromNo, toNo) {
  var chars = String(value || '').replace(/\s+/g, '').split('');
  for (var n = fromNo; n <= toNo; n++) {
    target[prefix + n] = chars[n - fromNo] || '';
  }
}

function withLCMailMergeAliases(data) {
  var d = Object.assign({}, data);
  var fromText = [data.leave_month_mr, data.leave_year].filter(Boolean).join(' ');
  d.Stxt1 = data.reg_no;
  d.Stxt2 = data.book_no;
  addCharFields(d, 'Stxt', data.aadhar, 22, 33);
  addCharFields(d, 'Stxt', data.pen, 34, 44);
  d.Stxt48 = data.full_name || data.first_name;
  d.Stxt49 = '';
  d.Stxt50 = '';
  d.Stxt51 = data.mother_name;
  d.Stxt52 = data.religion;
  d.Stxt53 = data.caste;
  d.Stxt54 = data.subcaste;
  d.Stxt55 = data.nationality;
  d.Stxt56 = data.mother_tongue;
  d.Stxt57 = data.dob;
  d.Stxt58 = data.dob_words;
  d.Stxt59 = data.birth_village;
  d.Stxt60 = data.birth_taluka;
  d.Stxt61 = data.birth_district;
  d.Stxt62 = data.birth_state;
  d.Stxt63 = data.country;
  d.Stxt64 = data.prev_school;
  d.Stxt65 = data.adm_date;
  d.Stxt66 = data.adm_class;
  d.Stxt71 = data.leave_date;
  d.Stxt72 = data.reason;
  d.Stxt75 = data.progress;
  d.Stxt76 = data.conduct;
  d.Stxt77 = data.leave_class;
  d.Stxt78 = fromText;
  d.Stxt79 = data.lc_no;
  d.Stxt80 = data.lc_type;
  d.Stxt83 = data.leave_class_words;
  d.Stxt84 = fromText;
  return d;
}

function templateTextFromZip(zip) {
  var text = '';
  Object.keys(zip.files || {}).forEach(function(name) {
    if (/^word\/.*\.xml$/.test(name)) {
      try { text += zip.file(name).asText(); } catch(e) {}
    }
  });
  return text;
}

function fillAndDownload(type, data, filename) {
  var tpl = wordTemplates[type];
  if (!tpl) {
    alert('⚠️ आधी वरती "' + (type==='lc'?'LC':type==='bf'?'Bonafide':'Attendance') + '" template upload करा!');
    return;
  }
  try {
    var zip = new PizZip(tpl);
    var templateText = templateTextFromZip(zip);
    var usesHashMerge = /#(?:Stxt\d+|[A-Za-z_][A-Za-z0-9_]*)#/.test(templateText);
    var renderData = (type === 'lc' && usesHashMerge) ? withLCMailMergeAliases(data) : data;
    var doc = new window.docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: usesHashMerge ? { start: '#', end: '#' } : { start: '{', end: '}' }
    });
    doc.render(renderData);
    var out = doc.getZip().generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    saveAs(out, filename);
  } catch(e) {
    var msg = e.message || String(e);
    if (e.properties && e.properties.errors) {
      msg += '\nUnmatched tags: ' + e.properties.errors.map(function(x){ return x.id; }).join(', ');
    }
    alert('❌ Word export error:\n' + msg + '\n\nTemplate मधील placeholders तपासा.');
  }
}

function marathiMonthName(monthNo) {
  var n = parseInt(monthNo, 10);
  if (!n) return '';
  try {
    return new Intl.DateTimeFormat('mr-IN', {month:'long'}).format(new Date(2000, n - 1, 1));
  } catch(e) {
    return String(monthNo || '');
  }
}

function buildLCWordData() {
  function g(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  var leaveDateRaw = g('lc_stxt82') || g('lc_stxt65');
  var leaveYear='', leaveMonth='', leaveMonthMr='';
  if (leaveDateRaw) {
    var lp = leaveDateRaw.split('-');
    leaveYear = lp[0]||''; leaveMonth = lp[1]||'';
  }
  leaveMonthMr = marathiMonthName(leaveMonth);
  var gender = g('lc_stxt___gender')||g('lc_stxt15')||'Male';
  var fn=g('lc_stxt11');

  return {
    lc_no:         g('lc_stxt72'),
    lc_date:       fmtDate(g('lc_stxt71')),
    reg_no:        g('lc_stxt1'),
    student_id:    g('lc_stxt1'),
    full_name:     fn,
    first_name:    fn,
    father_name:   '',
    surname:       '',
    mother_name:   g('lc_stxt___mother'),
    gender_title:  gender==='Female'?'\u0915\u0941\u092e\u093e\u0930\u0940':'\u0915\u0941\u092e\u093e\u0930',
    aadhar:        g('lc_stxt___aadhar'),
    pen:           g('lc_stxt___pen'),
    book_no:       g('lc_stxt___bookNo'),
    dob:           fmtDate(g('lc_stxt19')),
    dob_words:     g('lc_stxt20'),
    religion:      g('lc_stxt16'),
    caste:         g('lc_stxt17'),
    subcaste:      g('lc_stxt___subcaste'),
    nationality:   g('lc_stxt21')||'\u092d\u093e\u0930\u0924\u0940\u092f',
    mother_tongue: g('lc_stxt22')||'\u092e\u0930\u093e\u0920\u0940',
    birth_village: g('lc_stxt___village'),
    birth_taluka:  '',
    birth_district:'',
    birth_state:   '',
    country:       '',
    prev_school:   g('lc_stxt___prevSchool'),
    adm_date:      fmtDate(g('lc_stxt57')),
    adm_class:     classToMr(g('lc_stxt58')),
    class_start_date: fmtDate(g('lc_stxt82')),
    leave_date:    fmtDate(g('lc_stxt65')),
    leave_class:   classToMr(g('lc_stxt66')),
    leave_class_words: classWords(g('lc_stxt66')),
    leave_month_mr:leaveMonthMr,
    leave_year:    leaveYear,
    class_start_month_mr: leaveMonthMr,
    class_start_year: leaveYear,
    progress:      g('lc_stxt74')||'\u091a\u093e\u0902\u0917\u0932\u0940',
    conduct:       g('lc_stxt73')||'\u091a\u093e\u0902\u0917\u0932\u0940',
    reason:        g('lc_stxt64'),
    lc_type:       (g('lc_stxt78')&&parseInt(g('lc_stxt78'))>1)?'\u0926\u0941\u092f\u094d\u092f\u092e\u092a\u094d\u0930\u0924':'\u092e\u0941\u0933\u092a\u094d\u0930\u0924',
    medium:        g('lc_stxt59')||'\u092e\u0930\u093e\u0920\u0940',
    next_school:   g('lc_stxt77'),
    fee_status:    g('lc_stxt79'),
    stxt60:        g('lc_stxt60'),
    stxt61:        g('lc_stxt61'),
    stxt62:        g('lc_stxt62'),
    stxt63:        g('lc_stxt63'),
    stxt67:        g('lc_stxt67'),
    stxt68:        g('lc_stxt68'),
    stxt69:        g('lc_stxt69'),
    stxt70:        g('lc_stxt70'),
    nationality_type: g('lc_stxt80'),
    today:         todayDate()
  };
}

function lcWordFilename(data) {
  function clean(s){ return String(s||'').replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,'_'); }
  return 'LC_' + clean(data.reg_no||'Student') + '_' + (new Date()).toISOString().slice(0,10).replace(/-/g,'') + '.docx';
}

function exportLCWordFromCertificate(filename) {
  if (!window.htmlDocx || !window.htmlDocx.asBlob) {
    alert('DOCX export library not loaded. Please check internet/reload, or upload LC1_template_for_app.docx and try again.');
    return;
  }
  showLCCert();
  setTimeout(function(){
    var certPage = document.querySelector('#certContent .cert-page');
    if (!certPage) {
      alert('LC certificate preview not found. Please click LC certificate preview once and try again.');
      return;
    }
    var css = Array.prototype.map.call(document.querySelectorAll('style'), function(s){ return s.textContent || ''; }).join('\n');
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
      '@page{size:A4;margin:0} body{margin:0;background:#fff;} ' + css +
      '</style></head><body>' + certPage.outerHTML + '</body></html>';
    var blob = window.htmlDocx.asBlob(html, {
      orientation: 'portrait',
      margins: {top: 0, right: 0, bottom: 0, left: 0}
    });
    saveAs(blob, filename);
  }, 400);
}

function exportLCWord() {
  if(!requireMaster('lc')) return;
  var data = buildLCWordData();
  var fname = lcWordFilename(data);
  if (wordTemplates.lc) {
    fillAndDownload('lc', data, fname);
    return;
  }
  exportLCWordFromCertificate(fname);
}

function exportBFWord() {
  if(!requireMaster('bf')) return;
  function g(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  var gender = g('bf_stxt___gender')||'Male';
  var fn=g('bf_stxt11');
  var religion=g('bf_stxt16'), caste=g('bf_stxt17');
  var birthPlace=g('bf_stxt___birthVillage');
  var birthFull=birthPlace;

  var data = {
    cert_no:       g('bf_stxt___certNo')||'',
    reg_no:        g('bf_stxt1'),
    full_name:     fn,
    first_name:    fn,
    father_name:   '',
    surname:       '',
    gender_title:  gender==='Female'?'कुमारी':'कुमार',
    gender_he:     gender==='Female'?'ती':'तो',
    gender_his:    gender==='Female'?'तिची':'त्याची',
    dob:           fmtDate(g('bf_stxt19')),
    dob_words:     g('bf_stxt20'),
    religion:      religion,
    caste:         caste,
    caste_full:    religion+(religion&&caste?' ':'')+caste,
    nationality:   g('bf_stxt21')||'भारतीय',
    iyatta:        classToMr(g('bf_stxt7')),
    tukdi:         g('bf_stxt8'),
    ac_year:       g('bf_stxt2'),
    adm_date:      fmtDate(g('bf_stxt4')),
    adm_class:     classToMr(g('bf_stxt5')),
    birth_village: birthPlace,
    birth_taluka:  '',
    birth_district:'',
    birth_full:    birthFull,
    purpose:       g('bf_stxt3'),
    remarks:       g('bf_stxt6'),
    today:         todayDate()
  };
  var fname = 'BF_' + (g('bf_stxt1')||'').replace(/[^a-zA-Z0-9]/g,'') + '_' + todayDate().replace(/-/g,'') + '.docx';
  fillAndDownload('bf', data, fname);
}

function exportATWord() {
  if(!requireMaster('at')) return;
  function g(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  var gender = g('at_stxt15')||'Male';
  var fn=g('at_stxt11');
  var pct = document.getElementById('at_pct')?document.getElementById('at_pct').value:'';

  var data = {
    cert_no:         g('at_stxt___certNo')||'',
    reg_no:          g('at_stxt1'),
    full_name:       fn,
    first_name:      fn,
    father_name:     '',
    surname:         '',
    gender_title:    gender==='Female'?'कुमारी':'कुमार',
    gender_he:       gender==='Female'?'ती':'तो',
    gender_his:      gender==='Female'?'तिची':'त्याची',
    iyatta:          classToMr(g('at_stxt7')),
    tukdi:           g('at_stxt8'),
    ac_year:         g('at_stxt2'),
    total_days:      g('at_stxt16'),
    present_days:    g('at_stxt17'),
    attendance_pct:  pct,
    from_date:       fmtDate(g('at_stxt5')),
    to_date:         fmtDate(g('at_stxt6')),
    purpose:         g('at_stxt3'),
    remarks:         g('at_stxt14'),
    today:           todayDate()
  };
  var fname = 'AT_' + (g('at_stxt1')||'').replace(/[^a-zA-Z0-9]/g,'') + '_' + todayDate().replace(/-/g,'') + '.docx';
  fillAndDownload('at', data, fname);
}

// ===== SEARCH STUDENTS / विद्यार्थी शोधा =====

function loadAllStudentsForSearch() {
  var warn = document.getElementById('srch_cache_warn');
  var stat = document.getElementById('srch_status');
  if (warn) warn.style.display = 'none';
  if (stat) stat.textContent = '⏳ विद्यार्थी Load होत आहेत...';
  var url = getUrl();
  if (!url) {
    if (stat) stat.textContent = '⚠️ URL Set नाही. Master User ने URL Set करावे.';
    return;
  }
  var cb = 'srchCb_' + Date.now();
  window[cb] = function(r) {
    delete window[cb];
    var s = document.createElement('script');
    s.parentNode && s.parentNode.removeChild(s);
    if (r && r.status === 'ok' && r.data) {
      studentCache.data = r.data;
      studentCache.loaded = true;
      studentCache.loadedAt = new Date();
      buildCacheIndex();
      saveCacheToStorage();
      if (stat) stat.textContent = '✅ ' + r.data.length + ' विद्यार्थी Load झाले. आता शोधा.';
      runSearch();
    } else {
      if (stat) stat.textContent = '❌ Load Failed: ' + (r && r.message ? r.message : 'Unknown error');
    }
  };
  var s = document.createElement('script');
  s.src = url + '?action=getAll&callback=' + cb + '&t=' + Date.now();
  s.onerror = function() {
    if (stat) stat.textContent = '❌ Network Error. URL तपासा.';
    delete window[cb];
  };
  document.head.appendChild(s);
}

function clearSearch() {
  ['srch_name','srch_father','srch_surname','srch_dob','srch_aadhar'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  ['srch_class','srch_tukdi'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('srch_status').textContent = '';
  document.getElementById('srch_table').style.display = 'none';
  document.getElementById('srch_nodata').style.display = 'none';
  document.getElementById('srch_tbody').innerHTML = '';
}

function g$(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function fmtDobDisplay(dob) {
  if (!dob) return '—';
  var parts = dob.split('-');
  if (parts.length === 3) return parts[2] + '-' + parts[1] + '-' + parts[0];
  return dob;
}

function runSearch() {
  var warn = document.getElementById('srch_cache_warn');
  var stat = document.getElementById('srch_status');
  var tbody = document.getElementById('srch_tbody');
  var table = document.getElementById('srch_table');
  var nodata = document.getElementById('srch_nodata');

  if (!studentCache.loaded || studentCache.data.length === 0) {
    // try loading from localStorage cache
    if (!loadCacheFromStorage()) {
      warn.style.display = 'block';
      stat.textContent = '';
      table.style.display = 'none';
      nodata.style.display = 'none';
      return;
    }
  }
  warn.style.display = 'none';

  var qName    = g$('srch_name').toLowerCase();
  var qFather  = g$('srch_father').toLowerCase();
  var qSurname = g$('srch_surname').toLowerCase();
  var qDob     = g$('srch_dob');
  var qClass   = g$('srch_class').toLowerCase();
  var qTukdi   = g$('srch_tukdi').toLowerCase();
  var qAadhar  = g$('srch_aadhar');

  // nothing filled → show all or prompt
  var anyFilled = qName || qFather || qSurname || qDob || qClass || qTukdi || qAadhar;
  if (!anyFilled) {
    stat.textContent = '🔎 ' + studentCache.data.length + ' विद्यार्थी Loaded — शोधण्यासाठी वरील fields भरा.';
    table.style.display = 'none';
    nodata.style.display = 'none';
    tbody.innerHTML = '';
    return;
  }

  var results = studentCache.data.filter(function(d) {
    var fullName = (d.firstName || '').toLowerCase();

    // Name partial match within full name
    if (qName    && fullName.indexOf(qName) === -1) return false;
    if (qFather  && fullName.indexOf(qFather) === -1) return false;
    if (qSurname && fullName.indexOf(qSurname) === -1) return false;

    // DOB exact match
    if (qDob && (d.dob || '') !== qDob) return false;

    // Class exact match (case-insensitive)
    if (qClass && (d.iyatta || '').toString().toLowerCase() !== qClass) return false;

    // Tukdi exact match (case-insensitive)
    if (qTukdi && (d.tukdi || '').toLowerCase() !== qTukdi) return false;

    // Aadhar contains match
    if (qAadhar && (d.aadhar || '').indexOf(qAadhar) === -1) return false;

    return true;
  });

  stat.textContent = '✅ ' + results.length + ' विद्यार्थी सापडले' + (results.length === studentCache.data.length ? ' (सर्व)' : '');

  if (results.length === 0) {
    table.style.display = 'none';
    nodata.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }

  nodata.style.display = 'none';
  table.style.display = 'table';

  var canSeeStudent = canUsePage('student');
  var canIssueBF    = canUsePage('bonafide');
  var canIssueAT    = canUsePage('attendance');

  window._srchResultsIndex = {};
  tbody.innerHTML = results.map(function(d, i) {
    window._srchResultsIndex[JSON.stringify(d.regNo||d.studentId)] = d;
    var rowBg = i % 2 === 0 ? '#f5f8ff' : '#eef3ff';
    var actionBtns = '';
    var key = JSON.stringify(d.regNo||d.studentId);
    if (canSeeStudent) {
      actionBtns += '<button onclick="srchLoadStudent(' + key + ')" '
        + 'style="background:#1a3a6a;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:12px;margin:2px" title="विद्यार्थी माहिती — auto load">👤 माहिती</button>';
    }
    if (canUsePage('profile')) {
      actionBtns += '<button onclick="srchGoToProfile(' + key + ')" '
        + 'style="background:#6a2a8a;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:12px;margin:2px" title="संपूर्ण Profile फोटोसह पहा">🪪 Profile</button>';
    }
    if (canUsePage('lc')) {
      actionBtns += '<button onclick="srchGoToLC(' + key + ')" '
        + 'style="background:#2a5a8a;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:12px;margin:2px" title="LC Issue करा — auto load">📋 LC</button>';
    }
    if (canIssueBF) {
      actionBtns += '<button onclick="srchGoToBF(' + key + ')" '
        + 'style="background:#4a7a1a;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:12px;margin:2px" title="Bonafide Issue करा — auto load">📄 BF</button>';
    }
    if (canIssueAT) {
      actionBtns += '<button onclick="srchGoToAT(' + key + ')" '
        + 'style="background:#7a4a1a;color:#fff;border:none;border-radius:4px;padding:4px 9px;cursor:pointer;font-size:12px;margin:2px" title="Attendance Certificate Issue करा — auto load">✅ AT</button>';
    }
    var photoUrl = d.photoUrl || '';
    var photoCell = photoUrl
      ? '<div class="srch-thumb-wrap"><img class="srch-thumb" src="' + escAttr(photoUrl) + '" alt="photo">'
        + '<div class="srch-preview-card"><img src="' + escAttr(photoUrl) + '" alt="photo">'
        + '<div class="spc-name">' + (d.firstName||'—') + '</div>'
        + '<div class="spc-meta">' + (d.iyatta||'—') + ' | ' + (d.tukdi||'—') + ' | ' + (d.regNo||'—') + '</div></div></div>'
      : '<div style="width:34px;height:40px;background:#eef3ff;border-radius:3px;border:1px solid #c5d4e8;display:flex;align-items:center;justify-content:center;font-size:16px">👤</div>';
    return '<tr style="background:' + rowBg + ';border-bottom:1.5px solid #c5d4e8">'
      + '<td class="master-only" style="padding:7px 10px"><input type="checkbox" class="srch-row-check" value=\'' + JSON.stringify(d.regNo||d.studentId).replace(/'/g,"&#39;") + '\' onchange="updateBatchSelCount()"></td>'
      + '<td style="padding:7px 10px">' + photoCell + '</td>'
      + '<td style="padding:7px 10px;font-weight:800;color:#0a0a6a;font-size:14px">' + (d.regNo||'—') + '</td>'
      + '<td style="padding:7px 10px;font-weight:600;color:#1a1a2a">' + (d.studentId||'—') + '</td>'
      + '<td style="padding:7px 10px;font-weight:700;color:#0d0d0d;font-size:13.5px">' + (d.firstName||'—') + '</td>'
      + '<td style="padding:7px 10px;text-align:center;font-weight:700;color:#1a1a2a">' + (d.iyatta||'—') + '</td>'
      + '<td style="padding:7px 10px;text-align:center;font-weight:700;color:#1a1a2a">' + (d.tukdi||'—') + '</td>'
      + '<td style="padding:7px 10px;white-space:nowrap;font-weight:600;color:#1a1a2a">' + fmtDobDisplay(d.dob) + '</td>'
      + '<td style="padding:7px 10px;font-weight:600;color:#1a1a2a">' + (d.aadhar||'—') + '</td>'
      + '<td style="padding:7px 6px;white-space:nowrap">' + actionBtns + '</td>'
      + '</tr>';
  }).join('');
}

function srchLoadStudent(key) {
  addRecentSearch(window._srchResultsIndex && window._srchResultsIndex[JSON.stringify(key)]);
  // Student page वर जा → regNo टाका → auto search
  showPage('student', document.querySelector('.navbtn[data-page="student"]'));
  setTimeout(function() {
    var box = document.getElementById('s_regNo');
    if (box) { box.value = key; }
    searchStudent('s');
  }, 300);
}

function srchGoToProfile(key) {
  addRecentSearch(window._srchResultsIndex && window._srchResultsIndex[JSON.stringify(key)]);
  showPage('profile', document.querySelector('.navbtn[data-page="profile"]'));
  setTimeout(function() {
    var box = document.getElementById('prof_key');
    if (box) { box.value = key; }
    loadStudentProfile(key);
  }, 200);
}

function srchGoToBF(key) {
  addRecentSearch(window._srchResultsIndex && window._srchResultsIndex[JSON.stringify(key)]);
  // BF page वर जा → regNo टाका → auto search → सर्व माहिती भरते
  showPage('bonafide', document.querySelector('.navbtn[data-page="bonafide"]'));
  setTimeout(function() {
    var box = document.getElementById('bf_regNo');
    if (box) { box.value = key; }
    searchStudent('bf');
  }, 300);
}

function srchGoToAT(key) {
  addRecentSearch(window._srchResultsIndex && window._srchResultsIndex[JSON.stringify(key)]);
  // AT page वर जा → regNo टाका → auto search → सर्व माहिती भरते
  showPage('attendance', document.querySelector('.navbtn[data-page="attendance"]'));
  setTimeout(function() {
    var box = document.getElementById('at_regNo');
    if (box) { box.value = key; }
    searchStudent('at');
  }, 300);
}

function srchGoToLC(key) {
  addRecentSearch(window._srchResultsIndex && window._srchResultsIndex[JSON.stringify(key)]);
  // LC page वर जा → regNo टाका → auto search → सर्व माहिती भरते
  showPage('lc', document.querySelector('.navbtn[data-page="lc"]'));
  setTimeout(function() {
    var box = document.getElementById('lc_regNo');
    if (box) { box.value = key; }
    searchStudent('lc');
  }, 300);
}

// ===== BATCH SELECTION & BATCH PRINT (V19.9) =====
function toggleSelectAllSearch(cb) {
  document.querySelectorAll('.srch-row-check').forEach(function(el){ el.checked = cb.checked; });
  updateBatchSelCount();
}
function updateBatchSelCount() {
  var n = document.querySelectorAll('.srch-row-check:checked').length;
  var bar = document.getElementById('batchPrintBar');
  var cnt = document.getElementById('batchSelCount');
  if (cnt) cnt.textContent = n + ' विद्यार्थी निवडले';
  if (bar) bar.style.display = n > 0 ? 'block' : 'none';
}
function classToMrSafe(c) {
  try { return classToMr(c); } catch(e) { return c || ''; }
}
function buildBatchCertHTML(d, type) {
  var gender = d.gender || '';
  var title = (gender === 'Female') ? 'कुमारी' : 'कुमार';
  var tya = (gender === 'Female') ? 'तिची' : 'त्याची';
  var ti = (gender === 'Female') ? 'ती' : 'तो';
  var iyatta = classToMrSafe(d.iyatta);
  var tukdi = d.tukdi || '';
  var dob = d.dob ? fmtDobDisplay(d.dob) : '';
  var regNo = d.regNo || '';
  if (type === 'AT') {
    return `<div class="cert-page a4-noborder" style="page-break-after:always">
      <div class="cert-draft-watermark"><span>DRAFT</span></div>
      <div class="cert-outer-border">
        <div style="text-align:center;font-family:'Noto Sans Devanagari',sans-serif;font-size:7.5pt;color:#555;margin-bottom:1mm">पाचोरा तालुका सहकारी शिक्षण संस्था संचलित,</div>
        <div style="text-align:center;font-family:'Noto Serif Devanagari',serif;font-size:16pt;font-weight:900;color:#111;line-height:1.2">श्री.गोविंदराम सेक्सरिया हायस्कूल, पाचोरा</div>
        <hr class="cert-divider" style="margin:2mm 0">
        <div style="font-size:8.5pt;font-family:'Noto Sans Devanagari',sans-serif;margin:1.5mm 0 2mm">रजि. क्र. <b>${regNo}</b></div>
        <div style="text-align:center;margin:3mm 0"><div style="font-family:'Noto Serif Devanagari',serif;font-size:12pt;font-weight:700;color:#111">उपस्थिती दाखला</div></div>
        <p style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;line-height:1.9;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
          ${title} <b>${d.firstName||''}</b> ${ti} विद्यार्थी इयत्ता - <b>${iyatta}</b> तुकडी - <b>${tukdi||'_'}</b> मध्ये शिकत आहे. जन्म तारीख: <b>${dob||'___'}</b>.
          (⚠️ Batch-generated draft — अधिकृत serial साठी Attendance page वरून वैयक्तिक Save & Issue करा.)
        </p>
        <div class="cert-footer-line" style="margin-top:5mm"><div><b>स्थळ – पाचोरा</b></div>
        <div style="text-align:center"><div style="width:55mm;border-top:1px solid #000;padding-top:1mm;font-size:7.5pt">मुख्याध्यापक/प्राचार्य</div></div></div>
      </div></div>`;
  }
  return `<div class="cert-page a4-noborder" style="page-break-after:always">
    <div class="cert-draft-watermark"><span>DRAFT</span></div>
    <div class="cert-outer-border">
      <div style="text-align:center;font-family:'Noto Sans Devanagari',sans-serif;font-size:7.5pt;color:#555;margin-bottom:1mm">पाचोरा तालुका सहकारी शिक्षण संस्था संचलित,</div>
      <div style="text-align:center;font-family:'Noto Serif Devanagari',serif;font-size:16pt;font-weight:900;color:#111;line-height:1.2">श्री.गोविंदराम सेक्सरिया हायस्कूल, पाचोरा</div>
      <hr class="cert-divider" style="margin:2mm 0">
      <div style="font-size:8.5pt;font-family:'Noto Sans Devanagari',sans-serif;margin:1.5mm 0 2mm">रजि. क्र. <b>${regNo}</b></div>
      <div style="text-align:center;margin:3mm 0"><div style="font-family:'Noto Serif Devanagari',serif;font-size:12pt;font-weight:700;color:#111">दाखला (बोनाफाईड सर्टिफिकेट)</div></div>
      <p style="font-family:'Kokila','Noto Serif Devanagari',serif;font-size:11pt;line-height:1.9;text-align:justify;margin-bottom:3mm;color:#111;text-indent:1cm">
        ${title} <b>${d.firstName||''}</b> यांना दाखला देण्यात येतो की, सदर विद्यार्थी ${ti} आमच्या विद्यालयात इयत्ता- <b>${iyatta}</b> तुकडी – <b>${tukdi||'_'}</b> मध्ये शिकत आहे. जन्म तारीख: <b>${dob||'___'}</b>.
        (⚠️ Batch-generated draft — अधिकृत serial साठी Bonafide page वरून वैयक्तिक Save & Issue करा.)
      </p>
      <div class="cert-footer-line" style="margin-top:5mm"><div><b>स्थळ – पाचोरा</b></div>
      <div style="text-align:center"><div style="width:55mm;border-top:1px solid #000;padding-top:1mm;font-size:7.5pt">मुख्याध्यापक/प्राचार्य</div></div></div>
    </div></div>`;
}
function batchPrintCerts(type) {
  if (!canEdit()) { alert('⚠️ Batch Print अधिकार फक्त Master User ला आहे.'); return; }
  var checked = document.querySelectorAll('.srch-row-check:checked');
  if (!checked.length) { alert('⚠️ आधी किमान एक विद्यार्थी निवडा.'); return; }
  var htmlParts = [];
  checked.forEach(function(cb) {
    var key = JSON.parse(cb.value);
    var d = window._srchResultsIndex && window._srchResultsIndex[JSON.stringify(key)];
    if (d) htmlParts.push(buildBatchCertHTML(d, type));
  });
  openCert(type === 'AT' ? '✅ Batch Attendance Certificates' : '📄 Batch Bonafide Certificates', htmlParts.join(''), 'a4');
}

// ===== RECENTLY SEARCHED (V19.8) =====
var RECENT_SEARCH_KEY = 'sgs_recent_searches_v1';
function addRecentSearch(d) {
  if (!d) return;
  try {
    var list = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]');
    var key = d.regNo || d.studentId;
    list = list.filter(function(x){ return (x.regNo||x.studentId) !== key; });
    list.unshift({ regNo:d.regNo, studentId:d.studentId, firstName:d.firstName, iyatta:d.iyatta, tukdi:d.tukdi });
    list = list.slice(0, 5);
    localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(list));
  } catch(e) {}
}
function renderRecentSearches() {
  var wrap = document.getElementById('recentSearchWrap');
  var box = document.getElementById('recentSearchChips');
  if (!wrap || !box) return;
  var list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]'); } catch(e) {}
  if (!list.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  box.innerHTML = list.map(function(d) {
    var key = JSON.stringify(d.regNo || d.studentId);
    return '<span class="rs-chip" onclick=\'srchLoadStudent(' + key.replace(/'/g,"\\'") + ')\'>👤 '
      + (d.firstName||'—') + ' (' + (d.iyatta||'—') + (d.tukdi?'-'+d.tukdi:'') + ')</span>';
  }).join('');
}

// ===== DASHBOARD LIVE STATS (V19.8) =====
function loadDashboardStats() {
  var url = getUrl();
  var loading = document.getElementById('dashStatsLoading');
  var cards = document.getElementById('dashStatCards');
  var chartPanel = document.getElementById('dashClassChart');
  if (!url) {
    if (loading) loading.textContent = '⚠️ आधी Google Sheets URL Set करा.';
    return;
  }
  if (loading) { loading.style.display = 'block'; loading.textContent = '⏳ आकडेवारी Load होत आहे...'; }
  if (cards) cards.style.display = 'none';
  if (chartPanel) chartPanel.style.display = 'none';
  var cb = 'dashCb_' + Date.now();
  window[cb] = function(r) {
    delete window[cb];
    if (r && r.status === 'ok') {
      document.getElementById('stat_totalStudents').textContent = r.totalStudents || 0;
      document.getElementById('stat_todayLC').textContent = r.todayLC || 0;
      document.getElementById('stat_todayBF').textContent = r.todayBF || 0;
      document.getElementById('stat_monthCerts').textContent = r.monthCerts || 0;
      renderClassChart(r.classCounts || {});
      if (loading) loading.style.display = 'none';
      if (cards) cards.style.display = 'grid';
      if (chartPanel) chartPanel.style.display = 'block';
    } else {
      if (loading) loading.textContent = '❌ आकडेवारी Load करता आली नाही: ' + (r && r.message ? r.message : 'Unknown error');
    }
  };
  var s = document.createElement('script');
  s.src = url + '?action=getDashboardStats&callback=' + cb + '&t=' + Date.now();
  s.onerror = function() {
    if (loading) loading.textContent = '❌ Network Error.';
    delete window[cb];
  };
  document.head.appendChild(s);
}
function renderClassChart(classCounts) {
  var body = document.getElementById('dashClassChartBody');
  if (!body) return;
  var classes = ['5th','6th','7th','8th','9th','10th'];
  var max = 1;
  classes.forEach(function(c){ if ((classCounts[c]||0) > max) max = classCounts[c]; });
  body.innerHTML = classes.map(function(c) {
    var v = classCounts[c] || 0;
    var pct = Math.round((v / max) * 100);
    return '<div class="bar-chart-row"><div class="bcr-lbl">' + c + '</div>'
      + '<div class="bcr-track"><div class="bcr-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="bcr-val">' + v + '</div></div>';
  }).join('');
}

// ===== STUDENT PROFILE PAGE (V19.13) =====
function loadStudentProfile(prefillKey) {
  var keyBox = document.getElementById('prof_key');
  var key = (prefillKey !== undefined && prefillKey !== null) ? String(prefillKey) : (keyBox ? keyBox.value.trim() : '');
  if (keyBox && prefillKey !== undefined) keyBox.value = key;
  var empty = document.getElementById('profile_empty');
  var content = document.getElementById('profile_content');
  if (!key) {
    if (empty) { empty.style.display = 'block'; empty.textContent = '⚠️ Reg No / Student ID टाका.'; }
    if (content) content.style.display = 'none';
    return;
  }
  // प्रथम स्थानिक Cache मधून शोधा (instant); न मिळाल्यास आवश्यक असल्यास Load Students करायला सांगा
  var d = searchInCache(key);
  if (!d) {
    if (empty) {
      empty.style.display = 'block';
      empty.textContent = '😕 "' + key + '" साठी विद्यार्थी सापडला नाही. आधी वरील "⚡ बल्क Load करा" बटणाने विद्यार्थी माहिती Load केली आहे का ते तपासा.';
    }
    if (content) content.style.display = 'none';
    return;
  }
  renderStudentProfile(d);
}

function renderStudentProfile(d) {
  var empty = document.getElementById('profile_empty');
  var content = document.getElementById('profile_content');
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = 'block';

  // ===== फोटो =====
  var photoWrap = document.getElementById('prof_photoWrap');
  if (photoWrap) {
    photoWrap.innerHTML = d.photoUrl
      ? '<img src="' + escAttr(d.photoUrl) + '" alt="photo" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<span class="ph-placeholder" style="display:none">👤</span>'
      : '<span class="ph-placeholder">👤</span>';
  }

  // ===== हेडलाइन =====
  var nameEl = document.getElementById('prof_name');
  var metaEl = document.getElementById('prof_meta');
  if (nameEl) nameEl.textContent = d.firstName || '—';
  if (metaEl) metaEl.textContent = 'इयत्ता ' + (d.iyatta || '—') + (d.tukdi ? ' - ' + d.tukdi : '') + '  |  Reg No: ' + (d.regNo || '—') + '  |  Student ID: ' + (d.studentId || '—');

  // ===== Call / Message / WhatsApp बटणे — Mobile, WhatsApp Mobile, Alternate Mobile =====
  var row = document.getElementById('prof_contactRow');
  if (row) {
    function contactLine(label, icon, val) {
      var num = (val || '').toString().replace(/[^0-9+]/g, '');
      if (!num) return '';
      var waNum = num.replace(/^\+/, '').replace(/^0/, '91');
      if (waNum.length === 10) waNum = '91' + waNum;
      return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        '<span style="font-size:13px;font-weight:700">' + icon + ' ' + label + ': ' + num + '</span>' +
        '<a class="pc-btn pc-call" href="tel:' + encodeURIComponent(num) + '">📞 Call</a>' +
        '<a class="pc-btn pc-wa" style="background:#2a6ab0" href="sms:' + encodeURIComponent(num) + '">💬 Message</a>' +
        '<a class="pc-btn pc-wa" href="https://wa.me/' + encodeURIComponent(waNum) + '" target="_blank" rel="noopener">🟢 WhatsApp</a>' +
        '</div>';
    }
    var lines = contactLine('संपर्क', '📞', d.contact) + contactLine('WhatsApp', '🟢', d.whatsappMobile) + contactLine('इतर', '📱', d.alternateMobile);
    row.innerHTML = lines || '<span style="font-size:12.5px;opacity:.7">📞 कोणताही संपर्क क्रमांक उपलब्ध नाही</span>';
  }

  // ===== संपूर्ण माहिती Grid =====
  var grid = document.getElementById('prof_grid');
  if (grid) {
    var fields = [
      ['शैक्षणिक वर्ष', d.acYear], ['Reg No', d.regNo], ['Student ID', d.studentId],
      ['जनरल रजि. नं (Book No)', d.bookNo], ['आधार क्रमांक', d.aadhar],
      ['इयत्ता', d.iyatta], ['तुकडी', d.tukdi], ['PEN', d.pen], ['Roll No', d.rollNo],
      ['पूर्ण नाव', d.firstName], ['आईचे नाव', d.motherName], ['लिंग', d.gender],
      ['धर्म', d.religion], ['जात', d.caste], ['पोटजात', d.subcaste],
      ['जन्मदिनांक', d.dob], ['जन्मदिनांक (अक्षरी)', d.dobWords],
      ['राष्ट्रीयत्व', d.nationality], ['मातृभाषा', d.motherTongue], ['जन्मगाव', d.birthVillage],
      ['मागील शाळा', d.prevSchool], ['प्रवेश दिनांक', d.admissionDate], ['प्रवेश इयत्ता', d.admissionClass],
      ['संपर्क क्रमांक', d.contact], ['WhatsApp Mobile No.', d.whatsappMobile], ['Alternate Mobile No.', d.alternateMobile], ['पत्ता', d.address]
    ];
    grid.innerHTML = fields.map(function(f) {
      var val = (f[1] === undefined || f[1] === null || f[1] === '') ? '—' : f[1];
      return '<div class="profile-field"><div class="pf-lbl">' + f[0] + '</div><div class="pf-val">' + val + '</div></div>';
    }).join('');
  }
}

// ===== LC/BF/AT HISTORY (V19.8) =====
function loadStudentHistory() {
  var regNo = (document.getElementById('hist_regNo').value || '').trim();
  var stat = document.getElementById('hist_status');
  var table = document.getElementById('hist_table');
  var tbody = document.getElementById('hist_tbody');
  var nodata = document.getElementById('hist_nodata');
  if (!regNo) { stat.textContent = '⚠️ Student ID / रजि. क्र. टाका.'; return; }
  var url = getUrl();
  if (!url) { stat.textContent = '⚠️ URL Set नाही.'; return; }
  stat.textContent = '⏳ Load होत आहे...';
  table.style.display = 'none'; nodata.style.display = 'none';
  var cb = 'histCb_' + Date.now();
  window[cb] = function(r) {
    delete window[cb];
    if (r && r.status === 'ok') {
      addRecentSearch({ regNo: regNo, studentId: regNo, firstName: '', iyatta: '', tukdi: '' });
      if (!r.data || !r.data.length) { nodata.style.display = 'block'; stat.textContent = ''; return; }
      stat.textContent = '✅ ' + r.data.length + ' नोंदी सापडल्या.';
      table.style.display = 'table';
      tbody.innerHTML = r.data.map(function(row) {
        var typeCls = row.type === 'LC' ? 'hist-type-lc' : (row.type === 'BF' ? 'hist-type-bf' : 'hist-type-at');
        return '<tr><td class="' + typeCls + '">' + row.type + '</td><td>' + (row.serial||'—') + '</td>'
          + '<td>' + (row.date||'—') + '</td><td>' + (row.detail||'—') + '</td></tr>';
      }).join('');
    } else {
      stat.textContent = '❌ ' + (r && r.message ? r.message : 'Load Failed');
    }
  };
  var s = document.createElement('script');
  s.src = url + '?action=getStudentHistory&regNo=' + encodeURIComponent(regNo) + '&callback=' + cb + '&t=' + Date.now();
  s.onerror = function() { stat.textContent = '❌ Network Error.'; delete window[cb]; };
  document.head.appendChild(s);
}

// ===== BULK EXPORT — LC/BF/AT to Excel (V19.8) =====
function bulkExportCertificates() {
  if (!canEdit()) { alert('⚠️ Bulk Export अधिकार फक्त Master User ला आहे.'); return; }
  var url = getUrl();
  if (!url) { alert('⚠️ URL Set नाही.'); return; }
  var btn = document.getElementById('bulkExportBtn');
  var status = document.getElementById('bulkExportStatus');
  btn.disabled = true;
  status.textContent = '⏳ Data Load होत आहे...';
  var cb = 'bulkExpCb_' + Date.now();
  window[cb] = function(r) {
    delete window[cb];
    btn.disabled = false;
    if (!r || r.status !== 'ok') {
      status.textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
      return;
    }
    try {
      var wb = XLSX.utils.book_new();
      ['LC','BF','AT'].forEach(function(type) {
        var rows = (r.data || []).filter(function(x){ return x.type === type; });
        var ws = XLSX.utils.json_to_sheet(rows.map(function(x) {
          return { Type:x.type, 'Serial No':x.serial, Date:x.date, 'Reg No':x.regNo, 'Full Name':x.firstName, Detail:x.detail };
        }));
        XLSX.utils.book_append_sheet(wb, ws, type);
      });
      var today = new Date().toISOString().slice(0,10);
      XLSX.writeFile(wb, 'SGS_Certificates_Report_' + today + '.xlsx');
      status.textContent = '✅ Report Download झाला.';
    } catch(e) {
      status.textContent = '❌ Export Error: ' + e.message;
    }
  };
  var s = document.createElement('script');
  s.src = url + '?action=getAllCertificates&callback=' + cb + '&t=' + Date.now();
  s.onerror = function() { status.textContent = '❌ Network Error.'; btn.disabled = false; delete window[cb]; };
  document.head.appendChild(s);
}

// Refresh search when page is opened
var _origShowPage = showPage;
showPage = function(name, btn) {
  _origShowPage(name, btn);
  if (name === 'search') {
    var stat = document.getElementById('srch_status');
    if (stat && !stat.textContent) runSearch();
    renderRecentSearches();
  }
  if (name === 'dashboard') {
    loadDashboardStats();
    loadAnalytics();
    if (currentUser && (currentUser.role === 'master' || currentUser.role === 'super')) mstLoadRecentNotices();
  }
  if (name === 'stats') {
    mstLoadStatsReport();
  }
  if (name === 'history') {
    renderRecentSearches();
  }
  if (name === 'profile') {
    var pk = document.getElementById('prof_key');
    if (pk && !pk.value) { pk.focus(); }
  }
  if (name === 'users') {
    if (currentUser && currentUser.role === 'super') loadUsersTable();
  }
  if (name === 'teacher') {
    tchInit();
  }
};

// ===== USER MANAGEMENT PRO — FRONTEND (V19.9 / V19.14 teacher class) =====
function toggleUmClassFields() {
  var role = document.getElementById('um_role').value;
  var show = role === 'teacher';
  document.getElementById('um_classWrap').style.display = show ? '' : 'none';
  document.getElementById('um_tukdiWrap').style.display = show ? '' : 'none';
}
function loadUsersTable() {
  var url = getUrl();
  var tbody = document.getElementById('um_tbody');
  if (!url || !tbody) return;
  tbody.innerHTML = '<tr><td colspan="5">⏳ Load होत आहे...</td></tr>';
  var cb = 'umCb_' + Date.now();
  window[cb] = function(r) {
    delete window[cb];
    if (r && r.status === 'ok' && r.data) {
      window._allUsers = r.data;
      tbody.innerHTML = r.data.map(function(u) {
        var clsLabel = (u.assignedClass||'').replace('|','-');
        return '<tr><td>' + u.username + '</td><td>' + u.role + '</td><td>' + (u.label||'') + '</td><td>' + clsLabel + '</td>'
          + '<td><button class="btn btn-blue" style="padding:4px 10px;font-size:11px" onclick="editUser(\'' + u.username + '\')">✏️ Edit</button> '
          + '<button class="btn btn-red" style="padding:4px 10px;font-size:11px" onclick="deleteUser(\'' + u.username + '\')">🗑️ Delete</button></td></tr>';
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5">❌ Load Failed</td></tr>';
    }
  };
  var s = document.createElement('script');
  s.src = url + '?action=getUsers&callback=' + cb + '&t=' + Date.now();
  document.head.appendChild(s);
}
function editUser(username) {
  var u = (window._allUsers || []).filter(function(x){ return x.username === username; })[0];
  if (!u) return;
  document.getElementById('um_username').value = u.username;
  document.getElementById('um_password').value = u.password;
  document.getElementById('um_role').value = u.role;
  document.getElementById('um_label').value = u.label || '';
  var parts = (u.assignedClass||'').split('|');
  document.getElementById('um_assignedClass').value = parts[0] || '';
  document.getElementById('um_assignedTukdi').value = parts[1] || '';
  toggleUmClassFields();
}
function clearUserForm() {
  ['um_username','um_password','um_label'].forEach(function(id){ document.getElementById(id).value = ''; });
  document.getElementById('um_role').value = 'cert';
  document.getElementById('um_assignedClass').value = '';
  document.getElementById('um_assignedTukdi').value = '';
  toggleUmClassFields();
}
function saveUser() {
  if (!currentUser || currentUser.role !== 'super') { alert('⚠️ अधिकार फक्त Super Master User ला आहे.'); return; }
  var url = getUrl();
  if (!url) { alert('⚠️ URL Set नाही.'); return; }
  var username = document.getElementById('um_username').value.trim();
  var password = document.getElementById('um_password').value;
  var role = document.getElementById('um_role').value;
  var label = document.getElementById('um_label').value.trim();
  var assignedClass = '';
  if (role === 'teacher') {
    var cls = document.getElementById('um_assignedClass').value;
    var tuk = document.getElementById('um_assignedTukdi').value;
    if (!cls || !tuk) { document.getElementById('um_status').textContent = '⚠️ Class Teacher साठी वर्ग व तुकडी दोन्ही निवडा.'; return; }
    assignedClass = cls + '|' + tuk;
  }
  if (!username || !password) { document.getElementById('um_status').textContent = '⚠️ Username व Password आवश्यक आहेत.'; return; }
  var data = { action:'saveUser', username:username, password:password, role:role, label:label, assignedClass:assignedClass,
    requesterUser: currentUser.username, requesterRole: currentUser.role };
  document.getElementById('um_status').textContent = '⏳ Saving...';
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      document.getElementById('um_status').textContent = '✅ User Save झाला.';
      clearUserForm();
      loadUsersTable();
    } else {
      document.getElementById('um_status').textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}
function deleteUser(username) {
  if (!currentUser || currentUser.role !== 'super') { alert('⚠️ अधिकार फक्त Super Master User ला आहे.'); return; }
  if (username === currentUser.username) { alert('⚠️ आपण स्वतःचे Account Delete करू शकत नाही.'); return; }
  if (!confirm('User "' + username + '" Delete करायचा आहे का?')) return;
  var url = getUrl();
  var data = { action:'deleteUser', username:username, requesterUser: currentUser.username, requesterRole: currentUser.role };
  smartSave(data, function(r) {
    if (r && r.status === 'ok') { loadUsersTable(); }
    else { alert('❌ ' + (r && r.message ? r.message : 'Failed')); }
  });
}
function changeMyPassword() {
  if (!currentUser) return;
  var url = getUrl();
  if (!url) { document.getElementById('pwd_status').textContent = '⚠️ URL Set नाही.'; return; }
  var oldPwd = document.getElementById('pwd_old').value;
  var newPwd = document.getElementById('pwd_new').value;
  if (!oldPwd || !newPwd) { document.getElementById('pwd_status').textContent = '⚠️ दोन्ही Fields भरा.'; return; }
  var data = { action:'changePassword', username: currentUser.username, oldPassword: oldPwd, newPassword: newPwd,
    requesterUser: currentUser.username, requesterRole: currentUser.role };
  document.getElementById('pwd_status').textContent = '⏳ Updating...';
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      document.getElementById('pwd_status').textContent = '✅ Password बदलला. पुढच्या Login साठी नवीन Password वापरा.';
      document.getElementById('pwd_old').value = '';
      document.getElementById('pwd_new').value = '';
      if (AUTH_USERS[currentUser.username]) AUTH_USERS[currentUser.username].password = newPwd;
    } else {
      document.getElementById('pwd_status').textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}

// =====================================================
// 👩‍🏫 CLASS TEACHER MODULE — FRONTEND (V19.14)
// =====================================================
var tchRoster = [];
var tchRosterLoadedAt = 0;
var TCH_ROSTER_CACHE_MS = 2 * 60 * 1000; // २ मिनिटे — वारंवार Tab बदलताना पुन्हा पुन्हा Load होणार नाही
var tchAbsentToday = [];
var tchSelectedStudent = null;

function tchFmtDate(iso) {
  if (!iso) return '';
  var s = String(iso).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return m[3] + '/' + m[2] + '/' + m[1];
}

// ===== सामायिक सांख्यिकी Helper (V19.19) — Master Statistics Report + Teacher Dashboard दोन्हीसाठी वापरले जातात =====
var CATEGORY_LIST = ['SC','ST','VJA','NT B','NT C','NT D','SEBC','SBC','OBC','Gen'];
var STATS_AGE_ASOF = '2026-09-30';

function classLabel(iyatta, tukdi) { return (iyatta||'—') + ' - ' + (tukdi||'—'); }

function computeAgeAsOf(dobStr, asOfStr) {
  if (!dobStr) return null;
  var d = new Date(dobStr);
  if (isNaN(d.getTime())) return null;
  var asOf = new Date(asOfStr);
  var age = asOf.getFullYear() - d.getFullYear();
  var mo = asOf.getMonth() - d.getMonth();
  if (mo < 0 || (mo === 0 && asOf.getDate() < d.getDate())) age--;
  return age;
}

function buildCategoryTableHtml(students) {
  var female = {}, male = {};
  CATEGORY_LIST.concat(['Minority']).forEach(function(c){ female[c]=0; male[c]=0; });
  students.forEach(function(s) {
    var bucket = s.gender === 'Female' ? female : (s.gender === 'Male' ? male : null);
    if (!bucket) return;
    var cat = (s.category||'').toString().trim();
    if (CATEGORY_LIST.indexOf(cat) !== -1) bucket[cat]++;
    if ((s.minority||'').toString().trim().toLowerCase() === 'yes') bucket.Minority++;
  });
  function catTotal(bucket) { return CATEGORY_LIST.reduce(function(sum,c){ return sum + (bucket[c]||0); }, 0); }
  function cellVal(bucket, col) { return col === 'Total' ? catTotal(bucket) : (bucket[col]||0); }
  var displayCols = CATEGORY_LIST.concat(['Total','Minority']);
  var html = '<table class="hist-table"><thead><tr><th></th>' + displayCols.map(function(c){return '<th>'+c+'</th>';}).join('') + '</tr></thead><tbody>';
  html += '<tr><td><b>मुली</b></td>' + displayCols.map(function(c){return '<td>'+cellVal(female,c)+'</td>';}).join('') + '</tr>';
  html += '<tr><td><b>मुले</b></td>' + displayCols.map(function(c){return '<td>'+cellVal(male,c)+'</td>';}).join('') + '</tr>';
  html += '<tr><td><b>एकूण</b></td>' + displayCols.map(function(c){return '<td><b>'+(cellVal(female,c)+cellVal(male,c))+'</b></td>';}).join('') + '</tr>';
  html += '</tbody></table>';
  return html;
}

function buildAgeTableSimpleHtml(students, asOfStr) {
  var counts = {};
  students.forEach(function(s) {
    var age = computeAgeAsOf(s.dob, asOfStr);
    if (age === null) return;
    counts[age] = (counts[age]||0) + 1;
  });
  var ages = Object.keys(counts).map(Number).sort(function(a,b){ return a-b; });
  if (!ages.length) return 'माहिती उपलब्ध नाही (DOB नोंदवलेले नाही).';
  var total = ages.reduce(function(sum,a){ return sum + counts[a]; }, 0);
  var html = '<table class="hist-table"><thead><tr>' + ages.map(function(a){return '<th>'+a+' वर्षे</th>';}).join('') + '<th>एकूण</th></tr></thead><tbody><tr>' +
    ages.map(function(a){ return '<td>'+counts[a]+'</td>'; }).join('') + '<td><b>'+total+'</b></td></tr></tbody></table>';
  return html;
}

// ===== Master / Super Master — मेंटेनन्स: वर्ग/तुकडी बदल (V19.20) =====
var mntCurrentStudent = null;

function mntSearchStudent() {
  var regNo = document.getElementById('mnt_regNo').value.trim();
  var statusEl = document.getElementById('mnt_status');
  var resultBox = document.getElementById('mnt_result');
  resultBox.style.display = 'none';
  mntCurrentStudent = null;
  if (!regNo) { statusEl.textContent = '⚠️ Reg No टाका.'; return; }
  statusEl.textContent = '⏳ शोधत आहे...';
  jsonpRequest({action:'search', q: regNo}, function(r) {
    if (r && r.status === 'found') {
      mntCurrentStudent = r.data;
      statusEl.textContent = '';
      document.getElementById('mnt_studentName').textContent = r.data.firstName || '—';
      document.getElementById('mnt_studentRegNo').textContent = r.data.regNo || regNo;
      document.getElementById('mnt_curClass').textContent = r.data.iyatta || '—';
      document.getElementById('mnt_curTukdi').textContent = r.data.tukdi || '—';
      document.getElementById('mnt_newClass').value = r.data.iyatta || '';
      document.getElementById('mnt_newTukdi').value = r.data.tukdi || '';
      resultBox.style.display = 'block';
    } else {
      statusEl.textContent = '❌ या Reg No चा विद्यार्थी सापडला नाही.';
    }
  });
}

function mntSaveChange() {
  if (!mntCurrentStudent) return;
  var newClass = document.getElementById('mnt_newClass').value;
  var newTukdi = document.getElementById('mnt_newTukdi').value;
  var statusEl = document.getElementById('mnt_status');
  if (!newClass || !newTukdi) { statusEl.textContent = '⚠️ नवीन वर्ग व तुकडी दोन्ही निवडा.'; return; }
  var data = { action:'updateClassDivision', regNo: mntCurrentStudent.regNo, iyatta: newClass, tukdi: newTukdi,
    requesterUser: currentUser.username, requesterRole: currentUser.role };
  statusEl.textContent = '⏳ Saving...';
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      statusEl.textContent = '✅ बदल जतन झाला: ' + (r.oldIyatta||'—') + '-' + (r.oldTukdi||'—') + ' → ' + newClass + '-' + newTukdi;
      document.getElementById('mnt_curClass').textContent = newClass;
      document.getElementById('mnt_curTukdi').textContent = newTukdi;
      mntCurrentStudent.iyatta = newClass;
      mntCurrentStudent.tukdi = newTukdi;
    } else {
      statusEl.textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}

function buildCategoryTableFromCounts(female, male) {
  female = female || {}; male = male || {};
  function catTotal(bucket) { return CATEGORY_LIST.reduce(function(sum,c){ return sum + (bucket[c]||0); }, 0); }
  function cellVal(bucket, col) { return col === 'Total' ? catTotal(bucket) : (bucket[col]||0); }
  var displayCols = CATEGORY_LIST.concat(['Total','Minority']);
  var html = '<table class="hist-table"><thead><tr><th></th>' + displayCols.map(function(c){return '<th>'+c+'</th>';}).join('') + '</tr></thead><tbody>';
  html += '<tr><td><b>मुली</b></td>' + displayCols.map(function(c){return '<td>'+cellVal(female,c)+'</td>';}).join('') + '</tr>';
  html += '<tr><td><b>मुले</b></td>' + displayCols.map(function(c){return '<td>'+cellVal(male,c)+'</td>';}).join('') + '</tr>';
  html += '<tr><td><b>एकूण</b></td>' + displayCols.map(function(c){return '<td><b>'+(cellVal(female,c)+cellVal(male,c))+'</b></td>';}).join('') + '</tr>';
  html += '</tbody></table>';
  return html;
}

// ===== Master / Super Master — Notice Board (V19.19) =====
function mstSaveNotice() {
  if (!currentUser || (currentUser.role !== 'master' && currentUser.role !== 'super')) return;
  var title = document.getElementById('mst_noticeTitle').value.trim();
  var msg = document.getElementById('mst_noticeMsg').value.trim();
  var statusEl = document.getElementById('mst_noticeStatus');
  if (!title || !msg) { statusEl.textContent = '⚠️ शीर्षक व तपशील दोन्ही लिहा.'; return; }
  var data = { action:'saveNotice', title:title, message:msg, targetClass:'',
    postedBy: (currentUser.label||currentUser.username), requesterUser: currentUser.username, requesterRole: currentUser.role };
  statusEl.textContent = '⏳ पाठवत आहे...';
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      statusEl.textContent = '✅ सूचना सर्व वर्ग शिक्षकांना पाठवली.';
      document.getElementById('mst_noticeTitle').value = '';
      document.getElementById('mst_noticeMsg').value = '';
      mstLoadRecentNotices();
    } else {
      statusEl.textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}

function mstLoadRecentNotices() {
  jsonpRequest({action:'getNotices', limit: 15}, function(r) {
    var el = document.getElementById('mst_recentNotices');
    if (!el) return;
    if (!r || r.status !== 'ok' || !r.data.length) { el.innerHTML = 'अद्याप कोणतीही सूचना पाठवलेली नाही.'; return; }
    el.innerHTML = r.data.map(function(n) {
      return '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(0,0,0,.08)"><b>' + n.title + '</b> <span style="opacity:.6;font-size:11px">(' + tchFmtDate(n.date) + ' — ' + n.postedBy + ')</span><br>' + n.message + '</div>';
    }).join('');
  });
}

// ===== Master / Super Master — Statistics Report Page (V19.19, वेगवान V19.21) =====
var mstStatsCache = null;
var mstStatsCachedAt = 0;
var MST_STATS_CACHE_MS = 3 * 60 * 1000; // ३ मिनिटे — पुन्हा पुन्हा उघडल्यास सर्व्हरला विनाकारण मागणी जाणार नाही

function mstLoadStatsReport(force) {
  var statusEl = document.getElementById('stats_status');
  if (!force && mstStatsCache && (Date.now() - mstStatsCachedAt) < MST_STATS_CACHE_MS) {
    mstRenderStatsReport(mstStatsCache);
    statusEl.textContent = '✅ (आधीच Load केलेले — जलद) ' + new Date(mstStatsCachedAt).toLocaleTimeString('en-IN') + ' — Refresh वर क्लिक करून ताजी माहिती मिळवा';
    return;
  }
  statusEl.textContent = '⏳ Load होत आहे...';
  jsonpRequest({action:'getStatsReport'}, function(r) {
    if (!r || r.status !== 'ok') { statusEl.textContent = '❌ Load Failed'; return; }
    mstStatsCache = r;
    mstStatsCachedAt = Date.now();
    mstRenderStatsReport(r);
    statusEl.textContent = '✅ अद्ययावत — ' + new Date().toLocaleTimeString('en-IN');
  });
}

function mstRenderStatsReport(r) {
  var classes = r.classes || [];

  // १. आजची हजेरी
  var attRows = classes.map(function(c) {
    var key = classLabel(c.iyatta, c.tukdi);
    var present = c.total - c.absent;
    return '<tr><td>' + key + '</td><td>' + c.total + '</td><td style="color:#1a7a3a;font-weight:700">' + present + '</td><td style="color:#c02020;font-weight:700">' + c.absent + '</td></tr>';
  }).join('');
  document.getElementById('stats_attTbody').innerHTML = attRows || '<tr><td colspan="4">माहिती उपलब्ध नाही.</td></tr>';

  // २. जमा फी
  var grandFees = 0;
  var feesRows = classes.map(function(c) {
    grandFees += c.fees;
    return '<tr><td>' + classLabel(c.iyatta, c.tukdi) + '</td><td>₹' + c.fees + '</td></tr>';
  }).join('');
  if (classes.length) feesRows += '<tr><td><b>एकूण</b></td><td><b>₹' + grandFees + '</b></td></tr>';
  document.getElementById('stats_feesTbody').innerHTML = feesRows || '<tr><td colspan="2">माहिती उपलब्ध नाही.</td></tr>';

  // ३. वर्गनिहाय प्रवर्ग (Category) — आधीच सर्व्हरवरून female/male प्रवर्ग-बेरीज मिळालेली आहे
  var catHtml = classes.map(function(c) {
    return '<div style="margin-bottom:20px"><h4 style="font-size:13.5px;margin-bottom:6px">वर्ग: ' + classLabel(c.iyatta, c.tukdi) + '</h4>' + buildCategoryTableFromCounts(c.female, c.male) + '</div>';
  }).join('');
  document.getElementById('stats_categoryBody').innerHTML = catHtml || 'माहिती उपलब्ध नाही.';

  // ४. वयानुरूप वर्गनिहाय (matrix: वर्ग x वय)
  var ageSet = {};
  classes.forEach(function(c) { Object.keys(c.ageCounts||{}).forEach(function(a){ ageSet[a] = true; }); });
  var ages = Object.keys(ageSet).map(Number).sort(function(a,b){ return a-b; });
  if (!ages.length) {
    document.getElementById('stats_ageBody').innerHTML = 'माहिती उपलब्ध नाही (DOB नोंदवलेले नाही).';
  } else {
    var ageHtml = '<table class="hist-table"><thead><tr><th>वर्ग</th>' + ages.map(function(a){return '<th>'+a+' वर्षे</th>';}).join('') + '<th>एकूण</th></tr></thead><tbody>';
    var ageColTotals = {};
    classes.forEach(function(c) {
      var rowTotal = 0;
      ageHtml += '<tr><td>' + classLabel(c.iyatta, c.tukdi) + '</td>';
      ages.forEach(function(a) {
        var cnt = (c.ageCounts||{})[a] || 0;
        rowTotal += cnt;
        ageColTotals[a] = (ageColTotals[a]||0) + cnt;
        ageHtml += '<td>' + (cnt || '—') + '</td>';
      });
      ageHtml += '<td><b>' + rowTotal + '</b></td></tr>';
    });
    var grandAgeTotal = ages.reduce(function(sum,a){ return sum + (ageColTotals[a]||0); }, 0);
    ageHtml += '<tr><td><b>एकूण</b></td>' + ages.map(function(a){ return '<td><b>' + (ageColTotals[a]||0) + '</b></td>'; }).join('') + '<td><b>' + grandAgeTotal + '</b></td></tr>';
    ageHtml += '</tbody></table>';
    document.getElementById('stats_ageBody').innerHTML = ageHtml;
  }
}

function tchShowTab(tab) {
  document.querySelectorAll('.tch-tabbtn').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-tch') === tab); });
  document.querySelectorAll('.tch-panel').forEach(function(p){ p.classList.remove('active'); });
  var el = document.getElementById('tchp-' + tab);
  if (el) el.classList.add('active');
  if (tab === 'dash') tchLoadDashboard();
  else if (tab === 'roster') tchLoadRoster();
  else if (tab === 'att') tchInitAttendanceTab();
  else if (tab === 'diary') tchInitDiaryTab();
  else if (tab === 'fees') tchLoadFees();
  else if (tab === 'notices') tchLoadNoticesFull();
  else if (tab === 'maint') tchMntReset();
}

function tchInit() {
  if (!currentUser || currentUser.role !== 'teacher') return;
  var lbl = document.getElementById('tch_classLabel');
  if (lbl) lbl.textContent = (currentUser.iyatta || '—') + ' - ' + (currentUser.tukdi || '—');
  var d = document.getElementById('tch_attDate');
  if (d) d.value = new Date().toISOString().slice(0,10);
  tchLoadRoster(function(){ tchLoadDashboard(); });
}

function tchLoadRoster(onDone, force) {
  if (!force && tchRoster.length && (Date.now() - tchRosterLoadedAt) < TCH_ROSTER_CACHE_MS) {
    if (onDone) onDone();
    return;
  }
  jsonpRequest({action:'getClassStudents', iyatta: currentUser.iyatta, tukdi: currentUser.tukdi}, function(r) {
    if (r && r.status === 'ok') {
      tchRoster = r.data || [];
      tchRosterLoadedAt = Date.now();
      tchRenderRoster();
      tchPopulateDiaryStudentSelect();
    }
    if (onDone) onDone();
  });
}

function tchRenderRoster() {
  var q = (document.getElementById('tch_rosterSearch') || {}).value || '';
  q = q.trim().toLowerCase();
  var tbody = document.getElementById('tch_rosterTbody');
  if (!tbody) return;
  var list = tchRoster.filter(function(s) {
    if (!q) return true;
    return (s.fullName||'').toLowerCase().indexOf(q) !== -1 || (s.regNo||'').toString().toLowerCase().indexOf(q) !== -1;
  });
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="6">कोणीही विद्यार्थी सापडला नाही.</td></tr>'; return; }
  tbody.innerHTML = list.map(function(s) {
    return '<tr class="tch-roster-row" onclick="tchShowProfile(\'' + s.regNo + '\')">' +
      '<td>' + (s.rollNo||'') + '</td><td>' + (s.fullName||'') + '</td><td>' + (s.gender||'') + '</td>' +
      '<td>' + tchFmtDate(s.dob) + '</td><td onclick="event.stopPropagation()">' + tchContactCell(s) + '</td>' +
      '<td><button class="btn btn-blue" style="padding:3px 10px;font-size:11px" onclick="event.stopPropagation();tchShowProfile(\'' + s.regNo + '\')">🪪 Profile</button></td></tr>';
  }).join('');
}

function tchShowProfile(regNo) {
  showPage('profile');
  var keyBox = document.getElementById('prof_key');
  if (keyBox) keyBox.value = regNo;
  loadStudentProfile(regNo);
}

// ---- 🔧 मेंटेनन्स — फक्त तुकडी बदल (V19.20) ----
var tchMntStudent = null;

function tchMntReset() {
  document.getElementById('tch_mntRegNo').value = '';
  document.getElementById('tch_mntStatus').textContent = '';
  document.getElementById('tch_mntResult').style.display = 'none';
  tchMntStudent = null;
}

function tchMntSearch() {
  var regNo = document.getElementById('tch_mntRegNo').value.trim();
  var statusEl = document.getElementById('tch_mntStatus');
  var resultBox = document.getElementById('tch_mntResult');
  resultBox.style.display = 'none';
  tchMntStudent = null;
  if (!regNo) { statusEl.textContent = '⚠️ Reg No टाका.'; return; }
  var s = tchRoster.filter(function(x){ return String(x.regNo).toLowerCase() === regNo.toLowerCase(); })[0];
  if (!s) { statusEl.textContent = '❌ हा विद्यार्थी आपल्या वर्गात सापडला नाही.'; return; }
  tchMntStudent = s;
  statusEl.textContent = '';
  document.getElementById('tch_mntName').textContent = s.fullName || '—';
  document.getElementById('tch_mntRegNoShow').textContent = s.regNo || regNo;
  document.getElementById('tch_mntClass').textContent = currentUser.iyatta || '—';
  document.getElementById('tch_mntCurTukdi').textContent = currentUser.tukdi || '—';
  document.getElementById('tch_mntNewTukdi').value = currentUser.tukdi || '';
  resultBox.style.display = 'block';
}

function tchMntSave() {
  if (!tchMntStudent) return;
  var newTukdi = document.getElementById('tch_mntNewTukdi').value;
  var statusEl = document.getElementById('tch_mntStatus');
  if (!newTukdi) { statusEl.textContent = '⚠️ नवीन तुकडी निवडा.'; return; }
  var data = { action:'updateClassDivision', regNo: tchMntStudent.regNo, iyatta: currentUser.iyatta, tukdi: newTukdi,
    teacherIyatta: currentUser.iyatta, requesterUser: currentUser.username, requesterRole: currentUser.role };
  statusEl.textContent = '⏳ Saving...';
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      statusEl.textContent = '✅ तुकडी बदलली: ' + (r.oldTukdi||'—') + ' → ' + newTukdi + '. (विद्यार्थी यादी अद्ययावत होत आहे...)';
      document.getElementById('tch_mntCurTukdi').textContent = newTukdi;
      tchLoadRoster(null, true);
    } else {
      statusEl.textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}
function tchContactBtns(num, label) {
  num = (num||'').toString().replace(/[^0-9]/g,'');
  if (!num) return label ? ('<div style="opacity:.6">'+label+': —</div>') : '';
  var waNum = num.length === 10 ? '91' + num : num;
  return '<div style="white-space:nowrap;margin-bottom:2px">' + (label ? '<b style="font-size:10.5px">'+label+':</b> ' : '') + num + ' &nbsp;' +
    '<a href="tel:' + num + '" title="Call" style="color:#e8b05a;text-decoration:none">📞</a> &nbsp;' +
    '<a href="https://wa.me/' + waNum + '" target="_blank" rel="noopener" title="WhatsApp" style="color:#7be08a;text-decoration:none">🟢</a></div>';
}

function tchContactCell(s) {
  var wa = tchContactBtns(s.whatsappMobile, 'WA');
  var alt = tchContactBtns(s.alternateMobile, 'Alt');
  if (!s.whatsappMobile && !s.alternateMobile) return '<span style="opacity:.6">क्रमांक नोंदवलेला नाही</span>';
  return wa + alt;
}

// ---- Dashboard ----
function tchLoadDashboard() {
  var today = new Date().toISOString().slice(0,10);
  jsonpRequest({action:'getTeacherDashboard', iyatta: currentUser.iyatta, tukdi: currentUser.tukdi, date: today}, function(r) {
    if (!r || r.status !== 'ok') return;
    document.getElementById('tch_totalStudents').textContent = r.totalStudents;
    document.getElementById('tch_presentToday').textContent = r.presentCount;
    document.getElementById('tch_absentToday').textContent = r.absentCount;
    document.getElementById('tch_birthdayCount').textContent = r.birthdayStudents.length;
    var bl = document.getElementById('tch_birthdayList');
    bl.innerHTML = r.birthdayStudents.length ? r.birthdayStudents.map(function(b){
      return '🎂 ' + b.fullName + ' (Reg No: ' + b.regNo + ')';
    }).join('<br>') : 'आज कोणाचाही वाढदिवस नाही.';
    var nl = document.getElementById('tch_dashNotices');
    nl.innerHTML = r.notices.length ? r.notices.map(function(n){
      return '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.1)"><b>' + n.title + '</b> <span style="opacity:.6;font-size:11px">(' + tchFmtDate(n.date) + ')</span><br>' + n.message + '</div>';
    }).join('') : 'सध्या कोणतीही सूचना नाही.';

    // आज गैरहजर — मुली/मुले/एकूण (tchRoster सोबत जोडून लिंग शोधले जाते)
    var girls = 0, boys = 0;
    (r.absentList||[]).forEach(function(a) {
      var s = tchRoster.filter(function(x){ return String(x.regNo) === String(a.regNo); })[0];
      if (s && s.gender === 'Female') girls++;
      else if (s && s.gender === 'Male') boys++;
    });
    document.getElementById('tch_absentGirls').textContent = girls;
    document.getElementById('tch_absentBoys').textContent = boys;
    document.getElementById('tch_absentTotal2').textContent = r.absentCount;
  });

  // वर्ग प्रवर्ग (Category) व वयानुरूप तक्ते — tchRoster वापरून (roster आधीच Load झालेला असतो)
  var catEl = document.getElementById('tch_categoryBody');
  var ageEl = document.getElementById('tch_ageBody');
  if (tchRoster.length) {
    catEl.innerHTML = buildCategoryTableHtml(tchRoster);
    ageEl.innerHTML = buildAgeTableSimpleHtml(tchRoster, STATS_AGE_ASOF);
  } else {
    catEl.innerHTML = 'विद्यार्थी यादी Load होत आहे...';
    ageEl.innerHTML = 'विद्यार्थी यादी Load होत आहे...';
  }
}

// ---- Attendance ----
function tchInitAttendanceTab() {
  if (!tchRoster.length) { tchLoadRoster(function(){ tchLoadAttendanceForDate(); }); }
  else tchLoadAttendanceForDate();
  tchLoadSummary();
}

function tchLoadSummary() {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth()+1;
  var monthStart = y + '-' + String(m).padStart(2,'0') + '-01';
  var today = now.toISOString().slice(0,10);
  jsonpRequest({action:'getAttendance', iyatta: currentUser.iyatta, tukdi: currentUser.tukdi, dateFrom: monthStart, dateTo: today}, function(r) {
    var tbody = document.getElementById('tch_summaryTbody');
    if (!r || r.status !== 'ok' || !r.data.length) { tbody.innerHTML = '<tr><td colspan="3">या महिन्यात कोणीही अनुपस्थित नाही. 🎉</td></tr>'; return; }
    var dayMap = {};
    r.data.forEach(function(a) {
      var key = a.regNo;
      var dayNum = parseInt(String(a.date).split('-')[2], 10);
      if (!dayMap[key]) dayMap[key] = {fullName: a.fullName, days: []};
      if (dayNum && dayMap[key].days.indexOf(dayNum) === -1) dayMap[key].days.push(dayNum);
    });
    var rows = Object.keys(dayMap).map(function(regNo) {
      var s = tchRoster.filter(function(x){ return String(x.regNo) === String(regNo); })[0] || {};
      var days = dayMap[regNo].days.sort(function(a,b){ return a-b; });
      return {rollNo: s.rollNo||'', fullName: dayMap[regNo].fullName, daysStr: days.join(','), count: days.length};
    });
    rows.sort(function(a,b){ return b.count - a.count; });
    tbody.innerHTML = rows.map(function(x) {
      return '<tr><td>' + x.rollNo + '</td><td>' + x.fullName + '</td><td>' + x.daysStr + '</td></tr>';
    }).join('');
  });
}

function tchLoadAttendanceForDate() {
  var date = document.getElementById('tch_attDate').value || new Date().toISOString().slice(0,10);
  jsonpRequest({action:'getAttendance', iyatta: currentUser.iyatta, tukdi: currentUser.tukdi, date: date}, function(r) {
    var absentMap = {};
    if (r && r.status === 'ok') {
      (r.data||[]).forEach(function(a){ absentMap[a.regNo] = a.reason || ''; });
    }
    tchRenderAttendanceTable(absentMap);
  });
}

function tchRenderAttendanceTable(absentMap) {
  var tbody = document.getElementById('tch_attTbody');
  if (!tchRoster.length) { tbody.innerHTML = '<tr><td colspan="4">विद्यार्थी यादी उपलब्ध नाही.</td></tr>'; return; }
  tbody.innerHTML = tchRoster.map(function(s) {
    var isAbsent = absentMap.hasOwnProperty(s.regNo);
    var reason = absentMap[s.regNo] || '';
    return '<tr>' +
      '<td>' + (s.rollNo||'') + '</td><td>' + (s.fullName||'') + '</td>' +
      '<td><input type="checkbox" data-regno="' + s.regNo + '" class="tch-absent-chk" ' + (isAbsent?'checked':'') + ' onchange="tchToggleReasonBox(this)"></td>' +
      '<td><input type="text" class="tch-reason-box" data-regno="' + s.regNo + '" value="' + reason.replace(/"/g,'&quot;') + '" style="width:100%;padding:4px 6px;font-size:12px" ' + (isAbsent?'':'disabled') + '></td>' +
      '</tr>';
  }).join('');
}

function tchToggleReasonBox(chk) {
  var row = chk.closest('tr');
  var box = row.querySelector('.tch-reason-box');
  box.disabled = !chk.checked;
  if (!chk.checked) box.value = '';
}

function tchSaveAttendance() {
  var date = document.getElementById('tch_attDate').value;
  if (!date) { document.getElementById('tch_attStatus').textContent = '⚠️ तारीख निवडा.'; return; }
  var absentList = [];
  document.querySelectorAll('.tch-absent-chk:checked').forEach(function(chk) {
    var regNo = chk.getAttribute('data-regno');
    var s = tchRoster.filter(function(x){ return String(x.regNo) === String(regNo); })[0] || {};
    var reasonBox = document.querySelector('.tch-reason-box[data-regno="' + regNo + '"]');
    absentList.push({regNo: regNo, studentId: s.studentId||'', fullName: s.fullName||'', reason: reasonBox ? reasonBox.value : ''});
  });
  document.getElementById('tch_attStatus').textContent = '⏳ Saving...';
  var data = { action:'saveAttendance', iyatta: currentUser.iyatta, tukdi: currentUser.tukdi, date: date,
    absentJson: JSON.stringify(absentList), markedBy: currentUser.username };
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      document.getElementById('tch_attStatus').textContent = '✅ Attendance Save झाली (' + absentList.length + ' अनुपस्थित).';
      tchAbsentToday = absentList;
      tchRenderAttContactList(absentList);
      tchLoadDashboard();
      tchLoadSummary();
    } else {
      document.getElementById('tch_attStatus').textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}

function tchRenderAttContactList(list) {
  var el = document.getElementById('tch_attContactList');
  if (!list.length) { el.innerHTML = 'आज सर्व विद्यार्थी उपस्थित आहेत. 🎉'; return; }
  el.innerHTML = list.map(function(a) {
    var s = tchRoster.filter(function(x){ return String(x.regNo) === String(a.regNo); })[0] || {};
    var msg = encodeURIComponent('नमस्कार, आपला पाल्य ' + a.fullName + ' आज शाळेत अनुपस्थित आहे. कृपया कारण कळवा. - ' + (currentUser.label||'वर्ग शिक्षक'));
    function actionLinks(rawNum) {
      var num = (rawNum||'').toString().replace(/[^0-9]/g,'');
      if (!num) return '';
      var waNum = num.length === 10 ? '91' + num : num;
      return ' &nbsp; <a href="tel:' + num + '" style="color:#90c0ff">📞 Call (' + num + ')</a>' +
        ' &nbsp; <a href="sms:' + num + '?body=' + msg + '" style="color:#e8b05a">💬 SMS (' + num + ')</a>' +
        ' &nbsp; <a href="https://wa.me/' + waNum + '?text=' + msg + '" target="_blank" rel="noopener" style="color:#7be08a">🟢 WhatsApp (' + num + ')</a>';
    }
    var waLinks = actionLinks(s.whatsappMobile);
    var altLinks = actionLinks(s.alternateMobile);
    var linksHtml = (waLinks || altLinks) ? (waLinks + altLinks) : ' <span style="opacity:.6">(WhatsApp/Alternate क्रमांक नोंदवलेला नाही)</span>';
    return '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.1)">' +
      '<b>' + a.fullName + '</b> (Roll: ' + (s.rollNo||'') + ')' + (a.reason ? ' — ' + a.reason : '') +
      linksHtml +
      '</div>';
  }).join('');
}

function tchLoadReport() {
  var from = document.getElementById('tch_rptFrom').value;
  var to = document.getElementById('tch_rptTo').value;
  if (!from || !to) { alert('⚠️ दोन्ही तारखा निवडा.'); return; }
  jsonpRequest({action:'getAttendance', iyatta: currentUser.iyatta, tukdi: currentUser.tukdi, dateFrom: from, dateTo: to}, function(r) {
    var tbody = document.getElementById('tch_rptTbody');
    if (!r || r.status !== 'ok' || !r.data.length) { tbody.innerHTML = '<tr><td colspan="3">या कालावधीत कोणीही अनुपस्थित नाही.</td></tr>'; return; }
    tbody.innerHTML = r.data.map(function(a) {
      return '<tr><td>' + tchFmtDate(a.date) + '</td><td>' + a.fullName + ' (' + a.regNo + ')</td><td>' + (a.reason||'—') + '</td></tr>';
    }).join('');
  });
}

// ---- Student Diary ----
function tchPopulateDiaryStudentSelect() {
  var sel = document.getElementById('tch_diaryStudent');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- विद्यार्थी निवडा --</option>' +
    tchRoster.map(function(s){ return '<option value="' + s.regNo + '">' + (s.rollNo||'') + ' - ' + s.fullName + '</option>'; }).join('');
}

function tchInitDiaryTab() {
  if (!tchRoster.length) tchLoadRoster(function(){ tchPopulateDiaryStudentSelect(); });
}

function tchLoadDiaryForStudent() {
  var regNo = document.getElementById('tch_diaryStudent').value;
  tchSelectedStudent = tchRoster.filter(function(x){ return String(x.regNo) === String(regNo); })[0] || null;
  document.getElementById('tch_native').value = '';
  document.getElementById('tch_travelMode').value = '';
  document.getElementById('tch_transportContact').value = '';
  document.getElementById('tch_diaryHistory').innerHTML = '⏳ Load होत आहे...';
  if (!regNo) { document.getElementById('tch_diaryHistory').innerHTML = 'आधी विद्यार्थी निवडा.'; return; }
  jsonpRequest({action:'getTransport', regNo: regNo}, function(r) {
    if (r && r.status === 'ok' && r.data.length) {
      document.getElementById('tch_native').value = r.data[0].nativeVillage || '';
      document.getElementById('tch_travelMode').value = r.data[0].travelMode || '';
      document.getElementById('tch_transportContact').value = r.data[0].transportContact || '';
    }
  });
  jsonpRequest({action:'getDiary', regNo: regNo}, function(r) {
    var el = document.getElementById('tch_diaryHistory');
    if (!r || r.status !== 'ok' || !r.data.length) { el.innerHTML = 'अद्याप कोणतीही नोंद नाही.'; return; }
    var typeLabel = {positive:'👍 Positive', warning:'⚠️ Warning', scholarship:'🎓 Scholarship', personal:'📝 वैयक्तिक नोंदी'};
    el.innerHTML = r.data.map(function(d) {
      return '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.1)">' +
        '<b>' + (typeLabel[d.type]||d.type) + '</b> <span style="opacity:.6;font-size:11px">(' + tchFmtDate(d.date) + ')</span><br>' + d.remark + '</div>';
    }).join('');
  });
}

function tchSaveTransport() {
  if (!tchSelectedStudent) { document.getElementById('tch_transportStatus').textContent = '⚠️ आधी विद्यार्थी निवडा.'; return; }
  var data = { action:'saveTransport', regNo: tchSelectedStudent.regNo, studentId: tchSelectedStudent.studentId,
    fullName: tchSelectedStudent.fullName, iyatta: currentUser.iyatta, tukdi: currentUser.tukdi,
    nativeVillage: document.getElementById('tch_native').value.trim(),
    travelMode: document.getElementById('tch_travelMode').value,
    transportContact: document.getElementById('tch_transportContact').value.trim(),
    updatedBy: currentUser.username };
  document.getElementById('tch_transportStatus').textContent = '⏳ Saving...';
  smartSave(data, function(r) {
    document.getElementById('tch_transportStatus').textContent = (r && r.status === 'ok') ? '✅ Save झाले.' : '❌ ' + (r && r.message ? r.message : 'Failed');
  });
}

function tchSaveDiaryRemark() {
  if (!tchSelectedStudent) { document.getElementById('tch_diaryStatus').textContent = '⚠️ आधी विद्यार्थी निवडा.'; return; }
  var remark = document.getElementById('tch_remarkText').value.trim();
  if (!remark) { document.getElementById('tch_diaryStatus').textContent = '⚠️ तपशील लिहा.'; return; }
  var data = { action:'saveDiary', regNo: tchSelectedStudent.regNo, studentId: tchSelectedStudent.studentId,
    fullName: tchSelectedStudent.fullName, iyatta: currentUser.iyatta, tukdi: currentUser.tukdi,
    type: document.getElementById('tch_remarkType').value, remark: remark, enteredBy: currentUser.username };
  document.getElementById('tch_diaryStatus').textContent = '⏳ Saving...';
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      document.getElementById('tch_diaryStatus').textContent = '✅ जोडले गेले.';
      document.getElementById('tch_remarkText').value = '';
      tchLoadDiaryForStudent();
    } else {
      document.getElementById('tch_diaryStatus').textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}

// ---- Fees (Class Teacher entry — टप्प्याटप्प्याने जमा, तारखेसह लॉग) ----
var tchFeesData = [];
var tchTotalFeePerStudent = 1000;

function tchLoadFees() {
  if (!tchRoster.length) { tchLoadRoster(function(){ tchPopulateFeesStudentSelect(); tchLoadFeesTable(); }); return; }
  tchPopulateFeesStudentSelect();
  tchLoadFeesTable();
}

function tchPopulateFeesStudentSelect() {
  var sel = document.getElementById('tch_feesStudent');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- विद्यार्थी निवडा --</option>' +
    tchRoster.map(function(s){ return '<option value="' + s.regNo + '">' + (s.rollNo||'') + ' - ' + s.fullName + '</option>'; }).join('');
}

function tchLoadFeesForStudent() {
  var regNo = document.getElementById('tch_feesStudent').value;
  var statBox = document.getElementById('tch_studentFeeStat');
  if (!regNo) { statBox.style.display = 'none'; return; }
  tchRenderStudentFeeStat(regNo);
  statBox.style.display = 'block';
}

function tchRenderStudentFeeStat(regNo) {
  var s = tchRoster.filter(function(x){ return String(x.regNo) === String(regNo); })[0] || {};
  var entries = tchFeesData.filter(function(f){ return String(f.regNo) === String(regNo); });
  var paid = entries.reduce(function(sum,f){ return sum + (parseFloat(f.amountPaid)||0); }, 0);
  var pending = Math.max(0, tchTotalFeePerStudent - paid);
  document.getElementById('tch_studentFeeName').textContent = (s.rollNo||'') + ' - ' + (s.fullName||'');
  document.getElementById('tch_studentFeePaid').textContent = '₹' + paid;
  document.getElementById('tch_studentFeePending').textContent = '₹' + pending;
  document.getElementById('tch_totalFeeAmt').textContent = tchTotalFeePerStudent;
  var hist = document.getElementById('tch_studentFeeHistory');
  hist.innerHTML = entries.length ? ('<b>जमा इतिहास:</b><br>' + entries.map(function(f) {
    return tchFmtDate(f.date) + ' — ₹' + f.amountPaid + ' (' + (f.enteredBy||'') + ')';
  }).join('<br>')) : 'अद्याप कोणतीही जमा नोंद नाही.';
}

function tchSaveFees() {
  var regNo = document.getElementById('tch_feesStudent').value;
  if (!regNo) { document.getElementById('tch_feesEntryStatus').textContent = '⚠️ आधी विद्यार्थी निवडा.'; return; }
  var s = tchRoster.filter(function(x){ return String(x.regNo) === String(regNo); })[0] || {};
  var amount = document.getElementById('tch_feesAmount').value;
  if (!amount || parseFloat(amount) <= 0) { document.getElementById('tch_feesEntryStatus').textContent = '⚠️ जमा रक्कम बरोबर टाका.'; return; }
  var data = { action:'saveFees', regNo: regNo, studentId: s.studentId||'', fullName: s.fullName||'',
    iyatta: currentUser.iyatta, tukdi: currentUser.tukdi, teacherIyatta: currentUser.iyatta, teacherTukdi: currentUser.tukdi,
    amountPaid: amount, enteredBy: currentUser.username,
    requesterUser: currentUser.username, requesterRole: currentUser.role };
  document.getElementById('tch_feesEntryStatus').textContent = '⏳ Saving...';
  smartSave(data, function(r) {
    if (r && r.status === 'ok') {
      document.getElementById('tch_feesEntryStatus').textContent = '✅ जमा नोंद Save झाली.';
      document.getElementById('tch_feesAmount').value = '';
      tchLoadFeesTable(regNo);
    } else {
      document.getElementById('tch_feesEntryStatus').textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  });
}

function tchLoadFeesTable(reselectRegNo) {
  jsonpRequest({action:'getFees', iyatta: currentUser.iyatta, tukdi: currentUser.tukdi}, function(r) {
    var tbody = document.getElementById('tch_feesTbody');
    if (!r || r.status !== 'ok') { tbody.innerHTML = '<tr><td colspan="4">Load Failed</td></tr>'; return; }
    tchFeesData = r.data || [];
    tchTotalFeePerStudent = r.totalFeePerStudent || 1000;
    var classTotal = tchFeesData.reduce(function(sum,f){ return sum + (parseFloat(f.amountPaid)||0); }, 0);
    document.getElementById('tch_classFeesTotal').textContent = '₹' + classTotal;
    if (!tchRoster.length) { tbody.innerHTML = '<tr><td colspan="4">विद्यार्थी यादी उपलब्ध नाही.</td></tr>'; }
    else {
      tbody.innerHTML = tchRoster.map(function(s) {
        var entries = tchFeesData.filter(function(f){ return String(f.regNo) === String(s.regNo); });
        var paid = entries.reduce(function(sum,f){ return sum + (parseFloat(f.amountPaid)||0); }, 0);
        var pending = Math.max(0, tchTotalFeePerStudent - paid);
        var pendingStyle = pending > 0 ? 'color:#ff9090;font-weight:700' : 'color:#7be08a';
        return '<tr><td>' + (s.rollNo||'') + '</td><td>' + s.fullName + '</td><td>₹' + paid + '</td><td style="' + pendingStyle + '">₹' + pending + '</td></tr>';
      }).join('');
    }
    if (reselectRegNo) tchRenderStudentFeeStat(reselectRegNo);
  });
}

// ---- Notices (read-only feed) ----
function tchLoadNoticesFull() {
  jsonpRequest({action:'getNotices', targetClass: currentUser.iyatta + '|' + currentUser.tukdi, limit: 50}, function(r) {
    var el = document.getElementById('tch_noticesFull');
    if (!r || r.status !== 'ok' || !r.data.length) { el.innerHTML = 'सध्या कोणतीही सूचना नाही.'; return; }
    el.innerHTML = r.data.map(function(n) {
      return '<div class="card" style="margin-bottom:10px"><div class="card-body">' +
        '<b>' + n.title + '</b> <span style="opacity:.6;font-size:11px">(' + tchFmtDate(n.date) + ' — ' + n.postedBy + ')</span><br>' + n.message + '</div></div>';
    }).join('');
  });
}
var _anaGenderChart = null, _anaLcChart = null;
function loadAnalytics() {
  var url = getUrl();
  var loading = document.getElementById('anaLoading');
  var body = document.getElementById('anaBody');
  if (!url) { if (loading) loading.textContent = '⚠️ आधी URL Set करा.'; return; }
  if (loading) { loading.style.display = 'block'; loading.textContent = '⏳ Analytics Data Load होत आहे...'; }
  if (body) body.style.display = 'none';
  var cb = 'anaCb_' + Date.now();
  window[cb] = function(r) {
    delete window[cb];
    if (r && r.status === 'ok') {
      renderAnalytics(r);
      if (loading) loading.style.display = 'none';
      if (body) body.style.display = 'block';
    } else {
      if (loading) loading.textContent = '❌ ' + (r && r.message ? r.message : 'Failed');
    }
  };
  var s = document.createElement('script');
  s.src = url + '?action=getAnalyticsData&callback=' + cb + '&t=' + Date.now();
  document.head.appendChild(s);
}
function renderBarList(containerId, counts) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var entries = Object.keys(counts || {}).map(function(k){ return [k, counts[k]]; }).sort(function(a,b){ return b[1]-a[1]; });
  var max = 1;
  entries.forEach(function(e){ if (e[1] > max) max = e[1]; });
  if (!entries.length) { el.innerHTML = '<div style="font-size:12px;opacity:.6">माहिती उपलब्ध नाही.</div>'; return; }
  el.innerHTML = entries.map(function(e) {
    var pct = Math.round((e[1]/max)*100);
    return '<div class="bar-chart-row"><div class="bcr-lbl" style="width:90px">' + e[0] + '</div>'
      + '<div class="bcr-track"><div class="bcr-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="bcr-val">' + e[1] + '</div></div>';
  }).join('');
}
function renderAnalytics(r) {
  renderBarList('anaAdmissions', r.admissionsByYear || {});
  renderBarList('anaReligion', r.religionCounts || {});
  renderBarList('anaCaste', r.casteCounts || {});

  if (typeof Chart !== 'undefined') {
    var gCtx = document.getElementById('anaGenderChart');
    var gData = r.genderCounts || {};
    if (_anaGenderChart) _anaGenderChart.destroy();
    if (gCtx) {
      _anaGenderChart = new Chart(gCtx, {
        type: 'pie',
        data: { labels: Object.keys(gData), datasets: [{ data: Object.values(gData), backgroundColor: ['#d4902a','#1a4a7a','#1a7a3a','#7a1a1a'] }] },
        options: { plugins: { legend: { labels: { color: '#f0e8d8' } } } }
      });
    }
    var lCtx = document.getElementById('anaLcChart');
    var lData = r.lcReasonCounts || {};
    if (_anaLcChart) _anaLcChart.destroy();
    if (lCtx) {
      _anaLcChart = new Chart(lCtx, {
        type: 'pie',
        data: { labels: Object.keys(lData), datasets: [{ data: Object.values(lData), backgroundColor: ['#c0521a','#1a7a3a','#555'] }] },
        options: { plugins: { legend: { labels: { color: '#f0e8d8' } } } }
      });
    }
  }
}

</script>

<!-- ===== SAVE NOTIFICATION POPUP ===== -->
<style>
#sgsNotifBg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998}
#sgsNotif{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.85);
  z-index:99999;background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.4);
  padding:28px 36px;text-align:center;min-width:280px;max-width:380px;
  transition:transform .2s,opacity .2s;opacity:0}
#sgsNotif.show{transform:translate(-50%,-50%) scale(1);opacity:1}
#sgsNotif .sni{font-size:44px;display:block;margin-bottom:8px}
#sgsNotif .snt{font-size:18px;font-weight:800;margin-bottom:6px;color:#1a1a2a}
#sgsNotif .sns{font-size:26px;font-weight:900;color:#1a5a1a;background:#e8f8e8;
  border-radius:8px;padding:8px 18px;margin:10px 0;letter-spacing:2px;display:none}
#sgsNotif .snm{font-size:13px;color:#666;margin-top:6px}
#sgsNotif .snc{margin-top:14px;background:#1a3a6a;color:#fff;border:none;
  border-radius:8px;padding:9px 28px;font-size:14px;cursor:pointer;font-weight:700}
</style>
<div id="sgsNotifBg" onclick="closeSaveNotif()"></div>
<div id="sgsNotif">
  <span class="sni" id="sgsIcon">✅</span>
  <div class="snt" id="sgsTitle">माहिती Save झाली!</div>
  <div class="sns" id="sgsSerial"></div>
  <div class="snm" id="sgsMsg"></div>
  <button class="snc" onclick="closeSaveNotif()">ठीक आहे</button>
</div>
<script>
function showSaveNotif(icon,title,serial,label,msg){
  var el=function(id){return document.getElementById(id);};
  el('sgsIcon').textContent=icon||'✅';
  el('sgsTitle').textContent=title||'Save झाले!';
  el('sgsTitle').style.color='';
  document.getElementById('sgsNotif').style.borderTop='';
  var s=el('sgsSerial');
  if(serial){s.style.display='block';s.textContent=(label||'क्र.')+' : '+serial;}
  else s.style.display='none';
  el('sgsMsg').textContent=msg||'';
  el('sgsNotifBg').style.display='block';
  el('sgsNotif').style.display='block';
  setTimeout(function(){el('sgsNotif').classList.add('show');},20);
  clearTimeout(window._sgsNT);
  window._sgsNT=setTimeout(closeSaveNotif,5000);
}
function showSaveError(msg){
  showSaveNotif('❌','Error!','','',msg||'Save झाले नाही.');
  document.getElementById('sgsTitle').style.color='#8a1a1a';
  document.getElementById('sgsNotif').style.borderTop='4px solid #cc2222';
}
function closeSaveNotif(){
  clearTimeout(window._sgsNT);
  var b=document.getElementById('sgsNotif');
  b.classList.remove('show');
  setTimeout(function(){
    b.style.display='none';
    document.getElementById('sgsNotifBg').style.display='none';
  },220);
}
