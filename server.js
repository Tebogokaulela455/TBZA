const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();

// Set high limits for PDF processing
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '100mb' }));

// --- HEALTH CHECK (To wake up server) ---
app.get('/health', (req, res) => res.send('Server is Awake!'));

const pool = mysql.createPool({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: '3ELby3yHuXnNY9H.root',
    password: 'qjpjNtaHckZ1j8XU',
    database: 'test',
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 20,
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    idleTimeout: 60000 
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

// --- ADMIN FEATURES ---
app.get('/admin/pending-students', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT id, full_name, surname, id_number, role, highest_grade_doc FROM users WHERE role != 'admin'`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/update-status', async (req, res) => {
    const { userId, status } = req.body;
    try {
        const newRole = status === 'approved' ? 'student' : 'rejected';
        await pool.query(`UPDATE users SET role = ? WHERE id = ?`, [newRole, userId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- AI GENERATOR (EVERY CHAPTER = ONE UNIT) ---
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

        // Splits text into units based on "Chapter" keyword
        const chapters = textbookText.split(/Chapter\s?\d+/i).filter(c => c.trim().length > 100);
        
        // Default to 8 units if no "Chapter" markers found
        const finalChapters = chapters.length > 0 ? chapters : [];
        if (finalChapters.length === 0) {
            const chunkSize = Math.floor(textbookText.length / 8);
            for(let i=0; i<8; i++) finalChapters.push(textbookText.substring(i*chunkSize, (i+1)*chunkSize));
        }

        for (let i = 0; i < finalChapters.length; i++) {
            const moduleNum = Math.floor(i / 3) + 1;
            let [existingMod] = await connection.query(`SELECT id FROM modules WHERE course_id = ? AND title = ?`, [courseId, `Module ${moduleNum}`]);
            let moduleId = existingMod[0]?.id;
            if (!moduleId) {
                const [newMod] = await connection.query(`INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`, [courseId, `Module ${moduleNum}`, moduleNum > 2 ? 2 : 1]);
                moduleId = newMod.insertId;
            }
            await connection.query(`INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`, [moduleId, `Study Unit: Chapter ${i + 1}`, finalChapters[i].substring(0, 20000)]);
        }
        await connection.commit();
        res.json({ success: true, unitsCreated: finalChapters.length });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally { connection.release(); }
});

// --- SHARED ROUTES ---
app.get('/all-courses', async (req, res) => {
    try {
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
        const [rows] = await pool.query(`SELECT * FROM courses WHERE is_approved = 1 ORDER BY id DESC`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/course-content/:id', async (req, res) => {
    const courseId = req.params.id;
    try {
        const [modules] = await pool.query(`SELECT * FROM modules WHERE course_id = ?`, [courseId]);
        for (let mod of modules) {
            const [units] = await pool.query(`SELECT * FROM study_units WHERE module_id = ?`, [mod.id]);
            mod.units = units;
        }
        res.json({ success: true, modules });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/delete-course', async (req, res) => {
    const { courseId } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(`DELETE FROM study_units WHERE module_id IN (SELECT id FROM modules WHERE course_id = ?)`, [courseId]);
        await connection.query(`DELETE FROM modules WHERE course_id = ?`, [courseId]);
        await connection.query(`DELETE FROM courses WHERE id = ?`, [courseId]);
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ success: false, error: err.message });
    } finally { connection.release(); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Master Server running on ${PORT}`));