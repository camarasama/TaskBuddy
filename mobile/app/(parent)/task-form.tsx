/**
 * Create or edit a task.
 *
 * One screen for both, keyed on an optional `id` param. The alternative — two screens sharing a
 * component — buys nothing here: the only differences are the title, which endpoint is called, and
 * whether the fields start populated.
 *
 * ## The validation rules are the server's, pre-checked
 *
 * `title` 3–200, `pointsValue` 5–1000, and **`dueDate` must be in the future**. Checked here so a
 * parent gets an inline message rather than a round trip and a generic failure — but never *only*
 * here: the server rejects independently and its answer is what the screen reports on submit.
 *
 * ## Difficulty is deliberately absent
 *
 * The server derives it from `pointsValue` via `difficultyFromPoints()`. Offering a picker would
 * present a choice that is silently overruled, which is worse than not offering it.
 *
 * ## Assignment is a multi-select, and empty is valid
 *
 * A task with nobody assigned becomes a pool task children can claim — that is a real product
 * feature, not an incomplete form, so the button never blocks on it.
 *
 * ## Templates are an input path, not a second way to create a task (U5)
 *
 * Picking one only *fills these fields*; nothing is created until the parent submits, and everything
 * stays editable afterwards. Hence create-only: on an edit it would overwrite a real task's values,
 * which is not what "start from" means. Backing out must stay as easy as choosing, so the sheet closes
 * on Android back, on the backdrop, and on a button.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskTemplateRow } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { dashboardQuery } from '@/lib/dashboardApi';
import { describeError } from '@/lib/errors';
import {
  createTask,
  deleteTask,
  INVALIDATED_BY_PARENT_WRITE,
  taskDetailQuery,
  updateTask,
  type TaskInput,
} from '@/lib/parentWriteApi';
import { fillFromTaskTemplate, taskTemplatesQuery } from '@/lib/templatesApi';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

const MIN_POINTS = 5;
const MAX_POINTS = 1000;
/** The server's cap on `estimatedMinutes` (8 hours). Below it, anything from 1 is accepted. */
const MAX_MINUTES = 480;

/** Days from now, offered as chips. Typing a date on a phone is miserable and error-prone. */
const DUE_PRESETS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

/**
 * End of the chosen day, not this instant.
 *
 * The server requires a due date strictly in the future, so "Today" built from `new Date()` would be
 * rejected the moment the request took longer than zero milliseconds. 23:59 local is also what a
 * parent means by "today".
 */
function dueDateFor(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
}

