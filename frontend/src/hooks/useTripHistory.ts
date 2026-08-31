import { useCallback, useRef, useState } from "react";
import type { RouteJSON } from "../types/route";

/**
 * 行程编辑历史栈（移植自旧版模板，模型红线见 DESIGN §7.7）：
 * 每次编辑「变更完成后」push 新快照，idx 指向当前帧；
 * undo 取 idx-1、redo 取 idx+1。上限 50 帧，超出丢最旧帧。
 * push 后在 idx+1 之后的所有帧被截断（分叉）。
 */
export function useTripHistory(initial: RouteJSON) {
  const [route, setRouteState] = useState<RouteJSON>(initial);
  const historyRef = useRef<RouteJSON[]>([JSON.parse(JSON.stringify(initial))]);
  const idxRef = useRef(0);
  // 版本号仅用于让 undo/redo 后触发重渲染（route 引用可能相同形状）
  const [, bump] = useState(0);

  /** 变更完成后调用：当前 route 压入历史。 */
  const pushHistory = useCallback(
    (snapshot: RouteJSON) => {
      const h = historyRef.current;
      historyRef.current = h.slice(0, idxRef.current + 1);
      historyRef.current.push(JSON.parse(JSON.stringify(snapshot)));
      if (historyRef.current.length > 50) historyRef.current.shift();
      idxRef.current = historyRef.current.length - 1;
    },
    [],
  );

  /** 编辑入口：setRoute 变更 + pushHistory 一体化（reducer 风格，防漏推帧）。 */
  const mutate = useCallback(
    (updater: (draft: RouteJSON) => void) => {
      let snap: RouteJSON | null = null;
      setRouteState((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as RouteJSON;
        updater(next);
        snap = next;
        return next;
      });
      // React 18 StrictMode 下 updater 可能跑两次，snap 取最后一次即可（幂等）
      Promise.resolve().then(() => {
        if (snap) {
          const h = historyRef.current;
          historyRef.current = h.slice(0, idxRef.current + 1);
          historyRef.current.push(JSON.parse(JSON.stringify(snap)));
          if (historyRef.current.length > 50) historyRef.current.shift();
          idxRef.current = historyRef.current.length - 1;
          bump((v) => v + 1);
        }
      });
    },
    [],
  );

  const undo = useCallback(() => {
    if (idxRef.current <= 0) return;
    idxRef.current -= 1;
    setRouteState(JSON.parse(JSON.stringify(historyRef.current[idxRef.current])));
    bump((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (idxRef.current >= h.length - 1) return;
    idxRef.current += 1;
    setRouteState(JSON.parse(JSON.stringify(h[idxRef.current])));
    bump((v) => v + 1);
  }, []);

  const canUndo = idxRef.current > 0;
  const canRedo = idxRef.current < historyRef.current.length - 1;

  return { route, mutate, pushHistory, undo, redo, canUndo, canRedo };
}