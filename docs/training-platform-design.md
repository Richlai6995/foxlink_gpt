# FOXLINK GPT 教育訓練平台 設計文件

> 日期：2026-04-01
> 狀態：設計討論中
> 整合至：FOXLINK GPT 現有系統（共用 auth/user/admin）

---

## 1. 專案概述

### 1.1 目標

開發一套 Web-based 互動教學平台，整合至現有 FOXLINK GPT 系統，取代目前以影片為主、缺乏互動性且修改成本高的教育訓練方式。

### 1.2 核心能力

| 能力 | 說明 |
|------|------|
| **互動教材製作** | Block-based 編輯器，支援熱點、拖放、翻轉卡片、分支情境等互動元件 |
| **多模式教學** | 截圖模擬 + 影片嵌入 + 互動投影片，三種模式可混用 |
| **音訊輔助** | TTS 語音旁白（Google Cloud TTS）、STT 語音輸入創作、麥克風錄音 |
| **測驗評量** | 多題型測驗、計分、及格門檻、重測限制、答案解析 |
| **進度追蹤** | 學習進度記錄、課程指派、到期管理 |
| **權限分享** | view/develop 雙層權限，多維度分享（對齊現有 skill_access 架構） |

### 1.3 與 Adobe Captivate 的定位差異

Adobe Captivate 是桌面端創作工具，產出靜態 HTML5 包。本系統是**全 Web 平台**（創作 + 播放 + 測驗 + LMS），更接近 Articulate Rise + LMS 的組合，但深度整合至企業內部系統。

---

## 2. 權限與角色模型

### 2.1 使用者權限

```sql
-- 在 users 表新增欄位
ALTER TABLE users ADD COLUMN can_edit_courses NUMBER(1) DEFAULT 0;
```

- `can_edit_courses = 1`：可**建立新課程**
- 被分享 `develop` 權限的使用者不需要此 flag（只能編輯被分享的課程）

### 2.2 權限層級

| 身份 | 可執行操作 |
|------|-----------|
| **建立者 (owner)** | 完全控制：編輯、刪除、分享、發佈、指派 |
| **develop 權限** | 編輯教材內容、管理題目、指派課程 |
| **view 權限** | 學習、測驗、查看自己成績 |
| **公開課程 (is_public=1)** | 所有人可 view |
| **Admin** | 全域管理、查看所有報表 |

### 2.3 分享模型（對齊 skill_access）

```
course_access 表
├── grantee_type: user | role | dept | profit_center | org_section | org_group
├── grantee_id: 對應 ID
├── permission: 'view' | 'develop'    ← 新增（skill_access 目前無此欄位）
└── granted_by: users.id
```

### 2.4 課程可見性

```
建立者 (owner) → 預設私人 (draft)
                → 發佈後選擇：
                   ├── 公開（所有人可學習）
                   ├── 指定部門
                   ├── 指定使用者
                   ├── 指定角色
                   └── 指定組織（profit_center / org_section / org_group）
```

### 2.5 獨立頁面

教育訓練平台為獨立畫面（`/training`），不掛在 admin 管理權限下。編輯者不一定是 admin，使用權限透過分享設定或公開機制控制。

---

## 3. 技術架構

### 3.1 系統架構圖

```
┌─────────────────────────────────────────────────────┐
│                   Client (React/Vite)                │
├───────────┬───────────┬───────────┬─────────────────┤
│ Authoring │  Player   │   Quiz    │  Admin/LMS      │
│  Editor   │ (Viewer)  │  Engine   │  Dashboard      │
├───────────┴───────────┴───────────┴─────────────────┤
│  fabricjs  │ dnd-kit  │ Web Speech API │ react-router │
└────────────────────────┬────────────────────────────┘
                         │ REST API
┌────────────────────────┴────────────────────────────┐
│                 Server (Express)                     │
├───────────┬───────────┬───────────┬─────────────────┤
│ training  │ lessons   │   quiz    │   progress      │
│ routes    │ routes    │  routes   │   routes         │
├───────────┴───────────┴───────────┴─────────────────┤
│  Google Cloud TTS │ Gemini STT │ File Storage       │
└────────────────────────┬────────────────────────────┘
                         │
                     Oracle DB
```

### 3.2 關鍵技術選型

| 需求 | 技術方案 | 說明 |
|------|---------|------|
| 熱點編輯器 | **fabricjs** | Canvas 套件，在截圖上畫矩形/圓形標記互動區域 |
| 拖放互動 | **dnd-kit** | React 拖放套件，輕量且靈活 |
| 翻轉卡片 | CSS 3D Transform | 純 CSS 實現，無需額外套件 |
| 分支流程 | **reactflow**（Phase 2） | 節點式流程編輯器 |
| 投影片播放 | 自製 Renderer | 類似 reveal.js 但客製化 |
| TTS 語音旁白 | 現有 `/api/skills/tts/synthesize` | Google Cloud TTS, cmn-TW-Wavenet-A |
| STT 語音輸入 | 現有 Gemini 語音轉錄 | 已有功能直接複用 |
| 麥克風錄音 | MediaRecorder API | 瀏覽器原生 API |
| 影片播放 | HTML5 Video | 支援上傳 MP4 + URL 嵌入 |

