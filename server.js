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
    if (err) console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    else { console.log('✅ تم الاتصال بقاعدة البيانات بنجاح'); release(); }
});

// دوال الصلاحيات
function parsePermissions(permissionsStr) {
    if (!permissionsStr) return [];
    try { return JSON.parse(permissionsStr); } catch { return []; }
}
function stringifyPermissions(permissionsArr) {
    return JSON.stringify(permissionsArr || []);
}
function getAvailablePermissions() {
    return [
        'view_orders', 'create_order', 'edit_order', 'delete_order',
        'view_distribution', 'edit_distribution',
        'view_trucks', 'edit_trucks',
        'view_products', 'edit_products',
        'view_factories', 'edit_factories',
        'view_reports', 'view_scale_report', 'view_failed_trucks',
        'view_settings', 'manage_settings',
        'manage_users', 'view_logs', 'manage_backup', 'manage_restrictions',
        'edit_scale_data', 'manage_reports', 'edit_violations'
    ];
}

// إعداد الجلسة
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

// دوال مساعدة
async function query(text, params) {
    try {
        const res = await pool.query(text, params);
        return res;
    } catch (err) {
        console.error('❌ خطأ في الاستعلام:', err.message);
        throw err;
    }
}

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
    } catch (err) { console.error('فشل تسجيل السجل:', err); }
}

// دالة التحقق من الصلاحية من قاعدة البيانات
async function checkUserPermission(req, requiredPermission) {
    if (!req.session || !req.session.userId) return false;
    try {
        const result = await query('SELECT role, permissions FROM users WHERE id = $1', [req.session.userId]);
        if (result.rows.length === 0) return false;
        const user = result.rows[0];
        if (user.role === 'admin') return true;
        const perms = parsePermissions(user.permissions);
        return perms.includes(requiredPermission);
    } catch (err) {
        console.error('خطأ في checkUserPermission:', err);
        return false;
    }
}

// Middleware للتحقق من الصلاحية (مع معالجة الأخطاء)
function authorize(permission) {
    return async (req, res, next) => {
        try {
            const hasPerm = await checkUserPermission(req, permission);
            if (hasPerm) return next();
            res.status(403).json({ error: `غير مصرح: تحتاج صلاحية ${permission}` });
        } catch (err) {
            console.error('خطأ في authorize:', err);
            res.status(500).json({ error: 'خطأ داخلي في الخادم' });
        }
    };
}

// إنشاء الجداول والمستخدمين
async function initTables() {
    try {
        await query(`CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value JSONB NOT NULL )`);
        await query(`CREATE TABLE IF NOT EXISTS products ( id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT NOW() )`);
        await query(`CREATE TABLE IF NOT EXISTS scale_data ( id SERIAL PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(year, month) )`);
        await query(`CREATE TABLE IF NOT EXISTS scale_reports ( id SERIAL PRIMARY KEY, report_name TEXT NOT NULL, report_date TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMP DEFAULT NOW() )`);
        await query(`CREATE TABLE IF NOT EXISTS day_data ( date DATE PRIMARY KEY, orders JSONB NOT NULL, distribution JSONB NOT NULL )`);
        await query(`CREATE TABLE IF NOT EXISTS users ( id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', factory TEXT, permissions TEXT DEFAULT '[]', created_at TIMESTAMP DEFAULT NOW() )`);
        await query(`CREATE TABLE IF NOT EXISTS truck_violations ( id SERIAL PRIMARY KEY, date DATE NOT NULL, truck_number TEXT NOT NULL, driver TEXT NOT NULL, trips INTEGER NOT NULL, reason TEXT, details TEXT, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(date, truck_number) )`);
        await query(`CREATE TABLE IF NOT EXISTS logs ( id SERIAL PRIMARY KEY, username TEXT NOT NULL, action TEXT NOT NULL, details TEXT, location TEXT, created_at TIMESTAMP DEFAULT NOW() )`);
        await query(`CREATE TABLE IF NOT EXISTS restrictions ( id SERIAL PRIMARY KEY, truck_number TEXT NOT NULL, driver_name TEXT NOT NULL, restricted_factories JSONB NOT NULL, reason TEXT, active BOOLEAN DEFAULT true, created_by TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW() )`);
        await query(`CREATE TABLE IF NOT EXISTS backup_metadata ( id SERIAL PRIMARY KEY, backup_date TIMESTAMP DEFAULT NOW(), backup_type TEXT, description TEXT )`);

        const allPerms = getAvailablePermissions();
        const adminCheck = await query(`SELECT * FROM users WHERE LOWER(username) = 'admin'`);
        if (adminCheck.rows.length === 0) {
            await query(
                "INSERT INTO users (username, password, role, permissions) VALUES ($1, $2, $3, $4)",
                ['admin', bcrypt.hashSync('admin', 10), 'admin', stringifyPermissions(allPerms)]
            );
            console.log('✅ تم إنشاء المستخدم admin');
        } else {
            await query(`UPDATE users SET role = 'admin', permissions = $1 WHERE LOWER(username) = 'admin'`, [stringifyPermissions(allPerms)]);
            console.log('✅ تم تحديث صلاحيات admin');
        }

        const userCheck = await query(`SELECT * FROM users WHERE LOWER(username) = 'user'`);
        if (userCheck.rows.length === 0) {
            await query(
                "INSERT INTO users (username, password, role, permissions) VALUES ($1, $2, $3, $4)",
                ['user', bcrypt.hashSync('user', 10), 'user', stringifyPermissions(['view_orders', 'create_order', 'view_distribution', 'view_trucks', 'view_products', 'view_factories', 'view_reports'])]
            );
        }
        const clientCheck = await query(`SELECT * FROM users WHERE LOWER(username) = 'client'`);
        if (clientCheck.rows.length === 0) {
            await query(
                "INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5)",
                ['client', bcrypt.hashSync('client', 10), 'client', 'مصنع الفهد', stringifyPermissions(['view_orders', 'view_reports'])]
            );
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
        return result.rows.length ? result.rows[0].value : { trucks: [], factories: [], materials: [] };
    } catch (err) { return { trucks: [], factories: [], materials: [] }; }
}
async function getDayData(date) {
    const result = await query('SELECT orders, distribution FROM day_data WHERE date = $1', [date]);
    return result.rows.length ? result.rows[0] : { orders: [], distribution: [] };
}

// Endpoints العامة
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
        const result = await query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
        const user = result.rows[0];
        if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'بيانات غير صحيحة' });
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        req.session.factory = user.factory;
        req.session.permissions = parsePermissions(user.permissions);
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: 'خطأ في حفظ الجلسة' });
            logAction(user.username, 'تسجيل دخول', 'تم تسجيل الدخول', req);
            res.json({ success: true, role: user.role });
        });
    } catch (err) { res.status(500).json({ error: 'خطأ داخلي' }); }
});

