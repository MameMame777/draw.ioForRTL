import { TextFileView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { renderWaveDromToSvg } from '../wavedrom-renderer';
import type { Timeout } from '../types/types';
import type DrawWavePlugin from '../main';

export const WAVEDROM_VIEW_TYPE = 'drawwave-wavedrom-preview';

/**
 * WaveDrom Live-Editor View — split pane with JSON editor (left) + SVG preview (right).
 * Extends TextFileView so Obsidian treats it as a file editor with auto-save.
 * The preview updates in real-time as the user types.
 */
export class WaveDromView extends TextFileView {
    private editorEl: HTMLTextAreaElement | null = null;
    private previewContainer: HTMLElement | null = null;
    private errorBanner: HTMLElement | null = null;
    private debounceTimer: Timeout | undefined;
    private isSettingData = false;

    constructor(leaf: WorkspaceLeaf, private readonly plugin: DrawWavePlugin) {
        super(leaf);
    }

    getViewType(): string {
        return WAVEDROM_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file ? this.file.basename : 'WaveDrom Editor';
    }

    getIcon(): string {
        return 'activity';
    }

    /**
     * Allow Obsidian to open .json files in this view (for .wavedrom.json).
     */
    canAcceptExtension(extension: string): boolean {
        return extension === 'json';
    }

    // ----- TextFileView contract -----

    /**
     * Return the current editor text for saving.
     */
    getViewData(): string {
        return this.editorEl?.value ?? this.data;
    }

    /**
     * Called by Obsidian when the file is loaded or changed externally.
     */
    setViewData(data: string, clear: boolean): void {
        this.isSettingData = true;
        this.data = data;
        if (this.editorEl) {
            // Preserve cursor position unless it's a full reload
            if (clear) {
                this.editorEl.value = data;
            } else {
                const start = this.editorEl.selectionStart;
                const end = this.editorEl.selectionEnd;
                this.editorEl.value = data;
                this.editorEl.selectionStart = start;
                this.editorEl.selectionEnd = end;
            }
        }
        this.renderPreview();
        this.isSettingData = false;
    }

    clear(): void {
        this.data = '';
        if (this.editorEl) {
            this.editorEl.value = '';
        }
        if (this.previewContainer) {
            this.previewContainer.innerHTML = '';
        }
    }

    // ----- Lifecycle -----

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('drawwave-wavedrom-view');

        // Toolbar
        const toolbar = contentEl.createDiv({ cls: 'toolbar' });
        toolbar.createSpan({ cls: 'title', text: 'WaveDrom Live Editor' });

        const svgBtn = toolbar.createEl('button', { text: 'SVG' });
        svgBtn.setAttribute('title', 'Export SVG');
        svgBtn.addEventListener('click', () => this.exportSvg());

        const pngBtn = toolbar.createEl('button', { text: 'PNG' });
        pngBtn.setAttribute('title', 'Export PNG');
        pngBtn.addEventListener('click', () => this.exportPng());

        // Error banner
        this.errorBanner = contentEl.createDiv({ cls: 'error-banner' });
        this.errorBanner.style.display = 'none';

        // Split pane container
        const splitPane = contentEl.createDiv({ cls: 'split-pane' });

        // Left: JSON editor
        const editorPane = splitPane.createDiv({ cls: 'editor-pane' });
        this.editorEl = editorPane.createEl('textarea', { cls: 'wavedrom-editor' });
        this.editorEl.setAttribute('spellcheck', 'false');
        this.editorEl.setAttribute('wrap', 'off');
        this.editorEl.placeholder = '{ "signal": [ ... ] }';

        // Handle real-time input
        this.editorEl.addEventListener('input', () => {
            if (this.isSettingData) { return; }
            this.data = this.editorEl!.value;
            this.requestSave();
            this.debouncedRender();
        });

        // Tab key inserts spaces instead of changing focus
        this.editorEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Tab') {
                evt.preventDefault();
                const ta = this.editorEl!;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
                ta.selectionStart = ta.selectionEnd = start + 2;
                // Trigger input event for save/render
                ta.dispatchEvent(new Event('input'));
            }
        });

        // Right: SVG preview
        this.previewContainer = splitPane.createDiv({ cls: 'preview-pane' });

        // Splitter handle (visual draggable divider)
        this.setupSplitter(splitPane, editorPane);
    }

    async onClose(): Promise<void> {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
    }

    // ----- Rendering -----

    private debouncedRender(): void {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
        this.debounceTimer = setTimeout(() => this.renderPreview(), this.plugin.settings.debounceMs);
    }

    private renderPreview(): void {
        if (!this.previewContainer || !this.errorBanner) { return; }

        const source = this.editorEl?.value ?? this.data;
        const trimmed = source.trim();

        if (!trimmed) {
            this.previewContainer.innerHTML = '<div class="drawwave-wavedrom-placeholder">Enter WaveDrom JSON to see preview</div>';
            this.errorBanner.style.display = 'none';
            return;
        }

        const result = renderWaveDromToSvg(trimmed);

        if (result.error) {
            // Keep previous SVG visible and show error banner
            this.errorBanner.textContent = 'JSON Error: ' + result.error;
            this.errorBanner.style.display = 'block';
        } else {
            this.errorBanner.style.display = 'none';
            this.previewContainer.innerHTML = result.svg;
        }
    }

    // ----- Splitter drag -----

    private setupSplitter(splitPane: HTMLElement, editorPane: HTMLElement): void {
        const splitter = splitPane.createDiv({ cls: 'splitter-handle' });

        let startX = 0;
        let startWidth = 0;

        const onMouseMove = (e: MouseEvent) => {
            const newWidth = startWidth + (e.clientX - startX);
            const minW = 150;
            const maxW = splitPane.clientWidth - 150;
            const clamped = Math.max(minW, Math.min(maxW, newWidth));
            editorPane.style.width = clamped + 'px';
            editorPane.style.flex = 'none';
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            splitPane.classList.remove('is-dragging');
        };

        splitter.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = editorPane.offsetWidth;
            splitPane.classList.add('is-dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    // ----- Public API (for commands) -----

    /**
     * Set the file to display (called from main.ts openWaveDromPreview).
     */
    async setFile(file: TFile): Promise<void> {
        // For TextFileView, we can load via the leaf
        this.file = file;
        (this.leaf as WorkspaceLeaf).updateHeader();
        const content = await this.app.vault.read(file);
        this.setViewData(content, true);
    }

    async exportSvg(): Promise<void> {
        if (!this.previewContainer || !this.file) { return; }
        const svgEl = this.previewContainer.querySelector('svg');
        if (!svgEl) { return; }

        const svgData = new XMLSerializer().serializeToString(svgEl);
        const exportPath = this.file.path.replace(/\.wavedrom\.json$/, '.svg');
        try {
            const existing = this.app.vault.getAbstractFileByPath(exportPath);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, svgData);
            } else {
                await this.app.vault.create(exportPath, svgData);
            }
            new Notice(`Exported SVG: ${exportPath}`);
        } catch (err) {
            new Notice('Export failed: ' + String(err));
        }
    }

    async exportPng(): Promise<void> {
        if (!this.previewContainer || !this.file) { return; }
        const svgEl = this.previewContainer.querySelector('svg');
        if (!svgEl) { return; }

        const svgData = new XMLSerializer().serializeToString(svgEl);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }

        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        return new Promise<void>((resolve) => {
            img.onload = async () => {
                canvas.width = img.width * 2;
                canvas.height = img.height * 2;
                ctx.scale(2, 2);
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);

                const pngDataUrl = canvas.toDataURL('image/png');
                const base64 = pngDataUrl.replace(/^data:image\/png;base64,/, '');
                const buffer = Buffer.from(base64, 'base64');

                const exportPath = this.file!.path.replace(/\.wavedrom\.json$/, '.png');
                try {
                    const existing = this.app.vault.getAbstractFileByPath(exportPath);
                    if (existing instanceof TFile) {
                        await this.app.vault.modifyBinary(existing, buffer);
                    } else {
                        await this.app.vault.createBinary(exportPath, buffer);
                    }
                    new Notice(`Exported PNG: ${exportPath}`);
                } catch (err) {
                    new Notice('Export failed: ' + String(err));
                }
                resolve();
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                new Notice('PNG export failed: SVG rendering error');
                resolve();
            };
            img.src = url;
        });
    }
}
