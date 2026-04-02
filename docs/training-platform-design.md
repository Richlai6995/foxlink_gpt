# FOXLINK GPT 教育訓練平台 設計文件

> 日期：2026-04-01
> 狀態：設計確認，準備實作
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
| **多語言** | zh-TW 為主語言，自動翻譯 en/vi，保留手動編輯空間 |
| **AI 輔助出題** | 根據教材內容用 Gemini 自動生成測驗題目 |

### 1.3 首個教材專案

以 FOXLINK GPT 系統本身為第一個教材專案，結合現有使用手冊內容，製作互動式教材 + 操作練習 + 測驗。驗證平台完整流程後再推廣至其他系統（Oracle ERP / PLM / HR 等）。

### 1.4 與 Adobe Captivate 的定位差異

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

### 2.5 UI 入口

教育訓練平台為**獨立頁面**，不掛在 admin 管理權限下：

- **Sidebar「更多功能」選單**新增「教育訓練」項目（所有使用者可見）
- 點擊後以 `navigate('/training')` 開啟新頁面
- 編輯者不一定是 admin，使用權限透過分享設定或公開機制控制

```tsx
// Sidebar.tsx — 「更多功能」選單新增項目
<button onClick={() => { setShowMenu(false); navigate('/training') }}
  className="w-full flex items-center gap-2 ...">
  <GraduationCap size={13} /> {t('sidebar.training')}
</button>
```

i18n key:
```json
// zh-TW.json
"sidebar": { "training": "教育訓練" }
// en.json
"sidebar": { "training": "Training" }
// vi.json
"sidebar": { "training": "Đào tạo" }
```

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

### 3.4 STT 語音輸入創作

複用現有 `gemini.js:transcribeAudio()`（Gemini Flash），在教材編輯器中提供語音輸入能力：

#### 應用場景

| 場景 | 說明 |
|------|------|
| **口述旁白** | 編輯者對著麥克風念旁白 → 自動轉為文字填入 `notes` 欄位 → 同時保存錄音作為音訊 |
| **口述內容** | 語音輸入投影片文字內容（適合不善打字的教材製作者） |
| **口述題目** | 語音輸入測驗題目和選項 |
| **即錄即用** | 錄音同時做兩件事：保存音訊檔 + 轉文字作為旁白/內容 |

#### 流程

```
┌─ 投影片編輯器 ──────────────────────────────────┐
│                                                  │
│  旁白文字: [...................................] │
│            [🎤 語音輸入]  [▶ TTS 預覽]           │
│                                                  │
│  音訊來源: ○ TTS 自動生成  ○ 上傳檔案            │
│            ● 麥克風錄音 ← 同時轉文字              │
│                                                  │
│  [🔴 開始錄音]                                   │
│     ↓ 錄音中... 00:15                            │
│  [⬛ 停止]                                       │
│     ↓                                            │
│  處理中: 轉錄音訊... ✓                            │
│  轉錄結果: "請先點擊左上角的新增按鈕，然後..."     │
│  [✓ 套用到旁白]  [✓ 套用到內容]  [✎ 編輯後套用]  │
│                                                  │
│  音訊: slide_5_audio.mp3  [▶ 播放] [✕ 刪除]      │
└──────────────────────────────────────────────────┘
```

#### 技術流程

```js
// 前端：麥克風錄音
const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
mediaRecorder.onstop = async () => {
  const blob = new Blob(chunks, { type: 'audio/webm' });

  // 上傳錄音 + 同時觸發 STT
  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');
  formData.append('transcribe', 'true');  // 要求同時轉錄

  const res = await api.post(`/training/slides/${slideId}/audio`, formData);
  // res = { audio_url: '...mp3', transcription: '轉錄的文字...' }
};

// 後端：POST /api/training/slides/:sid/audio
// 1. 儲存音訊檔（webm → 可選轉 mp3）
// 2. if (req.body.transcribe === 'true')
//      呼叫 transcribeAudio(filePath, mimeType)
//      回傳 transcription 文字
// 3. 前端收到後讓編輯者選擇套用到 notes 或 content
```

#### 即時語音輸入模式（邊說邊打）

除了錄音後批次轉錄，也支援**即時語音輸入**（使用瀏覽器 Web Speech API）：

```js
// 前端：即時 STT（Web Speech API，免 server 呼叫）
const recognition = new webkitSpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'zh-TW';

recognition.onresult = (event) => {
  let transcript = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    transcript += event.results[i][0].transcript;
  }
  // 即時更新文字欄位（interim results 顯示灰色，final 顯示黑色）
  setInputText(prev + transcript);
};
```

兩種 STT 模式的比較：

| | Web Speech API（即時） | Gemini STT（批次） |
|--|----------------------|-------------------|
| **延遲** | 即時（邊說邊出字） | 錄完後處理（數秒） |
| **準確度** | 中等 | 高（特別是專業術語） |
| **離線** | 需要網路 | 需要網路 |
| **長度** | 適合短句 | 適合長段落 |
| **適用** | 口述內容、快速輸入 | 錄旁白、需要高準確度 |
| **費用** | 免費 | 消耗 Gemini token |

