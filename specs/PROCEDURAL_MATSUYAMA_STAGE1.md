# Procedural Matsuyama Stage 1

## 目的
既存のCesiumJS防災GISを維持しながら、県庁〜大街道〜松山城南側の中心市街地だけを近景・徒歩視点向けに高精細化する。

## 対象範囲
- west: 132.7600
- south: 33.8345
- east: 132.7712
- north: 33.8441
- shader local half extent: east-west 525 m / north-south 535 m
- street objects are hidden when the camera is more than 3.6 km from the area center.

## 実装
### 1. 外壁・窓
`docs/procedural-matsuyama-stage1.js` がPLATEAU 3D Tilesへ `Cesium.CustomShader` を設定する。
LOD1形状自体は変更せず、壁面法線、ローカル座標、疑似乱数から外壁トーン、窓ベイ、ガラスの色調とroughnessを生成する。

### 2. 屋根
上向き法線の面を屋根として扱い、瓦・金属屋根を想起させる色と目地を付加する。
Stage 1ではLOD1の箱形状から勾配屋根を再構築しない。形状生成はCityGML footprint/LOD2を用いる次段階の対象とする。

### 3. 道路・歩道
`docs/procedural-matsuyama-stage1-streets.js` が対象bboxのOpenStreetMap highwayをOverpass APIから取得する。
highway種別とlanesから車道幅、sidewalk属性と道路種別から歩道帯を決定し、Cesium Corridorとして地形上へ描画する。主要道路には簡易センターラインを付加する。

### 4. 街路樹・街灯
OSMの `natural=tree` と `highway=street_lamp` を優先する。
不足時は主要道路等に沿って景観用オブジェクトを補間する。補間結果は実在施設・台帳情報ではない。

### 5. AO・影
PCではStage 1対象付近のみ `viewer.shadows` とCesium Ambient Occlusionを有効化する。
モバイルではAOを無効とし、道路・樹木・街灯の表示上限を引き下げる。

### 6. 防災GISとの共存
`riskMode` が通常表示以外の場合、建物CustomShaderのuniformを0にして既存の洪水・津波・土砂リスク色を優先する。
OSM取得に失敗しても建物shader、地形、ハザード、地点照会等の既存機能は継続する。

## データとキャッシュ
OSMはOverpass APIの2エンドポイントを順次試し、成功結果をlocalStorageへ7日間キャッシュする。
OpenStreetMap attributionをCesium credit displayへ追加する。

## 性能ガード
- desktop: roads 260 / trees 150 / lamps 160
- mobile: roads 150 / trees 70 / lamps 70
- tree distance display: 1.8 km
- lamp distance display: 1.5 km
- streets layer distance gate: 3.6 km
- DEM height sampling: existing `MatsuyamaTerrain.sampleEllipsoidHeight` を再利用

## 限界
Stage 1は視覚品質の改善であり、生成窓・外壁材・屋根材・補間樹木・補間街灯は現況を保証しない。
正確な屋根形状、ファサード、道路構造、植栽・照明台帳の再現には追加の公式データまたはLOD2/現地データが必要。
