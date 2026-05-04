# Cortex 對外網開放 — 資安強化簡報

> 產出日期:2026-05-04
> 對應實作:commits `fe9a84a` → `bf52fef`(5 個 PR,2026-04-30 ~ 2026-05-03)
> 對象:**資訊長 / IT 最高主管**
> 用途:技術面評估「對外開放安全性是否足夠」 + WAF / 防火牆調整建議
>
> 完整技術文件:[external-access-security.md](./external-access-security.md)
> 風格建議:深色系 navy + amber;每張一張重點;含風險評估燈號(🟢 done / 🟡 partial / 🔴 gap)

---

## 📑 術語對照表(會前發給參與者)

| 簡稱 | 白話解釋 |
|------|---------|
| Cortex | 公司內部 AI 智慧助理平台(原 Foxlink GPT) |
| WAF | Web Application Firewall — 應用層防火牆,擋 SQLi/XSS 等攻擊 |
| MFA / 2FA | Multi-Factor Authentication — 二階段驗證(密碼 + Webex OTP) |
| OTP | One-Time Password — 一次性密碼,5 分鐘有效 |
| DDoS | Distributed Denial of Service — 分散式阻斷服務攻擊 |
| Rate Limit | 請求頻率上限,擋 brute force / flood |
| OWASP | 國際公認 Web 安全風險組織,Top 10 = 業界共通 checklist |
| Defense in Depth | 縱深防禦 — 多層防線,單層被破不致全失 |
| Trust Proxy | 正確識別真實使用者 IP(防 X-Forwarded-For 偽造) |
| Trusted IP | 同一 user 過 MFA 的 IP,7 天內免重認 |
| K8s | Kubernetes — 容器調度平台 |
| Ingress | K8s 對外流量入口(本案用 nginx-ingress) |
| RBAC | Role-Based Access Control — 角色權限控制 |
| Geo-blocking | 依國家/地區封鎖流量 |
| Penetration Test | 第三方模擬攻擊測試,業界稱「pentest」 |

---

## Slide 1 — 封面

```
╔═══════════════════════════════════════════╗
║                                           ║
║   Cortex 對外網開放 — 資安強化方案        ║
║                                           ║
║   技術面深度評估 + 邊界防護建議           ║
║                                           ║
║   ─────────────────────────────────       ║
║                                           ║
║   應用層 9 道防線完成 ✅                   ║
║   等待邊界層(WAF / FW)補位 🟡             ║
║                                           ║
║   資訊部 · 2026-05-04                     ║
║                                           ║
╚═══════════════════════════════════════════╝
```

---

## Slide 2 — 本次簡報要回答兩個問題

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   Q1.  Cortex 應用層強化夠不夠?                         ║
║        → 答:夠 8 成,剩 2 成靠邊界層補                  ║
║                                                          ║
║   Q2.  WAF 與防火牆要怎麼配,才補得起來?                ║
║        → 答:6 大調整建議,本簡報後半詳列                ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**為什麼要對外開放**:出差員工 / 海外廠 / 居家辦公 / 合作夥伴需求增加,VPN 不再是唯一選項。

**外網開放後新增風險**:來自 Internet 的所有流量都打得到我們的 login endpoint,攻擊面 100x 放大。

---

## Slide 3 — 縱深防禦(Defense in Depth)架構

```
   ☁️  Internet
        │
   ┌────▼────────────────┐
   │  ① 上游 ISP / CDN    │  🔴 還沒做(本簡報建議)
   │     DDoS L3/L4       │
   └────┬────────────────┘
        │
   ┌────▼────────────────┐
   │  ② 邊界防火牆        │  🟡 需調整(本簡報建議)
   │     Geo-block / L4   │
   └────┬────────────────┘
        │
   ┌────▼────────────────┐
   │  ③ WAF(應用層 FW)  │  🔴 還沒做(本簡報建議)
   │     OWASP CRS / Bot  │
   └────┬────────────────┘
        │
   ┌────▼────────────────┐
   │  ④ K8s Ingress       │  ✅ 已做(rate limit + whitelist)
   └────┬────────────────┘
        │
   ┌────▼────────────────┐
   │  ⑤ Cortex 應用層 ★   │  ✅ 9 道防線已 ship
   │   (本次工程重點)    │
   └─────────────────────┘
```

