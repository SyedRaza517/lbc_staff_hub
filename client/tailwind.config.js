/** @type {import('tailwindcss').Config} */
// Real Tailwind build, replacing the Play CDN. The CDN compiles styles in the
// browser at runtime, which needs an internet connection on every launch — fine
// for a local demo, fatal inside a packaged mobile app that must work offline.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#1a3a8f", dark: "#14306f" },
        maroon: "#9e1b32",
      },
      // Lets utilities respect the notch and home indicator, e.g. pt-safe.
      spacing: {
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
      },
    },
  },
  plugins: [],
};
