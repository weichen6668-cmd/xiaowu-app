/**
 * App 根：BrowserRouter + AppRoutes（AuthProvider 守卫在 routes.tsx）。
 */
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
