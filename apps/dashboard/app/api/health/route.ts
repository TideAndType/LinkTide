export async function GET() {
  return Response.json({
    ok: true,
    service: "linktide-dashboard",
    timestamp: new Date().toISOString()
  });
}
