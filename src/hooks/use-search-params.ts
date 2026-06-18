
'use client'

import { usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation';
import { useCallback } from 'react';

export function useSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useNextSearchParams();

  const createQueryString = useCallback(
    (paramsToUpdate: Record<string, string | number | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(paramsToUpdate).forEach(([key, value]) => {
        if (value === null || value === '' || value === undefined) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });
      return params.toString();
    },
    [searchParams]
  );

  const setSearchParams = useCallback((params: Record<string, string | number | null>) => {
    const queryString = createQueryString(params);
    router.push(`${pathname}?${queryString}`);
  }, [createQueryString, pathname, router]);

  const getSearchParam = (key: string) => {
    return searchParams.get(key);
  };

  return { setSearchParams, getSearchParam, searchParams: useNextSearchParams() };
}
