import { render } from '@testing-library/react-native';

import { clampPercent, ProgressBar } from '@/components/ProgressBar';

describe('clampPercent', () => {
  it('clamps a value below 0 up to 0 (server values are not trusted)', () => {
    expect(clampPercent(-15)).toBe(0);
  });

  it('clamps a value above 100 down to 100', () => {
    expect(clampPercent(140)).toBe(100);
  });

  it('passes an in-range value through unchanged', () => {
    expect(clampPercent(42)).toBe(42);
  });

  it('folds NaN to 0 rather than propagating it into a "NaN%" width', () => {
    expect(clampPercent(0 / 0)).toBe(0);
  });
});

describe('ProgressBar', () => {
  it('reports the clamped value in accessibilityValue, not the raw prop', async () => {
    const { getByRole } = await render(
      <ProgressBar percent={250} variant="xp" label="Level 4 progress" />
    );

    const bar = getByRole('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
  });

  it('clamps a negative percent the same way for accessibilityValue', async () => {
    const { getByRole } = await render(
      <ProgressBar percent={-30} variant="completion" label="Tasks done" />
    );

    const bar = getByRole('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 0 });
  });

  it('exposes the label as accessibilityLabel for a screen reader', async () => {
    const { getByRole } = await render(
      <ProgressBar percent={50} variant="points" label="Saving for a new bike" />
    );

    expect(getByRole('progressbar').props.accessibilityLabel).toBe('Saving for a new bike');
  });
});
