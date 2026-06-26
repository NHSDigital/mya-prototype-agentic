## User story

**As a** site administrator
**I want to** browse clinics by day, week, month and list
**So that** I can understand availability and choose the clinic I need to manage.

## Acceptance criteria

- **Given** I use the Clinics nav item
  **When** I arrive in the Clinics area
  **Then** I can move between day, week and month views using Clinics URLs.

- **Given** I need the full set of clinics
  **When** I open the clinics list
  **Then** I can browse paginated single clinics and clinic series for the site.

- **Given** I visit an old availability URL
  **When** the route loads
  **Then** I am redirected to the equivalent Clinics URL.
