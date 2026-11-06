const express = require('express');
const { db } = require('../db/initDb');
const { requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();
const textFieldLimits = {
  blok: 80,
  program: 120,
  status: 40,
  tempat_lahir: 100,
  jenis_kelamin: 30,
  kewarganegaraan: 80,
  pendidikan_terakhir: 100,
  pekerjaan_sebelumnya: 120,
  kota_asal: 100,
};

function isValidDate(value) {
  if (!value) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeWbpPayload(payload, existing = {}) {
  const values = { ...existing, ...payload };
  const nama = values.nama;
  const nomorRegister = values.nomor_register;

  if (typeof nama !== 'string' || typeof nomorRegister !== 'string') {
    return { error: 'Nama dan nomor register wajib diisi' };
  }

  const normalizedNama = nama.trim();
  const normalizedRegister = nomorRegister.trim();
  if (!normalizedNama || normalizedNama.length > 120 || !normalizedRegister || normalizedRegister.length > 40) {
    return { error: 'Nama atau nomor register tidak valid' };
  }

  const normalizedText = {};
  for (const [field, maxLength] of Object.entries(textFieldLimits)) {
    const value = values[field];
    if (value != null && typeof value !== 'string') {
      return { error: `Format ${field} tidak valid` };
    }
    normalizedText[field] = typeof value === 'string' ? value.trim() : '';
    if (normalizedText[field].length > maxLength) {
      return { error: `Panjang ${field} melebihi batas` };
    }
  }

  const tanggalMasuk = values.tanggal_masuk || new Date().toISOString().slice(0, 10);
  const tanggalKeluar = values.tanggal_keluar || null;
  const tanggalLahir = values.tanggal_lahir || null;
  if (![tanggalMasuk, tanggalKeluar, tanggalLahir].every(isValidDate)) {
    return { error: 'Format tanggal harus valid (YYYY-MM-DD)' };
  }
  if (tanggalKeluar && tanggalKeluar < tanggalMasuk) {
    return { error: 'Tanggal keluar tidak boleh sebelum tanggal masuk' };
  }

  return {
    value: {
      nama: normalizedNama,
      nomor_register: normalizedRegister,
      blok: normalizedText.blok || '-',
      program: normalizedText.program || '-',
      status: normalizedText.status || 'Aktif',
      tanggal_masuk: tanggalMasuk,
      tanggal_keluar: tanggalKeluar,
      tempat_lahir: normalizedText.tempat_lahir || null,
      tanggal_lahir: tanggalLahir,
      jenis_kelamin: normalizedText.jenis_kelamin || null,
      kewarganegaraan: normalizedText.kewarganegaraan || null,
      pendidikan_terakhir: normalizedText.pendidikan_terakhir || null,
      pekerjaan_sebelumnya: normalizedText.pekerjaan_sebelumnya || null,
      kota_asal: normalizedText.kota_asal || null,
    },
  };
}

function sendWriteError(res, error, fallbackMessage) {
  if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ message: 'Nomor register sudah digunakan' });
  }
  return res.status(500).json({ message: fallbackMessage });
}

router.get('/', requireRole('admin', 'pembinaan', 'koordinator', 'tatausaha'), (req, res) => {
  db.all(
    `SELECT id, nama, nomor_register, blok, program, status, tanggal_masuk, tanggal_keluar
     FROM wbp ORDER BY id DESC`,
    [],
    (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Gagal mengambil data WBP' });
    }

    res.json(rows);
    }
  );
});

router.get('/:id', requireRole('admin', 'pembinaan'), (req, res) => {
  db.get('SELECT * FROM wbp WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Gagal mengambil detail WBP' });
    }

    if (!row) {
      return res.status(404).json({ message: 'WBP tidak ditemukan' });
    }

    res.json(row);
  });
});

