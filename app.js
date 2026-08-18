/* ============================================================
   찍어줄게 — 앱 로직
   저장은 전부 이 기기 안(localStorage). 사진은 어디에도 업로드하지 않는다.
   ============================================================ */
(function () {
'use strict';

/* ---------------- 저장소 ---------------- */
const KEY = 'jjik.v1';
const DEF = {
  favs: [],                 // 좋아요한 구도/포즈 id
  log: {},                  // '2026-08-17': ['full','face']  (오늘 5컷 체크)
  days: [],                 // 촬영한 날짜 목록
  notif: { on: false, days: [1, 2, 3, 4, 5, 6, 0], time: '17:30', lastFired: '' },
  lastPurpose: 'ig_feed',
  mode: 'solo',
  place: null,
  dday: null,          // 'YYYY-MM-DD' 사귄 날 (선택 — 친구끼리 써도 되니까)
  ddayLabel: '사귄 날',
};
let S = load();
function load() {
  try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { return Object.assign({}, DEF); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* ---------------- 추억 앨범 저장소 (사진도 전부 이 기기 안에만) ---------------- */
let _db = null;
const MEMCACHE = {};
function memDB() {
  return new Promise((res, rej) => {
    if (_db) return res(_db);
    const rq = indexedDB.open('jjik-mem', 2);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('mem')) db.createObjectStore('mem', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('exam')) db.createObjectStore('exam', { keyPath: 'id' });
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}
/* 구도별 AI 예시 사진 저장 (한 번 만들면 계속 재사용) */
function examGet(id) {
  return memDB().then((db) => new Promise((res) => {
    const r = db.transaction('exam').objectStore('exam').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  })).catch(() => null);
}
function examPut(id, blob) {
  return memDB().then((db) => new Promise((res, rej) => {
    const tx = db.transaction('exam', 'readwrite');
    tx.objectStore('exam').put({ id, blob });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  }));
}
function memAdd(rec) {
  return memDB().then((db) => new Promise((res, rej) => {
    const tx = db.transaction('mem', 'readwrite');
    const r = tx.objectStore('mem').add(rec);
    r.onsuccess = () => res(r.result);
    tx.onerror = () => rej(tx.error);
  }));
}
function memAll() {
  return memDB().then((db) => new Promise((res, rej) => {
    const r = db.transaction('mem').objectStore('mem').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  })).catch(() => []);
}
function memDel(id) {
  return memDB().then((db) => new Promise((res, rej) => {
    const tx = db.transaction('mem', 'readwrite');
    tx.objectStore('mem').delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  }));
}
function memUrl(rec) {
  if (!MEMCACHE[rec.id]) MEMCACHE[rec.id] = URL.createObjectURL(rec.blob);
  return MEMCACHE[rec.id];
}
function shrinkBlob(img, max) {
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.naturalWidth * r); cv.height = Math.round(img.naturalHeight * r);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.86));
}
function placeName(id) { const p = SITUATIONS.find((x) => x.id === id); return p ? p.emoji + ' ' + p.name : ''; }
function daysAgo(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(today() + 'T00:00:00');
  return Math.round((t - d) / 864e5);
}

/* ---------------- 잡 유틸 ---------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const pad = (n) => (n < 10 ? '0' : '') + n;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];
function dayHash(extra) {
  const s = today() + (extra || '');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 1900);
}
function purposeOf(id) { return PURPOSES.find((p) => p.id === id) || PURPOSES[0]; }

/* ---------------- 해 시간 계산(오프라인) ---------------- */
function sunTimes(date, lat, lng) {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545;
  const toJulian = (d) => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const toDays = (d) => toJulian(d) - J2000;
  const e = rad * 23.4397;
  const dec = (l) => Math.asin(Math.sin(e) * Math.sin(l));
  const M0 = (d) => rad * (357.5291 + 0.98560028 * d);
  const ecl = (M) => M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = M0(ds), L = ecl(M), dd = dec(L);
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  function t(h) {
    const cosH = (Math.sin(rad * h) - Math.sin(phi) * Math.sin(dd)) / (Math.cos(phi) * Math.cos(dd));
    if (cosH < -1 || cosH > 1) return null;
    const w = Math.acos(cosH);
    const a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
    const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    return { set: fromJulian(Jset), rise: fromJulian(Jnoon - (Jset - Jnoon)) };
  }
  const h0 = t(-0.833), g = t(6), b = t(-4);
  return {
    sunrise: h0 && h0.rise, sunset: h0 && h0.set,
    goldenStart: g && g.set, goldenEndRise: g && g.rise,
    blueEnd: b && b.set,
  };
}
const hhmm = (d) => d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '--:--';
const minusMin = (d, m) => new Date(d.getTime() - m * 60000);

let COORD = { lat: 37.5665, lng: 126.978, name: '서울 기준' };
try {
  const saved = JSON.parse(localStorage.getItem(KEY + '.geo') || 'null');
  if (saved) COORD = saved;
} catch (e) {}
function askGeo() {
  if (!navigator.geolocation) { toast('이 기기에서는 위치를 못 가져와요'); return; }
  navigator.geolocation.getCurrentPosition((p) => {
    COORD = { lat: p.coords.latitude, lng: p.coords.longitude, name: '현재 위치' };
    try { localStorage.setItem(KEY + '.geo', JSON.stringify(COORD)); } catch (e) {}
    toast('현재 위치로 해 시간을 다시 계산했어요');
    render();
  }, () => toast('위치를 못 받았어요. 서울 기준으로 보여드려요'), { timeout: 8000 });
}

/* ---------------- 구도 미리보기 그림 ---------------- */
function figureSVG(f, W, H) {
  const h = f.h * H, x = f.cx * W, bottom = f.bottom * H;
  const top = bottom - h;
  const hr = h * 0.105;
  const col = f.back ? 'rgba(233,166,160,.45)' : 'rgba(233,166,160,.72)';
  let s = '';
  s += `<circle cx="${x.toFixed(1)}" cy="${(top + hr).toFixed(1)}" r="${hr.toFixed(1)}" fill="${col}"/>`;
  const bw = h * 0.165, bTop = top + hr * 2.1, bBot = f.sit ? bottom - h * 0.1 : top + h * 0.52;
  s += `<rect x="${(x - bw / 2).toFixed(1)}" y="${bTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bBot - bTop).toFixed(1)}" rx="${(bw / 2.4).toFixed(1)}" fill="${col}"/>`;
  if (!f.sit && bottom - bBot > 2) {
    const lw = h * 0.055;
    s += `<rect x="${(x - bw * 0.32).toFixed(1)}" y="${bBot.toFixed(1)}" width="${lw.toFixed(1)}" height="${(bottom - bBot).toFixed(1)}" rx="${(lw / 2).toFixed(1)}" fill="${col}"/>`;
    s += `<rect x="${(x + bw * 0.32 - lw).toFixed(1)}" y="${bBot.toFixed(1)}" width="${lw.toFixed(1)}" height="${(bottom - bBot).toFixed(1)}" rx="${(lw / 2).toFixed(1)}" fill="${col}"/>`;
  }
  if (f.sit) {
    s += `<rect x="${(x - bw * 0.1).toFixed(1)}" y="${(bottom - h * 0.16).toFixed(1)}" width="${(h * 0.42).toFixed(1)}" height="${(h * 0.06).toFixed(1)}" rx="3" fill="${col}"/>`;
  }
  return s;
}
function guideSVG(g, big, overlay) {
  const W = 100, H = 125;
  const line = overlay ? 'stroke="rgba(255,255,255,.65)" stroke-width=".7"' : 'stroke="rgba(255,255,255,.22)" stroke-width=".7"';
  let s = `<svg viewBox="0 0 ${W} ${H}" ${overlay ? 'preserveAspectRatio="none" style="width:100%;height:100%"' : ''} xmlns="http://www.w3.org/2000/svg">`;
  if (!overlay) s += `<rect width="${W}" height="${H}" fill="#100e0e"/>`;
  if (g.sun) s += `<circle cx="${g.sun.x * W}" cy="${g.sun.y * H}" r="9" fill="rgba(230,197,138,.35)"/><circle cx="${g.sun.x * W}" cy="${g.sun.y * H}" r="4" fill="rgba(230,197,138,.8)"/>`;
  if (g.horizon != null) s += `<line x1="0" y1="${g.horizon * H}" x2="${W}" y2="${g.horizon * H}" stroke="rgba(140,190,220,.55)" stroke-width="1"/>`;
  if (g.mirror) s += `<rect y="${0.5 * H}" width="${W}" height="${0.5 * H}" fill="rgba(120,160,200,.10)"/><line x1="0" y1="${0.5 * H}" x2="${W}" y2="${0.5 * H}" stroke="rgba(140,190,220,.5)" stroke-width="1"/>`;
  if (g.lines === 'perspective') {
    s += `<path d="M0 ${H} L${W * 0.4} ${H * 0.6} L${W * 0.6} ${H * 0.6} L${W} ${H} Z" fill="rgba(255,255,255,.05)"/>`;
    s += `<line x1="0" y1="${H}" x2="${W * 0.42} " y2="${H * 0.58}" ${line}/><line x1="${W}" y1="${H}" x2="${W * 0.58}" y2="${H * 0.58}" ${line}/>`;
  }
  if (g.frameArch) {
    s += `<path d="M0 0 H${W} V${H} H0 Z M14 22 H86 V${H} H14 Z" fill="rgba(90,70,60,.55)" fill-rule="evenodd"/>`;
    s += `<path d="M14 22 Q50 -6 86 22" fill="none" stroke="rgba(90,70,60,.9)" stroke-width="8"/>`;
  }
  if (g.thirds) {
    [1 / 3, 2 / 3].forEach((t) => {
      s += `<line x1="${t * W}" y1="0" x2="${t * W}" y2="${H}" ${line} stroke-dasharray="2 3"/>`;
      s += `<line x1="0" y1="${t * H}" x2="${W}" y2="${t * H}" ${line} stroke-dasharray="2 3"/>`;
    });
  }
  if (g.shadow) {
    s += `<ellipse cx="34" cy="104" rx="9" ry="4" fill="rgba(233,166,160,.5)"/><ellipse cx="62" cy="104" rx="9" ry="4" fill="rgba(233,166,160,.5)"/>`;
    s += `<path d="M30 100 L20 60 M66 100 L76 60" stroke="rgba(233,166,160,.35)" stroke-width="7" stroke-linecap="round"/>`;
  }
  if (g.blob) s += `<circle cx="52" cy="66" r="22" fill="rgba(233,166,160,.55)"/><circle cx="52" cy="66" r="34" fill="rgba(233,166,160,.12)"/>`;
  if (g.center) s += `<line x1="50" y1="0" x2="50" y2="${H}" stroke="rgba(230,197,138,.6)" stroke-width="1" stroke-dasharray="4 2"/>`;
  if (g.through) s += `<ellipse cx="8" cy="70" rx="22" ry="55" fill="rgba(120,100,90,.55)"/><ellipse cx="95" cy="55" rx="18" ry="50" fill="rgba(120,100,90,.5)"/>`;
  if (g.food) s += `<ellipse cx="50" cy="106" rx="34" ry="14" fill="rgba(230,197,138,.4)"/><ellipse cx="50" cy="103" rx="24" ry="9" fill="rgba(230,197,138,.55)"/>`;
  (g.figures || []).forEach((f) => { s += figureSVG(f, W, H); });
  (g.marks || []).forEach((m) => {
    if (m.type === 'hline') {
      s += `<line x1="0" y1="${m.y * H}" x2="${W}" y2="${m.y * H}" stroke="var(--gold,#e6c58a)" stroke-width="1" stroke-dasharray="4 2"/>`;
      if (big || overlay) s += `<text x="3" y="${(m.y * H - 3).toFixed(1)}" fill="#e6c58a" font-size="${overlay ? 4.5 : 6}">${esc(m.label)}</text>`;
    }
  });
  if (!overlay) s += `<rect width="${W}" height="${H}" fill="none" stroke="rgba(255,255,255,.12)"/>`;
  s += '</svg>';
  return s;
}

/* ---------------- 라우팅 ---------------- */
let TAB = 'home';
let SUB = 'compo';

function render() {
  const v = $('#view');
  v.scrollTop = 0;
  if (TAB === 'home') v.innerHTML = viewHome();
  else if (TAB === 'shoot') v.innerHTML = viewShoot();
  else if (TAB === 'edit') v.innerHTML = viewEdit();
  else if (TAB === 'notify') v.innerHTML = viewNotify();
  else if (TAB === 'saved') v.innerHTML = viewSaved();
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === TAB));
  if (TAB === 'edit') editorMount();
  if (TAB === 'home') fillHomeMem();
  if (TAB === 'saved') fillMemGrid();
  window.scrollTo(0, 0);
}

