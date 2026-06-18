import { getLoggedInUser } from "@/app/actions/auth";
import UsersClient from "./users-client";

export default async function UsersPage() {
  const user = await getLoggedInUser();

  return <UsersClient user={user} />;
}
