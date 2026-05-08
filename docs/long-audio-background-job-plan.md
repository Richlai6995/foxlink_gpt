# 長音訊背景轉錄 Job 規劃

> 把 `transcribeLongAudio` 從 chat 同步流程拆成「背景 job」,讓 user 可以**關 tab、改天通知**,行為對齊深度研究(`research_jobs`)。

---

## 動機

當前 chat 同步流程:
- 3.5h 音訊跑 12-18 分鐘(Q1 加速後),user **必須守在 tab 不能關**
- nginx-ingress SSE timeout 3600s 雖然夠,但 user 體驗差
- 跑到一半 user 不小心關 tab → SSE 中斷,但後台還在跑(浪費 token);完成也看不到結果
- 多檔同時轉錄 → 多個 SSE 連線並存,佔資源

對齊現有 `深度研究`(researchService)做法,把長音訊轉錄變 **fire-and-forget background job**:
- POST 完立刻拿 jobId、SSE 關閉
- 後台跑完寫 chat_message + 推未讀通知
- User 關 tab 也能看到結果(toast / notification widget)

---

## Pattern 借鏡(完全沿用 researchService 架構)

| 項目 | research_jobs 怎麼做 | transcribe_jobs 抄什麼 |
|-----|---------------------|----------------------|
| Job 啟動 | `POST /api/research/jobs` → INSERT job → `setImmediate(runResearchJob)` | 一樣,改成 transcribe |
| Job 狀態 | Oracle `research_jobs` 表 | 新建 `transcribe_jobs` 表(同 schema 結構) |
| Worker | 同 process,`setImmediate` | 一樣,`runTranscribeJob` |
| 多 pod 鎖 | DB row lock(`lock_token`)+ heartbeat 60s | 一樣 |
| Pod 重啟 | SIGTERM `gracefullyPauseActiveJobs` + 其他 pod recovery scheduler | 一樣 |
| Recovery 上限 | 3 次 | 一樣 |
| 進度回報 | 前端 polling 3s | 一樣 |
| 完成通知 | `is_notified` flag + chat message placeholder `__RESEARCH_JOB__:{id}` | 一樣,placeholder `__TRANSCRIBE_JOB__:{id}` |
| 前端 UI | `ResearchProgressCard` polling | 抄成 `TranscribeProgressCard` |

**關鍵原則:不重發明輪子**。連程式碼結構都比照 [researchService.js](../server/services/researchService.js) 的 `runResearchJob` 寫。

---

## DB schema

新建 `transcribe_jobs` 表(`database-oracle.js` 的 `runMigrations()` 加 createTable):

```sql
CREATE TABLE transcribe_jobs (
  id                  VARCHAR2(36)  NOT NULL,           -- UUID
  user_id             NUMBER        NOT NULL,
  session_id          VARCHAR2(36),                     -- 來源 chat session
  message_id          NUMBER,                           -- placeholder chat_message id
  audio_filename      VARCHAR2(500) NOT NULL,           -- 原始檔名(顯示用)
  audio_path          VARCHAR2(1000) NOT NULL,          -- NFS persisted upload path
  audio_size_mb       NUMBER,
  audio_mime_type     VARCHAR2(100),
  duration_sec        NUMBER,                           -- ffprobe 抓的總時長
  status              VARCHAR2(20)  DEFAULT 'pending',  -- pending / running / done / failed
  segment_total       NUMBER        DEFAULT 0,          -- ffmpeg 切完才知道
  segment_done        NUMBER        DEFAULT 0,          -- 進度
  segments_json       CLOB,                             -- [{idx, ok, text, attempts, marker, in, out, error?}]
  transcript_chars    NUMBER        DEFAULT 0,          -- 累計字數
  transcript_file     VARCHAR2(500),                    -- transcript_xxx.txt 檔名
  in_tokens_total     NUMBER        DEFAULT 0,
  out_tokens_total    NUMBER        DEFAULT 0,
  estimated_usd       NUMBER,                           -- 提交時預估
  actual_usd          NUMBER        DEFAULT 0,
  error_msg           VARCHAR2(1000),
  is_notified         NUMBER(1)     DEFAULT 0,
  recovery_count      NUMBER        DEFAULT 0,
  lock_token          VARCHAR2(64),
  heartbeat_at        TIMESTAMP,
  created_at          TIMESTAMP     DEFAULT SYSTIMESTAMP,
  updated_at          TIMESTAMP     DEFAULT SYSTIMESTAMP,
  completed_at        TIMESTAMP,
  CONSTRAINT pk_transcribe_jobs PRIMARY KEY (id)
);

CREATE INDEX idx_transjobs_user_status ON transcribe_jobs(user_id, status);
CREATE INDEX idx_transjobs_recovery   ON transcribe_jobs(status, heartbeat_at);
```

