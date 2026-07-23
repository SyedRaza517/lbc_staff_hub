// The staff app's container.
//
// On a desktop screen it draws a decorative phone (frame, notch, fake status bar)
// so the demo reads as "this is the mobile app". On an actual phone — or inside
// the packaged Capacitor app — that chrome is wrong: it wastes screen space and
// paints a fake clock and battery next to the real ones. There we go full-bleed
// and let the device supply its own status bar.
import React, { useEffect, useState } from "react";

// True when the app is running inside the native Capacitor shell.
export const isNativeApp = () =>
  typeof window !== "undefined" &&
  (window.Capacitor?.isNativePlatform?.() === true ||
    /(^|;)\s*capacitor:\/\//.test(window.location.protocol) ||
    window.location.protocol === "capacitor:");

// A handset is: the packaged app, OR a narrow screen, OR a TOUCH screen that is
// short. That last clause matters — a phone rotated to landscape is ~850x390, so
// a width-only test decided it was a desktop and drew the decorative 390x820 phone
// frame inside the real phone, which then could not even fit. The height limit
// keeps tablets (768px+ tall in landscape) on the desktop presentation.
const HANDSET_QUERY = "(max-width: 640px), (pointer: coarse) and (max-height: 600px)";

export function useIsHandset() {
  const [isHandset, setIsHandset] = useState(() => {
    if (typeof window === "undefined") return false;
    return isNativeApp() || window.matchMedia(HANDSET_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(HANDSET_QUERY);
    const update = () => setIsHandset(isNativeApp() || mq.matches);
    update();
    // addEventListener is not available on older Safari's MediaQueryList.
    if (mq.addEventListener) { mq.addEventListener("change", update); return () => mq.removeEventListener("change", update); }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);
  return isHandset;
}

/**
 * header  — the app's coloured top bar (supplies its own background)
 * children— the scrolling body
 *
 * The header keeps its own styling in both modes; this component only decides
 * between "decorative phone on a desktop page" and "fill the device screen".
 */
export default function PhoneShell({ header, children }) {
  const handset = useIsHandset();

  if (handset) {
    return (
      // Fills whatever height the parent gives it, so it can sit under the app's
      // top bar without the two together overflowing the screen.
      <div className="flex h-full w-full flex-col overflow-hidden bg-white">
        <div className="shrink-0">{header}</div>
        <div
          className="relative flex-1 overflow-y-auto bg-slate-50"
          // Clear of the home indicator, with momentum scrolling on iOS.
          style={{ paddingBottom: "env(safe-area-inset-bottom)", WebkitOverflowScrolling: "touch" }}
        >
          {children}
        </div>
      </div>
    );
  }

  // Desktop: the decorative phone.
  return (
    <div className="flex justify-center py-6">
      <div className="scale-in relative w-[390px] max-w-full overflow-hidden rounded-[2.6rem] border-[10px] border-slate-900 bg-white shadow-2xl ring-1 ring-slate-900/5" style={{ height: 820 }}>
        <div className="absolute left-1/2 top-0 z-30 h-6 w-36 -translate-x-1/2 rounded-b-2xl bg-slate-900" />
        <div className="flex h-full flex-col">
          <div className="shrink-0">{header}</div>
          <div className="relative flex-1 overflow-y-auto bg-slate-50">{children}</div>
        </div>
      </div>
    </div>
  );
}
