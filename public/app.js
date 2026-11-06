const TOKEN_KEY = 'ruang-pembinaan-token';
const USER_KEY = 'ruang-pembinaan-user';
const pageTitles = {
  dashboard: 'Dashboard',
  wbp: 'Data WBP',
  schedules: 'Jadwal kegiatan',
  progress: 'Progress pembinaan',
  program: 'Program pembinaan',
  staff: 'Manajemen petugas',
  audit: 'Aktivitas sistem',
  'login-settings': 'Tampilan login',
  assistant: 'Asisten AI',
  info: 'Informasi Lapas',
  profile: 'Profil Saya',
};

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  user: readStoredUser(),
  wbp: [],
  todaySchedules: [],
  todayScheduleError: null,
  scheduleDate: '',
  progressSummary: null,
  progressRows: [],
  programs: [],
  staff: [],
  auditRows: [],
  loginBackgroundSettings: null,
  loginBackgroundSettingsLoading: false,
  loginBackgroundSettingsError: null,
  loginBackgroundUpload: null,
  loginBackgroundRevision: 0,
  progressFilters: { from: '', to: '', status: '' },
  institutionProfile: null,
  institutionProfileLoaded: false,
  userProfile: null,
  profilePhoto: null,
  userProfileLoaded: false,
  activePage: 'dashboard',
  search: '',
  busy: false,
  assistantMessages: [],
};

const loginView = document.querySelector('#login-view');
const appView = document.querySelector('#app-view');
const pageContent = document.querySelector('#page-content');
const modalRoot = document.querySelector('#modal-root');
const toast = document.querySelector('#toast');

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function roleName(role) {
  return ({ admin: 'Administrator', pembinaan: 'Petugas Pembinaan', koordinator: 'Koordinator', tatausaha: 'Tata Usaha' })[role] || 'Petugas';
}

function hasWriteAccess() {
  return ['admin', 'pembinaan'].includes(state.user?.role);
}

function getJakartaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderScheduleItems(schedules, allowActions = false) {
  if (!schedules.length) return '<div class="schedule-empty"><div><span class="empty-symbol" aria-hidden="true">◷</span><strong>Belum ada jadwal</strong><p>Belum ada kegiatan yang tercatat untuk tanggal ini.</p></div></div>';

  return `<div class="schedule-list">${schedules.map((schedule) => `
    <article class="schedule-item">
      <div class="schedule-time"><strong>${escapeHtml(schedule.start_time)}</strong><span>${escapeHtml(schedule.end_time)}</span></div>
      <div class="schedule-item-content">
        <div class="schedule-item-title"><strong>${escapeHtml(schedule.title)}</strong><span class="schedule-state ${schedule.status === 'Selesai' ? 'is-done' : schedule.status === 'Dibatalkan' ? 'is-cancelled' : ''}">${escapeHtml(schedule.status)}</span></div>
        <p>${[schedule.program_name || schedule.category, schedule.location, schedule.assigned_name ? `Petugas: ${schedule.assigned_name}` : (schedule.facilitator ? `Petugas: ${schedule.facilitator}` : '')].filter(Boolean).map(escapeHtml).join(' · ') || 'Keterangan belum diisi'}</p>
        ${schedule.notes ? `<small>${escapeHtml(schedule.notes)}</small>` : ''}
        ${state.user?.role === 'pembinaan' ? `<small>Pelaksanaan: ${escapeHtml(schedule.execution_status || 'Belum dicatat')}${schedule.execution_notes ? ` · ${escapeHtml(schedule.execution_notes)}` : ''}</small>` : ''}
      </div>
      ${allowActions && state.user?.role === 'admin' ? `<div class="schedule-actions"><button class="profile-button" type="button" data-edit-schedule="${Number(schedule.id)}">Edit</button><button class="danger-button" type="button" data-delete-schedule="${Number(schedule.id)}">Hapus</button></div>` : ''}
      ${allowActions && state.user?.role === 'pembinaan' ? `<div class="schedule-actions"><button class="profile-button" type="button" data-execution-schedule="${Number(schedule.id)}">Catat pelaksanaan</button></div>` : ''}
    </article>`).join('')}</div>`;
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  state.token = null;
  state.user = null;
  state.wbp = [];
  state.assistantMessages = [];
  state.progressSummary = null;
  state.progressRows = [];
  state.programs = [];
  state.staff = [];
  state.auditRows = [];
  state.institutionProfile = null;
  state.institutionProfileLoaded = false;
  state.userProfile = null;
  state.profilePhoto = null;
  state.userProfileLoaded = false;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, { ...options, headers });
  const result = await response.json().catch(() => ({}));

  if (response.status === 401 || response.status === 403) {
    if (response.status === 401) {
      clearSession();
      showLogin();
    }
    throw new Error(result.message || 'Akses tidak diizinkan.');
  }
  if (!response.ok) throw new Error(result.message || 'Permintaan gagal diproses.');
  return result;
}

function showLogin() {
  appView.hidden = true;
  loginView.hidden = false;
  document.querySelector('#username').focus();
}

async function loadPublicLoginBackground() {
  const revision = state.loginBackgroundRevision;
  try {
    const response = await fetch('/api/login-background/status', { cache: 'no-store' });
    const settings = await response.json();
    if (!response.ok) throw new Error(settings.message || 'Status gambar latar login gagal dimuat.');
    if (revision !== state.loginBackgroundRevision) return;
    const image = settings.configured
      ? `url("/api/login-background/image?v=${encodeURIComponent(settings.updated_at || Date.now())}")`
      : 'none';
    loginView.style.setProperty('--login-background-image', image);
  } catch (error) {
    if (revision !== state.loginBackgroundRevision) return;
    console.error('Gagal memuat gambar latar login:', error.message);
    loginView.style.setProperty('--login-background-image', 'none');
  }
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  appView.dataset.role = state.user?.role || '';
  document.querySelectorAll('.workspace-label')[0].textContent = state.user?.role === 'admin' ? 'PENGELOLAAN' : 'PEMBINAAN';
  document.querySelectorAll('.nav-link[data-roles]').forEach((button) => {
    button.hidden = !button.dataset.roles.split(',').includes(state.user?.role || '');
  });
  document.querySelector('#account-login-settings-button').hidden = state.user?.role !== 'admin';
  document.querySelector('#user-name').textContent = state.user?.name || 'Petugas';
  document.querySelector('#user-role').textContent = roleName(state.user?.role);
  document.querySelector('#account-menu-name').textContent = state.user?.name || 'Petugas';
  document.querySelector('#account-menu-role').textContent = roleName(state.user?.role);
  renderProfileAvatars();
  loadWbp();
  loadTodaySchedules();
  loadProgressSummary();
  loadPrograms();
  if (state.user?.role === 'admin') {
    loadStaff();
    loadProgressRows();
  } else if (state.user?.role === 'pembinaan') {
    loadProgressRows();
  }
  loadInstitutionProfile();
  loadUserProfile();
}

function renderAvatar(element, photo, name) {
  if (!element) return;
  if (photo) {
    element.innerHTML = `<img src="${escapeHtml(photo)}" alt="Foto profil ${escapeHtml(name || 'pengguna')}" />`;
    element.classList.add('has-photo');
  } else {
    element.textContent = (name || 'P').trim().charAt(0).toUpperCase();
    element.classList.remove('has-photo');
  }
}

function renderProfileAvatars() {
  const name = state.userProfile?.name || state.user?.name || 'Petugas';
  renderAvatar(document.querySelector('#user-avatar'), state.profilePhoto, name);
  renderAvatar(document.querySelector('#account-menu-avatar'), state.profilePhoto, name);
  renderAvatar(document.querySelector('#profile-page-avatar'), state.profilePhoto, name);
  document.querySelector('#user-name').textContent = name;
  document.querySelector('#account-menu-name').textContent = name;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function filteredWbp() {
  const query = state.search.trim().toLocaleLowerCase('id');
  if (!query) return state.wbp;
  return state.wbp.filter((person) => [person.nama, person.nomor_register, person.blok, person.program, person.status, person.tanggal_keluar]
    .some((value) => String(value || '').toLocaleLowerCase('id').includes(query)));
}

function statusMarkup(status) {
  const monitoring = String(status || '').toLocaleLowerCase('id').includes('monitor');
  return `<span class="status-pill${monitoring ? ' is-monitoring' : ''}">${escapeHtml(status || 'Belum diisi')}</span>`;
}

function renderWbpRows(people, limit = Infinity, includeActions = false) {
  const visible = people.slice(0, limit);
  if (!visible.length) return `<tr><td class="empty-row" colspan="${includeActions ? 8 : 7}">Belum ada data yang cocok.</td></tr>`;
  return visible.map((person) => `
    <tr>
      <td><div class="person-cell"><strong>${escapeHtml(person.nama)}</strong><small>${escapeHtml(person.nomor_register)}</small></div></td>
      <td>${escapeHtml(person.blok || '-')}</td>
      <td>${escapeHtml(person.program || '-')}</td>
      <td>${statusMarkup(person.status)}</td>
      <td>${escapeHtml(person.tanggal_masuk || '-')}</td>
      <td>${escapeHtml(person.tanggal_keluar || '-')}</td>
      <td>${hasWriteAccess() ? `<button class="profile-button" type="button" data-profile-id="${Number(person.id)}">Lihat profil</button>` : '<span class="stat-caption">Terbatas</span>'}</td>
      ${includeActions ? `<td><div class="row-actions"><button class="profile-button" type="button" data-edit-id="${Number(person.id)}">Edit</button>${state.user?.role === 'admin' ? `<button class="danger-button" type="button" data-delete-id="${Number(person.id)}">Hapus</button>` : ''}</div></td>` : ''}
    </tr>`).join('');
}

function renderRecentTable(people) {
  return `
    <section class="panel table-panel">
      <div class="panel-heading">
        <div><h2>Data WBP terbaru</h2><p>Data yang tersedia pada akun Anda</p></div>
        <button class="text-button" data-page-link="wbp" type="button">Lihat semua <span aria-hidden="true">→</span></button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>Nama / nomor register</th><th>Blok</th><th>Program</th><th>Status</th><th>Tanggal masuk</th><th>Tanggal keluar</th><th>Profil</th></tr></thead>
        <tbody>${renderWbpRows(people, 5)}</tbody>
      </table></div>
      <div class="table-footer"><span>Menampilkan ${Math.min(people.length, 5)} dari ${people.length} data</span><span>Informasi terbatas sesuai hak akses</span></div>
    </section>`;
}

function renderDashboardActions(isAdmin) {
  const actions = isAdmin
    ? [
      { icon: '♙', title: 'Manajemen petugas', description: 'Kelola akun dan akses', page: 'staff' },
      { icon: '◷', title: 'Program pembinaan', description: 'Kelola program aktif', page: 'program' },
      { icon: '↗', title: 'Periksa laporan', description: 'Tinjau progres petugas', page: 'progress' },
    ]
    : [
      { icon: '▦', title: 'Penugasan kegiatan', description: 'Lihat jadwal yang ditetapkan', page: 'schedules' },
      { icon: '↗', title: 'Buat laporan', description: 'Kirim progres untuk diperiksa', page: 'progress', action: 'open-progress' },
      { icon: '◷', title: 'Program pembinaan', description: 'Lihat program aktif', page: 'program' },
    ];

  return `<section class="role-action-strip" data-role-dashboard="${isAdmin ? 'admin' : 'pembinaan'}" aria-label="Akses cepat">${actions.map((action) => `
    <button class="role-action" type="button" data-page-link="${action.page}"${action.action ? ` data-dashboard-action="${action.action}"` : ''}>
      <span class="role-action-icon" aria-hidden="true">${action.icon}</span>
      <span><strong>${action.title}</strong><small>${action.description}</small></span>
      <span class="role-action-arrow" aria-hidden="true">↗</span>
    </button>`).join('')}</section>`;
}

function renderDashboard() {
  const isAdmin = state.user?.role === 'admin';
  const firstName = state.user?.name?.trim().split(/\s+/)[0] || (isAdmin ? 'Admin' : 'Petugas');
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date()));
  const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
  const todayLabel = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const programCounts = state.wbp.reduce((counts, person) => {
    const name = person.program?.trim() || 'Belum ditentukan';
    counts[name] = (counts[name] || 0) + 1;
    return counts;
  }, {});
  const programs = Object.entries(programCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(1, ...programs.map(([, count]) => count));
  const chart = programs.length
    ? programs.slice(0, 5).map(([name, count]) => `<div class="bar-row"><span class="bar-label">${escapeHtml(name)}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(7, count / maxCount * 100)}%"></span></span><span class="bar-value">${count}</span></div>`).join('')
    : '<p class="empty-chart">Data program belum tersedia.</p>';

  pageContent.innerHTML = `
    <div class="dashboard-layout${isAdmin ? ' admin-dashboard' : ' staff-dashboard'}">
    <section class="dashboard-hero${isAdmin ? ' dashboard-hero-admin' : ''}">
      <div class="dashboard-hero-copy">
        <p class="dashboard-hero-eyebrow">${isAdmin ? 'PANEL ADMINISTRASI' : 'RUANG KERJA PEMBINAAN'}<span aria-hidden="true"></span>LINGKUNGAN UJI</p>
        <h1>${greeting}, ${escapeHtml(firstName)}.</h1>
        <p>${isAdmin ? 'Pantau operasional pembinaan dan tindak lanjuti laporan dalam satu tempat.' : 'Semua penugasan dan progres pembinaan Anda, tersusun dalam satu tempat.'}</p>
      </div>
      <div class="dashboard-date-card"><span class="dashboard-date-icon" aria-hidden="true">▦</span><span><small>HARI INI</small><strong>${escapeHtml(todayLabel)}</strong><small>Waktu Indonesia Barat · WIB</small></span></div>
      <span class="dashboard-hero-orb dashboard-hero-orb-one" aria-hidden="true"></span>
      <span class="dashboard-hero-orb dashboard-hero-orb-two" aria-hidden="true"></span>
    </section>
    <div class="dashboard-actions-heading"><div><p class="eyebrow">LANGKAH CEPAT</p><h2>Akses cepat</h2></div></div>
    ${renderDashboardActions(isAdmin)}
    <div class="notice dashboard-notice"><span class="notice-mark" aria-hidden="true">i</span><span><strong>Lingkungan uji dengan data contoh.</strong> Data yang ditampilkan bukan data operasional. Jangan masukkan informasi WBP nyata sebelum sistem ditinjau dan disetujui untuk penggunaan resmi.</span></div>
    <div class="dashboard-section-heading"><div><p class="eyebrow">GAMBARAN SINGKAT</p><h2>Ringkasan hari ini</h2></div><span class="dashboard-section-date">${escapeHtml(todayLabel)}</span></div>
    <section class="stat-grid" aria-label="Ringkasan data">
      ${isAdmin ? `
        <article class="stat-card stat-card-staff"><div class="stat-card-top"><span>Petugas aktif</span><span class="stat-icon" aria-hidden="true">♙</span></div><p class="stat-value">${state.staff.filter((staff) => staff.is_active).length}</p><span class="stat-caption">Akun petugas pembinaan</span></article>
        <article class="stat-card stat-card-pending"><div class="stat-card-top"><span>Laporan menunggu</span><span class="stat-icon" aria-hidden="true">↗</span></div><p class="stat-value">${state.progressSummary?.submissions?.['Menunggu pemeriksaan'] || 0}</p><span class="stat-caption">Perlu diperiksa admin</span></article>
        <article class="stat-card stat-card-schedule"><div class="stat-card-top"><span>Jadwal hari ini</span><span class="stat-icon" aria-hidden="true">▦</span></div><p class="stat-value">${state.todaySchedules.length}</p><span class="stat-caption">Agenda kegiatan</span></article>
        <article class="stat-card stat-card-program"><div class="stat-card-top"><span>Program aktif</span><span class="stat-icon" aria-hidden="true">◷</span></div><p class="stat-value">${state.programs.filter((program) => program.is_active).length}</p><span class="stat-caption">Program pembinaan</span></article>
      ` : `
        <article class="stat-card stat-card-schedule"><div class="stat-card-top"><span>Penugasan hari ini</span><span class="stat-icon" aria-hidden="true">▦</span></div><p class="stat-value">${state.todaySchedules.length}</p><span class="stat-caption">Jadwal yang ditetapkan kepada Anda</span></article>
        <article class="stat-card stat-card-pending"><div class="stat-card-top"><span>Laporan menunggu</span><span class="stat-icon" aria-hidden="true">↗</span></div><p class="stat-value">${state.progressRows.filter((row) => row.submission_status === 'Menunggu pemeriksaan').length}</p><span class="stat-caption">Laporan Anda sedang diperiksa</span></article>
        <article class="stat-card stat-card-revision"><div class="stat-card-top"><span>Perlu revisi</span><span class="stat-icon" aria-hidden="true">!</span></div><p class="stat-value">${state.progressRows.filter((row) => row.submission_status === 'Perlu revisi').length}</p><span class="stat-caption">Tindak lanjuti catatan admin</span></article>
        <article class="stat-card stat-card-approved"><div class="stat-card-top"><span>Laporan disetujui</span><span class="stat-icon" aria-hidden="true">✓</span></div><p class="stat-value">${state.progressRows.filter((row) => row.submission_status === 'Disetujui').length}</p><span class="stat-caption">Progres yang telah diperiksa</span></article>
      `}
    </section>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-heading"><div><h2>Peserta menurut program</h2><p>Ringkasan berdasarkan data WBP yang tersedia</p></div><span class="panel-heading-tag">${state.wbp.length} DATA</span></div>
        <div class="program-chart">${chart}</div>
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Jadwal kegiatan</h2><p>Agenda hari ini · WIB</p></div><button class="text-button" data-page-link="schedules" type="button">Semua jadwal <span aria-hidden="true">→</span></button></div>
        ${state.todayScheduleError ? `<div class="schedule-empty"><p>${escapeHtml(state.todayScheduleError)}</p></div>` : renderScheduleItems(state.todaySchedules.slice(0, 4))}
      </section>
    </div>
    ${renderRecentTable(state.wbp)}
    </div>`;
}

async function loadTodaySchedules() {
  try {
    const result = await apiRequest(`/api/schedules?date=${getJakartaDate()}`);
    state.todaySchedules = result.schedules;
    state.todayScheduleError = null;
  } catch (error) {
    state.todaySchedules = [];
    state.todayScheduleError = error.message;
  }
  if (state.activePage === 'dashboard') renderDashboard();
}

async function loadProgressSummary() {
  try {
    state.progressSummary = await apiRequest('/api/progress/summary');
  } catch {
    state.progressSummary = null;
  }
  if (state.activePage === 'dashboard' || state.activePage === 'progress') renderPage();
}

async function loadPrograms() {
  try {
    state.programs = await apiRequest('/api/admin/programs');
  } catch (error) {
    state.programs = [];
    if (state.activePage === 'program' || state.activePage === 'schedules') showToast(`Program gagal dimuat: ${error.message}`);
  }
  if (state.activePage === 'program') renderProgramPage();
  if (state.activePage === 'dashboard' && state.user?.role === 'admin') renderDashboard();
}

async function loadStaff() {
  try {
    state.staff = await apiRequest('/api/admin/staff');
  } catch (error) {
    state.staff = [];
    if (state.activePage === 'staff') showToast(`Petugas gagal dimuat: ${error.message}`);
  }
  if (state.activePage === 'dashboard' || state.activePage === 'staff') renderPage();
}

function renderSchedulesPage() {
  const selectedDate = state.scheduleDate || getJakartaDate();
  state.scheduleDate = selectedDate;
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">AGENDA KEGIATAN</p><h1>Jadwal kegiatan</h1><p>${state.user?.role === 'admin' ? 'Kelola jadwal dan tetapkan petugas pelaksana.' : 'Lihat penugasan Anda dan catat pelaksanaan kegiatan.'}</p></div>${state.user?.role === 'admin' ? '<button id="add-schedule-button" class="button button-primary" type="button"><span aria-hidden="true">＋</span> Tambah jadwal</button>' : ''}</div>
    <section class="panel schedule-page-panel">
      <div class="table-toolbar"><label class="schedule-date-control"><span>Tanggal</span><input id="schedule-date" class="field-input" type="date" value="${escapeHtml(selectedDate)}" /></label><span id="schedule-count" class="stat-caption">Memuat jadwal...</span></div>
      <div id="schedule-page-list" class="schedule-page-list"><div class="loading-state">Memuat jadwal kegiatan...</div></div>
    </section>`;

  document.querySelector('#schedule-date').addEventListener('change', (event) => {
    state.scheduleDate = event.target.value || getJakartaDate();
    loadSchedulesForDate(state.scheduleDate);
  });
  document.querySelector('#add-schedule-button')?.addEventListener('click', () => openScheduleModal());
  loadSchedulesForDate(selectedDate);
}

async function loadSchedulesForDate(date) {
  const list = document.querySelector('#schedule-page-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-state">Memuat jadwal kegiatan...</div>';
  try {
    const result = await apiRequest(`/api/schedules?date=${encodeURIComponent(date)}`);
    if (state.activePage !== 'schedules' || state.scheduleDate !== date) return;
    list.innerHTML = renderScheduleItems(result.schedules, state.user?.role === 'admin' || state.user?.role === 'pembinaan');
    document.querySelector('#schedule-count').textContent = `${result.schedules.length} kegiatan`;
  } catch (error) {
    list.innerHTML = `<div class="schedule-empty"><p>${escapeHtml(error.message)}</p></div>`;
    document.querySelector('#schedule-count').textContent = 'Gagal memuat';
  }
}

function openScheduleModal(schedule = null) {
  const isEditing = Boolean(schedule);
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
        <div class="modal-header"><div><h2 id="schedule-modal-title">${isEditing ? 'Edit jadwal' : 'Tambah jadwal'}</h2><p>Waktu kegiatan menggunakan zona waktu WIB.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="schedule-form" class="modal-form">
          <div class="form-field"><label for="schedule-title">Nama kegiatan</label><input id="schedule-title" class="field-input" name="title" maxlength="120" required value="${escapeHtml(schedule?.title || '')}" /></div>
          <div class="form-field"><label for="schedule-category">Jenis kegiatan</label><input id="schedule-category" class="field-input" name="category" maxlength="60" placeholder="Contoh: Keterampilan" value="${escapeHtml(schedule?.category || '')}" /></div>
          <div class="form-field"><label for="schedule-program">Program pembinaan</label><select id="schedule-program" class="field-select" name="program_id"><option value="">Pilih program</option>${state.programs.filter((program) => program.is_active || Number(schedule?.program_id) === Number(program.id)).map((program) => `<option value="${Number(program.id)}"${Number(schedule?.program_id) === Number(program.id) ? ' selected' : ''}>${escapeHtml(program.name)}${program.is_active ? '' : ' (nonaktif)'}</option>`).join('')}</select></div>
          <div class="form-field"><label for="schedule-assignee">Petugas ditugaskan</label><select id="schedule-assignee" class="field-select" name="assigned_to"><option value="">Belum ditetapkan</option>${state.staff.filter((staff) => staff.is_active || Number(schedule?.assigned_to) === Number(staff.id)).map((staff) => `<option value="${Number(staff.id)}"${Number(schedule?.assigned_to) === Number(staff.id) ? ' selected' : ''}>${escapeHtml(staff.name)}${staff.is_active ? '' : ' (nonaktif)'}</option>`).join('')}</select></div>
          <div class="form-field"><label for="schedule-form-date">Tanggal</label><input id="schedule-form-date" class="field-input" type="date" name="schedule_date" required value="${escapeHtml(schedule?.schedule_date || state.scheduleDate || getJakartaDate())}" /></div>
          <div class="form-field"><label for="schedule-location">Lokasi</label><input id="schedule-location" class="field-input" name="location" maxlength="120" value="${escapeHtml(schedule?.location || '')}" /></div>
          <div class="form-field"><label for="schedule-start">Jam mulai</label><input id="schedule-start" class="field-input" name="start_time" type="time" required value="${escapeHtml(schedule?.start_time || '08:00')}" /></div>
          <div class="form-field"><label for="schedule-end">Jam selesai</label><input id="schedule-end" class="field-input" name="end_time" type="time" required value="${escapeHtml(schedule?.end_time || '09:00')}" /></div>
          <div class="form-field"><label for="schedule-facilitator">Fasilitator (opsional)</label><input id="schedule-facilitator" class="field-input" name="facilitator" maxlength="120" value="${escapeHtml(schedule?.facilitator || '')}" /></div>
          <div class="form-field"><label for="schedule-status">Status</label><select id="schedule-status" class="field-select" name="status"><option${schedule?.status === 'Terjadwal' || !schedule ? ' selected' : ''}>Terjadwal</option><option${schedule?.status === 'Selesai' ? ' selected' : ''}>Selesai</option><option${schedule?.status === 'Dibatalkan' ? ' selected' : ''}>Dibatalkan</option></select></div>
          <div class="form-field schedule-notes-field"><label for="schedule-notes">Catatan</label><input id="schedule-notes" class="field-input" name="notes" maxlength="500" value="${escapeHtml(schedule?.notes || '')}" /></div>
          <p id="schedule-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">${isEditing ? 'Simpan perubahan' : 'Simpan jadwal'}</button></div>
        </form>
      </section>
    </div>`;
  if (isEditing) modalRoot.querySelector('#schedule-form').dataset.id = String(schedule.id);
  modalRoot.querySelector('#schedule-title').focus();
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#schedule-form').addEventListener('submit', submitScheduleForm);
}

