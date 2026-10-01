declare module '@holiday-jp/holiday_jp/lib/holidays' {
  const holidays: Record<string, { date: string; name: string; name_en: string }>;
  export default holidays;
}
