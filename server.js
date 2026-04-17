require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// إعداد اتصال قاعدة البيانات مع إعادة محاولة الاتصال
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
});

// اختبار الاتصال بقاعدة البيانات عند بدء التشغيل
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    } else {
        console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
        release();
    }
});

app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: process.env.SESSION_SECRET || 'habardicrusher_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ==================== دوال مساعدة مع تحسين الأخطاء ====================
async function query(text, params) {
    try {
        const start = Date.now();
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (duration > 1000) console.warn(`⚠️ استعلام بطيء (${duration}ms): ${text.substring(0, 100)}`);
        return res;
    } catch (err) {
        console.error('❌ خطأ في الاستعلام:', err.message);
        console.error('الاستعلام:', text);
        console.error('المعلمات:', params);
        throw err;
    }
}

// ==================== إنشاء الجداول (مع التحقق من وجودها) ====================
async function initTables() {
    try {
        // جدول الإعدادات
        await query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL
            )
        `);
        // جدول المنتجات
        await query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        // جدول بيانات الميزان الشهرية
        await query(`
            CREATE TABLE IF NOT EXISTS scale_data (
                id SERIAL PRIMARY KEY,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                data JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(year, month)
            )
        `);
        // جدول التقارير المحفوظة
        await query(`
            CREATE TABLE IF NOT EXISTS scale_reports (
                id SERIAL PRIMARY KEY,
                report_name TEXT NOT NULL,
                report_date TEXT NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        // جدول بيانات اليوم (الطلبات والتوزيع) - الأهم لصفحة الطلبات
        await query(`
            CREATE TABLE IF NOT EXISTS day_data (
                date DATE PRIMARY KEY,
                orders JSONB NOT NULL,
                distribution JSONB NOT NULL
            )
        `);
        // جدول المستخدمين
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                factory TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // إضافة المستخدمين الافتراضيين إذا لم يوجد أحد
        const userCount = await query('SELECT COUNT(*) FROM users');
        if (parseInt(userCount.rows[0].count) === 0) {
            await query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['admin', bcrypt.hashSync('admin', 10), 'admin']);
            await query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['user', bcrypt.hashSync('user', 10), 'user']);
            await query('INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)', ['client', bcrypt.hashSync('client', 10), 'client', 'مصنع الفهد']);
            console.log('✅ تم إنشاء المستخدمين الافتراضيين');
        }
        console.log('✅ جميع الجداول جاهزة');
    } catch (err) {
        console.error('❌ فشل إنشاء الجداول:', err.message);
    }
}

// تشغيل تهيئة الجداول
initTables().catch(console.error);

// ==================== Endpoints ====================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
        const result = await query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user || !bcrypt.compareSync(password, user.password)) 
            return res.status(401).json({ error: 'بيانات غير صحيحة' });
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        res.json({ success: true, role: user.role });
    } catch (err) {
        console.error('خطأ في /api/login:', err);
        res.status(500).json({ error: 'خطأ داخلي في الخادم' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مصرح' });
    try {
        const result = await query('SELECT id, username, role FROM users WHERE id = $1', [req.session.userId]);
        if (!result.rows.length) return res.status(401).json({ error: 'غير مصرح' });
        res.json({ user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'خطأ داخلي' });
    }
});

// ==================== الإعدادات ====================
app.get('/api/settings', async (req, res) => {
    try {
        const result = await query(`SELECT value FROM settings WHERE key = 'settings'`);
        if (result.rows.length) res.json(result.rows[0].value);
        else res.json({ trucks: [], factories: [], materials: [] });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب الإعدادات' });
    }
});

app.put('/api/settings', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        await query(`INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [req.body]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في حفظ الإعدادات' });
    }
});

// ==================== المنتجات ====================
app.get('/api/products', async (req, res) => {
    try {
        const result = await query('SELECT name FROM products ORDER BY id');
        res.json(result.rows.map(r => r.name));
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب المنتجات' });
    }
});

app.post('/api/products', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });
        await query('INSERT INTO products (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في إضافة المنتج' });
    }
});

app.delete('/api/products/:name', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const { name } = req.params;
        await query('DELETE FROM products WHERE name = $1', [name]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في حذف المنتج' });
    }
});

// ==================== بيانات اليوم (المشكلة الأساسية) ====================
app.get('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const result = await query('SELECT orders, distribution FROM day_data WHERE date = $1', [date]);
        if (result.rows.length) {
            res.json(result.rows[0]);
        } else {
            // إذا لم يكن هناك بيانات لذلك اليوم، نعيد كائن فارغ
            res.json({ orders: [], distribution: [] });
        }
    } catch (err) {
        console.error(`❌ خطأ في /api/day/${date}:`, err);
        res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }
});

app.put('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    const { orders, distribution } = req.body;
    try {
        await query(`INSERT INTO day_data (date, orders, distribution) VALUES ($1, $2, $3) ON CONFLICT (date) DO UPDATE SET orders = $2, distribution = $3`, [date, orders, distribution]);
        res.json({ success: true });
    } catch (err) {
        console.error(`❌ خطأ في PUT /api/day/${date}:`, err);
        res.status(500).json({ error: 'خطأ في حفظ البيانات' });
    }
});

// ==================== باقي endpoints (المستخدمين، التقارير، إلخ) ====================
// ... (أضف بقية endpoints من الإصدار السابق كما هي، لكن مع try-catch)

// بدء الخادم
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`👤 بيانات الدخول: admin/admin , user/user , client/client`);
});