/* ---- 홈: 추억 회상 카드 ---- */
function fillHomeMem() {
  const box = $('#homeMem'); if (!box) return;
  memAll().then((list) => {
    if (!$('#homeMem')) return;
    if (!list.length) { box.innerHTML = ''; return; }
    const mmdd = today().slice(5);
    // 같은 날짜(월-일)의 과거 추억이 있으면 우선, 없으면 가장 오래된 것부터 하루씩 돌아가며
    let m = list.find((x) => x.date.slice(5) === mmdd && x.date !== today());
    let label;
    if (m) label = (daysAgo(m.date) >= 365 ? Math.round(daysAgo(m.date) / 365) + '년 전 오늘' : daysAgo(m.date) + '일 전 오늘');
    else { m = list[dayHash('mem') % list.length]; const d = daysAgo(m.date); label = d === 0 ? '오늘 남긴 추억' : d + '일 전 이날'; }
    box.innerHTML = `<h2 class="sec">그날의 우리</h2>
      <div class="card" data-act="memOpen" data-id="${m.id}">
        <div style="display:flex;gap:13px;align-items:center">
          <img src="${memUrl(m)}" alt="추억" style="width:74px;height:74px;object-fit:cover;border-radius:12px;flex:0 0 74px">
          <div style="min-width:0">
            <div class="card-t">${esc(label)}</div>
            <div class="card-s">${m.placeId ? esc(placeName(m.placeId)) + ' · ' : ''}${esc(m.note || m.date)}</div>
          </div>
        </div>
      </div>`;
    list.forEach((x) => { MEMCACHE['rec' + x.id] = x; });
  });
}

/* ---- 보관함: 추억 앨범 그리드 ---- */
function fillMemGrid() {
  const box = $('#memGrid'); if (!box) return;
  memAll().then((list) => {
    if (!$('#memGrid')) return;
    if (!list.length) { box.innerHTML = `<div class="empty" style="padding:20px">아직 추억이 없어요.<br>제일 잘 나온 사진을 여기 모아두면, 홈에서 "그날의 우리"로 다시 만나요.</div>`; return; }
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    box.innerHTML = `<div class="memgrid">` + list.map((m) =>
      `<div class="memcell" data-act="memOpen" data-id="${m.id}">
        <img src="${memUrl(m)}" alt="추억">
        <div class="memdate">${esc(m.date.slice(2).replace(/-/g, '.'))}</div>
      </div>`).join('') + `</div>`;
    list.forEach((x) => { MEMCACHE['rec' + x.id] = x; });
  });
}
function memOpen(id) {
  const m = MEMCACHE['rec' + id]; if (!m) return;
  const d = daysAgo(m.date);
  let ddayLine = '';
  if (S.dday && m.date >= S.dday) ddayLine = ' · ' + esc(S.ddayLabel) + '부터 ' + (daysAgo(S.dday) - d + 1) + '일째 되던 날';
  sheet(`<h3>${esc(m.date.replace(/-/g, '. '))}</h3>
    <div class="card-s">${d === 0 ? '오늘' : d + '일 전'}${m.placeId ? ' · ' + esc(placeName(m.placeId)) : ''}${m.people ? ' · ' + esc(m.people) + '랑' : ''}${ddayLine}</div>
    <img src="${memUrl(m)}" alt="추억" style="width:100%;border-radius:14px;margin:13px 0">
    ${m.note ? `<div class="saybox"><b>그날의 한 줄</b>${esc(m.note)}</div>` : ''}
    <div class="rowbtns"><button class="btn ghost sm" data-act="memDel" data-id="${m.id}">이 추억 지우기</button></div>`);
}
function memAddSheet(prefillBlob) {
  PENDING_MEM = prefillBlob || null;
  sheet(`<h3>추억 남기기</h3>
    <div class="card-s">사진·날짜·장소·한 줄이면 충분해요. 전부 이 기기 안에만 저장됩니다.</div>
    ${prefillBlob ? '<div class="badge pt" style="margin-top:10px">방금 보정한 사진으로 저장</div>' : `
    <label class="drop" style="display:block;margin-top:12px;padding:20px">
      <b>사진 고르기</b><span class="dim" id="memFileName">눌러서 선택</span>
      <input type="file" accept="image/*" id="memFile" hidden>
    </label>`}
    <h2 class="sec">언제</h2>
    <input class="timeinput" type="date" id="memDate" value="${today()}">
    <h2 class="sec">어디서</h2>
    <div class="chips wrap" id="memPlaceChips">${SITUATIONS.map((x) => `<button class="chip" data-memplace="${x.id}">${x.emoji} ${esc(x.name)}</button>`).join('')}</div>
    <h2 class="sec">누구랑</h2>
    <div class="chips wrap" id="memPeopleChips">${PEOPLE.map((x) => `<button class="chip ${MEM_PEOPLE === x ? 'on' : ''}" data-mempeople="${x}">${esc(x)}</button>`).join('')}</div>
    <h2 class="sec">그날의 한 줄 (기념일·메모)</h2>
    <input class="timeinput" type="text" id="memNote" maxlength="80" placeholder="예: 200일. 처음 같이 간 전시회">
    <div class="rowbtns" style="margin-top:16px"><button class="btn pt" data-act="memSave">추억으로 저장</button></div>`);
}
let PENDING_MEM = null;
let MEM_PLACE = null;
let MEM_PEOPLE = '여자친구';
let LAST_EXPORT = null;
function memSave() {
  const dateV = ($('#memDate') && $('#memDate').value) || today();
  const noteV = ($('#memNote') && $('#memNote').value || '').trim();
  const finish = (blob) => {
    memAdd({ date: dateV, placeId: MEM_PLACE, people: MEM_PEOPLE, note: noteV, blob }).then(() => {
      PENDING_MEM = null; MEM_PLACE = null;
      closeSheet(); toast('추억으로 저장했어요 ♥');
      if (TAB === 'saved') fillMemGrid();
      if (TAB === 'home') fillHomeMem();
    }).catch(() => toast('저장에 실패했어요. 다시 해보세요'));
  };
  if (PENDING_MEM) { finish(PENDING_MEM); return; }
  const fi = $('#memFile');
  const f = fi && fi.files && fi.files[0];
  if (!f) { toast('사진을 먼저 골라주세요'); return; }
  const img = new Image();
  img.onload = () => shrinkBlob(img, 1400).then(finish);
  img.onerror = () => toast('사진을 못 읽었어요');
  img.src = URL.createObjectURL(f);
}

/* ================= 홈 ================= */
function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '늦은 밤이네요';
  if (h < 11) return '좋은 아침이에요';
  if (h < 15) return '점심 잘 드셨나요';
  if (h < 18) return '오늘 빛이 좋은 시간이에요';
  if (h < 21) return '저녁이네요';
  return '오늘 하루 어땠나요';
}
/* 장소 추천 카드 — 홈·장소 탭에서 함께 사용 */
function placeRecipeHTML(placeId) {
  const p = SITUATIONS.find((x) => x.id === placeId);
  const rec = PLACE_REC[placeId];
  if (!p || !rec) return '';
  const compos = rec.compos
    .map((cid) => COMPOSITIONS.find((c) => c.id === cid))
    .filter((c) => c && (c.mode === S.mode || c.mode === 'both'))
    .slice(0, 3);
  const mood = MOODS.find((m) => m.id === rec.mood);
  let s = `<div class="card">
    <div class="card-t">${p.emoji} ${esc(p.name)}에서는 이렇게 추천해요</div>
    <div class="card-s" style="margin-top:4px">${esc(p.tips[0])}</div>
    <h2 class="sec" style="margin:14px 0 8px">추천 구도</h2>`;
  compos.forEach((c) => {
    s += `<div class="compo" data-act="openCompo" data-id="${c.id}" style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div class="guide" style="flex:0 0 56px">${guideSVG(c.guide)}</div>
      <div class="meta"><div class="n" style="font-weight:600">${esc(c.name)}</div>
      <div class="dim">${esc(c.tagline)}</div></div>
    </div>`;
  });
  s += `<div class="kv" style="margin-top:11px">
      <span>🎨 보정은 ${mood ? mood.emoji + ' ' + esc(mood.name) : ''} 무드</span>
    </div>
    <div class="saybox" style="margin-top:10px"><b>포즈 아이디어</b>${esc(rec.pose)}</div>
    <div class="rowbtns">
      <button class="btn pt" data-act="cam" data-id="${compos[0] ? compos[0].id : ''}">📷 바로 찍기</button>
      <button class="btn" data-act="go" data-tab="shoot" data-sub="place">팁 전부 보기</button>
    </div>
  </div>`;
  return s;
}
function viewHome() {
  const st = sunTimes(new Date(), COORD.lat, COORD.lng);
  const gStart = st.sunset ? minusMin(st.sunset, 60) : null;
  const now = new Date();
  const inGolden = gStart && now >= gStart && st.blueEnd && now <= st.blueEnd;
  const doneToday = (S.log[today()] || []);
  const streak = calcStreak();

  let s = '';
  s += `<div class="hero"><h1>${greeting()},<br><span class="accent">오늘 한 장</span> 남겨볼까요?</h1>
        <p>사진 100장 찍어서 1장 건지는 게 정상이에요. 부담 없이.</p></div>`;

  // 골든아워
  s += `<div class="card golden">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="card-t">오늘의 빛</div>
      ${inGolden ? '<span class="badge">지금이 골든아워</span>' : '<span class="badge grey">' + esc(COORD.name) + '</span>'}
    </div>
    <div class="row">
      <div class="cell"><div class="k">가장 예쁜 시간</div><div class="v">${hhmm(gStart)}~${hhmm(st.sunset)}</div></div>
      <div class="cell"><div class="k">해질 무렵 파란빛</div><div class="v">${hhmm(st.sunset)}~${hhmm(st.blueEnd)}</div></div>
    </div>
    <div class="row">
      <div class="cell"><div class="k">일출</div><div class="v">${hhmm(st.sunrise)}</div></div>
      <div class="cell"><div class="k">일몰</div><div class="v">${hhmm(st.sunset)}</div></div>
    </div>
    <div class="rowbtns"><button class="btn ghost sm" data-act="geo">내 위치로 정확하게</button></div>
  </div>`;

  // 지금 어디예요? — 장소를 고르면 바로 추천
  s += `<h2 class="sec">지금 어디서 찍어요?</h2>
  <div class="chips">${SITUATIONS.map((x) => `<button class="chip ${S.place === x.id ? 'on' : ''}" data-act="homePlace" data-id="${x.id}">${x.emoji} ${esc(x.name)}</button>`).join('')}</div>`;
  if (S.place && PLACE_REC[S.place]) s += placeRecipeHTML(S.place);
  else s += `<div class="card tight"><div class="card-s">장소를 하나 누르면 그 자리에서 바로 쓸 추천 구도·포즈·보정 무드를 알려드려요.</div></div>`;

  // 진짜 장소 이름으로 물어보기 (PRO)
  s += `<div class="card">
    <div class="card-t">✨ 진짜 그 장소는 어떻게 찍어요? <span class="pro">PRO</span></div>
    <div class="card-s" style="margin-top:4px">"성수 ○○카페", "리움미술관"처럼 <b>실제 장소 이름</b>을 넣으면 그곳의 포토스팟, 사람들이 많이 찍는 유명한 샷, 덜 붐비는 시간까지 찾아드려요.</div>
    <input class="timeinput" id="placeQ" placeholder="장소 이름 입력 (예: 성수 어니언 카페)" style="margin:10px 0 0">
    <div class="rowbtns"><button class="btn pt" data-act="placeAI">이 장소 촬영 가이드 받기</button></div>
  </div>`;

  // 디데이 (선택)
  if (S.dday) {
    const n = daysAgo(S.dday) + 1;
    const next100 = Math.ceil(n / 100) * 100;
    const nextIn = next100 - n;
    s += `<div class="card tight" data-act="ddaySet" style="display:flex;justify-content:space-between;align-items:center">
      <div><div class="card-t">♥ ${esc(S.ddayLabel)}부터 ${n}일째</div>
      <div class="card-s">${nextIn === 0 ? '오늘이 ' + next100 + '일이에요! 오늘은 꼭 한 장.' : next100 + '일까지 ' + nextIn + '일 남았어요'}</div></div>
      <span class="dim">수정</span></div>`;
  } else {
    s += `<div class="card tight" data-act="ddaySet" style="display:flex;justify-content:space-between;align-items:center">
      <div class="card-s">디데이를 등록하면 "사귄 지 며칠째"를 세어드려요 (선택)</div><span class="badge pt">등록</span></div>`;
  }

  // 추억 회상 카드 (있을 때만 채워짐)
  s += `<div id="homeMem"></div>`;

  // 5컷 체크
  s += `<h2 class="sec">오늘 이 5컷이면 완성 (${doneToday.length}/5)</h2><div class="card">`;
  SHOTLIST.forEach((k) => {
    const done = doneToday.indexOf(k.id) >= 0;
    s += `<div class="check ${done ? 'done' : ''}" data-act="check" data-id="${k.id}">
      <div class="box">✓</div><div><div class="n">${esc(k.n)}</div><div class="d">${esc(k.h)}</div></div></div>`;
  });
  s += `</div>`;

  // 기록
  s += `<h2 class="sec">기록</h2><div class="stats">
    <div class="stat"><div class="v">${streak}</div><div class="k">연속 촬영일</div></div>
    <div class="stat"><div class="v">${S.days.length}</div><div class="k">찍은 날</div></div>
    <div class="stat"><div class="v">${S.favs.length}</div><div class="k">저장한 구도</div></div>
  </div>`;

  s += `<h2 class="sec">빠른 이동</h2>
  <div class="gridcards">
    <div class="card tight" data-act="go" data-tab="shoot" data-sub="angle"><div class="card-t">각도 찾기</div><div class="card-s">원하는 효과로 골라요</div></div>
    <div class="card tight" data-act="go" data-tab="edit"><div class="card-t">보정하기</div><div class="card-s">무드·비율 맞춰 저장</div></div>
    <div class="card tight" data-act="go" data-tab="shoot" data-sub="place"><div class="card-t">장소별 팁</div><div class="card-s">카페·바다·야경…</div></div>
    <div class="card tight" data-act="trouble"><div class="card-t">잘 안 나올 때</div><div class="card-s">증상별 해결법</div></div>
  </div>`;
  return s;
}
function calcStreak() {
  const set = {}; S.days.forEach((d) => set[d] = 1);
  let n = 0; const d = new Date();
  for (;;) {
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    if (set[key]) { n++; d.setDate(d.getDate() - 1); } else break;
    if (n > 999) break;
  }
  return n;
}