export default function TaskForm() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : null;
  const editing = id !== null;

  // The children list, for the assignment picker. Reuses the dashboard's cache rather than issuing
  // a second request — this screen is usually opened from a tab that has already loaded it.
  const dashboard = useQuery(dashboardQuery());
  const children = dashboard.data?.children ?? [];

  // Fetched, not read from the list cache — see the note on `fetchTask`. `enabled` keeps it from
  // firing at all when creating.
  const detail = useQuery({ ...taskDetailQuery(id ?? ''), enabled: editing });
  const existing = detail.data?.task ?? null;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [points, setPoints] = useState('10');
  const [dueDays, setDueDays] = useState(1);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [picking, setPicking] = useState(false);
  /**
   * Populated once, when the fetch lands.
   *
   * A ref guard rather than `useState(existing?.…)`: those initialisers run before the request
   * resolves, so the fields would stay empty. Re-running on every render would instead overwrite
   * whatever the parent had started typing the moment a background refetch completed.
   */
  const populated = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing || populated.current) return;
    populated.current = true;
    setTitle(existing.title);
    setDescription(existing.description ?? '');
    setPoints(String(existing.pointsValue));
    setAssigned(existing.assignments?.map((a) => a.childId) ?? []);
    setRequiresPhoto(existing.requiresPhotoEvidence ?? false);
    setMinutes(existing.estimatedMinutes ? String(existing.estimatedMinutes) : '');
  }, [existing]);

  // Fetched only once the sheet is opened. `enabled` matters more than it looks: the form is opened
  // far more often than the sheet, and the rate limiter is 100 requests per 15 minutes keyed on IP —
  // one bucket for the whole household. Keyed on the first assigned child so the rows suit their age.
  const templates = useQuery({ ...taskTemplatesQuery(assigned[0]), enabled: picking && !editing });
  const templateRows = templates.data?.templates ?? [];

  const pointsValue = Number.parseInt(points, 10);
  const pointsValid =
    Number.isInteger(pointsValue) && pointsValue >= MIN_POINTS && pointsValue <= MAX_POINTS;
  const titleValid = title.trim().length >= 3 && title.trim().length <= 200;
  /** Blank is valid — it means "no estimate", which is what most tasks have. */
  const minutesValue = Number.parseInt(minutes, 10);
  const minutesValid =
    minutes.trim() === '' ||
    (Number.isInteger(minutesValue) && minutesValue >= 1 && minutesValue <= MAX_MINUTES);
  const canSubmit = titleValid && pointsValid && minutesValid && !busy;

  // Copy a template's values in, then get out of the way. Nothing is created and nothing is remembered,
  // so editing afterwards never writes back to the template. Assignment is left alone on purpose —
  // whoever the parent already ticked is their choice, not the template's.
  function applyTemplate(template: TaskTemplateRow) {
    const fill = fillFromTaskTemplate(template);
    setTitle(fill.title);
    setDescription(fill.description);
    setPoints(fill.points);
    setMinutes(fill.estimatedMinutes);
    setRequiresPhoto(fill.requiresPhotoEvidence);
    setPicking(false);
  }

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_PARENT_WRITE.map((key) =>
        queryClient.invalidateQueries({ queryKey: key as readonly unknown[] })
      )
    );
  }, [queryClient]);

  const { mutateAsync: doCreate } = useMutation({ mutationFn: createTask });
  const { mutateAsync: doUpdate } = useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: Partial<TaskInput> }) =>
      updateTask(taskId, input),
  });
  const { mutateAsync: doDelete } = useMutation({ mutationFn: deleteTask });

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const input: TaskInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      pointsValue,
      dueDate: dueDateFor(dueDays),
      assignedTo: assigned,
      requiresPhotoEvidence: requiresPhoto,
      // Omitted rather than sent as 0 when blank — the server rejects 0 and ignores an absent value.
      estimatedMinutes: minutesValid && minutes.trim() !== '' ? minutesValue : undefined,
    };

    try {
      if (editing && id) {
        // `assignedTo` is omitted on update: the update endpoint does not reassign, and sending it
        // would imply a change the server will not make.
        const { assignedTo: _ignored, ...editable } = input;
        await doUpdate({ taskId: id, input: editable });
      } else {
        await doCreate(input);
      }
      await invalidate();
      toast.show(editing ? 'Task saved' : 'Task created', 'success');
      router.back();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await doDelete(id);
      await invalidate();
      toast.show('Task deleted', 'success');
      router.back();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          {editing ? 'Edit task' : 'New task'}
        </AppText>

        {/* Create only — see the top of the file. Ignoring it and typing into the fields is the same form. */}
        {!editing && (
          <View style={styles.templateCta}>
            <Button label="Start from a template" variant="secondary" onPress={() => setPicking(true)} disabled={busy} />
          </View>
        )}

        <Field
          label="What needs doing?"
          value={title}
          onChangeText={setTitle}
          editable={!busy}
          maxLength={200}
          hint={title.length > 0 && !titleValid ? 'At least 3 characters' : undefined}
        />

        <Field
          label="Any details? (optional)"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={1000}
          editable={!busy}
        />

        <Field
          label="Points"
          value={points}
          onChangeText={(next) => setPoints(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={!busy}
          hint={`${MIN_POINTS}–${MAX_POINTS}. Difficulty is worked out from this.`}
        />

        <Field
          label="How long will it take? (optional)"
          value={minutes}
          onChangeText={(next) => setMinutes(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={!busy}
          hint={minutesValid ? 'Minutes. Leave blank if you’d rather not say.' : undefined}
          error={minutesValid ? undefined : `Between 1 and ${MAX_MINUTES} minutes`}
        />

        <AppText style={[styles.label, { color: theme.foreground }]}>Due</AppText>
        <View style={styles.chipRow}>
          {DUE_PRESETS.map((preset) => {
            const selected = preset.days === dueDays;
            return (
              <Pressable
                key={preset.label}
                onPress={() => setDueDays(preset.days)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={busy}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.primary : theme.card,
                    borderColor: selected ? theme.primary : theme.border,
                  },
                ]}
              >
                <AppText
                  style={[
                    styles.chipLabel,
                    { color: selected ? theme.primaryForeground : theme.cardForeground },
                  ]}
                >
                  {preset.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {!editing && (
          <>
            <AppText style={[styles.label, { color: theme.foreground }]}>Who&apos;s doing it?</AppText>
            <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
              Leave everyone unticked to let any child claim it.
            </AppText>
            <Card>
              {children.length === 0 ? (
                <AppText style={[styles.hint, { color: theme.cardForeground }]}>
                  No children yet.
                </AppText>
              ) : (
                children.map((child) => {
                  const on = assigned.includes(child.user.id);
                  return (
                    <Pressable
                      key={child.user.id}
                      onPress={() =>
                        setAssigned((prev) =>
                          on ? prev.filter((c) => c !== child.user.id) : [...prev, child.user.id]
                        )
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      disabled={busy}
                      style={styles.checkRow}
                    >
                      <AppText style={[styles.checkMark, { color: on ? theme.primary : theme.border }]}>
                        {on ? '☑' : '☐'}
                      </AppText>
                      <AppText style={[styles.checkLabel, { color: theme.cardForeground }]}>
                        {child.user.firstName}
                      </AppText>
                    </Pressable>
                  );
                })
              )}
            </Card>
          </>
        )}

        <Pressable
          onPress={() => setRequiresPhoto((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: requiresPhoto }}
          disabled={busy}
          style={styles.checkRow}
        >
          <AppText style={[styles.checkMark, { color: requiresPhoto ? theme.primary : theme.border }]}>
            {requiresPhoto ? '☑' : '☐'}
          </AppText>
          <AppText style={[styles.checkLabel, { color: theme.foreground }]}>
            Ask for a photo when they finish
          </AppText>
        </Pressable>

        {error !== null && (
          <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
            <AppText accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>
              {error}
            </AppText>
          </Card>
        )}

        <View style={styles.actions}>
          <Button
            label={editing ? 'Save changes' : 'Create task'}
            onPress={() => void submit()}
            busy={busy}
            disabled={!canSubmit}
          />
          <View style={styles.gap} />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} disabled={busy} />
          {editing && (
            <>
              <View style={styles.gap} />
              <Button
                label="Delete task"
                variant="secondary"
                onPress={() => void remove()}
                disabled={busy}
              />
            </>
          )}
        </View>
      </ScrollView>

      {/* Android back and a backdrop tap both dismiss it: a sheet that closes only via its own button
          reads as a frozen app, and backing out empty-handed has to stay easy. */}
      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close templates"
          onPress={() => setPicking(false)}
        />
        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <AppText style={[styles.sheetTitle, { color: theme.cardForeground }]}>Start from a template</AppText>
          <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
            Pick one to fill the form. You can change anything before saving.
          </AppText>

          <ScrollView style={styles.sheetList}>
            {templates.isPending ? (
              <AppText style={[styles.hint, { color: theme.mutedForeground }]}>Loading…</AppText>
            ) : templates.isError ? (
              <AppText accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>
                {describeError(templates.error)}
              </AppText>
            ) : templateRows.length === 0 ? (
              <AppText style={[styles.hint, { color: theme.mutedForeground }]}>Nothing here yet.</AppText>
            ) : (
              templateRows.map((template) => (
                <Pressable
                  key={template.id}
                  onPress={() => applyTemplate(template)}
                  accessibilityRole="button"
                  accessibilityLabel={`${template.name}, ${template.suggestedPoints} points`}
                  style={[styles.templateRow, { borderColor: theme.border }]}
                >
                  <AppText style={[styles.templateName, { color: theme.cardForeground }]}>{template.name}</AppText>
                  <AppText style={[styles.hint, { color: theme.mutedForeground }]}>
                    {template.suggestedPoints} points
                    {template.estimatedMinutes ? ` · ${template.estimatedMinutes} min` : ''}
                    {template.ageRange ? ` · ages ${template.ageRange}` : ''}
                  </AppText>
                </Pressable>
              ))
            )}
          </ScrollView>

          {/* Backing out with no template chosen must be as easy as choosing one. */}
          <Button label="No thanks" variant="secondary" onPress={() => setPicking(false)} />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  label: {
    fontSize: fontSize.sm.fontSize,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  hint: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginBottom: spacing[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: minTouchTarget,
  },
  checkMark: { fontSize: fontSize.lg.fontSize },
  checkLabel: { fontSize: fontSize.base.fontSize, flexShrink: 1 },
  actions: { marginTop: spacing[5], marginBottom: spacing[6] },
  gap: { height: spacing[2] },
  templateCta: { marginBottom: spacing[4] },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { padding: spacing[5], borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  sheetTitle: {
    fontSize: fontSize.lg.fontSize,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[1],
  },
  /** Capped so a long library scrolls inside the sheet instead of pushing the exit button off-screen. */
  sheetList: { maxHeight: 320, marginVertical: spacing[3] },
  templateRow: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing[3],
    marginBottom: spacing[2],
    minHeight: minTouchTarget,
  },
  templateName: { fontSize: fontSize.base.fontSize, fontWeight: fontWeight.medium },
});
