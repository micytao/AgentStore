import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/auth";
import { registerExecutionEnvironment } from "@/server/aapBootstrap";

/**
 * "Register a new image" on the AAP Job Templates card — registers an
 * already-built-and-pushed container image as an AAP Execution
 * Environment object (the one part of the EE story the AAP API can do;
 * see ansible/execution-environment/README.md for building/pushing the
 * image itself) and auto-selects it as `aapExecutionEnvironmentId`.
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    image?: string;
    credentialId?: number;
  };
  if (!body.name || !body.image) {
    return NextResponse.json({ error: "name and image are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await registerExecutionEnvironment({
        name: body.name,
        image: body.image,
        credentialId: body.credentialId,
      })
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