建議：預設用 Web Speech API 即時輸入，長段落或需要高準確度時用 Gemini STT。

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
-- 題庫（含評分規則）
-- ============================================================
CREATE TABLE quiz_questions (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    question_type   VARCHAR2(30) NOT NULL,
    -- single_choice | multi_choice | fill_blank | matching | ordering
    -- | hotspot_click | hotspot_sequence | dragdrop | branch_scenario
    question_json   NCLOB NOT NULL,                  -- 題目內容（含圖片、選項等）
    answer_json     NCLOB NOT NULL,                  -- 正確答案
    scoring_json    NCLOB,                           -- 評分規則（見 §9 詳細說明）
    points          NUMBER DEFAULT 10,               -- 滿分配分
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
    answers_json    NCLOB,                           -- 使用者回答 + 每題得分明細
    attempt_number  NUMBER DEFAULT 1,                -- 第幾次測驗
    started_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    completed_at    TIMESTAMP,
    review_status   VARCHAR2(20) DEFAULT 'auto',     -- auto | pending_review | reviewed
    reviewed_by     NUMBER REFERENCES users(id),     -- 人工複審者
    reviewed_at     TIMESTAMP
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

## 8. 多語言支援

### 8.1 架構概述

對齊現有 Help 系統的多語言模式：zh-TW 為主語言（source of truth），en / vi 為翻譯語言。

```
┌─ 教材編輯器（zh-TW）─┐     LLM 翻譯     ┌─ 翻譯版本 ──┐
│                       │  ──────────────→  │  en          │
│  投影片 content_json  │                   │  vi          │
│  測驗題 question_json │  ←── 手動修正 ──  │              │
│  旁白 notes           │                   │              │
└───────────────────────┘                   └──────────────┘
```

### 8.2 DB 翻譯表

```sql
-- 課程翻譯（標題、描述）
CREATE TABLE course_translations (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lang            VARCHAR2(10) NOT NULL,           -- 'en' | 'vi'
    title           NVARCHAR2(500),
    description     NCLOB,
    translated_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto         NUMBER(1) DEFAULT 1,             -- 1=LLM 自動翻譯, 0=手動編輯
    CONSTRAINT uq_course_trans UNIQUE (course_id, lang)
);

-- 章節翻譯
CREATE TABLE lesson_translations (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    lesson_id       NUMBER NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
    lang            VARCHAR2(10) NOT NULL,
    title           NVARCHAR2(500),
    translated_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto         NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_lesson_trans UNIQUE (lesson_id, lang)
);

-- 投影片翻譯（完整 content_json + notes 翻譯版）
CREATE TABLE slide_translations (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    slide_id        NUMBER NOT NULL REFERENCES course_slides(id) ON DELETE CASCADE,
    lang            VARCHAR2(10) NOT NULL,
    content_json    NCLOB,                           -- 翻譯後的 block 陣列
    notes           NCLOB,                           -- 翻譯後的旁白文字
    audio_url       VARCHAR2(500),                   -- 該語言的 TTS 音訊
    translated_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto         NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_slide_trans UNIQUE (slide_id, lang)
);

-- 測驗題翻譯
CREATE TABLE quiz_translations (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    question_id     NUMBER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    lang            VARCHAR2(10) NOT NULL,
    question_json   NCLOB,                           -- 翻譯後的題目 JSON
    explanation     NCLOB,                           -- 翻譯後的答案解析
    translated_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto         NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_quiz_trans UNIQUE (question_id, lang)
);

-- 分類翻譯
CREATE TABLE category_translations (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    category_id     NUMBER NOT NULL REFERENCES course_categories(id) ON DELETE CASCADE,
    lang            VARCHAR2(10) NOT NULL,
    name            NVARCHAR2(200),
    translated_at   TIMESTAMP DEFAULT SYSTIMESTAMP,
    is_auto         NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_category_trans UNIQUE (category_id, lang)
);
```

### 8.3 翻譯流程

#### 自動翻譯（LLM-based）

複用現有 `server/services/translationService.js` 架構，新增教材專用翻譯：

```js
// POST /api/training/courses/:id/translate
// Body: { target_lang: 'en' | 'vi', scope: 'all' | 'outdated' }

// 流程：
// 1. 讀取課程所有 zh-TW 內容（title, description, slides, quiz）
// 2. 分 chunk 送 Gemini Flash 翻譯（複用 helpTranslator.js 的 chunk 策略）
// 3. 寫入 *_translations 表，is_auto=1
// 4. 為翻譯後的旁白文字自動生成 TTS 音訊（選配）
```

翻譯 prompt（對齊現有 helpTranslator.js 風格）：

```
你是一位專業的技術文件翻譯者。
規則：
1. 將繁體中文翻譯為 {target_lang}
2. 不翻譯：產品名稱（Foxlink GPT, Oracle, SAP 等）、技術術語（API, SSO, LDAP 等）
3. 保留 markdown 格式（**粗體**, `代碼`）
4. 保留 JSON 結構（type, shape 等 key 不翻譯）
5. 只回傳有效 JSON
```

#### 手動編輯

- 編輯器切換語言時載入翻譯版內容
- 修改後 `is_auto = 0`（標記為手動編輯，後續自動翻譯不覆蓋）
- 當 zh-TW 原文更新時，標記翻譯為「已過期」，提示重新翻譯

#### 過期偵測

```sql
-- 翻譯過期 = zh-TW 更新時間 > 翻譯時間
SELECT s.id, s.updated_at AS source_updated,
       st.translated_at, st.lang,
       CASE WHEN s.updated_at > st.translated_at THEN 1 ELSE 0 END AS is_outdated
FROM course_slides s
LEFT JOIN slide_translations st ON st.slide_id = s.id
WHERE s.lesson_id IN (SELECT id FROM course_lessons WHERE course_id = :courseId)
```

### 8.4 播放器語言切換

```tsx
// CoursePlayer.tsx
const { i18n } = useTranslation();
const lang = i18n.language;  // 'zh-TW' | 'en' | 'vi'

// 取得投影片內容：
// GET /api/training/slides/:id?lang=en
// 後端邏輯：
//   if lang === 'zh-TW' → 回傳 course_slides.content_json
//   else → 回傳 COALESCE(slide_translations.content_json, course_slides.content_json)
//   （翻譯不存在時 fallback 到 zh-TW）
```

### 8.5 翻譯管理介面

在課程編輯器內新增「翻譯管理」頁簽：

```
┌─ 課程編輯器 ─────────────────────────────────────┐
│  [基本資訊] [章節管理] [題庫] [翻譯管理] [設定]    │
├──────────────────────────────────────────────────┤
│                                                   │
│  語言: [English ▼]                                │
│                                                   │
│  ┌─────────────────────┬──────┬─────────────────┐ │
│  │ 內容                 │ 狀態  │ 操作             │ │
│  ├─────────────────────┼──────┼─────────────────┤ │
│  │ 課程標題             │ ✅   │ [編輯]           │ │
│  │ 課程描述             │ ⚠過期│ [編輯] [重譯]    │ │
│  │ 章節 1: 系統介紹      │ ✅   │ [編輯]           │ │
│  │   └ 投影片 1         │ ✅   │ [編輯]           │ │
│  │   └ 投影片 2         │ ❌未譯│ [翻譯]           │ │
│  │ 章節 2: 對話功能      │ ⚠過期│ [編輯] [重譯]    │ │
│  │ 測驗題 (8 題)        │ 5/8  │ [批次翻譯]       │ │
│  └─────────────────────┴──────┴─────────────────┘ │
│                                                   │
│  [一鍵翻譯全部未譯/過期] [生成 TTS 音訊]            │
└──────────────────────────────────────────────────┘
```

### 8.6 API 路由（翻譯相關）

```
── 翻譯 ──
POST   /api/training/courses/:id/translate              ← 批次自動翻譯
GET    /api/training/courses/:id/translate/status        ← 翻譯狀態總覽
GET    /api/training/courses/:id/translate/progress/:jid ← 翻譯進度（polling）
POST   /api/training/courses/:id/translate/abort         ← 取消翻譯

GET    /api/training/slides/:sid/translation/:lang       ← 取得投影片翻譯
PUT    /api/training/slides/:sid/translation/:lang       ← 手動編輯翻譯
POST   /api/training/slides/:sid/translation/:lang/tts   ← 為翻譯版生成 TTS

GET    /api/training/questions/:qid/translation/:lang    ← 取得題目翻譯
PUT    /api/training/questions/:qid/translation/:lang    ← 手動編輯題目翻譯
```

---

## 9. AI 輔助出題

### 9.1 流程

```
教材內容（slides content_json）
        │
        ▼
   Gemini 分析教材
        │
        ▼
   生成題目 JSON（含選項、正確答案、解析）
        │
        ▼
   編輯者審核 / 調整
        │
        ▼
   存入 quiz_questions
```

### 9.2 API

```
POST /api/training/courses/:id/ai-generate-quiz
Body: {
  lesson_ids: [1, 2, 3],         // 可選，指定章節範圍
  question_count: 10,            // 生成題數
  question_types: ['single_choice', 'multi_choice', 'fill_blank'],  // 題型
  difficulty: 'medium',          // easy | medium | hard
  model_key: 'flash'             // 用 Flash 較快
}
Response: {
  questions: [
    {
      question_type: 'single_choice',
      question_json: { text: '...', options: [...] },
      answer_json: { correct: 0 },
      explanation: '...',
      points: 10,
      _source_slide_id: 5        // 題目來源投影片（供參考）
    },
    ...
  ]
}
```

### 9.3 Prompt 設計

```
你是一位教育訓練測驗出題專家。根據以下教材內容，生成 {count} 道測驗題目。

要求：
1. 題目必須基於教材內容，不能憑空杜撰
2. 涵蓋教材的重點知識和操作步驟
3. 難度等級: {difficulty}
4. 題型分布: {types}
5. 每題附上正確答案和解析說明
6. 選擇題的錯誤選項要有誘答性，不能太離譜
7. 回傳 JSON 格式

教材內容：
---
{slides_content}
---

回傳格式：
[{ question_type, question_json, answer_json, scoring_json, explanation, points }]
```

AI 出題時會同時生成 `scoring_json`（評分規則），出題者可審核調整。

---

## 10. 評分系統

### 10.1 評分模式總覽

每道題的 `scoring_json` 定義該題的評分規則，出題者可自訂或由 AI 出題時自動生成：

| 評分模式 | 適用題型 | 說明 |
|---------|---------|------|
| `exact` | 單選、填空 | 完全正確才得分 |
| `partial` | 多選、配對、排序 | 按正確比例給分 |
| `weighted` | 分支情境 | 不同選項不同分數 |
| `rubric` | hotspot 操作、拖放操作 | 多維度評分標準 |
| `ai_judge` | 填空（開放式）、複雜操作 | AI 語意判定 |

### 10.2 各題型 scoring_json 結構

```jsonc
// ═══════════════════════════════════════════
// 單選題 — exact 模式（預設，最簡單）
// ═══════════════════════════════════════════
{
  "mode": "exact",
  "full_score": 10
  // 答對 = 10, 答錯 = 0
}

// ═══════════════════════════════════════════
// 多選題 — partial 模式（部分給分）
// ═══════════════════════════════════════════
{
  "mode": "partial",
  "full_score": 10,
  "partial_credit": true,
  "scoring_method": "proportion",       // proportion | per_correct | all_or_nothing
  // proportion:   正確比例 × 滿分（選對 3/4 = 7.5 分）
  // per_correct:  每個正確選項固定分數
  // all_or_nothing: 全對才得分
  "wrong_penalty": -2,                  // 選到錯誤選項每個扣分（null=不扣）
  "min_score": 0                        // 最低分（不會扣成負分）
}

// ═══════════════════════════════════════════
// 填空題 — exact + 同義詞
// ═══════════════════════════════════════════
{
  "mode": "exact",
  "full_score": 10,
  "case_sensitive": false,
  "trim_whitespace": true,
  "accept_synonyms": ["ERP", "企業資源規劃", "Enterprise Resource Planning"],
  "use_ai_judge": false                 // true 時改用 AI 語意比對
}

// ═══════════════════════════════════════════
// 填空題（開放式）— ai_judge 模式
// ═══════════════════════════════════════════
{
  "mode": "ai_judge",
  "full_score": 10,
  "judge_prompt": "判斷學員的回答是否正確描述了 FOXLINK GPT 的登入流程。要求提到 LDAP 驗證和工號登入。",
  "rubric": [
    { "criterion": "提到 LDAP/AD 驗證", "points": 4 },
    { "criterion": "提到工號作為帳號", "points": 3 },
    { "criterion": "提到首次登入需啟用", "points": 3 }
  ],
  "model_key": "flash"                 // 用哪個模型判題
}

// ═══════════════════════════════════════════
// 配對題 — partial 模式
// ═══════════════════════════════════════════
{
  "mode": "partial",
  "full_score": 10,
  "scoring_method": "per_correct",
  "points_per_pair": 2.5,              // 4 對配對，每對 2.5 分
  "partial_credit": true
}

// ═══════════════════════════════════════════
// 排序題 — partial 模式
// ═══════════════════════════════════════════
{
  "mode": "partial",
  "full_score": 10,
  "scoring_method": "proportion",
  "comparison": "position",             // position（每個位置對不對）| adjacent_pairs（相鄰順序）
  "partial_credit": true
}

// ═══════════════════════════════════════════
// Hotspot 點擊題（單步）— rubric 模式
// ═══════════════════════════════════════════
{
  "mode": "rubric",
  "full_score": 10,
  "dimensions": [
    {
      "name": "accuracy",
      "label": "點擊正確性",
      "weight": 7,                      // 佔 7 分
      "criteria": {
        "correct_region": 7,            // 點到正確區域 = 7 分
        "adjacent_region": 3,           // 點到相鄰區域 = 3 分
        "wrong_region": 0               // 點到錯誤區域 = 0 分
      }
    },
    {
      "name": "attempts",
      "label": "嘗試次數",
      "weight": 3,                      // 佔 3 分
      "criteria": {
        "first_try": 3,                 // 第 1 次就對 = 3 分
        "second_try": 2,                // 第 2 次 = 2 分
        "third_try": 1,                 // 第 3 次 = 1 分
        "more": 0                       // 超過 3 次 = 0 分
      }
    }
  ]
}

// ═══════════════════════════════════════════
// Hotspot 序列操作題（多步驟）— rubric 模式
// ═══════════════════════════════════════════
{
  "mode": "rubric",
  "full_score": 20,
  "dimensions": [
    {
      "name": "step_accuracy",
      "label": "步驟正確性",
      "weight": 10,
      "scoring_method": "per_step",     // 每步驟獨立計分
      "points_per_step": 2,             // 5 步 × 2 分
      "partial_credit": true
    },
    {
      "name": "step_order",
      "label": "操作順序",
      "weight": 5,
      "criteria": {
        "all_correct_order": 5,
        "partial_correct": "proportion" // 按比例
      }
    },
    {
      "name": "efficiency",
      "label": "操作效率",
      "weight": 3,
      "criteria": {
        "no_wrong_clicks": 3,           // 無誤點 = 3 分
        "1_to_2_wrong": 2,
        "3_to_5_wrong": 1,
        "more_than_5": 0
      }
    },
    {
      "name": "time",
      "label": "完成時間",
      "weight": 2,
      "criteria": {
        "under_30s": 2,
        "30s_to_60s": 1,
        "over_60s": 0
      }
    }
  ]
}

// ═══════════════════════════════════════════
// 拖放操作題 — rubric 模式
// ═══════════════════════════════════════════
{
  "mode": "rubric",
  "full_score": 15,
  "dimensions": [
    {
      "name": "placement_accuracy",
      "label": "放置正確性",
      "weight": 10,
      "scoring_method": "per_correct",
      "points_per_item": 2,             // 5 個項目 × 2 分
      "partial_credit": true
    },
    {
      "name": "attempts",
      "label": "嘗試次數",
      "weight": 3,
      "criteria": {
        "first_try": 3,
        "with_retry": 1,
        "gave_up": 0
      }
    },
    {
      "name": "time",
      "label": "完成時間",
      "weight": 2,
      "criteria": {
        "under_30s": 2,
        "30s_to_60s": 1,
        "over_60s": 0
      }
    }
  ]
}

// ═══════════════════════════════════════════
// 分支情境題 — weighted 模式
// ═══════════════════════════════════════════
{
  "mode": "weighted",
  "full_score": 10,
  "option_scores": [
    { "option_index": 0, "score": 10, "feedback": "最佳做法！立即道歉展現專業態度。" },
    { "option_index": 1, "score": 5,  "feedback": "可接受，但缺少即時關懷。" },
    { "option_index": 2, "score": 2,  "feedback": "不建議，應先自行處理再上報。" }
  ]
}
```

### 10.3 操作紀錄（action_log）

實作題需要記錄使用者的完整操作過程，才能做多維度評分：

```jsonc
// 存入 quiz_attempts.answers_json 中每題的 action_log
{
  "question_id": 15,
  "question_type": "hotspot_sequence",
  "action_log": [
    { "ts": 0,     "action": "start" },
    { "ts": 2.3,   "action": "click", "x": 155, "y": 210, "region": "r1", "correct": true },
    { "ts": 5.1,   "action": "click", "x": 300, "y": 100, "region": null, "correct": false },
    { "ts": 6.8,   "action": "click", "x": 310, "y": 150, "region": "r2", "correct": true },
    { "ts": 9.2,   "action": "click", "x": 450, "y": 300, "region": "r3", "correct": true },
    { "ts": 11.0,  "action": "complete" }
  ],
  "total_time_seconds": 11.0,
  "total_clicks": 4,
  "wrong_clicks": 1,
  "steps_completed": 3,
  "steps_total": 3,
  "steps_in_order": true,
  // — 評分結果 —
  "score_breakdown": {
    "step_accuracy": { "earned": 6, "max": 6, "detail": "3/3 步驟正確" },
    "step_order":    { "earned": 5, "max": 5, "detail": "順序完全正確" },
    "efficiency":    { "earned": 2, "max": 3, "detail": "1 次誤點" },
    "time":          { "earned": 2, "max": 2, "detail": "11 秒完成" }
  },
  "total_score": 15,
  "max_score": 16
}
```

### 10.4 評分引擎邏輯

```js
// server/services/quizScorer.js

function scoreQuestion(question, userAnswer) {
  const { scoring_json, answer_json, points } = question;
  const rule = JSON.parse(scoring_json) || { mode: 'exact', full_score: points };

  switch (rule.mode) {
    case 'exact':
      return scoreExact(answer_json, userAnswer, rule);
    case 'partial':
      return scorePartial(answer_json, userAnswer, rule);
    case 'weighted':
      return scoreWeighted(userAnswer, rule);
    case 'rubric':
      return scoreRubric(userAnswer, rule);
    case 'ai_judge':
      return scoreWithAI(question, userAnswer, rule);  // async
  }
}

// rubric 評分（實作題核心）
function scoreRubric(userAnswer, rule) {
  const breakdown = {};
  let totalEarned = 0;

  for (const dim of rule.dimensions) {
    let earned = 0;
    switch (dim.scoring_method) {
      case 'per_step':
        earned = userAnswer.steps_completed * dim.points_per_step;
        break;
      case 'per_correct':
        earned = userAnswer.correct_count * dim.points_per_item;
        break;
      default:
        // 查找 criteria 匹配
        earned = matchCriteria(dim.criteria, userAnswer);
    }
    earned = Math.min(earned, dim.weight);  // 不超過該維度上限
    breakdown[dim.name] = { earned, max: dim.weight };
    totalEarned += earned;
  }

  return {
    score: Math.min(totalEarned, rule.full_score),
    max: rule.full_score,
    breakdown
  };
}
```

### 10.5 AI 判題流程

用於開放式填空和複雜操作的語意判定：

```
POST /api/training/quiz/ai-judge
Body: { question_id, user_answer, attempt_id }

流程:
1. 讀取 question 的 scoring_json.judge_prompt + rubric
2. 組合 prompt:
   「根據以下評分標準，判斷學員回答的得分。
    題目: {question_text}
    學員回答: {user_answer}
    評分標準: {rubric}
    回傳 JSON: { scores: [{ criterion, points, reason }], total, feedback }」
3. 送 Gemini Flash
4. 解析回傳 JSON → 存入 answers_json.score_breakdown
5. 標記 quiz_attempts.review_status = 'auto'（AI 判完）
```

### 10.6 人工複審

AI 判題或 rubric 評分結果可讓出題者/管理者複審：

```
quiz_attempts.review_status:
  - 'auto'           → 純自動評分，無需複審
  - 'pending_review'  → 含 AI 判題或 rubric 實作題，等待複審
  - 'reviewed'        → 已人工複審

GET  /api/training/admin/pending-reviews          ← 待複審清單
PUT  /api/training/quiz-attempts/:aid/review      ← 複審（調整分數 + 備註）
Body: {
  question_scores: [
    { question_id: 15, adjusted_score: 14, reason: "步驟正確但漏看提示" }
  ]
}
```

### 10.7 評分設定 UI（出題者介面）

```
┌─ 題目編輯器 ─────────────────────────────────────┐
│                                                   │
│  題目: [請在畫面中依序完成以下操作...]              │
│  類型: Hotspot 序列操作                            │
│  滿分: [20] 分                                    │
│                                                   │
│  ┌─ 評分標準 ─────────────────────────────────┐  │
│  │  評分模式: [Rubric 多維度 ▼]                 │  │
│  │                                              │  │
│  │  維度 1: 步驟正確性                           │  │
│  │    權重: [10] 分                              │  │
│  │    方式: [每步驟計分 ▼]  每步 [2] 分          │  │
│  │    ☑ 允許部分給分                             │  │
│  │                                              │  │
│  │  維度 2: 操作順序                             │  │
│  │    權重: [5] 分                               │  │
│  │    全部正確: [5]  部分正確: [按比例]           │  │
│  │                                              │  │
│  │  維度 3: 操作效率                             │  │
│  │    權重: [3] 分                               │  │
│  │    無誤點: [3]  1-2次: [2]  3-5次: [1]       │  │
│  │                                              │  │
│  │  維度 4: 完成時間                             │  │
│  │    權重: [2] 分                               │  │
│  │    <30秒: [2]  30-60秒: [1]  >60秒: [0]     │  │
│  │                                              │  │
│  │  [+ 新增維度]  [AI 建議評分標準]              │  │
│  └──────────────────────────────────────────────┘  │
│                                                   │
│  [預覽] [儲存]                                    │
└───────────────────────────────────────────────────┘
```

---

## 11. 課程通知系統

### 11.1 通知類型

| 通知事件 | 觸發時機 | 接收者 | 方式 |
|---------|---------|--------|------|
| **課程指派** | 管理者指派課程 | 被指派的學員 | Email + 系統內通知 |
| **到期提醒** | 截止日前 N 天 | 未完成的學員 | Email |
| **逾期警告** | 超過截止日 | 學員 + 指派者 | Email |
| **測驗完成** | 學員完成測驗 | 指派者/課程 owner | 系統內通知 |
| **測驗未通過** | 分數低於及格 | 學員（附建議） | Email + 系統內通知 |
| **待複審** | AI 判題完成等待人工複審 | 課程 owner/develop | 系統內通知 |
| **新課程發佈** | 課程 publish | 被分享的使用者 | 系統內通知 |
| **課程更新** | 已發佈課程內容變更 | 已完成的學員（選配） | 系統內通知 |

### 11.2 DB 表

```sql
-- 系統內通知
CREATE TABLE training_notifications (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    user_id         NUMBER NOT NULL REFERENCES users(id),
    type            VARCHAR2(30) NOT NULL,
    -- assigned | due_reminder | overdue | quiz_completed | quiz_failed
    -- | pending_review | course_published | course_updated
    title           NVARCHAR2(500) NOT NULL,
    message         NCLOB,
    course_id       NUMBER REFERENCES courses(id) ON DELETE CASCADE,
    link_url        VARCHAR2(500),                   -- 點擊跳轉 URL
    is_read         NUMBER(1) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_train_notif_user ON training_notifications(user_id, is_read);

-- 通知設定（課程層級）
CREATE TABLE course_notification_settings (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    remind_before_days NUMBER DEFAULT 3,             -- 到期前幾天提醒
    remind_overdue  NUMBER(1) DEFAULT 1,             -- 是否發送逾期通知
    notify_on_complete NUMBER(1) DEFAULT 1,          -- 學員完成時通知 owner
    notify_on_fail  NUMBER(1) DEFAULT 1,             -- 學員未通過時通知學員
    email_enabled   NUMBER(1) DEFAULT 1,             -- 是否啟用 Email 通知
    CONSTRAINT uq_course_notif UNIQUE (course_id)
);
```

### 11.3 通知流程

```
┌─ 觸發源 ─────────────────────────────────────┐
│                                               │
│  課程指派 ──→ 立即發送指派通知                  │
│  定時排程 ──→ 每日檢查到期/逾期                 │
│  測驗提交 ──→ 立即發送結果通知                  │
│  課程發佈 ──→ 立即通知被分享者                  │
│                                               │
└──────────────────┬────────────────────────────┘
                   │
                   ▼
┌─ 通知服務 ───────────────────────────────────┐
│  server/services/trainingNotifier.js          │
│                                               │
│  1. 寫入 training_notifications 表             │
│  2. 若 email_enabled → 呼叫現有 mailService   │
│     （整合 server/services/mailService.js）    │
│                                               │
└───────────────────────────────────────────────┘
```

### 11.4 Email 模板

```js
// 課程指派通知
{
  subject: '[FOXLINK GPT] 您有新的教育訓練課程',
  body: `
    {userName} 您好，

    您已被指派完成以下課程：

    課程名稱：{courseTitle}
    指派者：{assignedByName}
    截止日期：{dueDate}

    請點擊以下連結開始學習：
    {courseUrl}

    FOXLINK GPT 教育訓練平台
  `
}

// 到期提醒
{
  subject: '[FOXLINK GPT] 教育訓練課程即將到期',
  body: `
    {userName} 您好，

    以下課程將於 {dueDate} 到期，請盡速完成：

    課程名稱：{courseTitle}
    目前進度：{progressPercent}%
    剩餘天數：{daysLeft} 天

    {courseUrl}
  `
}

// 測驗未通過
{
  subject: '[FOXLINK GPT] 測驗結果通知',
  body: `
    {userName} 您好，

    您在「{courseTitle}」的測驗結果如下：

    得分：{score} / {totalPoints}（{percent}%）
    及格標準：{passScore}%
    狀態：未通過

    剩餘重測次數：{remainingAttempts}
    建議複習章節：{suggestedLessons}

    {courseUrl}
  `
}
```

### 11.5 定時排程

整合現有 scheduler 架構：

```js
// server 啟動時註冊排程
const cron = require('node-cron');

// 每天早上 8:00 檢查到期提醒
cron.schedule('0 8 * * *', async () => {
  await trainingNotifier.checkDueReminders(db);
  await trainingNotifier.checkOverdue(db);
});
```

### 11.6 前端通知元件

```tsx
// Sidebar 或 Header 新增通知鈴鐺 icon
// 顯示未讀通知數量 badge
// 點擊展開通知列表

// 通知面板
┌─ 通知 (3) ──────────────────────────────┐
│                                          │
│  🔵 新課程指派：FOXLINK GPT 操作教學      │
│     截止日: 2026-04-15  |  2 小時前       │
│                                          │
│  🔵 測驗未通過：系統管理教學              │
│     得分 55/100  |  昨天                  │
│                                          │
│  ⚪ 課程更新：AI 對話進階                 │
│     新增 2 個章節  |  3 天前              │
│                                          │
│  [查看全部] [全部標為已讀]                │
└──────────────────────────────────────────┘
```

### 11.7 API 路由（通知相關）

```
── 通知 ──
GET    /api/training/notifications                  ← 我的通知列表
GET    /api/training/notifications/unread-count      ← 未讀數量
PUT    /api/training/notifications/:id/read          ← 標記已讀
PUT    /api/training/notifications/read-all           ← 全部已讀
DELETE /api/training/notifications/:id                ← 刪除通知

── 通知設定 ──
GET    /api/training/courses/:id/notification-settings    ← 取得通知設定
PUT    /api/training/courses/:id/notification-settings    ← 更新通知設定

── 手動發送 ──
POST   /api/training/courses/:id/send-notification        ← 手動發送通知
Body: { type: 'custom', user_ids: [...], message: '...' }
```

---

## 12. 培訓專案 (Training Program)

### 12.1 概念

培訓專案是**指派管理的上層容器**，解決「逐課程逐人指派」的效率問題：

```
培訓專案                     vs        逐課程指派
─────────────                          ─────────────
建立專案「新人到職訓練」                 指派課程 A 給 50 人
├── 對象：製造部全體                    指派課程 B 給 50 人
├── 課程：A, B, C（或引用學習路徑）      指派課程 C 給 50 人
├── 期間：4/1 - 4/30                    設定截止日 x3
└── 一鍵建立 → 自動展開 150 筆指派       手動操作 150 次
```

### 12.2 培訓專案 vs 學習路徑

| | 學習路徑 (Learning Path) | 培訓專案 (Training Program) |
|--|-------------------------|---------------------------|
| **性質** | 內容結構（哪些課、什麼順序） | 行政管理（誰、何時、為何） |
| **類比** | 課綱 / 教學大綱 | 開班通知 / 訓練計畫書 |
| **關係** | 可被多個專案引用 | 可引用一條路徑或自選課程 |
| **重用** | 定義一次，多次開班 | 每個專案是獨立的執行實例 |
| **重點** | 課程順序 + 前置條件 | 對象 + 時間 + 追蹤 + 通知 |

兩者共存，不互相取代。

### 12.3 DB 表結構

```sql
-- ============================================================
-- 學習路徑
-- ============================================================
CREATE TABLE learning_paths (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    title           NVARCHAR2(500) NOT NULL,
    description     NCLOB,
    created_by      NUMBER REFERENCES users(id),
    is_public       NUMBER(1) DEFAULT 0,
    status          VARCHAR2(20) DEFAULT 'draft',    -- draft | published | archived
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 學習路徑中的課程（有序，含前置條件）
CREATE TABLE learning_path_courses (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    path_id         NUMBER NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    sort_order      NUMBER DEFAULT 0,
    is_required     NUMBER(1) DEFAULT 1,             -- 1=必修, 0=選修
    prerequisite_course_id NUMBER REFERENCES courses(id) ON DELETE SET NULL,
    -- 前置條件：必須完成此課程才能開始本課程（NULL=無前置）
    CONSTRAINT uq_path_course UNIQUE (path_id, course_id)
);

-- ============================================================
-- 培訓專案
-- ============================================================
CREATE TABLE training_programs (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    title           NVARCHAR2(500) NOT NULL,
    description     NCLOB,
    purpose         NCLOB,                           -- 專案目的
    created_by      NUMBER REFERENCES users(id),
    status          VARCHAR2(20) DEFAULT 'draft',    -- draft | active | completed | archived
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    -- 引用學習路徑（二選一：引用路徑 或 自選課程）
    learning_path_id NUMBER REFERENCES learning_paths(id) ON DELETE SET NULL,
    -- 通知設定
    remind_before_days NUMBER DEFAULT 3,
    notify_overdue  NUMBER(1) DEFAULT 1,
    email_enabled   NUMBER(1) DEFAULT 1,
    -- 複訓設定
    recurrence_type VARCHAR2(20),                    -- NULL | yearly | half_yearly | quarterly | custom
    recurrence_months NUMBER,                        -- custom 時的月數
    auto_reassign   NUMBER(1) DEFAULT 0,             -- 到期自動建立下一期
    reset_mode      VARCHAR2(20) DEFAULT 'full',     -- full（全部重來）| quiz_only（只重考）
    -- 模板
    is_template     NUMBER(1) DEFAULT 0,             -- 1=可作為模板重用
    template_source_id NUMBER REFERENCES training_programs(id) ON DELETE SET NULL,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 培訓專案中的課程（不引用學習路徑時使用）
CREATE TABLE program_courses (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    program_id      NUMBER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    sort_order      NUMBER DEFAULT 0,
    is_required     NUMBER(1) DEFAULT 1,
    CONSTRAINT uq_program_course UNIQUE (program_id, course_id)
);

-- 培訓專案的對象群組
CREATE TABLE program_targets (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    program_id      NUMBER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    target_type     VARCHAR2(20) NOT NULL,
    -- user | role | dept | profit_center | org_section | org_group
    target_id       VARCHAR2(100) NOT NULL,
    CONSTRAINT uq_program_target UNIQUE (program_id, target_type, target_id)
);

-- 培訓專案展開後的個人指派（取代原 course_assignments）
CREATE TABLE program_assignments (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    program_id      NUMBER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id         NUMBER NOT NULL REFERENCES users(id),
    status          VARCHAR2(20) DEFAULT 'pending',  -- pending | in_progress | completed | overdue | exempted
    due_date        DATE,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    score           NUMBER,                          -- 最高測驗分數（冗餘，方便查詢）
    passed          NUMBER(1),
    exempted_by     NUMBER REFERENCES users(id),     -- 免訓核准者
    exempted_reason NVARCHAR2(500),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_prog_assign UNIQUE (program_id, course_id, user_id)
);
```

### 12.4 培訓專案工作流程

```
┌─ 建立培訓專案 ──────────────────────────────────────┐
│                                                      │
│  1. 填寫基本資訊                                      │
│     ├── 標題：2026 Q2 新人到職訓練                    │
│     ├── 目的：確保新進人員熟悉系統操作                  │
│     ├── 期間：2026/04/01 - 2026/04/30                │
│     └── 複訓：每年自動建立                            │
│                                                      │
│  2. 選擇課程                                         │
│     ├── 方式 A：引用學習路徑「FOXLINK GPT 入門」       │
│     └── 方式 B：自選課程 [基礎操作] [AI對話] [技能]    │
│                                                      │
│  3. 指定對象                                         │
│     ├── + 部門：製造一部                              │
│     ├── + 部門：製造二部                              │
│     ├── + 角色：user（全體一般使用者）                 │
│     └── + 個人：王小明, 李小華（額外加入）              │
│                                                      │
│  4. 預覽 & 啟動                                      │
│     ├── 預覽：展開後共 120 人 × 3 課程 = 360 筆指派   │
│     ├── 排除：已完成相同課程的人（可選）                │
│     └── [啟動專案] → 自動建立指派 + 發送通知           │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 12.5 自動展開邏輯

```js
// POST /api/training/programs/:id/activate
async function activateProgram(programId) {
  const program = await getProgram(programId);
  const courses = await getProgramCourses(program);  // 從路徑或自選
  const users = await resolveTargetUsers(program);    // 展開群組為個人

  for (const user of users) {
    for (const course of courses) {
      // 檢查是否已有有效指派
      const existing = await db.prepare(
        `SELECT id FROM program_assignments
         WHERE program_id=:pid AND course_id=:cid AND user_id=:uid`
      ).get({ pid: programId, cid: course.id, uid: user.id });

      if (!existing) {
        await db.prepare(`INSERT INTO program_assignments ...`).run({
          program_id: programId,
          course_id: course.id,
          user_id: user.id,
          due_date: program.end_date,
          status: 'pending'
        });
      }
    }
  }

  // 發送通知
  await trainingNotifier.sendProgramAssigned(program, users, courses);

  // 更新專案狀態
  await db.prepare(`UPDATE training_programs SET status='active' WHERE id=?`).run(programId);
}
```

### 12.6 新成員自動加入

當有新人加入目標群組時，定時排程自動補指派：

```js
// 每日排程檢查
cron.schedule('0 7 * * *', async () => {
  const activePrograms = await db.prepare(
    `SELECT * FROM training_programs WHERE status='active' AND end_date >= SYSDATE`
  ).all();

  for (const program of activePrograms) {
    const currentUsers = await resolveTargetUsers(program);
    const assignedUsers = await getAssignedUsers(program.id);
    const newUsers = currentUsers.filter(u => !assignedUsers.includes(u.id));

    if (newUsers.length > 0) {
      await createAssignments(program, newUsers);
      await trainingNotifier.sendProgramAssigned(program, newUsers);
    }
  }
});
```

### 12.7 複訓自動建立

```js
// 每日排程檢查即將到期的培訓專案
cron.schedule('0 6 * * *', async () => {
  const expiring = await db.prepare(`
    SELECT * FROM training_programs
    WHERE status = 'completed'
      AND recurrence_type IS NOT NULL
      AND auto_reassign = 1
      AND next_recurrence_date <= SYSDATE + 7
  `).all();

  for (const program of expiring) {
    // 複製專案，更新日期
    const newProgram = await duplicateProgram(program, {
      start_date: calculateNextStart(program),
      end_date: calculateNextEnd(program),
      template_source_id: program.is_template ? program.id : program.template_source_id
    });
    // 自動啟動
    await activateProgram(newProgram.id);
  }
});
```

### 12.8 免訓機制

對於已經熟悉操作的資深員工，允許免訓：

```
PUT /api/training/assignments/:id/exempt
Body: { reason: "已具備相關認證" }

免訓條件（可設定）:
├── 管理者手動核准
├── 過去 N 個月內已通過相同課程
└── 擁有特定認證/資歷
```

### 12.9 專案級報表

```
┌─ 培訓專案儀表板 ───────────────────────────────────┐
│                                                     │
│  專案：2026 Q2 新人到職訓練                          │
│  期間：04/01 - 04/30  │  狀態：進行中               │
│                                                     │
│  ┌── 整體完成率 ──┐  ┌── 課程完成率 ────────────┐   │
│  │                │  │                          │   │
│  │    62%         │  │ 基礎操作   ████████░░ 80%│   │
│  │   ██████░░░░   │  │ AI 對話    █████░░░░░ 55%│   │
│  │                │  │ 技能使用   ████░░░░░░ 40%│   │
│  │ 74/120 人完成  │  │                          │   │
│  └────────────────┘  └──────────────────────────┘   │
│                                                     │
│  ┌── 部門進度 ──────────────────────────────────┐   │
│  │ 製造一部  ████████████░░ 85%  (34/40)        │   │
│  │ 製造二部  ██████░░░░░░░ 50%  (25/50)         │   │
│  │ 品保部    █████████████░ 90%  (18/20)        │   │
│  │ 研發部    ███░░░░░░░░░░ 30%  ( 3/10)  ⚠     │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  [匯出報表] [發送催促通知] [查看未完成名單]           │
└─────────────────────────────────────────────────────┘
```

### 12.10 API 路由

```
── 學習路徑 ──
GET    /api/training/paths                              ← 路徑列表
POST   /api/training/paths                              ← 建立路徑
GET    /api/training/paths/:id                          ← 路徑詳情（含課程）
PUT    /api/training/paths/:id                          ← 編輯路徑
DELETE /api/training/paths/:id
POST   /api/training/paths/:id/courses                  ← 新增課程到路徑
PUT    /api/training/paths/:id/courses/reorder          ← 排序
DELETE /api/training/paths/:id/courses/:cid             ← 移除

── 培訓專案 ──
GET    /api/training/programs                           ← 專案列表
POST   /api/training/programs                           ← 建立專案
GET    /api/training/programs/:id                       ← 專案詳情
PUT    /api/training/programs/:id                       ← 編輯專案
DELETE /api/training/programs/:id
POST   /api/training/programs/:id/activate              ← 啟動（展開指派）
POST   /api/training/programs/:id/complete              ← 結案
POST   /api/training/programs/:id/duplicate             ← 複製為新專案
POST   /api/training/programs/:id/duplicate-as-template ← 另存為模板

── 專案對象 ──
GET    /api/training/programs/:id/targets               ← 對象群組列表
POST   /api/training/programs/:id/targets               ← 新增對象
DELETE /api/training/programs/:id/targets/:tid           ← 移除對象
GET    /api/training/programs/:id/preview-users          ← 預覽展開後的人員清單

── 專案指派 ──
GET    /api/training/programs/:id/assignments            ← 指派清單（含進度）
PUT    /api/training/assignments/:aid/exempt              ← 免訓
POST   /api/training/programs/:id/send-reminder          ← 催促通知

── 專案報表 ──
GET    /api/training/programs/:id/report/overview        ← 總覽
GET    /api/training/programs/:id/report/by-department   ← 依部門
GET    /api/training/programs/:id/report/by-user         ← 依個人
GET    /api/training/programs/:id/report/export          ← 匯出 Excel
```

---

## 13. 投影片版型模板 (Slide Templates)

### 13.1 目的

降低教材製作門檻，讓非設計人員也能快速產出專業教材。

### 13.2 內建版型

```
新增投影片 → 選擇版型：

┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ ■■■■■■  │ │ ■■  ▨▨  │ │ ▨▨  ■■  │ │ ●  ●  ● │
│ ■■■■■■  │ │ ■■  ▨▨  │ │ ▨▨  ■■  │ │ ○  ○  ○ │
│  標題頁  │ │ 左圖右文 │ │ 右圖左文 │ │ 卡片展示 │
└─────────┘ └─────────┘ └─────────┘ └─────────┘

┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ 1. ▨▨▨  │ │ ▨▨▨▨▨▨  │ │ ■■ | ■■ │ │ ▶ ▨▨▨  │
│ 2. ▨▨▨  │ │ ●       │ │ Do | Don│ │   ▨▨▨▨  │
│ 步驟教學 │ │ 全幅截圖 │ │ 雙欄比較 │ │ 影片頁  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘

┌─────────┐ ┌─────────┐
│ ？▨▨▨▨  │ │  空白   │
│ ○ ○ ○ ○ │ │         │
│ 測驗頁   │ │ 自由編排 │
└─────────┘ └─────────┘
```

### 13.3 版型定義結構

```jsonc
// 版型 = 預填的 content_json 模板
{
  "id": "title_page",
  "name": "標題頁",
  "name_en": "Title Page",
  "thumbnail": "/assets/templates/title_page.svg",
  "content_json": [
    {
      "type": "text",
      "content": "# 課程標題\n\n副標題或說明文字",
      "style": { "textAlign": "center", "fontSize": "2rem" }
    },
    {
      "type": "image",
      "src": "",
      "placeholder": "點擊上傳封面圖片",
      "style": { "maxHeight": "60vh", "objectFit": "cover" }
    }
  ]
}

{
  "id": "step_by_step",
  "name": "步驟教學",
  "content_json": [
    {
      "type": "text",
      "content": "## 操作步驟"
    },
    {
      "type": "steps",
      "items": [
        { "title": "步驟 1", "desc": "說明文字", "image": "" },
        { "title": "步驟 2", "desc": "說明文字", "image": "" },
        { "title": "步驟 3", "desc": "說明文字", "image": "" }
      ]
    }
  ]
}

{
  "id": "fullscreen_hotspot",
  "name": "全幅截圖 + 互動",
  "content_json": [
    {
      "type": "hotspot",
      "image": "",
      "instruction": "請點擊正確的位置",
      "regions": [],
      "placeholder": "上傳系統截圖，然後標記互動區域"
    }
  ]
}
```

---

## 14. AI 助教整合

### 14.1 概念

將現有 FOXLINK GPT 對話能力嵌入學習播放器，學員學習過程中可隨時提問：

```
┌─ 學習播放器 ─────────────────────────────────────┐
│                                                   │
│              [投影片內容]                           │
│                                                   │
├───────────────────────────────────────────────────┤
│  💬 AI 助教                               [收合 ▼]│
│  ┌─────────────────────────────────────────────┐  │
│  │ 學員: 為什麼要先選模型才能開始對話？          │  │
│  │                                             │  │
│  │ AI: 因為不同模型有不同的能力和成本。          │  │
│  │     Pro 適合複雜分析，Flash 適合快速回答。    │  │
│  │     選錯模型可能影響回答品質或產生不必要的     │  │
│  │     token 費用。                             │  │
│  │     （參考：本課程 章節2 投影片3）             │  │
│  ├─────────────────────────────────────────────┤  │
│  │ [輸入問題...]                        [發送]  │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

### 14.2 實作方式

```js
// AI 助教的 system prompt 自動注入課程內容
const systemPrompt = `
你是 FOXLINK GPT 教育訓練平台的 AI 助教。
學員正在學習課程「${course.title}」的章節「${lesson.title}」。

當前投影片內容：
${currentSlide.content_text}

整個課程大綱：
${courseSyllabus}

規則：
1. 只根據課程內容回答，不要編造資訊
2. 如果問題超出課程範圍，引導學員完成課程後再深入了解
3. 回答要簡潔、適合學習情境
4. 可以引用「章節X 投影片Y」作為參考
5. 語言：跟隨學員的語言（zh-TW / en / vi）
`;

// API: POST /api/training/courses/:id/ai-tutor
// Body: { message, lesson_id, slide_id, session_id }
// 回傳 SSE streaming（複用現有 chat 架構）
```

### 14.3 AI 助教記錄

```sql
-- 記錄 AI 助教對話（供分析哪些內容學員最常卡關）
CREATE TABLE tutor_conversations (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    lesson_id       NUMBER REFERENCES course_lessons(id),
    slide_id        NUMBER REFERENCES course_slides(id),
    user_id         NUMBER NOT NULL REFERENCES users(id),
    question        NCLOB NOT NULL,
    answer          NCLOB,
    model_key       VARCHAR2(50),
    input_tokens    NUMBER DEFAULT 0,
    output_tokens   NUMBER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

教材分析時可統計「哪個投影片被問最多問題」→ 內容可能需要改善。

---

## 15. 學習筆記 + 書籤

```sql
CREATE TABLE user_course_notes (
    id              NUMBER GENERATED AS IDENTITY PRIMARY KEY,
    user_id         NUMBER NOT NULL REFERENCES users(id),
    course_id       NUMBER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    slide_id        NUMBER REFERENCES course_slides(id) ON DELETE CASCADE,
    content         NCLOB,                           -- 筆記內容
    bookmarked      NUMBER(1) DEFAULT 0,             -- 書籤標記
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    CONSTRAINT uq_user_slide_note UNIQUE (user_id, slide_id)
);
```

播放器側邊欄：
```
┌─ 我的筆記 ──────────────────┐
│                              │
│  📌 章節 1 投影片 3          │
│     登入要用工號不是 email    │
│                              │
│  📝 章節 2 投影片 5          │
│     Flash 模型比較省 token   │
│                              │
│  📌 章節 3 投影片 2          │
│     技能市集在 sidebar 最下面 │
│                              │
│  [匯出筆記 PDF]              │
└──────────────────────────────┘
```

---

## 16. AI 輔助錄製系統

### 16.1 概述

手動製作互動教材效率太低（一張 hotspot 截圖要 5-10 分鐘），需要 AI 輔助錄製系統大幅加速教材製作。此系統由三個核心元件組成：Chrome Extension、錄製控制面板、AI 分析引擎。

### 16.2 系統架構

```
┌─ Chrome Extension ──────────────────────────────────────────┐
│  Content Script         Background Worker        Popup      │
│  (注入目標頁面)         (截圖+通訊)            (狀態面板)   │
│  • click/input 監聽     • captureVisibleTab     • 登入帳號  │
│  • 元素座標回報         • postMessage ↔ 訓練平台 • 開始/停止│
│  • 高亮提示             • 上傳截圖到 server      • 錄製狀態 │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API
┌────────────────────────┴────────────────────────────────────┐
│                 FOXLINK GPT Server                           │
│  ┌──────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │ recording    │  │ AI Analysis     │  │ teaching       │ │
│  │ routes       │  │ (Gemini Vision) │  │ scripts        │ │
│  ├──────────────┤  ├─────────────────┤  ├────────────────┤ │
│  │ sessions     │  │ 截圖 → hotspot  │  │ helpSeedData   │ │
│  │ steps        │  │ 步驟 → 說明     │  │ 匯入腳本       │ │
│  │ processing   │  │ 敏感資訊偵測    │  │ 手動編輯       │ │
│  └──────────────┘  └─────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│               錄製控制面板（前端 React）                      │
│  選擇教學腳本 → 開始錄製 → 截圖+標記 → AI分析 → 生成教材    │
└─────────────────────────────────────────────────────────────┘
```

### 16.3 Chrome Extension 設計

#### 元件架構

```
foxlink-training-extension/
├── manifest.json           ← Manifest V3
├── background.js           ← Service Worker
│   ├── chrome.tabs.captureVisibleTab()   ← 截圖
│   ├── chrome.runtime.onMessage          ← 接收 content script 事件
│   └── fetch → FOXLINK GPT Server        ← 上傳截圖+步驟
├── content.js              ← 注入目標頁面
│   ├── 監聽 click/input/navigation 事件
│   ├── 取得點擊元素資訊（tag, text, selector, rect）
│   ├── 高亮當前操作元素（CSS overlay）
│   └── 錄製中浮動提示 badge
├── popup.html / popup.js   ← Extension 按鈕面板
│   ├── FOXLINK GPT 帳號登入（取得 token）
│   ├── 錄製狀態顯示
│   └── 手動截圖 / 開始 / 停止 按鈕
└── icons/                  ← Extension 圖示
```

#### manifest.json

```json
{
  "manifest_version": 3,
  "name": "FOXLINK GPT 教育訓練錄製工具",
  "version": "1.0.0",
  "description": "錄製系統操作步驟，自動生成互動教材",
  "permissions": [
    "activeTab",
    "tabs",
    "scripting",
    "storage"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icons/icon48.png"
  }
}
```

#### Content Script 事件收集

```js
// content.js — 注入目標頁面
let isRecording = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_RECORDING') isRecording = true;
  if (msg.type === 'STOP_RECORDING') isRecording = false;
});

