const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// مجلد حفظ البيانات اليومية
const DATA_DIR = path.join(__dirname, 'data');
// ملف الإعدادات (السيارات والمصانع)
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// التأكد من وجود مجلد البيانات
(async () => {
    try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch(e) {}
})();

// Middlewares
app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: 'كسارة_الحبردي_سر_آمن',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ==================== دوال مساعدة ====================
async function loadSettings() {
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        // إعدادات افتراضية
        return {
            trucks: [
                { number: "1", driver: "سائق 1" },
                { number: "2", driver: "سائق 2" },
                { number: "3", driver: "سائق 3" }
            ],
            factories: [
                { name: "مصنع الفهد", location: "الرياض" },
                { name: "مصنع القيشان 1", location: "الدمام" }
            ]
        };
    }
}

async function getDayData(date) {
    const filePath = path.join(DATA_DIR, `${date}.json`);
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return { orders: [], distribution: [] };
        throw err;
    }
}

async function saveDayData(date, data) {
    const filePath = path.join(DATA_DIR, `${date}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ==================== Endpoints ====================
// التحقق من المصادقة (لتبسيط العرض، نقبل أي مستخدم في هذا المثال)
app.get('/api/me', (req, res) => {
    // في الحقيقة هنا يجب التحقق من تسجيل الدخول.
    // للاختبار، نعيد مستخدم عادي.
    if (!req.session.userId) {
        // إنشاء جلسة وهمية
        req.session.userId = 'admin';
        req.session.role = 'admin';
    }
    res.json({ user: { id: req.session.userId, role: req.session.role || 'admin' } });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// جلب الإعدادات
app.get('/api/settings', async (req, res) => {
    const settings = await loadSettings();
    res.json(settings);
});

// جلب بيانات يوم محدد
app.get('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    const data = await getDayData(date);
    res.json(data);
});

// حفظ بيانات يوم محدد
app.put('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    await saveDayData(date, req.body);
    res.json({ success: true });
});

// ** التحسين الجديد: جلب نطاق زمني دفعة واحدة **
app.get('/api/range/:startDate/:endDate', async (req, res) => {
    try {
        const { startDate, endDate } = req.params;
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start) || isNaN(end)) {
            return res.status(400).json({ error: 'تواريخ غير صالحة' });
        }

        const dates = [];
        let current = new Date(start);
        while (current <= end) {
            dates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
        }

        const results = {};
        for (const date of dates) {
            results[date] = await getDayData(date);
        }
        res.json(results);
    } catch (error) {
        console.error('خطأ في /api/range:', error);
        res.status(500).json({ error: 'خطأ داخلي في الخادم' });
    }
});

// بدء الخادم
app.listen(PORT, () => {
    console.log(`الخادم يعمل على http://localhost:${PORT}`);
    console.log(`تأكد من وضع ملفات HTML في مجلد "public"`);
});
