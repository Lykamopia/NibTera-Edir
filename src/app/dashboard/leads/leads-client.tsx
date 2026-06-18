'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus, Target, Clock, AlertCircle, Loader2, CheckCircle2,
  MapPin, User, BarChart3, TrendingUp, XCircle, PauseCircle,
  Search, Filter, ChevronRight, MessageSquare, Activity, Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import type { LoggedInUser } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';
import { CreateLeadDialog } from './create-lead-dialog';

type Lead = Awaited<ReturnType<typeof import('@/app/actions/leads').getLeads>>[number];

interface LeadsClientProps {
  user: LoggedInUser | null;
  leads: Lead[];
  error: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  NEW:         { label: 'New',         color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',     icon: Target },
  QUALIFIED:   { label: 'Qualified',   color: 'text-cyan-700',   bg: 'bg-cyan-50 border-cyan-200',     icon: CheckCircle2 },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',   icon: Activity },
  PROPOSAL:    { label: 'Proposal',    color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', icon: BarChart3 },
  NEGOTIATION: { label: 'Negotiation', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: TrendingUp },
  WON:         { label: 'Won',         color: 'text-green-700',  bg: 'bg-green-50 border-green-200',   icon: CheckCircle2 },
  LOST:        { label: 'Lost',        color: 'text-red-700',    bg: 'bg-red-50 border-red-200',       icon: XCircle },
  ON_HOLD:     { label: 'On Hold',     color: 'text-gray-700',   bg: 'bg-gray-50 border-gray-200',     icon: PauseCircle },
  PENDING_CLOSURE: { label: 'Pending Closure', color: 'text-amber-800', bg: 'bg-amber-100 border-amber-300', icon: AlertCircle },
  CLOSED:      { label: 'Closed',      color: 'text-slate-700',  bg: 'bg-slate-100 border-slate-300',  icon: Lock },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.NEW;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.color} ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
}

function DeadlineChip({ deadline }: { deadline: Date | null }) {
  if (!deadline) return null;
  const now = new Date();
  const diff = new Date(deadline).getTime() - now.getTime();
  const days = Math.ceil(diff / 86400000);
  const isOverdue = days < 0;
  const isUrgent = days >= 0 && days <= 3;

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
      isOverdue ? 'bg-red-100 text-red-700' :
      isUrgent  ? 'bg-amber-100 text-amber-700' :
                  'bg-muted text-muted-foreground'
    }`}>
      <Clock className="h-3 w-3" />
      {isOverdue
        ? `${Math.abs(days)}d overdue`
        : days === 0
        ? 'Due today'
        : `${days}d left`}
    </span>
  );
}

function LeadKpiProgress({ kpis }: { kpis: Lead['kpis'] }) {
  if (!kpis || kpis.length === 0) return null;
  // Group by KPI name first so different KPI types are never summed together,
  // then average each type's percentage for a single overall indicator.
  const byName = new Map<string, { current: number; target: number }>();
  for (const k of kpis) {
    const entry = byName.get(k.kpiName) ?? { current: 0, target: 0 };
    entry.current += Number(k.currentValue);
    entry.target += Number(k.targetValue);
    byName.set(k.kpiName, entry);
  }
  const pcts = Array.from(byName.values())
    .filter((g) => g.target > 0)
    .map((g) => Math.min(100, Math.round((g.current / g.target) * 100)));
  if (pcts.length === 0) return null;
  const pct = Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{kpis.length} KPI{kpis.length > 1 ? 's' : ''}</span>
        <span>{pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="pt-4 pb-3">
        <p className="text-2xl font-bold">{value}</p>
        <p className={`text-xs font-medium ${color}`}>{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function LeadsClient({ user, leads, error }: LeadsClientProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const stats = useMemo(() => ({
    total:      leads.length,
    inProgress: leads.filter((l) => l.status === 'IN_PROGRESS').length,
    won:        leads.filter((l) => l.status === 'WON').length,
    overdue:    leads.filter((l) => l.deadline && new Date(l.deadline) < new Date() && l.status !== 'WON' && l.status !== 'LOST').length,
  }), [leads]);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchStatus = statusFilter === 'ALL' || l.status === statusFilter;
      const q = search.toLowerCase();
      const matchSearch = !q ||
        l.title.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.targetLocation?.toLowerCase().includes(q) ||
        l.assignedTo?.name?.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [leads, statusFilter, search]);

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Target className="h-6 w-6" />Leads</h1>
        <Card>
          <CardContent className="py-12 flex flex-col items-center justify-center text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <h3 className="text-xl font-semibold">Failed to Load Leads</h3>
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={() => window.location.reload()}>
              <Loader2 className="mr-2 h-4 w-4" />Refresh Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canCreate = user?.role?.permissions?.split(',').some((p) =>
    ['create_leads', 'manage_leads'].includes(p)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Lead Management
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track, assign and convert business leads</p>
        </div>
        {canCreate && (
          <Button onClick={() => setOpen(true)} className="self-start">
            <Plus className="h-4 w-4 mr-2" />
            New Lead
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Leads"  value={stats.total}      color="text-primary"      sub="All time" />
        <StatCard label="In Progress"  value={stats.inProgress} color="text-amber-600"    sub="Active" />
        <StatCard label="Won"          value={stats.won}        color="text-green-600"    sub="Converted" />
        <StatCard label="Overdue"      value={stats.overdue}    color="text-red-600"      sub="Past deadline" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads by title, location, or officer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lead Cards */}
      {filtered.length === 0 ? (
        leads.length === 0 ? (
          <EmptyState
            title="No Leads Yet"
            description="Create your first lead to start tracking business opportunities."
            action={
              canCreate ? (
                <Button onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />New Lead
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p>No leads match your filters.</p>
          </div>
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((lead) => {
            const cfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.NEW;
            const StatusIcon = cfg.icon;
            const hasPendingUpdates = (lead as any)._count?.progressUpdates > 0;
            return (
              <Link key={lead.id} href={`/dashboard/leads/${lead.id}`}>
                <Card className="group hover:shadow-md hover:border-primary/40 transition-all duration-200 cursor-pointer h-full flex flex-col">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                          {lead.title}
                        </h3>
                      </div>
                      <StatusBadge status={lead.status} />
                    </div>
                    {lead.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{lead.description}</p>
                    )}
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3 px-4 pb-4">
                    {/* Location & Scope */}
                    <div className="flex flex-wrap gap-2">
                      {lead.targetLocation && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />{lead.targetLocation.split(',')[0]}
                        </span>
                      )}
                      {lead.branch && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Target className="h-3 w-3" />{lead.branch.name}
                        </span>
                      )}
                      {!lead.branch && lead.district && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Target className="h-3 w-3" />{lead.district.name}
                        </span>
                      )}
                    </div>

                    {/* KPI Progress */}
                    <LeadKpiProgress kpis={lead.kpis} />

                    {/* Footer row */}
                    <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {lead.assignedTo ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground truncate">
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate">{lead.assignedTo.name}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
                            <User className="h-3 w-3" />Unassigned
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(lead as any)._count?.comments > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                            <MessageSquare className="h-3 w-3" />{(lead as any)._count.comments}
                          </span>
                        )}
                        <DeadlineChip deadline={lead.deadline} />
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <CreateLeadDialog open={open} onOpenChange={setOpen} user={user} />
    </div>
  );
}