document.addEventListener('click', (e) => {
  if (!isRecording) return;
  const el = e.target;
  const rect = el.getBoundingClientRect();

  chrome.runtime.sendMessage({
    type: 'USER_ACTION',
    action: 'click',
    element: {
      tag: el.tagName.toLowerCase(),
      text: el.textContent?.slice(0, 100),
      id: el.id,
      className: el.className?.toString?.()?.slice(0, 200),
      selector: generateSelector(el),
      role: el.getAttribute('role'),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      }
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: window.location.href,
    title: document.title,
    timestamp: Date.now()
  });

  // 高亮被點擊的元素
  highlightElement(el);
}, true);

document.addEventListener('input', (e) => {
  if (!isRecording) return;
  chrome.runtime.sendMessage({
    type: 'USER_ACTION',
    action: 'input',
    element: {
      tag: e.target.tagName.toLowerCase(),
      selector: generateSelector(e.target),
      inputType: e.target.type,
      // 不傳送實際輸入值（安全考量）
      hasValue: !!e.target.value
    },
    url: window.location.href,
    timestamp: Date.now()
  });
});

function generateSelector(el) {
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  // 簡化版 selector 生成
  const path = [];
  while (el && el !== document.body) {
    let s = el.tagName.toLowerCase();
    if (el.id) { path.unshift(`#${el.id}`); break; }
    if (el.className) s += '.' + [...el.classList].slice(0, 2).join('.');
    path.unshift(s);
    el = el.parentElement;
  }
  return path.join(' > ');
}

