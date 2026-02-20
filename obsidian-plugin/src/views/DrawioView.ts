import { TextFileView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import type DrawWavePlugin from '../main';

export const DRAWIO_VIEW_TYPE = 'drawwave-drawio-editor';

/**
 * DrawioView — embeds draw.io in an iframe for editing .drawio files.
 * Uses the bundled offline draw.io webapp from media/drawio/.
 * Communication uses the draw.io embed protocol (JSON postMessage).
 */
export class DrawioView extends TextFileView {
    private iframe: HTMLIFrameElement | null = null;
    private initialized = false;
    private pendingXml: string | null = null;
    private messageHandler: ((evt: MessageEvent) => void) | null = null;

    constructor(leaf: WorkspaceLeaf, private readonly plugin: DrawWavePlugin) {
        super(leaf);
    }

    getViewType(): string {
        return DRAWIO_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file ? this.file.basename : 'Draw.io Editor';
    }

    getIcon(): string {
        return 'pen-tool';
    }

    /**
     * Return the current XML data for saving.
     */
    getViewData(): string {
        return this.data;
    }

    /**
     * Called by Obsidian when the file is loaded or changed externally.
     */
    setViewData(data: string, clear: boolean): void {
        this.data = data;
        if (clear) {
            this.initialized = false;
        }
        if (this.initialized && this.iframe?.contentWindow) {
            this.postToDrawio({ action: 'load', xml: data, autosave: 1 });
        } else {
            this.pendingXml = data;
        }
    }

    clear(): void {
        this.data = '';
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('drawwave-drawio-view');

        // Loading indicator
        const loading = contentEl.createDiv({ cls: 'drawwave-drawio-loading' });
        loading.textContent = 'Loading draw.io...';

        // Wait for the HTTP server to be ready (may still be starting)
        try {
            await this.plugin.drawioServerReady;
        } catch (err) {
            console.error('DrawWave: Server startup failed:', err);
            loading.textContent = 'draw.io server failed to start. Check console for details.';
            return;
        }

        // Build the draw.io URL (custom wrapper that bypasses index.html)
        const drawioUrl = this.getDrawioUrl();
        if (!drawioUrl) {
            loading.textContent = 'draw.io server not available (port=0). Try reloading the plugin.';
            console.error('DrawWave: getDrawioUrl() returned null, port:', this.plugin.getDrawioServerPort());
            return;
        }

        // Create iframe — no sandbox to avoid blocking draw.io's eval/workers
        this.iframe = contentEl.createEl('iframe');

        // Set up message listener
        this.messageHandler = (evt: MessageEvent) => {
            this.handleDrawioMessage(evt);
        };
        window.addEventListener('message', this.messageHandler);

        // Pass settings via URL hash (parsed by drawio-obsidian.html)
        const theme = this.plugin.settings.theme;
        const lang = this.plugin.settings.drawioLanguage;
        const hashParams = encodeURIComponent(JSON.stringify({
            ui: theme,
            lang: lang,
        }));
        this.iframe.src = `${drawioUrl}#${hashParams}`;

        // Remove loading indicator when iframe loads (or show error after timeout)
        let loaded = false;
        this.iframe.addEventListener('load', () => {
            loaded = true;
            loading.textContent = 'Initializing draw.io editor...';
            // Give draw.io 10s to send 'init' message, otherwise show hint
            setTimeout(() => {
                if (!this.initialized) {
                    loading.textContent = 'draw.io is taking long to initialize. Check the console (Ctrl+Shift+I) for errors.';
                }
            }, 10000);
        });
        this.iframe.addEventListener('error', () => {
            loading.textContent = 'Failed to load draw.io iframe.';
        });
        // Failsafe: if iframe doesn't load at all within 8s
        setTimeout(() => {
            if (!loaded) {
                loading.textContent = 'draw.io iframe did not load. Server may be unreachable.';
                console.error('DrawWave: iframe load timeout, src:', this.iframe?.src);
            }
        }, 8000);
    }

    async onClose(): Promise<void> {
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
            this.messageHandler = null;
        }
        this.iframe = null;
        this.initialized = false;
    }

    /**
     * Get the URL to the draw.io wrapper HTML via the localhost HTTP server.
     * The server serves the entire plugin directory, so paths resolve correctly.
     */
    private getDrawioUrl(): string | null {
        const port = this.plugin.getDrawioServerPort();
        if (!port) {
            console.error('DrawWave: draw.io server not running');
            return null;
        }
        // The server root is the plugin directory.
        // drawio-obsidian.html lives inside drawio/ subdirectory.
        return `http://127.0.0.1:${port}/drawio/drawio-obsidian.html`;
    }

    /**
     * Handle messages from the draw.io iframe.
     */
    private handleDrawioMessage(evt: MessageEvent): void {
        // Only handle messages from our iframe
        // In Obsidian/Electron, evt.source may not match contentWindow exactly
        // when the iframe loads cross-origin content (http:// vs app://)
        // So we relax the check: just verify we have an iframe
        if (!this.iframe) { return; }

        let msg: Record<string, unknown>;
        try {
            msg = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
        } catch {
            return;
        }

        // Skip if not a draw.io event message
        if (!msg.event) { return; }

        switch (msg.event) {
            case 'init':
                this.initialized = true;
                // Remove loading indicator
                this.contentEl.querySelector('.drawwave-drawio-loading')?.remove();
                // Send initial XML
                if (this.pendingXml !== null) {
                    this.postToDrawio({ action: 'load', xml: this.pendingXml, autosave: 1 });
                    this.pendingXml = null;
                } else if (this.data) {
                    this.postToDrawio({ action: 'load', xml: this.data, autosave: 1 });
                }
                break;

            case 'autosave':
            case 'save': {
                const xml = msg.xml as string;
                if (xml && xml !== this.data) {
                    this.data = xml;
                    this.requestSave();
                }
                if (msg.event === 'save') {
                    this.postToDrawio({ action: 'status', message: 'Saved', modified: false });
                }
                break;
            }

            case 'export':
                // Handle export requests if needed
                break;

            case 'configure':
                this.sendConfiguration();
                break;
        }
    }

    /**
     * Send configuration to draw.io (theme, libraries, etc.)
     */
    private sendConfiguration(): void {
        const libraryData = this.plugin.getLibraryData();
        const wavedromTemplates = libraryData.filter((entry: { title?: string }) =>
            entry.title && entry.title.indexOf('Truth Table') === -1
        );
        const truthTableTemplates = libraryData.filter((entry: { title?: string }) =>
            entry.title && entry.title.indexOf('Truth Table') !== -1
        );

        this.postToDrawio({
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
                                    data: wavedromTemplates,
                                }],
                            },
                            {
                                id: 'drawwave-truthtable',
                                title: { main: 'Truth Tables' },
                                desc: { main: 'Logic gate truth table shapes' },
                                libs: [{
                                    title: { main: 'Truth Tables' },
                                    tags: 'truth table logic gate and or xor',
                                    data: truthTableTemplates,
                                }],
                            },
                        ],
                    },
                ],
            },
        });
    }

    /**
     * Post a message to the draw.io iframe.
     */
    private postToDrawio(msg: Record<string, unknown>): void {
        if (this.iframe?.contentWindow) {
            this.iframe.contentWindow.postMessage(JSON.stringify(msg), '*');
        } else {
            console.error('DrawWave: iframe or contentWindow not available');
        }
    }

    /**
     * Insert WaveDrom JSON into the draw.io diagram.
     */
    public insertWaveDrom(json: string): void {
        if (!this.initialized) {
            new Notice('Draw.io editor is not ready yet.');
            return;
        }
        const placeholderStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;' +
            'fontSize=11;fontFamily=Arial;fontStyle=1;verticalAlign=middle;';
        const cellXml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
            '<object label="WaveDrom" wavedromJson="' + this.escapeHtml(json) + '" id="2">' +
            '<mxCell style="' + this.escapeHtml(placeholderStyle) + '" vertex="1" parent="1">' +
            '<mxGeometry x="100" y="100" width="160" height="60" as="geometry"/>' +
            '</mxCell></object></root></mxGraphModel>';
        this.postToDrawio({ action: 'merge', xml: cellXml });
    }

    private escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
