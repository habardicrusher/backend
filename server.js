require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// إعداد اتصال قاعدة البيانات
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

app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: process.env.SESSION_SECRET || 'habardicrusher_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
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
        try {
            await query(`ALTER TABLE scale_reports ADD COLUMN IF NOT EXISTS data JSONB`);
            console.log('✅ تم التأكد من وجود عمود data في scale_reports');
        } catch (err) {
            console.warn('⚠️ لا يمكن إضافة عمود data (ربما موجود بالفعل):', err.message);
        }

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

// ==================== Endpoints العامة ====================
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
        console.error(err);
        res.status(500).json({ error: 'خطأ داخلي' });
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

// ==================== بيانات اليوم ====================
app.get('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    try {
        if (!date || isNaN(new Date(date).getTime())) return res.status(400).json({ error: 'تاريخ غير صالح' });
        const data = await getDayData(date);
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في جلب البيانات' });
    }
});

app.put('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    const { orders, distribution } = req.body;
    if (!date || isNaN(new Date(date).getTime())) return res.status(400).json({ error: 'تاريخ غير صالح' });
    if (!Array.isArray(orders) || !Array.isArray(distribution)) return res.status(400).json({ error: 'بيانات غير صالحة' });
    try {
        const ordersJson = JSON.stringify(orders);
        const distributionJson = JSON.stringify(distribution);
        await query(`INSERT INTO day_data (date, orders, distribution) VALUES ($1, $2::jsonb, $3::jsonb) ON CONFLICT (date) DO UPDATE SET orders = $2::jsonb, distribution = $3::jsonb`, [date, ordersJson, distributionJson]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'خطأ في حفظ البيانات' });
    }
});

// ==================== نطاق زمني ====================
app.get('/api/range/:startDate/:endDate', async (req, res) => {
    const { startDate, endDate } = req.params;
    try {
        const result = await query(`SELECT date, orders, distribution FROM day_data WHERE date BETWEEN $1 AND $2 ORDER BY date`, [startDate, endDate]);
        const data = {};
        result.rows.forEach(row => { data[row.date] = { orders: row.orders, distribution: row.distribution }; });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب النطاق الزمني' });
    }
});

// ==================== إدارة المستخدمين ====================
app.get('/api/users', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const result = await query('SELECT id, username, role, factory, created_at FROM users ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
    }
});

app.post('/api/users', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const { username, password, role, factory } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
        const exists = await query('SELECT id FROM users WHERE username = $1', [username]);
        if (exists.rows.length) return res.status(400).json({ error: 'موجود' });
        const hashed = bcrypt.hashSync(password, 10);
        const finalRole = role || 'user';
        const finalFactory = (finalRole === 'client' && factory) ? factory : null;
        await query('INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)', [username, hashed, finalRole, finalFactory]);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في إضافة المستخدم' });
    }
});

app.put('/api/users/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const userId = parseInt(req.params.id);
        const { role, password, factory } = req.body;
        const updates = [];
        const values = [];
        if (role) { updates.push(`role = $${updates.length+1}`); values.push(role); }
        if (password) { updates.push(`password = $${updates.length+1}`); values.push(bcrypt.hashSync(password, 10)); }
        if (role === 'client' && factory !== undefined) { updates.push(`factory = $${updates.length+1}`); values.push(factory); }
        else if (role !== 'client') { updates.push(`factory = NULL`); }
        if (updates.length === 0) return res.json({ success: true });
        values.push(userId);
        await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في تعديل المستخدم' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const userId = parseInt(req.params.id);
        const user = await query('SELECT username FROM users WHERE id = $1', [userId]);
        if (!user.rows.length) return res.status(404).json({ error: 'غير موجود' });
        if (user.rows[0].username === 'admin') return res.status(400).json({ error: 'لا يمكن حذف المدير' });
        await query('DELETE FROM users WHERE id = $1', [userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في حذف المستخدم' });
    }
});

