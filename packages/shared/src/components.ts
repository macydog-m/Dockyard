import { z } from 'zod';
import { configurationItemsSchema } from './configuration.js';
import { colorRoleSchema, fontEntrySchema } from './design.js';
import {
  configIdSchema, resourceKeySchema, namedMetadataShape, sourceSchema,
  instructionTextSchema, colorValueSchema,
} from './identifiers.js';

import { relativePathSchema } from './folder-index.js';
const componentShape = {
  schemaVersion: z.literal(1),
  revision: z.number().int().min(1).default(1),
  id: configIdSchema,
  name: z.string().trim().min(1).max(256),
  description: z.string().max(4096).optional(),
  enabled: z.boolean().default(true),
};
export const fileComponentSchema = z.object({
  ...componentShape, ...namedMetadataShape, type: z.literal('file'),
  key: resourceKeySchema, source: sourceSchema,
}).strict();
export const folderComponentSchema = z.object({
  ...componentShape, type: z.literal('folder'), source: sourceSchema,
  overrides: z.array(z.object({
    relativePath: relativePathSchema,
    name: namedMetadataShape.name.optional(),
    description: namedMetadataShape.description,
    aliases: namedMetadataShape.aliases, tags: namedMetadataShape.tags,
  }).strict()).max(1024).default([]).refine(
    entries => new Set(entries.map(entry => entry.relativePath)).size === entries.length,
    'Folder overrides must have unique relative paths.',
  ),
}).strict();
export const paletteEntrySchema = z.object({
  ...namedMetadataShape, key: resourceKeySchema, value: colorValueSchema, role: colorRoleSchema.optional(),
}).strict();
export const paletteComponentSchema = z.object({
  ...componentShape, type: z.literal('palette'), mode: z.enum(['swatches', 'design']).optional(),
  entries: z.array(paletteEntrySchema).max(1024).refine(
    entries => new Set(entries.map(entry => entry.key.toLowerCase())).size === entries.length,
    'Palette keys must be unique ignoring case.',
  ).refine(entries => {
    const roles = entries.flatMap(entry => entry.role ? [entry.role] : []);
    return new Set(roles).size === roles.length;
  }, 'Color roles must be unique.'
  ),
}).strict();
export const fontComponentSchema = z.object({
  ...componentShape, type: z.literal('font'), mode: z.enum(['single', 'pairing']).optional(),
  entries: z.array(fontEntrySchema).min(1).max(3).refine(entries =>
    new Set(entries.map(entry => entry.key.toLowerCase())).size === entries.length
    && new Set(entries.map(entry => entry.role)).size === entries.length
    && entries.some(entry => entry.role === 'body'),
    'Use unique font keys and roles, with a body font.'),
}).strict();
export const instructionComponentSchema = z.object({
  ...componentShape, ...namedMetadataShape, type: z.literal('instruction'),
  key: resourceKeySchema, content: instructionTextSchema,
}).strict();
export const configurationComponentSchema = z.object({
  ...componentShape, type: z.literal('configuration'), items: configurationItemsSchema,
  aiInstructions: z.string().max(2048).optional(),
}).strict();
export const componentSchema = z.discriminatedUnion('type', [
  fileComponentSchema, folderComponentSchema, paletteComponentSchema, instructionComponentSchema, fontComponentSchema,
  configurationComponentSchema,
]).superRefine((component, ctx) => {
  if (component.type === 'font' && (component.mode === 'single'
    ? component.entries.length !== 1
    : !component.entries.some(entry => entry.role === 'heading'))) {
    ctx.addIssue({ code: 'custom', message: 'Single fonts use one body entry; pairings require heading and body entries.' });
  }
  if (component.type === 'palette' && component.mode === 'design') {
    if (component.entries.length < 1 || component.entries.length > 9) {
      ctx.addIssue({ code: 'custom', message: 'Color combinations contain one to nine colors.' });
    }
    if (component.entries.some(entry => entry.key.toLowerCase() === '$scheme')) {
      ctx.addIssue({ code: 'custom', message: 'Reserved scheme reference.' });
    }
  }
});
export type Component = z.infer<typeof componentSchema>;
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;
