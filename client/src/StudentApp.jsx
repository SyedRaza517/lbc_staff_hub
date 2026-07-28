import React, { useState, useEffect, useCallback } from "react";
import PhoneShell from "./PhoneShell";
import { BrandMark } from "./Brand";
import ConfirmDialog from "./ConfirmDialog";
import { useBackHandler } from "./backButton";
import { api, setToken } from "./api";
import {
  GraduationCap, Percent, Award, MessageSquare, LogOut, ChevronLeft,
  Loader2, Send, CheckCircle2, ClipboardList, Info, BookOpen, ArrowRight,
  Settings, KeyRound, Lock, Trash2, AlertTriangle,
} from "lucide-react";

const NAVY = "#1a3a8f";
const NAVY_DARK = "#14306f";
const MAROON = "#9e1b32";
const fmtPct = (p) => (p == null ? "—" : `${p}%`);
const pctTone = (p) => p == null ? { bg: "bg-slate-100", text: "text-slate-400", colour: "#94a3b8" }
  : p >= 85 ? { bg: "bg-emerald-100", text: "text-emerald-700", colour: "#059669" }
    : p >= 70 ? { bg: "bg-amber-100", text: "text-amber-700", colour: "#d97706" }
      : { bg: "bg-rose-100", text: "text-rose-700", colour: "#e11d48" };
const fmtDate = (iso) => { if (!iso) return null; const [y, m, d] = iso.split("-"); const mm = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1] || m; return `${Number(d)} ${mm} ${y}`; };
const ATT = [{ key: "P", label: "Present", colour: "#059669" }, { key: "L", label: "Late", colour: "#d97706" }, { key: "E", label: "Excused", colour: "#7c3aed" }, { key: "A", label: "Absent", colour: "#e11d48" }];

