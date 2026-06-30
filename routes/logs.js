const express = require('express');
const router = express.Router();
const { all } = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const ExcelJS = require('exceljs');

router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { event_type, start_date, end_date } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const offset = (page - 1) * limit;

        let where = [];
        let params = [];
        let paramIdx = 1;

        if (event_type) {
            where.push(`event_type = $${paramIdx++}`);
            params.push(event_type);
        }
        if (start_date) {
            where.push(`DATE(created_at) >= $${paramIdx++}`);
            params.push(start_date);
        }
        if (end_date) {
            where.push(`DATE(created_at) <= $${paramIdx++}`);
            params.push(end_date);
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

        const countResult = await all(`SELECT COUNT(*) as total FROM login_logs ${whereClause}`, params);
        const totalLogs = parseInt(countResult[0]?.total || 0);
        const totalPages = Math.ceil(totalLogs / limit);

        const logs = await all(
            `SELECT * FROM login_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            [...params, limit, offset]
        );

        res.render('logs/list', {
            logs,
            totalLogs,
            totalPages,
            currentPage: page,
            eventType: event_type || '',
            startDate: start_date || '',
            endDate: end_date || ''
        });
    } catch (err) {
        console.error('Logs error:', err.message);
        req.flash('error', 'Failed to load activity log');
        res.redirect('/');
    }
});

router.get('/export', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { event_type, start_date, end_date } = req.query;
        let where = [];
        let params = [];
        let paramIdx = 1;

        if (event_type) { where.push(`event_type = $${paramIdx++}`); params.push(event_type); }
        if (start_date) { where.push(`DATE(created_at) >= $${paramIdx++}`); params.push(start_date); }
        if (end_date) { where.push(`DATE(created_at) <= $${paramIdx++}`); params.push(end_date); }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
        const logs = await all(`SELECT * FROM login_logs ${whereClause} ORDER BY created_at DESC`, params);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Activity Log');
        sheet.columns = [
            { header: 'Date & Time', key: 'created_at', width: 22 },
            { header: 'Username', key: 'username', width: 15 },
            { header: 'Event', key: 'event_type', width: 22 },
            { header: 'IP Address', key: 'ip_address', width: 18 },
            { header: 'User Agent', key: 'user_agent', width: 50 }
        ];
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6EFD' } };

        logs.forEach(log => {
            sheet.addRow({
                created_at: new Date(log.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
                username: log.username,
                event_type: log.event_type,
                ip_address: log.ip_address,
                user_agent: log.user_agent
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=activity_log.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Log export error:', err.message);
        req.flash('error', 'Failed to export logs');
        res.redirect('/logs');
    }
});

module.exports = router;
