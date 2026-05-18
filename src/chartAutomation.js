export const DEFAULT_CHART_CONFIG_PATH = ".csvzall/charts.json";

export function normalizeVaultPath(path) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

export function parseChartConfigText(text) {
  const parsed = JSON.parse(text);
  const charts = Array.isArray(parsed?.charts) ? parsed.charts : [];
  return charts
    .filter((chart) => chart && typeof chart === "object")
    .map((chart) => ({
      id: typeof chart.id === "string" ? chart.id : "",
      type: typeof chart.type === "string" ? chart.type : "",
      input: typeof chart.input === "string" ? normalizeVaultPath(chart.input) : "",
      output: typeof chart.output === "string" ? normalizeVaultPath(chart.output) : "",
      runOnSave: chart.runOnSave === true,
    }))
    .filter((chart) => chart.id && chart.input);
}

export function matchingRunOnSaveCharts(charts, csvPath) {
  const normalized = normalizeVaultPath(csvPath);
  if (!normalized.toLowerCase().endsWith(".csv")) {
    return [];
  }
  if (charts.some((chart) => chart.output && chart.output === normalized)) {
    return [];
  }
  return charts.filter((chart) => chart.runOnSave && chart.input === normalized);
}

export function outputChartsForCsv(charts, csvPath) {
  const normalized = normalizeVaultPath(csvPath);
  return charts.filter((chart) => chart.input === normalized && chart.output);
}

export class ChartRunScheduler {
  constructor({ delayMs = 500, runner, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    this.delayMs = delayMs;
    this.runner = runner;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timers = new Map();
    this.running = new Set();
    this.queued = new Map();
  }

  schedule(inputPath, chartIds) {
    const key = normalizeVaultPath(inputPath);
    const ids = Array.from(new Set(chartIds)).sort();
    const existing = this.timers.get(key);
    if (existing !== undefined) {
      this.clearTimeoutFn(existing);
    }
    this.timers.set(
      key,
      this.setTimeoutFn(() => void this.fire(key, ids), this.delayMs),
    );
  }

  async fire(inputPath, chartIds) {
    const key = normalizeVaultPath(inputPath);
    this.timers.delete(key);
    const ids = Array.from(new Set(chartIds)).sort();
    if (this.running.has(key)) {
      const queuedIds = this.queued.get(key) ?? [];
      this.queued.set(key, Array.from(new Set([...queuedIds, ...ids])).sort());
      return;
    }

    this.running.add(key);
    try {
      await this.runner(key, ids);
    } finally {
      this.running.delete(key);
      const queuedIds = this.queued.get(key);
      if (queuedIds) {
        this.queued.delete(key);
        await this.fire(key, queuedIds);
      }
    }
  }

  clear() {
    for (const timer of this.timers.values()) {
      this.clearTimeoutFn(timer);
    }
    this.timers.clear();
    this.queued.clear();
  }
}
