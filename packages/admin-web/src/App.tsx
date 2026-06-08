import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';
import Layout from '@/components/Layout';
import RequireAuth from '@/components/RequireAuth';
import DomainsPage from '@/pages/DomainsPage';
import PortalUIPage from '@/pages/PortalUIPage';
import LandingPage from '@/pages/LandingPage';
import MediaPage from '@/pages/MediaPage';
import SystemPage from '@/pages/SystemPage';
import { ToastViewport } from '@/components/Toast';

export default function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/domains" replace />} />
            <Route path="domains" element={<DomainsPage />} />
            <Route path="portal-ui" element={<PortalUIPage />} />
            <Route path="landing" element={<LandingPage />} />
            <Route path="media" element={<MediaPage />} />
            <Route path="system" element={<SystemPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <ToastViewport />
    </>
  );
}
