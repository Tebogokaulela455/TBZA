const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const crypto = require('crypto'); // For PayFast

const app = express();
app.use(express.json());
app.use(cors());

// DATABASE CONNECTION
const pool = mysql.createPool({
    host: 'gateway01.eu-central-1.prod.aws.tidbcloud.com', 
    user: 'YOUR_USER', 
    password: 'YOUR_PASSWORD', 
    database: 'test',
    ssl: { rejectUnauthorized: true }
});

// PAYFAST CREDENTIALS
const MERCHANT_ID = '32880521';
const MERCHANT_KEY = 'wfx9nr9j9cvlm';

// --- 1. ENROLLMENT LOGIC (THE 10-MODULE RULE) ---
app.post('/enroll-module', async (req, res) => {
    const { userId, moduleId, semester } = req.body; // semester: 1 (Jan-Jun) or 2 (Jul-Dec)
    
    try {
        // Count current modules for this year/semester
        const [rows] = await pool.query(
            `SELECT COUNT(*) as count FROM enrollments 
             WHERE user_id = ? AND module_id IS NOT NULL 
             AND YEAR(enrollment_date) = YEAR(CURDATE())`, 
            [userId]
        );

        if (rows[0].count >= 10) return res.json({ success: false, message: "Yearly limit of 10 modules reached." });

        // Check Semester Limit (Max 5)
        const [semRows] = await pool.query(
            `SELECT COUNT(*) as count FROM enrollments e
             JOIN modules m ON e.module_id = m.id
             WHERE e.user_id = ? AND m.semester = ? 
             AND YEAR(e.enrollment_date) = YEAR(CURDATE())`,
            [userId, semester]
        );

        if (semRows[0].count >= 5) return res.json({ success: false, message: "Semester limit of 5 modules reached." });

        // If safe, enroll
        await pool.query(`INSERT INTO enrollments (user_id, module_id, status) VALUES (?, ?, 'active')`, [userId, moduleId]);
        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 2. AI COURSE GENERATION (Admin) ---
app.post('/generate-ai-course', async (req, res) => {
    const { textbookText, courseType, title } = req.body;
    
    // SIMULATION: In a real app, you would send 'textbookText' to OpenAI here.
    // We will generate a structured course automatically.
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        // Create Course
        const [course] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated, price_zar) VALUES (?, ?, 1, 1, 0)`, 
            [title, courseType]
        );
        const courseId = course.insertId;

        // Generate 4 Modules
        for(let i=1; i<=4; i++) {
            const [mod] = await connection.query(
                `INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`,
                [courseId, `AI Generated Module ${i}: Key Concepts`, i <= 2 ? 1 : 2]
            );
            
            // Add Content to Module
            await connection.query(
                `INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`,
                [mod.insertId, `Unit 1: Intro to ${title}`, `Content extracted from textbook: ${textbookText.substring(0, 50)}...`]
            );
        }

        await connection.commit();
        res.json({ success: true, message: "AI has generated the course structure successfully." });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

// --- 3. PAYFAST SIGNATURE ---
app.post('/payfast-signature', (req, res) => {
    const { amount, itemName } = req.body;
    
    // Construct string for hashing
    let pfString = `merchant_id=${MERCHANT_ID}&merchant_key=${MERCHANT_KEY}&amount=${amount}&item_name=${itemName}`;
    
    // Generate MD5 Signature
    const signature = crypto.createHash('md5').update(pfString).digest('hex');
    res.json({ signature });
});

// ... (Add your standard Login/Register routes here) ...

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));