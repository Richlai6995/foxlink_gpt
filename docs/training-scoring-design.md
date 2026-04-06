# FOXLINK GPT 教育訓練 — Phase 5：專案計分 + 學習追蹤 + 成績報表

> 日期：2026-04-07
> 狀態：Phase 5A–5H 全部實作完成
> 前置：Phase 4A–4F 已完成

---

## 0. 概述

為訓練專案新增兩大維度的追蹤：

| 維度 | 說明 | 計分 |
|------|------|------|
| **導覽進度** | 學員是否瀏覽完所有投影片 | 不計分，但追蹤完成度 |
| **測驗成績** | 學員測驗得分，覆蓋課程設定 | 計分，決定及格 |

---

## 1. 資料結構

### 1.1 `user_slide_views`（新建）

```sql
CREATE TABLE user_slide_views (
  id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          NUMBER NOT NULL,
  slide_id         NUMBER NOT NULL,
  course_id        NUMBER NOT NULL,
  lesson_id        NUMBER NOT NULL,
  program_id       NUMBER,
  duration_seconds NUMBER DEFAULT 0,
  interaction_done NUMBER(1) DEFAULT 0,  -- 互動投影片是否完成互動
  viewed_at        TIMESTAMP DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_slide_view UNIQUE (user_id, slide_id, program_id)
)
```

**完成定義**：
- 一般投影片：`user_slide_views` 有記錄 = 已瀏覽
- 互動投影片（hotspot/dragdrop/quiz_inline）：`interaction_done = 1` 才算完成

### 1.2 `program_courses` 擴充

```sql
ALTER TABLE program_courses ADD exam_config CLOB;
-- JSON 結構：
{
  "total_score": 40,              -- 這門課在專案中佔多少分
  "pass_score": 60,               -- 及格分數（百分制）
  "time_limit_minutes": 10,
  "time_limit_enabled": true,
  "overtime_action": "auto_submit",
  "scoring_mode": "custom",       -- "even" | "custom"
  "lesson_weights": {             -- 每章節配分（scoring_mode=custom 時）
    "lesson_15": 20,
    "lesson_16": 20
  },
  "max_attempts": 3               -- 重考次數（0=無限）
}
```

### 1.3 `training_programs` 擴充

```sql
ALTER TABLE training_programs ADD program_pass_score NUMBER DEFAULT 60;
ALTER TABLE training_programs ADD sequential_lessons NUMBER(1) DEFAULT 0;  -- 章節鎖定
```

- `program_pass_score`：專案層級及格分數
- `sequential_lessons`：是否強制依序學習章節（1=鎖定）

---

## 2. 及格規則

**雙重及格制**：

```
專案及格 = 每門課都及格 AND 專案總分 ≥ program_pass_score

課程及格 = best_session_score ≥ course_pass_score（per program_courses.exam_config）
專案總分 = Σ (每門課 best_score_ratio × course_total_score)

例：
  課程 A (佔 40 分)：best 85/100 → ratio 0.85 → 得 34 分，及格線 60% → ✅
  課程 B (佔 60 分)：best 70/100 → ratio 0.70 → 得 42 分，及格線 60% → ✅
  專案總分 = 76/100 ≥ 60 → ✅ 專案及格
```

分數取值：**取最高分**（多次測驗取 best session score）

---

## 3. 投影片瀏覽追蹤

### 3.1 追蹤時機

CoursePlayer 每次離開投影片時 POST：

```
POST /api/training/slides/:id/view
Body: {
  course_id, lesson_id, program_id,
  duration_seconds,
  interaction_done: false  // 互動完成時由 onInteractionComplete 更新為 true
}
```

- UPSERT（同一 user+slide+program 只存一筆，更新 duration + viewed_at）
- 互動投影片完成互動後再更新 `interaction_done = 1`

### 3.2 完成判定

```
章節完成 = 該章節所有投影片都有 view 記錄
  AND 所有互動投影片的 interaction_done = 1

課程完成 = 所有選定章節（lesson_ids）都完成
```

---

## 4. 章節鎖定

當 `training_programs.sequential_lessons = 1` 時：

```
章節 1 → 必須完成導覽 → 才能解鎖章節 2 → ...
```

- ProgramView 顯示鎖頭圖示
- CoursePlayer 只載入已解鎖的章節投影片
- API 根據 `user_slide_views` 判斷哪些章節已完成

---

## 5. ProgramEditor 配分 UI

### 5.1 課程卡片擴充

