// 로컬 개발용 설정 파일을 만든다. 이미 있으면 건드리지 않는다.
//   pnpm setup:local
// - .env: .env.example 을 복사하고 비밀 값은 무작위로 채움, 개발용 로그인·테스트 결제 켬
// - apps/order/.env.local: 고객 화면에 개발용 로그인 버튼 표시
// 로컬 전용입니다. 서버(staging/production)에서는 쓰지 마세요.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const set = (text, key, value) => text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);

if (existsSync('.env')) {
  console.log('.env 가 이미 있어 그대로 둡니다');
} else {
  let env = readFileSync('.env.example', 'utf8');
  env = set(env, 'SESSION_SECRET', randomBytes(32).toString('hex'));
  env = set(env, 'DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  env = set(env, 'DATA_HMAC_KEY', randomBytes(32).toString('base64'));
  const pw = randomBytes(12).toString('hex');
  env = env.replaceAll('CHANGE_ME', pw);
  env = set(env, 'DEV_LOGIN_ENABLED', 'true');
  env = set(env, 'PAYMENT_PROVIDER', 'fake');
  writeFileSync('.env', env);
  console.log('.env 를 만들었습니다 (개발용 로그인·테스트 결제 켬)');
}

if (existsSync('apps/order/.env.local')) {
  console.log('apps/order/.env.local 이 이미 있어 그대로 둡니다');
} else {
  writeFileSync('apps/order/.env.local', 'VITE_DEV_LOGIN=true\n');
  console.log('apps/order/.env.local 을 만들었습니다 (개발용 로그인 버튼 표시)');
}
