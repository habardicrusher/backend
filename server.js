require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// اتصال قاعدة البيانات
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: process.env.SESSION_SECRET || 'habardicrusher_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ==================== دوال مساعدة ====================
async function query(text, params) {
    try {
        const res = await pool.query(text, params);
        return res;
    } catch (err) {
        console.error('خطأ في الاستعلام:', err);
        throw err;
    }
}

// إنشاء الجداول إذا لم تكن موجودة
async function initTables() {
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            factory TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS day_data (
            date DATE PRIMARY KEY,
            orders JSONB NOT NULL,
            distribution JSONB NOT NULL
        );
    `);
    // إضافة مستخدم افتراضي إذا لم يوجد
    const adminExists = await query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (adminExists.rows.length === 0) {
        const hashed = bcrypt.hashSync('admin', 10);
        await query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['admin', hashed, 'admin']);
        await query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['user', bcrypt.hashSync('user', 10), 'user']);
        await query('INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)', ['client', bcrypt.hashSync('client', 10), 'client', 'مصنع الفهد']);
    }
}
initTables().catch(console.error);

// ==================== واجهات API ====================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'مطلوب' });
        const result = await query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'بيانات غير صحيحة' });
        if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'بيانات غير صحيحة' });
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        res.json({ success: true, role: user.role });
    } catch (err) {
        res.status(500).json({ error: 'خطأ داخلي' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مصرح' });
    const result = await query('SELECT id, username, role FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'غير مصرح' });
    res.json({ user: result.rows[0] });
});

// إدارة المستخدمين (للمدير فقط)
app.get('/api/users', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const result = await query('SELECT id, username, role, factory, created_at FROM users ORDER BY id');
    res.json(result.rows);
});

app.post('/api/users', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { username, password, role, factory } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
    const exists = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length) return res.status(400).json({ error: 'اسم المستخدم موجود' });
    const hashed = bcrypt.hashSync(password, 10);
    const finalRole = role || 'user';
    const finalFactory = (finalRole === 'client' && factory) ? factory : null;
    await query('INSERT INTO users (username, password, role, factory) VALUES ($1, $2, $3, $4)', [username, hashed, finalRole, finalFactory]);
    res.status(201).json({ success: true });
});

app.put('/api/users/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
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
});

app.delete('/api/users/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const userId = parseInt(req.params.id);
    const user = await query('SELECT username FROM users WHERE id = $1', [userId]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'غير موجود' });
    if (user.rows[0].username === 'admin') return res.status(400).json({ error: 'لا يمكن حذف المدير الرئيسي' });
    await query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ success: true });
});

// باقي endpoints (الإعدادات، بيانات اليوم، النطاق)
app.get('/api/settings', async (req, res) => {
    const result = await query(`SELECT value FROM settings WHERE key = 'settings'`);
    if (result.rows.length) return res.json(result.rows[0].value);
    else return res.json({ trucks: [], factories: [] });
});

app.put('/api/settings', async (req, res) => {
    await query(`INSERT INTO settings (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [req.body]);
    res.json({ success: true });
});

app.get('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    const result = await query(`SELECT orders, distribution FROM day_data WHERE date = $1`, [date]);
    if (result.rows.length) res.json(result.rows[0]);
    else res.json({ orders: [], distribution: [] });
});

app.put('/api/day/:date', async (req, res) => {
    const { date } = req.params;
    const { orders, distribution } = req.body;
    await query(`INSERT INTO day_data (date, orders, distribution) VALUES ($1, $2, $3) ON CONFLICT (date) DO UPDATE SET orders = $2, distribution = $3`, [date, orders, distribution]);
    res.json({ success: true });
});

app.get('/api/range/:startDate/:endDate', async (req, res) => {
    const { startDate, endDate } = req.params;
    const result = await query(`SELECT date, orders, distribution FROM day_data WHERE date BETWEEN $1 AND $2 ORDER BY date`, [startDate, endDate]);
    const data = {};
    result.rows.forEach(row => { data[row.date] = { orders: row.orders, distribution: row.distribution }; });
    res.json(data);
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));