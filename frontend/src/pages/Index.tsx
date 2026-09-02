interface IndexProps {
  onChat: (prefill?: string) => void;
  /** 直接进入地图（已有行程则进规划页，否则转去对话生成） */
  onEnterMap: () => void;
  onOpenSettings: () => void;
  hasModel: boolean;
  /** 是否已有已生成的行程可进入 */
  hasRoute: boolean;
}

/** 首页：两个主入口——AI 对话 / 直接进入地图。 */
export default function Index({ onChat, onEnterMap, onOpenSettings, hasModel, hasRoute }: IndexProps) {
  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center p-6 gap-6">
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
          💬 AI 对话，生成行程
        </button>
        <button
          onClick={onEnterMap}
          className="border border-moss text-moss rounded-xl py-3 text-sm font-bold hover:bg-moss-soft transition-colors flex items-center justify-center gap-2"
          data-testid="map-entry"
        >
          🗺 直接进入地图
          {hasRoute ? "" : "（先去对话生成）"}
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

      <p className="text-[11px] text-[#A8A298]">价格由用户手动提供 · 数据只存本机浏览器</p>
    </div>
  );
}
