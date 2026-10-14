// 계산기 화면: 6단계 입력 → 결과. 바닐라 DOM, 상태는 state.ts.
import { calculate, bottleneckLabel } from '../engine/calc.ts';
import { getRules } from '../engine/rules.ts';
import { listSido, listSigungu, classifyRegion } from '../engine/region.ts';
import { fmtEok, fmtMonthly, fmtPct } from '../engine/money.ts';
import type { CalcResult, ProductResult, Situation, DebtType } from '../engine/types.ts';
import { defaultState, load, save, toInput, SITUATION_LABEL, DEBT_LABEL, type UiState, type Marital } from './state.ts';

const TOTAL_STEPS = 6;
const rules = getRules();

let root: HTMLElement;
let s: UiState;

export function mount(el: HTMLElement) {
  root = el;
  const q = new URLSearchParams(location.search);
  const sit = q.get('s') as Situation | null;
  const saved = load();
  if (sit && ['first', 'newly', 'youth', 'general', 'move'].includes(sit)) {
    s = saved && saved.situation === sit && q.get('resume') === '1' ? saved : defaultState(sit);
  } else if (saved && q.get('resume') === '1') {
    s = saved;
  } else {
    s = defaultState('general');
    s.step = 0;
  }
  bind();
  render();
}

// ---------- 유틸 ----------
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const comma = (n: number) => (n || 0).toLocaleString('ko-KR');
const manToEok = (man: number) => fmtEok(man * 10_000);

function numInput(field: keyof UiState, label: string, unit: string, opts: { chips?: number[]; hint?: string; focus?: boolean } = {}) {
  const v = Number(s[field] ?? 0);
  return `
    <div class="field">
      <div class="sub">${esc(label)}</div>
      <label class="input ${opts.focus ? 'focus' : ''}">
        <input type="text" inputmode="numeric" autocomplete="off" data-num="${field}" value="${comma(v)}" aria-label="${esc(label)}" ${opts.focus ? 'autofocus' : ''} />
        <span>${esc(unit)}</span>
      </label>
      <div class="eokread" data-eok-for="${field}" aria-live="polite">${v > 0 ? `${manToEok(v)} 원` : ''}</div>
      ${opts.chips ? `<div class="chips">${opts.chips.map((c) => `<button type="button" class="chip" data-set="${field}" data-value="${c}">${manToEok(c)}</button>`).join('')}</div>` : ''}
      ${opts.hint ? `<div class="sub hint">${esc(opts.hint)}</div>` : ''}
    </div>`;
}

function choice(field: keyof UiState, options: { v: string | number | boolean; label: string }[]) {
  return `<div class="chips">${options.map((o) => `<button type="button" class="chip ${String(s[field]) === String(o.v) ? 'on' : ''}" data-choice="${field}" data-value="${esc(String(o.v))}">${esc(o.label)}</button>`).join('')}</div>`;
}

function stepper(field: keyof UiState, label: string, min: number, max: number, unit = '') {
  const v = Number(s[field] ?? 0);
  return `
    <div class="row stepper">
      <span class="sub2">${esc(label)}</span>
      <span class="ctl">
        <button type="button" data-step-dec="${field}" data-min="${min}" aria-label="${esc(label)} 줄이기">−</button>
        <b>${v}${esc(unit)}</b>
        <button type="button" data-step-inc="${field}" data-max="${max}" aria-label="${esc(label)} 늘리기">+</button>
      </span>
    </div>`;
}

// ---------- 화면 ----------
function render() {
  save(s);
  if (s.step === 0) root.innerHTML = viewSituation();
  else if (s.step > TOTAL_STEPS) root.innerHTML = viewResult();
  else root.innerHTML = viewStep();
  const f = root.querySelector<HTMLInputElement>('input[autofocus]');
  if (f && matchMedia('(min-width: 700px)').matches) f.focus();
  window.scrollTo({ top: 0 });
}

