// API-backed store. Exposes the same data shape the UI components expect
// (staff, leave, checkins, docs, adjustments) plus async action methods.
// After each mutation we refetch the affected collection so both the
// staff app and the admin dashboard always reflect the live database.
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { api } from "./api";
import { ukBankHolidaysRange } from "./bankHolidays";

const daysBetween = (a, b) => { const d1 = new Date(a), d2 = new Date(b); if (isNaN(d1) || isNaN(d2)) { console.error("Invalid dates:", a, b); return 0; } return Math.max(1, Math.round((d2 - d1) / 86400000) + 1); };
const todayISO = () => new Date().toISOString().slice(0, 10);

export function useApiStore(notify, user) {
  const [staff, setStaff] = useState([]);
  const [leave, setLeave] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [docs, setDocs] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [signups, setSignups] = useState([]);
  const [studentQueries, setStudentQueries] = useState([]);
  const [timesheetsPending, setTimesheetsPending] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // HND registers. Loaded lazily by the admin page rather than on login —
  // staff users never open it, so there's no reason to fetch it for them.
  const [modules, setModules] = useState([]);
  const [students, setStudents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [terms, setTerms] = useState([]);
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
        // Student queries — tolerant like sign-ups (page-gated + needs the new API).
        try { setStudentQueries(await api.listStudentQueries()); }
        catch (_) { setStudentQueries([]); }
        // Timesheets awaiting review — a count for the nav badge (tolerant).
        try { setTimesheetsPending((await api.timesheetPendingCount())?.count || 0); }
        catch (_) { setTimesheetsPending(0); }
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
      // Cohorts & terms load tolerantly: if an endpoint lags behind on a deploy
      // (Vercel client ahead of the Render server), it must not break the rest.
      try { setCohorts(await api.listCohorts()); } catch (_) { setCohorts([]); }
      try { setTerms(await api.listTerms()); } catch (_) { setTerms([]); }
    } catch (e) { notify?.(e.message || "Failed to load registers", "error"); }
    setHndLoaded(true);
  }, [notify, semesterId]);

  // derived

  // --- Bank holidays ---
  // The standard UK (England & Wales) bank holidays, computed for a span of years so
  // the calendar can page around. The 28-day total is split into two separate pots:
  //   • 8 bank holidays  — fixed days off, NOT bookable, shown as they pass.
  //   • 20 holiday allowance — the days a staff member can actually book.
  // Bank holidays never draw down the bookable 20; they live in their own counter.
  const thisYear = new Date().getFullYear();
  const bankHolidays = useMemo(() => ukBankHolidaysRange(thisYear - 1, thisYear + 2), [thisYear]);
  const bankHolidaySet = useMemo(() => new Map(bankHolidays.map((h) => [h.date, h.name])), [bankHolidays]);
  const isBankHoliday = useCallback((iso) => bankHolidaySet.has(iso), [bankHolidaySet]);
  // How many bank holidays fall inside an inclusive date range.
  const bankHolidaysBetween = useCallback((start, end) => bankHolidays.reduce((n, h) => n + (h.date >= start && h.date <= end ? 1 : 0), 0), [bankHolidays]);
  // The number of bank holidays in the current year (normally 8) — the total shown
  // on the Bank Holidays card and the size of the bank-holiday pot.
  const bankHolidayTotal = useMemo(() => bankHolidays.filter((h) => h.date.slice(0, 4) === String(thisYear)).length, [bankHolidays, thisYear]);
  // "As each occurs": bank holidays in THIS calendar year whose date has arrived —
  // the "taken/passed" figure on the Bank Holidays card (e.g. 5 of 8 passed).
  const bankHolidayDaysUsed = useCallback(() => {
    const today = todayISO(); const y = String(thisYear);
    return bankHolidays.filter((h) => h.date.slice(0, 4) === y && h.date <= today).length;
  }, [bankHolidays, thisYear]);

  // Days actually charged against the bookable allowance for an inclusive [start,end]
  // range: Monday–Friday only, excluding bank holidays. Weekends (Sat/Sun) and bank
  // holidays that fall inside the range are free — they are never deducted. This is
  // the single source of truth for how many days a booking costs.
  const chargeableDays = useCallback((start, end) => {
    if (!start || !end || start > end) return 0;
    let cur = new Date(start + "T00:00:00Z");
    const last = new Date(end + "T00:00:00Z");
    if (isNaN(cur) || isNaN(last)) return 0;
    let n = 0;
    while (cur <= last) {
      const iso = cur.toISOString().slice(0, 10);
      const dow = cur.getUTCDay(); // 0 = Sun … 6 = Sat
      if (dow !== 0 && dow !== 6 && !bankHolidaySet.has(iso)) n += 1;
      cur = new Date(cur.getTime() + 86400000);
    }
    return n;
  }, [bankHolidaySet]);

  // Every approved leave type counts against the allowance (sick included) — the
  // total is reduced by any approved leave, regardless of type. Unpaid leave does
  // not draw down the paid allowance, so it's excluded (kept in sync with the
  // server's UNPAID_TYPES and the client's NON_ALLOWANCE_TYPES). We recompute the
  // cost from the dates (weekends + bank holidays removed) rather than trusting a
  // stored day count, so old records are handled correctly too.
  const usedDays = useCallback((id) => leave.filter((l) => l.staffId === id && l.status === "approved" && l.type !== "unpaid").reduce((s, l) => s + chargeableDays(l.start, l.end), 0), [leave, chargeableDays]);
  const adjDays = useCallback((id) => adjustments.filter((a) => a.staffId === id).reduce((s, a) => s + a.days, 0), [adjustments]);
  // Total entitlement (e.g. 28) = the bookable allowance + the 8 bank holidays.
  const effectiveAllowance = useCallback((id) => { const s = staff.find((x) => x.id === id); return (s?.allowance || 0) + adjDays(id); }, [staff, adjDays]);
  // The bookable pot (e.g. 20): total entitlement minus the 8 bank holidays, which
  // are never bookable. This is the "total" on the Holiday Allowance card.
  const bookableAllowance = useCallback((id) => Math.max(0, effectiveAllowance(id) - bankHolidayTotal), [effectiveAllowance, bankHolidayTotal]);
  // Days a staff member has left to book: bookable allowance − their approved leave.
  const remaining = useCallback((id) => bookableAllowance(id) - usedDays(id), [bookableAllowance, usedDays]);

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

  // Wrap an action so errors surface as toasts and the relevant data resyncs.
  // The resync runs in the BACKGROUND (not awaited): the save itself is awaited so
  // errors are caught and the toast is accurate, but the UI updates the instant the
  // save returns rather than waiting for a full refetch — which, at scale, made every
  // save/edit feel slow. The list catches up a moment later when the refetch lands.
  const run = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); refresh().catch(() => {}); return r; }
    // Re-sync on failure too: a rejected action (e.g. 409 already-decided, 400 over-allowance)
    // usually means our cached view is stale, so refetch to match server truth.
    catch (e) { refresh().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
  };

  // Same wrapper, but resyncs the HND collections instead of the staff ones.
  const runHnd = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); refreshHnd().catch(() => {}); return r; }
    catch (e) { refreshHnd().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
  };

  // Same wrapper, resyncing the PAT interactions list.
  const runPat = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); refreshInteractions().catch(() => {}); return r; }
    catch (e) { refreshInteractions().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
  };

  // Same wrapper, resyncing the assessments list + overview.
  const runAssess = (fn, okMsg, okType = "success") => async (...args) => {
    try { const r = await fn(...args); if (okMsg) notify?.(typeof okMsg === "function" ? okMsg(...args) : okMsg, okType); refreshAssessments().catch(() => {}); return r; }
    catch (e) { refreshAssessments().catch(() => {}); notify?.(e.message || "Action failed", "error"); throw e; }
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
    // Admin adds an already-approved holiday: create the request, then approve it in
    // one action so it lands straight on the calendar. The allowance is still enforced
    // server-side on the approval (paid types); unpaid never draws down.
    addApprovedLeave: run(async (data) => {
      const rec = await api.requestLeave(data);
      if (rec?.id && rec.status === "pending") await api.decideLeave(rec.id, "approved");
      return rec;
    }, "Holiday added to the calendar"),
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
    // student queries
    respondStudentQuery: run((id, response) => api.respondStudentQuery(id, response), "Reply sent to the student"),
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
    // Cohorts (intakes under a programme)
    addCohort: runHnd((data) => api.addCohort(data), (d) => `Cohort ${d.name} added`),
    updateCohort: runHnd((id, data) => api.updateCohort(id, data), "Cohort updated"),
    removeCohort: runHnd((id) => api.removeCohort(id), "Cohort removed", "error"),
    // Terms (6 per cohort)
    generateTerms: runHnd((cohortId, data) => api.generateTerms(cohortId, data), "6 terms created"),
    updateTerm: runHnd((id, data) => api.updateTerm(id, data), "Term updated"),
    removeTerm: runHnd((id) => api.removeTerm(id), "Term removed", "error"),
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
    saveRegister: runHnd((sessionId, marks, override) => api.saveRegister(sessionId, marks, override), "Register saved"),
    getRegister: (sessionId) => api.getRegister(sessionId),
    getStudentTermAttendance: (id) => api.studentTermAttendance(id),
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
    staff, leave, checkins, docs, adjustments, signups, studentQueries, timesheetsPending, loaded,
    modules, students, sessions, semesters, programmes, cohorts, terms, unassignedSessions, semesterId, attendance, hndLoaded,
    interactions, interactionsLoaded,
    assessments, assessmentOverview, assessmentsLoaded,
    usedDays, adjDays, effectiveAllowance, bookableAllowance, remaining, chargeableDays,
    bankHolidays, bankHolidaySet, isBankHoliday, bankHolidaysBetween, bankHolidayDaysUsed, bankHolidayTotal,
    notify, currentUser: user, isAdmin,
    ...actions,
  };
}

export { daysBetween };