**核心原則**:每一層**獨立**有效,單層被破不致全失。Cortex 應用層不依賴 WAF 也能擋大部分攻擊。

---

## Slide 4 — Cortex 應用層 9 道防線(全 ship)

```
外網請求進來會通過 9 道關卡(內網全部跳過):

①  Trust Proxy           真實 IP 識別 / 防偽造 X-Forwarded-For
②  IP 黑名單(自動)      已驗證攻擊者直接斷線
③  IP 黑名單(管理員)    Admin UI 手動加減
④  滲透工具偵測(UA)     sqlmap / nikto / nmap 等命中即斷
⑤  外網路徑控制          /admin /uploads 等永遠只給內網
⑥  Per-IP Rate Limit     單 IP 120 req/min(跨容器共享)
⑦  Webex MFA 二階段       6 位 OTP,5 分鐘有效,/32 嚴格綁 IP
⑧  Admin 限內網          admin 帳號從外網一律 403
⑨  認證稽核 + 自動告警    永久保留 + 異常即時通知
```

| # | 防線 | 防什麼攻擊 |
|---|------|-----------|
| ① | Trust Proxy | IP 偽造繞過內網檢查 |
| ②③ | IP 黑名單 | 已知攻擊源 / botnet |
| ④ | UA 偵測 | 自動化掃描工具 |
| ⑤ | 路徑控制 | 從外網存取管理介面 |
| ⑥ | Rate Limit | Brute force / DDoS 應用層 |
| ⑦ | MFA | 帳密外洩 / 釣魚成功的後門 |
| ⑧ | Admin 限內網 | 高權限帳號被釣最大爆炸半徑 |
| ⑨ | 稽核 | 事後溯源 / 即時警示 |

---

## Slide 5 — Webex MFA(二階段驗證)流程

```
  使用者輸入帳密
        │
        ▼
  ┌─────────────────┐
  │ ① 帳密驗證       │ ← LDAP / SSO / 本地三選一
  └────────┬────────┘
           │ 通過
           ▼
  ┌─────────────────┐
  │ ② 是內網嗎?     │ ── 是 ──► 直接登入(免 OTP)
  └────────┬────────┘
           │ 否
           ▼
  ┌─────────────────┐
  │ ③ 同 IP 7 天內   │ ── 是 ──► 直接登入(免 OTP)
  │   過 MFA 嗎?    │
  └────────┬────────┘
           │ 否
           ▼
  ┌─────────────────┐
  │ ④ Webex Bot DM   │
  │   送 6 位 OTP    │ → user 收 DM → 5 分鐘倒數
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ ⑤ 輸入 OTP 通過  │ → 信任 IP 7 天 + 建 session
  └─────────────────┘
```

**設計要點**:
- ✅ OTP 用 cryptographic random,**不寫入 log** 任何地方
- ✅ /32 嚴格 IP 綁定(同網段不共享,鄰居 NAT 風險不可接受)
- ✅ 5 次錯誤刷掉 challenge(防爆破),**不鎖帳號**(防惡意鎖人)
- ✅ Admin 角色一律拒外網(無 MFA 例外)
- ✅ 改密碼自動清空所有信任 IP + sessions

---

## Slide 6 — IP 黑名單(自動 + 手動)

**自動加入規則**(內網永不被擋):

| 觸發 | 預設時間 | 來源標記 |
|------|---------|---------|
| 同 IP 1 小時失敗 ≥ 10 次 | 24 小時 | `auto_failure` |
| User-Agent 命中滲透工具(sqlmap/nikto/nmap/masscan/burp/metasploit 等 16 項) | 7 天 | `auto_ua` |
| 管理員手動 | 自訂 / 永久 | `manual` |

