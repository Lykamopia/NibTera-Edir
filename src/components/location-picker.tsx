'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Search, Loader2, X, Navigation } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

export interface LocationValue {
  name: string;
  latitude: number;
  longitude: number;
}

interface LocationPickerProps {
  value?: LocationValue | null;
  onChange: (location: LocationValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
  showGps?: boolean;
}

// Well-known Ethiopian cities for instant suggestions when query is very short
const ET_CITIES = [
  'Addis Ababa', 'Dire Dawa', 'Mekelle', 'Gondar', 'Bahir Dar',
  'Hawassa', 'Dessie', 'Jimma', 'Jijiga', 'Shashamane', 'Bishoftu',
  'Arba Minch', 'Hosaena', 'Wolaita Sodo', 'Adama', 'Axum',
];

export function LocationPicker({
  value,
  onChange,
  placeholder = 'Search for a city, sub-city, or woreda…',
  disabled,
  showGps = false,
}: LocationPickerProps) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value?.name !== undefined) setQuery(value.name);
  }, [value?.name]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback(async (q: string) => {
    setIsSearching(true);
    try {
      const res = await fetch(`/api/location-search?q=${encodeURIComponent(q)}`);
      const data: NominatimResult[] = await res.json();
      setResults(data);
      setShowDropdown(data.length > 0);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (!q) {
      onChange(null);
      setResults([]);
      setShowDropdown(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (q.length >= 2) search(q);
    }, 350);
  };

  const handleSelect = (result: NominatimResult) => {
    // Build a clean name: prefer address fields, fall back to first 3 display_name parts
    const addr = result.address;
    const locality = addr?.city || addr?.town || addr?.village || addr?.suburb;
    const region = addr?.county || addr?.state;
    const nameParts = [locality, region].filter(Boolean);
    const name = nameParts.length > 0
      ? nameParts.join(', ')
      : result.display_name.split(',').slice(0, 3).join(', ').trim();

    setQuery(name);
    setShowDropdown(false);
    setResults([]);
    onChange({ name, latitude: parseFloat(result.lat), longitude: parseFloat(result.lon) });
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setShowDropdown(false);
    onChange(null);
  };

  const captureGps = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by this browser');
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const name = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
        setQuery(name);
        onChange({ name, latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGpsBusy(false);
        toast.success('GPS location captured');
      },
      () => {
        toast.error('Could not get GPS location — check browser permissions');
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div ref={containerRef} className='relative w-full'>
      <div className='flex gap-2'>
        <div className='relative flex-1'>
          <MapPin className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none' />
          <Input
            value={query}
            onChange={handleInputChange}
            onFocus={() => results.length > 0 && setShowDropdown(true)}
            placeholder={placeholder}
            disabled={disabled}
            className='pl-9 pr-8'
          />
          <div className='absolute right-2.5 top-1/2 -translate-y-1/2'>
            {isSearching ? (
              <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
            ) : query ? (
              <button
                type='button'
                onClick={handleClear}
                className='text-muted-foreground hover:text-foreground transition-colors'
              >
                <X className='h-3.5 w-3.5' />
              </button>
            ) : (
              <Search className='h-4 w-4 text-muted-foreground' />
            )}
          </div>
        </div>

        {showGps && (
          <Button
            type='button'
            variant='outline'
            size='icon'
            onClick={captureGps}
            disabled={disabled || gpsBusy}
            title='Use current GPS location'
            className='shrink-0'
          >
            {gpsBusy ? <Loader2 className='h-4 w-4 animate-spin' /> : <Navigation className='h-4 w-4' />}
          </Button>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div className='absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg overflow-hidden max-h-[260px] overflow-y-auto'>
          {results.map((result) => {
            const addr = result.address;
            const primary = addr?.city || addr?.town || addr?.village || addr?.suburb || result.display_name.split(',')[0];
            const secondary = [addr?.county, addr?.state].filter(Boolean).join(', ') || result.display_name.split(',').slice(1, 3).join(',').trim();
            return (
              <button
                key={result.place_id}
                type='button'
                className='w-full text-left px-3 py-2.5 hover:bg-accent flex items-start gap-2.5 border-b last:border-b-0 transition-colors'
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(result)}
              >
                <MapPin className='h-4 w-4 mt-0.5 text-primary shrink-0' />
                <div className='min-w-0'>
                  <p className='text-sm font-medium truncate'>{primary}</p>
                  {secondary && <p className='text-xs text-muted-foreground truncate'>{secondary}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {value && (
        <p className='mt-1.5 text-xs text-muted-foreground flex items-center gap-1'>
          <MapPin className='h-3 w-3 shrink-0' />
          <span className='truncate'>{value.name}</span>
          <span className='shrink-0 text-muted-foreground/60'>
            · {value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}
          </span>
        </p>
      )}
    </div>
  );
}
