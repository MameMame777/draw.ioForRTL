/**
 * CodeMirror 6 editor extension for Obsidian Live Preview mode.
 *
 * Behavior:
 *   - Cursor OUTSIDE block: Decoration.replace -> only SVG shown (math-like)
 *   - Cursor INSIDE  block: raw JSON editable + Decoration.widget appended
 *                           AFTER the closing fence -> live SVG preview below
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

// --- SVG render cache (LRU-80) ---
const svgCache = new Map<string, string>();

function renderCached(source: string): { svg?: string; error?: string } {
    if (svgCache.has(source)) return { svg: svgCache.get(source)! };
    const result = renderWaveDromToSvg(source);
    if (!result.error && result.svg) {
        if (svgCache.size >= 80) svgCache.delete(svgCache.keys().next().value!);
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

function findWaveDromBlocks(doc: EditorState['doc']): WaveDromBlock[] {
    const blocks: WaveDromBlock[] = [];
    let inBlock = false;
    let source = '';
    let blockFrom = 0;

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (!inBlock) {
            if (/^```wavedrom\s*$/i.test(line.text)) {
                inBlock = true; source = ''; blockFrom = line.from;
            }
        } else {
            if (/^```\s*$/.test(line.text)) {
                inBlock = false;
                if (source.trim()) blocks.push({ source, blockFrom, blockTo: line.to });
            } else {
                source += (source ? '\n' : '') + line.text;
            }
        }
    }
    return blocks;
}

// ================================================================
// Shared SVG panel builder
// ================================================================
function buildSvgPanel(
    source: string,
    cls: string,
    view?: EditorView,
    block?: WaveDromBlock,
): HTMLElement {
    const root = document.createElement('div');
    root.className = cls;

    let origW = 0, origH = 0, zoom = 1.0;

    const scroller = document.createElement('div');
    scroller.className = 'drawwave-live-preview-scroller';
    const svgWrap = document.createElement('div');
    svgWrap.className = 'drawwave-live-preview-svg';

    const trimmed = source.trim();
    if (trimmed) {
        const result = renderCached(trimmed);
        if (result.error) {
            svgWrap.innerHTML = '<span class="drawwave-live-preview-error">WaveDrom: ' + result.error + '</span>';
        } else if (result.svg) {
            svgWrap.innerHTML = result.svg;
            const svg = svgWrap.querySelector('svg');
            if (svg) {
                origW = parseFloat(svg.getAttribute('width')  ?? String(svg.viewBox.baseVal.width));
                origH = parseFloat(svg.getAttribute('height') ?? String(svg.viewBox.baseVal.height));
            }
        }
    }
    scroller.appendChild(svgWrap);
    root.appendChild(scroller);

    // Zoom controls
    const controls = document.createElement('div');
    controls.className = 'drawwave-live-preview-controls';

    const applyZoom = (nz: number) => {
        zoom = Math.round(Math.min(4.0, Math.max(0.2, nz)) * 10) / 10;
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
        btn.textContent = text; btn.title = title;
        btn.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
        return btn;
    };

    const zoomOut   = mkBtn('-', 'Zoom out (-25%)', () => applyZoom(zoom - 0.25));
    const zoomLabel = mkBtn('100%', 'Reset zoom',    () => applyZoom(1.0));
    zoomLabel.className = 'drawwave-zoom-btn drawwave-zoom-reset';
    const zoomIn    = mkBtn('+', 'Zoom in (+25%)',   () => applyZoom(zoom + 0.25));

    controls.append(zoomOut, zoomLabel, zoomIn);
    root.appendChild(controls);

    // Ctrl+Wheel zoom
    scroller.addEventListener('wheel', (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault(); e.stopPropagation();
            applyZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
        }
    }, { passive: false });

    // Replace-widget only: click -> move cursor inside block
    if (view && block) {
        root.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            e.preventDefault(); e.stopPropagation();
            view.dispatch({ selection: { anchor: block.blockFrom + 1 }, scrollIntoView: true });
            view.focus();
        });
    }

    return root;
}

// ================================================================
// Widget A: replace-mode (cursor outside) - entire block -> SVG
// ================================================================
class WaveDromReplaceWidget extends WidgetType {
    constructor(private readonly block: WaveDromBlock) { super(); }
    eq(o: WaveDromReplaceWidget): boolean { return this.block.source === o.block.source; }

    toDOM(view: EditorView): HTMLElement {
        const el = buildSvgPanel(this.block.source, 'drawwave-live-preview', view, this.block);
        const hint = document.createElement('span');
        hint.className = 'drawwave-live-preview-hint';
        hint.textContent = 'click to edit';
        el.querySelector('.drawwave-live-preview-controls')?.appendChild(hint);
        return el;
    }
    ignoreEvent(e: Event): boolean {
        return (e.target as HTMLElement).closest?.('button') !== null;
    }
}

// ================================================================
// Widget B: inline-preview (cursor inside) - appended after closing ```
// ================================================================
class WaveDromInlineWidget extends WidgetType {
    constructor(private readonly source: string) { super(); }
    eq(o: WaveDromInlineWidget): boolean { return this.source === o.source; }

    toDOM(): HTMLElement {
        return buildSvgPanel(this.source, 'drawwave-inline-preview');
    }
    ignoreEvent(e: Event): boolean {
        return (e.target as HTMLElement).closest?.('button') !== null;
    }
}

// ================================================================
// Build decorations
// ================================================================
function buildDecorations(state: EditorState): DecorationSet {
    try {
        if (!state.field(editorLivePreviewField)) return Decoration.none;
    } catch { return Decoration.none; }

    const blocks  = findWaveDromBlocks(state.doc);
    const builder = new RangeSetBuilder<Decoration>();
    const cursor  = state.selection.main;

    for (const block of blocks) {
        const cursorInside =
            cursor.from <= block.blockTo && cursor.to >= block.blockFrom;

        if (cursorInside) {
            // Append live-preview widget right after closing fence
            builder.add(
                block.blockTo,
                block.blockTo,
                Decoration.widget({
                    widget: new WaveDromInlineWidget(block.source),
                    side: 1,
                }),
            );
        } else {
            builder.add(
                block.blockFrom,
                block.blockTo,
                Decoration.replace({ widget: new WaveDromReplaceWidget(block) }),
            );
        }
    }
    return builder.finish();
}

// ================================================================
// State field
// ================================================================
const rebuildEffect = StateEffect.define<null>();

const wavedromDecoField = StateField.define<DecorationSet>({
    create:  (state) => buildDecorations(state),
    update(decos, tr) {
        for (const e of tr.effects) {
            if (e.is(rebuildEffect)) return buildDecorations(tr.state);
        }
        if (tr.selection) return buildDecorations(tr.state);
        if (tr.docChanged) return decos.map(tr.changes);
        return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
});

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
        destroy(): void { if (this.timer) clearTimeout(this.timer); }
    }
);

export const wavedromLivePreviewPlugin = [wavedromDecoField, wavedromDebouncePlugin];
