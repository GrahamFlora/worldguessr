/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // <-- CRITICAL: This must be here!
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}