**為什麼 audio 要 persist 到 NFS**:K8s 多 pod。User POST 命中 pod A,worker 可能在 pod B 跑。upload tmp 在 emptyDir 不共享,**音檔必須先複製到 NFS upload PVC**,worker 才能讀。

---

## API endpoints(server/routes/transcribe.js 擴充)

| Method | Path | 用途 |
|-------|------|------|
| `POST` | `/api/transcribe/jobs` | 創 job(從 chat audio branch 內部呼叫,或前端直接呼叫) |
| `GET`  | `/api/transcribe/jobs` | 列 user 自己的 jobs(最新 50 筆) |
| `GET`  | `/api/transcribe/jobs/:id` | 單一 job 詳情(前端 polling 用) |
| `GET`  | `/api/transcribe/jobs/unnotified` | 未通知的完成 job(前端 toast 用) |
| `POST` | `/api/transcribe/jobs/:id/notify` | 標 `is_notified=1` |
| `GET`  | `/api/transcribe/admin/jobs` | Admin 監控(全系統) |

---

## Worker 流程(`server/services/transcribeJobService.js`)

```
runTranscribeJob(db, jobId):
  // 1. 取 lock + heartbeat
  acquireLock(jobId, lockToken)        ← UPDATE WHERE lock_token IS NULL
  startHeartbeat(60s interval)

  try:
    // 2. 讀 job
    job = SELECT * FROM transcribe_jobs WHERE id=?
    UPDATE status='running'

    // 3. 已完成段恢復(支援 pod 重啟)
    segments = JSON.parse(job.segments_json || '[]')
    if segments.length === 0:
      // 第一次跑:ffprobe + ffmpeg 切片
      duration = await probeAudioDuration(job.audio_path)
      parts = await splitAudio(job.audio_path, 30min, tmpDir)
      UPDATE duration_sec, segment_total = parts.length
      segments = parts.map((p, i) => ({ idx: i, ok: false, partPath: p }))
    else:
      // recovery:跳過已完成段
      console.log(`[TranscribeJob] ${jobId} resume from segment ${segment_done}`)

    // 4. 平行轉錄(concurrency=2)
    for batch of segments where !ok:
      await Promise.all(batch.map(transcribe + retry))
      UPDATE segments_json, segment_done, in_tokens_total, out_tokens_total
                                          ← 每段完成立即 update,前端 polling 看得到

    // 5. concat + 寫 .txt
    text = segments.map(s => `[${s.marker}]\n${s.text}`).join('\n\n')
    writeFile(`uploads/generated/transcript_${safe}_${ts}.txt`, text)
    UPDATE transcript_file, transcript_chars, status='done', completed_at

    // 6. 更新 placeholder chat_message
    if job.message_id:
      UPDATE chat_messages SET content = '✅ 已完成轉錄,共 X 字...' WHERE id=?
      INSERT files_json with .txt link

  catch e:
    UPDATE status='failed', error_msg=e.message

  finally:
    stopHeartbeat()
    releaseLock(jobId)
    cleanupTmpDir()
```

關鍵設計:
- **每段完成立即 update DB**(不等全部完成才寫),前端 polling 才看得到 `3/7 done`
- **segments_json 是 source of truth**,recovery 從這裡 resume
- **ffmpeg 切片在 tmp**(不放 NFS,避免 NFS 寫入慢),原音檔要在 NFS

---

## SIGTERM + Recovery(完全抄 researchService)

```js
// server.js 加
process.on('SIGTERM', async () => {
  await researchService.gracefullyPauseActiveJobs(db);
  await transcribeJobService.gracefullyPauseActiveJobs(db);  // 新加
  setTimeout(() => process.exit(0), 60000);  // 60s grace
});

// transcribeJobService.js
async function gracefullyPauseActiveJobs(db) {
  for (const jobId of ACTIVE_JOBS) {
    UPDATE transcribe_jobs SET
      lock_token = NULL,
      heartbeat_at = SYSTIMESTAMP - 10 MIN  -- 觸發 recovery
    WHERE id = ?;
  }
}

// recovery scheduler(每 5 分鐘掃一次)
async function recoverStaleJobs(db) {
  // 1. recovery_count >= 3 → 標 failed
  UPDATE transcribe_jobs SET status='failed', error_msg='3 次 recovery 仍失敗'
  WHERE status='running' AND recovery_count >= 3 AND heartbeat_at < SYSTIMESTAMP - INTERVAL '5' MINUTE;

  // 2. recovery_count < 3 → 重新搶
  const stale = SELECT id, recovery_count FROM transcribe_jobs
                WHERE status='running' AND heartbeat_at < SYSTIMESTAMP - INTERVAL '5' MINUTE;
  for (const job of stale) {
    const ok = UPDATE transcribe_jobs SET
      recovery_count = recovery_count + 1,
      lock_token = NULL
    WHERE id = ? AND recovery_count = ?;  -- optimistic lock
    if (ok) setImmediate(() => runTranscribeJob(db, job.id));
  }
}
```

