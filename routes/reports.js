const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { get, all } = require('../config/db');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const config = require('../config/app');
const path = require('path');
const fs = require('fs');
const { registerFonts } = require('../utils/fonts');

router.get('/', requireAuth, async (req, res) => {
    try {
        const categories = await all(`SELECT DISTINCT name FROM categories ORDER BY name`);
        res.render('reports/index', { categories });
    } catch (err) {
        console.error('Reports menu error:', err.message);
        req.flash('error', 'Failed to load reports');
        res.redirect('/');
    }
});

async function getSchoolInfo() {
    const info = await get(`SELECT * FROM school_settings LIMIT 1`);
    return info || { school_name: config.schoolName, school_logo: '', academic_session: '', sub_heading: '' };
}

async function getAcademicSession() {
    const info = await get(`SELECT academic_session FROM school_settings LIMIT 1`);
    if (info && info.academic_session) return info.academic_session;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 4) return `Session: ${year}-${(year + 1).toString().slice(-2)}`;
    return `Session: ${year - 1}-${year.toString().slice(-2)}`;
}

function safeFont(doc, name, fallback) {
    try { return doc.font(name); } catch (e) { return doc.font(fallback || 'Helvetica'); }
}

function getLogoBuffer(info) {
    if (info.school_logo && fs.existsSync(path.join(config.uploadDir, info.school_logo))) {
        return { type: 'file', path: path.join(config.uploadDir, info.school_logo) };
    }
    if (info.school_logo_data) {
        return { type: 'buffer', data: Buffer.from(info.school_logo_data, 'base64') };
    }
    return null;
}

function drawSchoolLogo(doc, info, x, y, size) {
    const logo = getLogoBuffer(info);
    if (!logo) return false;
    try {
        if (logo.type === 'file') {
            doc.image(logo.path, x, y, { width: size, height: size });
        } else {
            doc.image(logo.data, x, y, { width: size, height: size });
        }
        return true;
    } catch (e) {
        console.warn('Logo render error:', e.message);
        return false;
    }
}

async function addReportHeader(doc, title) {
    const info = await getSchoolInfo();
    registerFonts(doc);

    const pageWidth = doc.page.width;
    const logoSize = 60;
    const logoX = 30;
    const textCenterX = pageWidth / 2;
    const textStartY = 50;

    drawSchoolLogo(doc, info, 30, 50, 60);

    const session = await getAcademicSession();
    const nameFont = 'Olde English';
    const subFont = 'Pristina';

    doc.y = textStartY;
    doc.fontSize(24); safeFont(doc, nameFont, 'Helvetica-Bold').text(info.school_name, { align: 'center' });
    if (info.sub_heading) {
        doc.moveDown(0.15);
        doc.fontSize(12); safeFont(doc, subFont, 'Helvetica').fillColor('#555').text(info.sub_heading, { align: 'center' });
        doc.fillColor('#000');
    }
    doc.moveDown(0.15);
    doc.fontSize(12).font('Times-Roman').fillColor('#000').text(session, { align: 'center' });
    doc.moveDown(0.4);
    doc.moveTo(30, doc.y).lineTo(pageWidth - 30, doc.y).stroke('#ccc');
    doc.moveDown(0.5);

    return doc;
}

function addReportFooter(doc) {
    const bottomY = doc.page.height - 50;
    doc.fontSize(10).font('Helvetica');
    doc.moveTo(doc.page.width - 240, bottomY).lineTo(doc.page.width - 40, bottomY).stroke('#999');
    doc.text('Authorized Signature', doc.page.width - 240, bottomY - 14, { width: 200, align: 'right' });
    doc.fontSize(7).font('Helvetica').fillColor('#999');
    doc.text('This is a computer-generated document.', doc.page.width - 240, bottomY + 4, { width: 200, align: 'right' });
    doc.fillColor('#000');
}

