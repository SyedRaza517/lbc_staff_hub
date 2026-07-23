import React, { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { registerForPush, unregisterForPush } from "./push";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // We hold a token we could not check because the server was unreachable.
  const [offline, setOffline] = useState(false);

  // Restore session on load.
  //
  // Only throw the stored token away when the server actually rejects it. Phones
  // lose signal constantly — in a tunnel, on a bad lift, with the server asleep —
  // and a bare catch here used to read "unreachable" as "invalid" and sign the
  // user out for good. api.request() already clears the token and fires
  // auth:unauthorized on a genuine 401, so a real rejection is still handled.
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          setUser(await api.me());
        } catch (e) {
          // No status => fetch never got a reply. Keep the session and let the
          // user retry once they are back online.
          if (e?.status && e.status !== 502 && e.status !== 503 && e.status !== 504) setToken(null);
          else setOffline(true);
        }
      }
      setLoading(false);
    })();
  }, []);

  // When any API call hits a 401 (expired/invalid token), drop the user so the
  // app falls back to <Login> instead of getting stuck on a broken session.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, []);

  // Register for push once there is a signed-in user to attach the token to.
  // A no-op on the web, so nothing changes for browser users.
  useEffect(() => {
    if (!user) return;
    registerForPush({
      // Tapping a notification should land on the screen it refers to.
      onOpen: (link) => window.dispatchEvent(new CustomEvent("push:open", { detail: link })),
    });
  }, [user?.id]);

  // Turn a successful auth response into a live session.
  const applySession = ({ token, user }) => { setToken(token); setUser(user); };

  // Step one of signing in. The password may not be enough: an account with an
  // authenticator (or one that still owes us enrolment) gets a challenge token
  // instead of a session, and the caller drives the second step.
  // Returns { ok, mfaRequired?, totpSetupRequired?, challengeToken?, error? }.
  const signIn = async (email, password) => {
    setError("");
    try {
      const res = await api.login(email, password);
      if (res?.token) { applySession(res); return { ok: true }; }
      if (res?.mfaRequired) return { ok: false, mfaRequired: true, challengeToken: res.challengeToken, name: res.name };
      if (res?.totpSetupRequired) return { ok: false, totpSetupRequired: true, challengeToken: res.challengeToken, name: res.name };
      throw new Error("Unexpected response from the server");
    } catch (e) {
      const msg = e.message || "Login failed";
      setError(msg);
      return { ok: false, error: msg };
    }
  };

  // Kept for the admin dashboard login, which is a plain one-step sign-in.
  // Returns the full result so that screen can still react if 2FA is ever
  // switched on for an admin account.
  const login = async (email, password) => signIn(email, password);

  // Detach this device from push before the session goes, otherwise a shared or
  // handed-on phone keeps receiving the previous user's leave decisions.
  const logout = async () => {
    try { await unregisterForPush(); } catch (_) { /* never block signing out */ }
    setToken(null);
    setUser(null);
  };

  // Re-fetch the current user (used after a password change so flags like
  // mustChangePassword update without forcing a full re-login).
  const refreshUser = async () => { setUser(await api.me()); };

  // Try the stored token again after a connection drop. Same rule as on load:
  // only a real rejection from the server discards it.
  const retryRestore = async () => {
    if (!getToken()) { setOffline(false); return; }
    try {
      setUser(await api.me());
      setOffline(false);
    } catch (e) {
      if (e?.status && e.status !== 502 && e.status !== 503 && e.status !== 504) { setToken(null); setOffline(false); }
    }
  };

  // Give up on the stored session and go back to sign-in by choice.
  const abandonRestore = () => { setToken(null); setOffline(false); };

  return <AuthCtx.Provider value={{ user, loading, error, setError, login, signIn, applySession, logout, refreshUser, offline, retryRestore, abandonRestore }}>{children}</AuthCtx.Provider>;
}
