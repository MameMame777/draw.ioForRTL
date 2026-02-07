import type { RawTable, RawTableRow } from '../types/types';

/**
 * TruthTableParser — parses CSV or Markdown table text into a RawTable.
 *
 * Values are kept as-is (strings). No type conversion is performed.
 * The separator between input columns and output columns is an empty column header.
 *
 * CSV example:
 *   a,b,,y,z
 *   0x000,2,,"d",1
 *
 * Markdown example:
 *   | a | b | | y | z |
 *   |---|---|---|---|---|
 *   | 0 | 1 | | d | 1 |
 */
export class TruthTableParser {

    /**
     * Auto-detect format (CSV or Markdown) and parse.
     */
    public static parse(text: string): RawTable {
        const trimmed = text.trim();
        if (trimmed.includes('|')) {
            return TruthTableParser.parseMarkdown(trimmed);
        }
        return TruthTableParser.parseCSV(trimmed);
    }

    /**
     * Parse CSV text into a RawTable.
     * Handles RFC 4180 quoted fields (e.g. """d""" → "d").
     */
    public static parseCSV(text: string): RawTable {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) {
            throw new Error('CSV must have at least a header row and one data row.');
        }

        const headerCells = TruthTableParser.parseCSVRow(lines[0]);
        const { inputs, outputs, separatorIndices } = TruthTableParser.splitColumns(headerCells);

        const rows: RawTableRow[] = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = TruthTableParser.parseCSVRow(lines[i]);
            const row = TruthTableParser.buildRow(cells, inputs.length, outputs.length, separatorIndices);
            rows.push(row);
        }

        return { inputs, outputs, rows };
    }

    /**
     * Parse Markdown table text into a RawTable.
     */
    public static parseMarkdown(text: string): RawTable {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) {
            throw new Error('Markdown table must have at least a header row and one data row.');
        }

        const headerCells = TruthTableParser.parseMarkdownRow(lines[0]);
        const { inputs, outputs, separatorIndices } = TruthTableParser.splitColumns(headerCells);

        const rows: RawTableRow[] = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            // Skip separator rows like |---|---|---|
            if (/^\|[\s\-:|]+\|$/.test(line)) {
                continue;
            }
            const cells = TruthTableParser.parseMarkdownRow(line);
            const row = TruthTableParser.buildRow(cells, inputs.length, outputs.length, separatorIndices);
            rows.push(row);
        }

        if (rows.length === 0) {
            throw new Error('No data rows found in Markdown table.');
        }

        return { inputs, outputs, rows };
    }

    /**
     * Convert a RawTable back to CSV text.
     */
    public static toCSV(table: RawTable): string {
        const header = [...table.inputs, '', ...table.outputs].join(',');
        const dataRows = table.rows.map(row =>
            [...row.inputs, '', ...row.outputs].join(',')
        );
        return [header, ...dataRows].join('\n');
    }

    /**
     * Parse a CSV row handling RFC 4180 quoted fields.
     * e.g.  a,"""d""",1  →  ["a", "d", "1"]
     */
    private static parseCSVRow(line: string): string[] {
        const cells: string[] = [];
        let i = 0;
        while (i <= line.length) {
            if (i === line.length) {
                cells.push('');
                break;
            }
            if (line[i] === '"') {
                // Quoted field
                let value = '';
                i++; // skip opening quote
                while (i < line.length) {
                    if (line[i] === '"') {
                        if (i + 1 < line.length && line[i + 1] === '"') {
                            value += '"';
                            i += 2;
                        } else {
                            i++;
                            break;
                        }
                    } else {
                        value += line[i];
                        i++;
                    }
                }
                cells.push(value.trim());
                if (i < line.length && line[i] === ',') { i++; }
            } else {
                const commaIdx = line.indexOf(',', i);
                if (commaIdx === -1) {
                    cells.push(line.substring(i).trim());
                    break;
                } else {
                    cells.push(line.substring(i, commaIdx).trim());
                    i = commaIdx + 1;
                }
            }
        }
        return cells;
    }

    /**
     * Parse a single Markdown table row into cell values.
     */
    private static parseMarkdownRow(line: string): string[] {
        let trimmed = line.trim();
        if (trimmed.startsWith('|')) { trimmed = trimmed.substring(1); }
        if (trimmed.endsWith('|')) { trimmed = trimmed.substring(0, trimmed.length - 1); }
        return trimmed.split('|').map(c => c.trim());
    }

    /**
     * Split header cells into input names and output names
     * using empty column(s) as separator.
     */
    private static splitColumns(headerCells: string[]): {
        inputs: string[];
        outputs: string[];
        separatorIndices: Set<number>;
    } {
        const separatorIndices = new Set<number>();
        let firstSepIdx = -1;
        for (let i = 0; i < headerCells.length; i++) {
            if (headerCells[i] === '') {
                separatorIndices.add(i);
                if (firstSepIdx === -1) { firstSepIdx = i; }
            }
        }

        if (firstSepIdx === -1) {
            throw new Error(
                'No separator column found. Use an empty column header to separate inputs from outputs.\n' +
                'CSV example: a,b,,y,z\n' +
                'Markdown example: | a | b | | y | z |'
            );
        }

        const inputs: string[] = [];
        const outputs: string[] = [];
        for (let i = 0; i < headerCells.length; i++) {
            if (separatorIndices.has(i)) { continue; }
            if (i < firstSepIdx) {
                inputs.push(headerCells[i]);
            } else {
                outputs.push(headerCells[i]);
            }
        }

        if (inputs.length === 0) {
            throw new Error('No input columns found before the separator.');
        }
        if (outputs.length === 0) {
            throw new Error('No output columns found after the separator.');
        }

        return { inputs, outputs, separatorIndices };
    }

    /**
     * Build a RawTableRow from raw cell values, skipping separator columns.
     */
    private static buildRow(
        cells: string[],
        numInputs: number,
        numOutputs: number,
        separatorIndices: Set<number>,
    ): RawTableRow {
        const values: string[] = [];
        for (let i = 0; i < cells.length; i++) {
            if (separatorIndices.has(i)) { continue; }
            values.push(cells[i]);
        }

        const expectedCount = numInputs + numOutputs;
        if (values.length < expectedCount) {
            throw new Error(
                `Row has ${values.length} value(s) but expected ${expectedCount} ` +
                `(${numInputs} inputs + ${numOutputs} outputs).`
            );
        }

        return {
            inputs: values.slice(0, numInputs),
            outputs: values.slice(numInputs, numInputs + numOutputs),
        };
    }
}
