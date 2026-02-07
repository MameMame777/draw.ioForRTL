/**
 * ModuleHierarchyParser — Scans workspace HDL files, extracts module definitions
 * and instantiation relationships, and builds a hierarchy tree.
 */

import * as vscode from 'vscode';
import {
    HierarchyPort,
    HierarchyParam,
    ModuleDefinition,
    ModuleInstantiation,
    PortConnection,
    HierarchyNode,
} from '../types/types';

/** Verilog/SystemVerilog keywords that cannot be module instantiation names */
const HDL_KEYWORDS = new Set([
    'module', 'endmodule', 'input', 'output', 'inout',
    'reg', 'wire', 'logic', 'integer', 'real', 'time', 'realtime',
    'assign', 'always', 'always_ff', 'always_comb', 'always_latch',
    'initial', 'generate', 'endgenerate', 'genvar',
    'if', 'else', 'for', 'while', 'case', 'casex', 'casez', 'endcase',
    'begin', 'end', 'function', 'endfunction', 'task', 'endtask',
    'parameter', 'localparam', 'typedef', 'enum', 'struct', 'union',
    'class', 'endclass', 'interface', 'endinterface',
    'package', 'endpackage', 'import', 'export',
    'defparam', 'specify', 'endspecify',
    'property', 'endproperty', 'assert', 'assume', 'cover',
    'sequence', 'endsequence', 'program', 'endprogram',
    'primitive', 'endprimitive', 'table', 'endtable',
    'supply0', 'supply1', 'tri', 'tri0', 'tri1', 'triand', 'trior', 'trireg',
    'wand', 'wor', 'signed', 'unsigned',
    'return', 'break', 'continue', 'do', 'foreach', 'repeat', 'forever',
    'wait', 'disable', 'force', 'release', 'fork', 'join', 'join_any', 'join_none',
    'bit', 'byte', 'shortint', 'int', 'longint', 'shortreal', 'string', 'void',
    'chandle', 'event', 'virtual', 'automatic', 'static',
    'const', 'ref', 'var', 'new', 'null', 'this', 'super', 'extends', 'implements',
    'type', 'rand', 'randc', 'constraint', 'covergroup', 'endgroup',
]);

const MAX_HIERARCHY_DEPTH = 20;

export class ModuleHierarchyParser {

    /**
     * Scan the workspace for all .v/.sv files and parse module definitions.
     */
    async scanWorkspace(
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken,
    ): Promise<Map<string, ModuleDefinition>> {
        const definitions = new Map<string, ModuleDefinition>();

        const files = await vscode.workspace.findFiles('**/*.{v,sv}', '**/node_modules/**', 500);
        if (files.length === 0) {
            return definitions;
        }

        const increment = 100 / files.length;

        for (const fileUri of files) {
            if (token?.isCancellationRequested) { break; }

            progress?.report({
                message: vscode.workspace.asRelativePath(fileUri),
                increment,
            });

            try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                const parsed = this.parseFile(doc.getText(), fileUri.fsPath);
                for (const mod of parsed) {
                    if (!definitions.has(mod.name)) {
                        definitions.set(mod.name, mod);
                    }
                }
            } catch {
                // Skip files that cannot be read
            }
        }

