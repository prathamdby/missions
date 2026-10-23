import type { Metadata } from "next";

import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings · Missions" };

const SettingsPage = () => <SettingsView />;

export default SettingsPage;
