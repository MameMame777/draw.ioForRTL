import { FuzzySuggestModal, App, TFile, Notice } from 'obsidian';
import { TEMPLATE_REGISTRY, getCategoryLabel, type TemplateRegistryEntry } from '../templates/index';
import type DrawWavePlugin from '../main';

/**
 * Template picker modal — fuzzy search across all WaveDrom templates.
 * Inserts the selected template JSON content.
 */
export class TemplatePicker extends FuzzySuggestModal<TemplateRegistryEntry> {
    private readonly onSelect: (json: string) => void;

    constructor(
        app: App,
        private readonly plugin: DrawWavePlugin,
        onSelect: (json: string) => void
    ) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder('Search WaveDrom templates...');
    }

    getItems(): TemplateRegistryEntry[] {
        return TEMPLATE_REGISTRY;
    }

    getItemText(item: TemplateRegistryEntry): string {
        const categoryLabel = getCategoryLabel(item.meta.category);
        return `[${categoryLabel}] ${item.meta.name} — ${item.meta.description}`;
    }

    onChooseItem(item: TemplateRegistryEntry): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodeFs = require('fs') as typeof import('fs');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodePath = require('path') as typeof import('path');

            // Load template JSON from the bundled templates directory
            const pluginDir = this.plugin.manifest.dir;
            if (!pluginDir) {
                new Notice('Plugin directory not found');
                return;
            }

            const basePath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
            if (!basePath) {
                new Notice('Could not resolve vault path');
                return;
            }

            const templatePath = nodePath.join(basePath, pluginDir, 'templates', item.relativePath);
            const content = nodeFs.readFileSync(templatePath, 'utf-8');
            this.onSelect(content);
        } catch (err) {
            new Notice(`Failed to load template: ${item.meta.name}`);
            console.error('DrawWave template load error:', err);
        }
    }
}
