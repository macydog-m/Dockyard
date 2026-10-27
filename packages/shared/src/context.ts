import { z } from 'zod';
import { configIdSchema } from './identifiers.js';
import { indexDiagnosticSchema } from './search.js';

export const contextInputSchema = z.object({}).strict();
export const componentSummarySchema = z.object({
  id: configIdSchema, type: z.enum(['folder', 'file', 'palette', 'instruction', 'font', 'configuration']),
  name: z.string().min(1).max(256),
  description: z.string().max(512).optional(),
  descriptionTruncated: z.boolean(),
  schemeRef: z.string().max(1090).optional(),
  currentRef: z.string().max(1090).optional(),
  resourceCount: z.number().int().nonnegative().nullable(),
  index: z.object({
    status: z.enum(['ready', 'partial', 'refresh_failed', 'not_ready', 'stale', 'invalid']),
    builtAt: z.string().datetime().optional(),
    lastRefreshAt: z.string().datetime().optional(),
    snapshotStatus: z.enum(['ready', 'partial']).optional(),
  }).strict().optional(),
}).strict();
export const contextOutputSchema = z.object({
  workspace: z.object({
    id: configIdSchema, name: z.string().min(1).max(256),
    revision: z.number().int().positive(),
    design: z.object({ paletteRef: z.string().max(1090).optional(), fontRef: z.string().max(1090).optional() }).strict().optional(),
  }).strict(),
  components: z.array(componentSummarySchema).max(50),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  diagnostics: z.array(indexDiagnosticSchema).max(50),
  diagnosticTotal: z.number().int().nonnegative(),
}).strict();
export type ComponentSummary = z.infer<typeof componentSummarySchema>;
export type ContextResult = z.infer<typeof contextOutputSchema>;
