# Procedural Matsuyama Stage 1

## 目的と範囲
CesiumJS 1.130、PLATEAU松山市2020年度LOD1、GSI DEM10B＋GSIGEO2011を維持し、県庁〜大街道〜松山城南側の近景を改善する。

- west 132.7600 / south 33.8345 / east 132.7712 / north 33.8441
- center 132.7656, 33.8393 / 建物shader半幅525 m、535 m
- カメラが中心から3.6 km以上離れるとStage 1建物shaderと街路entitiesを非表示

## 建物
`docs/procedural-matsuyama-stage1.js` は初期建物タイル完了後、対象近傍かつカメラ高900m未満でCustomShaderを初回設定する。

初期俯瞰ではshaderの生成も開始しない。

PLATEAUの形状、属性、建物照会は維持する。

- 外壁：既存の用途等の景観色へ暖色／中性色を穏やかに混ぜる。

- 窓：b3dmのBATCH_ID（`featureId_0`）で建物単位の種を生成。
  壁の接線方向へ約2.7〜3.15 mのベイ、3.1 mの階高を設定。
  ガラス色とroughnessを変える。

- 座標：ECEFの`positionWC`を直接差し引かず、eye coordinatesで中心を引いてから回転する。
  大きなECEF座標の丸めによる近景の窓の粗さを避ける。

- 屋根：上向き面を壁と異なる屋根材色、目地にする。
  勾配屋根のgeometry再構築は含まない。

- 正しいCesium fragment contract `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material)` を維持し、操作対象はdiffuse、roughnessのみ。

- Stage 1 OFF、簡易景観OFF、洪水／津波／土砂の建物色分け時は`u_on=0`の早期returnでmaterial編集を直ちに停止する。
  初期OFFではshaderを作らない。
  一度生成したshaderはコンパイル済みpipelineを保持し、切替のたびに全モデルを再構築して操作を停滞させない。
  元のlighting modelを継承し、risk表示のmaterialを変更しない。
  debugの`shader`は景観編集の有効性、`shaderAttached`はpipelineの保持状態を表す。

## AO、影
初期俯瞰ではAO、影を追加しない。
desktopでは中心から3.6 km以内かつカメラ楕円体高300 m未満の近景で、通常景観モード、カメラ停止時のみ有効にする。

- shadow maximumDistance 300 m / map size 1024
- AO intensity 1.15 / bias 0.15 / lengthCap 0.32 / stepCount 4 / directionCount 4
- mobile：Stage 1によるAO、影の追加なし
- OFF、対象外、リスク表示、移動中には元の設定とuniform値へ復帰

## 道路、歩道
`docs/procedural-matsuyama-stage1-streets.js` は建物初期表示、地形ready後、対象近傍かつカメラ楕円体高900 m未満になってから初回ロードする。
requestIdleCallback（fallbackあり）で開始し、道路6本、高さサンプル4地点ごとにmain threadをyieldする。

- Overpassの2エンドポイントを順に試す。
  各リクエストは25秒でabort。

- highway線形、建物outline、樹木／街灯nodeを取得。
  完全way geometryはbbox内にclip。

- 橋、トンネル、屋内／屋根付き、別levelの道を地表道路へ誤って重ねない。

- highway、lanes、明示widthから概略幅を決定し、車道幅は1.2〜14 m（小道は最大3 m）へ制限。

- 道路、歩道はCesium CorridorGeometryでメートル幅、MITEREDの輪郭を生成し、1枚の透明なSingleTileImageryProviderへまとめてGSI地形にdrapeする。
  desktop 2048px / mobile 1024px。
  数百の地表classification描画を避け、ハザード、主題図の下に配置する。
  道路ごとのsource、osmId、幅、clip済み線形はroadRecords()で保持する。
  低めの透明度、主要道の控えめな補間センターラインで航空写真を維持。

- sidewalk left/right/both/no/separateを区別。
  未記載の狭い道に歩道帯を自動追加しない。

