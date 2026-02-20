/**
 * CodeMirror 6 editor extension for Obsidian Live Preview mode.
 *
 * Replaces ```wavedrom code blocks with rendered SVG previews.
 * Clicking a preview opens a modal dialog for editing the WaveDrom JSON.
 *
 * Uses a StateField (block decorations require StateField, not ViewPlugin).
 */

import {
    EditorView,
    Decoration,
    DecorationSet,
    WidgetType,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view';
import { EditorState, StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { editorLivePreviewField } from 'obsidian';
import { renderWaveDromToSvg } from '../wavedrom-renderer';
import { WaveDromEditModal } from './WaveDromEditModal';

// ─── Module-level app reference (set by main.ts) ───
import type { App } from 'obsidian';
let obsidianApp: App | null = null;

/** Called from main.ts to inject the Obsidian App reference. */
export function setObsidianApp(app: App): void {
    obsidianApp = app;
}

// ─── Parsed code block info ───
interface WaveDromBlock {
    /** Content between the fences. */
    source: string;
    /** Document offset: start of ```wavedrom line. */
    blockFrom: number;
    /** Document offset: end of ``` closing line. */
    blockTo: number;
    /** Document offset: start of first content line. */
    contentFrom: number;
    /** Document offset: end of last content line. */
    contentTo: number;
}

/** Scan the document for ```wavedrom blocks. */
function findWaveDromBlocks(doc: EditorState['doc']): WaveDromBlock[] {
    const blocks: WaveDromBlock[] = [];
    let inBlock = false;
    let source = '';
    let blockFrom = 0;
    let contentFrom = 0;
    let contentTo = 0;

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);

        if (!inBlock) {
            if (/^```wavedrom\s*$/i.test(line.text)) {
                inBlock = true;
                source = '';
                blockFrom = line.from;
                contentFrom = -1;
                contentTo = -1;
            }
        } else {
            if (/^```\s*$/.test(line.text)) {
                inBlock = false;
                if (source.trim()) {
                    blocks.push({
                        source,
                        blockFrom,
                        blockTo: line.to,
                        contentFrom,
                        contentTo,
                    });
                }
            } else {
                if (contentFrom === -1) contentFrom = line.from;
                contentTo = line.to;
                source += (source ? '\n' : '') + line.text;
            }
        }
    }
    return blocks;
}

// ─── Widget ───

class WaveDromPreviewWidget extends WidgetType {
    constructor(
        private readonly block: WaveDromBlock,
    ) {
        super();
    }

    eq(other: WaveDromPreviewWidget): boolean {
        return this.block.source === other.block.source;
    }

    /** Render SVG preview with click-to-edit overlay. */
    toDOM(view: EditorView): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'drawwave-live-preview';

        // Render SVG
        const trimmed = this.block.source.trim();
        if (trimmed) {
            try {
                const result = renderWaveDromToSvg(trimmed);
                if (result.error) {
                    const e = document.createElement('div');
                    e.className = 'drawwave-live-preview-error';
                    e.textContent = 'WaveDrom: ' + result.error;
                    wrapper.appendChild(e);
                } else if (result.svg) {
                    wrapper.innerHTML = result.svg;
                }
            } catch (err) {
                const e = document.createElement('div');
                e.className = 'drawwave-live-preview-error';
                e.textContent = String(err);
                wrapper.appendChild(e);
            }
        }

        // Edit overlay (shown on hover)
        const overlay = document.createElement('div');
        overlay.className = 'drawwave-live-preview-overlay';
        overlay.textContent = '✏️ Click to edit';
        wrapper.appendChild(overlay);

        // Click → open modal editor
        wrapper.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!obsidianApp) return;

            const block = this.block;
            new WaveDromEditModal(obsidianApp, block.source, (newSource) => {
                // Replace content between fences in the CM document
                view.dispatch({
                    changes: {
                        from: block.contentFrom,
                        to: block.contentTo,
                        insert: newSource,
                    },
                });
            }).open();
        });

        return wrapper;
    }

    get estimatedHeight(): number {
        return 120;
    }

    ignoreEvent(): boolean {
        // We handle clicks ourselves
        return false;
    }
}

// ─── Decorations ───

function buildDecorations(state: EditorState): DecorationSet {
    // Only activate in Live Preview mode
    try {
        if (!state.field(editorLivePreviewField)) {
            return Decoration.none;
        }
    } catch {
        // Field not available — skip
        return Decoration.none;
    }

    const blocks = findWaveDromBlocks(state.doc);
    const builder = new RangeSetBuilder<Decoration>();

    for (const block of blocks) {
        const deco = Decoration.replace({
            widget: new WaveDromPreviewWidget(block),
        });
        builder.add(block.blockFrom, block.blockTo, deco);
    }

    return builder.finish();
}

// ─── State management ───

const rebuildEffect = StateEffect.define<null>();

const wavedromDecoField = StateField.define<DecorationSet>({
    create(state) {
        return buildDecorations(state);
    },
    update(decos, tr) {
        for (const e of tr.effects) {
            if (e.is(rebuildEffect)) {
                return buildDecorations(tr.state);
            }
        }
        if (tr.docChanged) {
            // Map stale positions; real rebuild comes after debounce
            return decos.map(tr.changes);
        }
        return decos;
    },
    provide(field) {
        return EditorView.decorations.from(field);
    },
});

const wavedromDebouncePlugin = ViewPlugin.fromClass(
    class {
        private timer: ReturnType<typeof setTimeout> | null = null;

        update(update: ViewUpdate): void {
            if (update.docChanged) {
                if (this.timer) clearTimeout(this.timer);
                this.timer = setTimeout(() => {
                    update.view.dispatch({ effects: rebuildEffect.of(null) });
                }, 400);
            }
        }

        destroy(): void {
            if (this.timer) clearTimeout(this.timer);
        }
    }
);

// ─── Export ───

export const wavedromLivePreviewPlugin = [wavedromDecoField, wavedromDebouncePlugin];
