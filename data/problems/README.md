# Problem Catalog

This folder is the source of truth for curated Hexacode seed problems.

- `catalog.json` defines tags, metadata, and file paths.
- `sample_cases` inside a catalog problem entry marks which extracted testcase ordinals are visible in the solve page `Run` workflow.
- Each problem lives in its own subfolder.
- `statement.md` is imported as the published statement asset.
- `testcases/` contains `.in` and `.out` pairs. The importer zips this folder and lets the backend extract it into MinIO-backed testcase objects.

Use the importer script from the repository root:

```powershell
python scripts/import_problem_catalog.py
```

If the backend env file is in the default location, the script reads `hexacode-backend/.env`, bootstraps schema and buckets, then imports any missing problems into Postgres and MinIO.

When you run the importer from the host machine against the local Docker stack, override the container-only endpoints first:

```powershell
$env:DATABASE_URL = "postgresql://hexacode:hexacode@127.0.0.1:15432/hexacode"
$env:S3_ENDPOINT = "http://127.0.0.1:19000"
python scripts/import_problem_catalog.py
```

The importer keeps explicit environment variables, so these host overrides win over the values in `hexacode-backend/.env`.
