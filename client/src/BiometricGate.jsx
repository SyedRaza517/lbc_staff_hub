// App lock. Covers the whole app until the device verifies the user.
//
// Shown when biometric unlock is switched on and the app has just launched, or has
// come back from the background. Signing out is always available, so a failed or
// unavailable sensor can never trap someone inside a locked screen.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { isNativeApp } from "./PhoneShell";
import { getToken } from "./api";
import { isBiometricEnabled, verifyBiometric, biometricStatus, biometryLabel } from "./biometric";
import { Fingerprint, Loader2, LogOut, ShieldCheck, XCircle } from "lucide-react";

const NAVY = "#1a3a8f", NAVY_DARK = "#14306f";

// Re-lock only after a real absence. Without this, the OS briefly backgrounding the
// app (a permission dialog, the notification shade) would demand a fingerprint
// every few seconds.
const RELOCK_AFTER_MS = 30_000;

// Evaluated once, when the bundle loads: was there already a session on disk?
// If so the app is being re-opened and should lock. If not, the user is about to
// sign in — and asking for a fingerprint immediately after they typed their
// password would be pure friction.
const RESUMED_SESSION = typeof window !== "undefined" && Boolean(getToken());

export function useAppLock() {
  const [locked, setLocked] = useState(() => RESUMED_SESSION && isNativeApp() && isBiometricEnabled());
  const backgroundedAt = useRef(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cleanup = () => {};
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isBiometricEnabled()) return;
          if (!isActive) {
            backgroundedAt.current = Date.now();
            return;
          }
          const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
          if (away >= RELOCK_AFTER_MS) setLocked(true);
        });
        cleanup = () => handle.remove();
      } catch (_) { /* @capacitor/app unavailable — lock still works at launch */ }
    })();
    return () => cleanup();
  }, []);

  return { locked: locked && isBiometricEnabled() && isNativeApp(), unlock: () => setLocked(false), lock: () => setLocked(true) };
}

export default function BiometricGate({ user, onUnlock, logout }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("biometric unlock");
  const attempted = useRef(false);

  const attempt = useCallback(async () => {
    setBusy(true);
    setError("");
    const res = await verifyBiometric({ reason: "Unlock Staff Hub" });
    setBusy(false);
    if (res.ok) { onUnlock(); return; }
    // A cancel is a choice, not a fault — don't shout at the user.
    setError(res.cancelled ? "" : (res.error || "Could not verify. Try again."));
  }, [onUnlock]);

  useEffect(() => {
    (async () => {
      const status = await biometricStatus();
      setLabel(biometryLabel(status.biometryType));
      // If the sensor has become unavailable since the lock was switched on (the
      // user removed their fingerprints, say), don't strand them behind it.
      if (!status.available) { onUnlock(); return; }
      if (!attempted.current) { attempted.current = true; attempt(); }
    })();
  }, [attempt, onUnlock]);

  return (
    <div
      className="animated-gradient flex w-full flex-col items-center justify-center p-6 text-center"
      style={{
        height: "100dvh",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY_DARK} 55%, #0f172a 100%)`,
        backgroundSize: "220% 220%",
        paddingTop: "max(env(safe-area-inset-top), 24px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 24px)",
      }}
    >
      <div className="float mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10 text-white ring-1 ring-white/20">
        <Fingerprint size={40} />
      </div>

      <h1 className="text-xl font-extrabold tracking-tight text-white">Staff Hub is locked</h1>
      <p className="mt-1 max-w-xs text-sm text-white/70">
        {user?.name ? `${user.name.split(/\s+/)[0]}, use ` : "Use "}{label} to continue.
      </p>

      {error && (
        <div className="pop mt-4 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-rose-200 ring-1 ring-white/15">
          <XCircle size={14} /> {error}
        </div>
      )}

      <button
        onClick={attempt}
        disabled={busy}
        className="press shine mt-7 flex w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-bold shadow-xl transition disabled:opacity-70"
        style={{ color: NAVY }}
      >
        {busy ? <><Loader2 size={18} className="animate-spin" /> Waiting for you…</> : <><ShieldCheck size={18} /> Unlock</>}
      </button>

      <button
        onClick={logout}
        className="press mt-4 flex items-center gap-1.5 text-xs font-semibold text-white/50 transition hover:text-white/80"
      >
        <LogOut size={13} /> Sign out instead
      </button>

      <p className="mt-8 max-w-xs text-[11px] leading-relaxed text-white/35">
        Your session stays signed in. This lock keeps staff records private if your
        phone is unlocked by someone else.
      </p>
    </div>
  );
}
