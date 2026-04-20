require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== إعداد قاعدة البيانات ====================
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

// ==================== إعداد الجلسة ====================
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
        await query(`
            CREATE TABLE IF NOT EXISTS restrictions (
                id SERIAL PRIMARY KEY,
                truck_number TEXT NOT NULL,
                driver_name TEXT NOT NULL,
                restricted_factories JSONB NOT NULL,
                reason TEXT,
                active BOOLEAN DEFAULT true,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await query(`
            CREATE TABLE IF NOT EXISTS backup_metadata (
                id SERIAL PRIMARY KEY,
                backup_date TIMESTAMP DEFAULT NOW(),
                backup_type TEXT,
                description TEXT
            )
        `);

        // المستخدمون الافتراضيون
        const adminCheck = await query(`SELECT * FROM users WHERE LOWER(username) = 'admin'`);
        if (adminCheck.rows.length === 0) {
            await query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", ['admin', bcrypt.hashSync('admin', 10), 'admin']);
            await query("INSERT INTO users (username, password, role) VALUES ($1, $2, $3)", ['user', bcrypt.hashSync('user', 10), 'user']);
            await query("INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)", ['client', bcrypt.hashSync('client', 10), 'client', 'مصنع الفهد']);
            console.log('✅ تم إنشاء المستخدمين الافتراضيين');
        }
        console.log('✅ جميع الجداول جاهزة');
    } catch (err) {
        console.error('❌ فشل إنشاء الجداول:', err.message);
    }
}
initTables().catch(console.error);

// ==================== دوال تحميل البيانات الأساسية ====================
async function loadSettings() {
    try {
        const result = await query(`SELECT value FROM settings WHERE key = 'settings'`);
        return result.rows.length ? result.rows[0].value : { trucks: [], factories: [], materials: [] };
    } catch (err) {
        console.error('فشل تحميل الإعدادات:', err);
        return { trucks: [], factories: [], materials: [] };
    }
}

async function getDayData(date) {
    const result = await query('SELECT orders, distribution FROM day_data WHERE date = $1', [date]);
    return result.rows.length ? result.rows[0] : { orders: [], distribution: [] };
}

// ==================== دوال القيود ====================
async function getRestrictions() {
    const result = await query('SELECT * FROM restrictions ORDER BY created_at DESC');
    return result.rows;
}

async function getRestrictionById(id) {
    const result = await query('SELECT * FROM restrictions WHERE id = $1', [id]);
    return result.rows[0];
}

async function createRestriction(truckNumber, driverName, restrictedFactories, reason, createdBy) {
    const result = await query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, createdBy]
    );
    return result.rows[0];
}

async function updateRestriction(id, updates) {
    const fields = [];
    const values = [];
    let idx = 1;
    if (updates.active !== undefined) {
        fields.push(`active = $${idx++}`);
        values.push(updates.active);
    }
    if (updates.restricted_factories !== undefined) {
        fields.push(`restricted_factories = $${idx++}`);
        values.push(JSON.stringify(updates.restricted_factories));
    }
    if (updates.reason !== undefined) {
        fields.push(`reason = $${idx++}`);
        values.push(updates.reason);
    }
    if (fields.length === 0) return null;
    fields.push(`updated_at = NOW()`);
    values.push(id);
    const queryStr = `UPDATE restrictions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await query(queryStr, values);
    return result.rows[0];
}

async function deleteRestriction(id) {
    await query('DELETE FROM restrictions WHERE id = $1', [id]);
}

// ==================== دوال النسخ الاحتياطي والاستعادة ====================
async function getFullBackup() {
    const settings = await loadSettings();
    const daysResult = await query('SELECT date, orders, distribution FROM day_data ORDER BY date');
    const days = {};
    daysResult.rows.forEach(row => {
        days[row.date] = { orders: row.orders, distribution: row.distribution };
    });
    const usersResult = await query('SELECT id, username, role, factory, created_at FROM users');
    const restrictionsResult = await query('SELECT * FROM restrictions ORDER BY id');
    return {
        version: '1.0',
        exported_at: new Date().toISOString(),
        settings,
        days,
        users: usersResult.rows,
        restrictions: restrictionsResult.rows
    };
}

