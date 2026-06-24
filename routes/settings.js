const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const config = require('../config/app');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validateCsrf } = require('../middleware/csrf');
const { run, get } = require('../config/db');

const upload = multer({
    dest: path.join(__dirname, '..', 'uploads', 'temp'),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) return cb(null, true);
        cb(new Error('Only image files allowed'));
    }
});

router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const settings = await get(`SELECT * FROM school_settings LIMIT 1`);
        res.render('settings/index', { settings, error: null });
    } catch (err) {
        console.error('Settings error:', err.message);
        req.flash('error', 'Failed to load settings');
        res.redirect('/');
    }
});

router.post('/', requireAuth, requireAdmin, upload.single('school_logo'), validateCsrf, async (req, res) => {
    try {
        const { school_name, sub_heading, academic_session, address, city, state, pincode, phone, email } = req.body;
        let logoPath = '';

        if (req.file) {
            const ext = path.extname(req.file.originalname);
            const newName = 'school_logo' + ext;
            const fs = require('fs');
            const newPath = path.join(config.uploadDir, newName);
            if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
            fs.renameSync(req.file.path, newPath);
            logoPath = newName;
        }

        const existing = await get(`SELECT id FROM school_settings LIMIT 1`);
        if (existing) {
            const logoUpdate = logoPath ? `school_logo=?, ` : '';
            const params = logoPath ? [logoPath] : [];
            await run(`UPDATE school_settings SET ${logoUpdate}school_name=?, sub_heading=?, academic_session=?, address=?, city=?, state=?, pincode=?, phone=?, email=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
                [...params, school_name, sub_heading || '', academic_session || '', address, city, state, pincode, phone, email, existing.id]);
        } else {
            await run(`INSERT INTO school_settings (school_name, sub_heading, academic_session, address, city, state, pincode, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [school_name, sub_heading || '', academic_session || '', address, city, state, pincode, phone, email]);
        }

        req.flash('success', 'School settings updated');
        res.redirect('/settings');
    } catch (err) {
        console.error('Update settings error:', err.message);
        const settings = await get(`SELECT * FROM school_settings LIMIT 1`);
        res.render('settings/index', { settings, error: 'Failed to save settings' });
    }
});

module.exports = router;
