# FOXLINK GPT 教育訓練平台 — 實作完成報告

> 日期：2026-04-02（Phase 1-2F）、2026-04-03（Phase 3A-1/2/3）
> 狀態：Phase 1 + Phase 2A-F + Phase 3A 實作完成（Phase 3B 語音導覽已規劃）
> 設計文件：[training-platform-design.md](training-platform-design.md)

---

## 1. 完成項目總覽

### Phase 1A — 基礎架構

| 項目 | 狀態 | 說明 |
|------|------|------|
| DB Schema (Oracle) | ✅ 完成 | 20+ 張表，含 migration 邏輯於 `database-oracle.js` |
| Server Route `/api/training` | ✅ 完成 | `server/routes/training.js`，~1600 行 |
| 權限模型 | ✅ 完成 | `canUserAccessCourse()` 多維度檢查（owner/admin/public/shared） |
| Sidebar 入口 | ✅ 完成 | 「更多功能」選單新增「教育訓練」(GraduationCap icon) |
| `/training` 路由 | ✅ 完成 | lazy loaded，6 個 sub-routes |
| i18n | ✅ 完成 | zh-TW / en / vi 新增 `sidebar.training` |
| 課程列表首頁 | ✅ 完成 | 分類 sidebar + 課程卡片 grid + 搜尋 + 篩選 + 進度標記 |
| 課程詳情頁 | ✅ 完成 | 章節列表 + 進度顯示 + 開始/繼續學習按鈕 |
| 課程編輯器 | ✅ 完成 | 基本資訊 / 章節管理 / 題庫 / 設定 四個 tab |

### Phase 1B — 互動教材編輯器

| 項目 | 狀態 | 說明 |
|------|------|------|
| SlideEditor 主體 | ✅ 完成 | 全螢幕 overlay，左側 block 列表 + 右側 block 編輯 + 底部旁白 |
| 版型模板 (10 種) | ✅ 完成 | 標題頁、左圖右文、右圖左文、步驟教學、全幅截圖、雙欄比較、卡片展示、影片頁、測驗頁、空白 |
| TextBlockEditor | ✅ 完成 | Markdown 編輯 |
| ImageBlockEditor | ✅ 完成 | 上傳 + URL + 預覽 + 替代文字 |
| StepsEditor | ✅ 完成 | 動態增減步驟，每步含標題 + 說明 |
| CalloutEditor | ✅ 完成 | tip / warning / note / important 四種類型 |
| VideoBlockEditor | ✅ 完成 | 上傳 or URL + 預覽播放 |
| HotspotEditor | ✅ 完成 | 上傳截圖 → 滑鼠拖拉繪製矩形區域 → 正確/錯誤標記 + 回饋 + 嘗試次數 |
| DragDropEditor | ✅ 完成 | 配對 / 排序 / 分類 三模式 + 項目管理 + 目標區域 + 正確/錯誤回饋 |
| FlipCardEditor | ✅ 完成 | 正反面編輯 + grid/carousel 版面 + 欄數設定 |
| BranchEditor | ✅ 完成 | 情境描述 + 多選項 + 最佳標記 + 跳轉 slide ID |
| QuizInlineEditor | ✅ 完成 | 單選/多選/填空 + 選項管理 + 正確標記 + 解析 + 配分 |

### Phase 1C — 音訊功能

| 項目 | 狀態 | 說明 |
|------|------|------|
| AudioPanel | ✅ 完成 | TTS 生成 / STT 即時語音輸入 / 麥克風錄音 / 上傳音訊 |
| TTS 整合 | ✅ 完成 | 呼叫 Google Cloud TTS (cmn-TW-Wavenet-A)，從旁白文字生成 MP3 |
| STT 即時輸入 | ✅ 完成 | Web Speech API (webkitSpeechRecognition)，邊說邊打 |
| 麥克風錄音 | ✅ 完成 | MediaRecorder API 錄音 → 上傳 + 同時 Gemini 轉錄 |
| 音訊檔上傳 | ✅ 完成 | 上傳 audio 檔 + 可選 Gemini STT 轉錄 |

### Phase 1D — 學習播放器

| 項目 | 狀態 | 說明 |
|------|------|------|
| CoursePlayer | ✅ 完成 | 全螢幕播放器，鍵盤導航 (←→ / Space / Esc) |
| SlideRenderer | ✅ 完成 | 根據 block type 分派渲染元件 |
| 進度條 + 章節導航 | ✅ 完成 | 底部進度條 + 左側章節大綱 sidebar |
| 語音旁白同步 | ✅ 完成 | 切換投影片時自動播放音訊 + 靜音切換 |
| HotspotBlock (互動) | ✅ 完成 | 點擊判定 + 嘗試計數 + 提示高亮 + 正確動畫 |
| DragDropBlock (互動) | ✅ 完成 | HTML5 拖放 + 排序/配對模式 + 答案檢查 |
| FlipCardBlock (互動) | ✅ 完成 | CSS 3D preserve-3d 翻轉動畫 |
| BranchBlock (互動) | ✅ 完成 | 選項選擇 + 最佳回饋標記 |
| QuizInlineBlock (互動) | ✅ 完成 | 單選/多選/填空即時判定 + 解析顯示 |
| AI 助教面板 | ✅ 完成 | 右側面板，注入課程 context，SSE 對話 |
| 學習筆記 + 書籤 | ✅ 完成 | 右側筆記面板，每投影片可存筆記 |

### Phase 1E — 測驗 + 評分系統

| 項目 | 狀態 | 說明 |
|------|------|------|
| QuizPage | ✅ 完成 | 逐題導航 + 題號圓點 + 計時器 + 提交 + 結果頁 |
| 評分引擎 (server) | ✅ 完成 | `scoreQuestion()` 函式，支援 exact / partial / weighted 模式 |
| 單選/多選/填空/配對/排序 | ✅ 完成 | 各題型的前端 UI + 後端判分 |
| 多選部分給分 | ✅ 完成 | 正確比例 × 滿分 + 錯誤選項扣分 |
| 限時測驗 | ✅ 完成 | 前端 countdown + 時間到自動提交 |
| 重測次數限制 | ✅ 完成 | `max_attempts` 檢查，超過回傳 400 |
| 測驗結果頁 | ✅ 完成 | 分數 / 通過判定 / 重新測驗按鈕 |
| AI 輔助出題 | ✅ 完成 | `POST /courses/:id/ai-generate-quiz` — Gemini 根據教材內容生成題目 |

### Phase 1F — 培訓專案 + 學習路徑

| 項目 | 狀態 | 說明 |
|------|------|------|
| Learning Paths CRUD | ✅ 完成 | 路徑建立 / 課程新增移除 / 前置條件設定 |
| Training Programs CRUD | ✅ 完成 | 專案建立 / 對象群組 / 課程 / 時間起迄 |
| 對象群組指定 | ✅ 完成 | user / dept / role 三維度 |
| 一鍵啟動展開指派 | ✅ 完成 | `POST /programs/:id/activate` 自動解析群組 → 建立個人指派 |
| 指派查詢 | ✅ 完成 | 專案內指派清單 + 我的指派清單 |
| 免訓機制 | ✅ 完成 | `PUT /assignments/:aid/exempt` 核准免訓 + 原因記錄 |

### Phase 1G — 通知系統

| 項目 | 狀態 | 說明 |
|------|------|------|
| 通知 API | ✅ 完成 | list / unread-count / read / read-all |
| 手動發送通知 | ✅ 完成 | `POST /courses/:id/send-notification` 指定使用者 + 訊息 |
| 通知資料表 | ✅ 完成 | `training_notifications` + `course_notification_settings` |

### Phase 1H — 多語言翻譯

| 項目 | 狀態 | 說明 |
|------|------|------|
| LLM 批次翻譯 API | ✅ 完成 | `POST /courses/:id/translate` — 翻譯 course/lesson/slide/quiz → en/vi |
| 翻譯狀態查詢 | ✅ 完成 | `GET /courses/:id/translate/status` — 各語言翻譯進度 |
| 翻譯資料表 | ✅ 完成 | course/lesson/slide/quiz/category_translations 5 張表 |
| 自動翻譯 + 手動編輯 | ✅ 完成 | `is_auto` flag 標記自動/手動 |

### Phase 1I — 進度追蹤 + 管理

| 項目 | 狀態 | 說明 |
|------|------|------|
| 學習進度 API | ✅ 完成 | progress update / my-progress / course progress |
| 筆記 + 書籤 API | ✅ 完成 | CRUD + unique per user+slide |
| Admin 報表頁簽 | ✅ 完成 | 總覽（5 指標卡片）/ 依課程 / 依使用者 表格 |
| AdminDashboard 整合 | ✅ 完成 | 新增「教育訓練報表」tab |

---

## 2. 檔案清單

### 後端 (Server)

| 檔案路徑 | 類型 | 說明 |
|---------|------|------|
| `server/database-oracle.js` | 修改 | +350 行 DB migration（20+ 張表） |
| `server/routes/training.js` | 新增 | ~1600 行，完整 REST API |
| `server/server.js` | 修改 | +2 行，註冊 `/api/training` |

### 前端 (Client) — 頁面 & 路由

| 檔案路徑 | 類型 | 說明 |
|---------|------|------|
| `client/src/pages/TrainingPage.tsx` | 新增 | 路由容器（6 sub-routes） |
| `client/src/App.tsx` | 修改 | 新增 `/training/*` lazy loaded route |
| `client/src/components/Sidebar.tsx` | 修改 | 新增「教育訓練」menu item |
| `client/src/i18n/locales/zh-TW.json` | 修改 | +1 key |
| `client/src/i18n/locales/en.json` | 修改 | +1 key |
| `client/src/i18n/locales/vi.json` | 修改 | +1 key |

### 前端 — 課程瀏覽

| 檔案路徑 | 類型 | 說明 |
|---------|------|------|
| `client/src/components/training/CourseList.tsx` | 新增 | 課程列表首頁 |
| `client/src/components/training/CourseDetail.tsx` | 新增 | 課程詳情頁 |

### 前端 — 教材編輯器

| 檔案路徑 | 類型 | 說明 |
|---------|------|------|
| `client/src/components/training/editor/CourseEditor.tsx` | 新增 | 課程編輯器 |
| `client/src/components/training/editor/SlideEditor.tsx` | 新增 | 投影片編輯器 |
| `client/src/components/training/editor/SlideTemplates.tsx` | 新增 | 版型模板選擇器 |
| `client/src/components/training/editor/AudioPanel.tsx` | 新增 | 音訊面板 |

### 前端 — Block 編輯器 (10 個)

| 檔案路徑 | Block 類型 |
|---------|-----------|
| `client/src/components/training/editor/blocks/TextBlockEditor.tsx` | text |
| `client/src/components/training/editor/blocks/ImageBlockEditor.tsx` | image |
| `client/src/components/training/editor/blocks/StepsEditor.tsx` | steps |
| `client/src/components/training/editor/blocks/CalloutEditor.tsx` | callout |
| `client/src/components/training/editor/blocks/VideoBlockEditor.tsx` | video |
| `client/src/components/training/editor/blocks/HotspotEditor.tsx` | hotspot |
| `client/src/components/training/editor/blocks/DragDropEditor.tsx` | dragdrop |
| `client/src/components/training/editor/blocks/FlipCardEditor.tsx` | flipcard |
| `client/src/components/training/editor/blocks/BranchEditor.tsx` | branch |
| `client/src/components/training/editor/blocks/QuizInlineEditor.tsx` | quiz_inline |

