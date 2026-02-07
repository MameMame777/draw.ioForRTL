import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { WaveJSON } from 'wavedrom';

/**
 * Draw.io Editor Provider — embeds draw.io in a WebView for .drawio files.
 *
 * Supports two modes:
 *   - **Offline (local)**: Bundled draw.io webapp from `media/drawio/`.
 *     Loads index.html directly into an iframe via `webview.asWebviewUri()`.
 *     Includes WaveDrom plugin and custom shape library.
 *   - **Online (fallback)**: `embed.diagrams.net` iframe.
 *     Used when the local webapp is not present.
 *
 * WaveDrom integration:
 *   - draw.io plugin (`media/drawio-plugin-wavedrom.js`) adds a toolbar button,
 *     JSON editor dialog, double-click editing, and context menu inside draw.io.
 *   - Custom shape library (`media/drawio-wavedrom-library.xml`) provides
 *     drag-and-drop WaveDrom template shapes in the sidebar.
 *   - Extension commands can also insert WaveDrom SVG and truth tables via postMessage.
 */
export class DrawioEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private activeWebview: vscode.WebviewPanel | undefined;

    /** Whether the local draw.io webapp is available */
    private readonly isOfflineAvailable: boolean;

    constructor(private readonly context: vscode.ExtensionContext) {
        // Check if local draw.io webapp exists
        const localIndexPath = path.join(
            this.context.extensionPath, 'media', 'drawio', 'index.html'
        );
        this.isOfflineAvailable = fs.existsSync(localIndexPath);
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.activeWebview = webviewPanel;

        const localResourceRoots = [
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules'),
        ];

        // For offline mode, add the drawio webapp directory
        if (this.isOfflineAvailable) {
            localResourceRoots.push(
                vscode.Uri.joinPath(this.context.extensionUri, 'media', 'drawio')
            );
        }

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots,
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.getText());

        // Handle messages from draw.io webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'save': {
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        message.xml
                    );
                    await vscode.workspace.applyEdit(edit);
                    break;
                }
                case 'ready':
                    // Send initial XML
                    webviewPanel.webview.postMessage({
                        type: 'load',
                        xml: document.getText(),
                    });
                    break;
                case 'export':
                    // Handle export requests
                    break;
                case 'plugin-loaded':
                    // WaveDrom plugin has been loaded inside draw.io
                    // Library is now loaded via customLibraries in configure
                    break;
                case 'command':
                    // Execute a VS Code command triggered from the draw.io toolbar
                    if (message.command) {
                        vscode.commands.executeCommand(message.command);
                    }
                    break;
                case 'pick-file-link': {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectMany: false,
                        openLabel: 'Select Link Target',
                        filters: {
                            'HDL Files': ['v', 'sv', 'vhd', 'vhdl'],
                            'All Files': ['*'],
                        },
                    });
                    if (picked && picked[0]) {
                        const pickedPath = picked[0].fsPath;
                        webviewPanel.webview.postMessage({
                            type: 'file-link-picked',
                            filePath: pickedPath,
                        });
                    }
                    break;
                }
                case 'open-file':
                    if (message.filePath) {
                        const fp: string = message.filePath;
                        let fileUri: vscode.Uri;
                        if (/^[a-zA-Z]:[\\\/]/.test(fp) || fp.startsWith('/')) {
                            fileUri = vscode.Uri.file(fp);
                        } else {
                            // Relative path — resolve from the .drawio file's directory
                            const docDir = vscode.Uri.joinPath(document.uri, '..');
                            fileUri = vscode.Uri.joinPath(docDir, fp);
                        }
                        vscode.window.showTextDocument(fileUri, { viewColumn: vscode.ViewColumn.Beside });
                    }
                    break;
                case 'info':
                    vscode.window.showInformationMessage(message.text);
                    break;
            }
        }, undefined, this.disposables);

        webviewPanel.onDidDispose(() => {
            if (this.activeWebview === webviewPanel) {
                this.activeWebview = undefined;
            }
        });
    }

    /**
     * Insert a WaveDrom diagram into the active draw.io editor.
     * The JSON is sent to the webview where the plugin's auto-render
     * creates a proper UserObject cell with editable WaveDrom JSON.
     */
    public async insertWaveDrom(waveJson: WaveJSON): Promise<void> {
        if (!this.activeWebview) {
            vscode.window.showWarningMessage('No draw.io editor is open. Open a .drawio file first.');
            return;
        }

        this.activeWebview.webview.postMessage({
            type: 'insert-wavedrom',
            json: JSON.stringify(waveJson),
        });
    }

    /**
     * Insert a truth table as an mxGraph table shape
     */
    public async insertTruthTableXml(xml: string): Promise<void> {
        if (!this.activeWebview) {
            vscode.window.showWarningMessage('No draw.io editor is open. Open a .drawio file first.');
            return;
        }

        this.activeWebview.webview.postMessage({
            type: 'insert-truth-table',
            xml: xml,
        });
    }

    /**
     * Insert raw draw.io XML (mxGraphModel) — used for port diagrams, FSM diagrams, etc.
     */
    public async insertRawXml(xml: string): Promise<void> {
        if (!this.activeWebview) {
            vscode.window.showWarningMessage('No draw.io editor is open. Open a .drawio file first.');
            return;
        }

        this.activeWebview.webview.postMessage({
            type: 'insert-truth-table',  // reuse merge handler
            xml: xml,
        });
    }

    // ---------------------------------------------------------------
    // HTML Generation
    // ---------------------------------------------------------------

    private getHtmlForWebview(webview: vscode.Webview, initialXml: string): string {
        const nonce = getNonce();
        const theme = vscode.workspace.getConfiguration('drawwave.drawio').get<string>('theme', 'kennedy');

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css')
        );

        // Build media URIs for plugin resources
        const pluginUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'drawio-plugin-wavedrom.js')
        );

        // Read the custom library JSON for embedding in the webview
        const libraryJson = this.readLibraryJson();

        // Encode XML for embedding
        const encodedXml = encodeURIComponent(initialXml);

        if (this.isOfflineAvailable) {
            return this.getOfflineHtml(webview, nonce, theme, styleUri, pluginUri, encodedXml, libraryJson);
        }
        return this.getOnlineHtml(webview, nonce, theme, styleUri, pluginUri, encodedXml, libraryJson);
    }

    /**
     * Read the custom shape library JSON array from the mxlibrary XML file
     */
    private readLibraryJson(): string {
        const libraryPath = path.join(
            this.context.extensionPath, 'media', 'drawio-wavedrom-library.xml'
        );
        if (!fs.existsSync(libraryPath)) {
            return '[]';
        }
        try {
            const libraryXml = fs.readFileSync(libraryPath, 'utf-8');
            const match = libraryXml.match(/<mxlibrary>([\s\S]*?)<\/mxlibrary>/);
            return match ? match[1] : '[]';
        } catch {
            return '[]';
        }
    }

    /**
     * Offline mode: Load draw.io directly in the webview (no iframe).
     * Uses a <base> tag to resolve relative paths from media/drawio/,
     * and fakes window.opener for draw.io's embed-mode messaging protocol.
     *
     * Approach based on hediet/vscode-drawio's proven pattern.
     */
    private getOfflineHtml(
        webview: vscode.Webview,
        _nonce: string,
        theme: string,
        _styleUri: vscode.Uri,
        pluginUri: vscode.Uri,
        encodedXml: string,
        libraryJson: string
    ): string {
        const drawioBaseUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'drawio')
        );

        // WaveDrom browser bundle for the draw.io plugin
        // Use wavedrom.min.js (not unpkg) — it sets window.WaveDrom.ProcessAll
        // which is the API our draw.io plugin expects.
        const wavedromUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'wavedrom', 'wavedrom.min.js')
        );
        const wavedromSkinUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'wavedrom', 'skins', 'default.js')
        );

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <base href="${drawioBaseUri}/">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
            script-src 'unsafe-inline' 'unsafe-eval' ${webview.cspSource};
            style-src 'unsafe-inline' ${webview.cspSource};
            img-src ${webview.cspSource} data: blob:;
            font-src ${webview.cspSource};
            connect-src ${webview.cspSource};
            worker-src ${webview.cspSource} blob:;">
    <link rel="stylesheet" type="text/css" href="styles/grapheditor.css">
    <style>
        body { overflow: hidden; margin: 0; padding: 0; }
        html, body { height: 100%; width: 100%; }
    </style>
