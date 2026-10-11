// 공공데이터포털(apis.data.go.kr) 공통: 키 처리, XML 파싱, 오류 코드 해석
// 키는 환경변수로만 받는다. 로그에 절대 찍지 않는다.

export class DataGoError extends Error {
  constructor(code, msg, extra = {}) {
    super(`${code} ${msg}`);
    this.code = code;
    this.quota = code === '22';            // 일일 트래픽 초과
    this.fatal = ['30', '31', '32', '33'].includes(code); // 키 미등록·만료·IP·서명 → 재시도 무의미
    Object.assign(this, extra);
  }
}

export function serviceKey(envName = 'DATA_GO_KR_KEY') {
  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} 환경변수가 없습니다`);
  // 포털이 주는 "Encoding" 키는 이미 %로 인코딩되어 있고, "Decoding" 키는 +,/,= 를 그대로 가진다.
  return raw.includes('%') ? raw : encodeURIComponent(raw);
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
export function unescapeXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENT[m]).trim();
}

/** <item>…</item> 블록을 {tag: value} 객체 배열로 */
export function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const o = {};
    const inner = m[1];
    const tr = /<([A-Za-z_][\w]*)>([\s\S]*?)<\/\1>|<([A-Za-z_][\w]*)\s*\/>/g;
    let t;
    while ((t = tr.exec(inner))) {
      if (t[1]) o[t[1]] = unescapeXml(t[2]);
      else o[t[3]] = '';
    }
    items.push(o);
  }
  return items;
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? unescapeXml(m[1]) : null;
}

/** 응답 전체를 해석. 정상이면 {items, totalCount, numOfRows, pageNo}, 오류면 DataGoError */
export function parseResponse(xml) {
  if (xml.includes('<OpenAPI_ServiceResponse>')) {
    const code = tag(xml, 'returnReasonCode') ?? '99';
    const msg = tag(xml, 'returnAuthMsg') ?? tag(xml, 'errMsg') ?? 'UNKNOWN';
    throw new DataGoError(code, msg);
  }
  const rc = tag(xml, 'resultCode');
  if (rc == null) throw new DataGoError('99', `알 수 없는 응답: ${xml.slice(0, 120).replace(/\s+/g, ' ')}`);
  if (rc !== '000' && rc !== '00') throw new DataGoError(rc, tag(xml, 'resultMsg') ?? 'ERROR');
  return {
    items: parseItems(xml),
    totalCount: Number(tag(xml, 'totalCount') ?? 0),
    numOfRows: Number(tag(xml, 'numOfRows') ?? 0),
    pageNo: Number(tag(xml, 'pageNo') ?? 1),
  };
}

/** GET 한 번. 네트워크 오류·5xx는 짧게 재시도, 포털 오류는 DataGoError로 */
export async function getXml(url, { retries = 3, timeoutMs = 30_000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/xml' } });
      clearTimeout(timer);
      const text = await res.text();
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return parseResponse(text);
    } catch (e) {
      if (e instanceof DataGoError) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 키가 섞인 URL을 로그용으로 가리기 */
export function redact(url) {
  return url.replace(/serviceKey=[^&]+/, 'serviceKey=***');
}
