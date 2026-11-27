/* 工程契約與驗收管理：離線外殼快取（極簡穩定版）
   改版時把 VERSION 改成和 index.html 的 ?v= 相同。

   原則：
   - index.html：網路優先，2.5 秒內沒回應或離線時，改用這台裝置上次的版本
   - 有版本號的檔案（?v=…）、圖示：快取優先（版本號改了就是新檔）
   - install 時 skipWaiting()，activate 時刪除舊的 tc-* 快取並 clients.claim()
   - 不和頁面互相傳訊息、不輪詢；頁面也不因新版 Service Worker 自動重新整理，
     新版在下次開啟或手動重新整理時自然生效，不會打斷正在輸入的內容 */
const VERSION = "20261127p-lts";
const CACHE = "tc-" + VERSION;
const SCRIPTS = ["config", "engine", "templater", "checklist", "lifecycle", "govdocs", "exporter", "contract-import"];
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  ...SCRIPTS.map(n => n + ".js?v=" + VERSION),
  "points.json?v=" + VERSION,
  "regions.json?v=" + VERSION,
  "vendor/jszip.min.js?v=" + VERSION,
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("tc-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** 頁面本身：先連網路拿最新版；超過 2.5 秒或離線時先用這台裝置上的版本 */
async function pageFirst(req) {
  const net = fetch(req).then(r => {
    if (r.ok) {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put("index.html", copy));
    }
    return r;
  });
  const kept = await caches.match("index.html");
  if (!kept) return net;
  net.catch(() => {});
  const slow = new Promise(res => setTimeout(() => res(null), 2500));
  try {
    return (await Promise.race([net, slow])) || kept;
  } catch (err) {
    return kept;
  }
}

/** 有版本號的檔案、圖示、範本：先用快取，沒有再下載並存起來 */
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return r;
}

self.addEventListener("fetch", e => {
  const req = e.request,
    url = new URL(req.url);
  // 只處理本站的 GET；Google 試算表後端（POST）、字型、外部網站一律直接連線，不快取資料
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(pageFirst(req));
    return;
  }
  e.respondWith(cacheFirst(req));
});
