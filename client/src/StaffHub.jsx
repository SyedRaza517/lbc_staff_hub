import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Clock, Check, Calendar, Plus, FileText, ThumbsUp, UserPlus, ArrowRight,
  LogIn, LogOut, ChevronLeft, ChevronRight, X, Bell, BellRing, Search,
  LayoutDashboard, Users, CalendarDays, Inbox, BarChart3, Settings, Download,
  CheckCircle2, XCircle, Clock3, MapPin, Mail, Briefcase, AlertCircle,
  Smartphone, Monitor, Coffee, Plane, Heart, Stethoscope, GraduationCap,
  Edit3, Trash2, PlusCircle, MinusCircle, Wifi, BatteryFull, SlidersHorizontal,
  ClipboardList, Save, History, Building2, FileUp, Sparkles,
  Sun, Sunrise, Sunset, TrendingUp, Timer, Info, Phone,
  CalendarCheck, UserCheck, Layers, Activity, Award, ShieldCheck,
  BookOpen, Percent, PlayCircle, RefreshCw, MoreHorizontal, MessageSquare, ChevronDown, Loader2, KeyRound, Send, Wallet
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";
import { downloadCSV } from "./csv";
import { BrandMark, BrandLockup } from "./Brand";
import ConfirmDialog from "./ConfirmDialog";
import { useBackHandler } from "./backButton";
import PhoneShell, { useIsHandset } from "./PhoneShell";
import DeleteAccount from "./DeleteAccount";
import { biometricStatus, biometryLabel, isBiometricEnabled, enableBiometric, disableBiometric } from "./biometric";
import { api } from "./api";

/* ============================================================
   LONDON BROOKES COLLEGE — STAFF HUB
   Connected system: Staff Mobile App  <->  Admin Dashboard
   Every app tab has a matching dashboard page that handles its data.
   Brand: navy #1a3a8f / accent maroon #9e1b32
   ============================================================ */

const NAVY = "#1a3a8f";
const NAVY_DARK = "#14306f";
const MAROON = "#9e1b32";

const todayISO = () => new Date().toISOString().slice(0, 10);
// Combine several per-module attendance summaries into one overall (P/L/E/A + %),
// re-deriving the percentage from summed earned/possible so it stays weighted by
// sessions, not a naive average of percentages.
const aggregateStats = (list) => {
  const acc = { P: 0, L: 0, E: 0, A: 0, marked: 0, earned: 0, possible: 0 };
  (list || []).forEach(s => { acc.P += s.P || 0; acc.L += s.L || 0; acc.E += s.E || 0; acc.A += s.A || 0; acc.marked += s.marked || 0; acc.earned += s.earned || 0; acc.possible += s.possible || 0; });
  acc.pct = acc.possible > 0 ? Math.round((acc.earned / acc.possible) * 1000) / 10 : null;
  return acc;
};
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtDay  = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const nowTime = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
function daysBetween(a, b) { const d1 = new Date(a), d2 = new Date(b); if (isNaN(d1) || isNaN(d2)) return 0; return Math.max(1, Math.round((d2 - d1) / 86400000) + 1); }

/* ---------- read-only display helpers (pure, safe fallbacks) ---------- */
const firstNameOf = (name) => (name ? String(name).split(" ")[0] : "there");
function greetingFor(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return { word: "Good morning", Icon: Sunrise };
  if (h < 17) return { word: "Good afternoon", Icon: Sun };
  return { word: "Good evening", Icon: Sunset };
}
// Minutes between two "HH:MM" strings; safe fallback to 0 if missing/invalid.
function minutesBetweenTimes(a, b) {
  if (!a || !b) return 0;
  const pa = String(a).split(":").map(Number), pb = String(b).split(":").map(Number);
  if (pa.length < 2 || pb.length < 2 || pa.some(isNaN) || pb.some(isNaN)) return 0;
  const m = (pb[0] * 60 + pb[1]) - (pa[0] * 60 + pa[1]);
  return m > 0 ? m : 0;
}
const fmtDuration = (mins) => { const m = Math.max(0, Math.round(mins || 0)); const h = Math.floor(m / 60); const r = m % 60; return h > 0 ? `${h}h ${r}m` : `${r}m`; };
// Minutes since a "HH:MM" today; safe fallback to 0.
function minutesSinceTime(a) {
  if (!a) return 0;
  const pa = String(a).split(":").map(Number);
  if (pa.length < 2 || pa.some(isNaN)) return 0;
  const now = new Date();
  const m = (now.getHours() * 60 + now.getMinutes()) - (pa[0] * 60 + pa[1]);
  return m > 0 ? m : 0;
}
// The Monday (YYYY-MM-DD) of the week containing an ISO date. UTC arithmetic so it
// doesn't drift across a BST boundary.
const mondayOf = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};

// Total worked minutes (in→out) for one staff member in a "YYYY-MM" month, plus a
// per-week breakdown. Only days with BOTH a check-in and check-out can be measured;
// days still "in" (no check-out) are counted separately so the total stays honest.
function monthlyHoursFor(checkins, staffId, month) {
  const rows = (checkins || []).filter(c => c.staffId === staffId && c.in && String(c.date).slice(0, 7) === month);
  const weeks = new Map(); // mondayISO -> minutes
  let totalMin = 0, openDays = 0, countedDays = 0;
  for (const c of rows) {
    if (!c.out) { openDays++; continue; }
    const min = minutesBetweenTimes(c.in, c.out);
    if (!(min > 0)) continue;
    totalMin += min; countedDays++;
    const monday = mondayOf(c.date);
    weeks.set(monday, (weeks.get(monday) || 0) + min);
  }
  const weekList = Array.from(weeks.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([monday, min]) => ({ monday, min }));
  return { totalMin, openDays, countedDays, weekList };
}

// Average check-in clock time across records with a real `in`; null if none.
function avgCheckInTime(checkins) {
  const ins = (checkins || []).filter(c => c && c.in).map(c => { const p = String(c.in).split(":").map(Number); return p.length >= 2 && !p.some(isNaN) ? p[0] * 60 + p[1] : null; }).filter(v => v !== null);
  if (ins.length === 0) return null;
  const avg = Math.round(ins.reduce((a, b) => a + b, 0) / ins.length);
  return `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`;
}
const leaveTypeMeta = (key) => LEAVE_TYPES.find(x => x.key === key) || { key, label: key, icon: FileText, colour: NAVY };

function useCountUp(target, dur = 700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf; const start = performance.now();
    const tick = (t) => { const p = Math.min(1, (t - start) / dur); setV(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

const LEAVE_TYPES = [
  { key: "annual",   label: "Annual Leave",  icon: Plane,         colour: "#1a3a8f" },
  { key: "sick",     label: "Sick Leave",    icon: Stethoscope,   colour: "#9e1b32" },
  { key: "personal", label: "Personal Day",  icon: Heart,         colour: "#b45309" },
  { key: "training", label: "Training / CPD",icon: GraduationCap, colour: "#0d7a5f" },
  { key: "unpaid",   label: "Unpaid Leave",  icon: Wallet,        colour: "#6d28d9" },
];
// Unpaid leave does NOT draw down the paid holiday allowance — that's the point of
// it. Keep this set in sync with the server's UNPAID_TYPES so both sides agree on
// which types are free of the allowance.
const NON_ALLOWANCE_TYPES = ["unpaid"];
/* ---------- HND attendance registers ---------- */
// The four marks a student can be given on a register, matching the college's
// existing Moodle register (P / L / E / A).
const ATT_STATUSES = [
  { key: "P", label: "Present", colour: "#059669" },
  { key: "L", label: "Late",    colour: "#b45309" },
  { key: "E", label: "Excused", colour: "#6d28d9" },
  { key: "A", label: "Absent",  colour: "#9e1b32" },
];
// Points each mark earns. Mirrors server/src/attendance.js — the server is the
// authority for the stored percentages; these are for live on-screen previews.
const ATT_POINTS = { P: 2, L: 1, E: 1, A: 0 };
const ATT_MAX = 2;
const attMeta = (key) => ATT_STATUSES.find(s => s.key === key) || null;
// Traffic-light tone for an attendance percentage. Below 70% is the level the
// college chases up, so it reads red; 85%+ is comfortably on track.
function pctTone(pct) {
  if (pct === null || pct === undefined) return { text: "text-slate-400", bg: "bg-slate-100", ring: "ring-slate-200", colour: "#94a3b8" };
  if (pct >= 85) return { text: "text-emerald-700", bg: "bg-emerald-50", ring: "ring-emerald-200", colour: "#059669" };
  if (pct >= 70) return { text: "text-amber-700", bg: "bg-amber-50", ring: "ring-amber-200", colour: "#b45309" };
  return { text: "text-rose-700", bg: "bg-rose-50", ring: "ring-rose-200", colour: MAROON };
}
const fmtPct = (pct) => (pct === null || pct === undefined ? "—" : `${pct}%`);
// Which semester a date falls in (ranges never overlap), or null if none does.
const semesterOf = (date, semesters) => (semesters || []).find(s => date >= s.start && date <= s.end) || null;
// Narrow a session list to the selected scope: "" = all, "unassigned" = outside
// every semester, otherwise the semester's own date range.
function scopeSessions(sessions, semesterId, semesters) {
  if (!semesterId) return sessions;
  if (semesterId === "unassigned") return sessions.filter(s => !semesterOf(s.date, semesters));
  const sem = (semesters || []).find(s => s.id === semesterId);
  return sem ? sessions.filter(s => s.date >= sem.start && s.date <= sem.end) : sessions;
}
const semesterLabel = (semesterId, semesters) => {
  if (!semesterId) return "All semesters";
  if (semesterId === "unassigned") return "Outside any semester";
  return (semesters || []).find(s => s.id === semesterId)?.name || "All semesters";
};
// Summarise draft marks the same way the server does, for the live tally.
function summariseDraft(values) {
  const counts = { P: 0, L: 0, E: 0, A: 0 };
  let earned = 0;
  for (const v of values) { if (!ATT_POINTS.hasOwnProperty(v)) continue; counts[v] += 1; earned += ATT_POINTS[v]; }
  const marked = counts.P + counts.L + counts.E + counts.A;
  const possible = marked * ATT_MAX;
  return { ...counts, marked, earned, possible, pct: possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null };
}

const DOC_TYPES = ["Policy", "Payroll", "HR", "Calendar", "Form"];
const DOC_TYPE_COLOUR = { Policy: "#1a3a8f", Payroll: "#0d7a5f", HR: "#6d28d9", Calendar: "#b45309", Form: "#9e1b32" };
const docTypeColour = (t) => DOC_TYPE_COLOUR[t] || "#475569";
const PALETTE = ["#1a3a8f", "#9e1b32", "#0d7a5f", "#b45309", "#6d28d9", "#0e7490", "#be123c"];
const initialsOf = (name) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

/* ---------- shared UI ---------- */
function Card({ children, className = "", style }) { return <div style={style} className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300/80 ${className}`}>{children}</div>; }
const inputCls = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
function Field({ label, children }) { return <div><label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</label><div className="mt-1">{children}</div></div>; }
function PrimaryBtn({ children, onClick, disabled, colour = NAVY, className = "" }) {
  return <button onClick={onClick} disabled={disabled} className={`shine press flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-slate-900/10 transition-all duration-200 hover:opacity-95 hover:shadow-lg hover:shadow-slate-900/15 active:scale-95 disabled:opacity-40 disabled:shadow-none ${className}`} style={{ background: `linear-gradient(135deg, ${colour} 0%, ${colour}e6 100%)` }}>{children}</button>;
}
function Modal({ open, onClose, title, children, width = 460 }) {
  // Android back closes an open modal instead of leaving the screen.
  useBackHandler(open, () => { onClose?.(); return true; });
  if (!open) return null;
  const dialog = (
    // 100dvh, and centred by the flex parent rather than by translate, so a tall
    // dialog on a short screen pins to the top and scrolls instead of overflowing
    // equally in both directions — which used to push the title and the warning
    // text off the top of an iPhone SE.
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{
        height: "100dvh",
        paddingTop: "max(env(safe-area-inset-top), 1rem)",
        paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
      }}
    >
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm slide-down" onClick={onClose} />
      <div
        className="relative my-auto w-full overflow-hidden rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200/60 pop"
        style={{ maxWidth: width }}
      >
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${NAVY}, ${MAROON})` }} />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold" style={{ color: NAVY_DARK }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
  // Rendered into <body>. A `position: fixed` element resolves against the nearest
  // TRANSFORMED ancestor, not the viewport — and every screen here sits inside a
  // `fade-up` animation, so the dialog was being positioned against that instead.
  // On short iPhones that put its title, close button and the "cannot be undone"
  // warning above the top of the screen.
  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}
// The London Brookes College logo. In tight boxes (`small`) we show just the arch
// emblem; elsewhere the full emblem + wordmark lockup. Both come from ./Brand.
function Logo({ small }) {
  return small ? <BrandMark size={30} /> : <BrandLockup />;
}
const statusBadge = (s) => ({ pending: "bg-amber-100 text-amber-700", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-rose-100 text-rose-700" }[s]);

// Two-step verification state for a staff row.
//   On       — enrolled, a code is required at every sign-in
//   Setup due — required for this account but not yet enrolled (or just reset)
//   Off      — password only (seeded staff and admins)
const twoStepBadge = (s) => {
  // An account waiting for its invitation to be accepted can't be signed into at
  // all, so say that rather than reporting on a second factor it will never reach.
  if (s.pendingActivation) return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700"><Mail size={10} /> Invited</span>;
  if (s.totpEnabled) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><ShieldCheck size={10} /> On</span>;
  if (s.totpRequired) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"><AlertCircle size={10} /> Setup due</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">Off</span>;
};

/* ---------- search + pagination helpers (presentational / local state only) ---------- */
// Clamp a 1-based page to the available range given a total count and page size.
function usePaged(items, pageSize, resetKey) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  // Reset to page 1 whenever the dependency key (e.g. search term / filter) changes.
  useEffect(() => { setPage(1); }, [resetKey]);
  // Keep the current page within bounds if the list shrinks beneath it.
  useEffect(() => { setPage(p => Math.min(p, totalPages)); }, [totalPages]);
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return { page: current, setPage, totalPages, slice, total: items.length };
}
function Pagination({ page, setPage, totalPages, total, className = "" }) {
  if (total === 0) return null;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${className}`}>
      <p className="text-xs font-semibold text-slate-400">Page {page} of {totalPages} · {total} result{total === 1 ? "" : "s"}</p>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="press flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"><ChevronLeft size={14} /> Prev</button>
        <span className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-white" style={{ background: NAVY }}>{page}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="press flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white">Next <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}
// Consistent small export button used across admin pages.
function ExportBtn({ onClick, label = "Export", className = "" }) {
  return <button onClick={onClick} className={`press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-95 ${className}`} style={{ background: NAVY }}><Download size={14} /> {label}</button>;
}

/* ============================================================ STAFF MOBILE APP ============================================================ */
export function StaffApp({ store, currentStaffId, setCurrentStaffId, logout, onChangePassword, onSwitchToAdmin }) {
  const { staff } = store;
  const [screen, setScreen] = useState("home");
  const [showNotes, setShowNotes] = useState(false);

  // Android back: close the notifications panel first, else a sub-screen returns home.
  useBackHandler(showNotes, () => { setShowNotes(false); return true; });
  useBackHandler(!showNotes && screen !== "home", () => { setScreen("home"); return true; });

  // Tapping a push notification opens the screen it refers to — the `link` the
  // server attached (e.g. "balance" for a leave decision, "approvals" for admins).
  useEffect(() => {
    const KNOWN = ["home", "checkin", "balance", "calendar", "request", "documents", "approval", "summary", "timesheet", "more"];
    const onOpen = (e) => {
      const link = e.detail === "approvals" ? "approval" : e.detail;
      setScreen(KNOWN.includes(link) ? link : "home");
    };
    window.addEventListener("push:open", onOpen);
    return () => window.removeEventListener("push:open", onOpen);
  }, []);

  const me = staff.find(s => s.id === currentStaffId) || staff[0];
  if (!me) return <div className="flex justify-center py-20 text-slate-400">Loading…</div>;

  return (
    <PhoneShell
      header={<AppHeader me={me} staff={staff} setCurrentStaffId={setCurrentStaffId} screen={screen} setScreen={setScreen} store={store} showNotes={showNotes} setShowNotes={setShowNotes} />}
    >
      {screen === "home" && <HomeGrid setScreen={setScreen} store={store} me={me} />}
      {screen === "checkin" && <CheckInScreen store={store} me={me} />}
      {screen === "balance" && <BalanceScreen store={store} me={me} />}
      {screen === "calendar" && <CalendarScreen store={store} me={me} />}
      {screen === "request" && <RequestLeaveScreen store={store} me={me} setScreen={setScreen} />}
      {screen === "documents" && <DocumentsScreen store={store} me={me} />}
      {screen === "approval" && <ApprovalScreen store={store} me={me} />}
      {screen === "summary" && <SummaryScreen store={store} me={me} />}
      {screen === "timesheet" && <TimesheetScreen store={store} me={me} />}
      {screen === "more" && <MoreScreen store={store} me={me} logout={logout} onChangePassword={onChangePassword} onSwitchToAdmin={onSwitchToAdmin} />}

      {showNotes && <NotePanel store={store} onClose={() => setShowNotes(false)} />}
    </PhoneShell>
  );
}

// The simulated status bar belongs to the desktop demo only. A real handset draws
// its own clock and battery, so showing ours would put a second, wrong clock right
// next to the real one.
function StatusBar() {
  const handset = useIsHandset();
  const [t, setT] = useState(nowTime());
  useEffect(() => { const i = setInterval(() => setT(nowTime()), 30000); return () => clearInterval(i); }, []);
  if (handset) return null;
  return (
    <div className="flex items-center justify-between px-6 pt-1.5 text-[11px] font-semibold text-white/90">
      <span>{t}</span>
      <span className="flex items-center gap-1"><Wifi size={12} /><BatteryFull size={14} /></span>
    </div>
  );
}

function AppHeader({ me, staff, setCurrentStaffId, screen, setScreen, store, showNotes, setShowNotes }) {
  const title = { home: "Staff Hub", checkin: "Daily Check-In", balance: "Holiday Balance", calendar: "Holiday Calendar", request: "Request Leave", documents: "Documents", approval: "Manager Approval", summary: "Daily Summary", timesheet: "My Timesheet", more: "More" }[screen];
  const unread = store.notes.length;
  const greet = greetingFor();
  const Greet = greet.Icon;
  const handset = useIsHandset();
  return (
    <div
      className={`relative z-20 ${handset ? "pt-2" : "pt-7"}`}
      style={{ background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY_DARK} 100%)` }}
    >
      {/* No safe-area padding here. This header sits BELOW the app's top bar,
          which already clears the notch — applying the inset again reserved the
          notch height a second time and wasted ~49px on every notched iPhone. */}
      <StatusBar />
      {/* The back arrow and the bell are the two persistent navigation controls, so
          both are sized to Apple's 44pt / Android's 48dp minimum touch target. They
          were 30-32px, about a third under, which produces mis-taps. */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        {screen !== "home" ? (
          <button onClick={() => setScreen("home")} aria-label="Back to Staff Hub" className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"><ChevronLeft size={22} /></button>
        ) : (
          <div className="flex h-11 w-12 shrink-0 items-center justify-center rounded-md bg-white px-1"><Logo small /></div>
        )}
        <div className="min-w-0 flex-1 text-center"><h1 className="truncate text-lg font-extrabold tracking-wide text-white">{title}</h1></div>
        <button
          onClick={() => setShowNotes(v => !v)}
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className={`press relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 ${unread ? "glow-pulse" : ""}`}
        >
          {unread ? <BellRing size={20} /> : <Bell size={20} />}
          {unread > 0 && <span className="pop absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-slate-900 ring-2 ring-[#14306f]">{unread}</span>}
        </button>
      </div>
      {screen === "home" && (
        <div className="px-4 pb-5 fade-up">
          <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/10 backdrop-blur transition-all hover:bg-white/15">
            <div className="float flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white shadow-lg ring-2 ring-white/20" style={{ background: me.colour }}>{me.initials}</div>
            <div className="flex-1">
              <p className="flex items-center gap-1 text-[11px] font-medium text-white/70"><Greet size={12} className="text-amber-300" /> {greet.word}, {firstNameOf(me.name)}</p>
              <p className="text-[15px] font-bold text-white">{me.name}</p>
              <p className="text-[11px] text-white/60">{me.role}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NotePanel({ store, onClose }) {
  return (
    <div className="absolute inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="slide-down absolute left-3 right-3 top-3 max-h-[70%] overflow-y-auto rounded-2xl bg-white p-3 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-extrabold" style={{ color: NAVY }}>Notifications</p>
          <div className="flex gap-2">
            {store.notes.length > 0 && <button onClick={() => store.setNotes([])} className="text-[11px] font-semibold text-slate-400 hover:text-slate-600">Clear</button>}
            <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
          </div>
        </div>
        {store.notes.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No notifications yet.</p>}
        <div className="space-y-1.5">
          {store.notes.map(n => (
            <div key={n.id} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: n.type === "success" ? "#059669" : n.type === "error" ? MAROON : NAVY }} />
              <div><p className="text-xs font-medium text-slate-700">{n.msg}</p><p className="text-[10px] text-slate-400">{n.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TILES = [
  { key: "checkin", label: "Daily Check-In", Icon: Clock, sub: "Clock in & out" },
  { key: "balance", label: "Holiday Balance", Icon: Check, sub: "Days remaining" },
  { key: "calendar", label: "Holiday Calendar", Icon: Calendar, sub: "Who's off & when" },
  { key: "request", label: "Request Leave", Icon: Plus, sub: "Book time off" },
  { key: "documents", label: "Documents", Icon: FileText, sub: "Policies & forms" },
  { key: "approval", label: "Manager Approval", Icon: ThumbsUp, sub: "Review requests" },
  { key: "summary", label: "Staff Daily Summary", Icon: UserPlus, sub: "Log your day" },
  { key: "timesheet", label: "Send Timesheet", Icon: ClipboardList, sub: "Log hours & submit" },
  { key: "more", label: "More", Icon: ArrowRight, sub: "Profile & settings" },
];
const STAFF_TIPS = [
  "Check in each morning so your team knows you're on site.",
  "Book annual leave early — it helps your manager plan cover.",
  "Add a daily summary to keep a record of your work.",
  "Find every policy and payroll form under Documents.",
  "Your holiday balance updates the moment a request is approved.",
];

function HomeGrid({ setScreen, store, me }) {
  const today = todayISO();
  const myToday = store.checkins.find(c => c.staffId === me.id && c.date === today && c.in);
  const pending = store.leave.filter(l => l.staffId === me.id && l.status === "pending").length;
  const left = store.remaining(me.id);
  // Read-only display values for the hero band.
  const heroStatus = myToday ? (myToday.out ? "Day complete — see you tomorrow" : "You're checked in") : "Not checked in yet";
  const heroIcon = myToday ? (myToday.out ? CheckCircle2 : UserCheck) : Clock;
  const HeroIcon = heroIcon;
  const tip = STAFF_TIPS[new Date().getDate() % STAFF_TIPS.length];
  return (
    <div className="p-4">
      {/* Hero / summary band */}
      <div className="animated-gradient relative mb-4 overflow-hidden rounded-2xl p-4 text-white shadow-md fade-up" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 55%, ${MAROON} 140%)`, backgroundSize: "200% 200%" }}>
        <Sparkles size={56} className="float-slow absolute -right-2 -top-2 text-white/10" />
        <p className="relative text-[11px] font-semibold uppercase tracking-wide text-white/60">{fmtDay(today)}</p>
        <p className="relative mt-1 flex items-center gap-1.5 text-base font-extrabold"><HeroIcon size={17} className="text-amber-300" /> {heroStatus}</p>
        <p className="relative mt-0.5 text-[12px] text-white/70">{left > 0 ? `${left} day${left === 1 ? "" : "s"} of holiday left` : "No holiday remaining"}{pending > 0 ? ` · ${pending} request${pending === 1 ? "" : "s"} pending` : ""}</p>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2 fade-up">
        <MiniStat label="Status" value={myToday ? (myToday.out ? "Done" : "In") : "Out"} tone={myToday && !myToday.out ? "green" : "grey"} Icon={myToday && !myToday.out ? UserCheck : Clock} />
        <MiniStat label="Holiday left" value={`${left}d`} tone="navy" Icon={Plane} />
        <MiniStat label="Pending" value={pending} tone={pending ? "amber" : "grey"} Icon={Inbox} />
      </div>
      <p className="mb-3 text-center text-sm font-semibold italic text-slate-500" style={{ fontFamily: "'Lora', serif" }}>Please select one of the buttons below</p>
      <div className="grid grid-cols-2 gap-3">
        {TILES.filter(t => t.key !== "approval" || store.isAdmin).map((t, i) => {
          const badge = t.key === "approval" ? store.leave.filter(l => l.status === "pending").length : t.key === "request" ? pending : 0;
          return (
            <button key={t.key} onClick={() => setScreen(t.key)} className="shine hover-lift group relative flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:shadow-xl hover:ring-blue-200 active:scale-95 pop" style={{ animationDelay: `${i * 60}ms` }}>
              {badge > 0 && <span className="pop absolute right-2.5 top-2.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900 shadow-sm ring-2 ring-amber-200">{badge}</span>}
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:-rotate-6 group-active:scale-95" style={{ background: "linear-gradient(135deg, rgba(26,58,143,0.12), rgba(158,27,50,0.07))" }}>
                <t.Icon size={26} style={{ color: NAVY }} strokeWidth={2.2} />
              </span>
              <span className="text-center text-[13px] font-bold leading-tight" style={{ color: NAVY }}>{t.label}</span>
              <span className="text-center text-[10px] font-medium leading-tight text-slate-400">{t.sub}</span>
            </button>
          );
        })}
      </div>
      {/* Tip of the day */}
      <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-blue-50/70 p-3 ring-1 ring-blue-100 fade-up">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm"><Info size={15} style={{ color: NAVY }} /></span>
        <div><p className="text-[11px] font-bold uppercase tracking-wide text-blue-800/70">Tip of the day</p><p className="text-[12px] text-slate-600">{tip}</p></div>
      </div>
    </div>
  );
}
function MiniStat({ label, value, tone, Icon }) {
  const tones = { green: "bg-emerald-50 text-emerald-700 ring-emerald-200", amber: "bg-amber-50 text-amber-700 ring-amber-200", navy: "bg-blue-50 text-blue-800 ring-blue-200", grey: "bg-slate-50 text-slate-600 ring-slate-200" }[tone];
  return (
    <div className={`rounded-xl px-2 py-2.5 text-center ring-1 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-sm ${tones}`}>
      {Icon && <Icon size={14} className="mx-auto mb-1 opacity-70" />}
      <p className="text-[15px] font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-medium opacity-80">{label}</p>
    </div>
  );
}
function Screen({ children }) { return <div className="p-4 fade-up">{children}</div>; }
function EmptyState({ Icon = Inbox, title = "Nothing here yet", msg = "", className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center px-4 py-8 text-center ${className}`}>
      <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-100"><Icon size={22} className="text-slate-300" /></span>
      <p className="text-sm font-bold text-slate-500">{title}</p>
      {msg && <p className="mt-0.5 max-w-[220px] text-xs text-slate-400">{msg}</p>}
    </div>
  );
}
// Small read-only legend chip list for leave types.
function LeaveLegend({ types = LEAVE_TYPES, className = "" }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {types.map(t => <span key={t.key} className="flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-[10px] font-bold ring-1 ring-slate-200" style={{ color: t.colour }}><span className="h-2 w-2 rounded-full" style={{ background: t.colour }} />{t.label}</span>)}
    </div>
  );
}

/* ----- Check-In ----- */
// How a check-in happened: Onsite (in a campus) or Online (remote). Kept in sync
// with the server's validate.js SITES.
const SITES = ["Onsite", "Online"];
// A staff member's HOME site — HND, FE or SL, chosen at sign-up. Used by the
// Staff-tab filter and the Add/Edit Staff form. Matches validate.js HOME_SITES.
const HOME_SITES = ["HND", "FE", "SL"];

function CheckInScreen({ store, me }) {
  const today = todayISO();
  const rec = store.checkins.find(c => c.staffId === me.id && c.date === today);
  // A summary-first row has an empty `in` — that is NOT a real check-in, so treat it as
  // "not checked in" (offer the Check In button, which fills the time server-side).
  const checkedIn = rec && rec.in;
  const [clock, setClock] = useState(new Date());
  // Which site they're clocking in from today. Must be chosen before the button
  // enables, so every check-in carries a site.
  const [site, setSite] = useState(null);
  useEffect(() => { const i = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(i); }, []);
  const checkIn = () => store.checkIn(site);
  const checkOut = () => store.checkOut(rec.id);
  return (
    <Screen>
      <Card className="text-center">
        <div className={`mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full ring-4 ring-white shadow-inner bounce-in ${checkedIn && !rec.out ? "glow-pulse" : ""}`} style={{ background: checkedIn ? (rec.out ? "#e2e8f0" : "rgba(16,185,129,.12)") : "rgba(26,58,143,.08)" }}>
          <Clock size={40} className="float-slow" style={{ color: checkedIn && !rec.out ? "#059669" : NAVY }} />
        </div>
        <p className="text-2xl font-extrabold tabular-nums" style={{ color: NAVY }}>{clock.toLocaleTimeString("en-GB")}</p>
        <p className="text-sm text-slate-500">{fmtDay(today)}</p>
        <p className="mb-1 mt-2 text-lg font-bold" style={{ color: checkedIn && !rec.out ? "#059669" : "#475569" }}>{checkedIn ? (rec.out ? "✓ Checked Out" : "● Checked In") : "Not Checked In"}</p>
        {checkedIn && <p className="text-xs text-slate-500">In at {rec.in}{rec.out && ` · Out at ${rec.out}`}{rec.site && ` · ${rec.site}`}</p>}
        {checkedIn && (() => {
          // Read-only "hours on site": from in→out if checked out, else in→now. Safe fallback to 0.
          const mins = rec.out ? minutesBetweenTimes(rec.in, rec.out) : minutesSinceTime(rec.in);
          const pct = Math.max(0, Math.min(100, Math.round((mins / 480) * 100))); // of a nominal 8h day
          return (
            <div className="mx-auto mt-4 max-w-[240px]">
              <div className="mb-1.5 flex items-center justify-center gap-1.5 text-xs font-semibold" style={{ color: rec.out ? "#475569" : "#059669" }}>
                <Timer size={14} /> {fmtDuration(mins)} on site{!rec.out ? " so far" : ""}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100 shadow-inner">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: rec.out ? "linear-gradient(90deg,#94a3b8,#cbd5e1)" : "linear-gradient(90deg,#059669,#34d399)", transition: "width .8s cubic-bezier(.4,0,.2,1)" }} />
              </div>
            </div>
          );
        })()}
        {!checkedIn && (
          <div className="mt-5 text-left">
            <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-slate-400">Where are you working today?</p>
            <div className="grid grid-cols-2 gap-2">
              {SITES.map(s => {
                const active = site === s;
                return (
                  <button
                    key={s}
                    onClick={() => setSite(s)}
                    className={`press rounded-xl py-2.5 text-sm font-bold ring-1 transition-all ${active ? "text-white ring-transparent shadow-md" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
                    style={active ? { background: NAVY } : {}}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-5">
          {!checkedIn && <PrimaryBtn onClick={checkIn} disabled={!site} className="w-full !py-3.5 text-base"><LogIn size={20} /> {site ? `Check In · ${site}` : "Choose onsite or online"}</PrimaryBtn>}
          {checkedIn && !rec.out && <PrimaryBtn onClick={checkOut} colour={MAROON} className="w-full !py-3.5 text-base"><LogOut size={20} /> Check Out</PrimaryBtn>}
          {checkedIn && rec.out && <div className="rounded-xl bg-emerald-50 py-3 text-sm font-semibold text-emerald-700">✓ Your day is complete. Have a great evening!</div>}
        </div>
      </Card>
      <p className="mb-2 mt-5 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Recent activity</p>
      <Card className="p-0">
        {store.checkins.filter(c => c.staffId === me.id && c.in).length === 0 && (
          <EmptyState Icon={History} title="No activity yet" msg="Your check-ins will appear here once you clock in." />
        )}
        {store.checkins.filter(c => c.staffId === me.id && c.in).slice(0, 6).map((c, i, a) => (
          <div key={c.id} className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-slate-50/70 fade-up ${i < a.length - 1 ? "border-b border-slate-100" : ""}`} style={{ animationDelay: `${i * 50}ms` }}>
            <div><p className="text-sm font-semibold text-slate-700">{fmtDay(c.date)}{c.site && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 align-middle">{c.site}</span>}</p><p className="text-xs text-slate-400">In {c.in}{c.out ? ` · Out ${c.out}` : " · still in"}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${c.out ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700"}`}>{c.out ? "Complete" : "Active"}</span>
          </div>
        ))}
      </Card>
    </Screen>
  );
}

/* ----- Holiday Balance ----- */
function BalanceScreen({ store, me }) {
  const allowance = store.effectiveAllowance(me.id);
  const used = store.usedDays(me.id);
  const bankUsed = store.bankHolidayDaysUsed();
  const left = allowance - used - bankUsed;
  const myLeave = store.leave.filter(l => l.staffId === me.id);
  const myAdj = store.adjustments.filter(a => a.staffId === me.id);
  const animLeft = useCountUp(left);
  // Read-only counts of this user's leave by type (any status), days summed safely.
  const byType = LEAVE_TYPES.map(t => {
    const rows = myLeave.filter(l => l.type === t.key);
    const days = rows.reduce((sum, l) => sum + daysBetween(l.start, l.end), 0);
    return { ...t, count: rows.length, days };
  }).filter(x => x.count > 0);
  const usedPct = allowance > 0 ? Math.round(((used + bankUsed) / allowance) * 100) : 0;
  return (
    <Screen>
      <Card>
        <div className="flex items-center justify-center">
          <div className="relative h-40 w-40">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#eef1f6" strokeWidth="14" />
              <circle cx="60" cy="60" r="52" fill="none" stroke={NAVY} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 52}`} strokeDashoffset={`${2 * Math.PI * 52 * (1 - (allowance > 0 ? left / allowance : 0))}`} style={{ transition: "stroke-dashoffset 1s ease" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center scale-in"><span className="text-4xl font-extrabold tabular-nums" style={{ color: NAVY }}>{animLeft}</span><span className="text-xs font-medium text-slate-400">days left</span></div>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] font-semibold text-slate-400">{usedPct}% of your allowance used</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 py-2"><p className="text-lg font-extrabold text-slate-700">{allowance}</p><p className="text-[11px] text-slate-400">Allowance</p></div>
          <div className="rounded-xl py-2" style={{ background: MAROON + "0d" }}><p className="text-lg font-extrabold" style={{ color: MAROON }}>{used}</p><p className="text-[11px] text-slate-400">Leave used</p></div>
          <div className="rounded-xl py-2" style={{ background: NAVY + "0d" }}><p className="text-lg font-extrabold" style={{ color: NAVY }}>{bankUsed}</p><p className="text-[11px] text-slate-400">Bank holidays</p></div>
          <div className="rounded-xl bg-emerald-50 py-2"><p className="text-lg font-extrabold text-emerald-600">{left}</p><p className="text-[11px] text-slate-400">Remaining</p></div>
        </div>
        {myAdj.length > 0 && <p className="mt-3 text-center text-[11px] text-slate-400">Includes {store.adjDays(me.id) >= 0 ? "+" : ""}{store.adjDays(me.id)}d HR adjustment</p>}
      </Card>
      {byType.length > 0 && (
        <Card className="mt-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Your leave by type</p>
          <div className="space-y-2">
            {byType.map(t => { const T = t.icon; return (
              <div key={t.key} className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: t.colour + "1a" }}><T size={14} style={{ color: t.colour }} /></span>
                <span className="flex-1 text-sm font-semibold text-slate-600">{t.label}</span>
                <span className="text-xs font-bold text-slate-400">{t.count} req · {t.days}d</span>
              </div>
            ); })}
          </div>
        </Card>
      )}
      <p className="mb-2 mt-5 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Leave history</p>
      <div className="space-y-2">
        {myLeave.length === 0 && <Card><EmptyState Icon={Plane} title="No leave records yet" msg="Requests you submit will show up here." /></Card>}
        {myLeave.slice().reverse().map((l, i) => <LeaveRow key={l.id} l={l} i={i} />)}
      </div>
    </Screen>
  );
}
function LeaveRow({ l, i = 0 }) {
  const t = leaveTypeMeta(l.type); const T = t.icon;
  return (
    <Card className="!p-3 fade-up" style={{ animationDelay: `${i * 50}ms` }}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-300 hover:scale-110" style={{ background: t.colour + "1a" }}><T size={18} style={{ color: t.colour }} /></span>
        <div className="flex-1"><p className="text-sm font-semibold text-slate-700">{t.label}</p><p className="text-xs text-slate-400">{fmtDate(l.start)}{l.end !== l.start && ` → ${fmtDate(l.end)}`} · {daysBetween(l.start, l.end)}d</p></div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${statusBadge(l.status)}`}>{l.status}</span>
      </div>
      {l.note && l.status !== "pending" && <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] italic text-slate-500">Manager: "{l.note}"</p>}
    </Card>
  );
}

/* ----- Calendar ----- */
function MonthGrid({ store, big }) {
  const [cursor, setCursor] = useState(new Date());
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const startPad = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const approved = store.leave.filter(l => l.status === "approved");
  return (
    <div>
      <div className={`mb-3 flex items-center justify-between ${big ? "" : ""}`}>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-lg p-1.5 transition hover:bg-slate-100 active:scale-90"><ChevronLeft size={18} /></button>
        <p className={`font-extrabold ${big ? "text-lg" : "text-base"}`} style={{ color: NAVY }}>{cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-lg p-1.5 transition hover:bg-slate-100 active:scale-90"><ChevronRight size={18} /></button>
      </div>
      <div className={`grid grid-cols-7 ${big ? "gap-1.5" : "gap-1"} text-center text-[10px] font-bold text-slate-400`}>
        {(big ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["M", "T", "W", "T", "F", "S", "S"]).map((d, i) => <div key={i} className="py-1">{d}</div>)}
      </div>
      <div className={`grid grid-cols-7 ${big ? "gap-1.5" : "gap-1"}`}>
        {Array.from({ length: startPad }).map((_, i) => <div key={"p" + i} />)}
        {Array.from({ length: days }).map((_, i) => {
          const d = i + 1; const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const isToday = iso === todayISO(); const evts = approved.filter(l => iso >= l.start && iso <= l.end);
          const bh = store.bankHolidaySet.get(iso); // bank holiday name, or undefined
          if (big) return (
            <div key={d} title={bh || undefined} className={`min-h-[78px] rounded-xl border p-1.5 transition-all duration-200 hover:shadow-sm ${bh ? "border-amber-300 bg-amber-50" : isToday ? "border-blue-300 bg-blue-50/40 glow-pulse" : "border-slate-100 hover:border-blue-200 hover:bg-blue-50/30"}`}>
              <p className={`text-xs font-bold ${isToday ? "text-blue-700" : bh ? "text-amber-700" : "text-slate-400"}`}>{d}</p>
              {bh && <div className="mt-0.5 truncate rounded bg-amber-400 px-1 py-0.5 text-[8px] font-bold text-white">🏛 {bh}</div>}
              <div className="mt-1 space-y-0.5">{evts.slice(0, 3).map(e => { const p = store.staff.find(s => s.id === e.staffId); const t = LEAVE_TYPES.find(x => x.key === e.type); return <div key={e.id} className="truncate rounded px-1 py-0.5 text-[9px] font-bold text-white" style={{ background: t.colour }}>{p?.initials} {t.label.split(" ")[0]}</div>; })}{evts.length > 3 && <p className="text-[9px] text-slate-400">+{evts.length - 3}</p>}</div>
            </div>
          );
          return (
            <div key={d} title={bh || undefined} className={`relative flex h-9 flex-col items-center justify-center rounded-lg text-[13px] transition-all duration-200 ${isToday ? "font-bold text-white glow-pulse" : bh ? "bg-amber-100 font-semibold text-amber-700" : "text-slate-600 hover:bg-slate-100"}`} style={isToday ? { background: NAVY } : {}}>
              {d}{(evts.length > 0 || bh) && <div className="absolute bottom-1 flex gap-0.5">{bh && <span className="h-1 w-1 rounded-full bg-amber-500" />}{evts.slice(0, 2).map((e, k) => <span key={k} className="h-1 w-1 rounded-full" style={{ background: LEAVE_TYPES.find(t => t.key === e.type).colour }} />)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// A compact list of the current calendar year's bank holidays, flagging which have
// already passed (and so have been counted against everyone's 28-day allowance).
function BankHolidayList({ store }) {
  const year = new Date().getFullYear();
  const today = todayISO();
  const list = store.bankHolidays.filter(h => h.date.slice(0, 4) === String(year));
  if (list.length === 0) return null;
  const passed = list.filter(h => h.date <= today).length;
  return (
    <div className="mt-5">
      <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Bank holidays {year} · {passed}/{list.length} counted so far</p>
      <Card className="p-0">
        {list.map((h, i, a) => { const done = h.date <= today; return (
          <div key={h.date} className={`flex items-center gap-3 px-4 py-2.5 ${i < a.length - 1 ? "border-b border-slate-100" : ""}`}>
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${done ? "bg-amber-100" : "bg-slate-100"}`}>🏛</span>
            <div className="flex-1"><p className="text-sm font-semibold text-slate-700">{h.name}</p><p className="text-[11px] text-slate-400">{fmtDate(h.date)}</p></div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${done ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>{done ? "Counted" : "Upcoming"}</span>
          </div>
        ); })}
      </Card>
    </div>
  );
}

function CalendarScreen({ store }) {
  const approved = store.leave.filter(l => l.status === "approved");
  return (
    <Screen>
      <Card>
        <MonthGrid store={store} />
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Leave types</p>
          <LeaveLegend />
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" /> Bank holiday — counts toward your 28 days automatically</div>
        </div>
      </Card>
      <BankHolidayList store={store} />
      <p className="mb-2 mt-5 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Who's off (approved)</p>
      <div className="space-y-2">
        {approved.length === 0 && <Card><EmptyState Icon={CalendarCheck} title="No approved leave" msg="Approved absences across the college will appear here." /></Card>}
        {approved.map((l, i) => { const p = store.staff.find(s => s.id === l.staffId); const t = leaveTypeMeta(l.type); return (
          <Card key={l.id} className="flex items-center gap-3 !p-3 fade-up" style={{ animationDelay: `${i * 50}ms` }}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: p?.colour }}>{p?.initials}</span>
            <div className="flex-1"><p className="text-sm font-semibold text-slate-700">{p?.name}</p><p className="text-xs text-slate-400">{fmtDate(l.start)}{l.end !== l.start && ` → ${fmtDate(l.end)}`}</p></div>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: t.colour + "1a", color: t.colour }}>{t.label}</span>
          </Card>
        ); })}
      </div>
    </Screen>
  );
}

/* ----- Request Leave ----- */
function RequestLeaveScreen({ store, me, setScreen }) {
  const [type, setType] = useState("annual");
  const [start, setStart] = useState(todayISO());
  const [end, setEnd] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const [autoOk, setAutoOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const days = daysBetween(start, end);
  const left = store.remaining(me.id);
  // Bank holidays inside the range are already days off for everyone: they aren't
  // charged, and a request made up ENTIRELY of them is approved automatically.
  const bankInRange = store.bankHolidays.filter(h => h.date >= start && h.date <= end).length;
  const allBank = days > 0 && bankInRange >= days;
  const chargedDays = Math.max(0, days - bankInRange);
  // A ref, not just state: two taps in the same tick would both read the old
  // state value, but both see the ref. The whole round trip is a window in which
  // the button is otherwise still live, and a double-tap booked the leave twice.
  const sending = useRef(false);
  const submit = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try { await store.requestLeave({ type, start, end, reason }); setAutoOk(allBank); setDone(true); }
    catch (e) {}
    finally { sending.current = false; setBusy(false); }
  };
  if (done) return (
    <Screen>
      <Card className="text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 ring-4 ring-emerald-50 bounce-in"><CheckCircle2 size={36} className="text-emerald-600" /></div>
        <p className="text-xl font-extrabold" style={{ color: NAVY }}>{autoOk ? "Approved Automatically" : "Request Submitted"}</p>
        <p className="mt-1 text-sm text-slate-500">{autoOk ? "That's a bank holiday — approved automatically, no manager needed. See it under Holiday Balance." : "Your manager has been notified. Track it under Holiday Balance."}</p>
        <div className="mt-5 flex gap-2"><PrimaryBtn onClick={() => setScreen("home")} className="flex-1">Back to Hub</PrimaryBtn><button onClick={() => { setDone(false); setReason(""); }} className="flex-1 rounded-xl border-2 border-slate-200 py-2.5 text-sm font-bold text-slate-600">New request</button></div>
      </Card>
    </Screen>
  );
  return (
    <Screen>
      <Card>
        <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Leave type</label>
        <div className="mb-4 mt-2 grid grid-cols-2 gap-2">
          {LEAVE_TYPES.map((t, i) => { const T = t.icon; const on = type === t.key; return (
            <button key={t.key} onClick={() => setType(t.key)} className={`flex items-center gap-2 rounded-xl border-2 p-2.5 text-left transition-all duration-200 hover:-translate-y-0.5 active:scale-95 pop ${on ? "border-transparent shadow-sm" : "border-slate-200 bg-white"}`} style={on ? { background: t.colour + "12", borderColor: t.colour, animationDelay: `${i * 50}ms` } : { animationDelay: `${i * 50}ms` }}>
              <T size={18} className="transition-transform" style={{ color: t.colour }} /><span className="text-[12px] font-bold" style={{ color: on ? t.colour : "#475569" }}>{t.label}</span>
            </button>
          ); })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" value={start} onChange={e => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} className={inputCls} /></Field>
          <Field label="To"><input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="mt-4"><Field label="Reason (optional)"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Add a short note for your manager…" className={inputCls + " resize-none"} /></Field></div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm"><span className="text-slate-500">Duration</span><span className="font-bold" style={{ color: NAVY }}>{days} day{days > 1 ? "s" : ""}{bankInRange > 0 && !allBank ? ` · ${chargedDays} charged` : ""}</span></div>
        {allBank
          ? <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700"><Info size={15} /> Bank holiday — approved automatically, no manager approval needed.</div>
          : chargedDays > left && <div className="mt-2 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600"><AlertCircle size={15} /> Exceeds your {left} remaining days</div>}
        <PrimaryBtn onClick={submit} disabled={busy || (!allBank && chargedDays > left)} className="mt-5 w-full !py-3.5">
          {busy ? <><Loader2 size={18} className="animate-spin" /> Submitting…</> : allBank ? <><CheckCircle2 size={18} /> Confirm (auto-approved)</> : <><Plus size={18} /> Submit Request</>}
        </PrimaryBtn>
      </Card>
    </Screen>
  );
}

/* ----- Documents ----- */
function DocumentsScreen({ store, me }) {
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const visible = store.docs.filter(d => d.scope === "all" || d.assignedTo === me.id);
  const filtered = visible.filter(d => (filter === "All" || d.type === filter) && d.name.toLowerCase().includes(q.toLowerCase()));
  const iconFor = (t) => ({ Policy: FileText, Payroll: Briefcase, Calendar: CalendarDays, HR: Users, Form: ClipboardList }[t] || FileText);
  const types = ["All", ...Array.from(new Set(visible.map(d => d.type)))];
  return (
    <Screen>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={16} className="text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search documents…" className="w-full bg-transparent text-sm outline-none" /></div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {types.map(t => <button key={t} onClick={() => setFilter(t)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-all duration-200 active:scale-95 ${filter === t ? "text-white shadow-sm" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-slate-300"}`} style={filter === t ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` } : {}}>{t}</button>)}
      </div>
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold text-slate-400">
        <span>{filtered.length} document{filtered.length === 1 ? "" : "s"}{filter !== "All" ? ` · ${filter}` : ""}</span>
        {visible.some(d => d.scope === "personal" && d.assignedTo === me.id) && <span className="flex items-center gap-1"><ShieldCheck size={12} /> includes private</span>}
      </div>
      <div className="space-y-2">
        {filtered.length === 0 && <Card><EmptyState Icon={FileText} title="No documents found" msg="Try a different filter or search term." /></Card>}
        {filtered.map((d, i) => { const I = iconFor(d.type); const dc = docTypeColour(d.type); return (
          <Card key={d.id} className="group flex items-center gap-3 !p-3.5 fade-up" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110" style={{ background: dc + "14" }}><I size={20} style={{ color: dc }} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-700">{d.name}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: dc + "1a", color: dc }}>{d.type}</span>
                <span className="text-xs text-slate-400">{fmtDate(d.date)}{d.scope === "personal" ? " · Private" : ""}</span>
              </div>
            </div>
            <button onClick={() => store.notify(`Downloading "${d.name}"…`)} className="rounded-lg p-2 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600 active:scale-90"><Download size={18} /></button>
          </Card>
        ); })}
      </div>
    </Screen>
  );
}

/* ----- Manager Approval (in app) ----- */
function ApprovalScreen({ store, me }) {
  if (!store.isAdmin) return <div className="p-4 text-slate-400">Access denied</div>;
  const pending = store.leave.filter(l => l.status === "pending");
  const act = (l, status) => store.decideLeave(l.id, status);
  return (
    <Screen>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5 text-xs font-medium text-blue-800"><ThumbsUp size={15} /> {pending.length} request{pending.length === 1 ? "" : "s"} awaiting your approval</div>
      {pending.length === 0 && <Card><EmptyState Icon={CheckCircle2} title="All caught up" msg="There are no pending requests to review right now." /></Card>}
      <div className="space-y-3">
        {pending.map((l, i) => { const p = store.staff.find(s => s.id === l.staffId); const t = leaveTypeMeta(l.type); return (
          <Card key={l.id} className="fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: p?.colour }}>{p?.initials}</span>
              <div className="flex-1"><p className="text-sm font-bold text-slate-700">{p?.name}</p><p className="text-xs text-slate-400">{p?.role}</p></div>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: t.colour + "1a", color: t.colour }}>{t.label}</span>
            </div>
            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600"><p><b>{fmtDate(l.start)}</b>{l.end !== l.start && <> → <b>{fmtDate(l.end)}</b></>} · {daysBetween(l.start, l.end)} day(s)</p><p className="mt-1 italic text-slate-500">"{l.reason}"</p></div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => act(l, "rejected")} className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-rose-200 py-2.5 text-sm font-bold text-rose-600 transition hover:bg-rose-50 active:scale-95"><XCircle size={16} /> Decline</button>
              <PrimaryBtn onClick={() => act(l, "approved")} colour="#059669" className="!py-2.5"><CheckCircle2 size={16} /> Approve</PrimaryBtn>
            </div>
          </Card>
        ); })}
      </div>
    </Screen>
  );
}

/* ----- Daily Summary ----- */
function SummaryScreen({ store, me }) {
  const today = todayISO();
  const rec = store.checkins.find(c => c.staffId === me.id && c.date === today);
  const [text, setText] = useState(rec?.summary || "");
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await store.saveSummary(today, text);
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };
  return (
    <Screen>
      <Card>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{fmtDay(today)}</p>
        <p className="mb-3 text-lg font-extrabold" style={{ color: NAVY }}>What did you work on today?</p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={6} placeholder="e.g. Taught Y12 Maths, marked mock papers, met admissions about September intake…" className={inputCls + " resize-none"} />
        <PrimaryBtn onClick={save} colour={saved ? "#059669" : NAVY} className="mt-3 w-full !py-3">{saved ? <><Check size={18} /> Saved & shared</> : "Save Daily Summary"}</PrimaryBtn>
      </Card>
      <p className="mb-2 mt-5 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Recent summaries</p>
      <div className="space-y-2">
        {store.checkins.filter(c => c.staffId === me.id && c.summary).length === 0 && <Card><EmptyState Icon={ClipboardList} title="No summaries yet" msg="Save a daily summary above and it will appear here." /></Card>}
        {store.checkins.filter(c => c.staffId === me.id && c.summary).slice(0, 4).map((c, i) => <Card key={c.id} className="!p-3 fade-up" style={{ animationDelay: `${i * 50}ms` }}><p className="text-xs font-bold text-slate-400">{fmtDay(c.date)}</p><p className="mt-1 text-sm text-slate-600">{c.summary}</p></Card>)}
      </div>
    </Screen>
  );
}

// App-lock toggle. Renders nothing on the web (no sensor), and explains itself when
// the device has biometrics but the user hasn't enrolled any.
function BiometricSetting() {
  const [status, setStatus] = useState(null);
  const [on, setOn] = useState(isBiometricEnabled());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => { biometricStatus().then(setStatus); }, []);

  // Not the packaged app: nothing to offer.
  if (status && status.reason === "not-native") return null;
  if (!status) return null;

  const label = biometryLabel(status.biometryType);
  const toggle = async () => {
    setBusy(true); setNote("");
    const res = on ? await disableBiometric() : await enableBiometric();
    setBusy(false);
    if (res.ok) { setOn(!on); return; }
    if (res.reason !== "cancelled") setNote(res.reason || "Could not change this setting.");
  };

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between">
        <div className="min-w-0 pr-3">
          <span className="block text-sm font-semibold capitalize text-slate-700">{label}</span>
          <span className="block text-[11px] text-slate-400">
            {status.available ? "Ask for this when you sign in or reopen the app" : "Set up biometrics in your device settings first"}
          </span>
        </div>
        <button
          onClick={toggle}
          disabled={busy || !status.available}
          aria-label={`Toggle ${label}`}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${on ? "" : "bg-slate-200"}`}
          style={on ? { background: NAVY } : {}}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      {note && <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-600">{note}</p>}
    </div>
  );
}

/* ----- Timesheet ----- */
// Whole/half hour formatting for minutes.
const fmtHours = (mins) => { const h = mins / 60; return (Math.round(h * 10) / 10).toString().replace(/\.0$/, ""); };
const monthOf = (iso) => iso.slice(0, 7);
const monthLabel = (m) => new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
// Shift a "YYYY-MM" string by whole months, TIMEZONE-SAFELY. Doing this via a local
// Date + toISOString() drifts a month under BST (local midnight = 23:00 UTC the day
// before), which made the forward/back buttons land on the wrong month. Pure UTC
// arithmetic on the year/month numbers avoids that entirely.
const shiftMonthStr = (m, delta) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const lastDayOfMonth = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).getDate(); };
const prettyDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function TimesheetForm({ store, me, month, entry, onDone }) {
  const cur = monthOf(todayISO());
  const [date, setDate] = useState(entry?.date || (month === cur ? todayISO() : `${month}-01`));
  const [start, setStart] = useState(entry?.start || "09:00");
  const [end, setEnd] = useState(entry?.end || "10:00");
  const [mode, setMode] = useState(entry?.mode || "campus");
  const [title, setTitle] = useState(entry?.title || "");
  const [note, setNote] = useState(entry?.note || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mins = (() => { const [sh, sm] = start.split(":").map(Number); const [eh, em] = end.split(":").map(Number); return (eh * 60 + em) - (sh * 60 + sm); })();

  const save = async () => {
    setError("");
    if (!title.trim()) { setError("Add what the session was (e.g. the class name)."); return; }
    if (mins <= 0) { setError("End time must be after the start time."); return; }
    setBusy(true);
    try {
      const data = { date, start, end, mode, title: title.trim(), note: note.trim() };
      if (entry) await store.updateTimesheet(entry.id, data);
      else await store.addTimesheet(data);
      onDone();
    } catch (e) { setError(e.message || "Could not save."); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <Field label="Date">
        <input type="date" value={date} min={`${month}-01`} max={`${month}-${String(lastDayOfMonth(month)).padStart(2, "0")}`} onChange={e => setDate(e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><input type="time" value={start} onChange={e => setStart(e.target.value)} className={inputCls} /></Field>
        <Field label="To"><input type="time" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} /></Field>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400">Delivery</label>
        <div className="grid grid-cols-2 gap-2">
          {[{ k: "campus", label: "On campus", I: Building2 }, { k: "online", label: "Online", I: Wifi }].map(o => {
            const on = mode === o.k; const O = o.I;
            return (
              <button key={o.k} type="button" onClick={() => setMode(o.k)} className={`flex items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-sm font-bold transition ${on ? "border-transparent text-white shadow-sm" : "border-slate-200 bg-white text-slate-500"}`} style={on ? { background: o.k === "campus" ? NAVY : "#0d7a5f" } : {}}>
                <O size={16} /> {o.label}
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Class / activity"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Unit 4 — Database Design (Group A)" className={inputCls} /></Field>
      <Field label="Note (optional)"><textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Anything worth recording…" className={inputCls + " resize-none"} /></Field>
      <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm"><span className="text-slate-500">Duration</span><span className="font-bold" style={{ color: mins > 0 ? NAVY : MAROON }}>{mins > 0 ? `${fmtHours(mins)} h` : "—"}</span></div>
      {error && <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600"><AlertCircle size={15} /> {error}</div>}
      <PrimaryBtn onClick={save} disabled={busy} className="w-full">{busy ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><Save size={16} /> {entry ? "Update session" : "Add session"}</>}</PrimaryBtn>
    </div>
  );
}

function TimesheetScreen({ store, me }) {
  const [month, setMonth] = useState(() => monthOf(todayISO()));
  const [entries, setEntries] = useState(null); // null = loading
  const [reloadKey, setReloadKey] = useState(0);
  const [modal, setModal] = useState(null);      // {} = add, { entry } = edit, null = closed
  const [confirmSend, setConfirmSend] = useState(false);
  const [busy, setBusy] = useState(false);

  // Blank to the loading state ONLY when the month changes (a deliberate switch),
  // never on a background refresh.
  useEffect(() => { setEntries(null); }, [month]);
  // Fetch on month change / after a write / on a gentle 20s background poll — but
  // always swap the rows IN PLACE (keep the old list until the new one arrives), so
  // nothing flickers to zero. `store` is deliberately NOT a dependency: it's a fresh
  // object every render, and depending on it refetched (and blanked) the list on
  // every re-render — that was the "loads every second, drops to 0" bug.
  useEffect(() => {
    let cancelled = false;
    const fetchNow = () => store.listTimesheets({ month })
      .then(d => { if (!cancelled) setEntries(d); })
      .catch(() => { if (!cancelled) setEntries(prev => prev || []); });
    fetchNow();
    const id = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") fetchNow(); }, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [month, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setReloadKey(k => k + 1);

  const shiftMonth = (delta) => setMonth(shiftMonthStr(month, delta));

  const list = entries || [];
  const totalMin = list.reduce((s, e) => s + e.minutes, 0);
  const campusMin = list.filter(e => e.mode === "campus").reduce((s, e) => s + e.minutes, 0);
  const onlineMin = list.filter(e => e.mode === "online").reduce((s, e) => s + e.minutes, 0);
  // Entries the staff still holds and can send: fresh drafts + any bounced back.
  const sendable = list.filter(e => e.status === "draft" || e.status === "changes_requested");
  const hasApproved = list.some(e => e.status === "approved");
  const hasSubmitted = list.some(e => e.status === "submitted");
  const changesEntry = list.find(e => e.status === "changes_requested");
  // The month's headline status, most-actionable first.
  const monthStatus = changesEntry ? "changes"
    : hasSubmitted ? "submitted"
    : (hasApproved && sendable.length === 0) ? "approved"
    : sendable.length > 0 ? "draft" : "none";

  const byDate = {};
  for (const e of list) (byDate[e.date] = byDate[e.date] || []).push(e);
  const days = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  const del = async (id) => { try { await store.removeTimesheet(id); reload(); } catch (_) {} };
  const send = async () => { setBusy(true); try { await store.submitTimesheet(month); setConfirmSend(false); reload(); } catch (_) {} finally { setBusy(false); } };

  return (
    <Screen>
      {/* Month selector */}
      <div className="mb-3 flex items-center justify-between rounded-2xl bg-white px-2 py-2 shadow-sm ring-1 ring-slate-100">
        <button onClick={() => shiftMonth(-1)} className="press flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"><ChevronLeft size={18} /></button>
        <p className="text-sm font-extrabold text-slate-700">{monthLabel(month)}</p>
        <button onClick={() => shiftMonth(1)} className="press flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"><ChevronRight size={18} /></button>
      </div>

      {/* Summary */}
      <div className="animated-gradient relative mb-3 overflow-hidden rounded-2xl p-4 text-white shadow-md" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 60%, ${MAROON} 150%)`, backgroundSize: "200% 200%" }}>
        <ClipboardList size={64} className="float-slow absolute -right-3 -top-3 text-white/10" />
        <p className="relative text-[11px] font-semibold uppercase tracking-wide text-white/60">Hours this month</p>
        <p className="relative text-3xl font-extrabold">{fmtHours(totalMin)}<span className="text-lg font-bold text-white/70"> h</span></p>
        <div className="relative mt-3 flex gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/15"><Building2 size={12} /> Campus {fmtHours(campusMin)}h</span>
          <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/15"><Wifi size={12} /> Online {fmtHours(onlineMin)}h</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/15">{list.length} session{list.length === 1 ? "" : "s"}</span>
        </div>
        {monthStatus === "submitted" && <span className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-slate-700"><Clock size={12} /> Awaiting approval</span>}
        {monthStatus === "approved" && <span className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/90 px-2.5 py-1 text-[11px] font-bold text-emerald-950"><CheckCircle2 size={12} /> Approved{list.find(e => e.status === "approved")?.reviewedBy ? ` by ${list.find(e => e.status === "approved").reviewedBy}` : ""}</span>}
        {monthStatus === "changes" && <span className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-400/95 px-2.5 py-1 text-[11px] font-bold text-amber-950"><AlertCircle size={12} /> Changes requested</span>}
      </div>

      {/* Finance feedback when the month was bounced back — shown prominently so the
          staff member knows exactly what to fix before re-sending. */}
      {monthStatus === "changes" && changesEntry?.reviewNote && (
        <div className="mb-3 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700"><MessageSquare size={13} /> Note from the office{changesEntry.reviewedBy ? ` · ${changesEntry.reviewedBy}` : ""}</p>
          <p className="mt-1 text-sm font-medium text-amber-900">{changesEntry.reviewNote}</p>
          <p className="mt-1.5 text-[11px] text-amber-600">Fix the entries below, then send your timesheet again.</p>
        </div>
      )}

      <button onClick={() => setModal({})} className="press shine mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white py-3 text-sm font-bold text-slate-600 transition hover:border-slate-400 hover:text-slate-800"><Plus size={16} /> Add a session</button>

      {/* Entries grouped by day */}
      {entries === null ? (
        <div className="flex flex-col items-center gap-2 py-12 text-slate-400"><Loader2 size={22} className="animate-spin" /><p className="text-xs font-semibold">Loading your timesheet…</p></div>
      ) : days.length === 0 ? (
        <Card className="text-center"><ClipboardList size={30} className="mx-auto mb-2 text-slate-300" /><p className="text-sm font-semibold text-slate-500">No sessions logged for {monthLabel(month)}.</p><p className="mt-0.5 text-xs text-slate-400">Tap “Add a session” to record the classes you taught.</p></Card>
      ) : (
        days.map(day => {
          const dayEntries = byDate[day].sort((a, b) => a.start.localeCompare(b.start));
          const dayMin = dayEntries.reduce((s, e) => s + e.minutes, 0);
          return (
            <div key={day} className="mb-3">
              <div className="mb-1.5 flex items-center justify-between px-1"><p className="text-xs font-bold text-slate-500">{prettyDay(day)}</p><p className="text-[11px] font-bold text-slate-400">{fmtHours(dayMin)}h</p></div>
              <Card className="!p-0">
                {dayEntries.map((e, i) => (
                  <div key={e.id} className={`flex items-center gap-3 px-3.5 py-3 ${i < dayEntries.length - 1 ? "border-b border-slate-100" : ""}`}>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: e.mode === "campus" ? NAVY : "#0d7a5f" }}>{e.mode === "campus" ? <Building2 size={17} /> : <Wifi size={17} />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-700">{e.title}</p>
                      <p className="text-[11px] text-slate-400">{e.start}–{e.end} · {fmtHours(e.minutes)}h · {e.mode === "campus" ? "On campus" : "Online"}</p>
                    </div>
                    {(e.status === "draft" || e.status === "changes_requested") ? (
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => setModal({ entry: e })} className="press flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Edit3 size={15} /></button>
                        <button onClick={() => del(e.id)} className="press flex h-8 w-8 items-center justify-center rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button>
                      </div>
                    ) : e.status === "approved" ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-200">Approved</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">Sent</span>
                    )}
                  </div>
                ))}
              </Card>
            </div>
          );
        })
      )}

      {/* Send / re-send */}
      {sendable.length > 0 && (
        <button onClick={() => setConfirmSend(true)} className="press shine mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${NAVY}, ${MAROON})` }}>
          <Send size={17} /> {monthStatus === "changes" ? "Re-send" : "Send"} timesheet — {sendable.length} session{sendable.length === 1 ? "" : "s"}, {fmtHours(sendable.reduce((s, e) => s + e.minutes, 0))}h
        </button>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.entry ? "Edit session" : "Add session"}>
        {modal && <TimesheetForm store={store} me={me} month={month} entry={modal.entry} onDone={() => { setModal(null); reload(); }} />}
      </Modal>

      <Modal open={confirmSend} onClose={() => setConfirmSend(false)} title="Send this timesheet?">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">You're about to send your <b>{monthLabel(month)}</b> timesheet — <b>{sendable.length}</b> session{sendable.length === 1 ? "" : "s"}, <b>{fmtHours(sendable.reduce((s, e) => s + e.minutes, 0))} hours</b> — to the finance team for approval.</p>
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">Once sent, these entries are locked until the finance team approves them or asks for changes.</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmSend(false)} className="flex-1 rounded-xl border-2 border-slate-200 py-2.5 text-sm font-bold text-slate-600">Not yet</button>
            <PrimaryBtn onClick={send} disabled={busy} className="flex-1">{busy ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : <><Send size={16} /> Send now</>}</PrimaryBtn>
          </div>
        </div>
      </Modal>
    </Screen>
  );
}