/* ================= 촬영 ================= */
function viewShoot() {
  const subs = [['compo', '구도'], ['angle', '각도'], ['pose', '포즈'], ['place', '장소'], ['script', '대사']];
  let s = `<div class="seg">${subs.map((x) => `<button data-act="sub" data-sub="${x[0]}" class="${SUB === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div>`;
  if (SUB === 'compo') s += subCompo();
  if (SUB === 'angle') s += subAngle();
  if (SUB === 'pose') s += subPose();
  if (SUB === 'place') s += subPlace();
  if (SUB === 'script') s += subScript();
  return s;
}
function subCompo() {
  const p = purposeOf(S.lastPurpose);
  let s = `<div class="chips">${PURPOSES.map((x) => `<button class="chip ${x.id === S.lastPurpose ? 'on' : ''}" data-act="purpose" data-id="${x.id}">${x.emoji} ${esc(x.short)}</button>`).join('')}</div>`;
  s += `<div class="card tight"><div class="card-s">${esc(p.tip)}</div></div>`;
  s += `<div class="rowbtns" style="margin-top:4px"><button class="btn pt" data-act="cam">📷 구도를 화면에 겹쳐 보며 찍기</button></div>`;
  s += `<div class="seg" style="margin-top:12px">
    <button data-act="mode" data-id="solo" class="${S.mode === 'solo' ? 'on' : ''}">1인 (여자친구)</button>
    <button data-act="mode" data-id="duo" class="${S.mode === 'duo' ? 'on' : ''}">2인 (같이)</button>
  </div>`;
  const list = COMPOSITIONS.filter((c) => c.mode === S.mode || c.mode === 'both');
  s += `<h2 class="sec">추천 구도 ${list.length}가지</h2>`;
  list.forEach((c) => {
    const fav = S.favs.indexOf(c.id) >= 0;
    s += `<div class="card" data-act="openCompo" data-id="${c.id}">
      <div class="compo">
        <div class="guide">${guideSVG(c.guide)}</div>
        <div class="meta">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <div class="card-t">${esc(c.name)}</div>
            <button class="iconbtn" data-act="fav" data-id="${c.id}" style="flex:0 0 28px;height:28px;color:${fav ? 'var(--pt)' : 'var(--tx3)'}">${fav ? '♥' : '♡'}</button>
          </div>
          <div class="tagline">${esc(c.tagline)}</div>
          <div class="kv"><span>📐 ${esc(c.camera.height)}</span><span>🔍 ${esc(c.camera.zoom)}</span><span>👣 ${esc(c.camera.dist)}</span></div>
        </div>
      </div>
    </div>`;
  });
  return s;
}
function subAngle() {
  const g = S.goal ? ANGLE_GOALS.find((x) => x.id === S.goal) : null;
  let s = `<h2 class="sec">뭘 원하세요?</h2>
    <div class="chips wrap">${ANGLE_GOALS.map((x) => `<button class="chip ${S.goal === x.id ? 'on' : ''}" data-act="goal" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>`;
  if (g) {
    s += `<div class="card" style="margin-top:12px">
      <div class="card-t">${esc(g.name)} — 이렇게 찍으세요</div>
      <div class="kv" style="margin-top:10px">
        <span>높이 · ${esc(g.combo.height)}</span><span>방향 · ${esc(g.combo.direction)}</span>
        <span>줌 · ${esc(g.combo.zoom)}</span><span>기울기 · ${esc(g.combo.tilt)}</span>
      </div>
      <div class="saybox"><b>추가 한 가지</b>${esc(g.extra)}</div>
    </div>`;
  }
  s += `<h2 class="sec">하나씩 눌러보며 익히기</h2>`;
  ANGLE_AXES.forEach((ax) => {
    const cur = (S.axis || {})[ax.id] || ax.options[1].v;
    const o = ax.options.find((x) => x.v === cur) || ax.options[0];
    s += `<div class="card">
      <div class="card-t">${esc(ax.name)}</div>
      <div class="dial" style="margin-top:10px">${ax.options.map((x) => `<button class="${x.v === cur ? 'on' : ''}" data-act="axis" data-ax="${ax.id}" data-v="${esc(x.v)}">${esc(x.v)}</button>`).join('')}</div>
      <div class="effect"><b>${esc(o.good)}</b> · ${esc(o.effect)}</div>
    </div>`;
  });
  return s;
}
function subPose() {
  let s = `<div class="card golden tight"><div class="card-t">${esc(BPT.name)}</div>
    <div class="kv" style="margin-top:9px">${BPT.items.map((x) => `<span><b style="color:var(--gold)">${esc(x.k)}</b> · ${esc(x.d)}</span>`).join('')}</div>
    <div class="card-s" style="margin-top:9px">${esc(BPT.note)}</div></div>`;
  s += `<div class="seg">
    <button data-act="mode" data-id="solo" class="${S.mode === 'solo' ? 'on' : ''}">1인 포즈</button>
    <button data-act="mode" data-id="duo" class="${S.mode === 'duo' ? 'on' : ''}">2인 포즈</button>
  </div><div class="card list">`;
  POSES[S.mode === 'duo' ? 'duo' : 'solo'].forEach((p, i) => {
    s += `<div class="item"><div class="emo">${i + 1}</div><div><div class="n">${esc(p.n)}</div><div class="d">${esc(p.d)}</div></div></div>`;
  });
  s += `</div><div class="small">포즈를 지시하기보다 <b>대화하면서</b> 시키는 게 표정이 훨씬 좋습니다. 대사 탭을 참고하세요.</div>`;
  return s;
}
function subPlace() {
  let s = `<div class="card golden tight"><div class="card-t">${esc(BG_FORMULA.name)}</div><div class="card-s">${esc(BG_FORMULA.desc)}</div></div>`;
  s += `<h2 class="sec">장소를 고르면 팁이 나와요</h2><div class="chips wrap">${SITUATIONS.map((x) => `<button class="chip ${S.place === x.id ? 'on' : ''}" data-act="place" data-id="${x.id}">${x.emoji} ${esc(x.name)}</button>`).join('')}</div>`;
  const p = SITUATIONS.find((x) => x.id === S.place);
  if (p) {
    s += `<div class="card" style="margin-top:12px"><div class="card-t">${p.emoji} ${esc(p.name)}</div><ol class="steps">${p.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>`;
  } else {
    s += `<div class="empty">위에서 장소를 하나 눌러보세요</div>`;
  }
  return s;
}
function subScript() {
  let s = `<h2 class="sec">그대로 읽으면 되는 말</h2>`;
  SCRIPTS.forEach((g) => {
    s += `<div class="card"><div class="card-t">${esc(g.g)}</div>`;
    g.lines.forEach((l) => { s += `<div class="saybox" style="margin-top:9px">${esc(l)}</div>`; });
    s += `</div>`;
  });
  s += `<div class="small">칭찬은 <b>사진을 보여주면서</b> 하는 게 제일 효과적이에요. "이거 봐, 진짜 잘 나왔어" 한마디에 다음 포즈가 편해집니다.</div>`;
  return s;
}

/* ================= 구도 상세 시트 ================= */
function openCompo(id) {
  const c = COMPOSITIONS.find((x) => x.id === id); if (!c) return;
  const fav = S.favs.indexOf(c.id) >= 0;
  const html = `
    <h3>${esc(c.name)}</h3>
    <div class="tagline" style="margin-bottom:14px">${esc(c.tagline)}</div>
    <div style="max-width:190px;margin:0 auto 14px" class="guide">${guideSVG(c.guide, true)}</div>
    <div id="examBox"></div>
    <div class="card tight"><div class="card-s">${esc(c.why)}</div></div>
    <div class="kv" style="margin:12px 0">
      <span>카메라 높이 · ${esc(c.camera.height)}</span><span>거리 · ${esc(c.camera.dist)}</span>
      <span>줌 · ${esc(c.camera.zoom)}</span><span>기울기 · ${esc(c.camera.tilt)}</span>
    </div>
    <h2 class="sec">순서대로</h2>
    <ol class="steps">${c.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="saybox"><b>이렇게 말해보세요</b>${esc(c.say)}</div>
    <div class="warn">⚠ ${esc(c.risk)}</div>
    <div class="rowbtns">
      <button class="btn pt" data-act="cam" data-id="${c.id}">📷 이 구도로 카메라 열기</button>
    </div>
    <div class="rowbtns">
      <button class="btn" data-act="fav" data-id="${c.id}">${fav ? '저장 해제' : '보관함에 저장'}</button>
      <button class="btn ghost" data-act="doneShoot">찍었어요 ✓</button>
    </div>`;
  sheet(html);
  fillExamBox(c);
}
/* 구도 상세의 예시 사진 영역: 만들어둔 게 있으면 보여주고, 없으면 만들기 버튼 */
const EXAM_BUSY = {};
function fillExamBox(c) {
  const box = $('#examBox'); if (!box) return;
  if (EXAM_BUSY[c.id]) { box.innerHTML = `<div class="card tight" style="margin-bottom:12px"><div class="card-s">✨ 예시 사진을 만드는 중… (10~20초)</div></div>`; return; }
  examGet(c.id).then((rec) => {
    if (!$('#examBox') || EXAM_BUSY[c.id]) return;
    if (rec && rec.blob) {
      box.innerHTML = `<img src="${URL.createObjectURL(rec.blob)}" alt="예시" style="width:100%;border-radius:14px;margin-bottom:12px">
        <div class="small" style="margin:-6px 0 12px;text-align:center">AI가 만든 예시예요 (실존 인물 아님)</div>`;
    } else {
      box.innerHTML = `<div class="rowbtns" style="margin-bottom:12px">
        <button class="btn" data-act="examGen" data-id="${c.id}">✨ 실사 예시 사진 만들기 <span class="pro">PRO</span></button>
      </div>`;
    }
  });
}
function runExamGen(key, id) {
  const c = COMPOSITIONS.find((x) => x.id === id); if (!c) return;
  EXAM_BUSY[id] = true;
  if (!$('#examBox')) openCompo(id); // 열쇠 입력 뒤에는 구도 화면으로 되돌아와서 진행
  const box = $('#examBox');
  if (box) box.innerHTML = `<div class="card tight" style="margin-bottom:12px"><div class="card-s">✨ 예시 사진을 만드는 중… (10~20초, 한 번 만들면 계속 무료로 보여요)</div></div>`;
  const who = c.mode === 'duo' ? 'a young Korean couple in their 20s' : 'a young Korean woman in her 20s, casual stylish outfit';
  const prompt = 'Generate ONE photorealistic vertical 4:5 photograph for a photography tutorial app. Subject: ' + who + ', photographed candidly by a partner with a smartphone. The photo must clearly DEMONSTRATE this composition technique: "' + c.name + ' — ' + c.tagline + '". Technique details: ' + c.why + ' Camera: ' + c.camera.height + ' height, ' + c.camera.zoom + '. Style: natural light, instagram aesthetic, realistic smartphone photo quality, no text, no watermark. Fictional person, not a real individual.';
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  const models = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'];
  const tryModel = (i) => {
    if (i >= models.length) {
      EXAM_BUSY[id] = false;
      if ($('#examBox')) $('#examBox').innerHTML = `<div class="card tight" style="margin-bottom:12px"><div class="card-s">지금은 만들 수 없어요. 잠시 후 다시 시도해주세요.</div>
        <div class="rowbtns"><button class="btn ghost sm" data-act="examGen" data-id="${id}">다시 시도</button></div></div>`;
      return;
    }
    fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }).then((r) => { if (!r.ok) throw 0; return r.json(); }).then((j) => {
      const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content.parts || [];
      const ip = parts.find((p) => p.inline_data || p.inlineData);
      if (!ip) throw 0;
      const d = ip.inline_data || ip.inlineData;
      const bin = atob(d.data);
      const arr = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
      const blob = new Blob([arr], { type: d.mime_type || d.mimeType || 'image/png' });
      EXAM_BUSY[id] = false;
      examPut(id, blob).then(() => fillExamBox(c));
    }).catch(() => tryModel(i + 1));
  };
  tryModel(0);
}
function sheet(html) {
  $('#sheetContent').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() { $('#sheet').hidden = true; document.body.style.overflow = ''; }

/* ================= 카메라 (구도 겹쳐 보며 찍기) ================= */
const CAM = {
  stream: null, list: [], idx: 0, ghost: true, hintTimer: null, motionFn: null,
  cat: 'compo', poseIdx: 0, sayIdx: 0, purposeId: null,
};
function sayLines() {
  const out = [];
  SCRIPTS.forEach((g) => g.lines.forEach((l) => out.push({ g: g.g, l })));
  return out;
}
function openCamera(id) {
  closeSheet();
  CAM.list = COMPOSITIONS.filter((c) => c.mode === S.mode || c.mode === 'both');
  CAM.idx = Math.max(0, CAM.list.findIndex((c) => c.id === id));
  CAM.cat = 'compo'; CAM.poseIdx = 0; CAM.sayIdx = 0;
  CAM.purposeId = CAM.purposeId || S.lastPurpose;
  const el = document.createElement('div');
  el.id = 'cam';
  el.innerHTML = `
    <video id="camVideo" autoplay playsinline muted></video>
    <div class="cam-mask" id="maskT"></div><div class="cam-mask" id="maskB"></div>
    <div class="cam-mask" id="maskL"></div><div class="cam-mask" id="maskR"></div>
    <div class="cam-ghost" id="camGhost"></div>
    <div class="cam-top">
      <div><div class="cam-name" id="camName"></div><div class="cam-say" id="camSay"></div></div>
      <button class="cam-x" data-cam="close">✕</button>
    </div>
    <div class="cam-level"><div class="cam-level-line" id="camLevelLine"></div></div>
    <div class="cam-hint" id="camHint" hidden></div>
    <div class="cam-msg" id="camMsg" hidden></div>
    <div class="cam-ai" id="camAi" hidden></div>
    <button class="cam-ai-btn" data-cam="ai">✨ AI 코치 <span class="pro">PRO</span></button>
    <div class="cam-cats">
      <button data-cam="cat" data-cat="compo" class="on">구도</button>
      <button data-cam="cat" data-cat="angle">각도</button>
      <button data-cam="cat" data-cat="pose">포즈</button>
      <button data-cam="cat" data-cat="say">대사</button>
      <button data-cam="ratio" id="camRatio" class="ratio"></button>
    </div>
    <div class="cam-bottom">
      <button class="cam-side" data-cam="prev">‹ 이전</button>
      <button class="cam-shutter" data-cam="shot" aria-label="촬영"></button>
      <button class="cam-side" data-cam="next">다음 ›</button>
    </div>
    <button class="cam-ghosttog" data-cam="ghost">가이드 끄기</button>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  camShow(); camLayout();
  const video = $('#camVideo');
  video.addEventListener('loadedmetadata', camLayout);
  window.addEventListener('resize', camLayout);
  const constraints = { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camFail('이 화면에서는 카메라를 못 열어요. 휴대폰에서 주소가 https로 시작해야 카메라가 열립니다.');
    return;
  }
  navigator.mediaDevices.getUserMedia(constraints)
    .then((st) => { CAM.stream = st; video.srcObject = st; camAssistStart(); })
    .catch(() => {
      navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then((st) => { CAM.stream = st; video.srcObject = st; camAssistStart(); })
        .catch(() => camFail('카메라 권한이 필요해요. 브라우저 주소창 옆 카메라 아이콘에서 허용해주세요. (휴대폰은 https 주소에서만 열립니다)'));
    });
  camLevelStart();
}
function camFail(msg) { const m = $('#camMsg'); if (m) { m.hidden = false; m.textContent = msg; } }

/* 선택한 용도(피드 4:5, 스토리 9:16…)에 맞는 촬영 틀 표시 */
function camLayout() {
  const el = $('#cam'); if (!el) return;
  const p = purposeOf(CAM.purposeId);
  const r = p.ratio[0] / p.ratio[1];
  const cw = el.clientWidth, ch = el.clientHeight;
  let w = cw, h = cw / r;
  if (h > ch) { h = ch; w = ch * r; }
  const mx = (cw - w) / 2, my = (ch - h) / 2;
  const set = (id, css) => { const m = $(id); if (m) Object.assign(m.style, css); };
  set('#maskT', { top: 0, left: 0, right: 0, height: my + 'px', bottom: 'auto', width: 'auto' });
  set('#maskB', { bottom: 0, left: 0, right: 0, height: my + 'px', top: 'auto', width: 'auto' });
  set('#maskL', { top: my + 'px', bottom: my + 'px', left: 0, width: mx + 'px', height: 'auto', right: 'auto' });
  set('#maskR', { top: my + 'px', bottom: my + 'px', right: 0, width: mx + 'px', height: 'auto', left: 'auto' });
  const g = $('#camGhost');
  if (g) Object.assign(g.style, { top: my + 'px', bottom: my + 'px', left: mx + 'px', right: mx + 'px' });
  const rb = $('#camRatio');
  if (rb) rb.textContent = p.ratio[0] + ':' + (p.ratio[1] % 1 ? p.ratio[1] : p.ratio[1]) + ' ' + p.short;
}

/* --- 무료 스마트 점검: 수평계 + 밝기·역광 경고 (기기 안에서만 계산) --- */
function camLevelStart() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().catch(() => {});
  }
  CAM.motionFn = (e) => {
    const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
    let deg = Math.atan2(g.x, g.y) * 180 / Math.PI;
    while (deg > 90) deg -= 180; while (deg < -90) deg += 180;
    const line = $('#camLevelLine'); if (!line) return;
    line.style.transform = 'rotate(' + (-deg).toFixed(1) + 'deg)';
    line.classList.toggle('ok', Math.abs(deg) < 2.5);
  };
  window.addEventListener('devicemotion', CAM.motionFn);
}
function camAssistStart() {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  CAM.hintTimer = setInterval(() => {
    const v = $('#camVideo'); const hint = $('#camHint');
    if (!v || !v.videoWidth || !hint) return;
    cx.drawImage(v, 0, 0, 32, 32);
    const d = cx.getImageData(0, 0, 32, 32).data;
    let all = 0, top = 0, mid = 0, nTop = 0, nMid = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      all += l;
      if (y < 10) { top += l; nTop++; }
      if (y >= 12 && y < 26 && x >= 8 && x < 24) { mid += l; nMid++; }
    }
    all /= 1024; top /= nTop; mid /= nMid;
    let msg = '';
    if (all < 42) msg = '🌙 너무 어두워요 — 밝은 곳으로 가거나 야간 모드를 켜세요';
    else if (top > 175 && mid < 95) msg = '☀️ 역광이에요 — 화면에서 얼굴을 탭해 밝기를 맞추세요 (실루엣을 원하면 그대로!)';
    else if (all > 215) msg = '💡 너무 밝아요 — 화면을 탭해 살짝 어둡게';
    if (msg) { hint.hidden = false; hint.textContent = msg; }
    else hint.hidden = true;
  }, 1500);
}

