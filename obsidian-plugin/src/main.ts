import { Plugin, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { renderWaveDromToSvg } from './wavedrom-renderer';
import { WaveDromView, WAVEDROM_VIEW_TYPE } from './views/WaveDromView';
import { DrawioView, DRAWIO_VIEW_TYPE } from './views/DrawioView';
import { DrawWaveSettingTab } from './settings/DrawWaveSettingTab';
import { TemplatePicker } from './modals/TemplatePicker';
import { DrawioServer } from './server/DrawioServer';
import { wavedromLivePreviewPlugin, setObsidianApp } from './editor/wavedrom-live-preview';
import type { DrawWaveSettings } from './types/types';
import { DEFAULT_SETTINGS } from './types/types';

export default class DrawWavePlugin extends Plugin {
    settings: DrawWaveSettings = { ...DEFAULT_SETTINGS };

    /** Cached draw.io library data (parsed from XML) */
    private libraryData: unknown[] | null = null;

    /** Local HTTP server for serving draw.io assets */
    private drawioServer: DrawioServer | null = null;

    /** Promise that resolves when the draw.io server is ready. */
    drawioServerReady: Promise<void> = Promise.resolve();

    async onload(): Promise<void> {
        await this.loadSettings();

        // ===== Register views =====
        try {
            // WaveDrom .wavedrom.json preview
            this.registerView(
                WAVEDROM_VIEW_TYPE,
                (leaf) => new WaveDromView(leaf, this)
            );

            // Draw.io .drawio editor
            this.registerView(
                DRAWIO_VIEW_TYPE,
                (leaf) => new DrawioView(leaf, this)
            );

            // ===== Register file extensions =====
            // .drawio and .dio files open in DrawioView
            this.registerExtensions(['drawio', 'dio'], DRAWIO_VIEW_TYPE);
        } catch (err) {
            console.error('DrawWave: Failed to register views/extensions:', err);
        }

        // ===== WaveDrom code block processor (Reading view) =====
        try {
            this.registerMarkdownCodeBlockProcessor('wavedrom', (source, el, _ctx) => {
                this.processWaveDromCodeBlock(source, el);
            });
        } catch (err) {
            console.error('DrawWave: Failed to register code block processor:', err);
        }

        // ===== WaveDrom Live Preview (Editing view) =====
        try {
            setObsidianApp(this.app);
            this.registerEditorExtension(wavedromLivePreviewPlugin);
        } catch (err) {
            console.error('DrawWave: Failed to register live preview:', err);
        }

        // ===== Register commands =====
        this.registerCommands();

        // ===== Settings tab =====
        this.addSettingTab(new DrawWaveSettingTab(this.app, this));

        // ===== Handle .wavedrom.json file opens =====
        // Can't use registerExtensions for .wavedrom.json (extension is .json
        // which would hijack all JSON files), so we intercept file-open events.
        this.registerEvent(
            this.app.workspace.on('file-open', async (file) => {
                if (file && file.extension === 'json' && file.path.endsWith('.wavedrom.json')) {
                    const leaf = this.app.workspace.activeLeaf;
                    if (leaf && leaf.view.getViewType() !== WAVEDROM_VIEW_TYPE) {
                        await leaf.setViewState({
                            type: WAVEDROM_VIEW_TYPE,
                            active: true,
                        });
                        // TextFileView needs the file opened explicitly after view switch
                        const view = leaf.view;
                        if (view instanceof WaveDromView) {
                            await view.setFile(file);
                        }
                    }
                }
            })
        );

        // ===== Start draw.io file server =====
        this.drawioServerReady = this.startDrawioServer();

        // ===== Ribbon icon =====
        this.addRibbonIcon('activity', 'DrawWave: New WaveDrom', () => {
            this.createNewWaveDromFile();
        });
    }

    onunload(): void {
        // Stop the draw.io server
        if (this.drawioServer) {
            this.drawioServer.stop();
            this.drawioServer = null;
        }
    }

    /** Get the port of the running draw.io server (0 if not started). */
    getDrawioServerPort(): number {
        return this.drawioServer?.getPort() ?? 0;
    }

    /** Start the local HTTP server for draw.io assets. */
    private async startDrawioServer(): Promise<void> {
        try {
            const pluginDir = this.manifest.dir;
            if (!pluginDir) {
                console.error('DrawWave: No plugin directory found');
                return;
            }

            const basePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
            if (!basePath) {
                console.error('DrawWave: Could not resolve vault base path');
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodePath = require('path') as typeof import('path');
            const rootDir = nodePath.join(basePath, pluginDir);

            this.drawioServer = new DrawioServer();
            const port = await this.drawioServer.start(rootDir);
            void port;
        } catch (err) {
            console.error('DrawWave: Failed to start draw.io server:', err);
        }
    }

    // ===================================================================
    // Settings
    // ===================================================================

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    // ===================================================================
    // WaveDrom Code Block Processor
    // ===================================================================

    private processWaveDromCodeBlock(source: string, el: HTMLElement): void {
        const container = el.createDiv({ cls: 'drawwave-wavedrom-block' });

        const trimmed = source.trim();
        if (!trimmed) {
            container.createDiv({ cls: 'drawwave-wavedrom-error', text: 'Empty WaveDrom JSON' });
            return;
        }

        try {
            const result = renderWaveDromToSvg(trimmed);

            if (result.error) {
                container.createDiv({ cls: 'drawwave-wavedrom-error', text: 'Error: ' + result.error });
                return;
            }

            if (!result.svg) {
                container.createDiv({ cls: 'drawwave-wavedrom-error', text: 'Render returned empty SVG' });
                return;
            }

            // SVG content area (horizontally scrollable)
            const svgWrapper = container.createDiv({ cls: 'drawwave-wavedrom-svg-wrapper' });
            svgWrapper.innerHTML = result.svg;

            // Store original dimensions for zoom
            const svg = svgWrapper.querySelector('svg');
            let origW = 0;
            let origH = 0;
            let zoom = 1.0;
            if (svg) {
                origW = parseFloat(svg.getAttribute('width') ?? String(svg.viewBox.baseVal.width));
                origH = parseFloat(svg.getAttribute('height') ?? String(svg.viewBox.baseVal.height));
            }

            // Zoom controls bar
            const controls = container.createDiv({ cls: 'drawwave-wavedrom-controls' });

            const applyZoom = (newZoom: number) => {
                zoom = Math.round(Math.min(3.0, Math.max(0.2, newZoom)) * 10) / 10;
                if (svg && origW && origH) {
                    svg.setAttribute('width', String(origW * zoom));
                    svg.setAttribute('height', String(origH * zoom));
                }
                zoomLabel.textContent = Math.round(zoom * 100) + '%';
            };

            const zoomOut = controls.createEl('button', { cls: 'drawwave-zoom-btn', text: '−' });
            zoomOut.title = 'Zoom out';
            zoomOut.addEventListener('click', () => applyZoom(zoom - 0.25));

            const zoomLabel = controls.createEl('button', { cls: 'drawwave-zoom-btn drawwave-zoom-reset', text: '100%' });
            zoomLabel.title = 'Reset zoom';
            zoomLabel.addEventListener('click', () => applyZoom(1.0));

            const zoomIn = controls.createEl('button', { cls: 'drawwave-zoom-btn', text: '+' });
            zoomIn.title = 'Zoom in';
            zoomIn.addEventListener('click', () => applyZoom(zoom + 0.25));

            // Ctrl+Wheel zoom on the SVG area
            svgWrapper.addEventListener('wheel', (e: WheelEvent) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
                }
            }, { passive: false });

        } catch (err) {
            console.error('DrawWave: Code block render exception:', err);
            container.createDiv({ cls: 'drawwave-wavedrom-error', text: 'Render exception: ' + String(err) });
        }
    }

    // ===================================================================
    // Commands
    // ===================================================================

    private registerCommands(): void {
        // New .drawio file
        this.addCommand({
            id: 'new-drawio',
            name: 'New draw.io diagram',
            callback: () => this.createNewDrawioFile(),
        });

        // New .wavedrom.json file
        this.addCommand({
            id: 'new-wavedrom',
            name: 'New WaveDrom file',
            callback: () => this.createNewWaveDromFile(),
        });

        // Insert WaveDrom template
        this.addCommand({
            id: 'insert-template',
            name: 'Insert WaveDrom template',
            editorCallback: (editor) => {
                new TemplatePicker(this.app, this, (json) => {
                    editor.replaceSelection('```wavedrom\n' + json + '\n```\n');
                }).open();
            },
        });

        // Export current WaveDrom preview as SVG
        this.addCommand({
            id: 'export-svg',
            name: 'Export WaveDrom as SVG',
            checkCallback: (checking) => {
                const view = this.getActiveWaveDromView();
                if (checking) { return !!view; }
                if (view) { (view as WaveDromView & { exportSvg?: () => void }).exportSvg?.(); }
            },
        });

        // Export current WaveDrom preview as PNG
        this.addCommand({
            id: 'export-png',
            name: 'Export WaveDrom as PNG',
            checkCallback: (checking) => {
                const view = this.getActiveWaveDromView();
                if (checking) { return !!view; }
                if (view) { (view as WaveDromView & { exportPng?: () => void }).exportPng?.(); }
            },
        });
    }

    private getActiveWaveDromView(): WaveDromView | null {
        const leaf = this.app.workspace.activeLeaf;
        if (leaf?.view instanceof WaveDromView) {
            return leaf.view;
        }
        return null;
    }

    // ===================================================================
    // File Creation
    // ===================================================================

    private async createNewDrawioFile(): Promise<void> {
        const defaultXml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
        const filePath = await this.getNewFilePath('Untitled', 'drawio');
        try {
            const file = await this.app.vault.create(filePath, defaultXml);
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
        } catch (err) {
            new Notice('Failed to create draw.io file: ' + String(err));
        }
    }

    private async createNewWaveDromFile(): Promise<void> {
        const defaultJson = JSON.stringify({
            signal: [
                { name: 'clk', wave: 'p......' },
                { name: 'data', wave: 'x.=.=.x', data: ['D0', 'D1'] },
                { name: 'valid', wave: '0.1..0.' },
            ],
        }, null, 2);
        const filePath = await this.getNewFilePath('Untitled', 'wavedrom.json');
        try {
            const file = await this.app.vault.create(filePath, defaultJson);
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(file);
        } catch (err) {
            new Notice('Failed to create WaveDrom file: ' + String(err));
        }
    }

    private async getNewFilePath(baseName: string, ext: string): Promise<string> {
        let name = `${baseName}.${ext}`;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(name)) {
            name = `${baseName} ${counter}.${ext}`;
            counter++;
        }
        return name;
    }

    // ===================================================================
    // Draw.io Library Data
    // ===================================================================

    /**
     * Get the draw.io shape library data (parsed JSON array from mxlibrary XML).
     */
    public getLibraryData(): unknown[] {
        if (this.libraryData) { return this.libraryData; }

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodeFs = require('fs') as typeof import('fs');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodePath = require('path') as typeof import('path');

            const pluginDir = this.manifest.dir;
            if (!pluginDir) { return []; }

            const basePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
            if (!basePath) { return []; }

            const libraryPath = nodePath.join(basePath, pluginDir, 'drawio-wavedrom-library.xml');
            if (!nodeFs.existsSync(libraryPath)) {
                console.warn('DrawWave: Library not found at', libraryPath);
                return [];
            }

            const libraryXml = nodeFs.readFileSync(libraryPath, 'utf-8');
            const match = libraryXml.match(/<mxlibrary>([\s\S]*?)<\/mxlibrary>/);
            if (match) {
                this.libraryData = JSON.parse(match[1]);
                return this.libraryData!;
            }
        } catch (err) {
            console.error('DrawWave: Failed to load library data:', err);
        }
        return [];
    }
}
