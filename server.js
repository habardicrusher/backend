const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt'); // npm install bcrypt

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const USERS_FILE = path.join(__dirname, 'users.json'); // ملف المستخدمين

(async () => {
    try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch(e) {}
})();

app.use(express.json());
app.use(express.static(__dirname)); // خدمة الملفات الثابتة من الجذر
app.use(session({
    secret: 'كسارة_الحبردي_سر_آمن',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ==================== دوال مساعدة ====================
let cachedSettings = null;
let settingsLastLoaded = null;

async function loadSettings() {
    if (cachedSettings && settingsLastLoaded && (Date.now() - settingsLastLoaded) < 5 * 60 * 1000) {
        return cachedSettings;
    }
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf8');
        cachedSettings = JSON.parse(data);
        settingsLastLoaded = Date.now();
        return cachedSettings;
    } catch (err) {
        console.warn('فشل تحميل الإعدادات، استخدام قيم فارغة');
        return { trucks: [], factories: [] };
    }
}

async function getDayData(date) {
    const filePath = path.join(DATA_DIR, `${date}.json`);
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return { orders: [], distribution: [] };
        throw err;
    }
}

async function saveDayData(date, data) {
    const filePath = path.join(DATA_DIR, `${date}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ==================== إدارة المستخدمين ====================
async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        // إنشاء مستخدمين افتراضيين إذا لم يكن الملف موجوداً
        const defaultUsers = {
            "admin": { password: await bcrypt.hash("admin", 10), role: "admin" },
            "user": { password: await bcrypt.hash("user", 10), role: "user" },
            "client": { password: await bcrypt.hash("client", 10), role: "client" }
        };
        await fs.writeFile(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
        return defaultUsers;
    }
}

// ==================== Endpoints ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// تسجيل الدخول
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
        }
        const users = await loadUsers();
        const user = users[username];
        if (!user) {
            return res.status(401).json({ error: 'اسم مستخدم أو كلمة مرور غير صحيحة' });
        }
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'اسم مستخدم أو كلمة مرور غير صحيحة' });
        }
        req.session.userId = username;
        req.session.role = user.role;
        res.json({ success: true, role: user.role });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ داخلي في الخادم' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (req.session.userId) {
        res.json({ user: { id: req.session.userId, role: req.session.role } });
    } else {
        res.status(401).json({ error: 'غير مصرح' });
    }
});

app.get('/api/settings', async (req, res) => {
    const settings = await loadSettings();
    res.json(settings);
});

app.get('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    const data = await getDayData(date);
    res.json(data);
});

app.put('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    await saveDayData(date, req.body);
    res.json({ success: true });
});

app.get('/api/range/:startDate/:endDate', async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start) || isNaN(end)) {
            return res.status(400).json({ error: 'تواريخ غير صالحة' });
        }
        const dates = [];
        let current = new Date(start);
        while (current <= end) {
            dates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
        }
        const results = {};
        for (const date of dates) {
            results[date] = await getDayData(date);
        }
        res.json(results);
    } catch (error) {
        console.error('خطأ في /api/range:', error);
        res.status(500).json({ error: 'خطأ داخلي في الخادم' });
    }
});

app.listen(PORT, () => {
    console.log(`الخادم يعمل على http://localhost:${PORT}`);
    console.log(`المستخدمين الافتراضيين: admin/admin, user/user, client/client`);
});