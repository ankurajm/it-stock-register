const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const config = require('../config/app');
const { getDB } = require('../config/db');

async function performBackup() {
    await fsp.mkdir(config.backupDir, { recursive: true });

    const sourceDb = config.dbPath;
    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(config.backupDir, `backup-${date}.db`);

    try {
        const db = getDB();
        db.pragma('wal_checkpoint(TRUNCATE)');
        await fsp.copyFile(sourceDb, backupPath);
        console.log(`Backup created: ${backupPath}`);
        return backupPath;
    } catch (err) {
        console.error(`Backup failed: ${err.message}`);
        throw err;
    }
}

async function cleanOldBackups(maxAgeDays = 30) {
    try {
        await fsp.access(config.backupDir);
    } catch {
        return;
    }

    const files = await fsp.readdir(config.backupDir);
    const now = Date.now();
    let removed = 0;

    for (const file of files) {
        const filePath = path.join(config.backupDir, file);
        try {
            const stats = await fsp.stat(filePath);
            const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
            if (ageDays > maxAgeDays) {
                await fsp.unlink(filePath);
                removed++;
            }
        } catch (err) {
            console.error(`Error cleaning backup ${file}: ${err.message}`);
        }
    }

    if (removed > 0) {
        console.log(`Cleaned ${removed} old backup(s)`);
    }
}

async function getBackupInfo() {
    try {
        await fsp.access(config.backupDir);
    } catch {
        return [];
    }

    const files = await fsp.readdir(config.backupDir);

    const result = [];
    for (const f of files) {
        if (!f.endsWith('.db')) continue;
        const filePath = path.join(config.backupDir, f);
        try {
            const stats = await fsp.stat(filePath);
            result.push({
                name: f,
                size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                date: stats.mtime
            });
        } catch { /* skip */ }
    }

    return result.sort((a, b) => b.date - a.date);
}

module.exports = { performBackup, cleanOldBackups, getBackupInfo };
