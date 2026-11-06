const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve(this);
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

async function ensureWbpColumns() {
  const existingColumns = new Set((await all('PRAGMA table_info(wbp)')).map((column) => column.name));
  const profileColumns = {
    tanggal_keluar: 'TEXT',
    tempat_lahir: 'TEXT',
    tanggal_lahir: 'TEXT',
    jenis_kelamin: 'TEXT',
    kewarganegaraan: 'TEXT',
    pendidikan_terakhir: 'TEXT',
    pekerjaan_sebelumnya: 'TEXT',
    kota_asal: 'TEXT',
  };

  for (const [name, type] of Object.entries(profileColumns)) {
    if (!existingColumns.has(name)) {
      await run(`ALTER TABLE wbp ADD COLUMN ${name} ${type}`);
    }
  }
}

async function ensureUserProfileColumns() {
  const existingColumns = new Set((await all('PRAGMA table_info(users)')).map((column) => column.name));
  const profileColumns = {
    email: 'TEXT',
    phone: 'TEXT',
    position: 'TEXT',
    is_active: 'INTEGER NOT NULL DEFAULT 1',
    profile_image: 'TEXT',
  };

  for (const [name, type] of Object.entries(profileColumns)) {
    if (!existingColumns.has(name)) {
      await run(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
  }
}

async function ensureScheduleColumns() {
  const existingColumns = new Set((await all('PRAGMA table_info(schedules)')).map((column) => column.name));
  const columns = {
    program_id: 'INTEGER',
    assigned_to: 'INTEGER',
    execution_status: "TEXT NOT NULL DEFAULT 'Belum dicatat'",
    execution_notes: 'TEXT',
    executed_by: 'INTEGER',
    executed_at: 'TEXT',
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existingColumns.has(name)) await run(`ALTER TABLE schedules ADD COLUMN ${name} ${type}`);
  }
}

async function ensureProgressColumns() {
  const existingColumns = new Set((await all('PRAGMA table_info(progress_evaluations)')).map((column) => column.name));
  const columns = {
    schedule_id: 'INTEGER',
    submission_status: "TEXT NOT NULL DEFAULT 'Disetujui'",
    review_note: 'TEXT',
    reviewed_by: 'INTEGER',
    reviewed_at: 'TEXT',
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existingColumns.has(name)) await run(`ALTER TABLE progress_evaluations ADD COLUMN ${name} ${type}`);
  }
}

async function ensureProgramColumns() {
  const existingColumns = new Set((await all('PRAGMA table_info(programs)')).map((column) => column.name));
  const columns = {
    category: 'TEXT',
    description: 'TEXT',
    is_active: 'INTEGER NOT NULL DEFAULT 1',
    created_by: 'INTEGER',
    created_at: 'TEXT',
    updated_at: 'TEXT',
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existingColumns.has(name)) await run(`ALTER TABLE programs ADD COLUMN ${name} ${type}`);
  }
}

async function ensureAuditColumns() {
  const existingColumns = new Set((await all('PRAGMA table_info(audit_logs)')).map((column) => column.name));
  if (!existingColumns.has('actor_username')) {
    await run("ALTER TABLE audit_logs ADD COLUMN actor_username TEXT NOT NULL DEFAULT ''");
  }
}

async function initDb() {
  await run('PRAGMA foreign_keys = ON');

  await run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'pembinaan', 'koordinator', 'tatausaha')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await ensureUserProfileColumns();

  await run(`
    CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      category TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await ensureProgramColumns();

  await run(`
    CREATE TABLE IF NOT EXISTS wbp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      nomor_register TEXT NOT NULL UNIQUE,
      blok TEXT,
      program TEXT,
      status TEXT,
      tanggal_masuk TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT,
      schedule_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      location TEXT,
      facilitator TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'Terjadwal' CHECK(status IN ('Terjadwal', 'Selesai', 'Dibatalkan')),
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await ensureScheduleColumns();
  await run('CREATE INDEX IF NOT EXISTS idx_schedules_date_time ON schedules(schedule_date, start_time)');
  await run('CREATE INDEX IF NOT EXISTS idx_schedules_assigned_date ON schedules(assigned_to, schedule_date)');

  await run(`
    CREATE TABLE IF NOT EXISTS progress_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wbp_id INTEGER NOT NULL,
      program TEXT NOT NULL,
      evaluation_date TEXT NOT NULL,
      attendance TEXT NOT NULL CHECK(attendance IN ('Hadir', 'Izin', 'Tidak Hadir')),
      progress_status TEXT NOT NULL CHECK(progress_status IN ('Berkembang', 'Sesuai Rencana', 'Perlu Pendampingan', 'Selesai')),
      evaluation_notes TEXT NOT NULL,
      follow_up TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (wbp_id) REFERENCES wbp(id) ON DELETE RESTRICT
    )
  `);
  await ensureProgressColumns();
  await run('CREATE INDEX IF NOT EXISTS idx_progress_evaluation_date ON progress_evaluations(evaluation_date)');
  await run('CREATE INDEX IF NOT EXISTS idx_progress_wbp_date ON progress_evaluations(wbp_id, evaluation_date)');
  await run('CREATE INDEX IF NOT EXISTS idx_progress_owner_status ON progress_evaluations(created_by, submission_status)');

  await run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await ensureAuditColumns();
  await run('CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC)');

  await run(`
    CREATE TABLE IF NOT EXISTS institution_profile (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      nama TEXT NOT NULL,
      jenis TEXT,
      alamat TEXT,
      telepon TEXT,
      email TEXT,
      website TEXT,
      visi TEXT,
      misi TEXT,
      updated_by INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureWbpColumns();

  const adminPasswordHash = bcrypt.hashSync('admin123', 10);
  await run(
    `INSERT OR IGNORE INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)`,
    ['Admin Utama', 'admin', adminPasswordHash, 'admin']
  );

  await run(`
    INSERT OR IGNORE INTO wbp (nama, nomor_register, blok, program, status, tanggal_masuk)
    VALUES
      ('Budi Santoso', 'WBP-001', 'Blok A', 'Keterampilan', 'Aktif', '2026-10-01'),
      ('Agus Wijaya', 'WBP-002', 'Blok B', 'Agama', 'Aktif', '2026-10-05'),
      ('Dedi Pratama', 'WBP-003', 'Blok C', 'Kesehatan', 'Monitoring', '2026-10-10')
  `);

  for (const [name, category] of [['Keterampilan', 'Keterampilan'], ['Agama', 'Keagamaan'], ['Kesehatan', 'Kesehatan']]) {
    await run('INSERT OR IGNORE INTO programs (name, category) VALUES (?, ?)', [name, category]);
  }
}

module.exports = { db, initDb };