async function generatePDF(data, columns, title, res) {
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '_').toLowerCase()}.pdf"`);

    try {
        doc.pipe(res);

        await addReportHeader(doc, title);

        const tableTop = doc.y;
        const colWidth = (doc.page.width - 60) / columns.length;

        doc.rect(30, tableTop - 4, doc.page.width - 60, 18).fill('#4472C4');
        doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        columns.forEach((col, i) => {
            const header = col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            doc.text(header, 30 + i * colWidth + 2, tableTop, { width: colWidth - 4, align: 'left' });
        });
        doc.fill('#000000');

        let y = tableTop + 20;
        doc.font('Helvetica').fontSize(7);
        for (const [rowIndex, row] of data.entries()) {
            if (y > doc.page.height - 80) {
                addReportFooter(doc);
                doc.addPage();
                await addReportHeader(doc, title + ' (cont.)');
                y = doc.y;

                doc.rect(30, y - 4, doc.page.width - 60, 18).fill('#4472C4');
                doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
                columns.forEach((col, i) => {
                    const header = col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    doc.text(header, 30 + i * colWidth + 2, y, { width: colWidth - 4, align: 'left' });
                });
                doc.fill('#000000');
                y += 20;
            }
            if (rowIndex % 2 === 0) {
                doc.rect(30, y - 2, doc.page.width - 60, 14).fillOpacity(0.05).fill('#f0f0f0').fillOpacity(1);
            }
            columns.forEach((col, i) => {
                doc.fill('#000000').text(String(row[col] || ''), 30 + i * colWidth + 2, y, { width: colWidth - 4, align: 'left' });
            });
            y += 15;
        }

        addReportFooter(doc);
        doc.end();
    } catch (err) {
        if (!doc._closed) { try { doc.end(); } catch (e) { /* ignore */ } }
        throw err;
    }
}

async function generateExcel(data, columns, title, res) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(title.substring(0, 31));

    sheet.columns = columns.map(col => ({
        header: col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        key: col,
        width: 20
    }));

    data.forEach(row => sheet.addRow(row));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '_').toLowerCase()}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
}

router.get('/items/pdf', requireAuth, async (req, res) => {
    try {
        const { category, status } = req.query;
        let query = `SELECT * FROM items WHERE 1=1`;
        let params = [];
        if (category) { query += ` AND category=?`; params.push(category); }
        if (status) { query += ` AND status=?`; params.push(status); }
        query += ` ORDER BY asset_tag`;

        const items = await all(query, params);
        const title = category ? category + ' Items Report' : status ? status.charAt(0).toUpperCase() + status.slice(1) + ' Items Report' : 'All Items Report';
        const columns = ['asset_tag', 'category', 'brand', 'model', 'serial_number', 'status', 'location', 'purchase_date', 'purchase_price', 'warranty_end'];
        await generatePDF(items, columns, title, res);
    } catch (err) {
        console.error('PDF generation error:', err.message);
        res.status(500).send('PDF generation failed');
    }
});

router.get('/items/excel', requireAuth, async (req, res) => {
    try {
        const { category, status } = req.query;
        let query = `SELECT * FROM items WHERE 1=1`;
        let params = [];
        if (category) { query += ` AND category=?`; params.push(category); }
        if (status) { query += ` AND status=?`; params.push(status); }
        query += ` ORDER BY asset_tag`;

        const items = await all(query, params);
        const title = category ? category + ' Items' : status ? status.charAt(0).toUpperCase() + status.slice(1) + ' Items' : 'All Items';
        const columns = ['asset_tag', 'category', 'brand', 'model', 'serial_number', 'status', 'condition', 'location', 'purchase_date', 'purchase_price', 'vendor', 'warranty_end'];
        await generateExcel(items, columns, title, res);
    } catch (err) {
        console.error('Excel generation error:', err.message);
        res.status(500).send('Excel generation failed');
    }
});

router.get('/allocations/pdf', requireAuth, async (req, res) => {
    try {
        const allocations = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, e.name as emp_name, e.username as emp_code, e.department FROM allocations a LEFT JOIN items i ON a.item_id = i.id LEFT JOIN users e ON a.employee_id = e.id ORDER BY a.allocated_date DESC`);

        const activeAllocations = allocations.filter(a => a.status === 'active');
        const columns = ['asset_tag', 'emp_name', 'emp_code', 'department', 'allocated_date', 'status'];
        await generatePDF(activeAllocations, columns, 'Active Allocations Report', res);
    } catch (err) {
        console.error('PDF generation error:', err.message);
        res.status(500).send('PDF generation failed');
    }
});

router.get('/allocations/excel', requireAuth, async (req, res) => {
    try {
        const allocations = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, e.name as emp_name, e.username as emp_code, e.department FROM allocations a LEFT JOIN items i ON a.item_id = i.id LEFT JOIN users e ON a.employee_id = e.id ORDER BY a.allocated_date DESC`);

        const columns = ['asset_tag', 'emp_name', 'emp_code', 'department', 'allocated_date', 'return_date', 'status'];
        await generateExcel(allocations, columns, 'All Allocations Report', res);
    } catch (err) {
        console.error('Excel generation error:', err.message);
        res.status(500).send('Excel generation failed');
    }
});