</head>
<body class="geEditor">
    <div id="geInfo">
        <div class="geBlock" style="margin:100px;text-align:center;">
            <h2 id="geStatus">Loading...</h2>
        </div>
    </div>

    <script>
    // ==== Phase 1: Setup (must run BEFORE draw.io scripts) ====
    (function() {
        var vscode = acquireVsCodeApi();
        window.__drawwave_vscode = vscode;

        // URL parameters for draw.io embed mode
        window.urlParams = {
            embed: '1',
            proto: 'json',
            spin: '1',
            ui: '${theme}',
            libraries: '1',
            configure: '1',
            stealth: '1',
            noExitBtn: '1',
            noSaveBtn: '1',
            local: '1'
        };

        // Prevent Electron path detection
        window.mxIsElectron = false;
        window.DRAWIO_PUBLIC_BUILD = true;

        // Data for initialization
        var initialXml = decodeURIComponent('${encodedXml}');
        var libraryData = ${libraryJson.replace(/<\//g, '<\\/')};
        var initialized = false;

        // ==== Fake window.opener for draw.io embed protocol ====
        // In embed mode, draw.io sends messages via window.opener.postMessage().
        // We intercept these to bridge VS Code <-> draw.io communication.
        var fakedWindowOpener = {
            postMessage: function(msgStr) {
                var msg;
                try {
                    msg = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
                } catch(e) { return; }

                switch (msg.event) {
                    case 'init':
                        initialized = true;
                        // Let extension send the load command
                        vscode.postMessage({ type: 'ready' });
                        break;

                    case 'autosave':
                    case 'save':
                        vscode.postMessage({ type: 'save', xml: msg.xml });
                        if (msg.event === 'save') {
                            sendToDrawio({ action: 'status', message: 'Saved', modified: false });
                        }
                        break;

                    case 'export':
                        vscode.postMessage({ type: 'export', format: msg.format, data: msg.data });
                        break;

                    case 'configure':
                        sendToDrawio({
                            action: 'configure',
                            config: {
                                defaultFonts: ['Cascadia Code', 'Consolas', 'monospace'],
                                css: '.geToolbar { min-height: 36px; }',
                                defaultLibraries: 'general;uml;drawwave-wavedrom;drawwave-truthtable',
                                libraries: [
                                    {
                                        title: { main: 'DrawWave' },
                                        entries: [
                                            {
                                                id: 'drawwave-wavedrom',
                                                title: { main: 'WaveDrom Templates' },
                                                desc: { main: 'Timing diagram shapes (double-click to edit)' },
                                                libs: [{
                                                    title: { main: 'WaveDrom Templates' },
                                                    tags: 'wavedrom timing waveform clock bus',
                                                    data: libraryData.filter(function(e) { return e.title && e.title.indexOf('Truth Table') === -1; })
                                                }]
                                            },
                                            {
                                                id: 'drawwave-truthtable',
                                                title: { main: 'Truth Tables' },
                                                desc: { main: 'Logic gate truth table shapes' },
                                                libs: [{
                                                    title: { main: 'Truth Tables' },
                                                    tags: 'truth table logic gate and or xor',
                                                    data: libraryData.filter(function(e) { return e.title && e.title.indexOf('Truth Table') !== -1; })
                                                }]
                                            }
                                        ]
                                    }
                                ]
                            }
                        });
                        break;
                }

                // Plugin loaded notification
                if (msg.event === 'pluginLoaded' && msg.plugin === 'drawwave-wavedrom') {
                    vscode.postMessage({ type: 'plugin-loaded' });
                }
            }
        };
        Object.defineProperty(window, 'opener', { value: fakedWindowOpener });

        // ==== Handle incoming messages from VS Code extension ====
        window.addEventListener('message', function(evt) {
            // Ignore events dispatched by sendToDrawio (they have faked source)
            if (evt.source === fakedWindowOpener) return;

            var msg = evt.data;
            if (!msg || !msg.type) {
                // May be a raw draw.io message from internal script — re-dispatch
                return;
            }
            if (!initialized) return;

            switch (msg.type) {
                case 'load':
                    sendToDrawio({ action: 'load', xml: msg.xml, autosave: 1 });
                    break;

                case 'insert-wavedrom': {
                    // Use <object> UserObject so wavedromJson attribute is preserved.
                    // Placeholder style triggers the plugin's auto-render listener,
                    // which renders WaveDrom SVG and enables double-click editing.
                    var placeholderStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;' +
                        'fontSize=11;fontFamily=Arial;fontStyle=1;verticalAlign=middle;';
                    var cellXml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
                        '<object label="WaveDrom" wavedromJson="' + escapeHtml(msg.json) + '" id="2">' +
                        '<mxCell style="' + escapeHtml(placeholderStyle) + '" vertex="1" parent="1">' +
                        '<mxGeometry x="100" y="100" width="160" height="60" as="geometry"/>' +
                        '</mxCell></object></root></mxGraphModel>';
                    sendToDrawio({ action: 'merge', xml: cellXml });
                    break;
                }

                case 'insert-truth-table':
                    sendToDrawio({ action: 'merge', xml: msg.xml });
                    break;

                case 'file-link-picked':
                    // Forward picked file path to the plugin callback
                    if (window.__drawwave_onFilePicked) {
                        window.__drawwave_onFilePicked(msg.filePath);
                    }
                    break;
            }

            evt.stopImmediatePropagation();
            evt.preventDefault();
        });

        // Send an action to draw.io by dispatching a faked MessageEvent
        function sendToDrawio(msg) {
            var fakedEvt = new Event('message');
            fakedEvt.source = fakedWindowOpener;
            fakedEvt.data = JSON.stringify(msg);
            // Suppress window.focus during message handling
            var origFocus = window.focus;
            window.focus = function() {};
            try {
                window.dispatchEvent(fakedEvt);
            } finally {
                window.focus = origFocus;
            }
        }
        window.__drawwave_sendToDrawio = sendToDrawio;

        function escapeHtml(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        // ==== mxscript helper (draw.io uses this to load scripts) ====
        window.mxscript = function(src, onLoad, id, dataAppKey, noWrite) {
            var s = document.createElement('script');
            s.setAttribute('type', 'text/javascript');
            s.setAttribute('src', src);
            if (id) s.setAttribute('id', id);
            if (dataAppKey) s.setAttribute('data-app-key', dataAppKey);
            if (onLoad) {
                var r = false;
                s.onload = s.onreadystatechange = function() {
                    if (!r && (!this.readyState || this.readyState === 'complete')) {
                        r = true;
                        onLoad();
                    }
                };
            }
            var t = document.getElementsByTagName('script')[0];
            if (t) t.parentNode.insertBefore(s, t);
        };

        // ==== App initialization flags ====
        window.mxScriptsLoaded = false;
        window.mxWinLoaded = false;
        window.checkAllLoaded = function() {
            if (window.mxScriptsLoaded && window.mxWinLoaded) {
                App.main();
            }
        };

        // Prevent EditorUi.addEmbedButtons from adding unwanted buttons
        window.addEventListener('load', function() {
            if (typeof EditorUi !== 'undefined') {
                EditorUi.prototype.addEmbedButtons = function() {};
            }
        });
    })();
    </script>

    <!-- draw.io scripts loaded directly (no iframe) via <base> tag resolution -->
    <script src="js/PreConfig.js"></script>
    <script src="js/app.min.js"></script>
    <script>
    // Initialize plugin system RIGHT AFTER app.min.js loads.
    // In stealth mode, App.initPluginCallback() is not called automatically,
    // so Draw.loadPlugin would be undefined and our plugin would fail.
    if (typeof App !== 'undefined' && App.initPluginCallback) {
        App.initPluginCallback();
    }
    // Bump embedModePluginsCount so draw.io waits for our plugin
    if (typeof App !== 'undefined') {
        App.embedModePluginsCount = (App.embedModePluginsCount || 0) + 1;
    }
    window.mxScriptsLoaded = true;
    window.checkAllLoaded();
    </script>
    <script src="js/extensions.min.js"></script>
    <script src="js/stencils.min.js"></script>
    <script src="js/shapes-14-6-5.min.js"></script>
    <script src="js/PostConfig.js"></script>

    <!-- WaveDrom browser bundle for the draw.io plugin -->
    <script src="${wavedromSkinUri}"></script>
    <script src="${wavedromUri}"></script>

    <!-- DrawWave WaveDrom plugin -->
    <script src="${pluginUri}"></script>

    <script>
    // ==== Phase 2: Trigger App.main() on window load ====
    window.addEventListener('load', function() {
        window.mxWinLoaded = true;
        window.checkAllLoaded();
    });
    </script>
</body>
</html>`;
    }

    /**
     * Online mode: Load draw.io from embed.diagrams.net (fallback).
     * Requires internet connectivity. Plugin and library are loaded
     * via draw.io's configure action.
     */
    private getOnlineHtml(
        webview: vscode.Webview,
        nonce: string,
        theme: string,
        styleUri: vscode.Uri,
        _pluginUri: vscode.Uri,
        encodedXml: string,
        libraryJson: string
    ): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
            frame-src https://*.diagrams.net https://embed.diagrams.net;
            img-src ${webview.cspSource} data: https:;
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource} 'unsafe-inline';
            font-src ${webview.cspSource};">
    <link rel="stylesheet" href="${styleUri}">
    <title>Draw.io Editor (Online)</title>
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
        iframe { height: 100%; width: 100%; border: none; display: block; }
    </style>
</head>
<body>
    <iframe id="drawio-frame"
        src="https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=${theme}&libraries=1&configure=1&noExitBtn=1&noSaveBtn=1">
    </iframe>

    <script nonce="${nonce}">
        (function() {
            var vscode = acquireVsCodeApi();
            var iframe = document.getElementById('drawio-frame');
            var initialXml = decodeURIComponent('${encodedXml}');
            var libraryData = ${libraryJson.replace(/<\//g, '<\\/')};
            var initialized = false;

            // Bidirectional message bridge
            window.addEventListener('message', function(event) {
                if (event.source === window.frames[0]) {
                    // Message from draw.io iframe → handle and forward to VS Code
                    handleDrawioMessage(event.data);
                } else {
                    // Message from VS Code → handle
                    var msg = event.data;
                    if (msg && msg.type) {
                        handleExtensionMessage(msg);
                    }
                }
            });

            function handleDrawioMessage(data) {
                var msg;
                try {
                    msg = typeof data === 'string' ? JSON.parse(data) : data;
                } catch(e) { return; }

                switch (msg.event) {
                    case 'init':
                        initialized = true;
                        vscode.postMessage({ type: 'ready' });
                        break;

                    case 'autosave':
                    case 'save':
                        vscode.postMessage({ type: 'save', xml: msg.xml });
                        if (msg.event === 'save') {
                            postToDrawio({ action: 'status', message: 'Saved', modified: false });
                        }
                        break;

                    case 'export':
                        vscode.postMessage({ type: 'export', format: msg.format, data: msg.data });
                        break;

                    case 'configure':
                        postToDrawio({
                            action: 'configure',
                            config: {
                                defaultFonts: ['Cascadia Code', 'Consolas', 'monospace'],
                                defaultLibraries: 'general;uml;drawwave-wavedrom;drawwave-truthtable',
                                libraries: [
                                    {
                                        title: { main: 'DrawWave' },
                                        entries: [
                                            {
                                                id: 'drawwave-wavedrom',
                                                title: { main: 'WaveDrom Templates' },
                                                desc: { main: 'Timing diagram shapes' },
                                                libs: [{
                                                    title: { main: 'WaveDrom Templates' },
                                                    tags: 'wavedrom timing waveform clock bus',
                                                    data: libraryData.filter(function(e) { return e.title && e.title.indexOf('Truth Table') === -1; })
                                                }]
                                            },
                                            {
                                                id: 'drawwave-truthtable',
                                                title: { main: 'Truth Tables' },
                                                desc: { main: 'Logic gate truth table shapes' },
                                                libs: [{
                                                    title: { main: 'Truth Tables' },
                                                    tags: 'truth table logic gate and or xor',
                                                    data: libraryData.filter(function(e) { return e.title && e.title.indexOf('Truth Table') !== -1; })
                                                }]
                                            }
                                        ]
                                    }
                                ]
                            }
                        });
                        // In online mode, plugins can't be loaded locally
                        vscode.postMessage({ type: 'plugin-loaded' });
                        break;
                }
            }

            function handleExtensionMessage(msg) {
                if (!initialized) return;

                switch (msg.type) {
                    case 'load':
                        postToDrawio({ action: 'load', xml: msg.xml, autosave: 1 });
                        break;

                    case 'insert-wavedrom': {
                        // Use <object> UserObject so wavedromJson attribute is preserved.
                        // Placeholder style triggers the plugin's auto-render listener.
                        var placeholderStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;' +
                            'fontSize=11;fontFamily=Arial;fontStyle=1;verticalAlign=middle;';
                        var cellXml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
                            '<object label="WaveDrom" wavedromJson="' + escapeHtml(msg.json) + '" id="2">' +
                            '<mxCell style="' + escapeHtml(placeholderStyle) + '" vertex="1" parent="1">' +
                            '<mxGeometry x="100" y="100" width="160" height="60" as="geometry"/>' +
                            '</mxCell></object></root></mxGraphModel>';
                        postToDrawio({ action: 'merge', xml: cellXml });
                        break;
                    }

                    case 'insert-truth-table':
                        postToDrawio({ action: 'merge', xml: msg.xml });
                        break;
                }
            }

            function postToDrawio(msg) {
                if (iframe.contentWindow) {
                    iframe.contentWindow.postMessage(JSON.stringify(msg), '*');
                }
            }

            function escapeHtml(str) {
                return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }
        })();
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
