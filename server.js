// --- 5. GRADUATE & MANUAL COURSE ROUTES ---

// Create Course (Used by both Graduate and Admin)
app.post('/create-course', async (req, res) => {
    const { title, type, is_approved, ai_generated } = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated) VALUES (?, ?, ?, ?)`,
            [title, type, is_approved || 0, ai_generated || 0]
        );
        res.json({ success: true, courseId: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Add Module
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

// Add Study Unit
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

// Get Modules for a specific course (Needed for the Graduate dropdown list)
app.get('/modules/:courseId', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT * FROM modules WHERE course_id = ?`, [req.params.courseId]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 6. ENHANCED AI GENERATION ---
// This replaces your old /generate-ai-course to be more robust
app.post('/generate-ai-course', async (req, res) => {
    const { textbookText, courseType, title } = req.body;
    const connection = await pool.getConnection();
    
    // Determine module count by qualification
    let modCount = 4;
    if(courseType === 'Short Course') modCount = 2;
    if(courseType.includes('Degree')) modCount = 10;

    try {
        await connection.beginTransaction();
        
        const [course] = await connection.query(
            `INSERT INTO courses (title, type, is_approved, ai_generated) VALUES (?, ?, 1, 1)`, 
            [title, courseType]
        );
        const courseId = course.insertId;

        for(let i=1; i<=modCount; i++) {
            const sem = (i <= modCount/2) ? 1 : 2;
            const [mod] = await connection.query(
                `INSERT INTO modules (course_id, title, semester) VALUES (?, ?, ?)`, 
                [courseId, `Module ${i}: ${title} Specialist Study`, sem]
            );

            // Chunk text for units
            const chunk = textbookText.substring((i-1)*500, i*500) || "Supplemental content pending review.";
            await connection.query(
                `INSERT INTO study_units (module_id, title, content) VALUES (?, ?, ?)`, 
                [mod.insertId, `Unit 1.1`, chunk]
            );
        }

        await connection.commit();
        res.json({ success: true });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ success: false, error: err.message });
    } finally {
        connection.release();
    }
});