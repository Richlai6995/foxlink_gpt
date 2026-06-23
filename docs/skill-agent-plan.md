# Skill Agent 平台 — Phase 1 規劃書

> 把「AI 平台產生的 Anthropic-style skill 包」接成 Cortex 可執行的通用能力。
> Phase 0 PoC 已驗證方向(見 [server/services/skillAgent/](../server/services/skillAgent/) + memory `project-skill-agent-poc`),本文規劃產品化。

---

## 0. 一句話

不是「pptx agent」,是**一個通用 Skill Agent runtime + 可插拔 skill 包**。runtime 載入哪份 `SKILL.md` 就長出哪種能力;pptx 只是第一個 skill 包。明天 Anthropic 出 xlsx / 影片 / CAD skill,直接白嫖,不必每種重寫成 workflow。

```
   SKILL 包(可插拔)            Skill Agent Runtime(唯一)
  ┌──────────┐               ┌─────────────────────────────┐
  │ pptx skill│──────────────▶│ agentic loop:讀 SKILL.md     │
  │ xlsx skill│──────────────▶│  → write_file/bash/python    │
  │ 任意 skill│──────────────▶│  → 跑 → 程式 QA → vision QA   │
  └──────────┘               │  → 修 → 再跑(背景 job)       │
   每包自帶:                  │  sandbox workspace(跑完即焚) │
   SKILL.md / scripts/ /      └─────────────────────────────┘
   requirements.txt / 黃金藍圖
```

## 1. Phase 0 已證 + 帶進 Phase 1 的關鍵學習

| 結論 | 證據 | 對 Phase 1 的影響 |
|------|------|------------------|
| 通用 runtime 可行 | 同一套 loop 跑 pptx skill,端到端產 QA-clean 簡報 | runtime 與 skill 解耦,skill 只是資料 |
| Gemini 吃得下 Claude-native skill | 76k~250k token、會自己 `help()` 探 API、自我修正 | 大腦預設 Gemini,Claude 當 per-skill 選項 |
| 程式 QA 擋硬約束、**vision 擋美學** | slide_qa 漏抓文字重疊,vision 抓到 | **雙層 QA**:每輪程式 gate + 收尾 vision |
| **好 brief > 反覆 vision 推** | 無藍圖 vision 推到 85 卡住燒 390k;**給精確藍圖第一次 vision 就 95 過** | **skill 包要攜帶「黃金範例藍圖」**,匯入時一起餵 agent |
| vision 是嚴格且略不單調的裁判 | 82→72→85 來回 | **分數門檻 pass(≥90)+ 最後一修補驗證**,別追 100 空燒 |
| 是 untrusted code execution | 跑 LLM 動態生成的任意 python | 信任模型 ≠ 現有 code skill,需疊安全隔離 |

## 2. 整進 Cortex:第 5 種 `type='agent'`

複用 skills 表 / TAG router / KB binding / rate limit / 版本控制 / ShareModal,不另起爐灶。
研究結論:`skills.type` 是 **無 enum 約束的 `VARCHAR2(20)`**(`create-schema.sql:397`),create 路由不檢查 allowlist → `type='agent'` 今天就存得進去,只是**沒有 dispatch 分支 → 靜默無作用**。

### 2.1 DB schema(兩處都要改:fresh install + 既有 DB migration)

新欄位(skills 表):
| 欄位 | 型別 | 用途 |
|------|------|------|
| `skill_package_path` | VARCHAR2(1000) | skill 包在 NFS 的目錄(含 SKILL.md / scripts/) |
| `env_requirements` | CLOB DEFAULT '[]' | python/系統依賴宣告(requirements.txt 解析) |
| `brain_provider` | VARCHAR2(50) | `gemini`(預設)/ `claude` / `aoai` |
| `agent_config` | CLOB | vision 開關、step/token 上限、entry task 等 |

- **`server/scripts/create-schema.sql:392`** CREATE TABLE 加上述欄位(新裝)。
- **`server/database-oracle.js` runMigrations(~`:2526` OUTPUT_TEMPLATE_ID 區塊後)** 補 `safeAddColumn('SKILLS', ...)`(既有 DB)。

新權限 `allow_agent_skill`(對齊 allow_code_skill,NUMBER(1)):
- `create-schema.sql:23-25`(roles)+ `:64-66`(users)。
- ⚠️ **既有 3 個 skill 權限欄在 database-oracle.js 沒有 migration**(只靠 create-schema.sql,`skills.js:268` 註記的 latent gap)——**新權限要顯式補 `safeAddColumn('ROLES'/'USERS','ALLOW_AGENT_SKILL',...)`**,別重蹈覆轍。

### 2.2 後端路由

- `skills.js` POST(`:494`)/ PUT(`:605`)/ fork(`:744`):加 `if(type==='agent' && !hasSkillPerm(...,'allow_agent_skill') && !admin) return 403`;destructure 新欄位 + 接進 INSERT/UPDATE/fork 的欄位清單;`env_requirements` `JSON.stringify`;`serializeSkill`(`:283`)補 `parseJsonField`。
- 權限串接(4 處,對齊既有 3 權限):`users.js:153/188/:41 SELECT/:229 UPDATE`、`roles.js:121/149/177/206`、`webauthn.js:313-322`(`effective_allow_agent_skill = isAdmin || re(userCol, roleCol)`)。

