/**
 * Password Reset Script
 * Run from terminal: node reset-password.js <username> <new-password>
 * Example: node reset-password.js admin myNewPass123
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { get, all, getDB } = require('./config/db');

const readline = require('readline');
const username = process.argv[2];

if (!username) {
    console.log('');
    console.log('  IT Stock Register — Password Reset Tool');
    console.log('  ========================================');
    console.log('');
    console.log('  Usage:   node reset-password.js <username>');
    console.log('  Example: node reset-password.js admin');
    console.log('');
    console.log('  You will be prompted to enter the new password.');
    console.log('');
    process.exit(1);
}

(async () => {
    try {
        const user = await get(`SELECT id, username, role FROM users WHERE username = ?`, [username]);
        if (!user) {
            console.error(`User "${username}" not found.`);
            process.exit(1);
        }

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const newPassword = await new Promise(resolve => {
            rl.question('  Enter new password: ', answer => {
                rl.close();
                resolve(answer);
            });
        });

        if (!newPassword || newPassword.length < 8) {
            console.error('Password must be at least 8 characters.');
            process.exit(1);
        }

        const hashed = bcrypt.hashSync(newPassword, 12);
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
