# 分享權限類別綁定設計文件

> 版本：v1.0
> 日期：2026-03-31
> 狀態：討論完成，尚未實作

---

## 一、背景與問題

### 現有兩套系統

| 系統 | 管什麼 | 決定者 |
|------|--------|--------|
| 資料政策（data policy）| 你能看到什麼**資料**（WHERE 條件） | category binding / role |
| 專案分享（share）| 你能做什麼**操作**（使用 vs 編輯） | 明確指派的 user/role |

### 問題場景

```
RICH_TEST（角色：一般使用者）
  ├─ 分享層：一般使用者 → 編輯
  └─ 資料政策層：合理庫存類別 → 套用 光電經管角色 的 cat binding → LW 政策
```

當 RICH_TEST 進入「合理庫存分析」主題（類別：合理庫存）：
- 資料政策走了「光電經管角色」的路徑 → 只能看 LW 資料
- 分享權限走的是「一般使用者」→ 得到 **編輯** 權限

兩個系統各走各的路，導致使用者在資料受限的情況下，仍然可以使用編輯功能（例如修改查詢條件、儲存查詢）。

### 為何不能耦合兩套系統

> **球員兼裁判問題**：若分享權限依賴資料政策解析，而使用者自己能影響資料政策的設定（例如有管理介面存取權），則可能透過修改資料政策間接提升自己的操作權限。

因此兩套系統必須**完全獨立**，分別由不同的設定路徑管理：
- 資料政策：管理員透過 DataPermissionsPanel 設定
- 分享權限：專案擁有者/管理員透過 Share Dialog 設定

---

## 二、架構設計

### 核心原則

**分享系統自己也支援 category-aware 解析，但完全獨立於資料政策。**

```
分享權限解析（5 層，平行於資料政策設計）：

層級 1：USER 對此 topic/project 的明確分享 → 最優先
層級 2：USER 對此 category 的分享設定（新表 ai_user_cat_shares）
層級 3：ROLE 對此 topic/project 的明確分享
層級 4：ROLE 對此 category 的分享設定（新表 ai_role_cat_shares）
層級 5：public / 無存取
```

- 層級 1/2 的 USER 層永遠比 ROLE 層優先
- 層級 2/4 只在 topic 有 `policy_category_id` 時觸發
- 找不到類別設定 → fall through 到下一層

### 解析流程

```
topic 有 category_id？
  ├─ 是 ────────────────────────────────────────────────────────────┐
  │                                                                  │
  │  USER 對此 topic 有明確分享？                                      │
  │  ├─ 有 → 使用 ✓ RETURN                                           │
  │  └─ 沒有                                                         │
  │       USER 對此 category 有分享設定？                              │
  │       ├─ 有 → 使用 ✓ RETURN                                      │
  │       └─ 沒有                                                    │
  │            ROLE 對此 topic 有明確分享？                            │
  │            ├─ 有 → 使用 ✓ RETURN                                 │
  │            └─ 沒有                                               │
  │                 ROLE 對此 category 有分享設定？                    │
  │                 ├─ 有 → 使用 ✓ RETURN                            │
  │                 └─ 沒有 → fall through ↓                        │
  │                                                                  │
  └─ 否 ─────────────────────────────────────────────────────────── ┘
       ↓ fall through
  USER 對此 topic 有明確分享？
  ├─ 有 → 使用 ✓ RETURN
  └─ 沒有
       ROLE 對此 topic 有明確分享？
       ├─ 有 → 使用 ✓ RETURN
       └─ 沒有 → 無存取
```

---

## 三、DB 變動

### 新增 2 張表

```sql
-- 角色對特定類別的分享層級
CREATE TABLE ai_role_cat_shares (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id     NUMBER       NOT NULL,
  category_id NUMBER       NOT NULL,
  permission  VARCHAR2(10) NOT NULL,  -- 'use' | 'edit'
  created_at  TIMESTAMP    DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_rcs UNIQUE (role_id, category_id),
  CONSTRAINT fk_rcs_role FOREIGN KEY (role_id)     REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rcs_cat  FOREIGN KEY (category_id) REFERENCES ai_policy_categories(id) ON DELETE CASCADE
);

-- 使用者對特定類別的分享層級（最優先，可覆蓋 role cat share）
CREATE TABLE ai_user_cat_shares (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     NUMBER       NOT NULL,
  category_id NUMBER       NOT NULL,
  permission  VARCHAR2(10) NOT NULL,  -- 'use' | 'edit'
  created_at  TIMESTAMP    DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_ucs UNIQUE (user_id, category_id),
  CONSTRAINT fk_ucs_user FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ucs_cat  FOREIGN KEY (category_id) REFERENCES ai_policy_categories(id) ON DELETE CASCADE
);
```

### 現有表不動

| 表名 | 狀態 |
|------|------|
| `ai_select_shares` / `ai_dashboard_shares` | **不動** — 保留為 topic/project 層的明確分享（層級 1/3） |
| `ai_data_policies` / `ai_data_policy_rules` | **不動** — 資料政策完全獨立 |

---

## 四、後端變動

### 分享權限解析函式（新邏輯）