function highlightElement(el) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; z-index: 999999;
    left: ${el.getBoundingClientRect().x - 2}px;
    top: ${el.getBoundingClientRect().y - 2}px;
    width: ${el.getBoundingClientRect().width + 4}px;
    height: ${el.getBoundingClientRect().height + 4}px;
    border: 2px solid #3b82f6; border-radius: 4px;
    background: rgba(59,130,246,0.1);
    pointer-events: none; transition: opacity 0.3s;
  `;
  document.body.appendChild(overlay);
  setTimeout(() => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }, 1500);
}
```

#### Background Worker — 截圖 + 上傳

```js
// background.js
let serverToken = null;
let serverUrl = null;
let currentSessionId = null;
let stepCounter = 0;

chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === 'LOGIN') {
    serverUrl = msg.serverUrl;
    serverToken = msg.token;
  }

  if (msg.type === 'START_SESSION') {
    currentSessionId = msg.sessionId;
    stepCounter = 0;
    // 通知 content script 開始錄製
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tabs[0].id, { type: 'START_RECORDING' });
  }

  if (msg.type === 'STOP_SESSION') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_RECORDING' });
    currentSessionId = null;
  }

  if (msg.type === 'USER_ACTION' && currentSessionId) {
    stepCounter++;
    // 截圖
    const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    // 上傳步驟
    await fetch(`${serverUrl}/api/training/recording/${currentSessionId}/step`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serverToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        step_number: stepCounter,
        action_type: msg.action,
        screenshot_base64: screenshot,
        element_info: msg.element,
        viewport: msg.viewport,
        page_url: msg.url,
        page_title: msg.title,
        timestamp: msg.timestamp
      })
    });
  }

  if (msg.type === 'MANUAL_SCREENSHOT' && currentSessionId) {
    stepCounter++;
    const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    await fetch(`${serverUrl}/api/training/recording/${currentSessionId}/step`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step_number: stepCounter,
        action_type: 'screenshot',
        screenshot_base64: screenshot,
        page_url: msg.url,
        page_title: msg.title,
        timestamp: Date.now()
      })
    });
  }
});
```