router.get('/maintenance/pdf', requireAuth, async (req, res) => {
    try {
        const records = await all(`SELECT m.*, i.asset_tag, i.category, i.brand, i.model FROM maintenance m LEFT JOIN items i ON m.item_id = i.id ORDER BY m.issue_date DESC`);
        const columns = ['asset_tag', 'issue_date', 'issue_description', 'vendor', 'cost', 'status', 'resolution_date'];
        await generatePDF(records, columns, 'Maintenance Report', res);
    } catch (err) {
        console.error('PDF generation error:', err.message);
        res.status(500).send('PDF generation failed');
    }
});

router.get('/maintenance/excel', requireAuth, async (req, res) => {
    try {
        const records = await all(`SELECT m.*, i.asset_tag, i.category, i.brand, i.model FROM maintenance m LEFT JOIN items i ON m.item_id = i.id ORDER BY m.issue_date DESC`);
        const columns = ['asset_tag', 'category', 'issue_date', 'issue_description', 'vendor', 'cost', 'status', 'resolution_date'];
        await generateExcel(records, columns, 'Maintenance Report', res);
    } catch (err) {
        console.error('Excel generation error:', err.message);
        res.status(500).send('Excel generation failed');
    }
});

router.get('/warranty/pdf', requireAuth, async (req, res) => {
    try {
        const items = await all(`SELECT * FROM items WHERE warranty_end IS NOT NULL AND date(warranty_end) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' ORDER BY warranty_end`);
        const columns = ['asset_tag', 'category', 'brand', 'model', 'serial_number', 'purchase_date', 'warranty_end', 'vendor'];
        await generatePDF(items, columns, 'Warranty Expiring Report', res);
    } catch (err) {
        console.error('PDF generation error:', err.message);
        res.status(500).send('PDF generation failed');
    }
});

router.get('/warranty/excel', requireAuth, async (req, res) => {
    try {
        const items = await all(`SELECT * FROM items WHERE warranty_end IS NOT NULL AND date(warranty_end) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' ORDER BY warranty_end`);
        const columns = ['asset_tag', 'category', 'brand', 'model', 'serial_number', 'purchase_date', 'warranty_end', 'vendor'];
        await generateExcel(items, columns, 'Warranty Expiring', res);
    } catch (err) {
        console.error('Excel generation error:', err.message);
        res.status(500).send('Excel generation failed');
    }
});

