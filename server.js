const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== اتصال قاعدة البيانات ====================
// استخدم رابطك الخاص (ضعه هنا أو عبر متغير البيئة)
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_HGwqC4TJaXD6@ep-dawn-king-a11873v3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }  // ضروري لـ Neon
});

pool.connect((err, client, release) => {
    if (err) return console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.stack);
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
    release();
});

// ==================== Middleware ====================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gravel-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    name: 'gravel.sid'
}));

// ==================== إنشاء الجداول تلقائياً ====================
async function initTables() {
    try {
        // جدول المستخدمين
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                factory TEXT,
                permissions JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // جدول بيانات اليوم (الطلبات والتوزيع)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_data (
                date DATE PRIMARY KEY,
                orders JSONB NOT NULL DEFAULT '[]',
                distribution JSONB NOT NULL DEFAULT '[]'
            );
        `);
        // جدول قيود الحظر (لنستخدمه بدلاً من ملف restrictions.json)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS restrictions (
                id SERIAL PRIMARY KEY,
                truck_number TEXT,
                driver_name TEXT,
                restricted_factories JSONB,
                reason TEXT,
                active BOOLEAN DEFAULT true,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ تم إنشاء الجداول (أو موجودة مسبقاً)');
    } catch (err) {
        console.error('خطأ في إنشاء الجداول:', err);
    }
}
initTables();

// ==================== دوال مساعدة للتعامل مع قاعدة البيانات ====================
async function getDayData(date) {
    const res = await pool.query('SELECT orders, distribution FROM daily_data WHERE date = $1', [date]);
    if (res.rows.length === 0) return { orders: [], distribution: [] };
    return { orders: res.rows[0].orders, distribution: res.rows[0].distribution };
}
async function saveDayData(date, orders, distribution) {
    await pool.query(
        `INSERT INTO daily_data (date, orders, distribution) VALUES ($1, $2, $3)
         ON CONFLICT (date) DO UPDATE SET orders = $2, distribution = $3`,
        [date, orders, distribution]
    );
}
async function getUsers() {
    const res = await pool.query('SELECT id, username, role, factory, permissions, created_at FROM users');
    return res.rows;
}
async function getUserByUsername(username) {
    const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return res.rows[0];
}
async function createUser(username, password, role, factory, permissions) {
    const hashed = await bcrypt.hash(password, 10);
    const res = await pool.query(
        `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [username, hashed, role, factory, permissions]
    );
    return res.rows[0];
}
async function updateUser(id, username, role, factory, permissions, newPassword = null) {
    let query = 'UPDATE users SET username = $1, role = $2, factory = $3, permissions = $4';
    let params = [username, role, factory, permissions];
    if (newPassword) {
        const hashed = await bcrypt.hash(newPassword, 10);
        query += ', password = $5';
        params.push(hashed);
    }
    query += ' WHERE id = $' + (params.length + 1);
    params.push(id);
    await pool.query(query, params);
}
async function deleteUser(id) {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
}
async function getRestrictions() {
    const res = await pool.query('SELECT * FROM restrictions ORDER BY created_at DESC');
    return res.rows;
}
async function addRestriction(truckNumber, driverName, restrictedFactories, reason, createdBy) {
    const res = await pool.query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, createdBy]
    );
    return res.rows[0];
}
async function updateRestriction(id, active) {
    await pool.query('UPDATE restrictions SET active = $1 WHERE id = $2', [active, id]);
}
async function deleteRestriction(id) {
    await pool.query('DELETE FROM restrictions WHERE id = $1', [id]);
}
// ==================== تهيئة البيانات الافتراضية (المستخدمين، المصانع، السيارات) ====================
async function seedInitialData() {
    // 1. المستخدم Admin
    const adminExists = await getUserByUsername('Admin');
    if (!adminExists) {
        const hashed = await bcrypt.hash('Live#5050', 10);
        await pool.query(
            `INSERT INTO users (username, password, role, permissions) VALUES ($1, $2, $3, $4)`,
            ['Admin', hashed, 'admin', JSON.stringify({
                viewOrders: true, addOrders: true, editOrders: true, deleteOrders: true,
                viewDistribution: true, manageDistribution: true, viewTrucks: true, manageTrucks: true,
                viewReports: true, exportReports: true, viewSettings: true, manageSettings: true,
                viewBackup: true, manageBackup: true, manageUsers: true, manageRestrictions: true
            })]
        );
        console.log('✅ تم إنشاء المستخدم Admin');
    }

    // 2. المستخدمين الإضافيين (hassan, GM, ...)
    const extraUsers = [
        { username: 'hassan', password: '305075', role: 'user' },
        { username: 'Abu Naji', password: '987654', role: 'user' },
        { username: 'GM', password: 'GmDR@2026', role: 'user' },
        { username: 'DrH', password: 'Account@2026', role: 'user' },
        { username: 'Kasara', password: '20102026', role: 'user' }
    ];
    for (const u of extraUsers) {
        const exists = await getUserByUsername(u.username);
        if (!exists) {
            const hashed = await bcrypt.hash(u.password, 10);
            await pool.query(
                `INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`,
                [u.username, hashed, u.role]
            );
            console.log(`✅ تم إنشاء المستخدم ${u.username}`);
        }
    }

    // 3. عملاء المصانع (12 مستخدم)
    const clientUsers = [
        { username: 'scccl_client', password: 'SCCCL@2025', factory: 'SCCCL' },
        { username: 'alharith_client', password: 'ALHarith@2025', factory: 'الحارث للمنتجات الاسمنيه' },
        { username: 'alharithi_old', password: 'Harithi@2025', factory: 'الحارثي القديم' },
        { username: 'almoajal', password: 'Moajal@2025', factory: 'المعجل لمنتجات الاسمنت' },
        { username: 'alharith_aziziyah', password: 'Aziziyah@2025', factory: 'الحارث العزيزية' },
        { username: 'sarmex', password: 'Sarmex@2025', factory: 'سارمكس النظيم' },
        { username: 'abrkhalij', password: 'Khalij@2025', factory: 'عبر الخليج' },
        { username: 'alkifah', password: 'Kifah@2025', factory: 'الكفاح للخرسانة الجاهزة' },
        { username: 'qais3', password: 'Qais3@2025', factory: 'القيشان 3' },
        { username: 'qais2', password: 'Qais2@2025', factory: 'القيشان 2 - الأحجار الشرقية' },
        { username: 'qais1', password: 'Qais1@2025', factory: 'القيشان 1' },
        { username: 'alfahad', password: 'Fahad@2025', factory: 'الفهد للبلوك والخرسانة' }
    ];
    for (const c of clientUsers) {
        const exists = await getUserByUsername(c.username);
        if (!exists) {
            const hashed = await bcrypt.hash(c.password, 10);
            await pool.query(
                `INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)`,
                [c.username, hashed, 'client', c.factory]
            );
            console.log(`✅ تم إنشاء مستخدم العميل ${c.username}`);
        }
    }
}
seedInitialData();

