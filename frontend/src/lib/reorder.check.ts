/**
 * reorder 自检（无框架，手写 assert）：node src/lib/reorder.check.ts
 * 关键点：这里模拟的 splice 顺序必须与 Plan.handleDropMove 逐字一致，
 * 否则"按钮点了不动/跳位"只会发生在真机上。
 */
import { moveTarget } from "./reorder.ts";

type Days = { places: number[] }[];
/** 全局唯一 id（跨天也不能重号，否则 flat 断言看不出串位） */
const days = (lens: number[]): Days => {
  let k = 0;
  return lens.map((n) => ({ places: Array.from({ length: n }, () => ++k) }));
};
const flat = (d: Days) => d.flatMap((x) => x.places);

/** 复刻 Plan.handleDropMove：同天且目标索引在原索引之后 → 先减 1 再删再插 */
function apply(src: Days, di: number, pi: number, dir: -1 | 1): Days | null {
  const t = moveTarget(src, di, pi, dir);
  if (!t) return null;
  const copy: Days = src.map((d) => ({ places: d.places.slice() }));
  let idx = t[1];
  if (t[0] === di && idx > pi) idx -= 1;
  const [moved] = copy[di].places.splice(pi, 1);
  copy[t[0]].places.splice(idx, 0, moved);
  return copy;
}
let n = 0;
const eq = (got: unknown, want: unknown, msg: string) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error("✗ " + msg + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
  }
};

// 同天上下（含相邻互换）
eq(flat(apply(days([2, 1]), 0, 0, 1)!), [2, 1, 3], "同天下移：与后一项互换");
eq(flat(apply(days([3]), 0, 1, 1)!), [1, 3, 2], "同天下移：倒数第二项");
eq(flat(apply(days([3]), 0, 2, -1)!), [1, 3, 2], "同天上移：末项");
eq(flat(apply(days([3]), 0, 1, -1)!), [2, 1, 3], "同天上移：第二项");

// 跨天：末项↓ → 下一天首位；首项↑ → 上一天末位
eq(apply(days([2, 3]), 0, 1, 1), [{ places: [1] }, { places: [2, 3, 4, 5] }], "跨天：末项下移到下一天首位");
eq(apply(days([2, 3]), 1, 0, -1), [{ places: [1, 2, 3] }, { places: [4, 5] }], "跨天：首项上移到上一天末位");
// 中间空天也能落进去（用户可以把某天清空）
eq(apply(days([2, 0, 2]), 0, 1, 1), [{ places: [1] }, { places: [2] }, { places: [3, 4] }], "跨天：落到空天");
eq(apply(days([2, 0, 2]), 2, 0, -1), [{ places: [1, 2] }, { places: [3] }, { places: [4] }], "跨天：从空天前一日起上移");

// 边界 → null（不可移动就什么都不做，避免白进一次撤销栈）
eq(apply(days([1]), 0, 0, -1), null, "单天单点：↑ 越界 = null");
eq(apply(days([1]), 0, 0, 1), null, "单天单点：↓ 越界 = null");
eq(apply(days([2, 2]), 1, 1, 1), null, "最后一天末项：↓ = null");
eq(apply(days([2, 2]), 0, 0, -1), null, "第一天首项：↑ = null");
eq(moveTarget([], 0, 0, 1), null, "空 days");
eq(moveTarget(days([2]), 0, 9, 1), null, "pi 越界");

console.log("✓ reorder.check " + n + "/" + n + " 通过");