router.get('/my-items', requireAuth, async (req, res) => {
    try {
        const emp = await get(`SELECT id FROM users WHERE username = ?`, [req.session.user.username]);
        const empId = emp ? emp.id : -1;
        const items = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, i.purchase_date, i.purchase_price, i.status as item_status FROM allocations a LEFT JOIN items i ON a.item_id = i.id WHERE a.employee_id = ? ORDER BY a.allocated_date DESC`, [empId]);

        const activeItems = items.filter(a => a.status === 'active');

        res.render('reports/my-items', { items, activeItems });
    } catch (err) {
        console.error('My items report error:', err.message);
        req.flash('error', 'Failed to load items');
        res.redirect('/');
    }
});

router.get('/my-items/pdf', requireAuth, async (req, res) => {
    let doc;
    try {
        const empRow = await get(`SELECT id FROM users WHERE username = ?`, [req.session.user.username]);
        const employeeId = empRow ? empRow.id : -1;
        const items = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, i.purchase_date, i.purchase_price, i.status as item_status FROM allocations a LEFT JOIN items i ON a.item_id = i.id WHERE a.employee_id = ? ORDER BY a.allocated_date DESC`, [employeeId]);

        const activeItems = items.filter(a => a.status === 'active');
        const returnedItems = items.filter(a => a.status === 'returned');
        const info = await getSchoolInfo();

        const userInfo = await get(`SELECT * FROM users WHERE id = ?`, [employeeId]);

        doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });
        res.setHeader('Content-Type', 'application/pdf');
        const filename = 'items_record_' + (userInfo ? userInfo.username : req.session.user.username) + '.pdf';
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 80;
        registerFonts(doc);

        drawSchoolLogo(doc, info, 40, 50, 60);

        const session = await getAcademicSession();
        const nameFont = 'Olde English';
        const subFont = 'Pristina';
        doc.y = 60;
        doc.fontSize(24); safeFont(doc, nameFont, 'Helvetica-Bold').text(info.school_name, { align: 'center' });
        if (info.sub_heading) {
            doc.moveDown(0.15);
            doc.fontSize(12); safeFont(doc, subFont, 'Helvetica').fillColor('#555').text(info.sub_heading, { align: 'center' });
            doc.fillColor('#000');
        }
        doc.moveDown(0.15);
        doc.fontSize(12).font('Times-Roman').fillColor('#000').text(session, { align: 'center' });

        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#4472C4');
        doc.moveDown(0.5);

        doc.fontSize(9).font('Helvetica').fillColor('#666').text('Date: ' + new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }), { align: 'right' });
        doc.fillColor('#000');
        doc.moveDown();

        doc.fontSize(10).font('Helvetica-Bold').text('Employee Details');
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');
        const name = userInfo ? userInfo.name : req.session.user.username;
        const empId = userInfo ? userInfo.username : '-';
        const dept = userInfo ? userInfo.department : '-';
        const designation = userInfo ? userInfo.designation : '-';
        doc.text('Name:          ' + name);
        doc.text('Employee ID:   ' + empId);
        doc.text('Department:    ' + dept);
        doc.text('Designation:   ' + designation);
        doc.moveDown();

        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#ccc');
        doc.moveDown();

        doc.fontSize(10).font('Helvetica-Bold').text('Items Currently Issued');
        doc.moveDown(0.3);

        if (activeItems.length === 0) {
            doc.fontSize(10).font('Helvetica').fillColor('#28a745');
            doc.text('No items currently issued.', { align: 'center' });
            doc.fillColor('#000');
        } else {
            const colX = [40, 120, 200, 280, 360, 430];
            const colW = [75, 75, 75, 75, 65, 65];
            const headers = ['Asset Tag', 'Category', 'Brand/Model', 'Serial No.', 'Allocated', 'Status'];

            doc.rect(40, doc.y, pageWidth, 16).fill('#4472C4');
            doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
            headers.forEach((h, i) => doc.text(h, colX[i] + 4, doc.y - 14, { width: colW[i] - 8 }));
            doc.fillColor('#000');

            let y = doc.y + 4;
            activeItems.forEach((item, idx) => {
                if (y > doc.page.height - 120) {
                    doc.addPage();
                    y = 40;
                    doc.rect(40, y, pageWidth, 16).fill('#4472C4');
                    doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
                    headers.forEach((h, i) => doc.text(h, colX[i] + 4, y + 2, { width: colW[i] - 8 }));
                    doc.fillColor('#000');
                    y += 20;
                }
                if (idx % 2 === 0) {
                    doc.rect(40, y - 2, pageWidth, 14).fillOpacity(0.05).fill('#f0f0f0').fillOpacity(1);
                }
                const brandModel = (item.brand || '') + (item.model ? ' ' + item.model : '');
                const vals = [item.asset_tag || '-', item.category || '-', brandModel || '-', item.serial_number || '-', item.allocated_date || '-', 'Issued'];
                doc.fontSize(7).font('Helvetica');
                vals.forEach((v, i) => doc.text(v, colX[i] + 4, y, { width: colW[i] - 8 }));
                y += 16;
            });
            doc.y = y + 10;
        }

        doc.moveDown();

        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#ccc');
        doc.moveDown();

        doc.fontSize(10).font('Helvetica-Bold').text('Items Previously Returned');
        doc.moveDown(0.3);

        if (returnedItems.length === 0) {
            doc.fontSize(10).font('Helvetica').text('None');
        } else {
            const colX = [40, 120, 200, 280, 340, 420];
            const colW = [75, 75, 75, 55, 75, 40];

            doc.rect(40, doc.y, pageWidth, 16).fill('#6c757d');
            doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
            const rHeaders = ['Asset Tag', 'Category', 'Brand/Model', 'Allocated', 'Returned', 'Status'];
            rHeaders.forEach((h, i) => doc.text(h, colX[i] + 4, doc.y - 14, { width: colW[i] - 8 }));
            doc.fillColor('#000');

            let y = doc.y + 4;
            returnedItems.forEach((item, idx) => {
                if (y > doc.page.height - 120) {
                    doc.addPage();
                    y = 40;
                }
                if (idx % 2 === 0) {
                    doc.rect(40, y - 2, pageWidth, 14).fillOpacity(0.05).fill('#f0f0f0').fillOpacity(1);
                }
                const brandModel = (item.brand || '') + (item.model ? ' ' + item.model : '');
                const vals = [item.asset_tag || '-', item.category || '-', brandModel || '-', item.allocated_date || '-', item.return_date || '-', 'Returned'];
                doc.fontSize(7).font('Helvetica');
                vals.forEach((v, i) => doc.text(v, colX[i] + 4, y, { width: colW[i] - 8 }));
                y += 16;
            });
            doc.y = y + 10;
        }

        doc.end();
    } catch (err) {
        console.error('Items record PDF error:', err.message);
        if (doc && !doc._closed) { try { doc.end(); } catch (e) { /* ignore */ } }
        if (!res.headersSent) res.status(500).send('PDF generation failed');
    }
});

