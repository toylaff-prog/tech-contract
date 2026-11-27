/* 工程契約與驗收管理：離線外殼快取。改版時把 VERSION 改成和 index.html 的 ?v= 相同。 */
const VERSION = "20261127k";
const CACHE = "tc-" + VERSION;
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
  ...["config", "engine", "templater", "checklist", "lifecycle", "govdocs", "exporter", "contract-import"].map(n => n + ".js?v=" + VERSION),
  "points.json?v=" + VERSION, "regions.json?v=" + VERSION, "vendor/jszip.min.js?v=" + VERSION
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("tc-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  // 只處理本站的 GET；Google 試算表後端、字型、CDN 一律直接連線，不快取資料
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // 頁面本身：先連網路拿最新版；網路慢（超過 2.5 秒）或離線時先用這台裝置上的版本
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith((async () => {
      const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put("index.html", copy)); } return r; });
      const kept = await caches.match("index.html");
      if (!kept) return net;
      net.catch(() => {});
      const slow = new Promise(res => setTimeout(() => res(null), 2500));
      try { return (await Promise.race([net, slow])) || kept; } catch (err) { return kept; }
    })());
    return;
  }
  // 有版本號的檔案、圖示、範本：先用快取（版本號改了就是新檔）
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
