/**
 * Wiring diagnostics — was the Phase 0 landing screen, kept as a route.
 *
 * No longer the app's entry point (the role chooser took that over in Phase 1), but retained rather
 * than deleted because it answers, in one screen, the questions that are otherwise slow to answer on
 * a device: did Metro resolve the workspace, did `@taskbuddy/shared` load from source, can the phone
 * reach the API, and does the `X-Client` header the backend keys off arrive in the right shape.
 *
 * That last row is the one worth keeping. A malformed `X-Client` is treated as a browser, so the
 * refresh token goes to a cookie the app cannot read and the session silently fails to survive a
 * restart — see the note in `lib/api.ts`. Checking it after a new build is a few seconds here.
 *
 * Reachable at `/diagnostics`. Not linked from the UI; it is a tool, not a feature.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { AGE_GROUPS } from '@taskbuddy/shared';

import { fetchMinVersion, NetworkError } from '@/lib/api';
import { API_URL, CLIENT_HEADER, CONFIG_ERRORS } from '@/lib/config';

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

      {CONFIG_ERRORS.length > 0 && (
        <View style={[styles.card, styles.alertCard]}>
          <Text style={styles.cardTitle}>Config problem</Text>
          {CONFIG_ERRORS.map((message) => (
            <Text key={message} style={styles.error}>
              {message}
            </Text>
          ))}
        </View>
      )}

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
  alertCard: { borderWidth: 1, borderColor: '#f87171' },
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
