require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors()); 
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: false } 
});
const db = pool.promise();

// --- FETCH ALL COURSES ---
app.get('/courses', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM courses ORDER BY id DESC');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- CREATE COURSE (GRADUATE & AI) ---
app.post('/courses/create', async (req, res) => {
    const { title, type, creatorId, price, contentData, quizzes } = req.body;
    try {
        const [courseResult] = await db.query(
            'INSERT INTO courses (title, type, creator_id, price) VALUES (?, ?, ?, ?)', 
            [title, type, creatorId, price]
        );
        const courseId = courseResult.insertId;

        for (const mod of contentData) {
            const [modResult] = await db.query('INSERT INTO course_modules (course_id, module_title) VALUES (?, ?)', [courseId, mod.title]);
            for (const unit of mod.units) {
                await db.query('INSERT INTO study_units (module_id, unit_title, content) VALUES (?, ?, ?)', [modResult.insertId, unit.title, unit.content]);
            }
        }

        if (quizzes && quizzes.length > 0) {
            for (const q of quizzes) {
                await db.query('INSERT INTO quizzes (course_id, question, options, correct_answer) VALUES (?, ?, ?, ?)', 
                    [courseId, q.question, JSON.stringify(q.options), q.correct]);
            }
        }
        res.json({ success: true, courseId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- BRANDING ---
app.post('/admin/branding', async (req, res) => {
    const { logo, signature } = req.body;
    try {
        await db.query('REPLACE INTO settings (id, setting_key, setting_value) VALUES (1, "logo", ?), (2, "signature", ?)', [logo, signature]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log(`🚀 Server on tbza-7 active`));