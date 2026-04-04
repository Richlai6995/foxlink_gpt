# Hotspot 互動區域管理改進計畫

> 日期：2026-04-03（規劃）、2026-04-04（實作完成）
> 狀態：✅ 全部完成

## 背景問題

1. **AI 辨識漏標** — 密碼欄位等元素未被偵測到，缺乏便利的手動新增方式
2. **AI 辨識重疊** — 驗證碼區域產生 3 個重疊的互動框，需要能快速清理
3. **多語 Region 缺乏彈性** — 不同語言的 UI layout 可能不同（按鈕數量、位置），需要各語言獨立管理 region
4. **互動只支援單一目標** — 點中任一正確 region 就結束，不支援多步驟導引
5. **缺乏測驗模式** — 無法驗證學員是否真的學會操作

---

## Phase 3B-1：互動區域管理改善 ✅

### 選取/繪製模式分離

| 模式 | 行為 | 游標 |
|------|------|------|
| 🖱 選取模式（預設） | 點擊選取 region → 拖移位置 / resize handle 調整大小 | `default` |
| ✏️ 繪製模式 | 在圖上拖拉 = 畫新 region，畫完自動切回選取模式 | `crosshair` |

### Region CRUD 完善

| 功能 | 狀態 | 說明 |
|------|------|------|
| 新增區域 | ✅ | 繪製模式拖拉 + 「+ 新增區域」按鈕 |
| 編輯區域 | ✅ | 拖移、四角 resize、toggle correct、label、feedback、narration |
| 刪除區域 | ✅ | 🗑 按鈕 |
| 排序區域 | ✅ | GripVertical 握把 + HTML5 drag-and-drop |
| 抽換底圖 | ✅ | 🔄 按鈕直接替換 image，保留 regions/annotations/feedback |
| 複製投影片 | ✅ | `POST /slides/:sid/duplicate`，複製全部內容插入原始後面 |

### 多語獨立 Region（策略 3）

每個語言擁有**完整獨立**的 region 集合，不硬綁 zh-TW 為主語言。

#### 資料結構

```
content_json.blocks[i].regions = [...]                          // 主語言 regions
slide_translations.regions_json = {                             // CLOB
  "0": [{ id, shape, coords, correct, feedback, label }]       // block index → region 陣列
}
// image_overrides.region_overrides 保留向下相容
```

#### 行為邏輯

| 場景 | 行為 |
|------|------|
| 語言 X 尚未設定 `regions_json` | fallback 到主語言 regions |
| 點「建立獨立區域」 | 從主語言 copy 一份作為起點 |
| 語言 X 已有獨立 regions | 完全獨立操作 |
| 「從其他語言複製」 | click 下拉選單選擇來源語言 |
| 「回到繼承」 | 刪除獨立 regions |

#### API

| Method | Endpoint | 說明 |
|--------|----------|------|
| GET | `/slides/:sid/lang-regions` | 取得各語言獨立 regions |
| PUT | `/slides/:sid/lang-regions` | 儲存語言獨立 regions |
| DELETE | `/slides/:sid/lang-regions` | 刪除（回到繼承） |

#### 優先級

`regions_json` > `region_overrides`（座標微調）> 主語言 regions

### Annotation 修復

- 投影片生成不再清空 annotations，一律保留原始資料
- Editor / Player 一律從 `block.annotations` 讀取並渲染 SVG overlay
- HTML 匯出不再強制清空 annotations

---

## Phase 3B-2：互動模式引擎 ✅

### 三種互動模式

| | 🎯 導引模式 | 🔍 探索模式 | 📝 測驗模式 |
|---|---|---|---|
| 設定層級 | block `interaction_mode` | block `interaction_mode` | Player `playerMode` |
| 區域 highlight | 當前步驟高亮 | 全部可見 | 全部隱藏 |
| Hover tooltip | 有 | 有 | 無 |
| 步驟提示 | narration + 語音 | 自由點 | 只顯示任務名稱 |
| 點錯時 | 顯示 feedback | 顯示元素資訊 | 漸進式提示 |
| 點對時 | 綠色動畫 1.5s | 打勾 | 低調確認 0.8s |
| 語音 | 自動播放 | 點擊播放 | 不主動播放 |

