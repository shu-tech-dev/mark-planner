const pad = (n: number) => String(n).padStart(2, '0');

export const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const formatDateTime = (d: Date) => `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isDateOnly = (s: string) => s.length === 10;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d + days));
}
