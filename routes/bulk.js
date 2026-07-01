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

function cleanupStaleTempFiles() {
    const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
    try {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        for (const f of files) {
            const fp = path.join(tempDir, f);
            try {
                const stat = fs.statSync(fp);
                if (now - stat.mtimeMs > 3600000) fs.unlinkSync(fp);
            } catch (_) {}
        }
    } catch (_) {}
}

function validateItemsRow(row, i) {
    const errs = [];
    if (!row.asset_tag) errs.push('Row ' + i + ': asset_tag is required');
    if (!row.category) errs.push('Row ' + i + ': category is required');
    if (row.purchase_price && isNaN(parseFloat(row.purchase_price))) errs.push('Row ' + i + ': purchase_price must be a number');
    if (row.purchase_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.purchase_date)) errs.push('Row ' + i + ': purchase_date must be YYYY-MM-DD');
    if (row.warranty_end && !/^\d{4}-\d{2}-\d{2}$/.test(row.warranty_end)) errs.push('Row ' + i + ': warranty_end must be YYYY-MM-DD');
    return errs;
}

function validateUsersRow(row, i) {
    const errs = [];
    if (!row.username) errs.push('Row ' + i + ': username is required');
    if (row.role && !['user', 'admin'].includes(row.role)) errs.push('Row ' + i + ': role must be "user" or "admin"');
    return errs;
}

function validateEmployeesRow(row, i) {
    const errs = [];
    const name = row.name || row.teacher_name || row.employee_name || '';
    if (!name.trim()) errs.push('Row ' + i + ': Name is required');
    return errs;
}

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
    res.render('bulk/items', { error: null, success: null, preview: null });
});

router.get('/users', requireAuth, requireAdmin, (req, res) => {
    res.render('bulk/users', { error: null, success: null, preview: null, results: null });
});

router.post('/items', requireAuth, requireAdmin, upload.single('file'), validateCsrf, async (req, res) => {
    try {
        cleanupStaleTempFiles();

        // Confirm step: process previously previewed file
        if (req.body.confirm && req.body._tempFile) {
            const tempPath = path.join(__dirname, '..', req.body._tempFile);
            if (!fs.existsSync(tempPath)) {
                return res.render('bulk/items', { error: 'Preview expired, please upload again', success: null, preview: null });
            }
            const content = fs.readFileSync(tempPath, 'utf8');
            fs.unlinkSync(tempPath);

            const lines = content.split('\n').filter(l => l.trim());
            const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
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
            return res.redirect('/items');
        }

        // Preview step: parse, validate, show preview table
        if (!req.file) {
            return res.render('bulk/items', { error: 'Please select a CSV file', success: null, preview: null });
        }
        const content = fs.readFileSync(req.file.path, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/items', { error: 'CSV must have a header row and at least one data row', success: null, preview: null });
        }

        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
        const required = ['asset_tag', 'category'];
        const missing = required.filter(r => !headers.includes(r));
        if (missing.length) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/items', { error: 'Missing required columns: ' + missing.join(', '), success: null, preview: null });
        }

        const rows = [];
        const errors = [];
        for (let i = 1; i < lines.length; i++) {
            const vals = parseCSVLine(lines[i]);
            const row = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
            const rowErrs = validateItemsRow(row, i + 1);
            const existing = await get(`SELECT id FROM items WHERE asset_tag=?`, [row.asset_tag]);
            rows.push({ data: row, errors: rowErrs, duplicate: !!existing });
            if (rowErrs.length) errors.push(rowErrs.join('; '));
        }

        if (errors.length) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/items', { error: 'Validation errors found. Fix and re-upload.', success: null, preview: { rows, headers: headers.filter(h => ['asset_tag','category','brand','model','serial_number','status','condition','location'].includes(h)), tempFile: null } });
        }

        // All valid → show preview
        const tempRel = 'uploads/temp/' + path.basename(req.file.path);
        res.render('bulk/items', { error: null, success: null, preview: { rows, headers: headers.filter(h => ['asset_tag','category','brand','model','serial_number','purchase_date','purchase_price','vendor','status','condition','location'].includes(h)), tempFile: tempRel } });
    } catch (err) {
        console.error('Bulk items error:', err.message);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.render('bulk/items', { error: 'Import failed: ' + err.message, success: null, preview: null });
    }
});

