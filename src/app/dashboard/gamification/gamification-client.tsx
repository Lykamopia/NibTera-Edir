'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Trophy, Medal, Zap, Award, Filter, Calendar, Users, BarChart3, Info, CheckCircle2, MapPin, Target, Star, Flame, ChevronRight } from 'lucide-react';
import { 
  getUserGamificationStats, 
  getLeaderboard 
} from '@/app/actions/gamification';
import { HoneycombLoader } from '@/components/honeycomb-loader';
import type { 
  LeaderboardEntry, 
  LevelProgress, 
  EarnedBadge, 
  Badge,
  GamificationProfile,
  PointTransaction 
} from '@/lib/types';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface GamificationClientProps {
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
}

export default function GamificationClient({ 
  initialStats, 
  initialLeaderboard,
  isAdmin,
  initialDistricts,
  initialBranches
}: GamificationClientProps) {
  const [stats, setStats] = useState(initialStats);
  const [leaderboard, setLeaderboard] = useState(initialLeaderboard);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<"DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "ALL_TIME">("ALL_TIME");
  const [selectedDistrict, setSelectedDistrict] = useState<string | undefined>(undefined);
  const [selectedBranch, setSelectedBranch] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetchLeaderboard();
  }, [period, selectedDistrict, selectedBranch]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const newLeaderboard = await getLeaderboard(period, selectedDistrict, selectedBranch);
      setLeaderboard(newLeaderboard);
    } catch (error) {
      console.error("Failed to load leaderboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 1: return "text-yellow-500";
      case 2: return "text-gray-400";
      case 3: return "text-amber-600";
      default: return "text-gray-600";
    }
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return <Trophy className="h-6 w-6 text-yellow-500" />;
      case 2: return <Medal className="h-6 w-6 text-gray-400" />;
      case 3: return <Award className="h-6 w-6 text-amber-600" />;
      default: return <span className="text-xl font-bold">{rank}</span>;
    }
  };

  return (
    <div className="space-y-6 pb-8 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Performance Dashboard</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Track your points, achievements, and compete with colleagues
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* User Stats Overview */}
        <Card className="col-span-1 sm:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg">Your Stats</CardTitle>
            <Zap className="h-5 w-5 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Level</span>
                <span className="text-3xl font-bold">{stats.levelProgress.currentLevel}</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{stats.levelProgress.progressPercentage}%</span>
                </div>
                <Progress value={stats.levelProgress.progressPercentage} className="h-2" />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <span className="text-muted-foreground text-sm">Total Points</span>
                  <span className="text-xl font-bold">{stats.profile.totalPoints.toLocaleString()}</span>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground text-sm">Current Streak</span>
                  <span className="text-xl font-bold">{stats.profile.streak} days</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats Cards */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Badges</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {stats.earnedBadges.length} / {stats.allBadges.length}
            </div>
            <p className="text-sm text-muted-foreground">Earned</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Longest Streak</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.profile.longestStreak}</div>
            <p className="text-sm text-muted-foreground">Days</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="leaderboard" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="leaderboard" className="flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Leaderboard
          </TabsTrigger>
          <TabsTrigger value="badges" className="flex items-center gap-2">
            <Award className="h-4 w-4" />
            Badges
          </TabsTrigger>
          <TabsTrigger value="activity" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="howpoints" className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            How Points Work
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Top Performers
                </CardTitle>
                <div className="flex flex-wrap gap-2 items-center">
                  {isAdmin && (
                    <>
                      <Select value={selectedDistrict} onValueChange={(v) => { setSelectedDistrict(v); setSelectedBranch(undefined); }}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="All Districts" />
                        </SelectTrigger>
                        <SelectContent>
                          {initialDistricts?.map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="All Branches" />
                        </SelectTrigger>
                        <SelectContent>
                          {initialBranches?.filter(b => !selectedDistrict || b.districtId === selectedDistrict).map(b => (
                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">Daily</SelectItem>
                      <SelectItem value="WEEKLY">Weekly</SelectItem>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                      <SelectItem value="YEARLY">Yearly</SelectItem>
                      <SelectItem value="ALL_TIME">All Time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-8">
                  <HoneycombLoader />
                </div>
              ) : (
                <div className="space-y-2">
                  {leaderboard.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No data available for this period
                    </div>
                  ) : (
                    leaderboard.map((entry) => (
                      <div key={entry.userId} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-4">
                          <div className={`flex items-center justify-center w-10 h-10 ${entry.rank <= 3 ? 'bg-primary/10' : 'bg-muted'} rounded-full`}>
                            {getRankIcon(entry.rank)}
                          </div>
                          <div>
                            <p className="font-medium">{entry.userName || "User"}</p>
                            <p className="text-sm text-muted-foreground">Level {entry.level}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-xl">{entry.totalPoints.toLocaleString()}</p>
                          <p className="text-sm text-muted-foreground">points</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="badges" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5" />
                Badge Collection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {stats.allBadges.map(badge => {
                  const earned = stats.earnedBadges.some(eb => eb.badgeId === badge.id);
                  return (
                    <Card key={badge.id} className={`overflow-hidden ${!earned ? 'opacity-50 grayscale' : ''}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{badge.name}</CardTitle>
                          {badge.points > 0 && (
                            <span className="text-sm text-yellow-600 font-medium">+{badge.points} pts</span>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">{badge.description}</p>
                        {earned && (
                          <p className="text-xs text-green-600 mt-2 font-medium">
                            Earned on {format(stats.earnedBadges.find(eb => eb.badgeId === badge.id)?.earnedAt || new Date(), 'MMM dd, yyyy')}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stats.transactions.length === 0 ? (
                  <p className="text-muted-foreground">No activity yet</p>
                ) : (
                  stats.transactions.map(transaction => (
                    <div key={transaction.id} className="flex items-center justify-between p-3 border-b last:border-0">
                      <div className="flex-1">
                        <p className="font-medium">{transaction.description}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(transaction.createdAt, 'MMM dd, yyyy hh:mm a')}
                        </p>
                      </div>
                      <span className={`text-lg font-bold ${transaction.points > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {transaction.points > 0 ? '+' : ''}{transaction.points}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="howpoints" className="space-y-4">
          {/* How points are earned */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                How Points Are Earned
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Job Approval */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Job Approval</h3>
                <div className="rounded-lg border divide-y">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Job fully approved</p>
                        <p className="text-xs text-muted-foreground">When your submitted job reaches APPROVED status</p>
                      </div>
                    </div>
                    <span className="font-bold text-green-600 text-lg tabular-nums">+50 pts</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <MapPin className="h-4 w-4 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">GPS verified</p>
                        <p className="text-xs text-muted-foreground">Job location verified within 100 m of target</p>
                      </div>
                    </div>
                    <span className="font-bold text-green-600 text-lg tabular-nums">+20 pts</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                        <Target className="h-4 w-4 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">KPI achievement value</p>
                        <p className="text-xs text-muted-foreground">For each KPI attached to the job with a value &gt; 0</p>
                      </div>
                    </div>
                    <span className="font-bold text-green-600 text-lg tabular-nums">+5 pts × value</span>
                  </div>
                </div>

                {/* KPI example */}
                <div className="rounded-lg bg-muted/50 border border-dashed p-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Example Calculation</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base approval</span>
                      <span className="font-mono">50</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GPS verified</span>
                      <span className="font-mono">+20</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">KPI "Loans Closed" = 3</span>
                      <span className="font-mono">+15  (3 × 5)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">KPI "Deposits" = 10</span>
                      <span className="font-mono">+50  (10 × 5)</span>
                    </div>
                    <div className="flex justify-between border-t pt-1 font-semibold">
                      <span>Total for this job</span>
                      <span className="text-green-600 font-mono">= 135 pts</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Badges */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Badge Bonuses</h3>
                <div className="rounded-lg border divide-y">
                  {stats.allBadges.map(badge => {
                    const earned = stats.earnedBadges.some(eb => eb.badgeId === badge.id);
                    return (
                      <div key={badge.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${earned ? 'bg-yellow-100' : 'bg-muted'}`}>
                            <Star className={`h-4 w-4 ${earned ? 'text-yellow-500' : 'text-muted-foreground'}`} />
                          </div>
                          <div>
                            <p className="font-medium text-sm flex items-center gap-1.5">
                              {badge.name}
                              {earned && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Earned</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">{badge.description}</p>
                          </div>
                        </div>
                        {badge.points > 0 && (
                          <span className={`font-bold text-lg tabular-nums ${earned ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                            +{badge.points} pts
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Streak */}
              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Daily Streak</h3>
                <div className="rounded-lg border px-4 py-3 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Flame className="h-4 w-4 text-orange-500" />
                  </div>
                  <div className="text-sm space-y-1">
                    <p className="font-medium">Your streak increases by 1 for each consecutive day you earn points.</p>
                    <p className="text-muted-foreground">Miss a day and your streak resets to 1. Your longest streak is saved separately and never resets.</p>
                    <p className="text-muted-foreground">Reaching a 7-day streak unlocks the <span className="font-medium text-foreground">Streak Master</span> badge (+100 pts).</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Level progression */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-blue-500" />
                Level Progression
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Each point you earn also counts as XP. When your XP reaches the threshold for the next level, you level up and your XP resets for that level. The XP needed grows with each level.
              </p>
              <div className="rounded-lg border overflow-hidden">
                <div className="grid grid-cols-3 bg-muted px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Level</span>
                  <span>XP Needed</span>
                  <span>Status</span>
                </div>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(level => {
                  const xpNeeded = Math.floor(100 * Math.pow(1.5, level - 1));
                  const currentLevel = stats.levelProgress.currentLevel;
                  const isCurrent = level === currentLevel;
                  const isDone = level < currentLevel;
                  return (
                    <div
                      key={level}
                      className={`grid grid-cols-3 px-4 py-2.5 text-sm border-t ${isCurrent ? 'bg-primary/5 font-semibold' : ''}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                        {isCurrent && <ChevronRight className="h-3.5 w-3.5 text-primary" />}
                        {!isDone && !isCurrent && <span className="w-3.5" />}
                        Level {level}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{xpNeeded.toLocaleString()} XP</span>
                      <span>
                        {isDone && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Completed</span>}
                        {isCurrent && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Current</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">Formula: XP required = floor(100 × 1.5<sup>level − 1</sup>)</p>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
