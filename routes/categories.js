const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { run, get, all, transaction } = require('../config/db');

router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const categories = await all(`SELECT c.*, (SELECT COUNT(*) FROM items WHERE category=c.name) as item_count FROM categories c ORDER BY c.name`);
        res.render('categories/list', { categories });
    } catch (err) {
        console.error('Categories list error:', err.message);
        req.flash('error', 'Failed to load categories');
        res.redirect('/');
    }
});

router.get('/add', requireAuth, requireAdmin, (req, res) => {
    res.render('categories/add', { error: null, category: null });
});

router.post('/add', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { name, prefix, description } = req.body;
        if (!name || !prefix) {
            return res.render('categories/add', { error: 'Name and prefix are required', category: null });
        }
        await run(`INSERT INTO categories (name, prefix, description) VALUES (?, ?, ?)`, [name, prefix.toUpperCase(), description]);
        req.flash('success', 'Category ' + name + ' added successfully');
        res.redirect('/categories');
    } catch (err) {
        const errorMsg = err.message.includes('UNIQUE') ? 'Category name already exists!' : 'Failed to add category';
        res.render('categories/add', { error: errorMsg, category: null });
    }
});

router.get('/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const category = await get(`SELECT * FROM categories WHERE id = ?`, [req.params.id]);
        if (!category) {
            req.flash('error', 'Category not found');
            return res.redirect('/categories');
        }
        res.render('categories/add', { error: null, category });
    } catch (err) {
        req.flash('error', 'Failed to load category');
        res.redirect('/categories');
    }
});

router.post('/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { name, prefix, description } = req.body;
        const oldCat = await get(`SELECT * FROM categories WHERE id = ?`, [req.params.id]);
        if (!oldCat) {
            req.flash('error', 'Category not found');
            return res.redirect('/categories');
        }
        await transaction(async (trx) => {
            await trx.run(`UPDATE categories SET name=?, prefix=?, description=? WHERE id=?`, [name, prefix.toUpperCase(), description, req.params.id]);
            await trx.run(`UPDATE items SET category=? WHERE category=?`, [name, oldCat.name]);
        });
        req.flash('success', 'Category updated successfully');
        res.redirect('/categories');
    } catch (err) {
        req.flash('error', 'Failed to update category');
        res.redirect('/categories');
    }
});

router.post('/delete/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const cat = await get(`SELECT * FROM categories WHERE id = ?`, [req.params.id]);
        if (!cat) {
            req.flash('error', 'Category not found');
            return res.redirect('/categories');
        }
        const itemCount = await get(`SELECT COUNT(*) as count FROM items WHERE category=?`, [cat.name]);
        if (itemCount.count > 0) {
            req.flash('error', 'Cannot delete category with existing items. Reassign items first.');
            return res.redirect('/categories');
        }
        await run(`DELETE FROM categories WHERE id=?`, [req.params.id]);
        req.flash('success', 'Category deleted successfully');
        res.redirect('/categories');
    } catch (err) {
        req.flash('error', 'Failed to delete category');
        res.redirect('/categories');
    }
});

module.exports = router;