### 2.3 執行 dispatch(關鍵:沒這分支 skill 就是死的)

- **`chat.js:2688`**(workflow 分支後)加 `else if (sk.type === 'agent')`:**不做 inline tool-calling,改 `agentJobService.createJob(...)`**(見 §4),推 status SSE + tagRoutedPostHints 告訴 LLM「agent 背景處理中」。
- 或走 **tool-handler 路線**(`chat.js:3906` `_rawToolHandler`):把 agent skill 註冊進 `codeSkillToolMap`,LLM 呼叫時 `createJob` 並回 sentinel「已派工,結果走鈴鐺+chat,勿重複呼叫」→ 當輪立即結束,不阻塞 SSE。
- 其餘引擎防呆:`pipelineRunner.js:133` / `promptResolver.js:102` / `workflowEngine.js:127` 對 `type==='agent'` 加 graceful 分支,別丟「技能類型 agent 不支援」。
- **DELETE(`skills.js:736`)+ shutdown**:agent 若有殘留 process 要清(對齊 code skill 的 code_status cleanup)。

### 2.4 前端

`client/src/pages/SkillMarket.tsx`:type union 加 `'agent'`(`:22/:91`)、filter option(`:407-410`)、type-picker button(`:555-561`)、`{form.type==='agent' && (...)}` 設定區(package/env/brain);i18n `skills.typeAgent` 補 zh-TW/en/vi 三檔;button gate on `effective_allow_agent_skill`。

## 3. 匯入器(Importer)

讓使用者上傳 skill 包 → 變成 `type='agent'` skill。

1. **上傳**:multer `upload.single`(zip)。clone `training.js:8601` 的 JSZip 流程,但**結構保留**(別攤平 —— PoC 親證攤平會斷 blue_style 相對 import)。
2. **解析 SKILL.md frontmatter**:name / description / license。description 同時餵 TAG router 做路由。license 非 Proprietary 要提示(第三方 skill 跑在平台的授權)。
3. **落檔**:`skillRunner.writePackage(skillId, skillMd, files)`(新增,對齊 `saveCode:117` 但多檔 + `_safeJoin` 每筆),寫到 NFS runner dir;`skill_package_path` 存路徑;autoRestoreRunners 在其他 pod re-hydrate。
4. **依賴安裝**:`skillRunner.installPythonPackages`(新增,clone `installPackages:134` 但 `python -m venv` + venv pip `-r requirements.txt`);admin SSE 安裝 endpoint 對齊 `admin.js:3307-3350`。
5. **黃金藍圖**:skill 包可含 `examples/golden.md`(或 .pptx)當範例藍圖,匯入時存起來,執行時連同 SKILL.md 餵 agent(Phase 0 學習:這比 vision 反覆推有效得多)。

## 4. 背景 job 化(agent loop 是長任務,別塞同步 SSE)

agent skill = 5~15 輪 LLM + 渲染,硬塞 chat 同步 SSE 會撞 K8s SSE/probe 雷。對齊既有背景 job(research_jobs / 長音訊 / ExcelJob)。

- **`agent_jobs` 表**(clone research_jobs):`status(pending/running/done/failed)`、`progress_step/total/label`、`result_files_json`、`checkpoint_json`(per-round resume)、`heartbeat_at`、`recovery_count`、`lock_token`、`tokens_by_model_json`、`completed_at`。
- **`server/services/agentJobService.js`**(新增,clone `excelQueryJobService`):`createJob → 原子 claim(UPDATE lock_token WHERE lock IS NULL)→ setImmediate(runJob)`;runJob 驅動 `runAgentLoop`(PoC 已有);60s heartbeat;per-round 寫 progress + checkpoint;done 後 INSERT chat_messages assistant row + `user_notifications`(鈴鐺)。
- **recovery**:`recoverStaleJobs` cron 5min re-claim;SIGTERM `gracefullyPauseActiveJobs` NULL lock_token。
- **進度**:GET `/agent-jobs/:id` 輪詢(對齊 research,不走 SSE)。
- scheduler-off-web-pod:對齊 ExcelJob 的 `runPendingJobs` poller(大任務不在 web pod 跑)。

## 5. 安全:admin-only 引入 + 沙箱加固

**主要控制 ✅(已實作 2026-06-18):code / agent skill 的 create / edit / import / fork 一律限「admin role」(不可委派,移除 allow_code_skill / allow_agent_skill 的授予路徑)。** 由於只有受信任的系統管理員能引入「會執行程式碼」的 skill,「惡意 skill 包」這個最大攻擊面被縮小到信任邊界內。`allow_*_skill` 欄位/plumbing 保留為 dormant(日後若要委派給 IT,把 gate 從 `role!=='admin'` 換回 `hasSkillPerm` 即可),但 RoleManagement 的授予 UI 已移除以免誤導。

