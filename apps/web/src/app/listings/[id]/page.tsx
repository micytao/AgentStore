import { LaunchPage } from "@/components/LaunchPage";

export default async function ListingRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LaunchPage listingId={id} />;
}
