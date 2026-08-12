// Builds the "unconditional offer" letter that Admissions sends to a successful HND
// applicant, rendered as a single-page A4 PDF and returned as an in-memory Buffer.
//
// The letter is a faithful copy of the printed London Brookes College letterhead:
// a brand header band, the applicant's name and address, the offer body, and the
// company small-print footer. Everything that varies per applicant (name, address,
// course) comes from the `admission` record; everything that varies per send (the
// letter date, induction date, who signs it) comes from `opts`. Both objects are
// treated as untrusted — every field can be missing, and each falls back to a sane
// default or an empty string so a half-complete record still produces a valid PDF
// rather than throwing.
//
// We keep to pdfkit's built-in PDF "standard 14" fonts (Times-Roman / Times-Bold /
// Times-Italic / Helvetica) so there are no font files to ship or resolve at runtime.
const PDFDocument = require("pdfkit");

// Brand palette — the deep navy of the wordmark and the maroon accent used on the
// tagline and the signatory's name. Kept as named constants so a rebrand is a
// one-line change and the two colours read the same everywhere they appear.
const NAVY = "#1a3a8f";
const MAROON = "#9e1b32";

// A4 page geometry in PostScript points (72pt = 1in). We compute the printable
// content width once so every text block and rule lines up on the same left/right
// edges as the margin pdfkit is laying out against.
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

// Body copy point size. Kept modest (11pt) with a small line gap so both long
// paragraphs, the address block and the sign-off comfortably share one page.
const BODY_SIZE = 11;

/**
 * Build the offer letter as a PDF.
 *
 * @param {object} admission - the applicant record; any field may be absent:
 *        firstName, surname, houseNo, street, city, postCode, course.
 * @param {object} opts - per-send overrides: letterDate, inductionDate, reportTime,
 *        sessionTime, signatoryName, signatoryTitle. Missing values fall back to the
 *        defaults applied below.
 * @returns {Promise<Buffer>} the finished single-page A4 PDF.
 */
