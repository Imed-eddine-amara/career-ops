import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { parseAddUrls, extractUrlMetadata, insertOffersIntoPipeline } from "@/lib/inbox-add.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJsonObject<{
    urls?: unknown;
    company?: unknown;
    role?: unknown;
    location?: unknown;
  }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });

  const rawInput = body.urls;
  const userCompany = typeof body.company === "string" ? body.company.trim() : "";
  const userRole = typeof body.role === "string" ? body.role.trim() : "";
  const userLocation = typeof body.location === "string" ? body.location.trim() : "";

  const { urls, invalid } = parseAddUrls(
    Array.isArray(rawInput) ? rawInput : typeof rawInput === "string" ? rawInput : []
  );

  if (urls.length === 0) {
    return NextResponse.json(
      { error: "No valid http(s) job URLs provided", invalid },
      { status: 400 }
    );
  }

  // Extract metadata for each URL (bounded concurrency of 5)
  const items: Array<{ url: string; company: string; role: string; location: string }> = [];

  for (const u of urls) {
    if (urls.length === 1 && (userCompany || userRole)) {
      items.push({
        url: u,
        company: userCompany || "Company",
        role: userRole || "Position",
        location: userLocation || "",
      });
    } else {
      const meta = await extractUrlMetadata(u).catch(() => ({
        company: "Company",
        role: "Position",
        location: "",
      }));
      items.push({
        url: u,
        company: meta.company || "Company",
        role: meta.role || "Position",
        location: meta.location || "",
      });
    }
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
      const insertResult = insertOffersIntoPipeline(content, items);
      if (!insertResult.ok) return insertResult;

      if (insertResult.added > 0) {
        fs.writeFileSync(`${file}.bak`, content, "utf8");
        fs.writeFileSync(file, insertResult.text, "utf8");

        // Record added in scan-history
        if (fs.existsSync(scanHistoryPath) && fs.existsSync(scanModule)) {
          try {
            const scanMod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(scanModule).href);
            const today = new Date().toISOString().slice(0, 10);
            const historyOffers = items.map((it) => ({
              url: it.url,
              title: it.role,
              company: it.company,
              location: it.location,
            }));
            await scanMod.appendToScanHistory(historyOffers, today, "added", {
              scanHistoryPath,
              alreadyLocked: false,
            });
          } catch {
            // non-fatal
          }
        }
      }

      return insertResult;
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, code: outcome.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      added: outcome.added,
      duplicates: outcome.duplicates,
      invalid,
      items,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lock timeout or file error";
    return NextResponse.json({ error: message, code: "busy" }, { status: 409 });
  }
}
