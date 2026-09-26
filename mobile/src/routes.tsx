/**
 * 路由（T05）：AuthProvider 路由守卫（未登录 → /login）。
 * 页面：Login / Chat / SessionList / Settings / ModelPick。
 */
import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { ChatPage } from './pages/ChatPage';
import { SessionListPage } from './pages/SessionListPage';
import { SettingsPage } from './pages/SettingsPage';
import { ModelPickPage } from './pages/ModelPickPage';
import DevicePage from './pages/DevicePage';
import { OverlayGuidePage } from './pages/OverlayGuidePage';

function RequireAuth({ children }: { children: React.ReactElement }): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}

export function AppRoutes(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/chat"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions"
        element={
          <RequireAuth>
            <SessionListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings/model"
        element={
          <RequireAuth>
            <ModelPickPage />
          </RequireAuth>
        }
      />
      <Route
        path="/devices"
        element={
          <RequireAuth>
            <DevicePage />
          </RequireAuth>
        }
      />
      <Route
        path="/overlay-guide"
        element={
          <RequireAuth>
            <OverlayGuidePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
