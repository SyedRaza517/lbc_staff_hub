// Generate App Store screenshots for the iPhone 6.9" slot (1290 x 2796).
// Each = a soft branded background, a two-line headline, and an iPhone frame (bleeding
// off the bottom edge, App-Store style) with a filled, faithful mockup of one screen.
// Rendered from SVG with sharp.  Run from client/:  node scripts/make-screens.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

const W = 1290, H = 2796;
const PH = { x: 165, y: 452, w: 960, h: 2120, r: 122 };            // phone body (floats on the branded bg)
const SC = { x: PH.x + 26, y: PH.y + 26, w: PH.w - 52, h: PH.h - 52, r: 94 };
const PAD = 40, CLEFT = SC.x + PAD, CW = SC.w - PAD * 2, CX = W / 2;
const HDRY = SC.y + 96, HDRH = 150;                                // app header bar
const TOP = HDRY + HDRH + 44;                                      // first content y
const BLUE = "#1e40af", NAVY = "#14306f", INK = "#0f1e3d", SUB = "#64748b", LINE = "#e6ebf3", CARDBG = "#ffffff";
const TEAL = "#0d7a5f", VIOLET = "#6d28d9", AMBER = "#b45309", ROSE = "#e11d48", GREEN = "#059669", CYAN = "#0e7490";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// mini white fanlight emblem centred at (cx,cy), radius r
function mark(cx, cy, r) {
  const by = cy + r / 2, rO = r * 0.86, rI = r * 0.30, sw = r * 0.12;
  const pt = (rr, d) => [(cx + rr * Math.cos(d * Math.PI / 180)).toFixed(1), (by - rr * Math.sin(d * Math.PI / 180)).toFixed(1)];
  const arc = (rr) => `M${cx - rr},${by} A${rr},${rr} 0 0 1 ${cx + rr},${by}`;
  const sp = [1, 2, 3, 4, 5, 6].map(i => i * 180 / 7).map(d => { const [ix, iy] = pt(rI, d), [ox, oy] = pt(rO, d); return `<line x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}"/>`; }).join("");
  return `<path d="${arc(r)} Z" fill="#fff"/><g stroke="${BLUE}" stroke-width="${sw}" fill="none" stroke-linecap="round"><path d="${arc(rO)}"/><path d="${arc(rI)}"/>${sp}</g>`;
}
const header = (title) => `<rect x="${SC.x}" y="${HDRY}" width="${SC.w}" height="${HDRH}" fill="url(#hdr)"/>
  <g transform="translate(${SC.x + 66},${HDRY + HDRH / 2 - 6})">${mark(0, 0, 34)}</g>
  <text x="${SC.x + 130}" y="${HDRY + HDRH / 2 + 15}" font-size="46" font-weight="800" fill="#fff">${esc(title)}</text>`;

