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

router.post('/', requireAuth, require('express-rate-limit')({ windowMs: 60 * 1000, max: 10, handler: (req, res) => { req.flash('error', 'Too many requests. Please slow down.'); res.redirect('/profile'); } }), async (req, res) => {
    try {
        const { name, email, phone } = req.body;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            req.flash('error', 'Invalid email format');
            return res.redirect('/profile');
        }
        if (phone && !/^[+]?[\d\s()-]{7,20}$/.test(phone)) {
            req.flash('error', 'Invalid phone number');
            return res.redirect('/profile');
        }
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