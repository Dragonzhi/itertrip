import { useEffect, useMemo, useState } from "react";
import Chat from "./pages/Chat";
import Index from "./pages/Index";
import Plan from "./pages/Plan";
import SettingsPanel from "./components/SettingsPanel";
import { planTrip } from "./api/client";
import {
  loadCurrentRoute,
  loadSettings,
  saveCurrentRoute,
  saveSettings,
  type LlmSettings,
} from "./lib/settings";
import type { PlanRequest, RouteJSON } from "./types/route";

type Screen = { name: "index" } | { name: "chat"; prefill?: string } | { name: "plan"; source: string };

/** 应用根组件：首页 ↔ 对话页 ↔ 规划页；route 持久化于 localStorage，刷新可恢复。 */
export default function App() {
  const [settings, setSettings] = useState<LlmSettings>(() => loadSettings());
  const [screen, setScreen] = useState<Screen>(() =>
    loadCurrentRoute() ? { name: "plan", source: "restored" } : { name: "index" },
  );
  const [route, setRoute] = useState<RouteJSON | null>(() => loadCurrentRoute());
  const [chatPrefill, setChatPrefill] = useState<string | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => {
    if (route) saveCurrentRoute(route);
  }, [route]);
  // hash #chat = 对话屏（Plan 页返回对话用）
  useEffect(() => {
    if (screen.name === "chat" && location.hash !== "#chat") {
      location.hash = "chat";
    }
    if (screen.name !== "chat" && location.hash === "#chat") {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, [screen.name]);

  const hasModel = useMemo(() => Boolean(settings.apiKey.trim() || settings.baseUrl.trim()), [settings]);

  const handleQuickStart = async (req: PlanRequest) => {
    setLoading(true);
    setError(null);
    try {
      const { route: r, source } = await planTrip(req, settings);
      setRoute(r);
      setScreen({ name: "plan", source });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleChatRoute = (r: RouteJSON, source: string) => {
    setRoute(r);
    setScreen({ name: "plan", source });
  };

  const patchSettings = (patch: Partial<LlmSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const openChat = (prefill?: string) => {
    setChatPrefill(prefill);
    setScreen({ name: "chat", prefill });
  };

  const backToIndex = () => {
    setChatPrefill(undefined);
    setScreen({ name: "index" });
  };

  if (screen.name === "plan" && route) {
    return (
      <>
        <Plan
          route={route}
          source={screen.source}
          onRouteChange={setRoute}
          onRestart={backToIndex}
          settings={settings}
        />
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={patchSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </>
    );
  }

  if (screen.name === "chat") {
    return (
      <>
        <Chat
          onRoute={handleChatRoute}
          onOpenSettings={() => setShowSettings(true)}
          onBack={backToIndex}
          prefill={chatPrefill}
          settings={settings}
        />
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={patchSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Index
        onQuickStart={handleQuickStart}
        onChat={openChat}
        onOpenSettings={() => setShowSettings(true)}
        hasModel={hasModel}
        loading={loading}
        error={error}
      />
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={patchSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}