# FOXLINK GPT 教育訓練 — Phase 4：訓練教室 + 權限改造 + 專案上架

> 日期：2026-04-06（設計）、2026-04-06~07（實作+審計+修復）
> 狀態：Phase 4A–4F 實作完成
> 前置：Phase 1–3E 已完成

---

## 0. 變更概述

將現有「教育訓練」拆分為兩大入口：

| 入口 | 路徑 | 對象 | 說明 |
|------|------|------|------|
| **教育訓練課程開發** | `/training/dev` | `publish` / `publish_edit` / admin | 課程建立/編輯 + 訓練專案管理 |
| **訓練教室** | `/training/classroom` | 所有使用者 | 檢視被指派的訓練專案 + 學習課程 |

---

## 1. 權限模型改造

### 1.1 新權限值

| 值 | 開發區 | 訓練教室 | 可做的事 |
|----|--------|---------|---------|
| `none` | ✗ | ✓ | 僅學習被指派的課程 |
| `publish` | ✓ | ✓ | 建立/管理訓練專案、將課程上架；**不能**建立/編輯課程內容 |
| `publish_edit` | ✓ | ✓ | 專案管理 + 建立/編輯課程內容（完整開發權限） |

- admin 視同 `publish_edit`
- `publish` 使用者只能看到**被分享 `view` 權限**的課程（由開發者主動分享）

### 1.2 DB Migration

```sql
-- users 表
ALTER TABLE users MODIFY training_permission VARCHAR2(20);
UPDATE users SET training_permission = 'publish_edit' WHERE training_permission = 'edit';
UPDATE users SET training_permission = 'none' WHERE training_permission = 'use';

-- roles 表
ALTER TABLE roles MODIFY training_permission VARCHAR2(20);
UPDATE roles SET training_permission = 'publish_edit' WHERE training_permission = 'edit';
UPDATE roles SET training_permission = 'none' WHERE training_permission = 'use';
```

### 1.3 Backend 中介層更新

```js
// training.js — 全域 middleware
// effective_training_permission 解析邏輯不變，只是值域改為 none/publish/publish_edit

// 新增 helper
const canPublish = (perm) => ['publish', 'publish_edit'].includes(perm);
const canEditCourse = (perm) => perm === 'publish_edit';
```

### 1.4 Frontend AuthContext 更新

```ts
// AuthContext.tsx
const canAccessTrainingDev = isAdmin || ['publish', 'publish_edit'].includes(trainingPermission)
const canEditTraining = isAdmin || trainingPermission === 'publish_edit'
const canPublishTraining = isAdmin || ['publish', 'publish_edit'].includes(trainingPermission)
// canAccessTraining（訓練教室）= true for all authenticated users
```

### 1.5 使用者管理 UI 更新

編輯使用者/角色的「教育訓練權限」下拉選單：

| 選項顯示 | 值 | i18n key |
|---------|-----|----------|
| 無權限 | `none` | `training.permission.none` |
| 上架權限 | `publish` | `training.permission.publish` |
| 上架及編輯權限 | `publish_edit` | `training.permission.publish_edit` |

（原本的「沿用角色設定」保留，值為 NULL）

---

## 2. Sidebar 變更

### 2.1 選單項目

```
更多功能
├── ...
├── 教育訓練課程開發  ← 原「教育訓練」改名（僅 canAccessTrainingDev 顯示）
├── 訓練教室          ← 新增（所有使用者都可見）
└── ...
```

### 2.2 i18n Keys

| key | zh-TW | en | vi |
|-----|-------|----|----|
| `sidebar.trainingDev` | 教育訓練課程開發 | Training Course Development | Phát triển khóa đào tạo |
| `sidebar.trainingClassroom` | 訓練教室 | Training Classroom | Phòng đào tạo |

（原 `sidebar.training` 廢棄）

### 2.3 Icons

- 教育訓練課程開發：`BookOpen` (lucide-react)
- 訓練教室：`GraduationCap` (lucide-react)（沿用原 icon）

---

## 3. 前端路由重組

### 3.1 路由結構

