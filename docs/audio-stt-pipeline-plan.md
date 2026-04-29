# 長音檔轉逐字稿 Pipeline 規劃(STT + Gemini 校正)

> 解決 Gemini 直接轉錄長音檔的兩大瓶頸:① output token 上限砍掉長 transcript;② 100MB+ inline payload 易踩 fetch timeout / Google server-side 處理超時。
>
> 目標流程:**Google Cloud STT v2(diarization)→ Gemini 校正 → 產 .txt + .srt → inject 摘要進 chat**。

---

## 背景與動機

### 目前痛點(2026-04-29 實測)

1. **Output 上限被截斷** — Gemini Flash 單次 output cap 65k tokens(≈ 4-5 萬中文字 ≈ 30-60 分鐘語音),長演講(2-3hr)逐字稿被砍尾巴
2. **Inline 大檔不穩** — 184MB m4a → base64 246MB → AI Studio 處理 5min+ 超時(`Headers Timeout Error`,已用 undici global dispatcher 拉到 30 分鐘但 Google 端仍可能慢過 25 分 outer timeout)
3. **沒有 speaker diarization 結構化資料** — Gemini prompt 出來的 [S1]/[S2] 是 LLM 推測,長片段可能跑掉

### 既有方案對照

| 方案 | Diarization | 長度上限 | 成本/分鐘 | output 限制 |
|---|---|---|---|---|
| **Gemini Flash(現行)** | ✅ prompt-based | ~30min(實務) | ~$0.01 | **65k tokens 砍** |
| Whisper API | ❌(需 pyannote 後處理) | 25MB / 一次 | $0.006 | 無 |
| AssemblyAI | ✅(業界最好) | 無 | $0.011 | 無 |
| Deepgram Nova-3 | ✅ | 無 | $0.007 | 無 |
| **Google Cloud STT v2** | ✅(內建) | 無(async) | $0.024 | 無 |

選 Google STT v2 理由:**已有 GCP credentials(Vertex AI 在用)**,不用新申請帳號,SA 加權限即可。

---

## 拍板決策

| 項目 | 決定 | 理由 |
|---|---|---|
| Q1. GCS bucket | **`foxlink-stt-temp`** 專屬 + 24h lifecycle auto-delete | 權限 / 帳單 / 清理隔離,不污染現有資產 |
| Q2. STT API | **v2 LongRunningRecognize**,model=`latest_long` | v2 中文識別好、auto-detect encoding(m4a 不用先轉)、原生 diarization |
| Q3. 校正模型 | **可設定**(`system_settings.stt_correction_model`),default=`flash` | 使用者可在 admin UI 切 Flash / Pro / 不校正 |
| Q4. LLM context | **inject 摘要 + 前 3000 字**;完整 .txt/.srt 附檔給用戶下載 | 避免 7.5 萬 tokens 壓爛 multi-turn chat |
| Q5. threshold | **音訊 > 100MB 才走 STT pipeline**;< 100MB 沿用 `transcribeAudio` 直送 Gemini | 小檔走舊路徑快又便宜,不必繞 GCS |

---

## 架構

