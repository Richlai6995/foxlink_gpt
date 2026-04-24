/**
 * Help page seed data — zh-TW (source of truth)
 * Auto-extracted from HelpPage.tsx
 * Generated: 2026-04-22
 *
 * Block types: para, tip, note, table, steps, code, list, subsection, card_grid, comparison
 */

const userSections = [
  {
    "id": "u-intro",
    "sort_order": 1,
    "icon": "BookOpen",
    "icon_color": "text-blue-500",
    "last_modified": "2026-04-15",
    "title": "系統介紹",
    "sidebar_label": "系統介紹",
    "blocks": [
      {
        "type": "para",
        "text": "Foxlink GPT to Cortex 是正崴精密工業內部專屬的 AI 智慧助理平台，整合 **Google Gemini**、**Azure OpenAI (AOAI)**、**Oracle OCI** 及 **Cohere** 多種語言模型，提供流暢的多語言對話、文件深度分析、多媒體處理、工具調用及自動化排程等功能，協助同仁大幅提升日常工作效率。"
      },
      {
        "type": "para",
        "text": "平台以企業安全為前提，所有資料傳輸均在正崴內部網路環境下進行，對話記錄保存於公司伺服器，符合資訊安全及稽核要求。"
      },
      {
        "type": "table",
        "headers": [
          "功能",
          "說明"
        ],
        "rows": [
          [
            "多樣語言模型",
            "支援 Gemini（Pro / Flash / Image）、AOAI（GPT 系列）、OCI 及 Cohere 多種模型，可依需求切換"
          ],
          [
            "智慧對話",
            "支援繁體中文、英文及越南文，具備單次 Session 完整記憶能力"
          ],
          [
            "深度研究",
            "自動拆解成最多 12 個子議題分別調查，可結合知識庫、技能、MCP 工具作為資料來源或輸入提示"
          ],
          [
            "文件分析",
            "可上傳 PDF、Word、Excel、PowerPoint、圖片、程式原始碼、設定檔（YAML/JSON/Dockerfile 等）、Jupyter Notebook 等多種格式，AI 直接閱讀並分析內容"
          ],
          [
            "工具調用",
            "可調用自建知識庫、API 連接器、MCP 工具及技能（Skill）進行問答與作業自動化"
          ],
          [
            "AI 戰情室",
            "結合 Oracle ERP 資料庫與向量語意搜尋，用自然語言查詢生產戰情，並生成圖表 / 儀表板"
          ],
          [
            "任務排程",
            "設定排程讓 AI 定期執行分析任務，結果自動寄送 Email 或生成下載檔案"
          ],
          [
            "音訊轉文字",
            "上傳語音檔，系統自動轉錄為文字後送 AI 分析"
          ],
          [
            "生成輸出",
            "AI 可依指令生成 PDF、Excel、Word、PPT、TXT 供下載"
          ],
          [
            "對話記錄",
            "所有對話永久保存於伺服器，可隨時查閱、搜尋歷史問答"
          ]
        ]
      },
      {
        "type": "note",
        "text": "部分進階功能（如深度研究、排程任務、知識庫建立、AI 戰情室）須由系統管理員開通對應權限後才能使用，若看不到相關入口，請洽 IT 部門申請。"
      }
    ]
  },
  {
    "id": "u-login",
    "sort_order": 2,
    "icon": "User",
    "icon_color": "text-indigo-500",
    "last_modified": "2026-04-01",
    "title": "登入與登出",
    "sidebar_label": "登入與登出",
    "blocks": [
      {
        "type": "subsection",
        "title": "Foxlink SSO 單一登入（AD 帳號適用）",
        "blocks": [
          {
            "type": "para",
            "text": "持有公司 Active Directory（AD）網域帳號的同仁，可使用 **Foxlink SSO** 一鍵登入，無需另外記憶 Foxlink GPT to Cortex 密碼。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟瀏覽器，輸入系統網址",
                "desc": "建議使用 Chrome 或 Edge 以獲得最佳體驗"
              },
              {
                "title": "點選登入頁面的「Foxlink SSO 登入」藍色按鈕",
                "desc": "系統自動導向公司 SSO 驗證頁面"
              },
              {
                "title": "輸入您的 AD 工號與 AD 密碼完成驗證",
                "desc": "若您已在公司內部網路環境登入 AD，可能免輸入直接通過"
              },
              {
                "title": "驗證通過後自動跳回 Foxlink GPT to Cortex 主畫面"
              }
            ]
          },
          {
            "type": "note",
            "text": "**重要：SSO 僅適用於擁有 AD 帳號的正崴員工。**由系統管理員手動建立的本地帳號（如外部合作夥伴、特殊功能帳號）無法使用 SSO，必須以帳號密碼方式登入（見下方說明）。"
          },
          {
            "type": "tip",
            "text": "AD 帳號登入後如需修改密碼，請透過公司 AD 系統（如 Windows 網域）更改，Foxlink GPT to Cortex 的「修改密碼」功能僅限本地帳號使用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "帳號密碼登入（本地帳號適用）",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟瀏覽器，輸入系統網址"
              },
              {
                "title": "在登入頁面輸入帳號與密碼",
                "desc": "帳號密碼由系統管理員提供，首次使用請先洽系統管理員確認帳號已建立並啟用"
              },
              {
                "title": "點選「登入」按鈕，登入成功後自動跳轉至主畫面"
              }
            ]
          },
          {
            "type": "note",
            "text": "若帳號未啟用，系統會顯示「帳號尚未啟用」提示，請洽系統管理員確認帳號狀態。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "忘記密碼（本地帳號適用）",
        "blocks": [
          {
            "type": "para",
            "text": "本地帳號若忘記密碼，可使用登入頁面的「忘記密碼」功能，系統會寄送重設密碼連結至您的帳號綁定 Email。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "在登入頁面點選「忘記密碼？」連結",
                "desc": "位於登入按鈕下方"
              },
              {
                "title": "輸入您的帳號（工號），點選「發送重設信件」"
              },
              {
                "title": "至您的 Email 信箱開啟重設連結",
                "desc": "連結有效期限通常為 24 小時"
              },
              {
                "title": "依指示設定新密碼後即可重新登入"
              }
            ]
          },
          {
            "type": "note",
            "text": "AD 帳號忘記密碼請聯絡 IT 部門透過公司 AD 系統重設，無法透過此功能處理。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "登出系統",
        "blocks": [
          {
            "type": "para",
            "text": "點選左側邊欄最下方的登出圖示（向左箭頭），即可安全登出。登出後 Token 立即失效，確保帳號安全。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-ui",
    "sort_order": 3,
    "icon": "Settings",
    "icon_color": "text-slate-500",
    "last_modified": "2026-04-08",
    "title": "介面導覽",
    "sidebar_label": "介面導覽",
    "blocks": [
      {
        "type": "para",
        "text": "主畫面分為兩大區域：**左側邊欄**（導航與功能入口）與**中央對話區域**（對話主體）。"
      },
      {
        "type": "card_grid",
        "cols": 1,
        "items": [
          {
            "title": "左側邊欄",
            "borderColor": "slate",
            "desc": "",
            "items": [
              "Foxlink GPT to Cortex Logo 及品牌識別",
              "「+ 新對話」按鈕 — 建立全新對話 Session",
              "AI 模型選擇下拉選單 — 切換 AOAI / Gemini 等模型",
              "對話歷史清單（依今天、昨天、過去 7 天、更早分組）",
              "「更多功能」折疊選單 — 含匯入分享、系統管理、排程任務、技能市集、知識庫市集、AI 戰情室、文件範本、教育訓練、問題反饋、使用說明",
              "語言切換（中文 / English / Tiếng Việt）",
              "使用者資訊、修改密碼、登出圖示"
            ]
          },
          {
            "title": "中央對話區域",
            "borderColor": "blue",
            "desc": "",
            "items": [
              "頂部工具列：對話標題、分享按鈕、停止生成按鈕",
              "頂部工具列功能開關：技能（✦）、自建知識庫（🗄️）、API 連接器（⚡）、MCP 工具（🌐）",
              "頂部工具列額度指示器：顯示日 / 週 / 月用量（有設定時才出現）",
              "頂部工具列消耗趨勢按鈕（📈）：查看個人各模型歷史費用走勢",
              "頂部工具列深度研究面板（🔭）：發起或查閱研究任務",
              "頂部工具列 AI 戰情快速入口（📊，有權限才顯示）",
              "訊息區：您的問題（右側藍色泡泡）、AI 回覆（左側白色），支援 Markdown 格式化顯示",
              "每則 AI 回覆底部：複製按鈕、Token 計數",
              "底部：訊息輸入框（支援 Shift+Enter 換行、Enter 送出）、迴紋針附件按鈕（📎）、深度研究按鈕（🔍）"
            ]
          }
        ]
      },
      {
        "type": "tip",
        "text": "部分頂部工具列功能（如 AI 戰情室、排程任務）只有具備對應權限的帳號才會顯示，若有需要請洽系統管理員開通。"
      }
    ]
  },
  {
    "id": "u-lang",
    "sort_order": 4,
    "icon": "Globe",
    "icon_color": "text-sky-500",
    "last_modified": "2026-04-20",
    "title": "語言切換與多語設定",
    "sidebar_label": "語言切換與多語設定",
    "blocks": [
      {
        "type": "para",
        "text": "Foxlink GPT to Cortex 完整支援**繁體中文（繁中）、英文（EN）、越南文（VI）**三種語言，涵蓋 UI 介面語言切換及內容多語翻譯兩個層面，讓不同語系的同仁都能流暢使用。"
      },
      {
        "type": "subsection",
        "title": "切換 UI 介面語言",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點選左側邊欄底部的「🌐 語言切換」按鈕",
                "desc": "顯示目前語言名稱（如「繁體中文」），點擊展開語言選單"
              },
              {
                "title": "從選單中選擇目標語言",
                "desc": "繁體中文 🇹🇼 / English 🇺🇸 / Tiếng Việt 🇻🇳"
              },
              {
                "title": "介面語言立即切換",
                "desc": "所有 UI 文字、按鈕、提示訊息均切換為所選語言，無需重新整理頁面"
              }
            ]
          },
          {
            "type": "para",
            "text": "語言偏好設定會同步儲存到您的帳號（伺服器端），下次登入後自動套用，與瀏覽器無關。"
          },
          {
            "type": "tip",
            "text": "對話標題（Session Title）支援三語版本。切換語言後，歷史對話的標題也會自動顯示對應語言版本（若建立時系統已翻譯）。"
          },
          {
            "type": "note",
            "text": "**UI 語言 = AI 回答語言**：您設定的介面語言會同步影響 AI 對話的輸出語言。即使您用中文提問、或知識庫內容是英文，AI 仍會使用您設定的語言回答。只有在您明確要求翻譯（如「翻成日文」「translate to French」）時才會例外。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "內容多語翻譯機制",
        "blocks": [
          {
            "type": "para",
            "text": "系統各功能中的名稱、說明等文字欄位均支援三語版本（繁中 / EN / VI）。翻譯的觸發方式分為**自動翻譯**和**手動翻譯**兩種，不同功能模組的處理方式不同，請依下表了解各場景的行為："
          },
          {
            "type": "table",
            "headers": [
              "功能 / 場景",
              "翻譯觸發方式",
              "說明"
            ],
            "rows": [
              [
                "技能（Skill）名稱 / 說明",
                "儲存時自動翻譯",
                "點「儲存」後，系統自動呼叫 AI 翻譯成三語並儲存"
              ],
              [
                "知識庫（KB）名稱 / 說明",
                "建立時自動翻譯",
                "點「建立」後自動翻譯，也可事後手動重新翻譯"
              ],
              [
                "對話標題（Session Title）",
                "重新命名時自動翻譯",
                "手動改名後系統背景自動翻譯為英文與越南文"
              ],
              [
                "AI 戰情室命名查詢參數標籤",
                "手動按翻譯按鈕",
                "參數標籤旁有「↻」按鈕，點擊後 AI 翻譯並填入 EN / VI 欄位"
              ],
              [
                "AI 戰情室圖表標題 / 軸名",
                "手動按翻譯按鈕",
                "圖表標題、X / Y 軸名稱旁各有翻譯按鈕，一鍵填入三語"
              ],
              [
                "儀表板名稱",
                "手動按翻譯按鈕",
                "編輯儀表板時可點翻譯按鈕自動填入英文與越南文"
              ]
            ]
          },
          {
            "type": "note",
            "text": "自動翻譯在儲存時背景執行，通常只需數秒。若翻譯失敗（如 AI 服務暫時中斷），欄位會保留空白或原語言內容，可事後使用「重新翻譯」功能重跑。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "手動重新翻譯",
        "blocks": [
          {
            "type": "para",
            "text": "技能市集、知識庫市集等設定頁中，名稱 / 說明欄位下方有一個**「多語翻譯」展開區（Language 圖示）**，點擊展開後可看到三語版本的當前內容，並提供「↻ 重新翻譯」按鈕："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "展開多語翻譯區（點 Languages 圖示或箭頭）",
                "desc": "顯示 繁中 / EN / VI 三欄翻譯內容"
              },
              {
                "title": "直接修改任一欄位內容（選用）",
                "desc": "可手動覆寫自動翻譯的結果"
              },
              {
                "title": "點擊「↻ 重新翻譯」按鈕",
                "desc": "以目前的繁中內容為基礎，重新呼叫 AI 翻譯，填入 EN 和 VI 欄位"
              },
              {
                "title": "儲存設定使翻譯生效",
                "desc": ""
              }
            ]
          },
          {
            "type": "tip",
            "text": "手動修改的翻譯內容在儲存後可以再次點「重新翻譯」覆蓋，或保留手動版本不動。翻譯以**繁中版本**為主要來源，若繁中欄位為空，翻譯結果可能不正確。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "各語言版本顯示邏輯",
        "blocks": [
          {
            "type": "para",
            "text": "當系統以某語言顯示內容（如技能名稱、對話標題）時，使用以下 fallback 順序："
          },
          {
            "type": "table",
            "headers": [
              "切換到 / 目前語言",
              "優先顯示",
              "備用（若翻譯空白）"
            ],
            "rows": [
              [
                "繁體中文（繁中）",
                "name_zh / title_zh",
                "原始 name / title 欄位"
              ],
              [
                "English（EN）",
                "name_en / title_en",
                "繁中版本 → 原始欄位"
              ],
              [
                "Tiếng Việt（VI）",
                "name_vi / title_vi",
                "繁中版本 → 原始欄位"
              ]
            ]
          },
          {
            "type": "note",
            "text": "若切換到英文或越南文後，某些技能名稱 / 知識庫名稱仍顯示中文，代表該項目尚未翻譯。可進入設定頁手動觸發翻譯。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-chat",
    "sort_order": 5,
    "icon": "MessageSquare",
    "icon_color": "text-green-500",
    "last_modified": "2026-04-12",
    "title": "開始對話",
    "sidebar_label": "開始對話",
    "blocks": [
      {
        "type": "subsection",
        "title": "發送訊息",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點選左上角「新對話」或直接在輸入框輸入問題"
              },
              {
                "title": "在底部輸入框輸入您的問題或需求",
                "desc": "支援多行輸入，按 Shift + Enter 換行，按 Enter 送出"
              },
              {
                "title": "AI 開始即時串流回覆",
                "desc": "回覆過程中可點選停止按鈕中斷生成"
              }
            ]
          },
          {
            "type": "tip",
            "text": "在同一個對話 Session 中，AI 會記住前面所有的對話內容。若想重新開始不帶上下文，請點選「新對話」。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "重新生成",
        "blocks": [
          {
            "type": "para",
            "text": "滑鼠移到 AI 最後一則回覆上，點選重新整理圖示，系統會以相同問題重新生成一次回答，適合對回覆不滿意時使用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "貼上圖片",
        "blocks": [
          {
            "type": "para",
            "text": "在輸入框中直接按 Ctrl + V 可貼上剪貼簿中的圖片，或將圖片檔案拖曳至頁面任何位置上傳。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "生成圖片（重要）",
        "blocks": [
          {
            "type": "note",
            "text": "**要讓 AI 生成圖片，必須先在左側邊欄的模型下拉選單中切換為「Image 類型」模型**（例如 Gemini Image 或其他支援圖片輸出的模型）。使用一般 Pro / Flash / GPT 模型時，AI 無法生成圖片，只能描述圖片。"
          },
          {
            "type": "para",
            "text": "系統支援 Gemini 圖片生成模型，可依文字描述直接生成圖片，也可以上傳現有圖片後請 AI 進行修改、風格轉換、局部調整等作業。"
          },
          {
            "type": "note",
            "text": "圖片生成功能需選擇支援圖片輸出的模型（如 Gemini Image 模型），請確認左側模型選單中有此選項，否則請洽管理員開啟。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "文字生圖",
        "blocks": [
          {
            "type": "para",
            "text": "直接在對話框輸入您想要的圖片描述，AI 會依照說明生成圖片："
          },
          {
            "type": "list",
            "items": [
              "幫我生成一張台灣風格的科技辦公室插圖，藍色調，現代感，適合用於簡報封面。",
              "生成一個正崴精密工廠生產線的示意圖，寫實風格，畫面乾淨，橫向構圖。"
            ]
          },
          {
            "type": "tip",
            "text": "描述越具體效果越好，可以說明風格（寫實/插畫/3D）、色調、構圖方向、使用場景。中文英文描述均可。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "修圖：對現有圖片進行 AI 編輯",
        "blocks": [
          {
            "type": "para",
            "text": "上傳您的圖片，再用文字告訴 AI 要怎麼修改："
          },
          {
            "type": "list",
            "items": [
              "**更換背景** — 請將這張產品圖的背景換成純白色",
              "**風格轉換** — 將這張照片轉換為水彩畫風格",
              "**局部修改** — 將圖中的文字改為英文版本",
              "**補充元素** — 在圖片右下角加入 FOXLINK 公司 Logo 的位置提示",
              "**調整色調** — 將整張圖調整為偏冷藍色的科技感配色"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "多輪對話修圖",
        "blocks": [
          {
            "type": "para",
            "text": "在同一個 Session 中可以連續對圖片進行多次修改，AI 會記住上一輪的圖片狀態，您只需要說「再把左側的人物移除」、「顏色再深一點」即可持續調整。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "上傳原始圖片，並說明第一步修改",
                "desc": "例：幫我去除圖片中的浮水印"
              },
              {
                "title": "AI 生成修改後的圖片",
                "desc": "檢視結果是否符合需求"
              },
              {
                "title": "繼續下一步修改",
                "desc": "例：好，再把背景改為漸層藍"
              },
              {
                "title": "滿意後下載圖片",
                "desc": "點選圖片右鍵儲存，或點選下載連結"
              }
            ]
          },
          {
            "type": "tip",
            "text": "若對修改結果不滿意，可點選「重新生成」按鈕，AI 會以同樣指令重新嘗試，每次結果略有差異。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "圖片生成注意事項",
        "blocks": [
          {
            "type": "list",
            "items": [
              "生成圖片每次會消耗較多 Token，請注意使用量",
              "不可生成涉及真實人物肖像、政治敏感、色情暴力等內容",
              "生成的圖片版權建議用於內部使用，商業用途請確認授權規範",
              "圖片生成時間約 10-30 秒，請耐心等待，不要重複送出"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "複製 AI 回覆",
        "blocks": [
          {
            "type": "para",
            "text": "滑鼠移到任意一則 AI 回覆上，左下角會出現複製圖示。點選後整則回覆文字（含格式）複製至剪貼簿，可直接貼入 Word 等應用程式。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "下載生成檔案",
        "blocks": [
          {
            "type": "para",
            "text": "當您要求 AI 輸出特定格式的檔案（如請幫我匯出 Excel），AI 回覆結束後會自動顯示下載連結。點選連結即可下載，檔案保存於伺服器，可隨時回到歷史對話重新下載。"
          },
          {
            "type": "tip",
            "text": "生成檔案的指令範例：「請將以上資料整理成 Excel 表格並輸出」、「將報告轉為 PDF 格式」。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-model",
    "sort_order": 6,
    "icon": "Cpu",
    "icon_color": "text-purple-500",
    "last_modified": "2026-04-08",
    "title": "選擇 AI 模型",
    "sidebar_label": "選擇 AI 模型",
    "blocks": [
      {
        "type": "para",
        "text": "系統支援 **Google Gemini**、**Azure OpenAI（AOAI）**、**Oracle OCI** 及 **Cohere** 多平台模型，由左側邊欄的模型下拉選單切換。不同模型在能力、速度、費用上各有差異，請依需求選擇。"
      },
      {
        "type": "card_grid",
        "cols": 2,
        "items": [
          {
            "emoji": "",
            "title": "Gemini Pro",
            "tag": {
              "color": "blue",
              "text": "高精度"
            },
            "desc": "• 高精度、深度思考能力\n• 適合複雜分析、報告撰寫\n• 長文件處理、多步驟推理\n• 回覆速度相對較慢",
            "borderColor": "blue"
          },
          {
            "emoji": "",
            "title": "Gemini Flash",
            "tag": {
              "color": "orange",
              "text": "快速"
            },
            "desc": "• 回覆速度極快\n• 適合簡短問答、快速翻譯\n• 音訊轉錄使用此模型\n• Token 成本較低",
            "borderColor": "yellow"
          },
          {
            "emoji": "",
            "title": "Gemini Image",
            "tag": {
              "color": "purple",
              "text": "圖片生成"
            },
            "desc": "• **唯一支援生成圖片的模型**\n• 文字生圖、上傳圖修圖、風格轉換\n• 多輪對話連續調整圖片\n• 若需生成圖片，必須切換至此模型",
            "borderColor": "violet"
          },
          {
            "emoji": "",
            "title": "AOAI GPT 5.4",
            "tag": {
              "color": "green",
              "text": "目前最新"
            },
            "desc": "• **目前已支援 AOAI GPT 5.4 模型**\n• 長文脈絡理解能力強\n• 適合需要 OpenAI 相容 API 的場景\n• 後續將陸續新增更多 AOAI 模型",
            "borderColor": "green"
          }
        ]
      },
      {
        "type": "para",
        "text": "部分 AOAI 模型（如 GPT 5.x / o 系列）支援**推理力度**調整（Low / Medium / High），可在模型選擇後看到力度選項，適合需要更深入推理的複雜任務。"
      },
      {
        "type": "note",
        "text": "**模型清單由系統管理員統一維護，**實際可用模型以畫面下拉選單為準。除上述模型外，系統也支援 OCI 和 Cohere 平台的模型。模型選擇會保存在您的瀏覽器，下次開啟仍會維持上次的選擇；切換模型不會影響當前對話歷史記錄。"
      },
      {
        "type": "tip",
        "text": "若模型下拉選單中看不到 Image 類型模型，表示管理員尚未開放此功能，請洽 IT 部門申請。"
      }
    ]
  },
  {
    "id": "u-upload",
    "sort_order": 7,
    "icon": "Upload",
    "icon_color": "text-teal-500",
    "last_modified": "2026-04-15",
    "title": "上傳檔案",
    "sidebar_label": "上傳檔案",
    "blocks": [
      {
        "type": "subsection",
        "title": "支援格式",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "類型",
              "支援格式",
              "說明"
            ],
            "rows": [
              [
                "文件",
                "PDF、DOCX、XLSX、PPTX、TXT、CSV、TSV、MD、RST、TEX",
                "AI 直接讀取文件內容進行分析"
              ],
              [
                "圖片",
                "JPG、PNG、GIF、WEBP、BMP、TIFF、HEIC、AVIF、ICO",
                "AI 可辨識圖片中的文字與內容"
              ],
              [
                "音訊",
                "MP3、WAV、M4A、OGG、FLAC、WEBM、MP4、AAC、OPUS、WMA",
                "自動轉錄為文字後送 AI 分析"
              ],
              [
                "程式原始碼",
                "PY、JS、TS、JSX、TSX、JAVA、KT、C、H、CPP、HPP、CS、GO、RS、PHP、RB、SWIFT、DART、LUA、PL、R、SQL、SH、BASH、PS1、BAT、HTML、CSS、SCSS、VUE、SVELTE、XML、SVG、GRAPHQL 等 100+ 種",
                "AI 以 UTF-8 讀取原始碼進行審查、除錯、改寫、翻譯"
              ],
              [
                "設定檔",
                "YML、YAML、TOML、JSON、JSONC、INI、CONF、CFG、PROPERTIES、ENV、LOCK、PROTO 等",
                "AI 解讀並協助修改設定"
              ],
              [
                "Log / Diff",
                "LOG、OUT、DIFF、PATCH",
                "協助分析錯誤 log、Code Review diff"
              ],
              [
                "Jupyter Notebook",
                "IPYNB",
                "僅讀取 cell 原始碼，自動跳過輸出的 base64 圖片/大型輸出"
              ],
              [
                "無副檔名特殊檔",
                "Dockerfile、Makefile、Jenkinsfile、Gemfile、Pipfile、Vagrantfile、Caddyfile、Brewfile、BUILD、WORKSPACE、.gitignore、.env.local、.eslintrc 等",
                "常見的 build／dev config，可直接上傳"
              ]
            ]
          },
          {
            "type": "note",
            "text": "**禁止上傳**：影片檔（.mp4/.avi/.mov 等）、執行檔（.exe/.dll/.so/.msi/.dmg/.apk/.ipa 等）、私鑰憑證（.pem/.key/.p12/.pfx/.keystore/.jks）、壓縮檔（.zip/.rar/.7z/.tar/.gz/.bz2/.xz）。若需分享壓縮內容，請先解壓後再上傳個別檔案。"
          },
          {
            "type": "tip",
            "text": "上傳 `.env`、`.env.local`、`.env.production` 等環境變數檔時，系統會跳出確認視窗提醒您確認檔案不含 API key／密碼／連線字串等機敏資訊，再送出 AI 分析。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "大小限制",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "類型",
              "單檔上限",
              "備註"
            ],
            "rows": [
              [
                "文件（PDF/Word/Excel/PPTX/TXT/CSV 等）",
                "依管理員設定（預設約 10MB）",
                "可請管理員提高上限"
              ],
              [
                "圖片",
                "依管理員設定（預設約 10MB）",
                ""
              ],
              [
                "音訊",
                "依管理員設定（預設約 50MB）",
                "需管理員授權音訊上傳"
              ],
              [
                "程式碼／設定／Log／Jupyter",
                "**最多 5MB**（hard limit）",
                "避免塞爆 AI context；超過請先裁切"
              ]
            ]
          },
          {
            "type": "note",
            "text": "上傳 >500KB 的程式碼／設定／log 檔時前端會顯示提示「將增加 token 用量」，不擋上傳但提醒您可先裁切重點段落。單一訊息最多可附加 10 個檔案（管理員可調整 CHAT_MAX_FILES_PER_MESSAGE）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "上傳方式",
        "blocks": [
          {
            "type": "list",
            "items": [
              "**點選迴紋針圖示** — 輸入框右側的迴紋針按鈕，點選後選擇本機檔案，可同時選取多個檔案",
              "**拖曳上傳** — 直接將檔案拖曳到頁面任何位置，頁面出現藍色框時放開即可",
              "**貼上圖片** — 複製圖片後在輸入框按 Ctrl + V"
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-voice-input",
    "sort_order": 7.5,
    "icon": "Mic",
    "icon_color": "text-blue-500",
    "last_modified": "2026-04-10",
    "title": "語音輸入（麥克風轉文字）",
    "sidebar_label": "語音輸入",
    "blocks": [
      {
        "type": "para",
        "text": "系統提供**兩種**語音轉文字方式，可將您講的話即時轉成文字插入到輸入框游標位置，省去打字："
      },
      {
        "type": "list",
        "items": [
          "**麥克風按鈕** — 出現在 AI 對話框、問題反饋的描述/留言區、快速開單浮動按鈕等主要輸入點。看到🎤圖示就可以點。",
          "**`Alt + M` 全域快捷鍵** — 任何頁面、任何輸入框都能用！包含教育訓練教材編輯器、課程描述、答案解析、學員筆記、結案說明、滿意度意見等所有打字的地方。"
        ]
      },
      {
        "type": "tip",
        "text": "快捷鍵 Alt+M 是專為「打字很多」的場景設計，例如教材開發者、客服處理工單回覆。一個熱鍵走遍全站，不用記每個欄位有沒有麥克風按鈕。"
      },
      {
        "type": "subsection",
        "title": "方式一：點麥克風按鈕",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點選輸入框旁的麥克風圖示",
                "desc": "首次使用瀏覽器會跳出權限請求，請點選「允許」"
              },
              {
                "title": "對著麥克風說話",
                "desc": "按鈕變紅色閃爍代表正在錄音，旁邊會顯示音量條與剩餘秒數"
              },
              {
                "title": "停止錄音的方式（任選其一）",
                "desc": "再點一次麥克風按鈕 / 按 Esc 鍵 / 等待倒數歸零自動停止"
              },
              {
                "title": "系統處理後將辨識結果插入到游標位置",
                "desc": "不會覆蓋既有文字，可繼續手動編輯"
              }
            ]
          },
          {
            "type": "tip",
            "text": "錄音時若同頁有多個麥克風按鈕，**只能同時錄一個**。切到別的輸入框點麥克風會自動停掉前一個。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "方式二：Alt + M 全域快捷鍵",
        "blocks": [
          {
            "type": "para",
            "text": "**最快速的方式**：打字打到一半想用講的時，直接按 `Alt + M`，無論在哪個頁面、哪個輸入框都能用。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "滑鼠先點進任何 textarea 或 input 輸入框",
                "desc": "先讓游標進入要輸入的位置（例如教材編輯器的「答案解析」欄位）"
              },
              {
                "title": "按下 Alt + M",
                "desc": "畫面右下角會浮出小錄音 UI（紅色麥克風 + 音量條 + 倒數秒數）"
              },
              {
                "title": "對著麥克風說話",
                "desc": "單次最長 180 秒，講多久都行"
              },
              {
                "title": "停止錄音（任選其一）",
                "desc": "再按一次 Alt + M / 按 Esc / 點 UI 上的 X / 倒數歸零自動停止"
              },
              {
                "title": "辨識結果自動插入到原本的游標位置",
                "desc": "不會覆蓋既有文字，可繼續打字或再用 Alt+M 接續講"
              }
            ]
          },
          {
            "type": "note",
            "text": "快捷鍵會作用在**目前焦點所在**的輸入框。如果按 Alt+M 時沒有任何輸入框被選中，系統會提示「請先點到輸入框」。"
          },
          {
            "type": "tip",
            "text": "教育訓練教材開發者推薦使用 Alt+M：投影片標題、答案解析、步驟說明、翻卡內容、提示框文字… 這些欄位都能用講的，比打字快 3-5 倍。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "兩種方式的差異",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "項目",
              "麥克風按鈕",
              "Alt + M 快捷鍵"
            ],
            "rows": [
              [
                "可用範圍",
                "只在主要輸入點（chat、feedback 等）",
                "全站任何 textarea / input"
              ],
              [
                "錄音上限",
                "Chat 60 秒 / Feedback 180 秒",
                "統一 180 秒"
              ],
              [
                "操作方式",
                "點按鈕",
                "鍵盤快捷鍵"
              ],
              [
                "UI 位置",
                "輸入框旁邊",
                "畫面右下角浮動 UI"
              ],
              [
                "適合對象",
                "新手、casual 使用",
                "進階使用者、教材開發者"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "即時辨識預覽（Chrome / Edge）",
        "blocks": [
          {
            "type": "para",
            "text": "使用 Chrome 或 Edge 瀏覽器時，系統會啟動**即時辨識**：邊講邊出字，文字即時顯示在輸入框下方的藍色預覽條，方便您一邊講一邊確認 AI 是否聽對。"
          },
          {
            "type": "note",
            "text": "即時辨識功能依賴 Google 語音服務。如果公司網路無法連線該服務，系統會自動切換到「後端轉錄」模式（說完後集中辨識），體驗略有延遲但結果一樣準確。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "支援的語言",
        "blocks": [
          {
            "type": "para",
            "text": "系統會依您介面語系自動選擇辨識語言："
          },
          {
            "type": "table",
            "headers": [
              "介面語系",
              "辨識語言",
              "建議"
            ],
            "rows": [
              [
                "繁體中文 (zh-TW)",
                "繁體中文",
                "可混用少量英文單字、專有名詞"
              ],
              [
                "English",
                "英文",
                "清晰發音準確度最佳"
              ],
              [
                "Tiếng Việt",
                "越南文",
                "建議標準發音"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "若您要錄不同語言的內容，請先到右上角切換介面語系再錄音。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "使用注意事項",
        "blocks": [
          {
            "type": "list",
            "items": [
              "**必須允許麥克風權限** — 第一次使用會跳出權限提示，若不小心拒絕，請到瀏覽器網址列左側的鎖頭圖示重新開啟麥克風權限",
              "**建議在安靜環境** — 背景噪音越低辨識率越高",
              "**錄音上限** — 麥克風按鈕：Chat 60 秒 / Feedback 180 秒；Alt+M 快捷鍵：統一 180 秒",
              "**插入位置** — 結果會插入到游標所在位置，可在錄音前先把游標移到想要的地方",
              "**錄音時切換頁面** — 離開頁面或重新整理會自動停止錄音並丟棄結果",
              "**Alt+M 不能用？** — 確認您**有先點到輸入框**讓游標進入；若仍無反應請洽 IT 部門檢查瀏覽器是否被擴充功能攔截快捷鍵"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "常見問題",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "問題",
              "原因 / 解法"
            ],
            "rows": [
              [
                "麥克風按鈕變灰色點不動",
                "麥克風權限被拒絕。請到瀏覽器網址列左側鎖頭圖示重新開啟權限後重新整理頁面。"
              ],
              [
                "看不到麥克風按鈕",
                "可能是系統管理員關閉了語音輸入功能。請洽 IT 部門。"
              ],
              [
                "辨識結果是空的",
                "可能音量太小、麥克風硬體有問題、或環境噪音過大。請檢查作業系統的麥克風裝置音量設定。"
              ],
              [
                "辨識文字錯誤率高",
                "請確認介面語系跟說的語言一致；說話時語速放慢、咬字清晰；遠離噪音來源。"
              ],
              [
                "出現「辨識失敗」訊息",
                "可能是 AI 服務暫時中斷或網路問題。等待數秒後重試；若持續失敗請洽系統管理員。"
              ],
              [
                "錄音中聽不到即時辨識文字",
                "您可能用 Safari 或內網環境（無法連 Google 語音服務），系統會走「後端轉錄」模式 — 需等錄音停止後才會出現完整辨識結果，這是正常行為。"
              ],
              [
                "Alt + M 按了沒反應",
                "請先用滑鼠點到一個 textarea 或 input 輸入框（讓游標進入），再按 Alt + M。系統需要知道要把辨識結果插到哪裡。"
              ],
              [
                "Alt + M 跳出「請先點到輸入框」",
                "同上 — 您按快捷鍵時，焦點不在任何可編輯的輸入框上。"
              ]
            ]
          }
        ]
      },
      {
        "type": "note",
        "text": "語音檔不會永久保存，轉錄完成後立即從伺服器刪除。轉錄使用的 token 數會記錄到您個人的用量統計（model 標記為 `gemini-flash-stt`）。"
      }
    ]
  },
  {
    "id": "u-history",
    "sort_order": 8,
    "icon": "History",
    "icon_color": "text-orange-500",
    "last_modified": "2026-04-01",
    "title": "對話歷史",
    "sidebar_label": "對話歷史",
    "blocks": [
      {
        "type": "para",
        "text": "所有對話均永久保存於伺服器端，與瀏覽器無關。左側邊欄依時間分組顯示歷史對話（今天、昨天、過去 7 天、更早）。"
      },
      {
        "type": "subsection",
        "title": "查看歷史",
        "blocks": [
          {
            "type": "para",
            "text": "點選左側邊欄任意一條對話標題，即可重新開啟該對話並查看完整的問答記錄。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "重新命名對話",
        "blocks": [
          {
            "type": "para",
            "text": "系統預設以 AI 自動生成的摘要作為對話標題，您可以隨時將其改為更易辨識的名稱："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "滑鼠移到左側邊欄的對話標題上",
                "desc": "右側出現鉛筆圖示（✏）"
              },
              {
                "title": "點選鉛筆圖示，標題變為可編輯輸入框"
              },
              {
                "title": "輸入新名稱，按 Enter 確認，或按 Esc 取消",
                "desc": "也可點選輸入框旁的確認勾選圖示（✓）儲存"
              }
            ]
          },
          {
            "type": "tip",
            "text": "系統支援多語言標題，修改時 AI 會同步翻譯成英文及越南文，方便切換語系後也能看到對應語言的標題。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "刪除對話",
        "blocks": [
          {
            "type": "para",
            "text": "滑鼠移到對話標題上，右側會出現垃圾桶圖示，點選即可刪除該對話。刪除後無法復原，請謹慎操作。"
          },
          {
            "type": "note",
            "text": "刪除僅影響您的對話列表視覺顯示，系統管理員的稽核日誌中仍會保留此對話記錄。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-share",
    "sort_order": 10,
    "icon": "Share2",
    "icon_color": "text-blue-500",
    "last_modified": "2026-04-01",
    "title": "分享對話",
    "sidebar_label": "分享對話",
    "blocks": [
      {
        "type": "para",
        "text": "Foxlink GPT to Cortex 提供類似 ChatGPT 的對話分享功能，您可以將任何一段完整的對話建立為唯讀快照，並把連結分享給同事。對方只需登入即可查看，也可以選擇「繼續這段對話」複製一份到自己的帳號接著使用。"
      },
      {
        "type": "subsection",
        "title": "建立分享連結",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟您想分享的對話",
                "desc": "從左側邊欄點選目標對話"
              },
              {
                "title": "點選頂部工具列的「分享」按鈕",
                "desc": "按鈕位於對話標題右側，AI 回覆中才會顯示"
              },
              {
                "title": "系統建立快照並顯示分享連結",
                "desc": "彈出視窗顯示完整 URL"
              },
              {
                "title": "點選「複製」按鈕",
                "desc": "複製連結後貼給同事即可"
              }
            ]
          },
          {
            "type": "note",
            "text": "分享連結建立後，原始對話的後續更改不會影響快照內容。快照是獨立的複本，兩者完全分離。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "查看分享內容",
        "blocks": [
          {
            "type": "para",
            "text": "收到分享連結的使用者點開後，需先登入系統（需有效帳號），然後可以查看完整的對話記錄。頁面頂部會顯示分享者名稱及建立時間。"
          },
          {
            "type": "comparison",
            "items": [
              {
                "title": "唯讀模式",
                "desc": "只能查看，無法修改或繼續對話，保護原始內容不被更動。",
                "borderColor": "slate"
              },
              {
                "title": "繼續對話（Fork）",
                "desc": "點選「在我的對話繼續」，系統建立一份您專屬的對話副本，可自由接續。",
                "borderColor": "blue"
              }
            ]
          },
          {
            "type": "tip",
            "text": "Fork（繼續對話）後會在您的對話歷史出現一筆標題為「[Fork] 原始標題」的新對話，不影響原分享快照。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "分享的圖片與檔案",
        "blocks": [
          {
            "type": "para",
            "text": "分享快照建立時，對話中所有使用者上傳的圖片及 AI 生成的圖片都會複製一份到快照中，與原始檔案完全獨立。查看者及 Fork 使用者看到的圖片都是各自獨立的複本，互不影響。"
          },
          {
            "type": "note",
            "text": "若分享對話中含有文件（PDF、Word 等），文件內容已在對話時送給 AI 分析，快照中保留的是文字紀錄，不含原始檔案本身。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-toolbar-toggles",
    "sort_order": 12,
    "icon": "Zap",
    "icon_color": "text-amber-500",
    "last_modified": "2026-04-18",
    "title": "頂端列功能開關",
    "sidebar_label": "頂端列功能開關",
    "blocks": [
      {
        "type": "para",
        "text": "對話頁面頂端工具列提供多個快速入口（技能、知識庫、API 連接器、MCP 工具、AI 戰情室），讓您按需求啟用或停用各項輔助功能。每個開關的狀態僅影響當前及後續的新訊息，不會回溯修改已完成的對話。"
      },
      {
        "type": "table",
        "headers": [
          "開關 / 按鈕",
          "圖示",
          "說明",
          "停用 / 隱藏時行為"
        ],
        "rows": [
          [
            "技能 (Skill)",
            "Sparkles ✦ 紫色",
            "啟用後，AI 回覆前會先查詢符合的技能 Prompt 並套用",
            "跳過技能注入，AI 以原始模型回答"
          ],
          [
            "知識庫",
            "Database 🗄️ 藍色",
            "啟用後，AI 回覆前會從已掛載的自建知識庫檢索相關段落",
            "不做知識庫檢索，直接回答"
          ],
          [
            "API 連接器",
            "Zap ⚡ 琥珀色",
            "啟用後，AI 可呼叫已掛載的 DIFY / REST API 與 ERP Procedure 工具；面板內分「DIFY / REST」與「ERP Procedure」兩區",
            "跳過所有 API 連接器呼叫"
          ],
          [
            "MCP 工具",
            "Globe 🌐 青色",
            "啟用後，AI 可呼叫已設定的 MCP 伺服器（搜尋、程式執行等）",
            "停用所有 MCP 工具呼叫"
          ],
          [
            "AI 戰情室快速入口",
            "BarChart3 📊 橘色",
            "點擊後彈出 AI 戰情室主題 / 查詢任務下拉選單，可直接跳入指定查詢頁面",
            "僅在有「使用 AI 戰情室」權限的帳號才顯示此按鈕"
          ]
        ]
      },
      {
        "type": "subsection",
        "title": "基本操作",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟任意對話後，查看頂部工具列",
                "desc": "工具列位於對話標題下方，包含各功能圖示按鈕"
              },
              {
                "title": "點選按鈕開啟選項面板",
                "desc": "技能、知識庫、API 連接器、MCP 四個按鈕會彈出下拉面板，可勾選要啟用的項目；按鈕上會顯示已勾選的數量"
              },
              {
                "title": "下次發送訊息即生效",
                "desc": "無需重新整理頁面，勾選狀態會記憶在瀏覽器 Session 中"
              }
            ]
          },
          {
            "type": "tip",
            "text": "若您只想進行純文字對話且不需要任何外部資料，建議清空所有勾選以降低延遲與 Token 消耗。若對話主題切換（如從「查 SOP」改為「寫程式」），也可即時調整勾選組合。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "面板內：排序、隱藏、摺疊",
        "blocks": [
          {
            "type": "para",
            "text": "技能、知識庫、API 連接器、MCP 四個下拉面板都支援「個人化排序 + 隱藏不常用項目」，讓常用工具留在最上方，雜訊項目收進摺疊區。所有設定會記憶在瀏覽器本機（localStorage），每個帳號/瀏覽器各自獨立。"
          },
          {
            "type": "table",
            "headers": [
              "功能",
              "操作方式",
              "效果"
            ],
            "rows": [
              [
                "上下拖曳排序",
                "滑鼠按住每列最左邊的「≡」握把（GripVertical 圖示），上下拖到目標位置放開",
                "該項目移到新位置，排序立即生效並寫入本機"
              ],
              [
                "隱藏項目",
                "將滑鼠移到該列 → 左側握把旁會出現藍色圓形「👁️‍🗨️ 關眼」按鈕，點擊即隱藏",
                "項目從主清單消失，轉移到面板底部「已隱藏 (N)」摺疊區"
              ],
              [
                "顯示已隱藏區",
                "面板底部的「▾ 已隱藏 (N)」列，點擊展開 / 收合",
                "展開後可看到所有被隱藏的項目（半透明顯示）"
              ],
              [
                "取消隱藏",
                "在「已隱藏」區中，點擊該列的藍色「👁️ 開眼」按鈕",
                "項目回到主清單，回復可勾選狀態"
              ],
              [
                "搜尋",
                "面板頂部搜尋框輸入關鍵字",
                "搜尋模式下不顯示拖曳握把，暫停排序以避免誤觸"
              ]
            ]
          },
          {
            "type": "note",
            "text": "隱藏的項目「不會」同步到伺服器或其他裝置，僅存在目前瀏覽器。清除瀏覽器資料（或換裝置）後，全部項目會重新顯示。"
          },
          {
            "type": "tip",
            "text": "ERP Procedure 每列末端有「?」按鈕，點擊可展開該 Procedure 的輸入/輸出參數說明、資料型別與 AI 提示（ai_hint），方便了解該工具的功能範圍。「🔒」圖示代表該參數不可由使用者覆寫（預設值由管理員鎖定）。"
          },
          {
            "type": "note",
            "text": "各面板僅在對應功能已設定的情況下才有項目可選：知識庫需管理員或您本人已建立；API 連接器需管理員已設定 DIFY / REST 或 ERP Procedure；MCP 需管理員已啟用 MCP 伺服器。若面板為空，下方會有「前往設定」連結（僅管理員可見）。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-tools",
    "sort_order": 13,
    "icon": "Terminal",
    "icon_color": "text-cyan-500",
    "last_modified": "2026-04-02",
    "title": "可用工具",
    "sidebar_label": "可用工具",
    "blocks": [
      {
        "type": "para",
        "text": "Foxlink GPT to Cortex 支援多種工具擴展能力，讓 AI 在對話中自動取用企業內部資料、知識庫及技能。您可以透過對話頂部工具列的各功能開關，明確指定要使用哪些工具；也可以讓系統根據訊息內容自動判斷（TAG 路由機制）。"
      },
      {
        "type": "subsection",
        "title": "工具類型說明",
        "blocks": [
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "emoji": "🔌",
                "title": "MCP 工具",
                "tag": {
                  "color": "blue",
                  "text": "即時外部查詢"
                },
                "desc": "連接外部系統的即時查詢工具，例如 ERP 資料庫查詢、Oracle 程式搜尋等。AI 在判斷需要時自動呼叫，無需手動觸發。",
                "borderColor": "cyan"
              },
              {
                "emoji": "📚",
                "title": "API 連接器",
                "tag": {
                  "color": "orange",
                  "text": "企業文件庫"
                },
                "desc": "由 API 連接器管理的企業內部文件知識庫，例如產品規格、SOP 手冊。對話時自動查詢，找到相關段落則注入給 AI 作為回答依據。",
                "borderColor": "yellow"
              },
              {
                "emoji": "🗄️",
                "title": "自建知識庫",
                "tag": {
                  "color": "green",
                  "text": "向量語意搜尋"
                },
                "desc": "由您或同事在「知識庫市集」中建立並上傳文件的向量化知識庫。支援 PDF、Word、Excel、PPTX 等格式，語意搜尋精度高。可在對話頂部的「知識庫」按鈕中選擇要掛載哪幾個知識庫。",
                "borderColor": "teal"
              },
              {
                "emoji": "✨",
                "title": "技能（Skill）",
                "tag": {
                  "color": "purple",
                  "text": "角色與自動化"
                },
                "desc": "掛載技能後，AI 會自動套用對應的 System Prompt、外部 API 或工作流程。例如「翻譯技能」讓 AI 固定以指定語言回覆，「ERP 查詢技能」自動整合資料庫資料。可在技能市集瀏覽並掛載到對話。",
                "borderColor": "purple"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "如何選擇要使用的工具",
        "blocks": [
          {
            "type": "para",
            "text": "對話頂部工具列提供四個開關，可明確控制每類工具的啟用狀態："
          },
          {
            "type": "table",
            "headers": [
              "開關",
              "說明",
              "啟用（亮色）",
              "停用（灰色）"
            ],
            "rows": [
              [
                "✦ 技能",
                "頂部紫色 Badge 圖示",
                "自動套用掛載的技能",
                "跳過技能注入"
              ],
              [
                "🗄️ 知識庫",
                "資料庫圖示",
                "從已掛載的自建知識庫檢索",
                "不做向量檢索"
              ],
              [
                "⚡ API",
                "閃電圖示",
                "從已掛載的 API 連接器查詢",
                "跳過 API 查詢"
              ],
              [
                "🌐 MCP",
                "地球圖示",
                "允許 AI 呼叫 MCP 伺服器工具",
                "停用所有 MCP 呼叫"
              ]
            ]
          },
          {
            "type": "para",
            "text": "此外，您也可以點選各開關圖示旁的下拉箭頭，**明確指定**要使用哪幾個知識庫 / MCP 伺服器 / API 連接器，而非讓系統自動選擇全部。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "兩種工具啟用模式",
        "blocks": [
          {
            "type": "comparison",
            "items": [
              {
                "title": "模式 A：明確指定（Explicit）",
                "desc": "在工具列下拉選單**具體勾選**特定知識庫 / MCP 伺服器時啟用。\n系統**直接使用所選工具，跳過所有自動路由與 intent 判斷**，效率最高。",
                "example": "例：勾選「自建 KB 工具列」→ 選「HR 制度知識庫」",
                "borderColor": "blue"
              },
              {
                "title": "模式 B：自動路由（Auto）",
                "desc": "工具列**開關開啟但未具體選擇**，或**全部關閉**時啟用。\n系統依訊息內容智慧決定要呼叫哪些工具（TAG 路由機制，見下方）。",
                "example": "例：知識庫開關開啟 → 未勾選具體 KB → 系統自動比對",
                "borderColor": "slate"
              }
            ]
          },
          {
            "type": "note",
            "text": "空陣列（全部取消勾選）等同「未選」，系統會切換回自動路由，不會跳過工具。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "自動路由完整流程（Auto 模式）",
        "blocks": [
          {
            "type": "para",
            "text": "每次送出訊息時，系統依以下步驟決定傳哪些工具給 AI："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "依存取權限載入可用工具",
                "desc": "MCP 依 mcp_access 授權、API 連接器依 api_access 授權、自建 KB 依 creator/公開/kb_access 授權 — 只載入您有權使用的工具"
              },
              {
                "title": "套用技能（Skill）約束",
                "desc": "若 session 有掛載技能，技能可強制限制工具清單（見下方「技能對工具的影響」）"
              },
              {
                "title": "TAG 自動路由（有任何工具設定 Tags 時）",
                "desc": "Flash LLM 提取訊息意圖標籤 → 與工具 Tags 比對 → 再以 LLM 依描述精篩"
              },
              {
                "title": "Fallback（所有工具均無 Tags 時）",
                "desc": "Flash LLM 直接閱讀全部工具的描述文字做分類，效率較低、準確性較差"
              },
              {
                "title": "Gemini Function Calling 最終決策",
                "desc": "篩選後的工具以 function declarations 傳給 LLM，由 AI 根據對話上下文決定實際要呼叫哪個"
              }
            ]
          },
          {
            "type": "code",
            "text": "使用者訊息\n    │\n    ▼\n[Step 1] 依授權載入可用工具（MCP / API 連接器 / 自建 KB）\n    │\n    ▼\n[Step 2] 技能約束（disable / exclusive / append）\n    │\n    ├─ 有任何工具設定了 Tags？\n    │        ▼ YES\n    │  [Step 3a] Flash 提取意圖標籤（0~5 個）\n    │        ▼\n    │  TAG 比對（雙向模糊）\n    │        ▼\n    │  有匹配候選 → Flash 描述精篩 → 選中工具\n    │  無匹配候選 → Flash 對全部工具描述分類\n    │\n    └─ NO（全部無 Tags）\n       [Step 4] Flash 對全部工具描述分類（Fallback）\n    │\n    ▼\n[Step 5] 送給 Gemini → LLM 決定呼叫哪個工具\n    │\n    ▼\n執行工具 → 結果注入 prompt → AI 回覆"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "TAG 路由的判斷規則",
        "blocks": [
          {
            "type": "para",
            "text": "系統使用 Gemini Flash 作為「意圖分類器」（不是回答問題），進行兩個階段的判斷："
          },
          {
            "type": "list",
            "items": [
              "**第一階段：TAG 比對（雙向模糊）** — Flash 從訊息中提取 0~5 個主題標籤（如 `「人資」「請假」「HR」`），再與工具 Tags 做雙向部分比對：\n✓ `「人資」` 比對工具 Tag `「HR人資管理」` → 命中\n✗ `「庫存」` 比對工具 Tag `「人資」` → 不命中",
              "**第二階段：描述精篩（Flash 判斷）** — 對 TAG 比對命中的候選工具，Flash 再讀工具的「說明描述」做更嚴格的判斷，規則：\n• 核心意圖必須**完全符合**工具說明範疇才選用\n• 跟進前一輪 AI 問題的回覆，會參考最近 4 則對話上下文繼續使用同工具\n• 一般聊天、寫作、摘要等不需工具的問題 → 一律不選任何工具\n• 不確定時，不選用（寧可不呼叫，避免雜訊）"
            ]
          },
          {
            "type": "comparison",
            "items": [
              {
                "title": "✅ 有 Tags → 精準高效",
                "desc": "先縮小候選範圍再精篩，LLM 只需判斷少量工具，準確性高、消耗 Token 少。",
                "borderColor": "green"
              },
              {
                "title": "⚠️ 無 Tags → Fallback 效果較差",
                "desc": "Flash 需要閱讀全部工具描述做分類，工具數量多時效果下降，也多消耗 Token。建議管理員為每個工具設定 Tags。",
                "borderColor": "orange"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "技能（Skill）對工具的影響",
        "blocks": [
          {
            "type": "para",
            "text": "掛載技能後，技能可以約束 Auto 模式下的工具範圍。技能設定分三種模式："
          },
          {
            "type": "table",
            "headers": [
              "模式",
              "MCP 工具行為",
              "KB 工具行為"
            ],
            "rows": [
              [
                "disable",
                "移除全部 MCP 工具，AI 無法呼叫任何 MCP",
                "移除全部 API 連接器 + 自建 KB，不做知識庫查詢"
              ],
              [
                "exclusive（排他）",
                "只保留技能指定的 MCP 伺服器，其他全移除",
                "只保留技能指定的 KB，其他全移除"
              ],
              [
                "append（附加）",
                "在使用者有存取權的 MCP 之外，強制額外加入技能指定的伺服器",
                "強制加入技能指定的 KB（即使使用者原本沒有存取權）"
              ]
            ]
          },
          {
            "type": "note",
            "text": "Code 技能（程式執行工具）永遠附加到工具清單，不受以上模式影響。\n明確指定模式（Explicit）下，disable 規則仍然生效作為安全防護。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "特殊快速路徑（Fast Path）",
        "blocks": [
          {
            "type": "para",
            "text": "以下情況系統會走優化路徑，跳過 Gemini Function Calling，提升回應速度："
          },
          {
            "type": "table",
            "headers": [
              "條件",
              "行為",
              "優點"
            ],
            "rows": [
              [
                "只選中 API 連接器（無 MCP）",
                "並行查詢全部選中的 API 連接器 → 結果直接注入 prompt → AI 整合回覆",
                "省略 function calling 往返，速度更快"
              ],
              [
                "只選中自建 KB（無 MCP）",
                "並行向量檢索全部選中的自建 KB → 結果注入 prompt",
                "同上"
              ],
              [
                "混合模式（MCP + KB）",
                "走 Gemini 原生 function calling，AI 自行決定呼叫哪些工具、呼叫幾次",
                "靈活性高，可多輪工具調用"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "情境對照表",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "您的操作",
              "系統行為",
              "工具覆蓋範圍"
            ],
            "rows": [
              [
                "全部開關關閉",
                "Auto 模式：TAG 路由對全部可用工具",
                "依授權範圍內所有工具"
              ],
              [
                "開關開啟，未具體勾選",
                "Auto 模式：TAG 路由（只看開啟的類別）",
                "該類別的授權工具"
              ],
              [
                "下拉勾選具體工具",
                "Explicit 模式：直接使用選中工具",
                "只有您勾選的那幾個"
              ],
              [
                "掛載技能（disable）",
                "Auto 模式，但 Skill disable 先移除對應類別",
                "受技能限制"
              ],
              [
                "掛載技能（exclusive）",
                "Auto 模式，但只保留技能指定工具",
                "技能指定的工具"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "最精確的方式：下拉選單明確勾選目標工具 + 關閉不需要的類別開關。最省力的方式：所有工具設定好 Tags，讓系統 TAG 路由自動判斷。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "使用範例",
        "blocks": [
          {
            "type": "list",
            "items": [
              "**MCP 工具（ERP 查詢）**\n• 「搜尋 WIP 相關的 Oracle 程式有哪些？」\n• 「FL_MOA_B2_WIP_DETAIL_P 這支程式是誰寫的？」\n• 「查 WIP_DISCRETE_JOBS 這張資料表被哪些程式使用？」",
              "**自建知識庫 / API 連接器（文件查詢）**\n• 「FL-X100 連接器的最大電流規格是多少？」\n• 「查詢產品 BOM 結構中 PN12345 的規格」\n• 「生產 SOP 中關於焊接溫度的規定是什麼？」"
            ]
          },
          {
            "type": "tip",
            "text": "若沒有看到工具相關選項，表示管理員尚未設定或開放相關功能，可洽 IT 部門申請。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-skill",
    "sort_order": 14,
    "icon": "Sparkles",
    "icon_color": "text-purple-500",
    "last_modified": "2026-04-15",
    "title": "技能 Skill",
    "sidebar_label": "技能 Skill",
    "blocks": [
      {
        "type": "para",
        "text": "技能（Skill）是可以掌載到對話的自訂模組，能讓 AI 具備特定領域的專業知識、固定指令或對接外部服務的能力。例如，掛載「專業術語翻譯」技能後，每次對話 AI 會自動以該行業的標準用語進行翻譯。"
      },
      {
        "type": "subsection",
        "title": "技能類型",
        "blocks": [
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "emoji": "🧠",
                "title": "內建 Prompt 技能",
                "desc": "透過 System Prompt 給 AI 加上角色設定或指引。不需要外部服務，建立簡單。適合：翻譯腔調、行業專家、內部 SOP 助手等。",
                "borderColor": "blue"
              },
              {
                "emoji": "🌐",
                "title": "外部 Endpoint 技能",
                "desc": "呼叫外部 API，取得即時資料再供給 AI。適合：時刻查詢、即時庫存、外部知識庫對接等。",
                "borderColor": "purple"
              },
              {
                "emoji": "",
                "title": "內部程式技能（Code）",
                "desc": "在平台內直接撰寫 Node.js 程式碼，以獨立子程序運行。適合：即時股價查詢、ERP 資料對接、自動計算等需要程式邏輯的場景。需要管理員授予「允許程式技能」權限。",
                "borderColor": "emerald"
              },
              {
                "emoji": "",
                "title": "工作流程技能（Workflow）",
                "desc": "以 DAG（有向無環圖）視覺化編排多步驟流程，串接 LLM、知識庫、MCP 工具、HTTP 請求、條件判斷等節點。適合：多步驟審核流程、資料管線、複雜 AI Agent 等場景。",
                "borderColor": "orange"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "端點模式（外部 / 程式技能適用）",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "模式",
              "行為說明"
            ],
            "rows": [
              [
                "inject（注入）",
                "Skill 執行後，將回傳的資料注入 AI 的 System Prompt，AI 再根據這份資料回答。AI 仍擁有思考空間，適合「提供背景資訊」的場景（如即時股價、庫存數據）。"
              ],
              [
                "answer（直接回答）",
                "Skill 執行結果直接作為最終回覆，完全略過 AI。適合需要精準固定格式輸出的場景。"
              ],
              [
                "post_answer（後處理）",
                "AI 先正常回答使用者，回答完成後才呼叫此技能做後處理。適合不影響主要對話但需要額外動作的場景，例如語音合成（TTS）、自動寫入外部系統、產生報表檔案等。"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "inject 模式：若使用者訊息中沒有觸發條件（如找不到股票代號），Skill 可回傳空 system_prompt，AI 會正常以 Google 搜尋或自身知識回答。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "如何將技能掛載到對話",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "前往左側邊欄的「技能市集」",
                "desc": "個人技能與公開技能均可在此瀏覽"
              },
              {
                "title": "點選技能卡片右下角的「💬」(在對話中使用)",
                "desc": "系統自動建立新對話並掛載此技能"
              },
              {
                "title": "或開啟對話後，點選頂部工具列的「✨ 技能」按鈕",
                "desc": "選擇要掛載的技能後點「確認掛載」"
              },
              {
                "title": "頂部工具列出現紫色 Badge 確認掛載成功",
                "desc": "此對話之後每次發訊都會自動套用此技能"
              }
            ]
          },
          {
            "type": "tip",
            "text": "可以對同一個對話掛載多個技能，效果會叠加。再次點「技能」按鈕即可修改或移除已掛載的技能。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "建立技能",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "進入技能市集，點選「建立技能」"
              },
              {
                "title": "填寫名稱、說明、選擇圖示與技能類型（內建 Prompt / 外部 / Code / Workflow）"
              },
              {
                "title": "設定技能的 Tags（標籤）",
                "desc": "Tags 決定系統在何時自動啟用此技能。建議設定 2~5 個精準標籤，如「翻譯」「越南文」，讓 TAG 路由機制能正確匹配"
              },
              {
                "title": "完成設定後點「儲存」，技能預設為「私人」，僅自己可用"
              }
            ]
          },
          {
            "type": "note",
            "text": "技能同樣需要設定 Tags 才能透過 TAG 路由自動啟用。未設定 Tags 的技能只能在對話頂部手動選擇掛載。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "申請技能公開（需管理員審核）",
        "blocks": [
          {
            "type": "para",
            "text": "建立的技能預設為私人，只有您自己可以使用。若希望分享給全體同仁，需申請公開並通過管理員審核："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "在技能市集的「我的技能」區找到目標技能卡片"
              },
              {
                "title": "點選技能卡片右下角的「申請公開」按鈕（地球圖示）",
                "desc": "按鈕僅在技能狀態為「私人」且尚未申請時顯示"
              },
              {
                "title": "系統將申請送交管理員審核",
                "desc": "技能卡片狀態徽章變為橘色「待審核」"
              },
              {
                "title": "管理員在後台審核後批准或拒絕",
                "desc": "批准後技能狀態變為綠色「公開」，所有員工可在公開技能區看到"
              }
            ]
          },
          {
            "type": "list",
            "items": [
              "**私人** — 灰色徽章，僅自己可見與使用",
              "**待審核** — 橘色徽章，申請已送出，等待管理員批准",
              "**公開** — 綠色徽章，全員可在公開市集看到並使用或 Fork"
            ]
          },
          {
            "type": "tip",
            "text": "公開技能的其他員工可點選「Fork」複製一份到自己的帳號後自由修改，原始公開版本不受影響。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "個人分享技能給特定對象",
        "blocks": [
          {
            "type": "para",
            "text": "不想公開給全員、只想分享給特定同事？可在技能卡片選單點「分享」，選擇分享對象（使用者 / 角色 / 廠區 / 部門 / 利潤中心 / 事業處 / 事業群）後設定「使用」或「管理」權限，對方可在技能市集的「分享給我」區找到此技能。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "技能上的 MCP 工具模式",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "模式",
              "說明"
            ],
            "rows": [
              [
                "append（追加）",
                "在角色已授權的工具基礎上，加入技能指定的額外伺服器工具（預設）"
              ],
              [
                "exclusive（獨佔）",
                "僅限定使用技能指定的 MCP 伺服器，角色其他工具暫時停用"
              ],
              [
                "disable（停用）",
                "對話期間禁用全部 MCP 工具，適合純文字對話場景"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "知識庫綁定（KB Binding）",
        "blocks": [
          {
            "type": "para",
            "text": "技能可以綁定特定的自建知識庫與 API 連接器，讓掛載技能時自動啟用相關知識庫，無需使用者手動選取。"
          },
          {
            "type": "table",
            "headers": [
              "模式",
              "說明"
            ],
            "rows": [
              [
                "append（追加）",
                "技能綁定的知識庫與使用者已掛載的知識庫同時生效（預設）"
              ],
              [
                "exclusive（獨佔）",
                "僅使用技能綁定的知識庫，忽略使用者自行掛載的知識庫"
              ],
              [
                "disable（停用）",
                "對話期間不使用任何知識庫"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "知識庫綁定由技能建立者在編輯頁「工具與知識庫」頁籤中設定，使用者掛載技能後自動套用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "TAG 自動路由",
        "blocks": [
          {
            "type": "para",
            "text": "系統使用 TAG 標籤機制自動判斷每則訊息應啟用哪些工具、知識庫與技能，無需使用者手動勾選。每個 MCP 伺服器、API 連接器、自建知識庫及技能都可設定標籤（Tags），系統流程如下："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "使用者發送訊息",
                "desc": "系統以 Flash LLM 從訊息中萃取 0~5 個意圖標籤（intent tags）"
              },
              {
                "title": "TAG 比對",
                "desc": "將意圖標籤與所有工具/知識庫/技能上的標籤進行雙向模糊比對"
              },
              {
                "title": "描述精篩（Description Refinement）",
                "desc": "若 TAG 比對命中過多候選項，再以 Flash LLM 根據工具描述做二次精篩"
              },
              {
                "title": "Fallback",
                "desc": "若未設定任何 TAG 或比對全部落空，則回退到傳統的 intent 過濾機制"
              }
            ]
          },
          {
            "type": "tip",
            "text": "建議為每個工具和知識庫設定 2~5 個精準的標籤（如「股票」「財報」「ERP」），讓系統能更準確地自動路由，減少不必要的工具呼叫，節省 Token 費用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Prompt 輸入變數（prompt_variables）",
        "blocks": [
          {
            "type": "para",
            "text": "技能可以定義輸入變數，讓使用者在掛載技能到對話時填寫自訂參數，這些參數會自動注入到 System Prompt 中。例如，翻譯技能可設定「目標語言」變數，掛載時讓使用者選擇「日文」或「韓文」。"
          },
          {
            "type": "para",
            "text": "輸入變數的定義格式為 **JSON 陣列**，在技能編輯器的「輸入/輸出」頁籤中設定。每個變數是一個物件，包含以下屬性："
          },
          {
            "type": "table",
            "headers": [
              "屬性",
              "必填",
              "說明"
            ],
            "rows": [
              [
                "name",
                "✅",
                "變數識別名稱（英文），用於 System Prompt 中的 {{name}} 對應替換"
              ],
              [
                "label",
                "❌",
                "顯示在表單上的中文標籤，未設定時以 name 代替"
              ],
              [
                "type",
                "✅",
                "輸入元件類型（見下方類型表）"
              ],
              [
                "required",
                "❌",
                "是否為必填，設為 true 時表單欄位旁顯示紅色星號"
              ],
              [
                "options",
                "❌",
                "type 為 select 時的選項陣列，如 [\"選項A\", \"選項B\"]"
              ],
              [
                "default",
                "❌",
                "預設值，使用者未填寫時自動帶入"
              ],
              [
                "placeholder",
                "❌",
                "輸入框的提示文字（浮水印）"
              ]
            ]
          },
          {
            "type": "table",
            "headers": [
              "type 值",
              "表單元件",
              "適用場景"
            ],
            "rows": [
              [
                "text",
                "單行文字輸入框",
                "名稱、關鍵字等短文字"
              ],
              [
                "textarea",
                "多行文字區域（20 行高）",
                "長段描述、背景資料、條件說明"
              ],
              [
                "select",
                "下拉選單",
                "固定選項，需搭配 options 屬性"
              ],
              [
                "number",
                "數字輸入框",
                "數量、分數、金額等數值"
              ],
              [
                "date",
                "日期選擇器",
                "起始日、截止日"
              ],
              [
                "date_range",
                "日期區間選擇器",
                "報表期間、統計區間"
              ],
              [
                "checkbox",
                "布林值勾選框",
                "開關型設定（是/否）"
              ]
            ]
          },
          {
            "type": "para",
            "text": "**完整範例 — 會議紀錄生成器技能：**"
          },
          {
            "type": "code",
            "text": "[\n  {\n    \"name\": \"meeting_title\",\n    \"label\": \"會議名稱\",\n    \"type\": \"text\",\n    \"required\": true,\n    \"placeholder\": \"例如：Q2 產品規劃會議\"\n  },\n  {\n    \"name\": \"participants\",\n    \"label\": \"與會人員\",\n    \"type\": \"textarea\",\n    \"placeholder\": \"每行一位，含職稱\"\n  },\n  {\n    \"name\": \"output_lang\",\n    \"label\": \"輸出語言\",\n    \"type\": \"select\",\n    \"options\": [\"繁體中文\", \"English\", \"日本語\"],\n    \"default\": \"繁體中文\",\n    \"required\": true\n  },\n  {\n    \"name\": \"meeting_date\",\n    \"label\": \"會議日期\",\n    \"type\": \"date\"\n  },\n  {\n    \"name\": \"include_action_items\",\n    \"label\": \"包含待辦事項\",\n    \"type\": \"checkbox\",\n    \"default\": true\n  }\n]"
          },
          {
            "type": "para",
            "text": "在 System Prompt 中使用 **{{變數名稱}}** 語法引用變數值，例如："
          },
          {
            "type": "code",
            "text": "你是專業的會議記錄員。\n會議名稱：{{meeting_title}}\n會議日期：{{meeting_date}}\n與會人員：\n{{participants}}\n\n請根據使用者提供的會議內容整理出結構化的會議紀錄。\n輸出語言：{{output_lang}}\n是否列出待辦事項：{{include_action_items}}"
          },
          {
            "type": "note",
            "text": "變數值是 **對話（Session）級別** 的，同一個對話中技能變數只填一次，之後每次發訊息都會沿用相同的值。若需更改，可重新選擇技能觸發填寫視窗。Workflow 類型技能也可使用 {{var.變數名稱}} 語法在節點中引用變數。"
          },
          {
            "type": "tip",
            "text": "掛載技能時若該技能定義了輸入變數，系統會自動彈出表單讓使用者填寫。若所有變數都有 default 值，使用者可直接確認不需逐一填寫。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Tool Schema — Code / 外部技能自動註冊為 Gemini Tool",
        "blocks": [
          {
            "type": "para",
            "text": "Code 與外部（External）類型的技能可以在「輸入/輸出」頁籤定義 **Tool Schema**（Gemini Function Declaration），讓 AI 在對話中自動判斷是否需要呼叫該技能，而非每次都觸發。這等同於 Gemini 的 Function Calling 機制。"
          },
          {
            "type": "para",
            "text": "例如，一個「股價查詢」Code 技能定義了 Tool Schema，AI 收到「台積電股價多少」時會自動呼叫，但收到「今天天氣如何」則不會觸發。"
          },
          {
            "type": "para",
            "text": "Tool Schema 格式為 **JSON 物件**，包含技能的描述及參數定義："
          },
          {
            "type": "code",
            "text": "{\n  \"description\": \"查詢指定員工的出勤紀錄，回傳遲到、早退、請假等統計\",\n  \"parameters\": {\n    \"type\": \"object\",\n    \"properties\": {\n      \"employee_id\": {\n        \"type\": \"string\",\n        \"description\": \"員工工號\"\n      },\n      \"month\": {\n        \"type\": \"string\",\n        \"description\": \"查詢月份，格式 YYYY-MM\"\n      }\n    },\n    \"required\": [\"employee_id\"]\n  }\n}"
          },
          {
            "type": "list",
            "items": [
              "**description**：AI 用來判斷何時該呼叫此技能的依據，寫得越精準，AI 判斷越準確",
              "**parameters**：遵循 JSON Schema 格式，定義技能接受的輸入參數",
              "**required**：指定哪些參數是必要的，AI 呼叫時一定會提供"
            ]
          },
          {
            "type": "note",
            "text": "未定義 Tool Schema 的 Code / 外部技能仍按原有的 inject / answer / post_answer 端點模式運作，不受影響。有定義 Tool Schema 時，AI 會自行決定是否呼叫，無需每次都觸發。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Output Schema（輸出結構定義）",
        "blocks": [
          {
            "type": "para",
            "text": "技能可以在「輸入/輸出」頁籤定義 **Output Schema**（JSON Schema 格式），指引 AI 以固定的 JSON 結構回覆。適合需要結構化資料的場景，如自動產生工單、匯出報表欄位、與下游系統對接等。"
          },
          {
            "type": "para",
            "text": "**運作方式**：系統會將 Output Schema 以文字指令注入到 AI 的 System Prompt 中，告知 AI「請嚴格按照以下 JSON Schema 格式回答」。這是一種**軟約束** — AI 會盡量遵守，但不保證 100% 完全符合。"
          },
          {
            "type": "para",
            "text": "**範例 — 產品品質檢核報告：**"
          },
          {
            "type": "code",
            "text": "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"product_name\": {\n      \"type\": \"string\",\n      \"description\": \"產品名稱\"\n    },\n    \"inspection_result\": {\n      \"type\": \"string\",\n      \"enum\": [\"PASS\", \"FAIL\", \"CONDITIONAL\"],\n      \"description\": \"檢驗結果\"\n    },\n    \"defects\": {\n      \"type\": \"array\",\n      \"description\": \"發現的缺陷列表\",\n      \"items\": {\n        \"type\": \"object\",\n        \"properties\": {\n          \"category\": { \"type\": \"string\", \"description\": \"缺陷類別\" },\n          \"severity\": { \"type\": \"string\", \"enum\": [\"critical\", \"major\", \"minor\"] },\n          \"description\": { \"type\": \"string\", \"description\": \"缺陷描述\" }\n        }\n      }\n    },\n    \"score\": {\n      \"type\": \"number\",\n      \"description\": \"品質評分 0-100\"\n    },\n    \"recommendations\": {\n      \"type\": \"array\",\n      \"items\": { \"type\": \"string\" },\n      \"description\": \"改善建議\"\n    }\n  }\n}"
          },
          {
            "type": "para",
            "text": "AI 收到使用者訊息後，會根據此 Schema 回覆結構化的 JSON，例如："
          },
          {
            "type": "code",
            "text": "{\n  \"product_name\": \"FX-200 連接器\",\n  \"inspection_result\": \"CONDITIONAL\",\n  \"defects\": [\n    {\n      \"category\": \"外觀\",\n      \"severity\": \"minor\",\n      \"description\": \"端子表面有輕微刮痕\"\n    }\n  ],\n  \"score\": 82,\n  \"recommendations\": [\n    \"建議調整衝壓模具間隙\",\n    \"加強來料端子外觀抽檢\"\n  ]\n}"
          },
          {
            "type": "list",
            "items": [
              "**type**：定義資料型態（object、array、string、number、boolean）",
              "**properties**：物件的子欄位定義，每個欄位可設定 type 和 description",
              "**enum**：限制欄位只能使用指定的值（如 \"PASS\"、\"FAIL\"）",
              "**items**：陣列中每個元素的結構定義",
              "**description**：欄位說明，幫助 AI 理解該欄位應填入什麼內容"
            ]
          },
          {
            "type": "tip",
            "text": "Output Schema 搭配「輸出範本」使用效果更佳 — AI 先按 Schema 輸出 JSON，系統再自動套用文件範本產生 PPTX / DOCX / PDF 等檔案。"
          },
          {
            "type": "note",
            "text": "Output Schema 為軟約束，AI 會盡力遵守但不保證格式完全正確。若對格式精確度要求極高，建議搭配 Code 技能做後處理驗證。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "輸出範本綁定（Output Template）",
        "blocks": [
          {
            "type": "para",
            "text": "技能可以在「輸入/輸出」頁籤綁定一個**文件範本**，讓 AI 的回覆自動套用範本產生 PPTX / DOCX / PDF / XLSX 等檔案。適合需要固定格式輸出的場景，如檢驗報告、會議紀錄、訓練教材等。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "先建立文件範本",
                "desc": "在「文件範本」功能中定義範本結構與欄位"
              },
              {
                "title": "編輯技能 →「輸入/輸出」頁籤",
                "desc": "在「輸出範本」欄位點選選取對應的範本"
              },
              {
                "title": "（建議）同時設定 Output Schema",
                "desc": "讓 AI 輸出的 JSON 欄位與範本預期的欄位對齊，產生的檔案內容更準確"
              },
              {
                "title": "使用者對話時",
                "desc": "AI 回覆後系統自動將 JSON 套入範本，在聊天室產生可下載的檔案"
              }
            ]
          },
          {
            "type": "tip",
            "text": "輸出範本特別適合搭配 post_answer 端點模式的技能 — AI 先正常回答，後處理技能再產生報表檔案。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "進階設定",
        "blocks": [
          {
            "type": "para",
            "text": "在技能編輯器的「進階設定」頁籤可以配置以下選項："
          },
          {
            "type": "table",
            "headers": [
              "設定",
              "說明"
            ],
            "rows": [
              [
                "指定模型（Model）",
                "覆蓋預設對話模型。例如，需要高品質推理的技能可指定 Pro 模型，簡單文字處理的可指定 Flash 節省成本。留空則使用系統預設模型。"
              ],
              [
                "端點模式（Endpoint Mode）",
                "外部 / Code 技能的執行時機：inject（注入到 AI 前）、answer（直接回答）、post_answer（AI 回答後再執行）。詳見「端點模式」章節。"
              ],
              [
                "速率限制",
                "每人上限、全域上限、時間窗口。詳見「速率限制」章節。"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "速率限制（Rate Limiting）",
        "blocks": [
          {
            "type": "para",
            "text": "技能可設定使用頻率限制，防止濫用或控制 API 成本："
          },
          {
            "type": "table",
            "headers": [
              "設定",
              "說明"
            ],
            "rows": [
              [
                "每人上限",
                "單一使用者在指定時間窗口內可呼叫此技能的最大次數"
              ],
              [
                "全域上限",
                "所有使用者合計在指定時間窗口內的最大呼叫次數"
              ],
              [
                "時間窗口",
                "限制的計算週期：每分鐘（minute）、每小時（hour）、每日（day）"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "超過速率限制時，系統會回覆提示訊息，使用者需等待時間窗口重置後再使用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "版本控制與發佈",
        "blocks": [
          {
            "type": "para",
            "text": "技能的 Prompt 支援版本控制機制，讓您可以安全地修改和回滾："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "編輯草稿（Draft）",
                "desc": "修改 Prompt 時，改動先存入草稿，不影響目前線上版本"
              },
              {
                "title": "發佈（Publish）",
                "desc": "確認修改無誤後，點選「發佈新版本」，草稿變為正式版本，版本號 +1"
              },
              {
                "title": "查看歷史版本",
                "desc": "在「版本歷史」頁籤可瀏覽所有已發佈的版本內容"
              },
              {
                "title": "回滾（Rollback）",
                "desc": "若新版本有問題，可一鍵回滾到任一歷史版本"
              }
            ]
          },
          {
            "type": "note",
            "text": "版本控制僅追蹤 Prompt 與 Workflow 設定的變更，其他欄位（名稱、描述等）修改後即時生效。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Workflow 工作流程編排",
        "blocks": [
          {
            "type": "para",
            "text": "Workflow 類型技能使用視覺化拖拉編輯器（React Flow），以 DAG 方式編排多步驟 AI 流程。每個節點代表一個處理步驟，節點之間以連線定義執行順序。"
          },
          {
            "type": "table",
            "headers": [
              "節點類型",
              "說明"
            ],
            "rows": [
              [
                "🟢 開始（Start）",
                "流程入口，接收使用者輸入"
              ],
              [
                "🤖 LLM",
                "呼叫大語言模型處理文字，可設定 System Prompt 與模型"
              ],
              [
                "📚 知識庫（Knowledge Base）",
                "查詢自建知識庫，取得相關段落"
              ],
              [
                "🔌 API",
                "查詢 API 連接器"
              ],
              [
                "🔧 MCP 工具",
                "呼叫 MCP 伺服器的工具"
              ],
              [
                "✨ 技能（Skill）",
                "呼叫其他已建立的技能"
              ],
              [
                "💻 程式碼（Code）",
                "執行自訂 JavaScript 程式碼"
              ],
              [
                "🌐 HTTP 請求",
                "呼叫外部 REST API"
              ],
              [
                "❓ 條件判斷（Condition）",
                "根據前一步結果分支（contains / equals / gt / lt 等）"
              ],
              [
                "📝 模板（Template）",
                "使用模板語法組合多個節點的輸出"
              ],
              [
                "🔴 輸出（Output）",
                "流程終點，定義最終輸出內容"
              ]
            ]
          },
          {
            "type": "para",
            "text": "節點之間可使用 {{nodeId.output}} 語法引用其他節點的輸出，例如 {{start.input}} 取得使用者原始訊息，{{llm_1.output}} 取得 LLM 節點的回應。"
          },
          {
            "type": "tip",
            "text": "Workflow 最多允許 50 個節點，執行時以拓撲排序依序處理。條件節點支援 default（符合條件）與 else（不符合）兩條分支路徑。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Code 技能運作機制",
        "blocks": [
          {
            "type": "para",
            "text": "Code 類型技能在平台內以**獨立 Node.js 子程序**運作，每個技能擁有獨立的 Express 伺服器與連接埠（Port 40100–40999），與主程式完全隔離。"
          },
          {
            "type": "table",
            "headers": [
              "機制",
              "說明"
            ],
            "rows": [
              [
                "啟動",
                "儲存技能程式碼後手動啟動，系統自動安裝 NPM 套件、分配 Port、啟動子程序"
              ],
              [
                "狀態",
                "技能卡片即時顯示：🟢 running（運行中）、🔴 error（異常）、⚪ stopped（已停止）"
              ],
              [
                "熱更新",
                "系統每 30 秒健康檢查，若偵測到程式碼有變動（例如其他 Pod 修改），自動重新載入"
              ],
              [
                "NPM 套件",
                "在「NPM 套件」欄位加入需要的套件名稱（如 axios、lodash），系統會自動 npm install"
              ],
              [
                "日誌",
                "可在技能市集點選技能查看即時 Log 輸出（stdout / stderr / 啟動 / 健康檢查紀錄）"
              ]
            ]
          },
          {
            "type": "para",
            "text": "程式碼撰寫格式如下："
          },
          {
            "type": "code",
            "text": "async function handler(body) {\n  // body.user_message — 使用者訊息\n  // body.user_id     — 使用者 ID\n  // body.session_id  — 對話 Session ID\n  // body.args        — Tool Schema 呼叫時 AI 傳入的參數（JSON）\n\n  const result = await fetchSomeData(body.user_message);\n\n  return {\n    // inject 模式 → 回傳 system_prompt 注入 AI\n    system_prompt: `以下是查詢結果：${JSON.stringify(result)}`,\n    // 或 answer 模式 → 回傳 content 直接作為回覆\n    // content: `查詢結果：${result}`\n  };\n}"
          },
          {
            "type": "note",
            "text": "Code 技能需要管理員授予「允許程式技能」權限才能建立。程式碼在隔離的子程序中執行，無法存取主程式的資料庫連線或檔案系統。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "呼叫紀錄（Call Logs）",
        "blocks": [
          {
            "type": "para",
            "text": "每個技能會自動記錄最近 100 筆呼叫紀錄，方便技能擁有者追蹤使用狀況與除錯。在技能市集的技能詳情頁可查看。"
          },
          {
            "type": "table",
            "headers": [
              "欄位",
              "說明"
            ],
            "rows": [
              [
                "使用者",
                "呼叫此技能的使用者名稱"
              ],
              [
                "狀態",
                "🟢 OK（成功）或 🔴 Error（失敗）"
              ],
              [
                "耗時",
                "技能執行時間（毫秒）"
              ],
              [
                "查詢預覽",
                "使用者訊息的前段摘要"
              ],
              [
                "錯誤訊息",
                "失敗時的錯誤原因"
              ],
              [
                "時間",
                "呼叫時間戳記"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "呼叫紀錄僅技能擁有者和管理員可查看，一般使用者無法看到他人的使用紀錄。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "技能編輯器頁籤總覽",
        "blocks": [
          {
            "type": "para",
            "text": "編輯技能時，編輯器分為五個頁籤，各頁籤的功能如下："
          },
          {
            "type": "table",
            "headers": [
              "頁籤",
              "內容"
            ],
            "rows": [
              [
                "基本資訊",
                "名稱、說明、圖示、技能類型、Tags 標籤、System Prompt（內建類型）、端點 URL（外部類型）、程式碼（Code 類型）、工作流程編輯器（Workflow 類型）"
              ],
              [
                "工具綁定",
                "MCP 工具模式與伺服器選擇、自建知識庫綁定、API 連接器（Dify）綁定、知識庫模式"
              ],
              [
                "輸入/輸出",
                "Prompt 輸入變數（prompt_variables）定義、Tool Schema（Gemini Function Declaration）、Output Schema（輸出結構）、輸出範本綁定"
              ],
              [
                "進階設定",
                "指定模型覆蓋、端點模式（inject / answer / post_answer）、速率限制（每人 / 全域 / 時間窗口）"
              ],
              [
                "版本歷史",
                "發佈新版本、查看歷史版本清單、一鍵回滾到指定版本（僅編輯現有技能時顯示）"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-kb",
    "sort_order": 15,
    "icon": "Database",
    "icon_color": "text-teal-500",
    "last_modified": "2026-04-22",
    "title": "知識庫市集",
    "sidebar_label": "知識庫市集",
    "blocks": [
      {
        "type": "para",
        "text": "知識庫市集讓您可以將企業內部文件向量化，建立專屬的語意搜尋資料庫。對話時掛載知識庫，AI 會先從知識庫檢索最相關的段落，再結合自身能力回答，大幅提升對特定領域文件（如 SOP、技術手冊、規格書）的回答準確度。"
      },
      {
        "type": "subsection",
        "title": "前提條件",
        "blocks": [
          {
            "type": "para",
            "text": "需要系統管理員授予「允許建立知識庫」權限，以及設定容量與數量上限後，才會在側邊欄「更多功能」選單看到「知識庫市集」入口。"
          },
          {
            "type": "tip",
            "text": "若無建立權限，仍可使用管理員或其他人共享（permission = use）給您的知識庫進行對話，無需建立自己的知識庫。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "建立知識庫",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點選「知識庫市集」→「+ 建立知識庫」"
              },
              {
                "title": "填寫名稱、描述（必填名稱）",
                "desc": "建立後可在詳情頁頂部點選鉛筆圖示快速編輯名稱與描述"
              },
              {
                "title": "選擇分塊策略",
                "desc": "「常規分段」：依段落切分，適合一般文件；「父子分塊」：大塊作背景、小塊用來檢索，適合長篇技術文件"
              },
              {
                "title": "選擇檢索模式",
                "desc": "「向量檢索」：語意相似度；「全文檢索」：關鍵字比對；「混合檢索」：兩者結合（建議）"
              },
              {
                "title": "選擇 OCR 模型（選填）",
                "desc": "上傳文件時用來解析圖片/PDF 內圖片的 Gemini 模型，預設使用系統設定的 Flash 模型"
              },
              {
                "title": "確認 PDF OCR 模式（預設「自動」）",
                "desc": "「自動」= 每頁判斷：有文字層直接抽字（快）、沒文字層才 OCR（準）；多數情況維持預設即可。「強制」= 所有頁面都 OCR，最慢但最準"
              },
              {
                "title": "點選「建立」，進入知識庫詳情頁"
              }
            ]
          },
          {
            "type": "tip",
            "text": "**Embedding 維度已統一為 768**（v2 架構更新，建立表單不再顯示此選項）。所有知識庫使用相同維度以支援 Oracle 23 AI 的向量索引加速，對精度影響 < 2%。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "上傳文件",
        "blocks": [
          {
            "type": "para",
            "text": "進入知識庫後，點選「文件」頁籤，拖曳或點選上傳區域選擇檔案。支援格式：**PDF · DOCX/DOC · PPTX/PPT · XLSX/XLS · TXT · CSV · JPG · PNG · GIF · WEBP**（單檔最大 200 MB）。舊版 Office 97-2003 格式（.doc/.ppt/.xls）也支援，系統會自動解析。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "選取一或多個檔案上傳",
                "desc": "多檔會循序處理，避免同時佔用 AI 配額"
              },
              {
                "title": "系統自動解析文字並進行 Embedding 向量化",
                "desc": "圖片與 PDF 中的圖片會先 OCR 轉文字，再一起向量化"
              },
              {
                "title": "狀態變為綠色勾選代表處理完成",
                "desc": "若出現紅色 ✗ 請查看錯誤訊息，常見原因：檔案格式不符或 AI 服務暫時中斷"
              }
            ]
          },
          {
            "type": "note",
            "text": "大型文件（如含大量圖片的 DOCX）處理時間可能較長，頁面每隔幾秒會自動重新整理狀態，請耐心等待。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "在對話中使用知識庫",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟或新建一個對話"
              },
              {
                "title": "點選頂部工具列的「知識庫」按鈕（綠色）"
              },
              {
                "title": "在下拉選單中勾選一或多個要使用的知識庫，點「確認」"
              },
              {
                "title": "發送訊息，AI 會先檢索知識庫再組合回答",
                "desc": "回覆中如有引用文件段落，AI 通常會說明來源文件名稱"
              }
            ]
          },
          {
            "type": "tip",
            "text": "可以同時掛載「自建知識庫」＋「API 連接器」＋「MCP 工具」，AI 會綜合所有來源回答。此外，若知識庫設有標籤（Tags），系統會透過 TAG 自動路由機制，根據訊息內容自動判斷是否啟用對應知識庫。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "召回測試（檢索測試）",
        "blocks": [
          {
            "type": "para",
            "text": "進入知識庫詳情 → 點選「召回測試」頁籤，輸入任意問題，系統會模擬真實對話的檢索流程，顯示前幾名相關段落、相似度分數及比對方式（向量 / 全文 / 混合），幫助您調整設定參數。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "共享知識庫",
        "blocks": [
          {
            "type": "para",
            "text": "進入知識庫詳情 → 點選「共享設定」頁籤，可將知識庫共享給特定使用者、角色、廠區、部門、利潤中心、事業處或事業群。"
          },
          {
            "type": "table",
            "headers": [
              "共享方式",
              "對象"
            ],
            "rows": [
              [
                "使用者",
                "指定單一帳號"
              ],
              [
                "角色",
                "系統管理員定義的角色群組（如研發部）"
              ],
              [
                "廠區",
                "依 ERP 廠區代碼（FACTORY_CODE）共享，如 TCC、Z4E 等製造廠"
              ],
              [
                "部門",
                "依 ERP 組織同步的部門代碼"
              ],
              [
                "利潤中心",
                "依利潤中心共享"
              ],
              [
                "事業處",
                "依事業處（org_section）共享"
              ],
              [
                "事業群",
                "依事業群（org_group）共享"
              ]
            ]
          },
          {
            "type": "table",
            "headers": [
              "共享權限",
              "說明"
            ],
            "rows": [
              [
                "use（僅使用）",
                "被共享者可在對話中掛載此知識庫，但無法在知識庫市集列表中看到或進入設定頁"
              ],
              [
                "edit（可編輯）",
                "被共享者可在市集中看到並進入此知識庫，可上傳文件、修改設定"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "申請公開",
        "blocks": [
          {
            "type": "para",
            "text": "若希望全體員工都能看到並使用此知識庫，可在「共享設定」頁籤點選「申請設為公開」，送出申請後需等待系統管理員審核通過，審核後知識庫會對所有人開放（唯讀使用，不可編輯）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "分段與檢索設定調整",
        "blocks": [
          {
            "type": "para",
            "text": "進入知識庫詳情 → 點選「分塊與檢索設定」頁籤，可隨時調整以下參數（調整後不需重新上傳文件，下次對話立即生效）："
          },
          {
            "type": "table",
            "headers": [
              "參數",
              "說明",
              "建議值"
            ],
            "rows": [
              [
                "分段識別符號",
                "用來切分段落的符號",
                "\\n\\n（空白行）"
              ],
              [
                "分段最大長度",
                "每個 chunk 的字元上限",
                "512–1024"
              ],
              [
                "重疊長度",
                "前後 chunk 共享的字元數，避免重要資訊被截斷",
                "50–100"
              ],
              [
                "初始擷取 Top K",
                "向量/全文各抓幾條候選結果",
                "10–20"
              ],
              [
                "最終返回 Top K",
                "重排序後送給 AI 的最終條數",
                "3–5"
              ],
              [
                "Score 閾值",
                "相似度低於此值的結果會被丟棄（0–1）",
                "預設 0（不過濾）"
              ],
              [
                "OCR 模型",
                "處理圖片的 Gemini 模型",
                "Flash（快速省成本）"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "Score 閾值為什麼預設是 0？因為不同檢索模式（向量 / 全文 / 混合）與不同 embedding 模型的分數分布差異很大（向量通常 0.5–0.9、全文分數範圍不固定、混合為融合後再正規化），任何硬編碼預設值都可能誤殺合理結果；因此預設 0（全部保留），讓召回結果完整交給後續的重排序與 LLM 判斷。建議先用「召回測試」觀察您實際資料的分數分布，再決定是否調高（例如向量模式可試 0.3–0.5 過濾明顯不相關的內容）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "知識庫格式感知",
        "blocks": [
          {
            "type": "para",
            "text": "系統會根據上傳文件的格式自動選擇最佳的解析方式，確保內容被完整擷取並向量化。"
          },
          {
            "type": "table",
            "headers": [
              "格式",
              "解析方式",
              "備註"
            ],
            "rows": [
              [
                "PDF",
                "pdf-parse 文字層 + Gemini OCR（有圖片時）",
                "掃描件需 OCR，速度較慢"
              ],
              [
                "DOCX / PPTX",
                "JSZip 解壓縮 XML → 提取段落文字",
                "保留標題層級與段落結構"
              ],
              [
                "XLSX / CSV",
                "逐列讀取，保留欄標頭",
                "大型表格建議先分頁再上傳"
              ],
              [
                "TXT / MD",
                "直接讀取純文字",
                "保留換行結構"
              ],
              [
                "JPG / PNG / WEBP / GIF",
                "Gemini Vision OCR → 轉為文字 chunk",
                "圖片需設定 OCR 模型才會處理"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "含大量圖表的 PDF 或 PPTX，建議在知識庫設定中指定 OCR 模型（Flash 即可），系統會自動對圖片頁面進行視覺理解，再合併到同一文件的文字 chunk 中。"
          },
          {
            "type": "note",
            "text": "XLSX 中的公式只會保留計算結果值，不保留公式本身。若需讓 AI 理解公式邏輯，請先將說明另存為 TXT 或 MD 一起上傳。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "設定標籤（Tags）— 讓知識庫在對話中被自動啟用的關鍵",
        "blocks": [
          {
            "type": "note",
            "text": "**重要：必須為知識庫設定標籤（Tags），AI 才能在對話中透過 TAG 路由機制自動找到並使用它。**未設定標籤的知識庫只能在對話頂部手動勾選掛載，無法被系統自動匹配。"
          },
          {
            "type": "para",
            "text": "Tags 是讓系統「知道這個知識庫適合回答哪類問題」的關鍵線索。系統每次收到使用者訊息時，會先萃取訊息的意圖標籤，再比對所有知識庫的 Tags，命中的知識庫才會被自動啟用查詢。"
          },
          {
            "type": "para",
            "text": "如何設定 Tags："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "進入知識庫詳情頁 → 點選「設定」頁籤"
              },
              {
                "title": "找到「標籤（Tags）」欄位",
                "desc": "在知識庫名稱、描述下方"
              },
              {
                "title": "輸入標籤文字後按 Enter，可新增多個標籤",
                "desc": "例如：SOP、製程規範、品質手冊、產品規格"
              },
              {
                "title": "點「儲存設定」完成"
              }
            ]
          },
          {
            "type": "table",
            "headers": [
              "好的標籤（推薦）",
              "不好的標籤（避免）",
              "原因"
            ],
            "rows": [
              [
                "SOP",
                "文件",
                "太模糊，幾乎所有知識庫都符合"
              ],
              [
                "不良分析、品質管制",
                "資料",
                "無法讓系統辨識知識庫主題"
              ],
              [
                "原物料採購、供應商",
                "採購",
                "具體詞彙比單一詞更精準"
              ],
              [
                "ERP WIP 程式",
                "程式",
                "加入領域前綴詞提升比對準確度"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "建議每個知識庫設定 3~6 個精準標籤，涵蓋主題的不同說法（例如「SOP」和「標準作業程序」同時設定）。標籤設定後可回到對話測試，發現 AI 沒有用到預期知識庫時，可再回頭調整標籤。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-doc-template",
    "sort_order": 16,
    "icon": "LayoutTemplate",
    "icon_color": "text-indigo-500",
    "last_modified": "2026-04-15",
    "title": "文件範本",
    "sidebar_label": "文件範本",
    "blocks": [
      {
        "type": "para",
        "text": "**文件範本庫**讓您預先定義帶有**變數佔位符**的 Word、Excel 或 PDF 文件，之後只需填入資料，系統自動輸出格式完整的正式文件。適合會議紀錄、報告、表單等重複性文件的產出。"
      },
      {
        "type": "table",
        "headers": [
          "支援格式",
          "引擎",
          "說明"
        ],
        "rows": [
          [
            "Word (DOCX)",
            "docxtemplater",
            "保留原始字型、樣式、表格，原生 {{變數}} 替換"
          ],
          [
            "Excel (XLSX)",
            "ExcelJS",
            "儲存格佔位符替換，保留公式與格式"
          ],
          [
            "PowerPoint (PPTX)",
            "JSZip XML 替換",
            "保留原始品牌設計，支援封面/內頁/封底分類，可重複內頁自動展開多頁，支援行距/列標樣式設定"
          ],
          [
            "PDF",
            "pdf-lib / AI 重建",
            "AcroForm 表單欄位優先；無表單時由 AI 識別後重建"
          ]
        ]
      },
      {
        "type": "subsection",
        "title": "進入文件範本庫",
        "blocks": [
          {
            "type": "para",
            "text": "從左側邊欄點選**文件範本**圖示（LayoutTemplate 圖示），進入範本管理頁面。"
          },
          {
            "type": "card_grid",
            "cols": 3,
            "items": [
              {
                "emoji": "📁",
                "title": "我的範本",
                "tag": null,
                "desc": "您建立的所有範本",
                "borderColor": "slate"
              },
              {
                "emoji": "🌐",
                "title": "分享給我 / 公開",
                "tag": null,
                "desc": "他人分享或公開的範本",
                "borderColor": "slate"
              },
              {
                "emoji": "🔍",
                "title": "搜尋篩選",
                "tag": null,
                "desc": "依名稱或格式快速篩選",
                "borderColor": "slate"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "新增範本（上傳精靈）",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點選右上角「新增範本」藍色按鈕",
                "desc": ""
              },
              {
                "title": "拖曳或點選上傳您的文件",
                "desc": "支援 DOCX、XLSX、PPTX、PDF，系統自動讀取內容"
              },
              {
                "title": "AI 自動分析：識別文件中的變數",
                "desc": "例如：{{姓名}}、{{日期}}、{{金額}}，並列出建議的變數清單"
              },
              {
                "title": "確認或調整變數設定",
                "desc": "可修改變數名稱、類型（文字/數字/日期/選項）、是否必填、預設值。若為 PPTX，可在此設定每張投影片的類型"
              },
              {
                "title": "填寫範本名稱、描述、標籤，點選「建立」完成",
                "desc": ""
              }
            ]
          },
          {
            "type": "tip",
            "text": "AI 識別的變數準確度約 85–95%，建議上傳前先確認文件中的佔位文字清晰，例如「請輸入姓名」比「XXX」更容易被正確識別。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "PPTX 投影片範本設計",
        "blocks": [
          {
            "type": "para",
            "text": "上傳 PPTX 後，系統會**自動偵測並分類**每張投影片的版型，無需手動設定。支援四種版型，系統依位置和欄數自動判斷："
          },
          {
            "type": "table",
            "headers": [
              "版型",
              "自動判斷條件",
              "注入的佔位符"
            ],
            "rows": [
              [
                "cover（封面）",
                "第 1 張投影片",
                "{{cover_title}}、{{cover_subtitle}} 等（依原始文字框自動命名）"
              ],
              [
                "bullets（條列）",
                "非封面/封底，且欄數 < 3",
                "{{slide_title}}、{{slide_content}}（以 \\n 分隔每條重點）"
              ],
              [
                "3col（三欄）",
                "非封面/封底，欄數 ≥ 3",
                "{{slide_title}}、{{col1_title}}、{{col1_content}}（三欄各一組）"
              ],
              [
                "closing（封底）",
                "最後一張（簡報超過 2 張時）",
                "{{closing_title}}、{{closing_message}} 等"
              ]
            ]
          },
          {
            "type": "para",
            "text": "AI 提供的 `slides[]` 陣列中，每個元素可指定 `type: \"bullets\"` 或 `type: \"3col\"`，系統根據 type 選擇對應的範本投影片複製並填入資料。"
          },
          {
            "type": "para",
            "text": "**AI 排版引擎（自動）**會在文件生成前對 slides[] 進行以下處理："
          },
          {
            "type": "card_grid",
            "cols": 3,
            "items": [
              {
                "emoji": "✂️",
                "title": "自動拆頁",
                "tag": null,
                "desc": "bullets 超過 6 條重點時，自動拆分成下一張，標題加「（續）」",
                "borderColor": "purple"
              },
              {
                "emoji": "📏",
                "title": "長句壓縮",
                "tag": null,
                "desc": "每條重點超過 30 字時，AI 自動壓縮核心意思",
                "borderColor": "purple"
              },
              {
                "emoji": "📐",
                "title": "3欄升級",
                "tag": null,
                "desc": "3 個平行條列項目（如方案比較）自動升級為 3col 版型",
                "borderColor": "purple"
              },
              {
                "emoji": "🔤",
                "title": "AI 智慧命名",
                "tag": null,
                "desc": "AI 自動產生報告標題作為封面名稱，並以「主題_日期」格式命名下載檔案",
                "borderColor": "purple"
              },
              {
                "emoji": "🚫",
                "title": "過濾參考文獻",
                "tag": null,
                "desc": "Google 搜尋產生的參考來源連結自動過濾，不會出現在簡報中",
                "borderColor": "purple"
              }
            ]
          },
          {
            "type": "tip",
            "text": "**縮圖預覽：**建立範本後，可在投影片設定卡片上點擊縮圖區塊，上傳各投影片的截圖（直接在 PowerPoint 中「另存新檔 → PNG」即可）。之後在設定畫面就能以圖片預覽確認每張 slide 的版型。"
          },
          {
            "type": "note",
            "text": "PPTX 生成時，系統以 XML 層級替換佔位符，完整保留原始的背景圖、色彩、字型、Logo，條列重點以真實的段落（<a:p>）展開，非純文字換行，確保 PowerPoint 顯示正確。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "PPTX 樣式設定：行距與列標",
        "blocks": [
          {
            "type": "para",
            "text": "在**樣式設定**頁籤中，可以針對投影片內容（`slide_content`）設定行距和列標符號。設定後所有自動生成的內頁投影片都會套用。"
          },
          {
            "type": "table",
            "headers": [
              "設定項目",
              "選項",
              "說明"
            ],
            "rows": [
              [
                "行距",
                "沿用 / 1.0 / 1.15 / 1.5 / 2.0 / 2.5 / 3.0",
                "控制每條重點之間的行間距，「沿用」保留範本原始設定"
              ],
              [
                "列標",
                "沿用 / 無 / • 圓點 / ✓ 勾選 / ■ 方塊 / ○ 空心圓 / ▸ 三角 / – 短橫 / ★ 星號 / ➤ 箭頭",
                "每條重點前方的符號，「無」表示無符號，「沿用」保留範本原始設定"
              ],
              [
                "字型大小",
                "數字 (pt)",
                "留空 = 保留範本原始大小；填入數字則覆寫所有內容文字"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "這些設定僅影響 override，留空或選「沿用」時完全保留範本 PPTX 原始的格式設定。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "使用範本生成文件",
        "blocks": [
          {
            "type": "para",
            "text": "共有五種方式可以套用範本產生文件："
          },
          {
            "type": "list",
            "items": [
              "**方式 1：在對話輸入框選擇範本** — 點選輸入框左方的「範本」圖示，從彈出清單選擇範本，系統會在訊息前方附加 `[使用範本:名稱]` 標記，AI 自動以對話內容填入變數並在回應中提供下載連結。檔名格式為「AI產生的報告主題_日期.副檔名」（如：美國關稅政策分析_20260329.pptx），封面標題也會自動使用 AI 產生的報告名稱。",
              "**方式 2：從範本卡片點選「生成」** — 在文件範本庫找到目標範本，點選卡片上的「生成」按鈕，系統彈出填寫表單，依序輸入所有變數後點選「生成」，即可下載完成的文件。",
              "**方式 3：透過 Skill 技能自動套用** — 在技能市集（Skill）編輯器的「輸入/輸出」頁籤，選擇「輸出範本」。之後在對話中套用此技能時，AI 會強制以 JSON 格式輸出，並自動套用所選範本產生文件，文件下載連結直接顯示在對話中。",
              "**方式 4：排程任務自動生成** — 在「排程任務」設定中，於「輸出範本」欄位選擇範本。排程執行後，AI 的回應會自動解析為 JSON 並套用範本，生成的文件可透過 Email 附件寄送，也會記錄在任務執行歷史中供下載。亦可在 Prompt 中插入 `{{template:範本ID}}` 標籤來指定範本。",
              "**方式 5：Pipeline 工作流程節點** — 在 Pipeline（工作流程）編輯器中，於「產生檔案」節點選擇「使用範本」模式，指定目標範本後，上一個節點的 AI JSON 輸出會自動被解析並套用到範本，生成的文件作為後續節點的輸入或最終輸出。"
            ]
          },
          {
            "type": "note",
            "text": "方式 3～5（AI 自動套用）要求 AI 輸出符合範本結構的 JSON。系統會將範本的欄位清單注入到 AI 指令中，引導 AI 自動產生正確的 JSON 格式，無需人工手動填表。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "AI 自動填表 — JSON 輸出機制",
        "blocks": [
          {
            "type": "para",
            "text": "當使用技能綁定範本、排程任務或 Pipeline 節點時，系統會自動在 AI 的系統提示末尾注入範本的欄位說明，格式如下："
          },
          {
            "type": "code",
            "text": "# 請以下列 JSON 格式輸出（用於文件範本填寫）\n{\n  \"customer_name\": \"（客戶姓名 — text）\",\n  \"order_date\":    \"（訂單日期 — date）\",\n  \"items\": [\n    { \"product_code\": \"（產品代碼）\", \"qty\": \"（數量）\" }\n  ]\n}"
          },
          {
            "type": "para",
            "text": "PPTX 多版型範本的 JSON 格式如下，`slides` 陣列中每個元素代表一張投影片："
          },
          {
            "type": "code",
            "text": "{\n  \"cover_title\":     \"2025 Q1 業務報告\",\n  \"cover_presenter\": \"業務發展部\",\n  \"slides\": [\n    {\n      \"type\": \"bullets\",\n      \"slide_title\": \"本季亮點\",\n      \"slide_content\": \"訂單成長 18%\\n新客戶開發 42 家\\n客戶滿意度 4.8 / 5.0\\n市場佔有率提升至 23%\"\n    },\n    {\n      \"type\": \"3col\",\n      \"slide_title\": \"三大策略方向\",\n      \"col1_title\": \"品質提升\",\n      \"col1_content\": \"導入 ISO 驗證\\n零缺陷目標\",\n      \"col2_title\": \"效率優化\",\n      \"col2_content\": \"自動化產線\\n縮短交期 30%\",\n      \"col3_title\": \"市場擴展\",\n      \"col3_content\": \"東南亞佈局\\n電商渠道強化\"\n    }\n  ]\n}"
          },
          {
            "type": "para",
            "text": "AI 回應後，系統依序執行以下處理流程，確保文件正確生成："
          },
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "emoji": "🔍",
                "title": "P2 — 格式修復",
                "tag": null,
                "desc": "若 AI JSON 解析失敗，Flash 自動重新從回應文字中提取有效 JSON",
                "borderColor": "slate"
              },
              {
                "emoji": "✅",
                "title": "P1 — Schema 驗證",
                "tag": null,
                "desc": "檢查必填欄位是否齊全，若有缺失則 Flash 嘗試自動補齊",
                "borderColor": "slate"
              },
              {
                "emoji": "🎨",
                "title": "P0 — 排版引擎",
                "tag": null,
                "desc": "PPTX 專用：自動拆頁、壓縮長句、升級 3col 版型",
                "borderColor": "slate"
              },
              {
                "emoji": "📄",
                "title": "文件生成",
                "tag": null,
                "desc": "以處理後的 JSON 填入範本，XML 層級替換，保留所有原始樣式",
                "borderColor": "slate"
              }
            ]
          },
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "emoji": "✅",
                "title": "自動支援 loop 欄位",
                "tag": null,
                "desc": "JSON 中若某欄位為陣列，對應到範本的 loop 類型，可自動產生多行表格或多張投影片",
                "borderColor": "slate"
              },
              {
                "emoji": "✅",
                "title": "格式完整保留",
                "tag": null,
                "desc": "生成的文件保留原始範本的字型、框線、Logo，僅填入 AI 提供的資料",
                "borderColor": "slate"
              },
              {
                "emoji": "⚠️",
                "title": "欄位名稱需對應",
                "tag": null,
                "desc": "JSON 的 key 必須與範本變數的 key 一致，AI 通常能自動對應，但若範本有更動建議重新測試一次",
                "borderColor": "slate"
              },
              {
                "emoji": "⚠️",
                "title": "需有「使用」權限",
                "tag": null,
                "desc": "AI 自動生成同樣需要對範本有 use 以上的存取權限，否則生成步驟會失敗",
                "borderColor": "slate"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "變數類型說明",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "類型",
              "說明",
              "範例"
            ],
            "rows": [
              [
                "text",
                "一般文字",
                "姓名、部門、說明"
              ],
              [
                "number",
                "數字，可帶小數",
                "金額、數量、比率"
              ],
              [
                "date",
                "日期格式",
                "2024-01-01"
              ],
              [
                "select",
                "固定選項清單",
                "狀態：核准 / 退回 / 審核中"
              ],
              [
                "loop",
                "重複表格列",
                "明細清單（每列可有多個子欄位）"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "**loop 類型**適合用於有多筆明細的表格，例如採購清單、出差明細。生成時可動態新增或刪除列數，每列獨立填寫。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "下載範本原始檔",
        "blocks": [
          {
            "type": "para",
            "text": "若您擁有「使用」以上權限，可點選範本卡片右上角選單的**「下載」**，下載該範本的原始文件（含佔位符）在本機修改後，重新建立新範本使用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "複製別人的範本（Fork）",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "在公開或被分享的範本卡片點選「複製」圖示",
                "desc": ""
              },
              {
                "title": "系統建立一份您專屬的副本",
                "desc": "原始文件、變數 Schema 完整複製，您可自由修改"
              },
              {
                "title": "進入「我的範本」找到複製的副本，點選「編輯」進行調整",
                "desc": ""
              }
            ]
          },
          {
            "type": "tip",
            "text": "Fork 副本與原始範本相互獨立，修改副本不影響原始範本，也不需要通知原作者。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "分享範本",
        "blocks": [
          {
            "type": "para",
            "text": "範本擁有者（owner）可將範本分享給其他使用者、角色、廠區、部門、利潤中心、事業處或事業群："
          },
          {
            "type": "table",
            "headers": [
              "分享類型",
              "說明"
            ],
            "rows": [
              [
                "use（使用）",
                "被分享者可生成文件、下載原始檔，但不能修改範本設定"
              ],
              [
                "edit（編輯）",
                "被分享者可修改範本名稱、描述、標籤、變數 Schema"
              ]
            ]
          },
          {
            "type": "para",
            "text": "分享對象可以是："
          },
          {
            "type": "list",
            "items": [
              "個別使用者",
              "角色",
              "廠區（ERP FACTORY_CODE）",
              "部門",
              "利潤中心",
              "事業處",
              "事業群"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "公開範本",
        "blocks": [
          {
            "type": "para",
            "text": "您可以將自己的範本設為**全員公開**，讓所有使用者都能在範本庫瀏覽和使用。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟範本的「分享設定」",
                "desc": ""
              },
              {
                "title": "點選「設為公開」開關",
                "desc": ""
              },
              {
                "title": "確認公告提示後，範本立即對全員可見",
                "desc": ""
              }
            ]
          },
          {
            "type": "note",
            "text": "公開範本不需要管理員審核，但請確認文件內容無敏感資訊，因為全員均可看到並使用。若需取消公開，再次點選開關即可。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "固定格式模式（Fixed Format Mode）",
        "blocks": [
          {
            "type": "para",
            "text": "**固定格式模式**讓您精確控制每個變數的字型大小、顏色、粗體，以及儲存格的溢位處理策略。適合公司制式表單、合約、報告等**版面不可隨意伸縮**的場景。"
          },
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "emoji": "📝",
                "title": "Word (DOCX)",
                "tag": null,
                "desc": "每格字型/顏色/粗體精確套用；loop 表格列高可固定（rowHeightPt）",
                "borderColor": "indigo"
              },
              {
                "emoji": "📊",
                "title": "Excel (XLSX)",
                "tag": null,
                "desc": "每格套用字型樣式；AI 自動從原始範本偵測 cell.font",
                "borderColor": "indigo"
              },
              {
                "emoji": "📄",
                "title": "PDF（非表單）",
                "tag": null,
                "desc": "疊加模式：保留原始 Logo/框線，在指定座標寫入文字",
                "borderColor": "indigo"
              }
            ]
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "上傳範本時啟用",
                "desc": "在「新增範本」精靈的 Step 3（確認變數）中，開啟「固定格式模式」開關"
              },
              {
                "title": "或在編輯時啟用",
                "desc": "開啟範本「編輯」視窗，在標題列右側找到「固定格式模式」切換開關"
              },
              {
                "title": "進入「樣式設定」頁籤調整字型/顏色/溢位",
                "desc": ""
              },
              {
                "title": "（PDF 專用）進入「版面編輯器」頁籤定義各欄位的填寫位置",
                "desc": ""
              }
            ]
          },
          {
            "type": "tip",
            "text": "開啟固定格式模式後，系統會自動從原始範本讀取字型樣式作為預設值，您只需覆寫與原始不同的欄位即可。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "樣式設定頁籤",
        "blocks": [
          {
            "type": "para",
            "text": "在範本「編輯」視窗中點選**「樣式設定」**頁籤，可對每個變數（含 loop 子欄位）設定："
          },
          {
            "type": "table",
            "headers": [
              "設定項目",
              "說明"
            ],
            "rows": [
              [
                "字型大小 (pt)",
                "輸入點數，如 10、12、14，留空表示沿用偵測值"
              ],
              [
                "粗體",
                "勾選即套用 bold"
              ],
              [
                "斜體",
                "勾選即套用 italic"
              ],
              [
                "顏色",
                "點選色盤選擇顏色，留空表示沿用偵測值（預設黑色）"
              ],
              [
                "溢位策略",
                "見下方說明"
              ],
              [
                "最大字數",
                "配合 truncate / summarize 策略使用，設定觸發上限"
              ]
            ]
          },
          {
            "type": "para",
            "text": "欄位旁的**「已偵測」**綠色徽章，表示該值是系統自動從原始範本讀取的。手動修改後可點選**「重設」**還原為偵測值。"
          },
          {
            "type": "note",
            "text": "「樣式設定」在固定格式模式**關閉**時不會套用。請先在編輯視窗標題列開啟固定格式模式。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "溢位策略說明",
        "blocks": [
          {
            "type": "para",
            "text": "當變數內容超出儲存格或欄位空間時，系統依所選策略處理："
          },
          {
            "type": "table",
            "headers": [
              "策略",
              "行為",
              "適用場景"
            ],
            "rows": [
              [
                "折行（wrap）",
                "預設值，內容自動換行，欄高隨內容增長",
                "說明欄位、備註等無固定行數的格"
              ],
              [
                "截斷（truncate）",
                "超過「最大字數」後直接截斷並加 …",
                "簡短標題、代碼欄位，不允許換行"
              ],
              [
                "縮小字型（shrink）",
                "自動縮小字型大小，使文字擠進原格",
                "PDF 覆蓋模式的單行格"
              ],
              [
                "AI 摘要（summarize）",
                "呼叫 Gemini Flash 自動摘要到設定字數內",
                "長篇說明需要保留語意、不能截斷時"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "AI 摘要策略會自動偵測輸入語言（中文比率 > 30% 使用繁體中文摘要），摘要失敗時會自動 fallback 為截斷策略，不影響文件生成。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "PDF 版面編輯器",
        "blocks": [
          {
            "type": "para",
            "text": "對於 PDF 格式（非 AcroForm 表單）的固定格式範本，需要用**版面編輯器**手動定義每個欄位的填寫座標。完成定位後，生成時系統以**疊加模式**在原始 PDF 上直接寫入文字，保留 Logo、框線、印章等所有原始視覺元素。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟範本編輯視窗，切換到「版面編輯器」頁籤",
                "desc": "此頁籤僅對 PDF（非 AcroForm）格式的範本顯示"
              },
              {
                "title": "PDF 預覽載入後，在右上方「選擇變數」下拉選取要定位的欄位",
                "desc": ""
              },
              {
                "title": "在 PDF 預覽畫面上拖曳畫出矩形框",
                "desc": "框的位置即為該欄位文字的填寫區域，支援跨頁定位"
              },
              {
                "title": "右側面板確認座標，可重複框選覆蓋修正",
                "desc": ""
              },
              {
                "title": "對所有變數完成定位後，點選「儲存」",
                "desc": ""
              }
            ]
          },
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "emoji": "",
                "title": "縮放",
                "tag": null,
                "desc": "點選 + / − 按鈕或拖動縮放列調整預覽大小",
                "borderColor": "slate"
              },
              {
                "emoji": "",
                "title": "換頁",
                "tag": null,
                "desc": "點選 ◀ ▶ 按鈕切換 PDF 頁面",
                "borderColor": "slate"
              },
              {
                "emoji": "",
                "title": "已定位欄位",
                "tag": null,
                "desc": "藍色半透明矩形，點選即選取，右側顯示詳細資訊",
                "borderColor": "slate"
              },
              {
                "emoji": "",
                "title": "刪除框位",
                "tag": null,
                "desc": "選取矩形後按鍵盤 Delete 或右側「刪除」按鈕",
                "borderColor": "slate"
              }
            ]
          },
          {
            "type": "note",
            "text": "若有變數尚未定位，生成文件時系統會跳過該欄位並在伺服器記錄警告，其他已定位的欄位仍正常填入。建議上傳後立即完成版面編輯器設定，再分享給他人使用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "內容模式（Content Mode）",
        "blocks": [
          {
            "type": "para",
            "text": "每個欄位可設定**內容模式**，控制生成文件時該欄位的取值方式。在「變數設定」頁籤的每個欄位右側，有三個小按鈕可切換模式："
          },
          {
            "type": "card_grid",
            "cols": 3,
            "items": [
              {
                "emoji": "V",
                "title": "變數（預設）",
                "tag": null,
                "desc": "每次生成時由使用者填入。表單中會顯示此欄位等待輸入。",
                "borderColor": "blue"
              },
              {
                "emoji": "T",
                "title": "靜態（固定文字）",
                "tag": null,
                "desc": "永遠使用「預設值」欄位的內容，不詢問使用者。適合公司名稱、固定標題。",
                "borderColor": "amber"
              },
              {
                "emoji": "∅",
                "title": "清空（保留格式）",
                "tag": null,
                "desc": "永遠清空此格內容。PDF 覆蓋模式會畫白色矩形蓋掉原始文字，框線保留。",
                "borderColor": "slate"
              }
            ]
          },
          {
            "type": "tip",
            "text": "典型用法：上傳一份 PDF 表單，將「標題」設為靜態（保留原始值）、「內容欄位」設為變數（使用者填入）、「填寫範例」設為清空（清除預印文字），即可製作乾淨的可重複使用表單。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "OCR 掃描式 PDF",
        "blocks": [
          {
            "type": "para",
            "text": "若上傳的 PDF 是**掃描版圖片型**（文字無法直接複製），系統會自動偵測並使用**Gemini Vision OCR**識別欄位位置，同時自動啟用「固定格式模式」，讓您直接在版面編輯器微調座標。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "上傳掃描版 PDF",
                "desc": "系統偵測到文字內容極少（<50字元），自動進入 OCR 流程"
              },
              {
                "title": "等待 Gemini Vision 分析",
                "desc": "顯示「OCR 掃描中...」狀態，時間約 10-30 秒，取決於頁面複雜度"
              },
              {
                "title": "檢視 OCR 識別結果",
                "desc": "變數清單顯示「OCR 自動定位」標籤，座標已預先填入"
              },
              {
                "title": "在版面編輯器微調座標",
                "desc": "OCR 座標為估算值（誤差約 5-15 pt），建議人工確認並拖拉微調"
              }
            ]
          },
          {
            "type": "para",
            "text": "**對現有範本重新 OCR**：若想更新現有 PDF 範本的欄位座標，開啟範本「編輯」→「版面編輯器」頁籤，點選右上角**「OCR 重新掃描」**紫色按鈕。系統重新分析後，會將新偵測到的 pdf_cell 座標合併回現有變數，不影響已手動設定好的其他欄位設定。"
          },
          {
            "type": "table",
            "headers": [
              "PDF 類型",
              "OCR 準確度",
              "建議做法"
            ],
            "rows": [
              [
                "白底清晰掃描表單",
                "~85%",
                "直接使用，微調 1-2 個座標"
              ],
              [
                "彩色底色表單",
                "~75%",
                "使用後逐欄確認座標"
              ],
              [
                "圖文混排複雜版面",
                "~60%",
                "以 OCR 結果作參考，手動重新框選"
              ],
              [
                "文字型 PDF（非掃描）",
                "N/A",
                "系統自動用 AI 文字分析，不走 OCR"
              ]
            ]
          },
          {
            "type": "note",
            "text": "OCR 功能使用 Gemini Pro 模型，每次約消耗 1,000-3,000 input tokens。大量批次上傳時請注意 API 配額。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-research",
    "sort_order": 17,
    "icon": "GitFork",
    "icon_color": "text-indigo-500",
    "last_modified": "2026-04-01",
    "title": "深度研究",
    "sidebar_label": "深度研究",
    "blocks": [
      {
        "type": "para",
        "text": "「深度研究」讓 AI 針對複雜問題自動拆解成多個子問題、逐一深度調查後，整合產出完整報告。適合競品分析、技術評估、市場調查、法規解析等需要多角度、多來源交叉比對的場景。整個研究在背景非同步執行，不影響您繼續使用聊天。"
      },
      {
        "type": "subsection",
        "title": "三步驟流程概覽",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "Step 1 — 設定問題",
                "desc": "輸入主題、選深度、設定全局附件與資料來源，AI 自動推薦相關知識庫"
              },
              {
                "title": "Step 2 — 確認計畫",
                "desc": "AI 生成子問題清單後，您可編輯問題文字、設定每個子問題的方向提示 / 附件 / 網搜開關 / 知識庫"
              },
              {
                "title": "Step 3 — 即時預覽",
                "desc": "每個子問題完成後立即顯示答案摘要，全部完成自動整合報告並生成下載檔"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Step 1：設定問題",
        "blocks": [
          {
            "type": "para",
            "text": "點選輸入框右側的深度研究按鈕開啟設定面板。若輸入框已輸入問題或附加了檔案，這些內容會自動帶入。"
          },
          {
            "type": "table",
            "headers": [
              "設定項目",
              "說明"
            ],
            "rows": [
              [
                "研究問題",
                "輸入您要深入調查的問題或主題，越具體越好"
              ],
              [
                "全局附件",
                "上傳檔案（PDF / Word / Excel / 圖片等）作為所有子問題的共用背景資料，拖放或點擊 + 附加"
              ],
              [
                "研究深度",
                "快速 2 個、標準 5 個、深入 8 個、全面 12 個子問題，深度越高耗時越長"
              ],
              [
                "輸出格式",
                "可多選 Word / PDF / PPT / Excel，完成後每種格式各生成一個下載連結"
              ],
              [
                "整體資料來源",
                "為所有子問題預設使用的資料來源：自建知識庫 / API 連接器 / MCP 工具（子問題可個別覆蓋）"
              ],
              [
                "自動建議 KB",
                "輸入問題 1 秒後系統自動分析並預選相關知識庫（橘色「自動建議」標籤）"
              ],
              [
                "引用前次研究",
                "選擇已完成的研究，其摘要會自動作為本次研究的背景知識，可多選最多 3 筆"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "輸入完問題後稍等 1 秒，系統會自動推薦相關知識庫並預勾選。若推薦不準確，可手動取消勾選。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Step 2：確認計畫與子問題設定",
        "blocks": [
          {
            "type": "para",
            "text": "AI 生成研究計畫後進入確認頁，顯示研究主題、目標說明及自動拆解的子問題清單。您可拖曳排序、編輯問題文字、新增或刪除子問題（最多 12 個）。"
          },
          {
            "type": "para",
            "text": "每個子問題展開後可設定："
          },
          {
            "type": "list",
            "items": [
              "**研究方向提示** — 輸入提示文字，例如「只看台灣市場數據」、「聚焦 2024 年後的資料」，引導 AI 研究方向。",
              "**子問題專屬附件** — 為此子問題額外附加不同的參考文件，僅此子問題使用，不影響其他子問題。",
              "**網路搜尋開關** — 為此子問題個別啟用或停用網路搜尋（覆蓋任務層級設定）。亮藍色 = 啟用，灰色 = 停用。實際是否啟用網搜還受「無 KB 資料才觸發」的邏輯控制。",
              "**子問題資料來源（覆蓋任務設定）** — 為此子問題指定不同的自建 KB / API 連接器 / MCP 工具，覆蓋 Step 1 設定的任務層級來源。"
            ]
          },
          {
            "type": "note",
            "text": "子問題數量越多，Token 消耗越大。標準（5 個）適合大多數需求，若主題複雜才考慮深入（8 個）以上。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Step 3：即時串流預覽",
        "blocks": [
          {
            "type": "para",
            "text": "點「確認並開始研究」後立即進入預覽頁，研究在背景執行，畫面即時更新每個子問題的狀態："
          },
          {
            "type": "list",
            "items": [
              "研究中（旋轉圖示）— AI 正在針對此子問題搜尋與生成答案",
              "已完成（綠色勾選）— 顯示答案摘要前 300 字"
            ]
          },
          {
            "type": "para",
            "text": "全部子問題完成後，AI 自動整合產出完整報告並生成下載檔，之後可在頂部欄位的研究面板下載。"
          },
          {
            "type": "tip",
            "text": "可以直接關閉此視窗，研究仍繼續在背景執行。完成後頂部的研究圖示會出現完成提示，對話中也會自動插入研究摘要與下載連結。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "資料來源選用邏輯",
        "blocks": [
          {
            "type": "para",
            "text": "系統依以下優先順序決定每個子問題使用哪些資料："
          },
          {
            "type": "table",
            "headers": [
              "層級",
              "優先",
              "說明"
            ],
            "rows": [
              [
                "子問題層級",
                "最高",
                "若子問題有設定個別 KB / API 連接器 / MCP，以子問題設定為準"
              ],
              [
                "任務層級",
                "次高",
                "子問題未設定時，使用 Step 1 的整體任務資料來源"
              ],
              [
                "全部 KB",
                "預設",
                "任務層級也未設定時，自動搜尋您能存取的所有知識庫"
              ],
              [
                "網路搜尋",
                "補充",
                "知識庫無結果且無附件時自動觸發（需有可用的 MCP 搜尋工具）"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "修改子問題並重跑（Edit & Re-run）",
        "blocks": [
          {
            "type": "para",
            "text": "研究完成後，若某些子問題的答案不理想，可以針對特定子問題修改後重跑，**不需要整個任務重頭來過**，其餘子問題的答案原封不動保留。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "開啟頂部欄位的研究面板",
                "desc": "點選頂部欄位的望遠鏡／研究圖示，展開已完成的研究清單"
              },
              {
                "title": "點選 done 研究右側的「↺」按鈕",
                "desc": "這會開啟 ResearchModal 的「編輯重跑」模式，直接進入 Step 2"
              },
              {
                "title": "選擇要重跑的子問題",
                "desc": "預設全部為「保留」（灰底顯示舊答案摘要）；點「↺ 重跑」按鈕標記為橘色 = 此子問題將重新執行"
              },
              {
                "title": "修改問題文字 / 方向提示 / 附件 / 網搜開關（選填）",
                "desc": "展開已標記的子問題，可修改研究方向或附加新文件"
              },
              {
                "title": "點「確認並重跑」",
                "desc": "只執行被標記的子問題，完成後自動與原有答案合併、重新整合報告、更新下載檔"
              }
            ]
          },
          {
            "type": "tip",
            "text": "重跑完成後，聊天記錄中的研究摘要會自動更新為最新版本，下載檔也會重新生成。"
          },
          {
            "type": "note",
            "text": "正在執行中（pending / running）的研究無法重跑，請等待當前執行完成後再操作。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "引用前次研究作為背景知識",
        "blocks": [
          {
            "type": "para",
            "text": "在 Step 1 的「引用前次研究」區塊，可選擇已完成的研究（最近 20 筆）作為本次研究的背景知識。系統會自動將舊研究的摘要（約 800 字）拼接到每個子問題的背景脈絡中，適合「追蹤研究」場景，例如上季分析的延伸、議題的持續追蹤。"
          },
          {
            "type": "note",
            "text": "「引用前次研究」與「修改子問題重跑」是兩個不同功能：引用是把舊摘要當背景知識，讓新研究有延續性；重跑是直接修改舊研究中不滿意的子問題，在原有報告上更新。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "研究歷史與下載",
        "blocks": [
          {
            "type": "para",
            "text": "點選頂部欄位的研究圖示可展開研究面板，顯示最近 10 筆研究任務的狀態與操作。"
          },
          {
            "type": "table",
            "headers": [
              "狀態",
              "圖示",
              "說明"
            ],
            "rows": [
              [
                "pending",
                "藍色 Sparkles ✦",
                "AI 尚未開始，通常在數秒內轉為執行中"
              ],
              [
                "running",
                "藍色進度條",
                "正在逐步研究子問題，進度條顯示 N/M 步"
              ],
              [
                "done",
                "綠色 ✓",
                "報告已生成，點連結即可下載各格式檔案"
              ],
              [
                "failed",
                "紅色 ⚠",
                "發生錯誤，錯誤訊息顯示於下方，可點 ↺ 重跑嘗試修復"
              ]
            ]
          },
          {
            "type": "para",
            "text": "每筆研究右側有兩個按鈕："
          },
          {
            "type": "list",
            "items": [
              "（橘色）↺ 編輯並重跑子問題 — 僅 done 狀態顯示",
              "（灰色）✕ 刪除此研究任務及其下載檔"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Token 消耗說明",
        "blocks": [
          {
            "type": "para",
            "text": "深度研究使用 Gemini Pro 模型，Token 消耗明顯高於一般對話，請依實際需求選擇研究深度："
          },
          {
            "type": "table",
            "headers": [
              "深度",
              "子問題數",
              "預估 Token（僅供參考）",
              "適用場景"
            ],
            "rows": [
              [
                "快速",
                "2",
                "約 5 k–15 k",
                "簡單問題、快速了解概況"
              ],
              [
                "標準",
                "5",
                "約 15 k–40 k",
                "大多數一般調查需求"
              ],
              [
                "深入",
                "8",
                "約 30 k–70 k",
                "複雜議題、需多角度驗證"
              ],
              [
                "全面",
                "12",
                "約 50 k–120 k",
                "大型研究報告、需窮舉各面向"
              ]
            ]
          },
          {
            "type": "note",
            "text": "若有管理員設定的每日 / 每週 Token 使用上限，深度研究也受此限制。上限剩餘量可在聊天頁面頂部的金額提示區查看。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-ai-bi",
    "sort_order": 18,
    "icon": "BarChart3",
    "icon_color": "text-orange-500",
    "last_modified": "2026-04-20",
    "title": "AI 戰情室",
    "sidebar_label": "AI 戰情室",
    "blocks": [
      {
        "type": "para",
        "text": "AI 戰情室是一套以自然語言驅動的企業 ERP 資料查詢與視覺化平台，讓您無需懂 SQL 就能直接對 Oracle ERP 資料庫提問，即時取得報表、圖表，並可儲存常用查詢組合成彈性的 BI 儀表板。**系統透過資料政策控管每位使用者的資料可視範圍**，確保員工只能看到其職責範圍內的 ERP 資料。"
      },
      {
        "type": "table",
        "headers": [
          "功能模組",
          "說明"
        ],
        "rows": [
          [
            "自然語言查詢",
            "用中文提問，系統自動生成並執行 SQL，回傳結果與圖表"
          ],
          [
            "資料政策（Data Policy）",
            "四層過濾機制，依使用者 / 角色 / 組織 / ERP Multi-Org 控管資料可視範圍"
          ],
          [
            "命名查詢 / 報表範本",
            "儲存常用問題為具名範本，可定義查詢參數與圖表設定"
          ],
          [
            "Schema 欄位選擇器",
            "從 ERP 資料表欄位清單選取並插入到提問輸入框"
          ],
          [
            "即時圖表建構器",
            "查詢結果出來後，快速設定長條圖、折線圖、圓餅圖等，支援分組/堆疊/複數 Y 軸/漸層/陰影"
          ],
          [
            "Tableau 拖拉式設計器",
            "全螢幕拖拉欄位到各 Shelf，視覺化設計圖表，類似 Tableau 操作體驗"
          ],
          [
            "儀表板 Board",
            "將多個命名查詢的圖表組合成一個可拖拉排版的儀表板"
          ],
          [
            "查詢參數化",
            "命名查詢可定義填值欄位（下拉選單、日期範圍等），執行時彈窗填入"
          ],
          [
            "分享",
            "命名查詢與儀表板可分享給指定使用者、角色、廠區、部門、利潤中心、事業處或事業群"
          ]
        ]
      },
      {
        "type": "subsection",
        "title": "進入 AI 戰情室",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點選左側邊欄的「AI 戰情室」圖示",
                "desc": "系統會導向 /dashboard 頁面，左側會顯示可用的主題（Topic）與查詢任務（Design）"
              },
              {
                "title": "從左側選擇主題 → 查詢任務",
                "desc": "主題是大分類（例：生產異常），任務是具體查詢範圍（例：各廠異常工單統計）"
              },
              {
                "title": "在輸入框輸入自然語言問題",
                "desc": "例：「請統計本月各廠區不良工單數量，依工廠由高到低排序」"
              },
              {
                "title": "按 Enter 或點擊發送按鈕",
                "desc": "系統會顯示進度，依序完成向量語意搜尋 → SQL 生成 → ERP 查詢 → 結果呈現"
              }
            ]
          },
          {
            "type": "tip",
            "text": "第一次使用請確認帳號已獲得「使用 AI 戰情室」權限，若未顯示入口請洽系統管理員開通。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "查詢引導 chip（不知道怎麼問？）",
        "blocks": [
          {
            "type": "para",
            "text": "選擇查詢任務後，輸入框下方會顯示**三類引導 chip**，點擊即可帶入輸入框，您可以再微調（如改日期、改料號）後按「查詢」執行："
          },
          {
            "type": "table",
            "headers": [
              "類型",
              "來源",
              "說明"
            ],
            "rows": [
              [
                "💡 範例問題",
                "設計者預先填寫的 few-shot 示範",
                "每個任務由設計者寫好幾組典型問法，依您目前的語言（中 / 英 / 越）自動顯示對應版本"
              ],
              [
                "🕘 最近問過",
                "您自己近期在此任務的查詢歷史",
                "自動列出您個人在此任務最近 3 筆不重複的問句，方便快速重查常用問題（僅本人可見）"
              ],
              [
                "💭 試試這樣問",
                "系統通用提示",
                "只有當上面兩類都沒資料時才顯示，給您三個通用示範，引導嘗試第一次查詢"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "「最近問過」只會顯示您自己查過的問題，不會看到別人的查詢內容。若此任務尚未顯示範例問題，代表設計者還沒寫 few-shot；可請 IT 或任務設計者補上。"
          },
          {
            "type": "note",
            "text": "當您切換到不常用的任務時，若本地歷史中該任務資料不足，系統會自動向後端補撈最近 10 筆，確保「最近問過」chip 盡量有資料。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "查詢結果解讀",
        "blocks": [
          {
            "type": "para",
            "text": "查詢完成後，主區域會顯示："
          },
          {
            "type": "table",
            "headers": [
              "元素",
              "說明"
            ],
            "rows": [
              [
                "圖表頁籤",
                "若 Design 有預設圖表設定，會自動呈現 ECharts 視覺化圖表"
              ],
              [
                "表格頁籤",
                "原始查詢結果，欄位標題使用中文說明，支援分頁"
              ],
              [
                "資料筆數",
                "右上角顯示總筆數（最多回傳 500 筆）"
              ],
              [
                "快取標示",
                "若顯示「快取命中」代表此問題結果來自快取，回應速度更快"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "模型選擇",
        "blocks": [
          {
            "type": "para",
            "text": "輸入框下方可切換 AI 模型，不同模型影響 SQL 生成品質與回應速度。建議使用預設模型（Gemini Pro），複雜查詢可嘗試切換至 Flash（速度較快但精準度略低）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "最近結果自動快取（設計圖表免重跑）",
        "blocks": [
          {
            "type": "para",
            "text": "查詢完成後，系統會**自動把結果存在您目前這台瀏覽器的本機**，30 分鐘內重新打開同一個任務（或重整頁面、關掉分頁再開啟）會直接顯示上次的結果，不用再重新跑一次查詢。這對邊調整圖表、邊切換任務對比資料的使用者特別有感。"
          },
          {
            "type": "table",
            "headers": [
              "情境",
              "表現"
            ],
            "rows": [
              [
                "首次選擇任務",
                "空白，請輸入問題執行查詢"
              ],
              [
                "30 分鐘內切換回同一任務",
                "瞬間帶出上次的問題、結果與圖表設定，並顯示黃色提示條"
              ],
              [
                "重整頁面",
                "同上，切到最後查詢過的任務也會帶出快取"
              ],
              [
                "超過 30 分鐘",
                "快取自動失效，行為同首次"
              ],
              [
                "結果非常大（超過 2MB）",
                "僅快取問題文字與圖表設定，提示條會顯示「請按重新查詢」"
              ],
              [
                "在圖表建構器調整設計",
                "每次變更自動寫回快取，重整後 ChartBuilder 設定不會丟失"
              ]
            ]
          },
          {
            "type": "para",
            "text": "當您看到**黃色提示條**顯示「顯示 X 分鐘前的結果（本機快取）」時，代表畫面上是快取資料，若擔心資料不新鮮可點擊**「重新查詢」**按鈕即時重跑；點擊右側 ✕ 可關閉提示條。"
          },
          {
            "type": "note",
            "text": "快取僅存在您當前使用的瀏覽器，不會跨裝置同步，也看不到別人的查詢結果。清除瀏覽器資料會一併清除此快取。"
          },
          {
            "type": "tip",
            "text": "「重新查詢」按鈕打的是同一個問題，後端若在 30 分鐘內已執行過相同 SQL，會直接回傳伺服器端快取結果（標示「快取命中」），速度通常在 2-3 秒內。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "語意搜尋參數（進階）",
        "blocks": [
          {
            "type": "para",
            "text": "若查詢任務已啟用向量語意搜尋，輸入框下方會出現「向量搜尋參數」展開區，可調整："
          },
          {
            "type": "table",
            "headers": [
              "參數",
              "說明",
              "預設值"
            ],
            "rows": [
              [
                "Top K",
                "取語意最相近的 K 筆向量資料補充至 AI 提示詞",
                "10"
              ],
              [
                "相似度閾值",
                "低於此分數的結果不納入（0~1，越大越嚴格）",
                "0.50"
              ]
            ]
          },
          {
            "type": "note",
            "text": "通常無需調整，使用設計師設定的預設值即可。若查詢結果不符預期，可嘗試降低閾值至 0.30~0.40。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "資料政策（Data Policy）— 資料可視範圍控管",
        "blocks": [
          {
            "type": "para",
            "text": "AI 戰情室的查詢結果受**資料政策**控管，系統在執行 SQL 前會自動在 WHERE 條件加入使用者所屬的組織過濾條件，確保每位員工只能看到其職責範圍內的 ERP 資料。此機制完全在後端執行，使用者無法繞過。"
          },
          {
            "type": "para",
            "text": "資料政策採用**四層過濾架構**，由管理員在後台設定："
          },
          {
            "type": "table",
            "headers": [
              "層次",
              "過濾維度",
              "說明"
            ],
            "rows": [
              [
                "第 1 層 使用者過濾",
                "指定使用者帳號",
                "為特定使用者設定個人化的資料限制，優先級最高"
              ],
              [
                "第 2 層 角色過濾",
                "角色群組",
                "為一整個角色（如「廠長」「生管人員」）設定統一過濾條件"
              ],
              [
                "第 3 層 人事組織過濾",
                "部門 / 利潤中心 / 事業處 / 事業群 / 組織代碼",
                "依人事系統的組織歸屬自動過濾，支援「依員工組織自動推導」"
              ],
              [
                "第 4 層 ERP Multi-Org 過濾",
                "製造組織 / 營運單位 / 帳套",
                "依 Oracle ERP 的 Multi-Org 架構過濾，控管跨廠區資料存取"
              ]
            ]
          },
          {
            "type": "comparison",
            "items": [
              {
                "title": "人事組織自動推導",
                "desc": "第 3 層設定「依員工組織自動推導（auto_from_employee）」時，系統自動讀取登入者在 HR 系統的部門、利潤中心、事業處、事業群歸屬，不需手動逐一指定每位員工，異動職位時自動生效。",
                "example": "",
                "borderColor": "blue"
              },
              {
                "title": "ERP Multi-Org 自動推導",
                "desc": "第 4 層設定「依員工組織自動推導」時，系統對應 Oracle ERP 中的製造組織代碼（如 Z4E）或營運單位，查詢時自動加上 ORGANIZATION_ID 或 ORG_ID 的 WHERE 條件，限制看到的廠區資料。",
                "example": "",
                "borderColor": "orange"
              }
            ]
          },
          {
            "type": "table",
            "headers": [
              "常見組織維度",
              "說明",
              "範例"
            ],
            "rows": [
              [
                "部門代碼（DEPT_CODE）",
                "依人事系統部門代碼過濾",
                "只看 MFG01 部門的資料"
              ],
              [
                "利潤中心（Profit Center）",
                "依利潤中心代碼過濾",
                "只看所屬利潤中心的損益資料"
              ],
              [
                "事業處（Org Section）",
                "依事業處代碼過濾",
                "中國廠 / 台灣廠 / 越南廠分隔"
              ],
              [
                "製造組織（Organization Code）",
                "對應 ERP mtl_parameters.organization_code",
                "如 Z4E（漳州廠）、TWE（台灣廠）"
              ],
              [
                "營運單位（Operating Unit）",
                "對應 Oracle MO 架構的 operating_unit 欄位",
                "區分不同 Operating Unit 的 AP/AR"
              ]
            ]
          },
          {
            "type": "note",
            "text": "**超級使用者（super_user）**：若管理員為特定使用者或角色設定第 3 / 4 層為「超級使用者（無限制）」，該帳號可查看所有組織的資料，不受組織過濾限制。通常僅授予 IT 管理人員或最高主管。"
          },
          {
            "type": "tip",
            "text": "若您查詢某廠區資料時顯示空白或數量明顯偏少，很可能是資料政策將您的可視範圍限制在特定組織。請洽系統管理員確認您的資料政策設定。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-ai-bi-query",
    "sort_order": 19,
    "icon": "BookMarked",
    "icon_color": "text-blue-600",
    "last_modified": "2026-04-15",
    "title": "命名查詢 / 報表範本",
    "sidebar_label": "命名查詢 / 報表範本",
    "blocks": [
      {
        "type": "para",
        "text": "命名查詢讓您把常用的自然語言問題、SQL、圖表設定存下來，下次只需從「我的查詢」清單一鍵載入，省去重複輸入。進階功能可定義查詢參數，執行前彈窗讓您輸入工廠代碼、日期範圍等條件，讓同一份範本適用不同情境。"
      },
      {
        "type": "subsection",
        "title": "儲存目前查詢",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "執行查詢並取得結果",
                "desc": "確認查詢結果正確後，頂端工具列的「💾 儲存」按鈕會亮起"
              },
              {
                "title": "點擊「💾 儲存」按鈕",
                "desc": "開啟「儲存為命名查詢」對話框"
              },
              {
                "title": "填寫基本資訊",
                "desc": "輸入名稱（必填）、說明（選填）、分類（選填，支援自由輸入或從已有分類選取）"
              },
              {
                "title": "勾選「載入後自動執行」（選用）",
                "desc": "勾選後，下次載入此查詢時系統會立即執行，不需再按發送"
              },
              {
                "title": "（選用）切換至「查詢參數」頁籤定義參數",
                "desc": "詳見下方「查詢參數設定」說明"
              },
              {
                "title": "點擊「儲存」完成",
                "desc": "查詢範本儲存成功後，可在左側「我的查詢」頁籤看到"
              }
            ]
          },
          {
            "type": "note",
            "text": "儲存時系統會自動帶入目前生成的 SQL（鎖定 SQL）、圖表設定及自然語言問題。下次執行時直接使用鎖定的 SQL，不會重新呼叫 AI，速度更快也更穩定。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "載入並執行命名查詢",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊左側邊欄的「我的查詢」頁籤（書籤圖示）",
                "desc": "顯示所有您建立或他人分享給您的命名查詢，依分類分組展示"
              },
              {
                "title": "點擊要載入的查詢名稱",
                "desc": "系統自動切換至對應 Design，並將問題帶入輸入框"
              },
              {
                "title": "若查詢有定義參數 → 自動彈出參數填值對話框",
                "desc": "填入工廠代碼、日期範圍等條件後點「執行查詢」"
              },
              {
                "title": "查詢執行，結果與圖表呈現",
                "desc": "若有設定圖表，會直接顯示圖表頁籤"
              }
            ]
          },
          {
            "type": "tip",
            "text": "滑鼠移到查詢項目上會出現「編輯」「分享」「刪除」三個操作按鈕，可快速管理查詢。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "編輯命名查詢",
        "blocks": [
          {
            "type": "para",
            "text": "在「我的查詢」清單中，滑鼠移到查詢名稱上，點擊「編輯」即可修改名稱、說明、分類、鎖定 SQL 及參數定義。也可以直接修改鎖定 SQL 欄位中的 SQL 語法，儲存後立即生效。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "查詢參數設定",
        "blocks": [
          {
            "type": "para",
            "text": "在儲存或編輯命名查詢時，切換至「查詢參數」頁籤可新增執行前填值的參數："
          },
          {
            "type": "table",
            "headers": [
              "欄位",
              "說明"
            ],
            "rows": [
              [
                "參數標籤（中文）",
                "顯示在填值對話框的標籤文字，例如「工廠代碼」"
              ],
              [
                "輸入類型",
                "單選下拉、多選下拉、日期範圍、數值範圍、自由輸入"
              ],
              [
                "來源 Schema / 來源欄位",
                "指定從哪個資料表的哪個欄位自動拉取可選值（執行時會查詢 DISTINCT 值）"
              ],
              [
                "注入方式",
                "WHERE IN / BETWEEN / LIKE / 直接取代文字 — 決定參數如何嵌入到 SQL"
              ],
              [
                "SQL Placeholder",
                "SQL 中對應的替換標記，例如 :FACTORY_CODE"
              ],
              [
                "必填",
                "勾選後，若未填值則阻止執行"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "日期範圍類型的參數支援「今天」「本月」「上月」快捷按鈕，使用者不必手動輸入。多選下拉會生成 IN (val1, val2, ...) 語法注入 SQL。"
          },
          {
            "type": "para",
            "text": "每個參數的「中文標籤」旁有一個「翻譯」按鈕（↻），點擊後系統會自動呼叫 AI 翻譯，將標籤翻成英文（EN）與越南文（VI），填入對應欄位，無需手動輸入多語版本。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "圖表設定（含複數 Y 軸）",
        "blocks": [
          {
            "type": "para",
            "text": "命名查詢儲存對話框的「圖表設定」頁籤，功能與圖表建構器完全一致，包含："
          },
          {
            "type": "table",
            "headers": [
              "功能",
              "說明"
            ],
            "rows": [
              [
                "多圖表管理",
                "可新增多張圖表，各自獨立設定欄位、類型、樣式"
              ],
              [
                "X / Y 軸欄位選擇",
                "從命名查詢儲存的欄位清單（available_columns）中選取"
              ],
              [
                "分組 / 堆疊維度",
                "在 Y 軸欄位設定後，可額外指定分組或堆疊維度（bar / line 適用）"
              ],
              [
                "複數 Y 軸（進階）",
                "啟用後可定義多條 Series，每條獨立設定欄位、聚合、類型（bar/line）、顏色、漸層、陰影、套疊、右軸等"
              ],
              [
                "顏色主題",
                "全局色票或自訂 Series 顏色"
              ],
              [
                "排序 / 數值門檻",
                "排序方式與最小值過濾"
              ],
              [
                "三語標題翻譯",
                "圖表標題、X / Y 軸名稱旁均有翻譯按鈕，一鍵填入英文與越南文"
              ]
            ]
          },
          {
            "type": "note",
            "text": "若儲存時查詢尚未執行（沒有 live 結果欄位），可在「圖表設定」頁籤下方的「手動新增欄位」輸入欄位代碼，讓 X / Y 欄位下拉選單有選項可選，不必重新執行查詢。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "分享命名查詢",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "滑鼠移到查詢名稱，點擊「分享」圖示",
                "desc": "開啟分享設定對話框"
              },
              {
                "title": "選擇分享對象類型",
                "desc": "可選：使用者 / 角色 / 廠區 / 部門 / 利潤中心 / 事業處 / 事業群（廠區用於跨廠共享，以 ERP 廠區代碼為單位）"
              },
              {
                "title": "搜尋並選取對象",
                "desc": "輸入姓名、帳號或工號搜尋使用者；廠區、部門等類型可輸入代碼或名稱即時過濾下拉清單"
              },
              {
                "title": "設定權限等級後點「+ 新增」",
                "desc": ""
              }
            ]
          },
          {
            "type": "table",
            "headers": [
              "權限等級",
              "可做的事"
            ],
            "rows": [
              [
                "使用權限",
                "可載入執行此查詢、另存為自己的版本，但無法修改原始設定"
              ],
              [
                "管理權限",
                "可修改查詢設定、管理分享名單（等同擁有者）"
              ]
            ]
          },
          {
            "type": "note",
            "text": "被分享使用者若想修改查詢，點「編輯」時系統會提示「另存為自己的版本」而非覆蓋原版，避免影響其他使用者。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-ai-bi-field",
    "sort_order": 20,
    "icon": "Server",
    "icon_color": "text-violet-500",
    "last_modified": "2026-04-01",
    "title": "Schema 欄位選擇器",
    "sidebar_label": "Schema 欄位選擇器",
    "blocks": [
      {
        "type": "para",
        "text": "Schema 欄位選擇器讓您直接從目前查詢任務的資料表欄位清單中勾選欄位，點一下即可將欄位名稱或中文說明插入到輸入框的游標位置，不必記住英文欄位名稱，提問更精確。"
      },
      {
        "type": "subsection",
        "title": "開啟欄位選擇器",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "先從左側選擇一個查詢任務（Design）",
                "desc": "欄位清單會根據該任務綁定的 Schema 資料表自動載入"
              },
              {
                "title": "點擊頂端工具列的「⊞ 欄位」按鈕",
                "desc": "右側欄位名稱旁出現 Popover 浮動面板"
              },
              {
                "title": "在搜尋框輸入關鍵字篩選欄位（選用）",
                "desc": "支援中文說明或英文欄位名稱搜尋"
              },
              {
                "title": "勾選一或多個欄位",
                "desc": "已勾選的欄位顯示藍底，底部出現「插入游標位置」按鈕"
              },
              {
                "title": "選擇插入方式",
                "desc": "「中文說明」插入欄位的業務語意名稱（推薦）；「欄位名稱」插入英文欄位代碼（適合需要精確指定時）"
              },
              {
                "title": "點擊「插入游標位置」",
                "desc": "所選欄位以頓號連接，插入到輸入框目前的游標位置"
              }
            ]
          },
          {
            "type": "tip",
            "text": "插入後可直接接著輸入問題，例如：先插入「工廠代碼、不良數量」後，加上「，請統計本月各廠的合計不良數量由高到低排序」。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "欄位清單說明",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "欄位資訊",
              "說明"
            ],
            "rows": [
              [
                "中文說明（左側）",
                "業務語意名稱，以當前 UI 語言（中 / 英 / 越）顯示"
              ],
              [
                "英文代碼（右側灰色）",
                "資料庫實際欄位名稱（column_name）"
              ],
              [
                "資料表分組",
                "欄位依所屬資料表分組，標題顯示資料表顯示名稱"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-ai-bi-chart",
    "sort_order": 21,
    "icon": "BarChart3",
    "icon_color": "text-purple-600",
    "last_modified": "2026-04-01",
    "title": "即時圖表建構器",
    "sidebar_label": "即時圖表建構器",
    "blocks": [
      {
        "type": "para",
        "text": "查詢出結果後，您可以使用圖表建構器即時設定圖表類型與欄位對應，系統在瀏覽器端直接聚合計算，不需要重新查詢 ERP，切換維度幾乎即時。設定完成後可儲存到命名查詢，下次直接呈現您自訂的圖表。"
      },
      {
        "type": "subsection",
        "title": "開啟圖表建構器",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "執行查詢並取得結果",
                "desc": "有結果後，頂端工具列的「📐 圖表」按鈕才會可用"
              },
              {
                "title": "點擊「📐 圖表」按鈕",
                "desc": "右側滑出圖表建構器面板，查詢結果和圖表左右並排顯示"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "基本設定",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "設定項目",
              "說明"
            ],
            "rows": [
              [
                "圖表類型",
                "📊 長條圖 / 📈 折線圖 / 🍕 圓餅圖 / ⚫ 散佈圖 / 🕸 雷達圖，點擊圖示切換"
              ],
              [
                "X 軸 / 類別欄位",
                "選擇橫軸（或圓餅標籤）欄位，通常是代碼或時間類欄位"
              ],
              [
                "Y 軸 / 數值欄位",
                "選擇要聚合計算的數值欄位（單 Y 軸模式）"
              ],
              [
                "聚合函數",
                "SUM / COUNT / AVG / MAX / MIN / COUNT_DISTINCT"
              ],
              [
                "顯示前幾筆",
                "取前 N 筆資料，預設 20 筆"
              ],
              [
                "圖表標題",
                "顯示在圖表上方的標題文字（支援三語翻譯按鈕）"
              ],
              [
                "X / Y 軸標題",
                "軸名稱說明文字，支援三語翻譯"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "聚合計算在瀏覽器端執行（Client-side），不需重跑 SQL。設定後點「▼ 預覽」即可即時看到圖表效果。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "排序與篩選",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "設定項目",
              "說明"
            ],
            "rows": [
              [
                "排序依據",
                "不排序 / 依 X 軸排序 / 依 Y 軸排序"
              ],
              [
                "排序方向",
                "升冪（ASC）/ 降冪（DESC）"
              ],
              [
                "數值門檻 (min_value)",
                "排除 Y 軸值 ≤ 此數的資料列，設為 0 可去除零值資料"
              ],
              [
                "圓餅 Top-N",
                "圓餅圖專用：依值由大到小取前 N 筆（其餘歸為其他或省略）"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "多維度設定（分組 / 堆疊）",
        "blocks": [
          {
            "type": "para",
            "text": "長條圖與折線圖可在 Y 軸欄位之外，再加入「分組維度」或「堆疊維度」，讓同一張圖呈現多個 Series。"
          },
          {
            "type": "table",
            "headers": [
              "設定",
              "效果",
              "適用場景"
            ],
            "rows": [
              [
                "分組維度 (Series)",
                "同一 X 類別下並排多根柱子或多條線，每個維度值一種顏色",
                "比較各廠 × 各月份的數量"
              ],
              [
                "堆疊維度 (Stack)",
                "同一 X 類別的柱子向上堆疊，各維度值疊加為整體",
                "顯示各產品佔每月總量的比例"
              ],
              [
                "分組 + 堆疊同時使用",
                "每組並排，組內疊色，適合 3D 分析",
                "廠區 × 機種 × 不良類別"
              ]
            ]
          },
          {
            "type": "note",
            "text": "設定分組或堆疊維度後，圖表建構器會直接傳入原始資料列，由 AiChart 內部在瀏覽器端 pivot 計算，不需重跑 SQL。「複數 Y 軸（進階）」模式啟用時，分組/堆疊維度會自動隱藏（兩者互斥）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "複數 Y 軸（進階 Method B）",
        "blocks": [
          {
            "type": "para",
            "text": "當您需要把兩個以上的指標放在同一張圖、或需要「柱狀＋折線」混合圖、或「套疊/子彈圖」效果時，可使用「複數 Y 軸」模式。在圖表建構器的「複數 Y 軸 (進階)」區塊，點「+ 新增 Y 軸 series」加入每一條 Series。"
          },
          {
            "type": "table",
            "headers": [
              "每條 Series 設定",
              "說明"
            ],
            "rows": [
              [
                "欄位",
                "該 Series 對應的資料欄位"
              ],
              [
                "聚合函數",
                "SUM / COUNT / AVG / MAX / MIN / COUNT_DISTINCT，與欄位搭配"
              ],
              [
                "類型 (Bar / Line)",
                "單張圖可混合柱狀與折線，實現 Combo Chart"
              ],
              [
                "顏色",
                "點選色塊選擇任意顏色（HTML color picker）"
              ],
              [
                "名稱 (Label)",
                "顯示在圖例（Legend）的 Series 名稱"
              ],
              [
                "寬度 (Bar only)",
                "柱子寬度，例如 40%（百分比）或 30（像素）"
              ],
              [
                "漸層",
                "柱子或折線加上由上到下的漸層填充效果"
              ],
              [
                "陰影",
                "柱子或折線加上外發光陰影效果，增加立體感"
              ],
              [
                "套疊 (Bar only)",
                "讓此柱子疊在前一條 Series 上（barGap: -100%），實現子彈圖效果"
              ],
              [
                "平滑 (Line only)",
                "折線以貝茲曲線圓滑顯示"
              ],
              [
                "面積 (Line only)",
                "折線下方填滿半透明顏色"
              ],
              [
                "右軸",
                "讓此 Series 使用右側 Y 軸，適合不同量級的指標並排顯示"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "子彈圖（Bullet Chart）做法：新增兩條 Bar Series，第一條寬度設 60%（背景），第二條寬度設 30%、勾選「套疊」（前景），兩條使用不同顏色，即可呈現目標值vs實際值的子彈圖效果。"
          },
          {
            "type": "note",
            "text": "啟用複數 Y 軸後，上方的單一 Y 軸欄位與分組/堆疊維度設定均會被忽略，圖表完全由 y_axes 陣列驅動。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "顏色主題",
        "blocks": [
          {
            "type": "para",
            "text": "在圖表建構器底部可選擇整體色票主題，影響所有 Series 的預設顏色（自訂顏色的 Series 不受影響）："
          },
          {
            "type": "table",
            "headers": [
              "主題",
              "色系說明"
            ],
            "rows": [
              [
                "預設（Power BI）",
                "藍橘紫綠，接近 Power BI 預設色票"
              ],
              [
                "藍 (Blue)",
                "深淺藍色系"
              ],
              [
                "綠 (Green)",
                "深淺綠色系"
              ],
              [
                "橘 (Orange)",
                "橘紅黃色系"
              ],
              [
                "紫 (Purple)",
                "深淺紫色系"
              ],
              [
                "青 (Teal)",
                "青藍色系"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "樣式選項",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "圖表類型",
              "可用樣式"
            ],
            "rows": [
              [
                "長條圖",
                "水平長條（Horizontal）、全域陰影（Shadow）"
              ],
              [
                "折線圖",
                "圓滑曲線（Smooth）、面積填滿（Area）、全域陰影（Shadow）"
              ],
              [
                "圓餅圖",
                "甜甜圈樣式（Donut）"
              ],
              [
                "全部",
                "顯示數值標籤（Show Label）、顯示圖例（Show Legend）、顯示格線（Show Grid）"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "多圖表",
        "blocks": [
          {
            "type": "para",
            "text": "同一份查詢結果可以加入多張圖表，分別設定不同的欄位組合。點頂部的「+ 新增」加入第二、第三張圖表，在結果區以頁籤切換。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "設定好第一張圖表後點「+ 新增」",
                "desc": ""
              },
              {
                "title": "切換到新頁籤，設定另一種欄位組合",
                "desc": "例如：第一張長條圖看「各廠異常數量」，第二張折線圖看「每日趨勢」"
              },
              {
                "title": "點「儲存圖表設定」寫回命名查詢",
                "desc": ""
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "儲存圖表設定",
        "blocks": [
          {
            "type": "para",
            "text": "點擊面板右上角的「儲存圖表設定」，系統將所有圖表設定寫入命名查詢（需已儲存命名查詢）。下次載入此命名查詢並執行後，圖表會自動呈現您設定好的樣式。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-ai-bi-shelf",
    "sort_order": 22,
    "icon": "Layers",
    "icon_color": "text-rose-500",
    "last_modified": "2026-04-01",
    "title": "Tableau 拖拉式設計器",
    "sidebar_label": "Tableau 拖拉式設計器",
    "blocks": [
      {
        "type": "para",
        "text": "Tableau 拖拉式設計器提供類似 Tableau Worksheet 的全螢幕操作介面，讓您把欄位直接拖到各個 Shelf（欄架），即時預覽圖表效果，不需要設定欄位名稱字串，視覺化操作更直覺。完成後點「套用」即可將圖表設定同步到 AI 戰情室。"
      },
      {
        "type": "subsection",
        "title": "開啟設計器",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "執行查詢並取得結果",
                "desc": "頂端工具列的「Tableau」按鈕（Layers 圖示）才會亮起"
              },
              {
                "title": "點擊工具列「Tableau」按鈕",
                "desc": "全螢幕覆蓋層彈出，左側是欄位清單，右側是 Shelf 區域與即時圖表預覽"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "欄位分類",
        "blocks": [
          {
            "type": "para",
            "text": "系統會自動分析資料，將欄位分類為「維度」與「量值」："
          },
          {
            "type": "table",
            "headers": [
              "類型",
              "顯示色",
              "判斷邏輯"
            ],
            "rows": [
              [
                "維度 (Dimension)",
                "藍色標籤",
                "取前 30 筆，數值佔比 < 70%（通常是代碼、名稱、日期類）"
              ],
              [
                "量值 (Measure)",
                "橘色標籤",
                "取前 30 筆，數值佔比 ≥ 70%（通常是數量、金額、比率類）"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "自動分類可能因資料特性有偏差，例如工廠代碼若全為數字會被歸為量值。您可以手動將任意欄位拖到任何 Shelf，分類僅供參考。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Shelf 說明",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "Shelf",
              "對應設定",
              "說明"
            ],
            "rows": [
              [
                "Columns（X 軸）",
                "x_field",
                "橫軸類別欄位，通常拖入維度欄位"
              ],
              [
                "Rows（Y 軸）",
                "y_field + y_agg",
                "縱軸量值欄位，右側選聚合函數"
              ],
              [
                "Color（顏色維度）",
                "series_field",
                "拖入後產生分組 Series，各維度值用不同顏色"
              ],
              [
                "Size（堆疊維度）",
                "stack_field",
                "拖入後產生堆疊效果，各維度值向上疊加"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "拖拉操作流程",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "從左側欄位清單抓取欄位",
                "desc": "長按後拖動，欄位上出現抓取游標（GripVertical 圖示）"
              },
              {
                "title": "拖到目標 Shelf 放開",
                "desc": "Shelf 出現藍色 hover 高亮時放開即可完成配置"
              },
              {
                "title": "同一 Shelf 可替換欄位",
                "desc": "再次拖入新欄位到已有欄位的 Shelf，會直接取代"
              },
              {
                "title": "點擊 Shelf 上的 ✕ 移除欄位",
                "desc": "清空該維度設定"
              },
              {
                "title": "圖表預覽即時更新",
                "desc": "每次變更 Shelf 配置，右側圖表預覽立刻重新計算並顯示"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "圖表類型與顯示選項",
        "blocks": [
          {
            "type": "para",
            "text": "設計器頂部工具列提供快速切換圖表類型，以及常用顯示開關："
          },
          {
            "type": "table",
            "headers": [
              "選項",
              "說明"
            ],
            "rows": [
              [
                "圖表類型",
                "長條圖 / 折線圖 / 圓餅圖 / 散佈圖 / 雷達圖，點擊切換"
              ],
              [
                "聚合函數 (Y Shelf)",
                "SUM / COUNT / AVG / MAX / MIN / COUNT_DISTINCT，僅影響 Y Shelf 欄位"
              ],
              [
                "顯示前 N 筆",
                "設定最多顯示幾筆資料，預設 20 筆"
              ],
              [
                "漸層",
                "長條圖柱子加上漸層填充"
              ],
              [
                "圓滑 (Line only)",
                "折線以圓滑曲線顯示"
              ],
              [
                "顯示標籤",
                "在各資料點上顯示數值"
              ],
              [
                "顯示圖例",
                "在圖表旁顯示 Series 名稱對照"
              ],
              [
                "顯示格線",
                "在圖表背景顯示輔助格線"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "套用與關閉",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "設計滿意後，點擊右上角「套用」按鈕",
                "desc": "圖表設定會同步回 AI 戰情室的圖表顯示，並標記為使用者自訂設定"
              },
              {
                "title": "點擊「關閉」或背景遮罩可不儲存直接退出",
                "desc": ""
              },
              {
                "title": "套用後繼續點「💾 儲存」可將 Tableau 設計的圖表設定永久寫入命名查詢",
                "desc": ""
              }
            ]
          },
          {
            "type": "note",
            "text": "Tableau 設計器產生的設定與圖表建構器（📐 圖表面板）共用同一份設定結構，可以在兩者之間互相切換精調。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-ai-bi-dashboard",
    "sort_order": 23,
    "icon": "Share2",
    "icon_color": "text-teal-600",
    "last_modified": "2026-04-15",
    "title": "儀表板 Dashboard Board",
    "sidebar_label": "儀表板 Dashboard",
    "blocks": [
      {
        "type": "para",
        "text": "儀表板讓您把多個命名查詢的圖表組合成一個總覽頁面，類似 Power BI 的 Report Page，每個圖表格（Tile）獨立執行查詢，可拖拉調整位置與大小，分享給指定同仁瀏覽。"
      },
      {
        "type": "subsection",
        "title": "進入儀表板",
        "blocks": [
          {
            "type": "para",
            "text": "在 AI 戰情室頂端工具列點擊「⊞」儀表板圖示，或直接訪問 `/dashboard/boards`，即可進入儀表板管理頁面。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "建立新儀表板",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊左側邊欄下方的「+ 新增儀表板」",
                "desc": ""
              },
              {
                "title": "輸入儀表板名稱（必填）、說明、分類",
                "desc": "分類用來在左側清單分組，例如「生產」「品質」「人力」"
              },
              {
                "title": "點「建立」完成",
                "desc": "新儀表板建立後自動選中，進入空白畫布"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "加入圖表 Tile",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊工具列「✏ 編輯佈局」進入編輯模式",
                "desc": ""
              },
              {
                "title": "從上方「+ 加入查詢...」下拉選擇一個命名查詢",
                "desc": "系統會在畫布加入一個新的圖表格，預設 6×4 格大小"
              },
              {
                "title": "重複加入多個命名查詢的圖表",
                "desc": ""
              },
              {
                "title": "拖拉 Tile 標題列調整位置",
                "desc": "藍色手把（標題列）可拖曳移動"
              },
              {
                "title": "拖拉 Tile 右下角調整大小",
                "desc": ""
              },
              {
                "title": "點「💾 儲存佈局」完成排版",
                "desc": ""
              }
            ]
          },
          {
            "type": "note",
            "text": "加入的命名查詢若有定義查詢參數，執行各 Tile 時會各自獨立彈出填值對話框，參數設定不會互相影響。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "執行與重新整理",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "操作",
              "說明"
            ],
            "rows": [
              [
                "點擊單一 Tile 的 🔄 按鈕",
                "重新執行該 Tile 的命名查詢並更新圖表"
              ],
              [
                "點擊工具列「🔄 重新整理全部」",
                "同時觸發所有 Tile 重新查詢（平行執行）"
              ],
              [
                "首次進入儀表板",
                "Tile 預設不自動執行，需手動點擊「點擊執行查詢」"
              ],
              [
                "命名查詢有設定「載入後自動執行」",
                "加入 Dashboard 後該 Tile 進入頁面時自動執行"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "分享儀表板",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊工具列「🔗 分享」按鈕",
                "desc": "開啟儀表板分享設定對話框"
              },
              {
                "title": "選擇分享對象類型",
                "desc": "可選：使用者 / 角色 / 廠區 / 部門 / 利潤中心 / 事業處 / 事業群（廠區用於跨廠共享，以 ERP 廠區代碼為單位）"
              },
              {
                "title": "搜尋並選取對象",
                "desc": "輸入姓名、帳號或工號搜尋使用者；廠區、部門等類型可輸入代碼或名稱即時過濾下拉清單"
              },
              {
                "title": "設定「使用權限」或「管理權限」後點「+ 新增」",
                "desc": ""
              }
            ]
          },
          {
            "type": "table",
            "headers": [
              "權限",
              "說明"
            ],
            "rows": [
              [
                "使用權限",
                "可瀏覽、執行儀表板內所有圖表；可另存為自己的版本"
              ],
              [
                "管理權限",
                "可修改儀表板佈局與分享名單"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "若儀表板包含的命名查詢未分享給對象，對象執行時會出現「查詢無法存取」錯誤。建議儀表板與其包含的命名查詢共享給相同對象。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "複製儀表板",
        "blocks": [
          {
            "type": "para",
            "text": "對被分享的儀表板，您可以選擇「另存為自己的版本」（Clone）取得一份獨立副本，修改後不影響原始儀表板。Clone 的操作入口在儀表板選項選單中。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "唯讀模式與權限說明",
        "blocks": [
          {
            "type": "para",
            "text": "儀表板依照您的權限顯示不同操作按鈕："
          },
          {
            "type": "table",
            "headers": [
              "您的權限",
              "能做的事",
              "介面提示"
            ],
            "rows": [
              [
                "管理權限（建立者或被授予管理）",
                "編輯佈局、新增/移除 Tile、調整大小、分享、刪除",
                "工具列顯示「編輯佈局」「分享」「刪除」按鈕"
              ],
              [
                "使用權限（被分享）",
                "執行查詢、查看圖表、另存副本（Clone）",
                "空白畫布時顯示「此儀表板為唯讀」提示，工具列不顯示編輯按鈕"
              ]
            ]
          },
          {
            "type": "note",
            "text": "若您看到「此儀表板為唯讀」提示而非「進入編輯模式加入圖表」，代表您對此儀表板只有使用權限。如需編輯，請聯繫儀表板建立者授予管理權限，或使用「另存副本」建立自己的版本。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-ai-bi-schema",
    "sort_order": 24,
    "icon": "Database",
    "icon_color": "text-cyan-600",
    "last_modified": "2026-04-01",
    "title": "Schema 與多資料庫來源",
    "sidebar_label": "Schema 與多資料庫來源",
    "blocks": [
      {
        "type": "para",
        "text": "AI 戰情室的自然語言查詢能力，建立在**多資料庫來源（DB Sources）**與 **Schema 知識庫**的設計上。設計者（具備「開發 AI 戰情室」權限的帳號）可以為不同的資料庫連線建立 Schema，讓 AI 知道哪些資料表可查、有哪些欄位、欄位代表什麼業務意義，從而生成精準的 SQL。系統支援 **Oracle、MySQL、MSSQL** 三種資料庫，且同一個查詢專案中可同時引用來自不同資料庫的多個 Schema，實現跨庫查詢。"
      },
      {
        "type": "subsection",
        "title": "整體架構概覽",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "層次",
              "名稱",
              "說明"
            ],
            "rows": [
              [
                "1",
                "外部資料來源（DB Source）",
                "系統管理員在後台設定的 Oracle/MySQL/MSSQL 連線，含 Host/Port/帳密/連線池"
              ],
              [
                "2",
                "戰情專案（Project）",
                "設計者建立的邏輯分組，一個專案包含多個 Schema + Topic + Design"
              ],
              [
                "3",
                "Schema 知識庫",
                "對應到 DB Source 中某個資料表/視圖/子查詢，並說明各欄位業務意義"
              ],
              [
                "4",
                "Join 定義",
                "說明 Schema 間的 JOIN 關係，輔助 AI 生成跨表 SQL"
              ],
              [
                "5",
                "主題 / 查詢任務（Topic / Design）",
                "終端使用者看到的查詢分類與具體任務，引用一或多個 Schema"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "每個 Schema 各自指定一個 DB Source，因此同一專案的不同 Schema 可以分別來自 Oracle ERP 主機、MySQL 分析資料庫、MSSQL 報表庫等不同系統，AI 生成 SQL 時會路由到正確的資料庫執行。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Step 1：設定外部資料來源（DB Source）",
        "blocks": [
          {
            "type": "para",
            "text": "進入後台管理 → 「AI 戰情室 — 外部資料來源」頁籤（系統管理員才能看到）。點擊「+ 新增來源」，填入以下欄位："
          },
          {
            "type": "table",
            "headers": [
              "欄位",
              "說明",
              "範例"
            ],
            "rows": [
              [
                "名稱",
                "此連線的識別用標籤",
                "ERP Oracle 主機、MySQL 分析庫"
              ],
              [
                "資料庫類型",
                "Oracle / MySQL / MSSQL",
                "oracle"
              ],
              [
                "Host",
                "資料庫伺服器 IP 或網域",
                "192.168.10.10"
              ],
              [
                "Port",
                "Oracle=1521，MySQL=3306，MSSQL=1433",
                "1521"
              ],
              [
                "Service Name（Oracle）",
                "Oracle Service Name / SID",
                "ORCL"
              ],
              [
                "Database Name（MySQL/MSSQL）",
                "目標資料庫名稱",
                "erp_db"
              ],
              [
                "帳號 / 密碼",
                "查詢帳號（建議使用唯讀帳號）",
                "apps / ••••••"
              ],
              [
                "Pool Min / Max",
                "連線池大小，依查詢頻率調整",
                "1 / 5"
              ],
              [
                "狀態",
                "啟用或停用此連線",
                "啟用"
              ]
            ]
          },
          {
            "type": "para",
            "text": "儲存後，可點擊每個來源的 **Wifi 圖示**測試連線（Ping），確認連線成功後才能在 Schema 中使用。"
          },
          {
            "type": "note",
            "text": "連線測試會實際執行 SELECT 1 驗證到達目標資料庫的網路與帳密是否正確。若顯示「連線失敗」，請確認防火牆已開放對應 Port 及帳號權限。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Step 2：在設計者介面建立 Schema",
        "blocks": [
          {
            "type": "para",
            "text": "具備「開發 AI 戰情室」權限的帳號，在 AI 戰情室底部點擊「⊞ 設計者模式」進入設計面板，選擇目標**專案**後，點擊「Schema 知識庫」頁籤，即可新增 Schema。"
          },
          {
            "type": "table",
            "headers": [
              "欄位",
              "說明"
            ],
            "rows": [
              [
                "資料表/視圖名稱",
                "格式為 OWNER.TABLE_NAME（如 APPS.WO_ABNORMAL_V）或純表名（如 WO_ABNORMAL_V）"
              ],
              [
                "顯示名稱（中/英/越）",
                "AI 提示詞與介面顯示用的友善名稱，儲存後自動翻譯英文/越文"
              ],
              [
                "別名（alias）",
                "SQL 中引用此 Schema 的短代號，如 wo_abnormal，需為小寫英數字"
              ],
              [
                "來源類型",
                "Table（實體表）/ View（視圖）/ SQL（自訂子查詢，可做複雜預處理）"
              ],
              [
                "資料來源（DB Source）",
                "從已設定的 DB Sources 選擇此 Schema 對應哪個資料庫連線"
              ],
              [
                "業務說明（business_notes）",
                "告訴 AI 此資料表的業務用途，影響 AI 生成 SQL 的準確性"
              ],
              [
                "Join 提示（join_hints）",
                "說明此表常見的 JOIN 條件，輔助跨表查詢"
              ],
              [
                "基礎過濾條件（Base Conditions）",
                "每次生成 SQL 都會自動加入的 WHERE 條件，如有效狀態過濾"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "**多資料庫跨庫設計**：同一個專案中，可以新增多個 Schema 各自指定不同的 DB Source。設計者在查詢任務（Design）的 Schema 欄位選擇器中勾選所需 Schema，AI 執行時會分別對各 Schema 對應的 DB Source 下查，再合併結果回傳。這樣可實現如「ERP Oracle + MySQL 分析庫」的跨庫自然語言查詢。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Step 3：管理 Schema 欄位說明",
        "blocks": [
          {
            "type": "para",
            "text": "Schema 建立後，點擊欄位清單圖示（Columns）進入欄位說明編輯介面，為每個欄位填入**業務意義說明**（description），這是 AI 正確理解欄位用途的關鍵："
          },
          {
            "type": "table",
            "headers": [
              "操作",
              "說明"
            ],
            "rows": [
              [
                "手動編輯說明",
                "逐欄填入中文業務說明，也可補充英文（desc_en）、越文（desc_vi）"
              ],
              [
                "匯出 CSV",
                "點「匯出 CSV」下載欄位清單，可在 Excel 批次填寫後再匯入"
              ],
              [
                "匯入 CSV",
                "填好的 CSV（欄位 column_name, description, desc_en, desc_vi）直接匯入更新"
              ],
              [
                "虛擬欄位（Virtual Column）",
                "定義計算欄位，如 TO_CHAR(order_date, 'YYYYMM') 作為年月分組維度"
              ],
              [
                "Oracle 函數範本",
                "虛擬欄位提供 Oracle 常用函數範本選單，如 TRUNC/EXTRACT/NVL/ROUND 等"
              ]
            ]
          },
          {
            "type": "note",
            "text": "欄位說明品質直接影響 AI 生成 SQL 的準確性。建議至少為查詢條件欄位、維度欄位、金額欄位填入中文說明。欄位說明可隨時更新，無需重建 Schema。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "從 Oracle 批次匯入 Schema",
        "blocks": [
          {
            "type": "para",
            "text": "若要快速將多個 Oracle ERP 資料表登錄到 Schema 知識庫，可使用**批次匯入**功能："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊 Schema 頁籤右上方「從 Oracle 批次匯入」按鈕",
                "desc": ""
              },
              {
                "title": "選擇資料來源（DB Source）",
                "desc": "選擇目標 Oracle 連線，通常為 ERP 主機"
              },
              {
                "title": "填寫預設 Owner（Schema Owner）",
                "desc": "如 APPS，系統在無前綴的表名前自動補上此 Owner"
              },
              {
                "title": "在文字框貼上資料表清單",
                "desc": "每行一個表名，格式範例：WO_ABNORMAL_V / APPS.MTL_SYSTEM_ITEMS_B / HR.EMPLOYEES（支援混搭不同 Owner）"
              },
              {
                "title": "點「開始匯入」",
                "desc": "系統向 Oracle Data Dictionary 查詢各表的欄位清單，自動建立 Schema 及欄位（每次最多 50 個表）"
              },
              {
                "title": "查看匯入結果",
                "desc": "成功的顯示 ✓ 表名 — N 欄；查無此表的顯示 ✗（請確認 Owner 與表名是否正確）"
              }
            ]
          },
          {
            "type": "tip",
            "text": "批次匯入只建立 Schema 骨架與欄位名稱/型態，欄位的**業務意義說明仍需手動補充**（或匯出 CSV 填寫後匯回）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "複製 Schema 到其他專案",
        "blocks": [
          {
            "type": "para",
            "text": "設計者可從其他專案複製現有 Schema 到目前專案，避免重複設定相同的 ERP 基礎表：點擊 Schema 清單右上方「複製來源 Schema」按鈕，搜尋並選取其他專案的 Schema 即可複製，複製後可獨立修改不影響原始。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "多資料庫查詢流程（進階）",
        "blocks": [
          {
            "type": "para",
            "text": "當一個查詢任務（Design）引用了來自不同 DB Source 的多個 Schema 時，查詢流程如下："
          },
          {
            "type": "table",
            "headers": [
              "步驟",
              "說明"
            ],
            "rows": [
              [
                "1. LLM SQL 生成",
                "AI 根據使用者問題與所有選取 Schema 的欄位說明，生成各個 Schema 對應的 SQL 片段"
              ],
              [
                "2. 路由執行",
                "後端依照每個 SQL 片段對應的 source_db_id，向對應的 DB Source 各自發出查詢"
              ],
              [
                "3. 結果合併",
                "各 DB 回傳結果後，若有跨庫 JOIN 需求則在應用層合併，最終整合回傳給前端"
              ],
              [
                "4. 資料政策套用",
                "每個 DB 查詢在生成 SQL 時均套用該使用者的資料政策過濾條件，確保資料安全"
              ]
            ]
          },
          {
            "type": "note",
            "text": "目前跨庫 JOIN 需在 LLM Prompt 層面透過業務說明指引 AI 生成分開的查詢再合併，不支援在同一 SQL 語句中跨庫 JOIN（因屬不同資料庫連線）。設計建議：若需跨 Oracle ERP + MySQL 的組合報表，可設計兩個 Design 分別查詢，或透過 ETL 預先將資料同步到單一庫後再設定 Schema。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-schedule",
    "sort_order": 25,
    "icon": "Clock",
    "icon_color": "text-green-500",
    "last_modified": "2026-04-01",
    "title": "自動排程功能",
    "sidebar_label": "自動排程功能",
    "blocks": [
      {
        "type": "para",
        "text": "排程任務可讓系統在指定時間自動執行 AI 分析，並將結果以 Email 寄送給您，或生成 PDF、Excel 等檔案供下載。適合每日新聞摘要、匯率通知、定期報表等重複性需求，完全不需要人工操作。"
      },
      {
        "type": "note",
        "text": "排程任務功能需由系統管理員開啟權限後才能使用。若左側邊欄看不到「排程任務」按鈕，請洽管理員申請。"
      },
      {
        "type": "subsection",
        "title": "建立我的第一個排程",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點選左側邊欄「排程任務」",
                "desc": "進入排程任務管理頁面"
              },
              {
                "title": "點選「新增任務」按鈕"
              },
              {
                "title": "填寫任務名稱與執行時間",
                "desc": "選擇每日、每週或每月，並設定幾點幾分執行"
              },
              {
                "title": "撰寫 AI Prompt（問題內容）",
                "desc": "告訴 AI 要做什麼，可以加入特殊語法讓 AI 抓取即時資料"
              },
              {
                "title": "填入 Email 收件地址",
                "desc": "AI 完成後自動寄報告給您"
              },
              {
                "title": "儲存並啟用",
                "desc": "狀態設為「執行中」即完成"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Prompt 中的自動變數",
        "blocks": [
          {
            "type": "para",
            "text": "在 Prompt 裡可以使用以下變數，系統執行時會自動帶入當天的實際值："
          },
          {
            "type": "table",
            "headers": [
              "寫法",
              "執行時替換為",
              "範例"
            ],
            "rows": [
              [
                "{{date}}",
                "執行當天日期",
                "2026-03-01"
              ],
              [
                "{{weekday}}",
                "執行當天星期幾",
                "星期六"
              ],
              [
                "{{task_name}}",
                "您設定的任務名稱",
                "台股日報"
              ]
            ]
          },
          {
            "type": "code",
            "text": "Prompt 範例\n\n今天是 {{date}}（{{weekday}}），\n請為「{{task_name}}」撰寫今日工作提醒摘要。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "抓取即時網路資料",
        "blocks": [
          {
            "type": "para",
            "text": "排程 Prompt 支援兩種方式讓 AI 自動抓取最新資料，不需要您手動複製貼上："
          },
          {
            "type": "list",
            "items": [
              "**抓取 API 或 RSS Feed** [fetch] — 適合新聞 API、RSS 訂閱、政府開放資料等直接回傳 JSON/XML 的網址\n`{{fetch:https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=10}}`",
              "**抓取一般網頁** [scrape] — 適合一般新聞文章、銀行匯率頁、供應商官網公告等 HTML 網頁\n`{{scrape:https://rate.bot.com.tw/xrt?Lang=zh-TW}}`"
            ]
          },
          {
            "type": "tip",
            "text": "同一個 Prompt 可以同時使用多個 fetch 和 scrape，AI 會將所有資料一起分析。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "讓 AI 生成可下載的檔案",
        "blocks": [
          {
            "type": "para",
            "text": "在 Prompt 末尾指示 AI 將報告輸出為特定格式，系統會自動生成檔案並附在 Email 中："
          },
          {
            "type": "table",
            "headers": [
              "檔案格式",
              "寫法範例"
            ],
            "rows": [
              [
                "PDF 報告",
                "generate_pdf:報告名稱_{{date}}.pdf"
              ],
              [
                "Excel 表格",
                "generate_xlsx:報告名稱_{{date}}.xlsx"
              ],
              [
                "Word 文件",
                "generate_docx:報告名稱_{{date}}.docx"
              ],
              [
                "PowerPoint",
                "generate_pptx:報告名稱_{{date}}.pptx"
              ],
              [
                "純文字",
                "generate_txt:報告名稱_{{date}}.txt"
              ]
            ]
          },
          {
            "type": "note",
            "text": "以上語法須以三個反引號（```）包覆，置於 Prompt 最後，再附上報告內容說明。詳細格式請參閱系統管理員版說明書。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "在 Prompt 中直接引用工具（技能 / 知識庫）",
        "blocks": [
          {
            "type": "para",
            "text": "撰寫排程 Prompt 時，可以直接在文字中引用已建立的技能（Skill）和知識庫（KB），系統執行時會自動呼叫對應的工具並將結果注入給 AI 分析。"
          },
          {
            "type": "table",
            "headers": [
              "語法",
              "說明",
              "範例"
            ],
            "rows": [
              [
                "{{skill:技能名稱}}",
                "執行指定技能，將技能回傳結果注入對話背景",
                "{{skill:匯率查詢}}"
              ],
              [
                "{{kb:知識庫名稱}}",
                "從指定知識庫查詢與 Prompt 相關的段落，注入背景",
                "{{kb:產品規格庫}}"
              ]
            ]
          },
          {
            "type": "code",
            "text": "Prompt 引用工具範例\n\n今天是 {{date}}（{{weekday}}），\n請根據以下最新匯率資料 {{skill:匯率查詢}}\n以及生產 SOP 規定 {{kb:製程標準庫}}\n整理本日需注意事項並以繁體中文條列輸出。"
          },
          {
            "type": "tip",
            "text": "撰寫 Prompt 時，輸入 `{{skill:` 或 `{{kb:` 後，系統會自動彈出技能 / 知識庫名稱選單供快速選取，也可用斜線 `/` 觸發同樣的選單。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Pipeline 管線：串接多步驟工作流程",
        "blocks": [
          {
            "type": "para",
            "text": "Pipeline 讓一個排程任務依序執行多個步驟（節點），前一步的結果可作為後一步的輸入，適合需要「查資料 → 分析 → 生成報告 → 寄信」等多階段自動化作業。"
          },
          {
            "type": "para",
            "text": "在任務編輯頁切換至「**Pipeline 管線**」頁籤，點「+ 新增節點」加入步驟。"
          },
          {
            "type": "table",
            "headers": [
              "節點類型",
              "圖示",
              "說明",
              "適用場景"
            ],
            "rows": [
              [
                "技能（Skill）",
                "⚡ 黃色",
                "呼叫指定技能，將技能回傳結果存入輸出變數",
                "即時查詢庫存、呼叫外部 API"
              ],
              [
                "MCP 工具",
                "🔧 紫色",
                "直接呼叫 MCP 伺服器的指定工具，傳入 args 參數",
                "搜尋 Oracle 程式、ERP 資料查詢"
              ],
              [
                "知識庫（KB）",
                "📖 綠色",
                "以 query 文字查詢指定知識庫，取得相關段落",
                "查 SOP、產品規格、技術文件"
              ],
              [
                "AI 追加（AI）",
                "🤖 藍色",
                "讓 AI 對前一步的結果再做分析/整理，需撰寫 Prompt",
                "整合多個來源後做二次摘要"
              ],
              [
                "生成檔案",
                "📤 靛色",
                "將前一步 AI 輸出生成特定格式檔案",
                "輸出 Excel / PDF / PPT / Word"
              ],
              [
                "條件判斷",
                "🌿 玫瑰色",
                "根據前一步輸出進行分支（if/else），支援 AI 判斷或文字比對",
                "根據異常數量高低分流"
              ],
              [
                "並行執行",
                "⑁ 青色",
                "將多個子步驟同時執行，加速多路查詢",
                "同時查多個知識庫、多個 API"
              ]
            ]
          },
          {
            "type": "para",
            "text": "每個節點都可設定「**失敗時行為**」："
          },
          {
            "type": "table",
            "headers": [
              "失敗行為",
              "說明"
            ],
            "rows": [
              [
                "continue（繼續）",
                "此步驟失敗後跳過，繼續執行下一個節點"
              ],
              [
                "stop（停止）",
                "此步驟失敗後中止整個 Pipeline，不寄出報告"
              ],
              [
                "goto（跳轉）",
                "此步驟失敗後跳到指定節點 ID 繼續執行"
              ]
            ]
          },
          {
            "type": "code",
            "text": "Pipeline 典型流程範例\n\n[1] MCP 工具：查詢本日 ERP 不良工單數量\n    ↓\n[2] 知識庫：查詢相關 SOP 改善措施\n    ↓\n[3] AI 追加：整合以上資料，撰寫異常摘要報告\n    ↓\n[4] 生成檔案：輸出為 Excel，檔名 異常報告_{{date}}.xlsx\n    ↓（寄出 Email 附附件）"
          },
          {
            "type": "tip",
            "text": "Pipeline 與 Prompt 可以同時使用：Prompt 作為主要的 AI 指示，Pipeline 則在 Prompt 執行前先完成資料收集步驟，Pipeline 的最終輸出會自動注入到 Prompt 的執行上下文中。"
          },
          {
            "type": "note",
            "text": "Pipeline 節點數量較多時執行時間會增加，建議使用並行節點加速獨立的查詢步驟。若無需多步驟，直接在 Prompt 中使用 `{{skill:}}` / `{{kb:}}` 語法即可，更簡潔。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-training",
    "sort_order": 26,
    "icon": "GraduationCap",
    "icon_color": "text-emerald-500",
    "last_modified": "2026-04-16",
    "title": "教育訓練教室",
    "sidebar_label": "教育訓練",
    "blocks": [
      {
        "type": "para",
        "text": "教育訓練教室提供互動式學習課程，支援**操作導引**、**拖放練習**、**即時測驗**等多種互動方式。您可以在學習模式中自由探索教材，也可以在測驗模式中驗收學習成果。"
      },
      {
        "type": "tip",
        "text": "從側邊欄「更多功能」→「教育訓練」進入訓練教室。"
      },
      {
        "type": "subsection",
        "title": "課程列表",
        "blocks": [
          {
            "type": "para",
            "text": "進入訓練教室後，您會看到所有**已發佈**且您有權限存取的課程。課程以卡片方式排列，顯示："
          },
          {
            "type": "list",
            "items": [
              "課程標題、說明、封面圖片",
              "建立者與分類",
              "您的學習進度（未開始/進行中/已完成）",
              "測驗紀錄摘要（測驗次數、平均分、最高分）"
            ]
          },
          {
            "type": "para",
            "text": "可使用左側**分類篩選**和上方**搜尋框**快速找到課程。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "課程詳情",
        "blocks": [
          {
            "type": "para",
            "text": "點擊課程卡片進入詳情頁，可看到："
          },
          {
            "type": "list",
            "items": [
              "課程資訊：標題、說明、章節數、及格分數",
              "章節列表：每章的學習進度",
              "測驗主題：管理員建立的不同測驗組合，每個有獨立的滿分和時間設定",
              "我的測驗紀錄：歷次測驗的分數、用時、日期"
            ]
          },
          {
            "type": "para",
            "text": "底部有兩個按鈕："
          },
          {
            "type": "list",
            "items": [
              "📖 **開始學習/繼續學習**：進入學習模式，可自由瀏覽所有投影片",
              "📝 **練習測驗**：進入整門課程的測驗模式"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "學習模式（Learn）",
        "blocks": [
          {
            "type": "para",
            "text": "學習模式下您可以自由瀏覽教材，不會計分。功能包含："
          },
          {
            "type": "list",
            "items": [
              "鍵盤導航：← → 或 Space 切換投影片",
              "語音導覽：自動播放投影片旁白（可靜音）",
              "章節大綱：左側顯示所有章節和投影片",
              "筆記功能：右側面板可對每張投影片記錄筆記",
              "AI 助教：右側面板可以即時提問，AI 會根據當前教材內容回答"
            ]
          },
          {
            "type": "subsection",
            "title": "互動教材類型",
            "blocks": [
              {
                "type": "table",
                "headers": [
                  "類型",
                  "操作方式"
                ],
                "rows": [
                  [
                    "Hotspot（導引模式）",
                    "依序點擊正確的區域，系統會引導你一步步完成操作"
                  ],
                  [
                    "Hotspot（探索模式）",
                    "自由點擊截圖上的各個區域，了解每個元素的功能"
                  ],
                  [
                    "拖放排序",
                    "拖曳項目到正確的位置或順序"
                  ],
                  [
                    "拖放配對",
                    "將左側項目拖曳到右側對應的目標區域"
                  ],
                  [
                    "翻轉卡片",
                    "點擊卡片翻轉查看正反面內容"
                  ],
                  [
                    "情境分支",
                    "閱讀情境後選擇最佳選項，系統會跳轉到對應內容"
                  ],
                  [
                    "即時測驗",
                    "單選/多選/填空題，立即作答並查看結果"
                  ]
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "測驗模式（Test）",
        "blocks": [
          {
            "type": "para",
            "text": "測驗模式用於正式評量。進入測驗前會看到**測驗起始畫面**，顯示："
          },
          {
            "type": "list",
            "items": [
              "📊 滿分：例如 100 分",
              "📋 題數：互動投影片數量",
              "⏱ 時間限制：例如 10 分鐘",
              "✅ 及格標準：例如 60 分"
            ]
          },
          {
            "type": "para",
            "text": "點擊「開始測驗」後："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "倒數計時開始",
                "desc": "右上角顯示剩餘時間，不足 2 分鐘時紅色閃爍警示"
              },
              {
                "title": "逐題作答",
                "desc": "系統只顯示互動投影片，完成後自動跳到下一題"
              },
              {
                "title": "即時分數",
                "desc": "每題完成後右上角顯示該題得分（如 18/20）"
              },
              {
                "title": "結果畫面",
                "desc": "全部完成或時間到時顯示總分、及格判定、每題明細"
              }
            ]
          },
          {
            "type": "note",
            "text": "測驗中無法使用章節大綱、筆記、AI 助教等功能，也無法手動切換投影片。"
          },
          {
            "type": "subsection",
            "title": "錯題分析",
            "blocks": [
              {
                "type": "para",
                "text": "在結果畫面中，未滿分的題目可以點擊展開查看**錯題分析**，包含："
              },
              {
                "type": "list",
                "items": [
                  "步驟完成度（如 2/4 步完成）",
                  "錯誤點擊次數和位置",
                  "拖放題的正確配對數",
                  "選擇題的答對/答錯情形"
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "測驗主題",
        "blocks": [
          {
            "type": "para",
            "text": "一門課程可以有多個**測驗主題**，每個主題只包含部分章節，有各自的滿分、及格分數和時間限制。"
          },
          {
            "type": "para",
            "text": "例如「基礎操作」只考登入和對話，「進階功能」只考 AI 工具。您可以在課程詳情頁選擇要參加的測驗主題。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "必修 / 選修章節",
        "blocks": [
          {
            "type": "para",
            "text": "每個章節會標示為**必修**或**選修**，成績面板（課程專案內）以及使用者手冊「互動教學」連結旁都會顯示對應徽章："
          },
          {
            "type": "list",
            "items": [
              "🔴 **必修**（紅色徽章）：此章節的測驗分數會計入最終成績",
              "⚪ **選修**（灰色徽章）：依課程或課程專案設定而定，可能不計分"
            ]
          },
          {
            "type": "para",
            "text": "若該課程或課程專案啟用「**只計必修分數**」："
          },
          {
            "type": "list",
            "items": [
              "選修章節的題目仍會出現在測驗中，學員可以照常作答並獲得即時回饋",
              "但選修章節的得分與配分**都不計入最終成績**",
              "必修章節的配分會自動重新分配佔滿 100%（例如原本 5 章各 20%，只計 4 章必修後變為各 25%）",
              "成績面板中的選修章節會以灰色 + 「不計分」標示，讓您清楚知道哪些章節影響通過判定"
            ]
          },
          {
            "type": "tip",
            "text": "從使用者手冊「互動教學」按鈕旁的紅/灰徽章，可以一眼看出該章節是不是必學的。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "多語言支援",
        "blocks": [
          {
            "type": "para",
            "text": "教育訓練支援**繁體中文、英文、越南文**三種語言。切換系統語言後，課程標題、章節名稱、投影片內容和語音導覽都會自動切換為對應語言版本（需課程管理員已翻譯）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "常見問題",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "問題",
              "說明"
            ],
            "rows": [
              [
                "找不到課程？",
                "課程必須已發佈且您有存取權限。請洽系統管理員。"
              ],
              [
                "語音沒有聲音？",
                "請確認瀏覽器未靜音，並點擊播放器上的喇叭圖示取消靜音。"
              ],
              [
                "測驗分數在哪裡看？",
                "課程詳情頁的「我的測驗紀錄」區塊，或課程列表卡片上的摘要。"
              ],
              [
                "可以重新測驗嗎？",
                "可以，在結果畫面點擊「重新測驗」即可。"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-training-dev",
    "sort_order": 27,
    "icon": "BookOpen",
    "icon_color": "text-violet-500",
    "last_modified": "2026-04-16",
    "title": "教育訓練管理使用手冊",
    "sidebar_label": "教材開發",
    "blocks": [
      {
        "type": "para",
        "text": "本手冊適用於擁有**上架權限**或**編輯權限**的使用者。您可以建立課程、編輯教材內容、管理題庫和測驗主題，以及查看學員成績報表。"
      },
      {
        "type": "note",
        "text": "此手冊僅對擁有教育訓練「上架權限」或「上架及編輯權限」的使用者顯示。"
      },
      {
        "type": "subsection",
        "title": "⚡ 效率提示：用 Alt + M 語音輸入",
        "blocks": [
          {
            "type": "para",
            "text": "教材編輯有**大量文字要打**：課程描述、章節標題、投影片內容、答案解析、提示框、翻卡正反面、步驟說明、Hotspot 各模式旁白、AI 錄製步驟備註… 全部都能用嘴巴講，比打字快 3-5 倍。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "滑鼠先點進任何 textarea / input 輸入框",
                "desc": "例如「答案解析」、「課程描述」、「翻卡正面」"
              },
              {
                "title": "按下 Alt + M",
                "desc": "畫面右下角浮出小錄音 UI（紅圈閃爍 + 音量條 + 倒數秒數）"
              },
              {
                "title": "對著麥克風講話（最長 180 秒）",
                "desc": "系統會即時辨識，講完按 Alt + M 或 Esc 停止"
              },
              {
                "title": "辨識結果自動插入到游標位置",
                "desc": "不會覆蓋既有文字，可繼續用 Alt+M 接著講或手動修改"
              }
            ]
          },
          {
            "type": "table",
            "headers": [
              "編輯場景",
              "建議用法"
            ],
            "rows": [
              [
                "基本資訊：課程描述",
                "直接用講的快速產一段介紹"
              ],
              [
                "投影片：文字區塊（Markdown）",
                "先講內容再手動加 Markdown 格式"
              ],
              [
                "投影片：步驟說明",
                "一句一個步驟連續講"
              ],
              [
                "投影片：提示框 / 分支情境",
                "把腦中的情境直接念出來"
              ],
              [
                "投影片：翻卡正反面",
                "正面講完按 Alt+M 停 → 點到反面 → 再按 Alt+M"
              ],
              [
                "Hotspot：補充說明 / 引導 / 測驗 / 探索旁白",
                "4 個欄位用講的最快"
              ],
              [
                "Hotspot：AI 錄製步驟備註",
                "錄製完每個步驟講一句說明"
              ],
              [
                "即時測驗：題目 / 答案解析",
                "念出題目和為什麼這樣選"
              ],
              [
                "多語言介紹 / 區域旁白",
                "切到對應語系後直接講該語言"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "**支援多語**：系統會依您介面語系自動選擇辨識語言。要錄外語版本前先到右上角切換語系即可。例如先把介面切到 English，再到外語底圖管理欄位按 Alt+M 講英文。"
          },
          {
            "type": "note",
            "text": "**首次使用**瀏覽器會跳出麥克風權限請求，請點「允許」。若不小心拒絕，請到瀏覽器網址列左側鎖頭圖示重新開啟。詳細用法與常見問題請參閱「語音輸入」章節。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "課程管理",
        "blocks": [
          {
            "type": "para",
            "text": "從教育訓練頁面切換到**課程管理**模式，可看到您建立的所有課程（含草稿和已封存）。"
          },
          {
            "type": "subsection",
            "title": "建立新課程",
            "blocks": [
              {
                "type": "steps",
                "items": [
                  {
                    "title": "點擊「新增課程」",
                    "desc": "進入課程編輯器"
                  },
                  {
                    "title": "填寫基本資訊",
                    "desc": "課程標題（必填）、描述、分類、及格分數"
                  },
                  {
                    "title": "儲存",
                    "desc": "課程建立為草稿狀態"
                  }
                ]
              }
            ]
          },
          {
            "type": "subsection",
            "title": "匯入/匯出封包",
            "blocks": [
              {
                "type": "para",
                "text": "可將完整課程（含所有章節、投影片、題目、翻譯、音訊檔案）打包成 ZIP 檔案，用於環境遷移或備份。"
              },
              {
                "type": "list",
                "items": [
                  "**匯出**：在課程編輯器 header 點擊「匯出封包」下載 ZIP",
                  "**匯入**：在課程管理頁面點擊「匯入封包」上傳 ZIP，系統自動建立新課程"
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "課程編輯器",
        "blocks": [
          {
            "type": "para",
            "text": "課程編輯器有以下分頁："
          },
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "title": "📝 基本資訊",
                "desc": "標題、描述、分類、及格分數",
                "color": "blue"
              },
              {
                "title": "📚 章節管理",
                "desc": "新增/刪除/排序章節，管理投影片",
                "color": "green"
              },
              {
                "title": "❓ 題庫",
                "desc": "建立期末測驗題目（單選/多選/填空/配對/排序）",
                "color": "purple"
              },
              {
                "title": "📝 測驗主題",
                "desc": "建立不同章節組合的測驗，各自設定分數和時間",
                "color": "orange"
              },
              {
                "title": "🌐 翻譯",
                "desc": "AI 一鍵翻譯為英文和越南文",
                "color": "cyan"
              },
              {
                "title": "🔗 分享",
                "desc": "設定課程存取權限（使用者/角色/廠區/部門/利潤中心/事業處/事業群）",
                "color": "rose"
              },
              {
                "title": "📊 成績",
                "desc": "學員互動成績報表（課程/投影片/使用者三維度）",
                "color": "teal"
              },
              {
                "title": "⚙ 設定",
                "desc": "測驗設定（總分/時間/配分）、TTS 聲音、AI 模型",
                "color": "slate"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "章節必修 / 配分設定（2026-04-16 新增）",
        "blocks": [
          {
            "type": "para",
            "text": "在「章節管理」分頁中，每個章節的刪除按鈕左邊新增兩個欄位："
          },
          {
            "type": "list",
            "items": [
              "☑ **必修**（紅字）：預設勾選。未勾選則標示為選修，在成績面板與使用者手冊中以灰色徽章顯示",
              "**配分** 數字輸入（預設 10）：該章節在測驗中的**權重比例**，非絕對分數"
            ]
          },
          {
            "type": "tip",
            "text": "配分是「相對比例」而非固定分數。系統會依所有納入計算章節的配分總和歸一到測驗總分。例如：5 個章節各配 20（總和 100），每章佔 1/5 滿分；若改成各配 2（總和 10），結果完全一樣，只是單位不同。"
          },
          {
            "type": "subsection",
            "title": "測驗設定：只計必修分數",
            "blocks": [
              {
                "type": "para",
                "text": "在「設定」分頁的**測驗設定**區塊（總分、及格分數、時間限制下方），新增「**只計必修分數**」checkbox。"
              },
              {
                "type": "para",
                "text": "勾選後的計分行為："
              },
              {
                "type": "list",
                "items": [
                  "選修章節的題目**仍會出現在測驗**中，學員可照常作答，避免遺漏學習內容",
                  "選修章節的**得分與配分**皆不計入最終分數",
                  "必修章節的配分會**自動 rescale 到 100%**（按原比例分配）",
                  "最終分數 = 必修章節得分加總 ÷ 必修章節配分加總 × 測驗總分"
                ]
              },
              {
                "type": "table",
                "headers": [
                  "情境",
                  "原配分",
                  "勾選後實際佔比"
                ],
                "rows": [
                  [
                    "章節 1（必修）",
                    "20",
                    "25%"
                  ],
                  [
                    "章節 2（必修）",
                    "20",
                    "25%"
                  ],
                  [
                    "章節 3（必修）",
                    "20",
                    "25%"
                  ],
                  [
                    "章節 4（必修）",
                    "20",
                    "25%"
                  ],
                  [
                    "章節 5（選修）",
                    "20",
                    "不計分"
                  ]
                ]
              },
              {
                "type": "note",
                "text": "此設定作為「課程層級預設」；同一課程加入到不同「課程專案」時，每個專案可以個別覆蓋是否只計必修。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "課程專案：覆蓋章節必修 / 配分",
            "blocks": [
              {
                "type": "para",
                "text": "在課程專案（Program）編輯器中，每個課程卡片展開後，每個章節旁新增："
              },
              {
                "type": "list",
                "items": [
                  "紅色「**必修**」/ 灰色「**選修**」小徽章：點擊即可切換覆蓋狀態（還原為課程預設時自動清除覆蓋）",
                  "**配分**欄位初始值讀自課程預設（章節的 SCORE_WEIGHT），可在專案層級另行調整",
                  "課程卡片底部新增「**只計必修分數**」checkbox，覆蓋課程預設"
                ]
              },
              {
                "type": "para",
                "text": "勾選「只計必修分數」時，每個必修章節的配分欄位右側會即時顯示「**必修佔 XX%**」預覽，選修章節灰掉並標示「不計分」。"
              },
              {
                "type": "tip",
                "text": "預設所有覆蓋都跟隨課程設定。只有當您在此專案要求不同的必修/配分組合時才做覆蓋——保持原樣可讓課程更新時自動同步。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "Help 使用者手冊的必修徽章",
            "blocks": [
              {
                "type": "para",
                "text": "若您在 Admin 介面將 Help 章節綁定到某個教材章節（linked_lesson_id），則使用者手冊中該章節標題旁的「🎓 互動教學」按鈕旁，會自動依據該 lesson 的必修狀態顯示紅色「必修」或灰色「選修」徽章。"
              },
              {
                "type": "para",
                "text": "這讓讀手冊的使用者一眼就能判斷：「這個功能對應的教材是否為必修」。"
              },
              {
                "type": "note",
                "text": "只有綁定到 lesson 層級（`linked_lesson_id`）才會顯示徽章；若只綁到 course 層級則不顯示。"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "投影片編輯",
        "blocks": [
          {
            "type": "para",
            "text": "在章節管理中點擊投影片進入**投影片編輯器**，可新增以下類型的內容區塊："
          },
          {
            "type": "table",
            "headers": [
              "區塊類型",
              "說明"
            ],
            "rows": [
              [
                "文字",
                "Markdown 格式文字編輯"
              ],
              [
                "圖片",
                "上傳圖片或輸入 URL"
              ],
              [
                "影片",
                "上傳影片或嵌入 YouTube/Vimeo"
              ],
              [
                "步驟",
                "帶有編號的操作步驟列表"
              ],
              [
                "提示框",
                "提示/警告/注意/重要四種樣式"
              ],
              [
                "Hotspot",
                "上傳截圖 → 繪製互動區域 → 設定導引/測驗腳本"
              ],
              [
                "拖放",
                "排序/配對/分類三種模式"
              ],
              [
                "翻轉卡片",
                "正反面學習卡片"
              ],
              [
                "情境分支",
                "情境選擇題 + 跳轉邏輯"
              ],
              [
                "即時測驗",
                "嵌入式單選/多選/填空題"
              ]
            ]
          },
          {
            "type": "para",
            "text": "每張投影片的右側面板可以設定**語音旁白**，支援 TTS 自動生成、麥克風錄音、手動上傳音訊。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "Hotspot 互動區域編輯",
        "blocks": [
          {
            "type": "para",
            "text": "Hotspot 是最核心的互動教材類型，用於模擬系統操作。編輯流程："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "上傳系統截圖",
                "desc": "或使用 AI 錄製功能自動截圖"
              },
              {
                "title": "繪製互動區域",
                "desc": "在截圖上拖拉繪製矩形區域，標記正確/錯誤"
              },
              {
                "title": "設定區域屬性",
                "desc": "標籤名稱、回饋文字、學習導引語音、測驗提示、探索說明"
              },
              {
                "title": "AI 生成腳本",
                "desc": "點擊「AI 生成全套導覽腳本 + 語音」自動填寫所有文字和語音"
              }
            ]
          },
          {
            "type": "para",
            "text": "每個正確區域有三種語音："
          },
          {
            "type": "list",
            "items": [
              "📖 **學習導引**：學習模式下播放的詳細說明",
              "📝 **測驗提示**：測驗模式下錯誤多次後給的提示",
              "🔍 **探索說明**：探索模式下點擊時的簡要說明"
            ]
          },
          {
            "type": "subsection",
            "title": "多語言底圖管理",
            "blocks": [
              {
                "type": "para",
                "text": "如果不同語言的系統介面截圖不同（如按鈕文字不同），可以在「多語底圖管理」面板為每個語言上傳不同的截圖，並獨立調整互動區域的位置和語音。"
              },
              {
                "type": "para",
                "text": "每個語言的 region 可以選擇**繼承主語言**或**獨立設定**。獨立設定時可調整區域位置、大小，以及對應語言的文字和語音。"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "AI 錄製功能",
        "blocks": [
          {
            "type": "para",
            "text": "使用 Chrome 擴充功能錄製系統操作步驟："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "安裝 Chrome Extension",
                "desc": "從 chrome://extensions 載入擴充功能"
              },
              {
                "title": "登入並取得 Session ID",
                "desc": "在課程編輯器點擊「AI 錄製」取得 Session ID"
              },
              {
                "title": "開始錄製",
                "desc": "Extension popup 貼上 Session ID → 開始錄製 → 操作目標系統"
              },
              {
                "title": "停止並生成教材",
                "desc": "停止錄製 → AI 自動辨識每個操作步驟 → 生成互動投影片"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "測驗主題管理",
        "blocks": [
          {
            "type": "para",
            "text": "在「測驗主題」分頁建立不同的測驗組合："
          },
          {
            "type": "list",
            "items": [
              "設定標題（如「基礎操作」「進階功能」「全系統」）",
              "勾選要包含的章節",
              "設定獨立的滿分、及格分數、時間限制",
              "設定超時處理方式（自動結算或提醒繼續）",
              "配分方式：平均分配或自訂每題權重"
            ]
          },
          {
            "type": "para",
            "text": "學員在課程詳情頁可看到所有測驗主題，選擇後開始測驗。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "翻譯",
        "blocks": [
          {
            "type": "para",
            "text": "在「翻譯」分頁可以將課程內容 AI 翻譯為英文和越南文。翻譯採用 **Batch 並行化** 技術（5 張投影片/次 LLM call，10 並行），大幅提升翻譯速度。"
          },
          {
            "type": "para",
            "text": "**翻譯範圍**："
          },
          {
            "type": "list",
            "items": [
              "課程標題和描述",
              "章節名稱",
              "投影片文字內容、旁白和 Hotspot 區域文字（label、narration、feedback、測驗提示、探索說明）",
              "題目和選項"
            ]
          },
          {
            "type": "para",
            "text": "**翻譯後語音生成**：點擊「🔊 生成 English/Tiếng Việt 語音」按鈕，系統會以 SSE 串流方式並行生成所有語音（10 並行），進度條即時顯示。"
          },
          {
            "type": "subsection",
            "title": "獨立區域與翻譯工作流",
            "blocks": [
              {
                "type": "para",
                "text": "因為不同語言的介面截圖、文字長度不同，Hotspot 互動區域的位置可能需要調整。系統提供以下完整工作流："
              },
              {
                "type": "steps",
                "items": [
                  {
                    "title": "步驟 1：翻譯",
                    "desc": "在翻譯 Tab 點擊「重新翻譯」，系統自動翻譯所有投影片內容和 Hotspot 文字"
                  },
                  {
                    "title": "步驟 2：生成語音",
                    "desc": "翻譯完成後點擊「生成語音」，為所有翻譯內容生成對應語言的 TTS 語音"
                  },
                  {
                    "title": "步驟 3：調整互動區域",
                    "desc": "進入投影片編輯器 → 多語底圖管理面板 → 選擇語言 Tab（EN / VI）"
                  },
                  {
                    "title": "步驟 4：建立獨立區域",
                    "desc": "點擊「建立獨立區域（使用翻譯結果）」按鈕，系統自動帶入已翻譯好的文字和語音，您只需拖拉調整框的位置"
                  },
                  {
                    "title": "步驟 5：儲存",
                    "desc": "調整完位置後點擊「儲存」"
                  }
                ]
              },
              {
                "type": "tip",
                "text": "如果之後重新翻譯或重新生成語音，點擊獨立區域旁的「🔄 從翻譯結果同步」按鈕即可更新文字和語音，座標位置保持不變。也可以在翻譯 Tab 勾選「同步更新已獨立的區域」，翻譯或生成語音時自動同步。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "翻譯 Tab 功能一覽",
            "blocks": [
              {
                "type": "table",
                "headers": [
                  "功能",
                  "說明"
                ],
                "rows": [
                  [
                    "重新翻譯",
                    "AI 翻譯所有課程內容，進度條即時顯示"
                  ],
                  [
                    "生成語音",
                    "為翻譯內容批次生成 TTS 語音，SSE 串流顯示進度"
                  ],
                  [
                    "同步所有獨立區域",
                    "一鍵將最新翻譯文字和語音同步到所有已建立獨立區域的投影片（保留位置）"
                  ],
                  [
                    "預覽學習 / 測驗",
                    "以對應語言開啟課程播放器預覽翻譯結果"
                  ],
                  [
                    "☑ 同步更新已獨立的區域",
                    "翻譯時自動同步獨立區域文字（預設勾選）"
                  ],
                  [
                    "☑ 生成語音時同步語音",
                    "生成 TTS 時自動同步獨立區域語音（預設勾選）"
                  ]
                ]
              }
            ]
          },
          {
            "type": "subsection",
            "title": "多語底圖管理進階功能",
            "blocks": [
              {
                "type": "para",
                "text": "在投影片編輯器的多語底圖管理面板中，每個語言 Tab 提供以下功能："
              },
              {
                "type": "table",
                "headers": [
                  "功能",
                  "說明"
                ],
                "rows": [
                  [
                    "狀態 Badge",
                    "✓ 有翻譯 / ★ 有獨立區域 / 🔊 有語音"
                  ],
                  [
                    "翻譯結果預覽",
                    "繼承模式下直接顯示翻譯後的文字和語音（唯讀）"
                  ],
                  [
                    "建立獨立區域",
                    "從翻譯結果建立（帶入文字+語音）或從主語言複製"
                  ],
                  [
                    "從翻譯結果同步",
                    "已有獨立區域時一鍵更新文字和語音（保留框位置）"
                  ],
                  [
                    "語音模式切換",
                    "[全部] [🎯 導引] [📝 測驗] [🔍 探索] 過濾欄位"
                  ],
                  [
                    "整體座標調整",
                    "在大圖編輯 Modal 中批次偏移/縮放所有區域座標"
                  ],
                  [
                    "語音預覽",
                    "大圖 Modal 中點擊區域自動播放對應語音"
                  ],
                  [
                    "Diff 模式",
                    "📊 按鈕展開 zh-TW vs 翻譯 side-by-side 文字比較"
                  ]
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "課程發佈",
        "blocks": [
          {
            "type": "para",
            "text": "課程完成後點擊「發佈課程」按鈕，系統會執行**發佈前檢查**："
          },
          {
            "type": "list",
            "items": [
              "✅ 至少有 1 個章節",
              "✅ 至少有 1 張投影片",
              "✅ Hotspot 互動區域設定正確",
              "⚠ 是否有語音導覽（選配）"
            ]
          },
          {
            "type": "para",
            "text": "所有必要項目通過後才能發佈。發佈時系統會自動通知被分享的使用者。"
          },
          {
            "type": "para",
            "text": "已發佈的課程可隨時「取消發佈」回到草稿狀態，或「封存」移除。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "成績報表",
        "blocks": [
          {
            "type": "para",
            "text": "在「成績」分頁可查看學員的互動成績，包含三個維度："
          },
          {
            "type": "list",
            "items": [
              "**課程總覽**：參與人數、平均分數、平均用時、完成率",
              "**投影片統計**：每張互動投影片的操作次數、平均分數、平均錯誤",
              "**使用者明細**：每位學員的測驗紀錄，可展開查看 per-slide 明細"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "章節完成率報表（Admin）",
        "blocks": [
          {
            "type": "para",
            "text": "在管理員後台「教育訓練報表」中，新增了兩個報表 tab："
          },
          {
            "type": "subsection",
            "title": "章節完成率",
            "blocks": [
              {
                "type": "para",
                "text": "以**課程→章節**為維度，查看每個章節的學員完成情況："
              },
              {
                "type": "steps",
                "items": [
                  {
                    "title": "選擇課程",
                    "desc": "從下拉選單選擇要查看的課程"
                  },
                  {
                    "title": "查看各章節通過率",
                    "desc": "每個章節顯示通過/未通過/未作答人數和通過率進度條"
                  },
                  {
                    "title": "展開查看人員明細",
                    "desc": "點擊章節展開，顯示每位使用者的狀態、最高分、完成時間"
                  }
                ]
              },
              {
                "type": "tip",
                "text": "通過率進度條顏色：綠色 ≥80%、橙色 ≥50%、紅色 <50%。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "使用手冊完成率",
            "blocks": [
              {
                "type": "para",
                "text": "以**使用手冊章節**為維度，查看有連結互動教學的章節完成情況："
              },
              {
                "type": "list",
                "items": [
                  "自動列出所有有連結互動教學的使用手冊章節",
                  "顯示每個章節的通過/未通過/未作答人數",
                  "點擊展開可查看每位使用者的狀態和分數"
                ]
              },
              {
                "type": "note",
                "text": "使用手冊和訓練教室的測驗成績是**互通**的。只要在任一入口通過同一個章節的測驗，即視為該章節已通過。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "目標人員判定",
            "blocks": [
              {
                "type": "table",
                "headers": [
                  "課程類型",
                  "需要完成的人員"
                ],
                "rows": [
                  [
                    "公開課程",
                    "所有啟用中的使用者"
                  ],
                  [
                    "非公開課程",
                    "被指派到包含該課程的訓練專案的使用者"
                  ]
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-feedback",
    "sort_order": 28,
    "icon": "TicketCheck",
    "icon_color": "text-rose-500",
    "last_modified": "2026-04-17",
    "title": "問題反饋（工單系統）",
    "sidebar_label": "問題反饋",
    "blocks": [
      {
        "type": "para",
        "text": "問題反饋平台讓您可以向管理員提報系統使用問題、AI 回答品質、功能建議等，並即時追蹤處理進度。所有對話紀錄與附件都會完整保留。"
      },
      {
        "type": "subsection",
        "title": "如何進入問題反饋",
        "blocks": [
          {
            "type": "list",
            "items": [
              "**方式一 — Sidebar 選單**：左側 Sidebar 展開「更多功能」→ 點選「問題反饋」進入工單列表",
              "**方式二 — 右下角浮動按鈕（FAB）**：在任何頁面右下角都有一個藍色按鈕，點擊可快速開立工單，不需離開當前頁面",
              "**方式三 — AI 對話頁**：在 AI 回覆下方有「問題反饋」按鈕，可直接將 AI 回覆內容帶入工單描述"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "建立工單",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "進入建立工單頁面",
                "desc": "點選「建立工單」按鈕，或使用右下角 FAB 快速開單"
              },
              {
                "title": "填寫問題主旨（必填）",
                "desc": "簡要描述您遇到的問題，例如「登入後畫面空白」"
              },
              {
                "title": "選擇問題分類",
                "desc": "系統操作問題、AI 回答品質、教育訓練、帳號權限、功能建議、其他"
              },
              {
                "title": "選擇優先級",
                "desc": "低 / 中 / 高 / 緊急 — 影響 SLA 處理時限"
              },
              {
                "title": "填寫問題說明",
                "desc": "詳細描述問題發生的步驟、錯誤訊息等。支援貼上分享連結"
              },
              {
                "title": "上傳附件",
                "desc": "可選擇檔案上傳、拖放檔案、或 **Ctrl+V 直接貼上截圖**"
              },
              {
                "title": "儲存草稿或送出",
                "desc": "點「儲存」先存為草稿（可繼續編輯），點「送出」正式提交給管理員"
              }
            ]
          },
          {
            "type": "tip",
            "text": "草稿工單可隨時回來修改主旨、描述、分類、優先級、附件，確認無誤後再送出。支援拖放檔案和 Ctrl+V 貼上截圖到編輯區。"
          },
          {
            "type": "tip",
            "text": "從 AI 對話頁開立的工單會自動帶入 AI 回覆內容和對話連結，方便管理員了解問題背景。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "工單編號說明",
        "blocks": [
          {
            "type": "para",
            "text": "工單編號格式為 **FB-YYYYMMDDHHmm**，例如 `FB-202604081430` 表示 2026 年 4 月 8 日 14:30 建立。同一分鐘內建立多張工單時會加上序號，如 `FB-202604081430-2`。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "工單狀態說明",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "狀態",
              "說明",
              "誰可以操作"
            ],
            "rows": [
              [
                "草稿",
                "工單已儲存但尚未送出，可繼續編輯",
                "申請者"
              ],
              [
                "待處理",
                "工單已送出，等待管理員查看",
                "-"
              ],
              [
                "處理中",
                "管理員已接單或已回覆，正在處理",
                "管理員"
              ],
              [
                "等待回覆",
                "管理員需要您提供更多資訊",
                "管理員設定"
              ],
              [
                "已解決",
                "問題已被解決",
                "管理員或申請者"
              ],
              [
                "已結案",
                "工單已關閉，不可再操作",
                "系統自動（72 小時）或管理員"
              ],
              [
                "已重開",
                "申請者在結案後 72 小時內重新開啟",
                "申請者"
              ]
            ]
          },
          {
            "type": "note",
            "text": "**自動轉換**：管理員首次回覆時，狀態自動從「待處理」→「處理中」。您回覆時，狀態自動從「等待回覆」→「處理中」。已解決的工單若 72 小時內無人重開，系統會自動結案。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "即時對話",
        "blocks": [
          {
            "type": "para",
            "text": "進入工單詳情頁後，您可以在左側對話區與管理員即時溝通。系統使用 WebSocket 即時推送，訊息送出後對方立即可見，無需重新整理頁面。"
          },
          {
            "type": "list",
            "items": [
              "輸入訊息後按 **Enter** 送出（Shift+Enter 換行）",
              "**Ctrl+V 貼上截圖**：剪貼簿中的圖片會直接加入附件，送出前可預覽",
              "**拖放檔案**：直接從桌面或資料夾拖放檔案到輸入區即可上傳",
              "圖片附件會在對話泡泡中**直接顯示縮圖**，點擊可放大查看",
              "非圖片檔案顯示檔名與下載按鈕",
              "對方正在打字時會顯示「xxx 處理中...」提示",
              "管理員的「內部備註」您無法看到，這是管理團隊內部討論用"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "AI 智能分析",
        "blocks": [
          {
            "type": "para",
            "text": "在工單詳情頁右側面板有「AI 分析」功能。AI 會根據您的問題描述、附件內容，以及歷史相似工單的解法，提供建議。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊「AI 分析」按鈕"
              },
              {
                "title": "等待 AI 即時分析",
                "desc": "分析結果會以串流方式即時顯示"
              },
              {
                "title": "查看建議",
                "desc": "如有引用歷史工單會顯示「參考工單」來源"
              },
              {
                "title": "回饋是否有幫助",
                "desc": "點 👍 或 👎 幫助我們改善 AI 品質"
              }
            ]
          },
          {
            "type": "tip",
            "text": "如果 AI 建議已解決您的問題，可以直接結案工單，管理員會收到通知。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "結案與滿意度評分",
        "blocks": [
          {
            "type": "list",
            "items": [
              "管理員或您自己都可以按「結案」關閉工單",
              "結案時可填寫結案說明",
              "結案後會出現 **滿意度評分**（1-5 星），請給予回饋幫助我們改善服務",
              "如果覺得問題沒有完全解決，可在 **72 小時內** 點「重開」重新開啟工單"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "SLA 服務等級",
        "blocks": [
          {
            "type": "para",
            "text": "每張工單根據優先級設有 SLA（服務等級協議）時限，確保問題能在合理時間內得到回應與解決。"
          },
          {
            "type": "table",
            "headers": [
              "優先級",
              "首次回應時限",
              "解決時限"
            ],
            "rows": [
              [
                "緊急",
                "1 小時",
                "4 小時"
              ],
              [
                "高",
                "4 小時",
                "8 小時"
              ],
              [
                "中",
                "8 小時",
                "24 小時"
              ],
              [
                "低",
                "24 小時",
                "72 小時"
              ]
            ]
          },
          {
            "type": "note",
            "text": "SLA 時限從工單建立時開始計算。若管理員未在時限內回應，系統會自動提醒管理員。工單詳情頁右側可查看 SLA 狀態。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "附件上傳",
        "blocks": [
          {
            "type": "list",
            "items": [
              "支援所有常見檔案格式（圖片、PDF、文件、壓縮檔等），但**不允許影片檔案**",
              "單檔上限 50MB",
              "**三種上傳方式**：點選檔案、拖放至上傳區、Ctrl+V 直接貼上截圖",
              "上傳的圖片可直接在對話中預覽",
              "所有附件可在工單詳情頁右側面板下載",
              "**Ctrl+V 貼上的截圖會自動加上時戳命名**，例如 `paste_04171930.png`（月日時分秒），避免多張截圖都叫 `image.png` 無法辨識"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "結案工單如何幫助其他人",
        "blocks": [
          {
            "type": "para",
            "text": "工單結案後，系統會自動把完整對話紀錄 + 附件描述（圖片文字、文件內容）**脫敏後**存入公開知識庫 `feedback-public`。其他使用者遇到類似問題時可以在知識庫中搜尋到解法。"
          },
          {
            "type": "list",
            "items": [
              "**自動脫敏**：人名、工號、email 會自動替換成 `[使用者]`、`[工號]`、`[email]`，技術內容、部門代號、錯誤訊息等保留",
              "**附件也會索引**：圖片會透過 AI 自動辨識文字與內容描述一併進入知識庫",
              "**細粒度檢索**：每則對話、每個附件都會獨立切成 chunk，搜尋更精準",
              "**在知識庫列表找得到**：到「知識庫」頁面可看到 `feedback-public`（以及 ERP 分類的 `feedback-erp`），點進去可以用向量搜尋或關鍵字查詢"
            ]
          },
          {
            "type": "tip",
            "text": "建立工單時描述越清楚、結案時留下明確的解法，就越能幫助其他遇到相同問題的同仁。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "ERP 類問題特殊處理",
        "blocks": [
          {
            "type": "para",
            "text": "若您的問題屬於 ERP 系統相關（例如 ERP 登入、報表、模組操作等），**請選擇標有 ERP 徽章的分類**。這類工單會有以下不同行為："
          },
          {
            "type": "list",
            "items": [
              "**通知不同群組**：會發給 ERP 專屬處理團隊（非一般 Cortex 管理員），避免訊息混雜",
              "**獨立知識庫**：結案後存入 `feedback-erp`（非 `feedback-public`），其他 ERP 類問題使用者可查到",
              "**處理流程相同**：對您來說，開單、對話、附件、AI 分析、結案、滿意度評分，所有體驗與一般工單完全一樣"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "我想了解管理員那邊看到什麼",
        "blocks": [
          {
            "type": "para",
            "text": "如果您是管理員（Cortex admin 或 ERP admin），關於分類管理、ERP 權限設定、Webex 群組、知識庫架構等後台設定項目，請參考「**管理員手冊 → 問題反饋管理**」。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "通知機制",
        "blocks": [
          {
            "type": "para",
            "text": "系統會在以下時機通知您："
          },
          {
            "type": "list",
            "items": [
              "**管理員回覆**：您會收到 Email 通知",
              "**狀態變更**：工單被接單、結案、重開時會收到站內通知",
              "**站內通知**：Sidebar「問題反饋」旁的紅色數字顯示未讀通知數量"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "搜尋與篩選",
        "blocks": [
          {
            "type": "para",
            "text": "在工單列表頁面，您可以使用以下方式找到特定工單："
          },
          {
            "type": "list",
            "items": [
              "**搜尋框**：輸入工單編號或主旨關鍵字",
              "**狀態篩選**：待處理、處理中、等待回覆、已解決、已結案、已重開",
              "**優先級篩選**：緊急、高、中、低",
              "**分類篩選**：依問題分類過濾"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "常見問題",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "問題",
              "解答"
            ],
            "rows": [
              [
                "工單建立後可以修改嗎？",
                "可以修改主旨、描述、分類和優先級。在工單詳情頁進行編輯。"
              ],
              [
                "結案後還能重開嗎？",
                "可以，但限 72 小時內，且只有原申請者可以重開。"
              ],
              [
                "我的工單別人看得到嗎？",
                "一般使用者只能看到自己的工單；Cortex 管理員可看所有工單；ERP 管理員可看 ERP 分類工單 + 自己的工單。"
              ],
              [
                "我結案的工單其他人看得到內容嗎？",
                "公開知識庫裡有您的工單對話（**已脫敏**），其他使用者可以透過知識庫搜尋查到解法。人名、工號、email 會自動換成占位符，技術內容保留。如果想看未脫敏原文需管理員權限。"
              ],
              [
                "AI 分析會用到我的個人資料嗎？",
                "不會。AI 搜尋歷史工單時使用的是脫敏後的公開知識庫，不會顯示其他人的個人資訊。"
              ],
              [
                "工單附件有大小限制嗎？",
                "單檔 50MB，不允許上傳影片檔案。"
              ],
              [
                "如何快速開單？",
                "使用右下角藍色浮動按鈕（FAB），不用離開當前頁面就能開單。"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-webex-bot",
    "sort_order": 29,
    "icon": "MessageSquare",
    "icon_color": "text-green-500",
    "last_modified": "2026-04-01",
    "title": "Webex Bot 使用",
    "sidebar_label": "Webex Bot 使用",
    "blocks": [
      {
        "type": "para",
        "text": "Foxlink GPT to Cortex 支援透過 **Cisco Webex** 直接與 AI 對話，享有與 Web 介面相同的問答、工具調用、檔案收發能力，無需開啟瀏覽器，在 Webex 行動裝置上也能隨時使用。"
      },
      {
        "type": "subsection",
        "title": "開始使用",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "在 Webex 搜尋 Bot 帳號",
                "desc": "搜尋「Foxlink GPT to Cortex」或 Bot 的 email（請洽管理員取得），點擊後直接傳送訊息"
              },
              {
                "title": "傳送第一則訊息",
                "desc": "Bot 會在 8 秒內開始處理並回覆，第一次使用會自動建立對話 Session"
              },
              {
                "title": "群組 Room 使用",
                "desc": "在群組中需要 @Foxlink GPT to Cortex 才會觸發，DM 則直接傳送即可"
              }
            ]
          },
          {
            "type": "note",
            "text": "Bot 採用輪詢模式（每 8 秒），訊息最長延遲約 8 秒才開始處理，請稍待 AI 回應（約 10–30 秒）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "指令清單",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "指令",
              "功能"
            ],
            "rows": [
              [
                "?",
                "列出您目前授權使用的所有工具（技能、知識庫、MCP 工具）"
              ],
              [
                "/new（或：新對話、重置、/clear、/restart...）",
                "開啟新對話，清除本次 Session 記憶，介面顯示時間戳分隔線"
              ],
              [
                "/help",
                "顯示 Bot 使用說明"
              ],
              [
                "其他任何文字",
                "直接送 AI 問答，自動判斷並調用合適工具"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "附件支援",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "類型",
              "說明"
            ],
            "rows": [
              [
                "PDF / Word / Excel / PPT",
                "AI 直接讀取內容並回答問題"
              ],
              [
                "圖片（JPG / PNG / GIF / WebP）",
                "AI 進行圖像分析"
              ],
              [
                "音訊（MP3 / WAV / MP4 Audio）",
                "自動轉錄為文字後分析"
              ],
              [
                "AI 生成的檔案",
                "xlsx / docx / pdf / pptx 以附件方式回傳"
              ]
            ]
          },
          {
            "type": "note",
            "text": "不支援影片檔（mp4 video / webm）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "對話記憶與 Session",
        "blocks": [
          {
            "type": "para",
            "text": "**DM 對話**：每日（台北時區）自動開啟新 Session，同一天的訊息共享上下文記憶。\n**群組 Room**：單一永久 Session，所有成員的對話共享同一記憶。\n傳送 `/new`（或「新對話」、「重置」、`/clear`）可隨時手動清除記憶開始新對話。"
          },
          {
            "type": "tip",
            "text": "開啟新對話後，Webex 聊天室會顯示時間戳分隔線（━━━ 🔄 新對話開始 ━━━），舊訊息仍保留在歷史中，Foxlink GPT to Cortex 的「對話紀錄」也同步保存，可隨時回顧。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "注意事項",
        "blocks": [
          {
            "type": "list",
            "items": [
              "Bot 功能須由管理員在您的帳號設定中開啟「允許使用 Webex Bot」",
              "您的 Webex 帳號 email 必須與系統中的帳號 email 一致（自動支援 @foxlink.com / @foxlink.com.tw 互轉）",
              "AI 處理期間 Bot 會先回覆「⏳ 正在分析您的問題，請稍候...」，處理完成後自動刪除該訊息",
              "Webex 回應格式已針對行動裝置簡化，詳細報表建議使用 Web 介面",
              "回應超過 4000 字元時會自動截斷，並提示您至 Web 介面查看完整版"
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "多語言回應",
        "blocks": [
          {
            "type": "para",
            "text": "Webex Bot 的所有系統訊息（錯誤提示、指令回應、處理中提示等）會**依照您在網頁端設定的語言偏好**自動切換為對應語言。支援**繁體中文、英文、越南文**三種語言。"
          },
          {
            "type": "table",
            "headers": [
              "訊息類型",
              "語言依據",
              "說明"
            ],
            "rows": [
              [
                "帳號未串連（找不到帳號）",
                "三語同時顯示",
                "系統無法辨識您的身份，因此中/英/越三語全部列出"
              ],
              [
                "帳號停用 / Bot 未啟用",
                "依您的語言設定",
                "系統已辨識您的帳號，依偏好語言回應"
              ],
              [
                "檔案上傳錯誤",
                "依您的語言設定",
                "影片拒絕、音訊/圖片權限不足、檔案過大等"
              ],
              [
                "/help 使用說明",
                "依您的語言設定",
                "完整翻譯版的指令說明與附件支援資訊"
              ],
              [
                "/new 新對話提示",
                "依您的語言設定",
                "分隔線與提示文字"
              ],
              [
                "處理中 / AI 錯誤",
                "依您的語言設定",
                "「⏳ 正在分析...」及錯誤訊息"
              ],
              [
                "預算超限通知",
                "依您的語言設定",
                "日/週/月使用額度警告"
              ],
              [
                "生成檔案提示",
                "依您的語言設定",
                "「📄 已生成：檔名」"
              ]
            ]
          },
          {
            "type": "tip",
            "text": "語言設定方式：登入網頁版 → 右上角語言切換（🌐）→ 選擇繁體中文 / English / Tiếng Việt。設定後 Webex Bot 會自動套用，無需額外操作。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "帳號無法串連時的處理方式",
        "blocks": [
          {
            "type": "para",
            "text": "若您尚未登入過網頁系統，Bot 會以**中/英/越三語同時顯示**以下錯誤訊息："
          },
          {
            "type": "subsection",
            "title": "情境一：帳號未串連（找不到帳號）",
            "blocks": [
              {
                "type": "code",
                "text": "⚠️ 無法串連 Foxlink GPT to Cortex 帳號，以下為可能原因：\n1. 尚未登入過網頁系統產生帳號，請先透過公司內網登入：https://flgpt.foxlink.com.tw:8443\n2. 可能帳號無 email 資訊\n3. 網路連線問題\n請檢查以上原因或是洽廠區資訊處理"
              },
              {
                "type": "list",
                "items": [
                  "**原因 1**：您尚未登入過 Foxlink GPT 網頁版（`flgpt.foxlink.com.tw`），系統尚未建立帳號。請先用瀏覽器登入一次即可。",
                  "**原因 2**：您的帳號在系統中沒有 email，或 email 與 Webex 帳號不一致。請聯絡管理員確認。",
                  "**原因 3**：網路暫時異常，稍後再試。若持續發生請洽廠區資訊處理。"
                ]
              }
            ]
          },
          {
            "type": "subsection",
            "title": "情境二：帳號已停用",
            "blocks": [
              {
                "type": "code",
                "text": "⚠️ 您的帳號目前已停用，請聯絡系統管理員。"
              },
              {
                "type": "list",
                "items": [
                  "您的帳號已被管理員停用（可能離職、調動或到期），請聯絡系統管理員重新啟用。",
                  "此訊息會依您帳號的語言設定，以對應語言顯示。"
                ]
              }
            ]
          },
          {
            "type": "subsection",
            "title": "情境三：Webex Bot 功能未開啟",
            "blocks": [
              {
                "type": "code",
                "text": "⚠️ 您的帳號目前未開啟 Webex Bot 功能，如需使用請聯絡系統管理員。"
              },
              {
                "type": "list",
                "items": [
                  "帳號存在但管理員尚未開啟「允許使用 Webex Bot」選項。請聯絡管理員至後台 → 使用者管理 → 編輯您的帳號 → 開啟 Webex Bot。",
                  "此訊息會依您帳號的語言設定，以對應語言顯示。"
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-budget",
    "sort_order": 30,
    "icon": "DollarSign",
    "icon_color": "text-emerald-500",
    "last_modified": "2026-04-01",
    "title": "對話額度限制",
    "sidebar_label": "對話額度限制",
    "blocks": [
      {
        "type": "para",
        "text": "系統管理員可為帳號或角色設定使用金額上限，當用量接近或超過限制時，對話頁面**頂部工具列**會出現金額指示器，讓您隨時掌握自己的用量狀況。"
      },
      {
        "type": "subsection",
        "title": "指示器顯示位置",
        "blocks": [
          {
            "type": "para",
            "text": "金額指示器位於**對話頁面頂部工具列右側**，分日 / 週 / 月三種週期，管理員可分別設定，您可能同時看到一個或多個指示器："
          },
          {
            "type": "table",
            "headers": [
              "週期",
              "重設時間",
              "顯示標籤範例"
            ],
            "rows": [
              [
                "每日限額",
                "每天凌晨 00:00 重設",
                "日 $0.12/$1.00"
              ],
              [
                "每週限額",
                "每週一 00:00 重設",
                "週 $3.50/$10.00"
              ],
              [
                "每月限額",
                "每月 1 日 00:00 重設",
                "月 $12.80/$50.00"
              ]
            ]
          },
          {
            "type": "table",
            "headers": [
              "指示器顏色",
              "意義"
            ],
            "rows": [
              [
                "灰色（正常）",
                "目前用量在上限 80% 以內，一切正常，可正常使用"
              ],
              [
                "橘色（接近上限）",
                "目前用量超過上限的 80%，請留意使用量，即將達到限制"
              ],
              [
                "紅色（已超出）",
                "當前週期用量已達上限，依限制模式決定後續行為（見下方說明）"
              ]
            ]
          },
          {
            "type": "note",
            "text": "金額計算基於 Token 用量乘以各模型定價。若管理員尚未設定模型定價，顯示金額可能為 $0.000，此情況請洽管理員確認。系統管理員帳號不受金額限制，不會顯示此指示器。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "額度超過後的限制方式",
        "blocks": [
          {
            "type": "para",
            "text": "管理員可針對每個**角色（Role）或個別使用者**分別設定超過額度後的行為模式："
          },
          {
            "type": "comparison",
            "items": [
              {
                "title": "警告模式（warn）",
                "desc": "超過額度後仍**可繼續對話**，但頂部指示器會顯示紅色警告，提醒您已超出本週期限額。適合主管或核心業務人員，確保不影響工作。",
                "example": "",
                "borderColor": "amber"
              },
              {
                "title": "禁止模式（block）",
                "desc": "超過額度後**無法繼續發送新訊息**，系統回覆「已達使用上限」提示，需等待下個週期重設後才能繼續使用。",
                "example": "",
                "borderColor": "red"
              }
            ]
          },
          {
            "type": "tip",
            "text": "若您在重要工作時突然收到「已達使用上限」拒絕訊息，請洽系統管理員臨時調整限額或切換為警告模式。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "消耗趨勢查看",
        "blocks": [
          {
            "type": "para",
            "text": "想了解自己過去一段時間的 Token 用量與費用分布？點選頂部工具列的**「📈 消耗趨勢」按鈕（TrendingUp 圖示）**，開啟個人用量統計面板："
          },
          {
            "type": "list",
            "items": [
              "折線圖：顯示過去 N 天各模型每日費用走勢（多條線按模型分色）",
              "時間範圍：可切換查看最近 7 天 / 30 天 / 90 天",
              "總計：面板頂部顯示所選時間內的總費用及總 Token 數",
              "各模型彙總：底部表格列出每種模型的輸入 / 輸出 Token 及費用"
            ]
          },
          {
            "type": "tip",
            "text": "消耗趨勢讓您一目了然各模型的使用分布，若某天費用明顯偏高，可回到對話歷史找出當天的深度研究或大型文件分析任務加以調整。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-help-kb",
    "sort_order": 31,
    "icon": "BookMarked",
    "icon_color": "text-blue-500",
    "last_modified": "2026-04-01",
    "title": "AI 回答使用問題",
    "sidebar_label": "AI 回答使用問題",
    "blocks": [
      {
        "type": "para",
        "text": "Foxlink GPT to Cortex 內建了一套**使用說明知識庫**，涵蓋系統所有功能的操作方式。您可以直接在對話框向 AI 提問，不需要翻閱說明書，AI 會從知識庫中找到最相關的說明回答您。"
      },
      {
        "type": "subsection",
        "title": "如何詢問",
        "blocks": [
          {
            "type": "para",
            "text": "只要在任意對話中，用自然語言描述您的問題即可："
          },
          {
            "type": "card_grid",
            "cols": 2,
            "items": [
              {
                "emoji": "💬",
                "title": "怎麼上傳 PDF 檔案？",
                "tag": {
                  "color": "blue",
                  "text": "上傳"
                },
                "desc": "",
                "borderColor": "slate"
              },
              {
                "emoji": "💬",
                "title": "如何建立自動排程任務？",
                "tag": {
                  "color": "blue",
                  "text": "排程"
                },
                "desc": "",
                "borderColor": "slate"
              },
              {
                "emoji": "💬",
                "title": "深度研究和一般對話有什麼差別？",
                "tag": {
                  "color": "blue",
                  "text": "深度研究"
                },
                "desc": "",
                "borderColor": "slate"
              },
              {
                "emoji": "💬",
                "title": "技能（Skill）要怎麼掛載到對話？",
                "tag": {
                  "color": "blue",
                  "text": "技能"
                },
                "desc": "",
                "borderColor": "slate"
              },
              {
                "emoji": "💬",
                "title": "TAG 路由是什麼意思？",
                "tag": {
                  "color": "blue",
                  "text": "工具"
                },
                "desc": "",
                "borderColor": "slate"
              },
              {
                "emoji": "💬",
                "title": "知識庫要設定什麼標籤才會被自動啟用？",
                "tag": {
                  "color": "blue",
                  "text": "知識庫"
                },
                "desc": "",
                "borderColor": "slate"
              },
              {
                "emoji": "💬",
                "title": "對話額度超過後還能繼續使用嗎？",
                "tag": {
                  "color": "blue",
                  "text": "額度"
                },
                "desc": "",
                "borderColor": "slate"
              },
              {
                "emoji": "💬",
                "title": "如何分享對話給同事？",
                "tag": {
                  "color": "blue",
                  "text": "分享"
                },
                "desc": "",
                "borderColor": "slate"
              }
            ]
          },
          {
            "type": "tip",
            "text": "要讓 AI 優先從說明書回答，可以在問題中加上「使用說明」「怎麼操作」「如何設定」等語詞，系統的 TAG 路由機制會自動偵測並查詢說明書知識庫。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "適合詢問的問題類型",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "問題類型",
              "範例"
            ],
            "rows": [
              [
                "操作步驟",
                "「排程任務要怎麼建立？步驟是什麼？」"
              ],
              [
                "功能差異",
                "「Gemini Pro 和 Flash 有什麼不同？」"
              ],
              [
                "設定說明",
                "「知識庫的 Embedding 維度要選哪個？」"
              ],
              [
                "工具使用",
                "「MCP 工具和自建知識庫怎麼一起用？」"
              ],
              [
                "錯誤排解",
                "「為什麼 AI 沒有使用我掛載的知識庫？」"
              ],
              [
                "概念理解",
                "「TAG 路由的第一階段和第二階段有什麼區別？」"
              ]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "說明書知識庫的範圍",
        "blocks": [
          {
            "type": "para",
            "text": "說明書知識庫涵蓋本使用說明的所有章節（共 21 個），包含："
          },
          {
            "type": "list",
            "items": [
              "登入與登出",
              "介面導覽",
              "開始對話",
              "AI 模型選擇",
              "上傳檔案",
              "對話歷史",
              "可用工具 / TAG路由",
              "自動排程",
              "圖片生成",
              "技能 Skill",
              "知識庫市集",
              "深度研究",
              "語言切換",
              "對話額度",
              "AI 戰情室",
              "命名查詢",
              "Schema 欄位",
              "圖表建構器",
              "儀表板",
              "文件範本"
            ]
          },
          {
            "type": "note",
            "text": "說明書知識庫由系統自動維護，每次系統更新後會自動同步最新內容，您不需要做任何設定。"
          }
        ]
      }
    ]
  },
  {
    "id": "u-erp-tools",
    "sort_order": 32,
    "icon": "Database",
    "icon_color": "text-sky-600",
    "last_modified": "2026-04-20",
    "title": "ERP 工具呼叫",
    "sidebar_label": "ERP 工具",
    "blocks": [
      {
        "type": "para",
        "text": "**ERP 工具**是平台包裝好的 Oracle ERP FUNCTION 與 PROCEDURE，透過自然語言就能直接查詢或執行 ERP 資料。管理員在後台註冊後，您可以透過三種方式使用。"
      },
      {
        "type": "note",
        "text": "您看到的工具清單由管理員授權控管。若對話中找不到預期的 ERP 工具，請向管理員申請授權。"
      },
      {
        "type": "subsection",
        "title": "三種使用方式",
        "blocks": [
          {
            "type": "card_grid",
            "cards": [
              {
                "icon": "⚡",
                "title": "讓 AI 自動呼叫（推薦）",
                "desc": "用自然語言問問題，AI 會自己決定要不要呼叫 ERP 工具、要傳什麼參數。**可直接用代碼/名稱**（如「查組織 G0C 的工單 TNDS264009-C 狀況」），系統會自動透過 LOV 轉為內部 ID，不用背數字 ID"
              },
              {
                "icon": "🛢",
                "title": "手動立即執行",
                "desc": "對話輸入框左側的「🛢 ERP」按鈕可直接挑工具、填參數、馬上執行並看結果。適合精確查詢或 AI 判斷不準時。"
              },
              {
                "icon": "🔁",
                "title": "每輪自動注入（Inject）",
                "desc": "由管理員設定的 context 型工具，每次您發訊息前平台會自動跑一次把結果塞進對話。您不需做任何操作。"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "透過 topbar 啟用工具",
        "blocks": [
          {
            "type": "para",
            "text": "對話頁頂端的 **⚡ API 連接器** 按鈕打開後，會看到兩區：**DIFY / REST** 與 **ERP Procedure**。勾選您想啟用的 ERP 工具，AI 只會從您勾的清單中挑選呼叫。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊對話頁頂端 ⚡ API 連接器按鈕",
                "desc": "按鈕上若有數字徽章，代表目前已啟用的工具總數（DIFY + ERP 合計）"
              },
              {
                "title": "在 ERP Procedure 區勾選要啟用的工具",
                "desc": "WRITE 型工具會有紅色標記，代表會修改 ERP 資料"
              },
              {
                "title": "按確認，設定會保留在這個對話",
                "desc": "關閉再打開同一對話，勾選狀態會自動恢復"
              },
              {
                "title": "用自然語言發問",
                "desc": "AI 會在需要時自動呼叫您勾的工具"
              }
            ]
          },
          {
            "type": "tip",
            "text": "若您都沒打開過 topbar 挑選器，AI 會依據訊息關鍵字 + 工具標籤自動匹配可用的工具。只要打開過任何一個（包含 MCP/DIFY/ERP）就切換到「白名單模式」，沒勾的工具就不會被使用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "手動立即執行（🛢 ERP 按鈕）",
        "blocks": [
          {
            "type": "steps",
            "items": [
              {
                "title": "點擊對話輸入框左側的 🛢 ERP 按鈕",
                "desc": "會跳出工具挑選視窗，可搜尋工具名稱 / code / 描述"
              },
              {
                "title": "選定一個工具",
                "desc": "畫面跳到參數填寫視窗，必填欄位以紅色星號標示；參數名稱會依系統語言顯示中文／英文／越南文，括號下方的小字為 Oracle 原始參數名（如 P_WIP_NAME）"
              },
              {
                "title": "填寫參數",
                "desc": "有下拉選單的欄位由管理員設定的 LOV 提供選項（例：員工編號、工單號）。下拉支援**模糊搜尋**：點開後直接打字，會依 label 與 value 子字串即時過濾（例如輸入「TNDS」就只顯示含此字串的工單）；↑↓ 選擇 + Enter 確認，Esc 關閉"
              },
              {
                "title": "若某欄位顯示「請先選擇 XXX」",
                "desc": "代表此欄的下拉選項需要上一欄（如組織代碼）先填才會撈對應資料。上一欄選完會自動重抓下一欄的可選項，清空舊值避免誤用。"
              },
              {
                "title": "按「執行」",
                "desc": "結果會顯示在視窗下方，可切換 Table 或 JSON 檢視；文字區至少保留 10 行高度，長段文字會保留 PL/SQL 原始換行符（CHR(10) / CRLF）並在容器寬度自動折行；超過最大高度出現垂直捲軸"
              },
              {
                "title": "每段文字右上角有三顆動作按鈕",
                "desc": "【翻譯】當系統語言為 English / Tiếng Việt 時顯示；按下把 ERP 中文回傳透過 AI 翻成對應語言，代碼/ID/數字/日期保持原樣，結果快取 24 小時同段原文任何使用者再查都不重複翻。【複製】一鍵複製目前顯示內容（原文或譯文隨切換）。【放大】開全螢幕檢視視窗（95vw × 90vh，字體放大且含字元數/行數統計），適合長段結構化輸出；Esc 或點背景即可關閉"
              },
              {
                "title": "不想關視窗，直接改條件重查？",
                "desc": "結果頁底部左下「**重新查詢**」按鈕：直接修改上方下拉/輸入框的條件，按下即用新參數再執行一次，免關閉 modal 再從 🛢 重選工具。適合連續查多筆同一支工具的資料"
              },
              {
                "title": "選擇結果處理方式",
                "desc": "底部右側有四顆按鈕：【僅顯示結果】直接顯示在對話、【讓 AI 解釋】把結果交給 AI 用自然語言說明、【以此提問】把結果當成下一則訊息的參考資料、【關閉】退出模態框"
              }
            ]
          },
          {
            "type": "tip",
            "text": "翻譯按鈕會依照您目前的 UI 語言自動判斷翻譯目標。切換語言到 English 後重新開啟執行面板，按鈕會變成「翻譯 (EN)」。詞庫由管理員維護，可穩定專有名詞譯法（如「發補單」→「Reissue Note」）。"
          },
          {
            "type": "tip",
            "text": "LOV 下拉是 combobox：點開後可以直接打字模糊搜尋（例如打「TNDS」即時縮到符合的工單），↑↓ 選項、Enter 確認、Esc 關閉。500 筆上限時頂部會提示「結果已截斷，請輸入更精確的搜尋」。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "寫入型（WRITE）工具的安全確認",
        "blocks": [
          {
            "type": "para",
            "text": "部分 ERP 工具會修改資料（例如調整料號狀態、異動工單），這類工具在列表中標有紅色 **WRITE** 徽章。為了避免 AI 誤判，平台在執行前會要求您手動確認。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "AI 呼叫 WRITE 工具時，對話中會跳出紅色確認對話框",
                "desc": "顯示工具名稱、參數、以及 AI 的操作摘要"
              },
              {
                "title": "可以選擇填寫執行原因（進審計紀錄）",
                "desc": "例如「依工單 WO12345 調整」"
              },
              {
                "title": "按下「確認執行」才會真的動到 ERP",
                "desc": "按「取消」則放棄，AI 會改用其他方式回應"
              }
            ]
          },
          {
            "type": "note",
            "text": "所有 WRITE 執行紀錄都會被系統記錄（誰、什麼時候、傳了什麼參數、結果如何），供稽核使用。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "結果大小限制",
        "blocks": [
          {
            "type": "para",
            "text": "ERP 回傳的結果若超過管理員設定的列數上限（預設 AI 看 50 列、UI 看 1000 列），系統會自動截斷並標示「已截斷」。完整結果會暫存 30 分鐘，可透過「查看完整結果」按鈕或請 AI 存成檔案。"
          },
          {
            "type": "tip",
            "text": "若需分析完整大量資料，可請 AI 將結果匯出成 Excel 或 CSV，然後再做後續分析。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "🔧 管理員：LOV（下拉選單來源）設定",
        "blocks": [
          {
            "type": "para",
            "text": "在「Admin → API 連接器 → ERP Procedure → 新增／編輯 ERP 工具」展開任一 IN 參數，可設定該欄的下拉選項來源。共五種類型："
          },
          {
            "type": "table",
            "headers": [
              "LOV 類型",
              "適用場景",
              "值如何決定"
            ],
            "rows": [
              [
                "無（自由輸入）",
                "純文字欄，如備註",
                "使用者手動輸入"
              ],
              [
                "靜態清單（static）",
                "固定選項少的欄位",
                "管理員列舉 { value, label }，AI 也會收到 enum，可自動挑"
              ],
              [
                "SQL 查詢（sql）",
                "由 ERP DB 動態撈的選項（員工、工單、組織等）",
                "執行 SELECT；value_col 塞給 procedure，label_col 顯示給使用者"
              ],
              [
                "系統值（system）",
                "當前使用者相關資訊",
                "自動帶入 email / 工號 / 廠區等，不讓使用者改"
              ],
              [
                "鏈式（erp_tool）",
                "另一個 ERP tool 的 OUT cursor 當選項",
                "呼叫指定 ERP tool，取回 rows 渲染下拉"
              ]
            ]
          },
          {
            "type": "subsection",
            "title": "SQL LOV 撰寫規則",
            "blocks": [
              {
                "type": "code",
                "language": "sql",
                "text": "SELECT emp_no       AS V,\n       emp_name || ' (' || dept || ')' AS L\nFROM   fl_employee\nWHERE  factory = :factory\n  AND  status  = 'A'\nORDER BY emp_no"
              },
              {
                "type": "list",
                "items": [
                  "**必須 SELECT 開頭**；禁 UPDATE / DELETE / INSERT / MERGE / DROP 等寫入關鍵字",
                  "只能一個 statement（偵測到分號結尾以外的 `;` 會被擋）",
                  "系統自動包 `SELECT * FROM (...) WHERE ROWNUM <= N`，**不要自己加 `ROWNUM` / `FETCH FIRST`**（預設 N=500，由 `ERP_TOOL_LOV_MAX_ROWS` 控制）",
                  "`value_col` 預設 `V`、`label_col` 預設 `L`；比對不分大小寫，可寫 `AS v, AS l`"
                ]
              },
              {
                "type": "tip",
                "text": "**value vs label 的關鍵**：value 是實際傳給 PROCEDURE 的值（使用者看不到），label 是下拉顯示給使用者看的文字。所以 `SELECT wip_entity_id AS V, wip_name || '（' || org_code || '）' AS L` 可以做到「使用者挑工單號+組織代碼、實際傳 ID」。前提是 PROCEDURE 的型別與 value 對應，若不對得改 PROCEDURE。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "SQL binds（:name 引用）支援的來源",
            "blocks": [
              {
                "type": "para",
                "text": "撰寫 SQL 時用 `:factory`、`:dept_code` 等佔位符，系統自動依每位使用者帶入對應值："
              },
              {
                "type": "table",
                "headers": [
                  "來源",
                  "帶入值"
                ],
                "rows": [
                  [
                    "system_user_email",
                    "當前使用者 email"
                  ],
                  [
                    "system_user_employee_id",
                    "工號"
                  ],
                  [
                    "system_user_name / title / dept",
                    "姓名 / 職稱 / 部門代碼"
                  ],
                  [
                    "system_user_factory",
                    "廠區代碼（最常用，如 TCC / Z4E）"
                  ],
                  [
                    "system_user_profit_center",
                    "利潤中心"
                  ],
                  [
                    "system_date / system_datetime",
                    "今天 / 當下時間"
                  ],
                  [
                    "param:P_ORG_CODE（新）",
                    "**當前 Modal 中另一個參數的值**；可做「先選組織、再依組織撈工單」的依賴鏈"
                  ]
                ]
              }
            ]
          },
          {
            "type": "subsection",
            "title": "🔗 參數間依賴（cascading LOV）",
            "blocks": [
              {
                "type": "para",
                "text": "若某欄（如 P_WIP_NAME）的選項要依另一欄（如 P_ORG_CODE）過濾，在 SQL binds 用 `param:<NAME>` 來源："
              },
              {
                "type": "code",
                "language": "json",
                "text": "{\n  \"type\": \"sql\",\n  \"sql\": \"SELECT w.wip_entity_id AS V, w.wip_name AS L FROM wip_entities w WHERE w.organization_id = :org_id\",\n  \"binds\": [\n    { \"name\": \"org_id\", \"source\": \"param:P_ORG_CODE\" }\n  ],\n  \"value_col\": \"V\",\n  \"label_col\": \"L\"\n}"
              },
              {
                "type": "list",
                "items": [
                  "管理員 UI：bind 的 source 下拉會有 optgroup「其他參數（依賴另一欄）」自動列出同工具的其他 IN 參數，免手打 `param:` 前綴",
                  "使用者端：若 P_ORG_CODE 尚未選，P_WIP_NAME 下拉會顯示「請先選擇：P_ORG_CODE」提示；P_ORG_CODE 一變，P_WIP_NAME 選項自動重撈並清空舊值",
                  "支援多層依賴；系統會偵測迴圈（A→B→A）並以錯誤回應避免無限迴圈",
                  "鏈式 LOV（type=erp_tool）的 param_map 也支援 `param:<NAME>`"
                ]
              },
              {
                "type": "tip",
                "text": "LLM function calling 路徑看不到 SQL LOV 的選項列表（只看得到靜態 LOV 的 enum）。建議有 cascading 的工具把「允許 LLM 自動呼叫」關掉，只留「使用者手動觸發」，避免 AI 亂猜值。"
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "🔧 管理員：Answer 模式輸出解析（直達 + 表格 + 圖表）",
        "blocks": [
          {
            "type": "para",
            "text": "直達（Answer）模式原本只能把 FUNCTION 回傳的 VARCHAR2 整串原文顯示給使用者，像 `202604/ANDOR/A2/5807-5056-037500/RMB/740809` 這種工廠常見的 `/` 分隔格式，使用者根本看不懂。"
          },
          {
            "type": "para",
            "text": "啟用「**輸出解析**」後，後端會依管理員設定的分隔符、欄位名自動 parse，渲染成 **Markdown 表格**，並可附加 **ECharts 圖表**——全程後端處理、不經 LLM，2~3 秒即出結果（純 ERP 執行時間）。"
          },
          {
            "type": "subsection",
            "title": "設定位置",
            "blocks": [
              {
                "type": "para",
                "text": "Admin → ERP Procedure → 編輯工具 → 回應模式選「直達」後，下方會出現「**輸出解析（Answer 模式專用）**」區塊。"
              },
              {
                "type": "steps",
                "items": [
                  {
                    "title": "勾「啟用自動解析」",
                    "desc": "展開詳細設定"
                  },
                  {
                    "title": "欄位分隔符",
                    "desc": "預設 `/`。若 FUNCTION 用 `,` 或 `|` 請對應修改"
                  },
                  {
                    "title": "列分隔",
                    "desc": "多筆記錄之間的分隔。通常是換行 `\\n`，也可選空白 / Tab / 逗號 / 分號"
                  },
                  {
                    "title": "最多顯示列數",
                    "desc": "預設 200。超過會顯示「僅顯示前 N 列」"
                  },
                  {
                    "title": "跳過第一列（header）",
                    "desc": "若 FUNCTION 回傳的第一列是欄位名稱（如 `年月,專案,金額\\n202604,...`），勾選此項"
                  },
                  {
                    "title": "欄位名稱",
                    "desc": "依序輸入對應 parse 結果的欄位名（如：年月、專案名稱、類別、料號、幣別、超額金額）。可勾「數字」讓該欄顯示千分位且靠右對齊"
                  },
                  {
                    "title": "附加圖表（選填）",
                    "desc": "啟用後選 type（bar/line/pie）、X 軸欄位、Y 軸欄位（需是數字欄）、標題。渲染 ECharts 圖表在表格下方"
                  }
                ]
              }
            ]
          },
          {
            "type": "subsection",
            "title": "完整範例",
            "blocks": [
              {
                "type": "para",
                "text": "PROCEDURE 回傳字串："
              },
              {
                "type": "code",
                "language": "text",
                "text": "202604/ANDOR/A2/5807-5056-037500/RMB/740809\n202604/EXCALIBUR/A2/0628-0000-B070A2/RMB/387189\n202604/EXCALIBUR/A2/091B-2A08-647000/RMB/228590"
              },
              {
                "type": "para",
                "text": "輸出解析設定："
              },
              {
                "type": "table",
                "headers": [
                  "設定項",
                  "值"
                ],
                "rows": [
                  [
                    "欄位分隔符",
                    "/"
                  ],
                  [
                    "列分隔",
                    "換行 (\\n)"
                  ],
                  [
                    "欄位名稱",
                    "年月, 專案名稱, 類別, 料號, 幣別, 超額金額"
                  ],
                  [
                    "數字欄位",
                    "超額金額"
                  ],
                  [
                    "圖表 type / x / y",
                    "bar / 料號 / 超額金額"
                  ]
                ]
              },
              {
                "type": "para",
                "text": "使用者看到的最終輸出：6 欄 Markdown 表格（超額金額千分位 + 靠右）+ 長條圖，總時間 2-3 秒。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "Answer 模式 vs Tool 模式抉擇",
            "blocks": [
              {
                "type": "table",
                "headers": [
                  "情境",
                  "建議模式",
                  "理由"
                ],
                "rows": [
                  [
                    "結構化表格 + 圖表（排名、時間序列）",
                    "**Answer + 輸出解析**",
                    "快（2-3s）、確定性、不花 LLM token"
                  ],
                  [
                    "需要 AI 分析、摘要、推論",
                    "Tool",
                    "LLM 能依 context 解讀並提出建議"
                  ],
                  [
                    "純自由文字回應（狀態字串、警告訊息）",
                    "Answer（不設輸出解析）",
                    "原文顯示最保險"
                  ],
                  [
                    "使用者可能問各種變化問題",
                    "Tool",
                    "LLM 能決定要不要 call、補參數"
                  ]
                ]
              }
            ]
          },
          {
            "type": "tip",
            "text": "若未設定輸出解析，Answer 模式退回顯示原始字串。「輸出解析」是額外的加值，不影響 FUNCTION / PROCEDURE 執行邏輯本身。"
          },
          {
            "type": "note",
            "text": "目前僅支援 FUNCTION 回傳值（function_return）的解析。PROCEDURE 的 OUT CURSOR 不走這條路（已有自動表格渲染）。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "🔧 管理員：LLM 傳值模式（AI 對話可用 CODE/NAME 代替內部 ID）",
        "blocks": [
          {
            "type": "para",
            "text": "當 PROCEDURE 參數是內部 ID（如 `ORGANIZATION_ID = 83`、`WIP_ENTITY_ID = 56789`）時，AI 無法憑空知道這些數字，只能跟使用者確認或亂猜。此設定讓 AI 像使用者一樣以 **可讀名稱**（`G0C`、`TNDS264009-C`）呼叫工具，伺服器在執行前透過該參數的 LOV 自動查表轉成內部 ID。"
          },
          {
            "type": "table",
            "headers": [
              "模式",
              "行為",
              "使用時機"
            ],
            "rows": [
              [
                "原始值（value_only）",
                "LLM 必須精確傳出內部值；不做任何轉換",
                "LLM 不需要用到，或沒有 LOV；純數字 ID 且 AI 可從上下文取得"
              ],
              [
                "自動（auto，推薦預設）",
                "value 精確 → label 精確 → label 子字串 → value 子字串，依序嘗試",
                "99% 動態 LOV 參數都適用。AI 傳 \"G0C\" 或 \"83\" 都能用"
              ],
              [
                "可讀名稱（label_only）",
                "強制 LLM 傳 CODE/NAME；tool_schema description 明確要求不要傳數字 ID",
                "希望 AI 一律用自然語言，例如工單號始終以 WIP_NAME 呼叫"
              ]
            ]
          },
          {
            "type": "subsection",
            "title": "衝突處理",
            "blocks": [
              {
                "type": "para",
                "text": "若輸入的值在 LOV 中有多筆符合（例如 AI 傳 \"G0\" 但有 G0C、G0E、G06 三筆），伺服器會**拒絕執行並列出前 5 筆候選**，讓 AI 自行重試更精確的名稱。"
              },
              {
                "type": "code",
                "language": "json",
                "text": "{\n  \"error\": \"參數 P_ORG_ID 的值 \\\"G0\\\" 有多筆符合，請更精確:G0C, G0E, G06\"\n}"
              },
              {
                "type": "tip",
                "text": "AI 收到錯誤訊息會自然地跟使用者確認（例:「您指的是 G0C、G0E 還是 G06?」），不需要 Admin 做額外處理。"
              }
            ]
          },
          {
            "type": "subsection",
            "title": "依賴鏈（cascading）",
            "blocks": [
              {
                "type": "para",
                "text": "伺服器會依 LOV binds 的 `param:<NAME>` 建立依賴圖，以**拓撲順序**處理:先解析上游參數的 label→value，下游參數的 LOV 就能拿到正確的上游 ID 值撈選項。"
              },
              {
                "type": "code",
                "language": "text",
                "text": "AI 呼叫: { P_ORG_ID: \"G0C\", P_WIP_ENTITY_ID: \"TNDS264009-C\" }\n  ↓ P_ORG_ID: 查 LOV → 找到 value=83 → inputs.P_ORG_ID = \"83\"\n  ↓ P_WIP_ENTITY_ID: 查 LOV 帶 :org_id=83 → 找到 value=56789 → inputs.P_WIP_ENTITY_ID = \"56789\"\n  ↓ 呼叫 FUNCTION 用內部 ID"
              }
            ]
          },
          {
            "type": "note",
            "text": "本設定僅影響 **LLM function calling 路徑（⚡ API 連接器 topbar）**。🛢 手動執行一直都是 LOV 下拉，不受影響。"
          },
          {
            "type": "note",
            "text": "靜態 LOV（static type）會產生 enum，AI 本來就能精確選，所以不需此設定。"
          },
          {
            "type": "tip",
            "text": "系統 Migration 時會自動把「有動態 LOV 但沒設過模式」的參數預設為 `auto`。新建工具也一律預設 `auto`。Admin 僅在特定情境才需改回 value_only。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "🔧 管理員：參數顯示名稱（覆蓋內部 P_XXX 名稱）",
        "blocks": [
          {
            "type": "para",
            "text": "使用者看到的 `P_ORG_ID`、`P_WIP_ENTITY_ID` 這種 Oracle 原始參數名不友善。每個參數展開後的「**顯示名稱**」欄位可直接輸入使用者應該看到的 label（例如「組織代碼」、「工單號」），留空則沿用原始名稱。原始 P_XXX 會以小灰字顯示於下方方便管理員比對。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "編輯工具 → 展開參數",
                "desc": "找到「顯示名稱」輸入框（在 AI Hint 左邊）"
              },
              {
                "title": "輸入使用者友善的中文 label",
                "desc": "例如「組織代碼」「工單號」「員工工號」"
              },
              {
                "title": "儲存",
                "desc": "zh-TW 使用者立即看到新 label"
              },
              {
                "title": "如需 en / vi，按右下「翻譯 (en / vi)」",
                "desc": "LLM 會以「顯示名稱」為主要翻譯來源（若顯示名稱空白才 fallback ai_hint）批次翻成三語，存進 erp_tool_translations 表"
              }
            ]
          },
          {
            "type": "table",
            "headers": [
              "來源優先順序",
              "使用時機"
            ],
            "rows": [
              [
                "1. params_labels_json（翻譯表，指定語言）",
                "UI 語言為 en / vi 且該參數已翻譯"
              ],
              [
                "2. param.display_name（zh-TW 原始）",
                "管理員直接輸入的顯示名稱"
              ],
              [
                "3. param.ai_hint",
                "顯示名稱未設時，退回 LLM 提示文字（較不理想，ai_hint 通常是說明而不是 label）"
              ],
              [
                "4. param.name",
                "以上皆無時，顯示內部 P_XXX"
              ]
            ]
          },
          {
            "type": "note",
            "text": "翻譯結果寫進 DB，僅在按下翻譯鍵時才執行；日常呼叫不會額外耗 token。若事後改過顯示名稱或 ai_hint 需要手動再按一次翻譯以更新 en/vi 版本。"
          },
          {
            "type": "tip",
            "text": "重抓 metadata（PROCEDURE 簽章變更後）的智慧合併會保留您輸入的「顯示名稱」，不會被覆蓋。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "🔧 管理員：重抓 metadata（DBA 改過 PROCEDURE 簽章時）",
        "blocks": [
          {
            "type": "para",
            "text": "當 DBA 改了 PROCEDURE 參數（新增欄位、改型別、改 IN/OUT、改 NUMBER/VARCHAR2），工具定義會與 Oracle 實際簽章不一致（drift）。在工具編輯視窗頂部「Metadata 同步」區按「重抓 metadata」："
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "系統從 Oracle 撈最新簽章並比對",
                "desc": "計算 hash 差異（顯示前 8 碼變化）"
              },
              {
                "title": "出現 diff 確認視窗",
                "desc": "🟢 新增參數 / 🔴 移除參數 / 🟡 型別變更（會列出每個欄位如 in_out、data_type、data_length 等具體差異）"
              },
              {
                "title": "按「套用並合併」",
                "desc": "系統智慧合併：**保留您原本的 `ai_hint` / `LOV 設定` / `預設值` / `inject 設定` / `可見/鎖定` 狀態**，覆蓋 metadata 型別欄位。Oracle 移除的欄位及其 LOV 會一併刪除"
              },
              {
                "title": "自動重新生成 tool_schema",
                "desc": "並同步到對應的 proxy skill（供 LLM function calling 使用）"
              },
              {
                "title": "若該參數的型別變了（例如 VARCHAR → NUMBER）",
                "desc": "請回到該參數，檢查 LOV SQL 的 value_col 是否仍回傳正確型別（舊 SQL 可能在傳字串，新的需要改成傳 ID）"
              }
            ]
          },
          {
            "type": "note",
            "text": "「套用並合併」會立即寫回 DB（含 params_json / tool_schema / metadata_hash），不需要再按「儲存」；但其他欄位（name / description / limits 等）若有編輯仍要按右下儲存。"
          },
          {
            "type": "tip",
            "text": "若顯示「✓ Metadata 無變動」代表本地與 Oracle 一致，不用動作。系統本身也會週期性偵測 drift（metadata_drifted 旗標），列表頁會以警示標記提醒。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "🔧 管理員：ERP 結果翻譯詞庫",
        "blocks": [
          {
            "type": "para",
            "text": "PROCEDURE 回傳的中文文字（例如「發補單」「退料單」「審核中」）在使用者切到 English/Vietnamese 時會自動翻譯。為提升準確度，Admin 可維護專有名詞對照表。"
          },
          {
            "type": "steps",
            "items": [
              {
                "title": "在「Admin → API 連接器 → ERP Procedure」頁面右上按「翻譯詞庫」",
                "desc": "開啟詞庫管理 Modal"
              },
              {
                "title": "新增詞彙",
                "desc": "填寫中文原文、English 譯文、Tiếng Việt 譯文（可選其一）、備註。例：「發補單」→「Reissue Note」/「Phiếu bổ sung」"
              },
              {
                "title": "表格中每列可直接編輯",
                "desc": "改 en / vi / 備註後列尾會出現儲存圖示，點下即更新"
              },
              {
                "title": "刪除不再使用的詞彙",
                "desc": "點 trash 圖示"
              }
            ]
          },
          {
            "type": "list",
            "items": [
              "翻譯流程：使用者點「翻譯」→ Server 把詞庫當 glossary 注入 Gemini Flash prompt，AI 會優先使用您定義的譯文，並保留代碼/ID/數字/日期原樣",
              "**快取策略**：翻譯結果以原文 SHA hash 為 key 存 Redis 24 小時。同段原文任何使用者再查都不重複翻（節省 token）",
              "**詞庫改動約 10 分鐘內生效**（app-level cache TTL）；已快取的翻譯仍走舊詞庫 24 小時，新詞庫只對新內容生效"
            ]
          },
          {
            "type": "tip",
            "text": "詞庫不需要收集所有字詞 — 只把「AI 會亂翻」或「想統一用語」的專有名詞寫進去即可，通常 100 個詞就覆蓋 95% 場景。代碼/ID/數字 AI 會自動保留原樣，不需要放進詞庫。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "常見問題",
        "blocks": [
          {
            "type": "table",
            "headers": [
              "問題",
              "可能原因 / 解法"
            ],
            "rows": [
              [
                "AI 沒有呼叫 ERP 工具",
                "1) topbar 是否有勾選對應工具；2) 訊息中沒明確提到 ERP 相關關鍵字；3) 工具尚未授權，請向管理員確認"
              ],
              [
                "畫面出現「需要使用者確認」",
                "這是 WRITE 型工具的保護機制，請檢視參數與操作摘要後再決定是否確認"
              ],
              [
                "「呼叫過於頻繁」錯誤",
                "工具有每分鐘 / 每小時呼叫上限，請稍後再試；長期需要可請管理員調整"
              ],
              [
                "結果看起來不完整",
                "AI 看到的是截斷版，若需要完整資料，請按「查看完整結果」或請 AI 匯出檔案"
              ],
              [
                "某個工具找不到了",
                "可能被管理員停用或取消授權，請聯繫管理員"
              ],
              [
                "某欄下拉顯示「請先選擇：XXX」",
                "LOV 依賴另一欄（cascading），請先在上游欄位選好值，系統會自動重撈此欄的可選項"
              ],
              [
                "翻譯按鈕沒出現",
                "僅當 UI 語言為 English 或 Tiếng Việt 時顯示；切換至對應語言後重新開啟執行視窗即可"
              ],
              [
                "下拉只看到 1~2 筆像是被切到",
                "combobox 改為展開整塊，會往下推擠內容；若 modal 空間不夠請往上捲看搜尋框與清單，或直接打字縮範圍"
              ],
              [
                "長結果要換行但都擠成一行",
                "ERP FUNCTION / PROCEDURE 必須使用 `CHR(10)`（LF）或 `CHR(13)||CHR(10)`（CRLF）串接換行；單獨的 `CHR(13)` 瀏覽器不認，會顯示為無換行效果"
              ],
              [
                "想改條件再查一次，不想關掉重開",
                "執行完結果出現後，底部左下的「重新查詢」按鈕可直接用上方當前參數再執行一次"
              ],
              [
                "想看整份完整結果",
                "按結果段落右上的「放大」按鈕進入全螢幕檢視；或按「以此提問」把結果送進對話由 AI 協助分析"
              ],
              [
                "（管理員）改過 PROCEDURE 後欄位還是舊的",
                "到編輯視窗頂部按「重抓 metadata」→「套用並合併」，系統會保留你既有的 ai_hint / LOV 設定"
              ]
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "u-chat-chart",
    "sort_order": 33,
    "icon": "BarChart3",
    "icon_color": "text-amber-600",
    "last_modified": "2026-04-27",
    "title": "對話圖表與我的圖庫",
    "sidebar_label": "對話圖表",
    "blocks": [
      {
        "type": "para",
        "text": "FOXLINK GPT 能在對話中把 AI 回應或工具結果**自動畫成互動圖表**。好用的圖可以「釘選」到「我的圖庫」收藏、分享給同事，或匯出成 PPTX 放進報告。"
      },
      {
        "type": "tip",
        "text": "核心設計:圖表分享的是「設計模板」,不是資料本身。被分享者用自己的權限重跑工具取得最新資料，資安自然由既有工具權限把關，不用擔心資料外流。"
      },
      {
        "type": "subsection",
        "title": "對話中自動畫圖",
        "blocks": [
          {
            "type": "para",
            "text": "當你問 AI 涉及數據比較、趨勢或比例的問題，且 AI 抓到足夠結構化資料(例如 ERP 工具回傳的表格、庫存清單)，就會在回答中**自動嵌入互動圖表**。"
          },
          {
            "type": "list",
            "items": [
              "適合畫圖的場景：排名 / 時間趨勢 / 佔比 / 多廠區比較 / 多料號比較",
              "不適合：單一數字、大段文字敘述、過少或過多的資料"
            ]
          },
          {
            "type": "note",
            "text": "若資料量少於 3 筆或多於 100 筆，AI 預設不畫圖；改用表格更清楚易讀。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "圖表右上角工具列",
        "blocks": [
          {
            "type": "para",
            "text": "滑鼠移到任一張圖表上，右上角會顯示工具列：圖型切換、樣式設定、釘選、PPTX 匯出、PNG 下載。"
          },
          {
            "type": "table",
            "headers": ["按鈕", "功能", "用途"],
            "rows": [
              ["圖型切換(4 個 icon)", "長條 / 折線 / 面積 / 圓餅", "資料不變，直接切不同視覺；不需要重打 AI"],
              ["⚙ 樣式設定", "右側彈出細調 panel", "改配色、字級、圖例位置、格線、數字格式、深色背景"],
              ["⭐ 釘選", "加入「我的圖庫」", "永久收藏，可重跑取新資料、可分享給同事"],
              ["📄 PPTX", "匯出簡報", "單張圖直接產生 PPTX 檔下載，含標題 + 圖片 + 資料表"],
              ["⬇ PNG", "下載圖片", "高解析度 PNG(2x pixel ratio)，供 email 或截圖使用"]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "樣式設定與樣式模板",
        "blocks": [
          {
            "type": "para",
            "text": "點圖表右上的 ⚙ 按鈕，右側會彈出樣式設定 panel。可即時調整以下項目："
          },
          {
            "type": "list",
            "items": [
              "**配色**:5 組預設(Blue/Green/Warm/Purple/Teal)+ 自訂 5 色(含 240 色光譜 / 40 標準色 / Hex 輸入,與 AI 戰情同一元件)",
              "**每種圖型獨立配色**:長條圖 / 折線圖 / 面積圖 / 圓餅圖 各自可選「繼承主配色」或指定不同 palette(例:bar 用 Blue、pie 用 Warm 互不影響)",
              "**恢復內建預設**:模板編輯器左下角按鈕一鍵重置到 FOXLINK 程式初始值,避免改壞了回不去",
              "**文字**:標題 / 軸 / 圖例三組字級",
              "**排版**:圖例位置(上/下/左/右/隱藏)、顯示 Y 軸格線、深色/淺色背景",
              "**X 軸標籤**:旋轉角度(自動 / 0° / 15° / 30° / 45° / 60° / 90°)+ 超長截斷(不截斷 / 6 / 8 / 12 / 16 字,完整值仍在 tooltip)。預設「自動」會依 label 長度與數量智能判斷,料號太長時自動旋轉避免被 ECharts 吃掉",
              "**數字格式**:原始 / 千分位 / 百分比;整數 / 1 位 / 2 位小數",
              "**圖型個別**:折線平滑、圓餅甜甜圈樣式",
              "**長條圖專屬**:圓角、透明度、陰影立體感、**每支 bar 不同色**(單系列時)、**自訂每根 bar 顏色**(8 組 ColorPicker,支援 240 色光譜 / 40 標準色 / Hex 輸入,右上 × 可清除回 palette)、動畫(關閉/從底部長出/淡入/彈跳)、逐個浮現交錯"
            ]
          },
          {
            "type": "tip",
            "text": "Panel 底部的「另存為模板」可以把當前樣式存成命名模板，之後在「我的圖庫 → 樣式模板」管理。"
          },
          {
            "type": "subsection",
            "title": "樣式模板 — 每種圖型各自可設預設",
            "blocks": [
              {
                "type": "para",
                "text": "到「我的圖庫」第 3 個 tab「樣式模板」可以建立 / 編輯命名模板。每張模板卡片右側的 ⭐ 按鈕是**下拉選單**,可設為不同圖型的預設:"
              },
              {
                "type": "list",
                "items": [
                  "**全圖型(all)**:所有自動產生的圖預設都套這個(fallback 用)",
                  "**長條圖 / 折線圖 / 面積圖 / 圓餅圖 / 散點圖 / 熱力圖 / 雷達圖**:只套用到該圖型",
                  "例:「合理庫存模板一」設為 bar 預設 + 「合理庫存圓餅圖」設為 pie 預設 → chat 內出現 bar 自動用前者,出現 pie 自動用後者",
                  "在 chat 內切換圖型(bar ↔ line ↔ area ↔ pie 4 個 icon)→ 樣式會跟著換成該圖型的預設模板",
                  "Fallback 順序:`type 專屬預設 → all 預設 → 系統 FOXLINK 預設 → 程式內建值`"
                ]
              },
              {
                "type": "tip",
                "text": "再點一次同一個 type 即可取消(該 type 退回上一層 fallback)。一個模板只能當**一種 type** 的預設,要同時當兩種要複製另一張。"
              },
              {
                "type": "note",
                "text": "「FOXLINK 預設」是系統內建模板(Blue palette + 千分位 + 淺色),使用者無法刪除;admin 可編輯。若你從未自建或設定任何模板,圖表就會用它。"
              },
              {
                "type": "steps",
                "items": [
                  { "title": "到「我的圖庫」點上方 tab「樣式模板」" },
                  { "title": "按右上「+ 新增模板」" },
                  { "title": "輸入名稱(如「部門報告用」)", "desc": "右側調整選項,左側即時預覽" },
                  { "title": "儲存" },
                  { "title": "在列表點該模板的 ⭐ 按鈕設為預設", "desc": "下拉選單選 all / bar / line / area / pie / scatter / heatmap / radar" }
                ]
              },
              {
                "type": "tip",
                "text": "**模板編輯器預覽**:左側預覽圖的 type 會跟著模板的「目前是哪個 type 的預設」— 例如設為 pie 預設的模板,打開編輯就直接用 pie 預覽;沒綁 type 的新模板用 bar 預覽。預覽本身沒有工具列(⚙ / 釘選等),所有調整請用右側面板,避免雙入口混淆。"
              },
              {
                "type": "subsection",
                "title": "Admin:編輯系統模板「FOXLINK 預設」",
                "blocks": [
                  {
                    "type": "para",
                    "text": "Admin 身分可以直接編輯系統內建的「FOXLINK 預設」— 修改後全站使用者都會受影響(沒自建 / 沒選其他模板的使用者,chart 都會套新版系統預設)。"
                  },
                  {
                    "type": "list",
                    "items": [
                      "系統模板區塊標題旁會顯示「Admin 可編輯」藍色 badge",
                      "系統卡片右側出現藍色 Edit icon,點了跳同一個 ChartStyleTemplateEditor",
                      "**系統模板不可刪除、不可設為某 user 的 default**(系統是全站共用,只能編內容)",
                      "若改壞了:左下角「恢復內建預設」按鈕一鍵回到程式內建值,按「儲存」才真正寫回 DB"
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "LLM 沒畫圖?主動叫它畫",
        "blocks": [
          {
            "type": "para",
            "text": "如果 AI 回覆的數據沒自動畫圖，把滑鼠移到 AI 訊息下方，點「📊 畫成圖表」按鈕選圖型，AI 會重新產生一張符合你要求的圖。"
          },
          {
            "type": "tip",
            "text": "直接打字「請把上面的數據畫成折線圖」也能觸發，效果相同。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "從 ERP 工具直接設計圖表",
        "blocks": [
          {
            "type": "para",
            "text": "若你手動執行 ERP procedure(點側邊 ERP 工具，填好參數按執行)，可以在結果畫面的第三個 tab「📊 圖表」直接設計圖表，**不需要經過 AI 對話**。這是建立圖庫最快的路徑，因為工具來源明確、欄位結構已知。"
          },
          {
            "type": "steps",
            "items": [
              { "title": "側邊工具欄 → 選擇 ERP 工具" },
              { "title": "填入參數後按「執行」", "desc": "等待 procedure 回傳結果" },
              { "title": "結果出現後切到右上角「📊 圖表」tab" },
              { "title": "選擇圖型", "desc": "長條 / 折線 / 面積 / 圓餅" },
              { "title": "選 X 軸欄位 + 勾選 Y 軸欄位", "desc": "Y 軸可多選作疊加比較" },
              { "title": "調整標題,右下即時預覽" },
              { "title": "按「儲存到圖庫」", "desc": "把這張圖的「設計」存成可重用模板（不存資料）" }
            ]
          },
          {
            "type": "note",
            "text": "此路徑儲存的圖會帶上 ERP tool 來源與當下的參數值，之後在「我的圖庫」可以改參數重新執行、分享給其他同事。"
          },
          {
            "type": "tip",
            "text": "若管理員在工具管理的「輸出解析（Answer Output Format）」已設定欄位分隔符 / 欄位名稱 / 附加圖表，圖表 tab 會**自動套用**這些設定作為預設值（包含圖型、X/Y 欄位、標題）。你仍可在畫面上調整後再儲存，不會覆蓋原本工具設定。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "我的圖庫",
        "blocks": [
          {
            "type": "para",
            "text": "頁面入口:上方導覽列或側邊選單的「我的圖庫」。頁面分兩個 tab。"
          },
          {
            "type": "table",
            "headers": ["Tab", "內容", "可做的事"],
            "rows": [
              ["我的", "你釘選 / 設計的圖表", "執行、編輯、分享、刪除、匯 PPTX"],
              ["別人分享給我的", "同事分享給你的圖", "以自己權限執行取資料、匯 PPTX"]
            ]
          },
          {
            "type": "para",
            "text": "點圖表卡片的「打開」按鈕展開，系統會以你自己的權限重新執行來源工具(ERP / MCP / 技能)，用最新資料繪製。"
          },
          {
            "type": "tip",
            "text": "若圖表設定了參數(日期範圍、組織代碼等)，打開時會出現參數表單讓你先填再執行。改參數再按「執行」可以看不同條件下的結果，不會覆蓋原本設定。"
          },
          {
            "type": "para",
            "text": "右上「+ 新增圖表」可以從零設計全新圖表:選 ERP 工具 → 填參預覽 → 選圖型 → 儲存。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "分享圖表給同事",
        "blocks": [
          {
            "type": "para",
            "text": "在「我的圖庫」的圖表卡片點右側分享圖示，選擇分享對象(7 維度):"
          },
          {
            "type": "list",
            "items": [
              "特定使用者(工號 + 姓名搜尋)",
              "角色(如所有 admin / QA 工程師)",
              "廠區 / 部門 / 利潤中心 / 事業處 / 事業群"
            ]
          },
          {
            "type": "note",
            "text": "**分享的是圖表設計，不是資料**。被分享者必須自己有使用該 ERP 工具 / MCP server 的權限才能真正看到圖。若沒權限，打開時會提示「請聯絡 admin 申請」。"
          },
          {
            "type": "tip",
            "text": "此設計讓你能放心把常用分析方法分享給整個部門，不必擔心資料外流 — 因為分享的本質是「怎麼問這個問題」，不是「某個時點的答案」。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "匯出為 PPTX",
        "blocks": [
          {
            "type": "para",
            "text": "任一張圖表(對話中或圖庫中)右上角的「📄 PPTX」按鈕可匯出成 PPTX 檔，每張圖一個投影片，包含:"
          },
          {
            "type": "list",
            "items": [
              "標題(使用你設定的圖表標題)",
              "高解析度圖片(寬螢幕版面)",
              "資料表(前 30 列，顯示在圖右側)",
              "頁尾：資料來源 + 產生時間"
            ]
          },
          {
            "type": "tip",
            "text": "適合快速放進 weekly report / 部門簡報，省去截圖 + Excel 貼表格的流程。PPTX 是標準格式，Office / WPS / Google Slides 都能開。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "哪些圖表不能分享?",
        "blocks": [
          {
            "type": "para",
            "text": "只有「來源於可重執行工具」的圖表可以分享。下列情況無法分享:"
          },
          {
            "type": "table",
            "headers": ["情況", "為何無法分享", "使用限制"],
            "rows": [
              ["純對話手動貼資料畫的圖(Freeform)", "沒有工具來源，無法重執行", "只能私人收藏，分享按鈕停用"],
              ["資料來源欄位已變更", "工具 schema 漂移，欄位對不上", "圖庫卡片會警告，owner 需重新設計圖表"]
            ]
          }
        ]
      },
      {
        "type": "subsection",
        "title": "敏感資料保護",
        "blocks": [
          {
            "type": "para",
            "text": "系統會自動掃描圖表資料中的敏感關鍵字(由管理員維護的清單)。命中時整張圖會被遮蔽，顯示「⚠ 圖表含敏感資料，已遮蔽」警示，但文字答案不受影響。"
          },
          {
            "type": "note",
            "text": "若合法圖表被誤判為敏感，請聯絡管理員調整敏感字清單。"
          }
        ]
      },
      {
        "type": "subsection",
        "title": "常見問題",
        "blocks": [
          {
            "type": "table",
            "headers": ["狀況", "可能原因", "解決方式"],
            "rows": [
              ["AI 沒畫圖", "資料量太少 / 太多，或不適合視覺化", "手動點「畫成圖表」指定圖型，或直接打字要求"],
              ["釘選後的圖在圖庫顯示「Freeform」標籤", "該圖來自純對話、不帶工具來源", "改從 ERP 工具結果直接釘選，或讓 AI 透過工具取資料後再釘"],
              ["打開分享圖顯示「無使用權限」", "你沒有該 ERP / MCP / skill 工具的使用權", "聯絡 admin 申請對應權限"],
              ["圖庫卡片顯示 schema 漂移警告", "工具欄位被 DBA 修改", "通知圖表 owner 重新打開設計並儲存(會更新 schema hash)"],
              ["PPTX 匯出失敗", "瀏覽器阻擋下載 / 記憶體不足", "重整頁面再試，或改用 PNG 下載"],
              ["修改 ERP procedure 後圖表顯示舊欄位", "chart_spec 存的是當時欄位設定", "圖表 owner 到圖庫開該圖 → 重新選欄位 → 儲存"],
              ["執行圖庫的 ERP 圖表「必填參數 X 未提供」", "舊版釘選時沒帶原始呼叫參數(已修復，但舊圖仍要手填一次)", "打開該圖 → ChartParamForm 自動出現欄位 → 填入 P_ORG_ID 等 → 執行"],
              ["X 軸標籤(長料號)中間缺字", "ECharts 預設會跳過擠不下的 label", "系統已自動旋轉;若要手動指定，樣式設定 → X 軸標籤 → 旋轉 / 截斷字數"],
              ["改壞了模板想回初始值", "—", "開模板編輯器 → 左下「恢復內建預設」→ 確認 → 儲存"],
              ["長條圖單系列想每支不同色(排名圖)", "預設同色", "樣式設定 → 長條圖 → 勾「每支 bar 不同色(單系列時)」;或 8 組 color picker 指定前 8 支"],
              ["模板編輯器預覽跟實際圖型不符", "預設顯示 bar,除非模板綁定 type", "把模板設為某 type 預設(例圓餅圖),再打開編輯 → 預覽自動變該 type"]
            ]
          }
        ]
      }
    ]
  }
];

module.exports = { userSections };
