/** 새 주문 알림음. 브라우저 정책상 사용자가 한 번 버튼을 누른 뒤에만 소리를 낼 수 있다 */
let ctx: AudioContext | null = null;

export async function unlockSound(): Promise<boolean> {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

export function beep() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  for (const [i, f] of [880, 1175, 880].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(t + i * 0.18);
    o.stop(t + i * 0.18 + 0.17);
  }
}
