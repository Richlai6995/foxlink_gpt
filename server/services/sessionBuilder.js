/**
 * 統一的 session payload 建構器。
 * Login / SSO / Impersonate 都用這個，確保權限欄位完全一致。
 */
async function buildSessionPayload(db, userId) {
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    name: u.name,
    employee_id: u.employee_id,
    email: u.email,
    can_design_ai_select: u.can_design_ai_select,
    can_use_ai_dashboard: u.can_use_ai_dashboard,
    training_permission:  u.training_permission,
    is_erp_admin:    u.is_erp_admin === 1 || u.is_erp_admin === '1',
    role_id:         u.role_id,
    dept_code:       u.dept_code,
    profit_center:   u.profit_center,
    org_section:     u.org_section,
    org_group_name:  u.org_group_name,
    factory_code:    u.factory_code,
  };
}

module.exports = { buildSessionPayload };
