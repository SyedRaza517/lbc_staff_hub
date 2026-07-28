// Sign in / sign up for the staff mobile app — rendered inside the same phone
// frame as the app itself, so signing in feels like part of the app rather than
// a separate system login.
//
// Flow:
//   sign in  -> password -> (authenticator code | first-time enrolment) -> app
//   sign up  -> details  -> pending admin approval (no account exists yet)
import React, { useState } from "react";
import { useAuth } from "./auth";
import { api } from "./api";
import { TotpSetup, TotpVerify } from "./TwoFactor";
import { ForgotPasswordForm } from "./ResetPassword";
import PhoneShell, { useIsHandset } from "./PhoneShell";
import {
  GraduationCap, LogIn, UserPlus, Mail, Lock, User, Briefcase, Building2,
  Loader2, XCircle, CheckCircle2, ArrowLeft, ShieldCheck, Wifi, BatteryFull, Clock, MapPin,
} from "lucide-react";

const NAVY = "#1a3a8f", NAVY_DARK = "#14306f", MAROON = "#9e1b32";

const DEPARTMENTS = ["Teaching", "Administration", "Finance", "Student Services", "IT", "Facilities", "Management"];
// The staff member's home site, picked at sign-up: HND, FE or SL. A home base is
// never "Online" (that's a check-in option, not a home site). Matches the server's
// validate.js HOME_SITES.
const SITES = ["HND", "FE", "SL"];

const nowTime = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Desktop demo only — a real handset draws its own clock and battery.
function StatusBar() {
  if (useIsHandset()) return null;
  return (
    <div className="flex items-center justify-between px-6 pt-1.5 text-[11px] font-semibold text-white/90">
      <span>{nowTime()}</span>
      <span className="flex items-center gap-1"><Wifi size={12} /><BatteryFull size={14} /></span>
    </div>
  );
}

// Uses the shared shell, so sign-in fills the screen on a real device and keeps
// the decorative frame on a desktop page — exactly like the app itself.
function Phone({ children, onBack }) {
  const handset = useIsHandset();
  const header = (
    <div
      className={`relative z-20 ${handset ? "" : "pt-7"}`}
      style={{
        background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY_DARK} 100%)`,
        ...(handset ? { paddingTop: "max(env(safe-area-inset-top), 10px)" } : {}),
      }}
    >
      <StatusBar />
      <div className="flex items-center gap-2 px-4 pb-4 pt-2">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="press rounded-full bg-white/15 p-1.5 text-white transition hover:bg-white/25">
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/20">
            <GraduationCap size={17} />
          </span>
          <div className="leading-tight">
            <p className="text-[13px] font-extrabold tracking-tight text-white" style={{ fontFamily: "'Lora', serif" }}>London Brookes</p>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-white/60">STAFF HUB</p>
          </div>
        </div>
      </div>
    </div>
  );
  return <PhoneShell header={header}>{children}</PhoneShell>;
}

function Labelled({ label, Icon, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <div className="relative">
        <Icon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        {children}
      </div>
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-transparent focus:ring-2 disabled:opacity-60";

function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <div className="pop flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
      <XCircle size={14} className="mt-px shrink-0" /> <span>{children}</span>
    </div>
  );
}

/* ============================== sign in ============================== */

function SignIn({ onNeedSecondStep, goSignUp, goForgot }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    const res = await signIn(email.trim(), password);
    setBusy(false);
    if (res.ok) return;                       // signed straight in (no 2FA on this account)
    if (res.mfaRequired || res.totpSetupRequired) { onNeedSecondStep(res); return; }
    setError(res.error || "Sign in failed.");
  };

  return (
    <form onSubmit={submit} className="fade-up flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800">Welcome back</h2>
        <p className="text-xs text-slate-500">Sign in to your staff account.</p>
      </div>

      <Labelled label="Email" Icon={Mail}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
          placeholder="name@lbc.ac.uk" autoComplete="username" className={inputClass} style={{ "--tw-ring-color": NAVY }} />
      </Labelled>

      <Labelled label="Password" Icon={Lock}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
          autoComplete="current-password" className={inputClass} style={{ "--tw-ring-color": NAVY }} />
      </Labelled>

      <ErrorNote>{error}</ErrorNote>

      <button type="submit" disabled={busy}
        className="press shine flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-lg transition disabled:opacity-60"
        style={{ background: `linear-gradient(135deg, ${NAVY}, ${MAROON})` }}>
        {busy ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : <><LogIn size={16} /> Sign in</>}
      </button>

      <button type="button" onClick={() => goForgot(email)} className="press -mt-1 text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">
        Forgotten your password?
      </button>

      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">New here?</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <button type="button" onClick={goSignUp}
        className="press flex items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-800">
        <UserPlus size={16} /> Create a staff account
      </button>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
        <ShieldCheck size={13} className="mt-px shrink-0" />
        Accounts created in the app are protected with an authenticator app and must be approved by a college administrator.
      </p>
    </form>
  );
}

/* ============================== sign up ============================== */

function SignUp({ goSignIn }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "", position: "", dept: DEPARTMENTS[0], site: SITES[0] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError("Enter your full name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError("Enter a valid email address."); return; }
    if (!form.position.trim()) { setError("Enter your position."); return; }
    if (form.password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (form.password !== form.confirmPassword) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await api.signUp({ ...form, name: form.name.trim(), email: form.email.trim() });
      setDone(true);
    } catch (err) {
      setError(err.message || "Could not send your request.");
    } finally {
      setBusy(false);
    }
  };

  if (done) return (
    <div className="fade-up flex flex-col items-center gap-4 p-6 text-center">
      <div className="bounce-in flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
        <CheckCircle2 size={30} />
      </div>
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800">Request sent</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Your details have gone to the college administrator for approval. You'll be able to sign in once your
          account is approved — you'll set up your authenticator app then.
        </p>
      </div>
      <div className="w-full rounded-xl bg-slate-50 p-3 text-left ring-1 ring-slate-200">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Submitted</p>
        <p className="mt-1 text-xs font-bold text-slate-700">{form.name}</p>
        <p className="text-[11px] text-slate-500">{form.email}</p>
        <p className="text-[11px] text-slate-500">{form.position} · {form.dept} · {form.site}</p>
      </div>
      <button onClick={goSignIn} className="press w-full rounded-xl py-2.5 text-sm font-bold text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${NAVY}, ${MAROON})` }}>
        Back to sign in
      </button>
    </div>
  );

  return (
    <form onSubmit={submit} className="fade-up flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800">Create your account</h2>
        <p className="text-xs text-slate-500">An administrator approves new accounts before you can sign in.</p>
      </div>

      <Labelled label="Full name" Icon={User}>
        <input value={form.name} onChange={set("name")} disabled={busy} placeholder="Jane Whitfield" autoComplete="name" className={inputClass} style={{ "--tw-ring-color": NAVY }} />
      </Labelled>

      <Labelled label="Email" Icon={Mail}>
        <input type="email" value={form.email} onChange={set("email")} disabled={busy} placeholder="name@lbc.ac.uk" autoComplete="email" className={inputClass} style={{ "--tw-ring-color": NAVY }} />
      </Labelled>

      <Labelled label="Position" Icon={Briefcase}>
        <input value={form.position} onChange={set("position")} disabled={busy} placeholder="Lecturer" className={inputClass} style={{ "--tw-ring-color": NAVY }} />
      </Labelled>

      <Labelled label="Department" Icon={Building2}>
        <select value={form.dept} onChange={set("dept")} disabled={busy} className={`${inputClass} appearance-none`} style={{ "--tw-ring-color": NAVY }}>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Labelled>

      <Labelled label="Site" Icon={MapPin}>
        <select value={form.site} onChange={set("site")} disabled={busy} className={`${inputClass} appearance-none`} style={{ "--tw-ring-color": NAVY }}>
          {SITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Labelled>

      <Labelled label="Password" Icon={Lock}>
        <input type="password" value={form.password} onChange={set("password")} disabled={busy} autoComplete="new-password" className={inputClass} style={{ "--tw-ring-color": NAVY }} />
      </Labelled>

      <Labelled label="Confirm password" Icon={Lock}>
        <input type="password" value={form.confirmPassword} onChange={set("confirmPassword")} disabled={busy} autoComplete="new-password" className={inputClass} style={{ "--tw-ring-color": NAVY }} />
      </Labelled>

      <p className="text-[11px] text-slate-400">At least 8 characters. You'll keep this password once approved.</p>

      <ErrorNote>{error}</ErrorNote>

      <button type="submit" disabled={busy}
        className="press shine flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-lg transition disabled:opacity-60"
        style={{ background: `linear-gradient(135deg, ${NAVY}, ${MAROON})` }}>
        {busy ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : <><UserPlus size={16} /> Send for approval</>}
      </button>

      <button type="button" onClick={goSignIn} className="press text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">
        I already have an account
      </button>
    </form>
  );
}

