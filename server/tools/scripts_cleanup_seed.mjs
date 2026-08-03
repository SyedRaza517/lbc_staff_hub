// Deletes ALL test/seed data (anything with an id starting "seed_"). Your real
// data is untouched. Run from the server folder:  node scripts_cleanup_seed.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const run = (t) => p.$executeRawUnsafe(`DELETE FROM "${t}" WHERE id LIKE 'seed%'`).then(n => console.log(`  ${t}: deleted ${n}`)).catch(e => console.log(`  ${t}: skipped (${e.message.slice(0, 40)})`));

// Children before parents so foreign keys never block a delete.
const ORDER = [
  'AssessmentGrade', 'Assessment',
  'AttendanceMark', 'Enrolment', 'HndSession',
  'Interaction',
  'Student',
  'HndModule', 'Term', 'Cohort', 'Programme',
  'TimesheetEntry', 'Notification', 'Adjustment', 'Leave', 'CheckIn', 'Document',
  'PasswordReset', 'DeviceToken', 'SignupRequest', 'Staff',
  'Semester',
];

try {
  for (const t of ORDER) await run(t);
  console.log('Seed data removed.');
} finally { await p.$disconnect(); }
