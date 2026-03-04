import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, MessageSquare, Upload, History, Copy, Download,
  User, Users, CalendarClock, BarChart3, DollarSign, Shield,
  AlertTriangle, Database, Mail, Cpu, Zap, Settings, BookOpen,
  ChevronRight, Info, Lightbulb, Terminal, Globe, RefreshCw,
  Wand2, ImageIcon, Clock, Share2, GitFork, Lock,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// ── Reusable layout helpers ───────────────────────────────────────────────────

function Section({
  id, icon, iconColor, title, children,
}: { id: string; icon: React.ReactNode; iconColor: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-6">
      <div className={`flex items-center gap-3 mb-5 pb-3 border-b-2 ${iconColor.replace('text-', 'border-')}`}>
        <div className={`${iconColor} flex-shrink-0`}>{icon}</div>
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <ChevronRight size={16} className="text-blue-400" />
        {title}
      </h3>
      <div className="pl-5 space-y-3">{children}</div>
    </div>
  )
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-600 text-sm leading-7">{children}</p>
}

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
      <Lightbulb size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
      <p className="text-blue-700 text-sm leading-6">{children}</p>
    </div>
  )
}

function NoteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
      <Info size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
      <p className="text-amber-700 text-sm leading-6">{children}</p>
    </div>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto">
      <pre className="text-sm text-slate-300 font-mono leading-7 whitespace-pre-wrap">{children}</pre>
    </div>
  )
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    blue:   'bg-blue-100 text-blue-700 border-blue-200',
    green:  'bg-green-100 text-green-700 border-green-200',
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
    gray:   'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[color] || styles.gray} mr-1.5`}>
      {children}
    </span>
  )
}

function StepItem({ num, title, desc }: { num: number; title: string; desc?: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5">
        {num}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-700">{title}</p>
        {desc && <p className="text-xs text-slate-500 mt-0.5 leading-5">{desc}</p>}
      </div>
    </div>
  )
}

function TableRow({ cols, header }: { cols: string[]; header?: boolean }) {
  const Cell = header ? 'th' : 'td'
  return (
    <tr className={header ? 'bg-slate-100' : 'border-t border-slate-100 hover:bg-slate-50'}>
      {cols.map((c, i) => (
        <Cell key={i} className={`px-4 py-2.5 text-sm text-left ${header ? 'font-semibold text-slate-600' : 'text-slate-600'}`}>
          {c}
        </Cell>
      ))}
    </tr>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead><TableRow cols={headers} header /></thead>
        <tbody>{rows.map((r, i) => <TableRow key={i} cols={r} />)}</tbody>
      </table>
    </div>
  )
}

// ── User Manual content ───────────────────────────────────────────────────────

const userSections = [
  { id: 'u-intro',   label: '系統介紹',       icon: <BookOpen size={18} /> },
  { id: 'u-login',   label: '登入與登出',     icon: <User size={18} /> },
  { id: 'u-ui',      label: '介面導覽',       icon: <Settings size={18} /> },
  { id: 'u-chat',    label: '開始對話',       icon: <MessageSquare size={18} /> },
  { id: 'u-model',   label: '選擇 AI 模型',  icon: <Cpu size={18} /> },
  { id: 'u-upload',  label: '上傳檔案',       icon: <Upload size={18} /> },
  { id: 'u-history',  label: '對話歷史',       icon: <History size={18} /> },
  { id: 'u-tools',    label: '可用工具',       icon: <Terminal size={18} /> },
  { id: 'u-schedule', label: '自動排程功能',  icon: <Clock size={18} /> },
  { id: 'u-image',    label: '圖片生成與修圖', icon: <ImageIcon size={18} /> },
  { id: 'u-output',   label: '複製與下載',    icon: <Download size={18} /> },
  { id: 'u-share',    label: '分享對話',      icon: <Share2 size={18} /> },
  { id: 'u-budget',   label: '使用金額提示',  icon: <DollarSign size={18} /> },
]

