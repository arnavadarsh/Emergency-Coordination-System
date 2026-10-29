import axios from 'axios';
import TokenStorage from '../utils/tokenStorage';
import { API_BASE_URL } from '../config/api';

/**
 * Client for the admin control centre (/api/admin). Every call carries the
 * admin's token; every write is recorded in the audit log by the server.
 */
const http = () =>
  axios.create({ baseURL: `${API_BASE_URL}/admin`, headers: { Authorization: `Bearer ${TokenStorage.getToken() ?? ''}` } });

/** The server's message for a failed call, flattened to one readable line. */
export function errorText(err: any, fallback = 'Something went wrong.'): string {
  const message = err?.response?.data?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message || err?.message || fallback;
}

export type Role = 'USER' | 'DRIVER' | 'HOSPITAL' | 'ADMIN';

export interface AdminUserDetail {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  licenseNumber: string | null;
  hospital: { id: string; name: string } | null;
  ambulance: { id: string; vehicleNumber: string; status: string } | null;
  bookingCount: number;
  lastLoginAt: string | null;
  sessionsRevokedAt: string | null;
  createdAt: string;
  warnings?: string[];
}

export interface Capability {
  id: string;
  capabilityType: string;
  name: string;
  status: string;
  capacity: number;
  currentLoad: number;
}

export interface AdminHospital {
  id: string;
  name: string;
  address: string;
  phoneNumber: string;
  email: string | null;
  latitude: number;
  longitude: number;
  status: string;
  totalBeds: number;
  availableBeds: number;
  capabilities: Capability[];
  staff?: { id: string; email: string; isActive: boolean }[];
  incomingAmbulances?: number;
}

export interface AdminAmbulance {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  status: string;
  currentLatitude: number | null;
  currentLongitude: number | null;
  drivers: { id: string; email: string; name: string; isActive: boolean }[];
  activeTrip: { dispatchId: string; bookingId: string; status: string } | null;
}

export interface QueueItem {
  id: string;
  status: string;
  severity: string;
  pickupAddress: string | null;
  patientName: string;
  patientPhone: string | null;
  createdAt: string;
  waitingMinutes: number;
  needsDecision: boolean;
}

export interface CaseControls {
  booking: {
    id: string; status: string; severity: string; pickupAddress: string | null; destinationAddress: string | null;
    patientName: string; patientPhone: string | null; createdAt: string;
  };
  dispatch: {
    id: string; status: string; driverId: string | null;
    ambulance: { id: string; vehicleNumber: string } | null;
    hospital: { id: string; name: string } | null;
    dispatchedAt: string | null;
  } | null;
  tracking: { active: boolean; closeReason: string | null; expiresAt: string; viewCount: number } | null;
  chatMessages: number;
  availableAmbulances: { id: string; vehicleNumber: string; vehicleType: string; distanceKm: number | null }[];
  hospitals: { id: string; name: string; status: string; availableBeds: number; distanceKm: number | null }[];
}

export interface RuntimeSettings {
  autoDispatchEnabled: boolean;
  dispatchRetryMaxAgeMinutes: number;
  patientSignupEnabled: boolean;
  contactSmsEnabled: boolean;
}

export interface AuditItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorEmail: string | null;
  changes: any;
  beforeState: any;
  afterState: any;
  createdAt: string;
}

