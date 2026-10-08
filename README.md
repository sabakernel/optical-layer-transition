# Optical Noise Transition

WebGL 2.0 ベースの画像遷移エンジンです。複数の画像をレイヤーとして重ね、粒子状ノイズで滑らかに切り替えます。

WebGL2 が利用できない環境では、Canvas 2D の CPU フォールバックへ自動切り替わります。CPU 版の遷移エフェクトは簡易的な格子状ノイズですが、レイヤーと再生の仕様および API は共通です。

## 特徴

- WebGL2 による高速な GPU 描画
- **シーンベースの設計思想**: 複数画像を1つのレイヤーとして合成し、レイヤー間を遷移
- WebGL2 と CPU フォールバックでのアルファ付き画像の重ね合わせ
- 画像 URL を直接扱えるテクスチャロード機構
- 明確な状態遷移を持つ再生キュー API
- Deno + React + Vite で動くデモアプリ

## 設計思想

このライブラリは「複数画像を別々に遷移させる」のではなく、**複数の画像から1つのシーンを構築し、そのシーン間を遷移させる**という思想で設計されています。

```
Layer A (シーン1)
  ├─ background.jpg
  ├─ logo.png
  └─ decoration.png
        ↓ 合成
  [単一テクスチャ]
        ↓ GPU遷移
  [単一テクスチャ]
        ↑ 合成
Layer B (シーン2)
  ├─ background.jpg
  └─ title.png
```

各レイヤー内の画像は透明背景上で指定位置に配置され、CPU側で1枚のテクスチャに事前合成されます。GPU側のトランジションシェーダーはこの合成済みテクスチャ間でノイズエフェクトを適用するため、シンプルかつ高速です。

## インストール

このプロジェクトはDenoで管理されています。Node.jsは不要です。

```bash
deno task check
```

## 開発実行

```bash
cd demo
deno task dev
```

## ビルド

```bash
cd demo
deno task build
deno task preview  # ビルド結果のプレビュー
```

## 使い方

```ts
import { OpticalTransition } from "@sabakernel/optical-layer-transition";

const canvas = document.querySelector("canvas")!;
const transition = new OpticalTransition({
  canvas,
  width: 1280,
  height: 720,
});

await transition.setLayer({
  images: [
    {
      url: "/images/background.jpg",
      startX: 0,
      startY: 0,
      endX: 1280,
      endY: 720,
    },
    {
      url: "/images/logo.png",
      startX: 32,
      startY: 32,
      endX: 256,
      endY: 160,
    },
  ],
  duration: 1.8,
});

await transition.setLayer({
  images: [{
    url: "/images/next-scene.jpg",
    startX: 0,
    startY: 0,
    endX: 1280,
    endY: 720,
  }],
  duration: 1.8,
});

transition.play();
```

ひとつの `ImageLayer` に含めた画像は、指定位置で透明背景へ合成した後、ひとつの画像としてまとめて遷移します。`duration` は前のレイヤーからこのレイヤーへの遷移時間を指定します（最初のレイヤーは初期表示のため duration は使われません）。`clearAfterRender` はレイヤー内の全画像に共通です。

PNG などのアルファチャネルは合成時に保持されます。

### CPU フォールバック

`new OpticalTransition(...)` は内部で `canvas.getContext("webgl2")` を試し、利用可能なら WebGL2 を使います。

使えない場合は内部で Canvas 2D の CPU フォールバックへ切り替わり、ノイズ風の遷移を描画します。

```ts
const transition = new OpticalTransition({ canvas, width: 1280, height: 720 });
console.log(transition.mode); // "webgl2" or "cpu"
```

## API

### `OpticalTransition`

メインのクラスです。WebGL2 環境では `WebGLOpticalTransition`、そうでなければ `CpuOpticalTransition` が内部で使用されます。

#### メソッド

- `constructor({ canvas, width, height })`
  キャンバスと描画サイズを指定して初期化します。

