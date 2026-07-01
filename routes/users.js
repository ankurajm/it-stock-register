const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../config/db');
const { getRoleInitial } = require('../utils/initials');

router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await all(`SELECT id, username, initials, role, created_at, password_change_requested FROM users ORDER BY username`);
        res.render('users/list', { users });
    } catch (err) {
        console.error('Users list error:', err.message);
        req.flash('error', 'Failed to load users');
        res.redirect('/');
    }
});

router.get('/add', requireAuth, requireAdmin, (req, res) => {
    res.render('users/add', { error: null });
});

router.post('/add', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, password, initials, role } = req.body;
        if (!username || !password) {
            return res.render('users/add', { error: 'Username and password are required' });
        }
        const hashed = bcrypt.hashSync(password, 12);
        const roleInitial = getRoleInitial(null, role);
        const finalInitials = roleInitial || initials || '';
        if (roleInitial) {
            await run(`UPDATE users SET initials = '' WHERE initials = ?`, [roleInitial]);
        }
        await run(`INSERT INTO users (username, password, initials, role) VALUES (?, ?, ?, ?)`, [username, hashed, finalInitials, role || 'user']);
        req.flash('success', 'User ' + username + ' created successfully');
        res.redirect('/users');
    } catch (err) {
        const errorMsg = err.message.includes('UNIQUE') ? 'Username already exists!' : 'Failed to create user';
        res.render('users/add', { error: errorMsg });
    }
});

router.get('/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const user = await get(`SELECT id, username, initials, role FROM users WHERE id = ?`, [req.params.id]);
        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/users');
        }
        res.render('users/add', { error: null, editUser: user });
    } catch (err) {
        req.flash('error', 'Failed to load user');
        res.redirect('/users');
    }
});

router.post('/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, initials, role } = req.body;
        const roleInitial = getRoleInitial(null, role);
        const finalInitials = roleInitial || initials || '';
        if (roleInitial) {
            await run(`UPDATE users SET initials = '' WHERE initials = ? AND id != ?`, [roleInitial, req.params.id]);
        }
        await run(`UPDATE users SET username=?, initials=?, role=? WHERE id=?`, [username, finalInitials, role, req.params.id]);
        req.flash('success', 'User updated successfully');
        res.redirect('/users');
    } catch (err) {
        req.flash('error', 'Failed to update user');
        res.redirect('/users');
    }
});

router.post('/reset-password/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { new_password } = req.body;
        if (!new_password || new_password.length < 8) {
            req.flash('error', 'Password must be at least 8 characters');
            return res.redirect('/users');
        }
        const hashed = bcrypt.hashSync(new_password, 12);
        await run(`UPDATE users SET password=?, password_change_requested=0 WHERE id=?`, [hashed, req.params.id]);
        req.flash('success', 'Password reset successfully');
        res.redirect('/users');
    } catch (err) {
        req.flash('error', 'Failed to reset password');
        res.redirect('/users');
    }
});

router.post('/delete/:id', requireAuth, requireAdmin, require('express-rate-limit')({
    windowMs: 60 * 1000,
    max: 10,
    handler: (req, res) => { req.flash('error', 'Too many attempts'); res.redirect('/users'); }
}), async (req, res) => {
    try {
        const user = await get(`SELECT username FROM users WHERE id = ?`, [req.params.id]);
        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/users');
        }
        if (parseInt(req.params.id) === req.session.user.id) {
            req.flash('error', 'Cannot delete yourself');
            return res.redirect('/users');
        }
        await run(`DELETE FROM users WHERE id=?`, [req.params.id]);
        req.flash('success', 'User deleted successfully');
        res.redirect('/users');
    } catch (err) {
        req.flash('error', 'Failed to delete user');
        res.redirect('/users');
    }
});

router.post('/bulk-delete', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { user_ids } = req.body;
        if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
            req.flash('error', 'No users selected');
            return res.redirect('/users');
        }
        let deleted = 0;
        for (const id of user_ids) {
            if (parseInt(id) === req.session.user.id) continue;
            const user = await get(`SELECT username FROM users WHERE id = ?`, [id]);
            if (user) {
                await run(`DELETE FROM users WHERE id=?`, [id]);
                deleted++;
            }
        }
        req.flash('success', deleted + ' user(s) deleted successfully');
        res.redirect('/users');
    } catch (err) {
        console.error('Bulk delete users error:', err.message);
        req.flash('error', 'Failed to delete users');
        res.redirect('/users');
    }
});

module.exports = router;
