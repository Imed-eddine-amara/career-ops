"use client";

import { useState, use } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { noMarkdownImages } from "@/lib/markdown-options.mjs";
import { ArrowLeft, Loader2, Wrench, CircleDot, Check, X, CirclePause, Pencil, Trash2, Ban, Sparkles, RotateCcw } from "lucide-react";
import { evaluationGateForJob, isLegacyMissingReportMessage, jobOutputForDisplay } from "@/lib/job-gate.mjs";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useJobs } from "@/components/jobs/job-store";
import { missingWorker } from "@/lib/job-route.mjs";
import JobLoading from "./loading";
import { BackLink } from "@/components/back-link";
import { pipelineQuery } from "@/lib/pipeline-navigation.mjs";
import { HeroGlow } from "@/components/hero-glow";
import { Badge } from "@/components/ui/badge";
import { CoverAnswers } from "@/components/jobs/cover-answers";
import { InboxEditDialog } from "@/components/inbox/inbox-edit-dialog";
import { Button } from "@/components/ui/button";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { jobs, ready, startJob } = useJobs();
  const job = jobs.find((j) => j.id === id);
  const query = pipelineQuery(useSearchParams().toString());
  const pipelineHref = `/pipeline${query ? `?${query}` : ""}`;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!ready) return <JobLoading />;
  if (missingWorker({ ready, ids: jobs.map((j) => j.id), id })) notFound();
  if (!job) notFound();

  const gate = evaluationGateForJob(job);
  const displayOutput = jobOutputForDisplay(job);

  const handleRunNewAgent = () => {
    if (!job?.input) return;
    const newId = startJob({
      title: job.title,
      subtitle: job.subtitle ? `${job.subtitle.replace(/\s*\(.*?\)$/, "")} (new agent)` : "tailored for this role (new agent)",
      kind: "pdf",
      input: job.input,
      page: job.page || `/pipeline/${job.input}`,
    });
    if (newId) router.push(`/jobs/${newId}`);
  };

  const handleFeedAgain = () => {
    if (!job?.input || !job?.conversationId) return;
    const nextAttempt = (job.attempts || 5) + 1;
    const newId = startJob({
      title: job.title,
      subtitle: job.subtitle ? `${job.subtitle.replace(/\s*\(.*?\)$/, "")} (re-feed attempt ${nextAttempt})` : `tailored for this role (re-feed attempt ${nextAttempt})`,
      kind: "pdf",
      input: job.input,
      page: job.page || `/pipeline/${job.input}`,
      conversationId: job.conversationId,
      failureReason: job.lastFailureReason || job.steps.at(-1)?.label,
      attempt: nextAttempt,
    });
    if (newId) router.push(`/jobs/${newId}`);
  };

  const handleDiscardJob = async () => {
    if (!job?.input || deleting) return;
    setDeleting(true);
    try {
      await fetch("/api/inbox/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: job.input,
          company: job.title.replace(/^Evaluate · /, ""),
          role: job.subtitle || "",
          reason: "Discarded from evaluation review",
        }),
      });
      router.push("/pipeline?tab=discarded");
    } catch {
      setDeleting(false);
    }
  };
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <BackLink href={pipelineHref} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-brand-text">
        <ArrowLeft className="size-4" /> Pipeline
      </BackLink>

      <section className="dot-bg relative mt-5 overflow-hidden rounded-2xl border border-border bg-surface/40 px-6 py-7">
        {job.status === "running" && <HeroGlow />}
        <div className="relative z-10">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-faint">
            {job.status === "running" ? (
              <><Loader2 className="size-3 animate-spin text-brand-text" /> working</>
            ) : gate || job.status === "gated" ? (
              <><CirclePause className="size-3 text-amber-500" /> needs review</>
            ) : job.status === "done" ? (
              <><Check className="size-3 text-emerald-500" /> done</>
            ) : (
              <><X className="size-3 text-red-400" /> error</>
            )}
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-tight text-landing">{job.title}</h1>
          {job.subtitle && <p className="mt-1 text-sm text-muted">{job.subtitle}</p>}
          {job.status === "done" && job.result?.score != null && (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <Badge tone={job.result.tone}>{job.result.score}/5</Badge>
              {job.result.summary && <span className="text-sm text-muted">{job.result.summary}</span>}
            </div>
          )}
        </div>
      </section>

      {gate && (
        <section aria-label="Evaluation needs review" className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="font-medium text-foreground">{gate.confirmationRequired ? "Review your conditions before continuing" : "Evaluation stopped by your conditions"}</h2>
          <p className="mt-2 text-sm text-muted">{gate.message}</p>
          <p className="mt-2 text-sm text-muted">
            {gate.legacy ? "The saved output records an evaluation stop. The earlier run's process exit could not be verified; its technical details are kept below." : "No score or evaluation report was created. Your conditions were kept."}
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("co-assistant"))} className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover">
              Open assistant to review
            </button>
            {job.input && /^https?:\/\//i.test(job.input) && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover hover:border-brand/40"
                >
                  <Pencil className="size-3.5 text-brand-text" /> Edit URL & Recheck
                </button>
                <button
                  type="button"
                  onClick={handleDiscardJob}
                  disabled={deleting}
                  title="Move to Discarded panel so it won't appear in future searches"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-red-500 disabled:opacity-50"
                >
                  <Ban className="size-3.5" /> {deleting ? "Discarding…" : "Discard Job"}
                </button>
              </>
            )}
          </div>
          {gate.legacy && (
            <details className="mt-3 text-sm text-muted">
              <summary className="cursor-pointer font-medium">Earlier run details</summary>
              <p className="mt-2 break-words">{job.steps.at(-1)?.label}</p>
            </details>
          )}
        </section>
      )}

      {job.status === "error" && job.kind === "pdf" && (
        <section aria-label="Tailored PDF generation failed" className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/5 p-5">
          <h2 className="font-medium text-foreground">
            Tailored CV Generation Failed ({job.attempts || 5} of 5 attempts)
          </h2>
          <p className="mt-2 text-sm text-muted">
            The agent was unable to satisfy the CV fact-check or formatting constraints within {job.attempts || 5} attempts.
            You can start a fresh agent session or feed the diagnostic back to the current session for an extra attempt.
          </p>
          {(job.lastFailureReason || job.steps.at(-1)?.label) && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-surface/80 p-3 font-mono text-xs text-red-700 dark:text-red-400 break-words">
              {job.lastFailureReason || job.steps.at(-1)?.label}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="primary"
              onClick={handleRunNewAgent}
              className="inline-flex items-center gap-1.5"
            >
              <Sparkles className="size-4" /> Run a new agent
            </Button>
            {job.conversationId && (
              <Button
                type="button"
                variant="secondary"
                onClick={handleFeedAgain}
                className="inline-flex items-center gap-1.5"
              >
                <RotateCcw className="size-4" /> Try to feed again
              </Button>
            )}
          </div>
        </section>
      )}

      <ol className="mt-6 space-y-2">
        {job.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            {s.kind === "tool" ? (
              <Wrench className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
            ) : (
              <CircleDot className="mt-0.5 size-3.5 shrink-0 text-faint" />
            )}
            <span className={s.kind === "tool" ? "font-medium" : "text-muted"}>
              {gate?.legacy && isLegacyMissingReportMessage(s.label)
                ? "Earlier run returned no report. Review the recorded stop and technical details above."
                : s.kind === "tool" ? `Using ${s.label}` : s.label}
            </span>
          </li>
        ))}
        {job.status === "running" && (
          <li className="flex items-center gap-2.5 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin text-brand-text" /> thinking…
          </li>
        )}
      </ol>

      {job.kind === "cover" && <CoverAnswers brief={job.brief} />}

      {job.text && (
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Output</h2>
          <div className="report-prose mt-3 rounded-2xl border border-border bg-surface/40 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} {...noMarkdownImages}>{displayOutput}</ReactMarkdown>
          </div>
          {displayOutput !== job.text && (
            <details className="mt-3 text-sm text-muted">
              <summary className="cursor-pointer font-medium">Raw worker output</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-xs">{job.text}</pre>
            </details>
          )}
        </div>
      )}

      {job.input && (
        <InboxEditDialog
          job={{
            url: job.input,
            company: job.title.replace(/^Evaluate · /, ""),
            role: job.subtitle || "",
            location: "",
            done: false,
          }}
          isOpen={editing}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
