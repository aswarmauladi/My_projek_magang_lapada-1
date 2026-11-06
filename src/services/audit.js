const { db } = require('../db/initDb');

function recordAudit(actorId, action, entity, entityId = null, details = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO audit_logs (actor_id, actor_username, action, entity, entity_id, details)
       SELECT id, username, ?, ?, ?, ? FROM users WHERE id = ?`,
      [action, entity, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, actorId],
      function (error) {
        if (error) reject(error);
        else if (!this.changes) reject(new Error('Akun pencatat aktivitas tidak ditemukan'));
        else resolve(this.lastID);
      }
    );
  });
}

module.exports = { recordAudit };
