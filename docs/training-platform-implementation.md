# FOXLINK GPT 教育訓練平台 — 實作完成報告

> 日期：2026-04-02（Phase 1-2F）、2026-04-03（Phase 3A）、2026-04-04（Phase 3B + i18n）、2026-04-05（Phase 3C–3D 全部）、2026-04-06~07（Phase 4+5 訓練教室+計分+報表）、2026-04-08（Phase 3B-8 多語底圖編輯器增強 + Bug Fix + 預覽語言 + 翻譯 regions）
> 狀態：Phase 1–3E + Phase 4A–4F + Phase 5A–5H + 追加功能（demo 展示/計分/章節選擇/TTS 修正）+ Phase 3B-8 + 追加修復全部實作完成
> 設計文件：[training-platform-design.md](training-platform-design.md)、[training-classroom-design.md](training-classroom-design.md)、[training-scoring-design.md](training-scoring-design.md)

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
| PUT | `/api/training/recording/:sessionId/steps` | 批次更新步驟（step_number / lang / annotations_json） |

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
7. （選項 A）點擊「💾 儲存草稿」→ 截圖 + 標註存到 server
   └── 下次開啟面板 → 自動偵測草稿 → 點「載入草稿」接續編輯
   （選項 B）直接進入步驟 8
8. 點擊「AI 分析全部」→ Gemini Vision 逐步分析截圖
   └── 自動辨識 UI 元素
   └── 自動生成操作說明
   └── 自動生成旁白文字
   └── 自動偵測敏感資訊
9. 點擊「生成教材」→ 自動建立所有投影片
10. 進入編輯器微調

效率提升：完全手動 = 8 小時 → AI 錄製 = 30 分鐘操作 + 30 分鐘微調
```

#### 草稿保存實作（2026-04-09）

| 項目 | 說明 |
|------|------|
| 儲存草稿 | `saveDraft()` — 建立/更新 recording session，Ctrl+V 的圖片上傳 server，已有步驟更新 annotations |
| 載入草稿 | 開啟面板時查 sessionStorage → 偵測到 session → banner 提示載入 |
| API 變更 | `PUT /recording/:sid/steps` 擴充支援 `annotations_json` 欄位 |
| 防護 | 關閉面板 confirm + `beforeunload` 事件攔截 |
| 檔案 | `RecordingPanel.tsx` (前端), `training.js` (API) |

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

### Phase 3B — 互動模式引擎 + 語音導引 + Region 管理改善

> 日期：2026-04-04

#### Phase 3B-1 — 互動區域管理改善

| 項目 | 狀態 | 說明 |
|------|------|------|
| 選取/繪製模式分離 | ✅ 完成 | `editorMode: 'select' \| 'draw'`，繪製完自動切回選取 |
| 繪製預覽 | ✅ 完成 | 拖拉時顯示虛線框預覽 |
| + 新增區域按鈕 | ✅ 完成 | 在圖片中央快速新增預設框 |
| Region label 欄位 | ✅ 完成 | 取代純 id 顯示，支援中文標籤 |
| Region 拖拉排序 | ✅ 完成 | GripVertical 握把 + HTML5 drag-and-drop |
| 抽換底圖 | ✅ 完成 | 🔄 按鈕直接替換 image，保留 regions/annotations/feedback |
| 複製投影片 | ✅ 完成 | `POST /slides/:sid/duplicate`，複製全部內容插入原始後面 |
| 多語獨立 Region | ✅ 完成 | `slide_translations.regions_json` CLOB，各語言完全獨立 region 集合 |
| 語言 Region 同步工具 | ✅ 完成 | 建立獨立區域 / 從其他語言複製 / 回到繼承 |
| Annotation 修復 | ✅ 完成 | 不再清空 annotations，editor/player 一律從 block.annotations 讀取 |

#### Phase 3B-2 — 互動模式引擎

| 項目 | 狀態 | 說明 |
|------|------|------|
| `interaction_mode` 欄位 | ✅ 完成 | `'guided' \| 'explore'`，Editor 可切換 |
| 導引模式 Player | ✅ 完成 | currentStep 逐步帶，只 highlight 當前目標，其他暗淡 |
| 探索模式 Player | ✅ 完成 | 所有區域可點擊，追蹤已探索進度，全部探索完才完成 |
| 步驟進度條 | ✅ 完成 | 底部 Step 1/4 → 2/4 視覺化圓點進度 |
| Hover tooltip | ✅ 完成 | 懸停區域顯示名稱浮動提示 |
| 步驟間動畫 | ✅ 完成 | 綠色 flash + smooth transition |
| 復習/重做 | ✅ 完成 | 完成後「再做一次」按鈕重置 |
| 自動下一張 | ✅ 完成 | 完成後「下一頁 →」按鈕，最後一頁顯示「🎉 課程完成」 |
| 測驗模式 | ✅ 完成 | Player 層級 `📖 學習` / `📝 測驗` 切換，區域/標籤/tooltip 全隱藏 |
| 測驗漸進式提示 | ✅ 完成 | 1-2 次不提示 → 3 次給文字 → N 次 highlight 位置 |
| 課程詳情頁測驗入口 | ✅ 完成 | 「📖 繼續學習」旁新增「📝 練習測驗」按鈕 |

#### Phase 3B-3 — 語音導覽系統

| 項目 | 狀態 | 說明 |
|------|------|------|
| Region narration/test_hint/explore_desc 欄位 | ✅ 完成 | 每個 region 三種模式各自獨立語音文稿 |
| `editor_context` 補充說明 | ✅ 完成 | 編輯者填寫系統背景，AI 自然融入腳本 |
| AI 生成全套導覽腳本 | ✅ 完成 | `POST /slides/:sid/generate-narration` Gemini 一次產出三模式前導 + 每步導覽/測驗/探索文稿 |
| 自動 TTS 全套生成 | ✅ 完成 | AI 生成文稿後自動逐一 TTS，按鈕文字動態顯示「AI 腳本生成中→TTS 語音生成中」 |
| 三模式前導語音 | ✅ 完成 | `slide_narration` / `slide_narration_test` / `slide_narration_explore` 各自有音檔 |
| 前導語音 UI | ✅ 完成 | 導引/測驗/探索各段可編輯 + 🔊 獨立 TTS + audio player |
| 每步三模式語音 | ✅ 完成 | 學習導引 + 測驗提示 + 探索說明，各自 TTS + audio player |
| Player 語音時序控制 | ✅ 完成 | 進入投影片→播前導→播完啟動互動→每步播 region 語音 |
| Hotspot 投影片跳過 slide audio | ✅ 完成 | CoursePlayer 偵測 hotspot block，交由 HotspotBlock 管理語音 |
| 靜音按鈕生效 | ✅ 完成 | 切靜音立即 pause + 跳過前導，點對時停止當前語音 |
| 測驗模式動態鼓勵 | ✅ 完成 | 隨機鼓勵/提示語句 + 漸進式播放 test_hint 語音 |

#### Phase 3B-4 — 課程語音設定 + 外語語音

| 項目 | 狀態 | 說明 |
|------|------|------|
| 課程 TTS 設定 | ✅ 完成 | `COURSES.SETTINGS_JSON` CLOB，聲音性別/語速/音調 |
| 設定 tab UI | ✅ 完成 | 👩女聲/👨男聲、慢/正常/快、音調滑桿 |
| `resolveTtsVoice()` helper | ✅ 完成 | 按語言+性別自動選 voice（zh-TW/en/vi × 男/女） |
| TTS API 帶入課程設定 | ✅ 完成 | `/slides/:sid/tts` + `/slides/:sid/region-tts` 自動讀課程設定 |
| 翻譯時自動 TTS | ✅ 完成 | 翻譯流程完成後自動為 hotspot 投影片生成外語 TTS |
| 獨立外語語音按鈕 | ✅ 完成 | 翻譯 tab「🔊 生成 English 語音」獨立觸發，避免 timeout |
| `generate-narration` 外語支援 | ✅ 完成 | `lang` 參數讀獨立 regions + 外語截圖，用外語生成腳本 |
| LanguageImagePanel 語音編輯 | ✅ 完成 | 獨立 regions 下方「✨ AI 生成語音」一鍵外語腳本+TTS |
| 翻譯 tab 預覽按鈕 | ✅ 完成 | 「📖 預覽 English 學習」「📝 預覽 English 測驗」 |
| CoursePlayer `?lang=` 參數 | ✅ 完成 | URL 參數強制載入指定語言投影片 |
| Slide fetch `_intro` 合併 | ✅ 完成 | `regions_json._intro` 覆蓋 hotspot block 前導語音欄位 |
| `generate-lang-tts` API | ✅ 完成 | `POST /courses/:id/generate-lang-tts` 批次為翻譯版生成 TTS |
| SlideEditor AudioPanel 整合 | ✅ 完成 | 底部旁白區換用 AudioPanel（TTS+麥克風+STT+上傳） |

#### Phase 3B-5 — 其他改善

| 項目 | 狀態 | 說明 |
|------|------|------|
| 抽換底圖 | ✅ 完成 | 🔄 按鈕替換 image，保留 regions/annotations |
| 複製投影片 | ✅ 完成 | `POST /slides/:sid/duplicate`，CourseEditor 📋 按鈕 |
| 自動選取第一個 Block | ✅ 完成 | loadSlide 後 `setActiveBlockIdx(0)` |
| 展開章節自動開第一張 | ✅ 完成 | `loadSlides(lessonId, true)` |
| 編輯器返回到課程詳情 | ✅ 完成 | 返回鍵導向 `/training/course/:id` |
| 課程詳情頁測驗入口 | ✅ 完成 | 「📖 繼續學習」+「📝 練習測驗」雙按鈕 |
| 語言偵測 fallback 改中文 | ✅ 完成 | `detectLang()` 預設 zh-TW，登入時自動存 `preferred_language` |
| `decryptKey` import 修正 | ✅ 完成 | 改用 `llmKeyService` 而非 `dbCrypto` |
| Annotation 修復 | ✅ 完成 | 不再清空 annotations，editor/player 一律顯示 |

---

### Phase 3B-6 — i18n 教育訓練模組多語化 ✅

| 項目 | 狀態 | 說明 |
|------|------|------|
| 翻譯 key 建立 | ✅ 完成 | `training` namespace 100+ 個 key（zh-TW/en/vi） |
| Player 端 i18n | ✅ 完成 | HotspotBlock(29) + CoursePlayer(14) + CourseDetail(12) + SlideRenderer(5) |
| 互動 Block i18n | ✅ 完成 | DragDrop(5) + Branch(1) + QuizInline(6) |
| 管理端 i18n | ✅ 完成 | CourseList(18) + CategoryManager(8) |

### Phase 3B-7 — 編輯器 UX 改善 ✅

| 項目 | 狀態 | 說明 |
|------|------|------|
| AudioPanel 旁白框加大 | ✅ 完成 | rows 3→6 + 可拖拉 resize |
| SlideEditor 投影片切換 | ✅ 完成 | header ◀ 1/5 ▶ 導航，不用跳出 |
| 投影片名稱自動顯示 | ✅ 完成 | 優先顯示 instruction 內容摘要 |
| 外語 regions 拖拉修復 | ✅ 完成 | 繼承模式拖拉自動升級為獨立 regions |
| Modal region 定位修復 | ✅ 完成 | 兩層 div 結構，百分比座標精確對齊 Player |

---

## 13. Phase 3C — 評分紀錄系統 + 課程上架（✅ 完成）

> 狀態：2026-04-05 實作完成

### 3C-1：互動操作紀錄 + Server 端持久化

**目的**：記錄學員在 Hotspot / DragDrop / QuizInline 互動中的操作，存入 DB 供評分和報表使用。

**DB Schema**：`interaction_results`（`server/database-oracle.js` 自動建立）

```sql
CREATE TABLE interaction_results (
  id                 NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            NUMBER NOT NULL,
  slide_id           NUMBER NOT NULL,
  course_id          NUMBER NOT NULL,
  block_index        NUMBER DEFAULT 0,       -- 同一 slide 內第幾個互動 block
  block_type         VARCHAR2(30),            -- hotspot | dragdrop | quiz_inline
  player_mode        VARCHAR2(10),            -- learn | test
  action_log         CLOB,                    -- JSON array of click records
  total_time_seconds NUMBER,
  steps_completed    NUMBER,
  total_steps        NUMBER,
  wrong_clicks       NUMBER,
  score              NUMBER,                  -- server 端計算
  max_score          NUMBER,
  score_breakdown    CLOB,                    -- JSON: per-dimension scores
  created_at         TIMESTAMP DEFAULT SYSTIMESTAMP
)
```

**前端 action_log 收集**（以 HotspotBlock 為例）：

```js
// 每次 click 推入 actionLogRef.current
{
  timestamp: Date.now(),
  step: currentStep,             // guided 模式 step index / explore 模式 exploredIds.size
  region_id: hit?.id || null,    // 命中的 region（miss 為 null）
  correct: true,                 // 是否正確 region
  click_coords: { x: 45.2, y: 32.1 },  // 百分比座標
  attempt_number: stepAttempts + 1
}
```

**元件改動**：
- `HotspotBlock` — `actionLogRef` / `startTimeRef` / `wrongClicksRef`，完成時呼叫 `onInteractionComplete(result)`
- `DragDropBlock` — checkAnswer 後呼叫 `onInteractionComplete`，回傳 user_answer + correct_answer
- `QuizInlineBlock` — submit 後呼叫 `onInteractionComplete`，回傳 question_type + answers

**資料流**：
```
互動 Block  ──onInteractionComplete──→  SlideRenderer（附 slideId + blockIndex）
  ──onInteractionComplete──→  CoursePlayer  ──POST /slides/:sid/interaction-result──→  Server
  Server: interactionScorer 計算分數 → INSERT interaction_results → Response { score, max_score }
  CoursePlayer: 收到後顯示分數 toast（右上角 4 秒）
