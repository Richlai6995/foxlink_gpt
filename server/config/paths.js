/**
 * 集中管理所有路徑設定，確保 UPLOAD_DIR 在所有模組中一致。
 * K8s 環境透過 UPLOAD_DIR env var 指定 NFS mount path。
 */
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, '../uploads');

// 確保所有子目錄存在
for (const sub of ['tmp', 'generated', 'user_images', 'shared', 'dashboard_icons']) {
  fs.mkdirSync(path.join(UPLOAD_DIR, sub), { recursive: true });
}

module.exports = { UPLOAD_DIR };
