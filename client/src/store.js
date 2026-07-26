// API-backed store. Exposes the same data shape the UI components expect
// (staff, leave, checkins, docs, adjustments) plus async action methods.
// After each mutation we refetch the affected collection so both the
// staff app and the admin dashboard always reflect the live database.
import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "./api";

const daysBetween = (a, b) => { const d1 = new Date(a), d2 = new Date(b); if (isNaN(d1) || isNaN(d2)) { console.error("Invalid dates:", a, b); return 0; } return Math.max(1, Math.round((d2 - d1) / 86400000) + 1); };

export function useApiStore(notify, user) {
  const [staff, setStaff] = useState([]);
  const [leave, setLeave] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [docs, setDocs] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [signups, setSignups] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // HND registers. Loaded lazily by the admin page rather than on login —
  // staff users never open it, so there's no reason to fetch it for them.
  const [modules, setModules] = useState([]);
  const [students, setStudents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [unassignedSessions, setUnassignedSessions] = useState(0);
  const [attendance, setAttendance] = useState(null);
  const [hndLoaded, setHndLoaded] = useState(false);
  // PAT (Personal Academic Tutor) interactions. Admin-only; loaded lazily by the PAT page.
  const [interactions, setInteractions] = useState([]);
  const [interactionsLoaded, setInteractionsLoaded] = useState(false);
  // Assessments (gradebook). Admin-only; loaded lazily by the Assessments page.
  const [assessments, setAssessments] = useState([]);
  const [assessmentOverview, setAssessmentOverview] = useState(null);
  const [assessmentsLoaded, setAssessmentsLoaded] = useState(false);
  // Which teaching period the registers page is scoped to.
  // "" = all semesters; "unassigned" = sessions outside every semester.
  const [semesterId, setSemesterId] = useState("");

  const isAdmin = user?.accountRole === "ADMIN";

  const refresh = useCallback(async () => {
    try {
      const [st, lv, ci, dc, aj] = await Promise.all([
        api.listStaff(), api.listLeave(), api.listCheckins(), api.listDocuments(), api.listAdjustments(),
      ]);
      setStaff(st); setLeave(lv); setCheckins(ci); setDocs(dc); setAdjustments(aj);
      // Sign-up requests are admin-only AND now page-gated: a staff user, or an admin
      // without the "signups" page, would 403. Swallow that so it neither breaks the
      // rest of the load nor toasts an error on every 20s refresh — just leave it empty.
      if (isAdmin) {
        try { setSignups(await api.listSignups()); }
        catch (_) { setSignups([]); }
      }
    } catch (e) { notify?.(e.message || "Failed to load data", "error"); }
    setLoaded(true);
  }, [notify, isAdmin]);

  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  // Refetches everything the registers page shows, with attendance scoped to the
  // selected semester. Depends on semesterId, so changing the picker re-runs the
  // page's load effect and every figure rescopes together.
  const refreshHnd = useCallback(async () => {
    try {
      const [ms, st, se, sem, pr, at] = await Promise.all([
        api.listModules(), api.listStudents(), api.listSessions(), api.listSemesters(), api.listProgrammes(), api.getAttendance(semesterId),
      ]);
      setModules(ms); setStudents(st); setSessions(se);
      setSemesters(sem.semesters); setUnassignedSessions(sem.unassignedSessions);
      setProgrammes(pr);
      setAttendance(at);
    } catch (e) { notify?.(e.message || "Failed to load registers", "error"); }
    setHndLoaded(true);
  }, [notify, semesterId]);

  // derived
  // Every approved leave type counts against the allowance (sick included) — the
  // total is reduced by any approved leave, regardless of type.
  // Unpaid leave does not draw down the paid allowance, so it's excluded here (kept
  // in sync with the server's UNPAID_TYPES and the client's NON_ALLOWANCE_TYPES).
  const usedDays = useCallback((id) => leave.filter((l) => l.staffId === id && l.status === "approved" && l.type !== "unpaid").reduce((s, l) => s + (l.days ?? daysBetween(l.start, l.end)), 0), [leave]);
  const adjDays = useCallback((id) => adjustments.filter((a) => a.staffId === id).reduce((s, a) => s + a.days, 0), [adjustments]);
  const effectiveAllowance = useCallback((id) => { const s = staff.find((x) => x.id === id); return (s?.allowance || 0) + adjDays(id); }, [staff, adjDays]);

  const refreshInteractions = useCallback(async () => {
    try { setInteractions(await api.listInteractions()); }
    catch (e) { notify?.(e.message || "Failed to load interactions", "error"); }
    setInteractionsLoaded(true);
  }, [notify]);

  const refreshAssessments = useCallback(async () => {
    try {
      const [list, ov] = await Promise.all([api.listAssessments(), api.assessmentOverview()]);
      setAssessments(list); setAssessmentOverview(ov);
    } catch (e) { notify?.(e.message || "Failed to load assessments", "error"); }
    setAssessmentsLoaded(true);
  }, [notify]);

  // Keep the UI fresh without a manual reload — but tiered by cost so we don't
  // re-pull large payloads needlessly:
  //   • Light collections (staff/leave/checkins/docs/adjustments) are small and
  //     change often, so they're polled on a short interval while the tab is visible.
  //   • Heavy admin collections (registers with 1000+ students + attendance,
  //     assessments, PAT) are refetched only when the app/tab regains focus — that's
  //     when another device's changes matter — instead of every interval tick.
  // A short throttle collapses the focus + visibilitychange pair that both fire when
  // returning to the app, so a return triggers one refetch, not two.
  const lastFullRefetch = useRef(0);
  useEffect(() => {
    if (!user) return;
    const refetchAll = () => {
      const now = Date.now();
      if (now - lastFullRefetch.current < 3000) return; // collapse duplicate focus/visibility events
      lastFullRefetch.current = now;
      refresh();
      if (hndLoaded) refreshHnd();
      if (interactionsLoaded) refreshInteractions();
      if (assessmentsLoaded) refreshAssessments();
    };
    const onVisible = () => { if (document.visibilityState === "visible") refetchAll(); };
    window.addEventListener("focus", refetchAll);
    document.addEventListener("visibilitychange", onVisible);
    // Interval refreshes ONLY the light collections — the heavy registers/assessments
    // lists are left to the focus/visibility refetch above.
    const id = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 20000);
    return () => {
      window.removeEventListener("focus", refetchAll);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [user, refresh, refreshHnd, refreshInteractions, refreshAssessments, hndLoaded, interactionsLoaded, assessmentsLoaded]);

  // wrap an action so errors surface as toasts and the relevant data refetches
  const run = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); await refresh(); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); return r; }
    // Re-sync on failure too: a rejected action (e.g. 409 already-decided, 400 over-allowance)
    // usually means our cached view is stale, so refetch to match server truth.
    catch (e) { await refresh().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
  };

  // Same wrapper, but resyncs the HND collections instead of the staff ones.
  const runHnd = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); await refreshHnd(); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); return r; }
    catch (e) { await refreshHnd().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
  };

  // Same wrapper, resyncing the PAT interactions list.
  const runPat = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); await refreshInteractions(); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); return r; }
    catch (e) { await refreshInteractions().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
  };

  // Same wrapper, resyncing the assessments list + overview.
  const runAssess = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); await refreshAssessments(); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); return r; }
    catch (e) { await refreshAssessments().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
  };

  // Timesheets are month-scoped and the TimesheetScreen reloads its own list, so
  // this wrapper only raises success/error toasts — no global refetch. The success
  // message receives the mutation's result as its LAST argument (used by submit).
  const runTs = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args, r) : okMsg, okType); return r; }
    catch (e) { notify?.(e.message || "Action failed", "error"); throw e; }
  };

  const actions = {
    refresh,
    // check-ins
    checkIn: run((site) => api.checkIn(site), "Checked in — have a great day!"),
    checkOut: run((id) => api.checkOut(id), "Checked out. See you tomorrow!"),
    upsertCheckin: run((data) => api.upsertCheckin(data), "Check-in record saved"),
    saveSummary: run((date, text) => api.saveSummary(date, text), "Daily summary saved"),
    // leave
    requestLeave: run((data) => api.requestLeave(data), "Leave request submitted"),
    decideLeave: run((id, status, note) => api.decideLeave(id, status, note), (id, status) => `Request ${status}`, "info"),
    // balances
    adjustBalance: run((staffId, days, note) => api.addAdjustment({ staffId, days, note }), "Adjustment applied"),
    setAllowance: run((id, allowance) => api.updateStaff(id, { allowance }), "Allowance updated"),
    // documents
    addDoc: run((data) => api.addDocument(data), (d) => `"${d.name}" published`),
    deleteDoc: run((id) => api.deleteDocument(id), "Document removed", "error"),
    // sign-up requests
    decideSignup: run(
      (id, status, note, allowance) => api.decideSignup(id, status, note, allowance),
      (id, status) => (status === "approved" ? "Account approved — they can now sign in" : "Sign-up declined"),
      "info",
    ),
    // staff
    addStaff: run((data) => api.addStaff(data), (d) => `Added ${d.name}`),
    updateStaff: run((id, data) => api.updateStaff(id, data), "Staff updated"),
    removeStaff: run((id) => api.removeStaff(id), "Staff removed", "error"),
    resetStaffTotp: run((id) => api.resetStaffTotp(id), "Two-step verification reset", "info"),
    // Super-admin only: assign which admin pages a person may access.
    updateAccess: run((id, pages) => api.updateStaffAccess(id, pages), "Access updated"),
    // HND registers
    refreshHnd,
    setSemesterId,
    addSemester: runHnd((data) => api.addSemester(data), (d) => `${d.name} added`),
    updateSemester: runHnd((id, data) => api.updateSemester(id, data), "Semester updated"),
    removeSemester: runHnd((id) => api.removeSemester(id), "Semester removed", "error"),
    addProgramme: runHnd((data) => api.addProgramme(data), (d) => `${d.name} added`),
    updateProgramme: runHnd((id, data) => api.updateProgramme(id, data), "Programme updated"),
    removeProgramme: runHnd((id) => api.removeProgramme(id), "Programme removed", "error"),
    addModule: runHnd((data) => api.addModule(data), (d) => `Module ${String(d.code).toUpperCase()} added`),
    updateModule: runHnd((id, data) => api.updateModule(id, data), "Module updated"),
    removeModule: runHnd((id) => api.removeModule(id), "Module removed", "error"),
    setModuleEnrolments: runHnd((id, studentIds) => api.setModuleEnrolments(id, studentIds), "Students enrolled"),
    generateSessions: runHnd((id, data) => api.generateSessions(id, data), (id, data) => `Weekly registers created`),
    addStudent: runHnd((data) => api.addStudent(data), (d) => `Added ${d.firstName} ${d.lastName}`),
    updateStudent: runHnd((id, data) => api.updateStudent(id, data), "Student updated"),
    removeStudent: runHnd((id) => api.removeStudent(id), "Student removed", "error"),
    setEnrolments: runHnd((id, moduleIds) => api.setEnrolments(id, moduleIds), "Enrolments updated"),
    addSession: runHnd((data) => api.addSession(data), "Session added"),
    updateSession: runHnd((id, data) => api.updateSession(id, data), "Session updated"),
    removeSession: runHnd((id) => api.removeSession(id), "Session removed", "error"),
    saveRegister: runHnd((sessionId, marks) => api.saveRegister(sessionId, marks), "Register saved"),
    getRegister: (sessionId) => api.getRegister(sessionId),
    // PAT interactions
    refreshInteractions,
    addInteraction: runPat((data) => api.addInteraction(data), "Interaction logged"),
    updateInteraction: runPat((id, data) => api.updateInteraction(id, data), "Interaction updated"),
    removeInteraction: runPat((id) => api.removeInteraction(id), "Interaction deleted", "error"),
    // assessments (gradebook)
    refreshAssessments,
    addAssessment: runAssess((data) => api.addAssessment(data), (d) => `Added "${d.title}"`),
    updateAssessment: runAssess((id, data) => api.updateAssessment(id, data), "Assessment updated"),
    removeAssessment: runAssess((id) => api.removeAssessment(id), "Assessment removed", "error"),
    saveGrades: runAssess((id, grades) => api.saveGrades(id, grades), "Grades saved"),
    saveGrade: runAssess((id, studentId, marks) => api.saveGrades(id, [{ studentId, marks }]), (id, studentId, marks) => marks == null ? "Grade removed" : "Grade saved"),
    getGrades: (id) => api.getGrades(id),
    listGrades: (params) => api.listGrades(params),
    studentAssessments: (id) => api.studentAssessments(id),
    // timesheets (month-scoped; screens fetch their own month and reload after writes)
    listTimesheets: (params) => api.listTimesheets(params),
    addTimesheet: runTs((data) => api.addTimesheet(data), "Timesheet entry added"),
    updateTimesheet: runTs((id, data) => api.updateTimesheet(id, data), "Entry updated"),
    removeTimesheet: runTs((id) => api.removeTimesheet(id), "Entry removed", "info"),
    submitTimesheet: runTs((month) => api.submitTimesheet(month), (month, r) => `Timesheet sent — ${r.sent} session${r.sent === 1 ? "" : "s"}, ${r.hours}h`),
    reviewTimesheet: runTs((staffId, month, decision, note) => api.reviewTimesheet(staffId, month, decision, note), (staffId, month, decision) => decision === "approved" ? "Timesheet approved — staff notified" : "Changes requested — staff notified", "info"),
  };

  return {
    staff, leave, checkins, docs, adjustments, signups, loaded,
    modules, students, sessions, semesters, programmes, unassignedSessions, semesterId, attendance, hndLoaded,
    interactions, interactionsLoaded,
    assessments, assessmentOverview, assessmentsLoaded,
    usedDays, adjDays, effectiveAllowance,
    notify, currentUser: user, isAdmin,
    ...actions,
  };
}

export { daysBetween };