### 3.3 TTS 整合方式

直接呼叫現有 TTS skill endpoint：

```js
// 教材編輯器中，輸入旁白文字 → 點「生成語音」
POST /api/skills/tts/synthesize
{
  text: "請點擊左上角的新增按鈕",
  language: "zh-TW",
  voice: "cmn-TW-Wavenet-A",   // 可選聲音
  speakingRate: 1.0
}
// 回傳 MP3 檔案 URL → 存到 slide.audio_url
```

每個投影片可以：
- 手動上傳音訊檔
- 用 TTS 從旁白文字自動生成
- 用麥克風錄音（MediaRecorder API）

---

## 4. 資料模型

### 4.1 ER 關係概覽

```
course_categories (樹狀分類，最多 3 層)
    └── courses (課程主檔)
            ├── lessons (章節，有序)
            │       ├── slides (投影片，block-based 內容)
            │       │       ├── slide audio (TTS/錄音/上傳)
            │       │       └── branch_nodes (分支節點)
            │       └── video_interactions (影片互動節點)
            ├── quiz_questions (題庫)
            ├── quiz_attempts (測驗結果)
            ├── course_access (分享權限)
            ├── course_assignments (指派)
            └── user_progress (學習進度)
```

### 4.2 完整表結構

```sql
-- ============================================================
-- 自訂分類（樹狀，最多 3 層）
-- ============================================================
CREATE TABLE course_categories (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    parent_id       NUMBER REFERENCES course_categories(id) ON DELETE SET NULL,
    name            NVARCHAR2(200) NOT NULL,
    sort_order      NUMBER DEFAULT 0,
    created_by      NUMBER REFERENCES users(id),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- 課程主檔
-- ============================================================
CREATE TABLE courses (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    title           NVARCHAR2(500) NOT NULL,
    description     NCLOB,
    cover_image     VARCHAR2(500),           -- 封面圖片路徑
    category_id     NUMBER REFERENCES course_categories(id) ON DELETE SET NULL,
    created_by      NUMBER REFERENCES users(id),   -- owner
    status          VARCHAR2(20) DEFAULT 'draft',   -- draft | published | archived
    is_public       NUMBER(1) DEFAULT 0,            -- 0=私密, 1=公開
    pass_score      NUMBER DEFAULT 60,              -- 及格分數 (0-100)
    max_attempts    NUMBER,                         -- 測驗最大次數, NULL=無限
    time_limit_minutes NUMBER,                      -- 測驗限時, NULL=不限時
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- 章節
-- ============================================================
CREATE TABLE course_lessons (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title           NVARCHAR2(500) NOT NULL,
    sort_order      NUMBER DEFAULT 0,
    lesson_type     VARCHAR2(20) DEFAULT 'slides',  -- slides | video | simulation | iframe_guide
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- 投影片（Block-based 內容）
-- ============================================================
CREATE TABLE course_slides (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    lesson_id       NUMBER NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    sort_order      NUMBER DEFAULT 0,
    slide_type      VARCHAR2(30) DEFAULT 'content',
    -- content | hotspot | dragdrop | flipcard | branch | quiz_inline
    content_json    NCLOB,                  -- block 陣列 JSON
    audio_url       VARCHAR2(500),          -- TTS 或上傳的語音檔路徑
    notes           NCLOB,                  -- 編輯者旁白文字（TTS 來源）
    duration_seconds NUMBER,                -- 建議停留秒數
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- 影片互動節點
-- ============================================================
CREATE TABLE video_interactions (
    id                  NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    lesson_id           NUMBER NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    timestamp_seconds   NUMBER NOT NULL,            -- 暫停時間點（秒）
    interaction_type    VARCHAR2(20) NOT NULL,       -- quiz | hotspot | branch
    content_json        NCLOB NOT NULL,              -- 互動內容 JSON
    must_answer         NUMBER(1) DEFAULT 1,         -- 必須回答才能繼續
    pause_video         NUMBER(1) DEFAULT 1,         -- 是否暫停影片
    sort_order          NUMBER DEFAULT 0,
    created_at          TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- 分支節點
-- ============================================================
CREATE TABLE slide_branches (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    slide_id        NUMBER NOT NULL REFERENCES course_slides(id) ON DELETE CASCADE,
    option_text     NVARCHAR2(500) NOT NULL,         -- 選項文字
    option_index    NUMBER DEFAULT 0,                -- 選項順序
    target_slide_id NUMBER REFERENCES course_slides(id) ON DELETE SET NULL,
    target_lesson_id NUMBER REFERENCES course_lessons(id) ON DELETE SET NULL,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- iframe 導引步驟（Phase 2）
-- ============================================================
CREATE TABLE iframe_guide_steps (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    lesson_id       NUMBER NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    sort_order      NUMBER DEFAULT 0,
    target_url      VARCHAR2(1000) NOT NULL,         -- iframe 載入的 URL
    instruction_text NCLOB,                          -- 指引文字
    target_selector VARCHAR2(500),                   -- CSS selector（要高亮的元素）
    expected_action VARCHAR2(20),                    -- click | input | navigate
    expected_value  NVARCHAR2(500),                  -- 預期輸入值或目標 URL
    audio_url       VARCHAR2(500),
    hint_text       NCLOB,                           -- 提示文字
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- 題庫
-- ============================================================
CREATE TABLE quiz_questions (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    question_type   VARCHAR2(30) NOT NULL,
    -- single_choice | multi_choice | fill_blank | matching | ordering | hotspot_click
    question_json   NCLOB NOT NULL,                  -- 題目內容（含圖片、選項等）
    answer_json     NCLOB NOT NULL,                  -- 正確答案
    points          NUMBER DEFAULT 10,               -- 配分
    explanation     NCLOB,                           -- 答案解析
    sort_order      NUMBER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- ============================================================
-- 測驗結果
-- ============================================================
CREATE TABLE quiz_attempts (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id         NUMBER NOT NULL REFERENCES users(id),
    score           NUMBER,                          -- 得分
    total_points    NUMBER,                          -- 總分
    passed          NUMBER(1) DEFAULT 0,             -- 是否及格
    answers_json    NCLOB,                           -- 使用者的所有回答
    attempt_number  NUMBER DEFAULT 1,                -- 第幾次測驗
    started_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    completed_at    TIMESTAMP
);

-- ============================================================
-- 學習進度
-- ============================================================
CREATE TABLE user_course_progress (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    user_id         NUMBER NOT NULL REFERENCES users(id),
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_id       NUMBER REFERENCES course_lessons(id) ON DELETE SET NULL,
    current_slide_index NUMBER DEFAULT 0,
    status          VARCHAR2(20) DEFAULT 'not_started',
    -- not_started | in_progress | completed
    time_spent_seconds NUMBER DEFAULT 0,             -- 累計學習時間
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    CONSTRAINT uq_user_course_lesson UNIQUE (user_id, course_id, lesson_id)
);

-- ============================================================
-- 課程指派
-- ============================================================
CREATE TABLE course_assignments (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id         NUMBER NOT NULL REFERENCES users(id),
    assigned_by     NUMBER REFERENCES users(id),
    due_date        DATE,                            -- 截止日
    status          VARCHAR2(20) DEFAULT 'pending',  -- pending | completed | overdue
    completed_at    TIMESTAMP,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_course_assignment UNIQUE (course_id, user_id)
);

-- ============================================================
-- 課程分享權限（對齊 skill_access 架構）
-- ============================================================
CREATE TABLE course_access (
    id              VARCHAR2(36) PRIMARY KEY,         -- UUID
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    grantee_type    VARCHAR2(20) NOT NULL,
    -- user | role | dept | profit_center | org_section | org_group
    grantee_id      VARCHAR2(100) NOT NULL,
    permission      VARCHAR2(20) DEFAULT 'view',     -- view | develop
    granted_by      NUMBER REFERENCES users(id),
    granted_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_course_access UNIQUE (course_id, grantee_type, grantee_id)
);

-- ============================================================
-- users 表擴充
-- ============================================================
ALTER TABLE users ADD can_edit_courses NUMBER(1) DEFAULT 0;
```

