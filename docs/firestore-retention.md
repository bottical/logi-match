# Firestoreログ保持方針

## scanLogs

- 新規作成する `clients/{clientId}/scanLogs/{logId}` には `expiresAt` を保存する。
- `expiresAt` は作成時点から90日後を初期値とする。
- Firestore TTLを有効化する場合は、TTL対象フィールドを `expiresAt` に統一する。
- 既存の `scanLogs` には `expiresAt` が入っていない可能性があるため、必要に応じて別途移行スクリプトで付与する。
- 監査・トラブル対応で90日以上保持する必要がある場合は、TTL削除前にCloud StorageまたはBigQueryなどへ退避する方針を別途設計する。

## 将来の明細CSV出力

明細CSVは現行の `inspectionWorks/{workId}/items` 参照から、将来的に以下のようなDL専用の非正規化コレクションへ移行することを検討する。

```text
clients/{clientId}/inspectionWorkDetailsExport/{detailExportId}
```

保持候補フィールド:

- `workId`
- `completedAt`
- `pickingNo`
- item fields（JAN、代替コード、商品名、数量、ステータスなど）
- worker snapshot

この構成により、明細CSV出力時にworkごとのitems取得を繰り返すN+1構造を避け、期間条件の1クエリで取得できるようにする。

## Firestore TTL policy の有効化

注意: `expiresAt` をドキュメントへ保存するだけでは、Firestore上の自動削除は有効にならない。
本番運用前に Firebase Console または `gcloud firestore fields ttls update expiresAt --collection-group=scanLogs --enable-ttl` を使用し、`scanLogs` collection groupの `expiresAt` をTTL対象フィールドとして設定する必要がある。
既存の `scanLogs` に対する `expiresAt` の付与は、TTL policy有効化前に実施する別途移行作業とする。

## inspectionWorks の一覧用日付フィールド移行

一覧画面は最新順ページングのため、未完了一覧ではトップレベルの `createdAt`、完了一覧ではトップレベルの `completedAt` を `orderBy` に使用する。
Firestoreは `orderBy` 対象フィールドを持たないドキュメントを返さないため、既存データの補完が完了する前にページング版一覧を本番投入してはならない。

本番投入前に、clientごとに以下を一度だけ実施する。

- `inspectionWorks.createdAt` がない場合は、`created_at`、`importedAt`、`imported_at`、`import_date`、`work.import_date` の順で有効な値を選び、Firestore Timestampとしてトップレベルの `createdAt` に補完する。
- completed作業の完了日時は、`completedAt`、`completed_at`、`work.completedAt`、`work.completed_at` の優先順位で選び、Firestore Timestampとしてトップレベルの `completedAt` に補完する。これらがすべてない場合に限り、最終手段として `updatedAt` または `updated_at` を使用する。
- `updatedAt` または `updated_at` を完了日時の代替として使用した場合は、対象client ID・work ID・使用フィールド・補完値を移行ログへ `completedAt fallback使用` として記録する。
- 補完後、未完了一覧と完了一覧の件数を移行前の対象件数と照合し、一覧から消えるデータがないことを確認する。完了一覧については、トップレベルの `completedAt` が最新の作業から降順に表示されることも確認する。

新規取込ではトップレベルの `createdAt` を保存し、スキャン完了処理ではトップレベルの `completedAt` を保存する実装を維持する。

## workers の作業中状態移行

workers画面は `workers/{workerId}.currentWorkId` を正として表示するため、本番投入前に既存の作業中データを一度だけ同期する。

- `inspectionWorks.status == current` の各作業からworker ID、work ID、開始日時、端末IDを取得する。
- 対応する `workers/{workerId}` に `currentWorkId`、`currentStartedAt`、`currentDeviceId`、`lastWorkedAt`、`updatedAt` を補完する。
- 同期後、作業中のinspectionWorks件数と、`currentWorkId` が設定されたworkers件数・内容を照合する。
