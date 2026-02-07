# DrawWave - VS Code Extension

## Project Overview
Integrated draw.io + WaveDrom + HDL design environment for VSCode.
Provides WaveDrom timing diagram preview, template library, draw.io block diagram editing, truth table generation, and HDL-driven waveform generation.

## Technology Stack
- **Language**: TypeScript (strict mode)
- **Platform**: VS Code Extension API
- **Build**: TypeScript Compiler (tsc)
- **Package**: vsce
- **License**: GPL-3.0 (draw.io bundling requirement)

## Project Structure
```
src/
├── extension.ts           # Extension entry point, command registration
├── types/
│   ├── wavedrom.d.ts      # WaveDrom type definitions (hand-crafted)
│   └── types.ts           # Common types, enums, interfaces
├── providers/
│   ├── WaveDromPreviewProvider.ts   # WaveDrom JSON → SVG preview WebView
│   ├── DrawioEditorProvider.ts      # draw.io embed WebView editor
│   └── TemplatePickerProvider.ts    # Template category/selection UI
├── hdl/
│   ├── HdlParser.ts        # Verilog/SV @wavedrom comment parser
│   ├── WaveDromGenerator.ts # Parsed HDL → WaveDrom JSON generation
│   └── HdlWatcher.ts       # FileSystemWatcher for .v/.sv changes
├── truthTable/
│   ├── TruthTableGenerator.ts  # Boolean expression → truth table
│   └── TruthTableRenderer.ts   # Truth table → draw.io XML table shape
└── templates/
    ├── index.ts             # Template registry and search
    ├── basic/               # Clock, reset, data bus, interrupt
    ├── bus/                 # AXI4, AHB, SPI, I2C, UART
    ├── fsm/                 # State machine patterns
    ├── memory/              # SRAM, DDR patterns
    ├── pipeline/            # CPU pipeline patterns
    └── handshake/           # Valid/ready, req/ack, credit-based
```

## Coding Standards
- Use `async/await` for asynchronous operations
- Prefer `const` over `let`
- Use strict TypeScript (`strict: true`)
- Dispose all VS Code resources in `deactivate()`
- Push all disposables to `context.subscriptions`
- Use CSP with nonce for WebView scripts
- Use `webview.asWebviewUri()` for media paths
- Use `postMessage`/`onDidReceiveMessage` for WebView communication

## Commands
- `npm run compile` - Build TypeScript
- `npm run watch` - Watch mode
- `npx @vscode/vsce package` - Create .vsix

## Testing
- Press F5 in VS Code to launch Extension Development Host
- Test files in test/fixtures/ (sample.sv, sample.v)
- All commands prefixed with "DrawWave:" in command palette

## Agent Skills
- `typescript-vscode-extension` - VS Code extension patterns

## typescript-vscode-extension
VS Code extension development patterns in TypeScript. Use when creating extensions, registering commands, implementing providers, building webviews, or testing VS Code extensions.