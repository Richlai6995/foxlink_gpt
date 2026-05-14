/**
 * 公用 ShareModal — re-export `components/dashboard/ShareModal`(已是高度通用元件)。
 *
 * 設計取捨:既有 6 個 caller(AiDashboardPage / DashboardBoardPage / MyChartsPage /
 * ErpToolsPanel / DifyKnowledgeBasesPanel / MCPServersPanel)都 import `dashboard/ShareModal`,
 * 直接搬位置會 churn 6 個 import,改採 **re-export**:
 *   - 新功能(排程任務分享)import 這條 `common/ShareModal`(語意正確)
 *   - 既有功能繼續 import 原 path(零破壞)
 *   - 真正的元件邏輯只有一份(dashboard/ShareModal.tsx)
 *
 * 接受 props:title / sharesUrl / onClose / shareTypeOptions / defaultShareType / hint / headerTitle
 * 詳見 dashboard/ShareModal.tsx
 */
export { default } from '../dashboard/ShareModal'
