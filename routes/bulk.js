const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { run, get, all, transaction } = require('../config/db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const config = require('../config/app');
const { generateInitials, generatePassword, generateInitialsForEmployee } = require('../utils/initials');

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

function toCSVField(val) {
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function csvFileFilter(req, file, cb) {
    const allowedMimes = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || ext === '.csv') {
        cb(null, true);
    } else {
        cb(new Error('Only CSV files are allowed'), false);
    }
}
const upload = multer({
    dest: path.join(__dirname, '..', 'uploads', 'temp'),
    fileFilter: csvFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.get('/items', requireAuth, requireAdmin, (req, res) => {
    res.render('bulk/items', { error: null, success: null });
});

router.get('/users', requireAuth, requireAdmin, (req, res) => {
    res.render('bulk/users', { error: null, success: null });
});

router.post('/items', requireAuth, requireAdmin, upload.single('file'), validateCsrf, async (req, res) => {
    try {
        if (!req.file) {
            return res.render('bulk/items', { error: 'Please select a CSV file', success: null });
        }
        const content = fs.readFileSync(req.file.path, 'utf8');
        fs.unlinkSync(req.file.path);

        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            return res.render('bulk/items', { error: 'CSV must have a header row and at least one data row', success: null });
        }

        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
        const required = ['asset_tag', 'category'];
        const missing = required.filter(r => !headers.includes(r));
        if (missing.length) {
            return res.render('bulk/items', { error: 'Missing required columns: ' + missing.join(', '), success: null });
        }

        let added = 0, skipped = 0;

        await transaction(async (trx) => {
            for (let i = 1; i < lines.length; i++) {
                const vals = parseCSVLine(lines[i]);
                const row = {};
                headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });

                const existing = await trx.get(`SELECT id FROM items WHERE asset_tag=?`, [row.asset_tag]);
                if (existing) { skipped++; continue; }

                await trx.run(
                    `INSERT INTO items (asset_tag, category, brand, model, serial_number, specifications, purchase_date, purchase_price, vendor, warranty_end, status, condition, location, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [row.asset_tag, row.category, row.brand || null, row.model || null,
                    row.serial_number || null, row.specifications || null, row.purchase_date || null,
                    row.purchase_price ? parseFloat(row.purchase_price) : null, row.vendor || null,
                    row.warranty_end || null, row.status || 'available', row.condition || 'new',
                    row.location || null, row.notes || null]
                );
                added++;
            }
        });
        req.flash('success', added + ' item(s) imported. ' + skipped + ' skipped (duplicate asset tags).');
        res.redirect('/items');
    } catch (err) {
        console.error('Bulk items error:', err.message);
        res.render('bulk/items', { error: 'Import failed: ' + err.message, success: null });
    }
});

router.post('/users', requireAuth, requireAdmin, upload.single('file'), validateCsrf, async (req, res) => {
    try {
        if (!req.file) {
            return res.render('bulk/users', { error: 'Please select a CSV file', success: null });
        }
        const content = fs.readFileSync(req.file.path, 'utf8');
        fs.unlinkSync(req.file.path);

        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            return res.render('bulk/users', { error: 'CSV must have a header row and at least one data row', success: null });
        }

        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
        const required = ['username'];
        const missing = required.filter(r => !headers.includes(r));
        if (missing.length) {
            return res.render('bulk/users', { error: 'Missing required columns: ' + missing.join(', '), success: null });
        }

        const results = [];
        let added = 0, skipped = 0;

        await transaction(async (trx) => {
            for (let i = 1; i < lines.length; i++) {
                const vals = parseCSVLine(lines[i]);
                const row = {};
                headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });

                const existing = await trx.get(`SELECT id FROM users WHERE username=?`, [row.username]);
                if (existing) { skipped++; continue; }

                const initials = row.initials || await generateInitials(row.username);
                const password = row.password || generatePassword();
                const hashed = bcrypt.hashSync(password, 8);
                await trx.run(`INSERT INTO users (username, password, initials, role) VALUES (?, ?, ?, ?)`, [row.username, hashed, initials, row.role || 'user']);
                results.push({ username: row.username, password, initials });
                added++;
            }
        });
        const msg = added + ' user(s) imported. ' + skipped + ' skipped (duplicate usernames).';
        if (results.length > 0) {
            res.render('bulk/users', { error: null, success: msg, results });
        } else {
            req.flash('success', msg);
            res.redirect('/users');
        }
    } catch (err) {
        console.error('Bulk users error:', err.message);
        res.render('bulk/users', { error: 'Import failed: ' + err.message, success: null });
    }
});

router.get('/template/items', requireAuth, requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="items_template.csv"');
    const headers = ['asset_tag', 'category', 'brand', 'model', 'serial_number', 'specifications', 'purchase_date', 'purchase_price', 'vendor', 'warranty_end', 'status', 'condition', 'location', 'notes'];
    const example = ['LAP-0001', 'Laptop', 'Dell', 'Latitude 3420', 'SN001234', '16GB RAM, 512GB SSD', '2024-01-15', '65000', 'Dell Inc.', '2027-01-14', 'available', 'new', 'Store Room A', 'Office use'];
    res.send(headers.map(toCSVField).join(',') + '\n' + example.map(toCSVField).join(',') + '\n');
});

router.get('/template/users', requireAuth, requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users_template.csv"');
    const headers = ['username', 'initials', 'role'];
    const example = ['john', 'JDU', 'user'];
    res.send(headers.join(',') + '\n' + example.join(',') + '\n');
});

async function nextEmpId(trx) {
    const last = await trx.get(`SELECT emp_id FROM employees ORDER BY id DESC LIMIT 1`);
    let num = 0;
    if (last) {
        num = parseInt(last.emp_id.replace(/[^0-9]/g, '')) || 0;
    }
    return 'EMP' + String(num + 1).padStart(4, '0');
}

router.get('/employees', requireAuth, requireAdmin, (req, res) => {
    res.render('bulk/employees', { error: null, success: null, results: null });
});

router.post('/employees', requireAuth, requireAdmin, upload.single('file'), validateCsrf, async (req, res) => {
    try {
        if (!req.file) {
            return res.render('bulk/employees', { error: 'Please select a CSV file', success: null, results: null });
        }
        const content = fs.readFileSync(req.file.path, 'utf8');
        fs.unlinkSync(req.file.path);

        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            return res.render('bulk/employees', { error: 'CSV must have a header row and at least one data row', success: null, results: null });
        }

        const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
        const required = ['name'];
        const missing = required.filter(r => !headers.includes(r));
        if (missing.length) {
            return res.render('bulk/employees', { error: 'Missing required column: name', success: null, results: null });
        }

        const results = [];
        let added = 0, skipped = 0, errors = [];

        await transaction(async (trx) => {
            for (let i = 1; i < lines.length; i++) {
                const vals = parseCSVLine(lines[i]);
                const row = {};
                headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });

                const name = row.name || row.teacher_name || row.employee_name || '';
                if (!name.trim()) { errors.push('Row ' + (i + 1) + ': Name is empty'); skipped++; continue; }

                const emp_id = await nextEmpId(trx);
                const designation = row.designation || 'Teacher';
                const phone = row.contact || row.phone || '';
                const email = row.email || '';
                const classTeacher = row.class || row.class_teacher || '';
                const subjectTeacher = row.subject || row.subject_teacher || '';

                const existingEmp = await trx.get(`SELECT id FROM employees WHERE emp_id = ?`, [emp_id]);
                if (existingEmp) { skipped++; continue; }

                await trx.run(`INSERT INTO employees (emp_id, name, designation, email, phone, class_teacher, subject_teacher, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [emp_id, name.trim(), designation, email, phone, classTeacher, subjectTeacher, 'active']);

                const existingUser = await trx.get(`SELECT id FROM users WHERE username = ?`, [emp_id]);
                if (!existingUser) {
                    const initials = await generateInitialsForEmployee(name.trim(), designation, 'user');
                    const password = generatePassword();
                    const hashed = bcrypt.hashSync(password, 8);
                    await trx.run(`INSERT INTO users (username, password, initials, role) VALUES (?, ?, ?, ?)`, [emp_id, hashed, initials, 'user']);
                    results.push({ emp_id, name: name.trim(), username: emp_id, password, initials, designation, class: classTeacher, subject: subjectTeacher });
                } else {
                    results.push({ emp_id, name: name.trim(), username: emp_id, password: '-', initials: '-', designation, class: classTeacher, subject: subjectTeacher });
                }
                added++;
            }
        });
        const msg = added + ' employee(s) imported. ' + skipped + ' skipped.';
        res.render('bulk/employees', { error: errors.length ? errors.join('; ') : null, success: msg, results });
    } catch (err) {
        console.error('Bulk employees error:', err.message);
        res.render('bulk/employees', { error: 'Import failed: ' + err.message, success: null, results: null });
    }
});

router.get('/template/employees', requireAuth, requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees_template.csv"');
    const headers = ['Sl no', 'Designation', 'Name', 'Initial', 'Contact', 'Email', 'Class', 'Subject'];
    const example = ['1', 'Principal', 'Rajesh Sharma', 'PRP', '9876543210', 'principal@school.edu', '', ''];
    const example2 = ['2', 'Teacher', 'Sunita Verma', 'SNV', '9876543211', 'sunita@school.edu', 'I-A', 'Physics'];
    res.send(headers.map(toCSVField).join(',') + '\n' + example.map(toCSVField).join(',') + '\n' + example2.map(toCSVField).join(',') + '\n');
});

module.exports = router;
