require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { pool, addLog, getLogs, getLogsCount, saveReport, getReports } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
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

function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}
function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}

// ========== إنشاء الجداول تلقائياً إذا لم تكن موجودة ==========
async function initTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                factory VARCHAR(255),
                permissions JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100),
                action TEXT,
                details TEXT,
                location TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                id SERIAL PRIMARY KEY,
                factories JSONB DEFAULT '[]',
                materials JSONB DEFAULT '[]',
                trucks JSONB DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS daily_data (
                date DATE PRIMARY KEY,
                orders JSONB DEFAULT '[]',
                distribution JSONB DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS restrictions (
                id SERIAL PRIMARY KEY,
                truck_number VARCHAR(50),
                driver_name VARCHAR(100),
                restricted_factories JSONB,
                reason TEXT,
                active BOOLEAN DEFAULT true,
                created_by VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255),
                report_date DATE,
                data JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS scale_reports (
                id SERIAL PRIMARY KEY,
                report_id VARCHAR(100) UNIQUE NOT NULL,
                report_name VARCHAR(500) NOT NULL,
                report_date DATE,
                created_at TIMESTAMP DEFAULT NOW(),
                created_by VARCHAR(100),
                total_rows INTEGER DEFAULT 0,
                matched_count INTEGER DEFAULT 0,
                not_matched_count INTEGER DEFAULT 0,
                total_weight_all NUMERIC DEFAULT 0,
                drivers_stats JSONB DEFAULT '[]',
                materials_stats JSONB DEFAULT '[]',
                top10_drivers JSONB DEFAULT '[]'
            );
        `);
        console.log('✅ Tables ensured');
    } catch (err) {
        console.error('❌ Error creating tables:', err.message);
    }
}
initTables();

// ========== API Routes ==========
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = (await pool.query('SELECT * FROM users WHERE username = $1', [username])).rows[0];
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
    await addLog(req.session.user.username, 'تسجيل دخول', `تسجيل دخول للمستخدم ${username}`, req.session.user.factory || 'المكتب الرئيسي');
    res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', async (req, res) => {
    const username = req.session?.user?.username;
    if (username) await addLog(username, 'تسجيل خروج', `تسجيل خروج للمستخدم ${username}`, req.session.user?.factory || 'المكتب الرئيسي');
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// Settings
app.get('/api/settings', requireAuth, async (req, res) => {
    const settings = (await pool.query('SELECT factories, materials, trucks FROM app_settings WHERE id = 1')).rows[0] || {
        factories: [
            { name: 'SCCCL', location: 'الدمام' }, { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' },
            { name: 'الحارثي القديم', location: 'الدمام' }, { name: 'المعجل لمنتجات الاسمنت', location: 'الدمام' },
            { name: 'الحارث العزيزية', location: 'الدمام' }, { name: 'سارمكس النظيم', location: 'الرياض' },
            { name: 'عبر الخليج', location: 'الرياض' }, { name: 'الكفاح للخرسانة الجاهزة', location: 'الدمام' },
            { name: 'القيشان 3', location: 'الدمام' }, { name: 'القيشان 2 - الأحجار الشرقية', location: 'الدمام' },
            { name: 'القيشان 1', location: 'الدمام' }, { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
        ],
        materials: ['3/4', '3/8', '3/16'],
        trucks: []
    };
    if (req.session.user.role === 'client' && req.session.user.factory) {
        settings.factories = settings.factories.filter(f => f.name === req.session.user.factory);
    }
    res.json(settings);
});

app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
    const { factories, materials, trucks } = req.body;
    await pool.query(
        `INSERT INTO app_settings (id, factories, materials, trucks, updated_at)
         VALUES (1, $1, $2, $3, NOW())
         ON CONFLICT (id) DO UPDATE SET factories = $1, materials = $2, trucks = $3, updated_at = NOW()`,
        [JSON.stringify(factories), JSON.stringify(materials), JSON.stringify(trucks)]
    );
    await addLog(req.session.user.username, 'تحديث الإعدادات', `المصانع: ${factories.length}, المواد: ${materials.length}, السيارات: ${trucks.length}`, null);
    res.json({ success: true });
});

// Daily data
app.get('/api/day/:date', requireAuth, async (req, res) => {
    const result = await pool.query('SELECT orders, distribution FROM daily_data WHERE date = $1', [req.params.date]);
    if (result.rows.length === 0) return res.json({ orders: [], distribution: [] });
    res.json({ orders: result.rows[0].orders, distribution: result.rows[0].distribution });
});

app.put('/api/day/:date', requireAuth, async (req, res) => {
    const { orders, distribution } = req.body;
    await pool.query(
        `INSERT INTO daily_data (date, orders, distribution) VALUES ($1, $2, $3)
         ON CONFLICT (date) DO UPDATE SET orders = $2, distribution = $3`,
        [req.params.date, JSON.stringify(orders), JSON.stringify(distribution)]
    );
    res.json({ success: true });
});

// Users management (Admin only)
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const users = (await pool.query('SELECT id, username, role, factory, permissions, created_at FROM users')).rows;
    res.json(users);
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    const { username, password, role, factory, permissions } = req.body;
    const existing = (await pool.query('SELECT id FROM users WHERE username = $1', [username])).rows[0];
    if (existing) return res.status(400).json({ error: 'اسم المستخدم موجود' });
    const hashed = bcrypt.hashSync(password, 10);
    await pool.query(
        `INSERT INTO users (username, password, role, factory, permissions) VALUES ($1, $2, $3, $4, $5)`,
        [username, hashed, role, factory, JSON.stringify(permissions || {})]
    );
    await addLog(req.session.user.username, 'إضافة مستخدم', `المستخدم: ${username}, الدور: ${role}`, null);
    res.json({ success: true });
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { username, role, factory, permissions, password } = req.body;
    if (password) {
        const hashed = bcrypt.hashSync(password, 10);
        await pool.query(`UPDATE users SET username=$1, role=$2, factory=$3, permissions=$4, password=$5 WHERE id=$6`,
            [username, role, factory, JSON.stringify(permissions || {}), hashed, id]);
    } else {
        await pool.query(`UPDATE users SET username=$1, role=$2, factory=$3, permissions=$4 WHERE id=$5`,
            [username, role, factory, JSON.stringify(permissions || {}), id]);
    }
    await addLog(req.session.user.username, 'تعديل مستخدم', `المستخدم: ${username}`, null);
    res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const user = (await pool.query('SELECT username FROM users WHERE id = $1', [id])).rows[0];
    if (user?.username === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    await addLog(req.session.user.username, 'حذف مستخدم', `المستخدم: ${user?.username}`, null);
    res.json({ success: true });
});

// Restrictions
app.get('/api/restrictions', requireAuth, async (req, res) => {
    const restrictions = (await pool.query('SELECT * FROM restrictions ORDER BY created_at DESC')).rows;
    res.json(restrictions);
});

app.post('/api/restrictions', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const { truckNumber, driverName, restrictedFactories, reason } = req.body;
    const result = await pool.query(
        `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, req.session.user.username]
    );
    await addLog(req.session.user.username, 'إضافة قيد حظر', `السيارة: ${truckNumber}`, null);
    res.json(result.rows[0]);
});