### 4.3 content_json 結構定義

每個 slide 的 `content_json` 為 block 陣列：

```jsonc
// slide_type: "content" — 一般內容投影片
[
  {
    "type": "text",
    "content": "## 步驟一：開啟系統\n\n請先登入 **FOXLINK GPT** 系統..."
  },
  {
    "type": "image",
    "src": "/uploads/training/course_1/step1.png",
    "alt": "登入畫面",
    "annotations": [
      { "type": "rect", "x": 120, "y": 80, "w": 200, "h": 40, "color": "#ff0000", "label": "帳號欄位" },
      { "type": "arrow", "x1": 320, "y1": 100, "x2": 400, "y2": 100, "color": "#ff0000" }
    ]
  },
  {
    "type": "callout",
    "variant": "tip",  // tip | warning | note | important
    "content": "建議使用 Chrome 瀏覽器以獲得最佳體驗"
  }
]

// slide_type: "hotspot" — 熱點互動投影片
[
  {
    "type": "hotspot",
    "image": "/uploads/training/course_1/screen_capture.png",
    "instruction": "請點擊「新增訂單」按鈕",
    "regions": [
      {
        "id": "r1",
        "shape": "rect",     // rect | circle | polygon
        "coords": { "x": 150, "y": 200, "w": 120, "h": 40 },
        "correct": true,
        "feedback": "正確！這就是新增訂單按鈕。"
      },
      {
        "id": "r2",
        "shape": "rect",
        "coords": { "x": 150, "y": 260, "w": 120, "h": 40 },
        "correct": false,
        "feedback": "這是刪除按鈕，請找到新增訂單按鈕。"
      }
    ],
    "max_attempts": 3,
    "show_hint_after": 2    // 錯誤幾次後顯示提示
  }
]

// slide_type: "dragdrop" — 拖放互動
[
  {
    "type": "dragdrop",
    "mode": "matching",      // matching（配對）| ordering（排序）| categorize（分類）
    "instruction": "請將操作步驟拖放到正確的順序",
    "items": [
      { "id": "a", "content": "點擊新增", "image": null },
      { "id": "b", "content": "填寫表單", "image": null },
      { "id": "c", "content": "點擊送出", "image": null },
      { "id": "d", "content": "確認結果", "image": null }
    ],
    "targets": [
      { "id": "t1", "label": "步驟 1", "correct_item": "a" },
      { "id": "t2", "label": "步驟 2", "correct_item": "b" },
      { "id": "t3", "label": "步驟 3", "correct_item": "c" },
      { "id": "t4", "label": "步驟 4", "correct_item": "d" }
    ],
    "feedback_correct": "排序正確！",
    "feedback_incorrect": "順序有誤，請再試一次。"
  }
]

// slide_type: "flipcard" — 翻轉卡片
[
  {
    "type": "flipcard",
    "instruction": "點擊卡片翻轉查看答案",
    "cards": [
      {
        "front": { "text": "ERP 系統的全名是什麼？", "image": null },
        "back": { "text": "Enterprise Resource Planning\n企業資源規劃", "image": null }
      },
      {
        "front": { "text": "PLM 的用途？", "image": null },
        "back": { "text": "Product Lifecycle Management\n管理產品從設計到退役的完整生命週期", "image": null }
      }
    ],
    "layout": "grid",        // grid | carousel
    "columns": 2
  }
]

// slide_type: "branch" — 分支選擇
[
  {
    "type": "branch",
    "scenario": "客戶來電反映產品有瑕疵，你會怎麼處理？",
    "image": "/uploads/training/course_1/scenario.png",
    "options": [
      { "text": "立即道歉並詢問詳情", "target_slide_id": 15, "is_best": true },
      { "text": "請客戶填寫線上表單", "target_slide_id": 16, "is_best": false },
      { "text": "轉接給主管處理", "target_slide_id": 17, "is_best": false }
    ]
  }
]

// slide_type: "quiz_inline" — 內嵌測驗
[
  {
    "type": "quiz_inline",
    "question": "以下哪個步驟應該最先執行？",
    "question_type": "single_choice",
    "options": [
      { "text": "填寫表單", "correct": false },
      { "text": "登入系統", "correct": true },
      { "text": "列印報表", "correct": false }
    ],
    "explanation": "必須先登入系統才能進行任何操作。",
    "points": 10
  }
]
```

