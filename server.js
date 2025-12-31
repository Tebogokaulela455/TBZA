const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '100mb' }));

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

// --- FIXED LOGIN (Admin: admin/admin) ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    // Admin Override
    if (username === 'admin' && password === 'admin') {
        return res.json({ success: true, role: 'admin', userId: 999 });
    }

    try {
        const [rows] = await pool.query(`SELECT * FROM users WHERE username = ?`, [username]);
        if (rows.length === 0) return res.status(401).json({ error: "User not found" });

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        
        if (match) {
            res.json({ success: true, role: user.role, userId: user.id });
        } else {
            res.status(401).json({ error: "Wrong password" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- GRADUATE DASHBOARD FIX: SAVE MANUAL CONTENT ---
app.post('/save-manual-content', async (req, res) => {
    const { courseId, modules } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        for (let mod of modules) {
            const [mRes] = await connection.query(`INSERT INTO modules (course_id, title) VALUES (?, ?)`, [courseId, mod.title]);
            const moduleId = mRes.insertId;
            for (let unit of mod.units) {
                await connection.query(`INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`, [moduleId, unit.title, unit.content]);
            }
        }
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally { connection.release(); }
});

// --- EXAM QUESTIONS ---
app.post('/save-exam-questions', async (req, res) => {
    const { courseId, questions } = req.body;
    try {
        for (let q of questions) {
            await pool.query(
                `INSERT INTO exam_questions (course_id, question_text, options, correct_option) VALUES (?, ?, ?, ?)`,
                [courseId, q.question, q.options, q.correct]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- START COURSE (Initial Step) ---


// Add this route to your server.js file
app.post('/approve-course', async (req, res) => {
    const { courseId } = req.body;
    try {
        await pool.query('UPDATE courses SET is_approved = 1 WHERE id = ?', [courseId]);
        res.json({ success: true });
    } catch (err) {
        console.error("Approval Error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});
app.post('/generate-ai-course', async (req, res) => {
    const { title, courseType, price, creatorId } = req.body;
    try {
        const [course] = await pool.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated, price, creator_id) VALUES (?, ?, 0, 0, ?, ?)`,
            [title, courseType, price || 0, creatorId || 0]
        );
        res.json({ success: true, courseId: course.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- LIST COURSES ---
app.get('/all-courses', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM courses`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(3000, () => console.log('Server running on 3000'));