function stats(y, items, ch = 250) {
  const gap = 26, cw = (CW - gap) / 2;
  const svg = items.map((it, i) => {
    const x = CLEFT + (i % 2) * (cw + gap), yy = y + Math.floor(i / 2) * (ch + gap);
    return `<rect x="${x}" y="${yy}" width="${cw}" height="${ch}" rx="34" fill="${CARDBG}" stroke="${LINE}"/>
      <rect x="${x}" y="${yy}" width="${cw}" height="9" rx="4" fill="${it.tone}"/>
      <circle cx="${x + cw - 62}" cy="${yy + 70}" r="46" fill="${it.tone}"/>
      <text x="${x + 36}" y="${yy + 66}" font-size="24" font-weight="700" letter-spacing="1.5" fill="#93a1b8">${esc(it.label.toUpperCase())}</text>
      <text x="${x + 36}" y="${yy + 150}" font-size="78" font-weight="800" fill="${it.tone}">${esc(it.value)}</text>
      <text x="${x + 36}" y="${yy + 198}" font-size="27" fill="#93a1b8">${esc(it.sub || "")}</text>`;
  }).join("");
  return { svg, h: Math.ceil(items.length / 2) * (ch + gap) - gap };
}
function list(y, title, rows, rh = 120) {
  const h = 100 + rows.length * rh + 24;
  const inner = rows.map((r, i) => {
    const ry = y + 100 + i * rh;
    return `${i ? `<line x1="${CLEFT + 30}" x2="${CLEFT + CW - 30}" y1="${ry - 8}" y2="${ry - 8}" stroke="${LINE}"/>` : ""}
      <circle cx="${CLEFT + 68}" cy="${ry + 42}" r="36" fill="${(r.tone || BLUE)}1f"/>
      <text x="${CLEFT + 68}" y="${ry + 54}" font-size="28" font-weight="800" fill="${r.tone || BLUE}" text-anchor="middle">${esc(r.badge || "•")}</text>
      <text x="${CLEFT + 128}" y="${ry + 36}" font-size="33" font-weight="700" fill="${INK}">${esc(r.t)}</text>
      <text x="${CLEFT + 128}" y="${ry + 78}" font-size="27" fill="${SUB}">${esc(r.s)}</text>
      ${r.r ? `<text x="${CLEFT + CW - 34}" y="${ry + 56}" font-size="33" font-weight="800" fill="${r.tone || INK}" text-anchor="end">${esc(r.r)}</text>` : ""}`;
  }).join("");
  return { svg: `<rect x="${CLEFT}" y="${y}" width="${CW}" height="${h}" rx="34" fill="${CARDBG}" stroke="${LINE}"/>
    <text x="${CLEFT + 36}" y="${y + 62}" font-size="35" font-weight="800" fill="${INK}">${esc(title)}</text>${inner}`, h };
}
function hero(y, greet, subtitle, h = 220) {
  return { svg: `<rect x="${CLEFT}" y="${y}" width="${CW}" height="${h}" rx="40" fill="url(#hero)"/>
    <circle cx="${CLEFT + CW - 70}" cy="${y + 30}" r="130" fill="#fff" opacity="0.10"/>
    <text x="${CLEFT + 46}" y="${y + 100}" font-size="48" font-weight="800" fill="#fff">${esc(greet)}</text>
    <text x="${CLEFT + 46}" y="${y + 156}" font-size="29" fill="#fff" opacity="0.82">${esc(subtitle)}</text>`, h };
}
const cta = (y, label) => ({ svg: `<rect x="${CLEFT}" y="${y}" width="${CW}" height="100" rx="26" fill="url(#hero)"/>
  <text x="${CX}" y="${y + 66}" font-size="36" font-weight="800" fill="#fff" text-anchor="middle">${esc(label)}</text>`, h: 100 });
const search = (y, ph) => ({ svg: `<rect x="${CLEFT}" y="${y}" width="${CW}" height="90" rx="45" fill="${CARDBG}" stroke="${LINE}"/>
  <circle cx="${CLEFT + 54}" cy="${y + 45}" r="17" fill="none" stroke="#94a3b8" stroke-width="5"/><line x1="${CLEFT + 67}" y1="${y + 58}" x2="${CLEFT + 82}" y2="${y + 73}" stroke="#94a3b8" stroke-width="5" stroke-linecap="round"/>
  <text x="${CLEFT + 104}" y="${y + 57}" font-size="31" fill="#94a3b8">${esc(ph)}</text>`, h: 90 });