// ==================== Routes API ====================
app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مصرح' });
    res.json({ user: req.session.user });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        factory: user.factory,
        permissions: user.permissions
    };
    res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ==================== إعدادات المصانع والمواد والمركبات ====================
// سنخزنها في قاعدة البيانات أيضاً، لكن للتبسيط نعيد القيم الافتراضية من كود ثابت
app.get('/api/settings', (req, res) => {
    const defaultSettings = {
        factories: [
            { name: 'SCCCL', location: 'الدمام' }, { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' },
            { name: 'الحارثي القديم', location: 'الدمام' }, { name: 'المعجل لمنتجات الاسمنت', location: 'الدمام' },
            { name: 'الحارث العزيزية', location: 'الدمام' }, { name: 'سارمكس النظيم', location: 'الرياض' },
            { name: 'عبر الخليج', location: 'الرياض' }, { name: 'الكفاح للخرسانة الجاهزة', location: 'الدمام' },
            { name: 'القيشان 3', location: 'الدمام' }, { name: 'القيشان 2 - الأحجار الشرقية', location: 'الدمام' },
            { name: 'القيشان 1', location: 'الدمام' }, { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
        ],
        materials: ['3/4', '3/8', '3/16'],
        trucks: []  // يمكن إضافة السيارات لاحقاً من صفحة الإعدادات
    };
    res.json(defaultSettings);
});

app.put('/api/settings', async (req, res) => {
    // هنا يمكن حفظ الإعدادات في جدول settings إذا أردت
    res.json({ success: true });
});

// ==================== الطلبات والتوزيع اليومي ====================
app.get('/api/day/:date', async (req, res) => {
    const data = await getDayData(req.params.date);
    res.json(data);
});

app.put('/api/day/:date', async (req, res) => {
    const { orders, distribution } = req.body;
    await saveDayData(req.params.date, orders, distribution);
    res.json({ success: true });
});

// ==================== المستخدمين (للمدير فقط) ====================
app.get('/api/users', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const users = await getUsers();
    res.json(users);
});

app.post('/api/users', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { username, password, role, factory, permissions } = req.body;
    const existing = await getUserByUsername(username);
    if (existing) return res.status(400).json({ error: 'اسم المستخدم موجود' });
    await createUser(username, password, role, factory, permissions);
    res.json({ success: true });
});

