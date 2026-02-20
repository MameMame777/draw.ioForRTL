/**
 * WaveDrom rendering utility — server-side Node.js rendering
 * using wavedrom + onml (identical approach to the VS Code extension).
 *
 * Uses lazy loading to avoid crashing the plugin if wavedrom
 * has issues with Node.js stream module in Obsidian's context.
 */

export interface RenderResult {
    svg: string;
    error?: string;
}

// Lazy-loaded modules
let wavedrom: { renderAny: (i: number, s: unknown, skin: unknown) => unknown; waveSkin: unknown } | null = null;
let onml: { stringify: (jsonml: unknown) => string } | null = null;

function ensureModules(): string | null {
    if (wavedrom && onml) { return null; }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        wavedrom = require('wavedrom');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        onml = require('onml');
        return null;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('DrawWave: Failed to load wavedrom/onml:', msg);
        return msg;
    }
}

/**
 * Render WaveDrom JSON string to SVG string.
 */
export function renderWaveDromToSvg(jsonStr: string): RenderResult {
    const loadErr = ensureModules();
    if (loadErr) { return { svg: '', error: `Module load failed: ${loadErr}` }; }

    try {
        const source = JSON.parse(jsonStr);
        // Remove meta if present (not part of WaveDrom spec)
        delete source.meta;
        const jsonml = wavedrom!.renderAny(0, source, wavedrom!.waveSkin);
        const svg: string = onml!.stringify(jsonml);
        return { svg };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { svg: '', error: message };
    }
}

/**
 * Render WaveDrom from a parsed object (no need to re-parse).
 */
export function renderWaveDromObjectToSvg(source: Record<string, unknown>): RenderResult {
    const loadErr = ensureModules();
    if (loadErr) { return { svg: '', error: `Module load failed: ${loadErr}` }; }

    try {
        const copy = { ...source };
        delete copy.meta;
        const jsonml = wavedrom!.renderAny(0, copy, wavedrom!.waveSkin);
        const svg: string = onml!.stringify(jsonml);
        return { svg };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { svg: '', error: message };
    }
}
