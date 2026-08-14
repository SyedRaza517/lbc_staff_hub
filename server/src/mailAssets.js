// The London Brookes College logo shown in email headers.
//
// It's a static asset shipped with the front-end (client/public/lbc-logo.png), so it's
// served at "<client origin>/lbc-logo.png". Emails are sent by the server, so we build the
// absolute URL from the client origin. Override with LOGO_URL (a full URL) if the logo is
// hosted elsewhere. A hosted <img> is used (rather than an inline SVG or a CID attachment)
// because it renders consistently across Gmail, Outlook, Apple Mail and mobile clients.
const base = (process.env.LOGO_URL_BASE || process.env.CLIENT_URL || "https://lbc-staff-hub-client.vercel.app").replace(/\/$/, "");

module.exports = {
  logoUrl: process.env.LOGO_URL || `${base}/lbc-logo.png`,
};