- 歩道は道路の外側へoffsetし、4mごとにサンプルし、OSM建物outlineを使って建物内の点を除外する。
  幅、outlineの未整備やデータ精度差まで保証するものではない。

## 樹木、街灯
OSMの実nodeを優先し、不足分だけ歩道側へ補間する。
車道中心へ補間しない。
OSM建物outline内の補間点を避け、樹木12 m、街灯16 mの最小間隔を設定する。

- DEMは既存`MatsuyamaTerrain.sampleEllipsoidHeight`を再利用。
  高さ不明時は物体を省略し、0 mへ置かない。

- cylinder、ellipsoidの分割を減らし、近景でのCPU/GPU負荷を抑制。

- entitiesのPropertyBagで`stage1`, `source: osm | interpolated`, `osmId`を保持。
  生成外観はOSM nodeがある場合も現況再現を保証しない。

- API `streetSamples()` は出典、座標、基準楕円体高を診断用に返す。

- desktop上限：道路260 / 樹木150 / 街灯160
- mobile上限：道路150 / 樹木70 / 街灯70
- 道路面はカメラ高1.3 km以上で非表示。
  樹木1.2 km / 街灯1.0 kmの描画距離制限。

## 通信、互換性
成功結果をlocalStorageに7日キャッシュする。
cache schemaはv3。
OSM attributionをCesium credit displayへ常設する。

Overpassが利用できなくても建物shader、航空写真、地形、ハザード、ウォーク、navigation、地点／建物照会、範囲分析は継続する。
失敗はステータスで明示し、カメラ移動のたびに再取得しない。
診断API `reloadOsm()` で再試行できる。

Stage 1は初期HTMLのcheckboxで切り替える。
UIを後挿入してパネルの構造を動かさない。

## 検証
既存Immersive、Navigation、Thematic E2Eのassertionsを維持。
Stage 1 OFF / shaderのみ / 全体ONの3条件で回帰検証する。
WebKit主題図は既存CIと同じ独立scenarioで実行する。

`tests/procedural-stage1-e2e.mjs` はdesktop Chromium、iPhone WebKitでON/OFF、実クリックのhit test、全リスクモード、遠方非表示、AO/mobile軽量化、scene.pick、OSM成功／障害、高さ一致、source区別を検証する。
OFF/ONの俯瞰、近景スクリーンショット、frame time、entities、heapをartifactへ記録する。

CIは外部Overpassに依存せず、2026-10-04にOSM公式APIから取得した同範囲のfixtureを使用する。
ローカルbranch E2Eの建物タイルは、リポジトリに収録済みの同一PLATEAUデータを使用する。
公開サイトの検証では公開配信データを読む。

## 表現の限界とStage 2
窓、外壁材、屋根材、補間歩道、センターライン、補間樹木、補間街灯は現況を保証するデータではない。
UIで景観補間と明示する。
OSM線形、幅、タグ、建物outlineも未整備や基準時点差がある。

Stage 2：LOD2／CityGMLによる勾配屋根、建物固有ファサード、道路／歩道面の公式geometry、PLATEAU footprintによる厳密な配置回避、植栽／照明台帳、GPU instancing、実機GPUでの高密度街路性能検証。

## 操作中の描画と更新の競合対策

建物色の更新は次のframeを要求して行う。

一時的にtileset.showをfalseにする処理を除き、続けてリスクモードを切り替えた際に、古いRAF callbackが非表示状態を復元する競合を防ぐ。

Navigationの減速設定は直接setViewする。

通常flightはduration＋100msの期限で最終姿勢へ移る。

遷移中だけ建物SSEを64以上、地形SSEを6以上へ軽量化し、終了時に開始前の設定を復元する。
resolutionScaleは航行で変更しない。
CPUプロファイルではCanvasサイズ変更とWebGLのgetProgramParameterが長い同期待ちを占め、航行時の解像度変更は逆効果だった。

遷移時間は実測し、既存E2Eの700〜2200msと減速設定650ms未満の判定を維持する。
テストで変更した背景、ハザード、リスク色と地上タイルが準備できてから航行時間を測定する。
初回shader linkと通常航行の所要時間を混同しない。
CPUプロファイルをActions artifactに保存する。

