"use client"

import { LogOut, User as UserIcon, Info, KeyRound } from "lucide-react"
import Link from "next/link";
import { signOut } from "next-auth/react";

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
import type { User } from "@/lib/types";
import { revokeUserTokens } from "@/app/actions/auth";

export function UserNav({ user }: { user: User }) {
  if (!user) return null;

  const handleSignOut = async () => {
    try { await revokeUserTokens(user.id); } catch {}
    signOut({ callbackUrl: `${window.location.origin}/login` });
  };

  const getAvatarUrl = () => {
    const p = user.avatar?.toString().trim();
    if (!p) return undefined;
    if (p.startsWith('http') || p.startsWith('/')) return p;
    return undefined;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id="user-nav-trigger" variant="ghost" className="relative h-9 w-9 rounded-full">
          <Avatar className="h-9 w-9 border border-primary">
            <AvatarImage src={getAvatarUrl()} alt={user.name || ''} />
            <AvatarFallback>{user.name?.charAt(0)?.toUpperCase()}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.name}</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email || user.phone}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <Link href="/dashboard/account" passHref>
            <DropdownMenuItem>
              <UserIcon className="mr-2 h-4 w-4" />
              <span>My Account</span>
            </DropdownMenuItem>
          </Link>
          <Link href="/dashboard/account?tab=security" passHref>
            <DropdownMenuItem>
              <KeyRound className="mr-2 h-4 w-4" />
              <span>Change Password</span>
            </DropdownMenuItem>
          </Link>
          <Link href="/dashboard/about" passHref>
            <DropdownMenuItem>
              <Info className="mr-2 h-4 w-4" />
              <span>About</span>
            </DropdownMenuItem>
          </Link>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
