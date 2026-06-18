
'use client';

import React, { useState, useMemo } from 'react';
import { Search, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { User } from '@/lib/types';

interface RecipientSelectorProps {
  allUsers: User[];
  selected: User[];
  setSelected: (users: User[]) => void;
  placeholder?: string;
  className?: string;
  hideBulkOptions?: boolean;
  usePortal?: boolean;
  closeOnSelect?: boolean;
}

export function RecipientSelector({
  allUsers,
  selected,
  setSelected,
  placeholder = 'Search users...',
  className,
  hideBulkOptions = false,
  usePortal = true,
  closeOnSelect = true,
}: RecipientSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const filteredUsers = useMemo(() => {
    if (!searchValue) return allUsers;
    const lowerSearch = searchValue.toLowerCase();
    return allUsers.filter(user =>
      user.name?.toLowerCase().includes(lowerSearch) ||
      user.email?.toLowerCase().includes(lowerSearch) ||
      user.title?.toLowerCase().includes(lowerSearch)
    );
  }, [allUsers, searchValue]);

  const handleSelect = (user: User) => {
    const isSelected = selected.some(u => u.id === user.id);
    const newSelected = isSelected 
      ? selected.filter(u => u.id !== user.id)
      : [...selected, user];
    setSelected(newSelected);
    if (closeOnSelect) setOpen(false);
  };

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <span className="truncate">
              {selected.length === 1 
                ? selected[0].name 
                : selected.length > 1 
                  ? `${selected.length} selected`
                  : placeholder}
            </span>
            <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-[--radix-popover-trigger-width] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
          {...(usePortal ? {} : { container: document.body })}
        >
          <Command>
            <CommandInput 
              placeholder="Search..." 
              value={searchValue}
              onValueChange={setSearchValue}
            />
            <CommandList>
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {filteredUsers.map(user => {
                  const isSelected = selected.some(u => u.id === user.id);
                  return (
                    <CommandItem
                      key={user.id}
                      value={user.email || user.name || user.id}
                      onSelect={() => handleSelect(user)}
                      className="flex items-center gap-3 py-3"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.avatar ?? undefined} alt={user.name} />
                        <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
