import { z } from 'zod';
import { componentSchema, configIdSchema, designDefaultsSchema, type DesignDefaults, type Component, type Workspace } from '@dockyard/shared';

import type { ConnectionPlan } from './codex-connection';
import type { LanguagePreference } from './i18n';
import type { LanguageSettings } from './language';
import { notebookSchema, type Notebook } from './notebook-model';
import { configurationActionSchema, configurationComponentSchema, type ConfigurationAction } from '@dockyard/shared';
const id = configIdSchema;
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }).strict(),
  z.object({ type: z.literal('bindingConfig'), id }).strict(),
  z.object({ type: z.literal('configuration'), id, componentId: id, expectedRevision: z.number().int().positive(), definitionRevision: z.number().int().positive(), action: configurationActionSchema }).strict(),
  z.object({ type: z.literal('importConfiguration'), id, expectedRevision: z.number().int().positive(), component: configurationComponentSchema }).strict(),
  z.object({ type: z.literal('notebook'), id }).strict(),
  z.object({ type: z.literal('saveNotebook'), id, notebook: notebookSchema }).strict(),
  z.object({ type: z.literal('save'), component: componentSchema }).strict(),
  z.object({ type: z.literal('remove'), id }).strict(),
  z.object({ type: z.literal('refresh'), id }).strict(),
  z.object({ type: z.literal('createWorkspace'), name: z.string().trim().min(1).max(256) }).strict(),
  z.object({ type: z.literal('renameWorkspace'), id, name: z.string().trim().min(1).max(256) }).strict(),
  z.object({ type: z.literal('switchWorkspace'), id }).strict(),
  z.object({ type: z.literal('select'), id, componentIds: z.array(id).max(128) }).strict(),
  z.object({ type: z.literal('enable'), id, componentId: id, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('design'), id, design: designDefaultsSchema }).strict(),
  z.object({ type: z.literal('diagnose') }).strict(),
  z.object({ type: z.literal('connectionPlan') }).strict(),
  z.object({ type: z.literal('connectCodex'), token: z.string().regex(/^[a-f0-9]{64}$/), replace: z.boolean() }).strict(),
  z.object({ type: z.literal('restoreConnection'), id: z.string().regex(/^\d+-[a-f0-9-]{36}$/) }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type ComponentInfo = {
  component: Component; count: number | null;
  status: string; message?: string; builtAt?: string; errors?: number; skipped?: number;
};
export type DockState = {
  dataDir: string; activeWorkspaceId: string; workspaces: Workspace[];
  components: ComponentInfo[];
};
export type Diagnosis = {
  checkedAt: string;
  registration: 'matching' | 'other' | 'missing' | 'unavailable';
  selfTest: 'passed' | 'failed'; message: string;
};
export type Progress = { files: number; directories: number };
export type Theme = 'light' | 'dark';
export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; code: string; message: string };
export type CaptureResult = { kind: 'color'; value: string } | { kind: 'screenshot'; dataUrl: string; width: number; height: number };
export type DesktopApi = {
  readonly isDevelopment: boolean;
  getLanguage(): Promise<Reply<LanguageSettings>>;
  setLanguage(language: LanguagePreference): Promise<Reply<LanguageSettings>>;
  getTheme(): Promise<Reply<Theme>>;
  setTheme(theme: Theme): Promise<Reply<Theme>>;
  resize(height: number, width?: number, collapsed?: boolean): Promise<void>;
  setSurfaces(surfaces: { x: number; y: number; width: number; height: number; radius: number }[]): Promise<'acrylic' | 'translucent' | 'solid'>;
  onMaterialChange(callback: (mode: 'acrylic' | 'translucent' | 'solid') => void): () => void;
  close(): Promise<void>;
  onBlur(callback: () => void): () => void;
  capture(mode: 'color' | 'screenshot'): Promise<Reply<CaptureResult | null>>;
  screenshotAction(action: 'copy' | 'save' | 'resource', dataUrl?: string): Promise<Reply<string | null>>;
  copyText(text: string): Promise<Reply>;
  state(): Promise<Reply<DockState>>;
  bindingConfig(id: string): Promise<Reply<string>>;
  updateConfiguration(id: string, componentId: string, expectedRevision: number, definitionRevision: number, action: ConfigurationAction): Promise<Reply>;
  importConfiguration(id: string, expectedRevision: number, component: Extract<Component, { type: 'configuration' }>): Promise<Reply>;
  notebook(id: string): Promise<Reply<Notebook>>;
  saveNotebook(id: string, notebook: Notebook): Promise<Reply>;
  restartApp(): Promise<Reply>;
  save(component: Component): Promise<Reply>;
  remove(id: string): Promise<Reply>;
  refresh(id: string): Promise<Reply<{ status: string; files: number; errors: number; skipped: number }>>;
  createWorkspace(name: string): Promise<Reply>;
  renameWorkspace(id: string, name: string): Promise<Reply>;
  switchWorkspace(id: string): Promise<Reply>;
  select(id: string, componentIds: string[]): Promise<Reply>;
  setResourceEnabled(id: string, componentId: string, enabled: boolean): Promise<Reply>;
  setDesign(id: string, design: DesignDefaults): Promise<Reply>;
  pickSource(kind: 'folder' | 'file'): Promise<Reply<string | null>>;
  diagnose(): Promise<Reply<Diagnosis>>;
  connectionPlan(): Promise<Reply<ConnectionPlan>>;
  connectCodex(token: string, replace: boolean): Promise<Reply<{ changed: boolean; plan: ConnectionPlan; diagnosis: Diagnosis }>>;
  restoreConnection(id: string): Promise<Reply<ConnectionPlan>>;
  onProgress(callback: (progress: Progress) => void): () => void;
};
