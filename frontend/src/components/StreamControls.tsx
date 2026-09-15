import { useElapsed } from "../hooks/useElapsed";
import type { StreamHealth } from "../lib/streamWatch";

interface StatusProps {
  active: boolean;
  stageLabel: string | null;
  /** 正文是否已经开始流出（还没出字时给一句安慰文案） */
  text: string;
  idleMs: number;
  health: StreamHealth;
  sawPing: boolean;
  /** 文案口径：首页是「提取攻略」，规划页是「改路线」 */
  variant: "extract" | "edit";
}

/** 三颗呼吸点：只在收到过心跳时出现，等于把「服务端每 ~2s 回一次」画出来。 */
function HeartDots({ slow }: { slow: boolean }) {
  return (
    <span className="heart-dots shrink-0" aria-hidden="true" style={slow ? { opacity: 0.5 } : undefined}>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * 运行中的状态块（优化②，方向乙「状态胶囊」）：阶段名 + 心跳点 + 计时收成一枚胶囊；
 * 静默时整枚变金/变红，其中红态直接写明「可能已断开 · 可点停止后重试」。
 * 无思考链的模型以前只能靠总计时判断是否还在跑；现在「多久没收到服务端消息」直接可见。
 */
export function StreamStatus({ active, stageLabel, text, idleMs, health, sawPing, variant }: StatusProps) {
  const elapsed = useElapsed(active);
  const stalled = health === "stalled";
  const slow = health === "slow";
  const pill = "inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full border " +
    (stalled ? "border-[#E0C3C3] bg-[#FDF4F4] text-[#B85C5C]" : slow ? "border-[#E4CEA6] bg-[#FDF9F1] text-[#8A6428]" : "border-line bg-white text-ink");
  const dot = stalled ? "bg-[#B85C5C]" : slow ? "bg-gold" : "bg-moss animate-pulse";
  return (
    <div className="space-y-1.5" data-testid="stream-status">
      <div className={pill}>
        <span className={"inline-block w-1.5 h-1.5 rounded-full shrink-0 " + dot} />
        <span className="truncate text-xs font-semibold">{stageLabel || "AI 正在思考…"}</span>
        {sawPing && !stalled && <HeartDots slow={slow} />}
        <span className="ml-0.5 font-mono text-[11px] text-ink-soft/70 shrink-0" data-testid="elapsed">
          ⏱ {elapsed}s
        </span>
        {stalled && <span className="font-mono text-[11px] shrink-0">{Math.floor(idleMs / 1000)}s 无响应</span>}
      </div>
      {health === "ok" && sawPing && (
        <div className="text-[10px] text-ink-soft/70 px-1" data-testid="stream-idle">
          {idleMs < 2500 ? "服务端刚刚有响应" : Math.floor(idleMs / 1000) + "s 前有响应"}
        </div>
      )}
      {health !== "ok" && (
        <div
          data-testid="stream-stalled"
          className={
            "text-[11px] px-2 py-1.5 rounded-lg leading-relaxed mx-1 " +
            (slow ? "bg-gold-soft/60 text-[#8A6428]" : "bg-[#F6E7E7] text-[#B85C5C] border border-[#E0C3C3]")
          }
        >
          {slow
            ? "服务端这一跳变慢了，仍在等待…"
            : "已经 " + Math.floor(idleMs / 1000) + " 秒没有任何服务端响应，可能已断开 —— 可点「停止」后重试"}
        </div>
      )}
      {!text && (
        <div className="text-[11px] text-ink-soft/70 px-1 leading-relaxed" data-testid="wait-hint">
          {elapsed < 8
            ? variant === "extract"
              ? "模型排队中，免费源首字常需 10–30 秒…"
              : "模型排队中，通常 10–30 秒…"
            : elapsed < 45
              ? variant === "extract"
                ? "仍在生成中，长攻略 / 多张截图会更久，请稍候…"
                : "仍在生成中，复杂改动会更久，请稍候…"
              : "快好了，复杂解析需要更长时间；若超过 3 分钟可点「停止」重试…"}
        </div>
      )}
    </div>
  );
}

interface BtnProps {
  sending: boolean;
  /** 空闲态的禁用条件（无输入 / 图片处理中） */
  disabled?: boolean;
  onStop: () => void;
  size?: "sm" | "md";
}

/**
 * 发送 ↔ 停止：**同一个位置、同一尺寸**切换（min-w 固定，运行中输入框不跳位）。
 * 停止按钮只在运行时存在，所以「发送」的 data-testid 在运行时变成 stop-btn。
 */
export function SendStopButton({ sending, disabled, onStop, size = "md" }: BtnProps) {
  const base = size === "sm" ? "px-3.5 py-2.5 text-[13px]" : "px-4 py-2.5 text-sm";
  if (sending) {
    return (
      <button
        type="button"
        onClick={onStop}
        title="停止生成（Esc）"
        data-testid="stop-btn"
        className={"min-w-[64px] rounded-xl font-bold border border-[#E0C3C3] bg-[#F6E7E7] text-[#B85C5C] hover:bg-[#EFD9D9] " + base}
      >
        ■ 停止
      </button>
    );
  }
  return (
    <button
      type="submit"
      disabled={disabled}
      data-testid="send-btn"
      className={"min-w-[64px] rounded-xl font-bold bg-moss text-white hover:bg-[#175740] disabled:opacity-40 disabled:cursor-not-allowed " + base}
    >
      发送
    </button>
  );
}
