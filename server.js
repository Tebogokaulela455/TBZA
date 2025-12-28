require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();

// 1. MIDDLEWARE
app.use(cors()); 
app.use(express.json()); // Essential for reading JSON from Netlify fetch calls
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// 2. DATABASE CONNECTION (Using Pool with SSL for Render/Cloud DBs)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: { rejectUnauthorized: false } 
});
const db = pool.promise();

// TEST DATABASE CONNECTION ON STARTUP
pool.getConnection((err, connection) => {
    if (err) {
        console.error("❌ DATABASE CONNECTION FAILED:", err.message);
    } else {
        console.log("✅ DATABASE CONNECTED SUCCESSFULLY");
        connection.release();
    }
});

// 3. LOGIN ROUTE (Improved with Detailed Error Feedback)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`Login attempt for: ${username}`);

    if (username === 'admin' && password === 'admin') {
        return res.json({ success: true, redirect: 'admin_dashboard.html' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            const match = await bcrypt.compare(password, rows[0].password);
            if (match) {
                // Determines redirect based on the 'role' column in your DB
                let url = rows[0].role === 'graduate' ? 'graduate_dashboard.html' : 'student_dashboard.html';
                return res.json({ success: true, redirect: url });
            }
        }
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) {
        console.error("LOGIN ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. REGISTER ROUTE (Fixed for the "DB Error" you saw)
app.post('/register', async (req, res) => {
    const { username, password, role } = req.body;
    console.log(`Registration attempt: ${username} as ${role}`);
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 
            [username, hashedPassword, role]);
        res.json({ success: true });
    } catch (err) {
        console.error("REGISTRATION ERROR:", err.message);
        let msg = err.code === 'ER_DUP_ENTRY' ? "Username already taken" : "Database error: " + err.message;
        res.status(500).json({ success: false, message: msg });
    }
});

// 5. GRADUATE: CREATE COURSE (Supports Degrees and Short Courses)
app.post('/courses/create', async (req, res) => {
    const { title, type, creatorId, price, contentData } = req.body;
    // contentData should be an array of modules (for degrees) or units (for short courses)
    
    try {
        const [courseResult] = await db.query(
            'INSERT INTO courses (title, type, creator_id, price) VALUES (?, ?, ?, ?)', 
            [title, type, creatorId, price]
        );
        const courseId = courseResult.insertId;

        if (type === 'degree') {
            for (const mod of contentData) {
                const [modResult] = await db.query(
                    'INSERT INTO course_modules (course_id, module_title) VALUES (?, ?)', 
                    [courseId, mod.title]
                );
                for (const unit of mod.units) {
                    await db.query(
                        'INSERT INTO study_units (module_id, unit_title, content, video_url) VALUES (?, ?, ?, ?)', 
                        [modResult.insertId, unit.title, unit.content, unit.videoUrl || null]
                    );
                }
            }
        } else {
            // Short Course logic
            for (const unit of contentData) {
                await db.query(
                    'INSERT INTO study_units (course_id, unit_title, content, video_url) VALUES (?, ?, ?, ?)', 
                    [courseId, unit.title, unit.content, unit.videoUrl || null]
                );
            }
        }
        res.json({ success: true, message: "Course published successfully!" });
    } catch (err) {
        console.error("COURSE CREATION ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));