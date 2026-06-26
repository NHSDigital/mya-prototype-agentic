## Why this journey exists

The Clinics nav item contains several ways to browse clinic availability: day, week, month and
the full clinics list. This journey keeps those views together so the map reflects the product
navigation rather than the old implementation folders.

## Key decisions

- `/site/:id/clinics/day`, `/week` and `/month` are the canonical availability URLs.
- `/site/:id/clinics` remains the clinics list.
- Old `/site/:id/availability/...` URLs redirect to the equivalent Clinics URL.
