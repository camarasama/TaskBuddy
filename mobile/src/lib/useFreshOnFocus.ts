/**
 * A key that changes every time the screen is focused, so a screen can remount itself.
 *
 * ## Why this exists
 *
 * Both shells are `Tabs` navigators, and every screen a user "opens" (the forms, the detail screens)
 * is a `Tabs.Screen` with `href: null` rather than a stack screen. A tab screen **is mounted once and
 * then kept forever**, which is the right default for a tab and completely wrong for a form.
 *
 * Reported: create a task, save it, go to Home, come back to Tasks, tap New task, and "the previous
 * task creation is still open and the button is greyed out with the loading animation" until the app
 * is force-closed. `router.back()` had returned to the previous tab, but the form component never
 * unmounted, so it still held `busy: true` and the previous task's values.
 *
 * React Navigation 7 removed `unmountOnBlur`, and `freezeOnBlur` only stops rendering, it does not
 * discard state. Rendering `null` while blurred does not help either: hook state survives that. The
 * one thing that reliably throws all of a subtree's state away is a changed `key`, which is what this
 * gives you:
 *
 * ```tsx
 * export default function TaskForm() {
 *   return <TaskFormScreen key={useFreshOnFocus()} />;
 * }
 * ```
 *
 * ## When NOT to use it
 *
 * Only for screens that should start clean each time they are opened. It discards anything the user
 * had typed, so it is wrong for a tab someone works in, and it forces a refetch on remount, so it is
 * wrong for anything expensive to load. Screens driven entirely by their route params do not need it:
 * expo-router turns `push` into `NAVIGATE` outside a stack, and that updates params on the mounted
 * screen, so they already re-render with the right subject.
 *
 * The real fix for all of this is a Stack wrapping the Tabs, so these screens are pushed and popped
 * for real. That is a routing refactor across every href in the app.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

export function useFreshOnFocus(): number {
  const [openedCount, setOpenedCount] = useState(0);

  useFocusEffect(
    // Stable identity, so incrementing does not re-run the effect and spin.
    useCallback(() => {
      setOpenedCount((n) => n + 1);
    }, [])
  );

  return openedCount;
}