```
📕 Oracle ERP測試  [佔分: 40 ] [必修 ✓] [重考: 3次]  [✕]
├─ ✓ 全部章節
│  ├─ ✓ 工單發補退料     [配分: 20]
│  └─ ✓ 庫存查詢         [配分: 20]
└─ 測驗: [及格: 60%] [時間: 10分] [逾時: 自動交卷 ▼]
```

### 5.2 專案設定區塊

```
─── 專案設定 ────────────────────────────
專案及格分數：[60]
☐ 依序學習（完成前一章節才能進入下一章節）
```

---

## 6. 學員成績區塊（ProgramView）

### 6.1 進度+成績面板

```
┌── 📊 學習進度與成績 ──────────────────────────┐
│                                               │
│  Oracle ERP測試（佔 40 分）                     │
│  📖 導覽: 10/12 頁 (83%)                      │
│    工單發補退料   7/7 ✅  |  庫存查詢 3/5 🔄    │
│  📝 測驗: 85/100 → 34/40 分 ✅                 │
│    考試次數: 2/3  最佳: 85  [查看歷史]          │
│                                               │
│  Foxlink GPT（佔 60 分）                       │
│  📖 導覽: 4/4 頁 (100%) ✅                     │
│  📝 測驗: 70/100 → 42/60 分 ✅                 │
│    考試次數: 1/3  最佳: 70  [查看歷史]          │
│                                               │
│  ═══════════════════════════════════════════   │
│  專案總分: 76/100  ✅ 及格                      │
│  導覽完成: 14/16 頁 (87.5%)                    │
└───────────────────────────────────────────────┘
```

### 6.2 測驗歷史展開

```
考試歷史 — Oracle ERP測試
┌───────┬──────────┬───────┬──────┐
│ 次數  │ 時間     │ 分數  │ 結果 │
├───────┼──────────┼───────┼──────┤
│ #1    │ 04/06 14:30 │ 72/100 │ ❌ │
│ #2    │ 04/07 10:00 │ 85/100 │ ✅ │
└───────┴──────────┴───────┴──────┘
```

---

## 7. 管理者成績報表（ProgramEditor）

### 7.1 報表 Tab

ProgramEditor 新增「成績報表」tab（所有 publish 使用者可看）：

```
┌── 📊 成績報表 ──────────────────────────── [匯出 Excel] ──┐
│                                                           │
│  摘要: 5人指派 | 3人完成導覽 | 2人通過 | 1人未開始          │
│                                                           │
│  ┌─────┬────┬────────┬────────┬───────┬───────┬─────────┐ │
│  │姓名 │工號│導覽進度 │課程A   │課程B  │專案總分│狀態     │ │
│  ├─────┼────┼────────┼────────┼───────┼───────┼─────────┤ │
│  │王小明│1234│16/16   │34/40 ✅│42/60 ✅│76/100│✅ 及格  │ │
│  │李大華│1235│12/16   │38/40 ✅│—      │38/100 │🔄 進行中│ │
│  │張三  │1236│0/16    │—       │—      │—      │⬜ 未開始│ │
│  └─────┴────┴────────┴────────┴───────┴───────┴─────────┘ │
│                                                           │
│  ▼ 展開 — 王小明                                           │
│    Oracle ERP測試:                                         │
│      工單發補退料: 7/7頁 ✅ | 測驗 85/100 (2次考試)        │
│      庫存查詢:     5/5頁 ✅ | 未測驗                        │
│    Foxlink GPT:                                           │
│      登入與登出:   4/4頁 ✅ | 測驗 70/100 (1次考試)        │
└───────────────────────────────────────────────────────────┘
```

### 7.2 Excel 匯出格式

| 姓名 | 工號 | 部門 | 導覽進度 | 課程A導覽 | 課程A成績 | 課程B導覽 | 課程B成績 | 專案總分 | 及格 | 完成時間 |
|------|------|------|---------|----------|---------|---------|---------|--------|------|---------|
| 王小明 | 12345 | 資訊部 | 100% | 12/12 | 85 | 4/4 | 70 | 76/100 | 是 | 2026-04-07 |

---

## 8. API 設計

```
── 追蹤 ──
POST /api/training/slides/:id/view          — 記錄投影片瀏覽 (upsert)
PUT  /api/training/slides/:id/view/done     — 標記互動完成

── 學員端 ──
GET  /api/training/classroom/programs/:id/my-scores
  → { courses: [{ course_id, course_title, total_score,
       browse_progress: { total, viewed, pct, lessons: [...] },
       exam: { best_score, best_max, attempts, max_attempts, pass_score, passed, history: [...] },
       weighted_score }],
     program_total, program_max, program_passed }

── 管理者端 ──
GET  /api/training/programs/:id/report
  → { summary: { total, completed, passed, not_started },
     users: [{ user_id, name, employee_id, dept,
       browse_total, browse_viewed, browse_pct,
       courses: [{ course_id, title, browse, exam, weighted }],
       program_total, program_passed }] }

GET  /api/training/programs/:id/report/export
  → Excel file download
```

