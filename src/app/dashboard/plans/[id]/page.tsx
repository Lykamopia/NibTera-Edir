
import { getPlanById } from "@/app/actions/plans";
import { getLoggedInUser } from "@/app/actions/auth";
import { getDistricts } from "@/app/actions/admin";
import PlanDetailClient from "./plan-detail-client";

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const user = await getLoggedInUser();
    const plan = await getPlanById(id);
    const districts = await getDistricts();

    if (!plan) {
        return <div>Plan not found</div>;
    }

    return <PlanDetailClient user={user} plan={plan} districts={districts} />;
}