router.post('/users', requireAuth, requireAdmin, upload.single('file'), validateCsrf, async (req, res) => {
    try {
        cleanupStaleTempFiles();

        if (req.body.confirm && req.body._tempFile) {
            const tempPath = path.join(__dirname, '..', req.body._tempFile);
            if (!fs.existsSync(tempPath)) {
                return res.render('bulk/users', { error: 'Preview expired, please upload again', success: null, preview: null, results: null });
            }
            const content = fs.readFileSync(tempPath, 'utf8');
            fs.unlinkSync(tempPath);

            const lines = content.split('\n').filter(l => l.trim());
            const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
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
                return res.render('bulk/users', { error: null, success: msg, results, preview: null });
            }
            req.flash('success', msg);
            return res.redirect('/users');
        }

        if (!req.file) {
            return res.render('bulk/users', { error: 'Please select a CSV file', success: null, preview: null, results: null });
        }
        const content = fs.readFileSync(req.file.path, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/users', { error: 'CSV must have a header row and at least one data row', success: null, preview: null, results: null });
        }

        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
        const missing = ['username'].filter(r => !headers.includes(r));
        if (missing.length) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/users', { error: 'Missing required columns: ' + missing.join(', '), success: null, preview: null, results: null });
        }

        const rows = [];
        const errors = [];
        for (let i = 1; i < lines.length; i++) {
            const vals = parseCSVLine(lines[i]);
            const row = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
            const rowErrs = validateUsersRow(row, i + 1);
            const existing = await get(`SELECT id FROM users WHERE username=?`, [row.username]);
            rows.push({ data: row, errors: rowErrs, duplicate: !!existing });
            if (rowErrs.length) errors.push(rowErrs.join('; '));
        }

        if (errors.length) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/users', { error: 'Validation errors found. Fix and re-upload.', success: null, preview: { rows, headers: ['username','initials','role'], tempFile: null }, results: null });
        }

        const tempRel = 'uploads/temp/' + path.basename(req.file.path);
        res.render('bulk/users', { error: null, success: null, preview: { rows, headers: ['username','initials','role'], tempFile: tempRel }, results: null });
    } catch (err) {
        console.error('Bulk users error:', err.message);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.render('bulk/users', { error: 'Import failed: ' + err.message, success: null, preview: null, results: null });
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
    res.render('bulk/employees', { error: null, success: null, preview: null, results: null });
});

router.post('/employees', requireAuth, requireAdmin, upload.single('file'), validateCsrf, async (req, res) => {
    try {
        cleanupStaleTempFiles();

        if (req.body.confirm && req.body._tempFile) {
            const tempPath = path.join(__dirname, '..', req.body._tempFile);
            if (!fs.existsSync(tempPath)) {
                return res.render('bulk/employees', { error: 'Preview expired, please upload again', success: null, preview: null, results: null });
            }
            const content = fs.readFileSync(tempPath, 'utf8');
            fs.unlinkSync(tempPath);

            const lines = content.split('\n').filter(l => l.trim());
            const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
            const results = [];
            let added = 0, skipped = 0;

            await transaction(async (trx) => {
                for (let i = 1; i < lines.length; i++) {
                    const vals = parseCSVLine(lines[i]);
                    const row = {};
                    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });

                    const name = row.name || row.teacher_name || row.employee_name || '';
                    if (!name.trim()) { skipped++; continue; }

                    const emp_id = await nextEmpId(trx);
                    const designation = row.designation || 'Teacher';
                    const phone = row.contact || row.phone || '';
                    const email = row.email || '';
                    const classTeacher = row.class || row.class_teacher || '';
                    const subjectTeacher = row.subject || row.subject_teacher || '';

                    await trx.run(`INSERT INTO employees (emp_id, name, designation, email, phone, class_teacher, subject_teacher, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [emp_id, name.trim(), designation, email, phone, classTeacher, subjectTeacher, 'active']);

                    const existingUser = await trx.get(`SELECT id FROM users WHERE username = ?`, [emp_id]);
                    if (!existingUser) {
                        const initials = await generateInitialsForEmployee(name.trim(), designation, 'user');
                        const password = generatePassword();
const hashed = bcrypt.hashSync(password, 12);
                        await trx.run(`INSERT INTO users (username, password, initials, role) VALUES (?, ?, ?, ?)`, [emp_id, hashed, initials, 'user']);
                        results.push({ emp_id, name: name.trim(), username: emp_id, password, initials, designation, class: classTeacher, subject: subjectTeacher });
                    } else {
                        results.push({ emp_id, name: name.trim(), username: emp_id, password: '-', initials: '-', designation, class: classTeacher, subject: subjectTeacher });
                    }
                    added++;
                }
            });
            const msg = added + ' employee(s) imported. ' + skipped + ' skipped.';
            return res.render('bulk/employees', { error: null, success: msg, results, preview: null });
        }

        if (!req.file) {
            return res.render('bulk/employees', { error: 'Please select a CSV file', success: null, preview: null, results: null });
        }
        const content = fs.readFileSync(req.file.path, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/employees', { error: 'CSV must have a header row and at least one data row', success: null, preview: null, results: null });
        }

        const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
        const missing = ['name'].filter(r => !headers.includes(r));
        if (missing.length) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/employees', { error: 'Missing required column: name', success: null, preview: null, results: null });
        }

        const rows = [];
        const errors = [];
        for (let i = 1; i < lines.length; i++) {
            const vals = parseCSVLine(lines[i]);
            const row = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
            const rowErrs = validateEmployeesRow(row, i + 1);
            rows.push({ data: row, errors: rowErrs });
            if (rowErrs.length) errors.push(rowErrs.join('; '));
        }

        if (errors.length) {
            fs.unlinkSync(req.file.path);
            return res.render('bulk/employees', { error: 'Validation errors found. Fix and re-upload.', success: null, preview: { rows, headers: ['name','designation','contact','email','class','subject'], tempFile: null }, results: null });
        }

        const tempRel = 'uploads/temp/' + path.basename(req.file.path);
        res.render('bulk/employees', { error: null, success: null, preview: { rows, headers: ['name','designation','contact','email','class','subject'], tempFile: tempRel }, results: null });
    } catch (err) {
        console.error('Bulk employees error:', err.message);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.render('bulk/employees', { error: 'Import failed: ' + err.message, success: null, preview: null, results: null });
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