/* --- 유료(PRO) AI 코치: 지금 화면을 AI가 보고 구도·포즈·위치·빛 제안 --- */
const AIKEY_STORE = KEY + '.aikey';
let AI_CB = null;
/* 카메라 밖(홈·보정)에서 AI 기능을 쓸 때의 공용 열쇠 확인 */
function ensureAIKey(cb) {
  const key = localStorage.getItem(AIKEY_STORE);
  if (key) { cb(key); return; }
  AI_CB = cb;
  sheet(`<h3>✨ AI 기능 <span class="pro">PRO</span></h3>
    <div class="card-s" style="margin-top:6px">AI 사용에는 비용이 들어서 나중에 유료(구독) 기능이 될 자리예요.<br>
    지금은 <b>구글 AI 열쇠(무료 발급)</b>를 한 번 붙여넣으면 바로 써볼 수 있어요. 열쇠는 이 기기에만 저장됩니다.</div>
    <input class="timeinput" id="aiKeyIn2" type="password" placeholder="구글 AI 열쇠 붙여넣기 (AIza...)" style="margin:12px 0">
    <div class="rowbtns"><button class="btn pt" data-act="aikeySave">저장하고 계속</button></div>
    <a class="btn ghost" style="display:block;text-decoration:none;margin-top:8px" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">🔑 무료 열쇠 발급 페이지 열기</a>
    <div class="small" style="margin-top:8px">개인 구글 계정으로 로그인 → "API 키 만들기" → 복사해서 위에 붙여넣기. 결제 등록을 안 하면 요금이 나올 수 없어요 (하루 무료 한도만 있음).</div>`);
}

/* --- 유료(PRO) 진짜 장소 가이드: "성수 ○○카페"처럼 실제 장소의 포토스팟·유명 구도 --- */
function runPlaceAI(key, q) {
  sheet(`<h3>✨ ${esc(q)}</h3><div class="card-s" style="margin-top:8px">이 장소의 촬영 정보를 찾는 중…</div>`);
  const prompt = '너는 인물사진 코치야. "' + q + '"에서 여자친구/커플 사진을 찍으려고 해. 다음 4가지를 한국어로 알려줘. 각 항목 제목은 【포토스팟】【유명한 샷】【시간대】【보정 톤】으로 시작하고, 항목당 2~3줄로 구체적으로. 어디에 서서 어느 방향으로 찍는지까지. 확실하지 않은 건 "~일 수 있어요"로 표시하고, 장소를 정확히 모르면 그 지역·업종의 일반적인 촬영 팁을 같은 형식으로 알려줘.';
  const call = (useSearch) => {
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    if (useSearch) body.tools = [{ google_search: {} }];
    return fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => { if (!r.ok) throw 0; return r.json(); });
  };
  call(true).catch(() => call(false)).then((j) => {
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((p) => p.text || '').join('\n') || '';
    if (!txt) throw 0;
    const html = txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const clean = esc(l.replace(/\*\*/g, '').replace(/^[-*•]\s*/, ''));
      return /^【/.test(l) ? `<div class="card-t" style="margin-top:12px;font-size:14px">${clean}</div>` : `<div class="card-s">· ${clean}</div>`;
    }).join('');
    sheet(`<h3>✨ ${esc(q)}</h3>${html}
      <div class="rowbtns" style="margin-top:14px"><button class="btn pt" data-act="cam">📷 바로 찍으러 가기</button></div>
      <div class="small" style="margin-top:8px">AI가 찾은 정보라 최신 상황과 다를 수 있어요. 현장에서 한 번 더 확인!</div>`);
  }).catch(() => {
    sheet(`<h3>✨ ${esc(q)}</h3><div class="card-s" style="margin-top:8px">지금은 연결이 안 돼요. 열쇠를 확인하거나 잠시 후 다시 시도해주세요.</div>
      <div class="rowbtns"><button class="btn ghost" data-act="aikeyReset">열쇠 다시 입력</button></div>`);
  });
}

