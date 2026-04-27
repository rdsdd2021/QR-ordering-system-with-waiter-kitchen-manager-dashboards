"use client";

import { useRef, useState } from "react";
import { Upload, X, Loader2, Image as ImageIcon } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Props = {
  value: string; // current image URL
  onChange: (url: string) => void;
  bucket?: string;
  folder?: string;
  className?: string;
};

/**
 * Reusable image upload component.
 * Uploads to Supabase Storage and calls onChange with the public URL.
 */
export function ImageUpload({
  value,
  onChange,
  bucket = "menu-images",
  folder = "uploads",
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5 MB.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const supabase = getSupabaseClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (err: any) {
      setError(err?.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className={cn("space-y-2", className)}>
      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt="Preview"
            className="h-24 w-24 rounded-lg object-cover border"
            onError={e => { e.currentTarget.style.display = "none"; }}
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
            aria-label="Remove image"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="flex flex-col items-center justify-center gap-2 h-24 w-24 rounded-lg border-2 border-dashed border-muted-foreground/30 cursor-pointer hover:border-muted-foreground/60 transition-colors bg-muted/20"
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground text-center leading-tight px-1">
                Click or drag
              </span>
            </>
          )}
        </div>
      )}

      {!value && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {uploading ? "Uploading…" : "Upload image"}
        </button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
