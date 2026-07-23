// Push notifications via Firebase Cloud Messaging (HTTP v1).
//
// One path covers both platforms: Firebase delivers to Android directly and to
// iOS through APNs, which is how Capacitor apps normally do push.
//
// Configured entirely by environment variables, exactly like email. Leave them
// unset and the app still runs, logging what it would have sent:
//
//   FCM_PROJECT_ID            your-firebase-project-id
//   FCM_SERVICE_ACCOUNT       path to the service-account JSON downloaded from
//                             Firebase console -> Project settings -> Service accounts
//   — or —
//   FCM_SERVICE_ACCOUNT_JSON  the same JSON inline (useful on hosts that only
//                             offer environment variables, e.g. Railway/Render)
//
// The legacy FCM "server key" API was switched off by Google in 2024, so this uses
// HTTP v1, which needs an OAuth2 access token. That is a JWT signed with the
// service account's private key and exchanged at Google's token endpoint — done
// here with `jsonwebtoken`, already a dependency, rather than pulling in the
// firebase-admin SDK.
const fs = require("fs");
const jwt = require("jsonwebtoken");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let account = null;      // parsed service account
let accountLoaded = false;
let cachedToken = null;  // { value, expiresAt }

function loadAccount() {
  if (accountLoaded) return account;
  accountLoaded = true;
  try {
    const inline = process.env.FCM_SERVICE_ACCOUNT_JSON;
    const path = process.env.FCM_SERVICE_ACCOUNT;
    const raw = inline || (path && fs.existsSync(path) ? fs.readFileSync(path, "utf8") : null);
    if (!raw) return (account = null);
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      console.error("[push] service account JSON is missing client_email or private_key");
      return (account = null);
    }
    account = parsed;
  } catch (e) {
    console.error(`[push] could not read the service account: ${e.message}`);
    account = null;
  }
  return account;
}

const projectId = () => process.env.FCM_PROJECT_ID || loadAccount()?.project_id || null;
const isConfigured = () => Boolean(projectId() && loadAccount());

// Access tokens last an hour; re-use one until it is nearly expired.
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const sa = loadAccount();
  const assertion = jwt.sign(
    { scope: SCOPE, aud: TOKEN_URL, iss: sa.client_email, iat: now, exp: now + 3600 },
    sa.private_key,
    { algorithm: "RS256" },
  );
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`token exchange failed (${res.status}): ${data.error_description || data.error || "unknown"}`);
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return cachedToken.value;
}

/**
 * Send one notification to one device token.
 * Returns { sent, stubbed, invalidToken?, error? } and never throws — a push
 * failure must not break the action that triggered it.
 */
async function sendPush(token, { title, body, data = {} } = {}) {
  if (!token || !title) return { sent: false, stubbed: false, error: "missing token or title" };

  if (!isConfigured()) {
    console.log(`\n[push:stub] would send →`);
    console.log(`  To:    ${String(token).slice(0, 24)}…`);
    console.log(`  Title: ${title}`);
    console.log(`  Body:  ${body}\n`);
    return { sent: false, stubbed: true };
  }

  try {
    const message = {
      message: {
        token,
        notification: { title, body },
        // FCM requires every data value to be a string.
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: { priority: "high", notification: { sound: "default", channelId: "staff-hub" } },
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
      },
    };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId()}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (res.ok) return { sent: true, stubbed: false };

    const err = await res.json().catch(() => ({}));
    const status = err?.error?.details?.[0]?.errorCode || err?.error?.status || String(res.status);
    // The app was uninstalled, or the token was rotated. The caller deletes these
    // so the table doesn't fill with tokens that can never be delivered to.
    const invalidToken = status === "UNREGISTERED" || status === "INVALID_ARGUMENT" || res.status === 404;
    if (!invalidToken) console.error(`[push] send failed (${status}): ${err?.error?.message || res.statusText}`);
    return { sent: false, stubbed: false, invalidToken, error: status };
  } catch (e) {
    console.error(`[push] send failed: ${e.message}`);
    return { sent: false, stubbed: false, error: e.message };
  }
}

// One-line description for the startup banner.
function describePush() {
  if (!isConfigured()) return "console stub (set FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT in server/.env to send real push notifications)";
  return `Firebase project "${projectId()}" as ${loadAccount().client_email}`;
}

// Check the credentials without sending anything.
async function verifyPush() {
  if (!isConfigured()) return { configured: false };
  try {
    await accessToken();
    return { configured: true, ok: true, projectId: projectId() };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

module.exports = { sendPush, describePush, verifyPush, isConfigured };
