/**
 * VcdParser — parses Value Change Dump (IEEE 1364) files and converts to WaveDrom JSON.
 *
 * Supports:
 *   - $scope / $upscope for hierarchy
 *   - $var for signal definitions (wire, reg, integer, etc.)
 *   - $timescale for time units
 *   - Value changes: 0/1/x/z for 1-bit, b/B for multi-bit, r/R for real
 *   - Interactive signal selection and time range
 *
 * Limitations:
 *   - Large VCD files are sampled (max N transitions per signal)
 *   - Real-valued signals shown as data labels
 */

export interface VcdSignal {
    id: string;          // VCD identifier character(s)
    name: string;
    fullPath: string;    // scope.name
    width: number;
    type: string;        // wire, reg, integer, etc.
}

export interface VcdChange {
    time: number;
    signalId: string;
    value: string;       // '0', '1', 'x', 'z', binary string, etc.
}

export interface VcdData {
    timescale: string;
    signals: VcdSignal[];
    changes: VcdChange[];
    endTime: number;
}

/**
 * Parse a VCD file content string.
 */
export function parseVcd(source: string): VcdData {
    const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const signals: VcdSignal[] = [];
    const changes: VcdChange[] = [];
    let timescale = '1ns';
    let endTime = 0;

    const scopeStack: string[] = [];
    const signalMap: Map<string, VcdSignal> = new Map();
    let inDefs = true;
    let currentTime = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) { continue; }

        if (inDefs) {
            // Header section
            if (line.startsWith('$timescale')) {
                // May be on same line or next line
                const tsMatch = line.match(/\$timescale\s+(.*?)\s*\$end/);
                if (tsMatch) {
                    timescale = tsMatch[1].trim();
                } else {
                    // Multi-line
                    const nextLine = lines[++i]?.trim() || '';
                    timescale = nextLine.replace('$end', '').trim();
                }
                continue;
            }

            if (line.startsWith('$scope')) {
                const m = line.match(/\$scope\s+\w+\s+(\w+)/);
                if (m) { scopeStack.push(m[1]); }
                continue;
            }

            if (line.startsWith('$upscope')) {
                scopeStack.pop();
                continue;
            }

            if (line.startsWith('$var')) {
                const m = line.match(
                    /\$var\s+(\w+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+\[(\d+):(\d+)\])?\s*\$end/
                );
                if (m) {
                    const type = m[1];
                    const width = parseInt(m[2], 10);
                    const id = m[3];
                    const name = m[4];
                    const fullPath = scopeStack.length > 0
                        ? scopeStack.join('.') + '.' + name
                        : name;

                    const signal: VcdSignal = { id, name, fullPath, width, type };
                    signals.push(signal);
                    signalMap.set(id, signal);
                }
                continue;
            }

            if (line.startsWith('$enddefinitions')) {
                inDefs = false;
                continue;
            }

            // Skip other header directives
            continue;
        }

        // Data section
        if (line.startsWith('$dumpvars') || line.startsWith('$end') ||
            line.startsWith('$comment') || line.startsWith('$dumpall') ||
            line.startsWith('$dumpoff') || line.startsWith('$dumpon')) {
            continue;
        }

        // Timestamp: #<number>
        if (line.startsWith('#')) {
            currentTime = parseInt(line.substring(1), 10);
            if (currentTime > endTime) { endTime = currentTime; }
            continue;
        }

        // 1-bit value change: 0/1/x/z/X/Z followed by signal ID
        const singleBitMatch = line.match(/^([01xzXZ])(\S+)$/);
        if (singleBitMatch) {
            changes.push({
                time: currentTime,
                signalId: singleBitMatch[2],
                value: singleBitMatch[1].toLowerCase(),
            });
            continue;
        }

        // Multi-bit value change: b/B<binary> <signal_id>
        const multiBitMatch = line.match(/^[bB]([01xzXZ]+)\s+(\S+)$/);
        if (multiBitMatch) {
            changes.push({
                time: currentTime,
                signalId: multiBitMatch[2],
                value: multiBitMatch[1].toLowerCase(),
            });
            continue;
        }

        // Real value change: r/R<float> <signal_id>
        const realMatch = line.match(/^[rR]([^\s]+)\s+(\S+)$/);
        if (realMatch) {
            changes.push({
                time: currentTime,
                signalId: realMatch[2],
                value: realMatch[1],
            });
            continue;
        }
    }

    return { timescale, signals, changes, endTime };
}