### 4.4 quiz_questions JSON 結構

```jsonc
// question_type: "single_choice"
{
  "question_json": {
    "text": "FOXLINK GPT 預設使用哪個 AI 模型？",
    "image": null,
    "options": [
      "Gemini 3 Pro",
      "Gemini 3 Flash",
      "GPT-4o",
      "Claude 3.5"
    ]
  },
  "answer_json": {
    "correct": 0    // options index
  }
}

// question_type: "multi_choice"
{
  "question_json": {
    "text": "以下哪些是 FOXLINK GPT 支援的檔案格式？（複選）",
    "options": ["PDF", "Excel", "影片", "Word", "PPT"]
  },
  "answer_json": {
    "correct": [0, 1, 3, 4]   // 影片不支援上傳
  }
}

// question_type: "fill_blank"
{
  "question_json": {
    "text": "FOXLINK GPT 的預設管理員帳號是 ______"
  },
  "answer_json": {
    "correct": ["ADMIN"],
    "case_sensitive": false
  }
}

// question_type: "matching"
{
  "question_json": {
    "text": "將功能與對應的選單配對",
    "items": ["使用者管理", "模型設定", "敏感用語"],
    "targets": ["系統管理", "LLM 設定", "稽核管理"]
  },
  "answer_json": {
    "correct_pairs": [[0, 0], [1, 1], [2, 2]]
  }
}

// question_type: "ordering"
{
  "question_json": {
    "text": "請將以下操作按正確順序排列",
    "items": ["登入系統", "選擇模型", "輸入問題", "查看回答"]
  },
  "answer_json": {
    "correct_order": [0, 1, 2, 3]
  }
}

// question_type: "hotspot_click"
{
  "question_json": {
    "text": "請在畫面中找到「新增對話」按鈕並點擊",
    "image": "/uploads/training/quiz/screen1.png",
    "correct_region": { "shape": "rect", "x": 20, "y": 100, "w": 150, "h": 40 },
    "tolerance": 10   // 容許誤差 px
  },
  "answer_json": {
    "correct_coords": { "x": 95, "y": 120 }
  }
}
```