async function buildOfferLetterPdf(admission = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      // ---- Normalise the applicant fields -------------------------------------
      // Trim everything and coalesce to "" so a null/undefined never reaches pdfkit
      // (which would print the literal word "undefined").
      const a = admission || {};
      const firstName = String(a.firstName || "").trim();
      const surname = String(a.surname || "").trim();
      const fullName = [firstName, surname].filter(Boolean).join(" ");
      const houseNo = String(a.houseNo || "").trim();
      const street = String(a.street || "").trim();
      const city = String(a.city || "").trim();
      const postCode = String(a.postCode || "").trim();
      const course = String(a.course || "").trim();

      // ---- Normalise the per-send options, applying the documented defaults -----
      const o = opts || {};
      const letterDate = String(o.letterDate || "");
      const inductionDate = String(o.inductionDate || "");
      const reportTime = String(o.reportTime || "09:45 am");
      const sessionTime = String(o.sessionTime || "10:00 am");
      const signatoryName = String(o.signatoryName || "Swaroop Arja");
      const signatoryTitle = String(o.signatoryTitle || "Admissions Officer");

      // ---- Set up the document and capture its bytes into a Buffer --------------
      // pdfkit streams the PDF out as it is written; we buffer the chunks and
      // resolve with a single concatenated Buffer once the stream ends.
      const doc = new PDFDocument({ size: "A4", margin: MARGIN });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ===== Header band ========================================================
      // Left: the bold navy wordmark. `lineBreak: false` keeps it on one line even
      // if the printable width were tight.
      doc.font("Times-Bold").fontSize(20).fillColor(NAVY)
        .text("LONDON BROOKES COLLEGE", MARGIN, 52, { lineBreak: false });
      // Right: the italic maroon tagline, right-aligned across the content width so
      // it hugs the right margin opposite the wordmark.
      doc.font("Times-Italic").fontSize(12).fillColor(MAROON)
        .text("Your Success; Our Goal", MARGIN, 60, { width: CONTENT_WIDTH, align: "right" });

      // A navy rule beneath the header separating the letterhead from the body.
      doc.moveTo(MARGIN, 86).lineTo(A4_WIDTH - MARGIN, 86)
        .lineWidth(1.5).strokeColor(NAVY).stroke();

      // ===== Body ===============================================================
      // Move the cursor below the rule and reset to black for the letter text.
      doc.fillColor("#000000");
      doc.x = MARGIN;
      doc.y = 104;

      // Small helpers so the letter reads top-to-bottom like the source document.
      // `para` writes one left-aligned block in the chosen font/colour; `gap` drops
      // a blank line's worth of vertical space between blocks.
      const para = (text, font = "Times-Roman", color = "#000000") => {
        doc.font(font).fontSize(BODY_SIZE).fillColor(color)
          .text(text || "", { width: CONTENT_WIDTH, align: "left", lineGap: 2 });
      };
      const gap = (n = 1) => doc.moveDown(n);

      // Letter date.
      para(letterDate);
      gap();

      // Recipient — name in bold, then the address block. Empty parts collapse so a
      // missing house number or city doesn't leave a stray comma or full stop.
      para(fullName, "Times-Bold");
      const addrLine1 = [houseNo, street].filter(Boolean).join(" ");
      if (addrLine1) para(addrLine1 + ",");
      if (city) para(city + ".");
      if (postCode) para(postCode);
      gap();

      // Salutation.
      para(`Dear ${firstName},`);
      gap();

      // Subject line (bold).
      para(`Subject: Unconditional Offer for ${course}`, "Times-Bold");
      gap();

      // First paragraph — the offer itself, induction day and reporting details.
      para(
        "We are delighted to inform you that following your application, London Brookes " +
        `College is pleased to offer you an unconditional place on our ${course} programme. ` +
        "This offer confirms that you have met the required entry criteria for this course, " +
        "and we are excited about the prospect of you joining our vibrant academic community. " +
        `${inductionDate} is your first day (Induction Day) in the college. You must attend the ` +
        "Induction to complete the course enrolment process. You must report to the Reception " +
        `desk of London Brookes College at ${reportTime}. Your session will start at ${sessionTime}. ` +
        "During this session, you will receive your timetable, student ID card, and information " +
        "about your classes, course-related information, and other important resources."
      );
      gap();

      // "What you need to do" heading (bold).
      para("Accepting Your Offer - What You Need to Do:", "Times-Bold");
      gap();

      // Second paragraph — how to accept and who to contact.
      para(
        `To confirm your place on the ${course} course, please click the Accept link in the ` +
        "email accompanying this letter accepting the OFFER of admission. Should you have any " +
        "questions prior to your enrolment, please do not hesitate to contact our Admissions Team " +
        "at admissions@londonbrookescollege.co.uk or +447946830578. We look forward to welcoming " +
        `you to London Brookes College and supporting you in your academic journey on the ${course} programme.`
      );
      gap();

      // Sign-off. The signatory's name is bold maroon to echo the tagline accent.
      para("Yours sincerely,");
      gap();
      para(signatoryName, "Times-Bold", MAROON);
      para(signatoryTitle);
      para("London Brookes College");

      // ===== Footer =============================================================
      // Company small-print, centred near the foot of the page. We drop the page's
      // bottom margin to zero first so this multi-line block can sit low on the page
      // without pdfkit deciding it has overflowed and spilling onto a second page.
      doc.page.margins.bottom = 0;
      const footLines = [
        "London Brookes College is a company limited by guarantee registered in England and Wales 06683232.",
        "Registered Office: 42 The Burroughs, Hendon, London NW4 4AP | Tel: 0208 202 2007 | Fax: 0208 202 2047 | email: info@londonbrookescollege.co.uk",
        "website: www.Londonbrookescollege.co.uk | ISI No: 428 | SLN No: GNVKF0HT9 | UKPRN: 10065543",
        "Page 1 of 1",
      ];
      const footOpts = { width: CONTENT_WIDTH, align: "center", lineGap: 1 };
      doc.font("Helvetica").fontSize(8);
      // Measure the block so we can pin it a margin's-worth above the paper edge.
      const footHeight = footLines.reduce((h, t) => h + doc.heightOfString(t, footOpts), 0);
      let fy = A4_HEIGHT - MARGIN - footHeight;
      doc.fillColor("#556070"); // muted grey-navy for the small print
      footLines.forEach((t) => {
        doc.text(t, MARGIN, fy, footOpts);
        fy = doc.y + 1; // pdfkit advances doc.y to the end of the block just drawn
      });

      // Finalise — flushes the last chunk and triggers the "end" event above.
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildOfferLetterPdf };
