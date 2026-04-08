const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); // إضافة مكتبة CORS

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// ==================== مسارات الواجهة ====================
// تأكد أن ملفات الـ HTML موجودة مباشرة في المجلد الرئيسي أو داخل public
const PUBLIC_DIR = path.join(__dirname, 'public');

// ==================== Middleware ====================
app.use(cors({
    origin: true, // السماح لجميع النطاقات أو حدد رابط الـ Frontend الخاص بك
    credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ملفات ثابتة (CSS/JS/HTML)
app.use(express.static(PUBLIC_DIR));
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));

// ==================== Session ====================
const isProd = process.env.NODE_ENV === 'production';

app.use(session({
  secret: process.env.SESSION_SECRET || 'fleet-management-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,      // يجب أن يكون true عند استخدام HTTPS (مثل Render)
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax', // مهم جداً لعمل الكوكيز عند رفع الموقع
    maxAge: 24 * 60 * 60 * 1000 // يوم واحد
  }
}));

// ==================== المجلدات (البيانات) ====================
const DATA_DIR = path.join(__dirname, 'data');
const DAYS_DIR = path.join(DATA_DIR, 'days');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DAYS_DIR)) fs.mkdirSync(DAYS_DIR, { recursive: true });

// ==================== Helpers ====================
function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  return null;
}

function writeJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

function readDayData(date) {
  const filepath = path.join(DAYS_DIR, `${date}.json`);
  if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  return { orders: [], distribution: [] };
}

function writeDayData(date, data) {
  const filepath = path.join(DAYS_DIR, `${date}.json`);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

function addLog(user, action, details = '') {
  let logs = readJSON('logs.json') || [];
  logs.unshift({
    id: Date.now(),
    user,
    action,
    details,
    timestamp: new Date().toISOString()
  });
  logs = logs.slice(0, 500);
  writeJSON('logs.json', logs);
}

// ==================== تهيئة البيانات الافتراضية ====================
function initializeData() {
  if (!readJSON('users.json')) {
    const adminPassword = bcrypt.hashSync('admin123', 10);
    writeJSON('users.json', [{
      id: 1,
      username: 'Admin',
      password: adminPassword,
      role: 'admin',
      permissions: {
        viewOrders: true, addOrders: true, editOrders: true, deleteOrders: true,
        viewDistribution: true, manageDistribution: true,
        viewTrucks: true, manageTrucks: true,
        viewReports: true, exportReports: true,
        viewSettings: true, manageSettings: true,
        viewBackup: true, manageBackup: true,
        manageUsers: true, manageRestrictions: true
      },
      createdAt: new Date().toISOString()
    }]);
    console.log('✅ تم إنشاء حساب المدير: Admin / admin123');
  }
  if (!readJSON('restrictions.json')) writeJSON('restrictions.json', []);
  if (!readJSON('logs.json')) writeJSON('logs.json', []);
}
initializeData();

// ==================== Auth Middlewares ====================
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'غير مصرح، يرجى تسجيل الدخول' });
}

// ==================== API: Auth ====================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = readJSON('users.json') || [];
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());

  if (!user) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خطأ' });

  const ok = bcrypt.compareSync(String(password || ''), user.password);
  if (!ok) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خطأ' });

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    permissions: user.permissions
  };

  addLog(user.username, 'تسجيل دخول');
  return res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  const u = req.session?.user?.username;
  if (u) addLog(u, 'تسجيل خروج');
  req.session.destroy();
  res.clearCookie('connect.sid');
  return res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ user: req.session.user });
  }
  res.status(401).json({ error: 'غير مسجل' });
});

// ==================== API: Users ====================
app.get('/api/users', requireAuth, (req, res) => {
  const users = readJSON('users.json') || [];
  const safeUsers = users.map(({password, ...u}) => u);
  res.json(safeUsers);
});

app.post('/api/users', requireAuth, (req, res) => {
  const { username, password, role, permissions } = req.body;
  const users = readJSON('users.json') || [];

  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
  }

  const newUser = {
    id: Date.now(),
    username,
    password: bcrypt.hashSync(password, 10),
    role,
    permissions,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeJSON('users.json', users);
  addLog(req.session.user.username, 'إضافة مستخدم', username);
  res.json({ success: true });
});

app.put('/api/users/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { username, password, role, permissions } = req.body;
  const users = readJSON('users.json') || [];
  const idx = users.findIndex(u => u.id === id);

  if (idx === -1) return res.status(404).json({ error: 'المستخدم غير موجود' });

  users[idx].username = username;
  users[idx].role = role;
  users[idx].permissions = permissions;
  if (password) users[idx].password = bcrypt.hashSync(password, 10);

  writeJSON('users.json', users);
  addLog(req.session.user.username, 'تعديل مستخدم', username);
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  let users = readJSON('users.json') || [];
  const user = users.find(u => u.id === id);

  if (!user || user.username === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف هذا المستخدم' });

  users = users.filter(u => u.id !== id);
  writeJSON('users.json', users);
  addLog(req.session.user.username, 'حذف مستخدم', user.username);
  res.json({ success: true });
});

// ==================== API: Day Data ====================
app.get('/api/day/:date', requireAuth, (req, res) => {
  res.json(readDayData(req.params.date));
});

app.put('/api/day/:date', requireAuth, (req, res) => {
  writeDayData(req.params.date, req.body);
  res.json({ success: true });
});

// ==================== API: Settings & Restrictions & Logs ====================
app.get('/api/settings', requireAuth, (req, res) => res.json(readJSON('settings.json')));
app.put('/api/settings', requireAuth, (req, res) => {
  writeJSON('settings.json', req.body);
  addLog(req.session.user.username, 'تحديث الإعدادات');
  res.json({ success: true });
});

app.get('/api/restrictions', requireAuth, (req, res) => res.json(readJSON('restrictions.json')));
app.post('/api/restrictions', requireAuth, (req, res) => {
  const restrictions = readJSON('restrictions.json') || [];
  const newR = { id: Date.now(), ...req.body, createdAt: new Date().toISOString() };
  restrictions.push(newR);
  writeJSON('restrictions.json', restrictions);
  res.json({ success: true });
});

app.delete('/api/restrictions/:id', requireAuth, (req, res) => {
  let restrictions = readJSON('restrictions.json') || [];
  restrictions = restrictions.filter(r => r.id !== parseInt(req.params.id));
  writeJSON('restrictions.json', restrictions);
  res.json({ success: true });
});

app.get('/api/logs', requireAuth, (req, res) => {
    const logs = readJSON('logs.json') || [];
    res.json(logs.slice(0, 100));
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
