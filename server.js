const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const { pool } = require('./db');
const seedInitialData = require('./utils/seedData');

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

// استيراد جميع المسارات (routes)
require('./routes/authRoutes')(app);
require('./routes/userRoutes')(app);
require('./routes/orderRoutes')(app);
require('./routes/restrictionRoutes')(app);
require('./routes/reportRoutes')(app);
require('./routes/settingsRoutes')(app);

// صفحات HTML (ثابتة)
app.get('/login.html', (req, res) => { res.sendFile(path.join(__dirname, 'login.html')); });
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

// إنشاء الجداول ثم إدخال البيانات الأولية ثم تشغيل السيرفر
async function start() {
    try {
        // إنشاء الجداول (إذا لم تكن موجودة)
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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS daily_data (
                date DATE PRIMARY KEY,
                orders JSONB NOT NULL DEFAULT '[]',
                distribution JSONB NOT NULL DEFAULT '[]'
            );
        `);
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
        console.log('✅ تم التأكد من وجود الجداول');

        // إدخال البيانات الافتراضية (المستخدمين)
        await seedInitialData();

        // بدء تشغيل السيرفر
        app.listen(PORT, () => {
            console.log(`🚀 Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ فشل في بدء التشغيل:', err);
        process.exit(1);
    }
}

start();