### 導引模式（Guided）

- `currentStep` 逐步推進
- 只 highlight 當前目標，其他暗淡（opacity 0.3）
- 自動播放 region 音檔
- 點對 → feedback + 綠色動畫 → 1.5 秒後推進

### 探索模式（Explore）

- 所有區域可點擊（含 non-correct）
- 追蹤已探索 Set，進度條顯示
- 全部 correct 區域探索完 → 完成

### 測驗模式（Test）

- Player 層級切換（📖 學習 / 📝 測驗），同一份教材兩種用途
- 強制使用 guided 步驟順序
- 區域邊框/標籤/Hover tooltip/標註全部隱藏
- 漸進式提示：
  - 1-2 次錯：「位置不對，再試試。」
  - 3+ 次錯：「💡 提示：」+ narration 文字
  - N 次錯（`show_hint_after`）：降級 highlight 正確位置
- 操作步驟列表完成後才顯示
- 切換模式時自動 reset 所有狀態

### Player UX

| 功能 | 說明 |
|------|------|
| 步驟進度條 | 底部圓點 1→2→3→4，完成打勾，含 label |
| Hover tooltip | 懸停顯示元素名稱浮動提示（學習模式） |
| 步驟間動畫 | 綠色 flash + smooth transition |
| 復習/重做 | 完成後「🔄 再做一次」按鈕 |
| 自動下一頁 | 完成後「下一頁 →」按鈕，最後一頁顯示「🎉 課程完成」 |
| 語音控制 | 🔊/🔇 靜音切換 |
| 操作步驟列表 | 右側面板，當前步驟高亮，完成打勾刪除線 |

---

## Phase 3B-3：Region 語音導引 ✅

### Region 資料結構擴充

```js
{
  id, shape, coords, correct, feedback, label,
  narration: '請點擊帳號欄位',              // 學習模式語音文稿
  audio_url: '/tts/r1.mp3',                // 學習模式音檔
  test_hint: '帳號在畫面上方，加油！',       // 測驗模式提示
  test_audio_url: '/tts/test_r1.mp3',       // 測驗模式音檔
  explore_desc: '這是帳號輸入欄位',          // 探索模式說明
  explore_audio_url: '/tts/explore_r1.mp3',  // 探索模式音檔
  feedback_wrong: '不太對，再找找看'         // 錯誤回饋
}
```

### Block 層級語音

```js
{
  editor_context: '本系統為正崴集團...',           // 編輯者補充說明
  slide_narration: '歡迎來到登入畫面...',          // 導引前導
  slide_narration_audio: '/tts/intro_guided.mp3',
  slide_narration_test: '請完成登入操作...',        // 測驗前導
  slide_narration_test_audio: '/tts/intro_test.mp3',
  slide_narration_explore: '這是登入畫面...',       // 探索前導
  slide_narration_explore_audio: '/tts/intro_explore.mp3',
  completion_message: '恭喜完成！'
}
```

### 課程語音設定

```js
// COURSES.SETTINGS_JSON
{
  tts_voice_gender: 'female' | 'male',  // 預設 female
  tts_speed: 0.85 | 1.0 | 1.15,         // 預設 1.0
  tts_pitch: -5 ~ 5                      // 預設 0
}
```

### AI 一鍵生成流程

```
編輯者填補充說明 → 點「✨ AI 生成全套導覽腳本 + 語音」
    ↓
Gemini 分析截圖 + regions + 補充說明
    ↓ 產出
三模式前導文稿 + 每步 narration/test_hint/explore_desc/feedback
    ↓ 自動接續
TTS 逐一生成所有音檔（前導 3 段 + 每步 3 段）
    ↓
儲存
```

### 外語語音

