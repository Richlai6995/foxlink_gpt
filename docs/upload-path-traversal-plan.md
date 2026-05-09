# Upload Path Traversal & XSS Hardening — 規劃與實作紀錄

> **狀態**:**已 ship**(2026-05-09)
> **作者**:資安白箱審計 → Claude
> **範圍**:multer storage 沒驗 `req.params.id` → path traversal;副檔名沒 whitelist → SVG XSS
> **影響檔案**:[server/utils/pathSafety.js](../server/utils/pathSafety.js)、[server/routes/knowledgeBase.js](../server/routes/knowledgeBase.js)、[server/routes/docTemplates.js](../server/routes/docTemplates.js)、[server/routes/dashboard.js](../server/routes/dashboard.js)、[server/scripts/test-path-safety.js](../server/scripts/test-path-safety.js)

---

## 1. 審計結論(快速版)

盤點 server 內所有 multer 設定。fileGenerator.js (LLM-driven) 已有 whitelist sanitize → **不在此 PR 範圍**。其他可疑點分類:

| Route | Storage filename / dest | 結論 |
|-------|-------------------------|------|
| `chat.js` | `dest: tmp` + multer 自動 hash filename | ✅ 安全(無 user input 進 path) |
| `training.js` | `course_${req.params.id}` | ✅ 已被 `loadCoursePermission` 中 Oracle ORA-01722 擋掉 |
| `transcribe.js` / `admin.js` | `dest: tmp` + 自動 hash | ✅ |
| `pmBom.js` | `memoryStorage` | ✅(不寫盤) |
| **`knowledgeBase.js:114`** | `path.join(UPLOAD, 'kb', req.params.id)` | 🔴 **Path traversal**(multer 在 handler 之前執行,handler 的 getEditableKb 來不及擋) |
| **`docTemplates.js:559`** | `${req.params.id}_slide${req.params.index}.${ext}` | 🟡 Path traversal(filename 含 `..`) |
| **`dashboard.js:2070/2097/2125`** | `${prefix}_${id}_${ts}${path.extname(originalname)}` | 🟡 副檔名沒 whitelist → SVG/HTML XSS |

---

## 2. 漏洞細節

### 2.1 KB 上傳 path traversal(critical)

```js
// knowledgeBase.js:114(修補前)
destination(req, _file, cb) {
  const dir = path.join(UPLOAD_BASE, 'kb', req.params.id || 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  cb(null, dir);
}
```

呼叫順序:
```js
router.post('/:id/documents', upload.array(...), async (req, res) => {
  // ↑ multer 先寫檔!
  const target = await getEditableKb(...)  // ← 才驗權限,但檔案已落盤
  ...
});
```

**Exploit**:`POST /api/kb/..%2F..%2Fapp%2Fserver%2Fcerts/documents` 帶 multipart 上傳 `.pdf`(白名單內副檔名)
- `path.join('/app/uploads', 'kb', '../../app/server/certs')` → `/app/server/certs`
- mkdirSync recursive → 確保目錄
- 寫檔 → 把 server 內部目錄當 dropbox

雖然 ext whitelist 防 `.pem` / `.js`,但能寫 `.pdf` / `.docx` 到任何能寫的目錄,是攻擊跳板。

### 2.2 doc template thumbnail path traversal

```js
// docTemplates.js:559(修補前)
filename: (req, file, cb) => {
  const ext = (file.originalname.split('.').pop() || 'png').toLowerCase();
  cb(null, `${req.params.id}_slide${req.params.index}.${ext}`);
}
```

`:id = "../foo"` → filename = `../foo_slide0.png` → `path.join(thumbnails/, '../foo_slide0.png')` = `<above thumbnails>/foo_slide0.png` → traversal。

而且 `ext` 從 originalname 的 `.split('.').pop()` 抓 — `evil.svg` 直接通過,且 fileFilter 只看 mimetype(可偽造)→ stored XSS 載體。

### 2.3 dashboard 圖片上傳 — SVG/HTML XSS

```js
// dashboard.js:2097(修補前)
filename: (req, file, cb) => cb(null, `logo_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`)
```

`req.user.id` 是 number 沒 traversal,但 `path.extname(originalname)` 直接拿原始副檔名,fileFilter 只看 mimetype 不看 ext。

**Exploit**:
```
curl -F 'logo=@evil.svg;type=image/png' /api/dashboard/upload-logo
```
- mimetype 偽稱 `image/png`(client 完全可控)
- `path.extname('evil.svg')` = `.svg`
- 寫進 `/uploads/dashboard_logos/logo_<id>_<ts>.svg`
- 別 user 訪問 `<host>/uploads/dashboard_logos/logo_<id>_<ts>.svg`
- Express static 對 `.svg` 預設 `Content-Type: image/svg+xml`
- Browser **執行 SVG 內 `<script>`** → stored XSS,可直接竊取 admin token

