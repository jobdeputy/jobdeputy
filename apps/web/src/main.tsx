import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { keepScrollLock } from './lib/scroll-lock.ts';

const root = document.getElementById('root');
if (!root) {
  throw new Error('The #root element is missing from index.html.');
}

const queryClient = new QueryClient();
keepScrollLock();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
