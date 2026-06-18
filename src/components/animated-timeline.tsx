
'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Share2, CornerUpLeft, MessageSquare, Mail, User, Edit, Fingerprint, Monitor } from 'lucide-react';
import { format } from 'date-fns';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import type { Activity, User as UserType } from '@/lib/types';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from './ui/tooltip';

interface TimelineProps {
  activities: Activity[];
}

const actionDetails = {
  sent: { icon: Mail, color: 'text-blue-500', bgColor: 'bg-blue-100' },
  viewed: { icon: CheckCircle, color: 'text-gray-500', bgColor: 'bg-gray-100' },
  acknowledged: { icon: Fingerprint, color: 'text-green-500', bgColor: 'bg-green-100' },
  replied: { icon: CornerUpLeft, color: 'text-indigo-500', bgColor: 'bg-indigo-100' },
  forwarded: { icon: Share2, color: 'text-purple-500', bgColor: 'bg-purple-100' },
  commented: { icon: MessageSquare, color: 'text-yellow-500', bgColor: 'bg-yellow-100' },
  created: { icon: Edit, color: 'text-gray-500', bgColor: 'bg-gray-100' },
  scheduled: { icon: User, color: 'text-gray-500', bgColor: 'bg-gray-100' },
};

const TimelineItem = ({ activity, isLast }: { activity: Activity; isLast: boolean }) => {
  const { actor, action, timestamp, details, ipAddress, userAgent } = activity;
  const { icon: Icon, color, bgColor } = actionDetails[action as keyof typeof actionDetails] || { icon: User, color: 'text-gray-500', bgColor: 'bg-gray-100' };

  return (
    <motion.div
      className="relative flex items-start gap-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <div className="flex flex-col items-center">
        <div className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full ${bgColor} dark:${bgColor.replace('100', '900/40')}`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-border/70" />}
      </div>
      <div className="flex-1 pt-1.5">
        <div className="flex items-center gap-2">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger>
                        <Avatar className="h-6 w-6">
                            <AvatarImage src={actor.avatar || ''} alt={actor.name} />
                            <AvatarFallback>{actor.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                    </TooltipTrigger>
                    <TooltipContent>
                        {actor.name}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <p className="text-sm">
                <span className="font-semibold">{actor.name}</span>
                <span className="text-muted-foreground"> {action} the memo</span>
            </p>
        </div>
        
        {details && (
            <div className="mt-2 rounded-md border bg-muted/50 p-3 text-sm">
                <div dangerouslySetInnerHTML={{ __html: details.replace(/\n/g, '<br/>') }} />
            </div>
        )}
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
            <span>{format(new Date(timestamp), "MMM d, yyyy 'at' h:mm a")}</span>
            {(ipAddress || userAgent) && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Monitor className="h-4 w-4" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {ipAddress && <p><strong>IP:</strong> {ipAddress}</p>}
                    {userAgent && <p className="truncate"><strong>Device:</strong> {userAgent}</p>}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
        </div>
      </div>
    </motion.div>
  );
};

export const AnimatedTimeline: React.FC<TimelineProps> = ({ activities }) => {
  if (!activities || activities.length === 0) {
    return <p>No activity history available for this memo.</p>;
  }

  // Filter out any leftover legacy archive/unarchive activities
  const sortedActivities = [...activities]
    .filter(a => a.action !== 'archived' && a.action !== 'unarchived')
    .sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-6">
      {sortedActivities.map((activity, index) => (
        <TimelineItem key={activity.id} activity={activity} isLast={index === sortedActivities.length - 1} />
      ))}
    </div>
  );
};
