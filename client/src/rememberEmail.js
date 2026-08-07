// Remembering the sign-in details, so returning users don't retype them.
//
// TWO SEPARATE OPT-INS, because they carry very different risk:
//
//   email     Harmless. An address is not a secret, and it is on every register and
//             email footer in the college already.
//
//   password  A REAL SECRET, and this stores it in plain text.
//
// What storing the password actually means — decided deliberately, not by accident:
//
//   • It sits in localStorage/WebView storage in plain text. Anything that can run
//     script on this origin can read it. One XSS anywhere in the app stops being
//     "someone reads this session" and becomes "someone has this person's password",
//     which they may well have reused elsewhere.
//   • It SURVIVES SIGN OUT. That is the point of the feature — signing out and then
//     having to retype would defeat it — but it means "Sign out" no longer clears
//     this device. On a shared machine the next person gets a filled-in password box.
//   • Obfuscating it (base64, a fixed XOR key) would be worse than doing nothing:
//     the key ships in the same bundle, so it stops nobody and only makes the risk
//     harder to see in a review.
//
// It is OFF by default and each tickbox is independent, so nobody gets this without
// choosing it, and unticking removes what was stored immediately.
//
// THE SAFER PATH, already built and preferred where it is available: turn on the
// biometric app lock (More → Preferences). The sign-in screen then offers "Sign in
// with Face / Fingerprint", which unlocks a remembered SESSION — a token that
// expires on its own and that the server can revoke by bumping tokenVersion. That
// gives the same one-tap convenience without a reusable password sitting on disk.
const EMAIL_KEY = "lbc_remembered_email";
const PW_KEY = "lbc_remembered_password";

const read = (key) => { try { return localStorage.getItem(key) || ""; } catch (_) { return ""; } };
const write = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value); else localStorage.removeItem(key);
  } catch (_) { /* private browsing / storage disabled — remembering is optional */ }
};

export const rememberedEmail = () => read(EMAIL_KEY);
export const setRememberedEmail = (email) => write(EMAIL_KEY, String(email || "").trim().toLowerCase());

export const rememberedPassword = () => read(PW_KEY);
// Not trimmed or lower-cased: a password's whitespace and case are significant.
export const setRememberedPassword = (password) => write(PW_KEY, password ? String(password) : "");

// Wipe both. Exported so a "forget this device" control can be added later without
// callers needing to know the key names.
export const forgetRememberedLogin = () => { write(EMAIL_KEY, ""); write(PW_KEY, ""); };
