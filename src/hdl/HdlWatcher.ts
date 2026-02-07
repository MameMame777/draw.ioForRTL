import * as vscode from 'vscode';
import { HdlParser } from './HdlParser';
import { WaveDromGenerator } from './WaveDromGenerator';

/**
 * HdlWatcher — watches .v and .sv files for changes and triggers regeneration.
 * Only regenerates if auto-regenerate is enabled in settings.
 */
export class HdlWatcher implements vscode.Disposable {
    private readonly watchers: vscode.FileSystemWatcher[] = [];
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly parser: HdlParser,
        private readonly generator: WaveDromGenerator,
    ) {
        // Watch Verilog files
        const vWatcher = vscode.workspace.createFileSystemWatcher('**/*.v');
        const svWatcher = vscode.workspace.createFileSystemWatcher('**/*.sv');

        this.disposables.push(
            vWatcher.onDidChange(uri => this.onFileChanged(uri)),
            svWatcher.onDidChange(uri => this.onFileChanged(uri)),
        );

        this.watchers.push(vWatcher, svWatcher);
    }

    private async onFileChanged(uri: vscode.Uri): Promise<void> {
        const config = vscode.workspace.getConfiguration('drawwave.hdl');
        const autoRegen = config.get<boolean>('autoRegenerate', false);

        if (!autoRegen) { return; }

        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const hdlModule = this.parser.parse(doc.getText(), uri.fsPath);

            if (hdlModule.signals.length === 0) { return; }

            const level = config.get<string>('abstractionLevel', 'L1');
            const waveJson = this.generator.generate(hdlModule, level);

            // Find existing .wavedrom.json for this module
            const moduleName = hdlModule.name;
            const dir = vscode.Uri.joinPath(uri, '..');
            const outputUri = vscode.Uri.joinPath(dir, `${moduleName}.wavedrom.json`);

            await vscode.workspace.fs.writeFile(
                outputUri,
                Buffer.from(JSON.stringify(waveJson, null, 2), 'utf-8')
            );

            vscode.window.showInformationMessage(
                `DrawWave: Regenerated ${moduleName}.wavedrom.json`
            );
        } catch {
            // Silently ignore parse errors during auto-regeneration
        }
    }

    public dispose(): void {
        this.watchers.forEach(w => w.dispose());
        this.disposables.forEach(d => d.dispose());
    }
}
