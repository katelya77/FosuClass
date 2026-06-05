# Storage Retention Policy

## Defaults

- Active Release: always retained.
- Last-known-good Release: retained through the latest previous Release.
- Release retention count: `FOSU_RELEASE_RETENTION_COUNT=3`.
- Release retention age: `FOSU_RELEASE_RETENTION_DAYS=30`.
- Successful jobs: `FOSU_JOB_SUCCESS_RETENTION_DAYS=14`.
- Failed jobs: `FOSU_JOB_FAILED_RETENTION_DAYS=30`.
- Staging upload files: `FOSU_STAGING_FILE_RETENTION_DAYS=14`.
- Archived metadata: `FOSU_ARCHIVE_METADATA_RETENTION_DAYS=90`.
- Temporary files and chunks: `FOSU_TEMP_RETENTION_HOURS=24`.
- Logs: `FOSU_LOG_RETENTION_DAYS=30`, rotate around `FOSU_LOG_ROTATE_SIZE_MB=10`.

## Safety Rules

- Dry-run preview is available before cleanup.
- Active Release is never deleted by maintenance.
- Pinned Releases must not be deleted by maintenance.
- Running job files are skipped.
- Release Pack public directories are cleaned only when their formal Release is not retained.
- Important metadata is summarized before file cleanup.
- Only one maintenance task can run at a time.

## Admin Actions

- Refresh lightweight status: reads cached runtime and disk state.
- Run storage scan: calculates directory sizes and writes a cached summary.
- Preview safe cleanup: reports candidates and reclaimed bytes without deleting.
- Execute safe cleanup: removes only candidates not protected by active, last-known-good, or running job rules.
