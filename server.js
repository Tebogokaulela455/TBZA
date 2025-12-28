require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors'); // <--- ADD THIS
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();

// 1. ALLOW FRONTEND TO CONNECT
app.use(cors()); 

// 2. PARSE JSON DATA (Crucial for your Fetch calls)
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// Database Connection
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false } 
});
const db = pool.promise();

// LOGIN ROUTE
app.post('/login', async (req, res) => {
    console.log("Login attempt:", req.body); // Debug log
    const { username, password } = req.body;

    if (username === 'admin' && password === 'admin') {
        return res.json({ success: true, redirect: 'admin_dashboard.html' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length > 0) {
            const match = await bcrypt.compare(password, rows[0].password);
            if (match) {
                let url = rows[0].role === 'graduate' ? 'graduate_dashboard.html' : 'student_dashboard.html';
                return res.json({ success: true, redirect: url });
            }
        }
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// REGISTER ROUTE
app.post('/register', async (req, res) => {
    console.log("Registration attempt:", req.body);
    const { username, password, role } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', 
            [username, hashedPassword, role]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: "Username taken or DB error" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));