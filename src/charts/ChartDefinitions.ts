import type { DataAdapter } from "obsidian";
import type { ChartDefinition, ChartFormPayload } from "./chart-form.mjs";
import { resolveChartPath } from "../chartAutomation.js";
import { directConfig } from "../exports/paths.js";
import { parentVaultPath } from "../utils/paths.js";
import validateObject, { isArray, isString } from "../utils/validateObject.js";

interface ChartConfig { charts: ChartDefinition[]; [key: string]: unknown }
export interface SavedChart { configPath: string; definition: ChartDefinition; source: string }

const hasChartList = validateObject({ charts: isArray });
const hasChartFields = validateObject({
  id: (value): value is string => isString(value) && value.length > 0,
  input: isString,
  type: isString,
});

export function parseChartDefinitions(text: string, path: string): ChartConfig {
  const value: unknown = JSON.parse(text);
  if (!hasChartList(value)) {
    throw new Error(`Invalid charts array in ${path}.`);
  }
  const ids = new Set<string>();
  for (const item of value.charts) {
    if (!hasChartFields(item) || ids.has(item.id)) {
      throw new Error(`Invalid or duplicate chart definition in ${path}.`);
    }
    ids.add(item.id);
  }
  return value as ChartConfig;
}
const parse = parseChartDefinitions;

/** Raw configuration writes preserve fields the settings UI does not understand. */
export class ChartDefinitions {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly adapter: DataAdapter, private readonly changed?: (path: string) => Promise<void>, private readonly localOnly = false) {}

  async list(paths: string[]): Promise<SavedChart[]> {
    const entries: SavedChart[] = [];
    for (const configPath of paths) {
      const config = parse(await this.adapter.read(configPath), configPath);
      for (const definition of config.charts) {
        const source = resolveChartPath(configPath, definition.input);
        if (!this.localOnly || directConfig(source, "charts") === configPath) entries.push({ configPath, definition, source });
      }
    }
    return entries;
  }

  private mutate(path: string, update: (config: ChartConfig) => void, validate?: (temporary: string) => Promise<void>, commit = true, cancelled: () => boolean = () => false): Promise<void> {
    const work = this.writes.catch(() => {}).then(async () => {
      const saved = await this.adapter.read(path);
      const config = parse(saved, path);
      update(config);
      const text = `${JSON.stringify(config, null, 2)}\n`;
      if (text === saved) return;
      const temporary = `${parentVaultPath(path)}/.charts-${crypto.randomUUID()}.json`;
      try {
        await this.adapter.write(temporary, text);
        if (await this.adapter.read(temporary) !== text) throw new Error("Could not verify chart configuration.");
        await validate?.(temporary);
        if (!commit) return;
        if (cancelled()) return;
        if (await this.adapter.read(path) !== saved) throw new Error(`${path} changed while saving. Please try again.`);
        // Obsidian's rename cannot replace an existing configuration.
        await this.adapter.process(path, current => {
          if (cancelled()) return current;
          if (current !== saved) throw new Error(`${path} changed while saving. Please try again.`);
          return text;
        });
        if (!cancelled() && await this.adapter.read(path) !== text) throw new Error("Could not verify chart configuration.");
        if (!cancelled()) await this.changed?.(path);
      } finally {
        if (await this.adapter.exists(temporary)) await this.adapter.remove(temporary);
      }
    });
    this.writes = work;
    return work;
  }

  remove(source: string, paths: string[]): Promise<void> {
    return paths.reduce((previous, path) => previous.then(() => this.mutate(path, config => {
      config.charts = config.charts.filter(entry => resolveChartPath(path, entry.input) !== source);
    })), Promise.resolve());
  }

  removeChart(chart: SavedChart, cancelled?: () => boolean): Promise<void> {
    return this.mutate(chart.configPath, config => {
      const index = config.charts.findIndex(entry => entry.id === chart.definition.id);
      if (index < 0 || JSON.stringify(config.charts[index]) !== JSON.stringify(chart.definition)) {
        throw new Error("The chart changed. Reopen Configure and try again.");
      }
      config.charts.splice(index, 1);
    }, undefined, true, cancelled);
  }

  update(chart: SavedChart, payload: ChartFormPayload, validate: (temporary: string) => Promise<void>): Promise<void> {
    return this.change(chart, payload, validate);
  }

  async preview(chart: SavedChart, payload: ChartFormPayload, render: (temporary: string) => Promise<void>): Promise<{ svg?: string; markdown?: string }> {
    const name = `.preview-${crypto.randomUUID()}.${payload.type === "markdown-table" ? "md" : "svg"}`;
    const output = `${parentVaultPath(chart.configPath)}/${name}`;
    let text = "";
    try {
      await this.change(chart, { ...payload, output: `.csvzall/${name}` }, async temporary => {
        await render(temporary);
        text = await this.adapter.read(output);
      }, false);
      return payload.type === "markdown-table" ? { markdown: text } : { svg: text };
    } finally {
      if (await this.adapter.exists(output)) await this.adapter.remove(output);
    }
  }

  private change(chart: SavedChart, payload: ChartFormPayload, validate: (temporary: string) => Promise<void>, commit = true): Promise<void> {
    return this.mutate(chart.configPath, config => {
      const entry = config.charts.find(candidate => candidate.id === chart.definition.id);
      if (!entry || JSON.stringify(entry) !== JSON.stringify(chart.definition)) throw new Error("The chart changed. Reopen Configure and try again.");
      const options: Record<string, unknown> = { ...entry.options };
      const keys = payload.type === "heatmap" ? ["title", "date", "value", "label", "orientation", "start", "end", "lookback", "sql"] :
        payload.type === "bar" ? ["title", "label", "value", "presentation", "colorScheme", "sql"] :
        payload.type === "line" ? ["title", "x", "y", "series", "colorScheme", "sql"] : ["columns", "sql"];
      for (const key of keys as Array<keyof ChartFormPayload>) {
        const value = payload[key];
        if (key === "sql" && payload.type !== "markdown-table" && !value && !payload.clearSql) continue;
        if (value === "") delete options[key];
        else options[key] = value;
      }
      if (payload.type !== "markdown-table") {
        const previousValues: unknown[] = Array.isArray(entry.options?.values) ? entry.options.values : [];
        const scalarKey = payload.type === "line" ? "y" : "value";
        const scalar = payload[scalarKey];
        const columns = payload.values.length ? payload.values : scalar ? [scalar] : [];
        // Keep metadata for retained columns; the form represents every series.
        if (payload.values.length || previousValues.length) {
          const values = [...columns.map(column => {
            const previous = previousValues.find(value =>
              !!value && typeof value === "object" && "column" in value && value.column === column);
            return { ...(previous && typeof previous === "object" ? previous : {}), column };
          })];
          options.values = values;
          delete options[scalarKey];
          if (values.length === 0) delete options.values;
        } else delete options.values;
      }
      Object.assign(entry, { output: payload.output, runOnSave: payload.runOnSave, options });
    }, validate, commit);
  }
}