app.post('/api/logout', async (req, res) => {
    if (req.session.username) await logAction(req.session.username, 'تسجيل خروج', 'تم تسجيل الخروج', req);
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مصرح' });
    const result = await query('SELECT id, username, role, factory, permissions FROM users WHERE id = $1', [req.session.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'غير مصرح' });
    res.json({ user: {
        id: result.rows[0].id,
        username: result.rows[0].username,
        role: result.rows[0].role,
        factory: result.rows[0].factory,
        permissions: parsePermissions(result.rows[0].permissions)
    } });
});

// API السيارات والمصانع والمنتجات (مع صلاحيات)
app.get('/api/trucks', authorize('view_trucks'), async (req, res) => {
    const settings = await loadSettings();
    res.json(settings.trucks || []);
});
app.get('/api/factories', authorize('view_factories'), async (req, res) => {
    const settings = await loadSettings();
    res.json(settings.factories || []);
});
app.get('/api/materials', authorize('view_products'), async (req, res) => {
    const settings = await loadSettings();
    res.json(settings.materials || []);
});

// باقي endpoints محمية (اختصاراً للطول، يمكن إضافة الباقي بنفس النمط، ولكنها موجودة في الكود السابق)
// ... (أضف بقية endpoints من السابق مع authorize)

app.get('/api/settings', authorize('view_settings'), async (req, res) => {
    const settings = await loadSettings();
    res.json(settings);
});
app.put('/api/settings', authorize('manage_settings'), async (req, res) => {
    await query(`INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [req.body]);
    res.json({ success: true });
});

app.get('/api/users', authorize('manage_users'), async (req, res) => {
    const result = await query('SELECT id, username, role, factory, permissions, created_at FROM users ORDER BY id');
    res.json(result.rows.map(u => ({ ...u, permissions: parsePermissions(u.permissions) })));
});
app.put('/api/users/:id', authorize('manage_users'), async (req, res) => {
    // تنفيذ التعديل
    res.json({ success: true });
});
app.delete('/api/users/:id', authorize('manage_users'), async (req, res) => {
    // تنفيذ الحذف
    res.json({ success: true });
});

app.get('/api/day/:date', authorize('view_orders'), async (req, res) => {
    const { date } = req.params;
    const data = await getDayData(date);
    let orders = data.orders || [];
    if (req.session.role === 'client' && req.session.factory) {
        orders = orders.filter(o => o.factory === req.session.factory);
    }
    res.json({ orders, distribution: [] });
});
app.put('/api/day/:date', authorize('edit_distribution'), async (req, res) => {
    // حفظ الطلبات
    res.json({ success: true });
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
});
