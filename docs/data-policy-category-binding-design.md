# 資料政策分類綁定設計文件

> 版本：v1.0
> 日期：2026-03-30
> 狀態：設計確認中，尚未實作

---

## 一、背景與問題

### 現有系統的問題

目前 `getEffectivePolicies(userId, categoryId)` 的解析邏輯是：

```
找「使用者直接指派 AND 屬於此 category」的政策
  → 找「角色指派 AND 屬於此 category」的政策
  → fallback 舊版 assignment
```

**問題**：它用 `category_id` 去「過濾」使用者/角色已指派的政策，而非「直接取 category 層的綁定」。導致當主題指定類別時，使用者看到的不是該類別該有的政策，而是角色的通用政策。

### 需求目標

讓每個使用者/角色，針對不同類別有不同的資料政策。例如：

- `rich_test`（角色：一般使用者）進入「合理庫存分析」主題（類別：合理庫存）
  → 應套用「LW 利潤中心政策」，只能看 LW 資料
- 同一使用者進入無類別主題
  → 沿用角色通用政策（依員工主檔）

---

## 二、最終架構設計

### 核心原則

**原始系統完全不動，新系統是疊加層。**

```
層級 1（新）：USER  是否對此 category 有明確綁定？ → 使用（最優先）
層級 2（新）：ROLE  是否對此 category 有明確綁定？ → 使用
層級 3（原始）：USER 的一般政策（ai_user_policies）→ 使用
層級 4（原始）：ROLE 的一般政策（ai_role_policies）→ 使用
層級 5：都沒有 → 無限制
```

- **層級 1/2** 只在主題有 `category_id` 時觸發
- 找不到類別綁定，自然 fall through 到層級 3/4（原始行為不受影響）
- 同一層有多個政策 → **聯集（rules flatMap，OR 條件）**

### 解析流程圖

```
查詢主題有 category_id？
  ├─ 是 ───────────────────────────────────────────────────────┐
  │                                                            │
  │  USER 在此 category 有綁定的政策？                          │
  │  ├─ 有 → 使用這些政策的聯集 ✓ RETURN                       │
  │  └─ 沒有                                                   │
  │       ROLE 在此 category 有綁定的政策？                     │
  │       ├─ 有 → 使用這些政策的聯集 ✓ RETURN                  │
  │       └─ 沒有 → fall through ↓                            │
  │                                                            │
  └─ 否 ────────────────────────────────────────────────────── ┘
       ↓ fall through
  USER 有一般政策（ai_user_policies）？
  ├─ 有 → 使用 ✓ RETURN
  └─ 沒有
       ROLE 有一般政策（ai_role_policies）？
       ├─ 有 → 使用 ✓ RETURN
       └─ 沒有 → 無限制
```

---

## 三、DB 變動

### 新增 2 張表（其餘完全不動）

```sql
-- 使用者對特定類別的政策綁定
CREATE TABLE ai_user_cat_policies (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     NUMBER        NOT NULL,
  category_id NUMBER        NOT NULL,
  policy_id   NUMBER        NOT NULL,
  created_at  TIMESTAMP     DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_user_cat_pol UNIQUE (user_id, category_id, policy_id),
  CONSTRAINT fk_ucp_user     FOREIGN KEY (user_id)     REFERENCES users(id)              ON DELETE CASCADE,
  CONSTRAINT fk_ucp_cat      FOREIGN KEY (category_id) REFERENCES ai_policy_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_ucp_pol      FOREIGN KEY (policy_id)   REFERENCES ai_data_policies(id)   ON DELETE CASCADE
);

-- 角色對特定類別的政策綁定
CREATE TABLE ai_role_cat_policies (
  id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id     NUMBER        NOT NULL,
  category_id NUMBER        NOT NULL,
  policy_id   NUMBER        NOT NULL,
  created_at  TIMESTAMP     DEFAULT SYSTIMESTAMP,
  CONSTRAINT uq_role_cat_pol UNIQUE (role_id, category_id, policy_id),
  CONSTRAINT fk_rcp_role     FOREIGN KEY (role_id)     REFERENCES roles(id)              ON DELETE CASCADE,
  CONSTRAINT fk_rcp_cat      FOREIGN KEY (category_id) REFERENCES ai_policy_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_rcp_pol      FOREIGN KEY (policy_id)   REFERENCES ai_data_policies(id)   ON DELETE CASCADE
);
```

