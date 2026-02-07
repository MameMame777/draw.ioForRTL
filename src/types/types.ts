/**
 * Common types used throughout the DrawWave extension
 */

/** Timer/Debounce types */
export type Timeout = ReturnType<typeof setTimeout>;

/** Abstraction levels for HDL waveform generation */
export enum AbstractionLevel {
    L0 = 'L0', // Clock and Reset only
    L1 = 'L1', // + Control signals and FSM
    L2 = 'L2', // + Data transitions
}

/** HDL signal types detected by the parser */
export enum HdlSignalType {
    Clk = 'clk',
    Reset = 'reset',
    Data = 'data',
    Ctrl = 'ctrl',
    Fsm = 'fsm',
    Bus = 'bus',
}

/** HDL signal direction */
export enum SignalDirection {
    Input = 'input',
    Output = 'output',
    Inout = 'inout',
    Internal = 'internal',
}

/** Parsed HDL signal with wavedrom annotation */
export interface HdlSignal {
    name: string;
    type: HdlSignalType;
    direction: SignalDirection;
    width: number;
    isAsync: boolean;
    isActiveLow: boolean;
    fsmStates?: string[];
}

/** Parsed HDL module */
export interface HdlModule {
    name: string;
    filePath: string;
    signals: HdlSignal[];
}

/** Module hierarchy types */
export interface HierarchyPort {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width: number;
    widthExpr?: string;
}

export interface HierarchyParam {
    name: string;
    defaultValue: string;
}

export interface ModuleDefinition {
    name: string;
    filePath: string;
    ports: HierarchyPort[];
    parameters: HierarchyParam[];
    instantiations: ModuleInstantiation[];
}

export interface ModuleInstantiation {
    moduleName: string;
    instanceName: string;
    paramOverrides: { name: string; value: string }[];
    portConnections: PortConnection[];
}

export interface PortConnection {
    portName: string;
    signalExpr: string;
}

export interface HierarchyNode {
    moduleName: string;
    instanceName: string;
    definition: ModuleDefinition | null;
    children: HierarchyNode[];
    pageId?: string;
}

/** Truth table definition */
export interface TruthTableDef {
    inputs: string[];
    outputs: TruthTableOutput[];
}

export interface TruthTableOutput {
    name: string;
    expression: string;
}

/** Evaluated truth table */
export interface TruthTable {
    inputs: string[];
    outputs: string[];
    rows: TruthTableRow[];
}

export interface TruthTableRow {
    inputs: (boolean | null)[];
    outputs: (boolean | null)[];
}

/** Raw table imported from CSV/Markdown — values kept as strings */
export interface RawTable {
    inputs: string[];
    outputs: string[];
    rows: RawTableRow[];
}

export interface RawTableRow {
    inputs: string[];
    outputs: string[];
}

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

/** Template entry for the picker */
export interface TemplateEntry {
    meta: TemplateMeta;
    filePath: string;
}

/** WebView message types */
export interface WaveDromUpdateMessage {
    type: 'update';
    payload: string; // WaveJSON string
}

export interface WaveDromExportMessage {
    type: 'export';
    format: 'svg' | 'png';
}

export interface WaveDromExportResultMessage {
    type: 'export-result';
    format: string;
    data: string;
}

export interface WaveDromErrorMessage {
    type: 'error';
    message: string;
}

export type ExtensionToWebViewMessage =
    | WaveDromUpdateMessage
    | WaveDromExportMessage;

export type WebViewToExtensionMessage =
    | WaveDromExportResultMessage
    | WaveDromErrorMessage;

/** Draw.io communication messages */
export interface DrawioLoadMessage {
    type: 'load';
    xml: string;
}

export interface DrawioInsertWaveDromMessage {
    type: 'insert-wavedrom';
    svg: string;
    json: string;
}

export interface DrawioInsertTruthTableMessage {
    type: 'insert-truth-table';
    xml: string;
}

export interface DrawioSaveMessage {
    type: 'save';
    xml: string;
}

export interface DrawioReadyMessage {
    type: 'ready';
}

export type ExtensionToDrawioMessage =
    | DrawioLoadMessage
    | DrawioInsertWaveDromMessage
    | DrawioInsertTruthTableMessage;

export type DrawioToExtensionMessage =
    | DrawioSaveMessage
    | DrawioReadyMessage;
