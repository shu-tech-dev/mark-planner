import './style.css';
import { MessageKey, t } from '../src/i18n';
import type { PlannerItem } from '../src/model';
import { DEFAULT_SETTINGS, Lang, PlannerSettings } from '../src/settings';
import { CalendarView } from './calendar';
import { formatDate } from './dates';
import { GanttView } from './gantt';
import { SettingsView } from './settings';
import { post } from './vscode';

type View = 'calendar' | 'gantt' | 'settings';

type ExtensionMessage =
  | { type: 'items'; items: PlannerItem[] }
  | { type: 'view'; view: View }
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
};

const calendar = new CalendarView(document.getElementById('calendar')!);
const gantt = new GanttView(document.getElementById('gantt-chart')!, document.getElementById('gantt-empty')!);
const settings = new SettingsView(document.getElementById('settings')!);

function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(state.lang, el.dataset.i18n as MessageKey);
  });
}

function render() {
  applyI18n();
  document.querySelectorAll<HTMLElement>('.view').forEach((el) => (el.hidden = el.id !== state.view));
  document
    .querySelectorAll<HTMLButtonElement>('[data-view]')
    .forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  switch (state.view) {
    case 'calendar':
      calendar.update(state.items, state.settings, state.lang);
      break;
    case 'gantt':
      gantt.update(state.items, state.settings, state.lang);
      break;
    case 'settings':
      settings.update(state.settings, state.defaults, state.lang, state.target);
      break;
  }
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) =>
  button.addEventListener('click', () => {
    state.view = button.dataset.view as View;
    render();
  }),
);
document.getElementById('new-item')!.addEventListener('click', () => {
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
    case 'config':
      state.settings = message.settings;
      state.defaults = message.defaults;
      state.lang = message.lang;
      state.target = message.target;
      break;
  }
  render();
});

applyI18n();
post({ type: 'ready' });