        return definitions;
    }

    /**
     * Parse a single HDL source file. Returns all module definitions found.
     */
    parseFile(source: string, filePath: string): ModuleDefinition[] {
        const stripped = this.stripComments(source);
        const modules: ModuleDefinition[] = [];

        // Find module...endmodule boundaries
        const moduleRegex = /\bmodule\s+(\w+)/g;
        let match: RegExpExecArray | null;

        while ((match = moduleRegex.exec(stripped)) !== null) {
            const moduleName = match[1];
            const startIdx = match.index;

            // Find matching endmodule
            const endIdx = this.findEndmodule(stripped, startIdx);
            if (endIdx < 0) { continue; }

            const moduleBody = stripped.substring(startIdx, endIdx);

            const ports = this.extractPorts(moduleBody);
            const parameters = this.extractParameters(moduleBody);
            const instantiations = this.extractInstantiations(moduleBody);

            modules.push({
                name: moduleName,
                filePath,
                ports,
                parameters,
                instantiations,
            });
        }

        return modules;
    }

    /**
     * Build a hierarchy tree from the top module down.
     */
    buildHierarchy(
        topModule: string,
        definitions: Map<string, ModuleDefinition>,
    ): HierarchyNode {
        const visited = new Set<string>();
        return this.buildNode(topModule, topModule, definitions, visited, 0);
    }

    private buildNode(
        moduleName: string,
        instanceName: string,
        definitions: Map<string, ModuleDefinition>,
        visited: Set<string>,
        depth: number,
    ): HierarchyNode {
        const def = definitions.get(moduleName) ?? null;

        const node: HierarchyNode = {
            moduleName,
            instanceName,
            definition: def,
            children: [],
        };

        if (!def || depth >= MAX_HIERARCHY_DEPTH || visited.has(moduleName)) {
            return node;
        }

        visited.add(moduleName);

        for (const inst of def.instantiations) {
            const child = this.buildNode(
                inst.moduleName,
                inst.instanceName,
                definitions,
                visited,
                depth + 1,
            );
            node.children.push(child);
        }

        visited.delete(moduleName);
        return node;
    }

    // ---------------------------------------------------------------
    // Comment stripping
    // ---------------------------------------------------------------

    private stripComments(source: string): string {
        // Remove block comments then line comments
        let result = source.replace(/\/\*[\s\S]*?\*\//g, match =>
            match.replace(/[^\n]/g, ' '));
        result = result.replace(/\/\/[^\n]*/g, '');
        return result;
    }

    // ---------------------------------------------------------------
    // Find endmodule
    // ---------------------------------------------------------------

    private findEndmodule(source: string, startIdx: number): number {
        const endRegex = /\bendmodule\b/g;
        endRegex.lastIndex = startIdx;
        const m = endRegex.exec(source);
        return m ? m.index + m[0].length : -1;
    }

    // ---------------------------------------------------------------
    // Port extraction
    // ---------------------------------------------------------------

    private extractPorts(moduleBody: string): HierarchyPort[] {
        const ports: HierarchyPort[] = [];
        const portRegex =
            /^\s*(input|output|inout)\s+(?:(?:reg|wire|logic|signed|unsigned)\s+)*(?:\[([^\]]+)\])?\s*(\w+)/gm;
        let m: RegExpExecArray | null;

        while ((m = portRegex.exec(moduleBody)) !== null) {
            const direction = m[1] as HierarchyPort['direction'];
            const widthStr = m[2];
            const name = m[3];
            let width = 1;
            let widthExpr: string | undefined;

            if (widthStr) {
                widthExpr = widthStr;
                const parts = widthStr.split(':');
                if (parts.length === 2) {
                    const msb = parseInt(parts[0].trim(), 10);
                    const lsb = parseInt(parts[1].trim(), 10);
                    width = !isNaN(msb) && !isNaN(lsb)
                        ? Math.abs(msb - lsb) + 1
                        : 8;
                }
            }

            ports.push({ name, direction, width, widthExpr });
        }

        return ports;
    }

    // ---------------------------------------------------------------
    // Parameter extraction
    // ---------------------------------------------------------------

    private extractParameters(moduleBody: string): HierarchyParam[] {
        const params: HierarchyParam[] = [];
        const paramRegex = /^\s*(?:parameter|localparam)\s+(?:\w+\s+)?(\w+)\s*=\s*([^,;\/]+)/gm;
        let m: RegExpExecArray | null;

        while ((m = paramRegex.exec(moduleBody)) !== null) {
            params.push({ name: m[1], defaultValue: m[2].trim() });
        }

        return params;
    }

    // ---------------------------------------------------------------
    // Instantiation extraction
    // ---------------------------------------------------------------

    /**
     * Extract module instantiations from a module body.
     *
     * Pattern:  <module_type> [#(...)] <instance_name> (...);
     *
     * Strategy: scan for identifiers that are NOT keywords, then check
     * if they are followed by optional #(...) and then identifier (...);
     */
    private extractInstantiations(moduleBody: string): ModuleInstantiation[] {
        const instantiations: ModuleInstantiation[] = [];

        // We use a statement-based approach: split on semicolons and analyze each statement
        const statements = this.splitStatements(moduleBody);

        for (const stmt of statements) {
            const inst = this.parseInstantiationStatement(stmt);
            if (inst) {
                instantiations.push(inst);
            }
        }

        return instantiations;
    }

    /**
     * Split the module body into semicolon-terminated statements,
     * respecting parenthesis nesting.
     */
    private splitStatements(body: string): string[] {
        const statements: string[] = [];
        let current = '';
        let parenDepth = 0;

        for (let i = 0; i < body.length; i++) {
            const ch = body[i];
            if (ch === '(') { parenDepth++; }
            else if (ch === ')') { parenDepth = Math.max(0, parenDepth - 1); }

            current += ch;

            if (ch === ';' && parenDepth === 0) {
                statements.push(current.trim());
                current = '';
            }
        }

        return statements;
    }

    /**
     * Try to parse a single statement as a module instantiation.
     * Returns null if not an instantiation.
     */
    private parseInstantiationStatement(stmt: string): ModuleInstantiation | null {
        // Trim and normalize whitespace
        const s = stmt.replace(/\s+/g, ' ').trim();

        // Must match: IDENTIFIER [#(...)]] IDENTIFIER (...);
        // First, extract the leading identifier (module type name)
        const leadMatch = s.match(/^(\w+)\s*/);
        if (!leadMatch) { return null; }

        const moduleName = leadMatch[1];

        // Skip keywords
        if (HDL_KEYWORDS.has(moduleName)) { return null; }

        let rest = s.substring(leadMatch[0].length);

        // Optional parameter overrides: #(...)
        let paramOverrides: { name: string; value: string }[] = [];
        if (rest.startsWith('#')) {
            rest = rest.substring(1).trimStart();
            if (!rest.startsWith('(')) { return null; }
            const paramBlock = this.extractBalancedParens(rest);
            if (!paramBlock) { return null; }
            paramOverrides = this.parseParamOverrides(paramBlock.inner);
            rest = paramBlock.remaining.trimStart();
        }

        // Instance name
        const instMatch = rest.match(/^(\w+)\s*/);
        if (!instMatch) { return null; }
        const instanceName = instMatch[1];

        // Skip if instance name is a keyword
        if (HDL_KEYWORDS.has(instanceName)) { return null; }

        rest = rest.substring(instMatch[0].length).trimStart();

        // Skip optional array range [N:M]
        if (rest.startsWith('[')) {
            const bracketEnd = rest.indexOf(']');
            if (bracketEnd < 0) { return null; }
            rest = rest.substring(bracketEnd + 1).trimStart();
        }

        // Port connections: (...)
        if (!rest.startsWith('(')) { return null; }
        const portBlock = this.extractBalancedParens(rest);
        if (!portBlock) { return null; }

        // Remaining should be just ; or empty
        const trailing = portBlock.remaining.trim();
        if (trailing !== '' && trailing !== ';') { return null; }

        const portConnections = this.parsePortConnections(portBlock.inner);

        return {
            moduleName,
            instanceName,
            paramOverrides,
            portConnections,
        };
    }

    /**
     * Extract the content inside balanced parentheses.
     * Input must start with '('.
     * Returns { inner: "content inside parens", remaining: "rest of string" }
     */
    private extractBalancedParens(s: string): { inner: string; remaining: string } | null {
        if (s[0] !== '(') { return null; }

        let depth = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i] === '(') { depth++; }
            else if (s[i] === ')') {
                depth--;
                if (depth === 0) {
                    return {
                        inner: s.substring(1, i),
                        remaining: s.substring(i + 1),
                    };
                }
            }
        }

        return null; // Unbalanced
    }

    /**
     * Parse parameter override list: .PARAM(value), .PARAM2(value)
     */
    private parseParamOverrides(inner: string): { name: string; value: string }[] {
        const overrides: { name: string; value: string }[] = [];
        const regex = /\.(\w+)\s*\(([^)]*)\)/g;
        let m: RegExpExecArray | null;

        while ((m = regex.exec(inner)) !== null) {
            overrides.push({ name: m[1], value: m[2].trim() });
        }

        return overrides;
    }

    /**
     * Parse port connection list. Handles both named and positional connections.
     */
    private parsePortConnections(inner: string): PortConnection[] {
        const connections: PortConnection[] = [];

        // Check if named connections (.port(signal)) are used
        if (inner.includes('.')) {
            // Named connections — use balanced paren parsing for each .port(...)
            const namedRegex = /\.(\w+)\s*\(/g;
            let m: RegExpExecArray | null;

            while ((m = namedRegex.exec(inner)) !== null) {
                const portName = m[1];
                const startParen = m.index + m[0].length - 1; // index of '('
                const block = this.extractBalancedParens(inner.substring(startParen));
                if (block) {
                    connections.push({
                        portName,
                        signalExpr: block.inner.trim(),
                    });
                }
            }
        } else {
            // Positional connections
            const parts = this.splitTopLevel(inner, ',');
            parts.forEach((part, i) => {
                const trimmed = part.trim();
                if (trimmed) {
                    connections.push({
                        portName: `[${i}]`,
                        signalExpr: trimmed,
                    });
                }
            });
        }

        return connections;
    }

    /**
     * Split a string by a delimiter, respecting parentheses nesting.
     */
    private splitTopLevel(s: string, delimiter: string): string[] {
        const parts: string[] = [];
        let current = '';
        let depth = 0;

        for (const ch of s) {
            if (ch === '(' || ch === '[' || ch === '{') { depth++; }
            else if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); }

            if (ch === delimiter && depth === 0) {
                parts.push(current);
                current = '';
            } else {
                current += ch;
            }
        }

        if (current.trim()) {
            parts.push(current);
        }

        return parts;
    }
}