---

## chat.js 整合

audio branch 改寫:

```js
if (mimeType.startsWith('audio/')) {
  const audioSizeMB = file.size / 1024 / 1024;
  const isLongAudio = file.size > 50 * 1024 * 1024;

  if (isLongAudio) {
    // 1. 移檔到 NFS persistent location(worker 才讀得到)
    const persistDir = path.join(UPLOAD_DIR, 'long_audio', String(req.user.id));
    fs.mkdirSync(persistDir, { recursive: true });
    const persistPath = path.join(persistDir, `${Date.now()}_${file.originalname}`);
    fs.renameSync(file.path, persistPath);

    // 2. 創 job
    const jobId = await transcribeJobService.createJob(db, {
      userId: req.user.id,
      sessionId,
      audioPath: persistPath,
      audioFilename: originalName,
      audioSizeMb: audioSizeMB,
      audioMimeType: mimeType,
    });

    // 3. 在 chat_messages 插 placeholder
    const msgId = await db.run(
      `INSERT INTO chat_messages (session_id, role, content)
       VALUES (?, 'user', ?) RETURNING id`,
      [sessionId, `[音訊背景轉錄: ${originalName}] __TRANSCRIBE_JOB__:${jobId}`]
    );
    await db.run('UPDATE transcribe_jobs SET message_id=? WHERE id=?', [msgId, jobId]);

    // 4. 立刻 SSE 回覆 user,關連線
    sendEvent({ type: 'status', message: `✅ 已啟動背景轉錄 (${audioSizeMB.toFixed(1)}MB)。完成後會通知您,可以關閉視窗。` });
    sendEvent({ type: 'transcribe_job_started', jobId, message_id: msgId });
    sendEvent({ type: 'done' });
    res.end();

    // 5. 啟動 worker(setImmediate 不阻塞回應)
    setImmediate(() => transcribeJobService.runTranscribeJob(db, jobId));
    return;
  }

  // 短音訊維持原同步路徑
  const transcribeResult = await transcribeAudio(filePath, mimeType);
  // ... existing code
}
```

---

## 前端改動

### 1. Chat 訊息渲染(`MessageRenderer.tsx`)

偵測 placeholder `__TRANSCRIBE_JOB__:{jobId}`:

```tsx
if (message.content.includes('__TRANSCRIBE_JOB__:')) {
  const jobId = extractJobId(message.content);
  return <TranscribeProgressCard jobId={jobId} />;
}
```

### 2. `TranscribeProgressCard`(抄 `ResearchProgressCard`)

- polling `GET /api/transcribe/jobs/:id` 每 3s
- 顯示 progress bar `3/7 段 (42%)`
- 顯示已轉錄字數累計
- status='done' → 顯示 .txt 下載連結 + 摘要
- status='failed' → 顯示 error
- 完成時自動 `POST /jobs/:id/notify` 標已通知

### 3. 通知 Widget

如果 `ResearchProgressCard` / 未讀通知 widget 已經存在 → reuse,加新 type 即可。
如果沒有,新建 `BackgroundJobsWidget`(右上角鈴鐺,點開列出所有 in-progress / 未讀 done jobs)。

### 4. UI 觸發

長音訊上傳時不需要 user 主動選「背景模式」,**`> 50MB` 一律走背景**(理由:同步路徑撐 12 分鐘 SSE 已不合理)。可選:`< 50MB` 加 toggle 讓 user 自選背景。

---

## 通知通道

**MVP 版本只做 in-app**(對齊 research_jobs):
- `is_notified` flag + `GET /jobs/unnotified` API + 前端 toast / 鈴鐺紅點

**選配未來**(暫不在 plan scope):
- Email 通知(SMTP 已配),user 偏好可關
- Webex bot DM(Webex bot 已 integrated)

---

## Phase 切分

每 phase 獨立可 review、可打住。

