import './style.css';
import { MessageKey, t } from '../src/i18n';
import type { PlannerItem } from '../src/model';
import { CalendarView as CalendarRange, DEFAULT_SETTINGS, GanttViewMode, Lang, PlannerSettings } from '../src/settings';
import { CalendarNav, CalendarView } from './calendar';
import { formatDate } from './dates';
import { GanttView } from './gantt';
import { renderIcons } from './icons';
import { SettingsView } from './settings';
import { TableView } from './table';
import { post } from './vscode';

type View = 'calendar' | 'gantt' | 'table' | 'settings';

type ExtensionMessage =
  | { type: 'items'; items: PlannerItem[] }
  | { type: 'view'; view: View }
  | { type: 'tableState'; state: unknown }
  | {
      type: 'config';
      settings: PlannerSettings;
      defaults: PlannerSettings;
      lang: Lang;
      target: 'workspace' | 'user';
    };

const state = {
  items: [] as PlannerItem[],
  view: 'calendar' as View,
  settings: DEFAULT_SETTINGS,
  defaults: DEFAULT_SETTINGS,
  lang: (document.documentElement.lang === 'en' ? 'en' : 'ja') as Lang,
  target: 'workspace' as 'workspace' | 'user',
  calendarNav: { title: '', range: 'month' } as CalendarNav,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const calendar = new CalendarView($('calendar'), (nav) => {
  state.calendarNav = nav;
  renderAppBar();
});
const gantt = new GanttView($('gantt-chart'), $('gantt-empty'));
const settings = new SettingsView($('settings'));
const table = new TableView($('table'));

function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(state.lang, el.dataset.i18n as MessageKey);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const label = t(state.lang, el.dataset.i18nTitle as MessageKey);
    el.title = label;
    el.setAttribute('aria-label', label);
  });
}

/** Range switch (month/week/day or Day/Week/Month) for the current view. */
function rangeOptions(): { value: string; label: string; active: boolean; select: () => void }[] {
  if (state.view === 'calendar') {
    return (['month', 'week', 'day'] as CalendarRange[]).map((r) => ({
      value: r,
      label: t(state.lang, `settings.calendarView.${r}`),
      active: state.calendarNav.range === r,
      select: () => calendar.setRange(r),
    }));
  }
  if (state.view === 'gantt') {
    return (['Day', 'Week', 'Month'] as GanttViewMode[]).map((m) => ({
      value: m,
      label: t(state.lang, `settings.ganttViewMode.${m}`),
      active: gantt.viewMode === m,
      select: () => {
        gantt.setViewMode(m);
        renderAppBar();
      },
    }));
  }
  return [];
}

function renderAppBar() {
  document.body.dataset.view = state.view;
  document
    .querySelectorAll<HTMLButtonElement>('[data-view]')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('nav-title').textContent =
    state.view === 'calendar' ? state.calendarNav.title : state.view === 'settings' ? t(state.lang, 'settings.title') : '';
  const range = $('range');
  range.replaceChildren(
    ...rangeOptions().map((o) => {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.classList.toggle('active', o.active);
      b.addEventListener('click', o.select);
      return b;
    }),
  );
}

function render() {
  applyI18n();
  // Light/dark palette selection lives in style.css (see "Design tokens").
  document.body.dataset.theme = state.settings.theme;
  document.querySelectorAll<HTMLElement>('.view').forEach((el) => (el.hidden = el.id !== state.view));
  switch (state.view) {
    case 'calendar':
      calendar.update(state.items, state.settings, state.lang);
      break;
    case 'gantt':
      gantt.update(state.items, state.settings, state.lang);
      break;
    case 'table':
      table.update(state.items, state.settings, state.lang);
      break;
    case 'settings':
      settings.update(state.settings, state.defaults, state.lang, state.target);
      break;
  }
  renderAppBar();
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) =>
  button.addEventListener('click', () => {
    state.view = button.dataset.view as View;
    render();
  }),
);
$('nav-today').addEventListener('click', () => (state.view === 'gantt' ? gantt.today() : calendar.today()));
$('nav-prev').addEventListener('click', () => calendar.prev());
$('nav-next').addEventListener('click', () => calendar.next());
$('new-item').addEventListener('click', () => {
  post({ type: 'create', date: formatDate(new Date()) });
});

window.addEventListener('message', (e: MessageEvent<ExtensionMessage>) => {
  const message = e.data;
  switch (message.type) {
    case 'items':
      state.items = message.items;
      break;
    case 'view':
      state.view = message.view;
      break;
    case 'tableState':
      table.setState(message.state);
      break;
    case 'config':
      state.settings = message.settings;
      state.defaults = message.defaults;
      state.lang = message.lang;
      state.target = message.target;
      break;
  }
  render();
});

renderIcons();
applyI18n();
renderAppBar();
post({ type: 'ready' });
