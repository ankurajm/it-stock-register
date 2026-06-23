require('dotenv').config();
const path = require('path');

module.exports = {
    port: process.env.PORT || 3000,
    sessionSecret: process.env.SESSION_SECRET,
    dbPath: process.env.DB_PATH || './database.db',
    uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
    backupDir: path.resolve(process.env.BACKUP_DIR || './backups'),
    backupCron: process.env.BACKUP_CRON || '0 0 * * *',
    schoolName: process.env.SCHOOL_NAME || 'My School',
    schoolLogo: process.env.SCHOOL_LOGO || ''
};
