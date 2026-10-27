import { z } from 'zod';
import { designDefaultsSchema } from './design.js';
import { configIdSchema } from './identifiers.js';
import { configurationStateSchema } from './configuration.js';

const ids = (max: number) => z.array(configIdSchema).max(max)
  .refine(values => new Set(values).size === values.length, 'Duplicate IDs.');
export const configSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().min(1),
  activeWorkspaceId: configIdSchema,
  workspaceIds: ids(128),
  componentIds: ids(512),
}).strict().refine(value => value.workspaceIds.includes(value.activeWorkspaceId), 'Active workspace is not registered.');
export const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().min(1).default(1),
  id: configIdSchema,
  name: z.string().trim().min(1).max(256),
  componentIds: ids(128).default([]),
  disabledComponentIds: ids(128).optional(),
  design: designDefaultsSchema.optional(),
  configurations: z.record(configIdSchema, configurationStateSchema).refine(states => Object.keys(states).length <= 128, 'Too many configuration components.').optional(),
}).strict().refine(value =>
  (value.disabledComponentIds ?? []).every(id => value.componentIds.includes(id)),
  'Disabled components must belong to the workspace.').refine(value =>
  [value.design?.paletteId, value.design?.fontId].every(id => !id || value.componentIds.includes(id)),
  'Default design schemes must be selected in the workspace.');
export type DockyardConfig = z.infer<typeof configSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