app.put('/api/users/:id', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    await updateUser(id, username, role, factory, permissions, password);
    res.json({ success: true });
});

app.delete('/api/users/:id', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    await deleteUser(id);
    res.json({ success: true });
});

// ==================== قيود الحظر ====================
app.get('/api/restrictions', async (req, res) => {
    const restrictions = await getRestrictions();
    res.json(restrictions);
});

app.post('/api/restrictions', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    const newRestriction = await addRestriction(truckNumber, driverName, restrictedFactories, reason, req.session.user.username);
    res.json(newRestriction);
});

app.put('/api/restrictions/:id', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active } = req.body;
    await updateRestriction(id, active);
    res.json({ success: true });
});

app.delete('/api/restrictions/:id', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    await deleteRestriction(id);
    res.json({ success: true });
});

// ==================== التقارير (للمدير فقط) ====================
app.get('/api/reports', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let allDistributions = [], dailyData = {}, driverStats = {}, factoryStats = {}, materialStats = {};
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dayData = await getDayData(dateStr);
        if (dayData.distribution?.length) {
            dailyData[dateStr] = dayData.distribution.length;
            dayData.distribution.forEach(dist => {
                dist.date = dateStr;
                allDistributions.push(dist);
                const key = dist.truck.number;
                if (!driverStats[key]) driverStats[key] = { number: key, driver: dist.truck.driver, total: 0 };
                driverStats[key].total++;
                if (!factoryStats[dist.factory]) factoryStats[dist.factory] = { name: dist.factory, total: 0 };
                factoryStats[dist.factory].total++;
                if (!materialStats[dist.material]) materialStats[dist.material] = { name: dist.material, total: 0 };
                materialStats[dist.material].total++;
            });
        }
    }
    res.json({ allDistributions, dailyData, driverStats, factoryStats, materialStats, startDate, endDate });
});

// ==================== النسخ الاحتياطي (للمدير فقط) ====================
app.get('/api/backup', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const users = await getUsers();
    const restrictions = await getRestrictions();
    const days = {};
    // يمكن إضافة جميع الأيام الموجودة في قاعدة البيانات (اختياري)
    res.json({ users, restrictions, days, exportDate: new Date().toISOString() });
});

app.post('/api/restore', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    // استعادة البيانات من ملف JSON
    res.json({ success: true });
});

app.delete('/api/clear-all', async (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await pool.query('DELETE FROM daily_data');
    await pool.query('DELETE FROM restrictions');
    // لا تحذف المستخدمين
    res.json({ success: true });
});

// ==================== صفحات HTML (حماية) ====================
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/', (req, res) => {
    if (req.session.user) res.redirect('/index.html');
    else res.redirect('/login.html');
});
const protectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html'];
protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (req.session.user) res.sendFile(path.join(__dirname, page));
        else res.redirect('/login.html');
    });
});
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if ([...protectedPages, 'login.html'].includes(base)) res.status(404).end();
    }
}));

// ==================== تشغيل السيرفر ====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