- `async setLayer(layer: ImageLayer)`
  レイヤーをキューに追加します。画像合成は非同期で完了し、Promise で通知されます。
  - 最初の `setLayer()` 呼び出しで、そのレイヤーが即座に表示されます
  - 2番目以降の `setLayer()` 呼び出しで、次の遷移先がキューに追加されます
  - `duration` は前のレイヤーからの遷移時間を指定します（最初のレイヤーは無視）

- `play()`
  次のレイヤーへの遷移を開始します。
  - 条件: `layers.length >= 2` かつ `isPlaying === false`
  - Pause 中の場合、中断した位置から再開します
  - 最後のレイヤーに到達すると自動で停止します

- `pause()`
  遷移アニメーションを一時停止します。進行状況は保存され、次の `play()` から再開できます。

- `getLayers(): ImageLayer[]`
  現在のレイヤーキューの浅いコピーを返します。返却配列の追加・削除は内部キューに影響しませんが、配列内のレイヤーオブジェクト自体は内部と同じです。

- `getPlaybackState(): PlaybackState`
  現在の再生状態を返します。

- `setSize(width, height)`
  キャンバスサイズを変更します。

- `clearLayers()`
  現在表示中のレイヤーを保持し、キューをクリアします。キャンバスをクリアすることはありません。
  - 現在のレイヤーを第1レイヤー（インデックス0）として保持
  - `currentLayerIndex` が 0 にリセット
  - `nextLayerIndex` は `null`
  - `isPlaying` は `false`

- `replay()`
  キュー内のレイヤーを最初から再生します。
  - `currentLayerIndex` を 0 にリセット
  - `isPlaying` を `true` に設定（2つ以上のレイヤーがある場合）
  - 遷移が即座に開始されます

- `destroy()`
  インスタンスを完全に破棄し、全リソースを解放します。
  - `isDestroyed = true` フラグが設定されます
  - WebGL リソース（シェーダー、バッファ、テクスチャ）が削除されます
  - 破棄後は使用不可（再度の `setLayer()` 呼び出しなどは無視されます）
  - キャンバスは最後の画像を保持したまま

### `PlaybackState`

`getPlaybackState()` が返すオブジェクトです：

```ts
type PlaybackState = {
  currentLayerIndex: number;      // 現在表示中のレイヤーインデックス
  nextLayerIndex: number | null;  // 次に遷移するレイヤーインデックス（nullなら最後）
  isPlaying: boolean;             // 遷移アニメーション再生中か
};
```

### `ImageLayer`

```ts
interface ImageLayer {
  images: LayerImage[];
  duration: number;
  clearAfterRender?: boolean;
}

interface LayerImage {
  url: string;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}
```

- `images`: レイヤーに合成する画像群
- `duration`: 前のレイヤーからこのレイヤーへの遷移時間（秒）。最初のレイヤーは無視
- `clearAfterRender`: 次のレイヤーへの遷移完了後にこのレイヤーを消去するか（デフォルト: `false`）
- `LayerImage.url`: 画像の URL または data URI
- `LayerImage.startX`, `startY`, `endX`, `endY`: キャンバス上の描画範囲（ピクセル単位、省略可）

## 動作の詳細

### 基本的な再生フロー

```ts
const transition = new OpticalTransition({ canvas, width: 1280, height: 720 });

// 状態: { currentLayerIndex: 0, nextLayerIndex: null, isPlaying: false }
await transition.setLayer(layerA);
// → A が即座に表示

// 状態: { currentLayerIndex: 0, nextLayerIndex: 1, isPlaying: false }
await transition.setLayer(layerB);

// 状態: { currentLayerIndex: 0→1, nextLayerIndex: 1→null, isPlaying: true }
transition.play();
// → A から B への遷移が開始され、完了後は B が待機状態

// 状態: { currentLayerIndex: 1, nextLayerIndex: null, isPlaying: false }
// → B が表示されて待機

// 新しいレイヤーC を追加
await transition.setLayer(layerC);

// 再度play()で続きを再生
transition.play();
// → B→C への遷移開始
```

