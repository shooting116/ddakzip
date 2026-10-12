// /find/ 예산 맞춤 찾기 — 지도 + 리스트 (브라우저에서 동작)
// 데이터: /data/regions.json, /data/complexes/{lawd}.json (빌드 때 생성)
// 기준: 예산 이하 단지 전부, 예산의 85~100%가 "딱 맞는 구간". 마커는 대표 평형 시세.

declare const kakao: any;

type Slim = {
  id: string; n: string; d: string; b: number | null; la: number | null; lo: number | null;
  u: number | null; r: number | null; p: number | null; pb: string | null; n6: number; n36: number; st: number;
  t: [number, number | null, string | null, number, number | null][];
  l: [string, number, number] | null;
};
type Regions = { asOf: string; sido: Record<string, { lawd: string; name: string; n: number; st: number }[]> };

interface State {
  budgetMan: number;         // 만 원. 0이면 예산 없이 전체
  sido: string;
  lawd: string;              // 'all' = 시도 전체
  type: 'all' | 59 | 74 | 84 | 101 | 114 | 'big';
  built: 'all' | 10 | 20 | 'old';
  units: 'all' | 300 | 500 | 1000;
  fitOnly: boolean;
  mapOnly: boolean;
  sort: 'fit' | 'priceAsc' | 'priceDesc' | 'trades' | 'new' | 'units';
  view: 'both' | 'list';
}
const KEY = 'ddakzip-find-v1';
const BUDGET_KEY = 'ddakzip-budget-v1';
const FIT_LOW = 0.85;
const PAGE = 40;

let s: State;
let root: HTMLElement;
let regions: Regions;
const cache = new Map<string, Slim[]>();
let rows: Slim[] = [];                 // 현재 지역의 단지
let fitted: { c: Slim; fitKey: number | null; fitPrice: number | null; ratio: number | null }[] = [];
let shown = PAGE;
let map: any = null, clusterer: any = null, overlay: any = null;
const markers = new Map<string, any>();
let bounds: any = null;
let selected: string | null = null;
let mapReady = false;
const KAKAO_KEY = (import.meta as any).env.PUBLIC_KAKAO_JS_KEY as string | undefined;

// ---------- 유틸 ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function eok(man: number | null | undefined, digits = 1): string {
  if (man == null) return '—';
  if (man < 10000) return `${Math.round(man).toLocaleString()}만`;
  const e = man / 10000;
  const str = e >= 100 ? e.toFixed(0) : e.toFixed(digits);
  return `${str.replace(/\.?0+$/, '')}억`;
}
function pyeong(key: number) {
  const P: Record<number, number> = { 33: 13, 39: 16, 46: 18, 49: 20, 51: 21, 59: 25, 66: 27, 74: 30, 84: 34, 95: 38, 101: 40, 114: 45, 125: 50, 135: 54, 150: 60, 165: 66, 180: 72, 200: 80, 240: 96 };
  return P[key] ?? Math.round((key * 1.33) / 3.3058);
}
const basisLabel: Record<string, string> = { median6: '6개월 중앙값', ref: '참고용', last: '마지막 거래가' };

function load(): State {
  const d: State = { budgetMan: 0, sido: '서울', lawd: 'all', type: 'all', built: 'all', units: 'all', fitOnly: false, mapOnly: false, sort: 'fit', view: 'both' };
  try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(d, JSON.parse(raw)); } catch { /* */ }
  try { const b = localStorage.getItem(BUDGET_KEY); if (b && !d.budgetMan) { const j = JSON.parse(b); d.budgetMan = j.budgetMan ?? 0; if (j.lawd) { d.lawd = j.lawd; d.sido = j.sido ?? d.sido; } } } catch { /* */ }
  const q = new URLSearchParams(location.search);
  if (q.get('budget')) d.budgetMan = Number(q.get('budget')) || 0;
  if (q.get('lawd')) d.lawd = q.get('lawd')!;
  if (q.get('sido')) d.sido = q.get('sido')!;
  return d;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } }

// ---------- 데이터 ----------
async function fetchJson<T>(url: string): Promise<T> { const r = await fetch(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }
async function loadRows(): Promise<void> {
  const list = regions.sido[s.sido] ?? [];
  const lawds = s.lawd === 'all' ? list.map((x) => x.lawd) : [s.lawd];
  const out: Slim[] = [];
  let i = 0;
  for (const lawd of lawds) {
    if (!cache.has(lawd)) {
      const d = await fetchJson<{ c: Slim[] }>(`/data/complexes/${lawd}.json`);
      cache.set(lawd, d.c);
      if (lawds.length > 3) setStatus(`불러오는 중 ${++i}/${lawds.length}`);
    }
    out.push(...cache.get(lawd)!);
  }
  rows = out;
}
function setStatus(t: string) { const el = root.querySelector('#status'); if (el) el.textContent = t; }

// ---------- 계산 ----------
function typeOk(key: number): boolean {
  if (s.type === 'all') return true;
  if (s.type === 'big') return key >= 125;
  if (s.type === 114) return key >= 109 && key < 125;
  return Math.abs(key - (s.type as number)) <= 5;
}
function builtOk(b: number | null): boolean {
  if (s.built === 'all') return true;
  if (b == null) return false;
  const age = new Date().getFullYear() - b;
  if (s.built === 'old') return age > 20;
  return age <= s.built;
}
function unitsOk(u: number | null): boolean {
  if (s.units === 'all') return true;
  return (u ?? 0) >= s.units;
}
function compute() {
  const B = s.budgetMan;
  fitted = [];
  for (const c of rows) {
    if (!builtOk(c.b) || !unitsOk(c.u)) continue;
    const types = c.t.filter((t) => t[1] != null && typeOk(t[0]));
    if (!types.length) continue;
    let fitKey: number | null = null, fitPrice: number | null = null, ratio: number | null = null;
    if (B > 0) {
      const fits = types.filter((t) => (t[1] as number) <= B).sort((a, b) => (b[1] as number) - (a[1] as number));
      if (!fits.length) continue;
      fitKey = fits[0][0]; fitPrice = fits[0][1] as number; ratio = fitPrice / B;
      if (s.fitOnly && ratio < FIT_LOW) continue;
    } else {
      const t = types.find((x) => x[0] === c.r) ?? types[0];
      fitKey = t[0]; fitPrice = t[1] as number;
    }
    if (s.mapOnly && bounds && c.la != null && c.lo != null && !bounds.contain(new kakao.maps.LatLng(c.la, c.lo))) continue;
    if (s.mapOnly && bounds && c.la == null) continue;
    fitted.push({ c, fitKey, fitPrice, ratio });
  }
  const by: Record<State['sort'], (a: typeof fitted[0], b: typeof fitted[0]) => number> = {
    fit: (a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || b.c.n6 - a.c.n6,
    priceAsc: (a, b) => (a.fitPrice ?? 0) - (b.fitPrice ?? 0),
    priceDesc: (a, b) => (b.fitPrice ?? 0) - (a.fitPrice ?? 0),
    trades: (a, b) => b.c.n6 - a.c.n6 || b.c.n36 - a.c.n36,
    new: (a, b) => (b.c.b ?? 0) - (a.c.b ?? 0),
    units: (a, b) => (b.c.u ?? 0) - (a.c.u ?? 0),
  };
  fitted.sort(by[s.sort]);
}

// ---------- 화면 ----------
function chip(field: keyof State, v: State[keyof State], label: string) {
  return `<button type="button" class="chip ${String(s[field]) === String(v) ? 'on' : ''}" data-set="${field}" data-value="${esc(String(v))}">${esc(label)}</button>`;
}
function renderBudget() {
  const list = regions.sido[s.sido] ?? [];
  return `
    <div class="card tight find-top">
      <div class="row">
        <label class="budget"><span class="sub">예산</span>
          <span class="bval"><input type="text" inputmode="numeric" data-num="budgetMan" value="${s.budgetMan ? s.budgetMan.toLocaleString() : ''}" placeholder="예: 62,800" aria-label="예산(만 원)" /><span>만 원</span></span>
          <b class="beok">${s.budgetMan ? `${eok(s.budgetMan, 2)}까지` : '예산 없이 전체'}</b>
        </label>
        <a class="sub link" href="/calc/">계산기에서 가져오기 ›</a>
      </div>
      <div class="row selects">
        <select data-select="sido" aria-label="시도">${Object.keys(regions.sido).map((x) => `<option ${x === s.sido ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select data-select="lawd" aria-label="시군구">
          <option value="all" ${s.lawd === 'all' ? 'selected' : ''}>${esc(s.sido)} 전체 (${list.reduce((a, x) => a + x.n, 0).toLocaleString()}단지)</option>
          ${list.map((x) => `<option value="${x.lawd}" ${x.lawd === s.lawd ? 'selected' : ''}>${esc(x.name)} (${x.n})</option>`).join('')}
        </select>
      </div>
    </div>`;
}
function renderFilters() {
  return `
    <div class="filters">
      <div class="chips">${chip('type', 'all', '평형 전체')}${chip('type', 59, '59㎡')}${chip('type', 74, '74㎡')}${chip('type', 84, '84㎡')}${chip('type', 101, '101㎡')}${chip('type', 114, '114㎡')}${chip('type', 'big', '125㎡+')}</div>
      <div class="chips">${chip('built', 'all', '준공 전체')}${chip('built', 10, '10년 이내')}${chip('built', 20, '20년 이내')}${chip('built', 'old', '20년 초과')}${chip('units', 'all', '세대 전체')}${chip('units', 300, '300+')}${chip('units', 500, '500+')}${chip('units', 1000, '1,000+')}</div>
      <div class="chips">
        ${s.budgetMan ? `<button type="button" class="chip ${s.fitOnly ? 'on' : ''}" data-toggle="fitOnly">딱 맞는 구간만 (예산의 85~100%)</button>` : ''}
        ${KAKAO_KEY ? `<button type="button" class="chip ${s.mapOnly ? 'on' : ''}" data-toggle="mapOnly">지도 영역 안만</button>` : ''}
        <select class="sortsel" data-select="sort" aria-label="정렬">
          <option value="fit" ${s.sort === 'fit' ? 'selected' : ''}>예산에 가까운 순</option>
          <option value="priceAsc" ${s.sort === 'priceAsc' ? 'selected' : ''}>가격 낮은 순</option>
          <option value="priceDesc" ${s.sort === 'priceDesc' ? 'selected' : ''}>가격 높은 순</option>
          <option value="trades" ${s.sort === 'trades' ? 'selected' : ''}>최근 거래 많은 순</option>
          <option value="new" ${s.sort === 'new' ? 'selected' : ''}>신축 순</option>
          <option value="units" ${s.sort === 'units' ? 'selected' : ''}>세대수 많은 순</option>
        </select>
      </div>
    </div>`;
}
function renderItem(f: typeof fitted[0]) {
  const c = f.c;
  const t = c.t.find((x) => x[0] === f.fitKey);
  const yoy = t?.[4];
  const pct = f.ratio != null ? Math.round(f.ratio * 100) : null;
  const fitCls = pct == null ? '' : pct >= 85 ? 'p-ok' : pct >= 60 ? 'p-soft' : 'p-soft';
  const basis = t?.[2] ? basisLabel[t[2]] ?? '' : '';
  return `
    <a class="item ${selected === c.id ? 'sel' : ''}" href="/apt/${esc(c.id)}/" data-id="${esc(c.id)}">
      <div class="it-main">
        <div class="it-name">${esc(c.n)} <span class="sub">${esc(c.d)}${c.b ? ` · ${c.b}년` : ''}${c.u ? ` · ${c.u.toLocaleString()}세대` : ''}</span></div>
        <div class="it-sub sub">${f.fitKey}㎡ · ${pyeong(f.fitKey!)}평형 · ${basis}${t && t[3] ? ` · 6개월 ${t[3]}건` : ''}${yoy != null ? ` · <span class="${yoy >= 0 ? 'up' : 'down'}">1년 ${yoy > 0 ? '+' : ''}${yoy}%</span>` : ''}</div>
        ${pct != null ? `<div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div>` : ''}
      </div>
      <div class="it-price"><b>${eok(f.fitPrice, 2)}</b>${pct != null ? `<span class="pill ${fitCls}">예산의 ${pct}%</span>` : ''}</div>
    </a>`;
}
function renderList() {
  const n = fitted.length, fit = fitted.filter((f) => (f.ratio ?? 0) >= FIT_LOW).length;
  const head = s.budgetMan
    ? `<b>${n.toLocaleString()}단지</b>가 예산 안에 있어요${fit ? ` · 딱 맞는 구간 <b>${fit.toLocaleString()}</b>` : ''}`
    : `<b>${n.toLocaleString()}단지</b>`;
  return `
    <div class="count sub2" id="count">${head}<span class="src"> · 실거래 기준 ${esc(regions.asOf)}</span></div>
    <div class="card list" id="list">
      ${fitted.length ? fitted.slice(0, shown).map(renderItem).join('') : `<p class="sub2" style="margin:8px 0">조건에 맞는 단지가 없어요. 예산이나 지역·필터를 바꿔보세요.</p>`}
      ${fitted.length > shown ? `<button type="button" class="btn ghost more" data-action="more">${(fitted.length - shown).toLocaleString()}개 더 보기</button>` : ''}
    </div>`;
}
function renderTop() { const w = root.querySelector('#top'); if (w) w.innerHTML = renderBudget() + renderFilters(); }
function renderAll() {
  save();
  root.innerHTML = `
    <div id="top">${renderBudget()}${renderFilters()}</div>
    ${KAKAO_KEY ? `<div class="mapwrap ${s.view === 'list' ? 'hide' : ''}"><div id="map"></div><div class="maptip sub" id="maptip"></div></div>` : `<div class="card tight sub2">지도 키가 설정되지 않아 목록만 보여드려요.</div>`}
    <div id="status" class="sub"></div>
    <div id="listwrap">${renderList()}</div>
    <p class="src">시세 = 최근 6개월 실거래 중앙값(해제·직거래 제외). 6개월 거래가 3건 미만이면 참고용, 없으면 마지막 거래가. 출처: 국토교통부 실거래가. 특정 단지를 추천하지 않으며 판단은 이용자 몫입니다.</p>`;
  initMap();
  syncMarkers();
}
function rerenderList() { const w = root.querySelector('#listwrap'); if (w) w.innerHTML = renderList(); }

// ---------- 지도 ----------
function loadKakao(): Promise<void> {
  return new Promise((res, rej) => {
    if ((window as any).kakao?.maps) return res();
    const sc = document.createElement('script');
    sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=clusterer`;
    sc.onload = () => kakao.maps.load(res);
    sc.onerror = rej;
    document.head.appendChild(sc);
  });
}
function initMap() {
  const el = root.querySelector<HTMLElement>('#map');
  if (!el || !KAKAO_KEY) return;
  if (map) return;
  loadKakao().then(() => {
    map = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(37.5665, 126.978), level: 7 });
    (map as any).getNode = () => el;
    clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 6, disableClickZoom: false, calculator: [10, 50, 200], styles: [
      { width: '36px', height: '36px', background: 'rgba(49,130,246,.85)', borderRadius: '18px', color: '#fff', textAlign: 'center', lineHeight: '36px', fontWeight: '700', fontSize: '12px' },
      { width: '44px', height: '44px', background: 'rgba(49,130,246,.9)', borderRadius: '22px', color: '#fff', textAlign: 'center', lineHeight: '44px', fontWeight: '700', fontSize: '13px' },
      { width: '52px', height: '52px', background: 'rgba(25,31,40,.9)', borderRadius: '26px', color: '#fff', textAlign: 'center', lineHeight: '52px', fontWeight: '700', fontSize: '13px' },
      { width: '60px', height: '60px', background: 'rgba(25,31,40,.95)', borderRadius: '30px', color: '#fff', textAlign: 'center', lineHeight: '60px', fontWeight: '700', fontSize: '14px' },
    ] });
    kakao.maps.event.addListener(map, 'idle', () => {
      bounds = map.getBounds();
      if (s.mapOnly) { compute(); shown = PAGE; rerenderList(); }
    });
    mapReady = true;
    syncMarkers(true);
  }).catch(() => { const tip = root.querySelector('#maptip'); if (tip) tip.textContent = '지도를 불러오지 못했어요.'; });
}
function markerContent(f: typeof fitted[0]) {
  return `<div class="mk ${selected === f.c.id ? 'sel' : ''}"><b>${eok(f.c.p ?? f.fitPrice, 1)}</b></div>`;
}
function syncMarkers(fitBounds = false) {
  if (!mapReady || !clusterer) return;
  clusterer.clear();
  markers.clear();
  const pts: any[] = [];
  const list = fitted.filter((f) => f.c.la != null && f.c.lo != null);
  for (const f of list) {
    const pos = new kakao.maps.LatLng(f.c.la, f.c.lo);
    const m = new kakao.maps.Marker({ position: pos, title: f.c.n });
    kakao.maps.event.addListener(m, 'click', () => select(f.c.id, true));
    markers.set(f.c.id, m);
    pts.push(m);
  }
  clusterer.addMarkers(pts);
  const tip = root.querySelector('#maptip');
  if (tip) tip.textContent = list.length ? `지도에 ${list.length.toLocaleString()}단지` : (rows.length ? '이 지역은 아직 좌표가 없어요' : '');
  if (fitBounds && pts.length) {
    const b = new kakao.maps.LatLngBounds();
    for (const m of pts) b.extend(m.getPosition());
    map.setBounds(b);
  }
}
function select(id: string, fromMap = false) {
  selected = id;
  const f = fitted.find((x) => x.c.id === id);
  if (!f) return;
  if (overlay) overlay.setMap(null);
  if (mapReady && f.c.la != null) {
    const pos = new kakao.maps.LatLng(f.c.la, f.c.lo);
    overlay = new kakao.maps.CustomOverlay({ position: pos, yAnchor: 1.6, content: `<a class="mk-card" href="/apt/${esc(f.c.id)}/"><b>${esc(f.c.n)}</b><span>${f.fitKey}㎡ ${eok(f.fitPrice, 2)}${f.ratio != null ? ` · 예산의 ${Math.round(f.ratio * 100)}%` : ''}</span></a>` });
    overlay.setMap(map);
    if (!fromMap) map.panTo(pos);
  }
  root.querySelectorAll('.item.sel').forEach((e) => e.classList.remove('sel'));
  const item = root.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  item?.classList.add('sel');
  if (fromMap && item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- 이벤트 ----------
async function changeRegion() {
  setStatus('불러오는 중…');
  try { await loadRows(); } catch { setStatus('데이터를 불러오지 못했어요.'); return; }
  setStatus('');
  compute(); shown = PAGE; rerenderList(); syncMarkers(true);
}
function bind() {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-set],[data-toggle],[data-action],.item');
    if (!t) return;
    if (t.dataset.set) {
      const k = t.dataset.set as keyof State; const raw = t.dataset.value!;
      (s as any)[k] = /^\d+$/.test(raw) ? Number(raw) : raw;
      compute(); shown = PAGE; save();
      const fl = root.querySelector('.filters'); if (fl) fl.outerHTML = renderFilters();
      rerenderList(); syncMarkers();
    } else if (t.dataset.toggle) {
      const k = t.dataset.toggle as 'fitOnly' | 'mapOnly'; s[k] = !s[k]; t.classList.toggle('on', s[k]);
      compute(); shown = PAGE; save(); rerenderList(); syncMarkers();
    } else if (t.dataset.action === 'more') {
      shown += PAGE; rerenderList();
    } else if (t.classList.contains('item')) {
      if (mapReady && s.view !== 'list' && !(e as MouseEvent).metaKey) {
        // 첫 클릭은 지도에서 위치 확인, 같은 항목 두 번째 클릭은 상세로 이동
        if (selected !== t.dataset.id) { e.preventDefault(); select(t.dataset.id!); }
      }
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.select === 'sido') { s.sido = t.value; s.lawd = 'all'; save(); renderTop(); changeRegion(); }
    else if (t.dataset.select === 'lawd') { s.lawd = t.value; save(); changeRegion(); }
    else if (t.dataset.select === 'sort') { s.sort = t.value as State['sort']; compute(); shown = PAGE; save(); rerenderList(); }
  });
  let timer: number | undefined;
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.num !== 'budgetMan') return;
    const v = Number(t.value.replace(/[^\d]/g, '')) || 0;
    const pos = t.selectionStart ?? t.value.length;
    const before = t.value.length;
    t.value = v ? v.toLocaleString() : '';
    const after = t.value.length;
    try { t.setSelectionRange(pos + (after - before), pos + (after - before)); } catch { /* */ }
    s.budgetMan = v;
    const b = root.querySelector('.beok'); if (b) b.textContent = v ? `${eok(v, 2)}까지` : '예산 없이 전체';
    clearTimeout(timer);
    timer = window.setTimeout(() => { compute(); shown = PAGE; save(); rerenderList(); syncMarkers(); }, 250);
  });
}

export async function mount(el: HTMLElement) {
  root = el;
  s = load();
  try { regions = await fetchJson<Regions>('/data/regions.json'); }
  catch { root.innerHTML = '<div class="card"><p class="sub2" style="margin:0">데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p></div>'; return; }
  if (!regions.sido[s.sido]) s.sido = Object.keys(regions.sido)[0];
  if (s.lawd !== 'all' && !regions.sido[s.sido].some((x) => x.lawd === s.lawd)) {
    const owner = Object.entries(regions.sido).find(([, l]) => l.some((x) => x.lawd === s.lawd));
    if (owner) s.sido = owner[0]; else s.lawd = 'all';
  }
  bind();
  renderAll();
  await changeRegion();
}
