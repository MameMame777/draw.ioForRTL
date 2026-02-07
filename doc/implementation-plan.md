# DrawWave 実装計画書

## 1. プロジェクト概要

| 項目 | 内容 |
|------|------|
| **名称** | DrawWave |
| **種別** | VSCode 拡張機能 |
| **目的** | draw.io + WaveDrom + HDL を VSCode 上で統合的に扱う設計・ドキュメント環境 |
| **ライセンス** | GPL-3.0（draw.io バンドルの要件） |
| **公開形式** | GitHub OSS |
| **対象HDL** | Verilog (.v) / SystemVerilog (.sv) |

---

## 2. アーキテクチャ

```
┌─────────────────────────────────────────────┐
│ VSCode Extension Host (TypeScript)          │
│  ├─ commands/         コマンド登録・ディスパッチ │
│  ├─ hdl/              HDLパーサー・波形生成    │
│  ├─ templates/        テンプレートJSONライブラリ │
│  ├─ truthTable/       真理値表ロジック・描画    │
│  └─ providers/        WebViewプロバイダ群      │
├─────────────────────────────────────────────┤
│ WebView A: WaveDrom Preview                 │
│  └─ wavedrom.min.js → SVGレンダリング        │
├─────────────────────────────────────────────┤
│ WebView B: draw.io Editor                   │
│  ├─ drawio webapp (バンドル, ~50MB)          │
│  └─ drawio-plugin-wavedrom.js               │
│       ├─ WaveDrom SVG図形挿入               │
│       └─ 真理値表テーブル図形               │
└─────────────────────────────────────────────┘
```

### データフロー

```
HDL Source (.v/.sv)
   │  // @wavedrom アノテーション
   ▼
HdlParser → WaveDromGenerator
   │  WaveDrom JSON
   ▼
WaveDromPreviewProvider ──→ WebView (SVGプレビュー)
   │
   ▼
DrawioEditorProvider ──→ draw.io WebView
   │  postMessage
   ▼
mxGraph カスタム図形 (SVG + metadata)
```

---

## 3. ファイル構成

```
DrawWave/
├── package.json                    拡張マニフェスト
├── tsconfig.json                   TypeScript設定 (strict: true)
├── LICENSE                         GPL-3.0
├── .vscodeignore                   パッケージ除外設定
├── .gitignore
├── .eslintrc.json                  リント設定
├── .vscode/
│   └── launch.json                 デバッグ設定
├── src/
│   ├── extension.ts                エントリポイント
│   ├── types/
│   │   ├── wavedrom.d.ts           WaveDrom型定義 (自作)
│   │   └── types.ts                共通型定義
│   ├── providers/
│   │   ├── WaveDromPreviewProvider.ts   WaveDromプレビュー
│   │   ├── DrawioEditorProvider.ts      draw.ioエディタ
│   │   └── TemplatePickerProvider.ts    テンプレート選択UI
│   ├── hdl/
│   │   ├── HdlParser.ts            HDLコメント解析
│   │   ├── WaveDromGenerator.ts     WaveDrom JSON生成
│   │   └── HdlWatcher.ts           ファイル監視・再生成
│   ├── truthTable/
│   │   ├── TruthTableGenerator.ts   真理値表ロジック
│   │   └── TruthTableRenderer.ts    draw.io XML描画
│   └── templates/
│       ├── index.ts                 テンプレートレジストリ
│       ├── basic/
│       │   ├── clock-reset.json
│       │   ├── clock-enable.json
│       │   ├── data-bus.json
│       │   └── interrupt.json
│       ├── bus/
│       │   ├── axi4-write.json
│       │   ├── axi4-read.json
│       │   ├── axi4-lite.json
│       │   ├── ahb-transfer.json
│       │   ├── spi-transaction.json
│       │   ├── i2c-transaction.json
│       │   └── uart-frame.json
│       ├── fsm/
│       │   ├── simple-fsm.json
│       │   └── protocol-fsm.json
│       ├── memory/
│       │   ├── sram-read.json
│       │   ├── sram-write.json
│       │   └── ddr-burst.json
│       ├── pipeline/
│       │   ├── 3stage-pipeline.json
│       │   ├── pipeline-stall.json
│       │   └── pipeline-forward.json
│       └── handshake/
│           ├── valid-ready.json
│           ├── req-ack.json
│           └── credit-based.json
├── media/
│   ├── wavedrom-preview.html        プレビューHTML
│   ├── wavedrom.min.js              WaveDromライブラリ
│   ├── default.js                   WaveDromスキン
│   ├── drawio/                      draw.io webapp バンドル
│   ├── drawio-plugin-wavedrom.js    draw.ioカスタムプラグイン
│   └── style.css                    共通スタイル
├── test/
│   ├── hdl/
│   │   ├── parser.test.ts
│   │   └── generator.test.ts
│   ├── truthTable/
│   │   └── generator.test.ts
│   └── fixtures/
│       ├── sample.sv
│       └── sample.v
└── doc/
    ├── implementation-plan.md       本ドキュメント
    └── user-guide.md                ユーザーガイド (後日)
```