### `play()` と `pause()`

`play()` は次のレイヤーへの遷移を開始します。最後のレイヤーに到達すると自動で停止します。

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB);

transition.play();
// A→B への遷移開始

// 1秒後にpause
setTimeout(() => transition.pause(), 1000);
// 進行状況は保存される

// 後でplay()すると中断位置から再開
transition.play();
```

**条件:**
- `play()` は `isPlaying === true` または `layers.length < 2` の場合は無視されます
- Pause中の場合、`play()` で中断位置から再開します

### `replay()` — キュー全体の再実行

`replay()` は現在のキュー内のレイヤーを最初から再生します。

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB);

transition.play();
// 途中からでも最初から再生し直せる
transition.replay();
// → A から B への遷移が最初から開始される
```

### `clearLayers()` — キューのクリア

`clearLayers()` は現在表示中のレイヤーを保持し、その他のレイヤーをクリアします。

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB);
await transition.setLayer(layerC);

transition.play();
// A→B遷移中...

// B を保持、C をクリア
transition.clearLayers();
// 状態: { currentLayerIndex: 0, nextLayerIndex: null, isPlaying: false }
// → B がキャンバスに表示されたまま

// 新しいキューを追加
await transition.setLayer(layerX);
transition.play();
// → B→X への遷移が開始される
```

### 画像の合成

レイヤー内の複数画像は `setLayer()` 呼び出し時に CPU 側で合成されます：

```ts
await transition.setLayer({
  images: [
    { url: "/bg.jpg", startX: 0, startY: 0, endX: 1280, endY: 720 },
    { url: "/logo.png", startX: 32, startY: 32, endX: 256, endY: 160 },
    { url: "/overlay.png", startX: 800, startY: 500, endX: 1200, endY: 680 },
  ],
  duration: 1.5,
  clearAfterRender: false,
});
```

内部処理：
1. 全画像を非同期で読み込み
2. 透明キャンバスを作成
3. 各画像を指定座標に順番に描画（アルファ合成）
4. 合成済み画像を WebGL テクスチャに変換
5. キューに追加

GPU側の遷移はこの合成済みテクスチャ全体に対して適用されます。

## プロジェクト構成

```
.
├── demo/                  # Deno + React + Vite デモアプリ
│   ├── src/
│   │   ├── components/
│   │   │   └── TransitionDemo.tsx
│   │   ├── App.tsx
│   │   ├── App.css
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── deno.json
├── src/                   # ライブラリ本体
│   ├── core.ts            # メインレンダラと状態管理
│   ├── shader.ts          # WebGL シェーダー
│   ├── texture.ts         # テクスチャ読み込み・キャッシュ
│   ├── core_test.ts       # テスト
│   └── types.ts           # 型定義
├── mod.ts                 # 公開エントリ
├── deno.json              # Deno 設定
├── README.md              # このファイル
└── deno.lock
```

## 設計の利点

### シーンベースの抽象化

複数の画像を「1つのシーン」として扱うことで：

- **パフォーマンス**: GPU側は常に2枚のテクスチャ間で遷移するだけ
- **シンプルさ**: シェーダーコードが複雑化せず、保守しやすい
- **柔軟性**: レイヤー内の画像配置は自由。背景+UI要素、複数のオーバーレイなど任意の構成が可能
- **予測可能性**: 合成は同期的に完了し、遷移前の状態が確定する

### 明確な状態遷移

`getPlaybackState()` により、アプリケーション側で現在の状態を常に把握できます：

```ts
const state = transition.getPlaybackState();

if (state.isPlaying) {
  // 遷移アニメーション再生中
} else if (state.nextLayerIndex !== null) {
  // レイヤーが待機中 → play() で再生開始可能
} else {
  // 最後のレイヤーで待機中
  // → setLayer() で新しいレイヤーを追加するか
  //   replay() で再実行するか
  //   clearLayers() でリセットするか
}
```
