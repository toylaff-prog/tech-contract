# CLAUDE.md：工程契約與驗收管理

給 Claude（Claude Code 或 Claude 對話）每次開始工作前先讀的專案規則。
使用者是學校行政人員，不是工程師：回覆一律用繁體中文、白話、說結果，不要貼一大段程式碼。

## 這是什麼

- 臺北市立東湖國中總務處用的工程管理網站：技術服務契約（工程會範本 115.4.23 版）產生 Word、
  施工期限、竣工驗收到保固的表件追蹤、LINE 催辦、Google 日曆同步、週報。
- 網站：https://toylaff-prog.github.io/tech-contract/（GitHub Pages，`main` 分支根目錄）
- 後端：Google Apps Script「工程契約與驗收管理後端」，資料存在 Google 試算表「工程契約與驗收管理資料」，
  都在 toylaff@gmail.com 帳號下。
- 純 HTML／JavaScript，沒有建置步驟（不要加入 npm 套件、框架或打包工具）。可安裝成手機 App（PWA）。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 整個網頁（畫面、樣式、主要程式都在這裡） |
| `engine.js` | 契約欄位計算、Word 產生、必填與互斥檢查 |
| `checklist.js` | 竣工驗收清單、日期工具（一律用台灣時區） |
| `lifecycle.js` | 技術服務、施工、驗收各階段的期限與下一步 |
| `govdocs.js` / `exporter.js` / `templater.js` / `contract-import.js` | 公文簽稿、Excel 報表、範本比對、匯入歷年契約（用到才載入） |
| `tpl.json` `points.json` `regions.json` | 契約範本與填寫點 |
| `vendor/jszip.min.js` | Word／Excel 壓縮（放本站，不依賴外部 CDN） |
| `sw.js` `manifest.webmanifest` `icons/` | 離線與手機 App |
| `config.js` | Apps Script 網址（正式網址，**不要清空**） |
| `後端_Code.gs` | Apps Script 後端原始碼（網站本身不會載入它） |
| `tests/` | 測試（見下方） |

## 改網站前一定要做

1. **先 `git pull`**。可能有別的對話或同仁剛推過新版；推送被拒時先看對方改了什麼，絕不 force push。
2. 版本號三處要一樣，每次改網站都要一起換新（格式 `YYYYMMDD` + 一個小寫字母 + `-lts`，例如 `20261128b-lts`）：
   - `sw.js` 的 `const VERSION`
   - `index.html` 的 `const VER`
   - `index.html` 所有 `<script src="…?v=…">`
   沒換版本號，同仁的瀏覽器和手機 App 會一直用舊檔。
3. 每行不超過 140 字元（測試會檢查）。
4. 日期一律用台灣時區計算（`C.today()`、`C.addDays()`、`C.twDate()`），不要用 `new Date().toISOString().slice(0, 10)`。
5. 使用者輸入顯示到畫面前一律經過 `esc()`；外部連結經過 `safeUrl()`。

## 測試（改完、推送前都要跑）

```bash
LTS_DEPLOYED=1 TZ=Asia/Taipei python3 tests/lts_smoke_and_core.py   # 前端 16 項，需要 Python Playwright 和 Chromium
node tests/lts_backend_test.js                                       # 後端 22 項（在 Node 裡實際執行 後端_Code.gs）
```

- `LTS_DEPLOYED=1`：正式 repo 的 `config.js` 已填網址，讓檢查改成驗證網址格式（交付給別校的安裝包才要空字串）。
- `TZ=Asia/Taipei`：日期相關錯誤只有在台灣時區才測得出來。
- 測試只連本機的模擬後端，絕不連正式 Apps Script，也不碰真實工程資料、日曆或收件人。
- 介面改動另外用瀏覽器看一次電腦（1440 寬）和手機（390 寬）畫面，並確認沒有程式錯誤。

## 部署

### 只改網站

測試全過 → `git commit` → `git push origin main`。GitHub Pages 約 1～2 分鐘生效，
用 `curl -s https://toylaff-prog.github.io/tech-contract/sw.js | grep VERSION` 確認是新版本號。

### 有改 `後端_Code.gs`

1. Apps Script 編輯器：用 `後端_Code.gs` 全部取代原本的程式碼 → 儲存。
2. 有新增工作表或屬性時，函式選 `setup` →「執行」。
3. 「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本：建立新版本 → 部署」。**網址不變，`config.js` 不用改。**
4. 用 POST 呼叫 `{"action":"ping"}`，沒帶存取碼應回 `{"ok":false,"error":"code"}`，表示新版已上線。
5. 也可以改用 Google 官方的 `clasp` 工具從終端機推送與部署（要使用者先登入授權一次）。

回退：Apps Script「管理部署作業 → 編輯 → 版本」選回上一版；網站用 `git revert` 還原該次 commit。

## 不能做的事

- 不要把存取碼寫進任何檔案、commit 訊息或回覆。存取碼存在 Apps Script「專案設定 → 指令碼屬性」的
  `ACCESS_CODE`（至少 12 字元），只由使用者自己修改。
- 不要清空或改動 `config.js` 的正式網址。
- 刪除工程、清空試算表、刪除 GitHub 分支或 repo 前，先問使用者。
- 不要加入外部字型、外部 CDN 或追蹤碼（學校網路可能擋掉，也拖慢開啟速度）。

## 介面原則

- 「有溫度的行政工作台」：米白底 `#F7F6F2`、墨綠主色 `#344D45`；磚紅只給真正逾期或錯誤，
  暖棕金＝即將到期，柔和綠＝完成，灰藍＝等待他人。只用淺色，不隨系統深色模式變黑底。
- 首頁：四張摘要卡（優先處理／輪到校內／等待他人／本週已完成）、優先處理清單、先記下來、下班前的小確認。
- 每件工程最上方：上次做到哪裡／現在卡在哪裡／接下來要做什麼；「起始階段」可隨時更改，前面階段不必補填。
- 只顯示有依據的數字；工期比例要標明「不是施工進度」。正向回饋只在確定存到雲端後才顯示。
- 「使用說明」維持「3 步驟就會用」＋常見問題，細節收在「進階說明」。
  改了按鈕名稱或位置，要同步改使用說明（說明裡的名稱必須和畫面上一字不差）。
- 改完介面跑一次無障礙檢查（axe-core，WCAG 2.2 AA）應為 0 項違規。

## 尚未決定（不要自行決定，先問使用者）

- 表件「已收件」時的預設經手人
- 表件流向「已辦結」時，是否自動把原清單標為已完成
- 契約第 19 條付款條款怎麼處理
- 是否轉移到總務處公務帳號
