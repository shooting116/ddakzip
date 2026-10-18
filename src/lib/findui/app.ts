// /find/ 예산 맞춤 찾기 — 지도 + 리스트 (브라우저에서 동작)
// 데이터: /data/regions.json, /data/complexes/{lawd}.json (빌드 때 생성)
// 기준: 예산 이하 단지 전부, 예산의 85~100%가 "쏙 들어오는 구간". 마커는 대표 평형 시세.

declare const kakao: any;

type Slim = {
  id: string; n: string; d: string; b: number | null; la: number | null; lo: number | null;
  u: number | null; r: number | null; p: number | null; pb: string | null; n6: number; n36: number; st: number; h: number;
  t: [number, number | null, string | null, number, number | null, number?, (number | null)?, (number | null)?][];   // [평형키, 시세, 기준, 6개월 건수, 1년 변동, 평균 전용면적, 전세 중앙값, 전세가율]
  j: number | null; jr: number | null;   // 대표 평형 전세 중앙값 · 전세가율(%)
  l: [string, number, number] | null;
  sk: string[];              // 1.5km 안 호재 역 키 ("역·노선")
};
type Station = { k: string; n: string; l: string; st: string; open: number | null; c: number; la: number | null; lo: number | null };
type Regions = { asOf: string; sido: Record<string, { lawd: string; name: string; n: number; st: number; s?: Station[] }[]> };

type TypeKey = 59 | 74 | 84 | 101 | 114 | 'big';
const TYPE_KEYS: TypeKey[] = [59, 74, 84, 101, 114, 'big'];
interface State {
  budgetMan: number;         // 만 원. 0이면 예산 없이 전체
  sido: string;
  lawd: string;              // 'all' = 시도 전체
  types: TypeKey[];          // 평형 복수 선택. 빈 배열 = 전체
  built: 'all' | 10 | 20 | 'old';
  units: 'all' | 300 | 500 | 1000;
  fitOnly: boolean;
  mapOnly: boolean;
  hotOnly: boolean;             // 🔥 거래 활발(같은 시군구 회전율 상위 10%)만
  station: string;              // 역 기준 ("역·노선" 키). ''이면 없음. 그 역 1.5km 안 단지만
  sort: 'fit' | 'priceAsc' | 'priceDesc' | 'trades' | 'new' | 'units';
  view: 'both' | 'list';
}
const KEY = 'ssokjip-find-v1';
const BUDGET_KEY = 'ssokjip-budget-v1';
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
  const d: State = { budgetMan: 0, sido: '서울', lawd: 'all', types: [], built: 'all', units: 'all', fitOnly: false, mapOnly: false, hotOnly: false, station: '', sort: 'fit', view: 'both' };
  const parseTypes = (v: unknown): TypeKey[] => String(v ?? '').split(',').map((x) => (x === 'big' ? 'big' : Number(x))).filter((x): x is TypeKey => TYPE_KEYS.includes(x as TypeKey));
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const j = JSON.parse(raw); if ('type' in j && !('types' in j)) { j.types = parseTypes(j.type); delete j.type; } Object.assign(d, j); } // 예전 저장값(단일 선택) 변환
  } catch { /* */ }
  if (!Array.isArray(d.types)) d.types = [];
  try { const b = localStorage.getItem(BUDGET_KEY); if (b && !d.budgetMan) { const j = JSON.parse(b); d.budgetMan = j.budgetMan ?? 0; if (j.lawd) { d.lawd = j.lawd; d.sido = j.sido ?? d.sido; } } } catch { /* */ }
  // 공유 링크의 조건이 저장된 조건보다 우선
  const q = new URLSearchParams(location.search);
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);
  if (q.get('budget') != null) d.budgetMan = num(q.get('budget')) ?? 0;
  if (q.get('lawd')) d.lawd = q.get('lawd')!;
  if (q.get('sido')) d.sido = q.get('sido')!;
  if (q.get('type')) d.types = parseTypes(q.get('type'));
  if (q.get('built')) d.built = (q.get('built') === 'old' ? 'old' : num(q.get('built')) ?? 'all') as State['built'];
  if (q.get('units')) d.units = (num(q.get('units')) ?? 'all') as State['units'];
  if (q.has('fit')) d.fitOnly = q.get('fit') === '1';
  if (q.has('hot')) d.hotOnly = q.get('hot') === '1';
  if (q.get('sort')) d.sort = q.get('sort') as State['sort'];
  if (q.has('station')) d.station = q.get('station') ?? '';
  if (q.get('view') === 'list') d.view = 'list';
  if (q.toString()) { d.mapOnly = false; }  // 지도 영역은 링크로 못 옮기므로 끈 상태로 시작
  return d;
}
/** 현재 조건을 주소창에 반영 (기본값은 생략). 이 주소가 곧 "조건 링크" */
function syncUrl() {
  const q = new URLSearchParams();
  if (s.budgetMan) q.set('budget', String(s.budgetMan));
  q.set('sido', s.sido);
  if (s.lawd !== 'all') q.set('lawd', s.lawd);
  if (s.types.length) q.set('type', s.types.join(','));
  if (s.built !== 'all') q.set('built', String(s.built));
  if (s.units !== 'all') q.set('units', String(s.units));
  if (s.fitOnly && s.budgetMan) q.set('fit', '1');
  if (s.hotOnly) q.set('hot', '1');
  if (s.station) q.set('station', s.station);
  if (s.sort !== 'fit') q.set('sort', s.sort);
  if (s.view === 'list') q.set('view', 'list');
  try { history.replaceState(null, '', `${location.pathname}?${q.toString()}`); } catch { /* */ }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } syncUrl(); }
