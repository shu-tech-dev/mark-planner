import * as vscode from 'vscode';
import { Lang, normalizeSettings, PlannerSettings, resolveLanguage, SETTING_KEYS, SettingKey } from './settings';

export function getConfig(): PlannerSettings {
  const c = vscode.workspace.getConfiguration('markPlanner');
  return normalizeSettings(Object.fromEntries(SETTING_KEYS.map((key) => [key, c.get(key)])));
}

export function getLang(): Lang {
  return resolveLanguage(getConfig().language, vscode.env.language);
}

/** Where `updateSetting` writes: the workspace when a folder is open, otherwise user settings. */
export function settingsTarget(): 'workspace' | 'user' {
  return vscode.workspace.workspaceFolders?.length ? 'workspace' : 'user';
}

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && (SETTING_KEYS as string[]).includes(key);
}

/** Writes a setting; `undefined` removes it so the default applies again. */
export async function updateSetting(key: SettingKey, value: unknown): Promise<void> {
  const target =
    settingsTarget() === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration('markPlanner').update(key, value, target);
}
