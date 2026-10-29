import pg from 'pg';
import { migrateUp, migrationStatus } from './migrator.js';

// 마이그레이션은 테이블 소유자 계정(DATABASE_MIGRATION_URL)으로 실행한다. API 서버 계정(qr_app 멤버)으로는 실행하지 않는다.
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL 환경변수가 필요합니다 (.env.example 참고)');
  process.exit(1);
}

const command = process.argv[2] ?? 'status';
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (command === 'up') {
    const applied = await migrateUp(client);
    console.log(applied.length ? `적용됨:\n  ${applied.join('\n  ')}` : '적용할 마이그레이션이 없습니다');
  } else if (command === 'status') {
    for (const s of await migrationStatus(client)) {
      console.log(`${s.version}_${s.name}  ${s.appliedAt ? s.appliedAt.toISOString() : '미적용'}`);
    }
  } else {
    console.error(`알 수 없는 명령: ${command} (up | status)`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
