import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getCategoryLabel, getCategoryOrder, getTemplatesByCategory, searchTemplates } from '../templates/index';
import type { TemplateCategory } from '../types/types';
import type { TemplateRegistryEntry } from '../templates/index';

/**
 * Template picker UI — QuickPick based category → template → action flow
 */
export class TemplatePickerProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    public async showPicker(): Promise<void> {
        // Step 1: Category selection
        const categoryOrder = getCategoryOrder();
        const categoryItems = categoryOrder.map(cat => ({
            label: getCategoryLabel(cat),
            category: cat,
        }));

        const searchItem = { label: '$(search) Search all templates...', category: '__search__' as TemplateCategory };
        const allItems = [searchItem, ...categoryItems];

        const picked = await vscode.window.showQuickPick(allItems, {
            placeHolder: 'Select a template category',
            title: 'WaveDrom Templates',
        });

        if (!picked) { return; }

        let templates: TemplateRegistryEntry[];

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

        // Step 2: Template selection
        const templateItems = templates.map(t => ({
            label: t.meta.name,
            description: t.meta.tags.join(', '),
            detail: t.meta.description,
            template: t,
        }));

        const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
            placeHolder: 'Select a template',
            title: `WaveDrom Templates — ${picked.label}`,
        });

        if (!selectedTemplate) { return; }

        // Step 3: Action selection
        const action = await vscode.window.showQuickPick([
            { label: '$(file-add) Create new .wavedrom.json file', action: 'new-file' },
            { label: '$(insert) Insert into current editor', action: 'insert' },
            { label: '$(copy) Copy to clipboard', action: 'clipboard' },
        ], {
            placeHolder: 'What to do with the template?',
        });

        if (!action) { return; }

        // Load template content
        const templateContent = this.loadTemplate(selectedTemplate.template);
        if (!templateContent) { return; }

        switch (action.action) {
            case 'new-file':
                await this.createNewFile(selectedTemplate.template, templateContent);
                break;
            case 'insert':
                await this.insertIntoEditor(templateContent);
                break;
            case 'clipboard':
                await vscode.env.clipboard.writeText(templateContent);
                vscode.window.showInformationMessage('Template copied to clipboard.');
                break;
        }
    }

    private loadTemplate(entry: TemplateRegistryEntry): string | undefined {
        // Prefer compiled output directory (works in packaged extension)
        const outPath = path.join(this.context.extensionPath, 'out', 'templates', entry.relativePath);
        // Fallback to source directory (works during development)
        const srcPath = path.join(this.context.extensionPath, 'src', 'templates', entry.relativePath);

        let content: string | undefined;
        for (const p of [outPath, srcPath]) {
            try {
                content = fs.readFileSync(p, 'utf-8');
                break;
            } catch {
                // try next path
            }
        }

        if (!content) {
            vscode.window.showErrorMessage(`Template file not found: ${entry.relativePath}`);
            return undefined;
        }

        // Remove meta field for output
        try {
            const json = JSON.parse(content);
            delete json.meta;
            return JSON.stringify(json, null, 2);
        } catch {
            return content;
        }
    }

    private async createNewFile(entry: TemplateRegistryEntry, content: string): Promise<void> {
        const defaultName = entry.relativePath
            .replace(/^.*\//, '')
            .replace('.json', '');

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
                path.join(
                    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
                    `${defaultName}.wavedrom.json`
                )
            ),
            filters: { 'WaveDrom JSON': ['wavedrom.json', 'json'] },
            saveLabel: 'Create WaveDrom File',
        });

        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    }

    private async insertIntoEditor(content: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor to insert into.');
            return;
        }
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, content);
        });
    }
}
