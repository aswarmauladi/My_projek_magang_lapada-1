const express = require('express');
const { db } = require('../db/initDb');
const { requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();
const summaryRoles = ['admin', 'pembinaan', 'koordinator', 'tatausaha'];
const detailRoles = ['admin', 'pembinaan'];
const attendanceValues = ['Hadir', 'Izin', 'Tidak Hadir'];
const progressValues = ['Berkembang', 'Sesuai Rencana', 'Perlu Pendampingan', 'Selesai'];

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function normalizeEvaluation(payload, existing = {}) {
  const values = { ...existing, ...payload };
  const wbpId = Number(values.wbp_id);
  const program = typeof values.program === 'string' ? values.program.trim() : '';
  const evaluationDate = values.evaluation_date;
  const attendance = values.attendance;
  const progressStatus = values.progress_status;
  const evaluationNotes = typeof values.evaluation_notes === 'string' ? values.evaluation_notes.trim() : '';
  const followUp = typeof values.follow_up === 'string' ? values.follow_up.trim() : '';
  const scheduleId = values.schedule_id ? Number(values.schedule_id) : null;

  if (!Number.isInteger(wbpId) || wbpId < 1) return { error: 'WBP wajib dipilih' };
  if (!program || program.length > 120) return { error: 'Nama program wajib diisi (maksimal 120 karakter)' };
  if (!isValidDate(evaluationDate)) return { error: 'Tanggal evaluasi tidak valid' };
  if (!attendanceValues.includes(attendance)) return { error: 'Kehadiran tidak valid' };
  if (!progressValues.includes(progressStatus)) return { error: 'Status perkembangan tidak valid' };
  if (!evaluationNotes || evaluationNotes.length > 2000) return { error: 'Catatan evaluasi wajib diisi (maksimal 2.000 karakter)' };
  if (followUp.length > 2000) return { error: 'Tindak lanjut maksimal 2.000 karakter' };
  if (scheduleId !== null && (!Number.isInteger(scheduleId) || scheduleId < 1)) return { error: 'Jadwal tugas tidak valid' };

  return {
    value: {
      wbp_id: wbpId,
      program,
      evaluation_date: evaluationDate,
      attendance,
      progress_status: progressStatus,
      evaluation_notes: evaluationNotes,
      follow_up: followUp || null,
      schedule_id: scheduleId,
    },
  };
}

router.get('/summary', requireRole(...summaryRoles), async (req, res) => {
  try {
    const total = await get('SELECT COUNT(*) AS count FROM progress_evaluations');
    const attendance = await all('SELECT attendance, COUNT(*) AS count FROM progress_evaluations GROUP BY attendance');
    const progress = await all('SELECT progress_status, COUNT(*) AS count FROM progress_evaluations GROUP BY progress_status');
    const submissions = await all('SELECT submission_status, COUNT(*) AS count FROM progress_evaluations GROUP BY submission_status');
    res.json({
      totalEvaluations: total.count,
      attendance: Object.fromEntries(attendance.map((row) => [row.attendance, row.count])),
      progress: Object.fromEntries(progress.map((row) => [row.progress_status, row.count])),
      submissions: Object.fromEntries(submissions.map((row) => [row.submission_status, row.count])),
    });
  } catch (error) {
    console.error('Gagal mengambil ringkasan progress:', error.message);
    res.status(500).json({ message: 'Gagal mengambil ringkasan progress pembinaan' });
  }
});

router.get('/', requireRole(...detailRoles), async (req, res) => {
  const { from, to, status } = req.query;
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    return res.status(400).json({ message: 'Format tanggal filter harus YYYY-MM-DD' });
  }
  if (status && !progressValues.includes(status)) {
    return res.status(400).json({ message: 'Status perkembangan tidak valid' });
  }

  const conditions = [];
  const params = [];
  if (req.user.role === 'pembinaan') {
    conditions.push('e.created_by = ?');
    params.push(req.user.id);
  }
  if (from) {
    conditions.push('e.evaluation_date >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('e.evaluation_date <= ?');
    params.push(to);
  }
  if (status) {
    conditions.push('e.progress_status = ?');
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  db.all(
    `SELECT e.id, e.wbp_id, w.nama, w.nomor_register, e.program, e.evaluation_date,
            e.attendance, e.progress_status, e.evaluation_notes, e.follow_up, e.schedule_id,
            e.submission_status, e.review_note, e.created_by, e.created_at, e.reviewed_at,
            s.title AS schedule_title, u.name AS reporter_name, reviewer.name AS reviewer_name
     FROM progress_evaluations e
     JOIN wbp w ON w.id = e.wbp_id
     LEFT JOIN schedules s ON s.id = e.schedule_id
     LEFT JOIN users u ON u.id = e.created_by
     LEFT JOIN users reviewer ON reviewer.id = e.reviewed_by
     ${where}
     ORDER BY e.evaluation_date DESC, e.id DESC
     LIMIT 250`,
    params,
    (error, rows) => {
      if (error) return res.status(500).json({ message: 'Gagal mengambil catatan evaluasi' });
      res.json(rows);
    }
  );
});

router.get('/:id', requireRole(...detailRoles), (req, res) => {
  const ownerFilter = req.user.role === 'pembinaan' ? ' AND e.created_by = ?' : '';
  const params = req.user.role === 'pembinaan' ? [req.params.id, req.user.id] : [req.params.id];
  db.get(
    `SELECT e.id, e.wbp_id, w.nama, w.nomor_register, e.program, e.evaluation_date,
            e.attendance, e.progress_status, e.evaluation_notes, e.follow_up, e.schedule_id,
            e.submission_status, e.review_note, e.created_by
     FROM progress_evaluations e
     JOIN wbp w ON w.id = e.wbp_id
     WHERE e.id = ?${ownerFilter}`,
    params,
    (error, row) => {
      if (error) return res.status(500).json({ message: 'Gagal mengambil detail evaluasi' });
      if (!row) return res.status(404).json({ message: 'Catatan evaluasi tidak ditemukan' });
      res.json(row);
    }
  );
});

router.post('/:id/review', requireRole('admin'), async (req, res) => {
  const status = req.body?.submission_status;
  const note = typeof req.body?.review_note === 'string' ? req.body.review_note.trim() : '';
  if (!['Disetujui', 'Perlu revisi'].includes(status) || note.length > 1000
    || (status === 'Perlu revisi' && !note)) {
    return res.status(400).json({ message: 'Status pemeriksaan tidak valid atau catatan revisi belum diisi' });
  }
  let reviewed = false;
  try {
    const result = await new Promise((resolve, reject) => {
      db.run(
        `UPDATE progress_evaluations SET submission_status = ?, review_note = ?, reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND submission_status = 'Menunggu pemeriksaan'`,
        [status, note || null, req.user.id, req.params.id],
        function (error) {
          if (error) reject(error);
          else resolve(this);
        }
      );
    });
    if (!result.changes) return res.status(404).json({ message: 'Laporan belum ada atau sudah diperiksa' });
    reviewed = true;
    await recordAudit(req.user.id, status === 'Disetujui' ? 'setujui laporan' : 'minta revisi laporan', 'laporan progres', req.params.id);
    res.json({ message: status === 'Disetujui' ? 'Laporan berhasil disetujui' : 'Laporan dikembalikan untuk revisi' });
  } catch (error) {
    console.error('Gagal memeriksa laporan:', error.message);
    res.status(500).json({ message: reviewed ? 'Status laporan diperbarui, tetapi aktivitasnya gagal dicatat' : 'Gagal memeriksa laporan' });
  }
});

router.post('/', requireRole(...detailRoles), async (req, res) => {
  const normalized = normalizeEvaluation(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const evaluation = normalized.value;
  let assignedProgram = null;
  if (req.user.role === 'pembinaan') {
    if (!evaluation.schedule_id) return res.status(400).json({ message: 'Pilih jadwal tugas sebelum membuat laporan' });
    try {
      const assignment = await get(
        `SELECT s.id, COALESCE(p.name, s.category) AS program_name
         FROM schedules s LEFT JOIN programs p ON p.id = s.program_id
         WHERE s.id = ? AND s.assigned_to = ?`,
        [evaluation.schedule_id, req.user.id]
      );
      if (!assignment) return res.status(403).json({ message: 'Jadwal tersebut bukan penugasan Anda' });
      assignedProgram = assignment.program_name;
    } catch (error) {
      console.error('Gagal memeriksa penugasan laporan:', error.message);
      return res.status(500).json({ message: 'Gagal memeriksa penugasan laporan' });
    }
  }
  if (assignedProgram) evaluation.program = assignedProgram;
  const submissionStatus = req.user.role === 'admin' ? 'Disetujui' : 'Menunggu pemeriksaan';

  db.run(
    `INSERT INTO progress_evaluations (
      wbp_id, program, evaluation_date, attendance, progress_status,
      evaluation_notes, follow_up, created_by, schedule_id, submission_status, reviewed_by, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evaluation.wbp_id,
      evaluation.program,
      evaluation.evaluation_date,
      evaluation.attendance,
      evaluation.progress_status,
      evaluation.evaluation_notes,
      evaluation.follow_up,
      req.user.id,
      evaluation.schedule_id,
      submissionStatus,
      req.user.role === 'admin' ? req.user.id : null,
      req.user.role === 'admin' ? new Date().toISOString() : null,
    ],
    function (error) {
      if (error) {
        const statusCode = error.code?.startsWith('SQLITE_CONSTRAINT') ? 400 : 500;
        return res.status(statusCode).json({ message: statusCode === 400 ? 'WBP yang dipilih tidak ditemukan' : 'Gagal menyimpan evaluasi' });
      }
      const reportId = this.lastID;
      recordAudit(req.user.id, 'buat laporan', 'laporan progres', reportId)
        .then(() => res.status(201).json({ id: reportId, message: 'Laporan berhasil dikirim untuk diperiksa' }))
        .catch((auditError) => {
          console.error('Laporan tersimpan, tetapi log aktivitas gagal:', auditError.message);
          res.status(500).json({ message: 'Laporan tersimpan, tetapi aktivitasnya gagal dicatat' });
        });
    }
  );
});

router.put('/:id', requireRole(...detailRoles), async (req, res) => {
  let existing;
  try {
    existing = await get(
      `SELECT id, created_by, submission_status, schedule_id, review_note, reviewed_by, reviewed_at
       FROM progress_evaluations WHERE id = ?`,
      [req.params.id]
    );
  } catch (error) {
    console.error('Gagal memeriksa laporan sebelum diperbarui:', error.message);
    return res.status(500).json({ message: 'Gagal memeriksa laporan' });
  }
  if (!existing) return res.status(404).json({ message: 'Catatan evaluasi tidak ditemukan' });
  if (req.user.role === 'pembinaan'
    && (existing.created_by !== req.user.id || !['Menunggu pemeriksaan', 'Perlu revisi'].includes(existing.submission_status))) {
    return res.status(403).json({ message: 'Laporan ini tidak dapat diubah oleh akun Anda' });
  }
  const normalized = normalizeEvaluation(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const evaluation = normalized.value;
  if (req.user.role === 'admin' && !evaluation.schedule_id) evaluation.schedule_id = existing.schedule_id;
  if (req.user.role === 'pembinaan') {
    if (!evaluation.schedule_id) return res.status(400).json({ message: 'Pilih jadwal tugas sebelum memperbarui laporan' });
    try {
      const assignment = await get('SELECT id FROM schedules WHERE id = ? AND assigned_to = ?', [evaluation.schedule_id, req.user.id]);
      if (!assignment) return res.status(403).json({ message: 'Jadwal tersebut bukan penugasan Anda' });
    } catch (error) {
      console.error('Gagal memeriksa penugasan laporan:', error.message);
      return res.status(500).json({ message: 'Gagal memeriksa penugasan laporan' });
    }
  }

  db.run(
    `UPDATE progress_evaluations SET
      wbp_id = ?, program = ?, evaluation_date = ?, attendance = ?,
      progress_status = ?, evaluation_notes = ?, follow_up = ?, schedule_id = ?,
      submission_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      evaluation.wbp_id,
      evaluation.program,
      evaluation.evaluation_date,
      evaluation.attendance,
      evaluation.progress_status,
      evaluation.evaluation_notes,
      evaluation.follow_up,
      evaluation.schedule_id,
      req.user.role === 'admin' ? existing.submission_status : 'Menunggu pemeriksaan',
      req.user.role === 'admin' ? existing.review_note : null,
      req.user.role === 'admin' ? existing.reviewed_by : null,
      req.user.role === 'admin' ? existing.reviewed_at : null,
      req.params.id,
    ],
    function (error) {
      if (error) {
        const statusCode = error.code?.startsWith('SQLITE_CONSTRAINT') ? 400 : 500;
        return res.status(statusCode).json({ message: statusCode === 400 ? 'Data WBP tidak valid' : 'Gagal memperbarui evaluasi' });
      }
      if (this.changes === 0) return res.status(404).json({ message: 'Catatan evaluasi tidak ditemukan' });
      recordAudit(req.user.id, 'perbarui laporan', 'laporan progres', req.params.id)
        .then(() => res.json({ id: Number(req.params.id), message: 'Laporan berhasil diperbarui dan dikirim untuk diperiksa' }))
        .catch((auditError) => {
          console.error('Laporan diperbarui, tetapi log aktivitas gagal:', auditError.message);
          res.status(500).json({ message: 'Laporan diperbarui, tetapi aktivitasnya gagal dicatat' });
        });
    }
  );
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.run('DELETE FROM progress_evaluations WHERE id = ?', [req.params.id], function (error) {
    if (error) return res.status(500).json({ message: 'Gagal menghapus evaluasi' });
    if (this.changes === 0) return res.status(404).json({ message: 'Catatan evaluasi tidak ditemukan' });
    recordAudit(req.user.id, 'hapus laporan', 'laporan progres', req.params.id)
      .then(() => res.json({ message: 'Evaluasi berhasil dihapus' }))
      .catch((auditError) => {
        console.error('Laporan dihapus, tetapi log aktivitas gagal:', auditError.message);
        res.status(500).json({ message: 'Laporan dihapus, tetapi aktivitasnya gagal dicatat' });
      });
  });
});

module.exports = router;