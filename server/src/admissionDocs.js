// The documents an HND applicant is asked to upload after their application is entered.
//
// This list is the single source of truth on the SERVER. The client has an identical
// copy in client/src/StaffHub.jsx (ADMISSION_DOC_TYPES) — the two MUST stay in sync,
// exactly like ADMIN_PAGES. `key` is stored on AdmissionDocument.docType and used in the
// upload URL; `label` is what the applicant and the admin see; the label is also used as
// the file's base name in SharePoint so a folder reads cleanly ("Passport.pdf").
const ADMISSION_DOC_TYPES = [
  { key: "passport", label: "Passport / ID / BRP" },
  { key: "english", label: "Proof of English" },
  { key: "qualifications", label: "Qualification certificates" },
  { key: "address", label: "Proof of address" },
  { key: "ni", label: "National Insurance number" },
  { key: "immigration", label: "Immigration status" },
];

const DOC_KEYS = ADMISSION_DOC_TYPES.map((d) => d.key);
const docLabel = (key) => (ADMISSION_DOC_TYPES.find((d) => d.key === key) || {}).label || key;

// The SharePoint folder path for one application, as an array of segments:
//   Admissions / <course> / <intake> / <student name>
// The base "Admissions" folder is the SharePoint root (SP_ROOT_FOLDER); these are the
// levels created beneath it. Missing course/intake fall back to a named bucket so a
// half-complete application still files somewhere sensible rather than at the root. The
// student folder carries a short id suffix so two applicants with the same name in the
// same intake don't collide into one folder.
function admissionFolderSegments(a) {
  const name = [a.firstName, a.surname].filter(Boolean).join(" ").trim() || "Applicant";
  return [
    (a.course || "").trim() || "Unspecified course",
    (a.intake || "").trim() || "Unspecified intake",
    `${name} (${String(a.id).slice(-6)})`,
  ];
}

module.exports = { ADMISSION_DOC_TYPES, DOC_KEYS, docLabel, admissionFolderSegments };