```
/training/dev                       → DevArea（tab 容器）
/training/dev/courses               → CourseList（課程管理 tab）
/training/dev/courses/new           → CourseEditor（新增課程）
/training/dev/courses/:id           → CourseEditor（編輯課程）
/training/dev/programs              → ProgramList（訓練專案 tab）
/training/dev/programs/new          → ProgramEditor（新增專案）
/training/dev/programs/:id          → ProgramEditor（編輯專案）

/training/classroom                 → Classroom（我的訓練專案列表）
/training/classroom/program/:id     → ProgramView（專案內課程列表）
/training/classroom/course/:id/learn → CoursePlayer（課程學習）
/training/classroom/course/:id/quiz  → QuizPage（測驗）
```

### 3.2 權限守衛

```tsx
// App.tsx
<Route path="/training/dev/*" element={<ProtectedRoute requires="canAccessTrainingDev" />}>
  <Route element={<DevArea />} />
</Route>
<Route path="/training/classroom/*" element={<ProtectedRoute />}>
  <Route element={<Classroom />} />
</Route>
```

### 3.3 舊路由相容

原 `/training` 根據權限自動導向：
- 有 `publish` / `publish_edit` → redirect `/training/dev`
- 其他 → redirect `/training/classroom`

---

## 4. 開發區（DevArea）

### 4.1 佈局

```
┌─────────────────────────────────────────┐
│  [課程管理]  [訓練專案]   (tab bar)       │
├─────────────────────────────────────────┤
│                                         │
│  Tab 內容                                │
│                                         │
└─────────────────────────────────────────┘
```

### 4.2 課程管理 Tab

**publish_edit 使用者看到**：
- 自己建立的課程
- 被分享 `develop` 權限的課程（可編輯）
- 被分享 `view` 權限的課程（僅預覽）
- 「新增課程」按鈕

**publish 使用者看到**：
- 被分享 `view` 權限的課程（僅預覽）
- **無**「新增課程」按鈕
- **無**編輯功能

### 4.3 訓練專案 Tab

**publish / publish_edit 使用者都看到**：
- 自己建立的訓練專案
- 「新增專案」按鈕
- 專案列表（草稿/上架中/已暫停/已結束）
- 每個專案可展開查看 assignments 統計

---

## 5. 課程分享功能

### 5.1 CourseEditor 新增「分享」Tab

在 CourseEditor 的 tab bar 新增「分享」tab（僅 owner / admin / develop 權限看得到）。

### 5.2 分享 UI

復用/改造 Dashboard 的 `ShareModal` 模式，但嵌入為 tab 內容而非 modal：

```
┌──────────────────────────────────────────┐
│  分享課程給其他人                          │
│                                          │
│  [類型 ▼]  [搜尋使用者/角色/部門...]       │
│  [權限 ▼ view/develop]  [+ 新增]          │
│                                          │
│  已分享：                                 │
│  ┌──────────────────────────────────┐    │
│  │ 👤 王小明    view    [▼] [✕]     │    │
│  │ 👥 品保部    develop  [▼] [✕]    │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

### 5.3 權限值

| 值 | 說明 | 開發區 |
|----|------|--------|
| `view` | 預覽課程內容 | 可在課程管理看到、可預覽，不可編輯 |
| `develop` | 協同開發 | 可完整編輯課程（含章節、投影片、題目） |

### 5.4 Grantee Types

沿用系統統一的六種：`user` / `role` / `department` / `cost_center` / `division` / `org_group`

### 5.5 Backend

**已有 API，無需新建**：
- `GET /api/training/courses/:id/access`
- `POST /api/training/courses/:id/access`
- `PUT /api/training/courses/:id/access/:aid`
- `DELETE /api/training/courses/:id/access/:aid`

---

## 6. 訓練專案（Training Programs）擴充

### 6.1 program_targets 擴充

現有 `target_type`：`user` / `dept` / `role`

**新增**：

| target_type | 說明 | 展開邏輯 |
|-------------|------|---------|
| `public` | 公開（全員） | `SELECT id FROM users WHERE status='active'` |
| `cost_center` | 利潤中心 | `SELECT id FROM users WHERE profit_center_code=? AND status='active'` |
| `division` | 處級 | `SELECT id FROM users WHERE org_section=? AND status='active'` |
| `org_group` | 組級 | `SELECT id FROM users WHERE org_group=? AND status='active'` |

activate 時的展開邏輯擴充對應欄位查詢。

### 6.2 專案 CRUD 補完

**現有缺失**：PUT（更新）、DELETE（刪除）、targets 刪除、courses 刪除

需新增：
```
PUT    /api/training/programs/:id                  — 更新專案
DELETE /api/training/programs/:id                  — 刪除專案（僅 draft）
DELETE /api/training/programs/:id/targets/:tid     — 移除對象
DELETE /api/training/programs/:id/courses/:cid     — 移除課程
PUT    /api/training/programs/:id/pause            — 暫停
PUT    /api/training/programs/:id/resume           — 恢復
PUT    /api/training/programs/:id/reactivate       — 再版上架（新有效期間）
```

### 6.3 專案生命週期

```
                    ┌──── pause ────┐
                    ▼               │
  draft ──→ active ←── resume ──→ paused
              │
              │ (end_date 過期 / 手動)
              ▼
          completed（自動下架）
              │
              │ reactivate（設新 start_date/end_date）
              ▼
            active（再版）
