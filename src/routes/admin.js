const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/initDb');
const { requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

function normalizeProgram(payload) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const category = typeof payload.category === 'string' ? payload.category.trim() : '';
  const description = typeof payload.description === 'string' ? payload.description.trim() : '';
  const isActive = payload.is_active === undefined ? 1 : Number(payload.is_active);
  if (!name || name.length > 120) return { error: 'Nama program wajib diisi (maksimal 120 karakter)' };
  if (category.length > 60 || description.length > 1000) return { error: 'Keterangan program melebihi batas karakter' };
  if (![0, 1].includes(isActive)) return { error: 'Status program tidak valid' };
  return { value: { name, category: category || null, description: description || null, is_active: isActive } };
}

router.get('/staff', requireRole('admin'), async (req, res) => {
  try {
    const staff = await all(
      `SELECT id, name, username, email, phone, position, is_active, created_at
       FROM users WHERE role = 'pembinaan' ORDER BY name COLLATE NOCASE`
    );
    res.json(staff);
  } catch (error) {
    console.error('Gagal mengambil daftar petugas:', error.message);
    res.status(500).json({ message: 'Gagal mengambil daftar petugas' });
  }
});

router.post('/staff', requireRole('admin'), async (req, res) => {
  const payload = req.body || {};
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : '';
  const password = payload.password;
  const position = typeof payload.position === 'string' ? payload.position.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!name || name.length > 120 || !/^[a-z0-9._-]{3,40}$/.test(username)) {
    return res.status(400).json({ message: 'Nama atau username petugas tidak valid' });
  }
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ message: 'Password awal minimal 12 karakter dan maksimal 72 byte' });
  }
  if (position.length > 120 || phone.length > 30 || email.length > 150
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ message: 'Email, telepon, atau jabatan tidak valid' });
  }

  let createdId;
  try {
    const duplicate = await get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [username]);
    if (duplicate) return res.status(409).json({ message: 'Username sudah digunakan' });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await run(
      `INSERT INTO users (name, username, password_hash, role, email, phone, position)
       VALUES (?, ?, ?, 'pembinaan', ?, ?, ?)`,
      [name, username, passwordHash, email || null, phone || null, position || null]
    );
    createdId = result.lastID;
    await recordAudit(req.user.id, 'buat', 'petugas', createdId);
    res.status(201).json({ id: createdId, message: 'Akun petugas berhasil dibuat' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'Username sudah digunakan' });
    console.error('Gagal membuat akun petugas:', error.message);
    res.status(500).json({ message: createdId ? 'Akun petugas dibuat, tetapi aktivitasnya gagal dicatat' : 'Gagal membuat akun petugas' });
  }
});

router.put('/staff/:id', requireRole('admin'), async (req, res) => {
  const staffId = Number(req.params.id);
  const payload = req.body || {};
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : '';
  const position = typeof payload.position === 'string' ? payload.position.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const isActive = Number(payload.is_active);
  if (!Number.isInteger(staffId) || staffId < 1) return res.status(400).json({ message: 'ID petugas tidak valid' });
  if (!name || name.length > 120 || !/^[a-z0-9._-]{3,40}$/.test(username)
    || ![0, 1].includes(isActive)) return res.status(400).json({ message: 'Data petugas tidak valid' });
  if (position.length > 120 || phone.length > 30 || email.length > 150
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ message: 'Email, telepon, atau jabatan tidak valid' });
  }

  let updated = false;
  try {
    const staff = await get("SELECT id FROM users WHERE id = ? AND role = 'pembinaan'", [staffId]);
    if (!staff) return res.status(404).json({ message: 'Petugas tidak ditemukan' });
    const duplicate = await get('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?', [username, staffId]);
    if (duplicate) return res.status(409).json({ message: 'Username sudah digunakan' });
    await run(
      `UPDATE users SET name = ?, username = ?, email = ?, phone = ?, position = ?, is_active = ?
       WHERE id = ? AND role = 'pembinaan'`,
      [name, username, email || null, phone || null, position || null, isActive, staffId]
    );
    updated = true;
    await recordAudit(req.user.id, isActive ? 'perbarui' : 'nonaktifkan', 'petugas', staffId);
    res.json({ message: 'Data petugas berhasil diperbarui' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'Username sudah digunakan' });
    console.error('Gagal memperbarui petugas:', error.message);
    res.status(500).json({ message: updated ? 'Data petugas diperbarui, tetapi aktivitasnya gagal dicatat' : 'Gagal memperbarui data petugas' });
  }
});

router.get('/programs', requireRole('admin', 'pembinaan', 'koordinator', 'tatausaha'), async (req, res) => {
  try {
    const programs = await all(
      `SELECT p.id, p.name, p.category, p.description, p.is_active, p.created_at,
              (SELECT COUNT(*) FROM schedules s WHERE s.program_id = p.id) AS schedule_count
       FROM programs p ${req.user.role === 'admin' ? '' : 'WHERE p.is_active = 1'}
       ORDER BY p.name COLLATE NOCASE`
    );
    res.json(programs);
  } catch (error) {
    console.error('Gagal mengambil daftar program:', error.message);
    res.status(500).json({ message: 'Gagal mengambil daftar program' });
  }
});

