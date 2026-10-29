// API 서버가 DB 에 접속할 로그인 계정을 만든다(이미 있으면 비밀번호만 맞춤).
//   pnpm db:roles   (루트 .env 의 DATABASE_URL, DATABASE_SYSTEM_URL 에 적힌 사용자·비밀번호를 사용)
// DATABASE_URL 의 계정 → qr_app(RLS 적용), DATABASE_SYSTEM_URL 의 계정 → qr_system.
// 마이그레이션 계정(DATABASE_MIGRATION_URL)으로 실행하며, 마이그레이션 뒤에 실행한다.
import pg from 'pg';

const admin = process.env.DATABASE_MIGRATION_URL;
const targets: [string | undefined, 'qr_app' | 'qr_system'][] = [
  [process.env.DATABASE_URL, 'qr_app'],
  [process.env.DATABASE_SYSTEM_URL, 'qr_system'],
];
if (!admin || targets.some(([u]) => !u)) {
  console.error('DATABASE_MIGRATION_URL, DATABASE_URL, DATABASE_SYSTEM_URL 이 필요합니다 (.env)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: admin });
await client.connect();
try {
  const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
  for (const [url, group] of targets) {
    const u = new URL(url!);
    const user = decodeURIComponent(u.username);
    const password = decodeURIComponent(u.password);
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) throw new Error(`사용자 이름은 영문 소문자·숫자·_ 만: ${user}`);
    if (!password || password === 'CHANGE_ME') throw new Error(`${user} 의 비밀번호를 .env 에 정해 주세요`);
    const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])).rowCount;
    const lit = (await client.query<{ q: string }>('SELECT quote_literal($1) AS q', [password])).rows[0]!.q;
    await client.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${user} LOGIN PASSWORD ${lit}`);
    await client.query(`GRANT ${group} TO ${user}`);
    await client.query(`GRANT CONNECT ON DATABASE "${db.replace(/"/g, '""')}" TO ${user}`);
    console.log(`${user}: ${exists ? '비밀번호 갱신' : '생성'}, ${group} 권한 연결`);
  }
} finally {
  await client.end();
}