**故意不擋** `curl` / `wget` / `python-requests`:這些是 K8s 健康檢查 / 內部腳本也用的合法工具,誤殺風險高 → 改用 IP 黑名單針對個別 IP 處理。

```
┌─────────────────────────────────────────────┐
│  Admin 後台「IP 黑名單」介面                │
│  ───────────────────────────────────────    │
│  IP 192.0.2.45    來源 auto_failure         │
│  原因 9 次失敗登入(2026-05-03 14:23)       │
│  到期 2026-05-04 14:23   [移除]            │
│                                             │
│  IP 198.51.100.7  來源 auto_ua              │
│  原因 UA 命中 sqlmap/1.6.7                  │
│  到期 2026-05-10 09:15   [移除]            │
└─────────────────────────────────────────────┘
```

效能:Redis cache,正常請求 < 1ms 影響;Redis 故障時保守放行不阻斷服務。

---

## Slide 7 — Per-IP Rate Limit(L7 anti-flood)

**兩層 rate limit,內網跳過,SSE 長連線排除**:

| 層 | 設定 | 角色 |
|---|------|------|
| **App 層**(主要) | 單 IP 120 req/min,跨容器共享(Redis) | 主要防線 |
| **Ingress 層**(兜底) | 單 IP 30 rps × 5 burst | 兜底防爆 K8s |

**正常使用者**:對話流量約 5-20 req/min,根本碰不到上限。
**Botnet flood**:每 IP 1 分鐘最多 120 個 request,即使 1000 個 bot IP 也只有 12 萬 req/min(平均),系統可承受。

---

## Slide 8 — 認證稽核(Audit Trail)

**所有認證事件永久保留**(`auth_audit_logs` 表),管理員可在後台查詢 / 過濾 / 匯出 CSV。

**16 種事件類型**(節錄):
```
login_success_internal                   內網登入成功
login_success_external_skip_mfa          外網但已信任 IP
login_success_external_mfa               外網 + MFA 通過
login_failed_credentials                 帳密錯誤(觸發失敗計數)
login_failed_admin_external              ⚠️ admin 從外網嘗試(高度可疑)
mfa_dm_failed                            Webex DM 故障
mfa_verify_too_many                      OTP 5 次錯刷 challenge
trusted_ip_revoked_password_change       改密碼自動清空信任 IP
forgot_password_rate_limited             忘記密碼防濫用
```

**自動告警**(寄信 admin 信箱):
- 同一 user 1 小時失敗 ≥ 5 次
- 同一 IP 1 小時失敗 ≥ 10 次(同時自動加 24 小時黑名單)
- 1 小時內不重複寄(防 mail bomb)

**異常登入通知**:使用者從新 IP 通過 MFA 後,系統 Webex DM 提醒「您的帳號剛從新 IP 登入,若非本人請改密碼」。

---

## Slide 9 — 安全性評估:夠了嗎?(誠實版)

```
              已做                  Gap
              ────                  ────
身份驗證       🟢 LDAP+SSO+MFA       🟡 TOTP 備援(Webex 故障時)
帳號管理       🟢 RBAC + 限內網       —
Session       🟢 Redis 8h + 改密踢   —
應用層攻擊     🟡 ORM 防 SQLi         🔴 沒有 signature-based(WAF)
DDoS L7       🟢 Rate Limit         —
DDoS L3/L4    🔴 沒做                🔴 ISP / CDN 補
Bot 防護      🟡 UA 黑名單           🔴 沒有行為分析(WAF Bot Mgmt)
網路隔離       🟡 K8s NetworkPolicy   🟡 Egress filter 待確認
TLS / Cipher  🟡 K8s 平台預設         🟡 未做 SSL Labs 驗證
監控告警       🟢 Audit Log + Email   🟡 SIEM 整合未做
個資合規       🟡 永久保留 audit      🟡 GDPR / 個資法評估
滲透測試       🔴 沒做過              🔴 第三方 pentest 必要
```