function frame(inner: string, opts: { title: string; sub?: string; next?: string; nextDisabled?: boolean }) {
  const pct = Math.round((Math.min(s.step, TOTAL_STEPS) / TOTAL_STEPS) * 100);
  return `
    <div class="top">
      <button type="button" class="back" data-action="back" aria-label="뒤로">‹</button>
      <span class="sub">${s.step} / ${TOTAL_STEPS}</span>
    </div>
    <div class="prog"><i style="width:${pct}%"></i></div>
    <div class="q">
      <span class="pill p-blue">${esc(SITUATION_LABEL[s.situation])}</span>
      <h1 class="big">${opts.title}</h1>
      ${opts.sub ? `<p class="sub2">${opts.sub}</p>` : ''}
    </div>
    <div class="card">${inner}</div>
    <button type="button" class="btn" data-action="next" ${opts.nextDisabled ? 'disabled' : ''}>${esc(opts.next ?? '다음')}</button>`;
}

function viewSituation() {
  const items: { k: Situation; d: string }[] = [
    { k: 'first', d: '첫 집 · LTV 우대 · 취득세 200만 감면' },
    { k: 'newly', d: '혼인 7년 이내 · 소득 기준 완화' },
    { k: 'youth', d: '만 34세 이하 · 장래소득 인정' },
    { k: 'general', d: '디딤돌 · 보금자리론 · 주담대' },
    { k: 'move', d: '1주택 처분 · 일시적 2주택 세금 판정' },
  ];
  return `
    <div class="q" style="padding-top:10px">
      <h1 class="big">어떤 상황인가요?</h1>
      <p class="sub2">상황에 따라 받을 수 있는 대출과 한도가 달라집니다.</p>
    </div>
    <div class="card">
      ${items.map((i) => `<button type="button" class="tr full" data-situation="${i.k}"><span class="tx"><span class="t">${SITUATION_LABEL[i.k]}</span><span class="d">${esc(i.d)}</span></span><span class="ch">›</span></button>`).join('')}
    </div>`;
}

