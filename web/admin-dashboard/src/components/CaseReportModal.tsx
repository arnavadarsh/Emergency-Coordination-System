import React, { useEffect, useState } from 'react';
import axios from 'axios';
import MedicalProfilePanel from './MedicalProfilePanel';
import { normalizeMedicalProfile } from '../types/medicalProfile';
import { formatIstFull } from '../utils/datetime';

/**
 * ECS case report for a single booking.
 *
 * Presents the whole record in one place — patient, Medical Profile, emergency,
 * triage and the dispatch/treatment timeline. The Medical Profile is fetched
 * with the report rather than stored on the booking, so a report opened after
 * the patient edited their profile shows the updated values.
 */

interface CaseReportModalProps {
  bookingId: string;
  apiBaseUrl: string;
  token: string;
  onClose: () => void;
}

const C = {
  text: '#172b4d',
  sub: '#6b778c',
  muted: '#97a0af',
  border: '#e0e0e0',
  accent: '#0066cc',
  surface: '#ffffff',
  rowBg: '#f8f9fa',
};

const NOT_RECORDED = 'Not recorded';

const fmtDate = (value?: string | null) => (value ? formatIstFull(value) : NOT_RECORDED);
const fmtText = (value?: string | number | null) =>
  value === null || value === undefined || value === '' ? NOT_RECORDED : String(value);
const fmtBool = (value?: boolean | null) =>
  value === null || value === undefined ? NOT_RECORDED : value ? 'Yes' : 'No';

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section style={{ marginBottom: '22px' }}>
    <h4
      style={{
        margin: '0 0 12px',
        fontSize: '13px',
        fontWeight: 800,
        color: C.text,
        textTransform: 'uppercase',
        letterSpacing: '0.7px',
        paddingBottom: '8px',
        borderBottom: `2px solid ${C.border}`,
      }}
    >
      {title}
    </h4>
    {children}
  </section>
);

