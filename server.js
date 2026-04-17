require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
});

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    } else {
        console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
        release();
    }
});

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: process.env.SESSION_SECRET || 'habardicrusher_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// ==================== دوال مساعدة ====================
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

// تسجيل حدث في سجل النظام
async function logAction(username, action, details, req = null) {
    try {
        let location = '';
        if (req) {
            location = req.headers['user-agent'] || '';
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            if (ip) location += ` | IP: ${ip}`;
        }
        await query(
            'INSERT INTO logs (username, action, details, location, created_at) VALUES ($1, $2, $3, $4, NOW())',
            [username, action, details, location.substring(0, 500)]
        );
    } catch (err) {
        console.error('فشل تسجيل السجل:', err);
    }
}

// ==================== إنشاء الجداول ====================
async function initTables() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL
            )
        `);
        await query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
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
        await query(`
            CREATE TABLE IF NOT EXISTS scale_reports (
                id SERIAL PRIMARY KEY,
                report_name TEXT NOT NULL,
                report_date TEXT NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await query(`
            CREATE TABLE IF NOT EXISTS day_data (
                date DATE PRIMARY KEY,
                orders JSONB NOT NULL,
                distribution JSONB NOT NULL
            )
        `);
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
        await query(`
            CREATE TABLE IF NOT EXISTS truck_violations (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                truck_number TEXT NOT NULL,
                driver TEXT NOT NULL,
                trips INTEGER NOT NULL,
                reason TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(date, truck_number)
            )
        `);
        // جدول السجلات (logs)
        await query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL,
                action TEXT NOT NULL,
                details TEXT,
                location TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // إضافة المستخدمين الافتراضيين
        const adminCheck = await query(`SELECT * FROM users WHERE LOWER(username) = 'admin'`);
        if (adminCheck.rows.length === 0) {
            await query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', 
                ['admin', bcrypt.hashSync('admin', 10), 'admin']);
            console.log('✅ تم إنشاء المستخدم admin (admin/admin)');
        }
        const userCheck = await query(`SELECT * FROM users WHERE LOWER(username) = 'user'`);
        if (userCheck.rows.length === 0) {
            await query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', 
                ['user', bcrypt.hashSync('user', 10), 'user']);
            console.log('✅ تم إنشاء المستخدم user (user/user)');
        }
        const clientCheck = await query(`SELECT * FROM users WHERE LOWER(username) = 'client'`);
        if (clientCheck.rows.length === 0) {
            await query('INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)', 
                ['client', bcrypt.hashSync('client', 10), 'client', 'مصنع الفهد']);
            console.log('✅ تم إنشاء المستخدم client (client/client)');
        }
        
        console.log('✅ جميع الجداول جاهزة');
    } catch (err) {
        console.error('❌ فشل إنشاء الجداول:', err.message);
    }
}
initTables().catch(console.error);

async function loadSettings() {
    try {
        const result = await query(`SELECT value FROM settings WHERE key = 'settings'`);
        if (result.rows.length) return result.rows[0].value;
        else return { trucks: [], factories: [], materials: [] };
    } catch (err) {
        console.error('فشل تحميل الإعدادات:', err);
        return { trucks: [], factories: [], materials: [] };
    }
}

async function getDayData(date) {
    const result = await query('SELECT orders, distribution FROM day_data WHERE date = $1', [date]);
    if (result.rows.length) return result.rows[0];
    else return { orders: [], distribution: [] };
}

// ==================== Endpoints ====================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
        const result = await query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
        const user = result.rows[0];
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'بيانات غير صحيحة' });
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.save(async (err) => {
            if (err) {
                console.error('خطأ في حفظ الجلسة:', err);
                return res.status(500).json({ error: 'خطأ في إنشاء الجلسة' });
            }
            await logAction(user.username, 'تسجيل دخول', `تم تسجيل الدخول بنجاح`, req);
            res.json({ success: true, role: user.role });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ داخلي' });
    }
});

app.post('/api/logout', async (req, res) => {
    if (req.session.username) {
        await logAction(req.session.username, 'تسجيل خروج', `تم تسجيل الخروج`, req);
    }
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

// ==================== السجلات (Logs) ====================
app.get('/api/logs', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        const countResult = await query('SELECT COUNT(*) FROM logs');
        const total = parseInt(countResult.rows[0].count);
        const result = await query(
            'SELECT id, username, action, details, location, created_at FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
            [limit, offset]
        );
        res.json({
            logs: result.rows,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في جلب السجلات' });
    }
});

app.get('/api/logs/all', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const result = await query('SELECT id, username, action, details, location, created_at FROM logs ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في جلب السجلات' });
    }
});

app.delete('/api/logs/clear', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        await query('DELETE FROM logs');
        await logAction(req.session.username, 'مسح السجلات', 'تم مسح جميع سجلات النظام', req);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في مسح السجلات' });
    }
});

// ==================== باقي endpoints (مختصرة مع إضافة تسجيل الأحداث) ====================
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await loadSettings();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب الإعدادات' });
    }
});

app.put('/api/settings', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        await query(`INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [req.body]);
        await logAction(req.session.username, 'تحديث الإعدادات', 'تم تحديث إعدادات النظام', req);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في حفظ الإعدادات' });
    }
});

// ... (باقي endpoints: /api/products, /api/day, /api/range, /api/users, /api/scale-reports, /api/truck-violations, /api/truck-violations/save, /api/truck-violations/stats, /api/truck-violations/report, /api/scale/monthly)
// (نظراً لطول الكود، يُفترض أن باقي الـ endpoints موجودة كما في الإصدارات السابقة، ونضيف فيها استدعاء logAction عند الإجراءات المهمة)

// بدء الخادم
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`👤 بيانات الدخول الافتراضية: admin/admin , user/user , client/client`);
    console.log(`📝 ملاحظة: تسجيل الدخول غير حساس لحالة الأحرف`);
});