import { z } from 'zod';
import { colorRoleSchema, fontEntrySchema } from './design.js';
import { paletteEntrySchema, configurationComponentSchema } from './components.js';
import { appliedConfigItemSchema } from './configuration.js';
import {
  configIdSchema, namedMetadataShape, sourceSchema, instructionTextSchema, colorValueSchema,
} from './identifiers.js';

const resourceShape = {
  ...namedMetadataShape,
  ref: z.string().min(1).max(1090),
  key: z.string().min(1).max(1024),
  componentId: configIdSchema,
};
export const fileResourceSchema = z.object({
  ...resourceShape, type: z.literal('file'), source: sourceSchema,
  availability: z.enum(['available', 'missing', 'inaccessible']),
  kind: z.enum(['file', 'directory', 'other']).nullable(),
}).strict();
export const colorResourceSchema = z.object({
  ...resourceShape, type: z.literal('color'), value: colorValueSchema, role: colorRoleSchema.optional(),
}).strict();
export const instructionResourceSchema = z.object({
  ...resourceShape, type: z.literal('instruction'), content: instructionTextSchema,
}).strict();
export const fontResourceSchema = z.object({
  ...fontEntrySchema.shape, ref: resourceShape.ref, componentId: configIdSchema, type: z.literal('font'),
  availability: z.enum(['available', 'missing', 'inaccessible']).optional(),
}).strict();
export const paletteResourceSchema = z.object({
  ...resourceShape, type: z.literal('palette'), entries: z.array(paletteEntrySchema).min(1).max(9), css: z.string(),
}).strict();
export const fontSchemeResourceSchema = z.object({
  ...resourceShape, type: z.literal('font-scheme'), entries: z.array(fontEntrySchema).min(1).max(3), css: z.string(),
}).strict();
export const configurationResourceSchema = z.object({
  ...resourceShape, name: configurationComponentSchema.shape.name, type: z.literal('configuration'), items: z.array(appliedConfigItemSchema).max(64),
  preset: z.object({ id: configIdSchema, name: z.string().min(1).max(128) }).strict(),
  aiInstructions: z.string().max(2048).optional(),
}).strict();
export const resourceSchema = z.discriminatedUnion('type', [
  fileResourceSchema, colorResourceSchema, instructionResourceSchema, fontResourceSchema, paletteResourceSchema, fontSchemeResourceSchema,
  configurationResourceSchema,
]);
export type Resource = z.infer<typeof resourceSchema>;
export type FileResource = z.infer<typeof fileResourceSchema>;
export const getInputSchema = z.object({
  ref: z.string().describe('ID (preserve leading zeros), exact key/name/alias, or a returned componentId::localRef.'),
}).strict();
export const getOutputSchema = z.object({ resource: resourceSchema }).strict();
