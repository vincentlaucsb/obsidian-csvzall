// Shared by the native viewer, WASM viewer, and the Obsidian vendored viewer.
export const HOST_THEME_VARIABLES = [
  '--background-primary', '--background-secondary', '--background-modifier-hover',
  '--background-modifier-border', '--text-normal', '--text-muted', '--text-faint',
  '--text-error', '--text-on-accent', '--interactive-accent', '--font-interface',
];

export function parseHostTheme(data) {
  if (!data || data.source !== 'obsidian-csvzall' || data.type !== 'theme' || data.version !== 1
      || !['light', 'dark'].includes(data.mode) || !data.variables
      || typeof data.variables !== 'object' || Array.isArray(data.variables)) return null;
  const variables = {};
  for (const name of HOST_THEME_VARIABLES) {
    const value = data.variables[name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 2048 || /[;{}<>]|url\s*\(/i.test(value)) return null;
    variables[name] = value.trim();
  }
  return { mode: data.mode, variables };
}

export const HOST_THEME_CSS = `
:root[data-csvzall-host-theme] {
  --popright-disabled-color: var(--text-faint, var(--csvzall-text-muted));
  --popright-danger-color: var(--text-error, #dc2626);
}
:root[data-csvzall-host-theme] [data-popright-theme] {
  color-scheme: inherit;
  --popright-bg: var(--csvzall-background-primary);
  --popright-color: var(--csvzall-text-normal);
  --popright-border: var(--csvzall-border);
  --popright-active-bg: var(--csvzall-background-hover);
  --popright-disabled-color: var(--text-faint, var(--csvzall-text-muted));
  --popright-danger-color: var(--text-error, #dc2626);
}
:root[data-csvzall-host-theme] #grid {
  --ag-font-family: var(--csvzall-font-family);
  --ag-background-color: var(--csvzall-background-primary);
  --ag-foreground-color: var(--csvzall-text-normal);
  --ag-data-color: var(--csvzall-text-normal);
  --ag-header-foreground-color: var(--csvzall-text-normal);
  --ag-secondary-foreground-color: var(--csvzall-text-muted);
  --ag-header-background-color: var(--csvzall-background-secondary);
  --ag-odd-row-background-color: var(--csvzall-background-primary);
  --ag-row-hover-color: var(--csvzall-background-hover);
  --ag-column-hover-color: var(--csvzall-background-hover);
  --ag-selected-row-background-color: color-mix(in srgb, var(--csvzall-accent) 14%, transparent);
  --ag-range-selection-background-color: color-mix(in srgb, var(--csvzall-accent) 14%, transparent);
  --ag-border-color: var(--csvzall-border);
  --ag-secondary-border-color: var(--csvzall-border);
  --ag-row-border-color: var(--csvzall-border);
  --ag-header-column-separator-color: var(--csvzall-border);
  --ag-input-border-color: var(--csvzall-border);
  --ag-input-focus-border-color: var(--csvzall-accent);
  --ag-control-panel-background-color: var(--csvzall-background-secondary);
  --ag-menu-background-color: var(--csvzall-background-primary);
  --ag-tooltip-background-color: var(--csvzall-background-secondary);
  --ag-modal-overlay-background-color: color-mix(in srgb, var(--csvzall-background-primary) 70%, transparent);
  --ag-input-background-color: var(--csvzall-background-primary);
  --ag-input-disabled-background-color: var(--csvzall-background-secondary);
  --ag-disabled-foreground-color: var(--text-faint, var(--csvzall-text-muted));
  --ag-checkbox-checked-color: var(--csvzall-accent);
  --ag-range-selection-border-color: var(--csvzall-accent);
  --ag-active-color: var(--csvzall-accent);
  --ag-alpine-active-color: var(--csvzall-accent);
}
`;

export function installHostTheme(windowRef) {
  const parent = windowRef.parent;
  if (!parent || parent === windowRef) return () => {};
  const doc = windowRef.document;
  const root = doc.documentElement;
  let stylesheet;
  const onMessage = (event) => {
    if (event.source !== parent) return;
    const theme = parseHostTheme(event.data);
    if (!theme) return;
    if (!stylesheet) {
      stylesheet = doc.createElement('style');
      stylesheet.id = 'csvzall-host-theme-v1';
      stylesheet.textContent = HOST_THEME_CSS;
      doc.head.append(stylesheet);
    }
    for (const name of HOST_THEME_VARIABLES) {
      const value = theme.variables[name];
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
    root.dataset.csvzallHostTheme = theme.mode;
    root.style.setProperty('color-scheme', theme.mode);
    // Keep the base class for csvzall's own grid overrides, but stop AG Grid
    // selecting its palette independently from the operating system.
    const grid = doc.getElementById('grid');
    for (const family of ['alpine', 'quartz']) {
      const base = `ag-theme-${family}`;
      if (!grid || ![base, `${base}-auto-dark`, `${base}-dark`].some(name => grid.classList.contains(name))) continue;
      grid.classList.remove(`${base}-auto-dark`);
      grid.classList.add(base);
      grid.classList.toggle(`${base}-dark`, theme.mode === 'dark');
    }
  };
  windowRef.addEventListener('message', onMessage);
  parent.postMessage({ source: 'csvzall-viewer', type: 'theme-ready', version: 1 }, '*');
  return () => windowRef.removeEventListener('message', onMessage);
}

if (typeof window !== 'undefined') installHostTheme(window);