### 現有表變動

| 表名 | 動作 | 說明 |
|------|------|------|
| `ai_user_policies` | **不動** | 保留為層級 3（使用者一般政策） |
| `ai_role_policies` | **不動** | 保留為層級 4（角色一般政策） |
| `ai_policy_category_map` | **不動** | 仍用於 DataPermissionsPanel「政策類別」tab 的 UI 展示 |
| `ai_data_policies` | **不動** | 政策主表 |
| `ai_data_policy_rules` | **不動** | 政策規則 |
| `ai_policy_assignments` | 廢棄 | 舊 legacy，已不使用 |

### 廢棄的邏輯（非表本身）

`getEffectivePolicies` 中這段邏輯廢棄（不再執行）：

```js
// ❌ 廢棄：用 category 去過濾 user/role 已指派的政策
JOIN ai_policy_category_map pcm ON pcm.policy_id = p.id
WHERE up.user_id = ? AND pcm.category_id = ?
```

改為：直接查兩張新表 `ai_user_cat_policies` / `ai_role_cat_policies`。

---

## 四、後端變動

### `server/routes/dataPermissions.js`

**`getEffectivePolicies` 完整新邏輯：**

```js
async function getEffectivePolicies(db, userId, categoryId = null) {
  const user = await db.prepare(`SELECT id, role_id FROM users WHERE id=?`).get(userId);
  if (!user) return [];

  // ── 層級 1/2：類別層（新增，優先）─────────────────────────────────────
  if (categoryId) {
    // 層級 1：USER 對此 category 的綁定
    const userCat = await db.prepare(
      `SELECT policy_id FROM ai_user_cat_policies
       WHERE user_id = ? AND category_id = ?`
    ).all(userId, categoryId);

    if (userCat.length > 0) {
      return await _loadPoliciesWithRules(db, userCat.map(r => r.policy_id));
    }

    // 層級 2：ROLE 對此 category 的綁定
    if (user.role_id) {
      const roleCat = await db.prepare(
        `SELECT policy_id FROM ai_role_cat_policies
         WHERE role_id = ? AND category_id = ?`
      ).all(user.role_id, categoryId);

      if (roleCat.length > 0) {
        return await _loadPoliciesWithRules(db, roleCat.map(r => r.policy_id));
      }
    }
    // 層級 1/2 都沒有 → fall through 到原始邏輯
  }

  // ── 層級 3/4：原始邏輯（一字不改）─────────────────────────────────────
  // 層級 3：USER 直接指派的政策
  const userPolicies = await db.prepare(
    `SELECT p.id FROM ai_user_policies up
     JOIN ai_data_policies p ON p.id = up.policy_id
     WHERE up.user_id = ?
     ORDER BY up.priority ASC`
  ).all(userId);

  if (userPolicies.length > 0) {
    return await _loadPoliciesWithRules(db, userPolicies.map(p => p.id));
  }

  if (!user.role_id) return [];

  // 層級 4：ROLE 的政策
  const rolePolicies = await db.prepare(
    `SELECT p.id FROM ai_role_policies rp
     JOIN ai_data_policies p ON p.id = rp.policy_id
     WHERE rp.role_id = ?
     ORDER BY rp.priority ASC`
  ).all(user.role_id);

  if (rolePolicies.length > 0) {
    return await _loadPoliciesWithRules(db, rolePolicies.map(p => p.id));
  }

  return [];
}
```