**沙箱加固(defense-in-depth,admin-only 後優先序降低,但仍建議補)**:
- **現況 stability guard**:agentJobService 有 semaphore(MAX_CONCURRENT=1);python / soffice 已是 `child_process` + wall-clock SIGKILL(sandbox.js 60s / 90s);runSkillAgent 有 `MAX_OUTER_ROUNDS` / `TOKEN_BUDGET` / `WALL_MS`。重活(python)本就在可殺的子程序,pod-crash 風險已不高。
- **殘留 gap**:agent loop 的 **Node 主程序**(Gemini streaming)若單一 call hang,heartbeat(setInterval)照刷 → recoverStaleJobs 撿不回 → 殭屍 running。徹底解法 = 把 `runSkillAgent` 整個 fork 進 `child_process`,主程序設 wall-clock watchdog SIGKILL + 子程序 `/proc/self/oom_score_adj=1000`(`feedback_excel_job_pdf_landmine` 鐵則)。
- **開放外部/社群 skill 前才需要**:egress 網路鎖死、non-root + ulimit、workspace `emptyDir` 跑完即焚、專用 sandbox image。admin-only 自家 skill 階段可延後。

## 6. 雙層 QA(Phase 0 核心成果,直接產品化)

- **程式 QA(每輪 gate,便宜)**:擋溢出/重疊/出界/硬約束。per-skill 提供(pptx 用 slide_qa.py)。
  - 已知盲區:slide_qa 只查實心色塊重疊、不查文字框重疊 → 由 vision 兜。
- **收尾 vision(一次,抓美學)**:render → Gemini 看圖回 JSON {pass, score, issues}。
  - **分數門檻 pass(≥90,`SKILLAGENT_VISION_PASS`)**、**最後一修一定補驗證**(已修「驗證-then-cap」缺陷)、**裁判兩極端都扣分**(太深/洗白、太擠/太鬆)。
  - vision 只在程式 QA clean 後跑、設修正輪上限,控成本。
- 大腦:per-skill 可配 provider,Anthropic skill 預設 Gemini、Claude 當 escalation。

## 7. 分享 / 權限

複用 `skill_access` + 公用 `ShareModal`(`client/src/components/dashboard/ShareModal.tsx`,`/api/skills/:id/access`),7 種 grantee + use/develop 兩級,agent skill 無需改動。對齊 scheduled_task_shares 的鐵則:**執行身份永遠 = skill owner**;含寫敏感資料的 skill 禁 develop 分享。

## 8. 切片計畫(建議 PR 順序)

| # | 切片 | 內容 | 依賴 |
|---|------|------|------|
| **S0** | runtime 函式庫化 | poc.js `SKILL_DIR` 改吃 package 參數;`runAgentLoop` 可被 service 呼叫 | — |
| **S1** | `type='agent'` scaffolding | schema 欄位 + `allow_agent_skill` 權限(含 migration)+ skills.js/users.js/roles.js/webauthn.js 串接 + 前端 type + i18n | — |
| **S2** | 匯入器 | upload(JSZip 保結構)+ 解析 SKILL.md + writePackage(NFS)+ pip venv 安裝 SSE | S1 |
| **S3** | 背景 job | `agent_jobs` 表 + `agentJobService`(clone ExcelJob)+ 鈴鐺 + recovery | S0 |
| **S4** | chat dispatch | `chat.js:2688` agent 分支 → createJob;pipeline/prompt/workflow 防呆 | S1,S3 |
| **S5** | 沙箱加固 | forked child + oom_score_adj + semaphore + egress 鎖 + non-root + sandbox image | S3 |
| **S6** | 收尾 / vision 產品化 | 黃金藍圖載入 + vision QA service 化 + ShareModal | S2,S4 |

> **MVP 線(內部可信 skill 先上)**:S0→S1→S2→S3→S4,沙箱(S5)在「只跑自家上傳的 skill」階段可延後;**開放外部/社群 skill 前 S5 必須先到位**。

## 9. 風險 / 成本

- **token 燒得兇**:agentic 多輪 + vision 比單次 tool call 貴一個量級。必設 step/token budget + fallback(PoC 已有)。單份簡報 PoC 實測 80k~250k token。
- **沙箱是真 untrusted execution**:S5 沒到位前只跑自家 skill。
- **license**:匯入第三方 skill 先看 license 准不准在平台跑。
- **DBA 不通知改 schema 的歷史**(memory `project_dba_schema_changes`)→ 新欄位 migration 要 idempotent。

## 10. 檔案索引(Phase 0 已存在)

`server/services/skillAgent/`:`poc.js`(入口)/ `loop.js`(大腦+雙層 QA)/ `tools.js`(write_file·bash·qa_check)/ `sandbox.js`(workspace)/ `visionQa.js`(渲染+看圖評審)/ `render_preview.py`。skill 包範例:`docs/pptx skill/`。
