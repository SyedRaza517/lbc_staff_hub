// The page an admission-upload link opens (?upload=<token>).
//
// A PUBLIC, token-based page (no login). An HND applicant opens it from a link in
// an email and uploads their application documents. The required documents are
// data-driven — the list comes from the server, never hardcoded — so admissions can
// change what they ask for without a client release. The applicant can return to the
// same link any time to add or replace a file.
import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { BrandLockup } from "./Brand";
import {
  Upload, CheckCircle2, FileText, Loader2, AlertCircle, ShieldCheck,
} from "lucide-react";

// The app's palette. Not exported from elsewhere, so declared locally.
const NAVY = "#1a3a8f", NAVY_DARK = "#14306f", MAROON = "#9e1b32";

// 15 MB, matching the client-side guard the server also enforces.
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx";

// Unit scope, NOT inside the component — a component declared inside another's body
// is a new type on every render, so React would unmount and remount its whole subtree.
function Shell({ center = false, children }) {
  return (
    <div
      className={`animated-gradient flex min-h-[100dvh] w-full justify-center p-4 sm:p-6 ${center ? "items-center" : "items-start"}`}
      style={{
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY_DARK} 55%, #0f172a 100%)`,
        backgroundSize: "220% 220%",
        paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}

export default function AdmissionUpload({ token, onDone }) {
  const [state, setState] = useState({ status: "checking" }); // checking | ready | invalid
  const [busy, setBusy] = useState({});   // { [docKey]: true } while that doc uploads
  const [errors, setErrors] = useState({}); // { [docKey]: "message" } inline per doc
  const inputs = useRef({});               // hidden <input> element per doc

  // Load (or reload) the document list from the server. Reloading after every upload
  // is the simplest way to stay perfectly consistent with the server's view.
  const load = async (signal) => {
    const res = await api.admissionUploadInfo(token);
    if (signal?.cancelled) return;
    if (res?.expired) { setState({ status: "invalid", error: "This link is invalid or has expired." }); return; }
    setState({ status: "ready", ...res });
  };

  useEffect(() => {
    const signal = { cancelled: false };
    (async () => {
      try {
        await load(signal);
      } catch (e) {
        if (!signal.cancelled) {
          const expired = e?.status === 404;
          setState({ status: "invalid", error: expired ? "This link is invalid or has expired." : (e.message || "Something went wrong loading your documents.") });
        }
      }
    })();
    return () => { signal.cancelled = true; };
  }, [token]);

  const setDoc = (key, patch) => (map) => ({ ...map, [key]: patch });

  const handleFile = async (docKey, file) => {
    // Clear any previous error for this doc.
    setErrors((m) => { const { [docKey]: _drop, ...rest } = m; return rest; });
    if (!file) return;

    // Client-side guard: reject oversize files before touching the network.
    if (file.size > MAX_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      setErrors(setDoc(docKey, `This file is ${mb} MB — the limit is 15 MB.`));
      return;
    }

    setBusy(setDoc(docKey, true));
    try {
      await api.uploadAdmissionDoc(token, docKey, file);
      // Reload the whole list — always consistent with the server.
      await load();
    } catch (e) {
      setErrors(setDoc(docKey, e.message || "Upload failed. Please try again."));
    } finally {
      setBusy((m) => { const { [docKey]: _drop, ...rest } = m; return rest; });
    }
  };

  // ---- Checking ------------------------------------------------------------
  if (state.status === "checking") return (
    <Shell center>
      <div className="scale-in rounded-2xl bg-white p-8 text-center shadow-2xl ring-1 ring-black/5">
        <div className="mb-4 flex justify-center"><BrandLockup /></div>
        <div className="flex items-center justify-center gap-2 py-2 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
          <span className="text-sm font-semibold text-slate-500">Loading your documents…</span>
        </div>
      </div>
    </Shell>
  );

  // ---- Invalid / expired ---------------------------------------------------
  if (state.status === "invalid") return (
    <Shell center>
      <div className="scale-in rounded-2xl bg-white p-8 text-center shadow-2xl ring-1 ring-black/5">
        <div className="mb-4 flex justify-center"><BrandLockup /></div>
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-200">
          <AlertCircle size={28} />
        </div>
        <h1 className="text-xl font-extrabold tracking-tight text-slate-800">This link is invalid or has expired</h1>
        <p className="mt-1 text-sm text-slate-500">
          {state.error || "Please contact the admissions team for a new upload link."}
        </p>
      </div>
    </Shell>
  );

  // ---- Ready ---------------------------------------------------------------
  const docs = Array.isArray(state.docs) ? state.docs : [];
  const uploadedCount = docs.filter((d) => d.uploaded).length;
  const allDone = docs.length > 0 && uploadedCount === docs.length;

  return (
    <Shell>
      <div className="scale-in rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5 sm:p-8">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4"><BrandLockup /></div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">
            Welcome{state.name ? `, ${state.name}` : ""}
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Please upload the documents below to complete your HND application. You can come back to this link any time to add or replace a file.
          </p>
        </div>

        {/* Progress */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Documents</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
            {uploadedCount} of {docs.length} uploaded
          </span>
        </div>

        {/* Success banner */}
        {allDone && (
          <div className="pop mb-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 size={18} className="mt-px shrink-0" />
            <span>All documents uploaded — thank you! The admissions team will review them.</span>
          </div>
        )}

        {/* Document list */}
        <div className="flex flex-col gap-3">
          {docs.map((doc) => {
            const uploading = !!busy[doc.key];
            const err = errors[doc.key];
            return (
              <div key={doc.key} className="rounded-xl bg-white p-4 ring-1 ring-slate-200 transition hover:ring-slate-300">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${doc.uploaded ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}
                    >
                      <FileText size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800">{doc.label}</p>

                      {/* Status badges */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {doc.uploaded ? (
                          <>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                              <CheckCircle2 size={12} /> Uploaded
                            </span>
                            {doc.confirmed && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200">
                                <ShieldCheck size={12} /> Verified
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
                            Not uploaded
                          </span>
                        )}
                      </div>

                      {doc.uploaded && doc.fileName && (
                        <p className="mt-1 truncate text-xs text-slate-400" title={doc.fileName}>{doc.fileName}</p>
                      )}

                      {err && (
                        <p className="pop mt-1.5 flex items-start gap-1 text-xs font-semibold text-rose-600">
                          <AlertCircle size={13} className="mt-px shrink-0" /> <span>{err}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Upload / Replace */}
                  <div className="shrink-0">
                    <input
                      ref={(el) => { inputs.current[doc.key] = el; }}
                      type="file"
                      accept={ACCEPT}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = ""; // let the same file be re-picked
                        if (f) handleFile(doc.key, f);
                      }}
                    />
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => inputs.current[doc.key]?.click()}
                      className="press flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white shadow-md transition disabled:opacity-60"
                      style={{ background: `linear-gradient(135deg, ${NAVY}, ${MAROON})` }}
                    >
                      {uploading ? (
                        <><Loader2 size={15} className="animate-spin" /> Uploading…</>
                      ) : (
                        <><Upload size={15} /> {doc.uploaded ? "Replace" : "Upload"}</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {docs.length === 0 && (
            <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
              There are no documents to upload right now.
            </p>
          )}
        </div>

        {/* Optional, subtle Done affordance */}
        {onDone && (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={onDone}
              className="text-xs font-semibold text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}
