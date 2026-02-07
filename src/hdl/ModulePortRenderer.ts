/**
 * ModulePortRenderer — generates draw.io XML for an HDL module's port diagram.
 *
 * Renders a block with:
 *   - Module name as title
 *   - Input ports on the left
 *   - Output ports on the right
 *   - Inout ports on the bottom
 *   - Bus widths shown as [N:0]
 */

export interface PortInfo {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width: number;
    /** e.g., "logic", "wire", "reg" */
    type?: string;
}

export interface ModulePortInfo {
    name: string;
    parameters?: { name: string; value: string }[];
    ports: PortInfo[];
}

/**
 * Parse an HDL source for ALL port declarations (no @wavedrom annotation needed).
 */
export function parseModulePorts(source: string): ModulePortInfo {
    const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    let moduleName = 'module';
    const ports: PortInfo[] = [];
    const parameters: { name: string; value: string }[] = [];

    // Module name
    for (const line of lines) {
        const m = line.match(/^\s*module\s+(\w+)/);
        if (m) {
            moduleName = m[1];
            break;
        }
    }

    // Parameters
    const paramRegex = /^\s*(?:parameter|localparam)\s+(?:\w+\s+)?(\w+)\s*=\s*([^,;\/]+)/;
    for (const line of lines) {
        const m = line.match(paramRegex);
        if (m) {
            parameters.push({ name: m[1], value: m[2].trim() });
        }
    }

    // Port declarations
    const portRegex =
        /^\s*(input|output|inout)\s+(?:(?:reg|wire|logic|signed|unsigned)\s+)*(?:\[([^\]]+)\])?\s*(\w+)/;
    for (const line of lines) {
        const m = line.match(portRegex);
        if (m) {
            const direction = m[1] as PortInfo['direction'];
            const widthStr = m[2];
            const name = m[3];
            let width = 1;
            if (widthStr) {
                const parts = widthStr.split(':');
                if (parts.length === 2) {
                    const msb = parseInt(parts[0].trim(), 10);
                    const lsb = parseInt(parts[1].trim(), 10);
                    width = !isNaN(msb) && !isNaN(lsb)
                        ? Math.abs(msb - lsb) + 1
                        : 8; // parameterized
                }
            }
            ports.push({ name, direction, width });
        }
    }

    return { name: moduleName, parameters, ports };
}

/**
 * Render a module port diagram as draw.io XML (<mxGraphModel>).
 */