async function submitScheduleForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#schedule-form-error');
  const data = Object.fromEntries(new FormData(form).entries());
  const scheduleId = form.dataset.id;
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest(scheduleId ? `/api/schedules/${scheduleId}` : '/api/schedules', {
      method: scheduleId ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    modalRoot.innerHTML = '';
    await loadSchedulesForDate(state.scheduleDate || getJakartaDate());
    await loadTodaySchedules();
    showToast(scheduleId ? 'Jadwal berhasil diperbarui.' : 'Jadwal berhasil ditambahkan.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

async function openExecutionModal(scheduleId) {
  let schedule;
  try {
    schedule = await apiRequest(`/api/schedules/${scheduleId}`);
  } catch (error) {
    showToast(error.message);
    return;
  }
  const current = schedule?.execution_status;
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="execution-modal-title">
        <div class="modal-header"><div><h2 id="execution-modal-title">Catat pelaksanaan</h2><p>Catatan ini menjadi rekam pelaksanaan penugasan.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="execution-form" class="modal-form">
          <div class="form-field progress-notes-field"><label for="execution-status">Hasil kegiatan</label><select id="execution-status" class="field-select" name="execution_status" required><option${current === 'Selesai' || !current || current === 'Belum dicatat' ? ' selected' : ''}>Selesai</option><option${current === 'Tidak terlaksana' ? ' selected' : ''}>Tidak terlaksana</option></select></div>
          <div class="form-field progress-notes-field"><label for="execution-notes">Catatan pelaksanaan</label><textarea id="execution-notes" class="field-input progress-textarea" name="execution_notes" maxlength="1000">${escapeHtml(schedule?.execution_notes || '')}</textarea></div>
          <p id="execution-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">Simpan catatan</button></div>
        </form>
      </section>
    </div>`;
  modalRoot.querySelector('#execution-form').dataset.id = String(scheduleId);
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#execution-form').addEventListener('submit', submitExecutionForm);
}

async function submitExecutionForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#execution-form-error');
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest(`/api/schedules/${form.dataset.id}/execution`, {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    modalRoot.innerHTML = '';
    await loadSchedulesForDate(state.scheduleDate || getJakartaDate());
    await loadTodaySchedules();
    showToast('Pelaksanaan kegiatan berhasil dicatat.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

function renderProgressRows(rows) {
  if (!rows.length) return '<tr><td class="empty-row" colspan="11">Belum ada laporan untuk filter ini.</td></tr>';
  return rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.evaluation_date)}</td>
      <td><div class="person-cell"><strong>${escapeHtml(row.nama)}</strong><small>${escapeHtml(row.nomor_register)}</small></div></td>
      <td>${escapeHtml(row.reporter_name || '-')}</td>
      <td>${escapeHtml(row.schedule_title || 'Catatan lama')}</td>
      <td>${escapeHtml(row.program)}</td>
      <td>${escapeHtml(row.attendance)}</td>
      <td><span class="progress-status-pill ${row.progress_status === 'Perlu Pendampingan' ? 'is-follow-up' : row.progress_status === 'Selesai' ? 'is-complete' : ''}">${escapeHtml(row.progress_status)}</span></td>
      <td class="progress-note-cell">${escapeHtml(row.evaluation_notes)}</td>
      <td class="progress-note-cell">${escapeHtml(row.follow_up || '-')}</td>
      <td><span class="progress-status-pill ${row.submission_status === 'Disetujui' ? 'is-complete' : row.submission_status === 'Perlu revisi' ? 'is-follow-up' : ''}">${escapeHtml(row.submission_status || 'Disetujui')}</span>${row.review_note ? `<small class="review-note">${escapeHtml(row.review_note)}</small>` : ''}</td>
      <td><div class="row-actions">${row.submission_status !== 'Disetujui' || state.user?.role === 'admin' ? `<button class="profile-button" type="button" data-edit-progress="${Number(row.id)}">Detail / edit</button>` : ''}${state.user?.role === 'admin' && row.submission_status === 'Menunggu pemeriksaan' ? `<button class="profile-button" type="button" data-review-progress="${Number(row.id)}" data-review-status="Disetujui">Setujui</button><button class="danger-button" type="button" data-review-progress="${Number(row.id)}" data-review-status="Perlu revisi">Minta revisi</button>` : ''}${state.user?.role === 'admin' ? `<button class="danger-button" type="button" data-delete-progress="${Number(row.id)}">Hapus</button>` : ''}</div></td>
    </tr>`).join('');
}

function renderProgressPage() {
  const summary = state.progressSummary || { totalEvaluations: 0, attendance: {}, progress: {} };
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">${state.user?.role === 'admin' ? 'PEMERIKSAAN LAPORAN' : 'LAPORAN PENUGASAN'}</p><h1>${state.user?.role === 'admin' ? 'Laporan &amp; progres pembinaan' : 'Laporan &amp; progres saya'}</h1><p>${state.user?.role === 'admin' ? 'Periksa laporan petugas dan pantau rekap progres pembinaan.' : 'Kirim laporan kegiatan dari penugasan dan pantau status pemeriksaannya.'}</p></div>${hasWriteAccess() ? '<button id="add-progress-button" class="button button-primary" type="button"><span aria-hidden="true">＋</span> Buat laporan</button>' : ''}</div>
    <div class="notice"><span class="notice-mark" aria-hidden="true">i</span><span>Laporan petugas berstatus menunggu pemeriksaan sampai admin menyetujui atau meminta revisi. Catatan progres lama tetap dipertahankan.</span></div>
    <section class="progress-summary-grid" aria-label="Ringkasan evaluasi">
      <article class="progress-summary-item"><span>Total catatan</span><strong>${summary.totalEvaluations}</strong></article>
      <article class="progress-summary-item"><span>Hadir</span><strong>${summary.attendance.Hadir || 0}</strong></article>
      <article class="progress-summary-item"><span>Berkembang</span><strong>${summary.progress.Berkembang || 0}</strong></article>
      <article class="progress-summary-item"><span>Perlu pendampingan</span><strong>${summary.progress['Perlu Pendampingan'] || 0}</strong></article>
    </section>
    ${hasWriteAccess() ? `
      <section class="panel progress-panel">
        <div class="table-toolbar progress-filters">
          <label class="schedule-date-control"><span>Dari</span><input id="progress-from" class="field-input" type="date" value="${escapeHtml(state.progressFilters.from)}" /></label>
          <label class="schedule-date-control"><span>Sampai</span><input id="progress-to" class="field-input" type="date" value="${escapeHtml(state.progressFilters.to)}" /></label>
          <label class="progress-status-filter"><span>Status</span><select id="progress-status-filter" class="field-select"><option value="">Semua status</option>${['Berkembang', 'Sesuai Rencana', 'Perlu Pendampingan', 'Selesai'].map((status) => `<option${state.progressFilters.status === status ? ' selected' : ''}>${status}</option>`).join('')}</select></label>
          <span id="progress-result-count" class="stat-caption">Memuat...</span>
        </div>
        <div class="table-scroll"><table class="progress-table">
          <thead><tr><th>Tanggal</th><th>WBP</th><th>Petugas</th><th>Penugasan</th><th>Program</th><th>Kehadiran</th><th>Progres</th><th>Catatan</th><th>Tindak lanjut</th><th>Status laporan</th><th>Aksi</th></tr></thead>
              <tbody id="progress-table-body"><tr><td class="empty-row" colspan="11">Memuat laporan...</td></tr></tbody>
        </table></div>
      </section>` : `
      <section class="panel aggregate-progress-panel"><div class="panel-heading"><div><h2>Ringkasan agregat</h2><p>Detail catatan hanya dapat dilihat admin dan petugas pembinaan.</p></div></div><div class="progress-summary-grid">${Object.entries(summary.progress).map(([status, count]) => `<article class="progress-summary-item"><span>${escapeHtml(status)}</span><strong>${count}</strong></article>`).join('') || '<p class="empty-chart">Belum ada data evaluasi.</p>'}</div></section>`}`;

  if (hasWriteAccess()) {
    ['progress-from', 'progress-to', 'progress-status-filter'].forEach((id) => {
      document.querySelector(`#${id}`).addEventListener('change', (event) => {
        state.progressFilters[id === 'progress-from' ? 'from' : id === 'progress-to' ? 'to' : 'status'] = event.target.value;
        loadProgressRows();
      });
    });
    document.querySelector('#add-progress-button').addEventListener('click', () => openProgressModal());
    loadProgressRows();
  }
}

async function loadProgressRows() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.progressFilters)) {
    if (value) params.set(key, value);
  }
  const tableBody = document.querySelector('#progress-table-body');
  if (tableBody)   tableBody.innerHTML = '<tr><td class="empty-row" colspan="11">Memuat laporan...</td></tr>';
  try {
    const rows = await apiRequest(`/api/progress${params.size ? `?${params}` : ''}`);
    state.progressRows = rows;
    if (state.activePage === 'dashboard' && state.user?.role === 'pembinaan') renderDashboard();
    if (state.activePage !== 'progress' || !tableBody) return;
    tableBody.innerHTML = renderProgressRows(rows);
    document.querySelector('#progress-result-count').textContent = `${rows.length} laporan`;
  } catch (error) {
    if (tableBody) {
      tableBody.innerHTML = `<tr><td class="empty-row" colspan="11">${escapeHtml(error.message)}</td></tr>`;
      document.querySelector('#progress-result-count').textContent = 'Gagal memuat';
    }
  }
}