router.get('/no-dues', requireAuth, requireAdmin, async (req, res) => {
    try {
        const employees = await all(`SELECT id, username, name, department, designation FROM users WHERE name != '' ORDER BY name`);
        res.render('reports/no-dues', { employees });
    } catch (err) {
        console.error('No dues page error:', err.message);
        req.flash('error', 'Failed to load employees');
        res.redirect('/reports');
    }
});

router.get('/no-dues/:empId/pdf', requireAuth, requireAdmin, async (req, res) => {
    let doc;
    try {
        const emp = await get(`SELECT * FROM users WHERE username = ?`, [req.params.empId]);
        if (!emp) { return res.status(404).send('Employee not found'); }

        const employeeId = emp.id;
        const items = await all(`SELECT a.*, i.asset_tag, i.category, i.brand, i.model, i.serial_number, i.purchase_date, i.purchase_price, i.status as item_status FROM allocations a LEFT JOIN items i ON a.item_id = i.id WHERE a.employee_id = ? ORDER BY a.allocated_date DESC`, [employeeId]);

        const activeItems = items.filter(a => a.status === 'active');
        const returnedItems = items.filter(a => a.status === 'returned');
        const info = await getSchoolInfo();
        const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

        doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });
        res.setHeader('Content-Type', 'application/pdf');
        const filename = 'no_dues_certificate_' + emp.username + '.pdf';
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        doc.pipe(res);

        const pageWidth = doc.page.width - 80;
        registerFonts(doc);

        drawSchoolLogo(doc, info, 40, 50, 60);

        const session = await getAcademicSession();
        const nameFont = 'Olde English';
        const subFont = 'Pristina';
        doc.y = 60;
        doc.fontSize(24); safeFont(doc, nameFont, 'Helvetica-Bold').text(info.school_name, { align: 'center' });
        if (info.sub_heading) {
            doc.moveDown(0.15);
            doc.fontSize(12); safeFont(doc, subFont, 'Helvetica').fillColor('#555').text(info.sub_heading, { align: 'center' });
            doc.fillColor('#000');
        }
        doc.moveDown(0.15);
        doc.fontSize(12).font('Times-Roman').fillColor('#000').text(session, { align: 'center' });

        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#4472C4');
        doc.moveDown(0.5);

        doc.fontSize(16).font('Helvetica-Bold').fillColor('#dc3545').text('NO DUES CERTIFICATE', { align: 'center' });
        doc.fillColor('#000');
        doc.moveDown(0.3);

        doc.fontSize(9).font('Helvetica').fillColor('#666').text('Date: ' + dateStr, { align: 'right' });
        doc.fillColor('#000');
        doc.moveDown();

        doc.fontSize(10).font('Helvetica-Bold').text('Employee Details');
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica');
        doc.text('Name:          ' + emp.name);
        doc.text('Employee ID:   ' + emp.username);
        doc.text('Department:    ' + (emp.department || '-'));
        doc.text('Designation:   ' + (emp.designation || '-'));
        doc.moveDown();

        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#ccc');
        doc.moveDown();

        doc.fontSize(10).font('Helvetica-Bold').text('Items Currently Issued');
        doc.moveDown(0.3);

        if (activeItems.length === 0) {
            doc.fontSize(10).font('Helvetica').fillColor('#28a745');
            doc.text('No items currently issued. All clear.', { align: 'center' });
            doc.fillColor('#000');
        } else {
            const colX = [40, 120, 200, 280, 360, 430];
            const colW = [75, 75, 75, 75, 65, 65];
            const headers = ['Asset Tag', 'Category', 'Brand/Model', 'Serial No.', 'Allocated', 'Status'];

            doc.rect(40, doc.y, pageWidth, 16).fill('#4472C4');
            doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
            headers.forEach((h, i) => doc.text(h, colX[i] + 4, doc.y - 14, { width: colW[i] - 8 }));
            doc.fillColor('#000');

            let y = doc.y + 4;
            activeItems.forEach((item, idx) => {
                if (y > doc.page.height - 120) {
                    doc.addPage();
                    y = 40;
                    doc.rect(40, y, pageWidth, 16).fill('#4472C4');
                    doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
                    headers.forEach((h, i) => doc.text(h, colX[i] + 4, y + 2, { width: colW[i] - 8 }));
                    doc.fillColor('#000');
                    y += 20;
                }
                if (idx % 2 === 0) {
                    doc.rect(40, y - 2, pageWidth, 14).fillOpacity(0.05).fill('#f0f0f0').fillOpacity(1);
                }
                const brandModel = (item.brand || '') + (item.model ? ' ' + item.model : '');
                const vals = [item.asset_tag || '-', item.category || '-', brandModel || '-', item.serial_number || '-', item.allocated_date || '-', 'Issued'];
                doc.fontSize(7).font('Helvetica');
                vals.forEach((v, i) => doc.text(v, colX[i] + 4, y, { width: colW[i] - 8 }));
                y += 16;
            });
            doc.y = y + 10;
        }

        doc.moveDown();

        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#ccc');
        doc.moveDown();

        doc.fontSize(10).font('Helvetica-Bold').text('Items Previously Returned');
        doc.moveDown(0.3);

        if (returnedItems.length === 0) {
            doc.fontSize(10).font('Helvetica').text('None');
        } else {
            const colX = [40, 120, 200, 280, 340, 420];
            const colW = [75, 75, 75, 55, 75, 40];

            doc.rect(40, doc.y, pageWidth, 16).fill('#6c757d');
            doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold');
            const rHeaders = ['Asset Tag', 'Category', 'Brand/Model', 'Allocated', 'Returned', 'Status'];
            rHeaders.forEach((h, i) => doc.text(h, colX[i] + 4, doc.y - 14, { width: colW[i] - 8 }));
            doc.fillColor('#000');

            let y = doc.y + 4;
            returnedItems.forEach((item, idx) => {
                if (y > doc.page.height - 120) {
                    doc.addPage();
                    y = 40;
                }
                if (idx % 2 === 0) {
                    doc.rect(40, y - 2, pageWidth, 14).fillOpacity(0.05).fill('#f0f0f0').fillOpacity(1);
                }
                const brandModel = (item.brand || '') + (item.model ? ' ' + item.model : '');
                const vals = [item.asset_tag || '-', item.category || '-', brandModel || '-', item.allocated_date || '-', item.return_date || '-', 'Returned'];
                doc.fontSize(7).font('Helvetica');
                vals.forEach((v, i) => doc.text(v, colX[i] + 4, y, { width: colW[i] - 8 }));
                y += 16;
            });
            doc.y = y + 10;
        }

        doc.moveDown(2);

        doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#ccc');
        doc.moveDown();

        doc.fontSize(10).font('Helvetica').text('This is to certify that the above-mentioned items have been returned / accounted for. The employee is cleared of all IT asset obligations as of ' + dateStr + '.', { align: 'left', lineGap: 4 });
        doc.moveDown(2);

        const signY = doc.page.height - 120;
        doc.fontSize(10).font('Helvetica');
        doc.text('Employee Signature', 40, signY, { width: 200, align: 'center' });
        doc.moveTo(40, signY + 20).lineTo(240, signY + 20).stroke('#999');
        doc.text(emp.name, 40, signY + 22, { width: 200, align: 'center', fontSize: 8 });

        doc.text('Authorized Signatory', doc.page.width - 240, signY, { width: 200, align: 'center' });
        doc.moveTo(doc.page.width - 240, signY + 20).lineTo(doc.page.width - 40, signY + 20).stroke('#999');
        doc.text('IT Stock Administrator', doc.page.width - 240, signY + 22, { width: 200, align: 'center', fontSize: 8 });

        doc.fontSize(7).font('Helvetica').fillColor('#999');
        doc.text('This is a computer-generated document. No signature is required.', doc.page.width - 240, signY + 45, { width: 200, align: 'center' });
        doc.fillColor('#000');

        doc.end();
    } catch (err) {
        console.error('No dues PDF error:', err.message);
        if (doc && !doc._closed) { try { doc.end(); } catch (e) { /* ignore */ } }
        if (!res.headersSent) res.status(500).send('PDF generation failed');
    }
});

