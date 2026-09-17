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
        "gold-deep": "#8A5E1E", // 金系前景 / 承载白字的实底（gold 压 cream 只有 2.37:1）
        "gold-soft": "#F6EBD8",
        danger: "#9C4038", // 红系前景（#B85C5C 压浅底 3.71~4.13:1 不达标）
        line: "#E8E0D4",
        // 日程色板：起始页行程预览的 day-dot 与地图 .iter-pin.day-N 共用
        "day-1": "#E07A5F",
        "day-2": "#E9B44C",
        "day-3": "#3D8B8A",
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