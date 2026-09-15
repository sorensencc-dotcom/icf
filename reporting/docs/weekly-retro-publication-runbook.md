# Weekly retro publication rollback

`ICF_WEEKLY_RETRO_WRITER_ENABLED` controls snapshot writes. It defaults off. Readers and dashboard routes remain available when writer is disabled.

Enable writer only after local validation:

```powershell
$env:ICF_WEEKLY_RETRO_WRITER_ENABLED = 'true'
npm --prefix reporting test
```

Rollback by setting the flag to `false` or removing it, then restart the publisher. A failed generator or invalid report is rejected before persistence, preserving the last valid snapshot. Repeated identical publication is idempotent.
