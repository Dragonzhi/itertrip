import { useEffect, useRef, useState } from "react";
import {
  deleteAdminProvider,
  getAdminStatus,
  saveAdminProvider,
  testAdminProvider,
  type AdminStatus,
  type AdminTestResult,
} from "../api/client";

const TOKEN_KEY = "itertrip:admin_token";

/** 从 URL ?admin_token=xxx 读取并清除（避免 token 留在历史/分享链接里）。 */
function extractTokenFromUrl(): string {
  const url = new URL(location.href);
  const token = url.searchParams.get("admin_token") || "";
  if (token) {
    url.searchParams.delete("admin_token");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  return token;
}

function sourceLabel(s: AdminStatus["active_source"]): string {
  switch (s) {
    case "env":
      return "服务端环境变量（ITERTRIP_LLM_*）";
    case "admin":
      return "后台管理配置";
    case "free":
      return "内置免费供应商（.env）";
    case "none":
      return "未配置（mock 演示模式）";
  }
}

interface TestState {
  status: "idle" | "testing" | "ok" | "fail";
  message: string;
  vision?: boolean;
}

/** M-Admin-1 后台页：管理免费 AI 服务（Key / 模型 / 启停 / 探测）。 */
export default function Admin() {
  const [token, setToken] = useState<string>(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [test, setTest] = useState<TestState>({ status: "idle", message: "" });
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);

  const initialized = useRef(false);

  // 登录：URL token > sessionStorage；拿到 token 后拉取配置
  useEffect(() => {
    const fromUrl = extractTokenFromUrl();
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      setToken(fromUrl);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    getAdminStatus(token)
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        if (!initialized.current) {
          initialized.current = true;
          setName(s.provider.name);
          setBaseUrl(s.provider.base_url);
          setModel(s.provider.model);
          setEnabled(s.provider.enabled);
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  const handleLogin = (t: string) => {
    sessionStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setStatus(null);
    initialized.current = false;
  };

  const handleTest = async () => {
    setTest({ status: "testing", message: "连接中…" });
    setSavedMsg("");
    try {
      const r: AdminTestResult = await testAdminProvider(token, { base_url: baseUrl, api_key: apiKey, model });
      if (r.ok) {
        setTest({
          status: "ok",
          message: "连接成功 · " + r.model + " · " + (r.vision ? "✓ 支持图片输入" : "✗ 不支持图片输入"),
          vision: r.vision,
        });
      } else {
        setTest({ status: "fail", message: r.message });
      }
    } catch (e) {
      setTest({ status: "fail", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg("");
    try {
      const s = await saveAdminProvider(token, { name, base_url: baseUrl, api_key: apiKey, model, enabled });
      setStatus(s);
      setApiKey("");
      setSavedMsg("已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    try {
      const s = await deleteAdminProvider(token);
      setStatus(s);
      setName("");
      setBaseUrl("");
      setApiKey("");
      setModel("");
      setEnabled(false);
      setConfirmingClear(false);
      setSavedMsg("已清空后台配置");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirmingClear(false);
    }
  };

  const inputCls =
    "border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss";

  return (
    <div className="min-h-screen bg-cream p-6">
      <div className="max-w-2xl mx-auto flex flex-col gap-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-2xl">🛠️</span>
            <div>
              <h1 className="text-lg font-extrabold tracking-wide">IterTrip 后台</h1>
              <p className="text-[10px] text-ink-soft tracking-[1px]">AI 服务管理 · ADMIN</p>
            </div>
          </div>
          <a href={import.meta.env.BASE_URL || "/"} className="text-xs text-moss font-semibold hover:underline">
            ← 返回前台
          </a>
        </header>

        {!token ? (
          <LoginCard onLogin={handleLogin} />
        ) : (
          <div className="bg-white border border-line rounded-[18px] shadow-card p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">免费 AI 服务配置</h2>
              <button onClick={handleLogout} className="text-xs text-ink-soft hover:text-ink">
                退出登录
              </button>
            </div>

            {error && (
              <div className="text-xs text-[#B85C5C] bg-[#F6E7E7] rounded-lg px-3 py-2" data-testid="admin-error">
                {error}
              </div>
            )}

            {loading && <p className="text-sm text-ink-soft">加载中…</p>}

            {!loading && status && (
              <>
                <div className="text-xs text-ink-soft bg-moss-soft rounded-lg px-3 py-2.5 leading-relaxed">
                  当前实际生效：<b className="text-moss">{sourceLabel(status.active_source)}</b>
                  {status.active_model && (
                    <span className="block mt-0.5">模型：{status.active_model}</span>
                  )}
                </div>

                <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
                  名称（备注用）
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：免费网关" className={inputCls} />
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
                  Base URL
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.dragonzhi.xyz"
                    className={inputCls}
                    spellCheck={false}
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
                  API Key
                  <div className="flex gap-2">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={status.provider.has_key ? "已配置（" + status.provider.api_key_masked + "），留空保持不变" : "sk-…"}
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
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="openrouter/free"
                    className={inputCls}
                    spellCheck={false}
                  />
                </label>

                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="w-4 h-4 accent-moss"
                    data-testid="admin-enabled"
                  />
                  启用（未启用时走环境变量 / .env / mock 链路）
                </label>

                {test.status !== "idle" && (
                  <div
                    className={
                      "text-xs rounded-lg px-3 py-2.5 leading-relaxed " +
                      (test.status === "ok"
                        ? "text-moss bg-moss-soft"
                        : test.status === "fail"
                          ? "text-[#B85C5C] bg-[#F6E7E7]"
                          : "text-ink-soft bg-cream")
                    }
                    data-testid="admin-test-result"
                  >
                    {test.message}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleTest}
                    disabled={test.status === "testing"}
                    className="border border-moss text-moss rounded-lg px-3.5 py-2 text-xs font-semibold hover:bg-moss-soft disabled:opacity-40"
                  >
                    {test.status === "testing" ? "探测中…" : "探测连接"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-moss text-white rounded-lg px-4 py-2 text-xs font-bold hover:bg-[#175740] disabled:opacity-40"
                    data-testid="admin-save"
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                  {savedMsg && <span className="text-xs text-moss">{savedMsg}</span>}
                  <button
                    onClick={handleClear}
                    className="ml-auto text-xs text-[#B85C5C] hover:underline"
                    data-testid="admin-clear"
                  >
                    {confirmingClear ? "再次点击确认清空" : "清空配置"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LoginCard({ onLogin }: { onLogin: (token: string) => void }) {
  const [input, setInput] = useState("");
  return (
    <div className="bg-white border border-line rounded-[18px] shadow-card p-6 flex flex-col gap-4">
      <h2 className="text-base font-bold">🔐 需要登录</h2>
      <p className="text-xs text-ink-soft leading-relaxed">
        请输入后台管理 token（服务器 .env 中的 ITERTRIP_ADMIN_TOKEN）。
        也可以在地址栏直接访问 <code className="bg-cream px-1 rounded">/admin?admin_token=你的token</code> 自动登录。
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && input.trim() && onLogin(input.trim())}
          placeholder="admin token"
          className="border border-line rounded-lg px-3 py-2 text-sm flex-1 focus:outline-2 focus:outline-moss-soft focus:border-moss"
          autoComplete="off"
        />
        <button
          onClick={() => input.trim() && onLogin(input.trim())}
          disabled={!input.trim()}
          className="bg-moss text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-[#175740] disabled:opacity-40"
        >
          登录
        </button>
      </div>
    </div>
  );
}
