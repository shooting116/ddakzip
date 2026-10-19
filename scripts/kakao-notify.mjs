// 카카오톡 "나에게 보내기" 단발 전송. 용도별 preset: test(연결 확인) · build-failed(CI 빌드 실패, GitHub 환경변수로 내용 구성)
// 사용: node scripts/kakao-notify.mjs test | build-failed | --text "..."
import { kakaoMemo } from './lib/kakao.mjs';

const args = process.argv.slice(2);
const kst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
let text, url = 'https://korea-rich.com', button = '쏙집 열기';
const i = args.indexOf('--text');
if (i >= 0) text = args[i + 1];
else if (args[0] === 'build-failed') {
  const repo = process.env.GITHUB_REPOSITORY ?? 'shooting116/ssokjip';
  const run = process.env.GITHUB_RUN_ID;
  const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  const msg = (process.env.COMMIT_MESSAGE ?? '').split('\n')[0].slice(0, 80);
  url = run ? `https://github.com/${repo}/actions/runs/${run}` : `https://github.com/${repo}/actions`;
  button = '실패 로그 열기';
  text = `[쏙집] 사이트 빌드 실패 ${kst()} KST\n커밋: ${msg}${sha ? ` (${sha})` : ''}\n고치기 전까지 사이트는 마지막 성공본에 멈춰 있어요. 예약 글·데이터 갱신도 반영되지 않습니다.`;
} else text = `[쏙집] 카카오톡 알림 연결 테스트 ${kst()} KST\n이 메시지가 보이면 금리·뉴스 검수·빌드 실패 알림이 이 채널로 옵니다.`;

const ok = await kakaoMemo(text, { url, button });
console.log(ok ? '전송 성공' : '전송 실패');
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=kakao-notify::${ok ? '전송 성공' : '전송 실패 — 위 경고 참고'}`);
if (!ok) process.exit(1);
