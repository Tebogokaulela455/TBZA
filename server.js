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
    ssl: { 
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true 
    },
    connectionLimit: 10,
    connectTimeout: 20000, 
    enableKeepAlive: true
});

// --- 1. SYSTEM ROUTES ---

app.get('/ping', (req, res) => res.status(200).send("Institution Server Awake"));

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin') {
        return res.json({ success: true, role: 'admin', userId: 0, fullName: 'System Administrator' });
    }
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.json({ success: false, message: "User not found" });
        const match = await bcrypt.compare(password, rows[0].password);
        if (match) {
            res.json({ success: true, role: rows[0].role, userId: rows[0].id, fullName: rows[0].full_name });
        } else {
            res.json({ success: false, message: "Wrong password" });
        }
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- 2. GRADUATE & MANUAL COURSE ROUTES ---

app.post('/create-course', async (req, res) => {
    const { title, type, is_approved, ai_generated } = req.body;
    try {
        // Safety trim to prevent "Data Truncated" errors if database isn't updated yet
        const safeType = type ? type.substring(0, 50) : "Short Course";
        
        const [result] = await pool.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated) VALUES (?, ?, ?, ?)`,
            [title, safeType, is_approved || 0, ai_generated || 0]
        );
        res.json({ success: true, courseId: result.insertId });
    } catch (err) {
        console.error("SQL Error in create-course:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/add-module', async (req, res) => {
    const { courseId, title, semester } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`,
            [courseId, title, semester]
        );
        res.json({ success: true, moduleId: result.insertId });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/add-study-unit', async (req, res) => {
    const { moduleId, title, content } = req.body;
    try {
        await pool.query(`INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`, [moduleId, title, content]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/modules/:courseId', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM modules WHERE course_id = ?`, [req.params.courseId]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 3. AI GENERATOR ROUTE ---

app.post('/generate-ai-course', async (req, res) => {
    const { textbookText, courseType, title } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        // Safety trim for the 'type' column
        const safeType = courseType ? courseType.substring(0, 50) : "AI Generated";

        const [course] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated) VALUES (?, ?, 1, 1)`, 
            [title, safeType]
        );
        const courseId = course.insertId;

        const modCount = 4;
        const chunkSize = Math.floor(textbookText.length / modCount);

        for(let i = 1; i <= modCount; i++) {
            const sem = (i <= 2) ? 1 : 2;
            const [mod] = await connection.query(
                `INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`,
                [courseId, `Module ${i}: ${title} Essentials`, sem]
            );
            const start = (i - 1) * chunkSize;
            const content = textbookText.substring(start, start + chunkSize);
            await connection.query(
                `INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`,
                [mod.insertId, `Unit 1: Overview`, content]
            );
        }
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        console.error("AI Gen Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally { connection.release(); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));