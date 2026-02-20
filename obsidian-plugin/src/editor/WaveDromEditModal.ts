/**
 * Modal dialog for editing WaveDrom JSON with a real-time SVG preview.
 * Opens when the user clicks on a WaveDrom preview in Live Preview mode.
 */

import { App, Modal } from 'obsidian';
import { renderWaveDromToSvg } from '../wavedrom-renderer';

export class WaveDromEditModal extends Modal {
    private readonly source: string;
    private readonly onSave: (newSource: string) => void;
    private editor!: HTMLTextAreaElement;
    private preview!: HTMLDivElement;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(app: App, source: string, onSave: (newSource: string) => void) {
        super(app);
        this.source = source;
        this.onSave = onSave;
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        // Make the modal wide enough for split layout
        modalEl.addClass('drawwave-edit-modal');

        // Header
        contentEl.createEl('div', {
            cls: 'drawwave-edit-header',
            text: 'Edit WaveDrom',
        });

        // Split container: editor (left) + preview (right)
        const container = contentEl.createDiv({ cls: 'drawwave-edit-container' });

        // Editor pane
        const editorPane = container.createDiv({ cls: 'drawwave-edit-editor-pane' });
        this.editor = editorPane.createEl('textarea', {
            cls: 'drawwave-edit-textarea',
        });
        this.editor.value = this.source;
        this.editor.spellcheck = false;

        // Preview pane
        this.preview = container.createDiv({ cls: 'drawwave-edit-preview-pane' });

        // Button bar
        const buttons = contentEl.createDiv({ cls: 'drawwave-edit-buttons' });

        const saveBtn = buttons.createEl('button', {
            text: 'Save',
            cls: 'mod-cta',
        });
        saveBtn.addEventListener('click', () => {
            this.onSave(this.editor.value);
            this.close();
        });

        const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        // Live preview on input
        this.editor.addEventListener('input', () => this.debouncedRender());

        // Tab key inserts spaces
        this.editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.editor.selectionStart;
                const end = this.editor.selectionEnd;
                this.editor.value =
                    this.editor.value.substring(0, start) +
                    '  ' +
                    this.editor.value.substring(end);
                this.editor.selectionStart = this.editor.selectionEnd = start + 2;
                this.debouncedRender();
            }
        });

        // Ctrl+S to save & close
        this.editor.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.onSave(this.editor.value);
                this.close();
            }
        });

        // Ctrl+Enter to save & close
        this.editor.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.onSave(this.editor.value);
                this.close();
            }
        });

        // Initial render
        this.renderPreview();

        // Focus the editor after a tick
        setTimeout(() => this.editor.focus(), 50);
    }

    private debouncedRender(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.renderPreview(), 300);
    }

    private renderPreview(): void {
        const source = this.editor.value.trim();
        if (!source) {
            this.preview.empty();
            this.preview.createEl('div', {
                cls: 'drawwave-edit-placeholder',
                text: 'Enter WaveDrom JSON to see preview',
            });
            return;
        }
        try {
            const result = renderWaveDromToSvg(source);
            if (result.error) {
                this.preview.innerHTML = `<div class="drawwave-live-preview-error">WaveDrom: ${result.error}</div>`;
            } else if (result.svg) {
                this.preview.innerHTML = result.svg;
            }
        } catch (err) {
            this.preview.innerHTML = `<div class="drawwave-live-preview-error">Error: ${err}</div>`;
        }
    }

    onClose(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.contentEl.empty();
    }
}
