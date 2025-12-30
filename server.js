require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise'); // Using promise-based version
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();

// INCREASE LIMITS for Base64 files (Highest Grade certificates, Logos, etc.)
app.use(cors()); 
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// DATABASE CONNECTION
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// WAKE-UP ENDPOINT: Use this to check if server is alive
app.get('/ping', (req, res) => res.status(200).send('Institution Server Awake'));

// REGISTRATION
app.post('/register', async (req, res) => {
    const { username, password, role, fullName, surname, idNumber, cellphone, address, docBase64 } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            `INSERT INTO users (username, password, role, full_name, surname, id_number, cellphone, address, highest_grade_doc, registration_status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, 
            [username, hashedPassword, role, fullName, surname, idNumber, cellphone, address, docBase64]
        );
        res.json({ success: true, userId: result.insertId });
    } catch (err) {
        console.error("Reg Error:", err);
        res.status(500).json({ success: false, message: "Database Error: " + err.message });
    }
});

// LOGIN
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            const match = await bcrypt.compare(password, rows[0].password);
            if (match) {
                let dest = 'student_dashboard.html';
                if (rows[0].role === 'admin') dest = 'admin_dashboard.html';
                if (rows[0].role === 'graduate') dest = 'graduate_dashboard.html';
                
                return res.json({ 
                    success: true, 
                    role: rows[0].role, 
                    userId: rows[0].id, 
                    redirect: dest 
                });
            }
        }
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Academic Server Active on Port ${PORT}`));