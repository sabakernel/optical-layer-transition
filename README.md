# Optical Noise Transition

WebGL 2.0
ベースの画像遷移エンジンです。複数の画像をレイヤーとして重ね、粒子状ノイズで滑らかに切り替えます。

WebGL2 が利用できない環境では、Canvas 2D の CPU
フォールバックへ自動切り替わります。CPU
版の遷移エフェクトは簡易的な格子状ノイズですが、レイヤーと再生の仕様および API
は共通です。

## 特徴

- WebGL2 による高速な GPU 描画
- **シーンベースの設計思想**:
  複数画像を1つのレイヤーとして合成し、レイヤー（シーン）間を遷移
- WebGL2 と CPU フォールバックでのアルファ付き画像の重ね合わせ
- WebGL2 が使えない場合の CPU フォールバック
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
import { OpticalTransition } from "@sabakernel/gl-noise-transition";

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
  duration: 1.8, // 最初のレイヤーなので、このdurationは使われない
  clearAfterRender: true,
});

await transition.setLayer({
  images: [{
    url: "/images/next-scene.jpg",
    startX: 0,
    startY: 0,
    endX: 1280,
    endY: 720,
  }],
  duration: 1.8, // 前のレイヤーからこのレイヤーへ1.8秒で遷移
});
transition.play();
```

ひとつの `ImageLayer`
に含めた画像は、指定位置で透明背景へ合成した後、ひとつの画像としてまとめて遷移します。`duration`
は前のレイヤーからこのレイヤーへの遷移時間を指定します（最初のレイヤーは初期表示のためdurationは使われません）。`clearAfterRender`
はレイヤー内の全画像に共通です。レイヤーは `setLayer()`
を呼ぶたびに再生キューへ追加します。

PNG などのアルファチャネルは合成時に保持されます。デモでは「Add image to
layer」で画像と位置を追加し、複数画像を含むレイヤーを組み立ててから「Add layer
to playback queue」でキューへ追加できます。

### CPU フォールバック

`new OpticalTransition(...)` は内部で `canvas.getContext("webgl2")`
を試し、利用可能なら WebGL2 を使います。

使えない場合は内部で Canvas 2D の CPU フォールバックへ切り替わり、
ノイズ風の遷移を描画します。

```ts
const transition = new OpticalTransition({ canvas, width: 1280, height: 720 });
console.log(transition.mode); // "webgl2" or "cpu"
```

## API

### `OpticalTransition`

- `constructor({ canvas, width, height })`
- `async setLayer(layer: ImageLayer)` — 画像を合成したレイヤーをキューへ追加する
- `async finish()` — 最後のレイヤーまで再生し、終了時に Promise
  を解決して画像を保持する
- `replay()` — キューを先頭から再生し直す
- `clear()` — キューと描画画像を消去する
- `getLayers(): ImageLayer[]` — 現在のキューを取得する
- `getPlaybackState(): PlaybackState` — 現在の再生状態を取得する
- `play()`
- `pause()`
- `setSize(width, height)`
- `destroy()`
- `mode: "webgl2" | "cpu"`

`setLayer()` に渡したレイヤーオブジェクトは内部に保持されます。呼び出し後に
レイヤーや `images` 配下の設定を変更すると、描画側にも影響する場合があります。
`getLayers()`
はレイヤー配列の浅いコピーを返すため、返却配列の追加・削除は内部キューに
影響しませんが、配列内のレイヤーやその画像設定は内部と同じオブジェクトです。

#### `PlaybackState`

```ts
type PlaybackState = {
  currentLayerIndex: number; // 現在表示中のレイヤーインデックス
  nextLayerIndex: number | null; // 次に遷移するレイヤーインデックス（nullなら最後）
  isPlaying: boolean; // 遷移アニメーション再生中か
  isFinished: boolean; // finish()完了状態か
};
```

### 状態遷移

```
初期状態
  ↓ setLayer(A)
[A表示] currentLayerIndex=0, nextLayerIndex=null, isPlaying=false
  ↓ setLayer(B)
[A表示] currentLayerIndex=0, nextLayerIndex=1, isPlaying=false
  ↓ play()
[A→B遷移中] currentLayerIndex=0→1, isPlaying=true
  ↓ 遷移完了
[B表示・待機] currentLayerIndex=1, nextLayerIndex=null, isPlaying=false
  ↓ setLayer(C)
[B表示・待機] currentLayerIndex=1, nextLayerIndex=2, isPlaying=false
  ↓ play()
[B→C遷移中] currentLayerIndex=1→2, isPlaying=true
  ↓ 遷移完了
[C表示・待機] currentLayerIndex=2, nextLayerIndex=null, isPlaying=false
  ↓ finish()