### 16.4 通訊協議

#### Extension → Server

```
POST /api/training/recording/:sessionId/step
{
  "step_number": 3,
  "action_type": "click",              // click | input | navigate | scroll | screenshot
  "screenshot_base64": "data:image/png;base64,...",
  "element_info": {
    "tag": "button",
    "text": "登入",
    "id": "login-btn",
    "selector": "#login-btn",
    "role": "button",
    "rect": { "x": 420, "y": 380, "w": 120, "h": 40 }
  },
  "viewport": { "width": 1920, "height": 1080 },
  "page_url": "https://foxlink-gpt.company.com/login",
  "page_title": "FOXLINK GPT - 登入",
  "timestamp": 1712012345678
}

Response: {
  "step_id": 15,
  "ai_processing": true     // 後端開始 AI 分析
}
```

#### Server AI 分析（非同步）

```
POST /api/training/recording/:sessionId/analyze
→ 對每個步驟的截圖呼叫 Gemini Vision:

Prompt:
「分析這張系統操作截圖。使用者剛點擊了位於 (x:420, y:380) 的元素。
1. 識別畫面中所有可互動的 UI 元素（按鈕、輸入框、連結、下拉選單）
2. 回傳每個元素的位置（x%, y%, w%, h% 相對於圖片）、類型、功能說明
3. 標記使用者剛點擊的元素為主要互動點
4. 生成此步驟的操作說明文字（繁體中文）
5. 生成旁白文字（適合 TTS 朗讀，口語化）
6. 偵測是否包含敏感資訊（密碼欄位、個資）
7. 回傳 JSON」

Response:
{
  "regions": [
    { "type": "input", "label": "帳號欄位", "coords": { "x": 35, "y": 42, "w": 30, "h": 5 }, "is_primary": false },
    { "type": "button", "label": "登入按鈕", "coords": { "x": 35, "y": 62, "w": 30, "h": 6 }, "is_primary": true }
  ],
  "instruction": "點擊「登入」按鈕，系統將驗證您的帳號密碼。",
  "narration": "接下來請點擊畫面中央的登入按鈕，完成登入程序。",
  "sensitive_areas": [
    { "type": "password", "coords": { "x": 35, "y": 52, "w": 30, "h": 5 }, "action": "mask" }
  ]
}
```

