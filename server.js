require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

console.log("--- System Booting ---");
console.log("Target Host:", process.env.DB_HOST); // This will confirm if Render sees your variables

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false // Required for TiDB Cloud
    },
    connectTimeout: 20000 // Give it 20 seconds to find the cloud
});

const db = pool.promise();

// FORCE A CONNECTION TEST IMMEDIATELY
async function testConnection() {
    try {
        console.log("⏳ Attempting to ping TiDB Cloud...");
        const [rows] = await db.query('SELECT 1 + 1 AS result');
        console.log("✅ DATABASE CONNECTED SUCCESSFULLY. Test Query Result:", rows[0].result);
    } catch (err) {
        console.error("❌ DATABASE CONNECTION FAILED!");
        console.error("Error Code:", err.code);
        console.error("Error Message:", err.message);
        console.error("Check if your IP Whitelist (0.0.0.0/0) is set in TiDB Dashboard.");
    }
}

testConnection();

// ... rest of your routes (login, register, courses/create) ...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server listening on Port ${PORT}`));