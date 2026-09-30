# M28 · 随身行程与离线查看

> 2026-09-30 · 开发、生产构建和自动化验证完成；Android Chrome／iOS Safari 真机安装、重启与排版待人工验收。

## 1. 使用方式

1. 重新构建前端并重启后端，或将正式构建发布到 HTTPS 站点。开发模式不会注册 Service Worker。
2. 打开当前行程，在行程面板中展开「随身行程 · 安装与离线设置」，确认「应用文件已准备」和本地行程记录。
3. Android 可用页面出现的「添加到手机桌面」按钮，或浏览器菜单；iPhone 在 Safari 中使用「分享 → 添加到主屏幕」。安装入口受浏览器版本和使用环境影响。
4. 首次从桌面打开后，保持联网并确认当前行程存在、应用文件准备完成，再关闭、断网、重新打开。若安装后的浏览器存储环境不同，可先导入 JSON。

本机 `http://127.0.0.1:8100/` 会在页面内规范为 `/itertrip/`，无需后端重定向；这同时兼容 Nginx 剥离子路径的部署。手机访问局域网普通 HTTP 可以编辑行程，但不能据此验收 PWA 离线启动；手机验收使用 HTTPS。

| 场景 | 行为 |
| --- | --- |
| 离线打开 | 从缓存加载正式应用代码，恢复本地当前行程与出行进度 |
| 手工编辑 | 起止时间、停留、预约、备注、排序、交通方式和缓冲仍可编辑、撤销和重做 |
| 修改出发日期 | 离线进行本地日期计算，重算文本闭馆规则；不宣称联网核验；清除日期后日期未知 |
| 交通 | 展示保存的方案、原查询时间和「离线快照」；过期或刷新失败的数据不参与当前汇总与排程 |
| AI／搜索／坐标查询 | 需要联网；离线时在请求前阻止并给出说明，AI 发送按钮置灰 |
| 地图 | 不下载离线底图；底图失败有提示，地点标记和日程文字仍可用 |
| 导出 | JSON 在本地生成；HTML 导出需要后端在线；离线可导入已有 JSON／HTML |
| 外部导航／来源链接 | 保留跳转入口；能否使用由外部 App、网络与其离线地图决定 |

天气数据尚未实现，属于 M29；当前阶段没有离线天气内容，也不把交通查询时间当作未来出发时的保证。

## 2. 存储与恢复

继续沿用 localStorage，未增加数据库或 IndexedDB 迁移。原有 `itertrip:route`、模型设置、地图设置和出行会话键保持兼容。

- `useTripHistory` 负责行程编辑、撤销和重做的同步落盘；初次挂载保存规范化后的稳定 ID。
- 新生成／导入路线在 App 切页前保存；父组件不再用延迟 effect 写回旧路线。
- 出行当天、视图、到达／完成操作同步保存；会话 ID 一并保存，刷新能找到同一份进度。
- 新增 `itertrip:route-saved-at` 元数据。旧记录缺时间时明确显示旧记录；读写失败不假报保存成功，界面提醒导出 JSON，更新按钮禁用。
- 撤销历史仍属于当前页面，重开或应用更新后重置；保存的当前路线与进度可以恢复。

清理入口仅删除此应用的 CacheStorage 文件，保留行程、进度、设置和对话。清理前说明需重新联网准备才能离线启动，并通过 worker 消息通知其他打开的页面。

浏览器主动清理整个站点数据或卸载后清理存储仍会失去本地记录；JSON 导出是独立备份，不能把浏览器缓存承诺为永久保存。

## 3. 应用缓存与更新

`frontend/pwa/build.mjs` 在 Vite 构建后枚举应用文件，生成内容摘要版本和精确静态白名单，写入 `dist/sw.js`。manifest、192／512 PNG 安装图标、180 PNG Apple 图标随构建发布，无新增运行依赖。

Worker 缓存名为 `itertrip-shell:/itertrip/:<版本摘要>`，范围限 `/itertrip/`。

1. 安装时使用 `credentials: omit` 抓取完整静态白名单；并校验 JS、CSS、PNG、HTML、manifest 类型，防止部署错误把缺失资源变成 200 HTML。
2. 文件完整后写入准备时间；任何失败删掉半成品。并发准备去重，状态检查验证必需文件仍在。
3. 冷启动从当前缓存读取应用入口、JS、CSS；缓存清理后可以正常联网打开。
4. 新版安装后等待，页面显示更新入口。表单、地图选点、AI 输入草稿、活动请求或保存失败期间禁用更新；模型设置弹窗里的更新入口也禁用。
5. 用户点击更新后才发送 `APPLY_UPDATE`，完整新版才能激活；只有发起更新的页面自动重新加载，其他正在编辑的页面不自动刷新。
6. 激活后清理同前缀的旧应用文件，保留同域其他应用缓存。联网恢复时检查新版，回到页面时重新检查缓存状态。