app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    const { active } = req.body;
    await pool.query('UPDATE restrictions SET active = $1 WHERE id = $2', [active, req.params.id]);
    await addLog(req.session.user.username, 'تعديل قيد حظر', `القيد ${req.params.id}`, null);
    res.json({ success: true });
});

app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
    await pool.query('DELETE FROM restrictions WHERE id = $1', [req.params.id]);
    await addLog(req.session.user.username, 'حذف قيد حظر', `القيد ${req.params.id}`, null);
    res.json({ success: true });
});

// Reports (old)
app.get('/api/reports', requireAuth, async (req, res) => {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let allDistributions = [], dailyData = {}, driverStats = {}, factoryStats = {}, materialStats = {};
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const dayData = (await pool.query('SELECT distribution FROM daily_data WHERE date = $1', [dateStr])).rows[0];
        if (dayData?.distribution?.length) {
            dailyData[dateStr] = dayData.distribution.length;
            dayData.distribution.forEach(dist => {
                dist.date = dateStr;
                allDistributions.push(dist);
                const key = dist.truck?.number;
                if (key) {
                    if (!driverStats[key]) driverStats[key] = { number: key, driver: dist.truck.driver, total: 0 };
                    driverStats[key].total++;
                }
                const factory = dist.factory;
                if (factory) {
                    if (!factoryStats[factory]) factoryStats[factory] = { name: factory, total: 0 };
                    factoryStats[factory].total++;
                }
                const material = dist.material;
                if (material) {
                    if (!materialStats[material]) materialStats[material] = { name: material, total: 0 };
                    materialStats[material].total++;
                }
            });
        }
    }
    res.json({ allDistributions, dailyData, driverStats: Object.values(driverStats), factoryStats: Object.values(factoryStats), materialStats: Object.values(materialStats), startDate, endDate });
});