### 4.5 video_interactions content_json 結構

```jsonc
// interaction_type: "quiz"
{
  "question": "剛才示範的第二個步驟是什麼？",
  "question_type": "single_choice",
  "options": ["點擊設定", "點擊新增", "點擊刪除"],
  "correct": 1,
  "points": 10,
  "explanation": "第二步是點擊新增按鈕來建立新紀錄。"
}

// interaction_type: "hotspot"
{
  "instruction": "請在畫面中點擊正確的按鈕位置",
  "snapshot_image": "/uploads/training/video_snap_45s.png",
  "regions": [
    { "shape": "rect", "coords": { "x": 100, "y": 200, "w": 80, "h": 30 }, "correct": true }
  ]
}

// interaction_type: "branch"
{
  "scenario": "接下來你會怎麼操作？",
  "options": [
    { "text": "繼續填寫表單", "jump_to_seconds": 60 },
    { "text": "先查詢舊資料", "jump_to_seconds": 120 },
    { "text": "詢問主管", "jump_to_seconds": 180 }
  ]
}
```

---

## 5. 前端架構

### 5.1 路由結構

```
/training                              ← 教材首頁（課程列表、分類瀏覽）
/training/course/:id                   ← 課程詳情（章節列表、開始學習）
/training/course/:id/learn             ← 學習播放器（全螢幕）
/training/course/:id/quiz              ← 正式測驗頁面
/training/course/:id/result/:attemptId ← 測驗結果

/training/editor                       ← 我的教材列表（建立/管理）
/training/editor/new                   ← 新增課程
/training/editor/:id                   ← 編輯課程（章節、投影片、題目）

/admin → 教育訓練管理頁簽              ← 成績查詢、進度報表（Admin only）
```

### 5.2 元件架構

```
client/src/
├── pages/
│   └── Training.tsx                        ← 主路由容器
│
├── components/training/
│   │
│   ├── ── 首頁 & 瀏覽 ──
│   ├── CourseList.tsx                       ← 課程列表（分類篩選、搜尋）
│   ├── CourseCard.tsx                       ← 課程卡片（封面、標題、進度）
│   ├── CourseDetail.tsx                     ← 課程詳情（章節列表、開始學習）
│   ├── CategoryManager.tsx                 ← 分類管理（樹狀）
│   │
│   ├── ── 播放器 ──
│   ├── CoursePlayer.tsx                    ← 全螢幕學習播放器
│   ├── SlideRenderer.tsx                   ← 投影片渲染器（根據 type 分派）
│   ├── PlayerControls.tsx                  ← 播放控制列（進度、章節、音訊）
│   ├── blocks/                             ← 各 block 渲染元件
│   │   ├── TextBlock.tsx                   ← Markdown 渲染
│   │   ├── ImageBlock.tsx                  ← 圖片 + 標註 overlay
│   │   ├── HotspotBlock.tsx                ← 熱點互動（點擊判定）
│   │   ├── DragDropBlock.tsx               ← 拖放互動（dnd-kit）
│   │   ├── FlipCardBlock.tsx               ← 翻轉卡片（CSS 3D）
│   │   ├── BranchBlock.tsx                 ← 分支選擇
│   │   ├── VideoBlock.tsx                  ← 影片 + 時間軸互動
│   │   ├── QuizInlineBlock.tsx             ← 內嵌測驗
│   │   ├── CalloutBlock.tsx                ← 提示/警告框
│   │   ├── CodeBlock.tsx                   ← 程式碼區塊
│   │   └── StepsBlock.tsx                  ← 步驟清單
│   │
│   ├── ── 測驗 ──
│   ├── QuizPage.tsx                        ← 正式測驗頁（計時、逐題）
│   ├── QuizResult.tsx                      ← 測驗結果（分數、解析）
│   ├── questions/                          ← 各題型渲染元件
│   │   ├── SingleChoice.tsx
│   │   ├── MultiChoice.tsx
│   │   ├── FillBlank.tsx
│   │   ├── MatchingQuestion.tsx
│   │   ├── OrderingQuestion.tsx
│   │   └── HotspotQuestion.tsx
│   │
│   ├── ── 編輯器 ──
│   ├── editor/
│   │   ├── CourseEditor.tsx                ← 課程編輯主頁（metadata + 章節管理）
│   │   ├── LessonEditor.tsx                ← 章節編輯（投影片列表 + 排序）
│   │   ├── SlideEditor.tsx                 ← 投影片 block 編輯器
│   │   ├── HotspotEditor.tsx               ← 熱點標記工具（fabricjs Canvas）
│   │   ├── DragDropEditor.tsx              ← 拖放設定工具
│   │   ├── FlipCardEditor.tsx              ← 翻轉卡片編輯
│   │   ├── BranchEditor.tsx                ← 分支流程編輯
│   │   ├── QuizEditor.tsx                  ← 題目 CRUD
│   │   ├── VideoInteractionEditor.tsx      ← 影片互動節點編輯
│   │   └── AudioPanel.tsx                  ← TTS / 錄音 / 上傳面板
│   │
│   ├── ── 權限 & 指派 ──
│   ├── CourseShare.tsx                     ← 分享管理（仿 SkillShare）
│   ├── CourseAssign.tsx                    ← 課程指派（選使用者 + 截止日）
│   └── MyAssignments.tsx                   ← 我的指派（待完成課程）
│
├── components/admin/
│   └── TrainingAdmin.tsx                   ← Admin 頁簽：成績報表、進度總覽
```

