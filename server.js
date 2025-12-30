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

// --- AUTHENTICATION ---
app.post('/register', async (req, res) => {
    const { username, password, role, fullName, surname, idNumber, cellphone, address, docBase64 } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (username, password, role, full_name, surname, id_number, cellphone, address, highest_grade_doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, role, fullName, surname, idNumber, cellphone, address, docBase64]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        if (username === 'admin' && password === 'admin') return res.json({ success: true, role: 'admin', userId: 0 });
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.json({ success: false, message: "User not found" });
        const match = await bcrypt.compare(password, rows[0].password);
        if (match) res.json({ success: true, role: rows[0].role, userId: rows[0].id });
        else res.json({ success: false, message: "Wrong password" });
    } catch (err) { res.status(500).json({ success: false, error: "Login failed" }); }
});

// --- COURSE CREATION (GRADUATES) ---
app.post('/create-course', async (req, res) => {
    const { title, type, price, creator_id } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO courses (title, type, price, creator_id, is_approved, ai_generated) VALUES (?, ?, ?, ?, 0, 0)`,
            [title, type.substring(0,99), price || 0, creator_id]
        );
        res.json({ success: true, courseId: result.insertId });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- AI GENERATOR (ADMIN) ---
app.post('/generate-ai-course', async (req, res) => {
    const { textbookText, courseType, title } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [course] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated, price, creator_id) VALUES (?, ?, 0, 1, 0, 0)`, 
            [title, courseType]
        );
        const courseId = course.insertId;
        const chunk = textbookText.substring(0, 5000); // Sample chunk
        const [mod] = await connection.query(`INSERT INTO modules (course_id, title, semester) VALUES (?, 'Module 1', 1)`, [courseId]);
        await connection.query(`INSERT INTO study_units (module_id, title, content) VALUES (?, 'Intro', ?)`, [mod.insertId, chunk]);
        
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally { connection.release(); }
});

// --- THE FIX: SHARED COURSE MANAGER ROUTE ---
app.get('/all-courses', async (req, res) => {
    try {
        // Fetching all to ensure AI and Graduate courses appear together
        const [rows] = await pool.query(`SELECT * FROM courses ORDER BY id DESC`);
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
        const [rows] = await pool.query(`SELECT * FROM courses WHERE is_approved = 1`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server live on ${PORT}`));