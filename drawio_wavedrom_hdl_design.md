# draw.io + WaveDrom + HDL連携プラグイン 設計仕様

## 1. 目的

HDL（Verilog / SystemVerilog / VHDL）を一次情報とし、
- **設計構造**：draw.io（diagrams.net）
- **動作例（タイミング）**：WaveDrom
を **VSCode 上で統合的に扱える設計・ドキュメント環境**を構築する。

本プロジェクトのゴールは、
> *「図を書く」ではなく「設計意図を再生成可能な形で可視化する」*
ことである。

---

## 2. 全体アーキテクチャ

```
HDL Source (truth)
   │
   ▼
HDL → WaveDrom Generator
   │   (JSON)
   ▼
VSCode Extension
   │   postMessage
   ▼
draw.io WebView
   │   Custom Plugin
   ▼
WaveDrom SVG Shapes
```

### レイヤ責務

| レイヤ | 主な責務 | 非責務 |
|---|---|---|
| HDL | 真実の設計 | 図表現 |
| Generator | 意図抽出・要約 | 正確なシミュレーション |
| VSCode拡張 | 操作・連携 | 描画処理 |
| draw.io | レイアウト・階層 | HDL解析 |
| WaveDrom | 波形生成 | 設計構造管理 |

---

## 3. 基本設計方針（重要）

### 3.1 設計原則
- HDLを**完全解析しない**
- 自動生成は**例示波形**に限定
- 図は**派生物**であり再生成可能
- XMLを直接編集しない
- JSON（WaveDrom）を真実とする

### 3.2 アンチパターン
- HDLから全信号を自動波形化
- draw.ioの内部XML直接操作
- VCD/FSDBのそのまま可視化

---

## 4. VSCode拡張 設計

### 4.1 役割
- draw.io WebView のホスト
- HDLファイルの検出
- HDL → WaveDrom 生成の起動
- draw.io へのデータ送信

### 4.2 提供コマンド
| コマンド | 内容 |
|---|---|
| Open Draw.io | draw.io を開く |
| Generate WaveDrom | HDLからWaveDrom生成 |
| Insert WaveDrom | 図中へ挿入 |
| Regenerate | 再生成 |

### 4.3 通信形式
```ts
postMessage({
  type: "insert-wavedrom",
  payload: wavedromJson
});
```

---

## 5. HDL → WaveDrom 生成器 設計

### 5.1 目的
- HDL中の**設計意図**を抽出
- WaveDrom JSON を生成

### 5.2 入出力
**入力**
- HDLファイル

**出力**
```json
{
  "meta": {
    "source": "fifo.sv",
    "module": "fifo",
    "level": "L1"
  },
  "signal": []
}
```

### 5.3 コメント駆動方式（最小実装）
```verilog
// @wavedrom clk
input clk;

// @wavedrom reset async
input reset;

// @wavedrom state fsm
state_t state;
```

### 5.4 抽象度レベル
| レベル | 内容 |
|---|---|
| L0 | clk / reset |
| L1 | 制御信号 |
| L2 | データ遷移 |

---

## 6. draw.io プラグイン設計

### 6.1 役割
- WaveDrom JSON → SVG 変換
- 図形として挿入
- 再編集 UI 提供
- 階層ブロック管理

### 6.2 WaveDrom 図形仕様
- SVG + metadata に JSON 埋め込み
- 図形ダブルクリックで編集
- 再レンダリング可能

### 6.3 階層構造ルール
```
Module (Group)
 ├─ Sub Block
 │    └─ WaveDrom Shape
 └─ Sub Block
      └─ WaveDrom Shape
```

---

## 7. WaveDrom データモデル

### 7.1 基本構造
```json
{
  "signal": [
    { "name": "clk", "wave": "p...." },
    { "name": "state", "wave": "x.3.4", "data": ["IDLE","RUN"] }
  ]
}
```

### 7.2 拡張属性（予定）
- `align`: 親時間軸との同期
- `offset`: 相対時間
- `level`: 抽象度

---

## 8. ファイル構成案
```
project-root/
 ├─ vscode-extension/
 │   ├─ src/extension.ts
 │   └─ media/
 │       ├─ drawio.html
 │       ├─ drawio-plugin.js
 │       └─ wavedrom.min.js
 ├─ hdl2wavedrom/
 │   ├─ parser.ts
 │   └─ generator.ts
 └─ docs/
```

---

## 9. 開発ロードマップ

### v0.1
- draw.io in VSCode
- 手動 WaveDrom 挿入

### v0.2
- HDLコメント → WaveDrom
- 再生成

### v0.3
- 階層ブロック
- FSM対応

### v0.4（将来）
- HDL/VCD連携
- AI補助生成

---

## 10. 将来拡張アイデア
- HDL ↔ WaveDrom 双方向同期
- Assertion から波形生成
- バスプロトコルテンプレ（AXI等）
- AIによる設計意図要約

---

## 11. 成功条件
- HDL変更後に図を**再生成できる**
- 図がレビューに使える
- Git差分が意味を持つ
- 手描き修正が不要

---

## 12. まとめ
本設計は、
- HDL（真実）
- WaveDrom（意図）
- draw.io（構造）
を分離しつつ統合することで、
**壊れない・育つ設計ドキュメント**を実現する。
