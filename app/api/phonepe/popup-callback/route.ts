import { NextRequest, NextResponse } from "next/server";

/**
 * PhonePe redirects to this URL after checkout (success or failure).
 * Since checkout runs in a popup, we return a tiny HTML page that:
 * 1. Calls our /api/phonepe/verify endpoint to confirm payment server-side
 * 2. Posts the result back to the parent window via postMessage
 * 3. Closes itself
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId") ?? "";
  const success = searchParams.get("upgrade") === "success";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${success ? "Payment successful" : "Payment complete"}</title>
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center;
           height: 100vh; font-family: system-ui, sans-serif; background: #f8f8f8; }
    .box { text-align: center; padding: 2rem; }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    p { color: #6b6b6b; font-size: 0.9rem; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">${success ? "✅" : "⏳"}</div>
    <strong>${success ? "Payment successful!" : "Processing payment…"}</strong>
    <p>This window will close automatically.</p>
  </div>
  <script>
    // Notify parent with the orderId so it can verify server-side
    if (window.opener) {
      window.opener.postMessage(
        { type: 'PHONEPE_CALLBACK', orderId: '${orderId}', success: ${success} },
        window.location.origin
      );
    }
    setTimeout(() => window.close(), ${success ? 1200 : 2500});
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