```

**API**：
```
POST /training/slides/:sid/interaction-result
Body: {
  block_index, block_type, player_mode,
  action_log,              // Hotspot 專用
  total_time_seconds, steps_completed, total_steps, wrong_clicks,
  interaction_mode,        // Hotspot: guided | explore
  user_answer,             // DragDrop / QuizInline
  correct_answer,          // DragDrop / QuizInline
  mode,                    // DragDrop: ordering | matching
  question_type,           // QuizInline: single | multi | fill_blank
  points                   // QuizInline: max points
}
Response: { ok, score, max_score, score_breakdown }
```

### 3C-2：Rubric 評分引擎

**檔案**：`server/services/interactionScorer.js`
**匯出**：`{ scoreHotspot, scoreDragDrop, scoreQuizInline }`

#### Hotspot — Explore 模式（100 分制）

| 維度 | 權重 | 計算方式 |
|------|------|---------|
| 正確性 | 70% | `(steps_completed / total_steps) × 70` |
| 嘗試效率 | 30% | 0 錯 = 30，1-2 錯 = 20，3+ 錯 = 10 |

#### Hotspot — Guided 模式（動態滿分 = steps×2 + 5 + 3 + 2）

| 維度 | 滿分 | 計算方式 |
|------|------|---------|
| 步驟正確性 | 每步 2 分 | `steps_completed × 2` |
| 步驟順序 | 5 分 | 全正序 = 5，錯 1 步 = 3，錯 2+ = 0 |
| 效率 | 3 分 | 0 錯 = 3，1-2 = 2，3-5 = 1，5+ = 0 |
| 時間 | 2 分 | <30s = 2，30-60s = 1，>60s = 0 |

#### DragDrop（100 分制）
- Ordering：`(正確位置數 / 總數) × 100`
- Matching：`(正確配對數 / 總數) × 100`

#### QuizInline
- Single：全對 = 滿分，錯 = 0
- Multi：`((正確數 - 錯誤數×0.5) / 總正確數) × points`，下限 0
- Fill-blank：case-insensitive trim match，支援多個正確答案

### 3C-3：課程上架系統

**課程生命週期**：
```
draft（草稿）→ published（已發佈）→ archived（已封存）
         ↑                          ↓
         └──────── unpublish ←──────┘
