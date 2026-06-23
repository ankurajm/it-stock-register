const { all, run } = require('../config/db');

const RESERVED = new Set(['ADM', 'PRP', 'VCP', 'SUP', 'HMS']);

async function getExistingInitials() {
    const rows = await all(`SELECT initials FROM users WHERE initials != ''`);
    return new Set(rows.map(r => r.initials.toUpperCase()));
}

async function generateInitials(name) {
    const existing = await getExistingInitials();
    const clean = name.replace(/[^a-zA-Z ]/g, '').trim();
    const words = clean.split(/\s+/).filter(w => w.length > 0);

    let candidates = [];

    if (words.length >= 2) {
        candidates.push((words[0][0] + words[1][0] + (words[2] ? words[2][0] : words[1][1])).toUpperCase());
        candidates.push((words[0][0] + words[0][1] + words[1][0]).toUpperCase());
    }

    for (let i = 0; i < clean.length - 2; i++) {
        candidates.push(clean.substring(i, i + 3).toUpperCase());
    }

    candidates = [...new Set(candidates)];

    for (const c of candidates) {
        if (c.length === 3 && /^[A-Z]{3}$/.test(c) && !existing.has(c) && !RESERVED.has(c)) {
            return c;
        }
    }

    for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        const c = (clean[0] || 'X').toUpperCase() + letter + letter;
        if (!existing.has(c) && !RESERVED.has(c)) return c;
    }

    let n = 1;
    while (true) {
        const c = ((clean[0] || 'X') + (clean[1] || 'X') + n).toUpperCase();
        if (!existing.has(c) && !RESERVED.has(c)) return c;
        n++;
    }
}

const ROLE_INITIALS_MAP = {
    'principal': 'PRP',
    'vice principal': 'VCP',
    'headmistress': 'HMS',
    'headmaster': 'HMS'
};

function getRoleInitial(designation, role) {
    if (role === 'admin') return 'SUP';
    if (!designation) return null;
    const key = designation.toLowerCase().trim();
    return ROLE_INITIALS_MAP[key] || null;
}

async function generateInitialsForEmployee(name, designation, role) {
    const roleInitial = getRoleInitial(designation, role);
    if (roleInitial) {
        await run(`UPDATE users SET initials = '' WHERE initials = ?`, [roleInitial]);
        return roleInitial;
    }
    return await generateInitials(name);
}

function generatePassword(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < length; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
}

module.exports = { generateInitials, generatePassword, generateInitialsForEmployee, getRoleInitial, RESERVED };