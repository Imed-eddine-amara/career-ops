"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Pencil, Check, AlertCircle, Loader2 } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";

export function InboxEditDialog({
  job,
  isOpen,
  onClose,
}: {
  job: InboxJob | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [newUrl, setNewUrl] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifiedTitle, setVerifiedTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (job) {
      setNewUrl(job.url);
      setVerifiedTitle(null);
      setError("");
      setSuccess("");
    }
  }, [job]);

  if (!job) return null;

  const handleVerify = async (urlToCheck: string) => {
    const trimmed = urlToCheck.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return;

    setVerifying(true);
    setError("");
    try {
      const res = await fetch("/api/inbox/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newUrl: trimmed, verifyOnly: true }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setVerifiedTitle(`${data.company} — ${data.role}`);
      } else {
        setError(data.error || "Could not reach that URL.");
      }
    } catch {
      setError("Network error verifying that URL.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUrl.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/inbox/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldUrl: job.url,
          newUrl: trimmed,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to update URL in pipeline.");
        return;
      }

      setSuccess("Job URL updated successfully!");
      router.refresh();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch {
      setError("Failed to update URL. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="edit-url-title"
      initialFocusRef={inputRef}
      panelClassName="max-w-md"
    >
      <form onSubmit={handleSave} className="p-5">
        <h2 id="edit-url-title" className="text-base font-semibold text-foreground flex items-center gap-2 pb-3 border-b border-border">
          <Pencil className="size-4 text-brand-text" /> Edit Job URL
        </h2>

        <p className="mt-2 text-xs text-muted">
          Update the URL for <strong className="text-foreground">{job.company} — {job.role}</strong>. Career-ops will verify the link and replace it in your pipeline.
        </p>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-500">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-400">
            <Check className="size-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <div className="mt-4">
          <label className="block text-xs font-medium text-foreground mb-1">
            Requisition URL
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="url"
              required
              value={newUrl}
              onChange={(e) => {
                setNewUrl(e.target.value);
                setVerifiedTitle(null);
              }}
              onBlur={() => handleVerify(newUrl)}
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand font-mono"
            />
            <button
              type="button"
              onClick={() => handleVerify(newUrl)}
              disabled={verifying || !newUrl.trim() || newUrl === job.url}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              {verifying ? <Loader2 className="size-3.5 animate-spin" /> : "Verify"}
            </button>
          </div>
          {verifiedTitle && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-400">
              <Check className="size-3.5" />
              <span>Link verified: {verifiedTitle}</span>
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2.5 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !newUrl.trim() || newUrl === job.url}
            className="rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save & Update
          </button>
        </div>
      </form>
    </Modal>
  );
}
