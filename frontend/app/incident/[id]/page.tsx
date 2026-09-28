import { IncidentDetail } from "@/components/IncidentDetail";

export default async function IncidentRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentDetail id={id} />;
}