[C表示・完了] currentLayerIndex=2, nextLayerIndex=null, isFinished=true
  ↓ setLayer(D)
[C表示・完了] currentLayerIndex=2, nextLayerIndex=3, isFinished=true
  ↓ replay()
[A表示] currentLayerIndex=0, nextLayerIndex=1, isPlaying=true
[A→B→C→D順次遷移]
```

### 状態遷移の具体例

#### 例1: 基本的な再生フロー

```ts
const transition = new OpticalTransition({ canvas, width: 1280, height: 720 });

// 状態: { currentLayerIndex: 0, nextLayerIndex: null, isPlaying: false, isFinished: false }
await transition.setLayer(layerA); // duration: 1.0（使われない）
// 状態: { currentLayerIndex: 0, nextLayerIndex: null, isPlaying: false, isFinished: false }
// → A が即座に表示される

await transition.setLayer(layerB); // duration: 1.5
// 状態: { currentLayerIndex: 0, nextLayerIndex: 1, isPlaying: false, isFinished: false }

transition.play();
// 状態: { currentLayerIndex: 0→1, nextLayerIndex: 1→null, isPlaying: true, isFinished: false }
// → A から B への遷移が1.5秒かけて行われ、完了後は B が表示されて待機
```

#### 例2: durationの動作確認

```ts
await transition.setLayer({
  images: [{ url: "/sceneA.jpg", startX: 0, startY: 0, endX: 1280, endY: 720 }],
  duration: 999, // ← この値は無視される（最初のレイヤーなので）
});
// → sceneA が即座に表示

await transition.setLayer({
  images: [{ url: "/sceneB.jpg", startX: 0, startY: 0, endX: 1280, endY: 720 }],
  duration: 2.0, // ← A→B の遷移時間
});

await transition.setLayer({
  images: [{ url: "/sceneC.jpg", startX: 0, startY: 0, endX: 1280, endY: 720 }],
  duration: 1.0, // ← B→C の遷移時間
});

transition.play();
// A が表示 → 2.0秒かけて B へ遷移 → B が表示 → 1.0秒かけて C へ遷移 → C が表示
```

#### 例3: pause()と再開

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB); // B.duration = 2.0
transition.play();

// 遷移途中で一時停止（進行状況は保存される）
setTimeout(() => {
  transition.pause();
  // 状態: { currentLayerIndex: 0, nextLayerIndex: 1, isPlaying: false, isFinished: false }
}, 1000); // 1秒後 = 進行状況50%

// レイヤーCを追加
await transition.setLayer(layerC);

// 再開 - A→B の残り50%（1秒）から続行
transition.play();
// → A→B 完了後、自動的に B→C へ遷移
```

#### 例4: finish()後の動作

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB);

await transition.finish();
// 状態: { currentLayerIndex: 1, nextLayerIndex: null, isPlaying: false, isFinished: true }
// → B が表示され、完了状態

await transition.setLayer(layerC);
// 状態: { currentLayerIndex: 1, nextLayerIndex: 2, isPlaying: false, isFinished: true }
// → C は即座には表示されない。B が表示されたまま

transition.play();
// → B から C への遷移が始まる（layerC.durationの時間をかけて）

// または
transition.replay();
// → A から順に A→B→C と再生
```

#### 例5: replay()の挙動

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB);
await transition.setLayer(layerC);

transition.play();
// A→B と遷移中...

transition.replay();
// 状態: { currentLayerIndex: 0, nextLayerIndex: 1, isPlaying: true, isFinished: false }
// → 即座に A から再スタートし、A→B→C と順次遷移

// または finish() 後
await transition.finish();
await transition.setLayer(layerD);
transition.replay();
// → A→B→C→D と全レイヤーを再生
```

```ts
const transition = new OpticalTransition({ canvas, width: 1280, height: 720 });

await transition.setLayer(layerA);
await transition.setLayer(layerB);
await transition.setLayer(layerC);

// 最後のレイヤーまで再生し終わるのを待ち、画像を保持
await transition.finish();

// 完了したキューを先頭から再生し直す
transition.replay();

// キューとキャンバスを空にする
transition.clear();
```

### 動作の詳細

#### `play()`と`pause()`

`play()`
は次のレイヤーへの遷移を開始します。最後のレイヤーに到達すると自動で停止し、**待機状態**になります。この状態から`setLayer()`で新しいレイヤーを追加すると、再度`play()`で続きを再生できます。

`pause()`
は遷移アニメーションを一時停止します。再度`play()`を呼ぶと**中断した位置から再開**します。進行状況は保存されるため、途中からシームレスに続けられます。

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB); // B.duration = 2.0

transition.play();
// A→B への遷移開始

