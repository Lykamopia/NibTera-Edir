'use client';

import { useEffect } from 'react';

// Selector matching any Radix layer (Dialog/AlertDialog/Sheet/DropdownMenu/Select/etc.)
// that is currently open and may legitimately need `disableOutsidePointerEvents`.
const OPEN_LAYER_SELECTOR = [
  '[data-state="open"][role="dialog"]',
  '[data-state="open"][role="alertdialog"]',
  '[data-state="open"][role="menu"]',
  '[data-state="open"][role="listbox"]',
].join(', ');

function hasOpenOverlay(): boolean {
  return document.querySelectorAll(OPEN_LAYER_SELECTOR).length > 0;
}

/**
 * Radix's DismissableLayer tracks `document.body.style.pointerEvents` in a
 * module-level variable shared across all layer instances. When dialogs/menus
 * mount and unmount in overlapping sequences, that variable can get left as
 * "none", permanently blocking clicks on the page even though no overlay is
 * visible. This safety net detects that orphaned state and clears it.
 */
function cleanupOrphanedOverlayState() {
  if (hasOpenOverlay()) return;

  if (document.body.style.pointerEvents === 'none') {
    document.body.style.pointerEvents = '';
  }

  // Remove any leftover overlay/backdrop elements that failed to unmount.
  document
    .querySelectorAll('[data-radix-dialog-overlay], [data-radix-alert-dialog-overlay]')
    .forEach((el) => {
      const state = el.getAttribute('data-state');
      if (!state || state === 'closed') {
        el.remove();
      }
    });

  // Clear a stuck body scroll lock left behind by react-remove-scroll.
  if (document.body.hasAttribute('data-scroll-locked')) {
    document.body.removeAttribute('data-scroll-locked');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('margin-right');
  }
}

/**
 * App-wide safety net that keeps the page interactive after any modal,
 * dropdown, or popover is dismissed. Mounted once in the root layout.
 */
export function OverlayCleanup() {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(cleanupOrphanedOverlayState);
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'data-scroll-locked', 'class'],
    });

    const interval = setInterval(cleanupOrphanedOverlayState, 1000);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);

  return null;
}
