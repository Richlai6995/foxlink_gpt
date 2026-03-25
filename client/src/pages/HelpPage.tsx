import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, MessageSquare, Upload, History, Copy, Download,
  User, Users, CalendarClock, BarChart3, DollarSign, Shield,
  AlertTriangle, Database, Mail, Cpu, Zap, Settings, BookOpen,
  ChevronRight, Info, Lightbulb, Terminal, Globe, RefreshCw,
  Wand2, ImageIcon, Clock, Share2, GitFork, Lock, Sparkles, Code2, Package, Play, Square,
  Paperclip, Search, Server, BookMarked, Wifi, WifiOff, CheckCircle, Loader2, Layers, Activity,
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
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    green: 'bg-green-100 text-green-700 border-green-200',
    purple: 'bg-purple-100 text-purple-700 border-purple-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
    gray: 'bg-slate-100 text-slate-600 border-slate-200',
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
  { id: 'u-intro', label: '系統介紹', icon: <BookOpen size={18} /> },
  { id: 'u-login', label: '登入與登出', icon: <User size={18} /> },
  { id: 'u-ui', label: '介面導覽', icon: <Settings size={18} /> },
  { id: 'u-chat', label: '開始對話', icon: <MessageSquare size={18} /> },
  { id: 'u-model', label: '選擇 AI 模型', icon: <Cpu size={18} /> },
  { id: 'u-upload', label: '上傳檔案', icon: <Upload size={18} /> },
  { id: 'u-history', label: '對話歷史', icon: <History size={18} /> },
  { id: 'u-tools', label: '可用工具', icon: <Terminal size={18} /> },
  { id: 'u-schedule', label: '自動排程功能', icon: <Clock size={18} /> },
  { id: 'u-image', label: '圖片生成與修圖', icon: <ImageIcon size={18} /> },
  { id: 'u-output', label: '複製與下載', icon: <Download size={18} /> },
  { id: 'u-share', label: '分享對話', icon: <Share2 size={18} /> },
  { id: 'u-skill', label: '技能 Skill', icon: <Sparkles size={18} /> },
  { id: 'u-kb', label: '知識庫市集', icon: <Database size={18} /> },
  { id: 'u-research', label: '深度研究', icon: <GitFork size={18} /> },
  { id: 'u-toolbar-toggles', label: '頂端列功能開關', icon: <Zap size={18} /> },
  { id: 'u-budget', label: '使用金額提示', icon: <DollarSign size={18} /> },
  { id: 'u-ai-bi', label: 'AI 戰情室', icon: <BarChart3 size={18} /> },
  { id: 'u-ai-bi-query', label: '命名查詢 / 報表範本', icon: <BookMarked size={18} /> },
  { id: 'u-ai-bi-field', label: 'Schema 欄位選擇器', icon: <Server size={18} /> },
  { id: 'u-ai-bi-chart', label: '即時圖表建構器', icon: <BarChart3 size={18} /> },
  { id: 'u-ai-bi-shelf', label: 'Tableau 拖拉式設計器', icon: <Layers size={18} /> },
  { id: 'u-ai-bi-dashboard', label: '儀表板 Dashboard', icon: <Share2 size={18} /> },
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

      <Section id="u-skill" icon={<Sparkles size={22} />} iconColor="text-purple-500" title="技能 Skill">
        <Para>
          技能（Skill）是可以掌載到對話的自訂模組，能讓 AI 具備特定領域的專業知識、固定指令或對接外部服務的能力。
          例如，掛載「專業術語翻譯」技能後，每次對話 AI 會自動以該行業的標準用語進行翻譯。
        </Para>

        <SubSection title="技能類型">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🧠</span>
                <span className="font-semibold text-blue-700 text-sm">內建 Prompt 技能</span>
              </div>
              <p className="text-xs text-blue-600 leading-5">
                透過 System Prompt 給 AI 加上角色設定或指引。不需要外部服務，建立簡單。
                適合：翻譯腔調、行業專家、內部 SOP 助手等。
              </p>
            </div>
            <div className="border border-purple-200 rounded-xl p-4 bg-purple-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🌐</span>
                <span className="font-semibold text-purple-700 text-sm">外部 Endpoint 技能</span>
              </div>
              <p className="text-xs text-purple-600 leading-5">
                呼叫外部 API，取得即時資料再供給 AI。
                適合：時刻查詢、即時庫存、外部知識庫對接等。
              </p>
            </div>
            <div className="border border-emerald-200 rounded-xl p-4 bg-emerald-50">
              <div className="flex items-center gap-2 mb-2">
                <Code2 size={16} className="text-emerald-600" />
                <span className="font-semibold text-emerald-700 text-sm">內部程式技能（Code）</span>
              </div>
              <p className="text-xs text-emerald-600 leading-5">
                在平台內直接撰寫 Node.js 程式碼，以獨立子程序運行。
                適合：即時股價查詢、ERP 資料對接、自動計算等需要程式邏輯的場景。
                需要管理員授予「允許程式技能」權限。
              </p>
            </div>
            <div className="border border-orange-200 rounded-xl p-4 bg-orange-50">
              <div className="flex items-center gap-2 mb-2">
                <GitFork size={16} className="text-orange-600" />
                <span className="font-semibold text-orange-700 text-sm">工作流程技能（Workflow）</span>
              </div>
              <p className="text-xs text-orange-600 leading-5">
                以 DAG（有向無環圖）視覺化編排多步驟流程，串接 LLM、知識庫、MCP 工具、HTTP 請求、條件判斷等節點。
                適合：多步驟審核流程、資料管線、複雜 AI Agent 等場景。
              </p>
            </div>
          </div>
        </SubSection>

        <SubSection title="端點模式（外部 / 程式技能適用）">
          <Table
            headers={['模式', '行為說明']}
            rows={[
              ['inject（注入）', 'Skill 執行後，將回傳的資料注入 AI 的 System Prompt，AI 再根據這份資料回答。AI 仍擁有思考空間，適合「提供背景資訊」的場景（如即時股價、庫存數據）。'],
              ['answer（直接回答）', 'Skill 執行結果直接作為最終回覆，完全略過 AI。適合需要精準固定格式輸出的場景。'],
            ]}
          />
          <TipBox>inject 模式：若使用者訊息中沒有觸發條件（如找不到股票代號），Skill 可回傳空 system_prompt，AI 會正常以 Google 搜尋或自身知識回答。</TipBox>
        </SubSection>

        <SubSection title="如何將技能掛載到對話">
          <div className="space-y-3">
            <StepItem num={1} title="前往左側邊欄的「技能市集」" desc="個人技能與公開技能均可在此瀏覽" />
            <StepItem num={2} title="點選技能卡片右下角的「💬」訿(在對話中使用)" desc="系統自動建立新對話並掛載此技能" />
            <StepItem num={3} title="或圖開對話後，點選頂部工具列的「✨ 技能」按鈕" desc="選擇要掛載的技能後點「確認掛載」" />
            <StepItem num={4} title="頂部工具列出現紫色 Badge 確認掛載成功" desc="此對話之後每次發訊都會自動套用此技能" />
          </div>
          <TipBox>可以對同一個對話掛載多個技能，效果會叠加。再次點「技能」按鈕即可修改或移除已掛載的技能。</TipBox>
        </SubSection>

        <SubSection title="建立與分享技能">
          <div className="space-y-3">
            <StepItem num={1} title="進入技能市集，點選「建立技能」" />
            <StepItem num={2} title="自行建立內建或外部技能，共享給同事" desc="廳此技能預設為私人，點選「申請公開」將申請送對管理員審核" />
            <StepItem num={3} title="審核通過後，全體員工可在公開技能區看到並使用" />
            <StepItem num={4} title="對於公開技能，可點選 Fork 則複製一份到自己帳號，再根據需要修改" />
          </div>
        </SubSection>

        <SubSection title="技能上的 MCP 工具模式">
          <Table
            headers={['模式', '說明']}
            rows={[
              ['append（追加）', '在角色已授權的工具基礎上，加入技能指定的額外伺服器工具（預設）'],
              ['exclusive（獨佔）', '僅限定使用技能指定的 MCP 伺服器，角色其他工具暫時停用'],
              ['disable（停用）', '對話期間禁用全部 MCP 工具，適合純文字對話場景'],
            ]}
          />
        </SubSection>

        <SubSection title="知識庫綁定（KB Binding）">
          <Para>
            技能可以綁定特定的自建知識庫與 DIFY 知識庫，讓掛載技能時自動啟用相關知識庫，無需使用者手動選取。
          </Para>
          <Table
            headers={['模式', '說明']}
            rows={[
              ['append（追加）', '技能綁定的知識庫與使用者已掛載的知識庫同時生效（預設）'],
              ['exclusive（獨佔）', '僅使用技能綁定的知識庫，忽略使用者自行掛載的知識庫'],
              ['disable（停用）', '對話期間不使用任何知識庫'],
            ]}
          />
          <TipBox>知識庫綁定由技能建立者在編輯頁「工具與知識庫」頁籤中設定，使用者掛載技能後自動套用。</TipBox>
        </SubSection>

        <SubSection title="TAG 自動路由">
          <Para>
            系統使用 TAG 標籤機制自動判斷每則訊息應啟用哪些工具、知識庫與技能，無需使用者手動勾選。
            每個 MCP 伺服器、DIFY 知識庫、自建知識庫及技能都可設定標籤（Tags），系統流程如下：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="使用者發送訊息" desc="系統以 Flash LLM 從訊息中萃取 0~5 個意圖標籤（intent tags）" />
            <StepItem num={2} title="TAG 比對" desc="將意圖標籤與所有工具/知識庫/技能上的標籤進行雙向模糊比對" />
            <StepItem num={3} title="描述精篩（Description Refinement）" desc="若 TAG 比對命中過多候選項，再以 Flash LLM 根據工具描述做二次精篩" />
            <StepItem num={4} title="Fallback" desc="若未設定任何 TAG 或比對全部落空，則回退到傳統的 intent 過濾機制" />
          </div>
          <TipBox>
            建議為每個工具和知識庫設定 2~5 個精準的標籤（如「股票」「財報」「ERP」），
            讓系統能更準確地自動路由，減少不必要的工具呼叫，節省 Token 費用。
          </TipBox>
        </SubSection>

        <SubSection title="Prompt 輸入變數（prompt_variables）">
          <Para>
            技能可以定義輸入變數，讓使用者在掛載技能到對話時填寫自訂參數，這些參數會自動注入到 System Prompt 中。
            例如，翻譯技能可設定「目標語言」變數，掛載時讓使用者選擇「日文」或「韓文」。
          </Para>
          <Table
            headers={['變數類型', '說明']}
            rows={[
              ['text', '單行文字輸入'],
              ['textarea', '多行文字輸入'],
              ['select', '下拉選單，需預先定義選項'],
              ['number', '數字輸入'],
              ['date', '日期選擇器'],
              ['checkbox', '布林值勾選框'],
            ]}
          />
          <Para>
            在 System Prompt 中使用 {'{{變數名稱}}'} 語法引用變數，例如：
          </Para>
          <CodeBlock>{`你是一位專業翻譯員，請將使用者的文字翻譯為 {{target_language}}。
翻譯風格：{{style}}`}</CodeBlock>
          <TipBox>掛載技能時若該技能定義了輸入變數，系統會彈出表單讓使用者填寫，填寫後的值會存在該對話的技能設定中。</TipBox>
        </SubSection>

        <SubSection title="Code 技能自動註冊為 Gemini Tool">
          <Para>
            Code 類型技能可以定義 <strong>Tool Schema</strong>（Gemini Function Declaration），
            讓 AI 在對話中自動判斷是否需要呼叫該程式技能，而非每次都觸發。
          </Para>
          <Para>
            例如，一個「股價查詢」Code 技能定義了 Tool Schema，AI 收到「台積電股價多少」時會自動呼叫，
            但收到「今天天氣如何」則不會觸發。這等同於 Gemini 的 Function Calling 機制。
          </Para>
          <NoteBox>未定義 Tool Schema 的 Code 技能仍按原有的 inject/answer 端點模式運作，不受影響。</NoteBox>
        </SubSection>

        <SubSection title="Output Schema（輸出結構定義）">
          <Para>
            技能可以定義 JSON 格式的輸出結構（Output Schema），指引 AI 以固定的 JSON 格式回覆。
            適合需要結構化資料的場景，如自動產生工單、匯出報表欄位等。
          </Para>
          <CodeBlock>{`{
  "type": "object",
  "properties": {
    "summary": { "type": "string", "description": "摘要" },
    "score": { "type": "number", "description": "評分 0-100" },
    "tags": { "type": "array", "items": { "type": "string" } }
  }
}`}</CodeBlock>
        </SubSection>

        <SubSection title="速率限制（Rate Limiting）">
          <Para>
            技能可設定使用頻率限制，防止濫用或控制 API 成本：
          </Para>
          <Table
            headers={['設定', '說明']}
            rows={[
              ['每人上限', '單一使用者在指定時間窗口內可呼叫此技能的最大次數'],
              ['全域上限', '所有使用者合計在指定時間窗口內的最大呼叫次數'],
              ['時間窗口', '限制的計算週期：每分鐘（minute）、每小時（hour）、每日（day）'],
            ]}
          />
          <TipBox>超過速率限制時，系統會回覆提示訊息，使用者需等待時間窗口重置後再使用。</TipBox>
        </SubSection>

        <SubSection title="版本控制與發佈">
          <Para>
            技能的 Prompt 支援版本控制機制，讓您可以安全地修改和回滾：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="編輯草稿（Draft）" desc="修改 Prompt 時，改動先存入草稿，不影響目前線上版本" />
            <StepItem num={2} title="發佈（Publish）" desc="確認修改無誤後，點選「發佈新版本」，草稿變為正式版本，版本號 +1" />
            <StepItem num={3} title="查看歷史版本" desc="在「版本歷史」頁籤可瀏覽所有已發佈的版本內容" />
            <StepItem num={4} title="回滾（Rollback）" desc="若新版本有問題，可一鍵回滾到任一歷史版本" />
          </div>
          <NoteBox>版本控制僅追蹤 Prompt 與 Workflow 設定的變更，其他欄位（名稱、描述等）修改後即時生效。</NoteBox>
        </SubSection>

        <SubSection title="Workflow 工作流程編排">
          <Para>
            Workflow 類型技能使用視覺化拖拉編輯器（React Flow），以 DAG 方式編排多步驟 AI 流程。
            每個節點代表一個處理步驟，節點之間以連線定義執行順序。
          </Para>
          <Table
            headers={['節點類型', '說明']}
            rows={[
              ['🟢 開始（Start）', '流程入口，接收使用者輸入'],
              ['🤖 LLM', '呼叫大語言模型處理文字，可設定 System Prompt 與模型'],
              ['📚 知識庫（Knowledge Base）', '查詢自建知識庫，取得相關段落'],
              ['🔌 DIFY', '查詢 DIFY 知識庫'],
              ['🔧 MCP 工具', '呼叫 MCP 伺服器的工具'],
              ['✨ 技能（Skill）', '呼叫其他已建立的技能'],
              ['💻 程式碼（Code）', '執行自訂 JavaScript 程式碼'],
              ['🌐 HTTP 請求', '呼叫外部 REST API'],
              ['❓ 條件判斷（Condition）', '根據前一步結果分支（contains / equals / gt / lt 等）'],
              ['📝 模板（Template）', '使用模板語法組合多個節點的輸出'],
              ['🔴 輸出（Output）', '流程終點，定義最終輸出內容'],
            ]}
          />
          <Para>
            節點之間可使用 {'{{nodeId.output}}'} 語法引用其他節點的輸出，例如 {'{{start.input}}'} 取得使用者原始訊息，
            {'{{llm_1.output}}'} 取得 LLM 節點的回應。
          </Para>
          <TipBox>Workflow 最多允許 50 個節點，執行時以拓撲排序依序處理。條件節點支援 default（符合條件）與 else（不符合）兩條分支路徑。</TipBox>
        </SubSection>
      </Section>

      <Section id="u-kb" icon={<Database size={22} />} iconColor="text-teal-500" title="知識庫市集">
        <Para>
          知識庫市集讓您可以將企業內部文件向量化，建立專屬的語意搜尋資料庫。
          對話時掛載知識庫，AI 會先從知識庫檢索最相關的段落，再結合自身能力回答，
          大幅提升對特定領域文件（如 SOP、技術手冊、規格書）的回答準確度。
        </Para>

        <SubSection title="前提條件">
          <Para>需要系統管理員授予「允許建立知識庫」權限，以及設定容量與數量上限後，才會在側邊欄「更多功能」選單看到「知識庫市集」入口。</Para>
          <TipBox>若無建立權限，仍可使用管理員或其他人共享（permission = use）給您的知識庫進行對話，無需建立自己的知識庫。</TipBox>
        </SubSection>

        <SubSection title="建立知識庫">
          <div className="space-y-3">
            <StepItem num={1} title="點選「知識庫市集」→「+ 建立知識庫」" />
            <StepItem num={2} title="填寫名稱、描述（必填名稱）" desc="建立後可在詳情頁頂部點選鉛筆圖示快速編輯名稱與描述" />
            <StepItem num={3} title="選擇 Embedding 維度" desc="768 維適合大多數情況；1536 / 3072 精度更高但費用也較高，且建立後無法更改" />
            <StepItem num={4} title="選擇分塊策略" desc="「常規分段」：依段落切分，適合一般文件；「父子分塊」：大塊作背景、小塊用來檢索，適合長篇技術文件" />
            <StepItem num={5} title="選擇檢索模式" desc="「向量檢索」：語意相似度；「全文檢索」：關鍵字比對；「混合檢索」：兩者結合（建議）" />
            <StepItem num={6} title="選擇 OCR 模型（選填）" desc="上傳文件時用來解析圖片/PDF 內圖片的 Gemini 模型，預設使用系統設定的 Flash 模型" />
            <StepItem num={7} title="點選「建立」，進入知識庫詳情頁" />
          </div>
        </SubSection>

        <SubSection title="上傳文件">
          <Para>
            進入知識庫後，點選「文件」頁籤，拖曳或點選上傳區域選擇檔案。
            支援格式：<strong>PDF · DOCX · PPTX · XLSX · TXT · CSV · JPG · PNG · GIF · WEBP</strong>（單檔最大 200 MB）。
          </Para>
          <div className="space-y-2">
            <StepItem num={1} title="選取一或多個檔案上傳" desc="多檔會循序處理，避免同時佔用 AI 配額" />
            <StepItem num={2} title="系統自動解析文字並進行 Embedding 向量化" desc="圖片與 PDF 中的圖片會先 OCR 轉文字，再一起向量化" />
            <StepItem num={3} title="狀態變為綠色勾選代表處理完成" desc="若出現紅色 ✗ 請查看錯誤訊息，常見原因：檔案格式不符或 AI 服務暫時中斷" />
          </div>
          <NoteBox>大型文件（如含大量圖片的 DOCX）處理時間可能較長，頁面每隔幾秒會自動重新整理狀態，請耐心等待。</NoteBox>
        </SubSection>

        <SubSection title="在對話中使用知識庫">
          <div className="space-y-3">
            <StepItem num={1} title="開啟或新建一個對話" />
            <StepItem num={2} title="點選頂部工具列的「知識庫」按鈕（綠色）" />
            <StepItem num={3} title="在下拉選單中勾選一或多個要使用的知識庫，點「確認」" />
            <StepItem num={4} title="發送訊息，AI 會先檢索知識庫再組合回答" desc="回覆中如有引用文件段落，AI 通常會說明來源文件名稱" />
          </div>
          <TipBox>可以同時掛載「自建知識庫」＋「DIFY 知識庫」＋「MCP 工具」，AI 會綜合所有來源回答。
            此外，若知識庫設有標籤（Tags），系統會透過 TAG 自動路由機制，根據訊息內容自動判斷是否啟用對應知識庫。</TipBox>
        </SubSection>

        <SubSection title="召回測試（檢索測試）">
          <Para>
            進入知識庫詳情 → 點選「召回測試」頁籤，輸入任意問題，系統會模擬真實對話的檢索流程，
            顯示前幾名相關段落、相似度分數及比對方式（向量 / 全文 / 混合），幫助您調整設定參數。
          </Para>
        </SubSection>

        <SubSection title="共享知識庫">
          <Para>
            進入知識庫詳情 → 點選「共享設定」頁籤，可將知識庫共享給特定使用者、角色、部門或組織單位。
          </Para>
          <Table
            headers={['共享方式', '對象']}
            rows={[
              ['使用者', '指定單一帳號'],
              ['角色', '系統管理員定義的角色群組（如研發部）'],
              ['部門', '依 ERP 組織同步的部門代碼'],
              ['利潤中心', '依利潤中心共享'],
              ['組織課室', '依課室共享'],
            ]}
          />
          <Table
            headers={['共享權限', '說明']}
            rows={[
              ['use（僅使用）', '被共享者可在對話中掛載此知識庫，但無法在知識庫市集列表中看到或進入設定頁'],
              ['edit（可編輯）', '被共享者可在市集中看到並進入此知識庫，可上傳文件、修改設定'],
            ]}
          />
        </SubSection>

        <SubSection title="申請公開">
          <Para>
            若希望全體員工都能看到並使用此知識庫，可在「共享設定」頁籤點選「申請設為公開」，
            送出申請後需等待系統管理員審核通過，審核後知識庫會對所有人開放（唯讀使用，不可編輯）。
          </Para>
        </SubSection>

        <SubSection title="分段與檢索設定調整">
          <Para>進入知識庫詳情 → 點選「分塊與檢索設定」頁籤，可隨時調整以下參數（調整後不需重新上傳文件，下次對話立即生效）：</Para>
          <Table
            headers={['參數', '說明', '建議值']}
            rows={[
              ['分段識別符號', '用來切分段落的符號', '\\n\\n（空白行）'],
              ['分段最大長度', '每個 chunk 的字元上限', '512–1024'],
              ['重疊長度', '前後 chunk 共享的字元數，避免重要資訊被截斷', '50–100'],
              ['初始擷取 Top K', '向量/全文各抓幾條候選結果', '10–20'],
              ['最終返回 Top K', '重排序後送給 AI 的最終條數', '3–5'],
              ['Score 閾值', '相似度低於此值的結果會被丟棄（0–1）', '0.3–0.5'],
              ['OCR 模型', '處理圖片的 Gemini 模型', 'Flash（快速省成本）'],
            ]}
          />
        </SubSection>

        <SubSection title="知識庫格式感知">
          <Para>
            系統會根據上傳文件的格式自動選擇最佳的解析方式，確保內容被完整擷取並向量化。
          </Para>
          <Table
            headers={['格式', '解析方式', '備註']}
            rows={[
              ['PDF', 'pdf-parse 文字層 + Gemini OCR（有圖片時）', '掃描件需 OCR，速度較慢'],
              ['DOCX / PPTX', 'JSZip 解壓縮 XML → 提取段落文字', '保留標題層級與段落結構'],
              ['XLSX / CSV', '逐列讀取，保留欄標頭', '大型表格建議先分頁再上傳'],
              ['TXT / MD', '直接讀取純文字', '保留換行結構'],
              ['JPG / PNG / WEBP / GIF', 'Gemini Vision OCR → 轉為文字 chunk', '圖片需設定 OCR 模型才會處理'],
            ]}
          />
          <TipBox>
            含大量圖表的 PDF 或 PPTX，建議在知識庫設定中指定 OCR 模型（Flash 即可），
            系統會自動對圖片頁面進行視覺理解，再合併到同一文件的文字 chunk 中。
          </TipBox>
          <NoteBox>
            XLSX 中的公式只會保留計算結果值，不保留公式本身。若需讓 AI 理解公式邏輯，請先將說明另存為 TXT 或 MD 一起上傳。
          </NoteBox>
        </SubSection>
      </Section>

      <Section id="u-research" icon={<GitFork size={22} />} iconColor="text-indigo-500" title="深度研究">
        <Para>
          「深度研究」讓 AI 針對複雜問題自動拆解成多個子問題、逐一深度調查後，整合產出完整報告。
          適合競品分析、技術評估、市場調查、法規解析等需要多角度、多來源交叉比對的場景。
          整個研究在背景非同步執行，不影響您繼續使用聊天。
        </Para>

        {/* ── 流程概覽 ── */}
        <SubSection title="三步驟流程概覽">
          <div className="grid grid-cols-1 gap-3">
            {[
              { step: 'Step 1', color: 'bg-blue-600',   label: '設定問題', desc: '輸入主題、選深度、設定全局附件與資料來源，AI 自動推薦相關知識庫' },
              { step: 'Step 2', color: 'bg-violet-600', label: '確認計畫', desc: 'AI 生成子問題清單後，您可編輯問題文字、設定每個子問題的方向提示 / 附件 / 網搜開關 / 知識庫' },
              { step: 'Step 3', color: 'bg-emerald-600', label: '即時預覽', desc: '每個子問題完成後立即顯示答案摘要，全部完成自動整合報告並生成下載檔' },
            ].map((b) => (
              <div key={b.step} className="flex gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className={`${b.color} text-white text-xs font-bold px-2.5 py-1 rounded-lg flex-shrink-0 h-fit mt-0.5`}>{b.step}</div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{b.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-5">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SubSection>

        {/* ── Step 1 詳細說明 ── */}
        <SubSection title="Step 1：設定問題">
          <Para>點選輸入框右側的 <Search size={13} className="inline text-purple-500" /> 深度研究按鈕開啟設定面板。若輸入框已輸入問題或附加了檔案，這些內容會自動帶入。</Para>
          <Table
            headers={['設定項目', '說明']}
            rows={[
              ['研究問題', '輸入您要深入調查的問題或主題，越具體越好'],
              ['全局附件', '上傳檔案（PDF / Word / Excel / 圖片等）作為所有子問題的共用背景資料，拖放或點擊 + 附加'],
              ['研究深度', '快速 2 個、標準 5 個、深入 8 個、全面 12 個子問題，深度越高耗時越長'],
              ['輸出格式', '可多選 Word / PDF / PPT / Excel，完成後每種格式各生成一個下載連結'],
              ['整體資料來源', '為所有子問題預設使用的資料來源：自建知識庫 / Dify 知識庫 / MCP 工具（子問題可個別覆蓋）'],
              ['自動建議 KB', '輸入問題 1 秒後系統自動分析並預選相關知識庫（橘色「自動建議」標籤）'],
              ['引用前次研究', '選擇已完成的研究，其摘要會自動作為本次研究的背景知識，可多選最多 3 筆'],
            ]}
          />
          <TipBox>
            輸入完問題後稍等 1 秒，系統會自動推薦相關知識庫並預勾選。若推薦不準確，可手動取消勾選。
          </TipBox>
        </SubSection>

        {/* ── Step 2 詳細說明 ── */}
        <SubSection title="Step 2：確認計畫與子問題設定">
          <Para>
            AI 生成研究計畫後進入確認頁，顯示研究主題、目標說明及自動拆解的子問題清單。
            您可拖曳排序、編輯問題文字、新增或刪除子問題（最多 12 個）。
          </Para>
          <Para>每個子問題展開後可設定：</Para>
          <div className="space-y-2 pl-2">
            <div className="flex gap-3 items-start">
              <Lightbulb size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-700">研究方向提示</p>
                <p className="text-xs text-slate-500 leading-5">輸入提示文字，例如「只看台灣市場數據」、「聚焦 2024 年後的資料」，引導 AI 研究方向。</p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <Paperclip size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-700">子問題專屬附件</p>
                <p className="text-xs text-slate-500 leading-5">為此子問題額外附加不同的參考文件，僅此子問題使用，不影響其他子問題。</p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <Wifi size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-700">網路搜尋開關</p>
                <p className="text-xs text-slate-500 leading-5">
                  為此子問題個別啟用或停用網路搜尋（覆蓋任務層級設定）。
                  亮藍色 <Wifi size={11} className="inline text-blue-500" /> = 啟用，灰色 <WifiOff size={11} className="inline text-slate-400" /> = 停用。
                  實際是否啟用網搜還受「無 KB 資料才觸發」的邏輯控制。
                </p>
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <Database size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-700">子問題資料來源（覆蓋任務設定）</p>
                <p className="text-xs text-slate-500 leading-5">為此子問題指定不同的自建 KB / Dify KB / MCP 工具，覆蓋 Step 1 設定的任務層級來源。</p>
              </div>
            </div>
          </div>
          <NoteBox>
            子問題數量越多，Token 消耗越大。標準（5 個）適合大多數需求，若主題複雜才考慮深入（8 個）以上。
          </NoteBox>
        </SubSection>

        {/* ── Step 3 詳細說明 ── */}
        <SubSection title="Step 3：即時串流預覽">
          <Para>
            點「確認並開始研究」後立即進入預覽頁，研究在背景執行，畫面即時更新每個子問題的狀態：
          </Para>
          <div className="space-y-2 pl-2">
            <div className="flex gap-3 items-center">
              <Loader2 size={14} className="text-blue-400 flex-shrink-0 animate-spin" />
              <p className="text-xs text-slate-600">研究中（旋轉圖示）— AI 正在針對此子問題搜尋與生成答案</p>
            </div>
            <div className="flex gap-3 items-center">
              <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
              <p className="text-xs text-slate-600">已完成（綠色勾選）— 顯示答案摘要前 300 字</p>
            </div>
          </div>
          <Para>全部子問題完成後，AI 自動整合產出完整報告並生成下載檔，之後可在頂部欄位的研究面板下載。</Para>
          <TipBox>
            可以直接關閉此視窗，研究仍繼續在背景執行。完成後頂部的研究圖示會出現完成提示，
            對話中也會自動插入研究摘要與下載連結。
          </TipBox>
        </SubSection>

        {/* ── 資料來源與網路搜尋邏輯 ── */}
        <SubSection title="資料來源選用邏輯">
          <Para>系統依以下優先順序決定每個子問題使用哪些資料：</Para>
          <Table
            headers={['層級', '優先', '說明']}
            rows={[
              ['子問題層級', '最高', '若子問題有設定個別 KB / Dify / MCP，以子問題設定為準'],
              ['任務層級', '次高', '子問題未設定時，使用 Step 1 的整體任務資料來源'],
              ['全部 KB', '預設', '任務層級也未設定時，自動搜尋您能存取的所有知識庫'],
              ['網路搜尋', '補充', '知識庫無結果且無附件時自動觸發（需有可用的 MCP 搜尋工具）'],
            ]}
          />
        </SubSection>

        {/* ── 修改子問題重跑 ── */}
        <SubSection title="修改子問題並重跑（Edit & Re-run）">
          <Para>
            研究完成後，若某些子問題的答案不理想，可以針對特定子問題修改後重跑，
            <strong>不需要整個任務重頭來過</strong>，其餘子問題的答案原封不動保留。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="開啟頂部欄位的研究面板" desc="點選頂部欄位的望遠鏡／研究圖示，展開已完成的研究清單" />
            <StepItem
              num={2}
              title={`點選 done 研究右側的「↺」按鈕`}
              desc="這會開啟 ResearchModal 的「編輯重跑」模式，直接進入 Step 2"
            />
            <StepItem num={3} title="選擇要重跑的子問題" desc="預設全部為「保留」（灰底顯示舊答案摘要）；點「↺ 重跑」按鈕標記為橘色 = 此子問題將重新執行" />
            <StepItem num={4} title="修改問題文字 / 方向提示 / 附件 / 網搜開關（選填）" desc="展開已標記的子問題，可修改研究方向或附加新文件" />
            <StepItem num={5} title="點「確認並重跑」" desc="只執行被標記的子問題，完成後自動與原有答案合併、重新整合報告、更新下載檔" />
          </div>
          <TipBox>
            重跑完成後，聊天記錄中的研究摘要會自動更新為最新版本，下載檔也會重新生成。
          </TipBox>
          <NoteBox>
            正在執行中（pending / running）的研究無法重跑，請等待當前執行完成後再操作。
          </NoteBox>
        </SubSection>

        {/* ── 前次研究引用 ── */}
        <SubSection title="引用前次研究作為背景知識">
          <Para>
            在 Step 1 的「引用前次研究」區塊，可選擇已完成的研究（最近 20 筆）作為本次研究的背景知識。
            系統會自動將舊研究的摘要（約 800 字）拼接到每個子問題的背景脈絡中，
            適合「追蹤研究」場景，例如上季分析的延伸、議題的持續追蹤。
          </Para>
          <NoteBox>「引用前次研究」與「修改子問題重跑」是兩個不同功能：引用是把舊摘要當背景知識，讓新研究有延續性；重跑是直接修改舊研究中不滿意的子問題，在原有報告上更新。</NoteBox>
        </SubSection>

        {/* ── 研究歷史與下載 ── */}
        <SubSection title="研究歷史與下載">
          <Para>
            點選頂部欄位的研究圖示可展開研究面板，顯示最近 10 筆研究任務的狀態與操作。
          </Para>
          <Table
            headers={['狀態', '圖示', '說明']}
            rows={[
              ['pending', '藍色 Sparkles ✦', 'AI 尚未開始，通常在數秒內轉為執行中'],
              ['running', '藍色進度條', '正在逐步研究子問題，進度條顯示 N/M 步'],
              ['done', '綠色 ✓', '報告已生成，點連結即可下載各格式檔案'],
              ['failed', '紅色 ⚠', '發生錯誤，錯誤訊息顯示於下方，可點 ↺ 重跑嘗試修復'],
            ]}
          />
          <Para>每筆研究右側有兩個按鈕：</Para>
          <div className="space-y-2 pl-2">
            <div className="flex gap-3 items-center">
              <RefreshCw size={14} className="text-orange-400 flex-shrink-0" />
              <p className="text-xs text-slate-600">（橘色）↺ 編輯並重跑子問題 — 僅 done 狀態顯示</p>
            </div>
            <div className="flex gap-3 items-center">
              <span className="text-slate-400 text-sm font-bold flex-shrink-0">✕</span>
              <p className="text-xs text-slate-600">（灰色）刪除此研究任務及其下載檔</p>
            </div>
          </div>
        </SubSection>

        {/* ── Token 消耗提示 ── */}
        <SubSection title="Token 消耗說明">
          <Para>深度研究使用 Gemini Pro 模型，Token 消耗明顯高於一般對話，請依實際需求選擇研究深度：</Para>
          <Table
            headers={['深度', '子問題數', '預估 Token（僅供參考）', '適用場景']}
            rows={[
              ['快速', '2', '約 5 k–15 k', '簡單問題、快速了解概況'],
              ['標準', '5', '約 15 k–40 k', '大多數一般調查需求'],
              ['深入', '8', '約 30 k–70 k', '複雜議題、需多角度驗證'],
              ['全面', '12', '約 50 k–120 k', '大型研究報告、需窮舉各面向'],
            ]}
          />
          <NoteBox>
            若有管理員設定的每日 / 每週 Token 使用上限，深度研究也受此限制。
            上限剩餘量可在聊天頁面頂部的金額提示區查看。
          </NoteBox>
        </SubSection>
      </Section>

      <Section id="u-toolbar-toggles" icon={<Zap size={22} />} iconColor="text-amber-500" title="頂端列功能開關">
        <Para>
          對話頁面頂端工具列提供四個快速開關，讓您按需求啟用或停用各項輔助功能，
          每個開關的狀態僅影響當前及後續的新訊息，不會回溯修改已完成的對話。
        </Para>

        <Table
          headers={['開關', '圖示', '說明', '停用時行為']}
          rows={[
            ['技能 (Skill)', 'Sparkles ✦', '啟用後，AI 回覆前會先查詢符合的技能 Prompt 並套用', '跳過技能注入，AI 以原始模型回答'],
            ['知識庫', 'Database 🗄️', '啟用後，AI 回覆前會從已掛載的自建知識庫檢索相關段落', '不做知識庫檢索，直接回答'],
            ['DIFY 知識庫', 'Zap ⚡', '啟用後，AI 回覆前會從已掛載的 DIFY 知識庫查詢', '跳過 DIFY 檢索'],
            ['MCP 工具', 'Globe 🌐', '啟用後，AI 可呼叫已設定的 MCP 伺服器（搜尋、程式執行等）', '停用所有 MCP 工具呼叫'],
          ]}
        />

        <SubSection title="操作方式">
          <div className="space-y-3">
            <StepItem num={1} title="開啟任意對話後，查看頂部工具列" desc="工具列位於對話標題下方，包含各功能圖示按鈕" />
            <StepItem num={2} title="點選對應圖示即可切換開 / 關" desc="亮色（藍色/綠色）= 啟用；灰色 = 停用" />
            <StepItem num={3} title="下次發送訊息即生效" desc="無需重新整理頁面，狀態會記憶在瀏覽器 Session 中" />
          </div>
          <TipBox>
            若您只想進行純文字對話且不需要任何外部資料，建議關閉所有開關以降低延遲與 Token 消耗。
            若對話主題切換（如從「查 SOP」改為「寫程式」），也可即時調整開關組合。
          </TipBox>
          <NoteBox>
            各開關僅在對應功能已設定的情況下才有效果：知識庫開關需先在下拉選單中掛載知識庫；
            MCP 開關需管理員已設定並啟用 MCP 伺服器；DIFY 知識庫開關需管理員已設定 DIFY API。
          </NoteBox>
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

      {/* ═══════════════════════════════════════════════════ AI 戰情室 */}

      <Section id="u-ai-bi" icon={<BarChart3 size={22} />} iconColor="text-orange-500" title="AI 戰情室">
        <Para>
          AI 戰情室是一套以自然語言驅動的企業 ERP 資料查詢與視覺化平台，
          讓您無需懂 SQL 就能直接對 Oracle ERP 資料庫提問，即時取得報表、圖表，
          並可儲存常用查詢組合成彈性的 BI 儀表板。
        </Para>

        <Table
          headers={['功能模組', '說明']}
          rows={[
            ['自然語言查詢', '用中文提問，系統自動生成並執行 SQL，回傳結果與圖表'],
            ['命名查詢 / 報表範本', '儲存常用問題為具名範本，可定義查詢參數與圖表設定'],
            ['Schema 欄位選擇器', '從 ERP 資料表欄位清單選取並插入到提問輸入框'],
            ['即時圖表建構器', '查詢結果出來後，快速設定長條圖、折線圖、圓餅圖等，支援分組/堆疊/複數 Y 軸/漸層/陰影'],
            ['Tableau 拖拉式設計器', '全螢幕拖拉欄位到各 Shelf，視覺化設計圖表，類似 Tableau 操作體驗'],
            ['儀表板 Board', '將多個命名查詢的圖表組合成一個可拖拉排版的儀表板'],
            ['查詢參數化', '命名查詢可定義填值欄位（下拉選單、日期範圍等），執行時彈窗填入'],
            ['分享', '命名查詢與儀表板可分享給指定使用者、角色、部門或組織單位'],
          ]}
        />

        <SubSection title="進入 AI 戰情室">
          <div className="space-y-3">
            <StepItem num={1} title="點選左側邊欄的「AI 戰情室」圖示" desc="系統會導向 /dashboard 頁面，左側會顯示可用的主題（Topic）與查詢任務（Design）" />
            <StepItem num={2} title="從左側選擇主題 → 查詢任務" desc="主題是大分類（例：生產異常），任務是具體查詢範圍（例：各廠異常工單統計）" />
            <StepItem num={3} title="在輸入框輸入自然語言問題" desc="例：「請統計本月各廠區不良工單數量，依工廠由高到低排序」" />
            <StepItem num={4} title="按 Enter 或點擊發送按鈕" desc="系統會顯示進度，依序完成向量語意搜尋 → SQL 生成 → ERP 查詢 → 結果呈現" />
          </div>
          <TipBox>
            第一次使用請確認帳號已獲得「使用 AI 戰情室」權限，若未顯示入口請洽系統管理員開通。
          </TipBox>
        </SubSection>

        <SubSection title="查詢結果解讀">
          <Para>查詢完成後，主區域會顯示：</Para>
          <Table
            headers={['元素', '說明']}
            rows={[
              ['圖表頁籤', '若 Design 有預設圖表設定，會自動呈現 ECharts 視覺化圖表'],
              ['表格頁籤', '原始查詢結果，欄位標題使用中文說明，支援分頁'],
              ['資料筆數', '右上角顯示總筆數（最多回傳 500 筆）'],
              ['快取標示', '若顯示「快取命中」代表此問題結果來自快取，回應速度更快'],
            ]}
          />
        </SubSection>

        <SubSection title="模型選擇">
          <Para>輸入框下方可切換 AI 模型，不同模型影響 SQL 生成品質與回應速度。建議使用預設模型（Gemini Pro），
            複雜查詢可嘗試切換至 Flash（速度較快但精準度略低）。</Para>
        </SubSection>

        <SubSection title="語意搜尋參數（進階）">
          <Para>若查詢任務已啟用向量語意搜尋，輸入框下方會出現「向量搜尋參數」展開區，可調整：</Para>
          <Table
            headers={['參數', '說明', '預設值']}
            rows={[
              ['Top K', '取語意最相近的 K 筆向量資料補充至 AI 提示詞', '10'],
              ['相似度閾值', '低於此分數的結果不納入（0~1，越大越嚴格）', '0.50'],
            ]}
          />
          <NoteBox>
            通常無需調整，使用設計師設定的預設值即可。若查詢結果不符預期，可嘗試降低閾值至 0.30~0.40。
          </NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ 命名查詢 / 報表範本 */}

      <Section id="u-ai-bi-query" icon={<BookMarked size={22} />} iconColor="text-blue-600" title="命名查詢 / 報表範本">
        <Para>
          命名查詢讓您把常用的自然語言問題、SQL、圖表設定存下來，
          下次只需從「我的查詢」清單一鍵載入，省去重複輸入。
          進階功能可定義查詢參數，執行前彈窗讓您輸入工廠代碼、日期範圍等條件，
          讓同一份範本適用不同情境。
        </Para>

        <SubSection title="儲存目前查詢">
          <div className="space-y-3">
            <StepItem num={1} title="執行查詢並取得結果" desc="確認查詢結果正確後，頂端工具列的「💾 儲存」按鈕會亮起" />
            <StepItem num={2} title="點擊「💾 儲存」按鈕" desc="開啟「儲存為命名查詢」對話框" />
            <StepItem num={3} title="填寫基本資訊" desc="輸入名稱（必填）、說明（選填）、分類（選填，支援自由輸入或從已有分類選取）" />
            <StepItem num={4} title="勾選「載入後自動執行」（選用）" desc="勾選後，下次載入此查詢時系統會立即執行，不需再按發送" />
            <StepItem num={5} title="（選用）切換至「查詢參數」頁籤定義參數" desc="詳見下方「查詢參數設定」說明" />
            <StepItem num={6} title="點擊「儲存」完成" desc="查詢範本儲存成功後，可在左側「我的查詢」頁籤看到" />
          </div>
          <NoteBox>
            儲存時系統會自動帶入目前生成的 SQL（鎖定 SQL）、圖表設定及自然語言問題。
            下次執行時直接使用鎖定的 SQL，不會重新呼叫 AI，速度更快也更穩定。
          </NoteBox>
        </SubSection>

        <SubSection title="載入並執行命名查詢">
          <div className="space-y-3">
            <StepItem num={1} title="點擊左側邊欄的「我的查詢」頁籤（書籤圖示）" desc="顯示所有您建立或他人分享給您的命名查詢，依分類分組展示" />
            <StepItem num={2} title="點擊要載入的查詢名稱" desc="系統自動切換至對應 Design，並將問題帶入輸入框" />
            <StepItem num={3} title="若查詢有定義參數 → 自動彈出參數填值對話框" desc="填入工廠代碼、日期範圍等條件後點「執行查詢」" />
            <StepItem num={4} title="查詢執行，結果與圖表呈現" desc="若有設定圖表，會直接顯示圖表頁籤" />
          </div>
          <TipBox>
            滑鼠移到查詢項目上會出現「編輯」「分享」「刪除」三個操作按鈕，可快速管理查詢。
          </TipBox>
        </SubSection>

        <SubSection title="編輯命名查詢">
          <Para>
            在「我的查詢」清單中，滑鼠移到查詢名稱上，點擊「編輯」即可修改名稱、說明、分類、鎖定 SQL 及參數定義。
            也可以直接修改鎖定 SQL 欄位中的 SQL 語法，儲存後立即生效。
          </Para>
        </SubSection>

        <SubSection title="查詢參數設定">
          <Para>
            在儲存或編輯命名查詢時，切換至「查詢參數」頁籤可新增執行前填值的參數：
          </Para>
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['參數標籤（中文）', '顯示在填值對話框的標籤文字，例如「工廠代碼」'],
              ['輸入類型', '單選下拉、多選下拉、日期範圍、數值範圍、自由輸入'],
              ['來源 Schema / 來源欄位', '指定從哪個資料表的哪個欄位自動拉取可選值（執行時會查詢 DISTINCT 值）'],
              ['注入方式', 'WHERE IN / BETWEEN / LIKE / 直接取代文字 — 決定參數如何嵌入到 SQL'],
              ['SQL Placeholder', 'SQL 中對應的替換標記，例如 :FACTORY_CODE'],
              ['必填', '勾選後，若未填值則阻止執行'],
            ]}
          />
          <TipBox>
            日期範圍類型的參數支援「今天」「本月」「上月」快捷按鈕，使用者不必手動輸入。
            多選下拉會生成 IN (val1, val2, ...) 語法注入 SQL。
          </TipBox>
          <Para>
            每個參數的「中文標籤」旁有一個「翻譯」按鈕（↻），點擊後系統會自動呼叫 AI 翻譯，
            將標籤翻成英文（EN）與越南文（VI），填入對應欄位，無需手動輸入多語版本。
          </Para>
        </SubSection>

        <SubSection title="圖表設定（含複數 Y 軸）">
          <Para>
            命名查詢儲存對話框的「圖表設定」頁籤，功能與圖表建構器完全一致，包含：
          </Para>
          <Table
            headers={['功能', '說明']}
            rows={[
              ['多圖表管理', '可新增多張圖表，各自獨立設定欄位、類型、樣式'],
              ['X / Y 軸欄位選擇', '從命名查詢儲存的欄位清單（available_columns）中選取'],
              ['分組 / 堆疊維度', '在 Y 軸欄位設定後，可額外指定分組或堆疊維度（bar / line 適用）'],
              ['複數 Y 軸（進階）', '啟用後可定義多條 Series，每條獨立設定欄位、聚合、類型（bar/line）、顏色、漸層、陰影、套疊、右軸等'],
              ['顏色主題', '全局色票或自訂 Series 顏色'],
              ['排序 / 數值門檻', '排序方式與最小值過濾'],
              ['三語標題翻譯', '圖表標題、X / Y 軸名稱旁均有翻譯按鈕，一鍵填入英文與越南文'],
            ]}
          />
          <NoteBox>
            若儲存時查詢尚未執行（沒有 live 結果欄位），可在「圖表設定」頁籤下方的「手動新增欄位」輸入欄位代碼，
            讓 X / Y 欄位下拉選單有選項可選，不必重新執行查詢。
          </NoteBox>
        </SubSection>

        <SubSection title="分享命名查詢">
          <div className="space-y-3">
            <StepItem num={1} title="滑鼠移到查詢名稱，點擊「分享」圖示" desc="開啟分享設定對話框" />
            <StepItem num={2} title="選擇分享對象類型" desc="可選：使用者 / 角色 / 部門 / 利潤中心 / 事業處 / 事業群" />
            <StepItem num={3} title="搜尋並選取對象" desc="輸入姓名、帳號或工號搜尋使用者；部門等類型直接從下拉清單選擇" />
            <StepItem num={4} title="設定權限等級後點「+ 新增」" />
          </div>
          <Table
            headers={['權限等級', '可做的事']}
            rows={[
              ['使用權限', '可載入執行此查詢、另存為自己的版本，但無法修改原始設定'],
              ['管理權限', '可修改查詢設定、管理分享名單（等同擁有者）'],
            ]}
          />
          <NoteBox>
            被分享使用者若想修改查詢，點「編輯」時系統會提示「另存為自己的版本」而非覆蓋原版，避免影響其他使用者。
          </NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ Schema 欄位選擇器 */}

      <Section id="u-ai-bi-field" icon={<Server size={22} />} iconColor="text-violet-500" title="Schema 欄位選擇器">
        <Para>
          Schema 欄位選擇器讓您直接從目前查詢任務的資料表欄位清單中勾選欄位，
          點一下即可將欄位名稱或中文說明插入到輸入框的游標位置，
          不必記住英文欄位名稱，提問更精確。
        </Para>

        <SubSection title="開啟欄位選擇器">
          <div className="space-y-3">
            <StepItem num={1} title="先從左側選擇一個查詢任務（Design）" desc="欄位清單會根據該任務綁定的 Schema 資料表自動載入" />
            <StepItem num={2} title="點擊頂端工具列的「⊞ 欄位」按鈕" desc="右側欄位名稱旁出現 Popover 浮動面板" />
            <StepItem num={3} title="在搜尋框輸入關鍵字篩選欄位（選用）" desc="支援中文說明或英文欄位名稱搜尋" />
            <StepItem num={4} title="勾選一或多個欄位" desc="已勾選的欄位顯示藍底，底部出現「插入游標位置」按鈕" />
            <StepItem num={5} title="選擇插入方式" desc="「中文說明」插入欄位的業務語意名稱（推薦）；「欄位名稱」插入英文欄位代碼（適合需要精確指定時）" />
            <StepItem num={6} title="點擊「插入游標位置」" desc="所選欄位以頓號連接，插入到輸入框目前的游標位置" />
          </div>
          <TipBox>
            插入後可直接接著輸入問題，例如：先插入「工廠代碼、不良數量」後，加上「，請統計本月各廠的合計不良數量由高到低排序」。
          </TipBox>
        </SubSection>

        <SubSection title="欄位清單說明">
          <Table
            headers={['欄位資訊', '說明']}
            rows={[
              ['中文說明（左側）', '業務語意名稱，以當前 UI 語言（中 / 英 / 越）顯示'],
              ['英文代碼（右側灰色）', '資料庫實際欄位名稱（column_name）'],
              ['資料表分組', '欄位依所屬資料表分組，標題顯示資料表顯示名稱'],
            ]}
          />
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ 即時圖表建構器 */}

      <Section id="u-ai-bi-chart" icon={<BarChart3 size={22} />} iconColor="text-purple-600" title="即時圖表建構器">
        <Para>
          查詢出結果後，您可以使用圖表建構器即時設定圖表類型與欄位對應，
          系統在瀏覽器端直接聚合計算，不需要重新查詢 ERP，切換維度幾乎即時。
          設定完成後可儲存到命名查詢，下次直接呈現您自訂的圖表。
        </Para>

        <SubSection title="開啟圖表建構器">
          <div className="space-y-3">
            <StepItem num={1} title="執行查詢並取得結果" desc="有結果後，頂端工具列的「📐 圖表」按鈕才會可用" />
            <StepItem num={2} title="點擊「📐 圖表」按鈕" desc="右側滑出圖表建構器面板，查詢結果和圖表左右並排顯示" />
          </div>
        </SubSection>

        <SubSection title="基本設定">
          <Table
            headers={['設定項目', '說明']}
            rows={[
              ['圖表類型', '📊 長條圖 / 📈 折線圖 / 🍕 圓餅圖 / ⚫ 散佈圖 / 🕸 雷達圖，點擊圖示切換'],
              ['X 軸 / 類別欄位', '選擇橫軸（或圓餅標籤）欄位，通常是代碼或時間類欄位'],
              ['Y 軸 / 數值欄位', '選擇要聚合計算的數值欄位（單 Y 軸模式）'],
              ['聚合函數', 'SUM / COUNT / AVG / MAX / MIN / COUNT_DISTINCT'],
              ['顯示前幾筆', '取前 N 筆資料，預設 20 筆'],
              ['圖表標題', '顯示在圖表上方的標題文字（支援三語翻譯按鈕）'],
              ['X / Y 軸標題', '軸名稱說明文字，支援三語翻譯'],
            ]}
          />
          <TipBox>
            聚合計算在瀏覽器端執行（Client-side），不需重跑 SQL。設定後點「▼ 預覽」即可即時看到圖表效果。
          </TipBox>
        </SubSection>

        <SubSection title="排序與篩選">
          <Table
            headers={['設定項目', '說明']}
            rows={[
              ['排序依據', '不排序 / 依 X 軸排序 / 依 Y 軸排序'],
              ['排序方向', '升冪（ASC）/ 降冪（DESC）'],
              ['數值門檻 (min_value)', '排除 Y 軸值 ≤ 此數的資料列，設為 0 可去除零值資料'],
              ['圓餅 Top-N', '圓餅圖專用：依值由大到小取前 N 筆（其餘歸為其他或省略）'],
            ]}
          />
        </SubSection>

        <SubSection title="多維度設定（分組 / 堆疊）">
          <Para>
            長條圖與折線圖可在 Y 軸欄位之外，再加入「分組維度」或「堆疊維度」，
            讓同一張圖呈現多個 Series。
          </Para>
          <Table
            headers={['設定', '效果', '適用場景']}
            rows={[
              ['分組維度 (Series)', '同一 X 類別下並排多根柱子或多條線，每個維度值一種顏色', '比較各廠 × 各月份的數量'],
              ['堆疊維度 (Stack)', '同一 X 類別的柱子向上堆疊，各維度值疊加為整體', '顯示各產品佔每月總量的比例'],
              ['分組 + 堆疊同時使用', '每組並排，組內疊色，適合 3D 分析', '廠區 × 機種 × 不良類別'],
            ]}
          />
          <NoteBox>
            設定分組或堆疊維度後，圖表建構器會直接傳入原始資料列，由 AiChart 內部在瀏覽器端 pivot 計算，不需重跑 SQL。
            「複數 Y 軸（進階）」模式啟用時，分組/堆疊維度會自動隱藏（兩者互斥）。
          </NoteBox>
        </SubSection>

        <SubSection title="複數 Y 軸（進階 Method B）">
          <Para>
            當您需要把兩個以上的指標放在同一張圖、或需要「柱狀＋折線」混合圖、
            或「套疊/子彈圖」效果時，可使用「複數 Y 軸」模式。
            在圖表建構器的「複數 Y 軸 (進階)」區塊，點「+ 新增 Y 軸 series」加入每一條 Series。
          </Para>
          <Table
            headers={['每條 Series 設定', '說明']}
            rows={[
              ['欄位', '該 Series 對應的資料欄位'],
              ['聚合函數', 'SUM / COUNT / AVG / MAX / MIN / COUNT_DISTINCT，與欄位搭配'],
              ['類型 (Bar / Line)', '單張圖可混合柱狀與折線，實現 Combo Chart'],
              ['顏色', '點選色塊選擇任意顏色（HTML color picker）'],
              ['名稱 (Label)', '顯示在圖例（Legend）的 Series 名稱'],
              ['寬度 (Bar only)', '柱子寬度，例如 40%（百分比）或 30（像素）'],
              ['漸層', '柱子或折線加上由上到下的漸層填充效果'],
              ['陰影', '柱子或折線加上外發光陰影效果，增加立體感'],
              ['套疊 (Bar only)', '讓此柱子疊在前一條 Series 上（barGap: -100%），實現子彈圖效果'],
              ['平滑 (Line only)', '折線以貝茲曲線圓滑顯示'],
              ['面積 (Line only)', '折線下方填滿半透明顏色'],
              ['右軸', '讓此 Series 使用右側 Y 軸，適合不同量級的指標並排顯示'],
            ]}
          />
          <TipBox>
            子彈圖（Bullet Chart）做法：新增兩條 Bar Series，第一條寬度設 60%（背景），第二條寬度設 30%、勾選「套疊」（前景），
            兩條使用不同顏色，即可呈現目標值vs實際值的子彈圖效果。
          </TipBox>
          <NoteBox>
            啟用複數 Y 軸後，上方的單一 Y 軸欄位與分組/堆疊維度設定均會被忽略，圖表完全由 y_axes 陣列驅動。
          </NoteBox>
        </SubSection>

        <SubSection title="顏色主題">
          <Para>
            在圖表建構器底部可選擇整體色票主題，影響所有 Series 的預設顏色（自訂顏色的 Series 不受影響）：
          </Para>
          <Table
            headers={['主題', '色系說明']}
            rows={[
              ['預設（Power BI）', '藍橘紫綠，接近 Power BI 預設色票'],
              ['藍 (Blue)', '深淺藍色系'],
              ['綠 (Green)', '深淺綠色系'],
              ['橘 (Orange)', '橘紅黃色系'],
              ['紫 (Purple)', '深淺紫色系'],
              ['青 (Teal)', '青藍色系'],
            ]}
          />
        </SubSection>

        <SubSection title="樣式選項">
          <Table
            headers={['圖表類型', '可用樣式']}
            rows={[
              ['長條圖', '水平長條（Horizontal）、全域陰影（Shadow）'],
              ['折線圖', '圓滑曲線（Smooth）、面積填滿（Area）、全域陰影（Shadow）'],
              ['圓餅圖', '甜甜圈樣式（Donut）'],
              ['全部', '顯示數值標籤（Show Label）、顯示圖例（Show Legend）、顯示格線（Show Grid）'],
            ]}
          />
        </SubSection>

        <SubSection title="多圖表">
          <Para>
            同一份查詢結果可以加入多張圖表，分別設定不同的欄位組合。
            點頂部的「+ 新增」加入第二、第三張圖表，在結果區以頁籤切換。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="設定好第一張圖表後點「+ 新增」" />
            <StepItem num={2} title="切換到新頁籤，設定另一種欄位組合" desc="例如：第一張長條圖看「各廠異常數量」，第二張折線圖看「每日趨勢」" />
            <StepItem num={3} title="點「儲存圖表設定」寫回命名查詢" />
          </div>
        </SubSection>

        <SubSection title="儲存圖表設定">
          <Para>
            點擊面板右上角的「儲存圖表設定」，系統將所有圖表設定寫入命名查詢（需已儲存命名查詢）。
            下次載入此命名查詢並執行後，圖表會自動呈現您設定好的樣式。
          </Para>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ Tableau 拖拉式設計器 */}

      <Section id="u-ai-bi-shelf" icon={<Layers size={22} />} iconColor="text-rose-500" title="Tableau 拖拉式設計器">
        <Para>
          Tableau 拖拉式設計器提供類似 Tableau Worksheet 的全螢幕操作介面，
          讓您把欄位直接拖到各個 Shelf（欄架），即時預覽圖表效果，
          不需要設定欄位名稱字串，視覺化操作更直覺。
          完成後點「套用」即可將圖表設定同步到 AI 戰情室。
        </Para>

        <SubSection title="開啟設計器">
          <div className="space-y-3">
            <StepItem num={1} title="執行查詢並取得結果" desc="頂端工具列的「Tableau」按鈕（Layers 圖示）才會亮起" />
            <StepItem num={2} title="點擊工具列「Tableau」按鈕" desc="全螢幕覆蓋層彈出，左側是欄位清單，右側是 Shelf 區域與即時圖表預覽" />
          </div>
        </SubSection>

        <SubSection title="欄位分類">
          <Para>
            系統會自動分析資料，將欄位分類為「維度」與「量值」：
          </Para>
          <Table
            headers={['類型', '顯示色', '判斷邏輯']}
            rows={[
              ['維度 (Dimension)', '藍色標籤', '取前 30 筆，數值佔比 < 70%（通常是代碼、名稱、日期類）'],
              ['量值 (Measure)', '橘色標籤', '取前 30 筆，數值佔比 ≥ 70%（通常是數量、金額、比率類）'],
            ]}
          />
          <TipBox>
            自動分類可能因資料特性有偏差，例如工廠代碼若全為數字會被歸為量值。
            您可以手動將任意欄位拖到任何 Shelf，分類僅供參考。
          </TipBox>
        </SubSection>

        <SubSection title="Shelf 說明">
          <Table
            headers={['Shelf', '對應設定', '說明']}
            rows={[
              ['Columns（X 軸）', 'x_field', '橫軸類別欄位，通常拖入維度欄位'],
              ['Rows（Y 軸）', 'y_field + y_agg', '縱軸量值欄位，右側選聚合函數'],
              ['Color（顏色維度）', 'series_field', '拖入後產生分組 Series，各維度值用不同顏色'],
              ['Size（堆疊維度）', 'stack_field', '拖入後產生堆疊效果，各維度值向上疊加'],
            ]}
          />
        </SubSection>

        <SubSection title="拖拉操作流程">
          <div className="space-y-3">
            <StepItem num={1} title="從左側欄位清單抓取欄位" desc="長按後拖動，欄位上出現抓取游標（GripVertical 圖示）" />
            <StepItem num={2} title="拖到目標 Shelf 放開" desc="Shelf 出現藍色 hover 高亮時放開即可完成配置" />
            <StepItem num={3} title="同一 Shelf 可替換欄位" desc="再次拖入新欄位到已有欄位的 Shelf，會直接取代" />
            <StepItem num={4} title="點擊 Shelf 上的 ✕ 移除欄位" desc="清空該維度設定" />
            <StepItem num={5} title="圖表預覽即時更新" desc="每次變更 Shelf 配置，右側圖表預覽立刻重新計算並顯示" />
          </div>
        </SubSection>

        <SubSection title="圖表類型與顯示選項">
          <Para>
            設計器頂部工具列提供快速切換圖表類型，以及常用顯示開關：
          </Para>
          <Table
            headers={['選項', '說明']}
            rows={[
              ['圖表類型', '長條圖 / 折線圖 / 圓餅圖 / 散佈圖 / 雷達圖，點擊切換'],
              ['聚合函數 (Y Shelf)', 'SUM / COUNT / AVG / MAX / MIN / COUNT_DISTINCT，僅影響 Y Shelf 欄位'],
              ['顯示前 N 筆', '設定最多顯示幾筆資料，預設 20 筆'],
              ['漸層', '長條圖柱子加上漸層填充'],
              ['圓滑 (Line only)', '折線以圓滑曲線顯示'],
              ['顯示標籤', '在各資料點上顯示數值'],
              ['顯示圖例', '在圖表旁顯示 Series 名稱對照'],
              ['顯示格線', '在圖表背景顯示輔助格線'],
            ]}
          />
        </SubSection>

        <SubSection title="套用與關閉">
          <div className="space-y-3">
            <StepItem num={1} title="設計滿意後，點擊右上角「套用」按鈕" desc="圖表設定會同步回 AI 戰情室的圖表顯示，並標記為使用者自訂設定" />
            <StepItem num={2} title="點擊「關閉」或背景遮罩可不儲存直接退出" />
            <StepItem num={3} title="套用後繼續點「💾 儲存」可將 Tableau 設計的圖表設定永久寫入命名查詢" />
          </div>
          <NoteBox>
            Tableau 設計器產生的設定與圖表建構器（📐 圖表面板）共用同一份設定結構，可以在兩者之間互相切換精調。
          </NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ 儀表板 Dashboard */}

      <Section id="u-ai-bi-dashboard" icon={<Share2 size={22} />} iconColor="text-teal-600" title="儀表板 Dashboard Board">
        <Para>
          儀表板讓您把多個命名查詢的圖表組合成一個總覽頁面，
          類似 Power BI 的 Report Page，每個圖表格（Tile）獨立執行查詢，
          可拖拉調整位置與大小，分享給指定同仁瀏覽。
        </Para>

        <SubSection title="進入儀表板">
          <Para>
            在 AI 戰情室頂端工具列點擊「⊞」儀表板圖示，或直接訪問 <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">/dashboard/boards</code>，
            即可進入儀表板管理頁面。
          </Para>
        </SubSection>

        <SubSection title="建立新儀表板">
          <div className="space-y-3">
            <StepItem num={1} title="點擊左側邊欄下方的「+ 新增儀表板」" />
            <StepItem num={2} title="輸入儀表板名稱（必填）、說明、分類" desc="分類用來在左側清單分組，例如「生產」「品質」「人力」" />
            <StepItem num={3} title="點「建立」完成" desc="新儀表板建立後自動選中，進入空白畫布" />
          </div>
        </SubSection>

        <SubSection title="加入圖表 Tile">
          <div className="space-y-3">
            <StepItem num={1} title="點擊工具列「✏ 編輯佈局」進入編輯模式" />
            <StepItem num={2} title="從上方「+ 加入查詢...」下拉選擇一個命名查詢" desc="系統會在畫布加入一個新的圖表格，預設 6×4 格大小" />
            <StepItem num={3} title="重複加入多個命名查詢的圖表" />
            <StepItem num={4} title="拖拉 Tile 標題列調整位置" desc="藍色手把（標題列）可拖曳移動" />
            <StepItem num={5} title="拖拉 Tile 右下角調整大小" />
            <StepItem num={6} title="點「💾 儲存佈局」完成排版" />
          </div>
          <NoteBox>
            加入的命名查詢若有定義查詢參數，執行各 Tile 時會各自獨立彈出填值對話框，
            參數設定不會互相影響。
          </NoteBox>
        </SubSection>

        <SubSection title="執行與重新整理">
          <Table
            headers={['操作', '說明']}
            rows={[
              ['點擊單一 Tile 的 🔄 按鈕', '重新執行該 Tile 的命名查詢並更新圖表'],
              ['點擊工具列「🔄 重新整理全部」', '同時觸發所有 Tile 重新查詢（平行執行）'],
              ['首次進入儀表板', 'Tile 預設不自動執行，需手動點擊「點擊執行查詢」'],
              ['命名查詢有設定「載入後自動執行」', '加入 Dashboard 後該 Tile 進入頁面時自動執行'],
            ]}
          />
        </SubSection>

        <SubSection title="分享儀表板">
          <div className="space-y-3">
            <StepItem num={1} title="點擊工具列「🔗 分享」按鈕" desc="開啟儀表板分享設定對話框" />
            <StepItem num={2} title="依照命名查詢分享的相同流程，選擇對象類型與搜尋對象" />
            <StepItem num={3} title="設定「使用權限」或「管理權限」後點「+ 新增」" />
          </div>
          <Table
            headers={['權限', '說明']}
            rows={[
              ['使用權限', '可瀏覽、執行儀表板內所有圖表；可另存為自己的版本'],
              ['管理權限', '可修改儀表板佈局與分享名單'],
            ]}
          />
          <TipBox>
            若儀表板包含的命名查詢未分享給對象，對象執行時會出現「查詢無法存取」錯誤。
            建議儀表板與其包含的命名查詢共享給相同對象。
          </TipBox>
        </SubSection>

        <SubSection title="複製儀表板">
          <Para>
            對被分享的儀表板，您可以選擇「另存為自己的版本」（Clone）取得一份獨立副本，
            修改後不影響原始儀表板。Clone 的操作入口在儀表板選項選單中。
          </Para>
        </SubSection>

        <SubSection title="唯讀模式與權限說明">
          <Para>
            儀表板依照您的權限顯示不同操作按鈕：
          </Para>
          <Table
            headers={['您的權限', '能做的事', '介面提示']}
            rows={[
              ['管理權限（建立者或被授予管理）', '編輯佈局、新增/移除 Tile、調整大小、分享、刪除', '工具列顯示「編輯佈局」「分享」「刪除」按鈕'],
              ['使用權限（被分享）', '執行查詢、查看圖表、另存副本（Clone）', '空白畫布時顯示「此儀表板為唯讀」提示，工具列不顯示編輯按鈕'],
            ]}
          />
          <NoteBox>
            若您看到「此儀表板為唯讀」提示而非「進入編輯模式加入圖表」，代表您對此儀表板只有使用權限。
            如需編輯，請聯繫儀表板建立者授予管理權限，或使用「另存副本」建立自己的版本。
          </NoteBox>
        </SubSection>
      </Section>
    </div>
  )
}

