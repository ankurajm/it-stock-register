const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { run, get } = require('../config/db');

router.get('/', requireAuth, async (req, res) => {
    try {
        const user = await get(`SELECT * FROM users WHERE username = ?`, [req.session.user.username]);
        const employee = await get(`SELECT * FROM employees WHERE emp_id = ?`, [req.session.user.username]);

        res.render('profile/index', { user, employee, error: null });
    } catch (err) {
        console.error('Profile error:', err.message);
        req.flash('error', 'Failed to load profile');
        res.redirect('/');
    }
});

router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, email, phone } = req.body;
        const employee = await get(`SELECT * FROM employees WHERE emp_id = ?`, [req.session.user.username]);

        if (employee) {
            await run(`UPDATE employees SET name = ?, email = ?, phone = ? WHERE emp_id = ?`,
                [name, email, phone, req.session.user.username]);
        }

        req.flash('success', 'Profile updated successfully');
        res.redirect('/profile');
    } catch (err) {
        console.error('Profile update error:', err.message);
        req.flash('error', 'Failed to update profile');
        res.redirect('/profile');
    }
});

module.exports = router;