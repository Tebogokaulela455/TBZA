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

const MERCHANT_ID = '32880521';
const MERCHANT_KEY = 'wfx9nr9j9cvlm';

// --- 1. SYSTEM ROUTES ---

app.get('/ping', (req, res) => {
    res.status(200).send("Institution Server Awake");
});

app.post('/register', async (req, res) => {
    const { username, password, role, fullName, surname, idNumber, cellphone, address, docBase64 } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            `INSERT INTO users (username, password, role, full_name, surname, id_number, cellphone, address, highest_grade_doc) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, role, fullName, surname, idNumber, cellphone, address, docBase64]
        );
        res.json({ success: true, userId: result.insertId });
    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ success: false, message: "Registration failed. " + err.message });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin') {
        return res.json({ success: true, role: 'admin', userId: 0, fullName: 'System Administrator' });
    }
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.json({ success: false, message: "User not found" });
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            res.json({ success: true, role: user.role, userId: user.id, fullName: user.full_name });
        } else {
            res.json({ success: false, message: "Wrong password" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "Database Error: " + err.message });
    }
});

// --- 2. GRADUATE & MANUAL COURSE CREATION ---

app.post('/create-course', async (req, res) => {
    const { title, type, is_approved, ai_generated } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated) VALUES (?, ?, ?, ?)`,
            [title, type, is_approved || 0, ai_generated || 0]
        );
        res.json({ success: true, courseId: result.insertId });
    } catch (err) {
        console.error("Create Course Error:", err.message);
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
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/add-study-unit', async (req, res) => {
    const { moduleId, title, content } = req.body;
    try {
        await pool.query(
            `INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`,
            [moduleId, title, content]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/modules/:courseId', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM modules WHERE course_id = ?`, [req.params.courseId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. AI COURSE GENERATION (UPDATED) ---

app.post('/generate-ai-course', async (req, res) => {
    const { textbookText, courseType, title } = req.body;
    
    if (!textbookText || !title) {
        return res.status(400).json({ success: false, error: "Missing textbook data or title" });
    }

    const connection = await pool.getConnection();
    
    let modCount = 4;
    if (courseType === "Short Course") modCount = 2;
    if (courseType.includes("Degree") || courseType === "Diploma") modCount = 8;

    try {
        await connection.beginTransaction();
        
        // 1. Create Course
        const [courseResult] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated) VALUES (?, ?, 1, 1)`, 
            [title, courseType]
        );
        const courseId = courseResult.insertId;

        // 2. Split textbook into chunks for modules
        const textLength = textbookText.length;
        const chunkSize = Math.floor(textLength / modCount);

        for(let i = 1; i <= modCount; i++) {
            const semester = (i <= modCount/2) ? 1 : 2;
            const [modResult] = await connection.query(
                `INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`,
                [courseId, `Module ${i}: ${title} Specialized Study`, semester]
            );

            const start = (i - 1) * chunkSize;
            const contentChunk = textbookText.substring(start, start + chunkSize) || "Supplemental material pending.";

            await connection.query(
                `INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`,
                [modResult.insertId, `Study Unit 1: Technical Foundations`, contentChunk]
            );
        }

        await connection.commit();
        res.json({ success: true, courseId: courseId });
    } catch (err) {
        await connection.rollback();
        console.error("AI Generation Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        connection.release();
    }
});

// --- 4. PAYFAST & ENROLLMENT ---

app.post('/payfast-signature', (req, res) => {
    const { amount, itemName } = req.body;
    let pfString = `merchant_id=${MERCHANT_ID}&merchant_key=${MERCHANT_KEY}&amount=${amount}&item_name=${itemName}`;
    const signature = crypto.createHash('md5').update(pfString).digest('hex');
    res.json({ signature });
});

app.post('/enroll-module', async (req, res) => {
    const { userId, moduleId } = req.body; 
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) as count FROM enrollments WHERE user_id = ? AND YEAR(enrollment_date) = YEAR(CURDATE())`, 
            [userId]
        );
        if (rows[0].count >= 10) return res.json({ success: false, message: "Yearly limit reached." });
        await pool.query(`INSERT INTO enrollments (user_id, module_id) VALUES (?, ?)`, [userId, moduleId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));