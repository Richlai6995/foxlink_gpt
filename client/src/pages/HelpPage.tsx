import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, MessageSquare, Upload, History, Copy, Download,
  User, Users, CalendarClock, BarChart3, DollarSign, Shield,
  AlertTriangle, Database, Mail, Cpu, Zap, Settings, BookOpen,
  ChevronRight, Info, Lightbulb, Terminal, Globe, RefreshCw,
  Wand2, ImageIcon, Clock, Share2, GitFork, Lock, Sparkles, Code2, Package, Play, Square,
  Paperclip, Search, Server, BookMarked, Wifi, WifiOff, CheckCircle, Loader2, Layers, Activity,
  Key, ShieldCheck, LayoutTemplate, FileSpreadsheet, File, FlaskConical, Languages,
  TicketCheck, GripVertical, KeyRound,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import { RenderHelpSections, RenderHelpSection, getIcon, type HelpSectionData } from '../components/HelpBlockRenderer'
import HelpTrainingPlayer from '../components/training/HelpTrainingPlayer'

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

function ListBlock({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-1 text-sm text-slate-600 leading-6">
      {items.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: item.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`(.*?)`/g, '<code class="bg-slate-100 px-1 rounded text-xs">$1</code>') }} />)}
    </ul>
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
  { id: 'u-lang', label: '語言切換與多語設定', icon: <Globe size={18} /> },
  { id: 'u-budget', label: '對話額度限制', icon: <DollarSign size={18} /> },
  { id: 'u-ai-bi', label: 'AI 戰情室', icon: <BarChart3 size={18} /> },
  { id: 'u-ai-bi-query', label: '命名查詢 / 報表範本', icon: <BookMarked size={18} /> },
  { id: 'u-ai-bi-field', label: 'Schema 欄位選擇器', icon: <Server size={18} /> },
  { id: 'u-ai-bi-chart', label: '即時圖表建構器', icon: <BarChart3 size={18} /> },
  { id: 'u-ai-bi-shelf', label: 'Tableau 拖拉式設計器', icon: <Layers size={18} /> },
  { id: 'u-ai-bi-dashboard', label: '儀表板 Dashboard', icon: <Share2 size={18} /> },
  { id: 'u-ai-bi-schema', label: 'Schema 與多資料庫來源', icon: <Database size={18} /> },
  { id: 'u-help-kb', label: 'AI 回答使用問題', icon: <BookMarked size={18} /> },
  { id: 'u-doc-template', label: '文件範本', icon: <LayoutTemplate size={18} /> },
  { id: 'u-webex-bot', label: 'Webex Bot 使用', icon: <MessageSquare size={18} /> },
]