// ==================== تقارير الميزان المحفوظة ====================
app.get('/api/scale-reports', async (req, res) => {
    try {
        const result = await query('SELECT id, report_name, report_date, created_at FROM scale_reports ORDER BY created_at DESC');
        res.json(result.rows.map(r => ({
            id: r.id,
            reportName: r.report_name,
            reportDate: r.report_date,
            createdAt: r.created_at
        })));
    } catch (err) {
        console.error('❌ خطأ في GET /api/scale-reports:', err);
        res.status(500).json({ error: 'خطأ في جلب قائمة التقارير: ' + err.message });
    }
});

app.get('/api/scale-reports/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'معرّف غير صالح' });
        const result = await query('SELECT report_name, report_date, data, created_at FROM scale_reports WHERE id = $1', [id]);
        if (!result.rows.length) return res.status(404).json({ error: 'غير موجود' });
        const row = result.rows[0];
        let reportData = row.data;
        if (typeof reportData === 'string') {
            try { reportData = JSON.parse(reportData); } catch(e) { reportData = {}; }
        }
        if (!reportData || typeof reportData !== 'object') reportData = {};
        res.json({
            id,
            reportName: row.report_name,
            reportDate: row.report_date,
            data: reportData,
            createdAt: row.created_at
        });
    } catch (err) {
        console.error('❌ خطأ في GET /api/scale-reports/:id:', err);
        res.status(500).json({ error: 'خطأ في جلب التقرير: ' + err.message });
    }
});

app.post('/api/scale-reports', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const { reportName, reportDate, data } = req.body;
        if (!reportName || !data) return res.status(400).json({ error: 'اسم التقرير والبيانات مطلوبة' });
        const dataJson = JSON.stringify(data);
        await query(
            'INSERT INTO scale_reports (report_name, report_date, data) VALUES ($1, $2, $3::jsonb)',
            [reportName, reportDate || new Date().toISOString().split('T')[0], dataJson]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('❌ خطأ في POST /api/scale-reports:', err);
        res.status(500).json({ error: 'خطأ في حفظ التقرير: ' + err.message });
    }
});

app.put('/api/scale-reports/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const id = parseInt(req.params.id);
        const { reportName } = req.body;
        if (!reportName) return res.status(400).json({ error: 'اسم التقرير مطلوب' });
        await query('UPDATE scale_reports SET report_name = $1 WHERE id = $2', [reportName, id]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ خطأ في PUT /api/scale-reports/:id:', err);
        res.status(500).json({ error: 'خطأ في تعديل التقرير: ' + err.message });
    }
});

app.delete('/api/scale-reports/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const id = parseInt(req.params.id);
        await query('DELETE FROM scale_reports WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ خطأ في DELETE /api/scale-reports/:id:', err);
        res.status(500).json({ error: 'خطأ في حذف التقرير: ' + err.message });
    }
});

// ==================== بيانات الميزان الشهرية ====================
app.get('/api/scale/monthly/:year/:month', async (req, res) => {
    try {
        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const result = await query('SELECT data FROM scale_data WHERE year = $1 AND month = $2', [year, month]);
        res.json(result.rows.length ? result.rows[0].data : {});
    } catch (err) {
        res.status(500).json({ error: 'خطأ في جلب بيانات الميزان' });
    }
});

app.put('/api/scale/monthly/:year/:month', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const data = req.body;
        await query(`INSERT INTO scale_data (year, month, data) VALUES ($1, $2, $3) ON CONFLICT (year, month) DO UPDATE SET data = $3, updated_at = NOW()`, [year, month, data]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'خطأ في حفظ بيانات الميزان' });
    }
});

// ==================== تقارير المخالفات (مع احتساب 0 و 1) ====================
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
            const reason = 'لم تتوفر رحلات كافية';
            const details = `لم تقم هذه السيارة بأي رحلة في هذا اليوم.`;
            violations.push({ truck_number: truck.number, driver_name: driver, trips_count: trips, reason, details });
        } else if (trips === 1) {
            const reason = 'أقل من رودين (رحلة واحدة فقط)';
            const details = `قام بـ ${trips} رحلة فقط، والمطلوب ${requiredTrips}`;
            violations.push({ truck_number: truck.number, driver_name: driver, trips_count: trips, reason, details });
        }
        // الحالة trips >= 2 لا تحتسب مخالفة
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

// بدء الخادم
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`👤 بيانات الدخول الافتراضية: admin/admin , user/user , client/client`);
});