function chips(y, items) {
  let x = CLEFT; const parts = items.map((c, i) => { const w = 60 + c.t.length * 17; const s = `<rect x="${x}" y="${y}" width="${w}" height="70" rx="35" fill="${i === 0 ? BLUE : CARDBG}" stroke="${i === 0 ? BLUE : LINE}"/><text x="${x + w / 2}" y="${y + 46}" font-size="28" font-weight="700" fill="${i === 0 ? "#fff" : SUB}" text-anchor="middle">${esc(c.t)}</text>`; x += w + 18; return s; }).join("");
  return { svg: parts, h: 70 };
}
function fieldRow(y, label, value) {
  return { svg: `<text x="${CLEFT + 6}" y="${y}" font-size="25" font-weight="700" letter-spacing="1" fill="#93a1b8">${esc(label.toUpperCase())}</text>
    <rect x="${CLEFT}" y="${y + 18}" width="${CW}" height="92" rx="22" fill="${CARDBG}" stroke="${LINE}"/>
    <text x="${CLEFT + 32}" y="${y + 76}" font-size="32" fill="${value ? INK : "#94a3b8"}">${esc(value)}</text>`, h: 128 };
}
function days(y, rows) {
  const h = rows.length * 150;
  const svg = rows.map((r, i) => { const ry = y + i * 150;
    return `<rect x="${CLEFT}" y="${ry}" width="${CW}" height="130" rx="30" fill="${CARDBG}" stroke="${LINE}"/>
      <rect x="${CLEFT}" y="${ry}" width="11" height="130" rx="5" fill="${r.tone || BLUE}"/>
      <text x="${CLEFT + 42}" y="${ry + 54}" font-size="32" font-weight="800" fill="${r.tone || BLUE}">${esc(r.day)}</text>
      <text x="${CLEFT + 42}" y="${ry + 100}" font-size="27" fill="${SUB}">${esc(r.time)}</text>
      <text x="${CLEFT + CW - 36}" y="${ry + 54}" font-size="32" font-weight="700" fill="${INK}" text-anchor="end">${esc(r.title)}</text>
      <text x="${CLEFT + CW - 36}" y="${ry + 98}" font-size="26" fill="${SUB}" text-anchor="end">${esc(r.who)}</text>`; }).join("");
  return { svg, h };
}
function barchart(y, title, vals) {
  const h = 300, x0 = CLEFT + 40, y0 = y + h - 60, bw = (CW - 120) / vals.length, max = Math.max(...vals.map(v => v.v));
  const bars = vals.map((v, i) => { const bh = (v.v / max) * (h - 150), bx = x0 + i * bw + 12;
    return `<rect x="${bx}" y="${y0 - bh}" width="${bw - 24}" height="${bh}" rx="10" fill="url(#hero)"/><text x="${bx + (bw - 24) / 2}" y="${y0 + 40}" font-size="24" fill="${SUB}" text-anchor="middle">${esc(v.d)}</text>`; }).join("");
  return { svg: `<rect x="${CLEFT}" y="${y}" width="${CW}" height="${h}" rx="34" fill="${CARDBG}" stroke="${LINE}"/>
    <text x="${CLEFT + 36}" y="${y + 58}" font-size="33" font-weight="800" fill="${INK}">${esc(title)}</text>${bars}`, h };
}
// stack blocks with a gap; returns combined svg
function stack(y, gap, blocks) { let cy = y, out = ""; for (const b of blocks) { out += `<g transform="translate(0,${cy - y})">${b.svg}</g>`.replace(/translate\(0,0\)/, "translate(0,0)"); cy += b.h + gap; } return out; }
// simpler: place each block at absolute y
function place(y, gap, blocks) { let cy = y, out = ""; for (const bfn of blocks) { const b = bfn(cy); out += b.svg; cy += b.h + gap; } return out; }