### 前端 — 播放器 + Block 渲染

| 檔案路徑 | 類型 | 說明 |
|---------|------|------|
| `client/src/components/training/CoursePlayer.tsx` | 新增 | 全螢幕學習播放器 |
| `client/src/components/training/SlideRenderer.tsx` | 新增 | 投影片渲染器 |
| `client/src/components/training/blocks/HotspotBlock.tsx` | 新增 | 熱點互動渲染 |
| `client/src/components/training/blocks/DragDropBlock.tsx` | 新增 | 拖放互動渲染 |
| `client/src/components/training/blocks/FlipCardBlock.tsx` | 新增 | 翻轉卡片渲染 |
| `client/src/components/training/blocks/BranchBlock.tsx` | 新增 | 分支選擇渲染 |
| `client/src/components/training/blocks/QuizInlineBlock.tsx` | 新增 | 內嵌測驗渲染 |

### 前端 — 測驗 + 管理

| 檔案路徑 | 類型 | 說明 |
|---------|------|------|
| `client/src/components/training/QuizPage.tsx` | 新增 | 測驗頁面 |
| `client/src/components/admin/TrainingAdmin.tsx` | 新增 | Admin 報表頁簽 |
| `client/src/pages/AdminDashboard.tsx` | 修改 | 整合 TrainingAdmin tab |

---

## 3. API 端點清單

### 分類管理

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/categories` | 分類樹 | 全部 |
| POST | `/api/training/categories` | 新增分類 | can_edit_courses / admin |
| PUT | `/api/training/categories/:id` | 編輯分類 | can_edit_courses / admin |
| DELETE | `/api/training/categories/:id` | 刪除分類 | can_edit_courses / admin |

### 課程 CRUD

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/courses` | 課程列表（含權限過濾） | 全部 |
| POST | `/api/training/courses` | 建立課程 | can_edit_courses / admin |
| GET | `/api/training/courses/:id` | 課程詳情（含 lessons、quiz_count） | view+ |
| PUT | `/api/training/courses/:id` | 編輯課程 | develop+ |
| DELETE | `/api/training/courses/:id` | 刪除課程 | owner / admin |
| POST | `/api/training/courses/:id/publish` | 發佈 | develop+ |
| POST | `/api/training/courses/:id/archive` | 封存 | owner / admin |
| POST | `/api/training/courses/:id/duplicate` | 複製課程（含 lessons/slides/quiz） | develop+ |
| POST | `/api/training/courses/:id/cover` | 上傳封面圖 | develop+ |

### 課程分享

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/courses/:id/access` | 分享清單 | develop+ |
| POST | `/api/training/courses/:id/access` | 授權 | develop+ |
| PUT | `/api/training/courses/:id/access/:aid` | 更新權限 | develop+ |
| DELETE | `/api/training/courses/:id/access/:aid` | 撤銷 | develop+ |
| POST | `/api/training/courses/:id/request-public` | 申請/設為公開 | develop+ |

### 章節

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/courses/:id/lessons` | 章節列表 | view+ |
| POST | `/api/training/courses/:id/lessons` | 新增章節 | develop+ |
| PUT | `/api/training/lessons/:lid` | 編輯章節 | develop+ |
| DELETE | `/api/training/lessons/:lid` | 刪除章節（cascade slides） | develop+ |
| PUT | `/api/training/courses/:id/lessons/reorder` | 排序 | develop+ |

### 投影片

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/lessons/:lid/slides` | 投影片列表 | view+ |
| GET | `/api/training/slides/:sid` | 單筆投影片 | view+ |
| POST | `/api/training/lessons/:lid/slides` | 新增投影片 | develop+ |
| PUT | `/api/training/slides/:sid` | 編輯投影片 | develop+ |
| DELETE | `/api/training/slides/:sid` | 刪除投影片 | develop+ |
| PUT | `/api/training/lessons/:lid/slides/reorder` | 排序 | develop+ |

### 音訊

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| POST | `/api/training/slides/:sid/audio` | 上傳音訊（可同時 STT 轉錄） | develop+ |
| POST | `/api/training/slides/:sid/tts` | TTS 生成語音 | develop+ |
| DELETE | `/api/training/slides/:sid/audio` | 刪除音訊 | develop+ |

### 影片互動

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/lessons/:lid/video-interactions` | 互動節點列表 | view+ |
| POST | `/api/training/lessons/:lid/video-interactions` | 新增互動節點 | develop+ |
| PUT | `/api/training/video-interactions/:vid` | 編輯 | develop+ |
| DELETE | `/api/training/video-interactions/:vid` | 刪除 | develop+ |

### 題庫

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/courses/:id/questions` | 題目列表 | view+ |
| POST | `/api/training/courses/:id/questions` | 新增題目 | develop+ |
| PUT | `/api/training/questions/:qid` | 編輯題目 | develop+ |
| DELETE | `/api/training/questions/:qid` | 刪除題目 | develop+ |
| PUT | `/api/training/courses/:id/questions/reorder` | 排序 | develop+ |

### 測驗

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| POST | `/api/training/courses/:id/quiz/start` | 開始測驗 | view+ |
| POST | `/api/training/courses/:id/quiz/submit` | 提交測驗（含自動評分） | view+ |

### AI 功能

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| POST | `/api/training/courses/:id/ai-generate-quiz` | AI 自動出題 | develop+ |
| POST | `/api/training/courses/:id/ai-tutor` | AI 助教對話 | view+ |

### 學習路徑

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/paths` | 路徑列表 | 全部 |
| POST | `/api/training/paths` | 建立路徑 | 登入 |
| GET | `/api/training/paths/:id` | 路徑詳情（含課程） | 全部 |
| POST | `/api/training/paths/:id/courses` | 新增課程到路徑 | 登入 |
| DELETE | `/api/training/paths/:id/courses/:cid` | 移除課程 | 登入 |

### 培訓專案

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/programs` | 專案列表 | 全部 |
| POST | `/api/training/programs` | 建立專案 | 登入 |
| GET | `/api/training/programs/:id` | 專案詳情（含 targets / courses / stats） | 全部 |
| POST | `/api/training/programs/:id/targets` | 新增對象群組 | 登入 |
| POST | `/api/training/programs/:id/courses` | 新增課程 | 登入 |
| POST | `/api/training/programs/:id/activate` | 啟動（自動展開指派） | 登入 |
| GET | `/api/training/programs/:id/assignments` | 指派清單 | 登入 |
| GET | `/api/training/my-assignments` | 我的指派 | 登入 |
| PUT | `/api/training/assignments/:aid/exempt` | 免訓 | 登入 |

### 通知

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/notifications` | 通知列表 | 登入 |
| GET | `/api/training/notifications/unread-count` | 未讀數量 | 登入 |
| PUT | `/api/training/notifications/:nid/read` | 標記已讀 | 登入 |
| PUT | `/api/training/notifications/read-all` | 全部已讀 | 登入 |
| POST | `/api/training/courses/:id/send-notification` | 手動發送通知 | develop+ |

### 翻譯

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| POST | `/api/training/courses/:id/translate` | 批次 LLM 翻譯 | develop+ |
| GET | `/api/training/courses/:id/translate/status` | 翻譯狀態 | view+ |

### 進度 & 筆記

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| POST | `/api/training/courses/:id/progress` | 更新學習進度 | view+ |
| GET | `/api/training/my-progress` | 我的進度總覽 | 登入 |
| GET | `/api/training/courses/:id/my-progress` | 特定課程進度 | view+ |
| GET | `/api/training/courses/:id/my-notes` | 我的筆記 | view+ |
| POST | `/api/training/notes` | 新增/更新筆記 | 登入 |
| DELETE | `/api/training/notes/:nid` | 刪除筆記 | 登入 |

### Admin 報表

| Method | Path | 說明 | 權限 |
|--------|------|------|------|
| GET | `/api/training/admin/reports/overview` | 總覽（5 指標） | admin |
| GET | `/api/training/admin/reports/by-course` | 依課程統計 | admin |
| GET | `/api/training/admin/reports/by-user` | 依使用者統計 | admin |

---

## 4. DB 表清單

| 表名 | 用途 | 關聯 |
|------|------|------|
| `COURSE_CATEGORIES` | 課程分類（樹狀，最多 3 層） | parent_id 自引用 |
| `COURSES` | 課程主檔 | → users, course_categories |
| `COURSE_LESSONS` | 章節 | → courses |
| `COURSE_SLIDES` | 投影片（block-based JSON） | → course_lessons |
| `VIDEO_INTERACTIONS` | 影片互動節點 | → course_lessons |
| `SLIDE_BRANCHES` | 分支節點 | → course_slides |
| `QUIZ_QUESTIONS` | 題庫（含 scoring_json 評分規則） | → courses |
| `QUIZ_ATTEMPTS` | 測驗結果 | → courses, users |
| `USER_COURSE_PROGRESS` | 學習進度 | → users, courses, course_lessons |
| `COURSE_ACCESS` | 課程分享權限（view/develop） | → courses |
| `LEARNING_PATHS` | 學習路徑 | → users |
| `LEARNING_PATH_COURSES` | 路徑中的課程（有序 + 前置條件） | → learning_paths, courses |
| `TRAINING_PROGRAMS` | 培訓專案 | → users, learning_paths |
| `PROGRAM_COURSES` | 專案中的課程 | → training_programs, courses |
| `PROGRAM_TARGETS` | 專案對象群組 | → training_programs |
| `PROGRAM_ASSIGNMENTS` | 個人指派 | → training_programs, courses, users |
| `TRAINING_NOTIFICATIONS` | 系統內通知 | → users, courses |
| `COURSE_NOTIFICATION_SETTINGS` | 課程通知設定 | → courses |
| `COURSE_TRANSLATIONS` | 課程翻譯 | → courses |
| `LESSON_TRANSLATIONS` | 章節翻譯 | → course_lessons |
| `SLIDE_TRANSLATIONS` | 投影片翻譯 | → course_slides |
| `QUIZ_TRANSLATIONS` | 題目翻譯 | → quiz_questions |
| `CATEGORY_TRANSLATIONS` | 分類翻譯 | → course_categories |
| `TUTOR_CONVERSATIONS` | AI 助教對話紀錄 | → courses, users |
| `USER_COURSE_NOTES` | 學習筆記 + 書籤 | → users, courses, course_slides |
| `IFRAME_GUIDE_STEPS` | iframe 導引步驟（Phase 2 預留） | → course_lessons |
| `users.CAN_EDIT_COURSES` | 使用者教材編輯權限欄位 | users 表新增欄位 |

---

## 5. 測試範例

### 5.1 基礎流程：建立課程 → 編輯 → 發佈 → 學習