function UserManual() {
  return (
    <div>
      <Section id="u-intro" icon={<BookOpen size={22} />} iconColor="text-blue-500" title="系統介紹">
        <Para>
          Cortex 是正崴精密工業內部專屬的 AI 智慧助理平台，同時整合 <strong>Azure OpenAI (AOAI)</strong> 與
          <strong> Google Gemini</strong> 兩大語言模型體系，提供流暢的多語言對話、文件深度分析、多媒體處理、
          工具調用及自動化排程等功能，協助同仁大幅提升日常工作效率。
        </Para>
        <Para>
          平台以企業安全為前提，所有資料傳輸均在正崴內部網路環境下進行，對話記錄保存於公司伺服器，
          符合資訊安全及稽核要求。
        </Para>
        <Table
          headers={['功能', '說明']}
          rows={[
            ['多樣語言模型', '支援 AOAI（GPT 系列）與 Gemini（Pro / Flash / Image）多種模型，可依需求自由切換'],
            ['智慧對話', '支援繁體中文、英文及越南文，具備單次 Session 完整記憶能力'],
            ['深度研究', '自動拆解成最多 12 個子議題分別調查，可結合知識庫、技能、MCP 工具作為資料來源或輸入提示'],
            ['文件分析', '可上傳 PDF、Word、Excel、PowerPoint、圖片，AI 直接閱讀並分析內容'],
            ['工具調用', '可調用自建知識庫、API 連接器、MCP 工具及技能（Skill）進行問答與作業自動化'],
            ['AI 戰情室', '結合 Oracle ERP 資料庫與向量語意搜尋，用自然語言查詢生產戰情，並生成圖表 / 儀表板'],
            ['任務排程', '設定排程讓 AI 定期執行分析任務，結果自動寄送 Email 或生成下載檔案'],
            ['音訊轉文字', '上傳語音檔，系統自動轉錄為文字後送 AI 分析'],
            ['生成輸出', 'AI 可依指令生成 PDF、Excel、Word、PPT、TXT 供下載'],
            ['對話記錄', '所有對話永久保存於伺服器，可隨時查閱、搜尋歷史問答'],
          ]}
        />
        <NoteBox>
          部分進階功能（如深度研究、排程任務、知識庫建立、AI 戰情室）須由系統管理員開通對應權限後才能使用，
          若看不到相關入口，請洽 IT 部門申請。
        </NoteBox>
      </Section>

      <Section id="u-login" icon={<User size={22} />} iconColor="text-indigo-500" title="登入與登出">

        <SubSection title="Foxlink SSO 單一登入（AD 帳號適用）">
          <Para>
            持有公司 Active Directory（AD）網域帳號的同仁，可使用 <strong>Foxlink SSO</strong> 一鍵登入，
            無需另外記憶 Cortex 密碼。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="開啟瀏覽器，輸入系統網址" desc="建議使用 Chrome 或 Edge 以獲得最佳體驗" />
            <StepItem num={2} title="點選登入頁面的「Foxlink SSO 登入」藍色按鈕" desc="系統自動導向公司 SSO 驗證頁面" />
            <StepItem num={3} title="輸入您的 AD 工號與 AD 密碼完成驗證" desc="若您已在公司內部網路環境登入 AD，可能免輸入直接通過" />
            <StepItem num={4} title="驗證通過後自動跳回 Cortex 主畫面" />
          </div>
          <NoteBox>
            <strong>重要：SSO 僅適用於擁有 AD 帳號的正崴員工。</strong>
            由系統管理員手動建立的本地帳號（如外部合作夥伴、特殊功能帳號）無法使用 SSO，
            必須以帳號密碼方式登入（見下方說明）。
          </NoteBox>
          <TipBox>
            AD 帳號登入後如需修改密碼，請透過公司 AD 系統（如 Windows 網域）更改，
            Cortex 的「修改密碼」功能僅限本地帳號使用。
          </TipBox>
        </SubSection>

        <SubSection title="帳號密碼登入（本地帳號適用）">
          <div className="space-y-3">
            <StepItem num={1} title="開啟瀏覽器，輸入系統網址" />
            <StepItem num={2} title="在登入頁面輸入帳號與密碼" desc="帳號密碼由系統管理員提供，首次使用請先洽系統管理員確認帳號已建立並啟用" />
            <StepItem num={3} title="點選「登入」按鈕，登入成功後自動跳轉至主畫面" />
          </div>
          <NoteBox>若帳號未啟用，系統會顯示「帳號尚未啟用」提示，請洽系統管理員確認帳號狀態。</NoteBox>
        </SubSection>

        <SubSection title="忘記密碼（本地帳號適用）">
          <Para>
            本地帳號若忘記密碼，可使用登入頁面的「忘記密碼」功能，
            系統會寄送重設密碼連結至您的帳號綁定 Email。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="在登入頁面點選「忘記密碼？」連結" desc="位於登入按鈕下方" />
            <StepItem num={2} title="輸入您的帳號（工號），點選「發送重設信件」" />
            <StepItem num={3} title="至您的 Email 信箱開啟重設連結" desc="連結有效期限通常為 24 小時" />
            <StepItem num={4} title="依指示設定新密碼後即可重新登入" />
          </div>
          <NoteBox>
            AD 帳號忘記密碼請聯絡 IT 部門透過公司 AD 系統重設，無法透過此功能處理。
          </NoteBox>
        </SubSection>

        <SubSection title="登出系統">
          <Para>點選左側邊欄最下方的登出圖示（向左箭頭），即可安全登出。登出後 Token 立即失效，確保帳號安全。</Para>
        </SubSection>

      </Section>

      <Section id="u-ui" icon={<Settings size={22} />} iconColor="text-slate-500" title="介面導覽">
        <Para>主畫面分為兩大區域：<strong>左側邊欄</strong>（導航與功能入口）與<strong>中央對話區域</strong>（對話主體）。</Para>
        <div className="grid grid-cols-1 gap-3">
          {[
            {
              color: 'bg-slate-800',
              title: '左側邊欄',
              items: [
                'Cortex Logo 及品牌識別',
                '「+ 新對話」按鈕 — 建立全新對話 Session',
                'AI 模型選擇下拉選單 — 切換 AOAI / Gemini 等模型',
                '對話歷史清單（依今天、昨天、過去 7 天、更早分組）',
                '「更多功能」折疊選單 — 含匯入分享、系統管理、排程任務、技能市集、知識庫市集、AI 戰情室、使用說明',
                '語言切換（中文 / English / Tiếng Việt）',
                '使用者資訊、修改密碼、登出圖示',
              ],
            },
            {
              color: 'bg-blue-700',
              title: '中央對話區域',
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
        <TipBox>
          部分頂部工具列功能（如 AI 戰情室、排程任務）只有具備對應權限的帳號才會顯示，
          若有需要請洽系統管理員開通。
        </TipBox>
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
        <SubSection title="生成圖片（重要）">
          <div className="flex gap-3 bg-violet-50 border border-violet-200 rounded-xl p-4 mb-3">
            <AlertTriangle size={16} className="text-violet-500 flex-shrink-0 mt-0.5" />
            <p className="text-violet-700 text-sm leading-6">
              <strong>要讓 AI 生成圖片，必須先在左側邊欄的模型下拉選單中切換為「Image 類型」模型</strong>（例如 Gemini Image 或其他支援圖片輸出的模型）。
              使用一般 Pro / Flash / GPT 模型時，AI 無法生成圖片，只能描述圖片。
            </p>
          </div>
          <Para>詳細的圖片生成與修圖操作說明，請參閱本文件的「圖片生成與修圖」章節。</Para>
        </SubSection>
      </Section>

      <Section id="u-model" icon={<Cpu size={22} />} iconColor="text-purple-500" title="選擇 AI 模型">
        <Para>
          系統同時支援 <strong>Azure OpenAI（AOAI）</strong> 及 <strong>Google Gemini</strong> 兩大平台的多種模型，
          由左側邊欄的模型下拉選單切換。不同模型在能力、速度、費用上各有差異，請依需求選擇。
        </Para>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={18} className="text-blue-500" />
              <span className="font-semibold text-blue-700">Gemini Pro</span>
              <Tag color="blue">高精度</Tag>
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
          <div className="border border-violet-200 rounded-xl p-4 bg-violet-50">
            <div className="flex items-center gap-2 mb-2">
              <ImageIcon size={18} className="text-violet-500" />
              <span className="font-semibold text-violet-700">Gemini Image</span>
              <Tag color="purple">圖片生成</Tag>
            </div>
            <ul className="text-sm text-violet-600 space-y-1">
              <li>• <strong>唯一支援生成圖片的模型</strong></li>
              <li>• 文字生圖、上傳圖修圖、風格轉換</li>
              <li>• 多輪對話連續調整圖片</li>
              <li>• 若需生成圖片，必須切換至此模型</li>
            </ul>
          </div>
          <div className="border border-green-200 rounded-xl p-4 bg-green-50">
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={18} className="text-green-600" />
              <span className="font-semibold text-green-700">AOAI GPT 5.4</span>
              <Tag color="green">目前最新</Tag>
            </div>
            <ul className="text-sm text-green-700 space-y-1">
              <li>• <strong>目前已支援 AOAI GPT 5.4 模型</strong></li>
              <li>• 長文脈絡理解能力強</li>
              <li>• 適合需要 OpenAI 相容 API 的場景</li>
              <li>• 後續將陸續新增更多 AOAI 模型</li>
            </ul>
          </div>
        </div>

        <NoteBox>
          <strong>模型清單由系統管理員統一維護，</strong>實際可用模型以畫面下拉選單為準，後續將陸續新增更多 AOAI 及 Gemini 模型版本。
          模型選擇會保存在您的瀏覽器，下次開啟仍會維持上次的選擇；切換模型不會影響當前對話歷史記錄。
        </NoteBox>
        <TipBox>
          若模型下拉選單中看不到 Image 類型模型，表示管理員尚未開放此功能，請洽 IT 部門申請。
        </TipBox>
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
        <SubSection title="重新命名對話">
          <Para>
            系統預設以 AI 自動生成的摘要作為對話標題，您可以隨時將其改為更易辨識的名稱：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="滑鼠移到左側邊欄的對話標題上" desc="右側出現鉛筆圖示（✏）" />
            <StepItem num={2} title="點選鉛筆圖示，標題變為可編輯輸入框" />
            <StepItem num={3} title="輸入新名稱，按 Enter 確認，或按 Esc 取消" desc="也可點選輸入框旁的確認勾選圖示（✓）儲存" />
          </div>
          <TipBox>
            系統支援多語言標題，修改時 AI 會同步翻譯成英文及越南文，方便切換語系後也能看到對應語言的標題。
          </TipBox>
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
          Cortex 支援多種工具擴展能力，讓 AI 在對話中自動取用企業內部資料、知識庫及技能。
          您可以透過對話頂部工具列的各功能開關，明確指定要使用哪些工具；
          也可以讓系統根據訊息內容自動判斷（TAG 路由機制）。
        </Para>

        <SubSection title="工具類型說明">
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-cyan-200 rounded-xl p-4 bg-cyan-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔌</span>
                <span className="font-semibold text-cyan-700 text-sm">MCP 工具</span>
                <Tag color="blue">即時外部查詢</Tag>
              </div>
              <p className="text-xs text-cyan-600 leading-5">
                連接外部系統的即時查詢工具，例如 ERP 資料庫查詢、Oracle 程式搜尋等。
                AI 在判斷需要時自動呼叫，無需手動觸發。
              </p>
            </div>
            <div className="border border-yellow-200 rounded-xl p-4 bg-yellow-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📚</span>
                <span className="font-semibold text-yellow-700 text-sm">API 連接器</span>
                <Tag color="orange">企業文件庫</Tag>
              </div>
              <p className="text-xs text-yellow-600 leading-5">
                透過 API 連接外部知識管理平台的企業內部文件知識庫，例如產品規格、SOP 手冊。
                對話時自動查詢，找到相關段落則注入給 AI 作為回答依據。
              </p>
            </div>
            <div className="border border-teal-200 rounded-xl p-4 bg-teal-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🗄️</span>
                <span className="font-semibold text-teal-700 text-sm">自建知識庫</span>
                <Tag color="green">向量語意搜尋</Tag>
              </div>
              <p className="text-xs text-teal-600 leading-5">
                由您或同事在「知識庫市集」中建立並上傳文件的向量化知識庫。
                支援 PDF、Word、Excel、PPTX 等格式，語意搜尋精度高。
                可在對話頂部的「知識庫」按鈕中選擇要掛載哪幾個知識庫。
              </p>
            </div>
            <div className="border border-purple-200 rounded-xl p-4 bg-purple-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">✨</span>
                <span className="font-semibold text-purple-700 text-sm">技能（Skill）</span>
                <Tag color="purple">角色與自動化</Tag>
              </div>
              <p className="text-xs text-purple-600 leading-5">
                掛載技能後，AI 會自動套用對應的 System Prompt、外部 API 或工作流程。
                例如「翻譯技能」讓 AI 固定以指定語言回覆，「ERP 查詢技能」自動整合資料庫資料。
                可在技能市集瀏覽並掛載到對話。
              </p>
            </div>
          </div>
        </SubSection>

        <SubSection title="如何選擇要使用的工具">
          <Para>對話頂部工具列提供四個開關，可明確控制每類工具的啟用狀態：</Para>
          <Table
            headers={['開關', '說明', '啟用（亮色）', '停用（灰色）']}
            rows={[
              ['✦ 技能', '頂部紫色 Badge 圖示', '自動套用掛載的技能', '跳過技能注入'],
              ['🗄️ 知識庫', '資料庫圖示', '從已掛載的自建知識庫檢索', '不做向量檢索'],
              ['⚡ API', '閃電圖示', '從已掛載的 API 連接器查詢', '跳過 API 連接器查詢'],
              ['🌐 MCP', '地球圖示', '允許 AI 呼叫 MCP 伺服器工具', '停用所有 MCP 呼叫'],
            ]}
          />
          <Para>
            此外，您也可以點選各開關圖示旁的下拉箭頭，<strong>明確指定</strong>要使用哪幾個知識庫 / MCP 伺服器 / API 連接器，
            而非讓系統自動選擇全部。
          </Para>
        </SubSection>

        <SubSection title="兩種工具啟用模式">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border-2 border-blue-300 rounded-xl p-4 bg-blue-50">
              <div className="font-semibold text-blue-700 text-sm mb-2">模式 A：明確指定（Explicit）</div>
              <p className="text-xs text-blue-600 leading-5">
                在工具列下拉選單<strong>具體勾選</strong>特定知識庫 / MCP 伺服器時啟用。<br/>
                系統<strong>直接使用所選工具，跳過所有自動路由與 intent 判斷</strong>，效率最高。
              </p>
              <div className="mt-2 text-xs text-blue-500">例：勾選「自建 KB 工具列」→ 選「HR 制度知識庫」</div>
            </div>
            <div className="border-2 border-slate-300 rounded-xl p-4 bg-slate-50">
              <div className="font-semibold text-slate-700 text-sm mb-2">模式 B：自動路由（Auto）</div>
              <p className="text-xs text-slate-600 leading-5">
                工具列<strong>開關開啟但未具體選擇</strong>，或<strong>全部關閉</strong>時啟用。<br/>
                系統依訊息內容智慧決定要呼叫哪些工具（TAG 路由機制，見下方）。
              </p>
              <div className="mt-2 text-xs text-slate-500">例：知識庫開關開啟 → 未勾選具體 KB → 系統自動比對</div>
            </div>
          </div>
          <NoteBox>空陣列（全部取消勾選）等同「未選」，系統會切換回自動路由，不會跳過工具。</NoteBox>
        </SubSection>

        <SubSection title="自動路由完整流程（Auto 模式）">
          <Para>每次送出訊息時，系統依以下步驟決定傳哪些工具給 AI：</Para>

          <div className="space-y-3 mt-2">
            <StepItem num={1} title="依存取權限載入可用工具" desc="MCP 依 mcp_access 授權、API 連接器依 api_access 授權、自建 KB 依 creator/公開/kb_access 授權 — 只載入您有權使用的工具" />
            <StepItem num={2} title="套用技能（Skill）約束" desc="若 session 有掛載技能，技能可強制限制工具清單（見下方「技能對工具的影響」）" />
            <StepItem num={3} title="TAG 自動路由（有任何工具設定 Tags 時）" desc="Flash LLM 提取訊息意圖標籤 → 與工具 Tags 比對 → 再以 LLM 依描述精篩" />
            <StepItem num={4} title="Fallback（所有工具均無 Tags 時）" desc="Flash LLM 直接閱讀全部工具的描述文字做分類，效率較低、準確性較差" />
            <StepItem num={5} title="Gemini Function Calling 最終決策" desc="篩選後的工具以 function declarations 傳給 LLM，由 AI 根據對話上下文決定實際要呼叫哪個" />
          </div>

          <div className="mt-4 space-y-3">
            <div className="bg-slate-900 rounded-xl px-5 py-4">
              <pre className="text-xs text-slate-300 font-mono leading-6 whitespace-pre">{`使用者訊息
    │
    ▼
[Step 1] 依授權載入可用工具（MCP / API 連接器 / 自建 KB）
    │
    ▼
[Step 2] 技能約束（disable / exclusive / append）
    │
    ├─ 有任何工具設定了 Tags？
    │        ▼ YES
    │  [Step 3a] Flash 提取意圖標籤（0~5 個）
    │        ▼
    │  TAG 比對（雙向模糊）
    │        ▼
    │  有匹配候選 → Flash 描述精篩 → 選中工具
    │  無匹配候選 → Flash 對全部工具描述分類
    │
    └─ NO（全部無 Tags）
       [Step 4] Flash 對全部工具描述分類（Fallback）
    │
    ▼
[Step 5] 送給 Gemini → LLM 決定呼叫哪個工具
    │
    ▼
執行工具 → 結果注入 prompt → AI 回覆`}</pre>
            </div>
          </div>
        </SubSection>

        <SubSection title="TAG 路由的判斷規則">
          <Para>系統使用 Gemini Flash 作為「意圖分類器」（不是回答問題），進行兩個階段的判斷：</Para>

          <div className="space-y-3">
            <div className="border border-cyan-200 bg-cyan-50 rounded-lg p-3">
              <div className="text-xs font-semibold text-cyan-700 mb-1">第一階段：TAG 比對（雙向模糊）</div>
              <p className="text-xs text-cyan-600 leading-5">
                Flash 從訊息中提取 0~5 個主題標籤（如 <code className="bg-white px-1 rounded">「人資」「請假」「HR」</code>），
                再與工具 Tags 做雙向部分比對：<br/>
                ✓ <code className="bg-white px-1 rounded">「人資」</code> 比對工具 Tag <code className="bg-white px-1 rounded">「HR人資管理」</code> → 命中<br/>
                ✗ <code className="bg-white px-1 rounded">「庫存」</code> 比對工具 Tag <code className="bg-white px-1 rounded">「人資」</code> → 不命中
              </p>
            </div>
            <div className="border border-purple-200 bg-purple-50 rounded-lg p-3">
              <div className="text-xs font-semibold text-purple-700 mb-1">第二階段：描述精篩（Flash 判斷）</div>
              <p className="text-xs text-purple-600 leading-5">
                對 TAG 比對命中的候選工具，Flash 再讀工具的「說明描述」做更嚴格的判斷，規則：<br/>
                • 核心意圖必須<strong>完全符合</strong>工具說明範疇才選用<br/>
                • 跟進前一輪 AI 問題的回覆，會參考最近 4 則對話上下文繼續使用同工具<br/>
                • 一般聊天、寫作、摘要等不需工具的問題 → 一律不選任何工具<br/>
                • 不確定時，不選用（寧可不呼叫，避免雜訊）
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-green-700 mb-1">✅ 有 Tags → 精準高效</p>
              <p className="text-xs text-green-600 leading-5">
                先縮小候選範圍再精篩，LLM 只需判斷少量工具，準確性高、消耗 Token 少。
              </p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-700 mb-1">⚠️ 無 Tags → Fallback 效果較差</p>
              <p className="text-xs text-orange-600 leading-5">
                Flash 需要閱讀全部工具描述做分類，工具數量多時效果下降，也多消耗 Token。
                建議管理員為每個工具設定 Tags。
              </p>
            </div>
          </div>
        </SubSection>

        <SubSection title="技能（Skill）對工具的影響">
          <Para>掛載技能後，技能可以約束 Auto 模式下的工具範圍。技能設定分三種模式：</Para>
          <Table
            headers={['模式', 'MCP 工具行為', 'KB 工具行為']}
            rows={[
              ['disable', '移除全部 MCP 工具，AI 無法呼叫任何 MCP', '移除全部 API 連接器 + 自建 KB，不做知識庫查詢'],
              ['exclusive（排他）', '只保留技能指定的 MCP 伺服器，其他全移除', '只保留技能指定的 KB，其他全移除'],
              ['append（附加）', '在使用者有存取權的 MCP 之外，強制額外加入技能指定的伺服器', '強制加入技能指定的 KB（即使使用者原本沒有存取權）'],
            ]}
          />
          <NoteBox>
            Code 技能（程式執行工具）永遠附加到工具清單，不受以上模式影響。<br/>
            明確指定模式（Explicit）下，disable 規則仍然生效作為安全防護。
          </NoteBox>
        </SubSection>

        <SubSection title="特殊快速路徑（Fast Path）">
          <Para>以下情況系統會走優化路徑，跳過 Gemini Function Calling，提升回應速度：</Para>
          <Table
            headers={['條件', '行為', '優點']}
            rows={[
              ['只選中 API 連接器（無 MCP）', '並行查詢全部選中的 API 連接器 → 結果直接注入 prompt → AI 整合回覆', '省略 function calling 往返，速度更快'],
              ['只選中自建 KB（無 MCP）', '並行向量檢索全部選中的自建 KB → 結果注入 prompt', '同上'],
              ['混合模式（MCP + KB）', '走 Gemini 原生 function calling，AI 自行決定呼叫哪些工具、呼叫幾次', '靈活性高，可多輪工具調用'],
            ]}
          />
        </SubSection>

        <SubSection title="情境對照表">
          <Table
            headers={['您的操作', '系統行為', '工具覆蓋範圍']}
            rows={[
              ['全部開關關閉', 'Auto 模式：TAG 路由對全部可用工具', '依授權範圍內所有工具'],
              ['開關開啟，未具體勾選', 'Auto 模式：TAG 路由（只看開啟的類別）', '該類別的授權工具'],
              ['下拉勾選具體工具', 'Explicit 模式：直接使用選中工具', '只有您勾選的那幾個'],
              ['掛載技能（disable）', 'Auto 模式，但 Skill disable 先移除對應類別', '受技能限制'],
              ['掛載技能（exclusive）', 'Auto 模式，但只保留技能指定工具', '技能指定的工具'],
            ]}
          />
          <TipBox>
            最精確的方式：下拉選單明確勾選目標工具 + 關閉不需要的類別開關。最省力的方式：所有工具設定好 Tags，讓系統 TAG 路由自動判斷。
          </TipBox>
        </SubSection>

        <SubSection title="使用範例">
          <div className="space-y-3">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <p className="text-xs text-slate-400 mb-2 font-medium">MCP 工具（ERP 查詢）</p>
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
              <p className="text-xs text-slate-400 mb-2 font-medium">自建知識庫 / API 連接器（文件查詢）</p>
              <div className="space-y-1.5">
                {[
                  '「FL-X100 連接器的最大電流規格是多少？」',
                  '「查詢產品 BOM 結構中 PN12345 的規格」',
                  '「生產 SOP 中關於焊接溫度的規定是什麼？」',
                ].map((q, i) => (
                  <div key={i} className="flex gap-2 text-sm text-slate-700">
                    <span className="text-yellow-500">•</span>{q}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <TipBox>
            若沒有看到工具相關選項，表示管理員尚未設定或開放相關功能，可洽 IT 部門申請。
          </TipBox>
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

        <SubSection title="在 Prompt 中直接引用工具（技能 / 知識庫）">
          <Para>
            撰寫排程 Prompt 時，可以直接在文字中引用已建立的技能（Skill）和知識庫（KB），
            系統執行時會自動呼叫對應的工具並將結果注入給 AI 分析。
          </Para>
          <Table
            headers={['語法', '說明', '範例']}
            rows={[
              ['{{skill:技能名稱}}', '執行指定技能，將技能回傳結果注入對話背景', '{{skill:匯率查詢}}'],
              ['{{kb:知識庫名稱}}', '從指定知識庫查詢與 Prompt 相關的段落，注入背景', '{{kb:產品規格庫}}'],
            ]}
          />
          <div className="bg-slate-900 rounded-xl p-4 mt-3">
            <p className="text-xs text-slate-500 mb-2 font-mono">Prompt 引用工具範例</p>
            <pre className="text-sm text-slate-300 font-mono leading-7 whitespace-pre-wrap">{`今天是 {{date}}（{{weekday}}），
請根據以下最新匯率資料 {{skill:匯率查詢}}
以及生產 SOP 規定 {{kb:製程標準庫}}
整理本日需注意事項並以繁體中文條列輸出。`}</pre>
          </div>
          <TipBox>
            撰寫 Prompt 時，輸入 <code className="bg-slate-700 text-slate-200 px-1 rounded text-xs">{`{{skill:`}</code> 或 <code className="bg-slate-700 text-slate-200 px-1 rounded text-xs">{`{{kb:`}</code>
            後，系統會自動彈出技能 / 知識庫名稱選單供快速選取，也可用斜線 <code className="bg-slate-700 text-slate-200 px-1 rounded text-xs">/</code> 觸發同樣的選單。
          </TipBox>
        </SubSection>

        <SubSection title="Pipeline 管線：串接多步驟工作流程">
          <Para>
            Pipeline 讓一個排程任務依序執行多個步驟（節點），前一步的結果可作為後一步的輸入，
            適合需要「查資料 → 分析 → 生成報告 → 寄信」等多階段自動化作業。
          </Para>
          <Para>在任務編輯頁切換至「<strong>Pipeline 管線</strong>」頁籤，點「+ 新增節點」加入步驟。</Para>
          <Table
            headers={['節點類型', '圖示', '說明', '適用場景']}
            rows={[
              ['技能（Skill）', '⚡ 黃色', '呼叫指定技能，將技能回傳結果存入輸出變數', '即時查詢庫存、呼叫外部 API'],
              ['MCP 工具', '🔧 紫色', '直接呼叫 MCP 伺服器的指定工具，傳入 args 參數', '搜尋 Oracle 程式、ERP 資料查詢'],
              ['知識庫（KB）', '📖 綠色', '以 query 文字查詢指定知識庫，取得相關段落', '查 SOP、產品規格、技術文件'],
              ['AI 追加（AI）', '🤖 藍色', '讓 AI 對前一步的結果再做分析/整理，需撰寫 Prompt', '整合多個來源後做二次摘要'],
              ['生成檔案', '📤 靛色', '將前一步 AI 輸出生成特定格式檔案', '輸出 Excel / PDF / PPT / Word'],
              ['條件判斷', '🌿 玫瑰色', '根據前一步輸出進行分支（if/else），支援 AI 判斷或文字比對', '根據異常數量高低分流'],
              ['並行執行', '⑁ 青色', '將多個子步驟同時執行，加速多路查詢', '同時查多個知識庫、多個 API'],
            ]}
          />
          <Para>每個節點都可設定「<strong>失敗時行為</strong>」：</Para>
          <Table
            headers={['失敗行為', '說明']}
            rows={[
              ['continue（繼續）', '此步驟失敗後跳過，繼續執行下一個節點'],
              ['stop（停止）', '此步驟失敗後中止整個 Pipeline，不寄出報告'],
              ['goto（跳轉）', '此步驟失敗後跳到指定節點 ID 繼續執行'],
            ]}
          />
          <div className="bg-slate-900 rounded-xl p-4 mt-3">
            <p className="text-xs text-slate-500 mb-2 font-mono">Pipeline 典型流程範例</p>
            <pre className="text-sm text-slate-300 font-mono leading-7 whitespace-pre-wrap">{`[1] MCP 工具：查詢本日 ERP 不良工單數量
    ↓
[2] 知識庫：查詢相關 SOP 改善措施
    ↓
[3] AI 追加：整合以上資料，撰寫異常摘要報告
    ↓
[4] 生成檔案：輸出為 Excel，檔名 異常報告_{{date}}.xlsx
    ↓（寄出 Email 附附件）`}</pre>
          </div>
          <TipBox>
            Pipeline 與 Prompt 可以同時使用：Prompt 作為主要的 AI 指示，Pipeline 則在 Prompt 執行前先完成資料收集步驟，
            Pipeline 的最終輸出會自動注入到 Prompt 的執行上下文中。
          </TipBox>
          <NoteBox>
            Pipeline 節點數量較多時執行時間會增加，建議使用並行節點加速獨立的查詢步驟。
            若無需多步驟，直接在 Prompt 中使用 <code className="bg-amber-100 text-amber-800 px-1 rounded text-xs">{`{{skill:}}`}</code> / <code className="bg-amber-100 text-amber-800 px-1 rounded text-xs">{`{{kb:}}`}</code> 語法即可，更簡潔。
          </NoteBox>
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
          Cortex 提供類似 ChatGPT 的對話分享功能，您可以將任何一段完整的對話建立為唯讀快照，
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

        <SubSection title="建立技能">
          <div className="space-y-3">
            <StepItem num={1} title="進入技能市集，點選「建立技能」" />
            <StepItem num={2} title="填寫名稱、說明、選擇圖示與技能類型（內建 Prompt / 外部 / Code / Workflow）" />
            <StepItem num={3} title="設定技能的 Tags（標籤）" desc="Tags 決定系統在何時自動啟用此技能。建議設定 2~5 個精準標籤，如「翻譯」「越南文」，讓 TAG 路由機制能正確匹配" />
            <StepItem num={4} title="完成設定後點「儲存」，技能預設為「私人」，僅自己可用" />
          </div>
          <NoteBox>
            技能同樣需要設定 Tags 才能透過 TAG 路由自動啟用。未設定 Tags 的技能只能在對話頂部手動選擇掛載。
          </NoteBox>
        </SubSection>

        <SubSection title="申請技能公開（需管理員審核）">
          <Para>
            建立的技能預設為私人，只有您自己可以使用。若希望分享給全體同仁，需申請公開並通過管理員審核：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="在技能市集的「我的技能」區找到目標技能卡片" />
            <StepItem num={2} title="點選技能卡片右下角的「申請公開」按鈕（地球圖示）" desc="按鈕僅在技能狀態為「私人」且尚未申請時顯示" />
            <StepItem num={3} title="系統將申請送交管理員審核" desc="技能卡片狀態徽章變為橘色「待審核」" />
            <StepItem num={4} title="管理員在後台審核後批准或拒絕" desc="批准後技能狀態變為綠色「公開」，所有員工可在公開技能區看到" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-xs font-semibold text-slate-500 mb-1">私人</p>
              <p className="text-xs text-slate-500 leading-5">灰色徽章，僅自己可見與使用</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <p className="text-xs font-semibold text-amber-600 mb-1">待審核</p>
              <p className="text-xs text-amber-600 leading-5">橘色徽章，申請已送出，等待管理員批准</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
              <p className="text-xs font-semibold text-green-600 mb-1">公開</p>
              <p className="text-xs text-green-600 leading-5">綠色徽章，全員可在公開市集看到並使用或 Fork</p>
            </div>
          </div>
          <TipBox>
            公開技能的其他員工可點選「Fork」複製一份到自己的帳號後自由修改，原始公開版本不受影響。
          </TipBox>
        </SubSection>

        <SubSection title="個人分享技能給特定對象">
          <Para>
            不想公開給全員、只想分享給特定同事？可在技能卡片選單點「分享」，
            選擇分享對象（使用者 / 角色 / 部門）後設定「使用」或「管理」權限，
            對方可在技能市集的「分享給我」區找到此技能。
          </Para>
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
            技能可以綁定特定的自建知識庫與 API 連接器，讓掛載技能時自動啟用相關知識庫，無需使用者手動選取。
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
            每個 MCP 伺服器、API 連接器、自建知識庫及技能都可設定標籤（Tags），系統流程如下：
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
              ['🔌 API', '查詢 API 連接器'],
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
          <TipBox>可以同時掛載「自建知識庫」＋「API 連接器」＋「MCP 工具」，AI 會綜合所有來源回答。
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

        <SubSection title="設定標籤（Tags）— 讓知識庫在對話中被自動啟用的關鍵">
          <div className="flex gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-red-700 text-sm leading-6">
              <strong>重要：必須為知識庫設定標籤（Tags），AI 才能在對話中透過 TAG 路由機制自動找到並使用它。</strong>
              未設定標籤的知識庫只能在對話頂部手動勾選掛載，無法被系統自動匹配。
            </p>
          </div>
          <Para>
            Tags 是讓系統「知道這個知識庫適合回答哪類問題」的關鍵線索。
            系統每次收到使用者訊息時，會先萃取訊息的意圖標籤，再比對所有知識庫的 Tags，
            命中的知識庫才會被自動啟用查詢。
          </Para>
          <Para>如何設定 Tags：</Para>
          <div className="space-y-3">
            <StepItem num={1} title="進入知識庫詳情頁 → 點選「設定」頁籤" />
            <StepItem num={2} title="找到「標籤（Tags）」欄位" desc="在知識庫名稱、描述下方" />
            <StepItem num={3} title="輸入標籤文字後按 Enter，可新增多個標籤" desc="例如：SOP、製程規範、品質手冊、產品規格" />
            <StepItem num={4} title="點「儲存設定」完成" />
          </div>
          <Table
            headers={['好的標籤（推薦）', '不好的標籤（避免）', '原因']}
            rows={[
              ['SOP', '文件', '太模糊，幾乎所有知識庫都符合'],
              ['不良分析、品質管制', '資料', '無法讓系統辨識知識庫主題'],
              ['原物料採購、供應商', '採購', '具體詞彙比單一詞更精準'],
              ['ERP WIP 程式', '程式', '加入領域前綴詞提升比對準確度'],
            ]}
          />
          <TipBox>
            建議每個知識庫設定 3~6 個精準標籤，涵蓋主題的不同說法（例如「SOP」和「標準作業程序」同時設定）。
            標籤設定後可回到對話測試，發現 AI 沒有用到預期知識庫時，可再回頭調整標籤。
          </TipBox>
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
              ['整體資料來源', '為所有子問題預設使用的資料來源：自建知識庫 / API 連接器 / MCP 工具（子問題可個別覆蓋）'],
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
                <p className="text-xs text-slate-500 leading-5">為此子問題指定不同的自建 KB / API 連接器 / MCP 工具，覆蓋 Step 1 設定的任務層級來源。</p>
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
              ['子問題層級', '最高', '若子問題有設定個別 KB / API 連接器 / MCP，以子問題設定為準'],
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
          對話頁面頂端工具列提供多個快速入口（技能、知識庫、API 連接器、MCP 工具、AI 戰情室），
          讓您按需求啟用或停用各項輔助功能。每個開關的狀態僅影響當前及後續的新訊息，
          不會回溯修改已完成的對話。
        </Para>

        <Table
          headers={['開關 / 按鈕', '圖示', '說明', '停用 / 隱藏時行為']}
          rows={[
            ['技能 (Skill)', 'Sparkles ✦ 紫色', '啟用後，AI 回覆前會先查詢符合的技能 Prompt 並套用', '跳過技能注入，AI 以原始模型回答'],
            ['知識庫', 'Database 🗄️ 藍色', '啟用後，AI 回覆前會從已掛載的自建知識庫檢索相關段落', '不做知識庫檢索，直接回答'],
            ['API 連接器', 'Zap ⚡ 琥珀色', '啟用後，AI 可呼叫已掛載的 DIFY / REST API 與 ERP Procedure 工具；面板內分「DIFY / REST」與「ERP Procedure」兩區', '跳過所有 API 連接器呼叫'],
            ['MCP 工具', 'Globe 🌐 青色', '啟用後，AI 可呼叫已設定的 MCP 伺服器（搜尋、程式執行等）', '停用所有 MCP 工具呼叫'],
            ['AI 戰情室快速入口', 'BarChart3 📊 橘色', '點擊後彈出 AI 戰情室主題 / 查詢任務下拉選單，可直接跳入指定查詢頁面', '僅在有「使用 AI 戰情室」權限的帳號才顯示此按鈕'],
          ]}
        />

        <SubSection title="基本操作">
          <div className="space-y-3">
            <StepItem num={1} title="開啟任意對話後，查看頂部工具列" desc="工具列位於對話標題下方，包含各功能圖示按鈕" />
            <StepItem num={2} title="點選按鈕開啟選項面板" desc="技能、知識庫、API 連接器、MCP 四個按鈕會彈出下拉面板，可勾選要啟用的項目；按鈕上會顯示已勾選的數量" />
            <StepItem num={3} title="下次發送訊息即生效" desc="無需重新整理頁面，勾選狀態會記憶在瀏覽器 Session 中" />
          </div>
          <TipBox>
            若您只想進行純文字對話且不需要任何外部資料，建議清空所有勾選以降低延遲與 Token 消耗。
            若對話主題切換（如從「查 SOP」改為「寫程式」），也可即時調整勾選組合。
          </TipBox>
        </SubSection>

        <SubSection title="面板內：排序、隱藏、摺疊">
          <Para>
            技能、知識庫、API 連接器、MCP 四個下拉面板都支援<strong>個人化排序 + 隱藏不常用項目</strong>，
            讓常用工具留在最上方，雜訊項目收進摺疊區。所有設定會記憶在瀏覽器本機（localStorage），
            每個帳號 / 瀏覽器各自獨立。
          </Para>
          <Table
            headers={['功能', '操作方式', '效果']}
            rows={[
              ['上下拖曳排序', '滑鼠按住每列最左邊的「≡」握把（GripVertical 圖示），上下拖到目標位置放開', '該項目移到新位置，排序立即生效並寫入本機'],
              ['隱藏項目', '將滑鼠移到該列 → 左側握把旁會出現藍色圓形「👁️‍🗨️ 關眼」按鈕，點擊即隱藏', '項目從主清單消失，轉移到面板底部「已隱藏 (N)」摺疊區'],
              ['顯示已隱藏區', '面板底部的「▾ 已隱藏 (N)」列，點擊展開 / 收合', '展開後可看到所有被隱藏的項目（半透明顯示）'],
              ['取消隱藏', '在「已隱藏」區中，點擊該列的藍色「👁️ 開眼」按鈕', '項目回到主清單，回復可勾選狀態'],
              ['搜尋', '面板頂部搜尋框輸入關鍵字', '搜尋模式下不顯示拖曳握把，暫停排序以避免誤觸'],
            ]}
          />
          <NoteBox>
            隱藏的項目<strong>不會</strong>同步到伺服器或其他裝置，僅存在目前瀏覽器。
            清除瀏覽器資料（或換裝置）後，全部項目會重新顯示。
          </NoteBox>
          <TipBox>
            ERP Procedure 每列末端有「?」按鈕，點擊可展開該 Procedure 的輸入 / 輸出參數說明、
            資料型別與 AI 提示（ai_hint），方便了解該工具的功能範圍。
            「🔒」圖示代表該參數不可由使用者覆寫（預設值由管理員鎖定）。
          </TipBox>
          <NoteBox>
            各面板僅在對應功能已設定的情況下才有項目可選：知識庫需管理員或您本人已建立；
            API 連接器需管理員已設定 DIFY / REST 或 ERP Procedure；MCP 需管理員已啟用 MCP 伺服器。
            若面板為空，下方會有「前往設定」連結（僅管理員可見）。
          </NoteBox>
        </SubSection>
      </Section>

      <Section id="u-lang" icon={<Globe size={22} />} iconColor="text-sky-500" title="語言切換與多語設定">
        <Para>
          Cortex 完整支援<strong>繁體中文（繁中）、英文（EN）、越南文（VI）</strong>三種語言，
          涵蓋 UI 介面語言切換及內容多語翻譯兩個層面，讓不同語系的同仁都能流暢使用。
        </Para>

        <SubSection title="切換 UI 介面語言">
          <div className="space-y-3">
            <StepItem num={1} title="點選左側邊欄底部的「🌐 語言切換」按鈕" desc="顯示目前語言名稱（如「繁體中文」），點擊展開語言選單" />
            <StepItem num={2} title="從選單中選擇目標語言" desc="繁體中文 🇹🇼 / English 🇺🇸 / Tiếng Việt 🇻🇳" />
            <StepItem num={3} title="介面語言立即切換" desc="所有 UI 文字、按鈕、提示訊息均切換為所選語言，無需重新整理頁面" />
          </div>
          <Para>
            語言偏好設定會同步儲存到您的帳號（伺服器端），下次登入後自動套用，與瀏覽器無關。
          </Para>
          <TipBox>
            對話標題（Session Title）支援三語版本。切換語言後，歷史對話的標題也會自動顯示對應語言版本
            （若建立時系統已翻譯）。
          </TipBox>
        </SubSection>

        <SubSection title="內容多語翻譯機制">
          <Para>
            系統各功能中的名稱、說明等文字欄位均支援三語版本（繁中 / EN / VI）。
            翻譯的觸發方式分為<strong>自動翻譯</strong>和<strong>手動翻譯</strong>兩種，
            不同功能模組的處理方式不同，請依下表了解各場景的行為：
          </Para>
          <Table
            headers={['功能 / 場景', '翻譯觸發方式', '說明']}
            rows={[
              ['技能（Skill）名稱 / 說明', '儲存時自動翻譯', '點「儲存」後，系統自動呼叫 AI 翻譯成三語並儲存'],
              ['知識庫（KB）名稱 / 說明', '建立時自動翻譯', '點「建立」後自動翻譯，也可事後手動重新翻譯'],
              ['對話標題（Session Title）', '重新命名時自動翻譯', '手動改名後系統背景自動翻譯為英文與越南文'],
              ['AI 戰情室命名查詢參數標籤', '手動按翻譯按鈕', '參數標籤旁有「↻」按鈕，點擊後 AI 翻譯並填入 EN / VI 欄位'],
              ['AI 戰情室圖表標題 / 軸名', '手動按翻譯按鈕', '圖表標題、X / Y 軸名稱旁各有翻譯按鈕，一鍵填入三語'],
              ['儀表板名稱', '手動按翻譯按鈕', '編輯儀表板時可點翻譯按鈕自動填入英文與越南文'],
            ]}
          />
          <NoteBox>
            自動翻譯在儲存時背景執行，通常只需數秒。若翻譯失敗（如 AI 服務暫時中斷），
            欄位會保留空白或原語言內容，可事後使用「重新翻譯」功能重跑。
          </NoteBox>
        </SubSection>

        <SubSection title="手動重新翻譯">
          <Para>
            技能市集、知識庫市集等設定頁中，名稱 / 說明欄位下方有一個
            <strong>「多語翻譯」展開區（Language 圖示）</strong>，點擊展開後可看到三語版本的當前內容，
            並提供「↻ 重新翻譯」按鈕：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="展開多語翻譯區（點 Languages 圖示或箭頭）" desc="顯示 繁中 / EN / VI 三欄翻譯內容" />
            <StepItem num={2} title="直接修改任一欄位內容（選用）" desc="可手動覆寫自動翻譯的結果" />
            <StepItem num={3} title="點擊「↻ 重新翻譯」按鈕" desc="以目前的繁中內容為基礎，重新呼叫 AI 翻譯，填入 EN 和 VI 欄位" />
            <StepItem num={4} title="儲存設定使翻譯生效" />
          </div>
          <TipBox>
            手動修改的翻譯內容在儲存後可以再次點「重新翻譯」覆蓋，或保留手動版本不動。
            翻譯以<strong>繁中版本</strong>為主要來源，若繁中欄位為空，翻譯結果可能不正確。
          </TipBox>
        </SubSection>

        <SubSection title="各語言版本顯示邏輯">
          <Para>
            當系統以某語言顯示內容（如技能名稱、對話標題）時，使用以下 fallback 順序：
          </Para>
          <Table
            headers={['切換到 / 目前語言', '優先顯示', '備用（若翻譯空白）']}
            rows={[
              ['繁體中文（繁中）', 'name_zh / title_zh', '原始 name / title 欄位'],
              ['English（EN）', 'name_en / title_en', '繁中版本 → 原始欄位'],
              ['Tiếng Việt（VI）', 'name_vi / title_vi', '繁中版本 → 原始欄位'],
            ]}
          />
          <NoteBox>
            若切換到英文或越南文後，某些技能名稱 / 知識庫名稱仍顯示中文，
            代表該項目尚未翻譯。可進入設定頁手動觸發翻譯。
          </NoteBox>
        </SubSection>
      </Section>

      <Section id="u-budget" icon={<DollarSign size={22} />} iconColor="text-emerald-500" title="對話額度限制">
        <Para>
          系統管理員可為帳號或角色設定使用金額上限，當用量接近或超過限制時，
          對話頁面<strong>頂部工具列</strong>會出現金額指示器，讓您隨時掌握自己的用量狀況。
        </Para>

        <SubSection title="指示器顯示位置">
          <Para>
            金額指示器位於<strong>對話頁面頂部工具列右側</strong>，分日 / 週 / 月三種週期，
            管理員可分別設定，您可能同時看到一個或多個指示器：
          </Para>
          <Table
            headers={['週期', '重設時間', '顯示標籤範例']}
            rows={[
              ['每日限額', '每天凌晨 00:00 重設', '日 $0.12/$1.00'],
              ['每週限額', '每週一 00:00 重設', '週 $3.50/$10.00'],
              ['每月限額', '每月 1 日 00:00 重設', '月 $12.80/$50.00'],
            ]}
          />
          <Table
            headers={['指示器顏色', '意義']}
            rows={[
              ['灰色（正常）', '目前用量在上限 80% 以內，一切正常，可正常使用'],
              ['橘色（接近上限）', '目前用量超過上限的 80%，請留意使用量，即將達到限制'],
              ['紅色（已超出）', '當前週期用量已達上限，依限制模式決定後續行為（見下方說明）'],
            ]}
          />
          <NoteBox>
            金額計算基於 Token 用量乘以各模型定價。若管理員尚未設定模型定價，顯示金額可能為 $0.000，此情況請洽管理員確認。
            系統管理員帳號不受金額限制，不會顯示此指示器。
          </NoteBox>
        </SubSection>

        <SubSection title="額度超過後的限制方式">
          <Para>
            管理員可針對每個<strong>角色（Role）或個別使用者</strong>分別設定超過額度後的行為模式：
          </Para>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-amber-500" />
                <span className="font-semibold text-amber-700 text-sm">警告模式（warn）</span>
              </div>
              <p className="text-xs text-amber-700 leading-5">
                超過額度後仍<strong>可繼續對話</strong>，但頂部指示器會顯示紅色警告，
                提醒您已超出本週期限額。適合主管或核心業務人員，確保不影響工作。
              </p>
            </div>
            <div className="border border-red-200 rounded-xl p-4 bg-red-50">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-red-500" />
                <span className="font-semibold text-red-700 text-sm">禁止模式（block）</span>
              </div>
              <p className="text-xs text-red-700 leading-5">
                超過額度後<strong>無法繼續發送新訊息</strong>，系統回覆「已達使用上限」提示，
                需等待下個週期重設後才能繼續使用。
              </p>
            </div>
          </div>
          <TipBox>
            若您在重要工作時突然收到「已達使用上限」拒絕訊息，請洽系統管理員臨時調整限額或切換為警告模式。
          </TipBox>
        </SubSection>

        <SubSection title="消耗趨勢查看">
          <Para>
            想了解自己過去一段時間的 Token 用量與費用分布？點選頂部工具列的
            <strong>「📈 消耗趨勢」按鈕（TrendingUp 圖示）</strong>，開啟個人用量統計面板：
          </Para>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-2 font-medium">消耗趨勢面板功能</p>
            <ul className="space-y-1.5">
              {[
                '折線圖：顯示過去 N 天各模型每日費用走勢（多條線按模型分色）',
                '時間範圍：可切換查看最近 7 天 / 30 天 / 90 天',
                '總計：面板頂部顯示所選時間內的總費用及總 Token 數',
                '各模型彙總：底部表格列出每種模型的輸入 / 輸出 Token 及費用',
              ].map((item, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-600">
                  <span className="text-blue-400">•</span>{item}
                </li>
              ))}
            </ul>
          </div>
          <TipBox>
            消耗趨勢讓您一目了然各模型的使用分布，若某天費用明顯偏高，
            可回到對話歷史找出當天的深度研究或大型文件分析任務加以調整。
          </TipBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ AI 戰情室 */}

      <Section id="u-ai-bi" icon={<BarChart3 size={22} />} iconColor="text-orange-500" title="AI 戰情室">
        <Para>
          AI 戰情室是一套以自然語言驅動的企業 ERP 資料查詢與視覺化平台，
          讓您無需懂 SQL 就能直接對 Oracle ERP 資料庫提問，即時取得報表、圖表，
          並可儲存常用查詢組合成彈性的 BI 儀表板。
          <strong>系統透過資料政策控管每位使用者的資料可視範圍</strong>，確保員工只能看到其職責範圍內的 ERP 資料。
        </Para>

        <Table
          headers={['功能模組', '說明']}
          rows={[
            ['自然語言查詢', '用中文提問，系統自動生成並執行 SQL，回傳結果與圖表'],
            ['資料政策（Data Policy）', '四層過濾機制，依使用者 / 角色 / 組織 / ERP Multi-Org 控管資料可視範圍'],
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

        <SubSection title="資料政策（Data Policy）— 資料可視範圍控管">
          <Para>
            AI 戰情室的查詢結果受<strong>資料政策</strong>控管，系統在執行 SQL 前會自動在 WHERE 條件加入
            使用者所屬的組織過濾條件，確保每位員工只能看到其職責範圍內的 ERP 資料。
            此機制完全在後端執行，使用者無法繞過。
          </Para>
          <Para>資料政策採用<strong>四層過濾架構</strong>，由管理員在後台設定：</Para>
          <Table
            headers={['層次', '過濾維度', '說明']}
            rows={[
              ['第 1 層 使用者過濾', '指定使用者帳號', '為特定使用者設定個人化的資料限制，優先級最高'],
              ['第 2 層 角色過濾', '角色群組', '為一整個角色（如「廠長」「生管人員」）設定統一過濾條件'],
              ['第 3 層 人事組織過濾', '部門 / 利潤中心 / 事業處 / 事業群 / 組織代碼', '依人事系統的組織歸屬自動過濾，支援「依員工組織自動推導」'],
              ['第 4 層 ERP Multi-Org 過濾', '製造組織 / 營運單位 / 帳套', '依 Oracle ERP 的 Multi-Org 架構過濾，控管跨廠區資料存取'],
            ]}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-blue-500" />
                <span className="font-semibold text-blue-700 text-sm">人事組織自動推導</span>
              </div>
              <p className="text-xs text-blue-600 leading-5">
                第 3 層設定「依員工組織自動推導（auto_from_employee）」時，
                系統自動讀取登入者在 HR 系統的部門、利潤中心、事業處、事業群歸屬，
                不需手動逐一指定每位員工，異動職位時自動生效。
              </p>
            </div>
            <div className="border border-orange-200 rounded-xl p-4 bg-orange-50">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={14} className="text-orange-500" />
                <span className="font-semibold text-orange-700 text-sm">ERP Multi-Org 自動推導</span>
              </div>
              <p className="text-xs text-orange-600 leading-5">
                第 4 層設定「依員工組織自動推導」時，系統對應 Oracle ERP 中的製造組織代碼（如 Z4E）或營運單位，
                查詢時自動加上 ORGANIZATION_ID 或 ORG_ID 的 WHERE 條件，限制看到的廠區資料。
              </p>
            </div>
          </div>

          <Table
            headers={['常見組織維度', '說明', '範例']}
            rows={[
              ['部門代碼（DEPT_CODE）', '依人事系統部門代碼過濾', '只看 MFG01 部門的資料'],
              ['利潤中心（Profit Center）', '依利潤中心代碼過濾', '只看所屬利潤中心的損益資料'],
              ['事業處（Org Section）', '依事業處代碼過濾', '中國廠 / 台灣廠 / 越南廠分隔'],
              ['製造組織（Organization Code）', '對應 ERP mtl_parameters.organization_code', '如 Z4E（漳州廠）、TWE（台灣廠）'],
              ['營運單位（Operating Unit）', '對應 Oracle MO 架構的 operating_unit 欄位', '區分不同 Operating Unit 的 AP/AR'],
            ]}
          />

          <NoteBox>
            <strong>超級使用者（super_user）</strong>：若管理員為特定使用者或角色設定第 3 / 4 層為「超級使用者（無限制）」，
            該帳號可查看所有組織的資料，不受組織過濾限制。通常僅授予 IT 管理人員或最高主管。
          </NoteBox>
          <TipBox>
            若您查詢某廠區資料時顯示空白或數量明顯偏少，很可能是資料政策將您的可視範圍限制在特定組織。
            請洽系統管理員確認您的資料政策設定。
          </TipBox>
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

      {/* ═══════════════════════════════════════════════════ Schema 與多資料庫來源 */}

      <Section id="u-ai-bi-schema" icon={<Database size={22} />} iconColor="text-cyan-600" title="Schema 與多資料庫來源">
        <Para>
          AI 戰情室的自然語言查詢能力，建立在<strong>多資料庫來源（DB Sources）</strong>與
          <strong> Schema 知識庫</strong>的設計上。設計者（具備「開發 AI 戰情室」權限的帳號）
          可以為不同的資料庫連線建立 Schema，讓 AI 知道哪些資料表可查、有哪些欄位、欄位代表什麼業務意義，
          從而生成精準的 SQL。系統支援 <strong>Oracle、MySQL、MSSQL</strong> 三種資料庫，
          且同一個查詢專案中可同時引用來自不同資料庫的多個 Schema，實現跨庫查詢。
        </Para>

        <SubSection title="整體架構概覽">
          <Table
            headers={['層次', '名稱', '說明']}
            rows={[
              ['1', '外部資料來源（DB Source）', '系統管理員在後台設定的 Oracle/MySQL/MSSQL 連線，含 Host/Port/帳密/連線池'],
              ['2', '戰情專案（Project）', '設計者建立的邏輯分組，一個專案包含多個 Schema + Topic + Design'],
              ['3', 'Schema 知識庫', '對應到 DB Source 中某個資料表/視圖/子查詢，並說明各欄位業務意義'],
              ['4', 'Join 定義', '說明 Schema 間的 JOIN 關係，輔助 AI 生成跨表 SQL'],
              ['5', '主題 / 查詢任務（Topic / Design）', '終端使用者看到的查詢分類與具體任務，引用一或多個 Schema'],
            ]}
          />
          <TipBox>
            每個 Schema 各自指定一個 DB Source，因此同一專案的不同 Schema 可以分別來自
            Oracle ERP 主機、MySQL 分析資料庫、MSSQL 報表庫等不同系統，AI 生成 SQL 時會路由到正確的資料庫執行。
          </TipBox>
        </SubSection>

        <SubSection title="Step 1：設定外部資料來源（DB Source）">
          <Para>
            進入後台管理 → 「AI 戰情室 — 外部資料來源」頁籤（系統管理員才能看到）。點擊「+ 新增來源」，填入以下欄位：
          </Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['名稱', '此連線的識別用標籤', 'ERP Oracle 主機、MySQL 分析庫'],
              ['資料庫類型', 'Oracle / MySQL / MSSQL', 'oracle'],
              ['Host', '資料庫伺服器 IP 或網域', '192.168.10.10'],
              ['Port', 'Oracle=1521，MySQL=3306，MSSQL=1433', '1521'],
              ['Service Name（Oracle）', 'Oracle Service Name / SID', 'ORCL'],
              ['Database Name（MySQL/MSSQL）', '目標資料庫名稱', 'erp_db'],
              ['帳號 / 密碼', '查詢帳號（建議使用唯讀帳號）', 'apps / ••••••'],
              ['Pool Min / Max', '連線池大小，依查詢頻率調整', '1 / 5'],
              ['狀態', '啟用或停用此連線', '啟用'],
            ]}
          />
          <Para>儲存後，可點擊每個來源的 <strong>Wifi 圖示</strong>測試連線（Ping），確認連線成功後才能在 Schema 中使用。</Para>
          <NoteBox>
            連線測試會實際執行 SELECT 1 驗證到達目標資料庫的網路與帳密是否正確。
            若顯示「連線失敗」，請確認防火牆已開放對應 Port 及帳號權限。
          </NoteBox>
        </SubSection>

        <SubSection title="Step 2：在設計者介面建立 Schema">
          <Para>
            具備「開發 AI 戰情室」權限的帳號，在 AI 戰情室底部點擊「⊞ 設計者模式」進入設計面板，
            選擇目標<strong>專案</strong>後，點擊「Schema 知識庫」頁籤，即可新增 Schema。
          </Para>
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['資料表/視圖名稱', '格式為 OWNER.TABLE_NAME（如 APPS.WO_ABNORMAL_V）或純表名（如 WO_ABNORMAL_V）'],
              ['顯示名稱（中/英/越）', 'AI 提示詞與介面顯示用的友善名稱，儲存後自動翻譯英文/越文'],
              ['別名（alias）', 'SQL 中引用此 Schema 的短代號，如 wo_abnormal，需為小寫英數字'],
              ['來源類型', 'Table（實體表）/ View（視圖）/ SQL（自訂子查詢，可做複雜預處理）'],
              ['資料來源（DB Source）', '從已設定的 DB Sources 選擇此 Schema 對應哪個資料庫連線'],
              ['業務說明（business_notes）', '告訴 AI 此資料表的業務用途，影響 AI 生成 SQL 的準確性'],
              ['Join 提示（join_hints）', '說明此表常見的 JOIN 條件，輔助跨表查詢'],
              ['基礎過濾條件（Base Conditions）', '每次生成 SQL 都會自動加入的 WHERE 條件，如有效狀態過濾'],
            ]}
          />
          <TipBox>
            <strong>多資料庫跨庫設計</strong>：同一個專案中，可以新增多個 Schema 各自指定不同的 DB Source。
            設計者在查詢任務（Design）的 Schema 欄位選擇器中勾選所需 Schema，AI 執行時會分別對各 Schema 對應的 DB Source 下查，
            再合併結果回傳。這樣可實現如「ERP Oracle + MySQL 分析庫」的跨庫自然語言查詢。
          </TipBox>
        </SubSection>

        <SubSection title="Step 3：管理 Schema 欄位說明">
          <Para>
            Schema 建立後，點擊欄位清單圖示（Columns）進入欄位說明編輯介面，
            為每個欄位填入<strong>業務意義說明</strong>（description），這是 AI 正確理解欄位用途的關鍵：
          </Para>
          <Table
            headers={['操作', '說明']}
            rows={[
              ['手動編輯說明', '逐欄填入中文業務說明，也可補充英文（desc_en）、越文（desc_vi）'],
              ['匯出 CSV', '點「匯出 CSV」下載欄位清單，可在 Excel 批次填寫後再匯入'],
              ['匯入 CSV', '填好的 CSV（欄位 column_name, description, desc_en, desc_vi）直接匯入更新'],
              ['虛擬欄位（Virtual Column）', '定義計算欄位，如 TO_CHAR(order_date, \'YYYYMM\') 作為年月分組維度'],
              ['Oracle 函數範本', '虛擬欄位提供 Oracle 常用函數範本選單，如 TRUNC/EXTRACT/NVL/ROUND 等'],
            ]}
          />
          <NoteBox>
            欄位說明品質直接影響 AI 生成 SQL 的準確性。建議至少為查詢條件欄位、維度欄位、金額欄位填入中文說明。
            欄位說明可隨時更新，無需重建 Schema。
          </NoteBox>
        </SubSection>

        <SubSection title="從 Oracle 批次匯入 Schema">
          <Para>
            若要快速將多個 Oracle ERP 資料表登錄到 Schema 知識庫，可使用<strong>批次匯入</strong>功能：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="點擊 Schema 頁籤右上方「從 Oracle 批次匯入」按鈕" />
            <StepItem num={2} title="選擇資料來源（DB Source）" desc="選擇目標 Oracle 連線，通常為 ERP 主機" />
            <StepItem num={3} title="填寫預設 Owner（Schema Owner）" desc="如 APPS，系統在無前綴的表名前自動補上此 Owner" />
            <StepItem num={4} title="在文字框貼上資料表清單" desc="每行一個表名，格式範例：WO_ABNORMAL_V / APPS.MTL_SYSTEM_ITEMS_B / HR.EMPLOYEES（支援混搭不同 Owner）" />
            <StepItem num={5} title="點「開始匯入」" desc="系統向 Oracle Data Dictionary 查詢各表的欄位清單，自動建立 Schema 及欄位（每次最多 50 個表）" />
            <StepItem num={6} title="查看匯入結果" desc="成功的顯示 ✓ 表名 — N 欄；查無此表的顯示 ✗（請確認 Owner 與表名是否正確）" />
          </div>
          <TipBox>
            批次匯入只建立 Schema 骨架與欄位名稱/型態，欄位的<strong>業務意義說明仍需手動補充</strong>（或匯出 CSV 填寫後匯回）。
          </TipBox>
        </SubSection>

        <SubSection title="複製 Schema 到其他專案">
          <Para>
            設計者可從其他專案複製現有 Schema 到目前專案，避免重複設定相同的 ERP 基礎表：
            點擊 Schema 清單右上方「複製來源 Schema」按鈕，搜尋並選取其他專案的 Schema 即可複製，
            複製後可獨立修改不影響原始。
          </Para>
        </SubSection>

        <SubSection title="多資料庫查詢流程（進階）">
          <Para>
            當一個查詢任務（Design）引用了來自不同 DB Source 的多個 Schema 時，查詢流程如下：
          </Para>
          <Table
            headers={['步驟', '說明']}
            rows={[
              ['1. LLM SQL 生成', 'AI 根據使用者問題與所有選取 Schema 的欄位說明，生成各個 Schema 對應的 SQL 片段'],
              ['2. 路由執行', '後端依照每個 SQL 片段對應的 source_db_id，向對應的 DB Source 各自發出查詢'],
              ['3. 結果合併', '各 DB 回傳結果後，若有跨庫 JOIN 需求則在應用層合併，最終整合回傳給前端'],
              ['4. 資料政策套用', '每個 DB 查詢在生成 SQL 時均套用該使用者的資料政策過濾條件，確保資料安全'],
            ]}
          />
          <NoteBox>
            目前跨庫 JOIN 需在 LLM Prompt 層面透過業務說明指引 AI 生成分開的查詢再合併，
            不支援在同一 SQL 語句中跨庫 JOIN（因屬不同資料庫連線）。
            設計建議：若需跨 Oracle ERP + MySQL 的組合報表，可設計兩個 Design 分別查詢，
            或透過 ETL 預先將資料同步到單一庫後再設定 Schema。
          </NoteBox>
        </SubSection>
      </Section>

      <Section id="u-help-kb" icon={<BookMarked size={22} />} iconColor="text-blue-500" title="AI 回答使用問題">
        <Para>
          Cortex 內建了一套<strong>使用說明知識庫</strong>，涵蓋系統所有功能的操作方式。
          您可以直接在對話框向 AI 提問，不需要翻閱說明書，AI 會從知識庫中找到最相關的說明回答您。
        </Para>

        <SubSection title="如何詢問">
          <Para>只要在任意對話中，用自然語言描述您的問題即可：</Para>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {[
              { q: '怎麼上傳 PDF 檔案？', tag: '上傳' },
              { q: '如何建立自動排程任務？', tag: '排程' },
              { q: '深度研究和一般對話有什麼差別？', tag: '深度研究' },
              { q: '技能（Skill）要怎麼掛載到對話？', tag: '技能' },
              { q: 'TAG 路由是什麼意思？', tag: '工具' },
              { q: '知識庫要設定什麼標籤才會被自動啟用？', tag: '知識庫' },
              { q: '對話額度超過後還能繼續使用嗎？', tag: '額度' },
              { q: '如何分享對話給同事？', tag: '分享' },
            ].map((item) => (
              <div key={item.q} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-blue-400 mt-0.5 flex-shrink-0">💬</span>
                <p className="text-xs text-slate-700 leading-5">{item.q}</p>
              </div>
            ))}
          </div>
          <TipBox>
            要讓 AI 優先從說明書回答，可以在問題中加上「使用說明」「怎麼操作」「如何設定」等語詞，
            系統的 TAG 路由機制會自動偵測並查詢說明書知識庫。
          </TipBox>
        </SubSection>

        <SubSection title="適合詢問的問題類型">
          <Table
            headers={['問題類型', '範例']}
            rows={[
              ['操作步驟', '「排程任務要怎麼建立？步驟是什麼？」'],
              ['功能差異', '「Gemini Pro 和 Flash 有什麼不同？」'],
              ['設定說明', '「知識庫的 Embedding 維度要選哪個？」'],
              ['工具使用', '「MCP 工具和自建知識庫怎麼一起用？」'],
              ['錯誤排解', '「為什麼 AI 沒有使用我掛載的知識庫？」'],
              ['概念理解', '「TAG 路由的第一階段和第二階段有什麼區別？」'],
            ]}
          />
        </SubSection>

        <SubSection title="說明書知識庫的範圍">
          <Para>
            說明書知識庫涵蓋本使用說明的所有章節（共 21 個），包含：
          </Para>
          <div className="flex flex-wrap gap-2 mt-2">
            {['登入與登出', '介面導覽', '開始對話', 'AI 模型選擇', '上傳檔案',
              '對話歷史', '可用工具 / TAG路由', '自動排程', '圖片生成',
              '技能 Skill', '知識庫市集', '深度研究', '語言切換', '對話額度',
              'AI 戰情室', '命名查詢', 'Schema 欄位', '圖表建構器', '儀表板', '文件範本'].map((label) => (
              <span key={label} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{label}</span>
            ))}
          </div>
          <NoteBox>
            說明書知識庫由系統自動維護，每次系統更新後會自動同步最新內容，您不需要做任何設定。
          </NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════ 文件範本 */}
      <Section id="u-doc-template" icon={<LayoutTemplate size={22} />} iconColor="text-indigo-500" title="文件範本">
        <Para>
          <strong>文件範本庫</strong>讓您預先定義帶有<strong>變數佔位符</strong>的 Word、Excel 或 PDF 文件，
          之後只需填入資料，系統自動輸出格式完整的正式文件。適合會議紀錄、報告、表單等重複性文件的產出。
        </Para>
        <Table
          headers={['支援格式', '引擎', '說明']}
          rows={[
            ['Word (DOCX)', 'docxtemplater', '保留原始字型、樣式、表格，原生 {{變數}} 替換'],
            ['Excel (XLSX)', 'ExcelJS', '儲存格佔位符替換，保留公式與格式'],
            ['PowerPoint (PPTX)', 'JSZip XML 替換', '保留原始品牌設計，支援封面/內頁/封底分類，可重複內頁自動展開多頁，支援行距/列標樣式設定'],
            ['PDF', 'pdf-lib / AI 重建', 'AcroForm 表單欄位優先；無表單時由 AI 識別後重建'],
          ]}
        />

        <SubSection title="進入文件範本庫">
          <Para>從左側邊欄點選<strong>文件範本</strong>圖示（LayoutTemplate 圖示），進入範本管理頁面。</Para>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
            {[
              { icon: '📁', title: '我的範本', desc: '您建立的所有範本' },
              { icon: '🌐', title: '分享給我 / 公開', desc: '他人分享或公開的範本' },
              { icon: '🔍', title: '搜尋篩選', desc: '依名稱或格式快速篩選' },
            ].map(item => (
              <div key={item.title} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="text-lg mb-1">{item.icon}</div>
                <p className="text-xs font-semibold text-slate-700">{item.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title="新增範本（上傳精靈）">
          <div className="space-y-3">
            <StepItem num={1} title="點選右上角「新增範本」藍色按鈕" />
            <StepItem num={2} title="拖曳或點選上傳您的文件" desc="支援 DOCX、XLSX、PPTX、PDF，系統自動讀取內容" />
            <StepItem num={3} title="AI 自動分析：識別文件中的變數" desc="例如：{{姓名}}、{{日期}}、{{金額}}，並列出建議的變數清單" />
            <StepItem num={4} title="確認或調整變數設定" desc="可修改變數名稱、類型（文字/數字/日期/選項）、是否必填、預設值。若為 PPTX，可在此設定每張投影片的類型" />
            <StepItem num={5} title="填寫範本名稱、描述、標籤，點選「建立」完成" />
          </div>
          <TipBox>
            AI 識別的變數準確度約 85–95%，建議上傳前先確認文件中的佔位文字清晰，
            例如「請輸入姓名」比「XXX」更容易被正確識別。
          </TipBox>
        </SubSection>

        <SubSection title="PPTX 投影片範本設計">
          <Para>
            上傳 PPTX 後，系統會<strong>自動偵測並分類</strong>每張投影片的版型，無需手動設定。
            支援四種版型，系統依位置和欄數自動判斷：
          </Para>
          <Table
            headers={['版型', '自動判斷條件', '注入的佔位符']}
            rows={[
              ['cover（封面）', '第 1 張投影片', '{{cover_title}}、{{cover_subtitle}} 等（依原始文字框自動命名）'],
              ['bullets（條列）', '非封面/封底，且欄數 &lt; 3', '{{slide_title}}、{{slide_content}}（以 \\n 分隔每條重點）'],
              ['3col（三欄）', '非封面/封底，欄數 ≥ 3', '{{slide_title}}、{{col1_title}}、{{col1_content}}（三欄各一組）'],
              ['closing（封底）', '最後一張（簡報超過 2 張時）', '{{closing_title}}、{{closing_message}} 等'],
            ]}
          />
          <Para>
            AI 提供的 <code className="bg-slate-100 px-1 rounded">slides[]</code> 陣列中，每個元素可指定
            <code className="bg-slate-100 px-1 rounded">type: "bullets"</code> 或
            <code className="bg-slate-100 px-1 rounded">type: "3col"</code>，
            系統根據 type 選擇對應的範本投影片複製並填入資料。
          </Para>
          <Para>
            <strong>AI 排版引擎（自動）</strong>會在文件生成前對 slides[] 進行以下處理：
          </Para>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            {[
              { icon: '✂️', title: '自動拆頁', desc: 'bullets 超過 6 條重點時，自動拆分成下一張，標題加「（續）」' },
              { icon: '📏', title: '長句壓縮', desc: '每條重點超過 30 字時，AI 自動壓縮核心意思' },
              { icon: '📐', title: '3欄升級', desc: '3 個平行條列項目（如方案比較）自動升級為 3col 版型' },
              { icon: '🔤', title: 'AI 智慧命名', desc: 'AI 自動產生報告標題作為封面名稱，並以「主題_日期」格式命名下載檔案' },
              { icon: '🚫', title: '過濾參考文獻', desc: 'Google 搜尋產生的參考來源連結自動過濾，不會出現在簡報中' },
            ].map(item => (
              <div key={item.title} className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-lg mb-1">{item.icon}</div>
                <p className="text-xs font-semibold text-slate-700">{item.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>
          <TipBox>
            <strong>縮圖預覽：</strong>建立範本後，可在投影片設定卡片上點擊縮圖區塊，
            上傳各投影片的截圖（直接在 PowerPoint 中「另存新檔 → PNG」即可）。
            之後在設定畫面就能以圖片預覽確認每張 slide 的版型。
          </TipBox>
          <NoteBox>
            PPTX 生成時，系統以 XML 層級替換佔位符，完整保留原始的背景圖、色彩、字型、Logo，
            條列重點以真實的段落（&lt;a:p&gt;）展開，非純文字換行，確保 PowerPoint 顯示正確。
          </NoteBox>
        </SubSection>

        <SubSection title="PPTX 樣式設定：行距與列標">
          <Para>
            在<strong>樣式設定</strong>頁籤中，可以針對投影片內容（<code className="bg-slate-100 px-1 rounded">slide_content</code>）
            設定行距和列標符號。設定後所有自動生成的內頁投影片都會套用。
          </Para>
          <Table
            headers={['設定項目', '選項', '說明']}
            rows={[
              ['行距', '沿用 / 1.0 / 1.15 / 1.5 / 2.0 / 2.5 / 3.0', '控制每條重點之間的行間距，「沿用」保留範本原始設定'],
              ['列標', '沿用 / 無 / • 圓點 / ✓ 勾選 / ■ 方塊 / ○ 空心圓 / ▸ 三角 / – 短橫 / ★ 星號 / ➤ 箭頭', '每條重點前方的符號，「無」表示無符號，「沿用」保留範本原始設定'],
              ['字型大小', '數字 (pt)', '留空 = 保留範本原始大小；填入數字則覆寫所有內容文字'],
            ]}
          />
          <TipBox>
            這些設定僅影響 override，留空或選「沿用」時完全保留範本 PPTX 原始的格式設定。
          </TipBox>
        </SubSection>

        <SubSection title="使用範本生成文件">
          <Para>共有五種方式可以套用範本產生文件：</Para>
          <div className="space-y-3 mt-2">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-indigo-700 mb-2 flex items-center gap-2">
                <LayoutTemplate size={15} /> 方式 1：在對話輸入框選擇範本
              </p>
              <p className="text-xs text-indigo-600 leading-5">
                點選輸入框左方的<strong>「範本」圖示</strong>，從彈出清單選擇範本，
                系統會在訊息前方附加 <code className="bg-indigo-100 px-1 rounded">[使用範本:名稱]</code> 標記，
                AI 自動以對話內容填入變數並在回應中提供下載連結。
                檔名格式為<strong>「AI產生的報告主題_日期.副檔名」</strong>（如：美國關稅政策分析_20260329.pptx），
                封面標題也會自動使用 AI 產生的報告名稱。
              </p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-2">
                <FileSpreadsheet size={15} /> 方式 2：從範本卡片點選「生成」
              </p>
              <p className="text-xs text-blue-600 leading-5">
                在文件範本庫找到目標範本，點選卡片上的<strong>「生成」按鈕</strong>，
                系統彈出填寫表單，依序輸入所有變數後點選「生成」，即可下載完成的文件。
              </p>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-purple-700 mb-2 flex items-center gap-2">
                <Sparkles size={15} /> 方式 3：透過 Skill 技能自動套用
              </p>
              <p className="text-xs text-purple-600 leading-5">
                在技能市集（Skill）編輯器的 <strong>「輸入/輸出」頁籤</strong>，選擇<strong>「輸出範本」</strong>。
                之後在對話中套用此技能時，AI 會強制以 JSON 格式輸出，並自動套用所選範本產生文件，
                文件下載連結直接顯示在對話中。
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                <Clock size={15} /> 方式 4：排程任務自動生成
              </p>
              <p className="text-xs text-amber-600 leading-5">
                在<strong>「排程任務」</strong>設定中，於<strong>「輸出範本」</strong>欄位選擇範本。
                排程執行後，AI 的回應會自動解析為 JSON 並套用範本，生成的文件可透過 Email 附件寄送，
                也會記錄在任務執行歷史中供下載。亦可在 Prompt 中插入
                <code className="bg-amber-100 px-1 rounded">{'{{template:範本ID}}'}</code> 標籤來指定範本。
              </p>
            </div>
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-teal-700 mb-2 flex items-center gap-2">
                <Zap size={15} /> 方式 5：Pipeline 工作流程節點
              </p>
              <p className="text-xs text-teal-600 leading-5">
                在 Pipeline（工作流程）編輯器中，於<strong>「產生檔案」節點</strong>選擇<strong>「使用範本」</strong>模式，
                指定目標範本後，上一個節點的 AI JSON 輸出會自動被解析並套用到範本，
                生成的文件作為後續節點的輸入或最終輸出。
              </p>
            </div>
          </div>
          <NoteBox>
            方式 3～5（AI 自動套用）要求 AI 輸出符合範本結構的 JSON。系統會將範本的欄位清單注入到 AI 指令中，
            引導 AI 自動產生正確的 JSON 格式，無需人工手動填表。
          </NoteBox>
        </SubSection>

        <SubSection title="AI 自動填表 — JSON 輸出機制">
          <Para>
            當使用技能綁定範本、排程任務或 Pipeline 節點時，系統會自動在 AI 的系統提示末尾注入範本的欄位說明，
            格式如下：
          </Para>
          <CodeBlock>{`# 請以下列 JSON 格式輸出（用於文件範本填寫）
{
  "customer_name": "（客戶姓名 — text）",
  "order_date":    "（訂單日期 — date）",
  "items": [
    { "product_code": "（產品代碼）", "qty": "（數量）" }
  ]
}`}</CodeBlock>
          <Para>
            PPTX 多版型範本的 JSON 格式如下，<code className="bg-slate-100 px-1 rounded">slides</code> 陣列中每個元素代表一張投影片：
          </Para>
          <CodeBlock>{`{
  "cover_title":     "2025 Q1 業務報告",
  "cover_presenter": "業務發展部",
  "slides": [
    {
      "type": "bullets",
      "slide_title": "本季亮點",
      "slide_content": "訂單成長 18%\\n新客戶開發 42 家\\n客戶滿意度 4.8 / 5.0\\n市場佔有率提升至 23%"
    },
    {
      "type": "3col",
      "slide_title": "三大策略方向",
      "col1_title": "品質提升",
      "col1_content": "導入 ISO 驗證\\n零缺陷目標",
      "col2_title": "效率優化",
      "col2_content": "自動化產線\\n縮短交期 30%",
      "col3_title": "市場擴展",
      "col3_content": "東南亞佈局\\n電商渠道強化"
    }
  ]
}`}</CodeBlock>
          <Para>
            AI 回應後，系統依序執行以下處理流程，確保文件正確生成：
          </Para>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {[
              { icon: '🔍', title: 'P2 — 格式修復', desc: '若 AI JSON 解析失敗，Flash 自動重新從回應文字中提取有效 JSON' },
              { icon: '✅', title: 'P1 — Schema 驗證', desc: '檢查必填欄位是否齊全，若有缺失則 Flash 嘗試自動補齊' },
              { icon: '🎨', title: 'P0 — 排版引擎', desc: 'PPTX 專用：自動拆頁、壓縮長句、升級 3col 版型' },
              { icon: '📄', title: '文件生成', desc: '以處理後的 JSON 填入範本，XML 層級替換，保留所有原始樣式' },
            ].map(item => (
              <div key={item.title} className="bg-slate-50 border rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-700">{item.icon} {item.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-4">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {[
              { icon: '✅', title: '自動支援 loop 欄位', desc: 'JSON 中若某欄位為陣列，對應到範本的 loop 類型，可自動產生多行表格或多張投影片' },
              { icon: '✅', title: '格式完整保留', desc: '生成的文件保留原始範本的字型、框線、Logo，僅填入 AI 提供的資料' },
              { icon: '⚠️', title: '欄位名稱需對應', desc: 'JSON 的 key 必須與範本變數的 key 一致，AI 通常能自動對應，但若範本有更動建議重新測試一次' },
              { icon: '⚠️', title: '需有「使用」權限', desc: 'AI 自動生成同樣需要對範本有 use 以上的存取權限，否則生成步驟會失敗' },
            ].map(item => (
              <div key={item.title} className="bg-slate-50 border rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-700">{item.icon} {item.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-4">{item.desc}</p>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title="變數類型說明">
          <Table
            headers={['類型', '說明', '範例']}
            rows={[
              ['text', '一般文字', '姓名、部門、說明'],
              ['number', '數字，可帶小數', '金額、數量、比率'],
              ['date', '日期格式', '2024-01-01'],
              ['select', '固定選項清單', '狀態：核准 / 退回 / 審核中'],
              ['loop', '重複表格列', '明細清單（每列可有多個子欄位）'],
            ]}
          />
          <TipBox>
            <strong>loop 類型</strong>適合用於有多筆明細的表格，例如採購清單、出差明細。
            生成時可動態新增或刪除列數，每列獨立填寫。
          </TipBox>
        </SubSection>

        <SubSection title="下載範本原始檔">
          <Para>
            若您擁有「使用」以上權限，可點選範本卡片右上角選單的<strong>「下載」</strong>，
            下載該範本的原始文件（含佔位符）在本機修改後，重新建立新範本使用。
          </Para>
        </SubSection>

        <SubSection title="複製別人的範本（Fork）">
          <div className="space-y-3">
            <StepItem num={1} title="在公開或被分享的範本卡片點選「複製」圖示" />
            <StepItem num={2} title="系統建立一份您專屬的副本" desc="原始文件、變數 Schema 完整複製，您可自由修改" />
            <StepItem num={3} title="進入「我的範本」找到複製的副本，點選「編輯」進行調整" />
          </div>
          <TipBox>Fork 副本與原始範本相互獨立，修改副本不影響原始範本，也不需要通知原作者。</TipBox>
        </SubSection>

        <SubSection title="分享範本">
          <Para>範本擁有者（owner）可將範本分享給其他使用者、部門或職稱群組：</Para>
          <Table
            headers={['分享類型', '說明']}
            rows={[
              ['use（使用）', '被分享者可生成文件、下載原始檔，但不能修改範本設定'],
              ['edit（編輯）', '被分享者可修改範本名稱、描述、標籤、變數 Schema'],
            ]}
          />
          <Para>分享對象可以是：</Para>
          <div className="flex flex-wrap gap-2 mt-2">
            {['個別使用者', '部門', '職稱', '成本中心', '分部', '組織群組'].map(t => (
              <span key={t} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs">{t}</span>
            ))}
          </div>
        </SubSection>

        <SubSection title="公開範本">
          <Para>
            您可以將自己的範本設為<strong>全員公開</strong>，讓所有使用者都能在範本庫瀏覽和使用。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="開啟範本的「分享設定」" />
            <StepItem num={2} title="點選「設為公開」開關" />
            <StepItem num={3} title="確認公告提示後，範本立即對全員可見" />
          </div>
          <NoteBox>
            公開範本不需要管理員審核，但請確認文件內容無敏感資訊，因為全員均可看到並使用。
            若需取消公開，再次點選開關即可。
          </NoteBox>
        </SubSection>

        <SubSection title="固定格式模式（Fixed Format Mode）">
          <Para>
            <strong>固定格式模式</strong>讓您精確控制每個變數的字型大小、顏色、粗體，以及儲存格的溢位處理策略。
            適合公司制式表單、合約、報告等<strong>版面不可隨意伸縮</strong>的場景。
          </Para>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {[
              { icon: '📝', title: 'Word (DOCX)', desc: '每格字型/顏色/粗體精確套用；loop 表格列高可固定（rowHeightPt）' },
              { icon: '📊', title: 'Excel (XLSX)', desc: '每格套用字型樣式；AI 自動從原始範本偵測 cell.font' },
              { icon: '📄', title: 'PDF（非表單）', desc: '疊加模式：保留原始 Logo/框線，在指定座標寫入文字' },
            ].map(item => (
              <div key={item.title} className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                <div className="text-lg mb-1">{item.icon}</div>
                <p className="text-xs font-semibold text-slate-700">{item.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <StepItem num={1} title="上傳範本時啟用" desc="在「新增範本」精靈的 Step 3（確認變數）中，開啟「固定格式模式」開關" />
            <StepItem num={2} title="或在編輯時啟用" desc="開啟範本「編輯」視窗，在標題列右側找到「固定格式模式」切換開關" />
            <StepItem num={3} title="進入「樣式設定」頁籤調整字型/顏色/溢位" />
            <StepItem num={4} title="（PDF 專用）進入「版面編輯器」頁籤定義各欄位的填寫位置" />
          </div>
          <TipBox>
            開啟固定格式模式後，系統會自動從原始範本讀取字型樣式作為預設值，您只需覆寫與原始不同的欄位即可。
          </TipBox>
        </SubSection>

        <SubSection title="樣式設定頁籤">
          <Para>
            在範本「編輯」視窗中點選<strong>「樣式設定」</strong>頁籤，可對每個變數（含 loop 子欄位）設定：
          </Para>
          <Table
            headers={['設定項目', '說明']}
            rows={[
              ['字型大小 (pt)', '輸入點數，如 10、12、14，留空表示沿用偵測值'],
              ['粗體', '勾選即套用 bold'],
              ['斜體', '勾選即套用 italic'],
              ['顏色', '點選色盤選擇顏色，留空表示沿用偵測值（預設黑色）'],
              ['溢位策略', '見下方說明'],
              ['最大字數', '配合 truncate / summarize 策略使用，設定觸發上限'],
            ]}
          />
          <Para>
            欄位旁的<strong>「已偵測」</strong>綠色徽章，表示該值是系統自動從原始範本讀取的。
            手動修改後可點選<strong>「重設」</strong>還原為偵測值。
          </Para>
          <NoteBox>
            「樣式設定」在固定格式模式<strong>關閉</strong>時不會套用。請先在編輯視窗標題列開啟固定格式模式。
          </NoteBox>
        </SubSection>

        <SubSection title="溢位策略說明">
          <Para>
            當變數內容超出儲存格或欄位空間時，系統依所選策略處理：
          </Para>
          <Table
            headers={['策略', '行為', '適用場景']}
            rows={[
              ['折行（wrap）', '預設值，內容自動換行，欄高隨內容增長', '說明欄位、備註等無固定行數的格'],
              ['截斷（truncate）', '超過「最大字數」後直接截斷並加 …', '簡短標題、代碼欄位，不允許換行'],
              ['縮小字型（shrink）', '自動縮小字型大小，使文字擠進原格', 'PDF 覆蓋模式的單行格'],
              ['AI 摘要（summarize）', '呼叫 Gemini Flash 自動摘要到設定字數內', '長篇說明需要保留語意、不能截斷時'],
            ]}
          />
          <TipBox>
            AI 摘要策略會自動偵測輸入語言（中文比率 &gt; 30% 使用繁體中文摘要），
            摘要失敗時會自動 fallback 為截斷策略，不影響文件生成。
          </TipBox>
        </SubSection>

        <SubSection title="PDF 版面編輯器">
          <Para>
            對於 PDF 格式（非 AcroForm 表單）的固定格式範本，需要用<strong>版面編輯器</strong>手動定義每個欄位的填寫座標。
            完成定位後，生成時系統以<strong>疊加模式</strong>在原始 PDF 上直接寫入文字，保留 Logo、框線、印章等所有原始視覺元素。
          </Para>
          <div className="space-y-3 mt-2">
            <StepItem num={1} title="開啟範本編輯視窗，切換到「版面編輯器」頁籤" desc="此頁籤僅對 PDF（非 AcroForm）格式的範本顯示" />
            <StepItem num={2} title="PDF 預覽載入後，在右上方「選擇變數」下拉選取要定位的欄位" />
            <StepItem num={3} title="在 PDF 預覽畫面上拖曳畫出矩形框" desc="框的位置即為該欄位文字的填寫區域，支援跨頁定位" />
            <StepItem num={4} title="右側面板確認座標，可重複框選覆蓋修正" />
            <StepItem num={5} title="對所有變數完成定位後，點選「儲存」" />
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-3">
            <p className="text-xs font-semibold text-slate-600 mb-2">版面編輯器操作說明</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: '縮放', val: '點選 + / − 按鈕或拖動縮放列調整預覽大小' },
                { key: '換頁', val: '點選 ◀ ▶ 按鈕切換 PDF 頁面' },
                { key: '已定位欄位', val: '藍色半透明矩形，點選即選取，右側顯示詳細資訊' },
                { key: '刪除框位', val: '選取矩形後按鍵盤 Delete 或右側「刪除」按鈕' },
              ].map(row => (
                <div key={row.key} className="bg-white rounded p-2 border">
                  <p className="text-[11px] font-semibold text-slate-700">{row.key}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{row.val}</p>
                </div>
              ))}
            </div>
          </div>
          <NoteBox>
            若有變數尚未定位，生成文件時系統會跳過該欄位並在伺服器記錄警告，其他已定位的欄位仍正常填入。
            建議上傳後立即完成版面編輯器設定，再分享給他人使用。
          </NoteBox>
        </SubSection>

        <SubSection title="內容模式（Content Mode）">
          <Para>
            每個欄位可設定<strong>內容模式</strong>，控制生成文件時該欄位的取值方式。
            在「變數設定」頁籤的每個欄位右側，有三個小按鈕可切換模式：
          </Para>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
            {[
              { badge: 'V', color: 'bg-blue-600', title: '變數（預設）', desc: '每次生成時由使用者填入。表單中會顯示此欄位等待輸入。' },
              { badge: 'T', color: 'bg-amber-500', title: '靜態（固定文字）', desc: '永遠使用「預設值」欄位的內容，不詢問使用者。適合公司名稱、固定標題。' },
              { badge: '∅', color: 'bg-slate-500', title: '清空（保留格式）', desc: '永遠清空此格內容。PDF 覆蓋模式會畫白色矩形蓋掉原始文字，框線保留。' },
            ].map(item => (
              <div key={item.badge} className="bg-slate-50 border rounded-lg p-3 flex gap-3">
                <span className={`${item.color} text-white text-xs font-bold w-6 h-6 rounded flex-shrink-0 flex items-center justify-center mt-0.5`}>
                  {item.badge}
                </span>
                <div>
                  <p className="text-xs font-semibold text-slate-700">{item.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-4">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <TipBox>
            典型用法：上傳一份 PDF 表單，將「標題」設為靜態（保留原始值）、「內容欄位」設為變數（使用者填入）、
            「填寫範例」設為清空（清除預印文字），即可製作乾淨的可重複使用表單。
          </TipBox>
        </SubSection>

        <SubSection title="OCR 掃描式 PDF">
          <Para>
            若上傳的 PDF 是<strong>掃描版圖片型</strong>（文字無法直接複製），
            系統會自動偵測並使用<strong>Gemini Vision OCR</strong>識別欄位位置，
            同時自動啟用「固定格式模式」，讓您直接在版面編輯器微調座標。
          </Para>

          <div className="space-y-3 mt-2">
            <StepItem num={1} title="上傳掃描版 PDF" desc="系統偵測到文字內容極少（<50字元），自動進入 OCR 流程" />
            <StepItem num={2} title="等待 Gemini Vision 分析" desc="顯示「OCR 掃描中...」狀態，時間約 10-30 秒，取決於頁面複雜度" />
            <StepItem num={3} title="檢視 OCR 識別結果" desc='變數清單顯示「OCR 自動定位」標籤，座標已預先填入' />
            <StepItem num={4} title="在版面編輯器微調座標" desc="OCR 座標為估算值（誤差約 5-15 pt），建議人工確認並拖拉微調" />
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mt-3">
            <p className="text-xs font-semibold text-purple-700 mb-2">對現有範本重新 OCR</p>
            <p className="text-xs text-purple-600 leading-5">
              若想更新現有 PDF 範本的欄位座標，開啟範本「編輯」→「版面編輯器」頁籤，
              點選右上角<strong>「OCR 重新掃描」</strong>紫色按鈕。
              系統重新分析後，會將新偵測到的 pdf_cell 座標合併回現有變數，
              不影響已手動設定好的其他欄位設定。
            </p>
          </div>

          <Table
            headers={['PDF 類型', 'OCR 準確度', '建議做法']}
            rows={[
              ['白底清晰掃描表單', '~85%', '直接使用，微調 1-2 個座標'],
              ['彩色底色表單', '~75%', '使用後逐欄確認座標'],
              ['圖文混排複雜版面', '~60%', '以 OCR 結果作參考，手動重新框選'],
              ['文字型 PDF（非掃描）', 'N/A', '系統自動用 AI 文字分析，不走 OCR'],
            ]}
          />
          <NoteBox>
            OCR 功能使用 Gemini Pro 模型，每次約消耗 1,000-3,000 input tokens。
            大量批次上傳時請注意 API 配額。
          </NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════ Webex Bot 使用 */}
      <Section id="u-webex-bot" icon={<MessageSquare size={22} />} iconColor="text-green-500" title="Webex Bot 使用">
        <Para>
          Cortex 支援透過 <strong>Cisco Webex</strong> 直接與 AI 對話，享有與 Web 介面相同的問答、工具調用、檔案收發能力，
          無需開啟瀏覽器，在 Webex 行動裝置上也能隨時使用。
        </Para>

        <SubSection title="開始使用">
          <div className="space-y-3">
            <StepItem num={1} title="在 Webex 搜尋 Bot 帳號" desc="搜尋「Cortex」或 Bot 的 email（請洽管理員取得），點擊後直接傳送訊息" />
            <StepItem num={2} title="傳送第一則訊息" desc="Bot 會在 8 秒內開始處理並回覆，第一次使用會自動建立對話 Session" />
            <StepItem num={3} title="群組 Room 使用" desc="在群組中需要 @Cortex 才會觸發，DM 則直接傳送即可" />
          </div>
          <NoteBox>
            Bot 採用輪詢模式（每 8 秒），訊息最長延遲約 8 秒才開始處理，請稍待 AI 回應（約 10–30 秒）。
          </NoteBox>
        </SubSection>

        <SubSection title="指令清單">
          <Table
            headers={['指令', '功能']}
            rows={[
              ['?', '列出您目前授權使用的所有工具（技能、知識庫、MCP 工具）'],
              ['/new（或：新對話、重置、/clear、/restart...）', '開啟新對話，清除本次 Session 記憶，介面顯示時間戳分隔線'],
              ['/help', '顯示 Bot 使用說明'],
              ['其他任何文字', '直接送 AI 問答，自動判斷並調用合適工具'],
            ]}
          />
        </SubSection>

        <SubSection title="附件支援">
          <Table
            headers={['類型', '說明']}
            rows={[
              ['PDF / Word / Excel / PPT', 'AI 直接讀取內容並回答問題'],
              ['圖片（JPG / PNG / GIF / WebP）', 'AI 進行圖像分析'],
              ['音訊（MP3 / WAV / MP4 Audio）', '自動轉錄為文字後分析'],
              ['AI 生成的檔案', 'xlsx / docx / pdf / pptx 以附件方式回傳'],
            ]}
          />
          <NoteBox>不支援影片檔（mp4 video / webm）。</NoteBox>
        </SubSection>

        <SubSection title="對話記憶與 Session">
          <Para>
            <strong>DM 對話</strong>：每日（台北時區）自動開啟新 Session，同一天的訊息共享上下文記憶。<br />
            <strong>群組 Room</strong>：單一永久 Session，所有成員的對話共享同一記憶。<br />
            傳送 <code className="bg-slate-100 px-1 rounded text-xs">/new</code>（或「新對話」、「重置」、<code className="bg-slate-100 px-1 rounded text-xs">/clear</code>）可隨時手動清除記憶開始新對話。
          </Para>
          <TipBox>
            開啟新對話後，Webex 聊天室會顯示時間戳分隔線（━━━ 🔄 新對話開始 ━━━），舊訊息仍保留在歷史中，Cortex 的「對話紀錄」也同步保存，可隨時回顧。
          </TipBox>
        </SubSection>

        <SubSection title="注意事項">
          <div className="space-y-2">
            {[
              'Bot 功能須由管理員在您的帳號設定中開啟「允許使用 Webex Bot」',
              '您的 Webex 帳號 email 必須與系統中的帳號 email 一致（自動支援 @foxlink.com / @foxlink.com.tw 互轉）',
              'AI 處理期間 Bot 會先回覆「⏳ 正在分析您的問題，請稍候...」，處理完成後自動刪除該訊息',
              'Webex 回應格式已針對行動裝置簡化，詳細報表建議使用 Web 介面',
              '回應超過 4000 字元時會自動截斷，並提示您至 Web 介面查看完整版',
            ].map((t, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="text-blue-400 flex-shrink-0 mt-0.5">•</span>
                {t}
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title="多語言回應">
          <Para>
            Webex Bot 的所有系統訊息（錯誤提示、指令回應、處理中提示等）會<strong>依照您在網頁端設定的語言偏好</strong>自動切換為對應語言。
            支援<strong>繁體中文、英文、越南文</strong>三種語言。
          </Para>

          <Table
            headers={['訊息類型', '語言依據', '說明']}
            rows={[
              ['帳號未串連（找不到帳號）', '三語同時顯示', '系統無法辨識您的身份，因此中/英/越三語全部列出'],
              ['帳號停用 / Bot 未啟用', '依您的語言設定', '系統已辨識您的帳號，依偏好語言回應'],
              ['檔案上傳錯誤', '依您的語言設定', '影片拒絕、音訊/圖片權限不足、檔案過大等'],
              ['/help 使用說明', '依您的語言設定', '完整翻譯版的指令說明與附件支援資訊'],
              ['/new 新對話提示', '依您的語言設定', '分隔線與提示文字'],
              ['處理中 / AI 錯誤', '依您的語言設定', '「⏳ 正在分析...」及錯誤訊息'],
              ['預算超限通知', '依您的語言設定', '日/週/月使用額度警告'],
              ['生成檔案提示', '依您的語言設定', '「📄 已生成：檔名」'],
            ]}
          />

          <TipBox>
            語言設定方式：登入網頁版 → 右上角語言切換（🌐）→ 選擇繁體中文 / English / Tiếng Việt。設定後 Webex Bot 會自動套用，無需額外操作。
          </TipBox>
        </SubSection>

        <SubSection title="帳號無法串連時的處理方式">
          <Para>
            若您尚未登入過網頁系統，Bot 會以<strong>中/英/越三語同時顯示</strong>以下錯誤訊息：
          </Para>

          <div className="space-y-4 mt-3">
            {/* 情境 1: 找不到帳號 */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="font-semibold text-amber-800 mb-2">情境一：帳號未串連（找不到帳號）</div>
              <div className="bg-white rounded p-3 text-xs font-mono text-slate-700 whitespace-pre-line mb-2">
                {[
                  '⚠️ 無法串連 Cortex 帳號，以下為可能原因：',
                  '1. 尚未登入過網頁系統產生帳號，請先透過公司內網登入：https://flgpt.foxlink.com.tw:8443',
                  '2. 可能帳號無 email 資訊',
                  '3. 網路連線問題',
                  '請檢查以上原因或是洽廠區資訊處理',
                ].join('\n')}
              </div>
              <div className="text-sm text-slate-600 space-y-1">
                <div className="flex items-start gap-2"><span className="text-amber-500 flex-shrink-0">→</span><span><strong>原因 1</strong>：您尚未登入過 Cortex 網頁版（<code className="bg-slate-100 px-1 rounded text-xs">flgpt.foxlink.com.tw</code>），系統尚未建立帳號。請先用瀏覽器登入一次即可。</span></div>
                <div className="flex items-start gap-2"><span className="text-amber-500 flex-shrink-0">→</span><span><strong>原因 2</strong>：您的帳號在系統中沒有 email，或 email 與 Webex 帳號不一致。請聯絡管理員確認。</span></div>
                <div className="flex items-start gap-2"><span className="text-amber-500 flex-shrink-0">→</span><span><strong>原因 3</strong>：網路暫時異常，稍後再試。若持續發生請洽廠區資訊處理。</span></div>
              </div>
            </div>

            {/* 情境 2: 帳號停用 */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="font-semibold text-red-800 mb-2">情境二：帳號已停用</div>
              <div className="bg-white rounded p-3 text-xs font-mono text-slate-700 whitespace-pre-line mb-2">
                ⚠️ 您的帳號目前已停用，請聯絡系統管理員。
              </div>
              <div className="text-sm text-slate-600">
                <div className="flex items-start gap-2"><span className="text-red-400 flex-shrink-0">→</span><span>您的帳號已被管理員停用（可能離職、調動或到期），請聯絡系統管理員重新啟用。</span></div>
                <div className="flex items-start gap-2"><span className="text-red-400 flex-shrink-0">→</span><span>此訊息會依您帳號的語言設定，以對應語言顯示。</span></div>
              </div>
            </div>

            {/* 情境 3: Bot 未啟用 */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="font-semibold text-slate-800 mb-2">情境三：Webex Bot 功能未開啟</div>
              <div className="bg-white rounded p-3 text-xs font-mono text-slate-700 whitespace-pre-line mb-2">
                ⚠️ 您的帳號目前未開啟 Webex Bot 功能，如需使用請聯絡系統管理員。
              </div>
              <div className="text-sm text-slate-600">
                <div className="flex items-start gap-2"><span className="text-slate-400 flex-shrink-0">→</span><span>帳號存在但管理員尚未開啟「允許使用 Webex Bot」選項。請聯絡管理員至後台 → 使用者管理 → 編輯您的帳號 → 開啟 Webex Bot。</span></div>
                <div className="flex items-start gap-2"><span className="text-slate-400 flex-shrink-0">→</span><span>此訊息會依您帳號的語言設定，以對應語言顯示。</span></div>
              </div>
            </div>
          </div>
        </SubSection>
      </Section>
    </div>
  )
}

// ── Admin Manual content ──────────────────────────────────────────────────────

const adminSections = [
  { id: 'a-users', label: '使用者管理', icon: <Users size={18} /> },
  { id: 'a-roles', label: '角色管理', icon: <Lock size={18} /> },
  { id: 'a-admin-test', label: '管理員測試模式', icon: <FlaskConical size={18} /> },
  { id: 'a-schedule', label: '排程任務', icon: <CalendarClock size={18} /> },
  { id: 'a-prompt', label: '排程 Prompt 語法', icon: <Terminal size={18} /> },
  { id: 'a-generate', label: '檔案生成語法', icon: <Download size={18} /> },
  { id: 'a-example', label: '完整 Prompt 範例', icon: <BookOpen size={18} /> },
  { id: 'a-tokens', label: 'Token 與費用統計', icon: <BarChart3 size={18} /> },
  { id: 'a-audit', label: '稽核與敏感詞', icon: <Shield size={18} /> },
  { id: 'a-mcp', label: 'MCP 伺服器', icon: <Globe size={18} /> },
  { id: 'a-dify', label: 'API 連接器', icon: <Zap size={18} /> },
  { id: 'a-erp-tools', label: 'ERP 工具管理', icon: <Database size={18} /> },
  { id: 'a-kb', label: '自建知識庫管理', icon: <Database size={18} /> },
  { id: 'a-kb-retrieval', label: 'KB 檢索架構 v2', icon: <Search size={18} /> },
  { id: 'a-kb-synonyms', label: 'KB 同義詞字典', icon: <BookOpen size={18} /> },
  { id: 'a-skill', label: '技能市集管理', icon: <Sparkles size={18} /> },
  { id: 'a-code-runners', label: 'Code Runners', icon: <Code2 size={18} /> },
  { id: 'a-llm', label: 'LLM 模型管理', icon: <Cpu size={18} /> },
  { id: 'a-data-permissions', label: '資料權限管理', icon: <ShieldCheck size={18} /> },
  { id: 'a-db-sources', label: 'AI 戰情 — 外部資料來源', icon: <Database size={18} /> },
  { id: 'a-vector-defaults', label: '向量預設模型設定', icon: <Cpu size={18} /> },
  { id: 'a-research-logs', label: '深度研究紀錄', icon: <GitFork size={18} /> },
  { id: 'a-api-keys', label: '外部 API 金鑰管理', icon: <Key size={18} /> },
  { id: 'a-cost-analysis', label: '費用分析', icon: <DollarSign size={18} /> },
  { id: 'a-system', label: '系統設定', icon: <Settings size={18} /> },
  { id: 'a-monitor', label: '系統監控', icon: <Activity size={18} /> },
  { id: 'a-k8s', label: 'K8s 部署更新', icon: <Server size={18} /> },
  { id: 'a-env-config', label: 'ENV 環境變數設定', icon: <Settings size={18} /> },
  { id: 'a-help-kb-sync', label: '說明書 KB 自動同步', icon: <RefreshCw size={18} /> },
  { id: 'a-help-translation', label: '說明文件翻譯管理', icon: <Languages size={18} /> },
  { id: 'a-doc-template', label: '文件範本管理', icon: <LayoutTemplate size={18} /> },
  { id: 'a-webex-bot', label: 'Webex Bot 管理', icon: <MessageSquare size={18} /> },
  { id: 'a-feedback', label: '問題反饋管理', icon: <TicketCheck size={18} /> },
  { id: 'a-training', label: '教育訓練權限管理', icon: <BookOpen size={18} /> },
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
          <Para>除上傳外，部分進階功能也可依需求開放給特定使用者（優先於角色設定）：</Para>
          <Table
            headers={['設定項目', '說明', '預設']}
            rows={[
              ['允許排程任務', '開啟後一般使用者也可建立、編輯及執行自動排程任務', '繼承角色'],
              ['允許建立 Skill', '開啟後可建立自定義技能', '繼承角色'],
              ['允許外部 Skill', '開啟後可建立帶有外部 Endpoint 的技能', '繼承角色'],
              ['允許程式技能', '開啟後可建立 type=code 的 Node.js 程式技能', '繼承角色'],
              ['允許建立知識庫', '開啟後可在側邊欄看到知識庫市集入口並建立知識庫', '繼承角色'],
              ['知識庫最大容量 (MB)', '該使用者所有知識庫文件的總容量上限', '繼承角色'],
              ['知識庫最大數量', '可建立的知識庫數量上限', '繼承角色'],
              ['允許深度研究', '開啟後可使用深度研究（Deep Research）功能', '繼承角色'],
              ['開發 AI 戰情室', '開啟後可在 AI 戰情室使用設計者模式建立 Schema / Topic / Design', '繼承角色'],
              ['使用 AI 戰情室', '開啟後可進入 AI 戰情室查詢 ERP 資料', '繼承角色'],
            ]}
          />
          <TipBox>「繼承角色」代表此欄位留空，實際行為由所屬角色的設定決定。使用者層設定優先於角色設定，設為明確值可覆蓋角色預設。</TipBox>
        </SubSection>

        <SubSection title="使用金額限制與超過處理方式">
          <Para>
            可為個別使用者獨立設定 USD 金額上限，優先於角色設定。若留空則沿用角色的限額。
          </Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['每日限額 (USD)', '使用者每天可消耗的最高費用', '0.05'],
              ['每週限額 (USD)', '使用者每週一至週日可消耗的最高費用', '0.20'],
              ['每月限額 (USD)', '使用者每月 1 日至月底可消耗的最高費用', '0.50'],
            ]}
          />
          <Para>當使用量達到任一限額時，系統依<strong>「額度超過限制方式」</strong>決定處理行為：</Para>
          <Table
            headers={['模式', '行為', '備註']}
            rows={[
              ['沿用角色設定（留空）', '沿用所屬角色的設定', '建議個別使用者使用此選項'],
              ['禁止（block）', '直接封鎖新訊息，AI 拒絕回覆並告知額度已滿', '最嚴格的限制模式'],
              ['警告（warn）', '允許繼續對話，但頂端列顯示紅色警告條，提醒已超出額度', '適合不想中斷工作流程的場景'],
            ]}
          />
          <NoteBox>
            warn 模式下使用者雖可繼續使用，但管理員仍可在 Token 統計頁面看到超用紀錄。
            建議對一般員工使用 warn，對成本敏感部門使用 block。
          </NoteBox>
        </SubSection>

        <SubSection title="組織資訊同步">
          <Para>
            使用者管理頁面提供「組織自動同步排程」功能，定期從人事系統同步員工的部門、利潤中心、事業處等組織資訊：
          </Para>
          <Table
            headers={['觸發方式', '說明']}
            rows={[
              ['登入時自動同步', '每次 LDAP 登入後自動更新該員工的組織資訊'],
              ['手動觸發', '點擊單一使用者的「同步組織」按鈕，立即更新'],
              ['批量同步', '點擊「批量同步所有使用者」，一次更新全體帳號'],
              ['排程自動同步', '設定每天幾點自動批量同步（可在「組織自動同步排程」展開設定）'],
            ]}
          />
          <TipBox>同步變更記錄（如部門異動、離職）可在「同步變更紀錄」中查看，追蹤每次同步的異動欄位。</TipBox>
        </SubSection>

        <SubSection title="指派資料權限原則">
          <Para>
            可為每位使用者指派一個<strong>資料權限原則（Data Permission Policy）</strong>，控制其在 AI 戰情室可查詢的資料範圍。
            若未指派，系統會依照所屬角色的原則設定。詳見「資料權限管理」章節。
          </Para>
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
            <StepItem num={7} title="指定 MCP / API 連接器（選填）" desc="限制此角色只能使用指定的工具或知識庫" />
          </div>
          <TipBox>建議為不同部門或職能分別建立角色，例如「研發工程師」（允許圖片/音訊上傳）、「業務人員」（僅允許文件上傳，月限額 $5）。</TipBox>
        </SubSection>

        <SubSection title="使用金額限制（Budget）與超過處理方式">
          <Para>
            可為角色設定 USD 金額上限，旗下所有使用者各自獨立計算（非共用額度）。
            若使用者有個別設定，則以個別設定優先。
          </Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['每日限額 (USD)', '每天可消耗的最高費用', '0.05'],
              ['每週限額 (USD)', '每週一至週日可消耗的最高費用', '0.20'],
              ['每月限額 (USD)', '每月 1 日至月底可消耗的最高費用', '0.50'],
            ]}
          />
          <Para>超過任一限額時，依<strong>「額度超過限制方式」</strong>決定處理行為：</Para>
          <Table
            headers={['模式', '行為']}
            rows={[
              ['禁止（block）', '直接封鎖新訊息，AI 拒絕回覆並告知額度已滿；預設值'],
              ['警告（warn）', '允許繼續對話，但頂端列顯示紅色警告條，提醒已超出額度'],
            ]}
          />
          <TipBox>
            warn 模式適合不想中斷員工工作流程的部門；block 模式適合需要嚴格管控費用的場景。
            留空代表不設限。金額計算需依賴 LLM 模型定價設定，若尚未設定費率則限額無效。
          </TipBox>
        </SubSection>

        <SubSection title="完整功能權限設定">
          <Table
            headers={['設定項目', '說明', '預設值']}
            rows={[
              ['允許上傳文字文件', 'PDF、DOCX、XLSX、PPTX、TXT', '開啟'],
              ['文件大小上限 (MB)', '單一文件最大允許大小', '10 MB'],
              ['允許上傳音訊', 'MP3、WAV、M4A 等，系統自動轉文字', '關閉'],
              ['音訊大小上限 (MB)', '單一音訊最大允許大小', '10 MB'],
              ['允許上傳圖片', 'JPG、PNG、WEBP 等', '開啟'],
              ['圖片大小上限 (MB)', '單一圖片最大允許大小', '10 MB'],
              ['允許排程任務', '可建立自動排程任務', '關閉'],
              ['允許建立 Skill', '可在技能市集建立自定義技能', '關閉'],
              ['允許外部 Skill', '可建立帶有外部 Endpoint URL 的技能', '關閉'],
              ['允許程式技能', '可建立 type=code 的 Node.js 程式技能', '關閉'],
              ['允許建立知識庫', '可在知識庫市集建立知識庫', '關閉'],
              ['知識庫最大容量 (MB)', '此角色使用者可建立的知識庫總容量上限', '500 MB'],
              ['知識庫最大數量', '此角色使用者可建立的知識庫數量上限', '5 個'],
              ['允許深度研究', '可使用 Deep Research 功能進行多輪網路搜尋分析', '開啟'],
              ['開發 AI 戰情室', '可在 AI 戰情室使用設計者模式建立 Schema / Topic / Design', '關閉'],
              ['使用 AI 戰情室', '可進入 AI 戰情室頁面查詢 ERP 資料', '關閉'],
            ]}
          />
          <NoteBox>使用者層級的個別設定仍可覆蓋角色設定。選擇角色後，欄位自動帶入角色值，管理員可針對個別使用者調整。</NoteBox>
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

        <SubSection title="MCP 伺服器與 API 連接器綁定">
          <Para>
            可為角色勾選允許使用的 MCP 伺服器和 API 連接器。此角色的使用者對話時，
            AI 只能存取這些已授權的工具，未勾選的工具不會出現在其對話中。
          </Para>
          <NoteBox>若角色未綁定任何 MCP / API 連接器，系統預設讓所有已啟用的工具對使用者可見。建議明確綁定，以避免機密知識庫意外對不相關部門開放。</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-admin-test" icon={<FlaskConical size={22} />} iconColor="text-orange-500" title="管理員測試模式">
        <Para>
          系統管理員與一般使用者適用<strong>相同的工具授權規則</strong>——只有被明確授權（公開核准或角色指定）的
          MCP 伺服器、API 連接器、自建知識庫、技能及文件範本，才會出現在管理員的對話介面中。
          這樣的設計讓管理員看到的介面與使用者完全一致，避免意外使用到尚未準備好的工具。
        </Para>
        <Para>
          當需要測試<strong>尚未授權</strong>的工具（例如剛建立的 MCP 伺服器或新範本），
          可透過「管理員測試模式」暫時將工具加入自己的對話，驗證設定正確後再正式授權給使用者。
        </Para>

        <SubSection title="啟用測試模式">
          <div className="space-y-3">
            <StepItem num={1} title="在對話頁頂端列找到 🔬 燒杯圖示按鈕（僅管理員可見）" desc="若有已加入的測試工具，圖示右上角會顯示橘色數字徽章" />
            <StepItem num={2} title="點擊按鈕，展開測試模式浮動面板" />
            <StepItem num={3} title="切換「工具」或「文件範本」頁籤" desc="面板顯示目前尚未被授權給管理員帳號的工具清單" />
            <StepItem num={4} title="找到目標工具，點選「+ 加入」" desc="工具立即加入測試列表，可在對話中使用" />
            <StepItem num={5} title="關閉面板，回到對話" desc="已加入的工具出現在工具選單中，標有 🔬 橘色徽章" />
          </div>
        </SubSection>

        <SubSection title="工具頁籤說明">
          <Para>「工具」頁籤顯示所有目前未授權給管理員帳號的工具，按類型分組：</Para>
          <Table
            headers={['類型', '說明']}
            rows={[
              ['MCP', '外部工具伺服器（Model Context Protocol）'],
              ['API 連接器', 'API 連接外部知識庫'],
              ['自建知識庫', '系統內部向量知識庫'],
              ['技能', '技能市集中的自定義技能'],
            ]}
          />
          <Para>「文件範本」頁籤顯示所有未授權給管理員帳號的文件範本，可逐一加入測試。</Para>
        </SubSection>

        <SubSection title="移除與清除">
          <div className="space-y-2">
            {[
              { icon: <FlaskConical size={13} className="text-orange-400" />, label: '移除單一工具', desc: '在「已加入測試」區塊點選工具右側的 ✕ 按鈕' },
              { icon: <FlaskConical size={13} className="text-orange-400" />, label: '清除全部', desc: '面板底部點選「清除全部」，一次移除所有測試工具與範本' },
              { icon: <FlaskConical size={13} className="text-orange-400" />, label: '登出自動清除', desc: '登出系統後，測試模式設定自動全部清除' },
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
        </SubSection>

        <SubSection title="重要限制">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
            {[
              '測試模式僅影響管理員自身的對話介面，其他使用者完全不受影響。',
              '已加入測試的工具以 🔬 橘色徽章標示，方便辨認與一般授權工具的差異。',
              '測試狀態在瀏覽器重新整理後仍保留（存於瀏覽器 localStorage），直到登出為止。',
              'Webex Bot 永遠使用一般使用者的授權邏輯，不受管理員測試模式影響。',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-amber-700">
                <span className="text-amber-500 flex-shrink-0 mt-0.5">•</span>
                {text}
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title="測試完成後正式授權">
          <Para>確認工具運作正常後，透過以下方式正式開放給使用者：</Para>
          <Table
            headers={['工具類型', '授權方式']}
            rows={[
              ['MCP 伺服器', '在「角色管理」勾選此伺服器，或核准伺服器的「公開」申請'],
              ['API 連接器', '在「角色管理」勾選此連接器，或核准「公開」申請'],
              ['自建知識庫', '核准使用者提出的公開申請，或於角色指派'],
              ['技能', '在技能市集核准公開申請'],
              ['文件範本', '在範本設定中開啟公開，或在角色管理中指派'],
            ]}
          />
          <TipBox>建議在測試模式確認工具正常後再正式授權，避免將設定錯誤的工具開放給所有使用者。</TipBox>
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
              ['KB_PDF_OCR_CONCURRENCY', 'PDF per-page OCR 並發數（auto / force 模式）', '20'],
              ['KB_IMG_OCR_CONCURRENCY', 'DOCX / PPTX / XLSX 嵌入圖 OCR 並發數', '20'],
              ['KB_EMBED_CONCURRENCY', 'Embedding 並發數', '20'],
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

      <Section id="a-kb-retrieval" icon={<Search size={22} />} iconColor="text-teal-500" title="KB 檢索架構 v2">
        <Para>
          v2 架構（2026-04-19 上線）把 KB 檢索從寫死的 LIKE + JS hack 升級為 Oracle 23 AI 的 hybrid vector + WORLD_LEXER text search，
          並導入 multi-vector、同義詞、per-KB 可調參數等能力。Admin 後台提供 3 個相關 tab：
        </Para>

        <SubSection title="Tab 1：KB 檢索設定（系統預設）">
          <Para>影響全系統所有 KB（除非該 KB 在進階檢索自己覆寫）。7 大區塊：</Para>
          <Table
            headers={['區塊', '可調內容', '建議']}
            rows={[
              ['檢索後端', 'Backend (LIKE / Oracle Text)', 'oracle_text 精度好很多'],
              ['Score Fusion', 'weighted（權重和）/ rrf（Reciprocal Rank Fusion）', 'rrf 更穩健'],
              ['Fulltext Query Op', 'ACCUM / AND / OR', 'ACCUM 最自然'],
              ['Weighted 權重', 'Vector / Fulltext / Match Boost（0–1）', '僅 weighted 模式生效'],
              ['TopK / 門檻', 'Fetch / Return / Score 門檻 / Vector cutoff / FT 最低分', '預設 0 不過濾'],
              ['Tokenize 停用詞', 'LIKE/tokenize 忽略的高頻詞（分機、地址…）', '已預設常見詞'],
              ['Multi-vector', '全域啟用 title+body 雙向量加權 + 權重', '需搭配 per-KB 補 title 向量'],
              ['維護操作', 'Orphan cleanup 狀態、cleanup cron 下拉、rebuild vector index', 'cron 預設每小時整點'],
            ]}
          />
          <TipBox>儲存後 60 秒內快取失效。即時驗證：到「KB 檢索調校」頁跑 query 即可。</TipBox>
        </SubSection>

        <SubSection title="Tab 2：KB 檢索調校（debug 頁）">
          <Para>選 KB + query → 執行後並排顯示 <strong>Vector / Fulltext / Fused / Rerank</strong> 四階段 top-N 結果。</Para>
          <Para>檢索摘要包含：</Para>
          <ListBlock items={[
            'Backend / Mode / Fusion / Elapsed',
            'Vector / Fulltext / Fused / After threshold / Rerank / Final 各階段條數',
            'Tokens 實際 tokenize 結果',
            'CONTAINS query 實際送到 Oracle 的字串',
            '同義詞字典與展開詞（若啟用）',
            'Effective query（展開後完整 query）',
          ]} />
          <Para>最下方「解析後的 config」摺疊可展開看 kb 覆寫 + system defaults + hardcoded 合併後的最終值。</Para>
        </SubSection>

        <SubSection title="Tab 3：子字串 Grep（繞 index 診斷）">
          <Para>debug 頁上的黃色 Grep 區塊，直接對 kb_chunks.content 做 LIKE，不走 vector / ftx。</Para>
          <Para>用途：分辨「parser 掉資料」vs「資料存在但 index 查不到」。</Para>
          <Table
            headers={['命中數', '診斷']}
            rows={[
              ['0', 'parser/chunker 把內容吃掉了 → 檢查 parse_mode / 重 parse'],
              ['>0 但 Fulltext 找不到', 'index 問題 → rebuild ftx / 等 SYNC 完成'],
              ['>0 且 Fulltext 也找到', '內容 OK → 可能是 rerank/topK 排序問題'],
            ]}
          />
        </SubSection>

        <SubSection title="Per-KB 覆寫（KB 設定頁內）">
          <Para>任一 KB 設定頁捲到底 → 展開「進階檢索設定（覆寫系統預設）」摺疊區 → 勾選啟用後可覆寫：</Para>
          <ListBlock items={[
            'Backend / Fusion / 權重 / TopK 各欄位（留空 = 沿用系統預設）',
            'Fuzzy 模糊匹配（Oracle Text 誤召率高，預設關）',
            '同義詞字典（下拉挑 admin 已建立的字典）',
            'Multi-vector（per-KB 啟用 title+body 加權）',
          ]} />
          <NoteBox>空欄位會沿用系統預設。關掉上方開關可清除整個覆寫回到系統預設。</NoteBox>
        </SubSection>

        <SubSection title="Multi-vector（title + body 加權）">
          <Para>每個 chunk 額外用 heading 做一份 embedding。查詢時加權公式：<code>title_weight × sim(title) + body_weight × sim(body)</code>。</Para>
          <Para>Title 抽取啟發式（自動偵測）：</Para>
          <ListBlock items={[
            '[工作表: XXX] — xlsx sheet 標題',
            '# / ## / ### Markdown heading',
            '【XXX】 中文標題格式',
            '第一行 ≤ 80 字且非獨行（視為短 heading）',
          ]} />
          <Para>啟用步驟：</Para>
          <div className="space-y-3">
            <StepItem num={1} title="Admin → KB 檢索設定 → 勾「啟用 Multi-vector」+ 調權重 → 儲存" desc="預設 title_weight=0.3, body_weight=0.7" />
            <StepItem num={2} title="每個要啟用的 KB：進階檢索設定 → 勾「啟用 Multi-vector」" desc="新上傳的 chunks 會自動 embed title 向量" />
            <StepItem num={3} title="既有 chunks：KB 設定頁底部 紫色「補 title 向量」按鈕" desc="只 embed title 不動 body，費用低很多" />
          </div>
          <TipBox>對 heading 明顯的文件（SOP、技術手冊、help KB）效益最大。純表格資料（分機表）效益有限。</TipBox>
        </SubSection>

        <SubSection title="Chunker 工作表硬分段（xlsx 特例）">
          <Para>v2 chunker 偵測 xlsx parser 產生的 <code>[工作表: XXX]</code> 標記，強制 flush 分段，避免小 sheet（如只有 5 人的香港分機 sheet）被併到前一個大 chunk 訊號被稀釋。</Para>
          <Para>套用方式：<strong>現有 xlsx KB 需重新解析</strong>（KB 設定頁底部 橘色「重新解析此 KB」按鈕，會消耗 Vertex API 費用+時間）。未來新上傳的 xlsx 自動生效。</Para>
        </SubSection>

        <SubSection title="踩坑紀錄 & 防範">
          <Table
            headers={['項目', '說明']}
            rows={[
              ['chat / webex / research SELECT 必須含 retrieval_config', '少撈這欄 → 所有 per-KB 覆寫（同義詞、multi-vector、權重）全 noop。新增相關功能時 grep 所有 SELECT FROM knowledge_bases 務必加上'],
              ['ftx SYNC (ON COMMIT) 拖慢上傳', 'v2 改成 EVERY "SYSDATE+1/1440"，每分鐘背景 sync。查詢最多 1 分鐘 lag；若 Oracle 帳號缺 CREATE JOB 權限會 fallback ON COMMIT'],
              ['CTX_THES 權限缺失', 'FOXLINK Oracle 帳號無 EXECUTE ON CTXSYS.CTX_THES。同義詞改用自建表 + query-time OR 展開'],
            ]}
          />
          <NoteBox>完整架構與 commits 對照表：docs/kb-retrieval-architecture-v2.md</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-kb-synonyms" icon={<BookOpen size={22} />} iconColor="text-emerald-500" title="KB 同義詞字典">
        <Para>
          解決「Carson Chung」vs「鍾漢成」、「ERP」vs「Oracle EBS」這類 query 拼寫不同但指同一實體的檢索漏網問題。
          字典改用自建追蹤表 + query-time OR 展開，無需 Oracle CTX_THES 權限。
        </Para>

        <SubSection title="運作原理">
          <Para>在 query 送到 Oracle Text CONTAINS 之前，系統先掃字典 term ↔ related 關係：</Para>
          <ListBlock items={[
            'query 子字串命中任一 term → 自動在 query 尾端補 related',
            'query 子字串命中任一 related → 自動在 query 尾端補 term',
            '雙向、大小寫不敏感、支援多字 phrase（如 "Carson Chung"）',
          ]} />
          <Para>例：字典有 <code>鍾漢成 ↔ Carson Chung</code>，query 「Carson Chung 分機?」自動改寫為「Carson Chung 分機? 鍾漢成」後再 tokenize，展開的三 token 一起送 CONTAINS。</Para>
          <NoteBox>chat 端還會把同義詞關係當 hint 塞進 LLM context：「『X』=『Y』同一實體，請統合所有寫法對應的 chunks」，避免 LLM 只看其中一筆就下結論。</NoteBox>
        </SubSection>

        <SubSection title="建立字典 + 加同義詞">
          <div className="space-y-3">
            <StepItem num={1} title="Admin → KB 同義詞字典" />
            <StepItem num={2} title="左側「新增字典」輸入英數字底線名稱" desc="例 foxlink_syn、product_alias。命名規則：開頭字母、30 字內、英數字與底線" />
            <StepItem num={3} title="建立後選中字典 → 右側加 term ↔ related 關係" desc="例 term=鍾漢成 related=Carson Chung；可建多條" />
            <StepItem num={4} title="到 KB 設定頁 → 進階檢索 → 下拉選取字典名稱 → 儲存" desc="或到 KB 檢索設定系統預設處設定，對所有 KB 套用" />
          </div>
        </SubSection>

        <SubSection title="驗證字典有沒生效">
          <Para>到 KB 檢索調校頁 → 選 KB → 輸入同義詞觸發 query → 執行。</Para>
          <Para>檢索摘要會多顯示：</Para>
          <ListBlock items={[
            '同義詞字典: XXX — 展開 [YYY]（若命中）',
            '同義詞字典: XXX — query 未命中任何 phrase（沒命中，橘字提示）',
            'Effective query: 原 query + 展開詞',
            'CONTAINS query: 最終送 Oracle 的字串',
          ]} />
        </SubSection>

        <SubSection title="適用場景">
          <Table
            headers={['場景', '字典範例', '效益']}
            rows={[
              ['中英人名對照', '鍾漢成 ↔ Carson Chung', '英文名員工查得到中文紀錄'],
              ['技術縮寫', 'ERP ↔ Enterprise Resource Planning', '簡稱/全名都能搜'],
              ['產品代號', 'FL-X100 ↔ 連接器 X100 系列', '規格書/口語都命中'],
              ['廠區代碼', 'TCC ↔ 台中廠', '代碼和中文名互通'],
              ['部門別名', 'RD ↔ 研發部 ↔ R&D', '三種寫法等價'],
            ]}
          />
        </SubSection>

        <SubSection title="實作備註">
          <Para>原本計畫用 Oracle CTX_THES 存字典並靠 CONTAINS SYN(term, thes) 自動展開，但 FOXLINK Oracle 帳號缺 EXECUTE ON CTXSYS.CTX_THES 權限（<code>PLS-00201</code>）→ 改用自建追蹤表 <code>kb_thesauri</code> 和 <code>kb_thesaurus_synonyms</code>，query-time 在應用層手動 OR 展開。</Para>
          <ListBlock items={[
            '零 Oracle 權限要求（不用動 DBA）',
            '跨 Oracle 版本穩定（CTX view 欄位名版本差異多）',
            'Debug 可直接看 SQL（SYN() 展開在 Oracle 內部看不到）',
            '雙向 + 多字 phrase 支援比 CTX_THES.SYN 更靈活',
          ]} />
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
              ['效能考量', 'Workflow 中每個 LLM / API 連接器 / MCP 節點都會消耗 Token，建議控制節點數量以管理成本'],
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
          系統每日自動彙整每位使用者在每個 LLM 模型上消耗的 Token 數量，並根據費率設定自動計算費用。
          管理員可在「Token 統計」頁籤進行查詢、匯出 CSV，並設定各模型的計費費率。
        </Para>

        <SubSection title="Token 使用量查詢">
          <div className="space-y-3">
            <StepItem num={1} title="進入後台，點選「Token 統計」頁籤" />
            <StepItem num={2} title="設定查詢條件" desc="可選擇日期區間（預設 30 天）、篩選特定模型、依姓名/工號/Email/部門搜尋" />
            <StepItem num={3} title="查看明細表格" desc="每行為一筆「使用者 + 日期 + 模型」的彙總記錄" />
            <StepItem num={4} title="匯出 CSV" desc="點擊「匯出 CSV」下載完整明細，含幣別與圖片計數欄位" />
          </div>
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['日期', '使用日期（台灣時區，每日彙整一筆）'],
              ['使用者', '工號 + 姓名'],
              ['部門 / 利潤中心', '依 HR 組織同步的組織資訊'],
              ['模型', 'LLM 模型名稱（Pro / Flash / GPT-4o 等）'],
              ['輸入 Token', '送給 AI 的提示詞 Token 總數（含對話歷史）'],
              ['輸出 Token', 'AI 生成回覆的 Token 總數'],
              ['圖片輸出數', '若模型有圖片生成，記錄當日產生的圖片張數'],
              ['費用 (USD)', '根據費率設定計算的當日費用'],
            ]}
          />
        </SubSection>

        <SubSection title="費率設定（Token Pricing）">
          <Para>
            系統依各模型的費率設定計算費用。管理員可在「Token 統計」頁籤右側的「費率設定」區域，
            為每個模型設定一或多筆費率記錄（支援費率調漲/降情境）。
          </Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['模型名稱', '對應 LLM 模型的 key（支援下拉自動補全）', 'pro, gpt4o-eus'],
              ['輸入價格 / 1M tokens（第 1 段）', '每百萬輸入 Token 的費用', '3.50'],
              ['輸出價格 / 1M tokens（第 1 段）', '每百萬輸出 Token 的費用', '10.50'],
              ['圖片輸出價格 / 張', '每張圖片生成的費用（僅圖片模型填寫）', '0.04'],
              ['幣別', 'USD / TWD / CNY', 'USD'],
              ['生效日期', '此費率從哪天起適用', '2026-01-01'],
              ['結束日期', '費率到哪天止（空白 = 永久）', '（空白）'],
              ['啟用兩段計費', '超過門檻 Token 數的部分使用第 2 段價格', '勾選'],
              ['第 1 段上限 (tokens)', '兩段計費門檻，超過此數量使用第 2 段費率', '1000000'],
              ['輸入價格 / 1M tokens（第 2 段）', '超出門檻後的輸入費率', '7.00'],
              ['輸出價格 / 1M tokens（第 2 段）', '超出門檻後的輸出費率', '21.00'],
            ]}
          />
          <TipBox>
            若同一模型有多筆費率記錄，系統依照<strong>生效日期區間</strong>選取對應費率計算，
            支援費率隨時間變動的場景（如 Google 調整定價）。
          </TipBox>
          <NoteBox>
            費率設定後，可點擊「重新計算費用（365天）」按鈕，根據新費率補算過去所有使用記錄的費用欄位，
            確保歷史數據準確。
          </NoteBox>
        </SubSection>

        <SubSection title="費用分析（成本歸因）">
          <Para>
            點選「費用統計及分析」頁籤，可依利潤中心、部門、員工三個層級分析 AI 費用歸因：
          </Para>
          <Table
            headers={['面板', '說明']}
            rows={[
              ['利潤中心費用佔比（圓餅圖）', '各利潤中心的費用佔全公司比例；點擊可鑽取到部門層級'],
              ['部門費用由高到低（長條圖）', '選定利潤中心後，顯示其底下各部門的費用排行'],
              ['月份費用趨勢', '時間序列長條圖，顯示各月各利潤中心費用趨勢'],
              ['利潤中心費用總表', '含部門、事業處、事業群分類，支援點擊鑽取'],
              ['月份費用分析表', '同一利潤中心下的月份明細'],
              ['員工 Token 明細清單', '最細粒度，顯示每位員工的輸入/輸出 Token 及費用'],
            ]}
          />
          <TipBox>點擊利潤中心圓餅圖某個扇形，可篩選該利潤中心的部門長條圖；再點部門長條圖可進一步看員工清單。三層鑽取無需頁面跳轉。</TipBox>
          <Para>費用分析所有視圖均支援<strong>匯出 CSV</strong>，可分別匯出利潤中心彙總、月份分析、員工清單。</Para>
        </SubSection>
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
          MCP（Model Context Protocol）是一種標準通訊協定，讓 Cortex 的 AI 對話可以即時呼叫外部工具伺服器，
          擴充 AI 的能力範圍，例如查詢 ERP 資料庫、呼叫企業內部 API、執行自動化腳本等。
          系統全面支援 MCP 的所有主流傳輸模式，包含新舊規範及本地端 stdio 模式。
        </Para>

        <SubSection title="Tags 標籤 — TAG 路由的關鍵設定">
          <div className="border-2 border-amber-400 bg-amber-50 rounded-xl p-4 mb-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-amber-600" />
              <span className="font-bold text-amber-700">重要：Tags 是讓 AI 自動選用 MCP 工具的必要條件</span>
            </div>
            <p className="text-sm text-amber-700">
              若未設定 Tags，使用者在對話中<strong>必須手動</strong>從頂端列切換按鈕選取此 MCP 伺服器，
              系統不會自動判斷何時使用。設定 Tags 後，LLM 會根據使用者訊息的意圖自動比對標籤，決定是否啟用此工具。
            </p>
          </div>
          <Para>Tags 設定建議：</Para>
          <Table
            headers={['MCP 用途', '建議 Tags', '說明']}
            rows={[
              ['ERP 工單查詢', 'ERP, 工單, WO, 生產', '使用者說「查工單」「WO12345」等即觸發'],
              ['庫存查詢', '庫存, 料號, BOM, 備料', '使用者說「查料號」「確認庫存」等即觸發'],
              ['HR 人事系統', 'HR, 人事, 員工, 組織', '使用者說「查員工」「部門主管」等即觸發'],
              ['通用工具', '（不設 Tags）', '只能手動掛載，不會自動觸發'],
            ]}
          />
        </SubSection>

        <SubSection title="支援的傳輸模式">
          <Table
            headers={['傳輸模式', '適用場景', '說明']}
            rows={[
              ['HTTP POST (http-post)', '標準 MCP 伺服器', '傳統 MCP 請求/回應模式，大多數 MCP Server 支援'],
              ['HTTP SSE (http-sse)', '舊式 MCP 伺服器', 'MCP 2024 規範的 SSE 模式，向下相容舊版 MCP Server'],
              ['Streamable HTTP (streamable-http)', '新式 MCP 伺服器', 'MCP 2025 規範，支援串流回應，推薦優先使用'],
              ['stdio（本地指令）', '本地端 MCP 工具', '在 server 機器上執行 npx / python 等指令，無需 HTTP 端點'],
              ['auto（自動偵測）', '不確定時選此', '系統自動嘗試多種協定，找到可用的即套用'],
            ]}
          />
          <NoteBox>
            stdio 模式在 server 主機本地執行 MCP 工具（如 npx -y @modelcontextprotocol/server-filesystem /tmp），
            工具直接存取本機資源，不經由 HTTP 傳輸，適合檔案系統、資料庫等本地工具。
          </NoteBox>
        </SubSection>

        <SubSection title="新增 MCP 伺服器">
          <div className="space-y-3">
            <StepItem num={1} title="進入後台，點選「MCP 伺服器」頁籤" />
            <StepItem num={2} title="點選「新增伺服器」按鈕" />
            <StepItem num={3} title="選擇傳輸模式" desc="HTTP 類型填入 URL + API Key；stdio 類型填入指令（command）及可選的 args_json / env_json" />
            <StepItem num={4} title="填寫名稱、說明、Tags" desc="Tags 為讓 AI 自動路由的關鍵，建議依業務領域填入" />
            <StepItem num={5} title="選擇回應方式（response_mode）" desc="inject = AI 收到工具結果後自行回答；answer = 工具結果直接作為 AI 最終回覆" />
            <StepItem num={6} title="儲存後點選同步圖示（↻）" desc="系統連線到 MCP 伺服器取得可用工具清單，並存入 tools_json" />
            <StepItem num={7} title="確認工具清單已載入，狀態為啟用（綠燈）" />
          </div>
        </SubSection>

        <SubSection title="設定欄位說明">
          <Table
            headers={['欄位', '必填', '說明']}
            rows={[
              ['名稱', '是', '識別用顯示名稱，例：ERP DB Search'],
              ['傳輸方式', '是', '選擇上方五種傳輸模式之一'],
              ['URL（HTTP 類型）', '是', 'MCP 伺服器的 HTTP 端點'],
              ['API Key（HTTP 類型）', '否', '若 MCP 伺服器需要驗證，填入 Bearer Token'],
              ['指令（stdio 類型）', '是', '本地執行指令，如 npx -y @modelcontextprotocol/server-filesystem /tmp'],
              ['Args JSON（stdio 類型）', '否', '額外參數，JSON Array 格式，如 ["/data", "--readonly"]'],
              ['Env JSON（stdio 類型）', '否', '環境變數，JSON Object 格式，如 {"API_KEY": "xxx"}'],
              ['回應方式', '是', 'inject = AI 整合後回答；answer = 直接輸出工具結果'],
              ['說明（description）', '建議填', '告訴 AI 此工具的業務用途，影響 AI 判斷何時使用'],
              ['標籤（Tags）', '必填，否則無法自動路由', '如「ERP」「工單」「庫存」，以逗號分隔'],
              ['啟用', '—', '關閉後 AI 對話不會呼叫此伺服器的工具'],
              ['公開', '—', '勾選後申請公開，需管理員核准，所有使用者可在側邊欄選取'],
              ['傳送使用者身份（X-User-Token）', '—', '勾選後，每次呼叫此 MCP 會加上 RS256 JWT Header，內含使用者 email / 工號 / 部門（5 分鐘有效）。MCP 端以公鑰驗簽後可做資料權限判斷。預設關閉，漸進啟用'],
            ]}
          />
        </SubSection>

        <SubSection title="使用者身份認證（X-User-Token）">
          <Para>
            若 MCP 伺服器需要自行做資料權限判斷（例如依員工 email 查 AD group 決定可查詢的資料範圍），
            可啟用此功能，讓 Cortex 在每次 `tools/call` 時於 HTTP Header 夾帶一顆短效 RS256 JWT。
            採非對稱金鑰架構：Cortex 端持有<strong>私鑰</strong>簽發，MCP 端只需<strong>公鑰</strong>驗證，
            MCP 即使被攻破也無法偽造任何使用者身份。
          </Para>

          <div className="border-2 border-indigo-400 bg-indigo-50 rounded-xl p-4 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={16} className="text-indigo-600" />
              <span className="font-bold text-indigo-700">Per-server 漸進啟用</span>
            </div>
            <p className="text-sm text-indigo-700">
              此功能為 <strong>per-MCP 開關</strong>，預設<strong>關閉</strong>。舊 MCP 或不需要使用者身份判斷的 MCP 不受影響。
              只有確認對接的 MCP 團隊已實作驗簽邏輯後，才在對應 server 上勾選啟用。
            </p>
          </div>

          <Para>JWT Claims 規格：</Para>
          <Table
            headers={['Claim', '值', '說明']}
            rows={[
              ['alg', 'RS256', 'RSA-SHA256，Header 內限定，防 alg 切換攻擊（CVE-2016-5431）'],
              ['iss', '"foxlink-gpt"', 'Issuer 固定值，MCP 端需驗證'],
              ['exp', 'iat + 300', '5 分鐘有效期，每次呼叫重新簽'],
              ['jti', 'UUID v4', '唯一識別，MCP 可拿去做 replay 防禦 / log 對齊'],
              ['sub', '員工編號', '無員工編號時為 Cortex 內部 user id'],
              ['email', 'user email', 'MCP 做權限判斷的主要依據（最可靠）'],
              ['name', '姓名', '可能為 null'],
              ['dept', '部門代碼', 'dept_code，可能為 null；建議拿 email 自行查 AD 取最新值'],
            ]}
          />

          <SubSection title="Modal 內建工具">
            <div className="space-y-2">
              {[
                { icon: <Download size={13} />, label: '下載公鑰', desc: '下載 foxlink-gpt-public.pem，寄給 MCP 團隊用於驗簽。公鑰可公開，洩漏不會造成安全問題' },
                { icon: <Copy size={13} />, label: '複製公鑰', desc: '把公鑰內容複製到剪貼簿，方便貼進 email 或文件' },
                { icon: <KeyRound size={13} />, label: '產生測試 Token', desc: '輸入 email / name / sub / dept 後，即時簽發一顆 JWT + 顯示 decoded claims，提供給 MCP 團隊驗證他們的驗簽流程' },
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
          </SubSection>

          <SubSection title="給 MCP 開發團隊的完整規格書">
            <Para>
              當有 MCP 團隊準備對接時，請將以下三樣一起寄給他們：
            </Para>
            <Table
              headers={['交付物', '位置', '說明']}
              rows={[
                ['規格書 PDF', 'docs/mcp-integration-spec.pdf', '8 頁完整對接規格，含 5 種語言（Node/Python/Go/C#/Java）驗簽範例 + 最小可執行 Node 範本 + 驗收 checklist'],
                ['公鑰 PEM', 'docs/foxlink-gpt-public.pem 或 UI 下載按鈕', 'MCP 團隊用於驗簽的公鑰（可公開分享）'],
                ['測試 Token', 'UI「產生測試 Token」即時產', '5 分鐘內有效，提供給 MCP 驗證他們的驗簽流程是否正確'],
              ]}
            />
          </SubSection>

          <SubSection title="對接流程">
            <div className="space-y-3">
              <StepItem num={1} title="MCP 團隊 Kickoff" desc="寄送規格書 PDF + 公鑰 + 測試 Token，約定 transport、URL、api_key 格式" />
              <StepItem num={2} title="MCP 端實作驗簽" desc="對方依據規格書實作；必做驗證：algorithms=['RS256']、iss='foxlink-gpt'、clockTolerance 30s、exp 未過期" />
              <StepItem num={3} title="聯合測試（未啟用開關）" desc="admin 在 UI 新增 MCP server 但先不勾 send_user_token，確認 service-level 通（api_key 層）" />
              <StepItem num={4} title="切換啟用開關" desc="勾選「傳送使用者身份」→ 儲存 → 列表卡片會出現紫色 🔐 X-User-Token badge；在對話中呼叫此 MCP 的工具，MCP 端應能解出 email claim" />
              <StepItem num={5} title="審計驗證" desc="呼叫記錄（call logs）會新增 user_email 和 jti 欄位，可與 MCP 端 log 對齊單次呼叫" />
            </div>
          </SubSection>

          <SubSection title="stdio 模式的特殊處理">
            <NoteBox>
              stdio 子程序沒有 HTTP header，Cortex 會透過<strong>環境變數</strong>傳遞：
              `MCP_API_KEY`（服務身份）+ `MCP_USER_TOKEN`（使用者 JWT）。
              因此 stdio MCP <strong>每次 tools/call 都必須重新 spawn 一個新子程序</strong>
              （token exp 只有 5 分鐘，env var 一旦 spawn 就不能改）。不可 keep-alive 或 process pool。
            </NoteBox>
          </SubSection>

          <SubSection title="錯誤排查">
            <Table
              headers={['症狀', '可能原因', '解法']}
              rows={[
                ['呼叫 MCP 時回 MCP_JWT_EMAIL_REQUIRED', '使用者 email 為空但該 MCP 已啟用 send_user_token', '到使用者管理幫該帳號補 email；或暫時關掉 send_user_token'],
                ['呼叫 MCP 時回 MCP_JWT_PRIVATE_KEY_NOT_CONFIGURED', 'server 啟動時讀不到私鑰', '檢查 env: MCP_JWT_PRIVATE_KEY_PATH 是否指向正確的 .pem 檔；K8s 需掛 Secret mcp-jwt-keys 到 /app/certs'],
                ['MCP 端回 401 invalid algorithm', 'MCP 驗簽沒限定 RS256 或限定成 HS256', '規格書 §4 步驟 3：algorithms=[\'RS256\'] 必須鎖死'],
                ['MCP 端回 401 jwt expired', 'Cortex 與 MCP server 時鐘差異 > 30 秒', '確認兩端 NTP 同步；或請對方把 clockTolerance / leeway 調到 60 秒'],
                ['產生測試 Token 按鈕回 503', '後端私鑰未載入', '檢查 server log 是否有 [mcp-jwt] private key loaded 訊息；未載入代表 env 沒設或檔案不存在'],
              ]}
            />
          </SubSection>

          <SubSection title="金鑰輪替（Rotation）">
            <Para>
              建議每年輪替一次 key pair，或有可接觸私鑰的人員離職時即時輪替。詳細 SOP 見
              `server/certs/README.md` 及 `docs/mcp-user-identity-auth.md §4.3`。
              輪替期間 MCP 端需同時接受新舊兩把公鑰，待所有 MCP 部署完畢後 Cortex 才切換私鑰。
            </Para>
          </SubSection>
        </SubSection>

        <SubSection title="公開核准">
          <Para>
            MCP 伺服器預設僅建立者可使用（或透過角色授權）。勾選「公開」後進入待審核狀態，
            管理員在列表中看到「核准」按鈕點擊後，所有使用者即可在頂端列的 MCP 切換面板中看到此工具。
          </Para>
        </SubSection>

        <SubSection title="同步與管理">
          <div className="space-y-2">
            {[
              { icon: <RefreshCw size={13} />, label: '同步工具（↻）', desc: '重新從 MCP 伺服器取得最新工具清單，更新 tools_json（伺服器新增工具後需同步）' },
              { icon: <Info size={13} />, label: '展開工具清單', desc: '點選伺服器卡片左側箭頭，查看所有工具名稱及說明' },
              { icon: <Info size={13} />, label: '呼叫記錄', desc: '查看 AI 實際呼叫工具的歷史，含使用者、時間、成功/失敗狀態、耗時、回應預覽（最近 50 筆）' },
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
          <NoteBox>HTTP 類型 MCP 伺服器必須部署在 server 網路可連接的位置。stdio 類型工具在 server 主機本地執行，無需外部連線。如需自行開發 MCP 伺服器，請參考 MCP 2025 官方規範文件。</NoteBox>
        </SubSection>
      </Section>

      <Section id="a-dify" icon={<Zap size={22} />} iconColor="text-yellow-500" title="API 連接器整合">
        <Para>
          API 連接器可連接各種外部 REST API，
          將企業內部文件、產品規格、SOP 等資料透過 API 接入系統。
          整合後，使用者在 Cortex 對話時，AI 可自動查詢相關知識庫，
          讓回答能參考企業內部文件內容，而非僅依賴通用知識。
        </Para>

        <div className="border-2 border-amber-400 bg-amber-50 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <span className="font-bold text-amber-700">重要：Tags 是讓 AI 自動選用 API 連接器的必要條件</span>
          </div>
          <p className="text-sm text-amber-700">
            若未設定 Tags，使用者在對話中<strong>必須手動</strong>從頂端列切換按鈕選取此知識庫，
            系統不會在對話中自動查詢。設定 Tags 後，LLM 根據使用者訊息意圖自動比對標籤，決定是否查詢此知識庫。
          </p>
        </div>

        <SubSection title="運作原理">
          <Para>
            每次使用者發送訊息時，系統同時將訊息送去查詢所有已啟用的 API 連接器，
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
                系統查詢 API 連接器，找到產品規格文件中的相關段落
              </div>
              <div className="flex items-center gap-3">
                <span className="w-5 h-5 bg-green-600 rounded-full flex items-center justify-center text-xs text-white flex-shrink-0">3</span>
                AI 結合知識庫內容回答：「根據產品規格書，FL-X100 最大電流為 5A...」
              </div>
            </div>
          </div>
        </SubSection>

        <SubSection title="新增 API 連接器">
          <div className="space-y-3">
            <StepItem num={1} title="在外部平台建立知識庫或 API 端點並取得 API Key" desc="取得外部 REST API 的端點 URL 與認證金鑰（API Key / OAuth2 等）" />
            <StepItem num={2} title="進入 Cortex 後台，點選「API 連接器」頁籤" />
            <StepItem num={3} title="點選「新增連接器」按鈕" />
            <StepItem num={4} title="填寫設定欄位" desc="名稱、API Server、API Key、描述（重要）、排序順序" />
            <StepItem num={5} title="點選「測試」按鈕確認連線正常" desc="測試成功會顯示回應時間及預覽文字" />
            <StepItem num={6} title="啟用後即生效" desc="之後所有使用者對話都會自動查詢此連接器" />
          </div>
        </SubSection>

        <SubSection title="設定欄位說明">
          <Table
            headers={['欄位', '必填', '說明']}
            rows={[
              ['名稱', '是', '識別用顯示名稱，例：產品規格知識庫'],
              ['API URL', '是', '外部 API 端點，例如 https://afservice.foxlink.com.tw/AIService/api/...'],
              ['API Key', '是（新增時）', '外部平台的 API Key。編輯時留空表示保持不變'],
              ['描述', '建議填', '告訴 AI 這個知識庫的用途，讓 AI 更精準地判斷何時引用。例：包含產品規格、零件型號，當使用者詢問產品規格時引用'],
              ['標籤（Tags）', '必填，否則無法自動路由', '如「產品規格」「零件」「SOP」。系統根據使用者訊息意圖自動比對標籤，決定是否查詢此知識庫'],
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

      <Section id="a-erp-tools" icon={<Database size={22} />} iconColor="text-sky-600" title="ERP 工具管理">
        <Para>
          ERP 工具將 Oracle ERP 的 <strong>FUNCTION / PROCEDURE</strong> 包裝成平台可呼叫的工具，
          讓 LLM 透過 Gemini function calling 自動呼叫，或由使用者手動觸發。
          管理介面位於「<strong>API 連接器管理</strong>」tab → 子類 chip <strong>ERP Procedure</strong>。
        </Para>

        <div className="border-2 border-red-400 bg-red-50 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-600" />
            <span className="font-bold text-red-700">安全提醒：WRITE 型工具會實際修改 ERP 資料</span>
          </div>
          <p className="text-sm text-red-700">
            註冊 WRITE 型工具前請確認 DB 帳號權限與預期行為一致。平台預設會要求使用者手動確認才會執行，
            LLM 無法繞過；但錯誤的工具註冊仍會造成資料異動。建議所有 WRITE 型工具都搭配 audit log 定期稽核。
          </p>
        </div>

        <SubSection title="註冊流程（四步）">
          <ol className="space-y-3 text-sm">
            <li>
              <strong>1. 輸入 ERP 物件三元組</strong>
              <p className="text-slate-600 mt-1">Owner（Schema，如 APPS）、Package（選填，如 HR_PKG）、Function/Procedure 名稱（如 GET_EMP_INFO）。按「查詢 metadata」。</p>
            </li>
            <li>
              <strong>2. 選擇 Overload（若有多個簽章）</strong>
              <p className="text-slate-600 mt-1">系統會列出所有 overload，含參數清單、回傳型別。若任一 overload 含不支援型別（如 RECORD / TABLE OF）會標灰。</p>
            </li>
            <li>
              <strong>3. 設定基本資訊</strong>
              <p className="text-slate-600 mt-1">code（給 LLM 呼叫的識別字，自動產生可改）、顯示名稱、描述（給 LLM 看的）、tags（TAG router 用）。</p>
            </li>
            <li>
              <strong>4. 設定每個參數的 AI Hint 與 LOV</strong>
              <p className="text-slate-600 mt-1">AI Hint 是給 LLM 看的參數說明；LOV 是使用者手動觸發時的下拉來源。</p>
            </li>
          </ol>
        </SubSection>

        <SubSection title="三種呼叫入口（獨立開關）">
          <Table
            headers={['入口', '欄位', '說明']}
            rows={[
              ['LLM 自動呼叫', 'allow_llm_auto', '透過 Gemini function calling，LLM 在對話中自主決定是否呼叫。WRITE 型預設關閉；開啟後仍會在對話中跳確認框'],
              ['使用者手動觸發', 'allow_manual', '對話輸入框左側 🛢 ERP 按鈕可立即執行，適合精確查詢'],
              ['Inject（自動注入）', 'allow_inject', '每輪對話前平台自動跑一次，結果塞 system prompt。適合當前使用者狀態、今日指標等固定 context'],
            ]}
          />
          <NoteBox>Inject 模式的限制：所有參數必須設「固定值」或「系統值」（如當前使用者工號、當前日期），不能需要使用者輸入或 AI 提取。註冊時會驗證，不合規會擋下。</NoteBox>
        </SubSection>

        <SubSection title="LOV（List Of Values）— 四種來源">
          <Table
            headers={['類型', '用途', '範例']}
            rows={[
              ['static', '固定選項清單', '是/否、有效/停用'],
              ['sql', 'ERP DB 查詢（禁 DML）', 'SELECT emp_no v, emp_name l FROM fl_employee WHERE factory=:factory'],
              ['system', '系統值自動帶', '當前使用者工號 / 部門 / 廠區'],
              ['erp_tool', '鏈式：另一個已註冊 ERP tool 的回傳值', '「員工清單」工具當「薪資查詢」的 LOV'],
            ]}
          />
          <NoteBox>SQL LOV 會自動套上 <code>ROWNUM &lt;= ERP_TOOL_LOV_MAX_ROWS</code>（預設 500）防爆，且禁止 UPDATE/DELETE/INSERT 等 DML 關鍵字。可引用系統值當 bind：<code>{'{'} name: 'factory', source: 'system_user_factory' {'}'}</code>。</NoteBox>
        </SubSection>

        <SubSection title="Access Mode 與安全設計">
          <Table
            headers={['欄位', '用途']}
            rows={[
              ['access_mode', 'READ_ONLY / WRITE，手動勾選；僅影響 UI 標記與預設行為，不檢查 procedure 實際邏輯'],
              ['requires_approval', 'WRITE 型可設「需 admin 審批」（v2 規劃，目前走一次性確認 token）'],
              ['allow_llm_auto', 'WRITE 型預設關閉；關閉時 LLM 仍可看到 tool_schema，但呼叫會被攔截要求使用者手動確認'],
              ['rate_limit_per_user', '每使用者呼叫上限（次數）；時窗 minute/hour/day 可選；留空=不限'],
              ['rate_limit_global', '全域呼叫上限（次數）；留空=不限'],
              ['allow_dry_run', 'WRITE 型可開啟；執行時用 SAVEPOINT 包起來，結束後 ROLLBACK，用於預覽'],
              ['timeout_sec', 'Oracle 呼叫逾時（預設 30 秒）'],
              ['max_rows_llm / max_rows_ui', 'LLM 看到的最多列數（預設 50）/ UI 表格最多列數（預設 1000），超過自動截斷並標記；完整結果暫存 Redis 30 分鐘'],
            ]}
          />
        </SubSection>

        <SubSection title="執行歷史與稽核">
          <Para>
            ERP Procedure 工具列上方的「執行歷史」按鈕可查看所有工具的呼叫紀錄，每個工具列右側的「歷史」圖示則顯示單一工具的歷史。
            記錄內容：時間、工具、觸發來源（LLM / 手動 / Inject / 試跑）、使用者、參數、輸出樣本、耗時、錯誤碼。
          </Para>
          <NoteBox>完整結果快取存於 Redis，TTL 預設 1800 秒（由 <code>ERP_TOOL_RESULT_CACHE_TTL</code> 控制），過期後只能看 audit log 裡的樣本。WRITE 型必寫 audit log 不可關。</NoteBox>
        </SubSection>

        <SubSection title="Metadata Drift 自動檢查">
          <Para>
            系統每小時背景執行一次 metadata 比對（由 <code>ERP_TOOL_METADATA_CHECK_CRON</code> 控制），
            若 DBA 改了 procedure 簽章導致 hash 不一致，列表的 tool 會顯示橘色「metadata 已變動」徽章。
          </Para>
          <Para>
            Admin 也可在編輯畫面手動觸發「重新同步 metadata」，查看新舊差異後決定是否更新參數定義。
            注意：簽章變動通常需要一併更新 LOV 設定和 AI Hint，不只是 hash 對齊。
          </Para>
        </SubSection>

        <SubSection title="多語化翻譯">
          <Para>
            編輯畫面底部有「翻譯（en / vi）」按鈕，會透過 LLM 自動翻譯：工具名稱、描述、每個參數的 ai_hint。
            翻譯結果存於 <code>erp_tool_translations</code>，顯示於管理介面預覽。
            （給 LLM 看的 tool_schema 目前仍用 zh-TW 原始版，避免 LLM 混淆多語言工具名）
          </Para>
        </SubSection>

        <SubSection title="代理 skill row 機制（技術說明）">
          <Para>
            每個 erp_tool 註冊時，後端會在 <code>skills</code> 表自動建立一筆 <code>type='erp_proc'</code> 的代理 row，
            帶著 tool_schema 與 erp_tool_id 反查。這讓 chat.js 的現有 tool-calling 管線（TAG router、function declaration 註冊、toolHandler 分派）能直接復用。
          </Para>
          <NoteBox>這筆代理 row 不會出現在「技能管理」與「技能市集」UI 中（前端已過濾）。刪除 ERP 工具時會自動 cascade 刪除對應 skill row。</NoteBox>
        </SubSection>

        <SubSection title="環境變數">
          <Table
            headers={['變數名', '用途', '預設值']}
            rows={[
              ['ERP_DB_HOST / PORT / SERVICE_NAME / USER / USER_PASSWORD', 'ERP Oracle 連線', '必填'],
              ['ERP_ALLOWED_SCHEMAS', 'Owner 白名單（逗號分隔）；留空或設 * = 不限制', '空（不限）'],
              ['ERP_TOOL_LOV_MAX_ROWS', 'LOV SQL 強制 ROWNUM 上限', '500'],
              ['ERP_TOOL_RESULT_CACHE_TTL', '完整結果 Redis 快取秒數', '1800（30 分鐘）'],
              ['ERP_TOOL_METADATA_CHECK_CRON', 'drift 背景檢查 cron 表達式（Asia/Taipei）', '0 * * * *（每小時）'],
              ['ERP_TOOL_DEFAULT_TIMEOUT_SEC', 'Oracle 呼叫預設逾時秒數', '30'],
            ]}
          />
        </SubSection>

        <SubSection title="MVP 支援的 PL/SQL 型別">
          <Para>
            <strong>支援：</strong>VARCHAR2、CHAR、NUMBER、INTEGER、FLOAT、BINARY_FLOAT、BINARY_DOUBLE、PLS_INTEGER、DATE、TIMESTAMP、CLOB、NCLOB、SYS_REFCURSOR。
          </Para>
          <Para>
            <strong>不支援（v1）：</strong>PL/SQL RECORD、TABLE OF、OBJECT TYPE 等複合型別（data_level &gt; 0）。inspect 時會標灰，無法註冊該 overload。
          </Para>
        </SubSection>

        <SubSection title="使用者端呈現">
          <Para>
            使用者在對話頁可用三個方式觸發 ERP 工具，詳見一般使用者手冊「ERP 工具呼叫」章節：
          </Para>
          <ul className="list-disc ml-5 space-y-1 text-sm text-slate-700">
            <li><strong>Topbar ⚡ API 連接器按鈕</strong>：打開 popup 選擇啟用的工具（DIFY / REST / ERP 三區混合），勾選後 LLM 會自動使用</li>
            <li><strong>輸入框左側 🛢 ERP 按鈕</strong>：立即執行，填參數 → 執行 → 選擇顯示結果 / AI 解釋 / 以此提問</li>
            <li><strong>WRITE 確認對話框</strong>：LLM 呼叫 WRITE 型工具時，平台自動跳紅色確認框，使用者可選填原因後執行</li>
          </ul>
        </SubSection>

        <NoteBox>
          完整技術設計見 <code>docs/erp-tools-design.md</code>。API 路由列於 <code>server/routes/erpTools.js</code>，核心邏輯於 <code>server/services/erpToolExecutor.js</code>。
        </NoteBox>
      </Section>

      <Section id="a-llm" icon={<Cpu size={22} />} iconColor="text-violet-500" title="LLM 模型管理">
        <Para>
          在「LLM 模型設定」頁籤，管理員可新增、編輯或停用 AI 模型選項，
          支援 <strong>Google Gemini、Azure OpenAI、Oracle OCI Generative AI、Cohere</strong> 四種供應商，
          涵蓋 chat（對話）、embedding（向量化）、rerank（重排序）、tts（文字轉語音）、stt（語音轉文字）五種模型角色。
        </Para>

        <SubSection title="通用欄位">
          <Table
            headers={['欄位', '必填', '說明']}
            rows={[
              ['識別鍵 (key)', '是', '系統內部識別碼（如 pro、flash、gpt4o-eus），新增後不可修改'],
              ['顯示名稱', '是', '使用者看到的模型名稱'],
              ['提供商', '是', 'gemini / azure_openai / oci / cohere，新增後不可修改'],
              ['模型角色', '是', 'chat（對話）/ embedding（向量化）/ rerank（重排序）/ tts（語音合成）/ stt（語音識別）'],
              ['API 模型 ID', '依提供商', 'Gemini/OCI/Cohere 必填；Azure 不需（使用 Deployment Name）'],
              ['說明文字', '否', '顯示於模型選單下方的小字說明'],
              ['排序', '否', '數字越小排越前，影響選單顯示順序'],
              ['支援圖片輸出', '否', '開啟後此模型支援圖片生成（Gemini Imagen 系列）'],
              ['啟用', '—', '關閉後使用者無法選擇此模型，但歷史記錄不受影響'],
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

        <SubSection title="Oracle OCI Generative AI 模型設定">
          <Para>選擇供應商「Oracle OCI」後，需填寫以下欄位（所有 OCI 憑證均加密存儲）：</Para>
          <Table
            headers={['欄位', '說明', '範例']}
            rows={[
              ['API 模型 ID', 'OCI 模型 ID', 'cohere.command-r-plus'],
              ['User OCID', 'OCI 使用者 OCID', 'ocid1.user.oc1..xxx'],
              ['Tenancy OCID', 'OCI 租戶 OCID', 'ocid1.tenancy.oc1..xxx'],
              ['Fingerprint', 'API Key 指紋', 'xx:xx:xx:...'],
              ['Region', 'OCI 區域', 'ap-tokyo-1'],
              ['Compartment ID', 'OCI Compartment（選填）', 'ocid1.compartment.oc1..xxx'],
              ['Private Key（PEM）', 'RSA 私鑰（.pem 內容），加密後存入 DB；編輯時留空=保持原值', '-----BEGIN RSA PRIVATE KEY-----...'],
            ]}
          />
        </SubSection>

        <SubSection title="Cohere 模型設定">
          <Para>選擇供應商「Cohere」後，需填寫以下欄位：</Para>
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['API 模型 ID', 'Cohere 模型代號，如 rerank-v3.5（通常用於 Rerank 角色）'],
              ['API Key', 'Cohere API Key，加密存入 DB'],
            ]}
          />
          <TipBox>Cohere 目前主要用於 Rerank（重排序）模型角色，搭配知識庫混合檢索使用，提升召回精準度。</TipBox>
        </SubSection>

        <SubSection title="測試連線">
          <Para>
            新增或編輯模型後，點選對話框底部的「測試連線」按鈕，系統會向目標模型發送一則測試訊息並顯示回應，
            確認 API Key、Endpoint、Deployment 設定均正確後再儲存。
          </Para>
          <NoteBox>測試時使用的 API Key 優先使用表單中填入的值；若表單留空，則使用 DB 中已加密儲存的 Key。</NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ 資料權限管理 */}

      <Section id="a-data-permissions" icon={<ShieldCheck size={22} />} iconColor="text-indigo-600" title="資料權限管理">
        <Para>
          資料權限管理用於控制每位使用者或角色在 AI 戰情室可查詢的 ERP 資料範圍。
          透過建立<strong>原則（Policy）→ 規則（Rule）</strong>的組合，並指派給使用者或角色，
          系統在執行 SQL 時自動在 WHERE 條件加入對應的過濾條件。
        </Para>

        <SubSection title="核心概念">
          <Table
            headers={['概念', '說明']}
            rows={[
              ['原則（Policy）', '一組規則的集合，定義「可看到哪些資料」的完整條件，可指派給使用者或角色'],
              ['規則（Rule）', '最細粒度的限制單元，格式為「欄位 + 操作符 + 值」，如 dept_code = D001'],
              ['類別（Category）', '將多個原則分組管理，例如「生產」「採購」「人資」類別'],
              ['指派（Assignment）', '將原則套用到特定使用者帳號或角色，生效後即時限制其查詢範圍'],
            ]}
          />
        </SubSection>

        <SubSection title="建立資料權限原則">
          <div className="space-y-3">
            <StepItem num={1} title="進入後台 → 資料權限管理" />
            <StepItem num={2} title="點擊「+ 新增原則」" desc="填入名稱（必填）、說明、所屬類別（選填）" />
            <StepItem num={3} title="新增規則" desc="為原則加入一或多條規則，每條規則指定「欄位 + 操作符 + 值」" />
            <StepItem num={4} title="儲存原則" />
            <StepItem num={5} title="指派給使用者或角色" desc="在原則清單點擊「指派」，選擇使用者帳號或角色，點「確認指派」" />
          </div>
        </SubSection>

        <SubSection title="規則欄位與操作符">
          <Para>支援的過濾欄位（field）對應 ERP 組織維度：</Para>
          <Table
            headers={['欄位名稱', '說明', '範例值']}
            rows={[
              ['dept_code', '部門代碼', 'D001, R&D'],
              ['profit_center', '利潤中心代碼', 'PC001'],
              ['org_section', '事業處代碼', 'OA'],
              ['org_group_name', '事業群名稱', 'ICP'],
              ['org_code', '組織代碼', 'TW01'],
              ['organization_id', 'ERP Multi-Org 製造組織 ID', '101'],
              ['organization_code', 'ERP Multi-Org 製造組織代碼', 'M01'],
              ['operating_unit', '營運單位 ID', '2000'],
              ['operating_unit_name', '營運單位名稱', 'Taiwan OU'],
              ['set_of_books_id', '帳套 ID', '1'],
              ['set_of_books_name', '帳套名稱', 'TWD Corp Ledger'],
            ]}
          />
          <Para>可用的操作符：</Para>
          <Table
            headers={['操作符', '說明', '範例']}
            rows={[
              ['eq（等於）', '精確比對', 'dept_code eq D001'],
              ['in（包含於）', '值在指定清單中', 'dept_code in [D001, D002, D003]'],
              ['starts_with（前綴）', '以指定字串開頭', 'dept_code starts_with R'],
              ['contains（包含）', '字串包含', 'dept_code contains &Dev'],
            ]}
          />
        </SubSection>

        <SubSection title="類別管理">
          <Para>
            類別（Category）讓管理員將功能相近的原則分組，例如「製造類」「財務類」，
            方便大量原則時的管理。可在右側「類別管理」面板新增/編輯類別，並拖曳或勾選原則歸入類別。
          </Para>
        </SubSection>

        <SubSection title="指派優先順序">
          <Table
            headers={['層次', '優先級', '說明']}
            rows={[
              ['使用者個人指派', '最高', '直接指派給該使用者的原則，優先套用'],
              ['角色指派', '次之', '使用者所屬角色的預設原則，使用者未個人指派時套用'],
              ['無指派', '最低', '未設定任何原則，查詢不受資料限制（需注意資訊安全）'],
            ]}
          />
          <TipBox>建議為每個角色都設定預設原則，確保新加入的使用者自動繼承適當的資料限制，而非無限制存取所有 ERP 資料。</TipBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ AI 戰情 — 外部資料來源 */}

      <Section id="a-db-sources" icon={<Database size={22} />} iconColor="text-cyan-600" title="AI 戰情 — 外部資料來源">
        <Para>
          外部資料來源（DB Sources）是 AI 戰情室連接 Oracle / MySQL / MSSQL 資料庫的連線設定，
          由系統管理員在後台「AI 戰情室 — 外部資料來源」頁籤管理。設計者在建立 Schema 時需指定使用哪個資料來源。
        </Para>
        <Para>詳細設定說明請參考使用者說明的「<strong>Schema 與多資料庫來源</strong>」章節（Step 1：設定外部資料來源），
          包含 Oracle / MySQL / MSSQL 各欄位說明、連線池設定及 Ping 測試操作。
        </Para>
        <TipBox>
          建議為每個 DB Source 使用<strong>唯讀帳號</strong>（SELECT only），避免 AI 生成的 SQL 意外修改 ERP 資料。
          Ping 測試確認連線成功後才啟用，未啟用的 DB Source 不會出現在 Schema 選單中。
        </TipBox>
      </Section>

      {/* ═══════════════════════════════════════════════════ 向量預設模型設定 */}

      <Section id="a-vector-defaults" icon={<Cpu size={22} />} iconColor="text-teal-600" title="向量預設模型設定">
        <Para>
          向量預設模型設定決定整個系統在進行知識庫向量化、重排序、OCR 時使用哪個 LLM 模型，
          位於後台管理的「向量預設模型」頁籤。
        </Para>

        <SubSection title="設定項目">
          <Table
            headers={['設定', '說明', '模型角色要求']}
            rows={[
              ['Embedding 模型', '知識庫文件向量化（embedding）使用的模型；決定向量維度，變更後需重建知識庫', 'model_role = embedding'],
              ['Rerank 模型', '混合檢索重排序使用的模型；提升召回精準度', 'model_role = rerank'],
              ['OCR 模型', '知識庫文件含圖片或 PDF 時進行 OCR 的模型（使用 chat 模型的多模態能力）', 'model_role = chat（且支援圖片輸入）'],
            ]}
          />
          <NoteBox>
            選單只會顯示<strong>已啟用</strong>且對應模型角色（model_role）正確的模型。
            選擇空值時，自動使用 .env 的環境變數預設值（KB_EMBEDDING_MODEL / KB_RERANK_MODEL / KB_OCR_MODEL）。
          </NoteBox>
        </SubSection>

        <SubSection title="注意事項">
          <Para>
            <strong>Embedding 模型</strong>的維度（dimension）與知識庫向量資料庫強綁定：
          </Para>
          <div className="space-y-2 pl-2">
            {[
              '如果更換 Embedding 模型，舊的向量資料與新模型的維度不符，需重建所有知識庫向量（會消耗大量 Token）',
              '建議在初期慎選 Embedding 模型，一旦知識庫資料量大後再更換成本極高',
              'OCR 模型選擇影響圖片/PDF 的解析品質，建議使用 Gemini Flash 或同級別的快速多模態模型',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0 mt-1.5" />
                {item}
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ 深度研究紀錄 */}

      <Section id="a-research-logs" icon={<GitFork size={22} />} iconColor="text-blue-600" title="深度研究紀錄">
        <Para>
          深度研究紀錄位於後台管理的「深度研究紀錄」頁籤，管理員可查看所有使用者發起的 Deep Research 任務，
          包含進行中、已完成、失敗的任務，並可下載結果報告。
        </Para>

        <SubSection title="查詢與篩選">
          <Table
            headers={['篩選條件', '說明']}
            rows={[
              ['關鍵字搜尋', '依研究主題標題或問題內容搜尋'],
              ['狀態篩選', 'pending（排隊中）/ running（進行中）/ done（已完成）/ failed（失敗）'],
              ['分頁', '每頁顯示 20 筆，支援翻頁'],
            ]}
          />
        </SubSection>

        <SubSection title="記錄內容">
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['使用者', '發起研究的使用者工號與姓名'],
              ['研究主題', '研究標題（AI 自動產生或使用者輸入）'],
              ['狀態', '彩色徽章標示：灰=排隊中、藍=進行中、綠=已完成、紅=失敗'],
              ['建立時間', '任務發起時間'],
              ['完成時間', '研究完成時間（failed 狀態顯示失敗時間）'],
              ['展開詳情', '點擊記錄可展開：完整問題、輸出格式、是否啟用網路搜尋、錯誤訊息、結果下載連結'],
            ]}
          />
          <TipBox>
            研究結果可下載為多種格式（Markdown / PDF 等），下載連結顯示在展開詳情的底部。
            failed 狀態的任務會顯示具體錯誤訊息，可幫助排查問題。
          </TipBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ 外部 API 金鑰管理 */}

      <Section id="a-api-keys" icon={<Key size={22} />} iconColor="text-amber-600" title="外部 API 金鑰管理">
        <Para>
          外部 API 金鑰管理讓第三方系統可透過 REST API 安全存取 Cortex 的知識庫查詢服務，
          位於後台管理的「外部 API 金鑰」頁籤（僅系統管理員可見）。
        </Para>

        <SubSection title="建立 API 金鑰">
          <div className="space-y-3">
            <StepItem num={1} title="點擊「新增 API 金鑰」" />
            <StepItem num={2} title="填寫名稱（必填）與說明（選填）" desc="建議使用有意義的名稱，如「ERP 整合系統」「測試環境」" />
            <StepItem num={3} title="選擇可存取的知識庫" desc="留空 = 可存取所有啟用的知識庫；勾選特定知識庫 = 限制存取範圍" />
            <StepItem num={4} title="設定到期日期（選填）" desc="到期後金鑰自動停用，建議為對外提供的金鑰設定到期日" />
            <StepItem num={5} title="點「建立」" desc="系統一次性顯示完整金鑰（格式 fk_sk_xxxx），請立即複製並安全保管，關閉後無法再查看" />
          </div>
          <NoteBox>金鑰建立後系統只儲存雜湊值，不保留明文。若遺失金鑰，只能刪除後重新建立。</NoteBox>
        </SubSection>

        <SubSection title="API 金鑰管理欄位">
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['名稱', '金鑰識別標籤'],
              ['前綴', '金鑰的可見前幾位（如 fk_sk_Ab...），用於識別但不洩漏完整金鑰'],
              ['可存取知識庫', '顯示已授權的知識庫清單，或「全部」'],
              ['狀態', '啟用 / 停用 / 已到期（超過到期日）'],
              ['到期日期', '留空 = 永不過期'],
              ['最後使用時間', '記錄上次使用此金鑰呼叫 API 的時間，可監控使用情況'],
              ['建立者', '建立此金鑰的管理員帳號'],
            ]}
          />
        </SubSection>

        <SubSection title="外部 API 使用方式">
          <Para>第三方系統取得金鑰後，可呼叫以下 API 端點：</Para>
          <CodeBlock>{`# 請求標頭
Authorization: Bearer fk_sk_your_api_key_here

# 列出可用知識庫
GET /api/v1/kb/list

# 語意搜尋知識庫
POST /api/v1/kb/search
{
  "kb_id": 1,         // 知識庫 ID
  "query": "產品規格",  // 搜尋問題
  "top_k": 5          // 回傳筆數
}

# 知識庫問答（AI 整合回答）
POST /api/v1/kb/chat
{
  "kb_id": 1,
  "question": "FL-X100 的最大電流是多少？",
  "model": "flash"    // 使用的 LLM 模型 key
}`}</CodeBlock>
          <TipBox>API 金鑰存取受知識庫權限限制，若呼叫未授權的知識庫 ID 會回傳 403 錯誤。金鑰啟用/停用可即時生效，無需重啟服務。</TipBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════════════════════════ 費用分析 */}

      <Section id="a-cost-analysis" icon={<DollarSign size={22} />} iconColor="text-green-600" title="費用分析">
        <Para>
          費用分析頁籤提供以<strong>利潤中心 → 部門 → 員工</strong>三層鑽取的 AI 費用歸因分析，
          讓管理層快速掌握哪個部門、哪位員工消耗最多 AI 費用，並支援多維度圖表與 CSV 匯出。
        </Para>
        <Para>詳細說明請參考「<strong>Token 與費用統計</strong>」章節的「費用分析（成本歸因）」小節。此頁籤是費用分析的完整獨立視圖，同樣支援：</Para>
        <Table
          headers={['功能', '說明']}
          rows={[
            ['日期篩選', '選擇查詢日期區間，預設為當月 1 日至今日'],
            ['利潤中心圓餅圖', '各利潤中心費用佔比；點擊扇形可鑽取到部門層級'],
            ['部門費用長條圖', '依費用由高到低排列各部門，點擊可進一步查看員工清單'],
            ['月份費用趨勢圖', '時間序列分析，觀察費用在各月份的變化趨勢'],
            ['利潤中心彙總表', '表格形式含部門、事業處、事業群層級；支援 CSV 匯出'],
            ['月份費用分析表', '同一利潤中心下按月份拆分的費用明細；支援 CSV 匯出'],
            ['員工 Token 明細', '最細粒度，含每位員工的 Input/Output Token 數及費用；支援 CSV 匯出'],
          ]}
        />
        <NoteBox>費用計算依賴費率設定（Token Pricing），若費率未設定則費用欄位顯示為 0。可在「Token 與費用統計」頁籤的費率設定區域新增費率，並執行「重新計算費用」補算歷史數據。</NoteBox>
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
          設定入口：監控頁面右上角齒輪圖示 → 監控設定。
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
              ['告警列表', '所有未解除告警，支援解除、忽略 N 天（Snooze）、AI 診斷'],
            ]}
          />
        </SubSection>

        <SubSection title="監控設定 — 資料保留天數">
          <Para>控制各類監控資料在資料庫的保留時間，到期後由排程自動清除。</Para>
          <Table
            headers={['設定項目', '參數鍵', '預設值', '說明']}
            rows={[
              ['節點/主機指標', 'monitor_metrics_retention_days', '7 天', 'K8s Node 與主機 CPU/Memory/Load 歷史趨勢資料'],
              ['磁碟指標', 'monitor_disk_retention_days', '30 天', '磁碟使用率歷史記錄'],
              ['線上人數', 'monitor_online_retention_days', '30 天', '每分鐘在線快照（用於趨勢圖）'],
              ['健康檢查', 'monitor_health_check_retention', '7 天', 'Service HTTP uptime 檢查記錄'],
              ['告警紀錄', 'monitor_log_retention_days', '30 天', 'monitor_alerts 表的已解除告警保留天數'],
              ['部門統計', 'monitor_dept_retention_days', '30 天', '部門在線人數快照保留天數'],
            ]}
          />
        </SubSection>

        <SubSection title="監控設定 — 告警閾值">
          <Table
            headers={['設定項目', '參數鍵', '預設值', '觸發說明']}
            rows={[
              ['啟用告警', 'monitor_alert_enabled', 'true', '關閉後所有閾值告警停止，但 emergency 等級仍會觸發'],
              ['CPU Request % 閾值', 'monitor_cpu_threshold', '90', 'K8s Node 的 CPU 請求百分比 > 此值 → critical 告警'],
              ['Memory % 閾值', 'monitor_mem_threshold', '85', 'K8s Node 的 Memory 請求百分比 > 此值 → critical 告警；主機實際記憶體使用 > 此值 → warning'],
              ['磁碟 % 閾值', 'monitor_disk_threshold', '85', '任一掛載點使用率 > 此值 → critical 告警'],
              ['CPU Load/cores 比值', 'monitor_load_threshold', '0.9', '主機 Load 1m ÷ CPU 核心數 > 此值 → warning 告警'],
              ['Pod restart 上限', 'monitor_pod_restart_limit', '5', 'Pod 任一 container 重啟次數 > 此值 → critical 告警'],
              ['Pod pending 上限 (分鐘)', 'monitor_pod_pending_minutes', '10', 'Pod 持續 Pending 超過此時間 → warning 告警'],
              ['通知冷卻 (分鐘)', 'monitor_alert_cooldown', '30', '同一告警類型在冷卻期內不重複發送通知，避免告警風暴'],
            ]}
          />
        </SubSection>

        <SubSection title="監控設定 — AI 故障診斷 & 部門統計">
          <Table
            headers={['設定項目', '參數鍵', '預設值', '說明']}
            rows={[
              ['診斷模型', 'monitor_ai_model', 'flash', '告警詳情頁「AI 診斷」使用的模型：flash（快速）或 pro（深入分析）'],
              ['部門統計快照間隔', 'monitor_dept_snapshot_interval', '5 分鐘', '每隔幾分鐘記錄一次各部門在線人數快照'],
              ['部門統計保留天數', 'monitor_dept_retention_days', '30 天', '部門在線快照保留天數'],
            ]}
          />
        </SubSection>

        <SubSection title="告警類型與通知邏輯">
          <Para>系統依以下 10 種告警類型自動偵測並通知。通知邏輯依嚴重度分層：</Para>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
              <div className="font-semibold text-yellow-700 mb-1">⚠️ Warning</div>
              <div className="text-yellow-600 text-xs leading-5">頁面 Banner 顯示<br/>不發 Email / Webhook</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
              <div className="font-semibold text-red-700 mb-1">🔴 Critical</div>
              <div className="text-red-600 text-xs leading-5">頁面 Banner<br/>Email → 所有管理員<br/>Webhook（需啟用設定）</div>
            </div>
            <div className="bg-red-100 border border-red-300 rounded-lg p-3 text-sm">
              <div className="font-semibold text-red-800 mb-1">🚨 Emergency</div>
              <div className="text-red-700 text-xs leading-5">頁面 Banner<br/>Email → 所有管理員<br/>Webhook（<strong>強制發送</strong>，無視啟用設定）</div>
            </div>
          </div>
          <Table
            headers={['告警類型', '嚴重度', '觸發條件']}
            rows={[
              ['node_not_ready', 'Emergency', 'K8s Node 狀態非 Ready'],
              ['nas_down', 'Emergency', 'NFS 掛載點消失（mount 不存在）'],
              ['resource_high', 'Critical', 'Node CPU 請求 % 或 Memory 請求 % 超過閾值'],
              ['pod_crash', 'Critical', 'Pod container 重啟次數超過設定上限'],
              ['disk_high', 'Critical', '磁碟掛載點使用率超過閾值'],
              ['container_exit', 'Critical', 'Docker container 異常退出（exit code ≠ 0）'],
              ['service_down', 'Critical', 'Health Check 端點回應失敗'],
              ['pod_pending', 'Warning', 'Pod 持續 Pending 超過設定分鐘'],
              ['host_load_high', 'Warning', '主機 CPU Load/cores 超過閾值'],
              ['host_mem_high', 'Warning', '主機記憶體使用率超過 Memory 閾值'],
            ]}
          />
          <NoteBox>冷卻機制（monitor_alert_cooldown）對所有等級均有效：同一 alert_type + resource_name 在冷卻期內不重複觸發通知，但告警會繼續記錄到 monitor_alerts 表。</NoteBox>
        </SubSection>

        <SubSection title="Webhook 通知設定">
          <Para>
            在監控設定中開啟「啟用 Webhook」後，critical / emergency 告警除了 Email 外也會推送到指定平台。
            支援三種類型，設定方式如下：
          </Para>

          <div className="space-y-4 mt-2">
            <div className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-slate-700">Microsoft Teams</span>
                <Tag color="blue">推薦</Tag>
              </div>
              <div className="text-sm text-slate-600 space-y-1 leading-6">
                <p>① Teams 頻道 → 右鍵「管理頻道」→「連接器」→「Incoming Webhook」→「設定」</p>
                <p>② 輸入名稱（如 Cortex Monitor），上傳 logo，點「建立」</p>
                <p>③ 複製產生的 Webhook URL（格式：<code className="bg-slate-100 px-1 rounded text-xs">https://xxx.webhook.office.com/webhookb2/...</code>）</p>
                <p>④ 監控設定 → 類型選「Microsoft Teams」→ 貼上 URL → 儲存</p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-slate-700">Webex</span>
              </div>
              <div className="text-sm text-slate-600 space-y-1 leading-6">
                <p>① 進入 <code className="bg-slate-100 px-1 rounded text-xs">developer.webex.com</code> → 登入 → 「My Webex Apps」→「Create a New App」→「Incoming Webhook」</p>
                <p>② 填入名稱、選擇目標 Space（群組），點「Add Webhook」</p>
                <p>③ 複製產生的 Webhook URL（格式：<code className="bg-slate-100 px-1 rounded text-xs">https://webexapis.com/v1/webhooks/incomingConnection/...</code>）</p>
                <p>④ 監控設定 → 類型選「Webex」→ 貼上 URL → 儲存</p>
                <p className="text-xs text-slate-400">訊息格式：Markdown（⚠️/🔴/🚨 emoji + 告警詳情）</p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-slate-700">LINE Notify</span>
              </div>
              <div className="text-sm text-slate-600 space-y-1 leading-6">
                <p>① 前往 <code className="bg-slate-100 px-1 rounded text-xs">notify-bot.line.me/zh_TW</code> → 登入 LINE 帳號</p>
                <p>② 「個人頁面」→「發行權杖」→ 填入名稱、選擇接收群組</p>
                <p>③ 複製產生的 Token（格式：隨機英數字串）</p>
                <p>④ 監控設定 → 類型選「LINE Notify」→ 將 Token 貼入「URL」欄位 → 儲存</p>
                <p className="text-xs text-slate-400">注意：LINE Notify 欄位輸入的是 Token，不是 URL；系統會自動以 Bearer Token 呼叫 LINE API</p>
              </div>
            </div>
          </div>
          <TipBox>設定後可點「測試發送」立即驗證是否收到通知，不需等待真實告警觸發。</TipBox>
        </SubSection>

        <SubSection title="Deploy 面板">
          <Para>
            監控頁面內建一鍵部署功能（位於頁面右上角），支援在管理介面直接觸發 K8s Rolling Update，
            部署過程以 SSE 即時串流顯示輸出，並記錄部署歷史。
          </Para>
          <NoteBox>Deploy 功能需要 server 所在環境具備 kubectl 和 deploy.sh 的執行權限（K8s flgptm01 節點）。</NoteBox>
        </SubSection>

        <SubSection title="Log 檢視器">
          <Para>點擊 Pod 或 Container 的「Log」按鈕開啟即時 Log 串流視窗，支援：</Para>
          <ul className="list-disc pl-6 text-sm text-slate-600 space-y-1">
            <li>SSE 即時串流顯示</li>
            <li>關鍵字搜尋高亮</li>
            <li>Log 等級顏色區分（ERROR 紅色、WARN 橘色等）</li>
            <li>一鍵下載 Log 檔案</li>
          </ul>
        </SubSection>

        <SubSection title="告警操作">
          <Table
            headers={['操作', '說明']}
            rows={[
              ['解除（Resolve）', '標記告警已處理，移出未解除列表，保留歷史紀錄'],
              ['全部解除（Resolve All）', '一次性解除所有未解除告警'],
              ['Snooze N 天', '告警暫時忽略 N 天（snoozed_until），期間不重複通知'],
              ['AI 診斷', '針對 pod_crash / pod_pending 告警，AI 自動讀取 Pod describe 和最近 50 行 Log 進行故障分析'],
            ]}
          />
        </SubSection>
      </Section>

      <Section id="a-k8s" icon={<Server size={22} />} iconColor="text-violet-500" title="K8s 部署更新">
        <Para>
          Cortex 以 Kubernetes 部署，基本 4 replica（HPA 可自動擴至 8），採用 flgptm01:5000 內部 HTTP Registry。
          設定完成後每次更版執行 <code className="bg-slate-100 px-1 rounded text-xs">./deploy.sh</code> 即可，約 1 分鐘零停機完成。
        </Para>

        <SubSection title="K8s 節點架構">
          <Table
            headers={['節點', 'IP', '角色']}
            rows={[
              ['flgptm01', '10.8.93.11', 'Control Plane — kubectl / docker build / Local Registry:5000'],
              ['flgptn01', '10.8.93.12', 'Worker'],
              ['flgptn02', '10.8.93.13', 'Worker + Ingress（flgpt.foxlink.com.tw:8443）'],
              ['flgptn03', '10.8.93.14', 'Worker'],
            ]}
          />
          <NoteBox>Worker node 只有 containerd，沒有 docker CLI。Registry 為 HTTP（非 HTTPS），需各節點個別設定 insecure registry。</NoteBox>
        </SubSection>

        <SubSection title="K8s 資源清單">
          <Table
            headers={['資源', '名稱 / 規格', '用途']}
            rows={[
              ['Namespace', 'foxlink', '所有資源的命名空間'],
              ['ServiceAccount + ClusterRole', 'foxlink-gpt-monitor', 'Pod 讀取 K8s API（監控用）— get/list/watch nodes/pods/events/logs'],
              ['Deployment', 'foxlink-gpt × 4 replica', '主應用程式'],
              ['Service (ClusterIP)', 'foxlink-gpt:3007', '叢集內部路由'],
              ['Deployment', 'redis × 1 replica', 'Session Token 共享 Store（multi-replica 必要）'],
              ['Service (ClusterIP)', 'redis:6379', 'Redis 內部路由'],
              ['Ingress (nginx)', 'foxlink-gpt', 'flgpt.foxlink.com.tw:8443 → Service:3007'],
              ['HorizontalPodAutoscaler', 'foxlink-gpt-hpa', 'CPU≥70% 或 Memory≥80% 時自動擴至最多 8 pod'],
              ['PVC (NFS)', 'pvc-flgpt-upload (500Gi)', '使用者上傳、生成檔案、KB 索引（ReadWriteMany）'],
              ['PVC (NFS)', 'pvc-flgpt-source (共用)', 'skill_runners / fonts / oracle_client（NFS subPath 分隔）'],
            ]}
          />
        </SubSection>

        <SubSection title="Container 規格">
          <Table
            headers={['項目', '設定值', '說明']}
            rows={[
              ['Image', '10.8.93.11:5000/foxlink-gpt:latest', 'imagePullPolicy: Always'],
              ['Port', '3007', ''],
              ['Memory Request / Limit', '768 Mi / 2 Gi', ''],
              ['CPU Request / Limit', '500 m / 2000 m', ''],
              ['NODE_OPTIONS', '--max-old-space-size=1536', 'Node.js heap 上限 1.5 GB'],
              ['TZ', 'Asia/Taipei', '確保排程時間、Log 時間正確'],
              ['ORACLE_HOME / LD_LIBRARY_PATH', '/opt/oracle/instantclient', '從 pvc-flgpt-source subPath: oracle_client 掛載'],
              ['InitContainer', 'wait-for-redis', 'Pod 啟動前先等 Redis 就緒（redis-cli ping）'],
              ['Liveness Probe', 'GET /api/health，delay 30s，period 10s', '失敗 3 次重啟 pod'],
              ['Readiness Probe', 'GET /api/health，delay 10s，period 5s', '失敗 2 次從 Service 移除'],
              ['Graceful Shutdown', 'preStop sleep 15s + terminationGracePeriod 60s', '確保進行中的 SSE streaming 有時間完成'],
            ]}
          />
        </SubSection>

        <SubSection title="NFS PVC subPath 目錄結構">
          <Para>兩個 PVC 透過 <code className="bg-slate-100 px-1 rounded text-xs">subPath</code> 在 pod 內掛載到不同路徑：</Para>
          <CodeBlock>{`pvc-flgpt-upload（NAS /volume1/foxlink-gpt/uploads）
  └── 掛載到 /app/uploads（用戶上傳、generated/、kb/ 索引）

pvc-flgpt-source（NAS /volume1/foxlink-gpt/source）
  ├── subPath: skill_runners  → /app/skill_runners（Code Runner 腳本）
  ├── subPath: fonts          → /app/fonts（CJK PDF 字型 NotoSansTC）
  └── subPath: oracle_client  → /opt/oracle/instantclient（Oracle 23 Instant Client）`}</CodeBlock>
          <NoteBox>nfs-pvc.yaml 中 NAS IP 與路徑為 TODO 佔位符，部署前需填入實際 Synology NAS IP（192.168.x.x）和共用資料夾路徑。</NoteBox>
        </SubSection>

        <SubSection title="Redis 部署">
          <Para>
            <code className="bg-slate-100 px-1 rounded text-xs">k8s/redis.yaml</code> 部署 redis:7-alpine，
            以 <code className="bg-slate-100 px-1 rounded text-xs">--save ""</code> 關閉持久化（純記憶體），
            Memory 限制 512 Mi。redis 重啟後所有 Session Token 失效，用戶需重新登入（正常維護行為）。
          </Para>
          <TipBox>若需要 Redis 持久化（重啟不登出），可在 args 改為 <code className="bg-blue-50 px-1 rounded text-xs">["--save", "60", "1"]</code> 並掛載 PVC。目前維持無狀態設計以簡化運維。</TipBox>
        </SubSection>

        <SubSection title="HPA 自動擴縮">
          <Table
            headers={['參數', '值', '說明']}
            rows={[
              ['minReplicas', '4', '最少保持 4 個 pod'],
              ['maxReplicas', '8', '最多擴至 8 個 pod'],
              ['CPU 觸發', 'averageUtilization ≥ 70%', '超過時自動新增 pod'],
              ['Memory 觸發', 'averageUtilization ≥ 80%', '超過時自動新增 pod'],
              ['縮容穩定視窗', '300 秒', '避免快速縮放震盪'],
              ['縮容速率', '每 60 秒最多減少 1 pod', ''],
            ]}
          />
          <Para>需安裝 Metrics Server 才能讓 HPA 運作：<code className="bg-slate-100 px-1 rounded text-xs">kubectl apply -f k8s/hpa.yaml</code></Para>
        </SubSection>

        <SubSection title="Ingress 重要設定">
          <Table
            headers={['Annotation', '值', '用途']}
            rows={[
              ['proxy-buffering', 'off', 'SSE streaming（AI 逐字輸出）必要，關閉 nginx buffer'],
              ['proxy-read-timeout / proxy-send-timeout', '3600s', '深度研究、長篇生成不逾時'],
              ['proxy-http-version', '1.1', 'SSE keepalive 需要 HTTP/1.1'],
              ['proxy-body-size', '160m', '音訊（50 MB）/ PDF 大檔上傳上限'],
              ['upstream-keepalive-connections', '100', '長連線複用，減少 TCP 握手開銷'],
              ['limit-connections', '50', '每個 IP 最多 50 個同時連線（防濫用）'],
            ]}
          />
          <NoteBox>ingress.yaml 中 host 為 `foxlink-gpt.example.com`（TODO），部署前需改為實際域名，並視需求啟用 TLS 區段。</NoteBox>
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
            <StepItem num={5} title="填寫 TODO 項目" desc="部署前必須修改以下佔位符" />
          </div>
          <Table
            headers={['檔案', 'TODO 項目']}
            rows={[
              ['k8s/nfs-pvc.yaml', 'NAS IP（192.168.x.x）、NFS 共用資料夾路徑'],
              ['k8s/ingress.yaml', '實際域名（foxlink-gpt.example.com → 實際）、TLS 憑證'],
              ['k8s/uptime-kuma.yaml', '監控用域名'],
              ['k8s/loki-stack.yaml', 'Log 查詢域名、Grafana admin 密碼'],
            ]}
          />

          <div className="space-y-3 my-3">
            <StepItem num={6} title="按順序套用 K8s manifest" desc="依賴關係：PVC → Redis → Deployment → Ingress → HPA" />
          </div>
          <CodeBlock>{`cd ~/foxlink_gpt

# Step 6-1: 儲存層（NFS PVC）
kubectl apply -f k8s/nfs-pvc.yaml

# Step 6-2: Redis（Session store，Deployment 的 InitContainer 需要它就緒）
kubectl apply -f k8s/redis.yaml

# Step 6-3: 主應用（含 RBAC + Deployment + Service）
kubectl create namespace foxlink --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic foxlink-secrets --from-env-file=server/.env -n foxlink
kubectl apply -f k8s/deployment.yaml

# Step 6-4: 對外流量
kubectl apply -f k8s/ingress.yaml

# Step 6-5: 自動擴縮（需先安裝 Metrics Server）
kubectl apply -f k8s/hpa.yaml

# Step 6-6: 監控（選配）
kubectl apply -f k8s/uptime-kuma.yaml
kubectl apply -f k8s/loki-stack.yaml`}</CodeBlock>
          <TipBox>設定完成後，之後每次更版只需執行 deploy.sh（見下方）。</TipBox>
        </SubSection>

        <SubSection title="日常程式更版（deploy.sh）">
          <CodeBlock>{`ssh fldba@10.8.93.11
cd ~/foxlink_gpt && git pull

# 更版到 latest
./deploy.sh

# 或發行指定版本 tag
./deploy.sh v1.2.3`}</CodeBlock>
          <Para>deploy.sh 自動依序執行：</Para>
          <div className="pl-2 space-y-1 text-sm text-slate-600 mt-2">
            <p>① docker build → push 到 registry（若指定 tag 同時也 tag 為 latest）</p>
            <p>② <strong>kubectl delete + create secret foxlink-secrets</strong>（從 server/.env 同步最新設定）</p>
            <p>③ kubectl apply -f k8s/deployment.yaml（套用 manifest 變更）</p>
            <p>④ kubectl rollout restart → rollout status（等待 Rolling Update 完成）</p>
          </div>
          <NoteBox>每次更版都會重新同步 Secret，因此只需修改 server/.env 再執行 deploy.sh 即可更新環境變數，不需要手動 kubectl。</NoteBox>
          <TipBox>Rolling Update 策略：maxUnavailable=0，更新期間永遠保持 4 個 pod 可用。看到 "successfully rolled out" 即完成。</TipBox>
        </SubSection>

        <SubSection title="常用 kubectl 指令">
          <Table
            headers={['指令', '用途']}
            rows={[
              ['kubectl get pods -n foxlink -o wide', '查看所有 pod 狀態與所在 node'],
              ['kubectl logs -n foxlink <pod-name> --tail=50 -f', '即時追蹤 pod 日誌'],
              ['kubectl logs -n foxlink -l app=foxlink-gpt --tail=30', '所有 pod 合併日誌（省略 pod name）'],
              ['kubectl describe pod <pod-name> -n foxlink | tail -20', '查看 pod 異常事件（ErrImagePull / OOMKilled 等）'],
              ['kubectl get hpa -n foxlink', '查看 HPA 當前擴縮狀態'],
              ['kubectl get pvc -n foxlink', '確認 PVC 是否 Bound'],
              ['kubectl get nodes -o wide', '查看所有 node IP 與狀態'],
              ['kubectl rollout history deployment/foxlink-gpt -n foxlink', '查看歷次 rollout 記錄'],
              ['kubectl rollout undo deployment/foxlink-gpt -n foxlink', '回滾到上一個版本'],
              ['curl http://10.8.93.11:5000/v2/foxlink-gpt/tags/list', '查看 registry 中的 image tags'],
              ['kubectl exec -n foxlink <pod> -- /bin/sh', '進入 pod shell 除錯'],
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
              ['OOMKilled', 'Pod 超出 memory limit 2Gi', '排查大型 AI 回應 / KB 索引，或暫時提高 limits'],
              ['pod has unbound PVC', 'NFS PVC 未 Bound', '確認 NAS IP 和路徑正確，NFS server 可達'],
            ]}
          />
        </SubSection>

        <SubSection title="K8s 環境特殊注意事項">
          <Para>以下項目與本機開發環境不同，部署後需確認：</Para>
          <Table
            headers={['項目', '本機開發', 'K8s 環境']}
            rows={[
              ['Oracle Client', 'ORACLE_HOME 本機路徑', '從 pvc-flgpt-source subPath: oracle_client 掛載到 /opt/oracle/instantclient'],
              ['字型（CJK PDF）', 'server/fonts/ 本機目錄', '從 pvc-flgpt-source subPath: fonts 掛載到 /app/fonts'],
              ['Skill Runners', '本機 server/skill_runners/', '從 pvc-flgpt-source subPath: skill_runners 掛載到 /app/skill_runners；pod 重啟後保留'],
              ['Session Store', 'In-memory Map（單程序）', 'Redis Service redis:6379（多 replica 共享）'],
              ['環境變數', 'server/.env 直接讀取', 'K8s Secret foxlink-secrets（由 deploy.sh 自動同步）'],
              ['上傳檔案', './uploads 本機目錄', 'PVC pvc-flgpt-upload 掛載到 /app/uploads（NFS 持久化）'],
            ]}
          />
          <NoteBox>
            Skill Runner 若仍失效，手動復原：後台 → 技能管理 → 找到 Code Runner 技能 → 點「儲存代碼」（重新寫入 NFS PVC）。
          </NoteBox>
        </SubSection>
      </Section>

      <Section id="a-env-config" icon={<Settings size={22} />} iconColor="text-slate-600" title="ENV 環境變數設定">
        <Para>
          所有系統行為均由 <code className="bg-slate-100 px-1 rounded text-xs">server/.env</code> 控制。
          本節按功能群組說明每個參數的用途，並標明「本機開發」與「K8s/Docker 正式環境」的典型值差異。
          K8s 部署時參數通常透過 <code className="bg-slate-100 px-1 rounded text-xs">kubectl create secret</code> 或
          ConfigMap 注入，不直接存在容器內的 .env 檔。
        </Para>
        <NoteBox>
          敏感參數（密碼、API Key、JWT Secret）在 K8s 必須使用 Secret 而非 ConfigMap，避免明文存儲在 YAML。
          本機開發可直接寫入 <code className="bg-slate-100 px-1 rounded text-xs">.env</code>，但請勿將該檔案 commit 進 git。
        </NoteBox>

        <SubSection title="基本伺服器">
          <Table
            headers={['參數', '用途', '本機開發', 'K8s/Docker']}
            rows={[
              ['PORT', 'Express 監聽埠', '3007', '3007（container 內部，Ingress 對外 8443）'],
              ['NODE_ENV', '環境識別，影響錯誤輸出詳細度', 'development', 'production'],
              ['APP_BASE_URL', '系統對外 URL，用於 SSO callback、Email 連結等', 'http://localhost:3007', 'https://flgpt.foxlink.com.tw:8443'],
              ['FOXLINK_API_URL', '伺服器自我呼叫 API 的 base URL（skill runner、MCP 測試等）', 'http://localhost:3007', 'http://foxlink-gpt-svc:3007（cluster 內部 Service）'],
            ]}
          />
        </SubSection>

        <SubSection title="認證與安全">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['JWT_SECRET', 'Token 簽名秘鑰（備用，目前 session 改用 Redis UUID）', '任意隨機字串，長度建議 ≥ 32 字元；K8s 以 Secret 注入'],
              ['DEFAULT_ADMIN_ACCOUNT', '初始管理員帳號', '預設 ADMIN，系統初始化時自動建立（若帳號不存在）'],
              ['DEFAULT_ADMIN_PASSWORD', '初始管理員密碼', '首次登入後務必修改；K8s 以 Secret 注入'],
              ['LLM_KEY_SECRET', 'AES-256 金鑰（64 hex 字元），用於加密資料庫中儲存的 LLM API Key', '若留空，系統自動以 JWT_SECRET 的 SHA-256 作為替代金鑰；建議正式環境明確設定'],
            ]}
          />
          <NoteBox>LLM_KEY_SECRET 對應 LLM 模型管理中各 Provider 的 API Key 加密儲存。若更換此金鑰，已儲存的 API Key 將無法解密，需重新輸入。</NoteBox>
        </SubSection>

        <SubSection title="AI 模型（Gemini）">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['GEMINI_API_KEY', 'Google Gemini API 金鑰', '必填；K8s 以 Secret 注入。用於預設 Gemini 對話模型及 Embedding/OCR 功能'],
              ['GEMINI_MODEL_PRO', '初始 Pro 模型 ID（首次啟動寫入 DB）', 'gemini-3-pro-preview；啟動後可在後台「LLM 模型管理」修改，ENV 僅作為初始值'],
              ['GEMINI_MODEL_FLASH', '初始 Flash 模型 ID（首次啟動寫入 DB）', 'gemini-3-flash-preview；同上，啟動後可覆寫'],
            ]}
          />
          <TipBox>GEMINI_MODEL_PRO / FLASH 只在資料庫對應記錄不存在時才有效。若已在後台修改過 LLM 模型設定，重啟不會覆蓋。</TipBox>
        </SubSection>

        <SubSection title="檔案儲存">
          <Table
            headers={['參數', '用途', '本機開發', 'K8s/Docker']}
            rows={[
              ['UPLOAD_DIR', '用戶上傳檔案、生成檔案、KB 索引的根目錄', './uploads（相對 server/）', '/app/uploads（掛載 PVC pvc-flgpt-upload）'],
            ]}
          />
          <NoteBox>K8s 必須掛載 PVC，否則 pod 重啟後所有上傳檔案消失。uploads/ 目錄下有 generated/、kb/、sessions/ 等子目錄由系統自動建立。</NoteBox>
        </SubSection>

        <SubSection title="Email 通知（SMTP）">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['ADMIN_NOTIFY_EMAIL', '敏感詞警示、系統異常通知的收件人 Email', '建議設為管理員信箱或群組信箱'],
              ['SMTP_SERVER', 'SMTP 主機位址', '例：dp-notes.foxlink.com.tw'],
              ['SMTP_PORT', 'SMTP 埠號', '一般 25（非加密）或 587（STARTTLS）或 465（SSL）'],
              ['SMTP_USERNAME', 'SMTP 登入帳號', '留空表示不需要認證（部分內部 SMTP 允許）'],
              ['SMTP_PASSWORD', 'SMTP 登入密碼', 'K8s 以 Secret 注入'],
              ['FROM_ADDRESS', '寄件人 Email 地址', '例：fl_support@foxlink.com.tw'],
            ]}
          />
        </SubSection>

        <SubSection title="Oracle 用戶端（本機開發）">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['ORACLE_HOME', 'Oracle Instant Client 安裝路徑', '本機 Windows：D:\\ORACLE_CLIENT_23\\instantclient_23_0；K8s container 已內建，通常不需設定（由 Dockerfile 預設）'],
              ['NLS_LANG', 'Oracle 字元集設定', '固定 AMERICAN_AMERICA.AL32UTF8，確保 ZHT16BIG5/ZHS16GBK ERP 資料自動轉 UTF-8 回傳，K8s 與本機相同'],
            ]}
          />
        </SubSection>

        <SubSection title="ERP 資料庫（AI 戰情 + 組織階層）">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <span className="text-sm font-semibold text-amber-700">ERP_DB 與多來源 DB 的互動關係（必讀）</span>
            </div>
            <div className="space-y-2 text-sm text-amber-800 leading-6">
              <p><strong>場景 1 — 首次啟動（ai_db_sources 表為空）：</strong>系統自動將 ERP_DB_* 參數寫入 <code className="bg-amber-100 px-1 rounded text-xs">ai_db_sources</code> 表作為預設來源（is_default=1），並回填既有 Schema 的 source_db_id。</p>
              <p><strong>場景 2 — Schema 已綁定 source_db_id：</strong>AI 戰情查詢使用 <code className="bg-amber-100 px-1 rounded text-xs">ai_db_sources</code> 表中的連線設定，ERP_DB_* 環境變數對此 Schema 的查詢<strong>無作用</strong>。修改連線請至後台「AI 戰情 — 外部資料來源」編輯。</p>
              <p><strong>場景 3 — 組織階層 / Multi-Org 驗證：</strong>ERP_DB_* <strong>永遠</strong>被使用（不受 ai_db_sources 影響），用於載入公司組織階層樹與多組織政策驗證。若 ERP_DB_HOST 未設定，這些功能將無法使用。</p>
            </div>
          </div>
          <Table
            headers={['參數', '用途', '本機開發', 'K8s/Docker']}
            rows={[
              ['ERP_DB_HOST', 'ERP Oracle 主機 IP 或 FQDN', '10.8.93.104', '同（或 K8s Secret 注入）'],
              ['ERP_DB_PORT', 'ERP Oracle Listener 埠', '1589', '1589'],
              ['ERP_DB_SERVICE_NAME', 'ERP Oracle Service Name（TNS）', 'ebs_CUFOX', '正式：ebs_T365'],
              ['ERP_DB_USER', 'ERP 查詢帳號', 'apps', 'apps'],
              ['ERP_DB_USER_PASSWORD', 'ERP 查詢帳號密碼', 'cl3g42ji（開發）', 'K8s Secret 注入，請勿明文存 YAML'],
            ]}
          />
        </SubSection>

        <SubSection title="系統資料庫（Cortex 主庫 Oracle 23 AI）">
          <Table
            headers={['參數', '用途', '本機開發', 'K8s/Docker']}
            rows={[
              ['SYSTEM_DB_HOST', 'Oracle 23 AI 主機 IP', '10.8.93.70（開發機）', '10.8.93.15（正式機）'],
              ['SYSTEM_DB_PORT', 'Oracle Listener 埠', '1526（開發）', '1524（正式）'],
              ['SYSTEM_DB_SERVICE_NAME', 'Oracle Service Name', 'AI（開發）', 'GPT（正式）'],
              ['SYSTEM_DB_USER', 'Schema 帳號', 'FLGPT', 'FLGPT'],
              ['SYSTEM_DB_USER_PASSWORD', 'Schema 密碼', 'Gptxu06vu04（開發）', 'K8s Secret 注入'],
            ]}
          />
          <NoteBox>系統主庫存放所有用戶、對話、Token 用量、稽核、KB、MCP 等資料。正式與開發環境使用不同 Oracle Instance，請勿混用。</NoteBox>
        </SubSection>

        <SubSection title="AI 戰情 ETL">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['DASHBOARD_ETL_MAX_ROWS', 'AI 戰情 SQL 查詢單次最大回傳筆數', '預設 1,000,000；可降低以保護記憶體，但過低會導致大型報表截斷資料'],
            ]}
          />
        </SubSection>

        <SubSection title="知識庫預設設定（KB_*）">
          <Para>以下參數設定知識庫的全域預設值；各 KB 可在後台「自建知識庫管理」編輯頁覆寫個別設定。</Para>
          <Table
            headers={['參數', '用途', '預設值', '說明']}
            rows={[
              ['KB_EMBEDDING_MODEL', 'Embedding 向量化模型 ID', 'gemini-embedding-001', '對應後台「向量預設模型設定」中 model_role=embedding 的模型'],
              ['KB_OCR_MODEL', 'OCR 圖文辨識模型 ID', 'gemini-3-flash-preview', '用於 PDF 掃描版 OCR，建議用 Flash（速度快）'],
              ['KB_PDF_OCR_CONCURRENCY', 'PDF per-page OCR 並發數', '20', 'auto / force 模式下每頁 OCR 的並發數'],
              ['KB_IMG_OCR_CONCURRENCY', 'DOCX/PPTX/XLSX 嵌入圖 OCR 並發數', '20', ''],
              ['KB_EMBED_CONCURRENCY', 'Chunk embedding 並發數', '20', '每個文件切塊後向量化的並發數'],
              ['KB_EMBEDDING_DIMS', 'Embedding 向量維度', '768', '需與 Embedding 模型輸出維度一致；改動後需重建所有 KB 索引'],
              ['KB_RERANK_MODEL', 'Rerank 重排序模型 ID', 'gemini-2.5-flash', '混合檢索的第二階段重排序，建議 Flash 系列'],
              ['KB_RERANK_TOP_K_FETCH', 'Rerank 前取回候選數', '10', '向量/全文檢索各取 10 筆後送 Rerank'],
              ['KB_RERANK_TOP_K_RETURN', 'Rerank 後最終回傳數', '3', '經重排序後保留最相關的 3 筆送給 LLM'],
              ['KB_RERANK_SCORE_THRESHOLD', 'Rerank 最低分數門檻', '0.5', '低於此分數的結果過濾掉，0 為關閉門檻'],
              ['KB_DEFAULT_CHUNK_STRATEGY', '預設切塊策略', 'regular', 'regular（固定大小）或 semantic（語義切塊）'],
              ['KB_DEFAULT_CHUNK_SIZE', '預設切塊大小（tokens）', '1024', ''],
              ['KB_DEFAULT_CHUNK_OVERLAP', '預設切塊重疊（tokens）', '50', ''],
              ['KB_DEFAULT_RETRIEVAL_MODE', '預設檢索模式', 'hybrid', 'hybrid（向量 + 全文）/ vector / fulltext'],
              ['KB_ALLOW_ADMIN_CREATE', '允許管理員建立 KB', 'true', ''],
              ['KB_ALLOW_USER_CREATE', '允許一般使用者建立 KB', 'false', '開放後使用者可在對話頁面建立個人 KB'],
            ]}
          />
        </SubSection>

        <SubSection title="外部 API 與 MCP">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['EXTERNAL_API_BASE_URL', '對外 API 的 base URL，用於 KB 公開存取文件中的 endpoint 說明', '本機：http://localhost:3007；K8s：https://flgpt.foxlink.com.tw:8443'],
              ['API_KEY_PREFIX', 'API 金鑰前綴（顯示用）', '預設 flgpt_；生成的金鑰格式為 flgpt_xxxxxxxx'],
              ['API_RATE_LIMIT_PER_MIN', '每分鐘 API 呼叫上限（per API key）', '60；超過回傳 429 Too Many Requests'],
              ['MCP_SERVER_ENABLED', '是否開放 /mcp 端點供外部 MCP Client 連線', 'true；設 false 可完全關閉 MCP 存取'],
              ['API_CHAT_SESSION_TTL_HOURS', 'API 方式建立的 Chat Session 存活時間（小時）', '24；超時 Session 自動清除'],
            ]}
          />
        </SubSection>

        <SubSection title="LDAP / AD 整合">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['LDAP_URL', 'LDAP 伺服器連線 URL', '例：ldap://10.8.91.152:389；若不使用 AD 登入可整組移除'],
              ['LDAP_BASE_DN', 'LDAP 搜尋基礎 DN', '例：DC=foxlink,DC=ldap'],
              ['LDAP_MANAGER_DN', 'LDAP Bind 帳號 DN（唯讀，用於搜尋使用者）', '例：CN=manager,DC=foxlink,DC=ldap'],
              ['LDAP_MANAGER_PASSWORD', 'LDAP Bind 帳號密碼', 'K8s 以 Secret 注入'],
            ]}
          />
          <TipBox>
            LDAP 參數全部移除或留空時，系統仍可正常運作，僅停用 AD 登入——用戶只能使用手動建立的本地帳號登入。
            ADMIN 帳號永遠使用本地驗證，不受 LDAP 影響。
          </TipBox>
        </SubSection>

        <SubSection title="SSO / OIDC 整合">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['SSO_ISSUER', 'OIDC Provider 的 Issuer URL', '例：https://sso.foxlink.com.tw；系統自動從 /.well-known/openid-configuration 取得端點'],
              ['SSO_CLIENT_ID', 'OIDC Client ID', '在 SSO 後台建立 Application 後取得'],
              ['SSO_CLIENT_SECRET', 'OIDC Client Secret', 'K8s 以 Secret 注入'],
              ['SSO_SCOPE', 'OIDC 請求的 Scope', '通常 openid profile email；可依 SSO 服務調整'],
            ]}
          />
          <NoteBox>SSO 與 LDAP 可同時啟用。登入順序：LDAP → SSO → 本地密碼。若三者都設定，依序嘗試；ADMIN 帳號略過前兩者直接本地驗證。</NoteBox>
        </SubSection>

        <SubSection title="技能服務">
          <Table
            headers={['參數', '用途', '說明']}
            rows={[
              ['SKILL_SERVICE_KEY', '外部技能服務（如 TTS）的共享金鑰', '用於驗證技能執行服務的請求來源；本機開發與 K8s 相同值'],
            ]}
          />
        </SubSection>

        <SubSection title="Redis Session Store">
          <Table
            headers={['參數', '用途', '本機開發', 'K8s/Docker']}
            rows={[
              ['REDIS_URL', 'Redis 連線 URL；K8s 多 replica 共享 session 必填', '留空或不設定（自動 fallback 到 in-memory Map）', 'redis://redis:6379（cluster 內部 Redis Service）'],
              ['SESSION_TTL_SECONDS', 'Session Token 存活時間（秒）', '28800（8 小時）', '同；可依需求調整'],
            ]}
          />
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-500" />
              <span className="text-sm font-semibold text-red-700">K8s 多 Replica 必讀</span>
            </div>
            <p className="text-sm text-red-700 leading-6">
              K8s 部署 4 replica 時，若不設定 REDIS_URL，每個 pod 各自維護 in-memory session，
              用戶的下一個請求可能被路由到不同 pod 而出現「未登入」錯誤。
              正式環境<strong>必須</strong>部署 Redis 並設定 REDIS_URL。
            </p>
          </div>
        </SubSection>

        <SubSection title="完整 .env 範本（本機開發）">
          <CodeBlock>{`# ─── 基本伺服器 ───────────────────────────────────────────────────
PORT=3007
NODE_ENV=development
APP_BASE_URL=http://localhost:5173
FOXLINK_API_URL=http://localhost:3007

# ─── 認證 ─────────────────────────────────────────────────────────
JWT_SECRET=change_this_to_a_random_string_32chars_min
DEFAULT_ADMIN_ACCOUNT=ADMIN
DEFAULT_ADMIN_PASSWORD=Foxlink123
LLM_KEY_SECRET=                        # 留空=自動用 JWT_SECRET 衍生

# ─── Gemini AI ─────────────────────────────────────────────────────
GEMINI_API_KEY=AIzaSy...your_key...
GEMINI_MODEL_PRO=gemini-3-pro-preview
GEMINI_MODEL_FLASH=gemini-3-flash-preview

# ─── 檔案儲存 ─────────────────────────────────────────────────────
UPLOAD_DIR=./uploads                   # 本機相對路徑

# ─── Email ────────────────────────────────────────────────────────
ADMIN_NOTIFY_EMAIL=admin@your-domain.com
SMTP_SERVER=smtp.your-domain.com
SMTP_PORT=25
SMTP_USERNAME=
SMTP_PASSWORD=
FROM_ADDRESS=noreply@your-domain.com

# ─── Oracle Client ────────────────────────────────────────────────
ORACLE_HOME=D:\\ORACLE_CLIENT_23\\instantclient_23_0
NLS_LANG=AMERICAN_AMERICA.AL32UTF8

# ─── ERP DB ───────────────────────────────────────────────────────
ERP_DB_HOST=10.8.93.104
ERP_DB_PORT=1589
ERP_DB_SERVICE_NAME=ebs_CUFOX
ERP_DB_USER=apps
ERP_DB_USER_PASSWORD=your_erp_password

# ─── System DB (Oracle 23 AI) ─────────────────────────────────────
SYSTEM_DB_HOST=10.8.93.70
SYSTEM_DB_PORT=1526
SYSTEM_DB_SERVICE_NAME=AI
SYSTEM_DB_USER=FLGPT
SYSTEM_DB_USER_PASSWORD=your_system_db_password

# ─── AI Dashboard ─────────────────────────────────────────────────
DASHBOARD_ETL_MAX_ROWS=1000000

# ─── Knowledge Base ───────────────────────────────────────────────
KB_EMBEDDING_MODEL=gemini-embedding-001
KB_OCR_MODEL=gemini-3-flash-preview
KB_PDF_OCR_CONCURRENCY=20
KB_IMG_OCR_CONCURRENCY=20
KB_EMBED_CONCURRENCY=20
KB_EMBEDDING_DIMS=768
KB_RERANK_MODEL=gemini-2.5-flash
KB_RERANK_TOP_K_FETCH=10
KB_RERANK_TOP_K_RETURN=3
KB_RERANK_SCORE_THRESHOLD=0.5
KB_DEFAULT_CHUNK_STRATEGY=regular
KB_DEFAULT_CHUNK_SIZE=1024
KB_DEFAULT_CHUNK_OVERLAP=50
KB_DEFAULT_RETRIEVAL_MODE=hybrid
KB_ALLOW_ADMIN_CREATE=true
KB_ALLOW_USER_CREATE=false

# ─── 外部 API / MCP ───────────────────────────────────────────────
EXTERNAL_API_BASE_URL=http://localhost:3007
API_KEY_PREFIX=flgpt_
API_RATE_LIMIT_PER_MIN=60
MCP_SERVER_ENABLED=true
API_CHAT_SESSION_TTL_HOURS=24

# ─── LDAP（不用可整組移除）────────────────────────────────────────
LDAP_URL=ldap://your-ldap-server:389
LDAP_BASE_DN=DC=yourdomain,DC=local
LDAP_MANAGER_DN=CN=manager,DC=yourdomain,DC=local
LDAP_MANAGER_PASSWORD=your_ldap_password

# ─── SSO / OIDC（不用可移除）─────────────────────────────────────
# SSO_ISSUER=https://sso.your-domain.com
# SSO_CLIENT_ID=your_client_id
# SSO_CLIENT_SECRET=your_client_secret
# SSO_SCOPE=openid profile email

# ─── Skill Service ────────────────────────────────────────────────
SKILL_SERVICE_KEY=your-skill-service-key

# ─── Redis（本機開發可留空）──────────────────────────────────────
# REDIS_URL=redis://localhost:6379
SESSION_TTL_SECONDS=28800`}</CodeBlock>
          <TipBox>複製此範本到 <code className="bg-blue-50 px-1 rounded text-xs">server/.env</code>，填入實際值後即可啟動本機開發環境。確保 .gitignore 包含 <code className="bg-blue-50 px-1 rounded text-xs">server/.env</code>。</TipBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════ 說明書 KB 自動同步 */}
      <Section id="a-help-kb-sync" icon={<RefreshCw size={22} />} iconColor="text-blue-500" title="說明書 KB 自動同步">
        <Para>
          系統在每次啟動時，會自動將使用者說明書內容向量化並存入一個名為
          <strong>「Cortex 使用說明書」</strong>的系統公開知識庫。
          這讓 AI 在對話中能回答「如何使用本系統」的問題，並透過 TAG 路由自動匹配，
          使用者不需要手動掛載知識庫。
        </Para>

        <SubSection title="同步機制概覽">
          <div className="bg-slate-900 rounded-xl px-5 py-4 mt-2">
            <pre className="text-xs text-slate-300 font-mono leading-6 whitespace-pre">{`K8s 部署新版本（rolling update）
  │
  ▼
新 Pod 啟動 → server.js listen 完成
  │
  └─ setImmediate(syncHelpKb)   ← 非阻塞，不影響 API 啟動
       │
       ├─ tryLock("lock:help_kb_sync", TTL=600s)
       │     ├─ 搶到鎖 → 執行同步（只有 1 個 Pod）
       │     └─ 未搶到 → 印「略過」，直接返回（其餘 3 個 Pod）
       │
       ▼ 拿到鎖的 Pod：
  找或建立 KB「Cortex 使用說明書」
       │
       ▼ 逐章節（共 21 個）：
  計算 MD5 hash → 比對 kb_documents.filename
       ├─ hash 相同 → skip（不重新 embed）
       └─ hash 不同 → 刪舊 chunks → 重新 Embed → 插入
       │
       ▼
  updateKbStats → unlock`}</pre>
          </div>
        </SubSection>

        <SubSection title="Hash 增量更新說明">
          <Para>
            每個章節以 <strong>MD5 hash</strong> 作為版本指紋，存於 <code className="bg-slate-100 px-1 rounded text-xs">kb_documents.filename</code>，
            格式為 <code className="bg-slate-100 px-1 rounded text-xs">章節ID::md5hash</code>（例：<code className="bg-slate-100 px-1 rounded text-xs">u-tools::a3f7c912...</code>）。
          </Para>
          <Table
            headers={['狀況', '行為', '說明']}
            rows={[
              ['內容未變', 'skip（不 embed）', 'hash 相同，直接跳過，不消耗 Embedding API 費用'],
              ['內容有改動', '刪舊 → 重新 embed → 插入', 'hash 不同，清除該章節所有舊 chunks 後重建'],
              ['新章節', '直接 embed → 插入', '在 kb_documents 中找不到對應記錄'],
              ['章節被刪除', '不處理（舊 chunks 殘留）', '需手動進入知識庫管理頁刪除文件'],
            ]}
          />
          <NoteBox>
            每次 deploy 後系統只會重新 embed 有變動的章節，通常只需幾秒到幾分鐘，不影響正常對話使用。
          </NoteBox>
        </SubSection>

        <SubSection title="K8s 多 Replica 安全機制">
          <Para>
            K8s 預設跑 4 個 replica，若全部同時啟動都執行 embed 會造成 Oracle 寫入衝突。
            系統透過 <strong>Redis 分散式鎖</strong>（<code className="bg-slate-100 px-1 rounded text-xs">SET NX EX</code>）解決此問題：
          </Para>
          <Table
            headers={['Pod', '取鎖結果', '行為']}
            rows={[
              ['Pod 1（最先啟動）', '取鎖成功', '執行完整同步流程，完成後釋鎖'],
              ['Pod 2 / 3 / 4', '取鎖失敗（鎖已存在）', '印 log「另一個 pod 正在同步，略過」後直接返回'],
            ]}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-700 mb-1">Lock Key</p>
              <code className="text-xs text-blue-600">lock:help_kb_sync</code>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-700 mb-1">Lock TTL</p>
              <p className="text-xs text-amber-600">600 秒（10 分鐘）<br/>防止 Pod crash 後 deadlock</p>
            </div>
          </div>
          <TipBox>本機開發無 REDIS_URL 時，Redis 自動降級為記憶體 Map（單 process），行為相同，無需特別設定。</TipBox>
        </SubSection>

        <SubSection title="知識庫基本設定">
          <Table
            headers={['設定項目', '值', '說明']}
            rows={[
              ['名稱', 'Cortex 使用說明書', '系統自動建立，名稱固定，不可在 UI 中刪除後自動重建'],
              ['is_public', '1（全員可見）', '所有使用者無需申請，可在知識庫市集看到並在對話中使用'],
              ['Tags', '使用說明, 操作手冊, 功能教學, 如何使用, Cortex', 'TAG 路由比對依據，覆蓋常見問法'],
              ['Embedding 模型', '同 KB_EMBEDDING_MODEL 環境變數（預設 gemini-embedding-001）', ''],
              ['維度', '768', '固定，不跟隨 ENV 變動'],
              ['分塊策略', 'regular（1024 字 / chunk, overlap 50）', ''],
              ['檢索模式', 'hybrid（向量 + 全文）', ''],
            ]}
          />
        </SubSection>

        <SubSection title="如何更新說明書內容">
          <Para>說明書內容維護在一個獨立的 JS 文字檔，開發者修改後重新 deploy 即可自動同步：</Para>
          <div className="space-y-3">
            <StepItem num={1} title="編輯 server/services/helpContent.js" desc="每個物件對應一個章節，修改 content 欄位的文字內容" />
            <StepItem num={2} title="git commit & push → 觸發 CI/CD deploy" />
            <StepItem num={3} title="新 Pod 啟動後自動偵測 hash 變動，重新 embed 有改動的章節" desc="Server log 會印出：[HelpKB] ✓ 更新章節: 章節名稱" />
          </div>
          <div className="bg-slate-900 rounded-xl p-4 mt-3">
            <p className="text-xs text-slate-400 mb-2 font-mono">server/services/helpContent.js 結構</p>
            <pre className="text-xs text-slate-300 font-mono leading-6 whitespace-pre">{`const sections = [
  {
    id: 'u-tools',          // 對應 HelpPage.tsx 的 Section id
    title: '可用工具',       // 章節標題（用於 log）
    content: \`             // 純文字內容（供向量化使用）
      MCP 工具：連接外部系統...
      TAG 路由步驟：
      Step 1：...
    \`,
  },
  // ...更多章節
];`}</pre>
          </div>
          <NoteBox>
            <code className="bg-amber-100 px-1 rounded text-xs">helpContent.js</code> 與 <code className="bg-amber-100 px-1 rounded text-xs">HelpPage.tsx</code> 是獨立維護的。
            修改 HelpPage.tsx 的 UI 時，記得同步更新 helpContent.js 的對應章節文字，
            否則 AI 回答的說明內容會與頁面說明書不一致。
          </NoteBox>
        </SubSection>

        <SubSection title="Server Log 觀察">
          <Para>啟動時查看以下 log 可確認同步狀態：</Para>
          <div className="bg-slate-900 rounded-xl p-4">
            <pre className="text-xs font-mono leading-6 whitespace-pre">{`[HelpKB] 開始同步說明書知識庫...
[HelpKB] 知識庫建立完成: <uuid>        ← 首次建立才出現
[HelpKB] ✓ 更新章節: 可用工具           ← 有改動的章節
[HelpKB] ✓ 更新章節: 技能 Skill
[HelpKB] 同步完成，共更新 2 個章節。

── 若無改動 ──
[HelpKB] 說明書知識庫已是最新，略過。

── 若被其他 Pod 搶先 ──
[HelpKB] 另一個 pod 正在同步，略過。`}</pre>
          </div>
        </SubSection>

        <SubSection title="手動強制重新同步">
          <Para>若需強制重建所有章節（如更換 Embedding 模型維度），步驟如下：</Para>
          <div className="space-y-3">
            <StepItem num={1} title="進入知識庫市集 → 找到「Cortex 使用說明書」" />
            <StepItem num={2} title="刪除知識庫（或刪除所有文件）" desc="刪除後 kb_documents 及 kb_chunks 全部清空" />
            <StepItem num={3} title="重新啟動 Server（或 rolling restart）" desc="kubectl rollout restart deployment/foxlink-gpt" />
            <StepItem num={4} title="Server 重啟後自動重建知識庫並對所有章節重新 embed" />
          </div>
          <NoteBox>若只是清除 Redis lock（如手動 DEL lock:help_kb_sync），不刪除知識庫，下次重啟仍會因 hash 相同而略過，無法強制重 embed。需同時刪除知識庫才有效。</NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════ 說明文件翻譯管理 */}
      <Section id="a-help-translation" icon={<Languages size={22} />} iconColor="text-sky-500" title="說明文件翻譯管理">
        <Para>
          系統支援使用者說明頁面的多語言翻譯（繁體中文 → English / Tiếng Việt），
          管理員可在<strong>管理後台 →「說明文件翻譯」</strong>頁籤操作。
          中文內容為唯一原始語言（Source of Truth），翻譯永遠是中文 → 其他語言，不會反向。
        </Para>

        <SubSection title="架構概覽">
          <Table
            headers={['元件', '說明']}
            rows={[
              ['helpSeedData.js', '中文種子資料檔（程式碼變更時由 LLM 同步更新）'],
              ['help_sections + help_translations', 'Oracle DB 表，儲存各語言翻譯內容'],
              ['helpAutoSeed.js', 'Server 啟動時自動比對 last_modified，匯入有變更的段落'],
              ['HelpTranslationPanel', '管理後台翻譯面板，支援批次翻譯、手動編輯、即時進度'],
              ['HelpBlockRenderer', '前端渲染器，將 block JSON 轉為頁面元件'],
            ]}
          />
        </SubSection>

        <SubSection title="日常操作流程">
          <Para><strong>情況一：程式碼變更導致說明內容更新</strong>（最常見，幾乎不需手動操作）</Para>
          <div className="space-y-3">
            <StepItem num={1} title="LLM 修改程式時自動更新 helpSeedData.js" desc="同時 bump 該段落的 last_modified 日期" />
            <StepItem num={2} title="Server 重啟（或 K8s 重新部署）" desc="helpAutoSeed 自動比對日期，只匯入有變更的段落到 DB" />
            <StepItem num={3} title="進入翻譯管理面板" desc="看到 en/vi 欄位顯示黃色 ⚠️ 過期標記" />
            <StepItem num={4} title="點選「選取全部過期段落」→「批次翻譯」" desc="LLM 自動翻譯，即時顯示進度（等待中 → 翻譯中 → 完成 ✓）" />
          </div>

          <Para><strong>情況二：手動編輯中文說明</strong></Para>
          <div className="space-y-3">
            <StepItem num={1} title="在翻譯面板按 ✏️ 編輯按鈕" desc="切到 zh-TW 頁籤進行編輯" />
            <StepItem num={2} title="修改標題、側邊欄標籤或區塊 JSON → 儲存" desc="系統自動 bump last_modified，en/vi 翻譯標記為過期" />
            <StepItem num={3} title="對過期的語言版本執行翻譯" />
          </div>

          <Para><strong>情況三：手動微調英文或越文翻譯</strong></Para>
          <div className="space-y-3">
            <StepItem num={1} title="按 ✏️ → 切到 en 或 vi 頁籤" desc="直接修改翻譯內容" />
            <StepItem num={2} title="儲存（系統會提醒將覆蓋 LLM 翻譯）" desc="此操作不影響中文原文" />
          </div>
        </SubSection>

        <SubSection title="翻譯面板功能">
          <Table
            headers={['功能', '說明']}
            rows={[
              ['翻譯模型選擇', '從 LLM 模型管理載入可用模型，建議用 Flash 類以節省成本'],
              ['語言進度卡', '顯示各語言已翻譯 / 總數、過期數量、進度條'],
              ['批次翻譯', '勾選多個段落 → 選語言 → 一鍵翻譯，支援即時進度顯示與中斷'],
              ['單段翻譯', '操作欄按 EN / VI 按鈕，翻譯單一段落'],
              ['終止翻譯', '翻譯進行中可隨時按「終止翻譯」中斷批次作業'],
              ['手動編輯', '按 ✏️ 進入編輯 Modal，可切換 zh-TW / en / vi 頁籤'],
              ['重新匯入種子資料', '從 helpSeedData.js 強制重新匯入所有 zh-TW 內容'],
            ]}
          />
        </SubSection>

        <SubSection title="翻譯狀態圖示說明">
          <Table
            headers={['圖示', '狀態', '說明']}
            rows={[
              ['✓ 綠色日期', '已翻譯（最新）', '翻譯日期 ≥ zh-TW 修改日期'],
              ['⚠️ 黃色日期', '過期', '翻譯日期 < zh-TW 修改日期，需重新翻譯'],
              ['—', '尚未翻譯', '該語言版本尚未建立'],
              ['🔄 轉圈', '翻譯中', '正在呼叫 LLM 翻譯'],
              ['🕐 等待中', '排隊等待', '批次翻譯中，尚未輪到此段落'],
              ['✓ 綠色「完成」', '剛完成', '本次翻譯作業已完成'],
              ['✗ 紅色「失敗」', '翻譯失敗', '滑鼠移上可查看錯誤訊息'],
            ]}
          />
        </SubSection>

        <SubSection title="注意事項">
          <TipBox>
            翻譯永遠是<strong>中文 → 其他語言</strong>的單向流程。手動編輯英文或越文不會影響中文原文，
            但下次中文有變更並重新翻譯時，手動編輯的內容會被 LLM 翻譯覆蓋（儲存時會有確認提示）。
          </TipBox>
          <NoteBox>
            Server 每次啟動時會自動執行 Auto Seed，比對 helpSeedData.js 與 DB 的 last_modified，
            只匯入有變更的段落。若所有段落都是最新的，會印出 log：
            <code className="bg-amber-100 px-1 rounded text-xs ml-1">[HelpAutoSeed] All 28 sections up-to-date</code>
          </NoteBox>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════ 文件範本管理 */}
      <Section id="a-doc-template" icon={<LayoutTemplate size={22} />} iconColor="text-indigo-500" title="文件範本管理">
        <Para>
          管理員可查看全部使用者的範本、管理公開範本、查詢範本使用紀錄，並了解後端 DB 結構與 API。
        </Para>

        <SubSection title="DB 資料表">
          <Table
            headers={['資料表', '用途']}
            rows={[
              ['doc_templates', '範本主表：id、creator_id、name、format、schema_json、is_public、use_count、forked_from 等'],
              ['doc_template_shares', '共享設定：template_id、share_type(use/edit)、grantee_type、grantee_id'],
              ['doc_template_outputs', '生成紀錄：template_id、user_id、input_data、output_file、created_at'],
            ]}
          />
          <TipBox>
            Oracle DB 使用 <code className="bg-blue-100 px-1 rounded text-xs">VARCHAR2(36)</code> UUID 主鍵，
            <code className="bg-blue-100 px-1 rounded text-xs">doc_template_shares</code> 使用 UNIQUE 約束 <code className="bg-blue-100 px-1 rounded text-xs">(template_id, grantee_type, grantee_id)</code> 防止重複分享。
          </TipBox>
        </SubSection>

        <SubSection title="API 端點一覽">
          <Table
            headers={['方法', '路徑', '說明', '權限']}
            rows={[
              ['GET', '/api/doc-templates', '列出範本（搜尋/格式篩選）', '登入使用者'],
              ['POST', '/api/doc-templates/upload', 'SSE 串流：上傳分析（parsing→analyzing→done）', '登入使用者'],
              ['POST', '/api/doc-templates', '建立範本（含注入佔位符）', '登入使用者'],
              ['GET', '/api/doc-templates/:id', '取得單一範本', 'use+'],
              ['PUT', '/api/doc-templates/:id', '更新名稱/描述/標籤/schema', 'edit+'],
              ['DELETE', '/api/doc-templates/:id', '刪除範本及所有檔案', 'owner'],
              ['GET', '/api/doc-templates/:id/download', '下載原始檔或佔位符檔（?type=template）', 'use+'],
              ['POST', '/api/doc-templates/:id/generate', '生成文件，回傳 download_url', 'use+'],
              ['GET', '/api/doc-templates/:id/outputs', '查詢生成歷史', 'use+'],
              ['POST', '/api/doc-templates/:id/fork', '複製範本給當前使用者', 'use+'],
              ['GET/POST/DELETE', '/api/doc-templates/:id/shares', '共享管理（讀/建/刪）', 'owner'],
            ]}
          />
        </SubSection>

        <SubSection title="上傳分析 SSE 事件">
          <Para>POST /api/doc-templates/upload 使用 Server-Sent Events 回傳進度：</Para>
          <Table
            headers={['事件', '說明']}
            rows={[
              ['status: parsing', '正在解析文件內容（mammoth / ExcelJS / pdf-parse）'],
              ['status: analyzing', '已解析，正在呼叫 Gemini Flash 識別變數'],
              ['done', '分析完成，回傳 { tempPath, format, schema }，前端進入確認步驟'],
              ['error', '分析失敗，回傳錯誤訊息'],
            ]}
          />
          <CodeBlock>{`// SSE 事件格式
data: {"event":"status","message":"parsing"}
data: {"event":"status","message":"analyzing"}
data: {"event":"done","tempPath":"/tmp/xxx.docx","format":"docx","schema":{"variables":[...]}}`}</CodeBlock>
        </SubSection>

        <SubSection title="變數識別 — Gemini Prompt 說明">
          <Para>
            系統向 Gemini Flash 送出以下 JSON 格式要求，識別文件中的填寫區域：
          </Para>
          <div className="bg-slate-900 rounded-xl p-4">
            <pre className="text-xs text-slate-300 font-mono leading-6 whitespace-pre">{`{
  "variables": [
    {
      "key": "recipient_name",   // 英文識別鍵
      "label": "收件人姓名",      // 顯示名稱
      "type": "text",            // text|number|date|select|loop
      "required": true,
      "default_value": "",
      "original_text": "請輸入收件人姓名", // 文件中的原始文字
      "children": []             // loop 類型才有，代表每列的子欄位
    }
  ],
  "confidence": 0.92,
  "notes": "..."
}`}</pre>
          </div>
        </SubSection>

        <SubSection title="DOCX 佔位符注入機制">
          <Para>
            Word 文件的 XML 結構中，一段連續文字可能被分割成多個 <code className="bg-slate-100 px-1 rounded text-xs">&lt;w:r&gt;</code>（run）節點。
            系統透過 <strong>run-merge 演算法</strong>解決此問題：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="JSZip 解壓 DOCX，讀取 word/document.xml" />
            <StepItem num={2} title="對每個段落（<w:p>）合併所有 run 的純文字" />
            <StepItem num={3} title="以 original_text → {{key}} 進行字串替換" />
            <StepItem num={4} title="替換後重建為單一 merged run，寫回 DOCX" />
          </div>
          <NoteBox>
            若原始文件同一句話跨越多個格式段（如部分文字加粗），merge 後會統一格式，
            建議範本文件的佔位文字保持單一格式（全無加粗或全加粗），避免格式遺失。
          </NoteBox>
        </SubSection>

        <SubSection title="檔案儲存路徑">
          <Table
            headers={['類型', '路徑', '說明']}
            rows={[
              ['原始上傳', 'uploads/templates/original/<uuid>.{ext}', '使用者上傳的原始文件'],
              ['注入佔位符後', 'uploads/templates/processed/<uuid>.{ext}', 'docxtemplater 使用的範本檔'],
              ['生成輸出', 'uploads/generated/<uuid>.{ext}', '每次生成的結果文件'],
            ]}
          />
        </SubSection>

        <SubSection title="is_public 管理">
          <Para>
            管理員可透過 <code className="bg-slate-100 px-1 rounded text-xs">PUT /api/doc-templates/:id</code>（帶 <code className="bg-slate-100 px-1 rounded text-xs">is_public: 0/1</code>）
            強制關閉任何範本的公開狀態。使用者自行公開時，系統在前端已有 <code className="bg-slate-100 px-1 rounded text-xs">window.confirm()</code> 確認提示，
            後端無需額外審核流程。
          </Para>
          <NoteBox>
            管理員目前無專屬後台 UI 管理範本，若需批量管理，請直接查詢 <code className="bg-amber-100 px-1 rounded text-xs">doc_templates</code> 資料表。
            未來版本預計新增管理員範本總覽頁面。
          </NoteBox>
        </SubSection>

        <SubSection title="固定格式模式 — DB 欄位與 Schema 結構">
          <Para>
            <code className="bg-slate-100 px-1 rounded text-xs">doc_templates.IS_FIXED_FORMAT</code>（Oracle <code className="bg-slate-100 px-1 rounded text-xs">NUMBER(1) DEFAULT 0</code>）
            控制是否啟用固定格式模式。啟用後 <code className="bg-slate-100 px-1 rounded text-xs">schema_json</code> 中每個變數可含以下額外欄位：
          </Para>
          <CodeBlock>{`// schema_json.variables[i] 固定格式延伸欄位
{
  "key": "amount",
  "type": "number",
  // 樣式（DOCX/XLSX/PDF 共用）
  "style": {
    "detected": { "fontSize": 10, "bold": false, "color": "#000000" },
    "override":  { "fontSize": 12, "bold": true, "color": "#1a237e",
                   "overflow": "truncate", "maxChars": 50 }
  },
  // DOCX loop 固定列高（點數，僅 loop 類型子欄位父列有效）
  "docx_style": { "rowHeightPt": 28 },
  // PDF 欄位座標（版面編輯器設定，頂左原點，單位 pt）
  "pdf_cell": { "page": 1, "x": 72, "y": 120, "width": 200, "height": 20 }
}`}</CodeBlock>
        </SubSection>

        <SubSection title="樣式自動偵測機制">
          <Para>
            上傳範本時，系統自動從原始檔案讀取字型樣式，存入 <code className="bg-slate-100 px-1 rounded text-xs">style.detected</code>：
          </Para>
          <Table
            headers={['格式', '偵測來源', '偵測內容']}
            rows={[
              ['DOCX', '標記值所在儲存格的 <w:rPr>', 'fontSize（w:sz÷2）、bold（w:b）、italic（w:i）、color（w:color）'],
              ['XLSX', 'ExcelJS cell.font', 'size、bold、italic、color.argb（去除 alpha 前綴）'],
              ['PPTX', 'slide XML <a:rPr> 屬性', 'sz（÷100 換算 pt）、b、i；<a:solidFill> 顏色'],
            ]}
          />
          <Para>
            生成時優先使用 <code className="bg-slate-100 px-1 rounded text-xs">style.override</code>，
            若無覆寫則 fallback 至 <code className="bg-slate-100 px-1 rounded text-xs">style.detected</code>。
            溢位預設為 <code className="bg-slate-100 px-1 rounded text-xs">wrap</code>。
          </Para>
        </SubSection>

        <SubSection title="PDF 疊加生成（pdf_overlay）流程">
          <Para>
            當範本為 PDF、<code className="bg-slate-100 px-1 rounded text-xs">is_fixed_format=1</code> 且至少一個變數有 <code className="bg-slate-100 px-1 rounded text-xs">pdf_cell</code> 時，
            採用 <strong>pdf_overlay 策略</strong>（而非 pdfkit 重建）：
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="pdf-lib 載入原始 PDF 二進位（保留 Logo / 印章 / 框線）" />
            <StepItem num={2} title="fontkit 注入 CJK 字型（NotoSansTC），確保中文正確顯示" />
            <StepItem num={3} title="依 pdf_cell 座標計算 pdf-lib 底左原點：pdfY = pageH − cell.y − cell.height" />
            <StepItem num={4} title="pushGraphicsState → clip 矩形 → drawText → endPath 防止溢出" />
            <StepItem num={5} title="shrink 策略：縮小 fontSize 直到文字寬度 ≤ cell.width" />
            <StepItem num={6} title="未定位欄位（無 pdf_cell）：console.warn 跳過，不影響其他欄位" />
          </div>
          <CodeBlock>{`// 座標轉換（server/services/docTemplateService.js）
// 儲存：頂左原點（與 pdfjs-dist canvas 一致）
// pdf-lib 使用底左原點，需轉換：
const cellTop    = pageHeight - cell.y
const cellBottom = pageHeight - cell.y - cell.height
// drawText y = cellBottom（加 padding）`}</CodeBlock>
          <NoteBox>
            CJK 字型檔需存在於 <code className="bg-amber-100 px-1 rounded text-xs">server/fonts/NotoSansTC-Regular.ttf</code>，
            若不存在，PDF 疊加中文字可能顯示為亂碼或空白。請確認部署環境有此字型。
          </NoteBox>
        </SubSection>

        <SubSection title="新增 API 端點（固定格式）">
          <Table
            headers={['方法', '路徑', '說明']}
            rows={[
              ['GET', '/api/doc-templates/:id/preview-file', '取得原始 PDF 供 pdfjs-dist 預覽（版面編輯器使用）'],
              ['PUT', '/api/doc-templates/:id', '更新時可傳入 is_fixed_format: 0/1 切換模式'],
            ]}
          />
        </SubSection>

        <SubSection title="content_mode — 內容模式 Schema 說明">
          <Para>
            每個 <code className="bg-slate-100 px-1 rounded text-xs">TemplateVariable</code> 新增選用欄位
            <code className="bg-slate-100 px-1 rounded text-xs">content_mode</code>，
            控制生成時的取值邏輯。未設定時預設為 <code className="bg-slate-100 px-1 rounded text-xs">'variable'</code>，與原有行為完全相容。
          </Para>
          <Table
            headers={['content_mode 值', '生成時行為', 'PDF overlay 特殊處理']}
            rows={[
              ['variable（預設）', 'resolveValue() 取 inputData[key] 或 default_value', '無特殊處理，正常寫入文字'],
              ['static', '始終使用 default_value，不詢問使用者', '正常寫入 default_value 文字'],
              ['empty', '始終回傳空字串（空白）', '畫 rgb(1,1,1) 白色矩形覆蓋原始文字後 continue'],
            ]}
          />
          <CodeBlock>{`// resolveValue() — server/services/docTemplateService.js
function resolveValue(v, inputData) {
  const mode = v.content_mode || 'variable';
  if (mode === 'static') return String(v.default_value ?? '');
  if (mode === 'empty')  return '';
  const raw = inputData[v.key];
  return raw !== undefined ? String(raw) : String(v.default_value ?? '');
}`}</CodeBlock>
          <Para>
            <code className="bg-slate-100 px-1 rounded text-xs">resolveValue()</code> 取代了 DOCX / XLSX / PPTX / PDF 各格式中原本的
            <code className="bg-slate-100 px-1 rounded text-xs">String(inputData[v.key] ?? v.default_value ?? '')</code> 直接取值，
            統一處理所有格式的內容模式。
          </Para>
        </SubSection>

        <SubSection title="OCR 掃描式 PDF — 後端實作">
          <Para>
            <code className="bg-slate-100 px-1 rounded text-xs">ocrPdfFields(pdfBuf, model?)</code> 函式位於
            <code className="bg-slate-100 px-1 rounded text-xs">server/services/docTemplateService.js</code>，
            使用 Gemini Pro Vision 對 PDF 做 OCR 並回傳帶 <code className="bg-slate-100 px-1 rounded text-xs">pdf_cell</code> 座標的 schema。
          </Para>
          <div className="space-y-3">
            <StepItem num={1} title="讀取頁面尺寸（pdf-lib）" desc="取得實際寬高（pt），fallback A4：595×842。座標計算依此基準" />
            <StepItem num={2} title="PDF buffer → base64" desc="以 inlineData mimeType='application/pdf' 傳給 Gemini" />
            <StepItem num={3} title="Gemini Pro 回傳 JSON" desc="包含 variables[].pdf_cell { page, x, y, width, height }（頂左原點，pt）" />
            <StepItem num={4} title="解析 + fallback" desc="JSON 解析失敗時回傳空 schema，不中斷上傳流程" />
          </div>
          <Table
            headers={['API 端點', '說明']}
            rows={[
              ['POST /upload（自動觸發）', 'PDF pdf-parse 萃取 < 50 非空白字元時自動呼叫 ocrPdfFields()'],
              ['POST /:id/ocr-scan', '對現有 PDF 範本重新 OCR；合併新 pdf_cell 回 schema_json，更新 DB'],
            ]}
          />
          <CodeBlock>{`// POST /:id/ocr-scan 合併邏輯
const varMap = Object.fromEntries(existingVars.map(v => [v.key, v]));
for (const ov of ocrVars) {
  if (varMap[ov.key]) {
    varMap[ov.key] = { ...varMap[ov.key], pdf_cell: ov.pdf_cell };  // 更新座標
  } else {
    varMap[ov.key] = ov;   // 追加新欄位
  }
}
// 寫回 DB schema_json`}</CodeBlock>
          <NoteBox>
            OCR 掃描使用 MODEL_PRO（Gemini Pro），而非 Flash。若 system_settings 中
            <code className="bg-amber-100 px-1 rounded text-xs">template_analysis_model='pro'</code> 已設定，會自動沿用。
            OCR 座標為估算值，前端版面編輯器提供人工微調入口。
          </NoteBox>
        </SubSection>

        <SubSection title="範本 AI 整合 — 三大自動化管道">
          <Para>
            範本系統提供三個新的 AI 自動化整合管道，讓 AI 直接根據對話/排程內容產出結構化文件，無需人工填表。
            三個管道共用同一套後端 API（<code className="bg-slate-100 px-1 rounded text-xs">docTemplateService.js</code>）。
          </Para>
          <Table
            headers={['管道', '設定位置', '欄位', '觸發時機']}
            rows={[
              ['Skill 技能', '技能市集 → 編輯 → I/O 頁籤', 'output_template_id（skills 資料表）', '使用者在對話中套用此 Skill 時'],
              ['排程任務', '排程任務 → 編輯 → 產出格式', 'output_template_id（scheduled_tasks 資料表）', '排程執行或手動「立即執行」時'],
              ['Pipeline 節點', 'Pipeline 編輯器 → generate_file 節點 → 使用範本', 'template_id（節點 JSON config）', 'Pipeline 工作流程執行到該節點時'],
            ]}
          />

          <div className="mt-4 space-y-4">
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-purple-700 mb-2">Skill output_template_id 流程</p>
              <div className="space-y-1 text-xs text-purple-600 leading-5">
                <p>1. 後端 <code className="bg-purple-100 px-1 rounded">chat.js</code> 偵測到 skill.output_template_id 不為空</p>
                <p>2. 呼叫 <code className="bg-purple-100 px-1 rounded">getTemplateSchemaInstruction(db, id)</code>，將範本欄位說明注入 skillSystemPrompts</p>
                <p>3. AI 以 JSON 格式回應，儲存為 text</p>
                <p>4. 呼叫 <code className="bg-purple-100 px-1 rounded">parseJsonFromAiOutput(text)</code> 萃取 JSON</p>
                <p>5. 呼叫 <code className="bg-purple-100 px-1 rounded">generateDocumentFromJson(db, id, jsonData, user)</code> 產生文件</p>
                <p>6. 以 SSE <code className="bg-purple-100 px-1 rounded">generated_files</code> 事件推送下載連結到前端</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-700 mb-2">排程任務 output_template_id 流程</p>
              <div className="space-y-1 text-xs text-amber-600 leading-5">
                <p>1. <code className="bg-amber-100 px-1 rounded">scheduledTaskService.js</code> 執行 runTask()</p>
                <p>2. 解析 prompt 中的 <code className="bg-amber-100 px-1 rounded">{'{{template:範本ID}}'}</code> 標籤，將其從 prompt 移除並收集 ID</p>
                <p>3. 若 task.output_template_id 不為空且不在清單中，補充進去</p>
                <p>4. 對每個 ID 呼叫 getTemplateSchemaInstruction()，附加到 prompt 末尾</p>
                <p>5. AI 回應後，parseJsonFromAiOutput() 萃取 JSON</p>
                <p>6. generateDocumentFromJson() 生成文件，加入 generatedFiles 清單</p>
                <p>7. 若有設定收件人，附件寄送 Email；同時記錄在 scheduled_task_runs.generated_files_json</p>
              </div>
              <div className="mt-2 bg-amber-100 rounded-lg px-3 py-2">
                <p className="text-xs font-semibold text-amber-800 mb-1">Prompt 中的範本標籤語法</p>
                <pre className="text-xs text-amber-700 font-mono">{'請根據今日出勤數據生成報告。\n{{template:abc123-uuid}}'}</pre>
                <p className="text-xs text-amber-600 mt-1">標籤會被移除後只剩 schema 指令注入，不影響 AI 的自然回應</p>
              </div>
            </div>

            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-teal-700 mb-2">Pipeline generate_file 節點 — template_id 流程</p>
              <div className="space-y-1 text-xs text-teal-600 leading-5">
                <p>1. 節點 config 含 <code className="bg-teal-100 px-1 rounded">template_id</code> 時，<code className="bg-teal-100 px-1 rounded">pipelineRunner.js</code> 走 template 路徑</p>
                <p>2. 接收上一個節點的文字輸出，呼叫 parseJsonFromAiOutput() 嘗試解析 JSON</p>
                <p>3. 若 parse 失敗，自動呼叫 getTemplateSchemaInstruction() + AI re-format，再次解析</p>
                <p>4. 解析成功後呼叫 generateDocumentFromJson()，context.user 作為權限主體</p>
                <p>5. 回傳 <code className="bg-teal-100 px-1 rounded">{'{ text: "[已生成範本檔案]", file: {...} }'}</code>，供後續節點使用或作為最終輸出</p>
              </div>
            </div>
          </div>
        </SubSection>

        <SubSection title="三大整合 API — docTemplateService.js 新增函式">
          <Table
            headers={['函式', '用途', '說明']}
            rows={[
              [
                'getTemplateSchemaInstruction(db, templateId)',
                '生成 AI 指令字串',
                '從 DB 讀取範本 schema，建構「請以下列 JSON 格式輸出」的說明文字，注入 AI 系統提示',
              ],
              [
                'parseJsonFromAiOutput(text)',
                '從 AI 回應萃取 JSON',
                '去除 Markdown 代碼塊標記（```json ... ```），搜尋 { } 包圍的 JSON 物件並解析。失敗回傳 null',
              ],
              [
                'generateDocumentFromJson(db, templateId, jsonData, user, outputFormat?)',
                '依 JSON 生成文件',
                '先以 checkAccess() 確認 user 有 use 以上權限，再呼叫 generateDocument()，回傳 { filename, publicUrl, filePath }',
              ],
            ]}
          />
          <CodeBlock>{`// getTemplateSchemaInstruction 回傳範例：
\\n\\n# 請以下列 JSON 格式輸出（用於文件範本填寫）
{
  "report_title": "（報告標題 — text）",
  "report_date":  "（報告日期 — date）",
  "items": [
    { "dept": "（部門）", "count": "（人數）" }
  ]
}

// parseJsonFromAiOutput 萃取邏輯：
function parseJsonFromAiOutput(text) {
  // 移除 \`\`\`json ... \`\`\` 圍欄
  const clean = text.replace(/\`\`\`[\\w]*\\n?([\\s\\S]*?)\\n?\`\`\`/g, '$1').trim();
  const m = clean.match(/{[\\s\\S]*}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}`}</CodeBlock>
          <NoteBox>
            generateDocumentFromJson 需要 user 物件（含 id, role）以通過 checkAccess() 權限檢查。
            Pipeline 執行時從 context.user 取得；排程執行時由 task.user_id 查詢 DB 得到完整 user 物件。
          </NoteBox>
        </SubSection>

        <SubSection title="PPTX 範本技術架構">
          <Para>
            PPTX 範本以 JSZip 在 XML 層級操作，完整保留原始品牌設計（背景圖、色彩、字型、Logo），
            不依賴 LibreOffice 或任何外部轉換工具。
          </Para>
          <Table
            headers={['函式', '用途']}
            rows={[
              ['injectPptxPlaceholders(buf, vars)', '上傳時將 original_text 替換為 {{key}} 佔位符，存成 template_file'],
              ['_replacePptxPlaceholders(xml, varMap)', '生成時將 {{key}} 替換為實際值，保留第一個 run 的格式'],
              ['_rebuildPptxSlides(zip, outputSlides)', 'content_repeat 展開後，重建 presentation.xml 的 sldIdLst 和 .rels 關聯'],
            ]}
          />
          <Para>
            slide_config 存於 <code className="bg-slate-100 px-1 rounded text-xs">doc_templates.schema_json</code> 的
            <code className="bg-slate-100 px-1 rounded text-xs">pptx_settings.slide_config</code> 欄位，結構如下：
          </Para>
          <CodeBlock>{`// pptx_settings.slide_config 範例
[
  { "index": 0, "type": "cover" },
  { "index": 1, "type": "content_repeat", "loop_var": "slides",
    "thumbnail_url": "/uploads/templates/thumbnails/xxx_slide1.png" },
  { "index": 2, "type": "back" }
]

// type 可選值：
// "cover"           — 封面（生成一頁）
// "content_single"  — 內頁（生成一頁）
// "content_repeat"  — 可重複內頁（依 loop_var 陣列長度展開 N 頁）
// "back"            — 封底（生成一頁）`}</CodeBlock>
          <NoteBox>
            縮圖透過 <code className="bg-slate-100 px-1 rounded text-xs">POST /api/doc-templates/:id/slides/:index/thumbnail</code> 上傳，
            存至 <code className="bg-slate-100 px-1 rounded text-xs">uploads/templates/thumbnails/</code>，
            URL 回寫到 slide_config[index].thumbnail_url。
          </NoteBox>
        </SubSection>

        <SubSection title="DB 欄位更新（AI 整合相關）">
          <Table
            headers={['資料表', '欄位', '類型', '說明']}
            rows={[
              ['skills', 'OUTPUT_TEMPLATE_ID', 'VARCHAR2(36) NULL', '綁定的輸出範本 ID；套用技能時 AI 自動填表並生成文件'],
              ['scheduled_tasks', 'OUTPUT_TEMPLATE_ID', 'VARCHAR2(36) NULL', '排程固定指定的輸出範本 ID'],
            ]}
          />
          <Para>
            以上欄位透過 <code className="bg-slate-100 px-1 rounded text-xs">database-oracle.js</code> 的
            <code className="bg-slate-100 px-1 rounded text-xs">safeAddColumn()</code>（skills）與
            <code className="bg-slate-100 px-1 rounded text-xs">addCol()</code>（scheduled_tasks）遷移新增，
            伺服器啟動時自動執行，無需手動執行 DDL。
          </Para>
          <Para>
            Pipeline 的 template_id 存放在 Pipeline JSON 的節點 config 物件中（非獨立 DB 欄位），
            隨排程任務的 <code className="bg-slate-100 px-1 rounded text-xs">pipeline_json</code> 欄位一起儲存。
          </Para>
        </SubSection>
      </Section>

      {/* ═══════════════════════════════ Webex Bot 管理 */}
      <Section id="a-webex-bot" icon={<MessageSquare size={22} />} iconColor="text-green-500" title="Webex Bot 管理">
        <Para>
          系統以 <strong>Outbound Polling</strong> 模式與 Webex 整合，每 8 秒主動向 Webex API 查詢新訊息，
          不需公網 inbound URL，適用企業內網防火牆環境。K8s 多 Pod 部署透過 <strong>Redis 分散鎖</strong> 確保同一訊息只有一個 Pod 處理，不重複回應。
        </Para>

        <SubSection title="系統架構">
          <CodeBlock>{`K8s 4 Pods 同時運行
    │
    │ 每 8 秒 outbound HTTPS
    ▼
GET /v1/rooms?sortBy=lastactivity&max=200
    │ 新 DM 立即出現在頂端，首則訊息延遲 ≤ 8 秒
    ▼
GET /v1/messages?roomId={id}&max=50（最多翻 3 頁 = 150 則/room/cycle）
    │
    ▼ 每則訊息
tryLock("webex:msg:{id}", 60s)  ← Redis 分散鎖
    ├─ 搶到 → 此 Pod 處理（保證只有 1 個 Pod）
    └─ 未搶到 → skip

不同用戶訊息 lock key 不同
→ 4 Pod 可同時各自處理 4 個用戶，並行能力 = Pod 數`}</CodeBlock>
        </SubSection>

        <SubSection title="啟動確認">
          <Para>部署後查看任一 Pod log，應看到：</Para>
          <CodeBlock>{`[WebexListener] Polling started (interval=8000ms, redis-lock=enabled)`}</CodeBlock>
          <Para>收到訊息時，搶到 lock 的 Pod 會顯示：</Para>
          <CodeBlock>{`[WebexListener] Dispatch: type=direct from="alice@foxlink.com" text="..."`}</CodeBlock>
          <Para>其他 Pod 會顯示：</Para>
          <CodeBlock>{`[WebexListener] Skipped (lock held by another pod): msg=Y2lzY29zcGF...`}</CodeBlock>
        </SubSection>

        <SubSection title="環境變數設定">
          <Table
            headers={['變數', '說明', '必填']}
            rows={[
              ['WEBEX_BOT_TOKEN', 'developer.webex.com 取得的 Bot Access Token', '✅ 必填'],
              ['REDIS_URL', 'Redis 連線字串，多 Pod 防重複必要（e.g. redis://redis:6379）', '✅ 建議'],
              ['WEBEX_POLL_INTERVAL_MS', 'Polling 間隔毫秒，預設 8000', '選填'],
              ['WEBEX_ROOMS_PER_POLL', '每次取幾間房間，預設 200', '選填'],
              ['WEBEX_PUBLIC_URL', 'AI 回應截斷時提示用的 Web 介面網址', '選填'],
              ['WEBEX_WEBHOOK_SECRET', 'Webhook 備用模式的 HMAC 驗簽密鑰', '選填'],
            ]}
          />
          <NoteBox>
            本專案 K8s 環境的 WEBEX_BOT_TOKEN 與 REDIS_URL 已設定在 <code className="bg-amber-100 px-1 rounded text-xs">foxlink-secrets</code> Secret 中，無需額外操作。
          </NoteBox>
        </SubSection>

        <SubSection title="每個使用者的 Webex Bot 開關">
          <Para>
            管理員可在「使用者管理」→ 編輯使用者 → 功能權限區塊，勾選或取消勾選
            <strong>「允許使用 Webex Bot」</strong>（對應 DB 欄位 <code className="bg-slate-100 px-1 rounded text-xs">webex_bot_enabled</code>）。
          </Para>
          <Table
            headers={['設定', '行為']}
            rows={[
              ['✅ 開啟（預設）', 'Bot 正常處理該用戶訊息'],
              ['❌ 關閉', 'Bot 以中/英/越三語回覆「您的帳號目前未開啟 Webex Bot 功能，如需使用請聯絡系統管理員」'],
            ]}
          />
          <TipBox>新建帳號預設開啟，可搭配角色設定批次管理。</TipBox>
        </SubSection>

        <SubSection title="DB Schema（自動 Migration）">
          <Table
            headers={['資料表', '欄位', '類型', '說明']}
            rows={[
              ['USERS', 'WEBEX_BOT_ENABLED', 'NUMBER(1) DEFAULT 1', '0=停用 Webex Bot，1=啟用'],
              ['CHAT_SESSIONS', 'SOURCE', "VARCHAR2(30)", "'webex_dm' | 'webex_room' | NULL"],
              ['CHAT_SESSIONS', 'WEBEX_ROOM_ID', 'VARCHAR2(200)', '群組 Room ID，DM 為 NULL'],
            ]}
          />
          <Para>以上欄位透過 <code className="bg-slate-100 px-1 rounded text-xs">safeAddColumn()</code> 在伺服器啟動時自動新增，無需手動 DDL。</Para>
        </SubSection>

        <SubSection title="稽核日誌與對話紀錄">
          <Para>
            所有 Webex 對話自動寫入稽核系統，與 Web UI 對話統一管理，以「來源」欄位區分：
          </Para>
          <Table
            headers={['功能', '位置', '說明']}
            rows={[
              ['Email 認證紀錄', '後台 → Webex Bot 日誌 → 認證紀錄', '查看每次 email 對應結果（成功/找不到帳號/停用）'],
              ['對話稽核（Webex 專屬）', '後台 → Webex Bot 日誌 → 對話稽核', '只顯示 Webex Bot 的對話，含敏感詞偵測'],
              ['全來源稽核日誌', '後台 → 稽核日誌 → 來源篩選', '可選「全部 / Webex Bot / Web UI」，每筆顯示來源 badge'],
              ['Token 費用統計', '後台 → Token 與費用統計', 'Webex 與 Web UI token 使用合計顯示'],
            ]}
          />
          <TipBox>
            認證紀錄可用來確認 email 正規化是否正確（@foxlink.com ↔ @foxlink.com.tw），失敗記錄會紅色警示方便排查。
          </TipBox>
        </SubSection>

        <SubSection title="Token 預算管理">
          <Para>
            Webex Bot 與 Web UI 套用<strong>相同的預算規則</strong>，用戶無法透過 Webex 繞過費用上限。
            AI 呼叫前會先檢查 daily / weekly / monthly 上限：
          </Para>
          <Table
            headers={['模式', '行為']}
            rows={[
              ['block（預設）', '超額 → Bot 回覆「當日/本週/本月使用金額已達上限 $N」並中止'],
              ['warn', '超額 → 仍繼續執行，server log 記錄警告'],
              ['admin 帳號', '豁免預算檢查，不受限制'],
            ]}
          />
          <Para>
            預算設定位置：後台 → 使用者管理 → 編輯使用者 → 額度限制，或透過角色設定批次管理。
          </Para>
        </SubSection>

        <SubSection title="Typing Indicator 與檔案附件">
          <Para>
            <strong>Typing Indicator：</strong>AI 呼叫前 Bot 會先傳送「⏳ 正在分析您的問題，請稍候...」，AI 回應完成後自動刪除該訊息。
            若 AI 呼叫失敗，Typing Indicator 也會在回覆錯誤訊息前刪除。
          </Para>
          <Para>
            <strong>AI 生成檔案附件：</strong>AI 在 Webex 模式下生成 Excel/Word/PDF/PPT 時，系統直接以附件回傳，不會輸出「請至 Web 介面下載」等連結文字。
            AI 說明文字為「📎 檔案將以附件傳送，請稍候」。
          </Para>
        </SubSection>

        <SubSection title="暫存檔定期清理">
          <Table
            headers={['時機', '清理目標', '說明']}
            rows={[
              ['用戶執行 /new', 'uploads/webex_tmp/', '清除超過 30 分鐘的殘留暫存檔'],
              ['Server 啟動 + 每小時', 'uploads/webex_tmp/', '清除超過 24 小時的附件暫存檔'],
              ['Server 啟動 + 每小時', 'uploads/generated/', '清除超過 24 小時的 AI 生成檔案暫存'],
            ]}
          />
          <Para>Log 格式：<code className="bg-slate-100 px-1 rounded text-xs">[TmpCleanup] uploads/generated/: removed N stale files</code></Para>
        </SubSection>

        <SubSection title="錯誤排查">
          <Table
            headers={['現象', '原因', '處理方式']}
            rows={[
              ['Bot 無回應', 'Polling 未啟動或 WEBEX_BOT_TOKEN 未設定', '確認 log 有 Polling started；確認 secret 有 WEBEX_BOT_TOKEN'],
              ['用戶收到多份相同回應', 'Redis 未連線，多 Pod 各自處理', '確認 redis pod 運行中；確認 REDIS_URL 正確'],
              ['「帳號未在系統中」訊息', '用戶 email 未在 users 表，或 email 格式不符', '查認證紀錄確認 norm_email；新增帳號並設定正確 email'],
              ['「帳號已停用」訊息', 'users.status != active', '在使用者管理中啟用帳號'],
              ['「使用金額已達上限」訊息', '用戶超過 daily/weekly/monthly 預算', '調整使用者或角色的預算設定'],
              ['首則訊息延遲較長', '正常現象，最長等待一個 Polling 週期', 'WEBEX_POLL_INTERVAL_MS 可調小（預設 8000ms）'],
              ['AI 回傳下載連結而非附件', 'WEBEX_SYSTEM_SUFFIX 未正確注入', '確認 webex.js 中 WEBEX_SYSTEM_SUFFIX 包含檔案生成規則（第 6-9 條）'],
            ]}
          />
        </SubSection>
      </Section>

      <Section id="a-feedback" icon={<TicketCheck size={22} />} iconColor="text-rose-500" title="問題反饋管理">
        <Para>
          問題反饋平台完整的後台設定說明。涵蓋分類管理、ERP 分流、Webex 雙群組、知識庫架構、歷史回填、工單可見性權限等。使用者端的建單 / 對話 / 滿意度等操作說明請參考使用者手冊「問題反饋」。
        </Para>

        <SubSection title="身份與可見性矩陣">
          <Para>
            反饋系統有三種身份，採用<strong>並存獨立 flag</strong>模型（角色 + <code className="bg-slate-100 px-1 rounded text-xs">is_erp_admin</code> 可同時存在）：
          </Para>
          <Table
            headers={['身份', 'role', 'is_erp_admin', '可見工單範圍', '所屬 Webex 群組']}
            rows={[
              ['Cortex admin', 'admin', '0', '全部工單', 'Cortex - 問題反饋通知'],
              ['雙重 admin', 'admin', '1', '全部工單', '兩個都加入'],
              ['ERP admin', 'user', '1', '自己建的 + 所有 ERP 分類工單', 'Cortex - ERP問題反饋通知'],
              ['一般使用者', 'user', '0', '僅自己建的', '—'],
            ]}
          />
          <NoteBox>
            ERP admin 不需要是系統 admin，可以是廠內 ERP 團隊成員。但他們能接單、回覆、結案 ERP 分類工單，並看到該類工單的內部備註（與 Cortex admin 等同）。
          </NoteBox>
        </SubSection>

        <SubSection title="分類管理（後台 → 問題反饋 → 分類管理）">
          <Para>新增 / 編輯 / 停用分類。每個分類包含：</Para>
          <Table
            headers={['欄位', '說明']}
            rows={[
              ['名稱', '顯示給使用者看的分類名稱；可透過翻譯按鈕批次產生英越語版本'],
              ['Icon', '內建 55 個常用 lucide icon grid picker，支援搜尋；也可手輸自訂名稱'],
              ['描述', '選填，用於管理者自行備忘分類用途'],
              ['排序', '拖曳列前的 ≡ 手把調整順序（drop 後自動呼叫 reorder API 寫入）'],
              ['啟用 / 停用', '停用後使用者建單時看不到此分類（舊工單仍保留分類資訊）'],
              ['ERP 分類', '勾選後此分類的工單走 ERP 分流（詳見下一段）'],
            ]}
          />
          <TipBox>
            新增分類時 <code className="bg-slate-100 px-1 rounded text-xs">sort_order</code> 自動填入現有最大值 + 1，避免跟既有分類碰撞。拖曳後系統會批次重寫所有分類的 sort_order 為 1..N。
          </TipBox>
        </SubSection>

        <SubSection title="ERP 分流架構">
          <Para>
            勾選分類的 <strong>ERP 分類</strong>（<code className="bg-slate-100 px-1 rounded text-xs">is_erp=1</code>）後，該分類的所有工單會走獨立處理流程，與 Cortex 一般工單完全隔離。
          </Para>
          <Table
            headers={['面向', 'Cortex 一般工單', 'ERP 工單']}
            rows={[
              ['Webex Room', 'Cortex - 問題反饋通知', 'Cortex - ERP問題反饋通知'],
              ['群組成員', '所有 role=admin 的使用者', '所有 is_erp_admin=1 的使用者'],
              ['站內通知對象', '僅 Cortex admin', 'Cortex admin + ERP admin'],
              ['結案後知識庫', 'feedback-public', 'feedback-erp'],
              ['接單權限', 'Cortex admin', 'Cortex admin OR ERP admin'],
              ['工單可見範圍', 'Cortex admin 可見全部', 'Cortex admin 可見；ERP admin 可見自己 + ERP 工單'],
            ]}
          />
          <NoteBox>
            Webex Room 由系統在首次有對應類型工單建立時自動建立（透過 Bot Token 呼叫 Webex API），Room ID 存於 <code className="bg-amber-100 px-1 rounded text-xs">system_settings</code> 表的 <code className="bg-amber-100 px-1 rounded text-xs">feedback_webex_room_id</code> / <code className="bg-amber-100 px-1 rounded text-xs">feedback_erp_webex_room_id</code>。
          </NoteBox>
        </SubSection>

        <SubSection title="指派 ERP 管理員（使用者管理）">
          <Para>
            在<strong>後台 → 使用者管理 → 編輯使用者 → 功能權限</strong>區塊，勾選 <strong>「ERP 管理員」</strong> 即可讓該使用者：
          </Para>
          <ListBlock items={[
            '加入 Cortex - ERP問題反饋通知 Webex 群組（首次會自動邀請）',
            '在工單列表看到所有 ERP 分類工單（即使非自己建立）',
            '可接單、回覆、結案、加內部備註（ERP 分類）',
            '收到 ERP 工單的 Webex DM / 站內通知 / 工單指派事件',
          ]} />
          <NoteBox>
            可以同時勾 <strong>系統管理員 (role=admin)</strong> 和 <strong>ERP 管理員</strong>，該使用者兩邊群組都會收到通知。一般 Cortex admin 不勾 ERP admin 的話，不會收到 ERP 分類工單的 Webex 通知。
          </NoteBox>
        </SubSection>

        <SubSection title="Webex 分流狀態機（B 方案）">
          <Para>為降低群組噪音，依工單狀態 + <code className="bg-slate-100 px-1 rounded text-xs">assigned_to</code> 決定通知走群組還是 DM：</Para>
          <CodeBlock>{`Stage 1 — 未指派（招領階段）
  新工單 / 申請者追問 → 發到對應群組廣播
  目的：讓團隊看見、方便認領

首次 admin 回覆 → assigned_to 自動填入 → 進入 Stage 2

Stage 2 — 已指派（處理階段）
  申請者追問 → DM 接單者（webex_parent_message_id 串 thread）
  admin 回覆 applicant → 站內通知 + 可選 DM applicant
  認領 / 結案 / 重開 / 轉單 → 群組發簡短 summary + DM 相關人

轉單（admin B 強搶 assign）
  舊 assignee DM：「本單已轉給 [新]，不用再跟進」
  新 assignee DM：「您接到 FB-xxxx，上下文：...」
  群組靜音`}</CodeBlock>
          <TipBox>
            DM thread 的 parent message id 存於 <code className="bg-slate-100 px-1 rounded text-xs">feedback_tickets.webex_parent_message_id</code>，讓接單者的 DM 全部串在同一個 thread。結案 / 重開會清除此欄位，下次 re-assign 會起新 thread。
          </TipBox>
          <NoteBox>
            若 assignee 沒有 webex email 或找不到，會 fallback 改發到群組（避免通知遺失）。
          </NoteBox>
        </SubSection>

        <SubSection title="知識庫架構">
          <Para>
            工單結案後會自動同步進公開知識庫供其他使用者 RAG 檢索。**完整未脫敏原文**另存於 archive 表（僅 admin 可讀）。
          </Para>
          <Table
            headers={['儲存位置', '內容', '誰能讀取']}
            rows={[
              ['feedback-public KB', '非 ERP 工單：脫敏後的對話逐則 + 附件 Vision caption + 解決方案', '所有使用者（RAG / 知識庫搜尋）'],
              ['feedback-erp KB', 'ERP 工單：同上脫敏後內容，但獨立檢索空間', '所有使用者（RAG / 知識庫搜尋）'],
              ['feedback_conversation_archive 表', '完整原始對話（含 internal notes、附件原檔連結、時間戳）、append-only', '僅管理員（透過工單詳情右上 Archive 圖示查看）'],
            ]}
          />
          <Para>結案時的執行流：</Para>
          <CodeBlock>{`PUT /tickets/:id/resolve
  ├─ [同步] feedback_conversation_archive 寫入完整原始 snapshot
  ├─ [背景 60-90s] syncTicketToKB:
  │    ├─ 附件 → Gemini Vision caption / doc parser
  │    ├─ 每段文字 → Gemini Flash 脫敏（人名/工號/email → placeholder）
  │    ├─ 切 parent-content + N 個 child chunks
  │    └─ embedBatch + INSERT 到 feedback-public or feedback-erp KB
  └─ [背景] Webex 分流通知（DM + 群組 summary）`}</CodeBlock>
          <NoteBox>
            脫敏用 Gemini Flash 跑一次 redaction pass，若失敗會 fallback 到 regex（基於 ticket.applicant_* 欄位 + email pattern）。結案 UX 不會被 KB 同步卡住 — 是 fire-and-forget 背景跑。
          </NoteBox>
        </SubSection>

        <SubSection title="歷史工單快照（Archive）">
          <Para>
            Admin 在工單詳情頁右上角可點 <code className="bg-slate-100 px-1 rounded text-xs">Archive</code> 圖示，看到該工單每次結案 / 重開 / 手動觸發的完整快照列表，內容含：
          </Para>
          <ListBlock items={[
            '完整對話（含 internal notes、system events）— 未脫敏',
            '附件原檔連結（檔名、大小、mime、下載 URL）',
            '工單當時的狀態快照（subject/description/priority/assigned_to 等）',
            '觸發時間、觸發者、觸發類型（resolved / reopened / closed / migration）',
          ]} />
          <TipBox>
            Archive 表是 <strong>append-only</strong>，永久保留；若工單被 reopen 再結案，會累積兩筆快照，可對比前後解法差異。未來容量大時可用 <code className="bg-slate-100 px-1 rounded text-xs">PARTITION BY RANGE (snapshot_at)</code> 做年度分區。
          </TipBox>
        </SubSection>

        <SubSection title="歷史工單 KB 回填（backfillFeedbackKB.js）">
          <Para>當 KB 架構升級後要把之前結案的工單一次性塞進新架構，用這個腳本：</Para>
          <CodeBlock>{`# 預覽目標數量 + 預估時間
node server/scripts/backfillFeedbackKB.js --dry-run

# 小批次驗證（前 5 張）
node server/scripts/backfillFeedbackKB.js --limit=5

# 全量跑（每張 60-90 秒）
node server/scripts/backfillFeedbackKB.js | tee /tmp/backfill.log

# 中斷後續跑
node server/scripts/backfillFeedbackKB.js --resume

# 強制覆蓋既有 archive / KB（例如改了脫敏 prompt 要重跑）
node server/scripts/backfillFeedbackKB.js --force`}</CodeBlock>
          <Table
            headers={['特性', '說明']}
            rows={[
              ['Idempotent', 'archive 判斷 (ticket_id, trigger=migration) 已存在則 skip；KB sync 本身 DELETE+INSERT 可無限重跑'],
              ['續跑', '進度即時寫 server/tmp/backfill-progress.json，Ctrl+C 後 --resume 續跑'],
              ['Rate limit 保護', '每張工單間隔 1.5 秒；附件 Vision / 脫敏 LLM 串流內循序跑'],
              ['失敗不中斷', '單張失敗記到 progress.failed[] 繼續下一張，全部跑完再看清單'],
            ]}
          />
          <NoteBox>
            K8s 生產環境執行：<code className="bg-amber-100 px-1 rounded text-xs">kubectl exec -it &lt;pod&gt; -- node server/scripts/backfillFeedbackKB.js --dry-run</code>。1000 張工單約 20-25 小時，建議離峰或分 limit 批次跑。
          </NoteBox>
        </SubSection>

        <SubSection title="脫敏規則">
          <Table
            headers={['類別', '處理', '範例']}
            rows={[
              ['人名（中/英/越）', '→ [使用者]', '王小明、John Smith、Nguyen Van A'],
              ['工號', '→ [工號]', '8793, A12345'],
              ['Email', '→ [email]', 'user@foxlink.com'],
              ['部門代號', '保留', 'FEC01, PCB3'],
              ['機台 SN', '保留', 'SN12345, M001'],
              ['錯誤碼 / URL / IP / 路徑 / SQL', '保留', '原樣不動'],
              ['日期 / 時間 / 金額 / 技術術語', '保留', '原樣不動'],
            ]}
          />
          <Para>
            實作於 <code className="bg-slate-100 px-1 rounded text-xs">server/services/feedbackRedactor.js</code>，使用 Gemini Flash + temperature=0 確保可重現。LLM timeout / 失敗自動 fallback 到 regex。脫敏 prompt 是 system instruction 層級，明確列出 REPLACE / KEEP 清單。
          </Para>
          <TipBox>
            要調整脫敏範圍（例如未來想連部門代號也遮）編輯 <code className="bg-slate-100 px-1 rounded text-xs">feedbackRedactor.js</code> 的 SYSTEM_PROMPT，然後用 <code className="bg-slate-100 px-1 rounded text-xs">backfillFeedbackKB.js --force</code> 重跑所有歷史工單。
          </TipBox>
        </SubSection>

        <SubSection title="問題排除">
          <Table
            headers={['問題', '原因', '解法']}
            rows={[
              ['ERP 工單通知還是發到 Cortex 群組', 'ticket.category_is_erp 欄位沒帶（舊 code 或 JOIN 漏）', '確認 getTicketById / getTicketByNo / listTickets 都 SELECT c.is_erp AS category_is_erp'],
              ['ERP 管理員 checkbox 永遠未勾', 'GET /users SELECT 清單沒包 is_erp_admin 欄位', '檢查 server/routes/users.js 的 SELECT'],
              ['拖曳排序後跳回原位', 'PUT /admin/categories/reorder 被 /:id 搶走路由', '確認 reorder 端點在 /:id 之前註冊'],
              ['ERP admin 點通知進工單空白', '工單詳情 API 權限漏認 ERP admin', '使用 canManageTicket / canViewTicket helper 取代 role !== admin 判斷'],
              ['貼上截圖都叫 image.png', '瀏覽器 clipboard File 預設名', '已在前端 renamePastedFile 加時戳 paste_MMDDHHmmss[_idx].ext'],
              ['ERP room 沒建立', 'WEBEX_BOT_TOKEN 未設 / 該類型工單還沒建立過', 'Bot Token 設好後第一張 ERP 工單就會觸發 ensureFeedbackErpWebexRoom'],
              ['已結案工單沒進 KB', '結案後背景 sync 失敗（embed / vision API 錯誤）', '查 server log 的 [FeedbackKB] sync error；可用 backfillFeedbackKB.js --from-ticket-id=N 補'],
            ]}
          />
        </SubSection>

        <SubSection title="相關檔案">
          <Table
            headers={['檔案', '用途']}
            rows={[
              ['server/services/feedbackService.js', '工單 CRUD + 分類管理 + reorderCategories'],
              ['server/routes/feedback.js', 'API 路由 + permission helper (canView/canManageTicket)'],
              ['server/services/feedbackNotificationService.js', 'Email / Webex / 站內通知 + 雙 room + 狀態機分流'],
              ['server/services/feedbackKBSync.js', '結案同步到 feedback-public / feedback-erp KB'],
              ['server/services/feedbackArchive.js', 'archive 快照寫入 + 查詢'],
              ['server/services/feedbackRedactor.js', 'LLM 脫敏 + regex fallback'],
              ['server/services/feedbackAttachmentProcessor.js', '圖片 Vision caption + 文件 parser 分派'],
              ['server/scripts/backfillFeedbackKB.js', '歷史工單一次性回填'],
              ['server/scripts/feedbackRedactionDemo.js', '脫敏 before/after 對照 demo'],
              ['docs/feedback-platform-design.md', '完整設計文件（含 ERP 分流架構、可見性矩陣、雙 KB）'],
              ['docs/feedback-platform-implementation.md', 'Phase 1-5 實作報告 + 決策紀錄'],
            ]}
          />
        </SubSection>
      </Section>

      <Section id="a-training" icon={<BookOpen size={22} />} iconColor="text-emerald-500" title="教育訓練權限管理">
        <SubSection title="教育訓練權限設定">
          <Para>教育訓練功能的權限分為三個層級，可在「角色管理」和「使用者管理」中設定：</Para>
          <Table
            headers={['權限', '說明']}
            rows={[
              ['無權限', '只能進入訓練教室學習已發佈且有存取權的課程'],
              ['上架權限', '可發佈自己的課程，但不能編輯他人的課程'],
              ['上架及編輯權限', '可編輯任何課程、管理課程分享、查看成績報表'],
            ]}
          />
          <TipBox>使用者層級的設定會覆蓋角色層級。若設為「沿用角色設定」，則依角色的教育訓練權限決定。</TipBox>
        </SubSection>

        <SubSection title="Help 說明書綁定教材">
          <Para>管理員可以將教育訓練課程綁定到使用者說明書的章節，讓使用者在閱讀說明書時直接進行互動學習。</Para>
          <div className="space-y-2 my-3">
            {[
              { step: '1', text: '進入「系統管理」→「Help 翻譯管理」' },
              { step: '2', text: '找到要綁定的 Help section，點擊「🎓 綁定教材」' },
              { step: '3', text: '選擇課程和章節（可選「全部章節」）' },
              { step: '4', text: '儲存。使用者在 Help 頁面該章節旁會出現「🎓 互動教學」按鈕' },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3 text-sm text-slate-600">
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{step}</span>
                {text}
              </div>
            ))}
          </div>
          <NoteBox>Help 綁定的教材不受課程權限限制，所有登入使用者都能學習。課程不需要發佈也能透過 Help 連結存取。</NoteBox>
        </SubSection>

        <SubSection title="課程分類管理">
          <Para>管理員可在課程管理頁面管理課程分類（最多三層樹狀結構）。分類名稱支援三語言翻譯。</Para>
        </SubSection>
      </Section>
    </div>
  )
}

