// Staff review forms — the single source of truth for both the questions and their
// validation.
//
// The CLIENT does not hard-code any of this: it fetches these definitions and renders
// whatever it is given. That means adding a new review type, or changing a question,
// is a one-file edit here with no front-end work and no risk of the two drifting.
//
// Field kinds the renderer understands:
//   text      short single-line answer
//   textarea  long answer
//   date      YYYY-MM-DD
//   select    one of `options`, shown as a dropdown
//   radio     one of `options`, shown as a list
//   grid      one choice per row: `rows` × `options`, stored as { rowKey: option }
//   confirm   a single-option declaration that must be ticked

const STRATEGIC = {
  type: "strategic",
  title: "Strategic Lecturer Self-Reflection",
  // A SELF-reflection: the lecturer fills this in about their own term, so it is
  // offered in the staff app as well as the admin console. The monthly review is
  // written by a reviewer ABOUT a lecturer, so it stays admin-only.
  selfService: true,
  blurb: "Your feedback supports excellence in teaching and learning.",
  sections: [
    {
      title: "Section 1 — Lecturer Information",
      questions: [
        { id: "fullName", label: "Full Name", kind: "text", required: true },
        // Labelled "Programme Title" on the original form; "Course" is what this
        // system calls the same thing since the project-wide rename.
        { id: "courseTitle", label: "Course title", kind: "text", required: true },
        {
          id: "reviewTerm", label: "Review Term", kind: "select", required: true,
          // Terms run 1–6 straight through the two years, matching Unit.termNumber.
          options: ["Term 1", "Term 2", "Term 3", "Term 4", "Term 5", "Term 6"],
        },
        { id: "academicYear", label: "Academic Year", kind: "text", required: true, placeholder: "e.g. 2025/26" },
        { id: "dateCompleted", label: "Date Completed", kind: "date", required: true },
      ],
    },
    {
      title: "Section 2 — Reflection on the Term",
      questions: [
        {
          id: "overallPerformance", label: "How would you describe your overall performance this term?",
          kind: "radio", required: true,
          options: ["Excellent", "Very Good", "Good", "Satisfactory", "Needs Improvement"],
        },
        { id: "achievements", label: "What have been your three biggest achievements this term?", kind: "textarea", required: true },
        { id: "proudOf", label: "What are you most proud of this term?", kind: "textarea", required: true },
      ],
    },
    {
      title: "Section 3 — Teaching & Learning",
      questions: [
        { id: "successfulApproaches", label: "What teaching approaches or innovations have been most successful?", kind: "textarea", required: true },
        { id: "improveTeaching", label: "What aspects of your teaching would you like to improve?", kind: "textarea", required: true },
        {
          id: "studentEngagement", label: "How effectively have you engaged your students this term?",
          kind: "radio", required: true,
          options: ["Extremely effectively", "Very effectively", "Effectively", "Somewhat effectively", "Improvement required"],
        },
      ],
    },
    {
      title: "Section 4 — Student Progress",
      questions: [
        { id: "attendanceReflection", label: "Reflect on student attendance.", kind: "textarea", required: true },
        { id: "achievementReflection", label: "Reflect on student achievement and assessment outcomes.", kind: "textarea", required: true },
        { id: "additionalSupport", label: "Have any students required additional support?", kind: "radio", required: true, options: ["Yes", "No"] },
      ],
    },
    {
      title: "Section 5 — Professional Practice",
      questions: [
        {
          id: "professionalPractice", label: "How effectively have you managed:",
          kind: "grid", required: true,
          rows: [
            { key: "lessonPreparation", label: "Lesson preparation" },
            { key: "assessmentPlanning", label: "Assessment planning" },
            { key: "markingDeadlines", label: "Marking deadlines" },
            { key: "studentCommunication", label: "Student communication" },
            { key: "recordKeeping", label: "Record keeping" },
            { key: "compliance", label: "Compliance responsibilities" },
          ],
          options: [
            "Very effectively", "Somewhat effectively",
            "Neither effectively nor ineffectively",
            "Somewhat ineffectively", "Very ineffectively",
          ],
        },
      ],
    },
    {
      title: "Section 6 — Professional Development",
      questions: [
        { id: "cpdCompleted", label: "What CPD activities have you completed this term?", kind: "textarea", required: true },
        { id: "cpdImpact", label: "How have these activities improved your teaching?", kind: "textarea", required: true },
        { id: "furtherDevelopment", label: "What further development would benefit you?", kind: "textarea", required: true },
      ],
    },
    {
      title: "Section 7 — Previous Actions",
      questions: [
        { id: "previousActions", label: "Reflect on the progress made against the actions agreed during your previous Strategic Performance Review.", kind: "textarea", required: true },
        { id: "actionEvidence", label: "What evidence demonstrates the impact of these actions?", kind: "textarea", required: true },
      ],
    },
    {
      title: "Section 8 — Looking Forward",
      questions: [
        { id: "nextTermPriorities", label: "What are your three priorities for next term?", kind: "textarea", required: true },
        { id: "supportNeeded", label: "What support would help you be even more successful?", kind: "textarea", required: true },
        { id: "operationalIssues", label: "Are there any operational issues affecting your performance?", kind: "radio", required: true, options: ["Yes", "No"] },
      ],
    },
    {
      title: "Section 9 — Final Reflection",
      questions: [
        { id: "oneChange", label: "If you could change one thing about your teaching or programme delivery next term, what would it be?", kind: "textarea", required: true },
        { id: "anythingElse", label: "Is there anything else you would like to discuss during your Strategic Lecturer Performance Review?", kind: "textarea", required: true },
      ],
    },
    {
      title: "Declaration",
      questions: [
        {
          id: "declaration",
          label: '"I confirm that the information provided is an honest reflection of my performance during this review period."',
          kind: "confirm", required: true, options: ["Yes"],
        },
      ],
    },
  ],
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const MONTHLY = {
  type: "monthly",
  title: "Monthly Performance & Support Review",
  blurb: "Working together to recognise success, address challenges and support your continued growth and development.",
  sections: [
    {
      title: "Section 1 — Review Information",
      questions: [
        { id: "lecturerName", label: "Lecturer Name", kind: "text", required: true },
        { id: "courseTitle", label: "Course title", kind: "text", required: true },
        { id: "reviewMonth", label: "Review Month", kind: "select", required: true, options: MONTHS },
        { id: "reviewDate", label: "Review Date", kind: "date", required: true },
        { id: "reviewerName", label: "Name of Reviewer", kind: "text", required: true },
      ],
    },
    {
      title: "Section 2 — Operational Performance Review",
      questions: [
        {
          id: "operationalPerformance",
          // The source form left this question's own label as the placeholder text
          // "Question"; naming it makes the printed review and the export readable.
          label: "How consistently has each of these been achieved this month?",
          kind: "grid", required: true,
          rows: [
            { key: "lessonPlanning", label: "Lesson planning is completed in advance." },
            { key: "sessionsDelivered", label: "Teaching sessions are delivered as scheduled." },
            { key: "registers", label: "Attendance registers are completed accurately and on time." },
            { key: "marking", label: "Assessment marking is completed within agreed timescales." },
            { key: "studentCommunication", label: "Student communication is timely and professional." },
            { key: "resources", label: "Moodle/Teams resources are kept up to date." },
            { key: "adminCompliance", label: "Administrative and compliance tasks are completed promptly." },
          ],
          options: ["Consistently Achieved", "Mostly Achieved", "Partially Achieved", "Rarely Achieved", "Not evident"],
        },
      ],
    },
    {
      title: "Section 3 — Student Cohort Review",
      questions: [
        {
          id: "cohortIssues",
          label: "Describe any current issues affecting:",
          help: "Attendance · Engagement · Achievement · Student behaviour · Student welfare",
          kind: "textarea", required: false,
        },
        { id: "studentsAtRisk", label: "Are any students currently considered to be at risk?", kind: "radio", required: false, options: ["Yes", "No"] },
        {
          id: "riskDetail", label: "Briefly describe the concern and any actions already taken.",
          kind: "textarea", required: false,
          // Only asked when there IS a concern — answering "No" skips it entirely.
          showIf: { q: "studentsAtRisk", is: "Yes" },
        },
      ],
    },
    {
      title: "Section 4 — Lecturer Wellbeing & Support",
      questions: [
        { id: "needsSupport", label: "Does the lecturer require additional support this month?", kind: "radio", required: true, options: ["Yes", "No"] },
        {
          id: "supportDetail", label: "Please describe the support required.",
          kind: "textarea", required: true,
          showIf: { q: "needsSupport", is: "Yes" },
        },
        {
          id: "operationalBarriers",
          label: "Are there any operational barriers preventing the lecturer from performing effectively?",
          help: "Timetabling · Resources · IT systems · Workload · Training · Student issues",
          kind: "textarea", required: true,
          showIf: { q: "needsSupport", is: "Yes" },
        },
      ],
    },
    {
      title: "Section 5 — Good Practice",
      questions: [
        { id: "doneWell", label: "What has the lecturer done particularly well this month?", kind: "textarea", required: true },
        { id: "shareGoodPractice", label: "Should any good practice be shared with the wider teaching team?", kind: "textarea", required: true },
      ],
    },
    {
      title: "Section 6 — Monthly Actions",
      questions: [
        { id: "action1", label: "Action 1 — Action Required", kind: "textarea", required: true },
        { id: "action1Measure", label: "Action 1 — Success Measure", kind: "text", required: true },
        { id: "action1Due", label: "Action 1 — Target Completion Date", kind: "date", required: true },
        { id: "action2", label: "Action 2 — Action Required", kind: "textarea", required: true },
        { id: "action2Measure", label: "Action 2 — Success Measure", kind: "text", required: true },
        { id: "action2Due", label: "Action 2 — Target Completion Date", kind: "date", required: true },
        { id: "action3", label: "Action 3 — Action Required", kind: "textarea", required: true },
        { id: "action3Measure", label: "Action 3 — Success Measure", kind: "text", required: true },
        { id: "action3Due", label: "Action 3 — Target Completion Date", kind: "date", required: true },
      ],
    },
    {
      title: "Section 7 — Overall Operational Status",
      questions: [
        {
          id: "operationalStatus", label: "Overall Operational Status", kind: "radio", required: true,
          // The source form carried a stray "Option 2" left over from editing; it is
          // not a real status and would have been selectable.
          options: ["On Track", "Monitor", "Intervention Required"],
          optionTone: { "On Track": "#059669", "Monitor": "#ea580c", "Intervention Required": "#e11d48" },
        },
        { id: "confidenceNextMonth", label: "Confidence for Next Month", kind: "radio", required: true, options: ["High", "Moderate", "Low"] },
        { id: "escalateCOO", label: "Is escalation to the COO required?", kind: "radio", required: true, options: ["Yes", "No"] },
        {
          id: "cooMatters",
          label: "List any matters that should be brought to the attention of the Chief Operating Officer during the next strategic review.",
          kind: "textarea", required: true,
          showIf: { q: "escalateCOO", is: "Yes" },
        },
      ],
    },
    {
      title: "Section 8 — Review Summary",
      questions: [
        {
          id: "reviewSummary",
          label: "Summarise the key discussion points, recognise achievements, identify operational priorities and confirm the agreed actions for the coming month.",
          kind: "textarea", required: true,
        },
      ],
    },
    {
      title: "Section 9 — Review Authorisation",
      questions: [
        { id: "programmeLeader", label: "Programme Leader Name", kind: "text", required: true },
        { id: "dateConducted", label: "Date Review Conducted", kind: "date", required: true },
        { id: "additionalComments", label: "Additional Comments", kind: "textarea", required: true },
      ],
    },
  ],
};

const FORMS = [STRATEGIC, MONTHLY];
const byType = (type) => FORMS.find((f) => f.type === type) || null;
const allQuestions = (form) => (form?.sections || []).flatMap((s) => s.questions);

// Is this question asked, given the answers so far?
//
// `showIf: { q, is }` makes a question conditional — "describe the concern" is only
// asked when a student IS at risk. A hidden question is never required and its answer
// is never stored, so changing the trigger from Yes to No cannot leave an orphaned
// answer behind to confuse the printed review.
function isVisible(q, answers) {
  if (!q?.showIf) return true;
  const { q: dep, is } = q.showIf;
  return String((answers || {})[dep] ?? "") === String(is);
}
// Only the questions actually being asked, in order.
const visibleQuestions = (form, answers) => allQuestions(form).filter((q) => isVisible(q, answers));

// Validate an `answers` object against a form. Returns { answers } or { error }.
// `draft` skips the required checks so a part-finished review can be saved.
function validateAnswers(form, raw, { draft = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Answers must be an object" };
  const out = {};
  // Only the questions actually being asked. A hidden one is neither required nor
  // stored, so flipping its trigger cannot leave a stale answer behind.
  for (const q of allQuestions(form)) {
    if (!isVisible(q, raw)) continue;
    const v = raw[q.id];
    const blank = v === undefined || v === null || v === "" || (q.kind === "grid" && (!v || typeof v !== "object" || !Object.keys(v).length));
    if (blank) {
      if (q.required && !draft) return { error: `"${q.label}" is required` };
      continue;
    }
    switch (q.kind) {
      case "select":
      case "radio":
      case "confirm":
        if (!q.options.includes(String(v))) return { error: `"${q.label}": choose one of the listed options` };
        out[q.id] = String(v);
        break;
      case "grid": {
        if (typeof v !== "object" || Array.isArray(v)) return { error: `"${q.label}": expected one choice per row` };
        const grid = {};
        for (const row of q.rows) {
          const cell = v[row.key];
          if (cell === undefined || cell === null || cell === "") {
            if (q.required && !draft) return { error: `"${q.label}" — ${row.label} is required` };
            continue;
          }
          if (!q.options.includes(String(cell))) return { error: `"${q.label}" — ${row.label}: choose one of the listed options` };
          grid[row.key] = String(cell);
        }
        out[q.id] = grid;
        break;
      }
      case "date": {
        const s = String(v).trim();
        // Same strictness as everywhere else: the string must round-trip, so
        // impossible dates like 2026-02-30 are refused rather than rolled over.
        const d = new Date(`${s}T00:00:00Z`);
        if (isNaN(d) || d.toISOString().slice(0, 10) !== s) return { error: `"${q.label}": enter a real date` };
        out[q.id] = s;
        break;
      }
      default: {
        const s = String(v).trim();
        if (!s) { if (q.required && !draft) return { error: `"${q.label}" is required` }; break; }
        out[q.id] = s.slice(0, 5000);
      }
    }
  }
  return { answers: out };
}

module.exports = { FORMS, STRATEGIC, MONTHLY, byType, allQuestions, visibleQuestions, isVisible, validateAnswers };
