/**
 * HierarchyDiagramRenderer — Generates a multi-page draw.io <mxfile> document
 * from a module hierarchy tree.
 *
 * - Overview page: tree layout of the full hierarchy
 * - Detail pages: one per non-leaf module, showing instantiated sub-modules
 *   with port connections and drill-down links
 */

import {
    HierarchyNode,
    ModuleDefinition,
    ModuleInstantiation,
} from '../types/types';

/** Layout constants */
const GRID = 10;
const OVERVIEW_NODE_W = 160;
const OVERVIEW_NODE_H = 40;
const OVERVIEW_H_SPACING = 40;
const OVERVIEW_V_SPACING = 80;

const DETAIL_BLOCK_W = 220;
const DETAIL_BLOCK_MIN_H = 80;
const DETAIL_PORT_H = 22;
const DETAIL_H_SPACING = 100;
const DETAIL_V_SPACING = 100;
const DETAIL_COLS = 4;
const DETAIL_MARGIN = 60;
const DETAIL_NAV_H = 30;

/** Styles */
const STYLE = {
    overviewGreen: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=11;',
    overviewBlue: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=11;',
    overviewGray: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;fontStyle=0;fontSize=11;',
    overviewEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#666666;',
    detailBoundary: 'rounded=1;whiteSpace=wrap;html=1;dashed=1;dashPattern=8 4;fillColor=none;strokeColor=#666666;strokeWidth=2;fontSize=16;fontStyle=1;verticalAlign=top;spacingTop=12;',
    detailGreen: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=12;verticalAlign=top;spacingTop=8;',
    detailBlue: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=12;verticalAlign=top;spacingTop=8;',
    detailGray: 'rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;fontStyle=0;fontSize=12;verticalAlign=top;spacingTop=8;',
    detailPortLabel: 'text;html=1;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;fontSize=10;',
    detailEdge: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#333333;fontSize=9;',
    navBack: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=10;fontStyle=2;',
    navOverview: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=10;fontStyle=2;',
    title: 'text;html=1;align=center;fontSize=18;fontStyle=1;strokeColor=none;fillColor=none;',
};

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function snap(v: number): number {
    return Math.round(v / GRID) * GRID;
}

interface TreeLayoutNode {
    node: HierarchyNode;
    x: number;
    y: number;
    width: number;
}

export class HierarchyDiagramRenderer {

