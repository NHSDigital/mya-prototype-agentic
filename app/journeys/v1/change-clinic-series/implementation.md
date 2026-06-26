## User story

**As a** site administrator
**I want to** change a clinic series
**So that** recurring availability stays accurate when plans change.

## Acceptance criteria

- **Given** I am on a clinic series summary
  **When** I choose to change a property
  **Then** I edit only that property and return to the review path.

- **Given** I am editing a series
  **When** I view the summary
  **Then** I can change dates, days, times, services and closures.

- **Given** a change affects existing bookings
  **When** I continue
  **Then** I must choose how to handle those bookings before saving.
