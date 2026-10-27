import { z } from 'zod';
import { configIdSchema } from './identifiers.js';

export const querySchema = z.string().trim().min(1).max(256).refine(
  value => /[\p{L}\p{N}]/u.test(value), 'Query must contain letters or numbers.',
);
export const searchInputSchema = z.object({
  query: z.string().describe('Keywords, filename, ID, name or alias; at most 256 characters. Chinese needs matching Chinese metadata.'),
}).strict();
export const indexDiagnosticSchema = z.object({
  componentId: configIdSchema,
  code: z.enum(['INDEX_NOT_READY', 'INDEX_STALE', 'INDEX_INVALID', 'INDEX_PARTIAL', 'INDEX_REFRESH_FAILED']),
  message: z.string().max(512), builtAt: z.string().datetime().optional(),
  errors: z.number().int().nonnegative().optional(), skipped: z.number().int().nonnegative().optional(),
}).strict();
export const searchItemSchema = z.object({
  ref: z.string().max(1090), key: z.string().max(1024), name: z.string().max(256),
  type: z.enum(['file', 'color', 'instruction', 'font', 'palette', 'font-scheme', 'configuration']), componentId: configIdSchema,
  componentName: z.string().max(256), reasons: z.array(z.string().max(64)).max(12),
  value: z.string().regex(/^#[0-9A-F]{6}$/).optional(),
}).strict();
export const searchOutputSchema = z.object({
  items: z.array(searchItemSchema).max(10), total: z.number().int().nonnegative(),
  truncated: z.boolean(), diagnostics: z.array(indexDiagnosticSchema).max(512),
}).strict();
export type IndexDiagnostic = z.infer<typeof indexDiagnosticSchema>;
export type SearchItem = z.infer<typeof searchItemSchema>;
export type SearchResult = z.infer<typeof searchOutputSchema>;
