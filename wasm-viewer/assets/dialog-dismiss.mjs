/** Treat a backdrop click like Cancel, without dismissing drags from content. */
export function installDialogDismiss(dialog) {
  const marker = 'data-csvzall-dialog-dismiss-v1';
  if (dialog.hasAttribute(marker)) return () => {};
  dialog.setAttribute(marker, '');
  let pressedOutside = false;
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  const reset = () => { pressedOutside = false; };
  const onPointerDown = event => {
    pressedOutside = dialog.open && event.button === 0 && event.isPrimary !== false && outside(event);
  };
  const onClick = event => {
    const dismiss = pressedOutside && dialog.open && event.button === 0 && outside(event);
    reset();
    if (!dismiss) return;
    const cancel = new dialog.ownerDocument.defaultView.Event('cancel', { cancelable: true });
    if (dialog.dispatchEvent(cancel)) dialog.close('cancel');
  };
  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('pointercancel', reset);
  dialog.addEventListener('close', reset);
  return () => {
    dialog.removeEventListener('pointerdown', onPointerDown);
    dialog.removeEventListener('click', onClick);
    dialog.removeEventListener('pointercancel', reset);
    dialog.removeEventListener('close', reset);
    dialog.removeAttribute(marker);
  };
}

export function installDialogDismissals(doc) {
  // Loading/progress dialogs intentionally have no csvzall-dialog class.
  const cleanups = [...doc.querySelectorAll('dialog.csvzall-dialog')].map(installDialogDismiss);
  return () => cleanups.forEach(cleanup => cleanup());
}

if (typeof document !== 'undefined') installDialogDismissals(document);