const Rows: React.FC<{ items: [string, string][] }> = ({ items }) => (
  <dl
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: '10px',
      margin: 0,
    }}
  >
    {items.map(([label, value]) => (
      <div key={label} style={{ background: C.rowBg, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 12px' }}>
        <dt style={{ fontSize: '10.5px', fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
          {label}
        </dt>
        <dd
          style={{
            margin: 0,
            fontSize: '14px',
            color: value === NOT_RECORDED ? C.muted : C.text,
            fontStyle: value === NOT_RECORDED ? 'italic' : 'normal',
            fontWeight: value === NOT_RECORDED ? 500 : 600,
            wordBreak: 'break-word',
          }}
        >
          {value}
        </dd>
      </div>
    ))}
  </dl>
);

const CaseReportModal: React.FC<CaseReportModalProps> = ({ bookingId, apiBaseUrl, token, onClose }) => {
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get(`${apiBaseUrl}/bookings/${bookingId}/report`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setReport(res.data);
      } catch (err: any) {
        if (!cancelled) setError(err.response?.data?.message || 'Failed to load the case report');
      }
    })();
    return () => { cancelled = true; };
  }, [apiBaseUrl, bookingId, token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ECS case report"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(9, 30, 66, 0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '32px 16px',
        overflowY: 'auto',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.surface,
          borderRadius: '12px',
          width: '100%',
          maxWidth: '860px',
          padding: '28px',
          boxShadow: '0 12px 40px rgba(9, 30, 66, 0.3)',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '24px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', color: C.text }}>ECS Case Report</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: C.sub }}>
              {report ? `${report.reportId} · generated ${formatIstFull(report.generatedAt)}` : `Booking ${bookingId.slice(0, 8).toUpperCase()}`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close report"
            style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: C.sub, lineHeight: 1 }}
          >
            ✕
          </button>
        </header>

        {error ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#c62828' }}>{error}</div>
        ) : !report ? (
          <div style={{ padding: '40px', textAlign: 'center', color: C.sub }}>Loading case report…</div>
        ) : (
          <>
            <Section title="Patient">
              <Rows
                items={[
                  ['Name', fmtText(report.patient?.name)],
                  ['Phone', fmtText(report.patient?.phoneNumber)],
                  ['Email', fmtText(report.patient?.email)],
                  ['Date of Birth', report.patient?.dateOfBirth ? fmtDate(report.patient.dateOfBirth) : NOT_RECORDED],
                  ['Emergency Contact', fmtText(report.patient?.emergencyContact)],
                  ['Address', fmtText(report.patient?.address)],
                ]}
              />
            </Section>

            {/* Supporting patient information, alongside the triage record. */}
            <Section title="Medical Profile">
              <MedicalProfilePanel
                profile={normalizeMedicalProfile(report.medicalProfile)}
                title={null}
                footnote="Taken from the patient's profile — the most recently saved information."
                style={{ border: 'none', padding: 0 }}
              />
            </Section>

            <Section title="Emergency">
              <Rows
                items={[
                  ['Booking ID', fmtText(report.emergency?.bookingId)],
                  ['Status', fmtText(report.emergency?.status)],
                  ['Type', fmtText(report.emergency?.bookingType)],
                  ['Severity', fmtText(report.emergency?.severity)],
                  ['Pickup Address', fmtText(report.emergency?.pickupAddress)],
                  ['Destination', fmtText(report.emergency?.destinationAddress)],
                  ['Description', fmtText(report.emergency?.description)],
                  ['Created', fmtDate(report.emergency?.createdAt)],
                  ['Completed', fmtDate(report.emergency?.completedAt)],
                ]}
              />
            </Section>

            <Section title="Triage Information">
              {report.triage ? (
                <Rows
                  items={[
                    ['Emergency Type', fmtText(report.triage.emergencyType)],
                    ['Priority', fmtText(report.emergency?.severity)],
                    ['Breathing', fmtBool(report.triage.breathing)],
                    ['Bleeding', fmtBool(report.triage.bleeding)],
                    ['Conscious', fmtBool(report.triage.conscious)],
                    ['Pain Level', report.triage.painLevel != null ? `${report.triage.painLevel}/10` : NOT_RECORDED],
                    ['Pregnancy', fmtBool(report.triage.pregnancy)],
                  ]}
                />
              ) : (
                <p style={{ margin: 0, fontSize: '14px', color: C.muted, fontStyle: 'italic' }}>
                  No triage assessment was recorded for this case.
                </p>
              )}
            </Section>

            <Section title="Dispatch &amp; Treatment">
              {report.treatment ? (
                <Rows
                  items={[
                    ['Dispatch Status', fmtText(report.treatment.status)],
                    ['Ambulance', fmtText(report.treatment.ambulanceVehicleNumber)],
                    ['Ambulance Type', fmtText(report.treatment.ambulanceType)],
                    ['Driver', fmtText(report.treatment.driver?.name)],
                    ['Receiving Hospital', fmtText(report.treatment.hospitalName)],
                    ['Dispatched', fmtDate(report.treatment.dispatchedAt)],
                    ['Arrived at Patient', fmtDate(report.treatment.arrivedAtPickup)],
                    ['Arrived at Hospital', fmtDate(report.treatment.arrivedAtHospital)],
                    ['Completed', fmtDate(report.treatment.completedAt)],
                    ['Distance', report.treatment.actualDistanceKm != null ? `${report.treatment.actualDistanceKm} km` : NOT_RECORDED],
                    ['Notes', fmtText(report.treatment.notes)],
                  ]}
                />
              ) : (
                <p style={{ margin: 0, fontSize: '14px', color: C.muted, fontStyle: 'italic' }}>
                  No ambulance has been dispatched for this case.
                </p>
              )}
            </Section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px', borderTop: `2px solid ${C.border}` }}>
              <button
                onClick={() => window.print()}
                style={{
                  padding: '10px 20px',
                  background: C.accent,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                🖨 Print / Save as PDF
              </button>
              <button
                onClick={onClose}
                style={{
                  padding: '10px 20px',
                  background: '#f4f5f7',
                  color: C.text,
                  border: `2px solid ${C.border}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CaseReportModal;
