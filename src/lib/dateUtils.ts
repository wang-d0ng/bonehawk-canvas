export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function isSameLocalDay(left: Date, right: Date): boolean {
  return startOfLocalDay(left).getTime() === startOfLocalDay(right).getTime();
}

export function daysUntil(target: Date, now: Date): number {
  const diff = startOfLocalDay(target).getTime() - startOfLocalDay(now).getTime();
  return Math.round(diff / 86_400_000);
}
