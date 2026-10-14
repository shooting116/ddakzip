// 카카오톡 알림 연결 테스트: 토큰 갱신 → "나에게 보내기" 한 번. 수동 실행(data-run) 전용.
import { kakaoMemo } from './lib/kakao.mjs';

const when = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
const ok = await kakaoMemo(`[딱집] 카카오톡 알림 연결 테스트 ${when} KST\n이 메시지가 보이면 금리·뉴스 검수·빌드 실패 알림이 이 채널로 옵니다.`);
console.log(ok ? '전송 성공' : '전송 실패');
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=kakao-test::${ok ? '전송 성공' : '전송 실패 — 위 경고 참고'}`);
if (!ok) process.exit(1);