```bash
# 1. 建立課程
curl -X POST http://localhost:3001/api/training/courses \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "FOXLINK GPT 基礎操作教學",
    "description": "學習 FOXLINK GPT 系統的基本操作",
    "pass_score": 70
  }'
# Response: { "id": 1, "title": "FOXLINK GPT 基礎操作教學" }

# 2. 新增章節
curl -X POST http://localhost:3001/api/training/courses/1/lessons \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{ "title": "系統介紹", "lesson_type": "slides" }'
# Response: { "id": 1, "title": "系統介紹", "sort_order": 1 }

# 3. 新增投影片
curl -X POST http://localhost:3001/api/training/lessons/1/slides \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "slide_type": "content",
    "content_json": [
      { "type": "text", "content": "# FOXLINK GPT 系統介紹\n\n這是一套企業級 AI 對話平台。" },
      { "type": "callout", "variant": "tip", "content": "建議使用 Chrome 瀏覽器以獲得最佳體驗" }
    ],
    "notes": "歡迎來到 FOXLINK GPT 系統介紹課程"
  }'

# 4. 新增互動投影片（hotspot）
curl -X POST http://localhost:3001/api/training/lessons/1/slides \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "slide_type": "hotspot",
    "content_json": [
      {
        "type": "hotspot",
        "image": "/uploads/training/course_1/login_screen.png",
        "instruction": "請點擊登入按鈕",
        "regions": [
          { "id": "r1", "shape": "rect", "coords": { "x": 40, "y": 70, "w": 20, "h": 8 }, "correct": true, "feedback": "正確！這就是登入按鈕。" },
          { "id": "r2", "shape": "rect", "coords": { "x": 40, "y": 85, "w": 20, "h": 8 }, "correct": false, "feedback": "這是註冊按鈕，請找到登入按鈕。" }
        ],
        "max_attempts": 3,
        "show_hint_after": 2
      }
    ]
  }'

# 5. 發佈課程
curl -X POST http://localhost:3001/api/training/courses/1/publish \
  -H "Authorization: Bearer {token}"

# 6. 查看課程（學員視角）
curl http://localhost:3001/api/training/courses/1 \
  -H "Authorization: Bearer {token}"

# 7. 更新學習進度
curl -X POST http://localhost:3001/api/training/courses/1/progress \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{ "lesson_id": 1, "current_slide_index": 1, "status": "in_progress" }'
```

### 5.2 測驗流程

```bash
# 1. 新增題目
curl -X POST http://localhost:3001/api/training/courses/1/questions \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "question_type": "single_choice",
    "question_json": {
      "text": "FOXLINK GPT 預設使用哪個 AI 模型？",
      "options": ["Gemini 3 Pro", "Gemini 3 Flash", "GPT-4o", "Claude 3.5"]
    },
    "answer_json": { "correct": 0 },
    "scoring_json": { "mode": "exact", "full_score": 10 },
    "points": 10,
    "explanation": "FOXLINK GPT 預設使用 Gemini 3 Pro 模型"
  }'

# 2. 新增多選題（部分給分）
curl -X POST http://localhost:3001/api/training/courses/1/questions \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "question_type": "multi_choice",
    "question_json": {
      "text": "FOXLINK GPT 支援哪些檔案格式？（複選）",
      "options": ["PDF", "Excel", "影片", "Word", "PPT"]
    },
    "answer_json": { "correct": [0, 1, 3, 4] },
    "scoring_json": {
      "mode": "partial",
      "partial_credit": true,
      "scoring_method": "proportion",
      "wrong_penalty": -2,
      "min_score": 0
    },
    "points": 10,
    "explanation": "FOXLINK GPT 支援 PDF、Excel、Word、PPT，但不支援影片上傳"
  }'

# 3. 開始測驗
curl -X POST http://localhost:3001/api/training/courses/1/quiz/start \
  -H "Authorization: Bearer {token}"
# Response: { "attempt_id": 1, "attempt_number": 1 }

# 4. 提交測驗
curl -X POST http://localhost:3001/api/training/courses/1/quiz/submit \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "answers": {
      "1": 0,
      "2": [0, 1, 3, 4]
    }
  }'
# Response: { "score": 20, "total_points": 20, "passed": true, "details": [...] }
```

### 5.3 AI 輔助出題

```bash
curl -X POST http://localhost:3001/api/training/courses/1/ai-generate-quiz \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "question_count": 5,
    "question_types": ["single_choice", "multi_choice", "fill_blank"],
    "difficulty": "medium",
    "model_key": "flash"
  }'
# Response: { "questions": [{ "question_type": "single_choice", ... }, ...] }
```

### 5.4 AI 助教對話

```bash
curl -X POST http://localhost:3001/api/training/courses/1/ai-tutor \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "為什麼要先選模型才能開始對話？",
    "lesson_id": 1,
    "slide_id": 2
  }'
# Response: { "answer": "因為不同模型有不同的能力..." }
```

### 5.5 培訓專案：建立 → 指定對象 → 啟動

```bash
# 1. 建立培訓專案
curl -X POST http://localhost:3001/api/training/programs \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "2026 Q2 新人到職訓練",
    "purpose": "確保新進人員熟悉 FOXLINK GPT 系統操作",
    "start_date": "2026-04-01",
    "end_date": "2026-04-30",
    "remind_before_days": 3,
    "email_enabled": 1
  }'
# Response: { "id": 1 }

# 2. 新增課程到專案
curl -X POST http://localhost:3001/api/training/programs/1/courses \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{ "course_id": 1, "is_required": 1 }'

# 3. 新增對象群組（整個部門）
curl -X POST http://localhost:3001/api/training/programs/1/targets \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{ "target_type": "dept", "target_id": "MFG1" }'

# 4. 新增對象群組（全體 user 角色）
curl -X POST http://localhost:3001/api/training/programs/1/targets \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{ "target_type": "role", "target_id": "user" }'

# 5. 啟動（自動展開指派）
curl -X POST http://localhost:3001/api/training/programs/1/activate \
  -H "Authorization: Bearer {token}"
# Response: { "ok": true, "assignments_created": 150, "users": 50, "courses": 3 }

# 6. 查看指派清單
curl http://localhost:3001/api/training/programs/1/assignments \
  -H "Authorization: Bearer {token}"

# 7. 我的指派
curl http://localhost:3001/api/training/my-assignments \
  -H "Authorization: Bearer {token}"
```

### 5.6 多語言翻譯

```bash
# 翻譯課程到英文
curl -X POST http://localhost:3001/api/training/courses/1/translate \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{ "target_lang": "en" }'
# Response: { "ok": true, "translated": { "lessons": 5, "questions": 20 } }

# 查看翻譯狀態
curl http://localhost:3001/api/training/courses/1/translate/status \
  -H "Authorization: Bearer {token}"
# Response: { "en": { "course_translated": true, "slides_total": 25, "slides_translated": 25 }, "vi": { ... } }
```

### 5.7 TTS 語音生成

```bash
# 為投影片生成 TTS 旁白
curl -X POST http://localhost:3001/api/training/slides/1/tts \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "歡迎來到 FOXLINK GPT 系統介紹課程，請跟著步驟操作。",
    "language": "zh-TW",
    "voice": "cmn-TW-Wavenet-A",
    "speakingRate": 1.0
  }'
# Response: { "audio_url": "/uploads/training/course_1/tts_1_1712012345.mp3" }
```

### 5.8 音訊上傳 + STT 轉錄

```bash
# 上傳錄音並同時轉錄
curl -X POST http://localhost:3001/api/training/slides/1/audio \
  -H "Authorization: Bearer {token}" \
  -F "audio=@recording.webm" \
  -F "transcribe=true"
# Response: { "audio_url": "/uploads/training/course_1/abc123.webm", "transcription": "轉錄的文字內容..." }
```

### 5.9 通知

```bash
# 手動發送通知
curl -X POST http://localhost:3001/api/training/courses/1/send-notification \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "user_ids": [2, 3, 5],
    "message": "課程已更新，請重新學習第 3 章節",
    "type": "course_updated"
  }'

# 查看我的通知
curl http://localhost:3001/api/training/notifications \
  -H "Authorization: Bearer {token}"

# 未讀數量
curl http://localhost:3001/api/training/notifications/unread-count \
  -H "Authorization: Bearer {token}"
# Response: { "count": 3 }

# 全部標為已讀
curl -X PUT http://localhost:3001/api/training/notifications/read-all \
  -H "Authorization: Bearer {token}"
```

### 5.10 Admin 報表

```bash
# 總覽
curl http://localhost:3001/api/training/admin/reports/overview \
  -H "Authorization: Bearer {admin_token}"
# Response: {
#   "total_courses": 8,
#   "active_learners": 120,
#   "completions": 85,
#   "avg_score": 78,
#   "pass_rate": 82
# }

# 依課程
curl http://localhost:3001/api/training/admin/reports/by-course \
  -H "Authorization: Bearer {admin_token}"

# 依使用者
curl http://localhost:3001/api/training/admin/reports/by-user \
  -H "Authorization: Bearer {admin_token}"
```

---

## 6. 前端操作流程

### 6.1 教材製作流程

```
Sidebar「教育訓練」 → 課程列表 → 「我的教材」 → 「新增課程」
  ↓
填寫基本資訊（標題、描述、分類、及格分數）→ 建立
  ↓
「章節管理」tab → 新增章節 → 展開章節 → 新增投影片
  ↓
點擊投影片 → 進入 SlideEditor（全螢幕）
  ↓
選擇版型 or 手動新增 Block（文字/圖片/hotspot/dragdrop/flipcard...）
  ↓
編輯每個 Block 的內容 → 輸入旁白文字 → TTS 生成語音 or 麥克風錄音
  ↓
儲存 → 返回 → 繼續編輯其他投影片
  ↓
「題庫」tab → 新增題目 or AI 自動出題
  ↓
「發佈課程」
```

### 6.2 學員學習流程

```
Sidebar「教育訓練」 → 課程列表 → 點擊課程卡片
  ↓
課程詳情頁（章節列表、進度）→ 「開始學習」
  ↓
進入 CoursePlayer（全螢幕）
  ↓
瀏覽投影片（← → 鍵導航）→ 與互動元件互動（hotspot/dragdrop/flipcard...）
  ↓
遇到問題 → 打開 AI 助教面板提問
  ↓
重要內容 → 打開筆記面板記錄
  ↓
全部投影片完成 → 進入測驗
  ↓
逐題作答 → 提交 → 查看分數和解析
  ↓
通過 → 課程標記為完成 ✓
```

### 6.3 管理者操作流程

```
建立培訓專案 → 設定目的、期間
  ↓
新增課程（或引用學習路徑）
  ↓
指定對象群組（部門/角色/個人）
  ↓
預覽 → 啟動 → 系統自動建立所有個人指派 + 發送通知
  ↓
Admin 後台 →「教育訓練報表」→ 查看完成率、平均分數、部門進度
```

---

## 7. 權限模型

