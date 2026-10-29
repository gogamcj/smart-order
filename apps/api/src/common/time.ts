/** 매장 시간대 기준 영업일(YYYY-MM-DD), 요일(0=일), 현재 시각(HH:MM) */
export function localNow(timeZone: string, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, dow, time: `${parts.hour}:${parts.minute}` };
}
