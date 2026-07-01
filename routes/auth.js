const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();
const { get, run } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { logEvent } = require('../utils/audit-log');

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { layout: false, error: res.locals.error_msg ? res.locals.error_msg[0] : null });
});

router.post('/login', require('express-rate-limit')({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many login attempts. Please try again after a minute.',
    handler: (req, res) => {
        req.flash('error', 'Too many login attempts. Please try again after a minute.');
        res.redirect('/login');
    }
}), async (req, res) => {
    const { username, password } = req.body;
    console.log('[USER LOGIN] Attempt:', username);
    try {
        const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
        console.log('[USER LOGIN] User found:', user ? 'yes' : 'no', user ? 'role:' + user.role : '');
        if (!user) {
            console.log('[USER LOGIN] No user found');
            req.flash('error', 'Invalid username or password');
            logEvent(null, username || '', 'login_failed', req).catch(() => {});
            return res.redirect('/login');
        }
        const pwMatch = bcrypt.compareSync(password, user.password);
        console.log('[USER LOGIN] Password match:', pwMatch);
        if (!pwMatch) {
            req.flash('error', 'Invalid username or password');
            logEvent(null, username || '', 'login_failed', req).catch(() => {});
            return res.redirect('/login');
        }
        console.log('[USER LOGIN] Credentials OK, calling session.regenerate');
        req.session.regenerate((err) => {
            if (err) {
                console.error('[USER LOGIN] Session regenerate FAILED:', err.message, err.stack);
                req.flash('error', 'Session error. Please try again.');
                return res.redirect('/login');
            }
            console.log('[USER LOGIN] Session regenerated OK, setting user');
            req.session.user = { id: user.id, username: user.username, role: user.role, initials: user.initials || '' };
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');
            req.flash('success', 'Welcome back, ' + user.username + '!');
            logEvent(user.id, user.username, 'login_success', req).catch(() => {});
            res.redirect('/');
        });
    } catch (err) {
        console.error('[USER LOGIN] CATCH ERROR:', err.message, err.stack);
        req.flash('error', 'Login failed: ' + err.message);
        res.redirect('/login');
    }
});

router.get('/login/admin', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login-admin', { layout: false, error: res.locals.error_msg ? res.locals.error_msg[0] : null });
});

router.post('/login/admin', require('express-rate-limit')({
    windowMs: 60 * 1000,
    max: 5,
    message: 'Too many admin login attempts. Please try again after a minute.',
    handler: (req, res) => {
        req.flash('error', 'Too many admin login attempts. Please try again after a minute.');
        res.redirect('/login/admin');
    }
}), async (req, res) => {
    const { username, password } = req.body;
    console.log('[ADMIN LOGIN] Attempt:', username);
    try {
        const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
        console.log('[ADMIN LOGIN] User found:', user ? 'yes' : 'no', user ? 'role:' + user.role : '');
        if (!user || user.role !== 'admin') {
            console.log('[ADMIN LOGIN] Not admin or not found');
            req.flash('error', 'Admin access denied. Invalid credentials.');
            logEvent(null, username || '', 'admin_login_failed', req).catch(() => {});
            return res.redirect('/login/admin');
        }
        const pwMatch = bcrypt.compareSync(password, user.password);
        console.log('[ADMIN LOGIN] Password match:', pwMatch);
        if (!pwMatch) {
            req.flash('error', 'Admin access denied. Invalid credentials.');
            logEvent(null, username || '', 'admin_login_failed', req).catch(() => {});
            return res.redirect('/login/admin');
        }
        console.log('[ADMIN LOGIN] Credentials OK, calling session.regenerate');
        req.session.regenerate((err) => {
            if (err) {
                console.error('[ADMIN LOGIN] Session regenerate FAILED:', err.message, err.stack);
                req.flash('error', 'Session error. Please try again.');
                return res.redirect('/login/admin');
            }
            console.log('[ADMIN LOGIN] Session regenerated OK');
            req.session.user = { id: user.id, username: user.username, role: user.role, initials: user.initials || '' };
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');
            req.flash('success', 'Welcome back, ' + user.username + '!');
            logEvent(user.id, user.username, 'admin_login_success', req).catch(() => {});
            res.redirect('/');
        });
    } catch (err) {
        console.error('[ADMIN LOGIN] CATCH ERROR:', err.message, err.stack);
        req.flash('error', 'Login failed: ' + err.message);
        res.redirect('/login/admin');
    }
});

router.get('/logout', (req, res) => {
    const userId = req.session.user?.id;
    const username = req.session.user?.username;
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        logEvent(userId, username || '', 'logout', req);
        res.redirect('/login');
    });
});

router.get('/change-password', requireAuth, (req, res) => {
    res.render('change-password', { layout: false, error: null });
});

router.post('/change-password', requireAuth, require('express-rate-limit')({
    windowMs: 60 * 1000,
    max: 5,
    message: 'Too many attempts. Please try again after a minute.',
    handler: (req, res) => {
        return res.render('change-password', { layout: false, error: 'Too many attempts. Please try again after a minute.' });
    }
}), async (req, res) => {
    try {
        const { current_password, new_password, confirm_password } = req.body;
        const user = await get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id]);
        if (!user || !bcrypt.compareSync(current_password, user.password)) {
            return res.render('change-password', { layout: false, error: 'Current password is incorrect' });
        }
        if (new_password.length < 8) {
            return res.render('change-password', { layout: false, error: 'New password must be at least 8 characters' });
        }
        if (new_password !== confirm_password) {
            return res.render('change-password', { layout: false, error: 'Passwords do not match' });
        }
        const hashed = bcrypt.hashSync(new_password, 12);
        await run(`UPDATE users SET password=? WHERE id=?`, [hashed, req.session.user.id]);
        logEvent(req.session.user.id, req.session.user.username, 'password_change', req).catch(() => {});
        req.flash('success', 'Password changed successfully');
        res.redirect('/');
    } catch (err) {
        console.error('Change password error:', err.message);
        res.render('change-password', { layout: false, error: 'Failed to change password' });
    }
});

module.exports = router;