---

## 3. 修補

### 3.1 共用 helper [`server/utils/pathSafety.js`](../server/utils/pathSafety.js)

```js
isNumericId(v)              // /^\d{1,16}$/
isSafeId(v)                 // /^[A-Za-z0-9_\-]{1,64}$/
requireNumericParam(...names)  // Express middleware factory
safeExtension(originalname, allowedExts)   // 回 null = reject
ensureWithinRoot(root, fullPath)           // 確認 resolve 後沒 escape
```

23/23 unit test pass(`scripts/test-path-safety.js`)。

### 3.2 KB:multer destination 內驗 numeric id + 雙重 root 檢查

```js
destination(req, _file, cb) {
  const id = req.params.id;
  if (id !== undefined && !isNumericId(String(id))) {
    return cb(new Error('Invalid KB id'));
  }
  const dir = path.join(UPLOAD_BASE, 'kb', id || 'tmp');
  if (!ensureWithinRoot(path.join(UPLOAD_BASE, 'kb'), dir)) {
    return cb(new Error('Path escape detected'));
  }
  fs.mkdirSync(dir, { recursive: true });
  cb(null, dir);
}
```

不在 multer 前加 middleware 的原因:multer error 走 next(err) 自動 → 統一 error 路徑簡潔。雙重防護(numeric + ensureWithinRoot)即使將來 isNumericId 邏輯改也擋得住。

### 3.3 docTemplates thumbnail:id/index 必純數字 + 副檔名 whitelist

```js
filename: (req, file, cb) => {
  if (!isNumericId(String(req.params.id || '')) || !isNumericId(String(req.params.index || ''))) {
    return cb(new Error('Invalid id or index'));
  }
  const ext = safeExtension(file.originalname, ['.png','.jpg','.jpeg','.webp']) || '.png';
  cb(null, `${req.params.id}_slide${req.params.index}${ext}`);
}
```

### 3.4 dashboard:副檔名 whitelist(三個 endpoint)

```js
const SAFE_IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
filename: (req, file, cb) => {
  const ext = safeExtension(file.originalname, SAFE_IMG_EXTS) || '.png';
  cb(null, `${prefix}_${id}_${Date.now()}${ext}`);
}
```

`/topics/:id/icon` 額外加 numeric id 檢查(同 thumbnail)。

> **設計選擇**:fileFilter 改 ext whitelist 不夠 — `path.extname` 仍會被攻擊者控的 originalname 影響。最安全是 **filename 階段強制 ext 走 whitelist 才寫盤**。

---

## 4. 測試

### 4.1 Unit test(已通過)

```
$ node server/scripts/test-path-safety.js
... 23/23 passed
```

### 4.2 整合測試(由 QA 跑)

```bash
# 1. KB traversal — 應 400/500,絕不寫進 server filesystem 任意處
curl -X POST 'http://localhost:3007/api/kb/..%2F..%2Fetc/documents' \
  -H "Authorization: Bearer $TOKEN" \
  -F 'files=@test.pdf'
# 預期:400 Invalid KB id

# 2. docTemplates traversal
curl -X POST 'http://localhost:3007/api/doc-templates/..%2Ffoo/slides/0/thumbnail' \
  -H "Authorization: Bearer $TOKEN" \
  -F 'thumbnail=@test.png'
# 預期:400 Invalid id or index

# 3. SVG XSS — mimetype 偽稱 image/png 但 originalname 是 .svg
curl -X POST 'http://localhost:3007/api/dashboard/upload-logo' \
  -H "Authorization: Bearer $TOKEN" \
  -F 'logo=@evil.svg;type=image/png'
# 預期:200 但儲存後副檔名是 .png(safeExtension fallback),不再有 .svg

# 4. 正常路徑仍可
curl -X POST 'http://localhost:3007/api/kb/123/documents' \
  -H "Authorization: Bearer $TOKEN" \
  -F 'files=@test.pdf'
# 預期:200(若 KB 123 存在且有權限)
```

---

## 5. Out of Scope(後續)

- `fileGenerator.js` LLM-driven 寫檔 — 已有 whitelist,不修
- `training.js` 上傳 — `loadCoursePermission` + Oracle 數字 cast 已擋,不重複改
- 上傳檔案的 **內容安全**(magic byte 驗 vs ext / 病毒掃描)— **不在此 PR**,後續可加 ClamAV
- Express static `.svg` 改回應 `Content-Disposition: attachment` 強迫下載 — 守備性,不影響本 PR 主修補

---

## 變更紀錄

| 日期 | 異動 | 作者 |
|------|------|------|
| 2026-05-09 | 初稿 + ship | rich_lai + Claude |
