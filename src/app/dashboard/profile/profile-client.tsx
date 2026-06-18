'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { handleActionError } from '@/lib/error-handler';
import { getLoggedInUser } from '@/app/actions/auth';
import { updateUserProfile, getUsers } from '@/app/actions/admin';
import type { User, Office, Department, Division, District, Branch, LoggedInUser, LeaderboardEntry, LevelProgress, EarnedBadge, Badge, GamificationProfile, PointTransaction } from '@/lib/types';
import { Camera, Briefcase, Building, Globe, Loader2, AlertTriangle, Trophy, KeyRound } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfileLoader } from '@/components/user-profile-loader';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import GamificationClient from '../gamification/gamification-client';
import ChangePasswordForm from './change-password-form';


type UserWithRelations = LoggedInUser & {
    office: Office;
    department?: Department;
    division?: Division;
    district?: District;
    branch?: Branch;
};

interface ProfileClientProps {
  initialStats: {
    profile: GamificationProfile;
    levelProgress: LevelProgress;
    earnedBadges: EarnedBadge[];
    transactions: PointTransaction[];
    allBadges: Badge[];
  };
  initialLeaderboard: LeaderboardEntry[];
  isAdmin?: boolean;
  initialDistricts?: any[];
  initialBranches?: any[];
};

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB

const PROFILE_TABS = ['profile', 'performance', 'security'] as const;

const getImageUrl = (path: string | null | undefined): string => {
    if (!path) return '';
    const trimmed = path.trim();
    if (trimmed.startsWith('data:')) return trimmed;
    if (trimmed.startsWith('http')) {
        return trimmed;
    }
    
    // All internal assets should be absolute paths from the root
    if (trimmed.startsWith('/')) {
        return trimmed;
    }
    // If the DB stored a relative path like "uploads/..", convert to absolute root path
    return `/${trimmed}`;
}

