import * as vscode from 'vscode';
import { DEFAULT_PROPERTY_MAP, PropertyMap } from './model';

export interface PlannerConfig {
  include: string;
  exclude: string;
  newItemFolder: string;
  properties: PropertyMap;
}

export function getConfig(): PlannerConfig {
  const c = vscode.workspace.getConfiguration('markPlanner');
  return {
    include: c.get('include', '**/*.md'),
    exclude: c.get('exclude', '**/node_modules/**'),
    newItemFolder: c.get('newItemFolder', 'planner'),
    properties: { ...DEFAULT_PROPERTY_MAP, ...c.get<Partial<PropertyMap>>('properties', {}) },
  };
}
