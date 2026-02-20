/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * WaveDrom type definitions (hand-crafted - no @types/wavedrom exists)
 */

declare module 'wavedrom' {
    export const version: string;

    export interface WaveLane {
        name?: string;
        wave?: string;
        data?: string[] | string;
        period?: number;
        phase?: number;
        node?: string;
    }

    export type WaveGroup = [string, ...(WaveLane | WaveGroup | Record<string, never>)[]];

    export type WaveSignalEntry = WaveLane | WaveGroup | Record<string, never>;

    export interface WaveConfig {
        hscale?: number;
        skin?: string;
    }

    export interface WaveHeadFoot {
        text?: string | any[];
        tick?: number | string;
        tock?: number | string;
        every?: number;
    }

    export type AssignExpr = string | [string, ...AssignExpr[]];
    export type AssignEntry = [string, AssignExpr];

    export interface RegField {
        bits: number;
        name?: string;
        attr?: string | string[];
        type?: number;
    }

    export interface WaveJSON {
        signal?: WaveSignalEntry[];
        assign?: AssignEntry[];
        reg?: RegField[];
        config?: WaveConfig;
        head?: WaveHeadFoot;
        foot?: WaveHeadFoot;
        edge?: string[];
    }

    export type WaveSkin = any[];

    export const waveSkin: WaveSkin;

    export function renderAny(index: number, source: WaveJSON, waveSkin: WaveSkin): any;
    export function renderWaveForm(index: number, source: WaveJSON, waveSkin: WaveSkin): any;
    export function processAll(): void;

    const _default: {
        version: string;
        waveSkin: WaveSkin;
        renderAny: typeof renderAny;
        renderWaveForm: typeof renderWaveForm;
        processAll: typeof processAll;
    };
    export default _default;
}

declare module 'onml' {
    export function stringify(jsonml: any): string;
    export function parse(xml: string): any;
}
