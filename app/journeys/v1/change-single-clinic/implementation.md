## User story

**As a** site administrator
**I want to** change a standalone single clinic
**So that** one-off availability stays accurate when plans change.

## Acceptance criteria

- **Given** I am on a single clinic summary
  **When** I choose to change a property
  **Then** I edit only that property and return to the review path.

- **Given** I am editing a single clinic
  **When** I view the summary
  **Then** I can change the date, times and services.

- **Given** a change affects existing bookings
  **When** I continue
  **Then** I must choose how to handle those bookings before saving.
