import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { applyInboxUrlEdit } from "@/lib/inbox-edit.mjs";
import { extractUrlMetadata } from "@/lib/inbox-add.mjs";
import { readJsonObject } from "@/lib/json-body";
import { postingUrl } from "@/lib/posting-url.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJsonObject<{ oldUrl?: unknown; newUrl?: unknown; verifyOnly?: unknown }>(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });

  const oldUrl = typeof body.oldUrl === "string" ? body.oldUrl.trim() : "";
  const newUrl = typeof body.newUrl === "string" ? body.newUrl.trim() : "";
  const verifyOnly = body.verifyOnly === true;

  const validNew = postingUrl(newUrl);
  if (!validNew) {
    return NextResponse.json({ error: "New URL must be a valid http(s) job URL", code: "invalid-url" }, { status: 400 });
  }

  // 1. Verify link health and metadata
  const meta = await extractUrlMetadata(validNew).catch(() => ({
    company: "Company",
    role: "Position",
    location: "",
    isBoard: false,
  }));

  if (verifyOnly) {
    return NextResponse.json({
      ok: true,
      url: validNew,
      company: meta.company,
      role: meta.role,
      location: meta.location,
      isBoard: Boolean('isBoard' in meta && meta.isBoard),
    });
  }

  const validOld = postingUrl(oldUrl);
  if (!validOld) {
    return NextResponse.json({ error: "Old URL must be a valid http(s) job URL", code: "invalid-old-url" }, { status: 400 });
  }

  const root = careerOpsRoot();
  const file = path.join(root, "data", "pipeline.md");
  const lockModule = path.join(resolveCodeRoot(process.cwd(), process.env), "pipeline-lock.mjs");

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
      const editResult = applyInboxUrlEdit(content, validOld, validNew);
      if (!editResult.ok) return editResult;

      fs.writeFileSync(`${file}.bak`, content, "utf8");
      fs.writeFileSync(file, editResult.text, "utf8");
      return editResult;
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, code: outcome.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      url: validNew,
      company: meta.company,
      role: meta.role,
      location: meta.location,
      changed: outcome.changed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lock timeout or file error";
    return NextResponse.json({ error: message, code: "busy" }, { status: 409 });
  }
}
