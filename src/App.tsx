import { Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import { SignInPage } from '@/features/auth/components/SignInPage'
import { DashboardPage } from '@/features/dashboard/components/DashboardPage'
import {
  FilesPage,
  PlanPage,
  SecurityPage,
} from '@/features/dashboard/components/pages'
import { ProtectedRoute } from '@/shared/auth/ProtectedRoute'

function App() {
  return (
    <Routes>
      <Route path="/" element={<SignInPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      >
        <Route index element={<FilesPage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}

export default App
