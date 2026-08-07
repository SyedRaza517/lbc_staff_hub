// Document file storage, on Supabase Storage.
//
// Talks to Supabase's Storage REST API with plain fetch rather than pulling in
// @supabase/supabase-js — the same choice moodle.js makes, and for the same reason:
// three endpoints do not justify a dependency, and it keeps the server's install
// small on a free-tier host.
//
// WHY NOT THE SERVER'S OWN DISK: Render's free tier has no persistent disk. Anything
// written to the filesystem disappears on the next deploy, so a policy uploaded on
// Monday would be gone on Tuesday with no error and no trace.
//
// THE BUCKET MUST BE PRIVATE. Documents include payroll and HR files assigned to one
// named person; a public bucket makes every one of them readable by anyone who can
// guess a URL, with no sign-in at all. Reads therefore go through short-lived signed
// URLs minted only after the API has checked the caller may see that document.
const BUCKET = process.env.SUPABASE_BUCKET || "documents";
const URL_BASE = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
// The SERVICE ROLE key bypasses row-level security, so it must never reach the client.
// It is used here only, server-side, behind the route guards.
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const isConfigured = () => Boolean(URL_BASE() && KEY());

// Signed links are deliberately short-lived: long enough to click, short enough that a
// forwarded URL is useless by the time it is read.
const SIGNED_URL_TTL_SECONDS = 300;

// A single request may not exceed this. Policy PDFs are a few hundred KB; 10MB is
// generous and keeps one upload from exhausting a 512MB instance.
const MAX_BYTES = 10 * 1024 * 1024;

// Filenames reach a URL path, so anything that could traverse or confuse one is
// stripped rather than escaped. The stored path is never shown to a user — the
// original name is kept in the database for display.
function safeKey(documentId, fileName) {
  const ext = (String(fileName || "").match(/\.[A-Za-z0-9]{1,8}$/) || [""])[0].toLowerCase();
  return `${documentId}${ext}`;
}

async function storageFetch(path, init = {}) {
  const res = await fetch(`${URL_BASE()}/storage/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY()}`,
      apikey: KEY(),
      ...(init.headers || {}),
    },
  });
  return res;
}

/**
 * Store the bytes for a document. Returns { path, size } or throws with a message
 * the route can show. Upsert is on, so re-uploading replaces rather than orphaning.
 */
async function putObject(documentId, fileName, contentType, buffer) {
  if (!isConfigured()) throw new Error("Document storage isn't set up on the server yet.");
  if (!buffer?.length) throw new Error("The file is empty.");
  if (buffer.length > MAX_BYTES) throw new Error(`That file is too large (limit ${Math.round(MAX_BYTES / 1024 / 1024)}MB).`);
  const key = safeKey(documentId, fileName);
  const res = await storageFetch(`/object/${BUCKET}/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": contentType || "application/octet-stream", "x-upsert": "true" },
    body: buffer,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // A missing bucket is the one failure an admin can actually fix, so name it.
    if (res.status === 404 || /bucket not found/i.test(body)) {
      throw new Error(`The "${BUCKET}" storage bucket doesn't exist. Create it in Supabase → Storage (keep it PRIVATE).`);
    }
    throw new Error(`Upload failed (${res.status}). ${body.slice(0, 160)}`);
  }
  return { path: key, size: buffer.length };
}

/**
 * A short-lived URL for reading one stored file. The caller MUST have already
 * established that this user may see this document — signing is not authorisation.
 */
async function signedUrl(path) {
  if (!isConfigured()) throw new Error("Document storage isn't set up on the server yet.");
  const res = await storageFetch(`/object/sign/${BUCKET}/${encodeURIComponent(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
  });
  if (!res.ok) throw new Error(`Could not create a download link (${res.status}).`);
  const data = await res.json();
  // Supabase returns a path relative to /storage/v1.
  return `${URL_BASE()}/storage/v1${data.signedURL || data.signedUrl}`;
}

/** Best-effort delete. A document row going away must not fail because its file did. */
async function removeObject(path) {
  if (!isConfigured() || !path) return;
  try { await storageFetch(`/object/${BUCKET}/${encodeURIComponent(path)}`, { method: "DELETE" }); }
  catch (_) { /* the row is what matters; an orphaned object is harmless */ }
}

// One line for the startup banner, so a deployment missing its storage config says so
// out loud rather than failing the first time somebody uploads a policy.
function describeStorage() {
  if (!isConfigured()) return "not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable document uploads)";
  return `Supabase Storage, bucket "${BUCKET}"`;
}

module.exports = { isConfigured, putObject, signedUrl, removeObject, describeStorage, MAX_BYTES, BUCKET };
