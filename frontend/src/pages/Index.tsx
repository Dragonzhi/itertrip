import { useRef } from "react";
import type { RouteJSON } from "../types/route";
import { parseRouteFile } from "../lib/routeImport";

interface IndexProps {
  onChat: (prefill?: string) => void;
  /** 直接进入地图（已有行程则进规划页，否则转去对话生成） */
  onEnterMap: () => void;
  onOpenSettings: () => void;
  hasModel: boolean;
  /** 是否已有已生成的行程可进入 */
  hasRoute: boolean;
  /** 导入行程 JSON / 导出 HTML，解析成功后进入规划页 */
  onImportRoute: (route: RouteJSON) => void;
  /** resume 态下用于右侧行程预览卡（不传则降级为静态占位） */
  route?: RouteJSON | null;
}

/** 起始页 v2：
 * - empty 态（无 route）：左列 hero + AI 对话主操作 + 粘贴攻略/导入入口；
 *   右列 = 「三步拿到路线」说明卡（**不显示任何行程数据**，避免空态被误读为已规划）
 * - resume 态（有 route）：左列「继续你的行程」操作组（主路径仍保留 AI 对话为一等入口）；
 *   右列 = 真实行程预览卡（D1/D2/D3 分组 + 角标 + 状态条）
 * 两态共用 brand-bar / page-foot / 7-5 几何、暖纸底色与墨绿主色（DESIGN §1）。 */
export default function Index({
  onChat,
  onEnterMap,
  onOpenSettings,
  hasModel,
  hasRoute,
  onImportRoute,
  route,
}: IndexProps) {
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-[100dvh] bg-cream flex flex-col">
      <BrandBar onOpenSettings={onOpenSettings} />

      <main className="flex-1">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-6 sm:px-4 pt-14">
          <div className="home-grid">
            {hasRoute ? (
              <ResumeCol onChat={onChat} onEnterMap={onEnterMap} onPickFile={pickFile} />
            ) : (
              <EmptyCol onChat={onChat} onOpenSettings={onOpenSettings} hasModel={hasModel} onPickFile={pickFile} />
            )}
            {hasRoute ? <RoutePreviewCard route={route} /> : <HowItWorksCard />}
          </div>
        </div>
      </main>

      {/* 隐藏的文件选择器：在主页面挂一份，避免在两个分支里各挂一次造成 DOM 重复 */}
      <input
        ref={importRef}
        type="file"
        accept=".json,.html,.htm,application/json,text/html"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 允许重复选择同一文件
          if (!f) return;
          try {
            const r = parseRouteFile(await f.text(), f.name);
            onImportRoute(r);
          } catch (err) {
            window.alert(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      <PageFoot />
    </div>
  );

  function pickFile() {
    importRef.current?.click();
  }
}

/* ==================== 顶部 brand-bar ==================== */

function BrandBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className="w-full border-b border-line bg-cream">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-4 flex items-center justify-between gap-4 py-[22px]">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-lg bg-moss text-white text-base shrink-0"
            aria-hidden
          >
            🧭
          </span>
          <div className="flex flex-col gap-1.5 min-w-0">
            <h1 className="text-[17px] font-bold leading-tight tracking-tight text-ink">IterTrip</h1>
            <p className="text-[10px] font-medium leading-snug tracking-[0.2em] text-ink-soft">
              LATIN · ITER · ROAD
            </p>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className="shrink-0 inline-flex items-center justify-center gap-2 h-9 px-3.5 border border-line rounded-lg text-ink-soft text-[13px] font-medium leading-none hover:bg-moss-soft hover:text-ink transition-colors focus-ring"
          data-testid="settings-btn"
        >
          <span aria-hidden>⚙️</span>
          <span>模型设置</span>
        </button>
      </div>
    </header>
  );
}

/* ==================== empty 态 · 左列 ==================== */

