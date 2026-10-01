import { Calendar, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import jaLocale from '@fullcalendar/core/locales/ja';
import { ancestorTitles, parentMap } from '../src/hierarchy';
import { japaneseHoliday, japaneseHolidaysBetween, vacationDays } from '../src/holidays';
import type { PlannerItem } from '../src/model';
import { CalendarView as CalendarViewSetting, Lang, PlannerSettings, resolveStatus } from '../src/settings';
import { translucent } from './colors';
import { addDays, formatDate, formatDateTime, isDateOnly } from './dates';
import { post } from './vscode';

const VIEW_NAMES: Record<CalendarViewSetting, string> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
};

export class CalendarView {
  private readonly calendar: Calendar;
  private appliedView: CalendarViewSetting | undefined;

  constructor(el: HTMLElement) {
    this.calendar = new Calendar(el, {
      plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
      initialView: VIEW_NAMES.month,
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
      height: '100%',
      editable: true,
      dayMaxEvents: true,
      // Show timed events as colored bars in month view too, so colors are visible.
      eventDisplay: 'block',
      eventClick: (info) => {
        if (info.event.display !== 'background') {
          post({ type: 'open', key: info.event.id });
        }
      },
      eventDrop: (info) => onChange(info.event),
      eventResize: (info) => onChange(info.event),
      eventDidMount: (info) => {
        // Background events (holidays, vacation shading) carry no ancestors.
        const ancestors: string[] = info.event.extendedProps.ancestors ?? [];
        info.el.title = ancestors.length
          ? `${[...ancestors].reverse().join(' › ')} › ${info.event.title}`
          : info.event.title;
      },
      dateClick: (info) => post({ type: 'create', date: info.allDay ? info.dateStr : formatDateTime(info.date) }),
    });
    this.calendar.render();
  }

  update(items: PlannerItem[], settings: PlannerSettings, lang: Lang): void {
    this.calendar.setOption('locale', lang === 'ja' ? jaLocale : 'en');
    this.calendar.setOption('firstDay', settings.weekStart);
    document.documentElement.style.setProperty('--mp-holiday-color', settings.holidayColor);

    // Day cells: weekend shading, holiday/vacation day numbers in color.
    const vacations = new Set(vacationDays(items).map((d) => d.date));
    const dayClasses = ({ date }: { date: Date }) => {
      const iso = formatDate(date);
      const classes: string[] = [];
      if (settings.weekendDays.includes(date.getDay())) {
        classes.push('mp-weekend');
      }
      if (settings.showHolidays && japaneseHoliday(iso, lang)) {
        classes.push('mp-holiday');
      }
      if (vacations.has(iso)) {
        classes.push('mp-vacation');
      }
      return classes;
    };
    this.calendar.setOption('dayCellClassNames', dayClasses);
    this.calendar.setOption('dayHeaderClassNames', dayClasses);
    // Only follow the setting when it changes, so the user's own view switches stick.
    if (this.appliedView !== settings.calendarView) {
      this.appliedView = settings.calendarView;
      this.calendar.changeView(VIEW_NAMES[settings.calendarView]);
    }

    const parents = parentMap(items);
    const dated = items
      .filter((i) => i.start ?? i.end)
      .filter((i) => i.type === 'holiday' || !(settings.hideDone && resolveStatus(i.status, settings.statuses).done));
    const events = dated.map((i) => toEvent(i, parents, settings));
    // Shade the days of each vacation, in addition to its draggable bar.
    const vacationShades = dated
      .filter((i) => i.type === 'holiday')
      .map(
        (i): EventInput => ({
          ...toEvent(i, parents, settings),
          id: `bg:${i.key}`,
          display: 'background',
          title: '',
          backgroundColor: translucent(settings.vacationColor),
        }),
      );

    this.calendar.removeAllEventSources();
    this.calendar.addEventSource([...events, ...vacationShades]);
    if (settings.showHolidays) {
      this.calendar.addEventSource({
        events: (range, success) =>
          success(
            japaneseHolidaysBetween(formatDate(range.start), formatDate(range.end), lang).map((h) => ({
              id: `jp:${h.date}`,
              title: h.name,
              start: h.date,
              allDay: true,
              display: 'background',
              backgroundColor: translucent(settings.holidayColor),
              classNames: ['mp-holiday-bg'],
            })),
          ),
      });
    }
    this.calendar.updateSize();
  }
}

function toEvent(item: PlannerItem, parents: Map<PlannerItem, PlannerItem>, settings: PlannerSettings): EventInput {
  const start = (item.start ?? item.end)!;
  const allDay = isDateOnly(start);
  const deadlineOnly = !item.start;
  let end: string | undefined;
  if (item.start && item.end) {
    // FullCalendar's all-day end is exclusive; ours is inclusive.
    end = allDay && isDateOnly(item.end) ? addDays(item.end, 1) : item.end;
  }
  const status = resolveStatus(item.status, settings.statuses);
  const color =
    item.type === 'event' ? settings.eventColor : item.type === 'holiday' ? settings.vacationColor : status.color;
  const title = item.type === 'holiday' ? `🌴 ${item.title}` : deadlineOnly ? `⏰ ${item.title}` : item.title;
  return {
    id: item.key,
    title,
    start,
    end,
    allDay,
    durationEditable: !deadlineOnly,
    backgroundColor: color,
    borderColor: color,
    classNames: status.done && item.type === 'task' ? ['is-done'] : [],
    extendedProps: { ancestors: ancestorTitles(item, parents) },
  };
}

function onChange(event: { id: string; start: Date | null; end: Date | null; allDay: boolean }) {
  if (!event.start) {
    return;
  }
  let start: string;
  let end: string | undefined;
  if (event.allDay) {
    start = formatDate(event.start);
    end = event.end ? addDays(formatDate(event.end), -1) : start;
  } else {
    start = formatDateTime(event.start);
    end = event.end ? formatDateTime(event.end) : undefined;
  }
  post({ type: 'move', key: event.id, start, end });
}
