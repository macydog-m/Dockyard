import { z } from 'zod';
import { configIdSchema, isLocalRef } from './identifiers.js';

const keySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
  .refine(key => !['__proto__', 'constructor', 'prototype'].includes(key), 'Reserved configuration key.');
// Targets are stable component IDs or exact, canonical resource refs, never names or paths.
export const configurationTargetSchema = z.string().min(1).max(1090).refine(value => {
  const parts = value.split('::');
  return configIdSchema.safeParse(parts[0]).success && (parts.length === 1 || (parts.length === 2 && isLocalRef(parts[1])));
}, 'Use a component ID or exact componentId::localRef.');
export const configurationValueSchema = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
export const configurationValuesSchema = z.record(keySchema, configurationValueSchema)
  .refine(values => Object.keys(values).length <= 64, 'At most 64 configuration values.');
const common = {
  key: keySchema, label: z.string().trim().min(1).max(128),
  description: z.string().max(1024).optional(), aiInstructions: z.string().max(1024).optional(),
};
const optionShape = { value: z.string().min(1).max(256), label: z.string().min(1).max(128) };
const uniqueOptions = (options: { value: string }[]) => new Set(options.map(option => option.value)).size === options.length;
export const configItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('resource'), target: configurationTargetSchema, control: z.literal('toggle').default('toggle'), default: z.boolean().default(true) }).strict(),
  z.object({ ...common, kind: z.literal('resource-select'), control: z.literal('select').default('select'), default: z.string().max(256).nullable(),
    options: z.array(z.object({ ...optionShape, target: configurationTargetSchema }).strict()).min(1).max(100).refine(uniqueOptions, 'Duplicate options.') }).strict(),
  z.object({ ...common, kind: z.literal('number'), control: z.enum(['slider', 'number']).default('number'), default: z.number().finite(),
    min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().finite().positive().optional() }).strict(),
  z.object({ ...common, kind: z.literal('boolean'), control: z.enum(['toggle', 'checkbox']).default('toggle'), default: z.boolean() }).strict(),
  z.object({ ...common, kind: z.literal('text'), control: z.enum(['text', 'color']).default('text'), default: z.string().max(4096) }).strict(),
  z.object({ ...common, kind: z.literal('select'), control: z.literal('select').default('select'), default: z.string().max(256),
    options: z.array(z.object(optionShape).strict()).min(1).max(100).refine(uniqueOptions, 'Duplicate options.') }).strict(),
]).superRefine((item, ctx) => {
  if (item.kind === 'number') {
    if (item.min !== undefined && item.max !== undefined && item.min > item.max) ctx.addIssue({ code: 'custom', message: 'Minimum exceeds maximum.' });
    if (item.control === 'slider' && (item.min === undefined || item.max === undefined || item.step === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Sliders require min, max and step.' });
    }
  }
  if (!validConfigurationValue(item, item.default)) ctx.addIssue({ code: 'custom', message: 'Invalid default value, range or step.' });
});
export type ConfigItem = z.infer<typeof configItemSchema>;
export type ConfigurationValues = z.infer<typeof configurationValuesSchema>;

export function validConfigurationValue(item: ConfigItem, value: unknown): boolean {
  if (item.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (item.min !== undefined && value < item.min) || (item.max !== undefined && value > item.max)) return false;
    if (item.step !== undefined) {
      const base = item.min ?? 0, steps = (value - base) / item.step;
      const nearest = base + Math.round(steps) * item.step;
      const tolerance = Number.EPSILON * Math.max(Math.abs(value), Math.abs(base), Math.abs(nearest), Number.MIN_VALUE) * 8;
      if (!Number.isFinite(steps) || !Number.isFinite(nearest) || Math.abs(value - nearest) > tolerance) return false;
    }
    return true;
  }
  if (item.kind === 'boolean' || item.kind === 'resource') return typeof value === 'boolean';
  if (item.kind === 'resource-select' && value === null) return true;
  if (item.kind === 'select' || item.kind === 'resource-select') return typeof value === 'string' && item.options.some(option => option.value === value);
  return typeof value === 'string' && value.length <= 4096 && (item.control !== 'color' || /^#[0-9a-f]{6}$/i.test(value));
}

export const configurationItemsSchema = z.array(configItemSchema).max(64)
  .refine(items => new Set(items.map(item => item.key)).size === items.length, 'Duplicate configuration keys.');
export const configurationPresetSchema = z.object({
  id: configIdSchema, name: z.string().trim().min(1).max(128), values: configurationValuesSchema,
  items: configurationItemsSchema.optional(),
}).strict();
export const configurationStateSchema = z.object({
  activePresetId: configIdSchema, presets: z.array(configurationPresetSchema).min(1).max(32),
}).strict().refine(state => new Set(state.presets.map(preset => preset.id)).size === state.presets.length
  && new Set(state.presets.map(preset => preset.name)).size === state.presets.length
  && state.presets.some(preset => preset.id === state.activePresetId), 'Invalid active preset or duplicate presets.');
export type ConfigurationState = z.infer<typeof configurationStateSchema>;
export function getConfigurationState(states: Record<string, ConfigurationState> | undefined, componentId: string): ConfigurationState | undefined {
  return states && Object.hasOwn(states, componentId) ? states[componentId] : undefined;
}
export function configurationDefaults(items: ConfigItem[]): ConfigurationValues {
  return Object.fromEntries(items.map(item => [item.key, item.default]));
}
export function initialConfigurationState(): ConfigurationState {
  return { activePresetId: 'default', presets: [{ id: 'default', name: 'Default', values: {} }] };
}
// Unknown keys and incompatible values fail closed; new items obtain their declared defaults.
export function resolveConfigurationValues(items: ConfigItem[], values: unknown): ConfigurationValues {
  const parsed = configurationValuesSchema.parse(values);
  for (const [key, value] of Object.entries(parsed)) {
    const item = items.find(item => item.key === key);
    if (!item || !validConfigurationValue(item, value)) throw new Error('Invalid configuration value: ' + key);
  }
  return { ...configurationDefaults(items), ...parsed };
}
export function configurationTargets(items: ConfigItem[]): string[] {
  return [...new Set(items.flatMap(item => item.kind === 'resource' ? [item.target]
    : item.kind === 'resource-select' ? item.options.map(option => option.target) : []))];
}
export function selectedConfigurationTargets(items: ConfigItem[], values: ConfigurationValues): string[] {
  return [...new Set(items.flatMap(item => item.kind === 'resource' ? values[item.key] === true ? [item.target] : []
    : item.kind === 'resource-select' ? item.options.filter(option => option.value === values[item.key]).map(option => option.target) : []))];
}
export const configurationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('saveItems'), id: configIdSchema, items: configurationItemsSchema }).strict(),
  z.object({ type: z.literal('saveValues'), presetId: configIdSchema, values: configurationValuesSchema }).strict(),
  z.object({ type: z.literal('createPreset'), id: configIdSchema, name: z.string().trim().min(1).max(128), copyFrom: configIdSchema.optional(), items: configurationItemsSchema.optional() }).strict(),
  z.object({ type: z.literal('renamePreset'), id: configIdSchema, name: z.string().trim().min(1).max(128) }).strict(),
  z.object({ type: z.literal('deletePreset'), id: configIdSchema }).strict(),
  z.object({ type: z.literal('switchPreset'), id: configIdSchema }).strict(),
]);
export type ConfigurationAction = z.infer<typeof configurationActionSchema>;