    /**
     * Render a full multi-page draw.io document.
     */
    renderHierarchyDiagram(
        root: HierarchyNode,
        definitions: Map<string, ModuleDefinition>,
    ): string {
        // Step 1: Assign page IDs to non-leaf nodes
        this.assignPageIds(root);

        // Step 2: Collect all non-leaf nodes (they get detail pages)
        const nonLeafNodes = this.collectNonLeafNodes(root);

        // Step 3: Build pages
        const pages: string[] = [];

        // Overview page
        pages.push(this.renderOverviewPage(root));

        // Detail pages
        for (const nlNode of nonLeafNodes) {
            const parentPageId = this.findParentPageId(root, nlNode.moduleName);
            pages.push(this.renderDetailPage(nlNode, definitions, parentPageId));
        }

        // Step 4: Assemble mxfile
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<mxfile host="VSCode" agent="DrawWave">',
            ...pages,
            '</mxfile>',
        ].join('\n');
    }

    // ---------------------------------------------------------------
    // Page ID assignment
    // ---------------------------------------------------------------

    private assignPageIds(node: HierarchyNode): void {
        if (node.children.length > 0) {
            node.pageId = `page_${node.moduleName}`;
        }
        for (const child of node.children) {
            this.assignPageIds(child);
        }
    }

    private collectNonLeafNodes(node: HierarchyNode): HierarchyNode[] {
        const result: HierarchyNode[] = [];
        if (node.children.length > 0) {
            result.push(node);
        }
        for (const child of node.children) {
            result.push(...this.collectNonLeafNodes(child));
        }
        // Deduplicate by moduleName (same module type appears once)
        const seen = new Set<string>();
        return result.filter(n => {
            if (seen.has(n.moduleName)) { return false; }
            seen.add(n.moduleName);
            return true;
        });
    }

    private findParentPageId(root: HierarchyNode, moduleName: string): string | undefined {
        // BFS to find which node's children contain the given module
        const queue: HierarchyNode[] = [root];
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const child of current.children) {
                if (child.moduleName === moduleName && child.moduleName !== current.moduleName) {
                    return current.pageId;
                }
                queue.push(child);
            }
        }
        return undefined;
    }

    // ---------------------------------------------------------------
    // Overview page — tree layout
    // ---------------------------------------------------------------

    private renderOverviewPage(root: HierarchyNode): string {
        let cellId = 2;
        const nextId = () => cellId++;
        const cells: string[] = [];

        // Compute tree layout
        const layout = this.computeTreeLayout(root);

        // Render nodes
        for (const ln of layout) {
            const hasChildren = ln.node.children.length > 0;
            const hasDef = ln.node.definition !== null;
            let style: string;
            if (hasChildren) {
                style = STYLE.overviewGreen;
            } else if (hasDef) {
                style = STYLE.overviewBlue;
            } else {
                style = STYLE.overviewGray;
            }

            const label = ln.node.instanceName === ln.node.moduleName
                ? ln.node.moduleName
                : `${ln.node.instanceName}\\n(${ln.node.moduleName})`;

            const id = nextId();
            (ln as { cellId?: number }).cellId = id;

            const filePath = ln.node.definition?.filePath;
            const fileAttr = filePath ? ` hdlFilePath="${esc(filePath)}"` : '';

            if (hasChildren && ln.node.pageId) {
                // Clickable — wrap in UserObject with link + file path
                cells.push(
                    `<UserObject label="${esc(label)}" link="data:page/id,${esc(ln.node.pageId)}"${fileAttr} id="${id}">` +
                    `<mxCell style="${style}" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(ln.x)}" y="${snap(ln.y)}" width="${OVERVIEW_NODE_W}" height="${OVERVIEW_NODE_H}" as="geometry"/>` +
                    `</mxCell></UserObject>`
                );
            } else if (filePath) {
                // Leaf with known file — UserObject with hdlFilePath
                cells.push(
                    `<UserObject label="${esc(label)}"${fileAttr} id="${id}">` +
                    `<mxCell style="${style}" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(ln.x)}" y="${snap(ln.y)}" width="${OVERVIEW_NODE_W}" height="${OVERVIEW_NODE_H}" as="geometry"/>` +
                    `</mxCell></UserObject>`
                );
            } else {
                cells.push(
                    `<mxCell id="${id}" value="${esc(label)}" style="${style}" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(ln.x)}" y="${snap(ln.y)}" width="${OVERVIEW_NODE_W}" height="${OVERVIEW_NODE_H}" as="geometry"/></mxCell>`
                );
            }
        }

        // Render edges (parent → child)
        this.renderTreeEdges(root, layout, cells, nextId);

        const graphXml = this.wrapGraphModel(cells.join(''));
        return `<diagram id="page_overview" name="Overview">${graphXml}</diagram>`;
    }

    private computeTreeLayout(root: HierarchyNode): TreeLayoutNode[] {
        const result: TreeLayoutNode[] = [];
        // First pass: compute subtree widths
        const widthMap = new Map<HierarchyNode, number>();
        this.computeSubtreeWidth(root, widthMap);

        // Second pass: assign positions
        this.assignPositions(root, 100, 60, widthMap, result);

        return result;
    }

    private computeSubtreeWidth(node: HierarchyNode, map: Map<HierarchyNode, number>): number {
        if (node.children.length === 0) {
            map.set(node, OVERVIEW_NODE_W);
            return OVERVIEW_NODE_W;
        }

        let totalWidth = 0;
        for (const child of node.children) {
            totalWidth += this.computeSubtreeWidth(child, map);
        }
        totalWidth += (node.children.length - 1) * OVERVIEW_H_SPACING;

        const width = Math.max(totalWidth, OVERVIEW_NODE_W);
        map.set(node, width);
        return width;
    }

    private assignPositions(
        node: HierarchyNode,
        x: number,
        y: number,
        widthMap: Map<HierarchyNode, number>,
        result: TreeLayoutNode[],
    ): void {
        const subtreeW = widthMap.get(node) ?? OVERVIEW_NODE_W;
        const nodeX = x + subtreeW / 2 - OVERVIEW_NODE_W / 2;

        result.push({ node, x: nodeX, y, width: subtreeW });

        if (node.children.length === 0) { return; }

        let childX = x;
        const childY = y + OVERVIEW_NODE_H + OVERVIEW_V_SPACING;

        for (const child of node.children) {
            const childW = widthMap.get(child) ?? OVERVIEW_NODE_W;
            this.assignPositions(child, childX, childY, widthMap, result);
            childX += childW + OVERVIEW_H_SPACING;
        }
    }

    private renderTreeEdges(
        node: HierarchyNode,
        layout: TreeLayoutNode[],
        cells: string[],
        nextId: () => number,
    ): void {
        const findCellId = (n: HierarchyNode): number | undefined => {
            const found = layout.find(ln => ln.node === n);
            return found ? (found as TreeLayoutNode & { cellId?: number }).cellId : undefined;
        };

        const parentId = findCellId(node);
        if (parentId === undefined) { return; }

        for (const child of node.children) {
            const childId = findCellId(child);
            if (childId === undefined) { continue; }

            const edgeId = nextId();
            cells.push(
                `<mxCell id="${edgeId}" value="" style="${STYLE.overviewEdge}" ` +
                `edge="1" source="${parentId}" target="${childId}" parent="1">` +
                `<mxGeometry relative="1" as="geometry"/></mxCell>`
            );

            this.renderTreeEdges(child, layout, cells, nextId);
        }
    }

    // ---------------------------------------------------------------
    // Detail page — sub-module blocks with connections
    // ---------------------------------------------------------------

    private renderDetailPage(
        node: HierarchyNode,
        definitions: Map<string, ModuleDefinition>,
        parentPageId?: string,
    ): string {
        let cellId = 2;
        const nextId = () => cellId++;
        const cells: string[] = [];

        const def = node.definition;
        const instantiations = def?.instantiations ?? [];

        // Navigation buttons
        if (parentPageId) {
            this.renderNavButton(cells, nextId, `\\u2190 Back`, parentPageId, STYLE.navBack, 10, 10, 100);
        }
        this.renderNavButton(cells, nextId, 'Overview', 'page_overview', STYLE.navOverview,
            parentPageId ? 120 : 10, 10, 100);

        // Layout sub-module blocks in grid
        const cols = Math.min(DETAIL_COLS, instantiations.length);
        const rows = Math.ceil(instantiations.length / cols) || 1;

        // Compute block sizes
        const blockSizes = instantiations.map(inst => {
            const childDef = definitions.get(inst.moduleName);
            const portCount = childDef ? childDef.ports.length : inst.portConnections.length;
            const h = Math.max(DETAIL_BLOCK_MIN_H, 30 + portCount * DETAIL_PORT_H + 10);
            return { w: DETAIL_BLOCK_W, h };
        });

        const maxBlockH = blockSizes.reduce((max, bs) => Math.max(max, bs.h), DETAIL_BLOCK_MIN_H);

        // Boundary dimensions
        const innerW = cols * DETAIL_BLOCK_W + (cols - 1) * DETAIL_H_SPACING;
        const innerH = rows * maxBlockH + (rows - 1) * DETAIL_V_SPACING;
        const boundaryX = DETAIL_MARGIN;
        const boundaryY = DETAIL_MARGIN + DETAIL_NAV_H + 20;
        const boundaryW = innerW + DETAIL_MARGIN * 2;
        const boundaryH = innerH + DETAIL_MARGIN * 2 + 40;

        // Parent boundary
        const boundaryId = nextId();
        cells.push(
            `<mxCell id="${boundaryId}" value="${esc(node.moduleName)}" ` +
            `style="${STYLE.detailBoundary}" vertex="1" parent="1">` +
            `<mxGeometry x="${snap(boundaryX)}" y="${snap(boundaryY)}" ` +
            `width="${snap(boundaryW)}" height="${snap(boundaryH)}" as="geometry"/></mxCell>`
        );

        // Place sub-module blocks
        const instanceCellIds = new Map<string, number>();

        instantiations.forEach((inst, idx) => {
            const col = idx % cols;
            const row = Math.floor(idx / cols);

            const bx = boundaryX + DETAIL_MARGIN + col * (DETAIL_BLOCK_W + DETAIL_H_SPACING);
            const by = boundaryY + 50 + row * (maxBlockH + DETAIL_V_SPACING);

            const childDef = definitions.get(inst.moduleName);
            const childNode = node.children.find(c =>
                c.instanceName === inst.instanceName && c.moduleName === inst.moduleName
            );
            const hasChildPage = childNode?.pageId !== undefined;
            const hasDef = childDef !== null && childDef !== undefined;

            let style: string;
            if (hasChildPage) {
                style = STYLE.detailGreen;
            } else if (hasDef) {
                style = STYLE.detailBlue;
            } else {
                style = STYLE.detailGray;
            }

            const blockH = blockSizes[idx].h;
            const blockLabel = `${inst.instanceName} : ${inst.moduleName}`;
            const blockId = nextId();
            instanceCellIds.set(inst.instanceName, blockId);

            const childFilePath = childDef?.filePath;
            const fileAttr = childFilePath ? ` hdlFilePath="${esc(childFilePath)}"` : '';

            if (hasChildPage && childNode?.pageId) {
                cells.push(
                    `<UserObject label="${esc(blockLabel)}" ` +
                    `link="data:page/id,${esc(childNode.pageId)}"${fileAttr} id="${blockId}">` +
                    `<mxCell style="${style}" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(bx)}" y="${snap(by)}" ` +
                    `width="${DETAIL_BLOCK_W}" height="${snap(blockH)}" as="geometry"/>` +
                    `</mxCell></UserObject>`
                );
            } else if (childFilePath) {
                cells.push(
                    `<UserObject label="${esc(blockLabel)}"${fileAttr} id="${blockId}">` +
                    `<mxCell style="${style}" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(bx)}" y="${snap(by)}" ` +
                    `width="${DETAIL_BLOCK_W}" height="${snap(blockH)}" as="geometry"/>` +
                    `</mxCell></UserObject>`
                );
            } else {
                cells.push(
                    `<mxCell id="${blockId}" value="${esc(blockLabel)}" ` +
                    `style="${style}" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(bx)}" y="${snap(by)}" ` +
                    `width="${DETAIL_BLOCK_W}" height="${snap(blockH)}" as="geometry"/></mxCell>`
                );
            }

            // Render port labels inside the block
            const ports = childDef?.ports ?? [];
            const inputs = ports.filter(p => p.direction === 'input');
            const outputs = ports.filter(p => p.direction === 'output');

            inputs.forEach((port, pi) => {
                const portLabel = port.width > 1 ? `${port.name} [${port.width - 1}:0]` : port.name;
                const py = by + 30 + pi * DETAIL_PORT_H;
                const plId = nextId();
                cells.push(
                    `<mxCell id="${plId}" value="${esc(portLabel)}" ` +
                    `style="${STYLE.detailPortLabel}align=left;" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(bx + 6)}" y="${snap(py)}" ` +
                    `width="${snap(DETAIL_BLOCK_W / 2 - 10)}" height="${DETAIL_PORT_H}" as="geometry"/></mxCell>`
                );
            });

            outputs.forEach((port, pi) => {
                const portLabel = port.width > 1 ? `${port.name} [${port.width - 1}:0]` : port.name;
                const py = by + 30 + pi * DETAIL_PORT_H;
                const plId = nextId();
                cells.push(
                    `<mxCell id="${plId}" value="${esc(portLabel)}" ` +
                    `style="${STYLE.detailPortLabel}align=right;" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(bx + DETAIL_BLOCK_W / 2 + 4)}" y="${snap(py)}" ` +
                    `width="${snap(DETAIL_BLOCK_W / 2 - 10)}" height="${DETAIL_PORT_H}" as="geometry"/></mxCell>`
                );
            });

            // Parameter overrides annotation
            if (inst.paramOverrides.length > 0) {
                const paramText = inst.paramOverrides
                    .map(p => `${p.name}=${p.value}`)
                    .join(', ');
                const paramId = nextId();
                cells.push(
                    `<mxCell id="${paramId}" value="#(${esc(paramText)})" ` +
                    `style="text;html=1;align=right;verticalAlign=bottom;fontSize=9;fontColor=#666666;` +
                    `fontStyle=2;strokeColor=none;fillColor=none;" vertex="1" parent="1">` +
                    `<mxGeometry x="${snap(bx)}" y="${snap(by - 18)}" ` +
                    `width="${DETAIL_BLOCK_W}" height="16" as="geometry"/></mxCell>`
                );
            }
        });

        // Render signal connections between instances
        this.renderConnections(instantiations, instanceCellIds, cells, nextId);

        const graphXml = this.wrapGraphModel(cells.join(''));
        return `<diagram id="${esc(node.pageId ?? `page_${node.moduleName}`)}" ` +
            `name="${esc(node.moduleName)}">${graphXml}</diagram>`;
    }

    // ---------------------------------------------------------------
    // Signal connections between instances
    // ---------------------------------------------------------------

    private renderConnections(
        instantiations: ModuleInstantiation[],
        instanceCellIds: Map<string, number>,
        cells: string[],
        nextId: () => number,
    ): void {
        // Build signal map: signalExpr → list of {instanceName, portName}
        const signalMap = new Map<string, { instanceName: string; portName: string }[]>();

        for (const inst of instantiations) {
            for (const conn of inst.portConnections) {
                const sig = conn.signalExpr.trim();
                if (!sig) { continue; }

                // Normalize: strip bit selects for matching (e.g., "data[7:0]" → "data")
                const baseSig = sig.replace(/\[.*\]/, '').trim();
                if (!baseSig) { continue; }

                const list = signalMap.get(baseSig) ?? [];
                list.push({ instanceName: inst.instanceName, portName: conn.portName });
                signalMap.set(baseSig, list);
            }
        }

        // For each signal connected to 2+ instances, draw edges
        for (const [sigName, endpoints] of signalMap) {
            // Filter to unique instances
            const uniqueInstances = [...new Set(endpoints.map(e => e.instanceName))];
            if (uniqueInstances.length < 2) { continue; }

            // Connect pairwise (first to each subsequent — star topology from first)
            const sourceInst = uniqueInstances[0];
            const sourceCellId = instanceCellIds.get(sourceInst);
            if (sourceCellId === undefined) { continue; }

            for (let i = 1; i < uniqueInstances.length; i++) {
                const targetInst = uniqueInstances[i];
                const targetCellId = instanceCellIds.get(targetInst);
                if (targetCellId === undefined) { continue; }

                const edgeId = nextId();
                cells.push(
                    `<mxCell id="${edgeId}" value="${esc(sigName)}" ` +
                    `style="${STYLE.detailEdge}" edge="1" ` +
                    `source="${sourceCellId}" target="${targetCellId}" parent="1">` +
                    `<mxGeometry relative="1" as="geometry"/></mxCell>`
                );
            }
        }
    }

    // ---------------------------------------------------------------
    // Navigation buttons
    // ---------------------------------------------------------------

    private renderNavButton(
        cells: string[],
        nextId: () => number,
        label: string,
        targetPageId: string,
        style: string,
        x: number,
        y: number,
        w: number,
    ): void {
        const id = nextId();
        cells.push(
            `<UserObject label="${esc(label)}" link="data:page/id,${esc(targetPageId)}" id="${id}">` +
            `<mxCell style="${style}" vertex="1" parent="1">` +
            `<mxGeometry x="${snap(x)}" y="${snap(y)}" width="${w}" height="${DETAIL_NAV_H}" as="geometry"/>` +
            `</mxCell></UserObject>`
        );
    }

    // ---------------------------------------------------------------
    // XML helpers
    // ---------------------------------------------------------------

    private wrapGraphModel(cellsXml: string): string {
        return `<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" ` +
            `tooltips="1" connect="1" arrows="1" fold="1" page="1" ` +
            `pageScale="1" pageWidth="1169" pageHeight="827">` +
            `<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
            `${cellsXml}</root></mxGraphModel>`;
    }
}
