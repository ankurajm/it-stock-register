const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { get, all } = require('../config/db');
const config = require('../config/app');

router.get('/', requireAuth, async (req, res) => {
    try {
        const isAdmin = req.session.user.role === 'admin';

        if (!isAdmin) {
            const emp = await get(`SELECT id FROM employees WHERE emp_id = ?`, [req.session.user.username]);
            const empId = emp ? emp.id : -1;

            const allocations = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, i.image, i.status as item_status FROM allocations a LEFT JOIN items i ON a.item_id = i.id WHERE a.employee_id = ? AND a.status='active' ORDER BY a.allocated_date DESC`, [empId]);

            const history = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model FROM allocations a LEFT JOIN items i ON a.item_id = i.id WHERE a.employee_id = ? ORDER BY a.allocated_date DESC LIMIT 20`, [empId]);

            return res.render('user/dashboard', { allocations, history });
        }

        const totalItems = await get(`SELECT COUNT(*) as count FROM items`);
        const available = await get(`SELECT COUNT(*) as count FROM items WHERE status='available'`);
        const allocated = await get(`SELECT COUNT(*) as count FROM items WHERE status='allocated'`);
        const fixedCount = await get(`SELECT COUNT(*) as count FROM items WHERE status='fixed'`);
        const maintenanceCount = await get(`SELECT COUNT(*) as count FROM items WHERE status='maintenance'`);
        const totalEmployees = await get(`SELECT COUNT(*) as count FROM employees`);
        const activeAllocations = await get(`SELECT COUNT(*) as count FROM allocations WHERE status='active'`);
        const pendingMaintenance = await get(`SELECT COUNT(*) as count FROM maintenance WHERE status='pending'`);

        const totalValue = await get(`SELECT COALESCE(SUM(purchase_price), 0) as value FROM items WHERE purchase_price IS NOT NULL`);
        const underWarranty = await get(`SELECT COUNT(*) as count FROM items WHERE warranty_end IS NOT NULL AND date(warranty_end) >= CURRENT_DATE`);

        const expiringWarranty = await all(`SELECT * FROM items WHERE warranty_end IS NOT NULL AND date(warranty_end) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' ORDER BY warranty_end ASC`);

        const overdueAllocations = await all(`
            SELECT a.*, e.name as emp_name, e.email, e.department, i.asset_tag, i.category, i.brand
            FROM allocations a
            JOIN employees e ON a.employee_id = e.id
            JOIN items i ON a.item_id = i.id
            WHERE a.status = 'active'
              AND a.expected_return_date IS NOT NULL
              AND a.expected_return_date < CURRENT_DATE
            ORDER BY a.expected_return_date ASC
        `);

        const upcomingReturns = await all(`
            SELECT a.*, e.name as emp_name, e.email, e.department, i.asset_tag, i.category, i.brand
            FROM allocations a
            JOIN employees e ON a.employee_id = e.id
            JOIN items i ON a.item_id = i.id
            WHERE a.status = 'active'
              AND a.expected_return_date IS NOT NULL
              AND a.expected_return_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
            ORDER BY a.expected_return_date ASC
        `);

        const recentItems = await all(`SELECT * FROM items ORDER BY created_at DESC LIMIT 5`);

        const recentAllocations = await all(`SELECT a.*, i.asset_tag, e.name as emp_name FROM allocations a LEFT JOIN items i ON a.item_id = i.id LEFT JOIN employees e ON a.employee_id = e.id ORDER BY a.allocated_date DESC LIMIT 5`);

        const categoryStats = await all(`SELECT category, COUNT(*) as count, SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available_count, SUM(CASE WHEN status='allocated' THEN 1 ELSE 0 END) as allocated_count FROM items GROUP BY category ORDER BY count DESC`);

        const pendingRequests = await get(`SELECT COUNT(*) as count FROM users WHERE password_change_requested=1`);

        const stats = {
            totalItems: totalItems.count,
            available: available.count,
            allocated: allocated.count,
            fixedCount: fixedCount.count,
            maintenanceCount: maintenanceCount.count,
            totalEmployees: totalEmployees.count,
            activeAllocations: activeAllocations.count,
            pendingMaintenance: pendingMaintenance.count,
            totalValue: totalValue.value,
            underWarranty: underWarranty.count
        };

        res.render('dashboard', {
            stats,
            expiringWarranty,
            overdueAllocations,
            upcomingReturns,
            recentItems,
            recentAllocations,
            categoryStats,
            pendingRequests: pendingRequests.count,
            schoolName: config.schoolName
        });
    } catch (err) {
        console.error('Dashboard error:', err.message);
        if (req.session.user.role !== 'admin') {
            return res.render('user/dashboard', { allocations: [], history: [] });
        }
        req.flash('error', 'Failed to load dashboard');
        res.render('dashboard', {
            stats: {
                totalItems: 0, available: 0, allocated: 0, fixedCount: 0, maintenanceCount: 0,
                totalEmployees: 0, activeAllocations: 0, pendingMaintenance: 0,
                totalValue: 0, underWarranty: 0
            },
            expiringWarranty: [], overdueAllocations: [], upcomingReturns: [],
            recentItems: [], recentAllocations: [],
            categoryStats: [], pendingRequests: 0, schoolName: config.schoolName
        });
    }
});

router.get('/dashboard', requireAuth, (req, res) => {
    res.redirect('/');
});

module.exports = router;
