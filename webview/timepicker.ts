import { t } from '../src/i18n';
import type { Lang } from '../src/settings';
import { parseTime } from './datepicker';

export const MINUTE_STEPS = ['00', '15', '30', '45'];

/** Sets the hour of a time text, keeping its minutes (`:00` when there are none). */
export function withHour(value: string, hour: number): string {
  const minutes = parseTime(value)?.slice(3) || '00';
  return `${String(hour).padStart(2, '0')}:${minutes}`;
}

/** Sets the minutes of a time text, keeping its hour (09 when there is none). */
export function withMinutes(value: string, minutes: string): string {
  const hour = parseTime(value)?.slice(0, 2) || '09';
  return `${hour}:${minutes}`;
}

/**
 * 24-hour time popup under an `HH:mm` input: pick the hour (stays open), then the
 * minutes (closes). Calls `onPick(done)` after writing the input. Focus stays in
 * the input, like the date picker.
 */
export function attachTimePicker(input: HTMLInputElement, lang: Lang, onPick: (done: boolean) => void): () => void {
  const pop = document.createElement('div');
  pop.className = 'popover timepicker';
  pop.addEventListener('pointerdown', (e) => e.preventDefault());

  const button = (label: string, selected: boolean, run: () => void) => {
    const b = document.createElement('button');
    b.className = `dp-day${selected ? ' selected' : ''}`;
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  };
  const section = (title: string, grid: HTMLElement) => {
    const h = document.createElement('div');
    h.className = 'tp-title';
    h.textContent = title;
    return [h, grid];
  };

  const render = () => {
    const current = parseTime(input.value) || '';
    const hours = document.createElement('div');
    hours.className = 'tp-grid tp-hours';
    for (let h = 0; h < 24; h++) {
      hours.append(
        button(String(h).padStart(2, '0'), current.slice(0, 2) === String(h).padStart(2, '0'), () => {
          input.value = withHour(input.value, h);
          onPick(false);
          render();
        }),
      );
    }
    const minutes = document.createElement('div');
    minutes.className = 'tp-grid tp-minutes';
    for (const m of MINUTE_STEPS) {
      minutes.append(
        button(`:${m}`, current.slice(3) === m, () => {
          input.value = withMinutes(input.value, m);
          onPick(true);
        }),
      );
    }
    pop.replaceChildren(...section(t(lang, 'timepicker.hour'), hours), ...section(t(lang, 'timepicker.minute'), minutes));
  };

  render();
  input.addEventListener('input', render);
  document.body.append(pop);
  const rect = input.getBoundingClientRect();
  const below = rect.bottom + 4;
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, rect.top - pop.offsetHeight - 4) : below}px`;
  return () => {
    input.removeEventListener('input', render);
    pop.remove();
  };
}