// MCP returns applied items only: no inactive targets or unused options, and no duplicate value map.
export const appliedConfigItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('resource'), target: configurationTargetSchema }).strict(),
  z.object({ ...common, kind: z.literal('resource-select'), target: configurationTargetSchema, value: optionShape.value, choiceLabel: optionShape.label }).strict(),
  z.object({ ...common, kind: z.literal('number'), value: z.number().finite(), min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().finite().positive().optional() }).strict(),
  z.object({ ...common, kind: z.literal('boolean'), value: z.boolean() }).strict(),
  z.object({ ...common, kind: z.literal('text'), value: z.string().max(4096) }).strict(),
  z.object({ ...common, kind: z.literal('select'), value: optionShape.value, choiceLabel: optionShape.label }).strict(),
]);
export type AppliedConfigItem = z.infer<typeof appliedConfigItemSchema>;

export function appliedConfigurationItems(items: ConfigItem[], values: ConfigurationValues, visible: (target: string) => boolean = () => true): AppliedConfigItem[] {
  return items.flatMap((item): AppliedConfigItem[] => {
    const { key, label, description, aiInstructions } = item;
    const base = { key, label, ...(description === undefined ? {} : { description }), ...(aiInstructions === undefined ? {} : { aiInstructions }) };
    const value = values[key];
    if (item.kind === 'resource') return value === true && visible(item.target) ? [{ ...base, kind: item.kind, target: item.target }] : [];
    if (item.kind === 'select' || item.kind === 'resource-select') {
      const option = item.options.find(option => option.value === value);
      if (!option) return [];
      if ('target' in option && typeof option.target === 'string') return visible(option.target) ? [{ ...base, kind: 'resource-select', value: option.value, choiceLabel: option.label, target: option.target }] : [];
      return [{ ...base, kind: 'select', value: option.value, choiceLabel: option.label }];
    }
    if (item.kind === 'number') return [{ ...base, kind: item.kind, value: value as number,
      ...(item.min === undefined ? {} : { min: item.min }), ...(item.max === undefined ? {} : { max: item.max }), ...(item.step === undefined ? {} : { step: item.step }) }];
    if (item.kind === 'boolean') return [{ ...base, kind: item.kind, value: value as boolean }];
    return [{ ...base, kind: 'text', value: value as string }];
  });
}
