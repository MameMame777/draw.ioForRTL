/**
 * CodeMirror 6 editor extension for Obsidian Live Preview mode.
 *
 * Math-like behavior:
 *   - Cursor OUTSIDE a ```wavedrom block -> replaced with rendered SVG + zoom controls
 *   - Cursor INSIDE  a ```wavedrom block -> decoration removed, raw JSON text is shown
 *
 * This matches how Obsidian handles $$...$$  math blocks in Live Preview.
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

// --- App reference (set by main.ts) ---
import type { App } from 'obsidian';
let _app: App | null = null;
export function setObsidianApp(app: App): void { _app = app; }

// --- SVG render cache (avoid re-rendering identical source) ---
const svgCache = new Map<string, string>();

function renderCached(source: string): { svg?: string; error?: string } {
    if (svgCache.has(source)) return { svg: svgCache.get(source)! };
    const result = renderWaveDromToSvg(source);
    if (!result.error && result.svg) {
        if (svgCache.size > 80) {
            svgCache.delete(svgCache.keys().next().value!);
        }
        svgCache.set(source, result.svg);
    }
    return result;
}

// --- Parsed code block ---
interface WaveDromBlock {
    source: string;
    blockFrom: number;
    blockTo: number;
}

/** Scan document for ```wavedrom ... ``` blocks. */
function findWaveDromBlocks(doc: EditorState['doc']): WaveDromBlock[] {
    const blocks: WaveDromBlock[] = [];
    let inBlock = false;
    let source = '';
    let blockFrom = 0;

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (!inBlock) {
            if (/^```wavedrom\s*$/i.test(line.text)) {
                inBlock   = true;
                source    = '';
                blockFrom = line.from;
            }
        } else {
            if (/^```\s*$/.test(line.text)) {
                inBlock = false;
                if (source.trim()) {
                    blocks.push({ source, blockFrom, blockTo: line.to });
                }
            } else {
                source += (source ? '\n' : '') + line.text;
            }
        }
    }
    return blocks;
}

// --- Widget ---

class WaveDromWidget extends WidgetType {
    constructor(private readonly block: WaveDromBlock) { super(); }

    eq(other: WaveDromWidget): boolean {
        return this.block.source === other.block.source;
    }

    toDOM(view: EditorView): HTMLElement {
        const root = document.createElement('div');
        root.className = 'drawwave-live-preview';

        let origW = 0;
        let origH = 0;
        let zoom  = 1.0;

        // --- SVG scroll container ---
        const scroller = document.createElement('div');
        scroller.className = 'drawwave-live-preview-scroller';

        const svgWrap = document.createElement('div');
        svgWrap.className = 'drawwave-live-preview-svg';

        const trimmed = this.block.source.trim();
        if (trimmed) {
            const result = renderCached(trimmed);
            if (result.error) {
                svgWrap.innerHTML = '<span class="drawwave-live-preview-error">WaveDrom: ' + result.error + '</span>';
            } else if (result.svg) {
                svgWrap.innerHTML = result.svg;
                const svg = svgWrap.querySelector('svg');
                if (svg) {
                    origW = parseFloat(svg.getAttribute('width') ?? String(svg.viewBox.baseVal.width));
                    origH = parseFloat(svg.getAttribute('height') ?? String(svg.viewBox.baseVal.height));
                }
            }
        }

        scroller.appendChild(svgWrap);
        root.appendChild(scroller);

        // --- Zoom controls ---
        const controls = document.createElement('div');
        controls.className = 'drawwave-live-preview-controls';

        const applyZoom = (newZoom: number) => {
            zoom = Math.round(Math.min(4.0, Math.max(0.2, newZoom)) * 10) / 10;
            const svg = svgWrap.querySelector('svg');
            if (svg && origW && origH) {
                svg.setAttribute('width',  String(Math.round(origW * zoom)));
                svg.setAttribute('height', String(Math.round(origH * zoom)));
            }
            zoomLabel.textContent = Math.round(zoom * 100) + '%';
        };

        const mkBtn = (text: string, title: string, cb: () => void) => {
            const btn = document.createElement('button');
            btn.className = 'drawwave-zoom-btn';
            btn.textContent = text;
            btn.title = title;
            btn.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
            return btn;
        };

        const zoomOut   = mkBtn('−', 'Zoom out (-25%)', () => applyZoom(zoom - 0.25));
        const zoomLabel = mkBtn('100%', 'Reset zoom',    () => applyZoom(1.0));
        zoomLabel.className = 'drawwave-zoom-btn drawwave-zoom-reset';
        const zoomIn    = mkBtn('+', 'Zoom in (+25%)',  () => applyZoom(zoom + 0.25));

        const editHint = document.createElement('span');
        editHint.className = 'drawwave-live-preview-hint';
        editHint.textContent = 'click to edit';

        controls.append(zoomOut, zoomLabel, zoomIn, editHint);
        root.appendChild(controls);

        // --- Ctrl+Wheel to zoom, native scroll otherwise ---
        scroller.addEventListener('wheel', (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                applyZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
            }
        }, { passive: false });

        // --- Click body -> move cursor into block -> raw text shown ---
        root.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('button')) return;
            e.preventDefault();
            e.stopPropagation();
            view.dispatch({
                selection: { anchor: this.block.blockFrom + 1 },
                scrollIntoView: true,
            });
            view.focus();
        });

        return root;
    }

    ignoreEvent(e: Event): boolean {
        return (e.target as HTMLElement).closest?.('button') !== null;
    }
}

// --- Build decorations (cursor-aware) ---

function buildDecorations(state: EditorState): DecorationSet {
    try {
        if (!state.field(editorLivePreviewField)) return Decoration.none;
    } catch {
        return Decoration.none;
    }

    const blocks  = findWaveDromBlocks(state.doc);
    const builder = new RangeSetBuilder<Decoration>();
    const cursor  = state.selection.main;

    for (const block of blocks) {
        // If cursor is anywhere inside this block, skip -> show raw JSON
        if (cursor.from <= block.blockTo && cursor.to >= block.blockFrom) continue;

        builder.add(
            block.blockFrom,
            block.blockTo,
            Decoration.replace({ widget: new WaveDromWidget(block) }),
        );
    }

    return builder.finish();
}

// --- State field ---

const rebuildEffect = StateEffect.define<null>();

const wavedromDecoField = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state),
    update(decos, tr) {
        for (const e of tr.effects) {
            if (e.is(rebuildEffect)) return buildDecorations(tr.state);
        }
        // Rebuild immediately when cursor moves (may enter/leave a block)
        if (tr.selection) return buildDecorations(tr.state);
        // Map positions on doc change; debounce plugin triggers full re-render
        if (tr.docChanged) return decos.map(tr.changes);
        return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
});

// --- Debounce plugin: full re-render after typing stops ---

const wavedromDebouncePlugin = ViewPlugin.fromClass(
    class {
        private timer: ReturnType<typeof setTimeout> | null = null;

        update(update: ViewUpdate): void {
            if (update.docChanged) {
                if (this.timer) clearTimeout(this.timer);
                this.timer = setTimeout(() => {
                    update.view.dispatch({ effects: rebuildEffect.of(null) });
                }, 500);
            }
        }

        destroy(): void {
            if (this.timer) clearTimeout(this.timer);
        }
    }
);

export const wavedromLivePreviewPlugin = [wavedromDecoField, wavedromDebouncePlugin];
