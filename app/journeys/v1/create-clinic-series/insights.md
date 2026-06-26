## Why this journey exists

Clinic series are recurring availability patterns. This journey documents the series branch as a
first-class concept so the map shows days and closures as normal steps, not hidden variants.

## Key decisions

- The type-of-clinic step is still the public entry point, but this concept hydrates it as a
  clinic series.
- Series creation includes weekdays and optional closures.
- Times, capacity and appointment length feed the appointments-per-clinic calculation.

## What to try next

- Test whether users expect to set closures during creation or add them later when editing.