const Screen = ({ children }) => <div className="space-y-3 p-4">{children}</div>;
const Card = ({ children, className = "" }) => <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 ${className}`}>{children}</div>;
const Loading = () => <div className="flex justify-center p-10"><Loader2 className="animate-spin text-slate-300" size={28} /></div>;
const ErrBox = ({ children }) => <Card className="!bg-rose-50 !ring-rose-200 text-sm font-semibold text-rose-600">{children}</Card>;

export default function StudentApp({ user, logout }) {
  const [screen, setScreen] = useState("home");
  const [queries, setQueries] = useState([]);
  // Android back returns to the home screen from any sub-screen.
  useBackHandler(screen !== "home", () => { setScreen("home"); return true; });

  // This student's own queries (the server scopes /me/queries to them). Used both by
  // the query screen and to badge the home tile when the college has replied.
  const loadQueries = useCallback(() => { api.studentQueries().then(setQueries).catch(() => {}); }, []);
  useEffect(() => { loadQueries(); }, [loadQueries]);
  useEffect(() => { if (screen === "home") loadQueries(); }, [screen, loadQueries]);

  // "New reply" badge: answered queries this student hasn't opened yet. Seen-state is
  // kept per student in localStorage, so it's entirely personal to them.
  const seenKey = `lbc_seen_replies_${user.id}`;
  const answered = queries.filter(q => q.status === "answered");
  let seen = new Set();
  try { seen = new Set(JSON.parse(localStorage.getItem(seenKey) || "[]")); } catch (_) { /* ignore */ }
  const newReplies = answered.filter(q => !seen.has(q.id)).length;
  useEffect(() => {
    if (screen === "query" && answered.length) {
      try { localStorage.setItem(seenKey, JSON.stringify(answered.map(q => q.id))); } catch (_) { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, queries]);

  const title = { home: "Student Hub", attendance: "My Attendance", assessments: "My Results", query: "Ask the College", more: "More" }[screen];
  return (
    <PhoneShell header={<Header title={title} screen={screen} setScreen={setScreen} user={user} />}>
      {screen === "home" && <Home setScreen={setScreen} user={user} newReplies={newReplies} />}
      {screen === "attendance" && <AttendanceScreen />}
      {screen === "assessments" && <AssessmentsScreen />}
      {screen === "query" && <QueryScreen queries={queries} reload={loadQueries} />}
      {screen === "more" && <MoreScreen user={user} logout={logout} />}
    </PhoneShell>
  );
}

function Header({ title, screen, setScreen, user }) {
  return (
    <div className="relative z-20 pt-2" style={{ background: `linear-gradient(160deg, ${NAVY} 0%, ${NAVY_DARK} 100%)` }}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        {screen !== "home"
          ? <button onClick={() => setScreen("home")} aria-label="Back" className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><ChevronLeft size={22} /></button>
          : <div className="flex h-11 w-12 shrink-0 items-center justify-center rounded-md bg-white px-1"><BrandMark size={26} /></div>}
        <div className="min-w-0 flex-1 text-center"><h1 className="truncate text-lg font-extrabold tracking-wide text-white">{title}</h1></div>
        {screen === "home"
          ? <button onClick={() => setScreen("more")} aria-label="More" className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><Settings size={18} /></button>
          : <div className="h-11 w-11 shrink-0" />}
      </div>
      {screen === "home" && (
        <div className="px-4 pb-5">
          <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white shadow-lg ring-2 ring-white/20" style={{ background: user.colour || MAROON }}>{user.initials || "S"}</div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-white/70">Welcome</p>
              <p className="truncate text-[15px] font-bold text-white">{user.name}</p>
              <p className="truncate text-[11px] text-white/60">{user.studentRef ? `Student · ${user.studentRef}` : "Student"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Home({ setScreen, user, newReplies = 0 }) {
  const tiles = [
    { key: "attendance", label: "My Attendance", sub: "Your attendance by module", Icon: Percent, c: NAVY },
    { key: "assessments", label: "My Results", sub: "Assessments & grades", Icon: Award, c: "#0d7a5f" },
    { key: "query", label: "Ask the College", sub: newReplies > 0 ? `${newReplies} new repl${newReplies === 1 ? "y" : "ies"}` : "Send a query to admin", Icon: MessageSquare, c: MAROON, badge: newReplies },
    { key: "more", label: "More", sub: "Password, account & sign out", Icon: Settings, c: "#5b6472" },
  ];
  return (
    <Screen>
      <p className="px-1 text-xs font-bold uppercase tracking-wide text-slate-400">What would you like to do?</p>
      <div className="space-y-2.5">
        {tiles.map(({ key, label, sub, Icon, c, badge }) => (
          <button key={key} onClick={() => setScreen(key)} className="press flex w-full items-center gap-3.5 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: c }}>
              <Icon size={22} />
              {badge > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900 ring-2 ring-white">{badge}</span>}
            </span>
            <div className="flex-1"><p className="text-sm font-extrabold text-slate-700">{label}</p><p className={`text-[11px] ${badge > 0 ? "font-bold text-amber-600" : "text-slate-400"}`}>{sub}</p></div>
            <ArrowRight size={18} className="text-slate-300" />
          </button>
        ))}
      </div>
    </Screen>
  );
}

/* -------- Attendance -------- */
function ModuleAtt({ mr, ended }) {
  const s = mr.summary; const t = pctTone(s.pct);
  return (
    <div className="flex items-center gap-3 border-t border-slate-100 px-3.5 py-2.5 first:border-t-0">
      <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}>{(mr.module.code || "?").slice(0, 5)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-slate-700" title={mr.module.name}>{mr.module.name}</p>
        {ended
          ? <p className="mt-0.5 text-[10px] font-medium text-slate-400">Ended {fmtDate(mr.endDate)}</p>
          : <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${s.pct ?? 0}%`, background: t.colour }} /></div>}
      </div>
      <span className="shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">{s.marked} marked</span>
      <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${t.bg} ${t.text}`}>{fmtPct(s.pct)}</span>
    </div>
  );
}
function AttendanceScreen() {
  const [data, setData] = useState(null); const [err, setErr] = useState("");
  useEffect(() => { let off = false; api.studentAttendance().then(d => !off && setData(d)).catch(e => !off && setErr(e.message || "Could not load attendance")); return () => { off = true; }; }, []);
  if (err) return <Screen><ErrBox>{err}</ErrBox></Screen>;
  if (!data) return <Loading />;
  const cur = data.current || { modules: [], overall: {} };
  const o = cur.overall || {}; const tone = pctTone(o.pct);
  const R = 42, C = 2 * Math.PI * R;
  return (
    <Screen>
      <Card className="!bg-slate-50 ring-emerald-200">
        <p className="mb-3 text-sm font-extrabold text-slate-800">Current modules · overall</p>
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90"><circle cx="60" cy="60" r={R} fill="none" stroke="#e2e8f0" strokeWidth="12" /><circle cx="60" cy="60" r={R} fill="none" stroke={tone.colour} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C}`} strokeDashoffset={`${C * (1 - (o.pct ?? 0) / 100)}`} style={{ transition: "stroke-dashoffset 1s ease" }} /></svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-extrabold tabular-nums" style={{ color: tone.colour }}>{fmtPct(o.pct)}</span><span className="text-[10px] text-slate-400">overall</span></div>
          </div>
          <div className="grid flex-1 grid-cols-4 gap-1.5 text-center">
            {ATT.map(a => <div key={a.key} className="rounded-lg py-1.5" style={{ background: a.colour + "12" }}><p className="text-sm font-extrabold tabular-nums" style={{ color: a.colour }}>{o[a.key] ?? 0}</p><p className="text-[9px] text-slate-400">{a.label}</p></div>)}
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
          {cur.modules.map(mr => <ModuleAtt key={mr.module.id} mr={mr} />)}
          {cur.modules.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-400">No current modules yet.</p>}
        </div>
      </Card>
      {data.previous && data.previous.length > 0 && (
        <div>
          <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Previous modules · {data.previous.length}</p>
          <Card className="!p-0 overflow-hidden">{data.previous.map(mr => <ModuleAtt key={mr.module.id} mr={mr} ended />)}</Card>
        </div>
      )}
      <p className="px-1 text-[11px] text-slate-400">P = Present (2) · L = Late (1) · E = Excused (1) · A = Absent (0). Only marked sessions count.</p>
    </Screen>
  );
}

