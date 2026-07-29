/**
 * Phase 0 landing screen — the scaffold's proof of life.
 *
 * This is not a product screen and will be replaced by the role chooser in Phase 1. It exists
 * because an empty app that renders "Hello World" proves almost nothing: it does not tell you
 * whether Metro resolved the workspace, whether `@taskbuddy/shared` loaded from source, whether
 * the device can reach the API, or whether the `X-Client` header the backend keys off actually
 * arrives in the right shape.
 *
 * Calling `/meta/min-version` exercises all four at once, and the endpoint is public — so this
 * works before any auth exists.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { AGE_GROUPS } from '@taskbuddy/shared';

import { fetchMinVersion, NetworkError } from '@/lib/api';
import { API_URL, CLIENT_HEADER } from '@/lib/config';

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, ok === true && styles.ok, ok === false && styles.bad]}>
        {value}
      </Text>
    </View>
  );
}

export default function Index() {
  const insets = useSafeAreaInsets();
  const [mountedAt] = useState(() => new Date());

  const { data, error, isPending, isError } = useQuery({
    queryKey: ['min-version'],
    queryFn: ({ signal }) => fetchMinVersion(signal),
  });

  // Proves the shared workspace resolved: this constant lives in shared/src, not in mobile/.
  const ageGroupCount = Object.keys(AGE_GROUPS).length;

  useEffect(() => {
    if (isError) console.warn('[phase-0] API check failed:', error);
  }, [isError, error]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 32 }]}
    >
      <Text style={styles.title}>TaskBuddy</Text>
      <Text style={styles.subtitle}>Phase 0 — scaffold check</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Wiring</Text>
        <Row label="Shared package" value={`${ageGroupCount} age groups loaded`} ok={ageGroupCount > 0} />
        <Row label="API base" value={API_URL} />
        <Row label="X-Client" value={CLIENT_HEADER} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Backend</Text>

        {isPending && (
          <View style={styles.pending}>
            <ActivityIndicator />
            <Text style={styles.pendingText}>Contacting the API…</Text>
          </View>
        )}

        {isError && (
          <>
            <Row label="Status" value="unreachable" ok={false} />
            <Text style={styles.error}>
              {error instanceof NetworkError ? error.message : String(error)}
            </Text>
          </>
        )}

        {data && (
          <>
            <Row label="Status" value="connected" ok />
            {/* Round-trips the header: null here means the backend did not recognise this client,
                which would silently break session persistence (P0-1). */}
            <Row
              label="Client recognised"
              value={data.client ? `${data.client.platform} ${data.client.version}` : 'no — check X-Client'}
              ok={data.client !== null}
            />
            <Row
              label="Minimum build"
              value={data.platforms['taskbuddy-android'] ?? 'unknown'}
            />
            <Row
              label="Upgrade required"
              value={data.upgradeRequired ? 'yes' : 'no'}
              ok={!data.upgradeRequired}
            />
          </>
        )}
      </View>

      <Text style={styles.footer}>Started {mountedAt.toLocaleTimeString()}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 32, fontWeight: '700', color: '#f8fafc' },
  subtitle: { fontSize: 15, color: '#94a3b8', marginTop: 4, marginBottom: 28 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#64748b',
    marginBottom: 12,
  },
  row: { marginBottom: 10 },
  rowLabel: { fontSize: 12, color: '#94a3b8', marginBottom: 2 },
  rowValue: { fontSize: 14, color: '#e2e8f0' },
  ok: { color: '#4ade80' },
  bad: { color: '#f87171' },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pendingText: { color: '#94a3b8', fontSize: 14 },
  error: { color: '#f87171', fontSize: 13, marginTop: 6, lineHeight: 19 },
  footer: { color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
