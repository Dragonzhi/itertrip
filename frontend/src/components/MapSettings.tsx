import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MapSettings as MapSettingsType } from "../lib/settings";

interface MapSettingsProps {
  value: MapSettingsType;
  onChange: (patch: Partial<MapSettingsType>) => void;
  /** 右侧时间线面板展开时，让位以贴地图可见区右下角 */
  panelOpen: boolean;
}

/** 小开关（toggle），数据驱动。 */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex w-[38px] h-[22px] rounded-full transition-colors " +
        (checked ? "bg-moss" : "bg-[#CFCABC]")
      }
    >
      <span
        className={
          "absolute top-[3px] left-[3px] w-[16px] h-[16px] rounded-full bg-white shadow transition-transform " +
          (checked ? "translate-x-[16px]" : "translate-x-0")
        }
      />
    </button>
  );
}

/** 分段选择（segment），用于二选一/三选一。 */
function Segment<T extends string>({
  options, value, onChange, labels,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="flex bg-[#F1EDE2] rounded-[10px] p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={
            "flex-1 rounded-[8px] px-2 py-1 text-[11px] font-semibold transition-colors " +
            (value === o ? "bg-white text-moss shadow-sm" : "text-ink-soft hover:text-ink")
          }
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

/** 单个设置行：左侧标签（含可选说明），右侧控件。 */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        {hint && <div className="text-[10.5px] text-ink-soft">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 分组标题。 */
function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <div className="pt-2.5 pb-1 text-[10.5px] font-bold tracking-wide text-[#A8A298] uppercase">{children}</div>
  );
}

/** 地图显示设置面板（M16）：右下角齿轮按钮 → 弹出，纯前端视图态。 */
export default function MapSettings({ value, onChange, panelOpen }: MapSettingsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // 点击面板外部关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const right = (panelOpen ? 400 : 0) + 16;
  const arrowScale = value.arrowScale;

  return (
    <div ref={ref} className="fixed bottom-4 z-[500] flex flex-col items-end gap-2" style={{ right }}>
      {open && (
        <div
          data-testid="map-settings-panel"
          className="w-[230px] bg-white border border-line rounded-[14px] shadow-card p-3"
        >
          <GroupTitle>路线</GroupTitle>
          <Row label="显示路线" hint="地图上的连线与箭头">
            <Toggle checked={value.showRoutes} onChange={(v) => onChange({ showRoutes: v })} />
          </Row>
          <Row label="天视图" hint="全部显示 / 只看当天">
            <Segment
              options={["all", "current"] as const}
              value={value.dayViewMode}
              onChange={(v) => onChange({ dayViewMode: v })}
              labels={{ all: "全部", current: "只看当天" }}
            />
          </Row>
          <Row label="连接酒店位置" hint="把酒店画进当天路线">
            <Toggle checked={value.connectHotel} onChange={(v) => onChange({ connectHotel: v })} />
          </Row>

          <GroupTitle>地图</GroupTitle>
          <Row label="地图源">
            <Segment
              options={["amap", "osm"] as const}
              value={value.mapSource}
              onChange={(v) => onChange({ mapSource: v })}
              labels={{ amap: "高德", osm: "OSM" }}
            />
          </Row>

          <GroupTitle>信息</GroupTitle>
          <Row label="AI 综合建议" hint="时间线顶部的建议块">
            <Toggle checked={value.showSummary} onChange={(v) => onChange({ showSummary: v })} />
          </Row>
          <Row label="价格/时间标签" hint="弹框与列表里的详情">
            <Toggle checked={value.showMeta} onChange={(v) => onChange({ showMeta: v })} />
          </Row>
          <Row label="箭头大小">
            <Segment
              options={["0.75", "1", "1.25"] as const}
              value={String(arrowScale)}
              onChange={(v) => onChange({ arrowScale: Number(v) })}
              labels={{ "0.75": "小", "1": "中", "1.25": "大" }}
            />
          </Row>
          <Row label="箭头密度" hint="路径上箭头疏密">
            <Segment
              options={["dense", "normal", "sparse"] as const}
              value={value.arrowDensity}
              onChange={(v) => onChange({ arrowDensity: v })}
              labels={{ dense: "密", normal: "中", sparse: "疏" }}
            />
          </Row>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="地图显示设置"
        aria-expanded={open}
        data-testid="settings-gear"
        className="w-11 h-11 rounded-full bg-white border border-line shadow-card text-moss text-xl flex items-center justify-center transition-colors hover:bg-moss-soft"
      >
        ⚙️
      </button>
    </div>
  );
}
