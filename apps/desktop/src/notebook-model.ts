import { z } from 'zod';

const coordinate = z.number().finite().min(-100000).max(100000);
const noteId = z.string().uuid();
export const notebookSchema = z.object({
  version: z.literal(1),
  notes: z.array(z.object({
    id: noteId, title: z.string().max(200), body: z.string().max(10000),
    x: coordinate, y: coordinate, updatedAt: z.string().datetime(),
  }).strict()).max(200),
  links: z.array(z.object({ id: noteId, source: noteId, target: noteId, label: z.string().max(120) }).strict()).max(2000),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.notes.map(note => note.id));
  const pairs = new Set<string>();
  const linkIds = new Set<string>();
  if (ids.size !== value.notes.length) ctx.addIssue({ code: 'custom', message: '笔记 ID 重复。' });
  for (const link of value.links) {
    const pair = [link.source, link.target].sort().join(':');
    if (!ids.has(link.source) || !ids.has(link.target) || link.source === link.target || pairs.has(pair) || linkIds.has(link.id)) {
      ctx.addIssue({ code: 'custom', message: '连线无效或重复。' });
    }
    pairs.add(pair); linkIds.add(link.id);
  }
  if (JSON.stringify(value).length > 800000) ctx.addIssue({ code: 'custom', message: '记事本内容过多。' });
});
export type Notebook = z.infer<typeof notebookSchema>;
export type Note = Notebook['notes'][number];
export const emptyNotebook = (): Notebook => ({ version: 1, notes: [], links: [] });
