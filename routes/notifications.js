const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getNotifications, markAsRead, getUnreadCount } = require('../utils/notifications');
const { get } = require('../config/db');

router.get('/', requireAuth, async (req, res) => {
    try {
        const employee = await get(`SELECT id FROM employees WHERE emp_id = ?`, [req.session.user.username]);
        const employeeId = employee?.id;
        const notifications = employeeId ? await getNotifications(employeeId, 50) : [];
        res.render('notifications/list', { notifications });
    } catch (err) {
        console.error('Notifications error:', err.message);
        req.flash('error', 'Failed to load notifications');
        res.redirect('/');
    }
});

router.post('/read/:id', requireAuth, async (req, res) => {
    try {
        await markAsRead(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/unread-count', requireAuth, async (req, res) => {
    try {
        const employee = await get(`SELECT id FROM employees WHERE emp_id = ?`, [req.session.user.username]);
        const count = employee ? await getUnreadCount(employee.id) : 0;
        res.json({ count });
    } catch (err) {
        res.json({ count: 0 });
    }
});

module.exports = router;
