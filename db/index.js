const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_HGwqC4TJaXD6@ep-dawn-king-a11873v3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// اختبار الاتصال
pool.connect((err, client, release) => {
    if (err) return console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.stack);
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
    release();
});

// إنشاء جدول الإعدادات (factories, materials, trucks)
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
        // التأكد من وجود صف افتراضي
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
            console.log('✅ تم إنشاء جدول الإعدادات والبيانات الافتراضية');
        }
    } catch (err) {
        console.error('❌ خطأ في إنشاء جدول الإعدادات:', err);
    }
}
initSettingsTable();

module.exports = { pool };
