import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// jsdom does not implement modal dialogs; without this, dialog content stays hidden.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}

// Testing Library only auto-cleans when Vitest globals are enabled.
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
