// 카카오톡 "나에게 보내기" 공용 모듈.
// - 키: KAKAO_REFRESH_TOKEN(필수) + KAKAO_REST_KEY / KAKAO_JS_KEY (토큰을 어느 플랫폼 키로 발급받았는지에 따라 둘 중 하나로 갱신된다 → 순서대로 시도)
// - 토큰·키는 절대 로그에 찍지 않는다.

async function refreshAccessToken() {
  const refresh = process.env.KAKAO_REFRESH_TOKEN;
  const clientIds = [process.env.KAKAO_REST_KEY, process.env.KAKAO_JS_KEY].filter(Boolean);
  if (!refresh || !clientIds.length) return { error: 'KAKAO_REFRESH_TOKEN 또는 KAKAO_REST_KEY/KAKAO_JS_KEY 없음' };
  let last = null;
  for (const client_id of clientIds) {
    const tok = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id, refresh_token: refresh }),
    }).then((r) => r.json()).catch((e) => ({ error: String(e?.message ?? e) }));
    if (tok.access_token) {
      if (tok.refresh_token) console.log('::warning title=카카오 refresh token 갱신됨::새 refresh_token이 발급되었습니다. ddakzip Secrets의 KAKAO_REFRESH_TOKEN을 바꿔야 두 달 뒤에도 알림이 갑니다.');
      return { access: tok.access_token };
    }
    last = tok.error_description ?? tok.error ?? '?';
  }
  return { error: last };
}

/** 텍스트 메모 전송. 성공 true. 실패해도 예외를 던지지 않고 false (알림은 부가 기능이라 본 작업을 막지 않는다) */
export async function kakaoMemo(text, { url = 'https://korea-rich.com', button = '딱집 열기' } = {}) {
  const t = await refreshAccessToken();
  if (!t.access) { console.warn('카카오 토큰 갱신 실패:', t.error); return false; }
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST', headers: { Authorization: `Bearer ${t.access}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ template_object: JSON.stringify({ object_type: 'text', text, link: { web_url: url, mobile_web_url: url }, button_title: button }) }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.result_code !== 0) { console.warn('카카오 전송 실패:', JSON.stringify(j)); return false; }
  return true;
}