```
┌──────────────────────────────────────────────────┐
│                     權限層級                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  owner    = 課程建立者                            │
│  admin    = 系統管理員                            │
│  develop  = 被分享開發權限的使用者                  │
│  view     = 被分享檢視權限 / 公開課程              │
│                                                  │
│  can_edit_courses = 可建立新課程的旗標（users 表）  │
│                                                  │
├──────────────────────────────────────────────────┤
│                     操作對應                      │
├──────────────────────────────────────────────────┤
│  建立課程    → can_edit_courses 或 admin          │
│  編輯/發佈   → owner / admin / develop            │
│  刪除       → owner / admin                      │
│  學習/測驗   → view 以上                          │
│  分享/指派   → develop 以上                       │
│  管理報表    → admin only                        │
└──────────────────────────────────────────────────┘
```

---

---

## 8. Phase 2 完成項目：AI 輔助錄製 + 跨系統

### Phase 2A — AI 截圖分析

| 項目 | 狀態 | 說明 |
|------|------|------|
| AI 截圖分析 API | ✅ 完成 | `POST /ai/analyze-screenshot` — Gemini Vision 辨識 UI 元素，回傳 regions + 說明 + 敏感偵測 |
| 批次截圖分析 API | ✅ 完成 | `POST /ai/batch-analyze` — 最多 50 張截圖批次分析 |
| AI 生成操作大綱 | ✅ 完成 | `POST /ai/generate-outline` — 從使用手冊章節內容 → AI 拆解操作步驟清單 |
| HotspotEditor AI 辨識 | ✅ 完成 | 截圖上方新增「AI 一鍵辨識」按鈕，一鍵建立所有 hotspot regions |
| 批次匯入截圖 | ✅ 完成 | BatchImport 元件 — 多張截圖一次匯入 + AI 辨識 + 自動建立投影片 |
| Hotspot 區域拖拉 | ✅ 完成 | 可拖拉移動區域 + 四角 resize handles 調整大小 |

### Phase 2B — Chrome Extension

| 項目 | 狀態 | 說明 |
|------|------|------|
| manifest.json | ✅ 完成 | Manifest V3, `<all_urls>` 權限 |
| Content Script | ✅ 完成 | click/input/navigate 事件監聽 + 元素資訊收集 + selector 生成 + 高亮提示 + 錄製 badge |
| Background Worker | ✅ 完成 | `captureVisibleTab` 截圖 + 上傳到 server + 錄製狀態管理 |
| Popup UI | ✅ 完成 | 登入連線 + 輸入 session ID + 開始/停止錄製 + 手動截圖 |

### Phase 2C — 錄製控制面板 + AI 後製

| 項目 | 狀態 | 說明 |
|------|------|------|
| 錄製 API | ✅ 完成 | start/step/complete/analyze/generate 五個 endpoint |
| RecordingPanel UI | ✅ 完成 | 選使用手冊章節 → AI 生成大綱 → 開啟目標視窗 → 手動/自動截圖 → AI 分析 → 生成教材 |
| AI 批次分析 | ✅ 完成 | 錄製完成後一鍵 AI 分析所有步驟截圖 |
| 自動生成教材 | ✅ 完成 | 從錄製結果自動建立課程/章節/投影片（hotspot + content） |

### Phase 2D — 跨系統管理

| 項目 | 狀態 | 說明 |
|------|------|------|
| 目標系統登錄 | ✅ 完成 | `training_systems` 表 + CRUD API |
| 教學腳本管理 | ✅ 完成 | `teaching_scripts` 表 + CRUD API + 批次匯入 |
| 錄製工作階段 | ✅ 完成 | `recording_sessions` + `recording_steps` 表 |

### Phase 2E — 截圖標註系統 + AI 模型選擇器

| 項目 | 狀態 | 說明 |
|------|------|------|
| Extension 標註編輯器 | ✅ 完成 | 截圖後凍結畫面 + Canvas overlay，7 種標註工具 |
| 步驟編號 ①②③ | ✅ 完成 | 點擊放置自動遞增編號圓圈，標記操作順序 |
| 圓圈/矩形框/箭頭 | ✅ 完成 | 拖拉繪製，用於圈住/框選/指向操作元素 |
| 文字標註 | ✅ 完成 | 點擊位置輸入文字，Enter 確認 |
| 自由畫筆 | ✅ 完成 | 滑鼠拖拉自由繪製 |
| 馬賽克遮蔽 | ✅ 完成 | 拖拉選區自動模糊，遮蔽密碼等敏感資訊 |
| 顏色選擇 (5色) | ✅ 完成 | 紅/藍/綠/黃/白 |
| 線條粗細 (3段) | ✅ 完成 | 細/中/粗 |
| 復原/重做/清除 | ✅ 完成 | Ctrl+Z 復原、Ctrl+Y 重做、一鍵清除 |
| 鍵盤快捷鍵 | ✅ 完成 | 1-7 選工具、Esc 取消 |
| 跳過標註 | ✅ 完成 | 可跳過直接上傳原圖（不強制標註） |
| 原圖/標註圖分離儲存 | ✅ 完成 | `screenshot_raw_url` + `screenshot_url` + `annotations_json` |
| DB Migration | ✅ 完成 | `recording_steps` 新增 `ANNOTATIONS_JSON` + `SCREENSHOT_RAW_URL` |
| AI Prompt 整合標註 | ✅ 完成 | 分析時帶入標註座標，按①②③順序生成操作說明 |
| AnnotationOverlay 元件 | ✅ 完成 | SVG 渲染 7 種標註（播放器/編輯器共用） |
| HotspotBlock 整合 | ✅ 完成 | 播放時疊加 SVG 標註層 |
| SlideRenderer 整合 | ✅ 完成 | image block 支援 annotations 渲染 |
| AI 模型選擇器 | ✅ 完成 | `GET /api/training/ai/models` + RecordingPanel 底部下拉選單 |
| 投影片標註寫入 | ✅ 完成 | generate 時 annotations 寫入 `content_json`（hotspot/image block） |

### Phase 2F — HTML5 匯出 + 進階標註 + 翻譯改進 + UI 優化

| 項目 | 狀態 | 說明 |
|------|------|------|
| HTML5 單檔匯出 API | ✅ 完成 | `POST /courses/:id/export` 截圖 base64 內嵌 + 內嵌 JS/CSS 播放器 |
| 內嵌播放器 | ✅ 完成 | 投影片瀏覽/鍵盤翻頁/Hotspot區域/SVG標註/多語切換/測驗計分/響應式 |
| 前端匯出面板 | ✅ 完成 | `ExportButton` 下拉：語言勾選 + 測驗/音訊/標註選項 + 一鍵下載 |
| 標註動畫播放 | ✅ 完成 | `AnnotationOverlay` 新增 `animateInterval` prop，預設 600ms 逐一淡入 |
| Canvas 真實馬賽克 | ✅ 完成 | Extension 馬賽克讀截圖像素做像素化（非假格子） |
| 翻譯 SSE 串流 | ✅ 完成 | `translate` 改為 SSE，前端即時顯示 `⏳ 翻譯投影片 3/7...` + 進度條 |
| AI 模型設定 | ✅ 完成 | `GET/PUT /ai/settings`（training_analyze_model + training_translate_model） |
| 設定頁籤 UI | ✅ 完成 | CourseEditor「設定」tab：辨識模型/翻譯模型下拉 + 模型比較表 |
| Hotspot 左圖右文 | ✅ 完成 | 播放器 HotspotBlock 改為左側截圖 + 右側操作說明面板 |
| 圖片放大 Lightbox | ✅ 完成 | 截圖右上角 🔍 按鈕，點擊全螢幕檢視（可在放大模式操作互動） |
| CoursePlayer 主題適配 | ✅ 完成 | Topbar/Sidebar/Bottom/Panels 全面改用 `var(--t-*)` 變數 |
| 投影片拖拉排序 | ✅ 完成 | CourseEditor 投影片列表 ▲▼ 改為 `GripVertical` 拖拉手把 |
| 截圖重複修復 | ✅ 完成 | 投影片用 `screenshot_raw_url` 原圖，SVG overlay 獨立渲染標註 |

### Phase 3A — 圖層分離 + 多語底圖切換

#### Phase 3A-1 — 圖層分離（核心架構重設計）

| 項目 | 狀態 | 說明 |
|------|------|------|
| Extension 不燒圖 | ✅ 完成 | `finalize()` 移除 mergeCanvas，只送乾淨原圖 + annotations JSON |
| Background 簡化上傳 | ✅ 完成 | 只送 `screenshot_base64`（乾淨圖），不再送 `screenshot_raw_base64` |
| Server step upload 簡化 | ✅ 完成 | `screenshot_url` 永遠是乾淨圖，不再存 `screenshot_raw_url` |
| AI 座標標準化 | ✅ 完成 | prompt 要求百分比、回傳後用 `image-size` 驗證、像素自動轉百分比 |
| AI 只保留使用者標記 | ✅ 完成 | 比對 annotation ①②③ 位置 vs AI region，距離 <30% 才保留 |
| Generate 簡化 | ✅ 完成 | 新增 `coordinate_system: 'percent'` + `image_dimensions`，`annotations_in_image: false` |
| HotspotBlock coordinate_system | ✅ 完成 | 優先用欄位判斷，fallback 啟發式（向下相容） |
| HTML5 匯出 coordinate_system | ✅ 完成 | 同樣用 `coordinate_system` + `image_dimensions` |

#### Phase 3A-2 — 多語底圖切換

| 項目 | 狀態 | 說明 |
|------|------|------|
| DB migration | ✅ 完成 | `recording_steps.lang` + `slide_translations.image_overrides` |
| Extension Badge 語言按鈕 | ✅ 完成 | 錄製 badge 加 [中][EN][VI] 切換，截圖自動帶語言標記 |
| Step upload 加 lang | ✅ 完成 | 每張截圖存語言標記到 `recording_steps.lang` |
| Generate 多語分流 | ✅ 完成 | zh-TW 建主投影片，en/vi 截圖寫入 `slide_translations.image_overrides` |
| Slides 讀取 image_overrides | ✅ 完成 | `GET /lessons/:lid/slides?lang=en` 自動套用語言底圖 |
| Lang-image upload API | ✅ 完成 | `POST/DELETE/GET /slides/:sid/lang-image` 上傳/刪除/查詢語言底圖 |
| Export image_overrides | ✅ 完成 | HTML5 匯出時讀 `image_overrides` per-language 底圖 |
| LanguageImagePanel | ✅ 完成 | HotspotEditor 底部多語底圖管理面板（en/vi tab + 上傳/預覽/刪除） |
| CoursePlayer 語言重載 | ✅ 完成 | `i18n.language` 變更時重新載入投影片（底圖跟著切換） |

#### Phase 3A-3 — 截圖模式 + 錄製改善 + 標註編輯 + UI 優化

