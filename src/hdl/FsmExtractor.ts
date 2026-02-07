/**
 * FsmExtractor — extracts FSM state transitions from Verilog/SystemVerilog.
 *
 * Parses:
 *   - typedef enum declarations for state names
 *   - always_comb / always @(*) blocks with case statements
 *   - Extracts transitions: { from, to, condition }
 *
 * Does NOT perform full RTL synthesis — uses heuristic pattern matching.
 */

export interface FsmState {
    name: string;
    isReset?: boolean;
}

export interface FsmTransition {
    from: string;
    to: string;
    condition: string;
}

export interface FsmInfo {
    moduleName: string;
    stateSignal: string;
    states: FsmState[];
    transitions: FsmTransition[];
    resetState?: string;
}

/**
 * Extract FSM information from HDL source.
 */
export function extractFsm(source: string): FsmInfo | null {
    const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    // Find module name
    let moduleName = 'module';
    for (const line of lines) {
        const m = line.match(/^\s*module\s+(\w+)/);
        if (m) { moduleName = m[1]; break; }
    }

    // Find enum typedef — extract state names
    const states: FsmState[] = [];
    const enumRegex = /typedef\s+enum\s+(?:logic\s*\[\d+:\d+\]\s*)?\{([^}]+)\}\s*(\w+)/g;
    let enumMatch;
    let stateTypeName = '';
    while ((enumMatch = enumRegex.exec(normalized)) !== null) {
        const members = enumMatch[1].split(',').map(m => {
            const trimmed = m.trim();
            const eqIdx = trimmed.indexOf('=');
            return (eqIdx >= 0 ? trimmed.substring(0, eqIdx) : trimmed).trim();
        }).filter(m => m.length > 0);

        // Heuristic: if type name contains "state" or members look like state names
        const typeName = enumMatch[2];
        if (typeName.toLowerCase().includes('state') ||
            typeName.endsWith('_t') ||
            members.some(m => /^(IDLE|INIT|RESET|START|S\d|ST_)/.test(m))) {
            stateTypeName = typeName;
            for (const name of members) {
                states.push({ name });
            }
            break;
        }
    }

    // If no enum found, try localparam/parameter state definitions
    if (states.length === 0) {
        const stateParams: string[] = [];
        const paramRegex = /(?:parameter|localparam)\s+(?:\[\d+:\d+\]\s+)?(\w+)\s*=\s*\d+/g;
        let paramMatch;
        while ((paramMatch = paramRegex.exec(normalized)) !== null) {
            const name = paramMatch[1];
            if (name === name.toUpperCase() ||
                name.startsWith('ST_') || name.startsWith('S_')) {
                stateParams.push(name);
            }
        }
        if (stateParams.length >= 2) {
            for (const name of stateParams) {
                states.push({ name });
            }
        }
    }

    if (states.length === 0) {
        return null; // No FSM found
    }

    // Find state signal name
    let stateSignal = 'state';
    if (stateTypeName) {
        const sigRegex = new RegExp(`${stateTypeName}\\s+(\\w+)`);
        const sigMatch = normalized.match(sigRegex);
        if (sigMatch) {
            stateSignal = sigMatch[1];
        }
    }

    // Find reset state from always_ff block
    let resetState: string | undefined;
    const resetRegex = new RegExp(
        `if\\s*\\(!?\\s*\\w*(?:rst|reset)\\w*\\)\\s*(?:begin)?\\s*\\n?\\s*${stateSignal}\\s*<=\\s*(\\w+)`,
        'i'
    );
    const resetMatch = normalized.match(resetRegex);
    if (resetMatch) {
        resetState = resetMatch[1];
        const rs = states.find(s => s.name === resetState);
        if (rs) { rs.isReset = true; }
    }

    // Extract transitions from case statement in always_comb block
    const transitions: FsmTransition[] = [];

    // Find the combinational always block containing next_state assignments
    const alwaysCombRegex =
        /(?:always_comb|always\s+@\s*\(\s*\*\s*\))\s*begin([\s\S]*?)end(?:\s|$)/g;
    let alwaysMatch;
    while ((alwaysMatch = alwaysCombRegex.exec(normalized)) !== null) {
        const block = alwaysMatch[1];

        // Find case statement
        const caseRegex = /case\s*\(\s*(\w+)\s*\)([\s\S]*?)endcase/g;
        let caseMatch;
        while ((caseMatch = caseRegex.exec(block)) !== null) {
            const caseBody = caseMatch[2];
            parseCaseBody(caseBody, states, transitions);
        }
    }

    // If no transitions found from always_comb, try any case block
    if (transitions.length === 0) {
        const globalCaseRegex = /case\s*\(\s*(?:state|current_state|cstate|fsm_state)\s*\)([\s\S]*?)endcase/gi;
        let gcMatch;
        while ((gcMatch = globalCaseRegex.exec(normalized)) !== null) {
            parseCaseBody(gcMatch[1], states, transitions);
        }
    }

    return {
        moduleName,
        stateSignal,
        states,
        transitions,
        resetState,
    };
}

