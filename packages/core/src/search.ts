import path from 'node:path';
import { type Component, type SearchItem } from '@dockyard/shared';
import { type CatalogResource } from './resources.js';

const exact = (value: string) => value.trim().toLowerCase();
const words = (value: string) => exact(value).replace(/[\s_\-./\\:]+/g, ' ').trim();
type Field = { name: string; text: string; weight: number };
export type SearchRow = {
  entry: CatalogResource; componentName: string; fields: Field[];
  ref: string; key: string; aliases: string[];
};
export function prepareSearch(entry: CatalogResource, component: Component): SearchRow {
  const resource = entry.resource;
  const fields: Field[] = [
    { name: 'key', text: resource.key, weight: 8 },
    { name: 'name', text: resource.name, weight: 7 },
    { name: 'alias', text: resource.aliases.join(' '), weight: 8 },
    { name: 'tag', text: resource.tags.join(' '), weight: 6 },
    { name: 'path', text: entry.relativePath ?? (resource.type === 'file' ? path.basename(resource.source.path) : ''), weight: 4 },
    { name: 'extension', text: entry.extension ?? '', weight: 3 },
    { name: 'component', text: component.name + ' ' + component.id, weight: 2 },
    { name: 'design', text: resource.type === 'font' ? resource.family + ' ' + resource.role
      : resource.type === 'color' ? resource.role ?? '' : '', weight: 6 },
    { name: 'description', text: (resource.description ?? '') + ' ' + (component.description ?? ''), weight: 1 },
  ];
  return {
    entry, componentName: component.name,
    fields: fields.map(field => ({ ...field, text: words(field.text) })).filter(field => field.text),
    ref: exact(resource.ref), key: exact(resource.key), aliases: resource.aliases.map(exact),
  };
}
type Match = { row: SearchRow; exactRank: number; covered: number; strength: number; reasons: string[] };
function compare(a: Match, b: Match): number {
  return b.exactRank - a.exactRank || b.covered - a.covered || b.strength - a.strength
    || (a.row.entry.resource.ref < b.row.entry.resource.ref ? -1 : a.row.entry.resource.ref > b.row.entry.resource.ref ? 1 : 0);
}
export function searchRows(rows: Iterable<SearchRow[]>, query: string): { items: SearchItem[]; total: number } {
  const raw = exact(query);
  const tokens = [...new Set(words(query).split(' ').filter(Boolean))];
  const best: Match[] = [];
  let total = 0;
  for (const group of rows) for (const row of group) {
    const exactRank = row.ref === raw ? 3 : row.key === raw ? 2 : row.aliases.includes(raw) ? 1 : 0;
    const reasons = new Set<string>();
    if (exactRank) reasons.add(exactRank === 3 ? 'exact_ref' : exactRank === 2 ? 'exact_key' : 'exact_alias');
    let covered = 0;
    let strength = 0;
    for (const token of tokens) {
      let weight = 0;
      for (const field of row.fields) if (field.text.includes(token)) {
        weight = Math.max(weight, field.weight);
        reasons.add(field.name);
      }
      if (weight) { covered++; strength += weight; }
    }
    if (!exactRank && !covered) continue;
    total++;
    const match = { row, exactRank, covered, strength, reasons: [...reasons] };
    const position = best.findIndex(existing => compare(match, existing) < 0);
    if (position >= 0) best.splice(position, 0, match);
    else if (best.length < 10) best.push(match);
    if (best.length > 10) best.pop();
  }
  return {
    total,
    items: best.map(({ row, reasons }) => {
      const { ref, key, name, type, componentId } = row.entry.resource;
      return {
        ref, key, name, type, componentId, componentName: row.componentName, reasons,
        ...(row.entry.resource.type === 'color' ? { value: row.entry.resource.value } : {}),
      };
    }),
  };
}
