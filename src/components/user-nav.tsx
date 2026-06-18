
"use client"

import { LogOut, User as UserIcon, Repeat, ShieldQuestion, Info } from "lucide-react"
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { User, Delegation } from "@/lib/types";
import { revokeUserTokens } from "@/app/actions/auth";

export function UserNav({ user }: { user: User }) {
  const { data: session, update } = useSession();
  const router = useRouter();

  if (!user) return null;
  
  const isDelegated = (session?.user as any)?.isDelegated;
  const realUser = (session?.user as any)?.realUser;
  const delegatedToAccounts = (session?.user as any)?.delegatedTo || user.delegatedTo || [];


  const handleSwitchAccount = async (delegatorId: string) => {
    toast.loading("Switching accounts...", { id: 'account-switch' });
    const res = await update({ switch_to_delegator_id: delegatorId, redirect: false });
    if (res) {
        window.location.href = '/dashboard/plans';
    } else {
        toast.error("Failed to switch accounts.", { id: 'account-switch' });
    }
  }

  const handleReturnToOwnAccount = async () => {
    toast.loading("Returning to your account...", { id: 'account-switch' });
    const res = await update({ stop_delegation: true });
    if (res) {
        window.location.href = '/dashboard/plans';
    } else {
        toast.error("Failed to return to your account.", { id: 'account-switch' });
    }
  }


  const handleSignOut = async () => {
    await revokeUserTokens(realUser?.id || user.id);
    signOut({ callbackUrl: `${window.location.origin}/login` });
  }

  const getAvatarUrl = () => {
    const p = user.avatar?.toString().trim();
    if (!p) return user.image || undefined; // user.image is from oauth provider
    
    if (p.startsWith('http')) {
      return p;
    }
    
    if (p.startsWith('/')) {
      return p;
    }
    
    return undefined; // Invalid path
  }

  return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id="user-nav-trigger" variant="ghost" className="relative h-9 w-9 rounded-full">
            <Avatar className="h-9 w-9 border border-primary">
              <AvatarImage src={getAvatarUrl()} alt={user.name || ''} data-ai-hint="person portrait"/>
              <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            {isDelegated && (
                <span className="absolute bottom-0 -right-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center border-2 border-background">
                    <ShieldQuestion className="h-2.5 w-2.5 text-primary-foreground" />
                </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
                {isDelegated && (
                    <div className="text-xs text-blue-500 mb-1">
                        On behalf of:
                    </div>
                )}
              <p className="text-sm font-medium leading-none">{user.name}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
               {isDelegated && realUser && (
                <p className="text-xs italic text-muted-foreground pt-1">
                    (Your account: {realUser.name})
                </p>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {!isDelegated && (
                <>
                <Link href="/dashboard/profile" passHref>
                    <DropdownMenuItem>
                        <UserIcon className="mr-2 h-4 w-4" />
                        <span>Profile</span>
                    </DropdownMenuItem>
                </Link>
                <Link href="/dashboard/about" passHref>
                    <DropdownMenuItem>
                        <Info className="mr-2 h-4 w-4" />
                        <span>About</span>
                    </DropdownMenuItem>
                </Link>
                </>
            )}
          </DropdownMenuGroup>
          
          {delegatedToAccounts.length > 0 && !isDelegated && (
             <DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Switch Account</DropdownMenuLabel>
                {delegatedToAccounts.map((delegation: Delegation) => (
                    <DropdownMenuItem key={delegation.id} onClick={() => handleSwitchAccount(delegation.delegatorId)}>
                        <Repeat className="mr-2 h-4 w-4" />
                        <span>Act as {delegation.delegator.name}</span>
                    </DropdownMenuItem>
                ))}
             </DropdownMenuGroup>
          )}

          <DropdownMenuSeparator />
          {isDelegated ? (
            <DropdownMenuItem onClick={handleReturnToOwnAccount}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Return to My Account</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
  )
}

    