```
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend                                                             │
│  上傳 m4a + chat 訊息                                                 │
│  (UI 顯示 4 段進度: ✓Upload → STT(2m) → ✓Format → 校正 5/8 → ✓Done)  │
└──────────────────────────────────────────────────────────────────────┘
            │ multipart/form-data
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  chat.js audio 分支                                                   │
│  if (file.size > 100MB) → sttPipeline.process(filePath)              │
│  else → transcribeAudio(filePath, mimeType) [既有路徑]               │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  services/sttPipeline.js                                              │
│                                                                       │
│  Step 1: GCS upload                                                   │
│    gcsClient.upload(localPath) → gs://foxlink-stt-temp/{uuid}.m4a    │
│    SSE: status "上傳音訊到 GCS (1/4)..."                              │
│                                                                       │
│  Step 2: Google STT v2 LongRunningRecognize                          │
│    config = {                                                         │
│      model: 'latest_long',                                           │
│      languageCodes: ['zh-TW', 'en-US'],                              │
│      autoDecodingConfig: {},                                          │
│      features: {                                                      │
│        enableWordTimeOffsets: true,                                  │
│        enableWordConfidence: true,                                    │
│        diarizationConfig: {                                          │
│          minSpeakerCount: 1,                                         │
│          maxSpeakerCount: 6,                                          │
│        }                                                              │
│      }                                                                │
│    }                                                                  │
│    SSE: status "STT 處理中,已等 30s (預計 3-10 分鐘) (2/4)..."       │
│    Poll operation → wait → 拿 words[] (含 speaker_label, startTime)  │
│                                                                       │
│  Step 3: words[] → 結構化 text                                        │
│    SSE: status "逐字稿後處理中 (3/4)..."                              │
│    formatSpeakerTurns(words) → string:                                │
│      [S1, 00:00:05] 大家好我是XXX...                                  │
│      [S2, 00:01:20] 那這邊我想請問一下...                              │
│      [S1, 00:01:35] 對對對所以...                                      │
│    (連續同 speaker 合併為一行,換人才換段)                            │
│                                                                       │
│  Step 4: Gemini 校正(if model != 'none')                            │
│    SSE: status "Gemini 校正中 5/8 段 (4/4)..."                        │
│    chunkAtSpeakerBoundary(text, maxChars=5000) → chunks[]            │
│    parallel(concurrency=3):                                           │
│      gemini.generate(chunk, prompt='校正錯字/標點/同音/術語,         │
│                                     保留 [S]/[時間],不改語意')      │
│    concat chunks → corrected text                                    │
│                                                                       │
│  Step 5: 產檔 + cleanup                                               │
│    .txt → uploads/generated/{sessionId}_{originalName}.txt           │
│    .srt → uploads/generated/{sessionId}_{originalName}.srt           │
│    summary = Gemini.generate(corrected, '產 200 字摘要 + 5 重點')    │
│    gcsClient.delete(gsUri)  // 雙保險,lifecycle 也會刪              │
│    return { txt, srt, summary, firstChars: corrected.slice(0,3000) } │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  chat.js 後續                                                         │
│  combinedUserText += `\n\n[音訊轉錄: ${name}]\n${summary}\n\n`+     │
│    `[逐字稿前 3000 字]\n${firstChars}\n\n`+                          │
│    `[完整逐字稿請見附檔 ${txtFilename}]`                              │
│  fileMetas.push({ type:'audio', transcript_files:[txt, srt] })       │
│  sendEvent({ type:'generated_files', files:[txt, srt] })             │
│  → 進入 LLM chat,user 可下載完整檔                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 檔案異動清單

### 新增

| 檔案 | 內容 |
|---|---|
| `server/services/sttPipeline.js` | 主 orchestrator(Step 1-5) |
| `server/services/gcsClient.js` | GCS upload / delete helper(未來別的功能也能共用) |

### 修改

| 檔案 | 改動 |
|---|---|
| `server/server.js` | startup 印 `[STT] bucket=X correction_model=Y` |
| `server/routes/chat.js` audio 分支 | size > 100MB 走 sttPipeline,否則沿用 transcribeAudio |
| `server/database-oracle.js` `runMigrations()` | seed `system_settings.stt_correction_model='flash'` |
| `server/routes/admin.js` 或 `settings.js` | GET/PUT `/api/admin/settings/stt`(model + 開關) |
| `client/src/components/admin/AppSettings.tsx`(或新 tab) | STT 設定 UI |
| `server/.env.example` | 新增 `STT_BUCKET=foxlink-stt-temp` 範例 |
| `client/src/i18n/locales/{zh-TW,en,vi}.json` | 新增 STT 進度 / 設定字串 |

---

## 環境變數

```bash
# 新增
STT_BUCKET=foxlink-stt-temp           # 必要 — GCS bucket name
STT_AUDIO_THRESHOLD_MB=100            # 選配 — 走 STT pipeline 的大小門檻,default 100

# 沿用既有
GCP_PROJECT_ID=...                    # 既有(Vertex AI 在用)
GOOGLE_APPLICATION_CREDENTIALS=...    # 既有(SA key 路徑)
GCP_LOCATION=...                      # 既有(STT 不需要,但 SDK 共用)
```

## npm dependencies

```bash
cd server && npm install @google-cloud/speech @google-cloud/storage
```

兩個都是官方 SDK,跟現有 `@google-cloud/vertexai`(legacy)同 family,不會撞版本。

---

## DB schema 異動

### `system_settings` 新增 keys

| key | value | 說明 |
|---|---|---|
| `stt_correction_model` | `'flash'` \| `'pro'` \| `'none'` | 校正模型;none = 不校正直接出 STT raw |
| `stt_audio_threshold_mb` | `'100'` | 走 STT 的大小門檻(預留,可在 admin 調) |
| `stt_max_speakers` | `'6'` | diarization maxSpeakerCount |
| `stt_languages` | `'zh-TW,en-US'` | comma-separated,STT 偵測 |

### `chat_messages.files_json` 結構擴充

```json
[
  {
    "name": "CEBG.m4a",
    "type": "audio",
    "transcript_method": "stt_v2_corrected",  // or "gemini_inline"
    "transcript_files": {
      "txt": "CEBG_transcript_20260429.txt",
      "srt": "CEBG_transcript_20260429.srt"
    },
    "duration_sec": 5400,
    "speaker_count": 3,
    "stt_cost_usd": 4.32,
    "correction_cost_usd": 0.224
  }
]
```

(可選 — 若要追蹤成本)

---

## SSE event 流程(給前端)

```js
// 進場
sendEvent({ type:'status', message:'正在轉錄: CEBG.m4a (184.77MB),走 STT pipeline,預計 3-15 分鐘' });

