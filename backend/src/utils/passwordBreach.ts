import crypto from 'crypto';

// F-10: check a password against Have I Been Pwned using k-anonymity — only the first 5 chars of the
// SHA-1 hash leave the server, never the password. FAIL-OPEN: if the API is unreachable or errors, we
// return false (not breached) so a network blip never blocks a legitimate sign-up or reset.

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

export async function isPasswordBreached(password: string): Promise<boolean> {
  try {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const res = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false; // fail-open

    const body = await res.text();
    // Each line is "SUFFIX:count". A count of 0 is padding (Add-Padding) and does not count as a hit.
    for (const line of body.split('\n')) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        return parseInt(countStr ?? '0', 10) > 0;
      }
    }
    return false;
  } catch {
    return false; // fail-open on timeout / network / parse error
  }
}
