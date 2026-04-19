module.exports = [
  {
    id: 'u-intro',
    sort_order: 1,
    icon: 'BookOpen',
    icon_color: 'text-blue-500',
    last_modified: '2026-04-15',
    title: '系統介紹',
    sidebar_label: '系統介紹',
    blocks: [
      { type: 'para', text: 'Foxlink GPT to Cortex 是正崴精密工業內部專屬的 AI 智慧助理平台，整合 **Google Gemini**、**Azure OpenAI (AOAI)**、**Oracle OCI** 及 **Cohere** 多種語言模型，提供流暢的多語言對話、文件深度分析、多媒體處理、工具調用及自動化排程等功能，協助同仁大幅提升日常工作效率。' },
      { type: 'para', text: '平台以企業安全為前提，所有資料傳輸均在正崴內部網路環境下進行，對話記錄保存於公司伺服器，符合資訊安全及稽核要求。' },
      {
        type: 'table',
        headers: ['功能', '說明'],
        rows: [
          ['多樣語言模型', '支援 Gemini（Pro / Flash / Image）、AOAI（GPT 系列）、OCI 及 Cohere 多種模型，可依需求切換'],
          ['智慧對話', '支援繁體中文、英文及越南文，具備單次 Session 完整記憶能力'],
          ['深度研究', '自動拆解成最多 12 個子議題分別調查，可結合知識庫、技能、MCP 工具作為資料來源或輸入提示'],
          ['文件分析', '可上傳 PDF、Word、Excel、PowerPoint、圖片、程式原始碼、設定檔（YAML/JSON/Dockerfile 等）、Jupyter Notebook 等多種格式，AI 直接閱讀並分析內容'],
          ['工具調用', '可調用自建知識庫、API 連接器、MCP 工具及技能（Skill）進行問答與作業自動化'],
          ['AI 戰情室', '結合 Oracle ERP 資料庫與向量語意搜尋，用自然語言查詢生產戰情，並生成圖表 / 儀表板'],
          ['任務排程', '設定排程讓 AI 定期執行分析任務，結果自動寄送 Email 或生成下載檔案'],
          ['音訊轉文字', '上傳語音檔，系統自動轉錄為文字後送 AI 分析'],
          ['生成輸出', 'AI 可依指令生成 PDF、Excel、Word、PPT、TXT 供下載'],
          ['對話記錄', '所有對話永久保存於伺服器，可隨時查閱、搜尋歷史問答'],
        ],
      },
      { type: 'note', text: '部分進階功能（如深度研究、排程任務、知識庫建立、AI 戰情室）須由系統管理員開通對應權限後才能使用，若看不到相關入口，請洽 IT 部門申請。' },
    ],
  },

  {
    id: 'u-login',
    sort_order: 2,
    icon: 'User',
    icon_color: 'text-indigo-500',
    last_modified: '2026-04-01',
    title: '登入與登出',
    sidebar_label: '登入與登出',
    blocks: [
      {
        type: 'subsection',
        title: 'Foxlink SSO 單一登入（AD 帳號適用）',
        blocks: [
          { type: 'para', text: '持有公司 Active Directory（AD）網域帳號的同仁，可使用 **Foxlink SSO** 一鍵登入，無需另外記憶 Foxlink GPT to Cortex 密碼。' },
          {
            type: 'steps',
            items: [
              { title: '開啟瀏覽器，輸入系統網址', desc: '建議使用 Chrome 或 Edge 以獲得最佳體驗' },
              { title: '點選登入頁面的「Foxlink SSO 登入」藍色按鈕', desc: '系統自動導向公司 SSO 驗證頁面' },
              { title: '輸入您的 AD 工號與 AD 密碼完成驗證', desc: '若您已在公司內部網路環境登入 AD，可能免輸入直接通過' },
              { title: '驗證通過後自動跳回 Foxlink GPT to Cortex 主畫面' },
            ],
          },
          { type: 'note', text: '**重要：SSO 僅適用於擁有 AD 帳號的正崴員工。**由系統管理員手動建立的本地帳號（如外部合作夥伴、特殊功能帳號）無法使用 SSO，必須以帳號密碼方式登入（見下方說明）。' },
          { type: 'tip', text: 'AD 帳號登入後如需修改密碼，請透過公司 AD 系統（如 Windows 網域）更改，Foxlink GPT to Cortex 的「修改密碼」功能僅限本地帳號使用。' },
        ],
      },
      {
        type: 'subsection',
        title: '帳號密碼登入（本地帳號適用）',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '開啟瀏覽器，輸入系統網址' },
              { title: '在登入頁面輸入帳號與密碼', desc: '帳號密碼由系統管理員提供，首次使用請先洽系統管理員確認帳號已建立並啟用' },
              { title: '點選「登入」按鈕，登入成功後自動跳轉至主畫面' },
            ],
          },
          { type: 'note', text: '若帳號未啟用，系統會顯示「帳號尚未啟用」提示，請洽系統管理員確認帳號狀態。' },
        ],
      },
      {
        type: 'subsection',
        title: '忘記密碼（本地帳號適用）',
        blocks: [
          { type: 'para', text: '本地帳號若忘記密碼，可使用登入頁面的「忘記密碼」功能，系統會寄送重設密碼連結至您的帳號綁定 Email。' },
          {
            type: 'steps',
            items: [
              { title: '在登入頁面點選「忘記密碼？」連結', desc: '位於登入按鈕下方' },
              { title: '輸入您的帳號（工號），點選「發送重設信件」' },
              { title: '至您的 Email 信箱開啟重設連結', desc: '連結有效期限通常為 24 小時' },
              { title: '依指示設定新密碼後即可重新登入' },
            ],
          },
          { type: 'note', text: 'AD 帳號忘記密碼請聯絡 IT 部門透過公司 AD 系統重設，無法透過此功能處理。' },
        ],
      },
      {
        type: 'subsection',
        title: '登出系統',
        blocks: [
          { type: 'para', text: '點選左側邊欄最下方的登出圖示（向左箭頭），即可安全登出。登出後 Token 立即失效，確保帳號安全。' },
        ],
      },
    ],
  },

  {
    id: 'u-ui',
    sort_order: 3,
    icon: 'Settings',
    icon_color: 'text-slate-500',
    last_modified: '2026-04-08',
    title: '介面導覽',
    sidebar_label: '介面導覽',
    blocks: [
      { type: 'para', text: '主畫面分為兩大區域：**左側邊欄**（導航與功能入口）與**中央對話區域**（對話主體）。' },
      {
        type: 'card_grid',
        cols: 1,
        items: [
          {
            title: '左側邊欄',
            borderColor: 'slate',
            desc: '',
            items: [
              'Foxlink GPT to Cortex Logo 及品牌識別',
              '「+ 新對話」按鈕 — 建立全新對話 Session',
              'AI 模型選擇下拉選單 — 切換 AOAI / Gemini 等模型',
              '對話歷史清單（依今天、昨天、過去 7 天、更早分組）',
              '「更多功能」折疊選單 — 含匯入分享、系統管理、排程任務、技能市集、知識庫市集、AI 戰情室、文件範本、教育訓練、問題反饋、使用說明',
              '語言切換（中文 / English / Tiếng Việt）',
              '使用者資訊、修改密碼、登出圖示',
            ],
          },
          {
            title: '中央對話區域',
            borderColor: 'blue',
            desc: '',
            items: [
              '頂部工具列：對話標題、分享按鈕、停止生成按鈕',
              '頂部工具列功能開關：技能（✦）、自建知識庫（🗄️）、API 連接器（⚡）、MCP 工具（🌐）',
              '頂部工具列額度指示器：顯示日 / 週 / 月用量（有設定時才出現）',
              '頂部工具列消耗趨勢按鈕（📈）：查看個人各模型歷史費用走勢',
              '頂部工具列深度研究面板（🔭）：發起或查閱研究任務',
              '頂部工具列 AI 戰情快速入口（📊，有權限才顯示）',
              '訊息區：您的問題（右側藍色泡泡）、AI 回覆（左側白色），支援 Markdown 格式化顯示',
              '每則 AI 回覆底部：複製按鈕、Token 計數',
              '底部：訊息輸入框（支援 Shift+Enter 換行、Enter 送出）、迴紋針附件按鈕（📎）、深度研究按鈕（🔍）',
            ],
          },
        ],
      },
      { type: 'tip', text: '部分頂部工具列功能（如 AI 戰情室、排程任務）只有具備對應權限的帳號才會顯示，若有需要請洽系統管理員開通。' },
    ],
  },

  {
    id: 'u-chat',
    sort_order: 5,
    icon: 'MessageSquare',
    icon_color: 'text-green-500',
    last_modified: '2026-04-12',
    title: '開始對話',
    sidebar_label: '開始對話',
    blocks: [
      {
        type: 'subsection',
        title: '發送訊息',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '點選左上角「新對話」或直接在輸入框輸入問題' },
              { title: '在底部輸入框輸入您的問題或需求', desc: '支援多行輸入，按 Shift + Enter 換行，按 Enter 送出' },
              { title: 'AI 開始即時串流回覆', desc: '回覆過程中可點選停止按鈕中斷生成' },
            ],
          },
          { type: 'tip', text: '在同一個對話 Session 中，AI 會記住前面所有的對話內容。若想重新開始不帶上下文，請點選「新對話」。' },
        ],
      },
      {
        type: 'subsection',
        title: '重新生成',
        blocks: [
          { type: 'para', text: '滑鼠移到 AI 最後一則回覆上，點選重新整理圖示，系統會以相同問題重新生成一次回答，適合對回覆不滿意時使用。' },
        ],
      },
      {
        type: 'subsection',
        title: '貼上圖片',
        blocks: [
          { type: 'para', text: '在輸入框中直接按 Ctrl + V 可貼上剪貼簿中的圖片，或將圖片檔案拖曳至頁面任何位置上傳。' },
        ],
      },
      {
        type: 'subsection',
        title: '生成圖片（重要）',
        blocks: [
          { type: 'note', text: '**要讓 AI 生成圖片，必須先在左側邊欄的模型下拉選單中切換為「Image 類型」模型**（例如 Gemini Image 或其他支援圖片輸出的模型）。使用一般 Pro / Flash / GPT 模型時，AI 無法生成圖片，只能描述圖片。' },
          { type: 'para', text: '系統支援 Gemini 圖片生成模型，可依文字描述直接生成圖片，也可以上傳現有圖片後請 AI 進行修改、風格轉換、局部調整等作業。' },
          { type: 'note', text: '圖片生成功能需選擇支援圖片輸出的模型（如 Gemini Image 模型），請確認左側模型選單中有此選項，否則請洽管理員開啟。' },
        ],
      },
      {
        type: 'subsection',
        title: '文字生圖',
        blocks: [
          { type: 'para', text: '直接在對話框輸入您想要的圖片描述，AI 會依照說明生成圖片：' },
          {
            type: 'list',
            items: [
              '幫我生成一張台灣風格的科技辦公室插圖，藍色調，現代感，適合用於簡報封面。',
              '生成一個正崴精密工廠生產線的示意圖，寫實風格，畫面乾淨，橫向構圖。',
            ],
          },
          { type: 'tip', text: '描述越具體效果越好，可以說明風格（寫實/插畫/3D）、色調、構圖方向、使用場景。中文英文描述均可。' },
        ],
      },
      {
        type: 'subsection',
        title: '修圖：對現有圖片進行 AI 編輯',
        blocks: [
          { type: 'para', text: '上傳您的圖片，再用文字告訴 AI 要怎麼修改：' },
          {
            type: 'list',
            items: [
              '**更換背景** — 請將這張產品圖的背景換成純白色',
              '**風格轉換** — 將這張照片轉換為水彩畫風格',
              '**局部修改** — 將圖中的文字改為英文版本',
              '**補充元素** — 在圖片右下角加入 FOXLINK 公司 Logo 的位置提示',
              '**調整色調** — 將整張圖調整為偏冷藍色的科技感配色',
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '多輪對話修圖',
        blocks: [
          { type: 'para', text: '在同一個 Session 中可以連續對圖片進行多次修改，AI 會記住上一輪的圖片狀態，您只需要說「再把左側的人物移除」、「顏色再深一點」即可持續調整。' },
          {
            type: 'steps',
            items: [
              { title: '上傳原始圖片，並說明第一步修改', desc: '例：幫我去除圖片中的浮水印' },
              { title: 'AI 生成修改後的圖片', desc: '檢視結果是否符合需求' },
              { title: '繼續下一步修改', desc: '例：好，再把背景改為漸層藍' },
              { title: '滿意後下載圖片', desc: '點選圖片右鍵儲存，或點選下載連結' },
            ],
          },
          { type: 'tip', text: '若對修改結果不滿意，可點選「重新生成」按鈕，AI 會以同樣指令重新嘗試，每次結果略有差異。' },
        ],
      },
      {
        type: 'subsection',
        title: '圖片生成注意事項',
        blocks: [
          {
            type: 'list',
            items: [
              '生成圖片每次會消耗較多 Token，請注意使用量',
              '不可生成涉及真實人物肖像、政治敏感、色情暴力等內容',
              '生成的圖片版權建議用於內部使用，商業用途請確認授權規範',
              '圖片生成時間約 10-30 秒，請耐心等待，不要重複送出',
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '複製 AI 回覆',
        blocks: [
          { type: 'para', text: '滑鼠移到任意一則 AI 回覆上，左下角會出現複製圖示。點選後整則回覆文字（含格式）複製至剪貼簿，可直接貼入 Word 等應用程式。' },
        ],
      },
      {
        type: 'subsection',
        title: '下載生成檔案',
        blocks: [
          { type: 'para', text: '當您要求 AI 輸出特定格式的檔案（如請幫我匯出 Excel），AI 回覆結束後會自動顯示下載連結。點選連結即可下載，檔案保存於伺服器，可隨時回到歷史對話重新下載。' },
          { type: 'tip', text: '生成檔案的指令範例：「請將以上資料整理成 Excel 表格並輸出」、「將報告轉為 PDF 格式」。' },
        ],
      },
    ],
  },

  {
    id: 'u-model',
    sort_order: 6,
    icon: 'Cpu',
    icon_color: 'text-purple-500',
    last_modified: '2026-04-08',
    title: '選擇 AI 模型',
    sidebar_label: '選擇 AI 模型',
    blocks: [
      { type: 'para', text: '系統支援 **Google Gemini**、**Azure OpenAI（AOAI）**、**Oracle OCI** 及 **Cohere** 多平台模型，由左側邊欄的模型下拉選單切換。不同模型在能力、速度、費用上各有差異，請依需求選擇。' },
      {
        type: 'card_grid',
        cols: 2,
        items: [
          {
            emoji: '',
            title: 'Gemini Pro',
            tag: { color: 'blue', text: '高精度' },
            desc: '• 高精度、深度思考能力\n• 適合複雜分析、報告撰寫\n• 長文件處理、多步驟推理\n• 回覆速度相對較慢',
            borderColor: 'blue',
          },
          {
            emoji: '',
            title: 'Gemini Flash',
            tag: { color: 'orange', text: '快速' },
            desc: '• 回覆速度極快\n• 適合簡短問答、快速翻譯\n• 音訊轉錄使用此模型\n• Token 成本較低',
            borderColor: 'yellow',
          },
          {
            emoji: '',
            title: 'Gemini Image',
            tag: { color: 'purple', text: '圖片生成' },
            desc: '• **唯一支援生成圖片的模型**\n• 文字生圖、上傳圖修圖、風格轉換\n• 多輪對話連續調整圖片\n• 若需生成圖片，必須切換至此模型',
            borderColor: 'violet',
          },
          {
            emoji: '',
            title: 'AOAI GPT 5.4',
            tag: { color: 'green', text: '目前最新' },
            desc: '• **目前已支援 AOAI GPT 5.4 模型**\n• 長文脈絡理解能力強\n• 適合需要 OpenAI 相容 API 的場景\n• 後續將陸續新增更多 AOAI 模型',
            borderColor: 'green',
          },
        ],
      },
      { type: 'para', text: '部分 AOAI 模型（如 GPT 5.x / o 系列）支援**推理力度**調整（Low / Medium / High），可在模型選擇後看到力度選項，適合需要更深入推理的複雜任務。' },
      { type: 'note', text: '**模型清單由系統管理員統一維護，**實際可用模型以畫面下拉選單為準。除上述模型外，系統也支援 OCI 和 Cohere 平台的模型。模型選擇會保存在您的瀏覽器，下次開啟仍會維持上次的選擇；切換模型不會影響當前對話歷史記錄。' },
      { type: 'tip', text: '若模型下拉選單中看不到 Image 類型模型，表示管理員尚未開放此功能，請洽 IT 部門申請。' },
    ],
  },

  {
    id: 'u-upload',
    sort_order: 7,
    icon: 'Upload',
    icon_color: 'text-teal-500',
    last_modified: '2026-04-15',
    title: '上傳檔案',
    sidebar_label: '上傳檔案',
    blocks: [
      {
        type: 'subsection',
        title: '支援格式',
        blocks: [
          {
            type: 'table',
            headers: ['類型', '支援格式', '說明'],
            rows: [
              ['文件', 'PDF、DOCX、XLSX、PPTX、TXT、CSV、TSV、MD、RST、TEX', 'AI 直接讀取文件內容進行分析'],
              ['圖片', 'JPG、PNG、GIF、WEBP、BMP、TIFF、HEIC、AVIF、ICO', 'AI 可辨識圖片中的文字與內容'],
              ['音訊', 'MP3、WAV、M4A、OGG、FLAC、WEBM、MP4、AAC、OPUS、WMA', '自動轉錄為文字後送 AI 分析'],
              ['程式原始碼', 'PY、JS、TS、JSX、TSX、JAVA、KT、C、H、CPP、HPP、CS、GO、RS、PHP、RB、SWIFT、DART、LUA、PL、R、SQL、SH、BASH、PS1、BAT、HTML、CSS、SCSS、VUE、SVELTE、XML、SVG、GRAPHQL 等 100+ 種', 'AI 以 UTF-8 讀取原始碼進行審查、除錯、改寫、翻譯'],
              ['設定檔', 'YML、YAML、TOML、JSON、JSONC、INI、CONF、CFG、PROPERTIES、ENV、LOCK、PROTO 等', 'AI 解讀並協助修改設定'],
              ['Log / Diff', 'LOG、OUT、DIFF、PATCH', '協助分析錯誤 log、Code Review diff'],
              ['Jupyter Notebook', 'IPYNB', '僅讀取 cell 原始碼，自動跳過輸出的 base64 圖片/大型輸出'],
              ['無副檔名特殊檔', 'Dockerfile、Makefile、Jenkinsfile、Gemfile、Pipfile、Vagrantfile、Caddyfile、Brewfile、BUILD、WORKSPACE、.gitignore、.env.local、.eslintrc 等', '常見的 build／dev config，可直接上傳'],
            ],
          },
          { type: 'note', text: '**禁止上傳**：影片檔（.mp4/.avi/.mov 等）、執行檔（.exe/.dll/.so/.msi/.dmg/.apk/.ipa 等）、私鑰憑證（.pem/.key/.p12/.pfx/.keystore/.jks）、壓縮檔（.zip/.rar/.7z/.tar/.gz/.bz2/.xz）。若需分享壓縮內容，請先解壓後再上傳個別檔案。' },
          { type: 'tip', text: '上傳 `.env`、`.env.local`、`.env.production` 等環境變數檔時，系統會跳出確認視窗提醒您確認檔案不含 API key／密碼／連線字串等機敏資訊，再送出 AI 分析。' },
        ],
      },
      {
        type: 'subsection',
        title: '大小限制',
        blocks: [
          {
            type: 'table',
            headers: ['類型', '單檔上限', '備註'],
            rows: [
              ['文件（PDF/Word/Excel/PPTX/TXT/CSV 等）', '依管理員設定（預設約 10MB）', '可請管理員提高上限'],
              ['圖片', '依管理員設定（預設約 10MB）', ''],
              ['音訊', '依管理員設定（預設約 50MB）', '需管理員授權音訊上傳'],
              ['程式碼／設定／Log／Jupyter', '**最多 5MB**（hard limit）', '避免塞爆 AI context；超過請先裁切'],
            ],
          },
          { type: 'note', text: '上傳 >500KB 的程式碼／設定／log 檔時前端會顯示提示「將增加 token 用量」，不擋上傳但提醒您可先裁切重點段落。單一訊息最多可附加 10 個檔案（管理員可調整 CHAT_MAX_FILES_PER_MESSAGE）。' },
        ],
      },
      {
        type: 'subsection',
        title: '上傳方式',
        blocks: [
          {
            type: 'list',
            items: [
              '**點選迴紋針圖示** — 輸入框右側的迴紋針按鈕，點選後選擇本機檔案，可同時選取多個檔案',
              '**拖曳上傳** — 直接將檔案拖曳到頁面任何位置，頁面出現藍色框時放開即可',
              '**貼上圖片** — 複製圖片後在輸入框按 Ctrl + V',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'u-voice-input',
    sort_order: 7.5,
    icon: 'Mic',
    icon_color: 'text-blue-500',
    last_modified: '2026-04-10',
    title: '語音輸入（麥克風轉文字）',
    sidebar_label: '語音輸入',
    blocks: [
      { type: 'para', text: '系統提供**兩種**語音轉文字方式，可將您講的話即時轉成文字插入到輸入框游標位置，省去打字：' },
      {
        type: 'list',
        items: [
          '**麥克風按鈕** — 出現在 AI 對話框、問題反饋的描述/留言區、快速開單浮動按鈕等主要輸入點。看到🎤圖示就可以點。',
          '**`Alt + M` 全域快捷鍵** — 任何頁面、任何輸入框都能用！包含教育訓練教材編輯器、課程描述、答案解析、學員筆記、結案說明、滿意度意見等所有打字的地方。',
        ],
      },
      { type: 'tip', text: '快捷鍵 Alt+M 是專為「打字很多」的場景設計，例如教材開發者、客服處理工單回覆。一個熱鍵走遍全站，不用記每個欄位有沒有麥克風按鈕。' },

      {
        type: 'subsection',
        title: '方式一：點麥克風按鈕',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '點選輸入框旁的麥克風圖示', desc: '首次使用瀏覽器會跳出權限請求，請點選「允許」' },
              { title: '對著麥克風說話', desc: '按鈕變紅色閃爍代表正在錄音，旁邊會顯示音量條與剩餘秒數' },
              { title: '停止錄音的方式（任選其一）', desc: '再點一次麥克風按鈕 / 按 Esc 鍵 / 等待倒數歸零自動停止' },
              { title: '系統處理後將辨識結果插入到游標位置', desc: '不會覆蓋既有文字，可繼續手動編輯' },
            ],
          },
          { type: 'tip', text: '錄音時若同頁有多個麥克風按鈕，**只能同時錄一個**。切到別的輸入框點麥克風會自動停掉前一個。' },
        ],
      },

      {
        type: 'subsection',
        title: '方式二：Alt + M 全域快捷鍵',
        blocks: [
          { type: 'para', text: '**最快速的方式**：打字打到一半想用講的時，直接按 `Alt + M`，無論在哪個頁面、哪個輸入框都能用。' },
          {
            type: 'steps',
            items: [
              { title: '滑鼠先點進任何 textarea 或 input 輸入框', desc: '先讓游標進入要輸入的位置（例如教材編輯器的「答案解析」欄位）' },
              { title: '按下 Alt + M', desc: '畫面右下角會浮出小錄音 UI（紅色麥克風 + 音量條 + 倒數秒數）' },
              { title: '對著麥克風說話', desc: '單次最長 180 秒，講多久都行' },
              { title: '停止錄音（任選其一）', desc: '再按一次 Alt + M / 按 Esc / 點 UI 上的 X / 倒數歸零自動停止' },
              { title: '辨識結果自動插入到原本的游標位置', desc: '不會覆蓋既有文字，可繼續打字或再用 Alt+M 接續講' },
            ],
          },
          { type: 'note', text: '快捷鍵會作用在**目前焦點所在**的輸入框。如果按 Alt+M 時沒有任何輸入框被選中，系統會提示「請先點到輸入框」。' },
          { type: 'tip', text: '教育訓練教材開發者推薦使用 Alt+M：投影片標題、答案解析、步驟說明、翻卡內容、提示框文字… 這些欄位都能用講的，比打字快 3-5 倍。' },
        ],
      },

      {
        type: 'subsection',
        title: '兩種方式的差異',
        blocks: [
          {
            type: 'table',
            headers: ['項目', '麥克風按鈕', 'Alt + M 快捷鍵'],
            rows: [
              ['可用範圍', '只在主要輸入點（chat、feedback 等）', '全站任何 textarea / input'],
              ['錄音上限', 'Chat 60 秒 / Feedback 180 秒', '統一 180 秒'],
              ['操作方式', '點按鈕', '鍵盤快捷鍵'],
              ['UI 位置', '輸入框旁邊', '畫面右下角浮動 UI'],
              ['適合對象', '新手、casual 使用', '進階使用者、教材開發者'],
            ],
          },
        ],
      },

      {
        type: 'subsection',
        title: '即時辨識預覽（Chrome / Edge）',
        blocks: [
          { type: 'para', text: '使用 Chrome 或 Edge 瀏覽器時，系統會啟動**即時辨識**：邊講邊出字，文字即時顯示在輸入框下方的藍色預覽條，方便您一邊講一邊確認 AI 是否聽對。' },
          { type: 'note', text: '即時辨識功能依賴 Google 語音服務。如果公司網路無法連線該服務，系統會自動切換到「後端轉錄」模式（說完後集中辨識），體驗略有延遲但結果一樣準確。' },
        ],
      },

      {
        type: 'subsection',
        title: '支援的語言',
        blocks: [
          { type: 'para', text: '系統會依您介面語系自動選擇辨識語言：' },
          {
            type: 'table',
            headers: ['介面語系', '辨識語言', '建議'],
            rows: [
              ['繁體中文 (zh-TW)', '繁體中文', '可混用少量英文單字、專有名詞'],
              ['English', '英文', '清晰發音準確度最佳'],
              ['Tiếng Việt', '越南文', '建議標準發音'],
            ],
          },
          { type: 'tip', text: '若您要錄不同語言的內容，請先到右上角切換介面語系再錄音。' },
        ],
      },

      {
        type: 'subsection',
        title: '使用注意事項',
        blocks: [
          {
            type: 'list',
            items: [
              '**必須允許麥克風權限** — 第一次使用會跳出權限提示，若不小心拒絕，請到瀏覽器網址列左側的鎖頭圖示重新開啟麥克風權限',
              '**建議在安靜環境** — 背景噪音越低辨識率越高',
              '**錄音上限** — 麥克風按鈕：Chat 60 秒 / Feedback 180 秒；Alt+M 快捷鍵：統一 180 秒',
              '**插入位置** — 結果會插入到游標所在位置，可在錄音前先把游標移到想要的地方',
              '**錄音時切換頁面** — 離開頁面或重新整理會自動停止錄音並丟棄結果',
              '**Alt+M 不能用？** — 確認您**有先點到輸入框**讓游標進入；若仍無反應請洽 IT 部門檢查瀏覽器是否被擴充功能攔截快捷鍵',
            ],
          },
        ],
      },

      {
        type: 'subsection',
        title: '常見問題',
        blocks: [
          {
            type: 'table',
            headers: ['問題', '原因 / 解法'],
            rows: [
              ['麥克風按鈕變灰色點不動', '麥克風權限被拒絕。請到瀏覽器網址列左側鎖頭圖示重新開啟權限後重新整理頁面。'],
              ['看不到麥克風按鈕', '可能是系統管理員關閉了語音輸入功能。請洽 IT 部門。'],
              ['辨識結果是空的', '可能音量太小、麥克風硬體有問題、或環境噪音過大。請檢查作業系統的麥克風裝置音量設定。'],
              ['辨識文字錯誤率高', '請確認介面語系跟說的語言一致；說話時語速放慢、咬字清晰；遠離噪音來源。'],
              ['出現「辨識失敗」訊息', '可能是 AI 服務暫時中斷或網路問題。等待數秒後重試；若持續失敗請洽系統管理員。'],
              ['錄音中聽不到即時辨識文字', '您可能用 Safari 或內網環境（無法連 Google 語音服務），系統會走「後端轉錄」模式 — 需等錄音停止後才會出現完整辨識結果，這是正常行為。'],
              ['Alt + M 按了沒反應', '請先用滑鼠點到一個 textarea 或 input 輸入框（讓游標進入），再按 Alt + M。系統需要知道要把辨識結果插到哪裡。'],
              ['Alt + M 跳出「請先點到輸入框」', '同上 — 您按快捷鍵時，焦點不在任何可編輯的輸入框上。'],
            ],
          },
        ],
      },

      { type: 'note', text: '語音檔不會永久保存，轉錄完成後立即從伺服器刪除。轉錄使用的 token 數會記錄到您個人的用量統計（model 標記為 `gemini-flash-stt`）。' },
    ],
  },

  {
    id: 'u-history',
    sort_order: 8,
    icon: 'History',
    icon_color: 'text-orange-500',
    last_modified: '2026-04-01',
    title: '對話歷史',
    sidebar_label: '對話歷史',
    blocks: [
      { type: 'para', text: '所有對話均永久保存於伺服器端，與瀏覽器無關。左側邊欄依時間分組顯示歷史對話（今天、昨天、過去 7 天、更早）。' },
      {
        type: 'subsection',
        title: '查看歷史',
        blocks: [
          { type: 'para', text: '點選左側邊欄任意一條對話標題，即可重新開啟該對話並查看完整的問答記錄。' },
        ],
      },
      {
        type: 'subsection',
        title: '重新命名對話',
        blocks: [
          { type: 'para', text: '系統預設以 AI 自動生成的摘要作為對話標題，您可以隨時將其改為更易辨識的名稱：' },
          {
            type: 'steps',
            items: [
              { title: '滑鼠移到左側邊欄的對話標題上', desc: '右側出現鉛筆圖示（✏）' },
              { title: '點選鉛筆圖示，標題變為可編輯輸入框' },
              { title: '輸入新名稱，按 Enter 確認，或按 Esc 取消', desc: '也可點選輸入框旁的確認勾選圖示（✓）儲存' },
            ],
          },
          { type: 'tip', text: '系統支援多語言標題，修改時 AI 會同步翻譯成英文及越南文，方便切換語系後也能看到對應語言的標題。' },
        ],
      },
      {
        type: 'subsection',
        title: '刪除對話',
        blocks: [
          { type: 'para', text: '滑鼠移到對話標題上，右側會出現垃圾桶圖示，點選即可刪除該對話。刪除後無法復原，請謹慎操作。' },
          { type: 'note', text: '刪除僅影響您的對話列表視覺顯示，系統管理員的稽核日誌中仍會保留此對話記錄。' },
        ],
      },
    ],
  },

  {
    id: 'u-tools',
    sort_order: 13,
    icon: 'Terminal',
    icon_color: 'text-cyan-500',
    last_modified: '2026-04-02',
    title: '可用工具',
    sidebar_label: '可用工具',
    blocks: [
      { type: 'para', text: 'Foxlink GPT to Cortex 支援多種工具擴展能力，讓 AI 在對話中自動取用企業內部資料、知識庫及技能。您可以透過對話頂部工具列的各功能開關，明確指定要使用哪些工具；也可以讓系統根據訊息內容自動判斷（TAG 路由機制）。' },
      {
        type: 'subsection',
        title: '工具類型說明',
        blocks: [
          {
            type: 'card_grid',
            cols: 2,
            items: [
              {
                emoji: '🔌',
                title: 'MCP 工具',
                tag: { color: 'blue', text: '即時外部查詢' },
                desc: '連接外部系統的即時查詢工具，例如 ERP 資料庫查詢、Oracle 程式搜尋等。AI 在判斷需要時自動呼叫，無需手動觸發。',
                borderColor: 'cyan',
              },
              {
                emoji: '📚',
                title: 'API 連接器',
                tag: { color: 'orange', text: '企業文件庫' },
                desc: '由 API 連接器管理的企業內部文件知識庫，例如產品規格、SOP 手冊。對話時自動查詢，找到相關段落則注入給 AI 作為回答依據。',
                borderColor: 'yellow',
              },
              {
                emoji: '🗄️',
                title: '自建知識庫',
                tag: { color: 'green', text: '向量語意搜尋' },
                desc: '由您或同事在「知識庫市集」中建立並上傳文件的向量化知識庫。支援 PDF、Word、Excel、PPTX 等格式，語意搜尋精度高。可在對話頂部的「知識庫」按鈕中選擇要掛載哪幾個知識庫。',
                borderColor: 'teal',
              },
              {
                emoji: '✨',
                title: '技能（Skill）',
                tag: { color: 'purple', text: '角色與自動化' },
                desc: '掛載技能後，AI 會自動套用對應的 System Prompt、外部 API 或工作流程。例如「翻譯技能」讓 AI 固定以指定語言回覆，「ERP 查詢技能」自動整合資料庫資料。可在技能市集瀏覽並掛載到對話。',
                borderColor: 'purple',
              },
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '如何選擇要使用的工具',
        blocks: [
          { type: 'para', text: '對話頂部工具列提供四個開關，可明確控制每類工具的啟用狀態：' },
          {
            type: 'table',
            headers: ['開關', '說明', '啟用（亮色）', '停用（灰色）'],
            rows: [
              ['✦ 技能', '頂部紫色 Badge 圖示', '自動套用掛載的技能', '跳過技能注入'],
              ['🗄️ 知識庫', '資料庫圖示', '從已掛載的自建知識庫檢索', '不做向量檢索'],
              ['⚡ API', '閃電圖示', '從已掛載的 API 連接器查詢', '跳過 API 查詢'],
              ['🌐 MCP', '地球圖示', '允許 AI 呼叫 MCP 伺服器工具', '停用所有 MCP 呼叫'],
            ],
          },
          { type: 'para', text: '此外，您也可以點選各開關圖示旁的下拉箭頭，**明確指定**要使用哪幾個知識庫 / MCP 伺服器 / API 連接器，而非讓系統自動選擇全部。' },
        ],
      },
      {
        type: 'subsection',
        title: '兩種工具啟用模式',
        blocks: [
          {
            type: 'comparison',
            items: [
              {
                title: '模式 A：明確指定（Explicit）',
                desc: '在工具列下拉選單**具體勾選**特定知識庫 / MCP 伺服器時啟用。\n系統**直接使用所選工具，跳過所有自動路由與 intent 判斷**，效率最高。',
                example: '例：勾選「自建 KB 工具列」→ 選「HR 制度知識庫」',
                borderColor: 'blue',
              },
              {
                title: '模式 B：自動路由（Auto）',
                desc: '工具列**開關開啟但未具體選擇**，或**全部關閉**時啟用。\n系統依訊息內容智慧決定要呼叫哪些工具（TAG 路由機制，見下方）。',
                example: '例：知識庫開關開啟 → 未勾選具體 KB → 系統自動比對',
                borderColor: 'slate',
              },
            ],
          },
          { type: 'note', text: '空陣列（全部取消勾選）等同「未選」，系統會切換回自動路由，不會跳過工具。' },
        ],
      },
      {
        type: 'subsection',
        title: '自動路由完整流程（Auto 模式）',
        blocks: [
          { type: 'para', text: '每次送出訊息時，系統依以下步驟決定傳哪些工具給 AI：' },
          {
            type: 'steps',
            items: [
              { title: '依存取權限載入可用工具', desc: 'MCP 依 mcp_access 授權、API 連接器依 api_access 授權、自建 KB 依 creator/公開/kb_access 授權 — 只載入您有權使用的工具' },
              { title: '套用技能（Skill）約束', desc: '若 session 有掛載技能，技能可強制限制工具清單（見下方「技能對工具的影響」）' },
              { title: 'TAG 自動路由（有任何工具設定 Tags 時）', desc: 'Flash LLM 提取訊息意圖標籤 → 與工具 Tags 比對 → 再以 LLM 依描述精篩' },
              { title: 'Fallback（所有工具均無 Tags 時）', desc: 'Flash LLM 直接閱讀全部工具的描述文字做分類，效率較低、準確性較差' },
              { title: 'Gemini Function Calling 最終決策', desc: '篩選後的工具以 function declarations 傳給 LLM，由 AI 根據對話上下文決定實際要呼叫哪個' },
            ],
          },
          {
            type: 'code',
            text: '使用者訊息\n    │\n    ▼\n[Step 1] 依授權載入可用工具（MCP / API 連接器 / 自建 KB）\n    │\n    ▼\n[Step 2] 技能約束（disable / exclusive / append）\n    │\n    ├─ 有任何工具設定了 Tags？\n    │        ▼ YES\n    │  [Step 3a] Flash 提取意圖標籤（0~5 個）\n    │        ▼\n    │  TAG 比對（雙向模糊）\n    │        ▼\n    │  有匹配候選 → Flash 描述精篩 → 選中工具\n    │  無匹配候選 → Flash 對全部工具描述分類\n    │\n    └─ NO（全部無 Tags）\n       [Step 4] Flash 對全部工具描述分類（Fallback）\n    │\n    ▼\n[Step 5] 送給 Gemini → LLM 決定呼叫哪個工具\n    │\n    ▼\n執行工具 → 結果注入 prompt → AI 回覆',
          },
        ],
      },
      {
        type: 'subsection',
        title: 'TAG 路由的判斷規則',
        blocks: [
          { type: 'para', text: '系統使用 Gemini Flash 作為「意圖分類器」（不是回答問題），進行兩個階段的判斷：' },
          {
            type: 'list',
            items: [
              '**第一階段：TAG 比對（雙向模糊）** — Flash 從訊息中提取 0~5 個主題標籤（如 `「人資」「請假」「HR」`），再與工具 Tags 做雙向部分比對：\n✓ `「人資」` 比對工具 Tag `「HR人資管理」` → 命中\n✗ `「庫存」` 比對工具 Tag `「人資」` → 不命中',
              '**第二階段：描述精篩（Flash 判斷）** — 對 TAG 比對命中的候選工具，Flash 再讀工具的「說明描述」做更嚴格的判斷，規則：\n• 核心意圖必須**完全符合**工具說明範疇才選用\n• 跟進前一輪 AI 問題的回覆，會參考最近 4 則對話上下文繼續使用同工具\n• 一般聊天、寫作、摘要等不需工具的問題 → 一律不選任何工具\n• 不確定時，不選用（寧可不呼叫，避免雜訊）',
            ],
          },
          {
            type: 'comparison',
            items: [
              {
                title: '✅ 有 Tags → 精準高效',
                desc: '先縮小候選範圍再精篩，LLM 只需判斷少量工具，準確性高、消耗 Token 少。',
                borderColor: 'green',
              },
              {
                title: '⚠️ 無 Tags → Fallback 效果較差',
                desc: 'Flash 需要閱讀全部工具描述做分類，工具數量多時效果下降，也多消耗 Token。建議管理員為每個工具設定 Tags。',
                borderColor: 'orange',
              },
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '技能（Skill）對工具的影響',
        blocks: [
          { type: 'para', text: '掛載技能後，技能可以約束 Auto 模式下的工具範圍。技能設定分三種模式：' },
          {
            type: 'table',
            headers: ['模式', 'MCP 工具行為', 'KB 工具行為'],
            rows: [
              ['disable', '移除全部 MCP 工具，AI 無法呼叫任何 MCP', '移除全部 API 連接器 + 自建 KB，不做知識庫查詢'],
              ['exclusive（排他）', '只保留技能指定的 MCP 伺服器，其他全移除', '只保留技能指定的 KB，其他全移除'],
              ['append（附加）', '在使用者有存取權的 MCP 之外，強制額外加入技能指定的伺服器', '強制加入技能指定的 KB（即使使用者原本沒有存取權）'],
            ],
          },
          { type: 'note', text: 'Code 技能（程式執行工具）永遠附加到工具清單，不受以上模式影響。\n明確指定模式（Explicit）下，disable 規則仍然生效作為安全防護。' },
        ],
      },
      {
        type: 'subsection',
        title: '特殊快速路徑（Fast Path）',
        blocks: [
          { type: 'para', text: '以下情況系統會走優化路徑，跳過 Gemini Function Calling，提升回應速度：' },
          {
            type: 'table',
            headers: ['條件', '行為', '優點'],
            rows: [
              ['只選中 API 連接器（無 MCP）', '並行查詢全部選中的 API 連接器 → 結果直接注入 prompt → AI 整合回覆', '省略 function calling 往返，速度更快'],
              ['只選中自建 KB（無 MCP）', '並行向量檢索全部選中的自建 KB → 結果注入 prompt', '同上'],
              ['混合模式（MCP + KB）', '走 Gemini 原生 function calling，AI 自行決定呼叫哪些工具、呼叫幾次', '靈活性高，可多輪工具調用'],
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '情境對照表',
        blocks: [
          {
            type: 'table',
            headers: ['您的操作', '系統行為', '工具覆蓋範圍'],
            rows: [
              ['全部開關關閉', 'Auto 模式：TAG 路由對全部可用工具', '依授權範圍內所有工具'],
              ['開關開啟，未具體勾選', 'Auto 模式：TAG 路由（只看開啟的類別）', '該類別的授權工具'],
              ['下拉勾選具體工具', 'Explicit 模式：直接使用選中工具', '只有您勾選的那幾個'],
              ['掛載技能（disable）', 'Auto 模式，但 Skill disable 先移除對應類別', '受技能限制'],
              ['掛載技能（exclusive）', 'Auto 模式，但只保留技能指定工具', '技能指定的工具'],
            ],
          },
          { type: 'tip', text: '最精確的方式：下拉選單明確勾選目標工具 + 關閉不需要的類別開關。最省力的方式：所有工具設定好 Tags，讓系統 TAG 路由自動判斷。' },
        ],
      },
      {
        type: 'subsection',
        title: '使用範例',
        blocks: [
          {
            type: 'list',
            items: [
              '**MCP 工具（ERP 查詢）**\n• 「搜尋 WIP 相關的 Oracle 程式有哪些？」\n• 「FL_MOA_B2_WIP_DETAIL_P 這支程式是誰寫的？」\n• 「查 WIP_DISCRETE_JOBS 這張資料表被哪些程式使用？」',
              '**自建知識庫 / API 連接器（文件查詢）**\n• 「FL-X100 連接器的最大電流規格是多少？」\n• 「查詢產品 BOM 結構中 PN12345 的規格」\n• 「生產 SOP 中關於焊接溫度的規定是什麼？」',
            ],
          },
          { type: 'tip', text: '若沒有看到工具相關選項，表示管理員尚未設定或開放相關功能，可洽 IT 部門申請。' },
        ],
      },
    ],
  },

  {
    id: 'u-schedule',
    sort_order: 25,
    icon: 'Clock',
    icon_color: 'text-green-500',
    last_modified: '2026-04-01',
    title: '自動排程功能',
    sidebar_label: '自動排程功能',
    blocks: [
      { type: 'para', text: '排程任務可讓系統在指定時間自動執行 AI 分析，並將結果以 Email 寄送給您，或生成 PDF、Excel 等檔案供下載。適合每日新聞摘要、匯率通知、定期報表等重複性需求，完全不需要人工操作。' },
      { type: 'note', text: '排程任務功能需由系統管理員開啟權限後才能使用。若左側邊欄看不到「排程任務」按鈕，請洽管理員申請。' },
      {
        type: 'subsection',
        title: '建立我的第一個排程',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '點選左側邊欄「排程任務」', desc: '進入排程任務管理頁面' },
              { title: '點選「新增任務」按鈕' },
              { title: '填寫任務名稱與執行時間', desc: '選擇每日、每週或每月，並設定幾點幾分執行' },
              { title: '撰寫 AI Prompt（問題內容）', desc: '告訴 AI 要做什麼，可以加入特殊語法讓 AI 抓取即時資料' },
              { title: '填入 Email 收件地址', desc: 'AI 完成後自動寄報告給您' },
              { title: '儲存並啟用', desc: '狀態設為「執行中」即完成' },
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: 'Prompt 中的自動變數',
        blocks: [
          { type: 'para', text: '在 Prompt 裡可以使用以下變數，系統執行時會自動帶入當天的實際值：' },
          {
            type: 'table',
            headers: ['寫法', '執行時替換為', '範例'],
            rows: [
              ['{{date}}', '執行當天日期', '2026-03-01'],
              ['{{weekday}}', '執行當天星期幾', '星期六'],
              ['{{task_name}}', '您設定的任務名稱', '台股日報'],
            ],
          },
          {
            type: 'code',
            text: 'Prompt 範例\n\n今天是 {{date}}（{{weekday}}），\n請為「{{task_name}}」撰寫今日工作提醒摘要。',
          },
        ],
      },
      {
        type: 'subsection',
        title: '抓取即時網路資料',
        blocks: [
          { type: 'para', text: '排程 Prompt 支援兩種方式讓 AI 自動抓取最新資料，不需要您手動複製貼上：' },
          {
            type: 'list',
            items: [
              '**抓取 API 或 RSS Feed** [fetch] — 適合新聞 API、RSS 訂閱、政府開放資料等直接回傳 JSON/XML 的網址\n`{{fetch:https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=10}}`',
              '**抓取一般網頁** [scrape] — 適合一般新聞文章、銀行匯率頁、供應商官網公告等 HTML 網頁\n`{{scrape:https://rate.bot.com.tw/xrt?Lang=zh-TW}}`',
            ],
          },
          { type: 'tip', text: '同一個 Prompt 可以同時使用多個 fetch 和 scrape，AI 會將所有資料一起分析。' },
        ],
      },
      {
        type: 'subsection',
        title: '讓 AI 生成可下載的檔案',
        blocks: [
          { type: 'para', text: '在 Prompt 末尾指示 AI 將報告輸出為特定格式，系統會自動生成檔案並附在 Email 中：' },
          {
            type: 'table',
            headers: ['檔案格式', '寫法範例'],
            rows: [
              ['PDF 報告', 'generate_pdf:報告名稱_{{date}}.pdf'],
              ['Excel 表格', 'generate_xlsx:報告名稱_{{date}}.xlsx'],
              ['Word 文件', 'generate_docx:報告名稱_{{date}}.docx'],
              ['PowerPoint', 'generate_pptx:報告名稱_{{date}}.pptx'],
              ['純文字', 'generate_txt:報告名稱_{{date}}.txt'],
            ],
          },
          { type: 'note', text: '以上語法須以三個反引號（```）包覆，置於 Prompt 最後，再附上報告內容說明。詳細格式請參閱系統管理員版說明書。' },
        ],
      },
      {
        type: 'subsection',
        title: '在 Prompt 中直接引用工具（技能 / 知識庫）',
        blocks: [
          { type: 'para', text: '撰寫排程 Prompt 時，可以直接在文字中引用已建立的技能（Skill）和知識庫（KB），系統執行時會自動呼叫對應的工具並將結果注入給 AI 分析。' },
          {
            type: 'table',
            headers: ['語法', '說明', '範例'],
            rows: [
              ['{{skill:技能名稱}}', '執行指定技能，將技能回傳結果注入對話背景', '{{skill:匯率查詢}}'],
              ['{{kb:知識庫名稱}}', '從指定知識庫查詢與 Prompt 相關的段落，注入背景', '{{kb:產品規格庫}}'],
            ],
          },
          {
            type: 'code',
            text: 'Prompt 引用工具範例\n\n今天是 {{date}}（{{weekday}}），\n請根據以下最新匯率資料 {{skill:匯率查詢}}\n以及生產 SOP 規定 {{kb:製程標準庫}}\n整理本日需注意事項並以繁體中文條列輸出。',
          },
          { type: 'tip', text: '撰寫 Prompt 時，輸入 `{{skill:` 或 `{{kb:` 後，系統會自動彈出技能 / 知識庫名稱選單供快速選取，也可用斜線 `/` 觸發同樣的選單。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Pipeline 管線：串接多步驟工作流程',
        blocks: [
          { type: 'para', text: 'Pipeline 讓一個排程任務依序執行多個步驟（節點），前一步的結果可作為後一步的輸入，適合需要「查資料 → 分析 → 生成報告 → 寄信」等多階段自動化作業。' },
          { type: 'para', text: '在任務編輯頁切換至「**Pipeline 管線**」頁籤，點「+ 新增節點」加入步驟。' },
          {
            type: 'table',
            headers: ['節點類型', '圖示', '說明', '適用場景'],
            rows: [
              ['技能（Skill）', '⚡ 黃色', '呼叫指定技能，將技能回傳結果存入輸出變數', '即時查詢庫存、呼叫外部 API'],
              ['MCP 工具', '🔧 紫色', '直接呼叫 MCP 伺服器的指定工具，傳入 args 參數', '搜尋 Oracle 程式、ERP 資料查詢'],
              ['知識庫（KB）', '📖 綠色', '以 query 文字查詢指定知識庫，取得相關段落', '查 SOP、產品規格、技術文件'],
              ['AI 追加（AI）', '🤖 藍色', '讓 AI 對前一步的結果再做分析/整理，需撰寫 Prompt', '整合多個來源後做二次摘要'],
              ['生成檔案', '📤 靛色', '將前一步 AI 輸出生成特定格式檔案', '輸出 Excel / PDF / PPT / Word'],
              ['條件判斷', '🌿 玫瑰色', '根據前一步輸出進行分支（if/else），支援 AI 判斷或文字比對', '根據異常數量高低分流'],
              ['並行執行', '⑁ 青色', '將多個子步驟同時執行，加速多路查詢', '同時查多個知識庫、多個 API'],
            ],
          },
          { type: 'para', text: '每個節點都可設定「**失敗時行為**」：' },
          {
            type: 'table',
            headers: ['失敗行為', '說明'],
            rows: [
              ['continue（繼續）', '此步驟失敗後跳過，繼續執行下一個節點'],
              ['stop（停止）', '此步驟失敗後中止整個 Pipeline，不寄出報告'],
              ['goto（跳轉）', '此步驟失敗後跳到指定節點 ID 繼續執行'],
            ],
          },
          {
            type: 'code',
            text: 'Pipeline 典型流程範例\n\n[1] MCP 工具：查詢本日 ERP 不良工單數量\n    ↓\n[2] 知識庫：查詢相關 SOP 改善措施\n    ↓\n[3] AI 追加：整合以上資料，撰寫異常摘要報告\n    ↓\n[4] 生成檔案：輸出為 Excel，檔名 異常報告_{{date}}.xlsx\n    ↓（寄出 Email 附附件）',
          },
          { type: 'tip', text: 'Pipeline 與 Prompt 可以同時使用：Prompt 作為主要的 AI 指示，Pipeline 則在 Prompt 執行前先完成資料收集步驟，Pipeline 的最終輸出會自動注入到 Prompt 的執行上下文中。' },
          { type: 'note', text: 'Pipeline 節點數量較多時執行時間會增加，建議使用並行節點加速獨立的查詢步驟。若無需多步驟，直接在 Prompt 中使用 `{{skill:}}` / `{{kb:}}` 語法即可，更簡潔。' },
        ],
      },
    ],
  },


  {
    id: 'u-share',
    sort_order: 10,
    icon: 'Share2',
    icon_color: 'text-blue-500',
    last_modified: '2026-04-01',
    title: '分享對話',
    sidebar_label: '分享對話',
    blocks: [
      { type: 'para', text: 'Foxlink GPT to Cortex 提供類似 ChatGPT 的對話分享功能，您可以將任何一段完整的對話建立為唯讀快照，並把連結分享給同事。對方只需登入即可查看，也可以選擇「繼續這段對話」複製一份到自己的帳號接著使用。' },
      {
        type: 'subsection',
        title: '建立分享連結',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '開啟您想分享的對話', desc: '從左側邊欄點選目標對話' },
              { title: '點選頂部工具列的「分享」按鈕', desc: '按鈕位於對話標題右側，AI 回覆中才會顯示' },
              { title: '系統建立快照並顯示分享連結', desc: '彈出視窗顯示完整 URL' },
              { title: '點選「複製」按鈕', desc: '複製連結後貼給同事即可' },
            ],
          },
          { type: 'note', text: '分享連結建立後，原始對話的後續更改不會影響快照內容。快照是獨立的複本，兩者完全分離。' },
        ],
      },
      {
        type: 'subsection',
        title: '查看分享內容',
        blocks: [
          { type: 'para', text: '收到分享連結的使用者點開後，需先登入系統（需有效帳號），然後可以查看完整的對話記錄。頁面頂部會顯示分享者名稱及建立時間。' },
          {
            type: 'comparison',
            items: [
              {
                title: '唯讀模式',
                desc: '只能查看，無法修改或繼續對話，保護原始內容不被更動。',
                borderColor: 'slate',
              },
              {
                title: '繼續對話（Fork）',
                desc: '點選「在我的對話繼續」，系統建立一份您專屬的對話副本，可自由接續。',
                borderColor: 'blue',
              },
            ],
          },
          { type: 'tip', text: 'Fork（繼續對話）後會在您的對話歷史出現一筆標題為「[Fork] 原始標題」的新對話，不影響原分享快照。' },
        ],
      },
      {
        type: 'subsection',
        title: '分享的圖片與檔案',
        blocks: [
          { type: 'para', text: '分享快照建立時，對話中所有使用者上傳的圖片及 AI 生成的圖片都會複製一份到快照中，與原始檔案完全獨立。查看者及 Fork 使用者看到的圖片都是各自獨立的複本，互不影響。' },
          { type: 'note', text: '若分享對話中含有文件（PDF、Word 等），文件內容已在對話時送給 AI 分析，快照中保留的是文字紀錄，不含原始檔案本身。' },
        ],
      },
    ],
  },

  {
    id: 'u-skill',
    sort_order: 14,
    icon: 'Sparkles',
    icon_color: 'text-purple-500',
    last_modified: '2026-04-15',
    title: '技能 Skill',
    sidebar_label: '技能 Skill',
    blocks: [
      { type: 'para', text: '技能（Skill）是可以掌載到對話的自訂模組，能讓 AI 具備特定領域的專業知識、固定指令或對接外部服務的能力。例如，掛載「專業術語翻譯」技能後，每次對話 AI 會自動以該行業的標準用語進行翻譯。' },
      {
        type: 'subsection',
        title: '技能類型',
        blocks: [
          {
            type: 'card_grid',
            cols: 2,
            items: [
              {
                emoji: '🧠',
                title: '內建 Prompt 技能',
                desc: '透過 System Prompt 給 AI 加上角色設定或指引。不需要外部服務，建立簡單。適合：翻譯腔調、行業專家、內部 SOP 助手等。',
                borderColor: 'blue',
              },
              {
                emoji: '🌐',
                title: '外部 Endpoint 技能',
                desc: '呼叫外部 API，取得即時資料再供給 AI。適合：時刻查詢、即時庫存、外部知識庫對接等。',
                borderColor: 'purple',
              },
              {
                emoji: '',
                title: '內部程式技能（Code）',
                desc: '在平台內直接撰寫 Node.js 程式碼，以獨立子程序運行。適合：即時股價查詢、ERP 資料對接、自動計算等需要程式邏輯的場景。需要管理員授予「允許程式技能」權限。',
                borderColor: 'emerald',
              },
              {
                emoji: '',
                title: '工作流程技能（Workflow）',
                desc: '以 DAG（有向無環圖）視覺化編排多步驟流程，串接 LLM、知識庫、MCP 工具、HTTP 請求、條件判斷等節點。適合：多步驟審核流程、資料管線、複雜 AI Agent 等場景。',
                borderColor: 'orange',
              },
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '端點模式（外部 / 程式技能適用）',
        blocks: [
          {
            type: 'table',
            headers: ['模式', '行為說明'],
            rows: [
              ['inject（注入）', 'Skill 執行後，將回傳的資料注入 AI 的 System Prompt，AI 再根據這份資料回答。AI 仍擁有思考空間，適合「提供背景資訊」的場景（如即時股價、庫存數據）。'],
              ['answer（直接回答）', 'Skill 執行結果直接作為最終回覆，完全略過 AI。適合需要精準固定格式輸出的場景。'],
              ['post_answer（後處理）', 'AI 先正常回答使用者，回答完成後才呼叫此技能做後處理。適合不影響主要對話但需要額外動作的場景，例如語音合成（TTS）、自動寫入外部系統、產生報表檔案等。'],
            ],
          },
          { type: 'tip', text: 'inject 模式：若使用者訊息中沒有觸發條件（如找不到股票代號），Skill 可回傳空 system_prompt，AI 會正常以 Google 搜尋或自身知識回答。' },
        ],
      },
      {
        type: 'subsection',
        title: '如何將技能掛載到對話',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '前往左側邊欄的「技能市集」', desc: '個人技能與公開技能均可在此瀏覽' },
              { title: '點選技能卡片右下角的「💬」(在對話中使用)', desc: '系統自動建立新對話並掛載此技能' },
              { title: '或開啟對話後，點選頂部工具列的「✨ 技能」按鈕', desc: '選擇要掛載的技能後點「確認掛載」' },
              { title: '頂部工具列出現紫色 Badge 確認掛載成功', desc: '此對話之後每次發訊都會自動套用此技能' },
            ],
          },
          { type: 'tip', text: '可以對同一個對話掛載多個技能，效果會叠加。再次點「技能」按鈕即可修改或移除已掛載的技能。' },
        ],
      },
      {
        type: 'subsection',
        title: '建立技能',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '進入技能市集，點選「建立技能」' },
              { title: '填寫名稱、說明、選擇圖示與技能類型（內建 Prompt / 外部 / Code / Workflow）' },
              { title: '設定技能的 Tags（標籤）', desc: 'Tags 決定系統在何時自動啟用此技能。建議設定 2~5 個精準標籤，如「翻譯」「越南文」，讓 TAG 路由機制能正確匹配' },
              { title: '完成設定後點「儲存」，技能預設為「私人」，僅自己可用' },
            ],
          },
          { type: 'note', text: '技能同樣需要設定 Tags 才能透過 TAG 路由自動啟用。未設定 Tags 的技能只能在對話頂部手動選擇掛載。' },
        ],
      },
      {
        type: 'subsection',
        title: '申請技能公開（需管理員審核）',
        blocks: [
          { type: 'para', text: '建立的技能預設為私人，只有您自己可以使用。若希望分享給全體同仁，需申請公開並通過管理員審核：' },
          {
            type: 'steps',
            items: [
              { title: '在技能市集的「我的技能」區找到目標技能卡片' },
              { title: '點選技能卡片右下角的「申請公開」按鈕（地球圖示）', desc: '按鈕僅在技能狀態為「私人」且尚未申請時顯示' },
              { title: '系統將申請送交管理員審核', desc: '技能卡片狀態徽章變為橘色「待審核」' },
              { title: '管理員在後台審核後批准或拒絕', desc: '批准後技能狀態變為綠色「公開」，所有員工可在公開技能區看到' },
            ],
          },
          {
            type: 'list',
            items: [
              '**私人** — 灰色徽章，僅自己可見與使用',
              '**待審核** — 橘色徽章，申請已送出，等待管理員批准',
              '**公開** — 綠色徽章，全員可在公開市集看到並使用或 Fork',
            ],
          },
          { type: 'tip', text: '公開技能的其他員工可點選「Fork」複製一份到自己的帳號後自由修改，原始公開版本不受影響。' },
        ],
      },
      {
        type: 'subsection',
        title: '個人分享技能給特定對象',
        blocks: [
          { type: 'para', text: '不想公開給全員、只想分享給特定同事？可在技能卡片選單點「分享」，選擇分享對象（使用者 / 角色 / 廠區 / 部門 / 利潤中心 / 事業處 / 事業群）後設定「使用」或「管理」權限，對方可在技能市集的「分享給我」區找到此技能。' },
        ],
      },
      {
        type: 'subsection',
        title: '技能上的 MCP 工具模式',
        blocks: [
          {
            type: 'table',
            headers: ['模式', '說明'],
            rows: [
              ['append（追加）', '在角色已授權的工具基礎上，加入技能指定的額外伺服器工具（預設）'],
              ['exclusive（獨佔）', '僅限定使用技能指定的 MCP 伺服器，角色其他工具暫時停用'],
              ['disable（停用）', '對話期間禁用全部 MCP 工具，適合純文字對話場景'],
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '知識庫綁定（KB Binding）',
        blocks: [
          { type: 'para', text: '技能可以綁定特定的自建知識庫與 API 連接器，讓掛載技能時自動啟用相關知識庫，無需使用者手動選取。' },
          {
            type: 'table',
            headers: ['模式', '說明'],
            rows: [
              ['append（追加）', '技能綁定的知識庫與使用者已掛載的知識庫同時生效（預設）'],
              ['exclusive（獨佔）', '僅使用技能綁定的知識庫，忽略使用者自行掛載的知識庫'],
              ['disable（停用）', '對話期間不使用任何知識庫'],
            ],
          },
          { type: 'tip', text: '知識庫綁定由技能建立者在編輯頁「工具與知識庫」頁籤中設定，使用者掛載技能後自動套用。' },
        ],
      },
      {
        type: 'subsection',
        title: 'TAG 自動路由',
        blocks: [
          { type: 'para', text: '系統使用 TAG 標籤機制自動判斷每則訊息應啟用哪些工具、知識庫與技能，無需使用者手動勾選。每個 MCP 伺服器、API 連接器、自建知識庫及技能都可設定標籤（Tags），系統流程如下：' },
          {
            type: 'steps',
            items: [
              { title: '使用者發送訊息', desc: '系統以 Flash LLM 從訊息中萃取 0~5 個意圖標籤（intent tags）' },
              { title: 'TAG 比對', desc: '將意圖標籤與所有工具/知識庫/技能上的標籤進行雙向模糊比對' },
              { title: '描述精篩（Description Refinement）', desc: '若 TAG 比對命中過多候選項，再以 Flash LLM 根據工具描述做二次精篩' },
              { title: 'Fallback', desc: '若未設定任何 TAG 或比對全部落空，則回退到傳統的 intent 過濾機制' },
            ],
          },
          { type: 'tip', text: '建議為每個工具和知識庫設定 2~5 個精準的標籤（如「股票」「財報」「ERP」），讓系統能更準確地自動路由，減少不必要的工具呼叫，節省 Token 費用。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Prompt 輸入變數（prompt_variables）',
        blocks: [
          { type: 'para', text: '技能可以定義輸入變數，讓使用者在掛載技能到對話時填寫自訂參數，這些參數會自動注入到 System Prompt 中。例如，翻譯技能可設定「目標語言」變數，掛載時讓使用者選擇「日文」或「韓文」。' },
          { type: 'para', text: '輸入變數的定義格式為 **JSON 陣列**，在技能編輯器的「輸入/輸出」頁籤中設定。每個變數是一個物件，包含以下屬性：' },
          {
            type: 'table',
            headers: ['屬性', '必填', '說明'],
            rows: [
              ['name', '✅', '變數識別名稱（英文），用於 System Prompt 中的 {{name}} 對應替換'],
              ['label', '❌', '顯示在表單上的中文標籤，未設定時以 name 代替'],
              ['type', '✅', '輸入元件類型（見下方類型表）'],
              ['required', '❌', '是否為必填，設為 true 時表單欄位旁顯示紅色星號'],
              ['options', '❌', 'type 為 select 時的選項陣列，如 ["選項A", "選項B"]'],
              ['default', '❌', '預設值，使用者未填寫時自動帶入'],
              ['placeholder', '❌', '輸入框的提示文字（浮水印）'],
            ],
          },
          {
            type: 'table',
            headers: ['type 值', '表單元件', '適用場景'],
            rows: [
              ['text', '單行文字輸入框', '名稱、關鍵字等短文字'],
              ['textarea', '多行文字區域（20 行高）', '長段描述、背景資料、條件說明'],
              ['select', '下拉選單', '固定選項，需搭配 options 屬性'],
              ['number', '數字輸入框', '數量、分數、金額等數值'],
              ['date', '日期選擇器', '起始日、截止日'],
              ['date_range', '日期區間選擇器', '報表期間、統計區間'],
              ['checkbox', '布林值勾選框', '開關型設定（是/否）'],
            ],
          },
          { type: 'para', text: '**完整範例 — 會議紀錄生成器技能：**' },
          {
            type: 'code',
            text: '[\n  {\n    "name": "meeting_title",\n    "label": "會議名稱",\n    "type": "text",\n    "required": true,\n    "placeholder": "例如：Q2 產品規劃會議"\n  },\n  {\n    "name": "participants",\n    "label": "與會人員",\n    "type": "textarea",\n    "placeholder": "每行一位，含職稱"\n  },\n  {\n    "name": "output_lang",\n    "label": "輸出語言",\n    "type": "select",\n    "options": ["繁體中文", "English", "日本語"],\n    "default": "繁體中文",\n    "required": true\n  },\n  {\n    "name": "meeting_date",\n    "label": "會議日期",\n    "type": "date"\n  },\n  {\n    "name": "include_action_items",\n    "label": "包含待辦事項",\n    "type": "checkbox",\n    "default": true\n  }\n]',
          },
          { type: 'para', text: '在 System Prompt 中使用 **{{變數名稱}}** 語法引用變數值，例如：' },
          { type: 'code', text: '你是專業的會議記錄員。\n會議名稱：{{meeting_title}}\n會議日期：{{meeting_date}}\n與會人員：\n{{participants}}\n\n請根據使用者提供的會議內容整理出結構化的會議紀錄。\n輸出語言：{{output_lang}}\n是否列出待辦事項：{{include_action_items}}' },
          { type: 'note', text: '變數值是 **對話（Session）級別** 的，同一個對話中技能變數只填一次，之後每次發訊息都會沿用相同的值。若需更改，可重新選擇技能觸發填寫視窗。Workflow 類型技能也可使用 {{var.變數名稱}} 語法在節點中引用變數。' },
          { type: 'tip', text: '掛載技能時若該技能定義了輸入變數，系統會自動彈出表單讓使用者填寫。若所有變數都有 default 值，使用者可直接確認不需逐一填寫。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Tool Schema — Code / 外部技能自動註冊為 Gemini Tool',
        blocks: [
          { type: 'para', text: 'Code 與外部（External）類型的技能可以在「輸入/輸出」頁籤定義 **Tool Schema**（Gemini Function Declaration），讓 AI 在對話中自動判斷是否需要呼叫該技能，而非每次都觸發。這等同於 Gemini 的 Function Calling 機制。' },
          { type: 'para', text: '例如，一個「股價查詢」Code 技能定義了 Tool Schema，AI 收到「台積電股價多少」時會自動呼叫，但收到「今天天氣如何」則不會觸發。' },
          { type: 'para', text: 'Tool Schema 格式為 **JSON 物件**，包含技能的描述及參數定義：' },
          {
            type: 'code',
            text: '{\n  "description": "查詢指定員工的出勤紀錄，回傳遲到、早退、請假等統計",\n  "parameters": {\n    "type": "object",\n    "properties": {\n      "employee_id": {\n        "type": "string",\n        "description": "員工工號"\n      },\n      "month": {\n        "type": "string",\n        "description": "查詢月份，格式 YYYY-MM"\n      }\n    },\n    "required": ["employee_id"]\n  }\n}',
          },
          {
            type: 'list',
            items: [
              '**description**：AI 用來判斷何時該呼叫此技能的依據，寫得越精準，AI 判斷越準確',
              '**parameters**：遵循 JSON Schema 格式，定義技能接受的輸入參數',
              '**required**：指定哪些參數是必要的，AI 呼叫時一定會提供',
            ],
          },
          { type: 'note', text: '未定義 Tool Schema 的 Code / 外部技能仍按原有的 inject / answer / post_answer 端點模式運作，不受影響。有定義 Tool Schema 時，AI 會自行決定是否呼叫，無需每次都觸發。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Output Schema（輸出結構定義）',
        blocks: [
          { type: 'para', text: '技能可以在「輸入/輸出」頁籤定義 **Output Schema**（JSON Schema 格式），指引 AI 以固定的 JSON 結構回覆。適合需要結構化資料的場景，如自動產生工單、匯出報表欄位、與下游系統對接等。' },
          { type: 'para', text: '**運作方式**：系統會將 Output Schema 以文字指令注入到 AI 的 System Prompt 中，告知 AI「請嚴格按照以下 JSON Schema 格式回答」。這是一種**軟約束** — AI 會盡量遵守，但不保證 100% 完全符合。' },
          { type: 'para', text: '**範例 — 產品品質檢核報告：**' },
          {
            type: 'code',
            text: '{\n  "type": "object",\n  "properties": {\n    "product_name": {\n      "type": "string",\n      "description": "產品名稱"\n    },\n    "inspection_result": {\n      "type": "string",\n      "enum": ["PASS", "FAIL", "CONDITIONAL"],\n      "description": "檢驗結果"\n    },\n    "defects": {\n      "type": "array",\n      "description": "發現的缺陷列表",\n      "items": {\n        "type": "object",\n        "properties": {\n          "category": { "type": "string", "description": "缺陷類別" },\n          "severity": { "type": "string", "enum": ["critical", "major", "minor"] },\n          "description": { "type": "string", "description": "缺陷描述" }\n        }\n      }\n    },\n    "score": {\n      "type": "number",\n      "description": "品質評分 0-100"\n    },\n    "recommendations": {\n      "type": "array",\n      "items": { "type": "string" },\n      "description": "改善建議"\n    }\n  }\n}',
          },
          { type: 'para', text: 'AI 收到使用者訊息後，會根據此 Schema 回覆結構化的 JSON，例如：' },
          {
            type: 'code',
            text: '{\n  "product_name": "FX-200 連接器",\n  "inspection_result": "CONDITIONAL",\n  "defects": [\n    {\n      "category": "外觀",\n      "severity": "minor",\n      "description": "端子表面有輕微刮痕"\n    }\n  ],\n  "score": 82,\n  "recommendations": [\n    "建議調整衝壓模具間隙",\n    "加強來料端子外觀抽檢"\n  ]\n}',
          },
          {
            type: 'list',
            items: [
              '**type**：定義資料型態（object、array、string、number、boolean）',
              '**properties**：物件的子欄位定義，每個欄位可設定 type 和 description',
              '**enum**：限制欄位只能使用指定的值（如 "PASS"、"FAIL"）',
              '**items**：陣列中每個元素的結構定義',
              '**description**：欄位說明，幫助 AI 理解該欄位應填入什麼內容',
            ],
          },
          { type: 'tip', text: 'Output Schema 搭配「輸出範本」使用效果更佳 — AI 先按 Schema 輸出 JSON，系統再自動套用文件範本產生 PPTX / DOCX / PDF 等檔案。' },
          { type: 'note', text: 'Output Schema 為軟約束，AI 會盡力遵守但不保證格式完全正確。若對格式精確度要求極高，建議搭配 Code 技能做後處理驗證。' },
        ],
      },
      {
        type: 'subsection',
        title: '輸出範本綁定（Output Template）',
        blocks: [
          { type: 'para', text: '技能可以在「輸入/輸出」頁籤綁定一個**文件範本**，讓 AI 的回覆自動套用範本產生 PPTX / DOCX / PDF / XLSX 等檔案。適合需要固定格式輸出的場景，如檢驗報告、會議紀錄、訓練教材等。' },
          {
            type: 'steps',
            items: [
              { title: '先建立文件範本', desc: '在「文件範本」功能中定義範本結構與欄位' },
              { title: '編輯技能 →「輸入/輸出」頁籤', desc: '在「輸出範本」欄位點選選取對應的範本' },
              { title: '（建議）同時設定 Output Schema', desc: '讓 AI 輸出的 JSON 欄位與範本預期的欄位對齊，產生的檔案內容更準確' },
              { title: '使用者對話時', desc: 'AI 回覆後系統自動將 JSON 套入範本，在聊天室產生可下載的檔案' },
            ],
          },
          { type: 'tip', text: '輸出範本特別適合搭配 post_answer 端點模式的技能 — AI 先正常回答，後處理技能再產生報表檔案。' },
        ],
      },
      {
        type: 'subsection',
        title: '進階設定',
        blocks: [
          { type: 'para', text: '在技能編輯器的「進階設定」頁籤可以配置以下選項：' },
          {
            type: 'table',
            headers: ['設定', '說明'],
            rows: [
              ['指定模型（Model）', '覆蓋預設對話模型。例如，需要高品質推理的技能可指定 Pro 模型，簡單文字處理的可指定 Flash 節省成本。留空則使用系統預設模型。'],
              ['端點模式（Endpoint Mode）', '外部 / Code 技能的執行時機：inject（注入到 AI 前）、answer（直接回答）、post_answer（AI 回答後再執行）。詳見「端點模式」章節。'],
              ['速率限制', '每人上限、全域上限、時間窗口。詳見「速率限制」章節。'],
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '速率限制（Rate Limiting）',
        blocks: [
          { type: 'para', text: '技能可設定使用頻率限制，防止濫用或控制 API 成本：' },
          {
            type: 'table',
            headers: ['設定', '說明'],
            rows: [
              ['每人上限', '單一使用者在指定時間窗口內可呼叫此技能的最大次數'],
              ['全域上限', '所有使用者合計在指定時間窗口內的最大呼叫次數'],
              ['時間窗口', '限制的計算週期：每分鐘（minute）、每小時（hour）、每日（day）'],
            ],
          },
          { type: 'tip', text: '超過速率限制時，系統會回覆提示訊息，使用者需等待時間窗口重置後再使用。' },
        ],
      },
      {
        type: 'subsection',
        title: '版本控制與發佈',
        blocks: [
          { type: 'para', text: '技能的 Prompt 支援版本控制機制，讓您可以安全地修改和回滾：' },
          {
            type: 'steps',
            items: [
              { title: '編輯草稿（Draft）', desc: '修改 Prompt 時，改動先存入草稿，不影響目前線上版本' },
              { title: '發佈（Publish）', desc: '確認修改無誤後，點選「發佈新版本」，草稿變為正式版本，版本號 +1' },
              { title: '查看歷史版本', desc: '在「版本歷史」頁籤可瀏覽所有已發佈的版本內容' },
              { title: '回滾（Rollback）', desc: '若新版本有問題，可一鍵回滾到任一歷史版本' },
            ],
          },
          { type: 'note', text: '版本控制僅追蹤 Prompt 與 Workflow 設定的變更，其他欄位（名稱、描述等）修改後即時生效。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Workflow 工作流程編排',
        blocks: [
          { type: 'para', text: 'Workflow 類型技能使用視覺化拖拉編輯器（React Flow），以 DAG 方式編排多步驟 AI 流程。每個節點代表一個處理步驟，節點之間以連線定義執行順序。' },
          {
            type: 'table',
            headers: ['節點類型', '說明'],
            rows: [
              ['🟢 開始（Start）', '流程入口，接收使用者輸入'],
              ['🤖 LLM', '呼叫大語言模型處理文字，可設定 System Prompt 與模型'],
              ['📚 知識庫（Knowledge Base）', '查詢自建知識庫，取得相關段落'],
              ['🔌 API', '查詢 API 連接器'],
              ['🔧 MCP 工具', '呼叫 MCP 伺服器的工具'],
              ['✨ 技能（Skill）', '呼叫其他已建立的技能'],
              ['💻 程式碼（Code）', '執行自訂 JavaScript 程式碼'],
              ['🌐 HTTP 請求', '呼叫外部 REST API'],
              ['❓ 條件判斷（Condition）', '根據前一步結果分支（contains / equals / gt / lt 等）'],
              ['📝 模板（Template）', '使用模板語法組合多個節點的輸出'],
              ['🔴 輸出（Output）', '流程終點，定義最終輸出內容'],
            ],
          },
          { type: 'para', text: '節點之間可使用 {{nodeId.output}} 語法引用其他節點的輸出，例如 {{start.input}} 取得使用者原始訊息，{{llm_1.output}} 取得 LLM 節點的回應。' },
          { type: 'tip', text: 'Workflow 最多允許 50 個節點，執行時以拓撲排序依序處理。條件節點支援 default（符合條件）與 else（不符合）兩條分支路徑。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Code 技能運作機制',
        blocks: [
          { type: 'para', text: 'Code 類型技能在平台內以**獨立 Node.js 子程序**運作，每個技能擁有獨立的 Express 伺服器與連接埠（Port 40100–40999），與主程式完全隔離。' },
          {
            type: 'table',
            headers: ['機制', '說明'],
            rows: [
              ['啟動', '儲存技能程式碼後手動啟動，系統自動安裝 NPM 套件、分配 Port、啟動子程序'],
              ['狀態', '技能卡片即時顯示：🟢 running（運行中）、🔴 error（異常）、⚪ stopped（已停止）'],
              ['熱更新', '系統每 30 秒健康檢查，若偵測到程式碼有變動（例如其他 Pod 修改），自動重新載入'],
              ['NPM 套件', '在「NPM 套件」欄位加入需要的套件名稱（如 axios、lodash），系統會自動 npm install'],
              ['日誌', '可在技能市集點選技能查看即時 Log 輸出（stdout / stderr / 啟動 / 健康檢查紀錄）'],
            ],
          },
          { type: 'para', text: '程式碼撰寫格式如下：' },
          {
            type: 'code',
            text: 'async function handler(body) {\n  // body.user_message — 使用者訊息\n  // body.user_id     — 使用者 ID\n  // body.session_id  — 對話 Session ID\n  // body.args        — Tool Schema 呼叫時 AI 傳入的參數（JSON）\n\n  const result = await fetchSomeData(body.user_message);\n\n  return {\n    // inject 模式 → 回傳 system_prompt 注入 AI\n    system_prompt: `以下是查詢結果：${JSON.stringify(result)}`,\n    // 或 answer 模式 → 回傳 content 直接作為回覆\n    // content: `查詢結果：${result}`\n  };\n}',
          },
          { type: 'note', text: 'Code 技能需要管理員授予「允許程式技能」權限才能建立。程式碼在隔離的子程序中執行，無法存取主程式的資料庫連線或檔案系統。' },
        ],
      },
      {
        type: 'subsection',
        title: '呼叫紀錄（Call Logs）',
        blocks: [
          { type: 'para', text: '每個技能會自動記錄最近 100 筆呼叫紀錄，方便技能擁有者追蹤使用狀況與除錯。在技能市集的技能詳情頁可查看。' },
          {
            type: 'table',
            headers: ['欄位', '說明'],
            rows: [
              ['使用者', '呼叫此技能的使用者名稱'],
              ['狀態', '🟢 OK（成功）或 🔴 Error（失敗）'],
              ['耗時', '技能執行時間（毫秒）'],
              ['查詢預覽', '使用者訊息的前段摘要'],
              ['錯誤訊息', '失敗時的錯誤原因'],
              ['時間', '呼叫時間戳記'],
            ],
          },
          { type: 'tip', text: '呼叫紀錄僅技能擁有者和管理員可查看，一般使用者無法看到他人的使用紀錄。' },
        ],
      },
      {
        type: 'subsection',
        title: '技能編輯器頁籤總覽',
        blocks: [
          { type: 'para', text: '編輯技能時，編輯器分為五個頁籤，各頁籤的功能如下：' },
          {
            type: 'table',
            headers: ['頁籤', '內容'],
            rows: [
              ['基本資訊', '名稱、說明、圖示、技能類型、Tags 標籤、System Prompt（內建類型）、端點 URL（外部類型）、程式碼（Code 類型）、工作流程編輯器（Workflow 類型）'],
              ['工具綁定', 'MCP 工具模式與伺服器選擇、自建知識庫綁定、API 連接器（Dify）綁定、知識庫模式'],
              ['輸入/輸出', 'Prompt 輸入變數（prompt_variables）定義、Tool Schema（Gemini Function Declaration）、Output Schema（輸出結構）、輸出範本綁定'],
              ['進階設定', '指定模型覆蓋、端點模式（inject / answer / post_answer）、速率限制（每人 / 全域 / 時間窗口）'],
              ['版本歷史', '發佈新版本、查看歷史版本清單、一鍵回滾到指定版本（僅編輯現有技能時顯示）'],
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'u-kb',
    sort_order: 15,
    icon: 'Database',
    icon_color: 'text-teal-500',
    last_modified: '2026-04-22',
    title: '知識庫市集',
    sidebar_label: '知識庫市集',
    blocks: [
      { type: 'para', text: '知識庫市集讓您可以將企業內部文件向量化，建立專屬的語意搜尋資料庫。對話時掛載知識庫，AI 會先從知識庫檢索最相關的段落，再結合自身能力回答，大幅提升對特定領域文件（如 SOP、技術手冊、規格書）的回答準確度。' },
      {
        type: 'subsection',
        title: '前提條件',
        blocks: [
          { type: 'para', text: '需要系統管理員授予「允許建立知識庫」權限，以及設定容量與數量上限後，才會在側邊欄「更多功能」選單看到「知識庫市集」入口。' },
          { type: 'tip', text: '若無建立權限，仍可使用管理員或其他人共享（permission = use）給您的知識庫進行對話，無需建立自己的知識庫。' },
        ],
      },
      {
        type: 'subsection',
        title: '建立知識庫',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '點選「知識庫市集」→「+ 建立知識庫」' },
              { title: '填寫名稱、描述（必填名稱）', desc: '建立後可在詳情頁頂部點選鉛筆圖示快速編輯名稱與描述' },
              { title: '選擇分塊策略', desc: '「常規分段」：依段落切分，適合一般文件；「父子分塊」：大塊作背景、小塊用來檢索，適合長篇技術文件' },
              { title: '選擇檢索模式', desc: '「向量檢索」：語意相似度；「全文檢索」：關鍵字比對；「混合檢索」：兩者結合（建議）' },
              { title: '選擇 OCR 模型（選填）', desc: '上傳文件時用來解析圖片/PDF 內圖片的 Gemini 模型，預設使用系統設定的 Flash 模型' },
              { title: '確認 PDF OCR 模式（預設「自動」）', desc: '「自動」= 每頁判斷：有文字層直接抽字（快）、沒文字層才 OCR（準）；多數情況維持預設即可。「強制」= 所有頁面都 OCR，最慢但最準' },
              { title: '點選「建立」，進入知識庫詳情頁' },
            ],
          },
          { type: 'tip', text: '**Embedding 維度已統一為 768**（v2 架構更新，建立表單不再顯示此選項）。所有知識庫使用相同維度以支援 Oracle 23 AI 的向量索引加速，對精度影響 < 2%。' },
        ],
      },
      {
        type: 'subsection',
        title: '上傳文件',
        blocks: [
          { type: 'para', text: '進入知識庫後，點選「文件」頁籤，拖曳或點選上傳區域選擇檔案。支援格式：**PDF · DOCX/DOC · PPTX/PPT · XLSX/XLS · TXT · CSV · JPG · PNG · GIF · WEBP**（單檔最大 200 MB）。舊版 Office 97-2003 格式（.doc/.ppt/.xls）也支援，系統會自動解析。' },
          {
            type: 'steps',
            items: [
              { title: '選取一或多個檔案上傳', desc: '多檔會循序處理，避免同時佔用 AI 配額' },
              { title: '系統自動解析文字並進行 Embedding 向量化', desc: '圖片與 PDF 中的圖片會先 OCR 轉文字，再一起向量化' },
              { title: '狀態變為綠色勾選代表處理完成', desc: '若出現紅色 ✗ 請查看錯誤訊息，常見原因：檔案格式不符或 AI 服務暫時中斷' },
            ],
          },
          { type: 'note', text: '大型文件（如含大量圖片的 DOCX）處理時間可能較長，頁面每隔幾秒會自動重新整理狀態，請耐心等待。' },
        ],
      },
      {
        type: 'subsection',
        title: '在對話中使用知識庫',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: '開啟或新建一個對話' },
              { title: '點選頂部工具列的「知識庫」按鈕（綠色）' },
              { title: '在下拉選單中勾選一或多個要使用的知識庫，點「確認」' },
              { title: '發送訊息，AI 會先檢索知識庫再組合回答', desc: '回覆中如有引用文件段落，AI 通常會說明來源文件名稱' },
            ],
          },
          { type: 'tip', text: '可以同時掛載「自建知識庫」＋「API 連接器」＋「MCP 工具」，AI 會綜合所有來源回答。此外，若知識庫設有標籤（Tags），系統會透過 TAG 自動路由機制，根據訊息內容自動判斷是否啟用對應知識庫。' },
        ],
      },
      {
        type: 'subsection',
        title: '召回測試（檢索測試）',
        blocks: [
          { type: 'para', text: '進入知識庫詳情 → 點選「召回測試」頁籤，輸入任意問題，系統會模擬真實對話的檢索流程，顯示前幾名相關段落、相似度分數及比對方式（向量 / 全文 / 混合），幫助您調整設定參數。' },
        ],
      },
      {
        type: 'subsection',
        title: '共享知識庫',
        blocks: [
          { type: 'para', text: '進入知識庫詳情 → 點選「共享設定」頁籤，可將知識庫共享給特定使用者、角色、廠區、部門、利潤中心、事業處或事業群。' },
          {
            type: 'table',
            headers: ['共享方式', '對象'],
            rows: [
              ['使用者', '指定單一帳號'],
              ['角色', '系統管理員定義的角色群組（如研發部）'],
              ['廠區', '依 ERP 廠區代碼（FACTORY_CODE）共享，如 TCC、Z4E 等製造廠'],
              ['部門', '依 ERP 組織同步的部門代碼'],
              ['利潤中心', '依利潤中心共享'],
              ['事業處', '依事業處（org_section）共享'],
              ['事業群', '依事業群（org_group）共享'],
            ],
          },
          {
            type: 'table',
            headers: ['共享權限', '說明'],
            rows: [
              ['use（僅使用）', '被共享者可在對話中掛載此知識庫，但無法在知識庫市集列表中看到或進入設定頁'],
              ['edit（可編輯）', '被共享者可在市集中看到並進入此知識庫，可上傳文件、修改設定'],
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '申請公開',
        blocks: [
          { type: 'para', text: '若希望全體員工都能看到並使用此知識庫，可在「共享設定」頁籤點選「申請設為公開」，送出申請後需等待系統管理員審核通過，審核後知識庫會對所有人開放（唯讀使用，不可編輯）。' },
        ],
      },
      {
        type: 'subsection',
        title: '分段與檢索設定調整',
        blocks: [
          { type: 'para', text: '進入知識庫詳情 → 點選「分塊與檢索設定」頁籤，可隨時調整以下參數（調整後不需重新上傳文件，下次對話立即生效）：' },
          {
            type: 'table',
            headers: ['參數', '說明', '建議值'],
            rows: [
              ['分段識別符號', '用來切分段落的符號', '\\n\\n（空白行）'],
              ['分段最大長度', '每個 chunk 的字元上限', '512–1024'],
              ['重疊長度', '前後 chunk 共享的字元數，避免重要資訊被截斷', '50–100'],
              ['初始擷取 Top K', '向量/全文各抓幾條候選結果', '10–20'],
              ['最終返回 Top K', '重排序後送給 AI 的最終條數', '3–5'],
              ['Score 閾值', '相似度低於此值的結果會被丟棄（0–1）', '預設 0（不過濾）'],
              ['OCR 模型', '處理圖片的 Gemini 模型', 'Flash（快速省成本）'],
            ],
          },
          { type: 'tip', text: 'Score 閾值為什麼預設是 0？因為不同檢索模式（向量 / 全文 / 混合）與不同 embedding 模型的分數分布差異很大（向量通常 0.5–0.9、全文分數範圍不固定、混合為融合後再正規化），任何硬編碼預設值都可能誤殺合理結果；因此預設 0（全部保留），讓召回結果完整交給後續的重排序與 LLM 判斷。建議先用「召回測試」觀察您實際資料的分數分布，再決定是否調高（例如向量模式可試 0.3–0.5 過濾明顯不相關的內容）。' },
        ],
      },
      {
        type: 'subsection',
        title: '知識庫格式感知',
        blocks: [
          { type: 'para', text: '系統會根據上傳文件的格式自動選擇最佳的解析方式，確保內容被完整擷取並向量化。' },
          {
            type: 'table',
            headers: ['格式', '解析方式', '備註'],
            rows: [
              ['PDF', 'pdf-parse 文字層 + Gemini OCR（有圖片時）', '掃描件需 OCR，速度較慢'],
              ['DOCX / PPTX', 'JSZip 解壓縮 XML → 提取段落文字', '保留標題層級與段落結構'],
              ['XLSX / CSV', '逐列讀取，保留欄標頭', '大型表格建議先分頁再上傳'],
              ['TXT / MD', '直接讀取純文字', '保留換行結構'],
              ['JPG / PNG / WEBP / GIF', 'Gemini Vision OCR → 轉為文字 chunk', '圖片需設定 OCR 模型才會處理'],
            ],
          },
          { type: 'tip', text: '含大量圖表的 PDF 或 PPTX，建議在知識庫設定中指定 OCR 模型（Flash 即可），系統會自動對圖片頁面進行視覺理解，再合併到同一文件的文字 chunk 中。' },
          { type: 'note', text: 'XLSX 中的公式只會保留計算結果值，不保留公式本身。若需讓 AI 理解公式邏輯，請先將說明另存為 TXT 或 MD 一起上傳。' },
        ],
      },
      {
        type: 'subsection',
        title: '設定標籤（Tags）— 讓知識庫在對話中被自動啟用的關鍵',
        blocks: [
          { type: 'note', text: '**重要：必須為知識庫設定標籤（Tags），AI 才能在對話中透過 TAG 路由機制自動找到並使用它。**未設定標籤的知識庫只能在對話頂部手動勾選掛載，無法被系統自動匹配。' },
          { type: 'para', text: 'Tags 是讓系統「知道這個知識庫適合回答哪類問題」的關鍵線索。系統每次收到使用者訊息時，會先萃取訊息的意圖標籤，再比對所有知識庫的 Tags，命中的知識庫才會被自動啟用查詢。' },
          { type: 'para', text: '如何設定 Tags：' },
          {
            type: 'steps',
            items: [
              { title: '進入知識庫詳情頁 → 點選「設定」頁籤' },
              { title: '找到「標籤（Tags）」欄位', desc: '在知識庫名稱、描述下方' },
              { title: '輸入標籤文字後按 Enter，可新增多個標籤', desc: '例如：SOP、製程規範、品質手冊、產品規格' },
              { title: '點「儲存設定」完成' },
            ],
          },
          {
            type: 'table',
            headers: ['好的標籤（推薦）', '不好的標籤（避免）', '原因'],
            rows: [
              ['SOP', '文件', '太模糊，幾乎所有知識庫都符合'],
              ['不良分析、品質管制', '資料', '無法讓系統辨識知識庫主題'],
              ['原物料採購、供應商', '採購', '具體詞彙比單一詞更精準'],
              ['ERP WIP 程式', '程式', '加入領域前綴詞提升比對準確度'],
            ],
          },
          { type: 'tip', text: '建議每個知識庫設定 3~6 個精準標籤，涵蓋主題的不同說法（例如「SOP」和「標準作業程序」同時設定）。標籤設定後可回到對話測試，發現 AI 沒有用到預期知識庫時，可再回頭調整標籤。' },
        ],
      },
    ],
  },

  {
    id: 'u-research',
    sort_order: 15,
    icon: 'GitFork',
    icon_color: 'text-indigo-500',
    last_modified: '2026-04-01',
    title: '深度研究',
    sidebar_label: '深度研究',
    blocks: [
      { type: 'para', text: '「深度研究」讓 AI 針對複雜問題自動拆解成多個子問題、逐一深度調查後，整合產出完整報告。適合競品分析、技術評估、市場調查、法規解析等需要多角度、多來源交叉比對的場景。整個研究在背景非同步執行，不影響您繼續使用聊天。' },
      {
        type: 'subsection',
        title: '三步驟流程概覽',
        blocks: [
          {
            type: 'steps',
            items: [
              { title: 'Step 1：設定問題', desc: '輸入主題、選深度、設定全局附件與資料來源，AI 自動推薦相關知識庫' },
              { title: 'Step 2：確認計畫', desc: 'AI 生成子問題清單後，您可編輯問題文字、設定每個子問題的方向提示 / 附件 / 網搜開關 / 知識庫' },
              { title: 'Step 3：即時預覽', desc: '每個子問題完成後立即顯示答案摘要，全部完成自動整合報告並生成下載檔' },
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: 'Step 1：設定問題',
        blocks: [
          { type: 'para', text: '點選輸入框右側的深度研究按鈕開啟設定面板。若輸入框已輸入問題或附加了檔案，這些內容會自動帶入。' },
          {
            type: 'table',
            headers: ['設定項目', '說明'],
            rows: [
              ['研究問題', '輸入您要深入調查的問題或主題，越具體越好'],
              ['全局附件', '上傳檔案（PDF / Word / Excel / 圖片等）作為所有子問題的共用背景資料，拖放或點擊 + 附加'],
              ['研究深度', '快速 2 個、標準 5 個、深入 8 個、全面 12 個子問題，深度越高耗時越長'],
              ['輸出格式', '可多選 Word / PDF / PPT / Excel，完成後每種格式各生成一個下載連結'],
              ['整體資料來源', '為所有子問題預設使用的資料來源：自建知識庫 / API 連接器 / MCP 工具（子問題可個別覆蓋）'],
              ['自動建議 KB', '輸入問題 1 秒後系統自動分析並預選相關知識庫（橘色「自動建議」標籤）'],
              ['引用前次研究', '選擇已完成的研究，其摘要會自動作為本次研究的背景知識，可多選最多 3 筆'],
            ],
          },
          { type: 'tip', text: '輸入完問題後稍等 1 秒，系統會自動推薦相關知識庫並預勾選。若推薦不準確，可手動取消勾選。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Step 2：確認計畫與子問題設定',
        blocks: [
          { type: 'para', text: 'AI 生成研究計畫後進入確認頁，顯示研究主題、目標說明及自動拆解的子問題清單。您可拖曳排序、編輯問題文字、新增或刪除子問題（最多 12 個）。' },
          { type: 'para', text: '每個子問題展開後可設定：' },
          {
            type: 'list',
            items: [
              '**研究方向提示** — 輸入提示文字，例如「只看台灣市場數據」、「聚焦 2024 年後的資料」，引導 AI 研究方向。',
              '**子問題專屬附件** — 為此子問題額外附加不同的參考文件，僅此子問題使用，不影響其他子問題。',
              '**網路搜尋開關** — 為此子問題個別啟用或停用網路搜尋（覆蓋任務層級設定）。亮藍色 = 啟用，灰色 = 停用。實際是否啟用網搜還受「無 KB 資料才觸發」的邏輯控制。',
              '**子問題資料來源（覆蓋任務設定）** — 為此子問題指定不同的自建 KB / API 連接器 / MCP 工具，覆蓋 Step 1 設定的任務層級來源。',
            ],
          },
          { type: 'note', text: '子問題數量越多，Token 消耗越大。標準（5 個）適合大多數需求，若主題複雜才考慮深入（8 個）以上。' },
        ],
      },
      {
        type: 'subsection',
        title: 'Step 3：即時串流預覽',
        blocks: [
          { type: 'para', text: '點「確認並開始研究」後立即進入預覽頁，研究在背景執行，畫面即時更新每個子問題的狀態：' },
          {
            type: 'list',
            items: [
              '研究中（旋轉圖示）— AI 正在針對此子問題搜尋與生成答案',
              '已完成（綠色勾選）— 顯示答案摘要前 300 字',
            ],
          },
          { type: 'para', text: '全部子問題完成後，AI 自動整合產出完整報告並生成下載檔，之後可在頂部欄位的研究面板下載。' },
          { type: 'tip', text: '可以直接關閉此視窗，研究仍繼續在背景執行。完成後頂部的研究圖示會出現完成提示，對話中也會自動插入研究摘要與下載連結。' },
        ],
      },
      {
        type: 'subsection',
        title: '資料來源選用邏輯',
        blocks: [
          { type: 'para', text: '系統依以下優先順序決定每個子問題使用哪些資料：' },
          {
            type: 'table',
            headers: ['層級', '優先', '說明'],
            rows: [
              ['子問題層級', '最高', '若子問題有設定個別 KB / API 連接器 / MCP，以子問題設定為準'],
              ['任務層級', '次高', '子問題未設定時，使用 Step 1 的整體任務資料來源'],
              ['全部 KB', '預設', '任務層級也未設定時，自動搜尋您能存取的所有知識庫'],
              ['網路搜尋', '補充', '知識庫無結果且無附件時自動觸發（需有可用的 MCP 搜尋工具）'],
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: '修改子問題並重跑（Edit & Re-run）',
        blocks: [
          { type: 'para', text: '研究完成後，若某些子問題的答案不理想，可以針對特定子問題修改後重跑，**不需要整個任務重頭來過**，其餘子問題的答案原封不動保留。' },
          {
            type: 'steps',
            items: [
              { title: '開啟頂部欄位的研究面板', desc: '點選頂部欄位的望遠鏡／研究圖示，展開已完成的研究清單' },
              { title: '點選 done 研究右側的「↺」按鈕', desc: '這會開啟 ResearchModal 的「編輯重跑」模式，直接進入 Step 2' },
              { title: '選擇要重跑的子問題', desc: '預設全部為「保留」（灰底顯示舊答案摘要）；點「↺ 重跑」按鈕標記為橘色 = 此子問題將重新執行' },
              { title: '修改問題文字 / 方向提示 / 附件 / 網搜開關（選填）', desc: '展開已標記的子問題，可修改研究方向或附加新文件' },
              { title: '點「確認並重跑」', desc: '只執行被標記的子問題，完成後自動與原有答案合併、重新整合報告、更新下載檔' },
            ],
          },
          { type: 'tip', text: '重跑完成後，聊天記錄中的研究摘要會自動更新為最新版本，下載檔也會重新生成。' },
          { type: 'note', text: '正在執行中（pending / running）的研究無法重跑，請等待當前執行完成後再操作。' },
        ],
      },
      {
        type: 'subsection',
        title: '引用前次研究作為背景知識',
        blocks: [
          { type: 'para', text: '在 Step 1 的「引用前次研究」區塊，可選擇已完成的研究（最近 20 筆）作為本次研究的背景知識。系統會自動將舊研究的摘要（約 800 字）拼接到每個子問題的背景脈絡中，適合「追蹤研究」場景，例如上季分析的延伸、議題的持續追蹤。' },
          { type: 'note', text: '「引用前次研究」與「修改子問題重跑」是兩個不同功能：引用是把舊摘要當背景知識，讓新研究有延續性；重跑是直接修改舊研究中不滿意的子問題，在原有報告上更新。' },
        ],
      },
      {
        type: 'subsection',
        title: '研究歷史與下載',
        blocks: [
          { type: 'para', text: '點選頂部欄位的研究圖示可展開研究面板，顯示最近 10 筆研究任務的狀態與操作。' },
          {
            type: 'table',
            headers: ['狀態', '圖示', '說明'],
            rows: [
              ['pending', '藍色 Sparkles ✦', 'AI 尚未開始，通常在數秒內轉為執行中'],
              ['running', '藍色進度條', '正在逐步研究子問題，進度條顯示 N/M 步'],
              ['done', '綠色 ✓', '報告已生成，點連結即可下載各格式檔案'],
              ['failed', '紅色 ⚠', '發生錯誤，錯誤訊息顯示於下方，可點 ↺ 重跑嘗試修復'],
            ],
          },
          { type: 'para', text: '每筆研究右側有兩個按鈕：' },
          {
            type: 'list',
            items: [
              '（橘色）↺ 編輯並重跑子問題 — 僅 done 狀態顯示',
              '（灰色）✕ 刪除此研究任務及其下載檔',
            ],
          },
        ],
      },
      {
        type: 'subsection',
        title: 'Token 消耗說明',
        blocks: [
          { type: 'para', text: '深度研究使用 Gemini Pro 模型，Token 消耗明顯高於一般對話，請依實際需求選擇研究深度：' },
          {
            type: 'table',
            headers: ['深度', '子問題數', '預估 Token（僅供參考）', '適用場景'],
            rows: [
              ['快速', '2', '約 5 k–15 k', '簡單問題、快速了解概況'],
              ['標準', '5', '約 15 k–40 k', '大多數一般調查需求'],
              ['深入', '8', '約 30 k–70 k', '複雜議題、需多角度驗證'],
              ['全面', '12', '約 50 k–120 k', '大型研究報告、需窮舉各面向'],
            ],
          },
          { type: 'note', text: '若有管理員設定的每日 / 每週 Token 使用上限，深度研究也受此限制。上限剩餘量可在聊天頁面頂部的金額提示區查看。' },
        ],
      },
    ],
  },
];
