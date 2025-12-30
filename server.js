const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' })); 
app.use(cors());

// --- DATABASE CONNECTION ---
const pool = mysql.createPool({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com', 
    port: 4000,
    user: '3ELby3yHuXnNY9H.root', 
    password: 'qjpjNtaHckZ1j8XU', 
    database: 'test',
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionLimit: 10,
    connectTimeout: 20000, 
    enableKeepAlive: true
});

const MERCHANT_ID = '32880521';
const MERCHANT_KEY = 'wfx9nr9j9cvlm';

// --- 1. AUTH & SYSTEM ---
app.get('/ping', (req, res) => res.status(200).send("Institution Server Awake"));

app.post('/register', async (req, res) => {
    const { username, password, role, fullName, surname, idNumber, cellphone, address, docBase64 } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (username, password, role, full_name, surname, id_number, cellphone, address, highest_grade_doc) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, role, fullName, surname, idNumber, cellphone, address, docBase64]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        if (username === 'admin' && password === 'admin') {
            return res.json({ success: true, role: 'admin', userId: 0, fullName: 'System Admin' });
        }
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.json({ success: false, message: "User not found" });
        const match = await bcrypt.compare(password, rows[0].password);
        if (match) {
            res.json({ success: true, role: rows[0].role, userId: rows[0].id, fullName: rows[0].full_name });
        } else { res.json({ success: false, message: "Wrong password" }); }
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- 2. GRADUATE DASHBOARD (CREATE WITH PRICING) ---

app.post('/create-course', async (req, res) => {
    const { title, type, price, creator_id } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO courses (title, type, price, creator_id, is_approved, ai_generated) VALUES (?, ?, ?, ?, 0, 0)`,
            [title, type, price || 0, creator_id]
        );
        res.json({ success: true, courseId: result.insertId });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/add-module', async (req, res) => {
    const { courseId, title, semester } = req.body;
    try {
        const [result] = await pool.query(`INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`, [courseId, title, semester]);
        res.json({ success: true, moduleId: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/add-study-unit', async (req, res) => {
    const { moduleId, title, content } = req.body;
    try {
        await pool.query(`INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`, [moduleId, title, content]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. ADMIN & STUDENT ROUTES ---

// Admin Approval Route
app.post('/approve-course', async (req, res) => {
    const { courseId } = req.body;
    try {
        await pool.query(`UPDATE courses SET is_approved = 1 WHERE id = ?`, [courseId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Student Dashboard: ONLY SHOW APPROVED
app.get('/available-courses', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM courses WHERE is_approved = 1`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PayFast Signature
app.post('/payfast-signature', (req, res) => {
    const { amount, itemName } = req.body;
    let pfString = `merchant_id=${MERCHANT_ID}&merchant_key=${MERCHANT_KEY}&amount=${amount}&item_name=${itemName}`;
    const signature = crypto.createHash('md5').update(pfString).digest('hex');
    res.json({ signature });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));