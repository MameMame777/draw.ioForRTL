import { HdlSignalType, AbstractionLevel } from '../types/types';
import type { HdlModule, HdlSignal } from '../types/types';
import type { WaveJSONWithMeta, WaveSignalEntry, WaveLane } from 'wavedrom';

/**
 * WaveDromGenerator — generates WaveDrom JSON from parsed HDL modules.
 * 
 * Generates example waveforms based on signal types and abstraction level.
 */
export class WaveDromGenerator {
    private static readonly DEFAULT_CYCLES = 10;

    /**
     * Generate WaveDrom JSON for a parsed HDL module.
     */
    public generate(module: HdlModule, level: string = 'L1'): WaveJSONWithMeta {
        const absLevel = (level as AbstractionLevel) || AbstractionLevel.L1;
        const filteredSignals = this.filterByLevel(module.signals, absLevel);
        const signals = this.buildSignals(filteredSignals);

        return {
            meta: {
                source: module.filePath,
                module: module.name,
                level: absLevel,
            },
            signal: signals,
            config: { hscale: 1 },
            head: {
                text: `${module.name} — ${absLevel}`,
                tick: 0,
            },
        };
    }

    private filterByLevel(signals: HdlSignal[], level: AbstractionLevel): HdlSignal[] {
        switch (level) {
            case AbstractionLevel.L0:
                return signals.filter(s =>
                    s.type === HdlSignalType.Clk || s.type === HdlSignalType.Reset
                );
            case AbstractionLevel.L1:
                return signals.filter(s =>
                    s.type === HdlSignalType.Clk ||
                    s.type === HdlSignalType.Reset ||
                    s.type === HdlSignalType.Ctrl ||
                    s.type === HdlSignalType.Fsm
                );
            case AbstractionLevel.L2:
                return signals; // All signals
            default:
                return signals;
        }
    }

    private buildSignals(signals: HdlSignal[]): WaveSignalEntry[] {
        const result: WaveSignalEntry[] = [];

        // Group by type
        const clocks = signals.filter(s => s.type === HdlSignalType.Clk);
        const resets = signals.filter(s => s.type === HdlSignalType.Reset);
        const ctrls = signals.filter(s => s.type === HdlSignalType.Ctrl);
        const fsms = signals.filter(s => s.type === HdlSignalType.Fsm);
        const datas = signals.filter(s => s.type === HdlSignalType.Data);
        const buses = signals.filter(s => s.type === HdlSignalType.Bus);

        // Add clocks first
        for (const sig of clocks) {
            result.push(this.generateClockWave(sig));
        }

        // Spacer
        if (clocks.length > 0 && (resets.length + ctrls.length + fsms.length + datas.length + buses.length) > 0) {
            result.push({});
        }

        // Resets
        for (const sig of resets) {
            result.push(this.generateResetWave(sig));
        }

        // Control signals
        if (ctrls.length > 0) {
            if (resets.length > 0) { result.push({}); }
            for (const sig of ctrls) {
                result.push(this.generateCtrlWave(sig));
            }
        }

        // FSM states
        if (fsms.length > 0) {
            result.push({});
            for (const sig of fsms) {
                result.push(this.generateFsmWave(sig));
            }
        }

        // Data signals
        if (datas.length > 0 || buses.length > 0) {
            result.push({});
            for (const sig of [...datas, ...buses]) {
                result.push(this.generateDataWave(sig));
            }
        }

        return result;
    }

    private generateClockWave(sig: HdlSignal): WaveLane {
        const cycles = WaveDromGenerator.DEFAULT_CYCLES;
        return {
            name: sig.name,
            wave: 'p' + '.'.repeat(cycles - 1),
        };
    }

    private generateResetWave(sig: HdlSignal): WaveLane {
        if (sig.isActiveLow) {
            if (sig.isAsync) {
                return {
                    name: sig.name,
                    wave: '0.1' + '.'.repeat(WaveDromGenerator.DEFAULT_CYCLES - 3),
                };
            } else {
                return {
                    name: sig.name,
                    wave: '01' + '.'.repeat(WaveDromGenerator.DEFAULT_CYCLES - 2),
                };
            }
        } else {
            if (sig.isAsync) {
                return {
                    name: sig.name,
                    wave: '1.0' + '.'.repeat(WaveDromGenerator.DEFAULT_CYCLES - 3),
                };
            } else {
                return {
                    name: sig.name,
                    wave: '10' + '.'.repeat(WaveDromGenerator.DEFAULT_CYCLES - 2),
                };
            }
        }
    }

    private generateCtrlWave(sig: HdlSignal): WaveLane {
        // Generate a typical control signal pattern
        return {
            name: sig.name,
            wave: '0..1..0' + '.'.repeat(Math.max(0, WaveDromGenerator.DEFAULT_CYCLES - 7)),
        };
    }

    private generateFsmWave(sig: HdlSignal): WaveLane {
        const states = sig.fsmStates || ['IDLE', 'S1', 'S2', 'DONE'];
        const colors = ['3', '4', '5', '6', '7', '8', '9'];

        let wave = 'x.';
        const data: string[] = [];
        for (let i = 0; i < states.length && wave.length < WaveDromGenerator.DEFAULT_CYCLES; i++) {
            wave += colors[i % colors.length] + '.';
            data.push(states[i]);
        }
        // Pad to target length
        while (wave.length < WaveDromGenerator.DEFAULT_CYCLES) {
            wave += '.';
        }

        return {
            name: sig.name,
            wave: wave.substring(0, WaveDromGenerator.DEFAULT_CYCLES),
            data,
        };
    }

    private generateDataWave(sig: HdlSignal): WaveLane {
        const dataLabels: string[] = [];
        let wave = 'x.';

        if (sig.width > 1) {
            // Multi-bit: show as bus data
            for (let i = 0; wave.length < WaveDromGenerator.DEFAULT_CYCLES - 2; i++) {
                wave += '=.';
                dataLabels.push(`D${i}`);
            }
            wave += 'x';
        } else {
            // Single bit: show as 0/1
            wave = 'x.0.1.0.1' + '.'.repeat(Math.max(0, WaveDromGenerator.DEFAULT_CYCLES - 9));
        }

        const lane: WaveLane = {
            name: sig.name,
            wave: wave.substring(0, WaveDromGenerator.DEFAULT_CYCLES),
        };
        if (dataLabels.length > 0) {
            lane.data = dataLabels;
        }
        return lane;
    }
}