**結論**:
- 應用層(Cortex 自己控制範圍)— **完整覆蓋 OWASP Top 10 大部分項目**
- 邊界層(WAF / FW / ISP)— **需要本次調整建議補位**
- 治理層(Pentest / SIEM / 合規)— **需要規劃 follow-up project**

---

## Slide 10 — 對 OWASP Top 10 的覆蓋

| OWASP 2021 Top 10 | Cortex 應用層 | 缺什麼 |
|---|---|---|
| A01 Broken Access Control | ✅ RBAC + admin 限內網 | — |
| A02 Cryptographic Failures | 🟡 TLS / hash OK | TLS 強度未驗證(SSL Labs) |
| A03 Injection(SQLi/XSS) | 🟡 ORM bind 防 SQLi | 🔴 **WAF signature** |
| A04 Insecure Design | ✅ MFA / Audit / Rate Limit | — |
| A05 Security Misconfiguration | ✅ Helmet headers | CSP 未開(待單獨評估) |
| A06 Vulnerable Components | 🟡 npm audit 規律跑 | SBOM 流程未制度化 |
| A07 Auth Failures | ✅ MFA + 失敗告警 + 黑名單 | — |
| A08 Software/Data Integrity | 🟡 K8s deploy chain | 🟡 image signing 未做 |
| A09 Logging/Monitoring | ✅ Audit Log + Loki | SIEM 整合未做 |
| A10 SSRF | 🟡 outbound 域名白名單 | Egress NetworkPolicy 待加 |

**A03 Injection 是最大 gap** — ORM 已防 SQL injection,但 XSS / 攻擊 payload 偵測沒有,**只能靠 WAF 補**。

---

## Slide 11 — WAF 建議規則(優先順序)

```
┌─────────────────────────────────────────────────────────────┐
│  優先序  WAF 規則                       對抗的威脅            │
├─────────────────────────────────────────────────────────────┤
│   P0    OWASP Core Rule Set (CRS) 3.x   SQLi / XSS / RCE     │
│   P0    Geo-blocking(白名單模式)       未經授權地區流量      │
│   P0    Rate-based(全站)1IP 1000/5min  Volumetric L7 DDoS   │
│   P1    Bot Management(challenge)       自動化攻擊 / 爬蟲    │
│   P1    /api/auth/* 加嚴 30 req/5min     登入 brute force     │
│   P1    /api/admin/* geo-restrict        管理介面外網存取    │
│   P2    Custom rule:封鎖未知 file ext   檔案上傳濫用          │
│   P2    Anomaly Detection(ML)          0-day / 變形攻擊      │
└─────────────────────────────────────────────────────────────┘
```

**Geo-blocking 白名單建議**:
- 🇹🇼 台灣(總部)
- 🇨🇳 中國(大陸廠 IP 段)
- 🇻🇳 越南(廠區)
- 🇲🇽 墨西哥(廠區)
- 出差臨時:走 VPN 回內網,不開 geo

**為什麼 Geo-block 很重要**:外網開放後,公開 Internet 上**自動化攻擊每秒 N 次**從俄/朝/伊朗等地打過來。Geo-block 能瞬間刪掉 90% 雜訊流量,讓 WAF / app 層專心處理剩下 10%。

---

## Slide 12 — 防火牆 / Network 邊界調整建議

```
                     建議架構

   Internet
      │
      ▼
   ┌──────────────────┐
   │  ISP DDoS 服務   │  🆕 跟 ISP 簽 mitigation  ─── 建議 1
   │  (L3/L4 清洗)   │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  WAF / CDN       │  🆕 Cloudflare/F5/Imperva  ─── 建議 2
   │  TLS termination │      含 OWASP CRS
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  邊界 FW(DMZ)   │  🟡 規則調整              ─── 建議 3
   │   只放 443 from  │      只信任 WAF 的 IP
   │   WAF 來源 IP    │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  K8s Ingress     │  ✅ 已做
   │  (nginx)         │
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Cortex Pods     │  ✅ 已做(9 道防線)
   └──────────────────┘
```