不缓存 API、BYOK、管理请求、带凭据头的请求、地图瓦片、任意 URL 和搜索／AI 响应。行程和密钥仍是已有本地存储，未复制到 worker 缓存或导出文件。

这是静态应用缓存，没有后台重发、云端同步或离线写入队列。网络恢复不会自动把手工编辑提交给服务器。

## 4. 交通刷新失败的处理

`TransportSnapshot` 增加可选 `refresh_error`（后端默认空字符串）。刷新抛错，或某段全部方式均返回未知时，保留已有 options、耗时和查询时间，同时记录失败。

`shared/transport.js` 将带失败标记的记录视为不可用于当前计算；前端和导出均展示历史方案与失败原因。再次成功查询替换记录并清除标记；失败标记和成功查询都可撤销。没有历史记录时保持未知。

这样既能离线查到最后一次方案，也不会把失败刷新当作当前有效的交通结果。M26 集成断言随行为调整，继续验证旧数据不得计入当前汇总。

## 5. 部署

- C-1 后端兼容根目录和 `/itertrip/` 静态访问；worker／manifest／入口返回 `Cache-Control: no-cache`，manifest 使用 JSON MIME，缺失静态资源返回 404，路径限制在 dist 内。
- Vercel 配置补齐 `/itertrip/` 静态资源、worker、manifest 和入口重写，以及 worker／manifest 的缓存头。配置已随代码审阅，未进行 Vercel 实际部署验收。
- Nginx 或其他静态托管需让 `/itertrip/sw.js` 返回 JS、`/itertrip/manifest.webmanifest` 返回 JSON、构建白名单中的文件全部存在；不能将它们回退成 HTML。
- 本次没有发布线上站点；重建、发布时保留生成的 `sw.js`、manifest 和图标。开发 HMR 不注册缓存，生产本机／HTTPS 才启用。

## 6. 验证与人工验收

自动化命令（仓库根，Windows PowerShell）：

```powershell
cd frontend
npm run build
node scripts/m28-worker.mjs
node scripts/m28-dom.mjs
node src/lib/transport.check.ts
node src/lib/schedule.check.ts
node src/lib/navigation.check.ts
cd ..
.venv/Scripts/python.exe -m backend._check_m28
.venv/Scripts/python.exe -m backend._check_m25
.venv/Scripts/python.exe -m backend._check_m26
.venv/Scripts/python.exe -m backend._check_m27
cd frontend
node scripts/m25-dom.mjs
node scripts/m26-dom.mjs
node scripts/m27-dom.mjs
```

验证证据：

- Worker 在确定性 Fetch／CacheStorage 测试环境执行：失败安装、错误 MIME、并发准备、完整性、断网重启、API／凭据旁路、显式更新和定向清理通过。
- 正式 Vite JS／CSS 从 worker 缓存取出，在断网 jsdom 中重新运行；旧页面关闭后仅恢复本地存储，再启动应用。日程、预约、备注、交通历史与出行进度恢复，编辑／撤销／重做、本地改日期、保存容量失败、刷新失败保留记录、清理不丢数据与更新表单保护通过。
- TestClient 验证静态路径、MIME、缓存头、缺失文件、路径限制及 schema；M25–M27 回归和 M27 46 项时间规则检查通过。
- 构建通过；仍有既有 Vite 500KB 分包提示和 Starlette TestClient 弃用提示。

上述环境验证应用与 worker 逻辑，没有驱动真实浏览器的 Service Worker 生命周期，也不代表设备安装已通过。

| 设备验收 | 记录 |
| --- | --- |
| Android Chrome 安装、桌面启动、断网冷重启 | 待人工验收；确认安装入口、当前行程和进度恢复 |
| iOS Safari 添加到主屏幕、首次联网准备、断网冷重启 | 待人工验收；记录系统版本、存储恢复和安全区表现 |
| 新版等待、取消／保存表单后更新，多标签页编辑 | 自动化保护通过；真实浏览器生命周期与交互待验收 |
| 真机无网读预约／备注、刷新失败及导航返回 | 待人工验收 |

下一开发阶段：M29 天气评估与局部调整。

实现参考：[MDN Service Worker 生命周期](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)、[MDN PWA 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)、[web.dev 安装入口](https://web.dev/learn/pwa/installation)、[Vercel 重写](https://vercel.com/docs/routing/rewrites)。
