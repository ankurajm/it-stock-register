const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const config = require('../config/app');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { run, get, all } = require('../config/db');
const QRCode = require('qrcode');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, ''))
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Only JPEG, PNG, GIF, WebP images are allowed'));
    }
});

const ITEMS_PER_PAGE = 20;

router.get('/', requireAuth, async (req, res) => {
    try {
        const { search, category, status, condition, page } = req.query;
        const currentPage = Math.max(1, parseInt(page) || 1);
        const offset = (currentPage - 1) * ITEMS_PER_PAGE;

        let countQuery = `SELECT COUNT(*) as total FROM items WHERE 1=1`;
        let query = `SELECT * FROM items WHERE 1=1`;
        let params = [];

        if (search) {
            const clause = ` AND (asset_tag LIKE ? OR brand LIKE ? OR model LIKE ? OR serial_number LIKE ?)`;
            countQuery += clause;
            query += clause;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (category) {
            countQuery += ` AND category = ?`;
            query += ` AND category = ?`;
            params.push(category);
        }
        if (status) {
            countQuery += ` AND status = ?`;
            query += ` AND status = ?`;
            params.push(status);
        }
        if (condition) {
            countQuery += ` AND condition = ?`;
            query += ` AND condition = ?`;
            params.push(condition);
        }

        const totalResult = await get(countQuery, [...params]);
        const totalItems = totalResult.total;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(ITEMS_PER_PAGE, offset);

        const items = await all(query, params);
        const categories = await all(`SELECT DISTINCT name FROM categories ORDER BY name`);

        res.render('items/list', {
            items, categories, search, category, status, condition,
            currentPage, totalPages, totalItems
        });
    } catch (err) {
        console.error('Items list error:', err.message);
        req.flash('error', 'Failed to load items');
        res.redirect('/');
    }
});

router.get('/add', requireAuth, async (req, res) => {
    try {
        const categories = await all(`SELECT * FROM categories ORDER BY name`);
        const { category_id } = req.query;
        let nextTag = '';
        if (category_id) {
            const cat = await get(`SELECT * FROM categories WHERE id = ?`, [category_id]);
            if (cat) {
                const last = await get(`SELECT asset_tag FROM items WHERE asset_tag LIKE ? ORDER BY id DESC LIMIT 1`, [cat.prefix + '-%']);
                if (last) {
                    const num = parseInt(last.asset_tag.split('-')[1]) || 0;
                    nextTag = cat.prefix + '-' + String(num + 1).padStart(4, '0');
                } else {
                    nextTag = cat.prefix + '-0001';
                }
            }
        }
        res.render('items/add', { error: null, item: null, categories, nextTag, selectedCategoryId: category_id || '' });
    } catch (err) {
        console.error('Add item form error:', err.message);
        req.flash('error', 'Failed to load form');
        res.redirect('/items');
    }
});

router.post('/add', requireAuth, upload.single('image'), validateCsrf, async (req, res) => {
    try {
        const { asset_tag, category, category_select, brand, model, serial_number, specifications, purchase_date, purchase_price, vendor, warranty_end, status, condition, location, notes } = req.body;
        const image = req.file ? req.file.filename : null;

        let resolvedCategory = category;
        if (!resolvedCategory && category_select) {
            const cat = await get(`SELECT name FROM categories WHERE id = ?`, [category_select]);
            if (cat) resolvedCategory = cat.name;
        }

        let qrCode = '';
        try {
            qrCode = await QRCode.toDataURL(serial_number || asset_tag);
        } catch (e) { /* QR generation failed silently */ }

        await run(`INSERT INTO items (asset_tag, category, brand, model, serial_number, specifications, purchase_date, purchase_price, vendor, warranty_end, status, condition, location, notes, image, qr_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [asset_tag, resolvedCategory, brand, model, serial_number, specifications, purchase_date, purchase_price, vendor, warranty_end, status || 'available', condition || 'new', location, notes, image, qrCode]);

        req.flash('success', 'Item ' + asset_tag + ' added successfully');
        res.redirect('/items');
    } catch (err) {
        console.error('Add item error:', err.message);
        const categories = all(`SELECT * FROM categories ORDER BY name`);
        const errorMsg = err.message.includes('UNIQUE') ? 'Asset tag already exists!' : 'Failed to add item';
        res.render('items/add', { error: errorMsg, item: null, categories, nextTag: '', selectedCategoryId: '' });
    }
});

router.get('/view/:id', requireAuth, async (req, res) => {
    try {
        const item = await get(`SELECT * FROM items WHERE id = ?`, [req.params.id]);
        if (!item) {
            req.flash('error', 'Item not found');
            return res.redirect('/items');
        }

        const allocation = await get(`SELECT a.*, e.name as emp_name, e.emp_id as emp_code FROM allocations a LEFT JOIN employees e ON a.employee_id = e.id WHERE a.item_id = ? AND a.status='active'`, [req.params.id]);

        const maintenanceLogs = await all(`SELECT * FROM maintenance WHERE item_id = ? ORDER BY issue_date DESC`, [req.params.id]);

        const allocationHistory = await all(`SELECT a.*, e.name as emp_name, e.emp_id as emp_code FROM allocations a LEFT JOIN employees e ON a.employee_id = e.id WHERE a.item_id = ? ORDER BY a.allocated_date DESC`, [req.params.id]);

        res.render('items/view', { item, allocation, maintenanceLogs, allocationHistory });
    } catch (err) {
        console.error('View item error:', err.message);
        req.flash('error', 'Failed to load item details');
        res.redirect('/items');
    }
});

router.get('/edit/:id', requireAuth, async (req, res) => {
    try {
        const item = await get(`SELECT * FROM items WHERE id = ?`, [req.params.id]);
        if (!item) {
            req.flash('error', 'Item not found');
            return res.redirect('/items');
        }
        const categories = await all(`SELECT * FROM categories ORDER BY name`);
        res.render('items/add', { error: null, item, categories, nextTag: '', selectedCategoryId: '' });
    } catch (err) {
        console.error('Edit item error:', err.message);
        req.flash('error', 'Failed to load item');
        res.redirect('/items');
    }
});

router.post('/edit/:id', requireAuth, upload.single('image'), validateCsrf, async (req, res) => {
    try {
        const { asset_tag, category, brand, model, serial_number, specifications, purchase_date, purchase_price, vendor, warranty_end, status, condition, location, notes } = req.body;

        let sql = `UPDATE items SET asset_tag=?, category=?, brand=?, model=?, serial_number=?, specifications=?, purchase_date=?, purchase_price=?, vendor=?, warranty_end=?, status=?, condition=?, location=?, notes=?, updated_at=CURRENT_TIMESTAMP`;
        let params = [asset_tag, category, brand, model, serial_number, specifications, purchase_date, purchase_price, vendor, warranty_end, status, condition, location, notes];

        if (req.file) {
            sql += `, image=?`;
            params.push(req.file.filename);
        }

        sql += ` WHERE id=?`;
        params.push(req.params.id);

        await run(sql, params);
        req.flash('success', 'Item ' + asset_tag + ' updated successfully');
        res.redirect('/items');
    } catch (err) {
        console.error('Update item error:', err.message);
        req.flash('error', 'Failed to update item');
            const item = await get(`SELECT * FROM items WHERE id = ?`, [req.params.id]);
            const categories = await all(`SELECT * FROM categories ORDER BY name`);
        res.render('items/add', { error: 'Failed to update item', item, categories, nextTag: '', selectedCategoryId: '' });
    }
});

router.post('/delete/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const item = await get(`SELECT asset_tag FROM items WHERE id = ?`, [req.params.id]);
        if (!item) {
            req.flash('error', 'Item not found');
            return res.redirect('/items');
        }

        await run(`DELETE FROM allocations WHERE item_id = ?`, [req.params.id]);
        await run(`DELETE FROM maintenance WHERE item_id = ?`, [req.params.id]);
        await run(`DELETE FROM items WHERE id = ?`, [req.params.id]);

        req.flash('success', 'Item ' + item.asset_tag + ' deleted successfully');
        res.redirect('/items');
    } catch (err) {
        console.error('Delete item error:', err.message);
        req.flash('error', 'Failed to delete item');
        res.redirect('/items');
    }
});

router.get('/bulk-clone', requireAuth, async (req, res) => {
    try {
        const categories = await all(`SELECT * FROM categories ORDER BY name`);
        res.render('items/bulk-clone', { error: null, categories });
    } catch (err) {
        req.flash('error', 'Failed to load form');
        res.redirect('/items');
    }
});

router.post('/bulk-clone', requireAuth, async (req, res) => {
    try {
        const { category, brand, model, specifications, purchase_date, purchase_price, vendor, warranty_end, condition, location, notes, serial_numbers } = req.body;

        if (!serial_numbers || !serial_numbers.trim()) {
        const categories = await all(`SELECT * FROM categories ORDER BY name`);
            return res.render('items/bulk-clone', { error: 'Enter at least one serial number', categories });
        }

        const serialList = serial_numbers.split('\n').map(s => s.trim()).filter(s => s);
        const catInfo = await get(`SELECT * FROM categories WHERE id=?`, [category]);
        if (!catInfo) {
            req.flash('error', 'Invalid category');
            return res.redirect('/items/bulk-clone');
        }

        const last = await get(`SELECT asset_tag FROM items WHERE asset_tag LIKE ? ORDER BY id DESC LIMIT 1`, [catInfo.prefix + '-%']);
        let startNum = 0;
        if (last) {
            startNum = parseInt(last.asset_tag.split('-')[1]) || 0;
        }

        let added = 0;
        const errors = [];

        for (let i = 0; i < serialList.length; i++) {
            const num = startNum + 1 + i;
            const tag = catInfo.prefix + '-' + String(num).padStart(4, '0');
            const existing = await get(`SELECT id FROM items WHERE asset_tag=?`, [tag]);
            if (existing) { errors.push('Tag ' + tag + ' already exists'); continue; }

            let qrCode = '';
            try { qrCode = await QRCode.toDataURL(serialList[i]); } catch (e) {}

            await run(`INSERT INTO items (asset_tag, category, brand, model, serial_number, specifications, purchase_date, purchase_price, vendor, warranty_end, status, condition, location, notes, qr_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tag, catInfo.name, brand, model, serialList[i], specifications, purchase_date, purchase_price ? parseFloat(purchase_price) : null, vendor, warranty_end, 'available', condition || 'new', location, notes, qrCode]);
            added++;
        }

        req.flash('success', added + ' item(s) created. ' + errors.join('; '));
        res.redirect('/items');
    } catch (err) {
        console.error('Bulk clone error:', err.message);
        const categories = await all(`SELECT * FROM categories ORDER BY name`);
        res.render('items/bulk-clone', { error: 'Clone failed: ' + err.message, categories });
    }
});

module.exports = router;