/* --- 유료(PRO) AI 자연 보정: 과하지 않게만. 전후 비교 후 마음에 안 들면 버리기 --- */
function editCanvas(maxSide) {
  // 지금 화면에 보이는 결과(자르기+보정)를 원하는 크기로 그려준다
  const p = purposeOf(ED.purposeId);
  const iw = ED.img.naturalWidth, ih = ED.img.naturalHeight;
  const r = cropRect(iw, ih);
  const ratio = p.ratio[0] / p.ratio[1];
  let w, h;
  if (ratio <= 1) { h = maxSide; w = Math.round(maxSide * ratio); } else { w = maxSide; h = Math.round(maxSide / ratio); }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.filter = nativeFilter(ED.adj);
  ctx.drawImage(ED.img, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
  ctx.filter = 'none';
  pipeline(ctx, w, h, ED.adj);
  return cv;
}
function runAIRetouch(key) {
  if (!ED.img) { toast('사진을 먼저 넣어주세요'); return; }
  const before = editCanvas(1024);
  const beforeUrl = before.toDataURL('image/jpeg', 0.92);
  sheet(`<h3>✨ AI 자연 보정</h3><div class="card-s" style="margin-top:8px">피부 잡티·노이즈만 살짝 정리하는 중… (10~20초)</div>
    <img src="${beforeUrl}" style="width:100%;border-radius:12px;margin-top:12px;opacity:.6" alt="원본">`);
  const b64 = beforeUrl.split(',')[1];
  const prompt = 'Retouch this photo subtly and naturally, like a professional photo editor with a light touch: even out skin tone, remove only temporary blemishes, reduce noise, gently improve lighting. STRICT RULES: do not change face shape, eye size, body shape, hair, background content, colors of clothing, or composition. The edit must be so natural that it is unnoticeable. Return only the edited image.';
  const body = JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }, { text: prompt }] }] });
  const models = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'];
  const tryModel = (i) => {
    if (i >= models.length) {
      sheet(`<h3>✨ AI 자연 보정</h3><div class="card-s" style="margin-top:8px">지금은 연결이 안 돼요. 잠시 후 다시 시도해주세요.</div>
        <div class="rowbtns"><button class="btn ghost" data-act="aikeyReset">열쇠 다시 입력</button></div>`);
      return;
    }
    fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }).then((r) => { if (!r.ok) throw 0; return r.json(); }).then((j) => {
      const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content.parts || [];
      const imgPart = parts.find((p) => p.inline_data || p.inlineData);
      if (!imgPart) throw 0;
      const d = imgPart.inline_data || imgPart.inlineData;
      AI_RETOUCH_URL = 'data:' + (d.mime_type || d.mimeType || 'image/png') + ';base64,' + d.data;
      sheet(`<h3>✨ AI 자연 보정 — 비교해보세요</h3>
        <div class="dim" style="margin:10px 0 4px">보정 전</div>
        <img src="${beforeUrl}" style="width:100%;border-radius:12px" alt="전">
        <div class="dim" style="margin:12px 0 4px">보정 후</div>
        <img src="${AI_RETOUCH_URL}" style="width:100%;border-radius:12px" alt="후">
        <div class="rowbtns" style="margin-top:14px">
          <button class="btn pt" data-act="aiRetouchApply">이걸로 쓸게요</button>
          <button class="btn ghost" data-close>티 나요, 버릴래요</button>
        </div>
        <div class="small" style="margin-top:8px">조금이라도 어색하면 버리세요 — 자연스러운 원본이 항상 이깁니다.</div>`);
    }).catch(() => tryModel(i + 1));
  };
  tryModel(0);
}
let AI_RETOUCH_URL = null;
function camAI() {
  const panel = $('#camAi'); if (!panel) return;
  const key = localStorage.getItem(AIKEY_STORE);
  if (!key) {
    panel.hidden = false;
    panel.innerHTML = `
      <div class="cam-ai-t">✨ AI 코치 <span class="pro">PRO</span></div>
      <div class="cam-ai-d">지금 카메라에 보이는 장면을 AI가 보고<br><b>구도·포즈·위치·빛</b>을 한 줄씩 제안해줘요.<br><br>
      AI 사용에는 비용이 들어서 나중에 유료(구독) 기능이 될 자리예요.<br>
      지금은 <b>구글 AI 열쇠(무료 발급)</b>를 한 번 붙여넣으면 내 폰에서 바로 써볼 수 있어요.
      열쇠는 이 기기에만 저장됩니다.</div>
      <input class="timeinput" id="aiKeyIn" type="password" placeholder="구글 AI 열쇠 붙여넣기 (AIza...)" style="margin:10px 0">
      <div class="rowbtns">
        <button class="btn pt" data-cam="aisave">저장하고 시작</button>
        <button class="btn ghost" data-cam="aiclose">닫기</button>
      </div>
      <a class="btn ghost" style="display:block;text-decoration:none;margin-top:8px" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">🔑 무료 열쇠 발급 페이지 열기</a>
      <div class="small" style="margin-top:8px">개인 구글 계정으로 로그인 → "API 키 만들기" → 복사해서 위에 붙여넣기. 결제 등록을 안 하면 요금이 나올 수 없어요 (하루 무료 한도만 있음).</div>`;
    return;
  }
  runAICoach(key);
}
function runAICoach(key) {
  const v = $('#camVideo'); const panel = $('#camAi');
  if (!v || !v.videoWidth) { toast('카메라가 아직 준비 중이에요'); return; }
  panel.hidden = false;
  panel.innerHTML = `<div class="cam-ai-t">✨ AI 코치</div><div class="cam-ai-d">화면을 보는 중…</div>`;
  const cv = document.createElement('canvas');
  const w = 512, h = Math.round(v.videoHeight / v.videoWidth * 512);
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(v, 0, 0, w, h);
  const b64 = cv.toDataURL('image/jpeg', 0.8).split(',')[1];
  const prompt = '너는 인물 사진 코치야. 이 이미지는 지금 촬영 중인 카메라 화면이야. 다음 4가지를 각각 한 줄(20자 내외)로, 반드시 한국어로 제안해줘. 각 줄은 "구도:", "포즈:", "위치:", "빛:"으로 시작해. 촬영자가 바로 실행할 수 있게 구체적으로. 인물이 없으면 이 배경을 어떻게 쓰면 좋을지 같은 형식으로 제안해.';
  const body = JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }, { text: prompt }] }] });
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  const tryModel = (i) => {
    if (i >= models.length) { panel.innerHTML = `<div class="cam-ai-t">✨ AI 코치</div><div class="cam-ai-d">지금은 연결이 안 돼요. 열쇠가 맞는지 확인하거나 잠시 후 다시 시도해주세요.</div><div class="rowbtns"><button class="btn ghost" data-cam="aireset">열쇠 다시 입력</button><button class="btn ghost" data-cam="aiclose">닫기</button></div>`; return; }
    fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }).then((r) => { if (!r.ok) throw 0; return r.json(); }).then((j) => {
      const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((p) => p.text || '').join('\n') || '';
      if (!txt) throw 0;
      const lines = txt.split('\n').map((l) => l.trim()).filter((l) => /^(구도|포즈|위치|빛)/.test(l));
      panel.innerHTML = `<div class="cam-ai-t">✨ AI 코치의 제안</div>` +
        (lines.length ? lines : [txt]).map((l) => `<div class="cam-ai-line">${esc(l)}</div>`).join('') +
        `<div class="rowbtns"><button class="btn pt sm" data-cam="ai">다시 보기</button><button class="btn ghost sm" data-cam="aiclose">닫기</button></div>`;
    }).catch(() => tryModel(i + 1));
  };
  tryModel(0);
}
function camShow() {
  const c = CAM.list[CAM.idx];
  const nameEl = $('#camName'), sayEl = $('#camSay');
  const rec = S.place && PLACE_REC[S.place];
  const pl = S.place && SITUATIONS.find((x) => x.id === S.place);
  const placeLine = rec && pl ? `<br><span class="cam-place">📍 ${esc(pl.name)} · ${esc(rec.pose)}</span>` : '';

  if (CAM.cat === 'compo') {
    nameEl.textContent = c.name;
    sayEl.innerHTML = '“' + esc(c.say) + '”' + placeLine;
  } else if (CAM.cat === 'angle') {
    const g = S.goal && ANGLE_GOALS.find((x) => x.id === S.goal);
    if (g) {
      nameEl.textContent = '각도: ' + g.name;
      sayEl.innerHTML = `<span class="cam-chips">📐 ${esc(g.combo.height)} · ${esc(g.combo.direction)} · ${esc(g.combo.zoom)} · ${esc(g.combo.tilt)}</span><br>${esc(g.extra)}`;
    } else {
      nameEl.textContent = '각도: ' + c.name + ' 기준';
      sayEl.innerHTML = `<span class="cam-chips">📐 ${esc(c.camera.height)} · 거리 ${esc(c.camera.dist)} · ${esc(c.camera.zoom)} · ${esc(c.camera.tilt)}</span><br>화살표로 원하는 효과를 골라보세요`;
    }
  } else if (CAM.cat === 'pose') {
    const list = POSES[S.mode === 'duo' ? 'duo' : 'solo'];
    const po = list[CAM.poseIdx % list.length];
    nameEl.textContent = '포즈: ' + po.n + ` (${(CAM.poseIdx % list.length) + 1}/${list.length})`;
    sayEl.innerHTML = esc(po.d) + placeLine;
  } else if (CAM.cat === 'say') {
    const lines = sayLines();
    const it = lines[CAM.sayIdx % lines.length];
    nameEl.textContent = '대사: ' + it.g;
    sayEl.innerHTML = '“' + esc(it.l) + '”';
  }
  const g = $('#camGhost');
  g.innerHTML = guideSVG(c.guide, false, true);
  g.style.display = CAM.ghost ? 'block' : 'none';
  const t = $('.cam-ghosttog'); if (t) t.textContent = CAM.ghost ? '가이드 끄기' : '가이드 켜기';
  $$('.cam-cats [data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === CAM.cat));
}
function camPrevNext(dir) {
  if (CAM.cat === 'compo') CAM.idx = (CAM.idx + dir + CAM.list.length) % CAM.list.length;
  else if (CAM.cat === 'angle') {
    const i = S.goal ? ANGLE_GOALS.findIndex((x) => x.id === S.goal) : -1;
    S.goal = ANGLE_GOALS[(i + dir + ANGLE_GOALS.length) % ANGLE_GOALS.length].id; save();
  } else if (CAM.cat === 'pose') {
    const n = POSES[S.mode === 'duo' ? 'duo' : 'solo'].length;
    CAM.poseIdx = (CAM.poseIdx + dir + n) % n;
  } else if (CAM.cat === 'say') {
    const n = sayLines().length;
    CAM.sayIdx = (CAM.sayIdx + dir + n) % n;
  }
  camShow();
}
function closeCamera() {
  if (CAM.stream) { CAM.stream.getTracks().forEach((t) => t.stop()); CAM.stream = null; }
  if (CAM.hintTimer) { clearInterval(CAM.hintTimer); CAM.hintTimer = null; }
  if (CAM.motionFn) { window.removeEventListener('devicemotion', CAM.motionFn); CAM.motionFn = null; }
  window.removeEventListener('resize', camLayout);
  const el = $('#cam'); if (el) el.remove();
  document.body.style.overflow = '';
}
function camShot() {
  const v = $('#camVideo');
  if (!v || !v.videoWidth) { toast('카메라가 아직 준비 중이에요'); return; }
  // 화면의 비율 틀과 똑같은 영역을 잘라서 저장
  const el = $('#cam');
  const vw = v.videoWidth, vh = v.videoHeight;
  const cw = el.clientWidth, ch = el.clientHeight;
  const scale = Math.max(cw / vw, ch / vh);           // 화면은 꽉 채워(cover) 보이므로
  const visW = cw / scale, visH = ch / scale;          // 화면에 실제로 보이는 원본 영역
  const p = purposeOf(CAM.purposeId);
  const r = p.ratio[0] / p.ratio[1];
  let w2 = visW, h2 = visW / r;
  if (h2 > visH) { h2 = visH; w2 = visH * r; }
  const sx = (vw - w2) / 2, sy = (vh - h2) / 2;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w2); cv.height = Math.round(h2);
  cv.getContext('2d').drawImage(v, sx, sy, w2, h2, 0, 0, cv.width, cv.height);
  cv.toBlob((blob) => {
    const img = new Image();
    img.onload = () => {
      ED.img = img; ED.scale = 1; ED.cx = 0.5; ED.cy = 0.5; PK = null;
      ED.purposeId = CAM.purposeId; S.lastPurpose = CAM.purposeId; save();
      markShotToday();
      // 자동으로 추억 앨범에 저장 (날짜·장소 자동 기록, 나중에 메모 추가 가능)
      shrinkBlob(img, 1400).then((small) => {
        if (small) memAdd({ date: today(), placeId: S.place || null, people: null, note: '', blob: small }).catch(() => {});
      });
      closeCamera();
      TAB = 'edit'; render();
      toast('찍고 추억 앨범에도 담아뒀어요 ♥');
    };
    img.src = URL.createObjectURL(blob);
  }, 'image/jpeg', 0.95);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cam]');
  if (!b) return;
  const a = b.dataset.cam;
  if (a === 'close') closeCamera();
  if (a === 'shot') camShot();
  if (a === 'prev') camPrevNext(-1);
  if (a === 'next') camPrevNext(1);
  if (a === 'cat') { CAM.cat = b.dataset.cat; camShow(); }
  if (a === 'ratio') {
    const i = PURPOSES.findIndex((x) => x.id === CAM.purposeId);
    CAM.purposeId = PURPOSES[(i + 1) % PURPOSES.length].id;
    S.lastPurpose = CAM.purposeId; save();
    camLayout();
  }
  if (a === 'ghost') { CAM.ghost = !CAM.ghost; camShow(); }
  if (a === 'ai') camAI();
  if (a === 'aiclose') { const p = $('#camAi'); if (p) p.hidden = true; }
  if (a === 'aisave') {
    const v = ($('#aiKeyIn') && $('#aiKeyIn').value || '').trim();
    if (v.length < 20) { toast('열쇠가 너무 짧아요. 다시 확인해주세요'); return; }
    try { localStorage.setItem(AIKEY_STORE, v); } catch (err) {}
    runAICoach(v);
  }
  if (a === 'aireset') { localStorage.removeItem(AIKEY_STORE); camAI(); }
});

