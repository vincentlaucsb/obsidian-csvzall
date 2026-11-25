export function createAutosaveControl(doc) {
  const control = doc.createElement('label');
  control.className = 'autosave-control';
  control.hidden = true;
  const toggle = doc.createElement('span');
  toggle.className = 'autosave-switch';
  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', 'AutoSave');
  const value = doc.createElement('span');
  value.setAttribute('aria-hidden', 'true');
  value.textContent = 'AutoSave Off';
  toggle.append(input, value);
  control.append(toggle);
  return { control, input, value };
}

export function createAutosave({ control, input, value }, { win, canSave, save }) {
  let enabled = false;
  let override;
  let failed = false;
  let timer;
  let disposed = false;
  function cancel() {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    cancel();
    if (disposed || !enabled || failed || !canSave()) return;
    timer = win.setTimeout(() => {
      timer = undefined;
      if (enabled && !failed && canSave()) void save().catch(() => {});
    }, 800);
  }
  function setPolicy(policy) {
    control.hidden = !policy.visible;
    if (!policy.visible) override = undefined;
    enabled = policy.visible && (override ?? policy.enabled);
    input.checked = enabled;
    value.textContent = enabled ? 'AutoSave On' : 'AutoSave Off';
    schedule();
  }
  function change() {
    if (control.hidden) return;
    override = input.checked;
    setPolicy({ enabled: override, visible: true });
  }
  input.addEventListener('change', change);
  return {
    get enabled() { return enabled; },
    setPolicy,
    schedule,
    cancel,
    edited() { failed = false; schedule(); },
    failed() { failed = true; cancel(); },
    dispose() {
      disposed = true;
      cancel();
      input.removeEventListener('change', change);
    },
  };
}