| 項目 | 狀態 | 說明 |
|------|------|------|
| 截圖三模式 | ✅ 完成 | Badge [📸全螢幕][⬜矩形選取][🎯智慧偵測]，矩形拖拉裁切，DOM 分析自動裁切 |
| RecordingPanel 拖拉排序 | ✅ 完成 | 截圖 grid HTML5 drag-drop 排序（取代上下鍵） |
| 自動排序 | ✅ 完成 | zh-TW 自動遞增編號，en/vi 套用對應中文序號，步驟→語言排列 |
| 步驟/語言確認按鈕 | ✅ 完成 | 右側「確認修改」+ 底部「確認順序」批次存到 server |
| 補錄功能 | ✅ 完成 | 停止後「+ 補錄」同一 session 繼續，Extension 截圖追加 |
| 刪除確認 | ✅ 完成 | 縮圖/右側刪除按鈕加 confirm 對話框 |
| 截圖防重複 | ✅ 完成 | `manifest.json` all_frames:false + debounce + annotationActive 防重入 |
| AnnotationEditor | ✅ 完成 | 新元件：SVG 拖拉移動標註 + 選取/刪除/顏色/標籤編輯 |
| 標註全流程可見 | ✅ 完成 | RecordingPanel 縮圖+預覽 + HotspotEditor 加「標註可見/隱藏」toggle |
| SlideEditor AI 分析 | ✅ 完成 | Header 加「AI 分析」按鈕，對單張投影片重新分析 |
| 多語 region 位置微調 | ✅ 完成 | LanguageImagePanel 放大 modal 拖拉綠框 + `PUT region-overrides` API |
| 登入語言同步 | ✅ 完成 | Login 頁選的語言 → 登入後生效 + 同步存 server |

---

## 9. Phase 2 新增檔案清單

### 後端

| 檔案 | 說明 |
|------|------|
| `server/routes/training.js` | +400 行新增 AI 分析/錄製/跨系統 API |
| `server/database-oracle.js` | +60 行新增 4 張表 migration |

### 前端

| 檔案 | 說明 |
|------|------|
| `client/src/components/training/editor/BatchImport.tsx` | 批次匯入截圖面板（多檔上傳 + AI 辨識 + 進度顯示） |
| `client/src/components/training/editor/RecordingPanel.tsx` | AI 輔助錄製控制面板（選章節 + 大綱 + 錄製 + AI 分析 + 生成） |
| `client/src/components/training/editor/CourseEditor.tsx` | 修改：新增「AI 錄製」「批次匯入截圖」按鈕 |
| `client/src/components/training/editor/blocks/HotspotEditor.tsx` | 修改：新增「AI 一鍵辨識」按鈕 + 拖拉移動 + resize handles |

### Chrome Extension

| 檔案 | 說明 |
|------|------|
| `chrome-extension/manifest.json` | Manifest V3 設定 |
| `chrome-extension/background.js` | 截圖 + 上傳 + 錄製狀態管理 |
| `chrome-extension/content.js` | DOM 事件監聽 + selector 生成 + 高亮 + badge |
| `chrome-extension/content.css` | 錄製 badge 動畫 |
| `chrome-extension/popup.html` | Extension 控制介面 HTML |
| `chrome-extension/popup.js` | 登入 + 錄製控制邏輯 |

### Phase 2E 新增/修改檔案

| 檔案 | 變更 | 說明 |
|------|------|------|
| `chrome-extension/content.js` | 修改 | +350 行：`startAnnotationMode()` 標註編輯器、7種工具、Canvas繪圖、復原/重做 |
| `chrome-extension/background.js` | 修改 | +80 行：`MANUAL_SCREENSHOT_WITH_ANNOTATION`、`ANNOTATED_SCREENSHOT` 訊息處理 |
| `server/database-oracle.js` | 修改 | +3 行：`safeAddColumn('RECORDING_STEPS', 'ANNOTATIONS_JSON/SCREENSHOT_RAW_URL')` |
| `server/routes/training.js` | 修改 | +80 行：step upload 支援 annotations、AI prompt 整合標註、模型選擇、`GET /ai/models` |
| `client/src/components/training/blocks/AnnotationOverlay.tsx` | **新增** | SVG 標註渲染元件（7 種類型：number/circle/rect/arrow/text/freehand/mosaic） |
| `client/src/components/training/blocks/HotspotBlock.tsx` | 修改 | +5 行：整合 AnnotationOverlay 顯示 |
| `client/src/components/training/SlideRenderer.tsx` | 修改 | +5 行：image block 支援 annotations |
| `client/src/components/training/editor/RecordingPanel.tsx` | 修改 | +25 行：AI 模型選擇下拉 + 傳遞 model 給 server |

### Phase 2F 新增/修改檔案

| 檔案 | 變更 | 說明 |
|------|------|------|
| `server/routes/training.js` | 修改 | +250 行：`POST /courses/:id/export` HTML5 匯出 + `buildExportHtml()` 內嵌播放器 |
| `server/routes/training.js` | 修改 | 翻譯改 SSE 串流進度 + `GET/PUT /ai/settings` 模型設定 API |
| `client/src/components/training/editor/CourseEditor.tsx` | 修改 | +130 行：`ExportButton` 匯出面板 + `TrainingAISettings` 模型設定 |
| `client/src/components/training/blocks/AnnotationOverlay.tsx` | 修改 | +30 行：`animateInterval` prop 標註動畫逐步淡入 |
| `client/src/components/training/blocks/HotspotBlock.tsx` | 修改 | 改為左圖右文版面 + 放大鏡 lightbox + 動畫標註 |
| `client/src/components/training/SlideRenderer.tsx` | 修改 | text/callout block 改用主題變數（light 主題相容） |
| `client/src/components/training/CoursePlayer.tsx` | 修改 | 全面改用主題變數（topbar/sidebar/bottom bar/panels） |
| `chrome-extension/content.js` | 修改 | 馬賽克工具改為讀截圖像素真實模糊 |

### Phase 3A 新增/修改檔案

| 檔案 | 變更 | 說明 |
|------|------|------|
| `server/database-oracle.js` | 修改 | +2 行：`recording_steps.LANG` + `slide_translations.IMAGE_OVERRIDES` |
| `chrome-extension/content.js` | 修改 | `finalize()` 移除 mergeCanvas；Badge 加 [中][EN][VI] 語言按鈕 |
| `chrome-extension/background.js` | 修改 | `ANNOTATED_SCREENSHOT` 只送乾淨圖 + lang 參數 |
| `server/routes/training.js` | 修改 | step upload 加 lang / AI 座標標準化 / generate 多語分流 / slides 讀取 image_overrides / export image_overrides / lang-image CRUD API |
| `client/src/components/training/blocks/HotspotBlock.tsx` | 修改 | `coordinate_system` 判斷 + `image_dimensions` 精確轉換 |
| `client/src/components/training/CoursePlayer.tsx` | 修改 | `i18n.language` 切換時重載投影片 |
| `client/src/components/training/editor/blocks/LanguageImagePanel.tsx` | **新增** | 多語底圖管理面板（上傳/預覽/刪除 per-language 底圖） |
| `client/src/components/training/editor/blocks/HotspotEditor.tsx` | 修改 | 加入 LanguageImagePanel + slideId/blockIdx props |
| `client/src/components/training/editor/SlideEditor.tsx` | 修改 | BlockEditorSwitch 傳 slideId/blockIdx + AI 分析按鈕 |
| `client/src/components/training/editor/blocks/AnnotationEditor.tsx` | **新增** | 標註圖層編輯器（SVG 拖拉移動/選取/刪除/顏色/標籤） |
| `client/src/components/training/editor/RecordingPanel.tsx` | 修改 | 截圖拖拉排序 + 自動排序 + 補錄功能 + 刪除確認 + 標註可見 toggle + 步驟/語言確認按鈕 |
| `client/src/context/AuthContext.tsx` | 修改 | 登入語言同步（Login 頁選的語言 → 登入後生效 + 存 server） |
| `chrome-extension/manifest.json` | 修改 | `all_frames: false` 防止 iframe 重複截圖 |
| `server/routes/training.js` | 修改 | `POST /slides/:sid/ai-analyze` 單張 AI 分析 + `PUT /recording/:sid/steps` 批次更新 + `PUT /slides/:sid/region-overrides` per-language region 位置 |

---

## 10. Phase 2 API 端點清單

### AI 分析

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/training/ai/analyze-screenshot` | 單張截圖 AI 辨識（支援 file/base64/url） |
| POST | `/api/training/ai/batch-analyze` | 多張截圖批次 AI 辨識 |
| POST | `/api/training/ai/generate-outline` | 從使用手冊章節 → AI 操作步驟大綱 |

### 錄製

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/training/recording/start` | 建立錄製 session |
| POST | `/api/training/recording/:sessionId/step` | 上傳一個步驟（Extension 呼叫） |
| GET | `/api/training/recording/:sessionId` | 取得 session + 所有步驟 |
| POST | `/api/training/recording/:sessionId/complete` | 結束錄製 |
| POST | `/api/training/recording/:sessionId/analyze` | AI 分析所有步驟截圖 |
| POST | `/api/training/recording/:sessionId/generate` | 從錄製結果生成教材 |

### 跨系統管理

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/training/systems` | 系統列表 |
| POST | `/api/training/systems` | 新增系統 |
| PUT | `/api/training/systems/:id` | 編輯系統 |
| DELETE | `/api/training/systems/:id` | 刪除系統 |
| GET | `/api/training/systems/:id/scripts` | 教學腳本列表 |
| POST | `/api/training/systems/:id/scripts` | 新增腳本 |
| PUT | `/api/training/scripts/:id` | 編輯腳本 |
| DELETE | `/api/training/scripts/:id` | 刪除腳本 |
| POST | `/api/training/scripts/import` | 批次匯入腳本 |

### Phase 2E：截圖標註 + AI 模型選擇

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/training/recording/:sessionId/step` | 上傳步驟（Phase 2E 新增 `screenshot_raw_base64` + `annotations_json` 參數） |
| POST | `/api/training/recording/:sessionId/analyze-step/:stepId` | AI 分析（Phase 2E 新增 `model` 參數 + 標註整合 prompt） |
| GET | `/api/training/ai/models` | 取得可用 Gemini 模型列表（Phase 2E 新增） |

### Phase 2F：HTML5 匯出 + AI 模型設定 + 翻譯改進

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/training/courses/:id/export` | HTML5 單檔匯出（截圖 base64 內嵌 + 多語 + 互動 + 測驗） |
| GET | `/api/training/ai/settings` | 讀取 AI 模型設定（training_analyze_model / training_translate_model） |
| PUT | `/api/training/ai/settings` | 儲存 AI 模型設定（admin only） |
| POST | `/api/training/courses/:id/translate` | 翻譯（**改為 SSE 串流**，即時回報每張投影片進度） |

### Phase 3A：圖層分離 + 多語底圖

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/training/slides/:sid/lang-image` | 上傳語言底圖（multipart: lang, block_index, file） |
| DELETE | `/api/training/slides/:sid/lang-image` | 刪除語言底圖（body: lang, block_index） |
| GET | `/api/training/slides/:sid/lang-images` | 查詢所有語言底圖 override |
| POST | `/api/training/recording/:sessionId/step` | 新增 `lang` 參數（Phase 3A-2） |
| GET | `/api/training/lessons/:lid/slides?lang=` | 新增 `image_overrides` + `region_overrides` 套用 |
| PUT | `/api/training/recording/:sessionId/steps` | 批次更新步驟 step_number + lang |
| POST | `/api/training/slides/:sid/ai-analyze` | 單張投影片 AI 重新分析 |
| PUT | `/api/training/slides/:sid/region-overrides` | 儲存 per-language 互動位置覆蓋 |

