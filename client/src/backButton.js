import { useEffect, useRef } from "react";

// Android hardware back-button handling for the native app.
//
// Components register a handler while they have somewhere to go "back" to (a modal
// that can close, a sub-screen that can return home). Handlers form a STACK: the
// most recently registered runs first, so a modal opened on top of a sub-screen
// closes before the sub-screen navigates away. A handler returns true if it handled
// the press. When nothing handles it (we're at the app's home with no overlays), we
// minimise the app — the normal Android behaviour — instead of abruptly closing.

let handlers = [];
let attached = false;

async function ensureListener() {
  if (attached) return;
  attached = true;
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("backButton", () => {
      for (let i = handlers.length - 1; i >= 0; i--) {
        try { if (handlers[i]()) return; } catch (_) { /* ignore a bad handler */ }
      }
      // Nothing to go back to — behave like a normal Android app.
      try { App.minimizeApp(); } catch (_) { try { App.exitApp(); } catch (_) {} }
    });
  } catch (_) { /* web build / plugin missing — there's no hardware back to handle */ }
}

export function registerBackHandler(fn) {
  handlers.push(fn);
  ensureListener();
  return () => { handlers = handlers.filter((h) => h !== fn); };
}

// Register `fn` as a back handler while `active` is true. `fn` performs the back
// action and returns true if it handled it. The latest `fn` is always used, so it
// can safely close over changing state.
export function useBackHandler(active, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return undefined;
    return registerBackHandler(() => ref.current());
  }, [active]);
}

// Attach the listener eagerly so even the "at home → minimise" behaviour is ours.
ensureListener();
