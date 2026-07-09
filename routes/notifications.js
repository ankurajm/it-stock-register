const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getNotifications, markAsRead, getUnreadCount } = require('../utils/notifications');

router.get('/', requireAuth, async (req, res) => {
    try {
        const notifications = await getNotifications(req.session.user.id, 50);
        res.render('notifications/list', { notifications });
    } catch (err) {
        console.error('Notifications error:', err.message);
        req.flash('error', 'Failed to load notifications');
        res.redirect('/');
    }
});

router.post('/read/:id', requireAuth, async (req, res) => {
    try {
        const notif = await require('../config/db').get(`SELECT id FROM notifications WHERE id = ? AND employee_id = ?`, [req.params.id, req.session.user.id]);
        if (!notif) return res.status(404).json({ error: 'Notification not found' });
        await markAsRead(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to mark notification' });
    }
});

router.get('/unread-count', requireAuth, async (req, res) => {
    try {
        const count = await getUnreadCount(req.session.user.id);
        res.json({ count });
    } catch (err) {
        res.json({ count: 0 });
    }
});

module.exports = router;
