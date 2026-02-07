/**
 * Download draw.io webapp for offline/local execution.
 * 
 * Downloads the draw.io webapp from GitHub releases and extracts
 * the necessary files to media/drawio/ for local WebView serving.
 * 
 * Usage: node scripts/download-drawio.js [--version 24.7.17]
 * 
 * This is a build-time/setup script. The downloaded files are
 * checked into source or included in the .vsix package.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Default draw.io version
const DEFAULT_VERSION = '24.7.17';
const version = process.argv.includes('--version')
    ? process.argv[process.argv.indexOf('--version') + 1]
    : DEFAULT_VERSION;

const DRAWIO_REPO = 'jgraph/drawio';
const OUTPUT_DIR = path.join(__dirname, '..', 'media', 'drawio');
const TEMP_DIR = path.join(__dirname, '..', '.drawio-temp');

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const follow = (url) => {
            const client = url.startsWith('https') ? https : http;
            client.get(url, { headers: { 'User-Agent': 'DrawWave-Builder' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    follow(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                    return;
                }
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
                file.on('error', reject);
            }).on('error', reject);
        };
        follow(url);
    });
}

async function main() {
    console.log(`DrawWave: Downloading draw.io webapp v${version}...`);

    // Create directories
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const zipUrl = `https://github.com/${DRAWIO_REPO}/archive/refs/tags/v${version}.zip`;
    const zipPath = path.join(TEMP_DIR, `drawio-${version}.zip`);

    // Download ZIP
    console.log(`Downloading from: ${zipUrl}`);
    try {
        await downloadFile(zipUrl, zipPath);
    } catch (e) {
        console.error(`Failed to download: ${e.message}`);
        console.error('Check your internet connection and version number.');
        process.exit(1);
    }

    console.log(`Downloaded: ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);

    // Extract using tar (available on Windows 10+ and all Unix)
    console.log('Extracting webapp files...');
    try {
        execSync(`tar -xf "${zipPath}" -C "${TEMP_DIR}"`, { stdio: 'pipe' });
    } catch (e) {
        // Fallback: try PowerShell Expand-Archive
        try {
            execSync(
                `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${TEMP_DIR}' -Force"`,
                { stdio: 'pipe' }
            );
        } catch (e2) {
            console.error('Failed to extract ZIP. Install unzip or use PowerShell.');
            process.exit(1);
        }
    }

    // Copy webapp directory
    const srcWebapp = path.join(TEMP_DIR, `drawio-${version}`, 'src', 'main', 'webapp');
    if (!fs.existsSync(srcWebapp)) {
        console.error(`Webapp directory not found at: ${srcWebapp}`);
        console.error('The draw.io repository structure may have changed.');
        process.exit(1);
    }

    console.log('Copying webapp to media/drawio/...');
    copyDirSync(srcWebapp, OUTPUT_DIR);

    // Write version marker
    fs.writeFileSync(
        path.join(OUTPUT_DIR, '.drawio-version'),
        `${version}\n${new Date().toISOString()}\n`
    );

    // Clean up temp
    console.log('Cleaning up...');
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });

    // Check size
    const totalSize = getDirSize(OUTPUT_DIR);
    console.log(`\nDone! draw.io webapp installed to media/drawio/`);
    console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Version: ${version}`);
}

function copyDirSync(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function getDirSize(dir) {
    let total = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            total += getDirSize(p);
        } else {
            total += fs.statSync(p).size;
        }
    }
    return total;
}

main().catch(e => {
    console.error('Fatal error:', e.message);
    process.exit(1);
});
