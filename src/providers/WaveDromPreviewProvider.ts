import * as vscode from 'vscode';
import type { Timeout } from '../types/types';

/**
 * WaveDrom Preview Provider - renders WaveDrom JSON as SVG in a WebView.
 * 
 * Rendering is done **server-side** (Node.js) using wavedrom + onml to avoid
 * browser-side CSP issues with WaveDrom's ProcessAll/RenderWaveForm.
 * The generated SVG string is sent to the WebView via postMessage.
 */
export class WaveDromPreviewProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    /** Standalone preview panel (opened via command, not custom editor) */
    private standalonePanel: vscode.WebviewPanel | undefined;
    private debounceTimer: Timeout | undefined;

    /**
     * The currently active webview panel (either custom editor or standalone).
     * Used by export commands.
     */
    private activeWebviewPanel: vscode.WebviewPanel | undefined;

    /**
     * The document URI associated with the currently active WaveDrom preview.
     * Used by applyTemplate / editSource commands.
     */
    private activeDocumentUri: vscode.Uri | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {}

    /** Get the URI of the document currently shown in the active WaveDrom preview */
    public getActiveDocumentUri(): vscode.Uri | undefined {
        return this.activeDocumentUri;
    }

    /**
     * Render WaveDrom JSON to SVG string using Node-side wavedrom lib
     */
    private renderToSvg(jsonStr: string): { svg: string; error?: string } {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const wavedrom = require('wavedrom');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const onml = require('onml');

            const source = JSON.parse(jsonStr);
            delete source.meta;
            const jsonml = wavedrom.renderAny(0, source, wavedrom.waveSkin);
            const svg = onml.stringify(jsonml);
            return { svg };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { svg: '', error: message };
        }
    }

    /**
     * Called when a .wavedrom.json file is opened with the custom editor
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Track as the active preview
        this.activeWebviewPanel = webviewPanel;
        this.activeDocumentUri = document.uri;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
            ],
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // Render server-side and send SVG to webview
        const updateWebview = () => {
            const result = this.renderToSvg(document.getText());
            webviewPanel.webview.postMessage({
                type: 'render',
                svg: result.svg,
                error: result.error || null,
            });
        };

        // Listen for document changes (debounced)
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                const debounceMs = vscode.workspace
                    .getConfiguration('drawwave.wavedrom')
                    .get<number>('debounceMs', 300);
                this.debounceTimer = setTimeout(updateWebview, debounceMs);
            }
        });

        // Track focus changes
        webviewPanel.onDidChangeViewState(() => {
            if (webviewPanel.active) {
                this.activeWebviewPanel = webviewPanel;
                this.activeDocumentUri = document.uri;
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            if (this.activeWebviewPanel === webviewPanel) {
                this.activeWebviewPanel = undefined;
                this.activeDocumentUri = undefined;
            }
        });

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(message => {
            this.handleWebviewMessage(message);
        });

        // Initial render
        updateWebview();
    }

    /**
     * Open a standalone preview panel (not tied to custom editor)
     */
    public async openPreviewPanel(document: vscode.TextDocument): Promise<void> {
        if (this.standalonePanel) {
            this.standalonePanel.reveal(vscode.ViewColumn.Beside);
        } else {
            this.standalonePanel = vscode.window.createWebviewPanel(
                'drawwave.waveDromPreview',
                'WaveDrom Preview',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                    ],
                }
            );

            this.standalonePanel.webview.html = this.getHtmlForWebview(this.standalonePanel.webview);

            this.standalonePanel.onDidDispose(() => {
                if (this.activeWebviewPanel === this.standalonePanel) {
                    this.activeWebviewPanel = undefined;
                    this.activeDocumentUri = undefined;
                }
                this.standalonePanel = undefined;
            });

            this.standalonePanel.webview.onDidReceiveMessage(message => {
                this.handleWebviewMessage(message);
            });
        }

        // Track as active
        this.activeWebviewPanel = this.standalonePanel;
        this.activeDocumentUri = document.uri;

        // Render and send
        const result = this.renderToSvg(document.getText());
        this.standalonePanel.webview.postMessage({
            type: 'render',
            svg: result.svg,
            error: result.error || null,
        });

        // Watch for changes
        const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString() && this.standalonePanel) {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                const debounceMs = vscode.workspace
                    .getConfiguration('drawwave.wavedrom')
                    .get<number>('debounceMs', 300);
                this.debounceTimer = setTimeout(() => {
                    if (!this.standalonePanel) { return; }
                    const r = this.renderToSvg(e.document.getText());
                    this.standalonePanel.webview.postMessage({
                        type: 'render',
                        svg: r.svg,
                        error: r.error || null,
                    });
                }, debounceMs);
            }
        });
        this.disposables.push(changeSubscription);
    }

    /**
     * Export the current preview as SVG
     */
    public async exportCurrentAsSvg(): Promise<void> {
        const panel = this.activeWebviewPanel;
        if (!panel) {
            vscode.window.showWarningMessage('No WaveDrom preview is open.');
            return;
        }
        panel.webview.postMessage({ type: 'export', format: 'svg' });
    }

    /**
     * Export the current preview as PNG
     */
    public async exportCurrentAsPng(): Promise<void> {
        const panel = this.activeWebviewPanel;
        if (!panel) {
            vscode.window.showWarningMessage('No WaveDrom preview is open.');
            return;
        }
        panel.webview.postMessage({ type: 'export', format: 'png' });
    }

    /**
     * Open the source JSON file in a text editor (side by side with the preview)
     */
    public async editSource(): Promise<void> {
        const uri = this.activeDocumentUri;
        if (!uri) {
            vscode.window.showWarningMessage('No WaveDrom preview is open.');
            return;
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: false,
        });
    }

    /**
     * Replace the content of the active WaveDrom document with new JSON
     * (used for applying templates when the custom editor is active and
     * there is no activeTextEditor)
     */
    public async applyContent(jsonStr: string): Promise<void> {
        const uri = this.activeDocumentUri;
        if (!uri) {
            vscode.window.showWarningMessage('No WaveDrom preview is open.');
            return;
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), jsonStr);
        await vscode.workspace.applyEdit(edit);
    }

    private async handleWebviewMessage(message: { type: string; format?: string; data?: string; message?: string }): Promise<void> {
        switch (message.type) {
            case 'export-result': {
                const format = message.format || 'svg';
                const data = message.data || '';
                const uri = await vscode.window.showSaveDialog({
                    filters: format === 'svg'
                        ? { 'SVG Image': ['svg'] }
                        : { 'PNG Image': ['png'] },
                    saveLabel: `Save as ${format.toUpperCase()}`,
                });
                if (uri) {
                    if (format === 'svg') {
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(data, 'utf-8'));
                    } else {
                        // PNG data comes as base64
                        const buffer = Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64');
                        await vscode.workspace.fs.writeFile(uri, buffer);
                    }
                    vscode.window.showInformationMessage(`Exported ${format.toUpperCase()} to ${vscode.workspace.asRelativePath(uri)}`);
                }
                break;
            }
            case 'error':
                vscode.window.showErrorMessage(`WaveDrom: ${message.message}`);
                break;
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = getNonce();

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css')
        );

        // Server-side rendering: SVG is pre-rendered in Node.js via wavedrom+onml
        // and sent to the WebView as an SVG string. No browser-side WaveDrom needed.
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
            img-src ${webview.cspSource} data: blob:;
            script-src 'nonce-${nonce}';
            style-src ${webview.cspSource} 'unsafe-inline';
            font-src ${webview.cspSource};">
    <link rel="stylesheet" href="${styleUri}">
    <title>WaveDrom Preview</title>
