const express = require('express');
const { db } = require('../db/initDb');
const { requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();
const readRoles = ['admin', 'pembinaan', 'koordinator', 'tatausaha'];
const writeRoles = ['admin', 'pembinaan'];
const fieldLimits = {
  jenis: 120,
  alamat: 500,
  telepon: 60,
  email: 150,
  website: 200,
  visi: 2000,
  misi: 2000,
};

function normalizeProfile(payload) {
  const nama = typeof payload.nama === 'string' ? payload.nama.trim() : '';
  if (!nama || nama.length > 150) return { error: 'Nama lembaga wajib diisi (maksimal 150 karakter)' };

  const values = { nama };
  for (const [field, maxLength] of Object.entries(fieldLimits)) {
    const value = payload[field];
    if (value != null && typeof value !== 'string') return { error: `Format ${field} tidak valid` };
    values[field] = typeof value === 'string' ? value.trim() : '';
    if (values[field].length > maxLength) return { error: `Panjang ${field} melebihi batas` };
  }

  return { value: values };
}

const selectProfile = `SELECT nama, jenis, alamat, telepon, email, website, visi, misi, updated_at
  FROM institution_profile WHERE id = 1`;

router.get('/', requireRole(...readRoles), (req, res) => {
  db.get(selectProfile, [], (error, profile) => {
    if (error) return res.status(500).json({ message: 'Gagal mengambil profil lembaga' });
    res.json(profile || null);
  });
});

router.post('/', requireRole(...writeRoles), (req, res) => {
  const normalized = normalizeProfile(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const profile = normalized.value;

  db.run(
    `INSERT INTO institution_profile (
      id, nama, jenis, alamat, telepon, email, website, visi, misi, updated_by
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      profile.nama,
      profile.jenis,
      profile.alamat,
      profile.telepon,
      profile.email,
      profile.website,
      profile.visi,
      profile.misi,
      req.user.id,
    ],
    (error) => {
      if (error?.code?.startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ message: 'Profil lembaga sudah tersedia; gunakan fitur edit' });
      }
      if (error) return res.status(500).json({ message: 'Gagal menambahkan profil lembaga' });
      recordAudit(req.user.id, 'buat', 'profil lembaga')
        .then(() => res.status(201).json({ message: 'Profil lembaga berhasil ditambahkan' }))
        .catch((auditError) => {
          console.error('Profil lembaga tersimpan, tetapi log aktivitas gagal:', auditError.message);
          res.status(500).json({ message: 'Profil lembaga tersimpan, tetapi aktivitasnya gagal dicatat' });
        });
    }
  );
});

router.put('/', requireRole(...writeRoles), (req, res) => {
  const normalized = normalizeProfile(req.body || {});
  if (normalized.error) return res.status(400).json({ message: normalized.error });
  const profile = normalized.value;

  db.run(
    `UPDATE institution_profile SET
      nama = ?, jenis = ?, alamat = ?, telepon = ?, email = ?, website = ?,
      visi = ?, misi = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [
      profile.nama,
      profile.jenis,
      profile.alamat,
      profile.telepon,
      profile.email,
      profile.website,
      profile.visi,
      profile.misi,
      req.user.id,
    ],
    function (error) {
      if (error) return res.status(500).json({ message: 'Gagal memperbarui profil lembaga' });
      if (this.changes === 0) return res.status(404).json({ message: 'Profil lembaga belum dibuat' });
      recordAudit(req.user.id, 'perbarui', 'profil lembaga')
        .then(() => res.json({ message: 'Profil lembaga berhasil diperbarui' }))
        .catch((auditError) => {
          console.error('Profil lembaga diperbarui, tetapi log aktivitas gagal:', auditError.message);
          res.status(500).json({ message: 'Profil lembaga diperbarui, tetapi aktivitasnya gagal dicatat' });
        });
    }
  );
});

module.exports = router;