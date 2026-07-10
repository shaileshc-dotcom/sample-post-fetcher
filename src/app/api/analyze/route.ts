import { NextRequest, NextResponse } from "next/server";
import { analyzeDomain } from "@/lib/fetchers/domain-analysis";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { domain } = (await req.json()) as { domain?: string };
    if (!domain) return NextResponse.json({ error: "Missing 'domain'" }, { status: 400 });
    const analysis = await analyzeDomain(domain);
    return NextResponse.json(analysis, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
