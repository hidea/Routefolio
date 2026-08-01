# Route Visualizer

GPXから、太い経路線、進行方向、地点注記、背景地図、標高図を備えたモノクロのルート画像を生成するWebアプリです。

日本国内では国土地理院の淡色地図、国外ではOpenStreetMapを背景に使用します。出典は画面と保存画像の双方に表示されます。

## 起動

このディレクトリで次を実行します。

```sh
npm run dev
```

表示されたローカルURLをブラウザで開きます。GPXはブラウザ内だけで処理され、外部へ送信されません。

本番用ファイルの生成と確認:

```sh
npm run build
npm run preview
```

## Firebase Hostingへ公開

1. Firebase CLIへログインします。
2. このフォルダをFirebaseプロジェクトへ紐付けます。
3. Hostingへデプロイします。

```sh
npx firebase-tools login
npx firebase-tools use --add
npm run deploy
```

実プロジェクトIDはリポジトリへ固定していません。`firebase use --add` がローカルに作る `.firebaserc` で選択してください。

## 出力

- SVG
- 8bitグレースケールPNG（指定DPIの `pHYs` メタデータ入り）
- 再利用用の設定JSON

## 実装上の制限

背景地図は設定から非表示にできます。外部標高補完と地点ラベルの個別ドラッグ編集は対象外です。
