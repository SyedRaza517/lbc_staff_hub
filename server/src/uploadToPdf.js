// Normalises every applicant-uploaded document to a PDF before it is stored.
//
// Applicants upload from phones and laptops, so a "document" arrives as either a real
// PDF or a photo (JPG/PNG) of a paper page. We want one consistent format on the far
// side — a PDF — so admissions never has to juggle mixed file types. This module sniffs
// the raw bytes, wraps any accepted image in a single-page A4 PDF, and rejects anything
// that is neither a PDF nor a supported image.
//
// We identify the type by magic bytes (the file's leading signature) rather than trusting
// the client's Content-Type or filename, which are both easily wrong or spoofed. Image
// conversion reuses pdfkit — the same library that builds the offer letter — so there are
// no new dependencies to ship.
const PDFDocument = require("pdfkit");

// A4 page geometry in PostScript points (72pt = 1in), plus the margin we leave around the
// placed image. Kept local so this module stands alone.
const A4_MARGIN = 24;

/**
 * Identify a file by its leading magic bytes.
 *
 * We only look at the signature, never the extension or Content-Type, so a mislabelled
 * upload is still classified correctly. Short buffers can't match any signature, so they
 * fall through to "other".
 *
 * @param {Buffer} buf - the raw file bytes.
 * @returns {"pdf"|"jpg"|"png"|"other"} the detected type.
 */
function sniff(buf) {
  if (!buf || buf.length < 4) return "other";
  // PDF: the file begins with the ASCII string "%PDF-".
  if (buf.length >= 5 && buf.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  // JPEG: starts with the bytes 0xFF 0xD8 0xFF.
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  // PNG: 0x89 followed by the ASCII letters "PNG" (bytes 1–3).
  if (buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "png";
  return "other";
}

/**
 * Wrap a raw image (JPG or PNG) in a single-page A4 PDF.
 *
 * The image is scaled to fit inside the page margins while preserving its aspect ratio,
 * and centred both ways. Bytes are buffered as pdfkit emits them and the concatenated
 * Buffer is resolved on "end" — the same streaming-into-a-Buffer pattern used in
 * offerLetter.js.
 *
 * @param {Buffer} buffer - the source image bytes (JPEG or PNG).
 * @returns {Promise<Buffer>} the finished single-page A4 PDF.
 */
function imageToPdf(buffer) {
  return new Promise((resolve, reject) => {
    try {
      // One A4 page with a uniform margin.
      const doc = new PDFDocument({ size: "A4", margin: A4_MARGIN });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Place the image fitted inside the printable box (page minus both margins),
      // centred horizontally and vertically. pdfkit reads JPEG/PNG buffers directly.
      doc.image(buffer, A4_MARGIN, A4_MARGIN, {
        fit: [doc.page.width - A4_MARGIN * 2, doc.page.height - A4_MARGIN * 2],
        align: "center",
        valign: "center",
      });

      // Finalise — flushes the last chunk and triggers the "end" event above.
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Guarantee a PDF for any accepted upload.
 *
 * - A real PDF is returned untouched.
 * - A JPG or PNG is converted to a single-page A4 PDF.
 * - Anything else is rejected with a friendly, applicant-facing message.
 *
 * @param {Buffer} buffer - the raw uploaded bytes.
 * @returns {Promise<{ buffer: Buffer, contentType: "application/pdf" }>}
 * @throws {Error} if the file is neither a PDF nor a supported image.
 */
async function ensurePdf(buffer) {
  const kind = sniff(buffer);
  if (kind === "pdf") return { buffer, contentType: "application/pdf" };
  if (kind === "jpg" || kind === "png") {
    // pdfkit's PNG decoder rejects a few unusual PNGs (e.g. interlaced). Turn that raw
    // decoder error into a friendly, actionable message rather than surfacing it verbatim.
    try {
      return { buffer: await imageToPdf(buffer), contentType: "application/pdf" };
    } catch (_) {
      throw new Error("We couldn't process that image. Please upload it as a PDF, or take a clear photo and try again (JPG works best).");
    }
  }
  throw new Error("Please upload a PDF or a photo (JPG or PNG). Other file types aren't accepted.");
}

module.exports = { sniff, imageToPdf, ensurePdf };
