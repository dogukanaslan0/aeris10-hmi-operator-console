/**
 * ShortcutOverlay — modal listing all keyboard shortcuts.
 * =============================================================================
 * Opened by `?`, closed by `Esc` or backdrop click. Categorises shortcuts so
 * the operator can scan by intent (navigation, selection, display, help).
 *
 *   <ShortcutOverlay open={shortcuts.overlayOpen} onClose={shortcuts.closeOverlay} />
 */

import { useEffect } from 'react';

import { IconClose } from '../icons';
import { SHORTCUTS, type KeyboardShortcut } from '../../hooks/useKeyboardShortcuts';

import './ShortcutOverlay.css';

const CATEGORIES: Array<{ id: KeyboardShortcut['category']; label: string }> = [
  { id: 'help', label: 'Help' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'selection', label: 'Selection' },
  { id: 'display', label: 'Display' },
];

export interface ShortcutOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutOverlay(props: ShortcutOverlayProps) {
  // Focus trap is minimal — Esc handled in useKeyboardShortcuts.
  useEffect(() => {
    if (!props.open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div
      className="shortcut-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-overlay-title"
      onClick={props.onClose}
    >
      <div
        className="shortcut-overlay__card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shortcut-overlay__head">
          <div className="shortcut-overlay__head-text">
            <span className="shortcut-overlay__eyebrow">REFERENCE</span>
            <h2 id="shortcut-overlay-title" className="shortcut-overlay__title">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            type="button"
            className="shortcut-overlay__close"
            onClick={props.onClose}
            aria-label="Close shortcut overlay"
          >
            <IconClose size={14} />
          </button>
        </header>

        <div className="shortcut-overlay__body">
          {CATEGORIES.map((cat) => {
            const items = SHORTCUTS.filter((s) => s.category === cat.id);
            if (items.length === 0) return null;
            return (
              <section key={cat.id} className="shortcut-overlay__group">
                <h3 className="shortcut-overlay__group-title">{cat.label}</h3>
                <ul className="shortcut-overlay__list">
                  {items.map((s) => (
                    <li key={s.key} className="shortcut-overlay__row">
                      <kbd className="shortcut-overlay__kbd">{s.label}</kbd>
                      <span className="shortcut-overlay__desc">{s.description}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <footer className="shortcut-overlay__foot">
          <span>AERIS-10 · C2 TERMINAL</span>
          <span>v0.1.0</span>
        </footer>
      </div>
    </div>
  );
}
