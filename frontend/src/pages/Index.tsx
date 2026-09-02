import { useState } from "react";
import type { PlanRequest } from "../types/route";

interface IndexProps {
  onQuickStart: (req: PlanRequest) => void;
  onChat: (prefill?: string) => void;
  onOpenSettings: () => void;
  hasModel: boolean;
  loading: boolean;
  error: string | null;
}

const STYLES = ["松弛探店", "经典打卡", "亲子出行", "美食之旅", "户外徒步", "人文历史"];
const BUDGETS = ["经济", "中等", "轻奢"];

/** 首页（新定位）：主入口是对话；快捷表单是静默生成路线的旁路。 */
export default function Index({ onQuickStart, onChat, onOpenSettings, hasModel, loading, error }: IndexProps) {
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState(3);
  const [budget, setBudget] = useState("中等");
  const [style, setStyle] = useState("松弛探店");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim() || loading) return;
    onQuickStart({ destination: destination.trim(), days, budget, style });
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center p-6 gap-5">
      <header className="w-full max-w-xl flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🧭</span>
          <div>
            <h1 className="text-lg font-extrabold tracking-wide">IterTrip</h1>
            <p className="text-[10px] text-ink-soft tracking-[1px]">LATIN · ITER · ROAD</p>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className="border border-line bg-white text-ink-soft rounded-full px-3.5 py-2 text-xs font-semibold shadow-card hover:bg-moss-soft hover:text-moss"
          data-testid="settings-btn"
        >
          ⚙️ 模型设置
        </button>
      </header>

      <div className="w-full max-w-xl bg-white border border-line rounded-[18px] shadow-card p-7 flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold leading-snug">把攻略，变成一张可以动手改的地图</h2>
          <p className="text-sm text-ink-soft leading-relaxed mt-1.5">
            粘贴小红书 / 公众号攻略文字，或直接说想去哪儿。
            生成地图路线后：对话让 AI 改、时间线拖拽精修、随时撤销，最后导出带走。
          </p>
        </div>
        <button
          onClick={() => onChat()}
          className="bg-moss text-white rounded-xl py-3 text-sm font-bold hover:bg-[#175740] transition-colors flex items-center justify-center gap-2"
          data-testid="chat-entry"
        >
          💬 打开对话框，丢一份攻略
        </button>
        {!hasModel && (
          <p className="text-[11px] text-gold bg-gold-soft rounded-lg px-3 py-2 leading-relaxed">
            未配置模型也能体验（内置演示模式，生成 mock 草稿路线）。
            想要真实 AI 规划，请先
            <button onClick={onOpenSettings} className="underline font-semibold mx-0.5">
              配置模型
            </button>
            。
          </p>
        )}
      </div>

      <details className="w-full max-w-xl bg-white/60 border border-line rounded-[14px] px-5 py-3.5 text-sm">
        <summary className="cursor-pointer font-semibold text-ink-soft select-none">或者用表单快速生成（跳过对话）</summary>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
              预算
              <select value={budget} onChange={(e) => setBudget(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm text-ink bg-white">
                {BUDGETS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
              风格
              <select value={style} onChange={(e) => setStyle(e.target.value)} className="border border-line rounded-lg px-3 py-2 text-sm text-ink bg-white">
                {STYLES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <div className="text-xs text-[#B85C5C] bg-[#F6E7E7] border border-[#E0C3C3] rounded-lg px-3 py-2">{error}</div>
          )}
          <button
            type="submit"
            disabled={!destination.trim() || loading}
            className="border border-moss text-moss rounded-lg py-2.5 text-sm font-bold hover:bg-moss-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "规划中…" : "快速生成 →"}
          </button>
        </form>
      </details>

      <p className="text-[11px] text-[#A8A298]">价格由用户手动提供 · 数据只存本机浏览器</p>
    </div>
  );
}