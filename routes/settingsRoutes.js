const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

module.exports = function(app) {
    // الحصول على الإعدادات (المصانع، المواد، السيارات)
    app.get('/api/settings', requireAuth, async (req, res) => {
        try {
            const result = await pool.query('SELECT factories, materials, trucks FROM app_settings WHERE id = 1');
            if (result.rows.length === 0) {
                // إذا لم يجد الصف (حالة نادرة) نعيد قيماً افتراضية
                return res.json({
                    factories: [
                        { name: 'SCCCL', location: 'الدمام' },
                        { name: 'الحارث للمنتجات الاسمنيه', location: 'الدمام' }
                    ],
                    materials: ['3/4', '3/8', '3/16'],
                    trucks: []
                });
            }
            const row = result.rows[0];
            res.json({
                factories: row.factories,
                materials: row.materials,
                trucks: row.trucks
            });
        } catch (err) {
            console.error('خطأ في GET /api/settings:', err);
            res.status(500).json({ error: 'فشل في تحميل الإعدادات' });
        }
    });

    // حفظ الإعدادات (المصانع، المواد، السيارات)
    app.put('/api/settings', requireAuth, async (req, res) => {
        try {
            const { factories, materials, trucks } = req.body;
            await pool.query(
                `UPDATE app_settings SET factories = $1, materials = $2, trucks = $3, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
                [JSON.stringify(factories), JSON.stringify(materials), JSON.stringify(trucks)]
            );
            res.json({ success: true });
        } catch (err) {
            console.error('خطأ في PUT /api/settings:', err);
            res.status(500).json({ error: 'فشل في حفظ الإعدادات' });
        }
    });
};
