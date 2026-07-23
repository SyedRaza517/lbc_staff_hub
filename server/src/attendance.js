// Attendance status rules for HND registers.
//
// Points model (matches the Moodle attendance plugin the college already uses):
//   Present = 2, Late = 1, Excused = 1, Absent = 0
// A student's percentage is the points they earned divided by the points that
// were available across the sessions they were actually marked for:
//
//   pct = earned / (2 * markedSessions)
//
// Sessions with no mark are NOT counted — a register that hasn't been taken yet
// must not drag a student's figure down.

const STATUSES = ["P", "L", "E", "A"];
const POINTS = { P: 2, L: 1, E: 1, A: 0 };
const MAX_POINTS = 2; // points available per marked session

const isStatus = (s) => STATUSES.includes(s);

// Summarise a list of marks ({ status }) into counts, points and a percentage.
function summarise(marks) {
  const counts = { P: 0, L: 0, E: 0, A: 0 };
  let earned = 0;
  for (const m of marks) {
    if (!isStatus(m.status)) continue;
    counts[m.status] += 1;
    earned += POINTS[m.status];
  }
  const marked = counts.P + counts.L + counts.E + counts.A;
  const possible = marked * MAX_POINTS;
  return {
    ...counts,
    marked,
    earned,
    possible,
    // Round to one decimal so 17/20 reads 85 and 5/6 reads 83.3 rather than 83.
    pct: possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null,
  };
}

module.exports = { STATUSES, POINTS, MAX_POINTS, isStatus, summarise };
