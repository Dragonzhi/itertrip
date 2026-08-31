import { useState } from "react";
import type { PlanRequest } from "../types/route";

interface IndexProps {
  onPlan: (req: PlanRequest) => void;
  loading: boolean;
  error: string | null;
}

const STYLES = ["松弛探店", "经典打卡", "亲子出行", "美食之旅", "户外徒步", "人文历史"];
const BUDGETS = ["经济", "中等", "轻奢"];

/** 首页：输入目的地/天数/风格，点击开始规划。 */
export default function Index({ onPlan, loading, error }: IndexProps) {
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState(3);
  const [date, setDate] = useState("");
  const [travelers, setTravelers] = useState("2 人");
  const [budget, setBudget] = useState("中等");
  const [style, setStyle] = useState("松弛探店");
  const [constraints, setConstraints] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim() || loading) return;
    onPlan({ destination: destination.trim(), days, date, travelers, budget, style, constraints });
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="bg-white border border-line rounded-[18px] shadow-card p-8 w-full max-w-md flex flex-col gap-4"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <span className="text-2xl">🧭</span>
          <div>
            <h1 className="text-lg font-extrabold tracking-wide">IterTrip</h1>
            <p className="text-[10px] text-ink-soft tracking-[1px]">LATIN · ITER · ROAD</p>
          </div>
        </div>
        <p className="text-sm text-ink-soft leading-relaxed">
          告诉我你想去哪儿，我来规划路线、补全坐标，生成可分享的交互式地图。
        </p>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          目的地 *
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="如：成都 / 大理 / 西安"
            className="border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
            required
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            天数
            <input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              className="border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            出发日期（可选）
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          同行人数
          <input
            value={travelers}
            onChange={(e) => setTravelers(e.target.value)}
            placeholder="2 人 / 一家三口…"
            className="border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            预算
            <select value={budget} onChange={(e) => setBudget(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm text-ink bg-white">
              {BUDGETS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            风格
            <select value={style} onChange={(e) => setStyle(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm text-ink bg-white">
              {STYLES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          其他约束（可选）
          <input
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="不要辣 / 带老人 / 想看熊猫…"
            className="border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
        </label>

        {error && (
          <div className="text-xs text-[#B85C5C] bg-[#F6E7E7] border border-[#E0C3C3] rounded-lg px-3 py-2">{error}</div>
        )}

        <button
          type="submit"
          disabled={!destination.trim() || loading}
          className="bg-moss text-white rounded-lg py-2.5 text-sm font-bold hover:bg-[#175740] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "规划中…" : "开始规划 ✈️"}
        </button>
      </form>
    </div>
  );
}