```

- **auto-complete**：新增 cron job，每日檢查 `end_date < TODAY` 且 `status='active'` → 改為 `completed`
- **pause**：`status='paused'`，學員暫時看不到該專案
- **reactivate**：已結束的專案可重新設定有效期間並上架，重新展開 assignments

### 6.4 發布通知

activate 時新增 `send_notification` 參數：

```js
POST /api/training/programs/:id/activate
Body: { send_notification: true }
```

若 `send_notification === true`：
1. 展開 assignments（現有邏輯）
2. 對每個 target user 建立 `training_notifications` 記錄
3. 若 `program.email_enabled === 1`，批次寄送 email（使用 `mailService.sendMail`）

**Email 內容**：
- 主旨：`[訓練通知] ${program.title}`
- 內文：專案名稱、目的、課程列表、到期日、訓練教室連結

### 6.5 到期/逾期通知

新增 cron job（每日執行）：

```
1. 查找 status='active' 且 end_date - remind_before_days <= TODAY 的專案
2. 查找該專案下 status IN ('pending','in_progress') 的 assignments
3. 對這些使用者發送「即將到期」通知（in-app + email）
4. 已 completed/exempted 的使用者跳過

5. 查找 end_date < TODAY 且 notify_overdue=1 的專案
6. 對未完成的使用者發送「已逾期」通知
7. 將專案 status 改為 completed
```

---

## 7. 訓練教室（Classroom）

### 7.1 主畫面 — 我的訓練

```
┌─────────────────────────────────────────────────────────┐
│  🎓 訓練教室                                             │
│                                                         │
│  ┌─ 進行中 ────────────────────────────────────────────┐ │
│  │                                                     │ │
│  │  ┌──────────────────────┐ ┌──────────────────────┐  │ │
│  │  │ 📋 新人訓練 Q2       │ │ 📋 資安訓練 2026     │  │ │
│  │  │ 目的：...            │ │ 目的：...            │  │ │
│  │  │ 課程：3 門           │ │ 課程：1 門           │  │ │
│  │  │ 進度：2/3 完成       │ │ 進度：0/1            │  │ │
│  │  │ 到期：2026-06-30     │ │ 到期：2026-12-31     │  │ │
│  │  │ ██████████░░ 67%     │ │ ░░░░░░░░░░░░ 0%      │  │ │
│  │  │ [繼續學習]           │ │ [開始學習]           │  │ │
│  │  └──────────────────────┘ └──────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ 已完成 ────────────────────────────────────────────┐ │
│  │  📋 消防安全 2025   ✅ 全部完成  得分：85/100        │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 7.2 專案詳情頁

```
┌─────────────────────────────────────────────────────────┐
│  ← 返回  │  新人訓練 Q2                                  │
│                                                         │
│  目的：讓新進員工熟悉公司系統操作                          │
│  有效期間：2026-04-01 ~ 2026-06-30                       │
│  整體進度：2/3 完成                                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 📕 ERP 基礎操作          ✅ 已完成  得分 90     │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 📕 品質管理流程          🔄 進行中  進度 60%    │    │
│  │                          [繼續學習]             │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ 📕 安全衛生訓練          ⬚ 未開始              │    │
│  │                          [開始學習]             │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 7.3 Backend API — 訓練教室

```
GET /api/training/classroom/my-programs
  → 回傳使用者被指派的所有專案 + 各專案進度統計
  → 分為 active / completed 兩組
  → SQL: program_assignments JOIN training_programs JOIN courses
         WHERE user_id=? AND program.status IN ('active')

