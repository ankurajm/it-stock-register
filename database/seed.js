require('dotenv').config();
const bcrypt = require('bcryptjs');
const { run, initSchema } = require('../config/db');

function seed() {
    initSchema();
    const hashedPassword = bcrypt.hashSync('admin123', 8);
    try {
        run(`INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`,
            ['admin', hashedPassword, 'admin']);
        console.log('Default admin user created (admin / admin123)');
    } catch (err) {
        console.error('Seed error:', err.message);
    }
    process.exit(0);
}

seed();
