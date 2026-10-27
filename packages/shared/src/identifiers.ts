import { z } from 'zod';

export const configIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .refine(value => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value), 'Reserved filename.');
export const referenceLabelSchema = z.string().trim().min(1).max(256)
  .refine(value => !/[\\/:\u0000-\u001f\u007f]/u.test(value) && value !== '.' && value !== '..', 'Use a name, not a path.');
export const resourceKeySchema = referenceLabelSchema.max(128);

export function isLocalRef(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && !/[\\:\u0000-\u001f\u007f]/u.test(value)
    && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}

export const resourceRefSchema = z.string().trim().min(1).max(1090).refine(value => {
  const parts = value.split('::');
  if (parts.length === 2) {
    return configIdSchema.safeParse(parts[0].toLowerCase()).success && isLocalRef(parts[1]);
  }
  if (parts.length !== 1) return false;
  const plain = value.replace(/^id:/i, '');
  return referenceLabelSchema.safeParse(plain).success;
}, 'Use an ID, exact name/alias or componentId::localRef, not an absolute path.');

export const namedMetadataShape = {
  name: referenceLabelSchema,
  description: z.string().max(4096).optional(),
  aliases: z.array(referenceLabelSchema).max(32).default([]),
  tags: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  metadata: z.record(z.string().max(128), z.unknown()).default({}),
};
export const sourceSchema = z.object({
  path: z.string().min(1).max(32767).refine(value => !value.includes('\0'), 'Path contains NUL.'),
}).strict();
export const instructionTextSchema = z.string().min(1).refine(
  value => new TextEncoder().encode(value).length <= 16 * 1024, 'Instruction exceeds 16 KiB.',
);
export const colorValueSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