// Scale Reports (new)
app.post('/api/scale-reports', requireAuth, async (req, res) => {
    try {
        const { reportName, reportDate, data } = req.body;
        const reportId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        await pool.query(
            `INSERT INTO scale_reports 
             (report_id, report_name, report_date, created_by, total_rows, matched_count, not_matched_count, total_weight_all, drivers_stats, materials_stats, top10_drivers)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [reportId, reportName || 'تقرير بدون اسم', reportDate || new Date().toISOString().split('T')[0], req.session.user.username,
             data.totalRows || 0, data.matchedCount || 0, data.notMatchedCount || 0, data.totalWeightAll || 0,
             JSON.stringify(data.driversStats || []), JSON.stringify(data.materialsStats || []), JSON.stringify(data.top10Drivers || [])]
        );
        await addLog(req.session.user.username, 'حفظ تقرير ميزان', `تقرير: ${reportName}`, null);
        res.json({ success: true, id: reportId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/scale-reports', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, report_id, report_name, report_date, created_at, created_by, 
                    total_rows, matched_count, not_matched_count, total_weight_all,
                    jsonb_array_length(COALESCE(drivers_stats, '[]'::jsonb)) as drivers_count
             FROM scale_reports ORDER BY created_at DESC`
        );
        res.json(result.rows.map(r => ({
            id: r.report_id, dbId: r.id, reportName: r.report_name, reportDate: r.report_date,
            createdAt: r.created_at, createdBy: r.created_by, totalRows: r.total_rows,
            matchedCount: r.matched_count, notMatchedCount: r.not_matched_count,
            totalWeight: r.total_weight_all, driversCount: r.drivers_count || 0
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM scale_reports WHERE report_id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'غير موجود' });
        const r = result.rows[0];
        res.json({
            id: r.report_id, dbId: r.id, reportName: r.report_name, reportDate: r.report_date,
            createdAt: r.created_at, createdBy: r.created_by,
            data: {
                totalRows: r.total_rows, matchedCount: r.matched_count, notMatchedCount: r.not_matched_count,
                totalWeightAll: parseFloat(r.total_weight_all) || 0,
                driversStats: r.drivers_stats || [], materialsStats: r.materials_stats || [],
                top10Drivers: r.top10_drivers || []
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM scale_reports WHERE report_id = $1', [req.params.id]);
        await addLog(req.session.user.username, 'حذف تقرير ميزان', `تقرير ${req.params.id}`, null);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/scale-reports/:id', requireAuth, async (req, res) => {
    try {
        const { reportName } = req.body;
        await pool.query('UPDATE scale_reports SET report_name = $1 WHERE report_id = $2', [reportName, req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Backup & restore (simplified)
app.get('/api/backup', requireAuth, requireAdmin, async (req, res) => {
    const settings = (await pool.query('SELECT factories, materials, trucks FROM app_settings WHERE id = 1')).rows[0] || {};
    const users = (await pool.query('SELECT id, username, role, factory, permissions FROM users')).rows;
    const restrictions = (await pool.query('SELECT * FROM restrictions')).rows;
    res.json({ settings, users, restrictions, exportDate: new Date().toISOString() });
});

app.post('/api/restore', requireAuth, requireAdmin, async (req, res) => {
    const data = req.body;
    if (data.settings) await pool.query(`INSERT INTO app_settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET factories = $1, materials = $2, trucks = $3`, [JSON.stringify(data.settings.factories || []), JSON.stringify(data.settings.materials || []), JSON.stringify(data.settings.trucks || [])]);
    if (data.restrictions) {
        await pool.query('DELETE FROM restrictions');
        for (const r of data.restrictions) {
            await pool.query(`INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [r.truck_number, r.driver_name, r.restricted_factories, r.reason, r.created_by, r.created_at]);
        }
    }
    res.json({ success: true });
});

app.delete('/api/clear-all', requireAuth, requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM daily_data');
    await pool.query('DELETE FROM restrictions');
    res.json({ success: true });
});

app.get('/api/logs', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const logs = await getLogs(limit, offset);
    const total = await getLogsCount();
    res.json({ logs, currentPage: page, totalPages: Math.ceil(total / limit), total });
});

app.get('/api/logs/all', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const logs = await getLogs(10000, 0);
    res.json(logs);
});

app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    await pool.query('DELETE FROM logs');
    await addLog(req.session.user.username, 'مسح السجلات', 'قام بحذف جميع سجلات النظام', null);
    res.json({ success: true });
});

// Serve static files with authentication for protected pages
const allProtectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html', 'upload-report.html', 'scale_report.html'];
allProtectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session || !req.session.user) return res.redirect('/login.html');
        if (req.session.user.role === 'client' && page !== 'orders.html') return res.redirect('/orders.html');
        res.sendFile(path.join(__dirname, page));
    });
});
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/', (req, res) => {
    if (req.session?.user) {
        if (req.session.user.role === 'client') res.redirect('/orders.html');
        else res.redirect('/index.html');
    } else res.redirect('/login.html');
});
app.use(express.static(__dirname));
// ==================== جدول أسباب السيارات المخالفة ====================
async function createTruckViolationsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS truck_violations (
            id SERIAL PRIMARY KEY,
            report_date DATE NOT NULL,
            truck_number VARCHAR(50) NOT NULL,
            driver_name VARCHAR(100),
            trips_count INTEGER DEFAULT 0,
            reason TEXT,
            details TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            created_by VARCHAR(100),
            UNIQUE(report_date, truck_number)
        )
    `);
    console.log('✅ جدول truck_violations جاهز');
}
createTruckViolationsTable();

// حفظ أسباب السيارات المخالفة (لليوم كاملاً)
app.post('/api/truck-violations/save', requireAuth, async (req, res) => {
    try {
        const { date, violations } = req.body; // violations: [{ truckNumber, driver, trips, reason, detail }]
        if (!date || !Array.isArray(violations)) {
            return res.status(400).json({ error: 'بيانات غير صالحة' });
        }
        const username = req.session.user.username;
        
        for (const v of violations) {
            await pool.query(`
                INSERT INTO truck_violations (report_date, truck_number, driver_name, trips_count, reason, details, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (report_date, truck_number) 
                DO UPDATE SET 
                    driver_name = EXCLUDED.driver_name,
                    trips_count = EXCLUDED.trips_count,
                    reason = EXCLUDED.reason,
                    details = EXCLUDED.details,
                    created_by = EXCLUDED.created_by
            `, [date, v.truckNumber, v.driver, v.trips, v.reason, v.detail, username]);
        }
        
        await addLog(username, 'حفظ أسباب السيارات المخالفة', `التاريخ: ${date}, عدد السيارات: ${violations.length}`, null);
        res.json({ success: true, message: 'تم حفظ الأسباب بنجاح' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// استرجاع أسباب السيارات المخالفة لتاريخ محدد
app.get('/api/truck-violations/:date', requireAuth, async (req, res) => {
    try {
        const date = req.params.date;
        const result = await pool.query(
            `SELECT truck_number, driver_name, trips_count, reason, details 
             FROM truck_violations 
             WHERE report_date = $1 
             ORDER BY truck_number`,
            [date]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
