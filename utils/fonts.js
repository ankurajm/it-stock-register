const path = require('path');
const fs = require('fs');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');
const WIN_FONTS_DIR = 'C:\\Windows\\Fonts';

const FONT_CONFIG = {
    'Olde English': {
        file: 'OldeEnglish.ttf',
        winFile: 'OLDENGL.TTF',
        fallback: 'Helvetica-Bold'
    },
    'Pristina': {
        file: 'PRISTINA.TTF',
        winFile: 'PRISTINA.TTF',
        fallback: 'Helvetica'
    }
};

function findFontFile(name) {
    const cfg = FONT_CONFIG[name];
    if (!cfg) return null;

    const localPath = path.join(FONTS_DIR, cfg.file);
    if (fs.existsSync(localPath)) return localPath;

    const winPath = path.join(WIN_FONTS_DIR, cfg.winFile);
    if (fs.existsSync(winPath)) return winPath;

    return null;
}

function registerFonts(doc) {
    for (const [name, cfg] of Object.entries(FONT_CONFIG)) {
        const fontPath = findFontFile(name);
        if (fontPath) {
            try {
                doc.registerFont(name, fontPath);
            } catch (e) {
                console.warn(`Font ${name} registration failed: ${e.message}`);
            }
        } else {
            console.warn(`Font ${name} not found`);
        }
    }
}

module.exports = { registerFonts };