function EmptyCol({
  onChat,
  onOpenSettings,
  hasModel,
  onPickFile,
}: {
  onChat: () => void;
  onOpenSettings: () => void;
  hasModel: boolean;
  onPickFile: () => void;
}) {
  return (
    <section className="flex flex-col min-w-0">
      <h2 className="m-0 text-[44px] sm:text-[28px] font-bold leading-[1.2] tracking-tight text-ink text-balance">
        跟 AI 说去哪
      </h2>
      <p className="mt-4 max-w-[36em] text-[15px] leading-[1.7] text-ink-soft">
        直接说想去哪、玩几天，AI 把它排成一张可编辑的地图路线。
        <br />
        生成后可对话修改、拖拽精修、随时撤销，满意了导出带走。
      </p>

      {/* paste-shell：左侧占位输入 + 右侧主按钮（hover 时箭头右移 2px） */}
      <div className="mt-8 flex items-center gap-2 w-full p-1.5 bg-white border border-line rounded-lg hover:border-moss focus-within:border-moss transition-colors">
        <button
          type="button"
          onClick={() => onChat()}
          className="flex items-center gap-2.5 flex-1 min-w-0 h-11 px-3 bg-transparent border-0 rounded-md text-ink-soft font-sans cursor-pointer text-left"
          data-testid="chat-entry"
        >
          <span aria-hidden className="text-base shrink-0">
            💬
          </span>
          <span className="text-[15px] leading-snug truncate">
            跟 AI 说：想去成都 3 天，节奏松一点
          </span>
        </button>
        <button
          type="button"
          onClick={() => onChat()}
          className="shrink-0 inline-flex items-center justify-center gap-2 h-11 px-[18px] bg-moss text-white border border-moss rounded-md font-sans text-[14px] font-medium leading-none hover:bg-[#175740] hover:border-[#175740] transition-colors focus-ring"
          data-testid="chat-submit-entry"
        >
          <span>开始对话</span>
          <span aria-hidden className="text-[14px]">
            →
          </span>
        </button>
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-ink-soft">
        或者在下方粘贴一篇现成攻略，让 AI 提取成路线
      </p>

      <div className="mt-3 flex flex-wrap gap-3 w-full">
        <button
          type="button"
          onClick={() => onChat()}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 bg-white text-ink border border-line rounded-md font-sans text-[14px] font-medium leading-none hover:border-moss hover:text-moss transition-colors focus-ring"
          data-testid="paste-guide-entry"
        >
          <span aria-hidden className="text-[14px]">
            📋
          </span>
          <span>粘贴攻略</span>
        </button>
        <button
          type="button"
          onClick={onPickFile}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 bg-white text-ink border border-line rounded-md font-sans text-[14px] font-medium leading-none hover:border-moss hover:text-moss transition-colors focus-ring"
          data-testid="import-entry"
        >
          <span aria-hidden className="text-[14px]">
            📂
          </span>
          <span>导入已有行程</span>
        </button>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-ink-soft">
        支持粘贴文字或上传攻略截图；行程只存本机浏览器。
      </p>

      {!hasModel && (
        <div className="mt-6 flex items-center justify-center gap-2 w-full px-3.5 py-2.5 bg-gold-soft text-gold-deep rounded-md text-[12px] leading-relaxed text-center">
          <span aria-hidden>
            ✨
          </span>
          <span>
            当前使用内置免费供应商（真实 AI 规划，无需配置）。
            想用你自己的模型，可
            <button
              onClick={onOpenSettings}
              className="underline font-semibold mx-0.5 rounded hover:text-ink focus-ring"
            >
              配置模型
            </button>
            。
          </span>
        </div>
      )}
    </section>
  );
}

/* ==================== resume 态 · 左列 ==================== */

