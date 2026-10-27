import { z } from 'zod';
import { configIdSchema, isLocalRef, referenceLabelSchema } from './identifiers.js';

export const relativePathSchema = z.string().min(1).max(1024).refine(
  value => value === value.trim() && isLocalRef(value), 'Invalid relative file path.',
);
export const folderEntrySchema = z.object({
  relativePath: relativePathSchema, key: z.string().min(1).max(1024),
  name: referenceLabelSchema, extension: z.string().max(256),
}).strict();
export const scanIssueSchema = z.object({
  path: z.string().max(1024), code: z.string().max(64),
}).strict();
export const refreshReportSchema = z.object({
  status: z.enum(['ready', 'partial', 'failed']),
  attemptedAt: z.string().datetime(), files: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(), errors: z.number().int().nonnegative(),
  issues: z.array(scanIssueSchema).max(20),
}).strict();
export const folderSnapshotSchema = z.object({
  indexVersion: z.literal(1), generation: z.string().uuid(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRoot: z.string().min(1).max(32767), builtAt: z.string().datetime(),
  status: z.enum(['ready', 'partial']),
  entries: z.array(folderEntrySchema).max(100000).refine(
    entries => new Set(entries.map(entry => entry.relativePath)).size === entries.length,
    'Duplicate relative path in index.',
  ),
}).strict();
export const folderIndexSchema = z.object({
  schemaVersion: z.literal(1), componentId: configIdSchema,
  snapshot: folderSnapshotSchema.nullable(), lastRefresh: refreshReportSchema,
}).strict();
export type FolderEntry = z.infer<typeof folderEntrySchema>;
export type FolderSnapshot = z.infer<typeof folderSnapshotSchema>;
export type FolderIndex = z.infer<typeof folderIndexSchema>;
export type RefreshReport = z.infer<typeof refreshReportSchema>;
