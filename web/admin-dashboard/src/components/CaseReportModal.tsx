import React, { useEffect, useState } from 'react';
import axios from 'axios';
import MedicalProfilePanel from '@shared/components/MedicalProfilePanel';
import { normalizeMedicalProfile } from '@shared/types/medicalProfile';
import { formatIstFull } from '@shared/utils/datetime';
import { Icon, type IconName } from '@shared/components/ui/Icon';
import { Modal } from '@shared/components/ui/Modal';
import { SeverityBadge, StatusBadge } from '@shared/components/ui/Status';

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

const NOT_RECORDED = 'Not recorded';

const fmtDate = (value?: string | null) => (value ? formatIstFull(value) : NOT_RECORDED);
const fmtText = (value?: string | number | null) =>
  value === null || value === undefined || value === '' ? NOT_RECORDED : String(value);
const fmtBool = (value?: boolean | null) =>
  value === null || value === undefined ? NOT_RECORDED : value ? 'Yes' : 'No';

const Section: React.FC<{ title: string; icon: IconName; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="ui-report__section">
    <h3 className="ui-report__heading">
      <Icon name={icon} size={16} />
      {title}
    </h3>
    {children}
  </section>
);

const Rows: React.FC<{ items: [string, string][] }> = ({ items }) => (
  <dl className="ui-dl">
    {items.map(([label, value]) => (
      <div key={label} className="ui-dl__item">
        <dt>{label}</dt>
        <dd className={value === NOT_RECORDED ? 'is-empty' : undefined}>{value}</dd>
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

  return (
    <Modal onClose={onClose} labelledBy="case-report-title" size="lg" align="top" className="ui-modal--auto-height ui-report">
      <div className="ui-modal__header">
        <span className="ui-icon-tile"><Icon name="fileText" size={22} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 id="case-report-title" className="ui-modal__title">ECS Case Report</h2>
          <p className="ui-modal__subtitle">
            {report ? `${report.reportId} · generated ${formatIstFull(report.generatedAt)}` : `Booking ${bookingId.slice(0, 8).toUpperCase()}`}
          </p>
          {report?.emergency && (
            <div className="ui-row" style={{ marginTop: 8 }}>
              {report.emergency.severity && <SeverityBadge severity={report.emergency.severity} />}
              {report.emergency.status && <StatusBadge status={report.emergency.status} />}
              {report.emergency.bookingType && <StatusBadge status={report.emergency.bookingType} />}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close report" className="ui-btn ui-btn--ghost ui-btn--icon ui-modal__close">
          <Icon name="x" />
        </button>
      </div>

      <div className="ui-modal__body">
        {error ? (
          <div className="ui-alert tone-danger" role="alert">
            <Icon name="alertTriangle" size={17} />
            <div>{error}</div>
          </div>
        ) : !report ? (
          <div className="ui-report__loading" role="status">
            {[0, 1, 2].map(i => <span key={i} className="ui-skeleton" style={{ height: 70 }} />)}
            <span className="ui-sr-only">Loading case report…</span>
          </div>
        ) : (
          <>
            <Section title="Patient" icon="user">
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
            <Section title="Medical Profile" icon="stethoscope">
              <MedicalProfilePanel
                profile={normalizeMedicalProfile(report.medicalProfile)}
                title={null}
                footnote="Taken from the patient's profile — the most recently saved information."
                style={{ border: 'none', padding: 0 }}
              />
            </Section>

            <Section title="Emergency" icon="siren">
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

            <Section title="Triage Information" icon="activity">
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
                <p className="ui-report__none">No triage assessment was recorded for this case.</p>
              )}
            </Section>

            <Section title="Dispatch & Treatment" icon="ambulance">
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
                <p className="ui-report__none">No ambulance has been dispatched for this case.</p>
              )}
            </Section>
          </>
        )}
      </div>

      {report && (
        <div className="ui-modal__footer">
          <button type="button" onClick={onClose} className="ui-btn ui-btn--secondary">Close</button>
          <button type="button" onClick={() => window.print()} className="ui-btn ui-btn--primary">
            <Icon name="printer" size={16} />
            Print / Save as PDF
          </button>
        </div>
      )}
    </Modal>
  );
};

export default CaseReportModal;
