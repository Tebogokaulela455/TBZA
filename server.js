const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' })); 
app.use(cors());

// --- DATABASE CONNECTION (FULLY UPDATED WITH YOUR CREDENTIALS) ---
const pool = mysql.createPool({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com', 
    port: 4000,
    user: '3ELby3yHuXnNY9H.root', // Updated with your prefix
    password: 'qjpjNtaHckZ1j8XU', // Updated with your password
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

// Wake-up route
app.get('/ping', (req, res) => {
    res.status(200).send("Institution Server Awake");
});

// Registration Route
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

// Login Route
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.json({ success: false, message: "User not found" });

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        
        if (match) {
            res.json({ 
                success: true, 
                role: user.role, 
                userId: user.id, 
                fullName: user.full_name 
            });
        } else {
            res.json({ success: false, message: "Wrong password" });
        }
    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ success: false, message: "Database Error: " + err.message });
    }
});

// --- 2. ENROLLMENT LOGIC ---
app.post('/enroll-module', async (req, res) => {
    const { userId, moduleId, semester } = req.body; 
    try {
        const [rows] = await pool.query(
            `SELECT COUNT(*) as count FROM enrollments WHERE user_id = ? AND YEAR(enrollment_date) = YEAR(CURDATE())`, 
            [userId]
        );

        if (rows[0].count >= 10) return res.json({ success: false, message: "Yearly limit of 10 modules reached." });

        const [semRows] = await pool.query(
            `SELECT COUNT(*) as count FROM enrollments e JOIN modules m ON e.module_id = m.id
             WHERE e.user_id = ? AND m.semester = ? AND YEAR(e.enrollment_date) = YEAR(CURDATE())`,
            [userId, semester]
        );

        if (semRows[0].count >= 5) return res.json({ success: false, message: "Semester limit of 5 modules reached." });

        await pool.query(`INSERT INTO enrollments (user_id, module_id) VALUES (?, ?)`, [userId, moduleId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 3. AI COURSE GENERATION ---
app.post('/generate-ai-course', async (req, res) => {
    const { textbookText, courseType, title } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [course] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated) VALUES (?, ?, 1, 1)`, 
            [title, courseType]
        );
        const courseId = course.insertId;

        for(let i=1; i<=4; i++) {
            const [mod] = await connection.query(
                `INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`,
                [courseId, `AI Module ${i}`, i <= 2 ? 1 : 2]
            );
            await connection.query(
                `INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`,
                [mod.insertId, `Unit 1`, `Content: ${textbookText.substring(0, 100)}`]
            );
        }
        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- 4. PAYFAST SIGNATURE ---
app.post('/payfast-signature', (req, res) => {
    const { amount, itemName } = req.body;
    let pfString = `merchant_id=${MERCHANT_ID}&merchant_key=${MERCHANT_KEY}&amount=${amount}&item_name=${itemName}`;
    const signature = crypto.createHash('md5').update(pfString).digest('hex');
    res.json({ signature });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));