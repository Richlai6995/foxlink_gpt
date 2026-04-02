# FOXLINK GPT 教育訓練錄製工具 — Chrome Extension

## 開發者安裝（未封裝模式）

1. 開啟 Chrome → `chrome://extensions`
2. 開啟右上角「開發者模式」
3. 點擊「載入未封裝項目」
4. 選擇 `chrome-extension/` 資料夾
5. Extension 圖示出現在瀏覽器工具列

## 打包發佈（給一般使用者）

### 方式 A：打包 .crx（企業內部）

```bash
# 在 Chrome 擴充功能頁面
# 1. 點擊「封裝擴充功能」
# 2. 選擇 chrome-extension/ 目錄
# 3. 第一次不需要金鑰檔
# 4. 產生 chrome-extension.crx + chrome-extension.pem
# 5. 將 .crx 檔放到內部下載頁面
```

使用者安裝：
- 下載 .crx 檔
- 拖入 `chrome://extensions` 頁面

> **注意：** Chrome 可能會封鎖非 Web Store 的 .crx。
> 企業環境可透過 Group Policy 設定允許安裝。

### 方式 B：ZIP 發佈（免審核）

```bash
# 打包成 ZIP
cd chrome-extension
zip -r foxlink-training-extension.zip . -x "*.md"
```

使用者安裝：
1. 下載 ZIP 並解壓縮到任意資料夾
2. `chrome://extensions` → 開發者模式 → 載入未封裝項目 → 選擇資料夾

### 方式 C：Chrome Web Store（公開發佈）

1. 建立 [Chrome 開發者帳號](https://chrome.google.com/webstore/devconsole)（一次性費用 $5 USD）
2. 打包 ZIP（同方式 B）
3. 上傳到 Developer Dashboard
4. 填寫說明 + 截圖
5. 提交審核（約 1-3 天）
6. 審核通過後使用者可直接從 Web Store 安裝

## 使用方式

1. 點擊工具列的 Extension 圖示
2. 輸入 FOXLINK GPT Server URL 和帳密 → 登入
3. 從 FOXLINK GPT 訓練平台開始 AI 錄製 → 取得 Session ID
4. 在 Extension 輸入 Session ID → 開始錄製
5. 操作目標系統，每次 click 自動截圖上傳
6. 完成後停止錄製 → 回到訓練平台 AI 處理