| # | 建議 | 為什麼 |
|---|------|-------|
| 1 | **ISP 簽 DDoS 清洗服務** | 大流量灌入會把 WAF 也打掛,L3/L4 必須上游處理 |
| 2 | **前置 WAF / CDN** | OWASP CRS 自動防 SQLi/XSS;CDN 額外加快靜態資源 |
| 3 | **邊界 FW 只信任 WAF IP** | 不能讓人繞過 WAF 直連 K8s ingress |
| 4 | **TLS termination 在 WAF** | 讓 WAF 看得懂內容做 inspection,K8s 內網 TLS 可選 |
| 5 | **管理介面隔離(K8s API / Grafana / Loki / Redis 內網 only)** | 縮小攻擊面 |
| 6 | **Egress filter** — Pod 只能連 Webex / Gemini / SMTP / LDAP / Oracle | 防被入侵後當跳板攻擊內部 |

---

## Slide 13 — 上線切換順序(降風險)

```
Week 1   WAF deploy(monitor mode 不擋,只 log)
   │     觀察 1 週,微調規則
   ▼
Week 2   WAF 切 enforce 模式
   │     確認正常使用者流量沒被誤殺
   ▼
Week 3   Cortex 開 MFA(內網無感)
   │     確認外網測試通過 OTP 流程
   ▼
Week 4   邊界 FW 改規則(只信任 WAF)
   │     DNS 切到 WAF
   ▼
Week 4-5 EXTERNAL_ACCESS_MODE=full,正式對外
   │
   ▼
Week 5+  密集監控 1 週(下一張)
```

**為什麼要分 5 週**:
- 並行切換風險高,單點失敗影響全公司
- WAF 規則很容易誤殺合法流量(尤其 OWASP CRS 預設嚴),先 monitor 後 enforce
- Cortex 應用層防線本來就在,先讓它擋一陣再加 WAF

**回滾策略**:每一階段都有 rollback,Cortex 改 `EXTERNAL_ACCESS_MODE=webhook_only` 即收回外網,不依賴 WAF / FW 操作。

---

## Slide 14 — 上線後監控指標

**每天看(放 Grafana dashboard)**:

| 指標 | 健康 | 警戒 | 緊急 |
|------|------|------|------|
| 認證失敗率 | < 5% | 5-15% | > 15% |
| MFA 成功率 | > 95% | 90-95% | < 90% |
| 自動加入黑名單(日) | < 5 IP | 5-30 IP | > 30 IP(可能集中攻擊) |
| Webex DM 失敗率 | < 1% | 1-5% | > 5%(MFA 通道有問題) |
| WAF block(日) | 看大盤 | 突然倍數成長 | 應有對應流量原因 |
| Login P95 latency | < 2s | 2-5s | > 5s |
| Redis cache hit | > 95% | — | < 90%(可能異常) |

**觸發深度檢查**:
- 同一 user 異地 IP 多次登入失敗 → 可能帳號被釣
- 短時間大量新 IP 通過 MFA → 可能 OTP 通道被劫持
- 黑名單成長率突增 → 集中攻擊事件

**SIEM 整合(後續 project)**:把 audit log 餵給 SOC / SIEM,中央化查詢 + correlation。

---

## Slide 15 — 還沒做的(Follow-up 建議)

```
🔴 P0(對外開放前必做)
   • 第三方 Penetration Test         預算建議:50-100 萬
   • SSL Labs 評分 A+ 驗證
   • DDoS L3/L4 mitigation(ISP 簽約或自建)

🟡 P1(對外開放後 3 個月內)
   • TOTP MFA 備援(Webex 故障時的 fallback)
   • SBOM(Software Bill of Materials)流程
   • SIEM 整合(audit log → 中央化)
   • Container image signing(supply chain)

🟢 P2(長期優化)
   • CSP(Content Security Policy)單獨評估前端兼容
   • 個資保留政策(audit log GDPR / 個資法)
   • Adaptive Card「拒絕此次登入」按鈕
   • WebAuthn / Passkey 取代密碼
```