/* -------- Assessments -------- */
function AssessmentsScreen() {
  const [data, setData] = useState(null); const [err, setErr] = useState("");
  useEffect(() => { let off = false; api.studentAssessments().then(d => !off && setData(d)).catch(e => !off && setErr(e.message || "Could not load results")); return () => { off = true; }; }, []);
  if (err) return <Screen><ErrBox>{err}</ErrBox></Screen>;
  if (!data) return <Loading />;
  const tone = pctTone(data.averagePct);
  return (
    <Screen>
      <Card className="text-center">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Overall average</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums" style={{ color: tone.colour }}>{fmtPct(data.averagePct)}</p>
        <p className="text-sm font-bold" style={{ color: tone.colour }}>{data.averageGrade || "Not graded yet"}</p>
        <p className="mt-1 text-[11px] text-slate-400">{data.graded} of {data.count} assessment{data.count === 1 ? "" : "s"} graded</p>
      </Card>
      <div className="space-y-2">
        {data.assessments.map(a => { const t = pctTone(a.pct); return (
          <Card key={a.id} className="!p-3.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-11 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DARK})` }}>{(a.moduleCode || "?").slice(0, 5)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-700">{a.title}</p>
                <p className="truncate text-[11px] text-slate-400">{a.moduleName} · {a.type}{a.dueDate ? ` · due ${fmtDate(a.dueDate)}` : ""}</p>
              </div>
              {a.marks == null
                ? <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-400">Pending</span>
                : <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold tabular-nums ${t.bg} ${t.text}`}>{a.marks}/{a.maxMarks} · {a.grade}</span>}
            </div>
            {a.feedback ? <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">{a.feedback}</p> : null}
          </Card>
        ); })}
        {data.assessments.length === 0 && <Card className="text-center"><p className="py-6 text-xs text-slate-400">No assessments assigned yet.</p></Card>}
      </div>
    </Screen>
  );
}

/* -------- Query to admin (two-way) -------- */
function QueryScreen({ queries = [], reload }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr(""); setOk(false);
    if (message.trim().length < 3) { setErr("Please write your query."); return; }
    setBusy(true);
    try { await api.submitStudentQuery(subject.trim() || "Student query", message.trim()); setSubject(""); setMessage(""); setOk(true); reload && reload(); }
    catch (e) { setErr(e.message || "Could not send your query."); }
    finally { setBusy(false); }
  };
  return (
    <Screen>
      <Card>
        <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-slate-500"><Info size={13} className="shrink-0 text-blue-500" /> Send a question to the college. They'll reply, and you'll see it here.</p>
        <div className="mt-3">
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} disabled={busy} placeholder="e.g. Attendance query" className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ "--tw-ring-color": NAVY }} />
        </div>
        <div className="mt-3">
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Your query</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} disabled={busy} rows={5} placeholder="Write your question or request here…" className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2" style={{ "--tw-ring-color": NAVY }} />
        </div>
        {ok && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Sent — the college will reply below.</p>}
        {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{err}</p>}
        <button onClick={submit} disabled={busy} className="press mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white shadow-lg disabled:opacity-60" style={{ background: `linear-gradient(135deg, ${NAVY}, ${MAROON})` }}>
          {busy ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : <><Send size={16} /> Send to college</>}
        </button>
      </Card>

      <p className="px-1 pt-1 text-xs font-bold uppercase tracking-wide text-slate-400">Your queries</p>
      {queries.length === 0 && <Card className="text-center"><p className="py-6 text-xs text-slate-400">You haven't sent any queries yet.</p></Card>}
      {queries.map(q => (
        <Card key={q.id} className="!p-3.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-700">{q.subject}</p><p className="text-[10px] text-slate-400">{fmtDate(String(q.createdAt).slice(0, 10))}</p></div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${q.status === "open" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{q.status === "open" ? "Awaiting reply" : "Answered"}</span>
          </div>
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{q.message}</p>
          {q.response
            ? <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 ring-1 ring-blue-100"><p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-500">College reply{q.respondedAt ? ` · ${fmtDate(q.respondedAt)}` : ""}</p>{q.response}</div>
            : <p className="mt-2 text-[11px] text-slate-400">Awaiting a reply from the college.</p>}
        </Card>
      ))}
    </Screen>
  );
}

/* -------- More: profile · change password · sign out · delete account -------- */
function MoreScreen({ user, logout }) {
  const [confirmOut, setConfirmOut] = useState(false);
  // change password
  const [cur, setCur] = useState(""); const [nw, setNw] = useState(""); const [cf, setCf] = useState("");
  const [pwBusy, setPwBusy] = useState(false); const [pwOk, setPwOk] = useState(false); const [pwErr, setPwErr] = useState("");
  const changePw = async () => {
    setPwErr(""); setPwOk(false);
    if (nw.length < 8) { setPwErr("New password must be at least 8 characters."); return; }
    if (nw !== cf) { setPwErr("New passwords do not match."); return; }
    setPwBusy(true);
    try { const res = await api.changePassword(cur, nw); if (res?.token) setToken(res.token); setCur(""); setNw(""); setCf(""); setPwOk(true); }
    catch (e) { setPwErr(e.message || "Could not change password."); }
    finally { setPwBusy(false); }
  };
  // delete account
  const [showDel, setShowDel] = useState(false);
  const [delPw, setDelPw] = useState(""); const [delConfirm, setDelConfirm] = useState("");
  const [delBusy, setDelBusy] = useState(false); const [delErr, setDelErr] = useState("");
  const del = async () => {
    setDelErr("");
    if (delConfirm.trim().toUpperCase() !== "DELETE") { setDelErr("Type DELETE to confirm."); return; }
    setDelBusy(true);
    try { await api.deleteAccount(delPw, delConfirm.trim().toUpperCase()); logout(); }
    catch (e) { setDelErr(e.message || "Could not delete account."); setDelBusy(false); }
  };

  const input = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2";
  return (
    <Screen>
      <ConfirmDialog open={confirmOut} title="Sign out?" message="You'll need to sign in again to get back in." confirmLabel="Sign out" cancelLabel="Stay" danger onConfirm={logout} onCancel={() => setConfirmOut(false)} />

      <Card className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl text-base font-bold text-white shadow-sm" style={{ background: user.colour || MAROON }}>{user.initials || "S"}</div>
        <div className="min-w-0"><p className="truncate text-sm font-extrabold text-slate-700">{user.name}</p><p className="truncate text-[11px] text-slate-400">{user.studentRef ? `${user.studentRef} \u00b7 ` : ""}{user.email}</p></div>
      </Card>

      <Card>
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400"><KeyRound size={13} /> Change password</p>
        <div className="mt-2 space-y-2">
          <input type="password" value={cur} onChange={e => setCur(e.target.value)} placeholder="Current password" className={input} style={{ "--tw-ring-color": NAVY }} />
          <input type="password" value={nw} onChange={e => setNw(e.target.value)} placeholder="New password (min 8)" className={input} style={{ "--tw-ring-color": NAVY }} />
          <input type="password" value={cf} onChange={e => setCf(e.target.value)} placeholder="Confirm new password" className={input} style={{ "--tw-ring-color": NAVY }} />
        </div>
        {pwOk && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Password updated.</p>}
        {pwErr && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{pwErr}</p>}
        <button onClick={changePw} disabled={pwBusy || !cur || !nw || !cf} className="press mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white shadow disabled:opacity-60" style={{ background: NAVY }}>
          {pwBusy ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Lock size={15} /> Update password</>}
        </button>
      </Card>

      <button onClick={() => setConfirmOut(true)} className="press flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white py-3 text-sm font-bold text-slate-600 transition hover:border-slate-300">
        <LogOut size={16} /> Sign out
      </button>

      <Card className="!ring-rose-200">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-500"><AlertTriangle size={13} /> Delete account</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Removes your app login only. Your college records (attendance, results) are kept — this just stops you signing in.</p>
        {!showDel
          ? <button onClick={() => setShowDel(true)} className="press mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-rose-200 py-2.5 text-sm font-bold text-rose-600 transition hover:bg-rose-50"><Trash2 size={15} /> Delete my account</button>
          : <div className="mt-3 space-y-2">
              <input type="password" value={delPw} onChange={e => setDelPw(e.target.value)} placeholder="Your password" className={input} style={{ "--tw-ring-color": "#e11d48" }} />
              <input value={delConfirm} onChange={e => setDelConfirm(e.target.value)} placeholder="Type DELETE to confirm" className={input} style={{ "--tw-ring-color": "#e11d48" }} />
              {delErr && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{delErr}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setShowDel(false); setDelErr(""); }} disabled={delBusy} className="press flex-1 rounded-xl border-2 border-slate-200 py-2.5 text-sm font-bold text-slate-600">Cancel</button>
                <button onClick={del} disabled={delBusy || !delPw} className="press flex-1 rounded-xl py-2.5 text-sm font-bold text-white shadow disabled:opacity-60" style={{ background: MAROON }}>{delBusy ? <Loader2 size={15} className="mx-auto animate-spin" /> : "Delete"}</button>
              </div>
            </div>}
      </Card>

      <p className="px-1 pt-1 text-center text-[11px] text-slate-300">London Brookes College · Student Hub</p>
    </Screen>
  );
}