const screens = [
  { file: "01-welcome", bg: "#e8eefb", head: ["Your whole college,", "in one app"], accent: BLUE, body: () =>
      header("London Brookes College") +
      `<text x="${CLEFT}" y="${TOP + 30}" font-size="54" font-weight="800" fill="${INK}">Welcome back</text>
       <text x="${CLEFT}" y="${TOP + 84}" font-size="31" fill="${SUB}">Sign in to your staff account</text>` +
      place(TOP + 150, 26, [
        (y) => fieldRow(y, "Email", "r.norman@lbc.ac.uk"),
        (y) => fieldRow(y, "Password", "••••••••••"),
        (y) => cta(y, "Sign in"),
      ]) +
      `<text x="${CX}" y="${TOP + 720}" font-size="30" fill="${BLUE}" font-weight="700" text-anchor="middle">Forgotten your password?</text>
       <line x1="${CLEFT}" x2="${CLEFT + CW}" y1="${TOP + 800}" y2="${TOP + 800}" stroke="${LINE}"/>
       <rect x="${CLEFT}" y="${TOP + 850}" width="${CW}" height="100" rx="26" fill="${CARDBG}" stroke="${BLUE}"/>
       <text x="${CX}" y="${TOP + 916}" font-size="34" font-weight="800" fill="${BLUE}" text-anchor="middle">Create a staff account</text>
       <g transform="translate(${CX},${TOP + 1120})">${mark(0, 0, 64)}</g>
       <text x="${CX}" y="${TOP + 1240}" font-size="30" font-weight="700" fill="${INK}" text-anchor="middle" font-family="Georgia,serif">LONDON BROOKES COLLEGE</text>` },

  { file: "02-dashboard", bg: "#eaf0fb", head: ["See the college", "at a glance"], accent: BLUE, body: () => header("Executive Dashboard") +
      place(TOP, 26, [
        (y) => hero(y, "Good morning, Raza", "Live across all departments"),
        (y) => stats(y, [
          { label: "Present today", value: "31", sub: "of 38 staff", tone: GREEN },
          { label: "Attendance", value: "92%", sub: "present", tone: TEAL },
          { label: "Students", value: "1,240", sub: "enrolled", tone: BLUE },
          { label: "On leave", value: "4", sub: "approved", tone: ROSE }]),
        (y) => barchart(y, "Attendance — last 7 days", [{ d: "M", v: 28 }, { d: "T", v: 31 }, { d: "W", v: 30 }, { d: "T", v: 33 }, { d: "F", v: 34 }, { d: "S", v: 12 }, { d: "S", v: 8 }]),
        (y) => list(y, "By department", [
          { badge: "HE", t: "Higher Education", s: "14 staff", r: "92%", tone: BLUE },
          { badge: "SF", t: "Sixth Form", s: "10 staff", r: "95%", tone: GREEN },
          { badge: "TC", t: "Tuition Centre", s: "7 staff", r: "88%", tone: TEAL },
          { badge: "EC", t: "Exam Centre", s: "5 staff", r: "90%", tone: VIOLET }]),
      ]) },

  { file: "03-attendance", bg: "#eafaf2", head: ["Track attendance,", "every single day"], accent: GREEN, body: () => header("Attendance Registers") +
      place(TOP, 26, [
        (y) => stats(y, [
          { label: "Overall", value: "92%", sub: "this term", tone: GREEN },
          { label: "Sessions", value: "486", sub: "recorded", tone: BLUE },
          { label: "Present", value: "1,142", sub: "marks", tone: TEAL },
          { label: "Absent", value: "98", sub: "to follow up", tone: ROSE }]),
        (y) => list(y, "Recent sessions", [
          { badge: "✓", t: "Operational Planning", s: "Tue · 10:00–13:00", r: "94%", tone: GREEN },
          { badge: "✓", t: "Managing Projects", s: "Thu · 18:00–21:00", r: "90%", tone: GREEN },
          { badge: "!", t: "Business Law", s: "Wed · 14:00–17:00", r: "78%", tone: AMBER },
          { badge: "✓", t: "Marketing Essentials", s: "Mon · 10:00–13:00", r: "96%", tone: GREEN },
          { badge: "✓", t: "Finance for Managers", s: "Fri · 14:00–17:00", r: "88%", tone: GREEN },
          { badge: "✓", t: "People Management", s: "Tue · 14:00–17:00", r: "92%", tone: GREEN },
          { badge: "!", t: "Research Project", s: "Thu · 10:00–13:00", r: "74%", tone: AMBER }]),
      ]) },

  { file: "04-students", bg: "#fff3e0", head: ["Every student's", "record, in one place"], accent: AMBER, body: () => header("Students") +
      place(TOP, 26, [
        (y) => search(y, "Search name, number…"),
        (y) => chips(y, [{ t: "All" }, { t: "HND" }, { t: "FE" }, { t: "At risk" }]),
        (y) => list(y, "1,240 students", [
          { badge: "MF", t: "Mohamed Fettah", s: "HND Leadership · Y1 T3", r: "94%", tone: GREEN },
          { badge: "AR", t: "Andrei Rossini", s: "HND Business · Y1 T3", r: "88%", tone: GREEN },
          { badge: "GP", t: "Gina Potoran", s: "HND Leadership · Y1 T3", r: "72%", tone: AMBER },
          { badge: "CV", t: "Cosmin Vasile", s: "HND Business · Y1 T3", r: "96%", tone: GREEN },
          { badge: "IR", t: "Ilie Ristea", s: "HND Leadership · Y1 T3", r: "81%", tone: GREEN },
          { badge: "CR", t: "Catalin Ristea", s: "HND Business · Y1 T3", r: "90%", tone: GREEN },
          { badge: "AP", t: "Andrei Pache", s: "HND Business · Y1 T3", r: "85%", tone: GREEN },
          { badge: "SM", t: "Sara Mahmoud", s: "HND Leadership · Y1 T3", r: "68%", tone: AMBER },
          { badge: "DK", t: "Daniel Kovac", s: "HND Business · Y1 T3", r: "93%", tone: GREEN }]),
      ]) },

  { file: "05-pat", bg: "#fdeef1", head: ["Track every PAT", "meeting & follow-up"], accent: ROSE, body: () => header("PAT — Interactions") +
      place(TOP, 26, [
        (y) => stats(y, [
          { label: "Interactions", value: "5,048", sub: "logged", tone: BLUE },
          { label: "Follow-ups", value: "5,025", sub: "open", tone: AMBER },
          { label: "This week", value: "343", sub: "new", tone: VIOLET },
          { label: "Closed", value: "1,005", sub: "resolved", tone: GREEN }]),
        (y) => list(y, "Latest interactions", [
          { badge: "★", t: "Wellbeing check-in", s: "Gina P. · follow-up 27 Aug", tone: VIOLET },
          { badge: "★", t: "Attendance concern", s: "Andrei R. · follow-up 20 Aug", tone: AMBER },
          { badge: "★", t: "Academic support", s: "Cosmin V. · follow-up 18 Aug", tone: BLUE },
          { badge: "✓", t: "Progress review", s: "Ilie R. · closed", tone: GREEN },
          { badge: "★", t: "Placement chat", s: "Sara M. · follow-up 24 Aug", tone: VIOLET },
          { badge: "✓", t: "Finance query", s: "Daniel K. · closed", tone: GREEN }]),
      ]) },

  { file: "06-timetable-admin", bg: "#e6f5f5", head: ["Build timetables", "students actually see"], accent: TEAL, body: () => header("Timetable") +
      `<text x="${CLEFT}" y="${TOP + 24}" font-size="31" font-weight="700" fill="${SUB}">HND Business · Year 1 · Term 3</text>` +
      place(TOP + 66, 26, [
        (y) => days(y, [
          { day: "Tuesday", time: "Evening · 18:00–21:00", title: "Operational Planning", who: "Dr F. Ogunjimi · Online", tone: BLUE },
          { day: "Thursday", time: "Morning · 10:00–13:00", title: "Managing Projects", who: "Dr A. Shboul · Room 101", tone: TEAL },
          { day: "Thursday", time: "Afternoon · 14:00–17:00", title: "Projects Tutorial", who: "Dr A. Shboul · Room 101", tone: TEAL },
          { day: "Friday", time: "Morning · 10:00–13:00", title: "Academic Skills", who: "F. Bernardi · Room 101", tone: VIOLET },
          { day: "Friday", time: "Afternoon · 14:00–17:00", title: "Study Support", who: "F. Bernardi · Study Room", tone: AMBER }]),
        (y) => cta(y, "Publish to students"),
        (y) => list(y, "Academic calendar", [
          { badge: "1", t: "Teaching", s: "w.c. 1 Jun 2026", r: "Wk 1", tone: GREEN },
          { badge: "7", t: "Formative Feedback", s: "w.c. 13 Jul 2026", r: "Wk 7", tone: AMBER },
          { badge: "9", t: "Assessment", s: "w.c. 27 Jul 2026", r: "Wk 9", tone: ROSE }]),
      ]) },

  { file: "07-student-timetable", bg: "#e8eefb", head: ["Students get their", "weekly timetable"], accent: BLUE, body: () => header("My Timetable") +
      place(TOP, 26, [
        (y) => hero(y, "HND Business — Term 3", "3 Aug 2026 – 9 Sep 2026"),
        (y) => days(y, [
          { day: "Tuesday", time: "18:00–21:00 · Evening", title: "Operational Planning", who: "Dr F. Ogunjimi · Online", tone: BLUE },
          { day: "Thursday", time: "10:00–13:00 · Morning", title: "Managing Projects", who: "Dr A. Shboul · Room 101", tone: TEAL },
          { day: "Thursday", time: "14:00–17:00 · Tutorial", title: "Projects Tutorial", who: "Dr A. Shboul · Room 101", tone: TEAL },
          { day: "Friday", time: "10:00–13:00 · Morning", title: "Academic Skills", who: "F. Bernardi · Room 101", tone: VIOLET }]),
        (y) => list(y, "Academic calendar", [
          { badge: "1", t: "Teaching", s: "w.c. 1 Jun 2026", r: "Wk 1", tone: GREEN },
          { badge: "7", t: "Formative Feedback", s: "w.c. 13 Jul 2026", r: "Wk 7", tone: AMBER },
          { badge: "9", t: "Assessment", s: "w.c. 27 Jul 2026", r: "Wk 9", tone: ROSE }]),
      ]) },

  { file: "08-checkin", bg: "#eaf0fb", head: ["One-tap staff", "check-in"], accent: BLUE, body: () => header("Check-in") +
      place(TOP, 26, [
        (y) => hero(y, "You're checked in ✓", "Today · 08:47 · Onsite"),
        (y) => stats(y, [
          { label: "This week", value: "5", sub: "days in", tone: GREEN },
          { label: "Avg arrival", value: "08:51", sub: "this month", tone: BLUE }]),
        (y) => cta(y, "Check out"),
        (y) => list(y, "This week", [
          { badge: "M", t: "Monday", s: "08:44 – 17:02 · Onsite", r: "8h", tone: GREEN },
          { badge: "T", t: "Tuesday", s: "08:51 – 16:58 · Onsite", r: "8h", tone: GREEN },
          { badge: "W", t: "Wednesday", s: "09:03 – 17:10 · Online", r: "8h", tone: BLUE },
          { badge: "T", t: "Thursday", s: "08:39 – 17:05 · Onsite", r: "8h", tone: GREEN },
          { badge: "F", t: "Friday", s: "08:48 – now · Onsite", r: "—", tone: AMBER }]),
      ]) },

  { file: "09-leave", bg: "#f1f5fb", head: ["Book & approve", "leave in seconds"], accent: BLUE, body: () => header("Annual Leave") +
      place(TOP, 26, [
        (y) => stats(y, [
          { label: "Allowance", value: "28", sub: "days", tone: BLUE },
          { label: "Taken", value: "11", sub: "days", tone: AMBER },
          { label: "Remaining", value: "17", sub: "days", tone: GREEN },
          { label: "Pending", value: "2", sub: "requests", tone: VIOLET }]),
        (y) => list(y, "Requests", [
          { badge: "✓", t: "Summer break", s: "12–16 Aug · approved", r: "5d", tone: GREEN },
          { badge: "⏳", t: "Training day", s: "3 Sep · pending", r: "1d", tone: AMBER },
          { badge: "✓", t: "Medical appt", s: "22 Jul · approved", r: "1d", tone: GREEN },
          { badge: "✓", t: "Conference", s: "9–10 Jun · approved", r: "2d", tone: GREEN },
          { badge: "✓", t: "Personal day", s: "14 May · approved", r: "1d", tone: GREEN },
          { badge: "✗", t: "Late notice", s: "2 May · declined", r: "1d", tone: ROSE }]),
      ]) },

  { file: "10-documents", bg: "#e6f4f7", head: ["Share documents", "securely"], accent: CYAN, body: () => header("Documents") +
      place(TOP, 26, [
        (y) => search(y, "Search documents…"),
        (y) => chips(y, [{ t: "All" }, { t: "Published" }, { t: "Private" }]),
        (y) => list(y, "Published & private", [
          { badge: "PDF", t: "Staff Handbook 2026", s: "Published · 2.4 MB", tone: ROSE },
          { badge: "DOC", t: "Safeguarding Policy", s: "Published · 640 KB", tone: BLUE },
          { badge: "XLS", t: "Term Dates 2026", s: "Private · 88 KB", tone: GREEN },
          { badge: "PDF", t: "Fire Procedures", s: "Published · 1.1 MB", tone: AMBER },
          { badge: "PDF", t: "Marking Rubric", s: "Private · 512 KB", tone: VIOLET },
          { badge: "DOC", t: "Complaints Policy", s: "Published · 720 KB", tone: BLUE },
          { badge: "PDF", t: "Induction Pack", s: "Published · 3.2 MB", tone: ROSE },
          { badge: "XLS", t: "Room Bookings", s: "Private · 120 KB", tone: GREEN }]),
      ]) },
];