/* ----- More ----- */
function MoreScreen({ store, me, logout, onChangePassword, onSwitchToAdmin }) {
  const [toggles, setToggles] = useState({ notif: true, reminders: true, biometric: false });
  const [showDelete, setShowDelete] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const items = [{ I: Users, label: "My Profile" }, { I: MapPin, label: "Campus Map" }, { I: Coffee, label: "Staff Room Booking" }, { I: Mail, label: "Contact HR" }];
  // Read-only profile stats, all safe.
  const myLeaveCount = store.leave.filter(l => l.staffId === me.id).length;
  const myCheckins = store.checkins.filter(c => c.staffId === me.id && c.in).length;
  const left = store.remaining(me.id);
  return (
    <Screen>
      <Card className="mb-3 overflow-hidden !p-0">
        <div className="flex items-center gap-3 p-4" style={{ background: "linear-gradient(135deg, rgba(26,58,143,.07), rgba(158,27,50,.05))" }}>
          <span className="float flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg ring-2 ring-white" style={{ background: me.colour }}>{me.initials}</span>
          <div className="min-w-0 flex-1"><p className="truncate font-bold text-slate-800">{me.name}</p><p className="truncate text-xs text-slate-500">{me.role} · {me.dept}</p><p className="truncate text-xs text-slate-400">{me.email}</p></div>
          {store.isAdmin && <span className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-bold shadow-sm ring-1 ring-slate-200" style={{ color: MAROON }}><ShieldCheck size={12} /> Admin</span>}
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center">
          <div className="py-2.5"><p className="text-base font-extrabold" style={{ color: NAVY }}>{left}d</p><p className="text-[10px] text-slate-400">Holiday left</p></div>
          <div className="py-2.5"><p className="text-base font-extrabold text-slate-700">{myLeaveCount}</p><p className="text-[10px] text-slate-400">Leave records</p></div>
          <div className="py-2.5"><p className="text-base font-extrabold text-emerald-600">{myCheckins}</p><p className="text-[10px] text-slate-400">Check-ins</p></div>
        </div>
      </Card>
      <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Preferences</p>
      <Card className="!p-0 mb-3">
        {[["notif", "Push notifications"], ["reminders", "Check-in reminders"]].map(([k, label], i) => (
          <div key={k} className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <span className="text-sm font-semibold text-slate-700">{label}</span>
            <button onClick={() => setToggles(t => ({ ...t, [k]: !t[k] }))} className={`relative h-6 w-11 rounded-full transition ${toggles[k] ? "" : "bg-slate-200"}`} style={toggles[k] ? { background: NAVY } : {}}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${toggles[k] ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        ))}
        {/* A real setting, unlike the two above: it drives the app lock. Hidden in
            a browser, where there is no sensor to ask. */}
        <BiometricSetting />
      </Card>
      <Card className="!p-0">
        {items.map((it, i) => <button key={it.label} onClick={() => store.notify(`Opening ${it.label}…`)} className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:scale-[0.99] ${i < items.length - 1 ? "border-b border-slate-100" : ""}`}><it.I size={18} className="transition-transform group-hover:scale-110" style={{ color: NAVY }} /><span className="flex-1 text-sm font-semibold text-slate-700">{it.label}</span><ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-slate-400" /></button>)}
      </Card>
      <p className="mb-2 mt-4 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">App info</p>
      <div className="animated-gradient relative overflow-hidden rounded-2xl p-4 text-white shadow-md fade-up" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 50%, ${MAROON} 140%)`, backgroundSize: "200% 200%" }}>
        <Building2 size={56} className="float-slow absolute -right-2 -top-2 text-white/10" />
        <div className="relative mb-2 flex h-9 w-12 items-center justify-center rounded-md bg-white"><Logo small /></div>
        <p className="relative text-sm font-bold">London Brookes College</p>
        <p className="relative mt-0.5 flex items-center gap-1.5 text-[11px] text-white/70"><MapPin size={11} /> 42 The Burroughs, London NW4 4AP</p>
        <p className="relative flex items-center gap-1.5 text-[11px] text-white/70"><Phone size={11} /> 020 8202 2007</p>
        <p className="relative mt-2 text-[10px] text-white/50">Staff Hub · v2.0</p>
      </div>
      {/* Account deletion. Both app stores require this to be reachable from
          inside the app, not only by emailing an administrator. */}
      <p className="mb-2 mt-5 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Account</p>
      <Card className="!p-0">
        {/* Change password — moved here from the top bar so the mobile app has a
            clean header. Triggers the shared change-password modal in the shell. */}
        {onChangePassword && (
          <button onClick={onChangePassword} className="group flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:scale-[0.99]">
            <KeyRound size={18} className="transition-transform group-hover:scale-110" style={{ color: NAVY }} />
            <span className="flex-1 text-sm font-semibold text-slate-700">Change password</span>
            <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-1" />
          </button>
        )}
        {/* Admins reach their dashboard from here since the top view-toggle is gone. */}
        {onSwitchToAdmin && (
          <button onClick={onSwitchToAdmin} className="group flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:scale-[0.99]">
            <Monitor size={18} className="transition-transform group-hover:scale-110" style={{ color: NAVY }} />
            <span className="flex-1 text-sm font-semibold text-slate-700">Switch to Admin Dashboard</span>
            <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-1" />
          </button>
        )}
        <button
          onClick={() => setShowDelete(true)}
          className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-rose-50/60 active:scale-[0.99]"
        >
          <Trash2 size={18} className="transition-transform group-hover:scale-110" style={{ color: MAROON }} />
          <span className="flex-1">
            <span className="block text-sm font-semibold" style={{ color: MAROON }}>Delete my account</span>
            <span className="block text-[11px] text-slate-400">Permanently remove your account and personal data</span>
          </span>
          <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-1" />
        </button>
      </Card>

      {/* Sign out — moved here from the top bar; full-width and clearly separated. */}
      {logout && (
        <button onClick={() => setConfirmOut(true)} className="press mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-800">
          <LogOut size={16} /> Sign out
        </button>
      )}
      <ConfirmDialog open={confirmOut} title="Sign out?" message="You'll need to sign in again to get back in." confirmLabel="Sign out" cancelLabel="Stay" danger onConfirm={logout} onCancel={() => setConfirmOut(false)} />

      <p className="mt-4 text-center text-[11px] text-slate-400">London Brookes College · Staff Hub</p>
      <p className="text-center text-[11px] text-slate-400">© {new Date().getFullYear()} Syed Muhammad Raza</p>

      <Modal open={showDelete} onClose={() => setShowDelete(false)} title="Delete my account">
        <DeleteAccount user={me} onCancel={() => setShowDelete(false)} />
      </Modal>
    </Screen>
  );
}

/* ============================================================ ADMIN DASHBOARD ============================================================ */
// The assignable admin pages, in nav order. "access" is intentionally excluded —
// it is Super-Admin-only and never granted. Keep in sync with server validate.js.
const ADMIN_PAGES = ["overview", "kpi", "checkin", "balances", "calendar", "requests", "documents", "approvals", "signups", "summaries", "registers", "students", "assessments", "pat", "studentqueries", "staff", "timesheets", "settings"];
const PAGE_LABELS = { overview: "Overview", kpi: "KPIs", checkin: "Check-In", balances: "Holiday Balances", calendar: "Holiday Calendar", requests: "Leave Requests", documents: "Documents", approvals: "Approvals", signups: "Sign-Up Requests", summaries: "Daily Summaries", registers: "Registers — HND", students: "Students", assessments: "Assessments", pat: "PAT", studentqueries: "Student Queries", staff: "Staff", timesheets: "Timesheets", settings: "Settings" };

// Can this user see/use a given admin page? The Super Admin gets everything,
// including the Super-Admin-only Access tab. A page-scoped admin gets only their
// granted pages (null adminPages = unrestricted, so existing admins keep full
// access). Anyone who isn't an admin gets nothing.
const canAccessPage = (user, key) => {
  if (!user) return false;
  if (key === "access") return !!user.isSuperAdmin;   // never assignable to others
  if (user.isSuperAdmin) return true;
  if (user.accountRole !== "ADMIN") return false;
  const pages = user.adminPages;
  return pages == null || (Array.isArray(pages) && pages.includes(key));
};

export function AdminDashboard({ store, onExitToStaffApp }) {
  const me = store.currentUser;
  if (!store.isAdmin) return <div className="p-4 text-slate-400">Access denied</div>;
  const allNav = [
    { key: "overview", label: "Overview", I: LayoutDashboard },
    { key: "kpi", label: "KPIs", I: Activity },
    { key: "checkin", label: "Check-In", I: Clock3 },
    { key: "balances", label: "Holiday Balances", I: Check },
    { key: "calendar", label: "Holiday Calendar", I: CalendarDays },
    { key: "requests", label: "Leave Requests", I: Inbox },
    { key: "documents", label: "Documents", I: FileText },
    { key: "approvals", label: "Approvals", I: ThumbsUp },
    { key: "signups", label: "Sign-Up Requests", I: UserCheck },
    { key: "summaries", label: "Daily Summaries", I: UserPlus },
    { key: "registers", label: "Registers — HND", I: ClipboardList },
    { key: "students", label: "Students", I: GraduationCap },
    { key: "assessments", label: "Assessments", I: Award },
    { key: "pat", label: "PAT", I: MessageSquare },
    { key: "studentqueries", label: "Student Queries", I: Inbox },
    { key: "staff", label: "Staff", I: Users },
    { key: "timesheets", label: "Timesheets", I: Timer },
    { key: "settings", label: "Settings", I: Settings },
    { key: "access", label: "Access", I: ShieldCheck },
  ];
  // Only the pages this admin may see. Super Admin sees all + the Access tab.
  const nav = allNav.filter(n => canAccessPage(me, n.key));
  const [tab, setTab] = useState(() => nav[0]?.key || "overview");
  // If the current tab isn't in the allowed set (e.g. access was changed mid-session),
  // fall back to the first one they can see, so no forbidden page ever renders.
  const activeKey = nav.some(n => n.key === tab) ? tab : (nav[0]?.key || null);
  const handset = useIsHandset();
  // Android back (mobile dashboard): return to the first tab, then out to the staff app.
  useBackHandler(handset, () => {
    if (activeKey !== nav[0]?.key) { setTab(nav[0].key); return true; }
    if (onExitToStaffApp) { onExitToStaffApp(); return true; }
    return false;
  });
  const pendingCount = store.leave.filter(l => l.status === "pending").length;
  const pendingSignups = (store.signups || []).filter(s => s.status === "pending").length;
  const openQueries = (store.studentQueries || []).filter(q => q.status === "open").length;
  return (
    <div className="flex min-h-[calc(100vh-40px)]">
      <aside className="hidden w-60 flex-col bg-white px-4 py-5 ring-1 ring-slate-200 md:flex">
        <div className="mb-6 flex items-center gap-2 px-1">
          <div className="flex h-10 w-14 items-center justify-center rounded-md ring-1 ring-slate-200"><Logo small /></div>
          <div><p className="text-[13px] font-extrabold leading-tight" style={{ color: NAVY }}>Staff Hub</p><p className="text-[10px] font-semibold text-slate-400">ADMIN CONSOLE</p></div>
        </div>
        <nav className="flex-1 space-y-1">
          {nav.map((n, i) => (
            <button key={n.key} onClick={() => setTab(n.key)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 active:scale-[0.98] slide-in ${activeKey === n.key ? "text-white shadow-md" : "text-slate-500 hover:translate-x-1 hover:bg-slate-100"}`} style={activeKey === n.key ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})`, boxShadow: "0 6px 18px -6px rgba(26,58,143,.6)", animationDelay: `${i * 35}ms` } : { animationDelay: `${i * 35}ms` }}>
              <n.I size={18} className="transition-transform duration-200 group-hover:scale-110" /><span className="flex-1 text-left">{n.label}</span>
              {(n.key === "requests" || n.key === "approvals") && pendingCount > 0 && <span className="pop rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900 shadow-sm">{pendingCount}</span>}
              {n.key === "signups" && pendingSignups > 0 && <span className="pop rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900 shadow-sm">{pendingSignups}</span>}
              {n.key === "studentqueries" && openQueries > 0 && <span className="pop rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900 shadow-sm">{openQueries}</span>}
            </button>
          ))}
        </nav>
        <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-[11px] text-slate-400">Logged in as</p><p className="text-sm font-bold text-slate-700">{me?.name || "Administrator"}</p>{me?.isSuperAdmin && <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: MAROON }}>Super Admin</p>}</div>
      </aside>
      <main className="flex-1 overflow-x-hidden bg-slate-100 p-5 md:p-7">
        <div className="mb-4 flex gap-1.5 overflow-x-auto md:hidden">
          {/* On a phone, a way back to the staff app — admins (incl. limited admins
              who registered on the app) keep both their staff view and the console. */}
          {onExitToStaffApp && <button onClick={onExitToStaffApp} className="flex shrink-0 items-center gap-1.5 rounded-full border-2 border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 active:scale-95"><ChevronLeft size={14} /> Staff App</button>}
          {nav.map(n => <button key={n.key} onClick={() => setTab(n.key)} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm transition-all active:scale-95 ${activeKey === n.key ? "text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`} style={activeKey === n.key ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` } : {}}><n.I size={14} /> {n.label}</button>)}
        </div>
        {activeKey === "overview" && <AdminOverview store={store} setTab={setTab} />}
        {activeKey === "kpi" && <AdminKPI store={store} />}
        {activeKey === "checkin" && <AdminCheckin store={store} />}
        {activeKey === "balances" && <AdminBalances store={store} />}
        {activeKey === "calendar" && <AdminCalendar store={store} />}
        {activeKey === "requests" && <AdminRequests store={store} />}
        {activeKey === "documents" && <AdminDocuments store={store} />}
        {activeKey === "approvals" && <AdminApprovals store={store} />}
        {activeKey === "signups" && <AdminSignups store={store} />}
        {activeKey === "summaries" && <AdminSummaries store={store} />}
        {activeKey === "registers" && <AdminHndRegisters store={store} />}
        {activeKey === "students" && <AdminStudents store={store} />}
        {activeKey === "assessments" && <AdminAssessments store={store} />}
        {activeKey === "pat" && <AdminPAT store={store} />}
        {activeKey === "studentqueries" && <AdminStudentQueries store={store} />}
        {activeKey === "staff" && <AdminStaff store={store} />}
        {activeKey === "timesheets" && <AdminTimesheets store={store} />}
        {activeKey === "settings" && <AdminSettings store={store} />}
        {activeKey === "access" && <AdminAccess store={store} />}
      </main>
    </div>
  );
}

/* ----- Dashboard: Access control (Super Admin only) ----- */
function AdminAccess({ store }) {
  const [selId, setSelId] = useState(null);
  const [pages, setPages] = useState([]);   // working selection for the picked person
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  // The pages a person currently has: super admin & unrestricted admin = all;
  // a scoped admin = their list; anyone else = none.
  const grantOf = (p) => p.isSuperAdmin ? ADMIN_PAGES.slice()
    : p.accountRole === "ADMIN" ? (p.adminPages == null ? ADMIN_PAGES.slice() : p.adminPages)
    : (Array.isArray(p.adminPages) ? p.adminPages : []);
  const roleLabel = (p) => p.isSuperAdmin ? "Super Admin"
    : p.accountRole === "ADMIN" ? (p.adminPages == null ? "Full admin" : `${p.adminPages.length} page${p.adminPages.length === 1 ? "" : "s"}`)
    : "No access";

  const people = [...store.staff].sort((a, b) => {
    const rank = (p) => p.isSuperAdmin ? 0 : p.accountRole === "ADMIN" ? 1 : 2;
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  const ql = q.trim().toLowerCase();
  const list = people.filter(p => !ql || p.name.toLowerCase().includes(ql) || (p.email || "").toLowerCase().includes(ql));

  const sel = people.find(p => p.id === selId) || null;
  const pick = (p) => { setSelId(p.id); setPages(grantOf(p)); };
  const toggle = (k) => setPages(ps => ps.includes(k) ? ps.filter(x => x !== k) : [...ps, k]);
  const allOn = ADMIN_PAGES.every(k => pages.includes(k));
  const toggleAll = () => setPages(allOn ? [] : ADMIN_PAGES.slice());

  const save = async () => {
    if (!sel) return;
    setBusy(true);
    try { await store.updateAccess(sel.id, pages); } catch (_) {} finally { setBusy(false); }
  };

  return (
    <>
      <AdminHeader title="Access" subtitle="Choose a person, then tick the admin pages they can open" Icon={ShieldCheck} />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* People */}
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" className="w-full bg-transparent text-sm outline-none" /></div>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {list.map(p => (
              <button key={p.id} onClick={() => pick(p)} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${selId === p.id ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: p.colour }}>{p.initials}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-700">{p.name}</span><span className="block truncate text-[11px] text-slate-400">{p.email}</span></span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={p.isSuperAdmin ? { background: MAROON, color: "white" } : p.accountRole === "ADMIN" ? { background: "#e0e7ff", color: "#4338ca" } : { background: "#f1f5f9", color: "#64748b" }}>{roleLabel(p)}</span>
              </button>
            ))}
            {list.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">No people match.</p>}
          </div>
        </div>

        {/* Editor */}
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
          {!sel && <EmptyState Icon={ShieldCheck} title="Pick a person" msg="Choose someone on the left to set which admin pages they can access." />}
          {sel && sel.isSuperAdmin && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
              <ShieldCheck size={18} className="shrink-0" /> {sel.name} is the Super Admin and always has full access.
            </div>
          )}
          {sel && !sel.isSuperAdmin && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: sel.colour }}>{sel.initials}</span>
                  <div><p className="font-bold text-slate-800">{sel.name}</p><p className="text-[11px] text-slate-400">{pages.length === 0 ? "No admin access" : allOn ? "Full admin access" : `${pages.length} of ${ADMIN_PAGES.length} pages`}</p></div>
                </div>
                <button onClick={toggleAll} className="text-xs font-bold text-blue-600 hover:underline">{allOn ? "Clear all" : "Select all"}</button>
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {ADMIN_PAGES.map(k => {
                  const on = pages.includes(k);
                  return (
                    <button key={k} onClick={() => toggle(k)} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ring-1 transition ${on ? "bg-blue-50 text-slate-800 ring-blue-200" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"}`}>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1" style={on ? { background: NAVY, borderColor: "transparent" } : { boxShadow: "inset 0 0 0 1px #cbd5e1" }}>{on && <Check size={13} className="text-white" />}</span>
                      {PAGE_LABELS[k]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
                <AlertCircle size={13} className="mt-px shrink-0" /> Granting at least one page makes this person an admin for those pages. Clearing all removes their admin access entirely. Changes take effect the next time they open the app.
              </p>
              <PrimaryBtn onClick={save} disabled={busy} className="mt-4 w-full"><Save size={16} /> {busy ? "Saving…" : "Save access"}</PrimaryBtn>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ----- Admin / Finance: review & approve timesheets ----- */
const TS_STATUS = {
  pending:  { label: "Awaiting approval", cls: "bg-amber-50 text-amber-700 ring-amber-200",  I: Clock3 },
  changes:  { label: "Changes requested", cls: "bg-rose-50 text-rose-600 ring-rose-200",     I: AlertCircle },
  approved: { label: "Approved",          cls: "bg-emerald-50 text-emerald-600 ring-emerald-200", I: CheckCircle2 },
};
const groupStatus = (entries) => entries.some(e => e.status === "submitted") ? "pending"
  : entries.some(e => e.status === "changes_requested") ? "changes" : "approved";

function AdminTimesheets({ store }) {
  const [month, setMonth] = useState(() => monthOf(todayISO()));
  const [entries, setEntries] = useState(null);
  const [open, setOpen] = useState({});
  const [reloadKey, setReloadKey] = useState(0);
  const [reviewModal, setReviewModal] = useState(null); // { staffId, name } when requesting changes
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => setReloadKey(k => k + 1);

  // Loading state only on a deliberate month switch — not on the background poll.
  useEffect(() => { setEntries(null); }, [month]);
  // No staffId → admin gets every non-draft entry for the month (submitted/approved/
  // changes). Refresh every 20s so newly-sent timesheets appear, swapping IN PLACE
  // (no flicker to 0). `store` is intentionally not a dependency (fresh object each
  // render → would refetch and blank the list constantly).
  useEffect(() => {
    let cancelled = false;
    const fetchNow = () => store.listTimesheets({ month })
      .then(d => { if (!cancelled) setEntries(d); })
      .catch(() => { if (!cancelled) setEntries(prev => prev || []); });
    fetchNow();
    const id = setInterval(() => { if (typeof document === "undefined" || document.visibilityState === "visible") fetchNow(); }, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [month, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (staffId) => { setBusy(true); try { await store.reviewTimesheet(staffId, month, "approved"); reload(); } catch (_) {} finally { setBusy(false); } };
  const requestChanges = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await store.reviewTimesheet(reviewModal.staffId, month, "changes_requested", note.trim()); setReviewModal(null); setNote(""); reload(); }
    catch (_) {} finally { setBusy(false); }
  };

  const shiftMonth = (delta) => setMonth(shiftMonthStr(month, delta));
  const list = entries || [];
  const byStaff = {};
  for (const e of list) (byStaff[e.staffId] = byStaff[e.staffId] || { staffId: e.staffId, name: e.staffName, dept: e.staffDept, initials: e.staffInitials, colour: e.staffColour, entries: [] }).entries.push(e);
  const people = Object.values(byStaff).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const totalMin = list.reduce((s, e) => s + e.minutes, 0);
  const campusMin = list.filter(e => e.mode === "campus").reduce((s, e) => s + e.minutes, 0);
  const onlineMin = list.filter(e => e.mode === "online").reduce((s, e) => s + e.minutes, 0);
  const pendingCount = people.filter(p => groupStatus(p.entries) === "pending").length;

  const exportCsv = () => {
    downloadCSV(`timesheets-${month}.csv`, [
      { key: "staff", label: "Staff" }, { key: "dept", label: "Dept" }, { key: "date", label: "Date" }, { key: "start", label: "Start" }, { key: "end", label: "End" }, { key: "hours", label: "Hours" }, { key: "mode", label: "Mode" }, { key: "title", label: "Class/Activity" }, { key: "submittedAt", label: "Sent" },
    ], list.map(e => ({ staff: e.staffName, dept: e.staffDept, date: e.date, start: e.start, end: e.end, hours: e.hours, mode: e.mode, title: e.title, submittedAt: e.submittedAt })));
    store.notify("Exported timesheets CSV");
  };

  return (
    <>
      <AdminHeader title="Timesheets" subtitle="Timesheets staff have sent, by month" Icon={Timer} action={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white px-1 py-1 shadow-sm ring-1 ring-slate-200">
            <button onClick={() => shiftMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronLeft size={16} /></button>
            <span className="min-w-[120px] text-center text-xs font-bold text-slate-600">{monthLabel(month)}</span>
            <button onClick={() => shiftMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight size={16} /></button>
          </div>
          <button onClick={exportCsv} disabled={!list.length} className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"><Download size={14} /> Export</button>
        </div>
      } />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* No `animate` on these — the count-up animation does Number(value), which
            is NaN for a string like "9.1h". animate stays only on numeric cards. */}
        <StatCard label="Total hours" value={`${fmtHours(totalMin)}h`} sub={`${monthLabel(month)}`} Icon={Clock3} tone={NAVY} delay={0} />
        <StatCard label="On campus" value={`${fmtHours(campusMin)}h`} sub="in person" Icon={Building2} tone="#1a3a8f" delay={60} />
        <StatCard label="Online" value={`${fmtHours(onlineMin)}h`} sub="remote" Icon={Wifi} tone="#0d7a5f" delay={120} />
        <StatCard label="Awaiting review" value={pendingCount} sub={`of ${people.length} sent`} Icon={Inbox} tone="#b45309" delay={180} animate />
      </div>

      {entries === null ? (
        <div className="flex flex-col items-center gap-2 py-16 text-slate-400"><Loader2 size={24} className="animate-spin" /><p className="text-sm font-semibold">Loading timesheets…</p></div>
      ) : people.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-sm ring-1 ring-slate-100"><Timer size={34} className="mx-auto mb-2 text-slate-300" /><p className="text-sm font-semibold text-slate-500">No timesheets sent for {monthLabel(month)} yet.</p></div>
      ) : (
        <div className="space-y-3">
          {people.map(p => {
            const pMin = p.entries.reduce((s, e) => s + e.minutes, 0);
            const pCampus = p.entries.filter(e => e.mode === "campus").reduce((s, e) => s + e.minutes, 0);
            const isOpen = open[p.staffId];
            const gs = groupStatus(p.entries);           // pending | changes | approved
            const badge = TS_STATUS[gs];
            const reviewed = p.entries.find(e => e.reviewedBy);
            return (
              <div key={p.staffId} className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${gs === "pending" ? "ring-amber-200" : "ring-slate-100"}`}>
                <button onClick={() => setOpen(o => ({ ...o, [p.staffId]: !o[p.staffId] }))} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: p.colour || NAVY }}>{p.initials}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-700">{p.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{p.dept} · {p.entries.length} session{p.entries.length === 1 ? "" : "s"}</p>
                  </div>
                  <span className={`hidden shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ring-1 sm:inline-flex ${badge.cls}`}><badge.I size={11} /> {badge.label}</span>
                  <div className="shrink-0 text-right"><p className="text-base font-extrabold" style={{ color: NAVY }}>{fmtHours(pMin)}h</p><p className="text-[10px] text-slate-400">{fmtHours(pCampus)}h campus</p></div>
                  <ChevronDown size={18} className={`shrink-0 text-slate-300 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-2 py-2">
                    <span className={`mx-1.5 mb-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ring-1 sm:hidden ${badge.cls}`}><badge.I size={11} /> {badge.label}</span>
                    {p.entries.slice().sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)).map(e => (
                      <div key={e.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: e.mode === "campus" ? NAVY : "#0d7a5f" }}>{e.mode === "campus" ? <Building2 size={14} /> : <Wifi size={14} />}</span>
                        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-700">{e.title}</p><p className="text-[10px] text-slate-400">{prettyDay(e.date)} · {e.start}–{e.end} · {e.mode === "campus" ? "Campus" : "Online"}</p></div>
                        <span className="shrink-0 text-xs font-bold text-slate-500">{fmtHours(e.minutes)}h</span>
                      </div>
                    ))}
                    {/* Prior decision, if any */}
                    {gs !== "pending" && reviewed?.reviewNote && (
                      <p className="mx-1.5 mt-1 rounded-lg bg-white px-2.5 py-1.5 text-[11px] text-slate-500 ring-1 ring-slate-200"><b>{gs === "changes" ? "Change note" : "Note"}:</b> {reviewed.reviewNote}{reviewed.reviewedBy ? ` — ${reviewed.reviewedBy}` : ""}</p>
                    )}
                    {/* Finance actions — only while awaiting approval */}
                    {gs === "pending" && (
                      <div className="mt-1.5 flex gap-2 px-1.5 pb-1">
                        <button onClick={() => approve(p.staffId)} disabled={busy} className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-60" style={{ background: "#059669" }}><CheckCircle2 size={15} /> Approve</button>
                        <button onClick={() => { setReviewModal({ staffId: p.staffId, name: p.name }); setNote(""); }} disabled={busy} className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-amber-300 bg-white py-2.5 text-xs font-bold text-amber-700 transition hover:bg-amber-50 disabled:opacity-60"><MessageSquare size={15} /> Request changes</button>
                      </div>
                    )}
                    {gs === "approved" && <p className="px-1.5 pb-1 pt-0.5 text-center text-[11px] font-semibold text-emerald-600">✓ Approved{reviewed?.reviewedAt ? ` on ${reviewed.reviewedAt}` : ""}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Request-changes comment modal */}
      <Modal open={!!reviewModal} onClose={() => setReviewModal(null)} title={`Request changes — ${reviewModal?.name || ""}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Tell {reviewModal?.name?.split(" ")[0] || "the staff member"} what needs correcting on their <b>{monthLabel(month)}</b> timesheet. They'll be notified and can fix it and re-send.</p>
          <Field label="Comment"><textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="e.g. The Tuesday session should be online, not campus." className={inputCls + " resize-none"} autoFocus /></Field>
          <div className="flex gap-2">
            <button onClick={() => setReviewModal(null)} className="flex-1 rounded-xl border-2 border-slate-200 py-2.5 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={requestChanges} disabled={busy || !note.trim()} className="press flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white shadow-sm transition disabled:opacity-60" style={{ background: "#b45309" }}>{busy ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : <><MessageSquare size={16} /> Send back</>}</button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function AdminHeader({ title, subtitle, action, Icon }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 fade-up">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-9 w-1.5 shrink-0 rounded-full" style={{ background: `linear-gradient(180deg, ${NAVY}, ${MAROON})` }} />
        {Icon && <span className="hidden h-11 w-11 items-center justify-center rounded-xl shadow-sm sm:flex" style={{ background: NAVY + "12" }}><Icon size={22} style={{ color: NAVY }} /></span>}
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight" style={{ color: NAVY_DARK }}>{title}</h2>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
function StatCard({ label, value, sub, Icon, tone = NAVY, delay = 0, animate }) {
  // Only count-up real numbers. Some cards pass a formatted string ("28d", "85%"),
  // and animating that multiplied a string by a number → NaN, which rendered
  // literally as "NaN". Strings (and non-finite numbers) now render as-is.
  const canAnimate = animate && typeof value === "number" && Number.isFinite(value);
  const av = useCountUp(canAnimate ? value : 0);
  return (
    <div className="hover-lift group relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:shadow-lg hover:ring-slate-300/80 fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-50 transition-transform duration-500 group-hover:scale-150" style={{ background: tone + "0d" }} />
      <div className="relative flex items-start justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-3xl font-extrabold tabular-nums" style={{ color: tone }}>{canAnimate ? av : value}</p>{sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}</div>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" style={{ background: tone + "14" }}><Icon size={22} style={{ color: tone }} /></span>
      </div>
    </div>
  );
}

function AdminOverview({ store, setTab }) {
  const today = todayISO();
  const inToday = store.checkins.filter(c => c.date === today && c.in);
  const onLeave = store.leave.filter(l => l.status === "approved" && today >= l.start && today <= l.end);
  const pending = store.leave.filter(l => l.status === "pending");
  const present = new Set(inToday.map(c => c.staffId)).size;
  const total = store.staff.length;
  const trend = useMemo(() => { const arr = []; for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); arr.push({ day: new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" }), present: new Set(store.checkins.filter(c => c.date === d && c.in).map(c => c.staffId)).size }); } return arr; }, [store.checkins]);
  const deptData = useMemo(() => { const m = {}; store.staff.forEach(s => m[s.dept] = (m[s.dept] || 0) + 1); return Object.entries(m).map(([name, value]) => ({ name, value })); }, [store.staff]);
  // Extra read-only KPIs — all safe-guarded against empty data.
  const attendancePct = total > 0 ? Math.round((present / total) * 100) : 0;
  const avgIn = avgCheckInTime(inToday) || "—";
  const approvedThisPeriod = store.leave.filter(l => l.status === "approved").length;
  const greet = greetingFor();
  const Greet = greet.Icon;
  return (
    <>
      <AdminHeader title="Overview" subtitle={`${greet.word} · ${fmtDay(today)} · live across all departments`} Icon={LayoutDashboard} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Present today" value={present} sub={`of ${total} staff`} Icon={CheckCircle2} tone="#059669" delay={0} animate />
        <StatCard label="On leave" value={onLeave.length} sub="approved absences" Icon={Plane} tone={MAROON} delay={60} animate />
        <StatCard label="Pending requests" value={pending.length} sub="awaiting approval" Icon={Inbox} tone="#b45309" delay={120} animate />
        <StatCard label="Total staff" value={total} sub="active members" Icon={Users} tone={NAVY} delay={180} animate />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Attendance" value={attendancePct} sub="of staff present" Icon={TrendingUp} tone="#0d7a5f" delay={0} />
        <StatCard label="Avg check-in" value={avgIn} sub="across today" Icon={Clock3} tone={NAVY} delay={60} />
        <StatCard label="Documents" value={store.docs.length} sub="published & private" Icon={FileText} tone="#6d28d9" delay={120} animate />
        <StatCard label="Approved leave" value={approvedThisPeriod} sub="total on record" Icon={CalendarCheck} tone="#0e7490" delay={180} animate />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="hover-glow rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 lg:col-span-2 fade-up" style={{ animationDelay: "60ms" }}>
          <p className="mb-3 text-sm font-bold text-slate-700">Attendance — last 7 days</p>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={trend}>
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={NAVY} stopOpacity={0.35} /><stop offset="100%" stopColor={NAVY} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} />
              <Area type="monotone" dataKey="present" stroke={NAVY} strokeWidth={3} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="hover-glow rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 fade-up" style={{ animationDelay: "120ms" }}>
          <p className="mb-3 text-sm font-bold text-slate-700">Staff by department</p>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart><Pie data={deptData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3}>{deptData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up lg:col-span-2" style={{ animationDelay: "180ms" }}>
          <div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><UserCheck size={15} style={{ color: NAVY }} /> Checked in today</p><span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live</span></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {inToday.length === 0 && <div className="sm:col-span-2"><EmptyState Icon={Clock3} title="No check-ins yet" msg="Staff who clock in today will appear here." /></div>}
            {inToday.map((c, i) => { const p = store.staff.find(s => s.id === c.staffId); return (
              <div key={c.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow-sm pop" style={{ animationDelay: `${i * 40}ms` }}><span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: p?.colour }}>{p?.initials}</span><div className="flex-1"><p className="text-sm font-semibold text-slate-700">{p?.name}</p><p className="text-xs text-slate-400">In {c.in}{c.out ? ` · Out ${c.out}` : ""}</p></div><span className={`h-2.5 w-2.5 rounded-full ${c.out ? "bg-slate-300" : "bg-emerald-500"}`} /></div>
            ); })}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up" style={{ animationDelay: "220ms" }}>
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><AlertCircle size={15} style={{ color: "#b45309" }} /> Needs attention</p>
            {pending.length > 0 && <button onClick={() => setTab && setTab("approvals")} className="text-xs font-bold text-blue-600 hover:underline">Review</button>}
          </div>
          {pending.length === 0 && <EmptyState Icon={CheckCircle2} title="All clear" msg="No requests are waiting." />}
          <div className="space-y-2">
            {pending.slice(0, 5).map((l, i) => { const p = store.staff.find(s => s.id === l.staffId); const t = leaveTypeMeta(l.type); return (
              <div key={l.id} className="flex items-center gap-2.5 rounded-xl bg-amber-50/60 px-3 py-2 ring-1 ring-amber-100 pop" style={{ animationDelay: `${i * 40}ms` }}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm" style={{ background: p?.colour }}>{p?.initials}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-700">{p?.name}</p><p className="truncate text-xs text-slate-400">{t.label} · {daysBetween(l.start, l.end)}d</p></div>
              </div>
            ); })}
            {pending.length > 5 && <p className="text-center text-[11px] font-semibold text-slate-400">+{pending.length - 5} more</p>}
          </div>
        </div>
      </div>
    </>
  );
}

/* ----- Dashboard: Check-In ----- */
function AdminCheckin({ store }) {
  const [day, setDay] = useState(todayISO());
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ staffId: "s1", in: "09:00", out: "", site: "" });
  const [query, setQuery] = useState("");
  const recs = store.checkins.filter(c => c.date === day);
  // Only real clock-ins count as present — a summary-first row has an empty `in`.
  const present = new Set(recs.filter(r => r.in).map(r => r.staffId));
  const ql = query.trim().toLowerCase();
  const filteredStaff = store.staff.filter(s => !ql || s.name.toLowerCase().includes(ql) || (s.dept || "").toLowerCase().includes(ql));
  const paged = usePaged(filteredStaff, 12, ql);
  const addCheckin = async () => {
    await store.upsertCheckin({ staffId: form.staffId, date: day, in: form.in, out: form.out || null, site: form.site || null }); setModal(false);
  };
  const setOut = (rec) => store.checkOut(rec.id);
  return (
    <>
      <AdminHeader title="Check-In & Attendance" subtitle="Daily check-in / out log — add or correct records" Icon={Clock3} action={<PrimaryBtn onClick={() => setModal(true)}><Plus size={16} /> Add record</PrimaryBtn>} />
      {(() => {
        // Read-only attendance snapshot for the selected day.
        const presentCount = present.size; const totalStaff = store.staff.length;
        const pct = totalStaff > 0 ? Math.round((presentCount / totalStaff) * 100) : 0;
        const out = recs.filter(r => r.in && r.out).length;
        return (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none" />
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or dept…" className="bg-transparent text-sm outline-none" /></div>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200"><UserCheck size={13} /> {presentCount} present</span>
            <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200"><Users size={13} /> {totalStaff} staff</span>
            <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200"><TrendingUp size={13} /> {pct}% in</span>
            <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500 ring-1 ring-slate-200"><LogOut size={13} /> {out} done</span>
          </div>
        );
      })()}
      <div className="overflow-x-auto overflow-y-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up [-webkit-overflow-scrolling:touch] md:overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Staff</th><th className="px-5 py-3">Dept</th><th className="px-5 py-3">Site</th><th className="px-5 py-3">In</th><th className="px-5 py-3">Out</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead>
          <tbody>
            {paged.slice.map(s => { const r = recs.find(c => c.staffId === s.id); const checkedIn = r && r.in; return (
              <tr key={s.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/40">
                <td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: s.colour }}>{s.initials}</span><span className="font-semibold text-slate-700">{s.name}</span></div></td>
                <td className="px-5 py-3 text-slate-500">{s.dept}</td>
                <td className="px-5 py-3">{r?.site ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{r.site}</span> : <span className="text-slate-300">—</span>}</td>
                <td className="px-5 py-3 font-medium text-slate-600">{r?.in || "—"}</td><td className="px-5 py-3 font-medium text-slate-600">{r?.out || (checkedIn ? "in" : "—")}</td>
                <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${checkedIn ? (r.out ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700") : "bg-rose-100 text-rose-600"}`}>{checkedIn ? (r.out ? "Complete" : "Present") : "Absent"}</span></td>
                <td className="px-5 py-3">{checkedIn && !r.out ? <button onClick={() => setOut(r)} className="text-xs font-bold text-blue-600 hover:underline">Check out</button> : <button onClick={() => { setForm({ staffId: s.id, in: r?.in || "09:00", out: r?.out || "", site: r?.site || "" }); setModal(true); }} className="text-xs font-bold text-slate-400 hover:text-slate-600">Edit</button>}</td>
              </tr>
            ); })}
            {paged.slice.length === 0 && <tr><td colSpan={7} className="px-5 py-10"><EmptyState Icon={Search} title="No staff match" msg="Try a different name or department." /></td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
      <Modal open={modal} onClose={() => setModal(false)} title="Add / edit check-in">
        <div className="space-y-3">
          <Field label="Staff member"><select value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))} className={inputCls}>{store.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Time in"><input type="time" value={form.in} onChange={e => setForm(f => ({ ...f, in: e.target.value }))} className={inputCls} /></Field><Field label="Time out (optional)"><input type="time" value={form.out} onChange={e => setForm(f => ({ ...f, out: e.target.value }))} className={inputCls} /></Field></div>
          <Field label="Site (optional)"><select value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} className={inputCls}><option value="">—</option>{SITES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
          <p className="text-xs text-slate-400">Date: {fmtDate(day)}</p>
          <PrimaryBtn onClick={addCheckin} className="w-full"><Save size={16} /> Save record</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Holiday Balances ----- */
function AdminBalances({ store }) {
  const [adjModal, setAdjModal] = useState(null); // staff obj
  const [editModal, setEditModal] = useState(null);
  const [adj, setAdj] = useState({ days: 1, note: "" });
  const [alw, setAlw] = useState(28);
  const [query, setQuery] = useState("");
  const applyAdj = async () => { await store.adjustBalance(adjModal.id, Number(adj.days), adj.note); setAdjModal(null); setAdj({ days: 1, note: "" }); };
  const saveAlw = async () => { await store.setAllowance(editModal.id, Number(alw)); setEditModal(null); };
  const ql = query.trim().toLowerCase();
  const filteredStaff = store.staff.filter(s => !ql || s.name.toLowerCase().includes(ql) || (s.dept || "").toLowerCase().includes(ql));
  const paged = usePaged(filteredStaff, 12, ql);
  const exportBalances = () => {
    const bank = store.bankHolidayDaysUsed();
    const rows = store.staff.map(s => { const base = s.allowance; const adjv = store.adjDays(s.id); const used = store.usedDays(s.id); const remaining = store.remaining(s.id); return { staff: s.name, dept: s.dept, base, adj: adjv, used, bank, remaining }; });
    downloadCSV("holiday-balances.csv", [
      { key: "staff", label: "Staff" }, { key: "dept", label: "Dept" }, { key: "base", label: "Base allowance" }, { key: "adj", label: "Adjustments" }, { key: "used", label: "Leave used" }, { key: "bank", label: "Bank holidays" }, { key: "remaining", label: "Remaining" },
    ], rows);
    store.notify("Exported holiday balances CSV");
  };
  return (
    <>
      <AdminHeader title="Holiday Balances" subtitle="Set allowances and apply adjustments — staff see changes instantly" Icon={Check} action={(() => {
        // Read-only org-wide totals, safe-guarded.
        const totalAllow = store.staff.reduce((a, s) => a + store.effectiveAllowance(s.id), 0);
        const totalConsumed = store.staff.reduce((a, s) => a + store.usedDays(s.id) + store.bankHolidayDaysUsed(), 0);
        const pct = totalAllow > 0 ? Math.round((totalConsumed / totalAllow) * 100) : 0;
        return <div className="flex flex-wrap items-center gap-2"><span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200"><Layers size={13} /> {totalConsumed}/{totalAllow}d used</span><span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200"><Activity size={13} /> {pct}% org</span><ExportBtn onClick={exportBalances} /></div>;
      })()} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or dept…" className="bg-transparent text-sm outline-none" /></div>
      </div>
      <div className="overflow-x-auto overflow-y-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up [-webkit-overflow-scrolling:touch] md:overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Staff</th><th className="px-5 py-3">Base</th><th className="px-5 py-3">Adj</th><th className="px-5 py-3">Used</th><th className="px-5 py-3">Bank</th><th className="px-5 py-3">Remaining</th><th className="px-5 py-3 w-40">Usage</th><th className="px-5 py-3">Actions</th></tr></thead>
          <tbody>
            {paged.slice.map(s => { const eff = store.effectiveAllowance(s.id); const used = store.usedDays(s.id); const bank = store.bankHolidayDaysUsed(); const left = eff - used - bank; const adjv = store.adjDays(s.id); const pct = eff > 0 ? Math.round((used + bank) / eff * 100) : 0; return (
              <tr key={s.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/40">
                <td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: s.colour }}>{s.initials}</span><div><p className="font-semibold text-slate-700">{s.name}</p><p className="text-[11px] text-slate-400">{s.dept}</p></div></div></td>
                <td className="px-5 py-3 font-medium text-slate-600">{s.allowance}d</td>
                <td className="px-5 py-3 font-medium" style={{ color: adjv > 0 ? "#059669" : adjv < 0 ? MAROON : "#94a3b8" }}>{adjv > 0 ? "+" : ""}{adjv}d</td>
                <td className="px-5 py-3 font-medium" style={{ color: MAROON }}>{used}d</td>
                <td className="px-5 py-3 font-medium" style={{ color: NAVY }}>{bank}d</td>
                <td className="px-5 py-3 font-bold text-emerald-600">{left}d</td>
                <td className="px-5 py-3"><div className="h-2 overflow-hidden rounded-full bg-slate-100 shadow-inner"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 80 ? `linear-gradient(90deg, ${MAROON}, #c2334d)` : `linear-gradient(90deg, ${NAVY}, #2c54b8)`, transition: "width .8s cubic-bezier(.4,0,.2,1)" }} /></div></td>
                <td className="px-5 py-3"><div className="flex gap-1"><button onClick={() => { setEditModal(s); setAlw(s.allowance); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Edit allowance"><Edit3 size={15} /></button><button onClick={() => setAdjModal(s)} className="rounded-lg p-1.5 text-blue-500 hover:bg-blue-50" title="Adjust days"><SlidersHorizontal size={15} /></button></div></td>
              </tr>
            ); })}
            {paged.slice.length === 0 && <tr><td colSpan={8} className="px-5 py-10"><EmptyState Icon={Search} title="No staff match" msg="Try a different name or department." /></td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
      {store.adjustments.length > 0 && <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up"><p className="mb-3 text-sm font-bold text-slate-700">Adjustment history</p><div className="space-y-2">{store.adjustments.slice().reverse().map(a => { const s = store.staff.find(x => x.id === a.staffId); return <div key={a.id} className="flex items-center gap-3 text-sm"><span className="font-semibold" style={{ color: a.days >= 0 ? "#059669" : MAROON }}>{a.days >= 0 ? "+" : ""}{a.days}d</span><span className="text-slate-700">{s?.name}</span><span className="text-slate-400">— {a.note}</span><span className="ml-auto text-xs text-slate-400">{fmtDate(a.date)}</span></div>; })}</div></div>}
      <Modal open={!!adjModal} onClose={() => setAdjModal(null)} title={`Adjust days — ${adjModal?.name || ""}`}>
        <div className="space-y-3">
          <Field label="Days (use negative to deduct)"><div className="flex items-center gap-2"><button onClick={() => setAdj(a => ({ ...a, days: a.days - 1 }))} className="rounded-lg bg-slate-100 p-2 hover:bg-slate-200"><MinusCircle size={18} /></button><input type="number" value={adj.days} onChange={e => setAdj(a => ({ ...a, days: e.target.value }))} className={inputCls + " text-center"} /><button onClick={() => setAdj(a => ({ ...a, days: Number(a.days) + 1 }))} className="rounded-lg bg-slate-100 p-2 hover:bg-slate-200"><PlusCircle size={18} /></button></div></Field>
          <Field label="Reason"><input value={adj.note} onChange={e => setAdj(a => ({ ...a, note: e.target.value }))} placeholder="e.g. Long-service bonus day" className={inputCls} /></Field>
          <PrimaryBtn onClick={applyAdj} className="w-full"><Check size={16} /> Apply adjustment</PrimaryBtn>
        </div>
      </Modal>
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title={`Edit allowance — ${editModal?.name || ""}`}>
        <div className="space-y-3"><Field label="Annual allowance (days)"><input type="number" value={alw} onChange={e => setAlw(e.target.value)} className={inputCls} /></Field><PrimaryBtn onClick={saveAlw} className="w-full"><Save size={16} /> Save</PrimaryBtn></div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Calendar ----- */
function AdminCalendar({ store }) {
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ staffId: "", type: "annual", start: todayISO(), end: todayISO(), reason: "" });

  const openAdd = () => { setForm({ staffId: store.staff[0]?.id || "", type: "annual", start: todayISO(), end: todayISO(), reason: "" }); setModal(true); };
  const days = daysBetween(form.start, form.end);
  const staff = store.staff.find(s => s.id === form.staffId);
  const remaining = form.staffId ? store.remaining(form.staffId) : 0;
  // Paid types draw down the allowance; unpaid does not. Block over-allowance before
  // creating anything, so a rejected approval never leaves a dangling pending request.
  const overAllowance = form.type !== "unpaid" && form.staffId && days > remaining;

  const addHoliday = async () => {
    if (!form.staffId || overAllowance) return;
    setBusy(true);
    try {
      await store.addApprovedLeave({ staffId: form.staffId, type: form.type, start: form.start, end: form.end, reason: form.reason.trim() || "Added by admin" });
      setModal(false);
    } catch (_) { /* store toasts the error and refetches; keep the modal open */ }
    finally { setBusy(false); }
  };

  return (
    <>
      <AdminHeader title="Holiday Calendar" subtitle="Organisation-wide view of approved absences" Icon={CalendarDays}
        action={<PrimaryBtn onClick={openAdd}><Plus size={16} /> Add holiday</PrimaryBtn>} />
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up">
        <MonthGrid store={store} big />
        <div className="mt-4 border-t border-slate-100 pt-4"><p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Leave types</p><LeaveLegend />
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" /> Bank holiday — auto-applied to all staff, counts toward the 28-day allowance</div>
        </div>
      </div>
      <BankHolidayList store={store} />

      <Modal open={modal} onClose={() => setModal(false)} title="Add holiday">
        <div className="space-y-3">
          <Field label="Staff member"><select value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))} className={inputCls}>{store.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Type"><select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>{LEAVE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value, end: e.target.value > f.end ? e.target.value : f.end }))} className={inputCls} /></Field>
            <Field label="To"><input type="date" value={form.end} min={form.start} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className={inputCls} /></Field>
          </div>
          <Field label="Reason"><input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Optional" className={inputCls} /></Field>
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 ring-1 ring-slate-100">
            Added as an <b>approved</b> absence — it appears on the calendar straight away.{" "}
            {form.type === "unpaid" ? "Unpaid leave doesn't use the holiday allowance." : staff ? `${days}d requested · ${remaining}d allowance left.` : ""}
          </div>
          {overAllowance && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-600">Not enough allowance: {remaining}d left but {days}d requested. Choose Unpaid Leave, or a shorter period.</p>}
          <PrimaryBtn onClick={addHoliday} disabled={busy || !form.staffId || overAllowance} className="w-full"><Plus size={16} /> {busy ? "Adding…" : "Add holiday"}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Leave Requests ----- */
function AdminRequests({ store }) {
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ staffId: "s1", type: "annual", start: todayISO(), end: todayISO(), reason: "" });
  const create = async () => { await store.requestLeave({ staffId: form.staffId, type: form.type, start: form.start, end: form.end, reason: form.reason }); setModal(false); };
  const list = store.leave.filter(l => filter === "all" ? true : l.status === filter).slice().reverse();
  const counts = { all: store.leave.length, pending: store.leave.filter(l => l.status === "pending").length, approved: store.leave.filter(l => l.status === "approved").length, rejected: store.leave.filter(l => l.status === "rejected").length };
  const paged = usePaged(list, 10, filter);
  const exportRequests = () => {
    const rows = list.map(l => { const p = store.staff.find(s => s.id === l.staffId); const t = leaveTypeMeta(l.type); return { staff: p?.name || "Unknown", type: t.label, start: l.start, end: l.end, days: daysBetween(l.start, l.end), status: l.status, reason: l.reason }; });
    downloadCSV("leave-requests.csv", [
      { key: "staff", label: "Staff name" }, { key: "type", label: "Type" }, { key: "start", label: "Start" }, { key: "end", label: "End" }, { key: "days", label: "Days" }, { key: "status", label: "Status" }, { key: "reason", label: "Reason" },
    ], rows);
    store.notify("Exported leave requests CSV");
  };
  return (
    <>
      <AdminHeader title="Leave Requests" subtitle="Full register — create on behalf of staff or review existing" Icon={Inbox} action={<div className="flex flex-wrap items-center gap-2"><ExportBtn onClick={exportRequests} /><PrimaryBtn onClick={() => setModal(true)}><Plus size={16} /> New request</PrimaryBtn></div>} />
      <div className="mb-4 flex flex-wrap gap-2">{["all", "pending", "approved", "rejected"].map(f => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold capitalize transition-all duration-200 hover:-translate-y-0.5 active:scale-95 ${filter === f ? "text-white shadow-md" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:ring-slate-300"}`} style={filter === f ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` } : {}}>{f} <span className="opacity-70">({counts[f]})</span></button>)}</div>
      <div className="space-y-3">
        {list.length === 0 && <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"><EmptyState Icon={Inbox} title="No requests here" msg={filter === "all" ? "Leave requests will appear here." : `No ${filter} requests right now.`} /></div>}
        {paged.slice.map((l, i) => { const p = store.staff.find(s => s.id === l.staffId); const t = leaveTypeMeta(l.type); const T = t.icon; return (
          <div key={l.id} className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300/80 sm:flex-row sm:items-center fade-up" style={{ animationDelay: `${i * 45}ms` }}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm" style={{ background: p?.colour }}>{p?.initials}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-700">{p?.name}</p><span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: t.colour + "1a", color: t.colour }}><T size={11} /> {t.label}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusBadge(l.status)}`}>{l.status}</span></div>
              <p className="mt-1 text-sm text-slate-500">{fmtDate(l.start)}{l.end !== l.start && ` → ${fmtDate(l.end)}`} · <b>{daysBetween(l.start, l.end)}d</b> · <span className="italic">"{l.reason}"</span></p>
            </div>
            {l.status === "pending" && <div className="flex gap-2"><button onClick={() => store.decideLeave(l.id, "rejected")} className="flex items-center gap-1 rounded-xl border-2 border-rose-200 px-3 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50"><XCircle size={15} /> Decline</button><PrimaryBtn colour="#059669" onClick={() => store.decideLeave(l.id, "approved")} className="!py-2"><CheckCircle2 size={15} /> Approve</PrimaryBtn></div>}
          </div>
        ); })}
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
      <Modal open={modal} onClose={() => setModal(false)} title="New leave request">
        <div className="space-y-3">
          <Field label="Staff member"><select value={form.staffId} onChange={e => setForm(f => ({ ...f, staffId: e.target.value }))} className={inputCls}>{store.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Type"><select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>{LEAVE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="From"><input type="date" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value, end: e.target.value > f.end ? e.target.value : f.end }))} className={inputCls} /></Field><Field label="To"><input type="date" value={form.end} min={form.start} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className={inputCls} /></Field></div>
          <Field label="Reason"><input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className={inputCls} /></Field>
          <PrimaryBtn onClick={create} className="w-full"><Plus size={16} /> Create request</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Documents ----- */
function AdminDocuments({ store }) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", type: "Policy", scope: "all", assignedTo: "" });
  const add = async () => { if (!form.name.trim()) return; await store.addDoc({ name: form.name, type: form.type, scope: form.scope, assignedTo: form.assignedTo }); setModal(false); setForm({ name: "", type: "Policy", scope: "all", assignedTo: "" }); };
  const del = (d) => store.deleteDoc(d.id);
  const iconFor = (t) => ({ Policy: FileText, Payroll: Briefcase, Calendar: CalendarDays, HR: Users, Form: ClipboardList }[t] || FileText);
  return (
    <>
      <AdminHeader title="Documents" subtitle="Publish documents to all staff or assign privately" Icon={FileText} action={<PrimaryBtn onClick={() => setModal(true)}><FileUp size={16} /> Upload</PrimaryBtn>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200"><Layers size={13} /> {store.docs.length} total</span>
        <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200"><Users size={13} /> {store.docs.filter(d => d.scope === "all").length} all-staff</span>
        <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200"><ShieldCheck size={13} /> {store.docs.filter(d => d.scope !== "all").length} private</span>
      </div>
      {store.docs.length === 0 && <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"><EmptyState Icon={FileUp} title="No documents yet" msg="Upload a policy, form or payslip to share with staff." /></div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {store.docs.map((d, i) => { const I = iconFor(d.type); const dc = docTypeColour(d.type); const assignee = d.assignedTo ? store.staff.find(s => s.id === d.assignedTo) : null; return (
          <div key={d.id} className="hover-lift group rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:shadow-lg hover:ring-slate-300/80 fade-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" style={{ background: dc + "14" }}><I size={20} style={{ color: dc }} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-700">{d.name}</p><p className="text-xs text-slate-400">{fmtDate(d.date)}</p></div><button onClick={() => del(d)} className="rounded-lg p-1.5 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"><Trash2 size={15} /></button></div>
            <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: dc + "1a", color: dc }}>{d.type}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${d.scope === "all" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{d.scope === "all" ? "All staff" : assignee ? `Private · ${assignee.name.split(" ")[0]}` : "Personal template"}</span></div>
          </div>
        ); })}
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Upload document">
        <div className="space-y-3">
          <Field label="Document name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Fire Safety Policy 2026" className={inputCls} /></Field>
          <Field label="Type"><select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>{DOC_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Visibility"><select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} className={inputCls}><option value="all">All staff</option><option value="personal">Private (one person)</option></select></Field>
          {form.scope === "personal" && <Field label="Assign to"><select value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))} className={inputCls}><option value="">Select staff…</option>{store.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <div className="rounded-xl border-2 border-dashed border-slate-200 py-6 text-center text-xs text-slate-400"><FileUp size={20} className="mx-auto mb-1 text-slate-300" />Drag a file here (demo — no upload needed)</div>
          <PrimaryBtn onClick={add} disabled={!form.name.trim()} className="w-full"><Check size={16} /> Publish document</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Approvals ----- */
function AdminApprovals({ store }) {
  const [noteModal, setNoteModal] = useState(null); // {leave, action}
  const [note, setNote] = useState("");
  const pending = store.leave.filter(l => l.status === "pending");
  const history = store.leave.filter(l => l.status !== "pending").slice().reverse();
  const confirm = async () => { await store.decideLeave(noteModal.leave.id, noteModal.action, note); setNoteModal(null); setNote(""); };
  return (
    <>
      <AdminHeader title="Approvals" subtitle="Approve or decline with a note — decisions sync to the staff app" Icon={ThumbsUp} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-bold text-slate-700">Pending ({pending.length})</p>
          <div className="space-y-3">
            {pending.length === 0 && <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"><EmptyState Icon={CheckCircle2} title="Nothing to approve" msg="You're all caught up." /></div>}
            {pending.map((l, i) => { const p = store.staff.find(s => s.id === l.staffId); const t = leaveTypeMeta(l.type); const T = t.icon; return (
              <div key={l.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300/80 fade-up" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: p?.colour }}>{p?.initials}</span><div className="flex-1"><p className="text-sm font-bold text-slate-700">{p?.name}</p><p className="text-xs text-slate-400">{p?.role}</p></div><span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: t.colour + "1a", color: t.colour }}><T size={11} /> {t.label}</span></div>
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600"><p><b>{fmtDate(l.start)}</b>{l.end !== l.start && <> → <b>{fmtDate(l.end)}</b></>} · {daysBetween(l.start, l.end)}d</p><p className="mt-1 italic text-slate-500">"{l.reason}"</p></div>
                <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => { setNoteModal({ leave: l, action: "rejected" }); setNote(""); }} className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-rose-200 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50"><XCircle size={16} /> Decline</button><PrimaryBtn colour="#059669" onClick={() => { setNoteModal({ leave: l, action: "approved" }); setNote(""); }} className="!py-2.5"><CheckCircle2 size={16} /> Approve</PrimaryBtn></div>
              </div>
            ); })}
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700"><History size={15} /> Decision history</p>
          <div className="space-y-2">
            {history.length === 0 && <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"><EmptyState Icon={History} title="No decisions yet" msg="Approved and declined requests will be logged here." /></div>}
            {history.map((l, i) => { const p = store.staff.find(s => s.id === l.staffId); const t = leaveTypeMeta(l.type); return (
              <div key={l.id} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 transition-colors duration-200 hover:bg-slate-50/60 fade-up" style={{ animationDelay: `${i * 35}ms` }}>
                <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: p?.colour }}>{p?.initials}</span><span className="text-sm font-semibold text-slate-700">{p?.name}</span><span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusBadge(l.status)}`}>{l.status}</span></div>
                <p className="mt-1.5 text-xs text-slate-500">{t.label} · {fmtDate(l.start)}{l.end !== l.start && ` → ${fmtDate(l.end)}`}{l.note && <> · <span className="italic">"{l.note}"</span></>}</p>
              </div>
            ); })}
          </div>
        </div>
      </div>
      <Modal open={!!noteModal} onClose={() => setNoteModal(null)} title={noteModal?.action === "approved" ? "Approve request" : "Decline request"}>
        <div className="space-y-3"><Field label="Note to staff member (optional)"><textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={noteModal?.action === "approved" ? "e.g. Enjoy your time off!" : "e.g. Clashes with exam week — please rebook."} className={inputCls + " resize-none"} /></Field><PrimaryBtn colour={noteModal?.action === "approved" ? "#059669" : MAROON} onClick={confirm} className="w-full">{noteModal?.action === "approved" ? <><CheckCircle2 size={16} /> Confirm approval</> : <><XCircle size={16} /> Confirm decline</>}</PrimaryBtn></div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Sign-Up Requests ----- */
// Self-service sign-ups from the staff mobile app. Approving here is what
// actually creates the staff account — until then the applicant has no login.
function AdminSignups({ store }) {
  const [modal, setModal] = useState(null); // { req, action }
  const [note, setNote] = useState("");
  const [allowance, setAllowance] = useState(28);
  const [busy, setBusy] = useState(false);

  const rows = store.signups || [];
  const pending = rows.filter(r => r.status === "pending");
  const history = rows.filter(r => r.status !== "pending");

  const open = (req, action) => { setModal({ req, action }); setNote(""); setAllowance(28); };

  const confirm = async () => {
    setBusy(true);
    try {
      await store.decideSignup(modal.req.id, modal.action, note, modal.action === "approved" ? Number(allowance) : undefined);
      setModal(null);
    } catch (_) {
      // The store already surfaced the error as a toast and refetched, so the
      // list is accurate; keep the modal open so the admin can see what happened.
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => downloadCSV("signup-requests.csv", [
    { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Position" },
    { key: "dept", label: "Department" }, { key: "site", label: "Site" }, { key: "status", label: "Status" },
    { key: "decidedBy", label: "Decided by" }, { key: "decidedAt", label: "Decided on" },
  ], rows.map(r => ({ ...r, site: r.site || "", decidedBy: r.decidedBy || "", decidedAt: r.decidedAt || "" })));

  return (
    <>
      <AdminHeader
        title="Sign-Up Requests"
        subtitle="People who signed up in the staff app — approving one creates their account"
        Icon={UserCheck}
        action={rows.length > 0 && <ExportBtn onClick={exportCsv} label="Export CSV" />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-bold text-slate-700">Awaiting approval ({pending.length})</p>
          <div className="space-y-3">
            {pending.length === 0 && (
              <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <EmptyState Icon={CheckCircle2} title="No requests waiting" msg="New sign-ups from the staff app appear here." />
              </div>
            )}
            {pending.map((r, i) => (
              <div key={r.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md fade-up" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: NAVY }}>
                    {initialsOf(r.name)}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-700">{r.name}</p>
                    <p className="text-xs text-slate-400">{r.kind === "student" ? "Student" : `${r.role} · ${r.dept}`}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${r.kind === "student" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>{r.kind === "student" ? <><GraduationCap size={10} /> Student</> : <><Briefcase size={10} /> Staff</>}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Pending</span>
                  </div>
                </div>
                <div className="mt-3 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <p className="flex items-center gap-1.5"><Mail size={12} className="text-slate-400" /> {r.email}</p>
                  {r.kind === "student"
                    ? <p className="flex items-center gap-1.5"><GraduationCap size={12} className="text-slate-400" /> Student — {r.studentId ? "matches an existing student record" : "no matching record (a new one will be created on approval)"}</p>
                    : <>
                        <p className="flex items-center gap-1.5"><Briefcase size={12} className="text-slate-400" /> {r.role}</p>
                        <p className="flex items-center gap-1.5"><Building2 size={12} className="text-slate-400" /> {r.dept}</p>
                        {r.site && <p className="flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" /> {r.site}</p>}
                      </>}
                  <p className="flex items-center gap-1.5 text-slate-400"><Clock3 size={12} /> Requested {fmtDate(String(r.requestedAt).slice(0, 10))}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={() => open(r, "rejected")} className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-rose-200 py-2.5 text-sm font-bold text-rose-600 transition hover:bg-rose-50">
                    <XCircle size={16} /> Decline
                  </button>
                  <PrimaryBtn colour="#059669" onClick={() => open(r, "approved")} className="!py-2.5">
                    <CheckCircle2 size={16} /> Approve
                  </PrimaryBtn>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700"><History size={15} /> Decision history</p>
          <div className="space-y-2">
            {history.length === 0 && (
              <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
                <EmptyState Icon={History} title="No decisions yet" msg="Approved and declined sign-ups are logged here." />
              </div>
            )}
            {history.map((r, i) => (
              <div key={r.id} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70 transition-colors duration-200 hover:bg-slate-50/60 fade-up" style={{ animationDelay: `${i * 35}ms` }}>
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: r.status === "approved" ? "#059669" : MAROON }}>
                    {initialsOf(r.name)}
                  </span>
                  <span className="text-sm font-semibold text-slate-700">{r.name}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${r.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{r.status}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {r.kind === "student" ? "Student" : `${r.role} · ${r.dept}`}
                  {r.decidedBy && <> · by {r.decidedBy}</>}
                  {r.decidedAt && <> on {fmtDate(r.decidedAt)}</>}
                  {r.note && <> · <span className="italic">"{r.note}"</span></>}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal open={!!modal} onClose={() => !busy && setModal(null)} title={modal?.action === "approved" ? "Approve sign-up" : "Decline sign-up"}>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
            <p className="text-sm font-bold text-slate-700">{modal?.req.name}</p>
            <p>{modal?.req.email}</p>
            <p>{modal?.req.kind === "student" ? "Student" : `${modal?.req.role} · ${modal?.req.dept}`}</p>
          </div>

          {modal?.action === "approved" ? (
            modal?.req.kind === "student" ? (
              <p className="flex items-start gap-1.5 rounded-xl bg-violet-50 px-3 py-2 text-[11px] text-violet-700 ring-1 ring-violet-100">
                <GraduationCap size={13} className="mt-px shrink-0" />
                {modal?.req.studentId
                  ? "This links their existing student record and lets them sign in with the password they chose."
                  : "No matching student record was found — approving saves a new student in the Students table."}
                {" "}No holiday allowance is needed for a student.
              </p>
            ) : (
            <>
              <Field label="Holiday allowance (days per year)">
                <input type="number" min={0} value={allowance} onChange={e => setAllowance(e.target.value)} className={inputCls} />
              </Field>
              <p className="flex items-start gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-[11px] text-blue-700 ring-1 ring-blue-100">
                <ShieldCheck size={13} className="mt-px shrink-0" />
                This creates their staff account. They sign in with the password they chose.
              </p>
            </>
            )
          ) : (
            <Field label="Reason (optional, kept for your records)">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="e.g. Not a current member of staff." className={inputCls + " resize-none"} />
            </Field>
          )}

          <PrimaryBtn colour={modal?.action === "approved" ? "#059669" : MAROON} onClick={confirm} disabled={busy} className="w-full">
            {modal?.action === "approved" ? <><CheckCircle2 size={16} /> {modal?.req.kind === "student" ? "Approve & activate student" : "Approve & create account"}</> : <><XCircle size={16} /> Confirm decline</>}
          </PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Student Queries ----- */
function AdminStudentQueries({ store }) {
  const [filter, setFilter] = useState("all"); // all | open | answered
  const [modal, setModal] = useState(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const all = store.studentQueries || [];
  const ql = query.trim().toLowerCase();
  const rows = all
    .filter(q => filter === "all" || q.status === filter)
    .filter(q => !ql || (q.studentName || "").toLowerCase().includes(ql) || (q.subject || "").toLowerCase().includes(ql) || (q.message || "").toLowerCase().includes(ql));
  const open = all.filter(q => q.status === "open").length;

  const openReply = (q) => { setModal(q); setReply(q.response || ""); };
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try { await store.respondStudentQuery(modal.id, reply.trim()); setModal(null); setReply(""); }
    catch (e) {} finally { setBusy(false); }
  };

  return (
    <>
      <AdminHeader title="Student Queries" subtitle="Questions from students — reply and they'll see it in their app" Icon={Inbox}
        action={<span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200"><MessageSquare size={13} /> {open} open</span>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student, subject or text…" className="bg-transparent text-sm outline-none" /></div>
        <div className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
          {["all", "open", "answered"].map(f => <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition ${filter === f ? "text-white" : "text-slate-500 hover:bg-slate-100"}`} style={filter === f ? { background: NAVY } : {}}>{f}</button>)}
        </div>
      </div>

      <div className="space-y-3">
        {rows.length === 0 && <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"><EmptyState Icon={Inbox} title="No queries" msg="Questions students send from their app appear here." /></div>}
        {rows.map((q, i) => (
          <div key={q.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 fade-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: q.studentColour || NAVY }}>{q.studentInitials || "S"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-700">{q.studentName || "Student"} <span className="text-[11px] font-medium text-slate-400">{q.studentRef ? `· ${q.studentRef}` : ""}</span></p>
                <p className="truncate text-xs text-slate-400">{q.subject}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${q.status === "open" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{q.status === "open" ? "Open" : "Answered"}</span>
            </div>
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{q.message}</p>
            {q.response && <div className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-800 ring-1 ring-blue-100"><p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-500">Your reply{q.respondedBy ? ` · ${q.respondedBy}` : ""}{q.respondedAt ? ` · ${fmtDate(q.respondedAt)}` : ""}</p>{q.response}</div>}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[11px] text-slate-400">Sent {fmtDate(String(q.createdAt).slice(0, 10))}</p>
              <PrimaryBtn onClick={() => openReply(q)} className="!py-2 !px-3 text-xs">{q.status === "open" ? <><Send size={14} /> Reply</> : <><Edit3 size={14} /> Edit reply</>}</PrimaryBtn>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!modal} onClose={() => !busy && setModal(null)} title="Reply to student">
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
            <p className="text-sm font-bold text-slate-700">{modal?.studentName}</p>
            <p className="text-[11px] text-slate-400">{modal?.subject}</p>
            <p className="mt-1.5 text-sm text-slate-600">{modal?.message}</p>
          </div>
          <Field label="Your acknowledgement / feedback">
            <textarea value={reply} onChange={e => setReply(e.target.value)} rows={4} placeholder="Write a reply the student will see in their app…" className={inputCls + " resize-none"} />
          </Field>
          <PrimaryBtn onClick={send} disabled={busy || !reply.trim()} className="w-full">{busy ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : <><Send size={16} /> Send reply</>}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Daily Summaries ----- */
function AdminSummaries({ store }) {
  const [day, setDay] = useState(todayISO());
  const [q, setQ] = useState("");
  const dayRecs = store.staff.map(s => ({ s, rec: store.checkins.find(c => c.staffId === s.id && c.date === day) })).filter(({ s }) => (s.name).toLowerCase().includes(q.toLowerCase()));
  const withSummary = dayRecs.filter(r => r.rec?.summary).length;
  const paged = usePaged(dayRecs, 10, day + "|" + q);
  const exportSummaries = () => {
    const rows = dayRecs.map(({ s, rec }) => ({ name: s.name, dept: s.dept, in: (rec && rec.in) ? rec.in : "", out: rec?.out || "", summary: rec?.summary || "" }));
    downloadCSV(`summaries-${day}.csv`, [
      { key: "name", label: "Name" }, { key: "dept", label: "Dept" }, { key: "in", label: "In" }, { key: "out", label: "Out" }, { key: "summary", label: "Summary" },
    ], rows);
    store.notify("Exported summaries CSV");
  };
  return (
    <>
      <AdminHeader title="Daily Summaries" subtitle="What each staff member reported working on" Icon={ClipboardList} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="date" value={day} onChange={e => setDay(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium outline-none" />
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search staff…" className="bg-transparent text-sm outline-none" /></div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200"><Check size={13} /> {withSummary} submitted</span>
        {store.staff.length > 0 && <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200"><Activity size={13} /> {Math.round((withSummary / store.staff.length) * 100)}% of staff</span>}
        <ExportBtn onClick={exportSummaries} className="ml-auto" />
      </div>
      {dayRecs.length === 0 && <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"><EmptyState Icon={Search} title="No staff match" msg="Try a different name or date." /></div>}
      <div className="grid gap-3 md:grid-cols-2">
        {paged.slice.map(({ s, rec }, i) => (
          <div key={s.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300/80 fade-up" style={{ animationDelay: `${i * 35}ms` }}>
            <div className="mb-2 flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: s.colour }}>{s.initials}</span><div><p className="text-sm font-bold text-slate-700">{s.name}</p><p className="text-[11px] text-slate-400">{s.dept}{rec && rec.in ? ` · In ${rec.in}${rec.out ? ` · Out ${rec.out}` : ""}` : ""}</p></div></div>
            {rec?.summary ? <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">{rec.summary}</p> : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-sm italic text-slate-400">No summary submitted</p>}
          </div>
        ))}
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
    </>
  );
}

/* ============================================================
   Dashboard: Attendance Registers — HND
   Sessions per module -> take the register (P/L/E/A + remarks)
   -> per-module and overall attendance percentages.
   ============================================================ */
function AdminHndRegisters({ store }) {
  const { refreshHnd, hndLoaded, modules, students, attendance, semesters, semesterId } = store;
  // Opens on Programmes — the top of the hierarchy. From a programme you drill
  // into its Courses, and from a course into its sessions and registers.
  const [view, setView] = useState("programmes"); // programmes | modules | sessions | percentages | students | semesters
  const [moduleId, setModuleId] = useState("");
  // Which programme the Courses gallery is filtered to ("" = all programmes).
  const [courseProgramme, setCourseProgramme] = useState("");
  const [openRegister, setOpenRegister] = useState(null); // session id being marked

  // Loads on first open, and again whenever the semester picker changes
  // (refreshHnd depends on semesterId).
  useEffect(() => { refreshHnd(); }, [refreshHnd]);
  // Default to the first module as soon as they arrive, and recover if the
  // selected module is deleted underneath us.
  useEffect(() => {
    if (!modules.length) { setModuleId(""); return; }
    if (!moduleId || !modules.some(m => m.id === moduleId)) setModuleId(modules[0].id);
  }, [modules, moduleId]);
  // Fall back to "All semesters" if the scoped semester is deleted, or if the
  // last semester goes and leaves us stuck on "unassigned" with no picker.
  useEffect(() => {
    if (!semesterId) return;
    const orphaned = semesterId === "unassigned" ? semesters.length === 0 : !semesters.some(s => s.id === semesterId);
    if (orphaned) store.setSemesterId("");
  }, [semesters, semesterId, store]);

  const selected = modules.find(m => m.id === moduleId) || null;

  if (!hndLoaded) {
    return (
      <>
        <AdminHeader title="Attendance Registers — HND" subtitle="Loading modules, students and registers…" Icon={ClipboardList} />
        <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>
      </>
    );
  }

  // Taking a register replaces the page body — it's a focused, full-width task.
  if (openRegister) {
    return <HndRegister store={store} sessionId={openRegister} onBack={() => setOpenRegister(null)} />;
  }

  const tabs = [
    { key: "programmes", label: "Programmes", I: Layers },
    { key: "modules", label: "Courses", I: GraduationCap },
    { key: "sessions", label: "Sessions & registers", I: ClipboardList },
    { key: "percentages", label: "Attendance %", I: Percent },
    { key: "students", label: "Students", I: Users },
    { key: "semesters", label: "Semesters", I: CalendarDays },
  ];
  // Everything on the page reads from the same scoped session list.
  const scoped = scopeSessions(store.sessions, semesterId, semesters);

  return (
    <>
      <AdminHeader
        title="Attendance Registers — HND"
        subtitle="Take module registers and track attendance across the programme"
        Icon={ClipboardList}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <HndSemesterPicker store={store} />
            <button onClick={() => refreshHnd()} className="press flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        }
      />
      <HndOverviewStats store={store} attendance={attendance} modules={modules} students={students} sessions={scoped} />
      <div className="mb-4 mt-5 flex flex-wrap gap-1.5">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            className={`press flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold shadow-sm transition-all ${view === t.key ? "text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
            style={view === t.key ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` } : {}}>
            <t.I size={14} /> {t.label}
            {/* Only a warning once semesters exist — before that, everything is "unassigned" by definition. */}
            {t.key === "semesters" && semesters.length > 0 && store.unassignedSessions > 0 && <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-slate-900">{store.unassignedSessions}</span>}
          </button>
        ))}
      </div>
      {view === "programmes" && <HndProgrammes store={store} onOpen={(pid) => { setCourseProgramme(pid); setView("modules"); }} />}
      {view === "modules" && <HndModules store={store} programmeFilter={courseProgramme} setProgrammeFilter={setCourseProgramme} onView={(id) => { setModuleId(id); setView("sessions"); }} />}
      {view === "sessions" && <HndSessions store={store} moduleId={moduleId} setModuleId={setModuleId} selected={selected} onTake={setOpenRegister} scoped={scoped} />}
      {view === "percentages" && <HndPercentages store={store} />}
      {view === "students" && <HndStudents store={store} />}
      {view === "semesters" && <HndSemesters store={store} />}
    </>
  );
}

// Scopes the whole page to one teaching period. Hidden entirely until a semester
// exists — with none defined, every session is "unassigned" and the picker would
// only offer two ways to say "everything".
function HndSemesterPicker({ store }) {
  const { semesters, semesterId, setSemesterId, unassignedSessions } = store;
  if (!semesters.length) return null;
  return (
    <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
      <CalendarDays size={14} className="text-slate-400" />
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Semester</span>
      <select value={semesterId} onChange={e => setSemesterId(e.target.value)} className="bg-transparent text-xs font-bold outline-none" style={{ color: NAVY }}>
        <option value="">All semesters</option>
        {semesters.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        {unassignedSessions > 0 && <option value="unassigned">Outside any semester ({unassignedSessions})</option>}
      </select>
    </label>
  );
}

// The two headline figures the college cares about, plus supporting counts.
// `sessions` arrives already scoped to the selected semester.
function HndOverviewStats({ store, attendance, modules, students, sessions }) {
  const overall = attendance?.overall;
  const untaken = sessions.filter(s => s.markedCount === 0 && s.date <= todayISO()).length;
  const tone = pctTone(overall?.pct ?? null);
  const scopeNote = store.semesterId ? semesterLabel(store.semesterId, store.semesters) : "all modules combined";
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="Overall attendance" value={fmtPct(overall?.pct ?? null)} sub={scopeNote} Icon={Percent} tone={tone.colour} delay={0} />
      <StatCard label="Students" value={students.length} sub="on the HND programme" Icon={Users} tone={NAVY} delay={60} animate />
      <StatCard label="Modules" value={modules.length} sub="running this year" Icon={BookOpen} tone="#6d28d9" delay={120} animate />
      <StatCard label="Registers to take" value={untaken} sub={untaken === 1 ? "session not yet marked" : "sessions not yet marked"} Icon={AlertCircle} tone={untaken > 0 ? "#b45309" : "#059669"} delay={180} animate />
    </div>
  );
}

/* ----- Sessions list (per module) ----- */
// 24h "HH:MM" → compact 12h, e.g. "10:00" → "10AM", "13:30" → "1:30PM".
const fmt12 = (t) => { if (!t) return ""; const [h, m] = String(t).split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };

function HndSessions({ store, moduleId, setModuleId, selected, onTake, scoped }) {
  const [filter, setFilter] = useState("all"); // all | past | upcoming
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ date: todayISO(), start: "10:00", end: "13:00", description: "", audience: "All students", kind: "Teaching" });

  const today = todayISO();
  const mine = scoped.filter(s => s.moduleId === moduleId);
  // Number the registers that fall on the same day (a 6-hour day has two), so they
  // stay distinguishable now the time column is gone.
  const byDate = {};
  mine.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  Object.values(byDate).forEach(arr => arr.sort((a, b) => (a.start || "").localeCompare(b.start || "")));
  const regInfo = (s) => { const arr = byDate[s.date] || [s]; return { idx: arr.findIndex(x => x.id === s.id) + 1, total: arr.length }; };
  // Always list in order from the start date (ascending), regardless of server order.
  const filtered = mine
    .filter(s => filter === "all" || (filter === "past" ? s.date <= today : s.date > today))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start || "").localeCompare(b.start || ""));
  const paged = usePaged(filtered, 10, `${moduleId}|${filter}|${store.semesterId}`);
  // Warn before a session is filed outside the semester currently being viewed —
  // it would save fine but immediately disappear from this list.
  const formSemester = semesterOf(form.date, store.semesters);
  const outOfScope = store.semesterId && (store.semesterId === "unassigned" ? !!formSemester : formSemester?.id !== store.semesterId);

  const openAdd = () => { setEdit(null); setForm({ date: today, start: "10:00", end: "13:00", description: selected?.code || "", audience: "All students", kind: "Teaching" }); setModal(true); };
  const openEdit = (s) => { setEdit(s); setForm({ date: s.date, start: s.start, end: s.end, description: s.description, audience: s.audience, kind: s.kind || "Teaching" }); setModal(true); };
  const save = async () => {
    try {
      if (edit) await store.updateSession(edit.id, form);
      else await store.addSession({ ...form, moduleId });
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
  };
  const remove = async (s) => {
    if (s.markedCount > 0 && !window.confirm(`This session has ${s.markedCount} mark${s.markedCount === 1 ? "" : "s"} recorded. Deleting it removes those marks and changes attendance percentages. Continue?`)) return;
    await store.removeSession(s.id);
  };
  const exportSessions = () => {
    downloadCSV(`sessions-${selected?.code || "hnd"}.csv`,
      [{ key: "date", label: "Date" }, { key: "time", label: "Time" }, { key: "audience", label: "Type" }, { key: "description", label: "Description" }, { key: "marked", label: "Marked" }],
      filtered.map(s => ({ date: s.date, time: `${s.start}–${s.end}`, audience: s.audience, description: s.description, marked: s.markedCount })));
    store.notify("Exported sessions CSV");
  };

  if (!store.modules.length) {
    return <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"><EmptyState Icon={BookOpen} title="No modules yet" msg="Add a module on the Modules tab, then you can timetable sessions and take registers." /></div>;
  }

  return (
    <>
      {/* Module picker */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {store.modules.map(m => {
          // Session count for the semester in view, not the module's all-time total.
          const count = store.attendance?.moduleTotals?.[m.id]?.sessionCount ?? m.sessionCount;
          return (
            <button key={m.id} onClick={() => setModuleId(m.id)}
              className={`press rounded-xl px-3.5 py-2 text-left text-xs font-bold shadow-sm ring-1 transition-all ${moduleId === m.id ? "text-white ring-transparent" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
              style={moduleId === m.id ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` } : {}}>
              <span className="block">{m.code}</span>
              <span className={`block text-[10px] font-medium ${moduleId === m.id ? "text-white/60" : "text-slate-400"}`}>{m.studentCount} students · {count} session{count === 1 ? "" : "s"}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-lg font-extrabold" style={{ color: NAVY_DARK }}>{selected.name}</p>
            <p className="text-xs text-slate-400">
              {selected.code}{selected.tutor ? ` · Tutor: ${selected.tutor}` : ""}
              {store.semesterId ? ` · ${semesterLabel(store.semesterId, store.semesters)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
              {[{ k: "all", l: "All" }, { k: "past", l: "All past" }, { k: "upcoming", l: "Upcoming" }].map(f => (
                <button key={f.k} onClick={() => setFilter(f.k)} className={`press rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${filter === f.k ? "text-white" : "text-slate-500 hover:bg-slate-100"}`} style={filter === f.k ? { background: NAVY } : {}}>{f.l}</button>
              ))}
            </div>
            <ExportBtn onClick={exportSessions} label="Export" />
            <PrimaryBtn onClick={openAdd}><Plus size={16} /> Add session</PrimaryBtn>
          </div>
        </div>
      )}

      <div className="overflow-x-auto overflow-y-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up [-webkit-overflow-scrolling:touch] md:overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Time</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Register</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {paged.slice.map(s => {
                const future = s.date > today;
                const done = s.markedCount > 0;
                const sem = semesterOf(s.date, store.semesters);
                return (
                  <tr key={s.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/40">
                    <td className="px-5 py-3">
                      <button onClick={() => onTake(s.id)} className="text-left font-semibold transition hover:underline" style={{ color: NAVY }}>{fmtDay(s.date)}</button>
                      {s.date === today && <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">TODAY</span>}
                      {/* Only worth showing when it isn't already implied by the picker. */}
                      {!store.semesterId && store.semesters.length > 0 && (
                        <p className={`mt-0.5 text-[10px] font-semibold ${sem ? "text-slate-400" : "text-amber-600"}`}>{sem ? sem.name : "Outside any semester"}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 font-medium text-slate-600 whitespace-nowrap tabular-nums">{fmt12(s.start)} – {fmt12(s.end)}</td>
                    <td className="px-5 py-3 text-slate-500">{s.audience}</td>
                    <td className="px-5 py-3">
                      {(() => {
                        // Prefer the register's saved type; otherwise derive it from its
                        // position that day — 1st = Teaching, 2nd = Seminar — so registers
                        // created before the type existed still read correctly.
                        const ri = regInfo(s);
                        const label = s.kind || (ri.total > 1 ? (ri.idx === 1 ? "Teaching" : ri.idx === 2 ? "Seminar" : `Register ${ri.idx}`) : "");
                        return label
                          ? <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={label === "Teaching" ? { background: "#e0e7ff", color: "#4338ca" } : label === "Seminar" ? { background: "#f3e8ff", color: "#7e22ce" } : { background: "#f1f5f9", color: "#475569" }}>{label}</span>
                          : <span className="font-medium text-slate-600">{s.description || "—"}</span>;
                      })()}
                    </td>
                    <td className="px-5 py-3">
                      {done
                        ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Taken · {s.markedCount}</span>
                        : future
                          ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">Scheduled</span>
                          : <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">Not taken</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => onTake(s.id)} title={done ? "Edit register" : "Take register"} className="press flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:opacity-90" style={{ background: done ? "#0d7a5f" : NAVY }}>
                          <PlayCircle size={13} /> {done ? "Edit" : "Take"}
                        </button>
                        <button onClick={() => openEdit(s)} title="Edit session" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Settings size={15} /></button>
                        <button onClick={() => remove(s)} title="Delete session" className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paged.slice.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-10">
                  <EmptyState Icon={CalendarDays} title="No sessions"
                    msg={store.semesterId
                      ? `No sessions for this module in ${semesterLabel(store.semesterId, store.semesters)}. Switch the semester picker to "All semesters" to see the rest.`
                      : filter === "all" ? "Add a session to start taking registers for this module." : "Try a different filter."} />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />

      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit session" : "Add session"}>
        <div className="space-y-3">
          <Field label="Date"><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start time"><input type="time" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} className={inputCls} /></Field>
            <Field label="End time"><input type="time" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Audience"><select value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))} className={inputCls}><option>All students</option><option>Group A</option><option>Group B</option></select></Field>
            <Field label="Session type"><select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={inputCls}>{["Teaching", "Seminar", "Workshop", "Lecture", "Lab", "Tutorial"].map(k => <option key={k} value={k}>{k}</option>)}</select></Field>
          </div>
          <Field label="Description (optional)"><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={selected?.code || "e.g. Workshop"} className={inputCls} /></Field>
          {outOfScope && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>
                {formSemester ? `${fmtDate(form.date)} falls in ${formSemester.name}` : `${fmtDate(form.date)} falls outside every semester`},
                but you're viewing {semesterLabel(store.semesterId, store.semesters)}. The session will save — it just won't appear in this list.
              </span>
            </div>
          )}
          <p className="text-xs text-slate-400">Module: {selected?.code} — {selected?.name}</p>
          <PrimaryBtn onClick={save} className="w-full"><Save size={16} /> {edit ? "Save changes" : "Add session"}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Taking the register for one session ----- */
function HndRegister({ store, sessionId, onBack }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});   // studentId -> { status, remark }
  const [saved, setSaved] = useState({});   // last-saved snapshot, for the dirty check
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState("");
  const [query, setQuery] = useState("");
  const [reopened, setReopened] = useState(false);  // admin unlocked a paused (past/future term) register to correct it

  const load = useCallback(async () => {
    try {
      const d = await store.getRegister(sessionId);
      const snapshot = Object.fromEntries(d.rows.map(r => [r.student.id, { status: r.status, remark: r.remark }]));
      setData(d); setDraft(snapshot); setSaved(snapshot);
    } catch (e) { store.notify?.(e.message || "Could not load the register", "error"); }
    // store.getRegister/notify are stable across renders; sessionId is the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <><AdminHeader title="Register" subtitle="Loading…" Icon={ClipboardList} /><div className="skeleton h-64 rounded-2xl" /></>;

  const { session, module: mod, rows } = data;
  // Term gate: a unit assigned to a term only accepts marks during that term's dates.
  // Outside it (past or not-yet-started) the register is read-only — "paused" — until
  // an admin reopens it for a correction. Units with no term are always editable.
  const fullMod = store.modules.find(m => m.id === mod.id) || mod;
  const term = fullMod.termId ? (store.terms || []).find(t => t.id === fullMod.termId) : null;
  const today = todayISO();
  const termState = !term ? "none" : (today >= term.start && today <= term.end) ? "current" : (today > term.end ? "past" : "future");
  const locked = termState === "past" || termState === "future";
  const readOnly = locked && !reopened;
  const setStatus = (studentId, status) => { if (readOnly) return; setDraft(d => ({ ...d, [studentId]: { ...d[studentId], status: d[studentId]?.status === status ? null : status } })); };
  const setRemark = (studentId, remark) => { if (readOnly) return; setDraft(d => ({ ...d, [studentId]: { ...d[studentId], remark } })); };
  const applyBulk = (status) => {
    if (readOnly) return;
    setBulk(status);
    if (!status) return;
    setDraft(d => Object.fromEntries(rows.map(r => [r.student.id, { ...d[r.student.id], status }])));
  };

  const dirty = rows.some(r => {
    const a = draft[r.student.id] || {}, b = saved[r.student.id] || {};
    return (a.status || null) !== (b.status || null) || (a.remark || "") !== (b.remark || "");
  });
  const tally = summariseDraft(rows.map(r => draft[r.student.id]?.status).filter(Boolean));
  const unmarked = rows.length - tally.marked;

  const save = async () => {
    setSaving(true);
    try {
      // `locked` term → send the admin override so the server accepts the correction.
      await store.saveRegister(sessionId, rows.map(r => ({ studentId: r.student.id, status: draft[r.student.id]?.status || null, remark: draft[r.student.id]?.remark || "" })), locked);
      await load();
      setReopened(false);
    } catch (_e) { /* the store already surfaced the error as a toast */ }
    setSaving(false);
  };

  const ql = query.trim().toLowerCase();
  const visible = rows.filter(r => !ql || r.student.name.toLowerCase().includes(ql) || r.student.email.toLowerCase().includes(ql) || r.student.studentRef.includes(ql));

  // Export this week's register to CSV — every student with their mark and remark,
  // plus the session's own date/time so the file stands alone.
  const exportRegister = () => {
    const label = Object.fromEntries(ATT_STATUSES.map(s => [s.key, s.label]));
    downloadCSV(
      `register-${mod.code}-${session.date}.csv`,
      [
        { key: "date", label: "Date" }, { key: "time", label: "Time" }, { key: "module", label: "Module" },
        { key: "name", label: "Student" }, { key: "ref", label: "Student number" }, { key: "email", label: "Email" },
        { key: "status", label: "Status" }, { key: "meaning", label: "Status meaning" }, { key: "remark", label: "Remarks" },
      ],
      rows.map(r => {
        const st = draft[r.student.id]?.status || "";
        return {
          date: session.date, time: `${session.start}–${session.end}`, module: mod.code,
          name: r.student.name, ref: r.student.studentRef, email: r.student.email,
          status: st, meaning: st ? label[st] : "Unmarked", remark: draft[r.student.id]?.remark || "",
        };
      }),
    );
    store.notify?.("Exported this week's register");
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 fade-up">
        <button onClick={onBack} className="press flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
          <ChevronLeft size={15} /> Back to sessions
        </button>
        {dirty && <span className="pop flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200"><AlertCircle size={13} /> Unsaved changes</span>}
      </div>
      <AdminHeader
        title={`${mod.code} — ${fmtDay(session.date)}`}
        subtitle={`${mod.name} · ${session.start}–${session.end} · ${session.audience}${session.description ? ` · ${session.description}` : ""}`}
        Icon={ClipboardList}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExportBtn onClick={exportRegister} label="Export" />
            <PrimaryBtn onClick={save} disabled={!dirty || saving || readOnly} colour={dirty && !readOnly ? NAVY : "#94a3b8"}>{saving ? <><Loader size={16} /> Saving…</> : <><Save size={16} /> Save register</>}</PrimaryBtn>
          </div>
        }
      />

      {/* Term status: paused registers are read-only until an admin reopens them. */}
      {term && (
        <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 fade-up ${termState === "current" ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {termState === "current"
              ? <span className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={16} /> {term.name} is current — attendance is open.</span>
              : <span className="flex items-center gap-1.5 text-amber-700"><AlertCircle size={16} /> {term.name} {termState === "past" ? "has ended" : "hasn't started"} — this register is paused{reopened ? " (reopened for corrections)" : ""}.</span>}
          </div>
          {locked && !reopened && (
            <button onClick={() => setReopened(true)} className="press flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-300 transition hover:bg-amber-100">
              <Edit3 size={14} /> Reopen for corrections
            </button>
          )}
        </div>
      )}

      {/* Live tally for this session */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ATT_STATUSES.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold shadow-sm ring-1 ring-slate-200" style={{ color: s.colour }}>
            <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold text-white" style={{ background: s.colour }}>{s.key}</span>
            {s.label} · {tally[s.key]}
          </span>
        ))}
        {unmarked > 0 && <span className="flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500 ring-1 ring-slate-200">Unmarked · {unmarked}</span>}
        <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1" style={{ background: pctTone(tally.pct).colour + "12", color: pctTone(tally.pct).colour }}>
          <Percent size={13} /> Session attendance {fmtPct(tally.pct)}
        </span>
        <div className="ml-auto flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <Search size={15} className="text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student…" className="bg-transparent text-sm outline-none" />
        </div>
      </div>

      <div className="overflow-x-auto overflow-y-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up [-webkit-overflow-scrolling:touch] md:overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3">Student</th>
                <th className="px-5 py-3">Email address</th>
                {ATT_STATUSES.map(s => <th key={s.key} className="px-3 py-3 text-center" title={s.label}><span style={{ color: s.colour }}>{s.key}</span></th>)}
                <th className="px-5 py-3">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {/* Bulk-apply row — mirrors the "Set status for" control in Moodle. */}
              <tr className="border-t border-slate-100 bg-slate-50/60">
                <td className="px-5 py-3" colSpan={2}>
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-xs font-bold text-slate-500">Set status for all {rows.length} students</span>
                    <select value={bulk} onChange={e => applyBulk(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold outline-none">
                      <option value="">unselected</option>
                      {ATT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.key} — {s.label}</option>)}
                    </select>
                  </div>
                </td>
                {ATT_STATUSES.map(s => (
                  <td key={s.key} className="px-3 py-3 text-center">
                    <button onClick={() => applyBulk(s.key)} title={`Mark everyone ${s.label}`} aria-label={`Mark everyone ${s.label}`}
                      className="press mx-auto flex h-5 w-5 items-center justify-center rounded-full border-2 transition hover:scale-110"
                      style={{ borderColor: bulk === s.key ? s.colour : "#cbd5e1", background: bulk === s.key ? s.colour : "transparent" }}>
                      {bulk === s.key && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </button>
                  </td>
                ))}
                <td />
              </tr>
              {visible.map(r => {
                const cur = draft[r.student.id] || {};
                return (
                  <tr key={r.student.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/30">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: r.student.colour }}>{r.student.initials}</span>
                        <div>
                          <p className="font-semibold" style={{ color: NAVY }}>{r.student.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {r.student.studentRef}
                            {!r.enrolled && <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold text-slate-500">NO LONGER ENROLLED</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-slate-500">{r.student.email}</td>
                    {ATT_STATUSES.map(s => (
                      <td key={s.key} className="px-3 py-2.5 text-center">
                        <button onClick={() => setStatus(r.student.id, s.key)} title={s.label} aria-label={`${r.student.name}: ${s.label}`} aria-pressed={cur.status === s.key}
                          className="press mx-auto flex h-5 w-5 items-center justify-center rounded-full border-2 transition hover:scale-110"
                          style={{ borderColor: cur.status === s.key ? s.colour : "#cbd5e1", background: cur.status === s.key ? s.colour : "transparent" }}>
                          {cur.status === s.key && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </button>
                      </td>
                    ))}
                    <td className="px-5 py-2.5">
                      <input value={cur.remark || ""} onChange={e => setRemark(r.student.id, e.target.value)} placeholder="Add a comment…" maxLength={500}
                        className="w-full min-w-[180px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={7} className="px-5 py-10"><EmptyState Icon={Users} title={rows.length === 0 ? "No students enrolled" : "No students match"} msg={rows.length === 0 ? "Enrol students onto this module before taking a register." : "Try a different search term."} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          P = Present (2 pts) · L = Late (1) · E = Excused (1) · A = Absent (0). Click a selected mark again to clear it.
          {data.taken && rows.some(r => r.takenBy) && ` Last taken by ${rows.find(r => r.takenBy)?.takenBy}.`}
        </p>
        <PrimaryBtn onClick={save} disabled={!dirty || saving} colour={dirty ? NAVY : "#94a3b8"}>{saving ? <><Loader size={16} /> Saving…</> : <><Save size={16} /> Save register</>}</PrimaryBtn>
      </div>
    </>
  );
}
// Small spinner used inside buttons (lucide's Loader2 with the shared spin class).
function Loader({ size = 16 }) { return <RefreshCw size={size} className="animate-spin" />; }

/* ----- Attendance percentages: per module + overall ----- */
function HndPercentages({ store }) {
  const { attendance } = store;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name"); // name | overall
  if (!attendance) return <div className="skeleton h-64 rounded-2xl" />;

  const { modules, rows, moduleTotals, overall } = attendance;
  const ql = query.trim().toLowerCase();
  let list = rows.filter(r => !ql || r.student.name.toLowerCase().includes(ql) || r.student.studentRef.includes(ql) || r.student.email.toLowerCase().includes(ql));
  list = sort === "overall"
    ? [...list].sort((a, b) => (a.overall.pct ?? 101) - (b.overall.pct ?? 101)) // lowest first — those needing chasing
    : list;
  const paged = usePaged(list, 12, `${ql}|${sort}`);

  const atRisk = rows.filter(r => r.overall.pct !== null && r.overall.pct < 70).length;
  const scopeName = semesterLabel(store.semesterId, store.semesters);
  const slug = scopeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const exportCSV = () => {
    downloadCSV(`hnd-attendance-${slug}.csv`, [
      { key: "name", label: "Student" }, { key: "ref", label: "Student number" }, { key: "email", label: "Email" },
      ...modules.map(m => ({ key: m.id, label: `${m.code} %` })),
      { key: "overall", label: "Overall %" }, { key: "present", label: "Present" }, { key: "late", label: "Late" }, { key: "excused", label: "Excused" }, { key: "absent", label: "Absent" },
    ], rows.map(r => ({
      name: r.student.name, ref: r.student.studentRef, email: r.student.email,
      ...Object.fromEntries(modules.map(m => [m.id, r.modules[m.id] ? r.modules[m.id].pct : ""])),
      overall: r.overall.pct ?? "", present: r.overall.P, late: r.overall.L, excused: r.overall.E, absent: r.overall.A,
    })));
    store.notify(`Exported attendance CSV — ${scopeName}`);
  };

  // Nothing marked in this scope: say why rather than showing a table of dashes.
  if (attendance.scope?.sessionCount === 0 && store.semesterId) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70">
        <EmptyState Icon={CalendarDays} title={`No sessions in ${scopeName}`}
          msg="No registers fall inside this semester's dates, so there's nothing to calculate. Check the semester's start and end dates, or switch to All semesters." />
      </div>
    );
  }

  return (
    <>
      {store.semesterId && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-blue-50/70 px-3.5 py-2.5 text-xs font-semibold text-blue-900 ring-1 ring-blue-100 fade-up">
          <CalendarDays size={14} />
          Showing <span className="font-extrabold">{scopeName}</span> only — {attendance.scope.sessionCount} session{attendance.scope.sessionCount === 1 ? "" : "s"} counted. Every percentage below is for this semester.
        </div>
      )}
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up lg:col-span-2">
          <p className="mb-3 text-sm font-bold text-slate-700">Attendance by module</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={modules.map(m => ({ code: m.code, pct: moduleTotals[m.id]?.pct ?? 0 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="code" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} formatter={(v) => [`${v}%`, "Attendance"]} />
              <Bar dataKey="pct" radius={[6, 6, 0, 0]}>
                {modules.map(m => <Cell key={m.id} fill={pctTone(moduleTotals[m.id]?.pct ?? null).colour} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up">
          <p className="mb-3 text-sm font-bold text-slate-700">Across all modules{store.semesterId ? ` · ${scopeName}` : ""}</p>
          <div className="flex items-center justify-center">
            <div className="relative h-36 w-36">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#eef1f6" strokeWidth="14" />
                <circle cx="60" cy="60" r="52" fill="none" stroke={pctTone(overall.pct).colour} strokeWidth="14" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 52}`} strokeDashoffset={`${2 * Math.PI * 52 * (1 - (overall.pct ?? 0) / 100)}`} style={{ transition: "stroke-dashoffset 1s ease" }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center scale-in">
                <span className="text-3xl font-extrabold tabular-nums" style={{ color: pctTone(overall.pct).colour }}>{fmtPct(overall.pct)}</span>
                <span className="text-[11px] font-medium text-slate-400">overall</span>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
            {ATT_STATUSES.map(s => (
              <div key={s.key} className="rounded-lg py-1.5" style={{ background: s.colour + "12" }}>
                <p className="text-sm font-extrabold" style={{ color: s.colour }}>{overall[s.key]}</p>
                <p className="text-[9px] font-medium text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-400">{overall.earned} of {overall.possible} points across {overall.marked} marks</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <Search size={15} className="text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student…" className="bg-transparent text-sm outline-none" />
        </div>
        <div className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
          {[{ k: "name", l: "A–Z" }, { k: "overall", l: "Lowest first" }].map(s => (
            <button key={s.k} onClick={() => setSort(s.k)} className={`press rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${sort === s.k ? "text-white" : "text-slate-500 hover:bg-slate-100"}`} style={sort === s.k ? { background: NAVY } : {}}>{s.l}</button>
          ))}
        </div>
        {atRisk > 0 && <span className="flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200"><AlertCircle size={13} /> {atRisk} below 70%</span>}
        <ExportBtn className="ml-auto" onClick={exportCSV} label="Export attendance" />
      </div>

      <div className="overflow-x-auto overflow-y-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up [-webkit-overflow-scrolling:touch] md:overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3">Student</th>
                {modules.map(m => <th key={m.id} className="px-4 py-3 text-center" title={m.name}>{m.code}</th>)}
                <th className="px-5 py-3 text-center">Overall</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map(r => (
                <tr key={r.student.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: r.student.colour }}>{r.student.initials}</span>
                      <div><p className="font-semibold text-slate-700">{r.student.name}</p><p className="text-[11px] text-slate-400">{r.student.studentRef}</p></div>
                    </div>
                  </td>
                  {modules.map(m => {
                    const cell = r.modules[m.id];
                    if (!cell) return <td key={m.id} className="px-4 py-3 text-center text-xs text-slate-300">not enrolled</td>;
                    const tone = pctTone(cell.pct);
                    return (
                      <td key={m.id} className="px-4 py-3 text-center">
                        <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${tone.bg} ${tone.text} ${tone.ring}`} title={`${cell.P} present · ${cell.L} late · ${cell.E} excused · ${cell.A} absent (${cell.earned}/${cell.possible} pts)`}>
                          {fmtPct(cell.pct)}
                        </span>
                        <p className="mt-0.5 text-[9px] text-slate-400">{cell.marked} session{cell.marked === 1 ? "" : "s"}</p>
                      </td>
                    );
                  })}
                  <td className="px-5 py-3 text-center">
                    <span className={`inline-block rounded-lg px-3 py-1.5 text-xs font-extrabold ring-1 ${pctTone(r.overall.pct).bg} ${pctTone(r.overall.pct).text} ${pctTone(r.overall.pct).ring}`} title={`${r.overall.earned}/${r.overall.possible} points`}>
                      {fmtPct(r.overall.pct)}
                    </span>
                  </td>
                </tr>
              ))}
              {paged.slice.length === 0 && <tr><td colSpan={modules.length + 2} className="px-5 py-10"><EmptyState Icon={Percent} title="Nothing to show" msg="No students match, or no registers have been taken yet." /></td></tr>}
            </tbody>
            {paged.slice.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-5 py-3 text-xs font-extrabold uppercase tracking-wide text-slate-500">Cohort average</td>
                  {modules.map(m => (
                    <td key={m.id} className="px-4 py-3 text-center">
                      <span className="text-xs font-extrabold" style={{ color: pctTone(moduleTotals[m.id]?.pct ?? null).colour }}>{fmtPct(moduleTotals[m.id]?.pct ?? null)}</span>
                    </td>
                  ))}
                  <td className="px-5 py-3 text-center"><span className="text-sm font-extrabold" style={{ color: pctTone(overall.pct).colour }}>{fmtPct(overall.pct)}</span></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
    </>
  );
}

/* ----- Students + enrolments ----- */
function HndStudents({ store }) {
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", studentRef: "", email: "", cohortId: "", moduleIds: [] });
  const [query, setQuery] = useState("");

  const openAdd = () => { setEdit(null); setForm({ firstName: "", lastName: "", studentRef: "", email: "", cohortId: "", moduleIds: [] }); setModal(true); };
  const openEdit = (s) => { setEdit(s); setForm({ firstName: s.firstName, lastName: s.lastName, studentRef: s.studentRef, email: s.email, cohortId: s.cohortId || "", moduleIds: s.moduleIds || [] }); setModal(true); };
  const toggleModule = (id) => setForm(f => ({ ...f, moduleIds: f.moduleIds.includes(id) ? f.moduleIds.filter(x => x !== id) : [...f.moduleIds, id] }));
  const save = async () => {
    try {
      if (edit) {
        await store.updateStudent(edit.id, { firstName: form.firstName, lastName: form.lastName, studentRef: form.studentRef, email: form.email, cohortId: form.cohortId || null });
        await store.setEnrolments(edit.id, form.moduleIds);
      } else {
        await store.addStudent(form);
      }
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
  };
  const remove = async (s) => {
    if (!window.confirm(`Remove ${s.name}? Their attendance marks will be deleted too.`)) return;
    await store.removeStudent(s.id);
  };

  const ql = query.trim().toLowerCase();
  const filtered = store.students.filter(s => !ql || s.name.toLowerCase().includes(ql) || s.email.toLowerCase().includes(ql) || s.studentRef.includes(ql));
  const paged = usePaged(filtered, 12, ql);
  // The email defaults to the student number, matching the college convention.
  const emailPreview = form.email || (form.studentRef ? `${form.studentRef}@londonbrookescollege.co.uk` : "");

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <Search size={15} className="text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, number or email…" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <PrimaryBtn className="ml-auto" onClick={openAdd}><UserPlus size={16} /> Add student</PrimaryBtn>
      </div>
      <div className="overflow-x-auto overflow-y-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up [-webkit-overflow-scrolling:touch] md:overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr><th className="px-5 py-3">Student</th><th className="px-5 py-3">Number</th><th className="px-5 py-3">Email address</th><th className="px-5 py-3">Modules</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {paged.slice.map(s => (
                <tr key={s.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: s.colour }}>{s.initials}</span>
                      <span className="font-semibold text-slate-700">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 font-medium tabular-nums text-slate-600">{s.studentRef}</td>
                  <td className="px-5 py-3 text-slate-500">{s.email}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(s.moduleIds || []).map(id => { const m = store.modules.find(x => x.id === id); return m ? <span key={id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{m.code}</span> : null; })}
                      {(s.moduleIds || []).length === 0 && <span className="text-[11px] text-slate-300">none</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(s)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Edit3 size={15} /></button>
                      <button onClick={() => remove(s)} className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {paged.slice.length === 0 && <tr><td colSpan={5} className="px-5 py-10"><EmptyState Icon={Users} title="No students" msg="Add a student to start building your registers." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />

      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit student" : "Add student"}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className={inputCls} /></Field>
            <Field label="Last name"><input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className={inputCls} /></Field>
          </div>
          <Field label="Student number"><input value={form.studentRef} onChange={e => setForm(f => ({ ...f, studentRef: e.target.value }))} placeholder="e.g. 100121" className={inputCls} /></Field>
          <Field label="Email address"><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder={emailPreview || "100121@londonbrookescollege.co.uk"} className={inputCls} /></Field>
          {!form.email && emailPreview && <p className="-mt-1 text-[11px] text-slate-400">Leave blank to use <span className="font-semibold">{emailPreview}</span></p>}
          <Field label="Cohort (intake)">
            <select value={form.cohortId} onChange={e => setForm(f => ({ ...f, cohortId: e.target.value }))} className={inputCls}>
              <option value="">— none —</option>
              {store.cohorts.map(c => { const p = store.programmes.find(x => x.id === c.programmeId); return <option key={c.id} value={c.id}>{p ? `${p.name} — ${c.name}` : c.name}</option>; })}
            </select>
          </Field>
          <Field label="Modules">
            <div className="grid grid-cols-2 gap-1.5">
              {store.modules.map(m => (
                <button key={m.id} onClick={() => toggleModule(m.id)} type="button"
                  className={`press flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold ring-1 transition ${form.moduleIds.includes(m.id) ? "text-white ring-transparent" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
                  style={form.moduleIds.includes(m.id) ? { background: NAVY } : {}}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded border-2 ${form.moduleIds.includes(m.id) ? "border-white bg-white/20" : "border-slate-300"}`}>
                    {form.moduleIds.includes(m.id) && <Check size={10} className="text-white" />}
                  </span>
                  {m.code}
                </button>
              ))}
              {store.modules.length === 0 && <p className="col-span-2 text-xs text-slate-400">No modules yet — add one on the Modules tab.</p>}
            </div>
          </Field>
          <PrimaryBtn onClick={save} disabled={!form.firstName.trim() || !form.lastName.trim() || !form.studentRef.trim()} className="w-full">
            <Save size={16} /> {edit ? "Save changes" : "Add student"}
          </PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ============================================================
   Dashboard: Students — a full directory of every HND student
   with all their details and complete CRUD. Its own top-level
   admin tab (the Registers section keeps a lighter copy).
   ============================================================ */
function AdminStudents({ store }) {
  const { refreshHnd, hndLoaded } = store;
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", studentRef: "", email: "", active: true, cohortId: "", moduleIds: [] });
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");     // "" = any module
  const [statusFilter, setStatusFilter] = useState("all");  // all | active | inactive
  const [attnFor, setAttnFor] = useState(null);             // student whose breakdown is open

  // The Students tab can be opened without visiting Registers first, so pull the
  // HND collections in on mount (refreshHnd is a no-op cost if already loaded).
  useEffect(() => { refreshHnd(); }, [refreshHnd]);

  // Each student's overall attendance %, plus the full per-module row, from the
  // same scoped figures the registers page shows.
  const attnRowById = Object.fromEntries((store.attendance?.rows || []).map(r => [r.student.id, r]));
  const moduleById = Object.fromEntries(store.modules.map(m => [m.id, m]));

  // Each student's overall % counts only their CURRENT, still-enrolled modules. A module
  // finishes once its last session (endDate) has passed, so the figure rolls over
  // automatically. We iterate the student's ENROLMENTS (s.moduleIds) — not every module
  // in row.modules — so leftover marks from modules the student was un-enrolled from
  // don't count. This matches the per-student breakdown modal exactly.
  const attnToday = todayISO();
  const moduleEndById = {};
  (store.sessions || []).forEach(se => { const cur = moduleEndById[se.moduleId]; if (!cur || se.date > cur) moduleEndById[se.moduleId] = se.date; });
  const isCurrentModule = (mid) => { const end = moduleEndById[mid]; return !end || end >= attnToday; };
  const currentPctOf = (s) => {
    const row = attnRowById[s.id];
    if (!row) return null;
    let earned = 0, possible = 0;
    (s.moduleIds || []).forEach(mid => { if (isCurrentModule(mid)) { const st = row.modules[mid]; if (st) { earned += st.earned || 0; possible += st.possible || 0; } } });
    return possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
  };

  const openAdd = () => { setEdit(null); setForm({ firstName: "", lastName: "", studentRef: "", email: "", active: true, cohortId: "", moduleIds: [] }); setModal(true); };
  const openEdit = (s) => { setEdit(s); setForm({ firstName: s.firstName, lastName: s.lastName, studentRef: s.studentRef, email: s.email, active: s.active !== false, cohortId: s.cohortId || "", moduleIds: s.moduleIds || [] }); setModal(true); };
  const toggleModule = (id) => setForm(f => ({ ...f, moduleIds: f.moduleIds.includes(id) ? f.moduleIds.filter(x => x !== id) : [...f.moduleIds, id] }));
  const save = async () => {
    try {
      if (edit) {
        await store.updateStudent(edit.id, { firstName: form.firstName, lastName: form.lastName, studentRef: form.studentRef, email: form.email, active: form.active, cohortId: form.cohortId || null });
        await store.setEnrolments(edit.id, form.moduleIds);
      } else {
        await store.addStudent({ firstName: form.firstName, lastName: form.lastName, studentRef: form.studentRef, email: form.email, cohortId: form.cohortId || null, moduleIds: form.moduleIds });
      }
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
  };
  const remove = async (s) => {
    if (!window.confirm(`Remove ${s.name}?\n\nTheir enrolments and all their attendance marks will be deleted too. This cannot be undone.`)) return;
    await store.removeStudent(s.id);
  };

  const ql = query.trim().toLowerCase();
  const filtered = store.students.filter(s => {
    if (statusFilter === "active" && s.active === false) return false;
    if (statusFilter === "inactive" && s.active !== false) return false;
    if (moduleFilter && !(s.moduleIds || []).includes(moduleFilter)) return false;
    return !ql || s.name.toLowerCase().includes(ql) || s.email.toLowerCase().includes(ql) || s.studentRef.includes(ql);
  });
  const paged = usePaged(filtered, 12, `${ql}|${moduleFilter}|${statusFilter}`);
  const emailPreview = form.email || (form.studentRef ? `${form.studentRef}@londonbrookescollege.co.uk` : "");

  // Headline figures.
  const total = store.students.length;
  const activeCount = store.students.filter(s => s.active !== false).length;
  const enrolledCount = store.students.filter(s => (s.moduleIds || []).length > 0).length;
  const pcts = store.students.map(s => currentPctOf(s)).filter(v => v !== null && v !== undefined);
  const avgAtt = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null;

  const exportStudents = () => {
    downloadCSV(
      "students.csv",
      [
        { key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" },
        { key: "studentRef", label: "Student number" }, { key: "email", label: "Email" },
        { key: "status", label: "Status" }, { key: "modules", label: "Modules" }, { key: "attendance", label: "Overall attendance" },
      ],
      filtered.map(s => ({
        firstName: s.firstName, lastName: s.lastName, studentRef: s.studentRef, email: s.email,
        status: s.active === false ? "Inactive" : "Active",
        modules: (s.moduleIds || []).map(id => moduleById[id]?.code).filter(Boolean).join(" "),
        attendance: currentPctOf(s) == null ? "" : `${currentPctOf(s)}%`,
      })),
    );
    store.notify?.("Exported students CSV");
  };

  if (!hndLoaded) {
    return (
      <>
        <AdminHeader title="Students" subtitle="Loading the student directory…" Icon={GraduationCap} />
        <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
      </>
    );
  }

  return (
    <>
      <AdminHeader
        title="Students"
        subtitle="Every HND student on record — full details and management"
        Icon={GraduationCap}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExportBtn onClick={exportStudents} label="Export" />
            <PrimaryBtn onClick={openAdd}><UserPlus size={16} /> Add student</PrimaryBtn>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total students" value={total} sub="on the HND programme" Icon={Users} tone={NAVY} delay={0} animate />
        <StatCard label="Active" value={activeCount} sub={`${total - activeCount} inactive`} Icon={UserCheck} tone="#0d7a5f" delay={60} animate />
        <StatCard label="On a course" value={enrolledCount} sub="enrolled on ≥1 module" Icon={BookOpen} tone="#6d28d9" delay={120} animate />
        <StatCard label="Avg attendance" value={fmtPct(avgAtt)} sub="across all students" Icon={Percent} tone={pctTone(avgAtt).colour} delay={180} animate />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <Search size={15} className="text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, number or email…" className="w-48 bg-transparent text-sm outline-none sm:w-64" />
        </div>
        <div className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
          {[{ k: "all", l: "All" }, { k: "active", l: "Active" }, { k: "inactive", l: "Inactive" }].map(f => (
            <button key={f.k} onClick={() => setStatusFilter(f.k)} className={`press rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${statusFilter === f.k ? "text-white" : "text-slate-500 hover:bg-slate-100"}`} style={statusFilter === f.k ? { background: NAVY } : {}}>{f.l}</button>
          ))}
        </div>
        {store.modules.length > 0 && (
          <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 outline-none">
            <option value="">All modules</option>
            {store.modules.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
          </select>
        )}
        <span className="ml-auto text-xs font-semibold text-slate-400">{filtered.length} of {total}</span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr><th className="px-5 py-3">Student</th><th className="px-5 py-3">Email address</th><th className="px-5 py-3 whitespace-nowrap">Status</th><th className="px-5 py-3">Modules</th><th className="px-5 py-3 text-center whitespace-nowrap">Attendance</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {paged.slice.map(s => {
                const pct = currentPctOf(s);
                const tone = pctTone(pct ?? null);
                return (
                  <tr key={s.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: s.colour }}>{s.initials}</span>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-700">{s.name}</p>
                          <p className="text-[11px] tabular-nums text-slate-400">{s.studentRef}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-500"><span className="block max-w-[220px] truncate" title={s.email}>{s.email}</span></td>
                    <td className="px-5 py-3">
                      {s.active === false
                        ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">Inactive</span>
                        : <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Active</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex max-w-[200px] flex-wrap gap-1">
                        {(s.moduleIds || []).map(id => { const m = moduleById[id]; return m ? <span key={id} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600" title={m.name}>{m.code}</span> : null; })}
                        {(s.moduleIds || []).length === 0 && <span className="text-[11px] text-slate-300">none</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => setAttnFor(s)} title="View attendance breakdown" className={`press rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums transition hover:ring-2 hover:ring-inset hover:ring-slate-300 ${tone.bg} ${tone.text}`}>{fmtPct(pct ?? null)}</button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <button onClick={() => setAttnFor(s)} title="Attendance breakdown" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"><BarChart3 size={15} /></button>
                        <button onClick={() => openEdit(s)} title="Edit student" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Edit3 size={15} /></button>
                        <button onClick={() => remove(s)} title="Delete student" className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paged.slice.length === 0 && <tr><td colSpan={6} className="px-5 py-10"><EmptyState Icon={Users} title={total === 0 ? "No students yet" : "No students match"} msg={total === 0 ? "Add your first student to start building registers." : "Try a different search or filter."} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />

      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit student" : "Add student"} width={520}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name"><input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className={inputCls} /></Field>
            <Field label="Last name"><input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className={inputCls} /></Field>
          </div>
          <Field label="Student number"><input value={form.studentRef} onChange={e => setForm(f => ({ ...f, studentRef: e.target.value }))} placeholder="e.g. 100121" className={inputCls} /></Field>
          <Field label="Email address"><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder={emailPreview || "100121@londonbrookescollege.co.uk"} className={inputCls} /></Field>
          {!form.email && emailPreview && <p className="-mt-1 text-[11px] text-slate-400">Leave blank to use <span className="font-semibold">{emailPreview}</span></p>}
          <Field label="Cohort (intake)">
            <select value={form.cohortId} onChange={e => setForm(f => ({ ...f, cohortId: e.target.value }))} className={inputCls}>
              <option value="">— none —</option>
              {store.cohorts.map(c => { const p = store.programmes.find(x => x.id === c.programmeId); return <option key={c.id} value={c.id}>{p ? `${p.name} — ${c.name}` : c.name}</option>; })}
            </select>
          </Field>
          {edit && (
            <Field label="Status">
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {[{ v: true, l: "Active" }, { v: false, l: "Inactive" }].map(o => (
                  <button key={String(o.v)} type="button" onClick={() => setForm(f => ({ ...f, active: o.v }))} className={`press flex-1 rounded-lg py-2 text-xs font-bold transition ${form.active === o.v ? "bg-white text-slate-700 shadow-sm" : "text-slate-400"}`}>{o.l}</button>
                ))}
              </div>
            </Field>
          )}
          <Field label={`Modules${form.moduleIds.length ? ` · ${form.moduleIds.length} selected` : ""}`}>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {store.modules.map(m => (
                <button key={m.id} onClick={() => toggleModule(m.id)} type="button"
                  className={`press flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold ring-1 transition ${form.moduleIds.includes(m.id) ? "text-white ring-transparent" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
                  style={form.moduleIds.includes(m.id) ? { background: NAVY } : {}} title={m.name}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded border-2 ${form.moduleIds.includes(m.id) ? "border-white bg-white/20" : "border-slate-300"}`}>
                    {form.moduleIds.includes(m.id) && <Check size={10} className="text-white" />}
                  </span>
                  {m.code}
                </button>
              ))}
              {store.modules.length === 0 && <p className="col-span-2 text-xs text-slate-400 sm:col-span-3">No courses yet — add one on the Courses tab.</p>}
            </div>
          </Field>
          <PrimaryBtn onClick={save} disabled={!form.firstName.trim() || !form.lastName.trim() || !form.studentRef.trim()} className="w-full">
            <Save size={16} /> {edit ? "Save changes" : "Add student"}
          </PrimaryBtn>
        </div>
      </Modal>

      <Modal open={!!attnFor} onClose={() => setAttnFor(null)} title="Attendance breakdown" width={560}>
        {attnFor && <StudentAttendanceDetail student={attnFor} store={store} />}
      </Modal>
    </>
  );
}

// One student's attendance, broken down per module and overall. Reads the same
// scoped figures as the registers page (row comes from store.attendance.rows).
// Per-student attendance grouped BY TERM: the current (active) term's overall +
// modules, then each previous term as its own collapsible record. The overall is
// scoped to the current term only, so it resets each term.
function StudentAttendanceDetail({ student, store }) {
  const R = 42, CIRC = 2 * Math.PI * R;

  // Computed entirely from data the Students tab already loads — no extra request,
  // so it works instantly and doesn't depend on the API being redeployed. A module's
  // end date is its last session (store.sessions); once that date passes the module is
  // "finished" and drops into "previous", and the overall counts only current modules.
  const today = todayISO();
  const row = (store.attendance?.rows || []).find(r => r.student.id === student.id) || null;
  const moduleById = Object.fromEntries((store.modules || []).map(m => [m.id, m]));
  const endByModule = {};
  (store.sessions || []).forEach(se => { const cur = endByModule[se.moduleId]; if (!cur || se.date > cur) endByModule[se.moduleId] = se.date; });
  const emptyStats = { P: 0, L: 0, E: 0, A: 0, marked: 0, earned: 0, possible: 0, pct: null };
  const moduleRows = (student.moduleIds || []).map(mid => {
    const mod = moduleById[mid] || { id: mid, code: "?", name: "Unknown module" };
    const endDate = endByModule[mid] || null;
    return { module: { id: mod.id, code: mod.code, name: mod.name }, summary: row?.modules?.[mid] || emptyStats, endDate, finished: !!(endDate && endDate < today) };
  });
  const currentModules = moduleRows.filter(r => !r.finished).sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999"));
  const previous = moduleRows.filter(r => r.finished).sort((a, b) => (b.endDate || "").localeCompare(a.endDate || ""));
  const overall = aggregateStats(currentModules.map(r => r.summary));
  const current = { modules: currentModules, overall };

  const header = (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm" style={{ background: student.colour }}>{student.initials}</span>
      <div className="min-w-0">
        <p className="truncate text-base font-extrabold" style={{ color: NAVY_DARK }}>{student.name}</p>
        <p className="truncate text-xs text-slate-400">{student.studentRef} · {student.email}</p>
      </div>
    </div>
  );

  const fmtDate = (iso) => { if (!iso) return null; const [y, m, d] = iso.split("-"); const mm = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] || m; return `${Number(d)} ${mm} ${y}`; };

  const ModuleRow = ({ mod, stats, i, end, ended }) => {
    const t = pctTone(stats.pct ?? null);
    return (
      <div className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? "border-t border-slate-100" : ""}`}>
        <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}>{mod.code.slice(0, 5)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-slate-700" title={mod.name}>{mod.name}</p>
          {end
            ? <p className="mt-0.5 text-[10px] font-medium text-slate-400">{ended ? "Ended" : "Ends"} {fmtDate(end)}</p>
            : <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${stats.pct ?? 0}%`, background: t.colour }} /></div>}
        </div>
        <div className="shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
          <span style={{ color: ATT_STATUSES[0].colour }}>P{stats.P}</span> <span style={{ color: ATT_STATUSES[1].colour }}>L{stats.L}</span> <span style={{ color: ATT_STATUSES[2].colour }}>E{stats.E}</span> <span style={{ color: ATT_STATUSES[3].colour }}>A{stats.A}</span>
          <span className="ml-1 text-slate-300">· {stats.marked} marked</span>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${t.bg} ${t.text}`}>{fmtPct(stats.pct ?? null)}</span>
      </div>
    );
  };

  if (!store.attendance) return <div className="space-y-4">{header}<div className="skeleton h-48 rounded-2xl" /></div>;

  const oTone = pctTone(current.overall.pct ?? null);

  return (
    <div className="space-y-4">
      {header}

      {/* Current modules — the live overall that rolls over as modules finish */}
      <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-emerald-200">
        <div className="mb-3 flex items-center gap-2">
          <p className="text-sm font-extrabold text-slate-800">Current modules</p>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{current.modules.length} running</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle cx="60" cy="60" r={R} fill="none" stroke="#e2e8f0" strokeWidth="12" />
              <circle cx="60" cy="60" r={R} fill="none" stroke={oTone.colour} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${CIRC}`} strokeDashoffset={`${CIRC * (1 - (current.overall.pct ?? 0) / 100)}`} style={{ transition: "stroke-dashoffset 1s ease" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-extrabold tabular-nums" style={{ color: oTone.colour }}>{fmtPct(current.overall.pct ?? null)}</span>
              <span className="text-[10px] font-medium text-slate-400">overall</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-4 gap-1.5 text-center">
              {ATT_STATUSES.map(s => (
                <div key={s.key} className="rounded-lg py-1.5" style={{ background: s.colour + "12" }}>
                  <p className="text-sm font-extrabold tabular-nums" style={{ color: s.colour }}>{current.overall[s.key] ?? 0}</p>
                  <p className="text-[9px] font-medium text-slate-400">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{current.overall.marked ?? 0} session{(current.overall.marked ?? 0) === 1 ? "" : "s"} marked across current modules</p>
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
          {current.modules.map((mr, i) => <ModuleRow key={mr.module.id} mod={mr.module} stats={mr.summary} i={i} end={mr.endDate} ended={false} />)}
          {current.modules.length === 0 && <div className="px-4 py-6"><EmptyState Icon={Percent} title="No current modules" msg="Every assigned module has finished, or none are assigned yet. Assign modules via Edit student → Modules." /></div>}
        </div>
      </div>

      {/* Previous assigned modules — finished ones, moved here automatically */}
      {previous.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Previous assigned modules · {previous.length}</p>
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
            {previous.map((mr, i) => <ModuleRow key={mr.module.id} mod={mr.module} stats={mr.summary} i={i} end={mr.endDate} ended={true} />)}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">A module moves to “previous” automatically once its last session date has passed. The overall counts only current modules. P = Present (2) · L = Late (1) · E = Excused (1) · A = Absent (0). Only marked sessions count.</p>
    </div>
  );
}

/* ----- Modules ----- */
// A deterministic seed from a string, so a course keeps the same banner colour
// and pattern every time the gallery renders.
const hashStr = (s) => { let h = 0; for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const COURSE_COLOURS = ["#0d7a5f", "#5b6472", "#6d28d9", "#1a3a8f", "#b45309", "#0e7490", "#9e1b32", "#2563eb"];
const courseColour = (seed) => COURSE_COLOURS[seed % COURSE_COLOURS.length];

// The decorative banner on a course card — one of four repeating patterns keyed
// off the course code, tinted with that course's colour. Purely cosmetic.
function CoursePattern({ seed, colour }) {
  const kind = seed % 4;
  const pid = `cp-${seed}-${kind}`;
  const cover = { position: "absolute", inset: 0, width: "100%", height: "100%" };
  let cell;
  if (kind === 0) { // plaid — the green tartan look
    cell = (
      <pattern id={pid} width="46" height="46" patternUnits="userSpaceOnUse">
        <rect width="46" height="46" fill={colour} />
        <rect width="46" height="23" fill="#fff" opacity="0.05" />
        <rect width="23" height="46" fill="#fff" opacity="0.05" />
        <rect x="21" width="4" height="46" fill="#fff" opacity="0.13" />
        <rect y="21" width="46" height="4" fill="#fff" opacity="0.13" />
      </pattern>
    );
  } else if (kind === 1) { // soft mosaic squares
    cell = (
      <pattern id={pid} width="52" height="52" patternUnits="userSpaceOnUse">
        <rect width="52" height="52" fill={colour} />
        {[[0, 0, 0.10], [26, 0, 0.05], [0, 26, 0.06], [26, 26, 0.12], [13, 13, 0.08], [39, 39, 0.05]].map(([x, y, o], k) => (
          <rect key={k} x={x} y={y} width="24" height="24" fill="#fff" opacity={o} />
        ))}
      </pattern>
    );
  } else if (kind === 2) { // overlapping rings
    cell = (
      <pattern id={pid} width="58" height="58" patternUnits="userSpaceOnUse">
        <rect width="58" height="58" fill={colour} />
        {[[29, 29], [0, 0], [58, 0], [0, 58], [58, 58]].map(([cx, cy], k) => (
          <circle key={k} cx={cx} cy={cy} r="20" fill="none" stroke="#fff" strokeWidth="8" opacity="0.13" />
        ))}
      </pattern>
    );
  } else { // triangles
    cell = (
      <pattern id={pid} width="44" height="44" patternUnits="userSpaceOnUse">
        <rect width="44" height="44" fill={colour} />
        <path d="M0 44 L22 0 L44 44 Z" fill="#fff" opacity="0.06" />
        <path d="M-22 44 L0 0 L22 44 Z" fill="#fff" opacity="0.11" />
        <path d="M22 44 L44 0 L66 44 Z" fill="#fff" opacity="0.11" />
      </pattern>
    );
  }
  return (
    <svg style={cover} aria-hidden="true">
      <defs>{cell}</defs>
      <rect width="100%" height="100%" fill={`url(#${pid})`} />
    </svg>
  );
}

// The "⋯" overflow menu on each course card — Edit / Delete, matching the
// three-dot control in the reference design. Closes on outside click.
function CourseMenu({ onEdit, onDelete, onCohorts, editLabel = "Edit course", deleteLabel = "Delete course" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="Course options" aria-haspopup="menu" aria-expanded={open}
        className="press flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-slate-600 shadow-sm ring-1 ring-black/5 transition hover:bg-white">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="pop absolute right-0 top-10 z-40 w-44 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200">
            {onCohorts && (
              <button role="menuitem" onClick={() => { setOpen(false); onCohorts(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                <Layers size={14} /> Manage cohorts
              </button>
            )}
            <button role="menuitem" onClick={() => { setOpen(false); onEdit(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
              <Edit3 size={14} /> {editLabel}
            </button>
            <button role="menuitem" onClick={() => { setOpen(false); onDelete(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-rose-600 transition hover:bg-rose-50">
              <Trash2 size={14} /> {deleteLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ----- Programmes: the top of the hierarchy — HND Business, HND Computing… ----- */
// Swatches offered when creating a programme, so its cards and its courses share
// a colour. Kept in sync with the register palette for a coherent look.
const PROGRAMME_COLOURS = ["#1a3a8f", "#0d7a5f", "#6d28d9", "#b45309", "#0e7490", "#9e1b32", "#2563eb", "#5b6472"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function HndProgrammes({ store, onOpen }) {
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const nowYear = new Date().getFullYear();
  // cohortMonth/cohortYear seed the programme's FIRST intake when adding.
  const [form, setForm] = useState({ name: "", colour: PROGRAMME_COLOURS[0], cohortMonth: 9, cohortYear: nowYear });
  const [cohortProg, setCohortProg] = useState(null); // the programme whose cohorts are being managed
  const YEARS = Array.from({ length: 7 }, (_, i) => nowYear - 2 + i);

  const openAdd = () => { setEdit(null); setForm({ name: "", colour: PROGRAMME_COLOURS[0], cohortMonth: 9, cohortYear: nowYear }); setModal(true); };
  const openEdit = (p) => { setEdit(p); setForm({ name: p.name, colour: p.colour || PROGRAMME_COLOURS[0], cohortMonth: 9, cohortYear: nowYear }); setModal(true); };
  const save = async () => {
    try {
      if (edit) {
        await store.updateProgramme(edit.id, { name: form.name, colour: form.colour });
      } else {
        const prog = await store.addProgramme({ name: form.name, colour: form.colour });
        // Seed the first cohort (intake) from the chosen month + year, e.g. "Sep 2025".
        if (prog?.id) {
          await store.addCohort({ programmeId: prog.id, name: `${MONTHS[form.cohortMonth - 1]} ${form.cohortYear}`, startDate: `${form.cohortYear}-${String(form.cohortMonth).padStart(2, "0")}-01` });
        }
      }
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
  };
  const remove = async (p) => {
    const n = p.moduleCount || 0;
    if (!window.confirm(`Delete the programme "${p.name}"?\n\n${n ? `Its ${n} course${n === 1 ? "" : "s"} will be kept but left unassigned — no sessions or registers are deleted.` : "It has no courses."}`)) return;
    await store.removeProgramme(p.id);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-slate-500">
          A programme groups the courses taught under it — e.g. <span className="font-semibold">HND Business</span>.
          Add your programmes here, then open one to add its courses.
        </p>
        <PrimaryBtn onClick={openAdd}><Plus size={16} /> Add programme</PrimaryBtn>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {store.programmes.map((p, i) => {
          const colour = p.colour || NAVY;
          const seed = hashStr(p.name);
          return (
            <div key={p.id} className="fade-up flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300/80" style={{ animationDelay: `${i * 45}ms` }}>
              <div className="relative h-24">
                <CoursePattern seed={seed} colour={colour} />
                <div className="absolute right-3 top-3"><CourseMenu onEdit={() => openEdit(p)} onDelete={() => remove(p)} onCohorts={() => setCohortProg(p)} editLabel="Edit programme" deleteLabel="Delete programme" /></div>
                <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-white/95 px-2.5 py-1 text-xs font-extrabold text-slate-800 shadow-sm"><Layers size={12} /> Programme</span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="text-base font-extrabold leading-snug" style={{ color: NAVY_DARK }}>{p.name}</h3>
                <p className="mt-1 text-xs font-semibold text-slate-400">{p.moduleCount || 0} course{(p.moduleCount || 0) === 1 ? "" : "s"}</p>
                {(() => {
                  const cs = (store.cohorts || []).filter(c => c.programmeId === p.id);
                  return cs.length > 0
                    ? <div className="mt-1.5 flex flex-wrap gap-1">{cs.map(c => <span key={c.id} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-indigo-100">{c.name}</span>)}</div>
                    : <p className="mt-1 text-[11px] font-semibold text-slate-300">No cohorts yet</p>;
                })()}
                <div className="mt-4 flex gap-2">
                  <button onClick={() => onOpen(p.id)} className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-slate-200 py-2.5 text-sm font-bold transition hover:border-indigo-300 hover:bg-indigo-50" style={{ color: NAVY }}>
                    View courses <ArrowRight size={15} />
                  </button>
                  <button onClick={() => setCohortProg(p)} title="Manage cohorts" className="press flex shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-500 transition hover:border-indigo-300 hover:bg-indigo-50">
                    <Layers size={15} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {store.programmes.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Card><EmptyState Icon={Layers} title="No programmes yet" msg="Add your first programme — e.g. HND Business — then add its courses." /></Card>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit programme" : "Add programme"}>
        <div className="space-y-3">
          <Field label="Programme name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. HND Business" className={inputCls} /></Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {PROGRAMME_COLOURS.map(c => (
                <button key={c} type="button" onClick={() => setForm(f => ({ ...f, colour: c }))} aria-label={`Colour ${c}`}
                  className={`h-8 w-8 rounded-lg transition ${form.colour === c ? "ring-2 ring-offset-2 ring-slate-400" : "ring-1 ring-black/5"}`} style={{ background: c }} />
              ))}
            </div>
          </Field>
          {!edit && (
            <Field label="First cohort (intake)">
              <div className="grid grid-cols-2 gap-2">
                <select value={form.cohortMonth} onChange={e => setForm(f => ({ ...f, cohortMonth: Number(e.target.value) }))} className={inputCls}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select value={form.cohortYear} onChange={e => setForm(f => ({ ...f, cohortYear: Number(e.target.value) }))} className={inputCls}>
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Creates the first intake — <b>{MONTHS[form.cohortMonth - 1]} {form.cohortYear}</b>. You can add more later via Manage cohorts.</p>
            </Field>
          )}
          <PrimaryBtn onClick={save} disabled={!form.name.trim()} className="w-full"><Save size={16} /> {edit ? "Save changes" : "Add programme"}</PrimaryBtn>
        </div>
      </Modal>

      {cohortProg && <CohortManager store={store} programme={cohortProg} onClose={() => setCohortProg(null)} />}
    </>
  );
}

/* ----- Cohorts & terms: intakes (e.g. "SEP 2025") under one programme ----- */
function CohortManager({ store, programme, onClose }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [termCohort, setTermCohort] = useState(null); // cohort whose terms are being edited
  const list = (store.cohorts || []).filter(c => c.programmeId === programme.id);
  const termsOf = (cid) => (store.terms || []).filter(t => t.cohortId === cid).sort((a, b) => a.year - b.year || a.index - b.index);
  const today = todayISO();
  const isActiveTerm = (t) => today >= t.start && today <= t.end;

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await store.addCohort({ programmeId: programme.id, name: name.trim(), startDate: start || null }); setName(""); setStart(""); }
    catch (_) { /* store toasts the error (e.g. duplicate name) */ }
    finally { setBusy(false); }
  };
  const remove = async (c) => { if (window.confirm(`Delete cohort "${c.name}"? Its terms are removed too.`)) await store.removeCohort(c.id); };
  const genTerms = async (c) => {
    if (!c.startDate) { store.notify?.("Set this cohort's start date first (it dates the terms).", "error"); return; }
    setBusy(true);
    try { await store.generateTerms(c.id, {}); } catch (_) {} finally { setBusy(false); }
  };
  const setTermDate = async (t, field, value) => { if (value) { try { await store.updateTerm(t.id, { [field]: value }); } catch (_) {} } };
  const delTerm = async (t) => { if (window.confirm(`Delete ${t.name}?`)) await store.removeTerm(t.id); };

  // ---- Term editor for one cohort ----
  if (termCohort) {
    const ts = termsOf(termCohort.id);
    return (
      <Modal open onClose={onClose} title={`Terms — ${termCohort.name}`}>
        <div className="space-y-3">
          <button onClick={() => setTermCohort(null)} className="flex items-center gap-1 text-xs font-bold text-slate-500 transition hover:text-slate-700"><ChevronLeft size={14} /> Back to cohorts</button>
          <p className="text-[11px] text-slate-500">An HND runs <b>6 terms</b> — Year 1 &amp; Year 2, three each. The term whose dates contain today is the <b>current</b> one; that's what will open attendance later.</p>
          {ts.length === 0 && (
            <div className="rounded-xl bg-slate-50 p-4 text-center ring-1 ring-slate-100">
              <p className="text-sm text-slate-500">No terms set up yet.</p>
              {!termCohort.startDate && <p className="mt-1 text-[11px] font-semibold text-amber-600">Set this cohort's start date first so the terms get dated automatically.</p>}
              <PrimaryBtn onClick={() => genTerms(termCohort)} disabled={busy || !termCohort.startDate} className="mt-3"><Plus size={16} /> Generate 6 terms</PrimaryBtn>
            </div>
          )}
          {ts.map(t => (
            <div key={t.id} className={`rounded-xl p-3 ring-1 ${isActiveTerm(t) ? "bg-emerald-50/60 ring-emerald-200" : "bg-white ring-slate-200"}`}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">{t.name}{isActiveTerm(t) && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Current</span>}</p>
                <button onClick={() => delTerm(t)} title="Delete term" className="rounded p-1 text-slate-300 transition hover:text-rose-500"><Trash2 size={14} /></button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="From"><input type="date" value={t.start} onChange={e => setTermDate(t, "start", e.target.value)} className={inputCls} /></Field>
                <Field label="To"><input type="date" value={t.end} min={t.start} onChange={e => setTermDate(t, "end", e.target.value)} className={inputCls} /></Field>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  // ---- Cohort list ----
  return (
    <Modal open onClose={onClose} title={`Cohorts — ${programme.name}`}>
      <div className="space-y-3">
        <p className="text-[11px] text-slate-500">An intake of students on this programme — e.g. <b>SEP 2025</b>, <b>Jan 2024</b>. Each cohort runs its own 6 terms.</p>

        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Cohort name, e.g. SEP 2025" className={inputCls} onKeyDown={e => { if (e.key === "Enter") add(); }} />
            <input type="date" value={start} onChange={e => setStart(e.target.value)} title="Start date" className={inputCls} />
          </div>
          <PrimaryBtn onClick={add} disabled={busy || !name.trim()} className="mt-2 w-full"><Plus size={16} /> {busy ? "Adding…" : "Add cohort"}</PrimaryBtn>
        </div>

        <div className="space-y-2">
          {list.length === 0 && <EmptyState Icon={Layers} title="No cohorts yet" msg="Add your first intake above." />}
          {list.map(c => {
            const n = termsOf(c.id).length;
            return (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-700">{c.name}</p>
                  <p className="text-[11px] text-slate-400">{c.startDate ? `Starts ${fmtDate(c.startDate)}` : "No start date"} · {n} term{n === 1 ? "" : "s"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => setTermCohort(c)} className="press flex items-center gap-1 rounded-lg border-2 border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50"><CalendarDays size={13} /> Terms</button>
                  <button onClick={() => remove(c)} title="Delete cohort" className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/* ----- Courses: the module gallery, add / edit / delete + open registers ----- */
function HndModules({ store, onView, programmeFilter = "", setProgrammeFilter }) {
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState("details");       // details -> schedule (new courses only)
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ code: "", name: "", tutor: "", programmeId: "", cohortId: "", termId: "" });
  const [picked, setPicked] = useState([]);           // studentIds enrolled on this course
  const [pickQuery, setPickQuery] = useState("");     // search within the student picker
  const [sched, setSched] = useState({ start: todayISO(), end: "", hours: 3 });
  const [savedId, setSavedId] = useState(null);       // id of the course just created, for the schedule step
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const programmeById = Object.fromEntries(store.programmes.map(p => [p.id, p]));
  const hasUnassigned = store.modules.some(m => !m.programmeId);

  // New courses default into the programme currently being filtered, so opening a
  // programme and hitting "Add course" files it in the right place automatically.
  const defaultProgramme = programmeFilter && programmeFilter !== "none" ? programmeFilter : "";
  const enrolledIds = (moduleId) => store.students.filter(s => (s.moduleIds || []).includes(moduleId)).map(s => s.id);
  const openAdd = () => {
    setEdit(null); setStep("details"); setSavedId(null); setPicked([]); setPickQuery("");
    setForm({ code: "", name: "", tutor: "", programmeId: defaultProgramme, cohortId: "", termId: "" });
    setSched({ start: todayISO(), end: "", hours: 3 });
    setModal(true);
  };
  const openEdit = (m) => {
    setEdit(m); setStep("details"); setSavedId(m.id); setPicked(enrolledIds(m.id)); setPickQuery("");
    setForm({ code: m.code, name: m.name, tutor: m.tutor || "", programmeId: m.programmeId || "", cohortId: m.cohortId || "", termId: m.termId || "" });
    setModal(true);
  };
  const togglePick = (id) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  // Step 1 — save the course details and its enrolled students. Editing stops
  // here; creating a new course advances to the weekly-schedule step.
  const saveDetails = async () => {
    setBusy(true);
    try {
      if (edit) {
        await store.updateModule(edit.id, form);
        await store.setModuleEnrolments(edit.id, picked);
        setModal(false);
      } else {
        const created = await store.addModule(form);
        if (picked.length) await store.setModuleEnrolments(created.id, picked);
        setSavedId(created.id);
        setStep("schedule");
      }
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
    setBusy(false);
  };

  // Step 2 — turn the term start/end into one register per week.
  const createWeekly = async () => {
    setBusy(true);
    try {
      await store.generateSessions(savedId, sched);
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
    setBusy(false);
  };

  const remove = async (m) => {
    if (!window.confirm(`Delete ${m.code} — ${m.name}?\n\nIts ${m.sessionCount} session${m.sessionCount === 1 ? "" : "s"} and all their attendance marks will be deleted. This cannot be undone.`)) return;
    await store.removeModule(m.id);
  };

  const ql = query.trim().toLowerCase();
  const list = store.modules.filter(m => {
    if (programmeFilter === "none" && m.programmeId) return false;
    if (programmeFilter && programmeFilter !== "none" && m.programmeId !== programmeFilter) return false;
    return !ql || m.code.toLowerCase().includes(ql) || m.name.toLowerCase().includes(ql) || (m.tutor || "").toLowerCase().includes(ql);
  });

  // The programme filter pills: All, each programme, then "No programme" if needed.
  const chips = [{ id: "", label: "All programmes" },
    ...store.programmes.map(p => ({ id: p.id, label: p.name, colour: p.colour })),
    ...(hasUnassigned ? [{ id: "none", label: "No programme" }] : [])];

  return (
    <>
      {chips.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chips.map(c => {
            const active = programmeFilter === c.id;
            return (
              <button key={c.id || "all"} onClick={() => setProgrammeFilter?.(c.id)}
                className={`press flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-sm ring-1 transition-all ${active ? "text-white ring-transparent" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"}`}
                style={active ? { background: c.colour || NAVY } : {}}>
                {c.colour && !active && <span className="h-2 w-2 rounded-full" style={{ background: c.colour }} />}
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <Search size={15} className="text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search courses…" className="w-40 bg-transparent text-sm outline-none sm:w-56" />
        </div>
        <PrimaryBtn onClick={openAdd}><Plus size={16} /> Add course</PrimaryBtn>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {list.map((m, i) => {
          const seed = hashStr(m.code);
          const prog = m.programmeId ? programmeById[m.programmeId] : null;
          // A course wears its programme's colour, so the gallery reads as groups.
          const colour = prog?.colour || courseColour(seed);
          const totals = store.attendance?.moduleTotals?.[m.id];
          const pct = totals?.pct ?? null;
          // Session count follows the semester picker; enrolment isn't dated, so
          // the student count is the module's all-time total.
          const sessionCount = totals?.sessionCount ?? m.sessionCount;
          const tone = pctTone(pct);
          // Cohort/term this unit runs in, and whether that term is current (open),
          // ended (paused) or upcoming — the visible side of the pause/activate.
          const uTerm = m.termId ? (store.terms || []).find(t => t.id === m.termId) : null;
          const uCohort = m.cohortId ? (store.cohorts || []).find(c => c.id === m.cohortId) : null;
          const uToday = todayISO();
          const uState = !uTerm ? null : (uToday >= uTerm.start && uToday <= uTerm.end) ? "current" : (uToday > uTerm.end ? "past" : "future");
          return (
            <div key={m.id} className="fade-up group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-slate-300/80" style={{ animationDelay: `${i * 45}ms` }}>
              {/* Patterned banner with the course code as a cohort-style badge */}
              <div className="relative h-32">
                <CoursePattern seed={seed} colour={colour} />
                <div className="absolute right-3 top-3"><CourseMenu onEdit={() => openEdit(m)} onDelete={() => remove(m)} /></div>
                <span className="absolute bottom-3 left-3 rounded-md bg-white/95 px-2.5 py-1 text-xs font-extrabold text-slate-800 shadow-sm">{m.code}</span>
              </div>

              <div className="flex flex-1 flex-col p-4">
                {prog
                  ? <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: prog.colour }}><Layers size={11} /> {prog.name}</p>
                  : <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-300">No programme</p>}
                {(uCohort || uTerm) && (
                  <p className="mb-1 flex flex-wrap items-center gap-1 text-[10px] font-bold">
                    {uCohort && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{uCohort.name}</span>}
                    {uTerm && <span className={`rounded px-1.5 py-0.5 ${uState === "current" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{uTerm.name.replace("Year ", "Y").replace(" · Term ", "T")}{uState === "current" ? " · Current" : uState === "past" ? " · Ended" : " · Upcoming"}</span>}
                  </p>
                )}
                <h3 className="text-[15px] font-extrabold leading-snug" style={{ color: NAVY_DARK }} title={m.name}>{m.name}</h3>

                {/* Attendance figures kept — this is a register system, after all */}
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-sm font-extrabold text-slate-700 tabular-nums">{m.studentCount}</p><p className="text-[9px] uppercase tracking-wide text-slate-400">Students</p></div>
                  <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-sm font-extrabold text-slate-700 tabular-nums">{sessionCount}</p><p className="text-[9px] uppercase tracking-wide text-slate-400">Sessions</p></div>
                  <div className={`rounded-lg py-1.5 ${tone.bg}`}><p className={`text-sm font-extrabold tabular-nums ${tone.text}`}>{fmtPct(pct)}</p><p className="text-[9px] uppercase tracking-wide text-slate-400">Attend.</p></div>
                </div>

                <button onClick={() => onView(m.id)} className="press mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-slate-200 py-2.5 text-sm font-bold transition hover:border-indigo-300 hover:bg-indigo-50" style={{ color: NAVY }}>
                  View course <ArrowRight size={15} />
                </button>
              </div>
            </div>
          );
        })}
        {store.modules.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
            <Card><EmptyState Icon={BookOpen} title="No courses yet" msg="Add your first HND course to start timetabling sessions and taking registers." /></Card>
          </div>
        )}
        {store.modules.length > 0 && list.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4">
            <Card><EmptyState Icon={Search} title="No matching courses" msg={query ? `Nothing matches "${query}".` : "No courses in this programme yet — use “Add course” to create one."} /></Card>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={step === "schedule" ? "Weekly registers" : edit ? "Edit course" : "Add course"} width={520}>
        {step === "details" ? (
          <div className="space-y-3">
            <Field label="Programme">
              <select value={form.programmeId} onChange={e => setForm(f => ({ ...f, programmeId: e.target.value, cohortId: "", termId: "" }))} className={inputCls}>
                <option value="">— none —</option>
                {store.programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            {/* Which intake + term this unit runs in. Optional, but needed for the
                term-based attendance pause/activate. Term list follows the cohort. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cohort">
                <select value={form.cohortId} onChange={e => setForm(f => ({ ...f, cohortId: e.target.value, termId: "" }))} disabled={!form.programmeId} className={inputCls}>
                  <option value="">— none —</option>
                  {store.cohorts.filter(c => c.programmeId === form.programmeId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Term">
                <select value={form.termId} onChange={e => setForm(f => ({ ...f, termId: e.target.value }))} disabled={!form.cohortId} className={inputCls}>
                  <option value="">— none —</option>
                  {store.terms.filter(t => t.cohortId === form.cohortId).sort((a, b) => a.year - b.year || a.index - b.index).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Course code"><input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="e.g. OBM" className={inputCls} /></Field>
              <Field label="Tutor"><select value={form.tutor} onChange={e => setForm(f => ({ ...f, tutor: e.target.value }))} className={inputCls}><option value="">— none —</option>{store.staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
            </div>
            <Field label="Course name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Organisational Behaviour Management" className={inputCls} /></Field>

            {/* Enrol students onto this unit, straight from the student list */}
            <Field label={`Students on this course${picked.length ? ` · ${picked.length} selected` : ""}`}>
              <StudentPicker students={store.students} picked={picked} onToggle={togglePick} query={pickQuery} setQuery={setPickQuery}
                onAll={() => setPicked(store.students.map(s => s.id))} onNone={() => setPicked([])} />
            </Field>

            <PrimaryBtn onClick={saveDetails} disabled={busy || !form.code.trim() || !form.name.trim()} className="w-full">
              {busy ? <><Loader size={16} /> Saving…</> : <><Save size={16} /> {edit ? "Save changes" : "Next: schedule registers"}</>}
            </PrimaryBtn>
          </div>
        ) : (
          <ScheduleStep sched={sched} setSched={setSched} busy={busy} onCreate={createWeekly} onSkip={() => setModal(false)} />
        )}
      </Modal>
    </>
  );
}

// Searchable, scrollable checkbox list of students for enrolling onto a course.
function StudentPicker({ students, picked, onToggle, query, setQuery, onAll, onNone }) {
  const ql = (query || "").trim().toLowerCase();
  const shown = students.filter(s => !ql || s.name.toLowerCase().includes(ql) || s.email.toLowerCase().includes(ql) || s.studentRef.includes(ql));
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Search size={14} className="text-slate-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search students…" className="flex-1 bg-transparent text-sm outline-none" />
        <button type="button" onClick={onAll} className="text-[11px] font-bold text-slate-500 hover:text-slate-700">All</button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={onNone} className="text-[11px] font-bold text-slate-500 hover:text-slate-700">None</button>
      </div>
      <div className="max-h-52 overflow-y-auto p-1">
        {shown.map(s => {
          const on = picked.includes(s.id);
          return (
            <button type="button" key={s.id} onClick={() => onToggle(s.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${on ? "bg-blue-50" : "hover:bg-slate-50"}`}>
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition ${on ? "border-transparent" : "border-slate-300"}`} style={on ? { background: NAVY } : {}}>
                {on && <Check size={11} className="text-white" />}
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: s.colour }}>{s.initials}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-700">{s.name}</span>
                <span className="block truncate text-[11px] text-slate-400">{s.studentRef}</span>
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">{students.length === 0 ? "No students yet — add students on the Students tab first." : "No students match your search."}</p>}
      </div>
    </div>
  );
}

// Step 2 of course creation: pick the term's start/end and weekly time, and it
// creates one register per week. Shows a live count of what will be created.
function ScheduleStep({ sched, setSched, busy, onCreate, onSkip }) {
  const perWeek = Math.max(1, Math.round((Number(sched.hours) || 3) / 3)); // 3h → 1, 6h → 2 …
  const valid = sched.start && sched.end && sched.end >= sched.start && Number(sched.hours) >= 3;
  // Count weeks the same way the server does — from the start, every 7 days.
  let weeks = 0;
  if (sched.start && sched.end && sched.end >= sched.start) {
    const cur = new Date(`${sched.start}T00:00:00Z`), last = new Date(`${sched.end}T00:00:00Z`);
    while (cur <= last && weeks < 60) { weeks++; cur.setUTCDate(cur.getUTCDate() + 7); }
  }
  const weekday = sched.start ? new Date(`${sched.start}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long" }) : "";
  const total = weeks * perWeek;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 px-3.5 py-3 text-xs ring-1 ring-emerald-200">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
        <p className="font-semibold text-emerald-800">Course saved. Set its dates and taught hours — one register is created per 3 hours, every week.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date"><input type="date" value={sched.start} onChange={e => setSched(s => ({ ...s, start: e.target.value }))} className={inputCls} /></Field>
        <Field label="End date"><input type="date" value={sched.end} min={sched.start} onChange={e => setSched(s => ({ ...s, end: e.target.value }))} className={inputCls} /></Field>
      </div>
      <Field label="Hours per week">
        <select value={sched.hours} onChange={e => setSched(s => ({ ...s, hours: Number(e.target.value) }))} className={inputCls}>
          <option value={3}>3 hours — 1 register</option>
          <option value={6}>6 hours — 2 registers</option>
          <option value={9}>9 hours — 3 registers</option>
          <option value={12}>12 hours — 4 registers</option>
        </select>
      </Field>
      {sched.start && sched.end && sched.end < sched.start && <p className="text-[11px] font-semibold text-rose-600">The end date must be on or after the start date.</p>}
      {valid && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          <CalendarDays size={15} className="text-slate-400" />
          Creates <span className="font-extrabold" style={{ color: NAVY }}>{total}</span> register{total === 1 ? "" : "s"} — <b>{weeks}</b> {weekday} week{weeks === 1 ? "" : "s"} × <b>{perWeek}</b> per week.
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={onSkip} disabled={busy} className="press flex-1 rounded-xl border-2 border-slate-200 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-40">Skip for now</button>
        <PrimaryBtn onClick={onCreate} disabled={busy || !valid} colour="#0d7a5f" className="flex-1">
          {busy ? <><Loader size={16} /> Creating…</> : <><CalendarCheck size={16} /> Create {valid ? total : ""} register{total === 1 ? "" : "s"}</>}
        </PrimaryBtn>
      </div>
    </div>
  );
}

/* ----- Semesters (teaching periods) ----- */
function HndSemesters({ store }) {
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ name: "", start: "", end: "" });

  const openAdd = () => { setEdit(null); setForm({ name: "", start: "", end: "" }); setModal(true); };
  const openEdit = (s) => { setEdit(s); setForm({ name: s.name, start: s.start, end: s.end }); setModal(true); };
  // On failure the store has already toasted the reason (e.g. overlapping dates),
  // so swallow the rejection and leave the modal open for another go.
  const save = async () => {
    try {
      if (edit) await store.updateSemester(edit.id, form);
      else await store.addSemester(form);
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
  };
  const remove = async (s) => {
    if (!window.confirm(`Remove "${s.name}"? Sessions and registers are not deleted — they just stop being grouped under this semester.`)) return;
    // If the semester being deleted is the one in view, fall back to All.
    if (store.semesterId === s.id) store.setSemesterId("");
    await store.removeSemester(s.id);
  };

  const invalid = !form.name.trim() || !form.start || !form.end || form.end < form.start;
  const today = todayISO();

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-slate-500">
          A semester is just a date range. Any session dated inside it counts toward that semester automatically —
          there's nothing to tag by hand. Ranges can't overlap, so every session belongs to exactly one semester.
        </p>
        <PrimaryBtn onClick={openAdd}><Plus size={16} /> Add semester</PrimaryBtn>
      </div>

      {store.unassignedSessions > 0 && store.semesters.length > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-xs ring-1 ring-amber-200 fade-up">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold text-amber-800">{store.unassignedSessions} session{store.unassignedSessions === 1 ? "" : "s"} fall outside every semester</p>
            <p className="mt-0.5 text-amber-700">
              They still count in the “All semesters” view, but they won't appear under any semester until a date range covers them.
              Pick <span className="font-semibold">Outside any semester</span> in the semester picker to see which ones.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {store.semesters.map((s, i) => {
          const current = today >= s.start && today <= s.end;
          return (
            <Card key={s.id} className="fade-up" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}><CalendarDays size={18} /></span>
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: NAVY_DARK }}>
                      {s.name}
                      {current && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">CURRENT</span>}
                    </p>
                    <p className="text-[11px] text-slate-400">{fmtDate(s.start)} → {fmtDate(s.end)}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(s)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Edit3 size={14} /></button>
                  <button onClick={() => remove(s)} className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-[11px] font-semibold text-slate-500">{s.sessionCount} session{s.sessionCount === 1 ? "" : "s"}</span>
                <button onClick={() => store.setSemesterId(s.id)} className="press text-[11px] font-bold transition hover:underline" style={{ color: NAVY }}>View attendance →</button>
              </div>
            </Card>
          );
        })}
        {store.semesters.length === 0 && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Card><EmptyState Icon={CalendarDays} title="No semesters yet"
              msg="Add your first teaching period — e.g. “Semester 2” from 01 Feb to 30 Jun — and attendance can then be reported per semester." /></Card>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit semester" : "Add semester"}>
        <div className="space-y-3">
          <Field label="Name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Semester 2" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input type="date" value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} className={inputCls} /></Field>
            <Field label="End date"><input type="date" value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} className={inputCls} /></Field>
          </div>
          {form.start && form.end && form.end < form.start && (
            <p className="text-[11px] font-semibold text-rose-600">The end date must be on or after the start date.</p>
          )}
          <p className="text-[11px] text-slate-400">Both dates are inclusive. Sessions dated inside this range count toward this semester automatically.</p>
          <PrimaryBtn onClick={save} disabled={invalid} className="w-full"><Save size={16} /> {edit ? "Save changes" : "Add semester"}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Dashboard: Settings (staff management) ----- */
/* ============================================================
   Dashboard: Assessments — a gradebook. Define assessments per
   course, enter student marks, and see grades & averages per
   course, per student and overall.
   ============================================================ */
const ASSESS_TYPES = ["Assignment", "Exam", "Presentation", "Project", "Portfolio"];
const bandOf = (pct) => (pct == null ? null : pct >= 70 ? "Distinction" : pct >= 60 ? "Merit" : pct >= 40 ? "Pass" : "Fail");
const gradeTone = (band) =>
  band === "Distinction" ? { bg: "bg-emerald-100", text: "text-emerald-700", colour: "#059669" }
    : band === "Merit" ? { bg: "bg-blue-100", text: "text-blue-700", colour: "#2563eb" }
      : band === "Pass" ? { bg: "bg-amber-100", text: "text-amber-700", colour: "#b45309" }
        : band === "Fail" ? { bg: "bg-rose-100", text: "text-rose-700", colour: MAROON }
          : { bg: "bg-slate-100", text: "text-slate-400", colour: "#94a3b8" };
const GRADE_BANDS = ["Distinction", "Merit", "Pass", "Fail"];

// A stacked distribution bar for Distinction/Merit/Pass/Fail counts.
function DistBar({ dist, className = "" }) {
  const total = GRADE_BANDS.reduce((a, b) => a + (dist?.[b] || 0), 0);
  if (!total) return <span className="text-[11px] text-slate-300">no grades</span>;
  return (
    <div className={`flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`} title={GRADE_BANDS.map(b => `${b}: ${dist[b] || 0}`).join(" · ")}>
      {GRADE_BANDS.map(b => (dist[b] ? <div key={b} style={{ width: `${(dist[b] / total) * 100}%`, background: gradeTone(b).colour }} /> : null))}
    </div>
  );
}

function AdminAssessments({ store }) {
  const { refreshHnd, refreshAssessments, assessmentsLoaded } = store;
  const [view, setView] = useState("overview");   // overview | manage | student
  const [openGrades, setOpenGrades] = useState(null); // assessment being graded
  useEffect(() => { refreshHnd(); refreshAssessments(); }, [refreshHnd, refreshAssessments]);

  if (!assessmentsLoaded) {
    return (<><AdminHeader title="Assessments" subtitle="Loading the gradebook…" Icon={Award} /><div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div></>);
  }
  if (openGrades) return <GradeEntry store={store} assessment={openGrades} onBack={() => setOpenGrades(null)} />;

  const tabs = [
    { key: "overview", label: "Overview", I: BarChart3 },
    { key: "manage", label: "Assessments & grades", I: ClipboardList },
    { key: "records", label: "Grade records", I: Layers },
    { key: "student", label: "By student", I: GraduationCap },
  ];
  return (
    <>
      <AdminHeader title="Assessments" subtitle="Marks, grades and averages across every course" Icon={Award}
        action={<button onClick={() => refreshAssessments()} className="press flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"><RefreshCw size={14} /> Refresh</button>} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setView(t.key)} className={`press flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold shadow-sm transition-all ${view === t.key ? "text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`} style={view === t.key ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` } : {}}><t.I size={14} /> {t.label}</button>
        ))}
      </div>
      {view === "overview" && <AssessmentsOverview store={store} />}
      {view === "manage" && <AssessmentsManage store={store} onGrade={setOpenGrades} />}
      {view === "records" && <AssessmentRecords store={store} />}
      {view === "student" && <StudentAssessments store={store} />}
    </>
  );
}

/* ----- Overview: cards + per-course averages & distribution ----- */
function AssessmentsOverview({ store }) {
  const ov = store.assessmentOverview;
  const [query, setQuery] = useState("");
  if (!ov) return <div className="skeleton h-64 rounded-2xl" />;
  const o = ov.overall;
  const ql = query.trim().toLowerCase();
  const rows = ov.modules.filter(m => !ql || m.code.toLowerCase().includes(ql) || m.name.toLowerCase().includes(ql));
  const exportCSV = () => {
    downloadCSV("assessment-averages.csv", [
      { key: "code", label: "Course code" }, { key: "name", label: "Course" }, { key: "students", label: "Students" },
      { key: "assessments", label: "Assessments" }, { key: "graded", label: "Graded" }, { key: "avg", label: "Average %" },
      ...GRADE_BANDS.map(b => ({ key: b, label: b })),
    ], ov.modules.map(m => ({ code: m.code, name: m.name, students: m.students, assessments: m.assessmentCount, graded: m.gradedCount, avg: m.avgPct ?? "", ...Object.fromEntries(GRADE_BANDS.map(b => [b, m.dist[b] || 0])) })));
    store.notify("Exported averages CSV");
  };
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Assessments" value={o.assessments} sub="defined across courses" Icon={ClipboardList} tone={NAVY} delay={0} animate />
        <StatCard label="Average mark" value={fmtPct(o.avgPct)} sub="across all grades" Icon={Percent} tone={pctTone(o.avgPct).colour} delay={60} animate />
        <StatCard label="Pass rate" value={fmtPct(o.passRate)} sub="graded at 40%+" Icon={Award} tone={pctTone(o.passRate).colour} delay={120} animate />
        <StatCard label="Grades entered" value={o.gradedSubmissions} sub="marked submissions" Icon={CheckCircle2} tone="#0d7a5f" delay={180} animate />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search course…" className="w-44 bg-transparent text-sm outline-none sm:w-56" /></div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 text-[11px] font-semibold text-slate-400 sm:flex">
            {GRADE_BANDS.map(b => <span key={b} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: gradeTone(b).colour }} />{b}</span>)}
          </span>
          <ExportBtn onClick={exportCSV} label="Export" />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr><th className="px-5 py-3">Course</th><th className="px-5 py-3 text-center whitespace-nowrap">Students</th><th className="px-5 py-3 text-center whitespace-nowrap">Assessments</th><th className="px-5 py-3 text-center whitespace-nowrap">Graded</th><th className="px-5 py-3 whitespace-nowrap">Grade spread</th><th className="px-5 py-3 text-center whitespace-nowrap">Average</th></tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id} className="border-t border-slate-100 transition-colors hover:bg-blue-50/30">
                  <td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}>{m.code.slice(0, 5)}</span><span className="min-w-0"><p className="truncate font-semibold text-slate-700" title={m.name}>{m.name}</p></span></div></td>
                  <td className="px-5 py-3 text-center tabular-nums text-slate-600">{m.students}</td>
                  <td className="px-5 py-3 text-center tabular-nums text-slate-600">{m.assessmentCount}</td>
                  <td className="px-5 py-3 text-center tabular-nums text-slate-500">{m.gradedCount}</td>
                  <td className="px-5 py-3"><div className="min-w-[120px]"><DistBar dist={m.dist} /></div></td>
                  <td className="px-5 py-3 text-center"><span className={`rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${pctTone(m.avgPct).bg} ${pctTone(m.avgPct).text}`}>{fmtPct(m.avgPct)}</span></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-10"><EmptyState Icon={Award} title="No courses" msg="Add courses and assessments to see averages here." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ----- Manage assessments per course + open grade entry ----- */
function AssessmentsManage({ store, onGrade }) {
  const [moduleId, setModuleId] = useState("");
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ title: "", type: "Assignment", maxMarks: 100, weight: 0, dueDate: "" });

  useEffect(() => {
    if (!store.modules.length) { setModuleId(""); return; }
    if (!moduleId || !store.modules.some(m => m.id === moduleId)) setModuleId(store.modules[0].id);
  }, [store.modules, moduleId]);

  const selected = store.modules.find(m => m.id === moduleId) || null;
  const list = store.assessments.filter(a => a.moduleId === moduleId);

  const openAdd = () => { setEdit(null); setForm({ title: "", type: "Assignment", maxMarks: 100, weight: 0, dueDate: "" }); setModal(true); };
  const openEdit = (a) => { setEdit(a); setForm({ title: a.title, type: a.type, maxMarks: a.maxMarks, weight: a.weight, dueDate: a.dueDate || "" }); setModal(true); };
  const save = async () => {
    try {
      const data = { ...form, maxMarks: Number(form.maxMarks), weight: Number(form.weight) };
      if (edit) await store.updateAssessment(edit.id, data);
      else await store.addAssessment({ ...data, moduleId });
      setModal(false);
    } catch (_e) { /* toast shown by store */ }
  };
  const remove = async (a) => {
    if (!window.confirm(`Delete "${a.title}"?\n\n${a.gradedCount || 0} grade${(a.gradedCount || 0) === 1 ? "" : "s"} will be deleted too. This cannot be undone.`)) return;
    await store.removeAssessment(a.id);
  };

  if (!store.modules.length) return <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"><EmptyState Icon={BookOpen} title="No courses yet" msg="Add a course first, then define its assessments." /></div>;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {store.modules.map(m => (
          <button key={m.id} onClick={() => setModuleId(m.id)} className={`press rounded-xl px-3.5 py-2 text-left text-xs font-bold shadow-sm ring-1 transition-all ${moduleId === m.id ? "text-white ring-transparent" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`} style={moduleId === m.id ? { background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` } : {}}>{m.code}</button>
        ))}
      </div>
      {selected && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-lg font-extrabold" style={{ color: NAVY_DARK }}>{selected.name}</p><p className="text-xs text-slate-400">{selected.code} · {selected.studentCount} students</p></div>
          <PrimaryBtn onClick={openAdd}><Plus size={16} /> Add assessment</PrimaryBtn>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((a, i) => {
          const tone = pctTone(a.avgPct);
          return (
            <Card key={a.id} className="fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-sm font-extrabold" style={{ color: NAVY_DARK }} title={a.title}>{a.title}</p><p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-500">{a.type}</span>· out of {a.maxMarks}{a.weight ? ` · ${a.weight}%` : ""}{a.dueDate ? ` · due ${fmtDate(a.dueDate)}` : ""}</p></div>
                <div className="flex gap-1"><button onClick={() => openEdit(a)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Edit3 size={14} /></button><button onClick={() => remove(a)} className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5 text-center">
                <div className="rounded-lg bg-slate-50 py-1.5"><p className="text-sm font-extrabold text-slate-700 tabular-nums">{a.gradedCount || 0}<span className="text-[10px] font-medium text-slate-400">/{selected?.studentCount ?? 0}</span></p><p className="text-[9px] uppercase tracking-wide text-slate-400">Graded</p></div>
                <div className={`rounded-lg py-1.5 ${tone.bg}`}><p className={`text-sm font-extrabold tabular-nums ${tone.text}`}>{fmtPct(a.avgPct)}</p><p className="text-[9px] uppercase tracking-wide text-slate-400">Average</p></div>
              </div>
              <button onClick={() => onGrade(a)} className="press mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-slate-200 py-2 text-xs font-bold transition hover:border-indigo-300 hover:bg-indigo-50" style={{ color: NAVY }}><ClipboardList size={14} /> Enter grades</button>
            </Card>
          );
        })}
        {list.length === 0 && <div className="sm:col-span-2 lg:col-span-3"><Card><EmptyState Icon={ClipboardList} title="No assessments for this course" msg="Add an assessment, then enter students' marks." /></Card></div>}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit assessment" : "Add assessment"}>
        <div className="space-y-3">
          <Field label="Title"><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Assignment 1" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inputCls}>{ASSESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="Max marks"><input type="number" min={1} max={1000} value={form.maxMarks} onChange={e => setForm(f => ({ ...f, maxMarks: e.target.value }))} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Weight (%)"><input type="number" min={0} max={100} value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} className={inputCls} /></Field>
            <Field label="Due date"><input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className={inputCls} /></Field>
          </div>
          <PrimaryBtn onClick={save} disabled={!form.title.trim() || !(Number(form.maxMarks) >= 1)} className="w-full"><Save size={16} /> {edit ? "Save changes" : "Add assessment"}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ----- Grade entry for one assessment (all enrolled students) ----- */
function GradeEntry({ store, assessment, onBack }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [saved, setSaved] = useState({});
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    try { const d = await store.getGrades(assessment.id); const snap = Object.fromEntries(d.rows.map(r => [r.student.id, r.marks == null ? "" : String(r.marks)])); setData(d); setDraft(snap); setSaved(snap); }
    catch (e) { store.notify?.(e.message || "Could not load grades", "error"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment.id]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <><AdminHeader title="Grades" subtitle="Loading…" Icon={Award} /><div className="skeleton h-64 rounded-2xl" /></>;

  const { assessment: a, module: mod, rows } = data;
  const max = a.maxMarks;
  const setMark = (id, v) => { if (v === "" || /^\d{1,4}$/.test(v)) setDraft(d => ({ ...d, [id]: v })); };
  const dirty = rows.some(r => (draft[r.student.id] ?? "") !== (saved[r.student.id] ?? ""));
  const marked = rows.map(r => draft[r.student.id]).filter(v => v !== "" && v != null && !isNaN(Number(v))).map(Number);
  const avgMarks = marked.length ? Math.round(marked.reduce((x, y) => x + y, 0) / marked.length * 10) / 10 : null;
  const avgPct = avgMarks != null ? Math.round(avgMarks / max * 1000) / 10 : null;
  const dist = { Distinction: 0, Merit: 0, Pass: 0, Fail: 0 };
  marked.forEach(m => { const b = bandOf(Math.round(m / max * 1000) / 10); if (b) dist[b]++; });
  const overMax = marked.some(m => m > max);

  const save = async () => {
    setSaving(true);
    try { await store.saveGrades(assessment.id, rows.map(r => ({ studentId: r.student.id, marks: (draft[r.student.id] === "" || draft[r.student.id] == null) ? null : Number(draft[r.student.id]) }))); await load(); }
    catch (_e) { /* store toasted */ }
    setSaving(false);
  };
  const ql = query.trim().toLowerCase();
  const visible = rows.filter(r => !ql || r.student.name.toLowerCase().includes(ql) || r.student.studentRef.includes(ql));
  const paged = usePaged(visible, 25, `${assessment.id}|${ql}`);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 fade-up">
        <button onClick={onBack} className="press flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"><ChevronLeft size={15} /> Back to assessments</button>
        {dirty && <span className="pop flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200"><AlertCircle size={13} /> Unsaved changes</span>}
      </div>
      <AdminHeader title={`${mod.code} — ${a.title}`} subtitle={`${a.type} · out of ${max}${a.weight ? ` · ${a.weight}%` : ""}${a.dueDate ? ` · due ${fmtDate(a.dueDate)}` : ""}`} Icon={Award}
        action={<PrimaryBtn onClick={save} disabled={!dirty || saving || overMax} colour={dirty && !overMax ? NAVY : "#94a3b8"}>{saving ? <><Loader size={16} /> Saving…</> : <><Save size={16} /> Save grades</>}</PrimaryBtn>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold shadow-sm ring-1 ring-slate-200" style={{ color: pctTone(avgPct).colour }}><Percent size={13} /> Average {fmtPct(avgPct)}{avgMarks != null ? ` (${avgMarks}/${max})` : ""}</span>
        <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-500 shadow-sm ring-1 ring-slate-200">{marked.length}/{rows.length} graded</span>
        {GRADE_BANDS.map(b => <span key={b} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold shadow-sm ring-1 ring-slate-200" style={{ color: gradeTone(b).colour }}><span className="h-2 w-2 rounded-full" style={{ background: gradeTone(b).colour }} />{b} {dist[b]}</span>)}
        <div className="ml-auto flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student…" className="bg-transparent text-sm outline-none" /></div>
      </div>
      {overMax && <div className="mb-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200"><AlertCircle size={14} /> Some marks exceed the maximum of {max}. Fix them before saving.</div>}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Student</th><th className="px-5 py-3 whitespace-nowrap">Marks (/{max})</th><th className="px-5 py-3 text-center">%</th><th className="px-5 py-3 text-center">Grade</th></tr></thead>
            <tbody>
              {paged.slice.map(r => {
                const v = draft[r.student.id] ?? "";
                const num = v === "" ? null : Number(v);
                const pct = num == null ? null : Math.round(num / max * 1000) / 10;
                const band = bandOf(pct);
                const gt = gradeTone(band);
                const bad = num != null && num > max;
                return (
                  <tr key={r.student.id} className="border-t border-slate-100 transition-colors hover:bg-blue-50/30">
                    <td className="px-5 py-2.5"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: r.student.colour }}>{r.student.initials}</span><div><p className="font-semibold" style={{ color: NAVY }}>{r.student.name}</p><p className="text-[11px] text-slate-400">{r.student.studentRef}{!r.enrolled && <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold text-slate-500">NOT ENROLLED</span>}</p></div></div></td>
                    <td className="px-5 py-2.5"><input inputMode="numeric" value={v} onChange={e => setMark(r.student.id, e.target.value)} placeholder="—" className={`w-24 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition focus:ring-2 ${bad ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-slate-200 focus:border-blue-400 focus:ring-blue-100"}`} /></td>
                    <td className="px-5 py-2.5 text-center tabular-nums text-slate-500">{pct == null ? "—" : `${pct}%`}</td>
                    <td className="px-5 py-2.5 text-center">{band ? <span className={`rounded-lg px-2 py-1 text-[11px] font-extrabold ${gt.bg} ${gt.text}`}>{band}</span> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                );
              })}
              {paged.slice.length === 0 && <tr><td colSpan={4} className="px-5 py-10"><EmptyState Icon={Users} title={rows.length === 0 ? "No students enrolled" : "No students match"} msg={rows.length === 0 ? "Enrol students onto this course first." : "Try a different search."} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
      <p className="mt-3 text-[11px] text-slate-400">Grades: 70%+ Distinction · 60–69 Merit · 40–59 Pass · below 40 Fail. Leave a mark blank to clear it.</p>
    </>
  );
}

/* ----- By student: a student's assessments, marks, grades & average ----- */
function StudentAssessments({ store }) {
  const [studentId, setStudentId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!studentId) { setData(null); return; }
    let live = true; setLoading(true);
    store.studentAssessments(studentId).then(d => { if (live) setData(d); }).catch(e => store.notify?.(e.message || "Could not load", "error")).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [studentId, store]);

  const byModule = {};
  (data?.assessments || []).forEach(a => { (byModule[a.moduleId] = byModule[a.moduleId] || { code: a.moduleCode, name: a.moduleName, items: [] }).items.push(a); });

  return (
    <>
      <div className="mb-4 max-w-md"><Field label="Choose a student"><StudentCombo students={store.students} value={studentId} onChange={setStudentId} /></Field></div>
      {!studentId && <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"><EmptyState Icon={GraduationCap} title="Pick a student" msg="Search for a student above to see their assessments, marks, grades and average." /></div>}
      {studentId && loading && <div className="skeleton h-48 rounded-2xl" />}
      {studentId && data && !loading && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Assessments" value={data.count} sub="on their courses" Icon={ClipboardList} tone={NAVY} delay={0} animate />
            <StatCard label="Graded" value={data.graded} sub={`${data.count - data.graded} outstanding`} Icon={CheckCircle2} tone="#0d7a5f" delay={60} animate />
            <StatCard label="Average mark" value={fmtPct(data.averagePct)} sub="across graded work" Icon={Percent} tone={pctTone(data.averagePct).colour} delay={120} animate />
            <StatCard label="Overall grade" value={data.averageGrade || "—"} sub="based on average" Icon={Award} tone={gradeTone(data.averageGrade).colour} delay={180} animate />
          </div>
          {Object.entries(byModule).map(([mid, m]) => (
            <div key={mid} className="mb-4">
              <p className="mb-1.5 flex items-center gap-2 text-sm font-bold text-slate-700"><span className="flex h-6 w-9 items-center justify-center rounded text-[10px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}>{m.code.slice(0, 5)}</span>{m.name}</p>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
                <table className="w-full text-sm">
                  <tbody>
                    {m.items.map((a, i) => { const gt = gradeTone(a.grade); return (
                      <tr key={a.id} className={`${i ? "border-t border-slate-100" : ""}`}>
                        <td className="px-5 py-2.5"><p className="font-semibold text-slate-700">{a.title}</p><p className="text-[11px] text-slate-400">{a.type}{a.weight ? ` · ${a.weight}%` : ""}</p></td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-slate-600">{a.marks == null ? <span className="text-slate-300">not graded</span> : `${a.marks}/${a.maxMarks}`}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-slate-500">{a.pct == null ? "" : `${a.pct}%`}</td>
                        <td className="px-5 py-2.5 text-right">{a.grade ? <span className={`rounded-lg px-2 py-1 text-[11px] font-extrabold ${gt.bg} ${gt.text}`}>{a.grade}</span> : <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {data.count === 0 && <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/70"><EmptyState Icon={ClipboardList} title="No assessments" msg="This student's courses don't have any assessments defined yet." /></div>}
        </>
      )}
    </>
  );
}

/* ----- Grade records: record-level CRUD (programme → course → assessment → student → marks) ----- */
function AssessmentRecords({ store }) {
  const programmeById = useMemo(() => Object.fromEntries(store.programmes.map(p => [p.id, p])), [store.programmes]);
  const [fProgramme, setFProgramme] = useState("");
  const [fModule, setFModule] = useState("");
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState([]);
  const [meta, setMeta] = useState({ total: 0, capped: false });
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ programmeId: "", moduleId: "", assessmentId: "", studentId: "", marks: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!fProgramme && store.programmes.length) setFProgramme(store.programmes[0].id); }, [store.programmes, fProgramme]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = fModule ? { moduleId: fModule } : fProgramme ? { programmeId: fProgramme } : {};
      const res = await store.listGrades(params);
      // Endpoint returns { records, total, capped }. Tolerate an array too, for safety.
      const rows = Array.isArray(res) ? res : (res.records || []);
      setRecords(rows);
      setMeta({ total: Array.isArray(res) ? rows.length : (res.total ?? rows.length), capped: !Array.isArray(res) && !!res.capped });
    } catch (e) { store.notify?.(e.message || "Could not load records", "error"); }
    setLoading(false);
  }, [fProgramme, fModule, store]);
  useEffect(() => { load(); }, [load]);

  const coursesInProg = (pid) => store.modules.filter(m => m.programmeId === pid);
  const assessmentsInCourse = (mid) => store.assessments.filter(a => a.moduleId === mid);
  const studentsInCourse = (mid) => store.students.filter(s => (s.moduleIds || []).includes(mid));
  const selectedAssessment = store.assessments.find(a => a.id === form.assessmentId);
  const maxMarks = selectedAssessment?.maxMarks ?? 100;

  const openAdd = () => { setEdit(null); setForm({ programmeId: fProgramme || "", moduleId: fModule || "", assessmentId: "", studentId: "", marks: "" }); setModal(true); };
  const openEdit = (r) => { setEdit(r); setForm({ programmeId: r.module.programmeId || "", moduleId: r.module.id, assessmentId: r.assessmentId, studentId: r.studentId, marks: String(r.marks) }); setModal(true); };
  const save = async () => {
    setBusy(true);
    try { await store.saveGrade(form.assessmentId, form.studentId, form.marks === "" ? null : Number(form.marks)); setModal(false); await load(); }
    catch (_e) { /* store toasted */ }
    setBusy(false);
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete ${r.student.name}'s mark for ${r.module.code} — ${r.assessment.title}? This cannot be undone.`)) return;
    await store.saveGrade(r.assessmentId, r.studentId, null); await load();
  };

  const ql = query.trim().toLowerCase();
  const list = records.filter(r => !ql || r.student.name.toLowerCase().includes(ql) || r.student.studentRef.includes(ql) || r.assessment.title.toLowerCase().includes(ql));
  const paged = usePaged(list, 15, `${fProgramme}|${fModule}|${ql}`);
  const editStudent = edit ? store.students.find(s => s.id === edit.studentId) || edit.student : null;
  const formValid = form.programmeId && form.moduleId && form.assessmentId && form.studentId && form.marks !== "" && Number(form.marks) >= 0 && Number(form.marks) <= maxMarks;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={fProgramme} onChange={e => { setFProgramme(e.target.value); setFModule(""); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 outline-none">
          <option value="">All programmes</option>
          {store.programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={fModule} onChange={e => setFModule(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 outline-none">
          <option value="">All courses{fProgramme ? " in programme" : ""}</option>
          {(fProgramme ? coursesInProg(fProgramme) : store.modules).map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
        </select>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student or assessment…" className="w-40 bg-transparent text-sm outline-none sm:w-52" /></div>
        <PrimaryBtn className="ml-auto" onClick={openAdd}><Plus size={16} /> Add grade record</PrimaryBtn>
      </div>

      {meta.capped && (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
          Showing the most recent <b>{records.length.toLocaleString()}</b> of <b>{meta.total.toLocaleString()}</b> records. Filter by programme or course to see the rest.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr><th className="px-5 py-3">Student</th><th className="px-5 py-3">Programme</th><th className="px-5 py-3">Course</th><th className="px-5 py-3">Assessment</th><th className="px-5 py-3 whitespace-nowrap">Marks</th><th className="px-5 py-3 text-center">%</th><th className="px-5 py-3 text-center">Grade</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">Loading…</td></tr>}
              {!loading && paged.slice.map(r => { const gt = gradeTone(r.grade); const prog = programmeById[r.module.programmeId]; return (
                <tr key={r.id} className="border-t border-slate-100 transition-colors hover:bg-blue-50/30">
                  <td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: r.student.colour }}>{r.student.initials}</span><div className="min-w-0"><p className="font-semibold text-slate-700">{r.student.name}</p><p className="text-[11px] tabular-nums text-slate-400">{r.student.studentRef}</p></div></div></td>
                  <td className="px-5 py-3"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: (prog?.colour || "#64748b") + "1a", color: prog?.colour || "#64748b" }}>{prog?.name || "—"}</span></td>
                  <td className="px-5 py-3"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600" title={r.module.name}>{r.module.code}</span></td>
                  <td className="px-5 py-3 text-slate-600"><p className="font-medium">{r.assessment.title}</p><p className="text-[11px] text-slate-400">{r.assessment.type}</p></td>
                  <td className="px-5 py-3 font-bold tabular-nums text-slate-700">{r.marks}<span className="text-slate-300">/{r.assessment.maxMarks}</span></td>
                  <td className="px-5 py-3 text-center tabular-nums text-slate-500">{r.pct == null ? "—" : `${r.pct}%`}</td>
                  <td className="px-5 py-3 text-center">{r.grade ? <span className={`rounded-lg px-2 py-1 text-[11px] font-extrabold ${gt.bg} ${gt.text}`}>{r.grade}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1 whitespace-nowrap"><button onClick={() => openEdit(r)} title="Edit marks" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Edit3 size={15} /></button><button onClick={() => remove(r)} title="Delete record" className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button></div></td>
                </tr>
              ); })}
              {!loading && paged.slice.length === 0 && <tr><td colSpan={8} className="px-5 py-10"><EmptyState Icon={ClipboardList} title="No grade records" msg="No marks recorded for this filter yet. Use “Add grade record” to enter one." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
      <p className="mt-3 text-[11px] text-slate-400">{list.length.toLocaleString()} record{list.length === 1 ? "" : "s"}{query ? " matching" : ""}{fModule ? " for this course" : fProgramme ? " for this programme" : ""}{meta.capped ? ` (of ${meta.total.toLocaleString()} total — narrow the filter to load all)` : ""}. Grades: 70%+ Distinction · 60–69 Merit · 40–59 Pass · below 40 Fail.</p>

      <Modal open={modal} onClose={() => !busy && setModal(false)} title={edit ? "Edit grade record" : "Add grade record"} width={520}>
        <div className="space-y-3">
          {edit ? (
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
              <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: editStudent?.colour }}>{editStudent?.initials}</span><div><p className="text-sm font-bold text-slate-700">{editStudent?.name}</p><p className="text-[11px] text-slate-400">{edit.module.code} · {edit.assessment.title} · {programmeById[edit.module.programmeId]?.name || ""}</p></div></div>
            </div>
          ) : (
            <>
              <Field label="Programme"><select value={form.programmeId} onChange={e => setForm(f => ({ ...f, programmeId: e.target.value, moduleId: "", assessmentId: "", studentId: "" }))} className={inputCls}><option value="">Choose…</option>{store.programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Course"><select value={form.moduleId} onChange={e => setForm(f => ({ ...f, moduleId: e.target.value, assessmentId: "", studentId: "" }))} disabled={!form.programmeId} className={inputCls}><option value="">Choose…</option>{coursesInProg(form.programmeId).map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}</select></Field>
              <Field label="Assessment"><select value={form.assessmentId} onChange={e => setForm(f => ({ ...f, assessmentId: e.target.value }))} disabled={!form.moduleId} className={inputCls}><option value="">Choose…</option>{assessmentsInCourse(form.moduleId).map(a => <option key={a.id} value={a.id}>{a.title} — out of {a.maxMarks}</option>)}</select>{form.moduleId && assessmentsInCourse(form.moduleId).length === 0 && <p className="mt-1 text-[11px] text-amber-600">This course has no assessments — add one on the “Assessments &amp; grades” tab first.</p>}</Field>
              <Field label="Student"><StudentCombo students={studentsInCourse(form.moduleId)} value={form.studentId} onChange={id => setForm(f => ({ ...f, studentId: id }))} /></Field>
            </>
          )}
          <Field label={`Total marks (out of ${maxMarks})`}><input type="number" min={0} max={maxMarks} value={form.marks} onChange={e => setForm(f => ({ ...f, marks: e.target.value }))} placeholder={`0–${maxMarks}`} className={inputCls} /></Field>
          {form.marks !== "" && Number(form.marks) >= 0 && Number(form.marks) <= maxMarks && (
            <p className="text-[11px] text-slate-400">= {Math.round(Number(form.marks) / maxMarks * 1000) / 10}% · <span className="font-bold" style={{ color: gradeTone(bandOf(Math.round(Number(form.marks) / maxMarks * 1000) / 10)).colour }}>{bandOf(Math.round(Number(form.marks) / maxMarks * 1000) / 10)}</span></p>
          )}
          {form.marks !== "" && Number(form.marks) > maxMarks && <p className="text-[11px] font-semibold text-rose-600">Marks can't exceed the maximum of {maxMarks}.</p>}
          <PrimaryBtn onClick={save} disabled={busy || !formValid} className="w-full">{busy ? <><Loader size={16} /> Saving…</> : <><Save size={16} /> {edit ? "Save marks" : "Add record"}</>}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ============================================================
   Dashboard: PAT — Personal Academic Tutor interactions.
   Log a meeting/contact with a student (query type, summary,
   follow-up actions, whether a follow-up is required) and keep a
   searchable log with follow-up tracking.
   ============================================================ */
const QUERY_TYPES = [
  "1 to 1 Meeting", "No Show", "Academic Query", "Assessment Queries",
  "Stage 2 - Absence Concern Meeting", "Progression Concerns",
  "Personal Wellbeing", "Feedback on Assignments", "Other",
];
const QT_TONE = {
  "No Show": { bg: "bg-rose-100", text: "text-rose-700" },
  "Stage 2 - Absence Concern Meeting": { bg: "bg-amber-100", text: "text-amber-700" },
  "Progression Concerns": { bg: "bg-amber-100", text: "text-amber-700" },
  "Personal Wellbeing": { bg: "bg-violet-100", text: "text-violet-700" },
  "Academic Query": { bg: "bg-blue-100", text: "text-blue-700" },
  "Assessment Queries": { bg: "bg-blue-100", text: "text-blue-700" },
  "Feedback on Assignments": { bg: "bg-emerald-100", text: "text-emerald-700" },
};
const qtTone = (t) => QT_TONE[t] || { bg: "bg-slate-100", text: "text-slate-600" };
const nowHM = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// A searchable single-student selector (there can be 1000s of students).
function StudentCombo({ students, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sel = students.find(s => s.id === value);
  const ql = q.trim().toLowerCase();
  const matches = (ql ? students.filter(s => s.name.toLowerCase().includes(ql) || s.studentRef.includes(ql) || s.email.toLowerCase().includes(ql)) : students);
  const shown = matches.slice(0, 40);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className={`${inputCls} flex items-center justify-between text-left`}>
        {sel
          ? <span className="flex min-w-0 items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: sel.colour }}>{sel.initials}</span><span className="truncate">{sel.name}</span><span className="shrink-0 text-slate-400">{sel.studentRef}</span></span>
          : <span className="text-slate-400">Choose a student…</span>}
        <ChevronDown size={16} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 max-h-72 w-full overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or number…" className="flex-1 bg-transparent text-sm outline-none" />
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {shown.map(s => (
                <button type="button" key={s.id} onClick={() => { onChange(s.id); setOpen(false); setQ(""); }} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${s.id === value ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: s.colour }}>{s.initials}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-700">{s.name}</span><span className="block truncate text-[11px] text-slate-400">{s.studentRef}</span></span>
                </button>
              ))}
              {shown.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">No students match.</p>}
              {matches.length > shown.length && <p className="px-2 py-2 text-center text-[11px] text-slate-400">Showing 40 of {matches.length} — keep typing to narrow.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AdminPAT({ store }) {
  const { refreshHnd, refreshInteractions, interactionsLoaded } = store;
  const blank = () => ({ studentId: "", date: todayISO(), time: nowHM(), queryType: "", summary: "", followUpActions: "", followUpRequired: false, tutor: "" });
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState(blank());
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [followFilter, setFollowFilter] = useState("all"); // all | required | none
  const [busy, setBusy] = useState(false);

  // Needs students (for the picker) + interactions. Both load on open.
  useEffect(() => { refreshHnd(); refreshInteractions(); }, [refreshHnd, refreshInteractions]);

  const studentsById = useMemo(() => Object.fromEntries(store.students.map(s => [s.id, s])), [store.students]);
  const programmeById = useMemo(() => Object.fromEntries(store.programmes.map(p => [p.id, p])), [store.programmes]);
  const moduleById = useMemo(() => Object.fromEntries(store.modules.map(m => [m.id, m])), [store.modules]);
  const courseOf = (studentId) => {
    const s = studentsById[studentId];
    const modId = (s?.moduleIds || [])[0];
    const prog = modId ? programmeById[moduleById[modId]?.programmeId] : null;
    return prog?.name || "—";
  };

  const openAdd = () => { setEdit(null); setForm(blank()); setModal(true); };
  const openEdit = (it) => { setEdit(it); setForm({ studentId: it.studentId, date: it.date, time: it.time, queryType: it.queryType, summary: it.summary || "", followUpActions: it.followUpActions || "", followUpRequired: !!it.followUpRequired, tutor: it.tutor || "" }); setModal(true); };
  const save = async () => {
    setBusy(true);
    try {
      if (edit) await store.updateInteraction(edit.id, form);
      else await store.addInteraction(form);
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
    setBusy(false);
  };
  const remove = async (it) => {
    if (!window.confirm(`Delete this ${it.queryType} interaction for ${it.student?.name || "this student"}? This cannot be undone.`)) return;
    await store.removeInteraction(it.id);
  };

  const ql = query.trim().toLowerCase();
  const list = store.interactions.filter(it => {
    if (typeFilter && it.queryType !== typeFilter) return false;
    if (followFilter === "required" && !it.followUpRequired) return false;
    if (followFilter === "none" && it.followUpRequired) return false;
    if (!ql) return true;
    return (it.student?.name || "").toLowerCase().includes(ql) || (it.student?.studentRef || "").includes(ql) || (it.summary || "").toLowerCase().includes(ql) || it.queryType.toLowerCase().includes(ql);
  });
  const paged = usePaged(list, 12, `${ql}|${typeFilter}|${followFilter}`);

  // Stats
  const total = store.interactions.length;
  const openFollowUps = store.interactions.filter(i => i.followUpRequired).length;
  const noShows = store.interactions.filter(i => i.queryType === "No Show").length;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const thisWeek = store.interactions.filter(i => i.date >= weekAgo).length;

  const exportCSV = () => {
    downloadCSV("pat-interactions.csv", [
      { key: "ref", label: "Student reference" }, { key: "name", label: "Student name" }, { key: "course", label: "Course" },
      { key: "date", label: "Interaction date" }, { key: "time", label: "Time" }, { key: "type", label: "Query type" },
      { key: "summary", label: "Interaction summary" }, { key: "actions", label: "Follow up actions" },
      { key: "followUp", label: "Follow up required" }, { key: "tutor", label: "Tutor" }, { key: "loggedBy", label: "Logged by" },
    ], list.map(it => ({
      ref: it.student?.studentRef || "", name: it.student?.name || "", course: courseOf(it.studentId),
      date: it.date, time: it.time, type: it.queryType, summary: it.summary, actions: it.followUpActions,
      followUp: it.followUpRequired ? "Yes" : "No", tutor: it.tutor || "", loggedBy: it.loggedBy || "",
    })));
    store.notify("Exported interactions CSV");
  };

  const formValid = form.studentId && form.date && form.time && form.queryType;

  if (!interactionsLoaded) {
    return (<><AdminHeader title="PAT — Student Interactions" subtitle="Loading the interaction log…" Icon={MessageSquare} /><div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div></>);
  }

  return (
    <>
      <AdminHeader
        title="PAT — Student Interactions"
        subtitle="Log tutor meetings & contacts, and track follow-ups"
        Icon={MessageSquare}
        action={<div className="flex flex-wrap items-center gap-2"><ExportBtn onClick={exportCSV} label="Export" /><PrimaryBtn onClick={openAdd}><Plus size={16} /> Log interaction</PrimaryBtn></div>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Interactions" value={total} sub="logged in total" Icon={MessageSquare} tone={NAVY} delay={0} animate />
        <StatCard label="Follow-ups open" value={openFollowUps} sub="need action" Icon={AlertCircle} tone={openFollowUps > 0 ? "#b45309" : "#059669"} delay={60} animate />
        <StatCard label="This week" value={thisWeek} sub="last 7 days" Icon={CalendarDays} tone="#6d28d9" delay={120} animate />
        <StatCard label="No-shows" value={noShows} sub="missed meetings" Icon={XCircle} tone={MAROON} delay={180} animate />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <Search size={15} className="text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search student, summary or type…" className="w-44 bg-transparent text-sm outline-none sm:w-60" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 outline-none">
          <option value="">All query types</option>
          {QUERY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
          {[{ k: "all", l: "All" }, { k: "required", l: "Follow-up" }, { k: "none", l: "No follow-up" }].map(f => (
            <button key={f.k} onClick={() => setFollowFilter(f.k)} className={`press rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${followFilter === f.k ? "text-white" : "text-slate-500 hover:bg-slate-100"}`} style={followFilter === f.k ? { background: NAVY } : {}}>{f.l}</button>
          ))}
        </div>
        <span className="ml-auto text-xs font-semibold text-slate-400">{list.length} of {total}</span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3">Student</th><th className="px-5 py-3">Course</th><th className="px-5 py-3 whitespace-nowrap">Date / time</th>
                <th className="px-5 py-3">Query type</th><th className="px-5 py-3">Summary</th><th className="px-5 py-3">Follow-up actions</th>
                <th className="px-5 py-3 text-center whitespace-nowrap">Follow-up?</th><th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map(it => {
                const t = qtTone(it.queryType);
                return (
                  <tr key={it.id} onClick={() => openEdit(it)} className="cursor-pointer border-t border-slate-100 align-top transition-colors duration-150 hover:bg-blue-50/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: it.student?.colour || "#94a3b8" }}>{it.student?.initials || "?"}</span>
                        <div className="min-w-0"><p className="font-semibold text-slate-700">{it.student?.name || "—"}</p><p className="text-[11px] tabular-nums text-slate-400">{it.student?.studentRef || ""}</p></div>
                      </div>
                    </td>
                    <td className="px-5 py-3"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{courseOf(it.studentId)}</span></td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-500"><p className="font-medium text-slate-600">{fmtDate(it.date)}</p><p className="text-[11px] tabular-nums text-slate-400">{it.time}</p></td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${t.bg} ${t.text}`}>{it.queryType}</span></td>
                    <td className="px-5 py-3"><p className="line-clamp-2 max-w-[240px] text-[13px] text-slate-600">{it.summary || <span className="text-slate-300">—</span>}</p></td>
                    <td className="px-5 py-3"><p className="line-clamp-2 max-w-[240px] text-[13px] text-slate-600">{it.followUpActions || <span className="text-slate-300">—</span>}</p></td>
                    <td className="px-5 py-3 text-center">
                      {it.followUpRequired
                        ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">Yes</span>
                        : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-400">No</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1 whitespace-nowrap">
                        <button onClick={(e) => { e.stopPropagation(); openEdit(it); }} title="Edit / view" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Edit3 size={15} /></button>
                        <button onClick={(e) => { e.stopPropagation(); remove(it); }} title="Delete" className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paged.slice.length === 0 && <tr><td colSpan={8} className="px-5 py-10"><EmptyState Icon={MessageSquare} title={total === 0 ? "No interactions yet" : "No interactions match"} msg={total === 0 ? "Log your first student interaction with “Log interaction”." : "Try a different search or filter."} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />

      <Modal open={modal} onClose={() => !busy && setModal(false)} title={edit ? "Student interaction" : "Log new interaction"} width={560}>
        <div className="space-y-3">
          <Field label="Student"><StudentCombo students={store.students} value={form.studentId} onChange={id => setForm(f => ({ ...f, studentId: id }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Interaction date"><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className={inputCls} /></Field>
            <Field label="Interaction time"><input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} className={inputCls} /></Field>
          </div>
          <Field label="Query type">
            <select value={form.queryType} onChange={e => setForm(f => ({ ...f, queryType: e.target.value }))} className={inputCls}>
              <option value="">Choose…</option>
              {QUERY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Tutor (who met the student)">
            <select value={form.tutor} onChange={e => setForm(f => ({ ...f, tutor: e.target.value }))} className={inputCls}>
              <option value="">— not specified —</option>
              {store.staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Interaction summary"><textarea rows={4} value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} placeholder="What was discussed…" className={`${inputCls} resize-y`} /></Field>
          <Field label="Follow up actions"><textarea rows={3} value={form.followUpActions} onChange={e => setForm(f => ({ ...f, followUpActions: e.target.value }))} placeholder="Actions agreed / to take…" className={`${inputCls} resize-y`} /></Field>
          <Field label="Follow up required?">
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              {[{ v: false, l: "No" }, { v: true, l: "Yes" }].map(o => (
                <button key={String(o.v)} type="button" onClick={() => setForm(f => ({ ...f, followUpRequired: o.v }))} className={`press flex-1 rounded-lg py-2 text-xs font-bold transition ${form.followUpRequired === o.v ? (o.v ? "bg-amber-500 text-white shadow-sm" : "bg-white text-slate-700 shadow-sm") : "text-slate-400"}`}>{o.l}</button>
              ))}
            </div>
          </Field>
          {edit?.loggedBy && <p className="text-[11px] text-slate-400">Logged by {edit.loggedBy}.</p>}
          <PrimaryBtn onClick={save} disabled={busy || !formValid} className="w-full">{busy ? <><Loader size={16} /> Saving…</> : <><Save size={16} /> {edit ? "Save changes" : "Log interaction"}</>}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}

/* ============================================================
   Dashboard: KPIs — a performance dashboard, one row per staff.
   Blends their own attendance (check-ins), teaching load, register
   submission (registers actually taken for their classes), the
   student attendance they achieve, and leave use — into a single
   RAG-rated score. All computed live from real data.
   ============================================================ */
const ON_TIME_BY = "09:00"; // check-in at/before this counts as on time

function computeStaffKpis(store) {
  const today = todayISO();
  const moduleTotals = store.attendance?.moduleTotals || {};
  return store.staff.map(s => {
    // 1) Own attendance — from their check-in log
    const cis = store.checkins.filter(c => c.staffId === s.id);
    const days = cis.length;
    const onTime = cis.filter(c => c.in && c.in <= ON_TIME_BY).length;
    const punctuality = days ? Math.round((onTime / days) * 100) : null;

    // 2) Teaching load — courses this person tutors
    const mods = store.modules.filter(m => m.tutor && m.tutor === s.name);
    const courses = mods.length;
    const studentsTaught = mods.reduce((a, m) => a + (m.studentCount || 0), 0);

    // 3) Register submission — past sessions in their courses that have a register taken
    const due = store.sessions.filter(x => x.date <= today && mods.some(m => m.id === x.moduleId));
    const taken = due.filter(x => (x.markedCount || 0) > 0).length;
    const submission = due.length ? Math.round((taken / due.length) * 100) : null;

    // 4) Student attendance they achieve — mean cohort % across their courses
    const pcts = mods.map(m => moduleTotals[m.id]?.pct).filter(v => v != null);
    const cohort = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null;

    // 5) Leave use
    const used = store.usedDays(s.id);
    const allowance = store.effectiveAllowance(s.id);

    // Composite score — mean of the metrics that apply to this person
    const parts = [punctuality, submission, cohort].filter(v => v != null);
    const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

    return { s, days, punctuality, courses, studentsTaught, due: due.length, taken, submission, cohort, used, allowance, score, mods };
  });
}

// A compact metric cell: a coloured pill + a thin bar. null shows a muted dash.
function KpiCell({ value, suffix = "%" }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  const t = pctTone(value);
  return (
    <div className="min-w-[92px]">
      <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold tabular-nums ${t.bg} ${t.text}`}>{value}{suffix}</span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: t.colour }} /></div>
    </div>
  );
}

function AdminKPI({ store }) {
  const { refreshHnd, hndLoaded } = store;
  const [detail, setDetail] = useState(null);
  const [sort, setSort] = useState("score");   // score | submission | cohort | punctuality | name
  useEffect(() => { refreshHnd(); }, [refreshHnd]);

  const kpis = useMemo(() => computeStaffKpis(store), [store.staff, store.checkins, store.modules, store.sessions, store.attendance, store.leave, store.adjustments]);

  const avg = (key) => { const v = kpis.map(k => k[key]).filter(x => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
  const tutors = kpis.filter(k => k.courses > 0);
  const orgSubmission = avg("submission");
  const orgCohort = avg("cohort");
  const orgPunctuality = avg("punctuality");
  const orgScore = avg("score");

  const sorted = [...kpis].sort((a, b) => {
    if (sort === "name") return a.s.name.localeCompare(b.s.name);
    return (b[sort] ?? -1) - (a[sort] ?? -1);
  });
  const chartData = tutors.map(k => ({ name: k.s.initials, full: k.s.name, score: k.score ?? 0 })).slice(0, 12);

  const exportKpis = () => {
    downloadCSV("staff-kpis.csv", [
      { key: "name", label: "Staff" }, { key: "dept", label: "Department" }, { key: "courses", label: "Courses tutored" },
      { key: "students", label: "Students taught" }, { key: "submission", label: "Register submission %" },
      { key: "cohort", label: "Student attendance %" }, { key: "punctuality", label: "Own punctuality %" },
      { key: "leave", label: "Leave used" }, { key: "score", label: "KPI score" },
    ], kpis.map(k => ({
      name: k.s.name, dept: k.s.dept, courses: k.courses, students: k.studentsTaught,
      submission: k.submission ?? "", cohort: k.cohort ?? "", punctuality: k.punctuality ?? "",
      leave: `${k.used}/${k.allowance}`, score: k.score ?? "",
    })));
    store.notify("Exported KPI CSV");
  };

  if (!hndLoaded) {
    return (<><AdminHeader title="KPI Dashboard" subtitle="Crunching staff performance…" Icon={Activity} /><div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div></>);
  }

  return (
    <>
      <AdminHeader
        title="KPI Dashboard"
        subtitle="Staff performance at a glance — attendance, register submission & student outcomes"
        Icon={Activity}
        action={<ExportBtn onClick={exportKpis} label="Export KPIs" />}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Avg KPI score" value={fmtPct(orgScore)} sub="across all staff" Icon={Award} tone={pctTone(orgScore).colour} delay={0} animate />
        <StatCard label="Register submission" value={fmtPct(orgSubmission)} sub="registers taken on time" Icon={ClipboardList} tone={pctTone(orgSubmission).colour} delay={60} animate />
        <StatCard label="Student attendance" value={fmtPct(orgCohort)} sub="across taught classes" Icon={Percent} tone={pctTone(orgCohort).colour} delay={120} animate />
        <StatCard label="Staff punctuality" value={fmtPct(orgPunctuality)} sub={`on-time by ${ON_TIME_BY}`} Icon={Clock3} tone={pctTone(orgPunctuality).colour} delay={180} animate />
      </div>

      {/* KPI score by tutor */}
      <div className="mb-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up">
        <p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-700"><BarChart3 size={15} /> KPI score by staff {tutors.length > 12 && <span className="text-[11px] font-medium text-slate-400">(top 12)</span>}</p>
        {chartData.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} formatter={(v) => [`${v}%`, "KPI score"]} labelFormatter={(l) => chartData.find(d => d.name === l)?.full || l} />
              <Bar dataKey="score" radius={[6, 6, 0, 0]}>{chartData.map((d, i) => <Cell key={i} fill={pctTone(d.score).colour} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState Icon={BarChart3} title="No teaching KPIs yet" msg="Assign staff as course tutors (Courses → Edit) and take some registers — each tutor's score will appear here." />
        )}
      </div>

      {/* Per-staff KPI table */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-700">Per-staff breakdown</p>
        <div className="ml-auto flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
          <span className="px-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Sort</span>
          {[{ k: "score", l: "Score" }, { k: "submission", l: "Registers" }, { k: "cohort", l: "Attendance" }, { k: "name", l: "Name" }].map(o => (
            <button key={o.k} onClick={() => setSort(o.k)} className={`press rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${sort === o.k ? "text-white" : "text-slate-500 hover:bg-slate-100"}`} style={sort === o.k ? { background: NAVY } : {}}>{o.l}</button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3">Staff</th>
                <th className="px-5 py-3 text-center whitespace-nowrap">Courses</th>
                <th className="px-5 py-3 text-center whitespace-nowrap">Students</th>
                <th className="px-5 py-3 whitespace-nowrap">Register submission</th>
                <th className="px-5 py-3 whitespace-nowrap">Student attendance</th>
                <th className="px-5 py-3 whitespace-nowrap">Own punctuality</th>
                <th className="px-5 py-3 whitespace-nowrap">Leave</th>
                <th className="px-5 py-3 text-center whitespace-nowrap">KPI score</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(k => (
                <tr key={k.s.id} onClick={() => setDetail(k)} className="cursor-pointer border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: k.s.colour }}>{k.s.initials}</span>
                      <div className="min-w-0"><p className="font-semibold text-slate-700">{k.s.name}</p><p className="text-[11px] text-slate-400">{k.s.dept}</p></div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center font-bold tabular-nums text-slate-600">{k.courses || <span className="text-slate-300">0</span>}</td>
                  <td className="px-5 py-3 text-center font-bold tabular-nums text-slate-600">{k.studentsTaught || <span className="text-slate-300">0</span>}</td>
                  <td className="px-5 py-3"><KpiCell value={k.submission} /></td>
                  <td className="px-5 py-3"><KpiCell value={k.cohort} /></td>
                  <td className="px-5 py-3"><KpiCell value={k.punctuality} /></td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{k.used}<span className="text-slate-300">/{k.allowance}d</span></td>
                  <td className="px-5 py-3 text-center">
                    {k.score == null ? <span className="text-slate-300">—</span> : <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-extrabold text-white shadow-sm tabular-nums" style={{ background: pctTone(k.score).colour }}>{k.score}</span>}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && <tr><td colSpan={8} className="px-5 py-10"><EmptyState Icon={Users} title="No staff yet" msg="Add staff members and assign them as course tutors to see KPIs." /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        <b>KPI score</b> is the mean of register submission, student attendance and own punctuality (whichever apply). Green ≥85% · amber 70–85% · red below. Click a row for the full breakdown.
      </p>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Staff KPI breakdown" width={560}>
        {detail && <StaffKpiDetail k={detail} store={store} />}
      </Modal>
    </>
  );
}

function StaffKpiDetail({ k, store }) {
  const today = todayISO();
  const moduleTotals = store.attendance?.moduleTotals || {};
  const metrics = [
    { label: "Register submission", value: k.submission, hint: `${k.taken}/${k.due} past registers taken` },
    { label: "Student attendance", value: k.cohort, hint: "mean across taught classes" },
    { label: "Own punctuality", value: k.punctuality, hint: `${k.days} check-in day${k.days === 1 ? "" : "s"} logged` },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white shadow-sm" style={{ background: k.s.colour }}>{k.s.initials}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-base font-extrabold" style={{ color: NAVY_DARK }}>{k.s.name}</p><p className="truncate text-xs text-slate-400">{k.s.role} · {k.s.dept}</p></div>
        {k.score != null && <span className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-extrabold text-white shadow" style={{ background: pctTone(k.score).colour }}>{k.score}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {metrics.map(m => (
          <div key={m.label} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{m.label}</p>
            <p className="text-lg font-extrabold tabular-nums" style={{ color: pctTone(m.value ?? null).colour }}>{fmtPct(m.value ?? null)}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{m.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Teaching load</p><p className="text-sm font-bold text-slate-700">{k.courses} course{k.courses === 1 ? "" : "s"} · {k.studentsTaught} students</p></div>
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Leave used</p><p className="text-sm font-bold text-slate-700">{k.used} of {k.allowance} days</p></div>
      </div>

      {k.mods.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Courses tutored</p>
          <div className="rounded-2xl ring-1 ring-slate-200/70">
            {k.mods.map((m, i) => {
              const mt = moduleTotals[m.id];
              const due = store.sessions.filter(x => x.moduleId === m.id && x.date <= today);
              const taken = due.filter(x => (x.markedCount || 0) > 0).length;
              const subPct = due.length ? Math.round((taken / due.length) * 100) : null;
              return (
                <div key={m.id} className={`flex items-center gap-3 px-3.5 py-2.5 ${i ? "border-t border-slate-100" : ""}`}>
                  <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}>{m.code.slice(0, 5)}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-700" title={m.name}>{m.name}</p><p className="text-[10px] text-slate-400">{m.studentCount} students · {taken}/{due.length} registers taken</p></div>
                  <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-extrabold tabular-nums ${pctTone(subPct).bg} ${pctTone(subPct).text}`}>{fmtPct(subPct)}</span>
                  <span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-extrabold tabular-nums ${pctTone(mt?.pct ?? null).bg} ${pctTone(mt?.pct ?? null).text}`}>{fmtPct(mt?.pct ?? null)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">Per course: register submission % · student attendance %.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-xs text-slate-400">Not assigned as a tutor on any course. Assign them on <b>Courses → Edit</b> to track teaching KPIs.</div>
      )}
    </div>
  );
}

/* ============================================================
   Dashboard: Staff — a directory of every staff member with a
   department filter, stats and full CRUD. Its own top-level tab.
   ============================================================ */
function AdminStaff({ store }) {
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ name: "", role: "", dept: "", email: "", allowance: 28, site: "" });
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");     // "" = all departments
  const [siteFilter, setSiteFilter] = useState("");     // "" = all sites
  const [hoursStaff, setHoursStaff] = useState(null);   // staff whose monthly-hours breakdown is open
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const month = monthOf(todayISO());                    // current "YYYY-MM" for the hours column

  const depts = Array.from(new Set(store.staff.map(s => s.dept).filter(Boolean))).sort();
  const deptOptions = Array.from(new Set([...depts, "Sixth Form", "Tuition Centre", "Exam Centre", "Administration", "Higher Education"])).sort();

  const openAdd = () => { setEdit(null); setForm({ name: "", role: "", dept: (deptFilter || depts[0] || "Sixth Form"), email: "", allowance: 28, site: (siteFilter || "") }); setModal(true); };
  const openEdit = (s) => { setEdit(s); setForm({ name: s.name, role: s.role || "", dept: s.dept || "", email: s.email, allowance: s.allowance, site: s.site || "" }); setModal(true); };
  const save = async () => {
    if (!form.name.trim()) return;
    try {
      if (edit) await store.updateStaff(edit.id, { name: form.name, role: form.role, dept: form.dept, email: form.email, allowance: Number(form.allowance), site: form.site || null });
      else await store.addStaff({ name: form.name, role: form.role, dept: form.dept, email: form.email, allowance: Number(form.allowance), site: form.site || null });
      setModal(false);
    } catch (_e) { /* toast shown by the store; keep the modal open */ }
  };
  const confirmRemove = async () => {
    setDeleteBusy(true);
    try { await store.removeStaff(deleteTarget.id); setDeleteTarget(null); }
    catch (_) { /* store already toasted and refetched */ }
    finally { setDeleteBusy(false); }
  };

  const ql = query.trim().toLowerCase();
  const filtered = store.staff.filter(s => {
    if (deptFilter && s.dept !== deptFilter) return false;
    if (siteFilter && s.site !== siteFilter) return false;
    return !ql || s.name.toLowerCase().includes(ql) || (s.email || "").toLowerCase().includes(ql) || (s.role || "").toLowerCase().includes(ql) || (s.dept || "").toLowerCase().includes(ql);
  });
  const paged = usePaged(filtered, 12, `${ql}|${deptFilter}|${siteFilter}`);

  const total = store.staff.length;
  const adminCount = store.staff.filter(s => s.accountRole === "ADMIN").length;
  const avgAllowance = total ? Math.round(store.staff.reduce((a, s) => a + (s.allowance || 0), 0) / total) : 0;
  const deptCount = (d) => store.staff.filter(s => s.dept === d).length;

  const exportStaff = () => {
    downloadCSV("staff.csv", [
      { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role" },
      { key: "dept", label: "Department" }, { key: "site", label: "Site" }, { key: "hours", label: `Hours (${monthLabel(month)})` },
      { key: "account", label: "Account role" }, { key: "allowance", label: "Allowance (days)" },
      { key: "twoStep", label: "2-step verification" },
    ], filtered.map(s => ({
      name: s.name, email: s.email, role: s.role, dept: s.dept, site: s.site || "",
      account: s.isSuperAdmin ? "Super Admin" : s.accountRole === "ADMIN" ? (s.adminPages == null ? "Admin (full access)" : `Admin (${s.adminPages.length} pages)`) : "Staff",
      hours: fmtDuration(monthlyHoursFor(store.checkins, s.id, month).totalMin),
      allowance: s.allowance, twoStep: s.totpEnabled ? "On" : s.totpRequired ? "Setup due" : "Off",
    })));
    store.notify(`Exported staff CSV${deptFilter ? ` — ${deptFilter}` : ""}`);
  };

  // The department filter pills: All + each department (with its count).
  const chips = [{ id: "", label: "All departments", n: total }, ...depts.map(d => ({ id: d, label: d, n: deptCount(d) }))];

  return (
    <>
      <AdminHeader
        title="Staff"
        subtitle="Everyone on the team — filter by department"
        Icon={Users}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ExportBtn onClick={exportStaff} label="Export" />
            <PrimaryBtn onClick={openAdd}><UserPlus size={16} /> Add staff</PrimaryBtn>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total staff" value={total} sub="on the team" Icon={Users} tone={NAVY} delay={0} animate />
        <StatCard label="Departments" value={depts.length} sub="across the college" Icon={Building2} tone="#0d7a5f" delay={60} animate />
        <StatCard label="Administrators" value={adminCount} sub={`${total - adminCount} standard staff`} Icon={ShieldCheck} tone="#6d28d9" delay={120} animate />
        <StatCard label="Avg allowance" value={`${avgAllowance}d`} sub="holiday per person" Icon={Award} tone="#b45309" delay={180} animate />
      </div>

      {/* Department filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {chips.map(c => {
          const active = deptFilter === c.id;
          return (
            <button key={c.id || "all"} onClick={() => setDeptFilter(c.id)}
              className={`press flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-sm ring-1 transition-all ${active ? "text-white ring-transparent" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"}`}
              style={active ? { background: NAVY } : {}}>
              {c.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500"}`}>{c.n}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <Search size={15} className="text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email or role…" className="w-48 bg-transparent text-sm outline-none sm:w-64" />
        </div>
        {/* Site filter — HND / FE / Online (staff pick their home site at sign-up). */}
        <div className="flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-slate-200">
          <MapPin size={15} className="text-slate-400" />
          <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className="bg-transparent text-sm font-medium text-slate-600 outline-none">
            <option value="">All sites</option>
            {HOME_SITES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <span className="ml-auto text-xs font-semibold text-slate-400">{filtered.length} of {total}</span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Site</th><th className="px-5 py-3 whitespace-nowrap">Hours ({monthLabel(month).split(" ")[0]})</th><th className="px-5 py-3 whitespace-nowrap">Account</th><th className="px-5 py-3 whitespace-nowrap">Allowance</th><th className="px-5 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {paged.slice.map(s => (
                <tr key={s.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: s.colour }}>{s.initials}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-700">{s.name}</p>
                        <p className="max-w-[200px] truncate text-[11px] text-slate-400" title={s.email}>{s.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{s.role || "—"}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{s.dept || "—"}</span>
                  </td>
                  <td className="px-5 py-3">
                    {s.site
                      ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 ring-1 ring-blue-100">{s.site}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    {(() => {
                      const h = monthlyHoursFor(store.checkins, s.id, month);
                      if (h.totalMin <= 0) return <span className="text-slate-300">—</span>;
                      return (
                        <button onClick={() => setHoursStaff(s)} title="See the weekly breakdown" className="press inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-700 ring-1 ring-emerald-100 transition hover:bg-emerald-100">
                          <Timer size={12} /> {fmtDuration(h.totalMin)}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-5 py-3">
                    {s.isSuperAdmin
                      ? <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: MAROON }}><ShieldCheck size={11} /> Super Admin</span>
                      : s.accountRole === "ADMIN"
                        ? <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-bold text-indigo-700">Admin · {s.adminPages == null ? "full access" : `${s.adminPages.length} page${s.adminPages.length === 1 ? "" : "s"}`}</span>
                        : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">Staff</span>}
                  </td>
                  <td className="px-5 py-3 font-medium tabular-nums text-slate-600">{s.allowance}d</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1 whitespace-nowrap">
                      <button onClick={() => openEdit(s)} title="Edit staff" className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><Edit3 size={15} /></button>
                      <button onClick={() => setDeleteTarget(s)} title="Remove staff" className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {paged.slice.length === 0 && <tr><td colSpan={8} className="px-5 py-10"><EmptyState Icon={Users} title={total === 0 ? "No staff yet" : "No staff match"} msg={total === 0 ? "Add your first staff member." : (deptFilter || siteFilter) ? `No staff match this filter. Try another.` : "Try a different search."} /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />

      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit staff" : "Add staff"}>
        <div className="space-y-3">
          <Field label="Full name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Jane Doe" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role / job title"><input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Lecturer" className={inputCls} /></Field>
            <Field label="Department">
              <select value={form.dept} onChange={e => setForm(f => ({ ...f, dept: e.target.value }))} className={inputCls}>
                {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Email address"><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@lbc.ac.uk" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Site"><select value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} className={inputCls}><option value="">Not set</option>{HOME_SITES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Holiday allowance (days)"><input type="number" min={0} value={form.allowance} onChange={e => setForm(f => ({ ...f, allowance: e.target.value }))} className={inputCls} /></Field>
          </div>
          {!edit && <p className="text-[11px] text-slate-400">The new account is created inactive — they get an email invitation to set their own password before they can sign in.</p>}
          <PrimaryBtn onClick={save} disabled={!form.name.trim() || !form.email.trim()} className="w-full"><Save size={16} /> {edit ? "Save changes" : "Add staff"}</PrimaryBtn>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => !deleteBusy && setDeleteTarget(null)} title="Remove staff member">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: deleteTarget?.colour }}>{deleteTarget?.initials}</span>
            <div><p className="text-sm font-bold text-slate-700">{deleteTarget?.name}</p><p className="text-[11px] text-slate-400">{deleteTarget?.role} · {deleteTarget?.dept}</p></div>
          </div>
          <p className="flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-200">
            <AlertCircle size={13} className="mt-px shrink-0" />
            This permanently deletes their account <b>and their entire history</b> — leave, check-ins, balance adjustments and notifications. It cannot be undone.
          </p>
          <PrimaryBtn colour={MAROON} onClick={confirmRemove} disabled={deleteBusy} className="w-full"><Trash2 size={16} /> {deleteBusy ? "Removing…" : `Remove ${deleteTarget?.name || ""}`}</PrimaryBtn>
          <button onClick={() => setDeleteTarget(null)} disabled={deleteBusy} className="press w-full text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">Cancel</button>
        </div>
      </Modal>

      {/* Monthly hours breakdown — opened by clicking a staff member's hours pill. */}
      <Modal open={!!hoursStaff} onClose={() => setHoursStaff(null)} title={`Hours worked — ${hoursStaff?.name || ""}`}>
        {hoursStaff && (() => {
          const h = monthlyHoursFor(store.checkins, hoursStaff.id, month);
          const fmtWk = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          const weekEnd = (iso) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); };
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3.5 py-3 ring-1 ring-emerald-100">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">{monthLabel(month)}</p>
                  <p className="text-[11px] text-emerald-700/70">{h.countedDays} day{h.countedDays === 1 ? "" : "s"} counted</p>
                </div>
                <span className="text-xl font-extrabold text-emerald-700">{fmtDuration(h.totalMin)}</span>
              </div>
              <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Per week (from check-in → check-out)</p>
              {h.weekList.length === 0 && <EmptyState Icon={Timer} title="Nothing to show yet" msg="Hours appear once a check-in has a matching check-out this month." />}
              {h.weekList.map(w => (
                <div key={w.monday} className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-100">
                  <span className="text-sm font-semibold text-slate-600">{fmtWk(w.monday)} – {fmtWk(weekEnd(w.monday))}</span>
                  <span className="text-sm font-bold tabular-nums text-slate-700">{fmtDuration(w.min)}</span>
                </div>
              ))}
              {h.openDays > 0 && (
                <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-100">
                  <AlertCircle size={13} className="mt-px shrink-0" />
                  {h.openDays} day{h.openDays === 1 ? "" : "s"} this month {h.openDays === 1 ? "has" : "have"} a check-in but no check-out, so {h.openDays === 1 ? "it is" : "they are"} not included in these hours.
                </p>
              )}
            </div>
          );
        })()}
      </Modal>
    </>
  );
}

function AdminSettings({ store }) {
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ name: "", role: "", dept: "Sixth Form", email: "", allowance: 28 });
  const depts = Array.from(new Set(store.staff.map(s => s.dept)));
  const deptOptions = Array.from(new Set([...depts, "Sixth Form", "Tuition Centre", "Exam Centre", "Administration", "Higher Education"])).sort();
  const openAdd = () => { setEdit(null); setForm({ name: "", role: "", dept: depts[0] || "Sixth Form", email: "", allowance: 28 }); setModal(true); };
  const openEdit = (s) => { setEdit(s); setForm({ name: s.name, role: s.role, dept: s.dept, email: s.email, allowance: s.allowance }); setModal(true); };
  const save = async () => {
    if (!form.name.trim()) return;
    if (edit) await store.updateStaff(edit.id, { name: form.name, role: form.role, dept: form.dept, email: form.email, allowance: Number(form.allowance) });
    else await store.addStaff({ name: form.name, role: form.role, dept: form.dept, email: form.email, allowance: Number(form.allowance) });
    setModal(false);
  };
  // Deleting a staff member cascades their entire history — leave, check-ins,
  // balance adjustments, notifications — with no undo. A single misclick in a
  // twelve-row table should not be able to do that, so confirm first.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const resendInvite = async (s) => {
    try { const r = await api.resendInvite(s.id); store.notify(r?.message || `Invitation re-sent to ${s.email}`); }
    catch (e) { store.notify(e.message || "Could not re-send the invitation", "error"); }
  };
  const confirmRemove = async () => {
    setDeleteBusy(true);
    try { await store.removeStaff(deleteTarget.id); setDeleteTarget(null); }
    catch (_) { /* store already toasted and refetched */ }
    finally { setDeleteBusy(false); }
  };
  // Two-step verification reset — the recovery path for a lost or replaced phone.
  const [resetTarget, setResetTarget] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const confirmReset = async () => {
    setResetBusy(true);
    try { await store.resetStaffTotp(resetTarget.id); setResetTarget(null); }
    catch (_) { /* store already toasted the error and refetched */ }
    finally { setResetBusy(false); }
  };
  const [query, setQuery] = useState("");
  const ql = query.trim().toLowerCase();
  const filteredStaff = store.staff.filter(s => !ql || s.name.toLowerCase().includes(ql) || (s.email || "").toLowerCase().includes(ql) || (s.role || "").toLowerCase().includes(ql) || (s.dept || "").toLowerCase().includes(ql));
  const paged = usePaged(filteredStaff, 12, ql);
  const exportStaff = () => {
    const rows = store.staff.map(s => ({
      name: s.name, email: s.email, role: s.role, dept: s.dept, allowance: s.allowance,
      twoStep: s.totpEnabled ? "On" : s.totpRequired ? "Setup due" : "Off",
    }));
    downloadCSV("staff.csv", [
      { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role" }, { key: "dept", label: "Dept" }, { key: "allowance", label: "Allowance" },
      { key: "twoStep", label: "2-step verification" },
    ], rows);
    store.notify("Exported staff CSV");
  };
  return (
    <>
      <AdminHeader title="Settings" subtitle="Manage staff members and departments" Icon={Settings} action={<div className="flex flex-wrap items-center gap-2"><ExportBtn onClick={exportStaff} label="Export staff" /><PrimaryBtn onClick={openAdd}><UserPlus size={16} /> Add staff</PrimaryBtn></div>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200"><Search size={15} className="text-slate-400" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email, role or dept…" className="w-full bg-transparent text-sm outline-none" /></div>
          <div className="overflow-x-auto overflow-y-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 fade-up [-webkit-overflow-scrolling:touch] md:overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400"><tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Dept</th><th className="px-5 py-3">Allowance</th><th className="px-5 py-3">2-Step</th><th className="px-5 py-3"></th></tr></thead>
              <tbody>
                {paged.slice.map(s => (
                  <tr key={s.id} className="border-t border-slate-100 transition-colors duration-150 hover:bg-blue-50/40">
                    <td className="px-5 py-3"><div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm" style={{ background: s.colour }}>{s.initials}</span><div><p className="font-semibold text-slate-700">{s.name}</p><p className="text-[11px] text-slate-400">{s.email}</p></div></div></td>
                    <td className="px-5 py-3 text-slate-500">{s.role}</td><td className="px-5 py-3 text-slate-500">{s.dept}</td><td className="px-5 py-3 font-medium text-slate-600">{s.allowance}d</td>
                    <td className="px-5 py-3">{twoStepBadge(s)}</td>
                    <td className="px-5 py-3"><div className="flex gap-1">
                      {s.pendingActivation && <button onClick={() => resendInvite(s)} title="Re-send the invitation email" className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Mail size={15} /></button>}
                      {s.totpEnabled && <button onClick={() => setResetTarget(s)} title="Reset two-step verification" className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"><ShieldCheck size={15} /></button>}
                      <button onClick={() => openEdit(s)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Edit3 size={15} /></button>
                      <button onClick={() => setDeleteTarget(s)} title="Remove staff member" className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={15} /></button>
                    </div></td>
                  </tr>
                ))}
                {paged.slice.length === 0 && <tr><td colSpan={6} className="px-5 py-10"><EmptyState Icon={Search} title="No staff match" msg="Try a different search term." /></td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination className="mt-4" page={paged.page} setPage={paged.setPage} totalPages={paged.totalPages} total={paged.total} />
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up">
            <div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-1.5 text-sm font-bold text-slate-700"><Building2 size={15} /> Departments</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{depts.length}</span></div>
            <div className="space-y-2.5">{depts.map((d, i) => { const n = store.staff.filter(s => s.dept === d).length; const total = store.staff.length; const pct = total > 0 ? Math.round((n / total) * 100) : 0; const c = PALETTE[i % PALETTE.length]; return (
              <div key={d} className="rounded-xl bg-slate-50 px-3 py-2 transition-all duration-200 hover:translate-x-1 hover:bg-slate-100">
                <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold text-slate-700"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{d}</span><span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500">{n}</span></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white shadow-inner"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: c, transition: "width .8s cubic-bezier(.4,0,.2,1)" }} /></div>
              </div>
            ); })}</div>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70 fade-up">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-700"><Award size={15} style={{ color: MAROON }} /> At a glance</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 py-2.5"><p className="text-lg font-extrabold" style={{ color: NAVY }}>{store.staff.length}</p><p className="text-[10px] text-slate-400">Staff</p></div>
              <div className="rounded-xl bg-slate-50 py-2.5"><p className="text-lg font-extrabold" style={{ color: NAVY }}>{depts.length}</p><p className="text-[10px] text-slate-400">Departments</p></div>
              <div className="rounded-xl bg-slate-50 py-2.5"><p className="text-lg font-extrabold" style={{ color: NAVY }}>{store.staff.length > 0 ? Math.round(store.staff.reduce((a, s) => a + (s.allowance || 0), 0) / store.staff.length) : 0}d</p><p className="text-[10px] text-slate-400">Avg allowance</p></div>
              <div className="rounded-xl bg-slate-50 py-2.5"><p className="text-lg font-extrabold" style={{ color: NAVY }}>{store.docs.length}</p><p className="text-[10px] text-slate-400">Documents</p></div>
            </div>
          </div>
          <div className="animated-gradient relative overflow-hidden rounded-2xl p-5 text-white shadow-md transition-all duration-300 hover:shadow-xl fade-up" style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 45%, ${MAROON} 130%)`, backgroundSize: "200% 200%" }}><Building2 size={64} className="float-slow absolute -right-3 -top-3 text-white/10" /><div className="relative mb-2 flex h-9 w-12 items-center justify-center rounded-md bg-white"><Logo small /></div><p className="relative text-sm font-bold">London Brookes College</p><p className="relative mt-1 flex items-center gap-1.5 text-xs text-white/70"><MapPin size={12} /> 42 The Burroughs, London NW4 4AP</p><p className="relative flex items-center gap-1.5 text-xs text-white/70"><Phone size={12} /> 020 8202 2007</p><p className="relative mt-3 text-[11px] text-white/50">Staff Hub Admin Console v2.0</p><p className="relative text-[11px] text-white/50">© 2026 Syed Muhammad Raza</p></div>
        </div>
      </div>
      <Modal open={!!deleteTarget} onClose={() => !deleteBusy && setDeleteTarget(null)} title="Remove staff member">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: deleteTarget?.colour }}>{deleteTarget?.initials}</span>
            <div><p className="text-sm font-bold text-slate-700">{deleteTarget?.name}</p><p className="text-[11px] text-slate-400">{deleteTarget?.role} · {deleteTarget?.dept}</p></div>
          </div>
          <p className="flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-200">
            <AlertCircle size={13} className="mt-px shrink-0" />
            This permanently deletes their account <b>and their entire history</b> — leave requests,
            check-ins, balance adjustments and notifications. It cannot be undone.
          </p>
          <PrimaryBtn colour={MAROON} onClick={confirmRemove} disabled={deleteBusy} className="w-full">
            <Trash2 size={16} /> {deleteBusy ? "Removing…" : `Remove ${deleteTarget?.name || ""}`}
          </PrimaryBtn>
          <button onClick={() => setDeleteTarget(null)} disabled={deleteBusy} className="press w-full text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">Cancel</button>
        </div>
      </Modal>
      <Modal open={!!resetTarget} onClose={() => !resetBusy && setResetTarget(null)} title="Reset two-step verification">
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: resetTarget?.colour }}>{resetTarget?.initials}</span>
            <div><p className="text-sm font-bold text-slate-700">{resetTarget?.name}</p><p className="text-[11px] text-slate-400">{resetTarget?.email}</p></div>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Use this when someone has lost or replaced the phone holding their authenticator app.
            Their existing codes stop working immediately.
          </p>
          <p className="flex items-start gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-700 ring-1 ring-blue-100">
            <ShieldCheck size={13} className="mt-px shrink-0" />
            {resetTarget?.totpRequired
              ? "Two-step verification is required for this account, so they'll be asked to set up a new authenticator the next time they sign in."
              : "This account will sign in with just a password until they choose to turn two-step verification back on."}
          </p>
          <p className="text-[11px] text-slate-400">Their password is not changed, so this on its own doesn't let anyone in.</p>
          <PrimaryBtn colour="#b45309" onClick={confirmReset} disabled={resetBusy} className="w-full">
            <ShieldCheck size={16} /> {resetBusy ? "Resetting…" : "Reset two-step verification"}
          </PrimaryBtn>
        </div>
      </Modal>
      <Modal open={modal} onClose={() => setModal(false)} title={edit ? "Edit staff member" : "Add staff member"}>
        <div className="space-y-3">
          <Field label="Full name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Maria Gonzalez" className={inputCls} /></Field>
          <Field label="Role"><input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="e.g. Physics Teacher" className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Department"><select value={form.dept} onChange={e => setForm(f => ({ ...f, dept: e.target.value }))} className={inputCls}>{deptOptions.map(d => <option key={d}>{d}</option>)}</select></Field><Field label="Allowance (days)"><input type="number" value={form.allowance} onChange={e => setForm(f => ({ ...f, allowance: e.target.value }))} className={inputCls} /></Field></div>
          <Field label="Email"><input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@lbc.ac.uk" className={inputCls} /></Field>
          <PrimaryBtn onClick={save} disabled={!form.name.trim()} className="w-full"><Save size={16} /> {edit ? "Save changes" : "Add staff member"}</PrimaryBtn>
        </div>
      </Modal>
    </>
  );
}
