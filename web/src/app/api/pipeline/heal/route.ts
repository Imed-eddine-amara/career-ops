import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  const dataRoot = careerOpsRoot();
  const scriptPath = path.join(codeRoot, "pipeline-heal.mjs");

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--apply", "--json"],
      {
        cwd: codeRoot,
        env: {
          ...process.env,
          CAREER_OPS_ROOT: dataRoot,
          CAREER_OPS_DATA_DIR: dataRoot,
        },
        timeout: 60_000,
        windowsHide: true,
      }
    );

    const parsed = JSON.parse(stdout.trim());
    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Heal process failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
