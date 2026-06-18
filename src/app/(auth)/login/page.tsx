
import { Suspense } from 'react';
import LoginClientPage from './login-client';
import { HoneycombLoader } from '@/components/honeycomb-loader';

export default function LoginPageContainer() {
  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-background"><HoneycombLoader /></div>}>
      <LoginClientPage />
    </Suspense>
  );
}