---

## 11. Phase 2 操作指南

### 11.1 方式一：AI 一鍵辨識 Hotspot（最快速）

適用於已有截圖，想快速建立互動投影片的情境。

```
操作步驟：
1. 進入課程編輯器 → 章節管理 → 展開章節 → 新增投影片
2. 點擊投影片進入 SlideEditor
3. 新增一個 Hotspot Block
4. Ctrl+V 貼上截圖（或點擊上傳）
5. 截圖顯示後，點擊下方「AI 一鍵辨識」按鈕
6. 等待 3-5 秒，Gemini Vision 分析完成
7. 自動建立所有 UI 元素的 hotspot 區域
   └── 每個按鈕/輸入框/連結都會被標記
   └── AI 判斷的主要互動點會自動標為「正確」
   └── 每個區域自動生成回饋文字
8. 手動微調：拖拉移動區域位置、拖拉邊角調整大小
9. 修改正確/錯誤標記、調整回饋文字
10. 儲存

效率提升：手動標記 5-10 分鐘 → AI 辨識 30 秒 + 微調 1 分鐘
```

### 11.2 方式二：批次匯入截圖（多張截圖一次處理）

適用於已經準備好一系列操作截圖的情境。

```
操作步驟：
1. 進入課程編輯器 → 章節管理 → 展開章節
2. 點擊「批次匯入截圖 (AI 辨識)」按鈕
3. 在彈出面板中選擇多張截圖（可多選）
4. 確認「AI 自動辨識互動區域」選項已勾選
5. 點擊「開始匯入」
6. 系統逐張處理：上傳 → AI 分析 → 建立投影片
   └── 顯示每張截圖的處理進度
   └── 有互動區域的自動建立 hotspot 投影片
   └── 沒有互動區域的建立一般內容投影片
7. 處理完成後點擊「完成，返回編輯器」
8. 在章節中可以看到所有新建立的投影片
9. 點擊每張投影片進入微調

效率提升：手動一張張做 = N × 10 分鐘 → 批次匯入 = N × 10 秒 + 整體微調
```

### 11.3 方式三：AI 輔助錄製（完整流程）

適用於從零開始，邊操作系統邊建立教材的情境。

```
操作步驟：
1. 進入課程編輯器 → 點擊 header 的「AI 錄製」按鈕
2. 在錄製面板中：
   a. 選擇使用手冊章節（選填，提供 AI 上下文）
   b. 點擊「AI 生成大綱」→ 查看操作步驟清單
   c. 設定目標系統 URL
   d. 選擇錄製模式（手動截圖 / 自動）
3. 點擊「開始錄製」
   └── 系統開啟新瀏覽器視窗，載入目標 URL
4. 在新視窗中操作系統：
   手動模式：每完成一步操作，回到錄製面板點「手動截圖」
   自動模式：搭配 Chrome Extension，每次 click 自動截圖上傳
5. 錄製面板即時顯示已錄製的步驟清單
6. 完成所有操作後點擊「結束錄製」
7. 點擊「AI 分析全部」→ Gemini Vision 逐步分析截圖
   └── 自動辨識 UI 元素
   └── 自動生成操作說明
   └── 自動生成旁白文字
   └── 自動偵測敏感資訊
8. 點擊「生成教材」→ 自動建立所有投影片
9. 進入編輯器微調

效率提升：完全手動 = 8 小時 → AI 錄製 = 30 分鐘操作 + 30 分鐘微調
```

### 11.4 Chrome Extension 使用方式

```
安裝步驟：
1. 開啟 Chrome → chrome://extensions
2. 開啟「開發者模式」
3. 點擊「載入未封裝項目」
4. 選擇 chrome-extension/ 資料夾
5. Extension 圖示出現在瀏覽器工具列

使用步驟：
1. 點擊 Extension 圖示
2. 輸入 FOXLINK GPT Server URL（如 http://localhost:5173）
3. 輸入帳號密碼 → 點擊「登入連線」
4. 從 FOXLINK GPT 訓練平台開始錄製 → 取得 Session ID
5. 在 Extension popup 貼上 Session ID
6. 點擊「開始錄製」
7. 切換到目標系統頁面進行操作
   └── 每次 click 會自動截圖 + 上傳
   └── 頁面右上角顯示「🔴 錄製中」badge
   └── 可點擊 badge 的「📸 截圖」手動補截圖
8. 操作完成後回到 Extension → 點擊「停止」
9. 回到 FOXLINK GPT 訓練平台繼續後製

支援範圍：
├── ✅ FOXLINK GPT 本身（同源）
├── ✅ Oracle ERP（跨域，Extension 支援）
├── ✅ PLM / HR / 任何 Web 系統
└── ✅ 內部系統（只要瀏覽器能打開的都行）
```

### 11.5 Phase 2E：截圖標註操作方式

```
操作步驟：

1. 進入錄製模式（已連線 Chrome Extension）
2. 在目標系統操作到要截圖的畫面
3. 點擊頁面右上角 badge 的「📸 截圖」按鈕
4. 畫面凍結 → 頂部出現完整標註工具列

   標註工具列說明：
   ┌─────────────────────────────────────────────────────────────┐
   │ [① 編號] [◯ 圈] [▭ 框] [→ 箭頭] [T 文字] [✎ 畫筆] [▦ 馬賽克]   │
   │ 顏色: [●紅][●藍][●綠][●黃][●白]  粗細: [─][━][▬]              │
   │ [↩ 復原] [↪ 重做] [🗑 清除]                                    │
   │                       [⏭ 跳過標註] [✅ 確認截圖] [✗ 取消]       │
   └─────────────────────────────────────────────────────────────┘

5. 使用標註工具標記操作重點：
   a. 選「① 編號」→ 點擊帳號欄位 → 自動標記 ①
   b. 再點密碼欄位 → 自動標記 ②
   c. 選「→ 箭頭」→ 從旁邊拖向登入按鈕 → 顯示箭頭
   d. 選「T 文字」→ 點空白處 → 輸入「輸入工號後點登入」→ Enter
   e. 如有敏感資訊 → 選「▦ 馬賽克」→ 拖拉覆蓋密碼欄位

6. 標註過程中可隨時：
   ├── 切換顏色（點色塊）
   ├── 切換粗細（點粗細按鈕）
   ├── Ctrl+Z 復原上一步標註
   ├── Ctrl+Y 重做
   ├── 按 1-7 快速切換工具
   └── Esc 取消放棄截圖

7. 確認標註完成 → 點「✅ 確認截圖」
   ├── 系統自動生成原圖（乾淨無標註）
   ├── 系統自動生成標註圖（含所有標記）
   └── 標註資料以 JSON 格式分開存檔

8. 如不需要標註 → 直接點「⏭ 跳過標註」
   └── 等同舊版直接截圖上傳

標註與 AI 分析的協作：
  ├── AI 分析時優先使用原圖（避免標註干擾辨識）
  ├── 同時將標註座標帶入 prompt（告訴 AI 哪裡是重點）
  ├── AI 按 ①②③ 順序生成操作說明
  ├── 標註圈住的元素自動設為 is_primary
  └── 文字標註作為額外說明補充

生成投影片後標註的呈現：
  ├── 播放器中截圖上疊加 SVG 標註層
  ├── 步驟編號、圈框箭頭、文字全部可見
  ├── 學員可點「隱藏標註」挑戰自己找操作點
  └── 馬賽克區域保持遮蔽（保護敏感資訊）
```

### 11.6 Phase 2E：AI 模型選擇器

```
操作步驟：

1. 進入 AI 輔助錄製面板（CourseEditor → AI 錄製）
2. 底部工具列左側出現模型選擇下拉（🖥 圖示）
3. 預設「自動選擇」→ 系統使用 llm_models 表排序最前的 Gemini 模型
4. 可手動選擇特定模型：
   ├── Gemini 2.0 Flash（預設，速度快，適合大量截圖）
   ├── Gemini 2.0 Pro（精度高，適合複雜 UI）
   └── 其他管理員在後台設定的模型
5. 選擇後點「全部送 AI 處理」
   └── 所有截圖都用選擇的模型進行分析

適用情境：
  ├── 簡單系統（按鈕少）→ Flash 即可，速度快
  ├── 複雜 ERP 畫面（表格/巢狀選單多）→ Pro 更準確
  └── 大量截圖（>20 張）→ Flash 節省 API 成本
```

### 11.7 Phase 2F：HTML5 互動教材匯出

```
操作步驟：

1. 進入課程編輯器（已有投影片的課程）
2. 點擊 header 右側的「📥 匯出」按鈕
3. 彈出匯出選項面板：

   ┌─ 匯出 HTML5 互動教材 ──────────┐
   │                                  │
   │  包含語言：                       │
   │  ☑ 🇹🇼 繁體中文（必選）            │
   │  ☐ 🇺🇸 English                   │
   │  ☐ 🇻🇳 Tiếng Việt               │
   │                                  │
   │  匯出選項：                       │
   │  ☑ 包含測驗題                     │
   │  ☑ 包含音訊（增加檔案大小）        │
   │  ☑ 包含截圖標註                   │
   │                                  │
   │  [📥 匯出 HTML5]                 │
   │  取消                             │
   └──────────────────────────────────┘

4. 勾選需要的語言和選項
5. 點擊「匯出 HTML5」
6. 系統自動：
   ├── 載入所有投影片、翻譯、測驗
   ├── 截圖轉 base64 內嵌（不需 server）
   ├── 生成包含 CSS + JS 播放器的單一 .html 檔
   └── 自動觸發下載

7. 得到的 .html 檔案可以：
   ├── 雙擊直接開啟（不需 server/網路）
   ├── 放在 USB 分享給工廠
   ├── 上傳到內網靜態伺服器
   └── Email 寄給學員

HTML5 播放器功能：
  ├── 投影片瀏覽（鍵盤 ←→ / 按鈕）
  ├── Hotspot 區域標記（AI 辨識的 UI 元素）
  ├── SVG 標註渲染（步驟編號/圈/框/箭頭/文字/馬賽克）
  ├── 多語切換下拉（即時切換 zh-TW/en/vi）
  ├── 測驗 + 計分（單選 + 解析 + 通過/未通過）
  ├── 音訊播放（TTS 旁白）
  ├── 進度條 + 頁碼
  └── 響應式版面（手機/平板/桌面）

檔案大小估算：
  6 張截圖 × ~150KB = ~900KB
  播放器 JS/CSS = ~50KB
  投影片 JSON（3 語言）= ~30KB
  TTS 音訊（選配）= ~180KB
  ─────────────────────
  不含音訊 ≈ 1MB
  含音訊 ≈ 1.2MB
```

### 11.8 Phase 2F：AI 模型設定