### 5.3 UI 設計風格

沿用 FOXLINK GPT 現有風格：
- 藍色/灰色基調
- 簡單圖示 icon
- 簡潔精簡設計

播放器為全螢幕模式，類似簡報展示：
```
┌───────────────────────────────────────────────────┐
│ ← 返回  │  課程名稱 - 章節 2/5  │  ◀ ▶  │  ⚙  │
├───────────────────────────────────────────────────┤
│                                                   │
│                                                   │
│              投影片內容區域                          │
│          （根據 block type 渲染）                    │
│                                                   │
│                                                   │
├───────────────────────────────────────────────────┤
│  🔊 旁白  │  ━━━━●━━━━━━━  │  3/12  │  📝 筆記  │
└───────────────────────────────────────────────────┘
```

---

## 6. 後端 API 路由

### 6.1 路由總覽

```
server/routes/training.js

── 分類管理 ──
GET    /api/training/categories                    ← 分類樹
POST   /api/training/categories                    ← 新增分類
PUT    /api/training/categories/:id                ← 編輯分類
DELETE /api/training/categories/:id                ← 刪除分類

── 課程 CRUD ──
GET    /api/training/courses                       ← 課程列表（含權限過濾）
POST   /api/training/courses                       ← 建立課程（需 can_edit_courses）
GET    /api/training/courses/:id                   ← 課程詳情
PUT    /api/training/courses/:id                   ← 編輯課程（owner/develop）
DELETE /api/training/courses/:id                   ← 刪除課程（owner/admin）
POST   /api/training/courses/:id/publish           ← 發佈課程
POST   /api/training/courses/:id/archive           ← 封存課程
POST   /api/training/courses/:id/duplicate         ← 複製課程

── 章節 CRUD ──
GET    /api/training/courses/:id/lessons           ← 章節列表
POST   /api/training/courses/:id/lessons           ← 新增章節
PUT    /api/training/lessons/:lid                  ← 編輯章節
DELETE /api/training/lessons/:lid                  ← 刪除章節
PUT    /api/training/courses/:id/lessons/reorder   ← 章節排序

── 投影片 CRUD ──
GET    /api/training/lessons/:lid/slides           ← 投影片列表
POST   /api/training/lessons/:lid/slides           ← 新增投影片
PUT    /api/training/slides/:sid                   ← 編輯投影片
DELETE /api/training/slides/:sid                   ← 刪除投影片
PUT    /api/training/lessons/:lid/slides/reorder   ← 投影片排序

── 音訊 ──
POST   /api/training/slides/:sid/audio             ← 上傳音訊檔
POST   /api/training/slides/:sid/tts               ← TTS 生成旁白
DELETE /api/training/slides/:sid/audio              ← 刪除音訊

── 影片互動 ──
GET    /api/training/lessons/:lid/video-interactions       ← 互動節點列表
POST   /api/training/lessons/:lid/video-interactions       ← 新增互動節點
PUT    /api/training/video-interactions/:vid               ← 編輯互動節點
DELETE /api/training/video-interactions/:vid               ← 刪除互動節點

── 題庫 ──
GET    /api/training/courses/:id/questions         ← 題目列表
POST   /api/training/courses/:id/questions         ← 新增題目
PUT    /api/training/questions/:qid                ← 編輯題目
DELETE /api/training/questions/:qid                ← 刪除題目
PUT    /api/training/courses/:id/questions/reorder ← 題目排序

── 測驗 ──
POST   /api/training/courses/:id/quiz/start        ← 開始測驗（建立 attempt）
POST   /api/training/courses/:id/quiz/submit       ← 提交測驗（計分）
GET    /api/training/quiz-attempts/:aid             ← 測驗結果詳情
GET    /api/training/courses/:id/my-attempts        ← 我的測驗紀錄

── 權限 & 分享 ──
GET    /api/training/courses/:id/access            ← 分享清單
POST   /api/training/courses/:id/access            ← 授權 { grantee_type, grantee_id, permission }
PUT    /api/training/courses/:id/access/:aid       ← 更新權限
DELETE /api/training/courses/:id/access/:aid       ← 撤銷
POST   /api/training/courses/:id/request-public    ← 申請公開

── 指派 ──
POST   /api/training/courses/:id/assign            ← 指派（批次）
DELETE /api/training/assignments/:aid               ← 取消指派
GET    /api/training/my-assignments                 ← 我的待完成課程

── 進度 ──
POST   /api/training/courses/:id/progress          ← 更新學習進度
GET    /api/training/my-progress                    ← 我的學習進度總覽
GET    /api/training/courses/:id/my-progress        ← 特定課程進度

── 管理報表（Admin） ──
GET    /api/training/admin/reports/overview         ← 總覽（完成率、平均分數）
GET    /api/training/admin/reports/by-user          ← 依使用者
GET    /api/training/admin/reports/by-course        ← 依課程
GET    /api/training/admin/reports/by-department    ← 依部門
```

