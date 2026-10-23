import type { Metadata } from "next";

import { PullRequestsView } from "@/components/pull-requests/pull-requests-view";

export const metadata: Metadata = { title: "Pull requests · Missions" };

const PullRequestsPage = () => <PullRequestsView />;

export default PullRequestsPage;
