// Child soft-logout / PIN-resume session helpers.
//
// A child is soft-logged-out after inactivity (or the app being backgrounded) but their NON-SECRET
// identifying info — family code + first name — is kept in localStorage so resuming only needs the
// PIN. "Switch child" keeps the family code and clears just the name, so another child of the same
// family can sign in without re-entering the code.

export const CHILD_IDLE_MS = 10 * 60 * 1000; // 10 minutes

export const STORAGE_KEY_FAMILY_CODE = 'taskbuddy_child_familyCode';
export const STORAGE_KEY_NAME = 'taskbuddy_child_name';

export interface ChildCredentials {
  familyCode: string;
  childName: string;
}

type Readable = Pick<Storage, 'getItem'>;
type Writable = Pick<Storage, 'setItem'>;
type Removable = Pick<Storage, 'removeItem'>;

/** Both pieces must be present to skip straight to the PIN step; otherwise treat as no saved child. */
export function readCredentials(store: Readable): ChildCredentials | null {
  const familyCode = store.getItem(STORAGE_KEY_FAMILY_CODE);
  const childName = store.getItem(STORAGE_KEY_NAME);
  return familyCode && childName ? { familyCode, childName } : null;
}

export function saveCredentials(store: Writable, familyCode: string, childName: string): void {
  store.setItem(STORAGE_KEY_FAMILY_CODE, familyCode);
  store.setItem(STORAGE_KEY_NAME, childName);
}

/** Full reset — forget the family entirely (used by "Not your family?"). */
export function clearCredentials(store: Removable): void {
  store.removeItem(STORAGE_KEY_FAMILY_CODE);
  store.removeItem(STORAGE_KEY_NAME);
}

/** Switch child: keep the family code, forget only the child's name. */
export function clearChildName(store: Removable): void {
  store.removeItem(STORAGE_KEY_NAME);
}

/**
 * Decide whether a re-shown tab should soft-lock: true only when it was hidden for at least the
 * idle window. `hiddenAt` is null when the tab was never hidden this cycle.
 */
export function shouldLockAfterHidden(
  hiddenAt: number | null,
  now: number,
  idleMs: number = CHILD_IDLE_MS,
): boolean {
  return hiddenAt !== null && now - hiddenAt >= idleMs;
}