function UserManual() {
  return (
    <div>
      <Section id="u-intro" icon={<BookOpen size={22} />} iconColor="text-blue-500" title="系統介紹">
        <Para>
          FOXLINK GPT 是正崴精密工業內部專屬的 AI 智慧助理平台，採用 Google Gemini 大型語言模型，
          提供流暢的中英文對話、文件分析、多媒體處理及自動化排程等功能，協助同仁提升工作效率。
        </Para>
        <Table
          headers={['功能', '說明']}
          rows={[
            ['智慧對話', '支援繁體中文及英文，具備單次 Session 記憶能力'],
            ['文件分析', '可上傳 PDF、Word、Excel、PowerPoint、圖片，AI 直接閱讀內容'],
            ['音訊轉文字', '上傳語音檔，系統自動轉錄後送 AI 分析'],
            ['生成輸出', 'AI 可依指令生成 PDF、Excel、Word、PPT、TXT 供下載'],
            ['對話記錄', '所有對話永久保存，可隨時查閱歷史'],
          ]}
        />
      </Section>

      <Section id="u-login" icon={<User size={22} />} iconColor="text-indigo-500" title="登入與登出">
        <SubSection title="登入系統">
          <div className="space-y-3">
            <StepItem num={1} title="開啟瀏覽器，輸入系統網址" desc="建議使用 Chrome 或 Edge 瀏覽器以獲得最佳體驗" />
            <StepItem num={2} title="輸入工號與密碼" desc="使用您的 AD 網域帳號登入，或由系統管理員提供的本機帳號" />
            <StepItem num={3} title="點選「登入」按鈕" desc="登入成功後自動跳轉至主畫面" />
          </div>
          <TipBox>首次使用請洽系統管理員確認帳號已建立並啟用。若帳號未啟用，系統會顯示「帳號尚未啟用」提示。</TipBox>
        </SubSection>
        <SubSection title="登出系統">
          <Para>點選左側邊欄最下方的登出圖示（向左箭頭），即可安全登出。登出後 Token 立即失效，確保帳號安全。</Para>
        </SubSection>
      </Section>

      <Section id="u-ui" icon={<Settings size={22} />} iconColor="text-slate-500" title="介面導覽">
        <Para>主畫面分為三個區域：</Para>
        <div className="grid grid-cols-1 gap-3">
          {[
            {
              color: 'bg-slate-800',
              title: '左側邊欄',
              items: ['FOXLINK GPT Logo 及品牌', '新對話按鈕', 'AI 模型選擇下拉選單', '對話歷史清單（依時間分組）', '系統管理 / 排程任務 快捷鈕（依權限顯示）', '使用者資訊及登出'],
            },
            {
              color: 'bg-blue-700',
              title: '中央對話區域',
              items: ['頂部：當前對話標題 + 停止生成按鈕', '訊息區：您的問題（右側藍色）、AI 回覆（左側白色）', '每則 AI 回覆支援懸停複製、Token 計數', '底部：訊息輸入框 + 檔案上傳按鈕'],
            },
          ].map((b) => (
            <div key={b.title} className={`${b.color} rounded-xl p-4`}>
              <p className="text-white font-semibold text-sm mb-2">{b.title}</p>
              <ul className="space-y-1">
                {b.items.map((item) => (
                  <li key={item} className="text-slate-300 text-xs flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">•</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section id="u-chat" icon={<MessageSquare size={22} />} iconColor="text-green-500" title="開始對話">
        <SubSection title="發送訊息">
          <div className="space-y-3">
            <StepItem num={1} title="點選左上角「新對話」或直接在輸入框輸入問題" />
            <StepItem num={2} title="在底部輸入框輸入您的問題或需求" desc="支援多行輸入，按 Shift + Enter 換行，按 Enter 送出" />
            <StepItem num={3} title="AI 開始即時串流回覆" desc="回覆過程中可點選停止按鈕中斷生成" />
          </div>
          <TipBox>在同一個對話 Session 中，AI 會記住前面所有的對話內容。若想重新開始不帶上下文，請點選「新對話」。</TipBox>
        </SubSection>
        <SubSection title="重新生成">
          <Para>滑鼠移到 AI 最後一則回覆上，點選重新整理圖示，系統會以相同問題重新生成一次回答，適合對回覆不滿意時使用。</Para>
        </SubSection>
        <SubSection title="貼上圖片">
          <Para>在輸入框中直接按 Ctrl + V 可貼上剪貼簿中的圖片，或將圖片檔案拖曳至頁面任何位置上傳。</Para>
        </SubSection>
      </Section>

      <Section id="u-model" icon={<Cpu size={22} />} iconColor="text-purple-500" title="選擇 AI 模型">
        <Para>系統提供兩種 AI 模型可切換，由左側邊欄的下拉選單選擇：</Para>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={18} className="text-blue-500" />
              <span className="font-semibold text-blue-700">Gemini Pro</span>
              <Tag color="blue">預設</Tag>
            </div>
            <ul className="text-sm text-blue-600 space-y-1">
              <li>• 高精度、深度思考能力</li>
              <li>• 適合複雜分析、報告撰寫</li>
              <li>• 長文件處理、多步驟推理</li>
              <li>• 回覆速度相對較慢</li>
            </ul>
          </div>
          <div className="border border-yellow-200 rounded-xl p-4 bg-yellow-50">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={18} className="text-yellow-500" />
              <span className="font-semibold text-yellow-700">Gemini Flash</span>
              <Tag color="orange">快速</Tag>
            </div>
            <ul className="text-sm text-yellow-600 space-y-1">
              <li>• 回覆速度極快</li>
              <li>• 適合簡短問答、快速翻譯</li>
              <li>• 音訊轉錄使用此模型</li>
              <li>• Token 成本較低</li>
            </ul>
          </div>
        </div>
        <NoteBox>模型選擇會保存在您的瀏覽器，下次開啟仍會維持您上次的選擇。切換模型不會影響當前對話的歷史記錄。</NoteBox>
      </Section>

      <Section id="u-upload" icon={<Upload size={22} />} iconColor="text-teal-500" title="上傳檔案">
        <SubSection title="支援格式">
          <Table
            headers={['類型', '支援格式', '說明']}
            rows={[
              ['文件', 'PDF、DOCX、XLSX、PPTX、TXT、CSV', 'AI 直接讀取文件內容進行分析'],
              ['圖片', 'JPG、PNG、GIF、WEBP', 'AI 可辨識圖片中的文字與內容'],
              ['音訊', 'MP3、WAV、M4A、OGG、FLAC', '自動轉錄為文字後送 AI 分析'],
            ]}
          />
          <NoteBox>不支援上傳影片檔案。單檔最大限制為 50MB（依管理員設定可能有所不同）。</NoteBox>
        </SubSection>
        <SubSection title="上傳方式">
          <div className="space-y-2">
            {[
              { method: '點選迴紋針圖示', desc: '輸入框右側的迴紋針按鈕，點選後選擇本機檔案，可同時選取多個檔案' },
              { method: '拖曳上傳', desc: '直接將檔案拖曳到頁面任何位置，頁面出現藍色框時放開即可' },
              { method: '貼上圖片', desc: '複製圖片後在輸入框按 Ctrl + V' },
            ].map((m) => (
              <div key={m.method} className="flex gap-3 p-3 bg-slate-50 rounded-lg">
                <Tag color="blue">{m.method}</Tag>
                <span className="text-sm text-slate-600">{m.desc}</span>
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

      <Section id="u-history" icon={<History size={22} />} iconColor="text-orange-500" title="對話歷史">
        <Para>
          所有對話均永久保存於伺服器端，與瀏覽器無關。左側邊欄依時間分組顯示歷史對話（今天、昨天、過去 7 天、更早）。
        </Para>
        <SubSection title="查看歷史">
          <Para>點選左側邊欄任意一條對話標題，即可重新開啟該對話並查看完整的問答記錄。</Para>
        </SubSection>
        <SubSection title="刪除對話">
          <Para>
            滑鼠移到對話標題上，右側會出現垃圾桶圖示，點選即可刪除該對話。刪除後無法復原，請謹慎操作。
          </Para>
          <NoteBox>刪除僅影響您的對話列表視覺顯示，系統管理員的稽核日誌中仍會保留此對話記錄。</NoteBox>
        </SubSection>
      </Section>

      <Section id="u-tools" icon={<Terminal size={22} />} iconColor="text-cyan-500" title="可用工具">
        <Para>
          系統管理員可為 FOXLINK GPT 整合外部工具，讓 AI 在對話中自動取用企業內部資料或知識庫。
          您可以在左側邊欄的「可用工具」區塊查看目前啟用中的工具清單，了解 AI 具備哪些延伸能力。
        </Para>

        <SubSection title="查看可用工具">
          <Para>登入後，左側邊欄的模型選擇器下方會出現「可用工具」摺疊列，顯示目前系統啟用的工具數量：</Para>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-cyan-200 rounded-xl p-4 bg-cyan-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔌</span>
                <span className="font-semibold text-cyan-700 text-sm">MCP 工具</span>
                <Tag color="blue">藍色標籤</Tag>
              </div>
              <p className="text-xs text-cyan-600 leading-5">
                連接外部系統的即時查詢工具，例如 ERP 資料庫查詢、Oracle 程式搜尋等。
                AI 在判斷需要時會自動呼叫，您不需要手動觸發。
              </p>
            </div>
            <div className="border border-yellow-200 rounded-xl p-4 bg-yellow-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📚</span>
                <span className="font-semibold text-yellow-700 text-sm">DIFY 知識庫</span>
                <Tag color="orange">黃色標籤</Tag>
              </div>
              <p className="text-xs text-yellow-600 leading-5">
                企業內部文件知識庫，例如產品規格、SOP 手冊。
                每次對話時自動查詢，找到相關內容則注入給 AI 作為回答依據。
              </p>
            </div>
          </div>
          <Para>點選「可用工具」標題列可展開或收合工具清單，查看每個工具的名稱與功能說明。</Para>
        </SubSection>

        <SubSection title="如何善用工具">
          <div className="space-y-3">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <p className="text-xs text-slate-400 mb-2 font-medium">MCP 工具使用範例（ERP 查詢）</p>
              <div className="space-y-1.5">
                {[
                  '「搜尋 WIP 相關的 Oracle 程式有哪些？」',
                  '「FL_MOA_B2_WIP_DETAIL_P 這支程式是誰寫的？」',
                  '「查 WIP_DISCRETE_JOBS 這張資料表被哪些程式使用？」',
                ].map((q, i) => (
                  <div key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="text-blue-400">•</span>{q}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <p className="text-xs text-slate-400 mb-2 font-medium">DIFY 知識庫使用範例（產品規格）</p>
              <div className="space-y-1.5">
                {[
                  '「FL-X100 連接器的最大電流規格是多少？」',
                  '「查詢產品 BOM 結構中 PN12345 的規格」',
                  '「生產 SOP 中關於焊接溫度的規定是什麼？」',
                ].map((q, i) => (
                  <div key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="text-yellow-400">•</span>{q}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <TipBox>AI 會根據您的問題內容自動判斷是否需要查詢工具，您只需要像平常一樣提問即可，不需要特殊指令。若沒有看到「可用工具」列表，表示目前尚未整合任何工具，可洽管理員設定。</TipBox>
        </SubSection>
      </Section>

      <Section id="u-schedule" icon={<Clock size={22} />} iconColor="text-green-500" title="自動排程功能">
        <Para>
          排程任務可讓系統在指定時間自動執行 AI 分析，並將結果以 Email 寄送給您，或生成 PDF、Excel 等檔案供下載。
          適合每日新聞摘要、匯率通知、定期報表等重複性需求，完全不需要人工操作。
        </Para>
        <NoteBox>排程任務功能需由系統管理員開啟權限後才能使用。若左側邊欄看不到「排程任務」按鈕，請洽管理員申請。</NoteBox>

        <SubSection title="建立我的第一個排程">
          <div className="space-y-3">
            <StepItem num={1} title="點選左側邊欄「排程任務」" desc="進入排程任務管理頁面" />
            <StepItem num={2} title="點選「新增任務」按鈕" />
            <StepItem num={3} title="填寫任務名稱與執行時間" desc="選擇每日、每週或每月，並設定幾點幾分執行" />
            <StepItem num={4} title="撰寫 AI Prompt（問題內容）" desc="告訴 AI 要做什麼，可以加入特殊語法讓 AI 抓取即時資料" />
            <StepItem num={5} title="填入 Email 收件地址" desc="AI 完成後自動寄報告給您" />
            <StepItem num={6} title="儲存並啟用" desc="狀態設為「執行中」即完成" />
          </div>
        </SubSection>

        <SubSection title="Prompt 中的自動變數">
          <Para>在 Prompt 裡可以使用以下變數，系統執行時會自動帶入當天的實際值：</Para>
          <Table
            headers={['寫法', '執行時替換為', '範例']}
            rows={[
              ['{{date}}', '執行當天日期', '2026-03-01'],
              ['{{weekday}}', '執行當天星期幾', '星期六'],
              ['{{task_name}}', '您設定的任務名稱', '台股日報'],
            ]}
          />
          <div className="bg-slate-900 rounded-xl p-4 mt-3">
            <p className="text-xs text-slate-500 mb-2 font-mono">Prompt 範例</p>
            <pre className="text-sm text-slate-300 font-mono leading-7 whitespace-pre-wrap">{`今天是 {{date}}（{{weekday}}），
請為「{{task_name}}」撰寫今日工作提醒摘要。`}</pre>
          </div>
        </SubSection>

        <SubSection title="抓取即時網路資料">
          <Para>
            排程 Prompt 支援兩種方式讓 AI 自動抓取最新資料，不需要您手動複製貼上：
          </Para>
          <div className="space-y-4">
            <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
              <div className="flex items-center gap-2 mb-2">
                <Terminal size={15} className="text-blue-500" />
                <span className="font-semibold text-blue-700 text-sm">抓取 API 或 RSS Feed</span>
                <Tag color="blue">fetch</Tag>
              </div>
              <p className="text-blue-600 text-sm mb-3">適合新聞 API、RSS 訂閱、政府開放資料等直接回傳 JSON/XML 的網址</p>
              <div className="bg-blue-900 rounded-lg p-3">
                <pre className="text-xs text-blue-200 font-mono leading-6 whitespace-pre-wrap">{`{{fetch:https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=10}}`}</pre>
              </div>
            </div>

            <div className="border border-green-200 rounded-xl p-4 bg-green-50">
              <div className="flex items-center gap-2 mb-2">
                <Globe size={15} className="text-green-500" />
                <span className="font-semibold text-green-700 text-sm">抓取一般網頁</span>
                <Tag color="green">scrape</Tag>
              </div>
              <p className="text-green-600 text-sm mb-3">適合一般新聞文章、銀行匯率頁、供應商官網公告等 HTML 網頁</p>
              <div className="bg-green-900 rounded-lg p-3">
                <pre className="text-xs text-green-200 font-mono leading-6 whitespace-pre-wrap">{`{{scrape:https://rate.bot.com.tw/xrt?Lang=zh-TW}}`}</pre>
              </div>
            </div>
          </div>
          <TipBox>同一個 Prompt 可以同時使用多個 fetch 和 scrape，AI 會將所有資料一起分析。</TipBox>
        </SubSection>

        <SubSection title="讓 AI 生成可下載的檔案">
          <Para>
            在 Prompt 末尾指示 AI 將報告輸出為特定格式，系統會自動生成檔案並附在 Email 中：
          </Para>
          <Table
            headers={['檔案格式', '寫法範例']}
            rows={[
              ['PDF 報告', 'generate_pdf:報告名稱_{{date}}.pdf'],
              ['Excel 表格', 'generate_xlsx:報告名稱_{{date}}.xlsx'],
              ['Word 文件', 'generate_docx:報告名稱_{{date}}.docx'],
              ['PowerPoint', 'generate_pptx:報告名稱_{{date}}.pptx'],
              ['純文字', 'generate_txt:報告名稱_{{date}}.txt'],
            ]}
          />
          <NoteBox>以上語法須以三個反引號（```）包覆，置於 Prompt 最後，再附上報告內容說明。詳細格式請參閱系統管理員版說明書。</NoteBox>
        </SubSection>
      </Section>

      <Section id="u-image" icon={<ImageIcon size={22} />} iconColor="text-violet-500" title="圖片生成與修圖">
        <Para>
          系統支援 Gemini 圖片生成模型，可依文字描述直接生成圖片，
          也可以上傳現有圖片後請 AI 進行修改、風格轉換、局部調整等作業。
        </Para>
        <NoteBox>圖片生成功能需選擇支援圖片輸出的模型（如 Gemini Image 模型），請確認左側模型選單中有此選項，否則請洽管理員開啟。</NoteBox>

        <SubSection title="文字生圖">
          <Para>直接在對話框輸入您想要的圖片描述，AI 會依照說明生成圖片：</Para>
          <div className="space-y-3">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <p className="text-xs text-slate-400 mb-2 font-medium">Prompt 範例</p>
              <p className="text-sm text-slate-700 leading-6">
                幫我生成一張台灣風格的科技辦公室插圖，藍色調，現代感，適合用於簡報封面。
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <p className="text-xs text-slate-400 mb-2 font-medium">Prompt 範例</p>
              <p className="text-sm text-slate-700 leading-6">
                生成一個正崴精密工廠生產線的示意圖，寫實風格，畫面乾淨，橫向構圖。
              </p>
            </div>
          </div>
          <TipBox>描述越具體效果越好，可以說明風格（寫實/插畫/3D）、色調、構圖方向、使用場景。中文英文描述均可。</TipBox>
        </SubSection>

        <SubSection title="修圖：對現有圖片進行 AI 編輯">
          <Para>上傳您的圖片，再用文字告訴 AI 要怎麼修改：</Para>
          <div className="space-y-2">
            {[
              { action: '更換背景', example: '請將這張產品圖的背景換成純白色' },
              { action: '風格轉換', example: '將這張照片轉換為水彩畫風格' },
              { action: '局部修改', example: '將圖中的文字改為英文版本' },
              { action: '補充元素', example: '在圖片右下角加入 FOXLINK 公司 Logo 的位置提示' },
              { action: '調整色調', example: '將整張圖調整為偏冷藍色的科技感配色' },
            ].map((item) => (
              <div key={item.action} className="flex gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                <Tag color="purple">{item.action}</Tag>
                <span className="text-sm text-slate-600 italic">{item.example}</span>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title="多輪對話修圖">
          <Para>
            在同一個 Session 中可以連續對圖片進行多次修改，AI 會記住上一輪的圖片狀態，
            您只需要說「再把左側的人物移除」、「顏色再深一點」即可持續調整。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="上傳原始圖片，並說明第一步修改" desc="例：幫我去除圖片中的浮水印" />
            <StepItem num={2} title="AI 生成修改後的圖片" desc="檢視結果是否符合需求" />
            <StepItem num={3} title="繼續下一步修改" desc="例：好，再把背景改為漸層藍" />
            <StepItem num={4} title="滿意後下載圖片" desc="點選圖片右鍵儲存，或點選下載連結" />
          </div>
          <TipBox>若對修改結果不滿意，可點選「重新生成」按鈕，AI 會以同樣指令重新嘗試，每次結果略有差異。</TipBox>
        </SubSection>

        <SubSection title="注意事項">
          <div className="space-y-2">
            {[
              '生成圖片每次會消耗較多 Token，請注意使用量',
              '不可生成涉及真實人物肖像、政治敏感、色情暴力等內容',
              '生成的圖片版權建議用於內部使用，商業用途請確認授權規範',
              '圖片生成時間約 10-30 秒，請耐心等待，不要重複送出',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <Info size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                {item}
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

      <Section id="u-output" icon={<Download size={22} />} iconColor="text-pink-500" title="複製與下載">
        <SubSection title="複製 AI 回覆">
          <Para>
            滑鼠移到任意一則 AI 回覆上，左下角會出現複製圖示。點選後整則回覆文字（含格式）複製至剪貼簿，可直接貼入 Word 等應用程式。
          </Para>
        </SubSection>
        <SubSection title="下載生成檔案">
          <Para>
            當您要求 AI 輸出特定格式的檔案（如請幫我匯出 Excel），AI 回覆結束後會自動顯示下載連結。
            點選連結即可下載，檔案保存於伺服器，可隨時回到歷史對話重新下載。
          </Para>
          <TipBox>生成檔案的指令範例：「請將以上資料整理成 Excel 表格並輸出」、「將報告轉為 PDF 格式」。</TipBox>
        </SubSection>
      </Section>

      <Section id="u-share" icon={<Share2 size={22} />} iconColor="text-blue-500" title="分享對話">
        <Para>
          FOXLINK GPT 提供類似 ChatGPT 的對話分享功能，您可以將任何一段完整的對話建立為唯讀快照，
          並把連結分享給同事。對方只需登入即可查看，也可以選擇「繼續這段對話」複製一份到自己的帳號接著使用。
        </Para>

        <SubSection title="建立分享連結">
          <div className="space-y-3">
            <StepItem num={1} title="開啟您想分享的對話" desc="從左側邊欄點選目標對話" />
            <StepItem num={2} title="點選頂部工具列的「分享」按鈕" desc="按鈕位於對話標題右側，AI 回覆中才會顯示" />
            <StepItem num={3} title="系統建立快照並顯示分享連結" desc="彈出視窗顯示完整 URL" />
            <StepItem num={4} title="點選「複製」按鈕" desc="複製連結後貼給同事即可" />
          </div>
          <NoteBox>分享連結建立後，原始對話的後續更改不會影響快照內容。快照是獨立的複本，兩者完全分離。</NoteBox>
        </SubSection>

        <SubSection title="查看分享內容">
          <Para>
            收到分享連結的使用者點開後，需先登入系統（需有效帳號），然後可以查看完整的對話記錄。
            頁面頂部會顯示分享者名稱及建立時間。
          </Para>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Lock size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">唯讀模式</span>
              </div>
              <p className="text-xs text-slate-500 leading-5">只能查看，無法修改或繼續對話，保護原始內容不被更動。</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <GitFork size={14} className="text-blue-500" />
                <span className="text-sm font-semibold text-blue-700">繼續對話（Fork）</span>
              </div>
              <p className="text-xs text-blue-600 leading-5">點選「在我的對話繼續」，系統建立一份您專屬的對話副本，可自由接續。</p>
            </div>
          </div>
          <TipBox>Fork（繼續對話）後會在您的對話歷史出現一筆標題為「[Fork] 原始標題」的新對話，不影響原分享快照。</TipBox>
        </SubSection>

        <SubSection title="分享的圖片與檔案">
          <Para>
            分享快照建立時，對話中所有使用者上傳的圖片及 AI 生成的圖片都會複製一份到快照中，
            與原始檔案完全獨立。查看者及 Fork 使用者看到的圖片都是各自獨立的複本，互不影響。
          </Para>
          <NoteBox>若分享對話中含有文件（PDF、Word 等），文件內容已在對話時送給 AI 分析，快照中保留的是文字紀錄，不含原始檔案本身。</NoteBox>
        </SubSection>
      </Section>

      <Section id="u-budget" icon={<DollarSign size={22} />} iconColor="text-emerald-500" title="使用金額提示">
        <Para>
          若系統管理員為您的帳號設定了使用金額上限，對話頁面頂部工具列會出現金額指示器，
          顯示您目前的用量及上限，方便您掌握自己的使用狀況。
        </Para>

        <Table
          headers={['指示器顏色', '說明']}
          rows={[
            ['灰色（正常）', '目前用量在上限 80% 以內，一切正常'],
            ['橘色（接近上限）', '目前用量超過上限的 80%，請留意使用量'],
            ['紅色（已超出）', '當前週期用量已達上限，新訊息將被系統拒絕'],
          ]}
        />

        <SubSection title="週期說明">
          <Para>金額上限分為三種週期，管理員可分別設定，您可能看到一個或多個指示器：</Para>
          <Table
            headers={['週期', '重設時間', '顯示標籤']}
            rows={[
              ['每日限額', '每天凌晨 00:00 重設', '日 $已用/$上限'],
              ['每週限額', '每週一 00:00 重設', '週 $已用/$上限'],
              ['每月限額', '每月 1 日 00:00 重設', '月 $已用/$上限'],
            ]}
          />
          <NoteBox>金額計算基於 Token 用量乘以各模型定價，若管理員尚未設定模型定價，顯示金額可能為 $0.000，此情況請洽管理員確認。系統管理員帳號不受金額限制，不會顯示此指示器。</NoteBox>
        </SubSection>
      </Section>
    </div>
  )
}

// ── Admin Manual content ──────────────────────────────────────────────────────

const adminSections = [
  { id: 'a-users',     label: '使用者管理',     icon: <Users size={18} /> },
  { id: 'a-roles',     label: '角色管理',       icon: <Lock size={18} /> },
  { id: 'a-schedule',  label: '排程任務',       icon: <CalendarClock size={18} /> },
  { id: 'a-prompt',    label: '排程 Prompt 語法', icon: <Terminal size={18} /> },
  { id: 'a-generate',  label: '檔案生成語法',   icon: <Download size={18} /> },
  { id: 'a-example',   label: '完整 Prompt 範例', icon: <BookOpen size={18} /> },
  { id: 'a-tokens',    label: 'Token 與費用統計', icon: <BarChart3 size={18} /> },
  { id: 'a-audit',     label: '稽核與敏感詞',   icon: <Shield size={18} /> },
  { id: 'a-mcp',       label: 'MCP 伺服器',    icon: <Globe size={18} /> },
  { id: 'a-dify',      label: 'DIFY 知識庫',   icon: <Zap size={18} /> },
  { id: 'a-llm',       label: 'LLM 模型管理',  icon: <Cpu size={18} /> },
  { id: 'a-system',    label: '系統設定',       icon: <Settings size={18} /> },
]

function AdminManual() {
  return (
    <div>
      <Section id="a-users" icon={<Users size={22} />} iconColor="text-indigo-500" title="使用者管理">
        <Para>系統管理員可在後台的「使用者管理」頁籤進行帳號的新增、編輯與啟用/停用作業。系統支援兩種帳號建立方式：AD 網域自動同步 與 手動建立，並以「產生方式」欄位記錄各帳號的來源。</Para>

        <SubSection title="方式一：AD 網域自動同步（LDAP）">
          <Para>
            公司員工直接以 AD 網域帳號（工號/密碼）登入系統。首次登入時系統自動從 AD 讀取工號與姓名，
            在本機資料庫建立帳號記錄（產生方式 = <code className="bg-slate-100 px-1 rounded text-xs">ldap</code>），狀態自動設為「啟用」，員工無需等待管理員審核即可立即使用。
          </Para>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
            <div className="text-sm font-semibold text-blue-700 flex items-center gap-2">
              <Zap size={15} />
              AD 登入流程
            </div>
            <div className="space-y-2">
              {[
                { step: '1', text: '員工以 AD 帳號/密碼嘗試登入' },
                { step: '2', text: '系統驗證 LDAP 成功 → 自動同步工號與姓名至本機 DB，帳號直接生效' },
                { step: '3', text: '員工立即可使用系統（密碼持續使用 AD 密碼，系統不儲存）' },
              ].map(({ step, text }) => (
                <div key={step} className="flex items-start gap-3 text-sm text-slate-600">
                  <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{step}</span>
                  {text}
                </div>
              ))}
            </div>
          </div>
          <TipBox>AD 帳號的密碼由 AD 伺服器管理，系統本身不儲存也無法修改密碼。若員工離職，請在 AD 停用帳號，並在系統後台同步將帳號狀態改為「停用」。</TipBox>
          <NoteBox>若該帳號原本為手動建立（產生方式 = manual），只要使用相同帳號名稱透過 LDAP 成功登入，系統會自動將產生方式更改為 ldap，後續密碼改由 AD 管理，本機儲存的密碼失效。</NoteBox>
        </SubSection>

        <SubSection title="方式二：手動建立帳號">
          <Para>
            適用於非 AD 環境、外部合作夥伴、或特殊帳號（如部門共用帳號）。管理員直接在後台填寫所有欄位並設定密碼（產生方式 = <code className="bg-slate-100 px-1 rounded text-xs">manual</code>），帳號依啟用日期設定生效。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="進入後台，點選上方「使用者管理」頁籤" />
            <StepItem num={2} title="點選「新增使用者」按鈕" />
            <StepItem num={3} title="填寫必要欄位" desc="工號、姓名、帳號（登入用）、密碼、電子郵件、角色、啟用起始日" />
            <StepItem num={4} title="設定上傳權限與功能權限" desc="依使用者需求勾選允許的操作項目" />
            <StepItem num={5} title="點選「儲存」完成新增" />
          </div>
          <NoteBox>手動建立的帳號使用本機資料庫密碼驗證，不走 LDAP，管理員可在後台直接重設密碼。員工編號（工號）與帳號名稱在系統內均為唯一值，不可重複。</NoteBox>
        </SubSection>

        <SubSection title="角色說明">
          <Para>每個帳號須指定一個角色，決定其可操作的功能範圍：</Para>
          <Table
            headers={['角色', '可用功能', '備註']}
            rows={[
              ['系統管理員', '所有功能，含後台管理、使用者管理、Token 統計、稽核查詢、系統設定', '帳號數量建議控制在少數人'],
              ['一般使用者', 'AI 對話、檔案上傳（依上傳權限）、下載生成檔案、排程任務（依功能權限）', '一般員工使用此角色'],
            ]}
          />
        </SubSection>

        <SubSection title="上傳權限設定">
          <Para>每位使用者可獨立設定以下上傳權限，避免不必要的檔案類型上傳，由管理員在編輯頁面中控制：</Para>
          <Table
            headers={['設定項目', '說明', '預設']}
            rows={[
              ['允許上傳文字文件', '開啟後允許上傳 PDF、DOCX、XLSX、PPTX、TXT 等文件', '開啟'],
              ['允許上傳音訊', '開啟後允許上傳 MP3、WAV、M4A 等音訊（系統會自動轉文字）', '關閉'],
              ['允許上傳圖片', '開啟後允許上傳 JPG、PNG、WEBP 等圖片（含拖曳/貼上）', '開啟'],
              ['文件大小上限 (MB)', '單一文件最大允許上傳的大小；設為 0 表示使用系統預設 50MB', '0（50MB）'],
            ]}
          />
        </SubSection>

        <SubSection title="功能權限設定">
          <Para>除上傳外，部分進階功能也可依需求開放給特定使用者：</Para>
          <Table
            headers={['設定項目', '說明']}
            rows={[
              ['允許排程任務', '開啟後一般使用者也可建立、編輯及執行自動排程任務'],
            ]}
          />
          <TipBox>未來若新增其他進階功能（如 API 存取、自訂 Prompt 範本等），也會在此處統一管理。</TipBox>
        </SubSection>

        <SubSection title="帳號啟用邏輯">
          <Para>帳號須符合以下所有條件才能登入：</Para>
          <div className="space-y-2 pl-2">
            {['帳號狀態為「啟用」（LDAP 首次登入自動啟用；手動帳號由管理員設定）', '今日日期在「啟用起始日」之後', '若有設定「啟用截止日」，今日日期必須在截止日之前'].map((c) => (
              <div key={c} className="flex items-center gap-2 text-sm text-slate-600">
                <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                {c}
              </div>
            ))}
          </div>
          <NoteBox>ADMIN 帳號不走 LDAP，直接以本機資料庫密碼驗證，且不受啟用邏輯限制。管理員可隨時在後台手動停用任何帳號（包含 LDAP 帳號），停用後該帳號無法登入即便 AD 密碼正確。</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-roles" icon={<Lock size={22} />} iconColor="text-indigo-500" title="角色管理">
        <Para>
          角色（Role）是一組預設的權限與使用上限組合，可套用給多位使用者。
          建立角色後，新增或編輯使用者時只要選擇角色，系統即自動帶入該角色的所有設定值，管理效率大幅提升。
        </Para>

        <SubSection title="建立角色">
          <div className="space-y-3">
            <StepItem num={1} title="進入後台，點選「角色管理」頁籤" />
            <StepItem num={2} title="點選「新增角色」按鈕" />
            <StepItem num={3} title="填寫名稱與說明" desc="名稱為必填，同一系統不可重複" />
            <StepItem num={4} title="設定上傳與功能權限" desc="決定此角色的使用者預設可執行哪些操作" />
            <StepItem num={5} title="設定使用金額限制（選填）" desc="可設定每日、每週、每月的 USD 金額上限" />
            <StepItem num={6} title="指定預設角色（選填）" desc="勾選後，LDAP 自動建立的新帳號會套用此角色" />
            <StepItem num={7} title="指定 MCP / DIFY 知識庫（選填）" desc="限制此角色只能使用指定的工具或知識庫" />
          </div>
          <TipBox>建議為不同部門或職能分別建立角色，例如「研發工程師」（允許圖片/音訊上傳）、「業務人員」（僅允許文件上傳，月限額 $5）。</TipBox>
        </SubSection>

        <SubSection title="上傳與功能權限">
          <Table
            headers={['設定項目', '說明', '角色預設']}
            rows={[
              ['允許上傳文字文件', '開啟後允許 PDF、DOCX、XLSX、PPTX、TXT', '開啟'],
              ['文件大小上限 (MB)', '單一文件最大允許大小', '10 MB'],
              ['允許上傳音訊', '開啟後允許 MP3、WAV、M4A 等音訊，系統自動轉文字', '關閉'],
              ['音訊大小上限 (MB)', '單一音訊最大允許大小', '10 MB'],
              ['允許上傳圖片', '開啟後允許 JPG、PNG、WEBP 等圖片', '開啟'],
              ['圖片大小上限 (MB)', '單一圖片最大允許大小', '10 MB'],
              ['允許排程任務', '開啟後此角色的使用者可建立自動排程', '關閉'],
            ]}
          />
          <NoteBox>使用者頁面的個別設定仍可覆蓋角色設定。選擇角色後，欄位會自動帶入角色值，管理員仍可針對個別使用者調整。</NoteBox>
        </SubSection>

        <SubSection title="使用金額限制（Budget）">
          <Para>
            可為角色設定 USD 金額上限，旗下所有使用者共享此限制邏輯（各自獨立計算，非共用額度）。
            若使用者有個別設定，則以個別設定優先。
          </Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['每日限額 (USD)', '使用者每天可消耗的最高費用，超出後當日訊息被拒絕', '0.05'],
              ['每週限額 (USD)', '使用者每週一至週日可消耗的最高費用', '0.20'],
              ['每月限額 (USD)', '使用者每月 1 日至月底可消耗的最高費用', '0.50'],
            ]}
          />
          <TipBox>留空代表不設限。建議先觀察實際使用量再決定限額，避免設太低導致正常使用受阻。金額計算需依賴 LLM 模型定價設定，若尚未設定定價則限額無效。</TipBox>
        </SubSection>

        <SubSection title="預設角色">
          <Para>
            將角色設為「預設角色」後，透過 LDAP（AD 帳號）首次登入系統自動建立的帳號，
            會自動套用此角色的所有設定值（上傳權限、功能權限、金額限制）。
            每次只能有一個角色被設為預設。
          </Para>
          <NoteBox>若沒有設定預設角色，LDAP 自動建立的帳號會使用系統預設值（允許文件與圖片上傳，無金額限制）。建議設定一個基礎的預設角色，確保新員工一進來就有適當的限制。</NoteBox>
        </SubSection>

        <SubSection title="套用角色給使用者">
          <Para>
            在「使用者管理」編輯帳號時，下拉選單選擇角色後，
            系統會自動將角色的所有設定值帶入各欄位，管理員可視需求再微調。
            角色更動後，需手動更新每位使用者的設定才會生效（角色設定本身不會自動推送給已套用的帳號）。
          </Para>
        </SubSection>

        <SubSection title="MCP 伺服器與 DIFY 知識庫綁定">
          <Para>
            可為角色勾選允許使用的 MCP 伺服器和 DIFY 知識庫。此角色的使用者對話時，
            AI 只能存取這些已授權的工具，未勾選的工具不會出現在其對話中。
          </Para>
          <NoteBox>若角色未綁定任何 MCP / DIFY，系統預設讓所有已啟用的工具對使用者可見。建議明確綁定，以避免機密知識庫意外對不相關部門開放。</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-schedule" icon={<CalendarClock size={22} />} iconColor="text-green-500" title="排程任務">
        <Para>
          排程任務功能讓系統自動在指定時間執行 AI 分析，並將結果以 Email 寄送給指定收件人，
          或生成檔案供下載。適合定期報表、新聞摘要、匯率通知等場景。
        </Para>
        <SubSection title="建立排程">
          <div className="space-y-3">
            <StepItem num={1} title="點選左側邊欄「排程任務」或後台頁籤" />
            <StepItem num={2} title="點選「新增任務」按鈕" />
            <StepItem num={3} title="填寫基本設定" desc="任務名稱、使用模型（Pro/Flash）、執行週期" />
            <StepItem num={4} title="撰寫 Prompt" desc="可使用特殊語法動態抓取資料（詳見下一節）" />
            <StepItem num={5} title="設定輸出類型" desc="純文字回覆 或 生成檔案（PDF/Excel 等）" />
            <StepItem num={6} title="設定 Email 通知" desc="選填，填入收件人信箱，AI 回覆完成後自動寄送" />
            <StepItem num={7} title="啟用任務" desc="儲存後確認狀態為「執行中」" />
          </div>
        </SubSection>
        <SubSection title="執行週期設定">
          <Table
            headers={['類型', '說明', '範例']}
            rows={[
              ['每日', '每天在指定時間執行', '每天 08:00'],
              ['每週', '每週某天的指定時間執行', '每週一 09:00'],
              ['每月', '每月某日的指定時間執行', '每月 1 日 07:30'],
            ]}
          />
          <TipBox>排程使用台灣時區（Asia/Taipei）。可設定最多執行次數或截止日期，到達上限後自動暫停。</TipBox>
        </SubSection>
      </Section>

      <Section id="a-prompt" icon={<Terminal size={22} />} iconColor="text-cyan-500" title="排程 Prompt 語法">
        <Para>
          在撰寫排程任務的 Prompt 時，可使用特殊雙大括號語法，讓系統在執行時自動替換為當前資料。
        </Para>

        <SubSection title="基本變數">
          <Table
            headers={['語法', '替換為', '範例輸出']}
            rows={[
              ['{{date}}', '執行當日日期', '2026-03-01'],
              ['{{weekday}}', '執行當日星期', '星期六'],
              ['{{task_name}}', '任務名稱', '台股日報'],
            ]}
          />
          <CodeBlock>{`您好，今天是 {{date}}（{{weekday}}）。
請根據以下資料為「{{task_name}}」提供分析報告。`}</CodeBlock>
        </SubSection>

        <SubSection title="抓取 API 資料：{{fetch:網址}}">
          <Para>
            用於抓取 JSON 格式的 API、RSS Feed、XML 資料來源。系統會將回傳的原始資料直接嵌入 Prompt 中供 AI 分析。
          </Para>
          <div className="flex items-center gap-2 mb-3">
            <Tag color="blue">適用場景</Tag>
            <span className="text-sm text-slate-600">JSON API、RSS 新聞 Feed、XML 匯率資料</span>
          </div>
          <CodeBlock>{`{{fetch:https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=10}}

{{fetch:https://www.rss-news.com/feed.xml}}`}</CodeBlock>
          <NoteBox>fetch 語法適用於伺服器端直接回傳結構化資料的網址，例如各大新聞台的 RSS Feed 或開放資料 API。</NoteBox>
        </SubSection>

        <SubSection title="抓取一般網頁：{{scrape:網址}}">
          <Para>
            用於抓取一般新聞頁面、供應商官網、公告頁等普通 HTML 網頁。系統使用智慧內容萃取技術，
            自動過濾導覽列、廣告、頁尾等雜訊，僅保留文章主體、標題及作者。
          </Para>
          <div className="flex items-center gap-2 mb-3">
            <Tag color="green">適用場景</Tag>
            <span className="text-sm text-slate-600">新聞頁面、官網公告、供應商資訊頁</span>
          </div>
          <CodeBlock>{`{{scrape:https://www.cna.com.tw/news/afe/202503010001.aspx}}

{{scrape:https://rate.bot.com.tw/xrt?Lang=zh-TW}}`}</CodeBlock>
          <NoteBox>
            若目標網站是 React/Vue 等 JavaScript 渲染的單頁應用（SPA），scrape 可能無法完整取得內容，
            此時系統會回退至基本文字萃取並在日誌中記錄警告。
          </NoteBox>
        </SubSection>

        <SubSection title="fetch vs. scrape 選擇指南">
          <Table
            headers={['網址特徵', '建議使用']}
            rows={[
              ['/api/、/v1/、.json 結尾', '{{fetch:網址}}'],
              ['RSS/Atom Feed（.xml 或 /feed）', '{{fetch:網址}}'],
              ['一般新聞文章頁', '{{scrape:網址}}'],
              ['銀行匯率表、官網公告頁', '{{scrape:網址}}'],
              ['供應商產品頁、官網首頁', '{{scrape:網址}}'],
            ]}
          />
        </SubSection>

        <SubSection title="同一 Prompt 混合使用">
          <Para>可在同一個 Prompt 中同時使用多個 fetch 和 scrape，系統會依序抓取後全部嵌入。</Para>
          <CodeBlock>{`請根據以下資料整理今日財經報告：

【台股即時新聞 JSON】
{{fetch:https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=10}}

【台灣銀行即時匯率】
{{scrape:https://rate.bot.com.tw/xrt?Lang=zh-TW}}

請分析今日市場動態，並預測明日走勢。`}</CodeBlock>
        </SubSection>
      </Section>

      <Section id="a-generate" icon={<Download size={22} />} iconColor="text-purple-500" title="檔案生成語法">
        <Para>
          在排程任務的 Prompt 中，可要求 AI 在回覆結束後，將指定內容輸出為特定格式的檔案。
          AI 回覆中只要包含特殊的程式碼區塊，系統就會自動在伺服器端生成該檔案，並附於 Email 中或顯示下載連結。
        </Para>

        <SubSection title="生成語法格式">
          <Para>在 Prompt 中告知 AI 使用以下格式輸出，語法必須以三個反引號包覆：</Para>
          <Table
            headers={['格式', '語法', '說明']}
            rows={[
              ['PDF', 'generate_pdf:檔名.pdf', '純文字報告、純文字內容輸出為 PDF'],
              ['Excel', 'generate_xlsx:檔名.xlsx', '表格資料輸出為 Excel（支援多欄位）'],
              ['Word', 'generate_docx:檔名.docx', '文件、報告輸出為 Word 格式'],
              ['PowerPoint', 'generate_pptx:檔名.pptx', '簡報大綱輸出為 PowerPoint'],
              ['文字檔', 'generate_txt:檔名.txt', '純文字輸出，適合 log 或通知'],
            ]}
          />
        </SubSection>

        <SubSection title="檔名動態變數">
          <Para>檔名中也支援 date、weekday 等變數，讓每次執行產生不同日期的檔案名稱：</Para>
          <CodeBlock>{`generate_pdf:財經日報_{{date}}.pdf
generate_xlsx:月報_{{date}}.xlsx`}</CodeBlock>
        </SubSection>

        <SubSection title="在 Prompt 中指示 AI 使用語法">
          <Para>在 Prompt 末尾加入以下指示，AI 就會依格式輸出檔案生成代碼：</Para>
          <CodeBlock>{`撰寫完畢後，請以下列格式輸出 PDF 檔，將完整報告文字放入代碼塊內：

generate_pdf:財經新聞摘要_{{date}}.pdf
（完整報告文字放在此處）`}</CodeBlock>
          <NoteBox>
            Excel 和 PowerPoint 的格式要求 AI 輸出 CSV 或特定 JSON 結構。
            PDF 和 Word 則是直接將文字內容轉換，CJK（中文）字元需確保伺服器已安裝對應字型。
          </NoteBox>
        </SubSection>
      </Section>

      <Section id="a-example" icon={<BookOpen size={22} />} iconColor="text-rose-500" title="完整 Prompt 範例">
        <SubSection title="範例一：台股新聞日報（每日 08:00）">
          <CodeBlock>{`請根據以下台股最新新聞 JSON 資料，整理今日財經新聞摘要報告：

{{fetch:https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=10}}

重要提示：
JSON 每筆新聞含有 newsId（數字）、title（標題）、summary（摘要）欄位
每則新聞完整連結格式為：https://news.cnyes.com/news/id/{newsId}（請用實際 newsId 取代）

請撰寫完整今日台股新聞摘要，格式如下（純文字，不使用 # * ** 等符號）：

【今日重要個股動態】
逐一列出所有新聞，每則格式：
標題 ( 連結 )：一至兩句重點摘要

【整體市場情緒】
偏多/偏空/中立，說明原因 2-3 句。

撰寫完畢後，請以下列格式輸出 PDF 檔：

generate_pdf:財經新聞摘要_{{date}}.pdf
（完整報告文字）`}</CodeBlock>
        </SubSection>

        <SubSection title="範例二：匯率日報（每日 09:00，混合 fetch + scrape）">
          <CodeBlock>{`今天是 {{date}}（{{weekday}}），請根據以下即時資料整理外幣匯率報告：

【台灣銀行匯率】
{{scrape:https://rate.bot.com.tw/xrt?Lang=zh-TW}}

請整理主要幣別（USD、EUR、JPY、CNY）的即期買入/賣出匯率，
並與昨日相比說明升貶幅度，最後給出今日換匯建議。

generate_pdf:匯率日報_{{date}}.pdf
（完整報告文字）`}</CodeBlock>
        </SubSection>

        <SubSection title="範例三：供應商公告監控（每週一 08:30）">
          <CodeBlock>{`請檢視以下供應商官網，摘要本週最新公告或動態：

【供應商 A 最新消息】
{{scrape:https://www.supplier-a.com/news}}

【供應商 B 最新公告】
{{scrape:https://www.supplier-b.com/announcements}}

請列出各供應商本週重要動態，若無新消息請說明。
格式：供應商名稱 — 動態摘要（一至兩句）

generate_txt:供應商週報_{{date}}.txt
（完整報告）`}</CodeBlock>
        </SubSection>
      </Section>

      <Section id="a-tokens" icon={<BarChart3 size={22} />} iconColor="text-blue-500" title="Token 與費用統計">
        <Para>
          系統每日自動彙整每位使用者在每個 LLM 模型上消耗的 Token 數量，方便管理員掌握使用量與費用。
        </Para>
        <SubSection title="查詢方式">
          <div className="space-y-3">
            <StepItem num={1} title="進入後台，點選「Token 統計」頁籤" />
            <StepItem num={2} title="選擇查詢日期區間及使用者（可不篩選看全部）" />
            <StepItem num={3} title="查看每日每人每模型的輸入/輸出 Token 明細" />
          </div>
        </SubSection>
        <SubSection title="費用分析">
          <Para>
            點選「費用統計及分析」頁籤，系統會根據各 LLM 模型的定價自動計算每日費用。
            定價設定請至「LLM 模型設定」頁籤調整（單位：USD per 1M tokens）。
          </Para>
        </SubSection>
        <Table
          headers={['欄位', '說明']}
          rows={[
            ['日期', '使用日期（台灣時區）'],
            ['使用者', '工號 + 姓名'],
            ['模型', 'Pro 或 Flash'],
            ['輸入 Token', '送給 AI 的提示詞 Token 數（含對話歷史）'],
            ['輸出 Token', 'AI 生成回覆的 Token 數'],
          ]}
        />
      </Section>

      <Section id="a-audit" icon={<Shield size={22} />} iconColor="text-red-500" title="稽核與敏感詞">
        <SubSection title="稽核日誌">
          <Para>
            系統記錄所有對話的完整內容，供合規稽核使用。管理員可在「稽核日誌」頁籤搜尋任意使用者、
            時間範圍的對話記錄，並查看是否命中敏感詞。
          </Para>
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['使用者', '發送訊息的使用者工號及姓名'],
              ['時間', '訊息發送時間'],
              ['內容預覽', '對話內容前 200 字'],
              ['敏感詞命中', '是否包含敏感詞彙（紅色標示）'],
              ['已通知管理員', '敏感詞觸發時是否已寄出通知信'],
            ]}
          />
        </SubSection>
        <SubSection title="敏感詞管理">
          <Para>
            在「敏感詞彙」頁籤可新增或刪除敏感詞。當使用者訊息包含任一敏感詞時，系統會：
          </Para>
          <div className="space-y-2 pl-2">
            {[
              '在稽核日誌中標記為敏感訊息',
              '記錄命中的具體詞彙',
              '自動發送 Email 通知所有系統管理員',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
          <TipBox>建議定期檢視稽核日誌並更新敏感詞清單，以因應新興合規需求。</TipBox>
        </SubSection>
      </Section>

      <Section id="a-mcp" icon={<Globe size={22} />} iconColor="text-cyan-500" title="MCP 伺服器管理">
        <Para>
          MCP（Model Context Protocol）是一種標準通訊協定，讓 FOXLINK GPT 的 AI 對話可以即時呼叫外部工具伺服器，
          擴充 AI 的能力範圍，例如查詢 ERP 資料庫、呼叫企業內部 API、執行自動化腳本等。
        </Para>

        <SubSection title="MCP 是什麼？">
          <Para>
            一般情況下 AI 只能回答文字問題。透過 MCP 伺服器，AI 可以在對話中自動決定是否呼叫工具，
            取得即時資料後再整合到回覆中。例如：使用者問「查一下工單 WO12345 的狀態」，
            AI 會自動呼叫 ERP 查詢工具取得資料，再用自然語言回答。
          </Para>
          <div className="bg-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-2">對話範例</p>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Tag color="blue">使用者</Tag>
                <span className="text-slate-300 text-sm">查一下 FL_MOA_B2_WIP_DETAIL_P 這支程式是誰寫的？</span>
              </div>
              <div className="flex gap-2">
                <Tag color="green">AI + MCP</Tag>
                <span className="text-slate-300 text-sm">AI 自動呼叫 search_programs 工具查詢 ERP，回傳作者及程式資訊</span>
              </div>
            </div>
          </div>
        </SubSection>

        <SubSection title="新增 MCP 伺服器">
          <div className="space-y-3">
            <StepItem num={1} title="進入後台，點選「MCP 伺服器」頁籤" />
            <StepItem num={2} title="點選「新增伺服器」按鈕" />
            <StepItem num={3} title="填寫伺服器資訊" desc="名稱（顯示用）、URL（MCP Streamable HTTP 端點）、API Key（若需驗證）" />
            <StepItem num={4} title="儲存後點選同步圖示" desc="系統會連線到 MCP 伺服器，自動取得可用工具清單" />
            <StepItem num={5} title="確認工具清單已載入" desc="展開伺服器卡片可看到工具名稱及說明" />
            <StepItem num={6} title="確認狀態為綠燈（啟用）" desc="之後 AI 對話即可自動使用這些工具" />
          </div>
        </SubSection>

        <SubSection title="設定欄位說明">
          <Table
            headers={['欄位', '必填', '說明']}
            rows={[
              ['名稱', '是', '識別用顯示名稱，例：ERP DB Search'],
              ['URL', '是', 'MCP 伺服器的 HTTP 端點，需符合 MCP Streamable HTTP 規範'],
              ['API Key', '否', '若 MCP 伺服器需要驗證，填入 Bearer Token'],
              ['說明', '否', '給管理員的備注，不影響 AI 行為'],
              ['啟用', '—', '關閉後 AI 對話不會呼叫此伺服器的工具'],
            ]}
          />
        </SubSection>

        <SubSection title="同步與管理">
          <div className="space-y-2">
            {[
              { icon: <RefreshCw size={13} />, label: '同步工具', desc: '點選同步圖示，重新從 MCP 伺服器取得最新工具清單（伺服器更新工具時需要重新同步）' },
              { icon: <Info size={13} />, label: '展開工具清單', desc: '點選伺服器卡片左側箭頭，可查看該伺服器提供的所有工具名稱及說明' },
              { icon: <Info size={13} />, label: '呼叫記錄', desc: '點選「呼叫記錄」按鈕，查看 AI 實際呼叫工具的歷史，包含成功/失敗狀態、耗時、回應預覽' },
            ].map((item, i) => (
              <div key={i} className="flex gap-3 p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-400 flex-shrink-0 mt-0.5">{item.icon}</span>
                <div>
                  <span className="text-sm font-medium text-slate-700">{item.label}：</span>
                  <span className="text-sm text-slate-500">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <NoteBox>MCP 伺服器必須部署在網路可連接的位置，且需實作 MCP Streamable HTTP 規範（/mcp 端點）。如需自行開發 MCP 伺服器，請參考 MCP 官方規範文件。</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-dify" icon={<Zap size={22} />} iconColor="text-yellow-500" title="DIFY 知識庫整合">
        <Para>
          DIFY 是正崴內部部署的知識管理平台（fldify-api.foxlink.com.tw），
          可將企業內部文件、產品規格、SOP 等資料建成向量知識庫。
          整合後，使用者在 FOXLINK GPT 對話時，AI 會自動查詢相關知識庫，
          讓回答能參考企業內部文件內容，而非僅依賴通用知識。
        </Para>

        <SubSection title="運作原理">
          <Para>
            每次使用者發送訊息時，系統同時將訊息送去查詢所有已啟用的 DIFY 知識庫，
            若找到相關內容則自動注入為 AI 的背景知識，AI 在回答時即可引用這些企業特定資訊。
          </Para>
          <div className="bg-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-3">流程示意</p>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0">1</span>
                使用者：「FL-X100 連接器的最大電流規格是多少？」
              </div>
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 bg-slate-600 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0">2</span>
                系統查詢 DIFY 知識庫，找到產品規格文件中的相關段落
              </div>
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 bg-green-600 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0">3</span>
                AI 結合知識庫內容回答：「根據產品規格書，FL-X100 最大電流為 5A...」
              </div>
            </div>
          </div>
        </SubSection>

        <SubSection title="新增 DIFY 知識庫">
          <div className="space-y-3">
            <StepItem num={1} title="在 DIFY 平台建立知識庫並取得 API Key" desc="登入 fldify-api.foxlink.com.tw，建立應用並複製 API Key（格式：app-xxxxxxxx）" />
            <StepItem num={2} title="進入 FOXLINK GPT 後台，點選「DIFY 知識庫」頁籤" />
            <StepItem num={3} title="點選「新增知識庫」按鈕" />
            <StepItem num={4} title="填寫設定欄位" desc="名稱、API Server、API Key、描述（重要）、排序順序" />
            <StepItem num={5} title="點選「測試」按鈕確認連線正常" desc="測試成功會顯示回應時間及預覽文字" />
            <StepItem num={6} title="啟用後即生效" desc="之後所有使用者對話都會自動查詢此知識庫" />
          </div>
        </SubSection>

        <SubSection title="設定欄位說明">
          <Table
            headers={['欄位', '必填', '說明']}
            rows={[
              ['名稱', '是', '識別用顯示名稱，例：產品規格知識庫'],
              ['API Server', '是', 'DIFY 的 API 端點，預設 https://fldify-api.foxlink.com.tw/v1'],
              ['API Key', '是（新增時）', 'DIFY 應用的 API Key，格式為 app-xxxxxxxx。編輯時留空表示保持不變'],
              ['描述', '建議填', '告訴 AI 這個知識庫的用途，讓 AI 更精準地判斷何時引用。例：包含產品規格、零件型號，當使用者詢問產品規格時引用'],
              ['排序順序', '否', '數字越小越優先查詢，同分時依此排序'],
              ['啟用', '—', '啟用後每次對話自動查詢，停用後不查詢但保留設定'],
            ]}
          />
          <TipBox>描述欄位非常重要：好的描述讓 AI 能判斷查詢結果的適用場景，避免引用不相關的知識庫內容，影響回答品質。</TipBox>
        </SubSection>

        <SubSection title="管理功能">
          <Table
            headers={['功能', '說明']}
            rows={[
              ['測試連線', '輸入測試查詢語句（或留空用預設），驗證 API Key 是否正確、連線是否正常'],
              ['呼叫記錄', '查看每次 AI 對話觸發知識庫查詢的歷史，可分析哪些問題有成功引用知識庫'],
              ['啟用/停用', '可臨時停用某個知識庫（例如內容更新中），不影響其他知識庫運作'],
              ['排序調整', '多個知識庫時，數字小的優先查詢，建議最常用的設為 0 或 1'],
            ]}
          />
          <NoteBox>若知識庫連線失敗（API Key 過期或網路問題），系統仍會正常回答問題，只是不會引用該知識庫的內容。建議定期點選「測試」確認連線狀態。</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-llm" icon={<Cpu size={22} />} iconColor="text-violet-500" title="LLM 模型管理">
        <Para>
          在「LLM 模型設定」頁籤，管理員可新增、編輯或停用 AI 模型選項，讓使用者在對話和排程中可選擇。
        </Para>
        <Table
          headers={['欄位', '說明']}
          rows={[
            ['識別鍵 (key)', '系統內部識別碼，用於對應 Prompt 設定（如 pro、flash）'],
            ['顯示名稱', '使用者看到的模型名稱（如 Gemini 2.0 Pro）'],
            ['API 模型 ID', 'Google Gemini 的實際 API 模型代號'],
            ['說明文字', '顯示於模型選單下方的小字說明'],
            ['啟用', '關閉後使用者無法選擇此模型，但歷史記錄不受影響'],
            ['輸入定價', '每百萬 Token 的費用（USD），用於費用統計'],
            ['輸出定價', '每百萬 Token 的費用（USD），用於費用統計'],
          ]}
        />
      </Section>

      <Section id="a-system" icon={<Settings size={22} />} iconColor="text-slate-500" title="系統設定">
        <SubSection title="郵件伺服器設定">
          <Para>
            在「郵件設定」頁籤設定 SMTP 連線資訊，系統才能傳送排程通知及敏感詞警示 Email。
          </Para>
          <Table
            headers={['設定項目', '說明']}
            rows={[
              ['SMTP 伺服器', 'SMTP 主機位址（如 smtp.gmail.com）'],
              ['連接埠', '通常為 587（TLS）或 465（SSL）'],
              ['帳號', 'SMTP 認證帳號（發信信箱）'],
              ['密碼', 'SMTP 認證密碼或應用程式密碼'],
              ['寄件者名稱', '收件人看到的寄件者顯示名稱'],
            ]}
          />
        </SubSection>
        <SubSection title="資料庫維護">
          <Para>
            在「資料庫維護」頁籤可執行以下作業，建議定期備份以防資料遺失。
          </Para>
          <Table
            headers={['功能', '說明']}
            rows={[
              ['立即備份', '將目前資料庫匯出為 SQLite 檔案並下載至本機'],
              ['還原資料庫', '上傳備份的 SQLite 檔案覆蓋目前資料庫（需重啟服務）'],
              ['自動備份', '可設定每日自動備份時間及保留份數'],
            ]}
          />
          <NoteBox>還原資料庫為破壞性操作，執行後目前的所有資料將被備份檔取代，請務必確認後再操作。</NoteBox>
        </SubSection>
      </Section>
    </div>
  )
}

// ── Main HelpPage ─────────────────────────────────────────────────────────────

type Role = 'user' | 'admin'

export default function HelpPage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const [role, setRole] = useState<Role>(isAdmin ? 'admin' : 'user')
  const contentRef = useRef<HTMLDivElement>(null)

  const sections = role === 'user' ? userSections : adminSections

  function scrollTo(id: string) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4 flex-shrink-0 shadow-sm">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition text-sm"
        >
          <ArrowLeft size={18} />
          返回
        </button>
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-blue-500" />
          <h1 className="text-lg font-bold text-slate-800">FOXLINK GPT 使用說明書</h1>
        </div>

        {/* Role tabs */}
        <div className="ml-auto flex bg-slate-100 rounded-xl p-1 gap-1">
          <button
            onClick={() => setRole('user')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              role === 'user'
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <User size={15} />
            一般使用者
          </button>
          {isAdmin && (
            <button
              onClick={() => setRole('admin')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                role === 'admin'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Settings size={15} />
              系統管理員
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left TOC */}
        <nav className="w-56 bg-white border-r border-slate-200 overflow-y-auto flex-shrink-0 py-4 px-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3">目錄</p>
          <div className="space-y-0.5">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-700 transition text-left text-sm group"
              >
                <span className="text-slate-400 group-hover:text-blue-500 flex-shrink-0">{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* Main content */}
        <main
          ref={contentRef}
          className="flex-1 overflow-y-auto"
        >
          <div className="max-w-3xl mx-auto px-8 py-8">
            {/* Role badge */}
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8 ${
              role === 'admin'
                ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                : 'bg-blue-100 text-blue-700 border border-blue-200'
            }`}>
              {role === 'admin' ? <Settings size={15} /> : <User size={15} />}
              {role === 'admin' ? '系統管理員操作手冊' : '一般使用者操作手冊'}
            </div>

            {role === 'user' ? <UserManual /> : <AdminManual />}

            {/* Footer */}
            <div className="mt-16 pt-8 border-t border-slate-200 text-center">
              <p className="text-slate-400 text-xs">FOXLINK GPT 使用說明書</p>
              <p className="text-slate-300 text-xs mt-1">如有問題請洽系統管理員</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
