/**
 * The reveal toggle is the whole reason this component owns `secureTextEntry` rather than spreading it
 * through: nine masked fields across login, register, reset-password, accept-invite, child-login and
 * child-form inherit whatever happens here. These tests pin the parts a call site cannot see, which is
 * most of them, because revealing a secret has three consequences and only one of them is visible.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';

import { Field } from '@/components/Field';

// Same reason as StatTile.test.tsx: importing AppText pulls in expo-font, which this monorepo's npm
// install cannot resolve expo-asset for. See that file for the full explanation.
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));

// Stubbing the glyph rather than letting createIconSet run: it calls into the real `expo-font` for
// `Font.isLoaded`, which the mock above deliberately does not provide. Nothing is lost, because the
// icon is `accessibilityElementsHidden` in the component and so is invisible to every query below.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

/**
 * Takes over `AppState.addEventListener` so a test can drive the app in and out of the foreground.
 *
 * `subs` is every subscription handed out, not just this component's: React Native subscribes on its
 * own account during render, which is why the lifetime test below measures a delta rather than an
 * absolute count.
 */
function captureAppState(): {
  notify: (status: AppStateStatus) => void;
  subs: { remove: jest.Mock }[];
} {
  const listeners: ((status: AppStateStatus) => void)[] = [];
  const subs: { remove: jest.Mock }[] = [];

  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (status: AppStateStatus) => void
  ) => {
    listeners.push(handler);
    const sub = { remove: jest.fn() };
    subs.push(sub);
    return sub;
  }) as typeof AppState.addEventListener);

  return {
    notify: (status) => listeners.forEach((notify) => notify(status)),
    subs,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Field (plain text)', () => {
  it('renders no reveal toggle when the field is not masked', async () => {
    const { queryByRole } = await render(<Field label="Email" value="" onChangeText={() => {}} />);

    expect(queryByRole('button')).toBeNull();
  });

  it('leaves autoCorrect and autoCapitalize to the call site', async () => {
    // The hardening below is scoped to masked fields. A task title still wants ordinary typing help.
    const { getByLabelText } = await render(
      <Field label="Title" value="" onChangeText={() => {}} />
    );

    const input = getByLabelText('Title');
    expect(input.props.autoCorrect).toBeUndefined();
    expect(input.props.autoCapitalize).toBeUndefined();
  });
});

describe('Field (masked)', () => {
  it('starts masked, so revealing is always a deliberate act', async () => {
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry value="hunter2" onChangeText={() => {}} />
    );

    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
  });

  it('unmasks the value when the toggle is pressed, and masks it again on a second press', async () => {
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry value="hunter2" onChangeText={() => {}} />
    );

    await fireEvent.press(getByLabelText('Show Password'));
    expect(getByLabelText('Password').props.secureTextEntry).toBe(false);

    await fireEvent.press(getByLabelText('Hide Password'));
    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
  });

  it('names the toggle after its own field, so two masked fields stay distinguishable', async () => {
    // register.tsx and reset-password.tsx both stack a password against a confirmation. A shared
    // "Show password" label would leave a screen reader user unable to tell which one they were on.
    const { getByLabelText } = await render(
      <>
        <Field label="Password" secureTextEntry value="" onChangeText={() => {}} />
        <Field label="Confirm password" secureTextEntry value="" onChangeText={() => {}} />
      </>
    );

    await fireEvent.press(getByLabelText('Show Confirm password'));

    expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
    expect(getByLabelText('Confirm password').props.secureTextEntry).toBe(false);
  });

  it('disables the toggle while the field is not editable', async () => {
    // Every screen sets `editable={!busy}` during a submit. Revealing a value mid-request is not
    // harmful, but a live control on a frozen form reads as the form being broken.
    const { getByLabelText } = await render(
      <Field label="PIN" secureTextEntry editable={false} value="1234" onChangeText={() => {}} />
    );

    const toggle = getByLabelText('Show PIN');
    await fireEvent.press(toggle);

    expect(toggle.props.accessibilityState).toMatchObject({ disabled: true });
    expect(getByLabelText('PIN').props.secureTextEntry).toBe(true);
  });
});