// Step 1
sendEvent({ type:'status', message:'⬆ 上傳音訊到 GCS (1/4)...' });

// Step 2 (心跳每 15s)
sendEvent({ type:'status', message:'🎙 STT 處理中,已等 60s (預計 3-10 分鐘) (2/4)...' });

// Step 3
sendEvent({ type:'status', message:'📝 逐字稿後處理 (3/4)...' });

// Step 4
sendEvent({ type:'status', message:'✨ Gemini 校正 5/8 段 (4/4)...' });

// 完成
sendEvent({
  type: 'generated_files',
  files: [
    { filename:'CEBG_transcript.txt', publicUrl:'/uploads/generated/...' },
    { filename:'CEBG_transcript.srt', publicUrl:'/uploads/generated/...' }
  ]
});
sendEvent({ type:'status', message:'✓ 完成,共 3 位說話人,90 分鐘' });
```

前端 `setStreamingStatus` 已會顯示這些訊息(沿用既有機制)。

---

## Phase 切分

每個 phase 獨立 review,可以打住 / 改方向。

| Phase | 內容 | 工時 | review 點 |
|---|---|---|---|
| **P0**(0.5d) | bucket / API / IAM 設定(gcloud 指令) + npm install + .env 加 key | 0.5d | bucket 能列、API 啟用、SA 有權限 |
| **P1**(0.5d) | `gcsClient.js` upload/delete + `sttPipeline.js` Step 1-2(只到拿 words[]) | 0.5d | console.log raw words[],人工檢查 diarization 品質 |
| **P2**(0.5d) | Step 3 words → speaker turns 格式化 + 產 .txt/.srt | 0.5d | 樣本檔 .txt/.srt 看格式 |
| **P3**(0.5d) | Step 4 Gemini chunk 校正 + 並行 + 摘要 | 0.5d | 校正前後對比 diff |
| **P4**(0.5d) | chat.js 整合 + SSE progress + cleanup | 0.5d | 端對端跑 184MB CEBG.m4a |
| **P5**(0.5d) | admin UI(model 切換 / 開關 / threshold) + i18n | 0.5d | admin 改設定即時生效 |
| **總計** | | **3 天** | |

---

## 成本評估(以 3 小時音訊為例)

| 項目 | 計算 | 成本 |
|---|---|---|
| GCS storage 24h(200MB) | $0.020/GB-month × 0.2GB / 30 | ~$0.0001 |
| GCS egress(讀回 Compute Engine 同 region) | 內部免費 | $0 |
| GCS class A operations(write/delete) | $0.005/1k × 2 | ~$0.00001 |
| **STT v2 latest_long + diarization** | $0.024/min × 180min | **$4.32** |
| **Gemini Flash 校正**(input 80k + output 80k tokens) | $0.30 × 0.08M + $2.50 × 0.08M | **$0.224** |
| **單次總計** | | **~$4.55** |

對比目前 Gemini Flash 直接轉錄(~$0.01/min × 180min = **$1.80**,但**截斷 + 易超時**),**貴 ~2.5x 但完整 + diarization**。

如果切換 `stt_correction_model='pro'`,校正成本變 ~$3.5,單次總 ~$7.8。

---

## 一次性 GCP 設定(P0 要跑的指令)

```bash
PROJECT_ID=<你的 GCP project>
SA_EMAIL=<你的 service account email>

# 1. 建 bucket
gcloud storage buckets create gs://foxlink-stt-temp \
  --project=$PROJECT_ID \
  --location=ASIA-EAST1 \
  --uniform-bucket-level-access

# 2. lifecycle 24h auto-delete
cat > /tmp/lifecycle.json <<'EOF'
{
  "lifecycle": {
    "rule": [
      { "action": {"type": "Delete"}, "condition": {"age": 1} }
    ]
  }
}
EOF
gcloud storage buckets update gs://foxlink-stt-temp --lifecycle-file=/tmp/lifecycle.json

# 3. SA 給 bucket admin
gcloud storage buckets add-iam-policy-binding gs://foxlink-stt-temp \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

# 4. 啟用 STT API
gcloud services enable speech.googleapis.com --project=$PROJECT_ID

# 5. SA 給 STT 權限
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/speech.editor"

