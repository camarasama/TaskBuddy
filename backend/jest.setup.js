// Hermetic test environment. Some suites exercise the real token-minting path (jwt.sign needs a
// non-empty secret) and config reads these from process.env. Locally they come from backend/.env
// via dotenv; CI has no .env, so set deterministic dummies here BEFORE config is imported. `||=`
// leaves any real value in place, and dotenv never overrides an already-set var, so this is safe
// in every environment. These are throwaway secrets - they sign nothing that leaves the test run.
process.env.JWT_SECRET ||= 'test-jwt-secret-0000000000000000000000000000';
process.env.JWT_REFRESH_SECRET ||= 'test-jwt-refresh-secret-000000000000000000000';
process.env.ADMIN_INVITE_CODE ||= 'test-admin-invite-code';
