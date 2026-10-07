# foodly

家にある食材と買うものを管理して、食材の無駄を減らす自分用のWebアプリ。
データはiPhoneの中にだけ保存されます。

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| index.html | 画面 |
| styles.css | 見た目 |
| app.js | 動き |
| foods.js | 食材マスタ(食材名・日数) |
| manifest.webmanifest / sw.js | ホーム画面追加・オフライン用 |
| icons/ | アイコン |

## GitHub Pages で公開する手順

1. https://github.com でアカウントを作る(無料)
2. 右上の「+」→「New repository」
   - Repository name: `foodly`
   - **Public** を選ぶ(無料で Pages を使うため)
   - 「Create repository」
3. 作成後の画面で「uploading an existing file」をクリック
4. このフォルダの中身を**フォルダごとではなく中身を全部**ドラッグ&ドロップ
   (`index.html` が一番上の階層にある状態にする。`icons` フォルダも一緒に)
5. 下の「Commit changes」を押す
6. リポジトリの「Settings」→ 左メニュー「Pages」
   - Source: 「Deploy from a branch」
   - Branch: `main` / `/ (root)` →「Save」
7. 1〜2分待つと、同じ画面に `https://ユーザー名.github.io/foodly/` が表示される

## iPhone に入れる

1. 上のURLを **Safari** で開く
2. 共有ボタン →「ホーム画面に追加」
3. ホーム画面の foodly アイコンから開く
4. (任意)設定タブ →「バッジを有効にする」

## 更新するとき

GitHub のリポジトリで変更したファイルを同じ手順でアップロードし直す。
アプリに反映されないときは、アプリを一度閉じて開き直す。

## 食材マスタの直し方

`foods.js` を開き、該当する行の数字を変えるだけ。

```
['鶏もも肉', 'とりももにく', 'r', 2, 30, ['鶏肉']],
   名前         よみ        保存場所 日数 冷凍日数 別名
```

保存場所: `r` 冷蔵 / `p` 常温 / `f` 冷凍食品
