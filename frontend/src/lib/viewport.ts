/**
 * 移动端判定：与 index.css 的 @media (max-width:767px) / Tailwind md(768px) 同一断点。
 * ponytail: 每次调用现读 matchMedia，没有 resize 订阅 —— 横竖屏切换时不会自动重算
 * （影响仅限"当前是否手机"这一处行为分支）；真需要热切换再加监听。
 */
export const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
