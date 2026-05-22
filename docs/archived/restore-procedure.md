# Hexacode Restore Procedure

## Scope

This procedure validates that Hexacode backups can be restored and read. It covers the RDS database and EFS filesystem protected by AWS Backup. For W5 cloud validation, run this against the `hexacode-dev` stack and never restore over existing `hexacode-prod` resources.

## Preconditions

- An AWS Backup vault exists for the target environment.
- A daily backup plan covers the target RDS instance and EFS filesystem.
- At least one completed recovery point exists for each resource being tested.
- The restore IAM role exists and is permitted to restore the selected resource.
- The restore target uses a clearly temporary non-production identifier, such as `hexacode-dev-restore-test`, so live resources are never overwritten.
- The operator has a private validation path, such as an SSM-managed instance or private task, to read restored data.

## RDS restore test

1. Open AWS Backup and select the latest completed RDS recovery point.
2. Start a restore job to a temporary DB identifier such as `hexacode-dev-restore-test`.
3. Wait until the restore job status is `COMPLETED`.
4. Confirm the restored database uses a non-production target name and isolated restore settings.
5. Connect to the restored database from a private network path.
6. Run the following read-only validation queries:

```sql
select count(*) from submission.submissions;
select count(*) from storage.objects;
```

7. Confirm the queries return readable data from the restored instance.
8. Capture screenshots of the completed restore job and readable query output for the evidence pack.
9. Delete the temporary restored database after evidence is captured.

## EFS restore test

1. Open AWS Backup and select the latest completed EFS recovery point.
2. Start a restore job to a temporary EFS restore target.
3. Wait until the restore job status is `COMPLETED`.
4. Mount the restored filesystem from a private application subnet task or validation instance.
5. After EFS artifact persistence is deployed, read a known submission artifact path under `/submissions`, such as a restored source, stdout, stderr, or compile log file.
6. Before artifact persistence is deployed, use a deliberately written validation file from the private application tier and record that limitation in the evidence pack.
7. Confirm the restored file contents are readable.
8. Capture screenshots of the completed restore job and readable restored file for the evidence pack.
9. Delete the temporary restored EFS resource after evidence is captured.

## Alarm response

If backup or restore failure alarms fire:

1. Check AWS Backup job details to identify the failing resource and error message.
2. Confirm the resource still exists and is still included in the AWS Backup selection.
3. Check IAM permissions for the backup or restore role and any KMS access required for encrypted resources.
4. Re-run an on-demand backup or restore after the underlying issue is fixed.
5. Record the incident, resolution, and any missed evidence in the W5 evidence pack if validation timing is affected.
