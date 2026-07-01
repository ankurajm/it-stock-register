require('dotenv').config();
const bcrypt = require('bcryptjs');
const { run, initSchema } = require('../config/db');

(async () => {
    try {
        await initSchema();
        const hashedPassword = bcrypt.hashSync('admin123', 12);
        await run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?) ON CONFLICT (username) DO NOTHING`,
            ['admin', hashedPassword, 'admin']);
        console.log('Default admin user created (admin / admin123)');
    } catch (err) {
        console.error('Seed error:', err.message);
    }
    process.exit(0);
})();
