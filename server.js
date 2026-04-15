require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== إعداد اتصال قاعدة البيانات (UTF-8 إجباري) ==========
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    options: '-c client_encoding=UTF8'
});

pool.connect((err) => {
    if (err) console.error('❌ فشل اتصال قاعدة البيانات:', err.message);
    else console.log('✅ تم الاتصال بقاعدة البيانات (UTF-8)');
});

// ========== دوال مساعدة ==========
async function addLog(username, action, details, location) {
    try {
        await pool.query(
            `INSERT INTO logs (username, action, details, location, created_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [username, action, details, location]
        );
    } catch (e) { console.error('خطأ في السجل:', e.message); }
}

async function getLogs(limit, offset) {
    const res = await pool.query(
        `SELECT * FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return res.rows;
}

async function getLogsCount() {
    const res = await pool.query(`SELECT COUNT(*) FROM logs`);
    return parseInt(res.rows[0].count);
}

// ========== Middleware ==========
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gravel-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
    name: 'gravel.sid',
    rolling: true
}));

// ضبط الترميز لاستجابات API فقط (وليس HTML)
app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'غير مصرح' });
}

function requireAdmin(req, res, next) {
    if (req.session?.user?.role === 'admin') return next();
    res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
}

// ========== إنشاء الجداول والبيانات الافتراضية ==========
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
            );
        `);
        // المستخدم admin
        const adminCheck = await pool.query(`SELECT id FROM users WHERE username = 'Admin'`);
        if (adminCheck.rows.length === 0) {
            const hashed = bcrypt.hashSync('admin123', 10);
            await pool.query(
                `INSERT INTO users (username, password, role, permissions) VALUES ($1, $2, $3, $4)`,
                ['Admin', hashed, 'admin', JSON.stringify({ manageUsers: true, manageSettings: true, manageRestrictions: true })]
            );
            console.log('✅ تم إنشاء حساب المدير: Admin / admin123');
        }

        // السيارات الـ 74 الافتراضية
        const settingsCheck = await pool.query(`SELECT trucks FROM app_settings WHERE id = 1`);
        let existingTrucks = [];
        if (settingsCheck.rows.length > 0 && settingsCheck.rows[0].trucks) {
            existingTrucks = settingsCheck.rows[0].trucks;
        }
        if (existingTrucks.length === 0) {
            const defaultTrucks = [
                { number: "1091", driver: "سينج" }, { number: "2757", driver: "انيس" },
                { number: "2758", driver: "عارف" }, { number: "2759", driver: "عتيق الاسلام" },
                { number: "2760", driver: "سليمان" }, { number: "2762", driver: "زرداد" },
                { number: "2818", driver: "شهداب" }, { number: "2927", driver: "مدثر" },
                { number: "2928", driver: "سمر اقبال" }, { number: "2929", driver: "عرفان شبير" },
                { number: "3321", driver: "وقاص" }, { number: "3322", driver: "نعيم" },
                { number: "3324", driver: "مجمد كليم" }, { number: "3325", driver: "اجسان" },
                { number: "3326", driver: "نويد" }, { number: "3461", driver: "جيفان كومار" },
                { number: "3462", driver: "افتخار" }, { number: "3963", driver: "شكيل" },
                { number: "4445", driver: "عرفان" }, { number: "5324", driver: "بابر" },
                { number: "5367", driver: "سلفر تان" }, { number: "5520", driver: "نابين" },
                { number: "5521", driver: "فضل" }, { number: "5522", driver: "عبيدالله" },
                { number: "5523", driver: "مجمد فيصل" }, { number: "5524", driver: "بير مجمد" },
                { number: "5525", driver: "صدير الاسلام" }, { number: "5526", driver: "مجمد عبدو" },
                { number: "5527", driver: "سکير" }, { number: "5528", driver: "تشاندان" },
                { number: "5658", driver: "مسعود خان" }, { number: "5796", driver: "ساهيل طارق" },
                { number: "5797", driver: "عبد القادر" }, { number: "5800", driver: "غوا مجمد" },
                { number: "6398", driver: "نديم خان" }, { number: "6428", driver: "برديب" },
                { number: "6429", driver: "طاهر" }, { number: "6430", driver: "سليمان غولزار" },
                { number: "6432", driver: "برويز اختر" }, { number: "6612", driver: "ذو القرنين" },
                { number: "6613", driver: "نظيم خان" }, { number: "6614", driver: "فينود" },
                { number: "6615", driver: "رسول" }, { number: "6616", driver: "يعقوب" },
                { number: "6617", driver: "اظهر" }, { number: "6618", driver: "عثمان" },
                { number: "6619", driver: "مينا خان" }, { number: "6620", driver: "مجمد ساجل" },
                { number: "6621", driver: "اسد" }, { number: "6622", driver: "مانوج" },
                { number: "6623", driver: "خالد رجمان" }, { number: "6624", driver: "هداية" },
                { number: "6626", driver: "HARENDRA" }, { number: "6629", driver: "جاويد" },
                { number: "6935", driver: "تيمور" }, { number: "6939", driver: "ارشد" },
                { number: "7042", driver: "فيراس" }, { number: "7043", driver: "ايوب خان" },
                { number: "7332", driver: "علي رضا" }, { number: "7682", driver: "خالد" },
                { number: "7750", driver: "نديم" }, { number: "7837", driver: "ارسلان" },
                { number: "7926", driver: "سجاد" }, { number: "7927", driver: "اكبر" },
                { number: "7928", driver: "امير" }, { number: "7929", driver: "طاهر محمود" },
                { number: "7930", driver: "نارندر" }, { number: "7974", driver: "شريف" },
                { number: "7980", driver: "شعيب" }, { number: "9103", driver: "ساكب" },
                { number: "9492", driver: "عدنان" }, { number: "9493", driver: "عامر" },
                { number: "9495", driver: "ميزان" }, { number: "9496", driver: "غفور احمد" }
            ];
            const defaultFactories = [
                { name: 'SCCCL', location: 'الدمام' }, { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' },
                { name: 'الحارثي القديم', location: 'الدمام' }, { name: 'المعجل لمنتجات الاسمنت', location: 'الدمام' },
                { name: 'الحارث العزيزية', location: 'الدمام' }, { name: 'سارمكس النظيم', location: 'الرياض' },
                { name: 'عبر الخليج', location: 'الرياض' }, { name: 'الكفاح للخرسانة الجاهزة', location: 'الدمام' },
                { name: 'القيشان 3', location: 'الدمام' }, { name: 'القيشان 2 - الأحجار الشرقية', location: 'الدمام' },
                { name: 'القيشان 1', location: 'الدمام' }, { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
            ];
            const defaultMaterials = ['3/4', '3/8', '3/16'];
            await pool.query(
                `INSERT INTO app_settings (id, factories, materials, trucks, updated_at)
                 VALUES (1, $1, $2, $3, NOW())
                 ON CONFLICT (id) DO UPDATE SET factories = $1, materials = $2, trucks = $3, updated_at = NOW()`,
                [JSON.stringify(defaultFactories), JSON.stringify(defaultMaterials), JSON.stringify(defaultTrucks)]
            );
            console.log(`✅ تم إضافة ${defaultTrucks.length} سيارة بشكل افتراضي`);
        } else {
            console.log(`✅ توجد سيارات موجودة مسبقاً: ${existingTrucks.length} سيارة`);
        }
        console.log('✅ تم التحقق من الجداول');
    } catch (err) {
        console.error('❌ خطأ في إنشاء الجداول:', err.message);
    }
}
initTables();

// ========== مسارات API ==========

// تسجيل الدخول والخروج
app.post('/api/login', async (req, res) => {
    try {
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
        await addLog(req.session.user.username, 'تسجيل دخول', `تسجيل دخول ${username}`, req.session.user.factory || 'المكتب الرئيسي');
        res.json({ success: true, user: req.session.user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/logout', async (req, res) => {
    const username = req.session?.user?.username;
    if (username) await addLog(username, 'تسجيل خروج', `تسجيل خروج ${username}`, req.session.user?.factory || 'المكتب الرئيسي');
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
});

// الإعدادات
app.get('/api/settings', requireAuth, async (req, res) => {
    try {
        const settings = (await pool.query('SELECT factories, materials, trucks FROM app_settings WHERE id = 1')).rows[0] || {
            factories: [],
            materials: [],
            trucks: []
        };
        if (req.session.user.role === 'client' && req.session.user.factory) {
            settings.factories = settings.factories.filter(f => f.name === req.session.user.factory);
        }
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { factories, materials, trucks } = req.body;
        await pool.query(
            `INSERT INTO app_settings (id, factories, materials, trucks, updated_at)
             VALUES (1, $1, $2, $3, NOW())
             ON CONFLICT (id) DO UPDATE SET factories = $1, materials = $2, trucks = $3, updated_at = NOW()`,
            [JSON.stringify(factories), JSON.stringify(materials), JSON.stringify(trucks)]
        );
        await addLog(req.session.user.username, 'تحديث الإعدادات', `المصانع: ${factories.length}, المواد: ${materials.length}, السيارات: ${trucks.length}`, null);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// البيانات اليومية
app.get('/api/day/:date', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT orders, distribution FROM daily_data WHERE date = $1', [req.params.date]);
        if (result.rows.length === 0) return res.json({ orders: [], distribution: [] });
        res.json({ orders: result.rows[0].orders, distribution: result.rows[0].distribution });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/day/:date', requireAuth, async (req, res) => {
    try {
        const { orders, distribution } = req.body;
        await pool.query(
            `INSERT INTO daily_data (date, orders, distribution) VALUES ($1, $2, $3)
             ON CONFLICT (date) DO UPDATE SET orders = $2, distribution = $3`,
            [req.params.date, JSON.stringify(orders), JSON.stringify(distribution)]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// إدارة المستخدمين
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = (await pool.query('SELECT id, username, role, factory, permissions, created_at FROM users')).rows;
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const user = (await pool.query('SELECT username FROM users WHERE id = $1', [id])).rows[0];
        if (user?.username === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        await addLog(req.session.user.username, 'حذف مستخدم', `المستخدم: ${user?.username}`, null);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// قيود الحظر
app.get('/api/restrictions', requireAuth, async (req, res) => {
    try {
        const restrictions = (await pool.query('SELECT * FROM restrictions ORDER BY created_at DESC')).rows;
        res.json(restrictions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/restrictions', requireAuth, async (req, res) => {
    try {
        if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
        const { truckNumber, driverName, restrictedFactories, reason } = req.body;
        const result = await pool.query(
            `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [truckNumber, driverName, JSON.stringify(restrictedFactories), reason, req.session.user.username]
        );
        await addLog(req.session.user.username, 'إضافة قيد حظر', `السيارة: ${truckNumber}`, null);
        res.json(result.rows[0]);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/restrictions/:id', requireAuth, async (req, res) => {
    try {
        if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
        const { active } = req.body;
        await pool.query('UPDATE restrictions SET active = $1 WHERE id = $2', [active, req.params.id]);
        await addLog(req.session.user.username, 'تعديل قيد حظر', `القيد ${req.params.id}`, null);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/restrictions/:id', requireAuth, async (req, res) => {
    try {
        if (!req.session.user.permissions?.manageRestrictions) return res.status(403).json({ error: 'غير مصرح' });
        await pool.query('DELETE FROM restrictions WHERE id = $1', [req.params.id]);
        await addLog(req.session.user.username, 'حذف قيد حظر', `القيد ${req.params.id}`, null);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// تقارير الميزان (scale_reports)
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

// مسارات السيارات المخالفة (truck-violations)
app.post('/api/truck-violations/save', requireAuth, async (req, res) => {
    try {
        const { date, violations } = req.body;
        if (!date || !Array.isArray(violations)) {
            return res.status(400).json({ error: 'بيانات غير صالحة' });
        }
        const username = req.session.user.username;
        for (const v of violations) {
            await pool.query(`
                INSERT INTO truck_violations (report_date, truck_number, driver_name, trips_count, reason, details, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (report_date, truck_number) 
                DO UPDATE SET driver_name = EXCLUDED.driver_name, trips_count = EXCLUDED.trips_count, reason = EXCLUDED.reason, details = EXCLUDED.details, created_by = EXCLUDED.created_by
            `, [date, v.truckNumber, v.driver, v.trips, v.reason, v.detail, username]);
        }
        await addLog(username, 'حفظ أسباب السيارات المخالفة', `التاريخ: ${date}, عدد السيارات: ${violations.length}`, null);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/truck-violations/:date', requireAuth, async (req, res) => {
    try {
        const date = req.params.date;
        const result = await pool.query(
            `SELECT truck_number, driver_name, trips_count, reason, details FROM truck_violations WHERE report_date = $1 ORDER BY truck_number`,
            [date]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/truck-violations/report/:startDate/:endDate', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        const result = await pool.query(
            `SELECT * FROM truck_violations WHERE report_date BETWEEN $1 AND $2 ORDER BY report_date DESC, truck_number`,
            [startDate, endDate]
        );
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/truck-violations/stats/:startDate/:endDate', requireAuth, async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        const stats = await pool.query(`
            SELECT 
                COUNT(DISTINCT truck_number) as total_trucks,
                COUNT(*) as total_violations,
                COALESCE(AVG(trips_count), 0) as avg_trips,
                SUM(CASE WHEN trips_count = 0 THEN 1 ELSE 0 END) as zero_trips_count
            FROM truck_violations 
            WHERE report_date BETWEEN $1 AND $2
        `, [startDate, endDate]);
        const topTrucks = await pool.query(`
            SELECT truck_number, driver_name, COUNT(*) as violation_count, COALESCE(AVG(trips_count), 0) as avg_trips
            FROM truck_violations 
            WHERE report_date BETWEEN $1 AND $2
            GROUP BY truck_number, driver_name
            ORDER BY violation_count DESC
            LIMIT 10
        `, [startDate, endDate]);
        const topReasons = await pool.query(`
            SELECT reason, COUNT(*) as count
            FROM truck_violations 
            WHERE report_date BETWEEN $1 AND $2 AND reason != ''
            GROUP BY reason
            ORDER BY count DESC
            LIMIT 10
        `, [startDate, endDate]);
        res.json({
            general: stats.rows[0],
            topTrucks: topTrucks.rows,
            topReasons: topReasons.rows
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// تقارير قديمة (reports)
app.get('/api/reports', requireAuth, async (req, res) => {
    try {
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// النسخ الاحتياطي والاستعادة
app.get('/api/backup', requireAuth, requireAdmin, async (req, res) => {
    try {
        const settings = (await pool.query('SELECT factories, materials, trucks FROM app_settings WHERE id = 1')).rows[0] || {};
        const users = (await pool.query('SELECT id, username, role, factory, permissions FROM users')).rows;
        const restrictions = (await pool.query('SELECT * FROM restrictions')).rows;
        res.json({ settings, users, restrictions, exportDate: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/restore', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = req.body;
        if (data.settings) {
            await pool.query(
                `INSERT INTO app_settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3) ON CONFLICT (id) DO UPDATE SET factories = $1, materials = $2, trucks = $3`,
                [JSON.stringify(data.settings.factories || []), JSON.stringify(data.settings.materials || []), JSON.stringify(data.settings.trucks || [])]
            );
        }
        if (data.restrictions) {
            await pool.query('DELETE FROM restrictions');
            for (const r of data.restrictions) {
                await pool.query(
                    `INSERT INTO restrictions (truck_number, driver_name, restricted_factories, reason, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
                    [r.truck_number, r.driver_name, r.restricted_factories, r.reason, r.created_by, r.created_at]
                );
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/clear-all', requireAuth, requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM daily_data');
        await pool.query('DELETE FROM restrictions');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// سجلات النظام
app.get('/api/logs', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        const logs = await getLogs(limit, offset);
        const total = await getLogsCount();
        res.json({ logs, currentPage: page, totalPages: Math.ceil(total / limit), total });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/logs/all', requireAuth, async (req, res) => {
    if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    try {
        const logs = await getLogs(10000, 0);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/logs/clear', requireAuth, requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM logs');
        await addLog(req.session.user.username, 'مسح السجلات', 'قام بحذف جميع سجلات النظام', null);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ========== خدمة الملفات الثابتة والصفحات المحمية ==========
const protectedPages = [
    'index.html', 'orders.html', 'distribution.html', 'trucks.html',
    'products.html', 'factories.html', 'reports.html', 'settings.html',
    'restrictions.html', 'users.html', 'logs.html', 'upload-report.html',
    'scale_report.html', 'trucks-failed.html', 'trucks-failed-report.html'
];
protectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session || !req.session.user) return res.redirect('/login.html');
        if (req.session.user.role === 'client' && page !== 'orders.html') return res.redirect('/orders.html');
        res.sendFile(path.join(__dirname, page));
    });
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/', (req, res) => {
    if (req.session?.user) {
        if (req.session.user.role === 'client') res.redirect('/orders.html');
        else res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

app.use(express.static(__dirname));

// ========== تشغيل السيرفر ==========
app.listen(PORT, () => {
    console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`👤 المدير: Admin`);
    console.log(`🔐 كلمة المرور: admin123`);
});