async function openProgressModal(evaluation = null) {
  const isEditing = Boolean(evaluation);
  let assignedSchedules = [];
  if (state.user?.role === 'pembinaan') {
    try {
      const result = await apiRequest('/api/schedules?all=1');
      assignedSchedules = result.schedules;
    } catch (error) {
      showToast(`Penugasan gagal dimuat: ${error.message}`);
      return;
    }
  }
  const selectableWbp = state.wbp.filter((person) => person.status !== 'Selesai');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="progress-modal-title">
        <div class="modal-header"><div><h2 id="progress-modal-title">${isEditing ? 'Edit evaluasi' : 'Catat evaluasi'}</h2><p>Isi berdasarkan hasil pengamatan petugas.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="progress-form" class="modal-form">
          ${state.user?.role === 'pembinaan' ? `<div class="form-field progress-notes-field"><label for="evaluation-schedule">Jadwal tugas</label><select id="evaluation-schedule" class="field-select" name="schedule_id" required><option value="">Pilih penugasan</option>${assignedSchedules.map((schedule) => `<option value="${Number(schedule.id)}"${Number(evaluation?.schedule_id) === Number(schedule.id) ? ' selected' : ''}>${escapeHtml(schedule.schedule_date)} · ${escapeHtml(schedule.start_time)} · ${escapeHtml(schedule.title)}</option>`).join('')}</select></div>` : ''}
          <div class="form-field"><label for="evaluation-wbp">Warga binaan</label><select id="evaluation-wbp" class="field-select" name="wbp_id" required><option value="">Pilih WBP</option>${selectableWbp.map((person) => `<option value="${Number(person.id)}"${Number(evaluation?.wbp_id) === Number(person.id) ? ' selected' : ''}>${escapeHtml(person.nama)} (${escapeHtml(person.nomor_register)})</option>`).join('')}</select></div>
          <div class="form-field"><label for="evaluation-program">Program</label><input id="evaluation-program" class="field-input" name="program" maxlength="120" required value="${escapeHtml(evaluation?.program || '')}" ${state.user?.role === 'pembinaan' && evaluation?.program ? 'readonly' : ''} /></div>
          <div class="form-field"><label for="evaluation-date">Tanggal evaluasi</label><input id="evaluation-date" class="field-input" name="evaluation_date" type="date" required value="${escapeHtml(evaluation?.evaluation_date || getJakartaDate())}" /></div>
          <div class="form-field"><label for="evaluation-attendance">Kehadiran</label><select id="evaluation-attendance" class="field-select" name="attendance"><option${evaluation?.attendance === 'Hadir' || !evaluation ? ' selected' : ''}>Hadir</option><option${evaluation?.attendance === 'Izin' ? ' selected' : ''}>Izin</option><option${evaluation?.attendance === 'Tidak Hadir' ? ' selected' : ''}>Tidak Hadir</option></select></div>
          <div class="form-field"><label for="evaluation-status">Status perkembangan</label><select id="evaluation-status" class="field-select" name="progress_status" required><option value="">Pilih status</option>${['Berkembang', 'Sesuai Rencana', 'Perlu Pendampingan', 'Selesai'].map((status) => `<option${evaluation?.progress_status === status ? ' selected' : ''}>${status}</option>`).join('')}</select></div>
          <div class="form-field progress-notes-field"><label for="evaluation-notes">Catatan evaluasi</label><textarea id="evaluation-notes" class="field-input progress-textarea" name="evaluation_notes" maxlength="2000" required>${escapeHtml(evaluation?.evaluation_notes || '')}</textarea></div>
          <div class="form-field progress-notes-field"><label for="evaluation-follow-up">Tindak lanjut</label><textarea id="evaluation-follow-up" class="field-input progress-textarea" name="follow_up" maxlength="2000">${escapeHtml(evaluation?.follow_up || '')}</textarea></div>
          <p id="progress-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">${isEditing ? 'Simpan perubahan' : 'Simpan evaluasi'}</button></div>
        </form>
      </section>
    </div>`;
  if (isEditing) modalRoot.querySelector('#progress-form').dataset.id = String(evaluation.id);
  modalRoot.querySelector('#evaluation-wbp').addEventListener('change', (event) => {
    const person = state.wbp.find((item) => item.id === Number(event.target.value));
    const programInput = modalRoot.querySelector('#evaluation-program');
    if (person?.program && !programInput.value) programInput.value = person.program;
  });
  modalRoot.querySelector('#evaluation-schedule')?.addEventListener('change', (event) => {
    const schedule = assignedSchedules.find((item) => item.id === Number(event.target.value));
    if (schedule?.program_name) modalRoot.querySelector('#evaluation-program').value = schedule.program_name;
    if (schedule?.schedule_date) modalRoot.querySelector('#evaluation-date').value = schedule.schedule_date;
  });
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#progress-form').addEventListener('submit', submitProgressForm);
  modalRoot.querySelector('#evaluation-wbp').focus();
}

async function submitProgressForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#progress-form-error');
  const data = Object.fromEntries(new FormData(form).entries());
  const evaluationId = form.dataset.id;
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest(evaluationId ? `/api/progress/${evaluationId}` : '/api/progress', {
      method: evaluationId ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    modalRoot.innerHTML = '';
    await loadProgressSummary();
    showToast(evaluationId ? 'Evaluasi berhasil diperbarui.' : 'Evaluasi berhasil disimpan.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

function renderWbpPage() {
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">DATA TERBATAS</p><h1>Data WBP</h1><p>Informasi yang ditampilkan mengikuti hak akses akun Anda.</p></div>${hasWriteAccess() ? '<button id="add-wbp-button" class="button button-primary" type="button"><span aria-hidden="true">＋</span> Tambah data</button>' : ''}</div>
    <div class="notice"><span class="notice-mark" aria-hidden="true">i</span><span><strong>Data contoh untuk pengujian.</strong> Gunakan data fiktif sampai penerapan kontrol keamanan dan persetujuan operasional selesai.</span></div>
    <section class="panel table-panel">
      <div class="table-toolbar"><label class="search-wrap"><span aria-hidden="true">⌕</span><input id="wbp-search" class="search-input" type="search" placeholder="Cari nama, nomor register, blok..." value="${escapeHtml(state.search)}" aria-label="Cari data WBP" /></label><span id="table-result-count" class="stat-caption">${state.wbp.length} data</span></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Nama / nomor register</th><th>Blok</th><th>Program</th><th>Status</th><th>Tanggal masuk</th><th>Tanggal keluar</th><th>Profil</th>${hasWriteAccess() ? '<th>Aksi</th>' : ''}</tr></thead>
        <tbody id="wbp-table-body">${renderWbpRows(filteredWbp(), Infinity, hasWriteAccess())}</tbody>
      </table></div>
      <div class="table-footer"><span id="table-footer-count">Menampilkan ${filteredWbp().length} data</span><span>Informasi terbatas sesuai hak akses</span></div>
    </section>`;

  document.querySelector('#wbp-search').addEventListener('input', (event) => {
    state.search = event.target.value;
    const filtered = filteredWbp();
    document.querySelector('#wbp-table-body').innerHTML = renderWbpRows(filtered, Infinity, hasWriteAccess());
    document.querySelector('#table-result-count').textContent = `${filtered.length} data`;
    document.querySelector('#table-footer-count').textContent = `Menampilkan ${filtered.length} data`;
  });
  document.querySelector('#add-wbp-button')?.addEventListener('click', openWbpModal);
}

function renderProgramPage() {
  const isAdmin = state.user?.role === 'admin';
  const programs = state.programs;
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">KEGIATAN PEMBINAAN</p><h1>Program pembinaan</h1><p>${isAdmin ? 'Kelola daftar program yang dapat digunakan saat membuat jadwal.' : 'Lihat daftar program aktif yang tersedia.'}</p></div>${isAdmin ? '<button id="add-program-button" class="button button-primary" type="button">＋ Tambah program</button>' : ''}</div>
    <section class="content-panel panel"><div class="program-list">${programs.length ? programs.map((program, index) => `<article class="program-item"><span class="program-index">PROGRAM ${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(program.name)}</h3><p>${escapeHtml(program.description || program.category || 'Belum ada keterangan program.')}</p><strong>${Number(program.schedule_count) || 0} jadwal terhubung · ${program.is_active ? 'Aktif' : 'Nonaktif'}</strong>${isAdmin ? `<div class="program-actions"><button class="profile-button" type="button" data-edit-program="${Number(program.id)}">Edit</button><button class="danger-button" type="button" data-delete-program="${Number(program.id)}"${Number(program.schedule_count) > 0 ? ' disabled title="Program yang terhubung dengan jadwal tidak dapat dihapus; nonaktifkan melalui Edit."' : ''}>Hapus</button></div>${Number(program.schedule_count) > 0 ? '<small class="program-delete-note">Program terkait jadwal tidak dapat dihapus. Anda dapat menonaktifkannya melalui Edit.</small>' : ''}` : ''}</article>`).join('') : '<p class="empty-chart">Belum ada program terdaftar.</p>'}</div></section>`;
  document.querySelector('#add-program-button')?.addEventListener('click', () => openProgramModal());
}

function openProgramModal(program = null) {
  const editing = Boolean(program);
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="program-modal-title">
        <div class="modal-header"><div><h2 id="program-modal-title">${editing ? 'Edit program' : 'Tambah program'}</h2><p>Program nonaktif tetap tercatat untuk histori jadwal.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="program-form" class="modal-form">
          <div class="form-field"><label for="program-name">Nama program</label><input id="program-name" class="field-input" name="name" maxlength="120" required value="${escapeHtml(program?.name || '')}" /></div>
          <div class="form-field"><label for="program-category">Kategori</label><input id="program-category" class="field-input" name="category" maxlength="60" value="${escapeHtml(program?.category || '')}" /></div>
          <div class="form-field institution-form-wide"><label for="program-description">Deskripsi</label><textarea id="program-description" class="field-input progress-textarea" name="description" maxlength="1000">${escapeHtml(program?.description || '')}</textarea></div>
          <div class="form-field institution-form-wide"><label><input type="checkbox" name="is_active" value="1"${!program || program.is_active ? ' checked' : ''} /> Program aktif</label></div>
          <p id="program-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">Simpan program</button></div>
        </form>
      </section>
    </div>`;
  if (editing) modalRoot.querySelector('#program-form').dataset.id = String(program.id);
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#program-form').addEventListener('submit', submitProgramForm);
  modalRoot.querySelector('#program-name').focus();
}