### 16.5 錄製控制面板 UI

```
┌─ AI 輔助錄製面板 ──────────────────────────────────────────┐
│                                                             │
│  📚 來源: [FOXLINK GPT ▼]  章節: [登入與登出 ▼]            │
│                                                             │
│  ┌─ AI 分析的操作步驟大綱 ──────────────────────────────┐  │
│  │ ☑ 1. 開啟登入頁面                                     │  │
│  │ ☑ 2. 輸入帳號（工號）                                 │  │
│  │ ☑ 3. 輸入密碼                                         │  │
│  │ ☑ 4. 點擊登入按鈕                                     │  │
│  │ ☑ 5. 確認登入成功                                     │  │
│  │ ☐ 6. 點擊登出按鈕                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  🔑 帳號: [TESTUSER]  密碼: [****]  (供 AI/Extension 使用)  │
│  🌐 URL: [http://localhost:5173]  [開啟目標視窗]            │
│                                                             │
│  錄製模式: ○ 手動截圖  ● 自動（每次 click 截圖）           │
│                                                             │
│  [🚀 開始錄製]                                              │
│                                                             │
│  ── 錄製中（步驟 3/6）──                                    │
│                                                             │
│  ┌──────────────────┐  ┌── 操作紀錄 ─────────────────┐    │
│  │ [最新截圖預覽]     │  │ ✓ #1 navigate 登入頁       │    │
│  │                   │  │ ✓ #2 click 帳號欄位        │    │
│  │                   │  │ ✓ #3 input 帳號 (已輸入)    │    │
│  │                   │  │ → 等待: 輸入密碼            │    │
│  └──────────────────┘  │                              │    │
│                        │ AI 分析狀態:                  │    │
│                        │ #1 ✓ 已辨識 3 個區域          │    │
│                        │ #2 ✓ 已辨識 2 個區域          │    │
│                        │ #3 ⏳ 分析中...               │    │
│                        └──────────────────────────────┘    │
│                                                             │
│  [📸 手動截圖] [⏭ 跳過此步驟] [🔄 重新截圖]                │
│  [⏸ 暫停] [⬛ 結束錄製]                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
       ↓ 錄製完成
┌─ AI 後製處理 ───────────────────────────────────────────────┐
│                                                              │
│  ⏳ AI 正在處理錄製結果... (3/6 步驟已完成)                    │
│  ├── ✓ 截圖辨識 + Hotspot 區域標記                           │
│  ├── ✓ 操作說明生成                                          │
│  ├── ✓ 旁白文字生成                                          │
│  ├── ⏳ 敏感資訊偵測 + 自動遮蔽                               │
│  ├── ⬜ 品質檢查                                             │
│  └── ⬜ 自動生成測驗題                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
       ↓ 處理完成
┌─ 生成結果預覽 ──────────────────────────────────────────────┐
│                                                              │
│  ✅ 已生成 6 張投影片  |  6 個 Hotspot  |  3 題測驗          │
│                                                              │
│  ⚠ 品質提醒:                                                │
│  • 步驟 3 截圖略模糊，建議重新截圖                            │
│  • 步驟 2 偵測到密碼欄位，已自動馬賽克                        │
│                                                              │
│  [✎ 進入編輯器調整]  [🔄 重新錄製]  [📤 直接建立教材]        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 16.6 AI 截圖分析 API

```
POST /api/training/ai/analyze-screenshot
Body: {
  screenshot_base64: "data:image/png;base64,...",    // 或 screenshot_url
  click_coords: { x: 420, y: 380 },                 // 可選：使用者點擊位置
  context: "使用者正在進行登入操作，這是第 3 步",      // 可選：上下文
  model_key: "flash"                                 // Gemini model
}
Response: {
  regions: [
    { type: "input", label: "帳號欄位", coords: { x: 35, y: 42, w: 30, h: 5 }, is_primary: false },
    { type: "button", label: "登入按鈕", coords: { x: 35, y: 62, w: 30, h: 6 }, is_primary: true }
  ],
  instruction: "點擊「登入」按鈕",
  narration: "接下來請點擊畫面中央的登入按鈕，完成登入程序。",
  sensitive_areas: [
    { type: "password", coords: { x: 35, y: 52, w: 30, h: 5 } }
  ]
}
```

也可以直接在 HotspotEditor 中使用（一鍵辨識按鈕）：

```
POST /api/training/ai/analyze-screenshot
Body: { screenshot_url: "/api/training/files/course_1/screenshot.png" }
→ 回傳 regions → 直接寫入 hotspot block 的 regions
```

### 16.7 智慧後製

#### 自動品質檢查

```
錄製完成 → AI 逐步驟檢查：
├── 截圖是否模糊 / 解析度太低
├── 前後步驟 URL 是否合理銜接
├── 是否有遺漏步驟（比對教學腳本）
├── Hotspot 區域是否合理（太小 < 1% 或太大 > 50% 警告）
├── 操作說明是否與截圖內容一致
└── 回傳品質報告 + 建議
```

#### 自動敏感資訊遮蔽

```
AI 偵測截圖中的敏感區域：
├── 密碼欄位（type=password 或 ●●● 遮罩文字）→ 自動馬賽克
├── 個人資料（身分證字號、手機號碼格式）→ 標記提醒
├── 真實姓名 / 工號 → 建議替換
├── 信用卡號 / 銀行帳號 → 自動遮蔽
└── 編輯者逐項確認或取消遮蔽

技術實作: Canvas drawImage → 在指定區域套用 Gaussian blur
```

#### 自動生成測驗

```
錄製完 N 個步驟 → AI 自動生成：
├── Hotspot 操作題：「請點擊正確的按鈕完成第 3 步」
│   → 用同一張截圖，正確區域 = 錄製時的 primary region
├── 排序題：「請將以下操作步驟排列正確順序」
│   → 用所有步驟的標題
├── 選擇題：「在登入時，第一步應該做什麼？」
│   → 基於操作說明生成
└── 配對題：「將操作與對應的畫面配對」
    → 用步驟標題 + 截圖縮圖