function ResumeCol({
  onChat,
  onEnterMap,
  onPickFile,
}: {
  onChat: () => void;
  onEnterMap: () => void;
  onPickFile: () => void;
}) {
  return (
    <section className="flex flex-col min-w-0">
      <h2 className="m-0 text-[44px] sm:text-[28px] font-bold leading-[1.2] tracking-tight text-ink text-balance">
        继续你的行程
      </h2>
      <p className="mt-4 max-w-[36em] text-[15px] leading-[1.7] text-ink-soft">
        上次的路线还在，接着改就好。
        <br />
        可以让 AI 继续改，也可以拖拽精修，或另起一条新行程。
      </p>

      <div className="mt-8 flex flex-col w-full min-w-0 gap-3">
        {/* 主按钮：回到地图继续编辑 */}
        <button
          type="button"
          onClick={onEnterMap}
          className="inline-flex items-center justify-center gap-2.5 w-full h-11 px-[18px] bg-moss text-white border border-moss rounded-md font-sans text-[14px] font-medium leading-none hover:bg-[#175740] hover:border-[#175740] transition-colors focus-ring"
          data-testid="resume-trip-entry"
        >
          <span aria-hidden>
            📍
          </span>
          <span>继续编辑行程</span>
        </button>

        {/* 次按钮：白底描边整宽，让 AI 对话在已行程态仍是一等入口 */}
        <button
          type="button"
          onClick={() => onChat()}
          className="inline-flex items-center justify-center gap-2 w-full h-11 px-[18px] bg-white text-ink border border-line rounded-md font-sans text-[14px] font-medium leading-none hover:border-moss hover:text-moss transition-colors focus-ring"
          data-testid="chat-resume-entry"
        >
          <span aria-hidden>
            💬
          </span>
          <span>和 AI 继续改这条行程</span>
        </button>

        <div className="mt-3 flex flex-wrap gap-3 w-full">
          <button
            type="button"
            onClick={() => onChat()}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 bg-white text-ink border border-line rounded-md font-sans text-[14px] font-medium leading-none hover:border-moss hover:text-moss transition-colors focus-ring"
            data-testid="new-trip-entry"
          >
            <span aria-hidden className="text-[14px]">
              ＋
            </span>
            <span>新建行程</span>
          </button>
          <button
            type="button"
            onClick={onPickFile}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 bg-white text-ink border border-line rounded-md font-sans text-[14px] font-medium leading-none hover:border-moss hover:text-moss transition-colors focus-ring"
            data-testid="import-entry"
          >
            <span aria-hidden className="text-[14px]">
              📂
            </span>
            <span>导入已有行程</span>
          </button>
        </div>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-ink-soft">
        继续后会回到地图与时间线，所有改动都可以撤销。
      </p>

      <div className="mt-6 flex items-center justify-center gap-2 w-full px-3.5 py-2.5 bg-gold-soft text-gold-deep rounded-md text-[12px] leading-relaxed text-center">
        <span aria-hidden>
          ✨
        </span>
        <span>行程存在本机浏览器，换设备需要先导出。</span>
      </div>
    </section>
  );
}

/* ==================== empty 态 · 右列：三步拿到路线 ==================== */

