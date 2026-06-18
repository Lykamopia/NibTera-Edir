import { getLoggedInUser } from "@/app/actions/auth";
import { getKpiConfigs, getKpiCategories } from "@/app/actions/kpi-config";
import KpiConfigClient from "./kpi-config-client";

export default async function KpiConfigPage() {
  const user = await getLoggedInUser();
  const [kpiConfigs, categories] = await Promise.all([
    getKpiConfigs(),
    getKpiCategories(),
  ]);

  return (
    <KpiConfigClient user={user} kpiConfigs={kpiConfigs} categories={categories} />
  );
}