async function restoreFullBackup(backupData) {
    await query('BEGIN');
    try {
        if (backupData.settings) {
            await query(`INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [backupData.settings]);
        }
        await query('DELETE FROM day_data');
        if (backupData.days) {
            for (const [date, data] of Object.entries(backupData.days)) {
                await query(
                    'INSERT INTO day_data (date, orders, distribution) VALUES ($1, $2, $3)',
                    [date, JSON.stringify(data.orders || []), JSON.stringify(data.distribution || [])]
                );
            }
        }
        if (backupData.users) {
            for (const user of backupData.users) {
                if (user.username === 'admin') continue;
                await query(
                    `INSERT INTO users (id, username, role, factory, created_at)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (username) DO UPDATE SET role = $3, factory = $4`,
                    [user.id, user.username, user.role, user.factory, user.created_at]
                );
            }
        }
        await query('DELETE FROM restrictions');
        if (backupData.restrictions && backupData.restrictions.length) {
            for (const r of backupData.restrictions) {
                await query(
                    `INSERT INTO restrictions (id, truck_number, driver_name, restricted_factories, reason, active, created_by, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (id) DO UPDATE SET
                        truck_number = $2, driver_name = $3, restricted_factories = $4,
                        reason = $5, active = $6, created_by = $7, updated_at = $9`,
                    [r.id, r.truck_number, r.driver_name, r.restricted_factories, r.reason, r.active, r.created_by, r.created_at, r.updated_at || new Date()]
                );
            }
        }
        await query(`INSERT INTO backup_metadata (backup_type, description) VALUES ('restore', 'تم استعادة البيانات من نسخة احتياطية')`);
        await query('COMMIT');
        return true;
    } catch (err) {
        await query('ROLLBACK');
        throw err;
    }
}

async function clearAllData() {
    await query('BEGIN');
    try {
        await query('DELETE FROM day_data');
        await query('DELETE FROM scale_reports');
        await query('DELETE FROM scale_data');
        await query('DELETE FROM truck_violations');
        await query('DELETE FROM restrictions');
        await query(`INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [{ trucks: [], factories: [], materials: [] }]);
        await query('COMMIT');
    } catch (err) {
        await query('ROLLBACK');
        throw err;
    }
}

// ==================== Endpoints العامة ====================
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
        req.session.factory = user.factory; // ★★★ تخزين المصنع في الجلسة
        req.session.save(async (err) => {
            if (err) return res.status(500).json({ error: 'خطأ في إنشاء الجلسة' });
            await logAction(user.username, 'تسجيل دخول', 'تم تسجيل الدخول بنجاح', req);
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
    const result = await query('SELECT id, username, role, factory FROM users WHERE id = $1', [req.session.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'غير مصرح' });
    // تحديث الجلسة في حالة تغير المصنع من قاعدة البيانات (نادر)
    if (result.rows[0].factory && !req.session.factory) {
        req.session.factory = result.rows[0].factory;
    }
    res.json({ user: result.rows[0] });
});

// ==================== السجلات ====================
app.get('/api/logs', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const countResult = await query('SELECT COUNT(*) FROM logs');
    const total = parseInt(countResult.rows[0].count);
    const result = await query('SELECT id, username, action, details, location, created_at FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    res.json({ logs: result.rows, totalPages: Math.ceil(total / limit), currentPage: page, total });
});

app.get('/api/logs/all', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const result = await query('SELECT id, username, action, details, location, created_at FROM logs ORDER BY created_at DESC');
    res.json(result.rows);
});

app.delete('/api/logs/clear', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await query('DELETE FROM logs');
    await logAction(req.session.username, 'مسح السجلات', 'تم مسح جميع سجلات النظام', req);
    res.json({ success: true });
});

// ==================== الإعدادات والمنتجات ====================
app.get('/api/settings', async (req, res) => {
    const settings = await loadSettings();
    res.json(settings);
});