async function submitProgramForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#program-form-error');
  const values = Object.fromEntries(new FormData(form).entries());
  values.is_active = form.elements.is_active.checked ? 1 : 0;
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest(form.dataset.id ? `/api/admin/programs/${form.dataset.id}` : '/api/admin/programs', {
      method: form.dataset.id ? 'PUT' : 'POST',
      body: JSON.stringify(values),
    });
    modalRoot.innerHTML = '';
    await loadPrograms();
    showToast('Program berhasil disimpan.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

function renderStaffPage() {
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">AKUN INTERNAL</p><h1>Manajemen petugas</h1><p>Buat akun petugas pembinaan dan kelola status aksesnya.</p></div><button id="add-staff-button" class="button button-primary" type="button">＋ Tambah petugas</button></div>
    <div class="notice"><span class="notice-mark" aria-hidden="true">i</span><span>Kredensial awal hanya ditampilkan saat dibuat. Minta petugas mengganti password saat pertama kali masuk.</span></div>
    <section class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>Nama</th><th>Username</th><th>Jabatan</th><th>Email / telepon</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${state.staff.length ? state.staff.map((staff) => `<tr><td>${escapeHtml(staff.name)}</td><td>${escapeHtml(staff.username)}</td><td>${escapeHtml(staff.position || '-')}</td><td>${escapeHtml([staff.email, staff.phone].filter(Boolean).join(' · ') || '-')}</td><td>${staff.is_active ? 'Aktif' : 'Nonaktif'}</td><td><button class="profile-button" type="button" data-edit-staff="${Number(staff.id)}">Edit</button></td></tr>`).join('') : '<tr><td class="empty-row" colspan="6">Belum ada akun petugas.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#add-staff-button').addEventListener('click', () => openStaffModal());
}

function openStaffModal(staff = null) {
  const editing = Boolean(staff);
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="staff-modal-title">
        <div class="modal-header"><div><h2 id="staff-modal-title">${editing ? 'Edit petugas' : 'Tambah petugas'}</h2><p>Role akun baru ditetapkan sebagai Petugas Pembinaan.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="staff-form" class="modal-form">
          <div class="form-field"><label for="staff-name">Nama</label><input id="staff-name" class="field-input" name="name" maxlength="120" required value="${escapeHtml(staff?.name || '')}" /></div>
          <div class="form-field"><label for="staff-username">Username</label><input id="staff-username" class="field-input" name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]+" required value="${escapeHtml(staff?.username || '')}" /></div>
          ${editing ? '' : '<div class="form-field institution-form-wide"><label for="staff-password">Password awal</label><input id="staff-password" class="field-input" name="password" type="password" minlength="12" maxlength="72" required /><small>Minimal 12 karakter.</small></div>'}
          <div class="form-field"><label for="staff-position">Jabatan</label><input id="staff-position" class="field-input" name="position" maxlength="120" value="${escapeHtml(staff?.position || '')}" /></div>
          <div class="form-field"><label for="staff-email">Email</label><input id="staff-email" class="field-input" name="email" type="email" maxlength="150" value="${escapeHtml(staff?.email || '')}" /></div>
          <div class="form-field"><label for="staff-phone">Telepon</label><input id="staff-phone" class="field-input" name="phone" maxlength="30" value="${escapeHtml(staff?.phone || '')}" /></div>
          ${editing ? `<div class="form-field institution-form-wide"><label><input type="checkbox" name="is_active" value="1"${staff.is_active ? ' checked' : ''} /> Akun aktif</label></div>` : ''}
          <p id="staff-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">Simpan petugas</button></div>
        </form>
      </section>
    </div>`;
  if (editing) modalRoot.querySelector('#staff-form').dataset.id = String(staff.id);
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#staff-form').addEventListener('submit', submitStaffForm);
  modalRoot.querySelector('#staff-name').focus();
}

async function submitStaffForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#staff-form-error');
  const values = Object.fromEntries(new FormData(form).entries());
  if (form.dataset.id) values.is_active = form.elements.is_active.checked ? 1 : 0;
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest(form.dataset.id ? `/api/admin/staff/${form.dataset.id}` : '/api/admin/staff', {
      method: form.dataset.id ? 'PUT' : 'POST',
      body: JSON.stringify(values),
    });
    modalRoot.innerHTML = '';
    await loadStaff();
    showToast('Akun petugas berhasil disimpan.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

async function loadAuditRows() {
  try {
    state.auditRows = await apiRequest('/api/admin/audit');
    if (state.activePage === 'audit') renderAuditPage();
  } catch (error) {
    state.auditRows = [];
    if (state.activePage === 'audit') pageContent.innerHTML = `<div class="notice"><span class="notice-mark">!</span><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderAuditPage() {
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">JEJAK PERUBAHAN</p><h1>Aktivitas sistem</h1><p>Log aktivitas penting yang dilakukan melalui aplikasi (maksimal 300 aktivitas terbaru).</p></div><div class="audit-page-actions"><button id="refresh-audit-button" class="button button-secondary" type="button">Muat ulang</button><button id="clear-audit-button" class="button button-danger" type="button"${state.auditRows.length ? '' : ' disabled'}>Bersihkan riwayat</button></div></div>
    <div class="notice audit-retention-notice"><span class="notice-mark" aria-hidden="true">i</span><span>Membersihkan riwayat akan menghapus aktivitas yang tercatat saat ini. Tindakan pembersihan tetap dicatat sebagai aktivitas baru.</span></div>
    <section class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aktivitas</th><th>Objek</th><th>ID</th></tr></thead><tbody>${state.auditRows.length ? state.auditRows.map((row) => `<tr><td>${escapeHtml(row.created_at)}</td><td>${escapeHtml(row.actor_name || 'Akun dihapus')} (${escapeHtml(row.actor_username || '-')})</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.entity)}</td><td>${escapeHtml(row.entity_id || '-')}</td></tr>`).join('') : '<tr><td class="empty-row" colspan="5">Belum ada aktivitas tercatat.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#refresh-audit-button').addEventListener('click', loadAuditRows);
  document.querySelector('#clear-audit-button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!state.auditRows.length || state.user?.role !== 'admin') return;
    const confirmed = window.confirm('Bersihkan riwayat aktivitas yang tercatat saat ini? Aktivitas pembersihan akan tetap disimpan.');
    if (!confirmed) return;
    button.disabled = true;
    try {
      const result = await apiRequest('/api/admin/audit', { method: 'DELETE' });
      await loadAuditRows();
      showToast(`${result.deletedCount} riwayat aktivitas berhasil dibersihkan.`);
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  });
}

function renderAssistantPage() {
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">JAWABAN LANGSUNG DARI DATABASE</p><h1>Asisten WBP</h1><p>Tanyakan ringkasan atau informasi WBP yang diizinkan untuk akun Anda.</p></div><span class="assistant-connection"><span></span>DATABASE LOKAL</span></div>
    <div class="assistant-notice"><strong>Privasi terjaga.</strong> Pertanyaan diproses oleh server lokal dan tidak dikirim ke layanan AI eksternal. Jawaban hanya mencakup data yang tercatat; jadwal pembinaan dan informasi yang belum tersedia tidak akan direka.</div>
    <section class="panel assistant-chat-panel">
      ${state.assistantMessages.length ? `<div class="assistant-history-actions"><button id="clear-assistant-chat" class="danger-button" type="button"${state.busy ? ' disabled' : ''}>Hapus semua chat</button></div>` : ''}
      <div id="assistant-messages" class="assistant-messages" aria-live="polite">${renderAssistantMessages()}</div>
      <div class="assistant-suggestions" aria-label="Contoh pertanyaan">
        <button type="button" class="suggestion-chip" data-assistant-prompt="Berapa jumlah WBP?">Jumlah WBP</button>
        <button type="button" class="suggestion-chip" data-assistant-prompt="Berapa jumlah WBP di Blok A?">Jumlah per blok</button>
        <button type="button" class="suggestion-chip" data-assistant-prompt="Siapa WBP yang mengikuti program Keterampilan?">Peserta program</button>
        ${hasWriteAccess() ? '<button type="button" class="suggestion-chip" data-assistant-prompt="Tampilkan data WBP-001">Cari nomor register</button>' : ''}
      </div>
      <form id="assistant-form" class="assistant-composer">
        <label class="assistant-input-wrap" for="assistant-question"><span aria-hidden="true">⌕</span><input id="assistant-question" name="question" maxlength="500" required placeholder="Tulis pertanyaan tentang data WBP..." autocomplete="off" /></label>
        <button id="assistant-submit" class="button button-primary" type="submit" aria-label="Kirim pertanyaan"><span aria-hidden="true">↑</span><span>Kirim</span></button>
      </form>
      <p class="assistant-footnote">Jawaban bersumber dari database WBP. Pastikan hak akses dan tujuan penggunaan sesuai kewenangan.</p>
    </section>`;

  document.querySelector('#assistant-form').addEventListener('submit', submitAssistantQuestion);
  document.querySelectorAll('[data-assistant-prompt]').forEach((button) => button.addEventListener('click', () => {
    const input = document.querySelector('#assistant-question');
    input.value = button.dataset.assistantPrompt;
    input.focus();
  }));
  scrollAssistantToLatest();
}

function renderAssistantMessages() {
  if (!state.assistantMessages.length) {
    return `<article class="assistant-message assistant-message-bot"><span class="assistant-message-icon" aria-hidden="true">✳</span><div class="assistant-message-body"><div class="assistant-message-meta">Asisten WBP <span>•</span> berbasis database</div><p>Halo, saya membantu mencari informasi yang tercatat pada database WBP. Silakan pilih contoh pertanyaan atau ketik pertanyaan Anda.</p></div></article>`;
  }

  return state.assistantMessages.map((message, index) => `
    <article class="assistant-message ${message.role === 'user' ? 'assistant-message-user' : 'assistant-message-bot'}">
      ${message.role === 'assistant' ? '<span class="assistant-message-icon" aria-hidden="true">✳</span>' : ''}
      <div class="assistant-message-body">
        <div class="assistant-message-meta">${message.role === 'user' ? 'Anda' : 'Asisten WBP'}${message.source ? ` <span>•</span> ${escapeHtml(message.source)}` : ''}</div>
        <p>${escapeHtml(message.content)}</p>
        ${message.role === 'user' ? `<button class="assistant-delete-button" type="button" data-delete-assistant-question="${index}"${state.busy ? ' disabled' : ''}>Hapus</button>` : ''}
      </div>
    </article>`).join('');
}

function scrollAssistantToLatest() {
  const messageList = document.querySelector('#assistant-messages');
  if (messageList) messageList.scrollTop = messageList.scrollHeight;
}

async function submitAssistantQuestion(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = event.currentTarget;
  const input = form.elements.question;
  const question = input.value.trim();
  if (!question) return;

  state.assistantMessages.push({ role: 'user', content: question });
  state.busy = true;
  renderAssistantPage();
  const refreshedForm = document.querySelector('#assistant-form');
  const refreshedInput = document.querySelector('#assistant-question');
  const submitButton = document.querySelector('#assistant-submit');
  refreshedInput.value = question;
  refreshedInput.disabled = true;
  submitButton.disabled = true;
  submitButton.querySelector('span:last-child').textContent = 'Memproses';

  try {
    const response = await apiRequest('/api/assistant/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
    state.assistantMessages.push({ role: 'assistant', content: response.answer, source: response.source });
  } catch (error) {
    state.assistantMessages.push({ role: 'assistant', content: error.message, source: 'Permintaan gagal' });
  } finally {
    state.busy = false;
    renderAssistantPage();
    document.querySelector('#assistant-question').focus();
  }
}

function renderLoginBackgroundPage() {
  const settings = state.loginBackgroundSettings;
  const previewUrl = state.loginBackgroundUpload || (settings?.configured
    ? `/api/login-background/image?v=${encodeURIComponent(settings.updated_at || '')}`
    : '');
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">PENGATURAN ADMIN</p><h1>Tampilan login</h1><p>Atur gambar latar di sisi kanan halaman login yang terlihat sebelum pengguna masuk.</p></div></div>
    ${state.loginBackgroundSettingsLoading ? '<section class="panel"><div class="loading-state">Memuat pengaturan tampilan login...</div></section>' : state.loginBackgroundSettingsError ? `<div class="notice"><span class="notice-mark" aria-hidden="true">!</span><span>${escapeHtml(state.loginBackgroundSettingsError)}</span></div>` : `
      <section class="panel content-panel login-background-settings-card">
        <div class="login-background-settings-copy">
          <p class="eyebrow">PRATINJAU</p>
          <h2>Foto latar halaman masuk</h2>
          <p>Gunakan gambar resmi yang pantas ditampilkan kepada siapa saja yang membuka halaman login.</p>
          <div class="login-background-actions">
            <label class="button button-primary login-background-select" for="login-background-input"><span aria-hidden="true">↑</span>Pilih foto</label>
            <input id="login-background-input" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" />
            <button id="save-login-background" class="button button-secondary" type="button"${state.loginBackgroundUpload ? '' : ' disabled'}>Simpan gambar</button>
            <button id="delete-login-background" class="button button-danger" type="button"${settings?.configured ? '' : ' disabled'}>Hapus gambar</button>
          </div>
          <p class="login-background-help">JPEG, PNG, atau WebP · maksimal 2 MB. Gambar ini ditampilkan di halaman publik sebelum login.</p>
          <p id="login-background-error" class="form-error" role="alert" hidden></p>
        </div>
        <div class="login-background-preview" aria-label="Pratinjau gambar latar login">
          ${previewUrl
    ? `<img id="login-background-preview-image" src="${escapeHtml(previewUrl)}" alt="${state.loginBackgroundUpload ? 'Pratinjau gambar latar login' : 'Gambar latar login saat ini'}" />`
    : '<div class="login-background-preview-empty"><span aria-hidden="true">▧</span><strong>Belum ada gambar</strong><small>Warna latar bawaan tetap digunakan.</small></div>'}
          <span class="login-background-preview-card"><strong>Masuk ke akun</strong><small>Pratinjau halaman login</small></span>
        </div>
      </section>`}`;
}

async function loadLoginBackgroundSettings() {
  if (state.loginBackgroundSettingsLoading) return;
  state.loginBackgroundSettingsLoading = true;
  state.loginBackgroundSettingsError = null;
  renderLoginBackgroundPage();
  try {
    state.loginBackgroundSettings = await apiRequest('/api/login-background/settings');
    state.loginBackgroundUpload = null;
  } catch (error) {
    state.loginBackgroundSettingsError = error.message;
  } finally {
    state.loginBackgroundSettingsLoading = false;
    if (state.activePage === 'login-settings') renderLoginBackgroundPage();
  }
}

async function readLoginBackgroundFile(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  const errorNode = document.querySelector('#login-background-error');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    errorNode.textContent = 'Pilih gambar berformat JPEG, PNG, atau WebP.';
    errorNode.hidden = false;
    input.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    errorNode.textContent = 'Ukuran gambar maksimal 2 MB.';
    errorNode.hidden = false;
    input.value = '';
    return;
  }

  try {
    state.loginBackgroundUpload = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') reject(new Error('File gambar tidak dapat dibaca.'));
        else resolve(reader.result);
      };
      reader.onerror = () => reject(new Error('File gambar tidak dapat dibaca.'));
      reader.readAsDataURL(file);
    });
    const preview = document.querySelector('#login-background-preview-image');
    if (preview) {
      preview.src = state.loginBackgroundUpload;
    } else {
      renderLoginBackgroundPage();
      document.querySelector('#login-background-preview-image').src = state.loginBackgroundUpload;
    }
    document.querySelector('#save-login-background').disabled = false;
    errorNode.hidden = true;
  } catch (error) {
    const currentErrorNode = document.querySelector('#login-background-error');
    currentErrorNode.textContent = error.message;
    currentErrorNode.hidden = false;
  } finally {
    input.value = '';
  }
}