---

## 4. コマンド一覧

| コマンドID | 表示名 | 説明 |
|-----------|--------|------|
| `drawwave.openWaveDromPreview` | DrawWave: Open WaveDrom Preview | WaveDromプレビューパネルを開く |
| `drawwave.openDrawio` | DrawWave: Open Draw.io Editor | draw.ioエディタを開く |
| `drawwave.insertTemplate` | DrawWave: Insert Template | テンプレート選択→新規ファイル/挿入 |
| `drawwave.generateFromHDL` | DrawWave: Generate from HDL | HDLファイルからWaveDrom JSON生成 |
| `drawwave.insertWaveDromToDrawio` | DrawWave: Insert WaveDrom to Diagram | WaveDrom SVGをdraw.ioに挿入 |
| `drawwave.insertTruthTable` | DrawWave: Insert Truth Table | 真理値表をdraw.ioに挿入 |
| `drawwave.regenerate` | DrawWave: Regenerate | HDLから再生成 |
| `drawwave.exportSvg` | DrawWave: Export as SVG | WaveDromをSVGファイルとして保存 |
| `drawwave.exportPng` | DrawWave: Export as PNG | WaveDromをPNGファイルとして保存 |

---

## 5. 実装ステップ詳細

### Step 1: プロジェクトスキャフォールド

**成果物:** package.json, tsconfig.json, .vscode/launch.json, LICENSE, .gitignore, .vscodeignore

**package.json 主要設定:**
- `engines.vscode`: `^1.85.0`
- `activationEvents`: `onCommand:drawwave.*`, `onLanguage:json`
- `main`: `./out/extension.js`
- `contributes.commands`: 上記コマンド全て
- `contributes.customEditors`: WaveDrom JSON プレビュー用

**依存パッケージ:**
| パッケージ | 用途 | devDependency |
|-----------|------|:---:|
| `wavedrom` | SVGレンダリング | No |
| `onml` | JsonML→SVG文字列変換 | No |
| `@types/vscode` | VSCode API型定義 | Yes |
| `typescript` | コンパイラ | Yes |
| `@vscode/vsce` | パッケージング | Yes |
| `eslint` | コード品質 | Yes |
| `@vscode/test-cli` | テスト基盤 | Yes |

### Step 2: 拡張エントリポイント + コマンド登録

**extension.ts の構成:**
```typescript
export async function activate(context: vscode.ExtensionContext) {
    // 1. プロバイダ初期化
    const waveDromProvider = new WaveDromPreviewProvider(context);
    const drawioProvider = new DrawioEditorProvider(context);
    const templatePicker = new TemplatePickerProvider(context);
    
    // 2. コマンド登録 → context.subscriptions に push
    // 3. FileSystemWatcher 登録 (.v, .sv)
    // 4. CustomEditor 登録
}

export function deactivate() {
    // 全リソース破棄
}
```

### Step 3: WaveDrom プレビュー WebView

**機能:**
- `.wavedrom.json` ファイルのライブプレビュー
- テキストエディタの JSON 変更をデバウンス（300ms）でリアルタイム反映
- SVG/PNG エクスポート
- CSP 準拠（nonce付きスクリプト、`webview.asWebviewUri()` 使用）

**通信プロトコル:**
```typescript
// Extension → WebView
{ type: "update", payload: wavedromJson }
{ type: "export", format: "svg" | "png" }

// WebView → Extension
{ type: "export-result", format: string, data: string }
{ type: "error", message: string }
```

**レンダリング処理:**
```javascript
// media/wavedrom-preview.html 内
const jsonml = WaveDrom.renderAny(0, source, WaveDrom.waveSkin);
const svg = onml.stringify(jsonml);
document.getElementById('container').innerHTML = svg;
```

### Step 4: テンプレートライブラリ

**テンプレート JSON 構造:**
```json
{
  "meta": {
    "name": "AXI4 Write Channel",
    "category": "bus",
    "description": "AXI4 Write Address + Write Data + Write Response",
    "tags": ["axi", "amba", "write", "bus"]
  },
  "signal": [...]
}
```

**カテゴリ別テンプレート一覧:**

#### 4-1. 基本デジタル信号 (basic/)
| ファイル | 内容 |
|---------|------|
| clock-reset.json | clk + async/sync reset パターン |
| clock-enable.json | clk + clock enable |
| data-bus.json | addr + data + valid |
| interrupt.json | IRQ + ACK |

