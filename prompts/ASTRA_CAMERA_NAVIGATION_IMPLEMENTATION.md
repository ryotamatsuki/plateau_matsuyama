# Astra実装プロンプト：松山3Dハザードマップ 飛翔カメラ＋高速ナビゲーション

あなたは `ryotamatsuki/plateau_matsuyama` の lead CesiumJS engineer、3D GIS interaction engineer、mobile performance engineer として作業する。

Repository:

https://github.com/ryotamatsuki/plateau_matsuyama

## 最重要ルール

作業開始前に、必ず `main` の最新版を取得し、次のcanonical仕様書を全文読むこと。

`specs/CAMERA_NAVIGATION_SPEC.md`

GitHub URL:

https://github.com/ryotamatsuki/plateau_matsuyama/blob/main/specs/CAMERA_NAVIGATION_SPEC.md

この仕様書を本タスクのsource of truthとする。実装都合で仕様を弱めないこと。仕様と現コードが競合する場合は、まず現コードの構造・既存挙動・データ依存を調査し、既存機能を壊さない形で仕様を満たすこと。

## 目的

現在の松山3Dハザードマップに、地上視点と空中・俯瞰視点を高速かつ連続的に行き来できるナビゲーションを実装する。

単なるカメラプリセット切替ではなく、次の体感を実現すること。

- 地上からその地点を中心に飛び上がる
- 上昇と同時にpitchが変化し、街区全体の斜め俯瞰へ入る
- 俯瞰で別地点を見つけ、その地点へ滑らかに降下できる
- 着地直後からそのまま防災ウォークを開始できる
- PC、iPhone/iPadとも操作が軽快
- 地上移動の体感は松山城3D散歩と同等以上にサクサクしている

参考として現状の名目速度は、防災ウォークがおおむね通常2.2m/s・高速4.2m/s、松山城3D散歩がおおむね通常2.3m/s・Shift時4.0m/sである。したがって単純に速度定数だけを上げて完了としないこと。入力、カメラ追従、地形追従、描画負荷、状態遷移を含めて体感を改善すること。

## 必ず最初に調査する対象

最低限、次を読むこと。

- `README.md`
- `docs/app.js`
- `docs/walk-mode.js`
- `docs/immersive-gis.js`
- `docs/index.html`
- `docs/style.css`
- `.github/workflows/` 配下
- `tests/` 配下
- `scripts/validate.py`

さらに、現行GitHub Pagesの公開構成と、カメラを変更しているコードパスを全件確認すること。

特に、`app.js` の主要地点移動・俯瞰処理、`walk-mode.js` のフレームごとのcamera更新、`immersive-gis.js` の3D Tiles移動時SSE最適化が互いに競合しない設計にすること。

## 実装方針

### 1. カメラ状態を一元化

少なくとも次の状態を明示的に管理する。

- `GROUND`
- `TRANSITION_TO_OVERVIEW`
- `OVERVIEW`
- `TRANSITION_TO_GROUND`

推奨として `docs/navigation-controller.js` を新設する。

ただし既存構造を詳細に調査した結果、別のファイル構成の方が安全であれば変更してよい。重要なのは、同じフレームで `walk-mode.js` とCesium標準camera controllerと遷移アニメーションが同時にcameraを書き換えないことである。

### 2. Ground → Overview

現在の地上位置を出発点として、約1秒で離陸・上昇・pitch変更を連続させる。

瞬間的なteleportは禁止。

要件はcanonical仕様書の第4章に従う。

- headingを可能な限り維持
- 上昇しながら斜め俯瞰へ
- 現在地点を見失わない
- easingを使用
- 終了時にCesium通常俯瞰操作へ自然に引き渡す

`Cesium.Camera.flyTo` / `flyToBoundingSphere` をそのまま使って十分な軌道になるなら利用してよい。要件を満たせない場合は `requestAnimationFrame` 等で独自補間を実装する。

### 3. Overview → Ground

画面中央の地表を原則着地点にする。

建物屋根を地上歩行の開始面として採用しないこと。terrain/globe上の地点へ解決する。

降下中にGround側の位置・heading・ground height等を同期し、着地完了の次フレームからWASD/モバイルスティックで移動可能にする。

### 4. Ground移動を軽快化

canonical仕様書の初期目標値を使用する。

- 通常 `2.8 m/s`
- 高速 `5.0 m/s`

ただし最終値は実ブラウザQAで調整してよい。

重要なのは数値より体感である。

必ず確認する点:

- キー押下から移動開始までに不要な待ちがないか
- `setInterval(30Hz)` が視覚的な30Hz感を生んでいないか
- camera更新をrender frameと同期させるべきか
- terrain標高更新が移動処理をブロックしていないか
- mobile analog throttleの最低値・dead zoneが重すぎないか
- UI更新やrisk判定を毎フレーム行いすぎていないか

