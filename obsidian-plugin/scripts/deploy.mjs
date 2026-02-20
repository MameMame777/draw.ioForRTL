/**
 * Deploy script — copies built plugin + assets to the Obsidian vault.
 *
 * Usage: node scripts/deploy.mjs [vault-path]
 *   Default vault: E:\Nautilus\Documents\MyObdNote
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(pluginRoot, '..');

// Target vault
const vaultPath = process.argv[2] || 'E:\\Nautilus\\Documents\\MyObdNote';
const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', 'drawwave');

// Ensure plugin directory exists
fs.mkdirSync(pluginDir, { recursive: true });

console.log(`Deploying DrawWave to: ${pluginDir}`);

// 1. Copy core plugin files
const coreFiles = ['main.js', 'manifest.json', 'styles.css'];
for (const file of coreFiles) {
    const src = path.join(pluginRoot, file);
    const dst = path.join(pluginDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        console.log(`  ✓ ${file}`);
    } else {
        console.warn(`  ✗ ${file} not found — run 'npm run build' first`);
    }
}

// 2. Copy draw.io library XML
const libraryFile = 'drawio-wavedrom-library.xml';
const libSrc = path.join(projectRoot, 'media', libraryFile);
const libDst = path.join(pluginDir, libraryFile);
if (fs.existsSync(libSrc)) {
    fs.copyFileSync(libSrc, libDst);
    console.log(`  ✓ ${libraryFile}`);
} else {
    console.warn(`  ✗ ${libraryFile} not found`);
}

// 3. Copy draw.io WaveDrom plugin JS
const pluginJsFile = 'drawio-plugin-wavedrom.js';
const pjSrc = path.join(projectRoot, 'media', pluginJsFile);
const pjDst = path.join(pluginDir, pluginJsFile);
if (fs.existsSync(pjSrc)) {
    fs.copyFileSync(pjSrc, pjDst);
    console.log(`  ✓ ${pluginJsFile}`);
} else {
    console.warn(`  ✗ ${pluginJsFile} not found`);
}

// 4. Copy templates
const templatesSrc = path.join(pluginRoot, 'dist', 'templates');
const templatesDst = path.join(pluginDir, 'templates');
if (fs.existsSync(templatesSrc)) {
    copyDirRecursive(templatesSrc, templatesDst);
    console.log('  ✓ templates/');
} else {
    console.warn('  ✗ dist/templates/ not found');
}

// 5. Copy draw.io webapp (large — skip if already exists and same size)
const drawioSrc = path.join(projectRoot, 'media', 'drawio');
const drawioDst = path.join(pluginDir, 'drawio');
if (fs.existsSync(drawioSrc)) {
    const indexSrc = path.join(drawioSrc, 'index.html');
    const indexDst = path.join(drawioDst, 'index.html');
    const needsCopy = !fs.existsSync(indexDst) ||
        fs.statSync(indexSrc).size !== fs.statSync(indexDst).size;

    if (needsCopy) {
        console.log('  ⏳ Copying draw.io webapp (this may take a moment)...');
        copyDirRecursive(drawioSrc, drawioDst);
        console.log('  ✓ drawio/ (full copy)');
    } else {
        console.log('  ✓ drawio/ (already up to date)');
    }
} else {
    console.warn('  ✗ media/drawio/ not found — run "npm run setup-drawio" in project root');
}

// 5b. Copy drawio-obsidian.html wrapper into the drawio directory
const wrapperSrc = path.join(pluginRoot, 'assets', 'drawio-obsidian.html');
const wrapperDst = path.join(drawioDst, 'drawio-obsidian.html');
if (fs.existsSync(wrapperSrc)) {
    fs.copyFileSync(wrapperSrc, wrapperDst);
    console.log('  ✓ drawio/drawio-obsidian.html');
} else {
    console.warn('  ✗ assets/drawio-obsidian.html not found');
}

// 6. Copy WaveDrom browser bundles (needed by draw.io plugin inside iframe)
const wavedromNodeModules = path.join(projectRoot, 'node_modules', 'wavedrom');
const wavedromDst = path.join(pluginDir, 'wavedrom');
fs.mkdirSync(wavedromDst, { recursive: true });
const wavedromFiles = ['wavedrom.min.js'];
for (const wf of wavedromFiles) {
    const wfSrc = path.join(wavedromNodeModules, wf);
    if (fs.existsSync(wfSrc)) {
        fs.copyFileSync(wfSrc, path.join(wavedromDst, wf));
        console.log(`  ✓ wavedrom/${wf}`);
    }
}
const skinSrc = path.join(wavedromNodeModules, 'skins', 'default.js');
const skinDstDir = path.join(wavedromDst, 'skins');
fs.mkdirSync(skinDstDir, { recursive: true });
if (fs.existsSync(skinSrc)) {
    fs.copyFileSync(skinSrc, path.join(skinDstDir, 'default.js'));
    console.log('  ✓ wavedrom/skins/default.js');
}

console.log('\n✅ Deploy complete. Reload Obsidian to pick up changes.');

// ===================================================================
// Utility
// ===================================================================

function copyDirRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, dstPath);
        } else {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}