#### 4-2. バスプロトコル (bus/)
| ファイル | 内容 |
|---------|------|
| axi4-write.json | AXI4 AW + W + B チャネル |
| axi4-read.json | AXI4 AR + R チャネル |
| axi4-lite.json | AXI4-Lite 簡易版 |
| ahb-transfer.json | AHB Single/Burst 転送 |
| spi-transaction.json | SPI (SCLK, MOSI, MISO, CS) |
| i2c-transaction.json | I2C (SCL, SDA, Start/Stop) |
| uart-frame.json | UART (Start, Data[7:0], Parity, Stop) |

#### 4-3. FSM状態遷移 (fsm/)
| ファイル | 内容 |
|---------|------|
| simple-fsm.json | IDLE→RUN→DONE 3状態 |
| protocol-fsm.json | REQ→GRANT→XFER→DONE |

#### 4-4. メモリアクセス (memory/)
| ファイル | 内容 |
|---------|------|
| sram-read.json | SRAM Read (CE, OE, addr, data) |
| sram-write.json | SRAM Write (CE, WE, addr, data) |
| ddr-burst.json | DDR Burst Read/Write |

#### 4-5. パイプライン (pipeline/)
| ファイル | 内容 |
|---------|------|
| 3stage-pipeline.json | Fetch/Decode/Execute |
| pipeline-stall.json | ストール・バブル |
| pipeline-forward.json | データフォワーディング |

#### 4-6. ハンドシェイク (handshake/)
| ファイル | 内容 |
|---------|------|
| valid-ready.json | AXI-Stream風 valid/ready |
| req-ack.json | Request / Acknowledge |
| credit-based.json | クレジットベースフロー制御 |

**テンプレート選択 UI:**
1. QuickPick でカテゴリ選択（アイコン付き）
2. QuickPick でテンプレート選択（説明文付き）
3. 選択肢: 「新規ファイルとして作成」or「現在のエディタに挿入」

### Step 5: draw.io WebView 統合

**バンドル方式:**
- draw.io の GitHub リリースから webapp をダウンロード
- `media/drawio/` に配置（約50MB）
- WebView 内で iframe として読み込み

**通信プロトコル (Extension ↔ draw.io):**
```typescript
// Extension → draw.io
{ type: "load", xml: string }         // 図を読み込み
{ type: "insert-wavedrom", svg: string, json: string }  // WaveDrom挿入
{ type: "insert-truth-table", xml: string }              // 真理値表挿入

// draw.io → Extension
{ type: "save", xml: string }         // 保存
{ type: "export", format: string, data: string }
{ type: "ready" }                     // 初期化完了
```

**draw.io プラグイン (drawio-plugin-wavedrom.js):**
- WaveDrom SVG をカスタム図形として登録
- 図形の `style` に `wavedromJson=...` として元データを保持
- ダブルクリック → JSON 編集ダイアログ → 再レンダリング
- サイドバーに WaveDrom パレット追加

### Step 6: 真理値表機能

**入力方式:**
1. コマンド実行 → InputBox で信号リスト入力（例: `a, b -> y`）
2. 論理式入力（例: `y = a & b | ~c`）
3. 手動テーブル定義（JSON形式）

**TruthTableGenerator ロジック:**
```typescript
interface TruthTableDef {
    inputs: string[];
    outputs: { name: string; expression: string }[];
}

interface TruthTable {
    inputs: string[];
    outputs: string[];
    rows: { inputs: boolean[]; outputs: boolean[] }[];
}
```

**論理式パーサー:**
| 演算子 | 記法 | 優先度 |
|--------|------|--------|
| NOT | `~`, `!` | 最高 |
| AND | `&`, `&&` | 高 |
| XOR | `^` | 中 |
| OR | `\|`, `\|\|` | 低 |
| 括弧 | `()` | 最低 |

**描画:**
- draw.io の mxGraph テーブル図形 (`shape=table`) として XML 生成
- ヘッダ行: 入力信号名（青背景）| 出力信号名（緑背景）
- データ行: 0/1 値、交互背景色
- 挿入先: 現在開いている draw.io ダイアグラム

### Step 7: HDL → WaveDrom 生成器

**コメントアノテーション仕様:**
```verilog
// @wavedrom <signal_name> [type] [options...]
//
// type:
//   clk      - クロック信号 (自動的に 'p' パターン)
//   reset    - リセット信号 (active-high/low 自動判定)
//   data     - データ信号 (ビット幅に応じた表示)
//   ctrl     - 制御信号 (H/L パターン)
//   fsm      - FSM状態 (enum の状態名を data に変換)
//   bus      - バス信号 (多ビットデータ)
//
// options:
//   async    - 非同期信号
//   active_low - 負論理
//   width:N  - ビット幅指定
```

