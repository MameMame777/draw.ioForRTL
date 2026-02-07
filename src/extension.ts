import * as vscode from 'vscode';
import { WaveDromPreviewProvider } from './providers/WaveDromPreviewProvider';
import { DrawioEditorProvider } from './providers/DrawioEditorProvider';
import { TemplatePickerProvider } from './providers/TemplatePickerProvider';
import { HdlParser } from './hdl/HdlParser';
import { WaveDromGenerator } from './hdl/WaveDromGenerator';
import { HdlWatcher } from './hdl/HdlWatcher';
import { TruthTableGenerator } from './truthTable/TruthTableGenerator';
import { TruthTableRenderer } from './truthTable/TruthTableRenderer';
import { parseModulePorts, renderModulePortXml } from './hdl/ModulePortRenderer';
import { extractFsm, renderFsmXml } from './hdl/FsmExtractor';
import { parseVcd, vcdToWaveDrom } from './hdl/VcdParser';
import { ModuleHierarchyParser } from './hdl/ModuleHierarchyParser';
import { HierarchyDiagramRenderer } from './hdl/HierarchyDiagramRenderer';

export function activate(context: vscode.ExtensionContext): void {
    // --- Providers ---
    const waveDromProvider = new WaveDromPreviewProvider(context);
    const drawioProvider = new DrawioEditorProvider(context);
    const templatePicker = new TemplatePickerProvider(context);
    const hdlParser = new HdlParser();
    const waveDromGenerator = new WaveDromGenerator();
    const hdlWatcher = new HdlWatcher(hdlParser, waveDromGenerator);
    const truthTableRenderer = new TruthTableRenderer();

    // --- Custom Editor Registration ---
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'drawwave.waveDromPreview',
            waveDromProvider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        )
    );

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'drawwave.drawioEditor',
            drawioProvider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        )
    );

    // --- Command Registration ---

    // Open WaveDrom Preview (for non-custom-editor use)
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.openWaveDromPreview', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor. Open a .wavedrom.json file first.');
                return;
            }
            await waveDromProvider.openPreviewPanel(editor.document);
        })
    );

    // Open Draw.io Editor
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.openDrawio', async () => {
            const files = await vscode.workspace.findFiles('**/*.{drawio,dio}', '**/node_modules/**', 50);

            // Build quick pick items
            const items: (vscode.QuickPickItem & { uri?: vscode.Uri; action?: string })[] = [];

            // "Create New" always available
            items.push({
                label: '$(new-file) Create New Diagram',
                description: 'Create a new empty .drawio file',
                action: 'new',
            });

            // "Browse…" to open from file system
            items.push({
                label: '$(folder-opened) Browse…',
                description: 'Open an existing .drawio file from disk',
                action: 'browse',
            });

            // Add separator + existing files
            if (files.length > 0) {
                items.push({ label: 'Workspace Files', kind: vscode.QuickPickItemKind.Separator });
                for (const f of files) {
                    items.push({
                        label: '$(file) ' + vscode.workspace.asRelativePath(f),
                        uri: f,
                    });
                }
            }

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Open or create a Draw.io diagram',
            });
            if (!picked) {
                return;
            }

            if (picked.action === 'new') {
                const newFile = await vscode.window.showSaveDialog({
                    filters: { 'Draw.io Diagram': ['drawio'] },
                    saveLabel: 'Create Diagram',
                });
                if (newFile) {
                    await vscode.workspace.fs.writeFile(newFile, Buffer.from(getEmptyDrawioXml()));
                    await vscode.commands.executeCommand('vscode.openWith', newFile, 'drawwave.drawioEditor');
                }
            } else if (picked.action === 'browse') {
                const selected = await vscode.window.showOpenDialog({
                    filters: { 'Draw.io Diagram': ['drawio', 'dio'] },
                    canSelectMany: false,
                    openLabel: 'Open Diagram',
                });
                if (selected && selected.length > 0) {
                    await vscode.commands.executeCommand('vscode.openWith', selected[0], 'drawwave.drawioEditor');
                }
            } else if (picked.uri) {
                await vscode.commands.executeCommand('vscode.openWith', picked.uri, 'drawwave.drawioEditor');
            }
        })
    );

    // Insert Template
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.insertTemplate', async () => {
            await templatePicker.showPicker();
        })
    );

    // Generate from HDL
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.generateFromHDL', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor. Open a Verilog/SystemVerilog file.');
                return;
            }

            const doc = editor.document;
            if (!['verilog', 'systemverilog'].includes(doc.languageId) &&
                !doc.fileName.match(/\.(v|sv)$/i)) {
                vscode.window.showWarningMessage('Active file is not a Verilog/SystemVerilog file.');
                return;
            }

            try {
                const hdlModule = hdlParser.parse(doc.getText(), doc.fileName);
                if (hdlModule.signals.length === 0) {
                    vscode.window.showWarningMessage(
                        'No @wavedrom annotations found. Add // @wavedrom comments to your HDL signals.'
                    );
                    return;
                }

                const config = vscode.workspace.getConfiguration('drawwave.hdl');
                const level = config.get<string>('abstractionLevel', 'L1');
                const waveJson = waveDromGenerator.generate(hdlModule, level);
                const jsonStr = JSON.stringify(waveJson, null, 2);

                // Create new .wavedrom.json file
                const moduleName = hdlModule.name || 'untitled';
                const dir = vscode.Uri.joinPath(doc.uri, '..');
                const outputUri = vscode.Uri.joinPath(dir, `${moduleName}.wavedrom.json`);
                await vscode.workspace.fs.writeFile(outputUri, Buffer.from(jsonStr, 'utf-8'));
                const outputDoc = await vscode.workspace.openTextDocument(outputUri);
                await vscode.window.showTextDocument(outputDoc, { preview: false });
                vscode.window.showInformationMessage(
                    `Generated WaveDrom for module "${moduleName}" (${hdlModule.signals.length} signals)`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`HDL parse error: ${err}`);
            }
        })
    );

    // Insert WaveDrom to Draw.io
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.insertWaveDromToDrawio', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Open a .wavedrom.json file first.');
                return;
            }
            try {
                const json = editor.document.getText();
                const waveJson = JSON.parse(json);
                await drawioProvider.insertWaveDrom(waveJson);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to insert WaveDrom: ${err}`);
            }
        })
    );

    // Insert Truth Table
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.insertTruthTable', async () => {
            const inputStr = await vscode.window.showInputBox({
                prompt: 'Enter input signals (comma separated)',
                placeHolder: 'a, b, c',
            });
            if (!inputStr) { return; }

            const inputs = inputStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
            if (inputs.length === 0) {
                vscode.window.showWarningMessage('No input signals specified.');
                return;
            }

            const exprStr = await vscode.window.showInputBox({
                prompt: 'Enter output expressions (name=expr, comma separated)',
                placeHolder: 'y = a & b, z = a | ~b',
            });
            if (!exprStr) { return; }

            try {
                const outputs = TruthTableGenerator.parseOutputExpressions(exprStr);
                const table = TruthTableGenerator.generate(inputs, outputs);
                const xml = truthTableRenderer.renderToDrawioXml(table);
                await drawioProvider.insertTruthTableXml(xml);
                vscode.window.showInformationMessage('Truth table inserted into diagram.');
            } catch (err) {
                vscode.window.showErrorMessage(`Truth table error: ${err}`);
            }
        })
    );

    // Regenerate
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.regenerate', async () => {
            await vscode.commands.executeCommand('drawwave.generateFromHDL');
        })
    );

    // New WaveDrom shape directly in Draw.io (JSON input dialog)
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.newWaveDromInDrawio', async () => {
            const jsonStr = await vscode.window.showInputBox({
                prompt: 'Enter WaveDrom JSON (or leave empty for a template)',
                placeHolder: '{"signal":[{"name":"clk","wave":"p...."},{"name":"data","wave":"x.=.x","data":["D0"]}]}',
                value: '{"signal":[{"name":"clk","wave":"p......"},{"name":"data","wave":"x..=..x","data":["D0"]}]}',
            });
            if (!jsonStr) { return; }

            try {
                const waveJson = JSON.parse(jsonStr);
                await drawioProvider.insertWaveDrom(waveJson);
            } catch (err) {
                vscode.window.showErrorMessage(`Invalid WaveDrom JSON: ${err}`);
            }
        })
    );

    // HDL → WaveDrom → directly into Draw.io diagram
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.hdlToDrawio', async () => {
            // Find open HDL files or let user pick
            const hdlFiles = await vscode.workspace.findFiles('**/*.{v,sv}', '**/node_modules/**', 20);
            if (hdlFiles.length === 0) {
                vscode.window.showWarningMessage('No Verilog/SystemVerilog files found in workspace.');
                return;
            }

            const picked = await vscode.window.showQuickPick(
                hdlFiles.map(f => ({
                    label: vscode.workspace.asRelativePath(f),
                    uri: f,
                })),
                { placeHolder: 'Select HDL file to generate WaveDrom from' }
            );
            if (!picked) { return; }

            try {
                const doc = await vscode.workspace.openTextDocument(picked.uri);
                const hdlModule = hdlParser.parse(doc.getText(), doc.fileName);
                if (hdlModule.signals.length === 0) {
                    vscode.window.showWarningMessage(
                        'No @wavedrom annotations found in ' + picked.label
                    );
                    return;
                }

                const config = vscode.workspace.getConfiguration('drawwave.hdl');
                const level = config.get<string>('abstractionLevel', 'L1');
                const waveJson = waveDromGenerator.generate(hdlModule, level);
                delete (waveJson as Record<string, unknown>).meta;
                await drawioProvider.insertWaveDrom(waveJson);
                vscode.window.showInformationMessage(
                    `Inserted WaveDrom for "${hdlModule.name}" (${hdlModule.signals.length} signals) into diagram.`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`HDL → Draw.io error: ${err}`);
            }
        })
    );

    // Insert template directly into Draw.io diagram
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.templateToDrawio', async () => {
            const { TEMPLATE_REGISTRY, getCategoryLabel, getCategoryOrder } = await import('./templates/index');
            const categories = getCategoryOrder();

            const catPick = await vscode.window.showQuickPick(
                categories.map(c => ({
                    label: getCategoryLabel(c),
                    category: c,
                })),
                { placeHolder: 'Select template category' }
            );
            if (!catPick) { return; }

            const templates = TEMPLATE_REGISTRY.filter(
                t => t.meta.category === catPick.category
            );
            const tplPick = await vscode.window.showQuickPick(
                templates.map(t => ({
                    label: t.meta.name,
                    description: t.meta.description,
                    entry: t,
                })),
                { placeHolder: 'Select template' }
            );
            if (!tplPick) { return; }

            try {
                const fs = await import('fs');
                const path = await import('path');

                // Try out/templates first, then src/templates
                let tplPath = path.join(context.extensionPath, 'out', 'templates', tplPick.entry.relativePath);
                if (!fs.existsSync(tplPath)) {
                    tplPath = path.join(context.extensionPath, 'src', 'templates', tplPick.entry.relativePath);
                }

                const content = fs.readFileSync(tplPath, 'utf-8');
                const waveJson = JSON.parse(content);
                await drawioProvider.insertWaveDrom(waveJson);
                vscode.window.showInformationMessage(
                    `Inserted "${tplPick.label}" template into diagram.`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`Template → Draw.io error: ${err}`);
            }
        })
    );

    // Export SVG
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.exportSvg', async () => {
            await waveDromProvider.exportCurrentAsSvg();
        })
    );

    // Export PNG
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.exportPng', async () => {
            await waveDromProvider.exportCurrentAsPng();
        })
    );

    // Edit WaveDrom source JSON (opens text editor beside the preview)
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.editWaveDromSource', async () => {
            await waveDromProvider.editSource();
        })
    );

    // Apply a template to the active WaveDrom document
    // Works even when the custom editor (WebView) is active and activeTextEditor is undefined
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.applyTemplateToWaveDrom', async () => {
            const docUri = waveDromProvider.getActiveDocumentUri();
            if (!docUri) {
                vscode.window.showWarningMessage('No WaveDrom preview is open.');
                return;
            }

            // Reuse the template picker logic directly
            const { TEMPLATE_REGISTRY, getCategoryLabel, getCategoryOrder, searchTemplates, getTemplatesByCategory } = await import('./templates/index');
            type TemplateCategory = import('./types/types').TemplateCategory;
            const categoryOrder = getCategoryOrder();
            const categoryItems = categoryOrder.map(cat => ({
                label: getCategoryLabel(cat),
                category: cat,
            }));

            const searchItem = { label: '$(search) Search all templates...', category: '__search__' as TemplateCategory };
            const allItems = [searchItem, ...categoryItems];

            const picked = await vscode.window.showQuickPick(allItems, {
                placeHolder: 'Select a template category',
                title: 'Apply WaveDrom Template',
            });
            if (!picked) { return; }

            let templates: typeof TEMPLATE_REGISTRY;
            if (picked.category === '__search__' as TemplateCategory) {
                const query = await vscode.window.showInputBox({
                    prompt: 'Search templates',
                    placeHolder: 'e.g., axi, spi, pipeline...',
                });
                if (!query) { return; }
                templates = searchTemplates(query);
                if (templates.length === 0) {
                    vscode.window.showInformationMessage(`No templates found for "${query}".`);
                    return;
                }
            } else {
                templates = getTemplatesByCategory(picked.category);
            }

            const templateItems = templates.map(t => ({
                label: t.meta.name,
                description: t.meta.tags.join(', '),
                detail: t.meta.description,
                template: t,
            }));

            const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
                placeHolder: 'Select a template to apply',
                title: 'Apply WaveDrom Template',
            });
            if (!selectedTemplate) { return; }

            try {
                const fs = await import('fs');
                const path = await import('path');
                let tplPath = path.join(context.extensionPath, 'out', 'templates', selectedTemplate.template.relativePath);
                if (!fs.existsSync(tplPath)) {
                    tplPath = path.join(context.extensionPath, 'src', 'templates', selectedTemplate.template.relativePath);
                }
                const content = fs.readFileSync(tplPath, 'utf-8');
                const json = JSON.parse(content);
                delete json.meta;
                const formatted = JSON.stringify(json, null, 2);
                await waveDromProvider.applyContent(formatted);
                vscode.window.showInformationMessage(`Applied template "${selectedTemplate.label}".`);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to apply template: ${err}`);
            }
        })
    );

    // Import HDL → WaveDrom JSON into the active WaveDrom preview
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.importHdlToWaveDrom', async () => {
            const docUri = waveDromProvider.getActiveDocumentUri();
            if (!docUri) {
                vscode.window.showWarningMessage('No WaveDrom preview is open.');
                return;
            }

            // Find HDL files in workspace
            const hdlFiles = await vscode.workspace.findFiles('**/*.{v,sv}', '**/node_modules/**', 50);
            if (hdlFiles.length === 0) {
                vscode.window.showWarningMessage('No Verilog/SystemVerilog files found in workspace.');
                return;
            }

            const picked = await vscode.window.showQuickPick(
                hdlFiles.map(f => ({
                    label: vscode.workspace.asRelativePath(f),
                    uri: f,
                })),
                { placeHolder: 'Select HDL file to generate WaveDrom from' }
            );
            if (!picked) { return; }

            try {
                const doc = await vscode.workspace.openTextDocument(picked.uri);
                const hdlModule = hdlParser.parse(doc.getText(), doc.fileName);
                if (hdlModule.signals.length === 0) {
                    vscode.window.showWarningMessage(
                        'No @wavedrom annotations found in ' + picked.label
                    );
                    return;
                }

                const config = vscode.workspace.getConfiguration('drawwave.hdl');
                const level = config.get<string>('abstractionLevel', 'L1');
                const waveJson = waveDromGenerator.generate(hdlModule, level);
                delete (waveJson as Record<string, unknown>).meta;
                const formatted = JSON.stringify(waveJson, null, 2);
                await waveDromProvider.applyContent(formatted);
                vscode.window.showInformationMessage(
                    `Imported HDL "${hdlModule.name}" (${hdlModule.signals.length} signals) into WaveDrom.`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`HDL import error: ${err}`);
            }
        })
    );

    // --- HDL File Watcher ---
    context.subscriptions.push(hdlWatcher);

    // --- Module Port Diagram ---
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.modulePortDiagram', async () => {
            const hdlFiles = await vscode.workspace.findFiles('**/*.{v,sv}', '**/node_modules/**', 50);
            if (hdlFiles.length === 0) {
                vscode.window.showWarningMessage('No Verilog/SystemVerilog files found in workspace.');
                return;
            }

            const picked = await vscode.window.showQuickPick(
                hdlFiles.map(f => ({
                    label: vscode.workspace.asRelativePath(f),
                    uri: f,
                })),
                { placeHolder: 'Select HDL file for module port diagram' }
            );
            if (!picked) { return; }

            try {
                const doc = await vscode.workspace.openTextDocument(picked.uri);
                const portInfo = parseModulePorts(doc.getText());
                if (portInfo.ports.length === 0) {
                    vscode.window.showWarningMessage('No ports found in ' + picked.label);
                    return;
                }
                const xml = renderModulePortXml(portInfo);
                await drawioProvider.insertRawXml(xml);
                vscode.window.showInformationMessage(
                    `Inserted port diagram for "${portInfo.name}" (${portInfo.ports.length} ports).`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`Port diagram error: ${err}`);
            }
        })
    );

    // --- FSM State Transition Diagram ---
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.fsmDiagram', async () => {
            const hdlFiles = await vscode.workspace.findFiles('**/*.{v,sv}', '**/node_modules/**', 50);
            if (hdlFiles.length === 0) {
                vscode.window.showWarningMessage('No Verilog/SystemVerilog files found in workspace.');
                return;
            }

            const picked = await vscode.window.showQuickPick(
                hdlFiles.map(f => ({
                    label: vscode.workspace.asRelativePath(f),
                    uri: f,
                })),
                { placeHolder: 'Select HDL file for FSM extraction' }
            );
            if (!picked) { return; }

            try {
                const doc = await vscode.workspace.openTextDocument(picked.uri);
                const fsm = extractFsm(doc.getText());
                if (!fsm || fsm.states.length === 0) {
                    vscode.window.showWarningMessage(
                        'No FSM (state machine) found in ' + picked.label
                    );
                    return;
                }
                const xml = renderFsmXml(fsm);
                await drawioProvider.insertRawXml(xml);
                vscode.window.showInformationMessage(
                    `Inserted FSM diagram for "${fsm.moduleName}" ` +
                    `(${fsm.states.length} states, ${fsm.transitions.length} transitions).`
                );
            } catch (err) {
                vscode.window.showErrorMessage(`FSM diagram error: ${err}`);
            }
        })
    );

    // --- VCD Waveform Import ---
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.importVcd', async () => {
            const vcdFiles = await vscode.workspace.findFiles('**/*.vcd', '**/node_modules/**', 20);

            let vcdUri: vscode.Uri | undefined;
            if (vcdFiles.length > 0) {
                const items = vcdFiles.map(f => ({
                    label: vscode.workspace.asRelativePath(f),
                    uri: f,
                }));
                items.unshift({ label: '$(folder-opened) Browse…', uri: undefined as unknown as vscode.Uri });
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select VCD file',
                });
                if (!picked) { return; }
                if (picked.uri) {
                    vcdUri = picked.uri;
                }
            }

            if (!vcdUri) {
                const selected = await vscode.window.showOpenDialog({
                    filters: { 'VCD Files': ['vcd'] },
                    canSelectMany: false,
                    openLabel: 'Open VCD',
                });
                if (!selected || selected.length === 0) { return; }
                vcdUri = selected[0];
            }

            try {
                const raw = await vscode.workspace.fs.readFile(vcdUri);
                const vcdText = Buffer.from(raw).toString('utf-8');
                const vcd = parseVcd(vcdText);

                if (vcd.signals.length === 0) {
                    vscode.window.showWarningMessage('No signals found in VCD file.');
                    return;
                }

                // Let user select signals
                const signalItems = vcd.signals.map(s => ({
                    label: s.name,
                    description: `${s.fullPath} (${s.width}-bit ${s.type})`,
                    picked: true,
                    id: s.id,
                }));

                const selected = await vscode.window.showQuickPick(signalItems, {
                    canPickMany: true,
                    placeHolder: `Select signals (${vcd.signals.length} available, time: 0–${vcd.endTime} ${vcd.timescale})`,
                });
                if (!selected || selected.length === 0) { return; }

                const selectedIds = selected.map(s => s.id);
                const waveJson = vcdToWaveDrom(vcd, selectedIds);
                const jsonStr = JSON.stringify(waveJson, null, 2);

                // Open generated JSON in an untitled editor for user to review/edit
                const doc = await vscode.workspace.openTextDocument({
                    content: jsonStr,
                    language: 'json',
                });
                const editor = await vscode.window.showTextDocument(doc, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Active,
                });

                // Show action buttons — user can edit the JSON first, then click
                const action = await vscode.window.showInformationMessage(
                    `Imported ${selected.length} signals from VCD (${vcd.timescale}). Edit the JSON if needed, then choose an action.`,
                    { modal: false },
                    { title: 'Save as File', action: 'file' },
                    { title: 'Insert into Draw.io', action: 'drawio' },
                );
                if (!action) { return; }

                // Read the (possibly edited) content from the editor
                const editedText = editor.document.getText();
                let editedJson: unknown;
                try {
                    editedJson = JSON.parse(editedText);
                } catch {
                    vscode.window.showErrorMessage('Invalid JSON. Please fix the syntax and try again.');
                    return;
                }

                if (action.action === 'file') {
                    const saveUri = await vscode.window.showSaveDialog({
                        filters: { 'WaveDrom JSON': ['wavedrom.json'] },
                        saveLabel: 'Save Waveform',
                    });
                    if (saveUri) {
                        const finalJson = JSON.stringify(editedJson, null, 2);
                        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(finalJson, 'utf-8'));
                        // Close the untitled doc and open the saved file
                        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
                        const savedDoc = await vscode.workspace.openTextDocument(saveUri);
                        await vscode.window.showTextDocument(savedDoc, { preview: false });
                    }
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await drawioProvider.insertWaveDrom(editedJson as any);
                    // Close the untitled editor
                    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
                }

                vscode.window.showInformationMessage('WaveDrom JSON applied successfully.');
            } catch (err) {
                vscode.window.showErrorMessage(`VCD import error: ${err}`);
            }
        })
    );

    // --- Module Hierarchy Diagram ---
    context.subscriptions.push(
        vscode.commands.registerCommand('drawwave.moduleHierarchy', async () => {
            const hierarchyParser = new ModuleHierarchyParser();

            const definitions = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Scanning workspace for HDL modules...',
                    cancellable: true,
                },
                async (progress, token) => {
                    return hierarchyParser.scanWorkspace(progress, token);
                },
            );

            if (definitions.size === 0) {
                vscode.window.showWarningMessage('No Verilog/SystemVerilog modules found in workspace.');
                return;
            }

            // Find top-level candidates (modules never instantiated by others)
            const instantiated = new Set<string>();
            for (const [, def] of definitions) {
                for (const inst of def.instantiations) {
                    instantiated.add(inst.moduleName);
                }
            }
            const topCandidates = [...definitions.keys()].filter(name => !instantiated.has(name));

            let topModuleName: string;
            if (topCandidates.length === 0) {
                const picked = await vscode.window.showQuickPick(
                    [...definitions.keys()].map(n => ({
                        label: n,
                        description: definitions.get(n)?.filePath,
                    })),
                    { placeHolder: 'Select top-level module (no clear top found)' },
                );
                if (!picked) { return; }
                topModuleName = picked.label;
            } else if (topCandidates.length === 1) {
                topModuleName = topCandidates[0];
            } else {
                const picked = await vscode.window.showQuickPick(
                    topCandidates.map(n => ({
                        label: n,
                        description: definitions.get(n)?.filePath,
                    })),
                    { placeHolder: 'Select top-level module' },
                );
                if (!picked) { return; }
                topModuleName = picked.label;
            }

            // Build hierarchy tree
            const hierarchy = hierarchyParser.buildHierarchy(topModuleName, definitions);

            // Render multi-page draw.io XML
            const renderer = new HierarchyDiagramRenderer();
            const xml = renderer.renderHierarchyDiagram(hierarchy, definitions);

            // Save and open
            const defaultName = `${topModuleName}_hierarchy.drawio`;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const defaultUri = workspaceFolder
                ? vscode.Uri.joinPath(workspaceFolder.uri, defaultName)
                : undefined;

            const saveUri = await vscode.window.showSaveDialog({
                defaultUri,
                filters: { 'Draw.io Diagram': ['drawio'] },
                saveLabel: 'Create Hierarchy Diagram',
            });
            if (!saveUri) { return; }

            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(xml, 'utf-8'));
            await vscode.commands.executeCommand('vscode.openWith', saveUri, 'drawwave.drawioEditor');

            // Count pages
            const pageCount = (xml.match(/<diagram /g) || []).length;
            vscode.window.showInformationMessage(
                `Created hierarchy diagram for "${topModuleName}" (${pageCount} pages).`
            );
        })
    );

    // --- Disposables ---
    context.subscriptions.push(waveDromProvider);
    context.subscriptions.push(drawioProvider);
}

export function deactivate(): void {
    // All disposables are cleaned up via context.subscriptions
}

function getEmptyDrawioXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="VSCode" agent="DrawWave">
  <diagram id="default" name="Page-1">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}