GET /api/training/classroom/programs/:id
  → 回傳專案詳情 + 該使用者的各課程 assignment 狀態
  → SQL: training_programs + program_assignments WHERE program_id=? AND user_id=?

PUT /api/training/classroom/assignments/:aid/start
  → 標記 assignment 為 in_progress，記錄 started_at

PUT /api/training/classroom/assignments/:aid/complete
  → 標記 assignment 為 completed，記錄 completed_at + score + passed
  → （由 CoursePlayer/QuizPage 完成時自動呼叫）
```

### 7.4 與現有 CoursePlayer 整合

現有 `CoursePlayer` 和 `QuizPage` 保持不變，只是入口路徑從訓練教室進入時，
URL 改為 `/training/classroom/course/:id/learn`，並帶 query `?program_id=xxx&assignment_id=yyy`，
完成時自動更新 assignment 狀態。

---

## 8. 專案管理 UI（ProgramEditor）

### 8.1 建立/編輯專案頁面

```
┌─────────────────────────────────────────────────────────┐
│  新增訓練專案  /  編輯訓練專案                             │
│                                                         │
│  訓練主題：[________________________]                    │
│  目的：    [________________________]                    │
│            [________________________]                    │
│                                                         │
│  有效期間：[2026-04-01] ~ [2026-06-30]                   │
│                                                         │
│  ─── 課程 ────────────────────────────────────────────  │
│  [+ 新增課程]                                           │
│  ┌──────────────────────────────────────────────┐      │
│  │ 📕 ERP 基礎操作    必修 ✓    [↑][↓][✕]      │      │
│  │ 📕 品質管理流程    必修 ✓    [↑][↓][✕]      │      │
│  │ 📕 安全衛生訓練    選修 ☐    [↑][↓][✕]      │      │
│  └──────────────────────────────────────────────┘      │
│  （課程來源：自己建立的 + 被分享 view 權限的課程）         │
│                                                         │
│  ─── 訓練對象 ────────────────────────────────────────  │
│  [類型 ▼ public/user/role/dept/...]  [搜尋...]  [+ 新增] │
│  ┌──────────────────────────────────────────────┐      │
│  │ 👥 品保部                              [✕]   │      │
│  │ 👤 王小明 (12345)                      [✕]   │      │
│  └──────────────────────────────────────────────┘      │
│                                                         │
│  ─── 通知設定 ────────────────────────────────────────  │
│  ☑ 上架時發送通知信                                      │
│  到期前提醒天數：[3] 天                                   │
│  ☑ 逾期通知                                              │
│  ☑ 啟用 Email 通知                                       │
│                                                         │
│  [儲存草稿]  [發布上架]                                   │
└─────────────────────────────────────────────────────────┘
```

### 8.2 課程選擇器

點「+ 新增課程」彈出 Modal，列出可選課程：
- `publish_edit`：自己建立的 + 被分享的（view/develop）
- `publish`：被分享 `view` 的課程
- 已在專案中的課程標示 disabled
- 支援搜尋、分類篩選

---

## 9. 實作分期

### Phase 4A — 權限改造 + Sidebar

| 項目 | 說明 |
|------|------|
| DB migration | `training_permission` 值遷移 edit→publish_edit, use→none |
| Backend middleware | 更新 effective_training_permission 邏輯 |
| AuthContext | 新增 `canAccessTrainingDev` / `canPublishTraining` |
| Sidebar | 原「教育訓練」→「教育訓練課程開發」+ 新增「訓練教室」 |
| 使用者管理 UI | 下拉選單改為 none/publish/publish_edit |
| i18n | 三語言同步更新 |
| 路由重組 | `/training/dev/*` + `/training/classroom/*` + 舊路由 redirect |

### Phase 4B — 開發區 UI 重構

| 項目 | 說明 |
|------|------|
| DevArea 容器 | tab bar（課程管理 / 訓練專案） |
| 課程管理 tab | 沿用 CourseList，按權限過濾顯示 |
| 訓練專案 tab | ProgramList 元件（專案列表 + 狀態篩選） |
| 權限控制 | publish 只看分享的課程，publish_edit 完整功能 |

### Phase 4C — 課程分享 UI

| 項目 | 說明 |
|------|------|
| CourseShareTab | CourseEditor 新增「分享」tab |
| SharePanel 元件 | 改造 ShareModal 為嵌入式面板 |
| 六種 grantee type | user/role/department/cost_center/division/org_group |
| view/develop 權限 | 下拉選擇 |

### Phase 4D — 訓練專案管理

| 項目 | 說明 |
|------|------|
| Program CRUD 補完 | PUT/DELETE programs, targets, courses |
| ProgramEditor | 建立/編輯專案頁面（課程選擇 + 對象選擇 + 通知設定） |
| program_targets 擴充 | 新增 public/cost_center/division/org_group |
| activate 擴充 | 展開新 target types + send_notification 參數 |
| 生命週期管理 | pause/resume/reactivate |
| 課程選擇器 Modal | 依權限列出可選課程 |

### Phase 4E — 訓練教室

| 項目 | 說明 |
|------|------|
| Classroom 主頁 | 專案卡片列表（進行中/已完成分組） |
| ProgramView | 專案內課程列表 + assignment 狀態 |
| 課程學習入口 | 銜接現有 CoursePlayer + QuizPage |
| assignment 狀態更新 | 學習/測驗完成時自動更新 |
| Backend API | classroom/my-programs, classroom/programs/:id |

### Phase 4F — 通知 + 自動化

| 項目 | 說明 |
|------|------|
| 發布通知 | activate 時 in-app + email 通知 |
| 到期提醒 cron | 每日檢查 remind_before_days，通知未完成者 |
| 逾期通知 cron | end_date 過期，通知未完成者 + 自動 completed |
| auto-complete cron | 每日檢查過期專案自動下架 |
| 已完成者排除 | 通知邏輯跳過 completed/exempted 的 assignment |

---

## 10. 新增/修改檔案清單（預估）

### 新增

| 檔案 | 說明 |
|------|------|
| `client/src/pages/TrainingDevArea.tsx` | 開發區容器（tab bar + 子路由） |
| `client/src/pages/TrainingClassroom.tsx` | 訓練教室容器 |
| `client/src/components/training/ProgramList.tsx` | 訓練專案列表 |
| `client/src/components/training/ProgramEditor.tsx` | 專案編輯器 |
| `client/src/components/training/ProgramView.tsx` | 學員端專案詳情 |
| `client/src/components/training/CourseShareTab.tsx` | 課程分享 tab |
| `client/src/components/training/CoursePicker.tsx` | 課程選擇器 Modal |
| `client/src/components/training/ClassroomHome.tsx` | 訓練教室首頁（專案卡片） |
| `server/services/trainingCronService.js` | 訓練相關 cron jobs |

### 修改

| 檔案 | 變更 |
|------|------|
| `server/routes/training.js` | 新增 program CRUD + classroom API + 權限邏輯更新 |
| `server/database-oracle.js` | migration: training_permission 值遷移 + program_targets 擴充 |
| `server/server.js` | 註冊 trainingCronService |
| `client/src/components/Sidebar.tsx` | 兩個選單項目 |
| `client/src/context/AuthContext.tsx` | 新增 canAccessTrainingDev / canPublishTraining |
| `client/src/pages/TrainingPage.tsx` | 路由重組 |
| `client/src/components/training/CourseEditor.tsx` | 新增「分享」tab |
| `client/src/components/training/CourseList.tsx` | 權限過濾邏輯調整 |
| `client/src/components/training/CoursePlayer.tsx` | assignment 狀態更新整合 |
| `client/src/components/admin/UserEditor.tsx` | 權限下拉選單更新 |
| `client/src/i18n/locales/zh-TW.json` | 新增 i18n keys |
| `client/src/i18n/locales/en.json` | 新增 i18n keys |
| `client/src/i18n/locales/vi.json` | 新增 i18n keys |

---

## 11. DB 表變更彙總

| 表 | 變更 |
|----|------|
| `users` | `training_permission` 值遷移 |
| `roles` | `training_permission` 值遷移 |
| `program_targets` | `target_type` 新增 `public` / `cost_center` / `division` / `org_group` |
| `training_programs` | 新增欄位：`paused_at TIMESTAMP`、`completed_at TIMESTAMP` |
| `program_courses` | 新增欄位：`lesson_ids CLOB`（JSON array，null=全部章節） |

（無需建新表，全部擴充現有表）

---

## 12. 實作後追加功能與修復（2026-04-06~07）

### 12.1 課程預覽權限控制

CourseEditor 根據 `coursePermission`（owner/admin/develop/view）控制 UI：

| 區域 | view（預覽） | develop/owner/admin |
|------|-------------|-------------------|
| Top bar | 僅「預覽導覽」按鈕 | 刪除/AI錄製/匯出/封包/發佈/儲存 全顯示 |
| 基本資訊 tab | pointer-events-none 唯讀 | 可編輯 |
| 章節管理 tab | 可展開查看投影片，但所有編輯操作隱藏 | 完整編輯 |
| 投影片編輯器 | READONLY badge + 內容區鎖定（可滾動+試聽） | 完整編輯 |
| 題庫/測驗主題/翻譯 | 可操作 | 可操作 |
| 成績 | 可檢視（自己的） | 可檢視 |
| 分享/設定 | 灰色不可點 | 可操作 |

### 12.2 預覽導覽按鈕

CourseEditor header 新增「預覽導覽」按鈕，帶 `?from=editor` 進入 CoursePlayer。
CoursePlayer 根據 `from=editor` 決定返回目標（回 CourseEditor 而非 CourseDetail，避免循環）。

### 12.3 自動撥放模式

CoursePlayer header 新增「▶ 自動撥放」按鈕（僅 learn 模式）：
- 有音訊投影片：音訊播完 → 1.5s → 自動跳下一張
- 無音訊投影片：3s → 自動跳下一張
- Hotspot 互動投影片：auto-advance through guided steps（每步音訊播完自動前進 + ✓ 動畫）
- 最後一張自動停止

### 12.4 互動完成動畫

HotspotBlock 正確點擊 region 後：
- 區域中央彈出 48px 綠色圓形 ✓ 打勾動畫（`checkmark-bounce` 0.6s scale bounce）
- 綠色 glow box-shadow
- Explore mode 已發現區域顯示 32px 版本

### 12.5 訓練專案下架

新增 `PUT /programs/:id/deactivate`（active/paused → draft），ProgramEditor header 顯示「下架修改」按鈕。

### 12.6 訓練專案協作

`GET /programs` 改為所有 publish/publish_edit 使用者看到所有專案（協作模式）。

### 12.7 Auto-Enroll（自動註冊）

Classroom API `GET /classroom/my-programs` 增加 auto-enroll 邏輯：
- 查詢 `program_targets` 匹配目前使用者的 active 專案
- 若使用者沒有 assignment → 即時建立
- 解決 activate 後新建使用者看不到公開專案的問題

### 12.8 課程存取權限擴充

`canUserAccessCourse()` 新增 `program_assignments` 檢查：
- 使用者有該課程的 program assignment 且專案 active/paused → 給 view 權限
- 解決被指派學員 403 的問題

### 12.9 專案課程章節選擇

`program_courses` 新增 `lesson_ids` CLOB 欄位：
- null = 全部章節
- JSON array（如 `[1,3,5]`）= 指定章節
- ProgramEditor 課程卡片可展開勾選章節
- ProgramView 帶 `lesson_ids` query 到 CoursePlayer
- CoursePlayer 根據 `lesson_ids` 過濾投影片

### 12.10 關鍵 Bug 修復

| Bug | 根因 | 修正 |
|-----|------|------|
| Redis session 缺 `training_permission` | `setSession` 沒存此欄位 | SSO+login 兩處加入 |
| auth.js 回傳 `'edit'` 而非 `'publish_edit'` | 歷史殘留 | 三端點統一改 |
| `canUserAccessCourse` 查 `'dept'` 但 course_access 存 `'department'` | 前後端 grantee_type 不一致 | SQL 改 `IN ('dept','department')` |
| Oracle `SELECT DISTINCT` + CLOB → ORA-22848 | CLOB 不能當 comparison key | 改用子查詢避開 |
| UserPicker `onSelect` prop 不存在 | 介面不匹配 | 改用正確的 `value/display/onChange` |
| GRANTEE_LABELS 硬編碼中文 | 沒用 i18n | 改為 `t('training.grantee.*')` |
| LOV 選取後不關閉 | useEffect 連鎖清除 selected | 改用 `showDropdown` state 明確控制 |
| `/training/editor/:id` redirect 遺失 ID | Navigate 不能存取 params | 新增 RedirectEditorId wrapper |
