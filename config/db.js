require('dotenv').config();
const path = require('path');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const config = require('./app');

let pool;
let schemaInitialized = false;

function getDB() {
    if (!pool) {
        const { Pool } = require('pg');
        const connectionString = process.env.DATABASE_URL || `postgresql://localhost:5432/it_stock`;
        pool = new Pool({ connectionString, max: 10, ssl: { rejectUnauthorized: false } });
        console.log('PostgreSQL pool created');
    }
    return pool;
}

function convertParams(sql, params) {
    let idx = 0;
    let pgSql = sql
        .replace(/\?/g, () => `$${++idx}`)
        .replace(/datetime\('now'\)/g, 'NOW()')
        .replace(/date\('now', '\+30 days'\)/g, "NOW() + INTERVAL '30 days'")
        .replace(/date\('now'\)/g, 'CURRENT_DATE')
        .replace(/date\((\w+)\)/g, "NULLIF($1::text, '')::date")
        .replace(/\bLIKE\b/g, 'ILIKE');
    if (pgSql.includes('AUTOINCREMENT') || pgSql.includes('AUTOINCREMENT')) {
        pgSql = pgSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
    }
    return { sql: pgSql, params };
}

async function run(sql, params = []) {
    const { sql: pgSql, params: pgParams } = convertParams(sql, params);
    const result = await getDB().query(pgSql, pgParams);
    return { id: result.rows[0]?.id || 0, changes: result.rowCount || 0 };
}

async function get(sql, params = []) {
    const { sql: pgSql, params: pgParams } = convertParams(sql, params);
    const result = await getDB().query(pgSql, pgParams);
    return result.rows[0] || null;
}

async function all(sql, params = []) {
    const { sql: pgSql, params: pgParams } = convertParams(sql, params);
    const result = await getDB().query(pgSql, pgParams);
    return result.rows;
}