// ── Admin Manual content ──────────────────────────────────────────────────────

const adminSections = [
  { id: 'a-users', label: '使用者管理', icon: <Users size={18} /> },
  { id: 'a-roles', label: '角色管理', icon: <Lock size={18} /> },
  { id: 'a-schedule', label: '排程任務', icon: <CalendarClock size={18} /> },
  { id: 'a-prompt', label: '排程 Prompt 語法', icon: <Terminal size={18} /> },
  { id: 'a-generate', label: '檔案生成語法', icon: <Download size={18} /> },
  { id: 'a-example', label: '完整 Prompt 範例', icon: <BookOpen size={18} /> },
  { id: 'a-tokens', label: 'Token 與費用統計', icon: <BarChart3 size={18} /> },
  { id: 'a-audit', label: '稽核與敏感詞', icon: <Shield size={18} /> },
  { id: 'a-mcp', label: 'MCP 伺服器', icon: <Globe size={18} /> },
  { id: 'a-dify', label: 'DIFY 知識庫', icon: <Zap size={18} /> },
  { id: 'a-kb', label: '自建知識庫管理', icon: <Database size={18} /> },
  { id: 'a-skill', label: '技能市集管理', icon: <Sparkles size={18} /> },
  { id: 'a-code-runners', label: 'Code Runners', icon: <Code2 size={18} /> },
  { id: 'a-llm', label: 'LLM 模型管理', icon: <Cpu size={18} /> },
  { id: 'a-system', label: '系統設定', icon: <Settings size={18} /> },
  { id: 'a-monitor', label: '系統監控', icon: <Activity size={18} /> },
  { id: 'a-k8s', label: 'K8s 部署更新', icon: <Server size={18} /> },
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

      <Section id="a-kb" icon={<Database size={22} />} iconColor="text-teal-500" title="自建知識庫管理">
        <Para>
          管理員可在後台管控全體使用者自建的知識庫，包含審核公開申請、調整使用者建立權限與配額、
          以及瀏覽、刪除任何知識庫。
        </Para>

        <SubSection title="使用者知識庫權限設定">
          <Para>在「使用者管理」或「角色管理」中設定：</Para>
          <Table
            headers={['欄位', '說明', '預設值']}
            rows={[
              ['允許建立知識庫', '開啟後使用者才能在側邊欄看到知識庫市集入口並建立知識庫', '繼承角色設定'],
              ['最大容量 (MB)', '該使用者所有知識庫文件的總容量上限', '500 MB'],
              ['最大數量', '該使用者可建立的知識庫數量上限', '5 個'],
            ]}
          />
          <TipBox>使用者層級的設定優先於角色設定。例如角色允許建立，但使用者明確設為「否」，則以使用者設定為準。若使用者設為「繼承」，才會套用角色的設定。</TipBox>
          <NoteBox>管理員帳號不受任何配額限制，可建立無限數量與容量的知識庫。</NoteBox>
        </SubSection>

        <SubSection title="審核公開申請">
          <Para>
            當使用者在知識庫共享設定中點選「申請設為公開」，管理員會在後台「知識庫管理」看到待審核項目。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="進入系統管理 → 知識庫管理頁籤" />
            <StepItem num={2} title="找到 public_status = 'pending' 的知識庫" />
            <StepItem num={3} title="審查內容是否適合公開（無敏感資訊、無著作權疑慮等）" />
            <StepItem num={4} title="點選「核准公開」或「拒絕」" desc="核准後 is_public = 1，所有使用者可在對話中看到並掛載此知識庫" />
          </div>
          <NoteBox>公開知識庫對所有人開放「僅使用（use）」權限，不開放編輯。若要撤銷公開，可將 is_public 改回 0。</NoteBox>
        </SubSection>

        <SubSection title="知識庫全覽與管理">
          <Para>管理員在知識庫市集可看到所有使用者的知識庫，並可執行以下操作：</Para>
          <Table
            headers={['操作', '說明']}
            rows={[
              ['查看文件', '進入任意知識庫，查看已上傳的文件、分塊狀態及錯誤訊息'],
              ['召回測試', '測試知識庫的檢索效果，調整分段與 Score 閾值'],
              ['修改設定', '調整分段策略、檢索模式、OCR 模型等參數'],
              ['標籤管理', '為知識庫設定 TAG 標籤（如「SOP」「規格書」），用於 TAG 自動路由比對'],
              ['行內編輯', '在知識庫詳情頁頂部可直接點選鉛筆圖示，快速修改名稱與描述'],
              ['共享管理', '新增或移除共享對象，調整 use / edit 權限'],
              ['刪除知識庫', '刪除後所有文件及向量資料一併清除，不可恢復'],
            ]}
          />
        </SubSection>

        <SubSection title="Token 費用說明">
          <Para>知識庫產生的 Token 費用記錄在建立者帳號下，分兩類：</Para>
          <Table
            headers={['類型', '模型', '計費時機']}
            rows={[
              ['Embedding 費用', 'gemini-embedding-001（或設定值）', '每次文件上傳向量化時，按輸入 Token 計費'],
              ['OCR 費用', '知識庫設定的 OCR 模型（預設 Flash）', '文件含圖片或 PDF 時，按輸入 + 輸出 Token 計費'],
            ]}
          />
          <TipBox>可在「Token 與費用統計」頁面篩選 model = gemini-embedding-001 或 OCR 模型，查看各使用者的知識庫建立成本。</TipBox>
        </SubSection>

        <SubSection title="系統預設值（.env 設定）">
          <Table
            headers={['環境變數', '說明', '預設值']}
            rows={[
              ['KB_EMBEDDING_MODEL', '向量化使用的 Embedding 模型', 'gemini-embedding-001'],
              ['KB_EMBEDDING_DIMS', '預設 Embedding 維度', '768'],
              ['KB_OCR_MODEL', '圖片 / PDF OCR 使用的 Gemini 模型（可被每個 KB 的設定覆蓋）', 'gemini-3-flash-preview'],
              ['KB_PDF_OCR_MAX_MB', 'PDF 以 Gemini 解析的最大檔案大小，超過則 fallback 純文字層', '18 MB'],
              ['KB_RERANK_MODEL', '混合檢索重排序模型', 'gemini-2.0-flash'],
              ['KB_RERANK_TOP_K_FETCH', '初始擷取 Top K', '10'],
              ['KB_RERANK_TOP_K_RETURN', '最終返回 Top K', '3'],
              ['KB_RERANK_SCORE_THRESHOLD', 'Score 閾值', '0.5'],
              ['KB_ALLOW_ADMIN_CREATE', '管理員是否可建立知識庫', 'true'],
              ['KB_ALLOW_USER_CREATE', '一般使用者預設是否可建立', 'false'],
            ]}
          />
          <NoteBox>KB_ALLOW_USER_CREATE=false 只是系統預設值，管理員仍可個別為使用者或角色開啟「允許建立知識庫」。</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-skill" icon={<Sparkles size={22} />} iconColor="text-purple-500" title="技能市集管理">
        <Para>
          管理員可在後台「技能管理」頁簽查看所有使用者建立的技能、審核公開申請，並控制委審策略。
        </Para>

        <SubSection title="技能公開申請審核">
          <div className="space-y-3">
            <StepItem num={1} title="使用者點選技能卡片的「→」申請公開" desc="卡片狀態變為「審核中」" />
            <StepItem num={2} title="管理員在後台「系統管理 → 技能管理」對申請進行審核" />
            <StepItem num={3} title="連線 Approve 內常對全體員工可見" desc="或點選 Reject 拒絕并處為私人" />
          </div>
          <NoteBox>審核制度是防止不適當素材流入的騷提，建議管理員審閱內容承設定實際測試後再公開。</NoteBox>
        </SubSection>

        <SubSection title="角色技能權限設定">
          <Para>在「角色管理」中，可針對每個角色設定技能權限：</Para>
          <Table
            headers={['權限項目', '說明']}
            rows={[
              ['允許建立 Skill', '開啟後，此角色的使用者可建立自定義技能'],
              ['允許外部 Skill', '開啟後，可建立擁有外部 Endpoint URL 的技能'],
              ['允許程式技能', '開啟後，可建立 type=code 的內部程式技能（需搭配 Code Runners 管理）'],
            ]}
          />
          <NoteBox>使用者頁面可對個別帳號覆蓋角色預設值。設為「沿用角色」（null）表示繼承角色設定。</NoteBox>
        </SubSection>

        <SubSection title="直接管理公開技能">
          <Para>管理員可以不經申請，直接將任何技能新增或修改為公開 / 私人、常用技能（建立官方推薦頁面）。</Para>
          <Table
            headers={['操作', '步驟']}
            rows={[
              ['公開技能', '後台 → 技能管理 → 找到目標技能 → 點 Approve'],
              ['設為私人', '找到目標 → 點 Reject 或直接編輯 is_public=0'],
              ['建立官方技能', '管理員建立後可直接設為公開，不需經申請流程'],
            ]}
          />
        </SubSection>

        <SubSection title="技能版本管理">
          <Para>管理員可在技能詳情中查看任何技能的版本歷史，並執行回滾操作：</Para>
          <Table
            headers={['操作', '說明']}
            rows={[
              ['查看版本歷史', '進入技能編輯 → 「版本歷史」頁籤，列出所有已發佈版本的 Prompt 內容與時間戳'],
              ['回滾版本', '點選歷史版本的「回滾」按鈕，該版本的 Prompt 與 Workflow 設定會覆蓋當前正式版本'],
              ['發佈新版本', '確認草稿修改無誤後，點選「發佈新版本」，版本號遞增，原版本保留在歷史中'],
            ]}
          />
          <NoteBox>回滾操作會立即生效，所有已掛載此技能的對話下次發送訊息時即使用回滾後的版本。</NoteBox>
        </SubSection>

        <SubSection title="Workflow 技能管理">
          <Para>
            Workflow 類型的技能在技能管理列表中以「Workflow」標籤識別。管理員可進入編輯頁面使用視覺化編輯器查看和修改流程，
            或直接檢視 workflow_json 原始資料。
          </Para>
          <Table
            headers={['注意事項', '說明']}
            rows={[
              ['節點上限', '單一 Workflow 最多 50 個節點，超過時無法新增'],
              ['錯誤處理', '節點執行失敗時，Workflow 會在該節點停止並回傳錯誤訊息給使用者'],
              ['效能考量', 'Workflow 中每個 LLM / DIFY / MCP 節點都會消耗 Token，建議控制節點數量以管理成本'],
            ]}
          />
        </SubSection>

        <SubSection title="速率限制監控">
          <Para>
            管理員可在技能設定中查看和調整每個技能的速率限制。超過限制的呼叫會被系統攔截並記錄。
          </Para>
          <Table
            headers={['設定項', '說明']}
            rows={[
              ['每人上限 / 全域上限', '可設定為空（不限制）或正整數'],
              ['時間窗口', 'minute（每分鐘）、hour（每小時）、day（每日）'],
            ]}
          />
        </SubSection>
      </Section>

      <Section id="a-code-runners" icon={<Code2 size={22} />} iconColor="text-emerald-500" title="Code Runners（內部程式技能管理）">
        <Para>
          Code Runners 讓 IT / 開發人員直接在平台內撰寫 Node.js 程式碼，作為獨立 HTTP 子程序運行，
          供 AI 對話時呼叫取得即時資料或執行計算。管理員可在後台「Code Runners」頁籤進行生命週期管理。
        </Para>

        <SubSection title="運作架構">
          <Table
            headers={['元件', '說明']}
            rows={[
              ['user_code.js', '使用者在技能市集「程式碼」欄位撰寫的 Node.js handler，接收 { user_message, session_id, user_id }，回傳 { system_prompt } 或 { content }'],
              ['runner.js', '平台自動產生的 Express wrapper，將 user_code.js 包裝成 HTTP Server（127.0.0.1:4xxxx）'],
              ['skillRunner 服務', '主 server 管理所有子程序的啟動 / 停止 / 重啟，並在 server 重啟時自動恢復運行中的 runner'],
            ]}
          />
        </SubSection>

        <SubSection title="Code Runner 生命週期操作">
          <div className="space-y-3">
            <StepItem num={1} title="在技能市集建立 type=code 技能" desc="填寫技能名稱、描述、端點模式（inject/answer），並在「程式碼」區塊撰寫 Node.js handler" />
            <StepItem num={2} title="前往後台 → Code Runners，找到剛建立的技能" />
            <StepItem num={3} title="點「安裝套件」（📦）" desc="確認或新增 NPM 套件後按「執行安裝」，日誌視窗顯示安裝進度" />
            <StepItem num={4} title="安裝完成後點「啟動」（▶）" desc="runner 狀態變為「運行中 :port」即代表成功" />
            <StepItem num={5} title="在對話中掛載該技能即可使用" />
          </div>
          <TipBox>Server 重啟後，狀態為「運行中」的 runner 會自動恢復，無需手動重啟。</TipBox>
        </SubSection>

        <SubSection title="user_code.js 撰寫規範">
          <Para>handler 函式必須是 async function，接收 body 物件，回傳以下格式之一：</Para>
          <Table
            headers={['回傳格式', '適用模式', '說明']}
            rows={[
              ['{ system_prompt: "..." }', 'inject 模式', 'AI 收到此字串作為背景資料後自行回答；回傳空字串代表本次不注入，AI 正常回覆'],
              ['{ content: "..." }', 'answer 模式', '此字串直接作為 AI 最終回覆，完全略過 Gemini'],
            ]}
          />
          <CodeBlock>{`// 範例：inject 模式 — 根據股票代號查詢即時股價
const axios = require('axios');

module.exports = async function handler(body) {
  const { user_message } = body;

  // 抽出 4-6 位數字股票代號
  const codes = [...new Set((user_message.match(/\\b\\d{4,6}\\b/g) || []))];

  if (codes.length === 0) {
    return { system_prompt: '' }; // 無代號 → 不注入，讓 AI 自行回答
  }

  // 查詢 Yahoo Finance
  const res = await axios.get(
    \`https://query1.finance.yahoo.com/v8/finance/chart/\${codes[0]}.TW\`,
    { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const meta = res.data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;

  return {
    system_prompt: \`即時股價資料：\${codes[0]} 現價 \${price} 元。請根據此數據回答使用者問題。\`
  };
};`}</CodeBlock>
          <NoteBox>NPM 套件需先在 Code Runners 面板安裝後才能 require。每個 skill 有獨立的 node_modules 目錄，互不干擾。</NoteBox>
        </SubSection>

        <SubSection title="常見問題排查">
          <Table
            headers={['狀況', '可能原因', '解決方式']}
            rows={[
              ['啟動失敗 / 錯誤狀態', 'user_code.js 語法錯誤或 require 的套件未安裝', '先執行「安裝套件」，再查看 Terminal 日誌確認錯誤訊息'],
              ['HTTP 500 注入失敗', 'handler 拋出例外或回傳格式錯誤', '查看 Terminal 日誌中的 [runner] handler error 行'],
              ['安裝套件後仍找不到模組', '安裝在舊目錄或 package.json 未更新', '重新安裝套件，確認對話框中有顯示該套件名稱'],
              ['重啟 server 後 runner 消失（Docker）', 'skill_runners 目錄未掛載 volume', '確認 docker-compose.yml 有 skill_runners volume 設定'],
              ['K8s pod 重啟後 runner 消失', 'pod 的 filesystem 是 ephemeral，沒有 PV', '進入 Admin → 技能管理，找到該 Code Skill → 點「儲存代碼」重建 runner；或配置 skill_runners PVC'],
            ]}
          />
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
              ['標籤（Tags）', '否', '用於 TAG 自動路由的標籤，例如「ERP」「工單」「庫存」。系統根據使用者訊息自動比對標籤決定是否啟用此伺服器'],
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
              ['標籤（Tags）', '否', '用於 TAG 自動路由的標籤，例如「產品規格」「零件」。系統根據使用者訊息自動比對標籤決定是否查詢此知識庫'],
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
          在「LLM 模型設定」頁籤，管理員可新增、編輯或停用 AI 模型選項，支援 Google Gemini 及 Azure OpenAI 兩種供應商，讓使用者在對話和排程中可自由選擇。
        </Para>

        <SubSection title="通用欄位">
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['識別鍵 (key)', '系統內部識別碼，用於對應 Prompt 設定（如 pro、flash）'],
              ['顯示名稱', '使用者看到的模型名稱（如 Gemini 2.0 Pro）'],
              ['說明文字', '顯示於模型選單下方的小字說明'],
              ['排序', '數字越小排越前，影響選單顯示順序'],
              ['啟用', '關閉後使用者無法選擇此模型，但歷史記錄不受影響'],
              ['輸入定價', '每百萬 Token 的費用（USD），用於費用統計'],
              ['輸出定價', '每百萬 Token 的費用（USD），用於費用統計'],
            ]}
          />
        </SubSection>

        <SubSection title="Gemini 模型設定">
          <Para>選擇供應商「Google Gemini」後，需填寫以下欄位：</Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['API 模型 ID', 'Google Gemini API 的實際模型代號', 'gemini-2.0-flash、gemini-1.5-pro'],
              ['API Key（選填）', '若留空則使用伺服器環境變數 GEMINI_API_KEY；填入後加密儲存於 DB，優先使用', 'AIza...'],
              ['支援圖片輸出', '開啟後此模型支援 Imagen 圖片生成（需模型本身支援）', ''],
            ]}
          />
          <TipBox>多數情況下 API Key 留空即可，由伺服器統一管理 GEMINI_API_KEY 環境變數。若需區分不同部門使用不同計費帳號，才需個別填入。</TipBox>
        </SubSection>

        <SubSection title="Azure OpenAI 模型設定">
          <Para>選擇供應商「Azure OpenAI」後，需填寫以下欄位：</Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['Deployment Name', 'Azure Portal 中建立的部署名稱（非模型名稱）', 'gpt-4o、o1-preview'],
              ['Endpoint URL', 'Azure OpenAI 資源的基礎 URL（不含路徑）', 'https://my-resource.openai.azure.com'],
              ['API Version', 'Azure OpenAI API 版本', '2024-08-01-preview'],
              ['Base Model（選填）', '底層模型識別，供定價查詢及顯示使用', 'gpt-4o、o1'],
              ['API Key', '必填；Azure OpenAI 的 API Key，AES-256-GCM 加密後存入 DB，系統永不明文傳回前端', ''],
            ]}
          />
          <NoteBox>
            Endpoint URL 請填入基礎位址即可，例如 <code className="bg-slate-100 px-1 rounded text-xs">https://fl-aoai-eus.openai.azure.com</code>，
            系統會自動組合完整的 <code className="bg-slate-100 px-1 rounded text-xs">/openai/deployments/&#123;deployment&#125;/chat/completions?api-version=...</code> 路徑。
          </NoteBox>
        </SubSection>

        <SubSection title="o1 / o3 系列特別說明">
          <Para>Azure OpenAI 的 o1、o3 系列推理模型有以下限制，系統會自動偵測並處理：</Para>
          <Table
            headers={['限制', '系統處理方式']}
            rows={[
              ['不支援串流輸出', '系統改用一次性請求，收到完整回應後一次推送給使用者'],
              ['不支援 system 訊息角色', '系統自動過濾 system 訊息，將指示合併至 user 訊息中'],
              ['使用 max_completion_tokens 而非 max_tokens', '系統自動切換參數，上限設為 8192'],
            ]}
          />
          <TipBox>判斷規則：Deployment Name 以 <code className="bg-slate-100 px-1 rounded text-xs">o</code> 加數字開頭（如 <code className="bg-slate-100 px-1 rounded text-xs">o1</code>、<code className="bg-slate-100 px-1 rounded text-xs">o3-mini</code>）即視為推理模型，無需額外設定。</TipBox>
        </SubSection>

        <SubSection title="測試連線">
          <Para>
            新增或編輯模型後，點選對話框底部的「測試連線」按鈕，系統會向目標模型發送一則測試訊息並顯示回應，
            確認 API Key、Endpoint、Deployment 設定均正確後再儲存。
          </Para>
          <NoteBox>測試時使用的 API Key 優先使用表單中填入的值；若表單留空，則使用 DB 中已加密儲存的 Key。</NoteBox>
        </SubSection>
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

      <Section id="a-monitor" icon={<Activity size={22} />} iconColor="text-teal-500" title="系統監控">
        <Para>
          系統監控位於後台管理的「系統監控」頁籤，提供 K8s 叢集、Docker 容器、主機資源、磁碟、線上人數等即時監控，
          每 30 秒自動刷新。所有面板在對應服務不可用時會靜默顯示空資料，不影響其他功能。
        </Para>

        <SubSection title="監控面板總覽">
          <Table
            headers={['面板', '功能說明']}
            rows={[
              ['摘要卡片', '一目了然：節點數、Pod 數、線上人數、磁碟使用率、CPU Load、未解除告警數'],
              ['K8s Nodes', '各節點狀態（Ready/NotReady）、CPU/Memory 請求百分比、Pod 數量'],
              ['K8s Pods', '所有命名空間的 Pod 列表，含狀態、重啟次數、可查看即時 Log'],
              ['K8s Events', 'K8s 叢集事件，支援「僅顯示 Warning」篩選'],
              ['主機系統指標', 'CPU Load、記憶體使用、網路 I/O、系統 Uptime、Top 20 Processes'],
              ['磁碟 / NAS 掛載', '各掛載點使用率進度條、inode 使用率、NFS 掛載狀態'],
              ['線上人數', '即時在線使用者人數與清單（工號、姓名、帳號、角色）、24 小時趨勢圖'],
              ['Docker Containers', '容器列表含狀態，支援 Restart / Stop / Start 操作與查看 Log'],
              ['Docker Images', '映像列表，支援一鍵清理 dangling images'],
              ['Service 健康檢查', '自定義 HTTP 健康檢查端點，顯示 30 天 uptime 百分比'],
              ['趨勢圖表', '主機/節點/磁碟歷史趨勢，支援 24h / 7d / 30d 切換'],
            ]}
          />
        </SubSection>

        <SubSection title="告警機制">
          <Para>系統會依設定的閾值自動產生告警，告警分為三個等級：</Para>
          <Table
            headers={['等級', '觸發條件範例', '通知方式']}
            rows={[
              ['Warning', '磁碟使用率接近閾值', '頁面 Banner 顯示'],
              ['Critical', 'CPU/記憶體超過閾值、Health Check 連續失敗、容器異常退出', '頁面 Banner + Email 通知'],
              ['Emergency', 'Node NotReady', '頁面 Banner + Email + Webhook（LINE / Teams）'],
            ]}
          />
          <TipBox>告警設定可在監控頁面右上角的齒輪圖示進入，可調整閾值、資料保留天數、Webhook URL 等。</TipBox>
        </SubSection>

        <SubSection title="Deploy 面板">
          <Para>
            監控頁面內建一鍵部署功能（位於頁面右上角），支援在管理介面直接觸發 K8s Rolling Update，
            部署過程以 SSE 即時串流顯示輸出，並記錄部署歷史。
          </Para>
          <NoteBox>Deploy 功能需要 server 所在環境具備 kubectl 和 deploy 腳本的執行權限。</NoteBox>
        </SubSection>

        <SubSection title="Log 檢視器">
          <Para>
            點擊 Pod 或 Container 的「Log」按鈕即可開啟即時 Log 串流視窗，支援：
          </Para>
          <ul className="list-disc pl-6 text-sm text-slate-600 space-y-1">
            <li>SSE 即時串流顯示</li>
            <li>關鍵字搜尋高亮</li>
            <li>Log 等級顏色區分（ERROR 紅色、WARN 橘色等）</li>
            <li>一鍵下載 Log 檔案</li>
          </ul>
        </SubSection>

        <SubSection title="K8s 部署前置設定">
          <Para>
            監控功能需要 K8s RBAC 權限（已寫入 deployment.yaml），首次啟用時需執行：
          </Para>
          <CodeBlock>{`# 1. Build 新 image
cd ~/foxlink_gpt && git pull && ./deploy.sh

# 2. Apply RBAC + volume mount
kubectl apply -f k8s/deployment.yaml

# 3. 重啟 pod
kubectl rollout restart deployment foxlink-gpt -n foxlink`}</CodeBlock>
          <Para>
            詳細說明請參考 <code className="bg-slate-100 px-1 rounded text-xs">docs/k8s-installation-guide.md</code> 第十二節。
          </Para>
        </SubSection>
      </Section>

      <Section id="a-k8s" icon={<Server size={22} />} iconColor="text-violet-500" title="K8s 部署更新">
        <Para>
          FOXLINK GPT 在 Kubernetes 環境以 4 個 replica 部署，採用 flgptm01:5000 作為內部 Local Registry。
          設定完成後每次更版只需一行指令，約 1 分鐘，零停機 Rolling Update。
        </Para>

        <SubSection title="環境架構">
          <Table
            headers={['節點', 'IP', '角色']}
            rows={[
              ['flgptm01', '10.8.93.11', 'Control Plane（kubectl / docker build / registry:5000）'],
              ['flgptn01', '10.8.93.12', 'Worker'],
              ['flgptn02', '10.8.93.13', 'Worker + Ingress（flgpt.foxlink.com.tw:8443）'],
              ['flgptn03', '10.8.93.14', 'Worker'],
            ]}
          />
          <NoteBox>Worker node 只有 containerd，沒有 docker CLI。Registry 為 HTTP（非 HTTPS），需各節點個別設定。</NoteBox>
        </SubSection>

        <SubSection title="一次性初始設定（新環境必做）">
          <div className="space-y-3 mb-3">
            <StepItem num={1} title="設定每個 Worker 免密碼 sudo" desc="非互動式 SSH 無法輸入密碼，需先解除限制" />
          </div>
          <Para>分別 SSH 到 flgptn01 / flgptn02 / flgptn03，各執行：</Para>
          <CodeBlock>{`echo "fldba ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/fldba`}</CodeBlock>

          <div className="space-y-3 my-3">
            <StepItem num={2} title="在 flgptm01 啟動 Local Registry" />
          </div>
          <CodeBlock>{`docker run -d -p 5000:5000 --restart=always --name registry \\
  -v /opt/registry:/var/lib/registry registry:2
curl http://localhost:5000/v2/_catalog`}</CodeBlock>

          <div className="space-y-3 my-3">
            <StepItem num={3} title="設定 flgptm01 docker 允許 HTTP registry" />
          </div>
          <CodeBlock>{`sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{ "insecure-registries": ["10.8.93.11:5000"] }
EOF
sudo systemctl restart docker`}</CodeBlock>

          <div className="space-y-3 my-3">
            <StepItem num={4} title="設定三個 Worker 的 containerd insecure registry" desc="從 flgptm01 統一執行（需先完成 Step 1）" />
          </div>
          <CodeBlock>{`for node_ip in 10.8.93.12 10.8.93.13 10.8.93.14; do
  ssh fldba@\${node_ip} "
    sudo mkdir -p /etc/containerd/certs.d/10.8.93.11:5000
    sudo tee /etc/containerd/certs.d/10.8.93.11:5000/hosts.toml > /dev/null <<'EOF'
server = \\"http://10.8.93.11:5000\\"
[host.\\"http://10.8.93.11:5000\\"]
  capabilities = [\\"pull\\", \\"resolve\\"]
  skip_verify = true
EOF
    sudo containerd config default | sudo tee /etc/containerd/config.toml > /dev/null
    sudo sed -i 's|config_path = \\"\\"|config_path = \\"/etc/containerd/certs.d\\"|' /etc/containerd/config.toml
    sudo systemctl restart containerd && echo done
  "
done`}</CodeBlock>

          <div className="space-y-3 my-3">
            <StepItem num={5} title="Build 並 Push 初始 image，套用 deployment" />
          </div>
          <CodeBlock>{`cd ~/foxlink_gpt
docker build -t 10.8.93.11:5000/foxlink-gpt:latest .
docker push 10.8.93.11:5000/foxlink-gpt:latest
curl http://10.8.93.11:5000/v2/foxlink-gpt/tags/list
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/foxlink-gpt -n foxlink`}</CodeBlock>
          <TipBox>設定完成後，之後每次更版只需執行 Step 6。</TipBox>
        </SubSection>

        <SubSection title="日常程式更版（設定完成後）">
          <CodeBlock>{`ssh fldba@10.8.93.11
cd ~/foxlink_gpt && git pull && ./deploy.sh`}</CodeBlock>
          <Para>deploy.sh 自動執行：docker build → push 到 registry → kubectl rollout restart → 等待完成。</Para>
          <TipBox>Rolling Update 策略：maxUnavailable=0，永遠保持 4 個 pod 可用，更新期間 user 不受影響。看到 "successfully rolled out" 即完成。</TipBox>
        </SubSection>

        <SubSection title="常用 kubectl 指令">
          <Table
            headers={['指令', '用途']}
            rows={[
              ['kubectl get pods -n foxlink -o wide', '查看所有 pod 狀態與所在 node'],
              ['kubectl logs -n foxlink <pod-name> --tail=30', '查看 pod 最新日誌'],
              ['kubectl describe pod <pod-name> -n foxlink | tail -20', '查看 pod 異常事件'],
              ['kubectl get nodes -o wide', '查看所有 node 的 IP'],
              ['kubectl rollout history deployment/foxlink-gpt -n foxlink', '查看歷次 rollout 記錄'],
              ['curl http://10.8.93.11:5000/v2/foxlink-gpt/tags/list', '查看 registry 中的 image tags'],
            ]}
          />
        </SubSection>

        <SubSection title="Image Pull 常見錯誤排查">
          <Table
            headers={['錯誤訊息', '原因', '解法']}
            rows={[
              ['http: server gave HTTP response to HTTPS client（push 失敗）', 'flgptm01 docker 未設定 insecure registry', '執行初始設定 Step 3'],
              ['http: server gave HTTP response to HTTPS client（pod ErrImagePull）', 'Worker containerd 未設定 hosts.toml', '執行初始設定 Step 4'],
              ['sudo: a terminal is required', 'Worker fldba 未設定免密碼 sudo', '執行初始設定 Step 1'],
              ['NAME_UNKNOWN: repository name not known', 'Image 未 push 到 registry', '執行 docker push 後再 rollout'],
            ]}
          />
        </SubSection>

        <SubSection title="K8s 環境的 Skill Runner 注意事項">
          <Para>
            目前 skill_runners 目錄已掛載於 NFS PVC（pvc-flgpt-source），pod 重啟後應保留。
            若 skill 仍失效，手動復原：後台 → 技能管理 → 找到 Code Runner 技能 → 點「儲存代碼」。
          </Para>
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
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${role === 'user'
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
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${role === 'admin'
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
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-8 ${role === 'admin'
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
