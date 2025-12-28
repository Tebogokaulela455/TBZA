require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer'); // For file uploads
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' }); // Files saved to 'uploads' folder

// MIDDLEWARE
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve HTML files from 'public' folder
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// DATABASE CONNECTION
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL Database');
});

// ================= ROUTES ================= //

// 1. AUTHENTICATION
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Hardcoded Master Admin Check
    if (username === 'admin' && password === 'admin') {
        req.session.user = { role: 'admin', username: 'admin' };
        return res.redirect('/admin_dashboard.html');
    }

    // Database Check for other users
    const sql = 'SELECT * FROM users WHERE username = ?';
    db.query(sql, [username], async (err, results) => {
        if (results.length > 0) {
            const user = results[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                req.session.user = user;
                if (user.role === 'graduate') return res.redirect('/graduate_dashboard.html');
                if (user.role === 'student') return res.redirect('/student_dashboard.html');
            }
        }
        res.send('Invalid login details <a href="/">Try Again</a>');
    });
});

app.post('/register', async (req, res) => {
    const { username, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Graduates need approval, Students don't (initially)
    const isApproved = (role === 'student') ? 1 : 0; 

    const sql = 'INSERT INTO users (username, password, role, is_approved) VALUES (?, ?, ?, ?)';
    db.query(sql, [username, hashedPassword, role, isApproved], (err, result) => {
        if (err) return res.send("Error: Username might be taken.");
        res.redirect('/');
    });
});

// 2. ADMIN ROUTES
app.post('/admin/approve-course', (req, res) => {
    if (req.session.user?.role !== 'admin') return res.status(403).send("Unauthorized");
    const { courseId } = req.body;
    db.query('UPDATE courses SET is_approved = 1 WHERE id = ?', [courseId], (err) => {
        res.redirect('/admin_dashboard.html');
    });
});

app.post('/admin/upload-branding', upload.single('logo'), (req, res) => {
    // Logic to save logo path to site_settings table
    // Simplification: Just redirect back for now
    res.redirect('/admin_dashboard.html');
});

// 3. GRADUATE ROUTES (Create Course)
app.post('/create-course', upload.none(), (req, res) => {
    if (req.session.user?.role !== 'graduate') return res.status(403).send("Unauthorized");
    
    const { title, description, price, level, question1, ans1, question2, ans2 } = req.body;
    
    // Insert Course
    const sqlCourse = 'INSERT INTO courses (creator_id, title, description, price, level) VALUES (?, ?, ?, ?, ?)';
    db.query(sqlCourse, [req.session.user.id, title, description, price, level], (err, result) => {
        if (err) throw err;
        const courseId = result.insertId;

        // Insert Simplified Questions
        const sqlQ = 'INSERT INTO course_questions (course_id, question_text, correct_option) VALUES ?';
        const values = [
            [courseId, question1, ans1],
            [courseId, question2, ans2]
        ];
        db.query(sqlQ, [values], (err) => {
            res.send("Course Submitted for Admin Approval. <a href='/graduate_dashboard.html'>Back</a>");
        });
    });
});

// 4. STUDENT ROUTES (Registration Logic)
app.post('/student/register-modules', (req, res) => {
    if (req.session.user?.role !== 'student') return res.status(403).send("Unauthorized");

    const { year_level, semester, modules } = req.body;
    // modules is an array of selected module IDs or names
    const moduleCount = Array.isArray(modules) ? modules.length : 1;

    // RULE: Max 5 per semester
    if (moduleCount > 5) {
        return res.send("Error: You can only take 5 modules per 6-month semester.");
    }

    // RULE: Check yearly limit (Max 10)
    // We count previous modules for this student in this year
    const sqlCheck = 'SELECT SUM(module_count) as total FROM registrations WHERE student_id = ? AND year_level = ?';
    db.query(sqlCheck, [req.session.user.id, year_level], (err, result) => {
        const currentTotal = result[0].total || 0;
        
        if (currentTotal + moduleCount > 10) {
            return res.send(`Error: You have already taken ${currentTotal} modules this year. Adding ${moduleCount} would exceed the limit of 10.`);
        }

        // Check if approval is needed (Years 2, 3, 4)
        const status = (year_level > 1) ? 'Pending' : 'Approved';

        const sqlInsert = 'INSERT INTO registrations (student_id, year_level, semester, module_count, status) VALUES (?, ?, ?, ?, ?)';
        db.query(sqlInsert, [req.session.user.id, year_level, semester, moduleCount, status], (err) => {
            res.send(`Registration Successful. Status: ${status} <a href='/student_dashboard.html'>Back</a>`);
        });
    });
});

// API to get Courses (For filling the HTML catalog)
app.get('/api/courses', (req, res) => {
    db.query('SELECT * FROM courses WHERE is_approved = 1', (err, results) => {
        res.json(results);
    });
});

app.listen(process.env.PORT, () => {
    console.log(`Server running on http://localhost:${process.env.PORT}`);
});