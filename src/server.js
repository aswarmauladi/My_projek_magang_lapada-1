const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

const { db, initDb } = require('./db/initDb');
const authRoutes = require('./routes/auth');
const wbpRoutes = require('./routes/wbp');
const assistantRoutes = require('./routes/assistant');
const scheduleRoutes = require('./routes/schedules');
const progressRoutes = require('./routes/progress');
const institutionRoutes = require('./routes/institution');
const adminRoutes = require('./routes/admin');
const loginBackgroundRoutes = require('./routes/loginBackground');
const { authenticateToken, requireRole } = require('./middleware/auth');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5001;

app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Halaman utama
app.get('/', (req, res) => {
  res.json({
    message: 'Lapas WBP Assistant API is running'
  });
});

// Pemeriksaan status server
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Rute autentikasi dan data WBP
app.use('/api/auth', authRoutes);
app.use('/api/login-background', loginBackgroundRoutes);
app.use('/api/wbp', authenticateToken, wbpRoutes);
app.use('/api/assistant', authenticateToken, assistantRoutes);
app.use('/api/schedules', authenticateToken, scheduleRoutes);
app.use('/api/progress', authenticateToken, progressRoutes);
app.use('/api/institution', authenticateToken, institutionRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// Dashboard
app.get(
  '/api/dashboard',
  authenticateToken,
  requireRole('admin', 'pembinaan', 'koordinator'),
  async (req, res) => {
    const getCount = (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (error, row) => {
        if (error) reject(error);
        else resolve(row.count);
      });
    });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    try {
      const summary = {
        totalWbp: await getCount('SELECT COUNT(*) AS count FROM wbp'),
        totalProgram: await getCount('SELECT COUNT(*) AS count FROM programs WHERE is_active = 1'),
        kegiatanHariIni: await getCount('SELECT COUNT(*) AS count FROM schedules WHERE schedule_date = ?', [today]),
        progressRataRata: null,
      };
      if (req.user.role === 'admin') {
        summary.activeStaff = await getCount("SELECT COUNT(*) AS count FROM users WHERE role = 'pembinaan' AND is_active = 1");
        summary.pendingReports = await getCount("SELECT COUNT(*) AS count FROM progress_evaluations WHERE submission_status = 'Menunggu pemeriksaan'");
      } else if (req.user.role === 'pembinaan') {
        summary.assignedSchedules = await getCount('SELECT COUNT(*) AS count FROM schedules WHERE schedule_date = ? AND assigned_to = ?', [today, req.user.id]);
        summary.myPendingReports = await getCount("SELECT COUNT(*) AS count FROM progress_evaluations WHERE created_by = ? AND submission_status = 'Menunggu pemeriksaan'", [req.user.id]);
        summary.myRevisionReports = await getCount("SELECT COUNT(*) AS count FROM progress_evaluations WHERE created_by = ? AND submission_status = 'Perlu revisi'", [req.user.id]);
      }
      res.json({ user: req.user, summary });
    } catch (error) {
      console.error('Gagal mengambil dashboard:', error.message);
      res.status(500).json({ message: 'Gagal mengambil ringkasan dashboard' });
    }
  }
);

// Menjalankan server
async function startServer() {
  try {
    await initDb();

    const server = app.listen(PORT, () => {
      console.log(`Server berjalan di http://localhost:${PORT}`);
      console.log(`Pemeriksaan server: http://localhost:${PORT}/api/health`);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} sedang digunakan.`);
        console.error('Hentikan server lain atau pilih port yang berbeda.');
      } else {
        console.error('Kesalahan server:', error);
      }

      process.exitCode = 1;
    });
  } catch (error) {
    console.error('Gagal memulai server:', error);
    process.exitCode = 1;
  }
}

startServer();