### 6.2 權限檢查邏輯

```js
// server/routes/training.js

async function canUserAccessCourse(db, courseId, user) {
  const course = await db.prepare(
    'SELECT created_by, is_public, status FROM courses WHERE id = ?'
  ).get(courseId);

  if (!course) return { access: false };
  if (course.created_by === user.id) return { access: true, permission: 'owner' };
  if (user.role === 'admin') return { access: true, permission: 'admin' };
  if (course.is_public === 1 && course.status === 'published')
    return { access: true, permission: 'view' };

  // 檢查 course_access（多維度，對齊 skill_access 邏輯）
  const access = await db.prepare(`
    SELECT permission FROM course_access WHERE course_id = :cid AND (
      (grantee_type = 'user' AND grantee_id = TO_CHAR(:uid))
      OR (grantee_type = 'role' AND grantee_id = :role)
      OR (grantee_type = 'dept' AND grantee_id = :dept AND :dept IS NOT NULL)
      OR (grantee_type = 'profit_center' AND grantee_id = :pc AND :pc IS NOT NULL)
      OR (grantee_type = 'org_section' AND grantee_id = :os AND :os IS NOT NULL)
      OR (grantee_type = 'org_group' AND grantee_id = :og AND :og IS NOT NULL)
    ) ORDER BY CASE permission WHEN 'develop' THEN 0 ELSE 1 END
    FETCH FIRST 1 ROWS ONLY
  `).get({
    cid: courseId, uid: user.id, role: user.role,
    dept: user.dept_code, pc: user.profit_center,
    os: user.org_section, og: user.org_group
  });

  if (access) return { access: true, permission: access.permission };
  return { access: false };
}

function requirePermission(...allowed) {
  // allowed: ['owner', 'admin', 'develop', 'view']
  return (req, res, next) => {
    if (!allowed.includes(req.coursePermission)) {
      return res.status(403).json({ error: '權限不足' });
    }
    next();
  };
}
```

---

## 7. 模擬操作方案

### 7.1 截圖模擬（Phase 1）

**所有系統皆適用**，無跨域限制。

流程：
1. 編輯者截取目標系統畫面
2. 上傳截圖到教材編輯器
3. 使用 fabricjs Canvas 在截圖上標記互動區域（hotspot）
4. 設定每個區域的正確/錯誤反饋
5. 學習者在播放時點擊，系統判定是否正確

### 7.2 iframe 導引模擬（Phase 2）

**僅限可控的內部 Web 系統**。

```
┌──────────────────────────────────────────────┐
│  Training Player                              │
├──────────────────────────────────────────────┤
│  ┌─ 指引面板 ─────────────────────────────┐  │
│  │ 步驟 3/8: 點擊「新增對話」按鈕          │  │
│  │ [🔊 播放語音] [上一步] [下一步] [提示]   │  │
│  └────────────────────────────────────────┘  │
│  ┌─ iframe ──────────────────────────────┐  │
│  │                                        │  │
│  │  ┌────────────┐                        │  │
│  │  │ + 新增對話  │ ← 高亮 overlay         │  │
│  │  └────────────┘                        │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

技術方式：
- iframe 載入目標系統 URL
- 透過 `window.postMessage()` 與 iframe 溝通
- 在 iframe 上方疊加透明 overlay 來做高亮效果
- 監聽使用者操作（透過 overlay 捕捉座標或 postMessage 回報）

適用範圍：
- ✅ FOXLINK GPT 自身（同源，Phase 2 首要目標）
- ⚠️ 內部 Web 系統（需設定允許 iframe 嵌入）
- ❌ 第三方 SaaS（Oracle Cloud 等，有 CSP 限制）

### 7.3 影片 + 互動混合

既有影片嵌入播放，在時間軸上插入互動節點：

```
影片時間軸: ──────●────────────●──────────────●────→
                  │                  │                │
          timestamp: 30s      timestamp: 75s   timestamp: 150s
          type: quiz          type: hotspot    type: branch
          暫停+出選擇題       暫停+點擊截圖     暫停+選擇分支
