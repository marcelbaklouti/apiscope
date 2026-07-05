export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return Response.json({ hello: name })
}
