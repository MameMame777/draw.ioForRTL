import type { TruthTable } from '../types/types';

/**
 * TruthTableRenderer — converts a TruthTable to draw.io mxGraph XML.
 * 
 * Generates a table shape with:
 * - Header row: input names (blue) + output names (green)
 * - Data rows: 0/1 values with alternating background
 */
export class TruthTableRenderer {
    private static readonly INPUT_HEADER_STYLE =
        'fillColor=#264f78;fontColor=#ffffff;fontStyle=1;align=center;fontSize=12;fontFamily=Cascadia Code;';
    private static readonly OUTPUT_HEADER_STYLE =
        'fillColor=#2d5a27;fontColor=#ffffff;fontStyle=1;align=center;fontSize=12;fontFamily=Cascadia Code;';
    private static readonly CELL_STYLE_EVEN =
        'fillColor=#f5f5f5;fontColor=#333333;align=center;fontSize=11;fontFamily=Cascadia Code;';
    private static readonly CELL_STYLE_ODD =
        'fillColor=#ffffff;fontColor=#333333;align=center;fontSize=11;fontFamily=Cascadia Code;';
    private static readonly CELL_WIDTH = 60;
    private static readonly CELL_HEIGHT = 28;
    private static readonly HEADER_HEIGHT = 32;

    /**
     * Render a truth table as draw.io mxGraphModel XML for insertion via merge action.
     */
    public renderToDrawioXml(table: TruthTable): string {
        const totalCols = table.inputs.length + table.outputs.length;
        const totalRows = table.rows.length + 1; // +1 for header
        const width = totalCols * TruthTableRenderer.CELL_WIDTH;
        const height = TruthTableRenderer.HEADER_HEIGHT + table.rows.length * TruthTableRenderer.CELL_HEIGHT;

        let cellId = 100; // Start at high ID to avoid conflicts
        const cells: string[] = [];

        // Parent group cell
        const groupId = cellId++;
        cells.push(
            `<mxCell id="${groupId}" value="" style="group;rounded=1;strokeColor=#666666;` +
            `fillColor=none;" vertex="1" parent="1">` +
            `<mxGeometry x="100" y="100" width="${width}" height="${height}" as="geometry"/>` +
            `</mxCell>`
        );

        // Title row (optional)
        const titleId = cellId++;
        const titleText = this.buildTitleText(table);
        cells.push(
            `<mxCell id="${titleId}" value="${this.escapeXml(titleText)}" ` +
            `style="text;html=1;align=center;verticalAlign=middle;fontSize=14;fontStyle=1;` +
            `fontFamily=Cascadia Code;fillColor=none;strokeColor=none;" ` +
            `vertex="1" parent="1">` +
            `<mxGeometry x="100" y="65" width="${width}" height="30" as="geometry"/>` +
            `</mxCell>`
        );

        // Header cells
        let col = 0;
        for (const inputName of table.inputs) {
            const id = cellId++;
            const x = col * TruthTableRenderer.CELL_WIDTH;
            cells.push(
                `<mxCell id="${id}" value="${this.escapeXml(inputName)}" ` +
                `style="${TruthTableRenderer.INPUT_HEADER_STYLE}rounded=0;strokeColor=#1a3a5c;" ` +
                `vertex="1" parent="${groupId}">` +
                `<mxGeometry x="${x}" y="0" ` +
                `width="${TruthTableRenderer.CELL_WIDTH}" height="${TruthTableRenderer.HEADER_HEIGHT}" ` +
                `as="geometry"/>` +
                `</mxCell>`
            );
            col++;
        }
        for (const outputName of table.outputs) {
            const id = cellId++;
            const x = col * TruthTableRenderer.CELL_WIDTH;
            cells.push(
                `<mxCell id="${id}" value="${this.escapeXml(outputName)}" ` +
                `style="${TruthTableRenderer.OUTPUT_HEADER_STYLE}rounded=0;strokeColor=#1d4a1a;" ` +
                `vertex="1" parent="${groupId}">` +
                `<mxGeometry x="${x}" y="0" ` +
                `width="${TruthTableRenderer.CELL_WIDTH}" height="${TruthTableRenderer.HEADER_HEIGHT}" ` +
                `as="geometry"/>` +
                `</mxCell>`
            );
            col++;
        }

        // Data rows
        for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
            const row = table.rows[rowIdx];
            const y = TruthTableRenderer.HEADER_HEIGHT + rowIdx * TruthTableRenderer.CELL_HEIGHT;
            const style = rowIdx % 2 === 0
                ? TruthTableRenderer.CELL_STYLE_EVEN
                : TruthTableRenderer.CELL_STYLE_ODD;

            col = 0;
            // Input values
            for (const val of row.inputs) {
                const id = cellId++;
                const x = col * TruthTableRenderer.CELL_WIDTH;
                cells.push(
                    `<mxCell id="${id}" value="${val ? '1' : '0'}" ` +
                    `style="${style}rounded=0;strokeColor=#cccccc;" ` +
                    `vertex="1" parent="${groupId}">` +
                    `<mxGeometry x="${x}" y="${y}" ` +
                    `width="${TruthTableRenderer.CELL_WIDTH}" height="${TruthTableRenderer.CELL_HEIGHT}" ` +
                    `as="geometry"/>` +
                    `</mxCell>`
                );
                col++;
            }
            // Output values
            for (const val of row.outputs) {
                const id = cellId++;
                const x = col * TruthTableRenderer.CELL_WIDTH;
                const highlightStyle = val
                    ? style + 'fontColor=#2d5a27;fontStyle=1;'
                    : style;
                cells.push(
                    `<mxCell id="${id}" value="${val ? '1' : '0'}" ` +
                    `style="${highlightStyle}rounded=0;strokeColor=#cccccc;" ` +
                    `vertex="1" parent="${groupId}">` +
                    `<mxGeometry x="${x}" y="${y}" ` +
                    `width="${TruthTableRenderer.CELL_WIDTH}" height="${TruthTableRenderer.CELL_HEIGHT}" ` +
                    `as="geometry"/>` +
                    `</mxCell>`
                );
                col++;
            }
        }

        return '<mxGraphModel><root>' +
            '<mxCell id="0"/>' +
            '<mxCell id="1" parent="0"/>' +
            cells.join('\n') +
            '</root></mxGraphModel>';
    }

    private buildTitleText(table: TruthTable): string {
        return `Truth Table (${table.inputs.join(', ')} → ${table.outputs.join(', ')})`;
    }

    private escapeXml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}
