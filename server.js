const express = require('express');
const session = require('express-session');
// استخدام bcryptjs بدلاً من bcrypt لتجنب تحذيرات التثبيت (نفس الوظيفة)
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== المجلدات ====================
const DATA_DIR = path.join(__dirname, 'data');
const DAYS_DIR = path.join(DATA_DIR, 'days');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DAYS_DIR)) fs.mkdirSync(DAYS_DIR, { recursive: true });

// ==================== البيانات الافتراضية (بما فيها المصانع والسيارات التي أرسلتها) ====================
const defaultSettings = {
    factories: [
        { name: 'SCCCL', location: 'الرياض' },
        { name: 'الحارث للمنتجات الاسمنيه', location: 'الرياض' },
        { name: 'الحارثي القديم', location: 'الرياض' },
        { name: 'المعجل لمنتجات الاسمنت', location: 'الرياض' },
        { name: 'الحارث العزيزية', location: 'الرياض' },
        { name: 'سارمكس النظيم', location: 'الرياض' },
        { name: 'عبر الخليج', location: 'الرياض' },
        { name: 'الكفاح للخرسانة الجاهزة', location: 'الرياض' },
        { name: 'القيشان 3', location: 'الرياض' },
        { name: 'القيشان 2 - الأحجار الشرقية', location: 'الرياض' },
        { name: 'القيشان 1', location: 'الرياض' },
        { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
    ],
    materials: ['3/4', '3/8', '3/16'],
    trucks: [
        { number: '1091', driver: 'سينج' }, { number: '2757', driver: 'انيس' }, { number: '2758', driver: 'عارف' },
        { number: '2759', driver: 'عتيق الاسلام' }, { number: '2760', driver: 'سليمان' }, { number: '2762', driver: 'زرداد' },
        { number: '2818', driver: 'شهداب' }, { number: '2927', driver: 'مدثر' }, { number: '2928', driver: 'سمر اقبال' },
        { number: '2929', driver: 'عرفان شبير' }, { number: '3321', driver: 'وقاص' }, { number: '3322', driver: 'نعيم' },
        { number: '3324', driver: 'محمد كليم' }, { number: '3325', driver: 'احسان' }, { number: '3326', driver: 'نويد' },
        { number: '3461', driver: 'جيفان كومار' }, { number: '3462', driver: 'افتخار' }, { number: '3963', driver: 'شكيل' },
        { number: '4445', driver: 'عرفان' }, { number: '5324', driver: 'بابر' }, { number: '5367', driver: 'سلفر تان' },
        { number: '5520', driver: 'نابين' }, { number: '5521', driver: 'فضل' }, { number: '5522', driver: 'عبيدالله' },
        { number: '5523', driver: 'محمد فيصل' }, { number: '5524', driver: 'بير محمد' }, { number: '5525', driver: 'صدير الاسلام' },
        { number: '5526', driver: 'محمد عبدو' }, { number: '5527', driver: 'سكير' }, { number: '5528', driver: 'تشاندان' },
        { number: '5658', driver: 'مسعود خان' }, { number: '5796', driver: 'ساهيل طارق' }, { number: '5797', driver: 'عبد القادر' },
        { number: '5800', driver: 'غوا محمد' }, { number: '6398', driver: 'نديم خان' }, { number: '6428', driver: 'برديب' },
        { number: '6429', driver: 'طاهر' }, { number: '6430', driver: 'سليمان غولزار' }, { number: '6432', driver: 'برويز اختر' },
        { number: '6612', driver: 'ذو القرنين' }, { number: '6613', driver: 'نظيم خان' }, { number: '6614', driver: 'فينود' },
        { number: '6615', driver: 'رسول' }, { number: '6616', driver: 'يعقوب' }, { number: '6617', driver: 'اظهر' },
        { number: '6618', driver: 'عثمان' }, { number: '6619', driver: 'مينا خان' }, { number: '6620', driver: 'محمد ساحل' },
        { number: '6621', driver: 'اسد' }, { number: '6622', driver: 'مانوج' }, { number: '6623', driver: 'خالد رحمان' },
        { number: '6624', driver: 'هداية' }, { number: '6626', driver: 'HARENDRA' }, { number: '6629', driver: 'جاويد' },
        { number: '6935', driver: 'تيمور' }, { number: '6939', driver: 'ارشد' }, { number: '7042', driver: 'فيراس' },
        { number: '7043', driver: 'ايوب خان' }, { number: '7332', driver: 'علي رضا' }, { number: '7682', driver: 'خالد' },
        { number: '7750', driver: 'نديم' }, { number: '7837', driver: 'ارسلان' }, { number: '7926', driver: 'سجاد' },
        { number: '7927', driver: 'اكبر' }, { number: '7928', driver: 'امير' }, { number: '7929', driver: 'طاهر محمود' },
        { number: '7930', driver: 'ناريندر' }, { number: '7974', driver: 'شريف' }, { number: '7980', driver: 'شعيب' },
        { number: '9103', driver: 'ساكب' }, { number: '9492', driver: 'عدنان' }, { number: '9493', driver: 'عامر' },
        { number: '9495', driver: 'ميزان' }, { number: '9496', driver: 'غفور احمد' }
    ]
};

// ==================== Middleware ====================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'gravel-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// ==================== Helper Functions (نفس الكود القديم) ====================
function readJSON(filename) { /* ... */ }
function writeJSON(filename, data) { /* ... */ }
function readDayData(date) { /* ... */ }
function writeDayData(date, data) { /* ... */ }
function addLog(user, action, details = '') { /* ... */ }
function migrateFactories(settings) { /* ... */ }
function requireAuth(req, res, next) { /* ... */ }
function requireAdmin(req, res, next) { /* ... */ }

// ... (كل الدوال المساعدة كما هي، لم تتغير) ...

// ==================== تهيئة البيانات (التعديل هنا) ====================
function initializeData() {
    if (!readJSON('users.json')) {
        // ✅ التعديل: تغيير كلمة المرور من admin123 إلى Live#5050
        const hashedPassword = bcrypt.hashSync('Live#5050', 10);
        writeJSON('users.json', [{
            id: 1, username: 'Admin', password: hashedPassword, role: 'admin',
            permissions: {
                viewOrders: true, addOrders: true, editOrders: true, deleteOrders: true,
                viewDistribution: true, manageDistribution: true, viewTrucks: true, manageTrucks: true,
                viewReports: true, exportReports: true, viewSettings: true, manageSettings: true,
                viewBackup: true, manageBackup: true, manageUsers: true, manageRestrictions: true
            }, createdAt: new Date().toISOString()
        }]);
        console.log('✅ تم إنشاء حساب المدير: Admin / Live#5050');
    }
    let settings = readJSON('settings.json');
    if (!settings) {
        writeJSON('settings.json', defaultSettings);
        console.log('✅ تم إنشاء الإعدادات الافتراضية');
    } else {
        const migrated = migrateFactories(settings);
        if (migrated !== settings) writeJSON('settings.json', migrated);
    }
    if (!readJSON('restrictions.json')) writeJSON('restrictions.json', []);
    if (!readJSON('logs.json')) writeJSON('logs.json', []);
}
initializeData();

// ==================== باقي الـ API Routes كما هي (لم تتغير) ====================
// ... (كل المسارات: /api/login, /api/settings, /api/day/:date ... إلخ) ...

// ==================== تشغيل السيرفر (التعديل هنا) ====================
app.listen(PORT, () => {
    // ✅ التعديل: إزالة النص العربي بالكامل واستبداله برسالة إنجليزية بسيطة
    console.log('====================================');
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('====================================');
});
