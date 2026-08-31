/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#FAF6F0",
        ink: "#2B2B28",
        "ink-soft": "#6B6B64",
        moss: "#1F6B54",
        "moss-soft": "#E3EFE8",
        gold: "#C8903C",
        "gold-soft": "#F6EBD8",
        line: "#E8E0D4",
      },
      fontFamily: {
        sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif',
      },
      boxShadow: {
        card: "0 8px 30px rgba(43,43,40,.12)",
      },
    },
  },
  plugins: [],
};