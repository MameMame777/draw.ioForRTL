import { PluginSettingTab, App, Setting } from 'obsidian';
import type DrawWavePlugin from '../main';

export class DrawWaveSettingTab extends PluginSettingTab {
    constructor(app: App, private readonly plugin: DrawWavePlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'DrawWave Settings' });

        new Setting(containerEl)
            .setName('Draw.io Theme')
            .setDesc('Theme for the draw.io editor')
            .addDropdown(drop => drop
                .addOption('kennedy', 'Kennedy (Default)')
                .addOption('min', 'Minimal')
                .addOption('atlas', 'Atlas')
                .addOption('dark', 'Dark')
                .addOption('sketch', 'Sketch')
                .setValue(this.plugin.settings.theme)
                .onChange(async (value) => {
                    this.plugin.settings.theme = value as typeof this.plugin.settings.theme;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Preview Debounce (ms)')
            .setDesc('Delay before re-rendering WaveDrom preview after edits')
            .addText(text => text
                .setPlaceholder('300')
                .setValue(String(this.plugin.settings.debounceMs))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 0) {
                        this.plugin.settings.debounceMs = num;
                        await this.plugin.saveSettings();
                    }
                })
            );

        new Setting(containerEl)
            .setName('Draw.io Language')
            .setDesc('UI language for draw.io editor')
            .addDropdown(drop => drop
                .addOption('ja', '日本語')
                .addOption('en', 'English')
                .addOption('zh', '中文')
                .addOption('ko', '한국어')
                .addOption('de', 'Deutsch')
                .addOption('fr', 'Français')
                .setValue(this.plugin.settings.drawioLanguage)
                .onChange(async (value) => {
                    this.plugin.settings.drawioLanguage = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}