export default function ProfileClient({ 
  initialStats, 
  initialLeaderboard, 
  isAdmin, 
  initialDistricts, 
  initialBranches 
}: ProfileClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const enforceSignature = searchParams.get('enforce_signature') === 'true';
  const [user, setUser] = useState<UserWithRelations | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    PROFILE_TABS.includes(tabParam as any) ? (tabParam as string) : 'profile'
  );
  
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const isChanged = pendingAvatar !== null;

  const loadUserAndData = useCallback(async () => {
    const initialUser = await getLoggedInUser();
    
    if (initialUser?.actingUser) {
        router.replace('/dashboard/access-denied');
        return;
    }
    
    const users = await getUsers();
    
    setUser(initialUser as any);
    setAllUsers(users);

    if (initialUser) {
        setName(initialUser.name);
        setEmail(initialUser.email);
        setAvatarPreview(null);
        setPendingAvatar(null);
    }
  }, [router]);

  useEffect(() => {
    loadUserAndData();
  }, [loadUserAndData]);

  useEffect(() => {
    if (PROFILE_TABS.includes(tabParam as any)) {
      setActiveTab(tabParam as string);
    }
  }, [tabParam]);

  const uploadFile = async (file: File, type: 'profile' | 'signatures'): Promise<string> => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    
    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        throw new Error((await response.json()).error || `${type} upload failed`);
      }
      const result = await response.json();
      return result.path;
    } catch (error: any) {
       handleActionError(error, "Upload Failed");
       throw error; // Re-throw to be caught by handleSave
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      const oldAvatar = user.avatar;
      let finalAvatarUrl = oldAvatar || '';

      if (pendingAvatar) {
        finalAvatarUrl = await uploadFile(pendingAvatar, 'profile');
      }

      const result = await updateUserProfile(user.id, {
        avatar: finalAvatarUrl,
      });

      if (result.success) {
        toast.success('Profile Updated', {
          description: 'Your profile has been successfully updated.',
        });

        if (pendingAvatar && oldAvatar) {
            await fetch('/api/upload', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: oldAvatar }),
            });
        }

        await loadUserAndData();
        const fresh = await getLoggedInUser();
        if (fresh) {
            const detail: any = { ...fresh };
            if (detail.avatar) detail.avatar = `${detail.avatar.split('?')[0]}?t=${Date.now()}`;
            window.dispatchEvent(new CustomEvent('profile-updated', { detail }));
        }
      } else {
        toast.error('Update Failed', {
          description: result.error || 'Could not update your profile.',
        });
      }
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_AVATAR_SIZE) {
        toast.error('File too large', { description: 'Profile picture must be less than 5MB.' });
        return;
    }

    setPendingAvatar(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  if (!user) {
    return (
        <div className="max-w-4xl mx-auto h-full flex items-center justify-center">
            <UserProfileLoader />
        </div>
    );
  }
  
  const getUserOrgPath = () => {
    if (!user) return [];
    const path = [];
    
    // Office information
    const office = typeof user.office?.name === 'string' ? user.office.name : 
                  (typeof user.office === 'string' ? user.office : undefined);
    
    // Department information
    const department = typeof user.department?.name === 'string' ? user.department.name :
                       (typeof user.department === 'string' ? user.department : undefined);
    
    // Division information
    const division = typeof user.division?.name === 'string' ? user.division.name :
                         (typeof user.division === 'string' ? user.division : undefined);

    if (office) path.push({ label: 'Office', name: office, icon: <Briefcase/> });
    if (department) path.push({ label: 'Department', name: department, icon: <Building/> });
    if (division) path.push({ label: 'Division', name: division, icon: <Globe/> });
    
    // Districts and branches can still be checked if available in DB
    if(user.district) {
      const districtName = typeof user.district.name === 'string' ? user.district.name :
                          (typeof user.district === 'string' ? user.district : undefined);
      if (districtName) path.push({ label: 'District', name: districtName, icon: <Building/> });
    }
    
    if(user.branch) {
      const branchName = typeof user.branch.name === 'string' ? user.branch.name :
                        (typeof user.branch === 'string' ? user.branch : undefined);
      if (branchName) path.push({ label: 'Branch', name: branchName, icon: <Globe/> });
    }
    
    return path;
  };
  const orgPath = getUserOrgPath();
  
  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 px-1">
        <div className="mb-4 sm:mb-6">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">Account Settings</h1>
            <p className="text-muted-foreground text-sm">Manage your profile and account settings.</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 h-auto">
                <TabsTrigger value="profile" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm py-2">My Profile</TabsTrigger>
                <TabsTrigger value="performance" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm py-2 flex items-center gap-2">
                    <Trophy className="h-4 w-4" />
                    Performance Dashboard
                </TabsTrigger>
                <TabsTrigger value="security" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-xs sm:text-sm py-2 flex items-center gap-2">
                    <KeyRound className="h-4 w-4" />
                    Security
                </TabsTrigger>
            </TabsList>
            <TabsContent value="profile">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Profile Information</CardTitle>
                        <CardDescription className="text-xs sm:text-sm">Manage your personal details here.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-4">
                        <div className="md:flex md:gap-6">
                            <div className="flex flex-col items-center md:w-1/3 md:border-r md:pr-6">
                                <div className="relative group mb-3 sm:mb-4">
                                    <Avatar className="h-24 w-24 sm:h-32 sm:w-32">
                                        <AvatarImage src={getImageUrl(avatarPreview || user?.avatar)} alt={name} />
                                        <AvatarFallback className="text-xl sm:text-2xl">{name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <div
                                        id="profile-avatar-upload-trigger"
                                        className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                        onClick={() => !isUploading && avatarInputRef.current?.click()}
                                    >
                                        {isUploading ? <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 text-white animate-spin" /> : <Camera className="h-6 w-6 sm:h-8 sm:w-8 text-white" />}
                                    </div>
                                    <Input
                                        type="file"
                                        ref={avatarInputRef}
                                        onChange={handleAvatarChange}
                                        className="hidden"
                                        accept="image/png, image/jpeg, image/gif"
                                        disabled={isUploading}
                                    />
                                </div>
                                <h2 className="text-lg sm:text-xl font-bold text-center">{name}</h2>
                                <div className="flex flex-col items-center gap-1">
                                  {user?.title && (
                                    <p className="text-muted-foreground font-medium text-center text-sm">{user.title}</p>
                                  )}
                                  {user?.role?.name && (
                                    <span className="px-2 py-0.5 bg-primary/10 text-primary text-[11px] font-semibold rounded-full uppercase tracking-wide border border-primary/20">
                                      {user.role.name}
                                    </span>
                                  )}
                                </div>
                                <p className="text-muted-foreground text-center text-xs sm:text-sm">{email}</p>

                                {/* Organizational Info */}
                                <div className="w-full space-y-2 mt-4 px-2">
                                    {orgPath.map(item => item && (
                                        <div key={item.label} className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-lg border border-border/50">
                                            <div className="flex-shrink-0 w-4 h-4 text-primary">{item.icon}</div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{item.label}</span>
                                                <span className="text-xs sm:text-sm font-medium line-clamp-1">{item.name}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <Separator className="my-4 md:hidden" />
                            </div>

                            <div className="md:w-2/3 md:pl-6 mt-4 md:mt-0">
                                <div className="space-y-4 sm:space-y-6">
                                    <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                                        <div className="space-y-1.5 sm:space-y-2">
                                            <Label htmlFor="name" className="text-xs sm:text-sm">Full Name</Label>
                                            <Input id="name" value={name} disabled className="bg-muted cursor-not-allowed text-sm" />
                                        </div>
                                        <div className="space-y-1.5 sm:space-y-2">
                                            <Label htmlFor="email" className="text-xs sm:text-sm">Email Address</Label>
                                            <Input id="email" type="email" value={email} disabled className="bg-muted cursor-not-allowed text-sm" />
                                        </div>
                                    </div>
                                    <div className="text-[10px] sm:text-xs text-muted-foreground bg-amber-50 p-2 rounded border border-amber-100 flex items-start gap-2">
                                        <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                                        <span>Personal and organizational information is managed by the system administrator and cannot be changed here.</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </TabsContent>
            <TabsContent value="performance">
                <GamificationClient
                    initialStats={initialStats}
                    initialLeaderboard={initialLeaderboard}
                    isAdmin={isAdmin}
                    initialDistricts={initialDistricts}
                    initialBranches={initialBranches}
                />
            </TabsContent>
            <TabsContent value="security">
                <ChangePasswordForm />
            </TabsContent>
        </Tabs>
        {activeTab === 'profile' && (
            <div className="flex justify-end mt-4 sm:mt-6" id="profile-save-container">
                <Button id="profile-save-button" type="button" onClick={handleSave} disabled={!isChanged || isSaving || isUploading}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save All Changes
                </Button>
            </div>
        )}
    </div>
  );
}