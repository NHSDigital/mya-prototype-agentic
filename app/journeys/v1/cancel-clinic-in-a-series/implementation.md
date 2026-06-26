## User story

**As a** site administrator
**I want to** cancel one clinic in a series
**So that** one occurrence can be removed without cancelling future clinics in the series.

## Acceptance criteria

- **Given** I cancel a series occurrence with affected bookings
  **When** I continue
  **Then** I must choose whether to keep or cancel those bookings.

- **Given** I review the cancellation
  **When** I confirm
  **Then** the parent series remains and the occurrence date is closed.
