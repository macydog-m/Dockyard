import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isVerifiedGetEvent, isVerifiedSearchEvent, isVerifiedContextEvent } from '../scripts/verify-codex-mcp.mjs';

const resource = {
  key: '002511', ref: 'demo::002511', type: 'file', kind: 'file',
  availability: 'available', metadata: { demo: true },
  source: { path: fileURLToPath(new URL('../examples/demo-data/files/002511.txt', import.meta.url)) },
};
const eventFor = (result, item = {}) => ({
  type: 'item.completed',
  item: { type: 'mcp_tool_call', server: 'dockyard', tool: 'get', status: 'completed', result, ...item },
});

test('Codex verification accepts completed get results in both structured-result spellings', () => {
  assert.equal(isVerifiedGetEvent(eventFor({ structuredContent: { resource } })), true);
  assert.equal(isVerifiedGetEvent(eventFor({ structured_content: { resource } })), true);
});

test('Codex verification rejects failed, legacy, wrong-resource and text-only events', () => {
  for (const event of [
    eventFor({ structuredContent: { resource }, isError: true }),
    eventFor({ structured_content: { resource }, is_error: true }),
    eventFor({ structuredContent: { resource } }, { tool: 'get_asset' }),
    eventFor({ structuredContent: { resource } }, { server: 'other' }),
    eventFor({ structuredContent: { resource } }, { status: 'failed' }),
    eventFor({ structuredContent: { resource } }, { error: 'failed' }),
    eventFor({ structuredContent: { resource: { ...resource, key: '2511' } } }),
    eventFor({ structuredContent: { resource: { ...resource, availability: 'missing' } } }),
    eventFor({ structuredContent: { resource: { ...resource, source: { path: 'wrong.txt' } } } }),
    eventFor({ content: [{ type: 'text', text: JSON.stringify({ resource }) }] }),
    { type: 'item.completed', item: { type: 'agent_message', text: 'get succeeded' } },
    { type: 'item.started', item: eventFor({ structuredContent: { resource } }).item },
  ]) {
    assert.equal(Boolean(isVerifiedGetEvent(event)), false);
  }
});

test('Codex search verification requires a completed structured color result and rejects text claims', () => {
  const output = { items: [{
    ref: 'palette::warm-orange', key: 'warm-orange', name: 'Warm Orange', type: 'color',
    componentId: 'palette', componentName: 'Palette', reasons: ['exact_alias'], value: '#E98C3A',
  }], total: 1, truncated: false, diagnostics: [] };
  for (const spelling of ['structuredContent', 'structured_content']) {
    assert.equal(isVerifiedSearchEvent(eventFor({ [spelling]: output }, { tool: 'search' })), true);
  }
  for (const event of [
    eventFor({ structuredContent: output }),
    eventFor({ structuredContent: output, isError: true }, { tool: 'search' }),
    eventFor({ structuredContent: output }, { tool: 'search', status: 'failed' }),
    eventFor({ structuredContent: { ...output, items: [{ ...output.items[0], value: '#000000' }] } }, { tool: 'search' }),
    eventFor({ content: [{ type: 'text', text: JSON.stringify(output) }] }, { tool: 'search' }),
    eventFor({ structuredContent: { ...output, items: [] } }, { tool: 'search' }),
  ]) assert.equal(Boolean(isVerifiedSearchEvent(event)), false);
});

test('Codex context verification requires the expected workspace and safe structured summaries', () => {
  const output = {
    workspace: { id: 'default', name: 'Demo', revision: 1 },
    components: [
      { id: 'demo', name: 'Demo', type: 'file', resourceCount: 1, descriptionTruncated: false },
      { id: 'palette', name: 'Palette', type: 'palette', resourceCount: 2, descriptionTruncated: false },
      { id: 'fx-rules', name: 'Rules', type: 'instruction', resourceCount: 1, descriptionTruncated: false },
    ], total: 3, truncated: false, diagnostics: [], diagnosticTotal: 0,
  };
  for (const spelling of ['structuredContent', 'structured_content']) {
    assert.equal(isVerifiedContextEvent(eventFor({ [spelling]: output }, { tool: 'context' })), true);
  }
  for (const event of [
    eventFor({ structuredContent: output }),
    eventFor({ structuredContent: output, is_error: true }, { tool: 'context' }),
    eventFor({ structuredContent: output }, { tool: 'context', status: 'failed' }),
    eventFor({ structuredContent: { ...output, workspace: { ...output.workspace, id: 'wrong' } } }, { tool: 'context' }),
    eventFor({ structuredContent: { ...output, components: output.components.slice(0, 2) } }, { tool: 'context' }),
    eventFor({ structuredContent: { ...output, components: [output.components[0], output.components[0], output.components[2]] } }, { tool: 'context' }),
    eventFor({ structuredContent: { ...output, content: 'SHOULD_NOT_RETURN_RULES' } }, { tool: 'context' }),
    eventFor({ content: [{ type: 'text', text: JSON.stringify(output) }] }, { tool: 'context' }),
  ]) assert.equal(Boolean(isVerifiedContextEvent(event)), false);
});
