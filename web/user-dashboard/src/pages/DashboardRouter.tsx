import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TokenStorage from '../utils/tokenStorage';
import UserDashboard from './Dashboard';
import AdminDashboard from './AdminDashboard';
import HospitalDashboard from './HospitalDashboard';
import DriverDashboard from './DriverDashboard';

/**
 * Dashboard Router - Routes to appropriate dashboard based on user role
 */
const DashboardRouter: React.FC = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get user role from storage
    const userRole = TokenStorage.getUserRole();
    
    if (!userRole) {
      // If no role found, logout and redirect to login
      TokenStorage.clearToken();
      navigate('/');
      return;
    }
    
    setRole(userRole);
    setLoading(false);
  }, [navigate]);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '24px'
      }}>
        Loading...
      </div>
    );
  }

  // Route to appropriate dashboard based on role
  switch (role) {
    case 'ADMIN':
      return <AdminDashboard />;
    case 'HOSPITAL':
      return <HospitalDashboard />;
    case 'DRIVER':
      return <DriverDashboard />;
    case 'USER':
    default:
      return <UserDashboard />;
  }
};

export default DashboardRouter;
