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
 * ## The React Native FormData shape is not the web's
 *
 * A browser appends a `File`. React Native has no `File`; it appends an object with `uri`, `name`
 * and `type`, and its fetch polyfill reads the file off disk. That object is not valid TypeScript
 * `FormData` input, which is why the append below is cast — the cast describes a real platform
 * difference, not a mistake.
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
}

export function buildPhotoForm(image: PickedImage): FormData {
  const form = new FormData();
  form.append('photo', {
    uri: image.uri,
    name: image.fileName,
    type: image.mimeType,
  } as unknown as Blob);
  return form;
}
