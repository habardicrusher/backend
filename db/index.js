const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_HGwqC4TJaXD6@ep-dawn-king-a11873v3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) return console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.stack);
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
    release();
});

// إنشاء جدول الإعدادات
async function initSettingsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                factories JSONB NOT NULL DEFAULT '[]',
                materials JSONB NOT NULL DEFAULT '[]',
                trucks JSONB NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        const res = await pool.query('SELECT * FROM app_settings WHERE id = 1');
        if (res.rows.length === 0) {
            const defaultFactories = [
                { name: 'SCCCL', location: 'الدمام' },
                { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' },
                { name: 'الحارثي القديم', location: 'الدمام' },
                { name: 'المعجل لمنتجات الاسمنت', location: 'الدمام' },
                { name: 'الحارث العزيزية', location: 'الدمام' },
                { name: 'سارمكس النظيم', location: 'الرياض' },
                { name: 'عبر الخليج', location: 'الرياض' },
                { name: 'الكفاح للخرسانة الجاهزة', location: 'الدمام' },
                { name: 'القيشان 3', location: 'الدمام' },
                { name: 'القيشان 2 - الأحجار الشرقية', location: 'الدمام' },
                { name: 'القيشان 1', location: 'الدمام' },
                { name: 'الفهد للبلوك والخرسانة', location: 'الرياض' }
            ];
            const defaultMaterials = ['3/4', '3/8', '3/16'];
            await pool.query(
                'INSERT INTO app_settings (id, factories, materials, trucks) VALUES (1, $1, $2, $3)',
                [JSON.stringify(defaultFactories), JSON.stringify(defaultMaterials), JSON.stringify([])]
            );
            console.log('✅ تم إنشاء جدول الإعدادات');
        }
    } catch (err) {
        console.error('❌ خطأ في إنشاء جدول الإعدادات:', err);
    }
}

// إنشاء جدول السجلات (مع عمود location)
async function initLogsTable() {
    try {
        // إنشاء الجدول إذا لم يكن موجوداً
        await pool.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100),
                action VARCHAR(255),
                details TEXT,
                location VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // التحقق من وجود عمود location وإضافته إذا كان مفقوداً
        const checkColumn = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'logs' AND column_name = 'location'
        `);
        
        if (checkColumn.rows.length === 0) {
            await pool.query(`ALTER TABLE logs ADD COLUMN location VARCHAR(100);`);
            console.log('✅ تم إضافة عمود location إلى جدول السجلات');
        }
        
        console.log('✅ جدول السجلات جاهز');
    } catch (err) {
        console.error('❌ خطأ في إنشاء جدول السجلات:', err);
    }
}

// دالة إضافة سجل
async function addLog(username, action, details = null, location = null) {
    try {
        await pool.query(
            'INSERT INTO logs (username, action, details, location) VALUES ($1, $2, $3, $4)',
            [username, action, details, location]
        );
    } catch (err) {
        console.error('خطأ في حفظ السجل:', err);
    }
}

async function getLogs(limit = 500, offset = 0) {
    const res = await pool.query(
        'SELECT * FROM logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
    );
    return res.rows;
}

async function getLogsCount() {
    const res = await pool.query('SELECT COUNT(*) FROM logs');
    return parseInt(res.rows[0].count);
}

// تشغيل دوال التهيئة
initSettingsTable();
initLogsTable();

module.exports = { pool, addLog, getLogs, getLogsCount };
