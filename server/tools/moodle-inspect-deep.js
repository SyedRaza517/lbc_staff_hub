// Moodle inspection, part 2 — READ ONLY.
//
// The first pass showed the shape of the site. This one answers the remaining
// question: where do UNITS live? It prints, for every course:
//   • its sections (topics/weeks) and the activities inside them
//   • its grade items, grouped by grade category
//   • how many enrolled users actually hold the "student" role
//
// Together those say whether a Staff Hub "Unit" should come from a course section,
// a grade category, or the category tree above the course.
//
// Calls only "_get_" functions: creates, changes and deletes nothing. Prints no
// student names or emails — only counts.
//
// Run from the server folder (reads MOODLE_URL / MOODLE_TOKEN from .env):
//   node moodle-inspect-deep.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const BASE = (process.env.MOODLE_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.MOODLE_TOKEN || "";

async function call(wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: TOKEN, moodlewsrestformat: "json", wsfunction });
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const res = await fetch(`${BASE}/webservice/rest/server.php`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${wsfunction}: not JSON (HTTP ${res.status}) ${text.slice(0, 160)}`); }
  if (data && data.exception) throw new Error(`${wsfunction}: ${data.errorcode} — ${data.message}`);
  return data;
}

const line = (c = "─") => console.log(c.repeat(78));
const trim = (s, n = 44) => { const t = String(s ?? "").replace(/<[^>]*>/g, "").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

(async () => {
  if (!BASE || !TOKEN) { console.error("\n✗ MOODLE_URL and MOODLE_TOKEN are required (see server/.env).\n"); process.exitCode = 1; return; }
  console.log(`\nDeep inspection of ${BASE}  (read-only)\n`);

  const cats = await call("core_course_get_categories");
  const catById = Object.fromEntries(cats.map(c => [c.id, c]));
  // Full path of a category, so the nesting is obvious at a glance.
  const catPath = (id) => {
    const out = []; let c = catById[id]; let guard = 0;
    while (c && guard++ < 10) { out.unshift(c.name); c = c.parent ? catById[c.parent] : null; }
    return out.join(" › ");
  };

  console.log("CATEGORY TREE");
  line();
  for (const c of cats.sort((a, b) => String(a.path).localeCompare(String(b.path)))) {
    console.log(`  ${"  ".repeat(Math.max(0, c.depth - 1))}${c.name}   [id ${c.id}, ${c.coursecount} course(s)]`);
  }

  const courses = (await call("core_course_get_courses")).filter(c => c.format !== "site");

  for (const co of courses) {
    console.log(`\n\n${"═".repeat(78)}`);
    console.log(`COURSE ${co.id}  ${co.shortname}   (idnumber: ${co.idnumber || "—"})`);
    console.log(`  full name : ${trim(co.fullname, 66)}`);
    console.log(`  category  : ${catPath(co.categoryid)}`);
    console.log(`  format    : ${co.format}`);
    console.log("═".repeat(78));

    // 1. Sections — the most likely home for "units".
    try {
      const contents = await call("core_course_get_contents", { courseid: co.id });
      console.log(`\n  SECTIONS (${contents.length})   ← could these be your UNITS?`);
      for (const s of contents) {
        const mods = s.modules || [];
        const kinds = {};
        for (const m of mods) kinds[m.modname] = (kinds[m.modname] || 0) + 1;
        console.log(`    §${String(s.section).padEnd(3)} ${trim(s.name, 46).padEnd(47)} ${mods.length} activity(ies) ${Object.keys(kinds).length ? "· " + Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(" ") : ""}`);
        for (const m of mods.slice(0, 6)) console.log(`          - [${m.modname}] ${trim(m.name, 56)}`);
        if (mods.length > 6) console.log(`          … and ${mods.length - 6} more`);
      }
    } catch (e) { console.log(`  SECTIONS: ${e.message}`); }

    // 2. Grade items grouped by grade category — the other candidate for "units".
    try {
      const g = await call("gradereport_user_get_grade_items", { courseid: co.id });
      const items = g.usergrades?.[0]?.gradeitems || [];
      const byCat = new Map();
      for (const it of items) {
        const key = it.categoryid ?? "—";
        if (!byCat.has(key)) byCat.set(key, []);
        byCat.get(key).push(it);
      }
      console.log(`\n  GRADE ITEMS (${items.length}) grouped by grade category (${byCat.size})   ← your ASSESSMENTS`);
      for (const [cat, list] of byCat) {
        console.log(`    category ${cat}:`);
        for (const it of list.slice(0, 10)) {
          console.log(`      [${String(it.itemmodule || it.itemtype).padEnd(10)}] max=${String(it.grademax).padEnd(6)} ${trim(it.itemname || "(course total)", 52)}`);
        }
        if (list.length > 10) console.log(`      … and ${list.length - 10} more`);
      }
    } catch (e) { console.log(`  GRADE ITEMS: ${e.message}`); }

    // 3. Who is actually a student here (counts only — no names, no emails).
    try {
      const users = await call("core_enrol_get_enrolled_users", { courseid: co.id });
      const students = users.filter(u => (u.roles || []).some(r => r.shortname === "student"));
      const withRef = students.filter(u => (u.idnumber || "").trim()).length;
      const withEmail = students.filter(u => (u.email || "").trim()).length;
      console.log(`\n  ENROLLED: ${users.length} total · ${students.length} with the student role`);
      console.log(`    students with a student number: ${withRef}/${students.length}`);
      console.log(`    students with an email:         ${withEmail}/${students.length}`);
    } catch (e) { console.log(`  ENROLLED: ${e.message}`); }
  }

  console.log("\n");
  line("═");
  console.log("Done — nothing was changed.");
  line("═");
  console.log("");
})().catch((e) => { console.error("\n✗ Deep inspection failed:", e.message, "\n"); process.exitCode = 1; });