```

影片來源：上傳 MP4 檔案 或 貼入影片 URL（內部影片伺服器）。

---

## 8. 檔案儲存

```
uploads/
└── training/
    └── course_{id}/
        ├── cover.jpg                    ← 課程封面
        ├── slides/
        │   ├── slide_{id}_img1.png      ← 投影片圖片
        │   ├── slide_{id}_hotspot.png   ← 熱點底圖
        │   └── slide_{id}_audio.mp3     ← 語音旁白
        ├── videos/
        │   └── lesson_{id}_video.mp4    ← 教學影片
        ├── quiz/
        │   └── q_{id}_image.png         ← 題目附圖
        └── audio/
            └── tts_{slide_id}.mp3       ← TTS 生成的音訊
```

---

## 9. 開發階段計畫

### Phase 1：完整互動教材平台（本次實作）

```
Phase 1A — 基礎架構 + 教材 CRUD
├── DB 表建立（Oracle）
├── 課程分類管理（樹狀，最多 3 層）
├── 課程 CRUD + 狀態管理 (draft/published/archived)
├── 章節管理（排序、CRUD）
├── 權限模型（course_access + can_edit_courses）
├── /training 路由整合進現有 App.tsx
└── 課程列表首頁（分類瀏覽、搜尋、我的課程、指派課程）

Phase 1B — 互動教材編輯器
├── Block-based 投影片編輯器
├── 支援 block 類型：text, image, steps, callout, code, video
├── 互動 block：hotspot, dragdrop, flipcard, branch, quiz_inline
├── Hotspot 編輯器（fabricjs Canvas 標記區域）
├── 拖放編輯器（定義項目 + 目標 + 配對）
├── 翻轉卡片編輯器（正反面內容）
├── 分支編輯器（選項 + 目標投影片）
└── 影片互動節點編輯器（時間軸 + 互動設定）

Phase 1C — 音訊功能
├── TTS 生成旁白（/api/skills/tts/synthesize）
├── STT 語音輸入創作（Gemini 語音轉錄）
├── 麥克風錄音上傳（MediaRecorder API）
└── 投影片音訊播放同步

Phase 1D — 播放器
├── 投影片式全螢幕播放器
├── 各互動 block 渲染 + 互動判定
├── 影片 + 時間軸互動（暫停 + 出題）
├── 語音旁白自動播放
├── 進度條 + 章節導航
└── 分支播放邏輯

Phase 1E — 測驗系統
├── 題型：單選、多選、填空、配對、排序、操作模擬
├── 計分 + 及格門檻
├── 限時測驗 + 重測次數限制
└── 測驗結果頁（分數、答案解析、歷次紀錄）

Phase 1F — 進度追蹤 + 管理
├── 學習進度記錄
├── 課程指派（有 develop 權限者可指派）
├── 分享管理 UI（仿 skill 分享介面）
└── Admin 管理頁簽：成績查詢、進度報表
```

### Phase 2：進階功能（後續迭代）

```
├── iframe 導引模擬（先從 FOXLINK GPT 自身開始）
├── AI 輔助：上傳截圖自動生成步驟教材
├── AI 自動出題（根據教材內容用 Gemini 生成題目）
├── 學習報表（部門統計、趨勢圖、完成率排行）
├── 證書 PDF 產出（pdfkit）
├── 到期提醒 email（整合現有 SMTP）
├── 螢幕錄製 + AI 拆分步驟
├── 分支流程視覺化編輯器（reactflow）
└── SCORM 匯出（可選）
```

---

## 10. 待確認事項

| # | 問題 | 選項 | 建議 |
|---|------|------|------|
| 1 | Hotspot 編輯器技術 | fabricjs Canvas 標記區域 | 推薦 fabricjs，成熟穩定 |
| 2 | 影片來源 | 上傳 MP4 / 貼 URL / 兩者皆可 | 兩者皆可 |
| 3 | 分類樹狀深度 | 2 層 / 3 層 / 無限 | 最多 3 層 |
| 4 | Phase 1 包含 AI 輔助出題？ | 是 / 否 | 推薦納入，工作量不大 |