function viewStep(): string {
  switch (s.step) {
    case 1:
      return frame(numInput('cashMan', '보유 현금', '만 원', { chips: [5000, 10000, 20000, 30000], focus: true,
        hint: '예금·적금·주식 등 집 사는 데 쓸 수 있는 돈 전부. 부대비용(취득세·중개보수)은 계산기가 뺍니다.' }),
        { title: '집 사는 데 쓸 수 있는<br>현금이 얼마인가요?', nextDisabled: s.cashMan <= 0 });
    case 2: {
      const married = s.marital !== 'single';
      const maritalOpts: { v: Marital; label: string }[] = [{ v: 'single', label: '미혼' }, { v: 'married', label: '기혼' }, { v: 'soon', label: '3개월 내 결혼' }];
      const inner = `
        <div class="row"><span class="sub2">결혼</span>${choice('marital', maritalOpts)}</div>
        ${s.marital === 'married' ? stepper('marriageYears', '혼인 기간', 0, 40, '년') : ''}
        <div class="hr"></div>
        ${numInput('incomeSelfMan', '본인 연소득 (세전)', '만 원', { chips: [3000, 5000, 7000, 10000], focus: true })}
        ${married ? `
          ${numInput('incomeSpouseMan', '배우자 연소득 (세전)', '만 원')}
          <div class="row" style="margin-top:12px">
            <span class="sub2">은행 대출 심사에 배우자 소득 합산</span>
            ${choice('combineSpouse', [{ v: true, label: '합산' }, { v: false, label: '본인만' }])}
          </div>
          <div class="sub hint">합산하면 배우자 명의 대출도 함께 봅니다. 정책대출은 항상 부부합산이 기준입니다.</div>
        ` : `<div class="sub hint" style="margin-top:10px">원천징수영수증의 총급여 기준.</div>`}`;
      return frame(inner, { title: married ? '부부 합산 연소득이<br>얼마인가요?' : '연소득이<br>얼마인가요?', sub: '세전 기준 · 원천징수영수증의 총급여', nextDisabled: s.incomeSelfMan <= 0 });
    }
    case 3: {
      const types = Object.keys(DEBT_LABEL) as DebtType[];
      const inner = `
        ${choice('hasDebt', [{ v: true, label: '있어요' }, { v: false, label: '없어요' }])}
        ${s.hasDebt ? `
          <div class="sub" style="margin-top:14px">종류를 골라주세요 (여러 개 가능)</div>
          <div class="chips">${types.map((t) => `<button type="button" class="chip ${s.debtTypes.includes(t) ? 'on' : ''}" data-debt="${t}">${DEBT_LABEL[t].name}</button>`).join('')}</div>
          ${s.debtTypes.map((t) => `
            <div class="field">
              <div class="sub">${esc(DEBT_LABEL[t].ask)}</div>
              <label class="input"><input type="text" inputmode="numeric" data-debt-amount="${t}" value="${comma(s.debtAmounts[t] ?? 0)}" aria-label="${esc(DEBT_LABEL[t].ask)}" /><span>${esc(DEBT_LABEL[t].unit)}</span></label>
              <div class="sub hint">${esc(DEBT_LABEL[t].hint)}</div>
            </div>`).join('')}
          <div class="sub hint" style="margin-top:10px">은행은 마이너스통장을 한도 기준, 신용대출을 5년 분할로 봅니다. 환산은 계산기가 합니다.</div>
        ` : ''}`;
      return frame(inner, { title: '지금 갖고 있는<br>대출이 있나요?', sub: '신용대출·마이너스통장·할부가 있으면 주담대 한도가 줄어듭니다.' });
    }
    case 4:
      return frame(viewHousehold(), { title: householdTitle(), sub: '자격과 한도를 가르는 항목만 묻습니다.' });
    case 5: {
      const sidos = listSido(rules);
      const sggs = s.sido ? listSigungu(rules, s.sido) : [];
      const inner = `
        <div class="row">
          <span class="sub2">아직 정하지 않았어요</span>
          ${choice('regionUndecided', [{ v: true, label: '네' }, { v: false, label: '정했어요' }])}
        </div>
        ${s.regionUndecided ? `<div class="sub hint" style="margin-top:8px">규제지역(LTV 40%, 6억 한도) 기준으로 보수적으로 계산합니다. 지역을 고르면 더 정확해집니다.</div>` : `
          <div class="field"><div class="sub">시·도</div>
            <select data-select="sido" aria-label="시도"><option value="">선택</option>${sidos.map((x) => `<option ${s.sido === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
          <div class="field"><div class="sub">시·군·구</div>
            <select data-select="sigungu" aria-label="시군구" ${s.sido ? '' : 'disabled'}><option value="">선택</option>${sggs.map((x) => `<option ${s.sigungu === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
          <div class="sub hint">규제지역이면 LTV 40%(생애최초 70%)와 6억 한도, 수도권이면 스트레스 DSR 3%가 적용됩니다. 규제지역: 서울 전역 + 경기 15곳 (2026-07-01 기준)</div>`}`;
      return frame(inner, { title: '어느 지역의 집을<br>보고 있나요?', nextDisabled: !s.regionUndecided && !(s.sido && s.sigungu) });
    }
    case 6: {
      const inner = `
        <div class="sub">만기</div>
        ${choice('term', [10, 15, 20, 30, 40].map((t) => ({ v: t, label: `${t}년` })))}
        <div class="sub hint">수도권·규제지역 은행 주담대는 30년 이내. 40년은 보금자리론(만 40세 미만)만.</div>
        <div class="field" style="margin-top:16px">
          <div class="sub">시중 주담대 금리 (연 %)</div>
          <label class="input"><input type="text" inputmode="decimal" data-rate="bankRate" value="${s.bankRate ?? rules.bank.rate_default.variable}" aria-label="시중 주담대 금리" /><span>%</span></label>
          <div class="sub hint">기본값 ${rules.bank.rate_default.variable}%는 ${rules.bank.rate_default.as_of} 예금은행 주담대 평균(한국은행). 받은 금리가 있으면 바꿔 넣으세요. 정책대출 금리는 상품표대로 자동 적용.</div>
        </div>`;
      return frame(inner, { title: '만기와 금리는<br>이렇게 둘까요?', sub: '모르면 그대로 두세요.', next: '결과 보기' });
    }
  }
  return '';
}

function householdTitle(): string {
  switch (s.situation) {
    case 'move': return '지금 사는 집은<br>어떤가요?';
    case 'youth': return '나이와 가구 정보를<br>알려주세요';
    default: return '가구 정보를<br>알려주세요';
  }
}

function viewHousehold(): string {
  const parts: string[] = [];

  if (s.situation === 'move') {
    parts.push(numInput('currentPriceMan', '지금 집 예상 매도가', '만 원', { chips: [30000, 50000, 70000, 100000], focus: true }));
    parts.push(numInput('currentLoanMan', '남은 주담대 잔액', '만 원'));
    parts.push(`<div class="row" style="margin-top:12px"><span class="sub2">새 집 대출 후 6개월 내 지금 집 처분</span>${choice('sellWithin6m', [{ v: true, label: '네' }, { v: false, label: '아니요' }])}</div>
      <div class="sub hint">처분 약정이 있어야 수도권·규제지역에서 무주택과 같은 LTV가 적용됩니다. 양도세는 이 버전에서 계산하지 않습니다.</div>`);
  }

  if (s.situation !== 'move') {
    parts.push(`<div class="row"><span class="sub2">세대원 모두 집을 가져본 적 없음 (생애최초)</span>${choice('firstHome', [{ v: true, label: '네' }, { v: false, label: '아니요' }])}</div>`);
  }
  parts.push(stepper('children', '만 19세 미만 자녀', 0, 6, '명'));
  parts.push(`<div class="row" style="margin-top:10px"><span class="sub2">2년 내 출산·입양 (또는 예정)</span>${choice('birthWithin2y', [{ v: true, label: '네' }, { v: false, label: '아니요' }])}</div>`);
  parts.push(stepper('age', '본인 만 나이', 19, 70, '세'));
  if (s.situation === 'youth' && s.age > 34) parts.push(`<div class="sub hint" style="color:var(--orange)">만 34세를 넘으면 청년 상품 대상에서 벗어납니다. 결과는 무주택 일반 기준과 같습니다.</div>`);
  if (s.situation === 'newly' && s.marital === 'married' && s.marriageYears > 7) parts.push(`<div class="sub hint" style="color:var(--orange)">혼인 7년을 넘으면 신혼부부 상품 대상이 아닙니다.</div>`);
  return parts.join('');
}

// ---------- 결과 ----------
function viewResult(): string {
  const input = toInput(s);
  const r: CalcResult = calculate(input);
  const b = r.best;
  const income = b.key === 'bank' ? r.incomeBank : r.incomePolicy;
  const ratio = income > 0 ? (b.monthly * 12 / income) * 100 : 0;
  const none = !b.eligible;

  // 찾기 화면으로 넘길 예산·지역 (만 원 단위). 찾기 화면이 localStorage에서도 읽는다.
  const reg = classifyRegion(rules, input.region);
  const budgetMan = Math.floor(b.budget / 10_000);
  const findQs = new URLSearchParams({ budget: String(budgetMan) });
  if (reg.lawd) findQs.set('lawd', reg.lawd);
  if (reg.sido) findQs.set('sido', reg.sido);
  try { localStorage.setItem('ddakzip-budget-v1', JSON.stringify({ budgetMan, sido: reg.sido, lawd: reg.lawd, at: new Date().toISOString().slice(0, 10) })); } catch { /* */ }

  const limitRows: { k: keyof typeof b.limits; label: string; v: number | null }[] = [
    { k: 'ltv', label: `LTV ${b.ltvPct}%`, v: b.limits.ltv },
    { k: 'dsr', label: `DSR ${rules.bank.dsr.ratio}% (스트레스 +${(rules.bank.dsr.stress as Record<string, number>)[r.region]}%p)`, v: b.limits.dsr },
    { k: 'dti', label: 'DTI', v: b.limits.dti },
    { k: 'cap', label: '가격구간 절대 한도', v: b.limits.cap },
    { k: 'limit', label: '상품 최대 대출액', v: b.limits.limit },
  ].filter((x) => x.v != null);
  const maxV = Math.max(1, ...limitRows.map((x) => x.v as number));

  const hint = (() => {
    switch (b.bottleneck) {
      case 'ltv': return `지금은 <b>현금</b>이 병목이에요. ${fmtEok(r.whatif.cashPlus.delta)}을 더 모으면 예산이 ${fmtEok(r.whatif.cashPlus.budget)}이 됩니다.`;
      case 'dsr': return `지금은 <b>소득 대비 상환능력(DSR)</b>이 병목이에요. 기존 대출을 줄이거나 소득이 늘면 한도가 올라갑니다.`;
      case 'dti': return `지금은 <b>소득 대비 원리금(DTI)</b>이 병목이에요.`;
      case 'cap': return `수도권·규제지역 <b>주담대 절대 한도</b>에 걸렸어요. 현금이 더 있어야 예산이 늘어납니다.`;
      case 'limit': return `<b>상품 최대 대출액</b>에 걸렸어요. 현금을 더하거나 다른 상품과 비교해 보세요.`;
      case 'price_cap': return `이 상품은 <b>주택가격 상한</b>이 있어요. 그 안에서는 여유가 있습니다.`;
      default: return '';
    }
  })();

  return `
    <div class="top">
      <button type="button" class="back" data-action="back" aria-label="수정">‹</button>
      <span class="sub">${esc(SITUATION_LABEL[s.situation])} · ${esc(r.regionLabel)}</span>
    </div>

    <div class="q">
      ${none
        ? `<h1 class="big">지금 조건으로는<br>대출이 어렵습니다</h1><p class="sub2">${esc(b.reasons.join(' · '))}</p>`
        : `<h1 class="big"><span class="blue">${fmtEok(b.budget)}</span><span class="until">까지, 딱.</span></h1>
           <p class="sub2">${esc(b.name)} 기준 최대 매수가 · 부부합산 ${fmtEok(r.incomePolicy)}</p>`}
    </div>

    ${none ? '' : `
    <div class="card">
      <div class="kv">
        <div class="k">보유 현금</div><div class="v">${fmtEok(input.cash)}</div>
        ${r.moveCash != null ? `<div class="k">지금 집 매도 후 현금</div><div class="v">+ ${fmtEok(r.moveCash)}</div>` : ''}
        <div class="k">대출 (${esc(b.name)})</div><div class="v">+ ${fmtEok(b.loan)}</div>
        <div class="k">부대비용 (취득세·중개보수 등)</div><div class="v">− ${fmtEok(b.fees.total)}</div>
      </div>
      <div class="hr"></div>
      <div class="row"><span class="h">최대 매수가</span><span class="h blue">${fmtEok(b.budget)}</span></div>
    </div>

    <div class="card">
      <div class="h">왜 이 금액인가요?</div>
      <div class="bars">
        ${limitRows.map((x) => `
          <div class="bar-row">
            <div class="row small"><span>${x.k === b.bottleneck ? '<span class="pill p-bad">병목</span> ' : ''}${esc(x.label)}</span><b>${fmtEok(x.v as number)}</b></div>
            <div class="bar"><i class="${x.k === b.bottleneck ? 'bad' : ''}" style="width:${Math.min(100, ((x.v as number) / maxV) * 100)}%"></i></div>
          </div>`).join('')}
      </div>
      <p class="sub2" style="margin:12px 0 0">${hint || bottleneckLabel[b.bottleneck]}</p>
    </div>

    <div class="card tight">
      <div class="row">
        <div><div class="h">매달 약 ${fmtMonthly(b.monthly)}</div><div class="sub">${fmtEok(b.loan)} · 연 ${b.rate}% ${b.rateType === 'fixed' ? '고정' : b.rateType === 'variable' ? '변동' : ''} · ${b.term}년 원리금균등</div></div>
        <span class="pill p-soft">소득의 ${fmtPct(ratio, 0)}</span>
      </div>
    </div>`}

    <div class="ad-slot" aria-hidden="true"></div>

    <div class="card">
      <div class="h">받을 수 있는 대출</div>
      <div class="list">${r.products.map(productRow).join('')}</div>
    </div>

    ${none ? '' : `
    <div class="card">
      <div class="h">만약에</div>
      <div class="kv" style="margin-top:10px">
        <div class="k">현금 +${fmtEok(r.whatif.cashPlus.delta)}</div><div class="v ${r.whatif.cashPlus.budget > b.budget ? 'up' : ''}">예산 ${fmtEok(r.whatif.cashPlus.budget)}</div>
        <div class="k">소득 +${fmtEok(r.whatif.incomePlus.delta)}</div><div class="v ${r.whatif.incomePlus.budget > b.budget ? 'up' : ''}">예산 ${fmtEok(r.whatif.incomePlus.budget)}${r.whatif.incomePlus.budget <= b.budget ? ' <span class="sub">(변화 없음)</span>' : ''}</div>
        <div class="k">금리 +${r.whatif.ratePlus.delta}%p</div><div class="v">월 ${fmtMonthly(r.whatif.ratePlus.monthly)}</div>
      </div>
    </div>

    <details class="card">
      <summary class="h">부대비용 상세 · ${fmtEok(b.fees.total)}</summary>
      <div class="kv" style="margin-top:10px">
        <div class="k">취득세${b.fees.acquisitionExemption ? ` (감면 −${fmtEok(b.fees.acquisitionExemption)})` : ''}</div><div class="v">${fmtEok(b.fees.acquisitionTax)}</div>
        <div class="k">지방교육세</div><div class="v">${fmtEok(b.fees.educationTax)}</div>
        ${b.fees.ruralTax ? `<div class="k">농어촌특별세</div><div class="v">${fmtEok(b.fees.ruralTax)}</div>` : ''}
        <div class="k">중개보수 (상한, 부가세 포함)</div><div class="v">${fmtEok(b.fees.brokerage + b.fees.brokerageVat)}</div>
        <div class="k">인지세</div><div class="v">${fmtEok(b.fees.stampContract)}</div>
        <div class="k">국민주택채권 (즉시매도 부담)</div><div class="v">${fmtEok(b.fees.bond)}</div>
        <div class="k">등기 수수료·법무사 (참고)</div><div class="v">${fmtEok(b.fees.registration + b.fees.legal)}</div>
        ${b.fees.loanStamp ? `<div class="k">대출 인지세 (차주 몫)</div><div class="v">${fmtEok(b.fees.loanStamp)}</div>` : ''}
      </div>
      <div class="sub hint">채권은 공시가를 매매가의 70%로 가정, 할인율 ${rules.fees.bond.discount_rate_default}% (2026-09). 법무사 보수는 참고치.</div>
    </details>`}

    ${none ? `<button type="button" class="btn" disabled>받을 수 있는 대출이 없어 예산을 잡을 수 없어요</button>`
      : `<a class="btn" href="/find/?${findQs.toString()}">이 예산으로 딱 집어보기</a>`}
    <div class="row" style="margin-top:10px;gap:8px">
      <button type="button" class="btn ghost" data-action="edit">조건 수정</button>
      <button type="button" class="btn ghost" data-action="restart">처음부터</button>
    </div>

    <p class="src" style="margin-top:18px">
      계산 기준: 규칙표 ${esc(r.rulesVersion)} (${esc(r.rulesEffective)}) · 은행 금리 ${rules.bank.rate_default.as_of} 한국은행 예금은행 주담대 평균 · 정책대출 금리는 주택도시기금·주택금융공사 공시.
      우대금리는 반영하지 않았고, 실제 한도는 금융기관 심사(소득 증빙·신용·담보 평가)에 따라 달라집니다. 참고용이며 대출 상담이 아닙니다.
    </p>`;
}

function productRow(p: ProductResult): string {
  const name = p.key.startsWith('didimdol') ? p.name : p.name;
  if (p.eligible) {
    return `
      <div class="tr">
        <span class="tx"><span class="t">${esc(name)} <span class="pill p-ok">가능</span></span>
          <span class="d">LTV ${p.ltvPct}% · 연 ${p.rate}% ${p.rateType === 'fixed' ? '고정' : p.rateType === 'variable' ? '변동' : ''} · 최대 대출 ${fmtEok(p.loan)}${p.limits.limit ? ` (한도 ${fmtEok(p.limits.limit)})` : ''}</span>
          ${p.notes.length ? `<span class="d note">${esc(p.notes[0])}</span>` : ''}</span>
        <span class="v">${fmtEok(p.budget)}<small>예산</small></span>
      </div>`;
  }
  const soft = p.key === 'newborn' && p.reasons.length === 1 && p.reasons[0].includes('출산');
  return `
    <div class="tr off">
      <span class="tx"><span class="t">${esc(name)} <span class="pill ${soft ? 'p-warn' : 'p-bad'}">${soft ? '출산 시' : '불가'}</span></span>
        <span class="d">${esc(soft ? '2년 내 출산이면 소득 1.3억(맞벌이 2억)까지 · 최저 1.8% · 한도 4억' : p.reasons.join(' · '))}</span></span>
      <span class="v muted">—</span>
    </div>`;
}

// ---------- 이벤트 ----------
function bind() {
  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action],[data-situation],[data-set],[data-choice],[data-debt],[data-step-dec],[data-step-inc]');
    if (!t) return;
    if (t.dataset.situation) { s = defaultState(t.dataset.situation as Situation); history.replaceState(null, '', `?s=${s.situation}`); render(); return; }
    if (t.dataset.action === 'next') { if (s.step <= TOTAL_STEPS) s.step++; render(); return; }
    if (t.dataset.action === 'back') { if (s.step > 1) s.step--; else { s.step = 0; } render(); return; }
    if (t.dataset.action === 'edit') { s.step = 1; render(); return; }
    if (t.dataset.action === 'restart') { s = defaultState(s.situation); s.step = 0; history.replaceState(null, '', location.pathname); render(); return; }
    if (t.dataset.set) { (s as any)[t.dataset.set] = Number(t.dataset.value); render(); return; }
    if (t.dataset.choice) {
      const raw = t.dataset.value!;
      const val = raw === 'true' ? true : raw === 'false' ? false : isNaN(Number(raw)) ? raw : Number(raw);
      (s as any)[t.dataset.choice] = val;
      if (t.dataset.choice === 'marital' && val === 'single') s.incomeSpouseMan = 0;
      render(); return;
    }
    if (t.dataset.debt) {
      const d = t.dataset.debt as DebtType;
      s.debtTypes = s.debtTypes.includes(d) ? s.debtTypes.filter((x) => x !== d) : [...s.debtTypes, d];
      render(); return;
    }
    if (t.dataset.stepDec) { const f = t.dataset.stepDec as keyof UiState; (s as any)[f] = Math.max(Number(t.dataset.min), Number(s[f]) - 1); render(); return; }
    if (t.dataset.stepInc) { const f = t.dataset.stepInc as keyof UiState; (s as any)[f] = Math.min(Number(t.dataset.max), Number(s[f]) + 1); render(); return; }
  });

  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.num) {
      const n = Number(el.value.replace(/[^\d]/g, '')) || 0;
      (s as any)[el.dataset.num] = n;
      el.value = comma(n);
      const read = root.querySelector<HTMLElement>(`[data-eok-for="${el.dataset.num}"]`);
      if (read) read.textContent = n > 0 ? `${manToEok(n)} 원` : '';
      const next = root.querySelector<HTMLButtonElement>('[data-action="next"]');
      if (next && (el.dataset.num === 'cashMan' || el.dataset.num === 'incomeSelfMan')) next.disabled = n <= 0;
      save(s);
    } else if (el.dataset.debtAmount) {
      const n = Number(el.value.replace(/[^\d]/g, '')) || 0;
      s.debtAmounts[el.dataset.debtAmount as DebtType] = n;
      el.value = comma(n);
      save(s);
    } else if (el.dataset.rate) {
      const v = parseFloat(el.value.replace(/[^\d.]/g, ''));
      s.bankRate = Number.isFinite(v) && v > 0 ? v : null;
      save(s);
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.select === 'sido') { s.sido = el.value || null; s.sigungu = null; render(); }
    if (el.dataset.select === 'sigungu') { s.sigungu = el.value || null; render(); }
  });
}
