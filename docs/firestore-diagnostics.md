# 本番Firestore read-only診断の実行手順

`diagnostics.html` は、`clients/{clientId}` 配下の `inspectionWorks`、`workers`、`scanLogs` をページング読み取りし、一覧日付・current状態・TTL状態を診断する一時ツールです。

## 安全策

- `systemOwner` または `internal` ロールとして登録された有効な `systemUsers` のみ画面を実行できます。`appInit.ready(document.body.dataset.page)` とページ権限定義の両方で確認します。
- 通常メニューへの導線は追加せず、検索エンジン向けに `noindex,nofollow` を指定しています。診断完了後は画面とread権限の削除を検討してください。
- 対象 `clientId` の入力と再入力、および dry-run/read-only 確認が一致するまで実行ボタンは有効になりません。
- 1 collectionあたりの最大取得件数は 1,000〜20,000 件、ページサイズは 100〜500 件に制限されています。
- 実行前に最大推定read件数を表示します。認証・コンテキスト解決に必要なreadは推定値に含みません。
- 診断スクリプトは `get()` による読み取りだけを使用し、write / update / delete / transaction / batch APIを使用しません。
- 各不整合サンプルは最大50件です。取得上限に達したcollectionの件数は「以上」と表示され、全件診断とは扱いません。

## 実行方法

1. 対象環境へ `diagnostics.html`、`css/diagnostics.css`、`js/diagnostics.js` と更新済みFirestore Rulesをデプロイします。
2. `systemOwner` または `internal` アカウントでログイン後、`diagnostics.html` を直接開きます。
3. 対象clientId、最大取得件数、ページサイズを確認します。
4. dry-run/read-only確認をチェックし、同じclientIdを再入力します。
5. 「read-only診断を実行」を押します。
6. 画面・ブラウザconsoleで結果を確認し、必要に応じてMarkdownまたはJSONをコピー・保存します。

## 権限について

既存ルールでは内部管理者が対象3 collectionすべてを横断診断できなかったため、対象collectionの `allow read` にのみ `isInternalAdmin()` を追加しています。create / update / delete権限は拡張していません。

## index照合結果

実クエリから必要な複合indexは次の3つです。Firestore Consoleで報告されたindexの Asc / Desc 方向が一致するか確認してください。診断画面はindexを作成・変更しません。

- `inspectionWorks`: `status Asc`, `completedAt Asc`（結果ダウンロード）
- `inspectionWorks`: `status Asc`, `completedAt Desc`（完了一覧）
- `inspectionWorks`: `status Asc`, `createdAt Desc`（未着手一覧）