/* ================= 베스트샷 고르기 (토너먼트) ================= */
let PK = null;
function startPick(files) {
  const items = Array.prototype.slice.call(files).map((f) => ({ f, url: URL.createObjectURL(f) }));
  if (items.length < 2) { if (items[0]) pickWinner(items[0]); return; }
  PK = { total: items.length, round: items, next: [], i: 0, decided: 0 };
  render();
}
function pickChoose(keepIdx) {
  const a = PK.round[PK.i], b = PK.round[PK.i + 1];
  const win = keepIdx === 0 ? a : b;
  const lose = keepIdx === 0 ? b : a;
  URL.revokeObjectURL(lose.url); PK.decided++;
  PK.next.push(win);
  PK.i += 2;
  // 짝이 없는 마지막 한 장은 부전승으로 다음 라운드에
  if (PK.round.length - PK.i === 1) { PK.next.push(PK.round[PK.i]); PK.i = PK.round.length; }
  if (PK.i >= PK.round.length) {
    PK.round = PK.next; PK.next = []; PK.i = 0;
    if (PK.round.length === 1) { pickWinner(PK.round[0]); return; }
  }
  render();
}
function pickWinner(item) {
  const img = new Image();
  img.onload = () => {
    ED.img = img; ED.scale = 1; ED.cx = 0.5; ED.cy = 0.5;
    PK = null; render();
    toast('베스트 컷 선정! 이제 보정해보세요');
  };
  img.src = item.url;
}
function viewPick() {
  const a = PK.round[PK.i], b = PK.round[PK.i + 1];
  const left = PK.total - PK.decided;
  return `<div class="card tight"><div class="card-t">어느 쪽이 더 예뻐요?</div>
    <div class="card-s">더 마음에 드는 사진을 누르세요 · 남은 후보 ${left}장</div></div>
    <div class="pk">
      <div class="pk-item" data-act="pk" data-keep="0"><img src="${a.url}" alt="후보1"></div>
      <div class="pk-vs">VS</div>
      <div class="pk-item" data-act="pk" data-keep="1"><img src="${b.url}" alt="후보2"></div>
    </div>
    <div class="rowbtns"><button class="btn ghost sm" data-act="pkCancel">그만 고르기</button></div>`;
}

/* ================= 보정 ================= */
const ED = {
  img: null, purposeId: null, moodId: 'none',
  adj: {}, scale: 1, cx: 0.5, cy: 0.5,
  stage: null, ctx: null, sw: 0, sh: 0, grid: false, before: false,
};
function adjDefaults() { const o = {}; ADJUSTS.forEach((a) => o[a.id] = 0); o.bw = false; return o; }
function applyMood(id) {
  const m = MOODS.find((x) => x.id === id) || MOODS[0];
  ED.moodId = id; ED.adj = Object.assign(adjDefaults(), m.p);
}
function viewEdit() {
  if (PK) return viewPick();
  if (!ED.purposeId) ED.purposeId = S.lastPurpose;
  if (!Object.keys(ED.adj).length) applyMood('none');
  const p = purposeOf(ED.purposeId);
  let s = `<div class="chips">${PURPOSES.map((x) => `<button class="chip ${x.id === ED.purposeId ? 'on' : ''}" data-act="epurpose" data-id="${x.id}">${x.emoji} ${esc(x.short)}</button>`).join('')}</div>`;
  s += `<div class="card tight" style="margin-top:8px"><div class="card-s">${esc(p.tip)} <span class="dim">(${p.out[0]}×${p.out[1]})</span></div></div>`;

  if (!ED.img) {
    s += `<div class="card" style="margin-top:12px">
      <label class="drop" style="display:block">
        <b>사진 한 장 보정하기</b>
        여기를 눌러 갤러리에서 고르세요<br><span class="dim">사진은 이 휴대폰 안에서만 처리돼요. 어디에도 올라가지 않습니다.</span>
        <input type="file" accept="image/*" id="fileIn" hidden>
      </label>
    </div>
    <div class="card">
      <label class="drop" style="display:block">
        <b>🏆 여러 장 넣고 베스트 고르기</b>
        50장 중 1장, 둘 중 하나씩 고르다 보면 끝나요<br><span class="dim">연속 촬영한 사진을 전부 선택하세요</span>
        <input type="file" accept="image/*" id="fileMulti" multiple hidden>
      </label>
    </div>
    <div class="small">비율을 먼저 고르고 사진을 넣으면, 인스타·카톡·배경화면에 딱 맞는 크기로 저장돼요. 위아래 어두운 부분은 <b>글씨나 버튼이 덮는 자리</b>라 인물을 그 안에 두면 안 됩니다.</div>`;
    return s;
  }

  s += `<div class="stagewrap" style="margin-top:12px"><div class="stage ${p.round ? 'round' : ''}" id="stage"><canvas id="cv"></canvas>
      ${p.safe.top ? `<div class="safe t" style="height:${(p.safe.top * 100).toFixed(1)}%">가려지는 영역</div>` : ''}
      ${p.safe.bottom ? `<div class="safe b" style="height:${(p.safe.bottom * 100).toFixed(1)}%">가려지는 영역</div>` : ''}
      <svg class="gridlines" id="gridlines" style="display:${ED.grid ? 'block' : 'none'}" viewBox="0 0 3 3" preserveAspectRatio="none">
        <line x1="1" y1="0" x2="1" y2="3" stroke="#fff" stroke-width=".01"/><line x1="2" y1="0" x2="2" y2="3" stroke="#fff" stroke-width=".01"/>
        <line x1="0" y1="1" x2="3" y2="1" stroke="#fff" stroke-width=".01"/><line x1="0" y1="2" x2="3" y2="2" stroke="#fff" stroke-width=".01"/>
      </svg>
    </div></div>`;
  s += `<div class="slider"><label>확대</label><input type="range" id="zoom" min="100" max="320" value="${Math.round(ED.scale * 100)}"><span class="val">${ED.scale.toFixed(1)}x</span></div>
    <div class="small" style="margin-bottom:12px">사진을 손가락으로 끌어서 위치를 맞추세요.</div>`;

  s += `<div id="moodSuggest"></div>`;
  s += `<h2 class="sec">무드</h2><div class="moods" id="moods">${MOODS.map((m) => `
    <div class="mood ${ED.moodId === m.id ? 'on' : ''}" data-act="mood" data-id="${m.id}">
      <div class="sw"><canvas data-thumb="${m.id}" width="66" height="66"></canvas></div>${esc(m.name)}
    </div>`).join('')}</div>`;
  const cm = MOODS.find((x) => x.id === ED.moodId);
  if (cm && cm.desc) s += `<div class="small" style="margin-top:6px">${esc(cm.desc)}</div>`;

  s += `<h2 class="sec">세밀하게 조절</h2><div class="card">`;
  ADJUSTS.forEach((a) => {
    s += `<div class="slider"><label>${esc(a.name)}</label>
      <input type="range" data-adj="${a.id}" min="${a.min}" max="${a.max}" value="${ED.adj[a.id] || 0}">
      <span class="val" data-valof="${a.id}">${ED.adj[a.id] || 0}</span></div>`;
  });
  s += `<div class="switch" style="margin-top:10px"><div>흑백으로</div><div class="tog ${ED.adj.bw ? 'on' : ''}" data-act="bw"></div></div>`;
  s += `</div>`;

  s += `<div class="rowbtns">
      <button class="btn ghost" data-act="grid">격자 ${ED.grid ? '끄기' : '켜기'}</button>
      <button class="btn ghost" data-act="before">원본 비교</button>
      <button class="btn ghost" data-act="reset">초기화</button>
    </div>
    <div class="rowbtns"><button class="btn" data-act="aiRetouch">✨ AI 자연 보정 <span class="pro">PRO</span></button></div>
    <div class="rowbtns"><button class="btn pt" data-act="export">이 비율로 저장하기</button></div>
    <div class="rowbtns"><button class="btn ghost sm" data-act="newimg">다른 사진 고르기</button></div>`;
  return s;
}

