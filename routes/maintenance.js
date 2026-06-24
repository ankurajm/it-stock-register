const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../config/db');

router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        let countQuery = `SELECT COUNT(*) as total FROM maintenance m WHERE 1=1`;
        let query = `SELECT m.*, i.asset_tag, i.category, i.brand, i.model FROM maintenance m LEFT JOIN items i ON m.item_id = i.id WHERE 1=1`;
        let params = [];

        if (status) {
            countQuery += ` AND m.status = ?`;
            query += ` AND m.status = ?`;
            params.push(status);
        }
        query += ` ORDER BY m.issue_date DESC LIMIT ? OFFSET ?`;

        const totalResult = await get(countQuery, params);
        const totalItems = totalResult.total;
        const totalPages = Math.ceil(totalItems / limit);
        const records = await all(query, [...params, limit, offset]);
        const currentPage = page;

        res.render('maintenance/list', { records, status, currentPage, totalPages, totalItems });
    } catch (err) {
        console.error('Maintenance list error:', err.message);
        req.flash('error', 'Failed to load maintenance records');
        res.redirect('/');
    }
});

router.get('/add', requireAuth, requireAdmin, async (req, res) => {
    try {
        const items = await all(`SELECT * FROM items WHERE status NOT IN ('disposed') ORDER BY asset_tag`);
        res.render('maintenance/add', { error: null, record: null, items });
    } catch (err) {
        console.error('Maintenance form error:', err.message);
        req.flash('error', 'Failed to load form');
        res.redirect('/maintenance');
    }
});

router.post('/add', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { item_id, issue_date, issue_description, vendor, cost, status, remarks } = req.body;

        const item = await get(`SELECT asset_tag FROM items WHERE id = ?`, [item_id]);
        if (!item) {
            req.flash('error', 'Item not found');
            return res.redirect('/maintenance/add');
        }

        await run(`INSERT INTO maintenance (item_id, issue_date, issue_description, vendor, cost, status, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [item_id, issue_date, issue_description, vendor, cost, status || 'pending', remarks]);
        await run(`UPDATE items SET status='maintenance' WHERE id=? AND status!='disposed'`, [item_id]);

        req.flash('success', 'Maintenance record added for ' + item.asset_tag);
        res.redirect('/maintenance');
    } catch (err) {
        console.error('Add maintenance error:', err.message);
        req.flash('error', 'Failed to add maintenance record');
        res.redirect('/maintenance/add');
    }
});

router.get('/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const record = await get(`SELECT * FROM maintenance WHERE id = ?`, [req.params.id]);
        if (!record) {
            req.flash('error', 'Maintenance record not found');
            return res.redirect('/maintenance');
        }
        const items = await all(`SELECT * FROM items WHERE status NOT IN ('disposed') ORDER BY asset_tag`);
        res.render('maintenance/add', { error: null, record, items });
    } catch (err) {
        console.error('Edit maintenance form error:', err.message);
        req.flash('error', 'Failed to load maintenance record');
        res.redirect('/maintenance');
    }
});

router.post('/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { item_id, issue_date, issue_description, vendor, cost, status, resolution_date, remarks } = req.body;

        const record = await get(`SELECT * FROM maintenance WHERE id = ?`, [req.params.id]);
        if (!record) {
            req.flash('error', 'Maintenance record not found');
            return res.redirect('/maintenance');
        }

        await run(`UPDATE maintenance SET issue_date=?, issue_description=?, vendor=?, cost=?, status=?, resolution_date=?, remarks=? WHERE id=?`,
            [issue_date, issue_description, vendor, cost, status, resolution_date, remarks, req.params.id]);

        if (status === 'resolved' && record.status !== 'resolved') {
            const activeCount = await get(`SELECT COUNT(*) as count FROM maintenance WHERE item_id=? AND status!='resolved' AND id!=?`, [item_id, req.params.id]);
            if (activeCount.count === 0) {
                await run(`UPDATE items SET status='available' WHERE id=?`, [item_id]);
            }
        }

        req.flash('success', 'Maintenance record updated successfully');
        res.redirect('/maintenance');
    } catch (err) {
        console.error('Update maintenance error:', err.message);
        req.flash('error', 'Failed to update maintenance record');
        res.redirect('/maintenance');
    }
});

router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const record = await get(`SELECT m.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, i.location FROM maintenance m LEFT JOIN items i ON m.item_id = i.id WHERE m.id = ?`, [req.params.id]);
        if (!record) {
            req.flash('error', 'Maintenance record not found');
            return res.redirect('/maintenance');
        }
        res.render('maintenance/view', { record });
    } catch (err) {
        console.error('View maintenance error:', err.message);
        req.flash('error', 'Failed to load maintenance record');
        res.redirect('/maintenance');
    }
});

router.post('/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { resolution_date, cost, remarks } = req.body;
        const record = await get(`SELECT * FROM maintenance WHERE id = ?`, [req.params.id]);
        if (!record) {
            req.flash('error', 'Maintenance record not found');
            return res.redirect('/maintenance');
        }

        await run(`UPDATE maintenance SET resolution_date=?, cost=?, remarks=?, status='resolved' WHERE id=?`,
            [resolution_date, cost, remarks, req.params.id]);

        const activeCount = await get(`SELECT COUNT(*) as count FROM maintenance WHERE item_id=? AND status!='resolved'`, [record.item_id]);
        if (activeCount.count === 0) {
            await run(`UPDATE items SET status='available' WHERE id=?`, [record.item_id]);
        }

        const item = await get(`SELECT asset_tag FROM items WHERE id=?`, [record.item_id]);
        req.flash('success', 'Maintenance resolved for ' + item.asset_tag);
        res.redirect('/maintenance');
    } catch (err) {
        console.error('Resolve maintenance error:', err.message);
        req.flash('error', 'Failed to resolve record');
        res.redirect('/maintenance');
    }
});

module.exports = router;
