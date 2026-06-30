const nodemailer = require('nodemailer');
const { get } = require('../config/db');

let transporter = null;

async function getTransporter() {
    if (transporter) return transporter;
    try {
        const settings = await get(`SELECT * FROM school_settings LIMIT 1`);
        if (!settings || !settings.smtp_host) return null;
        transporter = nodemailer.createTransport({
            host: settings.smtp_host,
            port: settings.smtp_port || 587,
            secure: (settings.smtp_port === 465),
            auth: {
                user: settings.smtp_user,
                pass: settings.smtp_pass
            }
        });
        return transporter;
    } catch (err) {
        console.error('Mailer init error:', err.message);
        return null;
    }
}

async function sendEmail(to, subject, html) {
    const transport = await getTransporter();
    if (!transport) return false;
    try {
        const settings = await get(`SELECT smtp_from FROM school_settings LIMIT 1`);
        await transport.sendMail({
            from: settings?.smtp_from || settings?.smtp_user || 'noreply@school.com',
            to,
            subject,
            html
        });
        return true;
    } catch (err) {
        console.error('Email send error:', err.message);
        return false;
    }
}

function resetTransporter() {
    transporter = null;
}

module.exports = { sendEmail, resetTransporter };
