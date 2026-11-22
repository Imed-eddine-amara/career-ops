import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { applyInboxDelete } from "@/lib/inbox-edit.mjs";
import { readJsonObject } from "@/lib/json-body";
import { postingUrl } from "@/lib/posting-url.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJsonObject<{ url?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const validUrl = postingUrl(url);
  if (!validUrl) {
    return NextResponse.json({ error: "Invalid http(s) URL", code: "invalid-url" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = path.join(root, "data", "pipeline.md");
  const scanHistoryPath = path.join(root, "data", "scan-history.tsv");
  const lockModule = path.join(resolveCodeRoot(process.cwd(), process.env), "pipeline-lock.mjs");
  const scanModule = path.join(resolveCodeRoot(process.cwd(), process.env), "scan.mjs");

  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: "pipeline.md not found", code: "not-found" }, { status: 404 });
  }

  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(lockModule).href);
  if (typeof mod.withPipelineLock !== "function") {
    return NextResponse.json({ error: "Lock module unavailable", code: "core-script-missing" }, { status: 503 });
  }

  try {
    const outcome = await mod.withPipelineLock(file, async () => {
      const content = fs.readFileSync(file, "utf8");
      const delResult = applyInboxDelete(content, validUrl);
      if (!delResult.ok) return delResult;

      fs.writeFileSync(`${file}.bak`, content, "utf8");
      fs.writeFileSync(file, delResult.text, "utf8");

      // Record in scan-history as skipped_user_deleted so future scans don't re-import it
      if (fs.existsSync(scanHistoryPath) && fs.existsSync(scanModule)) {
        try {
          const scanMod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(scanModule).href);
          const today = new Date().toISOString().slice(0, 10);
          await scanMod.appendToScanHistory(
            [{ url: validUrl, title: "", company: "" }],
            today,
            "skipped_user_deleted",
            { scanHistoryPath, alreadyLocked: false },
          );
        } catch {
          // non-fatal
        }
      }

      return delResult;
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, code: outcome.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      url: validUrl,
      removedRow: outcome.removedRow,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lock timeout or file error";
    return NextResponse.json({ error: message, code: "busy" }, { status: 409 });
  }
}
