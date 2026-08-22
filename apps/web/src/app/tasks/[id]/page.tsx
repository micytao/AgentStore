import { TaskDetailPage } from "@/components/TaskDetailPage";

export default async function TaskRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskDetailPage taskId={id} />;
}
