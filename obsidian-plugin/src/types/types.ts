/**
 * Common types for the DrawWave Obsidian plugin
 */

export type Timeout = ReturnType<typeof setTimeout>;

/** Template metadata */
export interface TemplateMeta {
    name: string;
    category: TemplateCategory;
    description: string;
    tags: string[];
}

export type TemplateCategory =
    | 'basic'
    | 'logic'
    | 'bus'
    | 'fsm'
    | 'memory'
    | 'pipeline'
    | 'handshake';

/** Plugin settings */
export interface DrawWaveSettings {
    theme: 'kennedy' | 'min' | 'atlas' | 'dark' | 'sketch';
    debounceMs: number;
    drawioLanguage: string;
}

export const DEFAULT_SETTINGS: DrawWaveSettings = {
    theme: 'kennedy',
    debounceMs: 300,
    drawioLanguage: 'ja',
};
