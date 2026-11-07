/**
 * 移动端判定：与 index.css 的 @media (max-width:767px) / Tailwind md(768px) 同一断点。
 * ponytail: 每次调用现读 matchMedia，没有 resize 订阅 —— 横竖屏切换时不会自动重算
 * （影响仅限"当前是否手机"这一处行为分支）；真需要热切换再加监听。
 */
export const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

/**
 * 紧凑屏判定（M32）：与 Plan.tsx 的 desktop state（matchMedia min-width:1024px）互补。
 * <1024 的规划页一律走「底部抽屉 + 互斥」的紧凑交互 —— 768–1023 的平板带不再回落
 * 桌面式双侧栏（380+400px 互叠盖满地图的旧账）。同样没有 resize 订阅。
 */
export const isCompact = () => window.matchMedia("(max-width: 1023px)").matches;