function HowItWorksCard() {
  return (
    <aside className="home-card" data-testid="how-it-works">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-[18px] font-bold leading-snug text-ink">三步拿到路线</h3>
        <span className="inline-flex items-center justify-center h-6 px-2.5 bg-moss-soft text-[#175740] rounded-full text-[11px] font-medium leading-none whitespace-nowrap">
          无需配置
        </span>
      </div>

      <ol className="mt-5 flex flex-col gap-5 list-none p-0 m-0">
        {[
          { num: "01", name: "说出你想去哪", desc: "一句话描述目的地、天数和节奏" },
          { num: "02", name: "AI 生成路线", desc: "自动提取地点、排好顺序、补上坐标" },
          { num: "03", name: "地图上继续改", desc: "对话改、拖拽精修、随时撤销，最后导出带走" },
        ].map((s, i) => (
          <li
            key={s.num}
            className={`grid grid-cols-[24px_minmax(0,1fr)] gap-3 items-start${i > 0 ? " pt-5 border-t border-line" : ""}`}
          >
            <span className="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-moss-soft text-[#175740] text-[11px] font-bold leading-none tabular-nums">
              {s.num}
            </span>
            <span className="flex flex-col gap-2 min-w-0">
              <span className="text-[15px] font-semibold leading-snug text-ink">{s.name}</span>
              <span className="text-[12px] leading-relaxed text-ink-soft">{s.desc}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex items-center gap-2 px-3 py-2.5 bg-moss-soft rounded-md">
        <span aria-hidden className="text-[18px] text-moss">
          🛡
        </span>
        <span className="text-[12px] leading-snug text-ink-soft">数据只存本机浏览器，不上传服务器</span>
      </div>
    </aside>
  );
}

/* ==================== resume 态 · 右列：行程预览卡 ==================== */

function RoutePreviewCard({ route }: { route?: RouteJSON | null }) {
  const days = route?.days ?? [];
  const title = route?.trip.title ?? "（未命名行程）";
  const destination = route?.trip.destination ?? "";
  const dayCount = route?.trip.days ?? days.length;

  return (
    <aside className="home-card" data-testid="route-preview">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <h3 className="m-0 text-[18px] font-bold leading-snug text-ink truncate">{title}</h3>
          <p className="m-0 text-[11px] leading-snug text-ink-soft">
            路线可拖拽调整 · 对话随时改
          </p>
        </div>
        <span className="inline-flex items-center justify-center h-6 px-2.5 bg-moss-soft text-[#175740] rounded-full text-[11px] font-medium leading-none whitespace-nowrap shrink-0">
          {dayCount > 0 ? `${destination} · ${dayCount} 天` : "上次编辑"}
        </span>
      </div>

      {days.length > 0 ? (
        <div className="mt-5 flex flex-col gap-5">
          {days.map((d, idx) => {
            const colorVar = (idx % 3) + 1;
            const colorClass =
              colorVar === 1 ? "bg-day-1" : colorVar === 2 ? "bg-day-2" : "bg-day-3";
            return (
              <div key={d.day} className="flex flex-col gap-2 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 shrink-0 rounded-full ${colorClass}`} aria-hidden />
                  <span className="text-[12px] font-bold leading-snug tracking-[0.08em] text-ink">
                    D{d.day}
                  </span>
                  <span className="ml-auto text-[11px] leading-snug text-ink-soft">
                    {d.places.length} 个地点
                  </span>
                </div>
                <ul className="flex flex-col m-0 p-0 list-none min-w-0">
                  {d.places.map((p, i) => (
                    <li
                      key={i}
                      className={`flex items-center gap-3 py-2 min-w-0${i > 0 ? " border-t border-line" : ""}`}
                    >
                      <span className="shrink-0 w-4 text-[11px] font-medium leading-snug text-center text-ink-soft tabular-nums">
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 text-[14px] leading-snug text-ink truncate">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-[12px] leading-snug text-ink-soft whitespace-nowrap">
                        {p.time || (p.ticket ? `门票 ${p.ticket}` : "")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-5 text-[12px] leading-relaxed text-ink-soft">
          （行程数据尚未生成，进入规划页后可手动补全）
        </p>
      )}

      <div className="mt-5 flex items-center flex-wrap gap-2 px-3 py-2.5 bg-moss-soft rounded-md">
        <span aria-hidden className="text-[18px] text-moss">
          ✓
        </span>
        <span className="text-[13px] font-bold leading-snug text-[#175740] whitespace-nowrap">
          已规划
        </span>
        <span className="text-[11px] leading-snug text-ink-soft">
          接着上次的进度继续调整
        </span>
      </div>
    </aside>
  );
}

/* ==================== 底部信息条 ==================== */

function PageFoot() {
  const adminHref = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "") + "/admin";
  return (
    <footer className="w-full mt-16 border-t border-line">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-4 flex items-center justify-between flex-wrap gap-4 py-4 pb-2">
        <p className="m-0 text-[12px] leading-relaxed text-ink-soft">
          价格由用户手动提供 · 数据只存本机浏览器
        </p>
        <a
          href={adminHref}
          className="text-[12px] leading-relaxed text-ink-soft underline underline-offset-[3px] decoration-[1px] decoration-line hover:text-moss hover:decoration-moss transition-colors focus-ring"
          title="服务端 AI 服务管理"
        >
          后台
        </a>
      </div>
    </footer>
  );
}