describe('Field (masked) keeps the value away from the keyboard', () => {
  it('pins autoCorrect and spellCheck off, revealed or not', async () => {
    // The point of the whole exercise. `secureTextEntry` is what tells the IME not to learn the
    // value; dropping it to reveal would otherwise let Android take a plaintext password into its
    // personal dictionary and offer it as a suggestion in another app later.
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry value="hunter2" onChangeText={() => {}} />
    );

    expect(getByLabelText('Password').props.autoCorrect).toBe(false);
    expect(getByLabelText('Password').props.spellCheck).toBe(false);

    await fireEvent.press(getByLabelText('Show Password'));

    expect(getByLabelText('Password').props.secureTextEntry).toBe(false);
    expect(getByLabelText('Password').props.autoCorrect).toBe(false);
    expect(getByLabelText('Password').props.spellCheck).toBe(false);
  });

  it('refuses a call site that tries to turn autoCorrect back on', async () => {
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry autoCorrect value="" onChangeText={() => {}} />
    );

    expect(getByLabelText('Password').props.autoCorrect).toBe(false);
  });

  it('defaults autoCapitalize to none but lets a call site override it', async () => {
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry value="" onChangeText={() => {}} />
    );
    expect(getByLabelText('Password').props.autoCapitalize).toBe('none');

    const override = await render(
      <Field label="Code" secureTextEntry autoCapitalize="characters" value="" onChangeText={() => {}} />
    );
    expect(override.getByLabelText('Code').props.autoCapitalize).toBe('characters');
  });
});

describe('Field (masked) re-masks when the app is backgrounded', () => {
  it.each<AppStateStatus>(['background', 'inactive'])(
    're-masks on "%s", before the OS photographs the screen for the app switcher',
    async (status) => {
      const { notify } = captureAppState();
      const { getByLabelText } = await render(
        <Field label="Password" secureTextEntry value="hunter2" onChangeText={() => {}} />
      );

      await fireEvent.press(getByLabelText('Show Password'));
      expect(getByLabelText('Password').props.secureTextEntry).toBe(false);

      await act(async () => notify(status));

      expect(getByLabelText('Password').props.secureTextEntry).toBe(true);
      expect(getByLabelText('Show Password')).toBeTruthy();
    }
  );

  it('stays revealed while the app is still active', async () => {
    const { notify } = captureAppState();
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry value="hunter2" onChangeText={() => {}} />
    );

    await fireEvent.press(getByLabelText('Show Password'));
    await act(async () => notify('active'));

    expect(getByLabelText('Password').props.secureTextEntry).toBe(false);
  });

  it('holds the subscription only while something is revealed', async () => {
    // A listener per masked field on every screen, forever, would be a slow leak for a guard that is
    // only meaningful while a secret is actually on screen.
    const { subs } = captureAppState();
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry value="" onChangeText={() => {}} />
    );
    const baseline = subs.length;

    await fireEvent.press(getByLabelText('Show Password'));
    expect(subs).toHaveLength(baseline + 1);

    await fireEvent.press(getByLabelText('Hide Password'));
    expect(subs[baseline].remove).toHaveBeenCalled();
  });
});

describe('Field (masked) announces the state change', () => {
  it('announces shown and hidden, and never the value itself', async () => {
    // A changed accessible name on an already-focused button is not re-announced by TalkBack or
    // VoiceOver, so without this the user double-taps and hears silence.
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
    const { getByLabelText } = await render(
      <Field label="Password" secureTextEntry value="hunter2" onChangeText={() => {}} />
    );

    await fireEvent.press(getByLabelText('Show Password'));
    expect(announce).toHaveBeenLastCalledWith('Password shown');

    await fireEvent.press(getByLabelText('Hide Password'));
    expect(announce).toHaveBeenLastCalledWith('Password hidden');

    expect(announce.mock.calls.flat().join(' ')).not.toContain('hunter2');
  });
});