---

## 9. 實作分期

| Phase | 內容 | 說明 |
|-------|------|------|
| **5A** | DB + Backend 基礎 | `user_slide_views` 表 + `program_courses.exam_config` + `programs.program_pass_score/sequential_lessons` |
| **5B** | 投影片瀏覽追蹤 | CoursePlayer POST /slides/:id/view + interaction_done |
| **5C** | ProgramEditor 配分 UI | 課程佔分 + 章節配分 + 測驗設定 + 重考次數 + 章節鎖定 |
| **5D** | CoursePlayer 覆蓋設定 | 讀取 program exam_config 覆蓋課程設定 |
| **5E** | 學員成績區塊 | ProgramView 導覽進度 + 測驗成績 + 歷史 |
| **5F** | 管理者報表 | ProgramEditor 成績報表 tab + 展開詳細 |
| **5G** | Excel 匯出 | GET /programs/:id/report/export |
| **5H** | 章節鎖定 | sequential_lessons 邏輯 + ProgramView 鎖頭 UI |

---

## 10. 新增/修改檔案預估

### 新增

| 檔案 | 說明 |
|------|------|
| `client/src/components/training/ProgramScorePanel.tsx` | 學員成績+導覽進度面板 |
| `client/src/components/training/ProgramReport.tsx` | 管理者成績報表 |

### 修改

| 檔案 | 變更 |
|------|------|
| `server/database-oracle.js` | `user_slide_views` 表 + `program_courses.exam_config` + `training_programs` 擴充 |
| `server/routes/training.js` | POST view + GET my-scores + GET report + GET export |
| `client/src/components/training/CoursePlayer.tsx` | 投影片瀏覽追蹤 + program exam_config 覆蓋 |
| `client/src/components/training/ProgramEditor.tsx` | 配分 UI + 報表 tab |
| `client/src/components/training/ProgramView.tsx` | 成績區塊 |
| `client/src/i18n/locales/*.json` | 新增 scoring/report/locked keys |

---

## 11. 實作完成記錄

### 11.1 實作日期

2026-04-07，全部 8 個 Phase（5A–5H）在同一 session 完成。

### 11.2 審計修復記錄

| 問題 | 嚴重度 | 修正 |
|------|--------|------|
| Oracle `JSON_TABLE` 不支援 | CRITICAL | 移除，用簡化版 COUNT 查詢 |
| `lessonIds.join(',')` SQL injection | CRITICAL | 改用 bind variables `?` |
| `ROWNUM=1` + `ORDER BY` 不保證排序 | HIGH | 改為 `FETCH FIRST 1 ROW ONLY`（3 處） |
| CoursePlayer useEffect stale closure | MEDIUM | 提前捕獲 slideId/lessonId |
| Report/Export 分數比例 hardcoded 100 | CRITICAL | 改用實際 session_max |
| `UQ_SLIDE_VIEW` 約束名大小寫 | HIGH | 統一大寫 |
| CoursePlayer useEffect 缺 courseId dependency | MEDIUM | 加入依賴陣列 |
| i18n key `training.score` 與既有 string 衝突 | HIGH | 改名為 `training.scoring` |
| ProgramScorePanel division by zero | CRITICAL | 加 `h.max_score > 0` guard |
| Excel export headers 硬編碼中文 | HIGH | 改為 zh/en/vi 三語根據 request lang |
| Excel "是/否" 硬編碼 | MEDIUM | 同上，根據 lang 翻譯 |

### 11.3 i18n 統計

- Phase 5 新增 **38 個 i18n key** × 3 語言
- namespace: `training.scoring.*`（13 key）+ `training.report.*`（11 key）+ `training.program.editor.*`（14 key）
- 避免與既有 `training.score`（string 型別）衝突，使用 `training.scoring`

### 11.4 Commits

| Commit | 說明 |
|--------|------|
| `480421b` | Phase 5A–5D: DB + 瀏覽追蹤 + 配分 UI + Backend API |
| `dcd8ab3` | Fix: Oracle SQL + SQL injection + stale closure |
| `96cda52` | Fix: score ratio + constraint name + dependency |
| `a5104c1` | Phase 5E+5F+5G: 學員成績面板 + 管理者報表 + Excel 匯出 |
| `b783870` | Phase 5H: 章節鎖定 |
| `f3e5f10` | Fix: div/zero guard + Excel i18n headers |
