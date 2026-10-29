// 최고 관리자 계정 생성/승격 (운영자가 서버에서 직접 실행)
//   DATABASE_MIGRATION_URL=... pnpm admin:create admin@example.kr
// 계정이 없으면 비밀번호를 물어 새로 만들고, 있으면 super_admin 으로 승격한다.
import { createInterface } from 'node:readline/promises';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const email = process.argv[2]?.trim().toLowerCase();
const url = process.env.DATABASE_MIGRATION_URL;
if (!email || !url) {
  console.error('사용법: DATABASE_MIGRATION_URL=... pnpm admin:create <email>');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount) {
    await client.query(`UPDATE users SET platform_role = 'super_admin' WHERE email = $1`, [email]);
    console.log(`${email} 계정을 최고 관리자로 지정했습니다`);
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const password = await rl.question('새 비밀번호 (10자 이상): ');
    rl.close();
    if (password.length < 10) throw new Error('비밀번호는 10자 이상이어야 합니다');
    await client.query(`INSERT INTO users (email, password_hash, display_name, platform_role) VALUES ($1, $2, '최고 관리자', 'super_admin')`, [email, await hash(password)]);
    console.log(`최고 관리자 ${email} 계정을 만들었습니다`);
  }
  await client.query(`INSERT INTO audit_logs (actor_kind, action, target_type, details) VALUES ('system', 'platform_admin.grant', 'user', $1)`, [JSON.stringify({ email })]);
} finally {
  await client.end();
}