async function saveLoginBackground() {
  if (!state.loginBackgroundUpload || state.user?.role !== 'admin') return;
  const button = document.querySelector('#save-login-background');
  const errorNode = document.querySelector('#login-background-error');
  button.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest('/api/login-background', {
      method: 'PUT',
      body: JSON.stringify({ image: state.loginBackgroundUpload }),
    });
    state.loginBackgroundSettings = { configured: true, updated_at: new Date().toISOString() };
    state.loginBackgroundSettingsError = null;
    state.loginBackgroundUpload = null;
    state.loginBackgroundRevision += 1;
    renderLoginBackgroundPage();
    loginView.style.setProperty('--login-background-image', `url("/api/login-background/image?v=${Date.now()}")`);
    showToast('Gambar latar login berhasil diperbarui.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    button.disabled = false;
  }
}

async function deleteLoginBackground() {
  if (!state.loginBackgroundSettings?.configured || state.user?.role !== 'admin') return;
  if (!window.confirm('Hapus gambar latar login dan gunakan kembali latar bawaan?')) return;
  const button = document.querySelector('#delete-login-background');
  const errorNode = document.querySelector('#login-background-error');
  button.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest('/api/login-background', { method: 'DELETE' });
    state.loginBackgroundSettings = { configured: false, updated_at: null };
    state.loginBackgroundSettingsError = null;
    state.loginBackgroundUpload = null;
    state.loginBackgroundRevision += 1;
    renderLoginBackgroundPage();
    loginView.style.setProperty('--login-background-image', 'none');
    showToast('Gambar latar login berhasil dihapus.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    button.disabled = false;
  }
}

