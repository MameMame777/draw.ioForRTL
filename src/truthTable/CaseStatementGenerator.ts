import type { TruthTable, RawTable } from '../types/types';

/**
 * CaseStatementGenerator — generates SystemVerilog case statements.
 */
export class CaseStatementGenerator {

    /**
     * Generate from a boolean-based TruthTable (from expressions).
     */
    public static generate(table: TruthTable): string {
        const raw: RawTable = {
            inputs: table.inputs,
            outputs: table.outputs,
            rows: table.rows.map(row => ({
                inputs: row.inputs.map(v => v === null ? 'x' : v ? '1' : '0'),
                outputs: row.outputs.map(v => v === null ? 'x' : v ? '1' : '0'),
            })),
        };
        return CaseStatementGenerator.generateFromRaw(raw);
    }

    /**
     * Generate from a string-based RawTable (from CSV/Markdown).
     */
    public static generateFromRaw(table: RawTable): string {
        const inputConcat = table.inputs.length === 1
            ? table.inputs[0]
            : `{${table.inputs.join(', ')}}`;

        const lines: string[] = [];
        lines.push('always_comb begin');
        lines.push(`    case (${inputConcat})`);

        const seen = new Set<string>();

        for (const row of table.rows) {
            const key = row.inputs.join(',');
            if (seen.has(key)) { continue; }
            seen.add(key);

            const patternStr = row.inputs.join(', ');
            const assignments = row.outputs.map((val, i) =>
                `${table.outputs[i]} = ${val};`
            );

            if (assignments.length === 1) {
                lines.push(`        ${patternStr}: ${assignments[0]}`);
            } else {
                lines.push(`        ${patternStr}: begin`);
                for (const a of assignments) {
                    lines.push(`            ${a}`);
                }
                lines.push('        end');
            }
        }

        // default clause
        const defaultAssignments = table.outputs.map(name => `${name} = 1'bx;`);
        if (defaultAssignments.length === 1) {
            lines.push(`        default: ${defaultAssignments[0]}`);
        } else {
            lines.push('        default: begin');
            for (const a of defaultAssignments) {
                lines.push(`            ${a}`);
            }
            lines.push('        end');
        }

        lines.push('    endcase');
        lines.push('end');

        return lines.join('\n');
    }
}