```

---

## 17. 跨系統教材管理

### 17.1 目標系統登錄

```sql
CREATE TABLE training_systems (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR2(200) NOT NULL,
    url             VARCHAR2(1000),
    description     CLOB,
    icon            VARCHAR2(50),
    login_url       VARCHAR2(1000),
    login_config    CLOB,       -- JSON: { username_selector, password_selector, submit_selector }
    help_source     VARCHAR2(20) DEFAULT 'manual',  -- manual | helpSeedData | import
    created_by      NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### 17.2 教學腳本管理

```sql
CREATE TABLE teaching_scripts (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    system_id       NUMBER NOT NULL,
    module          VARCHAR2(200),
    title           VARCHAR2(500) NOT NULL,
    steps_json      CLOB,       -- [{ order, instruction, expected_url, expected_element, tips, ui_hints }]
    prerequisites   CLOB,
    estimated_time  NUMBER,
    sort_order      NUMBER DEFAULT 0,
    created_by      NUMBER,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

教學腳本可從以下來源匯入：
- **FOXLINK GPT**: 自動讀取 `helpSeedData.js` blocks
- **JSON 檔案**: 結構化步驟格式
- **Excel**: 欄位對應（步驟序號、指示、預期元素、提示）
- **Markdown**: `# 標題` → 章節，`1. 步驟` → steps
- **純文字**: AI 自動解析成步驟格式
- **手動編輯**: 平台內直接建立

### 17.3 錄製工作階段

```sql
CREATE TABLE recording_sessions (
    id              VARCHAR2(36) PRIMARY KEY,
    course_id       NUMBER,
    lesson_id       NUMBER,
    system_id       NUMBER,
    script_id       NUMBER,
    status          VARCHAR2(20) DEFAULT 'recording',
    config_json     CLOB,       -- { target_url, mode, credentials_hint }
    steps_count     NUMBER DEFAULT 0,
    created_by      NUMBER NOT NULL,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    completed_at    TIMESTAMP
);

CREATE TABLE recording_steps (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id      VARCHAR2(36) NOT NULL,
    step_number     NUMBER NOT NULL,
    action_type     VARCHAR2(20),
    screenshot_url  VARCHAR2(500),
    element_json    CLOB,
    viewport_json   VARCHAR2(200),
    page_url        VARCHAR2(1000),
    page_title      VARCHAR2(500),
    ai_regions_json CLOB,
    ai_instruction  CLOB,
    ai_narration    CLOB,
    final_regions_json CLOB,
    final_instruction  CLOB,
    is_sensitive    NUMBER(1) DEFAULT 0,
    mask_regions_json CLOB,
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);
```

### 17.4 跨系統管理 UI

```
┌─ 系統管理 ──────────────────────────────────────────────┐
│                                                          │
│  ┌─ 已登錄系統 ────────────────────────────────────────┐│
│  │ FOXLINK GPT   ✅  http://localhost:5173    [設定]    ││
│  │ Oracle ERP    ✅  https://erp.foxlink.com  [設定]    ││
│  │ PLM 系統      ⚙   https://plm.foxlink.com  [設定]    ││
│  │ HR 系統       ⬜   (未設定)                 [設定]    ││
│  │                                                      ││
│  │ [+ 新增系統]                                         ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌─ Oracle ERP 教學腳本 ───────────────────────────────┐│
│  │ 📁 採購管理                                          ││
│  │   ├── 建立採購單     10 步驟  教材: ✓                 ││
│  │   ├── 採購單審核      8 步驟  教材: ✗  [🎬 錄製]     ││
│  │   └── 採購退貨        6 步驟  教材: ✗  [🎬 錄製]     ││
│  │ 📁 庫存管理                                          ││
│  │   ├── 入庫作業        7 步驟  教材: ✗  [🎬 錄製]     ││
│  │   └── 盤點作業       12 步驟  教材: ✗  [🎬 錄製]     ││
│  │                                                      ││
│  │ [📥 匯入腳本] [✎ 手動新增] [🤖 AI生成腳本]          ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 17.5 API 路由

```
── 系統管理 ──
GET    /api/training/systems                        ← 系統列表
POST   /api/training/systems                        ← 新增系統
PUT    /api/training/systems/:id                    ← 編輯系統
DELETE /api/training/systems/:id

── 教學腳本 ──
GET    /api/training/systems/:id/scripts            ← 腳本列表
POST   /api/training/systems/:id/scripts            ← 新增腳本
PUT    /api/training/scripts/:id                    ← 編輯腳本
DELETE /api/training/scripts/:id
POST   /api/training/scripts/import                 ← 批次匯入（JSON/Excel/Markdown）
POST   /api/training/scripts/ai-generate            ← AI 根據系統 URL 生成腳本

── 錄製 ──
POST   /api/training/recording/start                ← 開始錄製（建立 session）
POST   /api/training/recording/:sessionId/step      ← 上傳步驟（Extension 呼叫）
POST   /api/training/recording/:sessionId/complete   ← 結束錄製
GET    /api/training/recording/:sessionId            ← 錄製狀態 + 步驟列表
POST   /api/training/recording/:sessionId/analyze    ← 觸發 AI 分析所有步驟
POST   /api/training/recording/:sessionId/generate   ← 生成教材（建立投影片）

── AI 分析 ──
POST   /api/training/ai/analyze-screenshot          ← 單張截圖 AI 辨識
POST   /api/training/ai/generate-outline            ← 根據教學腳本生成操作大綱
POST   /api/training/ai/quality-check               ← 品質檢查
POST   /api/training/ai/detect-sensitive             ← 敏感資訊偵測
```

---

## 18. 進階教材維護

### 18.1 教材模板庫

```
錄製完一套教材 → 存為模板：
├── 保留投影片結構和 block 類型
├── 清除特定截圖和資料
├── 保留操作說明和步驟文字
└── 其他部門可從模板建立，只需重新截圖

用途：
├── 同一系統不同環境（測試/正式）的教材
├── 類似流程（如各模組的「新增」操作都類似）
└── 跨部門共用基礎操作教材
```

### 18.2 差異更新（系統升版）

```
目標系統升版，介面改變 →
  ① AI 比對新舊截圖 → 標記有差異的步驟
  ② 只需重新錄製有變更的步驟
  ③ 未變更的步驟自動保留
  ④ 自動產生「版本更新紀錄」

技術:
  Gemini Vision 比較兩張截圖 → 相似度分數 + 差異描述
  相似度 > 90% → 自動保留
  相似度 50-90% → 標記需確認
  相似度 < 50% → 標記需重做
```

### 18.3 多人協作錄製

```
大型系統教材分工錄製：
├── 採購模組 → 指派給採購部 SME（develop 權限）
├── 庫存模組 → 指派給倉管 SME
├── 財務模組 → 指派給財務 SME
├── 各 SME 錄製自己負責的章節
└── 訓練管理者統一審核 + 調整 + 發佈
```

### 18.4 操作回放驗證

```
錄製的操作序列可以「回放」驗證：
├── 在 Playwright server-side 重播操作步驟
├── 自動比對每步截圖是否與預期一致
├── 發現操作失敗或畫面不符時標記
├── 適用於：系統升版後批次驗證所有教材是否仍有效
```

### 18.5 學習者操作熱力圖

```
學員在 hotspot 互動時的點擊紀錄 → 熱力圖分析：
├── 哪個區域被最多人點錯
├── 平均嘗試次數
├── 學員最常犯錯的步驟
└── 回饋給教材編輯者優化 hotspot 提示和說明
```

### 18.6 Extension 離線模式

```
工廠區域網路不穩定的環境：
├── Extension 先在本地 IndexedDB 快取截圖 + 操作紀錄
├── 回到有網路的環境後批次上傳
├── 上傳後自動觸發 AI 分析
└── 適合需要到現場錄製的場景（設備操作、產線流程）
```

---

## 19. 全自動化教材製作（終極目標）

### 19.1 願景

最終目標是**一鍵生成完整互動教材**：指定系統 + 章節 → AI 全自動操作系統 → 自動截圖 + 標記 + 生成說明 + 出題 → 人工只需審核微調。

```
┌─ 全自動化流程 ────────────────────────────────────────────┐
│                                                            │
│  輸入：                                                     │
│  ├── 目標系統（Oracle ERP）                                 │
│  ├── 教學腳本（建立採購單，10 步驟）                         │
│  └── 測試帳密 + 測試資料                                    │
│                                                            │
│         ↓ 一鍵啟動                                          │
│                                                            │
│  ┌─ Playwright Server ─────────────────────────────────┐  │
│  │  1. 開啟 headless 瀏覽器                              │  │
│  │  2. 自動登入（用系統設定的 login_config）              │  │
│  │  3. 逐步執行教學腳本的操作步驟                         │  │
│  │     step 1: 點擊「採購」選單                           │  │
│  │       → 截圖 → AI 辨識 UI 元素 → 標記 hotspot         │  │
│  │       → 生成說明文字 + 旁白                            │  │
│  │     step 2: 點擊「新增」按鈕                           │  │
│  │       → 截圖 → ...                                    │  │
│  │     step 3: 填入供應商（用測試資料）                    │  │
│  │       → 截圖 → ...                                    │  │
│  │     ...                                                │  │
│  │  4. 每步驟等待頁面穩定後截圖（避免截到 loading 狀態）   │  │
│  │  5. 偵測操作失敗（元素找不到/頁面錯誤）→ 自動重試或暫停│  │
│  └───────────────────────────────────────────────────────┘  │
│                                                            │
│         ↓ 所有步驟完成                                      │
│                                                            │
│  ┌─ AI 後製引擎 ───────────────────────────────────────┐  │
│  │  1. 批次 Gemini Vision 分析所有截圖                    │  │
│  │  2. 自動建立 Hotspot regions + 正確/錯誤區域           │  │
│  │  3. 生成每步驟操作說明 + 旁白文字                       │  │
│  │  4. 敏感資訊偵測 → 自動馬賽克                           │  │
│  │  5. 品質檢查 → 標記問題步驟                             │  │
│  │  6. 自動生成測驗題（hotspot 操作題 + 排序題 + 選擇題）  │  │
│  │  7. 自動 TTS 生成語音旁白（三語：zh-TW / en / vi）      │  │
│  │  8. 自動翻譯教材（LLM 翻譯說明文字 + 題目）            │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                            │
│         ↓ 自動生成                                          │
│                                                            │
│  輸出：                                                     │
│  ├── 完整課程（含所有章節 + 投影片 + hotspot + 說明）       │
│  ├── 測驗題庫（含評分標準）                                 │
│  ├── 三語翻譯版                                            │
│  ├── TTS 語音旁白                                          │
│  └── 品質報告（需人工確認的步驟標記）                       │
│                                                            │
│         ↓ 人工審核                                          │
│                                                            │
│  編輯者在現有編輯器中：                                      │
│  ├── 瀏覽 AI 生成的教材初稿                                │
│  ├── 調整 hotspot 區域位置/大小                             │
│  ├── 修改說明文字                                          │
│  ├── 調整投影片順序                                        │
│  ├── 處理品質報告標記的問題                                 │
│  └── 確認 → 發佈                                           │
│                                                            │
│  預估：手動製作 50 張投影片 = 8-10 小時                      │
│        全自動製作 + 審核 = 30 分鐘 - 1 小時                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 19.2 Playwright 自動化引擎

```js
// server/services/playwrightRecorder.js

const { chromium } = require('playwright');

async function autoRecord(session) {
  const { target_url, login_config, script_steps, test_data } = session;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // 自動登入
  await page.goto(login_config.login_url);
  await page.fill(login_config.username_selector, test_data.username);
  await page.fill(login_config.password_selector, test_data.password);
  await page.click(login_config.submit_selector);
  await page.waitForNavigation();

  const results = [];

  for (const step of script_steps) {
    try {
      // 等待目標元素出現
      if (step.expected_element) {
        await page.waitForSelector(step.expected_element, { timeout: 10000 });
      }
      if (step.expected_url) {
        await page.waitForURL(step.expected_url, { timeout: 10000 });
      }

      // 截圖（操作前）
      const screenshotBefore = await page.screenshot({ type: 'png' });

      // 執行操作
      if (step.action === 'click' && step.target_selector) {
        const el = await page.$(step.target_selector);
        const box = await el.boundingBox();
        await el.click();
        results.push({
          step_number: step.order,
          action: 'click',
          screenshot: screenshotBefore,
          element_rect: box,
          url: page.url(),
          title: await page.title()
        });
      } else if (step.action === 'input' && step.target_selector) {
        await page.fill(step.target_selector, step.input_value || test_data[step.input_key] || '');
        results.push({
          step_number: step.order,
          action: 'input',
          screenshot: screenshotBefore,
          url: page.url(),
          title: await page.title()
        });
      } else {
        // 純截圖步驟（導覽/確認畫面）
        results.push({
          step_number: step.order,
          action: 'screenshot',
          screenshot: screenshotBefore,
          url: page.url(),
          title: await page.title()
        });
      }

      // 操作後等待頁面穩定
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);

    } catch (err) {
      // 操作失敗 → 截圖當前狀態 + 記錄錯誤
      const errorScreenshot = await page.screenshot({ type: 'png' });
      results.push({
        step_number: step.order,
        action: 'error',
        screenshot: errorScreenshot,
        error: err.message,
        url: page.url()
      });
    }
  }

  await browser.close();
  return results;
}
```

### 19.3 教學腳本 → Playwright 指令轉換

教學腳本是人類可讀的步驟描述，需要轉換成 Playwright 可執行的指令：

```
教學腳本步驟:
{ instruction: "從主選單點擊「採購」→「採購單」", ui_hints: ["menu:採購", "submenu:採購單"] }

→ AI 轉換（Gemini）:

Prompt:
「將以下操作步驟轉換為 Playwright 指令。目標系統是 Oracle ERP。
步驟: 從主選單點擊「採購」→「採購單」
UI 提示: menu:採購, submenu:採購單

回傳 JSON:
[
  { "action": "click", "target_selector": "[data-menu='採購']", "wait_after_ms": 500 },
  { "action": "click", "target_selector": "[data-submenu='採購單']", "wait_after_ms": 1000 }
]」

→ 可能需要多輪嘗試（AI 猜的 selector 不一定對）
→ 失敗時自動嘗試替代 selector 或切換到人工模式
```

### 19.4 智慧容錯機制

全自動操作不可能 100% 成功，需要完善的容錯：

```
┌─ 容錯策略 ──────────────────────────────────────────┐
│                                                      │
│  Level 1: 自動重試                                   │
│  ├── 元素找不到 → 等待 3 秒後重試 × 3 次             │
│  ├── 頁面 loading → 等待 networkidle                 │
│  └── 彈出視窗 → 自動關閉（dismiss dialog）           │
│                                                      │
│  Level 2: 替代定位                                   │
│  ├── selector 失效 → 嘗試 text match                 │
│  ├── text match 失效 → 嘗試 role + accessible name   │
│  └── 全部失效 → 截圖 + AI 視覺定位                   │
│                                                      │
│  Level 3: 人工介入                                   │
│  ├── 暫停自動化 → 通知編輯者                         │
│  ├── 編輯者遠端操作（透過 VNC/截圖回傳）             │
│  ├── 編輯者完成操作 → 繼續自動化                     │
│  └── 記錄人工操作 → 更新教學腳本                     │
│                                                      │
│  Level 4: 跳過                                       │
│  ├── 標記此步驟為「需手動補錄」                      │
│  ├── 繼續執行後續步驟                                │
│  └── 最終品質報告中列出跳過的步驟                    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 19.5 自動化程度演進路線圖

```
Phase 2（現在目標）:
  人工操作 80% + AI 輔助 20%
  ├── 人操作系統，AI 自動截圖 + 辨識 + 生成說明
  └── 效率: 手動 8 hr → 半自動 2 hr

Phase 3:
  人工操作 30% + AI 輔助 70%
  ├── AI 根據腳本建議下一步操作，人確認後執行
  ├── 自動偵測操作完成 → 自動進入下一步
  └── 效率: 2 hr → 45 min

Phase 4（終極目標）:
  人工審核 10% + AI 全自動 90%
  ├── AI 全自動操作系統 + 截圖 + 生成教材
  ├── 人只需審核最終結果 + 微調
  ├── 操作失敗時才需要人介入
  └── 效率: 45 min → 10-15 min（含審核）

ROI 估算（以 50 張投影片課程為例）:
  完全手動:     8-10 小時 / 課程
  Phase 2:     1.5-2 小時 / 課程      (5x 加速)
  Phase 3:     30-45 分鐘 / 課程      (15x 加速)
  Phase 4:     10-15 分鐘 / 課程      (40x 加速)
```

### 19.6 品質保證流程

```
全自動生成的教材，上線前必須經過品質保證：

┌─ 自動品質門檻 ─────────────────────────────────────┐
│                                                     │
│  ☑ 所有截圖解析度 ≥ 1280x720                        │
│  ☑ 無模糊截圖（Gemini 評估 clarity score > 0.7）    │
│  ☑ 所有敏感資訊已遮蔽                               │
│  ☑ 步驟順序與教學腳本一致                            │
│  ☑ 每個 hotspot 區域 ≥ 2% 且 ≤ 50% 圖片面積        │
│  ☑ 操作說明不含亂碼/截斷                             │
│  ☑ 測驗題正確答案與教材內容一致                      │
│                                                     │
│  全部通過 → 可直接發佈                               │
│  有未通過 → 標記問題 → 需人工確認                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 20. 檔案儲存

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

## 21. 開發階段計畫

### Phase 1：完整互動教材平台（已實作）

```
Phase 1A — 基礎架構 + 教材 CRUD
├── DB 表建立（Oracle）— 含翻譯表、培訓專案表、學習路徑表
├── 課程分類管理（樹狀，最多 3 層）
├── 課程 CRUD + 狀態管理 (draft/published/archived)
├── 章節管理（排序、CRUD）
├── 權限模型（course_access + can_edit_courses）
├── Sidebar「更多功能」新增「教育訓練」入口
├── /training 路由整合進現有 App.tsx
└── 課程列表首頁（分類瀏覽、搜尋、我的課程、指派課程）

Phase 1B — 互動教材編輯器
├── Block-based 投影片編輯器
├── 投影片版型模板（標題頁、圖文並排、步驟教學、全幅截圖等 10 種）
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
├── 分支播放邏輯
├── 多語言播放（根據使用者語言切換內容 + 音訊）
├── AI 助教面板（嵌入式對話，注入課程 context）
└── 學習筆記 + 書籤

Phase 1E — 測驗 + 評分系統
├── 題型：單選、多選、填空、配對、排序、操作模擬（hotspot/dragdrop）
├── 評分引擎：exact / partial / weighted / rubric 四種模式
├── 實作題多維度評分（正確性、順序、效率、時間）
├── 操作紀錄 action_log 收集
├── 計分 + 及格門檻 + 限時測驗 + 重測次數限制
├── 測驗結果頁（分數、每題得分明細、答案解析、歷次紀錄）
├── 評分標準編輯 UI（出題者自訂 scoring_json）
├── AI 輔助出題（Gemini 根據教材內容生成題目 + 評分標準）
└── AI 判題（開放式填空 / 複雜操作的語意判定）

Phase 1F — 培訓專案 + 學習路徑
├── 學習路徑 CRUD（課程串聯 + 前置條件）
├── 培訓專案 CRUD（目的、對象群組、時間起迄）
├── 對象群組指定（部門/角色/利潤中心/個人）
├── 一鍵啟動 → 自動展開個人指派
├── 專案儀表板（完成率、部門進度）
├── 免訓機制
└── 專案模板（儲存為模板、從模板建立）

Phase 1G — 通知系統
├── 系統內通知（鈴鐺 icon + 未讀 badge + 通知面板）
├── Email 通知（整合現有 mailService）
├── 通知類型：指派、到期提醒、逾期、測驗結果、待複審、新課程
├── 課程/專案通知設定（到期前幾天提醒、是否啟用 Email）
├── 定時排程（每日到期/逾期檢查 + 新成員自動加入）
└── 手動發送自訂通知 + 催促通知

Phase 1H — 多語言翻譯
├── 翻譯表架構（course/lesson/slide/quiz/category translations）
├── LLM 批次自動翻譯（zh-TW → en / vi）
├── 翻譯管理介面（狀態、手動編輯、過期偵測）
├── 翻譯後 TTS 音訊生成
└── 播放器 / 測驗 fallback 邏輯（無翻譯時 fallback 到 zh-TW）

Phase 1I — 進度追蹤 + 管理
├── 學習進度記錄
├── 分享管理 UI（仿 skill 分享介面）
├── Admin 管理頁簽：成績查詢、進度報表、專案報表
└── 人工複審介面（AI 判題結果複審 + 分數調整）

Phase 1J — 首個教材專案：FOXLINK GPT 使用教學
├── 結合現有使用手冊（helpSeedData.js）內容
├── 製作互動教材（系統介紹、對話操作、檔案上傳、模型切換等）
├── 截圖 + hotspot 操作模擬
├── 製作測驗題（手動 + AI 輔助）
├── 建立學習路徑 + 培訓專案
└── 發佈為公開課程
```

### Phase 2：AI 輔助錄製 + 跨系統

```
Phase 2A — AI 截圖分析（一鍵辨識）
├── POST /ai/analyze-screenshot API（Gemini Vision）
├── HotspotEditor「AI 辨識」按鈕 → 一鍵建立所有 regions
├── 批次匯入截圖 → 每張自動建立投影片 + AI 辨識
├── 自動敏感資訊偵測 + 馬賽克
└── 從使用手冊章節生成操作步驟大綱

Phase 2B — Chrome Extension 基礎版
├── Manifest V3 Extension 開發
├── Content Script: click/input 事件監聽 + 元素資訊收集
├── Background Worker: captureVisibleTab 截圖 + 上傳
├── Popup: 登入 FOXLINK GPT + 錄製控制
└── 與訓練平台 postMessage 通訊

Phase 2C — 錄製控制面板 + 批次生成
├── 錄製控制面板 UI（選擇腳本 → 開始 → 截圖+標記 → 結束）
├── 錄製模式：手動截圖 / 自動（每次 click 截圖）
├── 每步驟即時 AI 分析 + 生成說明 + 旁白
├── 錄製完成 → AI 後製（品質檢查、敏感遮蔽、自動出題）
└── 一鍵批次建立投影片

Phase 2D — 跨系統教材管理
├── 目標系統登錄管理（training_systems 表）
├── 教學腳本匯入/編輯（JSON/Excel/Markdown/純文字）
├── AI 自動生成教學腳本（根據系統 URL）
├── 系統登入設定（供 Extension 自動導航）
└── Oracle ERP / PLM / HR 系統教材專案
```

### Phase 3：進階功能

```
├── 定期複訓（自動建立下一期培訓專案）
├── iframe 導引模擬（先從 FOXLINK GPT 自身開始）
├── 教材分析儀表板（停留時間、中斷點、題目難度分析）
├── PPT 匯入（.pptx → 自動轉投影片）
├── 教材版本控制（v1→v2，已完成學員可選擇升級）
├── 協作編輯保護（編輯鎖 + 衝突提示）
├── 多人協作錄製（分工 + 統一審核）
├── 教材模板庫（跨課程複用模板）
├── 差異更新（系統升版 → AI 比對新舊截圖 → 只重做有變更的步驟）
├── 操作回放驗證（Playwright 重播 → 驗證教材是否仍有效）
├── 學習者操作熱力圖（點擊紀錄分析 → 找出易犯錯區域）
├── 證書 PDF 產出（pdfkit）
├── 專案報表匯出 Excel
├── 分支流程視覺化編輯器（reactflow）
└── SCORM 匯出（可選）
```

### Phase 4：差異化功能

```
├── Playwright 全自動錄製（AI 根據腳本自動操作 → 人只需審核）
├── Extension 離線模式（IndexedDB 快取 → 批次上傳）
├── 討論區 / Q&A（每課程或每投影片留言）
├── 徽章 / 排行榜（完成課程獲得徽章、部門排行）
├── 微學習模式（5 分鐘短課程，適合手機碎片時間）
├── 離線模式（PWA 離線緩存）
├── 教材市集（跨部門分享教材模板）
└── 學習社群（同課程學員互相討論、分享心得）
```

---

## 22. 首個教材專案：FOXLINK GPT 使用教學

### 22.1 課程結構規劃

以現有使用手冊（`helpSeedData.js`）為基礎，轉化為互動教材：

```
學習路徑：FOXLINK GPT 完整培訓
│
├── [必修] 課程 1: 基礎操作教學（前置：無）
│   ├── 章節 1: 系統介紹（slides）
│   │   ├── 投影片: 系統功能總覽
│   │   ├── 投影片: 登入方式說明
│   │   ├── 投影片: 介面導覽（hotspot — 點擊各區域認識功能）
│   │   └── 內嵌測驗: 介面認識小測驗
│   │
│   ├── 章節 2: AI 對話功能（slides + simulation）
│   │   ├── 投影片: 基本對話操作
│   │   ├── 互動: 模型切換操作（hotspot）
│   │   ├── 互動: 檔案上傳練習（hotspot + dragdrop）
│   │   ├── 投影片: 進階功能（語音輸入、Markdown 輸出）
│   │   └── 內嵌測驗: 對話功能測驗
│   │
│   └── 正式測驗（10 題，及格 70 分）
│
├── [必修] 課程 2: 工具與知識庫（前置：完成課程 1）
│   ├── 章節 1: 工具/技能使用
│   │   ├── 投影片: 技能市集介紹
│   │   ├── 互動: 使用技能操作模擬（hotspot）
│   │   ├── 投影片: 建立自訂技能（flipcard — 正面步驟/反面說明）
│   │   └── 內嵌測驗: 技能功能測驗
│   │
│   ├── 章節 2: 知識庫功能
│   │   ├── 投影片: KB 類型說明（flipcard）
│   │   ├── 互動: 建立知識庫操作模擬（hotspot）
│   │   └── 內嵌測驗: 知識庫測驗
│   │
│   └── 正式測驗（10 題，及格 70 分）
│
├── [選修] 課程 3: 分享與協作（前置：完成課程 1）
│   ├── 投影片: 分享機制說明
│   ├── 互動: 分享操作練習（hotspot）
│   ├── 分支情境: 「同事需要你的技能，你會怎麼做？」
│   └── 測驗（5 題）
│
└── 培訓專案範例
    ├── 標題：FOXLINK GPT 全員培訓
    ├── 對象：全體使用者（role = user）
    ├── 期間：30 天
    ├── 複訓：每年
    └── 一鍵啟動 → 自動展開指派
```

### 22.2 內容來源對應

| 教材章節 | helpSeedData.js 對應 section |
|---------|------------------------------|
| 系統介紹 | `u-intro` |
| AI 對話 | `u-chat`, `u-model`, `u-file`, `u-voice` |
| 工具/技能 | `u-skills`, `u-skill-create` |
| 知識庫 | `u-kb`, `u-kb-create` |
| 分享協作 | `u-share` |

---

## 23. 已確認設計決策

| # | 項目 | 決策 |
|---|------|------|
| 1 | Hotspot 編輯器技術 | **fabricjs** Canvas 標記區域 |
| 2 | 影片來源 | 上傳 MP4 + 貼入 URL，**兩者皆可** |
| 3 | 分類樹狀深度 | **最多 3 層** |
| 4 | AI 輔助出題 | **Phase 1 納入**，用 Gemini 自動生成 |
| 5 | 多語言 | zh-TW 主語言，**LLM 自動翻譯** en/vi，保留手動編輯 |
| 6 | 首個教材專案 | **FOXLINK GPT 系統操作教學**，結合使用手冊 |
| 7 | UI 入口 | **Sidebar「更多功能」**新增項目，開啟 `/training` 新頁面 |
| 8 | 模擬操作 | Phase 1 截圖模擬 + Phase 2 iframe 導引，**兩者並行** |
| 9 | TTS | Google Cloud TTS（**cmn-TW-Wavenet-A**），透過現有 skill endpoint |
| 10 | 權限模型 | view/develop 雙權限 + **can_edit_courses** flag，對齊 skill_access |
| 11 | 課程指派 | 透過**培訓專案**批次指派，有 develop 權限者可操作 |
| 12 | 評分系統 | 5 種模式（exact/partial/weighted/rubric/ai_judge），實作題多維度評分 |
| 13 | 通知系統 | Email + 系統內通知，整合現有 mailService + scheduler |
| 14 | 培訓專案 | 上層容器，含對象群組、時間起迄、自動展開指派、專案報表 |
| 15 | 學習路徑 | 課程串聯 + 前置條件，可被培訓專案引用 |
| 16 | 投影片版型 | **10 種內建版型**，降低製作門檻 |
| 17 | AI 助教 | 嵌入播放器，注入課程 context，學員學習中可即時提問 |
| 18 | 學習筆記 | 投影片級筆記 + 書籤，可匯出 PDF |
| 19 | 定期複訓 | **Phase 3**，自動建立下一期培訓專案 |
| 20 | AI 輔助錄製 | **Phase 2**，Chrome Extension + 錄製控制面板 + Gemini Vision 自動辨識 |
| 21 | Chrome Extension | **Phase 2B**，Manifest V3，click 監聯 + captureVisibleTab + 上傳 |
| 22 | 跨系統教材 | **Phase 2D**，系統登錄 + 教學腳本匯入/編輯 + AI 生成腳本 |
| 23 | 智慧後製 | **Phase 2C**，品質檢查 + 敏感遮蔽 + 自動出題 |
| 24 | 教材模板庫 | **Phase 3**，跨課程複用模板 |
| 25 | 差異更新 | **Phase 3**，系統升版後 AI 比對 → 只重做變更步驟 |
| 26 | 操作回放 | **Phase 3**，Playwright 重播驗證教材有效性 |
| 27 | 學習熱力圖 | **Phase 3**，學員點擊紀錄分析 → 找出易犯錯區域 |
| 28 | Extension 離線 | **Phase 4**，IndexedDB 快取 → 網路恢復後批次上傳 |
| 29 | Playwright 全自動 | **Phase 4**，AI 根據腳本自動操作，人只需審核 |