function renderInfoPage() {
  const profile = state.institutionProfile;
  const fields = [
    ['Nama lembaga', profile?.nama],
    ['Jenis lembaga', profile?.jenis],
    ['Alamat', profile?.alamat],
    ['Telepon', profile?.telepon],
    ['Email', profile?.email],
    ['Situs web', profile?.website],
    ['Visi', profile?.visi],
    ['Misi', profile?.misi],
  ];
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">PROFIL LEMBAGA</p><h1>Informasi Lapas</h1><p>Informasi resmi yang dikelola petugas berwenang.</p></div>${hasWriteAccess() && state.institutionProfileLoaded ? `<button id="institution-profile-button" class="button button-primary" type="button"><span aria-hidden="true">${profile ? '✎' : '＋'}</span>${profile ? 'Edit Profil' : 'Tambah Profil'}</button>` : ''}</div>
    ${!state.institutionProfileLoaded ? '<section class="panel"><div class="loading-state">Memuat profil lembaga...</div></section>' : `
      <section class="panel content-panel institution-profile-panel">
        ${!profile ? '<div class="institution-empty">Profil lembaga belum diisi.</div>' : ''}
        <div class="info-grid">${fields.map(([label, value]) => `<div class="info-item${label === 'Visi' || label === 'Misi' ? ' info-item-wide' : ''}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || 'Belum diisi')}</strong></div>`).join('')}</div>
        ${profile?.updated_at ? `<p class="institution-updated">Terakhir diperbarui: ${escapeHtml(profile.updated_at)}</p>` : ''}
      </section>`}`;

  document.querySelector('#institution-profile-button')?.addEventListener('click', () => openInstitutionProfileModal(profile));
}

function renderUserProfilePage() {
  const profile = state.userProfile;
  pageContent.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">AKUN PENGGUNA</p><h1>Profil Saya</h1><p>Kelola informasi, foto profil, dan kredensial akun yang sedang digunakan.</p></div>${profile ? '<div class="profile-actions"><button id="edit-user-profile-button" class="button button-secondary" type="button"><span aria-hidden="true">✎</span>Edit Profil</button><button id="change-credentials-button" class="button button-primary" type="button">Ubah Username &amp; Password</button></div>' : ''}</div>
    ${!state.userProfileLoaded ? '<section class="panel"><div class="loading-state">Memuat profil...</div></section>' : profile ? `
      <section class="panel content-panel institution-profile-panel">
        <div class="profile-identity">
          <span id="profile-page-avatar" class="profile-identity-avatar">${escapeHtml((profile.name || 'P').trim().charAt(0).toUpperCase())}</span>
          <div class="profile-identity-copy"><h2>${escapeHtml(profile.name)}</h2><p>${escapeHtml(roleName(profile.role))}</p><button id="profile-page-photo-button" class="profile-photo-link" type="button">Ubah foto profil</button></div>
        </div>
        <div class="info-grid user-profile-grid">
          <div class="info-item"><small>Username</small><strong>${escapeHtml(profile.username)}</strong></div>
          <div class="info-item"><small>Role</small><strong>${escapeHtml(roleName(profile.role))}</strong></div>
          <div class="info-item"><small>Email</small><strong>${escapeHtml(profile.email || 'Belum diisi')}</strong></div>
          <div class="info-item"><small>Telepon</small><strong>${escapeHtml(profile.phone || 'Belum diisi')}</strong></div>
          <div class="info-item"><small>Jabatan</small><strong>${escapeHtml(profile.position || 'Belum diisi')}</strong></div>
        </div>
      </section>` : '<section class="panel"><div class="schedule-empty"><strong>Profil akun tidak dapat dimuat.</strong><p>Coba muat ulang halaman atau masuk kembali.</p></div></section>'}`;

  document.querySelector('#edit-user-profile-button')?.addEventListener('click', () => openUserProfileModal(profile));
  document.querySelector('#change-credentials-button')?.addEventListener('click', () => openCredentialsModal(profile));
  document.querySelector('#profile-page-photo-button')?.addEventListener('click', () => document.querySelector('#profile-photo-input').click());
  renderProfileAvatars();
}

async function loadUserProfile() {
  try {
    state.userProfile = await apiRequest('/api/auth/profile');
    const photoResult = await apiRequest('/api/auth/profile/photo');
    state.profilePhoto = photoResult.photo;
    state.user.name = state.userProfile.name;
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    document.querySelector('#user-role').textContent = roleName(state.userProfile.role);
    document.querySelector('#account-menu-role').textContent = roleName(state.userProfile.role);
    renderProfileAvatars();
  } catch (error) {
    state.userProfile = null;
    state.profilePhoto = null;
    showToast(`Profil akun gagal dimuat: ${error.message}`);
  } finally {
    state.userProfileLoaded = true;
    if (state.activePage === 'profile') renderUserProfilePage();
  }
}

async function uploadProfilePhoto(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast('Pilih foto berformat JPEG, PNG, atau WebP.');
    input.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('Ukuran foto maksimal 2 MB.');
    input.value = '';
    return;
  }

  try {
    const photo = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('File foto tidak dapat dibaca.'));
      reader.readAsDataURL(file);
    });
    const result = await apiRequest('/api/auth/profile/photo', {
      method: 'PUT',
      body: JSON.stringify({ photo }),
    });
    state.profilePhoto = result.photo;
    renderProfileAvatars();
    if (state.activePage === 'profile') renderUserProfilePage();
    showToast('Foto profil berhasil diperbarui.');
  } catch (error) {
    showToast(`Foto profil gagal diperbarui: ${error.message}`);
  } finally {
    input.value = '';
  }
}

function openUserProfileModal(profile) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="user-profile-modal-title">
        <div class="modal-header"><div><h2 id="user-profile-modal-title">Edit profil saya</h2><p>Username dan role dikelola administrator.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="user-profile-form" class="modal-form">
          <div class="form-field institution-form-wide"><label for="user-profile-name">Nama</label><input id="user-profile-name" class="field-input" name="name" maxlength="120" required value="${escapeHtml(profile.name || '')}" /></div>
          <div class="form-field"><label for="user-profile-email">Email</label><input id="user-profile-email" class="field-input" name="email" type="email" maxlength="150" value="${escapeHtml(profile.email || '')}" /></div>
          <div class="form-field"><label for="user-profile-phone">Telepon</label><input id="user-profile-phone" class="field-input" name="phone" maxlength="30" value="${escapeHtml(profile.phone || '')}" /></div>
          <div class="form-field institution-form-wide"><label for="user-profile-position">Jabatan</label><input id="user-profile-position" class="field-input" name="position" maxlength="120" value="${escapeHtml(profile.position || '')}" /></div>
          <p id="user-profile-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">Simpan perubahan</button></div>
        </form>
      </section>
    </div>`;
  modalRoot.querySelector('#user-profile-name').focus();
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#user-profile-form').addEventListener('submit', submitUserProfile);
}

async function submitUserProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#user-profile-form-error');
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    const result = await apiRequest('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    state.userProfile = result.user;
    state.user.name = result.user.name;
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    renderProfileAvatars();
    modalRoot.innerHTML = '';
    renderUserProfilePage();
    showToast('Profil berhasil diperbarui.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

function openCredentialsModal(profile) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="credentials-modal-title">
        <div class="modal-header"><div><h2 id="credentials-modal-title">Ubah Username &amp; Password</h2><p>Verifikasi password lama untuk melanjutkan.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="credentials-form" class="modal-form credentials-form">
          <div class="form-field credentials-form-wide"><label for="credentials-username">Username baru</label><input id="credentials-username" class="field-input" name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]+" autocomplete="username" required value="${escapeHtml(profile.username)}" /><small>3–40 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.</small></div>
          <div class="form-field credentials-form-wide"><label for="credentials-current-password">Password lama</label><input id="credentials-current-password" class="field-input" name="current_password" type="password" autocomplete="current-password" required /></div>
          <div class="form-field"><label for="credentials-new-password">Password baru</label><input id="credentials-new-password" class="field-input" name="new_password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required /><small>Minimal 12 karakter.</small></div>
          <div class="form-field"><label for="credentials-confirm-password">Konfirmasi password baru</label><input id="credentials-confirm-password" class="field-input" name="confirm_password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required /></div>
          <p id="credentials-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">Simpan kredensial</button></div>
        </form>
      </section>
    </div>`;
  modalRoot.querySelector('#credentials-current-password').focus();
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#credentials-form').addEventListener('submit', submitCredentials);
}

async function submitCredentials(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#credentials-form-error');
  const values = Object.fromEntries(new FormData(form).entries());
  if (values.new_password !== values.confirm_password) {
    errorNode.textContent = 'Konfirmasi password baru tidak cocok.';
    errorNode.hidden = false;
    return;
  }

  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    const result = await apiRequest('/api/auth/credentials', {
      method: 'PUT',
      body: JSON.stringify(values),
    });
    state.user = { ...state.user, ...result.user };
    state.token = result.token;
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    modalRoot.innerHTML = '';
    await loadUserProfile();
    showToast('Username dan password berhasil diperbarui.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

async function loadInstitutionProfile() {
  try {
    state.institutionProfile = await apiRequest('/api/institution');
  } catch (error) {
    showToast(`Profil lembaga gagal dimuat: ${error.message}`);
  } finally {
    state.institutionProfileLoaded = true;
    if (state.activePage === 'info') renderInfoPage();
  }
}

function openInstitutionProfileModal(profile = null) {
  const isEditing = Boolean(profile);
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal institution-modal" role="dialog" aria-modal="true" aria-labelledby="institution-modal-title">
        <div class="modal-header"><div><h2 id="institution-modal-title">${isEditing ? 'Edit profil lembaga' : 'Tambah profil lembaga'}</h2><p>Isi berdasarkan informasi resmi Lapas.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="institution-form" class="modal-form">
          <div class="form-field"><label for="institution-name">Nama lembaga</label><input id="institution-name" class="field-input" name="nama" maxlength="150" required value="${escapeHtml(profile?.nama || '')}" /></div>
          <div class="form-field"><label for="institution-type">Jenis lembaga</label><input id="institution-type" class="field-input" name="jenis" maxlength="120" value="${escapeHtml(profile?.jenis || '')}" /></div>
          <div class="form-field institution-form-wide"><label for="institution-address">Alamat</label><textarea id="institution-address" class="field-input institution-textarea" name="alamat" maxlength="500">${escapeHtml(profile?.alamat || '')}</textarea></div>
          <div class="form-field"><label for="institution-phone">Telepon</label><input id="institution-phone" class="field-input" name="telepon" maxlength="60" value="${escapeHtml(profile?.telepon || '')}" /></div>
          <div class="form-field"><label for="institution-email">Email</label><input id="institution-email" class="field-input" name="email" type="email" maxlength="150" value="${escapeHtml(profile?.email || '')}" /></div>
          <div class="form-field institution-form-wide"><label for="institution-website">Situs web</label><input id="institution-website" class="field-input" name="website" maxlength="200" placeholder="https://" value="${escapeHtml(profile?.website || '')}" /></div>
          <div class="form-field institution-form-wide"><label for="institution-vision">Visi</label><textarea id="institution-vision" class="field-input institution-textarea" name="visi" maxlength="2000">${escapeHtml(profile?.visi || '')}</textarea></div>
          <div class="form-field institution-form-wide"><label for="institution-mission">Misi</label><textarea id="institution-mission" class="field-input institution-textarea" name="misi" maxlength="2000">${escapeHtml(profile?.misi || '')}</textarea></div>
          <p id="institution-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">${isEditing ? 'Simpan perubahan' : 'Simpan profil'}</button></div>
        </form>
      </section>
    </div>`;
  modalRoot.querySelector('#institution-name').focus();
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#institution-form').addEventListener('submit', submitInstitutionProfile);
}

async function submitInstitutionProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#institution-form-error');
  const data = Object.fromEntries(new FormData(form).entries());
  const isEditing = Boolean(state.institutionProfile);
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    await apiRequest('/api/institution', {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    modalRoot.innerHTML = '';
    await loadInstitutionProfile();
    showToast(isEditing ? 'Profil lembaga berhasil diperbarui.' : 'Profil lembaga berhasil ditambahkan.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

function renderPage() {
  const allowedPages = {
    staff: ['admin'],
    audit: ['admin'],
    'login-settings': ['admin'],
    program: ['admin', 'pembinaan'],
  };
  if (allowedPages[state.activePage] && !allowedPages[state.activePage].includes(state.user?.role)) {
    state.activePage = 'dashboard';
  }
  pageContent.dataset.page = state.activePage;
  document.querySelector('#breadcrumb-current').textContent = pageTitles[state.activePage];
  document.querySelectorAll('.nav-link').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.page === state.activePage);
  });
  if (state.activePage === 'dashboard') renderDashboard();
  if (state.activePage === 'wbp') renderWbpPage();
  if (state.activePage === 'schedules') renderSchedulesPage();
  if (state.activePage === 'progress') renderProgressPage();
  if (state.activePage === 'program') renderProgramPage();
  if (state.activePage === 'staff') renderStaffPage();
  if (state.activePage === 'audit') loadAuditRows();
  if (state.activePage === 'login-settings') loadLoginBackgroundSettings();
  if (state.activePage === 'assistant') renderAssistantPage();
  if (state.activePage === 'info') renderInfoPage();
  if (state.activePage === 'profile') renderUserProfilePage();
}

async function loadWbp() {
  pageContent.innerHTML = '<div class="loading-state">Memuat data yang diizinkan...</div>';
  try {
    state.wbp = await apiRequest('/api/wbp');
    document.querySelector('#nav-wbp-count').textContent = String(state.wbp.length);
    renderPage();
  } catch (error) {
    if (state.token) {
      pageContent.innerHTML = `<div class="notice"><span class="notice-mark" aria-hidden="true">!</span><span>${escapeHtml(error.message)} Periksa koneksi backend atau hak akses akun Anda.</span></div>`;
    }
  }
}

function openWbpModal(person = null) {
  const isEditing = Boolean(person);
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header"><div><h2 id="modal-title">${isEditing ? 'Edit data WBP' : 'Tambah data WBP'}</h2><p>${isEditing ? 'Perbarui informasi WBP yang dipilih.' : 'Isi informasi contoh untuk keperluan pengujian.'}</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <form id="wbp-form" class="modal-form">
          <div class="form-field"><label for="wbp-name">Nama</label><input id="wbp-name" class="field-input" name="nama" required maxlength="120" value="${escapeHtml(person?.nama || '')}" /></div>
          <div class="form-field"><label for="wbp-register">Nomor register</label><input id="wbp-register" class="field-input" name="nomor_register" required maxlength="40" value="${escapeHtml(person?.nomor_register || '')}" /></div>
          <div class="form-field"><label for="wbp-block">Blok</label><input id="wbp-block" class="field-input" name="blok" maxlength="80" value="${escapeHtml(person?.blok || '')}" /></div>
          <div class="form-field"><label for="wbp-program">Program pembinaan</label><input id="wbp-program" class="field-input" name="program" maxlength="120" value="${escapeHtml(person?.program || '')}" /></div>
          <div class="form-field"><label for="wbp-status">Status</label><select id="wbp-status" class="field-select" name="status"><option${person?.status === 'Aktif' ? ' selected' : ''}>Aktif</option><option${person?.status === 'Monitoring' ? ' selected' : ''}>Monitoring</option><option${person?.status === 'Selesai' ? ' selected' : ''}>Selesai</option></select></div>
          <div class="form-field"><label for="wbp-admission-date">Tanggal masuk</label><input id="wbp-admission-date" class="field-input" name="tanggal_masuk" type="date" value="${escapeHtml(person?.tanggal_masuk || '')}" /></div>
          <div class="form-field"><label for="wbp-exit-date">Tanggal keluar</label><input id="wbp-exit-date" class="field-input" name="tanggal_keluar" type="date" value="${escapeHtml(person?.tanggal_keluar || '')}" /></div>
          <p class="form-section-title">Profil pribadi</p>
          <div class="form-field"><label for="wbp-birth-place">Tempat lahir</label><input id="wbp-birth-place" class="field-input" name="tempat_lahir" maxlength="100" value="${escapeHtml(person?.tempat_lahir || '')}" /></div>
          <div class="form-field"><label for="wbp-birth-date">Tanggal lahir</label><input id="wbp-birth-date" class="field-input" name="tanggal_lahir" type="date" value="${escapeHtml(person?.tanggal_lahir || '')}" /></div>
          <div class="form-field"><label for="wbp-gender">Jenis kelamin</label><select id="wbp-gender" class="field-select" name="jenis_kelamin"><option value=""${!person?.jenis_kelamin ? ' selected' : ''}>Pilih jika diketahui</option><option${person?.jenis_kelamin === 'Laki-laki' ? ' selected' : ''}>Laki-laki</option><option${person?.jenis_kelamin === 'Perempuan' ? ' selected' : ''}>Perempuan</option><option${person?.jenis_kelamin === 'Tidak dicatat' ? ' selected' : ''}>Tidak dicatat</option></select></div>
          <div class="form-field"><label for="wbp-nationality">Kewarganegaraan</label><input id="wbp-nationality" class="field-input" name="kewarganegaraan" maxlength="80" value="${escapeHtml(person?.kewarganegaraan || '')}" /></div>
          <div class="form-field"><label for="wbp-education">Pendidikan terakhir</label><input id="wbp-education" class="field-input" name="pendidikan_terakhir" maxlength="100" value="${escapeHtml(person?.pendidikan_terakhir || '')}" /></div>
          <div class="form-field"><label for="wbp-occupation">Pekerjaan sebelumnya</label><input id="wbp-occupation" class="field-input" name="pekerjaan_sebelumnya" maxlength="120" value="${escapeHtml(person?.pekerjaan_sebelumnya || '')}" /></div>
          <div class="form-field"><label for="wbp-origin">Kota asal</label><input id="wbp-origin" class="field-input" name="kota_asal" maxlength="100" value="${escapeHtml(person?.kota_asal || '')}" /></div>
          <p id="wbp-form-error" class="form-error" role="alert" hidden></p>
          <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Batal</button><button class="button button-primary" type="submit">${isEditing ? 'Simpan perubahan' : 'Simpan data'}</button></div>
        </form>
      </section>
    </div>`;
  if (isEditing) modalRoot.querySelector('#wbp-form').dataset.id = String(person.id);
  modalRoot.querySelector('#wbp-name').focus();
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('#wbp-form').addEventListener('submit', submitWbpForm);
}

function openWbpProfile(person) {
  const fields = [
    ['Nomor register', person.nomor_register],
    ['Tempat lahir', person.tempat_lahir],
    ['Tanggal lahir', person.tanggal_lahir],
    ['Jenis kelamin', person.jenis_kelamin],
    ['Kewarganegaraan', person.kewarganegaraan],
    ['Pendidikan terakhir', person.pendidikan_terakhir],
    ['Pekerjaan sebelumnya', person.pekerjaan_sebelumnya],
    ['Kota asal', person.kota_asal],
    ['Blok', person.blok],
    ['Program pembinaan', person.program],
    ['Status', person.status],
    ['Tanggal masuk', person.tanggal_masuk],
    ['Tanggal keluar', person.tanggal_keluar],
  ];
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-dismiss-modal>
      <section class="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div class="modal-header"><div><p class="eyebrow">PROFIL WBP</p><h2 id="profile-title">${escapeHtml(person.nama)}</h2><p>Informasi pribadi dan pembinaan terbatas.</p></div><button class="icon-button" type="button" data-dismiss-modal aria-label="Tutup">×</button></div>
        <div class="profile-grid">${fields.map(([label, value]) => `<div class="profile-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Belum diisi')}</strong></div>`).join('')}</div>
        <div class="profile-disclaimer">Akses profil ini dibatasi untuk admin dan petugas pembinaan. Gunakan hanya sesuai kewenangan.</div>
        <div class="modal-actions"><button class="button button-secondary" type="button" data-dismiss-modal>Tutup</button></div>
      </section>
    </div>`;
  modalRoot.querySelectorAll('[data-dismiss-modal]').forEach((element) => element.addEventListener('click', (event) => {
    if (event.target === element || element.tagName === 'BUTTON') modalRoot.innerHTML = '';
  }));
  modalRoot.querySelector('[data-dismiss-modal][aria-label="Tutup"]').focus();
}

async function submitWbpForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const errorNode = form.querySelector('#wbp-form-error');
  const data = Object.fromEntries(new FormData(form).entries());
  submitButton.disabled = true;
  errorNode.hidden = true;
  try {
    const recordId = form.dataset.id;
    await apiRequest(recordId ? `/api/wbp/${recordId}` : '/api/wbp', {
      method: recordId ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    });
    modalRoot.innerHTML = '';
    state.search = '';
    await loadWbp();
    showToast(recordId ? 'Data WBP berhasil diperbarui.' : 'Data contoh berhasil ditambahkan.');
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    submitButton.disabled = false;
  }
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = document.querySelector('#login-error');
  const submitButton = form.querySelector('[type="submit"]');
  errorNode.hidden = true;
  submitButton.disabled = true;
  try {
    const credentials = Object.fromEntries(new FormData(form).entries());
    const result = await apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
    setSession(result.token, result.user);
    form.reset();
    showApp();
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', () => {
  document.querySelector('#account-menu').hidden = true;
  document.querySelector('#account-menu-toggle').setAttribute('aria-expanded', 'false');
  clearSession();
  showLogin();
});

document.querySelector('#account-menu-toggle').addEventListener('click', (event) => {
  const menu = document.querySelector('#account-menu');
  menu.hidden = !menu.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
});

document.querySelector('#account-profile-button').addEventListener('click', () => {
  document.querySelector('#account-menu').hidden = true;
  document.querySelector('#account-menu-toggle').setAttribute('aria-expanded', 'false');
  state.activePage = 'profile';
  renderPage();
});

document.querySelector('#account-login-settings-button').addEventListener('click', () => {
  if (state.user?.role !== 'admin') return;
  document.querySelector('#account-menu').hidden = true;
  document.querySelector('#account-menu-toggle').setAttribute('aria-expanded', 'false');
  state.activePage = 'login-settings';
  renderPage();
});

document.querySelector('#profile-photo-input').addEventListener('change', uploadProfilePhoto);

pageContent.addEventListener('change', (event) => {
  if (event.target.matches('#login-background-input')) readLoginBackgroundFile(event);
});

document.addEventListener('click', (event) => {
  const menuWrap = document.querySelector('.account-menu-wrap');
  if (!menuWrap.contains(event.target)) {
    document.querySelector('#account-menu').hidden = true;
    document.querySelector('#account-menu-toggle').setAttribute('aria-expanded', 'false');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.querySelector('#account-menu').hidden = true;
    document.querySelector('#account-menu-toggle').setAttribute('aria-expanded', 'false');
  }
});

document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => {
  state.activePage = button.dataset.page;
  state.search = '';
  renderPage();
  document.querySelector('#sidebar').classList.remove('is-open');
  document.querySelector('#menu-toggle').setAttribute('aria-expanded', 'false');
}));

pageContent.addEventListener('click', (event) => {
  if (event.target.closest('#save-login-background')) {
    saveLoginBackground();
    return;
  }
  if (event.target.closest('#delete-login-background')) {
    deleteLoginBackground();
    return;
  }

  const clearAssistantChatButton = event.target.closest('#clear-assistant-chat');
  if (clearAssistantChatButton) {
    if (state.busy) return;
    if (!window.confirm('Hapus semua pertanyaan dan jawaban chat ini?')) return;
    state.assistantMessages = [];
    renderAssistantPage();
    showToast('Semua chat berhasil dihapus.');
    return;
  }

  const deleteAssistantQuestionButton = event.target.closest('[data-delete-assistant-question]');
  if (deleteAssistantQuestionButton) {
    if (state.busy) return;
    const questionIndex = Number(deleteAssistantQuestionButton.dataset.deleteAssistantQuestion);
    if (!Number.isInteger(questionIndex)
      || state.assistantMessages[questionIndex]?.role !== 'user') return;
    if (!window.confirm('Hapus pertanyaan ini beserta jawabannya?')) return;
    const nextQuestionIndex = state.assistantMessages.findIndex(
      (message, index) => index > questionIndex && message.role === 'user'
    );
    const messagesToRemove = nextQuestionIndex < 0
      ? state.assistantMessages.length - questionIndex
      : nextQuestionIndex - questionIndex;
    state.assistantMessages.splice(questionIndex, messagesToRemove);
    renderAssistantPage();
    showToast('Pertanyaan dan jawabannya berhasil dihapus.');
    return;
  }

  const dashboardAction = event.target.closest('[data-dashboard-action="open-progress"]');
  if (dashboardAction) {
    state.activePage = 'progress';
    renderPage();
    openProgressModal();
    return;
  }

  const editProgressButton = event.target.closest('[data-edit-progress]');
  if (editProgressButton) {
    apiRequest(`/api/progress/${Number(editProgressButton.dataset.editProgress)}`)
      .then(openProgressModal)
      .catch((error) => showToast(error.message));
    return;
  }

  const reviewProgressButton = event.target.closest('[data-review-progress]');
  if (reviewProgressButton) {
    if (state.user?.role !== 'admin') return;
    const reviewStatus = reviewProgressButton.dataset.reviewStatus;
    const reviewNote = reviewStatus === 'Perlu revisi'
      ? window.prompt('Jelaskan revisi yang perlu dilakukan:')
      : '';
    if (reviewStatus === 'Perlu revisi' && !reviewNote?.trim()) return;
    reviewProgressButton.disabled = true;
    apiRequest(`/api/progress/${Number(reviewProgressButton.dataset.reviewProgress)}/review`, {
      method: 'POST',
      body: JSON.stringify({ submission_status: reviewStatus, review_note: reviewNote || '' }),
    })
      .then(async () => {
        await loadProgressSummary();
        await loadProgressRows();
        showToast(reviewStatus === 'Disetujui' ? 'Laporan disetujui.' : 'Laporan dikembalikan untuk revisi.');
      })
      .catch((error) => {
        reviewProgressButton.disabled = false;
        showToast(error.message);
      });
    return;
  }

  const deleteProgressButton = event.target.closest('[data-delete-progress]');
  if (deleteProgressButton) {
    if (state.user?.role !== 'admin') return;
    const confirmed = window.confirm('Hapus catatan evaluasi ini secara permanen?');
    if (!confirmed) return;
    deleteProgressButton.disabled = true;
    apiRequest(`/api/progress/${Number(deleteProgressButton.dataset.deleteProgress)}`, { method: 'DELETE' })
      .then(() => loadProgressSummary())
      .then(() => showToast('Catatan evaluasi berhasil dihapus.'))
      .catch((error) => {
        deleteProgressButton.disabled = false;
        showToast(error.message);
      });
    return;
  }

  const editScheduleButton = event.target.closest('[data-edit-schedule]');
  if (editScheduleButton) {
    apiRequest(`/api/schedules/${Number(editScheduleButton.dataset.editSchedule)}`)
      .then(openScheduleModal)
      .catch((error) => showToast(error.message));
    return;
  }

  const executionScheduleButton = event.target.closest('[data-execution-schedule]');
  if (executionScheduleButton) {
    openExecutionModal(Number(executionScheduleButton.dataset.executionSchedule));
    return;
  }

  const deleteScheduleButton = event.target.closest('[data-delete-schedule]');
  if (deleteScheduleButton) {
    if (state.user?.role !== 'admin') return;
    const confirmed = window.confirm('Hapus jadwal kegiatan ini? Tindakan ini tidak dapat dibatalkan.');
    if (!confirmed) return;
    deleteScheduleButton.disabled = true;
    apiRequest(`/api/schedules/${Number(deleteScheduleButton.dataset.deleteSchedule)}`, { method: 'DELETE' })
      .then(async () => {
        await loadSchedulesForDate(state.scheduleDate || getJakartaDate());
        await loadTodaySchedules();
        showToast('Jadwal berhasil dihapus.');
      })
      .catch((error) => {
        deleteScheduleButton.disabled = false;
        showToast(error.message);
      });
    return;
  }

  const editButton = event.target.closest('[data-edit-id]');
  if (editButton) {
    const person = state.wbp.find((record) => record.id === Number(editButton.dataset.editId));
    if (!person) return;
    apiRequest(`/api/wbp/${person.id}`)
      .then((profile) => openWbpModal(profile))
      .catch((error) => showToast(error.message));
    return;
  }

  const deleteButton = event.target.closest('[data-delete-id]');
  if (deleteButton) {
    const person = state.wbp.find((record) => record.id === Number(deleteButton.dataset.deleteId));
    if (!person || state.user?.role !== 'admin') return;
    const confirmed = window.confirm(`Hapus permanen data WBP ${person.nama} (${person.nomor_register})? Tindakan ini tidak dapat dibatalkan.`);
    if (!confirmed) return;
    deleteButton.disabled = true;
    apiRequest(`/api/wbp/${person.id}`, { method: 'DELETE' })
      .then(async () => {
        await loadWbp();
        showToast('Data WBP berhasil dihapus.');
      })
      .catch((error) => {
        deleteButton.disabled = false;
        showToast(error.message);
      });
    return;
  }

  const editProgramButton = event.target.closest('[data-edit-program]');
  if (editProgramButton) {
    const program = state.programs.find((item) => item.id === Number(editProgramButton.dataset.editProgram));
    if (program) openProgramModal(program);
    return;
  }

  const deleteProgramButton = event.target.closest('[data-delete-program]');
  if (deleteProgramButton) {
    if (state.user?.role !== 'admin' || deleteProgramButton.disabled) return;
    const program = state.programs.find((item) => item.id === Number(deleteProgramButton.dataset.deleteProgram));
    if (!program) return;
    const confirmed = window.confirm(`Hapus program "${program.name}"? Tindakan ini tidak dapat dibatalkan.`);
    if (!confirmed) return;
    deleteProgramButton.disabled = true;
    apiRequest(`/api/admin/programs/${program.id}`, { method: 'DELETE' })
      .then(async () => {
        await loadPrograms();
        showToast('Program berhasil dihapus.');
      })
      .catch((error) => {
        deleteProgramButton.disabled = false;
        showToast(error.message);
      });
    return;
  }

  const profileButton = event.target.closest('[data-profile-id]');
  if (profileButton) {
    const person = state.wbp.find((record) => record.id === Number(profileButton.dataset.profileId));
    if (person) {
      apiRequest(`/api/wbp/${person.id}`)
        .then(openWbpProfile)
        .catch((error) => showToast(error.message));
    }
    const editStaffButton = event.target.closest('[data-edit-staff]');
    if (editStaffButton) {
      const staff = state.staff.find((item) => item.id === Number(editStaffButton.dataset.editStaff));
      if (staff) openStaffModal(staff);
      return;
    }
    return;
  }
  const target = event.target.closest('[data-page-link]');
  if (!target) return;
  state.activePage = target.dataset.pageLink;
  state.search = '';
  renderPage();
});

document.querySelector('#menu-toggle').addEventListener('click', (event) => {
  const sidebar = document.querySelector('#sidebar');
  const isOpen = sidebar.classList.toggle('is-open');
  event.currentTarget.setAttribute('aria-expanded', String(isOpen));
});

loadPublicLoginBackground();
if (state.token && state.user) showApp();
else showLogin();