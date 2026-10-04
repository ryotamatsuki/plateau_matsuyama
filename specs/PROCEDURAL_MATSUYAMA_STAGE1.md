# Procedural Matsuyama Stage 1

## 目的と範囲
CesiumJS 1.130、PLATEAU松山市2020年度LOD1、GSI DEM10B＋GSIGEO2011を維持し、県庁〜大街道〜松山城南側の近景を改善する。

- west 132.7600 / south 33.8345 / east 132.7712 / north 33.8441
- center 132.7656, 33.8393 / 建物shader半幅525 m・535 m
- カメラが中心から3.6 km以上離れるとStage 1建物shaderと街路entitiesを非表示

## 建物
`docs/procedural-matsuyama-stage1.js` は初期建物タイル完了後にCustomShaderを設定する。PLATEAU形状・属性・建物照会は維持する。

- 外壁：既存の用途等の景観色へ暖色／中性色を穏やかに混ぜる。
- 窓：b3dmのBATCH_ID（`featureId_0`）で建物単位の種を生成。壁の接線方向へ約2.7〜3.15 mのベイ、3.1 mの階高を設定。ガラス色とroughnessを変える。
- 座標：ECEFの`positionWC`を直接差し引かず、eye coordinatesで中心を引いてから回転する。大きなECEF座標の丸めによる近景の窓の粗さを避ける。
- 屋根：上向き面を壁と異なる屋根材色・目地にする。勾配屋根のgeometry再構築は含まない。
- 正しいCesium fragment contract `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material)` を維持し、操作対象はdiffuse・roughnessのみ。
- Stage 1 OFF・簡易景観OFF・洪水／津波／土砂の建物色分け時はCustomShaderを取り外して元のshaderへ戻す。uniformの早期returnだけで無効化しない。

## AO・影
初期俯瞰ではAO・影を追加しない。desktopでは中心から3.6 km以内かつカメラ楕円体高300 m未満の近景で、通常景観モード・カメラ停止時のみ有効にする。

- shadow maximumDistance 300 m / map size 1024
- AO intensity 1.15 / bias 0.15 / lengthCap 0.32 / stepCount 4 / directionCount 4
- mobile：Stage 1によるAO・影の追加なし
- OFF・対象外・リスク表示・移動中には元の設定とuniform値へ復帰

## 道路・歩道
`docs/procedural-matsuyama-stage1-streets.js` は建物初期表示・地形ready後、対象近傍かつカメラ楕円体高900 m未満になってから初回ロードする。requestIdleCallback（fallbackあり）で開始し、道路6本・高さサンプル4地点ごとにmain threadをyieldする。

- Overpassの2エンドポイントを順に試す。各リクエストは25秒でabort。
- highway線形・建物outline・樹木／街灯nodeを取得。完全way geometryはbbox内にclip。
- 橋・トンネル・屋内／屋根付き・別levelの道を地表道路へ誤って重ねない。
- highway・lanes・明示widthから概略幅を決定し、車道幅は1.2〜14 m（小道は最大3 m）へ制限。
- 道路はterrain-only Corridor。低めの透明度・主要道の控えめな補間センターラインで航空写真を維持。
- sidewalk left/right/both/no/separateを区別。未記載の狭い道に歩道帯を自動追加しない。
- 歩道は道路の外側へoffsetし、OSM建物outlineを使って建物内の点を除外する。幅・outlineの未整備やデータ精度差まで保証するものではない。

## 樹木・街灯
OSMの実nodeを優先し、不足分だけ歩道側へ補間する。車道中心へ補間しない。OSM建物outline内の補間点を避け、樹木12 m・街灯16 mの最小間隔を設定する。

- DEMは既存`MatsuyamaTerrain.sampleEllipsoidHeight`を再利用。高さ不明時は物体を省略し、0 mへ置かない。
- cylinder・ellipsoidの分割を減らし、近景でのCPU/GPU負荷を抑制。
- entitiesのPropertyBagで`stage1`, `source: osm | interpolated`, `osmId`を保持。生成外観はOSM nodeがある場合も現況再現を保証しない。
- API `streetSamples()` は出典・座標・基準楕円体高を診断用に返す。
- desktop上限：道路260 / 樹木150 / 街灯160
- mobile上限：道路150 / 樹木70 / 街灯70
- 描画距離：道路2.2 km / 歩道1.8 km / 樹木1.2 km / 街灯1.0 km

## 通信・互換性
成功結果をlocalStorageに7日キャッシュする。cache schemaはv3。OSM attributionをCesium credit displayへ常設する。

Overpassが利用できなくても建物shader・航空写真・地形・ハザード・ウォーク・navigation・地点／建物照会・範囲分析は継続する。失敗はステータスで明示し、カメラ移動のたびに再取得しない。診断API `reloadOsm()` で再試行できる。

Stage 1は初期HTMLのcheckboxで切り替える。UIを後挿入してパネルの構造を動かさない。

## 検証
既存Immersive・Navigation・Thematic E2Eのassertionsを維持。Stage 1 OFF / shaderのみ / 全体ONの3条件で回帰検証する。WebKit主題図は既存CIと同じ独立scenarioで実行する。

`tests/procedural-stage1-e2e.mjs` はdesktop Chromium・iPhone WebKitでON/OFF、実クリックのhit test、全リスクモード、遠方非表示、AO/mobile軽量化、scene.pick、OSM成功／障害、高さ一致、source区別を検証する。OFF/ONの俯瞰・近景スクリーンショット、frame time・entities・heapをartifactへ記録する。

CIは外部Overpassに依存せず、2026-10-04にOSM公式APIから取得した同範囲のfixtureを使用する。ローカルbranch E2Eの建物タイルは、リポジトリに収録済みの同一PLATEAUデータを使用する。公開サイトの検証では公開配信データを読む。

## 表現の限界とStage 2
窓・外壁材・屋根材・補間歩道・センターライン・補間樹木・補間街灯は現況を保証するデータではない。UIで景観補間と明示する。OSM線形・幅・タグ・建物outlineも未整備や基準時点差がある。

Stage 2：LOD2／CityGMLによる勾配屋根・建物固有ファサード、道路／歩道面の公式geometry、PLATEAU footprintによる厳密な配置回避、植栽／照明台帳、GPU instancing、実機GPUでの高密度街路性能検証。
