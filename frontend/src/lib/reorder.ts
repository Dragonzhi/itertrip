/**
 * M23：时间线排序的纯逻辑（触屏 ↑/↓ 按钮用；桌面 HTML5 拖拽不走这里）。
 *
 * 返回插入位 [dstDi, dstPi] —— dstPi 是"删除源项之前"的目标天索引，与 Plan.handleDropMove
 * 的契约完全一致（同天先删后插的补偿由 handleDropMove 做）。
 * 跨天规则：当天末项↓=下一天首位；当天首项↑=上一天末位。不可移动返回 null。
 */
export function moveTarget(
  days: { places: unknown[] }[],
  di: number,
  pi: number,
  dir: -1 | 1,
): [number, number] | null {
  const day = days[di];
  if (!day || pi < 0 || pi >= day.places.length) return null;
  const n = day.places.length;
  if (dir === 1) {
    if (pi + 1 < n) return [di, pi + 2];                       // 同天：+2 抵消 handleDropMove 的 -1 补偿
    return di + 1 < days.length ? [di + 1, 0] : null;          // 末项 → 下一天首位
  }
  if (pi > 0) return [di, pi - 1];
  return di > 0 ? [di - 1, days[di - 1].places.length] : null; // 首项 → 上一天末位
}