router.get('/departments', requireAuth, async (req, res) => {
    try {
        const departments = await all(`
            SELECT 
                e.department,
                COUNT(DISTINCT e.id) as employee_count,
                COUNT(DISTINCT CASE WHEN a.status='active' THEN a.id END) as active_allocations,
                COUNT(DISTINCT CASE WHEN a.status='active' THEN i.id END) as items_issued,
                COUNT(DISTINCT CASE WHEN i.status='maintenance' THEN i.id END) as in_maintenance
            FROM users e
            LEFT JOIN allocations a ON a.employee_id = e.id
            LEFT JOIN items i ON a.item_id = i.id
            WHERE e.department IS NOT NULL AND e.department != ''
            GROUP BY e.department
            ORDER BY e.department
        `);
        res.render('reports/department', { departments });
    } catch (err) {
        console.error('Department report error:', err.message);
        req.flash('error', 'Failed to load department report');
        res.redirect('/reports');
    }
});

router.get('/departments/pdf', requireAuth, async (req, res) => {
    try {
        const data = await all(`
            SELECT e.department,
                   COUNT(DISTINCT e.id) as employee_count,
                   COUNT(DISTINCT CASE WHEN a.status='active' THEN a.id END) as active_allocations,
                   COUNT(DISTINCT CASE WHEN a.status='active' THEN i.id END) as items_issued
            FROM users e
            LEFT JOIN allocations a ON a.employee_id = e.id
            LEFT JOIN items i ON a.item_id = i.id
            WHERE e.department IS NOT NULL AND e.department != ''
            GROUP BY e.department
            ORDER BY e.department
        `);
        await generatePDF(data, ['department', 'employee_count', 'active_allocations', 'items_issued'], 'Department-wise Summary Report', res);
    } catch (err) {
        console.error('Department PDF error:', err.message);
        req.flash('error', 'Failed to generate PDF');
        res.redirect('/reports/departments');
    }
});

