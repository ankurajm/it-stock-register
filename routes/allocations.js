const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../config/db');

router.get('/', requireAuth, async (req, res) => {
    try {
        const { search, status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        let countQuery = `SELECT COUNT(*) as total FROM allocations a LEFT JOIN items i ON a.item_id = i.id LEFT JOIN users u ON a.employee_id = u.id WHERE 1=1`;
        let query = `SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, u.name as emp_name, u.username as emp_code, u.department FROM allocations a LEFT JOIN items i ON a.item_id = i.id LEFT JOIN users u ON a.employee_id = u.id WHERE 1=1`;
        let params = [];

        if (search) {
            countQuery += ` AND (i.asset_tag ILIKE ? OR u.name ILIKE ? OR u.username ILIKE ?)`;
            query += ` AND (i.asset_tag ILIKE ? OR u.name ILIKE ? OR u.username ILIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (status) {
            countQuery += ` AND a.status = ?`;
            query += ` AND a.status = ?`;
            params.push(status);
        }
        query += ` ORDER BY a.allocated_date DESC LIMIT ? OFFSET ?`;

        const totalResult = await get(countQuery, params);
        const totalItems = totalResult.total;
        const totalPages = Math.ceil(totalItems / limit);
        const allocations = await all(query, [...params, limit, offset]);
        const currentPage = page;

        res.render('allocations/list', { allocations, search, status, currentPage, totalPages, totalItems });
    } catch (err) {
        console.error('Allocations list error:', err.message);
        req.flash('error', 'Failed to load allocations');
        res.redirect('/');
    }
});

router.get('/allocate', requireAuth, requireAdmin, async (req, res) => {
    try {
        const items = await all(`SELECT * FROM items WHERE status='available' ORDER BY asset_tag`);
        const employees = await all(`SELECT * FROM users WHERE emp_status='active' AND name != '' ORDER BY name`);
        res.render('allocations/add', { error: null, items, employees });
    } catch (err) {
        console.error('Allocate form error:', err.message);
        req.flash('error', 'Failed to load allocation form');
        res.redirect('/allocations');
    }
});

router.post('/allocate', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { item_id, employee_id, allocated_date, expected_return_date, remarks } = req.body;

        const item = await get(`SELECT asset_tag FROM items WHERE id = ? AND status='available'`, [item_id]);
        if (!item) {
            req.flash('error', 'Item not available or does not exist');
            return res.redirect('/allocations/allocate');
        }

        const emp = await get(`SELECT name FROM users WHERE id = ? AND emp_status='active'`, [employee_id]);
        if (!emp) {
            req.flash('error', 'Employee not found or inactive');
            return res.redirect('/allocations/allocate');
        }

        await run(`INSERT INTO allocations (item_id, employee_id, allocated_date, expected_return_date, remarks, status) VALUES (?, ?, ?, ?, ?, 'active')`,
            [item_id, employee_id, allocated_date, expected_return_date || null, remarks]);
        await run(`UPDATE items SET status='allocated' WHERE id=?`, [item_id]);

        req.flash('success', 'Item ' + item.asset_tag + ' allocated to ' + emp.name);
        res.redirect('/allocations');
    } catch (err) {
        console.error('Allocate error:', err.message);
        req.flash('error', 'Failed to allocate item');
        res.redirect('/allocations/allocate');
    }
});

router.get('/employee/:id/history', requireAuth, async (req, res) => {
    try {
        const employee = await get(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
        if (!employee || !employee.name) {
            req.flash('error', 'Employee not found');
            return res.redirect('/employees');
        }

        const allocations = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number FROM allocations a LEFT JOIN items i ON a.item_id = i.id WHERE a.employee_id = ? ORDER BY a.allocated_date DESC`, [req.params.id]);

        res.render('allocations/history', { employee, allocations });
    } catch (err) {
        console.error('Employee history error:', err.message);
        req.flash('error', 'Failed to load allocation history');
        res.redirect('/employees');
    }
});

router.post('/return/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { return_date, remarks } = req.body;
        const allocation = await get(`SELECT * FROM allocations WHERE id = ? AND status='active'`, [req.params.id]);
        if (!allocation) {
            req.flash('error', 'Active allocation not found');
            return res.redirect('/allocations');
        }

        await run(`UPDATE allocations SET return_date=?, remarks=?, status='returned' WHERE id=?`,
            [return_date, remarks, req.params.id]);
        await run(`UPDATE items SET status='available' WHERE id=?`, [allocation.item_id]);

        const item = await get(`SELECT asset_tag FROM items WHERE id=?`, [allocation.item_id]);
        req.flash('success', 'Item ' + item.asset_tag + ' returned successfully');
        res.redirect('/allocations');
    } catch (err) {
        console.error('Return error:', err.message);
        req.flash('error', 'Failed to process return');
        res.redirect('/allocations');
    }
});

module.exports = router;