function editorMount() {
  const fi = $('#fileIn');
  if (fi) fi.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    loadImage(f);
  });
  const fm = $('#fileMulti');
  if (fm) fm.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) startPick(e.target.files);
  });
  const st = $('#stage');
  if (!st) return;
  layoutStage();
  bindStageGestures(st);
  const z = $('#zoom');
  if (z) z.addEventListener('input', () => { ED.scale = z.value / 100; $('#zoom').parentNode.querySelector('.val').textContent = ED.scale.toFixed(1) + 'x'; draw(); });
  $$('input[data-adj]').forEach((inp) => {
    inp.addEventListener('input', () => {
      ED.adj[inp.dataset.adj] = +inp.value;
      const v = $('[data-valof="' + inp.dataset.adj + '"]'); if (v) v.textContent = inp.value;
      draw();
    });
  });
  drawThumbs();
  draw();
  fillMoodSuggest();
}
/* 사진을 분석해서 어울리는 무드를 추천 (기기 안 계산 = 무료) */
function fillMoodSuggest() {
  const box = $('#moodSuggest'); if (!box || !ED.img) return;
  const cv = document.createElement('canvas'); cv.width = 48; cv.height = 48;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(ED.img, 0, 0, 48, 48);
  const d = cx.getImageData(0, 0, 48, 48).data;
  let lum = 0, warm = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    lum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    warm += d[i] - d[i + 2];
    sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
  }
  const n = d.length / 4; lum /= n; warm /= n; sat /= n;
  let desc, recs;
  if (lum < 75) { desc = '어두운 곳에서 찍은 사진이에요'; recs = ['neon', 'film']; }
  else if (warm > 22) { desc = '노란 조명빛이 도는 사진이에요'; recs = ['cream', 'mute']; }
  else if (warm < -14) { desc = '차가운 빛의 사진이에요'; recs = ['warm', 'film']; }
  else if (sat > 60) { desc = '색이 쨍한 사진이에요'; recs = ['film', 'mute']; }
  else if (lum > 185) { desc = '밝고 화사한 사진이에요'; recs = ['skin', 'fresh']; }
  else { desc = '밝기가 무난한 사진이에요 — 요즘 유행 톤 추천'; recs = ['cream', 'film']; }
  const btns = recs.map((id) => {
    const m = MOODS.find((x) => x.id === id);
    return `<button class="btn sm pt" data-act="mood" data-id="${id}">${m.emoji} ${esc(m.name)}</button>`;
  }).join('');
  box.innerHTML = `<div class="card tight" style="margin-bottom:4px">
    <div class="card-s">🔍 ${esc(desc)}. 이 무드가 어울려요:</div>
    <div class="rowbtns" style="margin-top:8px">${btns}</div></div>`;
}
function loadImage(file) {
  const img = new Image();
  img.onload = () => {
    ED.img = img; ED.scale = 1; ED.cx = 0.5; ED.cy = 0.5;
    render();
  };
  img.onerror = () => toast('사진을 못 읽었어요. 다른 사진으로 해보세요');
  img.src = URL.createObjectURL(file);
}
function layoutStage() {
  const st = $('#stage'); if (!st) return;
  const p = purposeOf(ED.purposeId);
  const availW = Math.min(st.parentNode.clientWidth || 340, 400);
  const maxH = Math.min(window.innerHeight * 0.52, 470);
  const ratio = p.ratio[0] / p.ratio[1];
  let w = availW, h = w / ratio;
  if (h > maxH) { h = maxH; w = h * ratio; }
  st.style.width = Math.round(w) + 'px';
  st.style.height = Math.round(h) + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = $('#cv');
  ED.sw = Math.round(w * dpr); ED.sh = Math.round(h * dpr);
  cv.width = ED.sw; cv.height = ED.sh;
  ED.ctx = cv.getContext('2d', { willReadFrequently: true });
}
function cropRect(iw, ih) {
  const p = purposeOf(ED.purposeId);
  const target = p.ratio[0] / p.ratio[1];
  let bw, bh;
  if (iw / ih > target) { bh = ih; bw = ih * target; } else { bw = iw; bh = iw / target; }
  const sw = bw / ED.scale, sh = bh / ED.scale;
  let sx = ED.cx * iw - sw / 2, sy = ED.cy * ih - sh / 2;
  sx = clamp(sx, 0, iw - sw); sy = clamp(sy, 0, ih - sh);
  return { sx, sy, sw, sh };
}
function nativeFilter(a) {
  const b = 1 + (a.exposure || 0) / 100 * 0.6;
  const c = 1 + (a.contrast || 0) / 100 * 0.5;
  const s = clamp(1 + (a.saturation || 0) / 100 * 0.9, 0, 3);
  return `brightness(${b.toFixed(3)}) contrast(${c.toFixed(3)}) saturate(${s.toFixed(3)})${a.bw ? ' grayscale(1)' : ''}`;
}
function pipeline(ctx, w, h, a) {
  const temp = (a.temp || 0) / 100, tint = (a.tint || 0) / 100;
  const hi = (a.highlight || 0) / 100, sh = (a.shadow || 0) / 100;
  const fade = (a.fade || 0) / 100, grain = (a.grain || 0) / 100;
  if (temp || tint || hi || sh || fade || grain) {
    const d = ctx.getImageData(0, 0, w, h), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      let r = px[i], g = px[i + 1], b = px[i + 2];
      if (temp) { r += temp * 32; g += temp * 6; b -= temp * 32; }
      if (tint) { r += tint * 14; g -= tint * 20; b += tint * 14; }
      if (hi || sh) {
        const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        if (hi) { const wt = Math.max(0, l - 0.45) / 0.55; const v = hi * 72 * wt * wt; r += v; g += v; b += v; }
        if (sh) { const wt = Math.max(0, 0.55 - l) / 0.55; const v = sh * 72 * wt * wt; r += v; g += v; b += v; }
      }
      if (fade) { const f = fade * 0.3; r = r * (1 - f) + 104 * f; g = g * (1 - f) + 99 * f; b = b * (1 - f) + 92 * f; }
      if (grain) { const n = (Math.random() - 0.5) * grain * 58; r += n; g += n; b += n; }
      px[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      px[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      px[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    ctx.putImageData(d, 0, 0);
  }
  if (a.sharpen) sharpen(ctx, w, h, a.sharpen / 100);
  if (a.vignette) {
    const v = a.vignette / 100;
    const g2 = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.74);
    g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,' + (v * 0.8).toFixed(2) + ')');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
  }
}
function sharpen(ctx, w, h, amt) {
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const a = src.data, o = out.data;
  const k = amt * 1.1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { o[i] = a[i]; o[i + 1] = a[i + 1]; o[i + 2] = a[i + 2]; o[i + 3] = a[i + 3]; continue; }
      for (let c = 0; c < 3; c++) {
        const cen = a[i + c];
        const sum = a[i - 4 + c] + a[i + 4 + c] + a[i - w * 4 + c] + a[i + w * 4 + c];
        let v = cen + k * (cen * 4 - sum);
        o[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      o[i + 3] = a[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}
function draw() {
  if (!ED.img || !ED.ctx) return;
  const ctx = ED.ctx, w = ED.sw, h = ED.sh;
  const iw = ED.img.naturalWidth, ih = ED.img.naturalHeight;
  const r = cropRect(iw, ih);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.filter = ED.before ? 'none' : nativeFilter(ED.adj);
  ctx.drawImage(ED.img, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
  ctx.filter = 'none';
  if (!ED.before) pipeline(ctx, w, h, ED.adj);
}
function drawThumbs() {
  if (!ED.img) return;
  const iw = ED.img.naturalWidth, ih = ED.img.naturalHeight;
  const side = Math.min(iw, ih);
  const sx = (iw - side) / 2, sy = (ih - side) / 2;
  $$('canvas[data-thumb]').forEach((cv) => {
    const m = MOODS.find((x) => x.id === cv.dataset.thumb); if (!m) return;
    const a = Object.assign(adjDefaults(), m.p);
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.filter = nativeFilter(a);
    c.drawImage(ED.img, sx, sy, side, side, 0, 0, 66, 66);
    c.filter = 'none';
    const light = Object.assign({}, a); light.sharpen = 0; light.grain = 0;
    pipeline(c, 66, 66, light);
  });
}
function bindStageGestures(st) {
  let pts = {}, base = null;
  st.addEventListener('pointerdown', (e) => {
    st.setPointerCapture(e.pointerId);
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    base = null;
  });
  st.addEventListener('pointermove', (e) => {
    if (!pts[e.pointerId] || !ED.img) return;
    const ids = Object.keys(pts);
    const iw = ED.img.naturalWidth, ih = ED.img.naturalHeight;
    const r = cropRect(iw, ih);
    if (ids.length >= 2) {
      const a = pts[ids[0]], b = pts[ids[1]];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      const a2 = pts[ids[0]], b2 = pts[ids[1]];
      const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (d0 > 8 && d1 > 8) {
        ED.scale = clamp(ED.scale * (d1 / d0), 1, 3.2);
        const z = $('#zoom'); if (z) { z.value = Math.round(ED.scale * 100); z.parentNode.querySelector('.val').textContent = ED.scale.toFixed(1) + 'x'; }
      }
    } else {
      const prev = pts[e.pointerId];
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      ED.cx = clamp(ED.cx - dx / st.clientWidth * (r.sw / iw), 0, 1);
      ED.cy = clamp(ED.cy - dy / st.clientHeight * (r.sh / ih), 0, 1);
    }
    draw();
  });
  const up = (e) => { delete pts[e.pointerId]; };
  st.addEventListener('pointerup', up);
  st.addEventListener('pointercancel', up);
}
function exportImage() {
  if (!ED.img) return;
  const p = purposeOf(ED.purposeId);
  const [ow, oh] = p.out;
  const cv = document.createElement('canvas');
  cv.width = ow; cv.height = oh;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const iw = ED.img.naturalWidth, ih = ED.img.naturalHeight;
  const r = cropRect(iw, ih);
  ctx.filter = nativeFilter(ED.adj);
  ctx.drawImage(ED.img, r.sx, r.sy, r.sw, r.sh, 0, 0, ow, oh);
  ctx.filter = 'none';
  pipeline(ctx, ow, oh, ED.adj);
  cv.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const name = 'jjik_' + p.id + '_' + today().replace(/-/g, '') + '.jpg';
    LAST_EXPORT = blob;
    sheet(`<h3>저장 준비 끝</h3>
      <div class="card-s">${esc(p.name)} · ${ow}×${oh}</div>
      <div style="margin:14px 0"><img src="${url}" style="width:100%;border-radius:12px" alt="결과"></div>
      <a class="btn pt" style="display:block;text-decoration:none" href="${url}" download="${name}">기기에 저장</a>
      <div class="rowbtns"><button class="btn" data-act="memFromExport">♥ 추억 앨범에도 남기기</button></div>
      <div class="small" style="margin-top:10px">아이폰에서 저장 버튼이 안 먹으면, 위 사진을 <b>길게 눌러 "사진에 추가"</b>를 선택하세요.</div>`);
    markShotToday();
  }, 'image/jpeg', 0.94);
}

/* ================= 알림 ================= */
function viewNotify() {
  const n = S.notif;
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
  let s = `<div class="card">
    <div class="switch"><div><div class="card-t">촬영 알림</div><div class="card-s">정한 시간에 살짝 알려드려요</div></div>
      <div class="tog ${n.on ? 'on' : ''}" data-act="notifOn"></div></div>
  </div>`;
  s += `<h2 class="sec">요일</h2><div class="card"><div class="days">
    ${names.map((nm, i) => `<button class="${n.days.indexOf(i) >= 0 ? 'on' : ''}" data-act="day" data-id="${i}">${nm}</button>`).join('')}
  </div></div>`;
  s += `<h2 class="sec">시간</h2><div class="card"><input class="timeinput" type="time" id="ntime" value="${n.time}">
    <div class="small" style="margin-top:8px">해 지기 1시간 전이 가장 예쁜 빛이에요. 오늘은 <b>${hhmm(minusMin(sunTimes(new Date(), COORD.lat, COORD.lng).sunset || new Date(), 60))}</b>쯤입니다.</div>
    <div class="rowbtns"><button class="btn ghost sm" data-act="setGolden">골든아워 시간으로 맞추기</button></div></div>`;

  s += `<h2 class="sec">알림 권한</h2><div class="card">
    <div class="card-s">${perm === 'granted' ? '✅ 알림을 보낼 수 있어요.' : perm === 'denied' ? '❌ 차단되어 있어요. 휴대폰 설정에서 이 사이트의 알림을 허용해주세요.' : '아직 허용하지 않았어요.'}</div>
    <div class="rowbtns">
      <button class="btn ${perm === 'granted' ? 'ghost' : 'pt'}" data-act="askPerm">알림 허용하기</button>
      <button class="btn ghost" data-act="testNotif">지금 테스트</button>
    </div>
    <div class="small" style="margin-top:10px">웹앱이라 <b>브라우저를 완전히 종료하면 알림이 안 뜰 수 있어요.</b> 홈 화면에 추가해두면 훨씬 잘 뜹니다. (나중에 앱스토어용 앱으로 만들면 100% 확실해집니다.)</div>
  </div>`;

  s += `<h2 class="sec">알림 문구 미리보기</h2><div class="card list">
    ${NOTIFY_MESSAGES.slice(0, 6).map((m) => `<div class="item"><div class="emo">◔</div><div><div class="d">${esc(m)}</div></div></div>`).join('')}
  </div><div class="small">문구는 매번 랜덤으로 하나씩 나와요. 총 ${NOTIFY_MESSAGES.length}가지.</div>`;
  return s;
}
function fireNotif(force) {
  const msg = pick(NOTIFY_MESSAGES, dayHash('n' + new Date().getHours()));
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification('찍어줄게', { body: msg, icon: 'icon.svg', tag: 'jjik-daily' });
      if (force) toast('알림을 보냈어요');
      return;
    } catch (e) {}
  }
  if (force) toast(msg); else sheet(`<h3>오늘의 알림</h3><div class="saybox" style="margin-top:12px">${esc(msg)}</div>`);
}
function notifTick() {
  const n = S.notif;
  if (!n.on) return;
  const d = new Date();
  if (n.days.indexOf(d.getDay()) < 0) return;
  const cur = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (cur === n.time && n.lastFired !== today()) {
    n.lastFired = today(); save(); fireNotif(false);
  }
}
setInterval(notifTick, 20000);

/* ================= 보관함 ================= */
function viewSaved() {
  let s = '';
  s += `<h2 class="sec">추억 앨범</h2>
    <div id="memGrid"><div class="empty" style="padding:16px">불러오는 중…</div></div>
    <div class="rowbtns"><button class="btn pt" data-act="memAdd">+ 추억 남기기</button></div>`;
  const favs = COMPOSITIONS.filter((c) => S.favs.indexOf(c.id) >= 0);
  s += `<h2 class="sec">저장한 구도 ${favs.length}</h2>`;
  if (!favs.length) s += `<div class="empty">촬영 탭에서 하트를 누르면 여기에 모여요</div>`;
  favs.forEach((c) => {
    s += `<div class="card" data-act="openCompo" data-id="${c.id}"><div class="compo">
      <div class="guide">${guideSVG(c.guide)}</div>
      <div class="meta"><div class="card-t">${esc(c.name)}</div><div class="tagline">${esc(c.tagline)}</div>
      <div class="kv"><span>📐 ${esc(c.camera.height)}</span><span>🔍 ${esc(c.camera.zoom)}</span></div></div>
    </div></div>`;
  });

  s += `<h2 class="sec">촬영 일지</h2><div class="card">`;
  if (!S.days.length) s += `<div class="empty" style="padding:18px">아직 기록이 없어요</div>`;
  else {
    const last = S.days.slice().sort().reverse().slice(0, 14);
    s += `<div class="chips wrap">${last.map((d) => `<span class="chip" style="pointer-events:none">${d.slice(5).replace('-', '/')}</span>`).join('')}</div>`;
    s += `<div class="small" style="margin-top:10px">연속 ${calcStreak()}일 · 총 ${S.days.length}일</div>`;
  }
  s += `</div>`;
  s += `<div class="rowbtns"><button class="btn ghost" data-act="doneShoot">오늘 찍었어요 ✓</button></div>`;

  s += `<h2 class="sec">잘 안 나올 때</h2><div class="card">
    ${TROUBLES.map((t) => `<div class="qa"><div class="q">${esc(t.q)}</div><div class="a">${esc(t.a)}</div></div>`).join('')}
  </div>`;
  s += `<h2 class="sec">이 앱에 대해</h2><div class="card"><div class="small">
    사진과 기록은 <b>이 기기 안에만</b> 저장돼요. 서버로 보내지 않습니다.<br>
    브라우저 기록을 지우면 저장한 내용도 함께 사라집니다.
  </div><div class="rowbtns"><button class="btn ghost sm" data-act="wipe">기록 전부 지우기</button></div></div>`;
  return s;
}

/* ================= 이벤트 ================= */
function markShotToday() {
  const t = today();
  if (S.days.indexOf(t) < 0) { S.days.push(t); save(); }
}
document.addEventListener('click', (e) => {
  const closeEl = e.target.closest('[data-close]');
  if (closeEl) { closeSheet(); return; }
  const tabBtn = e.target.closest('.tab');
  if (tabBtn) { TAB = tabBtn.dataset.tab; render(); return; }
  const mp0 = e.target.closest('[data-memplace]');
  if (mp0) {
    MEM_PLACE = mp0.dataset.memplace === MEM_PLACE ? null : mp0.dataset.memplace;
    $$('#memPlaceChips .chip').forEach((c) => c.classList.toggle('on', c.dataset.memplace === MEM_PLACE));
    return;
  }
  const pp0 = e.target.closest('[data-mempeople]');
  if (pp0) {
    MEM_PEOPLE = pp0.dataset.mempeople === MEM_PEOPLE ? null : pp0.dataset.mempeople;
    $$('#memPeopleChips .chip').forEach((c) => c.classList.toggle('on', c.dataset.mempeople === MEM_PEOPLE));
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;

  if (act === 'go') { TAB = el.dataset.tab; if (el.dataset.sub) SUB = el.dataset.sub; render(); return; }
  if (act === 'sub') { SUB = el.dataset.sub; render(); return; }
  if (act === 'purpose') { S.lastPurpose = id; save(); render(); return; }
  if (act === 'mode') { S.mode = id; save(); render(); return; }
  if (act === 'goal') { S.goal = (S.goal === id ? null : id); save(); render(); return; }
  if (act === 'place') { S.place = (S.place === id ? null : id); save(); render(); return; }
  if (act === 'axis') { S.axis = S.axis || {}; S.axis[el.dataset.ax] = el.dataset.v; save(); render(); return; }
  if (act === 'openCompo') { openCompo(id); return; }
  if (act === 'cam') { e.stopPropagation(); openCamera(id || (CAM.list[0] && CAM.list[0].id)); return; }
  if (act === 'pk') { pickChoose(+el.dataset.keep); return; }
  if (act === 'pkCancel') {
    if (PK) { PK.round.concat(PK.next).forEach((x) => URL.revokeObjectURL(x.url)); PK = null; }
    render(); return;
  }
  if (act === 'fav') {
    e.stopPropagation();
    const i = S.favs.indexOf(id);
    if (i >= 0) { S.favs.splice(i, 1); toast('보관함에서 뺐어요'); }
    else { S.favs.push(id); toast('보관함에 저장했어요'); }
    save(); closeSheet(); render(); return;
  }
  if (act === 'homePlace') { S.place = (S.place === id ? null : id); save(); render(); return; }
  if (act === 'ddaySet') {
    sheet(`<h3>디데이 등록 (선택)</h3>
      <div class="card-s" style="margin-top:6px">사귄 날을 넣으면 홈에서 며칠째인지 세어주고, 추억마다 "며칠째 되던 날"이 붙어요. 친구·가족과 쓰신다면 안 넣어도 됩니다.</div>
      <h2 class="sec">무슨 날인가요</h2>
      <input class="timeinput" type="text" id="ddayLabel" maxlength="12" value="${esc(S.ddayLabel || '사귄 날')}" placeholder="예: 사귄 날">
      <h2 class="sec">언제부터</h2>
      <input class="timeinput" type="date" id="ddayDate" value="${S.dday || today()}">
      <div class="rowbtns" style="margin-top:14px">
        <button class="btn pt" data-act="ddaySave">저장</button>
        ${S.dday ? '<button class="btn ghost" data-act="ddayClear">디데이 없애기</button>' : ''}
      </div>`);
    return;
  }
  if (act === 'ddaySave') {
    const dv = $('#ddayDate') && $('#ddayDate').value;
    if (!dv) { toast('날짜를 골라주세요'); return; }
    S.dday = dv; S.ddayLabel = ($('#ddayLabel') && $('#ddayLabel').value.trim()) || '사귄 날';
    save(); closeSheet(); render(); toast('디데이를 등록했어요 ♥'); return;
  }
  if (act === 'ddayClear') { S.dday = null; save(); closeSheet(); render(); toast('디데이를 없앴어요'); return; }
  if (act === 'aikeySave') {
    const v = ($('#aiKeyIn2') && $('#aiKeyIn2').value || '').trim();
    if (v.length < 20) { toast('열쇠가 너무 짧아요. 다시 확인해주세요'); return; }
    try { localStorage.setItem(AIKEY_STORE, v); } catch (err) {}
    closeSheet();
    if (AI_CB) { const cb = AI_CB; AI_CB = null; cb(v); }
    return;
  }
  if (act === 'aikeyReset') { localStorage.removeItem(AIKEY_STORE); closeSheet(); toast('열쇠를 지웠어요. 다시 시도하면 입력창이 떠요'); return; }
  if (act === 'placeAI') {
    const q = ($('#placeQ') && $('#placeQ').value || '').trim();
    if (q.length < 2) { toast('장소 이름을 입력해주세요'); return; }
    ensureAIKey((k) => runPlaceAI(k, q));
    return;
  }
  if (act === 'aiRetouch') { ensureAIKey((k) => runAIRetouch(k)); return; }
  if (act === 'examGen') { const eid = id; ensureAIKey((k) => runExamGen(k, eid)); return; }
  if (act === 'aiRetouchApply') {
    if (!AI_RETOUCH_URL) return;
    const img = new Image();
    img.onload = () => {
      ED.img = img; ED.scale = 1; ED.cx = 0.5; ED.cy = 0.5;
      applyMood('none'); // 이미 보정이 반영된 사진이라 슬라이더는 처음부터
      AI_RETOUCH_URL = null;
      closeSheet(); render(); toast('AI 보정본으로 바꿨어요');
    };
    img.src = AI_RETOUCH_URL;
    return;
  }
  if (act === 'memAdd') { memAddSheet(null); return; }
  if (act === 'memOpen') { memOpen(+id); return; }
  if (act === 'memSave') { memSave(); return; }
  if (act === 'memFromExport') {
    if (!LAST_EXPORT) { toast('먼저 사진을 저장해주세요'); return; }
    memAddSheet(LAST_EXPORT); return;
  }
  if (act === 'memDel') {
    if (confirm('이 추억을 지울까요?')) {
      memDel(+id).then(() => { closeSheet(); toast('지웠어요'); if (TAB === 'saved') fillMemGrid(); if (TAB === 'home') fillHomeMem(); });
    }
    return;
  }
  if (act === 'check') {
    const t = today(); const arr = S.log[t] || [];
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1); else { arr.push(id); markShotToday(); }
    S.log[t] = arr; save(); render(); return;
  }
  if (act === 'doneShoot') { markShotToday(); closeSheet(); toast('오늘 촬영 기록했어요'); render(); return; }
  if (act === 'geo') { askGeo(); return; }
  if (act === 'trouble') {
    sheet(`<h3>잘 안 나올 때</h3>${TROUBLES.map((t) => `<div class="qa"><div class="q">${esc(t.q)}</div><div class="a">${esc(t.a)}</div></div>`).join('')}`);
    return;
  }
  // 보정
  if (act === 'epurpose') { ED.purposeId = id; S.lastPurpose = id; save(); render(); return; }
  if (act === 'mood') { applyMood(id); render(); return; }
  if (act === 'bw') { ED.adj.bw = !ED.adj.bw; el.classList.toggle('on'); draw(); drawThumbs(); return; }
  if (act === 'grid') { ED.grid = !ED.grid; render(); return; }
  if (act === 'before') { ED.before = !ED.before; draw(); toast(ED.before ? '원본을 보고 있어요' : '보정본으로 돌아왔어요'); return; }
  if (act === 'reset') { applyMood('none'); render(); return; }
  if (act === 'export') { exportImage(); return; }
  if (act === 'newimg') { ED.img = null; render(); return; }
  // 알림
  if (act === 'notifOn') {
    S.notif.on = !S.notif.on; save();
    if (S.notif.on && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
    render(); return;
  }
  if (act === 'day') {
    const d = +id, i = S.notif.days.indexOf(d);
    if (i >= 0) S.notif.days.splice(i, 1); else S.notif.days.push(d);
    save(); render(); return;
  }
  if (act === 'askPerm') {
    if (typeof Notification === 'undefined') { toast('이 브라우저는 알림을 지원하지 않아요'); return; }
    Notification.requestPermission().then(() => render());
    return;
  }
  if (act === 'testNotif') { fireNotif(true); return; }
  if (act === 'setGolden') {
    const ss = sunTimes(new Date(), COORD.lat, COORD.lng).sunset;
    if (ss) { const g = minusMin(ss, 60); S.notif.time = pad(g.getHours()) + ':' + pad(g.getMinutes()); save(); render(); toast('골든아워 시간으로 맞췄어요'); }
    return;
  }
  if (act === 'wipe') {
    if (confirm('저장한 구도·촬영 기록을 모두 지웁니다. 계속할까요?')) {
      localStorage.removeItem(KEY); S = load(); render(); toast('전부 지웠어요');
    }
    return;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'ntime') { S.notif.time = e.target.value; save(); }
  if (e.target.id === 'memFile') {
    const nm = $('#memFileName');
    if (nm && e.target.files && e.target.files[0]) nm.textContent = '✓ ' + e.target.files[0].name;
  }
});
$('#btnHelp').addEventListener('click', () => {
  sheet(`<h3>어떻게 쓰나요</h3>
    <ol class="steps" style="margin-top:12px">
      <li><b>홈</b> — 지금 있는 장소를 누르면 그 자리에서 쓸 구도·포즈·보정을 바로 추천해줘요. 5컷 체크만 채우면 하루 완성.</li>
      <li><b>촬영</b> — 용도(피드·프사·배경화면)를 고르고, 1인/2인을 정하면 구도 목록이 나와요. 카드를 누르면 순서와 할 말이 나오고, <b>카메라 열기</b>를 누르면 화면에 구도가 겹쳐 보입니다.</li>
      <li><b>보정</b> — 찍은 사진을 넣고 무드를 고르면 끝. 연속 촬영한 여러 장을 넣으면 <b>둘 중 하나 고르기</b>로 베스트 컷을 찾아줘요.</li>
      <li><b>알림</b> — 시간을 정해두면 "지금 한 장" 하고 알려줘요.</li>
      <li><b>보관함 · 추억 앨범</b> — 제일 잘 나온 사진에 날짜·장소·한 줄을 붙여 모아두면, 홈에서 "그날의 우리"로 다시 만나요. 전부 이 기기 안에만 저장됩니다.</li>
    </ol>
    <div class="hr"></div>
    <div class="card-t">촬영 전 딱 한 번만 해둘 것</div>
    <ol class="steps" style="margin-top:10px">
      <li>휴대폰 카메라 설정에서 <b>격자(수직·수평 안내선)</b>를 켜세요.</li>
      <li>얼굴 컷은 항상 <b>2배 줌</b>. 가까이 다가가면 얼굴이 커집니다.</li>
      <li>전신 컷은 항상 <b>카메라를 무릎 높이</b>로.</li>
      <li>셔터를 <b>꾹 눌러 연속 촬영</b>. 10장 중 1장을 고릅니다.</li>
    </ol>`);
});
window.addEventListener('resize', () => { if (TAB === 'edit' && ED.img) { layoutStage(); draw(); } });

/* 서비스워커(홈 화면 추가용) */
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
})();
