import type { DataAdapter } from "obsidian";
import type { ChartDefinition, ChartFormPayload } from "./chart-form.mjs";
import { resolveChartPath } from "../chartAutomation.js";

interface ChartConfig { charts: ChartDefinition[]; [key: string]: unknown }
export interface SavedChart { configPath: string; definition: ChartDefinition; source: string }

function parse(text: string, path: string): ChartConfig {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || !("charts" in value) || !Array.isArray(value.charts)) {
    throw new Error(`Invalid charts array in ${path}.`);
  }
  const ids = new Set<string>();
  for (const item of value.charts as unknown[]) {
    if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
      !("input" in item) || typeof item.input !== "string" || !("type" in item) || typeof item.type !== "string") {
      throw new Error(`Invalid or duplicate chart definition in ${path}.`);
    }
    ids.add(item.id);
  }
  return value as ChartConfig;
}

/** Raw configuration writes preserve fields the settings UI does not understand. */
export class ChartDefinitions {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly adapter: DataAdapter) {}

  async list(paths: string[]): Promise<SavedChart[]> {
    const entries: SavedChart[] = [];
    for (const configPath of paths) {
      const config = parse(await this.adapter.read(configPath), configPath);
      for (const definition of config.charts) entries.push({ configPath, definition, source: resolveChartPath(configPath, definition.input) });
    }
    return entries;
  }

  private mutate(path: string, update: (config: ChartConfig) => void, validate?: (temporary: string) => Promise<void>): Promise<void> {
    const work = this.writes.catch(() => {}).then(async () => {
      const saved = await this.adapter.read(path);
      const config = parse(saved, path);
      update(config);
      const text = `${JSON.stringify(config, null, 2)}\n`;
      if (text === saved) return;
      const temporary = `${path.slice(0, path.lastIndexOf("/"))}/.charts-${crypto.randomUUID()}.json`;
      try {
        await this.adapter.write(temporary, text);
        if (await this.adapter.read(temporary) !== text) throw new Error("Could not verify chart configuration.");
        await validate?.(temporary);
        if (await this.adapter.read(path) !== saved) throw new Error(`${path} changed while saving. Please try again.`);
        // Obsidian's rename cannot replace an existing configuration.
        await this.adapter.process(path, current => {
          if (current !== saved) throw new Error(`${path} changed while saving. Please try again.`);
          return text;
        });
        if (await this.adapter.read(path) !== text) throw new Error("Could not verify chart configuration.");
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

  removeChart(chart: SavedChart): Promise<void> {
    return this.mutate(chart.configPath, config => {
      const index = config.charts.findIndex(entry => entry.id === chart.definition.id);
      if (index < 0 || JSON.stringify(config.charts[index]) !== JSON.stringify(chart.definition)) {
        throw new Error("The chart changed. Reopen Configure and try again.");
      }
      config.charts.splice(index, 1);
    });
  }

  update(chart: SavedChart, payload: ChartFormPayload, validate: (temporary: string) => Promise<void>): Promise<void> {
    return this.mutate(chart.configPath, config => {
      const entry = config.charts.find(candidate => candidate.id === chart.definition.id);
      if (!entry || JSON.stringify(entry) !== JSON.stringify(chart.definition)) throw new Error("The chart changed. Reopen Configure and try again.");
      const options: Record<string, unknown> = { ...entry.options };
      const keys = payload.type === "heatmap" ? ["title", "date", "value", "label", "orientation", "start", "end", "lookback"] :
        payload.type === "bar" ? ["title", "label", "value", "presentation", "colorScheme"] :
        payload.type === "line" ? ["title", "x", "y", "series", "colorScheme"] : ["columns", "sql"];
      for (const key of keys as Array<keyof ChartFormPayload>) {
        const value = payload[key];
        if (value === "") delete options[key];
        else options[key] = value;
      }
      if (payload.type !== "markdown-table") {
        const previousValues: unknown[] = Array.isArray(entry.options?.values) ? entry.options.values : [];
        const scalarKey = payload.type === "line" ? "y" : "value";
        const scalar = payload[scalarKey];
        const columns = payload.values.length ? payload.values : scalar ? [scalar] : [];
        // The form edits two slots. Keep every series it cannot represent,
        // including metadata on a single series serialized by the form as scalar.
        if (payload.values.length || previousValues.length) {
          const values = [...columns.map(column => {
            const previous = previousValues.find(value =>
              !!value && typeof value === "object" && "column" in value && value.column === column);
            return { ...(previous && typeof previous === "object" ? previous : {}), column };
          }), ...previousValues.slice(2)];
          options.values = values;
          delete options[scalarKey];
          if (values.length === 0) delete options.values;
        } else delete options.values;
      }
      Object.assign(entry, { output: payload.output, runOnSave: payload.runOnSave, options });
    }, validate);
  }
}