// 1秒後にpause
setTimeout(() => transition.pause(), 1000);
// 進行状況50%の位置で一時停止

// 後でplay()すると残り1秒から再開
transition.play();
// 残り50%の遷移を完了
```

#### `finish()`

`finish()`
は最後のレイヤーまで自動再生し、完了時にPromiseを解決します。完了状態では最終レイヤーの画像が保持されます。

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB);

// Bまで自動再生し、完了を待つ
await transition.finish();

// 完了後もレイヤー追加可能
await transition.setLayer(layerC);

// 再度finish()すればCまで再生
await transition.finish();
```

#### `replay()`

`replay()`
はキュー内のレイヤーを先頭から再生し直します。`finish()`完了後でなくても呼び出せます。

```ts
await transition.setLayer(layerA);
await transition.setLayer(layerB);
transition.play();

// 途中でも先頭から再生し直せる
transition.replay(); // A→Bが最初から

await transition.finish();
await transition.setLayer(layerC);

// finish()後のreplay()は全レイヤーを再生
transition.replay(); // A→B→C
```

#### `setLayer()`と画像合成

`setLayer()`
は非同期で画像を読み込み、レイヤー内の全画像を透明背景上で指定位置に合成します。合成は完全にCPU側で完了し、1枚のテクスチャとしてキャッシュされます。

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
// ↑ 3枚の画像が合成され、1枚のテクスチャとしてキューに追加される
```

`clearAfterRender: true`
を指定すると、次のレイヤーへの遷移完了後にこのレイヤーの合成画像全体が消去されます。

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

- `images`: レイヤーに合成する画像群。各画像の範囲は個別に指定できる
- `duration`: **前のレイヤーからこのレイヤーへの遷移時間**（秒）
- `clearAfterRender`:
  次のレイヤーへのトランジション完了後にこのレイヤーを消去するか（省略時
  `false`）
- `LayerImage.url`: 画像の URL または data URI
- `LayerImage.startX`, `startY`, `endX`, `endY`:
  キャンバス上の描画範囲（ピクセル単位）

**重要**:

- レイヤー内の全画像は `setLayer()` 呼び出し時に Canvas 2D
  で1枚のテクスチャに合成されます
- 最初のレイヤー（インデックス0）の`duration`は使用されません（初期表示のため遷移がない）
- 2番目以降のレイヤーの`duration`が、そのレイヤーへの遷移時間として使われます

#### 画像合成の詳細

```ts
// 例: 3枚の画像を1つのレイヤーとして合成
await transition.setLayer({
  images: [
    // 背景: 全画面
    { url: "/background.jpg", startX: 0, startY: 0, endX: 1280, endY: 720 },
    // ロゴ: 左上
    { url: "/logo.png", startX: 32, startY: 32, endX: 256, endY: 160 },
    // オーバーレイ: 右下（透明PNG）
    { url: "/overlay.png", startX: 800, startY: 500, endX: 1200, endY: 680 },
  ],
  duration: 1.8, // 前のレイヤーからこのレイヤーへの遷移時間
  clearAfterRender: false,
});
```

この場合の内部処理：

1. 3つの画像URLを非同期で読み込み
2. 1280x720の透明キャンバスを作成
3. 各画像を指定座標に順番に描画（アルファ合成）
4. 完成した1枚の画像をWebGLテクスチャに変換
5. キューに追加

遷移時はこの合成済みテクスチャ全体にノイズエフェクトが適用されます。

## プロジェクト構成

```text
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
│   └── types.ts           # 型定義
├── mod.ts                 # 公開エントリ
├── deno.json              # Deno 設定
├── README.md              # このファイル
└── deno.lock
```

## 設計の利点

### シーンベースの抽象化

複数の画像を「1つのシーン」として扱うことで：

- **パフォーマンス**:
  GPU側は常に2枚のテクスチャ間で遷移するだけ（N枚の画像を個別に処理する必要がない）
- **シンプルさ**: シェーダーコードが複雑化せず、保守しやすい
- **柔軟性**:
  レイヤー内の画像配置は自由。背景+UI要素、複数のオーバーレイなど任意の構成が可能
- **予測可能性**: 合成は同期的に完了し、遷移前の状態が確定する

### 明確な状態遷移

`getPlaybackState()` により、アプリケーション側で現在の状態を常に把握できます：

```ts
const state = transition.getPlaybackState();
if (state.isPlaying) {
  // 遷移アニメーション中
} else if (state.isFinished) {
  // 完了状態
} else if (state.nextLayerIndex !== null) {
  // 次のレイヤーが存在し、待機中
} else {
  // 最後のレイヤーで待機中
}
```

これにより、UI（再生ボタンの有効/無効、進行状況の表示など）との連携が容易です。