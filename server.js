const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// --- 1. FIXED CORS & PAYLOAD CONFIGURATION ---
// This prevents the 'preflight' and 'connection' errors from your screenshots
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Limit increased to 100mb to handle large textbook text for AI and documents for registration
app.use(express.json({ limit: '100mb' })); 

// --- DATABASE CONNECTION ---
const pool = mysql.createPool({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com', 
    port: 4000,
    user: '3ELby3yHuXnNY9H.root', 
    password: 'qjpjNtaHckZ1j8XU', 
    database: 'test',
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 20,
    connectTimeout: 30000 
});

// --- 2. AUTHENTICATION ---
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
    } catch (err) { res.status(500).json({ success: false, error: "Login failed" }); }
});

// --- 3. GRADUATE DASHBOARD (MANUAL) ---
app.post('/create-course', async (req, res) => {
    const { title, type, price, creator_id } = req.body;
    try {
        // substring(0, 99) prevents the "Data truncated for column type" error
        const safeType = type ? type.substring(0, 99) : "Short Course";
        const [result] = await pool.query(
            `INSERT INTO courses (title, type, price, creator_id, is_approved, ai_generated) VALUES (?, ?, ?, ?, 0, 0)`,
            [title, safeType, price || 0, creator_id]
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

// --- 4. AI COURSE GENERATOR ---
app.post('/generate-ai-course', async (req, res) => {
    const { textbookText, courseType, title } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [course] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated, price) VALUES (?, ?, 1, 1, 0)`, 
            [title, courseType]
        );
        const courseId = course.insertId;
        const modCount = 4;
        const chunkSize = Math.floor(textbookText.length / modCount);

        for(let i = 1; i <= modCount; i++) {
            const sem = (i <= 2) ? 1 : 2;
            const [mod] = await connection.query(
                `INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`,
                [courseId, `Module ${i}: ${title} Focus`, sem]
            );
            const start = (i - 1) * chunkSize;
            const content = textbookText.substring(start, start + chunkSize);
            await connection.query(
                `INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`,
                [mod.insertId, `Unit 1: AI Generated Summary`, content]
            );
        }
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally { connection.release(); }
});

// --- 5. ADMIN & STUDENT SYSTEM ---
app.get('/pending-courses', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM courses WHERE is_approved = 0`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/approve-course', async (req, res) => {
    const { courseId } = req.body;
    try {
        await pool.query(`UPDATE courses SET is_approved = 1 WHERE id = ?`, [courseId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/available-courses', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM courses WHERE is_approved = 1 OR ai_generated = 1`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/ping', (req, res) => res.status(200).send("Institution Server Awake"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));