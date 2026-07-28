// First screen for anyone who isn't signed in: choose the staff mobile app
// (which has its own in-app sign in / sign up) or the admin dashboard login.
import React from "react";
import { GraduationCap, Smartphone, Monitor, ArrowRight, ShieldCheck, UserPlus } from "lucide-react";
import { BrandLockup } from "./Brand";

const NAVY = "#1a3a8f", NAVY_DARK = "#14306f", MAROON = "#9e1b32";

function Choice({ Icon, title, subtitle, points, onClick, accent, delay }) {
  return (
    <button
      onClick={onClick}
      className="hover-lift press group flex w-full flex-col items-start gap-3 rounded-3xl border border-white/40 bg-white/95 p-6 text-left shadow-2xl ring-1 ring-black/5 backdrop-blur-xl transition fade-up"
      style={{ animationDelay: delay }}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg" style={{ background: accent }}>
        <Icon size={26} />
      </span>
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-slate-800">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
      <ul className="mt-1 space-y-1">
        {points.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <p.Icon size={12} className="shrink-0 text-slate-400" /> {p.label}
          </li>
        ))}
      </ul>
      <span className="mt-2 flex items-center gap-1 text-xs font-bold transition-all group-hover:gap-2" style={{ color: accent.includes(MAROON) ? MAROON : NAVY }}>
        Continue <ArrowRight size={14} />
      </span>
    </button>
  );
}

export default function Landing({ onStaffApp, onAdmin }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="animated-gradient absolute inset-0" style={{ background: `linear-gradient(135deg, ${NAVY_DARK} 0%, ${NAVY} 30%, #2b3f9e 55%, ${MAROON} 100%)`, backgroundSize: "220% 220%" }} />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="float absolute -top-24 -left-24 h-80 w-80 rounded-full blur-3xl" style={{ background: "rgba(99,130,255,0.35)" }} />
        <div className="float-slow absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl" style={{ background: "rgba(158,27,50,0.30)", animationDelay: "1.2s" }} />
        <div className="float absolute -bottom-28 left-1/4 h-72 w-72 rounded-full blur-3xl" style={{ background: "rgba(73,99,205,0.30)", animationDelay: "2.4s" }} />
      </div>

      <div className="relative w-full max-w-3xl">
        <div className="scale-in mb-8 flex flex-col items-center text-center">
          <div className="float mb-3 flex flex-col items-center justify-center gap-1 rounded-2xl bg-white px-5 py-3 shadow-lg ring-1 ring-slate-200/80">
            <BrandLockup />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white drop-shadow-sm" style={{ fontFamily: "'Lora', serif" }}>Staff Hub</h1>
          <p className="mt-1 text-sm text-white/70">Choose how you'd like to continue</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Choice
            Icon={Smartphone}
            title="Staff App"
            subtitle="For college staff"
            accent={`linear-gradient(135deg, ${NAVY}, #4a63cf)`}
            delay="0.05s"
            onClick={onStaffApp}
            points={[
              { Icon: UserPlus, label: "Sign in or create an account" },
              { Icon: ShieldCheck, label: "Protected by an authenticator app" },
            ]}
          />
          <Choice
            Icon={Monitor}
            title="Admin Dashboard"
            subtitle="College administrators only"
            accent={`linear-gradient(135deg, ${MAROON}, #d14a63)`}
            delay="0.14s"
            onClick={onAdmin}
            points={[
              { Icon: ShieldCheck, label: "Approve sign-ups & leave" },
              { Icon: Monitor, label: "Registers, balances, reporting" },
            ]}
          />
        </div>

        <p className="fade-up mt-7 text-center text-[11px] text-white/50" style={{ animationDelay: "0.25s" }}>
          Administrators can switch to the staff app at any time once signed in.
        </p>
      </div>
    </div>
  );
}
