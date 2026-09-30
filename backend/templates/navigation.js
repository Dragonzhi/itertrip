/* Standalone navigation: no backend, Leaflet, API key, or build runtime needed. */
(function () {
  "use strict";
  const nav = globalThis.IterTripNavigation;
  const css = document.createElement("style");
  css.textContent = ".it-nav-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 14px;border:1px solid #d8dfd2;border-radius:12px;background:#fffdf7;color:#285844;font:600 13px system-ui;cursor:pointer;text-decoration:none;box-sizing:border-box}.it-nav-btn:focus-visible{outline:3px solid #bf923c;outline-offset:2px}.it-nav-primary{background:#285844;color:white}.it-nav-dialog{width:calc(100% - 24px);max-width:430px;max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;border:1px solid #d8dfd2;border-radius:22px;padding:22px;background:#faf7ef;color:#293c32;font:14px system-ui;line-height:1.6}.it-nav-dialog::backdrop{background:#16261d80}.it-nav-dialog h2{font-size:24px;overflow-wrap:anywhere}.it-nav-row{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}.it-nav-row>*{flex:1}.it-nav-note{color:#657166;font-size:12px}.it-nav-alert{padding:12px;background:#f6ecd1;border-radius:12px}.it-nav-fallback{position:fixed;inset:84px 12px 16px;z-index:800;overflow:auto;background:#faf7ef;border-radius:20px;padding:22px;font:14px system-ui;color:#293c32}.it-nav-fallback h2{margin-top:0}.it-nav-fallback li{padding:10px 0;border-bottom:1px solid #d8dfd2}.it-nav-fallback button{margin-left:12px}";
  document.head.appendChild(css);
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, callback) {
    const b = el("button", text, "it-nav-btn"); b.type = "button"; b.addEventListener("click", callback); return b;
  }
  let getTrip;
  function open(point, previous) {
    const priorFocus = document.activeElement;
    const dialog = el("dialog", "", "it-nav-dialog");
    document.body.appendChild(dialog);
    function close() { dialog.close(); dialog.remove(); if (priorFocus && priorFocus.isConnected) priorFocus.focus(); }
    dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
    const closeBtn = button("关闭", close); closeBtn.setAttribute("aria-label", "关闭导航选项");
    dialog.append(closeBtn);
    const title = el("h2", point.name); title.id = "export-navigation-title";
    dialog.setAttribute("aria-labelledby", title.id); dialog.append(title);
    dialog.append(el("p", "起点由地图软件定位或选择。使用当前保存点位，出入口请在地图中核对。", "it-nav-note"));
    let provider = "amap", mode = "walk", confirmed = false;
    try { provider = localStorage.getItem("itertrip:navigation-map") === "baidu" ? "baidu" : "amap"; } catch (_) {}
    const risk = nav.risk(point);
    if (risk === "search") dialog.append(el("p", "该地点缺少准确坐标，请按名称搜索并确认地点。", "it-nav-alert"));
    if (risk === "confirm") {
      const label = el("label", "", "it-nav-alert"); label.style.display = "block";
      const check = el("input"); check.type = "checkbox"; check.style.marginRight = "8px";
      check.addEventListener("change", () => { confirmed = check.checked; update(); });
      label.append(check, document.createTextNode("坐标未可靠核验。我已核对点位，使用保存坐标")); dialog.append(label);
    }
    const maps = el("div", "", "it-nav-row"), modes = el("div", "", "it-nav-row");
    const mapButtons = ["amap", "baidu"].map(v => {
      const b = button(v === "amap" ? "高德地图" : "百度地图", () => { provider = v; try { localStorage.setItem("itertrip:navigation-map", v); } catch (_) {} update(); }); maps.append(b); return b;
    });
    const modeButtons = [["walk", "步行"], ["bus", "公交"], ["car", "驾车"]].map(([v, label]) => {
      const b = button(label, () => { mode = v; update(); }); modes.append(b); return b;
    });
    const primary = el("a", "", "it-nav-btn it-nav-primary"); primary.style.width = "100%"; primary.dataset.testid = "export-navigation-primary";
    const web = el("a", "使用网页版 ↗", "it-nav-btn");
    const compare = el("a", "从上一计划点比较路线 ↗", "it-nav-btn");
    const comparisonNote = el("p", "上一计划点仅用于比较路线，并不代表你现在的位置。", "it-nav-note");
    const status = el("p", "", "it-nav-note"); status.setAttribute("role", "status");
    const copyArea = el("textarea"); copyArea.readOnly = true; copyArea.hidden = true; copyArea.setAttribute("aria-label", "可复制的地点信息"); copyArea.style.width = "100%";
    const copy = button("复制地点信息", async () => {
      const city = (getTrip().trip || {}).destination || "";
      copyArea.value = city + " · " + point.name + (risk !== "search" ? "\nGCJ-02：" + point.lat + ", " + point.lng : "");
      try { await navigator.clipboard.writeText(copyArea.value); status.textContent = "已复制地点信息"; }
      catch (_) { copyArea.hidden = false; status.textContent = "请选中下方文字复制"; }
    });
    const fallbacks = el("div", "", "it-nav-row"); fallbacks.append(web, copy);
    dialog.append(maps, modes, primary, el("p", "没有打开 App？请使用网页版。交通耗时以地图结果为准；打开导航不会自动标记到达。", "it-nav-note"), fallbacks, status, copyArea, compare, comparisonNote);
    function update() {
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const links = nav.links(point, { provider, mode, confirmed, previous, city: (getTrip().trip || {}).destination, mobile, ios: /iPhone|iPad|iPod/i.test(navigator.userAgent) });
      primary.textContent = links.kind === "search" ? "按名称搜索地点 ↗" : provider === "baidu" && !mobile ? "打开地图，选择起点 ↗" : "打开地图规划路线 ↗";
      primary.href = links.primary; web.href = links.web;
      [primary, web, compare].forEach(a => { a.target = a.href.startsWith("https:") ? "_blank" : "_self"; a.rel = "noopener noreferrer"; });
      compare.hidden = comparisonNote.hidden = !links.compare;
      compare.style.display = links.compare ? "inline-flex" : "none";
      if (links.compare) compare.href = links.compare; else compare.removeAttribute("href");
      modes.style.display = links.kind === "search" ? "none" : "flex";
      mapButtons.forEach((b, i) => { b.setAttribute("aria-pressed", String(provider === ["amap", "baidu"][i])); b.classList.toggle("it-nav-primary", provider === ["amap", "baidu"][i]); });
      modeButtons.forEach((b, i) => { b.setAttribute("aria-pressed", String(mode === ["walk", "bus", "car"][i])); b.classList.toggle("it-nav-primary", mode === ["walk", "bus", "car"][i]); });
    }
    update(); dialog.showModal();
  }
  function attach(container, point, previous) {
    const b = button("去这里 ↗", e => { e.stopPropagation(); open(point, previous); });
    b.dataset.testid = "export-navigate"; container.appendChild(b);
  }
  function fallback() {
    if (typeof L !== "undefined") return;
    const panel = el("section", "", "it-nav-fallback");
    panel.append(el("h2", "地图未能加载 · 仍可查看行程和导航"), el("p", "地图需要网络；以下地点信息与导航入口可独立使用。外部地图仍需要网络或已安装的 App。"));
    (getTrip().days || []).forEach((day, di) => {
      panel.append(el("h3", "第 " + day.day + " 天")); const ul = el("ul");
      const points = [...(day.places || []), ...(day.hotel && day.hotel.name ? [day.hotel] : [])];
      points.forEach(p => { const li = el("li", p.name); attach(li, p, globalThis.IterTripTransport?.legs(getTrip(), di).find(e => e.to.id === p.id)?.from); ul.append(li); }); panel.append(ul);
    });
    document.body.append(panel);
  }
  window.IterTripExportNavigation = { open, attach, init: function (getter) { getTrip = getter; fallback(); } };
})();