export function renderModulePortXml(info: ModulePortInfo): string {
    const inputs = info.ports.filter(p => p.direction === 'input');
    const outputs = info.ports.filter(p => p.direction === 'output');
    const inouts = info.ports.filter(p => p.direction === 'inout');

    const portHeight = 26;
    const portTextWidth = 120;
    const portPinLen = 40;
    const headerHeight = 40;

    const maxPorts = Math.max(inputs.length, outputs.length, 1);
    const bodyHeight = headerHeight + maxPorts * portHeight + (inouts.length > 0 ? portHeight : 0) + 20;
    const bodyWidth = 240;
    const totalWidth = bodyWidth + portPinLen * 2;

    let cellId = 2;
    const cells: string[] = [];

    // Helper functions
    function esc(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function nextId(): number {
        return cellId++;
    }

    // Group container
    const groupId = nextId();
    cells.push(
        `<mxCell id="${groupId}" value="" style="group" vertex="1" connectable="0" parent="1">` +
        `<mxGeometry x="100" y="100" width="${totalWidth}" height="${bodyHeight}" as="geometry"/></mxCell>`
    );

    // Module body rectangle
    const bodyId = nextId();
    cells.push(
        `<mxCell id="${bodyId}" value="${esc(info.name)}" ` +
        `style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;` +
        `fontStyle=1;fontSize=14;verticalAlign=top;spacingTop=8;" ` +
        `vertex="1" parent="${groupId}">` +
        `<mxGeometry x="${portPinLen}" y="0" width="${bodyWidth}" height="${bodyHeight}" as="geometry"/></mxCell>`
    );

    // Input ports (left side)
    inputs.forEach((port, i) => {
        const y = headerHeight + i * portHeight;
        const label = port.width > 1 ? `${port.name} [${port.width - 1}:0]` : port.name;

        // Port label inside body
        const labelId = nextId();
        cells.push(
            `<mxCell id="${labelId}" value="${esc(label)}" ` +
            `style="text;html=1;align=left;verticalAlign=middle;resizable=0;points=[];` +
            `autosize=1;strokeColor=none;fillColor=none;fontSize=11;" ` +
            `vertex="1" parent="${groupId}">` +
            `<mxGeometry x="${portPinLen + 8}" y="${y}" width="${portTextWidth}" height="${portHeight}" as="geometry"/></mxCell>`
        );

        // Pin line (arrow coming in from left)
        const pinId = nextId();
        const arrowStyle = port.width > 1
            ? 'endArrow=block;endFill=1;strokeWidth=3;strokeColor=#0000FF;'
            : 'endArrow=block;endFill=1;strokeWidth=1;strokeColor=#000000;';
        cells.push(
            `<mxCell id="${pinId}" value="" style="${arrowStyle}" edge="1" parent="${groupId}">` +
            `<mxGeometry relative="1" as="geometry">` +
            `<mxPoint x="0" y="${y + portHeight / 2}" as="sourcePoint"/>` +
            `<mxPoint x="${portPinLen}" y="${y + portHeight / 2}" as="targetPoint"/>` +
            `</mxGeometry></mxCell>`
        );
    });

    // Output ports (right side)
    outputs.forEach((port, i) => {
        const y = headerHeight + i * portHeight;
        const label = port.width > 1 ? `${port.name} [${port.width - 1}:0]` : port.name;

        // Port label inside body
        const labelId = nextId();
        cells.push(
            `<mxCell id="${labelId}" value="${esc(label)}" ` +
            `style="text;html=1;align=right;verticalAlign=middle;resizable=0;points=[];` +
            `autosize=1;strokeColor=none;fillColor=none;fontSize=11;" ` +
            `vertex="1" parent="${groupId}">` +
            `<mxGeometry x="${portPinLen + bodyWidth - portTextWidth - 8}" y="${y}" width="${portTextWidth}" height="${portHeight}" as="geometry"/></mxCell>`
        );

        // Pin line (arrow going out to right)
        const pinId = nextId();
        const arrowStyle = port.width > 1
            ? 'endArrow=block;endFill=1;strokeWidth=3;strokeColor=#0000FF;'
            : 'endArrow=block;endFill=1;strokeWidth=1;strokeColor=#000000;';
        cells.push(
            `<mxCell id="${pinId}" value="" style="${arrowStyle}" edge="1" parent="${groupId}">` +
            `<mxGeometry relative="1" as="geometry">` +
            `<mxPoint x="${portPinLen + bodyWidth}" y="${y + portHeight / 2}" as="sourcePoint"/>` +
            `<mxPoint x="${totalWidth}" y="${y + portHeight / 2}" as="targetPoint"/>` +
            `</mxGeometry></mxCell>`
        );
    });

    // Inout ports (bottom)
    inouts.forEach((port, i) => {
        const x = portPinLen + 40 + i * (portTextWidth + 10);
        const y = bodyHeight;
        const label = port.width > 1 ? `${port.name} [${port.width - 1}:0]` : port.name;

        const labelId = nextId();
        cells.push(
            `<mxCell id="${labelId}" value="${esc(label)}" ` +
            `style="text;html=1;align=center;verticalAlign=top;fontSize=11;strokeColor=none;fillColor=none;" ` +
            `vertex="1" parent="${groupId}">` +
            `<mxGeometry x="${x - 40}" y="${y + 20}" width="${portTextWidth}" height="${portHeight}" as="geometry"/></mxCell>`
        );

        const pinId = nextId();
        cells.push(
            `<mxCell id="${pinId}" value="" style="endArrow=block;endFill=1;startArrow=block;startFill=1;strokeWidth=2;strokeColor=#CC0000;" edge="1" parent="${groupId}">` +
            `<mxGeometry relative="1" as="geometry">` +
            `<mxPoint x="${x}" y="${bodyHeight}" as="sourcePoint"/>` +
            `<mxPoint x="${x}" y="${bodyHeight + 30}" as="targetPoint"/>` +
            `</mxGeometry></mxCell>`
        );
    });

    // Parameters annotation (top-right)
    if (info.parameters && info.parameters.length > 0) {
        const paramText = info.parameters.map(p => `${p.name}=${p.value}`).join(', ');
        const paramId = nextId();
        cells.push(
            `<mxCell id="${paramId}" value="#(${esc(paramText)})" ` +
            `style="text;html=1;align=right;verticalAlign=bottom;fontSize=10;fontColor=#666666;` +
            `fontStyle=2;strokeColor=none;fillColor=none;" ` +
            `vertex="1" parent="${groupId}">` +
            `<mxGeometry x="${portPinLen}" y="-24" width="${bodyWidth}" height="20" as="geometry"/></mxCell>`
        );
    }

    return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel>`;
}
