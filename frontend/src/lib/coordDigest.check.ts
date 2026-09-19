/**
 * coordDigest 自检（无框架，手写 assert）：node src/lib/coordDigest.check.ts
 *
 * 关键点是**降级判定**：把「高德低置信」「模型推测」「城市中心」「无坐标」都算降级，
 * 而「你确认过 / 记忆库 / 高德核验」才算可信 —— 判错了要么吓唬用户，要么把幻觉坐标说成可信。
 */
import { coordDigest } from "./coordDigest.ts";
import type { RouteJSON } from "../types/route";

let n = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error("✗ " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
  }
  n += 1;
};

/** 四种来源 + 无坐标 + 酒店：一条路线里能出现的降级形态都覆盖到 */
const MIXED = {
  trip: { title: "长沙两日", destination: "长沙", days: 2 },
  days: [
    {
      day: 1,
      places: [
        { name: "橘子洲头", lat: 28.19, lng: 112.96, source: "amap", confidence: "high" },
        { name: "笨罗卜", lat: 28.2, lng: 112.97, source: "llm", confidence: "high" },
      ],
      hotel: null,
    },
    {
      day: 2,
      places: [
        { name: "某小店", lat: 28.21, lng: 112.98, source: "city", confidence: "low" },
        { name: "待定位点", lat: 0, lng: 0, source: "none", confidence: "none" },
      ],
      hotel: { name: "某酒店", lat: 28.22, lng: 112.99, source: "amap", confidence: "low" },
    },
  ],
  summary: [],
} as unknown as RouteJSON;

const d = coordDigest(MIXED)!;
eq("总数 = 地点 4 + 酒店 1", d.total, 5);
eq("来源分布（固定顺序，酒店计入 amap）", d.counts, [
  { source: "amap", n: 2 },
  { source: "llm", n: 1 },
  { source: "city", n: 1 },
  { source: "none", n: 1 },
]);
eq("可信数 = 只有高德高置信那一个", d.verified, 1);
eq("降级项按天与出现顺序", d.degraded.map((x) => x.name), ["笨罗卜", "某小店", "待定位点", "某酒店"]);
eq("只有 0 坐标算 missing", d.degraded.map((x) => x.missing), [false, false, true, false]);
eq("酒店被标记 hotel", d.degraded.map((x) => x.hotel), [false, false, false, true]);
eq("天号取自 days[].day", d.degraded.map((x) => x.day), [1, 2, 2, 2]);
eq("高德低置信仍算降级", d.degraded[3].source + "/" + d.degraded[3].confidence, "amap/low");

/** 全部可信 → 不报降级 */
const ALL_OK = {
  trip: { title: "t", destination: "长沙", days: 1 },
  days: [
    {
      day: 1,
      places: [
        { name: "A", lat: 28.1, lng: 112.9, source: "amap", confidence: "high" },
        { name: "B", lat: 28.2, lng: 112.8, source: "user", confidence: "high" },
        { name: "C", lat: 28.3, lng: 112.7, source: "memory", confidence: "high" },
      ],
      hotel: null,
    },
  ],
} as unknown as RouteJSON;
const ok = coordDigest(ALL_OK)!;
eq("全可信：无降级项", ok.degraded, []);
eq("全可信：verified = total", [ok.verified, ok.total], [3, 3]);

/** 未知/空来源（导入的旧 JSON）→ 不能冒充可信 */
const UNKNOWN = {
  trip: { title: "t", destination: "长沙", days: 1 },
  days: [{ day: 0, places: [{ name: "旧点", lat: 28.1, lng: 112.9 }], hotel: null }],
} as unknown as RouteJSON;
const un = coordDigest(UNKNOWN)!;
eq("空来源归入 unknown", un.counts, [{ source: "unknown", n: 1 }]);
eq("空来源算降级", un.degraded.length, 1);
eq("day 缺失回退为下标 +1", un.degraded[0].day, 1);

/** 没有可说的就返回 null（调用方不渲染） */
eq("无路线 → null", coordDigest(null), null);
eq("无 days → null", coordDigest({ trip: { title: "t", destination: "", days: 0 } } as unknown as RouteJSON), null);
eq("空天 → null", coordDigest({ trip: { title: "t", destination: "", days: 1 }, days: [{ day: 1, places: [] }] } as unknown as RouteJSON), null);

console.log("✓ coordDigest.check " + n + "/" + n + " 通过");