**パーサーの責務:**
1. `module` 宣言の検出と名前の取得
2. `// @wavedrom` コメントの検出
3. 直後の信号宣言（`input`/`output`/`reg`/`wire`/`logic`）の解析
4. ビット幅の抽出（`[N:0]` パターン）
5. `parameter`/`localparam` の列挙（FSM状態名用）

**生成ルール:**
| 信号タイプ | 生成される wave パターン |
|-----------|------------------------|
| clk | `p........` (周期的) |
| reset (async) | `1.0.......` |
| reset (sync) | `10........` |
| data | `x.=.=.=...` (data配列付き) |
| ctrl | `0.1.0.....` |
| fsm | `x.3.4.5...` (状態名をdata配列に) |
| bus | `x.=.=.=...` (アドレス/データ値付き) |

**抽象度レベル:**
| レベル | 含まれる信号 | 用途 |
|--------|------------|------|
| L0 | clk, reset | 基本確認 |
| L1 | + ctrl, fsm | 制御フロー確認 |
| L2 | + data, bus | 詳細タイミング |

---

## 6. 設計上の決定事項

| 項目 | 決定 | 理由 |
|------|------|------|
| draw.io 統合方式 | webapp バンドル (iframe) | hediet拡張に非依存で完全制御可能 |
| ライセンス | GPL-3.0 | draw.io の GPL 要件 |
| 真理値表描画先 | draw.io mxGraph テーブル | ブロック図と統合可能、WaveDromに非依存 |
| WaveDrom 型定義 | 自作 `.d.ts` | `@types/wavedrom` が npm に存在しない |
| テンプレート格納 | JSON ファイル (extension内蔵) | Git管理可能、ユーザー拡張可能 |
| HDL対象 | Verilog / SystemVerilog のみ | スコープ限定、VHDL は将来対応 |
| 公開形式 | GitHub OSS | Marketplace は将来検討 |

---

## 7. 通信・セキュリティ設計

### CSP (Content Security Policy)
```html
<meta http-equiv="Content-Security-Policy" 
  content="default-src 'none';
    img-src ${webview.cspSource} data:;
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    font-src ${webview.cspSource};">
```

### WebView 通信
- `vscode.postMessage()` / `webview.onDidReceiveMessage()` のみ使用
- 直接 DOM 操作やファイルアクセスは行わない
- メッセージは型付きインターフェースで定義

---

## 8. Disposable管理

```typescript
// すべての Disposable を context.subscriptions に push
context.subscriptions.push(
    waveDromProvider,
    drawioProvider,
    ...commandDisposables,
    hdlWatcher
);

// カスタムクラスは vscode.Disposable を実装
class WaveDromPreviewProvider implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    
    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
```

---

## 9. 実装スケジュール

| ステップ | 内容 | 依存関係 |
|---------|------|---------|
| Step 1 | プロジェクトスキャフォールド | なし |
| Step 2 | 拡張エントリポイント + コマンド登録 | Step 1 |
| Step 3 | WaveDrom プレビュー WebView | Step 2 |
| Step 4 | テンプレートライブラリ | Step 2 |
| Step 5 | draw.io WebView 統合 | Step 2 |
| Step 6 | 真理値表機能 | Step 5 |
| Step 7 | HDL → WaveDrom 生成器 | Step 3 |
| Step 8 | 統合テスト・仕上げ | Step 3-7 |

**並列可能な作業:**
- Step 3 と Step 4 と Step 5 は並列実装可能
- Step 6 は Step 5 完了後
- Step 7 は Step 3 完了後

---

## 10. テスト方針

| テスト対象 | 方法 | ツール |
|-----------|------|--------|
| HDLパーサー | ユニットテスト | @vscode/test-cli + mocha |
| WaveDrom生成 | ユニットテスト | @vscode/test-cli + mocha |
| 真理値表ロジック | ユニットテスト | @vscode/test-cli + mocha |
| テンプレートJSON | スキーマバリデーション | JSON Schema |
| WebView表示 | 手動テスト | Extension Development Host |
| draw.io連携 | 手動テスト | Extension Development Host |
| 全コマンド動作 | 手動テスト | Extension Development Host |

---

## 11. 検証基準

- [ ] `npm run compile` が成功する
- [ ] F5 で Extension Development Host が起動し、全コマンドがパレットに表示される
- [ ] `.wavedrom.json` ファイルを開いて SVG がレンダリングされる
- [ ] テンプレート挿入で6カテゴリ全テンプレートが選択可能
- [ ] `.drawio` ファイルが WebView で開ける
- [ ] WaveDrom SVG が draw.io 図形として挿入できる
- [ ] 真理値表が draw.io 内にテーブルとして挿入される
- [ ] `@wavedrom` コメント付き `.sv` ファイルから WaveDrom JSON が生成される
- [ ] HDLファイル変更時に再生成が動作する