export const adminApi = {
  // People
  getUser: (id: string) => http().get<AdminUserDetail>(`/users/${id}`).then(r => r.data),
  updateUser: (id: string, body: Partial<{
    firstName: string; lastName: string; phoneNumber: string; email: string; role: Role; isActive: boolean;
    hospitalId: string | null; ambulanceId: string | null; licenseNumber: string | null;
  }>) => http().patch<AdminUserDetail>(`/users/${id}`, body).then(r => r.data),
  resetPassword: (id: string, password: string) => http().post(`/users/${id}/password`, { password }).then(r => r.data),
  signOut: (id: string) => http().post(`/users/${id}/sign-out`).then(r => r.data),

  // Hospitals
  listHospitals: () => http().get<AdminHospital[]>('/hospitals').then(r => r.data),
  createHospital: (body: Record<string, unknown>) => http().post<AdminHospital>('/hospitals', body).then(r => r.data),
  updateHospital: (id: string, body: Record<string, unknown>) => http().patch<AdminHospital>(`/hospitals/${id}`, body).then(r => r.data),
  deleteHospital: (id: string) => http().delete(`/hospitals/${id}`).then(r => r.data),
  saveCapability: (id: string, type: string, body: Partial<Capability>) =>
    http().put<Capability>(`/hospitals/${id}/capabilities/${type}`, body).then(r => r.data),
  removeCapability: (id: string, type: string) => http().delete(`/hospitals/${id}/capabilities/${type}`).then(r => r.data),

  // Ambulances
  listAmbulances: () => http().get<AdminAmbulance[]>('/ambulances').then(r => r.data),
  createAmbulance: (body: Record<string, unknown>) => http().post('/ambulances', body).then(r => r.data),
  updateAmbulance: (id: string, body: Record<string, unknown>) => http().patch(`/ambulances/${id}`, body).then(r => r.data),
  deleteAmbulance: (id: string) => http().delete(`/ambulances/${id}`).then(r => r.data),

  // Live operations
  queue: () => http().get<{ items: QueueItem[]; availableAmbulances: number; autoDispatchEnabled: boolean; retryMaxAgeMinutes: number }>('/bookings/queue').then(r => r.data),
  controls: (bookingId: string) => http().get<CaseControls>(`/bookings/${bookingId}/controls`).then(r => r.data),
  dispatch: (bookingId: string, ambulanceId?: string) => http().post(`/bookings/${bookingId}/dispatch`, ambulanceId ? { ambulanceId } : {}).then(r => r.data),
  cancel: (bookingId: string) => http().post(`/bookings/${bookingId}/cancel`).then(r => r.data),
  revokeTracking: (bookingId: string) => http().post(`/bookings/${bookingId}/tracking/revoke`).then(r => r.data),
  chat: (bookingId: string) => http().get<{ id: string; senderRole: string; senderName: string; message: string; attachmentUrl: string | null; createdAt: string }[]>(`/bookings/${bookingId}/chat`).then(r => r.data),
  reassign: (dispatchId: string, ambulanceId: string) => http().post(`/dispatches/${dispatchId}/reassign`, { ambulanceId }).then(r => r.data),
  reroute: (dispatchId: string, hospitalId: string) => http().post(`/dispatches/${dispatchId}/hospital`, { hospitalId }).then(r => r.data),
  setTripStatus: (dispatchId: string, status: string) => http().post(`/dispatches/${dispatchId}/status`, { status }).then(r => r.data),

  // System
  settings: () => http().get<{ values: RuntimeSettings; changes: Record<string, { updatedAt: string; updatedBy: string | null } | null> }>('/system/settings').then(r => r.data),
  updateSettings: (patch: Partial<RuntimeSettings>) => http().patch('/system/settings', patch).then(r => r.data),
  status: () => http().get('/system/status').then(r => r.data),
  broadcast: (message: string, audience: string, tone: string) => http().post('/system/broadcast', { message, audience, tone }).then(r => r.data),
  testSms: (phoneNumber: string) => http().post('/system/test-sms', { phoneNumber }).then(r => r.data),
  runDispatch: () => http().post('/system/dispatch-retry').then(r => r.data),
  llmUsage: () => axios.get(`${API_BASE_URL}/triage/llm/usage`, { headers: { Authorization: `Bearer ${TokenStorage.getToken() ?? ''}` } }).then(r => r.data),

  // Audit
  audit: (query: { limit?: number; offset?: number; action?: string; entityType?: string }) =>
    http().get<{ total: number; items: AuditItem[] }>('/audit', { params: query }).then(r => r.data),
};