/**
 * Convert VCD data to WaveDrom JSON.
 *
 * @param vcd       Parsed VCD data
 * @param signalIds Signal IDs to include (if empty, include all)
 * @param startTime Start time for the waveform
 * @param endTime   End time for the waveform
 * @param maxCycles Maximum number of time steps to render
 */
export function vcdToWaveDrom(
    vcd: VcdData,
    signalIds?: string[],
    startTime?: number,
    endTime?: number,
    maxCycles?: number
): Record<string, unknown> {
    const tStart = startTime ?? 0;
    const tEnd = endTime ?? vcd.endTime;
    const maxSteps = maxCycles ?? 40;

    // Select signals
    const selectedSignals = signalIds && signalIds.length > 0
        ? vcd.signals.filter(s => signalIds.includes(s.id))
        : vcd.signals;

    // Filter changes within time range
    const relevantChanges = vcd.changes.filter(
        c => c.time >= tStart && c.time <= tEnd
    );

    // Build change map per signal: time → value
    const changeMap: Map<string, Map<number, string>> = new Map();
    for (const sig of selectedSignals) {
        changeMap.set(sig.id, new Map());
    }
    for (const change of relevantChanges) {
        const sigMap = changeMap.get(change.signalId);
        if (sigMap) {
            sigMap.set(change.time, change.value);
        }
    }

    // Determine sample times — pick up to maxSteps evenly spaced or at change points
    const allTimes = new Set<number>();
    allTimes.add(tStart);
    for (const change of relevantChanges) {
        allTimes.add(change.time);
    }
    let sampleTimes = Array.from(allTimes).sort((a, b) => a - b);

    if (sampleTimes.length > maxSteps) {
        // Sample at regular intervals
        const step = (tEnd - tStart) / maxSteps;
        const regular: number[] = [];
        for (let t = tStart; t <= tEnd; t += step) {
            regular.push(Math.round(t));
        }
        sampleTimes = regular;
    }

    // Build WaveDrom signals
    const waveSignals: Record<string, unknown>[] = [];

    for (const sig of selectedSignals) {
        const sigChanges = changeMap.get(sig.id)!;
        let wave = '';
        const data: string[] = [];
        let lastValue = 'x';

        // Find initial value (last change before tStart)
        const preChanges = vcd.changes
            .filter(c => c.signalId === sig.id && c.time <= tStart)
            .sort((a, b) => a.time - b.time);
        if (preChanges.length > 0) {
            lastValue = preChanges[preChanges.length - 1].value;
        }

        for (let i = 0; i < sampleTimes.length; i++) {
            const t = sampleTimes[i];
            const newValue = sigChanges.get(t);
            const currentValue = newValue !== undefined ? newValue : lastValue;

            if (sig.width === 1) {
                // 1-bit signal
                if (currentValue === '0') {
                    wave += (lastValue === '0' && newValue === undefined) ? '.' : '0';
                } else if (currentValue === '1') {
                    wave += (lastValue === '1' && newValue === undefined) ? '.' : '1';
                } else if (currentValue === 'x') {
                    wave += 'x';
                } else if (currentValue === 'z') {
                    wave += 'z';
                } else {
                    wave += 'x';
                }
            } else {
                // Multi-bit signal — show as data bus
                if (newValue !== undefined || i === 0) {
                    wave += '=';
                    // Convert binary to hex for display
                    const hexVal = binaryToHex(currentValue, sig.width);
                    data.push(hexVal);
                } else {
                    wave += '.';
                }
            }

            if (newValue !== undefined) {
                lastValue = newValue;
            }
        }

        const entry: Record<string, unknown> = {
            name: sig.name,
            wave: wave,
        };
        if (data.length > 0) {
            entry.data = data;
        }
        waveSignals.push(entry);
    }

    return {
        signal: waveSignals,
        head: {
            text: `VCD: ${vcd.timescale}`,
        },
        config: {
            hscale: 1,
        },
    };
}

function binaryToHex(binStr: string, width: number): string {
    // Clean up
    const clean = binStr.replace(/[^01xzXZ]/g, '');
    if (clean.includes('x') || clean.includes('X')) { return 'X'; }
    if (clean.includes('z') || clean.includes('Z')) { return 'Z'; }

    const val = parseInt(clean, 2);
    if (isNaN(val)) { return binStr; }

    const hexDigits = Math.max(1, Math.ceil(width / 4));
    return '0x' + val.toString(16).toUpperCase().padStart(hexDigits, '0');
}
