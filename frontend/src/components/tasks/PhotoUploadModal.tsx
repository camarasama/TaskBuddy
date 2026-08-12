'use client';

/**
 * Photo evidence modal, shared by the child tasks list and the child task detail page.
 *
 * Lifted verbatim out of `app/child/tasks/page.tsx` when the detail page landed. Extracted rather
 * than copied because the two surfaces submit the same evidence to the same endpoint pair (upload,
 * then complete with the returned URL), and a second copy would be a second place for the
 * upload-then-complete ordering to drift. That ordering is load bearing: completing first and
 * uploading second leaves a task that looks finished to a parent with no photo attached.
 *
 * The modal owns only the file the child picked. Uploading, completing and error reporting stay
 * with the caller, which is what lets the list page keep its offline-queue behaviour while the
 * detail page keeps its own.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function PhotoUploadModal({
  title,
  onClose,
  onSubmit,
  uploading,
  fileInputRef,
}: {
  /** The task's title, shown so the child can see which task they are proving. */
  title: string;
  onClose: () => void;
  onSubmit: (file: File) => void;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">Photo Evidence</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg" aria-label="Close">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          Upload a photo to prove you completed <strong>{title}</strong>.
        </p>

        {preview ? (
          <div className="relative mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="w-full h-48 object-cover rounded-xl" />
            <button
              onClick={() => { setFile(null); setPreview(null); }}
              className="absolute top-2 right-2 bg-white/80 p-1 rounded-full"
              aria-label="Remove photo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-36 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-xp-400 hover:text-xp-600 transition-colors mb-4"
          >
            <ImageIcon className="w-8 h-8" />
            <span className="text-sm font-medium">Tap to select photo</span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        />

        <Button
          fullWidth
          disabled={!file || uploading}
          onClick={() => file && onSubmit(file)}
          className="bg-xp-600 hover:bg-xp-700 text-white"
        >
          {uploading ? (
            <span className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Uploading…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Submit Task
            </span>
          )}
        </Button>
      </motion.div>
    </motion.div>
  );
}
