import { DEFAULT_PROPERTY_MAP, PropertyMap } from './model';

export type Lang = 'ja' | 'en';
export type LanguageSetting = 'auto' | Lang;
export type CalendarView = 'month' | 'week' | 'day';
export type GanttViewMode = 'Day' | 'Week' | 'Month';

export interface StatusDef {
  name: string;
  label?: string;
  color: string;
  progress: number;
  done: boolean;
}

/** Mirrors `contributes.configuration` in package.json (keys under `markPlanner.`). */
export interface PlannerSettings {
  include: string;
  exclude: string;
  newItemFolder: string;
  properties: PropertyMap;
  statuses: StatusDef[];
  eventColor: string;
  calendarView: CalendarView;
  ganttViewMode: GanttViewMode;
  weekStart: number;
  hideDone: boolean;
  'template.body': string;
  'template.frontmatter': Record<string, unknown>;
  language: LanguageSetting;
}

export type SettingKey = keyof PlannerSettings;

export const DEFAULT_STATUSES: StatusDef[] = [
  { name: 'todo', color: '#3794ff', progress: 0, done: false },
  { name: 'doing', color: '#d18616', progress: 50, done: false },
  { name: 'done', color: '#888888', progress: 100, done: true },
];

export const DEFAULT_SETTINGS: PlannerSettings = {
  include: '**/*.md',
  exclude: '**/node_modules/**',
  newItemFolder: 'planner',
  properties: DEFAULT_PROPERTY_MAP,
  statuses: DEFAULT_STATUSES,
  eventColor: '#b180d7',
  calendarView: 'month',
  ganttViewMode: 'Day',
  weekStart: 0,
  hideDone: false,
  'template.body': '',
  'template.frontmatter': {},
  language: 'auto',
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Drops nameless or duplicate statuses and clamps values; falls back to the defaults when nothing is left. */
export function normalizeStatuses(value: unknown): StatusDef[] {
  if (!Array.isArray(value)) {
    return DEFAULT_STATUSES;
  }
  const seen = new Set<string>();
  const statuses: StatusDef[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim() || seen.has(raw.name.trim())) {
      continue;
    }
    const name = raw.name.trim();
    seen.add(name);
    const progress = Number(raw.progress);
    statuses.push({
      name,
      ...(typeof raw.label === 'string' && raw.label.trim() ? { label: raw.label.trim() } : {}),
      color: typeof raw.color === 'string' && COLOR_RE.test(raw.color) ? raw.color : '#888888',
      progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, Math.round(progress))) : 0,
      done: raw.done === true,
    });
  }
  return statuses.length > 0 ? statuses : DEFAULT_STATUSES;
}

/** Turns raw configuration values (possibly hand-edited and invalid) into usable settings. */
export function normalizeSettings(raw: Partial<Record<SettingKey, unknown>>): PlannerSettings {
  const d = DEFAULT_SETTINGS;
  const properties = { ...DEFAULT_PROPERTY_MAP };
  if (isRecord(raw.properties)) {
    for (const key of Object.keys(properties) as (keyof typeof properties)[]) {
      properties[key] = str(raw.properties[key], properties[key]);
    }
  }
  const weekStart = Number(raw.weekStart);
  return {
    include: str(raw.include, d.include),
    // An empty exclude is meaningful (exclude nothing).
    exclude: typeof raw.exclude === 'string' ? raw.exclude.trim() : d.exclude,
    newItemFolder: str(raw.newItemFolder, d.newItemFolder),
    properties,
    statuses: normalizeStatuses(raw.statuses),
    eventColor: typeof raw.eventColor === 'string' && COLOR_RE.test(raw.eventColor) ? raw.eventColor : d.eventColor,
    calendarView: oneOf(raw.calendarView, ['month', 'week', 'day'], d.calendarView),
    ganttViewMode: oneOf(raw.ganttViewMode, ['Day', 'Week', 'Month'], d.ganttViewMode),
    weekStart: Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6 ? weekStart : d.weekStart,
    hideDone: raw.hideDone === true,
    'template.body': typeof raw['template.body'] === 'string' ? raw['template.body'] : d['template.body'],
    'template.frontmatter': isRecord(raw['template.frontmatter'])
      ? raw['template.frontmatter']
      : d['template.frontmatter'],
    language: oneOf(raw.language, ['auto', 'ja', 'en'], d.language),
  };
}

export interface ResolvedStatus extends StatusDef {
  index: number;
}

/** Unknown statuses are treated like the first one. */
export function resolveStatus(name: string, statuses: StatusDef[]): ResolvedStatus {
  const index = Math.max(
    0,
    statuses.findIndex((s) => s.name === name),
  );
  return { ...statuses[index], index };
}

export function renderTemplate(body: string, vars: { title: string; date: string }): string {
  return body.replace(/\{\{\s*(title|date)\s*\}\}/g, (_, key: 'title' | 'date') => vars[key]);
}

export function resolveLanguage(setting: LanguageSetting, displayLanguage: string): Lang {
  if (setting !== 'auto') {
    return setting;
  }
  return displayLanguage.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}
