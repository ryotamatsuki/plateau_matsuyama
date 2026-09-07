# 松山 3D ハザードマップ

松山市のPLATEAU 2020年度（標準製品仕様v4）の建物LOD1データを使用するCesiumJS製ウェブGIS。

## 公開構成
- GitHub Pages: GitHub Actionsが `main` ブランチの `/docs` を公開。初回は原典から建物を取得して同じリポジトリに保存してから公開する。
- `data/buildings/`: 指定データセットの3D Tiles建物LOD1を無改変で保存。全2,133ファイル、1,468,973,027バイト。原データの整備範囲をそのまま収録し、区域外の建物を生成・補完しない。
- `data/elevation/`: PLATEAU建物範囲を覆う国土地理院DEM10B PNG（z1–14）と、同範囲のGSIGEO2011 Ver.2.2ジオイド高サブセットを保存。Actionsは既存PNGを検査して再利用し、50タイル単位でコミットするため、中断後も不足分だけ再開取得する。
- Pages公開時に `data/elevation/` を `docs/elevation/` へコピーし、ブラウザは公開サイト内のローカル標高キャッシュから地形を生成する。
- ページ本体と建物を分離し、建物をGitHub Rawから表示範囲に応じて取得。Pages公開物の容量を抑える。大量アクセス時はGitHub Rawの配信制限に注意。
- `docs/source-metadata.json`: G空間情報センターCKAN APIの取得時メタデータ。
- `docs/data-config.json`: 建物の読み込み先。将来の専用タイル配信にも切替可能。

## 機能
3D建物、建物属性表示、洪水（想定最大規模）・津波・土砂災害3種類の切替（高潮は公式配信一覧に愛媛県が含まれないため選択不可）、レイヤー透明度、地理院淡色・標準・航空写真、主要地点移動、俯瞰表示、スマートフォン向け設定パネル。

## 標高と高さ基準
- 国土地理院DEM10Bの標高は東京湾平均海面を基準とする標高（orthometric height）として読み込む。
- PLATEAUのCityGMLはEPSG:6697（JGD2011 + 東京湾平均海面基準の標高）を使用するが、Cesium用3D Tilesでは地球楕円体上の3次元座標として描画される。
- ブラウザ側でGSIGEO2011 Ver.2.2のジオイド高 `N` を補間し、`楕円体高 h = 標高 H + ジオイド高 N` としてDEMをCesium地形へ渡す。
- 従来の建物全体への一律 `-34 m` 平行移動は廃止した。補正値は位置に応じて変化する。
- DEM10B・PLATEAUとも取得時点・解像度・地表表現に差がある。測量、構造物高さの精密計測、浸水深の実測には使用しない。

## データ・利用条件
- 原典: https://www.geospatial.jp/ckan/dataset/plateau-38201-matsuyama-shi-2020
- 使用アーカイブ: https://assets.cms.plateau.reearth.io/assets/76/85a84e-28a7-4e37-83c2-23a0498255a3/38201_matsuyama-shi_city_2020_3dtiles_mvt_7_op.zip
- 原典の建物LOD1のみ収録。LOD2、CityGML、その他地物・PLATEAU収録ハザードは本リポジトリに含まない。
- ハザード: https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html
- 背景・標高タイル: https://maps.gsi.go.jp/development/ichiran.html
- 標高PNG仕様: https://maps.gsi.go.jp/development/demtile.html
- 日本のジオイド2011: https://www.gsi.go.jp/buturisokuchi/grageo_reference.html
- 建物は2020年度時点のデータ。ハザードは閲覧時点の外部配信であり、基準日は建物と一致しない。
- ハザードは地表へのラスタ重ね合わせであり、3D水面や建物別の浸水判定ではない。属性に収録された過去の浸水想定と、外部ハザード配信は異なる場合がある。
- 無着色には未整備・未配信・取得失敗も含まれる。避難判断には自治体の最新情報を確認。
- データの利用・再配布は原典の利用規約に従う。アプリ画面内にも出典を表示。

## 更新・ローカル起動
`docs` 内のHTML/CSS/JS、`tools`、または公開ワークフローを変更してmainにpushするとActionsが標高キャッシュの不足分を確認してPagesへ反映する。
`python tools/fetch_gsi_elevation.py --max-new 50` で標高キャッシュを手動更新できる。既存の有効PNGは再取得しない。
`python -m http.server 8000 --directory docs` で起動し http://localhost:8000 を開く。WebGL・インターネット接続が必要。APIキーは不要。

## 検証
`python scripts/validate.py` で全タイル参照、ファイルサイズ、バイナリヘッダーとローカル資産を検証。
`python -m py_compile tools/fetch_gsi_elevation.py` で取得スクリプトを構文検証。
`node --check docs/app.js` と `node --check docs/gsi-terrain.js` でブラウザコードを構文検証。
