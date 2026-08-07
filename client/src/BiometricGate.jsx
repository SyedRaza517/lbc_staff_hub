// App lock. Covers the whole app until the device verifies the user.
//
// Shown when biometric unlock is switched on and the app has just launched, or has
// come back from the background. Signing out is always available, so a failed or
// unavailable sensor can never trap someone inside a locked screen.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { isNativeApp } from "./PhoneShell";
import { getToken } from "./api";
import { isBiometricEnabled, verifyBiometric, biometricStatus, biometryLabel, enableBiometric, consumeRestored } from "./biometric";
import { Fingerprint, Loader2, LogOut, ShieldCheck, XCircle } from "lucide-react";
import { useBackHandler } from "./backButton";

const NAVY = "#1a3a8f", NAVY_DARK = "#14306f";

// Remembers that the user has already been offered the one-time "turn on Face ID"
// prompt and said no — so it isn't shoved in their face on every sign-in.
const PROMPT_DISMISSED_KEY = "lbc_biometric_prompt_dismissed";

// Re-lock only after a real absence. Without this, the OS briefly backgrounding the
// app (a permission dialog, the notification shade) would demand a fingerprint
// every few seconds.
const RELOCK_AFTER_MS = 30_000;

// Evaluated once, when the bundle loads: was there already a session on disk?
// If so the app is being re-opened and should lock. If not, the user is about to
// sign in — and asking for a fingerprint immediately after they typed their
// password would be pure friction.
const RESUMED_SESSION = typeof window !== "undefined" && Boolean(getToken());

export function useAppLock(hasSession) {
  const [locked, setLocked] = useState(() => RESUMED_SESSION && isNativeApp() && isBiometricEnabled());
  const backgroundedAt = useRef(null);
  // Tracks whether a session already existed last render, so a session that has
  // just APPEARED (a fresh sign-in) can be told apart from one that was already
  // there (a resume, handled by RESUMED_SESSION above).
  const prevSession = useRef(RESUMED_SESSION);

  // Lock right after a FRESH sign-in too — so Face ID / fingerprint is a step of
  // signing in on the phone, not only a resume guard. The gate always offers
  // "Sign out" and falls back to the device passcode, and the authenticator (TOTP)
  // is still the account's second factor, so a missing sensor can't trap anyone.
  useEffect(() => {
    if (isNativeApp() && isBiometricEnabled() && hasSession && !prevSession.current) {
      // A session restored by the launch unlock has ALREADY been verified — locking
      // again would ask for the same finger twice in a row.
      if (!consumeRestored()) setLocked(true);
    }
    prevSession.current = hasSession;
  }, [hasSession]);

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

/**
 * A one-time, dismissable offer shown just after signing in on the phone, inviting
 * the user to protect the app with Face ID / fingerprint. Renders nothing on the
 * web, when the sensor is unavailable, when the lock is already on, or once the
 * user has declined. Turning it on here means the next open — and the next sign-in —
 * asks for biometrics (see useAppLock above).
 */
export function BiometricSetupPrompt() {
  const [show, setShow] = useState(false);
  const [label, setLabel] = useState("biometric unlock");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Android hardware back dismisses the prompt (same as "Not now") instead of falling
  // through to the screen underneath while this stays on top. Declared here (not after
  // the early return below) because hooks must run on every render.
  const dismissPrompt = useCallback(() => {
    try { localStorage.setItem(PROMPT_DISMISSED_KEY, "1"); } catch (_) {}
    setShow(false);
  }, []);
  useBackHandler(show, () => { dismissPrompt(); return true; });

  useEffect(() => {
    if (!isNativeApp() || isBiometricEnabled()) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(PROMPT_DISMISSED_KEY) === "1"; } catch (_) {}
    if (dismissed) return;
    biometricStatus().then((s) => {
      if (s.available) { setLabel(biometryLabel(s.biometryType)); setShow(true); }
    });
  }, []);

  if (!show) return null;

  const enable = async () => {
    setBusy(true); setError("");
    const res = await enableBiometric();
    setBusy(false);
    if (res.ok) { setShow(false); return; }
    // A cancel is a choice, not a fault — leave the prompt up so they can retry.
    if (res.reason !== "cancelled") setError(res.reason || "Could not turn this on. Try again.");
  };

  const notNow = dismissPrompt;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center p-4 sm:items-center"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
    >
      <div className="fade-up fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={notNow} />
      <div className="scale-in relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl ring-1 ring-black/5">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl text-white shadow-md" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}>
          <Fingerprint size={30} />
        </div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800">Protect Staff Hub with {label}?</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Ask for {label} whenever the app is opened or you sign in, so your staff records
          stay private even if someone else has your unlocked phone. You can turn this off
          any time in More.
        </p>

        {error && (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
            <XCircle size={14} /> {error}
          </div>
        )}

        <button
          onClick={enable}
          disabled={busy}
          className="press mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white shadow-md transition disabled:opacity-70"
          style={{ background: NAVY }}
        >
          {busy ? <><Loader2 size={18} className="animate-spin" /> Confirming…</> : <><ShieldCheck size={18} /> Turn on {label}</>}
        </button>
        <button onClick={notNow} disabled={busy} className="press mt-2 w-full rounded-2xl py-2.5 text-sm font-semibold text-slate-500 transition hover:text-slate-700 disabled:opacity-70">
          Not now
        </button>
      </div>
    </div>
  );
}
