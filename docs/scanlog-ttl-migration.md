# scanLogs expiresAt補正 実行手順

## 目的と対象

この一時画面は、Firestore TTL policyを有効化する前に、既存の `clients/{clientId}/scanLogs/{logId}` のうち `expiresAt` フィールドが存在しないドキュメントへだけ `expiresAt` を補正するためのものです。`inspectionWorks`、`workers`、`operationLogs`、その他のcollectionは読み書きしません。TTL policy自体の有効化も行いません。

利用者は有効な `systemOwner` のみに限定されます。`internal` は診断画面を利用できますが、この補正画面は利用できません。作業完了後は、補正画面と `scanLogs` 更新権限を削除する前提で運用してください。

## 補正仕様

- document ID順でページングし、指定した最大取得件数または最大更新件数に達したページで停止します。
- `expiresAt` がすでに存在するドキュメントは更新しません。
- `scannedAt` が存在するときは、有効なDateとして解釈できる場合に限り `scannedAt + 90日` を使用します。`scannedAt` が不正な場合、`createdAt` へのフォールバックは行わずskipします。
- `scannedAt` が存在しないときだけ、有効な `createdAt + 90日` を使用します。
- `scannedAt` と `createdAt` がない、または補正元をDateとして解釈できない場合はskipします。
- 本更新は最大400件ずつのbatchで、`expiresAt` フィールドだけを更新します。
- dry-runではFirestore batchを生成・commitせず、writeを一切行いません。

## 段階的な実行手順

1. `scanlog-ttl-migration.html` をsystemOwnerで開き、まず **dry-run / 最大取得100 / 最大更新10 / ページサイズ100** で確認します。
2. 更新候補とskipサンプルに問題がなければ、**本更新 / 最大取得100 / 最大更新10** を実行します。本更新では確認欄へ `UPDATE_EXPIRES_AT` を完全一致で入力します。
3. `diagnostics.html` でread-only再診断し、`expiresAtなし` 件数が減り、他の診断結果に想定外の変化がないことを確認します。
4. 問題がなければ、最大更新件数を100件、500件、1000件と段階的に増やし、各段階でdry-run・本更新・再診断を繰り返します。最大推定read/write件数を毎回確認してください。
5. `expiresAtなし` 件数が0、または業務上の許容範囲まで減ったことを確認してから、別作業としてFirestore TTL policyを有効化します。
6. **TTL policyはこの画面では有効化しません。** Firebase Consoleまたは承認済みのgcloud手順で別途実施してください。
7. TTL有効化後、90日超過ログは順次削除対象になります。そのため、全スキャンログCSVは保持期間内のみ出力可能になります。必要な長期保管データはTTL有効化前に退避してください。

## 実行ガードと推定件数

実行ボタンが有効になるには、systemOwner認証、clientIdと再入力の一致、安全確認、実行確認が必要です。本更新では加えて `UPDATE_EXPIRES_AT` の入力が必要です。画面は実行前に対象パス、モード、最大推定read件数、最大推定write件数を表示します。認証・context確認に伴うreadは推定に含みません。

## レポートと確認

実行結果は画面とブラウザconsoleへ出力され、Markdown / JSONをコピーまたは保存できます。レポートには取得・候補・更新・skip・error件数、上限到達状況、および最大50件の候補/skip/errorサンプルが含まれます。本更新後は必ず `diagnostics.html` を再実行してください。

## Firestore Rulesと撤去

この補正を可能にするため、`clients/{clientId}/scanLogs/{logId}` のupdateは `systemOwner` に限定し、Rulesでも変更フィールドが `expiresAt` のみで、補正後の値がFirestore Timestampである場合だけ許可します。`internal`、client admin、workerによるupdate、`expiresAt` 以外のフィールド更新、および全ロールによるdeleteは許可しません。

補正と再診断が完了したら、この一時画面・JavaScript・ドキュメントを撤去し、`scanLogs` のupdate権限を再び無効化してください。
