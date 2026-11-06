const express = require('express');
const { db } = require('../db/initDb');
const { requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();
const scheduleRoles = ['admin', 'pembinaan', 'koordinator', 'tatausaha'];
const writeRoles = ['admin'];

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getJakartaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

function normalizeSchedule(payload, existing = {}) {
  const values = { ...existing, ...payload };
  const title = typeof values.title === 'string' ? values.title.trim() : '';
  const category = typeof values.category === 'string' ? values.category.trim() : '';
  const location = typeof values.location === 'string' ? values.location.trim() : '';
  const facilitator = typeof values.facilitator === 'string' ? values.facilitator.trim() : '';
  const notes = typeof values.notes === 'string' ? values.notes.trim() : '';
  const scheduleDate = values.schedule_date;
  const startTime = values.start_time;
  const endTime = values.end_time;
  const status = values.status || 'Terjadwal';
  const programId = values.program_id ? Number(values.program_id) : null;
  const assignedTo = values.assigned_to ? Number(values.assigned_to) : null;

  if (!title || title.length > 120) return { error: 'Nama kegiatan wajib diisi (maksimal 120 karakter)' };
  if (!isValidDate(scheduleDate)) return { error: 'Tanggal kegiatan tidak valid' };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime || '')
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime || '')
    || endTime <= startTime) {
    return { error: 'Jam kegiatan tidak valid; jam selesai harus setelah jam mulai' };
  }
  if (category.length > 60 || location.length > 120 || facilitator.length > 120 || notes.length > 500) {
    return { error: 'Salah satu keterangan kegiatan melebihi batas karakter' };
  }
  if (!['Terjadwal', 'Selesai', 'Dibatalkan'].includes(status)) {
    return { error: 'Status kegiatan tidak valid' };
  }
  if ((programId !== null && (!Number.isInteger(programId) || programId < 1))
    || (assignedTo !== null && (!Number.isInteger(assignedTo) || assignedTo < 1))) {
    return { error: 'Program atau petugas yang ditugaskan tidak valid' };
  }

  return {
    value: {
      title,
      category: category || null,
      schedule_date: scheduleDate,
      start_time: startTime,
      end_time: endTime,
      location: location || null,
      facilitator: facilitator || null,
      notes: notes || null,
      status,
      program_id: programId,
      assigned_to: assignedTo,
    },
  };
}