/* ============================== shell ============================== */

export default function MobileAuth({ onExit }) {
  const { applySession } = useAuth();
  // "signin" | "signup" | "verify" | "setup" | "forgot"
  const [mode, setMode] = useState("signin");
  const [challenge, setChallenge] = useState(null);
  const [forgotEmail, setForgotEmail] = useState("");

  const needSecondStep = (res) => {
    setChallenge(res);
    setMode(res.totpSetupRequired ? "setup" : "verify");
  };

  const backToSignIn = () => { setChallenge(null); setMode("signin"); };
  const goForgot = (email) => { setForgotEmail(email || ""); setMode("forgot"); };

  // The TOTP endpoints return exactly what login would have: { token, user }.
  const finish = (res) => applySession(res);

  const onBack = mode === "signin" ? onExit : backToSignIn;

  return (
    <Phone onBack={onBack}>
      {mode === "signin" && <SignIn onNeedSecondStep={needSecondStep} goSignUp={() => setMode("signup")} goForgot={goForgot} />}
      {mode === "signup" && <SignUp goSignIn={backToSignIn} />}
      {mode === "forgot" && <div className="fade-up p-5"><ForgotPasswordForm prefillEmail={forgotEmail} onBack={backToSignIn} /></div>}

      {mode === "verify" && (
        <div className="fade-up p-5">
          <TotpVerify challengeToken={challenge.challengeToken} name={challenge.name} onDone={finish} onCancel={backToSignIn} />
        </div>
      )}

      {mode === "setup" && (
        <div className="fade-up p-5">
          <div className="mb-4">
            <h2 className="text-lg font-extrabold tracking-tight text-slate-800">Secure your account</h2>
            <p className="text-xs text-slate-500">
              Your account has been approved. Set up two-step verification to finish signing in.
            </p>
          </div>
          <TotpSetup challengeToken={challenge.challengeToken} onDone={finish} onCancel={backToSignIn} />
        </div>
      )}

      {mode === "signin" && (
        <p className="flex items-center justify-center gap-1 pb-5 text-[10px] text-slate-300">
          <Clock size={11} /> London Brookes College · Staff Hub
        </p>
      )}
    </Phone>
  );
}
