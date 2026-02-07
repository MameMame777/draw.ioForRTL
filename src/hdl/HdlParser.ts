import { HdlSignalType, SignalDirection } from '../types/types';
import type { HdlSignal, HdlModule } from '../types/types';

/**
 * HdlParser — parses Verilog/SystemVerilog files for @wavedrom annotations.
 * 
 * Detects:
 *   // @wavedrom <signal_name> [type] [options...]
 * 
 * Followed by a signal declaration on the next non-empty line.
 * Does NOT fully parse HDL — only extracts annotated signals and module names.
 */
export class HdlParser {
    private static readonly MODULE_REGEX = /^\s*module\s+(\w+)/;
    private static readonly ANNOTATION_REGEX = /\/\/\s*@wavedrom\s+(\w+)(?:\s+(.*))?$/;
    // Matches: input [logic] [width] name, output [logic] [width] name, etc.
    private static readonly PORT_SIGNAL_REGEX =
        /^\s*(input|output|inout)\s+(?:(?:reg|wire|logic|signed|unsigned)\s+)*(?:\[([^\]]+)\])?\s*(\w+)/;
    // Matches: logic [width] name, reg name, wire [width] name
    private static readonly INTERNAL_SIGNAL_REGEX =
        /^\s*(reg|wire|logic)\s+(?:\[([^\]]+)\])?\s*(\w+)/;
    // Matches: custom_type_t name (for typedef enum / struct)
    private static readonly CUSTOM_TYPE_REGEX =
        /^\s*(\w+_t)\s+(\w+)/;
    private static readonly PARAM_REGEX = /^\s*(?:parameter|localparam)\s+(\w+)\s*=\s*(\w+)/;

    /**
     * Parse HDL source for @wavedrom annotations.
     */
    public parse(source: string, filePath: string): HdlModule {
        const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const signals: HdlSignal[] = [];
        let moduleName = 'untitled';
        const fsmStates: Map<string, string[]> = new Map();

        // First pass: find module name and parameter values (for FSM states)
        for (const line of lines) {
            const moduleMatch = line.match(HdlParser.MODULE_REGEX);
            if (moduleMatch) {
                moduleName = moduleMatch[1];
            }

            // Collect enum-like parameters for FSM state detection
            const paramMatch = line.match(HdlParser.PARAM_REGEX);
            if (paramMatch) {
                // TODO: group parameters by naming convention (e.g., ST_IDLE, ST_RUN)
            }
        }

        // Second pass: find @wavedrom annotations
        for (let i = 0; i < lines.length; i++) {
            const annoMatch = lines[i].match(HdlParser.ANNOTATION_REGEX);
            if (!annoMatch) { continue; }

            const signalName = annoMatch[1];
            const optionsStr = annoMatch[2] || '';
            const options = this.parseOptions(optionsStr);

            // Look for signal declaration on following lines
            let signalInfo: { direction: SignalDirection; width: number } | undefined;
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const line = lines[j];
                // Try port declaration first: input/output/inout [logic] [width] name
                const portMatch = line.match(HdlParser.PORT_SIGNAL_REGEX);
                if (portMatch) {
                    const direction = this.parseDirection(portMatch[1]);
                    const width = portMatch[2] ? this.parseWidth(portMatch[2]) : 1;
                    signalInfo = { direction, width };
                    break;
                }
                // Try internal signal: logic/reg/wire [width] name
                const intMatch = line.match(HdlParser.INTERNAL_SIGNAL_REGEX);
                if (intMatch) {
                    const width = intMatch[2] ? this.parseWidth(intMatch[2]) : 1;
                    signalInfo = { direction: SignalDirection.Internal, width };
                    break;
                }
                // Try custom type: typename_t name
                const customMatch = line.match(HdlParser.CUSTOM_TYPE_REGEX);
                if (customMatch) {
                    signalInfo = { direction: SignalDirection.Internal, width: 1 };
                    break;
                }
            }

            const signal: HdlSignal = {
                name: signalName,
                type: options.type || this.inferType(signalName),
                direction: signalInfo?.direction || SignalDirection.Internal,
                width: options.width || signalInfo?.width || 1,
                isAsync: options.async || false,
                isActiveLow: options.activeLow || this.isActiveLowName(signalName),
                fsmStates: options.fsmStates,
            };

            signals.push(signal);
        }

        // Also scan for FSM state parameters if any signal is FSM type
        const hasFsm = signals.some(s => s.type === HdlSignalType.Fsm);
        if (hasFsm) {
            const states = this.extractFsmStates(lines);
            for (const signal of signals) {
                if (signal.type === HdlSignalType.Fsm && !signal.fsmStates?.length) {
                    signal.fsmStates = states;
                }
            }
        }

        return {
            name: moduleName,
            filePath,
            signals,
        };
    }

    private parseOptions(optionsStr: string): {
        type?: HdlSignalType;
        async: boolean;
        activeLow: boolean;
        width?: number;
        fsmStates?: string[];
    } {
        const parts = optionsStr.split(/\s+/).filter(s => s.length > 0);
        let type: HdlSignalType | undefined;
        let async = false;
        let activeLow = false;
        let width: number | undefined;
        const fsmStates: string[] = [];

        for (const part of parts) {
            const lower = part.toLowerCase();
            switch (lower) {
                case 'clk':
                case 'clock':
                    type = HdlSignalType.Clk;
                    break;
                case 'reset':
                case 'rst':
                    type = HdlSignalType.Reset;
                    break;
                case 'data':
                    type = HdlSignalType.Data;
                    break;
                case 'ctrl':
                case 'control':
                    type = HdlSignalType.Ctrl;
                    break;
                case 'fsm':
                case 'state':
                    type = HdlSignalType.Fsm;
                    break;
                case 'bus':
                    type = HdlSignalType.Bus;
                    break;
                case 'async':
                    async = true;
                    break;
                case 'active_low':
                case 'activelow':
                    activeLow = true;
                    break;
                default:
                    // Check for width:N
                    if (lower.startsWith('width:')) {
                        width = parseInt(lower.substring(6), 10);
                    }
                    // Check for states:STATE1,STATE2,...
                    if (lower.startsWith('states:')) {
                        fsmStates.push(...lower.substring(7).split(','));
                    }
                    break;
            }
        }

        return {
            type,
            async,
            activeLow,
            width,
            fsmStates: fsmStates.length > 0 ? fsmStates : undefined,
        };
    }

    private parseDirection(keyword: string): SignalDirection {
        switch (keyword) {
            case 'input': return SignalDirection.Input;
            case 'output': return SignalDirection.Output;
            case 'inout': return SignalDirection.Inout;
            default: return SignalDirection.Internal;
        }
    }

    /**
     * Parse a bus width specifier like "7:0", "DATA_WIDTH-1:0", or "N:0".
     * For parameterized widths, returns a best-guess value.
     */
    private parseWidth(widthStr: string): number {
        const parts = widthStr.split(':');
        if (parts.length !== 2) { return 1; }
        const msb = parseInt(parts[0].trim(), 10);
        const lsb = parseInt(parts[1].trim(), 10);
        if (!isNaN(msb) && !isNaN(lsb)) {
            return Math.abs(msb - lsb) + 1;
        }
        // Parameterized width — return a reasonable default
        return 8;
    }

    private inferType(name: string): HdlSignalType {
        const lower = name.toLowerCase();
        if (lower.includes('clk') || lower.includes('clock')) {
            return HdlSignalType.Clk;
        }
        if (lower.includes('rst') || lower.includes('reset')) {
            return HdlSignalType.Reset;
        }
        if (lower.includes('state') || lower.includes('fsm')) {
            return HdlSignalType.Fsm;
        }
        if (lower.includes('addr') || lower.includes('data') || lower.includes('bus')) {
            return HdlSignalType.Bus;
        }
        return HdlSignalType.Ctrl;
    }

    private isActiveLowName(name: string): boolean {
        return name.endsWith('_n') || name.endsWith('_b') ||
               name.endsWith('_N') || name.endsWith('_B') ||
               name.startsWith('n_') || name.startsWith('N_');
    }

    private extractFsmStates(lines: string[]): string[] {
        const states: string[] = [];
        const stateParamRegex = /(?:parameter|localparam)\s+(?:\[\d+:\d+\]\s+)?(\w+)\s*=\s*\d+/;

        for (const line of lines) {
            const match = line.match(stateParamRegex);
            if (match) {
                const name = match[1];
                // Heuristic: looks like a state name (all uppercase or ST_/S_ prefix)
                if (name === name.toUpperCase() ||
                    name.startsWith('ST_') || name.startsWith('S_') ||
                    name.startsWith('st_') || name.startsWith('s_')) {
                    states.push(name);
                }
            }
        }

        // Also check for enum typedef patterns
        const enumRegex = /typedef\s+enum\s+(?:logic\s*\[\d+:\d+\]\s*)?\{([^}]+)\}/g;
        const fullSource = lines.join('\n');
        let enumMatch;
        while ((enumMatch = enumRegex.exec(fullSource)) !== null) {
            const members = enumMatch[1].split(',').map(m => {
                const trimmed = m.trim();
                // Remove assignment if present
                const eqIdx = trimmed.indexOf('=');
                return (eqIdx >= 0 ? trimmed.substring(0, eqIdx) : trimmed).trim();
            }).filter(m => m.length > 0);
            states.push(...members);
        }

        return states;
    }
}
