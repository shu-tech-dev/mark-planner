import type { Lang } from './settings';

/** `auto`: omit the year for dates in the current year. */
export const AUTO_DATE_FORMAT = 'auto';

export const DATE_FORMAT_PRESETS = [
  AUTO_DATE_FORMAT,
  'M/D (ddd)',
  'YYYY/MM/DD',
  'YYYY-MM-DD',
  'YYYY年M月D日(ddd)',
  'MMM D, YYYY',
] as const;

const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g;

/**
 * Formats a `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` value for display. The time, when
 * present, is appended as ` HH:mm`. Tokens: YYYY YY M MM MMM MMMM D DD ddd dddd;
 * `[text]` is literal. `auto` = `M/D (ddd)` this year, `YYYY/M/D (ddd)` otherwise.
 */
export function formatDisplayDate(value: string, format: string, lang: Lang, today = new Date()): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const pattern =
    format === AUTO_DATE_FORMAT ? (y === today.getFullYear() ? 'M/D (ddd)' : 'YYYY/M/D (ddd)') : format;
  const intl = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(lang, options).format(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = pattern.replace(TOKEN_RE, (token, literal: string | undefined) => {
    if (literal !== undefined) {
      return literal;
    }
    switch (token) {
      case 'YYYY':
        return String(y);
      case 'YY':
        return pad(y % 100);
      case 'MMMM':
        return intl({ month: 'long' });
      case 'MMM':
        return intl({ month: 'short' });
      case 'MM':
        return pad(m);
      case 'M':
        return String(m);
      case 'DD':
        return pad(d);
      case 'D':
        return String(d);
      case 'dddd':
        return intl({ weekday: 'long' });
      case 'ddd':
        return intl({ weekday: 'short' });
      default:
        return token;
    }
  });
  return value.length > 10 ? `${text} ${value.slice(11, 16)}` : text;
}
