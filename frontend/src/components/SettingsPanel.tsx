import { useEffect, useState } from "react";
import { testLlm } from "../api/client";
import type { LlmSettings } from "../lib/settings";

interface SettingsPanelProps {
  settings: LlmSettings;
  onChange: (patch: Partial<LlmSettings>) => void;
  onClose: () => void;
}

interface TestState {
  status: "idle" | "testing" | "ok" | "fail";
  message: string;
  source?: string;
}

/** M12 BYOK 设置面板（DESIGN.md §4.1）：key 存本地，测试连接探测视觉能力。 */
export default function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const [test, setTest] = useState<TestState>({ status: "idle", message: "" });
  const [showKey, setShowKey] = useState(false);

  // Esc 关闭（表单内 Escape 不触发地图逻辑，独立处理）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleTest = async () => {
    setTest({ status: "testing", message: "连接中…" });
    try {
      const r = await testLlm(settings);
      if (r.ok) {
        const vis = r.vision ? "✓ 支持图片输入" : "✗ 不支持图片输入（截图攻略入口将置灰）";
        setTest({
          status: "ok",
          source: r.source,
          message: `连接成功 · ${r.model} · ${vis}`,
        });
        onChange({ vision: r.vision });
      } else {
        setTest({ status: "fail", source: r.source, message: r.message });
      }
    } catch (e) {
      setTest({ status: "fail", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const inputCls =
    "border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss";

  return (
    <div className="fixed inset-0 z-[700] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="模型设置"
        className="bg-white border border-line rounded-[18px] shadow-card p-6 w-full max-w-md flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">⚙️ 模型设置</h2>
          <button onClick={onClose} className="text-ink-soft hover:text-ink text-lg leading-none" aria-label="关闭">
            ✕
          </button>
        </div>

        <p className="text-xs text-ink-soft leading-relaxed">
          填入任意 OpenAI 兼容服务的地址与 Key（DeepSeek / 通义千问-VL / 智谱 / OpenAI…）。
          Key 只保存在本机浏览器（localStorage），请求经本机后端转发，不上传任何第三方。
        </p>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          Base URL
          <input
            value={settings.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com"
            className={inputCls}
            spellCheck={false}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          API Key
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={settings.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder="sk-…"
              className={inputCls + " flex-1"}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="border border-line rounded-lg px-2.5 text-xs text-ink-soft hover:bg-moss-soft"
            >
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          模型名
          <input
            value={settings.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="如 qwen-vl-max / glm-4v-plus / gpt-4o-mini（攻略截图需要 VLM）"
            className={inputCls}
            spellCheck={false}
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={test.status === "testing"}
            className="border border-moss text-moss rounded-lg px-3.5 py-2 text-xs font-semibold hover:bg-moss-soft disabled:opacity-40"
          >
            {test.status === "testing" ? "测试中…" : "测试连接"}
          </button>
          {test.status === "ok" && (
            <span className="text-xs text-moss bg-moss-soft rounded-lg px-2.5 py-1.5" data-testid="llm-test-ok">
              {test.message}
            </span>
          )}
          {test.status === "fail" && (
            <span className="text-xs text-[#B85C5C] bg-[#F6E7E7] rounded-lg px-2.5 py-1.5 flex-1" data-testid="llm-test-fail">
              {test.message}
            </span>
          )}
        </div>

        <div className="border-t border-line pt-3 text-[11px] text-ink-soft leading-relaxed">
          未配置时：若本机后端设置了 ITERTRIP_LLM_* 环境变量则使用之；两者皆无则进入
          <b>内置演示模式</b>（mock 草稿，无需 key 即可体验完整编辑流程）。
          <span className="block mt-1">
            提示：模型名与 Base URL 必须匹配（纯文本模型如 deepseek-chat 无视觉能力，会显示「不支持图片输入」；
            DeepSeek 官方暂无 VLM，推荐通义千问-VL / 智谱 GLM-4V / GPT-4o 等）。
          </span>
          {test.source === "env" && <span className="block mt-1 text-moss">当前测试使用的是服务端环境变量配置。</span>}
        </div>
      </div>
    </div>
  );
}