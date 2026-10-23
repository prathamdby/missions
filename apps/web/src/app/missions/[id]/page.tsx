import { MissionView } from "@/components/mission/mission-view";

const MissionPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <MissionView key={id} missionId={id} />;
};

export default MissionPage;