# 6. 驗證
gcloud storage ls gs://foxlink-stt-temp
gcloud services list --enabled --filter="speech" --project=$PROJECT_ID
```

如果要 console UI 操作,P0 開工時補步驟。

---

## 雷區與待解問題

### 已知雷

1. **Diarization 在 v2 是 preview / 部分 region 限制** — `latest_long` model 在 `global` endpoint 應該支援,但要實測確認;有的 region 只支援 `chirp_2`(沒 diarization)
2. **m4a/aac auto-decoding** — v2 `autoDecodingConfig:{}` 會自動偵測,但 corrupted m4a 仍可能 fail。要 fallback 到 `explicitDecodingConfig` + ffmpeg 預轉碼
3. **diarization 對短話無效** — 1-2 字的「對」「嗯」可能沒分到 speaker_tag,要在後處理時 attach 到前一個 turn
4. **語言切換** — 中英夾雜時 `languageCodes: ['zh-TW', 'en-US']` 會 auto-detect,但**整段切到英文後再切回中文**有時 confidence 掉
5. **Gemini 校正改壞** — Pro / Flash 偶爾「過度校正」改變語意(尤其口語、不通順的話)。要在 prompt 強制「保留口語化、不要改寫成書面語」
6. **GCS upload 184MB 時間** — 公司網→ GCS 視 outbound bandwidth,可能 30s-3 分鐘。要在 SSE 顯示 "上傳中 X%"

### 未拍板待研

| 問題 | 何時決定 |
|---|---|
| 是否儲存 transcript 到 KB(Q4 的選項 C) | P5 結束後 user feedback |
| `stt_max_speakers` 預設 6 是否合理 | P1 實測幾個樣本 |
| 校正 chunk 大小(預設 5000 字)是否要設可調 | P3 實測 |
| 是否要加「校正前 vs 校正後」對比 UI | P5 之後評估 |
| 失敗 retry 策略(STT operation 失敗 / Gemini 校正某段失敗) | P4 實作時補 |
| 多語言介面字串(zh-TW / en / vi)的 STT 進度訊息 | P5 |

### Fallback 策略(P4 必做)

```
sttPipeline 任一步失敗:
  1. 印詳細錯誤 log(模仿 transcribeAudio 的 7 層欄位)
  2. cleanup GCS object
  3. SSE 送 status 訊息給前端
  4. fallback 到 transcribeAudio 直送 Gemini(可能也失敗,但至少嘗試)
  5. 最後失敗 → combinedUserText 加 [音訊轉錄失敗: 原因]
```

---

## 風險評估

| 風險 | 影響 | 緩解 |
|---|---|---|
| STT 月費爆預算 | 中 | admin UI 可關閉 STT pipeline,fallback 到 Gemini direct;新增 daily quota 監控(`stt_daily_minute_cap`) |
| GCS bucket 權限外洩 | 低 | uniform-bucket-level-access + 只給 SA 權限,public access 強制關閉 |
| GCS 檔案沒清乾淨 | 低 | 程式 finally + lifecycle 24h 雙保險;每月 dashboard 查 bucket size |
| 長 STT 任務阻塞 chat 連線 | 中 | SSE 心跳 15s/次;ingress timeout 已 3600s;若超過 25min outer timeout 會被切 |
| Gemini 校正改壞語意 | 中 | admin 可切到 `stt_correction_model='none'`;prompt 強制「保留口語」+ test set 驗證 |

---

## 上線後監控指標(可選 — Phase 後做)

- STT 月用量(分鐘 / 美元)
- pipeline 各 step 平均耗時(GCS upload / STT / format / 校正)
- 失敗率(by step)
- 每月最常用此功能的 user top 10

---

## 與既有架構的關係

- **不影響 transcribeAudio 既有路徑** — < 100MB 檔案完全沿用,行為不變
- **不影響 `/api/transcribe`(MicButton 麥克風轉文字)** — 那條 20MB 麥克風路線不動
- **共用 GeminiClient + Gemini 計費邏輯** — 校正用既有 streamChat / generate(token usage 自動進 token_usage 表)
- **與 Webex audio handler 解耦** — 目前 Webex 沒有大檔音訊上傳需求,先不整合
- **與 KB 解耦** — Q4 選 B,不自動進 KB;若未來要做 C,在 P5 之後另開 plan

---

## 參考資料

- [Google Cloud Speech-to-Text v2 docs](https://cloud.google.com/speech-to-text/v2/docs)
- [Diarization config v2](https://cloud.google.com/speech-to-text/v2/docs/multiple-voices)
- [LongRunningRecognize 範例](https://cloud.google.com/speech-to-text/v2/docs/sync-recognize)
- 既有 `transcribeAudio` 實作:[server/services/gemini.js:160](../server/services/gemini.js#L160)
- 既有 chat audio 分支:[server/routes/chat.js:1352](../server/routes/chat.js#L1352)

---

## 變更歷史

| 日期 | 內容 | 作者 |
|---|---|---|
| 2026-04-29 | 初版規劃 — 拍板 Q1-Q5 + 架構 + Phase 切分 | rich_lai |