app.put('/api/settings', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await query(`INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [req.body]);
    await logAction(req.session.username, 'تحديث الإعدادات', 'تم تحديث إعدادات النظام', req);
    res.json({ success: true });
});

app.get('/api/products', async (req, res) => {
    const result = await query('SELECT name FROM products ORDER BY id');
    res.json(result.rows.map(r => r.name));
});

app.post('/api/products', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'اسم المنتج مطلوب' });
    await query('INSERT INTO products (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    res.status(201).json({ success: true });
});

app.delete('/api/products/:name', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { name } = req.params;
    await query('DELETE FROM products WHERE name = $1', [name]);
    res.json({ success: true });
});

// ==================== بيانات اليوم (مع صلاحيات client) ====================
app.get('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    if (!date || isNaN(new Date(date).getTime())) return res.status(400).json({ error: 'تاريخ غير صالح' });
    const data = await getDayData(date);
    let orders = data.orders || [];
    let distribution = data.distribution || [];
    
    // ★★★ فلترة الطلبات إذا كان المستخدم من نوع client ★★★
    if (req.session.role === 'client' && req.session.factory) {
        orders = orders.filter(order => order.factory === req.session.factory);
        distribution = []; // العميل لا يرى التوزيع
    }
    
    res.json({ orders, distribution });
});

app.put('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    let { orders, distribution } = req.body;
    if (!date || isNaN(new Date(date).getTime())) return res.status(400).json({ error: 'تاريخ غير صالح' });
    if (!Array.isArray(orders) || !Array.isArray(distribution)) return res.status(400).json({ error: 'بيانات غير صالحة' });
    
    // ★★★ التحقق من الصلاحيات: إذا كان المستخدم عميل مصنع ★★★
    if (req.session.role === 'client' && req.session.factory) {
        const allOrdersBelongToClient = orders.every(order => order.factory === req.session.factory);
        if (!allOrdersBelongToClient) {
            return res.status(403).json({ error: 'غير مصرح لك بتعديل طلبات مصانع أخرى' });
        }
        if (distribution && distribution.length > 0) {
            return res.status(403).json({ error: 'غير مصرح لك بحفظ بيانات التوزيع' });
        }
        distribution = []; // إفراغ التوزيع
    }
    
    const ordersJson = JSON.stringify(orders);
    const distributionJson = JSON.stringify(distribution);
    await query(`INSERT INTO day_data (date, orders, distribution) VALUES ($1, $2::jsonb, $3::jsonb) ON CONFLICT (date) DO UPDATE SET orders = $2::jsonb, distribution = $3::jsonb`, [date, ordersJson, distributionJson]);
    res.json({ success: true });
});

app.get('/api/range/:startDate/:endDate', async (req, res) => {
    const { startDate, endDate } = req.params;
    const result = await query(`SELECT date, orders, distribution FROM day_data WHERE date BETWEEN $1 AND $2 ORDER BY date`, [startDate, endDate]);
    const data = {};
    result.rows.forEach(row => { data[row.date] = { orders: row.orders, distribution: row.distribution }; });
    res.json(data);
});

// ==================== إدارة المستخدمين ====================
app.get('/api/users', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const result = await query('SELECT id, username, role, factory, created_at FROM users ORDER BY id');
    res.json(result.rows);
});

app.post('/api/users', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { username, password, role, factory } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
    const exists = await query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
    if (exists.rows.length) return res.status(400).json({ error: 'اسم المستخدم موجود' });
    const hashed = bcrypt.hashSync(password, 10);
    const finalRole = role || 'user';
    const finalFactory = (finalRole === 'client' && factory) ? factory : null;
    await query('INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)', [username, hashed, finalRole, finalFactory]);
    res.status(201).json({ success: true });
});

app.put('/api/users/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const userId = parseInt(req.params.id);
    const { role, password, factory } = req.body;
    const updates = [], values = [];
    if (role) { updates.push(`role = $${updates.length+1}`); values.push(role); }
    if (password) { updates.push(`password = $${updates.length+1}`); values.push(bcrypt.hashSync(password, 10)); }
    if (role === 'client' && factory !== undefined) { updates.push(`factory = $${updates.length+1}`); values.push(factory); }
    else if (role !== 'client') { updates.push(`factory = NULL`); }
    if (updates.length === 0) return res.json({ success: true });
    values.push(userId);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ success: true });
});

app.delete('/api/users/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const userId = parseInt(req.params.id);
    const user = await query('SELECT username FROM users WHERE id = $1', [userId]);
    if (!user.rows.length) return res.status(404).json({ error: 'غير موجود' });
    if (user.rows[0].username.toLowerCase() === 'admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    await query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
});

// ==================== تقارير الميزان المحفوظة ====================
app.get('/api/scale-reports', async (req, res) => {
    try {
        const result = await query('SELECT id, report_name, report_date, created_at FROM scale_reports ORDER BY created_at DESC');
        res.json(result.rows.map(r => ({ id: r.id, reportName: r.report_name, reportDate: r.report_date, createdAt: r.created_at })));
    } catch (err) { res.status(500).json({ error: 'خطأ في جلب قائمة التقارير' }); }
});

app.get('/api/scale-reports/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'معرّف غير صالح' });
        const result = await query('SELECT report_name, report_date, data, created_at FROM scale_reports WHERE id = $1', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'غير موجود' });
        const row = result.rows[0];
        let reportData = row.data;
        if (typeof reportData === 'string') { try { reportData = JSON.parse(reportData); } catch(e) { reportData = {}; } }
        if (!reportData || typeof reportData !== 'object') reportData = {};
        res.json({ id, reportName: row.report_name, reportDate: row.report_date, data: reportData, createdAt: row.created_at });
    } catch (err) { res.status(500).json({ error: 'خطأ في جلب التقرير' }); }
});

app.post('/api/scale-reports', async (req, res) => {
    try {
        const { reportName, reportDate, data } = req.body;
        if (!reportName || !data) return res.status(400).json({ error: 'اسم التقرير والبيانات مطلوبة' });
        const dataJson = JSON.stringify(data);
        await query(
            'INSERT INTO scale_reports (report_name, report_date, data) VALUES ($1, $2, $3::jsonb)',
            [reportName, reportDate || new Date().toISOString().split('T')[0], dataJson]
        );
        if (req.session.username) await logAction(req.session.username, 'حفظ تقرير', `حفظ تقرير "${reportName}"`, req);
        res.status(201).json({ success: true });
    } catch (err) { res.status(500).json({ error: 'خطأ في حفظ التقرير: ' + err.message }); }
});

app.put('/api/scale-reports/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const id = parseInt(req.params.id);
        const { reportName } = req.body;
        if (!reportName) return res.status(400).json({ error: 'اسم التقرير مطلوب' });
        await query('UPDATE scale_reports SET report_name = $1 WHERE id = $2', [reportName, id]);
        await logAction(req.session.username, 'تعديل تقرير', `تعديل اسم التقرير إلى "${reportName}"`, req);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'خطأ في تعديل التقرير' }); }
});

app.delete('/api/scale-reports/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const id = parseInt(req.params.id);
        await query('DELETE FROM scale_reports WHERE id = $1', [id]);
        await logAction(req.session.username, 'حذف تقرير', `حذف تقرير برقم ${id}`, req);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'خطأ في حذف التقرير' }); }
});

// ==================== بيانات الميزان الشهرية (الخام) ====================
app.get('/api/scale/monthly/:year/:month', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const result = await query('SELECT data FROM scale_data WHERE year = $1 AND month = $2', [year, month]);
        res.json(result.rows.length ? result.rows[0].data : {});
    } catch (err) { res.status(500).json({ error: 'خطأ في جلب بيانات الميزان' }); }
});

app.put('/api/scale/monthly/:year/:month', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const data = req.body;
    await query(`INSERT INTO scale_data (year, month, data) VALUES ($1, $2, $3) ON CONFLICT (year, month) DO UPDATE SET data = $3, updated_at = NOW()`, [year, month, data]);
    res.json({ success: true });
});

// ==================== تقارير المخالفات (السيارات غير المستوفية) ====================
function analyzeTruckViolationsForDay(date, orders, distribution, trucksList) {
    const truckTrips = new Map();
    distribution.forEach(d => {
        if (!d.truck) return;
        const num = d.truck.number;
        if (!truckTrips.has(num)) truckTrips.set(num, { trips: 0, driver: d.truck.driver });
        truckTrips.get(num).trips++;
    });
    const requiredTrips = 2;
    const violations = [];
    trucksList.forEach(truck => {
        const stats = truckTrips.get(truck.number);
        const trips = stats ? stats.trips : 0;
        const driver = stats ? stats.driver : truck.driver;
        if (trips === 0) {
            violations.push({ truck_number: truck.number, driver_name: driver, trips_count: trips, reason: 'لم تتوفر رحلات كافية', details: 'لم تقم هذه السيارة بأي رحلة في هذا اليوم.' });
        } else if (trips === 1) {
            violations.push({ truck_number: truck.number, driver_name: driver, trips_count: trips, reason: 'أقل من رودين (رحلة واحدة فقط)', details: `قام بـ ${trips} رحلة فقط، والمطلوب ${requiredTrips}` });
        }
    });
    return violations;
}

app.get('/api/truck-violations/stats/:startDate/:endDate', async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        const dates = [];
        let current = new Date(startDate);
        let end = new Date(endDate);
        while (current <= end) { dates.push(current.toISOString().split('T')[0]); current.setDate(current.getDate() + 1); }
        const settings = await loadSettings();
        const trucksList = settings.trucks || [];
        const allViolations = [];
        const violationsByTruck = new Map();
        for (const date of dates) {
            const dayData = await getDayData(date);
            const orders = dayData.orders || [];
            const distribution = dayData.distribution || [];
            const violations = analyzeTruckViolationsForDay(date, orders, distribution, trucksList);
            violations.forEach(v => {
                allViolations.push({ ...v, report_date: date });
                const key = v.truck_number;
                if (!violationsByTruck.has(key)) violationsByTruck.set(key, { count: 0, totalTrips: 0, driver: v.driver_name });
                const rec = violationsByTruck.get(key);
                rec.count++;
                rec.totalTrips += v.trips_count;
            });
        }
        const topTrucks = Array.from(violationsByTruck.entries()).map(([truck_number, data]) => ({
            truck_number, driver_name: data.driver, violation_count: data.count, avg_trips: data.totalTrips / data.count
        })).sort((a,b) => b.violation_count - a.violation_count).slice(0,10);
        const totalViolations = allViolations.length;
        const uniqueTrucksViolated = violationsByTruck.size;
        const avgTrips = totalViolations > 0 ? (allViolations.reduce((s,v) => s + v.trips_count, 0) / totalViolations) : 0;
        const reasonCount = new Map();
        allViolations.forEach(v => reasonCount.set(v.reason, (reasonCount.get(v.reason) || 0) + 1));
        const topReasons = Array.from(reasonCount.entries()).map(([reason, count]) => ({ reason, count })).sort((a,b) => b.count - a.count).slice(0,5);
        res.json({
            general: {
                total_trucks: uniqueTrucksViolated,
                total_violations: totalViolations,
                avg_trips: avgTrips,
                zero_trips_count: allViolations.filter(v => v.trips_count === 0).length
            },
            topTrucks,
            topReasons
        });
    } catch (err) { console.error(err); res.status(500).json({ error: 'خطأ في جلب الإحصائيات' }); }
});

app.get('/api/truck-violations/report/:startDate/:endDate', async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        const dates = [];
        let current = new Date(startDate);
        let end = new Date(endDate);
        while (current <= end) { dates.push(current.toISOString().split('T')[0]); current.setDate(current.getDate() + 1); }
        const settings = await loadSettings();
        const trucksList = settings.trucks || [];
        const report = [];
        for (const date of dates) {
            const dayData = await getDayData(date);
            const orders = dayData.orders || [];
            const distribution = dayData.distribution || [];
            const violations = analyzeTruckViolationsForDay(date, orders, distribution, trucksList);
            violations.forEach(v => {
                report.push({
                    report_date: date,
                    truck_number: v.truck_number,
                    driver_name: v.driver_name,
                    trips_count: v.trips_count,
                    reason: v.reason,
                    details: v.details
                });
            });
        }
        res.json(report);
    } catch (err) { console.error(err); res.status(500).json({ error: 'خطأ في جلب التقرير' }); }
});

app.get('/api/truck-violations/:date', async (req, res) => {
    const { date } = req.params;
    try {
        const result = await query('SELECT truck_number, reason, details FROM truck_violations WHERE date = $1', [date]);
        res.json(result.rows.map(r => ({ truck_number: r.truck_number, reason: r.reason, details: r.details })));
    } catch (err) { res.status(500).json({ error: 'خطأ في جلب الأسباب' }); }
});

app.post('/api/truck-violations/save', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { date, violations } = req.body;
    if (!date || !violations) return res.status(400).json({ error: 'بيانات ناقصة' });
    try {
        await query('DELETE FROM truck_violations WHERE date = $1', [date]);
        for (const v of violations) {
            await query('INSERT INTO truck_violations (date, truck_number, driver, trips, reason, details) VALUES ($1, $2, $3, $4, $5, $6)', [date, v.truckNumber, v.driver, v.trips, v.reason, v.detail || '']);
        }
        await logAction(req.session.username, 'تحديث أسباب المخالفات', `تحديث أسباب مخالفات يوم ${date}`, req);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'خطأ في حفظ الأسباب' }); }
});

// ==================== القيود (Restrictions) ====================
app.get('/api/restrictions', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'user') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const restrictions = await getRestrictions();
        res.json(restrictions);
    } catch (err) { res.status(500).json({ error: 'خطأ في جلب القيود' }); }
});

app.post('/api/restrictions', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'user') return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    if (!truckNumber || !restrictedFactories || !restrictedFactories.length) return res.status(400).json({ error: 'بيانات ناقصة' });
    try {
        const newRestriction = await createRestriction(truckNumber, driverName, restrictedFactories, reason, req.session.username || 'system');
        await logAction(req.session.username, 'إضافة قيد', `إضافة قيد على السيارة ${truckNumber}`, req);
        res.status(201).json(newRestriction);
    } catch (err) { res.status(500).json({ error: 'خطأ في إضافة القيد' }); }
});

app.put('/api/restrictions/:id', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'user') return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    const { active, restricted_factories, reason } = req.body;
    try {
        const updated = await updateRestriction(id, { active, restricted_factories, reason });
        if (!updated) return res.status(404).json({ error: 'القيد غير موجود' });
        await logAction(req.session.username, 'تعديل قيد', `تعديل قيد السيارة ${updated.truck_number}`, req);
        res.json(updated);
    } catch (err) { res.status(500).json({ error: 'خطأ في تعديل القيد' }); }
});

app.delete('/api/restrictions/:id', async (req, res) => {
    if (req.session.role !== 'admin' && req.session.role !== 'user') return res.status(403).json({ error: 'غير مصرح' });
    const id = parseInt(req.params.id);
    try {
        const restriction = await getRestrictionById(id);
        if (!restriction) return res.status(404).json({ error: 'القيد غير موجود' });
        await deleteRestriction(id);
        await logAction(req.session.username, 'حذف قيد', `حذف قيد السيارة ${restriction.truck_number}`, req);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'خطأ في حذف القيد' }); }
});

// ==================== النسخ الاحتياطي والإعدادات ====================
app.get('/api/backup', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const backup = await getFullBackup();
        res.json(backup);
    } catch (err) { res.status(500).json({ error: 'خطأ في إنشاء النسخة الاحتياطية' }); }
});

app.post('/api/restore', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        await restoreFullBackup(req.body);
        await logAction(req.session.username, 'استعادة نسخة احتياطية', 'تم استعادة البيانات من ملف JSON', req);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'خطأ في استعادة البيانات: ' + err.message }); }
});

app.delete('/api/clear-all', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        await clearAllData();
        await logAction(req.session.username, 'مسح جميع البيانات', 'تم مسح جميع بيانات النظام', req);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'خطأ في مسح البيانات: ' + err.message }); }
});

// ==================== بدء الخادم ====================
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`👤 بيانات الدخول الافتراضية: admin/admin , user/user , client/client`);
    console.log(`📝 ملاحظة: تسجيل الدخول غير حساس لحالة الأحرف`);
});