共有リスク索引は32,768件ごとに処理をyieldする。

全293,313件のID参照と、対象bbox内1,526件の範囲照会結果と順序が元の実装と一致することを確認した。

避難所は同じタイルの取得中にcamera.moveEndが起きても重複取得しない。

checkbox操作による更新は継続し、古い応答が新しい表示状態を上書きしないようにする。

Stage 1ステータス欄は固定高とし、取得結果の改行数による設定パネルの移動を抑える。

DOM状態の待ちは100msのtimer pollingを使う。
実クリック後に正しいDOM状態が確認できても、WebGLのRAF待ちがtimeoutする実行があったため、DOMの条件と描画frameの進行を分けて観測する。
通常のクリックとスクロールのフレーム安定待ちは90秒まで許容し、elementFromPointによる入力対象とclickからchangeまで250ms未満の応答を別途検証する。
強制クリックやDOMのclick()呼び出しで操作を迂回しない。
WebKitのタッチからclick生成までの約300msは、UIのchange処理時間と分ける。

Thematic E2Eで使っていた1px PNGはIDATのCRCが不正だった。

正常にdecodeできる256px PNGへ置き換えた後、WebKitの地質、避難所、雨雲ケースの成功を確認した。

実操作はpage.checkとpage.clickで検証し、DOMのclick呼び出しによる代替は行わない。

公開QAでは、mobileのウォーク終了直後のキャンバス寸法変更によって、描画前の黒い画面が診断画像に入っていた。
Stage 1 OFFでも同じ画像を確認した。
終了後にresizeとpostRenderを同期し、描画画素とWebGL context lossを検証してから撮影する。

ハザード切替から40ms後の自動濃度設定が、直後の手動スライダー操作を上書きする既存競合も修正した。
濃度を手動変更した後は、セッション内の自動24%／62%設定より手動値を優先する。
自動設定のinputイベントを手動操作と区別し、Navigation E2Eで遅延コールバックとの競合を同じタスク内で再現して検証する。

## 性能比較の記録

最終E2Eは各視点の最初の3frameの準備時間をwarmupMsとして保存し、その後8秒以上のframe timeを記録する。
初回の建物pickとGPUプログラム準備の所要時間も別に記録する。
以下はこの測定分離前の履歴値であり、最新の値はActionsのstage1-performance.jsonを参照する。

