// The Admission model's writable columns and the helper that copies them off a request
// body. Shared by the admin admissions router and the PUBLIC application-form submit
// route so both accept exactly the same fields (and nothing else — no id/createdAt or
// unknown keys can be smuggled into Prisma).
const FIELDS = [
  // Course details
  "course", "intake", "intakeYear", "foundVia", "classOption", "firstName", "middleName", "surname", "dob",
  "gender", "email", "phone", "countryOfBirth", "countryOfCitizenship", "idDocNo",
  "idDateOfIssue", "idDateOfExpiry", "idIssuingCountry", "niNumber",
  // Home address
  "houseNo", "street", "city", "postCode", "mailingAddress", "emergencyName",
  "emergencyPhone", "emergencyRelationship", "emergencyEmail",
  // Criminal record
  "criminalConviction", "criminalDetails",
  // Disabilities
  "medicalConditions", "medicalDetails", "learningDifficulty", "learningDetails",
  // Education & employment
  "englishFirstLanguage", "englishProof", "englishProofOther", "highestEducation",
  "overseasQualification", "appliedElsewhere", "previousStudentFinance",
  "previousFinanceDetails", "fundingIntent", "fundingOther", "employmentStatus",
  "employmentDetails", "jobTitle", "companyName", "dateStarted", "workedPast",
  "workedPastDetails",
  // Reference 1
  "ref1Name", "ref1Contact", "ref1Email", "ref1Relationship",
  // Reference 2
  "ref2Name", "ref2Role", "ref2Organisation", "ref2Relationship",
  // EDI
  "ethnicity", "religion",
  // Declaration
  "signature", "declarationDate",
];

// A single free-text answer can't be longer than this — a defensive cap so one giant
// paste can't bloat the row. The form's longest fields are short paragraphs.
const MAX_LEN = 5000;

const str = (v) => (typeof v === "string" ? v.trim() : "");

// Copy the known fields off the body, trimmed and length-capped. Empty strings become
// null so a blank answer is stored as "no value" rather than "" — cleaner to read back.
function pick(body) {
  const out = {};
  for (const k of FIELDS) {
    const v = str(body[k] || "").slice(0, MAX_LEN);
    out[k] = v === "" ? null : v;
  }
  return out;
}

module.exports = { FIELDS, MAX_LEN, str, pick };
