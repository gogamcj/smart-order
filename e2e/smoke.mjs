// 2단계 브라우저 실동작 점검 (수동 실행). API 와 세 프런트엔드가 떠 있어야 한다. 실행 방법은 e2e/README.md
// 가짜 PG(테스트 결제)와 개발용 로그인을 사용한다. 실제 카카오 로그인·실제 결제는 확인하지 않는다.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// 프로젝트 의존성에 넣지 않고, 실행 환경에 설치된 Playwright 를 쓴다
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const ORDER = process.env.ORDER_URL ?? 'http://localhost:5173';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:5174';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5175';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@e2e.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'AdminPass-12345';
const SHOTS = process.env.SHOTS_DIR ?? 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const run = Date.now().toString(36);
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`✓ ${name} (${Date.now() - t}ms)`);
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message.split('\n')[0]}`);
    console.log(`✗ ${name}\n${e.stack}`);
    let n = 0;
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: `${SHOTS}/fail-${++n}.png` }).catch(() => {});
    throw e;
  }
}

const browser = await chromium.launch();
const consoleErrors = [];
const watch = (page, label) => {
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`[${label}] ${m.text()}`));
  page.on('response', async (r) => {
    if (r.status() >= 400) consoleErrors.push(`[${label}] ${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  });
};
try {
  const mctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const m = await mctx.newPage();
  watch(m, 'merchant');
  let qrUrl = '';

  await step('업체: 계정 만들기 → 가입 신청 → 승인 대기 안내', async () => {
    await m.goto(`${MERCHANT}/signup`);
    await m.getByLabel('이름').fill('홍사장');
    await m.getByLabel('이메일').fill(`owner-${run}@e2e.test`);
    await m.getByLabel('비밀번호').fill('OwnerPass-12345');
    await m.getByRole('button', { name: '가입하기' }).click();
    await m.getByRole('heading', { name: '업체 가입 신청' }).waitFor();
    await m.getByLabel('업체(상호) 이름').fill('홍길동 김치찌개');
    await m.getByLabel('업체 주소용 영문 이름').fill(`hong-${run}`);
    await m.getByLabel('사업자등록번호').fill('1234567890');
    await m.getByLabel('대표자 이름').fill('홍길동');
    await m.getByLabel('연락처').fill('010-1234-5678');
    await m.getByLabel('연락 이메일').fill(`owner-${run}@e2e.test`);
    await m.getByLabel('첫 매장 이름').fill('본점');
    await m.getByRole('button', { name: '신청하기' }).click();
    await m.getByText('가입 승인 대기 중입니다').waitFor();
    await m.screenshot({ path: `${SHOTS}/merchant-1-pending-dashboard.png` });
  });

  await step('업체: 카테고리·메뉴(할인가, 필수 옵션, 이미지) 등록', async () => {
    await m.getByRole('link', { name: '메뉴 관리' }).click();
    await m.getByPlaceholder('새 카테고리').fill('찌개');
    await m.getByRole('button', { name: '추가' }).click();
    await m.getByRole('button', { name: /^찌개/ }).waitFor();
    await m.getByRole('button', { name: '메뉴 추가' }).click();
    await m.getByLabel('이름', { exact: true }).fill('김치찌개');
    await m.getByLabel('가격 (원)').fill('9000');
    await m.getByLabel('할인가 (원, 선택)').fill('8000');
    await m.locator('input[type=file]').setInputFiles({ name: 'kimchi.png', mimeType: 'image/png', buffer: PNG });
    await m.getByRole('button', { name: '이미지 빼기' }).waitFor();
    await m.getByRole('button', { name: '그룹 추가' }).click();
    await m.getByPlaceholder('예: 맵기').fill('맵기');
    await m.getByLabel('최소').fill('1');
    await m.getByLabel('최대').fill('1');
    await m.getByPlaceholder('옵션 이름').first().fill('순한맛');
    await m.getByRole('button', { name: '+ 옵션 추가' }).click();
    await m.getByPlaceholder('옵션 이름').nth(1).fill('매운맛');
    await m.getByLabel('추가 금액').nth(1).fill('500');
    await m.getByRole('button', { name: '저장' }).click();
    await m.getByText('옵션 그룹 1개').waitFor();
    await m.screenshot({ path: `${SHOTS}/merchant-2-menus.png` });
  });

  await step('업체: 테이블 일괄 생성, QR 확인, 인쇄용 PDF 다운로드', async () => {
    await m.getByRole('link', { name: '테이블·QR' }).click();
    await m.getByLabel('끝 번호').fill('3');
    await m.getByRole('button', { name: '번호로 한꺼번에 만들기' }).click();
    await m.getByText('3개 테이블을 만들었습니다').waitFor();
    await m.getByRole('button', { name: 'QR 보기' }).first().click();
    const urlText = m.locator('p.break-all');
    await urlText.waitFor();
    qrUrl = (await urlText.textContent()).trim();
    if (!/\/#\/q\/[\w-]{43,}$/.test(qrUrl)) throw new Error(`QR 주소 형식이 예상과 다름: ${qrUrl}`);
    await m.getByRole('img', { name: /QR/ }).waitFor();
    await m.screenshot({ path: `${SHOTS}/merchant-3-qr.png` });
    await m.getByRole('button', { name: '닫기' }).click();
    const [dl] = await Promise.all([m.waitForEvent('download'), m.getByRole('button', { name: '전체 QR 인쇄용 PDF' }).click()]);
    const path = await dl.path();
    const { readFileSync } = await import('node:fs');
    if (readFileSync(path).subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF 가 아님');
  });

  await step('승인 전에는 고객이 QR 로 들어올 수 없다', async () => {
    const c0 = await browser.newPage();
    await c0.goto(qrUrl);
    await c0.getByText('사용할 수 없는 QR 코드입니다').waitFor();
    await c0.close();
  });

  await step('최고 관리자: 로그인 → 승인 대기 업체 승인', async () => {
    const a = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watch(a, 'admin');
    await a.goto(ADMIN);
    await a.getByLabel('이메일').fill(ADMIN_EMAIL);
    await a.getByLabel('비밀번호').fill(ADMIN_PASSWORD);
    await a.getByRole('button', { name: '로그인' }).click();
    const card = a.locator('div.rounded-2xl', { hasText: '홍길동 김치찌개' }).first(); // 최신 신청이 맨 앞
    await a.getByText('홍길동 김치찌개').first().waitFor();
    await a.screenshot({ path: `${SHOTS}/admin-1-pending.png` });
    const [res] = await Promise.all([a.waitForResponse((r) => r.url().includes('/approve')), card.getByRole('button', { name: '승인' }).click()]);
    if (res.status() !== 200) throw new Error(`승인 응답 ${res.status()}`);
    await a.getByRole('combobox', { name: '상태' }).selectOption('active');
    await a.locator('span', { hasText: '이용 중' }).first().waitFor();
    await a.close();
  });

  const cctx = await browser.newContext({ ...devices['iPhone 13'] });
  const c = await cctx.newPage();
  watch(c, 'order');
  let orderUrl = '';

  await step('고객(모바일): QR 진입(해시 주소) → 메뉴 → 필수 옵션 선택 → 장바구니', async () => {
    await c.goto(qrUrl);
    await c.getByText('김치찌개').first().waitFor();
    await c.getByText('테이블 1').waitFor();
    await c.screenshot({ path: `${SHOTS}/order-1-menu.png` });
    await c.getByRole('button', { name: /김치찌개/ }).click();
    await c.getByRole('button', { name: /담기/ }).click();
    await c.getByText('맵기을(를) 선택해 주세요').waitFor(); // 필수 옵션 안내
    await c.getByLabel('매운맛').check();
    await c.getByRole('button', { name: '8,500원 담기' }).click();
    await c.getByRole('link', { name: /장바구니 1개/ }).click();
    await c.getByText('8,500원').first().waitFor();
  });

  await step('고객: 카카오 미설정 시 로그인 화면에 안내가 나온다', async () => {
    await c.getByRole('button', { name: '카카오 로그인 후 주문하기' }).click();
    await c.getByRole('button', { name: '카카오로 시작하기' }).click();
    await c.getByText('카카오 로그인이 아직 설정되지 않았습니다').waitFor();
    await c.screenshot({ path: `${SHOTS}/order-2-login.png` });
  });

  await step('고객: 개발용 로그인 → 약관 동의 → 주문 → 테스트 결제 승인 → 접수 대기', async () => {
    const back = new URL(c.url());
    back.hash = '#/login?returnTo=%2Fcart';
    await c.goto(back.toString());
    await c.getByLabel('닉네임').fill(`고객-${run}`); // 실행마다 새 고객(약관 미동의 상태)
    await c.getByRole('button', { name: '개발용 로그인' }).click();
    await c.getByText('주문하려면 약관에 동의해 주세요').waitFor();
    for (const box of await c.getByRole('checkbox').all()) await box.check();
    await c.screenshot({ path: `${SHOTS}/order-3-cart.png` });
    await c.getByRole('button', { name: '8,500원 주문하기' }).click();
    await c.getByRole('heading', { name: '결제' }).waitFor();
    await c.getByRole('button', { name: '결제하기' }).click();
    await c.getByText('테스트 결제 (실제 결제 아님)').waitFor();
    await c.screenshot({ path: `${SHOTS}/order-4-test-payment.png` });
    await c.getByRole('button', { name: '테스트 승인' }).click();
    await c.getByText('접수 대기', { exact: true }).first().waitFor();
    orderUrl = c.url();
    await c.screenshot({ path: `${SHOTS}/order-5-placed.png` });
  });

  await step('업체: 주문 현황판에 새 주문 표시(5초 주기) → 접수', async () => {
    await m.getByRole('link', { name: '주문 현황' }).click();
    // 테이블 보기: 새 주문이 들어온 테이블 칸을 눌러 주문을 연다
    await m.getByRole('button', { name: /^테이블 1 · 새 주문/ }).click({ timeout: 15_000 });
    const card = m.locator('article', { hasText: '테이블 1' });
    await card.waitFor({ timeout: 15_000 });
    await card.getByText('매운맛').waitFor();
    await m.screenshot({ path: `${SHOTS}/merchant-4-dashboard.png` });
    await card.getByRole('button', { name: '접수', exact: true }).click();
    await card.getByText('접수됨').waitFor();
  });

  await step('고객: 주문 상태가 접수됨으로 갱신된다(5초 주기)', async () => {
    await c.getByText('접수됨', { exact: true }).first().waitFor({ timeout: 15_000 });
  });

  await step('업체: 준비 완료 → 고객 화면 "음식이 준비되었습니다"', async () => {
    await m.locator('article', { hasText: '테이블 1' }).getByRole('button', { name: '준비 완료' }).click();
    await c.getByText('음식이 준비되었습니다!').waitFor({ timeout: 15_000 });
    await c.screenshot({ path: `${SHOTS}/order-6-ready.png` });
  });

  await step('고객: 주문 내역에 주문이 보인다', async () => {
    await c.getByRole('link', { name: '주문 내역' }).click();
    await c.getByText('홍길동 김치찌개').or(c.getByText('본점')).first().waitFor();
  });

  await step('업체: 주문 접수 일시 중지 → 고객 메뉴에 안내, 주문 버튼 비활성', async () => {
    await m.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
    await m.getByRole('button', { name: /주문 접수 중/ }).click();
    await m.getByText('주문 접수를 중지했습니다').waitFor();
    await c.goto(orderUrl.replace(/#.*$/, '#/menu'));
    await c.reload();
    await c.getByText('지금은 주문을 받지 않고 있습니다').waitFor();
    await m.getByRole('button', { name: /다시 받기/ }).click();
  });
} finally {
  await browser.close();
  console.log('\n' + results.join('\n'));
  console.log(`\n브라우저 콘솔 오류 ${consoleErrors.length}건`);
  for (const e of consoleErrors) console.log('  ' + e);
}