```
操作步驟：

1. 進入課程編輯器 → 點「設定」頁籤
2. 看到「AI 模型設定」區塊：

   ┌─ AI 模型設定 ──────────────────┐
   │                                  │
   │  截圖辨識模型                     │
   │  用於 AI 分析截圖、辨識 UI 元素    │
   │  [▼ 自動選擇（系統預設）      ]    │
   │                                  │
   │  翻譯模型                         │
   │  用於翻譯教材到其他語言            │
   │  [▼ 自動選擇（系統預設）      ]    │
   │                                  │
   │  [💾 儲存設定]                    │
   │                                  │
   │  模型比較參考                     │
   │  ┌────────┬──────────┬────┐      │
   │  │ 模型   │ 速度     │精度│      │
   │  │ Flash  │ ~3秒/張  │一般│      │
   │  │ Pro    │ ~8秒/張  │ 高│      │
   │  └────────┴──────────┴────┘      │
   └──────────────────────────────────┘

3. 選擇適合的模型 → 儲存
4. 設定存到 system_settings 表（全系統生效）
5. 模型優先級：
   ├── RecordingPanel 手動選擇（單次覆蓋）
   ├── system_settings 設定（全系統預設）
   ├── llm_models 表排序第一（DB 預設）
   └── gemini-2.0-flash（硬編碼 fallback）
```

### 11.9 Phase 2F：翻譯進度即時顯示

```
改善前：
  ├── 點「AI 翻譯」→ 顯示「翻譯中...」
  ├── 等 30 秒～2 分鐘（無進度資訊）
  ├── 經常 timeout 失敗
  └── 投影片進度永遠顯示 0/7

改善後：
  ├── 點「AI 翻譯」→ SSE 串流連線
  ├── 即時顯示：⏳ 翻譯投影片 3/7...
  ├── 進度條同步更新
  ├── 每張投影片翻譯失敗不中斷（繼續下一張）
  └── 完成後自動刷新狀態

SSE 事件類型：
  ├── progress: { current, total, step, slides_done, slides_total }
  ├── done: { ok, translated: { lessons, slides, questions } }
  └── error: { error }
```

---

## 12. Demo 劇本

### 劇本 1：FOXLINK GPT 登入教學（連續截圖 + AI 處理，5 分鐘完成）

```
目標：製作一個「如何登入 FOXLINK GPT」的互動教材

前置：已建立課程「FOXLINK GPT 操作教學」，有一個章節「登入與登出」

Step 1: 開啟錄製面板
  ├── 進入課程編輯器 → 點擊 header「AI 錄製」
  ├── 來源章節選「登入與登出」→ 點「AI 生成大綱」
  ├── 目標 URL: http://localhost:5173/login
  └── 點「開啟目標視窗」→ 瀏覽器開新分頁顯示登入頁

Step 2: 連續截圖（不需存檔，全部暫存在面板上）
  ├── 看到登入頁面 → Ctrl+V 截圖 (或按面板「截圖」按鈕)
  │   → 面板上立即出現 #1 縮圖
  ├── 在登入頁輸入帳號 → 再 Ctrl+V 截圖
  │   → 面板出現 #2 縮圖
  ├── 輸入密碼 → 再截圖 → #3
  ├── 點擊登入 → 截圖 → #4
  └── 看到首頁 → 最後一張截圖 → #5
  ※ 全程不離開操作畫面，截圖暫存在瀏覽器記憶體

Step 3: 整理截圖（在面板上操作）
  ├── 面板上看到 5 張縮圖，可以：
  │   ├── 點擊放大預覽確認內容
  │   ├── 拖拉調整順序
  │   ├── 刪除多餘的截圖
  │   ├── 標記重點步驟 ⭐（會建立 hotspot 互動）
  │   └── 加備註（如「請點擊登入按鈕」→ AI 參考）
  ├── 將 #1 標為重點（登入頁面介紹 hotspot）
  ├── 將 #4 標為重點（點擊登入按鈕 hotspot）
  └── #5 不標重點（純說明「登入成功」）

Step 4: 一鍵 AI 處理
  ├── 點擊「全部送 AI 處理」
  ├── 系統自動：
  │   ├── 上傳所有截圖到 server
  │   ├── Gemini Vision 逐張分析 UI 元素
  │   ├── 自動建立 hotspot regions（重點步驟）
  │   ├── 自動生成每張操作說明和旁白文字
  │   └── 自動建立 5 張投影片
  └── 進度條顯示處理進度，約 30 秒完成

Step 5: 微調 + 發佈
  ├── 自動跳回課程編輯器，看到 5 張新投影片
  ├── 點進每張微調 hotspot 位置和說明文字
  └── 發佈

全程操作時間：3-5 分鐘（含截圖+整理+AI處理+微調）
手動製作相同內容：40 分鐘
加速比：8-13x
```

### 劇本 2：FOXLINK GPT 對話功能教學（Chrome Extension 自動截圖）

```
目標：製作「如何使用 AI 對話功能」的互動教材

Step 1: 準備
  ├── 已安裝 Chrome Extension 並登入
  ├── 進入課程編輯器 → 點「AI 錄製」
  ├── 來源章節選「AI 對話」→ 點「AI 生成大綱」
  │   → AI 分析出 6 個步驟
  ├── 目標 URL: http://localhost:5173/chat
  └── 點「開啟目標視窗」

Step 2: 操作系統 — 連續自動截圖
  ├── 切到目標視窗操作 FOXLINK GPT
  ├── Chrome Extension 自動捕捉每次 click：
  │   ├── click 對話頁面 → 自動截圖 #1 → 暫存面板
  │   ├── click 模型選擇 → 自動截圖 #2 → 暫存面板
  │   ├── 輸入問題 → 自動截圖 #3 → 暫存面板
  │   ├── 等 AI 回答完 → 手動按 F2 截圖 #4
  │   ├── click 上傳按鈕 → 自動截圖 #5
  │   └── click 語音按鈕 → 自動截圖 #6
  ├── 全程不需要切換視窗！
  │   Extension 自動將截圖送到錄製面板暫存
  └── 操作完成，切回錄製面板

Step 3: 整理 + AI 一鍵處理
  ├── 面板上已有 6 張縮圖
  ├── 快速整理：
  │   ├── 刪除多餘的截圖（如重複 click 的）
  │   ├── 標記 #2、#3、#5 為重點步驟⭐（需要 hotspot 互動）
  │   └── 在 #4 加備註「AI 正在回答，等待完成」
  ├── 點「全部送 AI 處理」
  └── 等待 20 秒完成

Step 4: 微調 + 發佈
  ├── 6 張投影片自動建立完成
  ├── 快速微調（大部分 AI 已處理好）
  └── 發佈

全程操作時間：10 分鐘（操作 3 分鐘 + 整理 2 分鐘 + AI 30 秒 + 微調 5 分鐘）
手動製作相同內容：2 小時
加速比：12x
```

### 劇本 3：Oracle ERP 採購單教學（Chrome Extension 跨域錄製）

```
目標：製作「Oracle ERP 建立採購單」的互動教材

前置：
  ├── 已安裝 Chrome Extension
  ├── 已在 FOXLINK GPT 登錄 Oracle ERP 系統
  ├── 已匯入教學腳本「建立採購單（10 步驟）」

Step 1: 準備
  ├── Extension popup → 登入 FOXLINK GPT
  ├── 訓練平台 → 建立課程「Oracle ERP 採購操作」
  ├── 新增章節「建立採購單」
  ├── 點「AI 錄製」→ 取得 Session ID
  └── Extension popup → 貼上 Session ID → 開始錄製

Step 2: 操作 Oracle ERP
  ├── 開啟 Oracle ERP 頁面（https://erp.foxlink.com）
  ├── 操作系統：
  │   ├── 登入 ERP
  │   ├── 點擊「採購」選單 → 自動截圖 + 上傳
  │   ├── 點擊「採購單」→ 自動截圖
  │   ├── 點擊「新增」→ 自動截圖
  │   ├── 選擇供應商 → 自動截圖
  │   ├── 填寫品項 → 自動截圖
  │   ├── 點擊「儲存」→ 自動截圖
  │   └── ...每次 click 都自動截圖
  └── Extension → 停止錄製

Step 3: AI 後製
  ├── 回到 FOXLINK GPT 訓練平台
  ├── 錄製面板顯示已錄製的步驟
  ├── 點「AI 分析全部」
  ├── 點「生成教材」
  └── 10 張互動投影片自動建立

Step 4: 微調 + 翻譯
  ├── 微調 hotspot 區域和說明文字
  ├── 點「翻譯」→ 翻成 English + Vietnamese
  └── 發佈

預估時間：20 分鐘（含操作 ERP + 微調）
手動製作相同內容：4 小時
```

### 劇本 4：批次建立多系統教材（管理者視角）

```
目標：為公司 5 個主要系統各建立基礎操作教材

Step 1: 登錄系統
  ├── 管理介面 → 系統管理 → 新增系統
  │   ├── FOXLINK GPT (http://foxlink-gpt.com)
  │   ├── Oracle ERP (https://erp.foxlink.com)
  │   ├── PLM 系統 (https://plm.foxlink.com)
  │   ├── HR 系統 (https://hr.foxlink.com)
  │   └── 品質系統 (https://qms.foxlink.com)

Step 2: 匯入教學腳本
  ├── 每個系統準備教學腳本 JSON/Excel
  ├── 批次匯入：
  │   ├── ERP: 採購/庫存/財務 = 15 個腳本
  │   ├── PLM: 產品/BOM/ECN = 8 個腳本
  │   ├── HR: 出勤/請假/績效 = 6 個腳本
  │   └── QMS: 品質稽核/CAPA = 4 個腳本

Step 3: 分派錄製
  ├── 採購教材 → 指派給採購部 SME（develop 權限）
  ├── PLM 教材 → 指派給研發部 SME
  ├── HR 教材 → 指派給人資部 SME
  └── 各 SME 使用 Chrome Extension 錄製自己負責的模組

Step 4: 審核 + 發佈
  ├── 訓練管理者審核所有教材
  ├── 建立學習路徑：新人到職 → ERP 基礎 → 部門專業
  ├── 建立培訓專案：2026 Q2 全員培訓
  │   ├── 對象：全體使用者
  │   ├── 期間：04/01 - 04/30
  │   └── 一鍵啟動 → 自動指派
  └── 系統自動發送通知 + Email

ROI:
  5 個系統 × 平均 8 個模組 × 每模組 5 張投影片 = 200 張投影片
  手動製作: 200 × 10 分鐘 = 33 小時
  AI 輔助: 200 × 1.5 分鐘 = 5 小時
  節省: 28 小時 (85%)
```

### 劇本 5：教材更新維護（系統升版後）

```
情境：FOXLINK GPT 更新了介面，需要更新教材

Step 1: 發現變更
  ├── 系統升版後，管理者收到通知
  └── 進入教材編輯器，逐章檢查

Step 2: 快速重錄
  ├── 對有變更的章節：
  │   ├── 點「AI 錄製」→ 重新操作變更的步驟
  │   ├── AI 自動截圖 + 辨識
  │   └── 只重做有變更的投影片
  ├── 未變更的步驟保留不動

Step 3: 比對確認
  ├── 前後版本截圖比較
  ├── 確認 hotspot 區域仍然正確
  └── 更新說明文字

Step 4: 重新發佈
  ├── 發佈更新版教材
  ├── 系統通知已完成學員「教材已更新」
  └── 可選：要求重新學習 or 只看更新部分

預估時間：15 分鐘（只更新 3 張投影片）
完全重做: 2 小時
```