[commit 2175fd9の専用E2E](https://github.com/ryotamatsuki/plateau_matsuyama/actions/runs/37209164535)で、fixtureを使った初回readyとframe timeを比較した。

値は1回の測定であり、desktopはCIのSwiftShader、mobileはLinux WebKitのiPhone viewportを用いた。

実機GPUのFPSを示す値ではない。

| 指標 | desktop OFF | desktop ON | mobile OFF | mobile ON |
| --- | ---: | ---: | ---: | ---: |
| 初回ready（秒） | 31.36 | 31.48 | 20.72 | 16.73 |
| 650m俯瞰 FPS | 1.60 | 1.59 | 10.72 | 10.28 |
| 近景 FPS | 1.03 | 1.20 | 4.02 | 3.91 |
| 近景frame time中央値（ms） | 921.8 | 1041.7 | 267.0 | 277.0 |
| 表示中の街路Entity数 | 0 | 66 | 0 | 66 |

道路面の集約前はdesktop 458個、mobile 335個のEntityを生成していた。

集約後は道路面1レイヤーと樹木12本、街灯21基の66個のEntityになった。

取得可能なdesktop heapは約225MBの粗い報告値で、ONとOFFに差がなく、mobileでは取得できなかった。

初期俯瞰でOSM要求が0件であること、shader未生成であること、AOと影を追加しないことも専用E2Eで確認する。

## 公開サイトでのQA記録

[mainの初回公開検証](https://github.com/ryotamatsuki/plateau_matsuyama/actions/runs/37222194838)では、公開URLでImmersive、Navigation、Stage 1専用E2Eが成功した。
公開配信のPLATEAU、標高、解析データを読み、Stage 1専用のOSM成功／障害ケースだけをfixtureで固定した。
以下はマージSHA `0b6bf23eaf8de21436d5862bf2e50f2f716800ca` の1回の測定である。

| 指標 | desktop OFF | desktop ON | iPhone viewport OFF | iPhone viewport ON |
| --- | ---: | ---: | ---: | ---: |
| 初回ready（秒） | 29.40 | 34.20 | 14.98 | 14.57 |
| 650m俯瞰 FPS | 1.14 | 1.12 | 11.21 | 11.20 |
| 近景 FPS | 0.50 | 1.50 | 4.05 | 3.73 |
| 近景frame中央値（ms） | 2066.6 | 16.7 | 253 | 275 |
| 近景最長frame（ms） | 2883.2 | 4483.2 | 266 | 290 |

mobile近景は約8%低下した。
desktopはソフトウェアGPUの同期待ちで変動し、初回pickは35.33秒、mobileは0.521秒だった。
desktopの中央値16.7msだけを快適性の根拠にはしない。
初回readyはdesktopで遅く、branch計測ではONが速かったため、単発値から起動の性能差を確定しない。
初期ONが追加shader、AO、影、OSM要求、street entitiesを開始しないことは別途assertする。

この後の公開QAではmobile終了時の描画画素検証と手動ハザード濃度の競合検証を追加した。
公開ワークフローはImmersive、Navigation、Stage 1、Thematicを別の工程として実行し、最新の画像と性能JSONをartifactに保存する。
最新の実行結果と画像評価はPR #10の公開検証記録を参照する。


## 最終公開検証（run #30）

最終コード（main `ca9f20a61cbf07e78ec9bbd31e002950063e34e3`）の公開ワークフロー [run #30](https://github.com/ryotamatsuki/plateau_matsuyama/actions/runs/37225290160) は成功した。公開URLに対して Immersive、Navigation、Stage 1、Thematic を順に実行し、Chromium / WebKit の全ケースがPASSした。

最終公開artifact `deployed-immersive-e2e-screenshots` の `stage1-performance.json` から得た1回の参考値は次のとおり。desktopはGitHub ActionsのSwiftShader、iPhone viewportはLinux WebKitであり、実機GPUの性能を表さない。

| 指標 | desktop OFF | desktop ON | iPhone viewport OFF | iPhone viewport ON |
| --- | ---: | ---: | ---: | ---: |
| 初回ready（秒） | 37.06 | 36.75 | 18.21 | 18.65 |
| 650m俯瞰 FPS | 0.82 | 0.74 | 9.09 | 8.97 |
| 近景 FPS | 0.52 | 1.19 | 3.33 | 3.24 |
| 近景frame中央値（ms） | 1699.9 | 16.7 | 307.0 | 319.5 |
| 初回建物pick（秒） | — | 42.84 | — | 0.701 |
| Stage 1街路Entity数 | 0 | 66 | 0 | 66 |

mobile近景FPSはこの1回では約2.9%低下し、frame中央値は約4.1%増加した。desktopはSwiftShaderの長いGPU同期待ちに支配され、OFF/ON比較も大きく変動するため、16.7msという中央値だけから快適性を判断しない。実機GPUのcold shader/pick、高密度街路性能はStage 2で測定する。

公開E2Eではmobileウォーク終了後に `visibleFraction=1`、canvas 322×478、`contextLost=false` を確認した。最終desktop／iPhone viewport画像を目視し、黒画面がないこと、Stage 1 ON/OFF後に建物・地形・航空写真が描画されることを確認した。ハザード濃度の手動値保持はNavigation E2Eに含め、遅延自動設定との競合を再現した上でPASSしている。

近景画像ではLOD1由来の半透明建物が重なって見える箇所が残る。これは既存の建物透過表現とLOD1形状の制約であり、Stage 1の窓・屋根表面補間では完全には解消しない。建物固有ファサード、勾配屋根、実機GPU最適化と併せてStage 2の対象とする。
