import React, { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import ApiClient from '../services/api';
import '../styles/Landing.css';

/**
 * Hospital Landing Page with Login and Register Info
 */
const Landing: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await ApiClient.login(email, password);
      if (response.user.role !== 'HOSPITAL') {
        setError('Invalid credentials for Hospital portal');
        localStorage.removeItem('ecs_token');
        localStorage.removeItem('ecs_user');
        return;
      }
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-container hospital">
      <div className="landing-card">
        <div className="landing-header hospital">
          <div className="landing-icon">🏥</div>
          <h1>ECS Hospital Portal</h1>
          <p>Emergency Coordination System</p>
        </div>

        <div className="mode-tabs">
          <button
            className={`tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Login
          </button>
          <button
            className={`tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            Register Hospital
          </button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="landing-form">
            {error && <div className="error-message">{error}</div>}

            <div className="form-group">
              <label htmlFor="email">Hospital Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="hospital@example.com"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </div>

            <button type="submit" disabled={loading} className="submit-button hospital">
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        ) : (
          <div className="info-box hospital">
            <div className="info-icon">📋</div>
            <h3>Hospital Registration</h3>
            <p>
              To register your hospital with the Emergency Coordination System, 
              please contact our administrative team. We require verification of 
              hospital credentials before granting access.
            </p>
            
            <div className="contact-info">
              <div className="contact-item">
                <span className="contact-icon">📧</span>
                <div>
                  <strong>Email</strong>
                  <a href="mailto:admin@ecs.com">admin@ecs.com</a>
                </div>
              </div>
              <div className="contact-item">
                <span className="contact-icon">📞</span>
                <div>
                  <strong>Phone</strong>
                  <a href="tel:+911234567890">+91 123 456 7890</a>
                </div>
              </div>
              <div className="contact-item">
                <span className="contact-icon">🏢</span>
                <div>
                  <strong>Office</strong>
                  <span>ECS HQ, Emergency Services Building</span>
                </div>
              </div>
            </div>

            <div className="requirements-list">
              <h4>Requirements for Registration:</h4>
              <ul>
                <li>Valid Hospital Registration Certificate</li>
                <li>Emergency Department License</li>
                <li>Authorized Representative Details</li>
                <li>Hospital Infrastructure Information</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Landing;
