/**
 * Password Reset Script
 * Run from terminal: node reset-password.js <username> <new-password>
 * Example: node reset-password.js admin myNewPass123
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { get, all, getDB } = require('./config/db');

const username = process.argv[2];
const newPassword = process.argv[3];

if (!username || !newPassword) {
    console.log('');
    console.log('  IT Stock Register — Password Reset Tool');
    console.log('  ========================================');
    console.log('');
    console.log('  Usage:   node reset-password.js <username> <new-password>');
    console.log('  Example: node reset-password.js admin MyNewPass123');
    console.log('');
    console.log('  This script resets any user\'s password without needing to log in.');
    console.log('');
    process.exit(1);
}

if (newPassword.length < 4) {
    console.error('Password must be at least 4 characters.');
    process.exit(1);
}

(async () => {
    try {
        const user = await get(`SELECT id, username, role FROM users WHERE username = ?`, [username]);
        if (!user) {
            console.error(`User "${username}" not found.`);
            console.log('Available users:');
            const users = await all(`SELECT username, role FROM users ORDER BY username`);
            users.forEach(u => console.log(`  - ${u.username} (${u.role})`));
            process.exit(1);
        }

        const hashed = bcrypt.hashSync(newPassword, 8);
        const { run } = require('./config/db');
        await run(`UPDATE users SET password = ?, password_change_requested = 0 WHERE id = ?`, [hashed, user.id]);

        console.log('');
        console.log(`  Password reset successful!`);
        console.log(`  Username: ${user.username}`);
        console.log(`  Role:     ${user.role}`);
        console.log(`  New password set. You can now log in.`);
        console.log('');
    } catch (err) {
        console.error('Reset failed:', err.message);
        process.exit(1);
    } finally {
        const pool = getDB();
        await pool.end();
    }
})();