// ── Main HelpPage ─────────────────────────────────────────────────────────────

type Role = 'user' | 'admin' | 'training-dev'

export default function HelpPage() {
  const navigate = useNavigate()
  const { isAdmin, canAccessTrainingDev } = useAuth()
  const { t, i18n } = useTranslation()
  const [role, setRole] = useState<Role>(isAdmin ? 'admin' : 'user')
  const contentRef = useRef<HTMLDivElement>(null)
  const [apiSections, setApiSections] = useState<HelpSectionData[]>([])
  const [trainingDevSections, setTrainingDevSections] = useState<HelpSectionData[]>([])
  const [loadingApi, setLoadingApi] = useState(false)
  const [trainingTarget, setTrainingTarget] = useState<{ courseId: number; lessonId?: number | null } | null>(null)

  // Fetch user sections from API (multilingual) — shared between 'user' and 'training-dev' tabs
  useEffect(() => {
    if (role === 'admin') return
    let cancelled = false
    const lang = i18n.language || 'zh-TW'
    setLoadingApi(true)
    api.get('/help/sections', { params: { lang } })
      .then(res => {
        if (!cancelled) {
          const allSections = res.data as HelpSectionData[]
          console.log('[HelpPage] API returned', allSections.length, 'sections')
          allSections.forEach(s => {
            if (!Array.isArray(s.blocks)) {
              console.warn(`[HelpPage] Section "${s.id}" blocks is not array:`, typeof s.blocks, s.blocks)
            } else {
              s.blocks.forEach((block: any, i: number) => {
                if ((block.type === 'card_grid' || block.type === 'comparison') && block.items) {
                  block.items.forEach((item: any, j: number) => {
                    if (item.desc === undefined || item.desc === null) {
                      console.warn(`[HelpPage] Section "${s.id}" block[${i}] ${block.type} item[${j}] missing desc:`, JSON.stringify(item))
                    }
                  })
                }
                if (block.type === 'subsection' && block.blocks) {
                  block.blocks.forEach((sub: any, si: number) => {
                    if ((sub.type === 'card_grid' || sub.type === 'comparison') && sub.items) {
                      sub.items.forEach((item: any, j: number) => {
                        if (item.desc === undefined || item.desc === null) {
                          console.warn(`[HelpPage] Section "${s.id}" block[${i}].blocks[${si}] ${sub.type} item[${j}] missing desc:`, JSON.stringify(item))
                        }
                      })
                    }
                  })
                }
              })
            }
          })
          const userOnly = allSections.filter(
            s => s.sectionType === 'user' && Array.isArray(s.blocks) && s.blocks.length > 0 &&
              s.id !== 'u-training-dev'
          )
          console.log('[HelpPage] Filtered to', userOnly.length, 'user sections:', userOnly.map(s => s.id))
          setApiSections(userOnly)
          // Extract training-dev section(s) separately
          const tdSections = allSections.filter(
            s => s.id === 'u-training-dev' && Array.isArray(s.blocks) && s.blocks.length > 0
          )
          setTrainingDevSections(tdSections)
        }
      })
      .catch(err => {
        console.warn('[HelpPage] Failed to load API sections, falling back to hardcoded:', err.message)
        setApiSections([])
      })
      .finally(() => { if (!cancelled) setLoadingApi(false) })
    return () => { cancelled = true }
  }, [role, i18n.language])

  const useApi = role === 'user' && apiSections.length > 0
  const useApiTd = role === 'training-dev' && trainingDevSections.length > 0

  // Sidebar items
  const sidebarItems = role === 'admin'
    ? adminSections
    : role === 'training-dev'
      ? useApiTd
        ? trainingDevSections.map(s => ({ id: s.id, label: s.sidebarLabel, icon: getIcon(s.icon, 'sm') || <BookOpen size={18} /> }))
        : []
      : useApi
        ? apiSections.map(s => ({ id: s.id, label: s.sidebarLabel, icon: getIcon(s.icon, 'sm') || <BookOpen size={18} /> }))
        : userSections

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
          {t('help.back')}
        </button>
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-blue-500" />
          <h1 className="text-lg font-bold text-slate-800">{t('help.pageTitle')}</h1>
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
            {t('help.roleUser')}
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
              {t('help.roleAdmin')}
            </button>
          )}
          {canAccessTrainingDev && (
            <button
              onClick={() => setRole('training-dev')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${role === 'training-dev'
                ? 'bg-white text-violet-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              <BookOpen size={15} />
              {t('help.roleTrainingDev')}
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left TOC */}
        <nav data-region="sidebar" className="w-56 bg-white border-r border-slate-200 overflow-y-auto flex-shrink-0 py-4 px-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3">{t('help.toc')}</p>
          <div className="space-y-0.5">
            {sidebarItems.map((s) => (
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
                : role === 'training-dev'
                  ? 'bg-violet-100 text-violet-700 border border-violet-200'
                  : 'bg-blue-100 text-blue-700 border border-blue-200'
              }`}>
              {role === 'admin' ? <Settings size={15} /> : role === 'training-dev' ? <BookOpen size={15} /> : <User size={15} />}
              {role === 'admin' ? t('help.badgeAdmin') : role === 'training-dev' ? t('help.badgeTrainingDev') : t('help.badgeUser')}
            </div>

            {role === 'training-dev' ? (
              loadingApi ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="animate-spin text-violet-500" size={24} />
                </div>
              ) : useApiTd ? (
                <>
                  {trainingDevSections.map(section => (
                    <div key={section.id} className="relative">
                      {section.linkedCourseId && (
                        <div className="float-right mt-2 mr-1 flex items-center gap-2">
                          {section.linkedLessonMandatory != null && (
                            <span className={`text-[10px] font-medium px-2 py-1 rounded-full border ${
                              section.linkedLessonMandatory === 1
                                ? 'bg-red-50 text-red-600 border-red-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {section.linkedLessonMandatory === 1
                                ? t('training.lessonMandatory')
                                : t('training.lessonOptional')}
                            </span>
                          )}
                          <button
                            onClick={() => setTrainingTarget({ courseId: section.linkedCourseId!, lessonId: section.linkedLessonId })}
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200"
                          >
                            🎓 {t('help.interactiveTutorial')}
                          </button>
                        </div>
                      )}
                      <RenderHelpSection section={section} />
                    </div>
                  ))}
                </>
              ) : (
                <div className="text-slate-400 text-center py-16">{t('help.footerContact')}</div>
              )
            ) : role === 'user' ? (
              loadingApi ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                </div>
              ) : useApi ? (
                <>
                  {apiSections.map(section => (
                    <div key={section.id} className="relative">
                      {section.linkedCourseId && (
                        <div className="float-right mt-2 mr-1 flex items-center gap-2">
                          {section.linkedLessonMandatory != null && (
                            <span className={`text-[10px] font-medium px-2 py-1 rounded-full border ${
                              section.linkedLessonMandatory === 1
                                ? 'bg-red-50 text-red-600 border-red-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {section.linkedLessonMandatory === 1
                                ? t('training.lessonMandatory')
                                : t('training.lessonOptional')}
                            </span>
                          )}
                          <button
                            onClick={() => setTrainingTarget({ courseId: section.linkedCourseId!, lessonId: section.linkedLessonId })}
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                          >
                            🎓 {t('help.interactiveTutorial')}
                          </button>
                        </div>
                      )}
                      <RenderHelpSection section={section} />
                    </div>
                  ))}
                </>
              ) : (
                <UserManual />
              )
            ) : (
              <AdminManual />
            )}

            {/* Help Training Player Modal */}
            {trainingTarget && (
              <HelpTrainingPlayer
                courseId={trainingTarget.courseId}
                lessonId={trainingTarget.lessonId}
                onClose={() => setTrainingTarget(null)}
              />
            )}

            {/* Footer */}
            <div className="mt-16 pt-8 border-t border-slate-200 text-center">
              <p className="text-slate-400 text-xs">{t('help.pageTitle')}</p>
              <p className="text-slate-300 text-xs mt-1">{t('help.footerContact')}</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
