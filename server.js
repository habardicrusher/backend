const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { pool } = require('./db');

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

// استيراد جميع المسارات
require('./routes/authRoutes')(app);
require('./routes/userRoutes')(app);
require('./routes/orderRoutes')(app);
require('./routes/restrictionRoutes')(app);
require('./routes/reportRoutes')(app);
require('./routes/settingsRoutes')(app);

// ==================== صفحات HTML ====================
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        // العملاء (clients) يذهبون فقط لصفحة الطلبات
        if (req.session.user.role === 'client') {
            res.redirect('/orders.html');
        } 
        // المدير (admin) والمستخدم العادي (user) يذهبون للرئيسية
        else {
            res.redirect('/index.html');
        }
    } else {
        res.redirect('/login.html');
    }
});

// الصفحات المحمية (باستثناء login)
const allProtectedPages = ['index.html', 'orders.html', 'distribution.html', 'trucks.html', 'products.html', 'factories.html', 'reports.html', 'settings.html', 'restrictions.html', 'users.html', 'logs.html'];

allProtectedPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        if (!req.session || !req.session.user) {
            return res.redirect('/login.html');
        }
        const role = req.session.user.role;
        // العملاء (clients) يسمح لهم فقط بـ orders.html
        if (role === 'client') {
            if (page === 'orders.html') {
                res.sendFile(path.join(__dirname, page));
            } else {
                res.redirect('/orders.html');
            }
        }
        // المدير (admin) والمستخدم العادي (user) يسمح لهم بكل الصفحات
        else if (role === 'admin' || role === 'user') {
            res.sendFile(path.join(__dirname, page));
        }
        else {
            res.redirect('/login.html');
        }
    });
});

// خدمة الملفات الثابتة (CSS, JS, images) مع منع الوصول المباشر لملفات HTML المحمية
app.use(express.static(__dirname, {
    setHeaders: (res, filePath) => {
        const base = path.basename(filePath);
        if (allProtectedPages.includes(base) || base === 'login.html') {
            res.status(404).end();
        }
    }
}));

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
