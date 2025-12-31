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

// --- AUTHENTICATION & APPROVAL ---
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query(`SELECT * FROM users WHERE username = ?`, [username]);
        if (rows.length === 0) return res.status(401).json({ error: "User not found" });

        const user = rows[0];
        // Check if student is approved
        if (user.role === 'student' && user.status !== 'approved') {
            return res.status(403).json({ error: "Account pending admin approval." });
        }

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            res.json({ success: true, role: user.role, userId: user.id });
        } else {
            res.status(401).json({ error: "Wrong password" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- AI & GRADUATE COURSE GENERATION ---
app.post('/generate-ai-course', async (req, res) => {
    const { title, courseType, price, textbookText, creatorId } = req.body;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [course] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated, price, creator_id) VALUES (?, ?, 0, ?, ?, ?)`,
            [title, courseType, creatorId ? 0 : 1, price || 0, creatorId || 0]
        );
        const courseId = course.insertId;

        // Dynamic Chapter Logic: Create 1 module/unit per "Chapter" detected
        if (textbookText && textbookText !== "Manual Content") {
            const chapters = textbookText.split(/Chapter\s?\d+/i).filter(c => c.trim().length > 10);
            for (let i = 0; i < chapters.length; i++) {
                const [mod] = await connection.query(`INSERT INTO modules (course_id, title) VALUES (?, ?)`, [courseId, `Module ${i+1}`]);
                await connection.query(`INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`, [mod.insertId, `Unit ${i+1}`, chapters[i].trim()]);
            }
        }

        await connection.commit();
        res.json({ success: true, courseId });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally { connection.release(); }
});

app.get('/all-courses', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT c.*, u.fullName, u.surname, u.cellphone 
            FROM courses c LEFT JOIN users u ON c.creator_id = u.id
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));