import { NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { readJsonObject } from "@/lib/json-body";
import { postingUrl } from "@/lib/posting-url.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJsonObject<{
    url?: unknown;
    company?: unknown;
    role?: unknown;
    reason?: unknown;
  }>(req);

  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const validUrl = postingUrl(url);
  if (!validUrl) {
    return NextResponse.json({ error: "Invalid http(s) URL", code: "invalid-url" }, { status: 400 });
  }

  const company = typeof body.company === "string" ? body.company.trim() : "";
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "Discarded from inbox";

  const root = careerOpsRoot();
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  const discardModulePath = path.join(codeRoot, "lib", "inbox-discard.mjs");

  try {
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(discardModulePath).href);
    if (typeof mod.discardInboxJob !== "function") {
      return NextResponse.json({ error: "Discard handler unavailable", code: "script-missing" }, { status: 503 });
    }

    const outcome = await mod.discardInboxJob({
      url: validUrl,
      company,
      role,
      reason,
      root,
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error || "Discard failed" }, { status: 400 });
    }

    return NextResponse.json(outcome);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Discard failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
