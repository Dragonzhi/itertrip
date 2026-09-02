import { useCallback, useRef, useState } from "react";
import type { RouteJSON } from "../types/route";

/**
 * 行程编辑历史栈（移植自旧版模板，模型红线见 DESIGN §7.7）：
 * 每次编辑「变更完成后」push 新快照，idx 指向当前帧；
 * undo 取 idx-1、redo 取 idx+1。上限 50 帧，超出丢最旧帧。
 * push 后在 idx+1 之后的所有帧被截断（分叉）。
 *
 * M14 修复：mutate 改为「同步快照」——以 routeRef 为基线深拷贝后应用 updater，
 * 不再依赖 React updater 的急切求值。此前实现里，异步回调（AI 修改）先 setState
 * 其他状态会让 fiber 带 pending 更新，updater 延迟到渲染期才跑，微任务推帧时
 * 快照还是 null，导致「路线变了但历史栈为空」的静默丢帧。
 */
export function useTripHistory(initial: RouteJSON) {
  const [route, setRouteState] = useState<RouteJSON>(initial);
  const routeRef = useRef<RouteJSON>(initial);
  const historyRef = useRef<RouteJSON[]>([JSON.parse(JSON.stringify(initial))]);
  const idxRef = useRef(0);
  // 版本号仅用于让 undo/redo 后触发重渲染（route 引用可能相同形状）
  const [, bump] = useState(0);

  const pushFrame = useCallback((snapshot: RouteJSON) => {
    const h = historyRef.current;
    historyRef.current = h.slice(0, idxRef.current + 1);
    historyRef.current.push(JSON.parse(JSON.stringify(snapshot)));
    if (historyRef.current.length > 50) historyRef.current.shift();
    idxRef.current = historyRef.current.length - 1;
  }, []);

  /** 编辑入口：同步应用变更 + 同步推历史帧（异步回调/批处理安全）。 */
  const mutate = useCallback(
    (updater: (draft: RouteJSON) => void) => {
      const next = JSON.parse(JSON.stringify(routeRef.current)) as RouteJSON;
      updater(next);
      routeRef.current = next;
      setRouteState(next);
      pushFrame(next);
      bump((v) => v + 1);
    },
    [pushFrame],
  );

  const undo = useCallback(() => {
    if (idxRef.current <= 0) return;
    idxRef.current -= 1;
    const frame = JSON.parse(JSON.stringify(historyRef.current[idxRef.current])) as RouteJSON;
    routeRef.current = frame;
    setRouteState(frame);
    bump((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (idxRef.current >= h.length - 1) return;
    idxRef.current += 1;
    const frame = JSON.parse(JSON.stringify(h[idxRef.current])) as RouteJSON;
    routeRef.current = frame;
    setRouteState(frame);
    bump((v) => v + 1);
  }, []);

  const canUndo = idxRef.current > 0;
  const canRedo = idxRef.current < historyRef.current.length - 1;

  return { route, mutate, undo, redo, canUndo, canRedo };
}