async function transaction(callback) {
    const client = await getDB().connect();
    try {
        await client.query('BEGIN');
        const result = await callback({
            run: async (sql, params) => {
                const { sql: pgSql, params: pgParams } = convertParams(sql, params);
                const r = await client.query(pgSql, pgParams);
                return { id: r.rows[0]?.id || 0, changes: r.rowCount || 0 };
            },
            get: async (sql, params) => {
                const { sql: pgSql, params: pgParams } = convertParams(sql, params);
                const r = await client.query(pgSql, pgParams);
                return r.rows[0] || null;
            },
            all: async (sql, params) => {
                const { sql: pgSql, params: pgParams } = convertParams(sql, params);
                const r = await client.query(pgSql, pgParams);
                return r.rows;
            }
        });
        await client.query('COMMIT');
        return result;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function initSchema() {
    if (schemaInitialized) return;
    schemaInitialized = true;
    const fs = require('fs');
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.pg.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await getDB().query(schema);
    console.log('PostgreSQL schema initialized');

    await migrate();

    const bcrypt = require('bcryptjs');

    const existingAdmin = await get(`SELECT id FROM users WHERE username = $1`, ['admin']);
    if (!existingAdmin) {
        const hashedPassword = bcrypt.hashSync('admin123', 12);
        await run(`INSERT INTO users (username, password, role, initials) VALUES ($1, $2, $3, $4)`, ['admin', hashedPassword, 'admin', 'ADM']);
        console.log('Default admin user created (admin / admin123)');
    } else {
        await run(`UPDATE users SET initials='ADM' WHERE username='admin' AND initials != 'ADM'`);
    }

    const existingUser = await get(`SELECT id FROM users WHERE username = $1`, ['user']);
    if (!existingUser) {
        const hashedPassword = bcrypt.hashSync('user123', 12);
        await run(`INSERT INTO users (username, password, role, initials) VALUES ($1, $2, $3, $4)`, ['user', hashedPassword, 'user', 'USR']);
        console.log('Default user created (user / user123)');
    }

    const existingCat = await get(`SELECT id FROM categories LIMIT 1`);
    if (!existingCat) {
        const defaultCategories = ['Laptop','Desktop','Monitor','Printer','Network Equipment','Accessories','Mobile','Tablet','Other'];
        for (const c of defaultCategories) {
            const prefix = c.substring(0, 3).toUpperCase();
            await run(`INSERT INTO categories (name, prefix) VALUES ($1, $2)`, [c, prefix]);
        }
        console.log('Default categories created');
    }

    const schoolSetting = await get(`SELECT id FROM school_settings LIMIT 1`);
    if (!schoolSetting) {
        await run(`INSERT INTO school_settings (school_name, address, sub_heading) VALUES ($1, $2, $3)`, ['My School', 'Enter school address', '']);
        console.log('Default school settings created');
    }
}

async function migrate() {
    const migrations = [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS initials TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_requested INTEGER DEFAULT 0`,
        `ALTER TABLE items ADD COLUMN IF NOT EXISTS qr_code TEXT DEFAULT ''`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS sub_heading TEXT DEFAULT ''`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS academic_session TEXT DEFAULT ''`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_logo_data TEXT DEFAULT ''`,
        `CREATE TABLE IF NOT EXISTS login_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            username TEXT NOT NULL,
            event_type TEXT NOT NULL,
            ip_address TEXT DEFAULT '',
            user_agent TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_login_logs_user_id ON login_logs(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_login_logs_created_at ON login_logs(created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_login_logs_event_type ON login_logs(event_type)`,
        `ALTER TABLE allocations ADD COLUMN IF NOT EXISTS expected_return_date DATE`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS smtp_host TEXT DEFAULT ''`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS smtp_port INTEGER DEFAULT 587`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS smtp_user TEXT DEFAULT ''`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS smtp_pass TEXT DEFAULT ''`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS smtp_from TEXT DEFAULT ''`,
        `ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS return_reminder_days INTEGER DEFAULT 7`,
        // Merge employees into users
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS designation TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS joining_date DATE`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS emp_status TEXT DEFAULT 'active'`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS class_teacher TEXT DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS subject_teacher TEXT DEFAULT ''`,
    ];
    for (const sql of migrations) {
        try { await getDB().query(sql); } catch (e) { /* ignore */ }
    }

    // Migrate employee data into users table (if employees table exists and users don't have name yet)
    try {
        const empTableExists = await get(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees')`);
        if (empTableExists && empTableExists.exists) {
            const userWithName = await get(`SELECT id FROM users WHERE name != '' LIMIT 1`);
            if (!userWithName) {
                // Copy employee data to users where emp_id matches username
                await getDB().query(`
                    UPDATE users SET
                        name = e.name,
                        department = e.department,
                        designation = e.designation,
                        email = e.email,
                        phone = e.phone,
                        joining_date = e.joining_date,
                        emp_status = e.status,
                        class_teacher = e.class_teacher,
                        subject_teacher = e.subject_teacher
                    FROM employees e
                    WHERE users.username = e.emp_id
                `);
                console.log('Employee data migrated to users table');

                // Update allocations to reference users.id instead of employees.id
                await getDB().query(`
                    UPDATE allocations SET employee_id = u.id
                    FROM users u
                    JOIN employees e ON u.username = e.emp_id
                    WHERE allocations.employee_id = e.id
                `);
                console.log('Allocations employee_id updated to reference users');

                // Update notifications to reference users.id instead of employees.id
                try {
                    await getDB().query(`
                        UPDATE notifications SET employee_id = u.id
                        FROM users u
                        JOIN employees e ON u.username = e.emp_id
                        WHERE notifications.employee_id = e.id
                    `);
                    console.log('Notifications employee_id updated to reference users');
                } catch (e) { /* notifications table might not exist */ }

                // Drop old employees table
                await getDB().query(`DROP TABLE IF EXISTS employees CASCADE`);
                console.log('Old employees table dropped');
            }
        }
    } catch (e) {
        console.log('Employee migration skipped:', e.message);
    }

    // Create notifications table if not exists (updated FK)
    try {
        await getDB().query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                allocation_id INTEGER REFERENCES allocations(id) ON DELETE SET NULL,
                employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                notification_type TEXT NOT NULL,
                channel TEXT NOT NULL DEFAULT 'in_app',
                subject TEXT DEFAULT '',
                message TEXT DEFAULT '',
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await getDB().query(`CREATE INDEX IF NOT EXISTS idx_notifications_employee_id ON notifications(employee_id)`);
        await getDB().query(`CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read)`);
    } catch (e) { /* ignore */ }
}

module.exports = { getDB, run, get, all, transaction, initSchema };