// Thin REST client.
//
// Where the API lives:
//   1. VITE_API_URL wins if set — this is what a real deployment uses, and what a
//      packaged mobile app MUST set, because "localhost" inside the app means the
//      phone itself, not the machine running the server.
//   2. Otherwise, follow the host the page was opened from. Opening the dev client
//      at http://192.168.1.5:5173 on a phone therefore talks to the API on
//      http://192.168.1.5:4000 with no configuration.
//   3. Falling back to localhost keeps `npm run dev` on this machine working.
const API_PORT = 4000;
function resolveBase() {
  const configured = import.meta.env.VITE_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    // capacitor:// and file:// have no useful host — those builds must set VITE_API_URL.
    if (protocol.startsWith("http") && hostname) return `${protocol}//${hostname}:${API_PORT}/api`;
  }
  return `http://localhost:${API_PORT}/api`;
}
const BASE = resolveBase();

// NOTE for the packaged app: localStorage inside the Capacitor WebView is private
// to the app, but it is not the Keychain / Android Keystore. Before shipping,
// consider moving the JWT to secure storage — see MOBILE.md.
const TOKEN_KEY = "lbc_token";

// Session persistence, by platform:
//   Native app  → sessionStorage. It survives backgrounding (the WebView stays
//                 alive), but a fresh app process after the user closes/kills the
//                 app starts EMPTY — so reopening requires signing in again.
//   Web / PWA   → localStorage (persistent), so a browser reload keeps you in.
const NATIVE = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true;
const tokenStore = () => (NATIVE ? window.sessionStorage : window.localStorage);

// On the native app, discard any token left over from an older (persistent) build
// or a previous run so it can never keep a killed session alive.
if (NATIVE) { try { window.localStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ } }

export const getToken = () => { try { return tokenStore().getItem(TOKEN_KEY); } catch (_) { return null; } };
export const setToken = (t) => {
  try { if (t) tokenStore().setItem(TOKEN_KEY, t); else tokenStore().removeItem(TOKEN_KEY); } catch (_) { /* ignore */ }
  if (!t) { try { window.localStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ } } // belt-and-braces on logout
};

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // cache:"no-store" — never serve a cached response. Without this, a mobile
  // WebView can return stale data after a mutation's refetch, so the UI only
  // updates on a manual reload. This forces every request to hit the network.
  const res = await fetch(BASE + path, { method, headers, cache: "no-store", body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    setToken(null);
    // Signal the app to drop the user and show <Login>, rather than leaving a
    // broken authenticated UI where every subsequent request also 401s.
    if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:unauthorized"));
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    // Carry the status on the error. A network-level failure makes fetch itself
    // reject, so that error has no `status` — which is how callers tell "the
    // server rejected me" apart from "I never reached the server".
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // auth
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  me: () => request("/auth/me"),
  changePassword: (currentPassword, newPassword) => request("/auth/change-password", { method: "PUT", body: { currentPassword, newPassword } }),
  // forgotten password
  forgotPassword: (email) => request("/auth/forgot-password", { method: "POST", body: { email } }),
  verifyResetToken: (token) => request("/auth/reset-password/verify", { method: "POST", body: { token } }),
  resetPassword: (token, newPassword, code) => request("/auth/reset-password", { method: "POST", body: { token, newPassword, code } }),
  // activating an admin-created account from its invitation link
  verifyInvite: (token) => request("/auth/invite/verify", { method: "POST", body: { token } }),
  acceptInvite: (token, newPassword) => request("/auth/invite/accept", { method: "POST", body: { token, newPassword } }),
  resendInvite: (id) => request(`/staff/${id}/invite`, { method: "POST" }),
  // two-factor (authenticator app)
  totpSetup: (challengeToken) => request("/auth/totp/setup", { method: "POST", body: { challengeToken } }),
  totpEnable: (challengeToken, code) => request("/auth/totp/enable", { method: "POST", body: { challengeToken, code } }),
  totpVerify: (challengeToken, code) => request("/auth/totp/verify", { method: "POST", body: { challengeToken, code } }),
  totpDisable: (password) => request("/auth/totp", { method: "DELETE", body: { password } }),
  // permanently delete your own account (App Store / Play Store requirement)
  deleteAccount: (password, confirm, code) => request("/auth/account", { method: "DELETE", body: { password, confirm, code } }),
  // self-service sign-up (public) + admin approval queue
  signUp: (data) => request("/signup", { method: "POST", body: data }),
  listSignups: (status) => request(`/signup${status ? `?status=${status}` : ""}`),
  decideSignup: (id, status, note, allowance) => request(`/signup/${id}/decision`, { method: "PUT", body: { status, note, allowance } }),

  // student app (each is scoped to the signed-in student on the server)
  studentMe: () => request("/student/me"),
  studentAttendance: () => request("/student/me/attendance"),
  studentAssessments: () => request("/student/me/assessments"),
  submitStudentQuery: (subject, message) => request("/student/me/query", { method: "POST", body: { subject, message } }),
  studentQueries: () => request("/student/me/queries"),

  // admin: student queries tab
  listStudentQueries: (status) => request(`/student-queries${status ? `?status=${status}` : ""}`),
  respondStudentQuery: (id, response) => request(`/student-queries/${id}/respond`, { method: "PUT", body: { response } }),
  // notifications
  listNotifications: () => request("/notifications"),
  markNotificationsRead: () => request("/notifications/read", { method: "PUT" }),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "PUT" }),
  clearNotifications: () => request("/notifications", { method: "DELETE" }),
  // push-notification devices
  registerDevice: (token, platform) => request("/devices", { method: "POST", body: { token, platform } }),
  unregisterDevice: (token) => request("/devices", { method: "DELETE", body: { token } }),
  listDevices: () => request("/devices"),
  // staff
  listStaff: () => request("/staff"),
  addStaff: (data) => request("/staff", { method: "POST", body: data }),
  updateStaff: (id, data) => request(`/staff/${id}`, { method: "PUT", body: data }),
  removeStaff: (id) => request(`/staff/${id}`, { method: "DELETE" }),
  resetStaffTotp: (id) => request(`/staff/${id}/totp`, { method: "DELETE" }),
  // Super-admin only: set which admin pages a staff member may access.
  // pages: array of page keys, or null to clear the restriction (full access).
  updateStaffAccess: (id, pages) => request(`/staff/${id}/access`, { method: "PUT", body: { pages } }),
  // check-ins
  listCheckins: (date) => request(`/checkins${date ? `?date=${date}` : ""}`),
  checkIn: (site) => request("/checkins/check-in", { method: "POST", body: site ? { site } : {} }),
  checkOut: (id) => request(`/checkins/${id}/check-out`, { method: "POST" }),
  upsertCheckin: (data) => request("/checkins", { method: "PUT", body: data }),
  saveSummary: (date, summary) => request("/checkins/summary", { method: "PUT", body: { date, summary } }),
  // leave
  listLeave: () => request("/leave"),
  requestLeave: (data) => request("/leave", { method: "POST", body: data }),
  decideLeave: (id, status, note) => request(`/leave/${id}/decision`, { method: "PUT", body: { status, note } }),
  // adjustments
  listAdjustments: () => request("/adjustments"),
  addAdjustment: (data) => request("/adjustments", { method: "POST", body: data }),
  // documents
  listDocuments: () => request("/documents"),
  addDocument: (data) => request("/documents", { method: "POST", body: data }),
  deleteDocument: (id) => request(`/documents/${id}`, { method: "DELETE" }),
  // HND attendance registers
  listSemesters: () => request("/hnd/semesters"),
  addSemester: (data) => request("/hnd/semesters", { method: "POST", body: data }),
  updateSemester: (id, data) => request(`/hnd/semesters/${id}`, { method: "PUT", body: data }),
  removeSemester: (id) => request(`/hnd/semesters/${id}`, { method: "DELETE" }),
  listCourses: () => request("/hnd/courses"),
  addCourse: (data) => request("/hnd/courses", { method: "POST", body: data }),
  updateCourse: (id, data) => request(`/hnd/courses/${id}`, { method: "PUT", body: data }),
  removeCourse: (id) => request(`/hnd/courses/${id}`, { method: "DELETE" }),
  // Cohorts (intakes under a course, e.g. "SEP 2025")
  listCohorts: (courseId) => request(`/hnd/cohorts${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ""}`),
  addCohort: (data) => request("/hnd/cohorts", { method: "POST", body: data }),
  updateCohort: (id, data) => request(`/hnd/cohorts/${id}`, { method: "PUT", body: data }),
  removeCohort: (id) => request(`/hnd/cohorts/${id}`, { method: "DELETE" }),
  // Terms (6 per cohort: Y1 T1-3, Y2 T1-3)
  listTerms: (cohortId) => request(`/hnd/terms${cohortId ? `?cohortId=${encodeURIComponent(cohortId)}` : ""}`),
  generateTerms: (cohortId, data) => request(`/hnd/cohorts/${cohortId}/terms/generate`, { method: "POST", body: data || {} }),
  updateTerm: (id, data) => request(`/hnd/terms/${id}`, { method: "PUT", body: data }),
  removeTerm: (id) => request(`/hnd/terms/${id}`, { method: "DELETE" }),
  listUnits: () => request("/hnd/units"),
  addUnit: (data) => request("/hnd/units", { method: "POST", body: data }),
  updateUnit: (id, data) => request(`/hnd/units/${id}`, { method: "PUT", body: data }),
  removeUnit: (id) => request(`/hnd/units/${id}`, { method: "DELETE" }),
  setUnitEnrolments: (id, studentIds) => request(`/hnd/units/${id}/enrolments`, { method: "PUT", body: { studentIds } }),
  generateSessions: (id, data) => request(`/hnd/units/${id}/sessions/generate`, { method: "POST", body: data }),
  listStudents: () => request("/hnd/students"),
  addStudent: (data) => request("/hnd/students", { method: "POST", body: data }),
  updateStudent: (id, data) => request(`/hnd/students/${id}`, { method: "PUT", body: data }),
  removeStudent: (id) => request(`/hnd/students/${id}`, { method: "DELETE" }),
  setEnrolments: (id, unitIds) => request(`/hnd/students/${id}/enrolments`, { method: "PUT", body: { unitIds } }),
  listSessions: (unitId) => request(`/hnd/sessions${unitId ? `?unitId=${unitId}` : ""}`),
  addSession: (data) => request("/hnd/sessions", { method: "POST", body: data }),
  updateSession: (id, data) => request(`/hnd/sessions/${id}`, { method: "PUT", body: data }),
  removeSession: (id) => request(`/hnd/sessions/${id}`, { method: "DELETE" }),
  getRegister: (sessionId) => request(`/hnd/sessions/${sessionId}/register`),
  saveRegister: (sessionId, marks, override) => request(`/hnd/sessions/${sessionId}/register`, { method: "PUT", body: { marks, ...(override ? { override: true } : {}) } }),
  // semesterId: "" = all semesters, "unassigned" = sessions outside every semester
  getAttendance: (semesterId, termId) => request(`/hnd/attendance${termId ? `?termId=${encodeURIComponent(termId)}` : semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ""}`),
  attendanceMonthly: (opts = {}) => { const q = new URLSearchParams(); if (opts.studentId) q.set("studentId", opts.studentId); if (opts.unitId) q.set("unitId", opts.unitId); if (opts.courseId) q.set("courseId", opts.courseId); const s = q.toString(); return request(`/hnd/attendance/monthly${s ? `?${s}` : ""}`); },
  // A student's attendance grouped by term (current + previous terms).
  studentTermAttendance: (id) => request(`/hnd/students/${id}/attendance-terms`),
  // PAT (Personal Academic Tutor) interactions
  listInteractions: (params = {}) => { const q = new URLSearchParams(params).toString(); return request(`/interactions${q ? `?${q}` : ""}`); },
  addInteraction: (data) => request("/interactions", { method: "POST", body: data }),
  updateInteraction: (id, data) => request(`/interactions/${id}`, { method: "PUT", body: data }),
  removeInteraction: (id) => request(`/interactions/${id}`, { method: "DELETE" }),
  // assessments (gradebook)
  listAssessments: (unitId) => request(`/assessments${unitId ? `?unitId=${unitId}` : ""}`),
  addAssessment: (data) => request("/assessments", { method: "POST", body: data }),
  updateAssessment: (id, data) => request(`/assessments/${id}`, { method: "PUT", body: data }),
  removeAssessment: (id) => request(`/assessments/${id}`, { method: "DELETE" }),
  getGrades: (id) => request(`/assessments/${id}/grades`),
  saveGrades: (id, grades) => request(`/assessments/${id}/grades`, { method: "PUT", body: { grades } }),
  listGrades: (params = {}) => { const q = new URLSearchParams(params).toString(); return request(`/assessments/grades${q ? `?${q}` : ""}`); },
  assessmentOverview: () => request("/assessments/overview"),
  // Admin gradebook view of ONE student. Deliberately named differently from the
  // student app's `studentAssessments` (their own results) — when both keys shared a
  // name the later one silently won and broke the student "My Results" screen.
  adminStudentAssessments: (studentId) => request(`/assessments/student/${studentId}`),
  execSummary: () => request("/assessments/exec-summary"),
  // timesheets
  listTimesheets: (params = {}) => { const q = new URLSearchParams(params).toString(); return request(`/timesheets${q ? `?${q}` : ""}`); },
  timesheetPendingCount: () => request("/timesheets/pending-count"),
  addTimesheet: (data) => request("/timesheets", { method: "POST", body: data }),
  updateTimesheet: (id, data) => request(`/timesheets/${id}`, { method: "PUT", body: data }),
  removeTimesheet: (id) => request(`/timesheets/${id}`, { method: "DELETE" }),
  submitTimesheet: (month) => request("/timesheets/submit", { method: "POST", body: { month } }),
  reviewTimesheet: (staffId, month, decision, note) => request("/timesheets/review", { method: "POST", body: { staffId, month, decision, note } }),
  // Moodle (VLE). preview writes nothing; sync imports courses, units, assessments,
  // students and marks. sync only STARTS the run and returns — reading a whole VLE
  // can outlast a proxy's request timeout — so poll moodleStatus() for the result.
  moodleStatus: () => request("/moodle/status"),
  moodlePreview: () => request("/moodle/preview"),
  moodleSync: () => request("/moodle/sync", { method: "POST" }),
};
