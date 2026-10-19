/**
 * The multipart body the photo endpoints expect, and the shape a picked image has.
 *
 * ## Why this is its own module and not part of `imageUpload`
 *
 * It used to be, and that quietly broke every fetch-based test in `childTasksApi.test.ts`.
 * `imageUpload` imports `expo-image-picker`; importing it from an API module dragged that native
 * module into the API layer's graph, and loading it installs a `fetch` polyfill that **overwrites**
 * a test's `global.fetch` mock at require time. The assertions then ran against the real fetch and
 * failed with an undefined status.
 *
 * So the rule this file exists to enforce: **API modules must not reach the picker.** Anything both a
 * screen and an API module needs lives here, where there is no expo import to trip over.
 *
 * ## The part must carry `bytes()`, not only a `uri`
 *
 * React Native's own fetch reads a `{ uri, name, type }` part off disk. **The app does not use that
 * fetch.** Expo's runtime replaces the global `fetch` with `expo/fetch`, whose multipart encoder
 * ignores `uri` and accepts only a Blob or an object with `bytes()`. Given a bare `{ uri }` part it
 * throws before sending anything, and `api.ts` turns the throw into "Could not reach TaskBuddy": every
 * photo upload failed that way on a real device while every unit test passed.
 *
 * So the part carries both: `bytes` for expo/fetch, and `uri` so React Native's fetch would still
 * work if `EXPO_PUBLIC_USE_RN_FETCH` were ever turned on. The cast describes that platform shape,
 * which is not valid TypeScript `FormData` input.
 *
 * The field name **must** be `photo`. Both `/auth/upload-image` and
 * `/tasks/assignments/:id/upload` are configured with `uploadPhoto.single('photo')`, and a mismatch
 * produces "No file uploaded" rather than a useful error.
 */

/** What the picker gave back, before upload. */
export interface PickedImage {
  uri: string;
  /** Best-effort from the picker; defaults to JPEG, which is what the compressors emit. */
  mimeType: string;
  fileName: string;
  /** Reads the file. Supplied by the picker side, so this module stays free of expo imports. */
  bytes: () => Promise<Uint8Array>;
}

export function buildPhotoForm(image: PickedImage): FormData {
  const form = new FormData();
  form.append('photo', {
    uri: image.uri,
    name: image.fileName,
    type: image.mimeType,
    bytes: image.bytes,
  } as unknown as Blob);
  return form;
}