**P0 不做後果**:
- 沒 pentest = 不知道自己哪裡破洞
- 沒 SSL Labs = 弱 cipher 可能被中間人攻擊
- 沒 DDoS L3/L4 = 一波流量灌爆 WAF 連帶斷線

---

## Slide 16 — 結論

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║  Cortex 應用層 9 道防線 ✅  覆蓋 OWASP 8/10            ║
║                                                          ║
║  剩 2/10(主要 Injection / DDoS L3/L4)                  ║
║  → 必須由 WAF + 上游 ISP 補位                            ║
║                                                          ║
║  ─────────────────────────────────────                   ║
║                                                          ║
║  本案請示批准:                                          ║
║                                                          ║
║  1. WAF 採購 / 規則設計(P0)                            ║
║  2. ISP DDoS 服務簽約(P0)                              ║
║  3. 第三方 Pentest 預算(P0)                            ║
║  4. 5 週分階段切換時程                                   ║
║  5. SIEM / TOTP / SBOM 列入 H2 規劃                      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**附件**:
- 完整技術文件 [`docs/external-access-security.md`](./external-access-security.md)
- Admin 操作手冊(系統內「外網存取與 MFA」+「IP 黑名單」章節)
- 部署 Checklist + 故障 Runbook(技術文件第 6-7 節)

---

## 簡報後 Q&A 參考

**Q1. 為什麼不直接 VPN 對外?**
> VPN 仍是首選,但 ① 外部合作夥伴申請 VPN 流程長 ② 出差網路不穩 VPN 連線品質差 ③ 行動裝置 VPN UX 差。MFA 補上「不開 VPN 但仍二階段」的 UX 缺口。VPN 與外網開放是並存策略。

**Q2. 為什麼是 Webex 不是 Google Authenticator?**
> Webex 已是公司標準工具(每位員工都裝,跟 IT 帳號綁),0 enrollment cost。TOTP 需要 enrollment UX(掃 QR、備援碼)且員工會搞丟,後續才考慮做為 fallback。

**Q3. 沒有 WAF 直接開放會怎樣?**
> 可以開,但 OWASP A03(Injection)只剩 ORM bind 一道防線。對 0-day SQL injection / 應用層邏輯攻擊沒有 signature 偵測。**強烈建議 WAF 先到位**。

**Q4. K8s ingress 的 rate limit 為什麼不夠?**
> Ingress 看到的 IP 是否真實取決於 nginx-ingress controller 的 `externalTrafficPolicy: Local` 設定。若沒設,所有人共用一個 quota = 503 全公司。app 層 rate limit 透過 Redis 跨容器共享,不依賴 K8s 平台配置。

**Q5. Webex 整體故障怎麼辦?**
> 30 秒內可由 ops 改 `EXTERNAL_ACCESS_MODE=webhook_only` 收回外網(內網仍正常),不裸奔。已有 runbook 演練。

**Q6. 改密碼會踢人嗎?**
> 會。改密碼 / reset 自動清空該 user 所有信任 IP + 所有 active sessions(只保留當前裝置),帳號疑似被釣後第一道補救。

**Q7. Audit log 永久保留會不會太多?**
> 估算:1000 user × 平均 5 events/day × 365 day = 180 萬筆/年。Oracle 上不算什麼。考慮個資法可在 90 天後將 IP / UA hash 化,但事件本身保留(後續 P2 工作)。

**Q8. 若預算只能挑一個做,選什麼?**
> **Pentest**。其餘是建構防線,pentest 是驗證防線是否真的擋得住,且能找到我們想都沒想過的洞。50-100 萬一次,對比帳號被釣的損失極划算。