async function copyLink(btn: HTMLElement) {
  const url = location.href;
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch { /* */ }
  if (!ok) { // 클립보드 API가 막힌 환경: 임시 입력창으로 복사
    const ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { /* */ } ta.remove();
  }
  const prev = btn.innerHTML;
  btn.innerHTML = ok ? '복사됐어요 ✓' : '복사 실패 — 주소창 주소를 복사해 주세요';
  btn.classList.toggle('done', ok);
  window.setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('done'); }, 1800);
}
/** 현재 지역(시도 전체면 합산)의 호재 역 선택지 */
function stationsFor(): Station[] {
  const list = regions.sido[s.sido] ?? [];
  const regs = s.lawd === 'all' ? list : list.filter((x) => x.lawd === s.lawd);
  const m = new Map<string, Station>();
  for (const r of regs) for (const st of r.s ?? []) { const e = m.get(st.k); if (e) e.c += st.c; else m.set(st.k, { ...st }); }
  return [...m.values()].sort((a, b) => b.c - a.c || a.n.localeCompare(b.n, 'ko'));
}
const stationLabel = (x: Station) => `${x.n}역 · ${x.l} ${x.st === '운행중' ? '개통' : x.open ? `${x.open} 예정` : '예정'}`;

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
  if (!s.types.length) return true;
  return s.types.some((t) => (t === 'big' ? key >= 125 : t === 114 ? key >= 109 && key < 125 : Math.abs(key - t) <= 5));
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
// 결과가 0일 때 "어느 조건에서 몇 개가 빠졌는지" 보여주기 위한 단계별 집계
type Funnel = { label: string; n: number; key?: 'built' | 'units' | 'station' | 'type' | 'budget' | 'fitOnly' | 'hotOnly' | 'mapOnly' }[];
let funnel: Funnel = [];
let noGeoDropped = 0;
function compute() {
  const B = s.budgetMan;
  fitted = [];
  const cnt = { built: 0, units: 0, station: 0, type: 0, budget: 0, fit: 0, hot: 0, map: 0 };
  noGeoDropped = 0;
  for (const c of rows) {
    if (!builtOk(c.b)) continue; cnt.built++;
    if (!unitsOk(c.u)) continue; cnt.units++;
    if (s.station && !c.sk.includes(s.station)) continue; cnt.station++;
    const types = c.t.filter((t) => t[1] != null && typeOk(t[0]));
    if (!types.length) continue; cnt.type++;
    let fitKey: number | null = null, fitPrice: number | null = null, ratio: number | null = null;
    if (B > 0) {
      const fits = types.filter((t) => (t[1] as number) <= B).sort((a, b) => (b[1] as number) - (a[1] as number));
      if (!fits.length) continue; cnt.budget++;
      fitKey = fits[0][0]; fitPrice = fits[0][1] as number; ratio = fitPrice / B;
      if (s.fitOnly && ratio < FIT_LOW) continue;
    } else {
      cnt.budget++;
      const t = types.find((x) => x[0] === c.r) ?? types[0];
      fitKey = t[0]; fitPrice = t[1] as number;
    }
    cnt.fit++;
    if (s.hotOnly && !c.h) continue; cnt.hot++;
    if (s.mapOnly && bounds && c.la != null && c.lo != null && !bounds.contain(new kakao.maps.LatLng(c.la, c.lo))) continue;
    if (s.mapOnly && bounds && c.la == null) { noGeoDropped++; continue; }
    cnt.map++;
    fitted.push({ c, fitKey, fitPrice, ratio });
  }
  funnel = [{ label: s.lawd === 'all' ? s.sido + ' 전체' : '지역', n: rows.length }];
  if (s.built !== 'all') funnel.push({ label: '준공', n: cnt.built, key: 'built' });
  if (s.units !== 'all') funnel.push({ label: '세대수', n: cnt.units, key: 'units' });
  if (s.station) funnel.push({ label: `${s.station.split('·')[0]}역 1.5km 안`, n: cnt.station, key: 'station' });
  if (s.types.length) funnel.push({ label: `평형 ${s.types.map((t) => (t === 'big' ? '125㎡+' : `${t}㎡`)).join('·')}`, n: cnt.type, key: 'type' });
  if (B > 0) funnel.push({ label: '예산 안', n: cnt.budget, key: 'budget' });
  if (B > 0 && s.fitOnly) funnel.push({ label: '쏙 들어오는 구간', n: cnt.fit, key: 'fitOnly' });
  if (s.hotOnly) funnel.push({ label: '거래 활발', n: cnt.hot, key: 'hotOnly' });
  if (s.mapOnly && bounds) funnel.push({ label: '지도 영역 안', n: cnt.map, key: 'mapOnly' });
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
function renderStation() {
  const sts = stationsFor();
  if (!sts.length) return '';
  return `
      <div class="frow"><span class="fl">역 기준</span>
        <select data-select="station" aria-label="역 기준">
          <option value="">선택 안 함 · GTX·신설 노선 역 ${sts.length}개</option>
          ${sts.map((x) => `<option value="${esc(x.k)}" ${x.k === s.station ? 'selected' : ''}>${esc(stationLabel(x))} · 1.5km 안 ${x.c}단지</option>`).join('')}
        </select>
      </div>`;
}
// 접히는 필터 패널: 평형만 항상 보이고 나머지(준공·세대·역·보기 옵션)는 "필터" 버튼으로 연다. 켜진 조건 수·요약은 접혀 있어도 보인다
let filtersOpen = false;
function activeFilters(): string[] {
  const out: string[] = [];
  if (s.built !== 'all') out.push(s.built === 'old' ? '20년 초과' : `${s.built}년 이내`);
  if (s.units !== 'all') out.push(`${s.units.toLocaleString()}세대+`);
  if (s.station) out.push(`${s.station.split('·')[0]}역 1.5km`);
  if (s.fitOnly && s.budgetMan) out.push('쏙 구간만');
  if (s.hotOnly) out.push('거래 활발만');
  if (s.mapOnly) out.push('지도 영역 안');
  return out;
}
// 평형 칩: 여러 개 켤 수 있다. "평형 전체"는 모두 끄기
function typeChip(v: TypeKey | null, label: string) {
  const on = v === null ? !s.types.length : s.types.includes(v);
  return `<button type="button" class="chip ${on ? 'on' : ''}" data-type="${v === null ? 'all' : v}" aria-pressed="${on}">${esc(label)}</button>`;
}
function renderFilters() {
  const act = activeFilters();
  return `
    <div class="filters">
      <div class="chips">${typeChip(null, '평형 전체')}${typeChip(59, '59㎡')}${typeChip(74, '74㎡')}${typeChip(84, '84㎡')}${typeChip(101, '101㎡')}${typeChip(114, '114㎡')}${typeChip('big', '125㎡+')}</div>
      <div class="fbar">
        <button type="button" class="chip fbtn ${filtersOpen || act.length ? 'on' : ''}" data-action="filters" aria-expanded="${filtersOpen}">필터${act.length ? ` <b>${act.length}</b>` : ''} <i class="${filtersOpen ? 'up' : ''}">⌄</i></button>
        <span class="fsum sub">${filtersOpen ? '' : esc(act.join(' · '))}</span>
        <select class="sortsel" data-select="sort" aria-label="정렬">
          <option value="fit" ${s.sort === 'fit' ? 'selected' : ''}>예산에 가까운 순</option>
          <option value="priceAsc" ${s.sort === 'priceAsc' ? 'selected' : ''}>가격 낮은 순</option>
          <option value="priceDesc" ${s.sort === 'priceDesc' ? 'selected' : ''}>가격 높은 순</option>
          <option value="trades" ${s.sort === 'trades' ? 'selected' : ''}>최근 거래 많은 순</option>
          <option value="new" ${s.sort === 'new' ? 'selected' : ''}>신축 순</option>
          <option value="units" ${s.sort === 'units' ? 'selected' : ''}>세대수 많은 순</option>
        </select>
      </div>
      <div class="fpanel" ${filtersOpen ? '' : 'hidden'}>
        <div class="frow"><span class="fl">준공</span><div class="chips">${chip('built', 'all', '전체')}${chip('built', 10, '10년 이내')}${chip('built', 20, '20년 이내')}${chip('built', 'old', '20년 초과')}</div></div>
        <div class="frow"><span class="fl">세대수</span><div class="chips">${chip('units', 'all', '전체')}${chip('units', 300, '300+')}${chip('units', 500, '500+')}${chip('units', 1000, '1,000+')}</div></div>
        ${renderStation()}
        <div class="frow"><span class="fl">보기</span><div class="chips">
          ${s.budgetMan ? `<button type="button" class="chip ${s.fitOnly ? 'on' : ''}" data-toggle="fitOnly">쏙 구간만 <span class="sub">예산의 85~100%</span></button>` : ''}
          <button type="button" class="chip ${s.hotOnly ? 'on' : ''}" data-toggle="hotOnly" title="같은 시군구 안에서 최근 6개월 거래 ÷ 세대수가 상위 10%인 단지">🔥 거래 활발만</button>
          ${KAKAO_KEY ? `<button type="button" class="chip ${s.mapOnly ? 'on' : ''}" data-toggle="mapOnly">지도 영역 안만</button>` : ''}
        </div></div>
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
        <div class="it-name">${esc(c.n)}${c.h ? ' <span class="pill p-hot">🔥 거래 활발</span>' : ''} <span class="sub">${esc(c.d)}${c.b ? ` · ${c.b}년` : ''}${c.u ? ` · ${c.u.toLocaleString()}세대` : ''}</span></div>
        <div class="it-sub sub">${f.fitKey}㎡ · ${pyeong(f.fitKey!)}평형 · ${basis}${t && t[3] ? ` · 6개월 ${t[3]}건` : ''}${yoy != null ? ` · <span class="${yoy >= 0 ? 'up' : 'down'}">1년 ${yoy > 0 ? '+' : ''}${yoy}%</span>` : ''}${t && t[7] != null ? ` · 전세가율 ${t[7]}%` : ''}</div>
        ${pct != null ? `<div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div>` : ''}
      </div>
      <div class="it-price"><b>${eok(f.fitPrice, 2)}</b>${pct != null ? `<span class="pill ${fitCls}">예산의 ${pct}%</span>` : ''}</div>
    </a>`;
}
// 0건일 때: 단계별로 몇 개가 남았는지 보여주고, 0으로 만든 조건을 짚어준다
function renderEmpty() {
  const path = funnel.map((f, i) => `${i ? ' → ' : ''}${esc(f.label)} <b>${f.n.toLocaleString()}</b>`).join('');
  const zero = funnel.find((f) => f.n === 0 && f.key);
  const prev = zero ? funnel[funnel.indexOf(zero) - 1]?.n ?? 0 : 0;
  const hint: Record<string, string> = {
    built: '준공 필터를 넓히면', units: '세대수 필터를 넓히면', station: '역 기준을 "없음"으로 하면', type: '평형을 더 켜거나 "평형 전체"로 하면',
    budget: '예산을 올리거나 지역을 바꾸면', fitOnly: '"쏙 들어오는 구간만"을 끄면', hotOnly: '"거래 활발만"을 끄면', mapOnly: '지도를 옮기거나 "지도 영역 안만"을 끄면',
  };
  const geo = zero?.key === 'mapOnly' && noGeoDropped ? ` 좌표가 없는 단지 ${noGeoDropped}개는 지도 필터에 잡히지 않아요.` : '';
  return `<div class="empty">
    <p class="sub2" style="margin:8px 0 6px">조건에 맞는 단지가 없어요.</p>
    <p class="sub" style="margin:0">${path}</p>
    ${zero ? `<p class="sub2" style="margin:8px 0 6px">"<b>${esc(zero.label)}</b>" 조건에서 0이 됐어요. ${hint[zero.key!]} <b>${prev.toLocaleString()}</b>개가 보여요.${geo}</p>` : `<p class="sub2" style="margin:8px 0 6px">이 지역에는 아직 거래 데이터가 없어요.</p>`}
  </div>`;
}
function renderList() {
  const n = fitted.length, fit = fitted.filter((f) => (f.ratio ?? 0) >= FIT_LOW).length;
  const head = s.budgetMan
    ? `<b>${n.toLocaleString()}단지</b>가 예산 안에 있어요${fit ? ` · 쏙 들어오는 구간 <b>${fit.toLocaleString()}</b>` : ''}`
    : `<b>${n.toLocaleString()}단지</b>`;
  return `
    <div class="count sub2" id="count"><span>${head}<span class="src"> · 실거래 기준 ${esc(regions.asOf)}</span></span><button type="button" class="linkbtn" data-action="copy" title="지금 보고 있는 예산·지역·필터 조건을 주소로 복사">🔗 조건 링크 복사</button></div>
    <div class="card list" id="list">
      ${fitted.length ? fitted.slice(0, shown).map(renderItem).join('') : renderEmpty()}
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
    showStation();
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
  if (tip) {
    const geoRows = rows.filter((c) => c.la != null).length;
    tip.textContent = list.length ? `지도에 ${list.length.toLocaleString()}단지`
      : !rows.length ? ''
      : fitted.length ? '조건에 맞는 단지는 있지만 좌표가 없어 지도에 못 찍었어요'
      : geoRows ? `조건에 맞는 단지가 없어요 (이 지역 단지 ${rows.length.toLocaleString()}개)`
      : '이 지역은 아직 좌표가 없어요';
  }
  if (fitBounds && pts.length) {
    const b = new kakao.maps.LatLngBounds();
    for (const m of pts) b.extend(m.getPosition());
    map.setBounds(b);
  }
}
let stCircle: any = null, stMarker: any = null;
/** 선택한 역을 지도에 표시(1.5km 원)하고 그 역으로 이동 */
function showStation() {
  if (!mapReady) return;
  if (stCircle) { stCircle.setMap(null); stCircle = null; }
  if (stMarker) { stMarker.setMap(null); stMarker = null; }
  const st = s.station ? stationsFor().find((x) => x.k === s.station) : null;
  if (!st || st.la == null || st.lo == null) return;
  const pos = new kakao.maps.LatLng(st.la, st.lo);
  stCircle = new kakao.maps.Circle({ center: pos, radius: 1500, strokeWeight: 1.5, strokeColor: '#3182f6', strokeOpacity: 0.7, fillColor: '#3182f6', fillOpacity: 0.06 });
  stCircle.setMap(map);
  stMarker = new kakao.maps.CustomOverlay({ position: pos, yAnchor: 0.5, content: `<div class="st-pin" title="${esc(stationLabel(st))}">${esc(st.n)}</div>` });
  stMarker.setMap(map);
  map.setLevel(6); map.setCenter(pos);
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
    if (!fromMap) {
      map.panTo(pos);
      // 목록이 지도 아래에 있으므로, 지도가 화면 밖이면 지도까지 올려준다
      const wrap = root.querySelector<HTMLElement>('.mapwrap');
      const r = wrap?.getBoundingClientRect();
      if (wrap && r && (r.top < 60 || r.bottom > window.innerHeight)) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
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
  compute(); shown = PAGE; rerenderList(); syncMarkers(!s.station); showStation();
}
function bind() {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-set],[data-type],[data-toggle],[data-action],.item');
    if (!t) return;
    if (t.dataset.type) {
      const v = t.dataset.type;
      if (v === 'all') s.types = [];
      else { const k = (v === 'big' ? 'big' : Number(v)) as TypeKey; s.types = s.types.includes(k) ? s.types.filter((x) => x !== k) : [...s.types, k]; }
      compute(); shown = PAGE; save();
      const fl = root.querySelector('.filters'); if (fl) fl.outerHTML = renderFilters();
      rerenderList(); syncMarkers();
    } else if (t.dataset.set) {
      const k = t.dataset.set as keyof State; const raw = t.dataset.value!;
      (s as any)[k] = /^\d+$/.test(raw) ? Number(raw) : raw;
      compute(); shown = PAGE; save();
      const fl = root.querySelector('.filters'); if (fl) fl.outerHTML = renderFilters();
      rerenderList(); syncMarkers();
    } else if (t.dataset.toggle) {
      const k = t.dataset.toggle as 'fitOnly' | 'mapOnly' | 'hotOnly'; s[k] = !s[k];
      compute(); shown = PAGE; save();
      const fl = root.querySelector('.filters'); if (fl) fl.outerHTML = renderFilters();
      rerenderList(); syncMarkers();
    } else if (t.dataset.action === 'filters') {
      filtersOpen = !filtersOpen;
      const fl = root.querySelector('.filters'); if (fl) fl.outerHTML = renderFilters();
    } else if (t.dataset.action === 'more') {
      shown += PAGE; rerenderList();
    } else if (t.dataset.action === 'copy') {
      copyLink(t);
    } else if (t.classList.contains('item')) {
      if (mapReady && s.view !== 'list' && !(e as MouseEvent).metaKey) {
        // 첫 클릭은 지도에서 위치 확인, 같은 항목 두 번째 클릭은 상세로 이동
        if (selected !== t.dataset.id) { e.preventDefault(); select(t.dataset.id!); }
      }
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.select === 'sido') { s.sido = t.value; s.lawd = 'all'; s.station = ''; save(); renderTop(); changeRegion(); }
    else if (t.dataset.select === 'lawd') { s.lawd = t.value; if (!stationsFor().some((x) => x.k === s.station)) s.station = ''; save(); renderTop(); changeRegion(); }
    else if (t.dataset.select === 'station') { s.station = t.value; compute(); shown = PAGE; save(); const fl = root.querySelector('.filters'); if (fl) fl.outerHTML = renderFilters(); rerenderList(); syncMarkers(); showStation(); }
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
