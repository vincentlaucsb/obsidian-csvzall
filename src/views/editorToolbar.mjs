// The CSV shell inserts its optional controls around the same document actions as JSON.
export function createEditorToolbar(doc, decorate, filenameTag = 'h1') {
  const element = (tag, className) => {
    const node = doc.createElement(tag);
    node.className = className;
    return node;
  };
  const header = element('header', 'topbar');
  const meta = element('div', 'file-meta');
  const filename = doc.createElement(filenameTag);
  filename.textContent = 'Loading…';
  meta.append(filename);
  const actions = element('div', 'toolbar-actions');
  const edits = element('div', 'edit-toolbar');
  function button(icon, label) {
    const node = doc.createElement('button');
    node.type = 'button';
    node.disabled = true;
    node.textContent = label;
    decorate(node, icon, label);
    return node;
  }
  const reset = button('restore', 'Reset');
  const save = button('device-floppy', 'Save');
  edits.append(reset, save);
  actions.append(edits);
  header.append(meta, actions);
  return { header, meta, filename, actions, edits, reset, save };
}
