import React, { useState } from "react";
import { useAuth } from "./auth";
import { TotpSetup, TotpVerify } from "./TwoFactor";
import { ForgotPasswordForm } from "./ResetPassword";
import { LogIn, Loader2, Mail, Lock, GraduationCap, ArrowLeft } from "lucide-react";
import { BrandLockup } from "./Brand";

const NAVY = "#1a3a8f", NAVY_DARK = "#14306f", MAROON = "#9e1b32";

export default function Login({ onBack }) {
  const { login, applySession, error } = useAuth();
  const [email, setEmail] = useState("admin@lbc.ac.uk");
  const [password, setPassword] = useState("password123");
  const [busy, setBusy] = useState(false);
  // Admin accounts don't use 2FA by default, but one can turn it on — so this
  // screen has to be able to finish a two-step sign-in too.
  const [challenge, setChallenge] = useState(null);
  const [forgot, setForgot] = useState(false);

  const submit = async () => {
    setBusy(true);
    const res = await login(email.trim(), password);
    setBusy(false);
    if (res?.mfaRequired || res?.totpSetupRequired) setChallenge(res);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Lora:ital,wght@0,600;1,500&display=swap');`}</style>

      {/* Animated gradient backdrop */}
      <div
        className="animated-gradient absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${NAVY_DARK} 0%, ${NAVY} 30%, #2b3f9e 55%, ${MAROON} 100%)`,
          backgroundSize: "220% 220%",
        }}
      />

      {/* Soft floating decorative blobs (behind card) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="float absolute -top-24 -left-24 h-80 w-80 rounded-full blur-3xl" style={{ background: "rgba(99,130,255,0.35)", animationDelay: "0s" }} />
        <div className="float-slow absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl" style={{ background: "rgba(158,27,50,0.30)", animationDelay: "1.2s" }} />
        <div className="float absolute -bottom-28 left-1/4 h-72 w-72 rounded-full blur-3xl" style={{ background: "rgba(73,99,205,0.30)", animationDelay: "2.4s" }} />
        <div className="float-slow absolute top-10 left-1/2 h-40 w-40 rounded-full blur-2xl" style={{ background: "rgba(255,255,255,0.10)", animationDelay: "0.6s" }} />
      </div>

      {/* Login card */}
      <div className="scale-in hover-lift relative w-full max-w-sm rounded-3xl border border-white/40 bg-white/95 p-7 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl">
        {onBack && !challenge && !forgot && (
          <button onClick={onBack} title="Back" className="press absolute left-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="mb-5 flex flex-col items-center">
          <div className="float mb-3 flex flex-col items-center justify-center gap-1 rounded-2xl bg-white px-5 py-3 shadow-lg ring-1 ring-slate-200/80">
            <BrandLockup />
          </div>
          <h1
            className="gradient-text text-2xl font-extrabold"
            style={{ backgroundImage: `linear-gradient(90deg, ${NAVY} 0%, #4a63cf 50%, ${MAROON} 100%)` }}
          >
            Staff Hub
          </h1>
          <p className="mt-0.5 text-sm text-slate-400">{challenge ? "One more step" : forgot ? "Account recovery" : "Sign in to continue"}</p>
        </div>

        {forgot ? (
          <ForgotPasswordForm prefillEmail={email} onBack={() => setForgot(false)} />
        ) : challenge ? (
          challenge.totpSetupRequired
            ? <TotpSetup challengeToken={challenge.challengeToken} onDone={applySession} onCancel={() => setChallenge(null)} />
            : <TotpVerify challengeToken={challenge.challengeToken} name={challenge.name} onDone={applySession} onCancel={() => setChallenge(null)} />
        ) : (
        <div className="space-y-4">
          <div className="fade-up" style={{ animationDelay: "0.05s" }}>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Email</label>
            <div className="group relative mt-1">
              <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-500" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="name@londonbrookescollege.co.uk"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3 text-sm outline-none transition-all duration-200 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100" />
            </div>
          </div>
          <div className="fade-up" style={{ animationDelay: "0.12s" }}>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Password</label>
            <div className="group relative mt-1">
              <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-500" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3 text-sm outline-none transition-all duration-200 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100" />
            </div>
          </div>
          {error && <p className="slide-down rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 ring-1 ring-rose-100">{error}</p>}
          <button onClick={submit} disabled={busy}
            className="shine press hover-glow flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-lg transition-all duration-200 hover:shadow-xl disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 60%, ${MAROON} 130%)`, boxShadow: "0 10px 25px -8px rgba(26,58,143,0.6)" }}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />} {busy ? "Signing in…" : "Sign in"}
          </button>
          <button onClick={() => setForgot(true)} className="press w-full text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">
            Forgotten your password?
          </button>
        </div>
        )}

        {!challenge && !forgot && (
        <div className="fade-up mt-5 rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-slate-100/60 p-3 text-[11px] text-slate-500" style={{ animationDelay: "0.2s" }}>
          <p className="font-bold text-slate-600">Demo accounts (password: <code>password123</code>)</p>
          <p className="mt-1">Admin — admin@lbc.ac.uk</p>
          <p>Staff — j.whitfield@lbc.ac.uk</p>
        </div>
        )}
      </div>
    </div>
  );
}
