import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    MAIL_USER: !!process.env.MAIL_USER,
    MAIL_PASS: !!process.env.MAIL_PASS,
    PEC_USER: !!process.env.PEC_USER,
    PEC_PASSWORD: !!process.env.PEC_PASSWORD,
    MAIL_USER_len: (process.env.MAIL_USER ?? "").length,
    MAIL_PASS_len: (process.env.MAIL_PASS ?? "").length,
  });
}
