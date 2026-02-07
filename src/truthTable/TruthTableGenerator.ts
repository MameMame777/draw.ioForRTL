import type { TruthTable, TruthTableOutput, TruthTableRow } from '../types/types';

/**
 * TruthTableGenerator — generates truth tables from boolean expressions.
 * 
 * Supports:
 *   NOT: ~ or !
 *   AND: & or &&
 *   OR:  | or ||
 *   XOR: ^
 *   Parentheses: ()
 */
export class TruthTableGenerator {
    /**
     * Parse output expressions from user input string.
     * Format: "y = a & b, z = a | ~b"
     * 
     * Splits on commas that separate `name = expr` pairs.
     * Commas inside parentheses are preserved. Bare values
     * without `=` (like "1") are auto-named (F0, F1, ...).
     */
    public static parseOutputExpressions(input: string): TruthTableOutput[] {
        // Split on commas, but respect parentheses depth
        const parts: string[] = [];
        let depth = 0;
        let current = '';
        for (const ch of input) {
            if (ch === '(') { depth++; }
            if (ch === ')') { depth--; }
            if (ch === ',' && depth === 0) {
                parts.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) {
            parts.push(current.trim());
        }

        // Now merge parts that look like bare values back into
        // the previous expression (e.g. "y = func(a, b)" split on inner comma)
        const merged: string[] = [];
        for (const part of parts) {
            if (merged.length > 0 && !part.includes('=')) {
                // Could be a continuation of the previous expression
                // Check if previous part has an '=' — if so, append
                const prev = merged[merged.length - 1];
                if (prev.includes('=')) {
                    merged[merged.length - 1] = prev + ', ' + part;
                    continue;
                }
            }
            merged.push(part);
        }

        let autoIndex = 0;
        return merged.map(trimmed => {
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) {
                // No '=' found — treat as expression with auto-generated name
                if (!trimmed) {
                    throw new Error('Empty expression found.');
                }
                const name = `F${autoIndex++}`;
                return { name, expression: trimmed };
            }
            const name = trimmed.substring(0, eqIndex).trim();
            const expression = trimmed.substring(eqIndex + 1).trim();
            if (!name || !expression) {
                throw new Error(`Invalid expression "${trimmed}". Name and expression are required.`);
            }
            return { name, expression };
        });
    }

    /**
     * Generate a complete truth table for given inputs and output expressions.
     */
    public static generate(inputs: string[], outputs: TruthTableOutput[]): TruthTable {
        const numRows = Math.pow(2, inputs.length);
        const rows: TruthTableRow[] = [];

        for (let i = 0; i < numRows; i++) {
            const inputValues: boolean[] = [];
            for (let bit = inputs.length - 1; bit >= 0; bit--) {
                inputValues.push(((i >> bit) & 1) === 1);
            }

            // Build variable map
            const vars = new Map<string, boolean>();
            inputs.forEach((name, idx) => {
                vars.set(name, inputValues[idx]);
            });

            // Evaluate each output expression
            const outputValues = outputs.map(out => {
                return TruthTableGenerator.evaluate(out.expression, vars);
            });

            rows.push({
                inputs: inputValues,
                outputs: outputValues,
            });
        }

        return {
            inputs,
            outputs: outputs.map(o => o.name),
            rows,
        };
    }

    /**
     * Evaluate a boolean expression with given variable values.
     * 
     * Grammar (precedence low to high):
     *   expr    = orExpr
     *   orExpr  = xorExpr (('|' | '||') xorExpr)*
     *   xorExpr = andExpr ('^' andExpr)*
     *   andExpr = notExpr (('&' | '&&') notExpr)*
     *   notExpr = ('~' | '!') notExpr | primary
     *   primary = '(' expr ')' | identifier | '0' | '1'
     */
    public static evaluate(expression: string, vars: Map<string, boolean>): boolean {
        const tokens = TruthTableGenerator.tokenize(expression);
        const parser = new ExprParser(tokens, vars);
        const result = parser.parseOr();
        if (parser.position < tokens.length) {
            throw new Error(`Unexpected token: "${tokens[parser.position]}"`);
        }
        return result;
    }

    private static tokenize(expression: string): string[] {
        const tokens: string[] = [];
        let i = 0;
        while (i < expression.length) {
            const ch = expression[i];

            // Skip whitespace
            if (ch === ' ' || ch === '\t') {
                i++;
                continue;
            }

            // Operators
            if (ch === '(' || ch === ')' || ch === '~' || ch === '!' || ch === '^') {
                tokens.push(ch);
                i++;
                continue;
            }

            if (ch === '&') {
                if (i + 1 < expression.length && expression[i + 1] === '&') {
                    tokens.push('&&');
                    i += 2;
                } else {
                    tokens.push('&');
                    i++;
                }
                continue;
            }

            if (ch === '|') {
                if (i + 1 < expression.length && expression[i + 1] === '|') {
                    tokens.push('||');
                    i += 2;
                } else {
                    tokens.push('|');
                    i++;
                }
                continue;
            }

            // Identifiers and literals
            if (/[a-zA-Z_0-9]/.test(ch)) {
                let ident = '';
                while (i < expression.length && /[a-zA-Z_0-9]/.test(expression[i])) {
                    ident += expression[i];
                    i++;
                }
                tokens.push(ident);
                continue;
            }

            throw new Error(`Unexpected character in expression: "${ch}"`);
        }
        return tokens;
    }
}

class ExprParser {
    public position = 0;

    constructor(
        private readonly tokens: string[],
        private readonly vars: Map<string, boolean>
    ) {}

    public parseOr(): boolean {
        let left = this.parseXor();
        while (this.position < this.tokens.length &&
               (this.tokens[this.position] === '|' || this.tokens[this.position] === '||')) {
            this.position++;
            const right = this.parseXor();
            left = left || right;
        }
        return left;
    }

    private parseXor(): boolean {
        let left = this.parseAnd();
        while (this.position < this.tokens.length && this.tokens[this.position] === '^') {
            this.position++;
            const right = this.parseAnd();
            left = left !== right; // XOR
        }
        return left;
    }

    private parseAnd(): boolean {
        let left = this.parseNot();
        while (this.position < this.tokens.length &&
               (this.tokens[this.position] === '&' || this.tokens[this.position] === '&&')) {
            this.position++;
            const right = this.parseNot();
            left = left && right;
        }
        return left;
    }

    private parseNot(): boolean {
        if (this.position < this.tokens.length &&
            (this.tokens[this.position] === '~' || this.tokens[this.position] === '!')) {
            this.position++;
            return !this.parseNot();
        }
        return this.parsePrimary();
    }

    private parsePrimary(): boolean {
        if (this.position >= this.tokens.length) {
            throw new Error('Unexpected end of expression');
        }

        const token = this.tokens[this.position];

        // Parenthesized expression
        if (token === '(') {
            this.position++;
            const result = this.parseOr();
            if (this.position >= this.tokens.length || this.tokens[this.position] !== ')') {
                throw new Error('Missing closing parenthesis');
            }
            this.position++;
            return result;
        }

        // Literal 0 / 1
        if (token === '0') {
            this.position++;
            return false;
        }
        if (token === '1') {
            this.position++;
            return true;
        }

        // Variable
        if (this.vars.has(token)) {
            this.position++;
            return this.vars.get(token)!;
        }

        throw new Error(`Unknown variable: "${token}"`);
    }
}
