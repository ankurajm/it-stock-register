const { run } = require('../config/db');

async function logEvent(userId, username, eventType, req) {
    try {
        const ip = req.ip || req.connection?.remoteAddress || '';
        const ua = req.get('User-Agent') || '';
        await run(
            `INSERT INTO login_logs (user_id, username, event_type, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)`,
            [userId, username, eventType, ip, ua]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
}

module.exports = { logEvent };
