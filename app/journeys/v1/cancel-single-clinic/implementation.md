## User story

**As a** site administrator
**I want to** cancel a standalone single clinic
**So that** one-off availability can be removed when it is no longer needed.

## Acceptance criteria

- **Given** I cancel a single clinic with affected bookings
  **When** I continue
  **Then** I must choose whether to keep or cancel those bookings.

- **Given** I review the cancellation
  **When** I confirm
  **Then** the single clinic is removed from the clinics list.