router.post('/programs', requireRole('admin'), async (req, res) => {
  const normalized = normalizeProgram(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const program = normalized.value;
  let createdId;
  try {
    const duplicate = await get('SELECT id FROM programs WHERE name = ? COLLATE NOCASE', [program.name]);
    if (duplicate) return res.status(409).json({ message: 'Nama program sudah digunakan' });
    const result = await run(
      `INSERT INTO programs (name, category, description, is_active, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [program.name, program.category, program.description, program.is_active, req.user.id]
    );
    createdId = result.lastID;
    await recordAudit(req.user.id, 'buat', 'program', createdId);
    res.status(201).json({ id: createdId, message: 'Program berhasil dibuat' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'Nama program sudah digunakan' });
    console.error('Gagal membuat program:', error.message);
    res.status(500).json({ message: createdId ? 'Program dibuat, tetapi aktivitasnya gagal dicatat' : 'Gagal membuat program' });
  }
});

router.put('/programs/:id', requireRole('admin'), async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId) || programId < 1) return res.status(400).json({ message: 'ID program tidak valid' });
  const normalized = normalizeProgram(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const program = normalized.value;
  let updated = false;
  try {
    const duplicate = await get('SELECT id FROM programs WHERE name = ? COLLATE NOCASE AND id != ?', [program.name, programId]);
    if (duplicate) return res.status(409).json({ message: 'Nama program sudah digunakan' });
    const result = await run(
      `UPDATE programs SET name = ?, category = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [program.name, program.category, program.description, program.is_active, programId]
    );
    if (!result.changes) return res.status(404).json({ message: 'Program tidak ditemukan' });
    updated = true;
    await recordAudit(req.user.id, 'perbarui', 'program', programId);
    res.json({ message: 'Program berhasil diperbarui' });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'Nama program sudah digunakan' });
    console.error('Gagal memperbarui program:', error.message);
    res.status(500).json({ message: updated ? 'Program diperbarui, tetapi aktivitasnya gagal dicatat' : 'Gagal memperbarui program' });
  }
});

router.delete('/programs/:id', requireRole('admin'), async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId) || programId < 1) return res.status(400).json({ message: 'ID program tidak valid' });

  let deleted = false;
  try {
    const program = await get('SELECT id FROM programs WHERE id = ?', [programId]);
    if (!program) return res.status(404).json({ message: 'Program tidak ditemukan' });

    const linkedSchedules = await get('SELECT COUNT(*) AS count FROM schedules WHERE program_id = ?', [programId]);
    if (linkedSchedules.count > 0) {
      return res.status(409).json({ message: 'Program sudah digunakan pada jadwal dan tidak dapat dihapus. Nonaktifkan program melalui menu Edit untuk mempertahankan histori.' });
    }

    const result = await run(
      'DELETE FROM programs WHERE id = ? AND NOT EXISTS (SELECT 1 FROM schedules WHERE program_id = ?)',
      [programId, programId]
    );
    if (!result.changes) {
      return res.status(409).json({ message: 'Program baru saja digunakan pada jadwal dan tidak dapat dihapus.' });
    }
    deleted = true;
    await recordAudit(req.user.id, 'hapus', 'program', programId);
    res.json({ message: 'Program berhasil dihapus' });
  } catch (error) {
    console.error('Gagal menghapus program:', error.message);
    res.status(500).json({ message: deleted ? 'Program dihapus, tetapi aktivitasnya gagal dicatat' : 'Gagal menghapus program' });
  }
});

router.get('/audit', requireRole('admin'), async (req, res) => {
  try {
    const rows = await all(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at,
              u.name AS actor_name, COALESCE(u.username, a.actor_username) AS actor_username
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.id DESC LIMIT 300`
    );
    res.json(rows);
  } catch (error) {
    console.error('Gagal mengambil log aktivitas:', error.message);
    res.status(500).json({ message: 'Gagal mengambil log aktivitas' });
  }
});

router.delete('/audit', requireRole('admin'), async (req, res) => {
  let cleanupAuditId;
  try {
    const beforeCleanup = await get('SELECT COUNT(*) AS count FROM audit_logs');
    cleanupAuditId = await recordAudit(
      req.user.id,
      'hapus riwayat',
      'audit_logs',
      null,
      { entries_before_cleanup: beforeCleanup.count }
    );
    const result = await run('DELETE FROM audit_logs WHERE id < ?', [cleanupAuditId]);
    res.json({ deletedCount: result.changes, message: 'Riwayat aktivitas berhasil dibersihkan' });
  } catch (error) {
    console.error('Gagal membersihkan riwayat aktivitas:', error.message);
    res.status(500).json({
      message: cleanupAuditId
        ? 'Permintaan pembersihan tercatat, tetapi riwayat aktivitas gagal dibersihkan'
        : 'Gagal membersihkan riwayat aktivitas',
    });
  }
});

module.exports = router;
