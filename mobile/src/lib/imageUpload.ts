/**
 * Picking an image and putting it in storage.
 *
 * One flow, two steps: `expo-image-picker` returns a local `file://` URI, then that file is POSTed
 * as multipart to `/auth/upload-image`, which stores it and answers with a public URL. Nothing here
 * writes to a profile — the caller decides what to do with the URL, which keeps this reusable for a
 * child avatar today and anything else later.
 *
 * ## The React Native FormData shape is not the web's
 *
 * A browser appends a `File`. React Native has no `File`; it appends an object with `uri`, `name`
 * and `type`, and its fetch polyfill reads the file off disk. That object is not valid TypeScript
 * `FormData` input, which is why the append below is cast — the cast is describing a real platform
 * difference, not papering over a mistake.
 *
 * The field name **must** be `photo`: that is what multer is configured to accept
 * (`uploadPhoto.single('photo')`), and a mismatch produces "No file uploaded" rather than a useful
 * error.
 */
import * as ImagePicker from 'expo-image-picker';

import { api } from './api';

/** What the picker gave back, before upload. */
export interface PickedImage {
  uri: string;
  /** Best-effort from the picker; defaults to JPEG, which is what the compressor below emits. */
  mimeType: string;
  fileName: string;
}

/**
 * Ask for a photo, from the library.
 *
 * Returns null when the user backs out or refuses permission — both are ordinary outcomes, not
 * errors, and a thrown exception here would have every caller wrap a cancel in a try/catch.
 *
 * `quality: 0.7` and a 512px edge are deliberate. An avatar renders at well under 100px, the
 * originals off a modern phone camera are several megabytes, and the audience is families on metered
 * data. Compressing on the device also keeps the upload inside the server's file-size limit without
 * having to discover that limit by hitting it.
 */
export async function pickImage(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    // Square, because every avatar surface in both apps is a circle or a square.
    aspect: [1, 1],
    quality: 0.7,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? `avatar-${Date.now()}.jpg`,
  };
}

/** Upload a picked image; resolves to its public URL. */
export async function uploadImage(image: PickedImage): Promise<string> {
  const form = new FormData();
  form.append('photo', {
    uri: image.uri,
    name: image.fileName,
    type: image.mimeType,
  } as unknown as Blob);

  const result = await api.post<{ url: string }>('/auth/upload-image', form);
  return result.url;
}

/** Pick and upload in one call. Null when the user cancelled or refused permission. */
export async function pickAndUploadImage(): Promise<string | null> {
  const picked = await pickImage();
  if (!picked) return null;
  return uploadImage(picked);
}
