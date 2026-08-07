// Face ID / Touch ID / fingerprint unlock.
//
// This is an APP LOCK, not a second login: the user has already signed in, and
// biometrics gate access to the running app when it is opened or brought back from
// the background. That is the behaviour people expect from a banking or HR app, and
// it means a borrowed or stolen unlocked phone doesn't expose staff records.
//
// Everything here is a no-op on the web, where there is no biometric hardware to
// ask — the toggle is hidden rather than offered and broken.
import { isNativeApp } from "./PhoneShell";

const ENABLED_KEY = "lbc_biometric_enabled";
// Where the remembered session lives. Capacitor Preferences is app-private storage
// (Android SharedPreferences / iOS UserDefaults) — another app cannot read it, though
// it is not the Keychain, which is why the token is only ever put there when the user
// has switched biometric unlock ON and is only ever taken out after a successful check.
const SESSION_KEY = "lbc_remembered_session";

async function prefs() {
  if (!isNativeApp()) return null;
  try { return (await import("@capacitor/preferences")).Preferences || null; } catch (_) { return null; }
}

/**
 * Remember the signed-in session so reopening the app asks for a face or a finger
 * instead of a password.
 *
 * Without this the token sits in sessionStorage, which the OS wipes when the app
 * process ends — so every genuine app restart forced a full sign-in. That is the
 * behaviour people were complaining about, and it pushed them towards short, reused
 * passwords, which is worse than storing a short-lived token behind a biometric.
 *
 * The JWT already expires on its own, and the server can revoke it by bumping
 * tokenVersion, so a remembered session cannot outlive either.
 */
export async function rememberSession(token) {
  const P = await prefs();
  if (!P || !token) return false;
  try { await P.set({ key: SESSION_KEY, value: token }); return true; } catch (_) { return false; }
}

export async function storedSession() {
  const P = await prefs();
  if (!P) return null;
  try { return (await P.get({ key: SESSION_KEY }))?.value || null; } catch (_) { return null; }
}

// Set when a session was just restored by a biometric check at launch, so the app
// lock knows not to ask again. Without it the user verifies twice in a row: once to
// unlock the saved session, then again because a session "appeared", which the lock
// cannot otherwise tell apart from a fresh password sign-in.
let restoredFlag = false;
export const markRestored = () => { restoredFlag = true; };
export const consumeRestored = () => { const v = restoredFlag; restoredFlag = false; return v; };

export async function forgetSession() {
  const P = await prefs();
  if (!P) return;
  try { await P.remove({ key: SESSION_KEY }); } catch (_) {}
}

async function plugin() {
  if (!isNativeApp()) return null;
  try {
    const mod = await import("@aparajita/capacitor-biometric-auth");
    return mod.BiometricAuth || null;
  } catch (_) {
    return null;
  }
}

/**
 * What the device can actually do.
 * { available, reason?, biometryType } — biometryType is 'faceId' | 'touchId' |
 * 'fingerprintAuthentication' | ... so the UI can name it correctly rather than
 * saying "biometrics" at someone holding an iPhone.
 */
export async function biometricStatus() {
  const Bio = await plugin();
  if (!Bio) return { available: false, reason: "not-native", biometryType: null };
  try {
    const info = await Bio.checkBiometry();
    return {
      available: Boolean(info?.isAvailable),
      // e.g. 'Biometry is not enrolled' when the user has no fingerprint set up.
      reason: info?.isAvailable ? null : (info?.reason || info?.strongReason || "unavailable"),
      biometryType: info?.biometryType ?? null,
    };
  } catch (e) {
    return { available: false, reason: e?.message || "unavailable", biometryType: null };
  }
}

// Human name for the prompt and the settings row.
export function biometryLabel(type) {
  const map = {
    faceId: "Face ID",
    touchId: "Touch ID",
    fingerprintAuthentication: "fingerprint unlock",
    faceAuthentication: "face unlock",
    irisAuthentication: "iris unlock",
  };
  return map[type] || "biometric unlock";
}

/**
 * Ask the device to verify the user.
 * Returns { ok, cancelled, error } — `cancelled` is separated out because a user
 * tapping "Cancel" is not a failure and must not be shown as an error.
 */
export async function verifyBiometric({ reason = "Unlock Staff Hub" } = {}) {
  const Bio = await plugin();
  if (!Bio) return { ok: false, error: "not-native" };
  try {
    await Bio.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: true, // fall back to the device PIN/passcode
      iosFallbackTitle: "Use passcode",
      androidTitle: "Unlock Staff Hub",
      androidSubtitle: "Confirm it's you to continue",
      androidConfirmationRequired: false,
    });
    return { ok: true };
  } catch (e) {
    // The plugin throws a BiometryError with a code; treat user cancellation
    // and "no attempt made" as a cancel rather than a failure.
    const code = e?.code || "";
    const cancelled = /cancel/i.test(code) || /cancel/i.test(e?.message || "");
    return { ok: false, cancelled, error: e?.message || String(code) };
  }
}

/* ---- the user's preference ---- */
export const isBiometricEnabled = () => {
  try { return localStorage.getItem(ENABLED_KEY) === "1"; } catch (_) { return false; }
};
export const setBiometricEnabled = (on) => {
  try { on ? localStorage.setItem(ENABLED_KEY, "1") : localStorage.removeItem(ENABLED_KEY); } catch (_) {}
};

// Clear the app-lock preference and the "don't ask again" flag. Called on sign-out:
// both live in localStorage, so without this they were device-global — the next
// person to sign in on the same phone inherited the previous user's app lock and
// their dismissal of the setup prompt.
export const clearBiometricPrefs = () => {
  try {
    localStorage.removeItem(ENABLED_KEY);
    localStorage.removeItem("lbc_biometric_prompt_dismissed");
  } catch (_) {}
  // Fire-and-forget: the caller is signing out and must not wait on storage.
  forgetSession();
};

/**
 * Turn the lock on. Verifies once first — enabling a lock the device can't
 * actually satisfy would shut the user out of their own app.
 */
export async function enableBiometric() {
  const status = await biometricStatus();
  if (!status.available) return { ok: false, reason: status.reason };
  const res = await verifyBiometric({ reason: "Confirm it's you to turn on app lock" });
  if (!res.ok) return { ok: false, reason: res.cancelled ? "cancelled" : res.error };
  setBiometricEnabled(true);
  // Remember the CURRENT session, so the next cold start can be unlocked by face or
  // finger. Imported lazily to avoid a cycle: api.js has no knowledge of biometrics.
  try {
    const { getToken } = await import("./api");
    const t = getToken();
    if (t) await rememberSession(t);
  } catch (_) { /* remembering is a convenience, never a reason to fail the toggle */ }
  return { ok: true, biometryType: status.biometryType };
}

// Turning it off requires a successful check too, so someone holding an unlocked
// phone can't simply switch the lock off.
export async function disableBiometric() {
  const res = await verifyBiometric({ reason: "Confirm it's you to turn off app lock" });
  if (!res.ok) return { ok: false, reason: res.cancelled ? "cancelled" : res.error };
  setBiometricEnabled(false);
  await forgetSession();
  return { ok: true };
}
