/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: { fontFamily: { display: ['"Chakra Petch"', "sans-serif"], sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"] } } },
  plugins: [],
};
