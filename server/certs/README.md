# MCP JWT Key Pair

本目錄存放 FOXLINK GPT ↔ MCP server 之間 User Identity 認證所用的 RSA key pair。
規格詳見 `docs/mcp-user-identity-auth.md`。

> ⚠️ `*.pem` 全部列在 `.gitignore` 裡,**絕對不要 commit**。

---

## 首次部署:產生 key pair

```bash
cd server/certs
openssl genrsa -out mcp-jwt-private.pem 2048
openssl rsa -in mcp-jwt-private.pem -pubout -out foxlink-gpt-public.pem
```

產出兩個檔案:

| 檔案 | 持有者 | 機密性 |
|---|---|---|
| `mcp-jwt-private.pem` | **僅 FOXLINK GPT** | 🔴 機密,不可外洩 |
| `foxlink-gpt-public.pem` | **所有 MCP 團隊** | 🟢 可公開 |

---

## 分發公鑰給 MCP 團隊

兩種方式擇一:

1. **Admin UI 下載按鈕**(推薦):登入 Admin → MCP 伺服器 → 編輯任一 server → 使用者身份認證區塊 → 下載公鑰
2. **直接貼**:`cat server/certs/foxlink-gpt-public.pem` → 貼給對方

---

## K8s 部署

把兩個 `.pem` 建成 Secret,掛進 container:

```bash
kubectl create secret generic mcp-jwt-keys \
  --from-file=mcp-jwt-private.pem \
  --from-file=foxlink-gpt-public.pem \
  -n foxlink-gpt
```

`k8s/deployment.yaml` volumeMount 到 `/app/certs/`,`.env` 對應:

```
MCP_JWT_PRIVATE_KEY_PATH=/app/certs/mcp-jwt-private.pem
MCP_JWT_PUBLIC_KEY_PATH=/app/certs/foxlink-gpt-public.pem
```

---

## Rotation(建議 1 年一次或人員異動時)

詳細流程見 `docs/mcp-user-identity-auth.md` §4.3。

簡要步驟:
1. 產新 key pair(`mcp-jwt-private-v2.pem` / `foxlink-gpt-public-v2.pem`)
2. **先**發新公鑰給所有 MCP 團隊,它們先同時接受新舊兩把公鑰
3. 確認 MCP 都部署完 → FOXLINK GPT 切換到新私鑰
4. 一週後 MCP 移除舊公鑰

---

## 如果私鑰洩漏了?

立刻執行 rotation(同上),**不要試圖「只換」而不通知 MCP 團隊**——洩漏期間的舊 token 會一直有效到 `exp` 為止(5 min),但攻擊者能持續用洩漏的私鑰簽新 token。

Rotation 完成前,可在 FOXLINK GPT 側先把所有 `mcp_servers.send_user_token` 改成 `0` 阻斷簽發。
