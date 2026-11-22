"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { Plus, Check, AlertCircle, Loader2, Link2, ListPlus } from "lucide-react";
import { cn } from "@/lib/cn";

export function InboxAddDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "bulk">("single");

  // Single Job State
  const [singleUrl, setSingleUrl] = useState("");
  const [singleCompany, setSingleCompany] = useState("");
  const [singleRole, setSingleRole] = useState("");
  const [singleLocation, setSingleLocation] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifiedMeta, setVerifiedMeta] = useState<{ company: string; role: string; isBoard?: boolean } | null>(null);

  // Bulk State
  const [bulkText, setBulkText] = useState("");

  // Shared status
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const initialFocusRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setSingleUrl("");
    setSingleCompany("");
    setSingleRole("");
    setSingleLocation("");
    setVerifiedMeta(null);
    setBulkText("");
    setError("");
    setSuccessMsg("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Live verification of single URL
  const handleVerifySingle = async (urlToVerify: string) => {
    const trimmed = urlToVerify.trim();
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
        setVerifiedMeta({
          company: data.company || "",
          role: data.role || "",
          isBoard: data.isBoard,
        });
        if (!singleCompany && data.company) setSingleCompany(data.company);
        if (!singleRole && data.role && data.role !== "Position") setSingleRole(data.role);
        if (!singleLocation && data.location) setSingleLocation(data.location);
      } else {
        setError(data.error || "Could not reach that URL.");
      }
    } catch {
      setError("Network error verifying that URL.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmitSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleUrl.trim() || submitting) return;

    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/inbox/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: [singleUrl.trim()],
          company: singleCompany.trim(),
          role: singleRole.trim(),
          location: singleLocation.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to add job.");
        return;
      }

      if (data.duplicates > 0) {
        setSuccessMsg("This job is already in your pipeline!");
      } else {
        setSuccessMsg(`Added ${singleCompany || "job"} to your pipeline!`);
        router.refresh();
        setTimeout(() => {
          handleClose();
        }, 1200);
      }
    } catch {
      setError("Failed to add job. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkText.trim() || submitting) return;

    setSubmitting(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/inbox/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: bulkText,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to add bulk jobs.");
        return;
      }

      const addedCount = data.added || 0;
      const dupCount = data.duplicates || 0;
      const invalidCount = data.invalid?.length || 0;

      let msg = `Successfully added ${addedCount} job${addedCount === 1 ? "" : "s"}!`;
      if (dupCount > 0) msg += ` (${dupCount} duplicates skipped)`;
      if (invalidCount > 0) msg += ` (${invalidCount} invalid lines ignored)`;

      setSuccessMsg(msg);
      router.refresh();
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch {
      setError("Failed to add jobs. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Count lines in bulk textarea
  const bulkLinesCount = bulkText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l)).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      labelledBy="add-jobs-title"
      initialFocusRef={initialFocusRef}
      panelClassName="max-w-lg"
    >
      <div className="p-6">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h2 id="add-jobs-title" className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Plus className="size-5 text-brand-text" /> Add Jobs to Pipeline
          </h2>

          <div className="flex items-center rounded-lg bg-surface border border-border p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => { setMode("single"); setError(""); setSuccessMsg(""); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors",
                mode === "single" ? "bg-surface-hover text-foreground font-semibold" : "text-muted hover:text-foreground"
              )}
            >
              <Link2 className="size-3.5" /> Single Job
            </button>
            <button
              type="button"
              onClick={() => { setMode("bulk"); setError(""); setSuccessMsg(""); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors",
                mode === "bulk" ? "bg-surface-hover text-foreground font-semibold" : "text-muted hover:text-foreground"
              )}
            >
              <ListPlus className="size-3.5" /> Bulk Paste
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 text-xs text-red-500">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-400">
            <Check className="size-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {mode === "single" ? (
          <form onSubmit={handleSubmitSingle} className="mt-4 space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Job Posting URL <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  ref={initialFocusRef}
                  type="url"
                  required
                  placeholder="https://boards.greenhouse.io/.../jobs/... or https://jobs.ashbyhq.com/..."
                  value={singleUrl}
                  onChange={(e) => {
                    setSingleUrl(e.target.value);
                    setVerifiedMeta(null);
                  }}
                  onBlur={() => handleVerifySingle(singleUrl)}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <button
                  type="button"
                  onClick={() => handleVerifySingle(singleUrl)}
                  disabled={verifying || !singleUrl.trim()}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-50"
                >
                  {verifying ? <Loader2 className="size-3.5 animate-spin" /> : "Verify"}
                </button>
              </div>
              {verifiedMeta && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-400">
                  <Check className="size-3.5" />
                  <span>
                    Detected: <strong>{verifiedMeta.company}</strong> — {verifiedMeta.role}
                    {verifiedMeta.isBoard ? " (Board Directory)" : ""}
                  </span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Company (Optional)</label>
                <input
                  type="text"
                  placeholder="Auto-detected if empty"
                  value={singleCompany}
                  onChange={(e) => setSingleCompany(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted mb-1">Role Title (Optional)</label>
                <input
                  type="text"
                  placeholder="Auto-detected if empty"
                  value={singleRole}
                  onChange={(e) => setSingleRole(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">Location (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Remote, San Francisco, CA"
                value={singleLocation}
                onChange={(e) => setSingleLocation(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2.5 pt-3 border-t border-border">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !singleUrl.trim()}
                className="rounded-lg bg-brand px-4 py-2 text-xs font-medium text-brand-foreground hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Add to Pipeline
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitBulk} className="mt-4 space-y-3.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-foreground">
                  Paste Job URLs (One URL per line) <span className="text-red-500">*</span>
                </label>
                {bulkLinesCount > 0 && (
                  <span className="text-xs text-brand-text font-medium">{bulkLinesCount} valid link{bulkLinesCount === 1 ? "" : "s"} detected</span>
                )}
              </div>
              <textarea
                required
                rows={7}
                placeholder="https://boards.greenhouse.io/figureai/jobs/4601309006&#10;https://jobs.ashbyhq.com/revel/59555d75-bef1-4bbf-826e-aeb01e25eb29&#10;https://jobs.lever.co/company/abc-123"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <p className="mt-1 text-[11px] text-faint">
                Every line with a valid URL will be checked and added to your Pipeline. Duplicates already in your pipeline will be skipped automatically.
              </p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2.5 pt-3 border-t border-border">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || bulkLinesCount === 0}
                className="rounded-lg bg-brand px-4 py-2 text-xs font-medium text-brand-foreground hover:bg-brand/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <ListPlus className="size-3.5" />}
                Verify & Add All ({bulkLinesCount})
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