router.get('/departments/excel', requireAuth, async (req, res) => {
    try {
        const data = await all(`
            SELECT e.department,
                   COUNT(DISTINCT e.id) as employee_count,
                   COUNT(DISTINCT CASE WHEN a.status='active' THEN a.id END) as active_allocations,
                   COUNT(DISTINCT CASE WHEN a.status='active' THEN i.id END) as items_issued
            FROM users e
            LEFT JOIN allocations a ON a.employee_id = e.id
            LEFT JOIN items i ON a.item_id = i.id
            WHERE e.department IS NOT NULL AND e.department != ''
            GROUP BY e.department
            ORDER BY e.department
        `);
        await generateExcel(data, ['department', 'employee_count', 'active_allocations', 'items_issued'], 'Department-wise Summary', res);
    } catch (err) {
        console.error('Department Excel error:', err.message);
        req.flash('error', 'Failed to generate Excel');
        res.redirect('/reports/departments');
    }
});

router.get('/departments/:department/pdf', requireAuth, async (req, res) => {
    try {
        const dept = decodeURIComponent(req.params.department);
        const data = await all(`
            SELECT e.name as emp_name, e.username, e.designation,
                   i.asset_tag, i.category, i.brand, i.model, i.serial_number,
                   a.allocated_date, a.expected_return_date, a.status as alloc_status
            FROM users e
            LEFT JOIN allocations a ON a.employee_id = e.id AND a.status = 'active'
            LEFT JOIN items i ON a.item_id = i.id
            WHERE e.department = ?
            ORDER BY e.name, i.asset_tag
        `, [dept]);
        await generatePDF(data, ['emp_name', 'username', 'designation', 'asset_tag', 'category', 'brand', 'model', 'allocated_date', 'alloc_status'], dept + ' Department - IT Assets Report', res);
    } catch (err) {
        console.error('Department detail PDF error:', err.message);
        req.flash('error', 'Failed to generate PDF');
        res.redirect('/reports/departments');
    }
});

router.get('/departments/:department/excel', requireAuth, async (req, res) => {
    try {
        const dept = decodeURIComponent(req.params.department);
        const data = await all(`
            SELECT e.name as emp_name, e.username, e.designation,
                   i.asset_tag, i.category, i.brand, i.model, i.serial_number,
                   a.allocated_date, a.expected_return_date, a.status as alloc_status
            FROM users e
            LEFT JOIN allocations a ON a.employee_id = e.id AND a.status = 'active'
            LEFT JOIN items i ON a.item_id = i.id
            WHERE e.department = ?
            ORDER BY e.name, i.asset_tag
        `, [dept]);
        await generateExcel(data, ['emp_name', 'username', 'designation', 'asset_tag', 'category', 'brand', 'model', 'serial_number', 'allocated_date', 'expected_return_date', 'alloc_status'], dept + ' Department - IT Assets', res);
    } catch (err) {
        console.error('Department detail Excel error:', err.message);
        req.flash('error', 'Failed to generate Excel');
        res.redirect('/reports/departments');
    }
});