### 新增 CRUD API（`/api/data-permissions`）

| Method | Path | 說明 |
|--------|------|------|
| GET | `/user-cat-policies/:userId` | 取得使用者所有類別綁定 |
| POST | `/user-cat-policies` | 新增使用者類別綁定 |
| DELETE | `/user-cat-policies/:userId/:categoryId/:policyId` | 刪除 |
| GET | `/role-cat-policies/:roleId` | 取得角色所有類別綁定 |
| POST | `/role-cat-policies` | 新增角色類別綁定 |
| DELETE | `/role-cat-policies/:roleId/:categoryId/:policyId` | 刪除 |

---

## 五、前端變動

### 不動的部分

| 元件 | 狀態 |
|------|------|
| `EditUser` modal 的「資料權限政策」下拉 | **完全不動**（層級 3 的 USER 一般政策） |
| `DataPermissionsPanel` 政策設定 tab | 不動 |
| `DataPermissionsPanel` 政策類別 tab | 不動 |

### 需要重做的部分

**`DataPermissionsPanel` → 「角色/使用者指派」tab**

現有：每個 USER/ROLE 選一個政策。
新版：每個 USER/ROLE 可針對每個類別選多個政策。

#### 新 UI 結構（角色頁籤）

```
角色: 一般使用者
  ├─ 一般政策（無類別）: [依員工主檔政策]       ← 現有 ai_role_policies（唯讀顯示）
  ├─ 類別政策綁定（新）:
  │   ├─ 合理庫存 → [LW政策] [依員工主檔] [x]  [+ 加政策]
  │   └─ 銷售分析 → [全域政策] [x]             [+ 加政策]
  └─ [+ 新增類別綁定]

角色: IT維運
  ├─ 一般政策（無類別）: [未設定]
  └─ 類別政策綁定（新）: 無
       [+ 新增類別綁定]
```

#### 新 UI 結構（使用者頁籤）

```
使用者: rich_test （角色：一般使用者）
  ├─ 一般政策（個人覆蓋）: [沿用角色]            ← 現有 EditUser 下拉（唯讀顯示）
  ├─ 類別政策綁定（新）:
  │   └─ 合理庫存 → [LW政策] [x]               [+ 加政策]
  └─ [+ 新增類別綁定]
  ※ 未設定的類別自動沿用角色的類別政策綁定
```

---

## 六、邊界情況對照表

| 情況 | 結果 |
|------|------|
| 主題無類別 | 走層級 3/4 原始邏輯 |
| 主題有類別，USER 有此類別綁定 | 使用 USER 類別政策（聯集），不看角色 |
| 主題有類別，只有 ROLE 有此類別綁定 | 使用 ROLE 類別政策（聯集） |
| 主題有類別，USER 和 ROLE 都沒有此類別綁定 | fall through → 層級 3/4 原始邏輯 |
| 同一類別多個政策 | rules flatMap 聯集（例：多個 profit_center → IN ('LW','IZ')） |
| 類別政策含 super_user | 該層不限制（WHERE 不注入任何條件） |
| 類別政策含 full_block | 該層封鎖查詢（回傳 denied） |

---

## 七、實作順序建議

1. **DB Migration**：建立 `ai_user_cat_policies` + `ai_role_cat_policies` 兩張表
2. **後端 `getEffectivePolicies`**：插入層級 1/2 邏輯，舊邏輯不動
3. **後端 CRUD API**：新增 6 個 endpoint
4. **前端 DataPermissionsPanel**：重做「角色/使用者指派」tab

---

## 八、不在此次範圍

- `ai_policy_assignments`（舊 legacy 表）：直接廢棄，不需遷移
- `ai_user_policies` / `ai_role_policies`：不動，繼續作為層級 3/4 fallback
- 任何現有的 `org-scope`、`multiorg-scope`、WHERE 注入邏輯：不需修改