### 劇本 6：截圖標註完整示範（Phase 2E，3 分鐘完成）

```
目標：展示截圖標註系統的完整操作流程
前置：Chrome Extension 已連線，已開啟錄製 session

Step 1: 準備標註
  ├── 在目標系統操作到登入頁面
  ├── 點擊 badge「📸 截圖」按鈕
  └── 畫面凍結，頂部出現標註工具列

Step 2: 標記操作順序
  ├── 工具列選「① 編號」（預設已選）
  ├── 點擊帳號輸入框 → 自動出現紅色 ① 圓圈
  ├── 點擊密碼輸入框 → 自動出現紅色 ② 圓圈
  └── 點擊登入按鈕 → 自動出現紅色 ③ 圓圈

Step 3: 加入引導標註
  ├── 切換工具「→ 箭頭」（或按鍵盤 4）
  ├── 從空白處拖向登入按鈕 → 出現箭頭
  ├── 切換工具「T 文字」（或按鍵盤 5）
  ├── 點擊旁邊空白處 → 輸入「輸入工號後點登入」→ Enter
  ├── 切換顏色為藍色 → 更顯眼
  └── 不小心多畫了？Ctrl+Z 復原

Step 4: 保護敏感資訊
  ├── 切換工具「▦ 馬賽克」（或按鍵盤 7）
  ├── 拖拉覆蓋密碼欄位已輸入的內容
  └── 密碼區域變成馬賽克格子

Step 5: 確認上傳
  ├── 檢查標註結果（①②③ + 箭頭 + 文字 + 馬賽克）
  ├── 點「✅ 確認截圖」
  ├── badge 顯示截圖數量 +1
  └── 系統自動上傳：
      ├── 原圖（無標註，供 AI 辨識用）
      ├── 標註圖（含所有標記，預覽用）
      └── 標註 JSON（座標+類型+文字，結構化資料）

Step 6: AI 處理（在錄製面板操作）
  ├── 停止錄製 → 拉取截圖
  ├── 底部選擇 AI 模型（如 Gemini 2.0 Flash）
  ├── 點「全部送 AI 處理」
  ├── AI 分析時帶入標註資訊：
  │   ├── 「步驟①: 編號在座標 (35%, 42%)，標註帳號欄位」
  │   ├── 「步驟②: 編號在座標 (35%, 52%)，標註密碼欄位」
  │   └── 「步驟③: 編號在座標 (35%, 62%)，標註登入按鈕」
  └── AI 按①②③順序生成精準操作說明

Step 7: 查看生成結果
  ├── 投影片上方：操作說明文字
  │   └── 「步驟1：在帳號欄位輸入您的工號。
  │        步驟2：在密碼欄位輸入密碼。
  │        步驟3：點擊登入按鈕完成登入。」
  ├── 投影片中央：截圖 + SVG 標註層
  │   └── ①②③ 圓圈 + 箭頭 + 文字 + 馬賽克 全部可見
  ├── 學員可點「隱藏標註」挑戰自己操作
  └── 馬賽克永遠遮蔽（保護密碼）

效率提升：
  無標註：AI 辨識準確率 ~70%，常抓錯主要操作點
  有標註：AI 辨識準確率 ~95%，①②③ 順序確保說明正確
  額外時間：每張截圖多花 15-30 秒標註，換來大幅減少後續微調
```

### 劇本 7：AI 模型選擇比較（Phase 2E）

```
目標：展示不同 AI 模型對截圖分析的效果差異
前置：已錄製 10 張 ERP 系統操作截圖

情境 A: 使用 Gemini Flash（快速模式）
  ├── 底部模型選擇 → 選「Gemini 2.0 Flash」
  ├── 點「全部送 AI 處理」
  ├── 處理速度：10 張 × ~3 秒 = 30 秒
  ├── 辨識結果：
  │   ├── 簡單頁面（登入/首頁）→ 準確
  │   ├── 複雜表格頁面 → 可能漏掉小按鈕
  │   └── 需要微調：~3 張
  └── 總時間：30 秒 + 5 分鐘微調 ≈ 6 分鐘

情境 B: 使用 Gemini Pro（精準模式）
  ├── 底部模型選擇 → 選「Gemini 2.0 Pro」
  ├── 點「全部送 AI 處理」
  ├── 處理速度：10 張 × ~8 秒 = 80 秒
  ├── 辨識結果：
  │   ├── 所有頁面辨識率更高
  │   ├── 複雜表格也能精確標記每個按鈕
  │   └── 需要微調：~1 張
  └── 總時間：80 秒 + 2 分鐘微調 ≈ 3.5 分鐘

建議策略：
  ├── 大量簡單截圖 → Flash（批次效率高）
  ├── 少量複雜截圖 → Pro（減少微調時間）
  └── 有標註的截圖 → Flash 就夠（標註已提供足夠上下文）
```

### 劇本 8：HTML5 離線教材匯出（Phase 2F，2 分鐘完成）

```
目標：將「登入與登出」課程匯出為離線 HTML 檔案，發給工廠現場使用
前置：課程已發佈，7 張投影片，已翻譯英文和越南文

Step 1: 開啟匯出面板
  ├── 進入課程編輯器
  ├── 點擊 header 的「📥 匯出」按鈕
  └── 彈出匯出選項面板

Step 2: 設定匯出選項
  ├── 語言：勾選 ☑ 繁體中文 ☑ English ☑ Tiếng Việt
  ├── ☑ 包含測驗題（讓學員自我檢測）
  ├── ☐ 不含音訊（減少檔案大小，工廠環境噪音大）
  └── ☑ 包含截圖標註（步驟編號、箭頭指引）

Step 3: 執行匯出
  ├── 點「匯出 HTML5」
  ├── 等待 3-5 秒（系統讀取截圖 → base64 編碼 → 組裝 HTML）
  └── 瀏覽器自動下載 course_1_1712025600000.html

Step 4: 驗證匯出結果
  ├── 雙擊 .html 檔案 → 瀏覽器開啟
  ├── 看到完整的教材播放器：
  │   ┌─ FOXLINK GPT 登入教學 ──── [繁體中文 ▼] ──┐
  │   │                                             │
  │   │  [截圖 + 標註 SVG]  [操作說明]              │
  │   │  ① Language btn     步驟1: 點擊...          │
  │   │  ② 帳號欄位         步驟2: 輸入...          │
  │   │                     步驟3: ...               │
  │   │                                             │
  │   │ [◀ 上一頁] ████████░░ 1/7 [下一頁 ▶]       │
  │   └─────────────────────────────────────────────┘
  │
  ├── 切換語言下拉 → English → 內容全部切換
  ├── 鍵盤 → 翻到最後一頁 → 進入測驗
  ├── 作答 → 提交 → 顯示分數 ✅ 通過
  └── 確認標註（①②③ 圓圈、箭頭、馬賽克）正常顯示

Step 5: 部署到工廠
  ├── 方案 A: 複製到 USB → 插到工廠電腦 → 雙擊開啟
  ├── 方案 B: 上傳到內網 http://training.foxlink.local/
  ├── 方案 C: Email 寄給各廠區訓練負責人
  └── 不需安裝任何軟體，任何瀏覽器都能開

結果：
  ├── 檔案大小 ≈ 1.1MB（7 張截圖 + 3 語言 + 測驗，不含音訊）
  ├── 完全離線運行（不需 server / 網路）
  ├── 越南廠學員可切換越南文
  └── 製作時間：2 分鐘（點幾個勾就好）
```

### 劇本 9：翻譯 + 匯出完整流程（Phase 2F，10 分鐘完成）

```
目標：將剛錄製完成的 ERP 採購單教材翻譯成英文越南文，並匯出給海外廠

Step 1: AI 模型設定
  ├── 課程編輯器 → 設定 tab
  ├── 截圖辨識模型 → 選「Gemini 2.0 Flash」（已完成辨識，不影響）
  └── 翻譯模型 → 選「Gemini 2.0 Pro」（翻譯品質較高）

Step 2: 翻譯英文
  ├── 翻譯 tab → English → 點「AI 翻譯」
  ├── 即時進度顯示：
  │   ├── ⏳ 翻譯課程標題...
  │   ├── ⏳ 翻譯章節「採購單建立」...
  │   ├── ⏳ 翻譯投影片 3/10...
  │   └── ⏳ 翻譯題目 2/5...
  ├── 進度條即時更新 ████████░░ 8/16
  └── 完成！翻譯 10 張投影片 + 5 題測驗 ≈ 2 分鐘

Step 3: 翻譯越南文
  ├── Tiếng Việt → 點「AI 翻譯」
  └── 同樣流程 ≈ 2 分鐘

Step 4: 匯出多語 HTML
  ├── 匯出 → 勾選 ☑ 繁中 ☑ English ☑ Tiếng Việt
  ├── ☑ 含測驗 ☑ 含標註
  └── 下載 ≈ 2MB 的 .html 檔

Step 5: 發送
  ├── Email 寄給越南廠/印度廠訓練窗口
  └── 各廠用當地語言閱讀同一份教材

總時間：~10 分鐘（翻譯 4 分鐘 + 匯出 1 分鐘 + 確認 5 分鐘）
傳統做法：翻譯 + 排版 + 校稿 = 2-3 個工作天
```

---

## 13. 後續開發（Phase 3B+）

以下功能已在設計文件中規劃，尚未實作：

| Phase | 功能 | 設計文件 | 說明 |
|-------|------|---------|------|
| **3B** | **即時語音導覽** | **已規劃** | **Gemini Flash 即時語音 + 學習/測驗模式 + 編輯者提示詞 + 語音風格** |
| 3C | 影片 AI 拆幀 | §16C | ffmpeg + Gemini 混合拆幀→自動生成投影片 |
| 3C | 桌面截圖代理 | §16B | Electron F9 全局快捷鍵，截 Java Forms 等非瀏覽器系統 |
| 3C | 進階標註 | §16A.12 | 畫筆平滑化 Bezier、標註模板、語音搭配標註同步播放 |
| 3 | 定期複訓 | — | 自動建立下一期培訓專案 |
| 3 | iframe 導引模擬 | — | 嵌入真實系統 + 高亮 + 操作監聽 |
| 3 | 教材分析儀表板 | — | 停留時間、中斷點、題目難度分析 |
| 3 | 教材版本控制 | — | v1→v2 + 已完成學員升級提示 |
| 3 | 多人協作錄製 | — | 分工 + 統一審核 |
| 3 | 教材模板庫 | — | 跨課程複用模板 |
| 3 | 差異更新 | — | 系統升版 → AI 比對 → 只重做變更步驟 |
| 3 | 操作回放驗證 | — | Playwright 重播驗證教材有效性 |
| 3 | 學習者熱力圖 | — | 點擊紀錄分析 → 找出易犯錯區域 |
| 3 | 證書 PDF | — | pdfkit 生成完課證書 |
| 4 | Playwright 全自動 | — | AI 根據腳本自動操作，人只需審核 |
| 4 | Extension 離線模式 | — | IndexedDB 快取 → 批次上傳 |
| 4 | 討論區 / 徽章 | — | 社群功能 |