```js
/**
 * 取得使用者對此 topic 的有效分享權限（含類別層）
 * @returns 'edit' | 'use' | null
 */
async function getEffectiveSharePermission(db, userId, topicId) {
  const [topic, user] = await Promise.all([
    db.prepare(`SELECT id, policy_category_id FROM ai_select_topics WHERE id=?`).get(topicId),
    db.prepare(`SELECT id, role_id FROM users WHERE id=?`).get(userId),
  ]);
  if (!topic || !user) return null;

  const catId = topic.policy_category_id ?? null;

  // ── 層級 1：USER 對此 topic 的明確分享
  const userTopicShare = await db.prepare(
    `SELECT permission FROM ai_select_shares WHERE topic_id=? AND grantee_type='user' AND grantee_id=?`
  ).get(topicId, userId);
  if (userTopicShare) return userTopicShare.permission;

  if (catId) {
    // ── 層級 2：USER 對此 category 的分享設定
    const userCatShare = await db.prepare(
      `SELECT permission FROM ai_user_cat_shares WHERE user_id=? AND category_id=?`
    ).get(userId, catId);
    if (userCatShare) return userCatShare.permission;
  }

  // ── 層級 3：ROLE 對此 topic 的明確分享
  if (user.role_id) {
    const roleTopicShare = await db.prepare(
      `SELECT permission FROM ai_select_shares WHERE topic_id=? AND grantee_type='role' AND grantee_id=?`
    ).get(topicId, user.role_id);
    if (roleTopicShare) return roleTopicShare.permission;

    if (catId) {
      // ── 層級 4：ROLE 對此 category 的分享設定
      const roleCatShare = await db.prepare(
        `SELECT permission FROM ai_role_cat_shares WHERE role_id=? AND category_id=?`
      ).get(user.role_id, catId);
      if (roleCatShare) return roleCatShare.permission;
    }
  }

  return null;  // 層級 5：無存取
}
```

### 新增 CRUD API

| Method | Path | 說明 |
|--------|------|------|
| GET | `/data-permissions/user-cat-shares/:userId` | 取得使用者所有類別分享設定 |
| POST | `/data-permissions/user-cat-shares` | 新增/更新使用者類別分享 |
| DELETE | `/data-permissions/user-cat-shares/:userId/:categoryId` | 刪除 |
| GET | `/data-permissions/role-cat-shares/:roleId` | 取得角色所有類別分享設定 |
| POST | `/data-permissions/role-cat-shares` | 新增/更新角色類別分享 |
| DELETE | `/data-permissions/role-cat-shares/:roleId/:categoryId` | 刪除 |

---

## 五、前端變動

### Share Dialog 擴充

在現有分享設定 dialog 中，新增「類別預設權限」tab 或 section：

```
── 主題層分享（現有）──────────────────────────────────────────
角色: 一般使用者        [編輯 ▼]   [🗑]
角色: 光電經管角色      [使用 ▼]   [🗑]
使用者: rich_test       [使用 ▼]   [🗑]
[+ 新增分享]

── 類別層預設（新）────────────────────────────────────────────
（此主題的類別：合理庫存）

角色: 光電經管角色  在「合理庫存」類別下預設 [使用 ▼]   [🗑]
[+ 新增類別層預設]

說明：類別層設定適用於「同類別的所有主題」，優先度低於主題層明確設定。
```

### DataPermissionsPanel 擴充

在 AssignmentsPanel 的各 role/user row 中（類似現有 CatBindingsSection），新增「類別分享設定」section：

```
角色: 光電經管角色
  ├─ 一般政策（無類別）: [依員工主檔政策]
  ├─ 類別政策綁定: 合理庫存 → [LW政策]
  └─ 類別分享設定（新）: 合理庫存 → 使用   ← 管理此角色對各類別的預設分享層級
```

---

## 六、邊界情況

| 情況 | 結果 |
|------|------|
| Topic 無類別 | 只走 topic 層分享（現有行為不變） |
| Topic 有類別，USER 有 topic 層分享 | 使用 USER topic 層（最優先） |
| Topic 有類別，USER 無 topic 層，有 user cat share | 使用 user cat share |
| Topic 有類別，只有 role cat share | 使用 role cat share |
| 都沒有設定 | 無存取 |
| 類別分享設定 edit，但 topic 層設定 use | use（topic 層 USER 優先） |

---

## 七、與資料政策的關係

| 面向 | 資料政策（cat policy） | 分享權限（cat share） |
|------|----------------------|--------------------|
| 管什麼 | 看得到的**資料列** | 能做的**操作** |
| 設定入口 | DataPermissionsPanel → 政策指派 | Share Dialog / DataPermissionsPanel → 分享設定 |
| 解析邏輯 | 獨立 5 層（ai_user/role_cat_policies） | 獨立 5 層（ai_user/role_cat_shares） |
| 互相依賴 | **完全獨立** | **完全獨立** |
| 共同依賴 | ai_policy_categories（類別表） | ai_policy_categories（類別表） |

兩套系統唯一的共通點是「類別」的概念，但解析路徑和設定管道完全分開，確保管理員無法透過設定其中一套來影響另一套。

---

## 八、實作順序（待確認後執行）

1. DB Migration：建立 `ai_user_cat_shares` + `ai_role_cat_shares`
2. 後端：新增 `getEffectiveSharePermission` 函式，整合到 topic/dashboard access 判斷
3. 後端：新增 6 個 CRUD API
4. 前端：Share Dialog 加「類別層預設」section
5. 前端：DataPermissionsPanel AssignmentsPanel 加「類別分享設定」section

---

## 九、不在此次範圍

- 資料政策（ai_user/role_cat_policies）：不需修改
- 現有 topic 層分享邏輯：不需修改，保留為最優先層
- 全面禁止（full_block）：由資料政策處理，不透過分享系統
