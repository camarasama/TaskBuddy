/**
 * This card is mostly a decision about when NOT to appear, so that is what these test.
 *
 * The failure that matters is not a broken render, it is the card showing up for a parent who already
 * finished or deliberately skipped setup. A permanent banner on the dashboard is worse than no banner
 * at all, and it is the kind of thing that only becomes obvious once it is in front of real families.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';

import { SetupChecklistCard } from '@/components/SetupChecklistCard';
import {
  ONBOARDING_KEY,
  type OnboardingStateResponse,
  type OnboardingStep,
} from '@/lib/onboardingApi';

jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

/**
 * Keeps the real module (the card reads `ONBOARDING_STEPS` from it) but replaces the query function
 * with one that never settles, so an unseeded cache stays in the loading state and a seeded one is
 * never refetched over the top of the fixture.
 */
jest.mock('@/lib/onboardingApi', () => {
  const actual = jest.requireActual('@/lib/onboardingApi');
  return {
    ...actual,
    onboardingQuery: () => ({
      queryKey: actual.ONBOARDING_KEY,
      queryFn: () => new Promise(() => undefined),
    }),
  };
});

function state(
  completedSteps: OnboardingStep[],
  overrides: Partial<OnboardingStateResponse['state']> = {}
): OnboardingStateResponse {
  return {
    state: {
      completedSteps,
      dismissed: false,
      startedAt: null,
      completedAt: null,
      ...overrides,
    },
    steps: ['child', 'tasks', 'reward', 'handoff'],
    isComplete: completedSteps.length >= 4,
  };
}

const clients: QueryClient[] = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

async function renderCard(seed?: OnboardingStateResponse) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        /**
         * `Infinity` means no garbage-collection timer is ever scheduled. The default is five
         * minutes, and query-core sets a real `setTimeout` for it the moment a query goes unused,
         * which holds the Node event loop open long after the assertions finish: the suite passes in
         * about a second and then sits there until the runner is killed.
         */
        gcTime: Infinity,
      },
    },
  });
  clients.push(client);
  if (seed) client.setQueryData(ONBOARDING_KEY, seed);

  // Wrapped inline rather than through RNTL's `wrapper` option, which would need a `children:
  // ReactNode` annotation: `@tanstack/react-query` is hoisted to the repo root and typed against the
  // root's React 18 types, while this app is on React 19, so the two ReactNode types do not unify.
  // The provider renders its children directly, so `toJSON()` is still null when the card is absent.
  return render(
    <QueryClientProvider client={client}>
      <SetupChecklistCard />
    </QueryClientProvider>
  );
}

describe('SetupChecklistCard stays out of the way', () => {
  it('renders nothing while the state is still loading', async () => {
    // A banner that appears a beat after the dashboard settles shoves the real content down under
    // the parent's thumb, mid-tap.
    const { toJSON } = await renderCard();

    expect(toJSON()).toBeNull();
  });

  it('renders nothing once every step is done', async () => {
    const { toJSON } = await renderCard(state(['child', 'tasks', 'reward', 'handoff']));

    expect(toJSON()).toBeNull();
  });

  it('renders nothing when the parent dismissed the wizard', async () => {
    // Dismissal is permanent by design: welcome.tsx's own header says the wizard is never re-forced.
    const { toJSON } = await renderCard(state(['child'], { dismissed: true }));

    expect(toJSON()).toBeNull();
  });

  it('renders nothing when the step count is complete but the server has not said so', async () => {
    const seed = state(['child', 'tasks', 'reward', 'handoff']);
    const { toJSON } = await renderCard({ ...seed, isComplete: false });

    expect(toJSON()).toBeNull();
  });
});

describe('SetupChecklistCard when setup is unfinished', () => {
  it('offers a way back in, and says how far along the parent is', async () => {
    const { getByRole } = await renderCard(state(['child', 'tasks']));

    const card = getByRole('button');
    expect(card.props.accessibilityLabel).toBe(
      'Finish setting up TaskBuddy. 2 of 4 steps done.'
    );
  });

  it('counts down the steps that are left, not the ones already done', async () => {
    const { getByText } = await renderCard(state(['child', 'tasks', 'reward']));

    expect(getByText('1 step to go. Pick up where you left off.')).toBeTruthy();
  });

  it('leads with the invitation before any progress exists', async () => {
    const { getByText } = await renderCard(state([]));

    expect(getByText('Finish setting up TaskBuddy')).toBeTruthy();
  });

  it('switches to encouragement once the parent has started', async () => {
    const { getByText } = await renderCard(state(['child']));

    expect(getByText('Nearly there')).toBeTruthy();
  });

  it('opens the wizard when tapped', async () => {
    const { getByRole } = await renderCard(state(['child']));

    await act(async () => {
      await fireEvent.press(getByRole('button'));
    });

    expect(router.push).toHaveBeenCalledWith('/(parent)/welcome');
  });

  it('is the only thing a screen reader stops on, progress bar included', async () => {
    // ProgressBar is `accessible` by design and cannot be quietened from its own props, so the card
    // hides it: the label above already says "2 of 4 steps done", and a second stop just repeats it.
    const { queryByRole, getByRole } = await renderCard(state(['child', 'tasks']));

    expect(getByRole('button')).toBeTruthy();
    expect(queryByRole('progressbar')).toBeNull();
  });
});
