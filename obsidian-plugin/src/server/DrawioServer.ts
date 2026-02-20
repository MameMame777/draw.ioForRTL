/**
 * DrawioServer — minimal HTTP server that serves draw.io static assets
 * from the plugin directory on localhost.
 *
 * Obsidian's `app://` protocol blocks resource loading inside iframes
 * (ERR_BLOCKED_BY_CLIENT), so we serve draw.io via localhost instead.
 *
 * The server:
 *   - Listens on 127.0.0.1 (loopback only, not network-accessible)
 *   - Uses port 0 (OS picks a free port)
 *   - Serves static files with appropriate MIME types
 *   - Adds CORS headers for cross-origin iframe communication
 */

import * as http from 'http';

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

export class DrawioServer {
    private server: http.Server | null = null;
    private port = 0;
    private rootDir = '';

    /**
     * Start the server. Serves static files from `rootDir`.
     * @returns The port number the server is listening on.
     */
    async start(rootDir: string): Promise<number> {
        this.rootDir = rootDir;

        // Lazy-require Node built-ins (safe in Electron)
        const nodeFs = require('fs') as typeof import('fs');
        const nodePath = require('path') as typeof import('path');
        const nodeUrl = require('url') as typeof import('url');

        return new Promise<number>((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                try {
                    const parsedUrl = nodeUrl.parse(req.url || '/', false);
                    let pathname = decodeURIComponent(parsedUrl.pathname || '/');

                    // Security: prevent path traversal
                    pathname = nodePath.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
                    if (pathname.includes('..')) {
                        res.writeHead(403, { 'Content-Type': 'text/plain' });
                        res.end('Forbidden');
                        return;
                    }

                    let filePath = nodePath.join(this.rootDir, pathname);

                    // Default to index.html for directory requests
                    if (pathname.endsWith('/')) {
                        filePath = nodePath.join(filePath, 'index.html');
                    }

                    // Check file exists
                    if (!nodeFs.existsSync(filePath)) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not Found');
                        return;
                    }

                    const stat = nodeFs.statSync(filePath);
                    if (!stat.isFile()) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Not Found');
                        return;
                    }

                    // MIME type
                    const ext = nodePath.extname(filePath).toLowerCase();
                    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

                    // Serve file
                    const content = nodeFs.readFileSync(filePath);
                    res.writeHead(200, {
                        'Content-Type': contentType,
                        'Content-Length': content.length,
                        'Cache-Control': 'no-cache',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(content);
                } catch (err) {
                    console.error('DrawWave server request error:', err);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal Server Error');
                }
            });

            this.server.on('error', (err) => {
                console.error('DrawWave server error:', err);
                reject(err);
            });

            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server!.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                    console.log(`DrawWave: draw.io server started on http://127.0.0.1:${this.port}`);
                    resolve(this.port);
                } else {
                    reject(new Error('Failed to get server address'));
                }
            });
        });
    }

    /** Get the port number. 0 if not started. */
    getPort(): number {
        return this.port;
    }

    /** Stop the server. */
    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            this.port = 0;
            console.log('DrawWave: draw.io server stopped');
        }
    }
}
