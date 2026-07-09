const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../config/db');
const bcrypt = require('bcryptjs');
const { generateInitialsForEmployee, generatePassword, getRoleInitial } = require('../utils/initials');

router.get('/', requireAuth, async (req, res) => {
    try {
        const { search, department, status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;

        let countQuery = `SELECT COUNT(*) as total FROM users WHERE username != 'admin' AND username != 'user' AND name != ''`;
        let query = `SELECT u.*, (SELECT COUNT(*) FROM allocations WHERE employee_id = u.id AND status='active') as allocated_items FROM users u WHERE u.username != 'admin' AND u.username != 'user' AND u.name != ''`;
        let params = [];

        if (search) {
            countQuery += ` AND (u.name LIKE ? OR u.username LIKE ? OR u.department LIKE ?)`;
            query += ` AND (u.name LIKE ? OR u.username LIKE ? OR u.department LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (department) {
            countQuery += ` AND u.department = ?`;
            query += ` AND u.department = ?`;
            params.push(department);
        }
        if (status) {
            countQuery += ` AND u.emp_status = ?`;
            query += ` AND u.emp_status = ?`;
            params.push(status);
        }
        query += ` ORDER BY u.name ASC LIMIT ? OFFSET ?`;

        const totalResult = await get(countQuery, params);
        const totalItems = totalResult.total;
        const totalPages = Math.ceil(totalItems / limit);
        const employees = await all(query, [...params, limit, offset]);
        const currentPage = page;

        const departments = await all(`SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department != '' AND name != '' ORDER BY department`);

        res.render('employees/list', { employees, departments, search, department, status, currentPage, totalPages, totalItems });
    } catch (err) {
        console.error('Employees list error:', err.message);
        req.flash('error', 'Failed to load employees');
        res.redirect('/');
    }
});

router.get('/add', requireAuth, requireAdmin, (req, res) => {
    res.render('employees/add', { error: null, employee: null });
});

router.post('/add', requireAuth, requireAdmin, require('express-rate-limit')({ windowMs: 60 * 1000, max: 30, handler: (req, res) => { req.flash('error', 'Too many requests.'); res.redirect('/employees'); } }), async (req, res) => {
    try {
        const { emp_id, name, department, designation, email, phone, joining_date, status, class_teacher, subject_teacher } = req.body;
        const joiningDateVal = joining_date || null;

        const existingUser = await get(`SELECT id FROM users WHERE username = ?`, [emp_id]);
        if (existingUser) {
            // Update existing user with employee details
            await run(`UPDATE users SET name=?, department=?, designation=?, email=?, phone=?, joining_date=?, emp_status=?, class_teacher=?, subject_teacher=? WHERE username=?`,
                [name, department, designation, email, phone, joiningDateVal, status || 'active', class_teacher || '', subject_teacher || '', emp_id]);
            req.flash('success', 'Employee ' + name + ' updated successfully');
        } else {
            // Create new user with employee details
            const initials = await generateInitialsForEmployee(name, designation, 'user');
            const password = generatePassword();
            const hashed = bcrypt.hashSync(password, 12);
            await run(`INSERT INTO users (username, password, initials, role, name, department, designation, email, phone, joining_date, emp_status, class_teacher, subject_teacher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [emp_id, hashed, initials, 'user', name, department, designation, email, phone, joiningDateVal, status || 'active', class_teacher || '', subject_teacher || '']);
            req.flash('success', `Employee ${name} added. Username: ${emp_id}, Password: ${password}, Initials: ${initials}`);
        }

        res.redirect('/employees');
    } catch (err) {
        console.error('Add employee error:', err.message);
        const errorMsg = err.message.includes('UNIQUE') ? 'Employee ID already exists!' : 'Failed to add employee';
        res.render('employees/add', { error: errorMsg, employee: null });
    }
});

router.get('/view/:id', requireAuth, async (req, res) => {
    try {
        const employee = await get(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
        if (!employee || !employee.name) {
            req.flash('error', 'Employee not found');
            return res.redirect('/employees');
        }

        const allocations = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model FROM allocations a LEFT JOIN items i ON a.item_id = i.id WHERE a.employee_id = ? ORDER BY a.allocated_date DESC`, [req.params.id]);

        res.render('employees/view', { employee, allocations });
    } catch (err) {
        console.error('View employee error:', err.message);
        req.flash('error', 'Failed to load employee details');
        res.redirect('/employees');
    }
});

router.get('/edit/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const employee = await get(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
        if (!employee || !employee.name) {
            req.flash('error', 'Employee not found');
            return res.redirect('/employees');
        }
        res.render('employees/add', { error: null, employee });
    } catch (err) {
        console.error('Edit employee error:', err.message);
        req.flash('error', 'Failed to load employee');
        res.redirect('/employees');
    }
});

router.post('/edit/:id', requireAuth, requireAdmin, require('express-rate-limit')({ windowMs: 60 * 1000, max: 30, handler: (req, res) => { req.flash('error', 'Too many requests.'); res.redirect('/employees'); } }), async (req, res) => {
    try {
        const { emp_id, name, department, designation, email, phone, joining_date, status, class_teacher, subject_teacher } = req.body;
        const joiningDateVal = joining_date || null;
        await run(`UPDATE users SET username=?, name=?, department=?, designation=?, email=?, phone=?, joining_date=?, emp_status=?, class_teacher=?, subject_teacher=? WHERE id=?`,
            [emp_id, name, department, designation, email, phone, joiningDateVal, status, class_teacher || '', subject_teacher || '', req.params.id]);

        const roleInitial = getRoleInitial(designation, 'user');
        if (roleInitial) {
            const current = await get(`SELECT initials FROM users WHERE id = ?`, [req.params.id]);
            if (current && current.initials !== roleInitial) {
                await run(`UPDATE users SET initials = '' WHERE initials = ? AND id != ?`, [roleInitial, req.params.id]);
                await run(`UPDATE users SET initials = ? WHERE id = ?`, [roleInitial, req.params.id]);
            }
        }

        req.flash('success', 'Employee ' + name + ' updated successfully');
        res.redirect('/employees');
    } catch (err) {
        console.error('Update employee error:', err.message);
        req.flash('error', 'Failed to update employee');
        const employee = await get(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
        res.render('employees/add', { error: 'Failed to update employee', employee });
    }
});

router.post('/delete/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const emp = await get(`SELECT name FROM users WHERE id = ?`, [req.params.id]);
        if (!emp || !emp.name) {
            req.flash('error', 'Employee not found');
            return res.redirect('/employees');
        }

        const activeAllocs = await all(`SELECT item_id FROM allocations WHERE employee_id=? AND status='active'`, [req.params.id]);
        for (const a of activeAllocs) {
            await run(`UPDATE items SET status='available' WHERE id=?`, [a.item_id]);
        }
        await run(`UPDATE allocations SET status='returned', return_date=CURRENT_DATE WHERE employee_id=? AND status='active'`, [req.params.id]);
        // Clear employee fields instead of deleting the user account
        await run(`UPDATE users SET name='', department='', designation='', emp_status='inactive' WHERE id=?`, [req.params.id]);

        req.flash('success', 'Employee ' + emp.name + ' removed successfully');
        res.redirect('/employees');
    } catch (err) {
        console.error('Delete employee error:', err.message);
        req.flash('error', 'Failed to delete employee');
        res.redirect('/employees');
    }
});

router.get('/export/credentials/pdf', requireAuth, requireAdmin, async (req, res) => {
    try {
        const PDFDocument = require('pdfkit');
        const rows = await all(`SELECT username, name, department, designation, initials FROM users WHERE name != '' ORDER BY name`);

        const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="employee_credentials.pdf"');
        doc.pipe(res);

        doc.fontSize(16).font('Helvetica-Bold').text('Employee Credentials', { align: 'center' });
        doc.fontSize(9).font('Helvetica').fillColor('#666').text('Generated: ' + new Date().toLocaleDateString('en-IN'), { align: 'center' });
        doc.fillColor('#000');
        doc.moveDown();

        const colX = [30, 140, 250, 340, 420];
        const headers = ['Emp ID', 'Name', 'Department', 'Username', 'Initials'];
        const pageWidth = doc.page.width - 60;

        doc.rect(30, doc.y, pageWidth, 18).fill('#4472C4');
        doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        headers.forEach((h, i) => doc.text(h, colX[i] + 4, doc.y - 14, { width: (colX[i + 1] || doc.page.width - 30) - colX[i] - 8 }));
        doc.fillColor('#000');

        let y = doc.y + 4;
        for (const [idx, row] of rows.entries()) {
            if (y > doc.page.height - 60) {
                doc.addPage();
                y = 30;
                doc.rect(30, y, pageWidth, 18).fill('#4472C4');
                doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
                headers.forEach((h, i) => doc.text(h, colX[i] + 4, y + 2, { width: (colX[i + 1] || doc.page.width - 30) - colX[i] - 8 }));
                doc.fillColor('#000');
                y += 22;
            }
            if (idx % 2 === 0) {
                doc.rect(30, y - 2, pageWidth, 16).fillOpacity(0.05).fill('#f0f0f0').fillOpacity(1);
            }
            doc.fontSize(7).font('Helvetica');
            doc.text(row.username || '-', colX[0] + 4, y, { width: colX[1] - colX[0] - 8 });
            doc.text(row.name || '-', colX[1] + 4, y, { width: colX[2] - colX[1] - 8 });
            doc.text(row.department || '-', colX[2] + 4, y, { width: colX[3] - colX[2] - 8 });
            doc.text(row.username || '-', colX[3] + 4, y, { width: colX[4] - colX[3] - 8 });
            doc.text(row.initials || '-', colX[4] + 4, y, { width: 80 });
            y += 16;
        }

        doc.end();
    } catch (err) {
        console.error('Export credentials PDF error:', err.message);
        req.flash('error', 'Failed to export credentials');
        res.redirect('/employees');
    }
});

router.get('/export/credentials/excel', requireAuth, requireAdmin, async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const rows = await all(`SELECT username, name, department, designation, initials FROM users WHERE name != '' ORDER BY name`);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Employee Credentials');

        sheet.columns = [
            { header: 'Emp ID', key: 'username', width: 15 },
            { header: 'Name', key: 'name', width: 25 },
            { header: 'Department', key: 'department', width: 20 },
            { header: 'Designation', key: 'designation', width: 20 },
            { header: 'Username', key: 'username2', width: 15 },
            { header: 'Initials', key: 'initials', width: 10 }
        ];

        for (const row of rows) {
            sheet.addRow({
                username: row.username,
                name: row.name,
                department: row.department || '-',
                designation: row.designation || '-',
                username2: row.username,
                initials: row.initials || '-'
            });
        }

        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="employee_credentials.xlsx"');
        workbook.xlsx.write(res).then(() => res.end());
    } catch (err) {
        console.error('Export credentials Excel error:', err.message);
        req.flash('error', 'Failed to export credentials');
        res.redirect('/employees');
    }
});

module.exports = router;
