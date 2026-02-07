---
name: typescript-vscode-extension
description: VS Code extension development patterns in TypeScript. Use when creating extensions, registering commands, implementing providers, building webviews, or testing VS Code extensions.
---

# TypeScript for VS Code Extensions

Production-oriented patterns and constraints for VS Code extensions written in TypeScript.

## When to Use This Skill
- Creating a VS Code extension or scaffolding extension code.
- Registering commands or menus in package.json.
- Implementing providers (TreeDataProvider, CompletionItemProvider, etc.).
- Building webviews and messaging between extension and webview.
- Implementing configuration, settings, or workspace behaviors.
- Writing extension tests with @vscode/test-cli or @vscode/test-electron.

## Critical Rules (MANDATORY)
1. Manage all disposables via `context.subscriptions`.
2. Use async APIs; avoid sync file I/O in activation and handlers.
3. Webviews MUST enforce CSP and use a nonce for scripts.
4. Never hardcode file system paths. Use `Uri.joinPath()` and `context.extensionUri`.
5. Keep activation fast. Defer heavy work and use async activation.
6. Use strict typing and explicit return types on public APIs.

## Extension Lifecycle Pattern

### Activation
- Minimal synchronous work.
- Register commands and providers immediately.
- Defer heavy initialization.

GOOD:

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    await initializeIfNeeded();

    const cmd = vscode.commands.registerCommand('ext.hello', () => {
        vscode.window.showInformationMessage('Hello');
    });

    context.subscriptions.push(cmd);
}

BAD:

export function activate(context: vscode.ExtensionContext): void {
    const data = fs.readFileSync('large.json', 'utf8');
    heavyParse(data);
}

### Deactivation
- Only cleanup work.
- Return a promise if async cleanup is required.

export function deactivate(): void | Thenable<void> {
    return undefined;
}

## Disposable Management

All resources that implement `Disposable` must be pushed to `context.subscriptions`.

GOOD:

context.subscriptions.push(
    vscode.commands.registerCommand('ext.run', handler),
    vscode.workspace.onDidChangeConfiguration(onConfigChange)
);

BAD:

vscode.workspace.onDidChangeConfiguration(onConfigChange); // leaked

### Custom Disposables

class MyResource implements vscode.Disposable {
    private disposed = false;

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        // cleanup
    }
}

## Command Registration Patterns

### package.json contribution

"contributes": {
  "commands": [
    {
      "command": "ext.hello",
      "title": "Hello",
      "category": "My Extension"
    }
  ]
}

### TypeScript registration

const cmd = vscode.commands.registerCommand('ext.hello', () => {
    vscode.window.showInformationMessage('Hello');
});
context.subscriptions.push(cmd);

### Text Editor Command

const fmt = vscode.commands.registerTextEditorCommand(
    'ext.format',
    (editor, edit) => {
        edit.insert(editor.selection.start, 'Hello');
    }
);
context.subscriptions.push(fmt);

## Event Handling Patterns

- `onDid*` fires after an action.
- `onWill*` fires before an action and can modify behavior.

vscode.workspace.onWillSaveTextDocument(event => {
    const edit = vscode.TextEdit.insert(new vscode.Position(0, 0), '// header\n');
    event.waitUntil(Promise.resolve([edit]));
});

Always dispose event subscriptions via `context.subscriptions`.

## Configuration Pattern

### package.json

"contributes": {
  "configuration": {
    "title": "My Extension",
    "properties": {
      "ext.enableFeature": {
        "type": "boolean",
        "default": true,
        "description": "Enable feature"
      }
    }
  }
}

### Reading configuration

const config = vscode.workspace.getConfiguration('ext');
const enabled = config.get<boolean>('enableFeature', true);

vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('ext.enableFeature')) {
        reload();
    }
});

## TreeDataProvider Pattern

class MyTreeProvider implements vscode.TreeDataProvider<MyItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<MyItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    getTreeItem(element: MyItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label);
        item.id = element.id;
        item.contextValue = 'myItem';
        return item;
    }

    getChildren(element?: MyItem): MyItem[] {
        return element ? element.children ?? [] : this.rootItems();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
}

const provider = new MyTreeProvider();
const treeView = vscode.window.createTreeView('myView', { treeDataProvider: provider });
context.subscriptions.push(treeView);

## Webview Pattern (Core)

### Must include CSP with nonce

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const nonce = createNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
</head>
<body>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

### Webview Messaging

panel.webview.onDidReceiveMessage(message => {
    if (message.command === 'alert') {
        vscode.window.showInformationMessage(message.text);
    }
}, undefined, context.subscriptions);

## Language Feature Providers (Minimal Examples)

### Completion Provider

const completionProvider = vscode.languages.registerCompletionItemProvider(
    'typescript',
    {
        provideCompletionItems(): vscode.CompletionItem[] {
            const item = new vscode.CompletionItem('hello');
            item.detail = 'Example completion';
            return [item];
        }
    },
    '.'
);
context.subscriptions.push(completionProvider);

### Diagnostics

const diagnostics = vscode.languages.createDiagnosticCollection('ext');
context.subscriptions.push(diagnostics);

function updateDiagnostics(doc: vscode.TextDocument): void {
    const range = new vscode.Range(0, 0, 0, 5);
    const diagnostic = new vscode.Diagnostic(range, 'Example issue', vscode.DiagnosticSeverity.Warning);
    diagnostics.set(doc.uri, [diagnostic]);
}

## Async and Cancellation

When performing expensive operations, respect `CancellationToken`.

async function provideItems(token: vscode.CancellationToken): Promise<MyItem[]> {
    if (token.isCancellationRequested) return [];
    const items = await loadItems();
    if (token.isCancellationRequested) return [];
    return items;
}

## Testing with @vscode/test-cli

### .vscode-test.mjs

import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'out/test/**/*.test.js',
    version: 'stable',
    mocha: {
        ui: 'tdd',
        timeout: 20000
    }
});

### Basic test

suite('Extension Test Suite', () => {
    test('Extension activates', async () => {
        const ext = vscode.extensions.getExtension('publisher.extension-name');
        if (!ext) throw new Error('Extension not found');
        await ext.activate();
    });
});

## Project Structure (Typical)

my-extension/
- src/
  - extension.ts
  - commands/
  - providers/
  - views/
  - test/
- media/
- resources/
- package.json
- tsconfig.json
- .vscode-test.mjs

## Common Pitfalls

- Not disposing resources => memory leaks.
- Missing CSP in webviews => security risks.
- Slow activation => poor user experience.
- Hardcoded paths => cross-platform bugs.
- Using fs.*Sync in activation => UI freeze.

## References

- VS Code API reference
- VS Code Extension guides