| 方式 | 適用場景 | 流程 |
|------|---------|------|
| 翻譯繼承 | 同 layout，只翻文字 | 翻譯 tab AI 翻譯 → 🔊 生成語音 |
| 獨立 regions | 不同 layout | LanguageImagePanel 建立獨立區域 → ✨ AI 生成外語語音 |

外語語音存放：
- 繼承：`slide_translations.content_json` 內各欄位的 audio_url
- 獨立：`slide_translations.regions_json` 內 region 的 audio_url + `_intro` 的 audio_url

### API

| Method | Endpoint | 說明 |
|--------|----------|------|
| POST | `/slides/:sid/region-tts` | 單一 region TTS（支援 `language` 參數） |
| POST | `/slides/:sid/generate-narration` | AI 生成全套腳本（支援 `lang` 參數讀獨立 regions） |
| POST | `/courses/:id/generate-lang-tts` | 批次為翻譯版所有 hotspot 生成外語 TTS |
| GET | `/courses/:id/tts-settings` | 取得課程 TTS 設定 |

### Player 語音時序

```
進入 hotspot 投影片
  → CoursePlayer 跳過 slide audio（偵測 hotspot）
  → HotspotBlock 接管：
    1. 播前導語音（根據 playerMode 選對應音檔）
    2. 播完 → introPlayed=true → 啟動互動
    3. 導引模式：自動播 region audio_url
    4. 探索模式：點擊播 explore_audio_url
    5. 測驗模式：不主動播，錯 3 次播 test_audio_url
    6. 點對 → stopAudio → 推進下一步
    7. 靜音 → 立即 pause + 跳過前導
```

---

## 修改檔案清單

### Backend
| 檔案 | 修改 |
|------|------|
| `server/database-oracle.js` | `SLIDE_TRANSLATIONS` +`REGIONS_JSON` CLOB, `COURSES` +`SETTINGS_JSON` CLOB |
| `server/routes/training.js` | lang-regions CRUD (3 endpoints) |
| `server/routes/training.js` | `POST /slides/:sid/region-tts` (支援 `language` 參數) |
| `server/routes/training.js` | `POST /slides/:sid/generate-narration` (支援 `lang` 參數讀獨立 regions) |
| `server/routes/training.js` | `POST /slides/:sid/duplicate` |
| `server/routes/training.js` | `POST /courses/:id/generate-lang-tts` 批次外語 TTS |
| `server/routes/training.js` | `GET /courses/:id/tts-settings` |
| `server/routes/training.js` | `resolveTtsVoice()` helper + TTS API 帶入課程設定 |
| `server/routes/training.js` | Slide fetch 合併 `regions_json._intro` 前導語音 |
| `server/routes/training.js` | 翻譯流程自動 TTS + Annotation 修復 |
| `server/routes/auth.js` | 語言偵測修正（不影響訓練功能） |

### Frontend
| 檔案 | 修改 |
|------|------|
| `HotspotEditor.tsx` | 選取/繪製模式、Region CRUD、排序、抽換底圖、interaction_mode、editor_context、三模式語音面板、AI 生成+自動 TTS |
| `LanguageImagePanel.tsx` | 獨立 Region 管理 + 外語語音編輯（AI 生成+TTS） |
| `HotspotBlock.tsx` | 完全重寫：導引/探索/測驗三模式 Player + 語音時序引擎 + 靜音控制 |
| `SlideRenderer.tsx` | 透傳 `isLastSlide` + `playerMode` + `slideAudioUrl` |
| `CoursePlayer.tsx` | 學習/測驗模式切換 + `?lang=`/`?mode=` URL 參數 + hotspot 跳過 slide audio |
| `CourseEditor.tsx` | TTS 設定 UI + 翻譯預覽按鈕 + 生成外語語音按鈕 + 複製投影片 + 返回課程詳情 |
| `CourseDetail.tsx` | 📖 學習 + 📝 練習測驗 雙按鈕 |
| `SlideEditor.tsx` | AudioPanel 整合 + 自動選取第一個 Block |
| `AuthContext.tsx` | 登入時自動存 `preferred_language` |
| `i18n/index.ts` | `detectLang()` fallback 改 zh-TW |