router.get('/locations', requireAuth, async (req, res) => {
    try {
        const locations = await all(`
            SELECT 
                i.location,
                COUNT(*) as total_items,
                COUNT(CASE WHEN i.status='available' THEN 1 END) as available,
                COUNT(CASE WHEN i.status='allocated' THEN 1 END) as allocated,
                COUNT(CASE WHEN i.status='fixed' THEN 1 END) as fixed_count,
                COUNT(CASE WHEN i.status='maintenance' THEN 1 END) as in_maintenance
            FROM items i
            WHERE i.location IS NOT NULL AND i.location != ''
            GROUP BY i.location
            ORDER BY i.location
        `);
        res.render('reports/location', { locations });
    } catch (err) {
        console.error('Location report error:', err.message);
        req.flash('error', 'Failed to load location report');
        res.redirect('/reports');
    }
});

router.get('/locations/pdf', requireAuth, async (req, res) => {
    try {
        const data = await all(`
            SELECT i.location,
                   COUNT(*) as total_items,
                   COUNT(CASE WHEN i.status='available' THEN 1 END) as available,
                   COUNT(CASE WHEN i.status='allocated' THEN 1 END) as allocated,
                   COUNT(CASE WHEN i.status='fixed' THEN 1 END) as fixed_count
            FROM items i
            WHERE i.location IS NOT NULL AND i.location != ''
            GROUP BY i.location
            ORDER BY i.location
        `);
        await generatePDF(data, ['location', 'total_items', 'available', 'allocated', 'fixed_count'], 'Location-wise Summary Report', res);
    } catch (err) {
        console.error('Location PDF error:', err.message);
        req.flash('error', 'Failed to generate PDF');
        res.redirect('/reports/locations');
    }
});

router.get('/locations/excel', requireAuth, async (req, res) => {
    try {
        const data = await all(`
            SELECT i.location,
                   COUNT(*) as total_items,
                   COUNT(CASE WHEN i.status='available' THEN 1 END) as available,
                   COUNT(CASE WHEN i.status='allocated' THEN 1 END) as allocated,
                   COUNT(CASE WHEN i.status='fixed' THEN 1 END) as fixed_count
            FROM items i
            WHERE i.location IS NOT NULL AND i.location != ''
            GROUP BY i.location
            ORDER BY i.location
        `);
        await generateExcel(data, ['location', 'total_items', 'available', 'allocated', 'fixed_count'], 'Location-wise Summary', res);
    } catch (err) {
        console.error('Location Excel error:', err.message);
        req.flash('error', 'Failed to generate Excel');
        res.redirect('/reports/locations');
    }
});

router.get('/locations/:location/pdf', requireAuth, async (req, res) => {
    try {
        const loc = decodeURIComponent(req.params.location);
        const data = await all(`
            SELECT i.asset_tag, i.category, i.brand, i.model, i.serial_number,
                   i.status, i.condition, i.purchase_date, i.warranty_end,
                   CASE WHEN a.status='active' THEN e.name ELSE NULL END as allocated_to,
                   CASE WHEN a.status='active' THEN a.allocated_date ELSE NULL END as allocated_date
            FROM items i
            LEFT JOIN allocations a ON a.item_id = i.id AND a.status = 'active'
            LEFT JOIN users e ON a.employee_id = e.id
            WHERE i.location = ?
            ORDER BY i.asset_tag
        `, [loc]);
        await generatePDF(data, ['asset_tag', 'category', 'brand', 'model', 'status', 'condition', 'allocated_to', 'allocated_date'], loc + ' - IT Assets Report', res);
    } catch (err) {
        console.error('Location detail PDF error:', err.message);
        req.flash('error', 'Failed to generate PDF');
        res.redirect('/reports/locations');
    }
});

router.get('/locations/:location/excel', requireAuth, async (req, res) => {
    try {
        const loc = decodeURIComponent(req.params.location);
        const data = await all(`
            SELECT i.asset_tag, i.category, i.brand, i.model, i.serial_number,
                   i.status, i.condition, i.purchase_date, i.warranty_end,
                   CASE WHEN a.status='active' THEN e.name ELSE NULL END as allocated_to,
                   CASE WHEN a.status='active' THEN a.allocated_date ELSE NULL END as allocated_date
            FROM items i
            LEFT JOIN allocations a ON a.item_id = i.id AND a.status = 'active'
            LEFT JOIN users e ON a.employee_id = e.id
            WHERE i.location = ?
            ORDER BY i.asset_tag
        `, [loc]);
        await generateExcel(data, ['asset_tag', 'category', 'brand', 'model', 'serial_number', 'status', 'condition', 'purchase_date', 'warranty_end', 'allocated_to', 'allocated_date'], loc + ' - IT Assets', res);
    } catch (err) {
        console.error('Location detail Excel error:', err.message);
        req.flash('error', 'Failed to generate Excel');
        res.redirect('/reports/locations');
    }
});

module.exports = router;