| Phase | 內容 | 工時 | review 點 |
|-------|-----|------|----------|
| **P0** | DB migration:`transcribe_jobs` table + indexes | 0.5d | `desc transcribe_jobs` 看 schema |
| **P1** | `transcribeJobService.js`:create / run / lock / heartbeat / recovery / sigterm(抄 researchService) | 1.5d | 從 SDK 直接 createJob → runTranscribeJob 跑 185MB,end-to-end log 看到 7 段都過 + .txt 生成 |
| **P2** | API endpoints:`/jobs` POST/GET、`/jobs/:id` GET、`/jobs/unnotified`、admin | 0.5d | curl 每個 endpoint 拿到 expected response |
| **P3** | chat.js audio branch 整合 + placeholder chat_message | 0.5d | 上傳 185MB → 立刻關 tab → 重開 chat 看到 `__TRANSCRIBE_JOB__` placeholder + 自動 polling |
| **P4** | 前端 `TranscribeProgressCard` + chat renderer + toast | 1d | UI 顯示進度條、完成後 .txt 可下載、跨 tab 通知 |
| **P5** | i18n + admin panel + 風險清理 + 測試 | 0.5d | zh-TW / en / vi 三語言;admin 看到所有 user jobs |
| **總計** | | **~4.5 天** | |

---

## 跟 Q1(加速)的關係

- Q1 已 ship(commit `fa42ada`)→ 同步路徑 50 分鐘變 12-18 分鐘
- Q2 做完之後,**同步路徑保留給 < 50MB 短音訊**,長音訊走 job
- worker 內部仍呼叫 `transcribeLongAudio`,享受 Q1 加速
- 兩個改動完全相容,不衝突

---

## 風險與緩解

| 風險 | 影響 | 緩解 |
|------|------|------|
| **音檔 NFS 滿** | 長音訊 100MB+ 累積 → NFS PVC 爆 | job 完成後 cleanup 原音檔(只留 .txt);加每日 cron 清 done jobs 30 天前的音檔 |
| **Pod 重啟 + recovery 重複工作** | 已轉的段重新跑 | `segments_json` 記錄哪些段 ok,recovery 跳過 |
| **同 user 同時跑 N 個 job** | 浪費 quota / 撞 RPM | per-user concurrent limit 2(在 createJob 檢查;超過回 429) |
| **Job 表暴增** | 一年累積數萬筆 | 加 cleanup cron(已 `done` 30 天前的 job 進歷史表 / 直接刪) |
| **Placeholder chat_message 顯示醜** | UI 怪 | 前端必須判斷 placeholder 渲染 ProgressCard,不能露出 raw 字串 |
| **User 在 transcribe 期間又改 chat 訊息** | history 對應對不上 | placeholder message 設 read-only,不能編輯/刪除 |

---

## 不做的東西(明確 out-of-scope)

- ❌ Email 通知(SMTP 雖配置,但 in-app 已足夠 MVP)
- ❌ Webex bot DM 通知(同上)
- ❌ Job priority queue / 跨 user 公平排程(MVP 用 setImmediate FIFO)
- ❌ 把音檔長期保留進 KB(對話結束就刪)
- ❌ 自訂 segment 大小 / 模型 / retry 次數的 admin UI(寫死先,有人要再加)
- ❌ Cancel 功能(MVP 不支援取消;之後加 `POST /jobs/:id/cancel`)

---

## 跟 audio-stt-pipeline-plan.md 的關係

- 那份是「換用 Google STT v2」的方案(品質質變,但成本 2.5x)
- **這份是「現有切片 + Pro 不變,只改成背景跑」**(成本不變,UX 改善)
- 兩個正交,可以**先做這份(4.5 天)→ 未來真要 STT 再做那份**
- 如果之後真做 STT pipeline,本 job 框架 100% 可重用,只是 worker 內部 call 換掉

---

## 開工前要確認

- [ ] 確認 `runMigrations()` 加 createTable 的位置(database-oracle.js:1171 附近)
- [ ] 確認 NFS PVC mount path(`/app/uploads`)有沒有 `long_audio/{userId}/` 寫入權限
- [ ] 確認 SIGTERM grace period 60s 夠不夠 worker 收尾(目前每段 7 分鐘,中斷時最差會丟一段重來,acceptable)
- [ ] 確認前端是否有現成「未讀通知」widget(reuse 不重做)

---

## 參考

- [server/services/researchService.js](../server/services/researchService.js) — pattern 來源
- [server/database-oracle.js](../server/database-oracle.js) `runMigrations()` — schema 加在這裡
- [client/src/components/ResearchProgressCard.tsx](../client/src/components/ResearchProgressCard.tsx) — UI pattern 來源
- [docs/audio-stt-pipeline-plan.md](audio-stt-pipeline-plan.md) — STT 替代方案(未採用)

---

## 變更歷史

| 日期 | 內容 | 作者 |
|------|------|------|
| 2026-05-08 | 初版規劃 — 沿用 research_jobs pattern,Phase P0-P5 共 4.5d | rich_lai |
