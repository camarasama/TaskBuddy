'use client';

import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface AvatarUploadProps {
  currentUrl?: string | null;
  initials: string;
  size?: 'sm' | 'md' | 'lg';
  onUpload: (url: string) => void;
}

const sizes = {
  sm: { outer: 'w-10 h-10', text: 'text-sm', icon: 'w-3 h-3', spinner: 'w-3 h-3' },
  md: { outer: 'w-16 h-16', text: 'text-xl', icon: 'w-5 h-5', spinner: 'w-4 h-4' },
  lg: { outer: 'w-24 h-24', text: 'text-3xl', icon: 'w-6 h-6', spinner: 'w-5 h-5' },
};

export function AvatarUpload({ currentUrl, initials, size = 'md', onUpload }: AvatarUploadProps) {
  const { error: showError } = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const s = sizes[size];

  const displayUrl = preview ?? currentUrl;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setIsUploading(true);

    try {
      const result = await authApi.uploadImage(file);
      const url = result.data?.url;
      URL.revokeObjectURL(objectUrl);
      if (!url) throw new Error('No URL returned from upload');
      setPreview(url);
      onUpload(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      showError(message);
      setPreview(null);
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      className="relative inline-block group cursor-pointer"
      onClick={() => !isUploading && inputRef.current?.click()}
      title="Click to change avatar"
    >
      <div
        className={`${s.outer} rounded-full overflow-hidden bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold ${s.text}`}
      >
        {displayUrl ? (
          <img src={displayUrl} alt={initials} className="w-full h-full object-cover" />
        ) : (
          <span>{initials}</span>
        )}
      </div>

      <div
        className={`absolute inset-0 rounded-full bg-black/40 flex items-center justify-center transition-opacity ${
          isUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {isUploading ? (
          <div className={`${s.spinner} border-2 border-white border-t-transparent rounded-full animate-spin`} />
        ) : (
          <Camera className={`${s.icon} text-white`} />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