router.post('/', requireRole('admin', 'pembinaan'), (req, res) => {
  const normalized = normalizeWbpPayload(req.body);
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const person = normalized.value;

  db.run(
    `INSERT INTO wbp (
      nama, nomor_register, blok, program, status, tanggal_masuk, tanggal_keluar,
      tempat_lahir, tanggal_lahir, jenis_kelamin, kewarganegaraan,
      pendidikan_terakhir, pekerjaan_sebelumnya, kota_asal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      person.nama,
      person.nomor_register,
      person.blok,
      person.program,
      person.status,
      person.tanggal_masuk,
      person.tanggal_keluar,
      person.tempat_lahir,
      person.tanggal_lahir,
      person.jenis_kelamin,
      person.kewarganegaraan,
      person.pendidikan_terakhir,
      person.pekerjaan_sebelumnya,
      person.kota_asal,
    ],
    function (err) {
      if (err) {
        return sendWriteError(res, err, 'Gagal menambahkan WBP');
      }

      const personId = this.lastID;
      recordAudit(req.user.id, 'buat', 'data WBP', personId)
        .then(() => res.status(201).json({ id: personId, message: 'WBP berhasil ditambahkan' }))
        .catch((auditError) => {
          console.error('Data WBP tersimpan, tetapi log aktivitas gagal:', auditError.message);
          res.status(500).json({ message: 'Data WBP tersimpan, tetapi aktivitasnya gagal dicatat' });
        });
    }
  );
});

router.put('/:id', requireRole('admin', 'pembinaan'), (req, res) => {
  db.get('SELECT * FROM wbp WHERE id = ?', [req.params.id], (findError, existing) => {
    if (findError) return res.status(500).json({ message: 'Gagal mengambil data WBP' });
    if (!existing) return res.status(404).json({ message: 'WBP tidak ditemukan' });

    const normalized = normalizeWbpPayload(req.body, existing);
    if (normalized.error) return res.status(400).json({ message: normalized.error });
    const person = normalized.value;

    db.run(
      `UPDATE wbp SET
        nama = ?, nomor_register = ?, blok = ?, program = ?, status = ?,
        tanggal_masuk = ?, tanggal_keluar = ?, tempat_lahir = ?, tanggal_lahir = ?,
        jenis_kelamin = ?, kewarganegaraan = ?, pendidikan_terakhir = ?,
        pekerjaan_sebelumnya = ?, kota_asal = ?
       WHERE id = ?`,
      [
        person.nama,
        person.nomor_register,
        person.blok,
        person.program,
        person.status,
        person.tanggal_masuk,
        person.tanggal_keluar,
        person.tempat_lahir,
        person.tanggal_lahir,
        person.jenis_kelamin,
        person.kewarganegaraan,
        person.pendidikan_terakhir,
        person.pekerjaan_sebelumnya,
        person.kota_asal,
        req.params.id,
      ],
      function (updateError) {
        if (updateError) return sendWriteError(res, updateError, 'Gagal memperbarui data WBP');
        recordAudit(req.user.id, 'perbarui', 'data WBP', req.params.id)
          .then(() => res.json({ id: Number(req.params.id), message: 'Data WBP berhasil diperbarui' }))
          .catch((auditError) => {
            console.error('Data WBP diperbarui, tetapi log aktivitas gagal:', auditError.message);
            res.status(500).json({ message: 'Data WBP diperbarui, tetapi aktivitasnya gagal dicatat' });
          });
      }
    );
  });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.run('DELETE FROM wbp WHERE id = ?', [req.params.id], function (err) {
    if (err?.code?.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ message: 'WBP masih memiliki riwayat evaluasi. Riwayat harus dipertahankan sebelum data WBP dapat dihapus.' });
    }
    if (err) return res.status(500).json({ message: 'Gagal menghapus data WBP' });
    if (this.changes === 0) return res.status(404).json({ message: 'WBP tidak ditemukan' });
    recordAudit(req.user.id, 'hapus', 'data WBP', req.params.id)
      .then(() => res.json({ message: 'Data WBP berhasil dihapus' }))
      .catch((auditError) => {
        console.error('Data WBP dihapus, tetapi log aktivitas gagal:', auditError.message);
        res.status(500).json({ message: 'Data WBP dihapus, tetapi aktivitasnya gagal dicatat' });
      });
  });
});

module.exports = router;