router.get('/', requireRole(...scheduleRoles), (req, res) => {
  const allDates = req.query.all === '1';
  if (allDates && !['admin', 'pembinaan'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Akses daftar seluruh jadwal ditolak' });
  }
  const date = req.query.date || getJakartaDate();
  if (!allDates && !isValidDate(date)) return res.status(400).json({ message: 'Format tanggal harus YYYY-MM-DD' });

  const conditions = [];
  const params = [];
  if (!allDates) {
    conditions.push('s.schedule_date = ?');
    params.push(date);
  }
  if (req.user.role === 'pembinaan') {
    conditions.push('s.assigned_to = ?');
    params.push(req.user.id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  db.all(
    `SELECT s.id, s.title, s.category, s.schedule_date, s.start_time, s.end_time, s.location,
            s.facilitator, s.notes, s.status, s.program_id, s.assigned_to,
            s.execution_status, s.execution_notes, s.executed_at,
            p.name AS program_name, u.name AS assigned_name
     FROM schedules s
     LEFT JOIN programs p ON p.id = s.program_id
     LEFT JOIN users u ON u.id = s.assigned_to
     ${where}
     ORDER BY s.start_time, s.title`,
    params,
    (error, rows) => {
      if (error) return res.status(500).json({ message: 'Gagal mengambil jadwal kegiatan' });
      res.json({ date: allDates ? null : date, schedules: rows });
    }
  );
});

router.get('/:id', requireRole(...scheduleRoles), (req, res) => {
  const accessCondition = req.user.role === 'pembinaan' ? ' AND s.assigned_to = ?' : '';
  const params = req.user.role === 'pembinaan' ? [req.params.id, req.user.id] : [req.params.id];
  db.get(
    `SELECT s.id, s.title, s.category, s.schedule_date, s.start_time, s.end_time, s.location,
            s.facilitator, s.notes, s.status, s.program_id, s.assigned_to,
            s.execution_status, s.execution_notes, s.executed_at,
            p.name AS program_name, u.name AS assigned_name
     FROM schedules s
     LEFT JOIN programs p ON p.id = s.program_id
     LEFT JOIN users u ON u.id = s.assigned_to
     WHERE s.id = ?${accessCondition}`,
    params,
    (error, row) => {
      if (error) return res.status(500).json({ message: 'Gagal mengambil detail jadwal' });
      if (!row) return res.status(404).json({ message: 'Jadwal tidak ditemukan' });
      res.json(row);
    }
  );
});

router.post('/', requireRole(...writeRoles), (req, res) => {
  const normalized = normalizeSchedule(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const schedule = normalized.value;

  Promise.all([
    schedule.program_id ? get('SELECT id FROM programs WHERE id = ? AND is_active = 1', [schedule.program_id]) : null,
    schedule.assigned_to ? get("SELECT id FROM users WHERE id = ? AND role = 'pembinaan' AND is_active = 1", [schedule.assigned_to]) : null,
  ]).then(([program, staff]) => {
    if (schedule.program_id && !program) return res.status(400).json({ message: 'Program aktif tidak ditemukan' });
    if (schedule.assigned_to && !staff) return res.status(400).json({ message: 'Petugas aktif tidak ditemukan' });
    db.run(
    `INSERT INTO schedules (
      title, category, schedule_date, start_time, end_time, location, facilitator, notes,
      status, created_by, program_id, assigned_to
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schedule.title,
      schedule.category,
      schedule.schedule_date,
      schedule.start_time,
      schedule.end_time,
      schedule.location,
      schedule.facilitator,
      schedule.notes,
      schedule.status,
      req.user.id,
      schedule.program_id,
      schedule.assigned_to,
    ],
    function (error) {
      if (error) return res.status(500).json({ message: 'Gagal menambahkan jadwal' });
      const scheduleId = this.lastID;
      recordAudit(req.user.id, 'buat', 'jadwal', scheduleId)
        .then(() => res.status(201).json({ id: scheduleId, message: 'Jadwal berhasil ditambahkan' }))
        .catch((auditError) => {
          console.error('Jadwal tersimpan, tetapi log aktivitas gagal:', auditError.message);
          res.status(500).json({ message: 'Jadwal tersimpan, tetapi aktivitasnya gagal dicatat' });
        });
    }
    );
  }).catch((error) => {
    console.error('Gagal memvalidasi jadwal:', error.message);
    res.status(500).json({ message: 'Gagal memvalidasi program dan petugas' });
  });
});

router.put('/:id', requireRole(...writeRoles), (req, res) => {
  db.get('SELECT * FROM schedules WHERE id = ?', [req.params.id], (findError, existing) => {
    if (findError) return res.status(500).json({ message: 'Gagal mengambil jadwal' });
    if (!existing) return res.status(404).json({ message: 'Jadwal tidak ditemukan' });

    const normalized = normalizeSchedule(req.body || {}, existing);
    if (normalized.error) return res.status(400).json({ message: normalized.error });
    const schedule = normalized.value;

    Promise.all([
      schedule.program_id ? get('SELECT id FROM programs WHERE id = ? AND (is_active = 1 OR id = ?)', [schedule.program_id, existing.program_id]) : null,
      schedule.assigned_to ? get("SELECT id FROM users WHERE id = ? AND role = 'pembinaan' AND (is_active = 1 OR id = ?)", [schedule.assigned_to, existing.assigned_to]) : null,
    ]).then(([program, staff]) => {
      if (schedule.program_id && !program) return res.status(400).json({ message: 'Program aktif tidak ditemukan' });
      if (schedule.assigned_to && !staff) return res.status(400).json({ message: 'Petugas aktif tidak ditemukan' });
      db.run(
      `UPDATE schedules SET
        title = ?, category = ?, schedule_date = ?, start_time = ?, end_time = ?,
        location = ?, facilitator = ?, notes = ?, status = ?, program_id = ?, assigned_to = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        schedule.title,
        schedule.category,
        schedule.schedule_date,
        schedule.start_time,
        schedule.end_time,
        schedule.location,
        schedule.facilitator,
        schedule.notes,
        schedule.status,
        schedule.program_id,
        schedule.assigned_to,
        req.params.id,
      ],
      (updateError) => {
        if (updateError) return res.status(500).json({ message: 'Gagal memperbarui jadwal' });
        recordAudit(req.user.id, 'perbarui', 'jadwal', req.params.id)
          .then(() => res.json({ id: Number(req.params.id), message: 'Jadwal berhasil diperbarui' }))
          .catch((auditError) => {
            console.error('Jadwal diperbarui, tetapi log aktivitas gagal:', auditError.message);
            res.status(500).json({ message: 'Jadwal diperbarui, tetapi aktivitasnya gagal dicatat' });
          });
      }
      );
    }).catch((error) => {
      console.error('Gagal memvalidasi jadwal:', error.message);
      res.status(500).json({ message: 'Gagal memvalidasi program dan petugas' });
    });
  });
});

router.post('/:id/execution', requireRole('pembinaan'), async (req, res) => {
  const executionStatus = req.body?.execution_status;
  const notes = typeof req.body?.execution_notes === 'string' ? req.body.execution_notes.trim() : '';
  if (!['Selesai', 'Tidak terlaksana'].includes(executionStatus) || notes.length > 1000) {
    return res.status(400).json({ message: 'Status pelaksanaan atau catatan tidak valid' });
  }
  let updated = false;
  try {
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE schedules SET execution_status = ?, execution_notes = ?, executed_by = ?,
          executed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND assigned_to = ?`,
        [executionStatus, notes || null, req.user.id, req.params.id, req.user.id],
        function (error) {
          if (error) reject(error);
          else resolve(this);
        }
      );
    });
    if (!result.changes) return res.status(404).json({ message: 'Jadwal tugas tidak ditemukan' });
    updated = true;
    await recordAudit(req.user.id, 'catat pelaksanaan', 'jadwal', req.params.id);
    res.json({ message: 'Pelaksanaan kegiatan berhasil dicatat' });
  } catch (error) {
    console.error('Gagal mencatat pelaksanaan kegiatan:', error.message);
    res.status(500).json({ message: updated ? 'Pelaksanaan tersimpan, tetapi aktivitasnya gagal dicatat' : 'Gagal mencatat pelaksanaan kegiatan' });
  }
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.run('DELETE FROM schedules WHERE id = ?', [req.params.id], function (error) {
    if (error) return res.status(500).json({ message: 'Gagal menghapus jadwal' });
    if (this.changes === 0) return res.status(404).json({ message: 'Jadwal tidak ditemukan' });
    recordAudit(req.user.id, 'hapus', 'jadwal', req.params.id)
      .then(() => res.json({ message: 'Jadwal berhasil dihapus' }))
      .catch((auditError) => {
        console.error('Jadwal dihapus, tetapi log aktivitas gagal:', auditError.message);
        res.status(500).json({ message: 'Jadwal dihapus, tetapi aktivitasnya gagal dicatat' });
      });
  });
});

module.exports = router;