```

#### 發佈前檢查 API

```
GET /training/courses/:id/publish-check
Response: {
  checks: [
    { key: 'has_lessons',      pass: true,  detail: '3 lessons' },
    { key: 'has_slides',       pass: true,  detail: '12 slides' },
    { key: 'hotspot_regions',  pass: false, detail: '1 hotspot(s) missing correct region' },
    { key: 'has_audio',        pass: true,  detail: '8 slides with audio', optional: true }
  ],
  can_publish: false   // 必填項全 pass 才為 true
}
```

#### 發佈 API（含驗證 + 通知）

```
POST /training/courses/:id/publish
Body: { force?: boolean }   // force=true 跳過檢查
```

行為：
1. 若非 force → 檢查 lessons ≥ 1、slides ≥ 1，不過則 400
2. `UPDATE courses SET status='published'`
3. 查 `course_access` 中 `grantee_type='user'` 的所有使用者
4. 對每人寫入 `training_notifications`（type='course_published'）

#### 取消發佈 / 封存

```
POST /training/courses/:id/unpublish  → status = 'draft'（owner + admin）
POST /training/courses/:id/archive    → status = 'archived'（owner + admin）
```

#### CourseEditor UI 改動

- **草稿狀態**：「發佈課程」綠色按鈕 → 點擊後先 call `publish-check` → 彈出 checklist modal
  - 每項 ✅/❌ 標記，選配項標黃 ⚠️
  - 必填項全過 → 「確認發佈」按鈕亮起
  - 有失敗 → 按鈕 disabled
- **已發佈狀態**：顯示「取消發佈」黃色按鈕 → confirm 後 call unpublish

### 3C-4：管理員成績報表

**檔案**：`client/src/components/training/InteractionReport.tsx`
**入口**：CourseEditor 新增「成績」tab（`activeTab === 'reports'`）

#### 課程層級 API

```
GET /training/courses/:id/interaction-report
Response: {
  summary: { total_users, avg_score, avg_time, completion_rate },
  slides: [{ slide_id, block_type, attempts, user_count, avg_score, avg_max_score, avg_wrong_clicks, avg_time }],
  users: [{ user_id, user_name, employee_id, total_interactions, avg_score, total_time }]
}
```

#### 使用者明細 API

```
GET /training/courses/:id/interaction-report/:userId
Response: {
  user: { name, employee_id },
  results: [{ slide_id, block_type, score, max_score, total_time_seconds, wrong_clicks, steps_completed, total_steps, action_log, score_breakdown, created_at }]
}
```

#### 前端 UI
- **4 張 Summary Card**：參與人數 / 平均分數 / 平均用時 / 完成率
- **投影片統計表**：每張 slide × block_type 的 attempts / user_count / avg_score / avg_wrong / avg_time
- **使用者清單**：可點擊展開 per-slide 明細（score / steps / wrong_clicks / time / date）

### 3C-5：多語言修正（附帶修復）

課程/章節/分類的翻譯資料在 translate 流程中已正確寫入 `course_translations` / `lesson_translations` / `category_translations`，但讀取 API 未套用。此次一併修正：

**Server 端**（`training.js`）：
- `GET /courses`：接受 `?lang=`，batch 查詢 `course_translations` + `category_translations`，merge 回 title / description / category_name
- `GET /courses/:id`：接受 `?lang=`，merge course title/desc + category_name + lesson titles（`lesson_translations`）
- `GET /courses/:id/lessons`：接受 `?lang=`，merge `lesson_translations.title`

**前端**：
- `CourseList.tsx`：`api.get('/training/courses', { params: { lang: i18n.language, ... } })`
- `CourseDetail.tsx`：`api.get(\`/training/courses/${id}\`, { params: { lang: i18n.language } })`
- `CoursePlayer.tsx`：course detail API 補帶 `{ params: { lang } }`（slides 本來就有帶）

### 3C 實作檔案總覽

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | +`interaction_results` 表 (auto-create on init) |
| `server/services/interactionScorer.js` | **新建** — `scoreHotspot`(explore/guided), `scoreDragDrop`, `scoreQuizInline` |
| `server/routes/training.js` | +interaction-result API, 改造 publish (validation+notification), +publish-check, +unpublish, +interaction-report, +interaction-report/:userId, 修正 GET courses/courses/:id/lessons merge 翻譯 |
| `client/.../blocks/HotspotBlock.tsx` | +`actionLogRef`, `startTimeRef`, `wrongClicksRef`, +`onInteractionComplete` callback |
| `client/.../blocks/DragDropBlock.tsx` | +`onInteractionComplete` callback, +`startTimeRef` |
| `client/.../blocks/QuizInlineBlock.tsx` | +`onInteractionComplete` callback, +`startTimeRef` |
| `client/.../SlideRenderer.tsx` | +`onInteractionComplete` prop 傳遞到 hotspot/dragdrop/quiz_inline |
| `client/.../CoursePlayer.tsx` | +`handleInteractionComplete` → API submit + score toast, +course detail 帶 lang |
| `client/.../editor/CourseEditor.tsx` | +publish checklist modal, +unpublish btn, +reports tab, +InteractionReport import |
| `client/.../InteractionReport.tsx` | **新建** — 課程/投影片/使用者三維度統計報表 |
| `client/.../CourseList.tsx` | +courses & categories API 帶 `lang` |
| `client/.../CourseDetail.tsx` | +course detail API 帶 `lang` |
| `client/src/i18n/locales/{zh-TW,en,vi}.json` | +35 個 i18n keys |

### 3C 測試劇本

#### T1：Hotspot Guided 互動紀錄 + 評分

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 建立課程 → 新增章節 → 新增投影片 → 加 Hotspot block（4 個 correct region，guided 模式） | Hotspot 編輯器正常 |
| 2 | 進入課程播放（learn 模式）→ 到 Hotspot slide | 出現截圖 + 導引提示 |
| 3 | 依序正確點擊 4 個 region（不犯錯） | 每步 ✅ 反饋 → 完成 → **右上角 toast 顯示分數**（應為滿分） |
| 4 | 開 DevTools Network → 找 `interaction-result` request | Response: `{ score: 18, max_score: 18, score_breakdown: { steps: {8,8}, order: {5,5}, efficiency: {3,3}, time: {2,2} } }` |
| 5 | 查 DB：`SELECT * FROM interaction_results ORDER BY id DESC FETCH FIRST 1 ROW ONLY` | 有紀錄，action_log 是 4 筆 JSON，score=18 |

#### T2：Hotspot Guided 錯誤扣分

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 同 T1 課程 → 進入 test 模式 | 橘色主題 |
| 2 | Step 1 先故意點錯 2 次 → 再點對 | 出現 progressive hint（第 3 次顯示提示文字） |
| 3 | Step 2-4 正確完成 | toast 分數 < 滿分（efficiency + order 被扣） |
| 4 | 查 DB | wrong_clicks ≥ 2，score < max_score |

#### T3：Hotspot Explore 互動紀錄

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 新增 Hotspot block（explore 模式，3 個 correct region） | |
| 2 | 進入播放 → 直接正確點擊 3 個 region | 每個顯示 explore_desc → 完成 → toast 100/100 |
| 3 | 重來 → 多點 3 次錯誤再完成 | toast 分數 < 100（efficiency 扣分） |

#### T4：DragDrop 互動紀錄

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 新增投影片含 DragDrop block（ordering 模式，4 items） | |
| 2 | 進入播放 → 排好順序 → 點「檢查答案」 | 顯示正確/錯誤 + **toast 顯示分數** |
| 3 | 故意排錯 2 個位置 → 檢查 | toast 分數 = 50/100（2/4 正確） |
| 4 | 查 DB | block_type='dragdrop', score 與前端一致 |

#### T5：QuizInline 互動紀錄

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 新增投影片含 QuizInline block（single_choice, 4 選項, 10 分） | |
| 2 | 播放 → 選正確答案 → 送出 | ✅ 正確 + toast 10/10 |
| 3 | 播放 → 選錯誤答案 → 送出 | ❌ 錯誤 + toast 0/10 |

#### T6：發佈 Checklist — 空課程

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 建立新課程（無章節、無投影片）→ 點「發佈課程」 | 彈出 checklist modal |
| 2 | 觀察 checklist | ❌ has_lessons, ❌ has_slides, ✅ hotspot_regions（vacuous truth），⚠️ has_audio |
| 3 | 「確認發佈」按鈕 | **disabled**（can_publish = false） |

#### T7：發佈 Checklist — 完整課程

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 使用有章節+投影片+Hotspot(有correct region)的課程 → 點「發佈課程」 | checklist modal |
| 2 | 觀察 checklist | ✅ has_lessons, ✅ has_slides, ✅ hotspot_regions, ⚠️ has_audio（選配） |
| 3 | 點「確認發佈」 | modal 關閉 → header badge 變綠 "已發佈" → 發佈按鈕消失 → 出現「取消發佈」黃色按鈕 |
| 4 | 查 DB：`SELECT * FROM training_notifications WHERE type='course_published' ORDER BY id DESC` | 被分享使用者有收到通知紀錄 |

#### T8：取消發佈

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 已發佈課程 → 點「取消發佈」 | confirm 對話框 |
| 2 | 確認 | badge 變黃 "草稿" → 黃色按鈕消失 → 綠色「發佈課程」重新出現 |
| 3 | 用一般使用者帳號 → 課程列表 | 該課程不再出現（非 public 且非 owner） |

#### T9：管理員成績報表

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 使用 T1-T5 產生過互動紀錄的課程 → CourseEditor → 「成績」tab | |
| 2 | 觀察 Summary Cards | 參與人數 ≥ 1，平均分數 > 0 |
| 3 | 觀察投影片統計表 | 有 hotspot / dragdrop / quiz_inline 列，各有 avg_score / avg_time |
| 4 | 點擊某使用者 row | 展開該使用者的 per-slide 明細表 |
| 5 | 明細表顯示 | 每行：slide ID / type / score/max / steps / wrong / time / date |

#### T10：多語言 — 課程列表與詳情

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 有翻譯的課程（已跑過 translate en） | |
| 2 | 右上角切換語言為 English | |
| 3 | 課程列表頁 | 課程 title / description 顯示英文翻譯 |
| 4 | 點入課程詳情頁 | 課程 title + 章節 title 顯示英文 |
| 5 | 進入播放 | 課程標題 bar 顯示英文 + slide 內容為英文 |
| 6 | 切回 zh-TW | 全部恢復中文 |

---

## 14. Phase 3D-Help — Help 說明書 × 教育訓練無縫整合（✅ 完成）

> 狀態：2026-04-05 設計 + 實作完成

### 設計目標

將 FOXLINK GPT 的使用者說明書（Help 系統）與教育訓練平台無縫整合。每個 Help section 可綁定對應的教材課程/章節，使用者直接在說明書頁面打開 modal 進行互動學習和測驗，含完整評分和成績歷史。

**僅適用於 FOXLINK GPT 本身的說明書**，其他系統仍使用標準教育訓練平台。

### 14-1：DB Schema 改動

```sql
-- 1. interaction_results 加 session_id（通用，CoursePlayer 也用）
ALTER TABLE interaction_results ADD session_id VARCHAR2(36);

-- 2. help_sections 加教材綁定
ALTER TABLE help_sections ADD linked_course_id NUMBER;
ALTER TABLE help_sections ADD linked_lesson_id NUMBER;  -- NULL = 播放整門課
```

### 14-2：CoursePlayer 拆分

將現有 `CoursePlayer.tsx` 拆為：

- **`CoursePlayerInner`** — 純 UI + 邏輯（所有功能：音訊、Hotspot、Quiz、AI Tutor、Notes、Outline、鍵盤導航）
  - Props: `courseId`, `lessonId?`, `onClose`, `sessionId`, `skipAccessCheck?`, `lang`
- **`CoursePlayer`** — 路由 wrapper（`/training/course/:id/learn`），`useParams()` → `CoursePlayerInner`

兩者功能完全相同，差異僅在容器和關閉行為。

**session_id 通用化**：CoursePlayer 也在每次開啟時生成 `crypto.randomUUID()`，透過 SlideRenderer → Blocks → `POST /interaction-result` 全程傳遞。未來教育訓練報表也能做 session 聚合分析。

### 14-3：HelpTrainingPlayer（modal overlay）

**容器**：`fixed inset-0 z-50`，backdrop `bg-black/70`

**三種尺寸**（右上角按鈕切換）：

| 模式 | 尺寸 | 觸發 |
|------|------|------|
| 預設 | `90vw × 90vh` 置中 | 初次打開 |
| 縮小 | `70vw × 70vh` 置中 | 點「縮小」 |
| 全螢幕 | `100vw × 100vh` | 點「全螢幕」 |

**ESC 行為**：全螢幕 → 退出全螢幕；非全螢幕 → 關閉 modal。

**內部結構**：
```
┌─ HelpTrainingPlayer ─────────────────────────────────────┐
│ 📖 {course.title}         [🔍縮小] [⬜全螢幕] [✕關閉]   │
│                                                           │
│ Tabs: [▶ 教材] [📊 成績紀錄]                              │
│                                                           │
│ ┌─ 教材 tab ────────────────────────────────────────────┐ │
│ │  CoursePlayerInner (完整功能)                          │ │
│ │  含: learn/test 切換、音訊、AI Tutor、Notes、Outline  │ │
│ │  含: 互動評分 score toast                              │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                           │
│ ┌─ 成績紀錄 tab ────────────────────────────────────────┐ │
│ │  #1  📝測驗  92/100  ████████████░░  25s  04-05       │ │
│ │      ├ Slide #3 hotspot   18/18   8s                  │ │
│ │      ├ Slide #5 dragdrop  74/100  12s                 │ │
│ │      └ Slide #7 quiz      10/10   5s                  │ │
│ │                                                        │ │
│ │  #2  📖學習  78/100  ████████░░░░░░  42s  04-04       │ │
│ │      └ (點擊展開)                                      │ │
│ └───────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

### 14-4：權限與資料流

**權限規則**：Help 綁定的教材**跳過 `canUserAccessCourse` 檢查**，所有登入使用者都能學習。

**Draft 課程允許播放**：Help 綁定的課程不需走 publish 流程。

**完整資料流**：
```
HelpPage (lang=en)
  → GET /api/help/sections?lang=en
    → Response 帶 linked_course_id / linked_lesson_id
  → 使用者點「Interactive Tutorial」按鈕
  → HelpTrainingPlayer 打開 (sessionId = crypto.randomUUID())
    → CoursePlayerInner(courseId, lessonId, skipAccessCheck=true, sessionId, lang)
      → GET /training/courses/:id?lang=en&help=1          (跳過 access check)
      → GET /training/lessons/:lid/slides?lang=en          (翻譯 merge)
      → Hotspot / DragDrop / Quiz 互動
      → POST /training/slides/:sid/interaction-result      (帶 session_id)
        → interactionScorer 計算 → INSERT interaction_results
        → Response → score toast
    → 切到「成績紀錄」tab
      → GET /training/courses/:id/my-interaction-history
        → GROUP BY session_id 聚合
```

### 14-5：成績歷史 API

```
GET /training/courses/:id/my-interaction-history?lesson_id=
```

**權限**：任何登入使用者（只查自己的）

**Response**：
```json
{
  "sessions": [{
    "session_id": "uuid",
    "player_mode": "test",
    "total_score": 92,
    "total_max": 100,
    "interactions": 3,
    "total_time": 25,
    "started_at": "2026-04-05T14:30:00",
    "ended_at": "2026-04-05T14:30:25",
    "details": [
      { "slide_id": 3, "block_type": "hotspot", "score": 18, "max_score": 18, "total_time_seconds": 8, "wrong_clicks": 0 },
      { "slide_id": 5, "block_type": "dragdrop", "score": 74, "max_score": 100, "total_time_seconds": 12, "wrong_clicks": 0 },
      { "slide_id": 7, "block_type": "quiz_inline", "score": 10, "max_score": 10, "total_time_seconds": 5, "wrong_clicks": 0 }
    ]
  }]
}
```

**SQL**：
```sql
SELECT session_id, player_mode,
       SUM(score) AS total_score, SUM(max_score) AS total_max,
       COUNT(*) AS interactions,
       ROUND(SUM(total_time_seconds)) AS total_time,
       MIN(created_at) AS started_at, MAX(created_at) AS ended_at
FROM interaction_results
WHERE user_id=? AND course_id=? AND session_id IS NOT NULL
GROUP BY session_id, player_mode
ORDER BY MAX(created_at) DESC
```

### 14-6：Help 頁面 UI 改動

每個 Help section 標題右側加「互動教學」按鈕（僅當 `linked_course_id` 存在時顯示）：

```
📖 對話功能                                    [🎓 互動教學]
────────────────────────────────────────────────────────────
說明文字 blocks...
```

### 14-7：Admin 綁定 UI

在 `HelpTranslationPanel` 每個 section 的管理區塊加：

```
🎓 綁定教材:
課程: [▼ dropdown — 從 GET /training/courses?my_only=1 取]
章節: [▼ dropdown — 從所選課程的 lessons 取，含「全部」選項]
[儲存綁定]
```

API: `PUT /api/help/admin/sections/:id/link` → body `{ linked_course_id, linked_lesson_id }`

### 14-8：邊界情況處理

| 情況 | 處理 |
|------|------|
| 綁定的課程被刪除 | 按鈕不顯示（前端 check linked_course_id 且 course 存在） |
| 綁定的 lesson 被刪除 | fallback 播整門課（忽略失效的 lesson_id） |
| 課程無翻譯 | fallback zh-TW（現有機制） |
| Draft 課程 | 允許播放（Help 專用，不受 publish 限制） |

### 14-9：三語言 i18n keys

| key | zh-TW | en | vi |
|-----|-------|----|----|
| `help.interactiveTutorial` | 互動教學 | Interactive Tutorial | Hướng dẫn tương tác |
| `help.scoreHistory` | 成績紀錄 | Score History | Lịch sử điểm |
| `help.totalScore` | 總分 | Total Score | Tổng điểm |
| `help.session` | 第 {{n}} 次 | Attempt #{{n}} | Lần #{{n}} |
| `help.slideDetail` | 投影片明細 | Slide Details | Chi tiết slide |
| `help.fullscreen` | 全螢幕 | Fullscreen | Toàn màn hình |
| `help.shrink` | 縮小 | Shrink | Thu nhỏ |
| `help.linkCourse` | 綁定教材 | Link Course | Liên kết khóa học |
| `help.selectCourse` | 選擇課程 | Select Course | Chọn khóa học |
| `help.selectLesson` | 選擇章節 | Select Lesson | Chọn bài học |
| `help.allLessons` | 全部章節 | All Lessons | Tất cả bài học |
| `help.saveLink` | 儲存綁定 | Save Link | Lưu liên kết |

### 14-10：實作檔案清單

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | `runMigrations()` 加 3 個 `addCol`：`INTERACTION_RESULTS.SESSION_ID`、`HELP_SECTIONS.LINKED_COURSE_ID`、`HELP_SECTIONS.LINKED_LESSON_ID` |
| `server/routes/training.js` | `POST /slides/:sid/interaction-result` 接收+存 `session_id`；`loadCoursePermission` 支援 `help=1` 跳過 access check；**新增** `GET /courses/:id/my-interaction-history` session 聚合 API |
| `server/routes/helpSections.js` | `GET /sections` + `GET /admin/status` 回傳 `linkedCourseId`/`linkedLessonId`；**新增** `PUT /admin/sections/:id/link` |
| `client/.../CoursePlayer.tsx` | 拆分為 `CoursePlayerInner`（named export，接收 props）+ `CoursePlayer`（default export，路由 wrapper）；兩者都用 `crypto.randomUUID()` 生成 sessionId 並透過 interaction-result API 傳遞 |
| `client/.../HelpTrainingPlayer.tsx` | **新建** — modal overlay（3 種尺寸）+ 教材/成績雙 tab + `CoursePlayerInner` + `ScoreHistoryPanel`（同檔） |
| `client/src/pages/HelpPage.tsx` | import `HelpTrainingPlayer`；每個 `linkedCourseId` 存在的 section 標題旁加「🎓 互動教學」按鈕 → 開啟 modal |
| `client/.../admin/HelpTranslationPanel.tsx` | +`CourseOption` interface；fetchCourses；section 名稱欄加「🎓 綁定教材」inline UI（課程+章節 dropdown + 儲存） |
| `client/.../HelpBlockRenderer.tsx` | `HelpSectionData` interface +`linkedCourseId`/`linkedLessonId` |
| `client/src/i18n/locales/{zh-TW,en,vi}.json` | help 區塊各 +7 keys（interactiveTutorial, scoreHistory, courseTab, noHistory, session, fullscreen, shrink） |

### 14-11：測試劇本

#### T1：Admin 綁定教材

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | Admin → Help 管理 → section `u-chat` | 出現「綁定教材」區塊 |
| 2 | 課程 dropdown 選「對話功能教學」→ 章節選「基本對話」→ 儲存 | 成功提示 |
| 3 | 重新整理 → 確認綁定仍在 | linked_course_id + linked_lesson_id 有值 |

#### T2：使用者 Help 頁面看到按鈕

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 一般使用者 → Help 頁面 | 已綁定的 section 標題旁出現「🎓 互動教學」按鈕 |
| 2 | 未綁定的 section | 無按鈕 |

#### T3：打開 HelpTrainingPlayer 完成互動

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 點「互動教學」 | modal overlay 開啟（90vw×90vh），顯示教材 tab |
| 2 | learn/test 模式切換 | 正常切換 |
| 3 | 完成 Hotspot 互動 | score toast 顯示，音訊正常播放 |
| 4 | 全螢幕按鈕 | modal 擴展為 100vw×100vh |
| 5 | ESC | 退出全螢幕（不關閉 modal） |
| 6 | ESC | 關閉 modal，回到 Help 頁面 |

#### T4：成績歷史

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | T3 完成後 → 切到「成績紀錄」tab | 顯示 1 筆 session，含總分/用時 |
| 2 | 展開 session | 看到 per-slide 明細 |
| 3 | 關閉 modal → 重新打開 → 做第二次測驗 | 成績 tab 顯示 2 筆 session |

#### T5：三語言

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 切換語言 English → Help 頁面 | 按鈕顯示「Interactive Tutorial」 |
| 2 | 打開 player | 課程/章節標題顯示英文，投影片內容英文 |
| 3 | 成績 tab 欄位標題 | 英文 |
| 4 | 切 vi → 重複驗證 | 越南文 |

#### T6：權限跳過

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 建立 draft 課程，不設 is_public，不加 course_access | |
| 2 | Admin 綁定到 Help section | |
| 3 | 一般使用者打開 Help → 點「互動教學」 | **正常播放**（不受 access/publish 限制） |

---

## 15. Phase 3D-Export — 課程匯出/匯入封包（✅ 完成）

> 狀態：2026-04-05 實作完成

### 設計目標

支援測試環境 → 正式環境的課程遷移。匯出完整課程封包（ZIP），含所有 metadata + 翻譯 + 引用檔案，匯入時自動重建課程並 remap 所有 ID。

### 15-1：匯出封包格式

```
course_42_export.zip
├── manifest.json       ← 課程完整結構化資料
└── files/              ← 所有引用的圖片/音訊檔案
    ├── course_42/screenshot1.png
    ├── course_42/narration.mp3
    └── ...
```

**manifest.json 結構**：
```json
{
  "version": 1,
  "exported_at": "2026-04-05T14:30:00.000Z",
  "course": {
    "title": "...", "description": "...", "category_name": "...",
    "pass_score": 60, "max_attempts": null, "time_limit_minutes": null,
    "is_public": 0, "settings_json": "...", "cover_image": "..."
  },
  "lessons": [
    { "_orig_id": 1, "title": "...", "sort_order": 0, "lesson_type": "standard" }
  ],
  "slides": [
    { "_orig_id": 10, "_orig_lesson_id": 1, "slide_type": "content",
      "content_json": "...", "notes": "...", "audio_url": "...",
      "duration_seconds": null, "sort_order": 0 }
  ],
  "questions": [
    { "_orig_id": 5, "question_type": "single_choice",
      "question_json": "...", "answer_json": "...", "scoring_json": "...",
      "points": 10, "explanation": "...", "sort_order": 0 }
  ],
  "slide_branches": [
    { "_orig_slide_id": 10, "option_text": "...", "option_index": 0,
      "_orig_target_slide_id": 12, "_orig_target_lesson_id": null }
  ],
  "translations": {
    "course": [{ "lang": "en", "title": "...", "description": "..." }],
    "lessons": [{ "_orig_lesson_id": 1, "lang": "en", "title": "..." }],
    "slides": [{ "_orig_slide_id": 10, "lang": "en", "content_json": "...",
                 "notes": "...", "audio_url": "...",
                 "image_overrides": "...", "regions_json": "..." }],
    "questions": [{ "_orig_question_id": 5, "lang": "en",
                    "question_json": "...", "explanation": "..." }]
  }
}
```

### 15-2：匯出 API

```
GET /training/courses/:id/export-package
```

**權限**：owner / admin / develop

**行為**：
1. 查詢 course + lessons + slides + questions + 所有 translations + slide_branches
2. 掃描所有 content_json / audio_url / cover_image 中的 `/api/training/files/*` 引用
3. 用 `archiver` 打包 manifest.json + 實體檔案 → stream ZIP 到 response

### 15-3：匯入 API

```
POST /training/courses/import-package
Content-Type: multipart/form-data
Body: package (ZIP file)
```

**權限**：admin 或 effective_training_permission='edit'

**行為**：
1. 用 `JSZip` 解壓 → 讀取 manifest.json
2. 建立/查找 category（by name）
3. 建立 course（status='draft'，created_by=當前使用者）
4. 建立 lessons → 記錄 `lessonIdMap[orig → new]`
5. 解壓 files/ → 寫入 `uploads/course_{新ID}/` → 記錄 `filePathMap`
6. 建立 slides（content_json / audio_url 路徑重映射）→ 記錄 `slideIdMap`
7. 建立 questions → 記錄 `questionIdMap`
8. 建立 slide_branches（target_slide_id / target_lesson_id 重映射）
9. 匯入所有 translations（ID 全部重映射）
10. 更新 cover_image 路徑

**Response**：
```json
{
  "ok": true,
  "course_id": 99,
  "stats": {
    "lessons": 3, "slides": 12, "questions": 5, "files": 8,
    "translations": { "course": 2, "lessons": 6, "slides": 24, "questions": 10 }
  }
}
```

### 15-4：前端 UI

**匯出**：CourseEditor header → 「匯出封包」按鈕（Download icon）→ 直接 `<a>` 下載 ZIP

**匯入**：CourseList editor 模式 → 「匯入封包」按鈕（Upload icon）→ `<input type="file" accept=".zip">` → POST → alert 統計 → navigate 到新課程編輯器

### 15-5：ID 重映射表

| 原始欄位 | 重映射來源 |
|----------|-----------|
| `slides._orig_lesson_id` | `lessonIdMap` |
| `slide_branches._orig_slide_id` | `slideIdMap` |
| `slide_branches._orig_target_slide_id` | `slideIdMap` |
| `slide_branches._orig_target_lesson_id` | `lessonIdMap` |
| `translations.lessons._orig_lesson_id` | `lessonIdMap` |
| `translations.slides._orig_slide_id` | `slideIdMap` |
| `translations.questions._orig_question_id` | `questionIdMap` |
| 所有 `/api/training/files/course_舊ID/` 路徑 | `filePathMap` |

### 15-6：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/routes/training.js` | +`GET /courses/:id/export-package`（archiver ZIP stream）+ `POST /courses/import-package`（JSZip 解壓 + 全量重建） |
| `client/.../editor/CourseEditor.tsx` | header +「匯出封包」按鈕 |
| `client/.../CourseList.tsx` | editor 模式 +「匯入封包」按鈕（file input + FormData POST） |
| `client/src/i18n/locales/{zh-TW,en,vi}.json` | +6 keys（exportPackage, importPackage, importSuccess, importFailed, slides, lessons） |

### 15-7：測試劇本

#### T1：匯出課程

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 測試環境 → 有內容的課程 → 課程編輯器 | header 有「匯出封包」按鈕 |
| 2 | 點擊「匯出封包」 | 瀏覽器下載 `course_XX_export.zip` |
| 3 | 解壓驗證 | 有 `manifest.json` + `files/` 目錄含圖片音訊 |
| 4 | 檢查 manifest.json | 含 course/lessons/slides/questions/translations 完整資料 |

#### T2：匯入課程（正式環境）

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 正式環境 → 教育訓練 → 課程管理 | 有「匯入封包」按鈕 |
| 2 | 點擊「匯入封包」→ 選擇 T1 下載的 ZIP | 上傳 → alert 顯示統計（章節數/投影片數） |
| 3 | 自動跳轉到新課程編輯器 | 課程 title 正確，status=draft |
| 4 | 檢查章節列表 | 章節數量、標題與原始課程一致 |
| 5 | 展開投影片 | 投影片內容、圖片正常顯示 |
| 6 | 播放投影片 | Hotspot regions 正確、音訊正常 |
| 7 | 切到 Translate tab | en/vi 翻譯已匯入 |

#### T3：匯入完整性驗證

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 匯入含 quiz 的課程 | 題庫 tab 顯示所有題目 |
| 2 | 匯入含 slide_branches 的課程 | 分支跳轉 ID 正確（指向新 slide/lesson） |
| 3 | 匯入含 cover_image 的課程 | 封面圖正常顯示 |
| 4 | 匯入的課程分類在正式環境不存在 | 自動建立新分類 |

#### T4：三語言播放驗證

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 匯入的課程 → 播放（zh-TW） | 中文內容 + 音訊 |
| 2 | 切換語言 English → 播放 | 英文翻譯內容 + 英文音訊（如有） |
| 3 | 切換 vi → 播放 | 越南文 |

---

## 16. Phase 3D-Exam — 測驗系統 + 測驗主題 + 成績紀錄（✅ 完成）

> 狀態：2026-04-05 實作完成

### 16-1：測驗系統重構

**簡化計分**：刪除複雜版評分規則 UI（hotspot 各維度配置），改為配分制：

```
總分 100 分（可自訂）
5 題互動投影片 → 每題 20 分（平均 or 自訂）
每題得分 = interactionScorer 正確比例 × 該題配分
```

**Learn 模式**：完全不記錄互動成績（不 POST interaction-result），只有 test 模式才計分。

**CourseEditor 設定 tab「測驗設定」**：

| 設定 | 說明 |
|------|------|
| 總分 | 預設 100，可自訂 |
| 及格分數 | `pass_score`，顯示在測驗設定 UI |
| 時間限制 | N 分鐘，可啟用/關閉 |
| 超時處理 | 自動結算 / 提醒但允許繼續 |
| 配分方式 | 平均分配 / 自訂權重 |

存在 `courses.settings_json.exam`。

### 16-2：測驗流程 UI

**起始畫面**（test 模式進入時顯示）：
- 滿分、題數、時間限制、及格標準
- 計分說明（每題依正確度比例給分、超時未完成不計分）
- [開始測驗] 按鈕

**測驗中**：
- Header 右上角倒數計時器（<2 分鐘紅色閃爍）
- 只顯示互動投影片（自動跳過純文字/圖片 slide）
- 完成一題 → toast 顯示配分制分數（如 17/20）→ 2 秒後自動跳下一題
- 測驗中禁用 Outline/Notes/AI Tutor/鍵盤導航

**結果畫面**：
- 🏆 總分（大字）+ 及格判定（通過/未通過）+ 用時
- 每題分數 bar（✅ 滿分 / ⚠️ 部分分 / ❌ 零分）
- 非滿分的題目可展開「錯題分析」：
  - Hotspot：步驟完成數 + 錯誤點擊數 + 每次錯誤的位置和命中 region
  - DragDrop：正確配對/排序數
  - QuizInline：答對/答錯
- [重新測驗] 生成新 session_id + 重新倒數
- [返回]

**超時處理**：
- `auto_submit`：時間到自動跳到結果畫面，未完成題目 = 0 分
- `warn_continue`：彈 modal 提醒，可選「立即結算」或「繼續作答」

### 16-3：測驗主題系統

**DB Schema**：
```sql
exam_topics (id, course_id, title, description, total_score, pass_score,
             time_limit_minutes, time_limit_enabled, overtime_action,
             scoring_mode, custom_weights, sort_order, created_by, created_at)

exam_topic_lessons (id, exam_topic_id, lesson_id, sort_order)  -- junction table
```

**用途**：一門課可以有多個測驗主題，每個主題包含不同章節組合，各自有獨立的滿分/及格/時間設定。

**CourseEditor「測驗主題」tab**：
- CRUD 管理（新增/編輯 modal：標題、章節 checkbox 多選、滿分、及格、時間、超時）
- 新增時預設帶入課程的測驗設定值

**CourseDetail 測驗入口**：
- 課程詳情頁顯示「📝 測驗主題」列表
- 每個主題：標題 / 滿分 / 時間 / 章節數 / [開始測驗] 按鈕
- 點開始 → `?mode=test&examTopic=XX` → CoursePlayerInner 載入 topic config + 篩選章節

### 16-4：成績紀錄與歷史

**DB 新增欄位**：
```sql
ALTER TABLE interaction_results ADD exam_topic_id NUMBER;
ALTER TABLE interaction_results ADD weighted_score NUMBER;
ALTER TABLE interaction_results ADD weighted_max NUMBER;
```

- `exam_topic_id`：記錄來自哪個測驗主題
- `weighted_score` / `weighted_max`：配分制加權分數（前端傳 weighted_max → server 計算 weighted_score = ratio × weighted_max）
- 歷史查詢用 `COALESCE(weighted_score, score)` 優先用加權分

**CourseDetail「我的測驗紀錄」**：
- session 列表：序號 / learn|test badge / 測驗主題名稱 / score bar / 分數 / 用時 / 日期時間（到秒）
- 資料來源：`GET /courses/:id/my-interaction-history`（JOIN exam_topics 回傳 title）

**CourseList 卡片測驗摘要**：
- 每張課程卡片底部：`📝 3 次測驗 | 平均: 78.5 | 最高: 92/100 (基礎操作)`
- 資料來源：`GET /courses` 附帶 `my_exam_summary`（server 端 SQL 聚合）

**時間顯示**：所有成績紀錄、InteractionReport、ScoreHistoryPanel 改為 `toLocaleString()`（到時分秒）。

### 16-5：外語 Region 語音編輯

**問題**：LanguageImagePanel 的 region 編輯面板只有 label/correct/feedback，沒有 narration/test_hint/explore_desc 和 VoiceInput → 外語版無法單獨對個別 region 生成語音。

**修正**：region 屬性面板新增三個語音欄位（僅 correct region）：
- 📖 學習導引（narration）+ VoiceInput（TTS/錄音/上傳）
- 📝 測驗提示（test_hint）+ VoiceInput
- 🔍 探索說明（explore_desc）+ VoiceInput
- VoiceInput 帶 `language` 參數 → 產生對應語言 TTS
- Region preview 顯示三種語音文字 + 無語音警告

### 16-6：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | migration: +exam_topic_id, +weighted_score, +weighted_max on interaction_results; +exam_topics, +exam_topic_lessons 表 |
| `server/routes/training.js` | interaction-result 存 exam_topic_id + weighted_*; my-interaction-history COALESCE weighted; courses 列表附帶 my_exam_summary; exam-topics CRUD API |
| `server/services/interactionScorer.js` | config 參數保留（不影響，前端只用 score/max_score 比例） |
| `client/.../CoursePlayer.tsx` | 測驗起始畫面 + 倒數計時 + 自動跳題 + 結果畫面 + 錯題分析 + examTopicId 支援 + weighted_max POST + learn 模式不 POST |
| `client/.../editor/CourseEditor.tsx` | 刪複雜版評分 UI → 新測驗設定 + 測驗主題 tab + ExamTopicsManager + pass_score 欄位 |
| `client/.../CourseDetail.tsx` | 測驗主題列表 + 我的測驗紀錄 + examHistory |
| `client/.../CourseList.tsx` | 卡片底部 my_exam_summary（次數/平均/最高） |
| `client/.../HelpTrainingPlayer.tsx` | ScoreHistoryPanel 時間到秒 + exam_topic_title |
| `client/.../InteractionReport.tsx` | 時間到秒 |
| `client/.../editor/blocks/LanguageImagePanel.tsx` | region 編輯加 narration/test_hint/explore_desc + VoiceInput |
| `client/src/i18n/locales/{zh-TW,en,vi}.json` | +60 keys（exam + topic + history + scoring） |

### 16-7：測試劇本

#### T1：測驗設定

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | CourseEditor → 設定 tab | 顯示「測驗設定」區塊（總分/及格/時間/超時/配分） |
| 2 | 設定總分 100、及格 60、時間 10 分鐘、自動結算 | |
| 3 | 儲存 → 重新整理 | 設定值保留 |

#### T2：測驗主題 CRUD

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | CourseEditor → 測驗主題 tab → [新增] | 彈出 modal，預設帶入測驗設定值 |
| 2 | 輸入「基礎操作」→ 勾選章節 1+2 → 滿分 100 → 及格 60 → 儲存 | 列表出現新主題 |
| 3 | 編輯 → 修改及格分數為 70 → 儲存 | 更新成功 |
| 4 | 刪除 → 確認 | 消失 |

#### T3：測驗流程（配分制）

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | CourseDetail → 測驗主題「基礎操作」→ [開始測驗] | 起始畫面顯示滿分/題數/時間/及格 |
| 2 | 點 [開始測驗] | 倒數計時開始，跳到第一題互動投影片 |
| 3 | 完成 Hotspot | toast：✅ 第 1 題：20/20 → 2 秒後自動跳下一題 |
| 4 | 故意做錯一題 | toast：⚠️ 第 2 題：12/20 |
| 5 | 完成所有題 | 結果畫面：總分 92/100 ✅ 通過 |
| 6 | 展開錯題 | 顯示錯誤點位分析 |

#### T4：成績紀錄一致性

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | T3 完成後 → 返回 CourseDetail | 「我的測驗紀錄」顯示 #1 test 基礎操作 92/100 日期到秒 |
| 2 | 課程列表 | 卡片底部：📝 1 次測驗 \| 平均: 92 \| 最高: 92/100 |
| 3 | Help 嵌入播放 → 成績紀錄 tab | 分數一致（配分制） |

#### T5：Learn 模式不計分

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 進入 learn 模式 → 完成 Hotspot | 無 toast、無 score 顯示 |
| 2 | 查 CourseDetail 測驗紀錄 | 無 learn 模式紀錄 |
| 3 | 查 DB interaction_results | 無 player_mode='learn' 的新紀錄 |

#### T6：超時處理

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | 設定時間限制 1 分鐘，自動結算 → 開始測驗 | 倒數開始 |
| 2 | 等 1 分鐘不操作 | 自動跳到結果畫面，未完成題目 = 0 分 |
| 3 | 改為「提醒但允許繼續」→ 重來 | 時間到出現 modal：「立即結算」/「繼續作答」 |

#### T7：外語 Region 單獨語音

| 步驟 | 操作 | 預期 |
|------|------|------|
| 1 | CourseEditor → 投影片 → Hotspot → 多語底圖 → en tab | |
| 2 | 點「編輯」→ 選一個 correct region | 右側面板顯示 narration/test_hint/explore_desc + VoiceInput |
| 3 | 輸入英文文字 → 點 TTS 按鈕 | 生成英文語音 |
| 4 | 播放課程 en 版 | 該 region 有英文語音 |

---

## 17. Phase 3E — 分析與進階功能（規劃中）

| 功能 | 說明 |
|------|------|
| 學習者操作熱力圖 | 彙總點擊座標 → 截圖上渲染熱力圖 → 找出易犯錯區域 |
| 教材分析儀表板 | 停留時間、中斷率、題目難度曲線 |
| 證書 PDF 產出 | pdfkit 生成含姓名、課程、分數、日期的完課證書 |
| 專案報表匯出 Excel | 培訓專案完成率、各部門進度、逾期統計 |

---

## 17. Phase 3F — 教材工具（規劃中）

| 功能 | 說明 |
|------|------|
| 影片 AI 拆幀 | ffmpeg + Gemini 混合拆幀→自動生成投影片 |
| 桌面截圖代理 | Electron F9 全局快捷鍵，截 Java Forms 等非瀏覽器系統 |
| PPT 匯入 | .pptx → 自動轉換為投影片 |
| 教材版本控制 | v1→v2 + 已完成學員可選擇升級 |
| 差異更新 | 系統升版 → AI 比對新舊截圖 → 只重做有變更步驟 |
| 教材模板庫 | 跨課程複用模板 |
| 進階標註 | 畫筆平滑化 Bezier、標註模板、語音搭配標註同步播放 |

---

## 18. Phase 4 — 進階差異化功能（遠期規劃）

| 功能 | 說明 |
|------|------|
| Playwright 全自動 | AI 根據腳本自動操作 → 人只需審核 |
| Extension 離線模式 | IndexedDB 快取 → 批次上傳 |
| 操作回放驗證 | Playwright 重播 → 驗證教材是否仍有效 |
| iframe 導引模擬 | 嵌入真實系統 + 高亮 + 操作監聽 |
| 定期複訓 | 自動建立下一期培訓專案 |
| 討論區 / 徽章 / 排行榜 | 社群功能 |
| 微學習模式 | 5 分鐘短課程 |
| 離線模式 | PWA 快取 |
| SCORM 匯出 | SCORM 1.2/2004 標準匯出 |

---

## 19. Phase 3E — 截圖標註工具 + 封面裁切 + Player UX 改善（2026-04-05）

### 19-1：ScreenshotAnnotator 截圖標註工具

**背景**：Oracle ERP 使用 Java Applet Form，無法使用 Chrome Extension 瀏覽器截圖，只能手動 Win+Shift+S 截圖後 Ctrl+V 貼到 AI 錄製面板。但手動貼上的圖片缺少 Extension 的標註功能（圈框箭頭編號等），導致 AI 無法精確辨識操作重點。

**方案**：在前端建立獨立的 `ScreenshotAnnotator` 全螢幕 Modal，功能對齊 Chrome Extension `content.js` 的 `startAnnotationMode()`，但以 React + SVG 實作，不依賴 Extension。

**功能**：
- 7 種標註工具：① 步驟編號 / ◯ 圓圈 / ▭ 矩形 / → 箭頭 / T 文字 / ✎ 手繪 / ▦ 馬賽克
- 百分比座標系 (0-100%) — 與 Extension 完全相容
- 顏色選擇（7 色）、線寬選擇、文字大小選擇（XS/S/M/L/XL）
- Undo/Redo（Ctrl+Z / Ctrl+Y，最多 30 步）
- 拖拉移動已有標註、Delete 刪除選取
- 選取後可編輯：編號數字、標籤文字、顏色、文字大小
- 步驟編號自動計算（= 畫面最大編號 + 1），支援手動指定 + Reset 按鈕
- Aspect ratio 補償：使用 ellipse 代替 circle，解決 `preserveAspectRatio="none"` 造成的橢圓變形
- 語言選擇（🇹🇼 中 / 🇺🇸 EN / 🇻🇳 VI）+ 步驟編號 — 存回 step metadata
- 快捷鍵 1-7 切換工具

**入口**：
- RecordingPanel 步驟卡 hover 的 ✏️ 標註按鈕
- RecordingPanel 右側 detail panel「標註編輯」按鈕

**Bug fix — processAll 漏傳 annotations**：
手動 Ctrl+V 貼上的圖片上傳時，原本沒帶 `annotations_json` 參數，已修正。

### 19-2：Player 標註圖層隱藏

**問題**：錄製時的標註（①②③ 圈框箭頭）是幫 AI 辨識用的輔助資訊，學員在導覽/測驗時不應看到。

**修正**：
- `HotspotBlock.tsx`：移除 `AnnotationOverlay` 渲染（含 zoom overlay），移除相關 import
- `SlideRenderer.tsx`：image block 移除 `AnnotationOverlay`，移除 import
- 標註只在 editor（HotspotEditor、RecordingPanel）中顯示

### 19-3：外語圖片 Fallback 機制

**需求**：ERP 系統只有英文介面，但需製作 zh-TW / en / vi 三語教材。截圖只需做一次（存在 zh-TW 主語言），EN/VI 版沿用同一張圖。

**方案**：自動 Fallback 顯示（不複製檔案）
- **Player 端**：已自動生效 — server `GET /slides` 只在有 `image_overrides` 時才覆蓋 `block.image`，沒有 override 就保持 zh-TW 圖片
- **Editor 端**：`LanguageImagePanel.tsx` — 沒有上傳獨立底圖時，半透明顯示 zh-TW 圖片 + 「繼承主語言圖片」提示，上傳按鈕改為「上傳獨立底圖（選填）」

### 19-4：HotspotEditor 互動框拖拉修復

**問題**：`AnnotationEditor` 的 SVG overlay 設了 `zIndex: 5` + `pointerEvents: 'all'`，蓋在 region div 上面，導致選取模式下無法拖拉或調整大小。

**修正**：HotspotEditor 的標註層從互動式 `AnnotationEditor` 改為唯讀 `AnnotationOverlay`（預設 `pointerEvents: 'none'`），不阻擋 region 操作。標註編輯統一走 ScreenshotAnnotator。

### 19-5：AI JSON 解析容錯 + 自動重試

**問題**：Gemini API 偶爾回傳不合法 JSON（即使設了 `responseMimeType: 'application/json'`），導致「AI 回覆格式錯誤」。

**修正**：4 個 AI endpoint 統一加固：
1. Strip markdown code fences（`` ```json ... ``` ``）
2. 自動重試 3 次，每次間隔 1 秒
3. 錯誤訊息改為「AI 回覆格式錯誤（已重試 3 次）」

影響的 endpoint：
- `POST /slides/:sid/generate-narration`（全套導覽腳本）
- `POST /ai/analyze-screenshot`（AI 分析截圖）
- `POST /ai/generate-outline`（AI 生成大綱）
- `POST /ai/generate-quiz`（AI 出題）

### 19-6：課程封面圖片管理 + 裁切工具

**功能**：CourseEditor 基本資訊 tab 新增封面圖片上傳/更換/刪除。

**CoverCropModal 裁切工具**：
- 16:9 比例預覽框 + 三分構圖格線
- 拖拉平移圖片位置
- 滾輪或滑桿縮放（支援 contain 到放大，可縮到 30% contain fit）
- 圖片小於框時居中，空白處填白色
- Canvas 裁切輸出 1280px JPEG → 上傳 server
- Server API：`POST /courses/:id/cover`（已存在）

### 19-7：基本資訊 tab 及格分數移除

**變更**：及格分數欄位從基本資訊 tab 移除，僅保留在「設定」tab 的測驗設定區塊。

### 19-8：測驗模式右側面板 Sticky

**問題**：ERP 截圖很長，測驗題目在右下角，互動區域在上方，兩者無法同時看到。

**修正**：HotspotBlock 右側 info panel 加 `sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto`。面板隨頁面捲動黏在視窗頂部，內容太長時面板內部可捲動。

### 19-9：實作檔案

| 檔案 | 變更 |
|------|------|
| `client/.../editor/ScreenshotAnnotator.tsx` | **新增** — 全螢幕標註工具 Modal（7 工具 + undo/redo + aspect ratio 補償） |
| `client/.../editor/CoverCropModal.tsx` | **新增** — 封面圖片 16:9 裁切工具（拖拉+縮放+canvas 輸出） |
| `client/.../editor/RecordingPanel.tsx` | import ScreenshotAnnotator; 步驟卡 hover 加 ✏️ 標註按鈕; 右側加「標註編輯」按鈕; processAll 補傳 annotations_json; onSave 接收 meta（stepNumber, lang） |
| `client/.../editor/CourseEditor.tsx` | import CoverCropModal; 基本資訊加封面圖片上傳+裁切; 移除基本資訊 tab 及格分數 |
| `client/.../blocks/HotspotBlock.tsx` | 移除 AnnotationOverlay import + 渲染; 右側 panel 加 sticky |
| `client/.../blocks/AnnotationOverlay.tsx` | 無修改（被其他檔案引用方式變更） |
| `client/.../SlideRenderer.tsx` | 移除 AnnotationOverlay import + image block 標註渲染 |
| `client/.../editor/blocks/HotspotEditor.tsx` | AnnotationEditor → AnnotationOverlay（read-only, pointerEvents none） |
| `client/.../editor/blocks/LanguageImagePanel.tsx` | 無 langImage 時顯示 zh-TW 半透明預覽 + 「繼承主語言圖片」提示 |
| `server/routes/training.js` | 4 個 AI endpoint 加 JSON 解析容錯 + 自動重試 3 次 |

---

## 20. Phase 4A–4F：訓練教室 + 權限改造 + 專案上架（2026-04-06）

> 設計文件：[training-classroom-design.md](training-classroom-design.md)

### 20-1：Phase 4A — 權限模型改造 + Sidebar

**權限模型**：`none` / `publish` / `publish_edit`（原 `use` 廢除，`edit` 遷移為 `publish_edit`）

| 項目 | 說明 |
|------|------|
| DB migration | `training_permission` 值遷移 + VARCHAR2(20) 擴充 |
| Backend middleware | admin → `publish_edit`；新增 `canPublish()` / `canEditCourse()` helpers |
| AuthContext | 新增 `canAccessTrainingDev` / `canPublishTraining`；`canAccessTraining = true`（全員） |
| Sidebar | 「教育訓練」→「教育訓練課程開發」(BookOpen) + 新增「訓練教室」(GraduationCap) |
| 使用者管理 | 下拉改為 none / publish / publish_edit + i18n |
| 路由重組 | `/training/dev/*` + `/training/classroom/*` + 舊路由 redirect |

### 20-2：Phase 4B — 開發區 UI 重構

| 項目 | 說明 |
|------|------|
| TrainingDevArea | 兩個 tab：課程管理 / 訓練專案 |
| CourseList 更新 | 導航路徑改為 `/training/dev/courses/*`；publish 使用者無「新增課程」按鈕 |
| ProgramList | 訓練專案列表 + 狀態篩選 + 快速操作（發布/暫停/恢復/再版/刪除） |

### 20-3：Phase 4C — 課程分享 UI

| 項目 | 說明 |
|------|------|
| CourseShareTab | CourseEditor 新增「分享」tab |
| 六種 grantee type | user / role / department / cost_center / division / org_group |
| 兩種權限 | `view`（預覽）/ `develop`（協同開發） |

### 20-4：Phase 4D — 訓練專案管理

| 項目 | 說明 |
|------|------|
| ProgramEditor | 建立/編輯專案頁面（基本資訊 + 課程選擇 + 對象選擇 + 通知設定） |
| Backend CRUD 補完 | PUT/DELETE programs, targets, courses; pause/resume/reactivate |
| program_targets 擴充 | 新增 public / cost_center / division / org_group |
| activate 擴充 | 展開新 target types + `send_notification` + in-app + email 通知 |
| 課程選擇器 | Modal 列出可選課程（自己建立 + 被分享的） |

### 20-5：Phase 4E — 訓練教室

| 項目 | 說明 |
|------|------|
| TrainingClassroom | 專案卡片列表（進行中/已完成 分組 + 進度環 + 到期提示） |
| ProgramView | 專案內課程列表 + assignment 狀態 + 開始/繼續學習按鈕 |
| Backend API | `GET classroom/my-programs` / `GET classroom/programs/:id` / `PUT assignments/:aid/start,complete` |
| 整合 CoursePlayer | 帶 `program_id` + `assignment_id` query 進入學習 |

### 20-6：Phase 4F — 通知 + 自動化

| 項目 | 說明 |
|------|------|
| trainingCronService | 每日 01:30 AM 執行（Asia/Taipei） |
| 自動完成 | `end_date < today` 的 active 專案自動改 `completed` |
| 到期提醒 | `end_date - remind_before_days <= today`，通知未完成者（in-app + email） |
| 逾期通知 | `end_date` 過後一天，通知未完成者 |
| 已完成者排除 | 通知邏輯跳過 completed / exempted 的 assignment |

### 20-7：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | 權限值遷移 + VARCHAR2(20) 擴充 |
| `server/routes/training.js` | middleware 更新 + program CRUD 補完 + classroom API + activate 通知 |
| `server/services/trainingCronService.js` | **新增** — 訓練自動化 cron |
| `server/server.js` | 註冊 trainingCronService |
| `client/src/context/AuthContext.tsx` | 新增 canAccessTrainingDev / canPublishTraining |
| `client/src/components/Sidebar.tsx` | 兩個選單項目 |
| `client/src/pages/TrainingPage.tsx` | 路由重組 |
| `client/src/pages/TrainingDevArea.tsx` | **新增** — 開發區容器 |
| `client/src/pages/TrainingClassroom.tsx` | **新增** — 訓練教室首頁 |
| `client/src/components/training/ProgramList.tsx` | **新增** — 專案列表 |
| `client/src/components/training/ProgramEditor.tsx` | **新增** — 專案編輯器 |
| `client/src/components/training/ProgramView.tsx` | **新增** — 學員端專案詳情 |
| `client/src/components/training/editor/CourseShareTab.tsx` | **新增** — 課程分享 tab |
| `client/src/components/training/CourseList.tsx` | 導航路徑更新 + 權限過濾 |
| `client/src/components/training/CourseDetail.tsx` | 導航路徑更新 |
| `client/src/components/training/editor/CourseEditor.tsx` | 導航路徑更新 + 分享 tab |
| `client/src/components/admin/UserManagement.tsx` | 權限下拉選單更新 |
| `client/src/components/admin/RoleManagement.tsx` | 權限下拉選單更新 |
| `client/src/i18n/locales/zh-TW.json` | sidebar + permission + program + classroom + share keys |
| `client/src/i18n/locales/en.json` | 同上 |
| `client/src/i18n/locales/vi.json` | 同上 |

### 20-8：審計修復（2026-04-06 二次審計）

| 問題 | 嚴重度 | 修正 |
|------|--------|------|
| `auth.js` SSO/login/me 三端點回傳 `'edit'` 而非 `'publish_edit'` | CRITICAL | 統一改為 `'publish_edit'`；login 和 `/me` 原本缺少此欄位，已補上 |
| `training.js` 5 處檢查 `!== 'edit'` 舊值 | CRITICAL | 全部改為 `!== 'publish_edit'` |
| Program CRUD 13 個 endpoint 缺權限守衛 | CRITICAL | 全部加上 `canPublish(req)` 檢查 |
| `CourseEditor` activeTab 型別缺 `'share'` | MEDIUM | 加入 union type |
| `my_only=1` 只顯示自己建的課程，publish 使用者看不到被分享的 | MEDIUM | 擴充 SQL 加入 course_access 六種 grantee type 查詢 |
| DevArea 對 publish 使用者預設顯示 courses tab | LOW | 自動導向 programs tab |
| `GET /programs/:id` target label 只解析 3 種 | HIGH | 補完 dept/cost_center/division/org_group 名稱查詢 |
| 缺少 `paused_at` / `completed_at` 欄位 | LOW | addCol migration + pause/cron 寫入 |
| UserPicker 介面不匹配（`onSelect` 不存在） | CRITICAL | 改為正確的 `value/display/onChange(id,disp)` |
| GRANTEE_LABELS 硬編碼中文 | CRITICAL | 改為 `t('training.grantee.*')` + 三語言 7 key |
| 搜尋過濾大小寫敏感（與 ShareModal 不一致） | MEDIUM | 統一 `toLowerCase()` |
| `canUserAccessCourse` SQL 查 `'dept'` 但前端存 `'department'` | CRITICAL | SQL 改為 `IN ('dept','department')` 兩者匹配 |
| `/training/editor/:id` redirect 遺失 course ID | CRITICAL | 新增 `RedirectEditorId` wrapper 提取 param |
| Cron overdue 只查昨天到期，server 停機會漏發 | MEDIUM | 改為 `< TRUNC(SYSDATE)` + 去重檢查 |

### 20-9：額外修改檔案（審計修復）

| 檔案 | 變更 |
|------|------|
| `server/routes/auth.js` | SSO/login/me 三處 `effective_training_permission = 'publish_edit'` |
| `server/routes/training.js` | 權限值修正 5 處 + 權限守衛 14 處 + `my_only` 查詢擴充 + target label 7 種 + `dept`/`department` 雙匹配 |
| `server/database-oracle.js` | `paused_at` / `completed_at` 欄位 |
| `server/services/trainingCronService.js` | overdue 去重 + `completed_at` 寫入 |
| `client/src/pages/TrainingPage.tsx` | `RedirectEditorId` wrapper |
| `client/src/pages/TrainingDevArea.tsx` | publish 使用者預設 programs tab |
| `client/src/components/training/editor/CourseEditor.tsx` | activeTab 加 `'share'` |
| `client/src/components/training/editor/CourseShareTab.tsx` | UserPicker 介面修正 + i18n grantee labels + 大小寫不敏感搜尋 |
| `client/src/components/training/ProgramEditor.tsx` | UserPicker 介面修正 + i18n grantee labels + 大小寫不敏感搜尋 |
| `client/src/components/admin/UserManagement.tsx` | 介面註解更新 |
| `client/src/i18n/locales/zh-TW.json` | 新增 `training.grantee.*` 7 key |
| `client/src/i18n/locales/en.json` | 同上 |
| `client/src/i18n/locales/vi.json` | 同上 |

---

## 21. Phase 4 測試流程

### 前置準備

```bash
cd server && npm run dev    # 確認 server 啟動無錯誤，看到 [TrainingCron] Scheduled
cd client && npm run dev    # 確認前端編譯成功
```

### TC-01：權限模型驗證

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 以 ADMIN 登入 → 系統管理 → 使用者管理 | 編輯使用者看到「教育訓練權限」下拉：無權限 / 上架權限 / 上架及編輯權限 |
| 2 | 建立測試使用者 A，教育訓練權限設為「上架及編輯權限」 | 儲存成功 |
| 3 | 建立測試使用者 B，教育訓練權限設為「上架權限」 | 儲存成功 |
| 4 | 建立測試使用者 C，教育訓練權限保持「無權限」 | 儲存成功 |

### TC-02：Sidebar 入口驗證

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 以使用者 A 登入 → 更多功能選單 | 看到「教育訓練課程開發」+「訓練教室」 |
| 2 | 以使用者 B 登入 → 更多功能選單 | 看到「教育訓練課程開發」+「訓練教室」 |
| 3 | 以使用者 C 登入 → 更多功能選單 | 只看到「訓練教室」，無「教育訓練課程開發」 |

### TC-03：開發區 — 課程管理（使用者 A）

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 點「教育訓練課程開發」 | 進入開發區，看到「課程管理」和「訓練專案」兩個 tab |
| 2 | 課程管理 tab → 點「新增課程」 | 進入 CourseEditor，建立一門測試課程（標題、章節、投影片） |
| 3 | 儲存後 → 點「分享」tab | 看到分享設定面板 |
| 4 | 類型選「使用者」→ 搜尋使用者 B → 權限選「預覽」→ 新增 | 分享記錄出現在列表中 |
| 5 | 再新增一筆：類型「部門」→ 搜尋選擇 → 權限「協同開發」 | 分享記錄出現 |
| 6 | 修改權限 → 刪除分享 | 操作正常 |

### TC-04：開發區 — 課程可見性（使用者 B）

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 以使用者 B 登入 → 教育訓練課程開發 | 預設進入「訓練專案」tab（課程管理 tab 不顯示） |
| 2 | 如果有課程管理 tab → 點進去 | 看到使用者 A 分享的課程，但無「新增課程」按鈕 |

### TC-05：訓練專案建立（使用者 A 或 B）

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 訓練專案 tab → 點「新增專案」 | 進入 ProgramEditor |
| 2 | 填寫：主題「新人訓練 Q2」、目的「熟悉系統操作」 | 欄位正常 |
| 3 | 設定有效期間：今天 ~ 一個月後 | 日期選擇正常 |
| 4 | 點「新增課程」→ 選擇課程 → 勾選必修 | 課程出現在列表中 |
| 5 | 訓練對象：選「使用者」→ 搜尋使用者 C → 新增 | 對象出現 |
| 6 | 訓練對象：選「公開（全員）」→ 新增 | 對象出現（公開全員） |
| 7 | 通知設定：勾選「上架時發送通知」 | 正常 |
| 8 | 點「儲存」 | 顯示「儲存成功」 |
| 9 | 點「發布上架」→ 確認 | 顯示上架成功 + 指派人數 |

### TC-06：訓練教室（使用者 C）

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 以使用者 C 登入 → 更多功能 → 訓練教室 | 看到「新人訓練 Q2」專案卡片，進度 0% |
| 2 | 點卡片進入專案 | 看到課程列表，狀態「未開始」，有「開始學習」按鈕 |
| 3 | 點「開始學習」 | 進入 CoursePlayer 學習頁面 |
| 4 | 返回專案頁 | 該課程狀態變為「進行中」 |

### TC-07：專案生命週期

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 以使用者 A/B 進入訓練專案列表 | 看到「新人訓練 Q2」狀態為「上架中」 |
| 2 | 點暫停按鈕 | 狀態變為「已暫停」 |
| 3 | 以使用者 C 進入訓練教室 | 看不到該專案（已暫停） |
| 4 | 使用者 A/B 點恢復 | 狀態回到「上架中」 |

### TC-08：多語言驗證

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 切換語言到 English | Sidebar 顯示「Training Course Development」+「Training Classroom」 |
| 2 | 進入 ProgramEditor | 所有標籤、按鈕英文化（Training Topic, Purpose, Start Date...） |
| 3 | 進入 CourseShareTab | 分享面板英文化（Preview, Co-develop, User, Role, Department...） |
| 4 | 切換語言到 Tiếng Việt | 同上越南文驗證 |
| 5 | 使用者管理 → 教育訓練權限下拉 | 三語言選項正確 |

### TC-09：舊路由相容

| 步驟 | 操作 | 預期結果 |
|------|------|---------|
| 1 | 瀏覽器直接輸入 `/training` | 自動導向 `/training/dev`（有權限）或 `/training/classroom`（無權限） |
| 2 | 瀏覽器輸入 `/training/editor` | 自動導向 `/training/dev/courses` |
| 3 | 瀏覽器輸入 `/training/editor/123` | 自動導向 `/training/dev/courses/123` |

---

## 22. Phase 4 追加功能與修復（2026-04-07）

### 22-1：課程預覽權限控制

**功能**：CourseEditor 根據 `coursePermission`（來自 API `GET /courses/:id` 回傳的 `permission` 欄位）控制 UI 的 readonly 行為。

- `canEditThis = ['owner', 'admin', 'develop'].includes(coursePermission)`
- `isViewOnly = coursePermission === 'view'`
- Top bar：view 使用者僅顯示「預覽導覽」按鈕
- 基本資訊 tab：`pointer-events-none opacity-70`
- 章節管理 tab：標題改純文字、隱藏刪除/拖拉/新增/批次匯入
- SlideEditor：新增 `readOnly` prop → 隱藏儲存/模板/AI分析按鈕 + 內容區 CSS 鎖定（input/button/select pointer-events-none，但保留 scroll + audio/video 試聽）
- 分享/設定 tab：disabled 灰色不可點
- 成績 tab：所有人可看（自己的成績）

### 22-2：預覽導覽 + 返回路由修正

- CourseEditor header 新增「預覽導覽」按鈕 → `navigate('/training/course/:id/learn?from=editor')`
- CoursePlayer 讀取 `from=editor` → 返回到 `/training/dev/courses/:id`（避免 CourseDetail 循環）
- CourseDetail 返回改為 `navigate('/training')` 避免 Player↔Detail 無限循環

### 22-3：自動撥放模式

- CoursePlayer header 新增「▶ 自動撥放 / ⏸ 自動撥放」按鈕（learn mode only）
- 一般投影片：audio ended → 1.5s delay → goNext；無 audio → 3s delay
- Hotspot 互動投影片：HotspotBlock 新增 `autoPlay` + `onAutoPlayDone` props
  - Guided mode 自動前進每個 step：region audio ended → ✓ 動畫 800ms → next step
  - 全部 step 完成 → `onAutoPlayDone()` → CoursePlayer 1.5s → goNext
- 最後一張自動停止

### 22-4：互動完成動畫（Hotspot ✓ Checkmark）

- HotspotBlock 正確點擊後在 region 中央彈出綠色 ✓ 圓形（48px，bounce 0.6s）
- Explore mode 已發現區域顯示 32px 版本
- CSS `@keyframes checkmark-bounce { 0% scale(0) → 50% scale(1.3) → 100% scale(1) }`

### 22-5：訓練專案下架修改

- 新增 `PUT /programs/:id/deactivate`（active/paused → draft）
- ProgramEditor header「下架修改」按鈕
- 下架後可修改再重新上架

### 22-6：訓練專案協作

- `GET /programs` 所有 publish/publish_edit 使用者看到所有專案
- 不再只看自己建的

### 22-7：Auto-Enroll（自動註冊）

- Classroom `GET /classroom/my-programs` 先查 `program_targets` 匹配使用者的 active 專案
- 若無 assignment → 即時建立
- 動態條件組合避免 Oracle NULL bind 問題
- 解決 activate 後新帳號/公開專案看不到的問題

### 22-8：canUserAccessCourse 擴充

- 新增 `program_assignments` 檢查：有 assignment 且專案 active/paused → view 權限
- 解決被指派學員 `GET /courses/:id` 403 的問題

### 22-9：專案課程章節選擇

- DB：`program_courses` 新增 `lesson_ids` CLOB（JSON array，null=全部）
- Backend：POST 支援 lesson_ids；新增 PUT `/programs/:id/courses/:cid/lessons`
- ProgramEditor：課程卡片可展開 → 勾選章節（全選/個別選）
- ProgramView：帶 `lesson_ids=1,3,5` query 到 CoursePlayer
- CoursePlayer：讀取 `lesson_ids` 過濾投影片

### 22-10：關鍵修復

| Bug | 修正 |
|-----|------|
| Redis session 缺 `training_permission` | SSO+login 兩處 `setSession` 加入 |
| auth.js 三端點回傳 `'edit'` → `'publish_edit'` | 統一修正 |
| `grantee_type` dept vs department 不一致 | SQL 改 `IN ('dept','department')` |
| Oracle `SELECT DISTINCT` + CLOB → ORA-22848 | 改用子查詢 |
| UserPicker `onSelect` prop 不存在 | 改用 `value/display/onChange` |
| GRANTEE_LABELS 硬編碼中文 | 改為 `t('training.grantee.*')` |
| LOV 選取後不關閉/新增後重現 | 改用 `showDropdown` state |
| `/training/editor/:id` redirect 遺失 ID | RedirectEditorId wrapper |
| CourseDetail `navigate(-1)` 循環 | 改為 `navigate('/training')` |

### 22-11：實作檔案

**新增/修改檔案清單**：

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | 權限遷移 + paused_at/completed_at + lesson_ids |
| `server/routes/training.js` | 權限守衛 + CRUD 補完 + classroom API + auto-enroll + canUserAccessCourse 擴充 + deactivate + lesson_ids |
| `server/routes/auth.js` | Redis session 加 training_permission + effective_training_permission 三端點修正 |
| `server/services/trainingCronService.js` | **新增** — cron 自動完成+提醒+逾期 |
| `server/server.js` | 註冊 trainingCronService |
| `client/src/context/AuthContext.tsx` | canAccessTrainingDev / canPublishTraining |
| `client/src/components/Sidebar.tsx` | 兩選單 + BookOpen icon |
| `client/src/pages/TrainingPage.tsx` | 路由重組 + RedirectEditorId |
| `client/src/pages/TrainingDevArea.tsx` | **新增** — 開發區 tab 容器 |
| `client/src/pages/TrainingClassroom.tsx` | **新增** — 訓練教室首頁 |
| `client/src/components/training/ProgramList.tsx` | **新增** — 專案列表 |
| `client/src/components/training/ProgramEditor.tsx` | **新增** — 專案編輯器（含章節選擇） |
| `client/src/components/training/ProgramView.tsx` | **新增** — 學員端專案詳情 |
| `client/src/components/training/editor/CourseShareTab.tsx` | **新增** — 課程分享 tab |
| `client/src/components/training/editor/CourseEditor.tsx` | 分享 tab + 預覽權限控制 + 預覽導覽按鈕 |
| `client/src/components/training/editor/SlideEditor.tsx` | readOnly prop + READONLY 模式 |
| `client/src/components/training/CourseList.tsx` | 導航路徑 + 權限過濾 |
| `client/src/components/training/CourseDetail.tsx` | 導航修正 |
| `client/src/components/training/CoursePlayer.tsx` | 自動撥放 + from=editor 返回 + lesson_ids 過濾 |
| `client/src/components/training/blocks/HotspotBlock.tsx` | autoPlay + checkmark 動畫 |
| `client/src/components/training/SlideRenderer.tsx` | autoPlay + onAutoPlayDone 傳遞 |
| `client/src/components/admin/UserManagement.tsx` | 權限下拉 |
| `client/src/components/admin/RoleManagement.tsx` | 權限下拉 |
| `client/src/i18n/locales/zh-TW.json` | Phase 4+5 全部新增 keys |
| `client/src/i18n/locales/en.json` | 同上 |
| `client/src/i18n/locales/vi.json` | 同上 |

---

## 23. Phase 5A–5H：專案計分 + 學習追蹤 + 成績報表（2026-04-07）

> 設計文件：[training-scoring-design.md](training-scoring-design.md)

### 23-1：Phase 5A — DB 基礎

| 項目 | 說明 |
|------|------|
| `user_slide_views` 表 | 投影片瀏覽追蹤（user_id + slide_id + program_id UNIQUE） |
| `program_courses.exam_config` | CLOB — 覆蓋課程測驗設定（佔分/及格/時間/重考/章節配分） |
| `training_programs.program_pass_score` | 專案及格分數（預設 60） |
| `training_programs.sequential_lessons` | 章節鎖定開關 |

### 23-2：Phase 5B — 投影片瀏覽追蹤

CoursePlayer 切換投影片時 POST `/slides/:id/view`（含 duration），互動完成時 PUT `/slides/:id/view/done`。

### 23-3：Phase 5C — ProgramEditor 配分 UI

課程卡片新增：佔分、每章節配分（lesson_weights）、及格%、時間限制、重考次數。專案設定新增：及格分數、依序學習開關。

### 23-4：Phase 5D — Backend 成績 API

- `GET /classroom/programs/:id/my-scores` — 學員成績+導覽進度
- `GET /programs/:id/report` — 管理者報表
- `GET /programs/:id/report/export` — Excel 匯出

### 23-5：Phase 5E — ProgramScorePanel 學員成績面板

ProgramView 新增「成績與進度」tab。顯示每課程導覽進度 + 測驗 best score + 考試歷史 + 專案總分（雙重及格制）。

### 23-6：Phase 5F+5G — ProgramReport 管理者報表 + Excel 匯出

ProgramEditor 新增「成績報表」tab。摘要 + 使用者表格 + 展開詳細 + 匯出 Excel。

### 23-7：Phase 5H — 章節鎖定

`sequential_lessons = 1` 時，`GET /classroom/programs/:id` 回傳 `lesson_status`（per-lesson done/locked）。ProgramView 顯示鎖頭+提示，CoursePlayer 只載入已解鎖章節。

### 23-8：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | `user_slide_views` 表 + `exam_config` + `program_pass_score` + `sequential_lessons` |
| `server/routes/training.js` | slide view API + my-scores + report + export + 章節鎖定邏輯 |
| `client/src/components/training/CoursePlayer.tsx` | 瀏覽追蹤 + interaction_done |
| `client/src/components/training/ProgramEditor.tsx` | 配分 UI + 報表 tab |
| `client/src/components/training/ProgramView.tsx` | 成績 tab + 章節鎖定 UI |
| `client/src/components/training/ProgramScorePanel.tsx` | **新增** — 學員成績面板 |
| `client/src/components/training/ProgramReport.tsx` | **新增** — 管理者報表 |
| `client/src/i18n/locales/*.json` | scoring + report + locked keys |

---

## 24. Phase 5 追加修復與封存功能（2026-04-07）

### 24-1：完成判斷改為導覽+測驗雙條件

Classroom my-programs 的進度計算不再依賴 `program_assignments.status`，改為即時查詢每門課程的：
- 導覽完成度（slide views vs total slides）
- 測驗最佳成績（best session score vs pass_score）

兩者都達標才算該課程「完成」。

### 24-2：返回路由修正

- CoursePlayer：帶 `program_id` 時返回 ProgramView
- CourseDetail：帶 `program_id` 時返回 ProgramView
- 解決 Player↔Detail 無限循環

### 24-3：ProgramView 卡片式重寫

課程 tab 從條列改為卡片式（封面+章節列表+測驗主題+按鈕）。Backend 回傳 `lesson_status` + `exam_topics`。

### 24-4：專案測驗設定覆蓋課程設定

`GET /training/program-exam-config` API + CoursePlayer 優先使用 program exam_config。

### 24-5：考試歷史每題明細

Backend 回傳 per-slide 的 `score_breakdown` + `action_log`。ProgramScorePanel 可展開每題分數條+錯誤原因。

### 24-6：課程+專案封存/解封

| 項目 | 說明 |
|------|------|
| 課程封存 | `POST /courses/:id/archive` + `/unarchive` |
| 專案封存 | `PUT /programs/:id/archive` + `/unarchive` |
| 預設隱藏 | CourseList + ProgramList + GET /programs 排除 archived |
| 篩選顯示 | 狀態下拉新增「已封存」|
| 建立日期 | CourseList 卡片 + ProgramList 列表 |
| 建立者 | ProgramList 列表顯示 creator_name |

### 24-7：其他修復

| 問題 | 修正 |
|------|------|
| exam_config 存檔後消失 | GET /programs/:id SELECT 補回 pc.exam_config + JSON parse |
| UserPicker 403 | 新增 GET /training/users-list + UserPicker apiUrl prop |
| progress NULL lesson_id | IS NULL 查詢 |
| exam history slides 被丟棄 | map 補回 h.slides |
| 練習測驗按鈕缺失 | 移除 exam_topics 條件 |

### 24-8：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/routes/training.js` | program-exam-config + archive/unarchive + users-list + exam slides + 進度計算 |
| `client/src/components/training/CoursePlayer.tsx` | programExamConfig + 返回路由 |
| `client/src/components/training/CourseDetail.tsx` | program_id 返回 |
| `client/src/components/training/ProgramView.tsx` | 卡片式+章節+測驗主題 |
| `client/src/components/training/ProgramScorePanel.tsx` | 每題明細展開 |
| `client/src/components/training/ProgramList.tsx` | 封存+建立者/日期 |
| `client/src/components/training/CourseList.tsx` | 封存+建立日期 |
| `client/src/components/training/ProgramEditor.tsx` | handleSave 補存 exam_config |
| `client/src/components/common/UserPicker.tsx` | apiUrl prop |
| `client/src/i18n/locales/*.json` | scoring detail + archive keys |

---

## 25. 2026-04-07 Session 追加功能

### 25-1：無互動章節瀏覽完成即得分

有 `lesson_weights` 時，無互動章節分數 = 瀏覽完成度 × 章節配分。純閱讀課程瀏覽 100% 自動及格。同步到 my-scores / report / export。

### 25-2：Hotspot demo 展示模式

新增 `interaction_mode: 'demo'`。自動依序高亮+播語音，不需互動。async/await 循序播放，獨立 Audio 物件避免衝突。AI 生成旁白偵測 demo 模式使用解說語氣。

### 25-3：課程章節拖拉排序

CourseEditor 章節列表加 HTML5 drag & drop。

### 25-4：預覽導覽可選擇章節

「預覽導覽」改為 click 下拉選單，支援全部章節或指定章節。

### 25-5：翻譯可選擇特定章節

POST /courses/:id/translate 支援 lesson_ids 過濾。翻譯 tab 新增章節勾選 UI。

### 25-6：TTS 英文縮寫發音修正

preprocessTtsText() 修正 AI/API/MCP/ERP/GPT 等發音。

### 25-7：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/routes/training.js` | 無互動計分 + demo AI prompt + TTS preprocessor + translate lesson_ids + users-list + reorder |
| `client/src/components/training/blocks/HotspotBlock.tsx` | demo mode async 播放 + currentTarget + 右側面板解說 |
| `client/src/components/training/editor/blocks/HotspotEditor.tsx` | demo 模式按鈕 + AI 覆蓋 feedback |
| `client/src/components/training/editor/CourseEditor.tsx` | 章節拖拉 + 預覽選章節 + 翻譯選章節 |
| `client/src/components/training/CoursePlayer.tsx` | lessonId query 傳入 |
| `client/src/i18n/locales/*.json` | demoStep + translateChapters + previewAll keys |

---

## 26. Phase 5D — 章節測驗成績追蹤（Lesson Quiz Results）

### 26-1：需求

使用手冊章節可連結互動教學（linked_course_id + linked_lesson_id），測驗完成後需以**章節（lesson）**為最小單位記錄通過狀態。使用手冊和訓練教室兩邊通過任一即算通過。管理者需報表查看各章節各同仁完成情況。

### 26-2：DB — LESSON_QUIZ_RESULTS

新增 `lesson_quiz_results` 表於 `database-oracle.js`：

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | NUMBER PK | 自增 |
| user_id | NUMBER | 使用者 |
| course_id | NUMBER | 課程 |
| lesson_id | NUMBER | 章節 |
| source | VARCHAR2(20) | `'help'` 或 `'classroom'` |
| session_id | VARCHAR2(36) | 對應 INTERACTION_RESULTS |
| score | NUMBER | 得分 |
| max_score | NUMBER | 滿分 |
| passed | NUMBER(1) | 是否通過 |
| completed_at | TIMESTAMP | 完成時間 |

UNIQUE 約束：`(user_id, course_id, lesson_id, session_id)`

通過判定：`(score / max_score) × 100 >= course.pass_score`

### 26-3：API 端點

**POST `/training/lesson-quiz-result`**
- 接收 `course_id, lesson_id, session_id, score, max_score, source`
- 自動查 `courses.pass_score` 判定通過
- Upsert 邏輯：同一 user+course+lesson+session 存在則 UPDATE
- Oracle NULL 處理：`session_id IS NULL` 分支查詢

**GET `/training/lesson-completion-report?course_id=`**
- Admin 權限（`role=admin` 或 `publish_edit`）
- 查所有 lesson，計算每個 lesson 的通過/未通過/未作答人數
- 目標人員：公開課程 → 全員，非公開 → `PROGRAM_ASSIGNMENTS` 指派者
- 回傳含每位使用者狀態、最高分、完成時間的 userDetails

**GET `/training/help-completion-report`**
- Admin 權限
- 查所有 `linked_course_id IS NOT NULL` 的 help_sections
- 多語言 title 查詢（COALESCE fallback zh-TW）
- 按各 section 的 linked_lesson_id 查 lesson_quiz_results
- 回傳與 lesson-completion-report 相同結構的 sectionReport

### 26-4：CoursePlayer 寫入邏輯

`finishExam()` 修改：
1. 測驗結束後，將 `examResults` 按 `slide.lesson_id` 分組
2. 每個 lesson 彙總 `weightedScore` / `weightedMax`
3. 未完成的 slides 補 max（score=0）
4. 每個 lesson 呼叫 `POST /training/lesson-quiz-result`
5. `source` 判定：`skipAccessCheck ? 'help' : 'classroom'`

HelpTrainingPlayer 不需額外修改 — 它傳 `skipAccessCheck=true` 給 CoursePlayerInner，finishExam 自動處理。

### 26-5：Admin 報表 UI

TrainingAdmin 元件新增兩個 tab：

| Tab | 功能 |
|-----|------|
| 章節完成率 | 選課程 → 列 lesson 通過率 → 展開看每人狀態 |
| 使用手冊完成率 | 列有連結互動教學的 help sections → 通過率 → 展開看每人狀態 |

UI 元素：
- 通過率進度條（綠 ≥80% / 橙 ≥50% / 紅 <50%）
- 狀態 badge（✅通過 / ❌未通過 / ⬜未作答）
- 展開顯示：姓名、工號、最高分、完成時間

### 26-6：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | 新增 `LESSON_QUIZ_RESULTS` 建表 |
| `server/routes/training.js` | 新增 3 個 API（lesson-quiz-result, lesson-completion-report, help-completion-report） |
| `client/src/components/training/CoursePlayer.tsx` | `finishExam()` 按 lesson 分組寫入成績 |
| `client/src/components/admin/TrainingAdmin.tsx` | 新增「章節完成率」「使用手冊完成率」兩個 tab |

---

## 27. Phase 3B-8 — 多語底圖編輯器增強（2026-04-08）

> 設計文件：[training-platform-design.md §8.7](training-platform-design.md)

### 27-1：需求背景

投影片的外語底圖管理需要更便利的操作方式：
1. 在 Modal 大圖編輯模式下可直接**拖拉檔案**或**剪貼簿貼上**抽換底圖
2. 支援**併排合成**——將兩張圖片（如主語言截圖 + 外語翻譯截圖）水平/垂直合成為一張底稿

### 27-2：Modal Drag & Drop 抽換底圖

| 項目 | 狀態 | 說明 |
|------|------|------|
| Modal 拖拉上傳 | ✅ 完成 | 圖片區域 `onDragOver` / `onDrop` 接收檔案，直接呼叫 `handleUpload` |
| 拖拉視覺回饋 | ✅ 完成 | `dragOverModal` state 控制藍色虛線 overlay + 「放開以抽換底圖」提示 |
| `onDragLeave` 防閃爍 | ✅ 完成 | `e.currentTarget.contains(e.relatedTarget)` 過濾子元素觸發的 leave |
| 剪貼簿貼上 | ✅ 完成 | `document.addEventListener('paste')` 在 Modal 開啟時偵測 `image/*` MIME |
| 底部操作提示 | ✅ 完成 | Footer 顯示「💡 拖拉圖片到畫面上 或 Ctrl+V 貼上剪貼簿圖片 可直接抽換底圖」 |

### 27-3：併排合成（Side-by-Side Composite）

| 項目 | 狀態 | 說明 |
|------|------|------|
| Composite Dialog UI | ✅ 完成 | 全螢幕覆蓋（z-10000），圓角深色面板，Header + Body + Footer 三段式 |
| 圖片 Slot A/B | ✅ 完成 | 兩個 drop zone，各自支援拖拉/點擊/剪貼簿三種輸入方式 |
| 左圖預填 | ✅ 完成 | 開啟 dialog 時自動載入目前語言底圖（或主語言圖）作為 Slot A |
| 排列方向切換 | ✅ 完成 | `horizontal`（左右並排）/ `vertical`（上下並排），按鈕高亮 active 狀態 |
| 間距調整 | ✅ 完成 | 0px / 4px / 8px / 16px 四段可選 |
| Canvas 合成引擎 | ✅ 完成 | `generateComposite()` — 等高/等寬縮放 + 白底填充 + `canvas.toDataURL('image/png')` |
| 即時預覽 | ✅ 完成 | 「預覽合成」按鈕渲染 Canvas 結果顯示於 dialog 底部 |
| 確認上傳 | ✅ 完成 | `confirmComposite()` — `toBlob()` → `new File()` → 複用 `handleUpload()` |
| Paste 智慧路由 | ✅ 完成 | compositeOpen 時 paste 自動填入空的 slot（右優先）；否則直接抽換底圖 |
| 警告提示 | ✅ 完成 | Footer 提示「合成後會替換底圖，既有互動區域座標可能需要重新調整」 |

### 27-4：技術細節

**Canvas 合成邏輯**：
```
水平併排：
  targetH = min(imgL.height, imgR.height)  // 等高基準
  scaleL = targetH / imgL.height
  scaleR = targetH / imgR.height
  canvas.width = wL + gap + wR
  canvas.height = targetH

垂直併排：
  targetW = min(imgL.width, imgR.width)    // 等寬基準
  scaleL = targetW / imgL.width
  scaleR = targetW / imgR.width
  canvas.width = targetW
  canvas.height = hL + gap + hR
```

**跨域圖片處理**：`img.crossOrigin = 'anonymous'` 確保 server 圖片可被 Canvas 繪製。

**State 管理**：11 個新增 state（compositeOpen, compLeft, compRight, compDirection, compGap, compPreview, compUploading, dragOverPreview, dragOverModal + 2 refs），全部在 LanguageImagePanel 內部管理。

### 27-5：新增 lucide-react icons

| Icon | 用途 |
|------|------|
| `ImagePlus` | 「抽換底圖」按鈕 |
| `Columns` | 「併排合成」按鈕 + dialog header |
| `Rows` | 「上下並排」選項 |
| `Eye` | 「預覽合成」按鈕 |

### 27-6：實作檔案

| 檔案 | 變更 |
|------|------|
| `client/src/components/training/editor/blocks/LanguageImagePanel.tsx` | 新增 Modal drag & drop + Composite Dialog（+250 行） |
| `docs/training-platform-design.md` | 新增 §8.7 多語底圖編輯器設計規格 |
| `docs/training-platform-implementation.md` | 新增本節（§27） |

### 27-7：Bug Fix — lang-image 上傳 401 / 路徑錯誤

| 項目 | 狀態 | 說明 |
|------|------|------|
| 根因分析 | ✅ 完成 | multer destination 使用 `req.params.id`，但 `/slides/:sid/lang-image` 只有 `:sid` → 解析為 `undefined` → 存到 `course_tmp/` |
| fs.renameSync 修正 | ✅ 完成 | 上傳後查詢 slide → lesson → course 取得 courseId，再 `fs.renameSync` 移動到 `course_{courseId}/` |
| 目錄自動建立 | ✅ 完成 | `fs.mkdirSync(targetDir, { recursive: true })` 確保目標目錄存在 |

**修改檔案**：`server/routes/training.js`（lang-image upload endpoint）

### 27-8：CourseEditor 預覽語言選擇

| 項目 | 狀態 | 說明 |
|------|------|------|
| 語言分組下拉選單 | ✅ 完成 | Preview 按鈕下拉選單改為三個語言區塊（🇹🇼 繁體中文 / 🇺🇸 English / 🇻🇳 Tiếng Việt） |
| 各語言章節列表 | ✅ 完成 | 每個語言區塊下顯示「全部章節」+ 各章節名稱，點擊後帶 `?lang=` 參數開啟 Player |
| 傳遞 lang 參數 | ✅ 完成 | 點擊預覽項目時 URL 帶入 `?lang=zh-TW` / `?lang=en` / `?lang=vi`，Player 依此載入對應翻譯 |

**修改檔案**：`client/src/components/training/editor/CourseEditor.tsx`

### 27-9：Server 合併邏輯修正（regions_json 優先）

| 項目 | 狀態 | 說明 |
|------|------|------|
| 問題 | — | 讀取翻譯投影片時，content_json 中的 regions 會覆蓋 regions_json 獨立編輯的欄位（narration、feedback 等） |
| 修正邏輯 | ✅ 完成 | `regions_json` 為 source of truth；只在 regions_json 中 narration/feedback/test_hint/explore_desc 為空時，才從 content_json 對應欄位補值 |
| 影響範圍 | — | `GET /api/training/slides/:id?lang=` 的 merge 邏輯（training.js ~line 1015） |

**修改檔案**：`server/routes/training.js`（slide GET endpoint merge 邏輯）

### 27-10：翻譯 API 支援 regions_json

| 項目 | 狀態 | 說明 |
|------|------|------|
| regions_json 翻譯 | ✅ 完成 | translate endpoint 新增步驟：若投影片有 regions_json，額外呼叫 LLM 翻譯整個 JSON |
| 翻譯欄位 | ✅ 完成 | label、narration、feedback、test_hint、explore_desc、intro narrations |
| 儲存位置 | ✅ 完成 | 翻譯結果存入 `slide_translations.regions_json` 欄位 |
| 單次 LLM 呼叫 | ✅ 完成 | 整個 regions_json 作為一個 JSON 丟給 LLM 翻譯，避免多次 API call |

**修改檔案**：`server/routes/training.js`（translate endpoint）

### 27-11：Player 區域標籤移除

| 項目 | 狀態 | 說明 |
|------|------|------|
| 移除區域文字標籤 | ✅ 完成 | HotspotBlock 不再在互動區域上方顯示 label 文字，改為僅在當前目標區域顯示步驟數字 badge |
| 移除 hover tooltip | ✅ 完成 | 區域 hover 時不再顯示 tooltip 文字，避免在測驗模式洩漏提示 |
| 視覺簡化 | ✅ 完成 | 學習模式下靠步驟 badge（如 ①②③）引導，測驗模式下區域完全隱藏 |

**修改檔案**：`client/src/components/training/blocks/HotspotBlock.tsx`

### 27-12：實作檔案總覽（追加）

| 檔案 | 變更 |
|------|------|
| `server/routes/training.js` | lang-image 路徑修正 + merge 邏輯修正 + translate regions_json |
| `client/src/components/training/editor/CourseEditor.tsx` | 預覽下拉選單三語言分組 |
| `client/src/components/training/blocks/HotspotBlock.tsx` | 移除區域 label 文字和 hover tooltip |
| `docs/training-platform-design.md` | 新增 §8.7.7–8.7.9 設計補充 |
| `docs/training-platform-implementation.md` | 新增 §27-7 至 §27-12 |

## 28. Phase 3B-9 — 翻譯效能優化 + 獨立區域翻譯 Seed 工作流（2026-04-12）

### 28-1：翻譯效能優化

| 項目 | 狀態 | 說明 |
|------|------|------|
| Slide Batching | ✅ 完成 | 5 張 slide 打包成一次 LLM call，content+notes+regions 合併 payload |
| CONCURRENCY 提升 | ✅ 完成 | 3 → 10，slides + quiz 共用 limiter 同時並行 |
| Batch 失敗 Fallback | ✅ 完成 | JSON parse 或長度不符 → 整批退回逐張重試，Map<id> 校驗順序 |
| extractSlideResult 防護 | ✅ 完成 | 對缺欄位 throw → 避免 partial response 誤清既有翻譯 |
| regions_json source | ✅ 完成 | 改讀 `slide_translations WHERE lang='zh-TW'`（master），full overwrite |
| Model fallback 統一 | ✅ 完成 | 全檔 7 處改用 `env GEMINI_MODEL_FLASH \|\| 'gemini-3-flash-preview'` |
| Quiz Batching | ✅ 完成 | 5 題/call，同樣有 batch+single fallback |
| TTS 改 SSE | ✅ 完成 | `generate-lang-tts` 改 SSE streaming，pLimit(10) 並行 |
| TTS Phase 設計 | ✅ 完成 | Phase 1 preload task list → Phase 2 pLimit(10) → Phase 3 flush DB |
| Recording 並行化 | ✅ 完成 | Worker pool concurrency=5，timeout 30s → 60s |
| pLimit 共用工具 | ✅ 完成 | training.js 頂層 `function pLimit(n)` |

### 28-2：獨立區域翻譯 Seed（LanguageImagePanel 核心修正）

| 項目 | 狀態 | 說明 |
|------|------|------|
| `GET /lang-regions` 擴充 | ✅ 完成 | 回傳新增 `_translated` 欄位：從 content_json 解析 hotspot regions + intro + translated_at |
| `createIndependentRegions` 改寫 | ✅ 完成 | 優先從翻譯結果 seed（text + audio_url），fallback 到 zh-TW |
| Inherit 顯示翻譯文字 | ✅ 完成 | `getDisplayRegions()` 在 inherit 模式下返回翻譯 regions 而非 zh-TW |
| Inherit 唯讀語音預覽 | ✅ 完成 | 翻譯 intro + per-region narration 文字 + audio player（唯讀） |
| 按鈕文字動態 | ✅ 完成 | 有翻譯「(使用翻譯結果)」/ 無翻譯「(從主語言複製)」 |
| Auto-promote 修正 | ✅ 完成 | 拖拉觸發 auto-promote 也走翻譯 seed（同一 function） |
| Intro seed | ✅ 完成 | slide_narration / _test / _explore + audio + completion_message 全帶 |
| 翻譯時間戳 | ✅ 完成 | `_translated_at` 顯示在提示文字旁 |

### 28-3：語言 Tab Badge + 語音模式切換

| 項目 | 狀態 | 說明 |
|------|------|------|
| Status Badge | ✅ 完成 | ✓(有翻譯) ★(有獨立區域) 🔊(有語音) 在語言 tab 按鈕上 |
| Voice Mode Tabs | ✅ 完成 | [全部][🎯 導引][📝 測驗][🔍 探索] 過濾 intro + per-region 欄位 |

### 28-4：從翻譯結果同步（Re-seed）

| 項目 | 狀態 | 說明 |
|------|------|------|
| `POST /slides/:sid/reseed-lang-regions` | ✅ 完成 | id-match merge: keep coords, sync text+audio from content_json |
| 前端按鈕 | ✅ 完成 | 獨立區域 header「🔄 從翻譯結果同步」，confirm 後呼叫 API |

### 28-5：翻譯/TTS 自動同步獨立區域

| 項目 | 狀態 | 說明 |
|------|------|------|
| Translate `sync_regions` flag | ✅ 完成 | 翻譯完後自動 sync 所有已有 regions_json 的 slide |
| TTS `sync_regions_audio` flag | ✅ 完成 | TTS 完後自動 sync audio URL 到 regions_json |
| CourseEditor Checkboxes | ✅ 完成 | 兩個 checkbox（預設勾選），在翻譯 tab 的 sync 區塊 |

### 28-6：Bulk Re-seed

| 項目 | 狀態 | 說明 |
|------|------|------|
| `POST /courses/:id/reseed-all-lang-regions` | ✅ 完成 | SSE endpoint，遍歷全課程 slides，sync text+audio |
| 前端按鈕 | ✅ 完成 | 翻譯 tab「🔄 同步所有獨立區域」紫色按鈕，SSE 進度 + alert |

### 28-7：Modal 語音預覽 + 整體座標調整

| 項目 | 狀態 | 說明 |
|------|------|------|
| 點擊播放語音 | ✅ 完成 | Region click → auto-play audio_url via hidden `<audio>` ref |
| Narration Tooltip | ✅ 完成 | Hover 顯示 label + narration 前 80 字 |
| 整體座標調整 | ✅ 完成 | X偏移/Y偏移(%) + 縮放(%) → 套用按鈕一次性 apply |

### 28-8：Diff 模式

| 項目 | 狀態 | 說明 |
|------|------|------|
| Diff Toggle | ✅ 完成 | 「📊 Diff 模式」button，展開/收合 |
| Side-by-side | ✅ 完成 | 左：zh-TW 主語言 / 右：翻譯或獨立區域 |
| Per-region 比較 | ✅ 完成 | narration / test_hint / explore_desc / feedback 四欄位 |
| 視覺標記 | ✅ 完成 | 有翻譯=綠底，未翻譯=紅底「未翻譯」 |

### 28-9：實作檔案

| 檔案 | 變更 |
|------|------|
| `server/routes/training.js` | pLimit 工具、translate batching+concurrency、TTS SSE+pLimit(10)、recording worker pool、model fallback 統一、`GET /lang-regions` 擴充 `_translated`、`POST /reseed-lang-regions`、`POST /reseed-all-lang-regions`、translate `sync_regions`、TTS `sync_regions_audio` |
| `client/src/components/training/editor/blocks/LanguageImagePanel.tsx` | translatedBlocks state、createIndependentRegions 翻譯 seed、getDisplayRegions inherit 翻譯、唯讀語音預覽、status badge、voice mode tabs、re-seed 按鈕、modal audio preview + coords transform、diff mode、timestamps |
| `client/src/components/training/editor/CourseEditor.tsx` | TTS SSE consumer、sync checkboxes、bulk re-seed 按鈕 |
| `client/src/components/training/editor/recordingpanel.tsx` | Worker pool concurrency=5, timeout 60s |
| `docs/training-platform-design.md` | §8.7.10 翻譯效能優化 + 獨立區域翻譯 Seed 工作流 |
| `docs/training-platform-implementation.md` | §28 Phase 3B-9 |