function parseCaseBody(
    body: string,
    states: FsmState[],
    transitions: FsmTransition[]
): void {
    const stateNames = new Set(states.map(s => s.name));

    // Split into case items — each starts with a state name followed by ':'
    const itemRegex = /(\w+)\s*:\s*([\s\S]*?)(?=\n\s*\w+\s*:|$)/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(body)) !== null) {
        const fromState = itemMatch[1];
        if (fromState === 'default' || !stateNames.has(fromState)) { continue; }

        const itemBody = itemMatch[2];

        // Find next_state assignments — handle ternary and if/else
        // Pattern: next_state = condition ? STATE_A : STATE_B
        const ternaryRegex = /\w+\s*=\s*([^?;]+)\?\s*(\w+)\s*:\s*([^;]+);/g;
        let ternMatch;
        while ((ternMatch = ternaryRegex.exec(itemBody)) !== null) {
            const cond = ternMatch[1].trim();
            const thenState = ternMatch[2].trim();
            const elseExpr = ternMatch[3].trim();

            if (stateNames.has(thenState)) {
                transitions.push({ from: fromState, to: thenState, condition: cond });
            }

            // Handle chained ternary or simple else state
            if (stateNames.has(elseExpr)) {
                transitions.push({ from: fromState, to: elseExpr, condition: `!${cond}` });
            } else {
                // Nested ternary: cond2 ? STATE : STATE
                const nestedRegex = /([^?]+)\?\s*(\w+)\s*:\s*(\w+)/;
                const nested = elseExpr.match(nestedRegex);
                if (nested) {
                    if (stateNames.has(nested[2])) {
                        transitions.push({ from: fromState, to: nested[2], condition: nested[1].trim() });
                    }
                    if (stateNames.has(nested[3])) {
                        transitions.push({ from: fromState, to: nested[3], condition: `!${nested[1].trim()}` });
                    }
                }
            }
        }

        // Pattern: simple assignment — next_state = STATE;
        if (!ternaryRegex.test(itemBody)) {
            const simpleRegex = /\w+\s*=\s*(\w+)\s*;/;
            const simpleMatch = itemBody.match(simpleRegex);
            if (simpleMatch && stateNames.has(simpleMatch[1])) {
                transitions.push({ from: fromState, to: simpleMatch[1], condition: '' });
            }
        }
    }
}

/**
 * Render FSM state transition diagram as draw.io XML.
 */
export function renderFsmXml(fsm: FsmInfo): string {
    const stateCount = fsm.states.length;

    // Layout: arrange states in a circle
    const centerX = 300;
    const centerY = 250;
    const radius = Math.max(120, stateCount * 35);
    const stateW = 100;
    const stateH = 50;

    let cellId = 2;
    const cells: string[] = [];
    const stateIds: Map<string, number> = new Map();

    function esc(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function nextId(): number {
        return cellId++;
    }

    // Title
    const titleId = nextId();
    cells.push(
        `<mxCell id="${titleId}" value="${esc(fsm.moduleName)} — FSM" ` +
        `style="text;html=1;align=center;verticalAlign=middle;fontSize=16;fontStyle=1;` +
        `strokeColor=none;fillColor=none;" vertex="1" parent="1">` +
        `<mxGeometry x="${centerX - 100}" y="20" width="200" height="30" as="geometry"/></mxCell>`
    );

    // State circles
    fsm.states.forEach((state, i) => {
        const angle = (2 * Math.PI * i) / stateCount - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle) - stateW / 2;
        const y = centerY + radius * Math.sin(angle) - stateH / 2;

        const id = nextId();
        stateIds.set(state.name, id);

        const isReset = state.isReset || state.name === fsm.resetState;
        const fillColor = isReset ? '#f8cecc' : '#dae8fc';
        const strokeColor = isReset ? '#b85450' : '#6c8ebf';
        const fontStyle = isReset ? '1' : '0';

        cells.push(
            `<mxCell id="${id}" value="${esc(state.name)}" ` +
            `style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=${fillColor};` +
            `strokeColor=${strokeColor};fontSize=12;fontStyle=${fontStyle};" ` +
            `vertex="1" parent="1">` +
            `<mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${stateW}" height="${stateH}" as="geometry"/></mxCell>`
        );
    });

    // Reset arrow (small dot → reset state)
    if (fsm.resetState && stateIds.has(fsm.resetState)) {
        const dotId = nextId();
        const targetId = stateIds.get(fsm.resetState)!;
        const angle = (2 * Math.PI * fsm.states.findIndex(s => s.name === fsm.resetState)) / stateCount - Math.PI / 2;
        const dotX = centerX + (radius + 60) * Math.cos(angle) - 8;
        const dotY = centerY + (radius + 60) * Math.sin(angle) - 8;

        cells.push(
            `<mxCell id="${dotId}" value="" style="ellipse;fillColor=#000000;strokeColor=none;" ` +
            `vertex="1" parent="1">` +
            `<mxGeometry x="${Math.round(dotX)}" y="${Math.round(dotY)}" width="16" height="16" as="geometry"/></mxCell>`
        );

        const arrowId = nextId();
        cells.push(
            `<mxCell id="${arrowId}" value="reset" ` +
            `style="endArrow=block;endFill=1;fontSize=10;fontColor=#b85450;" ` +
            `edge="1" source="${dotId}" target="${targetId}" parent="1">` +
            `<mxGeometry relative="1" as="geometry"/></mxCell>`
        );
    }

    // Transition arrows
    for (const tr of fsm.transitions) {
        const sourceId = stateIds.get(tr.from);
        const targetId = stateIds.get(tr.to);
        if (!sourceId || !targetId) { continue; }

        const edgeId = nextId();
        const isSelfLoop = tr.from === tr.to;
        const label = tr.condition || '';
        const style = isSelfLoop
            ? 'endArrow=block;endFill=1;curved=1;fontSize=9;fontColor=#333333;'
            : 'endArrow=block;endFill=1;curved=1;fontSize=9;fontColor=#333333;';

        cells.push(
            `<mxCell id="${edgeId}" value="${esc(label)}" ` +
            `style="${style}" edge="1" source="${sourceId}" target="${targetId}" parent="1">` +
            `<mxGeometry relative="1" as="geometry"/></mxCell>`
        );
    }

    const totalWidth = centerX * 2 + 100;
    const totalHeight = centerY * 2 + 100;

    return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel>`;
}
