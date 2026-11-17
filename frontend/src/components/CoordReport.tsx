import { useState } from "react";
import type { CoordDigest, CoordDigestItem } from "../lib/coordDigest";
import { BADGE_CLASS, SOURCE_LABEL, coordBadge } from "../lib/coordSource";

interface Props {
  /** 本轮回复携带的坐标来源摘要（无路线 / 无点位时为 undefined，整块不渲染） */
  digest?: CoordDigest;
}

/** 降级明细超过这个组数就折叠，避免一条消息被 20 个店名撑爆 */
const MAX_INLINE = 6;

/** 来源语气：按「来源级」取色，低置信逐条在明细里点名（计数行不按置信度拆分） */
function toneOf(source: string): keyof typeof BADGE_CLASS {
  return coordBadge(source, "high")?.tone ?? "warn";
}

/** 同名同来源合并后的天数：连续区间用 1–7，不连续用顿号 */
function daysLabel(days: number[]): string {
  if (!days.length) return "";
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return contiguous && sorted.length > 1
    ? `第 ${sorted[0]}–${sorted[sorted.length - 1]} 天`
    : sorted.length > 1
      ? `第 ${sorted.join("、")} 天`
      : `第 ${sorted[0]} 天`;
}

/** 单条降级说明：无坐标 > 无来源/来源未知 > 徽标文案（高德低置信 / AI 推测 / 城市中心…） */
function itemLabel(it: Pick<CoordDigestItem, "missing" | "source" | "confidence">): string {
  if (it.missing) return "无坐标";
  if (it.source === "none" || it.source === "unknown") return SOURCE_LABEL[it.source];
  return coordBadge(it.source, it.confidence)?.text ?? SOURCE_LABEL[it.source] ?? it.source;
}

/**
 * M24 坐标来源摘要：AI 回复里「这条路线哪些点的坐标可信、哪些是降级来的」的常驻展示。
 *
 * 此前这些信息只活在折叠的「🧭 决策过程」轨迹里（生成完还会自动收起），等于没告诉用户 ——
 * 而坐标恰恰是幻觉最容易发生、用户又最难自己发现的地方（M19–M21 的全部教训）。
 * 摘要随消息持久化，刷新后仍在；口径与时间线/地图徽标完全一致（同一份 source/confidence）。
 */
export default function CoordReport({ digest }: Props) {
  const [open, setOpen] = useState(false);
  if (!digest || !digest.total) return null;

  const degraded = digest.degraded;
  const groups = digest.groups || [];
  const shown = open ? groups : groups.slice(0, MAX_INLINE);
  const hidden = groups.length - shown.length;
  const lowBySource = new Map<string, number>();
  for (const it of degraded) {
    if (it.confidence === "low") lowBySource.set(it.source, (lowBySource.get(it.source) || 0) + 1);
  }

  return (
    <div className="mt-1.5 pt-1.5 border-t border-line/60 space-y-1" data-testid="geo-digest">
      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-ink-soft" data-testid="geo-digest-counts">
        <span>📍 坐标 {digest.total} 处</span>
        {digest.counts.map((c) => {
          const low = lowBySource.get(c.source) || 0;
          return (
            <span
              key={c.source}
              className={"px-1.5 py-0.5 rounded font-semibold " + BADGE_CLASS[low && low === c.n ? "warn" : toneOf(c.source)]}
              title={"坐标来源：" + (SOURCE_LABEL[c.source] || c.source) + (low ? `（其中 ${low} 处低置信）` : "")}
            >
              {SOURCE_LABEL[c.source] || c.source} {c.n}{low ? `（低置信 ${low}）` : ""}
            </span>
          );
        })}
      </div>
      {degraded.length === 0 ? (
        <div className="text-[11px] text-moss font-medium" data-testid="geo-digest-ok">
          ✓ 全部 {digest.total} 处坐标可信（高德核验 / 你确认过）
        </div>
      ) : (
        <div className="text-[11px] text-gold-deep leading-relaxed" data-testid="geo-digest-degraded">
          ⚠️ {degraded.length} 处坐标降级：
          {shown.map((it, i) => (
            <span key={it.key}>
              {i > 0 ? " · " : ""}
              {daysLabel(it.days)}{it.hotel ? "酒店" : ""}「{it.name}」{itemLabel(it)}
              {it.count > 1 ? ` ×${it.count}` : ""}
            </span>
          ))}
          {hidden > 0 && <span> …共 {groups.length} 组 / {degraded.length} 处</span>}
          {groups.length > MAX_INLINE && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              data-testid="geo-digest-toggle"
              className="ml-1 font-semibold underline underline-offset-2 hover:text-ink focus-ring"
            >
              {open ? "收起" : "展开全部"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