function svgFor(s) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${s.bg}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
      <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
      <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.accent}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
      <clipPath id="scr"><rect x="${SC.x}" y="${SC.y}" width="${SC.w}" height="${SC.h}" rx="${SC.r}"/></clipPath>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <text x="${CX}" y="156" font-size="74" font-weight="800" fill="${INK}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif">${esc(s.head[0])}</text>
    <text x="${CX}" y="248" font-size="74" font-weight="800" fill="${s.accent}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif">${esc(s.head[1])}</text>
    <rect x="${PH.x - 6}" y="${PH.y - 6}" width="${PH.w + 12}" height="${PH.h + 12}" rx="${PH.r + 6}" fill="#0b1220" opacity="0.26"/>
    <rect x="${PH.x}" y="${PH.y}" width="${PH.w}" height="${PH.h}" rx="${PH.r}" fill="#0b1220"/>
    <rect x="${SC.x}" y="${SC.y}" width="${SC.w}" height="${SC.h}" rx="${SC.r}" fill="#f5f8fc"/>
    <g clip-path="url(#scr)">
      ${s.body()}
      <text x="${SC.x + 60}" y="${SC.y + 62}" font-size="31" font-weight="700" fill="${INK}">9:41</text>
      <rect x="${SC.x + SC.w - 152}" y="${SC.y + 44}" width="72" height="26" rx="6" fill="${INK}"/>
      <rect x="${CX - 122}" y="${SC.y + 32}" width="244" height="60" rx="30" fill="#0b1220"/>
    </g>
  </svg>`;
}

const outDir = "store/screenshots";
await mkdir(outDir, { recursive: true });
for (const s of screens) {
  await writeFile(`${outDir}/${s.file}.png`, await sharp(Buffer.from(svgFor(s))).png().toBuffer());
  console.log(`  ${outDir}/${s.file}.png`);
}
console.log("\nDone — 10 screenshots at 1290x2796.");