</head>
<body>
    <div id="toolbar">
        <span class="title">WaveDrom Preview</span>
        <button id="btn-svg" title="Export SVG">SVG</button>
        <button id="btn-png" title="Export PNG">PNG</button>
    </div>
    <div id="error-banner" style="display:none;"></div>
    <div id="container"></div>

    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            const container = document.getElementById('container');
            const errorBanner = document.getElementById('error-banner');

            // SVG is rendered server-side — just display it
            window.addEventListener('message', (event) => {
                const msg = event.data;
                switch (msg.type) {
                    case 'render':
                        if (msg.error) {
                            container.innerHTML = '';
                            errorBanner.textContent = 'Error: ' + msg.error;
                            errorBanner.style.display = 'block';
                        } else {
                            errorBanner.style.display = 'none';
                            container.innerHTML = msg.svg;
                        }
                        break;
                    case 'export':
                        exportDiagram(msg.format);
                        break;
                }
            });

            function exportDiagram(format) {
                const svgEl = container.querySelector('svg');
                if (!svgEl) return;

                if (format === 'svg') {
                    const svgData = new XMLSerializer().serializeToString(svgEl);
                    vscode.postMessage({ type: 'export-result', format: 'svg', data: svgData });
                } else if (format === 'png') {
                    const svgData = new XMLSerializer().serializeToString(svgEl);
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const img = new Image();
                    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                    const url = URL.createObjectURL(svgBlob);
                    img.onload = function() {
                        canvas.width = img.width * 2;
                        canvas.height = img.height * 2;
                        ctx.scale(2, 2);
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(url);
                        const pngData = canvas.toDataURL('image/png');
                        vscode.postMessage({ type: 'export-result', format: 'png', data: pngData });
                    };
                    img.src = url;
                }
            }

            document.getElementById('btn-svg').addEventListener('click', () => exportDiagram('svg'));
            document.getElementById('btn-png').addEventListener('click', () => exportDiagram('png'));
        })();
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.standalonePanel?.dispose();
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