高頻度の入力・位置・camera更新と、低頻度でよいterrain/risk/UI更新を分離すること。

### 5. UI

PCとモバイルの双方に、Ground/Overviewを1操作で切り替える導線を追加する。

PC:

- `F` でGround ↔ Overview
- UIボタンからも同じ操作
- `Shift` 高速移動を維持

Mobile:

- 「飛ぶ / 降りる」または意味が同等に明快な主要ボタン
- safe area対応
- MOVE/CAMERA同時タッチを壊さない
- 遷移後もタッチ状態が壊れない

既存UIと重なったり、防災レイヤ操作を妨げたりしないこと。

### 6. レンダリング最適化

`immersive-gis.js` の移動中SSE緩和を活かす。

遷移中に必要なら一時的に描画負荷を下げ、停止後に品質を戻す。

ただし、PLATEAU建物やハザードが一時的に大きく消える、または安全情報を誤認させるほど簡略化する実装は禁止。

モバイルでは特に、devicePixelRatio、shadow、3D water、tile SSE、requestRenderModeとの相互作用を確認すること。

### 7. 既存機能を壊さない

次はすべて維持する。

- PLATEAU建物
- 建物属性
- 洪水、津波、土砂等のハザード
- 建物別リスク色
- 背景地図切替
- 地形・DEM・ジオイド補正
- 3D水面
- 主要地点移動
- 出典・注意書き
- スマートフォン向け設定

視点切替だけでレイヤ設定や透明度が初期化されることは禁止。

### 8. motion accessibility

`prefers-reduced-motion: reduce` に対応する。

ロール、不要なcamera shake、急なFOV変更は入れない。

## テスト

既存テストを全部実行する。さらに、新しい状態遷移について再現可能なテストを追加する。

最低限、次を自動またはブラウザ統合テストで確認する。

1. Ground → Overviewへ遷移する
2. Overview → Groundへ遷移する
3. 着地後にwalk stateとcameraが一致する
4. 遷移中に二重camera制御が発生しない
5. レイヤ選択状態が遷移前後で保持される
6. `F` キーが機能する
7. mobile viewportで主要ボタンが画面外・既存UI上に出ない
8. reduced motionで代替挙動になる
9. JS syntax errorがない

既存validationも実行する。

例:

- `python scripts/validate.py`
- `node --check docs/app.js`
- `node --check docs/walk-mode.js`
- 新規JSも `node --check`
- repositoryに既存のbrowser/E2E test commandがある場合はそれを使用

## 実描画QA

コードが通るだけで完了としない。

ローカルまたはCI artifact/GitHub Pagesで実描画を確認する。

最低2viewport:

- Desktop 1440×900程度
- iPhone相当 390×844程度

可能なら実機相当のcoarse pointerでも確認する。

確認内容:

- 地上から飛び上がる動きが自然か
- 約1秒で俯瞰へ入るか
- cameraの方角が途中で反転しないか
- 降下先が屋根ではなく地面か
- 着地にteleport感がないか
- 着地直後の移動が即応するか
- mobile joystickがサクサク反応するか
- UI重なりがないか
- 遷移中にPLATEAUが極端にちらつかないか
- ハザード表示が維持されるか

体感が悪ければ、定数・補間曲線・SSE・入力ループを調整し、再確認すること。

## Git / PR / deployment

実装用branchを作成する。

実装、テスト、QAを完了したらPRを作成する。

CIが失敗した場合は、失敗原因を特定して修正し、再実行する。単なる再実行だけで済ませない。

すべてのrequired checkがgreenで、canonical仕様書のAcceptance Criteriaを満たした場合のみmainへmergeする。

merge後はmainのGitHub Actions / GitHub Pages deploymentを確認する。

公開ページで最終描画を確認し、mainと公開物が一致していることを確認する。

## 完了報告

途中経過だけで止まらないこと。

最終報告では最低限、次を明示する。

- 実装したcamera state machine
- Ground→Overviewの軌道と時間
- Overview→Groundの着地点決定方法
- Ground移動の最終速度・入力ループ
- モバイル操作改善内容
- 描画最適化内容
- 追加・更新したテスト
- CI結果
- PR番号とmerge commit
- GitHub Pagesの公開確認結果
- canonical仕様書のAcceptance Criteria 15項目のPASS/FAIL表

未達項目が1つでもある場合は「完了」と判定せず、その原因と次の修正を実施してから再検証すること。

最終判定は、すべて満たした場合のみ次の文言とする。

`CAMERA NAVIGATION UX PASS`
