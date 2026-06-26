## Why this journey exists

Users can cancel one occurrence in a series from availability without cancelling the parent
series. This concept documents that narrower path separately from cancelling the whole series.

## Key decisions

- The same cancel URL handles occurrences by resolving the generated occurrence id back to its
  parent recurring clinic.
- Cancelling an occurrence writes a one-day closure to the series rather than deleting the series.
