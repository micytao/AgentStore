import { NextResponse } from "next/server";
import { clearSecret, setSecret } from "@/server/secrets";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ key: string }> }
) {
  const { key } = await context.params;
  const { value } = (await request.json()) as { value?: string };
  if (!value) {
    return NextResponse.json({ error: "value is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(setSecret(key, value));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ key: string }> }
) {
  const { key } = await context.params;
  try {
    return NextResponse.json(clearSecret(key));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
