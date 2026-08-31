import { useState } from "react";
import Index from "./pages/Index";
import Plan from "./pages/Plan";
import { planTrip } from "./api/client";
import type { PlanRequest, RouteJSON } from "./types/route";

type Screen = { name: "index" } | { name: "plan"; route: RouteJSON; source: string };

/** 应用根组件：首页 ↔ 规划页。route 数据由 /api/plan 返回，同一份也用于导出。 */
export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "index" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlan = async (req: PlanRequest) => {
    setLoading(true);
    setError(null);
    try {
      const { route, source } = await planTrip(req);
      setScreen({ name: "plan", route, source });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (screen.name === "plan") {
    return (
      <Plan
        route={screen.route}
        source={screen.source}
        onRestart={() => setScreen({ name: "index" })}
      />
    );
  }
  return <Index onPlan={handlePlan} loading={loading} error={error} />;
}
